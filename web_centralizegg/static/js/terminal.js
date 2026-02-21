let currentTerminal = null;
let currentWs = null;
let currentFitAddon = null;

// Expose globally
window.openTerminal = function(category, serverId, targetName) {
    const modal = document.getElementById('terminal-modal');
    const container = document.getElementById('terminal-container');
    const title = document.getElementById('terminal-title');

    modal.classList.remove('hidden');
    title.innerHTML = `<i class="fa-solid fa-terminal"></i> ${targetName} (${category})`;
    
    // Clear previous if any
    container.innerHTML = '';
    if (currentWs) {
        currentWs.close();
        currentWs = null;
    }
    if (currentTerminal) {
        currentTerminal.dispose();
    }

    currentTerminal = new Terminal({
        cursorBlink: true,
        theme: {
            background: '#000000',
            foreground: '#ffffff'
        },
        fontFamily: "'Fira Code', 'Cascadia Code', monospace",
        fontSize: 14
    });

    currentFitAddon = new FitAddon.FitAddon();
    currentTerminal.loadAddon(currentFitAddon);

    currentTerminal.open(container);
    currentFitAddon.fit();

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/terminal/${category}/${serverId}/${targetName}`;
    
    currentWs = new WebSocket(wsUrl);
    
    currentWs.onopen = () => {
        currentTerminal.writeln(`[Connected to ${targetName}]\r\n`);
    };

    currentWs.onmessage = (event) => {
        if (event.data instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => {
                currentTerminal.write(new Uint8Array(reader.result));
            };
            reader.readAsArrayBuffer(event.data);
        } else {
            currentTerminal.write(event.data);
        }
    };

    currentWs.onclose = () => {
        currentTerminal.writeln('\r\n[Disconnected]');
    };

    currentWs.onerror = (error) => {
        currentTerminal.writeln(`\r\n[WebSocket Error]`);
    };

    currentTerminal.onData(data => {
        if (currentWs && currentWs.readyState === WebSocket.OPEN) {
            currentWs.send(data);
        }
    });

    window.addEventListener('resize', () => {
        if (currentFitAddon) {
            currentFitAddon.fit();
        }
    });
};

window.closeTerminalModal = function() {
    const modal = document.getElementById('terminal-modal');
    modal.classList.add('hidden');
    
    if (currentWs) {
        currentWs.close();
        currentWs = null;
    }
    if (currentTerminal) {
        currentTerminal.dispose();
        currentTerminal = null;
    }
    if (currentFitAddon) {
        currentFitAddon = null;
    }
};
