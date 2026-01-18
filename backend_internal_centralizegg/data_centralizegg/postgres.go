package data_centralizegg

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	pq "github.com/lib/pq"
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
	Status        string  `json:"status"` // server connection status
	DockerVer     string  `json:"docker_version"`
	ServiceStatus string  `json:"docker_service_status"`
	SocketStatus  string  `json:"docker_socket_status"`
	APILatency    int     `json:"docker_api_latency"`
	StorageUsed   uint64  `json:"docker_storage_used"`
	StorageTotal  uint64  `json:"docker_storage_total"`
	InodesUsage   string  `json:"docker_inodes_usage"`
	LogsSize      uint64  `json:"docker_logs_size"`
	Volumes       string  `json:"docker_volumes"`
	Networks      string  `json:"docker_networks"`
	GPUInfo       string  `json:"gpu_info"`
}

type PodmanHost struct {
	ID             int64   `json:"id"`
	ServerID       int64   `json:"server_id"`
	Hostname       string  `json:"hostname"`
	ServerName     string  `json:"server_name"`
	IPAddress      string  `json:"ip_address"`
	PublicIP       string  `json:"public_ip"`
	DNSServers     string  `json:"dns_servers"`
	Uptime         string  `json:"uptime"`
	UpdateStatus   string  `json:"update_status"`
	Temperature    float64 `json:"temperature"`
	Disks          string  `json:"disks"`
	CPUModel       string  `json:"cpu_model"`
	CPUCores       int     `json:"cpu_cores"`
	TotalMemory    uint64  `json:"total_memory"`
	FreeMemory     uint64  `json:"free_memory"`
	CPUUsage       float64 `json:"cpu_usage"`
	OSName         string  `json:"os_name"`
	Status         string  `json:"status"` // server connection status
	PodmanVer      string  `json:"podman_version"`
	ServiceStatus  string  `json:"podman_service_status"`
	APILatency     int     `json:"podman_api_latency"`
	StorageUsed    uint64  `json:"podman_storage_used"`
	StorageTotal   uint64  `json:"podman_storage_total"`
	InodesUsage    string  `json:"podman_inodes_usage"`
	Volumes        string  `json:"podman_volumes"`
	PodmanNetworks string  `json:"podman_networks"`
	GPUInfo        string  `json:"gpu_info"`
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

type KubernetesNode struct {
	ID               int64   `json:"id"`
	ServerID         int64   `json:"server_id"`
	Hostname         string  `json:"hostname"`
	ServerName       string  `json:"server_name"`
	IPAddress        string  `json:"ip_address"`
	Status           string  `json:"status"` // server connection status
	Roles            string  `json:"roles"`
	Version          string  `json:"version"`
	CPUModel         string  `json:"cpu_model"`
	CPUCores         int     `json:"cpu_cores"`
	TotalMemory      uint64  `json:"total_memory"`
	FreeMemory       uint64  `json:"free_memory"`
	CPUUsage         float64 `json:"cpu_usage"`
	OSName           string  `json:"os_name"`
	KernelVer        string  `json:"kernel_version"`
	ContainerRuntime string  `json:"container_runtime"`
	PodsCount        int     `json:"pods_count"`
	DiskTotal        uint64  `json:"disk_total"`
	DiskUsed         uint64  `json:"disk_used"`
	NetRX            uint64  `json:"net_rx"`
	NetTX            uint64  `json:"net_tx"`
	NetRXRate        uint64  `json:"net_rx_rate"`
	NetTXRate        uint64  `json:"net_tx_rate"`
}

type KubernetesPod struct {
	ID        int64     `json:"id"`
	NodeID    int64     `json:"node_id"`
	Name      string    `json:"name"`
	Namespace string    `json:"namespace"`
	State     string    `json:"state"`
	Status    string    `json:"status"`
	CPUUsage  float64   `json:"cpu_usage"`
	MemUsage  uint64    `json:"memory_usage"`
	IPAddress string    `json:"ip_address"`
	Restarts  int       `json:"restarts"`
	Age       string    `json:"age"`
	UpdatedAt time.Time `json:"updated_at"`
	Image     string    `json:"image"`
	Ports     string    `json:"ports"`
	NetRX     uint64    `json:"net_rx"`
	NetTX     uint64    `json:"net_tx"`
}

type KubernetesPV struct {
	ID           int64     `json:"id"`
	ServerID     int64     `json:"server_id"`
	Name         string    `json:"name"`
	Capacity     uint64    `json:"capacity"`
	Usage        uint64    `json:"usage"`
	Status       string    `json:"status"`
	PVCName      string    `json:"pvc_name"`
	PVCNamespace string    `json:"pvc_namespace"`
	StorageClass string    `json:"storage_class"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type KubernetesEvent struct {
	ID         int64     `json:"id"`
	ServerID   int64     `json:"server_id"`
	Type       string    `json:"type"` // Normal, Warning, Error
	Reason     string    `json:"reason"`
	Message    string    `json:"message"`
	ObjectKind string    `json:"object_kind"` // Pod, Node, Deployment, etc.
	ObjectName string    `json:"object_name"`
	Namespace  string    `json:"namespace"`
	Count      int       `json:"count"`
	FirstSeen  time.Time `json:"first_seen"`
	LastSeen   time.Time `json:"last_seen"`
}

type ProxmoxHost struct {
	ID          int64   `json:"id"`
	ServerID    int64   `json:"server_id"`
	Hostname    string  `json:"hostname"`
	ServerName  string  `json:"server_name"`
	IPAddress   string  `json:"ip_address"`
	Status      string  `json:"status"` // server connection status
	CPUModel    string  `json:"cpu_model"`
	CPUCores    int     `json:"cpu_cores"`
	TotalMemory uint64  `json:"total_memory"`
	FreeMemory  uint64  `json:"free_memory"`
	CPUUsage    float64 `json:"cpu_usage"`
	OSName      string  `json:"os_name"`
	KernelVer   string  `json:"kernel_version"`
	PVEVersion  string  `json:"pve_version"`
	Uptime      string  `json:"uptime"`
	VMsCount    int     `json:"vms_count"`
	Containers  int     `json:"containers_count"`
}

type ProxmoxVM struct {
	ID          int64     `json:"id"`
	HostID      int64     `json:"host_id"`
	VMID        int       `json:"vmid"`
	Name        string    `json:"name"`
	Type        string    `json:"type"` // qemu, lxc
	State       string    `json:"state"`
	CPUUsage    float64   `json:"cpu_usage"`
	MemoryUsage uint64    `json:"memory_usage"`
	MaxMemory   uint64    `json:"max_memory"`
	NetRX       uint64    `json:"net_rx"`
	NetTX       uint64    `json:"net_tx"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type NasHost struct {
	ID          int64   `json:"id"`
	ServerID    int64   `json:"server_id"`
	Hostname    string  `json:"hostname"`
	ServerName  string  `json:"server_name"`
	IPAddress   string  `json:"ip_address"`
	Status      string  `json:"status"` // server connection status
	CPUModel    string  `json:"cpu_model"`
	CPUCores    int     `json:"cpu_cores"`
	TotalMemory uint64  `json:"total_memory"`
	FreeMemory  uint64  `json:"free_memory"`
	CPUUsage    float64 `json:"cpu_usage"`
	OSName      string  `json:"os_name"`
	KernelVer   string  `json:"kernel_version"`
	Uptime      string  `json:"uptime"`
	Model       string  `json:"model"`
	Serial      string  `json:"serial"`
}

type NasVolume struct {
	ID        int64     `json:"id"`
	HostID    int64     `json:"host_id"`
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Status    string    `json:"status"`
	TotalSize uint64    `json:"total_size"`
	UsedSize  uint64    `json:"used_size"`
	Type      string    `json:"type"`
	UpdatedAt time.Time `json:"updated_at"`
}

type NasDisk struct {
	ID        int64     `json:"id"`
	HostID    int64     `json:"host_id"`
	Name      string    `json:"name"`
	Model     string    `json:"model"`
	Serial    string    `json:"serial"`
	Size      uint64    `json:"size"`
	Status    string    `json:"status"`
	Temp      int       `json:"temp"`
	UpdatedAt time.Time `json:"updated_at"`
}

type KVMServer struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	IPAddress     string `json:"ip_address"`
	SSHPort       int    `json:"ssh_port"`
	Username      string `json:"username"`
	Password      string `json:"password"`
	SSHKeyPath    string `json:"ssh_key_path"`
	SSHKeyContent string `json:"ssh_key_content"`
	Status        string `json:"status"` // online, offline, unknown
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

	// Migration: Generic servers kubeconfig & ssh key content support
	genericTables := []string{
		"virtualization.kvm_servers",
		"virtualization.proxmox_servers",
		"storage.nas_servers",
		"storage.ceph_servers",
		"containers.docker_servers",
		"containers.podman_servers",
		"kubernetes.kubernetes_servers",
		"firewall.pfsense_servers",
	}

	// Migration: Add metrics columns to kubernetes.nodes
	_, _ = db.Exec("ALTER TABLE kubernetes.nodes ADD COLUMN IF NOT EXISTS disk_total BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE kubernetes.nodes ADD COLUMN IF NOT EXISTS disk_used BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE kubernetes.nodes ADD COLUMN IF NOT EXISTS net_rx BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE kubernetes.nodes ADD COLUMN IF NOT EXISTS net_tx BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE kubernetes.nodes ADD COLUMN IF NOT EXISTS net_rx_rate BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE kubernetes.nodes ADD COLUMN IF NOT EXISTS net_tx_rate BIGINT DEFAULT 0")

	// Pod Metrics
	_, _ = db.Exec("ALTER TABLE kubernetes.pods ADD COLUMN IF NOT EXISTS image TEXT DEFAULT ''")
	_, _ = db.Exec("ALTER TABLE kubernetes.pods ADD COLUMN IF NOT EXISTS ports TEXT DEFAULT ''")
	_, _ = db.Exec("ALTER TABLE kubernetes.pods ADD COLUMN IF NOT EXISTS net_rx BIGINT DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE kubernetes.pods ADD COLUMN IF NOT EXISTS net_tx BIGINT DEFAULT 0")
	for _, t := range genericTables {
		_, _ = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS kubeconfig_path TEXT DEFAULT ''", t))
		_, _ = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS kubeconfig_content TEXT DEFAULT ''", t))
		_, _ = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS ssh_key_content TEXT DEFAULT ''", t))
		_, _ = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0", t))
		_, _ = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS cpu_cores INTEGER DEFAULT 0", t))
		_, _ = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS total_memory BIGINT DEFAULT 0", t))
		_, _ = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS free_memory BIGINT DEFAULT 0", t))
		_, _ = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS storage_used BIGINT DEFAULT 0", t))
		_, _ = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS storage_total BIGINT DEFAULT 0", t))
		_, _ = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS os_name VARCHAR(255) DEFAULT ''", t))
		_, _ = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS cpu_model VARCHAR(255) DEFAULT ''", t))
	}

	return &DB{Conn: db}, nil
}

func ensureSchema(db *sql.DB) {
	schemas := []string{"virtualization", "firewall", "storage", "containers", "kubernetes"}
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
			ssh_key_content TEXT DEFAULT '',
			kubeconfig_path TEXT DEFAULT '',
			kubeconfig_content TEXT DEFAULT '',
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
		// Generic Server Tables (Base)
		`CREATE TABLE IF NOT EXISTS virtualization.proxmox_servers (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			ip_address VARCHAR(255) NOT NULL,
			ssh_port INT DEFAULT 22,
			username VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'unknown',
			password VARCHAR(255),
			ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
			ssh_key_content TEXT DEFAULT '',
			kubeconfig_path TEXT DEFAULT '',
			kubeconfig_content TEXT DEFAULT '',
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			cpu_cores INT DEFAULT 0,
			total_memory BIGINT DEFAULT 0,
			free_memory BIGINT DEFAULT 0,
			storage_used BIGINT DEFAULT 0,
			storage_total BIGINT DEFAULT 0,
			os_name VARCHAR(255) DEFAULT '',
			cpu_model VARCHAR(255) DEFAULT '',
			control_plane_status TEXT DEFAULT '{}',
			resource_counts TEXT DEFAULT '{}',
			network_topology TEXT DEFAULT '{}',
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
			ssh_key_content TEXT DEFAULT '',
			kubeconfig_path TEXT DEFAULT '',
			kubeconfig_content TEXT DEFAULT '',
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			cpu_cores INT DEFAULT 0,
			total_memory BIGINT DEFAULT 0,
			free_memory BIGINT DEFAULT 0,
			storage_used BIGINT DEFAULT 0,
			storage_total BIGINT DEFAULT 0,
			os_name VARCHAR(255) DEFAULT '',
			cpu_model VARCHAR(255) DEFAULT '',
			control_plane_status TEXT DEFAULT '{}',
			resource_counts TEXT DEFAULT '{}',
			network_topology TEXT DEFAULT '{}',
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
			ssh_key_content TEXT DEFAULT '',
			kubeconfig_path TEXT DEFAULT '',
			kubeconfig_content TEXT DEFAULT '',
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			cpu_cores INT DEFAULT 0,
			total_memory BIGINT DEFAULT 0,
			free_memory BIGINT DEFAULT 0,
			storage_used BIGINT DEFAULT 0,
			storage_total BIGINT DEFAULT 0,
			os_name VARCHAR(255) DEFAULT '',
			cpu_model VARCHAR(255) DEFAULT '',
			control_plane_status TEXT DEFAULT '{}',
			resource_counts TEXT DEFAULT '{}',
			network_topology TEXT DEFAULT '{}',
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
			ssh_key_content TEXT DEFAULT '',
			kubeconfig_path TEXT DEFAULT '',
			kubeconfig_content TEXT DEFAULT '',
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			cpu_cores INT DEFAULT 0,
			total_memory BIGINT DEFAULT 0,
			free_memory BIGINT DEFAULT 0,
			storage_used BIGINT DEFAULT 0,
			storage_total BIGINT DEFAULT 0,
			os_name VARCHAR(255) DEFAULT '',
			cpu_model VARCHAR(255) DEFAULT '',
			control_plane_status TEXT DEFAULT '{}',
			resource_counts TEXT DEFAULT '{}',
			network_topology TEXT DEFAULT '{}',
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
			ssh_key_content TEXT DEFAULT '',
			kubeconfig_path TEXT DEFAULT '',
			kubeconfig_content TEXT DEFAULT '',
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			cpu_cores INT DEFAULT 0,
			total_memory BIGINT DEFAULT 0,
			free_memory BIGINT DEFAULT 0,
			storage_used BIGINT DEFAULT 0,
			storage_total BIGINT DEFAULT 0,
			os_name VARCHAR(255) DEFAULT '',
			cpu_model VARCHAR(255) DEFAULT '',
			control_plane_status TEXT DEFAULT '{}',
			resource_counts TEXT DEFAULT '{}',
			network_topology TEXT DEFAULT '{}',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS kubernetes.kubernetes_servers (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			ip_address VARCHAR(255) NOT NULL,
			ssh_port INT DEFAULT 22,
			username VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'unknown',
			password VARCHAR(255),
			ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
			ssh_key_content TEXT DEFAULT '',
			kubeconfig_path TEXT DEFAULT '',
			kubeconfig_content TEXT DEFAULT '',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			network_topology TEXT DEFAULT '{}'
		)`,

		// KVM extra columns if missing (from previous code)
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS os_name VARCHAR(255)",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS free_memory BIGINT DEFAULT 0",
		"ALTER TABLE virtualization.hosts ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0",
		"ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0",
		"ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS disk_allocation BIGINT DEFAULT 0",
		"ALTER TABLE virtualization.vms ADD COLUMN IF NOT EXISTS disk_capacity BIGINT DEFAULT 0",
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
		// SSH Key Content migrations
		"ALTER TABLE virtualization.kvm_servers ADD COLUMN IF NOT EXISTS ssh_key_content TEXT DEFAULT ''",
		"ALTER TABLE firewall.pfsense_servers ADD COLUMN IF NOT EXISTS ssh_key_content TEXT DEFAULT ''",
		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS ssh_key_content TEXT DEFAULT ''",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS ssh_key_content TEXT DEFAULT ''",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS ssh_key_content TEXT DEFAULT ''",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS ssh_key_content TEXT DEFAULT ''",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS ssh_key_content TEXT DEFAULT ''",
		"ALTER TABLE kubernetes.kubernetes_servers ADD COLUMN IF NOT EXISTS ssh_key_content TEXT DEFAULT ''",
		"ALTER TABLE kubernetes.kubernetes_servers ADD COLUMN IF NOT EXISTS kubeconfig_path TEXT DEFAULT ''",
		"ALTER TABLE kubernetes.kubernetes_servers ADD COLUMN IF NOT EXISTS kubeconfig_content TEXT DEFAULT ''",
		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS kubeconfig_path TEXT DEFAULT ''",
		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS kubeconfig_content TEXT DEFAULT ''",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS kubeconfig_path TEXT DEFAULT ''",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS kubeconfig_content TEXT DEFAULT ''",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS kubeconfig_path TEXT DEFAULT ''",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS kubeconfig_content TEXT DEFAULT ''",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS kubeconfig_path TEXT DEFAULT ''",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS kubeconfig_content TEXT DEFAULT ''",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS kubeconfig_path TEXT DEFAULT ''",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS kubeconfig_content TEXT DEFAULT ''",
		"ALTER TABLE kubernetes.nodes ADD COLUMN IF NOT EXISTS ip_address VARCHAR(255) DEFAULT ''",
		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS control_plane_status TEXT DEFAULT '{}'",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS control_plane_status TEXT DEFAULT '{}'",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS control_plane_status TEXT DEFAULT '{}'",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS control_plane_status TEXT DEFAULT '{}'",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS control_plane_status TEXT DEFAULT '{}'",

		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS resource_counts TEXT DEFAULT '{}'",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS resource_counts TEXT DEFAULT '{}'",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS resource_counts TEXT DEFAULT '{}'",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS resource_counts TEXT DEFAULT '{}'",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS resource_counts TEXT DEFAULT '{}'",

		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS network_topology TEXT DEFAULT '{}'",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS network_topology TEXT DEFAULT '{}'",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS network_topology TEXT DEFAULT '{}'",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS network_topology TEXT DEFAULT '{}'",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS network_topology TEXT DEFAULT '{}'",

		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS cpu_usage DOUBLE PRECISION DEFAULT 0",

		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS cpu_cores INT DEFAULT 0",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS cpu_cores INT DEFAULT 0",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS cpu_cores INT DEFAULT 0",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS cpu_cores INT DEFAULT 0",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS cpu_cores INT DEFAULT 0",

		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS total_memory BIGINT DEFAULT 0",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS total_memory BIGINT DEFAULT 0",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS total_memory BIGINT DEFAULT 0",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS total_memory BIGINT DEFAULT 0",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS total_memory BIGINT DEFAULT 0",

		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS free_memory BIGINT DEFAULT 0",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS free_memory BIGINT DEFAULT 0",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS free_memory BIGINT DEFAULT 0",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS free_memory BIGINT DEFAULT 0",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS free_memory BIGINT DEFAULT 0",

		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS storage_used BIGINT DEFAULT 0",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS storage_used BIGINT DEFAULT 0",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS storage_used BIGINT DEFAULT 0",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS storage_used BIGINT DEFAULT 0",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS storage_used BIGINT DEFAULT 0",

		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS storage_total BIGINT DEFAULT 0",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS storage_total BIGINT DEFAULT 0",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS storage_total BIGINT DEFAULT 0",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS storage_total BIGINT DEFAULT 0",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS storage_total BIGINT DEFAULT 0",

		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS os_name VARCHAR(255) DEFAULT ''",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS os_name VARCHAR(255) DEFAULT ''",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS os_name VARCHAR(255) DEFAULT ''",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS os_name VARCHAR(255) DEFAULT ''",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS os_name VARCHAR(255) DEFAULT ''",

		"ALTER TABLE virtualization.proxmox_servers ADD COLUMN IF NOT EXISTS cpu_model VARCHAR(255) DEFAULT ''",
		"ALTER TABLE storage.nas_servers ADD COLUMN IF NOT EXISTS cpu_model VARCHAR(255) DEFAULT ''",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS cpu_model VARCHAR(255) DEFAULT ''",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS cpu_model VARCHAR(255) DEFAULT ''",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS cpu_model VARCHAR(255) DEFAULT ''",
		"ALTER TABLE storage.ceph_servers ADD COLUMN IF NOT EXISTS control_plane_status TEXT DEFAULT '{}'",
		"ALTER TABLE containers.docker_servers ADD COLUMN IF NOT EXISTS control_plane_status TEXT DEFAULT '{}'",
		"ALTER TABLE containers.podman_servers ADD COLUMN IF NOT EXISTS control_plane_status TEXT DEFAULT '{}'",
		"ALTER TABLE kubernetes.kubernetes_servers ADD COLUMN IF NOT EXISTS control_plane_status TEXT DEFAULT '{}'",
		"ALTER TABLE kubernetes.kubernetes_servers ADD COLUMN IF NOT EXISTS resource_counts TEXT DEFAULT '{}'",
		"ALTER TABLE kubernetes.kubernetes_servers ADD COLUMN IF NOT EXISTS network_topology TEXT DEFAULT '{}'",

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
			docker_volumes TEXT DEFAULT '[]',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_storage_used BIGINT DEFAULT 0",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_storage_total BIGINT DEFAULT 0",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_inodes_usage VARCHAR(255) DEFAULT ''",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_logs_size BIGINT DEFAULT 0",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_volumes TEXT DEFAULT '[]'",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS docker_networks TEXT DEFAULT '[]'",
		"ALTER TABLE containers.hosts ADD COLUMN IF NOT EXISTS gpu_info TEXT DEFAULT '[]'",
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
		"ALTER TABLE containers.containers ADD COLUMN IF NOT EXISTS vulnerabilities TEXT DEFAULT ''",
		`CREATE TABLE IF NOT EXISTS kubernetes.nodes (
			id SERIAL PRIMARY KEY,
			server_id INT REFERENCES kubernetes.kubernetes_servers(id) ON DELETE CASCADE,
			hostname VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'unknown',
			roles VARCHAR(255) DEFAULT '',
			version VARCHAR(50) DEFAULT '',
			cpu_model VARCHAR(255),
			cpu_cores INT,
			total_memory BIGINT,
			free_memory BIGINT DEFAULT 0,
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			os_name VARCHAR(255),
			kernel_version VARCHAR(255),
			container_runtime VARCHAR(255),
			pods_count INT DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS kubernetes.persistent_volumes (
			id SERIAL PRIMARY KEY,
			server_id INT REFERENCES kubernetes.kubernetes_servers(id) ON DELETE CASCADE,
			name VARCHAR(255) NOT NULL,
			capacity BIGINT DEFAULT 0,
			usage BIGINT DEFAULT 0,
			status VARCHAR(50),
			pvc_name VARCHAR(255),
			pvc_namespace VARCHAR(255),
			storage_class VARCHAR(255),
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(server_id, name)
		)`,
		`CREATE TABLE IF NOT EXISTS kubernetes.events (
			id SERIAL PRIMARY KEY,
			server_id INT REFERENCES kubernetes.kubernetes_servers(id) ON DELETE CASCADE,
			type VARCHAR(50) NOT NULL,
			reason VARCHAR(255) NOT NULL,
			message TEXT,
			object_kind VARCHAR(100),
			object_name VARCHAR(255),
			namespace VARCHAR(255),
			count INT DEFAULT 1,
			first_seen TIMESTAMP,
			last_seen TIMESTAMP,
			UNIQUE(server_id, namespace, object_kind, object_name, reason, message)
		)`,
		`CREATE TABLE IF NOT EXISTS kubernetes.pods (
			id SERIAL PRIMARY KEY,
			node_id INT REFERENCES kubernetes.nodes(id) ON DELETE CASCADE,
			name VARCHAR(255) NOT NULL,
			namespace VARCHAR(255) NOT NULL,
			state VARCHAR(50) DEFAULT 'unknown',
			status VARCHAR(255) DEFAULT '',
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			memory_usage BIGINT DEFAULT 0,
			ip_address VARCHAR(255) DEFAULT '',
			restarts INT DEFAULT 0,
			age VARCHAR(50) DEFAULT '',
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(node_id, name, namespace)
		)`,
		// Podman Tables
		`CREATE TABLE IF NOT EXISTS containers.podman_hosts (
			id SERIAL PRIMARY KEY,
			server_id INT REFERENCES containers.podman_servers(id) ON DELETE CASCADE,
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
			podman_version VARCHAR(255) DEFAULT '',
			podman_service_status VARCHAR(50) DEFAULT 'unknown',
			podman_api_latency INT DEFAULT 0,
			podman_storage_used BIGINT DEFAULT 0,
			podman_storage_total BIGINT DEFAULT 0,
			podman_inodes_usage VARCHAR(255) DEFAULT '',
			podman_volumes TEXT DEFAULT '[]',
			podman_networks TEXT DEFAULT '[]',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS containers.podman_containers (
			id SERIAL PRIMARY KEY,
			host_id INT REFERENCES containers.podman_hosts(id) ON DELETE CASCADE,
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
		"ALTER TABLE containers.podman_hosts ADD COLUMN IF NOT EXISTS gpu_info TEXT DEFAULT '[]'",
		// Proxmox Tables
		`CREATE TABLE IF NOT EXISTS virtualization.proxmox_hosts (
			id SERIAL PRIMARY KEY,
			server_id INT REFERENCES virtualization.proxmox_servers(id) ON DELETE CASCADE,
			hostname VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'unknown',
			cpu_model VARCHAR(255),
			cpu_cores INT,
			total_memory BIGINT,
			free_memory BIGINT DEFAULT 0,
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			os_name VARCHAR(255),
			kernel_version VARCHAR(255),
			pve_version VARCHAR(50),
			uptime VARCHAR(255),
			vms_count INT DEFAULT 0,
			containers_count INT DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(server_id, hostname)
		)`,
		`CREATE TABLE IF NOT EXISTS virtualization.proxmox_vms (
			id SERIAL PRIMARY KEY,
			host_id INT REFERENCES virtualization.proxmox_hosts(id) ON DELETE CASCADE,
			vmid INT NOT NULL,
			name VARCHAR(255) NOT NULL,
			type VARCHAR(50) NOT NULL,
			state VARCHAR(50) DEFAULT 'unknown',
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			memory_usage BIGINT DEFAULT 0,
			max_memory BIGINT DEFAULT 0,
			net_rx BIGINT DEFAULT 0,
			net_tx BIGINT DEFAULT 0,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(host_id, vmid)
		)`,
		// NAS Tables
		`CREATE TABLE IF NOT EXISTS storage.nas_hosts (
			id SERIAL PRIMARY KEY,
			server_id INT REFERENCES storage.nas_servers(id) ON DELETE CASCADE,
			hostname VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'unknown',
			cpu_model VARCHAR(255),
			cpu_cores INT,
			total_memory BIGINT,
			free_memory BIGINT DEFAULT 0,
			cpu_usage DOUBLE PRECISION DEFAULT 0,
			os_name VARCHAR(255),
			kernel_version VARCHAR(255),
			uptime VARCHAR(255),
			model VARCHAR(255),
			serial VARCHAR(255),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(server_id, hostname)
		)`,
		`CREATE TABLE IF NOT EXISTS storage.nas_volumes (
			id SERIAL PRIMARY KEY,
			host_id INT REFERENCES storage.nas_hosts(id) ON DELETE CASCADE,
			name VARCHAR(255) NOT NULL,
			path VARCHAR(255) NOT NULL,
			status VARCHAR(50) DEFAULT 'online',
			total_size BIGINT,
			used_size BIGINT,
			type VARCHAR(50),
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(host_id, path)
		)`,
		`CREATE TABLE IF NOT EXISTS storage.nas_disks (
			id SERIAL PRIMARY KEY,
			host_id INT REFERENCES storage.nas_hosts(id) ON DELETE CASCADE,
			name VARCHAR(255) NOT NULL,
			model VARCHAR(255),
			serial VARCHAR(255),
			size BIGINT,
			status VARCHAR(50) DEFAULT 'healthy',
			temp INT DEFAULT 0,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(host_id, name)
		)`,
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
		INSERT INTO virtualization.kvm_servers (name, ip_address, ssh_port, username, password, ssh_key_path, ssh_key_content)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath, s.SSHKeyContent).Scan(&id)
	return id, err
}

func (d *DB) GetServers() ([]KVMServer, error) {
	rows, err := d.Conn.Query("SELECT id, name, ip_address, ssh_port, username, password, ssh_key_path, ssh_key_content, status FROM virtualization.kvm_servers")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []KVMServer
	for rows.Next() {
		var s KVMServer
		var pwd sql.NullString
		// Validating scan args count: 9 cols
		if err := rows.Scan(&s.ID, &s.Name, &s.IPAddress, &s.SSHPort, &s.Username, &pwd, &s.SSHKeyPath, &s.SSHKeyContent, &s.Status); err != nil {
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
			SET name=$1, ip_address=$2, ssh_port=$3, username=$4, ssh_key_path=$5, ssh_key_content=$6 
			WHERE id=$7`,
			s.Name, s.IPAddress, s.SSHPort, s.Username, s.SSHKeyPath, s.SSHKeyContent, s.ID)
		return err
	} else {
		// Update with password
		_, err := d.Conn.Exec(`UPDATE virtualization.kvm_servers 
			SET name=$1, ip_address=$2, ssh_port=$3, username=$4, password=$5, ssh_key_path=$6, ssh_key_content=$7 
			WHERE id=$8`,
			s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath, s.SSHKeyContent, s.ID)
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
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	IPAddress     string `json:"ip_address"`
	SSHPort       int    `json:"ssh_port"`
	Username      string `json:"username"`
	Password      string `json:"password"`
	SSHKeyPath    string `json:"ssh_key_path"`
	SSHKeyContent string `json:"ssh_key_content"`
	Status        string `json:"status"`
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
	rows, err := d.Conn.Query("SELECT id, name, ip_address, ssh_port, username, password, ssh_key_path, ssh_key_content, status FROM firewall.pfsense_servers")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []PFSenseServer
	for rows.Next() {
		var s PFSenseServer
		var pwd sql.NullString
		// Scan 9 columns
		if err := rows.Scan(&s.ID, &s.Name, &s.IPAddress, &s.SSHPort, &s.Username, &pwd, &s.SSHKeyPath, &s.SSHKeyContent, &s.Status); err != nil {
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
	err := d.Conn.QueryRow(`INSERT INTO firewall.pfsense_servers (name, ip_address, ssh_port, username, password, ssh_key_path, ssh_key_content, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath, s.SSHKeyContent, "unknown").Scan(&id)
	return id, err
}

func (d *DB) UpdatePFSenseServer(s PFSenseServer) error {
	_, err := d.Conn.Exec(`UPDATE firewall.pfsense_servers SET name=$1, ip_address=$2, ssh_port=$3, username=$4, password=$5, ssh_key_path=$6, ssh_key_content=$7 WHERE id=$8`,
		s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath, s.SSHKeyContent, s.ID)
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
	ID                 int64   `json:"id"`
	Name               string  `json:"name"`
	IPAddress          string  `json:"ip_address"`
	SSHPort            int     `json:"ssh_port"`
	Username           string  `json:"username"`
	Password           string  `json:"password"`
	SSHKeyPath         string  `json:"ssh_key_path"`
	SSHKeyContent      string  `json:"ssh_key_content"`
	KubeconfigPath     string  `json:"kubeconfig_path"`
	KubeconfigContent  string  `json:"kubeconfig_content"`
	Status             string  `json:"status"`
	CPUUsage           float64 `json:"cpu_usage"`
	CPUCores           int     `json:"cpu_cores"`
	TotalMemory        uint64  `json:"total_memory"`
	FreeMemory         uint64  `json:"free_memory"`
	StorageUsed        uint64  `json:"storage_used"`
	StorageTotal       uint64  `json:"storage_total"`
	OSName             string  `json:"os_name"`
	CPUModel           string  `json:"cpu_model"`
	ControlPlaneStatus string  `json:"control_plane_status"` // JSON string for Kubernetes
	ResourceCounts     string  `json:"resource_counts"`      // JSON string for Kubernetes resource counts
	NetworkTopology    string  `json:"network_topology"`     // JSON string for Kubernetes network map
}

// Table names for each server type
var serverTableMap = map[string]string{
	"proxmox":    "virtualization.proxmox_servers",
	"nas":        "storage.nas_servers",
	"ceph":       "storage.ceph_servers",
	"docker":     "containers.docker_servers",
	"podman":     "containers.podman_servers",
	"kubernetes": "kubernetes.kubernetes_servers",
}

func (d *DB) GetGenericServers(toolType string) ([]GenericServer, error) {
	table, ok := serverTableMap[toolType]
	if !ok {
		return nil, fmt.Errorf("unknown tool type: %s", toolType)
	}

	query := fmt.Sprintf("SELECT id, name, ip_address, ssh_port, username, password, ssh_key_path, ssh_key_content, kubeconfig_path, kubeconfig_content, status, cpu_usage, cpu_cores, total_memory, free_memory, storage_used, storage_total, os_name, cpu_model, control_plane_status, resource_counts, network_topology FROM %s", table)
	rows, err := d.Conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []GenericServer
	for rows.Next() {
		var s GenericServer
		var pwd sql.NullString
		if err := rows.Scan(&s.ID, &s.Name, &s.IPAddress, &s.SSHPort, &s.Username, &pwd, &s.SSHKeyPath, &s.SSHKeyContent, &s.KubeconfigPath, &s.KubeconfigContent, &s.Status, &s.CPUUsage, &s.CPUCores, &s.TotalMemory, &s.FreeMemory, &s.StorageUsed, &s.StorageTotal, &s.OSName, &s.CPUModel, &s.ControlPlaneStatus, &s.ResourceCounts, &s.NetworkTopology); err != nil {
			return nil, err
		}
		s.Password = pwd.String
		servers = append(servers, s)
	}
	return servers, nil
}

func (d *DB) UpdateControlPlaneStatus(toolType string, id int64, statusJSON string) error {
	table, ok := serverTableMap[toolType]
	if !ok {
		return fmt.Errorf("unknown tool type: %s", toolType)
	}
	query := fmt.Sprintf("UPDATE %s SET control_plane_status=$1 WHERE id=$2", table)
	_, err := d.Conn.Exec(query, statusJSON, id)
	return err
}

func (d *DB) UpdateResourceCounts(toolType string, id int64, countsJSON string) error {
	table, ok := serverTableMap[toolType]
	if !ok {
		return fmt.Errorf("unknown tool type: %s", toolType)
	}
	query := fmt.Sprintf("UPDATE %s SET resource_counts=$1 WHERE id=$2", table)
	_, err := d.Conn.Exec(query, countsJSON, id)
	return err
}

func (d *DB) UpdateNetworkTopology(toolType string, id int64, topologyJSON string) error {
	table, ok := serverTableMap[toolType]
	if !ok {
		return fmt.Errorf("unknown tool type: %s", toolType)
	}
	query := fmt.Sprintf("UPDATE %s SET network_topology=$1 WHERE id=$2", table)
	_, err := d.Conn.Exec(query, topologyJSON, id)
	return err
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
	query := fmt.Sprintf("INSERT INTO %s (name, ip_address, ssh_port, username, password, ssh_key_path, ssh_key_content, kubeconfig_path, kubeconfig_content) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id", table)
	err := d.Conn.QueryRow(query, s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath, s.SSHKeyContent, s.KubeconfigPath, s.KubeconfigContent).Scan(&id)
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
		query := fmt.Sprintf(`UPDATE %s SET name=$1, ip_address=$2, ssh_port=$3, username=$4, ssh_key_path=$5, ssh_key_content=$6, kubeconfig_path=$7, kubeconfig_content=$8 WHERE id=$9`, table)
		_, err := d.Conn.Exec(query, s.Name, s.IPAddress, s.SSHPort, s.Username, s.SSHKeyPath, s.SSHKeyContent, s.KubeconfigPath, s.KubeconfigContent, s.ID)
		return err
	}
	query := fmt.Sprintf(`UPDATE %s SET name=$1, ip_address=$2, ssh_port=$3, username=$4, password=$5, ssh_key_path=$6, ssh_key_content=$7, kubeconfig_path=$8, kubeconfig_content=$9 WHERE id=$10`, table)
	_, err := d.Conn.Exec(query, s.Name, s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyPath, s.SSHKeyContent, s.KubeconfigPath, s.KubeconfigContent, s.ID)
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

func (d *DB) UpdateGenericServerStats(toolType string, id int64, cpuUsage float64, cpuCores int, totalMem, freeMem, storageUsed, storageTotal uint64, osName, cpuModel string) error {
	table, ok := serverTableMap[toolType]
	if !ok {
		return fmt.Errorf("unknown tool type: %s", toolType)
	}

	query := fmt.Sprintf("UPDATE %s SET cpu_usage=$1, cpu_cores=$2, total_memory=$3, free_memory=$4, storage_used=$5, storage_total=$6, os_name=$7, cpu_model=$8 WHERE id=$9", table)
	_, err := d.Conn.Exec(query, cpuUsage, cpuCores, totalMem, freeMem, storageUsed, storageTotal, osName, cpuModel, id)
	return err
}

// Docker specific methods
func (d *DB) UpsertKubernetesPV(pv KubernetesPV) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM kubernetes.persistent_volumes WHERE name = $1 AND server_id = $2", pv.Name, pv.ServerID).Scan(&id)

	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO kubernetes.persistent_volumes (server_id, name, capacity, usage, status, pvc_name, pvc_namespace, storage_class, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
			pv.ServerID, pv.Name, pv.Capacity, pv.Usage, pv.Status, pv.PVCName, pv.PVCNamespace, pv.StorageClass)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE kubernetes.persistent_volumes SET capacity=$1, usage=$2, status=$3, pvc_name=$4, pvc_namespace=$5, storage_class=$6, updated_at=NOW()
			WHERE id=$7`,
			pv.Capacity, pv.Usage, pv.Status, pv.PVCName, pv.PVCNamespace, pv.StorageClass, id)
	}
	return err
}

func (d *DB) GetKubernetesPVs(serverID int64) ([]KubernetesPV, error) {
	query := "SELECT id, server_id, name, capacity, usage, status, pvc_name, pvc_namespace, storage_class, updated_at FROM kubernetes.persistent_volumes WHERE server_id = $1"
	rows, err := d.Conn.Query(query, serverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pvs []KubernetesPV
	for rows.Next() {
		var pv KubernetesPV
		if err := rows.Scan(&pv.ID, &pv.ServerID, &pv.Name, &pv.Capacity, &pv.Usage, &pv.Status, &pv.PVCName, &pv.PVCNamespace, &pv.StorageClass, &pv.UpdatedAt); err != nil {
			return nil, err
		}
		pvs = append(pvs, pv)
	}
	return pvs, nil
}

func (d *DB) GetAllKubernetesPVs() ([]KubernetesPV, error) {
	query := "SELECT id, server_id, name, capacity, usage, status, pvc_name, pvc_namespace, storage_class, updated_at FROM kubernetes.persistent_volumes"
	rows, err := d.Conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pvs []KubernetesPV
	for rows.Next() {
		var pv KubernetesPV
		if err := rows.Scan(&pv.ID, &pv.ServerID, &pv.Name, &pv.Capacity, &pv.Usage, &pv.Status, &pv.PVCName, &pv.PVCNamespace, &pv.StorageClass, &pv.UpdatedAt); err != nil {
			return nil, err
		}
		pvs = append(pvs, pv)
	}
	return pvs, nil
}

// ClearKubernetesNodesStatus marks all nodes for a given server as "Unknown"
func (d *DB) ClearKubernetesNodesStatus(serverID int64) error {
	query := `UPDATE kubernetes.nodes SET status = 'Unknown' WHERE server_id = $1`
	_, err := d.Conn.Exec(query, serverID)
	return err
}

// UpsertKubernetesEvent inserts or updates a Kubernetes event
func (d *DB) UpsertKubernetesEvent(e KubernetesEvent) error {
	var id int64
	err := d.Conn.QueryRow(`
		SELECT id FROM kubernetes.events 
		WHERE server_id = $1 AND namespace = $2 AND object_kind = $3 AND object_name = $4 AND reason = $5 AND message = $6`,
		e.ServerID, e.Namespace, e.ObjectKind, e.ObjectName, e.Reason, e.Message).Scan(&id)

	if err == sql.ErrNoRows {
		// Insert new event
		_, err = d.Conn.Exec(`
			INSERT INTO kubernetes.events (server_id, type, reason, message, object_kind, object_name, namespace, count, first_seen, last_seen)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			e.ServerID, e.Type, e.Reason, e.Message, e.ObjectKind, e.ObjectName, e.Namespace, e.Count, e.FirstSeen, e.LastSeen)
	} else if err == nil {
		// Update existing event
		_, err = d.Conn.Exec(`
			UPDATE kubernetes.events 
			SET type = $1, count = $2, last_seen = $3 
			WHERE id = $4`,
			e.Type, e.Count, e.LastSeen, id)
	}
	return err
}

// GetKubernetesEvents returns the last 50 events for all Kubernetes servers, sorted by last_seen DESC
func (d *DB) GetKubernetesEvents() ([]KubernetesEvent, error) {
	query := `
		SELECT id, server_id, type, reason, message, object_kind, object_name, namespace, count, first_seen, last_seen 
		FROM kubernetes.events 
		ORDER BY last_seen DESC 
		LIMIT 50`
	rows, err := d.Conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []KubernetesEvent
	for rows.Next() {
		var e KubernetesEvent
		if err := rows.Scan(&e.ID, &e.ServerID, &e.Type, &e.Reason, &e.Message, &e.ObjectKind, &e.ObjectName, &e.Namespace, &e.Count, &e.FirstSeen, &e.LastSeen); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

func (d *DB) UpsertDockerHost(h DockerHost) (int64, error) {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM containers.hosts WHERE server_id = $1", h.ServerID).Scan(&id)
	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO containers.hosts (server_id, hostname, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name, public_ip, dns_servers, uptime, update_status, temperature, disks, docker_version, docker_service_status, docker_socket_status, docker_api_latency, docker_storage_used, docker_storage_total, docker_inodes_usage, docker_logs_size, docker_volumes, docker_networks, gpu_info)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25) RETURNING id`,
			h.ServerID, h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.PublicIP, h.DNSServers, h.Uptime, h.UpdateStatus, h.Temperature, h.Disks, h.DockerVer, h.ServiceStatus, h.SocketStatus, h.APILatency, h.StorageUsed, h.StorageTotal, h.InodesUsage, h.LogsSize, h.Volumes, h.Networks, h.GPUInfo).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`UPDATE containers.hosts SET hostname=$1, cpu_model=$2, cpu_cores=$3, total_memory=$4, free_memory=$5, cpu_usage=$6, os_name=$7, public_ip=$8, dns_servers=$9, uptime=$10, update_status=$11, temperature=$12, disks=$13, docker_version=$14, docker_service_status=$15, docker_socket_status=$16, docker_api_latency=$17, docker_storage_used=$18, docker_storage_total=$19, docker_inodes_usage=$20, docker_logs_size=$21, docker_volumes=$22, docker_networks=$23, gpu_info=$24 WHERE id=$25`,
			h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.PublicIP, h.DNSServers, h.Uptime, h.UpdateStatus, h.Temperature, h.Disks, h.DockerVer, h.ServiceStatus, h.SocketStatus, h.APILatency, h.StorageUsed, h.StorageTotal, h.InodesUsage, h.LogsSize, h.Volumes, h.Networks, h.GPUInfo, id)
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
		SELECT h.id, h.server_id, h.hostname, h.cpu_model, h.cpu_cores, h.total_memory, h.free_memory, h.cpu_usage, h.os_name, h.public_ip, h.dns_servers, h.uptime, h.update_status, h.temperature, h.disks, h.docker_version, h.docker_service_status, h.docker_socket_status, h.docker_api_latency, h.docker_storage_used, h.docker_storage_total, h.docker_inodes_usage, h.docker_logs_size, h.docker_volumes, h.docker_networks, h.gpu_info, ds.name, ds.ip_address, ds.status
		FROM containers.hosts h
		JOIN containers.docker_servers ds ON h.server_id = ds.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []DockerHost
	for rows.Next() {
		var h DockerHost
		if err := rows.Scan(&h.ID, &h.ServerID, &h.Hostname, &h.CPUModel, &h.CPUCores, &h.TotalMemory, &h.FreeMemory, &h.CPUUsage, &h.OSName, &h.PublicIP, &h.DNSServers, &h.Uptime, &h.UpdateStatus, &h.Temperature, &h.Disks, &h.DockerVer, &h.ServiceStatus, &h.SocketStatus, &h.APILatency, &h.StorageUsed, &h.StorageTotal, &h.InodesUsage, &h.LogsSize, &h.Volumes, &h.Networks, &h.GPUInfo, &h.ServerName, &h.IPAddress, &h.Status); err != nil {
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

// Kubernetes specific methods
func (d *DB) UpsertKubernetesNode(n KubernetesNode) (int64, error) {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM kubernetes.nodes WHERE server_id = $1 AND hostname = $2", n.ServerID, n.Hostname).Scan(&id)
	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO kubernetes.nodes (server_id, hostname, status, roles, version, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name, kernel_version, container_runtime, pods_count, disk_total, disk_used, net_rx, net_tx, net_rx_rate, net_tx_rate, ip_address)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING id`,
			n.ServerID, n.Hostname, n.Status, n.Roles, n.Version, n.CPUModel, n.CPUCores, n.TotalMemory, n.FreeMemory, n.CPUUsage, n.OSName, n.KernelVer, n.ContainerRuntime, n.PodsCount, n.DiskTotal, n.DiskUsed, n.NetRX, n.NetTX, n.NetRXRate, n.NetTXRate, n.IPAddress).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`UPDATE kubernetes.nodes SET status=$1, roles=$2, version=$3, cpu_model=$4, cpu_cores=$5, total_memory=$6, free_memory=$7, cpu_usage=$8, os_name=$9, kernel_version=$10, container_runtime=$11, pods_count=$12, disk_total=$13, disk_used=$14, net_rx=$15, net_tx=$16, net_rx_rate=$17, net_tx_rate=$18, ip_address=$19 WHERE id=$20`,
			n.Status, n.Roles, n.Version, n.CPUModel, n.CPUCores, n.TotalMemory, n.FreeMemory, n.CPUUsage, n.OSName, n.KernelVer, n.ContainerRuntime, n.PodsCount, n.DiskTotal, n.DiskUsed, n.NetRX, n.NetTX, n.NetRXRate, n.NetTXRate, n.IPAddress, id)
	}
	return id, err
}

func (d *DB) UpsertKubernetesPod(p KubernetesPod) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM kubernetes.pods WHERE node_id = $1 AND name = $2 AND namespace = $3", p.NodeID, p.Name, p.Namespace).Scan(&id)

	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO kubernetes.pods (node_id, name, namespace, state, status, cpu_usage, memory_usage, ip_address, restarts, age, updated_at, image, ports, net_rx, net_tx)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14)`,
			p.NodeID, p.Name, p.Namespace, p.State, p.Status, p.CPUUsage, p.MemUsage, p.IPAddress, p.Restarts, p.Age, p.Image, p.Ports, p.NetRX, p.NetTX)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE kubernetes.pods SET state=$1, status=$2, cpu_usage=$3, memory_usage=$4, ip_address=$5, restarts=$6, age=$7, updated_at=NOW(), image=$8, ports=$9, net_rx=$10, net_tx=$11 WHERE id=$12`,
			p.State, p.Status, p.CPUUsage, p.MemUsage, p.IPAddress, p.Restarts, p.Age, p.Image, p.Ports, p.NetRX, p.NetTX, id)
	}
	return err
}

func (d *DB) GetKubernetesNodes() ([]KubernetesNode, error) {
	rows, err := d.Conn.Query(`
		SELECT n.id, n.server_id, n.hostname, n.status, n.roles, n.version, n.cpu_model, n.cpu_cores, n.total_memory, n.free_memory, n.cpu_usage, n.os_name, n.kernel_version, n.container_runtime, n.pods_count, n.disk_total, n.disk_used, n.net_rx, n.net_tx, n.net_rx_rate, n.net_tx_rate, ks.name, n.ip_address
		FROM kubernetes.nodes n
		JOIN kubernetes.kubernetes_servers ks ON n.server_id = ks.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []KubernetesNode
	for rows.Next() {
		var n KubernetesNode
		if err := rows.Scan(&n.ID, &n.ServerID, &n.Hostname, &n.Status, &n.Roles, &n.Version, &n.CPUModel, &n.CPUCores, &n.TotalMemory, &n.FreeMemory, &n.CPUUsage, &n.OSName, &n.KernelVer, &n.ContainerRuntime, &n.PodsCount, &n.DiskTotal, &n.DiskUsed, &n.NetRX, &n.NetTX, &n.NetRXRate, &n.NetTXRate, &n.ServerName, &n.IPAddress); err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, nil
	return nodes, nil
}

func (d *DB) GetAllKubernetesPods() ([]KubernetesPod, error) {
	rows, err := d.Conn.Query(`SELECT id, node_id, name, namespace, state, status, cpu_usage, memory_usage, ip_address, restarts, age, updated_at, image, ports, net_rx, net_tx FROM kubernetes.pods`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pods []KubernetesPod
	for rows.Next() {
		var p KubernetesPod
		if err := rows.Scan(&p.ID, &p.NodeID, &p.Name, &p.Namespace, &p.State, &p.Status, &p.CPUUsage, &p.MemUsage, &p.IPAddress, &p.Restarts, &p.Age, &p.UpdatedAt, &p.Image, &p.Ports, &p.NetRX, &p.NetTX); err != nil {
			return nil, err
		}
		pods = append(pods, p)
	}
	return pods, nil
}

// Podman specific methods
func (d *DB) UpsertPodmanHost(h PodmanHost) (int64, error) {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM containers.podman_hosts WHERE server_id = $1 AND hostname = $2", h.ServerID, h.Hostname).Scan(&id)

	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO containers.podman_hosts (server_id, hostname, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name, uptime, podman_version, podman_service_status, podman_api_latency, podman_storage_used, podman_storage_total, podman_inodes_usage, podman_volumes, podman_networks, gpu_info)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
			h.ServerID, h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.Uptime, h.PodmanVer, h.ServiceStatus, h.APILatency, h.StorageUsed, h.StorageTotal, h.InodesUsage, h.Volumes, h.PodmanNetworks, h.GPUInfo).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE containers.podman_hosts SET cpu_model=$1, cpu_cores=$2, total_memory=$3, free_memory=$4, cpu_usage=$5, os_name=$6, uptime=$7, podman_version=$8, podman_service_status=$9, podman_api_latency=$10, podman_storage_used=$11, podman_storage_total=$12, podman_inodes_usage=$13, podman_volumes=$14, podman_networks=$15, gpu_info=$16
			WHERE id=$17`,
			h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.Uptime, h.PodmanVer, h.ServiceStatus, h.APILatency, h.StorageUsed, h.StorageTotal, h.InodesUsage, h.Volumes, h.PodmanNetworks, h.GPUInfo, id)
	}

	return id, err
}

func (d *DB) UpsertPodmanContainer(c Container) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM containers.podman_containers WHERE host_id = $1 AND name = $2", c.HostID, c.Name).Scan(&id)

	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO containers.podman_containers (host_id, name, image, ports, state, status, cpu_usage, memory_usage, memory_limit, net_rx, net_tx, block_in, block_out, pids, ip_address, oom_killed, vulnerabilities, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())`,
			c.HostID, c.Name, c.Image, c.Ports, c.State, c.Status, c.CPUUsage, c.MemUsage, c.MemLimit, c.NetRX, c.NetTX, c.BlockIn, c.BlockOut, c.PIDs, c.IPAddress, c.OOMKilled, c.Vulnerabilities)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE containers.podman_containers SET image=$1, ports=$2, state=$3, status=$4, cpu_usage=$5, memory_usage=$6, memory_limit=$7, net_rx=$8, net_tx=$9, block_in=$10, block_out=$11, pids=$12, ip_address=$13, oom_killed=$14, vulnerabilities=$15, updated_at=NOW()
			WHERE id=$16`,
			c.Image, c.Ports, c.State, c.Status, c.CPUUsage, c.MemUsage, c.MemLimit, c.NetRX, c.NetTX, c.BlockIn, c.BlockOut, c.PIDs, c.IPAddress, c.OOMKilled, c.Vulnerabilities, id)
	}
	return err
}

func (d *DB) GetPodmanHosts() ([]PodmanHost, error) {
	rows, err := d.Conn.Query(`
		SELECT h.id, h.server_id, h.hostname, ps.name, ps.ip_address, h.cpu_model, h.cpu_cores, h.total_memory, h.free_memory, h.cpu_usage, h.os_name, h.uptime, h.podman_version, h.podman_service_status, h.podman_api_latency, h.podman_storage_used, h.podman_storage_total, h.podman_inodes_usage, h.podman_volumes, h.podman_networks, h.gpu_info, ps.status
		FROM containers.podman_hosts h
		JOIN containers.podman_servers ps ON h.server_id = ps.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []PodmanHost
	for rows.Next() {
		var h PodmanHost
		if err := rows.Scan(&h.ID, &h.ServerID, &h.Hostname, &h.ServerName, &h.IPAddress, &h.CPUModel, &h.CPUCores, &h.TotalMemory, &h.FreeMemory, &h.CPUUsage, &h.OSName, &h.Uptime, &h.PodmanVer, &h.ServiceStatus, &h.APILatency, &h.StorageUsed, &h.StorageTotal, &h.InodesUsage, &h.Volumes, &h.PodmanNetworks, &h.GPUInfo, &h.Status); err != nil {
			return nil, err
		}
		hosts = append(hosts, h)
	}
	return hosts, nil
}

func (d *DB) GetAllPodmanContainers() ([]Container, error) {
	rows, err := d.Conn.Query("SELECT id, host_id, name, image, ports, state, status, cpu_usage, memory_usage, memory_limit, net_rx, net_tx, block_in, block_out, pids, ip_address, oom_killed, vulnerabilities, updated_at FROM containers.podman_containers")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var containers []Container
	for rows.Next() {
		var c Container
		if err := rows.Scan(&c.ID, &c.HostID, &c.Name, &c.Image, &c.Ports, &c.State, &c.Status, &c.CPUUsage, &c.MemUsage, &c.MemLimit, &c.NetRX, &c.NetTX, &c.BlockIn, &c.BlockOut, &c.PIDs, &c.IPAddress, &c.OOMKilled, &c.Vulnerabilities, &c.UpdatedAt); err != nil {
			return nil, err
		}
		containers = append(containers, c)
	}
	return containers, nil
}

// Proxmox specific methods
func (d *DB) UpsertProxmoxHost(h ProxmoxHost) (int64, error) {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM virtualization.proxmox_hosts WHERE server_id = $1 AND hostname = $2", h.ServerID, h.Hostname).Scan(&id)

	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO virtualization.proxmox_hosts (server_id, hostname, status, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name, kernel_version, pve_version, uptime, vms_count, containers_count)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
			h.ServerID, h.Hostname, h.Status, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.KernelVer, h.PVEVersion, h.Uptime, h.VMsCount, h.Containers).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE virtualization.proxmox_hosts SET status=$1, cpu_model=$2, cpu_cores=$3, total_memory=$4, free_memory=$5, cpu_usage=$6, os_name=$7, kernel_version=$8, pve_version=$9, uptime=$10, vms_count=$11, containers_count=$12
			WHERE id=$13`,
			h.Status, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.KernelVer, h.PVEVersion, h.Uptime, h.VMsCount, h.Containers, id)
	}

	return id, err
}

func (d *DB) UpsertProxmoxVM(vm ProxmoxVM) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM virtualization.proxmox_vms WHERE host_id = $1 AND vmid = $2", vm.HostID, vm.VMID).Scan(&id)

	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO virtualization.proxmox_vms (host_id, vmid, name, type, state, cpu_usage, memory_usage, max_memory, net_rx, net_tx, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
			vm.HostID, vm.VMID, vm.Name, vm.Type, vm.State, vm.CPUUsage, vm.MemoryUsage, vm.MaxMemory, vm.NetRX, vm.NetTX)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE virtualization.proxmox_vms SET name=$1, type=$2, state=$3, cpu_usage=$4, memory_usage=$5, max_memory=$6, net_rx=$7, net_tx=$8, updated_at=NOW()
			WHERE id=$9`,
			vm.Name, vm.Type, vm.State, vm.CPUUsage, vm.MemoryUsage, vm.MaxMemory, vm.NetRX, vm.NetTX, id)
	}
	return err
}

func (d *DB) GetProxmoxHosts() ([]ProxmoxHost, error) {
	rows, err := d.Conn.Query(`
		SELECT ph.id, ph.server_id, ph.hostname, ps.name, ps.ip_address, ps.status, ph.cpu_model, ph.cpu_cores, ph.total_memory, ph.free_memory, ph.cpu_usage, ph.os_name, ph.kernel_version, ph.pve_version, ph.uptime, ph.vms_count, ph.containers_count
		FROM virtualization.proxmox_hosts ph
		JOIN virtualization.proxmox_servers ps ON ph.server_id = ps.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []ProxmoxHost
	for rows.Next() {
		var h ProxmoxHost
		if err := rows.Scan(&h.ID, &h.ServerID, &h.Hostname, &h.ServerName, &h.IPAddress, &h.Status, &h.CPUModel, &h.CPUCores, &h.TotalMemory, &h.FreeMemory, &h.CPUUsage, &h.OSName, &h.KernelVer, &h.PVEVersion, &h.Uptime, &h.VMsCount, &h.Containers); err != nil {
			return nil, err
		}
		hosts = append(hosts, h)
	}
	return hosts, nil
}

func (d *DB) GetAllProxmoxVMs() ([]ProxmoxVM, error) {
	rows, err := d.Conn.Query("SELECT id, host_id, vmid, name, type, state, cpu_usage, memory_usage, max_memory, net_rx, net_tx, updated_at FROM virtualization.proxmox_vms")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vms []ProxmoxVM
	for rows.Next() {
		var vm ProxmoxVM
		if err := rows.Scan(&vm.ID, &vm.HostID, &vm.VMID, &vm.Name, &vm.Type, &vm.State, &vm.CPUUsage, &vm.MemoryUsage, &vm.MaxMemory, &vm.NetRX, &vm.NetTX, &vm.UpdatedAt); err != nil {
			return nil, err
		}
		vms = append(vms, vm)
	}
	return vms, nil
}

// NAS specific methods
func (d *DB) UpsertNasHost(h NasHost) (int64, error) {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM storage.nas_hosts WHERE server_id = $1 AND hostname = $2", h.ServerID, h.Hostname).Scan(&id)

	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO storage.nas_hosts (server_id, hostname, status, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name, kernel_version, uptime, model, serial)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
			h.ServerID, h.Hostname, h.Status, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.KernelVer, h.Uptime, h.Model, h.Serial).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE storage.nas_hosts SET status=$1, cpu_model=$2, cpu_cores=$3, total_memory=$4, free_memory=$5, cpu_usage=$6, os_name=$7, kernel_version=$8, uptime=$9, model=$10, serial=$11
			WHERE id=$12`,
			h.Status, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.KernelVer, h.Uptime, h.Model, h.Serial, id)
	}

	return id, err
}

