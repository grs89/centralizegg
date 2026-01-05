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
	Hostname    string `json:"hostname"`
	CPUModel    string `json:"cpu_model"`
	CPUCores    int    `json:"cpu_cores"`
	TotalMemory uint64 `json:"total_memory"`
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
	// Simple upsert based on hostname (assuming single host for now or unique hostnames)
	var id int64
	err := d.Conn.QueryRow(`
		INSERT INTO hosts (hostname, cpu_model, cpu_cores, total_memory)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (id) DO UPDATE 
		SET cpu_model = EXCLUDED.cpu_model, cpu_cores = EXCLUDED.cpu_cores, total_memory = EXCLUDED.total_memory
		RETURNING id`,
		h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory).Scan(&id)

	// Since we don't have a unique constraint on hostname in the simple schema (my bad, I should have added UNIQUE(hostname)),
	// for now let's just check if it exists or insert.
	// Actually, let's fix the logic: check first.

	err = d.Conn.QueryRow("SELECT id FROM hosts WHERE hostname = $1", h.Hostname).Scan(&id)
	if err == sql.ErrNoRows {
		err = d.Conn.QueryRow(`
			INSERT INTO hosts (hostname, cpu_model, cpu_cores, total_memory)
			VALUES ($1, $2, $3, $4) RETURNING id`,
			h.Hostname, h.CPUModel, h.CPUCores, h.TotalMemory).Scan(&id)
	} else if err == nil {
		// Update
		_, err = d.Conn.Exec(`UPDATE hosts SET cpu_model=$1, cpu_cores=$2, total_memory=$3 WHERE id=$4`,
			h.CPUModel, h.CPUCores, h.TotalMemory, id)
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

func (d *DB) GetHost() (*Host, error) {
	// Just get the first host for now as we treat this as a single-node collector mostly
	var h Host
	err := d.Conn.QueryRow("SELECT id, hostname, cpu_model, cpu_cores, total_memory FROM hosts LIMIT 1").Scan(&h.ID, &h.Hostname, &h.CPUModel, &h.CPUCores, &h.TotalMemory)
	if err != nil {
		return nil, err
	}
	return &h, nil
}
