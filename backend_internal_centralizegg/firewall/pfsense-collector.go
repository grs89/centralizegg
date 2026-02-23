package firewall

import (
	json "github.com/goccy/go-json"
	"fmt"
	"io/ioutil"
	"log"
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"golang.org/x/crypto/ssh"
)

type PfsenseCollector struct {
	DB *data_centralizegg.DB
}

func NewPFSenseCollector(db *data_centralizegg.DB) *PfsenseCollector {
	return &PfsenseCollector{
		DB: db,
	}
}

func (mc *PfsenseCollector) Start(interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			mc.CollectAll()
		}
	}()
}

func (mc *PfsenseCollector) CollectAll() {
	servers, err := mc.DB.GetPFSenseServers()
	if err != nil {
		log.Printf("Failed to get pfsense servers: %v", err)
		return
	}

	for _, s := range servers {
		metaMap := map[string]string{"ip": s.IPAddress, "name": s.Name}
		metaBytes, _ := json.Marshal(metaMap)
		metadata := string(metaBytes)

		if err := mc.collectOne(s); err != nil {
			log.Printf("Failed to collect from pfSense %s (%s): %v", s.Name, s.IPAddress, err)
			mc.DB.SetPFSenseServerStatus(s.ID, "offline", metadata)
			// Insert "down" metric point
			mc.DB.InsertServerMetrics(data_centralizegg.ServerMetric{
				ServerID:  s.ID,
				Category:  "pfsense",
				Timestamp: time.Now(),
				IsOnline:  false,
			})
			continue
		}
		log.Printf("[PFSenseCollector] Successfully collected from %s.", s.Name)
		mc.DB.SetPFSenseServerStatus(s.ID, "online", metadata)
	}
}

