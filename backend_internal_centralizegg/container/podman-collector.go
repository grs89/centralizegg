package container

import (
	json "github.com/goccy/go-json"
	"fmt"
	"io/ioutil"
	"log"
	"strings"
	"time"
	"unicode"

	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"golang.org/x/crypto/ssh"
)

type PodmanCollector struct {
	DB *data_centralizegg.DB
}

func NewPodmanCollector(db *data_centralizegg.DB) *PodmanCollector {
	return &PodmanCollector{
		DB: db,
	}
}

func (pc *PodmanCollector) Start(interval time.Duration) {
	ticker := time.NewTicker(interval)
	// Run once immediately
	go pc.CollectAll()
	go func() {
		for range ticker.C {
			pc.CollectAll()
		}
	}()
}

func (pc *PodmanCollector) CollectAll() {
	log.Printf("[PodmanCollector] Starting collection cycle...")
	servers, err := pc.DB.GetGenericServers("podman")
	if err != nil {
		log.Printf("[PodmanCollector] Failed to get podman servers: %v", err)
		return
	}

	if len(servers) == 0 {
		log.Printf("[PodmanCollector] No podman servers configured.")
		return
	}

	for _, s := range servers {
		log.Printf("[PodmanCollector] Collecting from %s (%s)...", s.Name, s.IPAddress)
		metaMap := map[string]string{"ip": s.IPAddress, "name": s.Name}
		metaBytes, _ := json.Marshal(metaMap)
		metadata := string(metaBytes)
		if err := pc.collectOne(s); err != nil {
			log.Printf("[PodmanCollector] Failed to collect from Podman %s (%s): %v", s.Name, s.IPAddress, err)
			pc.DB.SetGenericServerStatus("podman", s.ID, "offline", metadata)
			// Insert "down" metric point
			pc.DB.InsertServerMetrics(data_centralizegg.ServerMetric{
				ServerID:  s.ID,
				Category:  "podman",
				Timestamp: time.Now(),
				IsOnline:  false,
			})
			continue
		}
		log.Printf("[PodmanCollector] Successfully collected from %s.", s.Name)
		pc.DB.SetGenericServerStatus("podman", s.ID, "online", metadata)
	}
}

