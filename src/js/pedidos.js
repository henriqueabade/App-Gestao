// Lógica de interação para o módulo de Pedidos
window.customPeriodPedidos = null;
let pedidosDateRangeController = null;

function parseIsoDateToLocal(iso) {
    if (!iso || typeof iso !== 'string' || !iso.includes('-')) return null;
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return null;
    const parsed = new Date(year, month - 1, day);
    parsed.setHours(0, 0, 0, 0);
    return parsed;
}

function updateEmptyStatePedidos(hasData) {
    const wrapper = document.getElementById('pedidosTableWrapper');
    const empty = document.getElementById('pedidosEmptyState');
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

function showStatusConfirmDialog(message, cb) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.innerHTML = `<div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
            <h3 class="text-lg font-semibold mb-4 text-yellow-300">Atenção</h3>
            <p class="text-sm text-gray-300 mb-6">${message}</p>
            <div class="flex justify-center gap-4">
                <button id="statusYes" class="btn-warning px-4 py-2 rounded-lg text-white font-medium">Sim</button>
                <button id="statusNo" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Não</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#statusYes').addEventListener('click', () => { overlay.remove(); cb(true); });
    overlay.querySelector('#statusNo').addEventListener('click', () => { overlay.remove(); cb(false); });
}

let statusTooltip;
function showStatusTooltip(e) {
    const badge = e.currentTarget;
    const items = [
        { label: 'Data Início Produção', value: badge.dataset.aprovacao },
        { label: 'Data de Envio', value: badge.dataset.envio },
        { label: 'Data de Entrega', value: badge.dataset.entrega },
        { label: 'Data de Cancelamento', value: badge.dataset.cancelamento }
    ].filter(i => i.value);
    if (!items.length) return;
    statusTooltip = document.createElement('div');
    statusTooltip.className = 'status-tooltip glass-surface text-white text-xs rounded-lg p-2 border border-white/10';
    statusTooltip.innerHTML = items.map(i => `<div><span class="font-semibold">${i.label}:</span> ${i.value}</div>`).join('');
    document.body.appendChild(statusTooltip);
    const rect = badge.getBoundingClientRect();
    statusTooltip.style.left = `${rect.left + window.scrollX}px`;
    statusTooltip.style.top = `${rect.bottom + window.scrollY + 4}px`;
}
function hideStatusTooltip() {
    if (statusTooltip) {
        statusTooltip.remove();
        statusTooltip = null;
    }
}


function openPedidoModal(htmlPath, scriptPath, overlayId) {
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
            overlay?.classList.remove('hidden');
        };
        if (elapsed < 3000) {
            setTimeout(show, Math.max(0, 2000 - elapsed));
        } else {
            show();
        }
        window.removeEventListener('pedidoModalLoaded', handleLoaded);
    }
    window.addEventListener('pedidoModalLoaded', handleLoaded);
    Modal.open(htmlPath, scriptPath, overlayId, true);
}

function openVisualizarPedidoModal(id) {
    window.selectedOrderId = id;
    openPedidoModal('modals/pedidos/visualizar.html', '../js/modals/pedido-visualizar.js', 'visualizarPedido');
}
async function carregarPedidos() {
    try {
        const resp = await fetch('http://localhost:3000/api/pedidos');
        const data = await resp.json();
        const tbody = document.getElementById('pedidosTabela');
        tbody.innerHTML = '';
        const statusClasses = {
            'Produção': 'badge-warning',
            'Enviado': 'badge-info',
            'Entregue': 'badge-success',
            'Cancelado': 'badge-danger'
        };
        const owners = new Set();
        data.forEach(p => {
            const tr = document.createElement('tr');
            tr.className = 'transition-colors duration-150';
            tr.style.cursor = 'pointer';
            tr.setAttribute('onmouseover', "this.style.background='rgba(163, 148, 167, 0.05)'");
            tr.setAttribute('onmouseout', "this.style.background='transparent'");
            tr.dataset.dono = p.dono || '';
            tr.dataset.id = p.id;
            owners.add(p.dono);
            const condicao = p.parcelas > 1 ? `${p.parcelas}x` : 'À vista';
            const badgeClass = statusClasses[p.situacao] || 'badge-neutral';
            const valor = Number(p.valor_final || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const isDraft = p.situacao === 'Rascunho';
            const downloadClass = isDraft ? 'pdf-disabled relative' : '';
            const downloadTitle = isDraft ? 'PDF indisponível' : 'Baixar PDF';
            tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${p.numero}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${p.cliente || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${p.data_emissao || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${valor}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${condicao}</td>
                <td class="px-6 py-4 whitespace-nowrap"><span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium status-badge" data-aprovacao="${p.data_aprovacao || ''}" data-envio="${p.data_envio || ''}" data-entrega="${p.data_entrega || ''}" data-cancelamento="${p.data_cancelamento || ''}">${p.situacao}</span></td>
                <td class="px-6 py-4 whitespace-nowrap text-left">
                    <div class="flex items-center justify-start space-x-2">
                        <i class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Visualizar"></i>
                        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Concluir"></i>
                        <i class="fas fa-clipboard w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Relatório"></i>
                        <i class="fas fa-download w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 ${downloadClass}" style="color: var(--color-primary)" title="${downloadTitle}"></i>
                    </div>
                </td>`;
            const checkIcon = tr.querySelector('.fa-check');
            const nextStatusMap = { 'Produção': 'Enviado', 'Enviado': 'Entregue' };
            const nextStatus = nextStatusMap[p.situacao];
            if (!nextStatus) {
                checkIcon.classList.add('icon-disabled');
            } else {
                checkIcon.addEventListener('click', e => {
                    e.stopPropagation();
                    showStatusConfirmDialog(`Deseja alterar o status para "${nextStatus}"?`, async ok => {
                        if (!ok) return;
                        try {
                            await fetch(`http://localhost:3000/api/pedidos/${p.id}/status`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: nextStatus })
                            });
                            carregarPedidos();
                        } catch (err) {
                            console.error('Erro ao atualizar status', err);
                        }
                    });
                });
            }
            tbody.appendChild(tr);
        });
        const ownerSelect = document.getElementById('filterOwner');
        if (ownerSelect) {
            ownerSelect.innerHTML = '<option value="">Todos os Donos</option>' +
                [...owners].map(d => `<option value="${d}">${d}</option>`).join('');
        }

        tbody.querySelectorAll('.fa-eye').forEach(icon => {
            icon.addEventListener('click', e => {
                e.stopPropagation();
                const id = e.currentTarget.closest('tr')?.dataset.id;
                if (!id) return;
                openVisualizarPedidoModal(id);
            });
        });

        tbody.querySelectorAll('.fa-clipboard').forEach(icon => {
            icon.addEventListener('click', e => {
                e.stopPropagation();
                showFunctionUnavailableDialog('Fun??o em desenvolvimento.');
            });
        });
        tbody.querySelectorAll('.fa-download').forEach(icon => {
            icon.addEventListener('click', e => {
                e.stopPropagation();
                const tr = e.currentTarget.closest('tr');
                const id = tr.dataset.id;
                const status = tr.cells[5]?.innerText.trim();
                if (status === 'Rascunho') {
                    showPdfUnavailableDialog();
                } else if (window.electronAPI?.openPdf) {
                    window.notifyPdfGeneration?.();
                    window.electronAPI.openPdf(id, 'pedido');
                }
            });
        });
        tbody.querySelectorAll('.status-badge').forEach(badge => {
            badge.addEventListener('mouseenter', showStatusTooltip);
            badge.addEventListener('mouseleave', hideStatusTooltip);
        });
        await popularClientes();
        updateEmptyStatePedidos(data.length > 0);
        const periodSelect = document.getElementById('filterPeriod');
        if (periodSelect?.dataset.customActive === 'true' && window.customPeriodPedidos?.start && window.customPeriodPedidos?.end) {
            aplicarFiltro();
        }
    } catch (err) {
        console.error('Erro ao carregar pedidos', err);
    }
}

