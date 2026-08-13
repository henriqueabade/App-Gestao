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

function formatarData(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR');
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
    // O funil não faz sentido enquanto carrega ou quando a busca falhou.
    if (funil && !funil.dataset.ocultoPeloUsuario) {
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
    // total deixaria todas as barras minúsculas e o gráfico ilegível.
    const maior = Math.max(1, ...funil.etapas.map(e => e.quantidade));

    container.innerHTML = funil.etapas.map(e => {
        const largura = Math.round((e.quantidade / maior) * 100);
        const slug = slugEtapa(e.etapa);
        return `
            <div>
                <div class="flex justify-between text-sm mb-1">
                    <span class="text-white">${esc(e.etapa)}</span>
                    <span class="flex items-center gap-3">
                        <span class="text-white/60">${formatarMoedaCompacta(e.valor)}</span>
                        <span style="color: var(--color-violet)">${e.quantidade}</span>
                    </span>
                </div>
                <div class="funil-trilho rounded-full h-2">
                    <div class="funil-barra funil-barra--${slug} h-2 rounded-full" style="width: ${largura}%"></div>
                </div>
            </div>`;
    }).join('');

    if (total) {
        total.textContent = `${funil.total} no total · ${funil.em_aberto} em aberto · ${funil.taxa_conversao}% de conversão`;
    }
}

function renderResumo(lista) {
    const container = document.getElementById('prospeccoesResumo');
    if (!container) return;

    const valorTotal = lista.reduce((s, p) => s + Number(p.valor_estimado ?? 0), 0);
    const ponderado = lista.reduce(
        (s, p) => s + Number(p.valor_estimado ?? 0) * (Number(p.probabilidade ?? 0) / 100), 0
    );
    const hoje = hojeZerado();
    const atrasadas = lista.filter(p => {
        const d = diaDe(p.proximo_passo_data);
        return d && d < hoje;
    }).length;

    const linha = (rotulo, valor, classe = 'text-white') =>
        `<div class="flex justify-between gap-2">
            <span class="text-white/60">${rotulo}</span>
            <span class="${classe} font-medium">${valor}</span>
        </div>`;

    container.innerHTML = [
        linha('Exibindo', String(lista.length)),
        linha('Valor total', formatarMoeda(valorTotal)),
        // Valor ponderado pela probabilidade: é a previsão realista, não o
        // sonho da soma bruta.
        linha('Previsão ponderada', formatarMoeda(ponderado)),
        atrasadas
            ? linha('Passos atrasados', String(atrasadas), 'prox-passo-atrasado')
            : ''
    ].join('');
}

function celulaProximoPasso(p) {
    if (!p.proximo_passo_data) {
        return `<span class="text-white/40">—</span>`;
    }
    const data = diaDe(p.proximo_passo_data);
    const hoje = hojeZerado();
    let classe = 'text-white/80';
    let titulo = '';
    if (data && data < hoje) {
        classe = 'prox-passo-atrasado';
        titulo = 'Próximo passo atrasado';
    } else if (data && data.getTime() === hoje.getTime()) {
        classe = 'prox-passo-hoje';
        titulo = 'Próximo passo é hoje';
    }
    return `<span class="${classe}" title="${esc(titulo)}">${formatarData(p.proximo_passo_data)}</span>`;
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
        const contato = p.contato_principal;
        const subtitulo = contato?.nome
            ? `${esc(contato.nome)}${contato.email ? ' · ' + esc(contato.email) : ''}`
            : esc(p.cnpj || '');
        const arquivada = p.status === 'arquivada'
            ? '<i class="fas fa-box-archive text-xs text-white/40 ml-2" title="Arquivada"></i>'
            : '';

        tr.innerHTML = `
            <td data-perm-col="col_pros_id" class="px-4 py-3 whitespace-nowrap text-sm text-white/60">#${esc(p.id)}</td>
            <td data-perm-col="col_pros_entidade" class="px-4 py-3 text-sm">
                <div class="text-white font-medium">${empresa}${arquivada}</div>
                ${subtitulo ? `<div class="text-xs text-white/50">${subtitulo}</div>` : ''}
            </td>
            <td data-perm-col="col_pros_origem" class="px-4 py-3 whitespace-nowrap text-sm" style="color: var(--color-violet)">${esc(p.origem || '—')}</td>
            <td data-perm-col="col_pros_etapa" class="px-4 py-3 whitespace-nowrap">
                <span class="badge-etapa badge-etapa--${slugEtapa(p.etapa)} px-3 py-1 rounded-full text-xs font-medium">${esc(p.etapa)}</span>
            </td>
            <td data-perm-col="col_pros_valor" class="px-4 py-3 whitespace-nowrap text-sm text-white">${formatarMoeda(p.valor_estimado)}</td>
            <td data-perm-col="col_pros_prob" class="px-4 py-3 whitespace-nowrap text-sm text-white/80">${Number(p.probabilidade ?? 0)}%</td>
            <td data-perm-col="col_pros_owner" class="px-4 py-3 whitespace-nowrap text-sm text-white">${esc(p.responsavel || '—')}</td>
            <td data-perm-col="col_pros_proximo_passo" class="px-4 py-3 text-sm text-white/80">${esc(p.proximo_passo || '—')}</td>
            <td data-perm-col="col_pros_proximo_passo_data" class="px-4 py-3 whitespace-nowrap text-sm">${celulaProximoPasso(p)}</td>
            <td data-perm-col="col_pros_atualizado_em" class="px-4 py-3 whitespace-nowrap text-sm text-white/60">${formatarDataHora(p.atualizado_em)}</td>
            <td class="px-4 py-3 whitespace-nowrap text-left">
                <div class="flex items-center justify-start space-x-2">
                    <i data-perm="pros.details.view" class="fas fa-eye acao-ver w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Ver detalhes"></i>
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

function abrirDetalhesProspeccao(prospeccao) {
    window.prospeccaoDetalhes = prospeccao;

    // Ponte temporária para o modal de detalhes, que ainda é o mockup e lê
    // `window.prospectDetails`. Sem ela o modal cairia no exemplo embutido
    // ("Jennifer Wilson"/"Acme Corporation") e mostraria dados falsos por cima
    // de um registro real. O modal é reconstruído na etapa 5; até lá, ao menos
    // o cabeçalho mostra a empresa certa.
    const contato = prospeccao.contato_principal || {};
    const nomeExibido = contato.nome || prospeccao.nome_fantasia || '';
    window.prospectDetails = {
        initials: nomeExibido.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase(),
        name: nomeExibido,
        company: prospeccao.nome_fantasia || prospeccao.razao_social || '',
        ownerName: prospeccao.responsavel || '',
        email: contato.email || '',
        phone: '',
        cell: contato.telefone_celular || '',
        status: prospeccao.etapa || ''
    };

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

// Recarrega preservando os filtros quando algo muda em outro lugar.
window.addEventListener('prospeccaoAdicionada', () => carregarProspeccoes(true));
window.addEventListener('prospeccaoEditada', () => carregarProspeccoes(true));
window.addEventListener('prospeccaoExcluida', () => carregarProspeccoes(true));
window.addEventListener('prospeccaoEtapaAlterada', () => carregarProspeccoes(true));

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

    const btnFunil = document.getElementById('btnOcultarGraficoFunil');
    btnFunil?.addEventListener('click', () => {
        const card = document.getElementById('prospeccoesFunilCard');
        if (!card) return;
        const vaiOcultar = !card.classList.contains('hidden');
        card.classList.toggle('hidden', vaiOcultar);
        // Marca a escolha para que mostrarEstado() não reexiba o funil sozinho.
        if (vaiOcultar) card.dataset.ocultoPeloUsuario = '1';
        else delete card.dataset.ocultoPeloUsuario;
        btnFunil.innerHTML = vaiOcultar
            ? '<i class="fas fa-chart-simple mr-2"></i>Mostrar Funil'
            : '<i class="fas fa-chart-simple mr-2"></i>Ocultar Funil';
    });

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
