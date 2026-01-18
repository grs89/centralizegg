package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gorilla/mux"
	"github.com/grs/centralizegg/backend_internal_centralizegg/container"
	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"github.com/grs/centralizegg/backend_internal_centralizegg/firewall"
	"github.com/grs/centralizegg/backend_internal_centralizegg/storage"
	"github.com/grs/centralizegg/backend_internal_centralizegg/virtualization"
)

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
	if err != nil {
		log.Fatalf("Could not connect to DB: %v", err)
	}
	log.Println("Connected to Database")

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

	// API Handlers
	r.HandleFunc("/api/hosts", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		hosts, err := db.GetHosts()
		if err != nil {
			log.Printf("Error GetHosts: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	r.HandleFunc("/api/vms", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		vms, err := db.GetAllVMs()
		if err != nil {
			log.Printf("Error GetAllVMs: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(vms)
	}).Methods("GET")

	// Firewall hosts API
	r.HandleFunc("/api/firewall/hosts", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		hosts, err := db.GetFirewallHosts()
		if err != nil {
			log.Printf("Error GetFirewallHosts: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// Docker hosts API
	r.HandleFunc("/api/containers/hosts", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		hosts, err := db.GetDockerHosts()
		if err != nil {
			log.Printf("Error GetDockerHosts: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// Docker containers API
	r.HandleFunc("/api/containers/containers", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		containers, err := db.GetAllContainers()
		if err != nil {
			log.Printf("Error GetAllContainers: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(containers)
	}).Methods("GET")

	// Kubernetes nodes API
	r.HandleFunc("/api/kubernetes/nodes", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		nodes, err := db.GetKubernetesNodes()
		if err != nil {
			log.Printf("Error GetKubernetesNodes: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(nodes)
	}).Methods("GET")

	// Kubernetes pods API
	r.HandleFunc("/api/kubernetes/pods", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		pods, err := db.GetAllKubernetesPods()
		if err != nil {
			log.Printf("Error GetAllKubernetesPods: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(pods)
	}).Methods("GET")

	// Kubernetes persistent volumes API
	r.HandleFunc("/api/kubernetes/pvs", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		pvs, err := db.GetAllKubernetesPVs()
		if err != nil {
			log.Printf("Error GetAllKubernetesPVs: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(pvs)
	}).Methods("GET")
	// Podman hosts API
	r.HandleFunc("/api/podman/hosts", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		hosts, err := db.GetPodmanHosts()
		if err != nil {
			log.Printf("Error GetPodmanHosts: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// Podman containers API
	r.HandleFunc("/api/podman/containers", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		containers, err := db.GetAllPodmanContainers()
		if err != nil {
			log.Printf("Error GetAllPodmanContainers: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(containers)
	}).Methods("GET")

	// Proxmox hosts API
	r.HandleFunc("/api/proxmox/hosts", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		hosts, err := db.GetProxmoxHosts()
		if err != nil {
			log.Printf("Error GetProxmoxHosts: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// Proxmox VMs API (includes LXC)
	r.HandleFunc("/api/proxmox/vms", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		vms, err := db.GetAllProxmoxVMs()
		if err != nil {
			log.Printf("Error GetAllProxmoxVMs: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(vms)
	}).Methods("GET")

	// NAS hosts API
	r.HandleFunc("/api/nas/hosts", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		hosts, err := db.GetNasHosts()
		if err != nil {
			log.Printf("Error GetNasHosts: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// NAS volumes API
	r.HandleFunc("/api/nas/volumes", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		volumes, err := db.GetAllNasVolumes()
		if err != nil {
			log.Printf("Error GetAllNasVolumes: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(volumes)
	}).Methods("GET")

	// NAS disks API
	r.HandleFunc("/api/nas/disks", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		disks, err := db.GetAllNasDisks()
		if err != nil {
			log.Printf("Error GetAllNasDisks: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(disks)
	}).Methods("GET")

	// Ceph hosts API
	r.HandleFunc("/api/ceph/hosts", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		hosts, err := db.GetCephHosts()
		if err != nil {
			log.Printf("Error GetCephHosts: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(hosts)
	}).Methods("GET")

	// Firewall servers config API
	r.HandleFunc("/api/firewall/servers", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")

		if r.Method == "GET" {
			servers, err := db.GetPFSenseServers()
			if err != nil {
				log.Printf("Error GetPFSenseServers: %v", err)
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
			if s.SSHKeyPath == "" {
				s.SSHKeyPath = "/root/.ssh/id_rsa"
			}
			id, err := db.AddPFSenseServer(s)
			if err != nil {
				log.Printf("Error AddPFSenseServer: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			s.ID = id
			json.NewEncoder(w).Encode(s)
		}
	}).Methods("GET", "POST")

	r.HandleFunc("/api/firewall/servers/{id}", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
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
		log.Printf("%s %s", r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		var s data_centralizegg.KVMServer
		if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		// Default Key Path if empty
		if s.SSHKeyPath == "" {
			s.SSHKeyPath = "/root/.ssh/id_rsa"
		}
		id, err := db.AddServer(s)
		if err != nil {
			log.Printf("Error AddServer: %v", err)
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

	// GeoIP Proxy API
	r.HandleFunc("/api/geoip/{ip}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		ip := vars["ip"]

		// Construct target URL
		targetURL := "http://ip-api.com/json/" + ip
		if ip == "self" {
			targetURL = "http://ip-api.com/json/"
		}

		// Make request
		resp, err := http.Get(targetURL)
		if err != nil {
			log.Printf("Error proxying GeoIP for %s: %v", ip, err)
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		// Copy headers and body
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		if _, err := io.Copy(w, resp.Body); err != nil {
			log.Printf("Error copying GeoIP response: %v", err)
		}
	}).Methods("GET")

	// Static Files
	r.PathPrefix("/").Handler(http.FileServer(http.Dir("./web_centralizegg/static/")))

	// Start Server
	log.Println("Server running on :8080")
	log.Fatal(http.ListenAndServe(":8080", r))
}
