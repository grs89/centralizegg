package collector

import (
	"log"
	"net"
	"time"

	"github.com/digitalocean/go-libvirt"
	"github.com/grs/centralize/internal/storage"
)

type Collector struct {
	LibvirtConn *libvirt.Libvirt
	DB          *storage.DB
	Hostname    string
}

func NewCollector(socketPath string, db *storage.DB) (*Collector, error) {
	// Connect to Libvirt
	// Typically /var/run/libvirt/libvirt-sock
	c, err := net.DialTimeout("unix", socketPath, 2*time.Second)
	if err != nil {
		return nil, err
	}

	l := libvirt.New(c)
	if err := l.Connect(); err != nil {
		return nil, err
	}

	// Get hostname from libvirt
	host, err := l.ConnectGetHostname()
	if err != nil {
		host = "unknown-host"
	}

	return &Collector{
		LibvirtConn: l,
		DB:          db,
		Hostname:    host,
	}, nil
}

func (c *Collector) CollectAndSave() error {
	// 1. Collect Host Info
	model, memory, cpus, _, _, _, _, _, err := c.LibvirtConn.NodeGetInfo()
	if err != nil {
		log.Printf("Failed to get node info: %v", err)
	} else {
		// Save Host
		h := storage.Host{
			Hostname:    c.Hostname,
			CPUModel:    string(model[:]), // Simple char array conversion might need trim
			CPUCores:    int(cpus),
			TotalMemory: uint64(memory) * 1024, // kB to bytes
		}
		hostID, err := c.DB.UpsertHost(h)
		if err != nil {
			log.Printf("Failed to upsert host: %v", err)
		}

		// 2. Collect VMs
		flags := libvirt.ConnectListDomainsActive | libvirt.ConnectListDomainsInactive
		domains, _, err := c.LibvirtConn.ConnectListAllDomains(100, flags)
		if err != nil {
			log.Printf("Failed to list domains: %v", err)
			return err
		}

		for _, dom := range domains {
			// Get Stats
			// Using DomainGetInfo for basic stats. For more detailed bulk stats, DomainListGetStats is better but sticking to simple for now.
			info, err := c.LibvirtConn.DomainGetInfo(dom)
			if err != nil {
				log.Printf("Failed to get info for domain %s: %v", dom.Name, err)
				continue
			}

			stateStr := "Unknown"
			switch info.State {
			case libvirt.DomainRunning:
				stateStr = "Running"
			case libvirt.DomainBlocked:
				stateStr = "Blocked"
			case libvirt.DomainPaused:
				stateStr = "Paused"
			case libvirt.DomainShutdown:
				stateStr = "Shutdown"
			case libvirt.DomainShutoff:
				stateStr = "Shutoff"
			case libvirt.DomainCrashed:
				stateStr = "Crashed"
			case libvirt.DomainPmsuspended:
				stateStr = "Suspended"
			}

			vm := storage.VM{
				Name:        dom.Name,
				State:       stateStr,
				CPUTime:     info.CpuTime,
				MemoryUsage: info.Memory * 1024, // kB to bytes
				MaxMemory:   info.MaxMem * 1024,
				HostID:      hostID,
			}

			if err := c.DB.UpsertVM(vm); err != nil {
				log.Printf("Failed to upsert VM %s: %v", dom.Name, err)
			}
		}
	}
	return nil
}

func (c *Collector) Start(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run once immediately
	if err := c.CollectAndSave(); err != nil {
		log.Printf("Initial collection failed: %v", err)
	}

	for range ticker.C {
		if err := c.CollectAndSave(); err != nil {
			log.Printf("Collection failed: %v", err)
		}
	}
}
