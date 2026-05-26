# 🌟 Guías de Extensión de Código (Features)

Esta sección documenta los módulos de recolección en el backend Go, cómo operan y cómo puedes extender el código de Centralizegg para dar soporte a nuevas plataformas o agregar nuevas métricas.

---

## 🛠️ Catálogo de Colectores de Infraestructura

Los archivos recolectores se ubican en la carpeta `backend_internal_centralizegg/` organizados por especialidad:

### 1. Recolector Proxmox (`virtualization/proxmox-collector.go`)
- **Funcionamiento**: Se conecta vía SSH al punto de entrada configurado de Proxmox VE.
- **Resolución de IP única**: Ejecuta el comando `pvesh get /cluster/status --output-format json` para obtener la estructura del clúster mapeando cada nodo con su IP real e individual.
- **Inventario**: Consulta VMs QEMU y contenedores LXC mediante comandos `pvesh get /nodes/{node}/qemu` y `pvesh get /nodes/{node}/lxc`.

### 2. Recolector pfSense (`firewall/pfsense-collector.go`)
- **Funcionamiento**: Conexión SSH ligera y sin agentes.
- **Telemetría**: Ejecuta comandos como `top`, `sysctl`, y `netstat` en el shell nativo de pfSense.
- **Gateways**: Extrae estadísticas RTT y packet loss analizando la salida del servicio `dpinger`.

### 3. Recolectores Docker & Podman (`container/docker-collector.go` / `podman-collector.go`)
- **Funcionamiento**: Usan llamadas al API de Docker o CLI de Podman vía túneles SSH.
- **Podman**: Integrado con el icono de la foca (`fa-otter`) en toda la interfaz web.
- **Seguridad**: Ejecuta `docker scout cves` para obtener vulnerabilidades del sistema operativo base del contenedor.

### 4. Recolector Kubernetes (`container/kubernetes-collector.go`)
- **Funcionamiento**: Lee el archivo kubeconfig y hace consultas al API Server de Kubernetes.
- **Métricas**: Agrupa métricas de uso (CPU, RAM, red) y las organiza dinámicamente por namespaces y persistent volumes.

---

## 🏗️ Cómo Agregar una Nueva Característica o Módulo de Monitoreo

Si deseas agregar soporte para un nuevo tipo de servidor (ej. Servidores Windows con WinRM o bases de datos PostgreSQL remotas), sigue este flujo estructurado de extensión:

### Paso 1: Definir el Modelo en la Base de Datos
En `backend_internal_centralizegg/data_centralizegg/postgres.go`, agrega las tablas y funciones `Upsert` y `Get` para almacenar la información de los nuevos servidores. Asegúrate de incluir la migración automática (`ALTER TABLE`) para bases de datos existentes en la función `InitConfigSchema()`.

### Paso 2: Crear el Archivo Colector
Crea un nuevo archivo en el módulo de backend correspondiente (ej. `backend_internal_centralizegg/virtualization/windows-collector.go`):
1. Defina un struct recolector (ej. `type WindowsCollector struct`).
2. Defina el constructor que reciba la base de datos: `func NewWindowsCollector(db *data_centralizegg.DB) *WindowsCollector`.
3. Defina la función `CollectAll()` que recupere la lista de servidores y ejecute los comandos SSH o llamadas de API.
4. Implemente el ticker para ejecución periódica en `Start(interval time.Duration)`.

### Paso 3: Registrar el Colector en el Servidor
En `cmd_centralizegg/server/main.go`, importa el nuevo módulo, inicialízalo con la base de datos existente en el arranque de la app, y arranca su rutina:
```go
windowsCol := virtualization.NewWindowsCollector(db)
windowsCol.Start(5 * time.Second)
```

### Paso 4: Crear los Endpoints del API
En `cmd_centralizegg/server/main.go`, añade los handlers HTTP necesarios para que la UI consuma las nuevas métricas (ej. `/api/windows/hosts`).
