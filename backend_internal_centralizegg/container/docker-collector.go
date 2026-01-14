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
	log.Printf("[DockerCollector] Starting collection cycle...")
	servers, err := dc.DB.GetGenericServers("docker")
	if err != nil {
		log.Printf("[DockerCollector] Failed to get docker servers: %v", err)
		return
	}

	if len(servers) == 0 {
		log.Printf("[DockerCollector] No docker servers configured.")
		return
	}

	for _, s := range servers {
		log.Printf("[DockerCollector] Collecting from %s (%s)...", s.Name, s.IPAddress)
		if err := dc.collectOne(s); err != nil {
			log.Printf("[DockerCollector] Failed to collect from Docker %s (%s): %v", s.Name, s.IPAddress, err)
			dc.DB.SetGenericServerStatus("docker", s.ID, "offline")
			continue
		}
		log.Printf("[DockerCollector] Successfully collected from %s.", s.Name)
		dc.DB.SetGenericServerStatus("docker", s.ID, "online")
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
		UpdateStatus:  "Up to Date",
	})
	if err != nil {
		return fmt.Errorf("upsert docker host: %w", err)
	}

	// 2. Containers Info
	// Get OOM status
	oomMap := make(map[string]bool)
	oomOutput, err := dc.runCommand(client, `[ -n "$(docker ps -aq)" ] && docker inspect --format '{{.Name}} {{.State.OOMKilled}}' $(docker ps -aq) || echo ""`)
	if err == nil {
		lines := strings.Split(strings.TrimSpace(oomOutput), "\n")
		for _, line := range lines {
			if line == "" {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) == 2 {
				name := strings.TrimPrefix(parts[0], "/")
				oomMap[name] = parts[1] == "true"
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

		st := statsMap[dps.Names]

		c := data_centralizegg.Container{
			Name:      dps.Names,
			Image:     dps.Image,
			State:     dps.State,
			Status:    dps.Status,
			CPUUsage:  dc.parsePercent(st.CPUPerc),
			MemUsage:  dc.parseBytes(st.MemUsage),
			MemLimit:  dc.parseBytes(st.MemLimit),
			NetRX:     dc.parseNetBytes(st.NetIO, true),
			NetTX:     dc.parseNetBytes(st.NetIO, false),
			BlockIn:   dc.parseNetBytes(st.BlockIO, true),
			BlockOut:  dc.parseNetBytes(st.BlockIO, false),
			PIDs:      st.PIDs,
			OOMKilled: oomMap[dps.Names],
			HostID:    hostID,
		}

		dc.DB.UpsertContainer(c)
	}

	return nil
}

type containerStats struct {
	Name     string `json:"Name"`
	CPUPerc  string `json:"CPUPerc"`
	MemUsage string `json:"MemUsage"`
	MemLimit string `json:"MemLimit"`
	NetIO    string `json:"NetIO"`
	BlockIO  string `json:"BlockIO"`
	PIDs     int    `json:"PIDs"`
}

type dockerPS struct {
	Names  string `json:"Names"`
	Image  string `json:"Image"`
	State  string `json:"State"`
	Status string `json:"Status"`
}

func (dc *DockerCollector) getSSHClient(s data_centralizegg.GenericServer) (*ssh.Client, error) {
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

func (dc *DockerCollector) runCommand(client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
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
