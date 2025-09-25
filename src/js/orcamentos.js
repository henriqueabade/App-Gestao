// Lógica de interação para o módulo de Orçamentos
window.customPeriodOrcamentos = null;

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
            document.getElementById('editarOrcamentoOverlay')?.classList.remove('hidden');
            document.getElementById('converterOrcamentoOverlay')?.classList.remove('hidden');
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
        document.getElementById('editarOrcamentoOverlay')?.classList.remove('hidden');
        document.getElementById('converterOrcamentoOverlay')?.classList.remove('hidden');
        window.autoOpenQuoteConversion = null;
    }, 7000);
    window.addEventListener('orcamentoModalLoaded', handleLoaded);
    window.autoOpenQuoteConversion = { id, skipInnerSpinner: true };
    window.selectedQuoteId = id;
    Modal.open('modals/orcamentos/editar.html', '../js/modals/orcamento-editar.js', 'editarOrcamento');
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
            const editBlocked = ['Aprovado','Expirado','Rejeitado'].includes(o.situacao);
            const editClass = editBlocked ? 'icon-disabled' : '';
            const convertBlocked = ['Aprovado','Expirado','Rejeitado'].includes(o.situacao);
            const convertClass = convertBlocked ? 'icon-disabled' : '';
            tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${o.numero}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${o.cliente || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${o.data_emissao}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${valor}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${condicao}</td>
                <td class="px-6 py-4 whitespace-nowrap"><span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">${o.situacao}</span></td>
                <td class="px-6 py-4 whitespace-nowrap text-center">
                    <div class="flex items-center justify-center space-x-2">
                        <i class="fas fa-money-bill-wave w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 ${convertClass}" style="color: var(--color-primary)" title="Converter em pedido"></i>
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
            icon.addEventListener('click', e => {
                e.stopPropagation();
                const tr = e.currentTarget.closest('tr');
                const id = tr.dataset.id;
                const status = tr.cells[5]?.innerText.trim();
                if (status === 'Rascunho') {
                    showPdfUnavailableDialog(id);
                } else {
                    if (window.electronAPI?.openPdf) {
                        window.electronAPI.openPdf(id, 'orcamento');
                    }
                }
            });
        });
        tbody.querySelectorAll('.fa-money-bill-wave').forEach(icon => {
            icon.addEventListener('click', e => {
                e.stopPropagation();
                if (icon.classList.contains('icon-disabled')) {
                    showFunctionUnavailableDialog('Orçamentos aprovados, expirados ou rejeitados não podem ser convertidos em pedido.');
                    return;
                }
                const tr = e.currentTarget.closest('tr');
                const id = tr?.dataset.id;
                if (!id) return;
                openConversionFlow(id);
            });
        });
        await popularClientes();
        updateEmptyStateOrcamentos(data.length > 0);
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
                const inicio = new Date(customPeriod.start);
                const fim = new Date(customPeriod.end);
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
    const hasVisible = Array.from(document.querySelectorAll('#orcamentosTabela tr')).some(r => r.style.display !== 'none');
    updateEmptyStateOrcamentos(hasVisible);
}