func (pc *PodmanCollector) collectOne(s data_centralizegg.GenericServer) error {
	client, err := pc.getSSHClient(s)
	if err != nil {
		return fmt.Errorf("ssh connection failed: %w", err)
	}
	defer client.Close()

	// Fetch logs and save to DB
	pc.storeHostLogs(client, s.ID)

	// 1. Host Info
	hostnameRaw, _ := pc.runCommand(client, "hostname")
	hostname := strings.TrimSpace(hostnameRaw)

	osNameRaw, _ := pc.runCommand(client, "grep PRETTY_NAME /etc/os-release | cut -d '\"' -f 2")
	osName := strings.TrimSpace(osNameRaw)

	uptimeRaw, _ := pc.runCommand(client, "uptime -p")
	uptime := strings.TrimSpace(uptimeRaw)

	cpuModelRaw, _ := pc.runCommand(client, "grep 'model name' /proc/cpuinfo | head -n 1 | cut -d ':' -f 2 | xargs")
	cpuModel := strings.TrimSpace(cpuModelRaw)

	archRaw, _ := pc.runCommand(client, "uname -m")
	arch := strings.TrimSpace(archRaw)

	cpuCoresStr, _ := pc.runCommand(client, "nproc")
	var cpuCores int
	fmt.Sscanf(strings.TrimSpace(cpuCoresStr), "%d", &cpuCores)
	if cpuCores <= 0 {
		cpuCores = 1
	}

	memTotalStr, _ := pc.runCommand(client, "grep MemTotal /proc/meminfo | awk '{print $2}'")
	var memTotalKB uint64
	fmt.Sscanf(strings.TrimSpace(memTotalStr), "%d", &memTotalKB)
	memTotal := memTotalKB * 1024

	memAvailableStr, _ := pc.runCommand(client, "grep MemAvailable /proc/meminfo | awk '{print $2}'")
	var memAvailableKB uint64
	fmt.Sscanf(strings.TrimSpace(memAvailableStr), "%d", &memAvailableKB)
	memFree := memAvailableKB * 1024

	cpuUsageStr, _ := pc.runCommand(client, "top -bn1 | grep 'Cpu(s)' | awk '{print $2 + $4}'")
	var cpuUsage float64
	fmt.Sscanf(strings.TrimSpace(cpuUsageStr), "%f", &cpuUsage)

	podmanVerRaw, _ := pc.runCommand(client, "podman version --format '{{.Server.Version}}'")
	podmanVer := strings.TrimSpace(podmanVerRaw)

	// service status (might be podman.service or podman.socket)
	svcOutput, _ := pc.runCommand(client, "systemctl is-active podman || systemctl is-active podman.socket || echo 'unknown'")
	serviceStatus := strings.TrimSpace(svcOutput)

	// If not reported as active by systemd (e.g. daemonless), check if podman binary works
	if serviceStatus != "active" {
		if _, err := pc.runCommand(client, "podman info"); err == nil {
			serviceStatus = "active"
		}
	}

	if serviceStatus == "active" {
		serviceStatus = "active"
	} else {
		serviceStatus = strings.ToUpper(serviceStatus) // e.g. INACTIVE, FAILED
		if serviceStatus == "UNKNOWN" {
			serviceStatus = "OFFLINE"
		}
	}

	// API latency
	start := time.Now()
	pc.runCommand(client, "podman version")
	apiLatency := int(time.Since(start).Milliseconds())

	// Get Podman Root Dir
	rootDirRaw, _ := pc.runCommand(client, "podman info --format '{{.Store.GraphRoot}}'")
	rootDir := strings.TrimSpace(rootDirRaw)
	if rootDir == "" {
		rootDir = "/var/lib/containers" // fallback
	}

	// Storage Metrics
	storageUsed := uint64(0)
	storageTotal := uint64(0)
	// Storage Metrics (Host Root)
	storageRaw, _ := pc.runCommand(client, "df -B1 / | tail -1 | awk '{print $3,$2}'")
	fmt.Sscanf(strings.TrimSpace(storageRaw), "%d %d", &storageUsed, &storageTotal)

	// Inodes
	// Inodes
	inodesUsageRaw, _ := pc.runCommand(client, fmt.Sprintf("df -i %s | tail -1 | awk '{print $5}'", rootDir))
	inodesUsage := strings.TrimSpace(inodesUsageRaw)

	// Volumes (with size)
	// Try using podman system df -v --format json to get size
	// Structure: { "Volumes": [ {"VolumeName": "foo", "Size": "10kB", ...} ] }
	// Note: This command may not be available in all Podman versions (exit code 125)
	type VolumeInfo struct {
		Name  string `json:"VolumeName"`
		Size  string `json:"Size"`
		Links int    `json:"Links"`
	}
	type SystemDF struct {
		Volumes []VolumeInfo `json:"Volumes"`
	}

	volumesJSON := "[]"
	dfRaw, err := pc.runCommand(client, "podman system df -v --format json")
	if err == nil && strings.TrimSpace(dfRaw) != "" {
		// log.Printf("[PodmanDebug] Raw DF output: %s", dfRaw)
		var sysDF SystemDF
		// Sometimes output might be just the array if filtered, but usually object.
		// Let's try flexible parsing or regex if needed, but struct is best attempt.
		if err := json.Unmarshal([]byte(dfRaw), &sysDF); err == nil {
			if len(sysDF.Volumes) > 0 {
				log.Printf("[PodmanDebug] Found %d volumes with size info", len(sysDF.Volumes))
				b, _ := json.Marshal(sysDF.Volumes)
				volumesJSON = string(b)
			} else {
				log.Printf("[PodmanDebug] DF returned empty Volumes list. Raw: %s", dfRaw)
			}
		} else {
			log.Printf("[PodmanCollector] Error unmarshalling system df: %v. Raw: %s", err, dfRaw)
		}
	} else if err != nil {
		// Silently fall back to alternative method if system df is not supported
		// This is expected in older Podman versions or restricted environments
		log.Printf("[PodmanCollector] 'podman system df' not available (exit 125), using fallback method for volume sizes")
	}

	// Fallback if empty or failed (system df failed)
	if volumesJSON == "[]" {
		volumesRaw, _ := pc.runCommand(client, "podman volume ls -q")
		if strings.TrimSpace(volumesRaw) != "" {
			// Manual enrichment: Inspect -> Mountpoint -> du -sh
			// 1. Inspect all volumes
			inspectCmd := fmt.Sprintf("podman volume inspect %s --format json", strings.ReplaceAll(strings.TrimSpace(volumesRaw), "\n", " "))
			inspectRaw, err := pc.runCommand(client, inspectCmd)

			type VolInspect struct {
				Name       string `json:"Name"`
				Mountpoint string `json:"Mountpoint"`
			}

			if err == nil {
				var details []VolInspect
				if json.Unmarshal([]byte(inspectRaw), &details) == nil {
					var resultList []VolumeInfo
					for _, v := range details {
						size := "N/A"
						if v.Mountpoint != "" {
							// 2. Run du -sh on mountpoint
							// Use sudo? Trying direct first. Podman rootless mounts are user-owned.
							// awk '{print $1}' gets just the size part (e.g. "4.0K")
							duOut, err := pc.runCommand(client, fmt.Sprintf("du -sh %s | awk '{print $1}'", v.Mountpoint))
							if err == nil {
								s := strings.TrimSpace(duOut)
								// Normalize units for frontend compatibility (Frontend expects KB, MB, GB)
								// du -h output: K, M, G, T.
								if len(s) > 0 && unicode.IsDigit(rune(s[0])) {
									if strings.HasSuffix(s, "K") {
										s += "B"
									} else if strings.HasSuffix(s, "M") {
										s += "B"
									} else if strings.HasSuffix(s, "G") {
										s += "B"
									} else if strings.HasSuffix(s, "T") {
										s += "B"
									}
									size = s
								}
							}
						}
						resultList = append(resultList, VolumeInfo{Name: v.Name, Size: size})
					}
					if len(resultList) > 0 {
						b, _ := json.Marshal(resultList)
						volumesJSON = string(b)
					}
				}
			}

			// If even manual inspection failed, fall back to simple name list
			if volumesJSON == "[]" {
				var simpleList []VolumeInfo
				volLines := strings.Split(strings.TrimSpace(volumesRaw), "\n")
				for _, line := range volLines {
					if strings.TrimSpace(line) != "" {
						simpleList = append(simpleList, VolumeInfo{Name: strings.TrimSpace(line), Size: "N/A"})
					}
				}
				if len(simpleList) > 0 {
					b, _ := json.Marshal(simpleList)
					volumesJSON = string(b)
				}
			}
		}
	}

	// Podman GPU Info (NVIDIA)
	gpuJSON := "[]"
	gpuRaw, err := pc.runCommand(client, "nvidia-smi --query-gpu=gpu_name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null")
	if err == nil && strings.TrimSpace(gpuRaw) != "" {
		lines := strings.Split(strings.TrimSpace(gpuRaw), "\n")
		type GPUInfo struct {
			Name        string `json:"name"`
			Utilization int    `json:"utilization"`
			MemoryUsed  uint64 `json:"memory_used"`
			MemoryTotal uint64 `json:"memory_total"`
			Temp        int    `json:"temperature"`
		}
		var gpus []GPUInfo
		for _, line := range lines {
			parts := strings.Split(line, ",")
			if len(parts) >= 5 {
				var util, temp int
				var mUsed, mTotal uint64
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &util)
				fmt.Sscanf(strings.TrimSpace(parts[2]), "%d", &mUsed)
				fmt.Sscanf(strings.TrimSpace(parts[3]), "%d", &mTotal)
				fmt.Sscanf(strings.TrimSpace(parts[4]), "%d", &temp)

				gpus = append(gpus, GPUInfo{
					Name:        strings.TrimSpace(parts[0]),
					Utilization: util,
					MemoryUsed:  mUsed,
					MemoryTotal: mTotal,
					Temp:        temp,
				})
			}
		}
		if b, err := json.Marshal(gpus); err == nil {
			gpuJSON = string(b)
		}
	}

	// Podman Networks Topology
	networksJSON := "[]"

	// Prepare structs for network enrichment
	type PodmanNetwork struct {
		ID         string                 `json:"Id"`
		Name       string                 `json:"Name"`
		Driver     string                 `json:"Driver"`
		Internal   bool                   `json:"Internal"`
		Containers map[string]interface{} `json:"Containers,omitempty"` // We will populate this manually
		// Add other fields as necessary to match generic structure but these are key for map
	}

	// Helper struct for container inspection network settings
	type ContainerNetworkInfo struct {
		Id              string `json:"Id"`
		Name            string `json:"Name"`
		NetworkSettings struct {
			Networks map[string]struct {
				IPAddress  string `json:"IPAddress"`
				MacAddress string `json:"MacAddress"`
				Gateway    string `json:"Gateway"`
				// Other fields if needed
			} `json:"Networks"`
		} `json:"NetworkSettings"`
	}

	var networks []PodmanNetwork

	// List network IDs first
	netIDsRaw, _ := pc.runCommand(client, "podman network ls -q")
	if strings.TrimSpace(netIDsRaw) != "" {
		// Inspect all networks
		netsInspectRaw, err := pc.runCommand(client, "podman network inspect $(podman network ls -q) --format json")
		if err == nil && strings.TrimSpace(netsInspectRaw) != "" {
			if err := json.Unmarshal([]byte(netsInspectRaw), &networks); err != nil {
				log.Printf("[PodmanCollector] Warning: failed to parse network inspect JSON: %v", err)
			}
		}
	}

	// If we have networks, we need to populate their 'Containers' field manually
	// because Podman CNI/Netavark usually doesn't return it in network inspect.
	if len(networks) > 0 {
		// Get all containers inspection to find their networks
		// We use existing 'podman ps -aq' if available or just list all
		cIDsRaw, _ := pc.runCommand(client, "podman ps -aq")
		if strings.TrimSpace(cIDsRaw) != "" {
			// Clean up IDs list for command
			cIDs := strings.ReplaceAll(strings.TrimSpace(cIDsRaw), "\n", " ")
			cInspectRaw, err := pc.runCommand(client, "podman inspect "+cIDs+" --format json")
			if err == nil {
				var containers []ContainerNetworkInfo
				if err := json.Unmarshal([]byte(cInspectRaw), &containers); err == nil {
					// Initialize maps if nil
					for i := range networks {
						if networks[i].Containers == nil {
							networks[i].Containers = make(map[string]interface{})
						}
					}

					// Map container -> networks
					for _, c := range containers {
						cName := strings.TrimPrefix(c.Name, "/")

						for netName, netConf := range c.NetworkSettings.Networks {
							// Find the network in our list
							for i := range networks {
								// Podman network names in settings usually match Name
								if networks[i].Name == netName {
									// Add container using ID as key like Docker
									// Docker structure: "Containers": { "full-id": { "Name": "foo", "IPv4Address": "..." } }
									networks[i].Containers[c.Id] = map[string]string{
										"Name":        cName,
										"IPv4Address": netConf.IPAddress,
										"MacAddress":  netConf.MacAddress,
									}
									break
								}
							}
						}
					}
				} else {
					log.Printf("[PodmanCollector] Warning: Error unmarshalling container inspect for network enrichment: %v", err)
				}
			}
		}

		// Marshal back to JSON
		if b, err := json.Marshal(networks); err == nil {
			networksJSON = string(b)
		}
	}

	// 10. Host Events (System Logs)
	var hostEventsJSON = "[]"
	logOut, err := pc.runCommand(client, "journalctl -n 10 --no-pager || tail -n 10 /var/log/syslog || tail -n 10 /var/log/messages || echo ''")
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

	// Host Network Topology
	var totalNetRX, totalNetTX uint64
	interfacesMap := make(map[string]map[string]uint64)
	netRaw, err := pc.runCommand(client, "awk 'NR>2 {print $1, $2, $10}' /proc/net/dev")
	if err == nil {
		lines := strings.Split(strings.TrimSpace(netRaw), "\n")
		for _, line := range lines {
			parts := strings.Fields(line)
			if len(parts) >= 3 {
				if strings.HasPrefix(parts[0], "lo:") {
					continue
				}
				name := strings.TrimSuffix(parts[0], ":")
				var rx, tx uint64
				fmt.Sscanf(parts[1], "%d", &rx)
				fmt.Sscanf(parts[2], "%d", &tx)
				totalNetRX += rx
				totalNetTX += tx

				interfacesMap[name] = map[string]uint64{
					"rx": rx,
					"tx": tx,
				}
			}
		}
	}

	interfacesJSON := "{}"
	if len(interfacesMap) > 0 {
		if b, err := json.Marshal(interfacesMap); err == nil {
			interfacesJSON = string(b)
		}
	}

	// Host Disk I/O Stats (Read/Write Bytes)
	var totalDiskRead, totalDiskWrite uint64
	diskIOMap := make(map[string]map[string]uint64)
	diskIORaw, err := pc.runCommand(client, `awk '/(sd[a-z]+|nvme[0-9]n[0-9]+|vd[a-z]+|xvd[a-z]+)$/ {print $3, $6, $10}' /proc/diskstats`)
	if err == nil {
		lines := strings.Split(strings.TrimSpace(diskIORaw), "\n")
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

	disksDataJSON := "{}"
	if len(diskIOMap) > 0 {
		if b, err := json.Marshal(diskIOMap); err == nil {
			disksDataJSON = string(b)
		}
	}

	// Active Connections
	activeConnsJSON := "[]"
	connsOutput, err := pc.runCommand(client, `ss -tunp state established 2>/dev/null | grep -vE '127\.0\.0\.1|::1|169\.254\.' | awk 'NR>1 {print $5}'`)
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

				// Filter private, etc.
				isPrivate := strings.HasPrefix(remoteIP, "10.") ||
					strings.HasPrefix(remoteIP, "192.168.") ||
					strings.HasPrefix(remoteIP, "127.") ||
					strings.HasPrefix(remoteIP, "::1")

				if !isPrivate {
					if _, exists := statsMap[remoteIP]; !exists {
						statsMap[remoteIP] = &ConnStat{RemoteIP: remoteIP}
					}
					statsMap[remoteIP].Outbound++
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

	hostID, err := pc.DB.UpsertPodmanHost(data_centralizegg.PodmanHost{
		ServerID:          s.ID,
		Hostname:          hostname,
		CPUModel:          cpuModel,
		CPUCores:          cpuCores,
		TotalMemory:       memTotal,
		FreeMemory:        memFree,
		CPUUsage:          cpuUsage,
		OSName:            osName,
		Uptime:            uptime,
		PodmanVer:         podmanVer,
		ServiceStatus:     serviceStatus,
		APILatency:        apiLatency,
		StorageUsed:       storageUsed,
		StorageTotal:      storageTotal,
		InodesUsage:       inodesUsage,
		Volumes:           string(volumesJSON),
		GPUInfo:           gpuJSON,
		PodmanNetworks:    networksJSON,
		HostEvents:        hostEventsJSON,
		ActiveConnections: activeConnsJSON,
		Architecture:      arch,
	})
	if err == nil {
		pc.DB.UpdateGenericServerHostEvents("podman", s.ID, hostEventsJSON)
		pc.DB.UpdateGenericServerStats("podman", s.ID, cpuUsage, cpuCores, memTotal, memFree, storageUsed, storageTotal, osName, cpuModel, uptime, arch)

		// Insert Historical Metrics
		metric := data_centralizegg.ServerMetric{
			ServerID:       hostID,
			Category:       "podman",
			Timestamp:      time.Now(),
			CPUUsage:       cpuUsage,
			MemoryUsage:    memTotal - memFree,
			NetRX:          totalNetRX,
			NetTX:          totalNetTX,
			DiskRead:       totalDiskRead,
			DiskWrite:      totalDiskWrite,
			DiskUsage:      storageUsed,
			DiskTotal:      storageTotal,
			InterfacesData: interfacesJSON,
			DisksData:      disksDataJSON,
			IsOnline:       true,
		}
		if err := pc.DB.InsertServerMetrics(metric); err != nil {
			// log.Printf("[PodmanCollector] Failed to insert metrics: %v", err)
		}
	}
	if err != nil {
		return fmt.Errorf("upsert podman host: %w", err)
	}

	// 2. Containers Info
	// Podman stats
	statsOutput, err := pc.runCommand(client, "podman stats --no-stream --format json")
	statsMap := make(map[string]podmanStats)
	if err == nil {
		// DEBUG: Print raw stats output to verify JSON keys
		var stList []podmanStats
		if err := json.Unmarshal([]byte(statsOutput), &stList); err == nil {
			for _, st := range stList {
				if st.Name != "" {
					statsMap[st.Name] = st
				}
				if st.ID != "" {
					statsMap[st.ID] = st
				}
			}
		} else {
			log.Printf("[PodmanCollector] Error unmarshalling stats from %s: %v. Output: %s", hostname, err, statsOutput)
		}
	} else {
		log.Printf("[PodmanCollector] Error running podman stats on %s: %v", hostname, err)
	}

	// Fetch IP addresses using inspect (only if there are containers)
	ipMap := make(map[string]string)
	idsOutput, _ := pc.runCommand(client, "podman ps -aq")
	if strings.TrimSpace(idsOutput) != "" {
		ipOutput, err := pc.runCommand(client, "podman inspect --format '{{.Id}}|{{range .NetworkSettings.Networks}}{{.IPAddress}},{{end}}' "+strings.ReplaceAll(strings.TrimSpace(idsOutput), "\n", " "))
		if err == nil {
			lines := strings.Split(strings.TrimSpace(ipOutput), "\n")
			for _, line := range lines {
				parts := strings.Split(line, "|")
				if len(parts) == 2 {
					id := strings.TrimSpace(parts[0])
					ips := strings.Trim(parts[1], ",")
					ipMap[id] = ips
				}
			}
		}
	}

	// Podman ps
	psOutput, err := pc.runCommand(client, "podman ps -a --format json")
	if err != nil {
		return fmt.Errorf("podman ps: %w", err)
	}

	// DEBUG: Print raw ps output
	// log.Printf("[PodmanDebug] Raw ps output from %s: %s", hostname, psOutput)

	var psList []podmanPS
	if err := json.Unmarshal([]byte(psOutput), &psList); err != nil {
		log.Printf("[PodmanCollector] Error unmarshalling ps from %s: %v. Output: %s", hostname, err, psOutput)
		return fmt.Errorf("podman ps unmarshal error: %w", err)
	}

	for _, pps := range psList {
		var name string
		if len(pps.Names) > 0 {
			name = pps.Names[0]
		}

		// Try to find stats by name or ID
		st, ok := statsMap[name]
		if !ok {
			// Try matching by ID prefix (short vs full ID)
			for sid, s := range statsMap {
				if sid != "" && pps.ID != "" && (strings.HasPrefix(pps.ID, sid) || strings.HasPrefix(sid, pps.ID)) {
					st = s
					ok = true
					break
				}
			}
		}

		ipAddr := ipMap[pps.ID]
		if ipAddr == "" && len(ipMap) > 0 {
			// Try short ID
			for fullID, ip := range ipMap {
				if strings.HasPrefix(fullID, pps.ID) {
					ipAddr = ip
					break
				}
			}
		}

		// Use fallback fields for CPU/Mem if primary are empty
		cpuPerc := st.CPUPerc
		if cpuPerc == "" {
			cpuPerc = st.CPU
		}
		memUsage := st.MemUsage
		if memUsage == "" {
			memUsage = st.Mem
		}

		// Network Fallback
		netIO := st.NetIO
		if netIO == "" || netIO == "--" || netIO == "0B / 0B" {
			if st.NetIO_Fallback != "" && st.NetIO_Fallback != "--" {
				netIO = st.NetIO_Fallback
			}
		}

		// Block Fallback
		blockIO := st.BlockIO
		if blockIO == "" || blockIO == "--" || blockIO == "0B / 0B" {
			if st.BlockIO_Fallback != "" && st.BlockIO_Fallback != "--" {
				blockIO = st.BlockIO_Fallback
			}
		}

		// Handle PIDs as interface (can be int or string like "--")
		var pids int
		switch v := st.PIDs.(type) {
		case float64:
			pids = int(v)
		case int:
			pids = v
		case string:
			fmt.Sscanf(v, "%d", &pids)
		default:
			pids = 0
		}

		c := data_centralizegg.Container{
			Name:            name,
			Image:           pps.Image,
			Ports:           pc.formatPorts(pps.Ports),
			State:           pps.State,
			Status:          pps.Status,
			CPUUsage:        pc.parsePercent(cpuPerc),
			MemUsage:        pc.parseBytes(memUsage),
			MemLimit:        pc.parseBytes(st.MemLimit),
			NetRX:           pc.parseNetBytes(netIO, true),
			NetTX:           pc.parseNetBytes(netIO, false),
			BlockIn:         pc.parseNetBytes(blockIO, true),
			BlockOut:        pc.parseNetBytes(blockIO, false),
			PIDs:            pids,
			IPAddress:       ipAddr,
			OOMKilled:       false,  // logic to detect OOM requires podman inspect
			Vulnerabilities: "Safe", // placeholder for vulnerability scanning
			HostID:          hostID,
		}

		if err := pc.DB.UpsertPodmanContainer(c); err != nil {
			log.Printf("[PodmanCollector] Failed to upsert container %s: %v", c.Name, err)
		}
	}

	return nil
}

type podmanStats struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Support both casing styles seen in different Podman versions
	CPUPerc          string      `json:"cpu_percent"`
	CPU              string      `json:"CPU"` // fallback
	MemUsage         string      `json:"mem_usage"`
	Mem              string      `json:"MemUsage"` // fallback
	MemLimit         string      `json:"mem_limit"`
	NetIO            string      `json:"net_io"`
	NetIO_Fallback   string      `json:"NetIO"` // fallback
	BlockIO          string      `json:"block_io"`
	BlockIO_Fallback string      `json:"BlockIO"` // fallback
	PIDs             interface{} `json:"pids"`
}

