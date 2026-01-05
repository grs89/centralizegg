package collector

import (
	"fmt"
	"io/ioutil"
	"log"
	"net"
	"time"

	"github.com/beevik/etree"
	"github.com/digitalocean/go-libvirt"
	"github.com/grs/centralizegg/internal/storage"
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
			mc.DB.SetServerStatus(s.ID, "offline")
			continue
		}
		mc.DB.SetServerStatus(s.ID, "online")
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
		Timeout:         10 * time.Second,
	}

	// Address like "192.168.1.100:22"
	// Sanitize IP if it contains a port (user error)
	ip := s.IPAddress
	if host, _, err := net.SplitHostPort(ip); err == nil {
		ip = host
	}

	port := s.SSHPort
	if port == 0 {
		port = 22
	}
	addr := fmt.Sprintf("%s:%d", ip, port)
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
		state, maxMem, memory, vcpu, cpuTime, err := l.DomainGetInfo(dom)
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

		// 4. Get I/O Stats (Disk & Network)
		var diskRead, diskWrite, netRX, netTX uint64

		// Get XML Desc to find device names
		xmlData, err := l.DomainGetXMLDesc(dom, 0)
		if err == nil {
			doc := etree.NewDocument()
			if err := doc.ReadFromString(xmlData); err == nil {
				// Sum Disk stats
				for _, disk := range doc.FindElements("//devices/disk/target") {
					dev := disk.SelectAttrValue("dev", "")
					if dev != "" {
						_, dr, _, dw, _, err := l.DomainBlockStats(dom, dev)
						if err == nil {
							diskRead += uint64(dr)
							diskWrite += uint64(dw)
						}
					}
				}
				// Sum Network stats
				for _, iface := range doc.FindElements("//devices/interface/target") {
					dev := iface.SelectAttrValue("dev", "")
					if dev != "" {
						rxB, _, _, _, txB, _, _, _, err := l.DomainInterfaceStats(dom, dev)
						if err == nil {
							netRX += uint64(rxB)
							netTX += uint64(txB)
						}
					}
				}
			}
		}

		vm := storage.VM{
			Name:        dom.Name,
			State:       stateStr,
			VCPU:        int(vcpu),
			CPUTime:     cpuTime,
			MemoryUsage: memory * 1024,
			MaxMemory:   maxMem * 1024,
			DiskRead:    diskRead,
			DiskWrite:   diskWrite,
			NetRX:       netRX,
			NetTX:       netTX,
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
