// Script de gerenciamento da tela de pedidos
// Responsável por carregar dados, filtrar e controlar etapas

function initPedidos() {
    const statusFilter = document.querySelector('select');
    statusFilter?.addEventListener('change', () => {
        console.log('Filtro de status alterado:', statusFilter.value);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPedidos);
} else {
    initPedidos();
}
