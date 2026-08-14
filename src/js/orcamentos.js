// Lógica de interação para o módulo de Orçamentos
window.customPeriodOrcamentos = null;
let orcamentosDateRangeController = null;

async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
}

/**
 * Exclusão restrita ao Sup Admin.
 * O botão nasce com a classe "hidden": ele só é revelado para o Sup Admin,
 * de modo que os demais perfis não veem — nem sabem — que a ação existe.
 */
async function ehSupAdminAtual() {
    try {
        const resp = await fetchApi('/api/permissoes/efetivas');
        const dados = await resp.json();
        return Boolean(dados?.supAdmin);
    } catch (err) {
        console.error('Não foi possível verificar o perfil do usuário', err);
        return false;   // na dúvida, não revela
    }
}

async function revelarAcoesSupAdmin(raiz = document) {
    if (!(await ehSupAdminAtual())) return;
    raiz.querySelectorAll('.acao-sup-admin').forEach(el => el.classList.remove('hidden'));
}

/** Ver a nota gêmea em pedidos.js. */
function comCarregamento(fn, texto) {
    if (window.BotaoAcao?.comCarregamento) {
        return window.BotaoAcao.comCarregamento(fn, texto);
    }
    return fn();
}

/** Confirmação de exclusão (usada apenas pelo Sup Admin). */
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

// Nome das prospecções, para os orçamentos OCRP. Eles não têm cliente até
// serem aprovados; sem isto a coluna Cliente mostrava "—" e o orçamento
// ficava anônimo na lista.
const cacheProspeccoes = new Map();

async function carregarProspeccoesParaOrcamentos() {
  try {
    const resp = await fetchApi('/api/prospeccoes/lista?incluirArquivadas=1');
    if (!resp.ok) throw new Error('Erro HTTP ' + resp.status);
    const dados = await resp.json();
    (Array.isArray(dados?.itens) ? dados.itens : []).forEach(p => {
      cacheProspeccoes.set(String(p.id), p.nome_fantasia || p.razao_social || 'Prospecção');
    });
  } catch (err) {
    // Falha aqui não pode derrubar a lista de orçamentos: o pior caso é a
    // coluna mostrar o rótulo genérico.
    console.error('Erro ao carregar prospecções para a lista de orçamentos:', err);
  }
}

/** Quem é o destinatário do orçamento: o cliente ou, ainda, a prospecção. */
function obterDestinatario(orcamento) {
  if (orcamento.cliente_id) return obterNomeCliente(orcamento.cliente_id);
  if (orcamento.prospeccao_id) {
    return (cacheProspeccoes.get(String(orcamento.prospeccao_id)) || 'Prospecção') + ' (prospecção)';
  }
  return '—';
}

function formatarDataLocal(isoDate) {
    if (!isoDate) return '';
    const data = new Date(isoDate);
    if (isNaN(data)) return '';
    return data.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
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
    overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.style.zIndex = 'var(--z-dialog)';
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

function openQuoteModal(htmlPath, scriptPath, overlayId) {
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
        window.removeEventListener('orcamentoModalLoaded', handleLoaded);
    }
    window.addEventListener('orcamentoModalLoaded', handleLoaded);
    Modal.open(htmlPath, scriptPath, overlayId, true);
}

