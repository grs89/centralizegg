import { state } from './state.js';
import { API_HOSTS, API_VMS } from './api.js';
import { formatBytes, getStatusColor, getOSIcon, playAlertSound } from './utils.js';
import { renderHostNodes, renderDonutChart, renderSparkline, isStatusOnline } from './ui-components.js';
import { updateNetworkHistory, updateBridgeHistory } from './history.js';

export {
    updateNetworkHistory,
    updateBridgeHistory,
    renderHostEvents,
    fetchHosts,
    renderHosts,
    selectHost,
    fetchVMs,
    startVM,
    stopVM,
    renderVMs
};

function renderHostEvents(host_events_json, type = 'host') {
    let events = [];
    try {
        if (host_events_json) events = JSON.parse(host_events_json);
    } catch (e) { console.error(`Error parsing ${type} host events`, e); }

    if (events.length === 0) {
        return `
            <div style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary); opacity: 0.6; font-size: 0.8rem; padding: 20px; background: rgba(255,255,255,0.02); border-radius: 12px; justify-content: center; border: 1px dashed var(--glass-border);">
                <i class="fa-solid fa-circle-info" style="color: var(--accent-color);"></i>
                <span>No hay eventos de ${type} registrados recientemente</span>
            </div>`;
    }
    return `
        <div class="host-events-log" style="background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); border-radius: 12px; padding: 15px; font-family: 'Fira Code', 'Cascadia Code', monospace; font-size: 0.75rem; max-height: 250px; overflow-y: auto; scrollbar-width: thin; -webkit-overflow-scrolling: touch;">
            ${events.map(event => {
        const isError = event.toLowerCase().includes('error') || event.toLowerCase().includes('fail') || event.toLowerCase().includes('warning') || event.toLowerCase().includes('critical');
        const color = isError ? '#f87171' : '#cbd5e1';

        let logContent = event;
        let timestamp = "";

        const tsMatch = event.match(/^([A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})(.*)/) ||
            event.match(/^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[^\s]*)(.*)/) ||
            event.match(/^(\[\s*\d+\.\d+\])(.*)/);

        if (tsMatch) {
            timestamp = tsMatch[1];
            logContent = tsMatch[2].trim();
        }

        return `
            <div style="color: ${color}; border-bottom: 1px solid rgba(255,255,255,0.03); padding: 6px 0; line-height: 1.5; display: flex; gap: 10px; align-items: baseline;">
                ${timestamp ? `<span style="color: var(--accent-color); opacity: 0.8; font-weight: bold; white-space: nowrap; font-size: 0.7rem;">[${timestamp}]</span>` : '<span style="color: var(--accent-color); opacity: 0.5; font-weight: bold;">[LOG]</span>'}
                <span style="word-break: break-all;">${logContent}</span>
            </div>
        `;
    }).join('')}
        </div>
    `;
}

async function fetchHosts() {
    try {
        const response = await fetch(API_HOSTS);
        if (!response.ok) throw new Error('Failed to fetch hosts');
        const hosts = await response.json();

        if (hosts && Array.isArray(hosts)) {
            hosts.sort((a, b) => a.server_name.localeCompare(b.server_name));
        }

        state.allKVMHostsCache = hosts || [];
        state.allHostsCache = hosts || [];
        if (state.allHostsCache.length > 0) {
            updateBridgeHistory(state.allHostsCache);
        }
        renderHosts();
    } catch (e) {
        console.error(e);
    }
}

function renderHosts() {
    renderHostNodes('host-nodes-container', {
        icon: 'fa-solid fa-server',
        showOSInfo: true,
        showStats: true
    });
}

function selectHost(id) {
    if (state.selectedHostId !== id) {
        state.selectedHostId = id;
        state.lastRenderedVMsHash = "";
    }
    renderHosts();
    renderVMs();
}

async function fetchVMs() {
    try {
        const response = await fetch(API_VMS);
        if (!response.ok) throw new Error('Failed to fetch VMs');
        const vms = await response.json();

        if (vms && Array.isArray(vms)) {
            vms.sort((a, b) => a.name.localeCompare(b.name));
        }

        state.allVMsCache = vms || [];
        updateNetworkHistory(state.allVMsCache);
        renderVMs();
    } catch (e) {
        console.error(e);
    }
}

