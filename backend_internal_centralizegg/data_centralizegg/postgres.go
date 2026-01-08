package data_centralizegg

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
)

type DB struct {
	Conn *sql.DB
}

type VM struct {
	ID             int64     `json:"id"`
	Name           string    `json:"name"`
	State          string    `json:"state"`
	VCPU           int       `json:"vcpu"`
	CPUTime        uint64    `json:"cpu_time"`
	MemoryUsage    uint64    `json:"memory_usage"`
	MaxMemory      uint64    `json:"max_memory"`
	DiskAllocation uint64    `json:"disk_allocation"`
	DiskCapacity   uint64    `json:"disk_capacity"`
	DiskRead       uint64    `json:"disk_read"`
	DiskWrite      uint64    `json:"disk_write"`
	NetRX          uint64    `json:"net_rx"`
	NetTX          uint64    `json:"net_tx"`
	CPUUsage       float64   `json:"cpu_usage"`
	HostID         int64     `json:"host_id"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type Host struct {
	ID          int64   `json:"id"`
	ServerID    int64   `json:"server_id"`
	Hostname    string  `json:"hostname"`
	ServerName  string  `json:"server_name"`
	IPAddress   string  `json:"ip_address"`
	CPUModel    string  `json:"cpu_model"`
	CPUCores    int     `json:"cpu_cores"`
	TotalMemory uint64  `json:"total_memory"`
	FreeMemory  uint64  `json:"free_memory"`
	CPUUsage    float64 `json:"cpu_usage"`
	OSName      string  `json:"os_name"`
}

type KVMServer struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	IPAddress  string `json:"ip_address"`
	SSHPort    int    `json:"ssh_port"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	SSHKeyPath string `json:"ssh_key_path"`
	Status     string `json:"status"` // online, offline, unknown
}

func NewPostgresDB(connStr string) (*DB, error) {
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open db: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping db: %w", err)
	}

	// Auto-migration: Ensure os_name column exists in hosts table
	_, _ = db.Exec("ALTER TABLE hosts ADD COLUMN IF NOT EXISTS os_name VARCHAR(255)")
	_, _ = db.Exec("ALTER TABLE hosts ADD COLUMN IF NOT EXISTS free_memory BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE hosts ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE vms ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE vms ADD COLUMN IF NOT EXISTS disk_allocation BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE vms ADD COLUMN IF NOT EXISTS disk_capacity BIGINT DEFAULT 0")

	return &DB{Conn: db}, nil
}

func (d *DB) UpsertHost(h Host) (int64, error) {
	var id int64
	// Check by ServerID mainly, assuming 1 host per server config
	err := d.Conn.QueryRow("SELECT id FROM hosts WHERE server_id = $1", h.ServerID).Scan(&id)
	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO hosts (server_id, hostname, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
			h.ServerID, h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`UPDATE hosts SET hostname=$1, cpu_model=$2, cpu_cores=$3, total_memory=$4, free_memory=$5, cpu_usage=$6, os_name=$7 WHERE id=$8`,
			h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, id)
	}
	return id, err
}

func (d *DB) UpsertVM(vm VM) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM vms WHERE name = $1 AND host_id = $2", vm.Name, vm.HostID).Scan(&id)

	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO vms (name, state, vcpu, cpu_time, cpu_usage, memory_usage, max_memory, disk_allocation, disk_capacity, disk_read, disk_write, net_rx, net_tx, host_id, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())`,
			vm.Name, vm.State, vm.VCPU, vm.CPUTime, vm.CPUUsage, vm.MemoryUsage, vm.MaxMemory, vm.DiskAllocation, vm.DiskCapacity, vm.DiskRead, vm.DiskWrite, vm.NetRX, vm.NetTX, vm.HostID)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE vms SET state=$1, vcpu=$2, cpu_time=$3, cpu_usage=$4, memory_usage=$5, max_memory=$6, disk_allocation=$7, disk_capacity=$8, disk_read=$9, disk_write=$10, net_rx=$11, net_tx=$12, updated_at=NOW()
			WHERE id=$13`,
			vm.State, vm.VCPU, vm.CPUTime, vm.CPUUsage, vm.MemoryUsage, vm.MaxMemory, vm.DiskAllocation, vm.DiskCapacity, vm.DiskRead, vm.DiskWrite, vm.NetRX, vm.NetTX, id)
	}
	return err
}