func (d *DB) UpsertNasVolume(v NasVolume) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM storage.nas_volumes WHERE host_id = $1 AND path = $2", v.HostID, v.Path).Scan(&id)

	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO storage.nas_volumes (host_id, name, path, status, total_size, used_size, type, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
			v.HostID, v.Name, v.Path, v.Status, v.TotalSize, v.UsedSize, v.Type)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE storage.nas_volumes SET name=$1, status=$2, total_size=$3, used_size=$4, type=$5, updated_at=NOW()
			WHERE id=$6`,
			v.Name, v.Status, v.TotalSize, v.UsedSize, v.Type, id)
	}
	return err
}

func (d *DB) UpsertNasDisk(disk NasDisk) error {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM storage.nas_disks WHERE host_id = $1 AND name = $2", disk.HostID, disk.Name).Scan(&id)

	if err == sql.ErrNoRows {
		_, err = d.Conn.Exec(`
			INSERT INTO storage.nas_disks (host_id, name, model, serial, size, status, temp, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
			disk.HostID, disk.Name, disk.Model, disk.Serial, disk.Size, disk.Status, disk.Temp)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE storage.nas_disks SET model=$1, serial=$2, size=$3, status=$4, temp=$5, updated_at=NOW()
			WHERE id=$6`,
			disk.Model, disk.Serial, disk.Size, disk.Status, disk.Temp, id)
	}
	return err
}

func (d *DB) GetNasHosts() ([]NasHost, error) {
	rows, err := d.Conn.Query(`
		SELECT nh.id, nh.server_id, nh.hostname, ns.name, ns.ip_address, ns.status, nh.cpu_model, nh.cpu_cores, nh.total_memory, nh.free_memory, nh.cpu_usage, nh.os_name, nh.kernel_version, nh.uptime, nh.model, nh.serial
		FROM storage.nas_hosts nh
		JOIN storage.nas_servers ns ON nh.server_id = ns.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []NasHost
	for rows.Next() {
		var h NasHost
		if err := rows.Scan(&h.ID, &h.ServerID, &h.Hostname, &h.ServerName, &h.IPAddress, &h.Status, &h.CPUModel, &h.CPUCores, &h.TotalMemory, &h.FreeMemory, &h.CPUUsage, &h.OSName, &h.KernelVer, &h.Uptime, &h.Model, &h.Serial); err != nil {
			return nil, err
		}
		hosts = append(hosts, h)
	}
	return hosts, nil
}

