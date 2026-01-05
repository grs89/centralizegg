# Centralize

[🇪🇸 Español](#español) | [🇺🇸 English](#english)

---

<a name="español"></a>
# 🇪🇸 Centralize

**Centralize** es una solución de monitoreo ligera y containerizada para máquinas virtuales basadas en KVM. Proporciona un dashboard premium en tiempo real para visualizar los recursos del host y el estado de las máquinas virtuales (VMs).

## 🚀 Arquitectura y Flujo de Trabajo

El sistema está compuesto por tres capas principales que trabajan juntas para ofrecer monitoreo en tiempo real:

### 1. El Colector (Backend)
- **Tecnología**: Go (Golang)
- **Acción**: Al iniciarse, se conecta al socket KVM del host (`/var/run/libvirt/libvirt-sock`).
- **Flujo**:
    1.  Establece una conexión con Libvirt usando la librería `digitalocean/go-libvirt`.
    2.  Ejecuta un bucle de recolección (cada 5 segundos).
    3.  Obtiene estadísticas del Nodo Host (Modelo de CPU, Núcleos, Memoria).
    4.  Itera a través de todos los Dominios (VMs) Activos e Inactivos para recopilar su estado y uso de recursos.
    5.  "Upserts" (Inserta o Actualiza) estos datos en la base de datos PostgreSQL.

### 2. La Capa de Persistencia (Base de Datos)
- **Tecnología**: PostgreSQL
- **Acción**: Almacena la última instantánea de la infraestructura.
- **Flujo**:
    - Recibe datos del Colector.
    - Mantiene dos tablas principales: `hosts` y `vms`.
    - Sirve como la única fuente de verdad para la API.

### 3. El Dashboard (Frontend)
- **Tecnología**: HTML/CSS/JS Vanilla (Diseño Glassmorphism)
- **Acción**: Visualiza los datos para el usuario.
- **Flujo**:
    - El navegador carga los activos web estáticos.
    - `app.js` consulta la API REST interna (`/api/host` y `/api/vms`).
    - La interfaz actualiza dinámicamente el DOM para reflejar cambios en el estado de las VMs (Ejecutando, Pausada, Apagada) sin recargar la página.

---

## 🛠️ Instalación y Uso

Este proyecto está completamente Dockerizado para un despliegue fácil.

### Prerrequisitos
- Docker y Docker Compose
- Acceso al socket de KVM/Libvirt en la máquina host.

### Inicio Rápido

1.  **Clonar el repositorio**:
    ```bash
    git clone https://github.com/grs89/centralize-kvm.git
    cd centralize-kvm
    ```

2.  **Iniciar el stack**:
    ```bash
    docker-compose up -d --build
    ```

3.  **Acceder al Dashboard**:
    Abre [http://localhost:8080](http://localhost:8080) en tu navegador web.

### Configuración
Puedes modificar las variables de entorno en `docker-compose.yml`:
- `LIBVIRT_SOCK`: Ruta al socket KVM (Por defecto: `/var/run/libvirt/libvirt-sock`)
- `DB_USER` / `DB_PASS`: Credenciales de la base de datos.
- `DB_NAME`: Nombre de la base de datos.

---

## 🎨 Características
- **UI Moderna**: Modo oscuro con estética "Glassmorphism" y fondos animados.
- **Tiempo Real**: Actualización automática de datos.
- **Cero Dependencias**: El binario se compila estáticamente; el contenedor no necesita nada más que acceso al socket.
- **Resiliente**: Se reconecta automáticamente a la base de datos y maneja interrupciones de Libvirt con elegancia.

---
---

<a name="english"></a>
# 🇺🇸 Centralize

**Centralize** is a lightweight, containerized monitoring solution for KVM-based virtual machines. It provides a premium, real-time dashboard to visualize host resources and VM states.

## 🚀 Architecture & Workflow

The system is composed of three main layers that work together to deliver real-time monitoring:

### 1. The Collector (Backend)
- **Technology**: Go (Golang)
- **Action**: On startup, it connects to the host's KVM socket (`/var/run/libvirt/libvirt-sock`).
- **Workflow**:
    1.  Establishes a connection to Libvirt using the `digitalocean/go-libvirt` library.
    2.  Runs a ticker loop (every 5 seconds).
    3.  Fetches Host Node statistics (CPU Model, Cores, Memory).
    4.  Iterates through all Active and Inactive Domains (VMs) to gather their state and resource usage.
    5.  "Upserts" (Insert or Update) this data into the PostgreSQL database.

### 2. The Persistence Layer (Database)
- **Technology**: PostgreSQL
- **Action**: Stores the latest snapshot of the infrastructure.
- **Workflow**:
    - Receives data from the Collector.
    - Maintains two main tables: `hosts` and `vms`.
    - Serves as the single source of truth for the API.

### 3. The Dashboard (Frontend)
- **Technology**: Vanilla HTML/CSS/JS (Glassmorphism Design)
- **Action**: Visualizes the data for the user.
- **Workflow**:
    - The browser loads the static web assets.
    - `app.js` polls the internal REST API (`/api/host` and `/api/vms`).
    - The UI dynamically updates the DOM to reflect changes in VM state (Running, Paused, Shutdown) without page reloads.

---

## 🛠️ Installation & Usage

This project is fully Dockerized for easy deployment.

### Prerequisites
- Docker & Docker Compose
- Access to the KVM/Libvirt socket on the host machine.

### Quick Start

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/grs89/centralize-kvm.git
    cd centralize-kvm
    ```

2.  **Start the stack**:
    ```bash
    docker-compose up -d --build
    ```

3.  **Access the Dashboard**:
    Open [http://localhost:8080](http://localhost:8080) in your web browser.

### Configuration
You can modify environment variables in `docker-compose.yml`:
- `LIBVIRT_SOCK`: Path to the KVM socket (Default: `/var/run/libvirt/libvirt-sock`)
- `DB_USER` / `DB_PASS`: Database credentials.
- `DB_NAME`: Database name.

---

## 🎨 Features
- **Modern UI**: Dark mode with "Glassmorphism" aesthetics and animated backgrounds.
- **Real-Time**: Automatic refreshing of data.
- **Zero-Dependency**: The binary is statically compiled; the container needs nothing but the socket access.
- **Resilient**: Auto-reconnects to Database and handles Libvirt interruptions gracefully.
