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
function showPdfUnavailableDialog(id) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.innerHTML = `<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-red-500/20 ring-1 ring-red-500/30 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
            <h3 class="text-lg font-semibold mb-4 text-red-400">Função Indisponível</h3>
            <p class="text-sm text-gray-300 mb-6">Não é possivel gerar PDF para Orçamentos em RASCUNHO!</p>
            <div class="flex justify-center gap-4">
                <button id="pdfConvert" class="btn-warning px-4 py-2 rounded-lg text-white font-medium flex items-center gap-2">
                    Converter <span class="info-icon" title="muda status para pendente"></span>
                </button>
                <button id="pdfOk" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">OK</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#pdfOk').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#pdfConvert').addEventListener('click', async () => {
        try {
            await fetch(`http://localhost:3000/api/orcamentos/${id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ situacao: 'Pendente' })
            });
            overlay.remove();
            carregarOrcamentos();
        } catch (err) {
            console.error('Erro ao atualizar status', err);
        }
    });
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
            const isDraft = o.situacao === 'Rascunho';
            const downloadClass = isDraft ? 'pdf-disabled relative' : '';
            const downloadTitle = isDraft ? 'PDF indisponível' : 'Baixar PDF';
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
                        <i class="fas fa-download w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 ${downloadClass}" style="color: var(--color-primary)" title="${downloadTitle}"></i>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });
        const ownerSelect = document.getElementById('filterOwner');
        if (ownerSelect) {
            ownerSelect.innerHTML = '<option value="">Todos os Donos</option>' +
                [...owners].map(d => `<option value="${d}">${d}</option>`).join('');
        }
        tbody.querySelectorAll('.fa-download').forEach(icon => {
            icon.addEventListener('click', e => {
                e.stopPropagation();
                const tr = e.currentTarget.closest('tr');
                const id = tr.dataset.id;
                const status = tr.cells[5]?.innerText.trim();
                if (status === 'Rascunho') {
                    showPdfUnavailableDialog(id);
                } else {
                    const pdfWindow = window.open('../pdf/index.html', '_blank');
                    if (pdfWindow) {
                        pdfWindow.addEventListener('load', () => pdfWindow.print());
                    }
                }
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

    const tbody = document.getElementById('orcamentosTabela');
    if (tbody) {
        tbody.addEventListener('click', async e => {
            const editIcon = e.target.closest('.fa-edit');
            if (editIcon) {
                e.stopPropagation();
                const id = editIcon.closest('tr').dataset.id;
                window.selectedQuoteId = id;
                await Modal.open('modals/orcamentos/editar.html', '../js/modals/orcamento-editar.js', 'editarOrcamento');
                return;
            }
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
