// Script principal do módulo Prospecções (CRM).
//
// Consome GET /api/prospeccoes/lista, que devolve `itens`, `funil` e `etapas`
// de uma vez só. O backend já ordena e resolve o nome do responsável — aqui
// cuidamos de desenhar, filtrar e reagir ao clique.
//
// Os filtros são aplicados NO CLIENTE, sobre a lista já carregada. Não é
// preguiça: a API remota só filtra por igualdade exata em coluna real
// (ver DEV-ONBOARDING.md, seção 3), então busca textual, faixa de valor e
// "próximo passo atrasado" não teriam como ser expressos numa query.

async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
}

// ---------------------------------------------------------------------------
// Estado do módulo
// ---------------------------------------------------------------------------

let todasProspeccoes = [];
let funilAtual = null;
let etapasDisponiveis = [];
let filtroGeo = { paises: [], estados: [] };

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

/**
 * Escapa antes de entrar em innerHTML. Nome de empresa, cargo e próximo passo
 * são texto livre digitado pelo usuário: sem isto, um `<img onerror=...>` no
 * nome fantasia executaria ao desenhar a grade.
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

const formatadorMoeda = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2
});

function formatarMoeda(valor) {
    const numero = Number(valor);
    return formatadorMoeda.format(Number.isFinite(numero) ? numero : 0);
}

/** Compacta valores grandes no funil: "R$ 320,0 mil" em vez de estourar a linha. */
function formatarMoedaCompacta(valor) {
    const numero = Number(valor) || 0;
    if (Math.abs(numero) >= 1_000_000) return `R$ ${(numero / 1_000_000).toFixed(1)} mi`;
    if (Math.abs(numero) >= 1_000) return `R$ ${(numero / 1_000).toFixed(1)} mil`;
    return formatarMoeda(numero);
}

/**
 * Formata uma coluna DATE (dia sem hora), como `proximo_passo_data`.
 *
 * NÃO use `new Date('2026-09-20')`: a norma manda interpretar a forma só-data
 * como meia-noite UTC, então a oeste de Greenwich o `toLocaleDateString`
 * devolve o dia ANTERIOR — o passo agendado para 20/09 aparecia como 19/09.
 * Aqui o dia é montado campo a campo, no fuso local.
 */
function formatarData(valor) {
    const dia = diaDe(valor);
    return dia ? dia.toLocaleDateString('pt-BR') : '';
}

function formatarDataHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

