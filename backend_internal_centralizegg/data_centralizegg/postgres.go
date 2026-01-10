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
	GuestIPs       string    `json:"guest_ips"`
	GuestFSUsage   string    `json:"guest_fs_usage"`
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

	// Auto-migration strategies
	_, _ = db.Exec("CREATE SCHEMA IF NOT EXISTS virtualization")
	_, _ = db.Exec("CREATE SCHEMA IF NOT EXISTS firewall")
	// Ensure tables exist if not (simplified, ideally usage of migrate tool)
	// For now we assume init.sql handles creation or we ALTER existing ones.
	// NOTE: The ALTER queries below assume the table is in 'virtualization' schema now.
	// If tables were in public, they need to be moved manually or via SQL script.

	_, _ = db.Exec("ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS os_name VARCHAR(255)")
	_, _ = db.Exec("ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS free_memory BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS disk_allocation BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS disk_capacity BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS guest_ips TEXT DEFAULT ''")
	_, _ = db.Exec("ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS guest_fs_usage TEXT DEFAULT ''")

	return &DB{Conn: db}, nil
}

func (d *DB) UpsertHost(h Host) (int64, error) {
	var id int64
	// Check by ServerID mainly, assuming 1 host per server config
	err := d.Conn.QueryRow("SELECT id FROM virtualization.hosts WHERE server_id = $1", h.ServerID).Scan(&id)
	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO virtualization.hosts (server_id, hostname, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
			h.ServerID, h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`UPDATE virtualization.hosts SET hostname=$1, cpu_model=$2, cpu_cores=$3, total_memory=$4, free_memory=$5, cpu_usage=$6, os_name=$7 WHERE id=$8`,
			h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, id)
	}
	return id, err
}

func (d *DB) UpsertVM(vm VM) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM virtualization.vms WHERE name = $1 AND host_id = $2", vm.Name, vm.HostID).Scan(&id)

	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO virtualization.vms (name, state, vcpu, cpu_time, cpu_usage, memory_usage, max_memory, disk_allocation, disk_capacity, disk_read, disk_write, net_rx, net_tx, guest_ips, guest_fs_usage, host_id, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())`,
			vm.Name, vm.State, vm.VCPU, vm.CPUTime, vm.CPUUsage, vm.MemoryUsage, vm.MaxMemory, vm.DiskAllocation, vm.DiskCapacity, vm.DiskRead, vm.DiskWrite, vm.NetRX, vm.NetTX, vm.GuestIPs, vm.GuestFSUsage, vm.HostID)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE virtualization.vms SET state=$1, vcpu=$2, cpu_time=$3, cpu_usage=$4, memory_usage=$5, max_memory=$6, disk_allocation=$7, disk_capacity=$8, disk_read=$9, disk_write=$10, net_rx=$11, net_tx=$12, guest_ips=$13, guest_fs_usage=$14, updated_at=NOW()
			WHERE id=$15`,
			vm.State, vm.VCPU, vm.CPUTime, vm.CPUUsage, vm.MemoryUsage, vm.MaxMemory, vm.DiskAllocation, vm.DiskCapacity, vm.DiskRead, vm.DiskWrite, vm.NetRX, vm.NetTX, vm.GuestIPs, vm.GuestFSUsage, id)
	}
	return err
}

