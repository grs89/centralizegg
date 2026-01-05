package storage

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

type DB struct {
	Conn *sql.DB
}

type VM struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	State       string    `json:"state"`
	CPUTime     uint64    `json:"cpu_time"`
	MemoryUsage uint64    `json:"memory_usage"`
	MaxMemory   uint64    `json:"max_memory"`
	HostID      int64     `json:"host_id"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Host struct {
	ID          int64  `json:"id"`
	ServerID    int64  `json:"server_id"`
	Hostname    string `json:"hostname"`
	CPUModel    string `json:"cpu_model"`
	CPUCores    int    `json:"cpu_cores"`
	TotalMemory uint64 `json:"total_memory"`
}

type KVMServer struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	IPAddress  string `json:"ip_address"`
	SSHPort    int    `json:"ssh_port"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	SSHKeyPath string `json:"ssh_key_path"`
}

func NewPostgresDB(connStr string) (*DB, error) {
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open db: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping db: %w", err)
	}

	return &DB{Conn: db}, nil
}

func (d *DB) UpsertHost(h Host) (int64, error) {
	var id int64
	// Check by ServerID mainly, assuming 1 host per server config
	err := d.Conn.QueryRow("SELECT id FROM hosts WHERE server_id = $1", h.ServerID).Scan(&id)
	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO hosts (server_id, hostname, cpu_model, cpu_cores, total_memory)
			VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			h.ServerID, h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`UPDATE hosts SET hostname=$1, cpu_model=$2, cpu_cores=$3, total_memory=$4 WHERE id=$5`,
			h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, id)
	}
	return id, err
}

func (d *DB) UpsertVM(vm VM) error {
	// Check if VM exists by Name and HostID
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM vms WHERE name = $1 AND host_id = $2", vm.Name, vm.HostID).Scan(&id)

	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO vms (name, state, cpu_time, memory_usage, max_memory, host_id, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
			vm.Name, vm.State, vm.CPUTime, vm.MemoryUsage, vm.MaxMemory, vm.HostID)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE vms 
			SET state=$1, cpu_time=$2, memory_usage=$3, max_memory=$4, updated_at=NOW()
			WHERE id=$5`,
			vm.State, vm.CPUTime, vm.MemoryUsage, vm.MaxMemory, id)
	}
	return err
}

func (d *DB) GetAllVMs() ([]VM, error) {
	rows, err := d.Conn.Query("SELECT id, name, state, cpu_time, memory_usage, max_memory, host_id, updated_at FROM vms")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vms []VM
	for rows.Next() {
		var vm VM
		if err := rows.Scan(&vm.ID, &vm.Name, &vm.State, &vm.CPUTime, &vm.MemoryUsage, &vm.MaxMemory, &vm.HostID, &vm.UpdatedAt); err != nil {
			return nil, err
		}
		vms = append(vms, vm)
	}
	return vms, nil
}

func (d *DB) AddServer(s KVMServer) (int64, error) {
	var id int64
	err := d.Conn.QueryRow(`
		INSERT INTO kvm_servers (name, ip_address, username, password, ssh_key_path)
		VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		s.Name, s.IPAddress, s.Username, s.Password, s.SSHKeyPath).Scan(&id)
	return id, err
}

func (d *DB) GetServers() ([]KVMServer, error) {
	rows, err := d.Conn.Query("SELECT id, name, ip_address, username, password, ssh_key_path FROM kvm_servers")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []KVMServer
	for rows.Next() {
		var s KVMServer
		// password can be null in DB (sql.NullString), but we simplified schema to varchar.
		// If using lib/pq with scanning into string, NULL might error if not careful.
		// However, we didn't set NOT NULL on password, so it can be null.
		// To be safe, let's scan into sql.NullString or just assume empty string if we handle it in Insert.
		// Actually, let's look at init.sql: `password VARCHAR(255)`.
		// If we insert empty string, it's empty string. If we insert NULL, scan might fail on string.
		// Let's use a pointer or NullString? For simplicity, let's scan into a nullable type helper or just use sql.NullString then convert.
		var pwd sql.NullString
		if err := rows.Scan(&s.ID, &s.Name, &s.IPAddress, &s.Username, &pwd, &s.SSHKeyPath); err != nil {
			return nil, err
		}
		s.Password = pwd.String
		servers = append(servers, s)
	}
	return servers, nil
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
	rows, err := d.Conn.Query("SELECT id, server_id, hostname, cpu_model, cpu_cores, total_memory FROM hosts")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []Host
	for rows.Next() {
		var h Host
		if err := rows.Scan(&h.ID, &h.ServerID, &h.Hostname, &h.CPUModel, &h.CPUCores, &h.TotalMemory); err != nil {
			return nil, err
		}
		hosts = append(hosts, h)
	}
	return hosts, nil
}
