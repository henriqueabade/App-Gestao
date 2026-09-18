/**
 * Módulo Financeiro — Comissões e Produção.
 *
 * A parte fiscal é REAL: GET /api/fiscal/painel (competência escolhida) traz
 * os pedidos enviados sem NF-e, as pendências que exigem ação (nota parada
 * na SEFAZ, recusada, certificado, configuração) e a atividade recente; as
 * ações "Emitir NF-e" e "Notas fiscais" abrem modais que falam com a SEFAZ
 * pelo que já existe em /api/fiscal. As contas a receber também são REAIS:
 * GET /api/cobranca/recebimentos/painel traz recebido, a receber, em atraso,
 * boletos em aberto e as pendências de cobrança (que entram na mesma lista
 * das fiscais); "Registrar recebimento", os cartões e "Conciliar com o BB"
 * falam com /api/cobranca. Comissões e produção também são REAIS:
 * GET /api/financeiro/painel traz os cartões (comissões a pagar, atrasadas,
 * produção a pagar), os resumos, as pendências do módulo (regras, fechar,
 * pagar, produção sem valor) e a atividade recente, que se junta à fiscal.
 * Ação sem função real abre o aviso "em implementação" — melhor que um
 * botão que não responde, que parece defeito. Tudo é preenchido por
 * `data-fin`: trocar a fonte não mexe no HTML.
 *
 * O menu reexecuta este arquivo a cada visita (src/js/menu.js injeta o script
 * de novo, embrulhado numa IIFE), então nada aqui registra ouvinte em
 * `document`/`window`: os ouvintes ficam no elemento do módulo, que é trocado
 * a cada navegação, e a inicialização é guardada por `dataset.iniciado`.
 */

const FIN_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/* Quantas pendências a lista mostra antes do "Ver todas". */
const FIN_PENDENCIAS_VISIVEIS = 5;

/* Quantos movimentos a "Atividade recente" mostra (fiscais e do módulo juntos). */
const FIN_ATIVIDADE_VISIVEL = 8;

/* Rótulo humano de cada ação, para o aviso "em implementação". Quando a ação
   ganhar modal/função real, basta preencher `abrir`. `extra` é o que a linha
   clicada traz (o filtro de uma pendência, por exemplo). */
const FIN_ACOES = {
    'atualizar': { rotulo: 'Atualizar', abrir: m => finRecarregar(m) },
    'aguardando-nf': { rotulo: 'Pedidos aguardando NF-e', abrir: (m, extra) => finAbrirModal('aguardando-nfe', m, extra) },
    'emitir-nfe': { rotulo: 'Emitir NF-e', abrir: (m, extra) => finAbrirModal('aguardando-nfe', m, extra) },
    'notas-fiscais': { rotulo: 'Notas fiscais', abrir: (m, extra) => finAbrirModal('notas-fiscais', m, extra) },
    'comissoes-competencia': { rotulo: 'Comissões da competência', abrir: m => finAbrirModal('visualizar-relatorio', m, { relatorio: 'comissoes-apuradas' }) },
    'comissoes-atrasadas': { rotulo: 'Comissões atrasadas', abrir: m => finAbrirModal('comissoes-atrasadas', m) },
    'producao-competencia': { rotulo: 'Produção da competência', abrir: m => finAbrirModal('producao-competencia', m) },
    'confirmar-pagamento-comissao': { rotulo: 'Confirmar pagamento', abrir: m => finAbrirModal('confirmar-pagamento', m, { tipo: 'comissao' }) },
    'confirmar-pagamento-producao': { rotulo: 'Confirmar pagamento', abrir: m => finAbrirModal('confirmar-pagamento', m, { tipo: 'producao' }) },
    // Pendência "Pagamento de … de agosto": já com o tipo e a competência.
    'confirmar-pagamento': { rotulo: 'Confirmar pagamento', abrir: (m, extra) => finAbrirModal('confirmar-pagamento', m, finDoFiltro(extra)) },
    'regras': { rotulo: 'Regras de comissão e produção', abrir: m => finAbrirModal('regras', m) },
    // Devolução de pedido: o reembolso que ficou a pagar, e a devolução que não terminou (estoque, BB).
    'confirmar-reembolso': { rotulo: 'Confirmar reembolso', abrir: (m, extra) => finAbrirModal('confirmar-reembolso', m, { reembolso_id: extra?.filtro?.reembolso_id ?? null }) },
    'reaplicar-devolucao': { rotulo: 'Tentar de novo', abrir: (m, extra) => finReaplicarDevolucao(m, extra?.filtro?.devolucao_id) },
    'configuracao-fiscal': { rotulo: 'Configuração fiscal', abrir: m => finAbrirModal('configuracao-fiscal', m) },
    'configuracao-cobranca': { rotulo: 'Configuração de cobrança', abrir: m => finAbrirModal('configuracao-cobranca', m) },
    'pendencias-todas': { rotulo: 'Todas as pendências', abrir: m => finMostrarTodasPendencias(m) },
    'registrar-recebimento': { rotulo: 'Registrar recebimento', abrir: m => finAbrirModal('registrar-recebimento', m) },
    'registrar-ajuste': { rotulo: 'Registrar ajuste', abrir: m => finAbrirModal('registrar-ajuste', m) },
    'registrar-producao': { rotulo: 'Registrar produção', abrir: m => finAbrirModal('registrar-producao', m) },
    // Fechar virou dois: comissões (o modal de sempre) e produção (a tela dos cards
    // por pedido, onde se confirma peça a peça). A pendência do painel já traz o tipo.
    'fechar-competencia': { rotulo: 'Fechar competência — comissões',
        abrir: (m, extra) => {
            const filtro = finDoFiltro(extra);
            return filtro.tipo === 'producao'
                ? finAbrirModal('fechar-producao', m, filtro)
                : finAbrirModal('fechar-competencia', m, filtro);
        }
    },
    'fechar-competencia-producao': { rotulo: 'Fechar competência — produção', abrir: (m, extra) => finAbrirModal('fechar-producao', m, finDoFiltro(extra)) },
    'relatorios': { rotulo: 'Relatórios', abrir: m => finAbrirModal('relatorios', m) },
    'comissoes-detalhes': { rotulo: 'Detalhes das comissões', abrir: m => finAbrirModal('visualizar-relatorio', m, { relatorio: 'previsao-comissoes' }) },
    // "Ver todas" abre o histórico inteiro num modal (quem fez, quando, o quê), em vez de esticar o card.
    'atividade-todas': { rotulo: 'Atividade recente', abrir: m => finAbrirModal('atividade', m) },
    // Contas a receber: os cartões e as pendências de cobrança abrem a lista na visão certa.
    'recebimentos-recebidos': { rotulo: 'Recebimentos', abrir: m => finAbrirModal('recebimentos', m, { visao: 'recebidos' }) },
    'recebimentos-a-receber': { rotulo: 'Recebimentos', abrir: m => finAbrirModal('recebimentos', m, { visao: 'a_receber' }) },
    'recebimentos-atraso': { rotulo: 'Recebimentos', abrir: m => finAbrirModal('recebimentos', m, { visao: 'em_atraso' }) },
    'recebimentos-boletos': { rotulo: 'Recebimentos', abrir: m => finAbrirModal('recebimentos', m, { visao: 'abertas', filtro: { boleto: 'aberto' } }) },
    'conciliar': { rotulo: 'Conciliar com o BB', abrir: m => finConciliar(m) }
};

