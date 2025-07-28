// Script do módulo de Configurações
// Exibe animação básica na entrada da página
function initConfiguracoes() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConfiguracoes);
} else {
    initConfiguracoes();
}
