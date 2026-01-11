package firewall

import (
	"bytes"
	"fmt"
	"io/ioutil"
	"log"
	"net"
	"regexp"
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
		if err := mc.collectOne(s); err != nil {
			log.Printf("Failed to collect from pfSense %s (%s): %v", s.Name, s.IPAddress, err)
			mc.DB.SetPFSenseServerStatus(s.ID, "offline")
			continue
		}
		mc.DB.SetPFSenseServerStatus(s.ID, "online")
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

	// 3. Network Interfaces
	// netstat -bdi
	netStats, err := runCommand(client, "netstat -bdi")
	if err == nil {
		parseAndStoreInterfaces(mc.DB, s.ID, netStats)
	}

	// Store Host Data
	hostID, err := mc.DB.UpsertFirewallHost(data_centralizegg.FirewallHost{
		ServerID:         s.ID,
		Hostname:         strings.TrimSpace(hostname),
		CPUModel:         cpuModel,
		CPUCores:         cpuCores,
		TotalMemory:      memTotal,
		FreeMemory:       memFree,
		CPUUsage:         cpuUsage,
		OSName:           "pfSense " + strings.TrimSpace(uname),
		NetRXTotal:       0, // Aggregated from interfaces if needed
		NetTXTotal:       0,
		NetRXBytesPerSec: 0,
		NetTXBytesPerSec: 0,
	})
	if err != nil {
		return fmt.Errorf("upsert host: %w", err)
	}

	_ = hostID
	return nil
}

func getSSHClient(s data_centralizegg.PFSenseServer) (*ssh.Client, error) {
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

	var b bytes.Buffer
	session.Stdout = &b
	if err := session.Run(cmd); err != nil {
		return "", err
	}
	return b.String(), nil
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

func parseAndStoreInterfaces(db *data_centralizegg.DB, hostID int64, output string) {
	// Header: Name  Mtu   Network       Address            Ipkts Ierrs Idrop    Opkts Oerrs  Coll
	// em0   1500  <Link#1>      00:50:56:a6:31:3e  3685412     0     0  2835252     0     0

	lines := strings.Split(output, "\n")
	start := false
	for _, line := range lines {
		if strings.HasPrefix(line, "Name") {
			start = true
			continue
		}
		if !start {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}

		name := fields[0]

		_ = db.UpsertFirewallInterface(data_centralizegg.FirewallInterface{
			HostID:        hostID,
			InterfaceName: name,
			InterfaceType: "ethernet",
			Status:        "up",
		})
	}
}
