package container

import (
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

type KubernetesCollector struct {
	DB *data_centralizegg.DB
}

func NewKubernetesCollector(db *data_centralizegg.DB) *KubernetesCollector {
	return &KubernetesCollector{
		DB: db,
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
		if err := kc.collectOne(s); err != nil {
			log.Printf("[KubernetesCollector] Failed to collect from Kubernetes %s (%s): %v", s.Name, s.IPAddress, err)
			kc.DB.SetGenericServerStatus("kubernetes", s.ID, "offline")
			continue
		}
		log.Printf("[KubernetesCollector] Successfully collected from %s.", s.Name)
		kc.DB.SetGenericServerStatus("kubernetes", s.ID, "online")
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
				Name string `json:"name"`
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
		if len(fields) >= 3 {
			name := fields[0]
			cpuPercent := 0.0
			fmt.Sscanf(strings.TrimSuffix(fields[2], "%"), "%f", &cpuPercent)
			memBytes := kc.parseK8sQuantity(fields[3])
			metricsMap[name] = struct {
				CPUUsage float64
				MemUsage uint64
			}{CPUUsage: cpuPercent, MemUsage: memBytes}
		}
	}

	nodeIDMap := make(map[string]int64)

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
			if addr.Type == "InternalIP" {
				ip = addr.Address
				break
			}
		}

		cpuCores := 0
		fmt.Sscanf(item.Status.Capacity.CPU, "%d", &cpuCores)
		totalMem := kc.parseK8sQuantity(item.Status.Capacity.Memory)

		m := metricsMap[name]

		nodeID, err := kc.DB.UpsertKubernetesNode(data_centralizegg.KubernetesNode{
			ServerID:         s.ID,
			Hostname:         name,
			IPAddress:        ip,
			Status:           status,
			Version:          item.Status.NodeInfo.KubeletVersion,
			OSName:           item.Status.NodeInfo.OSImage,
			KernelVer:        item.Status.NodeInfo.KernelVersion,
			ContainerRuntime: item.Status.NodeInfo.ContainerRuntimeVersion,
			CPUCores:         cpuCores,
			TotalMemory:      totalMem,
			CPUUsage:         m.CPUUsage,
			FreeMemory:       totalMem - m.MemUsage,
		})
		if err != nil {
			log.Printf("[KubernetesCollector] Failed to upsert node %s: %v", name, err)
			continue
		}
		nodeIDMap[name] = nodeID
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
					NodeName string `json:"nodeName"`
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
				m := podMetricsMap[key]

				age := ""
				if item.Status.StartTime != "" {
					if t, err := time.Parse(time.RFC3339, item.Status.StartTime); err == nil {
						age = time.Since(t).Round(time.Second).String()
					}
				}

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
				}

				if err := kc.DB.UpsertKubernetesPod(p); err != nil {
					log.Printf("[KubernetesCollector] Failed to upsert pod %s: %v", p.Name, err)
				}
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
	nodeCount := len(nodeListView.Items)

	for _, item := range nodeListView.Items {
		name := item.Metadata.Name
		m := metricsMap[name]
		totalCPUUsage += m.CPUUsage
		clusterTotalMemory += kc.parseK8sQuantity(item.Status.Capacity.Memory)
		clusterFreeMemory += (kc.parseK8sQuantity(item.Status.Capacity.Memory) - m.MemUsage)

		cpuStr := item.Status.Capacity.CPU
		if strings.HasSuffix(cpuStr, "m") {
			coresVal := kc.parseK8sQuantity(cpuStr)
			totalCores += int(coresVal / 1000)
		} else {
			totalCores += int(kc.parseK8sQuantity(cpuStr))
		}
	}

	avgCPUUsage := 0.0
	if nodeCount > 0 {
		avgCPUUsage = totalCPUUsage / float64(nodeCount)
	}

	err = kc.DB.UpdateGenericServerStats("kubernetes", s.ID, avgCPUUsage, totalCores, clusterTotalMemory, clusterFreeMemory, clusterUsedStorage, clusterTotalStorage, "Kubernetes Cluster", "Cluster Resources")
	if err != nil {
		log.Printf("[KubernetesCollector] Failed to update cluster stats: %v", err)
	}

	return nil
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
	// Simple parser for K8s quantities (e.g. 8Gi, 512Mi, 40000ki, 500m)
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}

	var val float64
	var unit string

	// Check for Ki, Mi, Gi, etc.
	if strings.HasSuffix(s, "Ki") {
		fmt.Sscanf(strings.TrimSuffix(s, "Ki"), "%f", &val)
		return uint64(val * 1024)
	}
	if strings.HasSuffix(s, "Mi") {
		fmt.Sscanf(strings.TrimSuffix(s, "Mi"), "%f", &val)
		return uint64(val * 1024 * 1024)
	}
	if strings.HasSuffix(s, "Gi") {
		fmt.Sscanf(strings.TrimSuffix(s, "Gi"), "%f", &val)
		return uint64(val * 1024 * 1024 * 1024)
	}
	if strings.HasSuffix(s, "m") {
		// Millicores or similar, return as is or scale if needed
		fmt.Sscanf(strings.TrimSuffix(s, "m"), "%f", &val)
		return uint64(val)
	}

	// Default to just number
	fmt.Sscanf(s, "%f%s", &val, &unit)
	return uint64(val)
}
