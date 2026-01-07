CREATE TABLE IF NOT EXISTS kvm_servers (
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

CREATE TABLE IF NOT EXISTS hosts (
    id SERIAL PRIMARY KEY,
    server_id INT, -- Link to kvm_servers
    hostname VARCHAR(255) NOT NULL,
    cpu_model VARCHAR(255),
    cpu_cores INT,
    total_memory BIGINT,
    os_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_server FOREIGN KEY(server_id) REFERENCES kvm_servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    state VARCHAR(50),
    vcpu INT,
    cpu_time BIGINT,
    memory_usage BIGINT,
    max_memory BIGINT,
    disk_read BIGINT DEFAULT 0,
    disk_write BIGINT DEFAULT 0,
    net_rx BIGINT DEFAULT 0,
    net_tx BIGINT DEFAULT 0,
    host_id INT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_host FOREIGN KEY(host_id) REFERENCES hosts(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vms_name ON vms(name);
CREATE INDEX IF NOT EXISTS idx_hosts_server ON hosts(server_id);