func (mc *PfsenseCollector) collectOne(s data_centralizegg.PFSenseServer) error {
	client, err := getSSHClient(s)
	if err != nil {
		return err
	}
	defer client.Close()

	// 1. Host Info
	hostname, err := runCommand(client, "hostname")
	if err != nil {
		return fmt.Errorf("hostname: %w", err)
	}
	uname, err := runCommand(client, "uname -m")
	if err != nil {
		// ignore
		uname = "unknown"
	}
	osRelease, err := runCommand(client, "uname -r")
	if err == nil {
		uname += " " + osRelease
	}

	// CPU Model (x86/ARM detection)
	cpuModel, err := runCommand(client, "sysctl -n hw.model")
	if err != nil {
		cpuModel = "Generic (" + strings.TrimSpace(uname) + ")"
	} else {
		cpuModel = strings.TrimSpace(cpuModel)
		// Append arch if not clear in model, though usually model is enough.
		// Let's ensure arch is visible in CPUModel if desired, or just rely on it.
		// "Intel(R) Core(TM)..." is good.
		// If ARM it might say "Apple M1" or generic ARM string.
	}

	// 2. CPU & Memory using top (FreeBSD style on pfSense)
	// top -d 1 -n 1
	topOut, err := runCommand(client, "top -d 1 -n 1")
	if err != nil {
		return fmt.Errorf("top: %w", err)
	}
	cpuUsage, memTotal, memFree, cpuCores := parseTopOutput(topOut)

	// Get better Total Memory
	sysctlMem, err := runCommand(client, "sysctl -n hw.physmem")
	if err == nil {
		val := strings.TrimSpace(sysctlMem)
		if parsed, err := strconv.ParseUint(val, 10, 64); err == nil {
			memTotal = parsed
		}
	}

	// 3a. Get Interface IP Addresses using ifconfig
	// We want to map InterfaceName -> IPAddress
	// ifconfig output parsing
	ifConfigOut, err := runCommand(client, "ifconfig")
	interfaceIPs := make(map[string]string)
	interfaceMACs := make(map[string]string)
	if err == nil {
		interfaceIPs, interfaceMACs = parseIfconfigIPs(ifConfigOut)
	}

	// 3. Network Interfaces (Stats) - Just collect strings first
	// netstat -bdi
	netStats, err := runCommand(client, "netstat -bdi")

	// 1b. Uptime
	uptimeOut, err := runCommand(client, "uptime")
	// Output: 10:48PM  up 1 day, 20 mins, 2 users, load averages: 0.17, 0.11, 0.08
	// We want "1 day, 20 mins"
	uptime := "Unknown"
	if err == nil {
		if idx := strings.Index(uptimeOut, "up"); idx != -1 {
			part := uptimeOut[idx+3:] // skip "up "
			// find next comma? No, standard uptime has multiple commas.
			// usually we want everything until "users" or "load"
			// users usually comes after time.
			if usersIdx := strings.Index(part, "user"); usersIdx != -1 {
				// up 1 day, 20 mins, 2 users
				// part[:usersIdx] -> "1 day, 20 mins, 2 "
				// last comma before users is what we want?
				// Actually typically: 10:48PM up 1 day, 20 mins, 2 users...
				// formatted is "1 day, 20 mins"
				raw := part[:usersIdx]
				// remove trailing comma and number of users
				// "1 day, 20 mins, 2 "
				lastComma := strings.LastIndex(raw, ",")
				if lastComma != -1 {
					uptime = strings.TrimSpace(raw[:lastComma])
				} else {
					uptime = strings.TrimSpace(raw)
				}
			} else {
				uptime = strings.TrimSpace(part)
			}
		}
	}

	// 1c. pfSense Version (More accurate than uname)
	pfVersion, err := runCommand(client, "cat /etc/version")
	if err == nil {
		pfVersion = strings.TrimSpace(pfVersion) // e.g., 2.7.2-RELEASE
	}

	// 1d. Update Status
	// Checking updates can be slow. "pkg version -v" might correspond to base system.
	// "pfSense-upgrade -c" is official but slow.
	// Let's assume Updated if version matches known? No.
	// For now, let's try a quick check via "pkg version -v | grep pfSense-pkg"
	// output: pfSense-pkg-2.7.2_1                    =
	// = means up to date. < means needs update.
	updateStatus := "Unknown"
	pkgOut, err := runCommand(client, "pkg version -v | grep '^pfSense-pkg'")
	if err == nil {
		if strings.Contains(pkgOut, "<") {
			updateStatus = "Update Available"
		} else if strings.Contains(pkgOut, "=") {
			updateStatus = "Up to Date"
		}
	}

	// 1e. DNS Servers
	dnsServers := ""
	resolvOut, err := runCommand(client, "cat /etc/resolv.conf")
	if err == nil {
		var servers []string
		lines := strings.Split(resolvOut, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "nameserver") {
				parts := strings.Fields(line)
				if len(parts) >= 2 {
					servers = append(servers, parts[1])
				}
			}
		}
		if len(servers) > 0 {
			dnsServers = strings.Join(servers, ", ")
		}
	}

	// ... [Other collection code] ...

	// 1f. Active Connections (pfctl -ss) - Aggregated
	activeConnsJSON := "[]"
	pfctlOut, err := runCommand(client, "pfctl -ss")
	if err == nil {
		// Aggregate by Remote IP
		type ConnStat struct {
			RemoteIP string `json:"remote_ip"`
			Inbound  int    `json:"inbound"`
			Outbound int    `json:"outbound"`
		}
		statsMap := make(map[string]*ConnStat)

		lines := strings.Split(pfctlOut, "\n")
		for _, line := range lines {
			// Example line: all tcp 192.168.1.105:51944 -> 1.1.1.1:853       ESTABLISHED:ESTABLISHED
			// Or: all udp 192.168.1.1:53 <- 8.8.8.8:53       NO_TRAFFIC:SINGLE
			// Direction arrows: -> (out), <- (in)

			// Simple parsing strategy: look for -> or <-
			direction := "" // "in" or "out"
			if strings.Contains(line, "->") {
				direction = "out"
			} else if strings.Contains(line, "<-") {
				direction = "in"
			} else {
				continue // Skip lines without clear direction
			}

			fields := strings.Fields(line)
			if len(fields) < 5 {
				continue
			}

			// Extract IPs based on arrow position?
			// Usually "LeftIP arrow RightIP"
			// If out (->): Left=Local, Right=Remote
			// If in (<-): Left=Local(Dest), Right=Remote(Src) - Wait, pfctl usually shows "RealSrc -> RealDest" or similar.
			// Let's rely on standard pfctl state output format:
			// "intf proto src -> dst state"
			// Actually pfctl -ss output varies.
			// Typically: "all tcp 192.168.1.5:1234 -> 1.2.3.4:80       ESTABLISHED:ESTABLISHED"

			// We need to robustly find the IPs.
			// Let's assume the arrow is the pivot.
			arrowIdx := -1
			for i, f := range fields {
				if f == "->" || f == "<-" {
					arrowIdx = i
					break
				}
			}

			if arrowIdx == -1 || arrowIdx == 0 || arrowIdx >= len(fields)-1 {
				continue
			}

			// left := fields[arrowIdx-1]
			right := fields[arrowIdx+1]

			// Remove ports (everything after last colon)
			removePort := func(s string) string {
				lastColon := strings.LastIndex(s, ":")
				if lastColon != -1 {
					return s[:lastColon]
				}
				return s
			}

			// leftIP := removePort(left)
			rightIP := removePort(right)

			var remoteIP string
			if direction == "out" {
				remoteIP = rightIP
			} else {
				remoteIP = rightIP // In "left <- right", right is typically the source (remote)
			}

			// Filter Private IPs (exclude 10., 192.168., 172.16-31., 127.)
			isPrivate := func(ip string) bool {
				return strings.HasPrefix(ip, "10.") ||
					strings.HasPrefix(ip, "192.168.") ||
					strings.HasPrefix(ip, "127.") ||
					(strings.HasPrefix(ip, "172.") && len(ip) > 6) // Simplified check for 172.16-31
			}

			if isPrivate(remoteIP) {
				continue
			}

			if _, exists := statsMap[remoteIP]; !exists {
				statsMap[remoteIP] = &ConnStat{RemoteIP: remoteIP}
			}

			if direction == "out" {
				statsMap[remoteIP].Outbound++
			} else {
				statsMap[remoteIP].Inbound++
			}
		}

		// Convert map to slice
		var statsList []ConnStat
		for _, s := range statsMap {
			statsList = append(statsList, *s)
		}

		// Sort by total connections (descending) and limit to top 100
		sort.Slice(statsList, func(i, j int) bool {
			totalI := statsList[i].Inbound + statsList[i].Outbound
			totalJ := statsList[j].Inbound + statsList[j].Outbound
			return totalI > totalJ
		})

		if len(statsList) > 100 {
			statsList = statsList[:100]
		}

		// Marshal (ignore error, empty list is fine)
		bytes, _ := json.Marshal(statsList)
		activeConnsJSON = string(bytes)
	}

	// 1g. State Table Size (pfctl -si)
	stateSize := int64(0)
	stateLimit := int64(0)
	pfInfoOut, err := runCommand(client, "pfctl -si")
	if err == nil {
		lines := strings.Split(pfInfoOut, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			// Output example:
			// current entries      10924        400000
			if strings.Contains(line, "current entries") {
				fields := strings.Fields(line)
				// fields: ["current", "entries", "10924", "400000"]
				if len(fields) >= 3 {
					if val, err := strconv.ParseInt(fields[2], 10, 64); err == nil {
						stateSize = val
					}
				}
				if len(fields) >= 4 {
					if val, err := strconv.ParseInt(fields[3], 10, 64); err == nil {
						stateLimit = val
					}
				}
			}
		}
	}

	// 1h. Temperature Check (Multiple OIDs)
	temperature := 0
	thermalOIDs := []string{
		"hw.sensors.cpu0.temp0",            // Common Intel/BSD
		"dev.cpu.0.temperature",            // Fallback standard
		"hw.acpi.thermal.tz0.temperature",  // ACPI Thermal Zone 0
		"hw.acpi.thermal.tz1.temperature",  // ACPI Thermal Zone 1
		"dev.amdtemp.0.sensor0",            // AMD CPUs
		"dev.amdtemp.0.core0.sensor0",      // Newer AMD
		"dev.armada_thermal.0.temperature", // Netgate ARM (SG-1100/2100)
	}

	for _, oid := range thermalOIDs {
		tempOut, err := runCommand(client, "sysctl -n "+oid)
		if err == nil && tempOut != "" {
			tempOut = strings.TrimSpace(tempOut)
			// Check if output is valid (sometimes returns "unknown" or empty lines)
			if tempOut == "unknown" || tempOut == "" {
				continue
			}

			// Clean up output "45.0C" -> "45.0"
			tempOut = strings.TrimSuffix(tempOut, "C")
			tempOut = strings.TrimSuffix(tempOut, "F")

			if val, err := strconv.ParseFloat(tempOut, 64); err == nil {
				// Sanity check: If temp is 0 or extremely high/low, ignore
				if val > 0 && val < 150 {
					temperature = int(val)
					break // Found a valid temp, stop searching
				}
			}
		}
	}

	// 1i. Host Events (pfSense logs)
	// pfSense uses clog for circular logs. System log is usually /var/log/system.log
	var hostEventsJSON = "[]"
	logOut, err := runCommand(client, "clog /var/log/system.log | tail -n 10 || tail -n 10 /var/log/system.log || echo ''")
	if err == nil {
		output := strings.TrimSpace(logOut)
		if output != "" {
			events := strings.Split(output, "\n")
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

	// 1j. Disk Usage (Root)
	var diskUsage, diskTotal uint64
	diskOut, err := runCommand(client, "df -k / | tail -n 1 | awk '{print $3, $2}'")
	if err == nil {
		var usedKB, totalKB uint64
		fmt.Sscanf(strings.TrimSpace(diskOut), "%d %d", &usedKB, &totalKB)
		diskUsage = usedKB * 1024
		diskTotal = totalKB * 1024
	}

	// Store Host Data first to get the correct HostID
	hostID, err := mc.DB.UpsertFirewallHost(data_centralizegg.FirewallHost{
		ServerID:          s.ID,
		Hostname:          strings.TrimSpace(hostname),
		CPUModel:          cpuModel,
		CPUCores:          cpuCores,
		TotalMemory:       memTotal,
		FreeMemory:        memFree,
		CPUUsage:          cpuUsage,
		OSName:            "pfSense " + pfVersion + " (" + strings.TrimSpace(uname) + ")",
		NetRXTotal:        0, // Aggregated from interfaces if needed
		NetTXTotal:        0,
		NetRXBytesPerSec:  0,
		NetTXBytesPerSec:  0,
		Uptime:            uptime,
		UpdateStatus:      updateStatus,
		StateTableSize:    stateSize,
		StateTableLimit:   stateLimit,
		Temperature:       temperature,
		DNSServers:        dnsServers,
		ActiveConnections: activeConnsJSON,
		HostEvents:        hostEventsJSON,
	})
	if err != nil {
		return fmt.Errorf("upsert host: %w", err)
	}

	// Now store interfaces using the correct hostID
	var netRXTotal, netTXTotal uint64
	var interfacesMap map[string]map[string]uint64
	if netStats != "" {
		netRXTotal, netTXTotal, interfacesMap = parseAndStoreInterfaces(mc.DB, hostID, netStats, interfaceIPs, interfaceMACs)
	}

	interfacesJSON := "{}"
	if len(interfacesMap) > 0 {
		if b, err := json.Marshal(interfacesMap); err == nil {
			interfacesJSON = string(b)
		}
	}

	// Host Disk I/O Stats (Read/Write Bytes)
	diskIOMap := make(map[string]map[string]uint64)
	var totalDiskRead, totalDiskWrite uint64
	diskIOOut, err := runCommand(client, "iostat -xI")
	if err == nil {
		lines := strings.Split(strings.TrimSpace(diskIOOut), "\n")
		// skip first two header lines
		for i := 2; i < len(lines); i++ {
			fields := strings.Fields(lines[i])
			if len(fields) >= 5 {
				dev := fields[0]
				kr, _ := strconv.ParseFloat(fields[3], 64)
				kw, _ := strconv.ParseFloat(fields[4], 64)
				rBytes := uint64(kr * 1024)
				wBytes := uint64(kw * 1024)
				totalDiskRead += rBytes
				totalDiskWrite += wBytes
				diskIOMap[dev] = map[string]uint64{
					"read":  rBytes,
					"write": wBytes,
				}
			}
		}
	}

	disksDataJSON := "{}"
	if len(diskIOMap) > 0 {
		if b, err := json.Marshal(diskIOMap); err == nil {
			disksDataJSON = string(b)
		}
	}

	// Insert Historical Metrics
	metric := data_centralizegg.ServerMetric{
		ServerID:       hostID,
		Category:       "pfsense", // Using 'pfsense' as category
		Timestamp:      time.Now(),
		CPUUsage:       cpuUsage,
		MemoryUsage:    memTotal - memFree,
		NetRX:          netRXTotal,
		NetTX:          netTXTotal,
		DiskRead:       totalDiskRead,
		DiskWrite:      totalDiskWrite,
		DiskUsage:      diskUsage,
		DiskTotal:      diskTotal,
		InterfacesData: interfacesJSON,
		DisksData:      disksDataJSON,
		IsOnline:       true,
	}
	if err := mc.DB.InsertServerMetrics(metric); err != nil {
		log.Printf("[PFSenseCollector] Failed to insert metrics: %v", err)
	}

	// 4. Gateway Status
	// Try multiple paths/commands as it varies by pfSense version
	gwCommands := []string{
		"/usr/local/bin/php /usr/local/www/pfSsh.php playback gatewaystatus",
		"/usr/local/bin/php /usr/local/sbin/pfSsh.php playback gatewaystatus",
		"pfSsh.php playback gatewaystatus",
	}

	var gwStatus string
	var gwErr error
	for _, cmd := range gwCommands {
		gwStatus, gwErr = runCommand(client, cmd)
		if gwErr == nil && gwStatus != "" {
			break
		}
	}

	if gwErr == nil {
		parseAndStoreGateways(mc.DB, hostID, gwStatus)
	} else {
		// Log error only if all attempts failed? No, gwErr is the last error.
		// Silence it to avoid spam if keys are missing etc, OR keep it but maybe as Info/Warn if critical?
		// User specifically wanted gateway monitoring, so missing it is bad.
		// But if the command fails consistently, logs will fill up.
		// Let's keep it but maybe commented out or less verbose?
		// Actually, let's keep it visible since we just fixed it.
		// log.Printf("[DEBUG-GW] Error running gateway command: %v", gwErr)
	}

	return nil
}

func getSSHClient(s data_centralizegg.PFSenseServer) (*ssh.Client, error) {
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
		Timeout:         10 * time.Second,
	}

	ip := s.IPAddress
	// Sanitize IP if user included port
	if host, _, err := net.SplitHostPort(ip); err == nil {
		ip = host
	}
	// Also strip any trailing colon if SplitHostPort didn't catch it (e.g. "1.2.3.4:")
	ip = strings.TrimRight(ip, ":")

	port := s.SSHPort
	if port == 0 {
		port = 22
	}
	addr := fmt.Sprintf("%s:%d", ip, port)
	return ssh.Dial("tcp", addr, config)
}

