import { state } from './state.js';
import { formatBytes, getStatusColor, getRelativeTime } from './utils.js';

export function isStatusOnline(status) {
    if (!status) return false;
    const s = status.toLowerCase();
    return s === 'online' || s === 'active' || s === 'running' || s === 'up';
}

export function renderHostNodes(containerId = 'host-nodes-container', config = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const hostsData = config.hostsData || state.allHostsCache;
    const customFilter = config.customFilter || null;
    const onHostClick = config.onHostClick || 'selectHost';
    const showOSInfo = config.showOSInfo !== false;
    const showStats = config.showStats !== false;
    const customIcon = config.icon || 'fa-solid fa-server';

    if (!hostsData || hostsData.length === 0) {
        container.innerHTML = '<div class="loading-state" style="opacity:0.6; text-align:center; padding:3rem;">No hay hosts configurados para esta herramienta</div>';
        return;
    }

    let filteredHosts = hostsData;

    if (customFilter) {
        filteredHosts = hostsData.filter(customFilter);
    } else if (state.searchQuery) {
        const hostsWithMatchingVMs = new Set();
        if (state.currentTool === 'kvm') {
            state.allVMsCache.forEach(vm => {
                if (vm.name.toLowerCase().includes(state.searchQuery)) {
                    hostsWithMatchingVMs.add(vm.host_id);
                }
            });
        }

        filteredHosts = hostsData.filter(host => {
            const matchesHost = host.server_name?.toLowerCase().includes(state.searchQuery) ||
                host.hostname?.toLowerCase().includes(state.searchQuery) ||
                host.ip_address?.toLowerCase().includes(state.searchQuery) ||
                (host.os_name && host.os_name.toLowerCase().includes(state.searchQuery));

            return matchesHost || hostsWithMatchingVMs.has(host.id);
        });
    }

    if (filteredHosts.length === 0) {
        container.innerHTML = '<div class="loading-state">No se encontraron resultados para "' + state.searchQuery + '"</div>';
        return;
    }

    // MEMOIZATION: Only update innerHTML if data has changed
    const dataHash = JSON.stringify(filteredHosts.map(h => ({ id: h.id, status: h.status || h.service_status, cpu: h.cpu_usage })));
    if (container.dataset.lastHash === dataHash) return;
    container.dataset.lastHash = dataHash;

    container.innerHTML = filteredHosts.map(host => {
        const memTotal = host.total_memory || 0;
        const memFree = host.free_memory || 0;
        const memTotalGB = (memTotal / (1024 * 1024 * 1024)).toFixed(1);
        const memFreeGB = (memFree / (1024 * 1024 * 1024)).toFixed(1);
        const memUsedGB = (parseFloat(memTotalGB) - parseFloat(memFreeGB)).toFixed(1);
        const memPercent = memTotal > 0 ? (((memTotal - memFree) / memTotal) * 100).toFixed(0) : 0;

        const cpuPercent = host.cpu_usage ? host.cpu_usage.toFixed(0) : 0;

        const isActive = (state.selectedHostId === host.id ||
            state.selectedFirewallHostId === host.id ||
            state.selectedDockerHostId === host.id ||
            state.selectedKubernetesServerId === host.id ||
            state.selectedKubernetesNodeId === host.id ||
            state.selectedPodmanHostId === host.id ||
            state.selectedProxmoxHostId === host.id ||
            state.selectedNasHostId === host.id) ? 'active' : '';

        // Note: we might need to export more caches to state.js to make this cleaner
        let serverCache = state.currentServers;
        if (state.currentTool === 'pfsense') serverCache = state.currentFirewallServers;
        else if (state.currentTool === 'docker') serverCache = state.currentDockerServers;
        else if (state.currentTool === 'podman') serverCache = state.currentPodmanServers;
        else if (state.currentTool === 'kubernetes') serverCache = state.currentKubernetesServers;
        else if (state.currentTool === 'proxmox') serverCache = state.currentProxmoxServers;
        else if (state.currentTool === 'nas') serverCache = state.currentNasServers;

        const serverConfig = serverCache.find(s => s.id === host.server_id);
        const rawStatus = host.status || host.service_status || host.docker_service_status || host.podman_service_status || (serverConfig ? serverConfig.status : null);
        const isOnline = isStatusOnline(rawStatus);

        let arch = host.architecture || '';
        if (!arch) {
            const fullInfo = ((host.cpu_model || '') + ' ' + (host.os_name || '')).toLowerCase();
            if (fullInfo.includes('amd64') || fullInfo.includes('x86_64')) arch = 'x86_64';
            else if (fullInfo.includes('arm') || fullInfo.includes('aarch64')) arch = 'ARM';
        }

        const offlineTime = (!isOnline && host.offline_since) ? getRelativeTime(new Date(host.offline_since)) : null;
        const offlineTooltip = offlineTime ? `Fuera de línea desde ${offlineTime}` : '';

        return `
        <div class="host-node-card glass-panel ${isActive}" onclick="window.${onHostClick}(${host.id})">
            <div class="host-node-header">
                <div class="host-node-identity">
                    <div class="host-icon-box">
                        <i class="${customIcon}"></i>
                    </div>
                    <div class="host-title-group">
                        <h3>${host.server_name || host.name || 'Unknown'}</h3>
                        <div class="ip-badge">${host.ip_address || (host.tool_type === 'kubernetes' ? 'Cluster' : 'N/A')}</div>
                    </div>
                </div>
                <div class="host-status-badge ${isOnline ? '' : 'offline'}" title="${offlineTooltip}">
                    <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
                    ${isOnline ? (host.status || host.service_status || 'ONLINE').toUpperCase() : 'OFFLINE'}
                </div>
            </div>
            
            ${showStats ? `
            <div class="host-stats-grid">
                <div class="host-stat-item">
                    <div class="stat-label-row">
                        <i class="fa-solid fa-microchip"></i>
                        <span>CPU</span>
                    </div>
                    <div class="stat-value-display">
                        <div class="stat-value-main color-cpu">${cpuPercent}%</div>
                        <div class="host-progress-container">
                            <div class="host-progress-fill" style="width: ${cpuPercent}%; background: ${getStatusColor(cpuPercent)};"></div>
                        </div>
                    </div>
                </div>
                <div class="host-stat-item">
                    <div class="stat-label-row">
                        <i class="fa-solid fa-memory"></i>
                        <span>RAM</span>
                    </div>
                    <div class="stat-value-display">
                        <div class="stat-value-main color-mem">${memPercent}%</div>
                        <div class="host-progress-container">
                            <div class="host-progress-fill" style="width: ${memPercent}%; background: ${getStatusColor(memPercent)};"></div>
                        </div>
                        <div class="stat-value-sub">${memUsedGB}/${memTotalGB}GB</div>
                    </div>
                </div>
                <div class="host-stat-item">
                    <div class="stat-label-row">
                        <i class="fa-solid fa-microchip"></i>
                        <span>${arch ? 'ARCH' : 'CORES'}</span>
                    </div>
                    <div class="stat-value-display">
                        <div class="stat-value-main color-cores" style="font-size: ${arch ? '0.85rem' : '1.2rem'};">${arch || host.cpu_cores || 'N/A'}</div>
                    </div>
                </div>
            </div>
            ` : ''}

            ${showOSInfo ? `
            <div class="host-node-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.05);">
                <div class="host-os-info">
                     <i class="fa-brands fa-linux"></i> <span>${host.os_name || (host.tool_type === 'kubernetes' ? 'K8s Cluster' : 'Linux')}</span>
                </div>
                <div class="host-uptime" style="font-size: 0.75rem; color: var(--text-secondary); opacity: 0.7; display: flex; align-items: center; gap: 4px;">
                    <i class="fa-solid fa-clock"></i> <span>${host.uptime || 'N/A'}</span>
                </div>
            </div>
            ` : ''}
        </div>
        `;
    }).join('');
}

export function renderDonutChart(percent, color, size = 50) {
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

export function renderSparkline(data, color, width = 100, height = 30) {
    if (!data || data.length < 2) return '';
    const max = Math.max(...data, 1);
    const points = data.map((val, idx) => {
        const x = (idx / (state.HISTORY_POINTS - 1)) * width;
        const y = height - ((val / max) * height);
        return `${x},${y}`;
    }).join(' ');

    return `
        <svg width="${width}" height="${height}" fill="none" class="sparkline">
            <polyline points="${points}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        </svg>
    `;
}
