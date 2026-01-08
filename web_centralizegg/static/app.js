const API_HOSTS = '/api/hosts';
const API_VMS = '/api/vms';
const API_CONFIG_SERVERS = '/api/config/servers';

// Global state
let currentServers = [];
let currentTool = null;
let selectedHostId = null;

// Cache for search
let allHostsCache = [];
let allVMsCache = [];
let searchQuery = "";
let selectedSuggestionIndex = -1;



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

// Search Input Listener
const searchInput = document.getElementById('global-search');
const suggestionsContainer = document.getElementById('search-suggestions');

searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    console.log('[DEBUG] Search Query:', searchQuery);

    selectedSuggestionIndex = -1; // Reset selection
    updateSuggestions();

    renderHosts();
    renderVMs();
});

searchInput?.addEventListener('keydown', (e) => {
    const items = suggestionsContainer.querySelectorAll('.suggestion-item');
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
        updateSuggestionSelection(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0);
        updateSuggestionSelection(items);
    } else if (e.key === 'Enter') {
        if (selectedSuggestionIndex >= 0 && items[selectedSuggestionIndex]) {
            e.preventDefault();
            items[selectedSuggestionIndex].click();
        }
    } else if (e.key === 'Escape') {
        suggestionsContainer.classList.add('hidden');
    }
});

// Close suggestions when clicking outside
document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
        suggestionsContainer.classList.add('hidden');
    }
});