func runCommand(client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

func (pc *PfsenseCollector) storeHostLogs(client *ssh.Client, serverID int64) {
	// pfSense uses clog for system logs, fallback to tail
	cmd := "clog /var/log/system.log | tail -n 10 || tail -n 10 /var/log/system.log"
	output, err := runCommand(client, cmd)
	if err != nil {
		return
	}

	logs := strings.TrimSpace(output)
	if logs != "" {
		_ = pc.DB.SaveHostLog("pfsense", serverID, logs)
	}
}

func parseTopOutput(output string) (float64, uint64, uint64, int) {
	// Simple parser for FreeBSD top output
	// CPU:  1.2% user,  0.0% nice,  0.4% system,  0.4% interrupt, 98.0% idle
	// Mem: 68M Active, 2664M Inact, 755M Wired, 545M Buf, 23G Free

	cpuUsage := 0.0
	memTotal := uint64(0)
	memFree := uint64(0)
	cpuCores := 1 // default

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "CPU:") {
			// Extract idle
			re := regexp.MustCompile(`([\d\.]+)%\s*idle`)
			matches := re.FindStringSubmatch(line)
			if len(matches) > 1 {
				idle, _ := strconv.ParseFloat(matches[1], 64)
				cpuUsage = 100.0 - idle
			}
		} else if strings.HasPrefix(line, "Mem:") {
			// Parse memory
			// Re-parse simpler: look for "23G Free"
			// Actually simpler regex for Free:
			reFree := regexp.MustCompile(`(\d+[KMG])\s+Free`)
			freeMatch := reFree.FindStringSubmatch(line)
			if len(freeMatch) > 1 {
				memFree = parseBytes(freeMatch[1])
			}
		}
	}

	return cpuUsage, memTotal, memFree, cpuCores
}

