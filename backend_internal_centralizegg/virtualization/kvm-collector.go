package virtualization

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net"
	"strconv"
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
	ReadIO     uint64 `json:"read_io"`
	WriteIO    uint64 `json:"write_io"`
}

type BridgeStat struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	IP     string `json:"ip"`
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
			// Insert "down" metric point
			mc.DB.InsertServerMetrics(data_centralizegg.ServerMetric{
				ServerID:  s.ID,
				Category:  "kvm",
				Timestamp: time.Now(),
				IsOnline:  false,
			})
			continue
		}
		log.Printf("[KVMCollector] Successfully collected from %s.", s.Name)
		mc.DB.SetServerStatus(s.ID, "online")
	}
}

func (mc *MultiCollector) collectOne(s data_centralizegg.KVMServer) error {

	var authMethods []ssh.AuthMethod

	if s.Password != "" {
		authMethods = append(authMethods, ssh.Password(s.Password))
	}

	// Always try key if present (default or custom)
	if s.SSHKeyContent != "" {
		signer, err := ssh.ParsePrivateKey([]byte(s.SSHKeyContent))
		if err == nil {
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		}
	} else if s.SSHKeyPath != "" {
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

	// Fetch logs and save to DB
	mc.storeHostLogs(sshClient, s.ID)

	hostBytes, err := l.ConnectGetHostname()
	hostName := s.Name
	if err == nil {
		hostName = hostBytes
	}
	model, memory, cpus, _, _, _, _, _, err := l.NodeGetInfo()
	if err != nil {
		return fmt.Errorf("node info: %w", err)
	}

	// Fetch OS Name, Architecture and Free Memory via SSH
	osName := "Unknown OS"
	arch := "Unknown"
	var freeMem uint64

	session, err := sshClient.NewSession()
	if err == nil {
		defer session.Close()
		// Get OS Name and Architecture
		output, err := session.Output("grep PRETTY_NAME /etc/os-release | cut -d '\"' -f 2 && uname -m")
		if err == nil {
			lines := strings.Split(strings.TrimSpace(string(output)), "\n")
			if len(lines) >= 1 {
				osName = lines[0]
			}
			if len(lines) >= 2 {
				arch = lines[1]
			}
		}
	}

	// New session for memory info
	sessionMem, err := sshClient.NewSession()
	if err == nil {
		defer sessionMem.Close()
		// Get Memory Info: Read /proc/meminfo and parse inside Go to avoid awk dependency
		memOutput, err := sessionMem.Output("cat /proc/meminfo")
		if err == nil {
			lines := strings.Split(string(memOutput), "\n")
			var memFree, memBuffers, memCached, memAvailable uint64
			var hasAvailable bool

			for _, line := range lines {
				parts := strings.Fields(line)
				if len(parts) >= 2 {
					var val uint64
					fmt.Sscanf(parts[1], "%d", &val)
					val = val * 1024 // Convert kB to bytes

					if strings.HasPrefix(parts[0], "MemFree:") {
						memFree = val
					} else if strings.HasPrefix(parts[0], "Buffers:") {
						memBuffers = val
					} else if strings.HasPrefix(parts[0], "Cached:") {
						memCached = val
					} else if strings.HasPrefix(parts[0], "MemAvailable:") {
						memAvailable = val
						hasAvailable = true
					}
				}
			}

			if hasAvailable {
				freeMem = memAvailable
			} else {
				// Fallback calculation for older kernels
				freeMem = memFree + memBuffers + memCached
			}
		}
	}

	// New session for CPU usage
	var cpuUsage float64
	sessionCPU, err := sshClient.NewSession()
	if err == nil {
		defer sessionCPU.Close()
		// Calculate CPU Usage using /proc/stat delta
		// Read stat, sleep 1, read stat
		cmd := "cat /proc/stat; sleep 1; cat /proc/stat"
		cpuOutput, err := sessionCPU.Output(cmd)
		if err == nil {
			lines := strings.Split(strings.TrimSpace(string(cpuOutput)), "\n")
			var total1, idle1, total2, idle2 float64
			var foundFirst bool

			for _, line := range lines {
				if strings.HasPrefix(line, "cpu ") {
					fields := strings.Fields(line)
					if len(fields) >= 5 {
						user, _ := strconv.ParseFloat(fields[1], 64)
						nice, _ := strconv.ParseFloat(fields[2], 64)
						system, _ := strconv.ParseFloat(fields[3], 64)
						idle, _ := strconv.ParseFloat(fields[4], 64)
						iowait := 0.0
						if len(fields) > 5 {
							iowait, _ = strconv.ParseFloat(fields[5], 64)
						}
						irq := 0.0
						if len(fields) > 6 {
							irq, _ = strconv.ParseFloat(fields[6], 64)
						}
						softirq := 0.0
						if len(fields) > 7 {
							softirq, _ = strconv.ParseFloat(fields[7], 64)
						}
						steal := 0.0
						if len(fields) > 8 {
							steal, _ = strconv.ParseFloat(fields[8], 64)
						}

						total := user + nice + system + idle + iowait + irq + softirq + steal

						if !foundFirst {
							total1 = total
							idle1 = idle
							foundFirst = true
						} else {
							total2 = total
							idle2 = idle
						}
					}
				}
			}

			if total2 > total1 {
				totalDelta := total2 - total1
				idleDelta := idle2 - idle1
				cpuUsage = ((totalDelta - idleDelta) / totalDelta) * 100
			}
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
	var totalNetRX, totalNetTX uint64
	var bridges []BridgeStat // Define outside for later use

	sessionBridges, err := sshClient.NewSession()
	if err == nil {
		defer sessionBridges.Close()
		// Get Bridge and Interface names, status, RX bytes, and TX bytes, plus IP
		// Capturing bridges (br, virbr) AND physical interfaces (eth, enp, eno, bond, ib) to ensure graph shows data
		cmd := `awk -F: '/(br|virbr|eth|enp|eno|bond|ib)/ {iface=$1; gsub(/ /, "", iface); cmd="cat /sys/class/net/"iface"/operstate 2>/dev/null"; cmd | getline status; close(cmd); if(status == "") status="unknown"; cmd2="ip -4 -o addr show "iface" 2>/dev/null | awk \"{print \\$4}\" | cut -d/ -f1 | head -n1"; cmd2 | getline ip; close(cmd2); if(ip == "") ip="No IP"; print iface, status, ip, $2, $10}' /proc/net/dev`
		brOutput, err := sessionBridges.Output(cmd)
		if err == nil {
			output := string(brOutput)
			lines := strings.Split(strings.TrimSpace(output), "\n")
			for _, line := range lines {
				parts := strings.Fields(line)
				if len(parts) >= 5 {
					var rx, tx uint64
					fmt.Sscanf(parts[3], "%d", &rx)
					fmt.Sscanf(parts[4], "%d", &tx)
					bridges = append(bridges, BridgeStat{
						Name:   parts[0],
						Status: parts[1],
						IP:     parts[2],
						NetRX:  rx,
						NetTX:  tx,
					})
					totalNetRX += rx
					totalNetTX += tx
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
		// Return only the last 5 events as a simple list of strings
		cmd := `dmesg | grep -i "oom-killer" | tail -n 5 || echo ""`
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

	// New session for Host Events (libvirt/kvm logs)
	var hostEventsJSON = "[]"
	sessionEvents, err := sshClient.NewSession()
	if err == nil {
		defer sessionEvents.Close()
		// Collect last 10 libvirt/qemu related logs from various sources
		// 1. journalctl service (systemd)
		// 2. journalctl tag (systemd)
		// 3. /var/log/libvirt/libvirtd.log (file)
		// 4. /var/log/syslog (grep)
		// 5. /var/log/messages (grep)
		// 6. dmesg (fallback)
		cmd := `
		OUT=$(journalctl -u libvirtd -n 10 --no-pager 2>/dev/null);
		if [ -z "$OUT" ]; then OUT=$(journalctl -t libvirtd -n 10 --no-pager 2>/dev/null); fi;
		if [ -z "$OUT" ] && [ -f /var/log/libvirt/libvirtd.log ]; then OUT=$(tail -n 10 /var/log/libvirt/libvirtd.log 2>/dev/null); fi;
		if [ -z "$OUT" ] && [ -f /var/log/syslog ]; then OUT=$(grep -Ei "libvirt|kvm|qemu" /var/log/syslog 2>/dev/null | tail -n 10); fi;
		if [ -z "$OUT" ] && [ -f /var/log/messages ]; then OUT=$(grep -Ei "libvirt|kvm|qemu" /var/log/messages 2>/dev/null | tail -n 10); fi;
		if [ -z "$OUT" ]; then OUT=$(dmesg | grep -i kvm | tail -n 10); fi;
		echo "$OUT"
		`
		eventsOutput, err := sessionEvents.Output(cmd)
		if err == nil {
			output := strings.TrimSpace(string(eventsOutput))
			if output != "" {
				events := strings.Split(output, "\n")
				// Filter out empty lines
				var filtered []string
				for _, e := range events {
					if strings.TrimSpace(e) != "" {
						filtered = append(filtered, e)
					}
				}
				b, _ := json.Marshal(filtered)
				hostEventsJSON = string(b)
			}
		}
	}

	// Active Connections
	activeConnsJSON := "[]"
	connsOutput, err := mc.runCommand(sshClient, `ss -tunp state established 2>/dev/null | grep -vE '127\.0\.0\.1|::1|169\.254\.' | awk 'NR>1 {print $5}'`)
	if err == nil {
		type ConnStat struct {
			RemoteIP string `json:"remote_ip"`
			Inbound  int    `json:"inbound"`
			Outbound int    `json:"outbound"`
		}
		statsMap := make(map[string]*ConnStat)
		lines := strings.Split(strings.TrimSpace(connsOutput), "\n")
		for _, line := range lines {
			remoteAddr := strings.TrimSpace(line)
			if remoteAddr == "" {
				continue
			}
			lastColon := strings.LastIndex(remoteAddr, ":")
			if lastColon > 0 {
				remoteIP := remoteAddr[:lastColon]
				remoteIP = strings.TrimPrefix(strings.TrimSuffix(remoteIP, "]"), "[")
				// Filter private, etc. (reuse logic if desired, or simple aggregation)
				// Basic private IP filtering
				isPrivate := strings.HasPrefix(remoteIP, "10.") ||
					strings.HasPrefix(remoteIP, "192.168.") ||
					strings.HasPrefix(remoteIP, "127.") ||
					strings.HasPrefix(remoteIP, "::1")

				if !isPrivate {
					if _, exists := statsMap[remoteIP]; !exists {
						statsMap[remoteIP] = &ConnStat{RemoteIP: remoteIP}
					}
					statsMap[remoteIP].Outbound++ // Assuming established outbound primarily or mixed. SS doesn't strictly distinguish direction easily without more flags, but we treat as activity.
				}
			}
		}
		var statsList []ConnStat
		for _, s := range statsMap {
			statsList = append(statsList, *s)
		}
		b, _ := json.Marshal(statsList)
		activeConnsJSON = string(b)
	}

	h := data_centralizegg.Host{
		ServerID:          s.ID,
		Hostname:          hostName,
		CPUModel:          int8ToString(model[:]),
		CPUCores:          int(cpus),
		TotalMemory:       uint64(memory) * 1024,
		FreeMemory:        freeMem,
		CPUUsage:          cpuUsage,
		OSName:            osName,
		PublicIP:          publicIP,
		DNSServers:        dnsServers,
		Uptime:            uptime,
		UpdateStatus:      updateStatus,
		Temperature:       temperature,
		Disks:             disksJSON,
		BridgeInterfaces:  bridgesJSON,
		OOMEvents:         oomJSON,
		HostEvents:        hostEventsJSON,
		ActiveConnections: activeConnsJSON,
		Architecture:      arch,
	}
	hostID, err := mc.DB.UpsertHost(h)
	if err != nil {
		return fmt.Errorf("upsert host: %w", err)
	}

	// Serialize Interface Stats for History
	interfacesMap := make(map[string]map[string]uint64)
	for _, b := range bridges {
		interfacesMap[b.Name] = map[string]uint64{
			"rx": b.NetRX,
			"tx": b.NetTX,
		}
	}
	interfacesJSON := "{}"
	if len(interfacesMap) > 0 {
		if b, err := json.Marshal(interfacesMap); err == nil {
			interfacesJSON = string(b)
		}
	}

	// New session for Host Disk I/O Stats (Read/Write Bytes)
	var totalDiskRead, totalDiskWrite uint64
	diskIOMap := make(map[string]map[string]uint64)
	sessionDiskIO, err := sshClient.NewSession()
	if err == nil {
		defer sessionDiskIO.Close()
		// Get sectors read ($6) and sectors written ($10) from /proc/diskstats for common physical devices
		cmd := `awk '/(sd[a-z]+|nvme[0-9]n[0-9]+|vd[a-z]+|xvd[a-z]+)$/ {print $3, $6, $10}' /proc/diskstats`
		ioOutput, err := sessionDiskIO.Output(cmd)
		if err == nil {
			lines := strings.Split(strings.TrimSpace(string(ioOutput)), "\n")
			for _, line := range lines {
				parts := strings.Fields(line)
				if len(parts) >= 3 {
					dev := parts[0]
					var rSect, wSect uint64
					fmt.Sscanf(parts[1], "%d", &rSect)
					fmt.Sscanf(parts[2], "%d", &wSect)

					rBytes := rSect * 512
					wBytes := wSect * 512

					totalDiskRead += rBytes
					totalDiskWrite += wBytes

					diskIOMap[dev] = map[string]uint64{
						"read":  rBytes,
						"write": wBytes,
					}
				}
			}
		}
	}

	// Calculate Total Disk Usage
	var totalDiskUsage, totalDiskCapacity uint64
	var parsedDisks []DiskStat
	if err := json.Unmarshal([]byte(disksJSON), &parsedDisks); err == nil {
		for _, d := range parsedDisks {
			totalDiskUsage += d.Allocation
			totalDiskCapacity += d.Capacity
		}
	}

	disksDataJSON := "{}"
	if len(diskIOMap) > 0 {
		if ds, err := json.Marshal(diskIOMap); err == nil {
			disksDataJSON = string(ds)
		}
	}

	// Insert Historical Metrics
	metric := data_centralizegg.ServerMetric{
		ServerID:       hostID,
		Category:       "kvm",
		Timestamp:      time.Now(),
		CPUUsage:       cpuUsage,
		MemoryUsage:    (uint64(memory) * 1024) - freeMem,
		NetRX:          totalNetRX,
		NetTX:          totalNetTX,
		DiskRead:       totalDiskRead,
		DiskWrite:      totalDiskWrite,
		DiskUsage:      totalDiskUsage,
		DiskTotal:      totalDiskCapacity,
		InterfacesData: interfacesJSON,
		DisksData:      disksDataJSON,
		IsOnline:       true,
	}
	if err := mc.DB.InsertServerMetrics(metric); err != nil {
		log.Printf("[KVMCollector] Failed to insert metrics for %s: %v", s.Name, err)
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
		var networkData = "[]"

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
				var netInbound []map[string]string
				for _, iface := range doc.FindElements("//devices/interface") {
					target := iface.SelectElement("target")
					source := iface.SelectElement("source")

					dev := ""
					if target != nil {
						dev = target.SelectAttrValue("dev", "")
					}

					bridge := ""
					if source != nil {
						bridge = source.SelectAttrValue("bridge", "")
					}

					if dev != "" {
						rxB, _, _, _, txB, _, _, _, err := l.DomainInterfaceStats(dom, dev)
						if err == nil {
							netRX += uint64(rxB)
							netTX += uint64(txB)
						}

						if bridge != "" {
							netInbound = append(netInbound, map[string]string{
								"interface": dev,
								"bridge":    bridge,
							})
						}
					}
				}
				netData, _ := json.Marshal(netInbound)
				networkData = string(netData)
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
			NetworkData:    networkData,
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

func (mc *MultiCollector) GetHostLogs(id int64) (string, error) {
	servers, err := mc.DB.GetServers()
	if err != nil {
		return "", err
	}
	var s data_centralizegg.KVMServer
	found := false
	for _, srv := range servers {
		if srv.ID == id {
			s = srv
			found = true
			break
		}
	}
	if !found {
		return "", fmt.Errorf("server not found")
	}

	client, err := mc.getSSHClient(s)
	if err != nil {
		return "", err
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput("journalctl -n 50 --no-pager")
	if err != nil {
		return string(output), err
	}
	return string(output), nil
}

// runCommand executes a command on the remote host via SSH
func (mc *MultiCollector) runCommand(client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

func (mc *MultiCollector) storeHostLogs(client *ssh.Client, serverID int64) {
	session, err := client.NewSession()
	if err != nil {
		return
	}
	defer session.Close()

	// Fetch last 10 lines to keep it light
	output, err := session.CombinedOutput("journalctl -n 10 --no-pager")
	if err != nil {
		return
	}

	logs := strings.TrimSpace(string(output))
	if logs != "" {
		// Save to DB
		_ = mc.DB.SaveHostLog("kvm", serverID, logs)
	}
}

func (mc *MultiCollector) getSSHClient(s data_centralizegg.KVMServer) (*ssh.Client, error) {
	var authMethods []ssh.AuthMethod
	if s.Password != "" {
		authMethods = append(authMethods, ssh.Password(s.Password))
	}
	if s.SSHKeyContent != "" {
		signer, err := ssh.ParsePrivateKey([]byte(s.SSHKeyContent))
		if err == nil {
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		}
	} else if s.SSHKeyPath != "" {
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
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", s.IPAddress, s.SSHPort)
	return ssh.Dial("tcp", addr, config)
}

func (mc *MultiCollector) getLibvirtClient(s data_centralizegg.KVMServer) (*libvirt.Libvirt, *ssh.Client, net.Conn, error) {
	sshClient, err := mc.getSSHClient(s)
	if err != nil {
		return nil, nil, nil, err
	}

	conn, err := sshClient.Dial("unix", "/var/run/libvirt/libvirt-sock")
	if err != nil {
		sshClient.Close()
		return nil, nil, nil, err
	}

	l := libvirt.New(conn)
	if err := l.Connect(); err != nil {
		conn.Close()
		sshClient.Close()
		return nil, nil, nil, err
	}

	return l, sshClient, conn, nil
}

func (mc *MultiCollector) StartVM(serverID int64, vmName string) error {
	servers, err := mc.DB.GetServers()
	if err != nil {
		return err
	}
	var s data_centralizegg.KVMServer
	found := false
	for _, srv := range servers {
		if srv.ID == serverID {
			s = srv
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("server not found")
	}

	l, sshClient, conn, err := mc.getLibvirtClient(s)
	if err != nil {
		return err
	}
	defer l.Disconnect()
	defer conn.Close()
	defer sshClient.Close()

	dom, err := l.DomainLookupByName(vmName)
	if err != nil {
		return err
	}

	return l.DomainCreate(dom)
}

func (mc *MultiCollector) StopVM(serverID int64, vmName string) error {
	servers, err := mc.DB.GetServers()
	if err != nil {
		return err
	}
	var s data_centralizegg.KVMServer
	found := false
	for _, srv := range servers {
		if srv.ID == serverID {
			s = srv
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("server not found")
	}

	l, sshClient, conn, err := mc.getLibvirtClient(s)
	if err != nil {
		return err
	}
	defer l.Disconnect()
	defer conn.Close()
	defer sshClient.Close()

	dom, err := l.DomainLookupByName(vmName)
	if err != nil {
		return err
	}

	return l.DomainDestroy(dom)
}

// Snapshot Management for KVM
func (mc *MultiCollector) GetSnapshots(serverID int64, vmName string) (string, error) {
	servers, err := mc.DB.GetServers()
	if err != nil {
		return "", err
	}
	var s data_centralizegg.KVMServer
	found := false
	for _, srv := range servers {
		if srv.ID == serverID {
			s = srv
			found = true
			break
		}
	}
	if !found {
		return "", fmt.Errorf("server not found")
	}

	_, sshClient, conn, err := mc.getLibvirtClient(s)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	defer sshClient.Close()

	cmd := fmt.Sprintf("virsh snapshot-list %s", vmName)
	output, err := mc.runCommand(sshClient, cmd)
	if err != nil {
		return "", err
	}

	lines := strings.Split(strings.TrimSpace(output), "\n")
	type SnapshotInfo struct {
		Name    string `json:"name"`
		Created string `json:"created"`
		State   string `json:"state"`
	}
	var snaps []SnapshotInfo
	for i, line := range lines {
		if i < 2 || strings.TrimSpace(line) == "" {
			continue // skip header
		}
		parts := strings.Fields(line)
		if len(parts) >= 3 {
			name := parts[0]
			var created string
			var state string
			if len(parts) >= 5 {
				created = parts[1] + " " + parts[2] + " " + parts[3]
				state = parts[4]
			} else {
				created = parts[1]
				state = parts[2]
			}
			snaps = append(snaps, SnapshotInfo{Name: name, Created: created, State: state})
		}
	}
	b, _ := json.Marshal(snaps)
	return string(b), nil
}

func (mc *MultiCollector) CreateSnapshot(serverID int64, vmName string, snapName string, desc string) error {
	servers, err := mc.DB.GetServers()
	if err != nil {
		return err
	}
	var s data_centralizegg.KVMServer
	for _, srv := range servers {
		if srv.ID == serverID {
			s = srv
			break
		}
	}
	if s.ID == 0 {
		return fmt.Errorf("server not found")
	}

	_, sshClient, conn, err := mc.getLibvirtClient(s)
	if err != nil {
		return err
	}
	defer conn.Close()
	defer sshClient.Close()

	cmd := fmt.Sprintf("virsh snapshot-create-as --domain %s --name %s --description \"%s\"", vmName, snapName, desc)
	_, err = mc.runCommand(sshClient, cmd)
	return err
}

func (mc *MultiCollector) RevertSnapshot(serverID int64, vmName string, snapName string) error {
	servers, err := mc.DB.GetServers()
	if err != nil {
		return err
	}
	var s data_centralizegg.KVMServer
	for _, srv := range servers {
		if srv.ID == serverID {
			s = srv
			break
		}
	}
	if s.ID == 0 {
		return fmt.Errorf("server not found")
	}

	_, sshClient, conn, err := mc.getLibvirtClient(s)
	if err != nil {
		return err
	}
	defer conn.Close()
	defer sshClient.Close()

	cmd := fmt.Sprintf("virsh snapshot-revert --domain %s --snapshotname %s", vmName, snapName)
	_, err = mc.runCommand(sshClient, cmd)
	return err
}

func (mc *MultiCollector) DeleteSnapshot(serverID int64, vmName string, snapName string) error {
	servers, err := mc.DB.GetServers()
	if err != nil {
		return err
	}
	var s data_centralizegg.KVMServer
	for _, srv := range servers {
		if srv.ID == serverID {
			s = srv
			break
		}
	}
	if s.ID == 0 {
		return fmt.Errorf("server not found")
	}

	_, sshClient, conn, err := mc.getLibvirtClient(s)
	if err != nil {
		return err
	}
	defer conn.Close()
	defer sshClient.Close()

	cmd := fmt.Sprintf("virsh snapshot-delete --domain %s --snapshotname %s", vmName, snapName)
	_, err = mc.runCommand(sshClient, cmd)
	return err
}