function updateSuggestionSelection(items) {
    items.forEach((item, index) => {
        if (index === selectedSuggestionIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function updateSuggestions() {
    if (!searchQuery || searchQuery.length < 1) {
        suggestionsContainer.innerHTML = '';
        suggestionsContainer.classList.add('hidden');
        return;
    }

    const suggestions = [];

    // Match Hosts
    allHostsCache.forEach(host => {
        if (host.server_name.toLowerCase().includes(searchQuery) ||
            host.hostname.toLowerCase().includes(searchQuery) ||
            host.ip_address.toLowerCase().includes(searchQuery)) {
            suggestions.push({
                type: 'host',
                id: host.id,
                title: host.server_name,
                subtitle: `${host.hostname} | ${host.ip_address}`,
                icon: 'fa-solid fa-server',
                original: host
            });
        }
    });

    // Match VMs
    allVMsCache.forEach(vm => {
        if (vm.name.toLowerCase().includes(searchQuery)) {
            const host = allHostsCache.find(h => h.id === vm.host_id);
            suggestions.push({
                type: 'vm',
                id: vm.host_id, // We want to select the host to see the VM
                title: vm.name,
                subtitle: host ? `Host: ${host.server_name}` : 'Virtual Machine',
                icon: 'fa-solid fa-desktop',
                original: vm
            });
        }
    });

    if (suggestions.length === 0) {
        suggestionsContainer.innerHTML = '';
        suggestionsContainer.classList.add('hidden');
        return;
    }

    // Limit suggestions
    const limitedSuggestions = suggestions.slice(0, 8);

    suggestionsContainer.innerHTML = limitedSuggestions.map((s, idx) => `
        <div class="suggestion-item" onclick="applySuggestion('${s.type}', ${s.id}, '${s.title.replace(/'/g, "\\'")}')">
            <i class="${s.icon}"></i>
            <div class="suggestion-content">
                <span class="suggestion-title">${s.title}</span>
                <span class="suggestion-subtitle">${s.subtitle}</span>
            </div>
            <span class="suggestion-category">${s.type}</span>
        </div>
    `).join('');

    suggestionsContainer.classList.remove('hidden');
}

window.applySuggestion = (type, hostId, title) => {
    searchQuery = title.toLowerCase();
    searchInput.value = title;
    suggestionsContainer.classList.add('hidden');

    // If it's KVM, select the host
    if (currentTool === 'kvm' || !currentTool) {
        if (currentTool !== 'kvm') switchTool('kvm');
        selectHost(hostId);
    }

    renderHosts();
    renderVMs();
};


async function fetchHosts() {
    try {
        const response = await fetch(API_HOSTS);
        if (!response.ok) throw new Error('Failed to fetch hosts');
        const hosts = await response.json();

        // Sort hosts alphabetically by server_name
        if (hosts && Array.isArray(hosts)) {
            hosts.sort((a, b) => a.server_name.localeCompare(b.server_name));
        }

        allHostsCache = hosts || [];
        renderHosts();
    } catch (e) {
        console.error(e);
        const container = document.getElementById('host-nodes-container');
        if (container) container.innerHTML = '<div class="loading-state" style="color:var(--danger)">Failed to load hosts</div>';
    }
}

function renderHosts() {
    const container = document.getElementById('host-nodes-container');
    if (!container) return;

    if (!allHostsCache || allHostsCache.length === 0) {
        container.innerHTML = '<div class="loading-state">No hosts monitored yet...</div>';
        return;
    }

    // Filter hosts based on search query OR if they contain matching VMs
    const filteredHosts = allHostsCache.filter(host => {
        if (!searchQuery) return true;

        const matchesHost = host.server_name.toLowerCase().includes(searchQuery) ||
            host.hostname.toLowerCase().includes(searchQuery) ||
            host.ip_address.toLowerCase().includes(searchQuery) ||
            (host.os_name && host.os_name.toLowerCase().includes(searchQuery));

        // Also show host if any of its VMs match
        const hasMatchingVM = allVMsCache.some(vm =>
            vm.host_id === host.id && vm.name.toLowerCase().includes(searchQuery)
        );

        return matchesHost || hasMatchingVM;
    });

    if (filteredHosts.length === 0) {
        container.innerHTML = '<div class="loading-state">No se encontraron resultados para "' + searchQuery + '"</div>';
        return;
    }

    container.innerHTML = filteredHosts.map(host => {
        const memTotalGB = (host.total_memory / (1024 * 1024 * 1024)).toFixed(1);
        const memFreeGB = (host.free_memory / (1024 * 1024 * 1024)).toFixed(1);
        const memUsedGB = (parseFloat(memTotalGB) - parseFloat(memFreeGB)).toFixed(1);
        const memPercent = host.total_memory > 0 ? (((host.total_memory - host.free_memory) / host.total_memory) * 100).toFixed(0) : 0;

        const cpuPercent = host.cpu_usage ? host.cpu_usage.toFixed(0) : 0;
        const isActive = selectedHostId === host.id ? 'active' : '';

        // Find if server is online from currentServers (config)
        const serverConfig = currentServers.find(s => s.id === host.server_id);
        const isOnline = serverConfig ? serverConfig.status === 'online' : true;

        return `
        <div class="host-node-card glass-panel ${isActive}" onclick="selectHost(${host.id})">
            <div class="host-node-header">
                <div class="host-node-identity">
                    <div class="host-icon-box">
                        <i class="fa-solid fa-server"></i>
                    </div>
                    <div class="host-title-group">
                        <h3>${host.server_name}</h3>
                        <div class="ip-badge">${host.ip_address}</div>
                    </div>
                </div>
                <div class="host-status-badge ${isOnline ? '' : 'offline'}">
                    <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
                    ${isOnline ? 'Online' : 'Offline'}
                </div>
            </div>

            <div class="host-os-info" style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                <i class="${getOSIcon(host.os_name)} fa-fw" style="font-size: 1rem; color: var(--accent-color);"></i>
                <span>${host.os_name || 'Linux Generic'}</span>
            </div>

            <div class="host-stats-grid">
                <!-- CPU Stat -->
                <div class="host-stat-item">
                    <div class="stat-label-row">
                        <i class="fa-solid fa-microchip"></i>
                        <span>CPU</span>
                    </div>
                    <div class="stat-value-display">
                        <div class="stat-value-main" style="color: ${getStatusColor(cpuPercent)};">${cpuPercent}%</div>
                        <div class="host-progress-container">
                            <div class="host-progress-fill" style="width: ${cpuPercent}%; background: ${getStatusColor(cpuPercent)};"></div>
                        </div>
                    </div>
                </div>

                <!-- Memory Stat -->
                <div class="host-stat-item">
                    <div class="stat-label-row">
                        <i class="fa-solid fa-memory"></i>
                        <span>Memoria</span>
                    </div>
                    <div class="stat-value-display">
                        <div class="stat-value-main" style="color: ${getStatusColor(memPercent)};">
                            ${memPercent}% <span class="stat-value-sub" style="font-size: 0.75rem; color: inherit; opacity: 0.8;">(${memUsedGB} / ${memTotalGB} GB)</span>
                        </div>
                        <div class="host-progress-container">
                            <div class="host-progress-fill" style="width: ${memPercent}%; background: ${getStatusColor(memPercent)};"></div>
                        </div>
                    </div>
                </div>

                <!-- Disk Stat (Placeholder) -->
                <div class="host-stat-item">
                    <div class="stat-label-row">
                        <i class="fa-solid fa-hard-drive"></i>
                        <span>Disco</span>
                    </div>
                    <div class="stat-value-display">
                        <div class="stat-value-main" style="color: ${getStatusColor(67)};">67%</div>
                        <div class="host-progress-container">
                            <div class="host-progress-fill" style="width: 67%; background: ${getStatusColor(67)};"></div>
                        </div>
                    </div>
                </div>

                <!-- Cores Stat -->
                <div class="host-stat-item">
                    <div class="stat-label-row">
                        <i class="fa-solid fa-layer-group"></i>
                        <span>Cores</span>
                    </div>
                    <div class="stat-value-display">
                        <div class="stat-value-main color-cores">${host.cpu_cores}</div>
                        <div class="stat-value-sub">x86_64</div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }).join('');
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

        allVMsCache = vms || [];
        renderVMs();
    } catch (e) {
        console.error(e);
        const grid = document.getElementById('vm-grid');
        if (grid) grid.innerHTML = '<div class="loading-state" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i> Connection Lost</div>';
    }
}

function renderVMs() {
    const grid = document.getElementById('vm-grid');
    if (!grid) return;

    if (!selectedHostId) {
        grid.innerHTML = '<div class="loading-state" style="opacity:0.6;"><i class="fa-solid fa-arrow-up"></i> Selecciona un Host Node para ver sus VMs</div>';
        return;
    }

    // Filter and Sort VMs
    let filteredVMs = allVMsCache.filter(vm => vm.host_id === selectedHostId);

    // Apply search filter
    if (searchQuery) {
        filteredVMs = filteredVMs.filter(vm =>
            vm.name.toLowerCase().includes(searchQuery) ||
            vm.state.toLowerCase().includes(searchQuery)
        );
    }

    if (filteredVMs.length === 0) {
        const msg = searchQuery ? `No se encontraron VMs que coincidan con "${searchQuery}"` : "No hay VMs en este host o están cargando...";
        grid.innerHTML = `<div class="loading-state">${msg}</div>`;
        return;
    }

    grid.innerHTML = filteredVMs.map(vm => {
        const memTotalGB = (vm.max_memory / (1024 * 1024 * 1024)).toFixed(1);
        const memUsedGB = (vm.memory_usage / (1024 * 1024 * 1024)).toFixed(1);
        const memPercent = vm.max_memory > 0 ? ((vm.memory_usage / vm.max_memory) * 100).toFixed(0) : 0;

        const cpuPercent = vm.cpu_usage ? vm.cpu_usage.toFixed(0) : 0;

        const diskTotalGB = (vm.disk_capacity / (1024 * 1024 * 1024)).toFixed(1);
        const diskUsedGB = (vm.disk_allocation / (1024 * 1024 * 1024)).toFixed(1);
        const diskPercent = vm.disk_capacity > 0 ? ((vm.disk_allocation / vm.disk_capacity) * 100).toFixed(0) : 0;

        const isRunning = vm.state.toLowerCase() === 'running';

        return `
        <div class="vm-card glass-panel state-${vm.state}">
            <div class="vm-header">
                <div class="vm-identity">
                    <div class="vm-icon-box">
                        <i class="fa-solid fa-desktop"></i>
                    </div>
                    <div class="vm-title-group">
                        <h4>${vm.name}</h4>
                        <div class="vm-subtitle">${vm.vcpu} vCPU | ${isRunning ? 'En ejecución' : 'Apagada'}</div>
                    </div>
                </div>
                <div class="vm-status-badge ${isRunning ? 'running' : 'shutoff'}">
                    <span class="status-dot ${isRunning ? 'online' : ''}"></span>
                    ${vm.state}
                </div>
            </div>

            <div class="vm-stats-grid" style="margin-top: 5px;">
                <!-- VM Memory -->
                <div class="vm-stat-item">
                    <div class="vm-stat-label">
                        <i class="fa-solid fa-memory"></i>
                        <span>Memoria</span>
                    </div>
                    <div class="stat-value-display">
                        <div class="vm-stat-value" style="color: ${getStatusColor(memPercent)};">
                            ${memPercent}% <span class="vm-stat-sub">(${memUsedGB}/${memTotalGB}GB)</span>
                        </div>
                        <div class="host-progress-container" style="height: 4px;">
                            <div class="host-progress-fill" style="width: ${memPercent}%; background: ${getStatusColor(memPercent)};"></div>
                        </div>
                    </div>
                </div>

                <!-- VM CPU Usage -->
                <div class="vm-stat-item">
                    <div class="vm-stat-label">
                        <i class="fa-solid fa-microchip"></i>
                        <span>CPU Usage</span>
                    </div>
                    <div class="stat-value-display">
                        <div class="vm-stat-value" style="color: ${getStatusColor(cpuPercent)};">${cpuPercent}%</div>
                        <div class="host-progress-container" style="height: 4px;">
                            <div class="host-progress-fill" style="width: ${cpuPercent}%; background: ${getStatusColor(cpuPercent)};"></div>
                        </div>
                    </div>
                </div>

                <!-- VM Disk -->
                <div class="vm-stat-item">
                    <div class="vm-stat-label">
                        <i class="fa-solid fa-hard-drive"></i>
                        <span>Disco</span>
                    </div>
                    <div class="stat-value-display">
                        <div class="vm-stat-value" style="color: ${getStatusColor(diskPercent)};">
                            ${diskPercent}% <span class="vm-stat-sub">(${diskUsedGB}/${diskTotalGB}GB)</span>
                        </div>
                        <div class="host-progress-container" style="height: 4px;">
                            <div class="host-progress-fill" style="width: ${diskPercent}%; background: ${getStatusColor(diskPercent)};"></div>
                        </div>
                    </div>
                </div>

                <!-- Network info as subtext -->
                <div class="vm-stat-item">
                    <div class="vm-stat-label">
                        <i class="fa-solid fa-network-wired"></i>
                        <span>Network</span>
                    </div>
                    <div class="stat-value-display">
                        <div class="vm-stat-sub" style="font-size: 0.75rem;">RX: ${formatBytes(vm.net_rx, 1)}</div>
                        <div class="vm-stat-sub" style="font-size: 0.75rem;">TX: ${formatBytes(vm.net_tx, 1)}</div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }).join('');

    const now = new Date();
    const lastUpdated = document.getElementById('last-updated');
    if (lastUpdated) lastUpdated.textContent = now.toLocaleTimeString();
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

        currentServers = servers || []; // Sync global state

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

function getOSIcon(osName) {
    if (!osName) return 'fa-brands fa-linux';
    const os = osName.toLowerCase();

    // Default fallback
    let icon = 'fa-brands fa-linux';

    if (os.includes('ubuntu')) icon = 'fa-brands fa-ubuntu';
    else if (os.includes('debian')) icon = 'fa-brands fa-linux'; // Use linux penguin for debian for better compatibility
    else if (os.includes('fedora')) icon = 'fa-brands fa-fedora';
    else if (os.includes('centos')) icon = 'fa-brands fa-centos';
    else if (os.includes('windows')) icon = 'fa-brands fa-windows';
    else if (os.includes('red hat') || os.includes('rhel')) icon = 'fa-brands fa-redhat';
    else if (os.includes('suse')) icon = 'fa-brands fa-suse';

    return icon;
}

function getStatusColor(percent) {
    const val = parseFloat(percent);
    if (val <= 60) return '#22c55e'; // Success Green
    if (val <= 80) return '#eab308'; // Warning Yellow/Amber
    return '#ef4444'; // Danger Red
}
