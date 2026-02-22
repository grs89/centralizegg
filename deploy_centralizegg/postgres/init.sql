CREATE SCHEMA IF NOT EXISTS virtualization;

CREATE TABLE IF NOT EXISTS virtualization.kvm_servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ip_address VARCHAR(255) NOT NULL,
    ssh_port INT DEFAULT 22,
    username VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'unknown',
    password VARCHAR(255), -- Optional if using SSH Key
    ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS virtualization.hosts (
    id SERIAL PRIMARY KEY,
    server_id INT, -- Link to kvm_servers
    hostname VARCHAR(255) NOT NULL,
    cpu_model VARCHAR(255),
    cpu_cores INT,
    total_memory BIGINT,
    free_memory BIGINT DEFAULT 0,
    cpu_usage DOUBLE PRECISION DEFAULT 0,
    os_name VARCHAR(255),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_server FOREIGN KEY(server_id) REFERENCES virtualization.kvm_servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS virtualization.vms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    state VARCHAR(50),
    vcpu INT,
    cpu_time BIGINT,
    cpu_usage DOUBLE PRECISION DEFAULT 0,
    memory_usage BIGINT,
    max_memory BIGINT,
    disk_allocation BIGINT DEFAULT 0,
    disk_capacity BIGINT DEFAULT 0,
    disk_read BIGINT DEFAULT 0,
    disk_write BIGINT DEFAULT 0,
    net_rx BIGINT DEFAULT 0,
    net_tx BIGINT DEFAULT 0,
    guest_ips TEXT DEFAULT '',
    guest_fs_usage TEXT DEFAULT '',
    host_id INT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_host FOREIGN KEY(host_id) REFERENCES virtualization.hosts(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vms_name ON virtualization.vms(name);
CREATE INDEX IF NOT EXISTS idx_hosts_server ON virtualization.hosts(server_id);

-- Firewall Schema (PFSense)
CREATE SCHEMA IF NOT EXISTS firewall;

CREATE TABLE IF NOT EXISTS firewall.pfsense_servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ip_address VARCHAR(255) NOT NULL,
    ssh_port INT DEFAULT 22,
    username VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'unknown',
    password VARCHAR(255),
    ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS firewall.hosts (
    id SERIAL PRIMARY KEY,
    server_id INT, -- Link to pfsense_servers
    hostname VARCHAR(255) NOT NULL,
    cpu_model VARCHAR(255),
    cpu_cores INT,
    total_memory BIGINT,
    free_memory BIGINT DEFAULT 0,
    cpu_usage DOUBLE PRECISION DEFAULT 0,
    os_name VARCHAR(255),
    -- Network traffic fields
    net_rx_total BIGINT DEFAULT 0,
    net_tx_total BIGINT DEFAULT 0,
    net_rx_bytes_per_sec BIGINT DEFAULT 0,
    net_tx_bytes_per_sec BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pfsense_server FOREIGN KEY(server_id) REFERENCES firewall.pfsense_servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS firewall.interfaces (
    id SERIAL PRIMARY KEY,
    host_id INT,
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_firewall_host FOREIGN KEY(host_id) REFERENCES firewall.hosts(id) ON DELETE CASCADE
);

-- Indexes for firewall schema
CREATE INDEX IF NOT EXISTS idx_firewall_hosts_server ON firewall.hosts(server_id);
CREATE INDEX IF NOT EXISTS idx_firewall_interfaces_host ON firewall.interfaces(host_id);

-- Proxmox Servers (uses virtualization schema)
CREATE TABLE IF NOT EXISTS virtualization.proxmox_servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ip_address VARCHAR(255) NOT NULL,
    ssh_port INT DEFAULT 22,
    username VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'unknown',
    password VARCHAR(255),
    ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Storage Schema
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.nas_servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ip_address VARCHAR(255) NOT NULL,
    ssh_port INT DEFAULT 22,
    username VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'unknown',
    password VARCHAR(255),
    ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS storage.ceph_servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ip_address VARCHAR(255) NOT NULL,
    ssh_port INT DEFAULT 22,
    username VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'unknown',
    password VARCHAR(255),
    ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Containers Schema
CREATE SCHEMA IF NOT EXISTS containers;

CREATE TABLE IF NOT EXISTS containers.docker_servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ip_address VARCHAR(255) NOT NULL,
    ssh_port INT DEFAULT 22,
    username VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'unknown',
    password VARCHAR(255),
    ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS containers.podman_servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ip_address VARCHAR(255) NOT NULL,
    ssh_port INT DEFAULT 22,
    username VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'unknown',
    password VARCHAR(255),
    ssh_key_path VARCHAR(255) DEFAULT '/root/.ssh/id_rsa',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Application Config Schema
CREATE SCHEMA IF NOT EXISTS config;

CREATE TABLE IF NOT EXISTS config.app_settings (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