/** "Negociação" -> "negociacao", para casar com as classes CSS das etapas. */
function slugEtapa(etapa) {
    return String(etapa || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');
}

function normalizar(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

/** Meia-noite de hoje — base para comparar datas de próximo passo. */
function hojeZerado() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Data ISO (só o dia) zerada, para comparar sem sofrer com fuso. */
function diaDe(iso) {
    if (!iso) return null;
    const bruto = String(iso).slice(0, 10);
    const [ano, mes, dia] = bruto.split('-').map(Number);
    if (!ano || !mes || !dia) return null;
    return new Date(ano, mes - 1, dia);
}

// ---------------------------------------------------------------------------
// Estados da tela
// ---------------------------------------------------------------------------

function mostrarEstado(estado, detalhe = '') {
    const wrapper = document.getElementById('prospeccoesTableWrapper');
    const vazio = document.getElementById('prospeccoesEmptyState');
    const carregando = document.getElementById('prospeccoesLoading');
    const erro = document.getElementById('prospeccoesErro');
    const funil = document.getElementById('prospeccoesFunilCard');

    const alternar = (el, visivel) => el?.classList.toggle('hidden', !visivel);

    alternar(wrapper, estado === 'lista');
    alternar(vazio, estado === 'vazio');
    alternar(carregando, estado === 'carregando');
    alternar(erro, estado === 'erro');

    // O funil nasce oculto e só aparece quando o usuário pede — mas enquanto
    // carrega ou depois de uma falha ele não faz sentido nem se estiver ligado.
    if (funil?.dataset.ligado === '1') {
        alternar(funil, estado === 'lista' || estado === 'vazio');
    }

    if (estado === 'erro') {
        const alvo = document.getElementById('prospeccoesErroDetalhe');
        if (alvo) alvo.textContent = detalhe || '';
    }
}

/**
 * Distingue "não existe nada cadastrado" de "o filtro não achou nada" — são
 * problemas diferentes e a saída para cada um é outra.
 */
function ajustarMensagemVazio(temDadosNaBase) {
    const titulo = document.getElementById('prospeccoesEmptyTitulo');
    const texto = document.getElementById('prospeccoesEmptyTexto');
    const botao = document.getElementById('prospeccoesEmptyNew');
    if (!titulo || !texto) return;

    if (temDadosNaBase) {
        titulo.textContent = 'Nenhuma prospecção corresponde aos filtros';
        texto.textContent = 'Ajuste ou limpe os filtros para ver o pipeline completo.';
        botao?.classList.add('hidden');
    } else {
        titulo.textContent = 'Nenhuma prospecção encontrada';
        texto.textContent = 'Comece cadastrando a primeira empresa do seu pipeline.';
        botao?.classList.remove('hidden');
    }
}

// ---------------------------------------------------------------------------
// Carregamento
// ---------------------------------------------------------------------------

async function carregarProspeccoes(preservarFiltros = false) {
    const incluirArquivadas = document.getElementById('filtroIncluirArquivadas')?.checked;

    if (!preservarFiltros) mostrarEstado('carregando');

    try {
        const resp = await fetchApi(
            `/api/prospeccoes/lista${incluirArquivadas ? '?incluirArquivadas=1' : ''}`
        );

        if (resp.status === 403) {
            mostrarEstado('erro', 'Você não tem permissão para ver as prospecções.');
            return;
        }
        if (!resp.ok) {
            const corpo = await resp.json().catch(() => ({}));
            throw new Error(corpo.error || `Erro ${resp.status}`);
        }

        const dados = await resp.json();
        todasProspeccoes = Array.isArray(dados.itens) ? dados.itens : [];
        funilAtual = dados.funil || null;
        etapasDisponiveis = Array.isArray(dados.etapas) ? dados.etapas : [];

        // Publica as etapas para os modais. A ordem do funil é regra de
        // negócio que mora no backend (e no CHECK da tabela); os modais leem
        // daqui em vez de manter uma segunda cópia que sairia do lugar.
        window.PROSPECCOES_ETAPAS = etapasDisponiveis;

        popularFiltros(preservarFiltros);
        renderFunil(funilAtual);
        aplicarFiltros();
    } catch (err) {
        console.error('Erro ao carregar prospecções', err);
        mostrarEstado('erro', err.message || 'Falha de comunicação com o servidor.');
    }
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

function popularFiltros(preservar = false) {
    const etapaSel = document.getElementById('filtroEtapa');
    const origemSel = document.getElementById('filtroOrigem');
    const respSel = document.getElementById('filtroResponsavel');

    const guardar = el => (preservar ? el?.value || '' : '');
    const etapaAnterior = guardar(etapaSel);
    const origemAnterior = guardar(origemSel);
    const respAnterior = guardar(respSel);

    if (etapaSel) {
        // Vem do backend na ordem do funil — não ordenar alfabeticamente aqui,
        // senão "Contactado" apareceria antes de "Novo".
        etapaSel.innerHTML = '<option value="">Todas</option>' +
            etapasDisponiveis.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
        etapaSel.value = etapaAnterior;
    }

    if (origemSel) {
        const origens = [...new Set(todasProspeccoes.map(p => p.origem).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'pt-BR'));
        origemSel.innerHTML = '<option value="">Todas</option>' +
            origens.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
        origemSel.value = origemAnterior;
    }

    if (respSel) {
        const responsaveis = [...new Set(todasProspeccoes.map(p => p.responsavel).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'pt-BR'));
        respSel.innerHTML = '<option value="">Todos</option>' +
            responsaveis.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
        respSel.value = respAnterior;
    }
}

function lerFiltros() {
    const valorNumerico = id => {
        const bruto = document.getElementById(id)?.value;
        if (!bruto) return null;
        const n = window.NumericInput?.parse
            ? window.NumericInput.parse(bruto)
            : Number(String(bruto).replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    };

    return {
        busca: normalizar(document.getElementById('filtroBusca')?.value),
        etapa: document.getElementById('filtroEtapa')?.value || '',
        origem: document.getElementById('filtroOrigem')?.value || '',
        responsavel: document.getElementById('filtroResponsavel')?.value || '',
        valorMin: valorNumerico('filtroValorMin'),
        valorMax: valorNumerico('filtroValorMax'),
        proximoPasso: document.getElementById('filtroProximoPasso')?.value || ''
    };
}

function combinaProximoPasso(p, modo) {
    if (!modo) return true;
    const data = diaDe(p.proximo_passo_data);
    const hoje = hojeZerado();

    if (modo === 'sem') return !p.proximo_passo && !p.proximo_passo_data;
    if (!data) return false;

    if (modo === 'atrasado') return data < hoje;
    if (modo === 'hoje') return data.getTime() === hoje.getTime();
    if (modo === 'semana') {
        const limite = new Date(hoje);
        limite.setDate(limite.getDate() + 7);
        return data >= hoje && data <= limite;
    }
    return true;
}

function aplicarFiltros() {
    const f = lerFiltros();

    const filtradas = todasProspeccoes.filter(p => {
        if (f.busca) {
            const campos = [
                p.nome_fantasia, p.razao_social, p.cnpj, p.segmento, p.origem,
                p.responsavel, p.proximo_passo, p.cidade, p.estado,
                p.contato_principal?.nome, p.contato_principal?.email
            ];
            if (!campos.some(c => normalizar(c).includes(f.busca))) return false;
        }
        if (f.etapa && p.etapa !== f.etapa) return false;
        if (f.origem && p.origem !== f.origem) return false;
        if (f.responsavel && p.responsavel !== f.responsavel) return false;

        const valor = Number(p.valor_estimado ?? 0);
        if (f.valorMin !== null && valor < f.valorMin) return false;
        if (f.valorMax !== null && valor > f.valorMax) return false;

        if (!combinaProximoPasso(p, f.proximoPasso)) return false;

        // Filtro geográfico vem do componente compartilhado GeoMultiSelect.
        if (filtroGeo.paises.length && !filtroGeo.paises.includes(p.pais)) return false;
        if (filtroGeo.estados.length && !filtroGeo.estados.includes(p.estado)) return false;

        return true;
    });

    renderTabela(filtradas);
    renderResumo(filtradas);
}

function limparFiltros() {
    ['filtroBusca', 'filtroValorMin', 'filtroValorMax'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    ['filtroEtapa', 'filtroOrigem', 'filtroResponsavel', 'filtroProximoPasso'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    filtroGeo = { paises: [], estados: [] };
    // Devolve os multiselects geográficos ao estado "todos".
    document.querySelectorAll('[data-geo-input]').forEach(input => {
        input.value = '';
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    document.querySelectorAll('[data-geo-summary]').forEach(span => {
        const gatilho = span.closest('[data-geo-multiselect]');
        span.textContent = gatilho?.dataset.geoPlaceholder || 'Todos';
    });

    aplicarFiltros();
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

/**
 * Funil em cartões lado a lado, não em barras empilhadas.
 *
 * Com a coluna lateral de filtros removida sobrou largura, e o que passou a ser
 * escasso é a ALTURA — sete barras empilhadas empurravam a tabela para fora da
 * tela justamente quando o usuário pedia o gráfico.
 */
function renderFunil(funil) {
    const container = document.getElementById('prospeccoesFunil');
    const total = document.getElementById('prospeccoesFunilTotal');
    if (!container) return;

    if (!funil || !Array.isArray(funil.etapas)) {
        container.innerHTML = '';
        if (total) total.textContent = '—';
        return;
    }

    // A barra é proporcional à MAIOR etapa, não ao total: com 7 etapas, usar o
    // total deixaria todas minúsculas e o gráfico ilegível.
    const maior = Math.max(1, ...funil.etapas.map(e => e.quantidade));

    container.innerHTML = funil.etapas.map(e => {
        const largura = Math.round((e.quantidade / maior) * 100);
        const slug = slugEtapa(e.etapa);
        return `
            <div class="funil-etapa">
                <div class="funil-etapa__topo">
                    <span class="funil-etapa__nome" title="${esc(e.etapa)}">${esc(e.etapa)}</span>
                    <span class="funil-etapa__qtd">${e.quantidade}</span>
                </div>
                <div class="funil-trilho">
                    <div class="funil-barra funil-barra--${slug}" style="width: ${largura}%"></div>
                </div>
                <div class="funil-etapa__valor">${formatarMoedaCompacta(e.valor)}</div>
            </div>`;
    }).join('');

    if (total) {
        total.textContent = `${funil.total} no total · ${funil.em_aberto} em aberto · ${funil.taxa_conversao}% de conversão`;
    }
}

/**
 * Resumo em etiquetas na barra de filtro, com o detalhe no popover (i) — mesmo
 * padrão do "Totais por Tipo" de Matéria-prima. Na coluna lateral cabia uma
 * lista; numa barra horizontal, não.
 */
function renderResumo(lista) {
    const tags = document.getElementById('prospeccoesResumoTags');
    if (!tags) return;

    const valorTotal = lista.reduce((s, p) => s + Number(p.valor_estimado ?? 0), 0);
    const ponderado = lista.reduce(
        (s, p) => s + Number(p.valor_estimado ?? 0) * (Number(p.probabilidade ?? 0) / 100), 0
    );
    const hoje = hojeZerado();
    const atrasadas = lista.filter(p => {
        const d = diaDe(p.proximo_passo_data);
        return d && d < hoje;
    }).length;

    const etiqueta = (texto, classe) =>
        `<span class="${classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap">${texto}</span>`;

    tags.innerHTML = [
        etiqueta(`${lista.length} exibindo`, 'badge-neutral'),
        etiqueta(formatarMoedaCompacta(valorTotal), 'badge-info'),
        atrasadas ? etiqueta(`${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}`, 'badge-danger') : ''
    ].join('');

    const popover = document.getElementById('resumoPopover');
    if (!popover) return;

    const linha = (rotulo, valor, classe = 'text-white') =>
        `<div class="flex justify-between gap-6 py-1">
            <span class="text-white/60 text-sm">${rotulo}</span>
            <span class="${classe} text-sm font-medium">${valor}</span>
        </div>`;

    popover.innerHTML = `
        <p class="text-xs uppercase tracking-wide text-white/50 mb-2">Resumo do que está na tela</p>
        ${linha('Prospecções', String(lista.length))}
        ${linha('Valor total', formatarMoeda(valorTotal))}
        ${linha('Previsão ponderada', formatarMoeda(ponderado))}
        ${linha('Passos atrasados', String(atrasadas), atrasadas ? 'prox-passo-atrasado' : 'text-white')}
        <p class="mt-2 pt-2 border-t border-white/10 text-xs text-white/50">
            A previsão ponderada multiplica cada valor pela probabilidade da etapa.
        </p>`;
}

// ---------------------------------------------------------------------------
// Popover (i) da linha
// ---------------------------------------------------------------------------

let popupLinhaAtual = null;

/**
 * O que saiu das colunas da tabela mora aqui.
 *
 * Os `data-perm-col` acompanham os campos: quem não pode ver o valor na grade
 * também não pode vê-lo no popover, senão esconder a coluna seria teatro.
 */
function criarConteudoPopupLinha(p) {
    const contato = p.contato_principal;
    const ponderado = Number(p.valor_estimado ?? 0) * (Number(p.probabilidade ?? 0) / 100);

    const info = (rotulo, valor, permissao) =>
        `<div${permissao ? ` data-perm-col="${permissao}"` : ''}>
            <p class="popup-info-label">${rotulo}</p>
            <p class="popup-info-value">${valor || '—'}</p>
        </div>`;

    /**
     * Botão de copiar ao lado do valor.
     *
     * O dado vai no `data-copiar` já escapado; o handler lê o atributo em vez
     * do texto renderizado, para não copiar junto o ícone ou espaço de layout.
     */
    const copiar = (valor, rotulo) =>
        `<button type="button" class="popup-copiar" data-copiar="${esc(valor)}"
                 data-rotulo="${esc(rotulo)}" title="Copiar ${esc(rotulo.toLowerCase())}"
                 aria-label="Copiar ${esc(rotulo.toLowerCase())}">
           <i class="fas fa-copy pointer-events-none"></i>
         </button>`;

    // Contato primeiro: é o dado que a pessoa procura ao passar o mouse.
    const blocoContato = contato
        ? `<div class="popup-secao">
             <p class="popup-info-label">Contato principal</p>
             <p class="popup-contato-nome popup-contato-linha">
               <span class="popup-contato-texto">${esc(contato.nome)}</span>
               ${copiar(contato.nome, 'Nome')}
             </p>
             ${contato.cargo ? `<p class="popup-contato-linha"><i class="fas fa-briefcase text-white/40"></i><span class="popup-contato-texto">${esc(contato.cargo)}</span></p>` : ''}
             ${contato.email ? `<p class="popup-contato-linha"><i class="fas fa-envelope text-white/40"></i><span class="popup-contato-texto">${esc(contato.email)}</span>${copiar(contato.email, 'E-mail')}</p>` : ''}
             ${contato.telefone_celular ? `<p class="popup-contato-linha"><i class="fas fa-phone text-white/40"></i><span class="popup-contato-texto">${esc(contato.telefone_celular)}</span>${copiar(contato.telefone_celular, 'Telefone')}</p>` : ''}
           </div>`
        : `<div class="popup-secao">
             <p class="popup-info-label">Contato principal</p>
             <p class="popup-info-value text-white/50">Nenhum contato cadastrado</p>
           </div>`;

    const proximoPasso = p.proximo_passo ? esc(p.proximo_passo) : '—';
    const dia = diaDe(p.proximo_passo_data);
    const atrasado = dia && dia < hojeZerado();
    const quando = p.proximo_passo_data
        ? `<span class="${atrasado ? 'prox-passo-atrasado' : ''}">${formatarData(p.proximo_passo_data)}${atrasado ? ' · atrasado' : ''}</span>`
        : '—';

    return `
    <div class="popup-card">
      <div class="popup-header">
        <p class="popup-header-subtitle" data-perm-col="col_pros_id">Prospecção #${esc(p.id)}</p>
        <h3 class="popup-header-title">${esc(p.nome_fantasia || p.razao_social || '')}</h3>
      </div>
      <div class="popup-body">
        ${blocoContato}
        <div class="popup-secao">
          <div class="popup-info-grid" style="margin-bottom:0">
            ${info('Valor estimado', esc(formatarMoeda(p.valor_estimado)), 'col_pros_valor')}
            ${info('Previsão ponderada', esc(formatarMoeda(ponderado)), 'col_pros_valor')}
          </div>
        </div>
        <div class="popup-secao">
          <div class="popup-info-grid" style="margin-bottom:0">
            ${info('Próximo passo', proximoPasso, 'col_pros_proximo_passo')}
            ${info('Para quando', quando, 'col_pros_proximo_passo_data')}
          </div>
        </div>
        <div class="popup-secao">
          <div class="popup-info-grid" style="margin-bottom:0">
            ${info('Atualizada em', esc(formatarDataHora(p.atualizado_em)), 'col_pros_atualizado_em')}
          </div>
          <div class="mt-3">
            <p class="popup-info-label">CNPJ</p>
            <p class="popup-info-value popup-info-value--inteiro">${esc(p.cnpj || '') || '—'}</p>
          </div>
        </div>
      </div>
    </div>`;
}

function esconderPopupLinha() {
    if (popupLinhaAtual) {
        popupLinhaAtual.remove();
        popupLinhaAtual = null;
    }
}
// O Modal.closeAll() do projeto chama este nome ao trocar de módulo.
window.hideRawMaterialInfoPopup = window.hideRawMaterialInfoPopup || esconderPopupLinha;

/**
 * Copia para a área de transferência.
 *
 * `navigator.clipboard` exige contexto seguro e falha em alguns cenários do
 * Electron; o `execCommand` fica como rede de proteção para o botão nunca
 * parecer quebrado.
 */
async function copiarTexto(texto) {
    try {
        await navigator.clipboard.writeText(texto);
        return true;
    } catch (_) {
        try {
            const campo = document.createElement('textarea');
            campo.value = texto;
            campo.style.position = 'fixed';
            campo.style.opacity = '0';
            document.body.appendChild(campo);
            campo.select();
            const ok = document.execCommand('copy');
            campo.remove();
            return ok;
        } catch (err) {
            console.error('Falha ao copiar', err);
            return false;
        }
    }
}

function mostrarPopupLinha(icone, p) {
    esconderPopupLinha();
    const { popup } = window.createPopup(icone, criarConteudoPopupLinha(p), { onHide: esconderPopupLinha });
    popupLinhaAtual = popup;

    // Delegação: os botões nascem junto com o HTML do popover.
    popup.addEventListener('click', async e => {
        const botao = e.target.closest('.popup-copiar');
        if (!botao) return;
        e.preventDefault();
        e.stopPropagation();

        const ok = await copiarTexto(botao.dataset.copiar || '');
        if (!ok) {
            showToast('Não foi possível copiar', 'error');
            return;
        }
        // Confirmação no próprio botão: o popover some ao tirar o mouse, e um
        // toast atrás dele passaria despercebido.
        botao.classList.add('copiado');
        botao.querySelector('i')?.classList.replace('fa-copy', 'fa-check');
        showToast(`${botao.dataset.rotulo} copiado!`, 'success');
        setTimeout(() => {
            botao.classList.remove('copiado');
            botao.querySelector('i')?.classList.replace('fa-check', 'fa-copy');
        }, 1500);
    });

    // O popover nasce em document.body, fora do alcance da varredura que roda
    // sobre a tabela — precisa da sua própria aplicação de permissões.
    window.Permissoes?.aplicarAcoesEColunas?.(popup);
}

function ligarIconeInfo(icone, p) {
    icone.addEventListener('mouseenter', () => mostrarPopupLinha(icone, p));
    icone.addEventListener('mouseleave', () => {
        setTimeout(() => {
            if (!popupLinhaAtual?.matches(':hover')) esconderPopupLinha();
        }, 100);
    });
    // Clicar no ícone não deve abrir o detalhe da linha.
    icone.addEventListener('click', e => e.stopPropagation());
}

function renderTabela(lista) {
    const tbody = document.getElementById('prospeccoesTableBody');
    if (!tbody) return;

    if (!lista.length) {
        tbody.innerHTML = '';
        ajustarMensagemVazio(todasProspeccoes.length > 0);
        mostrarEstado('vazio');
        return;
    }

    mostrarEstado('lista');
    tbody.innerHTML = '';

    lista.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = 'prospeccao-linha';
        tr.dataset.id = p.id;

        const empresa = esc(p.nome_fantasia || p.razao_social || '(sem nome)');
        const arquivada = p.status === 'arquivada'
            ? '<i class="fas fa-box-archive text-xs text-white/40 ml-2" title="Arquivada"></i>'
            : '';
        // Sinaliza atraso já na linha: o "para quando" foi para o popover, mas
        // perder o prazo de vista seria perder a informação mais acionável.
        const dia = diaDe(p.proximo_passo_data);
        const alerta = dia && dia < hojeZerado()
            ? '<i class="fas fa-clock text-xs prox-passo-atrasado ml-2" title="Próximo passo atrasado"></i>'
            : '';

        tr.innerHTML = `
            <td data-perm-col="col_pros_entidade" class="px-4 py-3 text-sm">
                <div class="flex items-center gap-2">
                    <span class="text-white font-medium">${empresa}</span>
                    <i class="info-icon" data-info></i>${arquivada}${alerta}
                </div>
            </td>
            <td data-perm-col="col_pros_origem" class="px-4 py-3 whitespace-nowrap text-sm" style="color: var(--color-violet)">${esc(p.origem || '—')}</td>
            <td data-perm-col="col_pros_etapa" class="px-4 py-3 whitespace-nowrap">
                <span class="badge-etapa badge-etapa--${slugEtapa(p.etapa)} px-3 py-1 rounded-full text-xs font-medium">${esc(p.etapa)}</span>
            </td>
            <td data-perm-col="col_pros_prob" class="px-4 py-3 whitespace-nowrap text-sm text-white/80">${Number(p.probabilidade ?? 0)}%</td>
            <td data-perm-col="col_pros_owner" class="px-4 py-3 whitespace-nowrap text-sm text-white">${esc(p.responsavel || '—')}</td>
            <td class="px-4 py-3 whitespace-nowrap text-left">
                <div class="flex items-center justify-start space-x-2">
                    <i data-perm="pros.details.view" class="fas fa-eye acao-ver w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Ver detalhes"></i>
                    <i data-perm="pros.stage.update" class="fas fa-arrow-right-arrow-left acao-mover w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-blue)" title="Mover no funil"></i>
                    <i data-perm="pros.edit" class="fas fa-edit acao-editar w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
                    <i data-perm="pros.delete" class="fas fa-trash acao-excluir w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-red)" title="Excluir"></i>
                </div>
            </td>`;

        // Cada ícone conhece a SUA prospecção pelo closure. O mockup anterior
        // lia o texto das células para remontar o registro e passava id fixo.
        tr.querySelector('.acao-ver')?.addEventListener('click', e => {
            e.stopPropagation();
            abrirDetalhesProspeccao(p);
        });
        const icone = tr.querySelector('[data-info]');
        if (icone) ligarIconeInfo(icone, p);

        tr.querySelector('.acao-mover')?.addEventListener('click', e => {
            e.stopPropagation();
            abrirMoverEtapa(p);
        });
        tr.querySelector('.acao-editar')?.addEventListener('click', e => {
            e.stopPropagation();
            abrirEditarProspeccao(p);
        });
        tr.querySelector('.acao-excluir')?.addEventListener('click', e => {
            e.stopPropagation();
            abrirExcluirProspeccao(p);
        });
        tr.addEventListener('click', () => abrirDetalhesProspeccao(p));

        tbody.appendChild(tr);
    });

    // Reaplica ações e colunas nas linhas recém-criadas: o aplicador roda uma
    // vez no carregamento da página e não conhece o que o JS desenhou depois.
    // (Mesma chamada que menu.js faz ao trocar de módulo.)
    window.Permissoes?.aplicarAcoesEColunas?.(tbody);
}

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

function openModalWithSpinner(htmlPath, scriptPath, overlayId) {
    // Registra como reabrir este modal, para restaurar o trabalho apos queda.
    window.__registrarModalAberto?.({ htmlPath, scriptPath, overlayId });
    Modal.closeAll();
    const spinner = document.createElement('div');
    spinner.id = 'modalLoading';
    spinner.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    spinner.style.zIndex = 'var(--z-dialog)';
    spinner.innerHTML = '<div class="app-loading-indicator app-loading-indicator--compact" aria-hidden="true"><span class="module-loading-orbit"></span><span class="module-loading-core"><img src="../assets/Logo.ico" alt=""></span></div>';
    document.body.appendChild(spinner);
    // Tempo mínimo de exibição do spinner: evita o "piscar" do modal e a
    // sensação de travamento. Não atrasa o carregamento dos dados — apenas
    // segura a revelação do modal caso ele fique pronto antes disso.
    const MIN_SPINNER_MS = 1000;
    const inicioSpinner = Date.now();
    function handleLoaded(e) {
        if (e.detail !== overlayId) return;
        const restante = Math.max(0, MIN_SPINNER_MS - (Date.now() - inicioSpinner));
        setTimeout(() => {
            const overlay = document.getElementById(`${overlayId}Overlay`);
            spinner.remove();
            overlay?.classList.remove('hidden');
        }, restante);
        window.removeEventListener('modalSpinnerLoaded', handleLoaded);
    }
    window.addEventListener('modalSpinnerLoaded', handleLoaded);
    Modal.open(htmlPath, scriptPath, overlayId, true);
}

function abrirExcluirProspeccao(prospeccao) {
    window.prospeccaoExcluir = prospeccao;
    Modal.open('modals/prospeccoes/excluir.html', '../js/modals/prospeccao-excluir.js', 'excluirProspeccao');
}

/**
 * Mover no funil direto da grade, sem passar pelo detalhe. É a ação mais
 * frequente do dia a dia comercial — obrigar a abrir a ficha para cada
 * movimentação transformaria a rotina em quatro cliques.
 */
function abrirMoverEtapa(prospeccao) {
    window.prospeccaoAcaoAlvo = prospeccao;
    // Sem contatos aqui: o modal de etapa não precisa deles.
    window.prospeccaoAcaoContatos = [];
    Modal.open('modals/prospeccoes/etapa.html', '../js/modals/prospeccao-etapa.js', 'etapaProspeccao');
}

function abrirDetalhesProspeccao(prospeccao) {
    // O modal recarrega a ficha completa de GET /api/prospeccoes/:id; este
    // resumo da grade serve para pintar o cabeçalho enquanto isso não chega.
    window.prospeccaoDetalhes = prospeccao;
    openModalWithSpinner(
        'modals/prospeccoes/detalhes.html',
        '../js/modals/prospeccao-detalhes.js',
        'detalhesProspeccao'
    );
}

function abrirEditarProspeccao(prospeccao) {
    window.prospeccaoEditar = prospeccao;
    openModalWithSpinner(
        'modals/prospeccoes/editar.html',
        '../js/modals/prospeccao-editar.js',
        'editarProspeccao'
    );
}

function abrirNovaProspeccao() {
    openModalWithSpinner(
        'modals/prospeccoes/novo.html',
        '../js/modals/prospeccao-novo.js',
        'novaProspeccao'
    );
}

// ---------------------------------------------------------------------------
// API pública do módulo
//
// menu.js injeta o script do módulo EMBRULHADO NUMA IIFE
// (`script.textContent = '(function(){...})()'`), então nada declarado aqui é
// global de verdade. Os modais rodam em <script> separados e não enxergam
// estas funções pelo nome — era exatamente por isso que "Editar" e "Excluir"
// no detalhe não faziam nada e a grade não recarregava depois de uma ação.
//
// `clientes.js` contorna o mesmo problema publicando `window.abrirEditarCliente`.
// Aqui o contrato fica num objeto só, para não espalhar globais soltas.
// ---------------------------------------------------------------------------
window.ProspeccoesModulo = {
    carregar: carregarProspeccoes,
    abrirNova: abrirNovaProspeccao,
    abrirDetalhes: abrirDetalhesProspeccao,
    abrirEditar: abrirEditarProspeccao,
    abrirExcluir: abrirExcluirProspeccao,
    abrirMoverEtapa
};

// Recarrega preservando os filtros quando algo muda em outro lugar.
// Os eventos continuam sendo a via de menor acoplamento e funcionam mesmo
// dentro da IIFE, porque `window` é o mesmo objeto.
['prospeccaoAdicionada', 'prospeccaoEditada', 'prospeccaoExcluida',
 'prospeccaoEtapaAlterada', 'prospeccaoAtualizada'].forEach(evento => {
    window.addEventListener(evento, () => carregarProspeccoes(true));
});

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

function initProspeccoes() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    const container = document.querySelector('.modulo-container');
    setupProspeccoesGeoFilters(container);

    document.getElementById('btnNovaProspeccao')?.addEventListener('click', abrirNovaProspeccao);
    document.getElementById('prospeccoesEmptyNew')?.addEventListener('click', abrirNovaProspeccao);

    document.getElementById('btnFiltrarProspeccoes')?.addEventListener('click', aplicarFiltros);
    document.getElementById('btnLimparProspeccoes')?.addEventListener('click', limparFiltros);
    document.getElementById('btnAtualizarProspeccoes')?.addEventListener('click', () => carregarProspeccoes(true));
    document.getElementById('prospeccoesTentarNovamente')?.addEventListener('click', () => carregarProspeccoes());

    // Busca reage enquanto digita; os selects, ao mudar. Ninguém deveria
    // precisar apertar "Filtrar" para ver o efeito.
    let debounce = null;
    document.getElementById('filtroBusca')?.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(aplicarFiltros, 200);
    });
    ['filtroEtapa', 'filtroOrigem', 'filtroResponsavel', 'filtroProximoPasso'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', aplicarFiltros);
    });
    ['filtroValorMin', 'filtroValorMax'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', aplicarFiltros);
    });

    // Incluir arquivadas muda o QUE o servidor manda, então recarrega.
    document.getElementById('filtroIncluirArquivadas')?.addEventListener('change', () => {
        carregarProspeccoes(true);
    });

    // ---------------------------------------------------------------------
    // Funil e filtros avançados: os dois nascem retraídos e crescem para baixo.
    // Enquanto ambos estão fechados o módulo cabe na tela e só a tabela rola —
    // é o comportamento dos outros módulos. Quando um deles abre, o conteúdo
    // passa da altura útil e aí sim a página precisa rolar.
    // ---------------------------------------------------------------------
    const btnFunil = document.getElementById('btnOcultarGraficoFunil');
    const btnAvancados = document.getElementById('btnFiltrosAvancados');
    const cardFunil = document.getElementById('prospeccoesFunilCard');
    const painelAvancados = document.getElementById('prospeccoesFiltrosAvancados');

    function ajustarRolagemDaPagina() {
        const content = document.getElementById('content');
        if (!content) return;
        const expandido = cardFunil?.dataset.ligado === '1'
            || painelAvancados?.classList.contains('aberto');
        // `no-scroll` é posto por menu.js ao entrar no módulo; tiramos enquanto
        // houver conteúdo expandido para a página poder rolar.
        content.classList.toggle('no-scroll', !expandido);
    }

    btnFunil?.addEventListener('click', () => {
        if (!cardFunil) return;
        const vaiMostrar = cardFunil.dataset.ligado !== '1';
        cardFunil.dataset.ligado = vaiMostrar ? '1' : '0';
        cardFunil.classList.toggle('hidden', !vaiMostrar);
        btnFunil.setAttribute('aria-expanded', String(vaiMostrar));
        ajustarRolagemDaPagina();
    });

    /**
     * Abre/fecha medindo o conteúdo na hora.
     *
     * Depois de abrir, o max-height vira `none`: preso ao valor medido, o
     * painel cortaria os campos se a janela encolhesse e eles quebrassem em
     * mais linhas.
     */
    function alternarAvancados(vaiAbrir) {
        if (!painelAvancados) return;
        painelAvancados.classList.toggle('aberto', vaiAbrir);
        painelAvancados.setAttribute('aria-hidden', String(!vaiAbrir));
        btnAvancados?.setAttribute('aria-expanded', String(vaiAbrir));

        if (vaiAbrir) {
            painelAvancados.style.maxHeight = `${painelAvancados.scrollHeight}px`;
            painelAvancados.addEventListener('transitionend', function solta(e) {
                if (e.propertyName !== 'max-height') return;
                painelAvancados.style.maxHeight = 'none';
                painelAvancados.removeEventListener('transitionend', solta);
            });
        } else {
            // De `none` direto para 0 não anima: é preciso partir de um valor
            // concreto. Fixamos a altura atual e forçamos o layout na hora —
            // com requestAnimationFrame o painel ficava ABERTO sempre que a
            // janela não estivesse compondo quadros (minimizada, em segundo
            // plano), porque o quadro seguinte nunca chegava.
            painelAvancados.style.maxHeight = `${painelAvancados.scrollHeight}px`;
            void painelAvancados.offsetHeight;
            painelAvancados.style.maxHeight = '0px';
        }
        ajustarRolagemDaPagina();
    }

    btnAvancados?.addEventListener('click', () => {
        alternarAvancados(!painelAvancados?.classList.contains('aberto'));
    });

    ajustarRolagemDaPagina();

    // Popover do resumo, no padrão do "Totais por Tipo" de Matéria-prima.
    const iconeResumo = document.getElementById('resumoInfoIcon');
    const popoverResumo = document.getElementById('resumoPopover');
    if (iconeResumo && popoverResumo) {
        const posicionar = () => {
            const r = iconeResumo.getBoundingClientRect();
            popoverResumo.style.left = `${window.scrollX + r.left}px`;
            popoverResumo.style.top = `${window.scrollY + r.bottom + 8}px`;
        };
        iconeResumo.addEventListener('mouseenter', () => {
            posicionar();
            popoverResumo.classList.add('show');
        });
        iconeResumo.addEventListener('mouseleave', () => {
            setTimeout(() => {
                if (!popoverResumo.matches(':hover')) popoverResumo.classList.remove('show');
            }, 100);
        });
        popoverResumo.addEventListener('mouseleave', () => popoverResumo.classList.remove('show'));
    }

    document.addEventListener('prospeccoes:geo-filter-change', evento => {
        const detalhe = evento.detail || {};
        const extrair = campo => {
            const bruto = detalhe[campo];
            if (!bruto) return [];
            if (Array.isArray(bruto)) return bruto.map(v => (typeof v === 'object' ? v.name || v.value : v));
            return String(bruto).split(',').map(v => v.trim()).filter(Boolean);
        };
        filtroGeo = { paises: extrair('countries') , estados: extrair('states') };
        aplicarFiltros();
    });

    carregarProspeccoes();
}

function loadProspeccoesScriptOnce(src) {
    const registry = window.__moduleScriptPromises = window.__moduleScriptPromises || new Map();
    if (registry.has(src)) {
        return registry.get(src);
    }

    const promise = new Promise((resolve, reject) => {
        const existing = Array.from(document.querySelectorAll('script')).find(script => {
            const current = script.getAttribute('src') || '';
            if (!current) return false;
            if (current === src) return true;
            return current.endsWith(src.replace('../', '')) || current.includes(src.replace('../', ''));
        });

        if (existing) {
            if (existing.dataset.loaded === 'true' || existing.readyState === 'complete') {
                resolve();
                return;
            }
            existing.addEventListener('load', () => {
                existing.dataset.loaded = 'true';
                resolve();
            }, { once: true });
            existing.addEventListener('error', reject, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = () => {
            script.remove();
            reject(new Error(`Falha ao carregar script: ${src}`));
        };
        document.head.appendChild(script);
    });

    promise.catch(() => registry.delete(src));
    registry.set(src, promise);
    return promise;
}

async function setupProspeccoesGeoFilters(root) {
    if (!root) return;
    try {
        if (!window.GeoMultiSelect?.initInContainer) {
            await loadProspeccoesScriptOnce('../js/utils/geo-multiselect.js');
        }
        if (window.GeoMultiSelect?.initInContainer) {
            window.GeoMultiSelect.initInContainer(root, {
                module: 'prospeccoes',
                onChange: detail => {
                    document.dispatchEvent(new CustomEvent('prospeccoes:geo-filter-change', {
                        detail
                    }));
                }
            });
        }
    } catch (error) {
        console.error('Falha ao carregar seleção geográfica em Prospecções', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProspeccoes);
} else {
    initProspeccoes();
}
