package main

import (
	"database/sql"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"golang.org/x/crypto/ssh"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for the dashboard
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type ServerCredentials struct {
	IPAddress     string
	SSHPort       int
	Username      string
	Password      string
	SSHKeyPath    string
	SSHKeyContent string
}

func getCredentialsForServer(db *sql.DB, category string, serverID int64) (*ServerCredentials, error) {
	var table string
	switch category {
	case "kvm":
		table = "virtualization.kvm_servers"
	case "docker":
		table = "containers.docker_servers"
	case "podman":
		table = "containers.podman_servers"
	case "proxmox":
		table = "virtualization.proxmox_servers"
	default:
		return nil, fmt.Errorf("unsupported category for terminal: %s", category)
	}

	query := fmt.Sprintf(`SELECT ip_address, ssh_port, username, password, ssh_key_path, ssh_key_content FROM %s WHERE id = $1`, table)

	var creds ServerCredentials
	var pass, keyPath, keyContent sql.NullString
	err := db.QueryRow(query, serverID).Scan(&creds.IPAddress, &creds.SSHPort, &creds.Username, &pass, &keyPath, &keyContent)
	if err != nil {
		return nil, err
	}
	if pass.Valid {
		creds.Password = pass.String
	}
	if keyPath.Valid {
		creds.SSHKeyPath = keyPath.String
	}
	if keyContent.Valid {
		creds.SSHKeyContent = keyContent.String
	}
	return &creds, nil
}

func connectSSH(creds *ServerCredentials) (*ssh.Client, error) {
	var authMethods []ssh.AuthMethod

	if creds.Password != "" {
		authMethods = append(authMethods, ssh.Password(creds.Password))
	}

	// Always try key if present (default or custom)
	if creds.SSHKeyContent != "" {
		signer, err := ssh.ParsePrivateKey([]byte(creds.SSHKeyContent))
		if err == nil {
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		}
	} else if creds.SSHKeyPath != "" {
		key, err := ioutil.ReadFile(creds.SSHKeyPath)
		if err == nil {
			signer, err := ssh.ParsePrivateKey(key)
			if err == nil {
				authMethods = append(authMethods, ssh.PublicKeys(signer))
			}
		}
	}

	config := &ssh.ClientConfig{
		User:            creds.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // Bypass host key check
		Timeout:         10 * time.Second,
	}

	ip := creds.IPAddress
	if host, _, err := net.SplitHostPort(ip); err == nil {
		ip = host
	}
	port := creds.SSHPort
	if port == 0 {
		port = 22
	}
	addr := fmt.Sprintf("%s:%d", ip, port)

	return ssh.Dial("tcp", addr, config)
}

type TerminalMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Rows int    `json:"rows,omitempty"`
	Cols int    `json:"cols,omitempty"`
}

func TerminalHandler(db *data_centralizegg.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		category := vars["category"]
		serverIDStr := vars["serverId"]
		targetName := vars["targetName"] // VM name, Container ID, or Proxmox VMID

		var serverID int64
		fmt.Sscanf(serverIDStr, "%d", &serverID)

		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WebSocket Upgrade error: %v", err)
			return
		}
		defer ws.Close()

		creds, err := getCredentialsForServer(db.Conn, category, serverID)
		if err != nil {
			ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nError getting server credentials: %v\r\n", err)))
			return
		}

		sshClient, err := connectSSH(creds)
		if err != nil {
			ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nSSH Connection failed: %v\r\n", err)))
			return
		}
		defer sshClient.Close()

		session, err := sshClient.NewSession()
		if err != nil {
			ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to create SSH session: %v\r\n", err)))
			return
		}
		defer session.Close()

		stdin, err := session.StdinPipe()
		if err != nil {
			return
		}
		stdout, err := session.StdoutPipe()
		if err != nil {
			return
		}
		session.StderrPipe() // Ignore stderr or wrap it to stdout

		if err := session.RequestPty("xterm", 24, 80, ssh.TerminalModes{
			ssh.ECHO:          1,
			ssh.TTY_OP_ISPEED: 14400,
			ssh.TTY_OP_OSPEED: 14400,
		}); err != nil {
			ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to request PTY: %v\r\n", err)))
			return
		}

		// Build the exec command based on category
		var cmd string
		switch category {
		case "kvm":
			cmd = fmt.Sprintf("virsh console %s", targetName)
		case "docker":
			cmd = fmt.Sprintf("docker exec -it %s /bin/sh -c 'if command -v bash >/dev/null 2>&1; then bash; else sh; fi'", targetName)
		case "podman":
			cmd = fmt.Sprintf("podman exec -it %s /bin/sh -c 'if command -v bash >/dev/null 2>&1; then bash; else sh; fi'", targetName)
		default:
			ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nUnsupported category: %s\r\n", category)))
			return
		}

		if err := session.Start(cmd); err != nil {
			ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to start command: %v\r\n", err)))
			return
		}

		// Read from WebSocket, Write to SSH
		go func() {
			for {
				_, msg, err := ws.ReadMessage()
				if err != nil {
					break
				}
				stdin.Write(msg)
			}
		}()

		// Read from SSH, Write to WebSocket
		buf := make([]byte, 1024)
		for {
			n, err := stdout.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("SSH read error: %v", err)
				}
				break
			}
			if err := ws.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				break
			}
		}

		ws.WriteMessage(websocket.TextMessage, []byte("\r\n[Console Session Ended]\r\n"))
	}
}
