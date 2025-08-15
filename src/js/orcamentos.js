// Lógica de interação para o módulo de Orçamentos
function initOrcamentos() {
    // Aplica animação de entrada nos elementos marcados
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    document.querySelectorAll('.fa-edit').forEach(icon => {
        icon.addEventListener('click', e => {
            e.stopPropagation();
            const row = e.currentTarget.closest('tr');
            const id = row.cells[0].textContent.trim();
            const cliente = row.cells[1].textContent.trim();
            const condicao = row.cells[4]?.textContent.trim();
            const status = row.cells[5]?.innerText.trim();
            window.selectedQuoteData = { id, cliente, condicao, status, row };
            Modal.open('modals/orcamentos/editar.html', '../js/modals/orcamento-editar.js', 'editarOrcamento');
        });
    });

    const novoBtn = document.getElementById('novoOrcamentoBtn');
    if (novoBtn) {
        novoBtn.addEventListener('click', () => {
            Modal.open('modals/orcamentos/novo.html', '../js/modals/orcamento-novo.js', 'novoOrcamento');
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrcamentos);
} else {
    initOrcamentos();
}