func (d *DB) GetAllNasVolumes() ([]NasVolume, error) {
	rows, err := d.Conn.Query("SELECT id, host_id, name, path, status, total_size, used_size, type, updated_at FROM storage.nas_volumes")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var volumes []NasVolume
	for rows.Next() {
		var v NasVolume
		if err := rows.Scan(&v.ID, &v.HostID, &v.Name, &v.Path, &v.Status, &v.TotalSize, &v.UsedSize, &v.Type, &v.UpdatedAt); err != nil {
			return nil, err
		}
		volumes = append(volumes, v)
	}
	return volumes, nil
}

func (d *DB) GetAllNasDisks() ([]NasDisk, error) {
	rows, err := d.Conn.Query("SELECT id, host_id, name, model, serial, size, status, temp, updated_at FROM storage.nas_disks")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var disks []NasDisk
	for rows.Next() {
		var disk NasDisk
		if err := rows.Scan(&disk.ID, &disk.HostID, &disk.Name, &disk.Model, &disk.Serial, &disk.Size, &disk.Status, &disk.Temp, &disk.UpdatedAt); err != nil {
			return nil, err
		}
		disks = append(disks, disk)
	}
	return disks, nil
}

// Ceph Types
type CephHost struct {
	ID            int64   `json:"id"`
	ServerID      int64   `json:"server_id"`
	Hostname      string  `json:"hostname"`
	ServerName    string  `json:"server_name"`
	IPAddress     string  `json:"ip_address"`
	Status        string  `json:"status"`
	CPUModel      string  `json:"cpu_model"`
	CPUCores      int     `json:"cpu_cores"`
	TotalMemory   uint64  `json:"total_memory"`
	FreeMemory    uint64  `json:"free_memory"`
	CPUUsage      float64 `json:"cpu_usage"`
	OSName        string  `json:"os_name"`
	KernelVer     string  `json:"kernel_version"`
	Uptime        string  `json:"uptime"`
	ClusterStatus string  `json:"cluster_status"` // JSON string of "ceph status"
	ClusterHealth string  `json:"cluster_health"` // HEALTH_OK, HEALTH_WARN, etc.
}

