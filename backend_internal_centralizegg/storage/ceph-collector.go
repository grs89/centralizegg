package storage

import (
	json "github.com/goccy/go-json"
	"fmt"
	"io/ioutil"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"golang.org/x/crypto/ssh"
)

type CephCollector struct {
	DB *data_centralizegg.DB
}

func NewCephCollector(db *data_centralizegg.DB) *CephCollector {
	return &CephCollector{
		DB: db,
	}
}

func (cc *CephCollector) Start(interval time.Duration) {
	ticker := time.NewTicker(interval)
	// Run once immediately
	go cc.CollectAll()
	go func() {
		for range ticker.C {
			cc.CollectAll()
		}
	}()
}

func (cc *CephCollector) CollectAll() {
	log.Printf("[CephCollector] Starting collection cycle...")
	servers, err := cc.DB.GetGenericServers("ceph")
	if err != nil {
		log.Printf("[CephCollector] Failed to get Ceph servers: %v", err)
		return
	}

	for _, s := range servers {
		metaMap := map[string]string{"ip": s.IPAddress, "name": s.Name}
		metaBytes, _ := json.Marshal(metaMap)
		metadata := string(metaBytes)

		if err := cc.collectOne(s); err != nil {
			log.Printf("[CephCollector] Failed to collect from Ceph node %s (%s): %v", s.Name, s.IPAddress, err)
			cc.DB.SetGenericServerStatus("ceph", s.ID, "offline", metadata)
			// Insert "down" metric point
			cc.DB.InsertServerMetrics(data_centralizegg.ServerMetric{
				ServerID:  s.ID,
				Category:  "ceph",
				Timestamp: time.Now(),
				IsOnline:  false,
			})
			continue
		}
		cc.DB.SetGenericServerStatus("ceph", s.ID, "online", metadata)
	}
}

func (cc *CephCollector) collectOne(s data_centralizegg.GenericServer) error {
	client, err := cc.getSSHClient(s)
	if err != nil {
		return err
	}
	defer client.Close()

	// Fetch logs and save to DB
	cc.storeHostLogs(client, s.ID)

	// 1. Get System Info
	hostname, _ := cc.runCommand(client, "hostname")
	uname, _ := cc.runCommand(client, "uname -srm")
	uptime, _ := cc.runCommand(client, "uptime -p")
	archRaw, _ := cc.runCommand(client, "uname -m")
	arch := strings.TrimSpace(archRaw)

	// CPU Info
	cpuModelRaw, _ := cc.runCommand(client, "grep 'model name' /proc/cpuinfo | head -n 1 | cut -d ':' -f 2")
	cpuCoresRaw, _ := cc.runCommand(client, "grep -c 'processor' /proc/cpuinfo")
	cpuCores, _ := strconv.Atoi(strings.TrimSpace(cpuCoresRaw))

	// Memory Info
	memTotalRaw, _ := cc.runCommand(client, "free -b | grep Mem | awk '{print $2}'")
	memFreeRaw, _ := cc.runCommand(client, "free -b | grep Mem | awk '{print $7}'")
	memTotal, _ := strconv.ParseUint(strings.TrimSpace(memTotalRaw), 10, 64)
	memFree, _ := strconv.ParseUint(strings.TrimSpace(memFreeRaw), 10, 64)

	// CPU Usage
	cpuUsageRaw, _ := cc.runCommand(client, "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d '%' -f 1")
	cpuUsage, _ := strconv.ParseFloat(strings.TrimSpace(cpuUsageRaw), 64)

	// OS Info
	osName, _ := cc.runCommand(client, "grep '^PRETTY_NAME=' /etc/os-release | cut -d '\"' -f 2")
	if osName == "" {
		osName = "Unknown Linux"
	}

	// 2. Get Ceph Status
	// We run 'ceph status -f json'
	// This might fail if the user cannot run ceph without sudo, or if keyrings are missing.
	// We'll try to run it.
	cephStatusJSON, err := cc.runCommand(client, "ceph status -f json")
	if err != nil || cephStatusJSON == "" {
		// Try with sudo? or just log it.
		// log.Printf("Failed to get ceph status: %v", err)
		// We can still save the host info even if ceph status fails
	}

	// Parse basic health from JSON if possible, otherwise leave empty or unknown
	clusterHealth := "unknown"
	if cephStatusJSON != "" {
		var statusStruct struct {
			Health struct {
				Status string `json:"status"`
			} `json:"health"`
		}
		if err := json.Unmarshal([]byte(cephStatusJSON), &statusStruct); err == nil {
			clusterHealth = statusStruct.Health.Status
		}
	}

	// Active Connections
	activeConnsJSON := "[]"
	connsOutput, err := cc.runCommand(client, `ss -tunp state established 2>/dev/null | grep -vE '127\.0\.0\.1|::1|169\.254\.' | awk 'NR>1 {print $5}'`)
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

	_, err = cc.DB.UpsertCephHost(data_centralizegg.CephHost{
		ServerID:          s.ID,
		Hostname:          strings.TrimSpace(hostname),
		Status:            "online",
		CPUModel:          strings.TrimSpace(cpuModelRaw),
		CPUCores:          cpuCores,
		TotalMemory:       memTotal,
		FreeMemory:        memFree,
		CPUUsage:          cpuUsage,
		OSName:            strings.TrimSpace(osName),
		KernelVer:         strings.TrimSpace(uname),
		Uptime:            strings.TrimSpace(uptime),
		ClusterStatus:     cephStatusJSON,
		ClusterHealth:     clusterHealth,
		ActiveConnections: activeConnsJSON,
		Architecture:      arch,
	})

	// Insert Historical Metrics
	metric := data_centralizegg.ServerMetric{
		ServerID:    s.ID,
		Category:    "ceph",
		Timestamp:   time.Now(),
		CPUUsage:    cpuUsage,
		MemoryUsage: memTotal - memFree,
		IsOnline:    true,
	}
	cc.DB.InsertServerMetrics(metric)
	cc.DB.UpdateGenericServerStats("ceph", s.ID, cpuUsage, cpuCores, memTotal, memFree, 0, 0, strings.TrimSpace(osName), strings.TrimSpace(cpuModelRaw), strings.TrimSpace(uptime), arch)

	return err
}

func (cc *CephCollector) getSSHClient(s data_centralizegg.GenericServer) (*ssh.Client, error) {
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

func (cc *CephCollector) runCommand(client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

func (cc *CephCollector) storeHostLogs(client *ssh.Client, serverID int64) {
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
		_ = cc.DB.SaveHostLog("ceph", serverID, logs)
	}
}
func (cc *CephCollector) GetHostLogs(id int64) (string, error) {
	servers, err := cc.DB.GetGenericServers("ceph")
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

	client, err := cc.getSSHClient(s)
	if err != nil {
		return "", err
	}
	defer client.Close()

	return cc.runCommand(client, "journalctl -n 50 --no-pager")
}
