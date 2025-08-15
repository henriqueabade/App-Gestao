// Lógica de interação para o módulo de Orçamentos
function popularClientes() {
    const select = document.getElementById('filterClient');
    const rows = document.querySelectorAll('#orcamentosTabela tr');
    const clientes = [...new Set(Array.from(rows).map(r => r.cells[1]?.textContent.trim()).filter(Boolean))];
    if (select) {
        select.innerHTML = '<option value="">Todos os Clientes</option>' +
            clientes.map(c => `<option value="${c}">${c}</option>`).join('');
    }
}

function aplicarFiltro() {
    const status = document.getElementById('filterStatus')?.value || '';
    const periodo = document.getElementById('filterPeriod')?.value || '';
    const vendedor = document.getElementById('filterSeller')?.value || '';
    const cliente = document.getElementById('filterClient')?.value.toLowerCase() || '';
    const now = new Date();
    document.querySelectorAll('#orcamentosTabela tr').forEach(row => {
        const rowStatus = row.cells[5]?.innerText.trim() || '';
        const rowCliente = row.cells[1]?.innerText.trim().toLowerCase() || '';
        const rowVendedor = (row.dataset.vendedor || '').toLowerCase();
        const dateText = row.cells[2]?.innerText.trim();
        let show = true;

        if (status) show &&= rowStatus === status;
        if (vendedor) show &&= rowVendedor === vendedor.toLowerCase();
        if (cliente) show &&= rowCliente === cliente;
        if (periodo) {
            const [d, m, y] = dateText.split('/').map(Number);
            const rowDate = new Date(y, m - 1, d);
            const diff = (now - rowDate) / (1000 * 60 * 60 * 24);
            if (periodo === 'Semana') show &&= diff <= 7;
            else if (periodo === 'Mês') show &&= diff <= 30;
            else if (periodo === 'Trimestre') show &&= diff <= 90;
            else if (periodo === 'Ano') show &&= diff <= 365;
        }

        row.style.display = show ? '' : 'none';
    });
}

function limparFiltros() {
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterPeriod').value = '';
    document.getElementById('filterSeller').value = '';
    document.getElementById('filterClient').value = '';
    aplicarFiltro();
}

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

    const filtrar = document.getElementById('btnFiltrar');
    const limpar = document.getElementById('btnLimpar');
    if (filtrar) filtrar.addEventListener('click', aplicarFiltro);
    if (limpar) limpar.addEventListener('click', limparFiltros);
    popularClientes();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrcamentos);
} else {
    initOrcamentos();
}
