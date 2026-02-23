package main

import (
	"compress/gzip"
	"context"
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
	"github.com/grs/centralizegg/backend_internal_centralizegg/ai"
	"github.com/grs/centralizegg/backend_internal_centralizegg/auth_centralizegg"
	"github.com/grs/centralizegg/backend_internal_centralizegg/container"
	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"github.com/grs/centralizegg/backend_internal_centralizegg/firewall"
	"github.com/grs/centralizegg/backend_internal_centralizegg/logger"
	"github.com/grs/centralizegg/backend_internal_centralizegg/notifications"
	"github.com/grs/centralizegg/backend_internal_centralizegg/operations"
	"github.com/grs/centralizegg/backend_internal_centralizegg/predictive"
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

type contextKey string

const (
	userContextKey contextKey = "user"
	roleContextKey contextKey = "role"
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

func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow static files and login endpoint without token
		// Anything that doesn't start with /api/ (except /api/auth/login) or /ws/ is considered static/public
		isApi := strings.HasPrefix(r.URL.Path, "/api/")
		isWs := strings.HasPrefix(r.URL.Path, "/ws/")
		isLogin := r.URL.Path == "/api/auth/login"

		if (!isApi && !isWs) || isLogin {
			next.ServeHTTP(w, r)
			return
		}

		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			// Also check for token in query param for WebSockets (Terminal)
			token := r.URL.Query().Get("token")
			if token != "" {
				authHeader = "Bearer " + token
			} else {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := auth_centralizegg.ValidateToken(tokenString)
		if err != nil {
			http.Error(w, "Invalid or expired token", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), userContextKey, claims.UserID)
		ctx = context.WithValue(ctx, roleContextKey, claims.Role)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func RequiresPermission(permission string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role, ok := r.Context().Value(roleContextKey).(string)
		if !ok {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		// RBAC logic
		if role == "admin" {
			next.ServeHTTP(w, r)
			return
		}

		// Basic viewer logic (only allow GET or specific read actions)
		if role == "viewer" {
			if r.Method == "GET" || permission == "read" {
				next.ServeHTTP(w, r)
				return
			}
		}

		http.Error(w, "Access Denied: Insufficient Permissions", http.StatusForbidden)
	}
}

func LoginHandler(db *data_centralizegg.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		user, err := db.GetUserByUsername(req.Username)
		if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		authenticated := false
		var userRole string
		var userID int64

		// 1. Try Local Authentication first
		if user != nil && auth_centralizegg.CheckPasswordHash(req.Password, user.PasswordHash) {
			authenticated = true
			userRole = user.RoleName
			userID = user.ID
		} else {
			// 2. Fallback to LDAP if local auth failed (or user doesn't exist)
			ldapConfig, err := db.GetLDAPConfig()
			if err == nil && ldapConfig.Enabled {
				ldapSuccess, authErr := auth_centralizegg.AuthenticateLDAP(req.Username, req.Password, ldapConfig)
				if ldapSuccess {
					authenticated = true
					// Provision or fetch the user locally to get an ID and Role
					if user == nil {
						// Auto-provision user with default 'viewer' role
						viewerRoleID, err := db.GetRoleIDByName("viewer")
						if err != nil {
							http.Error(w, "Database error: missing viewer role", http.StatusInternalServerError)
							return
						}
						// Password hash could be empty or a random string since LDAP is used for auth
						newID, err := db.CreateUser(req.Username, "", viewerRoleID)
						if err != nil {
							http.Error(w, "Failed to auto-provision user", http.StatusInternalServerError)
							return
						}
						userID = newID
						userRole = "viewer"
						AuditAction(r, db, "user.auto_provision", "User", req.Username, map[string]interface{}{"user_id": userID, "source": "LDAP"})
					} else {
						// User exists locally, but password was wrong locally. Authenticated via LDAP.
						userID = user.ID
						userRole = user.RoleName
					}
				} else {
					log.Printf("LDAP Auth failed for %s: %v", req.Username, authErr)
				}
			}
		}

		if !authenticated {
			http.Error(w, "Invalid credentials", http.StatusUnauthorized)
			return
		}

		token, err := auth_centralizegg.GenerateToken(userID, req.Username, userRole)
		if err != nil {
			http.Error(w, "Token generation error", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]string{
			"token": token,
			"role":  userRole,
			"user":  req.Username,
		})
	}
}

func AuditAction(r *http.Request, db *data_centralizegg.DB, action, resType, resID string, details map[string]interface{}) {
	userID, _ := r.Context().Value(userContextKey).(int64)
	ip := r.RemoteAddr
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		ip = strings.Split(forwarded, ",")[0]
	}

	detJSON, _ := json.Marshal(details)
	db.LogAuditAction(data_centralizegg.AuditLog{
		UserID:       userID,
		Action:       action,
		ResourceType: resType,
		ResourceID:   resID,
		Details:      detJSON,
		IPAddress:    ip,
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

	// Initialize Config Schema (Auto-migrate for existing deployments)
	if err := db.InitConfigSchema(); err != nil {
		log.Printf("[Warning] Failed to initialize config schema: %v", err)
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

	// Initialize Operations Executor (AI Proactive Actions)
	opsExecutor := &operations.ActionExecutor{
		DB:     db,
		KVM:    col,
		Docker: dockerCol,
		Podman: podmanCol,
	}

	// Seed Admin User or Sync Password
	adminUser, _ := db.GetUserByUsername("admin")
	adminPass := os.Getenv("INITIAL_ADMIN_PASSWORD")
	if adminPass == "" {
		adminPass = "Centralizegg" // Default password
	}
	hash, _ := auth_centralizegg.HashPassword(adminPass)
	roleID, _ := db.GetRoleIDByName("admin")

	if adminUser == nil {
		if roleID > 0 {
			db.CreateUser("admin", hash, roleID)
			log.Printf("[Auth] Initial admin user created with username 'admin'")
		}
	} else {
		// Sync password for existing admin for dev convenience
		db.UpdateUserPassword(adminUser.ID, hash)
		log.Printf("[Auth] Admin user password synchronized")
	}

	// Router
	r := mux.NewRouter()

	// Apply Middlewares to Router
	r.Use(RequestLoggerMiddleware)
	r.Use(AuthMiddleware) // AUTH BEFORE JSON/GZIP BUT AFTER LOGGER
	r.Use(JSONHeaderMiddleware)
	r.Use(GzipMiddleware)

	// Auth Endpoints (Public)
	r.HandleFunc("/api/auth/login", LoginHandler(db)).Methods("POST")

	// User Management API (Protected, Requires Admin role)
	r.Handle("/api/users", RequiresPermission("admin", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			users, err := db.GetAllUsers()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(users)
		case "POST":
			var req struct {
				Username string `json:"username"`
				Password string `json:"password"`
				RoleID   int64  `json:"role_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid input", http.StatusBadRequest)
				return
			}
			hash, err := auth_centralizegg.HashPassword(req.Password) // fixed auth package reference
			if err != nil {
				http.Error(w, "Failed to hash password", http.StatusInternalServerError)
				return
			}
			id, err := db.CreateUser(req.Username, hash, req.RoleID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			AuditAction(r, db, "user.create", "User", req.Username, map[string]interface{}{"user_id": id, "role_id": req.RoleID})
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "message": "User created"})
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))).Methods("GET", "POST")

	r.Handle("/api/users/{id}", RequiresPermission("admin", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		userID, err := strconv.ParseInt(vars["id"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid user ID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case "PUT":
			var req struct {
				IsActive bool  `json:"is_active"`
				RoleID   int64 `json:"role_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid input", http.StatusBadRequest)
				return
			}
			err = db.UpdateUserStatusAndRole(userID, req.IsActive, req.RoleID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			AuditAction(r, db, "user.update", "User", strconv.FormatInt(userID, 10), map[string]interface{}{"is_active": req.IsActive, "role_id": req.RoleID})
			json.NewEncoder(w).Encode(map[string]string{"message": "User updated successfully"})

		case "DELETE":
			err = db.DeleteUser(userID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			AuditAction(r, db, "user.delete", "User", strconv.FormatInt(userID, 10), nil)
			json.NewEncoder(w).Encode(map[string]string{"message": "User deleted successfully"})
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))).Methods("PUT", "DELETE")

	r.Handle("/api/users/{id}/password", RequiresPermission("admin", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		userID, err := strconv.ParseInt(vars["id"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid user ID", http.StatusBadRequest)
			return
		}

		var req struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid input", http.StatusBadRequest)
			return
		}
		hash, err := auth_centralizegg.HashPassword(req.Password)
		if err != nil {
			http.Error(w, "Failed to hash password", http.StatusInternalServerError)
			return
		}

		err = db.UpdateUserPassword(userID, hash)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		AuditAction(r, db, "user.password_reset", "User", strconv.FormatInt(userID, 10), nil)
		json.NewEncoder(w).Encode(map[string]string{"message": "Password updated successfully"})
	}))).Methods("PUT")

	r.Handle("/api/auth/password", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(userContextKey).(int64)
		if !ok {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		var req struct {
			CurrentPassword string `json:"current_password"`
			NewPassword     string `json:"new_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid input", http.StatusBadRequest)
			return
		}

		user, err := db.GetUserByID(userID)
		if err != nil || user == nil {
			http.Error(w, "User not found", http.StatusNotFound)
			return
		}

		if !auth_centralizegg.CheckPasswordHash(req.CurrentPassword, user.PasswordHash) {
			http.Error(w, "Contraseña actual incorrecta", http.StatusForbidden)
			return
		}

		hash, err := auth_centralizegg.HashPassword(req.NewPassword)
		if err != nil {
			http.Error(w, "Failed to hash password", http.StatusInternalServerError)
			return
		}

		err = db.UpdateUserPassword(userID, hash)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		AuditAction(r, db, "user.self_password_update", "User", strconv.FormatInt(userID, 10), nil)
		json.NewEncoder(w).Encode(map[string]string{"message": "Password updated successfully"})
	})).Methods("PUT")

	// LDAP Settings API (Protected, Requires Admin role)
	r.Handle("/api/settings/ldap", RequiresPermission("admin", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			config, err := db.GetLDAPConfig()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			// Mask password when sending to frontend
			config.BindPassword = ""
			json.NewEncoder(w).Encode(config)
		case "POST":
			var req data_centralizegg.LDAPConfig
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid input", http.StatusBadRequest)
				return
			}
			// If password is not provided in update, keep the old one
			if req.BindPassword == "" {
				oldConfig, err := db.GetLDAPConfig()
				if err == nil {
					req.BindPassword = oldConfig.BindPassword
				}
			}
			if err := db.UpdateLDAPConfig(req); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			AuditAction(r, db, "settings.update_ldap", "Settings", "LDAP", map[string]interface{}{"enabled": req.Enabled})
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"message": "LDAP configuration updated"})
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))).Methods("GET", "POST")

	r.Handle("/api/roles", RequiresPermission("admin", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		roles, err := db.GetRoles()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(roles)
	}))).Methods("GET")

	// API Handlers (Headers and Logging are now handled by Middlewares)
	r.HandleFunc("/api/health/summary", func(w http.ResponseWriter, r *http.Request) {
		data, err := db.GetInfrastructureHealth()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(data)
	}).Methods("GET")

	r.HandleFunc("/api/predictive/forecast/{category}/{id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		category := vars["category"]
		id, err := strconv.ParseInt(vars["id"], 10, 64)
		if err != nil {
			http.Error(w, "Invalid ID", http.StatusBadRequest)
			return
		}

		forecasts, err := predictive.GetForecastForServer(db, id, category)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(forecasts)
	}).Methods("GET")

	r.HandleFunc("/api/predictive/summary", func(w http.ResponseWriter, r *http.Request) {
		summary, err := predictive.GetGlobalForecastSummary(db)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(summary)
	}).Methods("GET")

	r.HandleFunc("/api/predictive/anomalies", func(w http.ResponseWriter, r *http.Request) {
		// Mock implementation for now, will be expanded
		json.NewEncoder(w).Encode([]interface{}{})
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

	// Nala IA - RAG QA Endpoint
	r.HandleFunc("/api/ai/ask", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ApiKey       string `json:"apiKey"`
			Provider     string `json:"provider"`
			BaseUrl      string `json:"baseUrl"`
			SystemPrompt string `json:"systemPrompt"`
			UserMessage  string `json:"userMessage"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Buscar memoria histórica (top 3)
		historicalEvents, err := ai.SearchSimilarEvents(db.Conn, req.ApiKey, req.UserMessage, 3)

		// Construir el contexto inyectado
		var memoryContextStr string
		if err == nil && len(historicalEvents) > 0 {
			memoryContextStr = "\n\n### Memoria Histórica del Clúster (Eventos Previos Similares)\n"
			for i, ev := range historicalEvents {
				memoryContextStr += fmt.Sprintf("- Evento %d [%s]: %s\n", i+1, ev.EventType, ev.Content)
			}
			memoryContextStr += "Usa este contexto previo solo si es relevante para el fallo o consulta actual.\n"
		}

		// Aquí podrías procesar la llamada completa a Gemini desde Go.
		// Para mantener la lógica de app.js (que procesa distintos llms),
		// devolvemos el texto inyectado para que app.js simplemente lo adjunte.

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":        true,
			"injectedMemory": memoryContextStr,
		})
	}).Methods("POST")

	r.HandleFunc("/api/ai/execute", RequiresPermission("write", func(w http.ResponseWriter, r *http.Request) {
		var req operations.AIActionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		result, err := opsExecutor.Execute(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		AuditAction(r, db, "AI_EXECUTE_ACTION", "ai", req.Action, req.Params)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok",
			"result": result,
		})
	})).Methods("POST")

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

	// Removed Config API {} catch-all to prevent shadowing
	// Retention APIs
	r.HandleFunc("/api/config/metrics/retention", func(w http.ResponseWriter, r *http.Request) {
		days, err := db.GetMetricsRetentionDays()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]int{"days": days})
	}).Methods("GET")

	r.HandleFunc("/api/config/metrics/retention", RequiresPermission("write", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Days int `json:"days"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := db.UpdateMetricsRetentionPolicy(req.Days); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		AuditAction(r, db, "UPDATE_METRICS_RETENTION", "config", "metrics", map[string]interface{}{"days": req.Days})
		w.WriteHeader(http.StatusOK)
	})).Methods("POST")

	r.HandleFunc("/api/logging/retention", func(w http.ResponseWriter, r *http.Request) {
		days, err := db.GetRetentionDays()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]int{"days": days})
	}).Methods("GET")

	r.HandleFunc("/api/logging/retention", RequiresPermission("write", func(w http.ResponseWriter, r *http.Request) {
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
		AuditAction(r, db, "UPDATE_LOGS_RETENTION", "config", "logs", map[string]interface{}{"days": req.Days})
		w.WriteHeader(http.StatusOK)
	})).Methods("POST")

	r.HandleFunc("/api/logging/cleanup", RequiresPermission("admin", func(w http.ResponseWriter, r *http.Request) {
		if err := db.CleanupAllLogs(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		AuditAction(r, db, "CLEANUP_ALL_LOGS", "logs", "all", nil)
		w.WriteHeader(http.StatusNoContent)
	})).Methods("POST")

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

	// Audit Logs API
	r.HandleFunc("/api/logging/audit-logs", func(w http.ResponseWriter, r *http.Request) {
		limitStr := r.URL.Query().Get("limit")
		offsetStr := r.URL.Query().Get("offset")
		limit := 50
		offset := 0
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}

		logs, err := db.GetAuditLogs(limit, offset)
		if err != nil {
			http.Error(w, "failed to get audit logs", http.StatusInternalServerError)
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
	r.HandleFunc("/api/containers/{serverID}/{containerID}/start", RequiresPermission("write", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, _ := strconv.ParseInt(vars["serverID"], 10, 64)
		containerID := vars["containerID"]

		if err := dockerCol.StartContainer(serverID, containerID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		AuditAction(r, db, "START_CONTAINER", "docker", containerID, map[string]interface{}{"serverId": serverID})
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})).Methods("POST")

	r.HandleFunc("/api/containers/{serverID}/{containerID}/stop", RequiresPermission("write", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, _ := strconv.ParseInt(vars["serverID"], 10, 64)
		containerID := vars["containerID"]

		if err := dockerCol.StopContainer(serverID, containerID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		AuditAction(r, db, "STOP_CONTAINER", "docker", containerID, map[string]interface{}{"serverId": serverID})
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})).Methods("POST")

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
	r.HandleFunc("/api/kvm/vms/{serverID}/{vmName}/start", RequiresPermission("write", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, _ := strconv.ParseInt(vars["serverID"], 10, 64)
		vmName := vars["vmName"]

		if err := col.StartVM(serverID, vmName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		AuditAction(r, db, "START_VM", "kvm", vmName, map[string]interface{}{"serverId": serverID})
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})).Methods("POST")

	r.HandleFunc("/api/kvm/vms/{serverID}/{vmName}/stop", RequiresPermission("write", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, _ := strconv.ParseInt(vars["serverID"], 10, 64)
		vmName := vars["vmName"]

		if err := col.StopVM(serverID, vmName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		AuditAction(r, db, "STOP_VM", "kvm", vmName, map[string]interface{}{"serverId": serverID})
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})).Methods("POST")

	r.HandleFunc("/api/kvm/vms/{serverID}/{vmName}/snapshots", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, _ := strconv.ParseInt(vars["serverID"], 10, 64)
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
			RequiresPermission("write", func(w http.ResponseWriter, r *http.Request) {
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
				AuditAction(r, db, "CREATE_SNAPSHOT", "kvm", vmName, map[string]interface{}{"serverId": serverID, "snapshot": payload.Name})
				json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
			})(w, r)
		}
	}).Methods("GET", "POST")

	r.HandleFunc("/api/kvm/vms/{serverID}/{vmName}/snapshots/{snapName}/revert", RequiresPermission("write", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, _ := strconv.ParseInt(vars["serverID"], 10, 64)
		vmName := vars["vmName"]
		snapName := vars["snapName"]

		if err := col.RevertSnapshot(serverID, vmName, snapName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		AuditAction(r, db, "REVERT_SNAPSHOT", "kvm", vmName, map[string]interface{}{"serverId": serverID, "snapshot": snapName})
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})).Methods("POST")

	r.HandleFunc("/api/kvm/vms/{serverID}/{vmName}/snapshots/{snapName}", RequiresPermission("write", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		serverID, _ := strconv.ParseInt(vars["serverID"], 10, 64)
		vmName := vars["vmName"]
		snapName := vars["snapName"]

		if err := col.DeleteSnapshot(serverID, vmName, snapName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		AuditAction(r, db, "DELETE_SNAPSHOT", "kvm", vmName, map[string]interface{}{"serverId": serverID, "snapshot": snapName})
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})).Methods("DELETE")

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
	r.HandleFunc("/api/config/{tool:proxmox|nas|ceph|docker|podman|kubernetes}", func(w http.ResponseWriter, r *http.Request) {
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

	r.HandleFunc("/api/config/{tool:proxmox|nas|ceph|docker|podman|kubernetes}", RequiresPermission("admin", func(w http.ResponseWriter, r *http.Request) {
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
		AuditAction(r, db, "ADD_SERVER", tool, s.Name, map[string]interface{}{"ip": s.IPAddress})
		json.NewEncoder(w).Encode(s)
	})).Methods("POST")

	r.HandleFunc("/api/config/{tool:proxmox|nas|ceph|docker|podman|kubernetes}/{id:[0-9]+}", RequiresPermission("admin", func(w http.ResponseWriter, r *http.Request) {
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
		AuditAction(r, db, "UPDATE_SERVER", tool, s.Name, map[string]interface{}{"id": id, "ip": s.IPAddress})
		w.WriteHeader(http.StatusOK)
	})).Methods("PUT")

	r.HandleFunc("/api/config/{tool:proxmox|nas|ceph|docker|podman|kubernetes}/{id:[0-9]+}", RequiresPermission("admin", func(w http.ResponseWriter, r *http.Request) {
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
		AuditAction(r, db, "DELETE_SERVER", tool, fmt.Sprintf("%d", id), nil)
		w.WriteHeader(http.StatusOK)
	})).Methods("DELETE")

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

	// Test Notification Trigger
	r.HandleFunc("/api/config/notifications/test", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		settingsJSON, _ := db.GetConfigValue("notification_settings")
		if settingsJSON == "" || settingsJSON == "{}" {
			http.Error(w, "Notification settings not configured", http.StatusBadRequest)
			return
		}

		// Send a test message to all enabled channels
		notifications.Notify(settingsJSON, "TEST", "🔔 Prueba de Notificación de Centralizegg: Todo funciona correctamente.", "")

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","message":"Test notification sent"}`))
	}).Methods("POST")

	// Dynamic Config APIs (Catch-all for simple key-value configs like nala-ia)
	// Defined here at the end to avoid shadowing specific endpoints like /api/config/servers
	r.HandleFunc("/api/config/{key}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		key := vars["key"]

		if r.Method == "GET" {
			val, err := db.GetConfigValue(key)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if val == "" {
				val = "{}"
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(val))
		} else if r.Method == "POST" {
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			err = db.SetConfigValue(key, string(body))
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusOK)
		}
	}).Methods("GET", "POST")

	// Static Files with Cache-Control
	fs := http.FileServer(http.Dir("./web_centralizegg/static/"))
	r.PathPrefix("/").Handler(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		path := req.URL.Path
		if strings.HasSuffix(path, ".js") || strings.HasSuffix(path, ".css") || strings.HasSuffix(path, ".png") || strings.HasSuffix(path, ".ico") || strings.HasSuffix(path, ".woff2") {
			w.Header().Set("Cache-Control", "public, max-age=31536000") // 1 year cache
		} else {
			// For HTML and other dynamic structures, avoid aggressive caching
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		}
		fs.ServeHTTP(w, req)
	}))

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