type podmanPS struct {
	ID     string       `json:"Id"`
	Names  []string     `json:"Names"`
	Image  string       `json:"Image"`
	Ports  []podmanPort `json:"Ports"`
	State  string       `json:"State"`
	Status string       `json:"Status"`
}

type podmanPort struct {
	// Remove tags to allow case-insensitive matching (HostPort vs hostPort)
	HostPort      int
	ContainerPort int
	Protocol      string
	HostIP        string
}

func (pc *PodmanCollector) formatPorts(ports []podmanPort) string {
	// log.Printf("[PodmanDebug] Formatting ports: %+v", ports)
	var parts []string
	for _, p := range ports {
		h := p.HostIP
		if h == "" || h == "0.0.0.0" {
			h = "*"
		}
		s := fmt.Sprintf("%s:%d->%d/%s", h, p.HostPort, p.ContainerPort, p.Protocol)
		parts = append(parts, s)
	}
	if len(parts) == 0 {
		return "-"
	}
	return strings.Join(parts, ", ")
}

func (pc *PodmanCollector) getSSHClient(s data_centralizegg.GenericServer) (*ssh.Client, error) {
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

	addr := fmt.Sprintf("%s:%d", s.IPAddress, s.SSHPort)
	if s.SSHPort == 0 {
		addr = fmt.Sprintf("%s:22", s.IPAddress)
	}
	return ssh.Dial("tcp", addr, config)
}

