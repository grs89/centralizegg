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
	Disks          string    `json:"disks"` // JSON array of detailed disk stats
	CPUUsage       float64   `json:"cpu_usage"`
	OSName         string    `json:"os_name"`
	HostID         int64     `json:"host_id"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type Host struct {
	ID               int64   `json:"id"`
	ServerID         int64   `json:"server_id"`
	Hostname         string  `json:"hostname"`
	ServerName       string  `json:"server_name"`
	IPAddress        string  `json:"ip_address"`
	PublicIP         string  `json:"public_ip"`
	DNSServers       string  `json:"dns_servers"`
	Uptime           string  `json:"uptime"`
	UpdateStatus     string  `json:"update_status"`
	Temperature      float64 `json:"temperature"`
	Disks            string  `json:"disks"`
	CPUModel         string  `json:"cpu_model"`
	CPUCores         int     `json:"cpu_cores"`
	TotalMemory      uint64  `json:"total_memory"`
	FreeMemory       uint64  `json:"free_memory"`
	CPUUsage         float64 `json:"cpu_usage"`
	OSName           string  `json:"os_name"`
	BridgeInterfaces string  `json:"bridge_interfaces"`
	OOMEvents        string  `json:"oom_events"`
}

type DockerHost struct {
	ID            int64   `json:"id"`
	ServerID      int64   `json:"server_id"`
	Hostname      string  `json:"hostname"`
	ServerName    string  `json:"server_name"`
	IPAddress     string  `json:"ip_address"`
	PublicIP      string  `json:"public_ip"`
	DNSServers    string  `json:"dns_servers"`
	Uptime        string  `json:"uptime"`
	UpdateStatus  string  `json:"update_status"`
	Temperature   float64 `json:"temperature"`
	Disks         string  `json:"disks"`
	CPUModel      string  `json:"cpu_model"`
	CPUCores      int     `json:"cpu_cores"`
	TotalMemory   uint64  `json:"total_memory"`
	FreeMemory    uint64  `json:"free_memory"`
	CPUUsage      float64 `json:"cpu_usage"`
	OSName        string  `json:"os_name"`
	DockerVer     string  `json:"docker_version"`
	ServiceStatus string  `json:"docker_service_status"`
	SocketStatus  string  `json:"docker_socket_status"`
	APILatency    int     `json:"docker_api_latency"`
	StorageUsed   uint64  `json:"docker_storage_used"`
	StorageTotal  uint64  `json:"docker_storage_total"`
	InodesUsage   string  `json:"docker_inodes_usage"`
	LogsSize      uint64  `json:"docker_logs_size"`
}

type Container struct {
	ID              int64     `json:"id"`
	Name            string    `json:"name"`
	Image           string    `json:"image"`
	Ports           string    `json:"ports"`
	State           string    `json:"state"`
	Status          string    `json:"status"`
	CPUUsage        float64   `json:"cpu_usage"`
	MemUsage        uint64    `json:"memory_usage"`
	MemLimit        uint64    `json:"memory_limit"`
	NetRX           uint64    `json:"net_rx"`
	NetTX           uint64    `json:"net_tx"`
	BlockIn         uint64    `json:"block_in"`
	BlockOut        uint64    `json:"block_out"`
	PIDs            int       `json:"pids"`
	IPAddress       string    `json:"ip_address"`
	OOMKilled       bool      `json:"oom_killed"`
	Vulnerabilities string    `json:"vulnerabilities"`
	HostID          int64     `json:"host_id"`
	UpdatedAt       time.Time `json:"updated_at"`
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

	// Run migrations
	ensureSchema(db)

	// Migration: Ensure ip_address column exists in firewall.interfaces
	_, _ = db.Exec("ALTER TABLE firewall.interfaces ADD COLUMN IF NOT EXISTS ip_address VARCHAR(255) DEFAULT ''")
	// Verify for tx drop column too if we want, but let's stick to the one causing issue.
	_, _ = db.Exec("ALTER TABLE firewall.interfaces ADD COLUMN IF NOT EXISTS net_tx_dropped BIGINT DEFAULT 0")

	// Migration: Ensure uptime and update_status in firewall.hosts
	_, _ = db.Exec("ALTER TABLE firewall.hosts ADD COLUMN IF NOT EXISTS uptime VARCHAR(255) DEFAULT 'Unknown'")
	_, _ = db.Exec("ALTER TABLE firewall.hosts ADD COLUMN IF NOT EXISTS update_status VARCHAR(255) DEFAULT 'Unknown'")
	_, _ = db.Exec("ALTER TABLE firewall.hosts ADD COLUMN IF NOT EXISTS dns_servers TEXT DEFAULT ''")
	_, _ = db.Exec("ALTER TABLE firewall.hosts ADD COLUMN IF NOT EXISTS active_connections TEXT DEFAULT '[]'")
	_, _ = db.Exec("ALTER TABLE firewall.hosts ADD COLUMN IF NOT EXISTS state_table_size BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE firewall.hosts ADD COLUMN IF NOT EXISTS state_table_limit BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE firewall.hosts ADD COLUMN IF NOT EXISTS temperature INTEGER DEFAULT 0")

	return &DB{Conn: db}, nil
}

func ensureSchema(db *sql.DB) {
	schemas := []string{"virtualization", "firewall", "storage", "containers"}
	for _, s := range schemas {
		_, _ = db.Exec(fmt.Sprintf("CREATE SCHEMA IF NOT EXISTS %s", s))
	}

	queries := []string{
		// Firewall Tables
		`CREATE TABLE IF NOT EXISTS firewall.pfsense_servers (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			ip_address VARCHAR(255) NOT NULL,
			ssh_port INT DEFAULT 22,
			username VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'unknown',
			password VARCHAR(255),
			ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS firewall.hosts (
			id SERIAL PRIMARY KEY,
			server_id INT REFERENCES firewall.pfsense_servers(id) ON DELETE CASCADE,
			hostname VARCHAR(255) NOT NULL,
			cpu_model VARCHAR(255),
			cpu_cores INT,
			total_memory BIGINT,
			free_memory BIGINT DEFAULT 0,
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			os_name VARCHAR(255),
			net_rx_total BIGINT DEFAULT 0,
			net_tx_total BIGINT DEFAULT 0,
			net_rx_bytes_per_sec BIGINT DEFAULT 0,
			net_rx_bytes_per_sec BIGINT DEFAULT 0,
			net_tx_bytes_per_sec BIGINT DEFAULT 0,
			state_table_size BIGINT DEFAULT 0,
			state_table_limit BIGINT DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS firewall.interfaces (
			id SERIAL PRIMARY KEY,
			host_id INT REFERENCES firewall.hosts(id) ON DELETE CASCADE,
			interface_name VARCHAR(255) NOT NULL,
			interface_type VARCHAR(50),
			status VARCHAR(50),
			net_rx_bytes BIGINT DEFAULT 0,
			net_tx_bytes BIGINT DEFAULT 0,
			net_rx_packets BIGINT DEFAULT 0,
			net_tx_packets BIGINT DEFAULT 0,
			net_rx_errors BIGINT DEFAULT 0,
			net_tx_errors BIGINT DEFAULT 0,
			net_rx_dropped BIGINT DEFAULT 0,
			net_tx_dropped BIGINT DEFAULT 0,
			ip_address VARCHAR(255) DEFAULT '',
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(host_id, interface_name)
		)`,
		`CREATE TABLE IF NOT EXISTS firewall.gateways (
			id SERIAL PRIMARY KEY,
			host_id INTEGER REFERENCES firewall.hosts(id) ON DELETE CASCADE,
			name VARCHAR(255) NOT NULL,
			monitor_ip VARCHAR(255),
			source_ip VARCHAR(255),
			delay VARCHAR(50),
			stddev VARCHAR(50),
			loss VARCHAR(50),
			status VARCHAR(50),
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(host_id, name)
		)`,
		// Generic Server Tables
		`CREATE TABLE IF NOT EXISTS virtualization.proxmox_servers (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			ip_address VARCHAR(255) NOT NULL,
			ssh_port INT DEFAULT 22,
			username VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'unknown',
			password VARCHAR(255),
			ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS storage.nas_servers (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			ip_address VARCHAR(255) NOT NULL,
			ssh_port INT DEFAULT 22,
			username VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'unknown',
			password VARCHAR(255),
			ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS storage.ceph_servers (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			ip_address VARCHAR(255) NOT NULL,
			ssh_port INT DEFAULT 22,
			username VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'unknown',
			password VARCHAR(255),
			ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS containers.docker_servers (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			ip_address VARCHAR(255) NOT NULL,
			ssh_port INT DEFAULT 22,
			username VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'unknown',
			password VARCHAR(255),
			ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS containers.podman_servers (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			ip_address VARCHAR(255) NOT NULL,
			ssh_port INT DEFAULT 22,
			username VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'unknown',
			password VARCHAR(255),
			ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,

		// KVM extra columns if missing (from previous code)
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS os_name VARCHAR(255)",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS free_memory BIGINT DEFAULT 0",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0",
		"ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0",
		"ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS disk_allocation BIGINT DEFAULT 0",
		"ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS disk_capacity BIGINT DEFAULT 0",
		"ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS guest_ips TEXT DEFAULT ''",
		"ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS guest_ips TEXT DEFAULT ''",
		"ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS guest_fs_usage TEXT DEFAULT ''",
		"ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS disks TEXT DEFAULT '[]'",
		"ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS os_name VARCHAR(255) DEFAULT ''",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS public_ip VARCHAR(255) DEFAULT ''",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS dns_servers TEXT DEFAULT ''",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS uptime VARCHAR(255) DEFAULT ''",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS update_status VARCHAR(50) DEFAULT 'Unknown'",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS temperature DOUBLE PRECISION DEFAULT 0",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS disks TEXT DEFAULT '[]'",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS bridge_interfaces TEXT DEFAULT '[]'",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS oom_events TEXT DEFAULT '[]'",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_service_status VARCHAR(50) DEFAULT 'unknown'",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_socket_status VARCHAR(50) DEFAULT 'unknown'",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_api_latency INT DEFAULT 0",
		"ALTER TABLE containers.containers ADD COLUMN IF NOT EXISTS oom_killed BOOLEAN DEFAULT FALSE",

		// Docker Tables
		`CREATE TABLE IF NOT EXISTS containers.hosts (
			id SERIAL PRIMARY KEY,
			server_id INT REFERENCES containers.docker_servers(id) ON DELETE CASCADE,
			hostname VARCHAR(255) NOT NULL,
			cpu_model VARCHAR(255),
			cpu_cores INT,
			total_memory BIGINT,
			free_memory BIGINT DEFAULT 0,
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			os_name VARCHAR(255),
			public_ip VARCHAR(255) DEFAULT '',
			dns_servers TEXT DEFAULT '',
			uptime VARCHAR(255) DEFAULT '',
			update_status VARCHAR(50) DEFAULT 'Unknown',
			temperature DOUBLE PRECISION DEFAULT 0,
			disks TEXT DEFAULT '[]',
			docker_version VARCHAR(255) DEFAULT '',
			docker_service_status VARCHAR(50) DEFAULT 'unknown',
			docker_socket_status VARCHAR(50) DEFAULT 'unknown',
			docker_api_latency INT DEFAULT 0,
			docker_storage_used BIGINT DEFAULT 0,
			docker_storage_total BIGINT DEFAULT 0,
			docker_inodes_usage VARCHAR(255) DEFAULT '',
			docker_logs_size BIGINT DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_storage_used BIGINT DEFAULT 0",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_storage_total BIGINT DEFAULT 0",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_inodes_usage VARCHAR(255) DEFAULT ''",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_logs_size BIGINT DEFAULT 0",
		"ALTER TABLE containers.hosts ALTER COLUMN docker_inodes_usage TYPE VARCHAR(255)",
		`CREATE TABLE IF NOT EXISTS containers.containers (
			id SERIAL PRIMARY KEY,
			host_id INT REFERENCES containers.hosts(id) ON DELETE CASCADE,
			name VARCHAR(255) NOT NULL,
			image VARCHAR(255) NOT NULL,
			ports VARCHAR(255) DEFAULT '',
			state VARCHAR(50) DEFAULT 'unknown',
			status VARCHAR(255) DEFAULT '',
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			memory_usage BIGINT DEFAULT 0,
			memory_limit BIGINT DEFAULT 0,
			net_rx BIGINT DEFAULT 0,
			net_tx BIGINT DEFAULT 0,
			block_in BIGINT DEFAULT 0,
			block_out BIGINT DEFAULT 0,
			pids INT DEFAULT 0,
			ip_address VARCHAR(255) DEFAULT '',
			oom_killed BOOLEAN DEFAULT FALSE,
			vulnerabilities TEXT DEFAULT '',
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(host_id, name)
		)`,
		"ALTER TABLE containers.containers ADD COLUMN IF NOT EXISTS ports VARCHAR(255) DEFAULT ''",
		"ALTER TABLE containers.containers ADD COLUMN IF NOT EXISTS vulnerabilities TEXT DEFAULT ''",
	}

	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			log.Printf("Migration warning (query: %s): %v", q, err)
		}
	}
}

func (d *DB) UpsertHost(h Host) (int64, error) {
	var id int64
	// Check by ServerID mainly, assuming 1 host per server config
	err := d.Conn.QueryRow("SELECT id FROM virtualization.hosts WHERE server_id = $1", h.ServerID).Scan(&id)
	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO virtualization.hosts (server_id, hostname, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name, public_ip, dns_servers, uptime, update_status, temperature, disks, bridge_interfaces, oom_events)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
			h.ServerID, h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.PublicIP, h.DNSServers, h.Uptime, h.UpdateStatus, h.Temperature, h.Disks, h.BridgeInterfaces, h.OOMEvents).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`UPDATE virtualization.hosts SET hostname=$1, cpu_model=$2, cpu_cores=$3, total_memory=$4, free_memory=$5, cpu_usage=$6, os_name=$7, public_ip=$8, dns_servers=$9, uptime=$10, update_status=$11, temperature=$12, disks=$13, bridge_interfaces=$14, oom_events=$15 WHERE id=$16`,
			h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.PublicIP, h.DNSServers, h.Uptime, h.UpdateStatus, h.Temperature, h.Disks, h.BridgeInterfaces, h.OOMEvents, id)
	}
	return id, err
}

func (d *DB) UpsertVM(vm VM) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM virtualization.vms WHERE name = $1 AND host_id = $2", vm.Name, vm.HostID).Scan(&id)

	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO virtualization.vms (name, state, vcpu, cpu_time, cpu_usage, memory_usage, max_memory, disk_allocation, disk_capacity, disk_read, disk_write, net_rx, net_tx, guest_ips, guest_fs_usage, disks, os_name, host_id, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())`,
			vm.Name, vm.State, vm.VCPU, vm.CPUTime, vm.CPUUsage, vm.MemoryUsage, vm.MaxMemory, vm.DiskAllocation, vm.DiskCapacity, vm.DiskRead, vm.DiskWrite, vm.NetRX, vm.NetTX, vm.GuestIPs, vm.GuestFSUsage, vm.Disks, vm.OSName, vm.HostID)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE virtualization.vms SET state=$1, vcpu=$2, cpu_time=$3, cpu_usage=$4, memory_usage=$5, max_memory=$6, disk_allocation=$7, disk_capacity=$8, disk_read=$9, disk_write=$10, net_rx=$11, net_tx=$12, guest_ips=$13, guest_fs_usage=$14, disks=$15, os_name=$16, updated_at=NOW()
			WHERE id=$17`,
			vm.State, vm.VCPU, vm.CPUTime, vm.CPUUsage, vm.MemoryUsage, vm.MaxMemory, vm.DiskAllocation, vm.DiskCapacity, vm.DiskRead, vm.DiskWrite, vm.NetRX, vm.NetTX, vm.GuestIPs, vm.GuestFSUsage, vm.Disks, vm.OSName, id)
	}
	return err
}

func (d *DB) GetAllVMs() ([]VM, error) {
	rows, err := d.Conn.Query("SELECT id, name, state, vcpu, cpu_time, cpu_usage, memory_usage, max_memory, disk_allocation, disk_capacity, disk_read, disk_write, net_rx, net_tx, guest_ips, guest_fs_usage, disks, os_name, host_id, updated_at FROM virtualization.vms")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vms []VM
	for rows.Next() {
		var vm VM
		if err := rows.Scan(&vm.ID, &vm.Name, &vm.State, &vm.VCPU, &vm.CPUTime, &vm.CPUUsage, &vm.MemoryUsage, &vm.MaxMemory, &vm.DiskAllocation, &vm.DiskCapacity, &vm.DiskRead, &vm.DiskWrite, &vm.NetRX, &vm.NetTX, &vm.GuestIPs, &vm.GuestFSUsage, &vm.Disks, &vm.OSName, &vm.HostID, &vm.UpdatedAt); err != nil {
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
		SELECT h.id, h.server_id, h.hostname, s.name, s.ip_address, h.public_ip, h.dns_servers, h.uptime, h.update_status, h.temperature, h.disks, h.bridge_interfaces, h.oom_events, h.cpu_model, h.cpu_cores, h.total_memory, h.free_memory, h.cpu_usage, h.os_name
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
		if err := rows.Scan(&h.ID, &h.ServerID, &h.Hostname, &h.ServerName, &h.IPAddress, &h.PublicIP, &h.DNSServers, &h.Uptime, &h.UpdateStatus, &h.Temperature, &h.Disks, &h.BridgeInterfaces, &h.OOMEvents, &h.CPUModel, &h.CPUCores, &h.TotalMemory, &h.FreeMemory, &h.CPUUsage, &osName); err != nil {
			return nil, err
		}
		h.OSName = osName.String
		hosts = append(hosts, h)
	}
	return hosts, nil
}

// PFSense types and functions
type PFSenseServer struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	IPAddress  string `json:"ip_address"`
	SSHPort    int    `json:"ssh_port"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	SSHKeyPath string `json:"ssh_key_path"`
	Status     string `json:"status"`
}

type FirewallHost struct {
	ID                int64               `json:"id"`
	ServerID          int64               `json:"server_id"`
	Hostname          string              `json:"hostname"`
	ServerName        string              `json:"server_name"`
	IPAddress         string              `json:"ip_address"`
	CPUModel          string              `json:"cpu_model"`
	CPUCores          int                 `json:"cpu_cores"`
	TotalMemory       uint64              `json:"total_memory"`
	FreeMemory        uint64              `json:"free_memory"`
	CPUUsage          float64             `json:"cpu_usage"`
	OSName            string              `json:"os_name"`
	NetRXTotal        uint64              `json:"net_rx_total"`
	NetTXTotal        uint64              `json:"net_tx_total"`
	NetRXBytesPerSec  uint64              `json:"net_rx_bytes_per_sec"`
	NetTXBytesPerSec  uint64              `json:"net_tx_bytes_per_sec"`
	Uptime            string              `json:"uptime"`
	UpdateStatus      string              `json:"update_status"`
	StateTableSize    int64               `json:"state_table_size"`
	StateTableLimit   int64               `json:"state_table_limit"`
	Temperature       int                 `json:"temperature"`
	DNSServers        string              `json:"dns_servers"`
	ActiveConnections string              `json:"active_connections"`
	Interfaces        []FirewallInterface `json:"interfaces"`
	Gateways          []FirewallGateway   `json:"gateways"`
}

type FirewallInterface struct {
	ID            int64  `json:"id"`
	HostID        int64  `json:"host_id"`
	InterfaceName string `json:"interface_name"`
	InterfaceType string `json:"interface_type"`
	Status        string `json:"status"`
	MACAddress    string `json:"mac_address"` // Not currently stored but good to have
	IPAddress     string `json:"ip_address"`
	NetRXBytes    uint64 `json:"net_rx_bytes"`
	NetTXBytes    uint64 `json:"net_tx_bytes"`
	NetRXPackets  uint64 `json:"net_rx_packets"`
	NetTXPackets  uint64 `json:"net_tx_packets"`
	NetRXErrors   uint64 `json:"net_rx_errors"`
	NetTXErrors   uint64 `json:"net_tx_errors"`
	NetRXDropped  uint64 `json:"net_rx_dropped"`
	NetTXDropped  uint64 `json:"net_tx_dropped"`
}

type FirewallGateway struct {
	ID        int64  `json:"id"`
	HostID    int64  `json:"host_id"`
	Name      string `json:"name"`
	MonitorIP string `json:"monitor_ip"`
	SourceIP  string `json:"source_ip"`
	Delay     string `json:"delay"`
	StdDev    string `json:"stddev"`
	Loss      string `json:"loss"`
	Status    string `json:"status"`
}

func (d *DB) UpsertFirewallHost(h FirewallHost) (int64, error) {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM firewall.hosts WHERE server_id = $1", h.ServerID).Scan(&id)
	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO firewall.hosts (server_id, hostname, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name, net_rx_total, net_tx_total, net_rx_bytes_per_sec, net_tx_bytes_per_sec, uptime, update_status, dns_servers, active_connections, state_table_size, state_table_limit, temperature)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
			h.ServerID, h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.NetRXTotal, h.NetTXTotal, h.NetRXBytesPerSec, h.NetTXBytesPerSec, h.Uptime, h.UpdateStatus, h.DNSServers, h.ActiveConnections, h.StateTableSize, h.StateTableLimit, h.Temperature).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`UPDATE firewall.hosts SET hostname=$1, cpu_model=$2, cpu_cores=$3, total_memory=$4, free_memory=$5, cpu_usage=$6, os_name=$7, net_rx_total=$8, net_tx_total=$9, net_rx_bytes_per_sec=$10, net_tx_bytes_per_sec=$11, uptime=$12, update_status=$13, dns_servers=$14, active_connections=$15, state_table_size=$16, state_table_limit=$17, temperature=$18 WHERE id=$19`,
			h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.NetRXTotal, h.NetTXTotal, h.NetRXBytesPerSec, h.NetTXBytesPerSec, h.Uptime, h.UpdateStatus, h.DNSServers, h.ActiveConnections, h.StateTableSize, h.StateTableLimit, h.Temperature, id)
	}
	return id, err
}

func (d *DB) UpsertFirewallInterface(iface FirewallInterface) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM firewall.interfaces WHERE host_id = $1 AND interface_name = $2", iface.HostID, iface.InterfaceName).Scan(&id)
	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO firewall.interfaces (host_id, interface_name, interface_type, status, net_rx_bytes, net_tx_bytes, net_rx_packets, net_tx_packets, net_rx_errors, net_tx_errors, net_rx_dropped, net_tx_dropped, ip_address, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
			iface.HostID, iface.InterfaceName, iface.InterfaceType, iface.Status, iface.NetRXBytes, iface.NetTXBytes, iface.NetRXPackets, iface.NetTXPackets, iface.NetRXErrors, iface.NetTXErrors, iface.NetRXDropped, iface.NetTXDropped, iface.IPAddress)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE firewall.interfaces SET interface_type=$1, status=$2, net_rx_bytes=$3, net_tx_bytes=$4, net_rx_packets=$5, net_tx_packets=$6, net_rx_errors=$7, net_tx_errors=$8, net_rx_dropped=$9, net_tx_dropped=$10, ip_address=$11, updated_at=NOW()
			WHERE id=$12`,
			iface.InterfaceType, iface.Status, iface.NetRXBytes, iface.NetTXBytes, iface.NetRXPackets, iface.NetTXPackets, iface.NetRXErrors, iface.NetTXErrors, iface.NetRXDropped, iface.NetTXDropped, iface.IPAddress, id)
	}
	return err
}

func (d *DB) GetPFSenseServers() ([]PFSenseServer, error) {
	rows, err := d.Conn.Query("SELECT id, name, ip_address, ssh_port, username, password, ssh_key_path, status FROM firewall.pfsense_servers")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []PFSenseServer
	for rows.Next() {
		var s PFSenseServer
		var pwd sql.NullString
		// Scan 8 columns
		if err := rows.Scan(&s.ID, &s.Name, &s.IPAddress, &s.SSHPort, &s.Username, &pwd, &s.SSHKeyPath, &s.Status); err != nil {
			return nil, err
		}
		s.Password = pwd.String
		servers = append(servers, s)
	}
	return servers, nil
}

func (d *DB) AddPFSenseServer(s PFSenseServer) (int64, error) {
	var id int64
	// Default key path
	if s.SSHKeyPath == "" {
		s.SSHKeyPath = "/root/.ssh/id_rsa"
	}
	err := d.Conn.QueryRow(`INSERT INTO firewall.pfsense_servers (name, ip_address, ssh_port, username, password, ssh_key_path, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath, "unknown").Scan(&id)
	return id, err
}

func (d *DB) UpdatePFSenseServer(s PFSenseServer) error {
	_, err := d.Conn.Exec(`UPDATE firewall.pfsense_servers SET name=$1, ip_address=$2, ssh_port=$3, username=$4, password=$5, ssh_key_path=$6 WHERE id=$7`,
		s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath, s.ID)
	return err
}

func (d *DB) DeletePFSenseServer(id int64) error {
	_, err := d.Conn.Exec("DELETE FROM firewall.pfsense_servers WHERE id=$1", id)
	return err
}

func (d *DB) SetPFSenseServerStatus(id int64, status string) error {
	_, err := d.Conn.Exec("UPDATE firewall.pfsense_servers SET status=$1 WHERE id=$2", status, id)
	return err
}

func (d *DB) UpsertFirewallGateway(gw FirewallGateway) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM firewall.gateways WHERE host_id = $1 AND name = $2", gw.HostID, gw.Name).Scan(&id)
	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO firewall.gateways (host_id, name, monitor_ip, source_ip, delay, stddev, loss, status, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
			gw.HostID, gw.Name, gw.MonitorIP, gw.SourceIP, gw.Delay, gw.StdDev, gw.Loss, gw.Status)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE firewall.gateways SET monitor_ip=$1, source_ip=$2, delay=$3, stddev=$4, loss=$5, status=$6, updated_at=NOW()
			WHERE id=$7`,
			gw.MonitorIP, gw.SourceIP, gw.Delay, gw.StdDev, gw.Loss, gw.Status, id)
	}
	return err
}

func (d *DB) GetFirewallHosts() ([]FirewallHost, error) { // Fetch Hosts
	rows, err := d.Conn.Query(`
		SELECT fh.id, fh.server_id, fh.hostname, s.name, s.ip_address, fh.cpu_model, fh.cpu_cores, fh.total_memory, fh.free_memory, fh.cpu_usage, fh.os_name, fh.net_rx_total, fh.net_tx_total, fh.net_rx_bytes_per_sec, fh.net_tx_bytes_per_sec, fh.uptime, fh.update_status, COALESCE(fh.dns_servers, ''), COALESCE(fh.active_connections, '[]'), COALESCE(fh.state_table_size, 0), COALESCE(fh.state_table_limit, 0), COALESCE(fh.temperature, 0)
		FROM firewall.hosts fh
		JOIN firewall.pfsense_servers s ON fh.server_id = s.id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []FirewallHost
	for rows.Next() {
		var h FirewallHost
		if err := rows.Scan(&h.ID, &h.ServerID, &h.Hostname, &h.ServerName, &h.IPAddress, &h.CPUModel, &h.CPUCores, &h.TotalMemory, &h.FreeMemory, &h.CPUUsage, &h.OSName, &h.NetRXTotal, &h.NetTXTotal, &h.NetRXBytesPerSec, &h.NetTXBytesPerSec, &h.Uptime, &h.UpdateStatus, &h.DNSServers, &h.ActiveConnections, &h.StateTableSize, &h.StateTableLimit, &h.Temperature); err != nil {
			return nil, err
		}

		// Fetch Interfaces
		ifacesRows, err := d.Conn.Query(`SELECT id, host_id, interface_name, interface_type, status, net_rx_bytes, net_tx_bytes, ip_address, net_rx_errors, net_tx_errors, net_rx_dropped, net_tx_dropped FROM firewall.interfaces WHERE host_id = $1 ORDER BY interface_name ASC`, h.ID)
		if err == nil {
			var ifaces []FirewallInterface
			for ifacesRows.Next() {
				var iface FirewallInterface
				var ipAddr sql.NullString
				// Scan all columns
				if err := ifacesRows.Scan(&iface.ID, &iface.HostID, &iface.InterfaceName, &iface.InterfaceType, &iface.Status, &iface.NetRXBytes, &iface.NetTXBytes, &ipAddr, &iface.NetRXErrors, &iface.NetTXErrors, &iface.NetRXDropped, &iface.NetTXDropped); err == nil {
					iface.IPAddress = ipAddr.String
					ifaces = append(ifaces, iface)
				}
			}
			ifacesRows.Close()
			h.Interfaces = ifaces
		}

		// Fetch Gateways
		gwRows, err := d.Conn.Query(`SELECT id, host_id, name, monitor_ip, source_ip, delay, stddev, loss, status FROM firewall.gateways WHERE host_id = $1 ORDER BY name ASC`, h.ID)
		if err == nil {
			var gws []FirewallGateway
			for gwRows.Next() {
				var gw FirewallGateway
				// Handle potential nulls if needed, but table def doesn't have defaults for all.
				// Assuming string fields are text/varchar.
				if err := gwRows.Scan(&gw.ID, &gw.HostID, &gw.Name, &gw.MonitorIP, &gw.SourceIP, &gw.Delay, &gw.StdDev, &gw.Loss, &gw.Status); err == nil {
					gws = append(gws, gw)
				}
			}
			gwRows.Close()
			h.Gateways = gws
		}

		hosts = append(hosts, h)
	}
	return hosts, nil
}

