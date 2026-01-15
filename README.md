# Centralizegg

<div align="center">
  <img src="web_centralizegg/static/logo.png" alt="Centralizegg Logo" width="120">
</div>

<div align="center">
  <img src="web_centralizegg/static/image/1.png" alt="Centralizegg Dashboard" width="800">
</div>

[🇨🇴 Español](#español) | 

---

<a name="español"></a>
# 🇨🇴 Centralizegg

**Centralizegg** es una solución de monitoreo ligera y containerizada para múltiples servidores KVM. Proporciona un dashboard premium en tiempo real para visualizar los recursos de tus hosts y el estado de las máquinas virtuales (VMs) de forma centralizada.

## 📋 Tabla de Contenidos

- [Características Principales](#-características-principales)
- [Arquitectura](#-arquitectura)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Instalación Rápida](#-instalación-rápida)
- [Configuración](#-configuración)
- [API REST](#-api-rest)
- [Base de Datos](#-base-de-datos)
- [Funcionalidades del Frontend](#-funcionalidades-del-frontend)
- [Desarrollo](#-desarrollo)
- [Troubleshooting](#-troubleshooting)
- [Tech Stack](#️-tech-stack)

## ✨ Características Principales

*   **Detección de SO**: Identificación automática del Sistema Operativo de cada host mediante `/etc/os-release` con iconos representativos (Ubuntu, Debian, Fedora, CentOS, Windows, Red Hat, SUSE).
*   **Métricas Premium**: Ventanas flotantes (popovers) interactivas para CPU y Memoria con barras de progreso en tiempo real.
*   **Colector Automático**: Recopilación de métricas cada 10 segundos desde todos los servidores configurados.
*   **Métricas Completas**: 
    - CPU: Uso calculado basado en tiempo de CPU acumulado
    - Memoria: Total, libre y utilizada
    - Memoria: Total, libre y utilizada
    - **Almacenamiento (NAS)**: Monitoreo vía SSH de servidores Linux/NAS:
        - Inventario de discos (`lsblk`) y particiones.
        - Gráficos de barra para uso de volúmenes montados.
        - Alertas de capacidad por volumen.
    - Red: Tráfico RX/TX con **Sparklines** en tiempo real.
    - **Interfaces Bridge**: Monitoreo dedicado de estados y tráfico para puentes de red (`br0`, `virbr0`, etc.).
    - Estado de VMs: Running, Blocked, Paused, Shutdown, Shutoff, Crashed, Suspended
*   **Monitoreo de Contenedores**: Soporte avanzado para **Docker & Podman**.
    - **Mapa de Topología**: Visualización interactiva animada de la red (Contenedores -> Redes -> Internet).
    - **Monitoreo de GPU**: Carga, temperatura y VRAM para GPUs NVIDIA mediante `nvidia-smi`.
    - **Seguridad (CVE)**: Escaneo automático de vulnerabilidades en imágenes con `docker scout`.
    - **Almacenamiento**: Detalle de `/var/lib/docker`, inodos y tamaños de volúmenes individuales.
*   **Monitoreo de Firewall**: Soporte completo para **pfSense** vía SSH.
    - Métricas de sistema (CPU, Memoria, Disco)
    - Información de interfaces de red con estadísticas de tráfico
    - Detección de arquitectura multi-plataforma (x86_64, ARM/AArch64) con insignias visuales.
*   **QEMU Guest Agent**: Integración avanzada para obtener telemetría detallada del sistema invitado:
    - Nombre y versión del Sistema Operativo
    - Direcciones IP internas
*   **Visualización Multi-Disco**: Barras de uso individuales para cada disco virtual adjunto a la VM.
*   **Mapa de Tráfico Mundial**: Visualización geográfica premium con animaciones "Flight Path" (Bezier curvos).
    - **GeoIP Proxy Integrado**: Resolución de IPs backend para privacidad y seguridad (evita Mixed Content).
    - **Animaciones Fluidas**: Líneas curvas con pulso dinámico (Rojo: Entrante, Verde: Saliente).
    - **Modo Depuración**: Overlay accesible desde la UI para diagnosticar la resolución de IPs.
*   **Monitoreo de Gateways**: Estado en tiempo real de los gateways de pfSense (WAN/VPN).
    - **Alertas Visuales**: 
        - ⚠️ Advertencia (>0% Pérdida de paquetes): Resaltado ámbar.
        - 🚨 Crítico (>10% Pérdida de paquetes): **Animación de pulso rojo** y sombras dinámicas para atención inmediata.
    - Métricas precisas de RTT y Desviación estándar.
*   **Sparklines de Red**: Gráficos lineales en tiempo real para visualizar tendencias de tráfico RX/TX.
*   **Filtrado Inteligente**: Selecciona un host para filtrar instantáneamente su cuadrícula de máquinas virtuales.
*   **Búsqueda Global ("Search Everything")**:
    - Barra de búsqueda unificada que indexa **KVM Hosts, VMs, Contenedores Docker/Podman y Volúmenes NAS**.
    - Navegación inteligente: Al seleccionar un resultado, cambia automáticamente a la herramienta correspondiente.
    - Acceso rápido mediante atajo de teclado o botón dedicado.
*   **Logs Unificados**: Panel lateral deslizable para ver logs de todos los sistemas (KVM, Docker, NAS) en un solo lugar.
*   **Orden Alfabético**: Organización automática de hosts y VMs para una navegación más rápida.
*   **Notificaciones**: Sistema de notificaciones para servidores offline.
*   **Navegación Optimizada**: Acceso rápido a la configuración y cambio de herramientas desde la barra superior.
*   **Web-Based Config**: Añade, edita o elimina servidores KVM directamente desde el dashboard.
*   **Seguridad**: Soporte para puertos SSH personalizados y autenticación robusta (Clave/Contraseña).
*   **Auto-refresh**: Actualización automática de datos cada 5 segundos en el frontend.

## 🏗️ Arquitectura

Centralizegg sigue una arquitectura de tres capas: Frontend, Backend API y Base de Datos, con un colector de datos que se ejecuta en segundo plano.

```mermaid
graph TD
    subgraph Frontend["Frontend (Vanilla JS)"]
        UI[Dashboard Web]
        Search[Búsqueda Global]
        Config[Configuración UI]
    end
    
    subgraph Backend["Backend (Go)"]
        API[API REST<br/>Gorilla Mux]
        Collector[Colector Unificado<br/>KVM + pfSense + Docker + NAS]
        Libvirt[Libvirt Client]
        SSH[SSH Client]
        Docker[Docker SSH Client]
        pfSense[pfSense Client]
        NAS["NAS Client (SSH)"]
    end
    
    subgraph Database["Base de Datos"]
        PG[(PostgreSQL)]
        Schema[Esquema virtualization]
    end
    
    subgraph Remote["Servidores Remotos"]
        KVM1[Servidor KVM 1]
        KVM2[Servidor KVM 2]
        KVMN[Servidor KVM N]
        pfSense1[pfSense 1]
        pfSense2[pfSense 2]
        NAS1[NAS Server 1]
    end
    
    UI -->|HTTP Requests| API
    Search -->|HTTP Requests| API
    Config -->|HTTP Requests| API
    API -->|Query/Insert/Update| PG
    
    Collector -->|Query| PG
    
    Collector -->|"SSH Tunnel (KVM)"| SSH
    SSH -->|Unix Socket| Libvirt
    Libvirt -->|Libvirt Protocol| KVM1
    Libvirt -->|Libvirt Protocol| KVM2
    Libvirt -->|Libvirt Protocol| KVMN
    
    Collector -->|"SSH Tunnel (pfSense)"| pfSense
    pfSense -->|SSH Commands| pfSense1
    pfSense -->|SSH Commands| pfSense2

    Collector -->|"SSH Tunnel (NAS)"| NAS
    NAS -->|SSH Commands (df, lsblk)| NAS1
    
    Collector -->|Upsert Data| PG
    PG -->|Response| API
    API -->|JSON Response| UI
```

### Flujo de Datos

1. **Colector de Datos**: Se ejecuta cada 10 segundos en segundo plano
   - Obtiene lista de servidores configurados desde la base de datos
   - Para cada servidor, establece conexión SSH
   - Crea túnel SSH hacia el socket de Libvirt (`/var/run/libvirt/libvirt-sock`)
   - Recopila información del host (CPU, memoria, SO)
   - Enumera todas las VMs y recopila sus métricas
   - Calcula uso de CPU basado en tiempo acumulado
   - Almacena/actualiza datos en PostgreSQL
4. **Monitoreo de Docker**:
   - Inspección de redes para generar el mapa de topología.
   - Recopilación de estadísticas de contenedores (CPU, RAM, Red, I/O).
   - Escaneo de vulnerabilidades y monitoreo de GPU.

2. **API REST**: Procesa peticiones del frontend
   - `GET /api/hosts` - Retorna hosts con información completa
   - `GET /api/vms` - Retorna todas las VMs
   - `GET/POST/PUT/DELETE /api/config/servers` - Gestión de servidores

3. **Frontend**: Interfaz de usuario reactiva
   - Auto-refresh cada 5 segundos
   - Búsqueda en tiempo real
   - Filtrado por host seleccionado
   - Popovers interactivos para métricas detalladas

## 📁 Estructura del Proyecto

```
Centralizegg/
├── cmd_centralizegg/
│   └── server/
│       └── main.go                 # Punto de entrada de la aplicación
├── backend_internal_centralizegg/
│   ├── data_centralizegg/
│   │   └── postgres.go            # Capa de acceso a datos (PostgreSQL)
│   ├── virtualization/
│   │   └── kvm-collector.go       # Colector de métricas KVM
│   ├── firewall/
│   │   └── pfsense-collector.go   # Colector de métricas pfSense (SSH)
│   └── container/
│       └── docker-collector.go    # Colector de métricas Docker/Podman
├── web_centralizegg/
│   └── static/
│       ├── index.html             # Interfaz principal
│       ├── app.js                 # Lógica del frontend
│       ├── style.css              # Estilos glassmorphism
│       ├── logo.png
│       └── image/
│           └── 1.png              # Screenshot del dashboard
├── deploy_centralizegg/
│   └── postgres/
│       └── init.sql               # Script de inicialización de BD
├── docker-compose.yml             # Configuración de servicios
├── Dockerfile                     # Imagen del contenedor
├── go.mod                         # Dependencias Go
└── README.md
```

## 🚀 Instalación Rápida

### Requisitos Previos

*   Docker y Docker Compose
*   Acceso SSH (vía clave o contraseña) a los servidores KVM
*   Los servidores KVM deben tener Libvirt configurado y accesible
*   **Opcional**: Instalar `qemu-guest-agent` en las VMs para detección de SO e IPs.

### Configuración de Seguridad (SSH)
1. Asegúrate de que tu clave está en `~/.ssh/id_rsa`.
2. El contenedor monta este directorio como solo lectura por defecto.

> [!IMPORTANT]
> **Permisos de Archivo**: Asegúrate de que tu clave privada tenga permisos estrictos (chmod 600), o el cliente SSH rechazará usarla por seguridad.
> ```bash
> chmod 600 ~/.ssh/id_rsa
> ```

### Despliegue

```bash
# Clonar el repositorio (si aplica)
git clone <repository-url>
cd Centralizegg

# Iniciar servicios
docker-compose up -d --build

# Ver logs
docker-compose logs -f app
```

Accede al dashboard en: `http://localhost:8080`

## ⚙️ Configuración

### Variables de Entorno

El servicio `app` en `docker-compose.yml` utiliza las siguientes variables de entorno:

```yaml
DB_HOST: db                    # Host de PostgreSQL
DB_PORT: 5432                  # Puerto de PostgreSQL
DB_USER: centralizegg          # Usuario de la base de datos
DB_PASS: centralizegg_secret   # Contraseña de la base de datos
DB_NAME: centralizegg_db       # Nombre de la base de datos
LIBVIRT_SOCK: /var/run/libvirt/libvirt-sock  # Socket de Libvirt (local)
```

### Volúmenes Montados

- `/var/run/libvirt/libvirt-sock:/var/run/libvirt/libvirt-sock` - Socket de Libvirt (para conexiones locales)
- `~/.ssh:/root/.ssh:ro` - Claves SSH (solo lectura)

### Configuración de Servidores

Los servidores KVM se configuran a través del dashboard web:

1. Accede a `http://localhost:8080`
2. Selecciona la herramienta "KVM" en el menú
3. Haz clic en el botón de configuración (⚙️)
4. Agrega un nuevo servidor con:
   - **Nombre**: Nombre descriptivo
   - **IP Address**: Dirección IP del servidor
   - **SSH Port**: Puerto SSH (default: 22)
   - **Username**: Usuario SSH
   - **Autenticación**: Clave SSH o contraseña
   - **SSH Key Path**: Ruta a la clave (default: `/root/.ssh/id_rsa`)

### Configuración de Firewall (pfSense)

1. Selecciona la herramienta "Firewall" en el menú
2. Haz clic en el botón de configuración (⚙️)
3. Agrega un nuevo servidor con credenciales SSH (similar a KVM).
   - **Autenticación**: Soporta Clave SSH (RSA/Ed25519) o Contraseña.
   - **Requisitos**: El usuario debe tener acceso al shell (`/bin/sh` o `/bin/tcsh`) y permisos para ejecutar `top`, `sysctl`, `netstat`, `pfctl`.
   - **No requiere agentes**: Todo se recopila de forma remota y segura.

## 🔌 API REST

Centralizegg expone una API REST para acceder a los datos y gestionar la configuración.

### Endpoints

#### `GET /api/hosts`

Obtiene la lista de todos los hosts monitoreados con sus métricas.

**Respuesta:**
```json
[
  {
    "id": 1,
    "server_id": 1,
    "hostname": "kvm-server-01",
    "server_name": "Production Server 1",
    "ip_address": "192.168.1.100",
    "cpu_model": "Intel Core i7",
    "cpu_cores": 8,
    "total_memory": 17179869184,
    "free_memory": 8589934592,
    "cpu_usage": 45.5,
    "os_name": "Ubuntu 22.04 LTS"
  }
]
```

#### `GET /api/vms`

Obtiene la lista de todas las máquinas virtuales.

**Respuesta:**
```json
[
  {
    "id": 1,
    "name": "web-server-01",
    "state": "Running",
    "vcpu": 2,
    "cpu_time": 1234567890,
    "cpu_usage": 25.3,
    "memory_usage": 2147483648,
    "max_memory": 4294967296,
    "disk_allocation": 10737418240,
    "disk_capacity": 21474836480,
    "disk_read": 1024000,
    "disk_write": 2048000,
    "net_rx": 52428800,
    "net_tx": 104857600,
    "guest_ips": "192.168.1.50, fe80::1",
    "guest_fs_usage": "",
    "host_id": 1,
    "updated_at": "2026-01-15T10:30:00Z"
  }
]
```

#### `GET /api/config/servers`

Obtiene la lista de servidores configurados.

**Respuesta:**
```json
[
  {
    "id": 1,
    "name": "Production Server 1",
    "ip_address": "192.168.1.100",
    "ssh_port": 22,
    "username": "root",
    "password": "",
    "ssh_key_path": "/root/.ssh/id_rsa",
    "status": "online"
  }
]
```

#### `POST /api/config/servers`

Agrega un nuevo servidor KVM.

**Request Body:**
```json
{
  "name": "Production Server 1",
  "ip_address": "192.168.1.100",
  "ssh_port": 22,
  "username": "root",
  "password": "optional-password",
  "ssh_key_path": "/root/.ssh/id_rsa"
}
```

**Respuesta:**
```json
{
  "id": 1,
  "name": "Production Server 1",
  "ip_address": "192.168.1.100",
  "ssh_port": 22,
  "username": "root",
  "password": "",
  "ssh_key_path": "/root/.ssh/id_rsa",
  "status": "unknown"
}
```

#### `PUT /api/config/servers/{id}`

Actualiza la configuración de un servidor existente.

**Request Body:**
```json
{
  "name": "Production Server 1 Updated",
  "ip_address": "192.168.1.100",
  "ssh_port": 2222,
  "username": "admin",
  "password": "",
  "ssh_key_path": "/root/.ssh/id_rsa"
}
```

**Nota**: Si `password` está vacío, no se actualizará la contraseña existente.

#### `DELETE /api/config/servers/{id}`

Elimina un servidor de la configuración.

**Respuesta**: `200 OK`

#### `GET /api/firewall/servers`
Obtiene servidores pfSense configurados.

#### `POST /api/firewall/servers`
Agrega un nuevo servidor pfSense.

#### `PUT/DELETE /api/firewall/servers/{id}`
Actualiza o elimina servidores pfSense.

## 🗄️ Base de Datos

Centralizegg utiliza PostgreSQL con esquemas dedicados `virtualization` y `firewall`.

### Esquema

#### Tabla: `virtualization.kvm_servers`

Almacena la configuración de los servidores KVM.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | ID único |
| `name` | VARCHAR(255) | Nombre descriptivo |
| `ip_address` | VARCHAR(255) | Dirección IP |
| `ssh_port` | INT | Puerto SSH (default: 22) |
| `username` | VARCHAR(255) | Usuario SSH |
| `password` | VARCHAR(255) | Contraseña (opcional) |
| `ssh_key_path` | VARCHAR(255) | Ruta a la clave SSH |
| `status` | VARCHAR(50) | Estado: online, offline, unknown |
| `created_at` | TIMESTAMP | Fecha de creación |

#### Tabla: `virtualization.hosts`

Almacena información de los hosts físicos.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | ID único |
| `server_id` | INT | FK a `kvm_servers.id` |
| `hostname` | VARCHAR(255) | Nombre del host |
| `cpu_model` | VARCHAR(255) | Modelo de CPU |
| `cpu_cores` | INT | Número de cores |
| `total_memory` | BIGINT | Memoria total (bytes) |
| `free_memory` | BIGINT | Memoria libre (bytes) |
| `cpu_usage` | DOUBLE PRECISION | Uso de CPU (%) |
| `os_name` | VARCHAR(255) | Nombre del SO |
| `created_at` | TIMESTAMP | Fecha de creación |

#### Tabla: `virtualization.vms`

Almacena información de las máquinas virtuales.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | ID único |
| `name` | VARCHAR(255) | Nombre de la VM |
| `state` | VARCHAR(50) | Estado: Running, Blocked, Paused, etc. |
| `vcpu` | INT | Número de vCPUs |
| `cpu_time` | BIGINT | Tiempo de CPU acumulado (ns) |
| `cpu_usage` | DOUBLE PRECISION | Uso de CPU (%) |
| `memory_usage` | BIGINT | Memoria utilizada (bytes) |
| `max_memory` | BIGINT | Memoria máxima (bytes) |
| `disk_allocation` | BIGINT | Disco asignado (bytes) |
| `disk_capacity` | BIGINT | Capacidad de disco (bytes) |
| `disk_read` | BIGINT | Bytes leídos |
| `disk_write` | BIGINT | Bytes escritos |
| `net_rx` | BIGINT | Tráfico recibido (bytes) |
| `net_tx` | BIGINT | Tráfico enviado (bytes) |
| `guest_ips` | TEXT | IPs del guest (QEMU Agent) |
| `guest_fs_usage` | TEXT | Uso de filesystem (reservado) |
| `host_id` | INT | FK a `hosts.id` |
| `updated_at` | TIMESTAMP | Última actualización |

### Relaciones

- `hosts.server_id` → `kvm_servers.id` (ON DELETE CASCADE)
- `vms.host_id` → `hosts.id` (ON DELETE CASCADE)

### Índices

- `idx_vms_name` en `vms.name`
- `idx_hosts_server` en `hosts.server_id`

### Esquema Firewall

#### Tabla: `firewall.pfsense_servers`
Almacena configuración de servidores pfSense (similar a `kvm_servers`).

#### Tabla: `firewall.hosts`
Almacena métricas de hosts pfSense.

#### Tabla: `firewall.interfaces`
Almacena estadísticas de interfaces de red de pfSense.

## 🎨 Funcionalidades del Frontend

### Interfaz de Usuario

- **Diseño Glassmorphism**: Efecto de vidrio esmerilado con tema oscuro
- **Responsive**: Adaptable a diferentes tamaños de pantalla
- **Animaciones**: Transiciones suaves y efectos visuales

### Características Principales

1. **Búsqueda Global**
   - Búsqueda en tiempo real de hosts y VMs
   - Sugerencias con navegación por teclado (↑↓ Enter)
   - Filtrado instantáneo de resultados

2. **Visualización de Hosts**
   - Tarjetas con métricas de CPU, memoria y disco
   - **Layout Optimizado**: Información dividida en dos columnas:
       - **Sistema y Red**: OS, Uptime, Temperatura, IPs y Bridges.
       - **Almacenamiento**: Gráficos de disco (Donut Charts) y alertas OOM.
   - Indicadores de estado (online/offline)
   - Iconos de SO según distribución detectada

3. **Visualización de VMs**
   - Grid de tarjetas con estado visual
    - Métricas de CPU, memoria, disco (multi-disco) y red (sparklines)
    - IPs de guest y Nombre de SO (requiere Guest Agent)
    - Colores dinámicos y badge de "Power-On" verde o rojo según estado

4. **Configuración**
   - Modal para agregar/editar/eliminar servidores
   - Soporte para autenticación por clave o contraseña
   - Lista de servidores con estado en tiempo real

5. **Notificaciones**
   - Badge con contador de servidores offline
   - Dropdown con lista de servidores no accesibles
   - Actualización automática

6. **Auto-refresh**
   - Actualización automática cada 5 segundos
   - Indicador de última actualización

5. **Docker / Podman**
   - Mapa de red SVG reactivo con animaciones de flujo.
   - Detalles de IP al pasar el mouse por los contenedores.
   - Monitoreo persistente de GPU NVIDIA.
   - Listado de volúmenes con ordenamiento por tamaño.

6. **Notificaciones & Logs**
   - Registro unificado de éxito en la recolección para todas las herramientas.
   - Badge con contador de servidores offline.

## 💻 Desarrollo

### Requisitos

- **Go**: 1.23.2 o superior
- **PostgreSQL**: 15 o superior
- **Docker** y **Docker Compose** (para desarrollo con contenedores)

### Dependencias Principales

```go
github.com/gorilla/mux          // Router HTTP
github.com/lib/pq               // Driver PostgreSQL
github.com/digitalocean/go-libvirt  // Cliente Libvirt
golang.org/x/crypto             // SSH
github.com/beevik/etree         // Parser XML
```

### Desarrollo Local

1. **Configurar base de datos local:**
```bash
# Iniciar solo PostgreSQL
docker-compose up -d db

# O usar PostgreSQL local
createdb centralizegg_db
```

2. **Configurar variables de entorno:**
```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=centralizegg
export DB_PASS=centralizegg_secret
export DB_NAME=centralizegg_db
```

3. **Ejecutar migraciones:**
```bash
psql -U centralizegg -d centralizegg_db -f deploy_centralizegg/postgres/init.sql
```

4. **Compilar y ejecutar:**
```bash
go mod download
go build -o centralizegg ./cmd_centralizegg/server
./centralizegg
```

5. **Desarrollo del frontend:**
   - Los archivos estáticos están en `web_centralizegg/static/`
   - Edita `index.html`, `app.js` o `style.css`
   - Recarga el navegador para ver cambios

### Estructura del Código

- **`cmd_centralizegg/server/main.go`**: Punto de entrada, configuración de rutas API
- **`backend_internal_centralizegg/data_centralizegg/postgres.go`**: Acceso a datos, queries SQL
- **`backend_internal_centralizegg/virtualization/kvm-collector.go`**: Lógica de recopilación de métricas

## 🔧 Troubleshooting

### Problemas de Conexión SSH

**Error**: `ssh dial: connection refused`
- Verifica que el servidor esté accesible desde el contenedor
- Revisa el puerto SSH configurado
- Verifica que el firewall permita conexiones SSH

**Error**: `ssh dial: authentication failed`
- Verifica que la clave SSH esté en `~/.ssh/id_rsa`
- Asegúrate de que la clave tenga permisos correctos (`chmod 600 ~/.ssh/id_rsa`)
- Si usas contraseña, verifica que sea correcta
- Verifica que el usuario SSH tenga permisos para acceder a Libvirt

### Problemas de Base de Datos

**Error**: `Could not connect to DB`
- Verifica que PostgreSQL esté corriendo: `docker-compose ps`
- Revisa las variables de entorno en `docker-compose.yml`
- Verifica los logs: `docker-compose logs db`

**Error**: `relation "virtualization.hosts" does not exist`
- Ejecuta el script de inicialización: `psql -f deploy_centralizegg/postgres/init.sql`

### Problemas de Libvirt

**Error**: `remote libvirt socket: connection refused`
- Verifica que Libvirt esté corriendo en el servidor remoto
- Asegúrate de que el socket esté en `/var/run/libvirt/libvirt-sock`
- Verifica permisos del usuario SSH para acceder al socket

**Error**: `libvirt connect: authentication failed`
- Verifica configuración de Libvirt en el servidor remoto
- Revisa políticas de acceso en `/etc/libvirt/libvirt.conf`

### Servidores Aparecen como Offline

1. Verifica conectividad de red
2. Revisa logs del colector: `docker-compose logs app | grep "Failed to collect"`
3. Verifica credenciales SSH en la configuración
4. Asegúrate de que Libvirt esté accesible vía SSH

### Frontend No Muestra Datos

1. Abre la consola del navegador (F12) y revisa errores
2. Verifica que la API esté respondiendo: `curl http://localhost:8080/api/hosts`
3. Revisa logs del backend: `docker-compose logs app`
4. Verifica CORS si accedes desde otro dominio

## 🛠️ Tech Stack

*   **Backend**: Go 1.23.2 (Golang) + Gorilla Mux + Libvirt + SSH
*   **Database**: PostgreSQL 15
*   **Frontend**: Vanilla JavaScript + CSS3 (Glassmorphism design)
*   **Deployment**: Docker Compose
*   **Libraries**:
    - `github.com/digitalocean/go-libvirt` - Cliente Libvirt
    - `golang.org/x/crypto/ssh` - Cliente SSH
    - `github.com/gorilla/mux` - Router HTTP
    - `github.com/lib/pq` - Driver PostgreSQL
    - `github.com/beevik/etree` - Parser XML
    - **Frontend Libs**:
        - `Leaflet.js` - Mapas interactivos con soporte táctil
        - `leaflet-ant-path` - Animaciones de tráfico fluidas (Bezier/Flight-Path)
        - `Interactive SVG Engine` - Renderizado de topología de red con flujos animados
        - `Custom Sparklines` - Renderizado SVG ultraligero para métricas en tiempo real

### Debugging AntPath Map
Si el mapa no muestra líneas de tráfico:
1. Abre la consola del navegador (F12).
2. Busca mensajes con el prefijo `[AntPath]`.
3. Verifica el estado en la esquina inferior izquierda del mapa:
   - **GeoReady**: Debe ser "Yes".
   - **HomeIP**: Debe mostrar tu IP pública.

---



© 2026 Centralizegg Contributors - MIT License
