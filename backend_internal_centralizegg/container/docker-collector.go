package container

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"strings"
	"time"

	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"golang.org/x/crypto/ssh"
)

type DockerCollector struct {
	DB *data_centralizegg.DB
}

func NewDockerCollector(db *data_centralizegg.DB) *DockerCollector {
	return &DockerCollector{
		DB: db,
	}
}

func (dc *DockerCollector) Start(interval time.Duration) {
	ticker := time.NewTicker(interval)
	// Run once immediately
	go dc.CollectAll()
	go func() {
		for range ticker.C {
			dc.CollectAll()
		}
	}()
}

func (dc *DockerCollector) CollectAll() {
	// log.Printf("[DockerCollector] Starting collection cycle...")
	servers, err := dc.DB.GetGenericServers("docker")
	if err != nil {
		// log.Printf("[DockerCollector] Failed to get docker servers: %v", err)
		return
	}

	if len(servers) == 0 {
		// log.Printf("[DockerCollector] No docker servers configured.")
		return
	}

	for _, s := range servers {
		// log.Printf("[DockerCollector] Collecting from %s (%s)...", s.Name, s.IPAddress)
		metaMap := map[string]string{"ip": s.IPAddress, "name": s.Name}
		metaBytes, _ := json.Marshal(metaMap)
		metadata := string(metaBytes)

		if err := dc.collectOne(s); err != nil {
			// log.Printf("[DockerCollector] Failed to collect from Docker %s (%s): %v", s.Name, s.IPAddress, err)
			dc.DB.SetGenericServerStatus("docker", s.ID, "offline", metadata)
			continue
		}
		// log.Printf("[DockerCollector] Successfully collected from %s.", s.Name)
		dc.DB.SetGenericServerStatus("docker", s.ID, "online", metadata)
	}
}

