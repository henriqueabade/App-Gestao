// Lógica de interação para o módulo de Pedidos
window.customPeriodPedidos = null;
let pedidosDateRangeController = null;

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

// =====================================================
// 🔧 Cache de clientes e busca otimizada via backend local
// =====================================================
const cacheClientes = new Map();

async function carregarClientes() {
  try {
    // 🧠 Esta rota passa pelo backend local → token injetado automaticamente
    const resp = await fetchApi('/api/clientes/lista');
    if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`);

    const clientes = await resp.json();

    clientes.forEach(c => {
      cacheClientes.set(c.id, c.nome_fantasia || c.razao_social || c.nome || 'Sem nome');
    });

    console.log('✅ Clientes carregados:', cacheClientes.size);
  } catch (err) {
    console.error('💥 Erro ao carregar lista de clientes:', err);
  }
}

function obterNomeCliente(id) {
  return cacheClientes.get(id) || '—';
}

function formatarDataLocal(isoDate) {
    if (!isoDate) return '';
    const data = new Date(isoDate);
    if (isNaN(data)) return '';
    return data.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
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
        const resp = await fetchApi('/api/clientes/lista');
        const data = await resp.json();
        select.innerHTML = '<option value="">Todos os Clientes</option>' +
            data.map(c => `<option value="${c.nome_fantasia}">${c.nome_fantasia}</option>`).join('');
    } catch (err) {
        console.error('Erro ao carregar clientes', err);
    }
}

function showFunctionUnavailableDialog(message) {
    const overlay = document.createElement('div');
    overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.style.zIndex = 'var(--z-dialog)';
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

function showPdfUnavailableDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.style.zIndex = 'var(--z-dialog)';
    overlay.innerHTML = `<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-red-500/20 ring-1 ring-red-500/30 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
            <h3 class="text-lg font-semibold mb-4 text-red-400">Função Indisponível</h3>
            <p class="text-sm text-gray-300 mb-6">Não é possível gerar PDF para pedidos em RASCUNHO!</p>
            <div class="flex justify-center">
                <button id="pdfUnavailableOk" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">OK</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#pdfUnavailableOk').addEventListener('click', () => overlay.remove());
}

/** Exclusão restrita ao Sup Admin: o botão só é revelado para esse perfil. */
async function ehSupAdminAtual() {
    try {
        const resp = await fetchApi('/api/permissoes/efetivas');
        const dados = await resp.json();
        return Boolean(dados?.supAdmin);
    } catch (err) {
        console.error('Não foi possível verificar o perfil do usuário', err);
        return false;
    }
}

async function revelarAcoesSupAdmin(raiz = document) {
    if (!(await ehSupAdminAtual())) return;
    raiz.querySelectorAll('.acao-sup-admin').forEach(el => el.classList.remove('hidden'));
}

/**
 * Véu de carregamento durante uma ação longa.
 *
 * Se `botaoAcao.js` não estiver carregado a ação ainda roda — sem o aviso
 * visual, mas sem quebrar. Um recurso de interface não pode impedir a operação.
 */
function comCarregamento(fn, texto) {
    if (window.BotaoAcao?.comCarregamento) {
        return window.BotaoAcao.comCarregamento(fn, texto);
    }
    return fn();
}

function confirmarExclusaoSupAdmin(mensagem, cb) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.style.zIndex = 'var(--z-dialog)';
    overlay.innerHTML = `
        <div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-red-500/20 ring-1 ring-red-500/30 shadow-2xl/40 animate-modalFade">
            <div class="p-6 text-center">
                <h3 class="text-lg font-semibold mb-4 text-red-400">Confirmar exclusão</h3>
                <p class="text-sm text-gray-300 mb-6">${mensagem}</p>
                <div class="flex justify-center gap-4">
                    <button id="excluirSim" class="btn-danger px-4 py-2 rounded-lg text-white font-medium">Excluir</button>
                    <button id="excluirNao" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Cancelar</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#excluirSim').addEventListener('click', () => { overlay.remove(); cb(true); });
    overlay.querySelector('#excluirNao').addEventListener('click', () => { overlay.remove(); cb(false); });
}

function showStatusConfirmDialog(message, cb) {
    const overlay = document.createElement('div');
    overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.style.zIndex = 'var(--z-dialog)';
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
    spinner.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    spinner.style.zIndex = 'var(--z-dialog)';
    spinner.innerHTML = '<div class="app-loading-indicator app-loading-indicator--compact" aria-hidden="true"><span class="module-loading-orbit"></span><span class="module-loading-core"><img src="../assets/Logo.ico" alt=""></span></div>';
    document.body.appendChild(spinner);
    function handleLoaded(e) {
        if (e.detail !== overlayId) return;
        const overlay = document.getElementById(`${overlayId}Overlay`);
        spinner.remove();
        overlay?.classList.remove('hidden');
        window.removeEventListener('pedidoModalLoaded', handleLoaded);
    }
    window.addEventListener('pedidoModalLoaded', handleLoaded);
    Modal.open(htmlPath, scriptPath, overlayId, true);
}

function openVisualizarPedidoModal(id) {
    window.selectedOrderId = id;
    openPedidoModal('modals/pedidos/visualizar.html', '../js/modals/pedido-visualizar.js', 'visualizarPedido');
}

function abrirRelatorioProducao(pedidoId, cliente) {
    if (!pedidoId) return;
    window.relatorioProducaoContext = { pedidoId, cliente };
    window.selectedOrderId = pedidoId;
    openPedidoModal(
        'modals/pedidos/relatorio-producao.html',
        '../js/modals/pedido-relatorio-producao.js',
        'relatorioProducao'
    );
}

function abrirConverterOrcamentos() {
    openPedidoModal(
        'modals/pedidos/converter-orcamentos.html',
        '../js/modals/pedido-converter-orcamentos.js',
        'converterOrcamentos'
    );
}
async function carregarPedidos() {
    try {
        // Em PARALELO, e os clientes só na primeira vez.
        //
        // A lista de clientes era buscada a cada recarga da tabela, e ANTES de
        // os pedidos começarem a ser buscados — duas idas à rede em fila para
        // montar uma tela só. O cache de nomes é aditivo e não expira, então
        // depois da primeira carga não há nada de novo a buscar.
        const [resp] = await Promise.all([
            fetchApi('/api/pedidos'),
            cacheClientes.size ? Promise.resolve() : carregarClientes()
        ]);
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
            const dataFormatada = formatarDataLocal(p.data_emissao);
            const dataFormatada2 = formatarDataLocal(p.data_aprovacao);
            const dataFormatada3 = formatarDataLocal(p.data_envio);
            const dataFormatada4 = formatarDataLocal(p.data_entrega);
            const dataFormatada5 = formatarDataLocal(p.data_cancelamento);
            // permissão exigida para avançar o status deste pedido
            const statusPerm = p.situacao === 'Produção' ? 'ped.status.ship'
                : p.situacao === 'Enviado' ? 'ped.status.deliver'
                : 'ped.status.confirm';
            tr.innerHTML = `
                <td data-perm-col="col_ped_num" class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${p.numero}</td>
                <td data-perm-col="col_ped_cliente" class="px-6 py-4 whitespace-nowrap text-sm text-white">${obterNomeCliente(p.cliente_id)}</td>
                <td data-perm-col="col_ped_data" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${dataFormatada}</td>
                <td data-perm-col="col_ped_total" class="px-6 py-4 whitespace-nowrap text-sm text-white">${valor}</td>
                <td data-perm-col="col_ped_condicao" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${condicao}</td>
                <td data-perm-col="col_ped_status" class="px-6 py-4 whitespace-nowrap"><span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium status-badge" data-aprovacao="${dataFormatada2}" data-envio="${dataFormatada3}" data-entrega="${dataFormatada4}" data-cancelamento="${dataFormatada5}">${p.situacao}</span></td>
                <td class="px-6 py-4 whitespace-nowrap text-left">
                    <div class="flex items-center justify-start space-x-2">
                        <i data-perm="ped.view.details" class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Visualizar"></i>
                        <i data-perm="${statusPerm}" class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Concluir"></i>
                        <i data-perm="ped.report" class="fas fa-clipboard w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Relatório"></i>
                        <i data-perm="ped.delete" class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 acao-sup-admin hidden" title="Excluir pedido" style="color: var(--color-red)"></i>
                        <i data-perm="ped.export" class="fas fa-download w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 ${downloadClass}" style="color: var(--color-primary)" title="${downloadTitle}"></i>
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
                            await fetchApi(`/api/pedidos/${p.id}/status`, {
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



        revelarAcoesSupAdmin(tbody);

        tbody.querySelectorAll('.fa-trash').forEach(icon => {
            icon.addEventListener('click', async e => {
                e.stopPropagation();
                const tr = e.currentTarget.closest('tr');
                const numero = tr?.cells?.[0]?.textContent?.trim();
                const p = data.find(x => String(x.numero) === numero);
                if (!p) return;
                confirmarExclusaoSupAdmin(`Excluir definitivamente o pedido ${p.numero}? Esta ação não pode ser desfeita.`, async ok => {
                    if (!ok) return;
                    // A exclusão em cascata percorre uma dúzia de tabelas e pode
                    // levar segundos. O clique na lixeira já terminou e o diálogo
                    // já fechou, então não há botão para marcar: o véu é o que
                    // mostra que está em curso e impede um segundo clique.
                    await comCarregamento(async () => {
                    try {
                        const resp = await fetchApi(`/api/pedidos/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
                        const corpo = await resp.json().catch(() => null);
                        if (!resp.ok) {
                            // O motivo vem do backend (qual chave prendeu, ou
                            // "restrito ao Sup Admin"). Sem ele sobrava só
                            // "não foi possível" e não dava para agir.
                            throw new Error(corpo?.detalhe || corpo?.error || `HTTP ${resp.status}`);
                        }
                        // A tabela é atualizada ANTES do aviso de sucesso, e
                        // ainda sob o carregando. Ao contrário, o usuário lia
                        // "excluído" com a linha ainda na tela e concluía que
                        // não tinha funcionado.
                        await carregarPedidos();
                        window.showToast?.(`Pedido ${p.numero} excluído.`, 'success');
                        // Se alguma dependente resistiu, o pedido saiu mas
                        // sobrou lixo: é melhor dizer do que fingir que não.
                        if (Array.isArray(corpo?.avisos) && corpo.avisos.length) {
                            console.warn('Exclusão do pedido com avisos:', corpo.avisos);
                            window.showToast?.(`Excluído com ${corpo.avisos.length} aviso(s). Veja o console.`, 'info');
                        }
                    } catch (err) {
                        console.error('Erro ao excluir pedido', err);
                        window.showToast?.(err?.message || 'Não foi possível excluir o pedido.', 'error');
                    }
                    }, `Excluindo o pedido ${p.numero}...`);
                });
            });
        });

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
                const tr = e.currentTarget.closest('tr');
                abrirRelatorioProducao(tr?.dataset.id, tr?.cells?.[1]?.innerText?.trim() || '');
            });
        });

        tbody.querySelectorAll('.fa-download').forEach(icon => {
            icon.addEventListener('click', async e => {
                e.stopPropagation();
                const tr = e.currentTarget.closest('tr');
                const id = tr.dataset.id;
                const status = tr.cells[5]?.innerText.trim();
                if (status === 'Rascunho') {
                    showPdfUnavailableDialog();
                    return;
                }

                if (!window.electronAPI?.openPdf) {
                    window.notifyDesktopOnlyPdf?.(id);
                    return;
                }

                window.notifyPdfGeneration?.();
                try {
                    const result = await window.electronAPI.openPdf(id, 'pedido');
                    if (result?.success) {
                        window.showToast?.('PDF salvo com sucesso!', 'success');
                    } else if (result?.canceled) {
                        window.showToast?.('Geração de PDF cancelada.', 'info');
                    } else {
                        const message = result?.message || 'Não foi possível gerar o PDF.';
                        window.showToast?.(message, 'error');
                    }
                } catch (err) {
                    console.error('Erro ao gerar PDF de pedido', err);
                    const message = err?.message || 'Erro inesperado ao gerar PDF.';
                    window.showToast?.(`Erro ao gerar PDF: ${message}`, 'error');
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

// O módulo é injetado dentro de um IIFE, então nada daqui é global por conta
// própria. Os modais que mexem em pedidos (converter orçamentos, cancelar)
// precisam recarregar a listagem depois de agir — `pedido-cancelar.js` já
// chamava `window.carregarPedidos`, que nunca existiu: a lista ficava velha até
// o usuário trocar de tela.
window.carregarPedidos = carregarPedidos;

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
        converterBtn.addEventListener('click', abrirConverterOrcamentos);
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
