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

type NasCollector struct {
	DB *data_centralizegg.DB
}

func NewNasCollector(db *data_centralizegg.DB) *NasCollector {
	return &NasCollector{
		DB: db,
	}
}

func (nc *NasCollector) Start(interval time.Duration) {
	ticker := time.NewTicker(interval)
	// Run once immediately
	go nc.CollectAll()
	go func() {
		for range ticker.C {
			nc.CollectAll()
		}
	}()
}

func (nc *NasCollector) CollectAll() {
	log.Printf("[NasCollector] Starting collection cycle...")
	servers, err := nc.DB.GetGenericServers("nas")
	if err != nil {
		log.Printf("[NasCollector] Failed to get NAS servers: %v", err)
		return
	}

	for _, s := range servers {
		metaMap := map[string]string{"ip": s.IPAddress, "name": s.Name}
		metaBytes, _ := json.Marshal(metaMap)
		metadata := string(metaBytes)

		if err := nc.collectOne(s); err != nil {
			log.Printf("[NasCollector] Failed to collect from NAS %s (%s): %v", s.Name, s.IPAddress, err)
			nc.DB.SetGenericServerStatus("nas", s.ID, "offline", metadata)
			// Insert "down" metric point
			nc.DB.InsertServerMetrics(data_centralizegg.ServerMetric{
				ServerID:  s.ID,
				Category:  "nas",
				Timestamp: time.Now(),
				IsOnline:  false,
			})
			continue
		}
		nc.DB.SetGenericServerStatus("nas", s.ID, "online", metadata)
	}
}

