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
                <h3 class="ctl-modal-titulo mb-4 text-red-400">Confirmar exclusão</h3>
                <p class="text-sm text-gray-300 mb-4">${mensagem}</p>
                <div class="text-left mb-6">
                    <label for="excluirMotivo" class="ctl-rotulo text-gray-300">Motivo da exclusão <span class="text-[var(--color-red)]">*</span></label>
                    <textarea id="excluirMotivo" rows="3" maxlength="600" placeholder="Por que está sendo excluído?"
                        class="w-full ctl-campo bg-input border border-inputBorder text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition resize-none"></textarea>
                    <p id="excluirMotivoErro" class="mt-2 text-xs text-red-400 hidden">Escreva o motivo da exclusão.</p>
                </div>
                <div class="ctl-acoes justify-center">
                    <button id="excluirSim" class="btn-danger ctl-botao text-white">Excluir</button>
                    <button id="excluirNao" class="btn-neutral ctl-botao text-white">Cancelar</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    // Motivo obrigatório (decisão do dono, 02/10/2026): vai no aviso de quem
    // tinha o orçamento e no histórico do cliente/prospecção.
    const motivoEl = overlay.querySelector('#excluirMotivo');
    motivoEl.focus();
    overlay.querySelector('#excluirSim').addEventListener('click', () => {
        const motivo = motivoEl.value.trim();
        if (!motivo) {
            overlay.querySelector('#excluirMotivoErro').classList.remove('hidden');
            motivoEl.focus();
            return;
        }
        overlay.remove();
        cb(true, motivo);
    });
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
async function showPdfUnavailableDialog(id) {
    const converter = await window.DialogPadrao?.confirm({
        title: 'PDF indisponível', tom: 'aviso', icone: 'fa-file-pdf',
        message: 'Orçamento em RASCUNHO não gera PDF.',
        nota: '"Converter para Pendente" muda a situação do orçamento; depois disso o PDF pode ser gerado.',
        confirmText: 'Converter para Pendente', cancelText: 'OK', confirmVariant: 'primary'
    });
    if (!converter) return;
    try {
        await fetchApi(`/api/orcamentos/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ situacao: 'Pendente' })
        });
        carregarOrcamentos();
    } catch (err) {
        console.error('Erro ao atualizar status', err);
    }
}

function showFunctionUnavailableDialog(message) {
    window.DialogPadrao?.info({ title: 'Função indisponível', tom: 'aviso', icone: 'fa-lock', message });
}

function openQuoteModal(htmlPath, scriptPath, overlayId) {
    // O spinner único (src/utils/modal.js › openModuleModal, desempenho
    // 06/10/2026). Visualizar e Editar avisam `orcamentoModalLoaded` depois de
    // ler o orçamento. A cópia antiga não tinha relógio: orçamento que não
    // carregava (id vazio, erro) deixava a tela escura presa. Sem piso, como
    // sempre foi aqui: aparece assim que o orçamento chega.
    return Modal.openModuleModal(htmlPath, scriptPath, overlayId, { eventosDePronto: ['orcamentoModalLoaded'], minSpinnerMs: 0 });
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
            // Os filtros leem daqui: a célula do cliente pode ganhar as peças
            // achadas pelo filtro avançado, e aí o texto dela já não é o nome.
            tr.dataset.cliente = obterDestinatario(o);
            tr.dataset.numero = o.numero || '';
            // Guardada na linha para o botão Converter checá-la ANTES de abrir a
            // revisão de peças — o handler dele fica fora deste laço.
            tr.dataset.transportadora = (o.transportadora || '').trim();
            if (o.dono) owners.add(o.dono);
            const condicao = o.parcelas > 1 ? `${o.parcelas}x` : 'À vista';
            const badgeClass = statusClasses[o.situacao] || 'badge-neutral';
            const valor = Number(o.valor_final || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
            const isDraft = o.situacao === 'Rascunho';
            const downloadClass = isDraft ? 'pdf-disabled relative' : '';
            const downloadTitle = isDraft ? 'PDF indisponível' : 'Ver PDF';
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
                <td data-perm-col="col_orc_num" class="sem-quebra px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${o.numero}</td>
                <td data-perm-col="col_orc_cliente" class="px-6 py-4 whitespace-nowrap text-sm text-white">${obterDestinatario(o)}</td>
                <td data-perm-col="col_orc_data" class="sem-quebra px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${dataFormatada}</td>
                <td data-perm-col="col_orc_total" class="sem-quebra px-6 py-4 whitespace-nowrap text-sm text-white">${valor}</td>
                <td data-perm-col="col_orc_cond_pagto" class="sem-quebra px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${condicao}</td>
                <td data-perm-col="col_orc_status" class="sem-quebra px-6 py-4 whitespace-nowrap"><span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">${o.situacao}</span></td>
                <td class="sem-quebra px-6 py-4 whitespace-nowrap text-left">
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
                confirmarExclusaoSupAdmin(`Excluir definitivamente o orçamento ${o.numero}? Esta ação não pode ser desfeita.`, async (ok, motivo) => {
                    if (!ok) return;
                    // Ver a nota gêmea em pedidos.js: depois do diálogo não há
                    // botão para marcar, e a espera ficava muda.
                    await comCarregamento(async () => {
                    try {
                        const resp = await fetchApi(`/api/orcamentos/${encodeURIComponent(o.id)}`, {
                            method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo })
                        });
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

                if (!window.electronAPI?.gerarPdfDocumento || !window.VisualizadorPdf) {
                    window.notifyDesktopOnlyPdf?.(id);
                    return;
                }

                // Visualizador de PDF (Fase 2): o mesmo PDF de antes, aberto no
                // "Visualizar documento" para ver, imprimir ou salvar dali.
                const numero = tr.dataset.numero || '';
                window.VisualizadorPdf.abrir({
                    titulo: numero ? `Orçamento ${numero}` : 'Orçamento',
                    subtitulo: tr.dataset.cliente || '',
                    nomeArquivo: `orcamento-${numero || id}`,
                    tituloSalvar: 'Salvar Orçamento em PDF',
                    gerar: window.VisualizadorPdf.doDocumento(id, 'orcamento')
                });
            });
        });
        tbody.querySelectorAll('.fa-money-bill-wave').forEach(icon => {
            icon.addEventListener('click', async e => {
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

                // A transportadora é exigida para gerar o pedido. Descobrir isso
                // só DEPOIS da revisão peça a peça joga fora todo o trabalho de
                // seleção — o erro aparecia no fim, na confirmação.
                if (!tr.dataset.transportadora) {
                    const numero = tr.cells?.[0]?.innerText?.trim() || `#${id}`;
                    const abrir = await window.DialogPadrao?.confirm({
                        title: 'Falta a transportadora',
                        message: `O orçamento ${numero} não tem transportadora definida, e ela é obrigatória para gerar o pedido.

Abrir o orçamento para preencher agora?`,
                        confirmText: 'Abrir orçamento'
                    });
                    if (!abrir) return;
                    window.selectedQuoteId = id;
                    openQuoteModal('modals/orcamentos/editar.html', '../js/modals/orcamento-editar.js', 'editarOrcamento');
                    return;
                }

                openConversionFlow(id);
            });
        });
        await popularClientes();
        updateEmptyStateOrcamentos(data.length > 0);
        // A lista foi refeita: os filtros que estão na tela voltam a valer (antes
        // só o período personalizado era reaplicado, e o resto ficava marcado
        // sem efeito depois de salvar um orçamento). As peças são relidas na
        // próxima busca avançada.
        pecasDosOrcamentos?.limpar();
        aplicarFiltro();
    } catch (err) {
        console.error('Erro ao carregar orçamentos', err);
    }
}
window.reloadOrcamentos = carregarOrcamentos;

