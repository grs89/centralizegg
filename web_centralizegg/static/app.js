const API_HOSTS = '/api/hosts';
const API_VMS = '/api/vms';
const API_CONFIG_SERVERS = '/api/config/servers';

// Global state
let currentServers = [];
let currentTool = null;
let selectedHostId = null;



const tools = {
    'kvm': {
        name: 'KVM',
        icon: 'fa-solid fa-microchip',
        elementId: 'virtualization-tool',
        categoryBtnId: 'virtualization-btn',
        categoryName: 'Virtualización'
    },
    'proxmox': {
        name: 'Proxmox',
        icon: 'fa-solid fa-server',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'virtualization-btn',
        categoryName: 'Virtualización'
    },
    'nas': {
        name: 'NAS',
        icon: 'fa-solid fa-hdd',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'storage-btn',
        categoryName: 'Almacenamiento'
    },
    'ceph': {
        name: 'Ceph',
        icon: 'fa-solid fa-cubes',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'storage-btn',
        categoryName: 'Almacenamiento'
    },
    'docker': {

        name: 'Docker',
        icon: 'fa-brands fa-docker',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'containers-btn',
        categoryName: 'Contenedores'
    },
    'podman': {
        name: 'Podman',
        icon: 'fa-solid fa-box-archive',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'containers-btn',
        categoryName: 'Contenedores'
    },
    'web_services': {
        name: 'Servicios web',
        icon: 'fa-solid fa-globe',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'services-btn',
        categoryName: 'Servicios'
    },
    'db_services': {
        name: 'Servicios de DB',
        icon: 'fa-solid fa-database',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'services-btn',
        categoryName: 'Servicios'
    },
    'pfsense': {
        name: 'PFsense',
        icon: 'fa-solid fa-shield-halved',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'firewall-btn',
        categoryName: 'Firewall'
    },
    'log_web': {
        name: 'Log servicios web',
        icon: 'fa-solid fa-file-code',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'log-btn',
        categoryName: 'Log'
    },
    'log_db': {
        name: 'Log servicios db',
        icon: 'fa-solid fa-file-lines',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'log-btn',
        categoryName: 'Log'
    }
};




// Tool switcher logic
function switchTool(toolKey) {
    console.log('%c[DEBUG] switchTool triggered for:', 'color: #38bdf8; font-weight: bold', toolKey);

    const tool = tools[toolKey];
    if (!tool) {
        console.warn('[DEBUG] Tool configuration not found for key:', toolKey);
        return;
    }

    currentTool = toolKey;

    // Update Category Button Identity
    try {
        const categoryBtn = document.getElementById(tool.categoryBtnId);
        if (categoryBtn) {
            categoryBtn.innerHTML = `
                <i class="${tool.icon}"></i> ${tool.name} <i class="fa-solid fa-chevron-down" style="font-size: 0.8rem; margin-left: 5px;"></i>
            `;
            console.log('[DEBUG] Category button updated:', tool.categoryBtnId);
        }
    } catch (e) {
        console.error('[DEBUG] Failed to update category button:', e);
    }

    // Comprehensive visibility management
    const welcomeScreen = document.getElementById('welcome-screen');
    const virtTool = document.getElementById('virtualization-tool');
    const containerTool = document.getElementById('container-scanner-tool');

    if (welcomeScreen) welcomeScreen.style.display = 'none'; // Force hide

    if (virtTool) {
        if (toolKey === 'kvm') {
            virtTool.classList.remove('hidden');
            console.log('[DEBUG] Showing virtualization-tool');
        } else {
            virtTool.classList.add('hidden');
        }
    }

    if (containerTool) {
        if (toolKey !== 'kvm') {
            containerTool.classList.remove('hidden');
            console.log('[DEBUG] Showing container-scanner-tool');

            // Update placeholder content
            const icon = containerTool.querySelector('.scanner-section i');
            const title = containerTool.querySelector('h2');
            const desc = containerTool.querySelector('p');
            if (icon) icon.className = tool.icon;
            if (title) title.textContent = `${tool.name} Management`;
            if (desc) desc.textContent = `Gestión completa de ${tool.name} próximamente.`;
        } else {
            containerTool.classList.add('hidden');
        }
    }

    // Update Config Button Visibility
    const configBtn = document.getElementById('config-btn');
    if (configBtn) {
        configBtn.style.display = (toolKey === 'kvm') ? 'block' : 'none';
    }

    // Trigger data fetch for KVM
    if (toolKey === 'kvm') {
        console.log('[DEBUG] Refreshing KVM data...');
        refreshAll();
    }
}

