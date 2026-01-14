const API_HOSTS = '/api/hosts';
// app.js - v1.2.1
const API_VMS = '/api/vms';
const API_CONFIG_SERVERS = '/api/config/servers';
const API_FIREWALL_HOSTS = '/api/firewall/hosts';
const API_FIREWALL_SERVERS = '/api/firewall/servers';
const API_CONTAINER_HOSTS = '/api/containers/hosts';
const API_CONTAINER_CONTAINERS = '/api/containers/containers';

// Helper function to get config API endpoint for current tool
function getConfigAPIForTool(toolKey) {
    const apiMap = {
        'kvm': API_CONFIG_SERVERS,
        'pfsense': API_FIREWALL_SERVERS,
        'proxmox': '/api/config/proxmox',
        'nas': '/api/config/nas',
        'ceph': '/api/config/ceph',
        'docker': '/api/config/docker',
        'podman': '/api/config/podman'
    };
    return apiMap[toolKey] || API_CONFIG_SERVERS;
}

// Global state
let currentServers = [];      // For KVM
let currentFirewallServers = [];
let currentDockerServers = [];
let currentTool = null;
let selectedHostId = null;

// Cache for search
let allHostsCache = [];
let allVMsCache = [];
let searchQuery = "";
let selectedSuggestionIndex = -1;

// VM Network History Cache
const vmNetworkHistory = {}; // Key: vmId, Value: { rx: [], tx: [], lastRx, lastTx, lastTime }
// Bridge Network History Cache
const bridgeNetworkHistory = {}; // Key: hostId_brName, Value: { rx: [], tx: [], lastRx, lastTx, lastTime }
// Firewall Network History Cache
const pfSenseNetworkHistory = {}; // Key: hostId_ifaceName, Value: { rx: [], tx: [], lastRx, lastTx, lastTime }
// Container Network History Cache
const containerNetworkHistory = {}; // Key: containerUniqueId, Value: { rx: [], tx: [], lastRx, lastTx, lastTime }
const HISTORY_POINTS = 20;
let lastRenderedVMsHash = "";

let selectedFirewallHostId = null;
let selectedDockerHostId = null;
let allContainersCache = [];

function updateNetworkHistory(vms) {
    const now = Date.now();
    vms.forEach(vm => {
        if (!vmNetworkHistory[vm.id]) {
            vmNetworkHistory[vm.id] = {
                rx: Array(HISTORY_POINTS).fill(0),
                tx: Array(HISTORY_POINTS).fill(0),
                lastRx: vm.net_rx,
                lastTx: vm.net_tx,
                lastTime: now
            };
        } else {
            const entry = vmNetworkHistory[vm.id];
            const timeDelta = (now - entry.lastTime) / 1000; // seconds

            if (timeDelta > 0) {
                // Calculate rate in Bytes/s
                // Handle counter reset/overflow rudimentarily (if current < last, assume 0 rate or just push 0)
                let rxRate = 0;
                let txRate = 0;

                if (vm.net_rx >= entry.lastRx) {
                    rxRate = (vm.net_rx - entry.lastRx) / timeDelta;
                }
                if (vm.net_tx >= entry.lastTx) {
                    txRate = (vm.net_tx - entry.lastTx) / timeDelta;
                }

                entry.rx.push(rxRate);
                entry.tx.push(txRate);

                if (entry.rx.length > HISTORY_POINTS) entry.rx.shift();
                if (entry.tx.length > HISTORY_POINTS) entry.tx.shift();

                entry.lastRx = vm.net_rx;
                entry.lastTx = vm.net_tx;
                entry.lastTime = now;
            }
        }
    });
}

function updateContainerHistory(containers) {
    const now = Date.now();
    containers.forEach(c => {
        const key = `${c.host_id}_${c.name}`;
        if (!containerNetworkHistory[key]) {
            containerNetworkHistory[key] = {
                rx: Array(HISTORY_POINTS).fill(0),
                tx: Array(HISTORY_POINTS).fill(0),
                lastRx: c.net_rx,
                lastTx: c.net_tx,
                lastTime: now
            };
        } else {
            const entry = containerNetworkHistory[key];
            const timeDelta = (now - entry.lastTime) / 1000;

            if (timeDelta > 0) {
                let rxRate = 0;
                let txRate = 0;

                if (c.net_rx >= entry.lastRx) rxRate = (c.net_rx - entry.lastRx) / timeDelta;
                if (c.net_tx >= entry.lastTx) txRate = (c.net_tx - entry.lastTx) / timeDelta;

                entry.rx.push(rxRate);
                entry.tx.push(txRate);

                if (entry.rx.length > HISTORY_POINTS) entry.rx.shift();
                if (entry.tx.length > HISTORY_POINTS) entry.tx.shift();

                entry.lastRx = c.net_rx;
                entry.lastTx = c.net_tx;
                entry.lastTime = now;
            }
        }
    });
}

function updateFirewallHistory(hosts) {
    const now = Date.now();
    hosts.forEach(host => {
        if (host.interfaces && Array.isArray(host.interfaces)) {
            host.interfaces.forEach(iface => {
                const key = `${host.id}_${iface.interface_name}`;
                if (!pfSenseNetworkHistory[key]) {
                    pfSenseNetworkHistory[key] = {
                        rx: Array(HISTORY_POINTS).fill(0),
                        tx: Array(HISTORY_POINTS).fill(0),
                        lastRx: parseFloat(iface.net_rx_bytes),
                        lastTx: parseFloat(iface.net_tx_bytes),
                        lastTime: now
                    };
                } else {
                    const entry = pfSenseNetworkHistory[key];
                    const timeDelta = (now - entry.lastTime) / 1000;

                    if (timeDelta > 0) {
                        let rxRate = 0;
                        let txRate = 0;

                        const currentRx = parseFloat(iface.net_rx_bytes);
                        const currentTx = parseFloat(iface.net_tx_bytes);

                        if (currentRx >= entry.lastRx) {
                            rxRate = (currentRx - entry.lastRx) / timeDelta;
                        }
                        if (currentTx >= entry.lastTx) {
                            txRate = (currentTx - entry.lastTx) / timeDelta;
                        }

                        entry.rx.push(rxRate);
                        entry.tx.push(txRate);

                        if (entry.rx.length > HISTORY_POINTS) entry.rx.shift();
                        if (entry.tx.length > HISTORY_POINTS) entry.tx.shift();

                        entry.lastRx = currentRx;
                        entry.lastTx = currentTx;
                        entry.lastTime = now;
                    }
                }
            });
        }
    });
}

function updateBridgeHistory(hosts) {
    const now = Date.now();
    hosts.forEach(host => {
        let bridges = [];
        try {
            if (host.bridge_interfaces) bridges = JSON.parse(host.bridge_interfaces);
        } catch (e) { return; }

        bridges.forEach(br => {
            const key = `${host.id}_${br.name}`;
            if (!bridgeNetworkHistory[key]) {
                bridgeNetworkHistory[key] = {
                    rx: Array(HISTORY_POINTS).fill(0),
                    tx: Array(HISTORY_POINTS).fill(0),
                    lastRx: br.net_rx,
                    lastTx: br.net_tx,
                    lastTime: now
                };
            } else {
                const entry = bridgeNetworkHistory[key];
                const timeDelta = (now - entry.lastTime) / 1000;

                if (timeDelta > 0) {
                    let rxRate = 0;
                    let txRate = 0;

                    if (br.net_rx >= entry.lastRx) {
                        rxRate = (br.net_rx - entry.lastRx) / timeDelta;
                    }
                    if (br.net_tx >= entry.lastTx) {
                        txRate = (br.net_tx - entry.lastTx) / timeDelta;
                    }

                    entry.rx.push(rxRate);
                    entry.tx.push(txRate);

                    if (entry.rx.length > HISTORY_POINTS) entry.rx.shift();
                    if (entry.tx.length > HISTORY_POINTS) entry.tx.shift();

                    entry.lastRx = br.net_rx;
                    entry.lastTx = br.net_tx;
                    entry.lastTime = now;
                }
            }
        });
    });
}

function renderDonutChart(percent, color, size = 50) {
    const strokeWidth = 5;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;

    return `
        <div class="donut-chart-container" style="position: relative; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center;">
            <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform: rotate(-90deg);">
                <!-- Background circle -->
                <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="${strokeWidth}" />
                <!-- Foreground circle -->
                <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"
                    stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
                    style="transition: stroke-dashoffset 0.5s ease-out; filter: drop-shadow(0 0 4px ${color}40);" />
            </svg>
            <div style="position: absolute; font-size: 0.75rem; font-weight: 700; color: ${color};">${percent}%</div>
        </div>
    `;
}

