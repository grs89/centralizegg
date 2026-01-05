package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/mux"
	"github.com/grs/centralize/internal/collector"
	"github.com/grs/centralize/internal/storage"
)

func main() {
	// Configuration from Env
	dbHost := os.Getenv("DB_HOST")
	dbPort := os.Getenv("DB_PORT")
	dbUser := os.Getenv("DB_USER")
	dbPass := os.Getenv("DB_PASS")
	dbName := os.Getenv("DB_NAME")
	libvirtSock := os.Getenv("LIBVIRT_SOCK")
	if libvirtSock == "" {
		libvirtSock = "/var/run/libvirt/libvirt-sock"
	}

	connStr := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable", dbUser, dbPass, dbHost, dbPort, dbName)

	// Wait for DB to be ready (naive retry)
	var db *storage.DB
	var err error
	for i := 0; i < 10; i++ {
		db, err = storage.NewPostgresDB(connStr)
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

	// Initialize Collector
	col, err := collector.NewCollector(libvirtSock, db)
	if err != nil {
		log.Printf("Warning: Could not connect to Libvirt: %v. Running in View-Only mode.", err)
	} else {
		log.Println("Connected to Libvirt, starting collector...")
		go col.Start(5 * time.Second)
	}

	// Router
	r := mux.NewRouter()

	// API Handlers
	r.HandleFunc("/api/host", func(w http.ResponseWriter, r *http.Request) {
		host, err := db.GetHost()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(host)
	}).Methods("GET")

	r.HandleFunc("/api/vms", func(w http.ResponseWriter, r *http.Request) {
		vms, err := db.GetAllVMs()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(vms)
	}).Methods("GET")

	// Static Files
	r.PathPrefix("/").Handler(http.FileServer(http.Dir("./web/static/")))

	// Start Server
	log.Println("Server running on :8080")
	log.Fatal(http.ListenAndServe(":8080", r))
}