// Global click handler (Event Delegation)
document.addEventListener('click', (e) => {
    const toolLink = e.target.closest('[data-tool]');
    if (toolLink) {
        e.preventDefault();
        e.stopPropagation();
        const toolKey = toolLink.getAttribute('data-tool');
        console.log('[DEBUG] Valid tool click detected:', toolKey);
        switchTool(toolKey);
    }
}, true); // Navigation to home (welcome screen)
function goHome() {
    console.log('[DEBUG] Navigating to home screen');
    currentTool = null;
    selectedHostId = null; // Reset selection

    // Reset visibility

    const welcomeScreen = document.getElementById('welcome-screen');
    const virtTool = document.getElementById('virtualization-tool');
    const containerTool = document.getElementById('container-scanner-tool');

    if (welcomeScreen) welcomeScreen.style.display = 'block';
    if (virtTool) virtTool.classList.add('hidden');
    if (containerTool) containerTool.classList.add('hidden');

    // Hide Config UI
    const configBtn = document.getElementById('config-btn');
    if (configBtn) configBtn.style.display = 'none';
}

window.goHome = goHome;
window.switchTool = switchTool;

function selectHost(id) {
    console.log('[DEBUG] Selected Host ID:', id);
    selectedHostId = id;
    fetchHosts(); // Re-render hosts to show active state
    fetchVMs();   // Filter VMs
}
window.selectHost = selectHost;

