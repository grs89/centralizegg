import {
    API_HOSTS, API_VMS, API_CONFIG_SERVERS, API_FIREWALL_HOSTS,
    API_FIREWALL_SERVERS, API_CONTAINER_HOSTS, API_CONTAINER_CONTAINERS,
    API_KUBERNETES_NODES, API_KUBERNETES_PODS, API_KUBERNETES_PVS,
    API_KUBERNETES_EVENTS, API_PODMAN_HOSTS, API_PODMAN_CONTAINERS,
    API_PROXMOX_HOSTS, API_PROXMOX_VMS, API_NAS_HOSTS,
    API_NAS_VOLUMES, API_NAS_DISKS, getConfigAPIForTool
} from './js/api.js';

import {
    debounce, formatBytes, getStatusColor, getRelativeTime, playAlertSound, getOSIcon
} from './js/utils.js';
import { initSummaryDashboard } from './js/summary-dashboard.js';
import { state } from './js/state.js';
import { renderHostNodes, isStatusOnline, renderDonutChart, renderSparkline } from './js/ui-components.js';
import {
    updateNetworkHistory, updateBridgeHistory, updateContainerHistory, updateFirewallHistory
} from './js/history.js';
import {
    fetchHosts, renderHosts, selectHost, fetchVMs, renderVMs, renderHostEvents,
    startVM, stopVM
} from './js/tool-kvm.js?v=4';

// Expose functions to global scope for event handlers
window.selectHost = selectHost;
window.startVM = startVM;
window.stopVM = stopVM;


// Note: We are migrating these to the 'state' object for better performance and modularity.
// References will be updated progressively.
const HISTORY_POINTS = state.HISTORY_POINTS;

// Chart components are now in ui-components.js
// History updaters are now in history.js



