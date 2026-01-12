package virtualization

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net"
	"time"

	"strings"

	"github.com/beevik/etree"
	"github.com/digitalocean/go-libvirt"
	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"golang.org/x/crypto/ssh"
)

type DiskStat struct {
	Device     string `json:"device"`
	Capacity   uint64 `json:"capacity"`
	Allocation uint64 `json:"allocation"`
}

type BridgeStat struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	NetRX  uint64 `json:"net_rx"`
	NetTX  uint64 `json:"net_tx"`
}

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

func (mc *MultiCollector) Start(interval time.Duration) {
	ticker := time.NewTicker(interval)
	for range ticker.C {
		mc.CollectAll()
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

	// New session for Public IP
	var publicIP string
	sessionPub, err := sshClient.NewSession()
	if err == nil {
		defer sessionPub.Close()
		// Get Public IP
		pubOutput, err := sessionPub.Output("curl -s https://ifconfig.me || wget -qO- https://ifconfig.me || echo 'N/A'")
		if err == nil {
			publicIP = string(pubOutput)
			if len(publicIP) > 0 && publicIP[len(publicIP)-1] == '\n' {
				publicIP = publicIP[:len(publicIP)-1]
			}
		}
	}

	// New session for DNS
	var dnsServers string
	sessionDNS, err := sshClient.NewSession()
	if err == nil {
		defer sessionDNS.Close()
		// Get DNS Servers
		dnsOutput, err := sessionDNS.Output("grep nameserver /etc/resolv.conf | awk '{print $2}' | xargs")
		if err == nil {
			dnsServers = string(dnsOutput)
			if len(dnsServers) > 0 && dnsServers[len(dnsServers)-1] == '\n' {
				dnsServers = dnsServers[:len(dnsServers)-1]
			}
		}
	}

	// New session for Uptime
	var uptime string
	sessionUptime, err := sshClient.NewSession()
	if err == nil {
		defer sessionUptime.Close()
		// Get Uptime
		upOutput, err := sessionUptime.Output("uptime -p")
		if err == nil {
			uptime = string(upOutput)
			if len(uptime) > 0 && uptime[len(uptime)-1] == '\n' {
				uptime = uptime[:len(uptime)-1]
			}
		}
	}

	// New session for Update Status
	var updateStatus = "Up to Date"
	sessionUpd, err := sshClient.NewSession()
	if err == nil {
		defer sessionUpd.Close()
		// Try apt first, then dnf
		cmd := "apt-get -s upgrade 2>/dev/null | grep -P '^\\d+ upgraded' | cut -d' ' -f1 || dnf check-update -q 2>/dev/null | grep -c '^[a-zA-Z0-9]' || echo 0"
		updOutput, err := sessionUpd.Output(cmd)
		if err == nil {
			var count int
			fmt.Sscanf(string(updOutput), "%d", &count)
			if count > 0 {
				updateStatus = fmt.Sprintf("%d Updates Available", count)
			} else {
				updateStatus = "Up to Date"
			}
		}
	}

	// New session for Temperature
	var temperature float64
	sessionTemp, err := sshClient.NewSession()
	if err == nil {
		defer sessionTemp.Close()
		tempOutput, err := sessionTemp.Output("cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | head -n 1 || echo 0")
		if err == nil {
			var tempRaw int64
			fmt.Sscanf(string(tempOutput), "%d", &tempRaw)
			temperature = float64(tempRaw) / 1000.0
		}
	}

	// New session for Disks
	var disksJSON = "[]"
	sessionDisks, err := sshClient.NewSession()
	if err == nil {
		defer sessionDisks.Close()
		// Get Disks (mount points starting with /)
		diskOutput, err := sessionDisks.Output("df -B1 --output=target,size,used,pcent | grep '^/'")
		if err == nil {
			output := string(diskOutput)
			lines := strings.Split(strings.TrimSpace(output), "\n")
			var disks []DiskStat
			for _, line := range lines {
				parts := strings.Fields(line)
				if len(parts) >= 3 {
					var size, used uint64
					fmt.Sscanf(parts[1], "%d", &size)
					fmt.Sscanf(parts[2], "%d", &used)
					disks = append(disks, DiskStat{
						Device:     parts[0],
						Capacity:   size,
						Allocation: used,
					})
				}
			}
			b, _ := json.Marshal(disks)
			disksJSON = string(b)
		}
	}

	// New session for Bridge Interfaces
	var bridgesJSON = "[]"
	sessionBridges, err := sshClient.NewSession()
	if err == nil {
		defer sessionBridges.Close()
		// Get Bridge names, status, RX bytes, and TX bytes
		// Using awk to get traffic from /proc/net/dev and operstate from sysfs
		cmd := `awk -F: '/(br|virbr)/ {iface=$1; gsub(/ /, "", iface); cmd="cat /sys/class/net/"iface"/operstate 2>/dev/null"; cmd | getline status; close(cmd); if(status == "") status="unknown"; print iface, status, $2, $10}' /proc/net/dev`
		brOutput, err := sessionBridges.Output(cmd)
		if err == nil {
			output := string(brOutput)
			lines := strings.Split(strings.TrimSpace(output), "\n")
			var bridges []BridgeStat
			for _, line := range lines {
				parts := strings.Fields(line)
				if len(parts) >= 4 {
					var rx, tx uint64
					fmt.Sscanf(parts[2], "%d", &rx)
					fmt.Sscanf(parts[3], "%d", &tx)
					bridges = append(bridges, BridgeStat{
						Name:   parts[0],
						Status: parts[1],
						NetRX:  rx,
						NetTX:  tx,
					})
				}
			}
			b, _ := json.Marshal(bridges)
			bridgesJSON = string(b)
		}
	}

	// New session for OOM Killer events
	var oomJSON = "[]"
	sessionOOM, err := sshClient.NewSession()
	if err == nil {
		defer sessionOOM.Close()
		// Return only the last 3 events as a simple list of strings
		cmd := `dmesg | grep -i "oom-killer" | tail -n 3 || echo ""`
		oomOutput, err := sessionOOM.Output(cmd)
		if err == nil {
			output := strings.TrimSpace(string(oomOutput))
			if output != "" {
				events := strings.Split(output, "\n")
				b, _ := json.Marshal(events)
				oomJSON = string(b)
			}
		}
	}

	h := data_centralizegg.Host{
		ServerID:         s.ID,
		Hostname:         hostName,
		CPUModel:         int8ToString(model[:]),
		CPUCores:         int(cpus),
		TotalMemory:      uint64(memory) * 1024,
		FreeMemory:       freeMem,
		CPUUsage:         cpuUsage,
		OSName:           osName,
		PublicIP:         publicIP,
		DNSServers:       dnsServers,
		Uptime:           uptime,
		UpdateStatus:     updateStatus,
		Temperature:      temperature,
		Disks:            disksJSON,
		BridgeInterfaces: bridgesJSON,
		OOMEvents:        oomJSON,
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
		var diskStats []DiskStat

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
							diskStats = append(diskStats, DiskStat{
								Device:     dev,
								Capacity:   cap,
								Allocation: alloc,
							})
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

		// QEMU Guest OS Info
		var osName string
		// Try guest-get-osinfo if agent is available
		if true { // Wrapping to keep scope clean or just nice spacing
			cmd := `{"execute": "guest-get-osinfo"}`
			// QEMUDomainAgentCommand(Dom Domain, Cmd string, Timeout int32, Flags uint32) (rResult OptString, err error)
			respOpt, err := l.QEMUDomainAgentCommand(dom, cmd, 5, 0)
			if err == nil {
				// OptString is defined as []string in go-libvirt (usually)
				// We need to check assuming it is []string based on common go-libvirt patterns for nullable strings in XDR
				var resp string
				if len(respOpt) > 0 {
					resp = respOpt[0]
				}

				if resp != "" {
					var result struct {
						Return struct {
							PrettyName string `json:"pretty-name"`
							Name       string `json:"name"`
							Version    string `json:"version"`
							VersionId  string `json:"version-id"`
							Id         string `json:"id"`
						} `json:"return"`
					}
					if err := json.Unmarshal([]byte(resp), &result); err == nil {
						if result.Return.PrettyName != "" {
							osName = result.Return.PrettyName
						} else if result.Return.Name != "" {
							osName = fmt.Sprintf("%s %s", result.Return.Name, result.Return.Version)
						}
					}
				}
			}
		}

		// Serialize DiskStats
		disksJSON, _ := json.Marshal(diskStats)

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
			Disks:          string(disksJSON),
			OSName:         osName,
			GuestIPs:       guestIPs,
			GuestFSUsage:   guestFSUsage,
			HostID:         hostID,
		}

		mc.DB.UpsertVM(vm)
	}

	return nil
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
