package main

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"runtime"
	"strings"

	"github.com/gorilla/mux"
	"github.com/grs/centralizegg/backend_internal_centralizegg/container"
	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"github.com/grs/centralizegg/backend_internal_centralizegg/firewall"
	"github.com/grs/centralizegg/backend_internal_centralizegg/logger"
	"github.com/grs/centralizegg/backend_internal_centralizegg/storage"
	"github.com/grs/centralizegg/backend_internal_centralizegg/virtualization"
)

var systemLog *log.Logger

const AppVersion = "1.0.1"

var (
	startTime      = time.Now()
	lastCPUTime    int64
	lastSampleTime time.Time

	// Performance Caching
	dbStats      = make(map[string]int64)
	dbTotalSize  int64
	dbStatsMutex sync.RWMutex

	// Connection Pooling for Outbound
	httpClient = &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 20,
			IdleConnTimeout:     90 * time.Second,
		},
	}
)

// Middlewares
type gzipResponseWriter struct {
	io.Writer
	http.ResponseWriter
}

func (w gzipResponseWriter) Write(b []byte) (int, error) {
	return w.Writer.Write(b)
}

func GzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only compress if client supports it and it's a GET request (usually where big JSONs are)
		if r.Method != "GET" || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		gz, err := gzip.NewWriterLevel(w, gzip.BestSpeed)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		defer gz.Close()
		next.ServeHTTP(gzipResponseWriter{Writer: gz, ResponseWriter: w}, r)
	})
}

func JSONHeaderMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Content-Type", "application/json")
		}
		next.ServeHTTP(w, r)
	})
}

func RequestLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		// Concise logging with latency to systemLog (Console + DB)
		if systemLog != nil {
			systemLog.Printf("%s %s %v", r.Method, r.URL.Path, time.Since(start))
		}
	})
}

func updateDBStats(db *data_centralizegg.DB) {
	// Runs every 5 minutes to avoid heavy pg_total_relation_size calls on every status request
	ticker := time.NewTicker(5 * time.Minute)
	task := func() {
		if db == nil || db.Conn == nil {
			return
		}
		newStats := make(map[string]int64)
		schemas := []string{"virtualization", "firewall", "storage", "containers", "kubernetes", "logging"}
		for _, schema := range schemas {
			var size int64
			err := db.Conn.QueryRow(`
				SELECT COALESCE(SUM(pg_total_relation_size(schemaname||'.'||tablename)), 0)
				FROM pg_tables WHERE schemaname = $1`, schema).Scan(&size)
			if err == nil {
				newStats[schema] = size
			}
		}

		var total int64
		err := db.Conn.QueryRow(`SELECT pg_database_size(current_database())`).Scan(&total)

		dbStatsMutex.Lock()
		dbStats = newStats
		if err == nil {
			dbTotalSize = total
		}
		dbStatsMutex.Unlock()
	}

	go func() {
		task() // run once immediately
		for range ticker.C {
			task()
		}
	}()
}