// Ceph Methods
func (d *DB) UpsertCephHost(h CephHost) (int64, error) {
	var id int64
	err := d.Conn.QueryRow("SELECT id FROM storage.ceph_hosts WHERE server_id = $1 AND hostname = $2", h.ServerID, h.Hostname).Scan(&id)

	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO storage.ceph_hosts (server_id, hostname, status, cpu_model, cpu_cores, total_memory, free_memory, cpu_usage, os_name, kernel_version, uptime, cluster_status, cluster_health)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
			h.ServerID, h.Hostname, h.Status, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.KernelVer, h.Uptime, h.ClusterStatus, h.ClusterHealth).Scan(&id)
	} else if err == nil {
		_, err = d.Conn.Exec(`
			UPDATE storage.ceph_hosts SET status=$1, cpu_model=$2, cpu_cores=$3, total_memory=$4, free_memory=$5, cpu_usage=$6, os_name=$7, kernel_version=$8, uptime=$9, cluster_status=$10, cluster_health=$11
			WHERE id=$12`,
			h.Status, h.CPUModel, h.CPUCores, h.TotalMemory, h.FreeMemory, h.CPUUsage, h.OSName, h.KernelVer, h.Uptime, h.ClusterStatus, h.ClusterHealth, id)
	}

	return id, err
}