const tools = {
    'welcome': {
        name: 'Inicio',
        icon: 'fa-solid fa-rocket',
        elementId: 'welcome-screen',
        categoryBtnId: null,
        categoryName: 'Inicio'
    },
    'summary': {
        name: 'Dashboard',
        icon: 'fa-solid fa-gauge-high',
        elementId: 'summary-tool',
        categoryBtnId: 'dashboard-btn',
        categoryName: 'Dashboard'
    },
    'history': {
        name: 'Historial',
        icon: 'fa-solid fa-clock-rotate-left',
        elementId: 'history-tool',
        categoryBtnId: 'history-btn',
        categoryName: 'Historial'
    },
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
        icon: 'fa-solid fa-otter',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'containers-btn',
        categoryName: 'Contenedores'
    },
    'kubernetes': {
        name: 'Kubernetes',
        icon: 'fa-solid fa-dharmachakra',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'containers-btn',
        categoryName: 'Contenedores'
    },
    'web_services': {
        name: 'Servidores web',
        icon: 'fa-solid fa-globe',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'services-btn',
        categoryName: 'Servidores'
    },
    'db_services': {
        name: 'Servidores de DB',
        icon: 'fa-solid fa-database',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'services-btn',
        categoryName: 'Servidores'
    },
    'pfsense': {
        name: 'PFsense',
        icon: 'fa-brands fa-freebsd',
        elementId: 'container-scanner-tool',
        categoryBtnId: 'firewall-btn',
        categoryName: 'Firewall'
    },
    'logs': {
        name: 'Logs',
        icon: 'fa-solid fa-file-lines',
        elementId: 'logs-tool',
        categoryBtnId: 'log-btn',
        categoryName: 'Log'
    },
    'settings': {
        name: 'Configuración',
        icon: 'fa-solid fa-gear',
        elementId: 'settings-tool',
        categoryBtnId: 'config-btn',
        categoryName: 'Configuración'
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

    state.currentTool = toolKey;
    state.selectedHostId = null;
    state.lastRenderedVMsHash = "";

    // Update Category Button Identity (Reset others to defaults)
    try {
        const categoryDefaults = {
            'virtualization-btn': { name: 'Virtualización', icon: 'fa-solid fa-microchip' },
            'storage-btn': { name: 'Almacenamiento', icon: 'fa-solid fa-database' },
            'firewall-btn': { name: 'Firewall', icon: 'fa-solid fa-shield-halved' },
            'containers-btn': { name: 'Contenedores', icon: 'fa-solid fa-box' },
            'services-btn': { name: 'Servidores', icon: 'fa-solid fa-gears' }
        };

        Object.keys(categoryDefaults).forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (!btn) return;

            if (btnId === tool.categoryBtnId) {
                // Current tool category: set to specific tool name
                btn.innerHTML = `<i class="${tool.icon}"></i> ${tool.name} <i class="fa-solid fa-chevron-down" style="font-size: 0.8rem; margin-left: 5px;"></i>`;
            } else {
                // Inactive category: reset to default label
                const def = categoryDefaults[btnId];
                btn.innerHTML = `<i class="${def.icon}"></i> ${def.name} <i class="fa-solid fa-chevron-down" style="font-size: 0.8rem; margin-left: 5px;"></i>`;
            }
        });
    } catch (e) {
        console.error('[DEBUG] Failed to update category buttons:', e);
    }

    // Comprehensive visibility management
    const virtTool = document.getElementById('virtualization-tool');
    const containerTool = document.getElementById('container-scanner-tool');
    const settingsTool = document.getElementById('settings-tool');
    const logsTool = document.getElementById('logs-tool');
    const historyTool = document.getElementById('history-tool');

    if (virtTool) {
        if (toolKey === 'kvm') {
            virtTool.classList.remove('hidden');
        } else {
            virtTool.classList.add('hidden');
        }
    }

    if (settingsTool) {
        const configBtn = document.getElementById('config-btn');
        if (toolKey === 'settings') {
            settingsTool.classList.remove('hidden');
            if (configBtn) configBtn.classList.add('active');
            initSettings();
        } else {
            settingsTool.classList.add('hidden');
            if (configBtn) configBtn.classList.remove('active');
        }
    }

    if (logsTool) {
        const logBtn = document.getElementById('log-btn');
        if (toolKey === 'logs') {
            logsTool.classList.remove('hidden');
            if (logBtn) logBtn.classList.add('active');
            initLogs();
        } else {
            logsTool.classList.add('hidden');
            if (logBtn) logBtn.classList.remove('active');
        }
    }

    const summaryTool = document.getElementById('summary-tool');
    const welcomeScreen = document.getElementById('welcome-screen');

    if (welcomeScreen) {
        if (toolKey === 'welcome') {
            welcomeScreen.style.display = 'flex';
        } else {
            welcomeScreen.style.display = 'none';
        }
    }

    if (summaryTool) {
        if (toolKey === 'summary') {
            summaryTool.style.display = 'block';
            const dashboardBtn = document.getElementById('dashboard-btn');
            if (dashboardBtn) dashboardBtn.classList.add('active');
            initSummaryDashboard();
        } else {
            summaryTool.style.display = 'none';
            const dashboardBtn = document.getElementById('dashboard-btn');
            if (dashboardBtn) dashboardBtn.classList.remove('active');
        }
    }

    if (historyTool) {
        if (toolKey === 'history') {
            historyTool.classList.remove('hidden');
            const historyBtn = document.getElementById('history-btn');
            if (historyBtn) historyBtn.classList.add('active');
            renderHistory();
        } else {
            historyTool.classList.add('hidden');
            const historyBtn = document.getElementById('history-btn');
            if (historyBtn) historyBtn.classList.remove('active');
        }
    }

    if (containerTool) {
        if (['kvm', 'settings', 'logs', 'summary', 'welcome', 'history'].includes(toolKey)) {
            containerTool.classList.add('hidden');
        } else {
            containerTool.classList.remove('hidden');

            // Update placeholder content
            const scannerSection = containerTool.querySelector('.scanner-section');
            if (scannerSection) {
                // Always show scanner section for non-KVM tools, including pfSense
                scannerSection.style.display = 'block';
                const containerInner = containerTool.querySelector('.scanner-section .glass-panel');

                // Default reset
                if (containerInner) {
                    containerInner.style.textAlign = 'center';
                    let placeholderHtml = '';

                    if (toolKey === 'pfsense') {
                        renderFirewallSummary();
                    } else if (toolKey === 'docker') {
                        // Restore previous selection if exists
                        if (state.selectedDockerHostId) {
                            renderDockerHostDetails(state.selectedDockerHostId);
                        } else {
                            renderDockerSummary();
                        }
                    } else if (toolKey === 'kubernetes') {
                        // Restore previous selection if exists
                        if (state.selectedKubernetesServerId) {
                            renderKubernetesServerDetails(state.selectedKubernetesServerId);
                        } else {
                            renderKubernetesSummary();
                        }
                    } else if (toolKey === 'podman') {
                        // Restore previous selection if exists
                        if (state.selectedPodmanHostId) {
                            renderPodmanHostDetails(state.selectedPodmanHostId);
                        } else {
                            renderPodmanSummary();
                        }
                    } else if (toolKey === 'proxmox') {
                        // Restore previous selection if exists
                        if (state.selectedProxmoxHostId) {
                            renderProxmoxHostDetails(state.selectedProxmoxHostId);
                        } else {
                            renderProxmoxSummary();
                        }
                    } else if (toolKey === 'nas') {
                        // Restore previous selection if exists
                        if (state.selectedNasHostId) {
                            renderNasHostDetails(state.selectedNasHostId);
                        } else {
                            renderNasSummary();
                        }
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

                    if (placeholderHtml) {
                        containerInner.innerHTML = placeholderHtml;
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
        }
    }

    // Trigger data fetch based on tool
    if (toolKey === 'kvm') {
        console.log('[DEBUG] Refreshing KVM data...');
        refreshAll();
    } else if (toolKey === 'pfsense') {
        fetchFirewallHosts();
    } else if (toolKey !== 'settings') {
        checkAndFetchHostsForTool(toolKey);
    }
}

// Global click handler (Event Delegation)
document.addEventListener('click', (e) => {
    const toolLink = e.target.closest('[data-tool]');
    if (toolLink) {
        e.preventDefault();
        const toolKey = toolLink.getAttribute('data-tool');
        console.log('[DEBUG] Valid tool click detected:', toolKey);
        switchTool(toolKey);
    }
}); // Navigation to home (Global Health Dashboard)
function goHome() {
    console.log('[DEBUG] Navigating to home screen');
    switchTool('welcome');
}

window.goHome = goHome;
window.switchTool = switchTool;


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
let preloadingAll = false;
async function preloadAllCaches() {
    if (preloadingAll) return;
    preloadingAll = true;
    console.log('[DEBUG] Preloading all caches for global search...');

    // Fetch critical data for all tools to populate search index
    const promises = [
        fetchHosts(),
        fetchVMs(),
        checkAndFetchHostsForTool('docker'),
        checkAndFetchHostsForTool('podman'),
        checkAndFetchHostsForTool('nas'),
        checkAndFetchHostsForTool('pfsense'),
        checkAndFetchHostsForTool('kubernetes'),
        checkAndFetchHostsForTool('proxmox')
    ];

    await Promise.allSettled(promises);
}

// Search Input Listener
const searchInput = document.getElementById('global-search');
const suggestionsContainer = document.getElementById('search-suggestions');
const searchBtn = document.getElementById('search-btn');

if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => {
        searchInput.focus();
        preloadAllCaches(); // Preload when user interacts with search
        if (searchInput.value.trim() !== "") {
            searchInput.dispatchEvent(new Event('input'));
        }
    });
}

searchInput?.addEventListener('focus', () => {
    preloadAllCaches(); // Preload as soon as user clicks the search box
});

const debouncedSearch = debounce((e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    console.log('[DEBUG] Search Query (Debounced):', state.searchQuery);

    // If on summary dashboard and user starts searching, switch to a tool view (kvm)
    const summaryTool = document.getElementById('summary-tool');
    if (state.searchQuery.length > 0 && summaryTool && !summaryTool.classList.contains('hidden')) {
        switchTool('kvm');
        // Restore the search query after switchTool (which might reset some state)
        searchInput.value = e.target.value;
    }

    state.selectedSuggestionIndex = -1; // Reset selection
    updateSuggestions();

    // Update KVM hosts
    renderHosts();

    // Update VMs if KVM tool is active
    if (state.currentTool === 'kvm') {
        renderVMs();
    }

    if (state.currentTool === 'docker') {
        renderDockerHostDetails(state.selectedDockerHostId);
    }

    // Also update generic host nodes container if visible (for other tools)
    const genericContainer = document.getElementById('host-nodes-container-generic');
    if (genericContainer) {
        const toolSection = genericContainer.closest('section');
        if (toolSection && !toolSection.closest('.hidden')) {
            const currentToolObj = tools[state.currentTool];
            if (currentToolObj && state.currentTool !== 'kvm') {
                renderHostNodes('host-nodes-container-generic', {
                    icon: currentToolObj.icon,
                    showOSInfo: true,
                    showStats: true
                });
            }
        }
    }
}, 300);

searchInput?.addEventListener('input', debouncedSearch);

searchInput?.addEventListener('keydown', (e) => {
    const items = suggestionsContainer.querySelectorAll('.suggestion-item');
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.selectedSuggestionIndex = Math.min(state.selectedSuggestionIndex + 1, items.length - 1);
        updateSuggestionSelection(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.selectedSuggestionIndex = Math.max(state.selectedSuggestionIndex - 1, 0);
        updateSuggestionSelection(items);
    } else if (e.key === 'Enter') {
        if (state.selectedSuggestionIndex >= 0 && items[state.selectedSuggestionIndex]) {
            e.preventDefault();
            items[state.selectedSuggestionIndex].click();
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

// --- Theme Toggle Logic ---
function initTheme() {
    const themeBtn = document.getElementById('theme-toggle-btn');
    const themeIcon = document.getElementById('theme-icon');
    if (!themeBtn || !themeIcon) return;

    // Load saved theme or default to dark
    const savedTheme = localStorage.getItem('centralizegg_theme') || 'dark';

    function applyTheme(theme) {
        if (theme === 'light') {
            document.body.classList.add('light-theme');
            themeIcon.className = 'fa-solid fa-sun';
        } else {
            document.body.classList.remove('light-theme');
            themeIcon.className = 'fa-solid fa-moon';
        }
    }

    applyTheme(savedTheme);

    themeBtn.addEventListener('click', () => {
        const isLight = document.body.classList.contains('light-theme');
        const newTheme = isLight ? 'dark' : 'light';
        localStorage.setItem('centralizegg_theme', newTheme);
        applyTheme(newTheme);
    });
}
initTheme();
// --------------------------

function updateSuggestionSelection(items) {
    items.forEach((item, index) => {
        if (index === state.selectedSuggestionIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function updateSuggestions() {
    if (!state.searchQuery || state.searchQuery.length < 1) {
        suggestionsContainer.innerHTML = '';
        suggestionsContainer.classList.add('hidden');
        return;
    }

    const suggestions = [];

    // Match KVM Hosts
    state.allKVMHostsCache.forEach(host => {
        if (host.server_name.toLowerCase().includes(state.searchQuery) ||
            host.hostname.toLowerCase().includes(state.searchQuery) ||
            host.ip_address.toLowerCase().includes(state.searchQuery)) {
            suggestions.push({ type: 'host', id: host.id, title: host.server_name, subtitle: `${host.hostname} | ${host.ip_address}`, icon: 'fa-solid fa-server', tool: 'kvm' });
        }
    });

    // Match Docker Hosts
    state.allDockerHostsCache.forEach(host => {
        if (host.server_name.toLowerCase().includes(state.searchQuery) ||
            host.hostname.toLowerCase().includes(state.searchQuery) ||
            host.ip_address.toLowerCase().includes(state.searchQuery)) {
            suggestions.push({ type: 'host', id: host.id, title: host.server_name, subtitle: `Docker: ${host.hostname}`, icon: 'fa-brands fa-docker', tool: 'docker' });
        }
    });

    // Match Podman Hosts
    state.allPodmanHostsCache.forEach(host => {
        if (host.server_name.toLowerCase().includes(state.searchQuery) ||
            host.hostname.toLowerCase().includes(state.searchQuery) ||
            host.ip_address.toLowerCase().includes(state.searchQuery)) {
            suggestions.push({ type: 'host', id: host.id, title: host.server_name, subtitle: `Podman: ${host.hostname}`, icon: 'fa-solid fa-layer-group', tool: 'podman' });
        }
    });

    // Match Kubernetes Servers
    state.allKubernetesHostsCache.forEach(host => {
        const name = host.server_name || host.name || 'K8s Cluster';
        if (name.toLowerCase().includes(state.searchQuery) || (host.ip_address && host.ip_address.toLowerCase().includes(state.searchQuery))) {
            suggestions.push({ type: 'host', id: host.id, title: name, subtitle: `K8s: ${host.ip_address || 'Cluster'}`, icon: 'fa-solid fa-network-wired', tool: 'kubernetes' });
        }
    });

    // Match firewall/pfsense Hosts
    state.allFirewallHostsCache.forEach(host => {
        if (host.server_name.toLowerCase().includes(state.searchQuery) ||
            host.hostname.toLowerCase().includes(state.searchQuery) ||
            host.ip_address.toLowerCase().includes(state.searchQuery)) {
            suggestions.push({ type: 'host', id: host.id, title: host.server_name, subtitle: `pfSense: ${host.ip_address}`, icon: 'fa-solid fa-shield-halved', tool: 'pfsense' });
        }
    });

    // Match NAS Hosts
    state.allNasHostsCache.forEach(host => {
        if (host.server_name.toLowerCase().includes(state.searchQuery) ||
            host.hostname.toLowerCase().includes(state.searchQuery) ||
            host.ip_address.toLowerCase().includes(state.searchQuery)) {
            suggestions.push({ type: 'host', id: host.id, title: host.server_name, subtitle: `NAS: ${host.ip_address}`, icon: 'fa-solid fa-hdd', tool: 'nas' });
        }
    });

    // Match Proxmox Hosts
    state.allProxmoxHostsCache.forEach(host => {
        if (host.server_name.toLowerCase().includes(state.searchQuery) ||
            host.hostname.toLowerCase().includes(state.searchQuery) ||
            host.ip_address.toLowerCase().includes(state.searchQuery)) {
            suggestions.push({ type: 'host', id: host.id, title: host.server_name, subtitle: `Proxmox: ${host.ip_address}`, icon: 'fa-solid fa-microchip', tool: 'proxmox' });
        }
    });

    // Match KVM VMs
    state.allVMsCache.forEach(vm => {
        if (vm.name.toLowerCase().includes(state.searchQuery)) {
            const host = state.allKVMHostsCache.find(h => h.id === vm.host_id);
            suggestions.push({ type: 'vm', id: vm.host_id, title: vm.name, subtitle: host ? `KVM Host: ${host.server_name}` : 'Virtual Machine', icon: 'fa-solid fa-desktop', tool: 'kvm' });
        }
    });

    // Match Docker Containers
    state.allContainersCache.forEach(c => {
        const name = c.Names ? c.Names[0].replace('/', '') : c.Id.substring(0, 12);
        if (name.toLowerCase().includes(state.searchQuery) || c.Image.toLowerCase().includes(state.searchQuery)) {
            suggestions.push({ type: 'container', id: null, title: name, subtitle: `Docker Image: ${c.Image}`, icon: 'fa-brands fa-docker', tool: 'docker' });
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
        <div class="suggestion-item ${idx === state.selectedSuggestionIndex ? 'selected' : ''}" onclick="applySuggestion('${s.type}', '${s.id}', '${s.title.replace(/'/g, "\\'")}', '${s.tool}')">
            <i class="${s.icon}"></i>
            <div class="suggestion-content">
                <span class="suggestion-title">${s.title}</span>
                <span class="suggestion-subtitle">${s.subtitle}</span>
            </div>
            <span class="suggestion-category">${s.tool.toUpperCase()}</span>
        </div>
    `).join('');

    suggestionsContainer.classList.remove('hidden');
}

window.applySuggestion = (type, hostId, title, tool) => {
    state.searchQuery = title.toLowerCase();
    searchInput.value = title;
    suggestionsContainer.classList.add('hidden');

    if (tool && tool !== state.currentTool) {
        switchTool(tool);
    }

    if (type === 'host' && hostId && hostId !== 'null') {
        const id = parseInt(hostId);
        if (tool === 'kvm') selectHost(id);
        else if (tool === 'nas') selectNasHost(id);
        else if (tool === 'docker') selectDockerHost(id);
        else if (tool === 'podman') selectPodmanHost(id);
        else if (tool === 'kubernetes') selectKubernetesServer(id);
        else if (tool === 'proxmox') selectProxmoxHost(id);
        else if (tool === 'pfsense') selectFirewallHost(id);
    } else if (type === 'vm' && hostId && hostId !== 'null') {
        selectHost(parseInt(hostId));
    }

    // Trigger re-render to highlight/filter
    if (tool === 'kvm') {
        renderHosts();
        renderVMs();
    }
};


// Function to get the appropriate API endpoint for hosts based on tool
function getHostsAPIForTool(toolKey) {
    const toolHostsMap = {
        'kvm': API_HOSTS,
        'proxmox': API_PROXMOX_HOSTS,
        'pfsense': API_FIREWALL_HOSTS,
        'docker': API_CONTAINER_HOSTS,
        'kubernetes': '/api/config/kubernetes', // Show configured clusters on the left
        'podman': API_PODMAN_HOSTS,
        'nas': API_NAS_HOSTS
    };
    return toolHostsMap[toolKey] || null;
}

// Function to check if a tool has configured servers and fetch hosts
async function checkAndFetchHostsForTool(toolKey) {
    const apiEndpoint = getHostsAPIForTool(toolKey);
    if (apiEndpoint) {
        try {
            console.log(`[DEBUG] Fetching for ${toolKey}: ${apiEndpoint}`);
            const response = await fetch(apiEndpoint);
            if (response.ok) {
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.indexOf("application/json") === -1) {
                    const text = await response.text();
                    console.error(`[ERROR] Expected JSON from ${apiEndpoint} but got ${contentType}:`, text.substring(0, 100));
                    return;
                }
                const hosts = await response.json();
                if (hosts && hosts.length > 0) {
                    // Enrich with tool type
                    hosts.forEach(h => h.tool_type = toolKey);

                    // Sort hosts alphabetically
                    hosts.sort((a, b) => {
                        const nameA = a.server_name || a.name || '';
                        const nameB = b.server_name || b.name || '';
                        return nameA.localeCompare(nameB);
                    });

                    // Update cache and render
                    if (toolKey === 'pfsense') {
                        state.allFirewallHostsCache = hosts;
                        state.allHostsCache = hosts || [];
                        renderHostNodes('host-nodes-container-generic', {
                            icon: tools[toolKey].icon,
                            showOSInfo: true,
                            showStats: true,
                            onHostClick: 'selectFirewallHost'
                        });
                        if (state.selectedFirewallHostId) {
                            renderFirewallHostDetails(state.selectedFirewallHostId);
                        }
                    } else if (toolKey === 'docker') {
                        state.allDockerHostsCache = hosts;
                        state.allHostsCache = hosts || [];
                        renderHostNodes('host-nodes-container-generic', {
                            icon: tools[toolKey].icon,
                            showOSInfo: true,
                            showStats: true,
                            onHostClick: 'selectDockerHost'
                        });
                        if (state.selectedDockerHostId) {
                            renderDockerHostDetails(state.selectedDockerHostId);
                        } else {
                            renderDockerSummary();
                        }
                        fetchContainers();
                    } else if (toolKey === 'kubernetes') {
                        state.allKubernetesHostsCache = hosts;
                        state.allHostsCache = hosts || [];
                        renderHostNodes('host-nodes-container-generic', {
                            icon: tools[toolKey].icon,
                            showOSInfo: true,
                            showStats: true,
                            onHostClick: 'selectKubernetesServer'
                        });
                        if (state.selectedKubernetesServerId) {
                            if (state.selectedKubernetesNodeId) {
                                renderKubernetesNodeDetails(state.selectedKubernetesNodeId);
                            } else {
                                renderKubernetesServerDetails(state.selectedKubernetesServerId);
                            }
                        } else {
                            renderKubernetesSummary();
                        }
                        // Optionally fetch pods/nodes for cache
                        fetchPods();
                    } else if (toolKey === 'podman') {
                        state.allPodmanHostsCache = hosts;
                        state.allHostsCache = hosts || [];
                        renderHostNodes('host-nodes-container-generic', {
                            icon: tools[toolKey].icon,
                            showOSInfo: true,
                            showStats: true,
                            onHostClick: 'selectPodmanHost'
                        });
                        if (state.selectedPodmanHostId) {
                            renderPodmanHostDetails(state.selectedPodmanHostId);
                        } else {
                            renderPodmanSummary();
                        }
                        fetchPodmanContainers();
                    } else if (toolKey === 'proxmox') {
                        state.allProxmoxHostsCache = hosts;
                        state.allHostsCache = hosts || [];
                        renderHostNodes('host-nodes-container-generic', {
                            icon: tools[toolKey].icon,
                            showOSInfo: true,
                            showStats: true,
                            onHostClick: 'selectProxmoxHost'
                        });
                        if (state.selectedProxmoxHostId) {
                            renderProxmoxHostDetails(state.selectedProxmoxHostId);
                        } else {
                            renderProxmoxSummary();
                        }
                        fetchProxmoxVMs();
                    } else if (toolKey === 'nas') {
                        state.allNasHostsCache = hosts;
                        state.allHostsCache = hosts || [];
                        renderHostNodes('host-nodes-container-generic', {
                            icon: tools[toolKey].icon,
                            showOSInfo: true,
                            showStats: true,
                            onHostClick: 'selectNasHost'
                        });
                        if (state.selectedNasHostId) {
                            renderNasHostDetails(state.selectedNasHostId);
                        } else {
                            renderNasSummary();
                        }
                        fetchNasData();
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
        console.log(`[DEBUG] Fetching containers: ${API_CONTAINER_CONTAINERS}`);
        const response = await fetch(API_CONTAINER_CONTAINERS);
        if (response.ok) {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") === -1) {
                const text = await response.text();
                console.error(`[ERROR] Expected JSON from ${API_CONTAINER_CONTAINERS} but got ${contentType}:`, text.substring(0, 100));
                return;
            }
        }
        if (!response.ok) throw new Error('Failed to fetch containers');
        state.allContainersCache = await response.json();
        updateContainerHistory(state.allContainersCache);
        if (state.currentTool === 'docker') {
            if (state.selectedDockerHostId) {
                renderDockerHostDetails(state.selectedDockerHostId);
            } else {
                renderDockerSummary();
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function controlContainer(tool, serverID, containerID, action) {
    const apiBase = tool === 'docker' ? '/api/containers' : '/api/podman/containers';
    const url = `${apiBase}/${serverID}/${containerID}/${action}`;

    console.log(`[DEBUG] Controlling container: ${url}`);

    try {
        const response = await fetch(url, { method: 'POST' });
        if (response.ok) {
            console.log(`[DEBUG] Container ${action} successful`);
            // Refresh data immediately
            if (tool === 'docker') fetchContainers();
            else fetchPodmanContainers();
        } else {
            const err = await response.text();
            alert(`Error ${action} container: ${err}`);
        }
    } catch (e) {
        console.error(e);
        alert(`Failed to ${action} container: ${e.message}`);
    }
}

window.startContainer = (tool, serverID, containerID) => controlContainer(tool, serverID, containerID, 'start');
window.stopContainer = (tool, serverID, containerID) => controlContainer(tool, serverID, containerID, 'stop');

function selectDockerHost(id) {
    state.selectedDockerHostId = id;
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

    const host = state.allHostsCache.find(h => h.id === hostId);
    if (!host) return;

    // --- WRAPPER INITIALIZATION (Firewall Pattern) ---
    let statsWrapper = document.getElementById('docker-stats-wrapper');
    let mapWrapper = document.getElementById('docker-map-wrapper');

    if (!statsWrapper) {
        scannerSection.innerHTML = `
            <div id="docker-stats-wrapper" style="text-align: left; margin-bottom: 20px;"></div>
            <div id="docker-map-wrapper" class="glass-panel" style="padding: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 15px; padding-bottom: 10px;">
                    <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9;">
                        Mapa de Red Docker
                    </div>
                </div>
                <div id="docker-topology-map" style="height: 500px; width: 100%; border-radius: 8px;"></div>
            </div>
        `;
        statsWrapper = document.getElementById('docker-stats-wrapper');
        mapWrapper = document.getElementById('docker-map-wrapper');
    }

    const inner = statsWrapper;

    let filteredContainers = state.allContainersCache.filter(c => c.host_id === hostId);
    filteredContainers.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if (state.searchQuery) {
        filteredContainers = filteredContainers.filter(c =>
            c.name.toLowerCase().includes(state.searchQuery) ||
            c.image.toLowerCase().includes(state.searchQuery)
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

    const renderGPUCard = () => {
        let gpus = [];
        try {
            gpus = JSON.parse(host.gpu_info || '[]');
        } catch (e) {
            console.error("Error parsing GPU info:", e);
        }

        let gpuContent = '';
        if (!gpus || gpus.length === 0) {
            gpuContent = `
                <div style="text-align: center; padding: 15px; background: rgba(255,255,255,0.02); border-radius: 4px; border: 1px dashed rgba(255,255,255,0.1);">
                    <span style="font-size: 0.75rem; color: var(--text-secondary); opacity: 0.6;">No se detectaron GPUs (N/A)</span>
                </div>
            `;
        } else {
            gpuContent = `
                <div id="gpu-list" style="display: flex; flex-direction: column; gap: 12px;">
                    ${gpus.map(gpu => `
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <div style="display: flex; justify-content: space-between; align-items: start;">
                                <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-primary); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${gpu.name}">${gpu.name}</span>
                                <span style="font-size: 0.75rem; font-weight: 700; color: ${getStatusColor(gpu.utilization)};">${gpu.utilization}%</span>
                            </div>
                            <!-- Utilization Bar -->
                            <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                                <div style="height: 100%; width: ${gpu.utilization}%; background: ${getStatusColor(gpu.utilization)};"></div>
                            </div>
                            <!-- Stats Row -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 2px;">
                                <div style="display: flex; flex-direction: column; gap: 1px;">
                                    <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.8;">VRAM</span>
                                    <span style="font-size: 0.75rem; font-weight: 600;">${Math.round(gpu.memory_used)} / ${Math.round(gpu.memory_total)} MB</span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 1px; align-items: flex-end;">
                                    <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.8;">Temp</span>
                                    <span style="font-size: 0.75rem; font-weight: 600; color: ${gpu.temperature > 80 ? '#ef4444' : '#4ade80'};">${gpu.temperature}°C</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        return `
            <!-- Monitoreo de GPU -->
            <div id="gpu-monitoring-card" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px; margin-bottom: 5px;">
                <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-microchip" style="color: #4ade80;"></i>
                    <span>Monitoreo de GPU</span>
                </div>
                ${gpuContent}
            </div>
        `;
    };

    const renderVolumesList = () => {
        let volumes = [];
        try {
            volumes = JSON.parse(host.docker_volumes || '[]');
        } catch (e) {
            console.error("Error parsing volumes:", e);
        }

        if (volumes.length === 0) {
            return '<div style="font-size: 0.75rem; color: var(--text-secondary); opacity: 0.6;">No se detectaron volúmenes</div>';
        }

        // Sort largest to smallest
        volumes.sort((a, b) => (b.size || 0) - (a.size || 0));

        return volumes.map(v => `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.02);">
                <span style="color: var(--text-primary); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;" title="${v.name}">${v.name}</span>
                <span style="font-weight: 600; color: var(--accent-color);">${formatBytes(v.size, 1)}</span>
            </div>
        `).join('');
    };

    const renderContainerRows = () => {
        if (filteredContainers.length === 0) {
            return '<div style="text-align:center; padding: 40px; opacity:0.5;">No hay contenedores que mostrar</div>';
        }
        return filteredContainers.map(c => {
            const isRunning = (c.state || '').toLowerCase() === 'running';
            const memPercent = c.memory_limit > 0 ? (c.memory_usage / c.memory_limit * 100) : 0;

            return `
                <div style="display: grid; grid-template-columns: 2fr 1fr 0.8fr 1.2fr 1.6fr 1fr; gap: 15px; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); transition: all 0.2s ease;">
                    <!-- Name & Image -->
                    <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                        <button onclick="${isRunning ? 'stopContainer' : 'startContainer'}('docker', ${c.host_id}, '${c.name || c.id}')"
                                title="${isRunning ? 'Stop Container' : 'Start Container'}"
                                style="background: none; border: none; padding: 0; cursor: pointer; display: flex; align-items: center; transition: transform 0.2s;"
                                onmouseover="this.style.transform='scale(1.2)'"
                                onmouseout="this.style.transform='scale(1)'">
                            <i class="fa-brands fa-docker" style="color: ${isRunning ? '#4ade80' : '#ef4444'}; font-size: 1.2rem; opacity: 0.9;"></i>
                        </button>
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
                    const history = state.containerNetworkHistory[`${c.host_id}_${c.name}`];
                    return history ? renderSparkline(history.rx, '#4ade80', 100, 18) : '';
                })()}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; margin-top: 2px;">
                            <span style="color: var(--text-secondary); opacity: 0.8;"><i class="fa-solid fa-arrow-up" style="font-size: 0.65rem; color: #fb923c;"></i> TX</span>
                            <span style="font-weight: 600; font-family: monospace;">${formatBytes(c.net_tx, 0)}</span>
                        </div>
                        <div style="height: 18px; width: 100%; opacity: 0.8;">
                            ${(() => {
                    const history = state.containerNetworkHistory[`${c.host_id}_${c.name}`];
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
        // DYNAMIC VALUES ONLY (Partial Update)
        const serverStatusEl = document.getElementById('docker-server-status');
        if (serverStatusEl) {
            serverStatusEl.textContent = host.status || 'offline';
            serverStatusEl.style.color = host.status === 'online' ? '#4ade80' : '#ef4444';
            serverStatusEl.style.background = host.status === 'online' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';
            serverStatusEl.style.borderColor = host.status === 'online' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
        }

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

        const volumesListEl = document.getElementById('docker-volumes-list');
        if (volumesListEl) volumesListEl.innerHTML = renderVolumesList();

        const eventsEl = document.getElementById('docker-host-events');
        if (eventsEl) eventsEl.innerHTML = renderHostEvents(host.host_events, 'Docker');

        const gpuWrapperEl = document.getElementById('docker-gpu-wrapper');
        if (gpuWrapperEl) gpuWrapperEl.innerHTML = renderGPUCard();

        const mapContainer = document.getElementById('docker-topology-map');
        if (mapContainer && host.docker_networks) {
            if (!window.currentDockerMap) {
                window.currentDockerMap = new DockerTopologyMap('docker-topology-map');
            }
            window.currentDockerMap.render(host.docker_networks, false, state.allContainersCache, host, 'docker');
        }

        return; // Done with partial update
    }

    // --- FULL RENDER ---
    inner.setAttribute('data-host-id', hostId);
    inner.innerHTML = `
        <div style="margin-bottom: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
            </div>
        </div>

        <div class="glass-panel" style="padding: 24px;">
            <div style="display: grid; grid-template-columns: 350px 1fr; gap: 24px; align-items: start;">
            <!-- Left Column: Information -->
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    Sistema y Red
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <!-- Docker Service Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">Conexión</div>
                            <span id="docker-server-status" style="font-weight: 800; font-size: 0.7rem; color: ${host.status === 'online' ? '#4ade80' : '#ef4444'}; text-transform: uppercase; background: ${host.status === 'online' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; padding: 2px 6px; border-radius: 4px; border: 1px solid ${host.status === 'online' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'};">
                                ${host.status || 'offline'}
                            </span>
                        </div>
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

                    <!-- Docker Volumes Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 10px;">Volúmenes Docker</div>
                        <div id="docker-volumes-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 250px; overflow-y: auto;">
                            ${renderVolumesList()}
                        </div>
                    </div>

                    <div id="docker-gpu-wrapper">
                        ${renderGPUCard()}
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
                
                <div style="display: grid; grid-template-columns: 2fr 1fr 0.8fr 1.2fr 1.6fr 1fr; gap: 15px; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);">
                    <div>Nombre / Imagen</div>
                    <div>Puerto</div>
                    <div>CPU</div>
                    <div>Memoria</div>
                    <div>Red (RX/TX)</div>
                    <div style="text-align: right;">Disco</div>
                </div>

                <div id="docker-containers-list" style="display: flex; flex-direction: column; overflow-x: auto; min-width: 0;">
                    ${renderContainerRows()}
                </div>

                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-top: 25px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid fa-terminal" style="color: var(--accent-color); font-size: 1rem;"></i>
                    Eventos del host
                </div>

                <!-- Host Events Card -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px; margin-top: 10px;">
                    <div id="docker-host-events">
                        ${renderHostEvents(host.host_events, 'Docker')}
                    </div>
                </div>
            </div>
        </div>
        </div>
    `;

    // Re-draw map after full content render
    const mapContainer = document.getElementById('docker-topology-map');
    if (mapContainer && host.docker_networks) {
        if (!window.currentDockerMap) {
            window.currentDockerMap = new DockerTopologyMap('docker-topology-map');
        }
        window.currentDockerMap.render(host.docker_networks, false, state.allContainersCache, host, 'docker');
    }
}

// Function to update config button visibility based on tool and configured servers
async function updateConfigButtonVisibility(toolKey) {
    const configBtn = document.getElementById('config-btn');
    if (!configBtn) return;
    // Settings button is now always visible as part of the unified navigation
    configBtn.style.display = 'block';
}

// Fetch firewall hosts
async function fetchFirewallHosts() {
    try {
        console.log(`[DEBUG] Fetching firewall hosts: ${API_FIREWALL_HOSTS}`);
        const response = await fetch(API_FIREWALL_HOSTS);
        if (response.ok) {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") === -1) {
                const text = await response.text();
                console.error(`[ERROR] Expected JSON from ${API_FIREWALL_HOSTS} but got ${contentType}:`, text.substring(0, 100));
                return;
            }
        }
        if (!response.ok) throw new Error('Failed to fetch firewall hosts');
        const hosts = await response.json();

        // Sort hosts alphabetically by server_name
        if (hosts && Array.isArray(hosts)) {
            hosts.sort((a, b) => (a.server_name || '').localeCompare(b.server_name || ''));
        }

        state.allFirewallHostsCache = hosts || [];
        state.allHostsCache = hosts || [];
        updateFirewallHistory(state.allHostsCache);

        renderHostNodes('host-nodes-container-generic', {
            icon: tools[state.currentTool]?.icon || 'fa-solid fa-shield-halved',
            showOSInfo: true,
            showStats: true,
            onHostClick: 'selectFirewallHost' // Custom handler
        });

        if (state.selectedFirewallHostId) {
            renderFirewallHostDetails(state.selectedFirewallHostId);
        } else {
            renderFirewallSummary();
        }

        // Update config button visibility after fetching hosts
        if (state.currentTool) {
            updateConfigButtonVisibility(state.currentTool);
        }
    } catch (e) {
        console.error(e);
        const container = document.getElementById('host-nodes-container-generic');
        if (container) container.innerHTML = `<div class="loading-state" style="color:var(--danger)">Failed to load hosts: ${e.message}</div>`;
    }
}





function renderDockerSummary() {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    scannerSection.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
            <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
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
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
            <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
        </div>

        <div class="glass-panel" style="padding: 80px 25px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div style="font-size: 1.1rem; color: var(--text-secondary); opacity: 0.6; font-weight: 500;">
                <i class="fa-solid fa-arrow-up" style="margin-right: 8px;"></i> Selecciona un Host Node para ver su estado
            </div>
        </div>
    `;
}

async function fetchPods() {
    try {
        console.log(`[DEBUG] Fetching pods: ${API_KUBERNETES_PODS}`);
        const response = await fetch(API_KUBERNETES_PODS);
        if (response.ok) {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") === -1) {
                const text = await response.text();
                console.error(`[ERROR] Expected JSON from ${API_KUBERNETES_PODS} but got ${contentType}:`, text.substring(0, 100));
                return;
            }
        }
        if (!response.ok) throw new Error('Failed to fetch pods');
        state.allPodsCache = await response.json();
        if (state.currentTool === 'kubernetes') {
            if (state.selectedKubernetesNodeId) {
                renderKubernetesNodeDetails(state.selectedKubernetesNodeId);
            } else if (state.selectedKubernetesServerId) {
                renderKubernetesServerDetails(state.selectedKubernetesServerId);
            } else {
                renderKubernetesSummary();
            }
        }
    } catch (e) {
        console.error(e);
    }
}

function selectKubernetesServer(id) {
    state.selectedKubernetesServerId = id;
    state.selectedKubernetesNodeId = null; // Reset node selection when switching clusters
    renderHostNodes('host-nodes-container-generic', {
        icon: tools['kubernetes']?.icon || 'fa-solid fa-dharmachakra',
        showOSInfo: true,
        showStats: true,
        onHostClick: 'selectKubernetesServer'
    });
    renderKubernetesServerDetails(id);
}
window.selectKubernetesServer = selectKubernetesServer;

async function renderKubernetesServerDetails(serverId) {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    const server = state.allHostsCache.find(s => s.id === serverId);
    if (!server) return;

    // Ensure pods are loaded to avoid 0 counts
    if (state.allPodsCache.length === 0) {
        console.log('[K8s] cache empty, fetching pods before server details...');
        await fetchPods();
    }

    // Fetch nodes for this specific server
    try {
        const resp = await fetch(API_KUBERNETES_NODES);
        const allNodes = await resp.json();
        const clusterNodes = allNodes.filter(n => n.server_id === serverId).sort((a, b) => a.hostname.localeCompare(b.hostname));

        if (clusterNodes.length === 0) {
            scannerSection.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
                    <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-dharmachakra"></i> ${server.name}</h2>
                </div>
                <div class="glass-panel" style="padding: 50px; text-align: center;">
                    <i class="fa-solid fa-circle-info" style="font-size: 2rem; opacity: 0.5; margin-bottom: 15px;"></i>
                    <p>No se han recolectado nodos para este cluster todavía.</p>
                    <p style="font-size: 0.8rem; opacity: 0.7;">Asegúrate de que el colector esté funcionando y la conexión sea correcta.</p>
                </div>
            `;
            return;
        }

        const isAlreadyRenderingServer = scannerSection.getAttribute('data-k8s-server-id') === String(serverId);

        const totalNodes = clusterNodes.length;
        const avgCpu = clusterNodes.reduce((acc, n) => acc + (n.cpu_usage || 0), 0) / (totalNodes || 1);
        const totalCores = clusterNodes.reduce((acc, n) => acc + (n.cpu_cores || 0), 0);
        const totalMem = clusterNodes.reduce((acc, n) => acc + (n.total_memory || 0), 0);
        const freeMem = clusterNodes.reduce((acc, n) => acc + (n.free_memory || 0), 0);
        const usedMem = totalMem - freeMem;
        const memPercent = totalMem > 0 ? ((usedMem / totalMem) * 100).toFixed(0) : 0;

        // Calculate Running/Stopped Pods
        const clusterNodeIds = clusterNodes.map(n => n.id);
        const clusterPods = state.allPodsCache.filter(p => clusterNodeIds.includes(p.node_id));
        const totalPods = clusterPods.length;
        const runningPodsCount = clusterPods.filter(p => (p.state || '').toLowerCase() === 'running').length;
        const stoppedPodsCount = totalPods - runningPodsCount;

        const renderK8sPVList = (pvs) => {
            if (!pvs || pvs.length === 0) return '<div style="color: var(--text-secondary); font-size: 0.75rem; text-align: center; padding: 10px;">No hay volúmenes persistentes</div>';
            return pvs.map(pv => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-primary);">${pv.name}</span>
                            <span style="font-size: 0.65rem; color: var(--text-secondary);">${pv.pvc_namespace}/${pv.pvc_name}</span>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 0.8rem; color: var(--accent-color); font-weight: 600;">${formatBytes(pv.capacity, 1)}</div>
                            <div style="font-size: 0.6rem; color: ${pv.status === 'Bound' ? '#4ade80' : '#fbbf24'}; text-transform: uppercase;">${pv.status}</div>
                        </div>
                    </div>
                `).join('');
        };

        const renderPodDistribution = () => {
            return clusterNodes.map(node => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.03); border-radius: 10px; font-size: 0.85rem;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fa-solid fa-server" style="font-size: 0.8rem; opacity: 0.5; color: var(--accent-color);"></i>
                        <span style="font-weight: 500; opacity: 0.9;">${node.hostname}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 0.7rem; color: var(--text-secondary);">Pods:</span>
                        <span style="font-weight: 800; color: var(--accent-color); font-size: 1rem;">${node.pods_count || 0}</span>
                    </div>
                </div>
            `).join('');
        };

        const renderNodeCards = () => {
            return clusterNodes.map(node => {
                const cpuPercent = (node.cpu_usage || 0).toFixed(1);
                const nMemUsed = node.total_memory - node.free_memory;
                const nMemPercent = node.total_memory > 0 ? ((nMemUsed / node.total_memory) * 100).toFixed(0) : 0;
                const nodePods = state.allPodsCache.filter(p => p.node_id === node.id);
                // Sort by Memory usage descending
                nodePods.sort((a, b) => (b.memory_usage || 0) - (a.memory_usage || 0));
                const isExpanded = state.expandedK8sNodes[node.id] || false;

                const memTotalGB = (node.total_memory / (1024 * 1024 * 1024)).toFixed(1);
                const memUsedGB = (nMemUsed / (1024 * 1024 * 1024)).toFixed(1);
                const diskTotalGB = (node.disk_total / (1024 * 1024 * 1024)).toFixed(1);
                const diskUsedGB = (node.disk_used / (1024 * 1024 * 1024)).toFixed(1);
                const diskPercent = node.disk_total > 0 ? ((node.disk_used / node.disk_total) * 100).toFixed(0) : 0;

                // Network logic: Use backend-provided rates
                // Store history for sparklines
                if (!window.k8sNodeNetHistory) window.k8sNodeNetHistory = {};

                // Ensure array initialization
                if (!window.k8sNodeNetHistory[node.id]) {
                    window.k8sNodeNetHistory[node.id] = {
                        rx: new Array(20).fill(0),
                        tx: new Array(20).fill(0)
                    };
                }

                const hist = window.k8sNodeNetHistory[node.id];
                // Push backend rates to history
                hist.rx.push(node.net_rx_rate || 0);
                hist.tx.push(node.net_tx_rate || 0);
                if (hist.rx.length > 20) hist.rx.shift();
                if (hist.tx.length > 20) hist.tx.shift();

                return `
                <div class="glass-panel" style="padding: 12px 18px; transition: all 0.2s; border-bottom: 1px solid rgba(255,255,255,0.05); border-radius: 0; background: transparent;">
                    <div style="display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr 1fr 0.5fr; gap: 20px; align-items: center; cursor: pointer;" onclick="toggleNodePods(event, ${node.id})">
                        <!-- Column 1: Identity & Status -->
                        <div style="display: flex; align-items: center; gap: 12px; overflow: hidden;">
                             <div style="position: relative;">
                                <i class="fa-solid fa-server" style="font-size: 1.2rem; color: var(--text-secondary); opacity: 0.8;"></i>
                                <div style="position: absolute; bottom: -2px; right: -2px; width: 8px; height: 8px; border-radius: 50%; background-color: ${node.status && node.status.toLowerCase() === 'ready' ? '#4ade80' : '#ef4444'}; box-shadow: 0 0 0 2px #1a1b26;"></div>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden;">
                                <span style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${node.hostname}</span>
                                <div style="display: flex; align-items: center; gap: 6px; font-size: 0.7rem; color: var(--text-secondary); opacity: 0.8;">
                                    <span>v${node.version || '0.0.0'}</span>
                                    <span>•</span>
                                    <span style="color: ${node.status && node.status.toLowerCase() === 'ready' ? '#4ade80' : '#ef4444'};">${node.status && node.status.toLowerCase() === 'ready' ? 'Online' : 'Offline'}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 6px; font-size: 0.65rem; color: var(--text-secondary); opacity: 0.6;">
                                    <span>${node.cpu_cores || 'N/A'} CPUs</span>
                                    <span>•</span>
                                    <span>${memTotalGB}GB RAM</span>
                                </div>
                                <div style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.6; margin-top: 2px;">
                                    IP: ${node.ip_address || 'N/A'} • Arch: ${node.architecture || 'N/A'}
                                </div>
                            </div>
                        </div>

                        <!-- Column 2: CPU -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; align-items: baseline; gap: 6px;">
                                <span style="font-size: 0.9rem; font-weight: 600; color: ${getStatusColor(cpuPercent)};">${cpuPercent}%</span>
                            </div>
                            <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                                <div style="height: 100%; width: ${cpuPercent}%; background: ${getStatusColor(cpuPercent)}; border-radius: 2px;"></div>
                            </div>
                        </div>

                        <!-- Column 3: RAM -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; align-items: baseline; gap: 8px;">
                                <span style="font-size: 0.9rem; font-weight: 600; color: ${getStatusColor(nMemPercent)};">${nMemPercent}%</span>
                                <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.6;">${memUsedGB}/${memTotalGB}G</span>
                            </div>
                            <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                                <div style="height: 100%; width: ${nMemPercent}%; background: ${getStatusColor(nMemPercent)}; border-radius: 2px;"></div>
                            </div>
                        </div>

                        <!-- Column 4: Disk -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; align-items: baseline; gap: 8px;">
                                <span style="font-size: 0.9rem; font-weight: 600; color: ${getStatusColor(diskPercent)};">${diskPercent}%</span>
                                <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.6;">${diskUsedGB}/${diskTotalGB}G</span>
                            </div>
                            <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                                <div style="height: 100%; width: ${diskPercent}%; background: ${getStatusColor(diskPercent)}; border-radius: 2px;"></div>
                            </div>
                        </div>

                        <!-- Column 5: Network (Sparklines) -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <!-- RX Row -->
                            <div style="display: flex; flex-direction: column; gap: 1px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                                    <div style="display: flex; align-items: center; gap: 4px; color: var(--text-secondary); opacity: 0.8;">
                                        <i class="fa-solid fa-arrow-down" style="font-size: 0.6rem; color: #4ade80;"></i>
                                        <span style="font-size: 0.65rem;">RX</span>
                                    </div>
                                    <div style="font-weight: 600; color: var(--text-primary); font-size: 0.7rem;">${formatBytes(node.net_rx_rate || 0)}/s</div>
                                </div>
                                <div style="height: 12px; opacity: 0.7; width: 100%;">
                                    ${renderSparkline(hist.rx, '#4ade80', 80, 12)}
                                </div>
                            </div>
                            <!-- TX Row -->
                            <div style="display: flex; flex-direction: column; gap: 1px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                                    <div style="display: flex; align-items: center; gap: 4px; color: var(--text-secondary); opacity: 0.8;">
                                        <i class="fa-solid fa-arrow-up" style="font-size: 0.6rem; color: #fbbf24;"></i>
                                        <span style="font-size: 0.65rem;">TX</span>
                                    </div>
                                    <div style="font-weight: 600; color: var(--text-primary); font-size: 0.7rem;">${formatBytes(node.net_tx_rate || 0)}/s</div>
                                </div>
                                <div style="height: 12px; opacity: 0.7; width: 100%;">
                                    ${renderSparkline(hist.tx, '#fbbf24', 80, 12)}
                                </div>
                            </div>
                        </div>

                        <!-- Column 6: Pods / Action -->
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 1rem; font-weight: 700; color: var(--text-primary);">${nodePods.length}</span>
                                <i class="fa-solid fa-chevron-down" style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.7; transition: transform 0.3s; ${isExpanded ? 'transform: rotate(180deg);' : ''}" id="k8s-node-chevron-${node.id}"></i>
                            </div>
                            <div style="font-size: 0.6rem; color: var(--text-secondary); opacity: 0.5;">PODS</div>
                        </div>
                    </div>

                    <div id="k8s-node-pods-${node.id}" style="display: ${isExpanded ? 'block' : 'none'}; margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--accent-color); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-cubes"></i> Pods en este Nodo
                        </div>
                        <div style="max-height: 300px; overflow-y: auto;" class="custom-scrollbar">
                             ${nodePods.length === 0 ? '<div style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.6; padding: 10px;">No hay pods en este nodo</div>' : `
                                <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem;">
                                    <thead>
                                        <tr style="color: var(--text-secondary); border-bottom: 1px solid rgba(255,255,255,0.05); text-align: left;">
                                            <th style="padding: 8px; font-weight: 500;">Nombre / Imagen</th>
                                            <th style="padding: 8px; font-weight: 500;">Puerto</th>
                                            <th style="padding: 8px; font-weight: 500;">CPU</th>
                                            <th style="padding: 8px; font-weight: 500;">Memoria</th>
                                            <th style="padding: 8px; font-weight: 500;">Red (RX/TX)</th>
                                            <th style="padding: 8px; font-weight: 500; text-align: right;">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${nodePods.map(p => `
                                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.02); height: 40px;">
                                                <td style="padding: 8px; vertical-align: middle;">
                                                    <div style="font-weight: 500; color: var(--text-primary); margin-bottom: 2px;">${p.name}</div>
                                                    <div style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.7; font-family: monospace;">${p.image ? ((p.image.length > 30) ? '...' + p.image.slice(-30) : p.image) : '-'}</div>
                                                    <div style="font-size: 0.65rem; color: #60a5fa; opacity: 0.9; font-family: monospace;">${p.ip_address || '-'}</div>
                                                </td>
                                                <td style="padding: 8px; vertical-align: middle; color: var(--text-secondary); white-space: nowrap; max-width: 100px; overflow: hidden; text-overflow: ellipsis;">
                                                    <span title="${p.ports || ''}">${p.ports || '-'}</span>
                                                </td>
                                                <td style="padding: 8px; vertical-align: middle; color: var(--text-primary); font-family: monospace;">
                                                    ${p.cpu_usage ? (p.cpu_usage * 1000).toFixed(0) + 'm' : '0m'}
                                                </td>
                                                <td style="padding: 8px; vertical-align: middle; color: var(--accent-color); font-family: monospace;">
                                                    ${formatBytes(p.memory_usage)}
                                                </td>
                                                <td style="padding: 8px; vertical-align: middle; color: var(--text-secondary); font-size: 0.7rem;">
                                                     <div style="display: flex; gap: 4px; align-items: center;"><i class="fa-solid fa-arrow-down" style="font-size: 0.6rem;"></i> ${formatBytes(p.net_rx)}</div>
                                                     <div style="display: flex; gap: 4px; align-items: center;"><i class="fa-solid fa-arrow-up" style="font-size: 0.6rem;"></i> ${formatBytes(p.net_tx)}</div>
                                                </td>
                                                <td style="padding: 8px; vertical-align: middle; text-align: right;">
                                                    ${(() => {
                        let color = '#94a3b8'; // Default gray
                        let bg = 'rgba(148, 163, 184, 0.1)';
                        let border = 'rgba(148, 163, 184, 0.2)';
                        // Use 'state' (Phase) for status display to match "Running", "Pending" etc.
                        const status = p.state || 'Unknown';

                        if (status === 'Running') {
                            color = '#4ade80'; // Green
                            bg = 'rgba(74, 222, 128, 0.1)';
                            border = 'rgba(74, 222, 128, 0.2)';
                        } else if (status === 'Pending') {
                            color = '#fbbf24'; // Amber
                            bg = 'rgba(251, 191, 36, 0.1)';
                            border = 'rgba(251, 191, 36, 0.2)';
                        } else if (status === 'Failed' || status.includes('CrashLoop') || status.includes('Error')) {
                            color = '#ef4444'; // Red
                            bg = 'rgba(239, 68, 68, 0.1)';
                            border = 'rgba(239, 68, 68, 0.2)';
                        } else if (status === 'Succeeded' || status === 'Completed') {
                            color = '#60a5fa'; // Blue
                            bg = 'rgba(96, 165, 250, 0.1)';
                            border = 'rgba(96, 165, 250, 0.2)';
                        }

                        return `<span style="font-size: 0.65rem; padding: 2px 8px; border-radius: 10px; background: ${bg}; color: ${color}; border: 1px solid ${border}; text-transform: uppercase;">${status}</span>`;
                    })()}
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                             `}
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        };

        if (isAlreadyRenderingServer) {
            // --- PARTIAL UPDATE ---
            const nodesEl = document.getElementById('k8s-stat-nodes');
            if (nodesEl) nodesEl.textContent = totalNodes;

            const podsEl = document.getElementById('k8s-stat-pods');
            if (podsEl) podsEl.textContent = totalPods;

            const cpuEl = document.getElementById('k8s-stat-cpu');
            if (cpuEl) {
                cpuEl.textContent = `${avgCpu.toFixed(1)}%`;
                cpuEl.style.color = getStatusColor(avgCpu);
            }

            const ramEl = document.getElementById('k8s-stat-ram');
            if (ramEl) {
                ramEl.textContent = `${memPercent}%`;
                ramEl.style.color = getStatusColor(memPercent);
            }

            const coresTotalEl = document.getElementById('k8s-stat-cores-total');
            if (coresTotalEl) coresTotalEl.textContent = totalCores || 'N/A';

            const clusterStatusEl = document.getElementById('k8s-cluster-status');
            if (clusterStatusEl) {
                clusterStatusEl.textContent = server.status || 'offline';
                clusterStatusEl.style.color = server.status === 'online' ? '#4ade80' : '#ef4444';
                clusterStatusEl.style.background = server.status === 'online' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';
                clusterStatusEl.style.borderColor = server.status === 'online' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
            }

            const apiStatusEl = document.getElementById('k8s-api-status');
            if (apiStatusEl) {
                apiStatusEl.textContent = server.status === 'online' ? 'ACTIVE' : 'OFFLINE';
                apiStatusEl.style.color = server.status === 'online' ? '#4ade80' : '#ef4444';
                apiStatusEl.style.background = server.status === 'online' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';
                apiStatusEl.style.borderColor = server.status === 'online' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
            }

            const cpCompEl = document.getElementById('k8s-cp-components');
            if (cpCompEl) {
                let cpStatus = {};
                try {
                    cpStatus = JSON.parse(server.control_plane_status || '{}');
                } catch (e) { }

                const components = ['etcd', 'scheduler', 'controller-manager'];
                cpCompEl.innerHTML = components.map(comp => {
                    let status = cpStatus[comp] || cpStatus[`kube-${comp}`] || 'Unknown';
                    if (server.status !== 'online') status = 'Offline';
                    const isHealthy = status === 'Healthy';
                    const statusColor = isHealthy ? '#4ade80' : (status === 'Offline' ? '#94a3b8' : '#ef4444');
                    const statusBg = isHealthy ? 'rgba(34, 197, 94, 0.1)' : (status === 'Offline' ? 'rgba(148, 163, 184, 0.1)' : 'rgba(239, 68, 68, 0.1)');
                    const statusBorder = isHealthy ? 'rgba(34, 197, 94, 0.2)' : (status === 'Offline' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(239, 68, 68, 0.2)');

                    return `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
                            <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">${comp}</div>
                            <span style="font-weight: 700; font-size: 0.65rem; color: ${statusColor}; text-transform: uppercase; background: ${statusBg}; padding: 2px 5px; border-radius: 3px; border: 1px solid ${statusBorder};">
                                ${status}
                            </span>
                        </div>
                    `;
                }).join('');
            }

            const k8sVersionEl = document.getElementById('k8s-cluster-version');
            if (k8sVersionEl) k8sVersionEl.textContent = `v${clusterNodes[0]?.version || '0.0.0'}`;

            const k8sLoadEl = document.getElementById('k8s-cluster-cpu-load');
            if (k8sLoadEl) k8sLoadEl.textContent = `${avgCpu.toFixed(1)}%`;

            const k8sPodsTotalEl = document.getElementById('k8s-cluster-pods-total');
            if (k8sPodsTotalEl) k8sPodsTotalEl.textContent = totalPods;

            const storageUsedEl = document.getElementById('k8s-cluster-storage-used');
            const storageTotalEl = document.getElementById('k8s-cluster-storage-total');
            const storageBarEl = document.getElementById('k8s-cluster-storage-bar');

            const storageLabelEl = storageUsedEl?.closest('div')?.querySelector('span');
            if (storageLabelEl) storageLabelEl.textContent = 'Capacidad Reservada (Total)';

            if (storageUsedEl) storageUsedEl.textContent = formatBytes(server.storage_used, 1);
            if (storageTotalEl) storageTotalEl.textContent = formatBytes(server.storage_total, 1);
            if (storageBarEl) {
                const percent = server.storage_total > 0 ? (server.storage_used / server.storage_total * 100) : 0;
                storageBarEl.style.width = `${percent}%`;
                storageBarEl.style.background = '#38bdf8'; // Neutral blue for reservation
            }

            const pvListEl = document.getElementById('k8s-pv-list');
            if (pvListEl) {
                fetch(API_KUBERNETES_PVS)
                    .then(res => res.json())
                    .then(pvs => {
                        const clusterPVs = pvs.filter(pv => pv.server_id === state.selectedKubernetesServerId);
                        clusterPVs.sort((a, b) => b.capacity - a.capacity);
                        const newHTML = renderK8sPVList(clusterPVs.slice(0, 10));
                        if (pvListEl.innerHTML !== newHTML) {
                            // Preserve scroll position
                            const scrollPos = pvListEl.scrollTop;
                            pvListEl.innerHTML = newHTML;
                            pvListEl.scrollTop = scrollPos;
                        }

                        // Update storage summary counts
                        const pvCountEl = document.getElementById('k8s-pv-count');
                        const pvcCountEl = document.getElementById('k8s-pvc-count');
                        const scCountEl = document.getElementById('k8s-sc-count');

                        if (pvCountEl) pvCountEl.textContent = clusterPVs.length;

                        // Count unique PVCs (PVs that have a PVC bound)
                        const uniquePVCs = new Set();
                        clusterPVs.forEach(pv => {
                            if (pv.pvc_name && pv.pvc_namespace) {
                                uniquePVCs.add(`${pv.pvc_namespace}/${pv.pvc_name}`);
                            }
                        });
                        if (pvcCountEl) pvcCountEl.textContent = uniquePVCs.size;

                        // Count unique StorageClasses
                        const uniqueSCs = new Set();
                        clusterPVs.forEach(pv => {
                            if (pv.storage_class) {
                                uniqueSCs.add(pv.storage_class);
                            }
                        });
                        if (scCountEl) scCountEl.textContent = uniqueSCs.size;
                    });
            }

            // Fetch and render events
            const eventsListEl = document.getElementById('k8s-events-list');
            if (eventsListEl) {
                fetch(API_KUBERNETES_EVENTS)
                    .then(res => res.json())
                    .then(events => {
                        const clusterEvents = events.filter(e => e.server_id === state.selectedKubernetesServerId)
                            .slice(0, 10); // Show last 10 events

                        if (clusterEvents.length === 0) {
                            eventsListEl.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.75rem; text-align: center; padding: 20px;">No hay eventos recientes</div>';
                            return;
                        }

                        eventsListEl.innerHTML = clusterEvents.map(event => {
                            const typeColor = event.type === 'Warning' ? '#fbbf24' : event.type === 'Error' ? '#ef4444' : '#38bdf8';
                            const typeIcon = event.type === 'Warning' ? 'triangle-exclamation' : event.type === 'Error' ? 'circle-exclamation' : 'circle-info';
                            const lastSeen = new Date(event.last_seen);
                            const timeAgo = getRelativeTime(lastSeen);

                            return `
                                <div style="padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; gap: 12px; align-items: start;">
                                    <i class="fa-solid fa-${typeIcon}" style="color: ${typeColor}; font-size: 0.9rem; margin-top: 2px;"></i>
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                            <span style="font-weight: 600; font-size: 0.75rem; color: var(--text-primary);">${event.reason}</span>
                                            <div style="text-align: right; display: flex; flex-direction: column;">
                                                <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.9; font-weight: 600;">${lastSeen.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                                <span style="font-size: 0.6rem; color: var(--text-secondary); opacity: 0.6;">${timeAgo}</span>
                                            </div>
                                        </div>
                                        <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 4px; line-height: 1.4;">${event.message}</div>
                                        <div style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.6;">
                                            ${event.object_kind}/${event.object_name} ${event.namespace ? `· ${event.namespace}` : ''}
                                            ${event.count > 1 ? `· ${event.count}x` : ''}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    })
                    .catch(err => {
                        eventsListEl.innerHTML = '<div style="color: #ef4444; font-size: 0.75rem; text-align: center; padding: 20px;">Error al cargar eventos</div>';
                    });
            }


            const gridEl = document.getElementById('k8s-node-grid');
            if (gridEl) {
                // Capture scroll positions of open pod lists
                const scrollMap = {};
                document.querySelectorAll('[id^="k8s-node-pods-"]').forEach(el => {
                    const scrollContainer = el.querySelector('.custom-scrollbar');
                    if (scrollContainer) {
                        scrollMap[el.id] = scrollContainer.scrollTop;
                    }
                });

                gridEl.innerHTML = renderNodeCards();

                // Restore scroll positions
                Object.keys(scrollMap).forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        const scrollContainer = el.querySelector('.custom-scrollbar');
                        if (scrollContainer) {
                            scrollContainer.scrollTop = scrollMap[id];
                        }
                    }
                });
            }

            const mapContainer = document.getElementById('k8s-topology-map');
            if (mapContainer) {
                if (!window.currentK8sMap) {
                    window.currentK8sMap = new KubernetesTopologyMap('k8s-topology-map');
                }
                window.currentK8sMap.renderFromData(clusterNodes, state.allPodsCache, server);
            }

            return;
        }

        // --- FULL RENDER ---
        scannerSection.setAttribute('data-k8s-server-id', serverId);
        scannerSection.innerHTML = `
            <section class="vm-section">
                <div class="section-header" style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
                    </div>
                </div>

                <div class="glass-panel" style="padding: 24px;">
                    <!-- KVM Style Dashboard Layout (2 Columns) -->
                    <div style="display: grid; grid-template-columns: 350px 1fr; gap: 24px; align-items: start;">
                        
                        <!-- Left Column: Cluster Details -->
                        <div style="display: flex; flex-direction: column; gap: 15px;">
                            <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                Sistema y Red
                            </div>
                            
                            <div style="display: flex; flex-direction: column; gap: 12px;">
                                <!-- Connection Card -->
                                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">Conexión</div>
                                        <span id="k8s-cluster-status" style="font-weight: 800; font-size: 0.7rem; color: ${server.status === 'online' ? '#4ade80' : '#ef4444'}; text-transform: uppercase; background: ${server.status === 'online' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; padding: 2px 6px; border-radius: 4px; border: 1px solid ${server.status === 'online' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'};">
                                            ${server.status || 'offline'}
                                        </span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">API Server</div>
                                        <span id="k8s-api-status" style="font-weight: 800; font-size: 0.7rem; color: ${server.status === 'online' ? '#4ade80' : '#ef4444'}; text-transform: uppercase; background: ${server.status === 'online' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; padding: 2px 6px; border-radius: 4px; border: 1px solid ${server.status === 'online' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'};">
                                            ${server.status === 'online' ? 'ACTIVE' : 'OFFLINE'}
                                        </span>
                                    </div>
                                    <div id="k8s-cp-components">
                                    ${(() => {
                let cpStatus = {};
                try {
                    cpStatus = JSON.parse(server.control_plane_status || '{}');
                } catch (e) { }

                const components = ['etcd', 'scheduler', 'controller-manager'];
                return components.map(comp => {
                    let status = cpStatus[comp] || cpStatus[`kube-${comp}`] || 'Unknown';
                    if (server.status !== 'online') status = 'Offline';
                    const isHealthy = status === 'Healthy';
                    const statusColor = isHealthy ? '#4ade80' : (status === 'Offline' ? '#94a3b8' : '#ef4444');
                    const statusBg = isHealthy ? 'rgba(34, 197, 94, 0.1)' : (status === 'Offline' ? 'rgba(148, 163, 184, 0.1)' : 'rgba(239, 68, 68, 0.1)');
                    const statusBorder = isHealthy ? 'rgba(34, 197, 94, 0.2)' : (status === 'Offline' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(239, 68, 68, 0.2)');

                    return `
                                                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
                                                    <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">${comp}</div>
                                                    <span style="font-weight: 700; font-size: 0.65rem; color: ${statusColor}; text-transform: uppercase; background: ${statusBg}; padding: 2px 5px; border-radius: 3px; border: 1px solid ${statusBorder};">
                                                        ${status}
                                                    </span>
                                                </div>
                                            `;
                }).join('');
            })()}
                                    </div>
                                </div>

                                <!-- System Card -->
                                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">Sistema y Versión</div>
                                        <span id="k8s-cluster-version" style="color: #38bdf8; font-weight: 700; font-size: 0.75rem;">v${clusterNodes[0]?.version || '0.0.0'}</span>
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 6px;">
                                        <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                            <i class="fa-solid fa-server" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                            <span>Nodes: <span id="k8s-stat-nodes" style="color: var(--text-primary); font-weight: 500;">${totalNodes}</span></span>
                                            <span style="font-size: 0.65rem; color: #94a3b8; font-weight: 500;">
                                                (W: ${(JSON.parse(server.resource_counts || '{}').workers || 0)}, CP: ${(JSON.parse(server.resource_counts || '{}').control_plane || 0)})
                                            </span>
                                        </div>
                                        <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                            <i class="fa-solid fa-microchip" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                            <span>Total Cores: <span id="k8s-stat-cores-total" style="color: var(--text-primary); font-weight: 500;">${totalCores}</span></span>
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
                                                <span>Carga CPU Avg</span>
                                            </div>
                                            <span id="k8s-cluster-cpu-load" style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${avgCpu.toFixed(1)}%</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-cube" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                <span>Pods Totales</span>
                                            </div>
                                            <span id="k8s-cluster-pods-total" style="font-weight: 700; font-size: 0.85rem; color: var(--accent-color);">${totalPods}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-play" style="font-size: 0.8rem; opacity: 0.7; color: #4ade80;"></i> 
                                                <span>Pods Running</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: #4ade80;">${runningPodsCount}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-stop" style="font-size: 0.8rem; opacity: 0.7; color: #ef4444;"></i> 
                                                <span>Pods Stopped</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: #ef4444;">${stoppedPodsCount}</span>
                                        </div>
                                        ${(() => {
                let counts = {};
                try {
                    counts = JSON.parse(server.resource_counts || '{}');
                } catch (e) { }
                return `
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-folder" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                <span>Namespaces</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${counts.namespaces || 0}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-rocket" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                <span>Deployments</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${counts.deployments || 0}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-gears" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                <span>DaemonSets</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${counts.daemonsets || 0}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-rotate" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                <span>ReplicaSets</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${counts.replicasets || 0}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-sliders" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                <span>ReplicationControllers</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${counts.replicationcontrollers || 0}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-briefcase" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                <span>Jobs</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${counts.jobs || 0}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-clock" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                <span>CronJobs</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${counts.cronjobs || 0}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-arrow-right-to-bracket" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                <span>Ingresses</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${counts.ingresses || 0}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-file-code" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                <span>ConfigMaps</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${counts.configmaps || 0}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                <i class="fa-solid fa-key" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                <span>Secrets</span>
                                            </div>
                                            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${counts.secrets || 0}</span>
                                        </div>
                `;
            })()}
                                    </div>
                                </div>

                                <!-- Network & Exposure Card -->
                                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                                    <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 8px;">Red y Exposición</div>
                                    <div style="display: flex; flex-direction: column; gap: 10px;">
                                        ${(() => {
                let topo = {};
                try { topo = JSON.parse(server.network_topology || '{}'); } catch (e) { }
                const ingresses = (topo.nodes || []).filter(n => n.type === 'ingress');
                const services = (topo.nodes || []).filter(n => n.type === 'service');
                const links = topo.links || [];

                // Find exposed services (linked from internet)
                const exposedSvcs = services.filter(s => links.some(l => l.source === 'internet' && l.target === s.id));

                if (ingresses.length === 0 && exposedSvcs.length === 0) {
                    return '<div style="font-size: 0.75rem; color: var(--text-secondary); text-align: center;">No hay recursos expuestos detectados</div>';
                }

                let html = '';

                if (ingresses.length > 0) {
                    html += `
                                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                                    <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                                                        <i class="fa-solid fa-arrow-right-to-bracket" style="font-size: 0.7rem;"></i> Ingress Rules
                                                    </div>
                                                    <div style="display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto; padding-right: 4px;" class="custom-scrollbar">
                                                        ${ingresses.map(ing => `
                                                            <div style="padding: 6px; background: rgba(255,255,255,0.02); border-radius: 4px; border: 1px solid rgba(255,255,255,0.03);">
                                                                <div style="font-size: 0.75rem; color: #f97316; font-weight: 500; word-break: break-all;">${ing.ip || '*'}</div>
                                                                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                                                                    <div style="font-size: 0.65rem; color: var(--text-secondary);">${ing.namespace}/${ing.name}</div>
                                                                </div>
                                                            </div>
                                                        `).join('')}
                                                    </div>
                                                </div>`;
                }

                if (exposedSvcs.length > 0) {
                    html += `
                                                <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
                                                    <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                                                        <i class="fa-solid fa-network-wired" style="font-size: 0.7rem;"></i> Port Forwards (LB/NodePort)
                                                    </div>
                                                    <div style="display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto; padding-right: 4px;" class="custom-scrollbar">
                                                        ${exposedSvcs.map(svc => `
                                                            <div style="padding: 6px; background: rgba(255,255,255,0.02); border-radius: 4px; border: 1px solid rgba(255,255,255,0.03);">
                                                                <div style="font-size: 0.75rem; color: #a855f7; font-weight: 500;">${svc.name}</div>
                                                                <div style="font-size: 0.65rem; color: var(--text-secondary); margin-top: 1px;">
                                                                    ${svc.namespace} • <span style="color: var(--text-primary);">${svc.ip}</span>
                                                                </div>
                                                            </div>
                                                        `).join('')}
                                                    </div>
                                                </div>`;
                }
                return html;
            })()}
                                    </div>
                                </div>

                                <!-- Certificate Card -->
                                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                                    <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 8px;">Certificado del Cluster</div>
                                    ${(() => {
                if (!server.cert_expiration) return '<div style="font-size: 0.75rem; color: var(--text-secondary);"><i class="fa-solid fa-circle-question"></i> No disponible</div>';

                const expDate = new Date(server.cert_expiration);
                const now = new Date();
                const diffTime = expDate - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                let statusColor = '#4ade80'; // Green
                let statusText = 'Válido';

                if (diffDays < 15) {
                    statusColor = '#ef4444'; // Red
                    statusText = 'Crítico';
                } else if (diffDays < 30) {
                    statusColor = '#eab308'; // Yellow
                    statusText = 'Pronto a vencer';
                }

                return `
                                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                                    <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                        <i class="fa-solid fa-calendar-check" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                        <span>Expira el</span>
                                                    </div>
                                                    <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${expDate.toLocaleDateString()}</span>
                                                </div>
                                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                                    <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                                        <i class="fa-solid fa-hourglass-half" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                                        <span>Días restantes</span>
                                                    </div>
                                                    <span style="font-weight: 700; font-size: 0.85rem; color: ${statusColor};">${diffDays} días</span>
                                                </div>
                                                <div style="margin-top: 4px; padding: 4px 8px; background: ${statusColor}20; border: 1px solid ${statusColor}40; border-radius: 4px; text-align: center;">
                                                     <span style="font-weight: 700; font-size: 0.75rem; color: ${statusColor}; text-transform: uppercase;">${statusText}</span>
                                                </div>
                                            </div>
                                        `;
            })()}
                                </div>


                            </div>

                            <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-top: 5px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                Almacenamiento
                            </div>

                            <!-- Storage Resources Summary Card -->
                            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                                <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 10px;">Recursos de Almacenamiento</div>
                                <div id="k8s-storage-summary" style="display: flex; flex-direction: column; gap: 8px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                                        <span style="color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                                            <i class="fa-solid fa-database" style="font-size: 0.7rem; opacity: 0.7;"></i>
                                            Persistent Volumes
                                        </span>
                                        <span style="font-weight: 700; color: var(--text-primary);" id="k8s-pv-count">0</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                                        <span style="color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                                            <i class="fa-solid fa-hard-drive" style="font-size: 0.7rem; opacity: 0.7;"></i>
                                            Persistent Volume Claims
                                        </span>
                                        <span style="font-weight: 700; color: var(--text-primary);" id="k8s-pvc-count">0</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                                        <span style="color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                                            <i class="fa-solid fa-layer-group" style="font-size: 0.7rem; opacity: 0.7;"></i>
                                            Storage Classes
                                        </span>
                                        <span style="font-weight: 700; color: var(--text-primary);" id="k8s-sc-count">0</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Storage Card -->
                            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                                <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 10px;">Almacenamiento del Cluster</div>
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                                        <span style="color: var(--text-secondary);">Capacidad Reservada (Total)</span>
                                        <span style="font-weight: 600;"><span id="k8s-cluster-storage-used">${formatBytes(server.storage_used, 1)}</span> / <span id="k8s-cluster-storage-total">${formatBytes(server.storage_total, 1)}</span></span>
                                    </div>
                                    <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                                        <div id="k8s-cluster-storage-bar" style="height: 100%; width: ${server.storage_total > 0 ? (server.storage_used / server.storage_total * 100) : 0}%; background: #38bdf8;"></div>
                                    </div>
                                </div>
                            </div>

                            <!-- PVs Card -->
                            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                                <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 10px;">Volúmenes Persistentes</div>
                                <div id="k8s-pv-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 600px; overflow-y: auto;">
                                    <div style="color: var(--text-secondary); font-size: 0.75rem; text-align: center; padding: 10px;">Cargando volúmenes...</div>
                                </div>
                            </div>
                            <!-- Alerts Card -->
                            ${(() => {
                const alerts = [];

                // Check for NotReady nodes
                const notReadyNodes = clusterNodes.filter(n => n.status !== 'Ready');
                if (notReadyNodes.length > 0) {
                    const podsOnNotReadyNodes = state.allPodsCache.filter(p =>
                        notReadyNodes.some(n => n.id === p.node_id)
                    );
                    if (podsOnNotReadyNodes.length > 0) {
                        alerts.push({
                            type: 'node_not_ready',
                            severity: 'critical',
                            message: `${podsOnNotReadyNodes.length} pod(s) en nodo(s) NotReady`,
                            count: podsOnNotReadyNodes.length
                        });
                    }
                }

                // Check for OOM pods (based on state containing "OOM" or "CrashLoop")
                const oomPods = state.allPodsCache.filter(p =>
                    p.state && (p.state.includes('OOM') || p.state.includes('CrashLoop'))
                );
                if (oomPods.length > 0) {
                    alerts.push({
                        type: 'oom_killed',
                        severity: 'critical',
                        message: `${oomPods.length} pod(s) con errores OOM/CrashLoop`,
                        count: oomPods.length
                    });
                }

                // Check for CPU saturation (>90%)
                const cpuSaturatedNodes = clusterNodes.filter(n => n.cpu_usage > 90);
                if (cpuSaturatedNodes.length > 0) {
                    alerts.push({
                        type: 'cpu_saturation',
                        severity: 'warning',
                        message: `${cpuSaturatedNodes.length} nodo(s) con CPU >90%`,
                        count: cpuSaturatedNodes.length
                    });
                }

                // Check for Memory saturation (>90%)
                const memSaturatedNodes = clusterNodes.filter(n => {
                    const usedMem = n.total_memory - n.free_memory;
                    return n.total_memory > 0 && (usedMem / n.total_memory) > 0.9;
                });
                if (memSaturatedNodes.length > 0) {
                    alerts.push({
                        type: 'memory_saturation',
                        severity: 'warning',
                        message: `${memSaturatedNodes.length} nodo(s) con Memoria >90%`,
                        count: memSaturatedNodes.length
                    });
                }

                const totalCritical = alerts.filter(a => a.severity === 'critical').length;
                const totalWarnings = alerts.filter(a => a.severity === 'warning').length;

                return `
                                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px; margin-top: 15px;">
                                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 8px;">Alertas</div>
                                        ${alerts.length === 0 ? `
                                            <div style="display: flex; align-items: center; gap: 8px; color: #4ade80; font-size: 0.75rem;">
                                                <i class="fa-solid fa-circle-check" style="font-size: 0.9rem;"></i>
                                                <span>Sin alertas críticas</span>
                                            </div>
                                        ` : `
                                            <div style="display: flex; flex-direction: column; gap: 6px;">
                                                ${alerts.map(alert => `
                                                    <div style="display: flex; align-items: center; gap: 8px; font-size: 0.7rem; padding: 6px; background: ${alert.severity === 'critical' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(251, 191, 36, 0.1)'}; border-radius: 4px; border: 1px solid ${alert.severity === 'critical' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(251, 191, 36, 0.2)'};">
                                                        <i class="fa-solid fa-${alert.severity === 'critical' ? 'circle-exclamation' : 'triangle-exclamation'}" style="color: ${alert.severity === 'critical' ? '#ef4444' : '#fbbf24'};"></i>
                                                        <span style="flex: 1; color: var(--text-primary);">${alert.message}</span>
                                                    </div>
                                                `).join('')}
                                            </div>
                                        `}
                                    </div>
                                `;
            })()}

                        </div>

                        <!-- Right Column: Node Details -->
                        <div style="display: flex; flex-direction: column; gap: 20px; min-width: 0;">
                            <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                Nodos del Cluster
                            </div>
                            
                            <div class="glass-panel" style="padding: 0; overflow: hidden;">
                                <!-- Table Headers -->
                                <div style="display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr 1fr 0.5fr; gap: 20px; padding: 15px 18px; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.02); font-size: 0.7rem; color: var(--text-secondary); letter-spacing: 0.05em; text-transform: uppercase;">
                                    <div>Nombre / Sistema</div>
                                    <div>CPU</div>
                                    <div>Memoria</div>
                                    <div>Disco</div>
                                    <div>Red (RX/TX)</div>
                                    <div style="text-align: right;">Pods</div>
                                </div>
                                <div id="k8s-node-grid" style="display: flex; flex-direction: column;">
                                    ${renderNodeCards()}
                                </div>
                            </div>

                            <!-- Events Card -->
                            <div style="margin-top: 20px;">
                                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                    Eventos del Cluster
                                </div>
                                <div class="glass-panel" style="padding: 0; overflow: hidden;">
                                    <div id="k8s-events-list" style="display: flex; flex-direction: column; max-height: 400px; overflow-y: auto;">
                                        <div style="color: var(--text-secondary); font-size: 0.75rem; text-align: center; padding: 20px;">Cargando eventos...</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Network Map Card -->
                    <div style="margin-top: 30px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 15px; padding-bottom: 10px;">
                            <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9;">
                                Mapa de Red del Cluster
                            </div>
                        </div>
                        <div id="k8s-map-wrapper" class="glass-panel" style="padding: 24px; position: relative;">
                            <div id="k8s-topology-map" style="height: 500px; width: 100%; border-radius: 8px; overflow-y: auto; overflow-x: hidden;"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Render Map
        setTimeout(() => {
            const mapContainer = document.getElementById('k8s-topology-map');
            if (mapContainer) {
                if (typeof KubernetesTopologyMap !== 'undefined') {
                    if (!window.currentK8sMap) {
                        window.currentK8sMap = new KubernetesTopologyMap('k8s-topology-map');
                    }
                    window.currentK8sMap.renderFromData(clusterNodes, state.allPodsCache, server);
                }
            }
        }, 100);

        // Initial Fetch for PVs (Sorted immediately, Top 10)
        fetch(API_KUBERNETES_PVS)
            .then(res => res.json())
            .then(pvs => {
                const clusterPVs = pvs.filter(pv => pv.server_id === serverId);
                clusterPVs.sort((a, b) => b.capacity - a.capacity);
                const pvListEl = document.getElementById('k8s-pv-list');
                if (pvListEl) pvListEl.innerHTML = renderK8sPVList(clusterPVs.slice(0, 10));
            });

    } catch (e) {
        console.error('Error rendering Kubernetes server details:', e);
        scannerSection.innerHTML = '<div class="glass-panel" style="padding: 20px; color: var(--danger);">Error al cargar los nodos del cluster.</div>';
    }
}

function toggleNodePods(event, nodeId) {
    if (event) event.stopPropagation();
    const container = document.getElementById(`k8s-node-pods-${nodeId}`);
    const chevron = document.getElementById(`k8s-node-chevron-${nodeId}`);
    if (!container) return;

    if (container.style.display === 'none') {
        container.style.display = 'block';
        if (chevron) chevron.style.transform = 'rotate(180deg)';
        state.expandedK8sNodes[nodeId] = true;
    } else {
        container.style.display = 'none';
        if (chevron) chevron.style.transform = 'rotate(0deg)';
        delete state.expandedK8sNodes[nodeId];
    }
}
window.toggleNodePods = toggleNodePods;

function selectKubernetesNode(id) {
    state.selectedKubernetesNodeId = id;
    // We don't change the left list (still shows servers)
    renderKubernetesNodeDetails(id);
}
window.selectKubernetesNode = selectKubernetesNode;

async function renderKubernetesNodeDetails(nodeId) {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    // Fetch the node info (since state.allHostsCache now contains servers)
    try {
        const resp = await fetch(API_KUBERNETES_NODES);
        const allNodes = await resp.json();
        const node = allNodes.find(n => n.id === nodeId);
        if (!node) return;

        let filteredPods = state.allPodsCache.filter(p => p.node_id === nodeId);
        filteredPods.sort((a, b) => (a.namespace || "").localeCompare(b.namespace || "") || (a.name || "").localeCompare(b.name || ""));

        if (state.searchQuery) {
            filteredPods = filteredPods.filter(p =>
                p.name.toLowerCase().includes(state.searchQuery) ||
                p.namespace.toLowerCase().includes(state.searchQuery)
            );
        }
        const renderPodGrid = (pods) => {
            return pods.map(p => `
            < div class="glass-panel pod-card" style = "padding: 15px; border-left: 4px solid ${p.state === 'Running' ? '#4ade80' : '#ef4444'};" >
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="max-width: 200px;">
                            <div style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">${p.namespace}</div>
                            <div style="font-weight: 700; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p.name}">${p.name}</div>
                        </div>
                        <div style="font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,0.05);">
                            ${p.state}
                        </div>
                    </div>
                    <div style="margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.8rem; color: var(--text-secondary);">
                        <div><i class="fa-solid fa-redo" style="font-size: 0.7rem;"></i> ${p.restarts} restarts</div>
                        <div><i class="fa-solid fa-clock" style="font-size: 0.7rem;"></i> ${p.age}</div>
                    </div>
                </div >
            `).join('');
        };

        const isAlreadyRenderingNode = scannerSection.getAttribute('data-k8s-node-id') === String(nodeId);

        if (isAlreadyRenderingNode) {
            // --- PARTIAL UPDATE ---
            const podsStatEl = document.getElementById('k8s-node-stat-pods');
            if (podsStatEl) podsStatEl.textContent = node.pods_count || 0;

            const cpuStatEl = document.getElementById('k8s-node-stat-cpu');
            if (cpuStatEl) cpuStatEl.textContent = `${(node.cpu_usage || 0).toFixed(1)}% `;

            const ramStatEl = document.getElementById('k8s-node-stat-ram');
            if (ramStatEl) ramStatEl.textContent = `${formatBytes(node.total_memory - node.free_memory)} / ${formatBytes(node.total_memory)}`;

            const titleEl = document.getElementById('k8s-node-pod-count-title');
            if (titleEl) titleEl.textContent = `Pods en este Nodo (${filteredPods.length})`;

            const gridEl = document.getElementById('k8s-node-pod-grid');
            if (gridEl) gridEl.innerHTML = renderPodGrid(filteredPods);

            return;
        }

        // --- FULL RENDER ---
        scannerSection.setAttribute('data-k8s-node-id', nodeId);
        scannerSection.innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 24px;">
            <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-server"></i> Nodo: ${node.hostname}</h2>
        </div>

            <div style="display: grid; grid-template-columns: 350px 1fr; gap: 24px; align-items: start;">
                <!-- Left Column: Information -->
                <div style="display: flex; flex-direction: column; gap: 15px;">
                    <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        Sistema y Red
                    </div>

                    <div class="glass-panel" style="padding: 24px; text-align: left;">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px;">
                            <div>
                                <h3 style="margin:0; font-size: 1.3rem;">${node.hostname}</h3>
                                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">
                                    ${node.version} | ${node.os_name}
                                </div>
                            </div>
                            <div class="status-badge ${node.status === 'Ready' ? 'online' : 'offline'}">
                                ${node.status}
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
                            <div class="mini-stat-card" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px;">
                                <span class="label" style="font-size: 0.7rem; opacity: 0.6;">Pods</span>
                                <span id="k8s-node-stat-pods" class="value" style="font-weight: 700;">${node.pods_count || 0}</span>
                            </div>
                            <div class="mini-stat-card" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px;">
                                <span class="label" style="font-size: 0.7rem; opacity: 0.6;">CPU Usage</span>
                                <span id="k8s-node-stat-cpu" class="value" style="font-weight: 700;">${(node.cpu_usage || 0).toFixed(1)}%</span>
                            </div>
                            <div class="mini-stat-card" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px;">
                                <span class="label" style="font-size: 0.7rem; opacity: 0.6;">Memoria</span>
                                <span id="k8s-node-stat-ram" class="value" style="font-weight: 700;">${formatBytes(node.total_memory - node.free_memory)} / ${formatBytes(node.total_memory)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Right Column: Pods -->
                <div style="display: flex; flex-direction: column; gap: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 style="margin:0;"><i class="fa-solid fa-cubes"></i> <span id="k8s-node-pod-count-title">Pods en este Nodo (${filteredPods.length})</span></h4>
                    </div>

                    <div id="k8s-node-pod-grid" class="pod-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px;">
                        ${renderPodGrid(filteredPods)}
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        console.error('Error rendering Kubernetes node details:', e);
        scannerSection.innerHTML = '<div class="glass-panel" style="padding: 20px; color: var(--danger);">Error al cargar los detalles del nodo.</div>';
    }
}

function renderKubernetesSummary() {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    scannerSection.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
                <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
        </div>

            <div class="glass-panel" style="padding: 80px 25px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                <div style="font-size: 1.1rem; color: var(--text-secondary); opacity: 0.6; font-weight: 500;">
                    <i class="fa-solid fa-arrow-up" style="margin-right: 8px;"></i> Selecciona un Cluster para ver sus Nodos
                </div>
            </div>
        `;
}

async function fetchPodmanContainers() {
    try {
        console.log(`[DEBUG] Fetching podman containers: ${API_PODMAN_CONTAINERS}`);
        const response = await fetch(API_PODMAN_CONTAINERS);
        if (response.ok) {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") === -1) {
                const text = await response.text();
                console.error(`[ERROR] Expected JSON from ${API_PODMAN_CONTAINERS} but got ${contentType}:`, text.substring(0, 100));
                return;
            }
        }
        if (!response.ok) throw new Error('Failed to fetch podman containers');
        state.allPodmanContainersCache = await response.json();
        // Update history for sparklines
        updateContainerHistory(state.allPodmanContainersCache);

        if (state.currentTool === 'podman') {
            if (state.selectedPodmanHostId) {
                renderPodmanHostDetails(state.selectedPodmanHostId);
            } else {
                renderPodmanSummary();
            }
        }
    } catch (e) {
        console.error(e);
    }
}

function selectPodmanHost(id) {
    state.selectedPodmanHostId = id;
    renderHostNodes('host-nodes-container-generic', {
        icon: tools['podman']?.icon || 'fa-solid fa-layer-group',
        showOSInfo: true,
        showStats: true,
        onHostClick: 'selectPodmanHost'
    });
    renderPodmanHostDetails(id);
}
window.selectPodmanHost = selectPodmanHost;

function renderPodmanHostDetails(hostId) {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    const host = state.allHostsCache.find(h => h.id === hostId);
    if (!host) return;

    console.log(`[PodmanDebug] Rendering host details for: ${host.server_name || host.name} (ID: ${hostId})`);
    console.log(`[PodmanDebug] Containers in cache for this host:`, state.allPodmanContainersCache.filter(c => c.host_id === hostId).length);

    let statsWrapper = document.getElementById('podman-stats-wrapper');
    let mapWrapper = document.getElementById('podman-map-wrapper');

    if (!statsWrapper) {
        scannerSection.innerHTML = `
            <div id="podman-stats-wrapper" style="text-align: left; margin-bottom: 20px;"></div>
                <div id="podman-map-wrapper" class="glass-panel" style="padding: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 15px; padding-bottom: 10px;">
                        <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9;">
                            Mapa de Red Podman
                        </div>
                    </div>
                    <div id="podman-topology-map" style="height: 500px; width: 100%; border-radius: 8px;"></div>
                </div>
        `;
        statsWrapper = document.getElementById('podman-stats-wrapper');
        mapWrapper = document.getElementById('podman-map-wrapper');
    }

    const inner = statsWrapper;

    let filteredContainers = state.allPodmanContainersCache.filter(c => c.host_id === hostId);
    filteredContainers.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if (state.searchQuery) {
        filteredContainers = filteredContainers.filter(c =>
            c.name.toLowerCase().includes(state.searchQuery) ||
            c.image.toLowerCase().includes(state.searchQuery)
        );
    }

    const isAlreadyRenderingHost = inner.getAttribute('data-host-id') === String(hostId);

    const renderGPUCard = () => {
        let gpus = [];
        try {
            gpus = JSON.parse(host.gpu_info || '[]');
        } catch (e) {
            console.error("Error parsing GPU info:", e);
        }

        let gpuContent = '';
        if (!gpus || gpus.length === 0) {
            gpuContent = `
            <div style="text-align: center; padding: 15px; background: rgba(255,255,255,0.02); border-radius: 4px; border: 1px dashed rgba(255,255,255,0.1);">
                <span style="font-size: 0.75rem; color: var(--text-secondary); opacity: 0.6;">No se detectaron GPUs (N/A)</span>
                </div>
            `;
        } else {
            gpuContent = `
            <div id="podman-gpu-list" style="display: flex; flex-direction: column; gap: 12px;">
                ${gpus.map(gpu => `
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <div style="display: flex; justify-content: space-between; align-items: start;">
                                <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-primary); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${gpu.name}">${gpu.name}</span>
                                <span style="font-size: 0.75rem; font-weight: 700; color: ${getStatusColor(gpu.utilization)};">${gpu.utilization}%</span>
                            </div>
                            <!-- Utilization Bar -->
                            <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                                <div style="height: 100%; width: ${gpu.utilization}%; background: ${getStatusColor(gpu.utilization)};"></div>
                            </div>
                            <!-- Stats Row -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 2px;">
                                <div style="display: flex; flex-direction: column; gap: 1px;">
                                    <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.8;">VRAM</span>
                                    <span style="font-size: 0.75rem; font-weight: 600;">${Math.round(gpu.memory_used)} / ${Math.round(gpu.memory_total)} MB</span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 1px; align-items: flex-end;">
                                    <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.8;">Temp</span>
                                    <span style="font-size: 0.75rem; font-weight: 600; color: ${gpu.temperature > 80 ? '#ef4444' : '#4ade80'};">${gpu.temperature}°C</span>
                                </div>
                            </div>
                        </div>
                    `).join('')
                }
                </div>
            `;
        }

        return `
            <!--Monitoreo de GPU-->
                <div id="gpu-monitoring-card" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px; margin-bottom: 5px;">
                    <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-microchip" style="color: #4ade80;"></i>
                        <span>Monitoreo de GPU</span>
                    </div>
                    ${gpuContent}
                </div>
        `;
    };

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

        // Vulnerability Alerts
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
                </div> `;
        }
        return alerts.join('');
    };

    const renderVolumesList = () => {
        let volumes = [];
        try {
            const rawVols = host.podman_volumes;
            if (rawVols) {
                volumes = JSON.parse(rawVols);
            }
        } catch (e) {
            console.error("Error parsing volumes:", e);
        }

        if (!Array.isArray(volumes) || volumes.length === 0) {
            return '<div style="font-size: 0.75rem; color: var(--text-secondary); opacity: 0.6;">No se detectaron volúmenes</div>';
        }

        // Parse size string to bytes for sorting
        const parseSize = (str) => {
            if (!str) return 0;
            const units = { 'B': 1, 'KB': 1024, 'MB': 1024 ** 2, 'GB': 1024 ** 3, 'TB': 1024 ** 4, 'PB': 1024 ** 5 };
            const match = str.match(/([\d.]+)\s*([a-zA-Z]+)/);
            if (match) {
                const val = parseFloat(match[1]);
                const unit = match[2].toUpperCase();
                return val * (units[unit] || 1);
            }
            return 0;
        };

        // Check if volumes are objects (new implementation) or strings (old fallback)
        const isAdvanced = volumes.length > 0 && typeof volumes[0] === 'object';

        let displayVols = volumes;
        if (isAdvanced) {
            displayVols = volumes.sort((a, b) => parseSize(b.Size) - parseSize(a.Size));
        } else {
            // Convert strings to objects for uniform rendering if needed, or just map
            displayVols = volumes.map(v => ({ Name: v, Size: 'N/A' }));
        }

        return displayVols.map(v => `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.02);">
                <span style="color: var(--text-primary); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;" title="${v.Name || v.VolumeName}">${v.Name || v.VolumeName}</span>
                ${v.Size && v.Size !== 'N/A' ?
                `<span style="color: #38bdf8; font-weight: 700; font-size: 0.85rem; text-shadow: 0 0 5px rgba(56, 189, 248, 0.3);">${v.Size}</span>`
                : ''
            }
            </div>
            `).join('');
    };

    const renderContainerRows = () => {
        if (filteredContainers.length === 0) {
            return '<div style="text-align:center; padding: 40px; opacity:0.5;">No hay contenedores que mostrar</div>';
        }
        return filteredContainers.map(c => {
            const isRunning = (c.state || '').toLowerCase() === 'running';
            const memPercent = c.memory_limit > 0 ? (c.memory_usage / c.memory_limit * 100) : 0;

            // Debug each row
            if (isRunning) {
                console.log(`[PodmanDebug] Container row: ${c.name} | NetRX: ${c.net_rx} | BlockIn: ${c.block_in}`);
            }

            return `
            <div style="display: grid; grid-template-columns: 2fr 1fr 0.8fr 1.2fr 1.6fr 1fr; gap: 15px; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); transition: all 0.2s ease;">
                     <!--Name & Image-->
                     <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                        <button onclick="${isRunning ? 'stopContainer' : 'startContainer'}('podman', ${c.host_id}, '${c.name || c.id}')"
                                title="${isRunning ? 'Stop Container' : 'Start Container'}"
                                style="background: none; border: none; padding: 0; cursor: pointer; display: flex; align-items: center; transition: transform 0.2s;"
                                onmouseover="this.style.transform='scale(1.2)'"
                                onmouseout="this.style.transform='scale(1)'">
                            <i class="fa-solid fa-otter" style="color: ${isRunning ? '#4ade80' : '#ef4444'}; font-size: 1.2rem; opacity: 0.9;"></i>
                        </button>
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
 
                     <!--Ports -->
                     <div style="font-size: 0.75rem; color: var(--text-secondary); opacity: 0.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${c.ports || 'N/A'}">
                         <span style="font-family: monospace;">${c.ports || '-'}</span>
                     </div>
 
                     <!--CPU -->
                     <div style="display: flex; flex-direction: column; gap: 3px;">
                         <div style="font-size: 0.85rem; font-weight: 600; color: ${getStatusColor(c.cpu_usage || 0)};">${(c.cpu_usage || 0).toFixed(1)}%</div>
                         <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                             <div style="height: 100%; width: ${Math.min(c.cpu_usage || 0, 100)}%; background: ${getStatusColor(c.cpu_usage || 0)};"></div>
                         </div>
                     </div>
 
                     <!--RAM Usage / Limit-->
                     <div style="display: flex; flex-direction: column; gap: 3px;">
                         <div style="font-size: 0.85rem; font-weight: 600; color: ${getStatusColor(memPercent)};">
                             ${formatBytes(c.memory_usage, 1)}
                         </div>
                         <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                             <div style="height: 100%; width: ${Math.min(memPercent, 100)}%; background: ${getStatusColor(memPercent)};"></div>
                         </div>
                     </div>
 
                     <div style="display: flex; flex-direction: column; gap: 2px;">
                         <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                             <span style="color: var(--text-secondary); opacity: 0.8;"><i class="fa-solid fa-arrow-down" style="font-size: 0.65rem; color: #4ade80;"></i> RX</span>
                             <span style="font-weight: 600; font-family: monospace;">${(() => {
                    const val = formatBytes(c.net_rx, 0);
                    if (c.name === 'mi-servidor') console.log(`[PodmanDebug] mi-servidor NetRX formatted: ${val}`);
                    return val;
                })()}</span>
                         </div>
                          <div style="height: 18px; width: 100%; opacity: 0.8;">
                             ${(() => {
                    const history = state.containerNetworkHistory[`${c.host_id}_${c.name}`];
                    return history ? renderSparkline(history.rx, '#4ade80', 100, 18) : '';
                })()}
                         </div>
                         <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; margin-top: 2px;">
                             <span style="color: var(--text-secondary); opacity: 0.8;"><i class="fa-solid fa-arrow-up" style="font-size: 0.65rem; color: #fb923c;"></i> TX</span>
                             <span style="font-weight: 600; font-family: monospace;">${formatBytes(c.net_tx, 0)}</span>
                         </div>
                         <div style="height: 18px; width: 100%; opacity: 0.8;">
                             ${(() => {
                    const history = state.containerNetworkHistory[`${c.host_id}_${c.name}`];
                    return history ? renderSparkline(history.tx, '#fb923c', 100, 18) : '';
                })()}
                         </div>
                     </div>
 
                     <!--Disk -->
            <div style="display: flex; flex-direction: column; gap: 1px; font-size: 0.8rem;">
                <div style="display: flex; align-items: center; gap: 5px; color: var(--text-secondary); opacity: 0.8;" title="Disk Read (Block In)">
                    <i class="fa-solid fa-hard-drive" style="font-size: 0.7rem;"></i> ${(() => {
                    const val = formatBytes(c.block_in, 0);
                    if (c.name === 'mi-servidor') console.log(`[PodmanDebug] mi-servidor BlockIn formatted: ${val}`);
                    return val;
                })()}
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
        // Partial Update
        const serverStatusEl = document.getElementById('podman-server-status');
        if (serverStatusEl) {
            serverStatusEl.textContent = host.status || 'offline';
            serverStatusEl.style.color = host.status === 'online' ? '#4ade80' : '#ef4444';
            serverStatusEl.style.background = host.status === 'online' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';
            serverStatusEl.style.borderColor = host.status === 'online' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
        }

        const statusEl = document.getElementById('podman-service-status');
        if (statusEl) {
            statusEl.textContent = host.podman_service_status || 'offline';
            statusEl.style.color = host.podman_service_status === 'active' ? '#4ade80' : '#ef4444';
            statusEl.style.background = host.podman_service_status === 'active' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';
            statusEl.style.borderColor = host.podman_service_status === 'active' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
        }

        const uptimeEl = document.getElementById('podman-host-uptime');
        if (uptimeEl) uptimeEl.textContent = host.uptime || 'N/A';

        const cpuEl = document.getElementById('podman-host-cpu-load');
        if (cpuEl) cpuEl.textContent = `${(host.cpu_usage || 0).toFixed(1)}% `;

        const latencyEl = document.getElementById('podman-host-latency');
        if (latencyEl) {
            latencyEl.textContent = `${host.podman_api_latency || 0} ms`;
            latencyEl.style.color = host.podman_api_latency < 500 ? '#4ade80' : '#eab308';
        }

        const alertsEl = document.getElementById('podman-alerts-list');
        if (alertsEl) alertsEl.innerHTML = renderAlertsList();

        const containersListEl = document.getElementById('podman-containers-list');
        if (containersListEl) containersListEl.innerHTML = renderContainerRows();

        // Storage
        const storageUsageEl = document.getElementById('podman-host-storage-usage');
        const storageBarEl = document.getElementById('podman-host-storage-bar');
        const inodesEl = document.getElementById('podman-host-inodes');

        if (storageUsageEl) storageUsageEl.textContent = `${formatBytes(host.podman_storage_used, 1)} / ${formatBytes(host.podman_storage_total, 1)}`;
        if (storageBarEl) {
            const pct = host.podman_storage_total > 0 ? (host.podman_storage_used / host.podman_storage_total * 100) : 0;
            storageBarEl.style.width = `${pct}%`;
            storageBarEl.style.background = getStatusColor(pct);
        }
        if (inodesEl) inodesEl.textContent = host.podman_inodes_usage || '0%';

        const volumesListEl = document.getElementById('podman-volumes-list');
        if (volumesListEl) volumesListEl.innerHTML = renderVolumesList();

        const eventsEl = document.getElementById('podman-host-events');
        if (eventsEl) eventsEl.innerHTML = renderHostEvents(host.host_events, 'Podman');

        const gpuWrapperEl = document.getElementById('podman-gpu-wrapper');
        if (gpuWrapperEl) gpuWrapperEl.innerHTML = renderGPUCard();

        // Map update
        if (host.podman_networks) {
            if (!window.currentPodmanMap) {
                if (typeof DockerTopologyMap !== 'undefined') {
                    window.currentPodmanMap = new DockerTopologyMap('podman-topology-map');
                }
            }
            if (window.currentPodmanMap) {
                window.currentPodmanMap.render(host.podman_networks, true, state.allPodmanContainersCache, host, 'podman');
            }
        }

        return;
    }

    // --- FULL RENDER ---
    inner.setAttribute('data-host-id', hostId);

    // Safety helpers
    const _s = (v) => v || 'N/A';
    const _n = (v) => (typeof v === 'number' && !isNaN(v)) ? v : 0;

    inner.innerHTML = `
        <div style="margin-bottom: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
            </div>
        </div>

        <div class="glass-panel" style="padding: 24px;">
            <div style="display: grid; grid-template-columns: 350px 1fr; gap: 24px; align-items: start;">
            <!-- Left Column: Information -->
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    Sistema y Red
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <!-- Podman Service Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">Conexión</div>
                            <span id="podman-server-status" style="font-weight: 800; font-size: 0.7rem; color: ${host.status === 'online' ? '#4ade80' : '#ef4444'}; text-transform: uppercase; background: ${host.status === 'online' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; padding: 2px 6px; border-radius: 4px; border: 1px solid ${host.status === 'online' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'};">
                                ${host.status || 'offline'}
                            </span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">Servicio Podman</div>
                            <span id="podman-service-status" style="font-weight: 800; font-size: 0.7rem; color: ${host.podman_service_status === 'active' ? '#4ade80' : '#ef4444'}; text-transform: uppercase; background: ${host.podman_service_status === 'active' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; padding: 2px 6px; border-radius: 4px; border: 1px solid ${host.podman_service_status === 'active' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'};">
                                ${host.podman_service_status || 'offline'}
                            </span>
                        </div>
                    </div>

                    <!-- System Info Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color);">Sistema y Versión</div>
                            <span style="color: #38bdf8; font-weight: 700; font-size: 0.75rem;">v${_s(host.podman_version)}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                <i class="fa-solid fa-server" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                <span>OS: <span style="color: var(--text-primary); font-weight: 500;">${_s(host.os_name)}</span></span>
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                <i class="fa-solid fa-clock-rotate-left" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                <span>Uptime: <span id="podman-host-uptime" style="color: var(--text-primary); font-weight: 500;">${_s(host.uptime)}</span></span>
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
                                <span id="podman-host-cpu-load" style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${_n(host.cpu_usage).toFixed(1)}%</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                                    <i class="fa-solid fa-stopwatch" style="font-size: 0.8rem; opacity: 0.7;"></i> 
                                    <span>Latencia API</span>
                                </div>
                                <span id="podman-host-latency" style="font-weight: 700; font-size: 0.85rem; color: ${_n(host.podman_api_latency) < 500 ? '#4ade80' : '#eab308'};">${_n(host.podman_api_latency)} ms</span>
                            </div>
                        </div>
                    </div>

                    <!-- Storage Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 10px;">Almacenamiento Podman</div>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                                    <span style="color: var(--text-secondary);">/var/lib/containers</span>
                                    <span id="podman-host-storage-usage" style="font-weight: 600;">${formatBytes(_n(host.podman_storage_used), 1)} / ${formatBytes(_n(host.podman_storage_total), 1)}</span>
                                </div>
                                <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                                    <div id="podman-host-storage-bar" style="height: 100%; width: ${_n(host.podman_storage_total) > 0 ? (_n(host.podman_storage_used) / _n(host.podman_storage_total) * 100) : 0}%; background: ${getStatusColor(_n(host.podman_storage_total) > 0 ? (_n(host.podman_storage_used) / _n(host.podman_storage_total) * 100) : 0)};"></div>
                                </div>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <span style="font-size: 0.65rem; color: var(--text-secondary); opacity: 0.8;">Inodos ocupados</span>
                                <span id="podman-host-inodes" style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">${host.podman_inodes_usage || '0%'}</span>
                            </div>
                        </div>
                    </div>

                     <!-- Volumes Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--primary-color); margin-bottom: 10px;">Volúmenes Podman</div>
                        <div id="podman-volumes-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 250px; overflow-y: auto;">
                            ${renderVolumesList()}
                        </div>
                    </div>

                    <!-- GPU Card -->
                    <div id="podman-gpu-wrapper">
                        ${renderGPUCard()}
                    </div>

                    <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-top: 5px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        Alertas
                    </div>

                    <!-- Alerts Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
                        <div id="podman-alerts-list" style="display: flex; flex-direction: column; gap: 8px;">
                            ${renderAlertsList()}
                        </div>
                    </div>

                </div>
            </div>
            <!-- Right Column: Containers -->
            <div style="flex: 1; min-width: 0;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <i class="fa-solid fa-otter" style="margin-right: 8px;"></i>Contenedores
                </div>
                
                <div style="display: grid; grid-template-columns: 2fr 1fr 0.8fr 1.2fr 1.6fr 1fr; gap: 15px; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);">
                    <div>Nombre / Imagen</div>
                    <div>Puerto</div>
                    <div>CPU</div>
                    <div>Memoria</div>
                    <div>Red (RX/TX)</div>
                    <div style="text-align: right;">Disco</div>
                </div>

                <div id="podman-containers-list" style="display: flex; flex-direction: column; overflow-x: auto; min-width: 0;">
                    ${renderContainerRows()}
                </div>

                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-top: 25px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid fa-terminal" style="color: var(--accent-color); font-size: 1rem;"></i>
                    Eventos del host
                </div>

                <!-- Host Events Card -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px; margin-top: 10px;">
                    <div id="podman-host-events">
                        ${renderHostEvents(host.host_events, 'Podman')}
                    </div>
                </div>
            </div>
        </div>
        </div>
    `;

    // Draw Map
    if (host.podman_networks) {
        if (typeof DockerTopologyMap !== 'undefined') {
            if (!window.currentPodmanMap) {
                window.currentPodmanMap = new DockerTopologyMap('podman-topology-map');
            }
            window.currentPodmanMap.render(host.podman_networks, true, state.allPodmanContainersCache, host, 'podman');
        }
    }
}

function renderPodmanSummary() {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    scannerSection.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
            <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
        </div>

        <div class="glass-panel" style="padding: 80px 25px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div style="font-size: 1.1rem; color: var(--text-secondary); opacity: 0.6; font-weight: 500;">
                <i class="fa-solid fa-arrow-up" style="margin-right: 8px;"></i> Selecciona un Host Podman para ver sus contenedores
            </div>
        </div>
    `;
}

async function fetchProxmoxVMs() {
    try {
        console.log(`[DEBUG] Fetching proxmox vms: ${API_PROXMOX_VMS}`);
        const response = await fetch(API_PROXMOX_VMS);
        if (response.ok) {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") === -1) {
                const text = await response.text();
                console.error(`[ERROR] Expected JSON from ${API_PROXMOX_VMS} but got ${contentType}:`, text.substring(0, 100));
                return;
            }
        }
        if (!response.ok) throw new Error('Failed to fetch proxmox vms');
        state.allProxmoxVMsCache = await response.json();
        if (state.currentTool === 'proxmox') {
            if (state.selectedProxmoxHostId) {
                renderProxmoxHostDetails(state.selectedProxmoxHostId);
            } else {
                renderProxmoxSummary();
            }
        }
    } catch (e) {
        console.error(e);
    }
}

function selectProxmoxHost(id) {
    state.selectedProxmoxHostId = id;
    renderHostNodes('host-nodes-container-generic', {
        icon: tools['proxmox']?.icon || 'fa-solid fa-server',
        showOSInfo: true,
        showStats: true,
        onHostClick: 'selectProxmoxHost'
    });
    renderProxmoxHostDetails(id);
}
window.selectProxmoxHost = selectProxmoxHost;

function renderProxmoxHostDetails(hostId) {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    const host = state.allHostsCache.find(h => h.id === hostId);
    if (!host) return;

    let filteredVMs = state.allProxmoxVMsCache.filter(v => v.host_id === hostId);
    filteredVMs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if (state.searchQuery) {
        filteredVMs = filteredVMs.filter(v =>
            v.name.toLowerCase().includes(state.searchQuery) ||
            v.vmid.toString().includes(state.searchQuery)
        );
    }

    scannerSection.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
            <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
        </div>

        <div style="display: grid; grid-template-columns: 350px 1fr; gap: 24px; align-items: start;">
            <!-- Left Column: Information -->
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    Sistema y Red
                </div>

                <div class="glass-panel" style="padding: 24px; text-align: left;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px;">
                        <div>
                            <h3 style="margin:0; font-size: 1.3rem;">${host.hostname}</h3>
                            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">
                                PVE ${host.pve_version} | ${host.os_name}
                            </div>
                        </div>
                        <div class="status-badge ${host.status === 'online' ? 'online' : 'offline'}">
                            ${host.status}
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
                        <div class="mini-stat-card" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px;">
                            <span class="label" style="font-size: 0.7rem; opacity: 0.6;">CPU Usage</span>
                            <span class="value" style="font-weight: 700;">${(host.cpu_usage || 0).toFixed(1)}%</span>
                        </div>
                        <div class="mini-stat-card" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px;">
                            <span class="label" style="font-size: 0.7rem; opacity: 0.6;">Memoria</span>
                            <span class="value" style="font-weight: 700;">${formatBytes(host.total_memory - host.free_memory)} / ${formatBytes(host.total_memory)}</span>
                        </div>
                        <div class="mini-stat-card" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px;">
                            <span class="label" style="font-size: 0.7rem; opacity: 0.6;">VMs / LXC</span>
                            <span class="value" style="font-weight: 700;">${host.vms_count} / ${host.containers_count}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Column: VMs -->
            <div style="display: flex; flex-direction: column; gap: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h4 style="margin:0;"><i class="fa-solid fa-server"></i> Recursos en este Nodo (${filteredVMs.length})</h4>
                </div>

                <div class="vm-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 15px;">
                    ${filteredVMs.map(v => `
                        <div class="glass-panel vm-card" style="padding: 15px; border-left: 4px solid ${v.state === 'running' ? '#4ade80' : '#6b7280'};">
                            <div style="display: flex; justify-content: space-between; align-items: start;">
                                <div style="max-width: 220px;">
                                    <div style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">ID: ${v.vmid} | ${v.type.toUpperCase()}</div>
                                    <div style="font-weight: 700; font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${v.name}">${v.name}</div>
                                </div>
                                <div style="font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,0.05);">
                                    ${v.state}
                                </div>
                            </div>
                            
                            <div style="margin-top: 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                                <div class="mini-stat">
                                    <i class="fa-solid fa-microchip"></i> ${(v.cpu_usage || 0).toFixed(1)}%
                                </div>
                                <div class="mini-stat">
                                    <i class="fa-solid fa-memory"></i> ${formatBytes(v.memory_usage)}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderProxmoxSummary() {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    scannerSection.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
            <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
        </div>

        <div class="glass-panel" style="padding: 80px 25px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div style="font-size: 1.1rem; color: var(--text-secondary); opacity: 0.6; font-weight: 500;">
                <i class="fa-solid fa-arrow-up" style="margin-right: 8px;"></i> Selecciona un Nodo de Proxmox para ver sus recursos
            </div>
        </div>
    `;
}

async function fetchNasData() {
    try {
        const [volumesResp, disksResp] = await Promise.all([
            fetch(API_NAS_VOLUMES),
            fetch(API_NAS_DISKS)
        ]);

        if (volumesResp.ok) {
            const ct = volumesResp.headers.get("content-type");
            if (ct && ct.indexOf("application/json") === -1) {
                console.error(`[ERROR] Expected JSON from ${API_NAS_VOLUMES} but got ${ct}`);
            } else {
                state.allNasVolumesCache = await volumesResp.json();
            }
        }

        if (disksResp.ok) {
            const ct = disksResp.headers.get("content-type");
            if (ct && ct.indexOf("application/json") === -1) {
                console.error(`[ERROR] Expected JSON from ${API_NAS_DISKS} but got ${ct}`);
            } else {
                state.allNasDisksCache = await disksResp.json();
            }
        }

        if (state.currentTool === 'nas') {
            if (state.selectedNasHostId) {
                renderNasHostDetails(state.selectedNasHostId);
            } else {
                renderNasSummary();
            }
        }
    } catch (e) {
        console.error('Error fetching NAS data:', e);
    }
}

function selectNasHost(id) {
    state.selectedNasHostId = id;
    renderHostNodes('host-nodes-container-generic', {
        icon: tools['nas'].icon,
        showOSInfo: true,
        showStats: true,
        onHostClick: 'selectNasHost'
    });
    renderNasHostDetails(id);
}
window.selectNasHost = selectNasHost;

function renderNasHostDetails(hostId) {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    const host = state.allHostsCache.find(h => h.id === hostId);
    if (!host) return;

    const volumes = state.allNasVolumesCache.filter(v => v.host_id === hostId);
    const disks = state.allNasDisksCache.filter(d => d.host_id === hostId);

    scannerSection.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
            <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
        </div>

        <div style="display: grid; grid-template-columns: 350px 1fr; gap: 24px; align-items: start;">
            <!-- Left Column: Information -->
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    Sistema y Red
                </div>

                <div class="glass-panel" style="padding: 24px; text-align: left;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px;">
                        <div>
                            <h3 style="margin:0; font-size: 1.3rem;">${host.hostname}</h3>
                            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">
                                ${host.os_name} | ${host.uptime}
                            </div>
                        </div>
                        <div class="status-badge ${host.status === 'online' ? 'online' : 'offline'}">
                            ${host.status}
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
                        <div class="mini-stat-card" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px;">
                            <span class="label" style="font-size: 0.7rem; opacity: 0.6;">CPU Usage</span>
                            <span class="value" style="font-weight: 700;">${(host.cpu_usage || 0).toFixed(1)}%</span>
                        </div>
                        <div class="mini-stat-card" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px;">
                            <span class="label" style="font-size: 0.7rem; opacity: 0.6;">Memoria</span>
                            <span class="value" style="font-weight: 700;">${formatBytes(host.total_memory - host.free_memory)} / ${formatBytes(host.total_memory)}</span>
                        </div>
                        <div class="mini-stat-card" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px;">
                            <span class="label" style="font-size: 0.7rem; opacity: 0.6;">Kernel</span>
                            <span class="value" style="font-weight: 700; font-size: 0.75rem;">${host.kernel_version}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Column: Monitoring data -->
            <div style="display: flex; flex-direction: column; gap: 20px;">
                <div style="margin-bottom: 0;">
                    <h4 style="margin-bottom: 15px;"><i class="fa-solid fa-hard-drive"></i> Volúmenes de Almacenamiento (${volumes.length})</h4>
                    <div class="vm-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px;">
                        ${volumes.map(v => {
        const pct = (v.used_size / v.total_size * 100) || 0;
        return `
                            <div class="glass-panel" style="padding: 15px; border: 1px solid rgba(255,255,255,0.05);">
                                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                                    <div style="font-weight: 700;">${v.name}</div>
                                    <div style="font-size: 0.75rem; opacity: 0.6;">${v.type}</div>
                                </div>
                                <div class="progress-container" style="height: 8px; margin-bottom: 8px;">
                                    <div class="progress-bar" style="width: ${pct}%; background: ${getStatusColor(pct)};"></div>
                                </div>
                                <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                                    <span>${formatBytes(v.used_size)} / ${formatBytes(v.total_size)}</span>
                                    <span style="font-weight: 600;">${pct.toFixed(1)}%</span>
                                </div>
                            </div>
                        `}).join('')}
                    </div>
                </div>

                <div>
                    <h4 style="margin-bottom: 15px;"><i class="fa-solid fa-compact-disc"></i> Discos Físicos (${disks.length})</h4>
                    <div class="container-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px;">
                        ${disks.map(d => `
                            <div class="glass-panel" style="padding: 15px; border-left: 4px solid ${d.status === 'healthy' ? '#4ade80' : '#f87171'}; border-top: 1px solid rgba(255,255,255,0.05);">
                                <div style="display: flex; justify-content: space-between; align-items: start;">
                                    <div style="font-weight: 600;">${d.name}</div>
                                    <div style="font-size: 0.75rem; color: ${d.temp > 45 ? '#fbbf24' : 'inherit'};">
                                        <i class="fa-solid fa-temperature-half"></i> ${d.temp}°C
                                    </div>
                                </div>
                                <div style="font-size: 0.75rem; opacity: 0.6; margin: 4px 0;">${d.model}</div>
                                <div style="font-size: 0.8rem; margin-top: 8px;">Capacidad: ${formatBytes(d.size)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderNasSummary() {
    const container = document.getElementById('container-scanner-tool');
    if (!container) return;
    const scannerSection = container.querySelector('.scanner-section');
    if (!scannerSection) return;

    scannerSection.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
            <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
        </div>

        <div class="glass-panel" style="padding: 80px 25px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div style="font-size: 1.1rem; color: var(--text-secondary); opacity: 0.6; font-weight: 500;">
                <i class="fa-solid fa-arrow-up" style="margin-right: 8px;"></i> Selecciona un Servidor NAS para ver su almacenamiento
            </div>
        </div>
    `;
}

// Settings Tool Logic
const SETTINGS_CONFIG = {
    'kvm': {
        name: 'KVM (Virtualización)',
        icon: 'fa-solid fa-microchip',
        title: 'Configuración de Virtualización',
        api: API_CONFIG_SERVERS
    },
    'proxmox': {
        name: 'Proxmox (Virtualización)',
        icon: 'fa-solid fa-server',
        title: 'Configuración de Proxmox',
        api: '/api/config/proxmox'
    },
    'nas': {
        name: 'NAS (Almacenamiento)',
        icon: 'fa-solid fa-hdd',
        title: 'Configuración de NAS',
        api: '/api/config/nas'
    },
    'ceph': {
        name: 'Ceph (Almacenamiento)',
        icon: 'fa-solid fa-cubes',
        title: 'Configuración de Ceph',
        api: '/api/config/ceph'
    },
    'pfsense': {
        name: 'Firewall (pfSense)',
        icon: 'fa-brands fa-freebsd',
        title: 'Configuración de Firewall',
        api: API_FIREWALL_SERVERS
    },
    'docker': {
        name: 'Docker (Contenedores)',
        icon: 'fa-brands fa-docker',
        title: 'Configuración de Contenedores',
        api: '/api/config/docker'
    },
    'kubernetes': {
        name: 'Kubernetes (Contenedores)',
        icon: 'fa-solid fa-dharmachakra',
        title: 'Configuración de Kubernetes',
        api: '/api/config/kubernetes'
    },
    'podman': {
        name: 'Podman (Contenedores)',
        icon: 'fa-solid fa-otter',
        title: 'Configuración de Podman',
        api: '/api/config/podman'
    }
};

const LOGS_CONFIG = {
    'all': { name: 'Todos los Logs', icon: 'fa-solid fa-list-ul', title: 'Visor Global de Logs' }
};

let logsAutoRefreshInterval = null;
let logsFilter = '';

function renderLogsSidebar() {
    const sidebar = document.getElementById('logs-sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = `
        <div class="logs-search-container" style="padding: 10px;">
            <div class="search-box" style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 5px 10px; display: flex; align-items: center; border: 1px solid var(--glass-border);">
                <i class="fa-solid fa-magnifying-glass" style="opacity: 0.5; margin-right: 10px;"></i>
                <input type="text" id="logs-search-input" placeholder="Filtrar logs..." style="background: none; border: none; color: white; outline: none; width: 100%; font-size: 0.9rem;">
            </div>
        </div>
        <div style="padding: 10px;">
            <button class="secondary-btn" onclick="openRetentionModal()" style="width: 100%; display: flex; justify-content: center; gap: 8px; padding: 10px;">
                <i class="fa-solid fa-clock-rotate-left"></i> Políticas de Retención
            </button>
        </div>
        <div style="margin-top: 10px;" id="logs-categories-list">
            <div class="settings-menu-item active" data-category="all" onclick="selectLogCategory('all')">
                <i class="fa-solid fa-list-ul"></i>
                <span>App Logs (Centralizegg)</span>
            </div>
            <div class="settings-menu-item" data-category="kvm" onclick="selectLogCategory('kvm')"><i class="fa-solid fa-server"></i><span>KVM Logs</span></div>
            <div class="settings-menu-item" data-category="docker" onclick="selectLogCategory('docker')"><i class="fa-brands fa-docker"></i><span>Docker Logs</span></div>
            <div class="settings-menu-item" data-category="podman" onclick="selectLogCategory('podman')"><i class="fa-solid fa-otter"></i><span>Podman Logs</span></div>
            <div class="settings-menu-item" data-category="kubernetes" onclick="selectLogCategory('kubernetes')"><i class="fa-solid fa-dharmachakra"></i><span>Kubernetes Logs</span></div>
            <div class="settings-menu-item" data-category="pfsense" onclick="selectLogCategory('pfsense')"><i class="fa-brands fa-freebsd"></i><span>pfSense Logs</span></div>
            <div class="settings-menu-item" data-category="proxmox" onclick="selectLogCategory('proxmox')"><i class="fa-solid fa-cube"></i><span>Proxmox Logs</span></div>
            <div class="settings-menu-item" data-category="nas" onclick="selectLogCategory('nas')"><i class="fa-solid fa-hdd"></i><span>NAS Logs</span></div>
            <div class="settings-menu-item" data-category="ceph" onclick="selectLogCategory('ceph')"><i class="fa-solid fa-cubes"></i><span>Ceph Logs</span></div>
        </div>
    `;

    const searchInput = document.getElementById('logs-search-input');
    if (searchInput) {
        searchInput.value = logsFilter;
        searchInput.oninput = (e) => {
            logsFilter = e.target.value;
            if (currentLogCategory === 'all') {
                fetchAppLogs();
            } else {
                fetchHostLogsDB(currentLogCategory);
            }
        };
    }
}

let currentLogCategory = 'all';

window.selectLogCategory = function (cat) {
    currentLogCategory = cat;
    document.querySelectorAll('#logs-categories-list .settings-menu-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`#logs-categories-list .settings-menu-item[data-category="${cat}"]`).classList.add('active');

    if (cat === 'all') {
        document.getElementById('logs-category-title').innerText = "Logs de Sistema (App)";
        fetchAppLogs();
    } else {
        document.getElementById('logs-category-title').innerText = `Logs de Host (${cat.toUpperCase()})`;
        fetchHostLogsDB(cat);
    }
}

async function fetchHostLogsDB(category) {
    const content = document.getElementById('logs-content');
    if (!content) return;

    try {
        const res = await fetch(`/api/logging/host-logs?category=${category}&limit=200`);
        if (!res.ok) throw new Error('Failed to fetch host logs');
        const data = await res.json();
        const logs = data.logs || [];

        // Apply local filtering if searching
        const filteredLogs = logs.filter(l => {
            if (!logsFilter) return true;
            return (l.message || '').toLowerCase().includes(logsFilter.toLowerCase());
        });

        if (!filteredLogs || filteredLogs.length === 0) {
            content.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.5;">
                <i class="fa-solid fa-inbox" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                No se encontraron logs de host para ${category} ${logsFilter ? `con filtro "${logsFilter}"` : ''}
            </div>`;
            return;
        }

        content.innerHTML = filteredLogs.map(l => {
            const date = new Date(l.timestamp).toLocaleString();
            return `<div class="log-line">
                <span class="log-timestamp">[${date}]</span>
                <span class="log-info">[Server ID: ${l.server_id}]</span>
                <span class="log-message">${escapeHtml(l.message)}</span>
            </div>`;
        }).join('');
    } catch (e) {
        content.innerHTML = `<div style="color: #f87171; padding: 20px;">Error: ${e.message}</div>`;
    }
}

function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.openRetentionModal = async function () {
    const modal = document.getElementById('retention-modal');
    if (modal) {
        modal.classList.remove('hidden');
        try {
            const res = await fetch('/api/logging/retention');
            if (res.ok) {
                const data = await res.json();
                document.getElementById('retention-days-input').value = data.days || 7;
            }
        } catch (e) {
            console.error(e);
        }
    }
}

window.closeRetentionModal = function () {
    const modal = document.getElementById('retention-modal');
    if (modal) modal.classList.add('hidden');
}

window.saveRetentionPolicy = async function () {
    const days = document.getElementById('retention-days-input').value;
    try {
        const res = await fetch('/api/logging/retention', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days: parseInt(days) })
        });
        if (res.ok) {
            alert('Política de retención guardada correctamente.');
            closeRetentionModal();
        } else {
            alert('Error al guardar la política.');
        }
    } catch (e) {
        console.error(e);
        alert('Error de conexión.');
    }
}

window.cleanupAllLogs = async function () {
    if (!confirm("¿Estás seguro de que quieres eliminar TODOS los logs de host persistidos y los logs de la app? Esta acción no se puede deshacer.")) {
        return;
    }

    try {
        const res = await fetch('/api/logging/cleanup', {
            method: 'POST'
        });
        if (res.ok) {
            alert('Limpieza completada correctamente.');
            closeRetentionModal();
            if (currentLogCategory === 'all') fetchAppLogs();
            else fetchHostLogsDB(currentLogCategory);
        } else {
            alert('Error durante la limpieza.');
        }
    } catch (e) {
        console.error(e);
        alert('Error de conexión al limpiar.');
    }
}


async function fetchAppLogs() {
    const content = document.getElementById('logs-content');
    if (!content) return;

    try {
        const url = `/api/app-logs?limit=200${logsFilter ? `&filter=${encodeURIComponent(logsFilter)}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch logs');
        const logs = await res.json();

        if (!logs || logs.length === 0) {
            content.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.5;">
                <i class="fa-solid fa-inbox" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                No se encontraron logs ${logsFilter ? `para "${logsFilter}"` : ''}
            </div>`;
            return;
        }

        content.innerHTML = logs.map(l => {
            const date = new Date(l.timestamp).toLocaleString();
            let levelClass = 'log-info';
            if (l.level === 'ERROR') levelClass = 'log-error';
            else if (l.level === 'WARNING') levelClass = 'log-warn';
            else if (l.level === 'DEBUG') levelClass = 'log-debug';

            return `
                <div class="log-line ${levelClass}" style="margin-bottom: 4px; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; display: flex;">
                    <span style="color: #6ee7b7; white-space: nowrap; margin-right: 10px;">[${date}]</span>
                    <span style="color: ${l.level === 'ERROR' ? '#f87171' : l.level === 'WARNING' ? '#fbbf24' : '#60a5fa'}; font-weight: bold; width: 60px; display: inline-block;">${l.level}</span>
                    <span style="color: #c084fc; margin-right: 10px; white-space: nowrap;">[${l.module}]</span>
                    <span style="color: rgba(255,255,255,0.9); word-break: break-all;">${l.message}</span>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('[Logs] Fetch error:', e);
        content.innerHTML = `<div style="color: #f87171; padding: 20px;">Error al cargar logs: ${e.message}</div>`;
    }
}

function loadLogsCategory(category) {
    // Only 'all' or filtering via search input
    fetchAppLogs();
}

function initLogs() {
    if (logsInitialized) {
        startLogsRefresh();
        return;
    }
    renderLogsSidebar();
    const closeBtn = document.getElementById('close-logs-btn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            stopLogsRefresh();
            window.location.hash = '';
            document.getElementById('logs-tool').classList.add('hidden');
            document.getElementById('welcome-screen').style.display = 'flex';
            state.currentTool = null;
        };
    }
    logsInitialized = true;
    fetchAppLogs();
    startLogsRefresh();
}

function startLogsRefresh() {
    stopLogsRefresh();
    logsAutoRefreshInterval = setInterval(fetchAppLogs, 3000); // 3s refresh
}

function stopLogsRefresh() {
    if (logsAutoRefreshInterval) {
        clearInterval(logsAutoRefreshInterval);
        logsAutoRefreshInterval = null;
    }
}

let logsCurrentCategory = 'kvm';
let logsInitialized = false;
let settingsCurrentCategory = 'kvm';
let settingsInitialized = false;

function renderSettingsSidebar() {
    const sidebar = document.getElementById('settings-sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = Object.entries(SETTINGS_CONFIG).map(([id, config]) => `
        <div class="settings-menu-item ${id === settingsCurrentCategory ? 'active' : ''}" data-category="${id}">
            <i class="${config.icon}"></i>
            <span>${config.name}</span>
        </div>
        `).join('') + `
        <div style="flex: 1;"></div>
        <div style="border-top: 1px solid var(--glass-border); margin-top: 15px; padding-top: 15px;">
            <div class="settings-menu-item ${settingsCurrentCategory === 'status' ? 'active' : ''}" data-category="status">
                <i class="fa-solid fa-circle-info"></i>
                <span>Status</span>
            </div>
        </div>
    `;

    // Re-attach listeners to new items
    const menuItems = sidebar.querySelectorAll('.settings-menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            menuItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            const category = item.dataset.category;
            if (category === 'status') {
                showStatusPanel();
            } else {
                loadSettingsCategory(category);
            }
        });
    });
}

function initSettings() {
    if (settingsInitialized) return;
    console.log('[DEBUG] Initializing Settings Tool');

    renderSettingsSidebar();

    // Auth type toggle
    const authTypeRadios = document.querySelectorAll('input[name="settingsAuthType"]');
    if (authTypeRadios.length > 0) {
        authTypeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                const keyGroup = document.getElementById('settings-key-group');
                const passGroup = document.getElementById('settings-pass-group');
                if (keyGroup && passGroup) {
                    if (e.target.value === 'key') {
                        keyGroup.style.display = 'flex';
                        passGroup.style.display = 'none';
                    } else {
                        keyGroup.style.display = 'none';
                        passGroup.style.display = 'flex';
                    }
                }
            });
        });
    }

    // SSH Key File Upload Listener
    const keyFileInput = document.getElementById('settings-srv-key-file');
    if (keyFileInput) {
        keyFileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const statusEl = document.getElementById('settings-key-status');
                if (statusEl) {
                    statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Llave cargada: ${file.name}</span>`;
                    statusEl.classList.add('success');
                }
            };
            reader.readAsText(file);
        };
    }

    // Kubeconfig File Upload Listener
    const kubeconfigFileInput = document.getElementById('settings-srv-kubeconfig-file');
    if (kubeconfigFileInput) {
        kubeconfigFileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                document.getElementById('settings-srv-kubeconfig-content').value = event.target.result;
                document.getElementById('settings-srv-kubeconfig-path').value = file.name;
                const statusEl = document.getElementById('settings-kubeconfig-status');
                if (statusEl) {
                    statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Kubeconfig cargado: ${file.name}</span>`;
                    statusEl.classList.add('success');
                }

                // If Name is empty, use the filename as default
                const nameInput = document.getElementById('settings-srv-name');
                if (nameInput && !nameInput.value) {
                    nameInput.value = file.name.split('.')[0];
                }

                // Update labels to show optionality
                updateK8sLabels(true);
            };
            reader.readAsText(file);
        };
    }


    // Category selection (sidebar items now handled in renderSettingsSidebar)

    // Save button
    const saveBtn = document.getElementById('settings-save-btn');
    if (saveBtn) saveBtn.onclick = saveSettingsServer;

    // Cancel button
    const cancelBtn = document.getElementById('settings-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = resetSettingsForm;

    // Close Settings button
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    if (closeSettingsBtn) {
        closeSettingsBtn.onclick = () => {
            window.location.hash = ''; // Clear hash to trigger home navigation
            // If hash is already empty, ensure we switch tool
            if (!window.location.hash) {
                // Navigate to a default tool or welcome screen
                // The hash listener in app.js usually handles this
                // For now, let's just use the existing navigateHome effect
                const virtTool = document.getElementById('virtualization-tool');
                const containerTool = document.getElementById('container-scanner-tool');
                const settingsTool = document.getElementById('settings-tool');
                const welcomeScreen = document.getElementById('welcome-screen');
                const configBtn = document.getElementById('config-btn');

                if (settingsTool) settingsTool.classList.add('hidden');
                if (virtTool) virtTool.classList.add('hidden');
                if (containerTool) containerTool.classList.add('hidden');
                if (welcomeScreen) welcomeScreen.style.display = 'flex';
                if (configBtn) configBtn.classList.remove('active');
                state.currentTool = null;
            }
        };
    }

    settingsInitialized = true;
    loadSettingsCategory('kvm');
}

async function loadSettingsCategory(category) {
    settingsCurrentCategory = category;
    const config = SETTINGS_CONFIG[category];
    const title = document.getElementById('settings-category-title');

    if (title && config) {
        title.innerText = config.title;
    }

    // Restore description paragraph if hidden
    const descEl = title?.parentElement?.querySelector('p');
    if (descEl) descEl.style.display = '';

    // Restore managed servers section if hidden
    const managedServers = document.querySelector('.settings-managed-servers');
    if (managedServers) managedServers.style.display = '';

    resetSettingsForm();
    renderSettingsServerList();
}

async function renderSettingsServerList() {
    const listContainer = document.getElementById('settings-server-list');
    if (!listContainer) return;

    listContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; opacity: 0.5;"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...</div>';

    const api = getConfigAPIForTool(settingsCurrentCategory);
    try {
        const response = await fetch(api);
        const servers = await response.json();

        if (!servers || servers.length === 0) {
            listContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dashed var(--glass-border); color: var(--text-secondary);">No hay servidores configurados en esta categoría.</div>';
            return;
        }

        listContainer.innerHTML = servers.map(srv => {
            const sshPort = srv.ssh_port || srv.port || 22;
            const isOnline = srv.status === 'online' || srv.status === 'accessible';
            const plugColor = isOnline ? '#4ade80' : '#ef4444';
            return `
                <div class="settings-server-card">
                    <div class="settings-server-meta">
                        <div class="settings-server-name">${srv.name}</div>
                        <div class="settings-server-addr">
                            <i class="fa-solid fa-plug" style="color: ${plugColor};"></i> ${srv.ip_address}:${sshPort}
                        </div>
                    </div>
                    <div class="settings-server-actions">
                        <button class="settings-action-btn edit" onclick="editSettingsServer(${JSON.stringify(srv).replace(/"/g, '&quot;')})" title="Editar">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="settings-action-btn delete" onclick="deleteSettingsServer(${srv.id})" title="Eliminar">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        listContainer.innerHTML = '<div style="grid-column: 1/-1; color: var(--danger); text-align: center;">Error al cargar servidores.</div>';
    }
}

// Show Status Panel
async function showStatusPanel() {
    settingsCurrentCategory = 'status';
    const contentWrapper = document.querySelector('.settings-content-wrapper');
    if (!contentWrapper) return;

    // Update title
    const titleEl = document.getElementById('settings-category-title');
    if (titleEl) {
        titleEl.innerHTML = '<i class="fa-solid fa-circle-info"></i> Estado del Sistema';
    }

    // Hide description paragraph
    const descEl = titleEl?.parentElement?.querySelector('p');
    if (descEl) descEl.style.display = 'none';

    // Hide the form and managed servers section
    const formContainer = document.querySelector('.settings-form-container');
    const managedServers = document.querySelector('.settings-managed-servers');

    if (formContainer) {
        formContainer.innerHTML = `
            <div style="text-align: center; padding: 60px;">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: var(--accent-color);"></i>
                <p style="margin-top: 15px; color: var(--text-secondary);">Cargando información del sistema...</p>
            </div>
        `;
    }

    if (managedServers) managedServers.style.display = 'none';

    try {
        const response = await fetch('/api/status');
        const status = await response.json();

        const formatBytes = (bytes) => {
            if (!bytes || bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };

        const schemaLabels = {
            'virtualization': 'Virtualización',
            'firewall': 'Firewall (pfSense)',
            'storage': 'Almacenamiento',
            'containers': 'Contenedores',
            'kubernetes': 'Kubernetes',
            'logging': 'Logs de Sistema'
        };

        const dbSizes = status.db_size || {};
        const maxDbSize = Math.max(...Object.values(dbSizes), 1);
        const schemaRows = Object.entries(dbSizes).map(([schema, size]) => {
            const percentage = Math.max((size / maxDbSize) * 100, 2); // min 2% for visibility
            const label = schemaLabels[schema] || schema.charAt(0).toUpperCase() + schema.slice(1);
            return `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.9rem;">
                        <span style="font-weight: 600; color: var(--text-primary);">${label}</span>
                        <span style="color: var(--accent-color); font-weight: 700;">${formatBytes(size)}</span>
                    </div>
                    <div style="height: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; overflow: hidden; position: relative;">
                        <div style="position: absolute; left: 0; top: 0; width: ${percentage}%; height: 100%; background: linear-gradient(90deg, var(--accent-color), #8b5cf6); box-shadow: 0 0 15px rgba(56, 189, 248, 0.4); border-radius: 5px; transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);"></div>
                    </div>
                </div>
            `;
        }).join('');

        formContainer.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 24px; max-width: 800px; margin: 0 auto;">
                
                <!-- Main Status Banner -->
                <div style="background: linear-gradient(135deg, rgba(56, 189, 248, 0.1), rgba(139, 92, 246, 0.1)); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 20px; padding: 30px; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 20px;">
                        <div style="width: 64px; height: 64px; background: var(--accent-color); border-radius: 16px; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 16px rgba(56, 189, 248, 0.3);">
                            <i class="fa-solid fa-server" style="font-size: 2rem; color: white;"></i>
                        </div>
                        <div>
                            <h3 style="margin: 0; font-size: 1.4rem; color: var(--text-primary);">CentralizeGG Engine</h3>
                            <p style="margin: 5px 0 0 0; color: var(--text-secondary);">Versión ${status.version || '1.2.0'} • Activo desde hace ${status.uptime ? status.uptime.split('.')[0] : 'n/a'}</p>
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                         <div style="padding: 10px 20px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 12px; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-circle" style="font-size: 0.6rem; color: var(--success);"></i>
                            <span style="color: var(--success); font-weight: 700; text-transform: uppercase; font-size: 0.8rem;">APP ${status.app_status}</span>
                         </div>
                         <div style="padding: 10px 20px; background: rgba(${status.db_status === 'online' ? '34, 197, 94' : '239, 68, 68'}, 0.1); border: 1px solid rgba(${status.db_status === 'online' ? '34, 197, 94' : '239, 68, 68'}, 0.3); border-radius: 12px; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-database" style="color: ${status.db_status === 'online' ? 'var(--success)' : 'var(--danger)'};"></i>
                            <span style="color: ${status.db_status === 'online' ? 'var(--success)' : 'var(--danger)'}; font-weight: 700; text-transform: uppercase; font-size: 0.8rem;">DB ${status.db_status}</span>
                         </div>
                    </div>
                </div>

                <!-- Metrics Grid -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <!-- CPU Usage -->
                    <div style="background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 20px; padding: 25px; display: flex; align-items: center; gap: 25px;">
                        <div style="position: relative; width: 80px; height: 80px; display: flex; align-items: center; justify-content: center;">
                            <svg viewBox="0 0 36 36" style="width: 100%; height: 100%; transform: rotate(-90deg);">
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="3" />
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--accent-color)" stroke-width="3" stroke-dasharray="${status.app_cpu || 0}, 100" />
                            </svg>
                            <span style="position: absolute; font-size: 1.2rem; font-weight: 700; color: var(--text-primary);">${(status.app_cpu || 0).toFixed(1)}%</span>
                        </div>
                        <div>
                            <h4 style="margin: 0; color: var(--text-secondary); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">Carga CPU</h4>
                            <p style="margin: 5px 0 0 0; font-size: 0.85rem; color: var(--text-secondary);">Recursos consumidos por el motor</p>
                        </div>
                    </div>

                    <!-- Memory Usage -->
                    <div style="background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 20px; padding: 25px; display: flex; align-items: center; gap: 25px;">
                        <div style="width: 80px; height: 80px; background: rgba(139, 92, 246, 0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid rgba(139, 92, 246, 0.3);">
                            <i class="fa-solid fa-memory" style="font-size: 1.8rem; color: #a78bfa;"></i>
                        </div>
                        <div>
                            <h4 style="margin: 0; color: var(--text-secondary); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">Memoria RAM</h4>
                            <p style="margin: 5px 0 0 0; font-size: 1.2rem; font-weight: 700; color: var(--text-primary);">${formatBytes(status.app_memory)}</p>
                        </div>
                    </div>
                </div>

                <!-- Comparative DB Sizes -->
                <div style="background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 20px; padding: 30px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px;">
                        <div>
                            <h3 style="margin: 0; font-size: 1.2rem; color: var(--text-primary);"><i class="fa-solid fa-chart-bar" style="margin-right: 12px; color: var(--accent-color);"></i>Distribución de Datos</h3>
                            <p style="margin: 5px 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">Comparativa de tamaño por módulo de infraestructura</p>
                        </div>
                        <div style="text-align: right;">
                            <span style="display: block; font-size: 1.4rem; font-weight: 700; color: var(--accent-color);">${formatBytes(status.db_total_size)}</span>
                            <span style="font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase;">Tamaño Total</span>
                        </div>
                    </div>
                    
                    <div style="padding: 10px 0;">
                        ${schemaRows || '<p style="color: var(--text-secondary); text-align: center;">Sin datos disponibles</p>'}
                    </div>
                </div>

                <!-- Footer -->
                <div style="text-align: center; border-top: 1px solid var(--glass-border); padding-top: 20px; margin-top: 10px;">
                    <p style="color: var(--text-secondary); font-size: 0.8rem; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <i class="fa-solid fa-shield-halved" style="color: var(--accent-color);"></i>
                        Sistema de monitoreo interno activo v${status.version || '1.0.0'}
                        <span style="opacity: 0.3;">|</span>
                        <i class="fa-solid fa-clock"></i>
                        Actualizado: ${new Date().toLocaleTimeString('es-ES')}
                    </p>
                </div>
            </div>
        `;
    } catch (e) {
        console.error('[Status] Error:', e);
        formContainer.innerHTML = `
            <div style="text-align: center; padding: 60px; color: var(--danger);">
                <i class="fa-solid fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 15px;"></i>
                <p>Error al obtener el estado del sistema</p>
            </div>
        `;
    }
}

window.editSettingsServer = (srv) => {
    document.getElementById('settings-srv-id').value = srv.id;
    document.getElementById('settings-srv-name').value = srv.name;
    document.getElementById('settings-srv-ip').value = srv.ip_address;
    document.getElementById('settings-srv-port').value = srv.ssh_port || srv.port || 22;
    document.getElementById('settings-srv-user').value = srv.username;

    const isKey = srv.ssh_key_path ? true : false;
    const authRadios = document.querySelectorAll('input[name="settingsAuthType"]');
    authRadios.forEach(r => {
        if (r.value === (isKey ? 'key' : 'password')) r.checked = true;
    });

    document.getElementById('settings-key-group').style.display = isKey ? 'flex' : 'none';
    document.getElementById('settings-pass-group').style.display = isKey ? 'none' : 'flex';

    if (isKey) {
        const keyStatus = document.getElementById('settings-key-status');
        const hasKey = srv.ssh_key_content || srv.ssh_key_path;
        if (hasKey) {
            const label = srv.ssh_key_content ? 'Llave almacenada en DB' : `Ruta config: ${srv.ssh_key_path}`;
            keyStatus.innerHTML = `<i class="fa-solid fa-shield-check"></i> <span>${label}</span>`;
            keyStatus.classList.add('success');
            keyStatus.style.color = ''; // Remove inline color if any
        } else {
            keyStatus.innerHTML = `<i class="fa-solid fa-file-shield"></i> <span>No se ha subido ninguna llave</span>`;
            keyStatus.classList.remove('success');
            keyStatus.style.color = '';
        }
        document.getElementById('settings-srv-key-content').value = srv.ssh_key_content || '';
        document.getElementById('settings-srv-key-path').value = srv.ssh_key_path || '';
    }

    // Kubeconfig status
    const kubeGroup = document.getElementById('settings-kubeconfig-group');
    if (kubeGroup) {
        kubeGroup.style.display = (settingsCurrentCategory === 'kubernetes') ? 'flex' : 'none';
        const kubeStatus = document.getElementById('settings-kubeconfig-status');
        const hasKube = srv.kubeconfig_content || srv.kubeconfig_path;
        if (hasKube) {
            const label = srv.kubeconfig_content ? 'Kubeconfig en DB' : `Ruta config: ${srv.kubeconfig_path}`;
            kubeStatus.innerHTML = `<i class="fa-solid fa-shield-check"></i> <span>${label}</span>`;
            kubeStatus.classList.add('success');
        } else {
            kubeStatus.innerHTML = `<i class="fa-solid fa-file-code"></i> <span>No se ha subido ningún archivo</span>`;
            kubeStatus.classList.remove('success');
        }
        document.getElementById('settings-srv-kubeconfig-content').value = srv.kubeconfig_content || '';
        document.getElementById('settings-srv-kubeconfig-path').value = srv.kubeconfig_path || '';

        updateK8sLabels(hasKube);
    }

    document.getElementById('settings-srv-pass').value = '';

    document.getElementById('settings-save-btn').innerText = 'Actualizar Servidor';
    document.getElementById('settings-cancel-btn').style.display = 'block';

    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function resetSettingsForm() {
    const form = document.getElementById('settings-server-form');
    if (form) form.reset();
    document.getElementById('settings-srv-id').value = '';
    document.getElementById('settings-save-btn').innerText = 'Guardar Servidor';
    document.getElementById('settings-cancel-btn').style.display = 'none';

    document.getElementById('settings-key-group').style.display = 'flex';
    document.getElementById('settings-pass-group').style.display = 'none';

    // Kubernetes specific kubeconfig group
    const kubeGroup = document.getElementById('settings-kubeconfig-group');
    if (kubeGroup) {
        kubeGroup.style.display = (settingsCurrentCategory === 'kubernetes') ? 'flex' : 'none';
    }
    document.getElementById('settings-srv-key-content').value = '';
    document.getElementById('settings-srv-key-path').value = '';
    const keyStatus = document.getElementById('settings-key-status');
    if (keyStatus) {
        keyStatus.innerHTML = `<i class="fa-solid fa-file-shield"></i> <span>No se ha subido ninguna llave</span>`;
        keyStatus.classList.remove('success');
        keyStatus.style.color = '';
    }

    document.getElementById('settings-srv-kubeconfig-content').value = '';
    document.getElementById('settings-srv-kubeconfig-path').value = '';
    const kubeStatus = document.getElementById('settings-kubeconfig-status');
    if (kubeStatus) {
        kubeStatus.innerHTML = `<i class="fa-solid fa-file-code"></i> <span>No se ha subido ningún archivo</span>`;
        kubeStatus.classList.remove('success');
    }
    updateK8sLabels(false);
}

function updateK8sLabels(hasKube) {
    if (settingsCurrentCategory !== 'kubernetes') return;
    const labels = {
        'settings-srv-name': 'Nombre',
        'settings-srv-ip': 'Dirección IP / Hostname',
        'settings-srv-user': 'Usuario SSH'
    };
    for (const [id, original] of Object.entries(labels)) {
        const input = document.getElementById(id);
        if (!input) continue;
        const labelEl = document.querySelector(`label[for="${id}"]`) || input.previousElementSibling;
        if (labelEl && labelEl.tagName === 'LABEL') {
            labelEl.innerText = hasKube ? `${original} (Opcional)` : original;
        }
    }
}

async function saveSettingsServer() {
    const id = document.getElementById('settings-srv-id').value;
    const name = document.getElementById('settings-srv-name').value;
    const ip = document.getElementById('settings-srv-ip').value;
    const port = parseInt(document.getElementById('settings-srv-port').value) || 22;
    const user = document.getElementById('settings-srv-user').value;
    const authTypeInput = document.querySelector('input[name="settingsAuthType"]:checked');
    const authType = authTypeInput ? authTypeInput.value : 'key';
    const pass = document.getElementById('settings-srv-pass').value;
    const keyPath = document.getElementById('settings-srv-key-path').value;
    const keyContent = document.getElementById('settings-srv-key-content').value;
    const kubePath = document.getElementById('settings-srv-kubeconfig-path').value;
    const kubeContent = document.getElementById('settings-srv-kubeconfig-content').value;

    const isK8s = settingsCurrentCategory === 'kubernetes';
    const hasKube = kubeContent !== '';

    if (!name && !(isK8s && hasKube)) {
        alert('Por favor completa el Nombre del servidor.');
        return;
    }

    if (!isK8s || !hasKube) {
        if (!ip || !user) {
            alert('Por favor completa los campos obligatorios (IP, Usuario).');
            return;
        }
    }

    const data = {
        name,
        ip_address: ip,
        ssh_port: port,
        username: user,
        password: authType === 'password' ? pass : '',
        ssh_key_path: authType === 'key' ? keyPath : '',
        ssh_key_content: authType === 'key' ? keyContent : '',
        kubeconfig_path: settingsCurrentCategory === 'kubernetes' ? kubePath : '',
        kubeconfig_content: settingsCurrentCategory === 'kubernetes' ? kubeContent : '',
    };

    const apiUrl = getConfigAPIForTool(settingsCurrentCategory);
    try {
        let response;
        if (id) {
            response = await fetch(`${apiUrl}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }

        if (response.ok) {
            resetSettingsForm();
            renderSettingsServerList();
            // Refresh main lists if needed
            if (state.currentTool === 'kvm') refreshAll();
            if (state.currentTool === 'pfsense') fetchFirewallHosts();
            if (state.currentTool === 'docker') checkAndFetchHostsForTool('docker');
            if (state.currentTool === 'podman') checkAndFetchHostsForTool('podman');
            if (state.currentTool === 'proxmox') checkAndFetchHostsForTool('proxmox');
            if (state.currentTool === 'kubernetes') checkAndFetchHostsForTool('kubernetes');
            if (state.currentTool === 'nas') checkAndFetchHostsForTool('nas');
        } else {
            const err = await response.text();
            alert('Error al guardar: ' + err);
        }
    } catch (e) {
        console.error('Error saving server:', e);
        alert('Error de conexión: ' + e.message);
    }
}

window.deleteSettingsServer = async (id) => {
    if (!confirm('¿Estás seguro de eliminar este servidor?')) return;

    const apiUrl = getConfigAPIForTool(settingsCurrentCategory);
    try {
        const response = await fetch(`${apiUrl}/${id}`, { method: 'DELETE' });
        if (response.ok) {
            renderSettingsServerList();
            if (state.currentTool === 'kvm') refreshAll();
            if (state.currentTool === 'pfsense') fetchFirewallHosts();
            if (state.currentTool === 'docker') checkAndFetchHostsForTool('docker');
            if (state.currentTool === 'podman') checkAndFetchHostsForTool('podman');
            if (state.currentTool === 'proxmox') checkAndFetchHostsForTool('proxmox');
            if (state.currentTool === 'kubernetes') checkAndFetchHostsForTool('kubernetes');
            if (state.currentTool === 'nas') checkAndFetchHostsForTool('nas');
        } else {
            alert('Error al eliminar.');
        }
    } catch (e) {
        alert('Error de conexión.');
    }
};

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
        const tools = [
            { key: 'kvm', api: API_CONFIG_SERVERS, label: 'KVM', icon: 'fa-microchip' },
            { key: 'pfsense', api: API_FIREWALL_SERVERS, label: 'Firewall', icon: 'fa-brands fa-freebsd' },
            { key: 'docker', api: getConfigAPIForTool('docker'), label: 'Docker', icon: 'fa-brands fa-docker' },
            { key: 'podman', api: getConfigAPIForTool('podman'), label: 'Podman', icon: 'fa-otter' },
            { key: 'kubernetes', api: getConfigAPIForTool('kubernetes'), label: 'K8s', icon: 'fa-dharmachakra' },
            { key: 'proxmox', api: getConfigAPIForTool('proxmox'), label: 'Proxmox', icon: 'fa-server' },
            { key: 'nas', api: getConfigAPIForTool('nas'), label: 'NAS', icon: 'fa-hdd' },
            { key: 'ceph', api: getConfigAPIForTool('ceph'), label: 'Ceph', icon: 'fa-cubes' }
        ];

        const results = await Promise.allSettled(tools.map(t => fetch(t.api)));
        const allServers = [];

        console.log('%c[DEBUG] checkServerStatus - Starting processing...', 'color: #38bdf8; font-weight: bold');

        for (let i = 0; i < tools.length; i++) {
            const tool = tools[i];
            const res = results[i];

            if (res.status === 'fulfilled' && res.value.ok) {
                try {
                    const servers = await res.value.json() || [];
                    console.log(`%c[DEBUG] ${tool.label} Data:`, 'color: #a1a1aa', servers);

                    servers.forEach(s => {
                        // Normalize fields for the notification list
                        const normalizedServer = {
                            id: s.id || s.ID || 0,
                            name: s.server_name || s.name || s.Name || s.Hostname || s.hostname || 'Servidor Desconocido',
                            ip: s.ip_address || s.IPAddress || s.ip || s.IP || 'Sin IP',
                            port: s.ssh_port || s.SSHPort || s.port || 22,
                            status: (s.status || s.Status || 'unknown').toLowerCase(),
                            offline_since: s.offline_since || null,
                            toolLabel: tool.label,
                            toolIcon: tool.icon
                        };
                        allServers.push(normalizedServer);
                    });

                    // Update global caches (maintaining existing logic for tool UI)
                    if (tool.key === 'kvm') state.currentServers = servers;
                    if (tool.key === 'pfsense') state.currentFirewallServers = servers;
                    if (tool.key === 'docker') state.currentDockerServers = servers;
                    if (tool.key === 'podman') state.currentPodmanServers = servers;
                    if (tool.key === 'kubernetes') state.currentKubernetesServers = servers;
                    if (tool.key === 'proxmox') state.currentProxmoxServers = servers;
                    if (tool.key === 'nas') state.currentNasServers = servers;
                } catch (jsonErr) {
                    console.warn(`[DEBUG] Error parsing JSON for ${tool.label}:`, jsonErr);
                }
            } else {
                console.warn(`[DEBUG] API fetch failed for ${tool.label}:`, res.reason || 'Status not OK');
            }
        }

        const offlineServers = allServers.filter(s => s.status !== 'online');
        console.log(`%c[DEBUG] Total Servers: ${allServers.length}, Offline: ${offlineServers.length}`, 'color: #38bdf8', offlineServers);

        const badge = document.getElementById('notification-count');
        const list = document.getElementById('notification-list');

        // Sound Logic
        if (offlineServers.length > state.lastNotificationCount) {
            try { playAlertSound(); } catch (e) { console.warn("Sound error:", e); }
            state.lastReminderSoundTime = Date.now();
        } else if (offlineServers.length > 0) {
            const now = Date.now();
            if (now - state.lastReminderSoundTime > 60000) {
                try { playAlertSound(); } catch (e) { console.warn("Reminder sound error:", e); }
                state.lastReminderSoundTime = now;
            }
        } else {
            state.lastReminderSoundTime = 0;
        }
        state.lastNotificationCount = offlineServers.length;

        if (badge && list) {
            const now = new Date();
            if (offlineServers.length > 0) {
                badge.textContent = offlineServers.length;
                badge.classList.remove('hidden');
                list.innerHTML = offlineServers.map(s => {
                    let offlineTimeStr = '';
                    if (s.offline_since) {
                        const offlineDate = new Date(s.offline_since);
                        const diffMs = now - offlineDate;
                        const diffMins = Math.floor(diffMs / 60000);
                        const diffHours = Math.floor(diffMins / 60);
                        const diffDays = Math.floor(diffHours / 24);

                        if (diffDays > 0) {
                            offlineTimeStr = `Offline hace ${diffDays}d ${diffHours % 24}h`;
                        } else if (diffHours > 0) {
                            offlineTimeStr = `Offline hace ${diffHours}h ${diffMins % 60}m`;
                        } else if (diffMins > 0) {
                            offlineTimeStr = `Offline hace ${diffMins}m`;
                        } else {
                            offlineTimeStr = 'Offline hace menos de 1m';
                        }
                    }

                    return `
                    <li>
                        <i class="fa-solid fa-circle-exclamation" style="color:var(--danger); font-size: 1.1rem;"></i>
                        <div class="notif-item-content">
                            <div class="notif-tool-header">
                                <span class="offline-tool-badge"><i class="${s.toolIcon}" style="font-size: 0.7rem;"></i> ${s.toolLabel}</span>
                                <span class="offline-host-name">${s.name}</span>
                            </div>
                            <span class="offline-details">${s.ip}:${s.port} no accesible</span>
                            ${offlineTimeStr ? `<span class="offline-time" style="font-size: 0.7rem; color: var(--text-tertiary); display: block; margin-top: 2px;"><i class="fa-regular fa-clock"></i> ${offlineTimeStr}</span>` : ''}
                        </div>
                    </li>
                `;
                }).join('');
            } else {
                badge.classList.add('hidden');
                list.innerHTML = '<li style="color:var(--text-secondary); text-align:center; display:block; padding: 20px;">Todos los sistemas activos</li>';
            }
        }
    } catch (e) {
        console.error('[DEBUG] Status check error:', e);
    }
}

// Auto-refresh
function refreshAll() {
    if (document.hidden) return; // Skip background updates to save resources
    checkServerStatus();
    if (state.currentTool === 'kvm') {
        fetchHosts();
        fetchVMs();
    } else if (state.currentTool === 'pfsense') {
        fetchFirewallHosts();
    } else if (state.currentTool) {
        // Refresh hosts for other tools
        checkAndFetchHostsForTool(state.currentTool);
    }
}

// Auto-refresh every 10 seconds. renderFromData already skips redraw if topology unchanged.
setInterval(refreshAll, 10000);
checkServerStatus(); // Run immediately

// Initial tool view
switchTool(state.currentTool);








function selectFirewallHost(hostId) {
    state.selectedFirewallHostId = hostId;
    // Rerender nodes to update selection state
    renderHostNodes('host-nodes-container-generic', {
        icon: tools[state.currentTool]?.icon || 'fa-solid fa-shield-halved',
        showOSInfo: true,
        showStats: true,
        onHostClick: 'selectFirewallHost'
    });

    state.selectedHostId = hostId; // Also update global (though mostly used for KVM)
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

    const host = state.allHostsCache.find(h => h.id === hostId);
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
        const history = state.pfSenseNetworkHistory[historyKey];

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
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <h2 style="margin:0; font-size: 1.8rem; font-weight: 600;"><i class="fa-solid fa-list-ul"></i> Resumen</h2>
            </div>
        </div>
        
        <div class="glass-panel" style="padding: 20px;">
            <div style="display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start;">
                <!-- Left Column: OS, Uptime, Gateways (Fixed Width approx 350px) -->
                <div style="flex: 0 0 350px; display: flex; flex-direction: column; gap: 15px;">
                    
                    <!-- System Info Section -->
                    <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 5px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        Sistema y Red
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

        <!-- Host Events Card (pfSense) -->
        <div class="glass-panel" style="padding: 20px; margin-top: 25px;">
            <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); width: 100%; display: flex; align-items: center; gap: 10px;">
                <i class="fa-solid fa-terminal" style="color: var(--accent-color); font-size: 1rem;"></i>
                Eventos del host (pfSense)
            </div>
            <div id="pfsense-host-events">
                ${renderHostEvents(host.host_events, 'pfSense')}
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
        this.heatLayer = null;
        this.showHeatmap = false;
        this.filterMode = 'all'; // all, inbound, outbound

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

        // Add Controls
        this.createControls();

        // Clear markers & heatmap
        this.markers.forEach(m => this.mapInstance.removeLayer(m));
        this.markers = [];
        if (this.heatLayer) {
            this.heatLayer.remove();
            this.heatLayer = null;
        }

        // Filter top connections
        this.activeMapConnections = connections.slice(0, 50);
        console.log(`[NetworkMap] Processing ${this.activeMapConnections.length} connections.`);

        // Determine Home
        this.updateHomeLocation();
        this.updateDebugOverlay();

        // FILTER LOGIC
        const filteredConns = this.activeMapConnections.filter(conn => {
            if (this.filterMode === 'all') return true;
            const isInbound = conn.inbound > conn.outbound;
            if (this.filterMode === 'inbound') return isInbound;
            if (this.filterMode === 'outbound') return !isInbound;
            return true;
        });

        // Process Connections or Heatmap
        if (this.showHeatmap) {
            this.updateHeatmap(filteredConns);
        } else {
            filteredConns.forEach(conn => {
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
        }

        // Trigger Queue Processing
        this.processGeoQueue();
    }

    createControls() {
        if (document.getElementById(this.containerId + '-controls')) return;

        const controlDiv = document.createElement('div');
        controlDiv.id = this.containerId + '-controls';
        controlDiv.style.cssText = 'position: absolute; top: 10px; right: 10px; z-index: 1000; display: flex; gap: 5px;';

        controlDiv.innerHTML = `
            <div style="display: flex; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; overflow: hidden;">
                <button data-filter="all" onclick="window.currentFirewallMap.setFilter('all')" style="background: rgba(56, 189, 248, 0.6); color: white; border: none; cursor: pointer; padding: 6px 10px; font-size: 0.8rem; border-right: 1px solid rgba(255,255,255,0.1);">All</button>
                <button data-filter="inbound" onclick="window.currentFirewallMap.setFilter('inbound')" style="background: transparent; color: #fca5a5; border: none; cursor: pointer; padding: 6px 10px; font-size: 0.8rem; border-right: 1px solid rgba(255,255,255,0.1);">In</button>
                <button data-filter="outbound" onclick="window.currentFirewallMap.setFilter('outbound')" style="background: transparent; color: #86efac; border: none; cursor: pointer; padding: 6px 10px; font-size: 0.8rem;">Out</button>
            </div>
            <button id="heat-btn" onclick="window.currentFirewallMap.toggleHeatmap()" class="glass-card-sm" style="background: rgba(0,0,0,0.6); color: white; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; padding: 6px 10px; font-size: 0.8rem; display: flex; align-items: center; gap: 5px;">
                <i class="fa-solid fa-fire"></i>
            </button>
        `;
        document.getElementById(this.containerId).appendChild(controlDiv);

        // Bind logic
        controlDiv.querySelector('#heat-btn').onclick = () => this.toggleHeatmap();
    }

    setFilter(mode) {
        this.filterMode = mode;

        // Update UI
        const container = document.getElementById(this.containerId + '-controls');
        if (container) {
            const buttons = container.querySelectorAll('button[data-filter]');
            buttons.forEach(btn => {
                if (btn.dataset.filter === mode) {
                    btn.style.background = 'rgba(56, 189, 248, 0.6)';
                    btn.style.color = 'white';
                } else {
                    btn.style.background = 'transparent';
                    btn.style.color = btn.dataset.filter === 'inbound' ? '#fca5a5' : (btn.dataset.filter === 'outbound' ? '#86efac' : 'white');
                }
            });
        }

        // Re-render
        this.render(JSON.stringify(this.activeMapConnections));
    }

    toggleHeatmap() {
        this.showHeatmap = !this.showHeatmap;
        const btn = document.getElementById(this.containerId + '-controls').querySelector('#heat-btn');
        if (this.showHeatmap) {
            btn.style.background = 'rgba(239, 68, 68, 0.6)';
            btn.style.borderColor = '#ef4444';
        } else {
            btn.style.background = 'rgba(0,0,0,0.6)';
            btn.style.borderColor = 'rgba(255,255,255,0.2)';
        }
        // Re-render
        this.render(JSON.stringify(this.activeMapConnections));
    }

    updateHeatmap(filteredConns) {
        if (!L.heatLayer) return;

        const connsToUse = filteredConns || this.activeMapConnections;
        const heatPoints = [];
        connsToUse.forEach(conn => {
            const cached = localStorage.getItem('geoip_' + conn.remote_ip);
            if (cached) {
                const geo = JSON.parse(cached);
                if (geo.lat) {
                    // Intensity based on connections
                    const intensity = Math.min(1.0, (conn.inbound + conn.outbound) / 100);
                    heatPoints.push([geo.lat, geo.lon, intensity * 500]); // Scale
                }
            } else {
                // Trigger fetch (silent)
                this.geoQueue.unshift({ ip: conn.remote_ip, callback: () => this.updateHeatmap(connsToUse) });
            }
        });

        if (this.heatLayer) this.mapInstance.removeLayer(this.heatLayer);

        this.heatLayer = L.heatLayer(heatPoints, {
            radius: 25,
            blur: 15,
            maxZoom: 17,
            gradient: { 0.4: 'blue', 0.65: 'lime', 1: 'red' }
        }).addTo(this.mapInstance);

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
                        const geoData = {
                            lat: data.lat,
                            lon: data.lon,
                            city: data.city,
                            country: data.country,
                            countryCode: data.countryCode // Store country code
                        };
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

        const isInbound = conn.inbound > conn.outbound;
        const colorClass = isInbound ? 'pulse-marker-red' : 'pulse-marker-green';
        const typeColor = isInbound ? '#ef4444' : '#22c55e';
        const type = isInbound ? 'Entrante' : 'Saliente';

        // Flag Helper
        const getFlagEmoji = (countryCode) => {
            if (!countryCode) return '🏳️';
            return countryCode.toUpperCase().replace(/./g, char =>
                String.fromCodePoint(char.charCodeAt(0) + 127397)
            );
        };
        const flag = getFlagEmoji(geoData.countryCode);

        // Pulsing Marker Icon
        const pulseIcon = L.divIcon({
            className: colorClass,
            iconSize: [10, 10],
            iconAnchor: [5, 5] // Center
        });

        const marker = L.marker([geoData.lat, geoData.lon], { icon: pulseIcon }).addTo(this.mapInstance);

        marker.bindPopup(`
            <div style="font-family: 'Outfit', sans-serif; min-width: 150px;">
                <div style="font-size: 1.1rem; font-weight: 700; margin-bottom: 5px; display: flex; align-items: center; gap: 8px;">
                     ${flag} <span>${geoData.country || 'Unknown'}</span>
                </div>
                <div style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 8px;">
                    ${geoData.city}, IP: <b>${conn.remote_ip}</b>
                </div>
                <div style="font-size: 0.8rem; background: rgba(255,255,255,0.05); padding: 6px; border-radius: 6px; border-left: 3px solid ${typeColor};">
                    <div>Tipo: <span style="color:${typeColor}; font-weight: 600;">${type}</span></div>
                    <div>In: ${conn.inbound} / Out: ${conn.outbound}</div>
                </div>
            </div>
        `);
        this.markers.push(marker);

        this.drawSingleLine(conn, geoData);
    }

    drawSingleLine(conn, remoteGeo) {
        if (!this.homeGeo || !this.homeGeo.lat) return;

        const hLat = parseFloat(this.homeGeo.lat);
        const hLon = parseFloat(this.homeGeo.lon);
        const rLat = parseFloat(remoteGeo.lat);
        const rLon = parseFloat(remoteGeo.lon);

        if (Math.abs(hLat - rLat) < 0.0001 && Math.abs(hLon - rLon) < 0.0001) return;

        // Validate coordinates to prevent NaN errors
        if (!isFinite(rLat) || !isFinite(rLon) || !isFinite(hLat) || !isFinite(hLon)) {
            console.warn('[NetworkMap] Invalid coordinates, skipping line:', { rLat, rLon, hLat, hLon });
            return;
        }

        const isInbound = conn.inbound > conn.outbound;
        const color = isInbound ? '#ef4444' : '#22c55e';
        const pulse = isInbound ? '#fca5a5' : '#86efac';

        // Dynamic Speed based on traffic
        const totalTraffic = (conn.inbound || 0) + (conn.outbound || 0);
        // Base delay 1500 (slow), min delay 300 (fast)
        const speed = Math.max(300, 1500 - (totalTraffic * 20));

        // Generate Curved Path (Bezier)
        const latlngs = this.getCurvedPath([rLat, rLon], [hLat, hLon], isInbound);

        try {
            // AntPath
            if (L.polyline.antPath) {
                const path = L.polyline.antPath(latlngs, {
                    "delay": speed,
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

// Documentation System
function closeDocDrawer() {
    const modal = document.getElementById('doc-modal');
    // Optional: Add closing class for animation, then remove active
    modal.classList.remove('active');
}
window.closeDocDrawer = closeDocDrawer;

function goBackToDockerSummary() {
    state.selectedDockerHostId = null;
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
    state.selectedFirewallHostId = null;
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

class DockerTopologyMap {
    constructor(containerId) {
        this.containerId = containerId;
        this.svg = null;
        this.width = 0;
        this.height = 400;
        this.nodes = [];
        this.links = [];
        this.initialized = false;
    }

    render(networksJSON, activeOnly = false, containersCache = [], server = null, engineType = 'docker') {
        this.server = server;
        this.engineType = engineType;
        const container = document.getElementById(this.containerId);
        if (!container) return;

        this.width = container.clientWidth || 800;

        let networks = [];
        try {
            networks = networksJSON ? JSON.parse(networksJSON) : [];
        } catch (e) {
            console.error('[DockerTopologyMap] Error parsing networks:', e);
            return;
        }

        // --- TOPOLOGY BUILDER ---
        const nodes = [];
        const links = [];
        const nodeMap = new Map();

        // 1. Internet Node
        const internetId = 'internet-node';
        nodes.push({ id: internetId, name: 'Internet', type: 'internet', color: '#ff4d4d' });
        nodeMap.set(internetId, 0);

        // 2. Process Networks and Containers
        networks.forEach(net => {
            const netId = `net-${net.Id}`;
            if (!nodeMap.has(netId)) {
                // Avoid connecting 'none' and 'host' to internet
                const isInternalOnly = net.Name === 'none' || net.Name === 'host' || net.Internal;

                nodes.push({
                    id: netId,
                    name: net.Name,
                    type: 'network',
                    color: net.Name === 'none' || net.Name === 'host' ? '#94a3b8' : '#38bdf8',
                    isSystem: net.Name === 'none' || net.Name === 'host'
                });
                nodeMap.set(netId, nodes.length - 1);

                if (!isInternalOnly) {
                    links.push({ source: netId, target: internetId, type: 'external' });
                }
            }

            const containers = net.Containers || {};
            Object.keys(containers).forEach(cid => {
                const c = containers[cid];
                const cleanName = c.Name.replace(/^\//, '').split('.')[0]; // Shorten name

                const cacheEntry = (containersCache || []).find(cc => cc.name === cleanName || cc.id === cid || cc.name === c.Name.replace(/^\//, '')) || null;

                // Filter by active status if requested
                if (activeOnly && cacheEntry) {
                    if ((cacheEntry.state || '').toLowerCase() !== 'running') {
                        return; // Skip inactive
                    }
                }

                const cnodeId = `c-${cid}`;

                if (!nodeMap.has(cnodeId)) {
                    const ip = c.IPv4Address || c.IPv6Address || 'Sin IP';
                    nodes.push({
                        id: cnodeId,
                        name: cleanName,
                        image: cleanName,
                        type: 'container',
                        color: '#4ade80',
                        ip: ip.split('/')[0], // Remove subnet mask
                        original: cacheEntry // Store for metrics
                    });
                    nodeMap.set(cnodeId, nodes.length - 1);
                }

                if (typeof this.server !== 'undefined' && this.server) {
                    // Add logic to register click handler in draw()
                }

                links.push({ source: cnodeId, target: netId, type: 'internal' });
            });
        });

        this.nodes = nodes;
        this.links = links;

        this.draw();
    }

    draw() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        // In horizontal layout, height is determined by the densest column
        const maxNodesInCol = Math.max(
            this.nodes.filter(n => n.type === 'internet').length,
            this.nodes.filter(n => n.type === 'network').length,
            this.nodes.filter(n => n.type === 'container').length
        );
        this.height = Math.max(400, maxNodesInCol * 80);

        container.innerHTML = `
            <svg width="100%" height="${this.height}" style="background: transparent; overflow: visible;">
                <defs>
                    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="4" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                    <style>
                        @keyframes pulse {
                            0% { filter: drop-shadow(0 0 2px rgba(255, 77, 77, 0.5)); }
                            50% { filter: drop-shadow(0 0 10px rgba(255, 77, 77, 0.8)); }
                            100% { filter: drop-shadow(0 0 2px rgba(255, 77, 77, 0.5)); }
                        }
                        .internet-pulse { animation: pulse 2s infinite ease-in-out; }
                        .node-group:hover circle { filter: brightness(1.2) drop-shadow(0 0 15px currentColor); }
                    </style>
                </defs>
                <g id="links-group"></g>
                <g id="nodes-group"></g>
            </svg>
        `;

        const linksGroup = container.querySelector('#links-group');
        const nodesGroup = container.querySelector('#nodes-group');

        const centerY = this.height / 2;

        // 1. Horizontal Hierarchical Spread (Left to Right)
        // Column 1: Internet (Left)
        const internetNode = this.nodes.find(n => n.type === 'internet');
        if (internetNode) {
            internetNode.x = Math.max(80, this.width * 0.1);
            internetNode.y = centerY;
        }

        // Column 2: Networks (Middle)
        const networkNodes = this.nodes.filter(n => n.type === 'network');
        const netYSpacing = Math.min(this.height / (networkNodes.length + 1), 180);
        const netStartY = centerY - ((networkNodes.length - 1) * netYSpacing) / 2;

        networkNodes.forEach((node, i) => {
            node.x = this.width * 0.4;
            node.y = netStartY + (i * netYSpacing);
        });

        // Column 3: Containers (Right)
        const containerNodes = this.nodes.filter(n => n.type === 'container');
        const contYSpacing = Math.min(this.height / (containerNodes.length + 1), 70);
        const contStartY = centerY - ((containerNodes.length - 1) * contYSpacing) / 2;

        containerNodes.forEach((node, i) => {
            node.x = Math.min(this.width - 80, this.width * 0.85);
            node.y = contStartY + (i * contYSpacing);

            // Try to align containers slightly closer to their connected network on Y axis
            const connectedLinks = this.links.filter(l => l.source === node.id);
            if (connectedLinks.length > 0) {
                const targetNetCount = connectedLinks.length;
                let sumY = 0;
                connectedLinks.forEach(l => {
                    const net = this.nodes.find(n => n.id === l.target);
                    if (net) sumY += net.y;
                });
                // Blend hierarchical Y with network Y for a smoother look
                const targetY = sumY / targetNetCount;
                node.y = (node.y * 0.4) + (targetY * 0.6);
            }
        });

        // 2. Render Links
        this.links.forEach(link => {
            const source = this.nodes.find(n => n.id === link.source);
            const target = this.nodes.find(n => n.id === link.target);
            if (source && target) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', source.x);
                line.setAttribute('y1', source.y);
                line.setAttribute('x2', target.x);
                line.setAttribute('y2', target.y);

                if (link.type === 'external') {
                    line.setAttribute('stroke', 'rgba(255,77,77,0.5)');
                    line.setAttribute('stroke-width', '2.5');
                    line.setAttribute('stroke-dasharray', '8,8');
                    const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                    anim.setAttribute('attributeName', 'stroke-dashoffset');
                    anim.setAttribute('from', '32');
                    anim.setAttribute('to', '0');
                    anim.setAttribute('dur', '1.2s');
                    anim.setAttribute('repeatCount', 'indefinite');
                    line.appendChild(anim);
                } else {
                    line.setAttribute('stroke', source.color || 'rgba(255,255,255,0.2)');
                    line.setAttribute('stroke-width', '1.5');
                    line.setAttribute('stroke-dasharray', '4,4');
                    const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                    anim.setAttribute('attributeName', 'stroke-dashoffset');
                    anim.setAttribute('from', '16');
                    anim.setAttribute('to', '0');
                    anim.setAttribute('dur', '3s');
                    anim.setAttribute('repeatCount', 'indefinite');
                    line.appendChild(anim);
                }
                linksGroup.appendChild(line);
            }
        });

        // 3. Render Nodes
        this.nodes.forEach(node => {
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('class', 'node-group');
            group.style.cursor = 'pointer';

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', node.x);
            circle.setAttribute('cy', node.y);
            circle.setAttribute('r', node.type === 'container' ? 16 : 28);
            circle.setAttribute('fill', node.color);
            circle.setAttribute('fill-opacity', '0.2');
            circle.setAttribute('stroke', node.color);
            circle.setAttribute('stroke-width', '3');
            circle.style.transition = 'all 0.3s ease';
            if (node.type === 'internet') circle.classList.add('internet-pulse');

            const foSize = node.type === 'container' ? 28 : 42;
            const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
            fo.setAttribute('x', node.x - foSize / 2);
            fo.setAttribute('y', node.y - foSize / 2);
            fo.setAttribute('width', foSize);
            fo.setAttribute('height', foSize);
            fo.style.pointerEvents = 'none';

            let iconClass = 'fa-solid fa-box';
            if (node.type === 'internet') iconClass = 'fa-solid fa-globe';
            else if (node.type === 'network' || node.isSystem) iconClass = 'fa-solid fa-network-wired';

            fo.innerHTML = `
                <div xmlns="http://www.w3.org/1999/xhtml" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: ${node.color}; font-size: ${node.type === 'container' ? '16px' : '22px'}; text-shadow: 0 0 10px ${node.color}cc;">
                    <i class="${iconClass}"></i>
                </div>
            `;

            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', node.x);
            label.setAttribute('y', node.y + (node.type === 'container' ? 40 : 55));
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('fill', 'var(--text-primary)');
            label.setAttribute('font-size', '12px');
            label.setAttribute('font-weight', '700');
            label.style.textShadow = '0 2px 4px rgba(0,0,0,0.8)';
            label.textContent = node.name;

            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = node.type === 'container' ? `${node.name}\nIP: ${node.ip}` : node.name;
            group.appendChild(title);

            group.appendChild(circle);
            group.appendChild(fo);
            group.appendChild(label);
            nodesGroup.appendChild(group);

            if (node.type === 'container') {
                group.onclick = (e) => {
                    e.stopPropagation();
                    if (this.server) {
                        const original = node.original || {};
                        // Log API needs either the full container hash or the container name.
                        // node.id has prefix 'c-', node.name is the shortened name.
                        // original.name is the full name from database.
                        const containerId = original.name || node.id.replace('c-', '');

                        // Backend expects generic_server.id. 
                        // host.server_id is the generic_server.id for Docker/Podman hosts.
                        const sid = this.server.server_id || this.server.id;

                        // Parse CPU/Mem if original data is available, otherwise 0
                        const cpu = original.cpu_usage || 0;
                        const mem = original.memory_usage || 0;
                        showContainerLogs(this.engineType, sid, containerId, node.name, cpu, mem);
                    }
                };
            }

            group.addEventListener('mouseenter', () => {
                circle.setAttribute('fill-opacity', '0.5');
                circle.setAttribute('stroke-width', '4');
            });
            group.addEventListener('mouseleave', () => {
                circle.setAttribute('fill-opacity', '0.2');
                circle.setAttribute('stroke-width', '3');
            });
        });
    }
}

window.DockerTopologyMap = DockerTopologyMap;

class KVMTopologyMap {
    constructor(containerId) {
        this.containerId = containerId;
        this.svg = null;
        this.width = 0;
        this.height = 400;
        this.nodes = [];
        this.links = [];
    }

    render(bridgesJSON, vms = []) {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        this.width = container.clientWidth || 800;

        let bridges = [];
        try {
            bridges = (bridgesJSON && bridgesJSON !== "null") ? JSON.parse(bridgesJSON) : [];
            if (!Array.isArray(bridges)) bridges = [];
        } catch (e) {
            console.error('[KVMTopologyMap] Error parsing bridges:', e);
            bridges = [];
        }

        const nodes = [];
        const links = [];
        const nodeMap = new Map();

        // 1. Internet Node
        const internetId = 'internet-node';
        nodes.push({ id: internetId, name: 'Internet', type: 'internet', color: '#ff4d4d' });
        nodeMap.set(internetId, 0);

        // 2. Bridges
        bridges.forEach(br => {
            const brId = `br-${br.name}`;
            if (!nodeMap.has(brId)) {
                nodes.push({
                    id: brId,
                    name: br.name,
                    ip: br.ip || 'No IP',
                    type: 'network',
                    color: '#38bdf8'
                });
                nodeMap.set(brId, nodes.length - 1);
                links.push({ source: brId, target: internetId, type: 'external' });
            }
        });

        // 3. VMs
        vms.forEach(vm => {
            const vmNodeId = `vm-${vm.id}`;
            let networkData = [];
            try {
                networkData = (vm.network_data && vm.network_data !== "null") ? JSON.parse(vm.network_data) : [];
                if (!Array.isArray(networkData)) networkData = [];
            } catch (e) {
                console.error("Error parsing VM network data", e);
                networkData = [];
            }

            if (!nodeMap.has(vmNodeId)) {
                nodes.push({
                    id: vmNodeId,
                    name: vm.name,
                    type: 'container',
                    color: vm.state.toLowerCase() === 'running' ? '#4ade80' : '#94a3b8',
                    ip: vm.guest_ips ? vm.guest_ips.split(' ')[0] : 'Sin IP'
                });
                nodeMap.set(vmNodeId, nodes.length - 1);

                networkData.forEach(net => {
                    const brId = `br-${net.bridge}`;
                    if (nodeMap.has(brId)) {
                        links.push({ source: vmNodeId, target: brId, type: 'internal' });
                    }
                });
            }
        });

        this.nodes = nodes;
        this.links = links;

        this.draw();
    }

    draw() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        const maxNodesInCol = Math.max(
            this.nodes.filter(n => n.type === 'internet').length,
            this.nodes.filter(n => n.type === 'network').length,
            this.nodes.filter(n => n.type === 'container').length
        );
        this.height = Math.max(300, maxNodesInCol * 70);

        container.innerHTML = `
            <div style="margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between; padding: 0 5px;">
                <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-diagram-project" style="color: var(--accent-color);"></i>
                    Mapa de Red KVM
                </div>
                <div style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.7;">
                    Puentes de Host & Máquinas Virtuales
                </div>
            </div>
            <div class="topology-map-wrapper" style="background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border); border-radius: 12px; overflow: hidden; position: relative;">
                <svg width="100%" height="${this.height}" style="background: transparent; overflow: visible;">
                    <defs>
                        <filter id="kvm-glow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="4" result="blur" />
                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                    </defs>
                    <g id="kvm-links-group"></g>
                    <g id="kvm-nodes-group"></g>
                </svg>
            </div>
        `;

        const linksGroup = container.querySelector('#kvm-links-group');
        const nodesGroup = container.querySelector('#kvm-nodes-group');
        const centerY = this.height / 2;

        const internetNode = this.nodes.find(n => n.type === 'internet');
        if (internetNode) {
            internetNode.x = 60;
            internetNode.y = centerY;
        }

        const networkNodes = this.nodes.filter(n => n.type === 'network');
        const netYSpacing = networkNodes.length > 1 ? (this.height - 100) / (networkNodes.length - 1) : 0;
        const netStartY = networkNodes.length > 1 ? 50 : centerY;
        networkNodes.forEach((node, i) => {
            node.x = this.width * 0.4;
            node.y = netStartY + (i * netYSpacing);
        });

        const containerNodes = this.nodes.filter(n => n.type === 'container');
        const contYSpacing = containerNodes.length > 1 ? (this.height - 60) / (containerNodes.length - 1) : 0;
        const contStartY = containerNodes.length > 1 ? 30 : centerY;
        containerNodes.forEach((node, i) => {
            node.x = this.width - 80;
            node.y = contStartY + (i * contYSpacing);
        });

        this.links.forEach(link => {
            const source = this.nodes.find(n => n.id === link.source);
            const target = this.nodes.find(n => n.id === link.target);
            if (source && target) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', source.x);
                line.setAttribute('y1', source.y);
                line.setAttribute('x2', target.x);
                line.setAttribute('y2', target.y);
                line.setAttribute('stroke', link.type === 'external' ? 'rgba(255,100,100,0.5)' : 'rgba(56,189,248,0.4)');
                line.setAttribute('stroke-width', link.type === 'external' ? '2' : '1.5');
                line.setAttribute('stroke-dasharray', '5,5');

                const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                anim.setAttribute('attributeName', 'stroke-dashoffset');
                anim.setAttribute('from', '20');
                anim.setAttribute('to', '0');
                anim.setAttribute('dur', '2s');
                anim.setAttribute('repeatCount', 'indefinite');
                line.appendChild(anim);

                linksGroup.appendChild(line);
            }
        });

        this.nodes.forEach(node => {
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.style.cursor = 'pointer';
            group.setAttribute('data-node-id', node.id);

            // Tooltip (Hover)
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = `${node.name}\nIP: ${node.ip || 'N/A'}`;
            group.appendChild(title);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', node.x);
            circle.setAttribute('cy', node.y);
            circle.setAttribute('r', node.type === 'container' ? 14 : 22);
            circle.setAttribute('fill', 'rgba(0,0,0,0.6)');
            circle.setAttribute('stroke', node.color);
            circle.setAttribute('stroke-width', '2');

            // IP Label (Initially hidden, shown on click)
            const ipLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            ipLabel.setAttribute('x', node.x);
            ipLabel.setAttribute('y', node.y - (node.type === 'container' ? 20 : 30));
            ipLabel.setAttribute('text-anchor', 'middle');
            ipLabel.setAttribute('fill', '#facc15'); // Contrast color
            ipLabel.setAttribute('font-size', '10px');
            ipLabel.setAttribute('font-weight', 'bold');
            ipLabel.style.display = 'none';
            ipLabel.style.pointerEvents = 'none';
            ipLabel.textContent = node.ip || '';

            const foSize = node.type === 'container' ? 24 : 32;
            const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
            fo.setAttribute('x', node.x - foSize / 2);
            fo.setAttribute('y', node.y - foSize / 2);
            fo.setAttribute('width', foSize);
            fo.setAttribute('height', foSize);
            fo.style.pointerEvents = 'none';

            let icon = 'fa-solid fa-desktop';
            if (node.type === 'internet') icon = 'fa-solid fa-globe';
            else if (node.type === 'network') icon = 'fa-solid fa-bridge';

            fo.innerHTML = `
                <div xmlns="http://www.w3.org/1999/xhtml" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: ${node.color}; font-size: ${foSize * 0.6}px;">
                    <i class="${icon}"></i>
                </div>
            `;

            const nameLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            nameLabel.setAttribute('x', node.x);
            nameLabel.setAttribute('y', node.y + (node.type === 'container' ? 30 : 40));
            nameLabel.setAttribute('text-anchor', 'middle');
            nameLabel.setAttribute('fill', 'var(--text-primary)');
            nameLabel.setAttribute('font-size', '10px');
            nameLabel.style.pointerEvents = 'none';
            nameLabel.textContent = node.name;

            // Click interaction
            group.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = ipLabel.style.display !== 'none';
                ipLabel.style.display = isVisible ? 'none' : 'block';

                // Optional: Auto-hide after 5 seconds
                if (!isVisible) {
                    setTimeout(() => { ipLabel.style.display = 'none'; }, 5000);
                }
            });

            group.appendChild(circle);
            group.appendChild(fo);
            group.appendChild(nameLabel);
            group.appendChild(ipLabel);
            nodesGroup.appendChild(group);
        });
    }
}

window.KVMTopologyMap = KVMTopologyMap;

class KubernetesTopologyMap {
    constructor(containerId) {
        this.containerId = containerId;
        this.width = 800;
        this.height = 500;
        this.nodes = [];
        this.links = [];
        this.zoomLevel = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.lastNodeIds = new Set();
        this.lastPodIds = new Set();
    }

    render(topologyJSON) {
        // ... (Existing render logic, largely unused now but kept for compatibility if needed) ...
        const container = document.getElementById(this.containerId);
        if (!container) return;
        this.width = container.clientWidth || 800;
        let topology = null;
        try {
            topology = topologyJSON ? JSON.parse(topologyJSON) : { nodes: [], links: [] };
        } catch (e) { console.error('[KubernetesTopologyMap] Error parsing topology:', e); return; }
        this.nodes = topology.nodes || [];
        this.links = topology.links || [];
        if (this.nodes.length === 0) {
            container.innerHTML = `<div style="padding:20px; text-align:center;">No active services detected</div>`;
            return;
        }
        this.draw();
    }

    renderFromData(nodesData, podsData, server) {
        this.server = server;
        this.clusterStatus = server ? (server.status || 'online') : 'online';
        const container = document.getElementById(this.containerId);
        if (!container) return;
        this.width = container.clientWidth || 800;

        // Change Detection: Calculate IDs for new frame
        const currentNodeIds = new Set(nodesData.map(n => n.id));
        const currentPodIds = new Set(podsData.map(p => p.id));

        // 1. Check if structure changed (Nodes count/IDs diff)
        let structureChanged = false;
        if (currentNodeIds.size !== this.lastNodeIds.size || currentPodIds.size !== this.lastPodIds.size) {
            structureChanged = true;
        } else {
            // Deep check IDs
            for (let id of currentNodeIds) if (!this.lastNodeIds.has(id)) { structureChanged = true; break; }
            if (!structureChanged) {
                for (let id of currentPodIds) if (!this.lastPodIds.has(id)) { structureChanged = true; break; }
            }
        }

        if (!structureChanged && this.nodes.length > 0) {
            // OPTIONAL: Update colors in-place here if needed, but for now we just return to keep layout fixed.
            // We can iterate this.nodes and update colors if status changed, 
            // but the user specific request is "fixed layout", so skipping update is the safest first step.
            // console.log('[K8s Map] Structure unchanged, skipping redraw.');
            return;
        }


        // Structure changed, update cache and redraw
        this.lastNodeIds = currentNodeIds;
        this.lastPodIds = currentPodIds;

        this.nodes = [];
        this.links = [];

        // 1. Root Node (Internet/Cluster)
        const clusterColor = this.clusterStatus === 'online' ? '#f472b6' : '#ef4444';
        this.nodes.push({
            id: 'internet',
            name: 'Cluster API',
            type: 'internet',
            status: this.clusterStatus === 'online' ? 'active' : 'stopped',
            color: clusterColor
        });

        // 2. Nodes (as Services/Hosts layer)
        const nodeIds = new Set();
        const isClusterOffline = this.clusterStatus !== 'online';
        nodesData.forEach(node => {
            const nodeId = 'node-' + node.id;
            nodeIds.add(node.id);

            // If cluster is offline, nodes are red
            let nodeColor = '#ef4444'; // Default red for offline
            if (!isClusterOffline) {
                nodeColor = (node.status && node.status.toLowerCase() === 'ready') ? '#818cf8' : '#ef4444';
            }

            this.nodes.push({
                id: nodeId,
                name: node.hostname,
                type: 'service', // Reusing 'service' style for K8s Nodes
                status: (node.status && node.status.toLowerCase() === 'ready') ? 'active' : 'stopped',
                color: nodeColor,
                original: node
            });

            // Link Internet -> Node
            this.links.push({
                source: 'internet',
                target: nodeId
            });
        });

        // 3. Pods
        // 3. Pods
        podsData.forEach(pod => {
            // Only show pods belonging to these nodes
            if (!nodeIds.has(pod.node_id)) return;

            const podId = 'pod-' + pod.id;
            let podColor = '#94a3b8'; // Default grey

            // If cluster is offline, all pods are red
            if (this.clusterStatus !== 'online') {
                podColor = '#ef4444'; // Red for offline cluster
            } else if (pod.state === 'Running') {
                podColor = '#4ade80'; // Green
            } else if (pod.state === 'Pending') {
                podColor = '#fbbf24'; // Yellow
            } else if (pod.state === 'Succeeded') {
                podColor = '#60a5fa'; // Blue
            } else if (pod.state === 'Failed') {
                podColor = '#ef4444'; // Red
            }

            this.nodes.push({
                id: podId,
                name: pod.name,
                type: 'pod',
                status: (pod.state === 'Running') ? 'active' : 'stopped',
                color: podColor,
                original: pod
            });

            // Link Node -> Pod
            this.links.push({
                source: 'node-' + pod.node_id,
                target: podId
            });
        });

        // --- DIAGNOSTIC START ---
        if (this.nodes.length === 0) {
            console.warn('[KubernetesTopologyMap] No nodes found after data processing.');
            container.innerHTML = `
                <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #ef4444; background: rgba(239, 68, 68, 0.05); border: 1px dashed rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 20px;">
                    <i class="fa-solid fa-bug" style="font-size: 2rem; margin-bottom: 10px;"></i>
                    <div style="font-weight: 700;">Modo Diagnóstico: Mapa Vacío</div>
                    <div style="font-size: 0.8rem; opacity: 0.9; margin-top: 5px; text-align: center;">
                        <div>Nodos recibidos: ${nodesData ? nodesData.length : 'NULL'}</div>
                        <div>Pods recibidos: ${podsData ? podsData.length : 'NULL'}</div>
                        <div>Nodos procesados: 0</div>
                    </div>
                </div>`;
            return;
        }
        // --- DIAGNOSTIC END ---

        this.draw();
    }

    draw() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        try {
            // In horizontal layout, height is determined by the densest column
            const podCount = this.nodes.filter(n => n.type === 'pod').length;
            const serviceCount = this.nodes.filter(n => n.type === 'service').length;

            // Calculate required height for each column with fixed spacing
            const podHeightRequired = podCount * 50;
            const serviceHeightRequired = serviceCount * 120;

            // Use the maximum required height plus some padding
            this.height = Math.max(500, Math.max(podHeightRequired, serviceHeightRequired) + 100);

            // Container for Map + Controls
            container.style.position = 'relative';
            container.innerHTML = `
                <svg id="k8s-map-svg" width="100%" height="${this.height}" style="background: transparent; display: block; overflow: visible;">
                    <defs>
                        <filter id="k8s-glow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="4" result="blur" />
                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                    </defs>
                    <g id="k8s-zoom-layer" transform="scale(${this.zoomLevel}) translate(${this.panX}, ${this.panY})">
                        <g id="k8s-links-group"></g>
                        <g id="k8s-nodes-group"></g>
                    </g>
                </svg>

                <!-- Zoom Controls -->
                <div style="position: absolute; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 5px; background: rgba(0,0,0,0.6); padding: 5px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
                    <button id="k8s-zoom-in" style="width: 30px; height: 30px; border: none; background: rgba(255,255,255,0.1); color: white; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-plus"></i></button>
                    <button id="k8s-zoom-reset" style="width: 30px; height: 30px; border: none; background: rgba(255,255,255,0.1); color: white; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-compress"></i></button>
                    <button id="k8s-zoom-out" style="width: 30px; height: 30px; border: none; background: rgba(255,255,255,0.1); color: white; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-minus"></i></button>
                </div>
            `;

            // Attach Zoom Events
            container.querySelector('#k8s-zoom-in').onclick = () => this.zoom(0.2);
            container.querySelector('#k8s-zoom-out').onclick = () => this.zoom(-0.2);
            container.querySelector('#k8s-zoom-reset').onclick = () => this.resetZoom();

            const linksGroup = container.querySelector('#k8s-links-group');
            const nodesGroup = container.querySelector('#k8s-nodes-group');

            if (!linksGroup || !nodesGroup) {
                throw new Error("Failed to create SVG groups");
            }

            const centerY = this.height / 2;

            // Position nodes hierarchically (Horizontal)
            // Column 1: Internet (Left)
            const internetNode = this.nodes.find(n => n.type === 'internet');
            if (internetNode) {
                internetNode.x = Math.max(80, this.width * 0.1);
                internetNode.y = centerY;
            }

            // Column 2: Services (Middle)
            const serviceNodes = this.nodes.filter(n => n.type === 'service');
            const svcYSpacing = Math.min(this.height / (serviceNodes.length + 1), 120);
            const svcStartY = centerY - ((serviceNodes.length - 1) * svcYSpacing) / 2;

            serviceNodes.forEach((node, i) => {
                node.x = this.width * 0.4;
                node.y = svcStartY + (i * svcYSpacing);
            });

            // Column 3: Pods (Right)
            // Sort pods by their parent service's Y position to minimize line overlapping
            let podNodes = this.nodes.filter(n => n.type === 'pod');

            // Map pods to their parent service index/y
            const getParentY = (podNode) => {
                const link = this.links.find(l => l.target === podNode.id);
                if (link) {
                    const parent = this.nodes.find(n => n.id === link.source);
                    return parent ? parent.y : 999999;
                }
                return 999999;
            };

            podNodes.sort((a, b) => getParentY(a) - getParentY(b));

            const podYSpacing = Math.min(this.height / (podNodes.length + 1), 50);
            const podStartY = centerY - ((podNodes.length - 1) * podYSpacing) / 2;

            podNodes.forEach((node, i) => {
                node.x = Math.min(this.width - 80, this.width * 0.85);
                node.y = podStartY + (i * podYSpacing);
            });

            // Check if nodes are populated (Sanity Check)
            if (this.nodes.length === 0) {
                console.warn('[KubernetesTopologyMap] No nodes to draw');
                return;
            }

            // Render Links
            this.links.forEach(link => {
                const source = this.nodes.find(n => n.id === link.source);
                const target = this.nodes.find(n => n.id === link.target);
                if (source && target) {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

                    // Bezier Curve Logic: M startX startY C cp1X cp1Y, cp2X cp2Y, endX endY
                    // Control points pull horizontally
                    const cpOffset = Math.abs(target.x - source.x) * 0.5;
                    const d = `M ${source.x} ${source.y} C ${source.x + cpOffset} ${source.y}, ${target.x - cpOffset} ${target.y}, ${target.x} ${target.y}`;

                    path.setAttribute('d', d);
                    path.setAttribute('fill', 'none');

                    // Use target color for the line (e.g. Pod Status Color) or fallback
                    const strokeColor = target.color || 'rgba(255,255,255,0.2)';

                    path.setAttribute('stroke', strokeColor);
                    path.setAttribute('stroke-width', '1.5');
                    path.setAttribute('stroke-dasharray', '6,6');
                    path.style.opacity = '0.6';

                    // Add flow animation
                    const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                    anim.setAttribute('attributeName', 'stroke-dashoffset');
                    anim.setAttribute('from', '0');
                    anim.setAttribute('to', '12'); // Pod -> Node direction
                    anim.setAttribute('dur', '1.0s');
                    anim.setAttribute('repeatCount', 'indefinite');
                    path.appendChild(anim);

                    linksGroup.appendChild(path);
                } else {
                    console.warn('[KubernetesTopologyMap] Missing source/target for link:', link);
                }
            });

            // Render Nodes
            this.nodes.forEach(node => {
                const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                group.style.cursor = 'pointer';

                // Add click handler for Pods
                if (node.type === 'pod') {
                    group.onclick = (e) => {
                        e.stopPropagation();
                        if (this.server && node.original) {
                            // K8s server object is usually the GenericServer itself, so .id is correct.
                            const sid = this.server.id;
                            showPodLogs(sid, node.original.namespace, node.original.name, node.original.cpu_usage, node.original.memory_usage);
                        }
                    };
                }

                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', node.x);
                circle.setAttribute('cy', node.y);
                circle.setAttribute('r', node.type === 'pod' ? 14 : 24);
                circle.setAttribute('fill', node.color || '#94a3b8');
                circle.setAttribute('fill-opacity', '0.2');
                circle.setAttribute('stroke', node.color || '#94a3b8');
                circle.setAttribute('stroke-width', '2.5');
                circle.style.transition = 'all 0.3s ease';

                const foSize = node.type === 'pod' ? 24 : 36;
                const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
                fo.setAttribute('x', node.x - foSize / 2);
                fo.setAttribute('y', node.y - foSize / 2);
                fo.setAttribute('width', foSize);
                fo.setAttribute('height', foSize);
                fo.style.pointerEvents = 'none';

                let iconClass = 'fa-solid fa-cube';
                if (node.type === 'internet') iconClass = 'fa-solid fa-globe';
                else if (node.type === 'service') iconClass = 'fa-solid fa-link';

                fo.innerHTML = `
                    <div xmlns="http://www.w3.org/1999/xhtml" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: ${node.color}; font-size: ${node.type === 'pod' ? '14px' : '20px'};">
                        <i class="${iconClass}"></i>
                    </div>
                `;

                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', node.x);
                label.setAttribute('y', node.y + (node.type === 'pod' ? 35 : 50));
                label.setAttribute('text-anchor', 'middle');
                label.setAttribute('fill', 'var(--text-secondary)');
                label.setAttribute('font-size', '10px');
                label.setAttribute('font-weight', '600');
                label.textContent = node.name.length > 20 ? node.name.substring(0, 18) + '...' : node.name;

                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = `${node.name}\nType: ${node.type}\nNamespace: ${node.namespace || 'N/A'}\nIP: ${node.ip || 'N/A'}`;
                group.appendChild(title);

                group.appendChild(circle);
                group.appendChild(fo);
                group.appendChild(label);
                nodesGroup.appendChild(group);

                group.addEventListener('mouseenter', () => {
                    circle.setAttribute('fill-opacity', '0.5');
                    circle.setAttribute('stroke-width', '3.5');
                    circle.style.filter = `drop-shadow(0 0 8px ${node.color}aa)`;
                });
                group.addEventListener('mouseleave', () => {
                    circle.setAttribute('fill-opacity', '0.2');
                    circle.setAttribute('stroke-width', '2.5');
                    circle.style.filter = 'none';
                });
            });

        } catch (e) {
            console.error('[KubernetesTopologyMap] Rendering error:', e);
            container.innerHTML = `
                <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #ef4444; background: rgba(239, 68, 68, 0.05); border: 1px dashed rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 20px;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; margin-bottom: 10px;"></i>
                    <div style="font-weight: 700;">Error de Renderizado</div>
                    <div style="font-size: 0.8rem; opacity: 0.9; margin-top: 5px; text-align: center;">${e.message}</div>
                </div>`;
        }
    }

    zoom(delta) {
        this.zoomLevel = Math.max(0.2, this.zoomLevel + delta);
        this.updateTransform();
    }

    resetZoom() {
        this.zoomLevel = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.updateTransform();
    }

    updateTransform() {
        const layer = document.getElementById('k8s-zoom-layer');
        if (layer) {
            // Simple center zoom could be improved with better math, but basic scale is enough for now
            // We keep panX/Y at 0 for now as we don't have drag pan implemented yet (user didn't explicitly ask for drag, just zoom buttons)
            // But we add 'transform-origin: center' style via JS if needed, or just standard SVG scaling
            // SVG transform origin defaults to 0,0. Let's try to center if possible.
            // For now, standard scale relative to 0,0.
            layer.setAttribute('transform', `scale(${this.zoomLevel}) translate(${this.panX}, ${this.panY})`);

            // Adjust SVG height if zoomed out to avoid huge whitespace? Or keep it fixed?
            // Keeping fixed height container, user zooms/pans the content.
        }
    }
}

window.KubernetesTopologyMap = KubernetesTopologyMap;

window.toggleDockerMapDebug = function () {
    console.log('[DockerMap] Debug mode toggled');
};

window.toggleK8sMapDebug = function () {
    console.log('[K8sMap] Debug mode toggled');
};

let historyToolMap = null;

async function renderHistory() {
    // Ensure data is loaded
    if ((!state.allKVMHostsCache || state.allKVMHostsCache.length === 0) &&
        (!state.allProxmoxHostsCache || state.allProxmoxHostsCache.length === 0) &&
        (!state.allDockerHostsCache || state.allDockerHostsCache.length === 0) &&
        (!state.allPodmanHostsCache || state.allPodmanHostsCache.length === 0) &&
        (!state.allKubernetesHostsCache || state.allKubernetesHostsCache.length === 0) &&
        (!state.allNasHostsCache || state.allNasHostsCache.length === 0) &&
        (!state.allFirewallHostsCache || state.allFirewallHostsCache.length === 0)) {
        await preloadAllCaches();
    }

    // Initialize Metrics UI
    initHistoryMetrics();
    populateHistoryServers();

    const summaryGrid = document.getElementById('history-summary-grid');
    if (!summaryGrid) return;

    try {
        const response = await fetch('/api/history');
        if (!response.ok) throw new Error('Failed to fetch history');
        const history = await response.json();

        if (!history || history.length === 0) {
            summaryGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px; opacity: 0.5;">
                    <i class="fa-solid fa-check-circle" style="font-size: 3rem; margin-bottom: 1rem; color: #10b981;"></i>
                    <p>Sin actividad reciente.</p>
                </div>
            `;
            return;
        }

        // --- Calculate Stats ---
        const totalEvents = history.length;

        let criticalCount = 0;
        let warningCount = 0;
        const sourceCounts = {};

        history.forEach(e => {
            const s = e.severity.toLowerCase();
            if (s.includes('err') || s.includes('crit') || s.includes('fail')) criticalCount++;
            if (s.includes('warn')) warningCount++;

            // Normalize source?
            const src = e.source || 'Unknown';
            sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        });

        // Top Source
        let topSrcName = 'N/A';
        let topSrcCount = 0;
        Object.entries(sourceCounts).forEach(([name, count]) => {
            if (count > topSrcCount) {
                topSrcCount = count;
                topSrcName = name;
            }
        });

        // Clean source name
        if (topSrcName.includes('virtualization.kvm')) topSrcName = 'KVM';
        else if (topSrcName.includes('container')) topSrcName = 'Containers';
        else if (topSrcName.includes('storage')) topSrcName = 'Storage';

        // Last Event Time
        const lastTime = history[0] ? new Date(history[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';

        // --- Render Cards ---
        summaryGrid.innerHTML = `
            <!-- Total Events -->
            <div class="glass-panel" style="padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; display:flex; align-items:center; gap: 15px;">
                <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(56, 189, 248, 0.1); display:flex; align-items:center; justify-content:center; color: #38bdf8; font-size: 1.2rem;">
                    <i class="fa-solid fa-layer-group"></i>
                </div>
                <div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary); line-height: 1;">${totalEvents}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Eventos Totales</div>
                </div>
            </div>

            <!-- Critical -->
            <div class="glass-panel" style="padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; display:flex; align-items:center; gap: 15px;">
                <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(239, 68, 68, 0.1); display:flex; align-items:center; justify-content:center; color: #ef4444; font-size: 1.2rem;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                </div>
                <div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary); line-height: 1;">${criticalCount}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Críticos/Errores</div>
                </div>
            </div>

            <!-- Top Source -->
            <div class="glass-panel" style="padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; display:flex; align-items:center; gap: 15px;">
                <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(168, 85, 247, 0.1); display:flex; align-items:center; justify-content:center; color: #a855f7; font-size: 1.2rem;">
                    <i class="fa-solid fa-server"></i>
                </div>
                <div>
                    <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); line-height: 1.2;">${topSrcName}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Fuente Principal</div>
                </div>
            </div>

             <!-- Last Active -->
            <div class="glass-panel" style="padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; display:flex; align-items:center; gap: 15px;">
                <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(34, 197, 94, 0.1); display:flex; align-items:center; justify-content:center; color: #22c55e; font-size: 1.2rem;">
                    <i class="fa-regular fa-clock"></i>
                </div>
                <div>
                    <div style="font-size: 1.2rem; font-weight: 700; color: var(--text-primary); line-height: 1;">${lastTime}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Último Evento</div>
                </div>
            </div>
        `;

        // Update Map
        if (!historyToolMap) {
            historyToolMap = new NetworkMap('history-map');
        }

        // Extract IPs from metadata or message for the map
        const geoEvents = history.filter(e => {
            try {
                const meta = JSON.parse(e.metadata || '{}');
                return meta.ip || meta.remote_ip;
            } catch (ex) { return false; }
        }).map(e => {
            const meta = JSON.parse(e.metadata);
            return {
                remote_ip: meta.ip || meta.remote_ip,
                message: e.message
            };
        });

        if (geoEvents.length > 0) {
            historyToolMap.render(JSON.stringify(geoEvents));
        } else {
            // Default render to show the map
            historyToolMap.render('[]');
        }

    } catch (error) {
        console.error('[History] Error rendering history:', error);
        timelineContainer.innerHTML = `<div class="error-msg">Error cargando historial: ${error.message}</div>`;
    }
}


window.renderHistory = renderHistory;

// History Metrics Logic
let historyMetricsInitialized = false;
let cpuChart = null;
let ramChart = null;
let netChart = null;
let diskChart = null;
let diskIOChart = null;
let tempChart = null;
let uptimeChart = null;

// Auto-refresh state
let autoRefreshEnabled = false;
let autoRefreshInterval = 60; // seconds
let autoRefreshTimer = null;
let refreshCountdownTimer = null;
let nextRefreshTime = null;

// =======================
// HISTORY METRICS TOOL
// =======================

// ========================================
// THRESHOLDS MANAGEMENT SYSTEM
// ========================================

// Default thresholds for visual alerts
const DEFAULT_THRESHOLDS = {
    cpu: { warning: 70, critical: 85 },
    memory: { warning: 80, critical: 90 },
    disk: { warning: 75, critical: 85 },
    network: { warning: 80, critical: 95 },
    diskio: { warning: 100, critical: 200 },  // MB/s
    temperature: { warning: 60, critical: 80 }  // °C
};

// Load thresholds from localStorage or use defaults
function loadThresholds() {
    try {
        const stored = localStorage.getItem('history-thresholds');
        return stored ? JSON.parse(stored) : JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
    } catch (e) {
        console.error('Error loading thresholds:', e);
        return JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
    }
}

// Save thresholds to localStorage
function saveThresholds(thresholds) {
    try {
        localStorage.setItem('history-thresholds', JSON.stringify(thresholds));
    } catch (e) {
        console.error('Error saving thresholds:', e);
    }
}

// Current thresholds in use
let currentThresholds = loadThresholds();

// Generate Chart.js annotation configuration for thresholds
function getThresholdAnnotations(metricType, max = 100) {
    const thresholds = currentThresholds[metricType];
    if (!thresholds) return {};

    const isDiskIO = metricType === 'diskio';
    const unit = isDiskIO ? ' MB/s' : '%';

    return {
        annotations: {
            normalZone: {
                type: 'box',
                yMin: 0,
                yMax: thresholds.warning,
                backgroundColor: 'rgba(34, 197, 94, 0.05)',
                borderWidth: 0,
                z: 0
            },
            warningZone: {
                type: 'box',
                yMin: thresholds.warning,
                yMax: thresholds.critical,
                backgroundColor: 'rgba(245, 158, 11, 0.05)',
                borderWidth: 0,
                z: 0
            },
            criticalZone: {
                type: 'box',
                yMin: thresholds.critical,
                yMax: max,
                backgroundColor: 'rgba(239, 68, 68, 0.05)',
                borderWidth: 0,
                z: 0
            },
            warningLine: {
                type: 'line',
                yMin: thresholds.warning,
                yMax: thresholds.warning,
                borderColor: '#f59e0b',
                borderWidth: 2,
                borderDash: [5, 5],
                z: 1,
                label: {
                    content: `Warning: ${thresholds.warning}${unit}`,
                    enabled: true,
                    position: 'end',
                    backgroundColor: 'rgba(245, 158, 11, 0.9)',
                    color: '#fff',
                    font: { size: 10, weight: 'bold' },
                    padding: 4
                }
            },
            criticalLine: {
                type: 'line',
                yMin: thresholds.critical,
                yMax: thresholds.critical,
                borderColor: '#ef4444',
                borderWidth: 2,
                borderDash: [5, 5],
                z: 1,
                label: {
                    content: `Critical: ${thresholds.critical}${unit}`,
                    enabled: true,
                    position: 'end',
                    backgroundColor: 'rgba(239, 68, 68, 0.9)',
                    color: '#fff',
                    font: { size: 10, weight: 'bold' },
                    padding: 4
                }
            }
        }
    };
}

// Create threshold input HTML for the config modal
function createThresholdInput(key, label, unit) {
    const thresh = currentThresholds[key];
    const maxValue = key === 'diskio' ? 1000 : 100;
    return `
            <div class="glass-panel" style="padding: 15px; background: rgba(0,0,0,0.3);">
                <h4 style="margin: 0 0 10px 0; color: #e2e8f0; font-size: 1rem;">${label}</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div>
                        <label style="font-size: 0.85rem; color: #94a3b8; display: block; margin-bottom: 5px;">
                            <i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b;"></i> Warning (${unit})
                        </label>
                        <input type="number" id="thresh-${key}-warning" class="glass-input" 
                               value="${thresh.warning}" min="0" max="${maxValue}" step="1">
                    </div>
                    <div>
                        <label style="font-size: 0.85rem; color: #94a3b8; display: block; margin-bottom: 5px;">
                            <i class="fa-solid fa-circle-exclamation" style="color: #ef4444;"></i> Critical (${unit})
                        </label>
                        <input type="number" id="thresh-${key}-critical" class="glass-input" 
                               value="${thresh.critical}" min="0" max="${maxValue}" step="1">
                    </div>
                </div>
            </div>
        `;
}

// Show thresholds configuration modal
function showThresholdsConfigModal() {
    // Close any existing modal
    closeThresholdsModal();

    const modalHTML = `
            <div id="thresholds-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000; backdrop-filter: blur(5px);">
                <div class="glass-panel" style="max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; padding: 25px; margin: 20px; border-radius: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h2 style="margin: 0; display: flex; align-items: center; gap: 10px; color: #e2e8f0; font-size: 1.25rem;">
                            <i class="fa-solid fa-sliders" style="color: var(--accent-color);"></i> 
                            Configurar Umbrales
                        </h2>
                        <button onclick="closeThresholdsModal()" class="nav-config-btn" title="Cerrar">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    
                    <p style="color: #94a3b8; margin-bottom: 20px; font-size: 0.9rem;">
                        Define los umbrales de advertencia y crítico para cada métrica.
                    </p>
                    
                    <div style="display: grid; gap: 12px;">
                        ${createThresholdInput('cpu', 'CPU', '%')}
                        ${createThresholdInput('memory', 'Memoria', '%')}
                        ${createThresholdInput('disk', 'Disco', '%')}
                        ${createThresholdInput('network', 'Red', '% capacidad')}
                        ${createThresholdInput('diskio', 'Disk I/O', 'MB/s')}
                    </div>
                    
                    <div style="display: flex; gap: 10px; margin-top: 25px; justify-content: flex-end; flex-wrap: wrap;">
                        <button onclick="resetThresholds()" class="nav-config-btn">
                            <i class="fa-solid fa-rotate-left"></i> Restaurar Defaults
                        </button>
                        <button onclick="saveThresholdsConfig()" class="nav-config-btn">
                            <i class="fa-solid fa-floppy-disk"></i> Guardar
                        </button>
                    </div>
                </div>
            </div>
        `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// Close modal
window.closeThresholdsModal = function () {
    const modal = document.getElementById('thresholds-modal');
    if (modal) {
        modal.remove();
    }
};

// Save threshold configuration from modal
window.saveThresholdsConfig = function () {
    ['cpu', 'memory', 'disk', 'network', 'diskio'].forEach(key => {
        const warning = parseFloat(document.getElementById(`thresh-${key}-warning`).value);
        const critical = parseFloat(document.getElementById(`thresh-${key}-critical`).value);

        // Validate: critical should be >= warning
        if (critical < warning) {
            alert(`Error en ${key}: El umbral crítico debe ser mayor o igual al de advertencia`);
            return;
        }

        currentThresholds[key] = { warning, critical };
    });

    saveThresholds(currentThresholds);
    closeThresholdsModal();

    // Reload charts with new thresholds
    const selectedServer = document.getElementById('history-server-select')?.value;
    if (selectedServer) {
        loadHistoryMetrics();
    }
};

// Reset to default thresholds
window.resetThresholds = function () {
    currentThresholds = JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
    saveThresholds(currentThresholds);
    closeThresholdsModal();
    showThresholdsConfigModal(); // Reopen with defaults
};

// ========================================
// END THRESHOLDS MANAGEMENT SYSTEM
// ========================================

// ========================================
// TREND ANALYSIS & PREDICTIONS
// ========================================

// Linear regression for trend analysis
function linearRegression(xValues, yValues) {
    const n = xValues.length;
    if (n < 2) return null;

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
        sumX += xValues[i];
        sumY += yValues[i];
        sumXY += xValues[i] * yValues[i];
        sumXX += xValues[i] * xValues[i];
    }

    const denominator = (n * sumXX - sumX * sumX);
    if (denominator === 0) return null;

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
}

// Generate trend line and predictions
function calculateTrendLine(dataPoints, futurePoints = 5) {
    // Filter out null values and create indexed data
    const validData = dataPoints
        .map((value, index) => ({ x: index, y: value }))
        .filter(p => p.y != null && !isNaN(p.y) && isFinite(p.y));

    if (validData.length < 3) return null; // Need at least 3 points

    const regression = linearRegression(
        validData.map(p => p.x),
        validData.map(p => p.y)
    );

    if (!regression) return null;

    const { slope, intercept } = regression;

    // Generate trend line for existing data
    const trendLine = dataPoints.map((_, index) => {
        const y = slope * index + intercept;
        return y >= 0 ? y : null; // No negative values
    });

    // Generate future predictions
    const lastIndex = dataPoints.length - 1;
    const predictions = [];

    for (let i = 1; i <= futurePoints; i++) {
        const x = lastIndex + i;
        const y = slope * x + intercept;
        predictions.push(y >= 0 ? y : 0);
    }

    return {
        trendLine,
        predictions,
        slope,
        growthRate: slope // Growth per time unit
    };
}

// Check if trends should be shown
function shouldShowTrends() {
    const toggle = document.getElementById('show-trends-toggle');
    return toggle ? toggle.checked : false;
}

// ========================================
// END TREND ANALYSIS
// ========================================

// Reset zoom for all charts
function resetAllChartsZoom() {
    [cpuChart, ramChart, diskChart, netChart, diskIOChart, tempChart, uptimeChart].forEach(chart => {
        if (chart && chart.resetZoom) {
            chart.resetZoom();
        }
    });
}

function initHistoryMetrics() {
    if (historyMetricsInitialized) return;

    const serverSelect = document.getElementById('history-server-select');
    const timeRange = document.getElementById('history-time-range');
    const loadBtn = document.getElementById('load-history-btn');

    if (loadBtn) {
        loadBtn.addEventListener('click', loadHistoryMetrics);
    }

    // Configure thresholds button
    const configThresholdsBtn = document.getElementById('configure-thresholds-btn');
    if (configThresholdsBtn) {
        configThresholdsBtn.addEventListener('click', showThresholdsConfigModal);
    }

    // Reset zoom button
    const resetZoomBtn = document.getElementById('reset-zoom-btn');
    if (resetZoomBtn) {
        resetZoomBtn.addEventListener('click', resetAllChartsZoom);
    }

    // Trends toggle
    const trendsToggle = document.getElementById('show-trends-toggle');
    if (trendsToggle) {
        // Load saved preference
        const savedPref = localStorage.getItem('show-trends');
        if (savedPref === 'true') {
            trendsToggle.checked = true;
        }

        trendsToggle.addEventListener('change', (e) => {
            localStorage.setItem('show-trends', e.target.checked);
            // Reload charts with/without trends
            const selectedServer = document.getElementById('history-server-select')?.value;
            if (selectedServer) {
                loadHistoryMetrics();
            }
        });
    }

    if (serverSelect) {
        serverSelect.addEventListener('change', loadHistoryMetrics);
    }
    if (timeRange) {
        timeRange.addEventListener('change', loadHistoryMetrics);
    }

    // Initialize Compact Mode, Anomaly Detection, Capacity Planning, and Auto-Refresh
    initCompactMode();
    initAnomalyDetection();
    initCapacityPlanning();
    initAutoRefresh();

    historyMetricsInitialized = true;
}

// ========================================
// COMPACT MODE SYSTEM
// ========================================

let compactModeEnabled = false;

function initCompactMode() {
    const toggle = document.getElementById('compact-mode-toggle');
    if (!toggle) return;

    // Load saved preference
    const saved = localStorage.getItem('history-compact-mode');
    if (saved === 'true') {
        compactModeEnabled = true;
        toggle.checked = true;
        applyCompactMode(true);
    }

    // Toggle event
    toggle.addEventListener('change', () => {
        compactModeEnabled = toggle.checked;
        localStorage.setItem('history-compact-mode', compactModeEnabled);
        applyCompactMode(compactModeEnabled);
    });
}

function applyCompactMode(enabled) {
    const chartsGrid = document.querySelector('.charts-grid');
    const chartContainers = document.querySelectorAll('.chart-container');

    if (enabled) {
        // Compact mode: smaller charts, 3 columns
        if (chartsGrid) {
            chartsGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(250px, 1fr))';
            chartsGrid.style.gap = '12px';
        }
        chartContainers.forEach(container => {
            container.style.height = '200px';
            container.style.padding = '12px';
        });
    } else {
        // Normal mode: restore defaults
        if (chartsGrid) {
            chartsGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
            chartsGrid.style.gap = '20px';
        }
        chartContainers.forEach(container => {
            container.style.height = '320px';
            container.style.padding = '20px';
        });
    }

    // Resize charts to fit new container size
    [cpuChart, ramChart, diskChart, netChart, diskIOChart, tempChart, uptimeChart].forEach(chart => {
        if (chart && chart.resize) {
            setTimeout(() => chart.resize(), 100);
        }
    });
}

// ========================================
// AUTO-REFRESH SYSTEM
// ========================================

function initAutoRefresh() {
    const toggle = document.getElementById('auto-refresh-toggle');
    const intervalSelect = document.getElementById('refresh-interval');
    const countdown = document.getElementById('refresh-countdown');

    if (!toggle || !intervalSelect) return;

    // Load saved preferences
    const saved = localStorage.getItem('history-auto-refresh');
    if (saved) {
        try {
            const prefs = JSON.parse(saved);
            autoRefreshEnabled = prefs.enabled || false;
            autoRefreshInterval = prefs.interval || 60;
            toggle.checked = autoRefreshEnabled;
            intervalSelect.value = autoRefreshInterval;
        } catch (e) {
            console.error('Error loading auto-refresh prefs:', e);
        }
    }

    // Toggle event
    toggle.addEventListener('change', () => {
        autoRefreshEnabled = toggle.checked;
        intervalSelect.disabled = !autoRefreshEnabled;

        if (autoRefreshEnabled) {
            startAutoRefresh();
            if (countdown) countdown.style.display = 'inline';
        } else {
            stopAutoRefresh();
            if (countdown) countdown.style.display = 'none';
        }

        saveAutoRefreshPrefs();
    });

    // Interval change event
    intervalSelect.addEventListener('change', () => {
        autoRefreshInterval = parseInt(intervalSelect.value);
        saveAutoRefreshPrefs();

        if (autoRefreshEnabled) {
            stopAutoRefresh();
            startAutoRefresh();
        }
    });

    // Start if enabled
    if (autoRefreshEnabled) {
        intervalSelect.disabled = false;
        startAutoRefresh();
        if (countdown) countdown.style.display = 'inline';
    }
}

function startAutoRefresh() {
    stopAutoRefresh(); // Clear any existing timer

    nextRefreshTime = Date.now() + (autoRefreshInterval * 1000);

    // Main refresh timer
    autoRefreshTimer = setInterval(() => {
        loadHistoryMetrics();
        nextRefreshTime = Date.now() + (autoRefreshInterval * 1000);
    }, autoRefreshInterval * 1000);

    // Countdown update timer (every second)
    refreshCountdownTimer = setInterval(updateRefreshCountdown, 1000);
    updateRefreshCountdown();
}

function stopAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
    if (refreshCountdownTimer) {
        clearInterval(refreshCountdownTimer);
        refreshCountdownTimer = null;
    }
    nextRefreshTime = null;
}

function updateRefreshCountdown() {
    const countdown = document.getElementById('refresh-countdown');
    if (!countdown || !nextRefreshTime) return;

    const remaining = Math.max(0, Math.floor((nextRefreshTime - Date.now()) / 1000));

    if (remaining > 60) {
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        countdown.textContent = `${mins}m ${secs}s`;
    } else {
        countdown.textContent = `${remaining}s`;
    }
}

function saveAutoRefreshPrefs() {
    try {
        localStorage.setItem('history-auto-refresh', JSON.stringify({
            enabled: autoRefreshEnabled,
            interval: autoRefreshInterval
        }));
    } catch (e) {
        console.error('Error saving auto-refresh prefs:', e);
    }
}

// ========================================
// END AUTO-REFRESH SYSTEM
// ========================================


async function populateHistoryServers() {
    const select = document.getElementById('history-server-select');
    if (!select) return;

    // Preserve selection
    const currentVal = select.value;

    // Only mark default option as selected if there's no current selection
    const defaultSelected = currentVal ? '' : ' selected';
    let options = `<option value="" disabled${defaultSelected}>Seleccionar Servidor</option>`;

    const addOpts = (hosts, category, label_prefix) => {
        if (!hosts) return;
        hosts.forEach(h => {
            // For KVM hosts, the API returns 'id' which is the unique host ID.
            const name = h.name || h.hostname || `Server ${h.id}`;
            options += `<option value="${category}:${h.id}">${label_prefix} - ${name}</option>`;
        });
    };

    // Use global caches
    if (typeof state.allKVMHostsCache !== 'undefined') addOpts(state.allKVMHostsCache, 'kvm', 'KVM');
    if (typeof state.allProxmoxHostsCache !== 'undefined') addOpts(state.allProxmoxHostsCache, 'proxmox', 'Proxmox');
    if (typeof state.allDockerHostsCache !== 'undefined') addOpts(state.allDockerHostsCache, 'docker', 'Docker');
    if (typeof state.allPodmanHostsCache !== 'undefined') addOpts(state.allPodmanHostsCache, 'podman', 'Podman');
    if (typeof state.allKubernetesHostsCache !== 'undefined') addOpts(state.allKubernetesHostsCache, 'kubernetes', 'Kubernetes');
    if (typeof state.allNasHostsCache !== 'undefined') addOpts(state.allNasHostsCache, 'nas', 'NAS');
    if (typeof state.allFirewallHostsCache !== 'undefined') addOpts(state.allFirewallHostsCache, 'pfsense', 'pfSense');

    select.innerHTML = options;

    // Restore selection if valid
    if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
        select.value = currentVal;
    }
}

async function loadHistoryMetrics() {
    const select = document.getElementById('history-server-select');
    const timeRange = document.getElementById('history-time-range');
    if (!select || !select.value) return;

    const [category, id] = select.value.split(':');
    const duration = timeRange.value;

    // Find host to get Total Memory
    let totalMemory = 0;
    let host = null;
    if (typeof state !== 'undefined') {
        if (category === 'kvm' && state.allKVMHostsCache) host = state.allKVMHostsCache.find(h => h.id == id);
        else if (category === 'docker' && state.allDockerHostsCache) host = state.allDockerHostsCache.find(h => h.id == id);
        else if (category === 'podman' && state.allPodmanHostsCache) host = state.allPodmanHostsCache.find(h => h.id == id);
        else if (category === 'pfsense' && state.allFirewallHostsCache) host = state.allFirewallHostsCache.find(h => h.id == id);
        else if (category === 'proxmox' && state.allProxmoxHostsCache) host = state.allProxmoxHostsCache.find(h => h.id == id);
        else if (category === 'kubernetes' && state.allKubernetesHostsCache) host = state.allKubernetesHostsCache.find(h => h.id == id);
        else if (category === 'nas' && state.allNasHostsCache) host = state.allNasHostsCache.find(h => h.id == id);
    }

    if (host) {
        // Try common property names
        totalMemory = host.total_memory || host.TotalMemory || host.memory_total || 0;
    }

    try {
        const res = await fetch(`/api/metrics/${category}/${id}?duration=${duration}`);
        if (!res.ok) throw new Error('Failed to fetch metrics');
        const metrics = await res.json();

        // Host Logs logic
        loadHostLogs(category, id);

        // Show/hide node selector
        const nodeSelector = document.getElementById('history-node-selector');
        if (nodeSelector) {
            if (category === 'kubernetes') {
                nodeSelector.classList.remove('hidden');
            } else {
                nodeSelector.classList.add('hidden');
                nodeSelector.value = "total";
            }
        }

        updateCharts(metrics, false, totalMemory);
    } catch (e) {
        console.error("Error loading metrics", e);
    }
}

async function loadHostLogs(category, id) {
    const logsContainer = document.getElementById('history-logs-container');
    const logsContent = document.getElementById('history-host-logs');
    if (!logsContainer || !logsContent) {
        console.log('Log containers not found');
        return;
    }

    // If showing global summary, hide logs
    if (category === 'total' || category === 'global' || !id) {
        logsContainer.classList.add('hidden');
        logsContainer.style.display = 'none';
        return;
    }

    // Ensure card is visible for specific hosts
    logsContainer.classList.remove('hidden');
    logsContainer.style.display = 'block';
    logsContent.innerHTML = '<div style="opacity: 0.5;"><i class="fa-solid fa-circle-notch fa-spin"></i> Obteniendo logs del host...</div>';

    try {
        const res = await fetch(`/api/hosts/${category}/${id}/logs`);
        if (!res.ok) throw new Error('Error al obtener logs');
        const data = await res.json();

        if (!data.logs || data.logs.trim() === "") {
            logsContent.innerHTML = '<div style="opacity: 0.5;">No se han encontrado logs recientes.</div>';
            return;
        }

        // Store all logs globally for search filtering
        const logLines = data.logs.split('\n').filter(line => line.trim());
        window.allHostLogs = logLines;

        // NEW: Update Activity Summary based on these logs
        updateHostActivitySummary(logLines, category, id);

        // Display logs (initially all)
        displayFilteredLogs(logLines);

        // Setup search if not already done
        setupLogSearch();

        // Auto-scroll to bottom
        logsContent.scrollTop = logsContent.scrollHeight;
    } catch (err) {
        logsContent.innerHTML = `<div style="color: #f87171;">Error: ${err.message}</div>`;
    }
}

function updateHostActivitySummary(logs, category, id) {
    const summaryGrid = document.getElementById('history-summary-grid');
    if (!summaryGrid) return;

    // 1. Total Events
    const totalEvents = logs.length;

    // 2. Criticals/Errors
    const criticalCount = logs.filter(l =>
        l.toLowerCase().includes('error') ||
        l.toLowerCase().includes('fail') ||
        l.toLowerCase().includes('crit') ||
        l.toLowerCase().includes('alert')
    ).length;

    // 3. Source Name & Updates Info
    let sourceName = category.charAt(0).toUpperCase() + category.slice(1);
    let host = null;
    let updatesAvailable = false;
    let updatesText = "Sistema Actualizado";
    let updatesColor = "#10b981"; // Green
    let updatesIcon = "fa-check-circle";

    // Find host object for metadata
    if (typeof state !== 'undefined') {
        if (category === 'kvm' && state.allKVMHostsCache) host = state.allKVMHostsCache.find(h => h.id == id);
        else if (category === 'docker' && state.allDockerHostsCache) host = state.allDockerHostsCache.find(h => h.id == id);
        else if (category === 'podman' && state.allPodmanHostsCache) host = state.allPodmanHostsCache.find(h => h.id == id);
        else if (category === 'pfsense' && state.allFirewallHostsCache) host = state.allFirewallHostsCache.find(h => h.id == id);
        else if (category === 'proxmox' && state.allProxmoxHostsCache) host = state.allProxmoxHostsCache.find(h => h.id == id);
        else if (category === 'kubernetes' && state.allKubernetesHostsCache) host = state.allKubernetesHostsCache.find(h => h.id == id);
        else if (category === 'nas' && state.allNasHostsCache) host = state.allNasHostsCache.find(h => h.id == id);
    }

    if (category === 'kvm') sourceName = 'KVM';
    else if (category === 'pfsense') sourceName = 'PFsense';
    else if (category === 'proxmox') sourceName = 'Proxmox';
    else if (category === 'nas') sourceName = 'NAS';

    // Check for updates in Host Object
    if (host && host.update_status && host.update_status.includes('Updates Available')) {
        updatesAvailable = true;
        updatesText = host.update_status.replace('Updates Available', '').trim() || "Actualizaciones Pendientes";
        updatesColor = "#facc15"; // Yellow/Orange
        updatesIcon = "fa-boxes-packing";
    }


    // 4. Last Event Time
    let lastTime = '--:--';
    if (logs.length > 0) {
        const lastLog = logs[logs.length - 1];
        // Attempt to extract time (format depends on log, usually starts with date/time)
        // Simple heuristic: take first 15-20 chars if they look like date
        const match = lastLog.match(/(\d{1,2}:\d{2}:\d{2})/);
        if (match) lastTime = match[1];
        else {
            // Fallback: use current time if logs just fetched
            lastTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }

    // Render Cards
    summaryGrid.innerHTML = `
        <!-- Total Events -->
        <div class="glass-panel" style="padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; display:flex; align-items:center; gap: 15px;">
            <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(56, 189, 248, 0.1); display:flex; align-items:center; justify-content:center; color: #38bdf8; font-size: 1.2rem;">
                <i class="fa-solid fa-layer-group"></i>
            </div>
            <div>
                <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary); line-height: 1;">${totalEvents}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Eventos del Host</div>
            </div>
        </div>

        <!-- Critical -->
        <div class="glass-panel" style="padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; display:flex; align-items:center; gap: 15px;">
            <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(239, 68, 68, 0.1); display:flex; align-items:center; justify-content:center; color: #ef4444; font-size: 1.2rem;">
                <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
            <div>
                <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary); line-height: 1;">${criticalCount}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Críticos/Errores</div>
            </div>
        </div>

        <!-- Updates / Patches -->
        <div class="glass-panel" style="padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; display:flex; align-items:center; gap: 15px;">
            <div style="width: 48px; height: 48px; border-radius: 12px; background: ${updatesColor}1a; display:flex; align-items:center; justify-content:center; color: ${updatesColor}; font-size: 1.2rem;">
                <i class="fa-solid ${updatesIcon}"></i>
            </div>
            <div>
                <div style="font-size: 1.0rem; font-weight: 700; color: var(--text-primary); line-height: 1.2;">${updatesText}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Estado de Parches</div>
            </div>
        </div>

        <!-- Source -->
        <div class="glass-panel" style="padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; display:flex; align-items:center; gap: 15px;">
            <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(168, 85, 247, 0.1); display:flex; align-items:center; justify-content:center; color: #a855f7; font-size: 1.2rem;">
                <i class="fa-solid fa-server"></i>
            </div>
            <div>
                <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); line-height: 1.2;">${sourceName}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Fuente (Host)</div>
            </div>
        </div>

        <!-- Last Active -->
        <div class="glass-panel" style="padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; display:flex; align-items:center; gap: 15px;">
            <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(16, 185, 129, 0.1); display:flex; align-items:center; justify-content:center; color: #10b981; font-size: 1.2rem;">
                <i class="fa-regular fa-clock"></i>
            </div>
            <div>
                <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); line-height: 1.2;">${lastTime}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Último Evento</div>
            </div>
        </div>
    `;
}

// Store all logs for filtering
window.allHostLogs = [];

// Display filtered logs with highlighting
function displayFilteredLogs(logs) {
    const logsContent = document.getElementById('history-host-logs');
    if (!logsContent) return;

    if (!logs || logs.length === 0) {
        logsContent.innerHTML = '<div style="opacity: 0.5;">No hay logs disponibles</div>';
        return;
    }

    const searchTerm = document.getElementById('log-search-input')?.value.toLowerCase() || '';

    // Filter logs based on search term
    const filteredLogs = searchTerm
        ? logs.filter(log => log.toLowerCase().includes(searchTerm))
        : logs;

    if (filteredLogs.length === 0) {
        logsContent.innerHTML = '<div style="opacity: 0.5; color: #f59e0b;">No se encontraron logs con ese término</div>';
        return;
    }

    // Build HTML with color coding and highlighting
    let html = '';
    filteredLogs.forEach(log => {
        let color = '#a1a1aa';
        if (log.toLowerCase().includes('error') || log.toLowerCase().includes('failed') || log.toLowerCase().includes('crit')) color = '#f87171';
        else if (log.toLowerCase().includes('warn')) color = '#fbbf24';
        else if (log.toLowerCase().includes('info') || log.toLowerCase().includes('success')) color = '#60a5fa';

        let displayLog = log;

        // Highlight search term if present
        if (searchTerm) {
            const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
            displayLog = displayLog.replace(regex, '<span style="background: #f59e0b; color: #000; padding: 1px 3px; border-radius: 2px; font-weight: bold;">$1</span>');
        }

        html += `<div style="color: ${color}; margin-bottom: 2px;">${displayLog}</div>`;
    });

    logsContent.innerHTML = html;
}

// Escape regex special characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Setup search event listener (once)
let searchSetup = false;
function setupLogSearch() {
    if (searchSetup) return;
    searchSetup = true;

    const searchInput = document.getElementById('log-search-input');
    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
        if (window.allHostLogs && window.allHostLogs.length > 0) {
            displayFilteredLogs(window.allHostLogs);
        }
    });
}

let currentHistoryMetrics = [];
let netInterfaceSelectorInitialized = false;

// Initialize interface selector listener once
function initNetInterfaceSelector() {
    const selector = document.getElementById('net-interface-selector');
    if (selector && !netInterfaceSelectorInitialized) {
        selector.addEventListener('change', () => {
            updateCharts(currentHistoryMetrics, true); // true = keep dropdown
        });
        netInterfaceSelectorInitialized = true;
    }
}

let diskSelectorInitialized = false;
function initDiskSelector() {
    const selector = document.getElementById('disk-selector');
    if (selector && !diskSelectorInitialized) {
        selector.addEventListener('change', () => {
            updateCharts(currentHistoryMetrics, true);
        });
        diskSelectorInitialized = true;
    }
}

let nodeSelectorInitialized = false;
function initNodeSelector() {
    const selector = document.getElementById('history-node-selector');
    if (selector && !nodeSelectorInitialized) {
        selector.addEventListener('change', () => {
            updateCharts(currentHistoryMetrics, true);
        });
        nodeSelectorInitialized = true;
    }
}


function formatBits(bits, decimals = 2) {
    if (bits <= 0) return '0 bps';
    const k = 1000;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps', 'Pbps'];
    const i = Math.floor(Math.log(bits) / Math.log(k));
    const index = Math.max(0, Math.min(i, sizes.length - 1));
    return parseFloat((bits / Math.pow(k, index)).toFixed(dm)) + ' ' + sizes[index];
}
// ========================================
// ANOMALY DETECTION SYSTEM
// ========================================

let anomaliesEnabled = false;

function initAnomalyDetection() {
    const toggle = document.getElementById('show-anomalies-toggle');
    if (!toggle) return;

    // Load saved preference
    const saved = localStorage.getItem('history-show-anomalies');
    if (saved === 'true') {
        anomaliesEnabled = true;
        toggle.checked = true;
    }

    toggle.addEventListener('change', () => {
        anomaliesEnabled = toggle.checked;
        localStorage.setItem('history-show-anomalies', anomaliesEnabled);
        updateAnomalyVisualization();
    });
}

function detectAnomalies(data) {
    if (!data || data.length < 5) return [];

    // Filter out null/invalid values
    const validData = data.filter(v => v !== null && v !== undefined && !isNaN(v));
    if (validData.length < 5) return [];

    // Calculate Mean
    const sum = validData.reduce((a, b) => a + b, 0);
    const mean = sum / validData.length;

    // Calculate StdDev
    const squareDiffs = validData.map(v => Math.pow(v - mean, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / validData.length;
    const stdDev = Math.sqrt(avgSquareDiff);

    if (stdDev === 0) return [];

    // Z-Score threshold (e.g., 2.5 or 3 standard deviations)
    const THRESHOLD = 2.5;

    return data.map((v, i) => {
        if (v === null || v === undefined || isNaN(v)) return null;
        const zScore = (v - mean) / stdDev;
        return Math.abs(zScore) > THRESHOLD ? v : null;
    });
}

function updateAnomalyVisualization() {
    if (!cpuChart) return;

    // Apply to all charts
    applyAnomaliesToChart(cpuChart, 'cpu');
    applyAnomaliesToChart(ramChart, 'ram');
    applyAnomaliesToChart(diskChart, 'disk');
    applyAnomaliesToChart(netChart, 'net');
    applyAnomaliesToChart(diskIOChart, 'diskio');
    applyAnomaliesToChart(tempChart, 'temp');
}

function applyAnomaliesToChart(chart, type) {
    if (!chart || !chart.data || !chart.data.datasets) return;

    // Remove existing anomaly dataset
    chart.data.datasets = chart.data.datasets.filter(ds => ds.label !== 'Anomalías');

    if (anomaliesEnabled) {
        // Find main dataset (usually the first one, or specific logic)
        const mainDataset = chart.data.datasets[0];
        if (!mainDataset || !mainDataset.data) return;

        const mainData = mainDataset.data;
        const anomalies = detectAnomalies(mainData);

        // Only add if there are anomalies
        const hasAnomalies = anomalies.some(v => v !== null);

        if (hasAnomalies) {
            chart.data.datasets.push({
                label: 'Anomalías',
                data: anomalies,
                type: 'scatter',
                backgroundColor: '#ef4444', // Red
                borderColor: '#ef4444',
                pointRadius: 4,
                pointHoverRadius: 6,
                pointStyle: 'circle',
                order: 0 // Draw on top
            });
        }
    }

    chart.update('none'); // Update without animation for performance
}

// ========================================
// CAPACITY PLANNING SYSTEM
// ========================================

let forecastEnabled = false;

function initCapacityPlanning() {
    const toggle = document.getElementById('show-forecast-toggle');
    if (!toggle) return;

    // Load saved preference
    const saved = localStorage.getItem('history-show-forecast');
    if (saved === 'true') {
        forecastEnabled = true;
        toggle.checked = true;
    }

    toggle.addEventListener('change', () => {
        forecastEnabled = toggle.checked;
        localStorage.setItem('history-show-forecast', forecastEnabled);
        updateForecastVisualization();
    });
}

function calculateLinearRegression(values) {
    if (!values || values.length < 5) return null;

    const n = values.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    // Use index as X to simplify timestamp handling
    for (let i = 0; i < n; i++) {
        const x = i;
        const y = values[i];

        if (y === null || y === undefined || isNaN(y)) continue;

        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
}

function updateForecastVisualization() {
    // Apply forecasting primarily to Disk Usage, as it's the most relevant for capacity planning
    applyForecastToChart(diskChart, 'disk');

    // Optionally apply to others if useful
    // applyForecastToChart(cpuChart, 'cpu');
    // applyForecastToChart(ramChart, 'ram');
}

function applyForecastToChart(chart, type) {
    if (!chart || !chart.data || !chart.data.datasets) return;

    // Remove existing forecast dataset
    chart.data.datasets = chart.data.datasets.filter(ds => ds.label !== 'Proyección');

    if (forecastEnabled) {
        // Find main dataset
        const mainDataset = chart.data.datasets[0];
        if (!mainDataset || !mainDataset.data || mainDataset.data.length < 5) return;

        const mainData = mainDataset.data;
        const regression = calculateLinearRegression(mainData);

        if (regression) {
            // Generate trend line points
            const trendData = mainData.map((_, i) => {
                const val = regression.slope * i + regression.intercept;
                return Math.max(0, val); // Clamp to positive
            });

            // Projection: Extend 20% into future (visual effect only for now)
            // Note: Chart.js X-axis would need extension to show future properly.
            // For now, we overlay the trend on existing data to show direction.

            chart.data.datasets.push({
                label: 'Proyección',
                data: trendData,
                type: 'line',
                borderColor: '#ffffff',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                fill: false,
                order: 0,
                tension: 0
            });

            // --- Capacity Estimation (Days Remaining) ---
            if (type === 'disk') {
                const container = chart.canvas.parentNode;
                let label = container.querySelector('.forecast-label');
                if (!label) {
                    label = document.createElement('div');
                    label.className = 'forecast-label';
                    label.style.position = 'absolute';
                    label.style.top = '50px'; // Below title
                    label.style.right = '20px';
                    label.style.background = 'rgba(0,0,0,0.6)';
                    label.style.backdropFilter = 'blur(4px)';
                    label.style.border = '1px solid rgba(255,255,255,0.1)';
                    label.style.padding = '6px 12px';
                    label.style.borderRadius = '8px';
                    label.style.fontSize = '0.8rem';
                    label.style.color = '#fbbf24';
                    label.style.pointerEvents = 'none';
                    label.style.display = 'flex';
                    label.style.alignItems = 'center';
                    label.style.gap = '8px';
                    label.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
                    container.appendChild(label);
                }

                // Get Capacity (Total Space - Dataset 1)
                // Assuming Dataset 1 is Total Space based on initialization order
                const totalDataset = chart.data.datasets.find(ds => ds.label === 'Total Space') || chart.data.datasets[1];
                let maxCapacity = 0;
                if (totalDataset && totalDataset.data && totalDataset.data.length > 0) {
                    maxCapacity = Math.max(...totalDataset.data.filter(v => typeof v === 'number'));
                }

                let daysText = "Calculando...";
                let iconClass = "fa-calculator";
                let color = "#94a3b8"; // Gray

                if (regression.slope > 0 && maxCapacity > 0) {
                    // Equation: y = mx + b  =>  max = slope * x + intercept
                    // x_full = (max - intercept) / slope
                    const x_full = (maxCapacity - regression.intercept) / regression.slope;
                    const current_x = mainData.length - 1;
                    const points_remaining = x_full - current_x;

                    if (points_remaining <= 0) {
                        daysText = "Crítico (Lleno)";
                        color = "#ef4444";
                        iconClass = "fa-triangle-exclamation";
                    } else {
                        // Calculate time per point
                        // Use currentHistoryMetrics timestamps
                        if (currentHistoryMetrics && currentHistoryMetrics.length > 1) {
                            const t1 = new Date(currentHistoryMetrics[0].timestamp).getTime();
                            const t2 = new Date(currentHistoryMetrics[currentHistoryMetrics.length - 1].timestamp).getTime();
                            const totalTimeMs = t2 - t1;
                            const msPerPoint = totalTimeMs / (currentHistoryMetrics.length - 1);

                            const msRemaining = points_remaining * msPerPoint;
                            const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);

                            if (daysRemaining > 365) {
                                daysText = "> 1 año";
                                color = "#10b981"; // Green
                                iconClass = "fa-calendar-check";
                            } else if (daysRemaining < 0) {
                                daysText = "Crítico";
                                color = "#ef4444";
                                iconClass = "fa-triangle-exclamation";
                            } else {
                                daysText = `${daysRemaining.toFixed(1)} días`;
                                if (daysRemaining < 7) {
                                    color = "#ef4444"; // Red
                                    iconClass = "fa-bell";
                                } else if (daysRemaining < 30) {
                                    color = "#facc15"; // Yellow
                                    iconClass = "fa-clock";
                                } else {
                                    color = "#38bdf8"; // Blue
                                    iconClass = "fa-calendar-days";
                                }
                            }
                        }
                    }
                } else {
                    daysText = "Uso Estable";
                    color = "#10b981";
                    iconClass = "fa-check-circle";
                }

                label.style.color = color;
                label.style.borderColor = color + '40'; // Low opacity border
                label.style.background = color + '10'; // Low opacity bg
                label.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>Agotamiento: <b>${daysText}</b></span>`;
                label.style.display = 'flex';
            }

        } else if (type === 'disk') {
            // Hide label if linear regression failed
            const container = chart.canvas.parentNode;
            const label = container.querySelector('.forecast-label');
            if (label) label.style.display = 'none';
        }
    } else {
        // Hide label if forecasting disabled
        if (type === 'disk') {
            const container = chart.canvas.parentNode;
            const label = container.querySelector('.forecast-label');
            if (label) label.style.display = 'none';
        }
    }

    chart.update('none');
}


function updateCharts(metrics, keepDropdown = false, totalMemory = 0) {
    if (!metrics) metrics = [];
    currentHistoryMetrics = metrics; // Cache for selector

    initNetInterfaceSelector();
    initDiskSelector();
    initNodeSelector();

    // Update Date Display
    const dateDisplay = document.getElementById('history-date-display');
    if (dateDisplay) {
        if (metrics.length > 0) {
            // Use last metric timestamp
            const lastTime = new Date(metrics[metrics.length - 1].timestamp);
            const dateStr = lastTime.toLocaleDateString();
            dateDisplay.innerHTML = `<i class="fa-regular fa-calendar" style="color: #60a5fa;"></i> ${dateStr}`;
            dateDisplay.style.display = 'flex';
        } else {
            dateDisplay.style.display = 'none';
        }
    }

    // Sort by timestamp
    metrics.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const nodeSelector = document.getElementById('history-node-selector');
    let selectedNode = "total";
    if (nodeSelector) {
        selectedNode = nodeSelector.value;
    }

    // Populate node selector if not keeping dropdown
    if (!keepDropdown && nodeSelector && metrics.length > 0 && metrics[0].category === 'kubernetes') {
        const nodesSet = new Set();
        metrics.forEach(m => {
            if (m.nodes_data && m.nodes_data !== "{}" && m.nodes_data !== "[]") {
                try {
                    const nodeMap = JSON.parse(m.nodes_data);
                    Object.keys(nodeMap).forEach(k => nodesSet.add(k));
                } catch (e) { }
            }
        });

        const prevNodeSelection = nodeSelector.value;
        nodeSelector.innerHTML = '<option value="total">Cluster Total</option>';
        Array.from(nodesSet).sort().forEach(node => {
            const opt = document.createElement('option');
            opt.value = node;
            opt.textContent = node;
            nodeSelector.appendChild(opt);
        });
        if (Array.from(nodesSet).includes(prevNodeSelection)) {
            nodeSelector.value = prevNodeSelection;
            selectedNode = prevNodeSelection;
        } else {
            nodeSelector.value = "total";
            selectedNode = "total";
        }
    }

    const labels = metrics.map(m => new Date(m.timestamp).toLocaleString());
    let sortedCpu = metrics.map(m => m.cpu_usage);
    let sortedRam = metrics.map(m => m.memory_usage);
    let sortedDisk = metrics.map(m => m.disk_usage);
    let sortedTemp = metrics.map(m => m.temperature !== undefined && m.temperature !== null ? m.temperature : null);

    if (selectedNode !== "total") {
        sortedCpu = metrics.map(m => {
            try {
                const ndata = JSON.parse(m.nodes_data || "{}");
                return ndata[selectedNode] ? ndata[selectedNode].cpu_usage : null;
            } catch (e) { return null; }
        });
        sortedRam = metrics.map(m => {
            try {
                const ndata = JSON.parse(m.nodes_data || "{}");
                return ndata[selectedNode] ? ndata[selectedNode].mem_usage : null;
            } catch (e) { return null; }
        });
        sortedDisk = metrics.map(m => {
            try {
                const ndata = JSON.parse(m.nodes_data || "{}");
                return ndata[selectedNode] ? ndata[selectedNode].disk_usage : null;
            } catch (e) { return null; }
        });
        sortedTemp = metrics.map(m => {
            try {
                const ndata = JSON.parse(m.nodes_data || "{}");
                return ndata[selectedNode] && ndata[selectedNode].temperature !== undefined ? ndata[selectedNode].temperature : null;
            } catch (e) { return null; }
        });
    }

    // Handle Network Interface Selection
    const selector = document.getElementById('net-interface-selector');
    let selectedIface = "total";
    if (selector) {
        selectedIface = selector.value;
    }

    const diskSelector = document.getElementById('disk-selector');
    let selectedDisk = "total";
    if (diskSelector) {
        selectedDisk = diskSelector.value;
    }

    // Collect all available interfaces from history
    if (!keepDropdown && selector) {
        const interfacesSet = new Set();
        metrics.forEach(m => {
            if (m.interfaces_data && m.interfaces_data !== "{}" && m.interfaces_data !== "[]") {
                try {
                    const ifaceMap = JSON.parse(m.interfaces_data);
                    Object.keys(ifaceMap).forEach(k => interfacesSet.add(k));
                } catch (e) {
                    // ignore parse error
                }
            }
        });

        // Save current selection if valid
        const previousSelection = selector.value;

        // Rebuild options
        // Clear old options except "Total"
        selector.innerHTML = '<option value="total">Total</option>';

        const sortedIfaces = Array.from(interfacesSet).sort();
        sortedIfaces.forEach(iface => {
            const opt = document.createElement('option');
            opt.value = iface;
            opt.textContent = iface;
            selector.appendChild(opt);
        });

        // Restore selection if it still exists
        if (interfacesSet.has(previousSelection)) {
            selector.value = previousSelection;
            selectedIface = previousSelection;
        } else {
            selector.value = "total";
            selectedIface = "total";
        }
    }

    // Collect all available disks from history
    if (!keepDropdown && diskSelector) {
        const disksSet = new Set();
        metrics.forEach(m => {
            if (m.disks_data && m.disks_data !== "{}" && m.disks_data !== "[]") {
                try {
                    const diskMap = JSON.parse(m.disks_data);
                    Object.keys(diskMap).forEach(k => disksSet.add(k));
                } catch (e) { }
            }
        });

        const prevDiskSelection = diskSelector.value;
        diskSelector.innerHTML = '<option value="total">Total</option>';
        Array.from(disksSet).sort().forEach(disk => {
            const opt = document.createElement('option');
            opt.value = disk;
            opt.textContent = disk;
            diskSelector.appendChild(opt);
        });

        if (disksSet.has(prevDiskSelection)) {
            diskSelector.value = prevDiskSelection;
            selectedDisk = prevDiskSelection;
        } else {
            diskSelector.value = "total";
            selectedDisk = "total";
        }
    }

    const ratesRx = [];
    const ratesTx = [];
    const netCapacities = [];
    const diskUsages = [];
    const diskTotals = [];
    const netLabels = [];
    const ratesDiskRead = [];
    const ratesDiskWrite = [];

    // Calculate network and disk rates based on selected interface
    for (let i = 1; i < metrics.length; i++) {
        const t1 = new Date(metrics[i - 1].timestamp).getTime();
        const t2 = new Date(metrics[i].timestamp).getTime();
        const sec = (t2 - t1) / 1000;

        netLabels.push(new Date(metrics[i].timestamp).toLocaleString());

        if (sec > 0) {
            // Network
            let rx1 = metrics[i - 1].net_rx;
            let tx1 = metrics[i - 1].net_tx;
            let rx2 = metrics[i].net_rx;
            let tx2 = metrics[i].net_tx;

            // Override if specific interface selected
            // Override if specific interface selected
            let capacity = 0;
            if (selectedIface !== "total") {
                rx1 = 0; tx1 = 0; rx2 = 0; tx2 = 0;
                try {
                    const map1 = JSON.parse(metrics[i - 1].interfaces_data || "{}");
                    const map2 = JSON.parse(metrics[i].interfaces_data || "{}");
                    if (map1[selectedIface]) {
                        rx1 = map1[selectedIface].rx || 0;
                        tx1 = map1[selectedIface].tx || 0;
                    }
                    if (map2[selectedIface]) {
                        rx2 = map2[selectedIface].rx || 0;
                        tx2 = map2[selectedIface].tx || 0;
                        capacity = map2[selectedIface].speed || 0;
                    }
                } catch (e) {
                    // error
                }
            } else {
                // Total: Sum all speeds
                try {
                    const map2 = JSON.parse(metrics[i].interfaces_data || "{}");
                    Object.values(map2).forEach(v => capacity += (v.speed || 0));
                } catch (e) { }
            }

            let dRx = rx2 - rx1;
            let dTx = tx2 - tx1;

            if (dRx < 0) dRx = 0;
            if (dTx < 0) dTx = 0;

            if (selectedNode !== "total") {
                // For Kubernetes nodes, rxRate/txRate were stored directly in nodes_data as rates
                try {
                    const nd2 = JSON.parse(metrics[i].nodes_data || "{}")[selectedNode] || {};
                    ratesRx.push(nd2.net_rx != null ? nd2.net_rx * 8 : null); // Convert to bits
                    ratesTx.push(nd2.net_tx != null ? nd2.net_tx * 8 : null);
                } catch (e) {
                    ratesRx.push(null);
                    ratesTx.push(null);
                }
            } else {
                ratesRx.push((dRx / sec) * 8);
                ratesTx.push((dTx / sec) * 8);
            }
            netCapacities.push(capacity * 1000 * 1000);

            // Disk Chart (Storage)
            let du2 = metrics[i].disk_usage || 0;
            let dt2 = metrics[i].disk_total || 0;
            if (selectedNode !== "total") {
                try {
                    const nd2 = JSON.parse(metrics[i].nodes_data || "{}")[selectedNode] || {};
                    du2 = nd2.disk_used || 0;
                    dt2 = nd2.disk_total || 0;
                } catch (e) { }
            }
            diskUsages.push(du2);
            diskTotals.push(dt2);

            // Disk I/O Rates
            let r1 = metrics[i - 1].disk_read || 0;
            let w1 = metrics[i - 1].disk_write || 0;
            let r2 = metrics[i].disk_read || 0;
            let w2 = metrics[i].disk_write || 0;

            if (selectedNode !== "total") {
                // Currently Kubernetes nodes don't easily provide I/O rates in Summary API
                // unless we enhance the collector further with SSH fallback per node.
                // We'll show null for now or try to extract from ndata if we added it.
                ratesDiskRead.push(null);
                ratesDiskWrite.push(null);
            } else if (selectedDisk !== "total") {
                r1 = 0; w1 = 0; r2 = 0; w2 = 0;
                try {
                    const dmap1 = JSON.parse(metrics[i - 1].disks_data || "{}");
                    const dmap2 = JSON.parse(metrics[i].disks_data || "{}");
                    if (dmap1[selectedDisk]) {
                        r1 = dmap1[selectedDisk].read || 0;
                        w1 = dmap1[selectedDisk].write || 0;
                    }
                    if (dmap2[selectedDisk]) {
                        r2 = dmap2[selectedDisk].read || 0;
                        w2 = dmap2[selectedDisk].write || 0;
                    }
                } catch (e) { }
            }

            let dr = r2 - r1;
            let dw = w2 - w1;
            if (dr < 0) dr = r2;
            if (dw < 0) dw = w2;

            ratesDiskRead.push(dr / sec);
            ratesDiskWrite.push(dw / sec);

        } else {
            // No valid time delta - push null to show gaps in charts
            ratesRx.push(null);
            ratesTx.push(null);
            netCapacities.push(null);
            diskUsages.push(null);
            diskTotals.push(null);
            ratesDiskRead.push(null);
            ratesDiskWrite.push(null);
        }
    }

    const getGradient = (ctx, color) => {
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, color + '66'); // 40% opacity
        gradient.addColorStop(1, color + '00'); // 0% opacity
        return gradient;
    };

    // Common X-Axis Ticks Configuration (Extracted to survive JSON clone)
    const xAxisTicks = {
        color: '#94a3b8',
        font: { size: 10 },
        maxRotation: 0, // Force horizontal
        minRotation: 0,
        autoSkip: true,
        maxTicksLimit: 5, // Reduce density
        padding: 8,
        callback: function (value, index, values) {
            const label = this.getLabelForValue(value);
            // Robust time extraction
            if (typeof label === 'string') {
                const timeMatch = label.match(/(\d{1,2}:\d{2}(:\d{2})?)\s*(?:[APap]\.?[Mm]\.?)?/);
                if (timeMatch) return timeMatch[0];

                const parts = label.split(' ');
                if (parts.length > 1) {
                    const last = parts[parts.length - 1];
                    if (last.match(/[APap]\.?[Mm]\.?/) && parts.length > 1) {
                        return parts[parts.length - 2] + ' ' + last;
                    }
                    return last;
                }
            }
            return label;
        }
    };

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false }, // Hide default legend as we have custom headers
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                titleColor: '#fff',
                bodyColor: '#ccc',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                borderWidth: 1
            },
            zoom: {
                limits: {
                    x: { min: 'original', max: 'original' },
                    y: { min: 'original', max: 'original' }
                },
                pan: {
                    enabled: true,
                    mode: 'xy',
                    modifierKey: null, // No need to hold key, just drag
                    threshold: 10
                },
                zoom: {
                    wheel: {
                        enabled: true,
                        speed: 0.1
                    },
                    pinch: {
                        enabled: true
                    },
                    mode: 'xy'
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                ticks: { color: '#94a3b8', font: { size: 11 } },
                border: { display: false }
            },
            x: {
                grid: { display: false },
                ticks: xAxisTicks, // Use the shared config
                border: { display: false }
            }
        },
        interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
        },
        elements: {
            point: { radius: 0, hoverRadius: 6, hitRadius: 10 }
        }
    };

    // Helper to create or update chart
    const createOrUpdateChart = (instance, id, type, label, data, color, fill = true, labelsOverride = null, customOptions = null) => {
        const canvas = document.getElementById(id);
        if (!canvas) return null;

        const ctx = canvas.getContext('2d');
        const gradient = getGradient(ctx, color);

        // Update existing
        if (instance) {
            instance.data.labels = labelsOverride || labels;
            instance.data.datasets[0].data = data;
            // Update gradient on resize/update if needed, but usually static is fine
            // instance.data.datasets[0].backgroundColor = gradient;
            instance.update('none');
            return instance;
        }

        // Create new
        return new Chart(ctx, {
            type: type,
            data: {
                labels: labelsOverride || labels,
                datasets: [{
                    label: label,
                    data: data,
                    borderColor: color,
                    backgroundColor: gradient,
                    borderWidth: 2,
                    fill: fill,
                    tension: 0.4,
                    pointBackgroundColor: color,
                    pointBorderColor: '#fff',
                    spanGaps: false  // Don't connect lines across null values
                }]
            },
            options: customOptions || commonOptions
        });
    };

    // --- Unit Formatter ---
    const formatBytes = (bytes) => {
        if (bytes === 0 || isNaN(bytes) || bytes === undefined || bytes === null) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        if (i < 0) return bytes + ' B';
        if (i >= sizes.length) return parseFloat((bytes / Math.pow(k, sizes.length - 1)).toFixed(1)) + ' ' + sizes[sizes.length - 1];
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // CPU Chart with thresholds and trends
    const cpuOptions = JSON.parse(JSON.stringify(commonOptions));
    cpuOptions.scales.x.ticks = xAxisTicks; // Restore callback
    cpuOptions.plugins.annotation = getThresholdAnnotations('cpu', 100);

    // Check if trends should be shown
    if (shouldShowTrends()) {
        const trendData = calculateTrendLine(sortedCpu, 5);
        if (trendData) {
            // Prepare datasets
            const cpuDatasets = [
                {
                    label: 'CPU Usage (%)',
                    data: sortedCpu,
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    spanGaps: false
                },
                {
                    label: 'Tendencia',
                    data: trendData.trendLine,
                    borderColor: 'rgba(56, 189, 248, 0.5)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    tension: 0
                }
            ];

            // Add predictions with extended labels
            const extendedLabels = [...netLabels];
            if (netLabels.length > 0) {
                const lastTime = new Date(netLabels[netLabels.length - 1]);
                for (let i = 1; i <= trendData.predictions.length; i++) {
                    const futureTime = new Date(lastTime.getTime() + i * 3600000); // +1 hour
                    extendedLabels.push(futureTime.toLocaleTimeString());
                }

                const predictionData = new Array(sortedCpu.length).fill(null).concat(trendData.predictions);
                cpuDatasets.push({
                    label: 'Predicción',
                    data: predictionData,
                    borderColor: 'rgba(251, 191, 36, 0.7)',
                    borderWidth: 2,
                    borderDash: [2, 2],
                    fill: false,
                    pointRadius: 0,
                    tension: 0
                });
            }

            // Enable legend when showing trends
            cpuOptions.plugins.legend = {
                display: true,
                labels: { color: '#94a3b8', usePointStyle: true, boxWidth: 8 }
            };

            // Create/update chart with multiple datasets
            const cpuCanvas = document.getElementById('cpuChart');
            if (cpuCanvas) {
                const ctx = cpuCanvas.getContext('2d');
                if (cpuChart) cpuChart.destroy();
                cpuChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: extendedLabels.length > netLabels.length ? extendedLabels : netLabels,
                        datasets: cpuDatasets
                    },
                    options: cpuOptions
                });
            }
        } else {
            // Not enough data for trends, fallback to regular chart
            cpuChart = createOrUpdateChart(cpuChart, 'cpuChart', 'line', 'CPU Usage (%)', sortedCpu, '#38bdf8', true, null, cpuOptions);
        }
    } else {
        // Trends disabled, show regular chart
        cpuChart = createOrUpdateChart(cpuChart, 'cpuChart', 'line', 'CPU Usage (%)', sortedCpu, '#38bdf8', true, null, cpuOptions);
    }

    // Custom Options for RAM
    const ramOptions = JSON.parse(JSON.stringify(commonOptions));
    ramOptions.scales.x.ticks = xAxisTicks; // Restore callback
    ramOptions.plugins.tooltip.callbacks = {
        label: (context) => ' ' + formatBytes(context.raw)
    };
    ramOptions.scales.y.ticks.callback = (value) => formatBytes(value);

    // Reuse RAM options for formatBytes on Y and Tooltip
    // Enable legend for RAM
    ramOptions.plugins.legend = {
        display: true,
        labels: { color: '#94a3b8', usePointStyle: true, boxWidth: 8 }
    };

    // Add threshold annotations for RAM
    ramOptions.plugins.annotation = getThresholdAnnotations('memory', totalMemory || 100);

    const ramData = {
        labels: netLabels, // Use same aligned labels
        datasets: [
            {
                label: 'RAM Usage',
                data: sortedRam,
                borderColor: '#a855f7',
                backgroundColor: getGradient(document.getElementById('ramChart').getContext('2d'), '#a855f7'),
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                spanGaps: false  // Don't connect lines across null values
            }
        ]
    };

    if (totalMemory > 0) {
        ramData.datasets.push({
            label: 'Total Memory',
            data: metrics.map(() => totalMemory),
            borderColor: '#9ca3b8', // Grey
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0,
            tension: 0,
            spanGaps: false
        });
    }

    if (ramChart) {
        ramChart.data = ramData;
        ramChart.update('none');
    } else {
        const ctxRam = document.getElementById('ramChart').getContext('2d');
        ramChart = new Chart(ctxRam, {
            type: 'line',
            data: ramData,
            options: ramOptions
        });
    }

    // Disk Chart (Storage)
    const canvasDisk = document.getElementById('diskChart');
    if (canvasDisk) {
        if (typeof diskChart !== 'undefined' && diskChart) {
            diskChart.data.labels = netLabels;
            diskChart.data.datasets[0].data = diskUsages;
            diskChart.data.datasets[1].data = diskTotals;
            diskChart.update('none');
        } else {
            const ctxDisk = canvasDisk.getContext('2d');
            const gradUsed = getGradient(ctxDisk, '#fbbf24');
            const gradTotal = getGradient(ctxDisk, '#9ca3af'); // Grey for total

            // Reuse RAM options for formatBytes on Y and Tooltip
            const diskOptions = JSON.parse(JSON.stringify(ramOptions));
            diskOptions.scales.x.ticks = xAxisTicks; // Restore callback
            diskOptions.scales.x.ticks = xAxisTicks; // Restore callback

            // Re-apply callbacks because JSON.stringify strips functions
            diskOptions.plugins.tooltip.callbacks = {
                label: (context) => ' ' + formatBytes(context.raw)
            };
            diskOptions.scales.y.ticks.callback = (value) => formatBytes(value);

            diskOptions.plugins.legend = {
                display: true,
                labels: { color: '#94a3b8', usePointStyle: true, boxWidth: 8 }
            };

            // Add threshold annotations for Disk
            const maxDiskValue = Math.max(...diskTotals.filter(v => v != null), 100);
            diskOptions.plugins.annotation = getThresholdAnnotations('disk', maxDiskValue);

            diskChart = new Chart(ctxDisk, {
                type: 'line',
                data: {
                    labels: netLabels,
                    datasets: [
                        {
                            label: 'Used Space',
                            data: diskUsages,
                            borderColor: '#fbbf24',
                            backgroundColor: gradUsed,
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointRadius: 0,
                            spanGaps: false
                        },
                        {
                            label: 'Total Space',
                            data: diskTotals,
                            borderColor: '#9ca3af',
                            backgroundColor: gradTotal,
                            borderWidth: 2,
                            borderDash: [5, 5],
                            fill: false,
                            tension: 0.4,
                            pointRadius: 0,
                            spanGaps: false
                        }
                    ]
                },
                options: diskOptions
            });
        }
    }

    // Temperature Chart with thresholds and trends
    const tempOptions = JSON.parse(JSON.stringify(commonOptions));
    tempOptions.scales.x.ticks = xAxisTicks; // Restore callback
    tempOptions.plugins.annotation = getThresholdAnnotations('temperature', 100);
    tempOptions.scales.y.ticks.callback = (value) => value + '°C';
    tempOptions.plugins.tooltip = {
        ...tempOptions.plugins.tooltip,
        callbacks: {
            label: (context) => ' ' + context.raw + '°C'
        }
    };

    // Check if trends should be shown
    if (shouldShowTrends()) {
        const trendData = calculateTrendLine(sortedTemp, 5);
        if (trendData) {
            const tempDatasets = [
                {
                    label: 'Temperatura (°C)',
                    data: sortedTemp,
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    spanGaps: false
                },
                {
                    label: 'Tendencia',
                    data: trendData.trendLine,
                    borderColor: 'rgba(249, 115, 22, 0.5)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    tension: 0
                }
            ];

            // Add predictions
            const extendedLabels = [...labels];
            if (labels.length > 0) {
                const lastTime = new Date(metrics[metrics.length - 1].timestamp);
                for (let i = 1; i <= trendData.predictions.length; i++) {
                    const futureTime = new Date(lastTime.getTime() + i * 3600000);
                    extendedLabels.push(futureTime.toLocaleString());
                }

                const predictionData = new Array(sortedTemp.length).fill(null).concat(trendData.predictions);
                tempDatasets.push({
                    label: 'Predicción',
                    data: predictionData,
                    borderColor: 'rgba(251, 191, 36, 0.7)',
                    borderWidth: 2,
                    borderDash: [2, 2],
                    fill: false,
                    pointRadius: 0,
                    tension: 0
                });
            }

            tempOptions.plugins.legend = {
                display: true,
                labels: { color: '#94a3b8', usePointStyle: true, boxWidth: 8 }
            };

            const tempCanvas = document.getElementById('tempChart');
            if (tempCanvas) {
                const ctx = tempCanvas.getContext('2d');
                if (tempChart) tempChart.destroy();
                tempChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: extendedLabels.length > labels.length ? extendedLabels : labels,
                        datasets: tempDatasets
                    },
                    options: tempOptions
                });
            }
        } else {
            tempChart = createOrUpdateChart(tempChart, 'tempChart', 'line', 'Temperatura (°C)', sortedTemp, '#f97316', true, null, tempOptions);
        }
    } else {
        tempChart = createOrUpdateChart(tempChart, 'tempChart', 'line', 'Temperatura (°C)', sortedTemp, '#f97316', true, null, tempOptions);
    }

    // Special handling for net chart multiple datasets (Network)
    const canvasNet = document.getElementById('netChart');
    if (canvasNet) {
        if (netChart) {
            netChart.data.labels = netLabels;
            netChart.data.datasets[0].data = ratesRx;
            netChart.data.datasets[1].data = ratesTx;
            netChart.data.datasets[0].label = 'RX';
            netChart.data.datasets[1].label = 'TX';
            // Check if capacity dataset exists, if not add it
            if (netChart.data.datasets.length < 3) {
                netChart.data.datasets.push({
                    label: 'Capacity',
                    data: netCapacities,
                    borderColor: '#9ca3af',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0,
                    pointRadius: 0
                });
            } else {
                netChart.data.datasets[2].data = netCapacities;
                netChart.data.datasets[2].label = 'Capacity';
            }
            netChart.update('none');
        } else {
            const ctxNet = canvasNet.getContext('2d');
            const gradRx = getGradient(ctxNet, '#22c55e');
            const gradTx = getGradient(ctxNet, '#3b82f6');

            // Copy options and enable legend for network
            const netOptions = JSON.parse(JSON.stringify(commonOptions));
            netOptions.scales.x.ticks = xAxisTicks; // Restore callback
            netOptions.scales.y.ticks.callback = (value) => formatBits(value);
            netOptions.plugins.tooltip.callbacks = {
                label: (context) => ' ' + context.dataset.label + ': ' + formatBits(context.raw)
            };
            // Ensure legend is visible for network chart
            netOptions.plugins.legend = {
                display: true,
                labels: { color: '#94a3b8', usePointStyle: true, boxWidth: 8 }
            };

            // Add threshold annotations for Network
            const maxCapacity = Math.max(...netCapacities.filter(v => v != null), 1000000000); // 1 Gbps default
            const maxNetPercent = 100;
            netOptions.plugins.annotation = getThresholdAnnotations('network', maxNetPercent);

            netChart = new Chart(ctxNet, {
                type: 'line',
                data: {
                    labels: netLabels,
                    datasets: [
                        {
                            label: 'RX',
                            data: ratesRx,
                            borderColor: '#22c55e',
                            backgroundColor: gradRx,
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointRadius: 0,
                            pointHoverRadius: 5,
                            spanGaps: false
                        },
                        {
                            label: 'TX',
                            data: ratesTx,
                            borderColor: '#3b82f6',
                            backgroundColor: gradTx,
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointRadius: 0,
                            pointHoverRadius: 5,
                            spanGaps: false
                        },
                        {
                            label: 'Capacity',
                            data: netCapacities,
                            borderColor: '#9ca3af',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            fill: false,
                            tension: 0,
                            pointRadius: 0,
                            spanGaps: false
                        }
                    ]
                },
                options: netOptions
            });
        }
    }

    // Disk I/O Chart
    const canvasDiskIO = document.getElementById('diskIOChart');
    if (canvasDiskIO) {
        if (diskIOChart) {
            diskIOChart.data.labels = netLabels;
            diskIOChart.data.datasets[0].data = ratesDiskRead;
            diskIOChart.data.datasets[1].data = ratesDiskWrite;
            diskIOChart.update('none');
        } else {
            const ctxDiskIO = canvasDiskIO.getContext('2d');
            const gradRead = getGradient(ctxDiskIO, '#f97316');
            const gradWrite = getGradient(ctxDiskIO, '#8b5cf6');

            const dioOptions = JSON.parse(JSON.stringify(ramOptions));
            dioOptions.scales.x.ticks = xAxisTicks; // Restore callback
            dioOptions.scales.y.ticks.callback = (value) => formatBytes(value) + '/s';
            dioOptions.plugins.tooltip.callbacks = {
                label: (context) => ' ' + context.dataset.label + ': ' + formatBytes(context.raw) + '/s'
            };
            dioOptions.plugins.legend = {
                display: true,
                labels: { color: '#94a3b8', usePointStyle: true, boxWidth: 8 }
            };

            // Add threshold annotations for Disk I/O
            const maxDiskIO = Math.max(...ratesDiskRead.filter(v => v != null), ...ratesDiskWrite.filter(v => v != null), 500 * 1024 * 1024); // 500 MB/s
            const maxDiskIOMB = maxDiskIO / (1024 * 1024);
            dioOptions.plugins.annotation = getThresholdAnnotations('diskio', maxDiskIOMB);

            diskIOChart = new Chart(ctxDiskIO, {
                type: 'line',
                data: {
                    labels: netLabels,
                    datasets: [
                        {
                            label: 'Lectura',
                            data: ratesDiskRead,
                            borderColor: '#f97316',
                            backgroundColor: gradRead,
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointRadius: 0,
                            spanGaps: false
                        },
                        {
                            label: 'Escritura',
                            data: ratesDiskWrite,
                            borderColor: '#8b5cf6',
                            backgroundColor: gradWrite,
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointRadius: 0,
                            spanGaps: false
                        }
                    ]
                },
                options: dioOptions
            });
        }
    }

    // Availability / Uptime Chart
    const canvasUptime = document.getElementById('uptimeChart');
    if (canvasUptime) {
        // Calculate uptime percentage from is_online data
        let onlineCount = 0;
        const uptimeData = metrics.map(m => {
            const isOnline = m.is_online !== undefined ? m.is_online : true; // Fallback to true if missing (legacy)
            if (isOnline) onlineCount++;
            return isOnline ? 100 : 0;
        });

        const uptimePercentage = metrics.length > 0 ? (onlineCount / metrics.length) * 100 : 0;
        const uptimeValueElem = document.getElementById('uptime-value');
        if (uptimeValueElem) {
            uptimeValueElem.textContent = metrics.length > 0 ? uptimePercentage.toFixed(1) + '%' : '--%';

            // Color based on value
            uptimeValueElem.className = 'val'; // reset
            if (uptimePercentage >= 95) uptimeValueElem.classList.add('text-green-400');
            else if (uptimePercentage >= 80) uptimeValueElem.classList.add('text-amber-400');
            else uptimeValueElem.classList.add('text-red-400');
        }

        if (uptimeChart) {
            uptimeChart.data.labels = netLabels;
            uptimeChart.data.datasets[0].data = uptimeData;
            uptimeChart.update('none');
        } else {
            const ctxUptime = canvasUptime.getContext('2d');

            // Custom options for Uptime
            const uptimeOptions = JSON.parse(JSON.stringify(commonOptions));
            uptimeOptions.scales.x.ticks = xAxisTicks;
            uptimeOptions.scales.y.suggestedMin = 0;
            uptimeOptions.scales.y.suggestedMax = 100;
            uptimeOptions.scales.y.ticks.callback = (value) => value + '%';
            uptimeOptions.plugins.tooltip.callbacks = {
                label: (context) => context.raw === 100 ? 'Online' : 'Offline'
            };

            uptimeChart = new Chart(ctxUptime, {
                type: 'line',
                data: {
                    labels: netLabels,
                    datasets: [{
                        label: 'Disponibilidad',
                        data: uptimeData,
                        borderColor: '#10b981', // Green
                        backgroundColor: getGradient(ctxUptime, '#10b981'),
                        borderWidth: 2,
                        fill: true,
                        tension: 0, // Step-like
                        pointRadius: 0,
                        spanGaps: false
                    }]
                },
                options: uptimeOptions
            });
        }
    }

    // Update anomalies if enabled
    updateAnomalyVisualization();

    // Update forecast if enabled
    updateForecastVisualization();
}


// --- Pod Logs Viewer ---
async function showPodLogs(serverId, namespace, podName, cpu = 0, mem = 0) {
    if (!serverId || !namespace || !podName) return;

    // Create modal if not exists
    let modal = document.getElementById('log-viewer-modal');
    if (!modal) {
        modal = createLogModal();
    }

    const contentEl = document.getElementById('log-viewer-content');
    const titleEl = document.getElementById('log-viewer-title');

    // Format memory (bytes to MB/GB)
    const memFormatted = formatBytes(mem);
    const cpuFormatted = cpu > 0 ? `${cpu.toFixed(3)} cores` : '0m';

    titleEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px;">
            <span>Logs: ${podName}</span>
            <span style="font-size: 0.8rem; background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; color: #94a3b8; font-weight: normal;">
                ${namespace}
            </span>
            <div style="display: flex; gap: 10px; margin-left: 10px; font-size: 0.8rem; font-family: sans-serif;">
                <span style="color: #60a5fa;"><i class="fa-solid fa-microchip"></i> ${cpuFormatted}</span>
                <span style="color: #c084fc;"><i class="fa-solid fa-memory"></i> ${memFormatted}</span>
            </div>
        </div>
    `;

    contentEl.textContent = 'Loading logs...';
    contentEl.style.color = '#e2e8f0';

    modal.style.display = 'flex';

    try {
        const url = `/api/kubernetes/pods/${serverId}/${namespace}/${podName}/logs`;
        console.log(`[LogViewer] Fetching Pod logs from: ${url}`);
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch logs');
        const data = await response.json();

        let cleanLogs = data.logs || 'No logs available.';

        contentEl.textContent = cleanLogs;
    } catch (e) {
        contentEl.textContent = `Error: ${e.message}`;
        contentEl.style.color = '#ef4444';
    }
}

function createLogModal() {
    const modal = document.createElement('div');
    modal.id = 'log-viewer-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8); z-index: 10000;
        display: none; align-items: center; justify-content: center;
        backdrop-filter: blur(5px);
    `;

    modal.innerHTML = `
        <div class="glass-panel" style="width: 80%; height: 80%; display: flex; flex-direction: column; padding: 0; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
            <div style="padding: 15px 20px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02);">
                <h3 id="log-viewer-title" style="margin: 0; font-size: 1.1rem; color: var(--text-primary); font-family: monospace;">Logs</h3>
                <button onclick="document.getElementById('log-viewer-modal').style.display='none'" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1.2rem; padding: 5px;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div style="flex: 1; padding: 0; overflow: auto; background: #0f172a;">
                <pre id="log-viewer-content" style="margin: 0; padding: 20px; font-family: 'Fira Code', monospace; font-size: 0.85rem; line-height: 1.5; color: #e2e8f0; white-space: pre-wrap;"></pre>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close on click outside
    modal.onclick = (e) => {
        if (e.target === modal) modal.style.display = 'none';
    };

    return modal;
}

// --- Container Logs Viewer ---
async function showContainerLogs(type, serverId, containerId, containerName, cpu = 0, mem = 0) {
    if (!serverId || !containerId) return;

    let modal = document.getElementById('log-viewer-modal');
    if (!modal) {
        modal = createLogModal();
    }

    const contentEl = document.getElementById('log-viewer-content');
    const titleEl = document.getElementById('log-viewer-title');

    // Format metrics (Docker stats are usually % for CPU and Bytes for Mem)
    const memFormatted = formatBytes(mem);
    const cpuFormatted = `${cpu.toFixed(2)}%`;

    titleEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px;">
            <span>Logs: ${containerName}</span>
            <span style="font-size: 0.8rem; background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; color: #94a3b8; font-weight: normal;">
                ${containerId.substring(0, 12)} (${type})
            </span>
            <div style="display: flex; gap: 10px; margin-left: 10px; font-size: 0.8rem; font-family: sans-serif;">
                <span style="color: #60a5fa;"><i class="fa-solid fa-microchip"></i> ${cpuFormatted}</span>
                <span style="color: #c084fc;"><i class="fa-solid fa-memory"></i> ${memFormatted}</span>
            </div>
        </div>
    `;

    contentEl.textContent = 'Loading logs...';
    contentEl.style.color = '#e2e8f0';

    modal.style.display = 'flex';

    try {
        const endpoint = type === 'podman'
            ? `/api/podman/containers/${serverId}/${containerId}/logs`
            : `/api/containers/${serverId}/${containerId}/logs`;

        console.log(`[LogViewer] Fetching ${type} logs from: ${endpoint}`);
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error('Failed to fetch logs');
        const data = await response.json();

        contentEl.textContent = data.logs || 'No logs available.';
    } catch (e) {
        contentEl.textContent = `Error: ${e.message}`;
        contentEl.style.color = '#ef4444';
    }
}

// Expose NetworkMap globally for history-map.js
if (typeof NetworkMap !== 'undefined') {
    window.NetworkMap = NetworkMap;
}