// Filtro avançado (dono, 08/10/2026): as peças de cada orçamento, lidas só
// quando alguém usa o filtro (FiltrosAvancados.leitorDePecas).
const pecasDosOrcamentos = window.FiltrosAvancados?.leitorDePecas('orcamentos') || null;
let controleFiltrosAvancados = null;

/** O filtro avançado na linha: casa? E, se casou pela peça, mostra quais. */
function filtroAvancadoNaLinha(row, termos) {
    const celula = row.cells[1];
    celula?.querySelector('[data-filtro-achados]')?.remove();
    if (!termos.length || !pecasDosOrcamentos?.pronto()) return true;
    const resultado = window.FiltrosAvancados.documentoCasa(termos, {
        numero: row.dataset.numero,
        cliente: row.dataset.cliente,
        pecas: pecasDosOrcamentos.pecas(row.dataset.id)
    });
    if (resultado.casa && resultado.pecas.length && celula) {
        celula.insertAdjacentHTML('beforeend', window.FiltrosAvancados.achadosHtml(resultado.pecas.map(window.FiltrosAvancados.etiquetaCurtaDaPeca)));
    }
    return resultado.casa;
}

function aplicarFiltro() {
    const status = document.getElementById('filterStatus')?.value || '';
    const periodo = document.getElementById('filterPeriod')?.value || '';
    const dono = document.getElementById('filterOwner')?.value || '';
    const cliente = document.getElementById('filterClient')?.value.toLowerCase() || '';
    const termos = window.BuscaAoDigitar?.termos(document.getElementById('filtroAvancadoOrcamentos')?.value || '') || [];
    controleFiltrosAvancados?.sinalizar(termos.length > 0);
    // Primeira busca avançada: lê as peças e refaz o filtro quando chegarem.
    if (termos.length && pecasDosOrcamentos && !pecasDosOrcamentos.pronto()) {
        pecasDosOrcamentos.ler().then(aplicarFiltro);
    }
    const now = new Date();
    const customPeriod = window.customPeriodOrcamentos;
    document.querySelectorAll('#orcamentosTabela tr').forEach(row => {
        const rowStatus = row.cells[5]?.innerText.trim() || '';
        const rowCliente = (row.dataset.cliente ?? row.cells[1]?.innerText ?? '').trim().toLowerCase();
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
        // Por último: só as linhas que passaram nos outros ganham as etiquetas.
        show = filtroAvancadoNaLinha(row, show ? termos : []) && show;

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
    const avancado = document.getElementById('filtroAvancadoOrcamentos');
    if (avancado) avancado.value = '';
    window.customPeriodOrcamentos = null;
    aplicarFiltro();
}

function initOrcamentos() {
    // A entrada em cascata é só do CSS (`animate-fade-in-up`, um bloco depois do
    // outro, como no Financeiro). Não ponha opacity/transform inline aqui: o
    // fadeInUp parte do valor que o bloco já tem, e com opacity 1 a animação
    // ficava invisível (06/10/2026).

    const novoBtn = document.getElementById('novoOrcamentoBtn');
    if (novoBtn) {
        novoBtn.addEventListener('click', () => {
            Modal.openModuleModal('modals/orcamentos/novo.html', '../js/modals/orcamento-novo.js', 'novoOrcamento');
        });
    }
    // Proposta para quem ainda NÃO é cliente. Abre o mesmo modal: o que muda é
    // o destinatário — o seletor passa a listar prospecções, e o orçamento
    // nasce com numeração OCRP.
    const novoProspeccaoBtn = document.getElementById('novoOrcamentoProspeccaoBtn');
    if (novoProspeccaoBtn) {
        novoProspeccaoBtn.addEventListener('click', () => {
            window.orcamentoProspeccao = { escolher: true };
            Modal.openModuleModal('modals/orcamentos/novo.html', '../js/modals/orcamento-novo.js', 'novoOrcamento');
        });
    }

    document.getElementById('orcamentosEmptyNew')?.addEventListener('click', () => {
        document.getElementById('novoOrcamentoBtn')?.click();
    });

    const filtrar = document.getElementById('btnFiltrar');
    const limpar = document.getElementById('btnLimpar');
    if (filtrar) filtrar.addEventListener('click', aplicarFiltro);
    if (limpar) limpar.addEventListener('click', limparFiltros);

    // Filtros avançados: retraídos, crescem para baixo; filtram enquanto digita.
    controleFiltrosAvancados = window.FiltrosAvancados?.ligar({
        botao: document.getElementById('btnFiltrosAvancadosOrcamentos'),
        painel: document.getElementById('orcamentosFiltrosAvancados'),
        aoAbrir: () => {
            pecasDosOrcamentos?.ler();
            setTimeout(() => document.getElementById('filtroAvancadoOrcamentos')?.focus(), 50);
        }
    }) || null;
    window.BuscaAoDigitar?.ligar(document.getElementById('filtroAvancadoOrcamentos'), aplicarFiltro);

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

    // A primeira carga, publicada para o menu tirar a máscara na hora certa (06/10/2026).
    window.moduloPronto?.(carregarOrcamentos());
}

// De fora do módulo (tarefa, calendário): abrir um orçamento direto.
window.OrcamentosModulo = {
    abrirVisualizar(id) {
        window.selectedQuoteId = id;
        return openQuoteModal('modals/orcamentos/visualizar.html', '../js/modals/orcamento-visualizar.js', 'visualizarOrcamento');
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrcamentos);
} else {
    initOrcamentos();
}
