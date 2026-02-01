package container

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"strings"
	"time"

	"os"
	"os/exec"

	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"golang.org/x/crypto/ssh"
)

type NodeSummary struct {
	Node struct {
		NodeName string `json:"nodeName"`
		CPU      struct {
			UsageNanoCores       uint64 `json:"usageNanoCores"`
			UsageCoreNanoSeconds uint64 `json:"usageCoreNanoSeconds"`
		} `json:"cpu"`
		Memory struct {
			AvailableBytes  uint64 `json:"availableBytes"`
			UsageBytes      uint64 `json:"usageBytes"`
			WorkingSetBytes uint64 `json:"workingSetBytes"`
			RssBytes        uint64 `json:"rssBytes"`
			PageFaults      uint64 `json:"pageFaults"`
			MajorPageFaults uint64 `json:"majorPageFaults"`
		} `json:"memory"`
		Network struct {
			RxBytes    uint64 `json:"rxBytes"`
			TxBytes    uint64 `json:"txBytes"`
			Interfaces []struct {
				Name    string `json:"name"`
				RxBytes uint64 `json:"rxBytes"`
				TxBytes uint64 `json:"txBytes"`
			} `json:"interfaces"`
		} `json:"network"`
		Fs struct {
			CapacityBytes uint64 `json:"capacityBytes"`
			UsedBytes     uint64 `json:"usedBytes"`
		} `json:"fs"`
	} `json:"node"`
	Pods []struct {
		PodRef struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"podRef"`
		CPU struct {
			UsageNanoCores uint64 `json:"usageNanoCores"`
		} `json:"cpu"`
		Memory struct {
			UsageBytes      uint64 `json:"usageBytes"`
			WorkingSetBytes uint64 `json:"workingSetBytes"`
		} `json:"memory"`
		Network struct {
			RxBytes uint64 `json:"rxBytes"`
			TxBytes uint64 `json:"txBytes"`
		} `json:"network"`
	} `json:"pods"`
}

type NetStats struct {
	RxBytes   uint64
	TxBytes   uint64
	Timestamp time.Time
}

type KubernetesCollector struct {
	DB            *data_centralizegg.DB
	prevNetStats  map[string]NetStats
	prevDiskStats map[string]NetStats // Reusing NetStats struct for Read/Write
}

func NewKubernetesCollector(db *data_centralizegg.DB) *KubernetesCollector {
	return &KubernetesCollector{
		DB:            db,
		prevNetStats:  make(map[string]NetStats),
		prevDiskStats: make(map[string]NetStats),
	}
}

func (kc *KubernetesCollector) Start(interval time.Duration) {
	ticker := time.NewTicker(interval)
	// Run once immediately
	go kc.CollectAll()
	go func() {
		for range ticker.C {
			kc.CollectAll()
		}
	}()
}

func (kc *KubernetesCollector) CollectAll() {
	log.Printf("[KubernetesCollector] Starting collection cycle...")
	servers, err := kc.DB.GetGenericServers("kubernetes")
	if err != nil {
		log.Printf("[KubernetesCollector] Failed to get kubernetes servers: %v", err)
		return
	}

	if len(servers) == 0 {
		log.Printf("[KubernetesCollector] No kubernetes servers configured.")
		return
	}

	for _, s := range servers {
		log.Printf("[KubernetesCollector] Collecting from %s (%s)...", s.Name, s.IPAddress)
		metaMap := map[string]string{"ip": s.IPAddress, "name": s.Name}
		metaBytes, _ := json.Marshal(metaMap)
		metadata := string(metaBytes)

		if err := kc.collectOne(s); err != nil {
			log.Printf("[KubernetesCollector] Failed to collect from Kubernetes %s (%s): %v", s.Name, s.IPAddress, err)
			kc.DB.SetGenericServerStatus("kubernetes", s.ID, "offline", metadata)
			kc.DB.UpdateControlPlaneStatus("kubernetes", s.ID, "{}")
			kc.DB.ClearKubernetesNodesStatus(s.ID)
			continue
		}
		log.Printf("[KubernetesCollector] Successfully collected from %s.", s.Name)
		kc.DB.SetGenericServerStatus("kubernetes", s.ID, "online", metadata)
	}
}

func (kc *KubernetesCollector) collectOne(s data_centralizegg.GenericServer) error {
	var client *ssh.Client
	var err error
	isLocal := s.IPAddress == "" || s.Username == ""

	if !isLocal {
		client, err = kc.getSSHClient(s)
		if err != nil {
			return fmt.Errorf("ssh connection failed: %w", err)
		}
		defer client.Close()
	}

	kubeconfigPath := ""
	if s.KubeconfigContent != "" {
		if isLocal {
			// Write to local /tmp
			tmpFile, err := os.CreateTemp("", "kubeconfig-*.yaml")
			if err == nil {
				tmpFile.Write([]byte(s.KubeconfigContent))
				tmpFile.Close()
				kubeconfigPath = tmpFile.Name()
				defer os.Remove(kubeconfigPath)
			}
		} else {
			// Use a temporary file on the remote host
			remotePath := fmt.Sprintf("/tmp/centralize-kubeconfig-%d", s.ID)
			cmd := fmt.Sprintf("cat << 'EOF' > %s\n%s\nEOF", remotePath, s.KubeconfigContent)
			if _, err := kc.runCommand(client, cmd, ""); err != nil {
				log.Printf("[KubernetesCollector] Warning: Failed to write remote kubeconfig: %v", err)
			} else {
				kubeconfigPath = remotePath
				// Ensure cleanup
				defer kc.runCommand(client, fmt.Sprintf("rm -f %s", remotePath), "")
			}
		}
	}

	// 1. Get Nodes
	kubectlCmd := "kubectl"
	if kubeconfigPath != "" {
		if isLocal {
			kubectlCmd = fmt.Sprintf("kubectl --kubeconfig=%s", kubeconfigPath)
			log.Printf("[KubernetesCollector] Using local kubeconfig: %s", kubeconfigPath)
		} else {
			kubectlCmd = fmt.Sprintf("KUBECONFIG=%s kubectl", kubeconfigPath)
			log.Printf("[KubernetesCollector] Using remote kubeconfig: %s", kubeconfigPath)
		}
	} else {
		log.Printf("[KubernetesCollector] No kubeconfig provided, using system default")
	}

	var nodesJSON string
	if isLocal {
		log.Printf("[KubernetesCollector] Running local command: %s get nodes", kubectlCmd)
		nodesJSON, err = kc.runLocalCommand(kubectlCmd + " get nodes -o json")
	} else {
		log.Printf("[KubernetesCollector] Running remote command: %s get nodes", kubectlCmd)
		nodesJSON, err = kc.runCommand(client, kubectlCmd+" get nodes -o json", "")
	}
	if err != nil {
		return fmt.Errorf("kubectl get nodes (output: %s): %w", strings.TrimSpace(nodesJSON), err)
	}

	var nodeListView struct {
		Items []struct {
			Metadata struct {
				Name              string            `json:"name"`
				Labels            map[string]string `json:"labels"`
				CreationTimestamp string            `json:"creationTimestamp"`
			} `json:"metadata"`
			Status struct {
				Capacity struct {
					CPU    string `json:"cpu"`
					Memory string `json:"memory"`
				} `json:"capacity"`
				Allocatable struct {
					CPU    string `json:"cpu"`
					Memory string `json:"memory"`
				} `json:"allocatable"`
				Conditions []struct {
					Type   string `json:"type"`
					Status string `json:"status"`
				} `json:"conditions"`
				NodeInfo struct {
					KubeletVersion          string `json:"kubeletVersion"`
					OSImage                 string `json:"osImage"`
					KernelVersion           string `json:"kernelVersion"`
					Architecture            string `json:"architecture"`
					ContainerRuntimeVersion string `json:"containerRuntimeVersion"`
				} `json:"nodeInfo"`
				Addresses []struct {
					Type    string `json:"type"`
					Address string `json:"address"`
				} `json:"addresses"`
			} `json:"status"`
		} `json:"items"`
	}

	if err := json.Unmarshal([]byte(nodesJSON), &nodeListView); err != nil {
		return fmt.Errorf("parse nodes json: %w", err)
	}

	// Get Node Metrics if metrics-server is available
	var nodeMetricsRaw string
	if isLocal {
		nodeMetricsRaw, _ = kc.runLocalCommand(kubectlCmd + " top nodes --no-headers")
	} else {
		nodeMetricsRaw, _ = kc.runCommand(client, kubectlCmd+" top nodes --no-headers", "")
	}
	metricsMap := make(map[string]struct {
		CPUUsage float64
		MemUsage uint64
	})
	lines := strings.Split(strings.TrimSpace(nodeMetricsRaw), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			name := fields[0]
			cpuUsage := 0.0
			memUsage := uint64(0)

			// Dynamically find CPU and Memory fields by looking at suffixes
			for i := 1; i < len(fields); i++ {
				f := fields[i]
				if strings.HasSuffix(f, "m") || (f == "0") {
					// Likely CPU nanocores or millicores
					// Note: parseK8sQuantity handles 'm'
					if cpuUsage == 0 {
						cpuUsage = float64(kc.parseK8sQuantity(f))
					}
				} else if strings.Contains(f, "%") {
					// Some versions show percentage in 'top'
					if cpuUsage == 0 {
						fmt.Sscanf(strings.TrimSuffix(f, "%"), "%f", &cpuUsage)
					}
				} else if strings.HasSuffix(strings.ToLower(f), "i") || strings.HasSuffix(strings.ToLower(f), "b") {
					// Likely Memory (Ki, Mi, Gi or bytes)
					if memUsage == 0 {
						memUsage = kc.parseK8sQuantity(f)
					}
				}
			}

			// If we got millicores, we'll convert to percentage later in fallback if needed,
			// but here metricsMap expects what was previously 'cpuPercent'.
			// Wait, the previous logic used FIELDS[2] as cpuPercent.
			// Let's refine: metricsMap[name].CPUUsage should be percentage if possible.
			// If we can't find percentage, we'll rely on the Summary API fallback which is more accurate.

			// Re-parse fields[2] and fields[3] for compatibility if they fit
			compCPU := 0.0
			fmt.Sscanf(strings.TrimSuffix(fields[len(fields)-3], "%"), "%f", &compCPU)

			metricsMap[name] = struct {
				CPUUsage float64
				MemUsage uint64
			}{
				CPUUsage: compCPU, // We still use fields[len-3] if it looks like a number
				MemUsage: memUsage,
			}
		}
	}

	nodeIDMap := make(map[string]int64)
	allPodNetStats := make(map[string]NetStats)
	nodeStatsMap := make(map[string]map[string]interface{})
	cpCount := 0
	workerCount := 0

	for _, item := range nodeListView.Items {
		name := item.Metadata.Name
		status := "Unknown"
		for _, cond := range item.Status.Conditions {
			if cond.Type == "Ready" {
				if cond.Status == "True" {
					status = "Ready"
				} else {
					status = "NotReady"
				}
				break
			}
		}

		ip := ""
		for _, addr := range item.Status.Addresses {
			if addr.Type == "ExternalIP" {
				ip = addr.Address
				break
			}
			if addr.Type == "InternalIP" && ip == "" {
				ip = addr.Address
			}
		}

		cpuCores := 0
		fmt.Sscanf(item.Status.Capacity.CPU, "%d", &cpuCores)
		totalMem := kc.parseK8sQuantity(item.Status.Capacity.Memory)

		// Get stats from Summary API
		var summary NodeSummary
		summaryJSON := ""
		if isLocal {
			summaryJSON, _ = kc.runLocalCommand(fmt.Sprintf("%s get --raw /api/v1/nodes/%s/proxy/stats/summary", kubectlCmd, name))
		} else {
			summaryJSON, _ = kc.runCommand(client, fmt.Sprintf("%s get --raw /api/v1/nodes/%s/proxy/stats/summary", kubectlCmd, name), "")
		}

		diskTotal := uint64(0)
		diskUsed := uint64(0)
		netRX := uint64(0)
		netTX := uint64(0)

		if summaryJSON != "" {
			if err := json.Unmarshal([]byte(summaryJSON), &summary); err == nil {
				diskTotal = summary.Node.Fs.CapacityBytes
				diskUsed = summary.Node.Fs.UsedBytes
				netRX = summary.Node.Network.RxBytes
				netTX = summary.Node.Network.TxBytes

				// Robustness: If main network stats are 0, sum individual interfaces
				if netRX == 0 && len(summary.Node.Network.Interfaces) > 0 {
					for _, iface := range summary.Node.Network.Interfaces {
						if iface.Name != "lo" {
							netRX += iface.RxBytes
							netTX += iface.TxBytes
						}
					}
				}

				// Collect Pod Network Stats and aggregate for node fallback
				var aggRx, aggTx uint64
				for _, p := range summary.Pods {
					k := p.PodRef.Namespace + "/" + p.PodRef.Name
					allPodNetStats[k] = NetStats{
						RxBytes: p.Network.RxBytes,
						TxBytes: p.Network.TxBytes,
					}
					aggRx += p.Network.RxBytes
					aggTx += p.Network.TxBytes
				}

				// If node stats are still 0 (common in some CNI/Kernel configs), use aggregated pod stats
				if netRX == 0 {
					netRX = aggRx
				}
				if netTX == 0 {
					netTX = aggTx
				}

				// Fallback for CPU/Mem metrics if metrics-server is missing or failing
				nodeName := item.Metadata.Name
				if _, exists := metricsMap[nodeName]; !exists || metricsMap[nodeName].CPUUsage == 0 {
					// Use Summary API data: WorkingSetBytes for RAM, and derive CPU usage if possible
					// For CPU, Summary API gives nanocores. We need to convert to percentage.
					cpuUsagePercent := 0.0
					if cpuCores > 0 {
						cpuUsagePercent = (float64(summary.Node.CPU.UsageNanoCores) / 1000000000.0) / float64(cpuCores) * 100.0
					}

					metricsMap[nodeName] = struct {
						CPUUsage float64
						MemUsage uint64
					}{
						CPUUsage: cpuUsagePercent,
						MemUsage: summary.Node.Memory.WorkingSetBytes,
					}
				}
			}
		}

		// Calculate Network Rate
		rxRate := uint64(0)
		txRate := uint64(0)
		now := time.Now()

		if prev, ok := kc.prevNetStats[name]; ok {
			duration := now.Sub(prev.Timestamp).Seconds()
			if duration > 0 {
				if netRX >= prev.RxBytes {
					rxRate = uint64(float64(netRX-prev.RxBytes) / duration)
				}
				if netTX >= prev.TxBytes {
					txRate = uint64(float64(netTX-prev.TxBytes) / duration)
				}
			}
		}
		kc.prevNetStats[name] = NetStats{
			RxBytes:   netRX,
			TxBytes:   netTX,
			Timestamp: now,
		}

		m := metricsMap[name]

		// Store in nodeStatsMap for historical record
		nodeStatsMap[name] = map[string]interface{}{
			"cpu_usage":  m.CPUUsage,
			"mem_usage":  summary.Node.Memory.WorkingSetBytes,
			"mem_total":  totalMem,
			"net_rx":     rxRate,
			"net_tx":     txRate,
			"disk_used":  diskUsed,
			"disk_total": diskTotal,
		}

		// Active Connections Collection
		activeConnsJSON := "[]" // Placeholder for now, as direct kubectl top doesn't provide this easily.

		nodeID, err := kc.DB.UpsertKubernetesNode(data_centralizegg.KubernetesNode{
			ServerID:          s.ID,
			Hostname:          name,
			IPAddress:         ip,
			Status:            status,
			Version:           item.Status.NodeInfo.KubeletVersion,
			OSName:            item.Status.NodeInfo.OSImage,
			KernelVer:         item.Status.NodeInfo.KernelVersion,
			Architecture:      item.Status.NodeInfo.Architecture,
			ContainerRuntime:  item.Status.NodeInfo.ContainerRuntimeVersion,
			CPUCores:          cpuCores,
			TotalMemory:       totalMem,
			CPUUsage:          m.CPUUsage,
			FreeMemory:        totalMem - m.MemUsage,
			DiskTotal:         diskTotal,
			DiskUsed:          diskUsed,
			NetRX:             netRX,
			NetTX:             netTX,
			NetRXRate:         rxRate,
			NetTXRate:         txRate,
			ActiveConnections: activeConnsJSON,
		})
		if err != nil {
			log.Printf("[KubernetesCollector] Failed to upsert node %s: %v", name, err)
			continue
		}
		nodeIDMap[name] = nodeID

		// Count roles
		isCP := false
		for k := range item.Metadata.Labels {
			if k == "node-role.kubernetes.io/control-plane" || k == "node-role.kubernetes.io/master" {
				isCP = true
				break
			}
		}
		if isCP {
			cpCount++
		} else {
			workerCount++
		}
	}

	// 2. Get Pods
	var podsJSON string
	if isLocal {
		log.Printf("[KubernetesCollector] Running local command: %s get pods -A", kubectlCmd)
		podsJSON, err = kc.runLocalCommand(kubectlCmd + " get pods -A -o json")
	} else {
		log.Printf("[KubernetesCollector] Running remote command: %s get pods -A", kubectlCmd)
		podsJSON, err = kc.runCommand(client, kubectlCmd+" get pods -A -o json", "")
	}
	if err != nil {
		log.Printf("[KubernetesCollector] Failed to get pods (output: %s): %v", strings.TrimSpace(podsJSON), err)
	} else {
		var podListView struct {
			Items []struct {
				Metadata struct {
					Name      string `json:"name"`
					Namespace string `json:"namespace"`
				} `json:"metadata"`
				Spec struct {
					NodeName   string `json:"nodeName"`
					Containers []struct {
						Image string `json:"image"`
						Ports []struct {
							ContainerPort int `json:"containerPort"`
						} `json:"ports"`
					} `json:"containers"`
				} `json:"spec"`
				Status struct {
					Phase             string `json:"phase"`
					PodIP             string `json:"podIP"`
					ContainerStatuses []struct {
						RestartCount int                    `json:"restartCount"`
						State        map[string]interface{} `json:"state"`
					} `json:"containerStatuses"`
					StartTime string `json:"startTime"`
				} `json:"status"`
			} `json:"items"`
		}

		if err := json.Unmarshal([]byte(podsJSON), &podListView); err == nil {
			// Get Pod Metrics
			var podMetricsRaw string
			if isLocal {
				podMetricsRaw, _ = kc.runLocalCommand(kubectlCmd + " top pods -A --no-headers")
			} else {
				podMetricsRaw, _ = kc.runCommand(client, kubectlCmd+" top pods -A --no-headers", "")
			}
			podMetricsMap := make(map[string]struct {
				CPU float64
				Mem uint64
			})
			pLines := strings.Split(strings.TrimSpace(podMetricsRaw), "\n")
			for _, pLine := range pLines {
				pFields := strings.Fields(pLine)
				if len(pFields) >= 4 {
					key := pFields[0] + "/" + pFields[1] // namespace/name
					// kubectl top pods shows CPU in cores (e.g. 5m), we'll try to parse it
					// but for now let's just keep it simple or zero if complex
					podMetricsMap[key] = struct {
						CPU float64
						Mem uint64
					}{CPU: 0, Mem: kc.parseK8sQuantity(pFields[3])}
				}
			}

			nodePodsCount := make(map[string]int)
			var activePodKeys []string

			for _, item := range podListView.Items {
				nodeID, ok := nodeIDMap[item.Spec.NodeName]
				if !ok {
					continue
				}
				nodePodsCount[item.Spec.NodeName]++

				restarts := 0
				state := "unknown"
				for _, cs := range item.Status.ContainerStatuses {
					restarts += cs.RestartCount
					for k := range cs.State {
						state = k
					}
				}

				key := item.Metadata.Namespace + "/" + item.Metadata.Name
				activePodKeys = append(activePodKeys, key)

				m, ok := podMetricsMap[key]
				// If not found in metrics map (maybe different namespace/name format?), try to approximate or leave 0
				// kubectl top pods -A output usually is Namespace Name ...

				age := ""
				if item.Status.StartTime != "" {
					if t, err := time.Parse(time.RFC3339, item.Status.StartTime); err == nil {
						age = time.Since(t).Round(time.Second).String()
					}
				}

				// Extract Image and Ports
				image := ""
				ports := []string{}
				if len(item.Spec.Containers) > 0 {
					image = item.Spec.Containers[0].Image
					for _, c := range item.Spec.Containers {
						for _, p := range c.Ports {
							ports = append(ports, fmt.Sprintf("%d", p.ContainerPort))
						}
					}
				}
				portsStr := strings.Join(ports, ", ")

				// lookup network stats
				ns := allPodNetStats[key]

				p := data_centralizegg.KubernetesPod{
					NodeID:    nodeID,
					Name:      item.Metadata.Name,
					Namespace: item.Metadata.Namespace,
					State:     item.Status.Phase,
					Status:    state,
					IPAddress: item.Status.PodIP,
					Restarts:  restarts,
					Age:       age,
					CPUUsage:  m.CPU,
					MemUsage:  m.Mem,
					Image:     image,
					Ports:     portsStr,
					NetRX:     ns.RxBytes,
					NetTX:     ns.TxBytes,
				}

				if err := kc.DB.UpsertKubernetesPod(p); err != nil {
					log.Printf("[KubernetesCollector] Failed to upsert pod %s: %v", p.Name, err)
				}
			}

			// Clean up stale pods
			if err := kc.DB.DeleteStaleKubernetesPods(s.ID, activePodKeys); err != nil {
				log.Printf("[KubernetesCollector] Failed to delete stale pods: %v", err)
			}

			// Update nodes with pod count
			for nodeName, count := range nodePodsCount {
				if nodeID, ok := nodeIDMap[nodeName]; ok {
					kc.DB.Conn.Exec("UPDATE kubernetes.nodes SET pods_count = $1 WHERE id = $2", count, nodeID)
				}
			}
		}
	}

	// 3. Get Persistent Volumes (PVs)
	var clusterTotalStorage uint64
	var clusterUsedStorage uint64
	var pvsJSON string
	if isLocal {
		pvsJSON, err = kc.runLocalCommand(kubectlCmd + " get pv -o json")
	} else {
		pvsJSON, err = kc.runCommand(client, kubectlCmd+" get pv -o json", "")
	}

	if err == nil {
		var pvListView struct {
			Items []struct {
				Metadata struct {
					Name string `json:"name"`
				} `json:"metadata"`
				Spec struct {
					Capacity struct {
						Storage string `json:"storage"`
					} `json:"capacity"`
					ClaimRef struct {
						Name      string `json:"name"`
						Namespace string `json:"namespace"`
					} `json:"claimRef"`
					StorageClassName string `json:"storageClassName"`
				} `json:"spec"`
				Status struct {
					Phase string `json:"phase"`
				} `json:"status"`
			} `json:"items"`
		}

		if err := json.Unmarshal([]byte(pvsJSON), &pvListView); err == nil {
			for _, item := range pvListView.Items {
				capBytes := kc.parseK8sQuantity(item.Spec.Capacity.Storage)
				clusterTotalStorage += capBytes
				// For usage, K8s doesn't give "used" bytes easily for PVs without additional tools
				// We'll treat Bound as "used" for the aggregate bar or similar if needed
				// but for now let's just show capacity.
				// Actually, many providers show used space. Let's assume Bound means the space is reserved/allocated.
				if item.Status.Phase == "Bound" {
					clusterUsedStorage += capBytes
				}

				pv := data_centralizegg.KubernetesPV{
					ServerID:     s.ID,
					Name:         item.Metadata.Name,
					Capacity:     capBytes,
					Status:       item.Status.Phase,
					PVCName:      item.Spec.ClaimRef.Name,
					PVCNamespace: item.Spec.ClaimRef.Namespace,
					StorageClass: item.Spec.StorageClassName,
				}
				kc.DB.UpsertKubernetesPV(pv)
			}
		}
	}

	// 4. Aggregate cluster stats and update server record
	var totalCPUUsage float64
	var clusterTotalMemory uint64
	var clusterFreeMemory uint64
	var totalCores int
	var totalNetRX, totalNetTX uint64
	nodeCount := len(nodeListView.Items)

	var dominantArch string
	archMap := make(map[string]int)
	var dominantOS string
	osMap := make(map[string]int)
	var clusterStartTime time.Time

	for _, item := range nodeListView.Items {
		name := item.Metadata.Name
		m := metricsMap[name]
		totalCPUUsage += m.CPUUsage
		clusterTotalMemory += kc.parseK8sQuantity(item.Status.Capacity.Memory)
		clusterFreeMemory += (kc.parseK8sQuantity(item.Status.Capacity.Memory) - m.MemUsage)

		arch := item.Status.NodeInfo.Architecture
		if arch != "" {
			archMap[arch]++
		}

		osName := item.Status.NodeInfo.OSImage
		if osName != "" {
			osMap[osName]++
		}

		if item.Metadata.CreationTimestamp != "" {
			if t, err := time.Parse(time.RFC3339, item.Metadata.CreationTimestamp); err == nil {
				if clusterStartTime.IsZero() || t.Before(clusterStartTime) {
					clusterStartTime = t
				}
			}
		}

		if stats, ok := kc.prevNetStats[name]; ok {
			totalNetRX += stats.RxBytes
			totalNetTX += stats.TxBytes
		}

		cpuStr := item.Status.Capacity.CPU
		if strings.HasSuffix(cpuStr, "m") {
			coresVal := kc.parseK8sQuantity(cpuStr)
			totalCores += int(coresVal / 1000)
		} else {
			totalCores += int(kc.parseK8sQuantity(cpuStr))
		}
	}

	// Determine dominant architecture
	maxArchCount := 0
	for arch, count := range archMap {
		if count > maxArchCount {
			maxArchCount = count
			dominantArch = arch
		}
	}
	if dominantArch == "" {
		dominantArch = "N/A"
	}

	// Determine dominant OS
	maxOSCount := 0
	for os, count := range osMap {
		if count > maxOSCount {
			maxOSCount = count
			dominantOS = os
		}
	}
	if dominantOS == "" {
		dominantOS = "Kubernetes Cluster"
	}

	clusterUptime := "N/A"
	if !clusterStartTime.IsZero() {
		d := time.Since(clusterStartTime).Round(time.Hour)
		days := int(d.Hours() / 24)
		if days > 0 {
			clusterUptime = fmt.Sprintf("%dd %dh", days, int(d.Hours())%24)
		} else {
			clusterUptime = fmt.Sprintf("%dh", int(d.Hours()))
		}
	}

	avgCPUUsage := 0.0
	if nodeCount > 0 {
		avgCPUUsage = totalCPUUsage / float64(nodeCount)
	}

	err = kc.DB.UpdateGenericServerStats("kubernetes", s.ID, avgCPUUsage, totalCores, clusterTotalMemory, clusterFreeMemory, clusterUsedStorage, clusterTotalStorage, dominantOS, dominantArch, clusterUptime)
	if err != nil {
		log.Printf("[KubernetesCollector] Failed to update cluster stats: %v", err)
	}

	// Insert Historical Metrics
	metric := data_centralizegg.ServerMetric{
		ServerID:    s.ID,
		Category:    "kubernetes",
		Timestamp:   time.Now(),
		CPUUsage:    avgCPUUsage,
		MemoryUsage: clusterTotalMemory - clusterFreeMemory,
		NetRX:       totalNetRX,
		NetTX:       totalNetTX,
	}

	if nodesData, err := json.Marshal(nodeStatsMap); err == nil {
		metric.NodesData = string(nodesData)
	}

	if err := kc.DB.InsertServerMetrics(metric); err != nil {
		// log.Printf("[KubernetesCollector] Failed to insert metrics: %v", err)
	}

	// 5. Check Certificate Expiration
	kc.checkCertExpiration(s)

	// Check and Log Resource Alerts
	kc.checkAndLogAlerts(s, avgCPUUsage, clusterTotalMemory, clusterFreeMemory)

	// 6. Collect Control Plane Status (from kube-system pods, since ComponentStatus API was removed)
	var cpPodsJSON string
	if isLocal {
		cpPodsJSON, _ = kc.runLocalCommand(kubectlCmd + " get pods -n kube-system -o json")
	} else {
		cpPodsJSON, _ = kc.runCommand(client, kubectlCmd+" get pods -n kube-system -o json", "")
	}

	if cpPodsJSON != "" {
		var podList struct {
			Items []struct {
				Metadata struct {
					Name string `json:"name"`
				} `json:"metadata"`
				Status struct {
					Phase      string `json:"phase"`
					Conditions []struct {
						Type   string `json:"type"`
						Status string `json:"status"`
					} `json:"conditions"`
				} `json:"status"`
			} `json:"items"`
		}
		if err := json.Unmarshal([]byte(cpPodsJSON), &podList); err == nil {
			statusMap := make(map[string]string)

			for _, pod := range podList.Items {
				// Check for control plane components
				if strings.Contains(pod.Metadata.Name, "etcd") {
					statusMap["etcd"] = getPodHealth(pod.Status.Phase, pod.Status.Conditions)
				} else if strings.Contains(pod.Metadata.Name, "kube-scheduler") {
					statusMap["scheduler"] = getPodHealth(pod.Status.Phase, pod.Status.Conditions)
				} else if strings.Contains(pod.Metadata.Name, "kube-controller-manager") {
					statusMap["controller-manager"] = getPodHealth(pod.Status.Phase, pod.Status.Conditions)
				}
			}

			// Add kube-apiserver status (assumed Healthy if we are here)
			statusMap["kube-apiserver"] = "Healthy"

			// For Talos or other systems where control plane pods aren't visible,
			// assume components are healthy if we successfully connected
			if len(statusMap) <= 1 { // Only kube-apiserver
				statusMap["etcd"] = "Healthy"
				statusMap["scheduler"] = "Healthy"
				statusMap["controller-manager"] = "Healthy"
			}

			finalJSON, _ := json.Marshal(statusMap)
			kc.DB.UpdateControlPlaneStatus("kubernetes", s.ID, string(finalJSON))
		}
	}

	// 6. Collect Kubernetes Events
	var eventsJSON string
	if isLocal {
		eventsJSON, _ = kc.runLocalCommand(kubectlCmd + " get events --all-namespaces -o json")
	} else {
		eventsJSON, _ = kc.runCommand(client, kubectlCmd+" get events --all-namespaces -o json", "")
	}

	if eventsJSON != "" {
		var eventList struct {
			Items []struct {
				Type           string `json:"type"`
				Reason         string `json:"reason"`
				Message        string `json:"message"`
				InvolvedObject struct {
					Kind      string `json:"kind"`
					Name      string `json:"name"`
					Namespace string `json:"namespace"`
				} `json:"involvedObject"`
				Count          int    `json:"count"`
				FirstTimestamp string `json:"firstTimestamp"`
				LastTimestamp  string `json:"lastTimestamp"`
			} `json:"items"`
		}
		if err := json.Unmarshal([]byte(eventsJSON), &eventList); err == nil {
			for _, item := range eventList.Items {
				firstSeen, _ := time.Parse(time.RFC3339, item.FirstTimestamp)
				lastSeen, _ := time.Parse(time.RFC3339, item.LastTimestamp)

				event := data_centralizegg.KubernetesEvent{
					ServerID:   s.ID,
					Type:       item.Type,
					Reason:     item.Reason,
					Message:    item.Message,
					ObjectKind: item.InvolvedObject.Kind,
					ObjectName: item.InvolvedObject.Name,
					Namespace:  item.InvolvedObject.Namespace,
					Count:      item.Count,
					FirstSeen:  firstSeen,
					LastSeen:   lastSeen,
				}
				kc.DB.UpsertKubernetesEvent(event)
			}
		}
	}

	// 7. Count Kubernetes Resources
	resourceCounts := map[string]int{
		"namespaces":             0,
		"deployments":            0,
		"daemonsets":             0,
		"replicasets":            0,
		"replicationcontrollers": 0,
		"jobs":                   0,

		"cronjobs":      0,
		"workers":       workerCount,
		"control_plane": cpCount,
	}

	// Count each resource type
	resources := []struct {
		name    string
		command string
	}{
		{"namespaces", "get namespaces -o json"},
		{"deployments", "get deployments --all-namespaces -o json"},
		{"daemonsets", "get daemonsets --all-namespaces -o json"},
		{"replicasets", "get replicasets --all-namespaces -o json"},
		{"replicationcontrollers", "get replicationcontrollers --all-namespaces -o json"},
		{"jobs", "get jobs --all-namespaces -o json"},
		{"cronjobs", "get cronjobs --all-namespaces -o json"},
		{"ingresses", "get ingress -A -o json"},
		{"configmaps", "get configmaps -A -o json"},
		{"secrets", "get secrets -A -o json"},
	}

	for _, res := range resources {
		var output string
		if isLocal {
			output, _ = kc.runLocalCommand(kubectlCmd + " " + res.command)
		} else {
			output, _ = kc.runCommand(client, kubectlCmd+" "+res.command, "")
		}

		if output != "" {
			var result struct {
				Items []interface{} `json:"items"`
			}
			if err := json.Unmarshal([]byte(output), &result); err == nil {
				resourceCounts[res.name] = len(result.Items)
			}
		}
	}

	// Store resource counts
	countsJSON, _ := json.Marshal(resourceCounts)
	kc.DB.UpdateResourceCounts("kubernetes", s.ID, string(countsJSON))

	// 8. Collect Network Topology (Services and Endpoints)
	var svcJSON string
	var epJSON string
	var ingJSON string
	if isLocal {
		svcJSON, _ = kc.runLocalCommand(kubectlCmd + " get svc -A -o json")
		epJSON, _ = kc.runLocalCommand(kubectlCmd + " get endpoints -A -o json")
		ingJSON, _ = kc.runLocalCommand(kubectlCmd + " get ingress -A -o json")
	} else {
		svcJSON, _ = kc.runCommand(client, kubectlCmd+" get svc -A -o json", "")
		epJSON, _ = kc.runCommand(client, kubectlCmd+" get endpoints -A -o json", "")
		ingJSON, _ = kc.runCommand(client, kubectlCmd+" get ingress -A -o json", "")
	}

	if svcJSON != "" && epJSON != "" {
		var svcList struct {
			Items []struct {
				Metadata struct {
					Name      string `json:"name"`
					Namespace string `json:"namespace"`
				} `json:"metadata"`
				Spec struct {
					Type      string `json:"type"`
					ClusterIP string `json:"clusterIP"`
					Ports     []struct {
						Port     int `json:"port"`
						NodePort int `json:"nodePort"`
					} `json:"ports"`
					ExternalIPs []string `json:"externalIPs"`
				} `json:"spec"`
				Status struct {
					LoadBalancer struct {
						Ingress []struct {
							IP       string `json:"ip"`
							Hostname string `json:"hostname"`
						} `json:"ingress"`
					} `json:"loadBalancer"`
				} `json:"status"`
			} `json:"items"`
		}
		var epList struct {
			Items []struct {
				Metadata struct {
					Name      string `json:"name"`
					Namespace string `json:"namespace"`
				} `json:"metadata"`
				Subsets []struct {
					Addresses []struct {
						IP string `json:"ip"`
					} `json:"addresses"`
				} `json:"subsets"`
			} `json:"items"`
		}

		if err1 := json.Unmarshal([]byte(svcJSON), &svcList); err1 == nil {
			if err2 := json.Unmarshal([]byte(epJSON), &epList); err2 == nil {
				// Build Topology
				type MapNode struct {
					ID        string `json:"id"`
					Name      string `json:"name"`
					Type      string `json:"type"`
					Namespace string `json:"namespace"`
					IP        string `json:"ip"`
					Color     string `json:"color"`
				}
				type MapLink struct {
					Source string `json:"source"`
					Target string `json:"target"`
					Type   string `json:"type"`
				}
				var nodes []MapNode
				var links []MapLink

				// 1. Internet Node
				nodes = append(nodes, MapNode{ID: "internet", Name: "Internet", Type: "internet", Color: "#ff4d4d"})

				for _, svc := range svcList.Items {
					svcID := "svc-" + svc.Metadata.Namespace + "-" + svc.Metadata.Name
					svcIP := svc.Spec.ClusterIP
					if svc.Spec.Type == "LoadBalancer" && len(svc.Status.LoadBalancer.Ingress) > 0 {
						svcIP = svc.Status.LoadBalancer.Ingress[0].IP
						if svcIP == "" {
							svcIP = svc.Status.LoadBalancer.Ingress[0].Hostname
						}
					} else if svc.Spec.Type == "NodePort" {
						// For NodePort, append the port
						ports := []string{}
						for _, p := range svc.Spec.Ports {
							if p.NodePort > 0 {
								ports = append(ports, fmt.Sprintf("%d", p.NodePort))
							}
						}
						if len(ports) > 0 {
							svcIP = fmt.Sprintf("NodePort: %s", strings.Join(ports, ","))
						}
					}

					nodes = append(nodes, MapNode{
						ID:        svcID,
						Name:      svc.Metadata.Name,
						Type:      "service",
						Namespace: svc.Metadata.Namespace,
						IP:        svcIP,
						Color:     "#a855f7", // Purple for Services
					})

					// Connect to internet if exposed
					if svc.Spec.Type == "LoadBalancer" || svc.Spec.Type == "NodePort" {
						links = append(links, MapLink{Source: "internet", Target: svcID, Type: "external"})
					}

					// Find endpoints for this service
					for _, ep := range epList.Items {
						if ep.Metadata.Name == svc.Metadata.Name && ep.Metadata.Namespace == svc.Metadata.Namespace {
							for _, sub := range ep.Subsets {
								for _, addr := range sub.Addresses {
									podID := "pod-" + svc.Metadata.Namespace + "-" + addr.IP
									links = append(links, MapLink{Source: svcID, Target: podID, Type: "internal"})
								}
							}
						}
					}
				}

				// 3. Process Ingresses
				if ingJSON != "" {
					var ingList struct {
						Items []struct {
							Metadata struct {
								Name      string `json:"name"`
								Namespace string `json:"namespace"`
							} `json:"metadata"`
							Spec struct {
								Rules []struct {
									Host string `json:"host"`
									HTTP struct {
										Paths []struct {
											Path    string `json:"path"`
											Backend struct {
												Service struct {
													Name string `json:"name"`
													Port struct {
														Number int `json:"number"`
													} `json:"port"`
												} `json:"service"`
											} `json:"backend"`
										} `json:"paths"`
									} `json:"http"`
								} `json:"rules"`
							} `json:"spec"`
						} `json:"items"`
					}
					if err := json.Unmarshal([]byte(ingJSON), &ingList); err == nil {
						for _, ing := range ingList.Items {
							ingID := "ing-" + ing.Metadata.Namespace + "-" + ing.Metadata.Name
							nodes = append(nodes, MapNode{
								ID:        ingID,
								Name:      ing.Metadata.Name,
								Type:      "ingress",
								Namespace: ing.Metadata.Namespace,
								IP:        "",        // Ingress usually points to hosts
								Color:     "#f97316", // Orange for Ingress
							})
							links = append(links, MapLink{Source: "internet", Target: ingID, Type: "external"})

							for _, rule := range ing.Spec.Rules {
								for _, path := range rule.HTTP.Paths {
									svcID := "svc-" + ing.Metadata.Namespace + "-" + path.Backend.Service.Name
									links = append(links, MapLink{Source: ingID, Target: svcID, Type: "route"})
								}
							}
						}
					}
				}

				// Add pods that are targets of links
				podAdded := make(map[string]bool)
				for _, l := range links {
					if strings.HasPrefix(l.Target, "pod-") && !podAdded[l.Target] {
						ip := strings.Replace(l.Target, "pod-", "", 1)
						parts := strings.SplitN(ip, "-", 2)
						namespace := ""
						actualIP := ip
						if len(parts) == 2 {
							namespace = parts[0]
							actualIP = parts[1]
						}

						nodes = append(nodes, MapNode{
							ID:        l.Target,
							Name:      "Pod", // Will be refined in app.js or here if we match pod ListView
							Type:      "pod",
							Namespace: namespace,
							IP:        actualIP,
							Color:     "#4ade80",
						})
						podAdded[l.Target] = true
					}
				}

				topology := map[string]interface{}{
					"nodes": nodes,
					"links": links,
				}
				topoJSON, _ := json.Marshal(topology)
				kc.DB.UpdateNetworkTopology("kubernetes", s.ID, string(topoJSON))
			}
		}
	}

	return nil
}

// Helper function to determine pod health
func getPodHealth(phase string, conditions []struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}) string {
	if phase != "Running" {
		return "Unhealthy"
	}
	for _, cond := range conditions {
		if cond.Type == "Ready" && cond.Status == "True" {
			return "Healthy"
		}
	}
	return "Unhealthy"
}

func (kc *KubernetesCollector) getSSHClient(s data_centralizegg.GenericServer) (*ssh.Client, error) {
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
		Timeout:         15 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", s.IPAddress, s.SSHPort)
	if s.SSHPort == 0 {
		addr = fmt.Sprintf("%s:22", s.IPAddress)
	}
	return ssh.Dial("tcp", addr, config)
}

func (kc *KubernetesCollector) runLocalCommand(cmd string) (string, error) {
	// Simple wrapper for local execution
	out, err := exec.Command("sh", "-c", cmd).CombinedOutput()
	return string(out), err
}

func (kc *KubernetesCollector) runCommand(client *ssh.Client, cmd string, kubeconfig string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	if kubeconfig != "" && strings.Contains(cmd, "kubectl") && !strings.Contains(cmd, "KUBECONFIG=") {
		cmd = fmt.Sprintf("KUBECONFIG=%s %s", kubeconfig, cmd)
	}

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

func (kc *KubernetesCollector) parseK8sQuantity(s string) uint64 {
	// Simple parser for K8s quantities (e.g. 8Gi, 512Mi, 40000ki, 500m, 100n)
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}

	var val float64
	var unit string

	// Extract numerical part and unit part correctly
	// Find where digits end
	idx := 0
	for idx < len(s) && ((s[idx] >= '0' && s[idx] <= '9') || s[idx] == '.') {
		idx++
	}
	fmt.Sscanf(s[:idx], "%f", &val)
	unit = strings.ToLower(strings.TrimSpace(s[idx:]))

	switch unit {
	case "ki":
		return uint64(val * 1024)
	case "mi":
		return uint64(val * 1024 * 1024)
	case "gi":
		return uint64(val * 1024 * 1024 * 1024)
	case "ti":
		return uint64(val * 1024 * 1024 * 1024 * 1024)
	case "m":
		// Millicores (1/1000)
		return uint64(val)
	case "n":
		// Nanocores (1/1,000,000,000) - used in some top pods/nodes outputs
		// For our display purposes, if it's less than 1 millicore, we can treat it as very small
		return uint64(val / 1000000)
	case "k":
		return uint64(val * 1000)
	case "m_decimal": // avoid shadowing unit 'm'
		return uint64(val * 1000 * 1000)
	case "g":
		return uint64(val * 1000 * 1000 * 1000)
	}

	return uint64(val)
}

func (kc *KubernetesCollector) checkCertExpiration(s data_centralizegg.GenericServer) {
	serverURL := kc.extractServerURL(s.KubeconfigContent)
	if serverURL == "" {
		return
	}

	// Remove protocol
	serverURL = strings.Replace(serverURL, "https://", "", 1)
	serverURL = strings.Replace(serverURL, "http://", "", 1)

	// Set timeout
	conn, err := tls.Dial("tcp", serverURL, &tls.Config{InsecureSkipVerify: true})
	if err != nil {
		log.Printf("[KubernetesCollector] Failed to check cert for %s: %v", serverURL, err)
		return
	}
	defer conn.Close()

	if len(conn.ConnectionState().PeerCertificates) > 0 {
		cert := conn.ConnectionState().PeerCertificates[0]
		kc.DB.UpdateKubernetesCertExpiration(s.ID, cert.NotAfter)
	}
}

func (kc *KubernetesCollector) extractServerURL(kubeconfig string) string {
	lines := strings.Split(kubeconfig, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "server:") {
			parts := strings.Fields(trimmed)
			if len(parts) >= 2 {
				return parts[1]
			}
		}
	}
	return ""
}

func (kc *KubernetesCollector) checkAndLogAlerts(s data_centralizegg.GenericServer, cpuUsage float64, totalMem, freeMem uint64) {
	// CPU Alert
	if cpuUsage > 90 {
		kc.DB.LogEvent(data_centralizegg.InfrastructureHistoryEvent{
			Category:  "kubernetes",
			Source:    "kubernetes.kubernetes_servers",
			EventType: "resource_alert",
			Severity:  "warning",
			Message:   fmt.Sprintf("High CPU Usage on Cluster %s: %.2f%%", s.Name, cpuUsage),
			Metadata:  fmt.Sprintf(`{"cpu_usage": %.2f}`, cpuUsage),
		})
	}

	// Memory Alert
	if totalMem > 0 {
		usedMem := totalMem - freeMem
		memUsage := (float64(usedMem) / float64(totalMem)) * 100
		if memUsage > 90 {
			kc.DB.LogEvent(data_centralizegg.InfrastructureHistoryEvent{
				Category:  "kubernetes",
				Source:    "kubernetes.kubernetes_servers",
				EventType: "resource_alert",
				Severity:  "warning",
				Message:   fmt.Sprintf("High Memory Usage on Cluster %s: %.2f%%", s.Name, memUsage),
				Metadata:  fmt.Sprintf(`{"memory_usage": %.2f}`, memUsage),
			})
		}
	}
}

func (kc *KubernetesCollector) GetPodLogs(serverID int64, namespace string, podName string) (string, error) {
	servers, err := kc.DB.GetGenericServers("kubernetes")
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

	var client *ssh.Client
	isLocal := targetServer.IPAddress == "" || targetServer.Username == ""

	if !isLocal {
		client, err = kc.getSSHClient(targetServer)
		if err != nil {
			return "", fmt.Errorf("ssh connection failed: %w", err)
		}
		defer client.Close()
	}

	// Determine kubeconfig
	kubeconfigPath := ""
	if targetServer.KubeconfigContent != "" {
		if isLocal {
			tmpFile, err := ioutil.TempFile("", "kubeconfig-*.yaml")
			if err == nil {
				tmpFile.Write([]byte(targetServer.KubeconfigContent))
				tmpFile.Close()
				kubeconfigPath = tmpFile.Name()
				defer os.Remove(kubeconfigPath)
			}
		} else {
			remotePath := fmt.Sprintf("/tmp/centralize-kubeconfig-%d-logs", targetServer.ID)
			cmd := fmt.Sprintf("cat << 'EOF' > %s\n%s\nEOF", remotePath, targetServer.KubeconfigContent)
			if _, err := kc.runCommand(client, cmd, ""); err == nil {
				kubeconfigPath = remotePath
				defer kc.runCommand(client, fmt.Sprintf("rm -f %s", remotePath), "")
			}
		}
	}

	kubectlCmd := "kubectl"
	if kubeconfigPath != "" {
		if isLocal {
			kubectlCmd = fmt.Sprintf("kubectl --kubeconfig=%s", kubeconfigPath)
		} else {
			kubectlCmd = fmt.Sprintf("KUBECONFIG=%s kubectl", kubeconfigPath)
		}
	}

	// Execute logs command
	cmd := fmt.Sprintf("%s logs -n %s %s --tail=100", kubectlCmd, namespace, podName)
	var output string
	if isLocal {
		output, err = kc.runLocalCommand(cmd)
	} else {
		output, err = kc.runCommand(client, cmd, "")
	}

	if err != nil {
		return "", fmt.Errorf("failed to get logs: %v (output: %s)", err, output)
	}

	return output, nil
}
func (kc *KubernetesCollector) GetHostLogs(id int64) (string, error) {
	servers, err := kc.DB.GetGenericServers("kubernetes")
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

	client, err := kc.getSSHClient(s)
	if err != nil {
		return "", err
	}
	defer client.Close()

	return kc.runCommand(client, "journalctl -n 50 --no-pager", "")
}
