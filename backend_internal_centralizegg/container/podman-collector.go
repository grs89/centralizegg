package container

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"strings"
	"time"

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
		if err := pc.collectOne(s); err != nil {
			log.Printf("[PodmanCollector] Failed to collect from Podman %s (%s): %v", s.Name, s.IPAddress, err)
			pc.DB.SetGenericServerStatus("podman", s.ID, "offline")
			continue
		}
		log.Printf("[PodmanCollector] Successfully collected from %s.", s.Name)
		pc.DB.SetGenericServerStatus("podman", s.ID, "online")
	}
}

func (pc *PodmanCollector) collectOne(s data_centralizegg.GenericServer) error {
	client, err := pc.getSSHClient(s)
	if err != nil {
		return fmt.Errorf("ssh connection failed: %w", err)
	}
	defer client.Close()

	// 1. Host Info
	hostnameRaw, _ := pc.runCommand(client, "hostname")
	hostname := strings.TrimSpace(hostnameRaw)

	osNameRaw, _ := pc.runCommand(client, "grep PRETTY_NAME /etc/os-release | cut -d '\"' -f 2")
	osName := strings.TrimSpace(osNameRaw)

	uptimeRaw, _ := pc.runCommand(client, "uptime -p")
	uptime := strings.TrimSpace(uptimeRaw)

	cpuModelRaw, _ := pc.runCommand(client, "grep 'model name' /proc/cpuinfo | head -n 1 | cut -d ':' -f 2 | xargs")
	cpuModel := strings.TrimSpace(cpuModelRaw)

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
	// Use df on the rootDir
	storageRaw, _ := pc.runCommand(client, fmt.Sprintf("df -B1 %s | tail -1 | awk '{print $3,$2}'", rootDir))
	fmt.Sscanf(strings.TrimSpace(storageRaw), "%d %d", &storageUsed, &storageTotal)

	// Inodes
	inodesUsageRaw, _ := pc.runCommand(client, fmt.Sprintf("df -i %s | tail -1 | awk '{print $5}'", rootDir))
	inodesUsage := strings.TrimSpace(inodesUsageRaw)

	// Volumes
	volumesRaw, _ := pc.runCommand(client, "podman volume ls -q")
	var volList []string
	volLines := strings.Split(strings.TrimSpace(volumesRaw), "\n")
	for _, line := range volLines {
		line = strings.TrimSpace(line)
		if line != "" {
			volList = append(volList, line)
		}
	}
	volumesJSON, _ := json.Marshal(volList)

	hostID, err := pc.DB.UpsertPodmanHost(data_centralizegg.PodmanHost{
		ServerID:      s.ID,
		Hostname:      hostname,
		CPUModel:      cpuModel,
		CPUCores:      cpuCores,
		TotalMemory:   memTotal,
		FreeMemory:    memFree,
		CPUUsage:      cpuUsage,
		OSName:        osName,
		Uptime:        uptime,
		PodmanVer:     podmanVer,
		ServiceStatus: serviceStatus,
		APILatency:    apiLatency,
		StorageUsed:   storageUsed,
		StorageTotal:  storageTotal,
		InodesUsage:   inodesUsage,
		Volumes:       string(volumesJSON),
	})
	if err != nil {
		return fmt.Errorf("upsert podman host: %w", err)
	}

	// 2. Containers Info
	// Podman stats
	statsOutput, err := pc.runCommand(client, "podman stats --no-stream --format json")
	statsMap := make(map[string]podmanStats)
	if err == nil {
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
		}
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

	var psList []podmanPS
	if err := json.Unmarshal([]byte(psOutput), &psList); err != nil {
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

		c := data_centralizegg.Container{
			Name:            name,
			Image:           pps.Image,
			Ports:           pc.formatPorts(pps.Ports),
			State:           pps.State,
			Status:          pps.Status,
			CPUUsage:        pc.parsePercent(cpuPerc),
			MemUsage:        pc.parseBytes(memUsage),
			MemLimit:        pc.parseBytes(st.MemLimit),
			NetRX:           pc.parseNetBytes(st.NetIO, true),
			NetTX:           pc.parseNetBytes(st.NetIO, false),
			BlockIn:         pc.parseNetBytes(st.BlockIO, true),
			BlockOut:        pc.parseNetBytes(st.BlockIO, false),
			PIDs:            st.PIDs,
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
	ID       string `json:"id"`
	Name     string `json:"name"`
	CPUPerc  string `json:"cpu_percent"`
	CPU      string `json:"CPU"` // fallback for some versions
	MemUsage string `json:"mem_usage"`
	Mem      string `json:"MemUsage"` // fallback
	MemLimit string `json:"mem_limit"`
	NetIO    string `json:"net_io"`
	BlockIO  string `json:"block_io"`
	PIDs     int    `json:"pids"`
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
	HostPort      int    `json:"hostPort"`
	ContainerPort int    `json:"containerPort"`
	Protocol      string `json:"protocol"`
	HostIP        string `json:"hostIP"`
}

func (pc *PodmanCollector) formatPorts(ports []podmanPort) string {
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
	parts := strings.Split(s, " / ")
	if len(parts) < 2 {
		return 0
	}

	target := parts[0]
	if !rx {
		target = parts[1]
	}

	return pc.parseBytes(target)
}