async function startVM(serverID, vmName) {
    try {
        const response = await fetch(`/api/kvm/vms/${serverID}/${vmName}/start`, { method: 'POST' });
        if (response.ok) {
            console.log(`[KVM] VM ${vmName} started`);
            fetchVMs(); // Refresh UI
        } else {
            const err = await response.text();
            console.error(`[KVM] Failed to start VM: ${err}`);
            alert(`Error starting VM: ${err}`);
        }
    } catch (e) {
        console.error(e);
    }
}

async function stopVM(serverID, vmName) {
    try {
        const response = await fetch(`/api/kvm/vms/${serverID}/${vmName}/stop`, { method: 'POST' });
        if (response.ok) {
            console.log(`[KVM] VM ${vmName} stopped`);
            fetchVMs(); // Refresh UI
        } else {
            const err = await response.text();
            console.error(`[KVM] Failed to stop VM: ${err}`);
            alert(`Error stopping VM: ${err}`);
        }
    } catch (e) {
        console.error(e);
    }
}

function renderVMs() {
    const grid = document.getElementById('vm-grid');
    if (!grid) return;

    if (!state.selectedHostId) {
        grid.innerHTML = '<div class="loading-state" style="opacity:0.6;"><i class="fa-solid fa-arrow-up"></i> Selecciona un Host Node para ver sus VMs</div>';
        return;
    }

    let filteredVMs = state.allVMsCache.filter(vm => vm.host_id === state.selectedHostId);
    if (state.searchQuery) {
        filteredVMs = filteredVMs.filter(vm =>
            vm.name.toLowerCase().includes(state.searchQuery) ||
            vm.state.toLowerCase().includes(state.searchQuery)
        );
    }

    const host = state.allHostsCache.find(h => h.id === state.selectedHostId);
    if (!host) return;

    const rawStatus = host.status || host.service_status || 'UNKNOWN';
    const isHostOnline = isStatusOnline(rawStatus);

    const hostInfoLeft = document.getElementById('vm-host-info-left');
    const isAlreadyRenderingHost = hostInfoLeft &&
        hostInfoLeft.getAttribute('data-host-id') === String(state.selectedHostId) &&
        isHostOnline;

    const renderBridgesList = () => {
        let bridges = [];
        try {
            if (host.bridge_interfaces) bridges = JSON.parse(host.bridge_interfaces);
        } catch (e) { console.error("Error parsing bridge interfaces", e); }

        if (bridges.length === 0) return '<div style="opacity:0.5; font-size:0.85rem; padding: 5px;">No bridge interfaces</div>';

        return bridges.map(br => {
            const net = state.bridgeNetworkHistory[`${host.id}_${br.name}`] || { rx: [], tx: [] };
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

    const renderHostEventsUI = () => {
        return `
            <div class="glass-panel" style="padding: 20px; margin-top: 25px;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); width: 100%; display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid fa-terminal" style="color: var(--accent-color); font-size: 1rem;"></i>
                    Eventos del host (KVM)
                </div>
                <div id="kvm-host-events">
                    ${renderHostEvents(host.host_events, 'KVM')}
                </div>
            </div>
        `;
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
            const cpuPercent = (vm.cpu_usage || 0).toFixed(0);
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

            const net = state.vmNetworkHistory[vm.id] || { rx: [], tx: [] };
            const currentRx = net.rx.length > 0 ? net.rx[net.rx.length - 1] : 0;
            const currentTx = net.tx.length > 0 ? net.tx[net.tx.length - 1] : 0;

            return `
                <div class="vm-row state-${vm.state.toLowerCase()}" style="grid-template-columns: ${gridCols};">
                    <div style="display: flex; align-items: center; gap: 12px; overflow: hidden;">
                        <button onclick="${isRunning ? 'stopVM' : 'startVM'}(${vm.host_id}, '${vm.name}')"
                                title="${isRunning ? 'Detener VM' : 'Iniciar VM'}"
                                style="background: none; border: none; padding: 0; cursor: pointer; display: flex; align-items: center; transition: transform 0.2s;"
                                onmouseover="this.style.transform='scale(1.2)'"
                                onmouseout="this.style.transform='scale(1)'">
                            <i class="fa-solid fa-desktop" style="color: ${isRunning ? '#4ade80' : '#ef4444'}; font-size: 1.1rem; opacity: 0.8;"></i>
                        </button>
                        <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden;">
                            <span style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${vm.name}">${vm.name}</span>
                            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.7rem; font-weight: 400; color: var(--text-secondary); opacity: 0.8;">
                                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${osName}">${osName}</span>
                                <span style="opacity: 0.4;">•</span>
                                <span style="color: var(--accent-color); font-family: monospace;">${primaryIp}</span>
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <div style="font-size: 0.85rem; font-weight: 600; color: ${getStatusColor(cpuPercent)};">${cpuPercent}%</div>
                        <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                            <div style="height: 100%; width: ${cpuPercent}%; background: ${getStatusColor(cpuPercent)};"></div>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <div style="font-size: 0.85rem; font-weight: 600; color: ${getStatusColor(memPercent)};">
                            ${memPercent}% <span style="font-size: 0.7rem; font-weight: 400; opacity: 0.6; margin-left: 4px;">${memUsedGB}/${memTotalGB}G</span>
                        </div>
                        <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                            <div style="height: 100%; width: ${memPercent}%; background: ${getStatusColor(memPercent)};"></div>
                        </div>
                    </div>
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
                    <div style="display: flex; flex-direction: column; gap: 4px;">
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

        const eventsEl = document.getElementById('kvm-host-events');
        if (eventsEl) eventsEl.innerHTML = renderHostEvents(host.host_events, 'KVM');

        const vmListEl = document.getElementById('kvm-vm-list-rows');
        if (vmListEl) vmListEl.innerHTML = renderVMRows();

        if (window.KVMTopologyMap) {
            if (!window.currentKVMMap) {
                window.currentKVMMap = new KVMTopologyMap('kvm-network-map-container');
            }
            window.currentKVMMap.render(host.bridge_interfaces, filteredVMs);
        }

        return;
    }

    if (hostInfoLeft) {
        hostInfoLeft.setAttribute('data-host-id', state.selectedHostId);
        hostInfoLeft.innerHTML = `
            <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">Sistema y Red</div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">Sistema Operativo</div>
                        <div id="kvm-host-updates">
                            ${host.update_status && host.update_status.includes('Updates Available')
                ? `<span style="color: #facc15; font-size: 0.65rem; background: rgba(234, 179, 8, 1.0); border: 1px solid rgba(234, 179, 8, 0.2); padding: 1px 6px; border-radius: 4px; font-weight: 600; display: flex; align-items: center; gap: 4px;"><i class="fa-solid fa-circle-exclamation"></i> ${host.update_status.replace('Updates Available', 'Actualizaciones')}</span>`
                : '<span style="color: #4ade80; font-size: 0.65rem; background: rgba(34, 197, 94, 0.05); border: 1px solid rgba(34, 197, 94, 0.1); padding: 1px 6px; border-radius: 4px; font-weight: 600;">Actualizado</span>'}
                        </div>
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                        <i class="${getOSIcon(host.os_name)} fa-fw" style="font-size: 0.8rem; opacity: 0.8;"></i> ${host.os_name || 'Generic Linux'}
                    </div>
                </div>
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px;">
                    <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary); margin-bottom: 6px;">Tiempo de Actividad</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                        <i class="fa-solid fa-clock-rotate-left fa-fw" style="font-size: 0.8rem; opacity: 0.8;"></i> <span id="kvm-host-uptime">${host.uptime || 'Desconocido'}</span>
                    </div>
                </div>
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 10px; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-temperature-three-quarters" style="color: var(--text-secondary);"></i>
                        <span style="font-size: 0.9rem; color: var(--text-secondary);">Temperatura</span>
                    </div>
                    <div id="kvm-host-temp">
                        ${(() => {
                const temp = host.temperature;
                if (!temp || temp <= 0) return '<div style="font-weight: 500; font-size: 0.9rem; color: var(--text-secondary); opacity: 0.7;">Unknown</div>';
                let color = '#4ade80';
                if (temp >= 50) color = '#facc15';
                if (temp >= 70) color = '#ef4444';
                return `<div style="font-weight: 600; font-size: 1.1rem; color: ${color};">${temp}°C</div>`;
            })()}
                    </div>
                </div>
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
                            </div>`).join('')}
                     </div>
                </div>
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-top: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">Interfaces Bridge</div>
                <div id="kvm-host-bridges" style="display: flex; flex-direction: column; gap: 8px;">${renderBridgesList()}</div>
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-top: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">Almacenamiento</div>
                <div id="kvm-host-storage" style="display: flex; flex-direction: column; gap: 10px;">${renderStorageList()}</div>
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; padding-bottom: 10px; margin-top: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">Avisos del Sistema</div>
                <div id="kvm-host-alerts" style="display: flex; flex-direction: column; gap: 10px;">${renderKvmAlerts()}</div>
            </div>
        `;
    }


    if (!isHostOnline) {
        grid.innerHTML = `
            <div style="width: 100%; padding: 20px; text-align: center; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; margin-bottom: 20px;">
                <i class="fa-solid fa-triangle-exclamation" style="color: #ef4444; font-size: 1.5rem; margin-bottom: 10px;"></i>
                <div style="color: #fca5a5; font-weight: 500;">Host Offline</div>
                <div style="color: rgba(255,255,255,0.6); font-size: 0.85rem; margin-top: 5px;">
                    No se puede conectar con el host para obtener o gestionar el estado de las VMs.
                </div>
            </div>
            <div style="opacity: 0.5; pointer-events: none;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); width: 100%;">Máquinas Virtuales (Último estado conocido)</div>
                 <div class="vm-list-header" style="display: grid; grid-template-columns: ${gridCols}; gap: 15px; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 8px;">
                    <div>Nombre / Sistema</div><div>CPU</div><div>Memoria</div><div>Disco</div><div>RED (RX/TX)</div>
                </div>
                <div id="kvm-vm-list-rows" style="display: flex; flex-direction: column; gap: 4px;">${renderVMRows()}</div>
            </div>
            <div style="width: 100%; margin-top: 30px; opacity: 0.6;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); width: 100%; display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid fa-terminal" style="color: var(--accent-color); font-size: 1rem;"></i>Eventos del host
                </div>
                <div id="kvm-host-events">${renderHostEventsUI()}</div>
            </div>
         `;
    } else {
        grid.innerHTML = `
            <div style="width: 100%; padding-bottom: 10px;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); width: 100%;">Máquinas Virtuales</div>
                <div class="vm-list-header" style="display: grid; grid-template-columns: ${gridCols}; gap: 15px; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 8px;">
                    <div>Nombre / Sistema</div><div>CPU</div><div>Memoria</div><div>Disco</div><div>RED (RX/TX)</div>
                </div>
                <div id="kvm-vm-list-rows" style="display: flex; flex-direction: column; gap: 4px;">${renderVMRows()}</div>
            </div>
            <div id="kvm-network-map-container" style="width: 100%; margin-top: 25px; margin-bottom: 25px;"></div>
            <div style="width: 100%; margin-top: 30px;">
                <div style="font-size: 1.1rem; font-weight: 500; color: var(--text-secondary); opacity: 0.9; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); width: 100%; display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid fa-terminal" style="color: var(--accent-color); font-size: 1rem;"></i>Eventos del host
                </div>
                <div id="kvm-host-events">${renderHostEventsUI()}</div>
            </div>
        `;

        if (window.KVMTopologyMap) {
            if (!window.currentKVMMap) {
                window.currentKVMMap = new KVMTopologyMap('kvm-network-map-container');
            }
            window.currentKVMMap.render(host.bridge_interfaces, filteredVMs);
        }
    }
}
