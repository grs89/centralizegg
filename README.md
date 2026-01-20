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

[![Docker Build (GitHub)](https://github.com/USUARIO/REPO/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/USUARIO/REPO/actions/workflows/docker-publish.yml)
[![Docker Build (GitLab)](https://gitlab.com/USUARIO/REPO/badges/main/pipeline.svg)](https://gitlab.com/USUARIO/REPO/-/pipelines)
[![Docker Hub](https://img.shields.io/docker/v/USUARIO/centralizegg?label=Docker%20Hub&logo=docker)](https://hub.docker.com/r/USUARIO/centralizegg)
[![Docker Pulls](https://img.shields.io/docker/pulls/USUARIO/centralizegg?logo=docker)](https://hub.docker.com/r/USUARIO/centralizegg)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> [!TIP]
> **CI/CD Disponible**: Este proyecto incluye configuración para **GitHub Actions** y **GitLab CI**.
> - GitHub: Ver [instrucciones](.github/DOCKER_HUB_SETUP.md)
> - GitLab: Ver [instrucciones](.gitlab/DOCKER_HUB_SETUP.md)
> 
> Reemplaza `USUARIO/REPO` con tu usuario y repositorio en los badges anteriores.


## 📋 Tabla de Contenidos

- [Características Principales](#-características-principales)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Instalación Rápida](#-instalación-rápida)
- [Configuración](#-configuración)
- [Troubleshooting](#-troubleshooting)

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
    - **Interfaces Bridge**: Monitoreo dedicado de estados y tráfico para puentes de red (`br0`, `virbr0`, etc.) ubicado en la columna izquierda del layout de dos columnas.
    - Estado de VMs: Running, Blocked, Paused, Shutdown, Shutoff, Crashed, Suspended
*   **Monitoreo de Contenedores**: Soporte avanzado para **Docker & Podman**. El icono de Podman se ha actualizado a una foca (`fa-otter`) en todo el UI, incluyendo el menú, Host Nodes y el listado de contenedores.
    - **Mapa de Topología**: Visualización interactiva animada de la red (Contenedores -> Redes -> Internet).
- **Alertas Audibles**: Se reproduce un sonido de "ping" cuando aparecen nuevas notificaciones de servidores offline.
- **Tamaños de Volúmenes Podman**: Se muestra el tamaño de cada volumen y se ordenan de mayor a menor.
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
*   **Proxmox VE**: Integración nativa con clusters Proxmox.
    - Monitoreo de nodos, VMs y Contenedores LXC.
    - Métricas de almacenamiento ZFS y Ceph (vía API).
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
*   **Monitoreo de Kubernetes (K8s)**:
    - Visualización de Nodos y Pods en tiempo real.
    - Métricas de consumo de recursos por Namespace y estadísticas de red (RX/TX) corregidas en nodos.
    - Contadores de Pods corregidos; tráfico de red agregado desde pods cuando el nodo no reporta.
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




#### Tabla: `virtualization.proxmox_vms`
VMs y Contenedores LXC alojados en Proxmox.
*   **Monitoreo de Firewall**: Soporte completo para **pfSense** vía SSH.
    - Métricas de sistema (CPU, Memoria, Disco)
    - Información de interfaces de red con estadísticas de tráfico
    - Detección de arquitectura multi-plataforma (x86_64, ARM/AArch64) con insignias visuales.
*   **QEMU Guest Agent**: Integración avanzada para obtener telemetría detallada del sistema invitado:
    - Nombre y versión del Sistema Operativo
    - Direcciones IP internas
*   **Proxmox VE**: Integración nativa con clusters Proxmox.
    - Monitoreo de nodos, VMs y Contenedores LXC.
    - Métricas de almacenamiento ZFS y Ceph (vía API).
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
*   **Monitoreo de Kubernetes (K8s)**:
    - Visualización de Nodos y Pods en tiempo real.
    - Métricas de consumo de recursos por Namespace.
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
#### `GET /api/firewall/servers`
Obtiene servidores pfSense configurados.

#### `POST /api/firewall/servers`
Agrega un nuevo servidor pfSense.

#### `PUT/DELETE /api/firewall/servers/{id}`
Actualiza o elimina servidores pfSense.

### Otros Endpoints (NAS, Proxmox, Contenedores)

Centralizegg expone endpoints estandarizados para el resto de herramientas:

*   **NAS**: `/api/nas/hosts`, `/api/nas/volumes`, `/api/nas/disks`
*   **Proxmox**: `/api/proxmox/hosts`, `/api/proxmox/vms`
*   **Kubernetes**: `/api/kubernetes/nodes`, `/api/kubernetes/pods`
*   **Docker**: `/api/containers/hosts`, `/api/containers/containers`
*   **Podman**: `/api/podman/hosts`, `/api/podman/containers`
*   **Configuración Genérica**: `/api/config/{tool}` (donde tool = nas, proxmox, docker, etc.)

## 🗄️ Base de Datos

Centralizegg utiliza PostgreSQL con esquemas dedicados para cada módulo.
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
│   │   ├── kvm-collector.go       # Colector de métricas KVM/Libvirt
│   │   └── proxmox-collector.go   # Colector de API Proxmox
│   ├── firewall/
│   │   └── pfsense-collector.go   # Colector de métricas pfSense (SSH)
│   ├── container/
│   │   ├── docker-collector.go    # Colector Docker
│   │   ├── podman-collector.go    # Colector Podman
│   │   └── kubernetes-collector.go # Colector K8s
│   └── storage/
│       └── nas-collector.go       # Colector NAS (SSH)
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

### Usar Imagen de Docker Hub (Alternativa)

Si prefieres usar la imagen pre-construida desde Docker Hub en lugar de compilar localmente:

```yaml
# docker-compose.yml
services:
  app:
    image: tuusuario/centralizegg:latest  # Reemplaza con tu usuario de Docker Hub
    # ... resto de la configuración
```

O directamente con Docker:

```bash
docker pull tuusuario/centralizegg:latest
docker run -d -p 8080:8080 \
  -e DB_HOST=db \
  -e DB_USER=centralizegg \
  -e DB_PASS=centralizegg_secret \
  -e DB_NAME=centralizegg_db \
  -v ~/.ssh:/root/.ssh:ro \
  tuusuario/centralizegg:latest
```

> [!NOTE]
> La imagen de Docker Hub se construye automáticamente con GitHub Actions para arquitecturas `linux/amd64` y `linux/arm64`.
> Ver [instrucciones de configuración](.github/DOCKER_HUB_SETUP.md) para publicar tu propia imagen.


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


---

© 2026 Centralizegg Contributors - MIT License
