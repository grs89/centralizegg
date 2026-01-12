const API_HOSTS = '/api/hosts';
const API_VMS = '/api/vms';
const API_CONFIG_SERVERS = '/api/config/servers';
const API_FIREWALL_HOSTS = '/api/firewall/hosts';
const API_FIREWALL_SERVERS = '/api/firewall/servers';

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
let currentServers = [];
let currentFirewallServers = [];
let currentTool = null;
let selectedHostId = null;

// Cache for search
let allHostsCache = [];
let allVMsCache = [];
let searchQuery = "";
let selectedSuggestionIndex = -1;

// VM Network History Cache
const vmNetworkHistory = {}; // Key: vmId, Value: { rx: [], tx: [], lastRx, lastTx, lastTime }
// Firewall Network History Cache
const pfSenseNetworkHistory = {}; // Key: hostId_ifaceName, Value: { rx: [], tx: [], lastRx, lastTx, lastTime }
const HISTORY_POINTS = 20;

let selectedFirewallHostId = null;

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
                if (vm.net_tx >= entry.net_tx) {
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
                    containerInner.innerHTML = `
                        <div style="font-size: 4rem; color: var(--accent-color); margin-bottom: 2rem; opacity: 0.5;">
                            <i class="${tool.icon || 'fa-solid fa-box-open'}"></i>
                        </div>
                        <h2 style="margin-bottom: 1rem;">${toolKey === 'pfsense' ? 'Resumen' : `${tool.name} Management`}</h2>
                        <p style="color: var(--text-secondary); max-width: 500px; margin: 0 auto 2rem auto;">
                            ${toolKey === 'pfsense' ? 'Network Interfaces' : `Gestión completa de ${tool.name} próximamente.`}
                        </p>
                    `;
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

    // Update KVM hosts
    renderHosts();

    // Update VMs if KVM tool is active
    if (currentTool === 'kvm') {
        renderVMs();
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

        // Find if server is online from currentServers (config)
        const serverConfig = currentServers.find(s => s.id === host.server_id);
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

        let disks = [];
        try {
            if (vm.disks) disks = JSON.parse(vm.disks);
        } catch (e) { console.error("Error parsing disks JSON", e); }

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
                        <div class="vm-subtitle" style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;" title="${vm.os_name || 'Unknown OS'}">
                            ${(vm.os_name && vm.os_name.trim() !== "") ? vm.os_name : "Unknown OS"}
                        </div>
                        <div class="vm-subtitle" style="font-size: 0.75rem; color: var(--accent-color); margin-top: 1px;" title="${vm.guest_ips || 'N/A'}">
                            ${vm.guest_ips ? vm.guest_ips.split(' ')[0] : 'N/A'}
                        </div>
                    </div>
                </div>
                <div class="vm-status-badge ${isRunning ? 'running' : 'shutoff'}" title="${vm.state}">
                    <i class="fa-solid fa-power-off"></i>
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
                        <span>Disco${disks.length > 1 ? 's' : ''}</span>
                    </div>
                    <div class="stat-value-display">
                        ${disks.length > 1 ?
                disks.map(d => {
                    const dCap = (d.capacity / (1024 * 1024 * 1024)).toFixed(1);
                    const dAlloc = (d.allocation / (1024 * 1024 * 1024)).toFixed(1);
                    const dPct = d.capacity > 0 ? ((d.allocation / d.capacity) * 100).toFixed(0) : 0;
                    return `
                                <div style="margin-bottom: 4px;">
                                    <div class="vm-stat-value" style="font-size: 0.7rem; color: var(--text-secondary); display: flex; justify-content: space-between;">
                                        <span>${d.device}</span>
                                        <span style="color: ${getStatusColor(dPct)};">${dPct}% (${dAlloc}/${dCap}GB)</span>
                                    </div>
                                    <div class="host-progress-container" style="height: 3px;">
                                        <div class="host-progress-fill" style="width: ${dPct}%; background: ${getStatusColor(dPct)};"></div>
                                    </div>
                                </div>`;
                }).join('')
                :
                `<div class="vm-stat-value" style="color: ${getStatusColor(diskPercent)};">
                                ${diskPercent}% <span class="vm-stat-sub">(${diskUsedGB}/${diskTotalGB}GB)</span>
                            </div>
                            <div class="host-progress-container" style="height: 4px;">
                                <div class="host-progress-fill" style="width: ${diskPercent}%; background: ${getStatusColor(diskPercent)};"></div>
                            </div>`
            }
                    </div>
                </div>

                <!-- Network info with Sparklines -->
                <div class="vm-stat-item">
                    <div class="vm-stat-label">
                        <i class="fa-solid fa-network-wired"></i>
                        <span>Network</span>
                    </div>
                    <div class="stat-value-display">
                        <div style="display: flex; gap: 10px; align-items: flex-end; justify-content: space-between;">
                            
                            <!-- RX Column -->
                            <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                                <div style="font-size: 0.65rem; color: var(--text-secondary); display: flex; justify-content: space-between;">
                                    <span>RX</span>
                                    <span>${vmNetworkHistory[vm.id] ? formatBytes(vmNetworkHistory[vm.id].rx[vmNetworkHistory[vm.id].rx.length - 1], 1) + '/s' : '0 B/s'}</span>
                                </div>
                                <div style="height: 25px; overflow: hidden; opacity: 0.8;">
                                    ${vmNetworkHistory[vm.id] ? renderSparkline(vmNetworkHistory[vm.id].rx, '#4ade80', 60, 25) : ''}
                                </div>
                            </div>

                            <!-- TX Column -->
                            <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                                <div style="font-size: 0.65rem; color: var(--text-secondary); display: flex; justify-content: space-between;">
                                    <span>TX</span>
                                    <span>${vmNetworkHistory[vm.id] ? formatBytes(vmNetworkHistory[vm.id].tx[vmNetworkHistory[vm.id].tx.length - 1], 1) + '/s' : '0 B/s'}</span>
                                </div>
                                <div style="height: 25px; overflow: hidden; opacity: 0.8;">
                                     ${vmNetworkHistory[vm.id] ? renderSparkline(vmNetworkHistory[vm.id].tx, '#fb923c', 60, 25) : ''}
                                </div>
                            </div>

                        </div>
                         ${vm.guest_ips ? `<div class="vm-stat-sub" style="font-size: 0.70rem; color: var(--accent-color); margin-top:4px; text-align: right;">${vm.guest_ips.split(' ')[0]}</div>` : ''}
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
        const apiUrl = getConfigAPIForTool(currentTool);
        await fetch(apiUrl + '/' + id, { method: 'DELETE' });
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
        let kvmServers = [];
        if (kvmResponse.ok) {
            kvmServers = await kvmResponse.json() || [];
        }

        // Check Firewall servers
        const firewallResponse = await fetch(API_FIREWALL_SERVERS);
        let firewallServers = [];
        if (firewallResponse.ok) {
            firewallServers = await firewallResponse.json() || [];
        }

        currentServers = kvmServers; // Sync global state for KVM
        currentFirewallServers = firewallServers; // Sync global state for Firewall

        // Combine all servers and filter offline ones
        const allServers = [...kvmServers, ...firewallServers];
        const offlineServers = allServers.filter(s => s.status === 'offline');
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
                        <span class="offline-details">${s.ip_address}:${s.ssh_port || s.api_port || 22}</span>
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
                <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;">Resumen</h2>
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
                            ${host.gateways.map(gw => `
                                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px;">
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
                    let lossVal = parseFloat(gw.loss);
                    let lossColor = 'var(--text-secondary)';
                    if (!isNaN(lossVal)) {
                        if (lossVal > 0) lossColor = '#fb923c'; // Warning (Orange)
                        if (lossVal >= 10) lossColor = '#ef4444'; // Critical (Red)
                    }
                    return `<span title="Packet Loss"><i class="fa-solid fa-chart-simple" style="font-size: 0.65rem; opacity: 0.7; margin-right: 3px; color:${lossColor}"></i><span style="color:${lossColor}">${gw.loss}</span></span>`;
                })()}
                                    </div>
                                </div>
                            `).join('')}
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
                    <div style="margin-top: 25px;">
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

                    <!-- Active Connections / Anomaly Detection -->
                    ${(() => {
            let activeConns = [];
            try {
                // Safely parse JSON
                activeConns = host.active_connections ? JSON.parse(host.active_connections) : [];
            } catch (e) {
                console.error("Error parsing active_connections:", e);
            }

            if (activeConns.length > 0) {
                // Sort by total connections descending
                activeConns.sort((a, b) => (b.inbound + b.outbound) - (a.inbound + a.outbound));
                // Take top 5
                const topConns = activeConns.slice(0, 5);

                return `
                                <div style="margin-top: 25px;">
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
                    // Anomaly Threshold: Arbitrary (e.g., > 50 connections from one IP might be interesting)
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
            }
            return '';
        })()}

                </div>
            </div>
        </div>
    `;

    // Ensure persistent containers exist
    let statsWrapper = document.getElementById('fw-stats-wrapper');
    let mapWrapper = document.getElementById('fw-map-wrapper');

    if (!statsWrapper) {
        scannerSection.innerHTML = `
            <div id="fw-stats-wrapper"></div>
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
    setTimeout(() => {
        initTrafficMap(host.active_connections);
    }, 100);
}

// Global GeoIP Queue System
const geoQueue = [];
let isProcessingQueue = false;
let isRateLimited = false;

// Process Queue Loop
async function processGeoQueue() {
    if (isProcessingQueue || isRateLimited || geoQueue.length === 0) return;

    isProcessingQueue = true;
    const { ip, callback } = geoQueue.shift();

    try {
        const cached = localStorage.getItem('geoip_' + ip);
        if (cached) {
            callback(JSON.parse(cached));
        } else {
            console.log(`Fetching GeoIP for ${ip}...`);
            const res = await fetch(`http://ip-api.com/json/${ip}`);

            if (!res.ok) {
                if (res.status === 429 || res.status === 409) {
                    console.warn(`Rate limit hit for ${ip}. Backing off for 60s.`);
                    isRateLimited = true;
                    geoQueue.unshift({ ip, callback }); // Return to front
                    setTimeout(() => { isRateLimited = false; processGeoQueue(); }, 60000);
                } else {
                    console.error(`GeoIP Error ${res.status}: ${res.statusText}`);
                    localStorage.setItem('geoip_' + ip, JSON.stringify({ error: true })); // Cache error to avoid retry
                    callback(null);
                }
            } else {
                const data = await res.json();
                if (data.status === 'success') {
                    const geoData = { lat: data.lat, lon: data.lon, city: data.city, country: data.country };
                    localStorage.setItem('geoip_' + ip, JSON.stringify(geoData));
                    callback(geoData);
                } else {
                    localStorage.setItem('geoip_' + ip, JSON.stringify({ error: true }));
                    callback(null);
                }
            }
        }
    } catch (e) {
        console.error("GeoIP Fetch Exception:", e);
        // Put back in queue if network error? No, just skip to avoid blocking
        callback(null);
    } finally {
        isProcessingQueue = false;
        // Strict 2s delay between processing next item
        setTimeout(processGeoQueue, 2000);
    }
}

// Map variables
let mapInstance = null;
let mapMarkers = [];

async function initTrafficMap(connsJSON) {
    if (!document.getElementById('trafficMap')) return;

    let connections = [];
    try {
        connections = typeof connsJSON === 'string' ? JSON.parse(connsJSON) : connsJSON;
    } catch (e) { return; }

    // Init Map
    const container = document.getElementById('trafficMap');
    let lastCenter = [20, 0];
    let lastZoom = 2;

    if (mapInstance) {
        // If container element has changed (due to innerHTML refresh), we must re-init
        if (mapInstance.getContainer() !== container) {
            lastCenter = mapInstance.getCenter();
            lastZoom = mapInstance.getZoom();
            mapInstance.remove();
            mapInstance = null;
        } else {
            mapInstance.invalidateSize();
        }
    }

    if (!mapInstance) {
        mapInstance = L.map('trafficMap').setView(lastCenter, lastZoom);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy;OpenStreetMap, &copy;CartoDB',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(mapInstance);
    }

    // Clear markers
    mapMarkers.forEach(m => mapInstance.removeLayer(m));
    mapMarkers = [];

    // Debug: Check plugin
    if (typeof L.polyline.antPath === 'undefined') {
        console.error('[AntPath] Plugin NOT loaded.');
    } else {
        console.log('[AntPath] Plugin loaded successfully.');
    }

    // Queue requests
    const topConns = connections.slice(0, 50);
    console.log(`[AntPath] Processing ${topConns.length} connections for map.`);

    // Expose for redraw
    window.activeMapConnections = topConns;

    // Detect/Update Home Location (now that we might have Host data)
    updateHomeLocation();

    // Debug: Force overlay update
    updateDebugOverlay();

    topConns.forEach(conn => {
        const ip = conn.remote_ip;

        // Check cache synchronously first to avoid queue if possible (optimization)
        const cached = localStorage.getItem('geoip_' + ip);
        if (cached) {
            addMarker(conn, JSON.parse(cached));
        } else {
            // Add to queue
            // Check if already in queue to avoid duplicates
            if (!geoQueue.some(item => item.ip === ip)) {
                geoQueue.push({
                    ip: ip,
                    callback: (geoData) => {
                        if (geoData && !geoData.error) {
                            addMarker(conn, geoData);
                        }
                    }
                });
            }
        }
    });

}

// Start processing if not already
processGeoQueue();

// Define global drawLines function to handle Home IP resolution callback
function drawLines() {
    updateDebugOverlay(); // Update status
    console.log('[AntPath] drawLines() called.');
    if (!window.activeMapConnections) {
        console.warn('[AntPath] No active connections to draw.');
        return;
    }

    if (!homeGeo) {
        console.warn('[AntPath] homeGeo is not ready yet.');
        return;
    }

    console.log(`[AntPath] Attempting to draw lines for ${window.activeMapConnections.length} connections. HomeGeo:`, homeGeo);

    window.activeMapConnections.forEach(conn => {
        const ip = conn.remote_ip;
        const cached = localStorage.getItem('geoip_' + ip);
        if (cached) {
            const remoteGeo = JSON.parse(cached);
            drawSingleLine(conn, remoteGeo);
        }
    });
}

// Helper to check for private IP
const isPrivate = (ip) => {
    return ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.') || (ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31);
};

// --- HOME LOCATION LOGIC ---
let homeIP = null;
let homeGeo = null;

function updateHomeLocation() {
    let newHomeIP = null;

    // 1. Try to find public IP from host interfaces
    if (window.currentFirewallHost && window.currentFirewallHost.interfaces) {
        for (const iface of window.currentFirewallHost.interfaces) {
            if (iface.ip_address && !isPrivate(iface.ip_address)) {
                newHomeIP = iface.ip_address;
                // console.log('[AntPath] Found public Home IP from interfaces:', newHomeIP);
                break;
            }
        }
    }

    // 2. Fallback to 'self'
    if (!newHomeIP) {
        newHomeIP = 'self';
        // console.log('[AntPath] Defaulting Home IP to "self".');
    }

    // Helper to queue Home IP resolution
    const queueHomeResolution = (targetIP) => {
        const queryIP = targetIP === 'self' ? '' : targetIP;
        // Avoid adding duplicates to queue if already pending? 
        // We will allow check because we might be retrying.

        console.log(`[AntPath] Queuing Home IP resolution for: "${targetIP}"`);
        geoQueue.unshift({
            ip: queryIP,
            callback: (geoData) => {
                if (geoData && !geoData.error) {
                    homeGeo = geoData;
                    localStorage.setItem('geoip_' + targetIP, JSON.stringify(geoData));
                    console.log(`[AntPath] Resolved Home Geo for ${targetIP}:`, homeGeo);
                    drawLines();
                } else {
                    console.error(`[AntPath] Failed to resolve Home Geo for ${targetIP}.`);

                    // FALLBACK STRATEGY
                    if (targetIP !== 'self') {
                        console.warn('[AntPath] Falling back to "self" for Home IP.');
                        homeIP = 'self';
                        queueHomeResolution('self');
                    }
                }
            }
        });
    };

    // If Home IP changed
    if (newHomeIP !== homeIP) {
        // Improved Selection Heuristic:
        // Try to find a BETTER public IP if the current one is 172.x (often confused with Docker/Carrier NAT)
        // scan window.currentFirewallHost.interfaces again
        let bestIP = newHomeIP;
        if (window.currentFirewallHost && window.currentFirewallHost.interfaces) {
            const candidates = window.currentFirewallHost.interfaces
                .filter(i => i.ip_address && !isPrivate(i.ip_address))
                .map(i => i.ip_address);

            // Prefer non-172 IPs
            const better = candidates.find(ip => !ip.startsWith('172.'));
            if (better) bestIP = better;
        }
        newHomeIP = bestIP;

        console.log(`[AntPath] Home IP changed: ${homeIP} -> ${newHomeIP}`);
        homeIP = newHomeIP;
        homeGeo = null; // Reset geo

        // Check cache
        const cachedHome = localStorage.getItem('geoip_' + homeIP);
        let loadedFromCache = false;
        if (cachedHome) {
            const parsed = JSON.parse(cachedHome);
            if (!parsed.error && parsed.lat) {
                homeGeo = parsed;
                console.log('[AntPath] Loaded Home Geo from cache:', homeGeo);
                drawLines();
                loadedFromCache = true;
            } else {
                console.warn('[AntPath] Cached Home Geo is invalid/error. Clearing and retrying.');
                localStorage.removeItem('geoip_' + homeIP);
            }
        }

        if (!loadedFromCache) {
            queueHomeResolution(homeIP);
        }
    } else {
        // IP didn't change (e.g. still 'self' or same public IP)
        if (homeGeo && !homeGeo.error) {
            // Already resolved: force redraw
            setTimeout(drawLines, 100);
        } else {
            // CRITICAL FIX: IP matches, but Geo is missing or invalid! 
            const cachedHome = localStorage.getItem('geoip_' + homeIP);
            let isValidCache = false;
            if (cachedHome) {
                const parsed = JSON.parse(cachedHome);
                if (!parsed.error && parsed.lat) {
                    homeGeo = parsed;
                    drawLines();
                    isValidCache = true;
                }
            }

            if (!isValidCache) {
                console.warn('[AntPath] Home IP set but Geo missing/invalid. Retrying resolution.');
                queueHomeResolution(homeIP);
            }
        }
    }
}

function addMarker(conn, geoData) {
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
    }).addTo(mapInstance);

    circle.bindPopup(`
            <b>${conn.remote_ip}</b><br>
            ${geoData.city}, ${geoData.country}<br>
            Tipo: <span style="color:${color}">${type}</span><br>
            Conexiones: In: ${conn.inbound} / Out: ${conn.outbound}
        `);
    mapMarkers.push(circle);

    // Attempt to draw line if Home is ready
    drawSingleLine(conn, geoData);
}

function drawSingleLine(conn, remoteGeo) {
    if (!homeGeo || !homeGeo.lat) {
        // console.warn('[AntPath] Skipping line: Home Geo not ready.');
        return;
    }
    if (!remoteGeo || !remoteGeo.lat) return;

    // Ensure coordinates are numbers
    const hLat = parseFloat(homeGeo.lat);
    const hLon = parseFloat(homeGeo.lon);
    const rLat = parseFloat(remoteGeo.lat);
    const rLon = parseFloat(remoteGeo.lon);

    console.log(`[AntPath] Check Line: Home[${hLat},${hLon}] <-> Remote[${rLat},${rLon}]`);

    // Don't draw if same location
    if (Math.abs(hLat - rLat) < 0.0001 && Math.abs(hLon - rLon) < 0.0001) {
        console.debug('[AntPath] Skipping line: Same location.');
        return;
    }

    const isInbound = conn.inbound > conn.outbound;
    const color = isInbound ? '#ef4444' : '#22c55e';

    // Define path points
    const latlngs = isInbound
        ? [[rLat, rLon], [hLat, hLon]]
        : [[hLat, hLon], [rLat, rLon]];

    // Create AntPath
    try {
        // Use 'new' constructor or factory? 
        // L.polyline.antPath is the factory. Use standard options.
        const path = L.polyline.antPath(latlngs, {
            "delay": 1000,
            "dashArray": [10, 20],
            "weight": 4, // Increased weight again
            "color": color,
            "pulseColor": "#ffffff",
            "paused": false,
            "reverse": false,
            "hardwareAccelerated": false // Disable for compatibility
        });

        path.addTo(mapInstance);
        mapMarkers.push(path);
        // console.log('[AntPath] SUCCESS: Line drawn for ' + conn.remote_ip);
    } catch (e) {
        console.error('[AntPath] Error creating path:', e);
    }

    // FALLBACK: Draw a standard gray line to confirm coordinates are correct
    try {
        const fallback = L.polyline(latlngs, {
            color: '#666',
            weight: 1,
            dashArray: '5, 5',
            opacity: 0.5
        }).addTo(mapInstance);
        mapMarkers.push(fallback);
    } catch (e) { }
}

// DEBUG: Status Overlay
window.toggleMapDebug = function () {
    const current = localStorage.getItem('mapDebugMode') === 'true';
    localStorage.setItem('mapDebugMode', !current);
    updateDebugOverlay();
};

function updateDebugOverlay() {
    let debugDiv = document.getElementById('antpath-debug');
    const isDebug = localStorage.getItem('mapDebugMode') === 'true';

    if (!debugDiv) {
        debugDiv = document.createElement('div');
        debugDiv.id = 'antpath-debug';
        debugDiv.style.position = 'absolute';
        debugDiv.style.bottom = '10px';
        debugDiv.style.left = '10px';
        debugDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
        debugDiv.style.color = '#fff';
        debugDiv.style.padding = '5px';
        debugDiv.style.fontSize = '10px';
        debugDiv.style.zIndex = '9999';
        debugDiv.style.pointerEvents = 'none';
        debugDiv.style.display = isDebug ? 'block' : 'none'; // Initial state

        // Find map wrapper
        const wrapper = document.getElementById('fw-map-wrapper');
        if (wrapper) wrapper.style.position = 'relative';
        if (wrapper) wrapper.appendChild(debugDiv);
    } else {
        debugDiv.style.display = isDebug ? 'block' : 'none';
    }

    debugDiv.innerHTML = `
        <b>Debug Status:</b><br>
        HomeIP: ${homeIP || 'Unknown'}<br>
        GeoReady: ${homeGeo ? 'Yes' : 'No'}<br>
        Connections: ${window.activeMapConnections ? window.activeMapConnections.length : 0}<br>
        AntPath Loaded: ${typeof L.polyline.antPath !== 'undefined' ? 'Yes' : 'NO'}
    `;
}



// Check for plugin availability
if (typeof L.polyline.antPath !== 'function') {
    console.error('Leaflet AntPath plugin not loaded! Animations will not work.');
}

window.selectFirewallHost = selectFirewallHost;
window.renderFirewallHostDetails = renderFirewallHostDetails;

function getStatusColor(percent) {
    const val = parseFloat(percent);
    if (val <= 60) return '#22c55e'; // Success Green
    if (val <= 80) return '#eab308'; // Warning Yellow/Amber
    return '#ef4444'; // Danger Red
}
