// Global state js/state.js
export const state = {
    currentTool: 'welcome',
    searchQuery: '',
    selectedSuggestionIndex: -1,

    // KVM / General
    selectedHostId: null,
    allHostsCache: [],
    allVMsCache: [],
    allKVMHostsCache: [],
    vmNetworkHistory: {},
    bridgeNetworkHistory: {},
    lastRenderedVMsHash: "",

    // pfSense / Firewall
    selectedFirewallHostId: null,
    allFirewallHostsCache: [],
    pfSenseNetworkHistory: {},

    // Docker
    currentDockerServers: [],
    selectedDockerHostId: null,
    allDockerHostsCache: [],
    allContainersCache: [],
    containerNetworkHistory: {},

    // Podman
    currentPodmanServers: [],
    selectedPodmanHostId: null,
    allPodmanHostsCache: [],
    allPodmanContainersCache: [],

    // Kubernetes
    currentKubernetesServers: [],
    selectedKubernetesServerId: null,
    selectedKubernetesNodeId: null,
    allKubernetesHostsCache: [],
    allPodsCache: [],
    expandedK8sNodes: {},

    // Proxmox
    currentProxmoxServers: [],
    selectedProxmoxHostId: null,
    allProxmoxHostsCache: [],
    allProxmoxVMsCache: [],

    // NAS
    currentNasServers: [],
    selectedNasHostId: null,
    allNasHostsCache: [],
    allNasDisksCache: [],
    allNasVolumesCache: [],

    // Global UI State
    currentServers: [], // General servers cache
    lastNotificationCount: 0,
    lastReminderSoundTime: 0,
    HISTORY_POINTS: 20,

    // Auth State
    auth: {
        token: localStorage.getItem('jwt_token'),
        user: localStorage.getItem('user_name'),
        role: localStorage.getItem('user_role'),
        isLoggedIn: !!localStorage.getItem('jwt_token')
    }
};
