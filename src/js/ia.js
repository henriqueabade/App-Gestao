// Script principal do módulo IA.
//
// Consome GET /api/ia/lista, que devolve `itens`, `destinos`, `situacoes` e
// `resumo` de uma vez só. O backend já ordena e resolve o nome do responsável;
// aqui cuidamos de desenhar, filtrar e reagir ao clique.
//
// Os filtros são aplicados NO CLIENTE, sobre a lista já carregada — mesma
// razão dos outros módulos: a API remota só filtra por igualdade exata em
// coluna real (ver DEV-ONBOARDING.md, seção 3), então busca textual não teria
// como ser expressa numa query.

async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
}

// ---------------------------------------------------------------------------
// Estado do módulo
// ---------------------------------------------------------------------------

let todasLeituras = [];
let destinosDisponiveis = [];
let situacoesDisponiveis = [];

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

/**
 * Escapa antes de entrar em innerHTML. Título da leitura e nome de arquivo são
 * texto livre — o nome do arquivo vem de fora do sistema, o que é ainda pior:
 * um arquivo chamado `<img onerror=...>.xlsx` executaria ao desenhar a grade.
 */
function esc(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatarDataHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

/** Remove acento e caixa, para a busca casar "orçamento" com "orcamento". */
function normalizar(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

// ---------------------------------------------------------------------------
// Estados da tela
// ---------------------------------------------------------------------------

function mostrarEstado(estado, detalhe = '') {
    const alternar = (id, visivel) =>
        document.getElementById(id)?.classList.toggle('hidden', !visivel);

    alternar('iaTableWrapper', estado === 'lista');
    alternar('iaEmptyState', estado === 'vazio');
    alternar('iaLoading', estado === 'carregando');
    alternar('iaErro', estado === 'erro');

    if (estado === 'erro') {
        const alvo = document.getElementById('iaErroDetalhe');
        if (alvo) alvo.textContent = detalhe || '';
    }
}

/**
 * Distingue "não existe nada" de "o filtro não achou nada" — são problemas
 * diferentes e a saída para cada um é outra.
 */
function ajustarMensagemVazio(temDadosNaBase) {
    const titulo = document.getElementById('iaEmptyTitulo');
    const texto = document.getElementById('iaEmptyTexto');
    const botao = document.getElementById('iaEmptyNew');
    if (!titulo || !texto) return;

    if (temDadosNaBase) {
        titulo.textContent = 'Nenhuma leitura corresponde aos filtros';
        texto.textContent = 'Ajuste ou limpe os filtros para ver todas as leituras.';
        botao?.classList.add('hidden');
    } else {
        titulo.textContent = 'Nenhuma leitura ainda';
        texto.textContent = 'Envie uma planilha, um PDF ou uma foto e deixe a IA preencher o resto.';
        botao?.classList.remove('hidden');
    }
}

// ---------------------------------------------------------------------------
// Carregamento
// ---------------------------------------------------------------------------

async function carregarLeituras(preservarFiltros = false) {
    mostrarEstado('carregando');
    try {
        const resp = await fetchApi('/api/ia/lista');
        if (!resp.ok) {
            const corpo = await resp.json().catch(() => ({}));
            throw new Error(corpo.error || `Erro ${resp.status}`);
        }
        const dados = await resp.json();

        todasLeituras = Array.isArray(dados.itens) ? dados.itens : [];
        destinosDisponiveis = Array.isArray(dados.destinos) ? dados.destinos : [];
        situacoesDisponiveis = Array.isArray(dados.situacoes) ? dados.situacoes : [];

        popularFiltros(preservarFiltros);
        aplicarFiltros();
    } catch (err) {
        console.error('Falha ao carregar as leituras de IA:', err);
        mostrarEstado('erro', err.message || 'Erro desconhecido');
    }
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

/**
 * As opções vêm do backend, não de uma lista repetida aqui. Duas listas que
 * podem divergir é como as etapas do funil saíram de sincronia uma vez.
 */
function popularFiltros(preservar = false) {
    const preencher = (id, opcoes, rotuloTodos) => {
        const select = document.getElementById(id);
        if (!select) return;
        const anterior = preservar ? select.value : '';
        select.innerHTML = `<option value="">${rotuloTodos}</option>` +
            opcoes.map(o => `<option value="${esc(o.id)}">${esc(o.rotulo)}</option>`).join('');
        if (anterior && opcoes.some(o => String(o.id) === anterior)) select.value = anterior;
    };

    preencher('filtroDestinoIA', destinosDisponiveis, 'Todos');
    preencher('filtroStatusIA', situacoesDisponiveis, 'Todas');
}

function lerFiltros() {
    return {
        busca: normalizar(document.getElementById('filtroBuscaIA')?.value),
        destino: document.getElementById('filtroDestinoIA')?.value || '',
        status: document.getElementById('filtroStatusIA')?.value || ''
    };
}

function aplicarFiltros() {
    const f = lerFiltros();

    const filtrada = todasLeituras.filter(l => {
        if (f.destino && l.destino !== f.destino) return false;
        if (f.status && l.status !== f.status) return false;
        if (f.busca) {
            const alvo = normalizar([
                l.titulo, l.destino_rotulo, l.usuario_nome, l.modelo_ocr, l.modelo_llm
            ].filter(Boolean).join(' '));
            if (!alvo.includes(f.busca)) return false;
        }
        return true;
    });

    renderResumo(filtrada);
    renderTabela(filtrada);
}

function limparFiltros() {
    const campo = document.getElementById('filtroBuscaIA');
    if (campo) campo.value = '';
    const destino = document.getElementById('filtroDestinoIA');
    if (destino) destino.value = '';
    const status = document.getElementById('filtroStatusIA');
    if (status) status.value = '';
    aplicarFiltros();
}

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------

function renderResumo(lista) {
    const tags = document.getElementById('iaResumoTags');
    if (!tags) return;

    const porStatus = id => lista.filter(l => l.status === id).length;
    const emRevisao = porStatus('revisao');
    const comErro = porStatus('erro');
    const aplicadas = porStatus('aplicada');
    const itensAplicados = lista.reduce((s, l) => s + (Number(l.aplicados_qtd) || 0), 0);

    const etiqueta = (texto, classe) =>
        `<span class="${classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap">${esc(texto)}</span>`;

    tags.innerHTML = [
        etiqueta(`${lista.length} exibindo`, 'badge-neutral'),
        emRevisao ? etiqueta(`${emRevisao} para revisar`, 'badge-warning') : '',
        comErro ? etiqueta(`${comErro} com erro`, 'badge-danger') : ''
    ].join('');

    const popover = document.getElementById('iaResumoPopover');
    if (!popover) return;

    const linha = (rotulo, valor, classe = 'text-white') =>
        `<div class="flex justify-between gap-6 py-1">
            <span class="text-white/60 text-sm">${esc(rotulo)}</span>
            <span class="${classe} text-sm font-medium">${esc(valor)}</span>
        </div>`;

    popover.innerHTML = `
        <p class="text-xs uppercase tracking-wide text-white/50 mb-2">Resumo do que está na tela</p>
        ${linha('Leituras', String(lista.length))}
        ${linha('Esperando revisão', String(emRevisao), emRevisao ? 'text-[var(--color-primary-light)]' : 'text-white')}
        ${linha('Já aplicadas', String(aplicadas))}
        ${linha('Com erro', String(comErro), comErro ? 'text-[var(--color-red)]' : 'text-white')}
        ${linha('Registros gravados', String(itensAplicados))}
        <p class="mt-2 pt-2 border-t border-white/10 text-xs text-white/50">
            "Registros gravados" conta as linhas que já entraram nos módulos de destino.
        </p>`;
}

/** Popover do (i) do resumo — mesmo comportamento dos outros módulos. */
function ligarResumoInfo() {
    const icone = document.getElementById('iaResumoInfoIcon');
    const popover = document.getElementById('iaResumoPopover');
    if (!icone || !popover) return;

    icone.addEventListener('mouseenter', () => window.Popover?.abrir(popover, icone));
    icone.addEventListener('mouseleave', () => window.Popover?.fechar(popover));
}

/**
 * Popover do (i) de UMA linha: o que saiu da tabela.
 *
 * Arquivos, itens, modelos e data deixaram de ser coluna. Com oito colunas
 * numa tabela que mora dentro do módulo, os títulos quebravam em duas linhas e
 * o conteúdo de cada célula não cabia — a tabela mostrava tudo e não deixava
 * ler nada. Aqui a informação continua a um gesto de distância, e a tabela
 * volta a responder de relance às perguntas que se faz olhando para ela.
 *
 * Um único elemento é reposicionado a cada (i). Um popover por linha seria um
 * nó a mais por leitura, para algo que só uma de cada vez fica visível.
 */
function abrirPopoverDaLinha(icone, leitura, modelosHtml) {
    const popover = document.getElementById('iaLinhaPopover');
    if (!popover) return;

    // `data-perm-col` continua em cada linha: as permissões de coluna
    // (col_ia_arquivos, col_ia_itens, col_ia_modelo, col_ia_data) foram
    // cadastradas para estes quatro dados, e o que mudou foi ONDE eles
    // aparecem, não quem pode vê-los. Sem isto, desmarcar "Data" no perfil
    // deixaria de ter efeito — uma permissão que não protege nada é pior do
    // que uma permissão que não existe.
    const linha = (perm, rotulo, valorHtml) =>
        `<div data-perm-col="${perm}" class="flex justify-between gap-6 py-1">
            <span class="text-white/60 text-sm">${esc(rotulo)}</span>
            <span class="text-white text-sm font-medium text-right">${valorHtml}</span>
        </div>`;

    const aplicados = Number(leitura.aplicados_qtd) || 0;
    const itens = Number(leitura.itens_qtd) || 0;

    popover.innerHTML = `
        <p class="text-xs uppercase tracking-wide text-white/50 mb-2">${esc(leitura.titulo || `Leitura #${leitura.id}`)}</p>
        ${linha('col_ia_arquivos', 'Arquivos', String(Number(leitura.arquivos_qtd) || 0))}
        ${linha('col_ia_itens', 'Itens', `<span class="ia-contagem"><span class="ia-contagem__aplicados">${aplicados}</span><span class="ia-contagem__separador">/</span>${itens}</span>`)}
        ${linha('col_ia_modelo', 'Modelos', modelosHtml)}
        ${linha('col_ia_data', 'Data', esc(formatarDataHora(leitura.criado_em)))}`;

    // Não é preciso reaplicar as permissões à mão: `permissoes.js` observa o
    // DOM e trata os nós novos assim que eles entram.

    // `Popover.abrir` move o elemento para fora do ancestral borrado e trata
    // as bordas da tela. Ver src/js/utils/popover.js.
    window.Popover?.abrir(popover, icone);
}

function fecharPopoverDaLinha() {
    window.Popover?.fechar(document.getElementById('iaLinhaPopover'));
}

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

function ligarAcao(el, handler) {
    if (!el) return;
    const acao = e => {
        e.stopPropagation();
        return handler();
    };
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(el, acao);
    else el.addEventListener('click', acao);
}

const rotuloSituacao = id =>
    situacoesDisponiveis.find(s => s.id === id)?.rotulo || id || '—';

const iconeDestino = id =>
    destinosDisponiveis.find(d => d.id === id)?.icone || 'fa-wand-magic-sparkles';

function renderTabela(lista) {
    const tbody = document.getElementById('iaTableBody');
    if (!tbody) return;

    if (!lista.length) {
        tbody.innerHTML = '';
        ajustarMensagemVazio(todasLeituras.length > 0);
        mostrarEstado('vazio');
        return;
    }

    mostrarEstado('lista');
    tbody.innerHTML = '';

    lista.forEach(l => {
        const tr = document.createElement('tr');
        tr.className = 'ia-linha';
        tr.dataset.id = l.id;

        // Uma leitura aplicada não volta atrás: os registros que ela criou já
        // vivem nos módulos de destino. Excluí-la só apagaria a procedência,
        // que é justamente o motivo de guardar a leitura.
        const aplicada = l.status === 'aplicada';

        /**
         * Ícone de ação. Quando `travada`, continua VISÍVEL — some a ação, não
         * a informação de que ela existe — mas ganha `data-inerte`, que impede
         * o clique e explica o porquê no title.
         */
        const acao = ({ perm, icone, classe, gancho, titulo, travada }) => `
                    <i data-perm="${perm}" class="fas ${icone} acao-tabela ${classe}${travada ? ' acao-tabela--inerte' : ` ${gancho}`}"
                       ${travada ? 'data-inerte="true"' : ''} title="${esc(travada || titulo)}"></i>`;

        const modelos = [l.modelo_ocr, l.modelo_llm].filter(Boolean);
        const modelosHtml = modelos.length
            ? modelos.map(m => `<span class="ia-modelo" title="${esc(m)}">${esc(m)}</span>`).join('<br>')
            : '<span class="text-white/40 text-sm">—</span>';

        const titulo = l.titulo || `Leitura #${l.id}`;
        const alertaErro = l.erro
            ? `<i class="fas fa-triangle-exclamation text-xs ml-2" style="color: var(--color-red)" title="${esc(l.erro)}"></i>`
            : '';

        tr.innerHTML = `
            <td data-perm-col="col_ia_titulo" class="px-4 py-3 text-sm">
                <span class="ia-titulo-celula">
                    <i class="info-icon ia-info-linha" data-id="${l.id}"></i>
                    <span class="text-white font-medium">${esc(titulo)}</span>${alertaErro}
                </span>
            </td>
            <td data-perm-col="col_ia_destino" class="px-4 py-3 text-sm">
                <span class="ia-destino"><i class="fas ${esc(iconeDestino(l.destino))}"></i>${esc(l.destino_rotulo)}</span>
            </td>
            <td data-perm-col="col_ia_status" class="px-4 py-3 whitespace-nowrap">
                <span class="badge-ia badge-ia--${esc(l.status)}">${esc(rotuloSituacao(l.status))}</span>
            </td>
            <td data-perm-col="col_ia_usuario" class="px-4 py-3 whitespace-nowrap text-sm text-white">${esc(l.usuario_nome || '—')}</td>
            <td class="px-4 py-3 whitespace-nowrap text-left">
                <div class="flex items-center justify-start space-x-2">
                    ${acao({ perm: 'ia.details.view', icone: 'fa-eye', classe: 'acao-tabela--ver', gancho: 'acao-ver', titulo: 'Abrir a leitura' })}
                    ${acao({
                        perm: 'ia.delete', icone: 'fa-trash',
                        classe: 'acao-tabela--excluir', gancho: 'acao-excluir',
                        titulo: aplicada
                            ? 'Excluir — os registros criados continuam nos módulos'
                            : 'Excluir',
                        // Leitura aplicada é registro do que aconteceu, e o
                        // revisor comum não a apaga. O Sup Admin apaga: é o
                        // remédio para o que não deveria estar guardado, e não
                        // há outra forma de tirá-la.
                        travada: aplicada && !window.Permissoes?.supAdmin
                            && 'Leitura já aplicada — só o Sup Admin pode excluí-la'
                    })}
                </div>
            </td>`;

        // O (i) carrega o que saiu da tabela. `stopPropagation` porque a linha
        // inteira abre a leitura, e quem clica no (i) quer só espiar.
        const info = tr.querySelector('.ia-info-linha');
        if (info) {
            const mostrar = () => abrirPopoverDaLinha(info, l, modelosHtml);
            info.addEventListener('mouseenter', mostrar);
            info.addEventListener('click', e => { e.stopPropagation(); mostrar(); });
            info.addEventListener('mouseleave', fecharPopoverDaLinha);
        }

        // Ação travada: o clique não pode vazar para a linha nem passar em
        // branco — o usuário merece saber por quê.
        tr.querySelectorAll('[data-inerte]').forEach(icone => {
            icone.addEventListener('click', e => {
                e.stopPropagation();
                showToast(icone.getAttribute('title') || 'Ação indisponível', 'info');
            });
        });

        // Cada ícone conhece a SUA leitura pelo closure, e todos passam por
        // `ligarAcao`: a rede automática do BotaoAcao só segura ações que vão
        // por `window.electronAPI`, e aqui tudo vai por `fetch`.
        ligarAcao(tr.querySelector('.acao-ver'), () => abrirDetalhesLeitura(l));
        ligarAcao(tr.querySelector('.acao-excluir'), () => abrirExcluirLeitura(l));
        tr.addEventListener('click', () => abrirDetalhesLeitura(l));

        tbody.appendChild(tr);
    });

    // Reaplica ações e colunas nas linhas recém-criadas: o aplicador roda uma
    // vez no carregamento da página e não conhece o que o JS desenhou depois.
    window.Permissoes?.aplicarAcoesEColunas?.(tbody);
}

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

/**
 * Abre um modal grande mostrando o spinner até ele estar pronto.
 *
 * O overlay destes modais nasce com `hidden` e SÓ é revelado aqui, ao receber
 * `modalSpinnerLoaded` com o id certo. Tirar o spinner sem remover o `hidden`
 * deixa a tela em branco — foi exatamente assim que o "visualizar orçamento"
 * ficou sem abrir por um tempo.
 */
function openModalWithSpinner(htmlPath, scriptPath, overlayId) {
    window.__registrarModalAberto?.({ htmlPath, scriptPath, overlayId });
    Modal.closeAll();

    const spinner = document.createElement('div');
    spinner.id = 'modalLoading';
    spinner.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    spinner.style.zIndex = 'var(--z-dialog)';
    spinner.innerHTML = '<div class="app-loading-indicator app-loading-indicator--compact" aria-hidden="true"><span class="module-loading-orbit"></span><span class="module-loading-core"><img src="../assets/Logo.ico" alt=""></span></div>';
    document.body.appendChild(spinner);

    // Tempo mínimo de spinner: evita o "piscar" quando o modal fica pronto
    // rápido demais. Não atrasa a busca dos dados, só a revelação.
    const MIN_SPINNER_MS = 1000;
    const inicioSpinner = Date.now();

    // A promessa só resolve quando o modal aparece: é ela que segura o ícone
    // da grade em "carregando" e engole o segundo clique enquanto isso.
    let concluir;
    const pronto = new Promise(r => { concluir = r; });

    function handleLoaded(e) {
        if (e.detail !== overlayId) return;
        const restante = Math.max(0, MIN_SPINNER_MS - (Date.now() - inicioSpinner));
        setTimeout(() => {
            const overlay = document.getElementById(`${overlayId}Overlay`);
            spinner.remove();
            overlay?.classList.remove('hidden');
            concluir();
        }, restante);
        window.removeEventListener('modalSpinnerLoaded', handleLoaded);
    }
    window.addEventListener('modalSpinnerLoaded', handleLoaded);

    Modal.open(htmlPath, scriptPath, overlayId, true);
    return pronto;
}

function abrirConfiguracaoIA() {
    return openModalWithSpinner('modals/ia/configuracao.html', '../js/modals/ia-configuracao.js', 'iaConfiguracao');
}

function abrirDetalhesLeitura(leitura) {
    window.iaLeituraSelecionada = leitura;
    return openModalWithSpinner('modals/ia/detalhes.html', '../js/modals/ia-detalhes.js', 'iaDetalhes');
}

/**
 * Confirmação de exclusão: modal pequeno, sem spinner. O overlay dele não tem
 * `hidden`, então abrir por `Modal.open` direto já o mostra.
 */
function abrirExcluirLeitura(leitura) {
    window.iaLeituraExcluir = leitura;
    return Modal.open('modals/ia/excluir.html', '../js/modals/ia-excluir.js', 'iaExcluir');
}

function abrirNovaLeitura() {
    return openModalWithSpinner('modals/ia/nova.html', '../js/modals/ia-nova.js', 'iaNova');
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

function initIA() {
    document.getElementById('btnNovaLeitura')?.addEventListener('click', abrirNovaLeitura);
    document.getElementById('iaEmptyNew')?.addEventListener('click', abrirNovaLeitura);
    document.getElementById('btnConfigIA')?.addEventListener('click', abrirConfiguracaoIA);

    document.getElementById('btnFiltrarIA')?.addEventListener('click', aplicarFiltros);
    document.getElementById('btnLimparIA')?.addEventListener('click', limparFiltros);
    document.getElementById('iaTentarNovamente')?.addEventListener('click', () => carregarLeituras(true));

    // Enter no campo de busca filtra; digitar não, para não refazer a grade a
    // cada tecla numa lista que pode ter centenas de linhas.
    document.getElementById('filtroBuscaIA')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); aplicarFiltros(); }
    });
    document.getElementById('filtroDestinoIA')?.addEventListener('change', aplicarFiltros);
    document.getElementById('filtroStatusIA')?.addEventListener('change', aplicarFiltros);

    ligarResumoInfo();
    carregarLeituras();
}

/**
 * menu.js embrulha o script do módulo numa IIFE, então NADA aqui é global.
 * Sem este objeto, um modal que precisa atualizar a grade não tem como chamar
 * `carregarLeituras` — foi o que obrigou os outros módulos a publicarem o
 * mesmo contrato.
 */
window.IaModulo = {
    carregar: carregarLeituras,
    abrirDetalhes: abrirDetalhesLeitura,
    abrirConfiguracao: abrirConfiguracaoIA
};

// Quem alterou uma leitura avisa por evento, em vez de a grade ficar
// consultando o backend. Funciona também como saída para quem não conseguiu
// alcançar `window.IaModulo`.
window.addEventListener('iaLeituraAlterada', () => carregarLeituras(true));

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initIA);
} else {
    initIA();
}