func parseBytes(s string) uint64 {
	// 23G, 545M
	s = strings.ToUpper(s)
	clean := strings.TrimRight(s, "KMG")
	val, _ := strconv.ParseFloat(clean, 64)

	if strings.HasSuffix(s, "G") {
		return uint64(val * 1024 * 1024 * 1024)
	} else if strings.HasSuffix(s, "M") {
		return uint64(val * 1024 * 1024)
	} else if strings.HasSuffix(s, "K") {
		return uint64(val * 1024)
	}
	return uint64(val)
}

func parseIfconfigIPs(output string) (map[string]string, map[string]string) {
	// em0: flags=8843<UP,BROADCAST,RUNNING,SIMPLEX,MULTICAST> metric 0 mtu 1500
	//         options=810099<RXCSUM,VLAN_MTU,VLAN_HWTAGGING,VLAN_HWCSUM,VLAN_HWFILTER>
	//         ether 00:50:56:a6:31:3e
	//         inet 181.48.35.212 netmask 0xfffffff0 broadcast 181.48.35.223
	//         media: Ethernet autoselect (1000baseT <full-duplex>)
	//         status: active
	// enc0: flags=0<> metric 0 mtu 1536
	//         groups: enc
	//         nd6 options=21<PERFORMNUD,AUTO_LINKLOCAL>

	ips := make(map[string]string)
	macs := make(map[string]string) // MAC -> Interface Name
	var currentIface string

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if !strings.HasPrefix(line, "\t") && strings.Contains(line, ": flags=") {
			// New interface
			parts := strings.Split(line, ":")
			if len(parts) > 0 {
				currentIface = parts[0]
			}
		} else if currentIface != "" {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "inet ") {
				// inet 1.2.3.4 netmask ...
				fields := strings.Fields(trimmed)
				// fields should be: inet, IP, netmask, ...
				if len(fields) >= 2 {
					// Don't overwrite if we already found one (maybe take the first one)
					if _, ok := ips[currentIface]; !ok {
						ips[currentIface] = fields[1]
					}
				}
			} else if strings.HasPrefix(trimmed, "ether ") {
				// ether 00:50:56:a6:31:3e
				fields := strings.Fields(trimmed)
				if len(fields) >= 2 {
					mac := strings.ToLower(fields[1])
					macs[mac] = currentIface
				}
			}
		}
	}
	return ips, macs
}