func main() {
	// Configuration from Env
	dbHost := os.Getenv("DB_HOST")
	dbPort := os.Getenv("DB_PORT")
	dbUser := os.Getenv("DB_USER")
	dbPass := os.Getenv("DB_PASS")
	dbName := os.Getenv("DB_NAME")

	connStr := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable", dbUser, dbPass, dbHost, dbPort, dbName)

	// Wait for DB to be ready (naive retry)
	var db *data_centralizegg.DB
	var err error
	for i := 0; i < 10; i++ {
		db, err = data_centralizegg.NewPostgresDB(connStr)
		if err == nil {
			break
		}
		log.Printf("Waiting for DB... (%v)", err)
		time.Sleep(2 * time.Second)
	}
	// Global Log Interceptor (Now only to DB to keep clean container logs for most things)
	dbLogWriter := logger.SetupGlobalLogger(db)
	log.SetOutput(dbLogWriter)

	// Selective Console Logger (Show API calls and DB connection events in Docker logs)
	systemLog = log.New(io.MultiWriter(os.Stderr, dbLogWriter), "", log.LstdFlags)

	systemLog.Println("Connected to Database")
	systemLog.Println("[System] Log capture system initialized (Selective Console Output)")

	// Start Performance Background Jobs
	updateDBStats(db)

	// Initialize Multi-Collector (KVM)
	col := virtualization.NewMultiCollector(db)
	go col.Start(5 * time.Second)

	pfCol := firewall.NewPFSenseCollector(db)
	go pfCol.Start(5 * time.Second)

	dockerCol := container.NewDockerCollector(db)
	go dockerCol.Start(5 * time.Second)

	k8sCol := container.NewKubernetesCollector(db)
	go k8sCol.Start(5 * time.Second)

	podmanCol := container.NewPodmanCollector(db)
	go podmanCol.Start(5 * time.Second)

	proxmoxCol := virtualization.NewProxmoxCollector(db)
	go proxmoxCol.Start(5 * time.Second)

	nasCol := storage.NewNasCollector(db)
	go nasCol.Start(5 * time.Second)

	cephCol := storage.NewCephCollector(db)
	go cephCol.Start(5 * time.Second)

	// Router
	r := mux.NewRouter()

	// Apply Middlewares to Router
	r.Use(RequestLoggerMiddleware)
	r.Use(JSONHeaderMiddleware)
	r.Use(GzipMiddleware)

	// API Handlers (Headers and Logging are now handled by Middlewares)
	r.HandleFunc("/api/health/summary", func(w http.ResponseWriter, r *http.Request) {
		data, err := db.GetInfrastructureHealth()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(data)
	}).Methods("GET")

	r.HandleFunc("/api/history", func(w http.ResponseWriter, r *http.Request) {
		limit := 50
		events, err := db.GetHistory(limit)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(events)
	}).Methods("GET")

	// New App Logs API with search support
	r.HandleFunc("/api/app-logs", func(w http.ResponseWriter, r *http.Request) {
		limitStr := r.URL.Query().Get("limit")
		limit := 100
		if limitStr != "" {
			if l, err := strconv.Atoi(limitStr); err == nil {
				limit = l
			}
		}
		filter := r.URL.Query().Get("filter")

		logs, err := db.GetAppLogs(limit, filter)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(logs)
	}).Methods("GET")

	r.HandleFunc("/api/app-logs", func(w http.ResponseWriter, r *http.Request) {
		var logEntry struct {
			Level   string `json:"level"`
			Module  string `json:"module"`
			Message string `json:"message"`
		}
		if err := json.NewDecoder(r.Body).Decode(&logEntry); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if logEntry.Level == "" {
			logEntry.Level = "INFO"
		}
		if logEntry.Module == "" {
			logEntry.Module = "API"
		}

		err := db.LogAppMessage(logEntry.Level, logEntry.Module, logEntry.Message)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
	}).Methods("POST")

	r.HandleFunc("/api/metrics/{category}/{id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		category := vars["category"]
		id, err := strconv.ParseInt(vars["id"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid ID", http.StatusBadRequest)
			return
		}

		duration := r.URL.Query().Get("duration")
		if duration == "" {
			duration = "24h"
		}

		metrics, err := db.GetServerHistory(id, category, duration)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(metrics)
	}).Methods("GET")

	// Terminal WebSockets API
	r.HandleFunc("/api/terminal/{category}/{serverId}/{targetName}", TerminalHandler(db))

	// Retention APIs
	r.HandleFunc("/api/logging/retention", func(w http.ResponseWriter, r *http.Request) {
		days, err := db.GetRetentionDays()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]int{"days": days})
	}).Methods("GET")

	r.HandleFunc("/api/logging/retention", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Days int `json:"days"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := db.UpdateRetentionPolicy(req.Days); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}).Methods("POST")

	r.HandleFunc("/api/logging/cleanup", func(w http.ResponseWriter, r *http.Request) {
		if err := db.CleanupAllLogs(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}).Methods("POST")

	r.HandleFunc("/api/logging/host-logs", func(w http.ResponseWriter, r *http.Request) {
		category := r.URL.Query().Get("category")
		serverIDStr := r.URL.Query().Get("serverId")
		limitStr := r.URL.Query().Get("limit")

		if category == "" || serverIDStr == "" {
			http.Error(w, "missing category or serverId", http.StatusBadRequest)
			return
		}

		serverID, err := strconv.ParseInt(serverIDStr, 10, 64)
		if err != nil {
			http.Error(w, "invalid serverId", http.StatusBadRequest)
			return
		}

		limit := 100
		if limitStr != "" {
			if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
				limit = l
			}
		}

		logs, err := db.GetHostLogsFromDB(category, serverID, limit)
		if err != nil {
			http.Error(w, "failed to get host logs", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"logs": logs,
		})
	}).Methods("GET")

	// Host Logs API (Live fetch via SSH)

	r.HandleFunc("/api/hosts/{category}/{id}/logs", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		category := vars["category"]
		id, err := strconv.ParseInt(vars["id"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid ID", http.StatusBadRequest)
			return
		}

		var logs string
		var fetchErr error

		switch category {
		case "kvm":
			logs, fetchErr = col.GetHostLogs(id)
		case "docker":
			logs, fetchErr = dockerCol.GetHostLogs(id)
		case "podman":
			logs, fetchErr = podmanCol.GetHostLogs(id)
		case "kubernetes":
			logs, fetchErr = k8sCol.GetHostLogs(id)
		case "pfsense":
			logs, fetchErr = pfCol.GetHostLogs(id)
		case "proxmox":
			logs, fetchErr = proxmoxCol.GetHostLogs(id)
		case "nas":
			logs, fetchErr = nasCol.GetHostLogs(id)
		case "ceph":
			logs, fetchErr = cephCol.GetHostLogs(id)
		default:
			fetchErr = fmt.Errorf("unsupported category for logs: %s", category)
		}

		if fetchErr != nil {
			http.Error(w, fetchErr.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"logs": logs})
	}).Methods("GET")

	r.HandleFunc("/api/hosts", func(w http.ResponseWriter, r *http.Request) {
		hosts, err := db.GetHosts()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	r.HandleFunc("/api/vms", func(w http.ResponseWriter, r *http.Request) {
		vms, err := db.GetAllVMs()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(vms)
	}).Methods("GET")

	// Firewall hosts API
	r.HandleFunc("/api/firewall/hosts", func(w http.ResponseWriter, r *http.Request) {
		hosts, err := db.GetFirewallHosts()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// Docker hosts API
	r.HandleFunc("/api/containers/hosts", func(w http.ResponseWriter, r *http.Request) {
		hosts, err := db.GetDockerHosts()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// Docker containers API
	r.HandleFunc("/api/containers/containers", func(w http.ResponseWriter, r *http.Request) {
		containers, err := db.GetAllContainers()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(containers)
	}).Methods("GET")

	// Docker logs API
	r.HandleFunc("/api/containers/{serverID}/{containerID}/logs", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, err := strconv.ParseInt(vars["serverID"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid Server ID", http.StatusBadRequest)
			return
		}
		containerID := vars["containerID"]

		logs, err := dockerCol.GetContainerLogs(serverID, containerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"logs": logs})
	}).Methods("GET")

	// Docker container control
	r.HandleFunc("/api/containers/{serverID}/{containerID}/start", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, err := strconv.ParseInt(vars["serverID"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid Server ID", http.StatusBadRequest)
			return
		}
		containerID := vars["containerID"]

		if err := dockerCol.StartContainer(serverID, containerID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}).Methods("POST")

	r.HandleFunc("/api/containers/{serverID}/{containerID}/stop", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, err := strconv.ParseInt(vars["serverID"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid Server ID", http.StatusBadRequest)
			return
		}
		containerID := vars["containerID"]

		if err := dockerCol.StopContainer(serverID, containerID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}).Methods("POST")

	// Podman logs API
	r.HandleFunc("/api/podman/containers/{serverID}/{containerID}/logs", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, err := strconv.ParseInt(vars["serverID"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid Server ID", http.StatusBadRequest)
			return
		}
		containerID := vars["containerID"]

		logs, err := podmanCol.GetContainerLogs(serverID, containerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"logs": logs})
	}).Methods("GET")

	// Podman container control
	r.HandleFunc("/api/podman/containers/{serverID}/{containerID}/start", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, err := strconv.ParseInt(vars["serverID"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid Server ID", http.StatusBadRequest)
			return
		}
		containerID := vars["containerID"]

		if err := podmanCol.StartContainer(serverID, containerID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}).Methods("POST")

	r.HandleFunc("/api/podman/containers/{serverID}/{containerID}/stop", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, err := strconv.ParseInt(vars["serverID"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid Server ID", http.StatusBadRequest)
			return
		}
		containerID := vars["containerID"]

		if err := podmanCol.StopContainer(serverID, containerID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}).Methods("POST")

	// KVM VM control
	r.HandleFunc("/api/kvm/vms/{serverID}/{vmName}/start", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, err := strconv.ParseInt(vars["serverID"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid Server ID", http.StatusBadRequest)
			return
		}
		vmName := vars["vmName"]

		if err := col.StartVM(serverID, vmName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}).Methods("POST")

	r.HandleFunc("/api/kvm/vms/{serverID}/{vmName}/stop", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, err := strconv.ParseInt(vars["serverID"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid Server ID", http.StatusBadRequest)
			return
		}
		vmName := vars["vmName"]

		if err := col.StopVM(serverID, vmName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}).Methods("POST")

	r.HandleFunc("/api/kvm/vms/{serverID}/{vmName}/snapshots", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, err := strconv.ParseInt(vars["serverID"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid Server ID", http.StatusBadRequest)
			return
		}
		vmName := vars["vmName"]

		if r.Method == "GET" {
			snapsRaw, err := col.GetSnapshots(serverID, vmName)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(snapsRaw))
		} else if r.Method == "POST" {
			var payload struct {
				Name        string `json:"name"`
				Description string `json:"description"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if err := col.CreateSnapshot(serverID, vmName, payload.Name, payload.Description); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		}
	}).Methods("GET", "POST")

	r.HandleFunc("/api/kvm/vms/{serverID}/{vmName}/snapshots/{snapName}/revert", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, _ := strconv.ParseInt(vars["serverID"], 10, 64)
		vmName := vars["vmName"]
		snapName := vars["snapName"]

		if err := col.RevertSnapshot(serverID, vmName, snapName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}).Methods("POST")

	r.HandleFunc("/api/kvm/vms/{serverID}/{vmName}/snapshots/{snapName}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, _ := strconv.ParseInt(vars["serverID"], 10, 64)
		vmName := vars["vmName"]
		snapName := vars["snapName"]

		if err := col.DeleteSnapshot(serverID, vmName, snapName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}).Methods("DELETE")

	// Kubernetes nodes API
	r.HandleFunc("/api/kubernetes/nodes", func(w http.ResponseWriter, r *http.Request) {
		nodes, err := db.GetKubernetesNodes()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(nodes)
	}).Methods("GET")

	// Kubernetes pods API
	r.HandleFunc("/api/kubernetes/pods", func(w http.ResponseWriter, r *http.Request) {
		pods, err := db.GetAllKubernetesPods()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(pods)
	}).Methods("GET")

	// Kubernetes persistent volumes API
	r.HandleFunc("/api/kubernetes/pvs", func(w http.ResponseWriter, r *http.Request) {
		pvs, err := db.GetAllKubernetesPVs()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(pvs)
	}).Methods("GET")

	// Kubernetes events API
	r.HandleFunc("/api/kubernetes/events", func(w http.ResponseWriter, r *http.Request) {
		events, err := db.GetKubernetesEvents()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(events)
	}).Methods("GET")

	// Kubernetes logs API
	r.HandleFunc("/api/kubernetes/pods/{serverID}/{namespace}/{name}/logs", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, err := strconv.ParseInt(vars["serverID"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid Server ID", http.StatusBadRequest)
			return
		}
		namespace := vars["namespace"]
		name := vars["name"]

		logs, err := k8sCol.GetPodLogs(serverID, namespace, name)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"logs": logs})
	}).Methods("GET")

	// Podman hosts API
	r.HandleFunc("/api/podman/hosts", func(w http.ResponseWriter, r *http.Request) {
		hosts, err := db.GetPodmanHosts()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// Podman containers API
	r.HandleFunc("/api/podman/containers", func(w http.ResponseWriter, r *http.Request) {
		containers, err := db.GetAllPodmanContainers()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(containers)
	}).Methods("GET")

	// Proxmox hosts API
	r.HandleFunc("/api/proxmox/hosts", func(w http.ResponseWriter, r *http.Request) {
		hosts, err := db.GetProxmoxHosts()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// Proxmox VMs API (includes LXC)
	r.HandleFunc("/api/proxmox/vms", func(w http.ResponseWriter, r *http.Request) {
		vms, err := db.GetAllProxmoxVMs()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(vms)
	}).Methods("GET")

	// NAS hosts API
	r.HandleFunc("/api/nas/hosts", func(w http.ResponseWriter, r *http.Request) {
		hosts, err := db.GetNasHosts()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// NAS volumes API
	r.HandleFunc("/api/nas/volumes", func(w http.ResponseWriter, r *http.Request) {
		volumes, err := db.GetAllNasVolumes()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(volumes)
	}).Methods("GET")

	// NAS disks API
	r.HandleFunc("/api/nas/disks", func(w http.ResponseWriter, r *http.Request) {
		disks, err := db.GetAllNasDisks()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(disks)
	}).Methods("GET")

	// Ceph hosts API
	r.HandleFunc("/api/ceph/hosts", func(w http.ResponseWriter, r *http.Request) {
		hosts, err := db.GetCephHosts()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// Firewall servers config API
	r.HandleFunc("/api/firewall/servers", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			servers, err := db.GetPFSenseServers()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(servers)
		} else if r.Method == "POST" {
			var s data_centralizegg.PFSenseServer
			if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			id, err := db.AddPFSenseServer(s)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			s.ID = id
			json.NewEncoder(w).Encode(s)
		}
	}).Methods("GET", "POST")

	r.HandleFunc("/api/firewall/servers/{id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id, err := strconv.ParseInt(vars["id"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid ID", http.StatusBadRequest)
			return
		}

		if r.Method == "PUT" {
			var s data_centralizegg.PFSenseServer
			if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			s.ID = id
			// preserve key path if empty? default logic in DB update handles replacement only if we want
			// actually we replace all fields in UpdatePFSenseServer, so we must ensure `s` has all data.
			// Front end sends full object usually.
			if s.SSHKeyPath == "" {
				s.SSHKeyPath = "/root/.ssh/id_rsa"
			}

			if err := db.UpdatePFSenseServer(s); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusOK)
		} else if r.Method == "DELETE" {
			if err := db.DeletePFSenseServer(id); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusOK)
		}
	}).Methods("PUT", "DELETE")

	// Config API
	r.HandleFunc("/api/config/servers", func(w http.ResponseWriter, r *http.Request) {
		servers, err := db.GetServers()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(servers)
	}).Methods("GET")

	r.HandleFunc("/api/config/servers", func(w http.ResponseWriter, r *http.Request) {
		var s data_centralizegg.KVMServer
		if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		id, err := db.AddServer(s)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		s.ID = id
		json.NewEncoder(w).Encode(s)
	}).Methods("POST")

	r.HandleFunc("/api/config/servers/{id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id, err := strconv.ParseInt(vars["id"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid ID", http.StatusBadRequest)
			return
		}
		var s data_centralizegg.KVMServer
		if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		s.ID = id

		// If SSHKeyPath is empty, set default, unless we want to keep existing?
		// The UI should probably send the default if it renders it.
		// Let's stick to simple logic: if empty, default.
		if s.SSHKeyPath == "" {
			s.SSHKeyPath = "/root/.ssh/id_rsa"
		}

		if err := db.UpdateServer(s); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}).Methods("PUT")

	r.HandleFunc("/api/config/servers/{id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id, err := strconv.ParseInt(vars["id"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid ID", http.StatusBadRequest)
			return
		}
		if err := db.DeleteServer(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}).Methods("DELETE")

	// Generic Server Config API for Proxmox, NAS, Ceph, Docker, Podman
	r.HandleFunc("/api/config/{tool}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		tool := vars["tool"]
		// Skip "servers" as it's handled by the KVM-specific endpoint above
		if tool == "servers" {
			return
		}
		servers, err := db.GetGenericServers(tool)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(servers)
	}).Methods("GET")

	r.HandleFunc("/api/config/{tool}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		tool := vars["tool"]
		if tool == "servers" {
			return
		}
		var s data_centralizegg.GenericServer
		if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		id, err := db.AddGenericServer(tool, s)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		s.ID = id
		json.NewEncoder(w).Encode(s)
	}).Methods("POST")

	r.HandleFunc("/api/config/{tool}/{id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		tool := vars["tool"]
		if tool == "servers" {
			return
		}
		id, err := strconv.ParseInt(vars["id"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid ID", http.StatusBadRequest)
			return
		}
		var s data_centralizegg.GenericServer
		if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		s.ID = id
		if err := db.UpdateGenericServer(tool, s); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}).Methods("PUT")

	r.HandleFunc("/api/config/{tool}/{id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		tool := vars["tool"]
		if tool == "servers" {
			return
		}
		id, err := strconv.ParseInt(vars["id"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid ID", http.StatusBadRequest)
			return
		}
		if err := db.DeleteGenericServer(tool, id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}).Methods("DELETE")

	// GeoIP Proxy API (Optimized with pooling)
	r.HandleFunc("/api/geoip/{ip}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		ip := vars["ip"]

		targetURL := "http://ip-api.com/json/" + ip
		if ip == "self" {
			targetURL = "http://ip-api.com/json/"
		}

		resp, err := httpClient.Get(targetURL)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	}).Methods("GET")

	// System Status API (Optimized with caching)
	r.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		// Calculate App CPU Usage (Lightweight check)
		var appCPU float64
		if data, err := os.ReadFile("/proc/self/stat"); err == nil {
			fields := strings.Fields(string(data))
			if len(fields) > 14 {
				utime, _ := strconv.ParseInt(fields[13], 10, 64)
				stime, _ := strconv.ParseInt(fields[14], 10, 64)
				totalCPU := utime + stime
				now := time.Now()
				if !lastSampleTime.IsZero() {
					if dt := now.Sub(lastSampleTime).Seconds(); dt > 0 {
						appCPU = (float64(totalCPU-lastCPUTime) / 100.0) / dt * 100.0
					}
				}
				lastCPUTime = totalCPU
				lastSampleTime = now
			}
		}

		var m runtime.MemStats
		runtime.ReadMemStats(&m)

		dbStatsMutex.RLock()
		currentDbStats := dbStats
		currentDbTotal := dbTotalSize
		dbStatsMutex.RUnlock()

		status := map[string]interface{}{
			"version":       AppVersion,
			"app_status":    "online",
			"app_cpu":       appCPU,
			"app_memory":    m.Alloc,
			"db_status":     "online", // Optimized: Assume online if stats are current
			"db_size":       currentDbStats,
			"db_total_size": currentDbTotal,
			"uptime":        time.Since(startTime).String(),
		}

		json.NewEncoder(w).Encode(status)
	}).Methods("GET")

	// Static Files
	r.PathPrefix("/").Handler(http.FileServer(http.Dir("./web_centralizegg/static/")))

	// Start Server with Timeouts
	srv := &http.Server{
		Addr:         ":8080",
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Println("Server running on :8080")

	// Start Log Cleanup Goroutine (every 12 hours)
	go func() {
		ticker := time.NewTicker(12 * time.Hour)
		for range ticker.C {
			log.Println("[Cleanup] Running expired logs cleanup...")
			if err := db.CleanupExpiredLogs(); err != nil {
				log.Printf("[Cleanup] Error: %v", err)
			}
		}
	}()

	log.Fatal(srv.ListenAndServe())
}
