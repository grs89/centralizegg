export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function formatBytes(bytes, decimals = 2) {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '0 Bytes';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function getStatusColor(percent) {
    const val = parseFloat(percent);
    if (val < 80) return '#4ade80'; // Success Green
    if (val < 95) return '#fb923c'; // Warning Orange
    return '#ef4444'; // Critical Red
}

export function getRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `hace ${diffDay} d`;
    if (diffHour > 0) return `hace ${diffHour} h`;
    if (diffMin > 0) return `hace ${diffMin} m`;
    return 'hace unos segundos';
}

export function playAlertSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
        console.warn("Audio play failed", e);
    }
}

export function getOSIcon(osName) {
    if (!osName) return 'fa-brands fa-linux';
    const os = osName.toLowerCase();

    // Default fallback
    let icon = 'fa-brands fa-linux';

    if (os.includes('ubuntu')) icon = 'fa-brands fa-ubuntu';
    else if (os.includes('debian')) icon = 'fa-brands fa-linux'; // Use linux penguin for debian for better compatibility
    else if (os.includes('fedora')) icon = 'fa-brands fa-fedora';
    else if (os.includes('centos')) icon = 'fa-brands fa-centos';
    else if (os.includes('windows')) icon = 'fa-brands fa-windows';
    else if (os.includes('red hat') || os.includes('rhel')) icon = 'fa-brands fa-redhat';
    else if (os.includes('suse')) icon = 'fa-brands fa-suse';
    else if (os.includes('pfsense') || os.includes('freebsd')) icon = 'fa-brands fa-freebsd';

    return icon;
}