func (d *DB) GetAllVMs() ([]VM, error) {
	rows, err := d.Conn.Query("SELECT id, name, state, vcpu, cpu_time, cpu_usage, memory_usage, max_memory, disk_allocation, disk_capacity, disk_read, disk_write, net_rx, net_tx, guest_ips, guest_fs_usage, host_id, updated_at FROM virtualization.vms")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vms []VM
	for rows.Next() {
		var vm VM
		if err := rows.Scan(&vm.ID, &vm.Name, &vm.State, &vm.VCPU, &vm.CPUTime, &vm.CPUUsage, &vm.MemoryUsage, &vm.MaxMemory, &vm.DiskAllocation, &vm.DiskCapacity, &vm.DiskRead, &vm.DiskWrite, &vm.NetRX, &vm.NetTX, &vm.GuestIPs, &vm.GuestFSUsage, &vm.HostID, &vm.UpdatedAt); err != nil {
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
		INSERT INTO virtualization.kvm_servers (name, ip_address, ssh_port, username, password, ssh_key_path)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath).Scan(&id)
	return id, err
}

func (d *DB) GetServers() ([]KVMServer, error) {
	rows, err := d.Conn.Query("SELECT id, name, ip_address, ssh_port, username, password, ssh_key_path, status FROM virtualization.kvm_servers")
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
	_, err := d.Conn.Exec("UPDATE virtualization.kvm_servers SET status=$1 WHERE id=$2", status, id)
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
		_, err := d.Conn.Exec(`UPDATE virtualization.kvm_servers 
			SET name=$1, ip_address=$2, ssh_port=$3, username=$4, ssh_key_path=$5 
			WHERE id=$6`,
			s.Name, s.IPAddress, s.SSHPort, s.Username, s.SSHKeyPath, s.ID)
		return err
	} else {
		// Update with password
		_, err := d.Conn.Exec(`UPDATE virtualization.kvm_servers 
			SET name=$1, ip_address=$2, ssh_port=$3, username=$4, password=$5, ssh_key_path=$6 
			WHERE id=$7`,
			s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath, s.ID)
		return err
	}
}

func (d *DB) DeleteServer(id int64) error {
	_, err := d.Conn.Exec("DELETE FROM virtualization.kvm_servers WHERE id=$1", id)
	return err
}

func (d *DB) GetHosts() ([]Host, error) {
	rows, err := d.Conn.Query(`
		SELECT h.id, h.server_id, h.hostname, s.name, s.ip_address, h.cpu_model, h.cpu_cores, h.total_memory, h.free_memory, h.cpu_usage, h.os_name
		FROM virtualization.hosts h
		JOIN virtualization.kvm_servers s ON h.server_id = s.id`)
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

// PFSense types and functions
type PFSenseServer struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	IPAddress string `json:"ip_address"`
	APIPort   int    `json:"api_port"`
	APIKey    string `json:"api_key"`
	APISecret string `json:"api_secret"`
	Status    string `json:"status"` // online, offline, unknown
}

type FirewallHost struct {
	ID              int64   `json:"id"`
	ServerID        int64   `json:"server_id"`
	Hostname        string  `json:"hostname"`
	ServerName      string  `json:"server_name"`
	IPAddress       string  `json:"ip_address"`
	CPUModel        string  `json:"cpu_model"`
	CPUCores        int     `json:"cpu_cores"`
	TotalMemory     uint64  `json:"total_memory"`
	FreeMemory      uint64  `json:"free_memory"`
	CPUUsage        float64 `json:"cpu_usage"`
	OSName          string  `json:"os_name"`
	NetRXTotal      uint64  `json:"net_rx_total"`
	NetTXTotal      uint64  `json:"net_tx_total"`
	NetRXBytesPerSec uint64 `json:"net_rx_bytes_per_sec"`
	NetTXBytesPerSec uint64 `json:"net_tx_bytes_per_sec"`
}

type FirewallInterface struct {
	ID            int64  `json:"id"`
	HostID        int64  `json:"host_id"`
	InterfaceName string `json:"interface_name"`
	InterfaceType string `json:"interface_type"`
	Status        string `json:"status"`
	NetRXBytes    uint64 `json:"net_rx_bytes"`
	NetTXBytes    uint64 `json:"net_tx_bytes"`
	NetRXPackets  uint64 `json:"net_rx_packets"`
	NetTXPackets  uint64 `json:"net_tx_packets"`
	NetRXErrors   uint64 `json:"net_rx_errors"`
	NetTXErrors   uint64 `json:"net_tx_errors"`
	NetRXDropped  uint64 `json:"net_rx_dropped"`
	NetTXDropped  uint64 `json:"net_tx_dropped"`
}