// GenericServer is used for Proxmox, NAS, Ceph, Docker, Podman servers (same structure as KVMServer)
type GenericServer struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	IPAddress  string `json:"ip_address"`
	SSHPort    int    `json:"ssh_port"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	SSHKeyPath string `json:"ssh_key_path"`
	Status     string `json:"status"`
}

// Table names for each server type
var serverTableMap = map[string]string{
	"proxmox": "virtualization.proxmox_servers",
	"nas":     "storage.nas_servers",
	"ceph":    "storage.ceph_servers",
	"docker":  "containers.docker_servers",
	"podman":  "containers.podman_servers",
}

func (d *DB) GetGenericServers(toolType string) ([]GenericServer, error) {
	table, ok := serverTableMap[toolType]
	if !ok {
		return nil, fmt.Errorf("unknown tool type: %s", toolType)
	}

	query := fmt.Sprintf("SELECT id, name, ip_address, ssh_port, username, password, ssh_key_path, status FROM %s", table)
	rows, err := d.Conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []GenericServer
	for rows.Next() {
		var s GenericServer
		var pwd sql.NullString
		if err := rows.Scan(&s.ID, &s.Name, &s.IPAddress, &s.SSHPort, &s.Username, &pwd, &s.SSHKeyPath, &s.Status); err != nil {
			return nil, err
		}
		s.Password = pwd.String
		servers = append(servers, s)
	}
	return servers, nil
}

func (d *DB) AddGenericServer(toolType string, s GenericServer) (int64, error) {
	table, ok := serverTableMap[toolType]
	if !ok {
		return 0, fmt.Errorf("unknown tool type: %s", toolType)
	}

	if s.SSHPort == 0 {
		s.SSHPort = 22
	}
	if s.SSHKeyPath == "" {
		s.SSHKeyPath = "/root/.ssh/id_rsa"
	}

	var id int64
	query := fmt.Sprintf(`INSERT INTO %s (name, ip_address, ssh_port, username, password, ssh_key_path) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, table)
	err := d.Conn.QueryRow(query, s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath).Scan(&id)
	return id, err
}

