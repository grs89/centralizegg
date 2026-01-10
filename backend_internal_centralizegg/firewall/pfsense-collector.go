package firewall

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"time"

	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
)

type PFSenseCollector struct {
	DB           *data_centralizegg.DB
	lastNetStats map[int64]netStats // Key: serverID, for calculating per-second rates
}

type netStats struct {
	rxTotal    uint64
	txTotal    uint64
	lastAt     time.Time
}

type PFSenseAPIResponse struct {
	Status string      `json:"status"`
	Data   interface{} `json:"data"`
}

type SystemStatus struct {
	Hostname string `json:"hostname"`
	Version  string `json:"version"`
	Uptime   string `json:"uptime"`
}

type SystemLoad struct {
	OneMin     float64 `json:"1min"`
	FiveMin    float64 `json:"5min"`
	FifteenMin float64 `json:"15min"`
}

type SystemMemory struct {
	Total     uint64 `json:"total"`
	Used      uint64 `json:"used"`
	Free      uint64 `json:"free"`
	Available uint64 `json:"available"`
}

type InterfaceStats struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Status      string `json:"status"`
	InBytes     uint64 `json:"inbytes"`
	OutBytes    uint64 `json:"outbytes"`
	InPackets   uint64 `json:"inpkts"`
	OutPackets  uint64 `json:"outpkts"`
	InErrors    uint64 `json:"inerrs"`
	OutErrors   uint64 `json:"outerrs"`
	InDropped   uint64 `json:"indrops"`
	OutDropped  uint64 `json:"outdrops"`
}

func NewPFSenseCollector(db *data_centralizegg.DB) *PFSenseCollector {
	return &PFSenseCollector{
		DB:           db,
		lastNetStats: make(map[int64]netStats),
	}
}

func (pc *PFSenseCollector) CollectAll() {
	servers, err := pc.DB.GetPFSenseServers()
	if err != nil {
		log.Printf("Failed to get PFSense servers: %v", err)
		return
	}

	for _, s := range servers {
		if err := pc.collectOne(s); err != nil {
			log.Printf("Failed to collect from PFSense %s (%s): %v", s.Name, s.IPAddress, err)
			pc.DB.SetPFSenseServerStatus(s.ID, "offline")
			continue
		}
		pc.DB.SetPFSenseServerStatus(s.ID, "online")
	}
}

func (pc *PFSenseCollector) collectOne(s data_centralizegg.PFSenseServer) error {
	// Build API URL
	port := s.APIPort
	if port == 0 {
		port = 443
	}
	baseURL := fmt.Sprintf("https://%s:%d/api/v1", s.IPAddress, port)

	// Create HTTP client with TLS skip verify (PFSense often uses self-signed certs)
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{
		Transport: tr,
		Timeout:   10 * time.Second,
	}

	// Get system status
	status, err := pc.getSystemStatus(client, baseURL, s.APIKey, s.APISecret)
	if err != nil {
		return fmt.Errorf("system status: %w", err)
	}

	// Get system load (CPU usage)
	load, err := pc.getSystemLoad(client, baseURL, s.APIKey, s.APISecret)
	if err != nil {
		return fmt.Errorf("system load: %w", err)
	}

	// Get memory info
	mem, err := pc.getSystemMemory(client, baseURL, s.APIKey, s.APISecret)
	if err != nil {
		return fmt.Errorf("system memory: %w", err)
	}

	// Get interface statistics
	interfaces, err := pc.getInterfaceStats(client, baseURL, s.APIKey, s.APISecret)
	if err != nil {
		return fmt.Errorf("interface stats: %w", err)
	}

	// Calculate CPU usage from load average (1min load * 100 / cores)
	// For simplicity, we'll use 1min load as percentage (assuming single core equivalent)
	cpuUsage := load.OneMin * 100.0
	if cpuUsage > 100 {
		cpuUsage = 100
	}

	// Calculate total network traffic
	var totalRX, totalTX uint64
	for _, iface := range interfaces {
		totalRX += iface.InBytes
		totalTX += iface.OutBytes
	}

	// Calculate network bytes per second
	var rxBytesPerSec, txBytesPerSec uint64
	now := time.Now()
	if prev, ok := pc.lastNetStats[s.ID]; ok {
		deltaTime := now.Sub(prev.lastAt).Seconds()
		if deltaTime > 0 {
			rxBytesPerSec = uint64(float64(totalRX-prev.rxTotal) / deltaTime)
			txBytesPerSec = uint64(float64(totalTX-prev.txTotal) / deltaTime)
		}
	}
	pc.lastNetStats[s.ID] = netStats{
		rxTotal: totalRX,
		txTotal: totalTX,
		lastAt:  now,
	}

	// Get CPU info (try to get from system info, default to 1 if not available)
	cpuCores := 1
	cpuModel := "Unknown"

	// Create host record
	host := data_centralizegg.FirewallHost{
		ServerID:        s.ID,
		Hostname:        status.Hostname,
		CPUModel:        cpuModel,
		CPUCores:        cpuCores,
		TotalMemory:     mem.Total,
		FreeMemory:      mem.Free,
		CPUUsage:        cpuUsage,
		OSName:          fmt.Sprintf("PFSense %s", status.Version),
		NetRXTotal:      totalRX,
		NetTXTotal:      totalTX,
		NetRXBytesPerSec: rxBytesPerSec,
		NetTXBytesPerSec: txBytesPerSec,
	}

	hostID, err := pc.DB.UpsertFirewallHost(host)
	if err != nil {
		return fmt.Errorf("upsert host: %w", err)
	}

	// Upsert interfaces
	for _, iface := range interfaces {
		fwIface := data_centralizegg.FirewallInterface{
			HostID:        hostID,
			InterfaceName: iface.Name,
			InterfaceType: iface.Type,
			Status:        iface.Status,
			NetRXBytes:    iface.InBytes,
			NetTXBytes:    iface.OutBytes,
			NetRXPackets:  iface.InPackets,
			NetTXPackets:  iface.OutPackets,
			NetRXErrors:   iface.InErrors,
			NetTXErrors:   iface.OutErrors,
			NetRXDropped:  iface.InDropped,
			NetTXDropped:  iface.OutDropped,
		}
		pc.DB.UpsertFirewallInterface(fwIface)
	}

	return nil
}