func parseAndStoreInterfaces(db *data_centralizegg.DB, hostID int64, output string, ipMap map[string]string, macMap map[string]string) (uint64, uint64, map[string]map[string]uint64) {
	// Header: Name  Mtu   Network       Address            Ipkts Ierrs Idrop    Opkts Oerrs  Coll
	// em0   1500  <Link#1>      00:50:56:a6:31:3e  3685412     0     0  2835252     0     0

	lines := strings.Split(output, "\n")
	start := false
	var totalRX, totalTX uint64
	interfacesMap := make(map[string]map[string]uint64)

	for _, line := range lines {
		if strings.HasPrefix(line, "Name") {
			start = true
			continue
		}
		if !start {
			continue
		}
		fields := strings.Fields(line)

		if len(fields) == 0 {
			continue
		}

		rawName := fields[0]
		if rawName == "Name" || rawName == "" {
			continue
		}

		isLinkLine := false
		if len(fields) >= 3 && strings.Contains(fields[2], "Link#") {
			isLinkLine = true
		}

		if !isLinkLine {
			continue
		}

		finalName := rawName
		if len(fields) >= 4 {
			potentialMac := strings.ToLower(fields[3])
			if strings.Contains(potentialMac, ":") {
				if resolvedName, ok := macMap[potentialMac]; ok {
					finalName = resolvedName
				}
			}
		}
		if finalName == rawName && len(fields) >= 4 {
			potentialName := fields[3]
			if _, exists := ipMap[potentialName]; exists {
				if strings.HasPrefix(potentialName, rawName) {
					finalName = potentialName
				}
			}
		}

		cleanName := strings.TrimSuffix(finalName, "*")

		var rxBytes, txBytes, rxErrors, txErrors, rxDropped, txDropped uint64

		if len(fields) >= 11 {
			if rb, err := strconv.ParseUint(fields[7], 10, 64); err == nil {
				rxBytes = rb
			}
			if re, err := strconv.ParseUint(fields[5], 10, 64); err == nil {
				rxErrors = re
			}
			if rd, err := strconv.ParseUint(fields[6], 10, 64); err == nil {
				rxDropped = rd
			}
			if oe, err := strconv.ParseUint(fields[9], 10, 64); err == nil {
				txErrors = oe
			}

			targetIdx := 10
			if len(fields) == 12 {
				targetIdx = 10
			}
			if targetIdx < len(fields) {
				if tb, err := strconv.ParseUint(fields[targetIdx], 10, 64); err == nil {
					txBytes = tb
				}
			}
		}

		// Accumulate Totals
		totalRX += rxBytes
		totalTX += txBytes

		interfacesMap[cleanName] = map[string]uint64{
			"rx": rxBytes,
			"tx": txBytes,
		}

		_ = db.UpsertFirewallInterface(data_centralizegg.FirewallInterface{
			HostID:        hostID,
			InterfaceName: cleanName,
			InterfaceType: "ethernet",
			Status:        "up",
			NetRXBytes:    rxBytes,
			NetTXBytes:    txBytes,
			NetRXErrors:   rxErrors,
			NetRXDropped:  rxDropped,
			NetTXErrors:   txErrors,
			NetTXDropped:  txDropped,
			IPAddress:     ipMap[cleanName],
		})
	}
	return totalRX, totalTX, interfacesMap
}