/* Modais do módulo (src/html/modals/financeiro). Todos usam o mesmo script,
   que descobre qual modal montar por `window.financeiroModalContexto`. */
const FIN_MODAIS = {
    'aguardando-nfe': { html: 'modals/financeiro/aguardando-nfe.html', overlay: 'finAguardandoNfe' },
    'notas-fiscais': { html: 'modals/financeiro/notas-fiscais.html', overlay: 'finNotasFiscais' },
    'registrar-recebimento': { html: 'modals/financeiro/registrar-recebimento.html', overlay: 'finRegistrarRecebimento' },
    'registrar-ajuste': { html: 'modals/financeiro/registrar-ajuste.html', overlay: 'finRegistrarAjuste' },
    'registrar-producao': { html: 'modals/financeiro/registrar-producao.html', overlay: 'finRegistrarProducao' },
    'fechar-competencia': { html: 'modals/financeiro/fechar-competencia.html', overlay: 'finFecharCompetencia' },
    'fechar-producao': { html: 'modals/financeiro/fechar-producao.html', overlay: 'finFecharProducao' },
    'relatorios': { html: 'modals/financeiro/relatorios.html', overlay: 'finRelatorios' },
    'detalhes-parcela': { html: 'modals/financeiro/detalhes-parcela.html', overlay: 'finDetalhesParcela' },
    'detalhes-pedido': { html: 'modals/financeiro/detalhes-pedido.html', overlay: 'finDetalhesPedido' },
    'confirmar-pagamento': { html: 'modals/financeiro/confirmar-pagamento.html', overlay: 'finConfirmarPagamento' },
    'visualizar-relatorio': { html: 'modals/financeiro/visualizar-relatorio.html', overlay: 'finVisualizarRelatorio' },
    'comissoes-atrasadas': { html: 'modals/financeiro/comissoes-atrasadas.html', overlay: 'finComissoesAtrasadas' },
    'atividade': { html: 'modals/financeiro/atividade.html', overlay: 'finAtividade' },
    'producao-competencia': { html: 'modals/financeiro/producao-competencia.html', overlay: 'finProducaoCompetencia' },
    'configuracao-fiscal': { html: 'modals/financeiro/configuracao-fiscal.html', overlay: 'finConfiguracaoFiscal' },
    'configuracao-cobranca': { html: 'modals/financeiro/configuracao-cobranca.html', overlay: 'finConfiguracaoCobranca' },
    'recebimentos': { html: 'modals/financeiro/recebimentos.html', overlay: 'finRecebimentos' },
    'regras': { html: 'modals/financeiro/regras.html', overlay: 'finRegras' },
    'confirmar-reembolso': { html: 'modals/financeiro/confirmar-reembolso.html', overlay: 'finConfirmarReembolso' }
};

/** O tipo e a competência que uma pendência leva (fechar, pagar). */
function finDoFiltro(extra) {
    const f = extra?.filtro || {};
    const saida = {};
    if (f.tipo === 'comissao' || f.tipo === 'producao') saida.tipo = f.tipo;
    if (/^\d{4}-\d{2}$/.test(String(f.competencia || ''))) saida.competencia = f.competencia;
    return saida;
}
const FIN_SCRIPT_MODAIS = '../js/modals/financeiro-modais.js';

/**
 * Abre um modal do módulo. `extra` leva o que o modal precisa (relatório,
 * tipo, pedido, parcela, filtro) e `extra.empilhar` abre POR CIMA do modal
 * atual — é como um modal abre outro (detalhes, relatório, fechamento).
 */
function finAbrirModal(chave, moduleEl, extra = {}) {
    const modal = FIN_MODAIS[chave];
    if (!modal || typeof window.Modal?.open !== 'function') {
        finAvisarEmImplementacao(chave);
        return;
    }
    const raiz = moduleEl || document.querySelector('.modulo-container.financeiro-module');
    window.financeiroModalContexto = {
        ...extra,
        overlayId: modal.overlay,
        acao: chave,
        rotulo: FIN_ACOES[chave]?.rotulo || '',
        competencia: extra.competencia || raiz?.querySelector('#finCompetencia')?.value || null
    };
    // O spinner da casa (o mesmo dos outros módulos) fica na tela até o
    // modal terminar a primeira leitura: sem ele, o modal abria vazio e
    // parecia travado enquanto o servidor respondia.
    finSpinnerDoModal(modal.overlay);
    window.Modal.open(modal.html, FIN_SCRIPT_MODAIS, modal.overlay, extra.empilhar === true);
}

/* Tempo mínimo do spinner, como em openModalWithSpinner dos outros módulos:
   evita o "piscar" quando o modal fica pronto rápido demais. */
const FIN_SPINNER_MINIMO_MS = 1000;
/* E o máximo: se a leitura não voltar, o modal aparece mesmo assim (com o
   aviso de erro dele), em vez de o spinner ficar para sempre. */
const FIN_SPINNER_MAXIMO_MS = 15000;
const finSpinners = new Map();

function finSpinnerDoModal(overlayId) {
    finSpinners.get(overlayId)?.remover();
    const spinner = document.createElement('div');
    spinner.id = 'modalLoading';
    spinner.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    spinner.style.zIndex = 'var(--z-dialog)';
    const indicador = document.createElement('div');
    indicador.className = 'app-loading-indicator app-loading-indicator--compact';
    indicador.setAttribute('aria-hidden', 'true');
    const orbita = document.createElement('span');
    orbita.className = 'module-loading-orbit';
    const nucleo = document.createElement('span');
    nucleo.className = 'module-loading-core';
    const logo = document.createElement('img');
    logo.src = '../assets/Logo.ico';
    logo.alt = '';
    nucleo.appendChild(logo);
    indicador.append(orbita, nucleo);
    spinner.appendChild(indicador);
    document.body?.appendChild(spinner);

    const inicio = Date.now();
    let limite = null;
    let vigia = null;
    const registro = {
        inicio,
        remover() {
            clearTimeout(limite);
            clearInterval(vigia);
            spinner.remove?.();
            if (finSpinners.get(overlayId) === registro) finSpinners.delete(overlayId);
        }
    };
    limite = setTimeout(() => registro.remover(), FIN_SPINNER_MAXIMO_MS);
    // Fechado antes de ficar pronto (troca de módulo, Esc): o spinner vai junto.
    // Uma vigia e não um ouvinte em `window` — este script é reexecutado a
    // cada visita e não pode deixar ouvinte pendurado.
    let viuOModal = false;
    vigia = setInterval(() => {
        const existe = document.getElementById?.(`${overlayId}Overlay`);
        if (existe) viuOModal = true;
        else if (viuOModal) registro.remover();
    }, 400);
    finSpinners.set(overlayId, registro);
}