function openConversionFlow(id) {
    Modal.closeAll();
    const spinner = document.createElement('div');
    spinner.id = 'modalLoading';
    spinner.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    spinner.style.zIndex = 'var(--z-dialog)';
    spinner.innerHTML = '<div class="app-loading-indicator app-loading-indicator--compact" aria-hidden="true"><span class="module-loading-orbit"></span><span class="module-loading-core"><img src="../assets/Logo.ico" alt=""></span></div>';
    document.body.appendChild(spinner);
    let editReady = false;
    let converterReady = false;
    const finalize = () => {
        if (!editReady || !converterReady) return;
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
        show();
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
        // Ver a nota gêmea em pedidos.js: em paralelo, e os clientes só na
        // primeira vez — o cache de nomes é aditivo e não expira.
        const [resp] = await Promise.all([
            fetchApi('/api/orcamentos'),
            cacheClientes.size ? Promise.resolve() : carregarClientes(),
            cacheProspeccoes.size ? Promise.resolve() : carregarProspeccoesParaOrcamentos()
        ]);
        const data = await resp.json();

        // O cache de nomes é aditivo e não expira — o que é bom para não
        // recarregar a lista inteira a cada abertura, e ruim logo depois de uma
        // conversão: o cliente ACABOU de nascer e não está nele, então a coluna
        // saía "—" até reiniciar o módulo. Se aparecer um id desconhecido,
        // recarrega uma vez e segue.
        const faltaCliente = data.some(o => o.cliente_id && !cacheClientes.has(o.cliente_id));
        const faltaProspeccao = data.some(o =>
            !o.cliente_id && o.prospeccao_id && !cacheProspeccoes.has(String(o.prospeccao_id)));
        if (faltaCliente || faltaProspeccao) {
            await Promise.all([
                faltaCliente ? carregarClientes() : Promise.resolve(),
                faltaProspeccao ? carregarProspeccoesParaOrcamentos() : Promise.resolve()
            ]);
        }
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
                        const dataFormatada = formatarDataLocal(o.data_emissao);

            const convertTitle = convertBlocked
                ? (isDraft
                    ? 'Converter indisponível para orçamentos em rascunho'
                    : 'Converter indisponível para este status')
                : 'Converter em pedido';
            const convertClass = convertBlocked ? 'icon-disabled' : '';
            tr.innerHTML = `
                <td data-perm-col="col_orc_num" class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${o.numero}</td>
                <td data-perm-col="col_orc_cliente" class="px-6 py-4 whitespace-nowrap text-sm text-white">${obterDestinatario(o)}</td>
                <td data-perm-col="col_orc_data" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${dataFormatada}</td>
                <td data-perm-col="col_orc_total" class="px-6 py-4 whitespace-nowrap text-sm text-white">${valor}</td>
                <td data-perm-col="col_orc_cond_pagto" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${condicao}</td>
                <td data-perm-col="col_orc_status" class="px-6 py-4 whitespace-nowrap"><span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">${o.situacao}</span></td>
                <td class="px-6 py-4 whitespace-nowrap text-left">
                    <div class="flex items-center justify-start space-x-2">
                        <i data-perm="orc.convert" class="fas fa-money-bill-wave w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 ${convertClass}" style="color: var(--color-primary)" title="${convertTitle}"></i>
                        <i data-perm="orc.view.details" class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Visualizar"></i>
                        <i data-perm="orc.edit" class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 ${editClass}" style="color: var(--color-primary)" title="Editar"></i>
                        <i data-perm="orc.delete" class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 acao-sup-admin hidden" title="Excluir orçamento" style="color: var(--color-red)"></i>
                        <i data-perm="orc.export" class="fas fa-download w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 ${downloadClass}" style="color: var(--color-primary)" title="${downloadTitle}"></i>
                    </div>
                </td>`;
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
                const o = data[Number(tr.dataset.index)] ?? data.find(x => String(x.numero) === tr.cells[0]?.textContent?.trim());
                if (!o) return;
                confirmarExclusaoSupAdmin(`Excluir definitivamente o orçamento ${o.numero}? Esta ação não pode ser desfeita.`, async ok => {
                    if (!ok) return;
                    // Ver a nota gêmea em pedidos.js: depois do diálogo não há
                    // botão para marcar, e a espera ficava muda.
                    await comCarregamento(async () => {
                    try {
                        const resp = await fetchApi(`/api/orcamentos/${encodeURIComponent(o.id)}`, { method: 'DELETE' });
                        const corpo = await resp.json().catch(() => null);
                        if (!resp.ok) {
                            // Ver a nota gêmea em pedidos.js: sem o motivo do
                            // backend sobrava "não foi possível" e nada a fazer.
                            throw new Error(corpo?.detalhe || corpo?.error || `HTTP ${resp.status}`);
                        }
                        // Tabela primeiro, aviso depois — ainda sob o carregando.
                        await carregarOrcamentos();
                        window.showToast?.(`Orçamento ${o.numero} excluído.`, 'success');
                        if (Array.isArray(corpo?.avisos) && corpo.avisos.length) {
                            console.warn('Exclusão do orçamento com avisos:', corpo.avisos);
                            window.showToast?.(`Excluído com ${corpo.avisos.length} aviso(s). Veja o console.`, 'info');
                        }
                    } catch (err) {
                        console.error('Erro ao excluir orçamento', err);
                        window.showToast?.(err?.message || 'Não foi possível excluir o orçamento.', 'error');
                    }
                    }, `Excluindo o orçamento ${o.numero}...`);
                });
            });
        });

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

                if (!window.electronAPI?.openPdf) {
                    window.notifyDesktopOnlyPdf?.(id);
                    return;
                }

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
    // Proposta para quem ainda NÃO é cliente. Abre o mesmo modal: o que muda é
    // o destinatário — o seletor passa a listar prospecções, e o orçamento
    // nasce com numeração OCRP.
    const novoProspeccaoBtn = document.getElementById('novoOrcamentoProspeccaoBtn');
    if (novoProspeccaoBtn) {
        novoProspeccaoBtn.addEventListener('click', () => {
            window.orcamentoProspeccao = { escolher: true };
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
