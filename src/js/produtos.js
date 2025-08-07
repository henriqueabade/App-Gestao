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

    // Ajusta os botões de ação conforme o estado da sidebar
    ajustarBotoes();

    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        const observer = new MutationObserver(ajustarBotoes);
        observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    }
}

// Reduz ou amplia o padding dos botões "Filtrar" e "Novo"
function ajustarBotoes() {
    const sidebar = document.getElementById('sidebar');
    const expandida = sidebar?.classList.contains('sidebar-expanded');
    document.querySelectorAll('#bt-actions button').forEach(btn => {
        if (expandida) {
            btn.classList.remove('px-4');
            btn.classList.add('px-2');
        } else {
            btn.classList.remove('px-2');
            btn.classList.add('px-4');
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProdutos);
} else {
    initProdutos();
}