/**
 * O modal avisa que terminou a primeira leitura; `revelar` é quem o mostra.
 * Com spinner na tela, espera o tempo mínimo e troca um pelo outro.
 */
window.FinanceiroModalPronto = (overlayId, revelar) => {
    const registro = finSpinners.get(overlayId);
    if (!registro) { revelar(); return; }
    const resta = Math.max(0, FIN_SPINNER_MINIMO_MS - (Date.now() - registro.inicio));
    setTimeout(() => {
        registro.remover();
        revelar();
    }, resta);
};
// Os modais abrem uns aos outros por aqui (financeiro-modais.js não enxerga FIN_MODAIS).
window.FinanceiroAbrirModal = finAbrirModal;

const finFormatoMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function finFormatarMoeda(valor) {
    // Ausente é "—", não "R$ 0,00": zero de verdade e valor que não veio são
    // coisas diferentes para quem confere comissão.
    if (valor === null || valor === undefined || valor === '') return '—';
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return '—';
    // "- R$ 840,00" como na descrição: o sinal antes do símbolo, e não colado ao número.
    return numero < 0 ? `- ${finFormatoMoeda.format(Math.abs(numero))}` : finFormatoMoeda.format(numero);
}

function finFormatarInteiro(valor) {
    if (valor === null || valor === undefined || valor === '') return '—';
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero.toLocaleString('pt-BR') : '—';
}

/** 'YYYY-MM-DD' -> 'dd/mm/aaaa', cortando o texto: passar por new Date volta um dia em São Paulo. */
function finFormatarData(texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (texto || '—');
}

/**
 * Quando um evento aconteceu, para a atividade recente: 'HH:MM' se foi no
 * dia `hoje` ('YYYY-MM-DD'), senão 'dd/mm'. Corte de texto, sem fuso — o
 * instante vem da SEFAZ já em horário de Brasília ('…T15:10:01-03:00').
 */
function finFormatarQuando(instante, hoje) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(instante || ''));
    if (!m) return '—';
    if (`${m[1]}-${m[2]}-${m[3]}` === hoje && m[4]) return `${m[4]}:${m[5]}`;
    return `${m[3]}/${m[2]}`;
}

function finRotuloCompetencia(ano, mes) {
    return `${FIN_MESES[mes - 1]} / ${ano}`;
}

/**
 * O seletor de competência: mês (nomes), ano (2025–2100, também digitável) e a
 * lupa que entra no mês (src/js/utils/competencia.js). Escolher não recarrega
 * nada — só a lupa (ou Enter no ano) muda o valor e dispara o `change`.
 */
function finMontarCompetencias(campo, hoje) {
    if (!campo) return;
    const inicial = finCompetenciaAtual(hoje);
    if (window.Competencia) {
        window.Competencia.montar(campo, { valor: inicial });
        return;
    }
    // Sem o utilitário (HTML antigo ou carregamento parcial): o valor ainda vale.
    campo.value = inicial;
}

/**
 * O "de quanto" do cartão: "/ R$ 5.400,00". O valor grande é o que FALTA
 * pagar, então sem o total o número parecia mudar sozinho depois do pagamento.
 * Fica vazio enquanto não há competência (nada a comparar).
 */
function finTotalDoCartao(x) {
    const total = Number(x?.total);
    if (!Number.isFinite(total)) return '';
    return `/ ${finFormatarMoeda(total)}`;
}

