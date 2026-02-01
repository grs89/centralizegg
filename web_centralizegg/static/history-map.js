
// Helper to parse active connections JSON safely
function parseActiveConnections(jsonStr) {
    if (!jsonStr) return [];
    try {
        const parsed = JSON.parse(jsonStr);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

// Global variable for the map instance
let historyMapInstance = null;

async function renderGlobalHistoryMap() {
    const mapContainer = document.getElementById('history-map');
    if (!mapContainer || mapContainer.offsetParent === null) return; // Don't render if hidden

    // Initialize map if needed
    if (!historyMapInstance) {
        if (typeof NetworkMap === 'undefined') {
            console.warn("NetworkMap class not loaded yet.");
            return;
        }
        historyMapInstance = new NetworkMap('history-map');
    }

    try {
        // Fetch all host data using the existing API endpoints
        const [kvmHosts, dockerHosts, k8sNodes, proxmoxHosts, nasHosts, cephHosts, podmanHosts] = await Promise.all([
            fetch('/api/hosts').then(r => r.ok ? r.json() : []),
            fetch('/api/docker/hosts').then(r => r.ok ? r.json() : []),
            fetch('/api/kubernetes/nodes').then(r => r.ok ? r.json() : []),
            fetch('/api/proxmox/hosts').then(r => r.ok ? r.json() : []),
            fetch('/api/nas/hosts').then(r => r.ok ? r.json() : []),
            fetch('/api/ceph/hosts').then(r => r.ok ? r.json() : []),
            fetch('/api/podman/hosts').then(r => r.ok ? r.json() : []),
        ]);

        const allHosts = [
            ...kvmHosts.map(h => ({ ...h, type: 'kvm', name: h.hostname, connections: parseActiveConnections(h.active_connections) })),
            ...dockerHosts.map(h => ({ ...h, type: 'docker', name: h.hostname, connections: parseActiveConnections(h.active_connections) })),
            ...k8sNodes.map(h => ({ ...h, type: 'k8s', name: h.hostname, connections: parseActiveConnections(h.active_connections) })),
            ...proxmoxHosts.map(h => ({ ...h, type: 'proxmox', name: h.hostname, connections: parseActiveConnections(h.active_connections) })),
            ...nasHosts.map(h => ({ ...h, type: 'nas', name: h.hostname, connections: parseActiveConnections(h.active_connections) })),
            ...cephHosts.map(h => ({ ...h, type: 'ceph', name: h.hostname, connections: parseActiveConnections(h.active_connections) })),
            ...podmanHosts.map(h => ({ ...h, type: 'podman', name: h.hostname, connections: parseActiveConnections(h.active_connections) })),
        ];

        // Aggregate connections
        const nodeMap = new Map();
        const links = [];

        // Add "My Infrastructure" center node
        nodeMap.set('center', { id: 'center', name: 'Datacenter', type: 'internet', status: 'active', color: '#fff' });

        allHosts.forEach(host => {
            const hostId = `host-${host.type}-${host.id}`;
            const hostColor = getHostColorByType(host.type);

            // Add Host Node
            nodeMap.set(hostId, {
                id: hostId,
                name: host.name,
                type: 'service',
                status: 'active',
                color: hostColor
            });

            // Link Host to Center
            links.push({ source: 'center', target: hostId, status: 'active', type: 'solid' });

            // Process Connections
            host.connections.forEach(conn => {
                if (conn.remote_ip) {
                    const remoteId = `ip-${conn.remote_ip}`;

                    // Add Remote IP Node (if not exists)
                    if (!nodeMap.has(remoteId)) {
                        nodeMap.set(remoteId, {
                            id: remoteId,
                            name: conn.remote_ip,
                            type: 'database', // Use a distinct shape/icon
                            status: 'active',
                            color: '#a1a1aa'
                        });
                    }

                    // Link Host to Remote IP
                    links.push({
                        source: hostId,
                        target: remoteId,
                        status: 'active',
                        type: 'dashed',
                        particles: true // Show traffic flow
                    });
                }
            });
        });

        // Convert Map to Array
        const nodes = Array.from(nodeMap.values());

        // Update Map
        historyMapInstance.updateData(nodes, links);

    } catch (error) {
        console.error("Error rendering global history map:", error);
    }
}

function getHostColorByType(type) {
    switch (type) {
        case 'kvm': return '#3b82f6'; // Blue
        case 'docker': return '#0ea5e9'; // Sky Blue
        case 'k8s': return '#38bdf8'; // Light Blue
        case 'proxmox': return '#f97316'; // Orange
        case 'nas': return '#10b981'; // Emerald
        case 'ceph': return '#ef4444'; // Red
        case 'podman': return '#8b5cf6'; // Violet
        default: return '#64748b'; // Slate
    }
}

// Attach to window and setup auto-refresh logic
window.renderGlobalHistoryMap = renderGlobalHistoryMap;

// Check periodically if the map is visible and update
setInterval(() => {
    if (document.getElementById('history-map') && document.getElementById('history-map').offsetParent !== null) {
        renderGlobalHistoryMap();
    }
}, 10000);