function aplicarFiltro() {
    const status = document.getElementById('filterStatus')?.value || '';
    const periodo = document.getElementById('filterPeriod')?.value || '';
    const dono = document.getElementById('filterOwner')?.value || '';
    const cliente = document.getElementById('filterClient')?.value.toLowerCase() || '';
    const now = new Date();
    const customPeriod = window.customPeriodPedidos;
    document.querySelectorAll('#pedidosTabela tr').forEach(row => {
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
    const hasVisible = Array.from(document.querySelectorAll('#pedidosTabela tr')).some(r => r.style.display !== 'none');
    updateEmptyStatePedidos(hasVisible);
}

function limparFiltros() {
    document.getElementById('filterStatus').value = '';
    pedidosDateRangeController?.clear();
    document.getElementById('filterOwner').value = '';
    document.getElementById('filterClient').value = '';
    window.customPeriodPedidos = null;
    aplicarFiltro();
}

function initPedidos() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    const converterBtn = document.getElementById('converterOrcamentoBtn');
    if (converterBtn) {
        converterBtn.addEventListener('click', () => {
            showFunctionUnavailableDialog('Conversão de orçamento ainda não implementada.');
        });
    }
    document.getElementById('pedidosEmptyNew')?.addEventListener('click', () => {
        document.getElementById('converterOrcamentoBtn')?.click();
    });

    const filtrar = document.getElementById('btnFiltrar');
    const limpar = document.getElementById('btnLimpar');
    if (filtrar) filtrar.addEventListener('click', aplicarFiltro);
    if (limpar) limpar.addEventListener('click', limparFiltros);

    const periodSelect = document.getElementById('filterPeriod');
    if (periodSelect && window.DateRangeFilter?.initDateRangeFilter) {
        pedidosDateRangeController = window.DateRangeFilter.initDateRangeFilter({
            selectElement: periodSelect,
            moduleKey: 'pedidos',
            getRange: () => window.customPeriodPedidos,
            setRange: range => {
                window.customPeriodPedidos = range;
            },
            onApply: () => {
                // Dispara a recarga da listagem sempre que o período mudar
                aplicarFiltro();
            }
        });
    }

    carregarPedidos();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPedidos);
} else {
    initPedidos();
}