func (d *DB) GetCephHosts() ([]CephHost, error) {
	rows, err := d.Conn.Query(`
		SELECT ch.id, ch.server_id, ch.hostname, cs.name, cs.ip_address, ch.status, ch.cpu_model, ch.cpu_cores, ch.total_memory, ch.free_memory, ch.cpu_usage, ch.os_name, ch.kernel_version, ch.uptime, ch.cluster_status, ch.cluster_health
		FROM storage.ceph_hosts ch
		JOIN storage.ceph_servers cs ON ch.server_id = cs.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []CephHost
	for rows.Next() {
		var h CephHost
		if err := rows.Scan(&h.ID, &h.ServerID, &h.Hostname, &h.ServerName, &h.IPAddress, &h.Status, &h.CPUModel, &h.CPUCores, &h.TotalMemory, &h.FreeMemory, &h.CPUUsage, &h.OSName, &h.KernelVer, &h.Uptime, &h.ClusterStatus, &h.ClusterHealth); err != nil {
			return nil, err
		}
		hosts = append(hosts, h)
	}
	return hosts, nil
}

func (d *DB) DeleteStaleKubernetesPods(serverID int64, activePodKeys []string) error {
	if len(activePodKeys) == 0 {
		return nil
	}

	query := `
		DELETE FROM kubernetes.pods P
		USING kubernetes.nodes N
		WHERE P.node_id = N.id
		AND N.server_id = $1
		AND NOT ((P.namespace || '/' || P.name) = ANY($2))
	`
	_, err := d.Conn.Exec(query, serverID, pq.Array(activePodKeys))
	return err
}