func (d *DB) GetAllVMs() ([]VM, error) {
	rows, err := d.Conn.Query("SELECT id, name, state, vcpu, cpu_time, cpu_usage, memory_usage, max_memory, disk_allocation, disk_capacity, disk_read, disk_write, net_rx, net_tx, host_id, updated_at FROM vms")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vms []VM
	for rows.Next() {
		var vm VM
		if err := rows.Scan(&vm.ID, &vm.Name, &vm.State, &vm.VCPU, &vm.CPUTime, &vm.CPUUsage, &vm.MemoryUsage, &vm.MaxMemory, &vm.DiskAllocation, &vm.DiskCapacity, &vm.DiskRead, &vm.DiskWrite, &vm.NetRX, &vm.NetTX, &vm.HostID, &vm.UpdatedAt); err != nil {
			return nil, err
		}
		vms = append(vms, vm)
	}
	return vms, nil
}

func (d *DB) AddServer(s KVMServer) (int64, error) {
	log.Printf("DEBUG: AddServer called with Name=%s IP=%s Port=%d", s.Name, s.IPAddress, s.SSHPort)
	var id int64
	if s.SSHPort == 0 {
		s.SSHPort = 22
	}
	err := d.Conn.QueryRow(`
		INSERT INTO kvm_servers (name, ip_address, ssh_port, username, password, ssh_key_path)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath).Scan(&id)
	return id, err
}

func (d *DB) GetServers() ([]KVMServer, error) {
	rows, err := d.Conn.Query("SELECT id, name, ip_address, ssh_port, username, password, ssh_key_path, status FROM kvm_servers")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []KVMServer
	for rows.Next() {
		var s KVMServer
		var pwd sql.NullString
		// Validating scan args count: 8 cols
		if err := rows.Scan(&s.ID, &s.Name, &s.IPAddress, &s.SSHPort, &s.Username, &pwd, &s.SSHKeyPath, &s.Status); err != nil {
			return nil, err
		}
		s.Password = pwd.String
		servers = append(servers, s)
	}
	return servers, nil
}

func (d *DB) SetServerStatus(id int64, status string) error {
	_, err := d.Conn.Exec("UPDATE kvm_servers SET status=$1 WHERE id=$2", status, id)
	return err
}

func (d *DB) UpdateServer(s KVMServer) error {
	// Only update password/key if they are provided (non-empty)?
	// Or just update specific fields. For simplicity, we update all configurable fields.
	// If password is empty, maybe we shouldn't overwrite it with empty if user didn't change it?
	// For now, let's assume the UI sends the current values or new ones.
	// But for password, UI won't send the old one back for security.
	// So if password is empty string, we SKIP updating it.

	// Dynamic query building is annoying, let's just do a check.
	if s.SSHPort == 0 {
		s.SSHPort = 22
	}

	if s.Password == "" {
		// Update without password
		_, err := d.Conn.Exec(`UPDATE kvm_servers 
			SET name=$1, ip_address=$2, ssh_port=$3, username=$4, ssh_key_path=$5 
			WHERE id=$6`,
			s.Name, s.IPAddress, s.SSHPort, s.Username, s.SSHKeyPath, s.ID)
		return err
	} else {
		// Update with password
		_, err := d.Conn.Exec(`UPDATE kvm_servers 
			SET name=$1, ip_address=$2, ssh_port=$3, username=$4, password=$5, ssh_key_path=$6 
			WHERE id=$7`,
			s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath, s.ID)
		return err
	}
}

func (d *DB) DeleteServer(id int64) error {
	_, err := d.Conn.Exec("DELETE FROM kvm_servers WHERE id=$1", id)
	return err
}

func (d *DB) GetHosts() ([]Host, error) {
	rows, err := d.Conn.Query(`
		SELECT h.id, h.server_id, h.hostname, s.name, s.ip_address, h.cpu_model, h.cpu_cores, h.total_memory, h.free_memory, h.cpu_usage, h.os_name
		FROM hosts h
		JOIN kvm_servers s ON h.server_id = s.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []Host
	for rows.Next() {
		var h Host
		var osName sql.NullString
		if err := rows.Scan(&h.ID, &h.ServerID, &h.Hostname, &h.ServerName, &h.IPAddress, &h.CPUModel, &h.CPUCores, &h.TotalMemory, &h.FreeMemory, &h.CPUUsage, &osName); err != nil {
			return nil, err
		}
		h.OSName = osName.String
		hosts = append(hosts, h)
	}
	return hosts, nil
}
