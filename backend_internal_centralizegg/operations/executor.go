package operations

import (
	"fmt"
	"io/ioutil"
	"strconv"
	"strings"
	"time"

	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
	"golang.org/x/crypto/ssh"
)

const errMissingServerID = "falta 'serverId'"

// AIActionRequest define la estructura de una acción sugerida por Nala
type AIActionRequest struct {
	Action string                 `json:"action"`
	Params map[string]interface{} `json:"params"`
}

// VMManager define lo necesario para controlar máquinas virtuales
type VMManager interface {
	StartVM(serverID int64, vmName string) error
	StopVM(serverID int64, vmName string) error
}

// ContainerManager define lo necesario para controlar contenedores
type ContainerManager interface {
	StartContainer(serverID int64, containerID string) error
	StopContainer(serverID int64, containerID string) error
}

// ActionExecutor coordina la ejecución de acciones proactivas
type ActionExecutor struct {
	DB     *data_centralizegg.DB
	KVM    VMManager
	Docker ContainerManager
	Podman ContainerManager
}

// Execute procesa la acción solicitada
func (ae *ActionExecutor) Execute(req AIActionRequest) (interface{}, error) {
	switch req.Action {
	case "kvm.vm.start":
		return nil, ae.handleKVM(req.Params, true)
	case "kvm.vm.stop":
		return nil, ae.handleKVM(req.Params, false)
	case "docker.container.start":
		return nil, ae.handleContainer(req.Params, "docker", true)
	case "docker.container.stop":
		return nil, ae.handleContainer(req.Params, "docker", false)
	case "podman.container.start":
		return nil, ae.handleContainer(req.Params, "podman", true)
	case "podman.container.stop":
		return nil, ae.handleContainer(req.Params, "podman", false)
	case "system.ssh.audit":
		return ae.AuditSSHSecurity(req.Params)
	case "system.patch.apply":
		return ae.ApplySecurityPatches(req.Params)
	default:
		return nil, fmt.Errorf("acción no soportada: %s", req.Action)
	}
}

// --- VM & Container Handlers ---

func (ae *ActionExecutor) handleKVM(params map[string]interface{}, start bool) error {
	sID, target, err := parseBaseParams(params)
	if err != nil {
		return err
	}
	if ae.KVM == nil {
		return fmt.Errorf("KVM Manager no inicializado")
	}
	if start {
		return ae.KVM.StartVM(sID, target)
	}
	return ae.KVM.StopVM(sID, target)
}

func (ae *ActionExecutor) handleContainer(params map[string]interface{}, engine string, start bool) error {
	sID, target, err := parseBaseParams(params)
	if err != nil {
		return err
	}
	var mgr ContainerManager
	if engine == "docker" {
		mgr = ae.Docker
	} else {
		mgr = ae.Podman
	}
	if mgr == nil {
		return fmt.Errorf("%s Manager no inicializado", engine)
	}
	if start {
		return mgr.StartContainer(sID, target)
	}
	return mgr.StopContainer(sID, target)
}

// --- Security Audit Logic ---

type SSHAuditReport struct {
	Hostname  string            `json:"hostname"`
	Issues    []string          `json:"issues"`
	Score     int               `json:"score"` // 0-100
	Summary   string            `json:"summary"`
	RawConfig map[string]string `json:"raw_config"`
}

func (ae *ActionExecutor) AuditSSHSecurity(params map[string]interface{}) (*SSHAuditReport, error) {
	sIDRaw, ok := params["serverId"]
	if !ok {
		return nil, fmt.Errorf(errMissingServerID)
	}
	serverID := int64(sIDRaw.(float64))

	// Intentar obtener el servidor de cualquier tipo (simplificado aquí buscando en KVM o Generic)
	// Para este MVP asumimos que el serverID y tipo están disponibles o buscamos unificado.
	// El collector de Docker/KVM ya tiene IDs únicos.

	client, hostname, err := ae.getSSHClientForServer(serverID)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	defer session.Close()

	// Leer configuración clave de SSH
	cmd := `grep -E "^(PermitRootLogin|PasswordAuthentication|Port|Protocol|Ciphers|PubkeyAuthentication|MaxAuthTries)" /etc/ssh/sshd_config`
	output, _ := session.Output(cmd)
	lines := strings.Split(string(output), "\n")

	report := &SSHAuditReport{
		Hostname:  hostname,
		Issues:    []string{},
		RawConfig: make(map[string]string),
		Score:     100,
	}

	for _, line := range lines {
		parts := strings.Fields(line)
		if len(parts) >= 2 {
			report.RawConfig[parts[0]] = parts[1]
		}
	}

	// Análisis de reglas
	if val, ok := report.RawConfig["PermitRootLogin"]; ok && (val == "yes" || val == "prohibit-password") {
		report.Issues = append(report.Issues, "PermitRootLogin está habilitado o permite root con password (recomendado: no)")
		report.Score -= 20
	}
	if val, ok := report.RawConfig["PasswordAuthentication"]; ok && val == "yes" {
		report.Issues = append(report.Issues, "PasswordAuthentication está habilitado (recomendado: no, usar llaves SSH)")
		report.Score -= 30
	}
	if val, ok := report.RawConfig["Port"]; ok && val == "22" {
		report.Issues = append(report.Issues, "Usa el puerto por defecto 22 (recomendado: cambiar para mitigar ataques de fuerza bruta)")
		report.Score -= 10
	}
	if val, ok := report.RawConfig["MaxAuthTries"]; ok {
		tries, _ := strconv.Atoi(val)
		if tries > 4 {
			report.Issues = append(report.Issues, fmt.Sprintf("MaxAuthTries es elevado (%d), recomendado <= 3", tries))
			report.Score -= 10
		}
	}

	if len(report.Issues) == 0 {
		report.Summary = "Configuración SSH excelente y robusta."
	} else {
		report.Summary = fmt.Sprintf("Se encontraron %d vulnerabilidades potenciales de configuración.", len(report.Issues))
	}

	return report, nil
}

