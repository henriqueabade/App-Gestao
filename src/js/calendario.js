// Script do módulo Calendário
// Responsável por renderizar eventos e controlar filtros.

function initCalendario() {
    // Aplica animação nos elementos da tela
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });
    // TODO: carregar eventos do banco e integrar com clientes
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCalendario);
} else {
    initCalendario();
}

