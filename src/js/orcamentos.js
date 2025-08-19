// Lógica de interação para o módulo de Orçamentos
window.customStartDate = null;
window.customEndDate = null;
async function popularClientes() {
    const select = document.getElementById('filterClient');
    if (!select) return;
    try {
        const resp = await fetch('http://localhost:3000/api/clientes/lista');
        const data = await resp.json();
        select.innerHTML = '<option value="">Todos os Clientes</option>' +
            data.map(c => `<option value="${c.nome_fantasia}">${c.nome_fantasia}</option>`).join('');
    } catch (err) {
        console.error('Erro ao carregar clientes', err);
    }
}

function showLoadingSpinner() {
    const overlay = document.createElement('div');
    overlay.id = 'orcamentoLoading';
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    overlay.innerHTML = `
        <div class="spinner"></div>
        <style>
            #orcamentoLoading .spinner{border:4px solid rgba(255,255,255,0.3);border-top-color:var(--color-primary);border-radius:50%;width:3rem;height:3rem;animation:spin 1s linear infinite;}
            @keyframes spin{to{transform:rotate(360deg);}}
        </style>`;
    document.body.appendChild(overlay);
}
function hideLoadingSpinner() {
    document.getElementById('orcamentoLoading')?.remove();
}

async function carregarOrcamentos() {
    try {
        const resp = await fetch('http://localhost:3000/api/orcamentos');
        const data = await resp.json();
        const tbody = document.getElementById('orcamentosTabela');
        tbody.innerHTML = '';
        const statusClasses = {
            'Rascunho': 'badge-info',
            'Pendente': 'badge-warning',
            'Aprovado': 'badge-success',
            'Rejeitado': 'badge-danger',
            'Expirado': 'badge-neutral'
        };
        const owners = new Set();
        data.forEach(o => {
            const tr = document.createElement('tr');
            tr.className = 'transition-colors duration-150';
            tr.style.cursor = 'pointer';
            tr.setAttribute('onmouseover', "this.style.background='rgba(163, 148, 167, 0.05)'");
            tr.setAttribute('onmouseout', "this.style.background='transparent'");
            tr.dataset.id = o.id;
            tr.dataset.dono = o.dono || o.vendedor || '';
            if (o.dono) owners.add(o.dono);
            const condicao = o.parcelas > 1 ? `${o.parcelas}x` : 'À vista';
            const badgeClass = statusClasses[o.situacao] || 'badge-neutral';
            const valor = Number(o.valor_final || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
            tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${o.numero}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${o.cliente || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${o.data_emissao}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${valor}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${condicao}</td>
                <td class="px-6 py-4 whitespace-nowrap"><span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">${o.situacao}</span></td>
                <td class="px-6 py-4 whitespace-nowrap text-center">
                    <div class="flex items-center justify-center space-x-2">
                        <i class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Visualizar"></i>
                        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
                        <i class="fas fa-download w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Baixar PDF"></i>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });
        const ownerSelect = document.getElementById('filterOwner');
        if (ownerSelect) {
            ownerSelect.innerHTML = '<option value="">Todos os Donos</option>' +
                [...owners].map(d => `<option value="${d}">${d}</option>`).join('');
        }
        tbody.querySelectorAll('.fa-edit').forEach(icon => {
            icon.addEventListener('click', async e => {
                e.stopPropagation();
                const id = e.currentTarget.closest('tr').dataset.id;
                window.selectedQuoteId = id;
                showLoadingSpinner();
                const start = Date.now();
                try {
                    const resp = await fetch(`http://localhost:3000/api/orcamentos/${id}`);
                    window.quoteData = await resp.json();
                } catch (err) {
                    console.error('Erro ao carregar orçamento', err);
                }
                const elapsed = Date.now() - start;
                const delay = elapsed < 3000 ? Math.max(2000 - elapsed, 0) : 0;
                setTimeout(() => {
                    hideLoadingSpinner();
                    Modal.open('modals/orcamentos/editar.html', '../js/modals/orcamento-editar.js', 'editarOrcamento');
                }, delay);
            });
        });
        await popularClientes();
    } catch (err) {
        console.error('Erro ao carregar orçamentos', err);
    }
}
window.reloadOrcamentos = carregarOrcamentos;

function aplicarFiltro() {
    const status = document.getElementById('filterStatus')?.value || '';
    const periodo = document.getElementById('filterPeriod')?.value || '';
    const dono = document.getElementById('filterOwner')?.value || '';
    const cliente = document.getElementById('filterClient')?.value.toLowerCase() || '';
    const now = new Date();
    document.querySelectorAll('#orcamentosTabela tr').forEach(row => {
        const rowStatus = row.cells[5]?.innerText.trim() || '';
        const rowCliente = row.cells[1]?.innerText.trim().toLowerCase() || '';
        const rowDono = (row.dataset.dono || '').toLowerCase();
        const dateText = row.cells[2]?.innerText.trim();
        let show = true;

        if (status) show &&= rowStatus === status;
        if (dono) show &&= rowDono === dono.toLowerCase();
        if (cliente) show &&= rowCliente === cliente;
        if (periodo) {
            const [d, m, y] = dateText.split('/').map(Number);
            const rowDate = new Date(y, m - 1, d);
            if (periodo === 'Personalizado' && window.customStartDate && window.customEndDate) {
                const inicio = new Date(window.customStartDate);
                const fim = new Date(window.customEndDate);
                show &&= rowDate >= inicio && rowDate <= fim;
            } else {
                const diff = (now - rowDate) / (1000 * 60 * 60 * 24);
                if (periodo === 'Semana') show &&= diff <= 7;
                else if (periodo === 'Mês') show &&= diff <= 30;
                else if (periodo === 'Trimestre') show &&= diff <= 90;
                else if (periodo === 'Ano') show &&= diff <= 365;
            }
        }

        row.style.display = show ? '' : 'none';
    });
}

function limparFiltros() {
    document.getElementById('filterStatus').value = '';
    const periodSel = document.getElementById('filterPeriod');
    periodSel.value = '';
    const customOpt = periodSel.querySelector('option[value="Personalizado"]');
    if (customOpt) customOpt.textContent = 'Personalizado';
    document.getElementById('filterOwner').value = '';
    document.getElementById('filterClient').value = '';
    window.customStartDate = null;
    window.customEndDate = null;
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

    const periodSelect = document.getElementById('filterPeriod');
    const periodModal = document.getElementById('periodModal');
    const periodConfirm = document.getElementById('periodConfirm');
    periodSelect?.addEventListener('change', () => {
        if (periodSelect.value === 'Personalizado') {
            periodModal.classList.remove('hidden');
        } else {
            const customOpt = periodSelect.querySelector('option[value="Personalizado"]');
            if (customOpt) customOpt.textContent = 'Personalizado';
            window.customStartDate = null;
            window.customEndDate = null;
        }
    });
    periodConfirm?.addEventListener('click', () => {
        window.customStartDate = document.getElementById('startDate').value;
        window.customEndDate = document.getElementById('endDate').value;
        periodModal.classList.add('hidden');
        const customOpt = periodSelect.querySelector('option[value="Personalizado"]');
        if (customOpt && window.customStartDate && window.customEndDate) {
            const fmt = d => d.split('-').reverse().join('/');
            customOpt.textContent = `${fmt(window.customStartDate)} - ${fmt(window.customEndDate)}`;
        }
        periodSelect.value = 'Personalizado';
        aplicarFiltro();
    });

    carregarOrcamentos();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrcamentos);
} else {
    initOrcamentos();
}
