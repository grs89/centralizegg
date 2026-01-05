const API_HOSTS = '/api/hosts';
const API_VMS = '/api/vms';
const API_CONFIG_SERVERS = '/api/config/servers';

// Global server list to access data easily
let currentServers = [];

async function fetchHosts() {
    try {
        const response = await fetch(API_HOSTS);
        if (!response.ok) throw new Error('Failed to fetch hosts');
        const hosts = await response.json();

        const container = document.getElementById('host-nodes-container');
        if (!container) return;

        if (!hosts || hosts.length === 0) {
            container.innerHTML = '<div class="loading-state">No hosts monitored yet...</div>';
            return;
        }

        container.innerHTML = hosts.map(host => {
            const memGB = (host.total_memory / (1024 * 1024 * 1024)).toFixed(2);
            return `
            <div class="host-node-card glass-panel">
                <div class="host-node-header">
                    <div class="host-node-titles">
                        <div class="host-node-main-title">${host.server_name}</div>
                        <div class="host-node-sub-title"> ${host.hostname} | ${host.ip_address}</div>
                    </div>
                </div>
                <div class="host-stats">
                    <div class="stat-card">
                        <div class="icon"><i class="fa-solid fa-memory"></i></div>
                        <div class="info">
                            <span class="label">Memory</span>
                            <span class="value">${memGB} GB</span>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="icon"><i class="fa-solid fa-layer-group"></i></div>
                        <div class="info">
                            <span class="label">Cores</span>
                            <span class="value">${host.cpu_cores}</span>
                        </div>
                    </div>
                    <div class="stat-card wide" style="grid-column: span 2;">
                        <div class="icon"><i class="fa-solid fa-fingerprint"></i></div>
                        <div class="info">
                            <span class="label">CPU Model</span>
                            <span class="value" style="font-size: 0.8rem;">${host.cpu_model}</span>
                        </div>
                    </div>
                </div>
            </div>
            `;
        }).join('');
    } catch (e) {
        console.error(e);
        document.getElementById('host-nodes-container').innerHTML = '<div class="loading-state" style="color:var(--danger)">Failed to load hosts</div>';
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

        grid.innerHTML = vms.map(vm => {
            const memGB = (vm.max_memory / (1024 * 1024 * 1024)).toFixed(1);
            const memUsedGB = (vm.memory_usage / (1024 * 1024 * 1024)).toFixed(1);
            const memPercent = vm.max_memory > 0 ? (vm.memory_usage / vm.max_memory) * 100 : 0;
            const cpuSeconds = (vm.cpu_time / 1e9).toFixed(1);

            return `
            <div class="vm-card state-${vm.state}">
                <div class="vm-header">
                    <div class="vm-name"><i class="fa-solid fa-server"></i> ${vm.name}</div>
                    <div class="vm-state">${vm.state}</div>
                </div>
                <!-- Details Badge -->
                <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:15px; display:flex; gap:10px;">
                     <span style="background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px;"><i class="fa-solid fa-microchip"></i> ${vm.vcpu || '?'} vCPU</span>
                     <span style="background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px;"><i class="fa-solid fa-memory"></i> ${memGB} GB RAM</span>
                </div>
                
                <div class="vm-metrics">
                    <div class="metric">
                        <div class="metric-header">
                            <span>Memory Usage</span>
                            <span>${memUsedGB} / ${memGB} GB</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${memPercent}%"></div>
                        </div>
                    </div>
                    
                    <div class="metric">
                        <div class="metric-header">
                            <span>CPU Time (Cumulative)</span>
                            <span>${cpuSeconds}s</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="background: var(--accent-color); width: 100%; opacity: 0.3;"></div>
                        </div>
                    </div>

                    <div class="vm-io-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px; font-size:0.8rem; color:var(--text-secondary);">
                        <div class="io-item">
                            <div style="font-weight:bold; color:var(--text-primary); margin-bottom:4px;"><i class="fa-solid fa-hard-drive"></i> Disk I/O</div>
                            <div>R: ${formatBytes(vm.disk_read)}</div>
                            <div>W: ${formatBytes(vm.disk_write)}</div>
                        </div>
                        <div class="io-item">
                            <div style="font-weight:bold; color:var(--text-primary); margin-bottom:4px;"><i class="fa-solid fa-network-wired"></i> Network</div>
                            <div>RX: ${formatBytes(vm.net_rx)}</div>
                            <div>TX: ${formatBytes(vm.net_tx)}</div>
                        </div>
                    </div>
                </div>
            </div>
            `;
        }).join('');

        const now = new Date();
        document.getElementById('last-updated').textContent = now.toLocaleTimeString();

    } catch (e) {
        console.error(e);
        document.getElementById('vm-grid').innerHTML = '<div class="loading-state" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i> Connection Lost</div>';
    }
}

// Config Modal Logic
const modal = document.getElementById('config-modal');
const btn = document.getElementById('config-btn');
const close = document.getElementsByClassName('close-modal')[0];

