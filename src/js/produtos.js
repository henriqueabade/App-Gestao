// Script principal do módulo de Produtos
// Responsável por carregar os dados e controlar filtros e ações de estoque.

function initProdutos() {
    // Animação de entrada dos elementos
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    // TODO: Implementar filtros e manipulação de estoque

    // Insere ícones de ação em todas as linhas da tabela
    const template = document.getElementById('action-icons-template');
    if (template) {
        document.querySelectorAll('.action-cell').forEach(cell => {
            cell.appendChild(template.content.cloneNode(true));
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProdutos);
} else {
    initProdutos();
}
