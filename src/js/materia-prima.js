// Lógica principal do módulo Matéria Prima
// Carrega dados e inicializa animações da tela
function initMateriaPrima() {
    // animação simples dos elementos marcados
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });
    // aqui poderíamos carregar dados do backend e montar a tabela
    console.log('Matéria Prima carregada');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMateriaPrima);
} else {
    initMateriaPrima();
}