// --- Patch Management Logic ---

func (ae *ActionExecutor) ApplySecurityPatches(params map[string]interface{}) (string, error) {
	sIDRaw, ok := params["serverId"]
	if !ok {
		return "", fmt.Errorf(errMissingServerID)
	}
	serverID := int64(sIDRaw.(float64))

	client, _, err := ae.getSSHClientForServer(serverID)
	if err != nil {
		return "", err
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	// Detectar gestor de paquetes y aplicar parches
	// Usamos DEBIAN_FRONTEND=noninteractive para apt
	cmd := `
		if command -v apt-get >/dev/null; then
			export DEBIAN_FRONTEND=noninteractive
			sudo apt-get update && sudo apt-get upgrade -y --only-upgrade
		elif command -v dnf >/dev/null; then
			sudo dnf upgrade -y --security
		elif command -v yum >/dev/null; then
			sudo yum upgrade -y --security
		else
			echo "Gestor de paquetes no soportado."
			exit 1
		fi
	`
	output, err := session.CombinedOutput(cmd)
	if err != nil {
		return string(output), fmt.Errorf("error al aplicar parches: %w", err)
	}

	return string(output), nil
}

// --- Helpers ---

func (ae *ActionExecutor) getSSHClientForServer(serverID int64) (*ssh.Client, string, error) {
	// Intentar obtener detalles del servidor desde la DB
	// Nota: GetServers() devuelve KVMServer, GetGenericServers() devuelve otros.
	// Buscamos primero en KVM
	kvmServers, _ := ae.DB.GetServers()
	for _, s := range kvmServers {
		if s.ID == serverID {
			client, err := dialSSH(s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyContent, s.SSHKeyPath)
			return client, s.Name, err
		}
	}

	// Si no, buscar en servidores genéricos (Docker, Podman, K8s, etc.)
	types := []string{"docker", "podman", "kubernetes", "proxmox", "nas", "ceph", "pfsense"}
	for _, t := range types {
		genericServers, _ := ae.DB.GetGenericServers(t)
		for _, s := range genericServers {
			if s.ID == serverID {
				client, err := dialSSH(s.IPAddress, s.SSHPort, s.Username, s.Password, s.SSHKeyContent, s.SSHKeyPath)
				return client, s.Name, err
			}
		}
	}

	return nil, "", fmt.Errorf("servidor con ID %d no encontrado en ninguna categoría", serverID)
}

func dialSSH(ip string, port int, user, pass, keyContent, keyPath string) (*ssh.Client, error) {
	var authMethods []ssh.AuthMethod
	if pass != "" {
		authMethods = append(authMethods, ssh.Password(pass))
	}
	if keyContent != "" {
		signer, err := ssh.ParsePrivateKey([]byte(keyContent))
		if err == nil {
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		}
	} else if keyPath != "" {
		key, err := ioutil.ReadFile(keyPath)
		if err == nil {
			signer, err := ssh.ParsePrivateKey(key)
			if err == nil {
				authMethods = append(authMethods, ssh.PublicKeys(signer))
			}
		}
	}

	if port == 0 {
		port = 22
	}

	config := &ssh.ClientConfig{
		User:            user,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", ip, port)
	return ssh.Dial("tcp", addr, config)
}

func parseBaseParams(params map[string]interface{}) (int64, string, error) {
	sIDRaw, ok := params["serverId"]
	if !ok {
		return 0, "", fmt.Errorf(errMissingServerID)
	}
	var sID int64
	switch v := sIDRaw.(type) {
	case float64:
		sID = int64(v)
	case string:
		sID, _ = strconv.ParseInt(v, 10, 64)
	}

	targetRaw, ok := params["target"]
	if !ok {
		// Fallback
		if vm, ok := params["vmName"].(string); ok {
			targetRaw = vm
		} else if cont, ok := params["containerId"].(string); ok {
			targetRaw = cont
		}
	}
	target, ok := targetRaw.(string)
	if !ok || target == "" {
		return 0, "", fmt.Errorf("falta 'target' (o vmName/containerId)")
	}

	return sID, target, nil
}