function finCompetenciaAtual(hoje) {
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

function finDiaDe(hoje) {
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
}

function finAvisarEmImplementacao(chave) {
    const rotulo = FIN_ACOES[chave]?.rotulo || 'Esta função';
    const mensagem = `"${rotulo}" ainda está em implementação.\nEm breve estará disponível nesta tela.`;
    if (window.DialogPadrao?.info) {
        window.DialogPadrao.info({ title: 'Função em implementação', tom: 'aviso', icone: 'fa-person-digging', message: `"${rotulo}" ainda está em implementação.`, nota: 'Em breve estará disponível nesta tela.' });
    } else {
        window.alert(mensagem);
    }
}

function finExecutarAcao(chave, moduleEl, extra = {}) {
    const acao = FIN_ACOES[chave];
    if (acao && typeof acao.abrir === 'function') {
        acao.abrir(moduleEl, extra);
        return;
    }
    finAvisarEmImplementacao(chave);
}

/* ------------------------------------------------------------- painel */

/**
 * O que a tela mostra de fiscal, a partir do painel do backend (ou da sua
 * ausência: sem permissão, sem rede). Pura — recebe o painel e devolve as
 * três partes no formato que o render usa.
 */
function finMapearPainel(painel, erro) {
    if (!painel) {
        const motivo = erro?.status === 403 ? 'Sem permissão para ver as notas fiscais.'
            : (erro ? 'Não foi possível carregar as notas fiscais.' : '');
        return {
            nf: { quantidade: null, total: null, rodape: motivo || 'Sem dados fiscais.' },
            pendencias: erro && erro.status !== 403
                ? [{ nivel: 'critico', titulo: 'Painel fiscal indisponível', descricao: erro.message || motivo, data: null, acao: 'Tentar de novo', destino: 'atualizar' }]
                : [],
            atividade: [],
            ambiente: null
        };
    }
    const a = painel.aguardando_nf || {};
    const desde = finFormatarData(painel.desde);
    return {
        nf: {
            quantidade: Number(a.quantidade) || 0,
            total: Number(a.total) || 0,
            rodape: `Total: ${finFormatarMoeda(Number(a.total) || 0)} · enviados desde ${desde}${a.dispensados ? ` · ${a.dispensados} sem NF-e (S/NF)` : ''}`
        },
        pendencias: (painel.pendencias || []).map(p => ({
            nivel: p.nivel === 'critico' ? 'critico' : 'normal',
            titulo: p.titulo, descricao: p.descricao, data: p.data, acao: p.acao || 'Ver', destino: p.destino, filtro: p.filtro || null
        })),
        atividade: (painel.atividade || []).map(e => ({ quando: e.quando, titulo: e.titulo, detalhe: e.detalhe, notaId: e.nota_id })),
        ambiente: painel.ambiente || null
    };
}

/** Uma chamada ao backend: `{ corpo, erro }`, sem lançar (sem apiConfig/fetch, os dois vêm nulos). */
async function finChamarApi(caminho, opcoes) {
    if (typeof window.apiConfig?.getApiBaseUrl !== 'function' || typeof fetch !== 'function') {
        return { corpo: null, erro: null };
    }
    try {
        const base = await window.apiConfig.getApiBaseUrl();
        const resposta = await fetch(`${base}${caminho}`, opcoes);
        const corpo = await resposta.json().catch(() => null);
        if (!resposta.ok) {
            const e = new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
            e.status = resposta.status;
            // O que veio além da mensagem (sql_pendente, bloqueios).
            e.corpo = corpo;
            return { corpo: null, erro: e };
        }
        return { corpo, erro: null };
    } catch (e) {
        return { corpo: null, erro: e };
    }
}

async function finBuscarPainel(competencia) {
    const { corpo, erro } = await finChamarApi(`/api/fiscal/painel?competencia=${encodeURIComponent(competencia || '')}`);
    return { painel: corpo, erro };
}

const finPlural = (n, um, varios) => `${finFormatarInteiro(n)} ${Number(n) === 1 ? um : varios}`;
/** Dinheiro sem sobra de ponto flutuante (as contas da tela são em reais). */
const finCentavos = v => Math.round((Number(v) || 0) * 100) / 100;

/**
 * As contas a receber da tela, a partir do painel de recebimentos (ou da
 * sua ausência). Pura — recebe o painel e devolve os quatro cartões, a nota
 * da faixa, as pendências de cobrança e quantos avisos do BB estão na fila.
 */
function finMapearReceber(painel, erro) {
    if (!painel) {
        const semPermissao = erro?.status === 403;
        const motivo = semPermissao ? 'Sem permissão para ver os recebimentos.'
            : (erro ? 'Não foi possível carregar os recebimentos.' : 'Sem dados de recebimentos.');
        const vazio = { valor: null, auxiliar: '', rodape: motivo };
        return {
            nota: motivo,
            recebido: vazio, aReceber: vazio, atraso: vazio, boletos: vazio,
            pendencias: erro && !semPermissao
                ? [{ nivel: 'critico', titulo: 'Painel de recebimentos indisponível', descricao: erro.message || motivo, data: null, acao: 'Tentar de novo', destino: 'atualizar' }]
                : [],
            fila: 0
        };
    }
    const r = painel.recebido || {};
    const a = painel.a_receber || {};
    const at = painel.em_atraso || {};
    const b = painel.boletos_abertos || {};
    const c = painel.a_conciliar || {};
    const extras = [];
    if (Number(r.encargos) > 0) extras.push(`juros e multa ${finFormatarMoeda(r.encargos)}`);
    if (Number(r.estornados) > 0) extras.push(finPlural(r.estornados, 'estornado', 'estornados'));
    const controle = painel.sql_pendente
        ? 'Falta ativar: rode sql/cobranca_recebimentos.sql e reinicie a API.'
        : (painel.desde ? `Parcelas controladas a partir de ${finFormatarData(painel.desde)}` : 'Todas as parcelas dos pedidos faturados');
    const ultima = painel.ultima_conciliacao;
    return {
        nota: ultima?.quando ? `${controle} · última conciliação com o BB: ${ultima.quando}${ultima.como ? ` (${ultima.como})` : ''}` : controle,
        recebido: {
            valor: Number(r.total) || 0,
            auxiliar: finPlural(Number(r.quantidade) || 0, 'recebimento', 'recebimentos'),
            rodape: extras.length ? `Inclui ${extras.join(' · ')}` : 'Boletos pagos e recebimentos à mão'
        },
        aReceber: {
            valor: Number(a.total) || 0,
            auxiliar: finPlural(Number(a.quantidade) || 0, 'parcela', 'parcelas'),
            rodape: 'Vencem nesta competência'
        },
        atraso: {
            valor: Number(at.total) || 0,
            auxiliar: finPlural(Number(at.quantidade) || 0, 'parcela', 'parcelas'),
            rodape: Number(at.quantidade) ? `Mais antiga venceu em ${finFormatarData(at.mais_antigo)} (${finPlural(Number(at.dias_max) || 0, 'dia', 'dias')})` : 'Nenhuma parcela vencida'
        },
        boletos: {
            valor: Number(b.total) || 0,
            auxiliar: finPlural(Number(b.quantidade) || 0, 'boleto', 'boletos'),
            rodape: Number(c.fila) ? `${finPlural(Number(c.fila), 'aviso', 'avisos')} de pagamento do BB para conciliar` : 'Registrados no BB, aguardando pagamento'
        },
        pendencias: (painel.pendencias || []).map(p => ({
            nivel: p.nivel === 'critico' ? 'critico' : 'normal',
            titulo: p.titulo, descricao: p.descricao, data: p.data, acao: p.acao || 'Ver', destino: p.destino, filtro: p.filtro || null
        })),
        fila: Number(c.fila) || 0
    };
}

/** Críticas primeiro; dentro de cada nível, a ordem de cada painel (fiscal antes de cobrança). */
function finJuntarPendencias(...listas) {
    const todas = listas.flat().filter(Boolean);
    return [...todas.filter(p => p.nivel === 'critico'), ...todas.filter(p => p.nivel !== 'critico')];
}

const FIN_SITUACAO = { aberta: 'em aberto', fechada: 'fechada', paga: 'paga', parcial: 'paga em parte' };

/**
 * Comissões e produção da tela, a partir do painel da fase G (ou da sua
 * ausência: sem permissão, sem o SQL, sem rede). Pura.
 */
function finMapearComissoes(painel, erro) {
    if (!painel) {
        const sqlPendente = Boolean(erro?.corpo?.sql_pendente);
        // O backend diz qual SQL falta (o da fase G ou o dos processos/desenhistas).
        const motivo = erro?.status === 403 ? 'Sem permissão para ver comissões e produção.'
            : sqlPendente ? (/\.sql\b/.test(String(erro?.message || '')) ? erro.message : 'Falta ativar: rode sql/financeiro_comissoes_producao.sql e reinicie a API.')
                : (erro ? 'Não foi possível carregar comissões e produção.' : 'Sem dados de comissões e produção.');
        const vazio = { valor: null, auxiliar: '', rodape: motivo };
        return {
            kpis: { comissoes: vazio, atrasadas: vazio, producao: vazio },
            resumoComissoes: { previstas: null, apuradas: null, atrasadas: null, ajustes: null, ajustesQuantidade: 0, ajustesBase: 0, proximoPagamento: '—', beneficiarios: [], previstos: [], pago: 0, faltaPagar: null },
            resumoProducao: { emProducao: null, parciais: null, pecasMes: null, valorCompetencia: null, proximoPagamento: '—' },
            pendencias: sqlPendente
                ? [{ nivel: 'critico', titulo: 'Comissões e produção ainda não ativadas', descricao: motivo, data: null, acao: 'Tentar de novo', destino: 'atualizar' }]
                : (erro && erro.status !== 403
                    ? [{ nivel: 'critico', titulo: 'Painel de comissões indisponível', descricao: erro.message || motivo, data: null, acao: 'Tentar de novo', destino: 'atualizar' }]
                    : []),
            atividade: []
        };
    }
    const c = painel.comissoes || {};
    const a = painel.atrasadas || {};
    const p = painel.producao || {};
    const rc = painel.resumo_comissoes || {};
    const rp = painel.resumo_producao || {};
    const diaUtil = `${Number(p.dia_util || rp.dia_util) || 5}º dia útil`;
    const rodapeDe = (x, sufixo = '') => {
        if (x.situacao === 'paga') return `Paga em ${finFormatarData(x.pago_em)}`;
        const abertura = x.situacao === 'parcial'
            ? `Paga em parte (${finFormatarMoeda(Number(x.pago) || 0)}) · pagar`
            : (x.situacao === 'fechada' ? 'Fechada · pagar' : 'Pagamento');
        return `${abertura} até ${finFormatarData(x.pagar_ate)}${sufixo}`;
    };
    return {
        kpis: {
            // `valor` é o que FALTA pagar e `total` é a competência inteira:
            // nada pago mostra "x / x", pago pela metade "y / x" e pago tudo "0 / x".
            comissoes: {
                valor: Number(c.valor) || 0, total: finTotalDoCartao(c),
                auxiliar: finPlural(Number(c.parcelas) || 0, 'parcela', 'parcelas'), rodape: rodapeDe(c)
            },
            atrasadas: {
                valor: Number(a.valor) || 0, auxiliar: finPlural(Number(a.parcelas) || 0, 'parcela', 'parcelas'),
                rodape: painel.tem_regras === false ? 'Sem regras de CMS/Royalty cadastradas' : 'Aguardando recebimento'
            },
            producao: {
                valor: Number(p.valor) || 0, total: finTotalDoCartao(p),
                auxiliar: `${finPlural(Number(p.pecas) || 0, 'peça finalizada', 'peças finalizadas')}`, rodape: rodapeDe(p, ` (${diaUtil})`)
            }
        },
        resumoComissoes: {
            previstas: Number(rc.previstas) || 0, apuradas: Number(rc.apuradas) || 0, atrasadas: Number(rc.atrasadas) || 0,
            // O efeito TOTAL dos ajustes no mês: o estorno do que já estava
            // fechado (rc.ajustes) mais a comissão que os ajustes à mão
            // tiraram das parcelas apuradas agora.
            ajustes: finCentavos((Number(rc.ajustes) || 0) - (Number(rc.ajustes_manuais?.comissao) || 0)),
            ajustesQuantidade: Number(rc.ajustes_manuais?.quantidade) || 0,
            ajustesBase: Number(rc.ajustes_manuais?.valor) || 0,
            proximoPagamento: `${finFormatarData(rc.proximo_pagamento)}${rc.situacao && rc.situacao !== 'aberta' ? ` · ${FIN_SITUACAO[rc.situacao]}` : ''}`,
            // Quem recebe: o apurado do mês; sem apuração, a previsão (para o card nunca ficar vazio à toa).
            beneficiarios: Array.isArray(rc.beneficiarios) ? rc.beneficiarios : [],
            previstos: Array.isArray(rc.beneficiarios_previstos) ? rc.beneficiarios_previstos : [],
            pago: Number(rc.pago) || 0,
            faltaPagar: rc.falta_pagar === null || rc.falta_pagar === undefined ? null : Number(rc.falta_pagar)
        },
        resumoProducao: {
            emProducao: Number(rp.em_producao) || 0, parciais: Number(rp.parciais) || 0, pecasMes: Number(rp.pecas_mes) || 0, valorCompetencia: Number(rp.valor) || 0,
            proximoPagamento: `${finFormatarData(rp.proximo_pagamento)} (${diaUtil})${rp.situacao && rp.situacao !== 'aberta' ? ` · ${FIN_SITUACAO[rp.situacao]}` : ''}`
        },
        pendencias: (painel.pendencias || []).map(x => ({
            nivel: x.nivel === 'critico' ? 'critico' : 'normal',
            titulo: x.titulo, descricao: x.descricao, data: x.data, acao: x.acao || 'Ver', destino: x.destino, filtro: x.filtro || null
        })),
        atividade: (painel.atividade || []).map(e => ({ quando: e.quando, titulo: e.titulo, detalhe: e.detalhe }))
    };
}

/** Fiscal e módulo numa linha do tempo só: mais recentes primeiro (os instantes vêm todos em horário de Brasília). */
function finJuntarAtividade(...listas) {
    return listas.flat().filter(e => e && e.quando)
        .sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
}

/** A parte fiscal, as contas a receber e as comissões/produção reais da competência. */
async function finCarregarDados(competencia) {
    const comp = encodeURIComponent(competencia || '');
    const [{ painel, erro }, receberLido, comissoesLido] = await Promise.all([
        finBuscarPainel(competencia),
        finChamarApi(`/api/cobranca/recebimentos/painel?competencia=${comp}`),
        finChamarApi(`/api/financeiro/painel?competencia=${comp}`)
    ]);
    const fiscal = finMapearPainel(painel, erro);
    const receber = finMapearReceber(receberLido.corpo, receberLido.erro);
    const modulo = finMapearComissoes(comissoesLido.corpo, comissoesLido.erro);
    return {
        kpis: { nf: fiscal.nf, ...modulo.kpis },
        receber,
        pendencias: finJuntarPendencias(fiscal.pendencias, receber.pendencias, modulo.pendencias),
        atividade: finJuntarAtividade(fiscal.atividade, modulo.atividade),
        ambiente: fiscal.ambiente,
        resumoComissoes: modulo.resumoComissoes,
        resumoProducao: modulo.resumoProducao
    };
}

/**
 * O que a conciliação fez, organizado para a caixa da casa: cartões com os
 * números (avisos, boletos consultados, pagamentos, recebimentos lançados),
 * o detalhe do que mudou e as ocorrências em lista. Pura.
 */
function finCaixaDaConciliacao(r) {
    const f = r?.fila || {};
    const c = r?.consultas || {};
    const acerto = r?.acerto || {};
    const n = v => Number(v) || 0;
    const pagamentos = n(f.pagos) + n(c.pagos);
    const erros = n(f.erros) + n(c.erros) + n(acerto.erros);
    const secoes = [];

    const avisos = [
        ['Pagamentos', f.pagos, 'sucesso'], ['Cancelamentos', f.cancelados], ['Alertas', f.alertas, 'aviso'],
        ['Ignorados (não são deste sistema)', f.ignorados], ['Com erro', f.erros, 'erro']
    ].filter(([, v]) => n(v)).map(([rotulo, v, tom]) => ({ rotulo, valor: finFormatarInteiro(v), tom }));
    if (avisos.length) secoes.push({ titulo: 'Avisos de pagamento do BB', icone: 'fa-inbox', itens: avisos });

    if (!r?.sql_pendente && c.consultados !== undefined) {
        const consulta = [
            ['Mudaram de situação', c.mudaram, 'info'], ['Pagos', c.pagos, 'sucesso'], ['Com erro', c.erros, 'erro']
        ].filter(([, v]) => n(v)).map(([rotulo, v, tom]) => ({ rotulo, valor: finFormatarInteiro(v), tom }));
        if (consulta.length) secoes.push({ titulo: 'Consulta ao BB', icone: 'fa-magnifying-glass', itens: consulta });
    }

    const mensagens = [...(f.mensagens || []), ...(c.mensagens || []), ...(acerto.mensagens || [])].filter(Boolean);
    if (mensagens.length) {
        secoes.push({
            titulo: 'Ocorrências', icone: 'fa-list-ul',
            lista: [...mensagens.slice(0, 5), ...(mensagens.length > 5 ? [`… e mais ${mensagens.length - 5}.`] : [])]
        });
    }

    const nadaMudou = !pagamentos && !n(c.mudaram) && !n(acerto.lancados) && !n(f.cancelados) && !n(f.alertas);
    return {
        title: 'Conciliação com o BB',
        subtitle: 'Avisos de pagamento e consulta dos boletos a pagar',
        tom: erros || r?.sql_pendente ? 'aviso' : 'sucesso',
        icone: 'fa-building-columns',
        resumo: [
            { rotulo: 'Avisos na fila', valor: finFormatarInteiro(n(f.lidos)) },
            { rotulo: 'Boletos consultados', valor: r?.sql_pendente ? '—' : finFormatarInteiro(n(c.consultados)) },
            { rotulo: 'Pagamentos', valor: finFormatarInteiro(pagamentos), tom: pagamentos ? 'sucesso' : undefined },
            { rotulo: 'Recebimentos lançados', valor: finFormatarInteiro(n(acerto.lancados)), tom: n(acerto.lancados) ? 'sucesso' : undefined }
        ],
        secoes,
        alerta: r?.sql_pendente ? 'Os recebimentos ainda não estão ativados: rode sql/cobranca_recebimentos.sql e reinicie a API.' : undefined,
        nota: nadaMudou && !erros
            ? 'Tudo em dia: nenhum boleto mudou de situação desde a última conciliação.'
            : 'A tela já foi atualizada com o que mudou.'
    };
}

/** "Conciliar com o BB": fila do webhook + consulta dos boletos a pagar; mostra o resumo e relê a tela. */
async function finConciliar(moduleEl) {
    const raiz = moduleEl || document.querySelector('.modulo-container.financeiro-module');
    if (raiz?.dataset.conciliando === '1') return;
    if (raiz) raiz.dataset.conciliando = '1';
    try {
        window.showToast?.('Conciliando com o Banco do Brasil…', 'info');
        const { corpo, erro } = await finChamarApi('/api/cobranca/conciliar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const caixa = erro
            ? { title: 'Conciliação não concluída', tom: 'erro', message: erro.status === 403 ? 'Você não tem permissão para conciliar recebimentos.' : erro.message }
            : finCaixaDaConciliacao(corpo);
        if (window.DialogPadrao?.info) await window.DialogPadrao.info(caixa);
        await finRecarregar(raiz);
    } finally {
        if (raiz) delete raiz.dataset.conciliando;
    }
}

/**
 * Devolução que ficou pela metade (estoque, abatimento ou baixa no BB): tenta
 * de novo daqui mesmo, diz o que aconteceu e relê a tela.
 */
async function finReaplicarDevolucao(moduleEl, devolucaoId) {
    const raiz = moduleEl || document.querySelector('.modulo-container.financeiro-module');
    if (!devolucaoId || raiz?.dataset.reaplicando === '1') return;
    if (raiz) raiz.dataset.reaplicando = '1';
    try {
        window.showToast?.('Refazendo o que ficou pendente na devolução…', 'info');
        const { corpo, erro } = await finChamarApi(`/api/devolucoes/${encodeURIComponent(devolucaoId)}/reaplicar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const restam = Number(corpo?.pendencias) || 0;
        const avisos = Array.isArray(corpo?.avisos) ? corpo.avisos.filter(Boolean) : [];
        const caixa = erro
            ? { title: 'Devolução ainda pendente', tom: 'erro', message: erro.status === 403 ? 'Você não tem permissão para registrar devoluções.' : erro.message }
            : {
                title: restam ? 'Devolução ainda pendente' : 'Devolução concluída',
                tom: restam ? 'aviso' : 'sucesso',
                icone: 'fa-rotate-left',
                message: restam ? `Ainda ${restam === 1 ? 'ficou 1 pendência' : `ficaram ${restam} pendências`}: tente de novo mais tarde pela pendência do painel.` : 'Tudo resolvido: a devolução está concluída.',
                secoes: avisos.length ? [{ titulo: 'O que aconteceu', icone: 'fa-list-ul', lista: avisos }] : undefined
            };
        if (window.DialogPadrao?.info) await window.DialogPadrao.info(caixa);
        await finRecarregar(raiz);
    } finally {
        if (raiz) delete raiz.dataset.reaplicando;
    }
}

/**
 * Avisos do BB esperando na fila: processa só a fila (sem chamar o banco) e
 * relê a tela quando algo foi resolvido. Uma vez por visita à tela: aviso
 * que continua na fila (erro ao gravar) não pode virar laço — o resto fica
 * para o "Conciliar com o BB".
 */
function finProcessarFila(moduleEl, dados) {
    if (!(Number(dados?.receber?.fila) > 0) || moduleEl.dataset.filaProcessada === '1') return null;
    moduleEl.dataset.filaProcessada = '1';
    return finChamarApi('/api/cobranca/conciliar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ so_fila: true }) })
        .then(({ corpo }) => {
            const f = corpo?.fila || {};
            const resolvidos = (Number(f.pagos) || 0) + (Number(f.cancelados) || 0) + (Number(f.alertas) || 0) + (Number(f.ignorados) || 0);
            return resolvidos > 0 ? finRecarregar(moduleEl) : null;
        })
        .catch(() => null);
}

/* ------------------------------------------------------------- render */

function finCriar(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
}

function finPreencher(moduleEl, caminho, texto) {
    const alvo = moduleEl.querySelector(`[data-fin="${caminho}"]`);
    if (alvo) alvo.textContent = texto;
}

function finRenderizarKpis(moduleEl, kpis) {
    const { nf, comissoes, atrasadas, producao } = kpis;
    finPreencher(moduleEl, 'nf.valor', finFormatarInteiro(nf.quantidade));
    finPreencher(moduleEl, 'nf.auxiliar', nf.quantidade === null || nf.quantidade === undefined ? '' : (nf.quantidade === 1 ? 'pedido' : 'pedidos'));
    finPreencher(moduleEl, 'nf.rodape', nf.rodape || `Total: ${finFormatarMoeda(nf.total)}`);

    // Comissões e produção: { valor, total, auxiliar, rodape } já prontos
    // (finMapearComissoes). `valor` é o que falta pagar e `total` é o "de
    // quanto era" — os dois juntos são o "x/x" do cartão.
    for (const [chave, cartao] of [['comissoes', comissoes], ['atrasadas', atrasadas], ['producao', producao]]) {
        finPreencher(moduleEl, `${chave}.valor`, finFormatarMoeda(cartao?.valor));
        if (chave !== 'atrasadas') finPreencher(moduleEl, `${chave}.total`, cartao?.total || '');
        finPreencher(moduleEl, `${chave}.auxiliar`, cartao?.auxiliar || '');
        finPreencher(moduleEl, `${chave}.rodape`, cartao?.rodape || '');
    }
}

/** A faixa "Contas a receber": nota e os quatro cartões. */
function finRenderizarReceber(moduleEl, receber) {
    if (!receber) return;
    finPreencher(moduleEl, 'receber.nota', receber.nota);
    for (const chave of ['recebido', 'aReceber', 'atraso', 'boletos']) {
        const cartao = receber[chave] || {};
        finPreencher(moduleEl, `receber.${chave}.valor`, finFormatarMoeda(cartao.valor));
        finPreencher(moduleEl, `receber.${chave}.auxiliar`, cartao.auxiliar || '');
        finPreencher(moduleEl, `receber.${chave}.rodape`, cartao.rodape || '');
    }
}

function finRenderizarPendencias(moduleEl, pendencias, todas = false) {
    const lista = moduleEl.querySelector('[data-fin-lista="pendencias"]');
    if (!lista) return;
    lista.replaceChildren();
    finPreencher(moduleEl, 'pendencias.total', String(pendencias.length));
    const verTodas = moduleEl.querySelector('[data-fin-acao="pendencias-todas"]');
    if (verTodas) verTodas.classList.toggle('hidden', todas || pendencias.length <= FIN_PENDENCIAS_VISIVEIS);

    if (!pendencias.length) {
        lista.appendChild(finCriar('li', 'fin-vazio', 'Nenhuma pendência no momento. Tudo em dia por aqui.'));
        return;
    }

    for (const p of todas ? pendencias : pendencias.slice(0, FIN_PENDENCIAS_VISIVEIS)) {
        const item = finCriar('li', 'fin-pendencia');
        item.dataset.finAcao = p.destino;
        if (p.filtro) item.dataset.finFiltro = JSON.stringify(p.filtro);
        item.setAttribute('role', 'button');
        item.tabIndex = 0;

        const status = finCriar('span', 'fin-pendencia__status');
        status.dataset.nivel = p.nivel === 'critico' ? 'critico' : 'normal';

        const texto = finCriar('div', 'fin-pendencia__texto');
        texto.appendChild(finCriar('span', 'fin-pendencia__titulo', p.titulo));
        texto.appendChild(finCriar('span', 'fin-pendencia__descricao', p.descricao));

        const botao = finCriar('button', 'btn-neutral text-white rounded-md px-3 py-2 text-sm font-medium fin-pendencia__acao', p.acao);
        botao.type = 'button';
        botao.dataset.finAcao = p.destino;
        if (p.filtro) botao.dataset.finFiltro = JSON.stringify(p.filtro);

        item.append(status, texto, finCriar('span', 'fin-pendencia__data', p.data ? finFormatarData(p.data) : ''), botao);
        lista.appendChild(item);
    }
}

function finRenderizarResumos(moduleEl, dados) {
    const c = dados.resumoComissoes;
    finPreencher(moduleEl, 'resumoComissoes.previstas', finFormatarMoeda(c.previstas));
    finPreencher(moduleEl, 'resumoComissoes.apuradas', finFormatarMoeda(c.apuradas));
    finPreencher(moduleEl, 'resumoComissoes.atrasadas', finFormatarMoeda(c.atrasadas));
    // Ajustes: o que os ajustes à mão tiraram da comissão do mês mais os
    // estornos de competências já fechadas. Sem isto o card ficava em zero e a
    // comissão apenas aparecia menor, sem dizer por quê.
    finPreencher(moduleEl, 'resumoComissoes.ajustes', finFormatarMoeda(c.ajustes));
    finPreencher(moduleEl, 'resumoComissoes.ajustesQuantidade', c.ajustesQuantidade
        ? `(${finPlural(c.ajustesQuantidade, 'manual', 'manuais')}${c.ajustesBase ? ` · ${finFormatarMoeda(c.ajustesBase)}` : ''})`
        : '');
    finPreencher(moduleEl, 'resumoComissoes.proximoPagamento', c.proximoPagamento);
    finRenderizarBeneficiarios(moduleEl, c);

    const p = dados.resumoProducao;
    finPreencher(moduleEl, 'resumoProducao.emProducao', finFormatarInteiro(p.emProducao));
    finPreencher(moduleEl, 'resumoProducao.parciais', finFormatarInteiro(p.parciais));
    finPreencher(moduleEl, 'resumoProducao.pecasMes', finFormatarInteiro(p.pecasMes));
    finPreencher(moduleEl, 'resumoProducao.valorCompetencia', finFormatarMoeda(p.valorCompetencia));
    finPreencher(moduleEl, 'resumoProducao.proximoPagamento', p.proximoPagamento);
}

/**
 * Quem recebe, dentro do card de comissões: uma linha por pessoa, com a cor
 * dela, as etiquetas CMS/Royalty e o valor. Mostra o APURADO do mês; se ainda
 * não há nada apurado, mostra a PREVISÃO, dizendo qual é qual.
 */
function finRenderizarBeneficiarios(moduleEl, resumo) {
    const caixa = moduleEl.querySelector('#finResumoBeneficiarios');
    const lista = moduleEl.querySelector('#finResumoBeneficiariosLista');
    const legenda = moduleEl.querySelector('#finResumoBeneficiariosLegenda');
    const total = moduleEl.querySelector('#finResumoBeneficiariosTotal');
    if (!caixa || !lista || !window.Beneficiarios) return;

    const apurados = resumo.beneficiarios || [];
    const usados = apurados.length ? apurados : (resumo.previstos || []);
    caixa.classList.toggle('hidden', !usados.length);
    if (!usados.length) return;

    const pessoas = window.Beneficiarios.porPessoa(usados);
    const somaTotal = pessoas.reduce((s, p) => s + p.total, 0);
    total.textContent = `${apurados.length ? 'apurado' : 'previsto'}: ${finFormatarMoeda(somaTotal)}`;
    total.title = apurados.length
        ? 'O que a competência apurou até agora, por pessoa'
        : 'Ainda não há comissão apurada no mês: o que aparece é a previsão';

    lista.replaceChildren();
    for (const pessoa of pessoas) {
        const item = finCriar('li', 'fin-benef__item');
        const nome = finCriar('div', 'fin-benef__nome');
        nome.appendChild(window.Beneficiarios.ponto(pessoa.beneficiario));
        nome.appendChild(finCriar('span', null, pessoa.beneficiario || '—'));
        if (pessoa.cms > 0) {
            const tag = finCriar('span', 'fin-etiqueta-benef__tipo fin-etiqueta-benef__tipo--cms', 'CMS');
            tag.title = `CMS: ${finFormatarMoeda(pessoa.cms)}`;
            nome.appendChild(tag);
        }
        if (pessoa.royalty > 0) {
            const tag = finCriar('span', 'fin-etiqueta-benef__tipo fin-etiqueta-benef__tipo--royalty', 'Royalty');
            tag.title = `Royalty: ${finFormatarMoeda(pessoa.royalty)}`;
            nome.appendChild(tag);
        }
        const valor = finCriar('span', 'fin-benef__valor', finFormatarMoeda(pessoa.total));
        item.append(nome, valor);
        lista.appendChild(item);
    }

    legenda.replaceChildren(window.Beneficiarios.legenda([]));
}

function finRenderizarAtividade(moduleEl, eventos, hoje) {
    const lista = moduleEl.querySelector('[data-fin-lista="atividade"]');
    if (!lista) return;
    lista.replaceChildren();
    // "Ver todas" abre o histórico inteiro no modal (com quem fez): vale sempre que houver movimento.
    const verTodas = moduleEl.querySelector('[data-fin-acao="atividade-todas"]');
    if (verTodas) verTodas.classList.toggle('hidden', !eventos.length);
    if (!eventos.length) {
        lista.appendChild(finCriar('li', 'fin-vazio', 'Nenhum movimento registrado ainda.'));
        return;
    }
    for (const e of eventos.slice(0, FIN_ATIVIDADE_VISIVEL)) {
        const item = finCriar('li', 'fin-evento');
        const texto = finCriar('div', 'fin-evento__texto');
        texto.appendChild(finCriar('span', 'fin-evento__titulo', e.titulo));
        texto.appendChild(finCriar('span', 'fin-evento__detalhe', e.detalhe));
        item.append(finCriar('span', 'fin-evento__hora', e.hora || finFormatarQuando(e.quando, hoje)), texto);
        lista.appendChild(item);
    }
}

function finRenderizar(moduleEl, dados, hoje) {
    moduleEl.finDados = dados;
    finRenderizarKpis(moduleEl, dados.kpis);
    finRenderizarReceber(moduleEl, dados.receber);
    finRenderizarPendencias(moduleEl, dados.pendencias, moduleEl.dataset.pendenciasTodas === '1');
    finRenderizarResumos(moduleEl, dados);
    finRenderizarAtividade(moduleEl, dados.atividade, hoje);
}

function finMostrarTodasPendencias(moduleEl) {
    if (!moduleEl?.finDados) return;
    moduleEl.dataset.pendenciasTodas = '1';
    finRenderizarPendencias(moduleEl, moduleEl.finDados.pendencias, true);
}

/** Relê o painel da competência escolhida e redesenha. Os modais chamam ao fechar. */
function finRecarregar(moduleEl) {
    const raiz = moduleEl || document.querySelector('.modulo-container.financeiro-module');
    if (!raiz) return Promise.resolve();
    const competencia = raiz.querySelector('#finCompetencia')?.value || null;
    const promessa = finCarregarDados(competencia)
        .then(dados => {
            finRenderizar(raiz, dados, raiz.dataset.hoje);
            // Em segundo plano: não segura a tela esperando a fila.
            finProcessarFila(raiz, dados);
        })
        .catch(erro => {
            console.error('[financeiro] não foi possível montar a tela:', erro);
            window.showToast?.('Não foi possível carregar o Financeiro agora.', 'error');
        });
    raiz.moduleReadyPromise = promessa;
    return promessa;
}
window.FinanceiroRecarregar = () => finRecarregar(null);

/* --------------------------------------------------------------- init */

function finLigarAcoes(moduleEl) {
    // Um ouvinte só, por delegação: cartões, linhas de pendência, botões e
    // links trazem `data-fin-acao`. O botão dentro da linha vence a linha.
    const extraDe = alvo => {
        if (!alvo.dataset.finFiltro) return {};
        try { return { filtro: JSON.parse(alvo.dataset.finFiltro) }; } catch (_) { return {}; }
    };
    const disparar = (evento) => {
        const alvo = evento.target.closest('[data-fin-acao]');
        if (!alvo || !moduleEl.contains(alvo)) return;
        evento.stopPropagation();
        finExecutarAcao(alvo.dataset.finAcao, moduleEl, extraDe(alvo));
    };
    moduleEl.addEventListener('click', disparar);
    moduleEl.addEventListener('keydown', (evento) => {
        if (evento.key !== 'Enter' && evento.key !== ' ') return;
        const alvo = evento.target.closest('[data-fin-acao][role="button"]');
        if (!alvo) return;
        evento.preventDefault();
        finExecutarAcao(alvo.dataset.finAcao, moduleEl, extraDe(alvo));
    });
}

function finIniciar(moduleEl) {
    if (moduleEl.dataset.iniciado === '1') return;
    moduleEl.dataset.iniciado = '1';

    const hoje = new Date();
    moduleEl.dataset.hoje = finDiaDe(hoje);
    const select = moduleEl.querySelector('#finCompetencia');
    finMontarCompetencias(select, hoje);
    // Trocar a competência (ou voltar para hoje) relê o painel fiscal.
    select?.addEventListener('change', () => finRecarregar(moduleEl));
    moduleEl.querySelector('#finHoje')?.addEventListener('click', () => {
        if (!select) return;
        if (window.Competencia) window.Competencia.definir(select, finCompetenciaAtual(hoje));
        else select.value = finCompetenciaAtual(hoje);
        finRecarregar(moduleEl);
    });

    finLigarAcoes(moduleEl);

    // O menu espera esta promessa antes de tirar a máscara de carregamento.
    finRecarregar(moduleEl);
}

(function finBoot() {
    const moduleEl = document.querySelector('.modulo-container.financeiro-module');
    if (moduleEl) finIniciar(moduleEl);
})();
