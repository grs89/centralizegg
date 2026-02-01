package virtualization

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

type ProxmoxCollector struct {
	DB *data_centralizegg.DB
}

func NewProxmoxCollector(db *data_centralizegg.DB) *ProxmoxCollector {
	return &ProxmoxCollector{
		DB: db,
	}
}

func (pc *ProxmoxCollector) Start(interval time.Duration) {
	ticker := time.NewTicker(interval)
	// Run once immediately
	go pc.CollectAll()
	go func() {
		for range ticker.C {
			pc.CollectAll()
		}
	}()
}

func (pc *ProxmoxCollector) CollectAll() {
	log.Printf("[ProxmoxCollector] Starting collection cycle...")
	servers, err := pc.DB.GetGenericServers("proxmox")
	if err != nil {
		log.Printf("[ProxmoxCollector] Failed to get proxmox servers: %v", err)
		return
	}

	for _, s := range servers {
		metaMap := map[string]string{"ip": s.IPAddress, "name": s.Name}
		metaBytes, _ := json.Marshal(metaMap)
		metadata := string(metaBytes)

		if err := pc.collectOne(s); err != nil {
			log.Printf("[ProxmoxCollector] Failed to collect from Proxmox %s (%s): %v", s.Name, s.IPAddress, err)
			pc.DB.SetGenericServerStatus("proxmox", s.ID, "offline", metadata)
			continue
		}
		pc.DB.SetGenericServerStatus("proxmox", s.ID, "online", metadata)
	}
}

func (pc *ProxmoxCollector) collectOne(s data_centralizegg.GenericServer) error {
	client, err := pc.getSSHClient(s)
	if err != nil {
		return err
	}
	defer client.Close()

	// 1. Get Nodes
	nodesJSON, err := pc.runCommand(client, "pvesh get /nodes --output-format json")
	if err != nil {
		return fmt.Errorf("failed to get nodes: %w", err)
	}

	var nodes []struct {
		Node   string  `json:"node"`
		Status string  `json:"status"`
		CPU    float64 `json:"cpu"`
		MaxCPU int     `json:"maxcpu"`
		Mem    uint64  `json:"mem"`
		MaxMem uint64  `json:"maxmem"`
		Uptime int64   `json:"uptime"`
	}
	if err := json.Unmarshal([]byte(nodesJSON), &nodes); err != nil {
		return fmt.Errorf("failed to unmarshal nodes: %w", err)
	}

	for _, n := range nodes {
		// Get detailed node status for PVE version and OS info
		nodeStatusJSON, _ := pc.runCommand(client, fmt.Sprintf("pvesh get /nodes/%s/status --output-format json", n.Node))
		var nodeStat struct {
			PVEVersion string `json:"pveversion"`
			Uptime     int64  `json:"uptime"`
			Memory     struct {
				Total uint64 `json:"total"`
				Free  uint64 `json:"free"`
			} `json:"memory"`
			CPUInfo struct {
				Model string `json:"model"`
				CPUs  int    `json:"cpus"`
			} `json:"cpuinfo"`
		}
		json.Unmarshal([]byte(nodeStatusJSON), &nodeStat)

		// Get OS info via standard command
		osName, _ := pc.runCommand(client, "cut -d '\"' -f 2 /etc/os-release | head -n 1")
		kernelVer, _ := pc.runCommand(client, "uname -r")

		hostID, err := pc.DB.UpsertProxmoxHost(data_centralizegg.ProxmoxHost{
			ServerID:    s.ID,
			Hostname:    n.Node,
			Status:      n.Status,
			CPUModel:    strings.TrimSpace(nodeStat.CPUInfo.Model),
			CPUCores:    nodeStat.CPUInfo.CPUs,
			TotalMemory: nodeStat.Memory.Total,
			FreeMemory:  nodeStat.Memory.Free,
			CPUUsage:    n.CPU * 100,
			OSName:      strings.TrimSpace(osName),
			KernelVer:   strings.TrimSpace(kernelVer),
			PVEVersion:  nodeStat.PVEVersion,
			Uptime:      fmt.Sprintf("%d seconds", n.Uptime),
		})
		if err != nil {
			log.Printf("[ProxmoxCollector] Failed to upsert host %s: %v", n.Node, err)
			continue
		}

		// 2. Get VMs (QEMU)
		vmsJSON, _ := pc.runCommand(client, fmt.Sprintf("pvesh get /nodes/%s/qemu --output-format json", n.Node))
		var vms []struct {
			VMID   int     `json:"vmid"`
			Name   string  `json:"name"`
			Status string  `json:"status"`
			CPU    float64 `json:"cpu"`
			Mem    uint64  `json:"mem"`
			MaxMem uint64  `json:"maxmem"`
			NetIn  uint64  `json:"netin"`
			NetOut uint64  `json:"netout"`
		}
		json.Unmarshal([]byte(vmsJSON), &vms)

		for _, v := range vms {
			pc.DB.UpsertProxmoxVM(data_centralizegg.ProxmoxVM{
				HostID:      hostID,
				VMID:        v.VMID,
				Name:        v.Name,
				Type:        "qemu",
				State:       v.Status,
				CPUUsage:    v.CPU * 100,
				MemoryUsage: v.Mem,
				MaxMemory:   v.MaxMem,
				NetRX:       v.NetIn,
				NetTX:       v.NetOut,
			})
		}

		// 3. Get Containers (LXC)
		lxcJSON, _ := pc.runCommand(client, fmt.Sprintf("pvesh get /nodes/%s/lxc --output-format json", n.Node))
		var lxcs []struct {
			VMID   int     `json:"vmid"`
			Name   string  `json:"name"`
			Status string  `json:"status"`
			CPU    float64 `json:"cpu"`
			Mem    uint64  `json:"mem"`
			MaxMem uint64  `json:"maxmem"`
			NetIn  uint64  `json:"netin"`
			NetOut uint64  `json:"netout"`
		}
		json.Unmarshal([]byte(lxcJSON), &lxcs)

		for _, l := range lxcs {
			pc.DB.UpsertProxmoxVM(data_centralizegg.ProxmoxVM{
				HostID:      hostID,
				VMID:        l.VMID,
				Name:        l.Name,
				Type:        "lxc",
				State:       l.Status,
				CPUUsage:    l.CPU * 100,
				MemoryUsage: l.Mem,
				MaxMemory:   l.MaxMem,
				NetRX:       l.NetIn,
				NetTX:       l.NetOut,
			})
		}

		// Update host counts
		pc.DB.Conn.Exec("UPDATE virtualization.proxmox_hosts SET vms_count = $1, containers_count = $2 WHERE id = $3", len(vms), len(lxcs), hostID)
	}

	return nil
}

func (pc *ProxmoxCollector) getSSHClient(s data_centralizegg.GenericServer) (*ssh.Client, error) {
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

func (pc *ProxmoxCollector) runCommand(client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}
func (pc *ProxmoxCollector) GetHostLogs(id int64) (string, error) {
	servers, err := pc.DB.GetGenericServers("proxmox")
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
