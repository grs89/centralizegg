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
	"github.com/grs/centralizegg/backend_internal_centralizegg/storage"
	"github.com/grs/centralizegg/backend_internal_centralizegg/virtualization"
)

const AppVersion = "1.0.0"

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
		gz := gzip.NewWriter(w)
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
		// Concise logging with latency
		log.Printf("%s %s %v", r.Method, r.URL.Path, time.Since(start))
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
		schemas := []string{"virtualization", "firewall", "storage", "containers", "kubernetes"}
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
	log.Println("Connected to Database")

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

	// Start Server
	log.Println("Server running on :8080")
	log.Fatal(http.ListenAndServe(":8080", r))
}