func (pc *PFSenseCollector) makeAPIRequest(client *http.Client, url, apiKey, apiSecret string) ([]byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	// PFSense API uses basic auth with API key and secret
	req.SetBasicAuth(apiKey, apiSecret)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := ioutil.ReadAll(resp.Body)
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return body, nil
}

func (pc *PFSenseCollector) getSystemStatus(client *http.Client, baseURL, apiKey, apiSecret string) (*SystemStatus, error) {
	url := fmt.Sprintf("%s/system/status", baseURL)
	body, err := pc.makeAPIRequest(client, url, apiKey, apiSecret)
	if err != nil {
		return nil, err
	}

	var response PFSenseAPIResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, err
	}

	if response.Status != "ok" {
		return nil, fmt.Errorf("API returned non-ok status: %s", response.Status)
	}

	// Parse data
	dataBytes, err := json.Marshal(response.Data)
	if err != nil {
		return nil, err
	}

	var status SystemStatus
	if err := json.Unmarshal(dataBytes, &status); err != nil {
		return nil, err
	}

	return &status, nil
}

func (pc *PFSenseCollector) getSystemLoad(client *http.Client, baseURL, apiKey, apiSecret string) (*SystemLoad, error) {
	url := fmt.Sprintf("%s/diagnostics/system/loadavg", baseURL)
	body, err := pc.makeAPIRequest(client, url, apiKey, apiSecret)
	if err != nil {
		return nil, err
	}

	var response PFSenseAPIResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, err
	}

	if response.Status != "ok" {
		return nil, fmt.Errorf("API returned non-ok status: %s", response.Status)
	}

	dataBytes, err := json.Marshal(response.Data)
	if err != nil {
		return nil, err
	}

	var load SystemLoad
	if err := json.Unmarshal(dataBytes, &load); err != nil {
		return nil, err
	}

	return &load, nil
}

func (pc *PFSenseCollector) getSystemMemory(client *http.Client, baseURL, apiKey, apiSecret string) (*SystemMemory, error) {
	url := fmt.Sprintf("%s/diagnostics/system/memory", baseURL)
	body, err := pc.makeAPIRequest(client, url, apiKey, apiSecret)
	if err != nil {
		return nil, err
	}

	var response PFSenseAPIResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, err
	}

	if response.Status != "ok" {
		return nil, fmt.Errorf("API returned non-ok status: %s", response.Status)
	}

	dataBytes, err := json.Marshal(response.Data)
	if err != nil {
		return nil, err
	}

	var mem SystemMemory
	if err := json.Unmarshal(dataBytes, &mem); err != nil {
		return nil, err
	}

	return &mem, nil
}

func (pc *PFSenseCollector) getInterfaceStats(client *http.Client, baseURL, apiKey, apiSecret string) ([]InterfaceStats, error) {
	url := fmt.Sprintf("%s/diagnostics/interface/statistics", baseURL)
	body, err := pc.makeAPIRequest(client, url, apiKey, apiSecret)
	if err != nil {
		return nil, err
	}

	var response PFSenseAPIResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, err
	}

	if response.Status != "ok" {
		return nil, fmt.Errorf("API returned non-ok status: %s", response.Status)
	}

	dataBytes, err := json.Marshal(response.Data)
	if err != nil {
		return nil, err
	}

	// PFSense returns interface stats as a map, we need to convert to array
	var ifaceMap map[string]interface{}
	if err := json.Unmarshal(dataBytes, &ifaceMap); err != nil {
		return nil, err
	}

	var interfaces []InterfaceStats
	for name, data := range ifaceMap {
		ifaceDataBytes, _ := json.Marshal(data)
		var iface InterfaceStats
		if err := json.Unmarshal(ifaceDataBytes, &iface); err != nil {
			continue
		}
		iface.Name = name
		interfaces = append(interfaces, iface)
	}

	return interfaces, nil
}

func (pc *PFSenseCollector) Start(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	pc.CollectAll() // First run

	for range ticker.C {
		pc.CollectAll()
	}
}
