package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gorilla/mux"
	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
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

	// Initialize Multi-Collector
	col := virtualization.NewMultiCollector(db)
	go col.Start(10 * time.Second) // Check every 10 seconds

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

	// Static Files
	r.PathPrefix("/").Handler(http.FileServer(http.Dir("./web_centralizegg/static/")))

	// Start Server
	log.Println("Server running on :8080")
	log.Fatal(http.ListenAndServe(":8080", r))
}
