package virtualization

import (
	"fmt"
	"io/ioutil"
	"log"
	"net"
	"time"

	"github.com/beevik/etree"
	"github.com/digitalocean/go-libvirt"
	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"golang.org/x/crypto/ssh"
)

type vmStats struct {
	cpuTime uint64
	lastAt  time.Time
}

type MultiCollector struct {
	DB      *data_centralizegg.DB
	lastVMs map[string]vmStats // Key: hostID-vmName
}

func NewMultiCollector(db *data_centralizegg.DB) *MultiCollector {
	return &MultiCollector{
		DB:      db,
		lastVMs: make(map[string]vmStats),
	}
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

func (mc *MultiCollector) collectOne(s data_centralizegg.KVMServer) error {

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
	}

	config := &ssh.ClientConfig{
		User:            s.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: Use proper known_hosts for prod
		Timeout:         10 * time.Second,
	}

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

	conn, err := sshClient.Dial("unix", "/var/run/libvirt/libvirt-sock")
	if err != nil {
		return fmt.Errorf("remote libvirt socket: %w", err)
	}
	defer conn.Close()

	l := libvirt.New(conn)
	if err := l.Connect(); err != nil {
		return fmt.Errorf("libvirt connect: %w", err)
	}
	defer l.Disconnect()

	hostBytes, err := l.ConnectGetHostname()
	hostName := s.Name
	if err == nil {
		hostName = hostBytes
	}
	model, memory, cpus, _, _, _, _, _, err := l.NodeGetInfo()
	if err != nil {
		return fmt.Errorf("node info: %w", err)
	}

	// Fetch OS Name and Free Memory via SSH
	osName := "Unknown OS"
	var freeMem uint64

	session, err := sshClient.NewSession()
	if err == nil {
		defer session.Close()
		// Get OS Name
		output, err := session.Output("grep PRETTY_NAME /etc/os-release | cut -d '\"' -f 2")
		if err == nil {
			osName = string(output)
			if len(osName) > 0 && osName[len(osName)-1] == '\n' {
				osName = osName[:len(osName)-1]
			}
		}
	}

	// New session for memory info
	sessionMem, err := sshClient.NewSession()
	if err == nil {
		defer sessionMem.Close()
		// Get Available Memory in bytes using /proc/meminfo
		memOutput, err := sessionMem.Output("grep MemAvailable /proc/meminfo | awk '{print $2 * 1024}'")
		if err == nil {
			fmt.Sscanf(string(memOutput), "%d", &freeMem)
		} else {
			// Fallback to MemFree if Available is missing
			sessionMem2, _ := sshClient.NewSession()
			if sessionMem2 != nil {
				defer sessionMem2.Close()
				memOutput2, _ := sessionMem2.Output("grep MemFree /proc/meminfo | awk '{print $2 * 1024}'")
				fmt.Sscanf(string(memOutput2), "%d", &freeMem)
			}
		}
	}

	// New session for CPU usage
	var cpuUsage float64
	sessionCPU, err := sshClient.NewSession()
	if err == nil {
		defer sessionCPU.Close()
		// Get CPU Usage percentage (100 - idle)
		cpuOutput, err := sessionCPU.Output("top -bn1 | grep 'Cpu(s)' | awk '{print $2 + $4}'")
		if err == nil {
			fmt.Sscanf(string(cpuOutput), "%f", &cpuUsage)
		}
	}

	h := data_centralizegg.Host{
		ServerID:    s.ID,
		Hostname:    hostName,
		CPUModel:    int8ToString(model[:]),
		CPUCores:    int(cpus),
		TotalMemory: uint64(memory) * 1024,
		FreeMemory:  freeMem,
		CPUUsage:    cpuUsage,
		OSName:      osName,
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

		// Calculate CPU Usage %
		var cpuUsage float64
		key := fmt.Sprintf("%d-%s", hostID, dom.Name)
		now := time.Now()
		if prev, ok := mc.lastVMs[key]; ok {
			deltaStats := float64(cpuTime - prev.cpuTime)
			deltaTime := now.Sub(prev.lastAt).Seconds()
			if deltaTime > 0 && vcpu > 0 {
				// cpuUsage = (nanoseconds / (delta_seconds * 1e9 * cores)) * 100
				cpuUsage = (deltaStats / (deltaTime * 1e9 * float64(vcpu))) * 100
				if cpuUsage > 100 {
					cpuUsage = 100
				}
			}
		}
		mc.lastVMs[key] = vmStats{cpuTime: cpuTime, lastAt: now}

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

		var diskRead, diskWrite, netRX, netTX uint64
		var diskCapacity, diskAllocation uint64

		xmlData, err := l.DomainGetXMLDesc(dom, 0)
		if err == nil {
			doc := etree.NewDocument()
			if err := doc.ReadFromString(xmlData); err == nil {
				for _, disk := range doc.FindElements("//devices/disk/target") {
					dev := disk.SelectAttrValue("dev", "")
					if dev != "" {
						_, dr, _, dw, _, err := l.DomainBlockStats(dom, dev)
						if err == nil {
							diskRead += uint64(dr)
							diskWrite += uint64(dw)
						}
						// Get Block Info for capacity
						cap, alloc, _, err := l.DomainGetBlockInfo(dom, dev, 0)
						if err == nil {
							diskCapacity += cap
							diskAllocation += alloc
						}
					}
				}
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

		// QEMU Guest Agent Data
		var guestIPs, guestFSUsage string

		// Get IPs via Agent
		ifaces, err := l.DomainInterfaceAddresses(dom, uint32(libvirt.DomainInterfaceAddressesSrcAgent), 0)
		if err == nil {
			var ipList []string
			for _, iface := range ifaces {
				for _, addr := range iface.Addrs {
					// Filter out loopback (127.0.0.1, ::1) usually
					// Just taking everything for now, or maybe only IPv4?
					ipList = append(ipList, addr.Addr)
				}
			}
			// Just join them roughly
			if len(ipList) > 0 {
				guestIPs = fmt.Sprintf("%v", ipList)
				// Clean up brackets [ ] if standard print
				if len(guestIPs) > 1 {
					guestIPs = guestIPs[1 : len(guestIPs)-1]
				}
			}
		}

		// Get FS Info via Agent
		// Note: The current go-libvirt struct implementation does not expose Total/Used bytes directly.
		// Leaving empty for now or implementation via alternate method (SSH/Custom).
		if false {
			fsInfos, _, err := l.DomainGetFsinfo(dom, 0)
			if err == nil {
				var usages []string
				for _, fs := range fsInfos {
					mount := fs.Mountpoint
					usages = append(usages, mount)
				}
				if len(usages) > 0 {
					guestFSUsage = fmt.Sprintf("%v", usages)
				}
			}
		}

		vm := data_centralizegg.VM{
			Name:           dom.Name,
			State:          stateStr,
			VCPU:           int(vcpu),
			CPUTime:        cpuTime,
			CPUUsage:       cpuUsage,
			MemoryUsage:    memory * 1024,
			MaxMemory:      maxMem * 1024,
			DiskAllocation: diskAllocation,
			DiskCapacity:   diskCapacity,
			DiskRead:       diskRead,
			DiskWrite:      diskWrite,
			NetRX:          netRX,
			NetTX:          netTX,
			GuestIPs:       guestIPs,
			GuestFSUsage:   guestFSUsage,
			HostID:         hostID,
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