func (d *DB) UpdateGenericServer(toolType string, s GenericServer) error {
	table, ok := serverTableMap[toolType]
	if !ok {
		return fmt.Errorf("unknown tool type: %s", toolType)
	}

	if s.SSHPort == 0 {
		s.SSHPort = 22
	}

	if s.Password == "" {
		query := fmt.Sprintf(`UPDATE %s SET name=$1, ip_address=$2, ssh_port=$3, username=$4, ssh_key_path=$5 WHERE id=$6`, table)
		_, err := d.Conn.Exec(query, s.Name, s.IPAddress, s.SSHPort, s.Username, s.SSHKeyPath, s.ID)
		return err
	}
	query := fmt.Sprintf(`UPDATE %s SET name=$1, ip_address=$2, ssh_port=$3, username=$4, password=$5, ssh_key_path=$6 WHERE id=$7`, table)
	_, err := d.Conn.Exec(query, s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath, s.ID)
	return err
}

func (d *DB) DeleteGenericServer(toolType string, id int64) error {
	table, ok := serverTableMap[toolType]
	if !ok {
		return fmt.Errorf("unknown tool type: %s", toolType)
	}

	query := fmt.Sprintf("DELETE FROM %s WHERE id=$1", table)
	_, err := d.Conn.Exec(query, id)
	return err
}

