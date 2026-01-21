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

export async function initSummaryDashboard() {
    const grid = document.getElementById('summary-health-grid');
    const alertsList = document.getElementById('summary-alerts-list');

    if (!grid || !alertsList) return;

    try {
        const resp = await fetch('/api/health/summary');
        if (!resp.ok) throw new Error('API response not ok');
        const data = await resp.json();

        renderHealthGrid(data.overall_health || []);
        renderAlerts(data.recent_alerts || []);
    } catch (err) {
        console.error('Failed to load health summary:', err);
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: #ef4444;">
            <i class="fa-solid fa-circle-exclamation" style="font-size: 2rem;"></i>
            <p>Error al cargar el estado de salud: ${err.message}</p>
        </div>`;
    }
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

        const hasNoHosts = item.total === 0;
        const isCritical = item.offline > 0;

        let statusColor = '#10b981'; // Green (Operational)
        let statusIcon = 'fa-check';
        let statusText = 'Operativo';

        if (isCritical) {
            statusColor = '#ef4444'; // Red (Critical)
            statusIcon = 'fa-triangle-exclamation';
            statusText = `${item.offline} Offline`;
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
                    <div style="width: 28px; height: 28px; background: rgba(255,255,255,0.03); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 0.9rem;">
                        <i class="fa-solid ${icon}"></i>
                    </div>
                    <h4 style="margin: 0; font-size: 0.75rem; opacity: 0.5; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 700;">${item.category}</h4>
                </div>
                <div class="status-dot ${isCritical ? 'offline' : (hasNoHosts ? 'inactive' : 'online')}" style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor}; box-shadow: 0 0 8px ${statusColor}aa;">
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
                <div style="height: 4px; background: rgba(255,255,255,0.04); border-radius: 10px; overflow: hidden;">
                    <div style="width: ${progress}%; height: 100%; background: ${hasNoHosts ? '#334155' : 'linear-gradient(90deg, #10b981, #34d399)'}; border-radius: 10px; transition: width 1s ease-out;"></div>
                </div>
            </div>

            <div style="font-size: 0.75rem; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.02); display: flex; justify-content: space-between; align-items: center;">
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

    list.innerHTML = '';
    alerts.forEach((alert, idx) => {
        const item = document.createElement('div');
        item.className = 'alert-item';
        item.style.padding = '14px 20px';
        item.style.marginBottom = '8px';
        item.style.background = 'rgba(255,255,255,0.015)';
        item.style.borderRadius = '12px';
        item.style.border = '1px solid var(--glass-border)';
        item.style.display = 'flex';
        item.style.gap = '15px';
        item.style.alignItems = 'center';
        item.style.animation = `fadeInUp 0.3s ease-out forwards ${idx * 0.05}s`;
        item.style.opacity = '0'; // For animation

        const severity = alert.severity.toLowerCase();
        const isError = severity === 'error' || severity.includes('fail') || severity.includes('crit');
        const isWarning = severity === 'warning' || severity === 'warn';

        let alertColor = '#38bdf8'; // Info
        let alertIcon = 'fa-circle-info';

        if (isError) {
            alertColor = '#ef4444';
            alertIcon = 'fa-circle-xmark';
        } else if (isWarning) {
            alertColor = '#f59e0b';
            alertIcon = 'fa-circle-exclamation';
        }

        item.innerHTML = `
            <div style="color: ${alertColor}; font-size: 1rem; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: ${alertColor}10; border-radius: 10px; flex-shrink: 0; border: 1px solid ${alertColor}15;">
                <i class="fa-solid ${alertIcon}"></i>
            </div>
            <div style="flex: 1; min-width: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <strong style="color: var(--text-primary); font-size: 0.88rem;">${alert.source}</strong>
                        <span style="font-size: 0.65rem; padding: 1px 6px; border-radius: 4px; background: ${alertColor}15; color: ${alertColor}; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">${alert.severity}</span>
                    </div>
                    <span style="font-size: 0.7rem; opacity: 0.3; font-family: 'JetBrains Mono', monospace;">${formatTime(alert.time)}</span>
                </div>
                <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${alert.message}">${alert.message}</div>
            </div>
            <div style="opacity: 0.15; transform: translateX(3px);">
                <i class="fa-solid fa-chevron-right" style="font-size: 0.7rem;"></i>
            </div>
        `;
        list.appendChild(item);
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
