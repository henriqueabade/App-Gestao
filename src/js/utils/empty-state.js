function setupEmptyState(tbodyId, emptyStateId, onNew) {
    const tbody = document.getElementById(tbodyId);
    const emptyEl = document.getElementById(emptyStateId);
    const container = document.querySelector('.table-scroll');

    if (onNew) {
        document.getElementById('emptyNew')?.addEventListener('click', onNew);
    }

    function toggle() {
        if (!tbody || !emptyEl) return;
        const hasRows = Array.from(tbody.children).length > 0;
        if (hasRows) {
            container?.classList.remove('hidden');
            emptyEl.classList.add('hidden');
        } else {
            container?.classList.add('hidden');
            emptyEl.classList.remove('hidden');
            if (window.feather) feather.replace();
        }
    }

    return { toggle };
}

window.setupEmptyState = setupEmptyState;