func (nc *NasCollector) collectOne(s data_centralizegg.GenericServer) error {
	client, err := nc.getSSHClient(s)
	if err != nil {
		return err
	}
	defer client.Close()

	// Fetch logs and save to DB
	nc.storeHostLogs(client, s.ID)

	// 1. Get System Info
	hostname, _ := nc.runCommand(client, "hostname")
	uname, _ := nc.runCommand(client, "uname -srm")
	uptime, _ := nc.runCommand(client, "uptime -p")

	// CPU Info
	cpuModelRaw, _ := nc.runCommand(client, "grep 'model name' /proc/cpuinfo | head -n 1 | cut -d ':' -f 2")
	cpuCoresRaw, _ := nc.runCommand(client, "grep -c 'processor' /proc/cpuinfo")
	cpuCores, _ := strconv.Atoi(strings.TrimSpace(cpuCoresRaw))

	// Memory Info
	memTotalRaw, _ := nc.runCommand(client, "free -b | grep Mem | awk '{print $2}'")
	memFreeRaw, _ := nc.runCommand(client, "free -b | grep Mem | awk '{print $7}'")
	memTotal, _ := strconv.ParseUint(strings.TrimSpace(memTotalRaw), 10, 64)
	memFree, _ := strconv.ParseUint(strings.TrimSpace(memFreeRaw), 10, 64)

	// CPU Usage (rough estimate via top)
	cpuUsageRaw, _ := nc.runCommand(client, "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d '%' -f 1")
	cpuUsage, _ := strconv.ParseFloat(strings.TrimSpace(cpuUsageRaw), 64)

	// OS Info
	osName, _ := nc.runCommand(client, "grep '^PRETTY_NAME=' /etc/os-release | cut -d '\"' -f 2")
	if osName == "" {
		osName = "Unknown Linux"
	}

	// Active Connections
	activeConnsJSON := "[]"
	connsOutput, err := nc.runCommand(client, `ss -tunp state established 2>/dev/null | grep -vE '127\.0\.0\.1|::1|169\.254\.' | awk 'NR>1 {print $5}'`)
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

	archRaw, _ := nc.runCommand(client, "uname -m")
	arch := strings.TrimSpace(archRaw)

	hostID, err := nc.DB.UpsertNasHost(data_centralizegg.NasHost{
		ServerID:          s.ID,
		Hostname:          strings.TrimSpace(hostname),
		Status:            "online",
		CPUModel:          strings.TrimSpace(cpuModelRaw),
		CPUCores:          int(cpuCores),
		TotalMemory:       memTotal,
		FreeMemory:        memFree,
		CPUUsage:          cpuUsage,
		OSName:            strings.TrimSpace(osName),
		KernelVer:         strings.TrimSpace(uname),
		Uptime:            strings.TrimSpace(uptime),
		ActiveConnections: activeConnsJSON,
		Architecture:      arch,
	})
	if err != nil {
		return err
	}

	// 2. Get Volumes (df -B1)
	dfOut, _ := nc.runCommand(client, "df -B1 --output=target,fstype,size,used,pcent")
	lines := strings.Split(dfOut, "\n")
	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 5 {
			path := fields[0]
			fsType := fields[1]
			total, _ := strconv.ParseUint(fields[2], 10, 64)
			used, _ := strconv.ParseUint(fields[3], 10, 64)

			// Only track significant volumes (skip tempfs, etc. or keep all and filter frontend)
			if !strings.HasPrefix(path, "/dev") && !strings.HasPrefix(path, "/run") && !strings.HasPrefix(path, "/sys") && path != "/proc" {
				nc.DB.UpsertNasVolume(data_centralizegg.NasVolume{
					HostID:    hostID,
					Name:      path,
					Path:      path,
					Status:    "online",
					TotalSize: total,
					UsedSize:  used,
					Type:      fsType,
				})
			}
		}
	}

	// 3. Get Disks (lsblk -J if available)
	lsblkOut, _ := nc.runCommand(client, "lsblk -J -b -o NAME,MODEL,SERIAL,SIZE,TEMP")
	var lsblkData struct {
		BlockDevices []struct {
			Name   string `json:"name"`
			Model  string `json:"model"`
			Serial string `json:"serial"`
			Size   int64  `json:"size"`
			Temp   string `json:"temp"`
		} `json:"blockdevices"`
	}
	if err := json.Unmarshal([]byte(lsblkOut), &lsblkData); err == nil {
		for _, d := range lsblkData.BlockDevices {
			if strings.HasPrefix(d.Name, "sd") || strings.HasPrefix(d.Name, "nv") || strings.HasPrefix(d.Name, "hd") {
				temp, _ := strconv.Atoi(strings.TrimSuffix(d.Temp, "C"))
				nc.DB.UpsertNasDisk(data_centralizegg.NasDisk{
					HostID: hostID,
					Name:   d.Name,
					Model:  d.Model,
					Serial: d.Serial,
					Size:   uint64(d.Size),
					Status: "healthy",
					Temp:   temp,
				})
			}
		}
	}

	// Insert Historical Metrics
	metric := data_centralizegg.ServerMetric{
		ServerID:    hostID,
		Category:    "nas",
		Timestamp:   time.Now(),
		CPUUsage:    cpuUsage,
		MemoryUsage: memTotal - memFree,
		// NAS doesn't have total NetRX/TX easily aggregated in this script yet,
		// but we can add placeholders or leave at 0.
		IsOnline: true,
	}
	nc.DB.InsertServerMetrics(metric)
	nc.DB.UpdateGenericServerStats("nas", s.ID, cpuUsage, int(cpuCores), memTotal, memFree, 0, 0, osName, cpuModelRaw, uptime, arch)

	return nil
}

func (nc *NasCollector) getSSHClient(s data_centralizegg.GenericServer) (*ssh.Client, error) {
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

func (nc *NasCollector) runCommand(client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

func (nc *NasCollector) storeHostLogs(client *ssh.Client, serverID int64) {
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
		_ = nc.DB.SaveHostLog("nas", serverID, logs)
	}
}
func (nc *NasCollector) GetHostLogs(id int64) (string, error) {
	servers, err := nc.DB.GetGenericServers("nas")
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

	client, err := nc.getSSHClient(s)
	if err != nil {
		return "", err
	}
	defer client.Close()

	return nc.runCommand(client, "journalctl -n 50 --no-pager")
}