func (d *DB) UpsertFirewallHost(h FirewallHost) (int64, error) {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM firewall.hosts WHERE server_id = $1", h.ServerID).Scan(&id)
	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO firewall.hosts (server_id, hostname, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name, net_rx_total, net_tx_total, net_rx_bytes_per_sec, net_tx_bytes_per_sec)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
			h.ServerID, h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.NetRXTotal, h.NetTXTotal, h.NetRXBytesPerSec, h.NetTXBytesPerSec).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`UPDATE firewall.hosts SET hostname=$1, cpu_model=$2, cpu_cores=$3, total_memory=$4, free_memory=$5, cpu_usage=$6, os_name=$7, net_rx_total=$8, net_tx_total=$9, net_rx_bytes_per_sec=$10, net_tx_bytes_per_sec=$11 WHERE id=$12`,
			h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.NetRXTotal, h.NetTXTotal, h.NetRXBytesPerSec, h.NetTXBytesPerSec, id)
	}
	return id, err
}

func (d *DB) UpsertFirewallInterface(iface FirewallInterface) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM firewall.interfaces WHERE host_id = $1 AND interface_name = $2", iface.HostID, iface.InterfaceName).Scan(&id)
	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO firewall.interfaces (host_id, interface_name, interface_type, status, net_rx_bytes, net_tx_bytes, net_rx_packets, net_tx_packets, net_rx_errors, net_tx_errors, net_rx_dropped, net_tx_dropped, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
			iface.HostID, iface.InterfaceName, iface.InterfaceType, iface.Status, iface.NetRXBytes, iface.NetTXBytes, iface.NetRXPackets, iface.NetTXPackets, iface.NetRXErrors, iface.NetTXErrors, iface.NetRXDropped, iface.NetTXDropped)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE firewall.interfaces SET interface_type=$1, status=$2, net_rx_bytes=$3, net_tx_bytes=$4, net_rx_packets=$5, net_tx_packets=$6, net_rx_errors=$7, net_tx_errors=$8, net_rx_dropped=$9, net_tx_dropped=$10, updated_at=NOW()
			WHERE id=$11`,
			iface.InterfaceType, iface.Status, iface.NetRXBytes, iface.NetTXBytes, iface.NetRXPackets, iface.NetTXPackets, iface.NetRXErrors, iface.NetTXErrors, iface.NetRXDropped, iface.NetTXDropped, id)
	}
	return err
}

func (d *DB) GetPFSenseServers() ([]PFSenseServer, error) {
	rows, err := d.Conn.Query("SELECT id, name, ip_address, api_port, api_key, api_secret, status FROM firewall.pfsense_servers")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []PFSenseServer
	for rows.Next() {
		var s PFSenseServer
		var key, secret sql.NullString
		if err := rows.Scan(&s.ID, &s.Name, &s.IPAddress, &s.APIPort, &key, &secret, &s.Status); err != nil {
			return nil, err
		}
		s.APIKey = key.String
		s.APISecret = secret.String
		servers = append(servers, s)
	}
	return servers, nil
}

func (d *DB) SetPFSenseServerStatus(id int64, status string) error {
	_, err := d.Conn.Exec("UPDATE firewall.pfsense_servers SET status=$1 WHERE id=$2", status, id)
	return err
}

func (d *DB) GetFirewallHosts() ([]FirewallHost, error) {
	rows, err := d.Conn.Query(`
		SELECT h.id, h.server_id, h.hostname, s.name, s.ip_address, h.cpu_model, h.cpu_cores, h.total_memory, h.free_memory, h.cpu_usage, h.os_name, h.net_rx_total, h.net_tx_total, h.net_rx_bytes_per_sec, h.net_tx_bytes_per_sec
		FROM firewall.hosts h
		JOIN firewall.pfsense_servers s ON h.server_id = s.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []FirewallHost
	for rows.Next() {
		var h FirewallHost
		var osName sql.NullString
		if err := rows.Scan(&h.ID, &h.ServerID, &h.Hostname, &h.ServerName, &h.IPAddress, &h.CPUModel, &h.CPUCores, &h.TotalMemory, &h.FreeMemory, &h.CPUUsage, &osName, &h.NetRXTotal, &h.NetTXTotal, &h.NetRXBytesPerSec, &h.NetTXBytesPerSec); err != nil {
			return nil, err
		}
		h.OSName = osName.String
		hosts = append(hosts, h)
	}
	return hosts, nil
}
