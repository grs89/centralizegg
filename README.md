# Centralize

[🇨🇴 Español](#español) | [🇺🇸 English](#english)

---

<a name="español"></a>
# 🇨🇴 Centralize

**Centralize** es una solución de monitoreo ligera y containerizada para múltiples servidores KVM. Proporciona un dashboard premium en tiempo real para visualizar los recursos de tus hosts y el estado de las máquinas virtuales (VMs) de forma centralizada.

## 🚀 Arquitectura y Flujo de Trabajo

El sistema ha evolucionado para soportar múltiples nodos remotos mediante SSH:

### 1. El Colector Multi-Server (Backend)
- **Tecnología**: Go (Golang) + SSH
- **Acción**: Itera sobre una lista de servidores configurados en la base de datos.
- **Flujo**:
    1.  Lee la configuración de servidores desde PostgreSQL.
    2.  Establece un túnel SSH seguro con cada servidor remoto usando claves SSH (`/root/.ssh/id_rsa`).
    3.  Se conecta al socket de Libvirt remoto a través de este túnel.
    4.  Recolecta métricas del Host y de todas sus VMs.
    5.  Guarda los datos en la base de datos central.

### 2. Base de Datos (PostgreSQL)
- **Tablas**:
    - `kvm_servers`: Configuración de conexión (IP, Usuario, Ruta de llave).
    - `hosts`: Métricas de cada nodo físico.
    - `vms`: Estado y métricas de cada máquina virtual.

### 3. Dashboard y Configuración (Frontend)
- **Visualización**: Muestra el estado de todos los servidores monitoreados.
- **Configuración**: Nuevo menú de ajustes (tuerca ⚙️) para agregar o eliminar servidores KVM dinámicamente sin reiniciar el contenedor.

---

## 🛠️ Instalación y Uso

### Prerrequisitos
- Docker y Docker Compose
- Acceso SSH a los servidores KVM remotos (usando claves públicas/privadas).

### Configuración de Claves SSH
Para que Centralize se conecte a tus servidores, necesita tu clave privada SSH.
El `docker-compose.yml` monta tu carpeta local `~/.ssh` en el contenedor:

```yaml
volumes:
  - ~/.ssh:/root/.ssh:ro
```
*Asegúrate de que tu clave pública (`id_rsa.pub`) esté autorizada en los servidores remotos (`~/.ssh/authorized_keys`).*

### Inicio Rápido

1.  **Iniciar el stack**:
    ```bash
    docker-compose up -d --build
    ```

2.  **Acceder al Dashboard**:
    Abre [http://localhost:8080](http://localhost:8080).

3.  **Agregar Servidores**:
    - Haz clic en el icono de configuración (⚙️).
    - Ingresas el **Nombre**, **IP**, y **Usuario** (ej. `root`).
    - Selecciona el tipo de autenticación: **Llave SSH** o **Contraseña**.
    - El sistema comenzará a monitorear automáticamente.

---

## 🎨 Características
- **Multi-Server**: Monitorea N servidores KVM desde un solo lugar.
- **UI Moderna**: Modo oscuro "Glassmorphism" con animaciones.
- **Configuración Web**: Gestiona tus conexiones desde el navegador.
- **Seguro**: Todas las conexiones son encriptadas vía SSH.

---
---

<a name="english"></a>
# 🇺🇸 Centralize

**Centralize** is a lightweight, containerized monitoring solution for multiple KVM servers. It provides a premium, real-time dashboard to visualize host resources and VM states from a centralized location.

## 🚀 Architecture & Workflow

The system supports multiple remote nodes via SSH tunnels:

### 1. Multi-Server Collector (Backend)
- **Technology**: Go (Golang) + SSH
- **Action**: Iterates over a list of servers configured in the database.
- **Workflow**:
    1.  Reads server configuration from PostgreSQL.
    2.  Establishes a secure SSH tunnel to each remote server using SSH keys (`/root/.ssh/id_rsa`).
    3.  Connects to the remote Libvirt socket through this tunnel.
    4.  Collects metrics from the Host and all its VMs.
    5.  Persists date to the central database.

### 2. Database (PostgreSQL)
- **Tables**:
    - `kvm_servers`: Connection details (IP, Username, Key Path).
    - `hosts`: Physical node metrics.
    - `vms`: Virtual Machine state and metrics.

### 3. Dashboard & Config (Frontend)
- **Visualization**: Displays status for all monitored servers.
- **Configuration**: New Settings menu (gear icon ⚙️) to dynamically add or remove KVM servers without restarting the container.

---

## 🛠️ Installation & Usage

### Prerequisites
- Docker & Docker Compose
- SSH access to remote KVM servers (using public/private keys).

### SSH Key Configuration
For Centralize to connect to your servers, it needs your private SSH key.
The `docker-compose.yml` mounts your local `~/.ssh` folder into the container:

```yaml
volumes:
  - ~/.ssh:/root/.ssh:ro
```
*Ensure your public key (`id_rsa.pub`) is authorized on the remote servers (`~/.ssh/authorized_keys`).*

### Quick Start

1.  **Start the stack**:
    ```bash
    docker-compose up -d --build
    ```

2.  **Access Dashboard**:
    Open [http://localhost:8080](http://localhost:8080).

3.  **Add Servers**:
    - Click the Settings icon (⚙️).
    - Enter the **Name**, **IP**, and **Username** (e.g., `root`).
    - Select Authentication Type: **SSH Key** or **Password**.
    - The system will start monitoring automatically.

---

## 🎨 Features
- **Multi-Server**: Monitor N KVM servers from one place.
- **Modern UI**: Dark mode with "Glassmorphism" aesthetics.
- **Web Config**: Manage connections directly from the browser.
- **Secure**: All connections are encrypted via SSH.