btn.onclick = () => {
    modal.style.display = 'block';
    loadServers();
    resetForm();
}
close.onclick = () => modal.style.display = 'none';
window.onclick = (e) => { if (e.target == modal) modal.style.display = 'none'; }

async function loadServers() {
    const res = await fetch(API_CONFIG_SERVERS);
    if (res.ok) {
        const servers = await res.json();
        currentServers = servers || [];
        const list = document.getElementById('server-list-ul');
        list.innerHTML = '';
        if (servers) {
            servers.forEach(s => {
                let statusColor = '#ccc';
                if (s.status === 'online') statusColor = 'var(--success)';
                if (s.status === 'offline') statusColor = 'var(--danger)';

                list.innerHTML += `
                <li>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${statusColor};" title="${s.status}"></span>
                        <span>${s.name} (${s.ip_address}:${s.ssh_port || 22})</span>
                    </div>
                    <div class="actions">
                        <button class="edit-btn icon-btn" onclick="startEdit(${s.id})" style="color:var(--accent-color); margin-right:10px;"><i class="fa-solid fa-pen"></i></button>
                        <button class="delete-btn icon-btn" onclick="deleteServer(${s.id})" style="color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </li>`;
            });
        }
    }
}

async function deleteServer(id) {
    if (confirm('Delete this server?')) {
        await fetch(API_CONFIG_SERVERS + '/' + id, { method: 'DELETE' });
        loadServers();
        resetForm(); // if we were editing it
    }
}

// Edit Logic
window.startEdit = (id) => {
    const s = currentServers.find(srv => srv.id === id);
    if (!s) return;

    document.getElementById('srv-id').value = s.id;
    document.getElementById('srv-name').value = s.name;
    document.getElementById('srv-ip').value = s.ip_address;
    document.getElementById('srv-user').value = s.username;

    // Auth type check. If we have key path but no password -> Key. 
    // Actually API does not return password. But usually key path is always there or default.
    // Let's assume Key by default unless user sets password? 
    // Or just default to Key and user can switch.
    document.querySelector('input[name="authType"][value="key"]').click();
    document.getElementById('srv-key').value = s.ssh_key_path;

    // UI Updates
    document.getElementById('form-title').textContent = "Edit Server";
    document.getElementById('add-server-btn').textContent = "Update Server";
    document.getElementById('cancel-edit-btn').style.display = 'block';
    document.getElementById('srv-pass').placeholder = "Password (Leave empty to keep current)";
}

function resetForm() {
    document.getElementById('srv-id').value = '';
    document.getElementById('srv-name').value = '';
    document.getElementById('srv-ip').value = '';
    document.getElementById('srv-port').value = '';
    document.getElementById('srv-user').value = '';
    document.getElementById('srv-pass').value = '';
    document.getElementById('srv-key').value = '';

    document.getElementById('form-title').textContent = "Add New Server";
    document.getElementById('add-server-btn').textContent = "Add Server";
    document.getElementById('cancel-edit-btn').style.display = 'none';
    document.getElementById('srv-pass').placeholder = "Password";

    document.querySelector('input[name="authType"][value="key"]').click();
}

document.getElementById('cancel-edit-btn').onclick = resetForm;

// Auth Toggle Logic
const authRadios = document.getElementsByName('authType');
const passInput = document.getElementById('srv-pass');
const keyInput = document.getElementById('srv-key');

authRadios.forEach(radio => {
    radio.onchange = (e) => {
        if (e.target.value === 'password') {
            passInput.style.display = 'block';
            keyInput.style.display = 'none';
        } else {
            passInput.style.display = 'none';
            keyInput.style.display = 'block';
        }
    }
});

document.getElementById('add-server-btn').onclick = async () => {
    const id = document.getElementById('srv-id').value;
    const name = document.getElementById('srv-name').value;
    const ip = document.getElementById('srv-ip').value;
    const port = document.getElementById('srv-port').value || 22;
    const user = document.getElementById('srv-user').value;

    // Auth fields
    const authType = document.querySelector('input[name="authType"]:checked').value;
    let password = "";
    let sshKeyPath = "";

    if (authType === 'password') {
        password = passInput.value;
    } else {
        sshKeyPath = keyInput.value;
    }

    if (name && ip && user) {
        const payload = {
            name,
            ip_address: ip,
            ssh_port: parseInt(port),
            username: user,
            password: password,
            ssh_key_path: sshKeyPath // Empty string will imply "keep current" or "default" based on backend logic
        };

        if (id) {
            // Update
            await fetch(API_CONFIG_SERVERS + '/' + id, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
        } else {
            // Create
            await fetch(API_CONFIG_SERVERS, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }

        resetForm();
        loadServers();
    }
}

// Init
fetchHosts();
fetchVMs();

// Auto-refresh
function refreshAll() {
    fetchHosts();
    fetchVMs();
}
setInterval(refreshAll, 5000);

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
