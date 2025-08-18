// Inicialização do módulo Financeiro

function initFinanceiro() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFinanceiro);
} else {
    initFinanceiro();
}