function renderSparkline(data, color, width = 100, height = 30) {
    if (!data || data.length < 2) return '';

    const max = Math.max(...data, 1); // Avoid div by zero
    // Scale points
    const points = data.map((val, idx) => {
        const x = (idx / (HISTORY_POINTS - 1)) * width;
        const y = height - ((val / max) * height);
        return `${x},${y}`;
    }).join(' ');

    return `
        <svg width="${width}" height="${height}" fill="none" class="sparkline">
            <polyline points="${points}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        </svg>
    `;
}



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
        icon: 'fa-brands fa-freebsd',
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
    selectedHostId = null;
    lastRenderedVMsHash = "";

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
            const scannerSection = containerTool.querySelector('.scanner-section');
            if (scannerSection) {
                // Always show scanner section for non-KVM tools, including pfSense
                scannerSection.style.display = 'block';
                const icon = containerTool.querySelector('.scanner-section i');
                const title = containerTool.querySelectorAll('.scanner-section h2')[0]; // Be precise
                const desc = containerTool.querySelector('.scanner-section p');
                const containerInner = containerTool.querySelector('.scanner-section .glass-panel');

                // Default reset
                if (containerInner) {
                    containerInner.style.textAlign = 'center';
                    let placeholderHtml = '';

                    if (toolKey === 'pfsense') {
                        renderFirewallSummary();
                    } else if (toolKey === 'docker') {
                        placeholderHtml = `
                            <div style="font-size: 4rem; color: var(--accent-color); margin-bottom: 2rem; opacity: 0.5;">
                                <i class="fa-brands fa-docker"></i>
                            </div>
                            <h2 style="margin-bottom: 1rem;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
                            <p style="color: var(--text-secondary); max-width: 500px; margin: 0 auto 2rem auto;">
                                Selecciona un Host Node arriba para ver sus contenedores y estadísticas en tiempo real.
                            </p>
                        `;
                    } else {
                        placeholderHtml = `
                            <div style="font-size: 4rem; color: var(--accent-color); margin-bottom: 2rem; opacity: 0.5;">
                                <i class="${tool.icon || 'fa-solid fa-box-open'}"></i>
                            </div>
                            <h2 style="margin-bottom: 1rem;">${tool.name} Management</h2>
                            <p style="color: var(--text-secondary); max-width: 500px; margin: 0 auto 2rem auto;">
                                Gestión completa de ${tool.name} próximamente.
                            </p>
                        `;
                    }
                }
            }

            // Update title for host nodes section
            const hostNodesTitle = document.getElementById('host-nodes-title-generic');
            if (hostNodesTitle) {
                hostNodesTitle.innerHTML = `<i class="${tool.icon}"></i> Host Nodes`;
            }

            // Render host nodes for this tool (will be empty if no hosts configured)
            checkAndFetchHostsForTool(toolKey);
        } else {
            containerTool.classList.add('hidden');
        }
    }

    // Update Config Button Visibility - show only if there are configured servers
    updateConfigButtonVisibility(toolKey);

    // Trigger data fetch based on tool
    if (toolKey === 'kvm') {
        console.log('[DEBUG] Refreshing KVM data...');
        refreshAll();
    } else if (toolKey === 'pfsense') {
        // For PFSense, fetch firewall hosts
        fetchFirewallHosts();
    } else {
        // For other tools, check if they have hosts configured
        checkAndFetchHostsForTool(toolKey);
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
    selectedFirewallHostId = null; // Reset firewall selection

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
    if (selectedHostId !== id) {
        selectedHostId = id;
        lastRenderedVMsHash = ""; // Reset render cache for new host
    }
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

    // Update KVM hosts
    renderHosts();

    // Update VMs if KVM tool is active
    if (currentTool === 'kvm') {
        renderVMs();
    }

    if (currentTool === 'docker') {
        renderDockerHostDetails(selectedDockerHostId);
    }

    // Also update generic host nodes container if visible (for other tools)
    const genericContainer = document.getElementById('host-nodes-container-generic');
    if (genericContainer) {
        const toolSection = genericContainer.closest('section');
        if (toolSection && !toolSection.closest('.hidden')) {
            const currentToolObj = tools[currentTool];
            if (currentToolObj && currentTool !== 'kvm') {
                renderHostNodes('host-nodes-container-generic', {
                    icon: currentToolObj.icon,
                    showOSInfo: true,
                    showStats: true
                });
            }
        }
    }
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


// Function to get the appropriate API endpoint for hosts based on tool
function getHostsAPIForTool(toolKey) {
    const toolHostsMap = {
        'kvm': API_HOSTS,
        'proxmox': API_HOSTS, // Proxmox uses same as KVM for now
        'pfsense': API_FIREWALL_HOSTS,
        'docker': API_CONTAINER_HOSTS,
        // Add more mappings as needed
    };
    return toolHostsMap[toolKey] || null;
}

// Function to check if a tool has configured servers and fetch hosts
async function checkAndFetchHostsForTool(toolKey) {
    const apiEndpoint = getHostsAPIForTool(toolKey);
    if (apiEndpoint) {
        try {
            const response = await fetch(apiEndpoint);
            if (response.ok) {
                const hosts = await response.json();
                if (hosts && hosts.length > 0) {
                    // Sort hosts alphabetically
                    hosts.sort((a, b) => {
                        const nameA = a.server_name || a.name || '';
                        const nameB = b.server_name || b.name || '';
                        return nameA.localeCompare(nameB);
                    });

                    // Update cache and render
                    if (toolKey === 'pfsense') {
                        allHostsCache = hosts || [];
                        renderHostNodes('host-nodes-container-generic', {
                            icon: tools[toolKey].icon,
                            showOSInfo: true,
                            showStats: true,
                            onHostClick: 'selectFirewallHost'
                        });
                        if (selectedFirewallHostId) {
                            renderFirewallHostDetails(selectedFirewallHostId);
                        }
                    } else if (toolKey === 'docker') {
                        allHostsCache = hosts || [];
                        renderHostNodes('host-nodes-container-generic', {
                            icon: tools[toolKey].icon,
                            showOSInfo: true,
                            showStats: true,
                            onHostClick: 'selectDockerHost'
                        });
                        if (selectedDockerHostId) {
                            renderDockerHostDetails(selectedDockerHostId);
                        } else {
                            renderDockerSummary();
                        }
                        fetchContainers();
                    } else {
                        fetchHosts();
                    }
                } else {
                    // No hosts, render empty
                    renderHostNodes('host-nodes-container-generic', {
                        icon: tools[toolKey].icon,
                        showOSInfo: true,
                        showStats: true,
                        hostsData: []
                    });
                }
            }
        } catch (e) {
            console.error('Error fetching hosts for tool:', e);
        }
    } else {
        // No API endpoint for this tool, render empty
        renderHostNodes('host-nodes-container-generic', {
            icon: tools[toolKey]?.icon || 'fa-solid fa-server',
            showOSInfo: true,
            showStats: true,
            hostsData: []
        });
    }
}

async function fetchContainers() {
    try {
        const response = await fetch(API_CONTAINER_CONTAINERS);
        if (!response.ok) throw new Error('Failed to fetch containers');
        allContainersCache = await response.json();
        updateContainerHistory(allContainersCache);
        if (currentTool === 'docker') {
            if (selectedDockerHostId) {
                renderDockerHostDetails(selectedDockerHostId);
            } else {
                renderDockerSummary();
            }
        }
    } catch (e) {
        console.error(e);
    }
}

function selectDockerHost(id) {
    selectedDockerHostId = id;
    renderHostNodes('host-nodes-container-generic', {
        icon: tools['docker']?.icon || 'fa-brands fa-docker',
        showOSInfo: true,
        showStats: true,
        onHostClick: 'selectDockerHost'
    });
    renderDockerHostDetails(id);
}
window.selectDockerHost = selectDockerHost;

function renderDockerHostDetails(hostId) {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    const host = allHostsCache.find(h => h.id === hostId);
    if (!host) return;

    const inner = scannerSection.querySelector('.glass-panel');
    if (!inner) return;

    inner.style.textAlign = 'left';
    inner.style.padding = '24px';
    inner.style.border = 'none';

    let filteredContainers = allContainersCache.filter(c => c.host_id === hostId);
    filteredContainers.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if (searchQuery) {
        filteredContainers = filteredContainers.filter(c =>
            c.name.toLowerCase().includes(searchQuery) ||
            c.image.toLowerCase().includes(searchQuery)
        );
    }

    // --- PARTIAL UPDATE LOGIC ---
    const isAlreadyRenderingHost = inner.getAttribute('data-host-id') === String(hostId);

    // Helpers for common rendering parts
    const renderAlertsList = () => {
        const alerts = [];

        // OOM Alerts
        filteredContainers.filter(c => c.oom_killed).forEach(c => {
            alerts.push(`
                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 8px; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.1); border-radius: 4px;">
                    <i class="fa-solid fa-circle-exclamation" style="color: #ef4444; margin-top: 2px;"></i>
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <span style="font-size: 0.8rem; font-weight: 700; color: #ef4444;">OOM Killed: ${c.name}</span>
                        <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.8;">Límite de memoria excedido</span>
                    </div>
                </div>
            `);
        });

        // Vulnerability Alerts (Critical/High)
        filteredContainers.filter(c => c.vulnerabilities && (c.vulnerabilities.includes('Critical:') || c.vulnerabilities.includes('High:'))).forEach(c => {
            const isCritical = c.vulnerabilities.includes('Critical:') && !c.vulnerabilities.includes('Critical:0');
            const isHigh = c.vulnerabilities.includes('High:') && !c.vulnerabilities.includes('High:0');

            if (isCritical || isHigh) {
                alerts.push(`
                    <div style="display: flex; align-items: flex-start; gap: 10px; padding: 8px; background: ${isCritical ? 'rgba(239, 68, 68, 0.05)' : 'rgba(234, 179, 8, 0.05)'}; border: 1px solid ${isCritical ? 'rgba(239, 68, 68, 0.1)' : 'rgba(234, 179, 8, 0.1)'}; border-radius: 4px;">
                        <i class="fa-solid fa-shield-virus" style="color: ${isCritical ? '#ef4444' : '#eab308'}; margin-top: 2px;"></i>
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <span style="font-size: 0.8rem; font-weight: 700; color: ${isCritical ? '#ef4444' : '#eab308'};">CVE: ${c.image}</span>
                            <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.8;">${c.vulnerabilities}</span>
                        </div>
                    </div>
                `);
            }
        });

        if (alerts.length === 0) {
            return `
                <div style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary); opacity: 0.6; font-size: 0.8rem;">
                    <i class="fa-solid fa-check-circle" style="color: #4ade80;"></i>
                    <span>Sin alertas críticas</span>
                </div>`;
        }
        return alerts.join('');
    };

    const renderContainerRows = () => {
        if (filteredContainers.length === 0) {
            return '<div style="text-align:center; padding: 40px; opacity:0.5;">No hay contenedores que mostrar</div>';
        }
        return filteredContainers.map(c => {
            const isRunning = (c.state || '').toLowerCase() === 'running';
            const memPercent = c.memory_limit > 0 ? (c.memory_usage / c.memory_limit * 100) : 0;

            return `
                <div style="display: grid; grid-template-columns: 2fr 1.5fr 0.8fr 1.2fr 1.8fr 1fr; gap: 15px; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); transition: all 0.2s ease;">
                    <!-- Name & Image -->
                    <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                        <i class="fa-brands fa-docker" style="color: ${isRunning ? '#4ade80' : '#ef4444'}; font-size: 1.2rem; opacity: 0.9;"></i>
                        <div style="display: flex; flex-direction: column; overflow: hidden;">
                            <span style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${c.name}">${c.name}</span>
                            <span style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c.image}</span>
                            ${c.ip_address ? `<span style="font-size: 0.65rem; color: var(--accent-color); font-family: monospace; opacity: 0.9;">${c.ip_address}</span>` : ''}
                            ${c.vulnerabilities && c.vulnerabilities !== 'Safe' ? `
                                <div style="display: flex; align-items: center; gap: 4px; margin-top: 2px;" title="${c.vulnerabilities}">
                                    <i class="fa-solid fa-shield-virus" style="font-size: 0.6rem; color: ${c.vulnerabilities.includes('Critical:') && !c.vulnerabilities.includes('Critical:0') ? '#ef4444' : '#eab308'};"></i>
                                    <span style="font-size: 0.65rem; font-weight: 600; color: ${c.vulnerabilities.includes('Critical:') && !c.vulnerabilities.includes('Critical:0') ? '#ef4444' : '#eab308'}; opacity: 0.9;">CVE</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Ports -->
                    <div style="font-size: 0.75rem; color: var(--text-secondary); opacity: 0.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${c.ports || 'N/A'}">
                        <span style="font-family: monospace;">${c.ports || '-'}</span>
                    </div>

                    <!-- CPU -->
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <div style="font-size: 0.85rem; font-weight: 600; color: ${getStatusColor(c.cpu_usage || 0)};">${(c.cpu_usage || 0).toFixed(1)}%</div>
                        <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                            <div style="height: 100%; width: ${Math.min(c.cpu_usage || 0, 100)}%; background: ${getStatusColor(c.cpu_usage || 0)};"></div>
                        </div>
                    </div>

                    <!-- RAM Usage / Limit -->
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <div style="font-size: 0.85rem; font-weight: 600; color: ${getStatusColor(memPercent)};">
                            ${formatBytes(c.memory_usage, 1)}
                        </div>
                        <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                            <div style="height: 100%; width: ${Math.min(memPercent, 100)}%; background: ${getStatusColor(memPercent)};"></div>
                        </div>
                    </div>

                    <!-- Network -->
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                            <span style="color: var(--text-secondary); opacity: 0.8;"><i class="fa-solid fa-arrow-down" style="font-size: 0.65rem; color: #4ade80;"></i> RX</span>
                            <span style="font-weight: 600; font-family: monospace;">${formatBytes(c.net_rx, 0)}</span>
                        </div>
                        <div style="height: 18px; width: 100%; opacity: 0.8;">
                            ${(() => {
                    const history = containerNetworkHistory[`${c.host_id}_${c.name}`];
                    return history ? renderSparkline(history.rx, '#4ade80', 100, 18) : '';
                })()}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; margin-top: 2px;">
                            <span style="color: var(--text-secondary); opacity: 0.8;"><i class="fa-solid fa-arrow-up" style="font-size: 0.65rem; color: #fb923c;"></i> TX</span>
                            <span style="font-weight: 600; font-family: monospace;">${formatBytes(c.net_tx, 0)}</span>
                        </div>
                        <div style="height: 18px; width: 100%; opacity: 0.8;">
                            ${(() => {
                    const history = containerNetworkHistory[`${c.host_id}_${c.name}`];
                    return history ? renderSparkline(history.tx, '#fb923c', 100, 18) : '';
                })()}
                        </div>
                    </div>

                    <!-- Disk -->
                    <div style="display: flex; flex-direction: column; gap: 1px; font-size: 0.8rem;">
                        <div style="display: flex; align-items: center; gap: 5px; color: var(--text-secondary); opacity: 0.8;" title="Disk Read (Block In)">
                            <i class="fa-solid fa-hard-drive" style="font-size: 0.7rem;"></i> ${formatBytes(c.block_in, 0)}
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; color: var(--text-secondary); opacity: 0.8;" title="Disk Write (Block Out)">
                            <i class="fa-solid fa-pen-to-square" style="font-size: 0.7rem;"></i> ${formatBytes(c.block_out, 0)}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    };

    if (isAlreadyRenderingHost) {
        // --- ONLY UPDATE DYNAMIC VALUES ---
        const statusEl = document.getElementById('docker-service-status');
        if (statusEl) {
            statusEl.textContent = host.docker_service_status || 'offline';
            statusEl.style.color = host.docker_service_status === 'active' ? '#4ade80' : '#ef4444';
            statusEl.style.background = host.docker_service_status === 'active' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';
            statusEl.style.borderColor = host.docker_service_status === 'active' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
        }

        const uptimeEl = document.getElementById('docker-host-uptime');
        if (uptimeEl) uptimeEl.textContent = host.uptime || 'N/A';

        const cpuEl = document.getElementById('docker-host-cpu-load');
        if (cpuEl) cpuEl.textContent = `${(host.cpu_usage || 0).toFixed(1)}%`;

        const latencyEl = document.getElementById('docker-host-latency');
        if (latencyEl) {
            latencyEl.textContent = `${host.docker_api_latency || 0} ms`;
            latencyEl.style.color = host.docker_api_latency < 500 ? '#4ade80' : '#eab308';
        }

        const alertsEl = document.getElementById('docker-alerts-list');
        if (alertsEl) alertsEl.innerHTML = renderAlertsList();

        const containersListEl = document.getElementById('docker-containers-list');
        if (containersListEl) containersListEl.innerHTML = renderContainerRows();

        // Update Storage values if elements exist
        const storageUsageEl = document.getElementById('docker-host-storage-usage');
        const storageBarEl = document.getElementById('docker-host-storage-bar');
        const inodesEl = document.getElementById('docker-host-inodes');
        const logsEl = document.getElementById('docker-host-logs');

        if (storageUsageEl) storageUsageEl.textContent = `${formatBytes(host.docker_storage_used, 1)} / ${formatBytes(host.docker_storage_total, 1)}`;
        if (storageBarEl) {
            const pct = host.docker_storage_total > 0 ? (host.docker_storage_used / host.docker_storage_total * 100) : 0;
            storageBarEl.style.width = `${pct}%`;
            storageBarEl.style.background = getStatusColor(pct);
        }
        if (inodesEl) inodesEl.textContent = host.docker_inodes_usage || '0%';
        if (logsEl) logsEl.textContent = formatBytes(host.docker_logs_size, 1);

        return; // Done with partial update
    }

    // --- FULL RENDER ---
    inner.setAttribute('data-host-id', hostId);
    inner.innerHTML = `
        <div style="display: grid; grid-template-columns: 350px 1fr; gap: 24px; align-items: start;">
            <!-- Left Column: Information -->
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    Información
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <!-- Docker Service Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">Servicio Docker</div>
                            <span id="docker-service-status" style="font-weight: 800; font-size: 0.7rem; color: ${host.docker_service_status === 'active' ? '#4ade80' : '#ef4444'}; text-transform: uppercase; background: ${host.docker_service_status === 'active' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; padding: 2px 6px; border-radius: 4px; border: 1px solid ${host.docker_service_status === 'active' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'};">
                                ${host.docker_service_status || 'offline'}
                            </span>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-plug" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                            <span>Socket: <span style="color: var(--text-primary); font-weight: 500;">${host.docker_socket_status || 'N/A'}</span></span>
                        </div>
                    </div>

                    <!-- System Info Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">Sistema y Versión</div>
                            <span style="color: #38bdf8; font-weight: 700; font-size: 0.75rem;">v${host.docker_version || 'N/A'}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                <i class="fa-solid fa-server" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                <span>OS: <span style="color: var(--text-primary); font-weight: 500;">${host.os_name || 'N/A'}</span></span>
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                <i class="fa-solid fa-clock-rotate-left" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                <span>Uptime: <span id="docker-host-uptime" style="color: var(--text-primary); font-weight: 500;">${host.uptime || 'N/A'}</span></span>
                            </div>
                        </div>
                    </div>

                    <!-- Performance Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 8px;">Rendimiento</div>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                    <i class="fa-solid fa-microchip" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                    <span>Carga CPU</span>
                                </div>
                                <span id="docker-host-cpu-load" style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${(host.cpu_usage || 0).toFixed(1)}%</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                    <i class="fa-solid fa-stopwatch" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                    <span>Latencia API</span>
                                </div>
                                <span id="docker-host-latency" style="font-weight: 700; font-size: 0.85rem; color: ${host.docker_api_latency < 500 ? '#4ade80' : '#eab308'};">${host.docker_api_latency || 0} ms</span>
                            </div>
                        </div>
                    </div>

                    <!-- Docker Storage Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 10px;">Almacenamiento Docker</div>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <!-- /var/lib/docker -->
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                                    <span style="color: var(--text-secondary);">/var/lib/docker</span>
                                    <span id="docker-host-storage-usage" style="font-weight: 600;">${formatBytes(host.docker_storage_used, 1)} / ${formatBytes(host.docker_storage_total, 1)}</span>
                                </div>
                                <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                                    <div id="docker-host-storage-bar" style="height: 100%; width: ${host.docker_storage_total > 0 ? (host.docker_storage_used / host.docker_storage_total * 100) : 0}%; background: ${getStatusColor(host.docker_storage_total > 0 ? (host.docker_storage_used / host.docker_storage_total * 100) : 0)};"></div>
                                </div>
                            </div>
                            <!-- Inodes & Logs Row -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px;">
                                <div style="display: flex; flex-direction: column; gap: 2px;">
                                    <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.8;">Inodos ocupados</span>
                                    <span id="docker-host-inodes" style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">${host.docker_inodes_usage || '0%'}</span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 2px;">
                                    <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.8;">Tamaño Logs (Total)</span>
                                    <span id="docker-host-logs" style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">${formatBytes(host.docker_logs_size, 1)}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-top: 5px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        Alertas
                    </div>

                    <!-- Alerts Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div id="docker-alerts-list" style="display: flex; flex-direction: column; gap: 8px;">
                            ${renderAlertsList()}
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Column: Containers -->
            <div style="flex: 1; min-width: 0;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    Contenedores
                </div>
                
                <div style="display: grid; grid-template-columns: 2fr 1.5fr 0.8fr 1.2fr 1.8fr 1fr; gap: 15px; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);">
                    <div>Nombre / Imagen</div>
                    <div>Puerto</div>
                    <div>CPU</div>
                    <div>Memoria</div>
                    <div>Red (RX/TX)</div>
                    <div style="text-align: right;">Disco</div>
                </div>

                <div id="docker-containers-list" style="display: flex; flex-direction: column;">
                    ${renderContainerRows()}
                </div>
            </div>
        </div>
    `;
}

// Function to update config button visibility based on tool and configured servers
async function updateConfigButtonVisibility(toolKey) {
    const configBtn = document.getElementById('config-btn');
    if (!configBtn) return;

    // All tools support configuration
    const configurableTools = ['kvm', 'proxmox', 'nas', 'ceph', 'pfsense', 'docker', 'podman'];

    if (!configurableTools.includes(toolKey)) {
        configBtn.style.display = 'none';
        return;
    }

    // Always show config button for configurable tools (allows adding new servers)
    configBtn.style.display = 'block';
}

// Fetch firewall hosts
async function fetchFirewallHosts() {
    try {
        const response = await fetch(API_FIREWALL_HOSTS);
        if (!response.ok) throw new Error('Failed to fetch firewall hosts');
        const hosts = await response.json();

        // Sort hosts alphabetically by server_name
        if (hosts && Array.isArray(hosts)) {
            hosts.sort((a, b) => (a.server_name || '').localeCompare(b.server_name || ''));
        }

        allHostsCache = hosts || [];
        updateFirewallHistory(allHostsCache);

        renderHostNodes('host-nodes-container-generic', {
            icon: tools[currentTool]?.icon || 'fa-solid fa-shield-halved',
            showOSInfo: true,
            showStats: true,
            onHostClick: 'selectFirewallHost' // Custom handler
        });

        if (selectedFirewallHostId) {
            renderFirewallHostDetails(selectedFirewallHostId);
        } else {
            renderFirewallSummary();
        }

        // Update config button visibility after fetching hosts
        if (currentTool) {
            updateConfigButtonVisibility(currentTool);
        }
    } catch (e) {
        console.error(e);
        const container = document.getElementById('host-nodes-container-generic');
        if (container) container.innerHTML = `<div class="loading-state" style="color:var(--danger)">Failed to load hosts: ${e.message}</div>`;
    }
}

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
        if (allHostsCache.length > 0) {
            updateBridgeHistory(allHostsCache);
        }
        renderHosts();

        // Update config button visibility after fetching hosts
        if (currentTool) {
            updateConfigButtonVisibility(currentTool);
        }

        // Also update generic host nodes container if visible (for other tools)
        const genericContainer = document.getElementById('host-nodes-container-generic');
        if (genericContainer) {
            const toolSection = genericContainer.closest('section');
            if (toolSection && !toolSection.closest('.hidden')) {
                const currentToolObj = tools[currentTool];
                if (currentToolObj && currentTool !== 'kvm') {
                    checkAndFetchHostsForTool(currentTool);
                }
            }
        }
    } catch (e) {
        console.error(e);
        const container = document.getElementById('host-nodes-container');
        if (container) container.innerHTML = '<div class="loading-state" style="color:var(--danger)">Failed to load hosts</div>';
        const genericContainer = document.getElementById('host-nodes-container-generic');
        if (genericContainer) genericContainer.innerHTML = '<div class="loading-state" style="color:var(--danger)">Failed to load hosts</div>';
    }
}

// Generic function to render host nodes for any tool
function renderHostNodes(containerId = 'host-nodes-container', config = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Use allHostsCache by default, or custom data if provided
    const hostsData = config.hostsData || allHostsCache;
    const customFilter = config.customFilter || null;
    const onHostClick = config.onHostClick || 'selectHost'; // Default to string for onclick
    const showOSInfo = config.showOSInfo !== false; // Default true
    const showStats = config.showStats !== false; // Default true
    const customIcon = config.icon || 'fa-solid fa-server';

    if (!hostsData || hostsData.length === 0) {
        container.innerHTML = '<div class="loading-state" style="opacity:0.6; text-align:center; padding:3rem;">No hay hosts configurados para esta herramienta</div>';
        return;
    }

    // Filter hosts based on search query OR if they contain matching VMs
    let filteredHosts = hostsData;

    if (customFilter) {
        filteredHosts = hostsData.filter(customFilter);
    } else {
        filteredHosts = hostsData.filter(host => {
            if (!searchQuery) return true;

            const matchesHost = host.server_name?.toLowerCase().includes(searchQuery) ||
                host.hostname?.toLowerCase().includes(searchQuery) ||
                host.ip_address?.toLowerCase().includes(searchQuery) ||
                (host.os_name && host.os_name.toLowerCase().includes(searchQuery));

            // Also show host if any of its VMs match (for KVM)
            const hasMatchingVM = allVMsCache.some(vm =>
                vm.host_id === host.id && vm.name.toLowerCase().includes(searchQuery)
            );

            return matchesHost || hasMatchingVM;
        });
    }

    if (filteredHosts.length === 0) {
        container.innerHTML = '<div class="loading-state">No se encontraron resultados para "' + searchQuery + '"</div>';
        return;
    }

    container.innerHTML = filteredHosts.map(host => {
        const memTotal = host.total_memory || 0;
        const memFree = host.free_memory || 0;
        const memTotalGB = (memTotal / (1024 * 1024 * 1024)).toFixed(1);
        const memFreeGB = (memFree / (1024 * 1024 * 1024)).toFixed(1);
        const memUsedGB = (parseFloat(memTotalGB) - parseFloat(memFreeGB)).toFixed(1);
        const memPercent = memTotal > 0 ? (((memTotal - memFree) / memTotal) * 100).toFixed(0) : 0;

        const cpuPercent = host.cpu_usage ? host.cpu_usage.toFixed(0) : 0;
        const isActive = (selectedHostId === host.id || selectedFirewallHostId === host.id) ? 'active' : '';

        // Find if server is online from specialized cache
        let serverCache = currentServers;
        if (currentTool === 'pfsense') serverCache = currentFirewallServers;
        else if (currentTool === 'docker') serverCache = currentDockerServers;

        const serverConfig = serverCache.find(s => s.id === host.server_id);
        const isOnline = serverConfig ? serverConfig.status === 'online' : true;

        // Handle onclick - use the provided function name or default to selectHost
        const onClickHandler = onHostClick || 'selectHost';

        // Detect Architecture
        let arch = '';
        const fullInfo = ((host.cpu_model || '') + ' ' + (host.os_name || '')).toLowerCase();
        if (fullInfo.includes('amd64') || fullInfo.includes('x86_64')) arch = 'x86_64';
        else if (fullInfo.includes('arm') || fullInfo.includes('aarch64')) arch = 'ARM';

        return `
        <div class="host-node-card glass-panel ${isActive}" onclick="${onClickHandler}(${host.id})">
            <div class="host-node-header">
                <div class="host-node-identity">
                    <div class="host-icon-box">
                        <i class="${customIcon}"></i>
                    </div>
                    <div class="host-title-group">
                        <h3>${host.server_name || host.name || 'Unknown'}</h3>
                        <div class="ip-badge">${host.ip_address || 'N/A'}</div>
                    </div>
                </div>
                <div class="host-status-badge ${isOnline ? '' : 'offline'}">
                    <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
                    ${isOnline ? 'Online' : 'Offline'}
                </div>
            </div>

            ${showOSInfo && host.os_name ? `
            <div class="host-os-info" style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                <i class="${getOSIcon(host.os_name)} fa-fw" style="font-size: 1rem; color: var(--accent-color);"></i>
                <span>${host.os_name || 'Linux Generic'}</span>
            </div>
            ` : ''}

            ${showStats ? `
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

                <!-- Disk Stat -->
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
                        <div class="stat-value-main color-cores">${host.cpu_cores || 'N/A'}</div>
                        <div class="stat-value-sub" style="font-size: 0.7rem; color: rgba(255,255,255,0.5);">${arch || 'Unknown'}</div>
                    </div>
                </div>
            </div>
            ` : ''}
        </div>
        `;
    }).join('');
}

// Wrapper function for KVM (backward compatibility)
function renderHosts() {
    renderHostNodes('host-nodes-container', {
        icon: 'fa-solid fa-server',
        showOSInfo: true,
        showStats: true
    });
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
        updateNetworkHistory(allVMsCache);
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
    filteredVMs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    // Apply search filter
    if (searchQuery) {
        filteredVMs = filteredVMs.filter(vm =>
            vm.name.toLowerCase().includes(searchQuery) ||
            vm.state.toLowerCase().includes(searchQuery)
        );
    }

    const host = allHostsCache.find(h => h.id === selectedHostId);
    if (!host) return;

    // --- PARTIAL UPDATE LOGIC ---
    const hostInfoLeft = document.getElementById('vm-host-info-left');
    const isAlreadyRenderingHost = hostInfoLeft && hostInfoLeft.getAttribute('data-host-id') === String(selectedHostId);

    // Helpers for common rendering parts
    const renderBridgesList = () => {
        let bridges = [];
        try {
            if (host.bridge_interfaces) bridges = JSON.parse(host.bridge_interfaces);
        } catch (e) { console.error("Error parsing bridge interfaces", e); }

        if (bridges.length === 0) return '<div style="opacity:0.5; font-size:0.85rem; padding: 5px;">No bridge interfaces</div>';

        return bridges.map(br => {
            const net = bridgeNetworkHistory[`${host.id}_${br.name}`] || { rx: [], tx: [] };
            const currentRx = net.rx.length > 0 ? net.rx[net.rx.length - 1] : 0;
            const currentTx = net.tx.length > 0 ? net.tx[net.tx.length - 1] : 0;

            return `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px; margin-bottom: 4px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-bridge" style="color: var(--text-secondary); font-size: 0.8rem;"></i>
                            <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">${br.name}</span>
                        </div>
                        <div style="font-weight: 600; font-size: 0.7rem; color: ${br.status === 'up' ? '#4ade80' : br.status === 'down' ? '#ef4444' : '#facc15'}; text-transform: uppercase; background: ${br.status === 'up' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; padding: 1px 4px; border-radius: 3px;">
                            ${br.status || 'unknown'}
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                            <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 0.65rem; color: #4ade80; opacity: 0.9;">
                                <span>RX</span>
                                <span>${formatBytes(currentRx, 1)}/s</span>
                            </div>
                            <div style="height: 14px;">
                                ${renderSparkline(net.rx, '#4ade80', 100, 14)}
                            </div>
                        </div>
                        <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                            <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 0.65rem; color: #fb923c; opacity: 0.9;">
                                <span>TX</span>
                                <span>${formatBytes(currentTx, 1)}/s</span>
                            </div>
                            <div style="height: 14px;">
                                ${renderSparkline(net.tx, '#fb923c', 100, 14)}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    };

    const renderStorageList = () => {
        let disks = [];
        try {
            if (host.disks) disks = JSON.parse(host.disks);
        } catch (e) { console.error("Error parsing host disks", e); }

        if (disks.length === 0) return '<div style="opacity:0.5; font-size:0.85rem; padding: 5px;">No storage data</div>';

        return disks.map(disk => {
            const usedGB = (disk.allocation / (1024 * 1024 * 1024)).toFixed(1);
            const totalGB = (disk.capacity / (1024 * 1024 * 1024)).toFixed(1);
            const percent = disk.capacity > 0 ? ((disk.allocation / disk.capacity) * 100).toFixed(0) : 0;
            const color = getStatusColor(percent);

            return `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px; display: flex; align-items: center; gap: 15px;">
                    ${renderDonutChart(percent, color, 48)}
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-hard-drive" style="color: var(--text-secondary); font-size: 0.75rem; opacity: 0.7;"></i>
                            <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${disk.device}</span>
                        </div>
                        <div style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.6;">
                            <span>Uso: <span style="color: var(--text-primary); font-weight: 500;">${usedGB}/${totalGB} GB</span></span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    };

    const renderKvmAlerts = () => {
        let oomEvents = [];
        try {
            if (host.oom_events) oomEvents = JSON.parse(host.oom_events);
        } catch (e) { console.error("Error parsing OOM events", e); }

        if (oomEvents.length === 0) {
            return `
                <div style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary); opacity: 0.6; font-size: 0.8rem; padding: 10px; background: rgba(255,255,255,0.02); border-radius: 6px;">
                    <i class="fa-solid fa-check-circle" style="color: #4ade80;"></i>
                    <span>Sin alertas críticas</span>
                </div>`;
        }
        return oomEvents.map(event => `
            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 6px; padding: 10px; margin-bottom: 5px;">
                <div style="font-size: 0.75rem; color: #f87171; font-family: monospace; white-space: pre-wrap; word-break: break-all;">
                    ${event}
                </div>
            </div>
        `).join('');
    };

    const gridCols = "2fr 1fr 1.5fr 1.5fr 2fr";

    const renderVMRows = () => {
        if (filteredVMs.length === 0) {
            return '<div style="text-align:center; padding: 40px; opacity:0.5;">No hay máquinas virtuales que mostrar</div>';
        }
        return filteredVMs.map(vm => {
            const memTotalGB = (vm.max_memory / (1024 * 1024 * 1024)).toFixed(1);
            const memUsedGB = (vm.memory_usage / (1024 * 1024 * 1024)).toFixed(1);
            const memPercent = vm.max_memory > 0 ? ((vm.memory_usage / vm.max_memory) * 100).toFixed(0) : 0;
            const cpuPercent = vm.cpu_usage ? vm.cpu_usage.toFixed(0) : 0;
            const diskTotalGB = (vm.disk_capacity / (1024 * 1024 * 1024)).toFixed(1);
            const diskUsedGB = (vm.disk_allocation / (1024 * 1024 * 1024)).toFixed(1);
            const diskPercent = vm.disk_capacity > 0 ? ((vm.disk_allocation / vm.disk_capacity) * 100).toFixed(0) : 0;

            let disks = [];
            try {
                if (vm.disks) disks = JSON.parse(vm.disks);
            } catch (e) { console.error("Error parsing disks JSON", e); }

            const isRunning = vm.state.toLowerCase() === 'running';
            const osName = (vm.os_name && vm.os_name.trim() !== "") ? vm.os_name : "Unknown OS";
            const primaryIp = vm.guest_ips ? vm.guest_ips.split(' ')[0] : 'N/A';

            // Network data
            const net = vmNetworkHistory[vm.id] || { rx: [], tx: [] };
            const currentRx = net.rx.length > 0 ? net.rx[net.rx.length - 1] : 0;
            const currentTx = net.tx.length > 0 ? net.tx[net.tx.length - 1] : 0;

            return `
                <div class="vm-row state-${vm.state.toLowerCase()}" style="display: grid; grid-template-columns: ${gridCols}; gap: 15px; padding: 12px 10px; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); transition: all 0.2s ease;">
                    <!-- Name & OS / IP Unified -->
                    <div style="display: flex; align-items: center; gap: 12px; overflow: hidden;">
                        <i class="fa-solid fa-desktop" style="color: ${isRunning ? '#4ade80' : '#ef4444'}; font-size: 1.1rem; opacity: 0.8;"></i>
                        <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden;">
                            <span style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${vm.name}">${vm.name}</span>
                            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.7rem; font-weight: 400; color: var(--text-secondary); opacity: 0.8;">
                                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${osName}">${osName}</span>
                                <span style="opacity: 0.4;">•</span>
                                <span style="color: var(--accent-color); font-family: monospace;">${primaryIp}</span>
                            </div>
                        </div>
                    </div>


                    <!-- CPU -->
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <div style="font-size: 0.85rem; font-weight: 600; color: ${getStatusColor(cpuPercent)};">${cpuPercent}%</div>
                        <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                            <div style="height: 100%; width: ${cpuPercent}%; background: ${getStatusColor(cpuPercent)};"></div>
                        </div>
                    </div>

                    <!-- Memory -->
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <div style="font-size: 0.85rem; font-weight: 600; color: ${getStatusColor(memPercent)};">
                            ${memPercent}% <span style="font-size: 0.7rem; font-weight: 400; opacity: 0.6; margin-left: 4px;">${memUsedGB}/${memTotalGB}G</span>
                        </div>
                        <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                            <div style="height: 100%; width: ${memPercent}%; background: ${getStatusColor(memPercent)};"></div>
                        </div>
                    </div>

                    <!-- Disk -->
                    <div>
                        ${disks.length > 1 ? `
                            <div style="display: flex; flex-direction: column; gap: 6px;">
                                ${disks.map(d => {
                const dCap = (d.capacity / (1024 * 1024 * 1024)).toFixed(1);
                const dAlloc = (d.allocation / (1024 * 1024 * 1024)).toFixed(1);
                const dPct = d.capacity > 0 ? ((d.allocation / d.capacity) * 100).toFixed(0) : 0;
                return `
                                        <div style="display: flex; flex-direction: column;">
                                            <div style="font-size: 0.65rem; color: var(--text-secondary); display: flex; justify-content: space-between; margin-bottom: 2px;">
                                                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60px; font-weight: 500;">${d.device}</span>
                                                <span style="color: ${getStatusColor(dPct)}; font-weight: 600;">${dPct}%</span>
                                            </div>
                                            <div class="host-progress-container" style="height: 3px; background: rgba(255,255,255,0.05); border-radius: 1.5px;">
                                                <div class="host-progress-fill" style="width: ${dPct}%; background: ${getStatusColor(dPct)}; border-radius: 1.5px;"></div>
                                            </div>
                                        </div>
                                    `;
            }).join('')}
                            </div>` : `
                            <div style="font-size: 0.85rem; font-weight: 600; color: ${getStatusColor(diskPercent)};">
                                ${diskPercent}% <span style="font-size: 0.7rem; font-weight: 400; opacity: 0.6; margin-left: 4px;">${diskUsedGB}/${diskTotalGB}G</span>
                            </div>
                            <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                                <div style="height: 100%; width: ${diskPercent}%; background: ${getStatusColor(diskPercent)};"></div>
                            </div>
                        `}
                    </div>

                    <!-- Tráfico (Network) -->
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <!-- RX Row -->
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; font-weight: 700; color: var(--text-primary);">
                                <div style="display: flex; align-items: center; gap: 6px; color: #9ca3af; font-size: 0.7rem;">
                                    <i class="fa-solid fa-arrow-down" style="color: #4ade80; font-size: 0.65rem;"></i>
                                    <span>RX</span>
                                </div>
                                <span style="font-family: monospace; font-size: 0.75rem;">${formatBytes(currentRx, 0)}</span>
                            </div>
                            <div style="height: 16px; opacity: 0.8; width: 100%;">
                                ${renderSparkline(net.rx, '#4ade80', 160, 16)}
                            </div>
                        </div>

                        <!-- TX Row -->
                        <div style="display: flex; flex-direction: column; gap: 2px; margin-top: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; font-weight: 700; color: var(--text-primary);">
                                <div style="display: flex; align-items: center; gap: 6px; color: #9ca3af; font-size: 0.7rem;">
                                    <i class="fa-solid fa-arrow-up" style="color: #fb923c; font-size: 0.65rem;"></i>
                                    <span>TX</span>
                                </div>
                                <span style="font-family: monospace; font-size: 0.75rem;">${formatBytes(currentTx, 0)}</span>
                            </div>
                            <div style="height: 16px; opacity: 0.8; width: 100%;">
                                ${renderSparkline(net.tx, '#fb923c', 160, 16)}
                            </div>
                        </div>
                    </div>
                </div>`;
        }).join('');
    };

    if (isAlreadyRenderingHost) {
        // --- ONLY UPDATE DYNAMIC VALUES ---
        const updatesEl = document.getElementById('kvm-host-updates');
        if (updatesEl) {
            updatesEl.innerHTML = host.update_status && host.update_status.includes('Updates Available')
                ? `<span style="color: #facc15; font-size: 0.65rem; background: rgba(234, 179, 8, 1.0); border: 1px solid rgba(234, 179, 8, 0.2); padding: 1px 6px; border-radius: 4px; font-weight: 600; display: flex; align-items: center; gap: 4px;"><i class="fa-solid fa-circle-exclamation"></i> ${host.update_status.replace('Updates Available', 'Actualizaciones')}</span>`
                : '<span style="color: #4ade80; font-size: 0.65rem; background: rgba(34, 197, 94, 0.05); border: 1px solid rgba(34, 197, 94, 0.1); padding: 1px 6px; border-radius: 4px; font-weight: 600;">Actualizado</span>';
        }

        const uptimeEl = document.getElementById('kvm-host-uptime');
        if (uptimeEl) uptimeEl.textContent = host.uptime || 'Desconocido';

        const tempContainer = document.getElementById('kvm-host-temp');
        if (tempContainer) {
            const temp = host.temperature;
            if (!temp || temp <= 0) {
                tempContainer.innerHTML = `<div style="font-weight: 500; font-size: 0.9rem; color: var(--text-secondary); opacity: 0.7;">Unknown</div>`;
            } else {
                let color = '#4ade80';
                if (temp >= 50) color = '#facc15';
                if (temp >= 70) color = '#ef4444';
                tempContainer.innerHTML = `<div style="font-weight: 600; font-size: 1.1rem; color: ${color};">${temp}°C</div>`;
            }
        }

        const bridgesEl = document.getElementById('kvm-host-bridges');
        if (bridgesEl) bridgesEl.innerHTML = renderBridgesList();

        const storageEl = document.getElementById('kvm-host-storage');
        if (storageEl) storageEl.innerHTML = renderStorageList();

        const alertsEl = document.getElementById('kvm-host-alerts');
        if (alertsEl) alertsEl.innerHTML = renderKvmAlerts();

        const vmListEl = document.getElementById('kvm-vm-list-rows');
        if (vmListEl) vmListEl.innerHTML = renderVMRows();

        return; // Done with partial update
    }

    // --- FULL RENDER ---
    if (hostInfoLeft) {
        hostInfoLeft.setAttribute('data-host-id', selectedHostId);
        hostInfoLeft.innerHTML = `
            <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                Sistema y Red
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <!-- OS Card -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">Sistema Operativo</div>
                        <div id="kvm-host-updates">
                            ${host.update_status && host.update_status.includes('Updates Available')
                ? `<span style="color: #facc15; font-size: 0.65rem; background: rgba(234, 179, 8, 1.0); border: 1px solid rgba(234, 179, 8, 0.2); padding: 1px 6px; border-radius: 4px; font-weight: 600; display: flex; align-items: center; gap: 4px;"><i class="fa-solid fa-circle-exclamation"></i> ${host.update_status.replace('Updates Available', 'Actualizaciones')}</span>`
                : '<span style="color: #4ade80; font-size: 0.65rem; background: rgba(34, 197, 94, 0.05); border: 1px solid rgba(34, 197, 94, 0.1); padding: 1px 6px; border-radius: 4px; font-weight: 600;">Actualizado</span>'
            }
                        </div>
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                        <i class="${getOSIcon(host.os_name)} fa-fw" style="font-size: 0.8rem; opacity: 0.8;"></i> ${host.os_name || 'Generic Linux'}
                    </div>
                </div>

                <!-- Uptime Card -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">Tiempo de Actividad</div>
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                        <i class="fa-solid fa-clock-rotate-left fa-fw" style="font-size: 0.8rem; opacity: 0.8;"></i> <span id="kvm-host-uptime">${host.uptime || 'Desconocido'}</span>
                    </div>
                </div>
            
                <!-- Temperature Card -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-temperature-three-quarters" style="color: var(--text-secondary);"></i>
                        <span style="font-size: 0.9rem; color: var(--text-secondary);">Temperatura</span>
                    </div>
                    <div id="kvm-host-temp">
                        ${(() => {
                const temp = host.temperature;
                if (!temp || temp <= 0) {
                    return `<div style="font-weight: 500; font-size: 0.9rem; color: var(--text-secondary); opacity: 0.7;">Unknown</div>`;
                }
                let color = '#4ade80';
                if (temp >= 50) color = '#facc15';
                if (temp >= 70) color = '#ef4444';
                return `<div style="font-weight: 600; font-size: 1.1rem; color: ${color};">${temp}°C</div>`;
            })()}
                    </div>
                </div>

                <!-- Network Info -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px;">
                     <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary); margin-bottom: 8px;">Red y DNS</div>
                     <div style="display: flex; flex-direction: column; gap: 6px;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                            <span style="color: var(--text-secondary);">IP Local:</span>
                            <span style="font-family: monospace; color: var(--accent-color);">${host.ip_address || 'N/A'}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                            <span style="color: var(--text-secondary);">IP Pública:</span>
                            <span style="font-family: monospace; color: #38bdf8;">${host.public_ip || 'N/A'}</span>
                        </div>
                         ${(host.dns_servers || '').split(' ').filter(dns => dns).map(dns => `
                            <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                                <span style="color: var(--text-secondary);">DNS:</span>
                                <span style="font-family: monospace; color: var(--text-primary);">${dns}</span>
                            </div>
                        `).join('')}
                     </div>
                </div>

                <!-- Bridge Interfaces Section -->
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-top: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    Interfaces Bridge
                </div>
                <div id="kvm-host-bridges" style="display: flex; flex-direction: column; gap: 8px;">
                    ${renderBridgesList()}
                </div>

                <!-- Almacenamiento Section -->
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-top: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    Almacenamiento
                </div>
                <div id="kvm-host-storage" style="display: flex; flex-direction: column; gap: 10px;">
                    ${renderStorageList()}
                </div>

                <!-- Avisos del Sistema Section -->
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-top: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    Avisos del Sistema
                </div>
                <div id="kvm-host-alerts" style="display: flex; flex-direction: column; gap: 10px;">
                    ${renderKvmAlerts()}
                </div>
            </div>
        `;
    }

    grid.innerHTML = `
        <div style="width: 100%; padding-bottom: 10px;">
            <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); width: 100%;">
                Máquinas Virtuales
            </div>
            <div class="vm-list-header" style="display: grid; grid-template-columns: ${gridCols}; gap: 15px; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 8px;">
                <div>Nombre / Sistema</div>
                <div>CPU</div>
                <div>Memoria</div>
                <div>Disco</div>
                <div>RED (RX/TX)</div>
            </div>
            <div id="kvm-vm-list-rows" style="display: flex; flex-direction: column; gap: 4px;">
                ${renderVMRows()}
            </div>
        </div>
    `;
}

function renderDockerSummary() {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    const dockerHosts = allHostsCache.filter(h => h.docker_version);
    const totalContainers = allContainersCache.length;
    const runningContainers = allContainersCache.filter(c => (c.state || '').toLowerCase() === 'running').length;

    // Calculate aggregate metrics
    let totalCpu = 0;
    dockerHosts.forEach(h => {
        totalCpu += (h.cpu_usage || 0);
    });
    const avgCpu = dockerHosts.length > 0 ? (totalCpu / dockerHosts.length).toFixed(1) : 0;

    scannerSection.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin:0; font-size: 1.5rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
        </div>

        <div class="glass-panel" style="padding: 80px 25px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div style="font-size: 1.1rem; color: var(--text-secondary); opacity: 0.6; font-weight: 500;">
                <i class="fa-solid fa-arrow-up" style="margin-right: 8px;"></i> Selecciona un Host Node para ver sus contenedores
            </div>
        </div>
    `;
}

// Render Firewall Summary
function renderFirewallSummary() {
    const containerTool = document.getElementById('container-scanner-tool');
    const scannerSection = containerTool.querySelector('.scanner-section');
    if (!scannerSection) return;

    scannerSection.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin:0; font-size: 1.5rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
        </div>

        <div class="glass-panel" style="padding: 80px 25px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div style="font-size: 1.1rem; color: var(--text-secondary); opacity: 0.6; font-weight: 500;">
                <i class="fa-solid fa-arrow-up" style="margin-right: 8px;"></i> Selecciona un Host Node para ver su estado
            </div>
        </div>
    `;
}

// Config Modal Logic
const modal = document.getElementById('config-modal');
const btn = document.getElementById('config-btn');
const close = document.getElementsByClassName('close-modal')[0];

// Dynamic click handler based on current tool
btn.onclick = () => {
    // Map tools to their respective modal IDs and load functions
    const toolModalMap = {
        'kvm': { modalId: 'config-modal', loadFn: loadServers, resetFn: resetForm },
        'proxmox': { modalId: 'config-modal', loadFn: loadServers, resetFn: resetForm },
        'nas': { modalId: 'config-modal', loadFn: loadServers, resetFn: resetForm },
        'ceph': { modalId: 'config-modal', loadFn: loadServers, resetFn: resetForm },
        'pfsense': { modalId: 'config-modal', loadFn: loadServers, resetFn: resetForm },
        'docker': { modalId: 'config-modal', loadFn: loadServers, resetFn: resetForm },
        'podman': { modalId: 'config-modal', loadFn: loadServers, resetFn: resetForm }
    };

    const config = toolModalMap[currentTool];
    if (config) {
        const targetModal = document.getElementById(config.modalId);
        if (targetModal) {
            targetModal.style.display = 'block';
            if (config.loadFn) config.loadFn();
            if (config.resetFn) config.resetFn();
        }
    } else {
        // Fallback to default modal
        modal.style.display = 'block';
        loadServers();
        resetForm();
    }
}
close.onclick = () => modal.style.display = 'none';
window.onclick = (e) => { if (e.target == modal) modal.style.display = 'none'; }

async function loadServers() {
    const apiUrl = getConfigAPIForTool(currentTool);
    const res = await fetch(apiUrl);
    if (res.ok) {
        const servers = await res.json();

        // Sync local cache based on tool
        if (currentTool === 'kvm') currentServers = servers || [];
        else if (currentTool === 'pfsense') currentFirewallServers = servers || [];
        else if (currentTool === 'docker') currentDockerServers = servers || [];

        const list = document.getElementById('server-list-ul');
        if (!list) return;
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
        const apiUrl = getConfigAPIForTool(currentTool);
        await fetch(apiUrl + '/' + id, { method: 'DELETE' });
        loadServers();
        resetForm(); // if we were editing it
    }
}

// Edit Logic
window.startEdit = (id) => {
    let serverCache = currentServers;
    if (currentTool === 'pfsense') serverCache = currentFirewallServers;
    else if (currentTool === 'docker') serverCache = currentDockerServers;

    const s = serverCache.find(srv => srv.id === id);
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

        const apiUrl = getConfigAPIForTool(currentTool);
        if (id) {
            // Update
            await fetch(apiUrl + '/' + id, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
        } else {
            // Create
            await fetch(apiUrl, {
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
        // Check KVM servers
        const kvmResponse = await fetch(API_CONFIG_SERVERS);
        if (kvmResponse.ok) {
            currentServers = await kvmResponse.json() || [];
        }

        // Check Firewall servers
        const firewallResponse = await fetch(API_FIREWALL_SERVERS);
        if (firewallResponse.ok) {
            currentFirewallServers = await firewallResponse.json() || [];
        }

        // Check Docker servers
        const dockerApi = getConfigAPIForTool('docker');
        const dockerResponse = await fetch(dockerApi);
        if (dockerResponse.ok) {
            currentDockerServers = await dockerResponse.json() || [];
        }

        // Combined notification logic
        const allServers = [...currentServers, ...currentFirewallServers, ...currentDockerServers];
        const offlineServers = allServers.filter(s => s.status === 'offline');
        const badge = document.getElementById('notification-count');
        const list = document.getElementById('notification-list');

        if (badge && list) {
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
                list.innerHTML = '<li style="color:var(--text-secondary); text-align:center; display:block;">Todos los sistemas activos</li>';
            }
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
    } else if (currentTool === 'pfsense') {
        fetchFirewallHosts();
    } else if (currentTool) {
        // Refresh hosts for other tools
        checkAndFetchHostsForTool(currentTool);
    }
}

setInterval(refreshAll, 2000);
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
    else if (os.includes('pfsense') || os.includes('freebsd')) icon = 'fa-brands fa-freebsd';

    return icon;
}

function selectFirewallHost(hostId) {
    selectedFirewallHostId = hostId;
    // Rerender nodes to update selection state
    renderHostNodes('host-nodes-container-generic', {
        icon: tools[currentTool]?.icon || 'fa-solid fa-shield-halved',
        showOSInfo: true,
        showStats: true,
        onHostClick: 'selectFirewallHost'
    });

    selectedHostId = hostId; // Also update global (though mostly used for KVM)
    renderFirewallHostDetails(hostId);
}

function renderFirewallHostDetails(hostId) {
    const containerTool = document.getElementById('container-scanner-tool');
    const scannerSection = containerTool.querySelector('.scanner-section');
    if (!scannerSection) return;

    /*
     * We replace the inner HTML of the scanner section (which is usually a .glass-panel)
     * with a detailed grid view of interfaces.
     */

    const host = allHostsCache.find(h => h.id === hostId);
    if (host) window.currentFirewallHost = host; // Expose for map logic
    if (!host) {
        scannerSection.innerHTML = `<div class="glass-panel"><div class="loading-state">Host not found</div></div>`;
        return;
    }

    if (!host.interfaces || host.interfaces.length === 0) {
        scannerSection.innerHTML = `
            <div class="glass-panel" style="padding: 2rem; text-align: center;">
                <h2>${host.server_name}</h2>
                <p style="color: var(--text-secondary);">No network interfaces detected.</p>
            </div>`;
        return;
    }

    // List layout for interfaces within a single card
    const interfacesRows = host.interfaces.map(iface => {
        const historyKey = `${host.id}_${iface.interface_name}`;
        const history = pfSenseNetworkHistory[historyKey];

        let rxCurrent = '0 B/s';
        let txCurrent = '0 B/s';
        let rxSpark = '';
        let txSpark = '';

        if (history) {
            rxCurrent = formatBytes(history.rx[history.rx.length - 1], 1) + '/s';
            txCurrent = formatBytes(history.tx[history.tx.length - 1], 1) + '/s';
            rxSpark = renderSparkline(history.rx, '#4ade80', 100, 30);
            txSpark = renderSparkline(history.tx, '#fb923c', 100, 30);
        }

        return `
        <div style="display: grid; grid-template-columns: 1.5fr 2fr 2fr 1.2fr; gap: 15px; align-items: center; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <!-- Name & Status -->
            <div style="display: flex; align-items: center; gap: 8px;">
                <div class="${iface.status === 'up' ? 'status-dot online' : 'status-dot offline'}" title="${iface.status}"></div>
                <div style="font-weight: 500; font-size: 0.95rem; color: var(--primary-color); display: flex; flex-direction: column; gap: 0px;">
                    <div style="display: flex; align-items: center; gap: 5px;">
                       <i class="fa-solid fa-network-wired" style="font-size: 0.8em; opacity: 0.7;"></i>
                       <span title="${iface.interface_name}">${iface.interface_name.length > 8 ? iface.interface_name.substring(0, 8) + '..' : iface.interface_name}</span>
                    </div>
                    ${iface.ip_address ? `<span style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.8; font-family: monospace; margin-left: 2px;">${iface.ip_address}</span>` : ''}
                </div>
            </div>
            
            <!-- RX -->
            <div>
                 <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 0px;">
                    <span style="color: var(--text-secondary);">RX</span>
                    <span style="font-weight: 500;">${rxCurrent}</span>
                 </div>
                 <div style="height: 20px; opacity: 0.8;">${rxSpark}</div>
            </div>

            <!-- TX -->
            <div>
                 <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 0px;">
                    <span style="color: var(--text-secondary);">TX</span>
                    <span style="font-weight: 500;">${txCurrent}</span>
                 </div>
                 <div style="height: 20px; opacity: 0.8;">${txSpark}</div>
            </div>

             <!-- Info (Type + Errors/Drops) -->
             <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
                 <div style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.6;">${iface.interface_type || 'Eth'}</div>
                 <div style="font-size: 0.65rem; display: flex; gap: 8px; align-items: center;">
                    ${(iface.net_rx_errors + iface.net_tx_errors) > 0
                ? `<span style="color:#ef4444; display:flex; align-items:center; gap:3px;" title="Errors (RX+TX): ${iface.net_rx_errors + iface.net_tx_errors}"><i class="fa-solid fa-triangle-exclamation"></i> ${iface.net_rx_errors + iface.net_tx_errors}</span>`
                : `<span style="color:rgba(255,255,255,0.15);" title="No Errors"><i class="fa-solid fa-check"></i></span>`
            }
                    ${(iface.net_rx_dropped + iface.net_tx_dropped) > 0
                ? `<span style="color:#f97316; display:flex; align-items:center; gap:3px;" title="Drops (RX+TX): ${iface.net_rx_dropped + iface.net_tx_dropped}"><i class="fa-solid fa-filter"></i> ${iface.net_rx_dropped + iface.net_tx_dropped}</span>`
                : `<span style="color:rgba(255,255,255,0.15);" title="No Drops"><i class="fa-solid fa-filter-circle-xmark"></i></span>`
            }
                 </div>
            </div>
        </div>
        `;
    }).join('');

    const statsHTML = `
        <div style="margin-bottom: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 8px;">
                <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
            </div>
        </div>
        
        <div class="glass-panel" style="padding: 20px;">
            <div style="display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start;">
                <!-- Left Column: OS, Uptime, Gateways (Fixed Width approx 350px) -->
                <div style="flex: 0 0 350px; display: flex; flex-direction: column; gap: 15px;">
                    
                    <!-- System Info Section -->
                    <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 5px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        Información
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <!-- OS Card -->
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">Sistema Operativo</div>
                                ${host.update_status === 'Up to Date'
            ? '<span style="color: #4ade80; font-size: 0.7rem; background: rgba(34, 197, 94, 0.1); padding: 1px 5px; border-radius: 3px;">Actualizado</span>'
            : host.update_status === 'Update Available'
                ? '<span style="color: #facc15; font-size: 0.7rem; background: rgba(234, 179, 8, 0.15); padding: 1px 5px; border-radius: 3px;">Actualizar</span>'
                : ''
        }
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                                <i class="fa-brands fa-freebsd" style="font-size: 0.8rem; opacity: 0.8;"></i> ${host.os_name || 'Unknown'}
                            </div>
                        </div>

                        <!-- Uptime Card -->
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">Tiempo de Actividad</div>
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-clock-rotate-left" style="font-size: 0.8rem; opacity: 0.8;"></i> ${host.uptime || 'Desconocido'}
                            </div>
                        </div>
                    </div>

                    <!-- Temperature Card (Above Gateways) -->
                    ${true ? `
                        <div style="margin-top: 15px;">
                            <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                Temperatura
                            </div>
                            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px; display: flex; align-items: center; justify-content: space-between;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <i class="fa-solid fa-temperature-three-quarters" style="color: var(--text-secondary);"></i>
                                    <span style="font-size: 0.9rem; color: var(--text-secondary);">CPU / Sistema</span>
                                </div>
                                ${(() => {
                const temp = host.temperature;
                if (!temp || temp <= 0) {
                    return `<div style="font-weight: 500; font-size: 0.9rem; color: var(--text-secondary); opacity: 0.7;">Unknown</div>`;
                }
                let color = '#4ade80'; // Green
                if (temp >= 50) color = '#facc15'; // Yellow
                if (temp >= 70) color = '#ef4444'; // Red

                return `<div style="font-weight: 600; font-size: 1.1rem; color: ${color};">${temp}°C</div>`;
            })()}
                            </div>
                        </div>
                    ` : ''}

                    <!-- Gateways Section -->
                    ${(host.gateways && host.gateways.length > 0) ? `
                        <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-top: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                            Gateways
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            ${host.gateways.map(gw => {
                let lossVal = parseFloat(gw.loss);
                let isWarning = !isNaN(lossVal) && lossVal > 0 && lossVal < 10;
                let isCritical = !isNaN(lossVal) && lossVal >= 10;

                let cardStyle = "background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px;";

                if (isCritical) {
                    cardStyle = "background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; padding: 10px; box-shadow: 0 0 10px rgba(239, 68, 68, 0.1); animation: pulse-red 2s infinite;";
                } else if (isWarning) {
                    cardStyle = "background: rgba(251, 146, 60, 0.1); border: 1px solid rgba(251, 146, 60, 0.3); border-radius: 6px; padding: 10px;";
                }

                return `
                                <div style="${cardStyle}">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">${gw.name}</div>
                                        ${gw.status.toLowerCase() === 'online'
                        ? '<span style="color: #4ade80; font-size: 0.7rem; background: rgba(34, 197, 94, 0.1); padding: 1px 5px; border-radius: 3px;">Online</span>'
                        : `<span style="color: #ef4444; font-size: 0.7rem; background: rgba(239, 68, 68, 0.1); padding: 1px 5px; border-radius: 3px;">${gw.status}</span>`
                    }
                                    </div>
                                    <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 3px;">
                                        <i class="fa-solid fa-server" style="font-size: 0.65rem; opacity: 0.7; margin-right: 4px;"></i> ${gw.monitor_ip}
                                    </div>
                                     <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; gap: 8px;">
                                        <span title="Latency"><i class="fa-solid fa-stopwatch" style="font-size: 0.65rem; opacity: 0.7; margin-right: 3px;"></i>${gw.delay}</span>
                                        ${(() => {
                        let lossColor = 'var(--text-secondary)';
                        if (isWarning) lossColor = '#fb923c';
                        if (isCritical) lossColor = '#ef4444';
                        return `<span title="Packet Loss"><i class="fa-solid fa-chart-simple" style="font-size: 0.65rem; opacity: 0.7; margin-right: 3px; color:${lossColor}"></i><span style="color:${lossColor}; font-weight:${isCritical ? '700' : '400'}">${gw.loss}</span></span>`;
                    })()}
                                    </div>
                                </div>
                            `;
            }).join('')}
                        </div>
                    ` : ''}


                    <!-- DNS Servers Section -->
                     ${(host.dns_servers && host.dns_servers.length > 0) ? `
                        <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-top: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                            DNS Servers
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                             <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px;">
                                <div style="display: flex; flex-direction: column; gap: 5px;">
                                    ${host.dns_servers.split(',').map(dns => `
                                        <div style="font-size: 0.85rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                                            <i class="fa-solid fa-globe" style="font-size: 0.75rem; opacity: 0.7; color: var(--accent-color);"></i> ${dns.trim()}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                     ` : ''}
                </div>

                <!-- Network Interfaces Section (Right, Flex Grow) -->
                <div style="flex: 1; min-width: 300px;">
                    <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        Network Interfaces
                    </div>

                    <div style="display: grid; grid-template-columns: 1.5fr 2fr 2fr 0.5fr; gap: 15px; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);">
                        <div>Interface</div>
                        <div>Inbound Traffic (RX)</div>
                        <div>Outbound Traffic (TX)</div>
                        <div style="text-align: right;">Type</div>
                    </div>

                    <div style="display: flex; flex-direction: column;">
                        ${interfacesRows}
                    </div>

                    <!-- State Table Size -->
                    <!-- State Table Size -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 25px;">
                        <!-- Left Column: Active Connections -->
                        <div>
                             ${(() => {
            let activeConns = [];
            try {
                activeConns = host.active_connections ? JSON.parse(host.active_connections) : [];
            } catch (e) {
                console.error("Error parsing active_connections:", e);
            }

            if (activeConns.length > 0) {
                activeConns.sort((a, b) => (b.inbound + b.outbound) - (a.inbound + a.outbound));
                const topConns = activeConns.slice(0, 5);

                return `
                                        <div>
                                            <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center;">
                                                <div>Active Connections <span style="font-size:0.7em; opacity:0.6;">(Top 5)</span></div>
                                                <div style="font-size:0.85rem; opacity:0.7;"><i class="fa-solid fa-shield-halved"></i> Anomaly Detection</div>
                                            </div>
                                            <div style="background: rgba(255,255,255,0.05); border-radius: 6px; padding: 10px; overflow: hidden;">
                                                <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 8px; font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary); opacity: 0.8;">
                                                    <div>Remote Host</div>
                                                    <div style="text-align: center;">In</div>
                                                    <div style="text-align: center;">Out</div>
                                                    <div style="text-align: right;">Total</div>
                                                </div>
                                                ${topConns.map(conn => {
                    const total = conn.inbound + conn.outbound;
                    const isSuspicious = total > 50;
                    const rowColor = isSuspicious ? '#ef4444' : 'var(--text-primary)';
                    return `
                                                        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 10px; padding: 6px 0; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03); font-size: 0.85rem;">
                                                            <div style="display:flex; align-items:center; gap:6px; color:${rowColor}; font-weight:${isSuspicious ? '600' : '400'};">
                                                                ${isSuspicious ? '<i class="fa-solid fa-triangle-exclamation" style="font-size:0.8em;"></i>' : '<div style="width:14px;"></div>'}
                                                                ${conn.remote_ip}
                                                            </div>
                                                            <div style="text-align: center; color: var(--text-secondary);">${conn.inbound}</div>
                                                            <div style="text-align: center; color: var(--text-secondary);">${conn.outbound}</div>
                                                            <div style="text-align: right; font-weight: 500; color:${rowColor};">${total}</div>
                                                        </div>
                                                    `;
                }).join('')}
                                            </div>
                                        </div>
                                    `;
            } else {
                return `
                                        <div>
                                            <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">Active Connections</div>
                                            <div style="font-size: 0.9rem; color: var(--text-secondary); opacity: 0.7; padding: 10px 0;">No active connections data available.</div>
                                        </div>`;
            }
        })()}
                        </div>

                        <!-- Right Column: State Table Size -->
                        <div>
                             <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center;">
                                <div>State Table Size</div>
                                <div style="font-size:0.85rem; opacity:0.7;">
                                    ${host.state_table_size.toLocaleString()} / ${(host.state_table_limit > 0 ? host.state_table_limit : 400000).toLocaleString()} ${host.state_table_limit > 0 ? '' : '<span style="opacity:0.6; font-size:0.75em;">(Default)</span>'}
                                </div>
                            </div>
                            <div style="background: rgba(255,255,255,0.05); border-radius: 6px; padding: 15px; position: relative; overflow: hidden;">
                                ${(() => {
            const limit = host.state_table_limit > 0 ? host.state_table_limit : 400000;
            const percent = Math.min((host.state_table_size / limit) * 100, 100);
            let barColor = '#4ade80'; // Green
            if (percent > 60) barColor = '#facc15'; // Yellow
            if (percent > 80) barColor = '#ef4444'; // Red

            return `
                                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.9rem; font-weight: 500;">
                                            <span>Usage</span>
                                            <span style="color: ${barColor}">${percent.toFixed(1)}%</span>
                                        </div>
                                        <div style="height: 10px; background: rgba(255,255,255,0.1); border-radius: 5px; overflow: hidden;">
                                            <div style="height: 100%; width: ${percent}%; background: ${barColor}; transition: width 0.5s ease;"></div>
                                        </div>
                                    `;
        })()}
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    `;

    // Ensure persistent containers exist
    let statsWrapper = document.getElementById('fw-stats-wrapper');
    let mapWrapper = document.getElementById('fw-map-wrapper');

    if (!statsWrapper) {
        scannerSection.innerHTML = `
    <div id="fw-stats-wrapper" ></div>
        <div id="fw-map-wrapper" class="glass-panel" style="padding: 20px; margin-top: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 15px; padding-bottom: 10px;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9;">
                    Mapa de Tráfico en Tiempo Real
                </div>
                <i class="fa-solid fa-bug" onclick="window.toggleMapDebug()" title="Toggle Debug Mode" style="cursor: pointer; color: var(--text-secondary); font-size: 1rem; opacity: 0.5; transition: opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5"></i>
            </div>
            <div id="trafficMap" style="height: 400px; width: 100%; border-radius: 8px; z-index: 1;"></div>
        </div>
`;
        statsWrapper = document.getElementById('fw-stats-wrapper');
    }

    // Update Stats Content ONLY
    if (statsWrapper) {
        statsWrapper.innerHTML = statsHTML;
    }

    // Initialize Map after DOM update
    // Initialize Map or Update
    setTimeout(() => {
        if (!window.currentFirewallMap) {
            window.currentFirewallMap = new NetworkMap('trafficMap');
        }
        window.currentFirewallMap.render(host.active_connections);
    }, 100);
}

// Helper to check for private IP
const isPrivate = (ip) => {
    return ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.') || (ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31);
};

class NetworkMap {
    constructor(containerId) {
        this.containerId = containerId;
        this.mapInstance = null;
        this.markers = [];
        this.geoQueue = [];
        this.isProcessingQueue = false;
        this.homeIP = null;
        this.homeGeo = null;
        this.activeMapConnections = [];

        // Restore Debug Mode from Persistent Storage
        if (localStorage.getItem('mapDebugMode') === 'true') {
            this.updateDebugOverlay();
        }
    }

    destroy() {
        if (this.mapInstance) {
            this.mapInstance.remove();
            this.mapInstance = null;
        }
        // Clear debug overlay
        const debugDiv = document.getElementById('antpath-debug');
        if (debugDiv) debugDiv.remove();
    }

    render(connsJSON) {
        // Parse conns
        let connections = [];
        try {
            connections = connsJSON ? JSON.parse(connsJSON) : [];
        } catch (e) {
            console.error('[NetworkMap] Error parsing connections:', e);
            return;
        }

        const container = document.getElementById(this.containerId);
        if (!container) return; // Wait for DOM

        // Init Map if needed
        if (!this.mapInstance) {
            this.mapInstance = L.map(this.containerId).setView([20, 0], 2);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy;OpenStreetMap, &copy;CartoDB',
                subdomains: 'abcd',
                maxZoom: 19
            }).addTo(this.mapInstance);
        } else {
            this.mapInstance.invalidateSize();
        }

        // Clear markers
        this.markers.forEach(m => this.mapInstance.removeLayer(m));
        this.markers = [];

        // Filter top connections
        this.activeMapConnections = connections.slice(0, 50);
        console.log(`[NetworkMap] Processing ${this.activeMapConnections.length} connections.`);

        // Determine Home
        this.updateHomeLocation();
        this.updateDebugOverlay();

        // Process Connections
        this.activeMapConnections.forEach(conn => {
            const ip = conn.remote_ip;
            const cached = localStorage.getItem('geoip_' + ip);
            if (cached) {
                this.addMarker(conn, JSON.parse(cached));
            } else {
                if (!this.geoQueue.some(item => item.ip === ip)) {
                    this.geoQueue.push({
                        ip: ip,
                        callback: (geoData) => {
                            if (geoData && !geoData.error) {
                                this.addMarker(conn, geoData);
                            }
                        }
                    });
                }
            }
        });

        // Trigger Queue Processing
        this.processGeoQueue();
    }

    updateHomeLocation() {
        let newHomeIP = null;
        // 1. Try public IP from host interfaces
        if (window.currentFirewallHost && window.currentFirewallHost.interfaces) {
            const candidates = window.currentFirewallHost.interfaces
                .filter(i => i.ip_address && !isPrivate(i.ip_address))
                .map(i => i.ip_address.trim());
            const better = candidates.find(ip => !ip.startsWith('172.'));
            newHomeIP = better || candidates[0];
        }

        // 2. Fallback
        if (!newHomeIP) newHomeIP = 'self';

        const safeNew = newHomeIP.trim();
        const safeOld = this.homeIP ? this.homeIP.trim() : null;

        if (safeNew !== safeOld) {
            // Check if actually changed
            if (safeNew === safeOld) return;

            console.log(`[NetworkMap] Home IP changed: ${safeOld} -> ${safeNew}`);
            this.homeIP = safeNew;
            this.homeGeo = null;

            // Check Cache
            const cachedHome = localStorage.getItem('geoip_' + this.homeIP);
            if (cachedHome) {
                const parsed = JSON.parse(cachedHome);
                if (!parsed.error && parsed.lat) {
                    this.homeGeo = parsed;
                    this.drawLines(); // Redraw all lines with new home
                } else {
                    localStorage.removeItem('geoip_' + this.homeIP);
                    this.queueHomeResolution(this.homeIP);
                }
            } else {
                this.queueHomeResolution(this.homeIP);
            }
        } else {
            // IP same, retry geo if missing
            if (!this.homeGeo) {
                const cachedHome = localStorage.getItem('geoip_' + this.homeIP);
                if (cachedHome) {
                    this.homeGeo = JSON.parse(cachedHome);
                    this.drawLines();
                } else {
                    this.queueHomeResolution(this.homeIP);
                }
            }
        }
    }

    queueHomeResolution(targetIP) {
        const queryIP = targetIP === 'self' ? 'self' : targetIP;
        // console.log(`[NetworkMap] Queuing Home IP: ${targetIP}`);
        this.geoQueue.unshift({
            ip: queryIP,
            callback: (geoData) => {
                if (geoData && !geoData.error) {
                    this.homeGeo = geoData;
                    localStorage.setItem('geoip_' + targetIP, JSON.stringify(geoData));
                    // console.log(`[NetworkMap] Resolved Home:`, this.homeGeo);
                    this.drawLines();
                } else {
                    // Fallback to self logic if specific IP failed?
                    if (targetIP !== 'self') {
                        this.homeIP = 'self';
                        this.queueHomeResolution('self');
                    }
                }
            }
        });
        this.processGeoQueue();
    }

    async processGeoQueue() {
        if (this.isProcessingQueue || this.geoQueue.length === 0) return;

        this.isProcessingQueue = true;
        const { ip, callback } = this.geoQueue.shift();

        try {
            const cached = localStorage.getItem('geoip_' + ip);
            if (cached) {
                callback(JSON.parse(cached));
            } else {
                // Proxy Fetch
                const res = await fetch(`/api/geoip/${ip}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'success') {
                        const geoData = { lat: data.lat, lon: data.lon, city: data.city, country: data.country };
                        localStorage.setItem('geoip_' + ip, JSON.stringify(geoData));
                        callback(geoData);
                    } else {
                        localStorage.setItem('geoip_' + ip, JSON.stringify({ error: true }));
                        callback(null);
                    }
                } else {
                    // 429 etc
                    if (res.status === 429) {
                        this.geoQueue.unshift({ ip, callback });
                        console.warn('[NetworkMap] Rate limited. Pausing.');
                        await new Promise(r => setTimeout(r, 5000));
                    } else {
                        localStorage.setItem('geoip_' + ip, JSON.stringify({ error: true }));
                        callback(null);
                    }
                }
            }
        } catch (e) {
            console.error('[NetworkMap] Fetch error:', e);
            callback(null);
        } finally {
            this.isProcessingQueue = false;
            if (this.geoQueue.length > 0) {
                setTimeout(() => this.processGeoQueue(), 200); // 200ms delay
            }
        }
    }

    addMarker(conn, geoData) {
        if (!geoData || !geoData.lat) return;

        const color = conn.inbound > conn.outbound ? '#ef4444' : '#22c55e';
        const type = conn.inbound > conn.outbound ? 'Entrante' : 'Saliente';

        const circle = L.circleMarker([geoData.lat, geoData.lon], {
            radius: 5,
            fillColor: color,
            color: "#fff",
            weight: 1,
            opacity: 0.8,
            fillOpacity: 0.8
        }).addTo(this.mapInstance);

        circle.bindPopup(`
            <b>${conn.remote_ip}</b><br>
            ${geoData.city}, ${geoData.country}<br>
            Tipo: <span style="color:${color}">${type}</span><br>
            Conexiones: In: ${conn.inbound} / Out: ${conn.outbound}
        `);
        this.markers.push(circle);

        this.drawSingleLine(conn, geoData);
    }

    drawSingleLine(conn, remoteGeo) {
        if (!this.homeGeo || !this.homeGeo.lat) return;

        const hLat = parseFloat(this.homeGeo.lat);
        const hLon = parseFloat(this.homeGeo.lon);
        const rLat = parseFloat(remoteGeo.lat);
        const rLon = parseFloat(remoteGeo.lon);

        if (Math.abs(hLat - rLat) < 0.0001 && Math.abs(hLon - rLon) < 0.0001) return;

        const isInbound = conn.inbound > conn.outbound;
        const color = isInbound ? '#ef4444' : '#22c55e';
        const pulse = isInbound ? '#fca5a5' : '#86efac'; // Lighter shades for pulse

        // Generate Curved Path (Bezier)
        const latlngs = this.getCurvedPath([rLat, rLon], [hLat, hLon], isInbound);

        try {
            // AntPath
            if (L.polyline.antPath) {
                const path = L.polyline.antPath(latlngs, {
                    "delay": 800,
                    "dashArray": [10, 20],
                    "weight": 2, // Finer line
                    "color": color,
                    "pulseColor": pulse,
                    "paused": false,
                    "reverse": false,
                    "hardwareAccelerated": false // Keep false for compatibility
                });
                path.addTo(this.mapInstance);
                this.markers.push(path);
            } else {
                // Fallback
                const line = L.polyline(latlngs, { color: color, weight: 2, opacity: 0.6 }).addTo(this.mapInstance);
                this.markers.push(line);
            }
        } catch (e) {
            console.error('[NetworkMap] Draw error:', e);
        }
    }

    // Helper: Quadratic Bezier Curve
    getCurvedPath(start, end, inbound) {
        const lat1 = start[0], lon1 = start[1];
        const lat2 = end[0], lon2 = end[1];

        // Midpoint
        const midLat = (lat1 + lat2) / 2;
        const midLon = (lon1 + lon2) / 2;

        // Distance (approx) to scale arc height
        const dist = Math.sqrt(Math.pow(lat2 - lat1, 2) + Math.pow(lon2 - lon1, 2));

        // Control Point: Perpendicular offset? 
        // Simple Arc: Offset latitude (y-axis) based on distance
        // Giving it a "flight path" look (arching up/north usually looks good)
        // Let's offset Latitude proportional to distance.
        const arcHeight = dist * 0.25;

        // Adjust control point. 
        // We simply add to Latitude to make it curve "North". 
        // Or we could curve based on direction.
        const controlLat = midLat + arcHeight;
        const controlLon = midLon + (Math.random() * 5 - 2.5); // Slight random wobble for distinctness

        const points = [];
        const numPoints = 60; // Resolution

        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            // Quadratic Bezier Formula: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
            const lat = (1 - t) * (1 - t) * lat1 + 2 * (1 - t) * t * controlLat + t * t * lat2;
            const lon = (1 - t) * (1 - t) * lon1 + 2 * (1 - t) * t * controlLon + t * t * lon2;
            points.push([lat, lon]);
        }

        // Return ordered based on direction
        return inbound ? points : points.reverse();
    }

    drawLines() {
        this.updateDebugOverlay();
        // Redraw lines for all existing markers?
        // Actually slightly complex to re-bind lines to existing circle markers if we don't store relation.
        // Simplest: If Home resolve late, we might miss lines.
        // But `render` loop calls `addMarker` which calls `drawSingleLine`.
        // If `homeGeo` is null during loop, `drawSingleLine` exits.
        // So we need to re-iterate `activeMapConnections`.

        if (!this.homeGeo) return;

        // We don't want to double draw. 
        // Actually `markers` has circles AND lines.
        // Clean approach: clear all lines from markers array?
        // Or just re-run the render loop logic for lines?
        // Let's just iterate activeMapConnections and draw lines if missing?
        // Easier: Just re-render? No, expensive.
        // Pragmantic: Iterate connections, look up cached geo, draw line. 
        // Note: This might duplicate lines if called multiple times.
        // But `render` clears all markers first.
        // So `drawLines` is only called when Home resolves late.
        // Risk of duplication matches existing logic.

        this.activeMapConnections.forEach(conn => {
            const cached = localStorage.getItem('geoip_' + conn.remote_ip);
            if (cached) this.drawSingleLine(conn, JSON.parse(cached));
        });
    }

    updateDebugOverlay() {
        const isDebug = localStorage.getItem('mapDebugMode') === 'true';
        let debugDiv = document.getElementById('antpath-debug');

        if (!debugDiv && isDebug) {
            debugDiv = document.createElement('div');
            debugDiv.id = 'antpath-debug';
            // ... styles ...
            debugDiv.style.cssText = "position:absolute; bottom:10px; left:10px; background:rgba(0,0,0,0.7); color:#fff; padding:5px; font-size:10px; z-index:9999; pointer-events:none;";
            const wrapper = document.getElementById('fw-map-wrapper');
            if (wrapper) { wrapper.style.position = 'relative'; wrapper.appendChild(debugDiv); }
        }

        if (debugDiv) {
            debugDiv.style.display = isDebug ? 'block' : 'none';
            debugDiv.innerHTML = `
                <b>Debug:</b> Home: ${this.homeIP || '?'} (${this.homeGeo ? 'OK' : 'Pending'})<br>
                Conns: ${this.activeMapConnections.length}
            `;
        }
    }
}

// Global toggle for debug
window.toggleMapDebug = function () {
    const current = localStorage.getItem('mapDebugMode') === 'true';
    localStorage.setItem('mapDebugMode', !current);
    // Try to find instance? Global?
    if (window.currentFirewallMap) {
        window.currentFirewallMap.updateDebugOverlay();
    }
};

window.NetworkMap = NetworkMap;


// Restore global exports needed for HTML event handlers
window.selectFirewallHost = selectFirewallHost;
window.renderFirewallHostDetails = renderFirewallHostDetails;

// Restore Helper Functions
function getStatusColor(percent) {
    const val = parseFloat(percent);
    if (val < 80) return '#4ade80'; // Success Green
    if (val < 95) return '#fb923c'; // Warning Orange
    return '#ef4444'; // Critical Red
}

// Documentation System
function closeDocDrawer() {
    const modal = document.getElementById('doc-modal');
    // Optional: Add closing class for animation, then remove active
    modal.classList.remove('active');
}
window.closeDocDrawer = closeDocDrawer;

function goBackToDockerSummary() {
    selectedDockerHostId = null;
    renderHostNodes('host-nodes-container-generic', {
        icon: tools['docker']?.icon || 'fa-brands fa-docker',
        showOSInfo: true,
        showStats: true,
        onHostClick: 'selectDockerHost'
    });
    renderDockerSummary();
}
window.goBackToDockerSummary = goBackToDockerSummary;

function goBackToFirewallSummary() {
    selectedFirewallHostId = null;
    renderHostNodes('host-nodes-container-generic', {
        icon: tools['pfsense']?.icon || 'fa-solid fa-shield-halved',
        showOSInfo: true,
        showStats: true,
        onHostClick: 'selectFirewallHost'
    });
    fetchFirewallHosts();
}
window.goBackToFirewallSummary = goBackToFirewallSummary;

function initDocSystem() {
    const badges = document.querySelectorAll('.badge[data-doc]');
    const modal = document.getElementById('doc-modal');
    const body = document.getElementById('doc-body');

    badges.forEach(badge => {
        badge.addEventListener('click', () => {
            const docKey = badge.getAttribute('data-doc');
            if (!docKey) return;

            // Use 'active' class for flex display (Slide Over)
            modal.classList.add('active');

            body.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...</div>';

            fetch(`docs/${docKey}.html`)
                .then(res => {
                    if (!res.ok) throw new Error('Documento no encontrado: ' + docKey);
                    return res.text();
                })
                .then(html => {
                    body.innerHTML = html;
                })
                .catch(err => {
                    body.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 2rem;">
                        <i class="fa-solid fa-triangle-exclamation"></i> Error: ${err.message}
                    </div>`;
                });
        });
    });

    // Close modal on click outside
    window.onclick = function (event) {
        if (event.target == modal) {
            closeDocDrawer();
        }
        // Keep existing config modal logic (standard modal)
        const configModal = document.getElementById('config-modal');
        if (event.target == configModal) {
            configModal.style.display = "none";
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', initDocSystem);
