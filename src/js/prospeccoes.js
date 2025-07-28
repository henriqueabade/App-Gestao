// Lógica principal do módulo de Prospecções
// Responsável por animações iniciais e interações simples do funil

function initProspeccoes() {
    // Aplica animação de fade nos elementos marcados
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    // Alternância do gráfico de funil
    const toggleBtn = document.getElementById('toggleFunnel');
    const funnelSection = document.getElementById('funnelSection');
    const funnelSwitch = document.getElementById('funnelSwitch');

    if (toggleBtn && funnelSection) {
        toggleBtn.addEventListener('click', () => {
            funnelSection.classList.toggle('hidden');
            toggleBtn.textContent = funnelSection.classList.contains('hidden')
                ? 'Mostrar Gráfico de Funil'
                : 'Ocultar Gráfico de Funil';
            funnelSwitch.classList.toggle('active');
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProspeccoes);
} else {
    initProspeccoes();
}
