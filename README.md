# Centralize

**Centralize** is a lightweight, containerized monitoring solution for KVM-based virtual machines. It provides a premium, real-time dashboard to visualize host resources and VM states.

## 🚀 Architecture & Workflow

The system is composed of three main layers that work together to deliver real-time monitoring:

### 1. The Collector (Backend)
- **Technology**: Go (Golang)
- **Action**: On startup, it connects to the host's KVM socket (`/var/run/libvirt/libvirt-sock`).
- **Workflow**:
    1.  Establishes a connection to Libvirt using the `digitalocean/go-libvirt` library.
    2.  runs a ticker loop (every 5 seconds).
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
    git clone https://github.com/grs/centralize.git
    cd centralize
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

---

## 🎨 Features
- **Modern UI**: Dark mode with "Glassmorphism" aesthetics and animated backgrounds.
- **Real-Time**: Automatic refreshing of data.
- **Zero-Dependency**: The binary is statically compiled; the container needs nothing but the socket access.
- **Resilient**: Auto-reconnects to Database and handles Libvirt interruptions gracefully.
