// Global state state.js
export const state = {
    currentTool: 'virtualization',
    searchQuery: '',
    selectedHostId: null,
    selectedFirewallHostId: null,
    selectedDockerHostId: null,
    selectedPodmanHostId: null,
    selectedKubernetesServerId: null,
    selectedKubernetesNodeId: null,
    selectedProxmoxHostId: null,
    selectedNasHostId: null,

    allHostsCache: [],
    allVMsCache: [],
    allContainersCache: [],
    allPodmanContainersCache: [],
    allPodsCache: [],
    allNasVolumesCache: [],
    allNasDisksCache: [],

    currentServers: [],
    currentFirewallServers: [],
    currentDockerServers: [],
    currentPodmanServers: [],
    currentKubernetesServers: [],
    currentProxmoxServers: [],
    currentNasServers: [],

    vmNetworkHistory: {},
    bridgeNetworkHistory: {},
    containerNetworkHistory: {},

    lastNotificationCount: 0,
    lastReminderSoundTime: 0
};
