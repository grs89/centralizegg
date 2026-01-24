import { state } from './state.js';

export function updateNetworkHistory(vms) {
    const now = Date.now();
    vms.forEach(vm => {
        if (!state.vmNetworkHistory[vm.id]) {
            state.vmNetworkHistory[vm.id] = {
                rx: Array(state.HISTORY_POINTS).fill(0),
                tx: Array(state.HISTORY_POINTS).fill(0),
                lastRx: vm.net_rx,
                lastTx: vm.net_tx,
                lastTime: now
            };
        } else {
            const entry = state.vmNetworkHistory[vm.id];
            const timeDelta = (now - entry.lastTime) / 1000;
            if (timeDelta > 0) {
                let rxRate = 0;
                let txRate = 0;
                if (vm.net_rx >= entry.lastRx) rxRate = (vm.net_rx - entry.lastRx) / timeDelta;
                if (vm.net_tx >= entry.lastTx) txRate = (vm.net_tx - entry.lastTx) / timeDelta;
                entry.rx.push(rxRate);
                entry.tx.push(txRate);
                if (entry.rx.length > state.HISTORY_POINTS) entry.rx.shift();
                if (entry.tx.length > state.HISTORY_POINTS) entry.tx.shift();
                entry.lastRx = vm.net_rx;
                entry.lastTx = vm.net_tx;
                entry.lastTime = now;
            }
        }
    });
}

export function updateContainerHistory(containers) {
    const now = Date.now();
    containers.forEach(c => {
        const key = `${c.host_id}_${c.name}`;
        if (!state.containerNetworkHistory[key]) {
            state.containerNetworkHistory[key] = {
                rx: Array(state.HISTORY_POINTS).fill(0),
                tx: Array(state.HISTORY_POINTS).fill(0),
                lastRx: c.net_rx,
                lastTx: c.net_tx,
                lastTime: now
            };
        } else {
            const entry = state.containerNetworkHistory[key];
            const timeDelta = (now - entry.lastTime) / 1000;
            if (timeDelta > 0) {
                let rxRate = 0;
                let txRate = 0;
                if (c.net_rx >= entry.lastRx) rxRate = (c.net_rx - entry.lastRx) / timeDelta;
                if (c.net_tx >= entry.lastTx) txRate = (c.net_tx - entry.lastTx) / timeDelta;
                entry.rx.push(rxRate);
                entry.tx.push(txRate);
                if (entry.rx.length > state.HISTORY_POINTS) entry.rx.shift();
                if (entry.tx.length > state.HISTORY_POINTS) entry.tx.shift();
                entry.lastRx = c.net_rx;
                entry.lastTx = c.net_tx;
                entry.lastTime = now;
            }
        }
    });
}

export function updateFirewallHistory(hosts) {
    const now = Date.now();
    hosts.forEach(host => {
        if (host.interfaces && Array.isArray(host.interfaces)) {
            host.interfaces.forEach(iface => {
                const key = `${host.id}_${iface.interface_name}`;
                if (!state.pfSenseNetworkHistory[key]) {
                    state.pfSenseNetworkHistory[key] = {
                        rx: Array(state.HISTORY_POINTS).fill(0),
                        tx: Array(state.HISTORY_POINTS).fill(0),
                        lastRx: parseFloat(iface.net_rx_bytes),
                        lastTx: parseFloat(iface.net_tx_bytes),
                        lastTime: now
                    };
                } else {
                    const entry = state.pfSenseNetworkHistory[key];
                    const timeDelta = (now - entry.lastTime) / 1000;
                    if (timeDelta > 0) {
                        const currentRx = parseFloat(iface.net_rx_bytes);
                        const currentTx = parseFloat(iface.net_tx_bytes);
                        let rxRate = 0, txRate = 0;
                        if (currentRx >= entry.lastRx) rxRate = (currentRx - entry.lastRx) / timeDelta;
                        if (currentTx >= entry.lastTx) txRate = (currentTx - entry.lastTx) / timeDelta;
                        entry.rx.push(rxRate);
                        entry.tx.push(txRate);
                        if (entry.rx.length > state.HISTORY_POINTS) entry.rx.shift();
                        if (entry.tx.length > state.HISTORY_POINTS) entry.tx.shift();
                        entry.lastRx = currentRx;
                        entry.lastTx = currentTx;
                        entry.lastTime = now;
                    }
                }
            });
        }
    });
}

export function updateBridgeHistory(hosts) {
    const now = Date.now();
    hosts.forEach(host => {
        let bridges = [];
        try {
            if (host.bridge_interfaces) bridges = JSON.parse(host.bridge_interfaces);
        } catch (e) { return; }
        bridges.forEach(br => {
            const key = `${host.id}_${br.name}`;
            if (!state.bridgeNetworkHistory[key]) {
                state.bridgeNetworkHistory[key] = {
                    rx: Array(state.HISTORY_POINTS).fill(0),
                    tx: Array(state.HISTORY_POINTS).fill(0),
                    lastRx: br.net_rx,
                    lastTx: br.net_tx,
                    lastTime: now
                };
            } else {
                const entry = state.bridgeNetworkHistory[key];
                const timeDelta = (now - entry.lastTime) / 1000;
                if (timeDelta > 0) {
                    let rxRate = 0, txRate = 0;
                    if (br.net_rx >= entry.lastRx) rxRate = (br.net_rx - entry.lastRx) / timeDelta;
                    if (br.net_tx >= entry.lastTx) txRate = (br.net_tx - entry.lastTx) / timeDelta;
                    entry.rx.push(rxRate);
                    entry.tx.push(txRate);
                    if (entry.rx.length > state.HISTORY_POINTS) entry.rx.shift();
                    if (entry.tx.length > state.HISTORY_POINTS) entry.tx.shift();
                    entry.lastRx = br.net_rx;
                    entry.lastTx = br.net_tx;
                    entry.lastTime = now;
                }
            }
        });
    });
}
