// Lógica de interação para o módulo de Orçamentos
window.customPeriodOrcamentos = null;
let orcamentosDateRangeController = null;

async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
}

function parseIsoDateToLocal(iso) {
    if (!iso || typeof iso !== 'string' || !iso.includes('-')) return null;
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return null;
    const parsed = new Date(year, month - 1, day);
    parsed.setHours(0, 0, 0, 0);
    return parsed;
}

function updateEmptyStateOrcamentos(hasData) {
    const wrapper = document.getElementById('orcamentosTableWrapper');
    const empty = document.getElementById('orcamentosEmptyState');
    if (!wrapper || !empty) return;
    if (hasData) {
        wrapper.classList.remove('hidden');
        empty.classList.add('hidden');
    } else {
        wrapper.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}
async function popularClientes() {
    const select = document.getElementById('filterClient');
    if (!select) return;
    try {
        const resp = await fetchApi('/api/clientes/lista');
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
            await fetchApi(`/api/orcamentos/${id}/status`, {
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

function showFunctionUnavailableDialog(message) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.innerHTML = `<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-yellow-500/20 ring-1 ring-yellow-500/30 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
            <h3 class="text-lg font-semibold mb-4 text-yellow-400">Função Indisponível</h3>
            <p class="text-sm text-gray-300 mb-6">${message}</p>
            <div class="flex justify-center">
                <button id="funcUnavailableOk" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">OK</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#funcUnavailableOk').addEventListener('click', () => overlay.remove());
}

function openQuoteModal(htmlPath, scriptPath, overlayId) {
    Modal.closeAll();
    const spinner = document.createElement('div');
    spinner.id = 'modalLoading';
    spinner.className = 'fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center';
    spinner.innerHTML = '<div class="w-16 h-16 border-4 border-[#b6a03e] border-t-transparent rounded-full animate-spin"></div>';
    document.body.appendChild(spinner);
    const start = Date.now();
    function handleLoaded(e) {
        if (e.detail !== overlayId) return;
        const overlay = document.getElementById(`${overlayId}Overlay`);
        const elapsed = Date.now() - start;
        const show = () => {
            spinner.remove();
            overlay.classList.remove('hidden');
        };
        if (elapsed < 3000) {
            setTimeout(show, Math.max(0, 2000 - elapsed));
        } else {
            show();
        }
        window.removeEventListener('orcamentoModalLoaded', handleLoaded);
    }
    window.addEventListener('orcamentoModalLoaded', handleLoaded);
    Modal.open(htmlPath, scriptPath, overlayId, true);
}

function openConversionFlow(id) {
    Modal.closeAll();
    const spinner = document.createElement('div');
    spinner.id = 'modalLoading';
    spinner.className = 'fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center';
    spinner.innerHTML = '<div class="w-16 h-16 border-4 border-[#b6a03e] border-t-transparent rounded-full animate-spin"></div>';
    document.body.appendChild(spinner);
    const start = Date.now();
    let editReady = false;
    let converterReady = false;
    const finalize = () => {
        if (!editReady || !converterReady) return;
        const elapsed = Date.now() - start;
        const show = () => {
            if (spinner.isConnected) spinner.remove();
            const editOverlay = document.getElementById('editarOrcamentoOverlay');
            const convertOverlay = document.getElementById('converterOrcamentoOverlay');
            editOverlay?.classList.remove('hidden');
            editOverlay?.removeAttribute('aria-hidden');
            convertOverlay?.classList.remove('hidden');
            convertOverlay?.removeAttribute('aria-hidden');
            window.autoOpenQuoteConversion = null;
        };
        const remaining = Math.max(0, 3000 - elapsed);
        if (remaining > 0) setTimeout(show, remaining); else show();
        window.removeEventListener('orcamentoModalLoaded', handleLoaded);
        clearTimeout(failSafe);
    };
    function handleLoaded(e) {
        if (e.detail === 'editarOrcamento') {
            editReady = true;
            finalize();
        } else if (e.detail === 'converterOrcamento') {
            converterReady = true;
            finalize();
        }
    }
    const failSafe = setTimeout(() => {
        window.removeEventListener('orcamentoModalLoaded', handleLoaded);
        if (spinner.isConnected) spinner.remove();
        const editOverlay = document.getElementById('editarOrcamentoOverlay');
        const convertOverlay = document.getElementById('converterOrcamentoOverlay');
        editOverlay?.classList.remove('hidden');
        editOverlay?.removeAttribute('aria-hidden');
        convertOverlay?.classList.remove('hidden');
        convertOverlay?.removeAttribute('aria-hidden');
        window.autoOpenQuoteConversion = null;
    }, 7000);
    window.addEventListener('orcamentoModalLoaded', handleLoaded);
    window.autoOpenQuoteConversion = { id, skipInnerSpinner: true, deferReveal: true };
    window.selectedQuoteId = id;
    Modal.open('modals/orcamentos/editar.html', '../js/modals/orcamento-editar.js', 'editarOrcamento');
}

async function carregarOrcamentos() {
    try {
        const resp = await fetchApi('/api/orcamentos');
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
            const editBlocked = ['Aprovado','Expirado','Rejeitado'].includes(o.situacao);
            const editClass = editBlocked ? 'icon-disabled' : '';
            const convertBlocked = ['Aprovado','Expirado','Rejeitado','Rascunho'].includes(o.situacao);
            const convertTitle = convertBlocked
                ? (isDraft
                    ? 'Converter indisponível para orçamentos em rascunho'
                    : 'Converter indisponível para este status')
                : 'Converter em pedido';
            const convertClass = convertBlocked ? 'icon-disabled' : '';
            tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${o.numero}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${o.cliente || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${o.data_emissao}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${valor}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${condicao}</td>
                <td class="px-6 py-4 whitespace-nowrap"><span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">${o.situacao}</span></td>
                <td class="px-6 py-4 whitespace-nowrap text-left">
                    <div class="flex items-center justify-start space-x-2">
                        <i class="fas fa-money-bill-wave w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 ${convertClass}" style="color: var(--color-primary)" title="${convertTitle}"></i>
                        <i class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Visualizar"></i>
                        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 ${editClass}" style="color: var(--color-primary)" title="Editar"></i>
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
        tbody.querySelectorAll('.fa-edit').forEach(icon => {
            icon.addEventListener('click', async e => {
                e.stopPropagation();
                if (icon.classList.contains('icon-disabled')) {
                    showFunctionUnavailableDialog('Orçamentos aprovados, expirados ou rejeitados não podem ser editados.');
                    return;
                }
                const id = e.currentTarget.closest('tr').dataset.id;
                window.selectedQuoteId = id;
                openQuoteModal('modals/orcamentos/editar.html', '../js/modals/orcamento-editar.js', 'editarOrcamento');
            });
        });
        tbody.querySelectorAll('.fa-eye').forEach(icon => {
            icon.addEventListener('click', async e => {
                e.stopPropagation();
                const id = e.currentTarget.closest('tr').dataset.id;
                window.selectedQuoteId = id;
                openQuoteModal('modals/orcamentos/visualizar.html', '../js/modals/orcamento-visualizar.js', 'visualizarOrcamento');
            });
        });
        tbody.querySelectorAll('.fa-download').forEach(icon => {
            icon.addEventListener('click', async e => {
                e.stopPropagation();
                const tr = e.currentTarget.closest('tr');
                const id = tr.dataset.id;
                const status = tr.cells[5]?.innerText.trim();
                if (status === 'Rascunho') {
                    showPdfUnavailableDialog(id);
                    return;
                }

                if (!window.electronAPI?.openPdf) return;

                window.notifyPdfGeneration?.();
                try {
                    const result = await window.electronAPI.openPdf(id, 'orcamento');
                    if (result?.success) {
                        window.showToast?.('PDF salvo com sucesso!', 'success');
                    } else if (result?.canceled) {
                        window.showToast?.('Geração de PDF cancelada.', 'info');
                    } else {
                        const message = result?.message || 'Não foi possível gerar o PDF.';
                        window.showToast?.(message, 'error');
                    }
                } catch (err) {
                    console.error('Erro ao gerar PDF de orçamento', err);
                    const message = err?.message || 'Erro inesperado ao gerar PDF.';
                    window.showToast?.(`Erro ao gerar PDF: ${message}`, 'error');
                }
            });
        });
        tbody.querySelectorAll('.fa-money-bill-wave').forEach(icon => {
            icon.addEventListener('click', e => {
                e.stopPropagation();
                const tr = e.currentTarget.closest('tr');
                const status = tr?.cells?.[5]?.innerText?.trim() || '';
                if (icon.classList.contains('icon-disabled')) {
                    if (status === 'Rascunho') {
                        showFunctionUnavailableDialog('Orçamentos em rascunho não podem ser convertidos em pedido. Altere o status para Pendente antes de converter.');
                    } else {
                        showFunctionUnavailableDialog('Orçamentos aprovados, expirados ou rejeitados não podem ser convertidos em pedido.');
                    }
                    return;
                }
                const id = tr?.dataset.id;
                if (!id) return;
                openConversionFlow(id);
            });
        });
        await popularClientes();
        updateEmptyStateOrcamentos(data.length > 0);
        const periodSelect = document.getElementById('filterPeriod');
        if (periodSelect?.dataset.customActive === 'true' && window.customPeriodOrcamentos?.start && window.customPeriodOrcamentos?.end) {
            aplicarFiltro();
        }
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
    const customPeriod = window.customPeriodOrcamentos;
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
            if (periodo === 'Personalizado' && customPeriod?.start && customPeriod?.end) {
                const inicio = parseIsoDateToLocal(customPeriod.start);
                const fim = parseIsoDateToLocal(customPeriod.end);
                if (inicio && fim) {
                    fim.setHours(23, 59, 59, 999);
                    show &&= rowDate >= inicio && rowDate <= fim;
                }
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
    const hasVisible = Array.from(document.querySelectorAll('#orcamentosTabela tr')).some(r => r.style.display !== 'none');
    updateEmptyStateOrcamentos(hasVisible);
}

function limparFiltros() {
    document.getElementById('filterStatus').value = '';
    orcamentosDateRangeController?.clear();
    document.getElementById('filterOwner').value = '';
    document.getElementById('filterClient').value = '';
    window.customPeriodOrcamentos = null;
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
    document.getElementById('orcamentosEmptyNew')?.addEventListener('click', () => {
        document.getElementById('novoOrcamentoBtn')?.click();
    });

    const filtrar = document.getElementById('btnFiltrar');
    const limpar = document.getElementById('btnLimpar');
    if (filtrar) filtrar.addEventListener('click', aplicarFiltro);
    if (limpar) limpar.addEventListener('click', limparFiltros);

    const periodSelect = document.getElementById('filterPeriod');
    if (periodSelect && window.DateRangeFilter?.initDateRangeFilter) {
        orcamentosDateRangeController = window.DateRangeFilter.initDateRangeFilter({
            selectElement: periodSelect,
            moduleKey: 'orcamentos',
            getRange: () => window.customPeriodOrcamentos,
            setRange: range => {
                window.customPeriodOrcamentos = range;
            },
            onApply: () => {
                // Dispara a recarga da listagem sempre que o período mudar
                aplicarFiltro();
            }
        });
    }

    carregarOrcamentos();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrcamentos);
} else {
    initOrcamentos();
}
