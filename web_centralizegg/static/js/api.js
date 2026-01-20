export const API_HOSTS = '/api/hosts';
export const API_VMS = '/api/vms';
export const API_CONFIG_SERVERS = '/api/config/servers';
export const API_FIREWALL_HOSTS = '/api/firewall/hosts';
export const API_FIREWALL_SERVERS = '/api/firewall/servers';
export const API_CONTAINER_HOSTS = '/api/containers/hosts';
export const API_CONTAINER_CONTAINERS = '/api/containers/containers';
export const API_KUBERNETES_NODES = '/api/kubernetes/nodes';
export const API_KUBERNETES_PODS = '/api/kubernetes/pods';
export const API_KUBERNETES_PVS = '/api/kubernetes/pvs';
export const API_KUBERNETES_EVENTS = '/api/kubernetes/events';
export const API_PODMAN_HOSTS = '/api/podman/hosts';
export const API_PODMAN_CONTAINERS = '/api/podman/containers';
export const API_PROXMOX_HOSTS = '/api/proxmox/hosts';
export const API_PROXMOX_VMS = '/api/proxmox/vms';
export const API_NAS_HOSTS = '/api/nas/hosts';
export const API_NAS_VOLUMES = '/api/nas/volumes';
export const API_NAS_DISKS = '/api/nas/disks';

export function getConfigAPIForTool(toolKey) {
    const apiMap = {
        'kvm': API_CONFIG_SERVERS,
        'pfsense': API_FIREWALL_SERVERS,
        'proxmox': '/api/config/proxmox',
        'nas': '/api/config/nas',
        'ceph': '/api/config/ceph',
        'docker': '/api/config/docker',
        'podman': '/api/config/podman',
        'kubernetes': '/api/config/kubernetes'
    };
    return apiMap[toolKey] || API_CONFIG_SERVERS;
}