func (pc *PodmanCollector) runCommand(client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

func (pc *PodmanCollector) storeHostLogs(client *ssh.Client, serverID int64) {
	session, err := client.NewSession()
	if err != nil {
		return
	}
	defer session.Close()

	output, err := session.CombinedOutput("journalctl -n 10 --no-pager")
	if err != nil {
		return
	}

	logs := strings.TrimSpace(string(output))
	if logs != "" {
		_ = pc.DB.SaveHostLog("podman", serverID, logs)
	}
}

func (pc *PodmanCollector) parsePercent(s string) float64 {
	var val float64
	fmt.Sscanf(strings.TrimSuffix(s, "%"), "%f", &val)
	return val
}

func (pc *PodmanCollector) parseBytes(s string) uint64 {
	parts := strings.Fields(s)
	if len(parts) == 0 {
		return 0
	}

	valStr := parts[0]
	var val float64
	var unit string

	for i, c := range valStr {
		if (c < '0' || c > '9') && c != '.' {
			valStr = string(valStr[:i])
			unit = string(parts[0][i:])
			break
		}
	}
	fmt.Sscanf(valStr, "%f", &val)

	unit = strings.ToUpper(unit)
	switch {
	case strings.Contains(unit, "G"):
		return uint64(val * 1024 * 1024 * 1024)
	case strings.Contains(unit, "M"):
		return uint64(val * 1024 * 1024)
	case strings.Contains(unit, "K"):
		return uint64(val * 1024)
	}
	return uint64(val)
}

func (pc *PodmanCollector) parseNetBytes(s string, rx bool) uint64 {
	if s == "" || s == "--" {
		return 0
	}
	// Support both " / " and "/" and handle any spacing
	var parts []string
	if strings.Contains(s, " / ") {
		parts = strings.Split(s, " / ")
	} else if strings.Contains(s, "/") {
		parts = strings.Split(s, "/")
	}

	if len(parts) < 2 {
		return 0
	}

	target := strings.TrimSpace(parts[0])
	if !rx {
		target = strings.TrimSpace(parts[1])
	}

	return pc.parseBytes(target)
}

func (pc *PodmanCollector) GetContainerLogs(serverID int64, containerID string) (string, error) {
	if !isValidResourceName(containerID) {
		return "", fmt.Errorf("invalid container ID format")
	}
	servers, err := pc.DB.GetGenericServers("podman")
	if err != nil {
		return "", err
	}
	var targetServer data_centralizegg.GenericServer
	found := false
	for _, s := range servers {
		if s.ID == serverID {
			targetServer = s
			found = true
			break
		}
	}
	if !found {
		return "", fmt.Errorf("server not found")
	}

	client, err := pc.getSSHClient(targetServer)
	if err != nil {
		return "", fmt.Errorf("ssh connection failed: %w", err)
	}
	defer client.Close()

	// Execute logs command
	cmd := fmt.Sprintf("podman logs --tail 100 %s 2>&1", containerID)
	output, err := pc.runCommand(client, cmd)
	if err != nil {
		return "", fmt.Errorf("failed to get logs: %v (output: %s)", err, output)
	}

	return output, nil
}

func (pc *PodmanCollector) StartContainer(serverID int64, containerID string) error {
	if !isValidResourceName(containerID) {
		return fmt.Errorf("invalid container ID format")
	}
	servers, err := pc.DB.GetGenericServers("podman")
	if err != nil {
		return err
	}
	var targetServer data_centralizegg.GenericServer
	found := false
	for _, s := range servers {
		if s.ID == serverID {
			targetServer = s
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("server not found")
	}

	client, err := pc.getSSHClient(targetServer)
	if err != nil {
		return fmt.Errorf("ssh connection failed: %w", err)
	}
	defer client.Close()

	cmd := fmt.Sprintf("podman start %s", containerID)
	_, err = pc.runCommand(client, cmd)
	return err
}

func (pc *PodmanCollector) StopContainer(serverID int64, containerID string) error {
	if !isValidResourceName(containerID) {
		return fmt.Errorf("invalid container ID format")
	}
	servers, err := pc.DB.GetGenericServers("podman")
	if err != nil {
		return err
	}
	var targetServer data_centralizegg.GenericServer
	found := false
	for _, s := range servers {
		if s.ID == serverID {
			targetServer = s
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("server not found")
	}

	client, err := pc.getSSHClient(targetServer)
	if err != nil {
		return fmt.Errorf("ssh connection failed: %w", err)
	}
	defer client.Close()

	cmd := fmt.Sprintf("podman stop %s", containerID)
	_, err = pc.runCommand(client, cmd)
	return err
}
func (pc *PodmanCollector) GetHostLogs(id int64) (string, error) {
	servers, err := pc.DB.GetGenericServers("podman")
	if err != nil {
		return "", err
	}
	var s data_centralizegg.GenericServer
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

	client, err := pc.getSSHClient(s)
	if err != nil {
		return "", err
	}
	defer client.Close()

	return pc.runCommand(client, "journalctl -n 50 --no-pager")
}