func (d *DB) SetGenericServerStatus(toolType string, id int64, status string) error {
	table, ok := serverTableMap[toolType]
	if !ok {
		return fmt.Errorf("unknown tool type: %s", toolType)
	}

	query := fmt.Sprintf("UPDATE %s SET status=$1 WHERE id=$2", table)
	_, err := d.Conn.Exec(query, status, id)
	return err
}

// Docker specific methods
func (d *DB) UpsertDockerHost(h DockerHost) (int64, error) {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM containers.hosts WHERE server_id = $1", h.ServerID).Scan(&id)
	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO containers.hosts (server_id, hostname, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name, public_ip, dns_servers, uptime, update_status, temperature, disks, docker_version, docker_service_status, docker_socket_status, docker_api_latency, docker_storage_used, docker_storage_total, docker_inodes_usage, docker_logs_size)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING id`,
			h.ServerID, h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.PublicIP, h.DNSServers, h.Uptime, h.UpdateStatus, h.Temperature, h.Disks, h.DockerVer, h.ServiceStatus, h.SocketStatus, h.APILatency, h.StorageUsed, h.StorageTotal, h.InodesUsage, h.LogsSize).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`UPDATE containers.hosts SET hostname=$1, cpu_model=$2, cpu_cores=$3, total_memory=$4, free_memory=$5, cpu_usage=$6, os_name=$7, public_ip=$8, dns_servers=$9, uptime=$10, update_status=$11, temperature=$12, disks=$13, docker_version=$14, docker_service_status=$15, docker_socket_status=$16, docker_api_latency=$17, docker_storage_used=$18, docker_storage_total=$19, docker_inodes_usage=$20, docker_logs_size=$21 WHERE id=$22`,
			h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.PublicIP, h.DNSServers, h.Uptime, h.UpdateStatus, h.Temperature, h.Disks, h.DockerVer, h.ServiceStatus, h.SocketStatus, h.APILatency, h.StorageUsed, h.StorageTotal, h.InodesUsage, h.LogsSize, id)
	}
	return id, err
}

func (d *DB) UpsertContainer(c Container) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM containers.containers WHERE name = $1 AND host_id = $2", c.Name, c.HostID).Scan(&id)

	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO containers.containers (name, image, ports, state, status, cpu_usage, memory_usage, memory_limit, net_rx, net_tx, block_in, block_out, pids, ip_address, oom_killed, vulnerabilities, host_id, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())`,
			c.Name, c.Image, c.Ports, c.State, c.Status, c.CPUUsage, c.MemUsage, c.MemLimit, c.NetRX, c.NetTX, c.BlockIn, c.BlockOut, c.PIDs, c.IPAddress, c.OOMKilled, c.Vulnerabilities, c.HostID)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE containers.containers SET image=$1, ports=$2, state=$3, status=$4, cpu_usage=$5, memory_usage=$6, memory_limit=$7, net_rx=$8, net_tx=$9, block_in=$10, block_out=$11, pids=$12, ip_address=$13, oom_killed=$14, vulnerabilities=$15, updated_at=NOW()
			WHERE id=$16`,
			c.Image, c.Ports, c.State, c.Status, c.CPUUsage, c.MemUsage, c.MemLimit, c.NetRX, c.NetTX, c.BlockIn, c.BlockOut, c.PIDs, c.IPAddress, c.OOMKilled, c.Vulnerabilities, id)
	}
	return err
}

func (d *DB) GetDockerHosts() ([]DockerHost, error) {
	rows, err := d.Conn.Query(`
		SELECT h.id, h.server_id, h.hostname, h.cpu_model, h.cpu_cores, h.total_memory, h.free_memory, h.cpu_usage, h.os_name, h.public_ip, h.dns_servers, h.uptime, h.update_status, h.temperature, h.disks, h.docker_version, h.docker_service_status, h.docker_socket_status, h.docker_api_latency, h.docker_storage_used, h.docker_storage_total, h.docker_inodes_usage, h.docker_logs_size, ds.name, ds.ip_address
		FROM containers.hosts h
		JOIN containers.docker_servers ds ON h.server_id = ds.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []DockerHost
	for rows.Next() {
		var h DockerHost
		if err := rows.Scan(&h.ID, &h.ServerID, &h.Hostname, &h.CPUModel, &h.CPUCores, &h.TotalMemory, &h.FreeMemory, &h.CPUUsage, &h.OSName, &h.PublicIP, &h.DNSServers, &h.Uptime, &h.UpdateStatus, &h.Temperature, &h.Disks, &h.DockerVer, &h.ServiceStatus, &h.SocketStatus, &h.APILatency, &h.StorageUsed, &h.StorageTotal, &h.InodesUsage, &h.LogsSize, &h.ServerName, &h.IPAddress); err != nil {
			return nil, err
		}
		hosts = append(hosts, h)
	}
	return hosts, nil
}

func (d *DB) GetAllContainers() ([]Container, error) {
	rows, err := d.Conn.Query("SELECT id, name, image, ports, state, status, cpu_usage, memory_usage, memory_limit, net_rx, net_tx, block_in, block_out, pids, ip_address, oom_killed, vulnerabilities, host_id, updated_at FROM containers.containers")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var containers []Container
	for rows.Next() {
		var c Container
		if err := rows.Scan(&c.ID, &c.Name, &c.Image, &c.Ports, &c.State, &c.Status, &c.CPUUsage, &c.MemUsage, &c.MemLimit, &c.NetRX, &c.NetTX, &c.BlockIn, &c.BlockOut, &c.PIDs, &c.IPAddress, &c.OOMKilled, &c.Vulnerabilities, &c.HostID, &c.UpdatedAt); err != nil {
			return nil, err
		}
		containers = append(containers, c)
	}
	return containers, nil
}
