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
- **Visualización**: Muestra el estado de todos los servidores monitoreados con indicadores de conexión (🟢 Online / 🔴 Offline).
- **Métricas de VM**: Visualiza CPU configurada, memoria total, uso de memoria, I/O de disco (Lectura/Escritura) e I/O de red (RX/TX) en tiempo real.
- **Configuración**: Nuevo menú de ajustes (tuerca ⚙️) para agregar o eliminar servidores KVM dinámicamente, con soporte para puertos SSH personalizados.

---

## 🛠️ Instalación y Uso

### Prerrequisitos
- Docker y Docker Compose
- Acceso SSH a los servidores KVM remotos (usando claves públicas/privadas o contraseña).

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
    - Ingresa el **Nombre**, **IP**, **Puerto SSH** y **Usuario**.
    - Selecciona el tipo de autenticación: **Llave SSH** o **Contraseña**.
    - El sistema comenzará a monitorear automáticamente.

---

## 🎨 Características
- **Multi-Server**: Monitorea N servidores KVM desde un solo lugar.
- **Estado de Conexión**: Indicadores visuales en tiempo real del estado del servidor.
- **Métricas Detalladas**:
    - vCPU y Memoria configurada por VM.
    - I/O de Disco (Lectura/Escritura).
    - I/O de Red (Entrante/Saliente).
- **UI Moderna**: Modo oscuro "Glassmorphism" con animaciones y estética premium.
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
    2.  Establishes a secure SSH tunnel to each remote server using SSH keys or Passwords.
    3.  Connects to the remote Libvirt socket through this tunnel.
    4.  Collects metrics from the Host and all its VMs.
    5.  Persists data to the central database.

### 2. Database (PostgreSQL)
- **Tables**:
    - `kvm_servers`: Connection details (IP, Port, Username, Auth details, Status).
    - `hosts`: Physical node metrics.
    - `vms`: Virtual Machine state, configured resources, and I/O metrics.

### 3. Dashboard & Config (Frontend)
- **Visualization**: Displays status for all monitored servers with connection indicators (🟢 Online / 🔴 Offline).
- **VM Metrics**: Visualizes configured vCPU, Total Memory, Usage, Disk I/O (Read/Write), and Network I/O (RX/TX).
- **Configuration**: Settings menu (gear icon ⚙️) to dynamically add or remove KVM servers, supporting custom SSH ports.

---

## 🛠️ Installation & Usage

### Prerequisites
- Docker & Docker Compose
- SSH access to remote KVM servers (using public/private keys or password).

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
    - Enter the **Name**, **IP**, **SSH Port**, and **Username**.
    - Select Authentication Type: **SSH Key** or **Password**.
    - The system will start monitoring automatically.

---

## 🎨 Features
- **Multi-Server**: Monitor N KVM servers from one place.
- **Connection Status**: Real-time visual indicators of server health.
- **Detailed Metrics**:
    - vCPU and Configured Memory per VM.
    - Disk I/O (Read/Write).
    - Network I/O (RX/TX).
- **Modern UI**: Dark mode with "Glassmorphism" aesthetics and premium feel.
- **Web Config**: Manage connections directly from the browser.
- **Secure**: All connections are encrypted via SSH.

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
