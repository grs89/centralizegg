# Centralizegg

<div align="center">
  <img src="web_centralizegg/static/logo.png" alt="Centralizegg Logo" width="120">
</div>

<div align="center">
  <img src="web_centralizegg/static/image/1.png" alt="Centralizegg Dashboard" width="800">
</div>

[🇨🇴 Español](#español) | [🇧🇷 Português](#português)

---

<a name="español"></a>
# 🇨🇴 Centralizegg

**Centralizegg** es una solución de monitoreo ligera y containerizada para múltiples servidores y servicios. Proporciona un dashboard premium en tiempo real para visualizar los recursos de tus hosts, contenedores y Cluster K8s  permite ver el estado de los recursos de forma centralizada.

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
    - **Heatmap de Densidad**: Visualización de "puntos calientes" de tráfico con gradiente de colores.
    - **Filtros Interactivos**: Botones All/In/Out para segmentar conexiones por dirección.
    - **Líneas Dinámicas**: Velocidad de animación proporcional al volumen de tráfico.
    - **Marcadores Pulsantes**: Indicadores animados rojo/verde con popup de país y ciudad.
    - **Modo Depuración**: Overlay accesible desde la UI para diagnosticar la resolución de IPs.
*   **Monitoreo de Gateways**: Estado en tiempo real de los gateways de pfSense (WAN/VPN).
    - **Alertas Visuales**: 
        - ⚠️ Advertencia (>0% Pérdida de paquetes): Resaltado ámbar.
        - 🚨 Crítico (>10% Pérdida de paquetes): **Animación de pulso rojo** y sombras dinámicas para atención inmediata.
    - Métricas precisas de RTT y Desviación estándar.
*   **Historial de Logs del Host**: Real-time log viewer (`journalctl` / `clog`) integrado en la herramienta de Historial Global para todos los tipos de servidores (KVM, Docker, pfSense, Proxmox, NAS, Ceph).
*   **Monitoreo de Kubernetes (K8s)**:
    - Visualización de Nodos y Pods en tiempo real.
    - **Historial Detallado por Nodo**: Métricas históricas de CPU, Memoria, Red y Disco para cada nodo del cluster.
    - Métricas de consumo de recursos por Namespace y estadísticas de red (RX/TX).
    - [Documentación Detallada](web_centralizegg/static/docs/kubernetes.html)
*   **Almacenamiento & Disco**:
    - **NAS**: Monitoreo vía SSH de servidores Linux/NAS:
        - Inventario de discos (`lsblk`) y particiones.
        - **Métricas de I/O**: Historial de tasas de Lectura/Escritura por cada disco individual del host.
    - **Visualización Multi-Disco**: Barras de uso individuales para cada disco virtual adjunto a la VM.
*   **Historial Global Mejorado**:
    - Gráficos de Red con **Umbrales de Tráfico** basados en la velocidad de la interfaz.
    - Unidades dinámicas (MB/GB) para una lectura clara de métricas de Memoria y Almacenamiento.
*   **Búsqueda Global ("Search Everything")**:
    - Barra de búsqueda unificada que indexa **KVM Hosts, VMs, Contenedores Docker/Podman y Volúmenes NAS**.
    - Navegación inteligente: Al seleccionar un resultado, cambia automáticamente a la herramienta correspondiente.
*   **Logs Unificados**: Panel lateral deslizable para ver logs de recolección de todos los sistemas en un solo lugar.
*   **Notificaciones Audibles**: Sonido de "ping" para nuevas alertas de servidores offline.
*   **Seguridad**: Escaneo CVE con `docker scout` y soporte para autenticación robusta (Clave/Contraseña).
*   **Auto-refresh**: Actualización automática de datos cada 5 segundos en el frontend.
*   **Gráficos Avanzados**:
    - **Zoom Interactivo**: Selección de área para ampliar períodos específicos en gráficos de historial.
    - **Umbrales Visuales**: Líneas de referencia configurables para CPU, Memoria y Red.
    - **Tendencias y Proyecciones**: Análisis predictivo de uso de recursos.
    - **Estimación de Días Restantes**: Cálculo automático de agotamiento de disco basado en tendencia.
*   **Monitoreo de Ceph**: Soporte para clusters de almacenamiento distribuido Ceph vía SSH.
    - Estado de salud del cluster, OSDs y pools.


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
*   **Kubernetes**: `/api/kubernetes/nodes`, `/api/kubernetes/pods`, `/api/kubernetes/pvs`, `/api/kubernetes/events`
*   **Docker**: `/api/containers/hosts`, `/api/containers/containers`
*   **Podman**: `/api/podman/hosts`, `/api/podman/containers`
*   **Ceph**: `/api/ceph/hosts`
*   **Salud y Métricas**: `/api/health/summary`, `/api/metrics/{category}/{id}`, `/api/status`
*   **Geolocalización**: `/api/geoip/{ip}` (Proxy a ip-api.com)
*   **Configuración Genérica**: `/api/config/{tool}` (donde tool = nas, proxmox, docker, ceph, etc.)

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
│       ├── ceph-collector.go      # Colector Ceph (SSH)
│       └── nas-collector.go       # Colector NAS (SSH)
├── web_centralizegg/
│   └── static/
│       ├── index.html             # Interfaz principal
│       ├── app.js                 # Lógica del frontend (monolito)
│       ├── style.css              # Estilos glassmorphism
│       ├── js/                    # Módulos ES modulares
│       │   ├── state.js           # Estado global
│       │   ├── history.js         # Lógica de historial
│       │   ├── ui-components.js   # Componentes reutilizables
│       │   └── utils.js           # Utilidades
│       ├── docs/                  # Documentación embebida
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

---

<a name="português"></a>
# 🇧🇷 Centralizegg

**Centralizegg** é uma solução de monitoramento leve e containerizada para múltiplos servidores KVM. Fornece um painel premium em tempo real para visualizar os recursos de seus hosts e o estado das máquinas virtuais (VMs) de forma centralizada.

[![Docker Build (GitHub)](https://github.com/USUARIO/REPO/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/USUARIO/REPO/actions/workflows/docker-publish.yml)
[![Docker Build (GitLab)](https://gitlab.com/USUARIO/REPO/badges/main/pipeline.svg)](https://gitlab.com/USUARIO/REPO/-/pipelines)
[![Docker Hub](https://img.shields.io/docker/v/USUARIO/centralizegg?label=Docker%20Hub&logo=docker)](https://hub.docker.com/r/USUARIO/centralizegg)
[![Docker Pulls](https://img.shields.io/docker/pulls/USUARIO/centralizegg?logo=docker)](https://hub.docker.com/r/USUARIO/centralizegg)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> [!TIP]
> **CI/CD Disponível**: Este projeto inclui configuração para **GitHub Actions** e **GitLab CI**.
> - GitHub: Ver [instruções](.github/DOCKER_HUB_SETUP.md)
> - GitLab: Ver [instruções](.gitlab/DOCKER_HUB_SETUP.md)
> 
> Substitua `USUARIO/REPO` pelo seu usuário e repositório nos badges acima.

## 📋 Índice

- [Características Principais](#-características-principais-1)
- [Estrutura do Projeto](#-estrutura-do-projeto-1)
- [Instalação Rápida](#-instalação-rápida-1)
- [Configuração](#-configuração-1)
- [Solução de Problemas](#-solução-de-problemas)

## ✨ Características Principais

*   **Detecção de SO**: Identificação automática do Sistema Operacional de cada host através de `/etc/os-release` com ícones representativos (Ubuntu, Debian, Fedora, CentOS, Windows, Red Hat, SUSE).
*   **Métricas Premium**: Janelas flutuantes (popovers) interativas para CPU e Memória com barras de progresso em tempo real.
*   **Coletor Automático**: Coleta de métricas a cada 10 segundos de todos os servidores configurados.
*   **Métricas Completas**: 
    - CPU: Uso calculado com base no tempo de CPU acumulado
    - Memória: Total, livre e utilizada
    - Disco: Alocação, capacidade e estatísticas de I/O
    - Rede: Tráfico RX/TX em tempo real
*   **Monitoramento de Firewall**: Suporte completo para **pfSense** via SSH.
    - Métricas de sistema (CPU, Memória, Disco)
    - Informações de interfaces de rede com estatísticas de tráfego
    - Detecção de arquitetura multiplataforma (x86_64, ARM/AArch64) com badges visuais.
*   **QEMU Guest Agent**: Integração avançada para obter telemetria detalhada do sistema convidado:
    - Nome e versão do Sistema Operacional
    - Endereços IP internos
*   **Proxmox VE**: Integração nativa com clusters Proxmox.
    - Monitoramento de nós, VMs e Containers LXC.
    - Métricas de armazenamento ZFS e Ceph (via API).
*   **Mapa de Tráfego Mundial**: Visualização geográfica premium com animações "Flight Path" (curvas Bezier).
    - **Proxy GeoIP Integrado**: Resolução de IPs no backend para privacidade e segurança (evita Mixed Content).
    - **Animações Fluidas**: Linhas curvas com pulso dinâmico (Vermelho: Entrada, Verde: Saída).
    - **Heatmap de Densidade**: Visualização de "pontos quentes" de tráfego com gradiente de cores.
    - **Filtros Interativos**: Botões All/In/Out para segmentar conexões por direção.
    - **Linhas Dinâmicas**: Velocidade de animação proporcional ao volume de tráfego.
    - **Marcadores Pulsantes**: Indicadores animados vermelho/verde com popup de país e cidade.
    - **Modo Debug**: Overlay acessível da UI para diagnosticar resolução de IPs.
*   **Monitoramento de Gateways**: Estado em tempo real dos gateways pfSense (WAN/VPN).
    - **Alertas Visuais**: 
        - ⚠️ Aviso (>0% Perda de pacotes): Destaque âmbar.
        - 🚨 Crítico (>10% Perda de pacotes): **Animação de pulso vermelho** e sombras dinâmicas para atenção imediata.
    - Métricas precisas de RTT e Desvio padrão.
*   **Histórico de Logs do Host**: Visualizador de logs em tempo real (`journalctl` / `clog`) integrado na ferramenta de Histórico Global para todos os tipos de servidores (KVM, Docker, pfSense, Proxmox, NAS, Ceph).
*   **Monitoramento de Kubernetes (K8s)**:
    - Visualização de Nós e Pods em tempo real.
    - **Histórico Detalhado por Nó**: Métricas históricas de CPU, Memória, Rede e Disco para cada nó do cluster.
    - Métricas de consumo de recursos por Namespace e estatísticas de rede (RX/TX).
    - [Documentação Detalhada](web_centralizegg/static/docs/kubernetes.html)
*   **Armazenamento & Disco**:
    - **NAS**: Monitoramento via SSH de servidores Linux/NAS:
        - Inventário de discos (`lsblk`) e partições.
        - **Métricas de I/O**: Histórico de taxas de Leitura/Escrita para cada disco individual do host.
    - **Visualização Multi-Disco**: Barras de uso individuais para cada disco virtual anexado à VM.
*   **Histórico Global Melhorado**:
    - Gráficos de Rede com **Limites de Tráfego** baseados na velocidade da interface.
    - Unidades dinâmicas (MB/GB) para leitura clara de métricas de Memória e Armazenamento.
*   **Busca Global ("Search Everything")**:
    - Barra de busca unificada que indexa **Hosts KVM, VMs, Containers Docker/Podman e Volumes NAS**.
    - Navegação inteligente: Ao selecionar um resultado, muda automaticamente para a ferramenta correspondente.
*   **Logs Unificados**: Painel lateral deslizante para ver logs de coleta de todos os sistemas em um só lugar.
*   **Notificações Audíveis**: Som de "ping" para novos alertas de servidores offline.
*   **Segurança**: Escaneamento CVE com `docker scout` e suporte para autenticação robusta (Chave/Senha).
*   **Auto-refresh**: Atualização automática de dados a cada 5 segundos no frontend.
*   **Gráficos Avançados**:
    - **Zoom Interativo**: Seleção de área para ampliar períodos específicos em gráficos de histórico.
    - **Limites Visuais**: Linhas de referência configuráveis para CPU, Memória e Rede.
    - **Tendências e Projeções**: Análise preditiva de uso de recursos.
    - **Estimativa de Dias Restantes**: Cálculo automático de esgotamento de disco baseado em tendência.
*   **Monitoramento de Ceph**: Suporte para clusters de armazenamento distribuído Ceph via SSH.
    - Estado de saúde do cluster, OSDs e pools.

## 📁 Estrutura do Projeto

```
Centralizegg/
├── cmd_centralizegg/
│   └── server/
│       └── main.go                 # Ponto de entrada da aplicação
├── backend_internal_centralizegg/
│   ├── data_centralizegg/
│   │   └── postgres.go            # Camada de acesso a dados (PostgreSQL)
│   ├── virtualization/
│   │   ├── kvm-collector.go       # Coletor de métricas KVM/Libvirt
│   │   └── proxmox-collector.go   # Coletor de API Proxmox
│   ├── firewall/
│   │   └── pfsense-collector.go   # Coletor de métricas pfSense (SSH)
│   ├── container/
│   │   ├── docker-collector.go    # Coletor Docker
│   │   ├── podman-collector.go    # Coletor Podman
│   │   └── kubernetes-collector.go # Coletor K8s
│   └── storage/
│       ├── ceph-collector.go      # Coletor Ceph (SSH)
│       └── nas-collector.go       # Coletor NAS (SSH)
├── web_centralizegg/
│   └── static/
│       ├── index.html             # Interface principal
│       ├── app.js                 # Lógica do frontend (monolito)
│       ├── style.css              # Estilos glassmorphism
│       ├── js/                    # Módulos ES modulares
│       │   ├── state.js           # Estado global
│       │   ├── history.js         # Lógica de histórico
│       │   ├── ui-components.js   # Componentes reutilizáveis
│       │   └── utils.js           # Utilidades
│       ├── docs/                  # Documentação embebida
│       ├── logo.png
│       └── image/
│           └── 1.png              # Screenshot do painel
├── deploy_centralizegg/
│   └── postgres/
│       └── init.sql               # Script de inicialização do BD
├── docker-compose.yml             # Configuração de serviços
├── Dockerfile                     # Imagem do container
├── go.mod                         # Dependências Go
└── README.md
```

## 🚀 Instalação Rápida

### Requisitos Prévios

*   Docker e Docker Compose
*   Acesso SSH (via chave ou senha) aos servidores KVM
*   Os servidores KVM devem ter Libvirt configurado e acessível
*   **Opcional**: Instalar `qemu-guest-agent` nas VMs para detecção de SO e IPs.

### Configuração de Segurança (SSH)
1. Certifique-se de que sua chave esteja em `~/.ssh/id_rsa`.
2. O container monta esse diretório como somente leitura por padrão.

> [!IMPORTANT]
> **Permissões de Arquivo**: Certifique-se de que sua chave privada tenha permissões restritas (chmod 600), ou o cliente SSH recusará usá-la por segurança.
> ```bash
> chmod 600 ~/.ssh/id_rsa
> ```

### Implantação

```bash
# Clonar o repositório (se aplicável)
git clone <repository-url>
cd Centralizegg

# Iniciar serviços
docker-compose up -d --build

# Ver logs
docker-compose logs -f app
```

Acesse o painel em: `http://localhost:8080`

## ⚙️ Configuração

### Variáveis de Ambiente

O serviço `app` em `docker-compose.yml` utiliza as seguintes variáveis de ambiente:

```yaml
DB_HOST: db                    # Host do PostgreSQL
DB_PORT: 5432                  # Porta do PostgreSQL
DB_USER: centralizegg          # Usuário do banco de dados
DB_PASS: centralizegg_secret   # Senha do banco de dados
DB_NAME: centralizegg_db       # Nome do banco de dados
LIBVIRT_SOCK: /var/run/libvirt/libvirt-sock  # Socket do Libvirt (local)
```

### Volumes Montados

- `/var/run/libvirt/libvirt-sock:/var/run/libvirt/libvirt-sock` - Socket do Libvirt (para conexões locais)
- `~/.ssh:/root/.ssh:ro` - Chaves SSH (somente leitura)

### Configuração de Servidores

Os servidores KVM são configurados através do painel web:

1. Acesse `http://localhost:8080`
2. Selecione a ferramenta "KVM" no menu
3. Clique no botão de configuração (⚙️)
4. Adicione um novo servidor com:
   - **Nome**: Nome descritivo
   - **IP Address**: Endereço IP do servidor
   - **SSH Port**: Porta SSH (padrão: 22)
   - **Username**: Usuário SSH
   - **Autenticação**: Chave SSH ou senha
   - **SSH Key Path**: Caminho para a chave (padrão: `/root/.ssh/id_rsa`)

### Configuração de Firewall (pfSense)

1. Selecione a ferramenta "Firewall" no menu
2. Clique no botão de configuração (⚙️)
3. Adicione um novo servidor com credenciais SSH (similar ao KVM).
   - **Autenticação**: Suporta Chave SSH (RSA/Ed25519) ou Senha.
   - **Requisitos**: O usuário deve ter acesso ao shell (`/bin/sh` ou `/bin/tcsh`) e permissões para executar `top`, `sysctl`, `netstat`, `pfctl`.
   - **Não requer agentes**: Tudo é coletado remotamente e com segurança.

## 🔧 Solução de Problemas

### Problemas de Conexão SSH

**Erro**: `ssh: handshake failed: ssh: unable to authenticate`
- Verifique se a chave pública está em `~/.ssh/authorized_keys` no servidor remoto
- Confirme permissões da chave privada: `chmod 600 ~/.ssh/id_rsa`
- Teste conexão manual: `ssh -i ~/.ssh/id_rsa usuario@ip-servidor`

**Erro**: `ssh: connect to host X.X.X.X port 22: Connection refused`
- Verifique se o servidor SSH está rodando no host remoto
- Confirme porta SSH (pode não ser a 22)
- Verifique firewall/regras de segurança

### Problemas de Banco de Dados

**Erro**: `Could not connect to DB`
- Verifique se o PostgreSQL está rodando: `docker-compose ps`
- Revise as variáveis de ambiente em `docker-compose.yml`
- Verifique os logs: `docker-compose logs db`

**Erro**: `relation "virtualization.hosts" does not exist`
- Execute o script de inicialização: `psql -f deploy_centralizegg/postgres/init.sql`

### Problemas de Libvirt

**Erro**: `remote libvirt socket: connection refused`
- Verifique se o Libvirt está rodando no servidor remoto
- Certifique-se de que o socket esteja em `/var/run/libvirt/libvirt-sock`
- Verifique permissões do usuário SSH para acessar o socket

**Erro**: `libvirt connect: authentication failed`
- Verifique configuração do Libvirt no servidor remoto
- Revise políticas de acesso em `/etc/libvirt/libvirt.conf`

---

© 2026 Centralizegg Contributors - MIT License