func (dc *DockerCollector) collectOne(s data_centralizegg.GenericServer) error {
	client, err := dc.getSSHClient(s)
	if err != nil {
		return fmt.Errorf("ssh connection failed: %w", err)
	}
	defer client.Close()

	// 1. Host Info
	hostnameRaw, _ := dc.runCommand(client, "hostname")
	hostname := strings.TrimSpace(hostnameRaw)

	osNameRaw, _ := dc.runCommand(client, "grep PRETTY_NAME /etc/os-release | cut -d '\"' -f 2")
	osName := strings.TrimSpace(osNameRaw)

	uptimeRaw, _ := dc.runCommand(client, "uptime -p")
	uptime := strings.TrimSpace(uptimeRaw)

	cpuModelRaw, _ := dc.runCommand(client, "grep 'model name' /proc/cpuinfo | head -n 1 | cut -d ':' -f 2 | xargs")
	cpuModel := strings.TrimSpace(cpuModelRaw)

	cpuCoresStr, _ := dc.runCommand(client, "nproc")
	var cpuCores int
	fmt.Sscanf(strings.TrimSpace(cpuCoresStr), "%d", &cpuCores)
	if cpuCores <= 0 {
		cpuCores = 1
	}

	memTotalStr, _ := dc.runCommand(client, "grep MemTotal /proc/meminfo | awk '{print $2}'")
	var memTotalKB uint64
	fmt.Sscanf(strings.TrimSpace(memTotalStr), "%d", &memTotalKB)
	memTotal := memTotalKB * 1024

	memAvailableStr, _ := dc.runCommand(client, "grep MemAvailable /proc/meminfo | awk '{print $2}'")
	var memAvailableKB uint64
	fmt.Sscanf(strings.TrimSpace(memAvailableStr), "%d", &memAvailableKB)
	memFree := memAvailableKB * 1024

	cpuUsageStr, _ := dc.runCommand(client, "top -bn1 | grep 'Cpu(s)' | awk '{print $2 + $4}'")
	var cpuUsage float64
	fmt.Sscanf(strings.TrimSpace(cpuUsageStr), "%f", &cpuUsage)

	dockerVerRaw, _ := dc.runCommand(client, "docker version --format '{{.Server.Version}}'")
	dockerVer := strings.TrimSpace(dockerVerRaw)

	// service status
	serviceStatus, _ := dc.runCommand(client, "systemctl is-active docker")
	serviceStatus = strings.TrimSpace(serviceStatus)
	if serviceStatus == "" {
		serviceStatus = "unknown"
	}

	// socket status
	socketStatus, _ := dc.runCommand(client, "[ -S /var/run/docker.sock ] && echo \"Ready\" || echo \"Not Found\"")
	socketStatus = strings.TrimSpace(socketStatus)
	if socketStatus == "" {
		socketStatus = "unknown"
	}

	// API latency
	start := time.Now()
	dc.runCommand(client, "docker version")
	apiLatency := int(time.Since(start).Milliseconds())

	// Docker Storage Metrics
	storageUsed := uint64(0)
	storageTotal := uint64(0)
	inodesUsage := ""
	dockerLogsSize := uint64(0)

	// Usage for /var/lib/docker
	storageRaw, _ := dc.runCommand(client, "df -B1 /var/lib/docker | tail -1 | awk '{print $3,$2}'")
	fmt.Sscanf(strings.TrimSpace(storageRaw), "%d %d", &storageUsed, &storageTotal)

	// Inodes for /var/lib/docker
	inodesRaw, _ := dc.runCommand(client, "df -i /var/lib/docker | tail -1 | awk '{print $(NF-1)}'")
	inodesUsage = strings.TrimSpace(inodesRaw)

	// Log size for all containers
	logsRaw, _ := dc.runCommand(client, "du -sb /var/lib/docker/containers/ 2>/dev/null | awk '{print $1}'")
	logsTrimmed := strings.TrimSpace(logsRaw)
	if logsTrimmed != "" {
		fmt.Sscanf(logsTrimmed, "%d", &dockerLogsSize)
	}

	// Docker Volumes
	volumesJSON := "[]"
	volsRaw, err := dc.runCommand(client, "docker system df -v | awk '/VOLUME NAME/{p=1;next} /Images space usage/{p=0} /Build cache usage/{p=0} p && $1!=\"\" {print $1,$3}'")
	if err != nil {
		// log.Printf("[DockerCollector] 'docker system df' command failed: %v, volumes will not have size information", err)
	} else {
		// log.Printf("[DockerCollector] Successfully retrieved volume sizes using 'docker system df'")
	}
	volsLines := strings.Split(strings.TrimSpace(volsRaw), "\n")
	type VolumeInfo struct {
		Name string `json:"name"`
		Size uint64 `json:"size"`
	}
	var volumes []VolumeInfo
	for _, line := range volsLines {
		parts := strings.Fields(line)
		if len(parts) >= 2 {
			volumes = append(volumes, VolumeInfo{
				Name: parts[0],
				Size: dc.parseBytes(parts[1]),
			})
		}
	}
	if b, err := json.Marshal(volumes); err == nil {
		volumesJSON = string(b)
	}

	// Docker Networks Topology
	networksJSON := "[]"
	netsRaw, err := dc.runCommand(client, "docker network inspect $(docker network ls -q) --format '{{json .}}' 2>/dev/null")
	if err == nil && strings.TrimSpace(netsRaw) != "" {
		networksJSON = strings.TrimSpace(netsRaw)
		// Ensure it's a valid JSON array or object
		if !strings.HasPrefix(networksJSON, "[") {
			// If it's a list indicative of one-line-per-object, wrap it
			networksJSON = "[" + strings.ReplaceAll(networksJSON, "\n", ",") + "]"
		}
	}

	// Docker GPU Info (NVIDIA)
	gpuJSON := "[]"
	gpuRaw, err := dc.runCommand(client, "nvidia-smi --query-gpu=gpu_name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null")
	if err != nil {
		// Log error if it's not just "command not found"
		if !strings.Contains(err.Error(), "127") && !strings.Contains(err.Error(), "not found") {
			fmt.Printf("[GPU Debug] Error running nvidia-smi on %s: %v\n", s.Name, err)
		}
	} else if strings.TrimSpace(gpuRaw) != "" {
		fmt.Printf("[GPU Debug] Found GPU data on %s: %s\n", s.Name, strings.TrimSpace(gpuRaw))
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
	} else {
		// No output but no error
		// fmt.Printf("[GPU Debug] No nvidia-smi output from %s\n", s.Name)
	}

	// 10. Host Events (System Logs)
	var hostEventsJSON = "[]"
	logOut, err := dc.runCommand(client, "journalctl -n 10 --no-pager || tail -n 10 /var/log/syslog || tail -n 10 /var/log/messages || echo ''")
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
	netRaw, err := dc.runCommand(client, "awk 'NR>2 {print $1, $2, $10}' /proc/net/dev")
	if err == nil {
		lines := strings.Split(strings.TrimSpace(netRaw), "\n")
		for _, line := range lines {
			parts := strings.Fields(line)
			if len(parts) >= 3 {
				// Filter loopback or specific interfaces if needed? For now aggregate all.
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

	hostID, err := dc.DB.UpsertDockerHost(data_centralizegg.DockerHost{
		ServerID:      s.ID,
		Hostname:      hostname,
		CPUModel:      cpuModel,
		CPUCores:      cpuCores,
		TotalMemory:   memTotal,
		FreeMemory:    memFree,
		CPUUsage:      cpuUsage,
		OSName:        osName,
		Uptime:        uptime,
		DockerVer:     dockerVer,
		ServiceStatus: serviceStatus,
		SocketStatus:  socketStatus,
		APILatency:    apiLatency,
		StorageUsed:   storageUsed,
		StorageTotal:  storageTotal,
		InodesUsage:   inodesUsage,
		LogsSize:      dockerLogsSize,
		Volumes:       volumesJSON,
		Networks:      networksJSON,
		GPUInfo:       gpuJSON,
		UpdateStatus:  "Up to Date",
		HostEvents:    hostEventsJSON,
	})
	if err == nil {
		dc.DB.UpdateGenericServerHostEvents("docker", s.ID, hostEventsJSON)

		// Insert Historical Metrics
		metric := data_centralizegg.ServerMetric{
			ServerID:       hostID,
			Category:       "docker",
			Timestamp:      time.Now(),
			CPUUsage:       cpuUsage,
			MemoryUsage:    memTotal - memFree,
			NetRX:          totalNetRX,
			NetTX:          totalNetTX,
			InterfacesData: interfacesJSON,
		}
		if err := dc.DB.InsertServerMetrics(metric); err != nil {
			// log.Printf("[DockerCollector] Failed to insert metrics: %v", err)
		}
	}
	if err != nil {
		return fmt.Errorf("upsert docker host: %w", err)
	}

	// 2. Containers Info
	// Get OOM status and IP
	oomMap := make(map[string]bool)
	ipMap := make(map[string]string)
	vulnCache := make(map[string]string)
	inspectOutput, err := dc.runCommand(client, `[ -n "$(docker ps -aq)" ] && docker inspect --format '{{.Name}} {{.State.OOMKilled}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' $(docker ps -aq) || echo ""`)
	if err == nil {
		lines := strings.Split(strings.TrimSpace(inspectOutput), "\n")
		for _, line := range lines {
			if line == "" {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				name := strings.TrimPrefix(parts[0], "/")
				oomMap[name] = parts[1] == "true"
				// IP might be in parts[2] or beyond if there are multiple networks
				// We'll just take the first non-empty IP we find
				if len(parts) > 2 {
					for i := 2; i < len(parts); i++ {
						if parts[i] != "" && parts[i] != "<nil>" {
							ipMap[name] = parts[i]
							break
						}
					}
				}
			}
		}
	}

	// Get stats first to have a map of usage
	statsOutput, err := dc.runCommand(client, "docker stats --no-stream --format '{{json .}}'")
	statsMap := make(map[string]containerStats)
	if err == nil {
		lines := strings.Split(strings.TrimSpace(statsOutput), "\n")
		for _, line := range lines {
			var st containerStats
			if err := json.Unmarshal([]byte(line), &st); err == nil {
				statsMap[st.Name] = st
			}
		}
	}

	// Get detailed container info
	psOutput, err := dc.runCommand(client, "docker ps -a --format '{{json .}}'")
	if err != nil {
		return fmt.Errorf("docker ps: %w", err)
	}

	psLines := strings.Split(strings.TrimSpace(psOutput), "\n")
	for _, line := range psLines {
		if line == "" {
			continue
		}
		var dps dockerPS
		if err := json.Unmarshal([]byte(line), &dps); err != nil {
			continue
		}

		st, found := statsMap[dps.Names]
		if !found {
			// Try by ID if name match fails
			for _, s := range statsMap {
				// docker stats ID is short, dps.ID is likely short too but we check prefix
				if (s.ID != "" && strings.HasPrefix(dps.ID, s.ID)) || (s.Name != "" && s.Name == dps.Names) {
					st = s
					found = true
					break
				}
			}
		}

		// Handle PIDs as interface (can be int or string like "--")
		var pids int
		switch v := st.PIDs.(type) {
		case float64:
			pids = int(v)
		case int:
			pids = v
		default:
			pids = 0
		}

		c := data_centralizegg.Container{
			Name:            dps.Names,
			Image:           dps.Image,
			Ports:           dps.Ports,
			State:           dps.State,
			Status:          dps.Status,
			CPUUsage:        dc.parsePercent(st.CPUPerc),
			MemUsage:        dc.parseBytes(st.MemUsage),
			MemLimit:        dc.parseBytes(st.MemLimit),
			NetRX:           dc.parseNetBytes(st.NetIO, true),
			NetTX:           dc.parseNetBytes(st.NetIO, false),
			BlockIn:         dc.parseNetBytes(st.BlockIO, true),
			BlockOut:        dc.parseNetBytes(st.BlockIO, false),
			PIDs:            pids,
			IPAddress:       ipMap[dps.Names],
			OOMKilled:       oomMap[dps.Names],
			Vulnerabilities: "", // Will fill next
			HostID:          hostID,
		}

		// Image Vulnerabilities (with cache)
		if dps.Image != "" {
			if v, ok := vulnCache[dps.Image]; ok {
				c.Vulnerabilities = v
			} else {
				// Scan only if image is not cached
				vulnInfo := dc.scanVulnerabilities(client, dps.Image)
				vulnCache[dps.Image] = vulnInfo
				c.Vulnerabilities = vulnInfo
			}
		}

		if err := dc.DB.UpsertContainer(c); err != nil {
			// log.Printf("[DockerCollector] Failed to upsert container %s: %v", c.Name, err)
		}
	}

	return nil
}

type containerStats struct {
	ID       string      `json:"ID"`
	Name     string      `json:"Name"`
	CPUPerc  string      `json:"CPUPerc"`
	MemUsage string      `json:"MemUsage"`
	MemLimit string      `json:"MemLimit"`
	NetIO    string      `json:"NetIO"`
	BlockIO  string      `json:"BlockIO"`
	PIDs     interface{} `json:"PIDs"` // Can be int or string "--"
}

type dockerPS struct {
	ID     string `json:"ID"`
	Names  string `json:"Names"`
	Image  string `json:"Image"`
	Ports  string `json:"Ports"`
	State  string `json:"State"`
	Status string `json:"Status"`
}

func (dc *DockerCollector) getSSHClient(s data_centralizegg.GenericServer) (*ssh.Client, error) {
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

func (dc *DockerCollector) runCommand(client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

func (dc *DockerCollector) scanVulnerabilities(client *ssh.Client, image string) string {
	// Try docker scout quickview which is faster for summary
	// Use --format json to get parseable output
	cmd := fmt.Sprintf("docker scout quickview %s --format json 2>/dev/null", image)
	output, err := dc.runCommand(client, cmd)
	if err != nil || strings.TrimSpace(output) == "" {
		// Fallback for some systems where scout might be a docker plugin but not in direct path
		cmdFixed := fmt.Sprintf("docker scout quickview %s --format json 2>/dev/null", image)
		output, err = dc.runCommand(client, cmdFixed)
		if err != nil || strings.TrimSpace(output) == "" {
			return ""
		}
	}

	// Simple structure to extract vulnerability counts
	type VulnCounts struct {
		Critical int `json:"critical"`
		High     int `json:"high"`
		Medium   int `json:"medium"`
		Low      int `json:"low"`
	}
	var data struct {
		Vulnerabilities VulnCounts `json:"vulnerabilities"`
	}

	// Quickview sometimes has a slightly different JSON structure than cves
	// We try to unmarshal directly from the root if it's a simple object
	if err := json.Unmarshal([]byte(output), &data); err != nil {
		// If direct unmarshal fails, we'll try to find the "vulnerabilities" key manually in a generic map
		var generic map[string]interface{}
		if err := json.Unmarshal([]byte(output), &generic); err == nil {
			// Check if vulnerabilities is nested in summary or similar
			vulnsRaw := generic["vulnerabilities"]
			if vulnsRaw == nil && generic["summary"] != nil {
				if summary, ok := generic["summary"].(map[string]interface{}); ok {
					vulnsRaw = summary["vulnerabilities"]
				}
			}

			if vulns, ok := vulnsRaw.(map[string]interface{}); ok {
				var v VulnCounts
				if c, ok := vulns["critical"].(float64); ok {
					v.Critical = int(c)
				}
				if h, ok := vulns["high"].(float64); ok {
					v.High = int(h)
				}
				if m, ok := vulns["medium"].(float64); ok {
					v.Medium = int(m)
				}
				if l, ok := vulns["low"].(float64); ok {
					v.Low = int(l)
				}
				data.Vulnerabilities = v
			}
		}
	}

	res := data.Vulnerabilities
	if res.Critical == 0 && res.High == 0 && res.Medium == 0 && res.Low == 0 {
		return "Safe"
	}

	return fmt.Sprintf("Critical:%d,High:%d,Medium:%d,Low:%d", res.Critical, res.High, res.Medium, res.Low)
}

func (dc *DockerCollector) parsePercent(s string) float64 {
	var val float64
	fmt.Sscanf(strings.TrimSuffix(s, "%"), "%f", &val)
	return val
}

func (dc *DockerCollector) parseBytes(s string) uint64 {
	// Format: 1.23MiB / 7.749GiB or 512B
	parts := strings.Fields(s)
	if len(parts) == 0 {
		return 0
	}

	valStr := parts[0]
	var val float64
	var unit string

	// Split numeric and unit
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

func (dc *DockerCollector) parseNetBytes(s string, rx bool) uint64 {
	// Format: 1.23MB / 4.56MB
	parts := strings.Split(s, " / ")
	if len(parts) < 2 {
		return 0
	}

	target := parts[0]
	if !rx {
		target = parts[1]
	}

	return dc.parseBytes(target)
}
