CREATE TABLE IF NOT EXISTS hosts (
    id SERIAL PRIMARY KEY,
    hostname VARCHAR(255) NOT NULL,
    cpu_model VARCHAR(255),
    cpu_cores INT,
    total_memory BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    state VARCHAR(50),
    cpu_time BIGINT, -- accummulated cpu time in nanoseconds
    memory_usage BIGINT, -- current memory usage in bytes
    max_memory BIGINT,
    host_id INT, -- primitive relation if we have multiple hosts (for now just one local)
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_host FOREIGN KEY(host_id) REFERENCES hosts(id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_vms_name ON vms(name);
