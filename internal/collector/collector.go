package collector

import (
	"fmt"
	"io/ioutil"
	"log"
	"time"

	"github.com/digitalocean/go-libvirt"
	"github.com/grs/centralize/internal/storage"
	"golang.org/x/crypto/ssh"
)

type MultiCollector struct {
	DB *storage.DB
}

func NewMultiCollector(db *storage.DB) *MultiCollector {
	return &MultiCollector{DB: db}
}

func (mc *MultiCollector) CollectAll() {
	servers, err := mc.DB.GetServers()
	if err != nil {
		log.Printf("Failed to get servers: %v", err)
		return
	}

	for _, s := range servers {
		if err := mc.collectOne(s); err != nil {
			log.Printf("Failed to collect from %s (%s): %v", s.Name, s.IPAddress, err)
		}
	}
}

func (mc *MultiCollector) collectOne(s storage.KVMServer) error {
	var authMethods []ssh.AuthMethod

	if s.Password != "" {
		authMethods = append(authMethods, ssh.Password(s.Password))
	}

	// Always try key if present (default or custom)
	if s.SSHKeyPath != "" {
		key, err := ioutil.ReadFile(s.SSHKeyPath)
		if err == nil {
			signer, err := ssh.ParsePrivateKey(key)
			if err == nil {
				authMethods = append(authMethods, ssh.PublicKeys(signer))
			}
		}
		// If we fail to read key but password is provided, we might still succeed.
		// If both fail, Dial will fail.
	}

	config := &ssh.ClientConfig{
		User:            s.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: Use proper known_hosts for prod
		Timeout:         5 * time.Second,
	}

	// Address like "192.168.1.100:22"
	port := s.SSHPort
	if port == 0 {
		port = 22
	}
	addr := fmt.Sprintf("%s:%d", s.IPAddress, port)
	sshClient, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return fmt.Errorf("ssh dial: %w", err)
	}
	defer sshClient.Close()

	// 2. Dial Libvirt over SSH using "net.Conn" interface of SSH
	// We need to connect to the unix socket ON THE REMOTE machine
	conn, err := sshClient.Dial("unix", "/var/run/libvirt/libvirt-sock")
	if err != nil {
		return fmt.Errorf("remote libvirt socket: %w", err)
	}
	// We don't close 'conn' explicitly here because libvirt.New(conn) takes ownership or we defer?
	// actually libvirt does not close it automatically on disconnect? Safe to defer close.
	defer conn.Close()

	l := libvirt.New(conn)
	if err := l.Connect(); err != nil {
		return fmt.Errorf("libvirt connect: %w", err)
	}
	defer l.Disconnect()

	// 3. Logic copied from original collector
	// Get hostname from libvirt
	hostBytes, err := l.ConnectGetHostname()
	hostName := s.Name
	if err == nil {
		hostName = hostBytes // Use actual hostname if available, or keep config Name as alias? Let's use config name for consistency in UI for now, or concat.
	}

	model, memory, cpus, _, _, _, _, _, err := l.NodeGetInfo()
	if err != nil {
		return fmt.Errorf("node info: %w", err)
	}

	h := storage.Host{
		ServerID:    s.ID,
		Hostname:    hostName,
		CPUModel:    int8ToString(model[:]),
		CPUCores:    int(cpus),
		TotalMemory: uint64(memory) * 1024,
	}

	hostID, err := mc.DB.UpsertHost(h)
	if err != nil {
		return fmt.Errorf("upsert host: %w", err)
	}

	flags := libvirt.ConnectListDomainsActive | libvirt.ConnectListDomainsInactive
	domains, _, err := l.ConnectListAllDomains(100, flags)
	if err != nil {
		return fmt.Errorf("list domains: %w", err)
	}

	for _, dom := range domains {
		state, maxMem, memory, _, cpuTime, err := l.DomainGetInfo(dom)
		if err != nil {
			continue
		}

		stateStr := "Unknown"
		switch libvirt.DomainState(state) {
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
			CPUTime:     cpuTime,
			MemoryUsage: memory * 1024,
			MaxMemory:   maxMem * 1024,
			HostID:      hostID,
		}

		mc.DB.UpsertVM(vm)
	}

	return nil
}

func (mc *MultiCollector) Start(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	mc.CollectAll() // First run

	for range ticker.C {
		mc.CollectAll()
	}
}

func int8ToString(bs []int8) string {
	b := make([]byte, len(bs))
	for i, v := range bs {
		if v == 0 {
			return string(b[:i])
		}
		b[i] = byte(v)
	}
	return string(b)
}