function limparFiltros() {
    document.getElementById('filterStatus').value = '';
    const periodSel = document.getElementById('filterPeriod');
    if (periodSel) {
        periodSel.value = '';
        periodSel.dataset.customActive = '';
        periodSel.dataset.currentValue = '';
        const customOpt = periodSel.querySelector('option[value="Personalizado"]');
        if (customOpt) customOpt.textContent = 'Personalizado';
    }
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
    const periodModal = document.getElementById('periodModal');
    const periodConfirm = document.getElementById('periodConfirm');
    const periodCancel = document.getElementById('periodCancel');
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');

    const customOption = periodSelect?.querySelector('option[value="Personalizado"]');
    const formatDisplayDate = isoDate => {
        if (!isoDate) return '';
        const [year, month, day] = isoDate.split('-');
        return `${day}/${month}/${year}`;
    };
    const updateCustomOptionLabel = () => {
        if (!customOption) return;
        const customPeriod = window.customPeriodOrcamentos;
        if (customPeriod?.start && customPeriod?.end) {
            customOption.textContent = `${formatDisplayDate(customPeriod.start)} - ${formatDisplayDate(customPeriod.end)}`;
        } else {
            customOption.textContent = 'Personalizado';
        }
    };
    const closePeriodModal = () => {
        if (!periodModal) return;
        periodModal.classList.add('hidden');
        periodModal.setAttribute('aria-hidden', 'true');
    };
    const openPeriodModal = previousValue => {
        if (!periodModal) return;
        periodModal.classList.remove('hidden');
        periodModal.setAttribute('aria-hidden', 'false');
        const customPeriod = window.customPeriodOrcamentos;
        if (startInput) startInput.value = customPeriod?.start || '';
        if (endInput) endInput.value = customPeriod?.end || '';
        if (periodSelect && typeof previousValue !== 'undefined') {
            periodSelect.dataset.modalPreviousValue = previousValue;
        }
        setTimeout(() => startInput?.focus(), 50);
    };
    const handleCancel = () => {
        closePeriodModal();
        if (!periodSelect) return;
        const previousValue = periodSelect.dataset.modalPreviousValue;
        delete periodSelect.dataset.modalPreviousValue;
        if (periodSelect.dataset.customActive === 'true') {
            periodSelect.value = 'Personalizado';
            periodSelect.dataset.currentValue = 'Personalizado';
            updateCustomOptionLabel();
        } else {
            const fallback = previousValue ?? periodSelect.dataset.currentValue ?? '';
            periodSelect.value = fallback;
            periodSelect.dataset.currentValue = fallback;
            if (!fallback) updateCustomOptionLabel();
        }
        aplicarFiltro();
    };

    if (periodSelect) {
        periodSelect.dataset.currentValue = periodSelect.value || '';
        periodSelect.addEventListener('change', () => {
            const previousValue = periodSelect.dataset.currentValue || '';
            if (periodSelect.value === 'Personalizado') {
                openPeriodModal(previousValue);
                periodSelect.value = previousValue;
            } else {
                window.customPeriodOrcamentos = null;
                periodSelect.dataset.customActive = '';
                periodSelect.dataset.currentValue = periodSelect.value || '';
                updateCustomOptionLabel();
                aplicarFiltro();
            }
        });
        periodSelect.addEventListener('click', () => {
            if (periodSelect.value === 'Personalizado' && periodSelect.dataset.customActive === 'true') {
                openPeriodModal('Personalizado');
            }
        });
    }

    updateCustomOptionLabel();

    periodConfirm?.addEventListener('click', () => {
        const startValue = startInput?.value;
        const endValue = endInput?.value;
        if (!startValue || !endValue) {
            if (typeof showToast === 'function') {
                showToast('Informe a data inicial e final para o período personalizado.', 'warning');
            } else {
                alert('Informe a data inicial e final para o período personalizado.');
            }
            return;
        }
        if (new Date(startValue) > new Date(endValue)) {
            if (typeof showToast === 'function') {
                showToast('A data inicial não pode ser maior que a data final.', 'warning');
            } else {
                alert('A data inicial não pode ser maior que a data final.');
            }
            return;
        }
        window.customPeriodOrcamentos = { start: startValue, end: endValue };
        if (periodSelect) {
            periodSelect.value = 'Personalizado';
            periodSelect.dataset.currentValue = 'Personalizado';
            periodSelect.dataset.customActive = 'true';
        }
        updateCustomOptionLabel();
        closePeriodModal();
        aplicarFiltro();
    });

    periodCancel?.addEventListener('click', handleCancel);
    periodModal?.addEventListener('click', event => {
        if (event.target === periodModal) handleCancel();
    });
    if (periodModal) {
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !periodModal.classList.contains('hidden')) {
                handleCancel();
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