function showMemoryPopover(e, id) {
    e.stopPropagation();

    // Find the host card (parent of the stat-card)
    const hostCard = e.currentTarget.closest('.host-node-card');
    if (!hostCard) return;

    // Remove existing popover in this card
    const existing = hostCard.querySelector('.memory-popover');
    if (existing) {
        existing.remove();
        return;
    }

    // Also remove any other popovers anywhere else to avoid clutter
    document.querySelectorAll('.memory-popover').forEach(p => p.remove());

    fetch(API_HOSTS).then(res => res.json()).then(hosts => {
        const host = hosts.find(h => h.id === id);
        if (!host) return;

        const popover = document.createElement('div');
        popover.className = 'memory-popover glass-panel';

        const memTotalGB = (host.total_memory / (1024 * 1024 * 1024)).toFixed(2);
        const memFreeGB = (host.free_memory / (1024 * 1024 * 1024)).toFixed(2);
        const usedBytes = host.total_memory - host.free_memory;
        const usedPercent = host.total_memory > 0 ? ((usedBytes / host.total_memory) * 100).toFixed(1) : 0;

        popover.innerHTML = `
            <div class="popover-header">
                <span><i class="fa-solid fa-memory"></i> Detalle de Memoria</span>
                <i class="fa-solid fa-xmark close-popover"></i>
            </div>
            <div class="popover-body">
                <div class="popover-metric">
                    <div class="metric-info">
                        <span>Uso en Tiempo Real</span>
                        <span>${usedPercent}%</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${usedPercent}%"></div>
                    </div>
                </div>
                <div class="popover-stats">
                    <div class="p-stat"><strong>Total:</strong> ${memTotalGB} GB</div>
                    <div class="p-stat"><strong>Libre:</strong> ${memFreeGB} GB</div>
                </div>
            </div>
        `;

        hostCard.appendChild(popover);

        // Close logic
        popover.querySelector('.close-popover').onclick = (ev) => {
            ev.stopPropagation();
            popover.remove();
        };

        const closeHandler = (ev) => {
            if (!popover.contains(ev.target)) {
                popover.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    });
}


window.showMemoryPopover = showMemoryPopover;

function showCPUPopover(e, id) {
    e.stopPropagation();

    // Find the host card
    const hostCard = e.currentTarget.closest('.host-node-card');
    if (!hostCard) return;

    // Remove existing popover in this card
    const existing = hostCard.querySelector('.cpu-popover');
    if (existing) {
        existing.remove();
        return;
    }

    // Remove others
    document.querySelectorAll('.memory-popover, .cpu-popover').forEach(p => p.remove());

    fetch(API_HOSTS).then(res => res.json()).then(hosts => {
        const host = hosts.find(h => h.id === id);
        if (!host) return;

        const popover = document.createElement('div');
        popover.className = 'cpu-popover glass-panel';

        const usedPercent = host.cpu_usage ? host.cpu_usage.toFixed(1) : "0.0";
        const freePercent = (100 - parseFloat(usedPercent)).toFixed(1);

        popover.innerHTML = `
            <div class="popover-header">
                <span><i class="fa-solid fa-microchip"></i> Detalle de CPU</span>
                <i class="fa-solid fa-xmark close-popover"></i>
            </div>
            <div class="popover-body">
                <div class="popover-metric">
                    <div class="metric-info">
                        <span>Uso de CPU</span>
                        <span>${usedPercent}%</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${usedPercent}%; background: var(--accent-color);"></div>
                    </div>
                </div>
                <div class="popover-stats">
                    <div class="p-stat"><strong>Ocupado:</strong> ${usedPercent}%</div>
                    <div class="p-stat"><strong>Libre:</strong> ${freePercent}%</div>
                </div>
            </div>
        `;

        hostCard.appendChild(popover);

        popover.querySelector('.close-popover').onclick = (ev) => {
            ev.stopPropagation();
            popover.remove();
        };

        const closeHandler = (ev) => {
            if (!popover.contains(ev.target)) {
                popover.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    });
}
window.showCPUPopover = showCPUPopover;

console.log('[DEBUG] Application core initialized.');




async function fetchHosts() {
    try {
        const response = await fetch(API_HOSTS);
        if (!response.ok) throw new Error('Failed to fetch hosts');
        const hosts = await response.json();

        // Sort hosts alphabetically by server_name
        if (hosts && Array.isArray(hosts)) {
            hosts.sort((a, b) => a.server_name.localeCompare(b.server_name));
        }

        const container = document.getElementById('host-nodes-container');

        if (!container) return;

        if (!hosts || hosts.length === 0) {
            container.innerHTML = '<div class="loading-state">No hosts monitored yet...</div>';
            return;
        }

        container.innerHTML = hosts.map(host => {
            const memGB = (host.total_memory / (1024 * 1024 * 1024)).toFixed(2);
            const isActive = selectedHostId === host.id ? 'active' : '';
            return `
            <div class="host-node-card glass-panel ${isActive}" onclick="selectHost(${host.id})">
                <div class="host-node-header">
                    <div class="host-node-titles">
                        <div class="host-node-main-title">${host.server_name}</div>
                        <div class="host-node-sub-title"> ${host.hostname} | ${host.ip_address}</div>
                        <div class="host-node-sub-title" style="margin-top: 5px; opacity: 0.8;"><i class="fa-brands fa-linux"></i> ${host.os_name || 'Detectando SO...'}</div>
                    </div>

                </div>
                <div class="host-stats">
                    <div class="stat-card clickable" onclick="showMemoryPopover(event, ${host.id})">
                        <div class="icon"><i class="fa-solid fa-memory"></i></div>
                        <div class="info">
                            <span class="label">Memory</span>
                            <span class="value">${memGB} GB</span>
                        </div>
                    </div>

                    <div class="stat-card clickable" onclick="showCPUPopover(event, ${host.id})">
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

        // Sort VMs alphabetically by name
        if (vms && Array.isArray(vms)) {
            vms.sort((a, b) => a.name.localeCompare(b.name));
        }

        const grid = document.getElementById('vm-grid');

        if (!selectedHostId) {
            grid.innerHTML = '<div class="loading-state" style="opacity:0.6;"><i class="fa-solid fa-arrow-up"></i> Selecciona un Host Node para ver sus VMs</div>';
            return;
        }

        // Sort and Filter VMs
        let filteredVMs = [];
        if (vms && Array.isArray(vms)) {
            filteredVMs = vms.filter(vm => vm.host_id === selectedHostId);
            filteredVMs.sort((a, b) => a.name.localeCompare(b.name));
        }

        if (filteredVMs.length === 0) {
            grid.innerHTML = '<div class="loading-state">No hay VMs en este host o están cargando...</div>';
            return;
        }

        grid.innerHTML = filteredVMs.map(vm => {

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
// fetchHosts();
// fetchVMs();

// Notification toggle
const notifBtn = document.getElementById('notification-btn');
const notifDropdown = document.getElementById('notification-dropdown');

if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notifDropdown.classList.toggle('hidden');
    });

    notifDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    document.addEventListener('click', () => {
        notifDropdown.classList.add('hidden');
    });
}


async function checkServerStatus() {
    try {
        const response = await fetch(API_CONFIG_SERVERS);
        if (!response.ok) return;
        const servers = await response.json();

        const offlineServers = servers.filter(s => s.status === 'offline');
        const badge = document.getElementById('notification-count');
        const list = document.getElementById('notification-list');

        if (offlineServers.length > 0) {
            badge.textContent = offlineServers.length;
            badge.classList.remove('hidden');

            list.innerHTML = offlineServers.map(s => `
                <li>
                    <i class="fa-solid fa-circle-exclamation"></i>
                    <div>
                        <span class="offline-host-name">${s.name} no accesible</span>
                        <span class="offline-details">${s.ip_address}:${s.ssh_port || 22}</span>
                    </div>
                </li>
            `).join('');
        } else {
            badge.classList.add('hidden');
            list.innerHTML = '<li style="color:var(--text-secondary); text-align:center; display:block;">Todos los sistemas operativos</li>';
        }
    } catch (e) {
        console.error('Status check error:', e);
    }
}

// Auto-refresh
function refreshAll() {
    checkServerStatus();
    if (currentTool === 'kvm') {
        fetchHosts();
        fetchVMs();
    }
}

setInterval(refreshAll, 5000);
checkServerStatus(); // Run immediately




function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
