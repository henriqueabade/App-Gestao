function initUsers() {
    const editButtons = document.querySelectorAll('.edit-user');
    const btnToggleFilters = document.getElementById('btnToggleFilters');
    const btnCloseFilters = document.getElementById('btnCloseFilters');
    const filterPanel = document.getElementById('filterPanel');
    const btnNovoUsuario = document.getElementById('btnNovoUsuario');
    editButtons.forEach(button => {
        button.addEventListener('click', openUserEditModal);
    });
    if (btnToggleFilters) {
        btnToggleFilters.addEventListener('click', () => {
            filterPanel.classList.add('open');
        });
    }
    if (btnCloseFilters) {
        btnCloseFilters.addEventListener('click', () => {
            filterPanel.classList.remove('open');
        });
    }
    if (btnNovoUsuario) {
        btnNovoUsuario.addEventListener('click', () => {
            openUserEditModal();
        });
    }
}

async function openUserEditModal() {
    await Modal.open(
        '../usuarios/editarUsuario.html',
        '../usuarios/editUserRenderer.js',
        'modal-users-edit'
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUsers);
} else {
    initUsers();
}
