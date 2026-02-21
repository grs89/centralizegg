let currentSnapshotServerId = null;
let currentSnapshotVmName = null;
let currentSnapshotCategory = null;

window.openSnapshotsModal = function (category, serverId, vmName) {
    currentSnapshotServerId = serverId;
    currentSnapshotVmName = vmName;
    currentSnapshotCategory = category;

    document.getElementById('snapshot-new-name').value = '';
    document.getElementById('snapshot-new-desc').value = '';

    const modal = document.getElementById('snapshots-modal');
    modal.classList.remove('hidden');

    const titleInfo = document.getElementById('snapshots-title');
    titleInfo.innerHTML = `<i class="fa-solid fa-camera-retro" style="color: var(--accent-color);"></i> Snapshots: ${vmName} (${category})`;

    loadSnapshots();
};

window.closeSnapshotsModal = function () {
    const modal = document.getElementById('snapshots-modal');
    modal.classList.add('hidden');
};

async function loadSnapshots() {
    const container = document.getElementById('snapshots-list-container');
    container.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...</div>';

    try {
        const response = await fetch(`/api/${currentSnapshotCategory}/vms/${currentSnapshotServerId}/${currentSnapshotVmName}/snapshots`);
        if (!response.ok) throw new Error(await response.text());
        const snapshots = await response.json();

        if (!snapshots || snapshots.length === 0) {
            container.innerHTML = '<div style="opacity: 0.5; text-align: center; padding: 15px;">No hay snapshots creados.</div>';
            return;
        }

        container.innerHTML = snapshots.map(snap => `
            <div style="background: rgba(255,255,255,0.05); padding: 10px 15px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--glass-border);">
                <div>
                    <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 2px;">${snap.name}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); opacity: 0.8;"><i class="fa-regular fa-clock"></i> ${snap.created} • Estado: ${snap.state}</div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="icon-btn" onclick="revertSnapshot('${snap.name}')" title="Revertir a este snapshot" style="background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); color: #38bdf8;">
                        <i class="fa-solid fa-clock-rotate-left"></i>
                    </button>
                    <button class="icon-btn" onclick="deleteSnapshot('${snap.name}')" title="Eliminar snapshot" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444;">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error("Error loading snapshots", error);
        container.innerHTML = `<div style="color: #ef4444; padding: 15px;">Error: ${error.message || 'No se pudieron cargar los snapshots'}</div>`;
    }
}

window.createSnapshot = async function () {
    const nameInput = document.getElementById('snapshot-new-name');
    const descInput = document.getElementById('snapshot-new-desc');
    const name = nameInput.value.trim();
    const desc = descInput.value.trim();

    if (!name) {
        alert("El nombre del snapshot es requerido.");
        return;
    }

    try {
        const response = await fetch(`/api/${currentSnapshotCategory}/vms/${currentSnapshotServerId}/${currentSnapshotVmName}/snapshots`, {
            method: 'POST',
            body: JSON.stringify({ name: name, description: desc })
        });
        if (!response.ok) throw new Error(await response.text());

        nameInput.value = '';
        descInput.value = '';
        loadSnapshots();
    } catch (error) {
        alert(`Error al crear snapshot: ${error.message}`);
    }
};

window.revertSnapshot = async function (snapName) {
    if (!confirm(`¿Estás seguro de que quieres revertir la VM al snapshot "${snapName}"?\nSe perderán los cambios actuales.`)) return;

    try {
        const response = await fetch(`/api/${currentSnapshotCategory}/vms/${currentSnapshotServerId}/${currentSnapshotVmName}/snapshots/${snapName}/revert`, { method: 'POST' });
        if (!response.ok) throw new Error(await response.text());

        alert(`La VM ha sido revertida al snapshot ${snapName}.`);
        closeSnapshotsModal();
    } catch (error) {
        alert(`Error al revertir: ${error.message}`);
    }
};

window.deleteSnapshot = async function (snapName) {
    if (!confirm(`¿Estás seguro de eliminar el snapshot "${snapName}" permanentemente?`)) return;

    try {
        const response = await fetch(`/api/${currentSnapshotCategory}/vms/${currentSnapshotServerId}/${currentSnapshotVmName}/snapshots/${snapName}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(await response.text());

        loadSnapshots();
    } catch (error) {
        alert(`Error al eliminar: ${error.message}`);
    }
};