func parseAndStoreGateways(db *data_centralizegg.DB, hostID int64, output string) {
	// Output format:
	// Name    Monitor IP  Source IP   Delay   StdDev  Loss    Status
	// WAN_DHCP    8.8.8.8 172.42.3.1  8.406ms 1.708ms 0.0%    Online
	// DPINGER_GW  1.2.3.4 5.6.7.8     0.0ms   0.0ms   100%    Offline

	lines := strings.Split(output, "\n")
	start := false
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Name") && strings.Contains(line, "Status") {
			start = true
			continue
		}
		if !start || line == "" {
			continue
		}

		fields := strings.Fields(line)

		// Expected at least 7 fields
		if len(fields) < 7 {
			continue
		}

		// Name is first
		name := fields[0]
		// Status is last
		status := fields[len(fields)-1]
		if status == "none" {
			status = "Online"
		}

		// Loss is second to last
		loss := fields[len(fields)-2]
		// StdDev is third to last
		stddev := fields[len(fields)-3]
		// Delay is fourth to last
		delay := fields[len(fields)-4]
		// Source IP is fifth to last
		sourceIP := fields[len(fields)-5]
		// Monitor IP is sixth to last.
		// NOTE: Some fields might be missing if offline? Usually not in this output.
		// Actually, Name might contain spaces? usually not for gateway names.
		// Let's assume strict columns for now.
		monitorIP := fields[1]

		// Re-verify positions if fields > 7 (maybe Name has spaces?)
		// Gateway names in pfSense are usually alphanumeric w/ underscores.
		// If len > 7, it's ambiguous. But `pfSsh.php playback gatewaystatus` usually prints fixed columns or simple spaces.

		_ = db.UpsertFirewallGateway(data_centralizegg.FirewallGateway{
			HostID:    hostID,
			Name:      name,
			MonitorIP: monitorIP,
			SourceIP:  sourceIP,
			Delay:     delay,
			StdDev:    stddev,
			Loss:      loss,
			Status:    status,
		})
	}
}
func (mc *PfsenseCollector) GetHostLogs(id int64) (string, error) {
	servers, err := mc.DB.GetPFSenseServers()
	if err != nil {
		return "", err
	}
	var s data_centralizegg.PFSenseServer
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

	client, err := getSSHClient(s)
	if err != nil {
		return "", err
	}
	defer client.Close()

	// pfSense uses clog for its circular logs
	return runCommand(client, "clog /var/log/system.log | tail -n 50")
}
