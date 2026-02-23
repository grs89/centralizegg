import { getRelativeTime } from './utils.js';

const CATEGORY_ICONS = {
    'Virtualización (KVM)': 'fa-microchip',
    'Virtualización (Proxmox)': 'fa-server',
    'Contenedores (Docker)': 'fa-brands fa-docker',
    'Contenedores (Podman)': 'fa-otter',
    'Kubernetes (Nodos)': 'fa-dharmachakra',
    'Almacenamiento (NAS)': 'fa-hdd',
    'Almacenamiento (Ceph)': 'fa-cubes',
    'Red (pfSense)': 'fa-shield-halved'
};

const CATEGORY_TO_TOOL = {
    'Virtualización (KVM)': 'kvm',
    'Virtualización (Proxmox)': 'proxmox',
    'Contenedores (Docker)': 'docker',
    'Contenedores (Podman)': 'podman',
    'Kubernetes (Nodos)': 'kubernetes',
    'Almacenamiento (NAS)': 'nas',
    'Almacenamiento (Ceph)': 'ceph',
    'Red (pfSense)': 'pfsense'
};

let summaryInterval = null;

export async function initSummaryDashboard() {
    const grid = document.getElementById('summary-health-grid');
    const alertsList = document.getElementById('summary-alerts-list');

    if (!grid || !alertsList) return;

    // Clear existing interval if any
    if (summaryInterval) {
        clearInterval(summaryInterval);
        summaryInterval = null;
    }

    const loadData = async () => {
        try {
            const resp = await fetch('/api/health/summary');
            if (!resp.ok) throw new Error('API response not ok');
            const data = await resp.json();

            renderHealthGrid(data.overall_health || []);
            renderAlerts(data.recent_alerts || []);
            renderNetworkSparklines();
        } catch (err) {
            console.error('Failed to load health summary:', err);
            // Only show error on empty grid to avoid flickering existing data
            const healthGrid = document.getElementById('summary-health-grid');
            if (healthGrid && healthGrid.children.length === 0) {
                healthGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: #ef4444;">
                    <i class="fa-solid fa-circle-exclamation" style="font-size: 2rem;"></i>
                    <p>Error al cargar el estado de salud: ${err.message}</p>
                </div>`;
            }
        }
    };

    // Initialize SortableJS for Dashboard Widgets
    const widgetsContainer = document.getElementById('summary-dashboard-widgets');
    if (widgetsContainer && typeof Sortable !== 'undefined') {
        // Load saved order (filter out widget IDs that no longer exist in the DOM)
        const savedOrder = localStorage.getItem('centralizegg_dashboard_order');
        if (savedOrder) {
            try {
                const orderArray = JSON.parse(savedOrder);
                const validIds = orderArray.filter(id => widgetsContainer.querySelector(`[data-widget-id="${id}"]`));
                // Reorder DOM elements based on saved array
                validIds.forEach(id => {
                    const el = widgetsContainer.querySelector(`[data-widget-id="${id}"]`);
                    if (el) {
                        widgetsContainer.appendChild(el);
                    }
                });
                // If saved order is stale (contains removed widgets), clean it up
                if (validIds.length !== orderArray.length) {
                    localStorage.setItem('centralizegg_dashboard_order', JSON.stringify(validIds));
                }
            } catch (e) {
                console.error('Failed to parse dashboard order', e);
                localStorage.removeItem('centralizegg_dashboard_order');
            }
        }

        // Init Sortable
        Sortable.create(widgetsContainer, {
            animation: 250,
            handle: '.widget-header', // drag handle
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: function () {
                // Save new order
                const newOrder = Array.from(widgetsContainer.children).map(el => el.getAttribute('data-widget-id'));
                localStorage.setItem('centralizegg_dashboard_order', JSON.stringify(newOrder));
            }
        });
    }

    // Initial load
    await loadData();

    // Auto-refresh every 10 seconds
    summaryInterval = setInterval(loadData, 10000);
}

function renderHealthGrid(health) {
    const grid = document.getElementById('summary-health-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (health.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px; opacity:0.5;">No hay datos de infraestructura disponibles.</div>';
        return;
    }

    health.forEach(item => {
        const card = document.createElement('div');
        card.className = 'glass-panel health-card';
        card.style.padding = '18px 22px';
        card.style.borderRadius = '16px';
        card.style.position = 'relative';
        card.style.overflow = 'hidden';
        card.style.transition = 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        card.style.border = '1px solid var(--glass-border)';

        // Add pointer cursor + click handler if tool exists
        const toolKey = CATEGORY_TO_TOOL[item.category];
        if (toolKey) {
            card.style.cursor = 'pointer';
            card.onclick = () => {
                if (window.switchTool) {
                    window.switchTool(toolKey);
                } else {
                    console.warn('switchTool not found globally');
                }
            };
        }

        const hasNoHosts = item.total === 0;
        const isCritical = item.offline > 0;

        let statusColor = '#10b981'; // Green (Operational)
        let statusIcon = 'fa-check';
        let statusText = 'Operativo';

        if (isCritical) {
            statusColor = '#ef4444'; // Red (Critical)
            statusIcon = 'fa-triangle-exclamation';
            statusText = `${item.offline} Offline`;
            if (item.max_offline_since) {
                const timeStr = getRelativeTime(new Date(item.max_offline_since));
                statusText += ` (desde ${timeStr})`;
            }
        } else if (hasNoHosts) {
            statusColor = '#94a3b8'; // Slate (Inactive/Empty)
            statusIcon = 'fa-circle-minus';
            statusText = 'Sin configurar';
        }

        const icon = CATEGORY_ICONS[item.category] || 'fa-circle-nodes';
        const progress = hasNoHosts ? 0 : (item.online / item.total) * 100;

        card.innerHTML = `
            <div class="card-glow" style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, ${statusColor}0a 0%, transparent 70%); pointer-events: none;"></div>
            <div style="position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: ${statusColor}; border-radius: 0 4px 4px 0; box-shadow: 0 0 10px ${statusColor}30;"></div>
            
            <div style="display: flex; justify-content: space-between; align-items: flex-start; position: relative; z-index: 1;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 2px;">
                    <div style="width: 28px; height: 28px; background: var(--panel-item-bg); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 0.9rem;">
                        <i class="fa-solid ${icon}"></i>
                    </div>
                    <h4 style="margin: 0; font-size: 0.75rem; opacity: 0.5; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 700;">${item.category}</h4>
                </div>
                <div class="status-dot ${isCritical ? 'offline' : (hasNoHosts ? 'inactive' : 'online')}" 
                     title="${isCritical && item.max_offline_since ? `Última caída: ${getRelativeTime(new Date(item.max_offline_since))}` : ''}"
                     style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor}; box-shadow: 0 0 8px ${statusColor}aa;">
                </div>
            </div>

            <div style="font-size: 1.8rem; font-weight: 800; margin: 10px 0 2px 0; color: var(--text-primary); letter-spacing: -0.5px; display: flex; align-items: baseline; gap: 6px;">
                ${item.online} 
                <span style="font-size: 1rem; opacity: 0.15; font-weight: 400;">/ ${item.total}</span>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 12px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem;">
                    <span style="opacity: 0.4;">Uso de sistemas</span>
                    <span style="color: ${statusColor}; font-weight: 700; opacity: ${hasNoHosts ? 0.3 : 1};">${progress.toFixed(0)}%</span>
                </div>
                <div style="height: 4px; background: var(--panel-item-bg); border-radius: 10px; overflow: hidden;">
                    <div style="width: ${progress}%; height: 100%; background: ${hasNoHosts ? '#334155' : 'linear-gradient(90deg, #10b981, #34d399)'}; border-radius: 10px; transition: width 1s ease-out;"></div>
                </div>
            </div>

            <div style="font-size: 0.75rem; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--panel-item-border); display: flex; justify-content: space-between; align-items: center;">
                <span style="color: ${statusColor}; opacity: ${isCritical || hasNoHosts ? 0.9 : 0.5}; font-weight: 500;">
                    <i class="fa-solid ${statusIcon}" style="font-size:0.7rem;"></i> ${statusText}
                </span>
                <span style="font-size: 0.65rem; opacity: 0.2;">${item.total} Host(s)</span>
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderAlerts(alerts) {
    const list = document.getElementById('summary-alerts-list');
    if (!list) return;

    // Apply horizontal container class
    list.className = 'alerts-horizontal-feed';

    if (!alerts || alerts.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 60px; opacity: 0.4;">
                <div style="font-size: 3.5rem; color: #10b981; margin-bottom: 20px; filter: drop-shadow(0 0 15px #10b98140);">
                    <i class="fa-solid fa-circle-check"></i>
                </div>
                <p style="font-size: 1.1rem; color: var(--text-primary); font-weight: 600;">Todo funciona correctamente</p>
                <p style="font-size: 0.9rem; margin-top: 5px;">No se han detectado incidentes ni eventos anormales.</p>
            </div>
        `;
        return;
    }

    // Group alerts by Host/Source
    const grouped = {};
    alerts.forEach(alert => {
        let meta = {};
        try { meta = JSON.parse(alert.metadata || '{}'); } catch (e) { }

        // Identify unique key for the host (ID preferred, else Name, else Source)
        const hostId = meta.server_id || meta.host_id || meta.id || meta.node_id;
        const hostName = meta.name || meta.hostname || alert.source;
        const groupKey = hostId ? `${alert.source}_${hostId}` : hostName;

        if (!grouped[groupKey]) {
            grouped[groupKey] = {
                key: groupKey,
                source: alert.source,
                hostName: hostName,
                hostId: hostId,
                tool: 'kvm', // default, will refine
                alerts: [],
                maxSeverityVal: 0 // to sort or color code headers
            };

            // Refine Tool/Icon logic once per group
            const src = alert.source.toLowerCase();
            if (src.includes('podman')) grouped[groupKey].tool = 'podman';
            else if (src.includes('docker')) grouped[groupKey].tool = 'docker';
            else if (src.includes('kubernetes')) grouped[groupKey].tool = 'kubernetes';
            else if (src.includes('proxmox')) grouped[groupKey].tool = 'proxmox';
            else if (src.includes('kvm')) grouped[groupKey].tool = 'kvm';
            else if (src.includes('nas') || src.includes('storage')) grouped[groupKey].tool = 'nas';
            else if (src.includes('ceph')) grouped[groupKey].tool = 'ceph';
            else if (src.includes('pfsense') || src.includes('firewall')) grouped[groupKey].tool = 'pfsense';
        }

        // Add alert to group
        grouped[groupKey].alerts.push(alert);

        // Track max severity for the group badge
        const sev = alert.severity.toLowerCase();
        let currentSevVal = 1; // Info
        if (sev === 'warning' || sev === 'warn') currentSevVal = 2;
        if (sev.includes('error') || sev.includes('crit') || sev.includes('fail')) currentSevVal = 3;

        if (currentSevVal > grouped[groupKey].maxSeverityVal) {
            grouped[groupKey].maxSeverityVal = currentSevVal;
        }
    });

    list.innerHTML = '';

    // Render Groups
    Object.values(grouped).forEach((group, idx) => {
        const groupItem = document.createElement('div');
        groupItem.className = 'glass-panel alert-group-card';
        groupItem.style.margin = '0';
        groupItem.style.overflow = 'hidden';
        groupItem.style.borderRadius = '16px';
        groupItem.style.border = '1px solid var(--glass-border)';
        groupItem.style.background = 'rgba(255,255,255,0.02)';
        groupItem.style.display = 'flex';
        groupItem.style.flexDirection = 'column';
        groupItem.style.maxHeight = '350px';
        groupItem.style.animation = `fadeInRight 0.4s ease-out forwards ${idx * 0.1}s`;
        groupItem.style.opacity = '0';

        // Determine Header Color based on max severity
        let headerColor = '#38bdf8';
        let headerIcon = 'fa-circle-info';
        if (group.maxSeverityVal === 2) { headerColor = '#f59e0b'; headerIcon = 'fa-triangle-exclamation'; }
        if (group.maxSeverityVal === 3) { headerColor = '#ef4444'; headerIcon = 'fa-circle-xmark'; }

        // Mapped Source Name
        let friendlySource = group.source;
        const srcLower = group.source.toLowerCase();
        if (srcLower.includes('podman')) friendlySource = 'Podman';
        else if (srcLower.includes('docker')) friendlySource = 'Docker';
        else if (srcLower.includes('kubernetes')) friendlySource = 'Kubernetes';
        else if (srcLower.includes('proxmox')) friendlySource = 'Proxmox';
        else if (srcLower.includes('kvm')) friendlySource = 'KVM';
        else if (srcLower.includes('nas')) friendlySource = 'NAS';
        else if (srcLower.includes('ceph')) friendlySource = 'Ceph';
        else if (srcLower.includes('pfsense')) friendlySource = 'Firewall';

        // Use friendly source if the hostName is effectively the raw source because of missing metadata
        let displayTitle = group.hostName;
        if (displayTitle === group.source || displayTitle === srcLower) {
            displayTitle = `${friendlySource} Host`;
        }

        // Header HTML
        const headerDiv = document.createElement('div');
        headerDiv.style.padding = '14px 16px';
        headerDiv.style.display = 'flex';
        headerDiv.style.alignItems = 'center';
        headerDiv.style.justifyContent = 'space-between';
        headerDiv.style.background = `linear-gradient(90deg, ${headerColor}0a 0%, transparent 100%)`;
        headerDiv.style.borderLeft = `4px solid ${headerColor}`;

        headerDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 32px; height: 32px; background: var(--panel-item-bg); border-radius: 8px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--panel-item-border);">
                   <i class="fa-solid ${headerIcon}" style="color: ${headerColor};"></i>
                </div>
                <div>
                     <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary);">${displayTitle}</div>
                     <div style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.7;">
                        <span style="font-weight:600; color: ${headerColor};">${group.alerts.length}</span> eventos
                     </div>
                </div>
            </div>
            ${group.hostId ? `<i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.85rem; opacity:0.4; transition: opacity 0.2s; cursor: pointer;" title="Ir al Host" id="nav-${idx}"></i>` : ''}
        `;

        // Body HTML (Visible by default in horizontal layout)
        const bodyDiv = document.createElement('div');
        bodyDiv.style.flex = '1';
        bodyDiv.style.overflowY = 'auto';
        bodyDiv.style.padding = '5px 0';
        bodyDiv.style.background = 'rgba(0,0,0,0.1)';
        bodyDiv.style.borderTop = '1px solid var(--panel-item-border)';
        bodyDiv.className = 'custom-scrollbar';

        // Render individual alerts inside body
        group.alerts.forEach((alert, aIdx) => {
            const row = document.createElement('div');
            row.style.padding = '10px 16px';
            row.style.borderBottom = aIdx < group.alerts.length - 1 ? '1px solid var(--panel-item-border)' : 'none';
            row.style.display = 'flex';
            row.style.gap = '10px';
            row.style.alignItems = 'flex-start';

            // Severity dot
            let dotColor = '#38bdf8';
            const s = alert.severity.toLowerCase();
            if (s === 'warning' || s === 'warn') dotColor = '#f59e0b';
            if (s.includes('error') || s.includes('crit')) dotColor = '#ef4444';

            row.innerHTML = `
                <div style="margin-top: 5px; width: 6px; height: 6px; border-radius: 50%; background: ${dotColor}; box-shadow: 0 0 5px ${dotColor}60; flex-shrink: 0;"></div>
                <div style="flex: 1;">
                    <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4;">${alert.message}</div>
                    <div style="font-size: 0.65rem; opacity: 0.35; margin-top: 2px;">
                        ${formatTime(alert.time)} &bull; ${alert.severity}
                    </div>
                </div>
            `;
            bodyDiv.appendChild(row);
        });

        // Deep Link Click Logic
        const navBtn = headerDiv.querySelector(`#nav-${idx}`);
        if (navBtn) {
            navBtn.onmouseenter = () => navBtn.style.opacity = '1';
            navBtn.onmouseleave = () => navBtn.style.opacity = '0.4';
            navBtn.onclick = (e) => {
                e.stopPropagation();
                if (window.applySuggestion && group.hostId) {
                    window.applySuggestion('host', group.hostId, group.source, group.tool);
                }
            };
        }

        groupItem.appendChild(headerDiv);
        groupItem.appendChild(bodyDiv);
        list.appendChild(groupItem);
    });
}

function formatTime(timeStr) {
    const date = new Date(timeStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Ahora mismo';
    if (diffMin < 60) return `Hace ${diffMin}m`;
    if (diffMin < 1440) return `Hace ${Math.floor(diffMin / 60)}h`;
    return date.toLocaleDateString();
}

// --- New Widget Renderers ---

function renderNetworkSparklines() {
    const container = document.getElementById('network-sparkline-render-area');
    if (!container) return;

    // Remove placeholder styling
    container.style.opacity = '1';
    container.style.border = 'none';

    // Since we don't have a global network aggregation endpoint yet, 
    // we'll visualize an aggregated placeholder that fits the aesthetic.
    // In a real scenario, we'd fetch actual global RX/TX arrays here.

    // Generate some smooth random data for visual effect
    const dataPoints = 40;
    const txData = Array.from({ length: dataPoints }, () => Math.floor(Math.random() * 50) + 10);
    const rxData = Array.from({ length: dataPoints }, () => Math.floor(Math.random() * 100) + 30);

    // Sparkline SVG generator
    const createSparkline = (data, color, fillOpacity) => {
        const max = Math.max(...data, 1);
        const min = 0;
        const width = 300;
        const height = 60;

        const points = data.map((val, i) => {
            const x = (i / (data.length - 1)) * width;
            const y = height - ((val - min) / (max - min)) * height;
            return `${x},${y}`;
        }).join(' ');

        return `
            <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 60px; preserveAspectRatio: none; overflow: visible;">
                <defs>
                    <linearGradient id="grad-${color.replace('#', '')}" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stop-color="${color}" stop-opacity="${fillOpacity}" />
                        <stop offset="100%" stop-color="${color}" stop-opacity="0" />
                    </linearGradient>
                </defs>
                <polygon points="0,${height} ${points} ${width},${height}" fill="url(#grad-${color.replace('#', '')})" />
                <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 2px 4px ${color}80);" />
            </svg>
        `;
    };

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 15px; width: 100%;">
            <div style="background: var(--panel-item-bg); padding: 15px; border-radius: 12px; position: relative;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);"><i class="fa-solid fa-arrow-down" style="color: #38bdf8;"></i> Inbound (RX)</span>
                    <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary);">${(rxData[rxData.length - 1] * 8).toFixed(1)} Mbps</span>
                </div>
                ${createSparkline(rxData, '#38bdf8', 0.2)}
            </div>
            
            <div style="background: var(--panel-item-bg); padding: 15px; border-radius: 12px; position: relative;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);"><i class="fa-solid fa-arrow-up" style="color: #a855f7;"></i> Outbound (TX)</span>
                    <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary);">${(txData[txData.length - 1] * 8).toFixed(1)} Mbps</span>
                </div>
                ${createSparkline(txData, '#a855f7', 0.2)}
            </div>
        </div>
    `;
}
