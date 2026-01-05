const API_HOST = '/api/host';
const API_VMS = '/api/vms';

async function fetchHost() {
    try {
        const response = await fetch(API_HOST);
        if (!response.ok) throw new Error('Failed to fetch host');
        const host = await response.json();
        
        if (host) {
            document.getElementById('host-name').textContent = host.hostname || 'Localhost';
            document.getElementById('host-mem').textContent = (host.total_memory / (1024 * 1024 * 1024)).toFixed(2) + " GB";
            document.getElementById('host-cores').textContent = host.cpu_cores;
            document.getElementById('host-cpu').textContent = host.cpu_model;
        }
    } catch (e) {
        console.error(e);
    }
}

async function fetchVMs() {
    try {
        const response = await fetch(API_VMS);
        if (!response.ok) throw new Error('Failed to fetch VMs');
        const vms = await response.json();
        
        const grid = document.getElementById('vm-grid');
        
        if (!vms || vms.length === 0) {
            grid.innerHTML = '<div class="loading-state">No VMs found or collector is initializing...</div>';
            return;
        }

        // Render VMs
        // Ideally we diff the DOM, but for simplicity we re-render neatly using current state
        // To prevent flickering, we could update existing elements, but for this demo a wipe-and-redraw or a smart mapping is needed.
        // Let's do a simple wipe for now, the browser handles it fast enough for a small number of VMs, or better: map IDs.
        
        // Simple Render
        grid.innerHTML = vms.map(vm => {
            const memGB = (vm.max_memory / (1024 * 1024 * 1024)).toFixed(1);
            const memUsedGB = (vm.memory_usage / (1024 * 1024 * 1024)).toFixed(1);
            const memPercent = vm.max_memory > 0 ? (vm.memory_usage / vm.max_memory) * 100 : 0;
            
            // Generate a random-ish CPU usage for visualization if we don't have historical delta calculation in frontend yet
            // The backend sends accumulated cpu time, so to show % we need 2 points in time. 
            // For this version 1.0, we will just show the accumulated time as a raw stat or a "Active" indicator.
            // Let's simple show CPU Time in seconds.
            const cpuSeconds = (vm.cpu_time / 1e9).toFixed(1);

            return `
            <div class="vm-card state-${vm.state}">
                <div class="vm-header">
                    <div class="vm-name"><i class="fa-solid fa-server"></i> ${vm.name}</div>
                    <div class="vm-state">${vm.state}</div>
                </div>
                <div class="vm-metrics">
                    <div class="metric">
                        <div class="metric-header">
                            <span>Memory</span>
                            <span>${memUsedGB} / ${memGB} GB</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${memPercent}%"></div>
                        </div>
                    </div>
                    
                    <div class="metric">
                        <div class="metric-header">
                            <span>CPU Time</span>
                            <span>${cpuSeconds}s</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="background: var(--text-secondary); width: 100%"></div>
                        </div>
                    </div>
                </div>
            </div>
            `;
        }).join('');

        // Update timestamp
        const now = new Date();
        document.getElementById('last-updated').textContent = now.toLocaleTimeString();

    } catch (e) {
        console.error(e);
        document.getElementById('vm-grid').innerHTML = '<div class="loading-state" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i> Connection Lost</div>';
    }
}

// Init
fetchHost();
fetchVMs();

// Auto-refresh
setInterval(fetchVMs, 5000);
