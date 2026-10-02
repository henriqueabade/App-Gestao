/**
 * Módulo Contabilidade — Fechamento do mês (etapas 1 a 9).
 *
 * Tudo vem de GET /api/contabilidade/painel da competência escolhida: a
 * situação (aberta, fechada, reaberta), a contagem das pendências nas três
 * severidades do dono (erro crítico bloqueia o fechamento; pendência
 * documental bloqueia o pacote e o envio; aviso não bloqueia), o checklist
 * por fonte — só com o que o sistema já controla — a lista de pendências
 * (com "Ignorar" para documental/aviso, com justificativa) e a atividade do
 * módulo. Fechar, Reabrir, Contas a pagar, Documentos recebidos (registrar
 * NF-e, NFS-e, recibo), Documentos da competência, o Extrato bancário (OFX,
 * contas do banco), a Conciliação bancária e a Classificação (plano de
 * contas, regras), o Histórico dos fechamentos, o Relatório mensal, o
 * Dossiê e o Pacote (gerar o ZIP e registrar o envio) são reais (modais
 * próprios, src/js/modals/contabilidade-modais.js). As Configurações (etapas
 * 10 a 13) ligam e configuram as integrações — NF-e de entrada na SEFAZ,
 * extrato pela API do BB, NFS-e tomadas no ADN, aplicações (CDB) — e "NF-e
 * e NFS-e encontradas" é a caixa de entrada do que elas acharam.
 *
 * As pendências que vêm do Financeiro (NF-e, cobrança, fechamentos,
 * reembolsos) levam para lá: o botão da linha abre o módulo Financeiro. As
 * da própria Contabilidade (documento sem XML, pagamento sem nota…) abrem o
 * modal que as resolve.
 *
 * A lista de pendências mostra todas (rola dentro do cartão); os cartões de
 * erros críticos, documentais e avisos filtram E levam a tela até ela. A
 * atividade recente rola no cartão e "Ver todas" abre a linha do tempo
 * inteira (modal, com foto e filtros). "Mensagens e comentários" é o social
 * do módulo (src/js/utils/historico-social.js, origem 'contabilidade'): "@"
 * menciona um usuário e "'" cita um objeto do módulo, que abre ao clicar.
 *
 * O menu reexecuta este arquivo a cada visita (src/js/menu.js injeta o script
 * de novo, embrulhado numa IIFE), então nada aqui registra ouvinte em
 * `document`/`window`: os ouvintes ficam no elemento do módulo, que é trocado
 * a cada navegação, e a inicialização é guardada por `dataset.iniciado`.
 */

/* O mural das mensagens da Contabilidade: um só, o do módulo. */
const CTB_MURAL = 1;

const CTB_NIVEIS = {
    critico: { rotulo: 'Erro crítico', curto: 'Crítico' },
    documental: { rotulo: 'Pendência documental', curto: 'Documental' },
    aviso: { rotulo: 'Aviso', curto: 'Aviso' }
};

const CTB_ESTADOS = {
    ok: { rotulo: 'Em dia', icone: 'fa-check' },
    pendente: { rotulo: 'Pendente', icone: 'fa-hourglass-half' },
    aviso: { rotulo: 'Com avisos', icone: 'fa-info-circle' },
    critico: { rotulo: 'Erro crítico', icone: 'fa-exclamation-triangle' },
    em_curso: { rotulo: 'Mês em curso', icone: 'fa-clock' },
    indisponivel: { rotulo: 'Ainda não integrado', icone: 'fa-plug' },
    // Fase A: o mês de antes do início da Contabilidade.
    fora: { rotulo: 'Antes do início', icone: 'fa-ban' }
};

const CTB_SITUACOES = {
    aberta: 'Aberta',
    fechada: 'Fechada',
    reaberta: 'Reaberta'
};

/**
 * As pendências que a lista mostra com o filtro atual. `nivel` é 'todas',
 * 'critico', 'documental', 'aviso' ou 'ignoradas'; `fonte` restringe a uma
 * fonte do checklist. Fora de "ignoradas", as ignoradas não aparecem. Pura.
 */
function ctbFiltrarPendencias(lista, { nivel = 'todas', fonte = null } = {}) {
    const todas = Array.isArray(lista) ? lista.filter(Boolean) : [];
    return todas.filter(p => {
        if (fonte && p.fonte !== fonte) return false;
        if (nivel === 'ignoradas') return Boolean(p.ignorada);
        if (p.ignorada) return false;
        return nivel === 'todas' || p.nivel === nivel;
    });
}

/** A contagem por severidade das pendências vivas (e quantas foram ignoradas). Pura. */
function ctbContagem(lista) {
    const todas = Array.isArray(lista) ? lista.filter(Boolean) : [];
    const vivas = todas.filter(p => !p.ignorada);
    return {
        critico: vivas.filter(p => p.nivel === 'critico').length,
        documental: vivas.filter(p => p.nivel === 'documental').length,
        aviso: vivas.filter(p => p.nivel === 'aviso').length,
        ignoradas: todas.length - vivas.length,
        total: todas.length
    };
}

/**
 * O texto do cartão de situação: o estado por extenso e o detalhe (quem
 * fechou e quando; a justificativa da reabertura; o que ainda falta). Pura.
 */
function ctbTextoSituacao(painel) {
    const s = painel?.situacao || {};
    const status = CTB_SITUACOES[s.status] ? s.status : 'aberta';
    let detalhe = '';
    if (status === 'fechada') {
        detalhe = `Fechada em ${ctbFormatarInstante(s.fechada_em)}${s.fechada_por ? ` por ${s.fechada_por}` : ''}`;
        if (s.versao) detalhe += ` · versão ${s.versao}`;
        if (s.divergencias) detalhe += ` · ${s.divergencias === 1 ? '1 erro crítico novo' : `${s.divergencias} erros críticos novos`} desde o fechamento`;
        if (s.diferencas) detalhe += ` · ${s.diferencas === 1 ? '1 diferença' : `${s.diferencas} diferenças`} desde a foto do fechamento`;
        // Etapa 9: o pacote da contabilidade.
        if (s.pacote?.enviado_em) detalhe += ` · pacote enviado em ${ctbFormatarData(s.pacote.enviado_em)}`;
        else if (s.pacote) detalhe += ' · pacote gerado, falta marcar o envio';
    } else if (status === 'reaberta') {
        detalhe = `Reaberta em ${ctbFormatarInstante(s.reaberta_em)}${s.reaberta_por ? ` por ${s.reaberta_por}` : ''}${s.justificativa_reabertura ? ` — ${s.justificativa_reabertura}` : ''}`;
    } else if (painel?.encerrada === false) {
        detalhe = 'O mês ainda está em curso: fecha depois do último dia.';
    } else if (painel?.pode?.fechar) {
        detalhe = 'Sem erro crítico: a competência pode ser fechada.';
    } else if (Array.isArray(painel?.bloqueios?.fechar) && painel.bloqueios.fechar.length) {
        detalhe = painel.bloqueios.fechar.join(' ');
    }
    return { status, rotulo: CTB_SITUACOES[status], detalhe };
}

/** 'YYYY-MM-DD' -> 'dd/mm/aaaa', cortando o texto: passar por new Date volta um dia em São Paulo. */
function ctbFormatarData(texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (texto || '—');
}

/** Instante ISO (já em Brasília) -> 'dd/mm/aaaa às HH:MM'. */
function ctbFormatarInstante(instante) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(instante || ''));
    if (!m) return '—';
    return m[4] ? `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

/** Quando um evento aconteceu: 'HH:MM' se foi hoje, senão 'dd/mm'. */
function ctbFormatarQuando(instante, hoje) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(instante || ''));
    if (!m) return '—';
    if (`${m[1]}-${m[2]}-${m[3]}` === hoje && m[4]) return `${m[4]}:${m[5]}`;
    return `${m[3]}/${m[2]}`;
}

function ctbEscapar(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const ctbSemAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * As pendências da competência que está na tela, para o "'" das mensagens
 * citar (o resto — competências, documentos, contas, lançamentos… — vem de
 * GET /api/contabilidade/citaveis). O id é 'AAAA-MM:chave'. Pura.
 */
function ctbCitaveisLocais(pendencias, competencia, busca = '') {
    const comp = /^\d{4}-\d{2}$/.test(String(competencia || '')) ? String(competencia) : null;
    if (!comp) return [];
    const termo = ctbSemAcento(busca).trim();
    const mes = `${comp.slice(5, 7)}/${comp.slice(0, 4)}`;
    return (Array.isArray(pendencias) ? pendencias : [])
        .filter(p => p && /^[\w-]{1,70}$/.test(String(p.chave || '')))
        .map(p => ({
            tipo: 'pendencia',
            id: `${comp}:${p.chave}`,
            rotulo: `${CTB_NIVEIS[p.nivel]?.curto || 'Pendência'}: ${String(p.titulo || '').replace(/[[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()} (${mes})`.slice(0, 120),
            detalhe: p.ignorada ? 'Ignorada com justificativa' : (CTB_NIVEIS[p.nivel]?.rotulo || 'Pendência')
        }))
        .filter(o => !termo || ctbSemAcento(`${o.rotulo} ${o.detalhe}`).includes(termo));
}
// ------------------------------------------------------- fim das funções puras

/* Rótulo humano de cada ação, para o aviso "em implementação". Quando a ação
   ganhar modal/função real, basta preencher `abrir`. `extra` é o que a linha
   clicada traz (o filtro de uma pendência, a fonte de um cartão). */
const CTB_ACOES = {
    'atualizar': { rotulo: 'Atualizar', abrir: m => ctbRecarregar(m) },
    'fechar': { rotulo: 'Fechar competência', abrir: m => ctbAbrirModal('fechar', m) },
    'reabrir': { rotulo: 'Reabrir competência', abrir: m => ctbAbrirModal('reabrir', m) },
    'ignorar': { rotulo: 'Ignorar pendência', abrir: (m, extra) => ctbAbrirModal('ignorar-pendencia', m, { pendencia: extra?.pendencia || null }) },
    'restaurar': { rotulo: 'Restaurar pendência', abrir: (m, extra) => ctbRestaurarPendencia(m, extra?.pendencia || null) },
    'ir-financeiro': { rotulo: 'Abrir o Financeiro', abrir: (m, extra) => ctbIrParaFinanceiro(extra) },
    // O chip filtra no lugar (clicar de novo tira o filtro); o cartão do topo
    // filtra e leva a tela até a lista.
    'filtrar': { rotulo: 'Filtrar pendências', abrir: (m, extra) => (extra?.cartao ? ctbIrParaPendencias(m, extra.filtro) : ctbFiltrar(m, { nivel: extra?.filtro || 'todas' })) },
    'filtrar-fonte': { rotulo: 'Filtrar por fonte', abrir: (m, extra) => ctbFiltrar(m, { fonte: extra?.fonte || null }) },
    'ir-fonte': { rotulo: 'Ver as pendências da fonte', abrir: (m, extra) => ctbIrParaFonte(m, extra?.fonte || null) },
    'atividade-todas': { rotulo: 'Toda a atividade', abrir: m => ctbAbrirModal('atividade', m, {}) },
    'mensagens': { rotulo: 'Mensagens e comentários', abrir: (m, extra) => ctbAbrirModal('mensagens', m, { foco: extra?.foco || null }) },
    // Etapas 2 e 3: documentos, evidências e contas a pagar. `extra` é o
    // filtro da pendência (titulo_id, documento_id, visao…) ou vazio.
    'contas-pagar': { rotulo: 'Contas a pagar', abrir: (m, extra) => ctbAbrirModal('contas-pagar', m, { visao: extra?.visao || null }) },
    'conta-pagar': { rotulo: 'Conta a pagar', abrir: (m, extra) => ctbAbrirModal('conta-pagar', m, { titulo_id: extra?.titulo_id ?? null }) },
    'nova-conta': { rotulo: 'Nova conta a pagar', abrir: m => ctbAbrirModal('conta-pagar-form', m, {}) },
    'registrar-documento': {
        rotulo: 'Registrar documento recebido',
        abrir: (m, extra) => ctbAbrirModal('registrar-documento', m, { tipo: extra?.tipo || null, financeiro_pagamento_id: extra?.financeiro_pagamento_id ?? null })
    },
    'documentos-recebidos': { rotulo: 'Documentos fiscais recebidos', abrir: m => ctbAbrirModal('documentos-recebidos', m, {}) },
    'documento-recebido': { rotulo: 'Documento recebido', abrir: (m, extra) => ctbAbrirModal('documento-recebido', m, { documento_id: extra?.documento_id ?? null }) },
    'evidencias': { rotulo: 'Documentos da competência', abrir: m => ctbAbrirModal('evidencias', m, {}) },
    // Etapa 4: extrato bancário por OFX. `conta_id` vem da pendência do extrato.
    'extrato': { rotulo: 'Extrato bancário', abrir: (m, extra) => ctbAbrirModal('extrato', m, { conta_id: extra?.conta_id ?? null }) },
    'importar-extrato': { rotulo: 'Importar extrato (OFX)', abrir: (m, extra) => ctbAbrirModal('importar-extrato', m, { conta_id: extra?.conta_id ?? null }) },
    'contas-financeiras': { rotulo: 'Contas do banco', abrir: m => ctbAbrirModal('contas-financeiras', m, {}) },
    // Etapa 5: conciliação do extrato. A pendência traz a visão e, às vezes, o lançamento a destacar.
    'conciliacao': {
        rotulo: 'Conciliação bancária',
        abrir: (m, extra) => ctbAbrirModal('conciliacao', m, { conta_id: extra?.conta_id ?? null, visao: extra?.visao || null, movimento_id: extra?.movimento_id ?? null })
    },
    'conciliar-movimento': { rotulo: 'Conciliar lançamento', abrir: (m, extra) => ctbAbrirModal('conciliar-movimento', m, { movimento_id: extra?.movimento_id ?? null }) },
    // Etapa 6: classificação (plano de contas e regras). A pendência abre só os sem classificação.
    'classificacao': { rotulo: 'Classificação', abrir: (m, extra) => ctbAbrirModal('classificacao', m, { visao: extra?.visao || null }) },
    'plano-contas': { rotulo: 'Plano de contas', abrir: m => ctbAbrirModal('plano-contas', m, {}) },
    'regras-classificacao': { rotulo: 'Regras de classificação', abrir: m => ctbAbrirModal('regras-classificacao', m, {}) },
    // Etapa 7: as versões do fechamento e as diferenças desde ele (o aviso da lista abre aqui).
    'fechamentos': { rotulo: 'Histórico dos fechamentos', abrir: m => ctbAbrirModal('fechamentos', m, {}) },
    // Etapa 8: o relatório mensal (tela, PDF, planilha) e o dossiê de um lançamento, conta ou documento.
    'relatorio': { rotulo: 'Relatório mensal', abrir: m => ctbAbrirModal('relatorio', m, {}) },
    'dossie': { rotulo: 'Dossiê', abrir: (m, extra) => ctbAbrirModal('dossie', m, { tipo: extra?.tipo || 'movimento', id: extra?.id ?? null }) },
    // A pendência da própria Contabilidade: o filtro diz qual modal abre e com quê.
    'abrir-pendencia': { rotulo: 'Resolver pendência', abrir: (m, extra) => ctbAbrirDaPendencia(m, extra?.pendencia) },
    // Etapa 9: o pacote (ZIP) que o usuário salva e envia; "enviar" abre o mesmo modal no registro do envio.
    'pacote': { rotulo: 'Gerar pacote (ZIP)', abrir: m => ctbAbrirModal('pacote', m, {}) },
    'enviar': { rotulo: 'Registrar o envio à contabilidade', abrir: m => ctbAbrirModal('pacote', m, { enviar: true }) },
    // Etapas 10 a 13: as integrações (SEFAZ, BB, ADN) e a caixa de entrada das notas que elas acham.
    'configuracao': { rotulo: 'Configurações da contabilidade', abrir: m => ctbAbrirModal('configuracao', m, {}) },
    'entrada-dfe': { rotulo: 'NF-e e NFS-e encontradas', abrir: m => ctbAbrirModal('entrada-dfe', m, {}) }
};

/* Modais do módulo (src/html/modals/contabilidade). Todos usam o mesmo script,
   que descobre qual modal montar por `window.contabilidadeModalContexto`. */
const CTB_MODAIS = {
    'fechar': { html: 'modals/contabilidade/fechar.html', overlay: 'ctbFechar' },
    'reabrir': { html: 'modals/contabilidade/reabrir.html', overlay: 'ctbReabrir' },
    'ignorar-pendencia': { html: 'modals/contabilidade/ignorar-pendencia.html', overlay: 'ctbIgnorarPendencia' },
    'contas-pagar': { html: 'modals/contabilidade/contas-pagar.html', overlay: 'ctbContasPagar' },
    'conta-pagar': { html: 'modals/contabilidade/conta-pagar.html', overlay: 'ctbContaPagar' },
    'conta-pagar-form': { html: 'modals/contabilidade/conta-pagar-form.html', overlay: 'ctbContaPagarForm' },
    'pagar-parcela': { html: 'modals/contabilidade/pagar-parcela.html', overlay: 'ctbPagarParcela' },
    'documentos-recebidos': { html: 'modals/contabilidade/documentos-recebidos.html', overlay: 'ctbDocumentosRecebidos' },
    'registrar-documento': { html: 'modals/contabilidade/registrar-documento.html', overlay: 'ctbRegistrarDocumento' },
    'documento-recebido': { html: 'modals/contabilidade/documento-recebido.html', overlay: 'ctbDocumentoRecebido' },
    'evidencias': { html: 'modals/contabilidade/evidencias.html', overlay: 'ctbEvidencias' },
    'extrato': { html: 'modals/contabilidade/extrato.html', overlay: 'ctbExtrato' },
    'importar-extrato': { html: 'modals/contabilidade/importar-extrato.html', overlay: 'ctbImportarExtrato' },
    'contas-financeiras': { html: 'modals/contabilidade/contas-financeiras.html', overlay: 'ctbContasFinanceiras' },
    'conciliacao': { html: 'modals/contabilidade/conciliacao.html', overlay: 'ctbConciliacao' },
    'conciliar-movimento': { html: 'modals/contabilidade/conciliar-movimento.html', overlay: 'ctbConciliarMovimento' },
    'classificacao': { html: 'modals/contabilidade/classificacao.html', overlay: 'ctbClassificacao' },
    'plano-contas': { html: 'modals/contabilidade/plano-contas.html', overlay: 'ctbPlanoContas' },
    'regras-classificacao': { html: 'modals/contabilidade/regras-classificacao.html', overlay: 'ctbRegras' },
    'fechamentos': { html: 'modals/contabilidade/fechamentos.html', overlay: 'ctbFechamentos' },
    'relatorio': { html: 'modals/contabilidade/relatorio.html', overlay: 'ctbRelatorio' },
    'dossie': { html: 'modals/contabilidade/dossie.html', overlay: 'ctbDossie' },
    'pacote': { html: 'modals/contabilidade/pacote.html', overlay: 'ctbPacote' },
    // A atividade inteira (linha do tempo com foto e filtros) e as mensagens em tamanho grande.
    'atividade': { html: 'modals/contabilidade/atividade.html', overlay: 'ctbAtividade' },
    'mensagens': { html: 'modals/contabilidade/mensagens.html', overlay: 'ctbMensagens' },
    // Etapas 10 a 13: as integrações e a caixa de entrada (NF-e da SEFAZ, NFS-e do ADN).
    'configuracao': { html: 'modals/contabilidade/configuracao.html', overlay: 'ctbConfiguracao' },
    'entrada-dfe': { html: 'modals/contabilidade/entrada-dfe.html', overlay: 'ctbEntradaDfe' }
};

/** O que a pendência da Contabilidade abre: a ação do filtro, com o filtro como extra. */
function ctbAbrirDaPendencia(moduleEl, pendencia) {
    const filtro = pendencia?.filtro || {};
    if (!filtro.acao || !CTB_ACOES[filtro.acao] || filtro.acao === 'abrir-pendencia') {
        ctbAvisarEmImplementacao('abrir-pendencia');
        return;
    }
    ctbExecutarAcao(filtro.acao, moduleEl, filtro);
}
const CTB_SCRIPT_MODAIS = '../js/modals/contabilidade-modais.js';

function ctbAbrirModal(chave, moduleEl, extra = {}) {
    const modal = CTB_MODAIS[chave];
    if (!modal || typeof window.Modal?.open !== 'function') {
        ctbAvisarEmImplementacao(chave);
        return;
    }
    const raiz = moduleEl || document.querySelector('.modulo-container.contabilidade-module');
    window.contabilidadeModalContexto = {
        ...extra,
        overlayId: modal.overlay,
        acao: chave,
        rotulo: CTB_ACOES[chave]?.rotulo || '',
        competencia: extra.competencia || raiz?.querySelector('#ctbCompetencia')?.value || null
    };
    // O spinner da casa fica na tela até o modal terminar a primeira leitura.
    ctbSpinnerDoModal(modal.overlay);
    window.Modal.open(modal.html, CTB_SCRIPT_MODAIS, modal.overlay, extra.empilhar === true);
}

/* Tempo mínimo e máximo do spinner, como no Financeiro. */
const CTB_SPINNER_MINIMO_MS = 1000;
const CTB_SPINNER_MAXIMO_MS = 15000;
const ctbSpinners = new Map();

function ctbSpinnerDoModal(overlayId) {
    ctbSpinners.get(overlayId)?.remover();
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
            if (ctbSpinners.get(overlayId) === registro) ctbSpinners.delete(overlayId);
        }
    };
    limite = setTimeout(() => registro.remover(), CTB_SPINNER_MAXIMO_MS);
    // Fechado antes de ficar pronto (troca de módulo, Esc): o spinner vai junto.
    let viuOModal = false;
    vigia = setInterval(() => {
        const existe = document.getElementById?.(`${overlayId}Overlay`);
        if (existe) viuOModal = true;
        else if (viuOModal) registro.remover();
    }, 400);
    ctbSpinners.set(overlayId, registro);
}

/** O modal avisa que terminou a primeira leitura; `revelar` é quem o mostra. */
window.ContabilidadeModalPronto = (overlayId, revelar) => {
    const registro = ctbSpinners.get(overlayId);
    if (!registro) { revelar(); return; }
    const resta = Math.max(0, CTB_SPINNER_MINIMO_MS - (Date.now() - registro.inicio));
    setTimeout(() => {
        registro.remover();
        revelar();
    }, resta);
};
window.ContabilidadeAbrirModal = ctbAbrirModal;

function ctbAvisarEmImplementacao(chave) {
    const rotulo = CTB_ACOES[chave]?.rotulo || 'Esta função';
    if (window.DialogPadrao?.info) {
        window.DialogPadrao.info({ title: 'Função em implementação', tom: 'aviso', icone: 'fa-person-digging', message: `"${rotulo}" ainda está em implementação.`, nota: 'Chega numa das próximas etapas do módulo.' });
    } else {
        window.alert(`"${rotulo}" ainda está em implementação.`);
    }
}

function ctbExecutarAcao(chave, moduleEl, extra = {}) {
    const acao = CTB_ACOES[chave];
    if (acao && typeof acao.abrir === 'function') {
        acao.abrir(moduleEl, extra);
        return;
    }
    ctbAvisarEmImplementacao(chave);
}

/* ------------------------------------------------------------- painel */

/** Uma chamada ao backend: `{ corpo, erro }`, sem lançar. */
async function ctbChamarApi(caminho, opcoes) {
    if (typeof window.apiConfig?.getApiBaseUrl !== 'function' || typeof fetch !== 'function') {
        return { corpo: null, erro: null };
    }
    try {
        const base = await window.apiConfig.getApiBaseUrl();
        const resposta = await fetch(`${base}${caminho}`, { ...opcoes, headers: { 'Content-Type': 'application/json', ...(opcoes?.headers || {}) } });
        const corpo = await resposta.json().catch(() => null);
        if (!resposta.ok) {
            const e = new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
            e.status = resposta.status;
            e.corpo = corpo;
            return { corpo: null, erro: e };
        }
        return { corpo, erro: null };
    } catch (erro) {
        return { corpo: null, erro };
    }
}

async function ctbCarregarDados(competencia) {
    const comp = encodeURIComponent(competencia || '');
    const [painel, atividade] = await Promise.all([
        ctbChamarApi(`/api/contabilidade/painel?competencia=${comp}`),
        ctbChamarApi(`/api/contabilidade/atividade?limite=50`)
    ]);
    return { painel: painel.corpo, erro: painel.erro, atividade: Array.isArray(atividade.corpo?.eventos) ? atividade.corpo.eventos : [] };
}

/* ------------------------------------------------------------- render */

function ctbCriar(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
}

function ctbPreencher(moduleEl, caminho, texto) {
    const alvo = moduleEl.querySelector(`[data-ctb="${caminho}"]`);
    if (alvo) alvo.textContent = texto;
}

function ctbMostrarAviso(moduleEl, texto) {
    const aviso = moduleEl.querySelector('#ctbAviso');
    if (!aviso) return;
    ctbPreencher(moduleEl, 'aviso.texto', texto || '');
    aviso.classList.toggle('hidden', !texto);
}

function ctbRenderizarSituacao(moduleEl, painel) {
    const cartao = moduleEl.querySelector('.ctb-kpi--situacao');
    const { status, rotulo, detalhe } = ctbTextoSituacao(painel);
    if (cartao) cartao.dataset.ctbSituacao = status;
    ctbPreencher(moduleEl, 'situacao.status', rotulo);
    ctbPreencher(moduleEl, 'situacao.rotulo', painel?.rotulo || '');
    ctbPreencher(moduleEl, 'situacao.detalhe', detalhe);

    const p = painel?.progresso || { ok: 0, total: 0 };
    const pct = p.total ? Math.round((p.ok / p.total) * 100) : 0;
    const barra = moduleEl.querySelector('[data-ctb-progresso]');
    if (barra) {
        barra.setAttribute('aria-valuenow', String(pct));
        barra.dataset.completo = p.total && p.ok === p.total ? '1' : '0';
        const preenchimento = barra.querySelector('[data-ctb-progresso-barra]');
        if (preenchimento) preenchimento.style.width = `${pct}%`;
    }
    ctbPreencher(moduleEl, 'progresso.texto', p.total ? `${p.ok} de ${p.total} fontes em dia` : 'Nenhuma fonte avaliada');

    // Fechar / Reabrir no cabeçalho: um ou outro, conforme a situação.
    const fechar = moduleEl.querySelector('#ctbFechar');
    const reabrir = moduleEl.querySelector('#ctbReabrir');
    if (fechar) {
        fechar.classList.toggle('hidden', status === 'fechada');
        fechar.title = painel?.pode?.fechar ? 'Fecha a competência para a contabilidade' : (painel?.bloqueios?.fechar || []).join(' ') || 'Fecha a competência para a contabilidade';
    }
    if (reabrir) reabrir.classList.toggle('hidden', status !== 'fechada');
    const acaoFechar = moduleEl.querySelector('.ctb-acao[data-ctb-acao="fechar"]');
    const acaoReabrir = moduleEl.querySelector('.ctb-acao[data-ctb-acao="reabrir"]');
    if (acaoFechar) acaoFechar.disabled = status === 'fechada';
    if (acaoReabrir) acaoReabrir.disabled = status !== 'fechada';
}

function ctbRenderizarContagem(moduleEl, contagem) {
    for (const nivel of ['critico', 'documental', 'aviso']) {
        ctbPreencher(moduleEl, `contagem.${nivel}`, String(contagem?.[nivel] ?? '—'));
        const cartao = moduleEl.querySelector(`.ctb-kpi[data-ctb-filtro="${nivel}"]`);
        if (cartao) cartao.classList.toggle('is-zero', !(contagem?.[nivel] > 0));
    }
    const ignoradas = Number(contagem?.ignoradas) || 0;
    ctbPreencher(moduleEl, 'contagem.rodape', ignoradas ? `Não bloqueiam nada · ${ignoradas === 1 ? '1 pendência ignorada' : `${ignoradas} pendências ignoradas`} com justificativa` : 'Não bloqueiam nada');
}

function ctbRenderizarFontes(moduleEl, fontes, filtroFonte) {
    const grade = moduleEl.querySelector('[data-ctb-lista="fontes"]');
    if (!grade) return;
    grade.replaceChildren();
    for (const f of Array.isArray(fontes) ? fontes : []) {
        const estado = CTB_ESTADOS[f.estado] ? f.estado : 'indisponivel';
        const cartao = ctbCriar('article', 'ctb-fonte glass-surface rounded-xl');
        cartao.dataset.estado = estado;
        cartao.dataset.fonte = f.chave;
        if (estado !== 'indisponivel' && estado !== 'fora') {
            // Como os cartões do alto: filtra e leva até o cartão das pendências (02/10/2026).
            cartao.dataset.ctbAcao = 'ir-fonte';
            cartao.dataset.ctbFonte = f.chave;
            cartao.setAttribute('role', 'button');
            cartao.tabIndex = 0;
            cartao.setAttribute('aria-label', `${f.titulo} — ver as pendências desta fonte`);
        }
        cartao.classList.toggle('is-filtro', Boolean(filtroFonte) && filtroFonte === f.chave);

        const topo = ctbCriar('div', 'ctb-fonte__topo');
        const icone = ctbCriar('span', 'ctb-fonte__icone');
        icone.appendChild(ctbCriar('i', `fas ${f.icone || 'fa-folder'}`));
        icone.setAttribute('aria-hidden', 'true');
        topo.append(icone, ctbCriar('h3', 'ctb-fonte__titulo', f.titulo));
        const etiqueta = ctbCriar('span', 'ctb-fonte__estado');
        etiqueta.dataset.estado = estado;
        etiqueta.appendChild(ctbCriar('i', `fas ${CTB_ESTADOS[estado].icone}`));
        etiqueta.appendChild(document.createTextNode(CTB_ESTADOS[estado].rotulo));
        topo.appendChild(etiqueta);
        cartao.appendChild(topo);

        if (f.nota) {
            cartao.appendChild(ctbCriar('p', 'ctb-fonte__nota', f.nota));
        } else {
            const dl = ctbCriar('dl', 'ctb-fonte__resumo');
            for (const linha of Array.isArray(f.resumo) ? f.resumo : []) {
                const div = ctbCriar('div', 'ctb-fonte__linha');
                div.append(ctbCriar('dt', null, linha.rotulo), ctbCriar('dd', null, linha.valor));
                dl.appendChild(div);
            }
            cartao.appendChild(dl);
        }
        if (estado !== 'indisponivel' && estado !== 'fora') {
            const n = Number(f.pendencias) || 0;
            cartao.appendChild(ctbCriar('p', 'ctb-fonte__rodape', n ? (n === 1 ? '1 pendência' : `${n} pendências`) : 'Nenhuma pendência'));
        }
        grade.appendChild(cartao);
    }
}

function ctbRenderizarPendencias(moduleEl) {
    const lista = moduleEl.querySelector('[data-ctb-lista="pendencias"]');
    if (!lista) return;
    const dados = moduleEl.ctbDados || {};
    const filtro = moduleEl.ctbFiltro || { nivel: 'todas', fonte: null };
    const escolhidas = ctbFiltrarPendencias(dados.pendencias, filtro);
    lista.replaceChildren();
    ctbPreencher(moduleEl, 'pendencias.total', String(escolhidas.length));

    // Chips e cartões marcam o filtro atual.
    moduleEl.querySelectorAll('.ctb-chip[data-ctb-filtro]').forEach(chip => chip.classList.toggle('is-ativo', chip.dataset.ctbFiltro === filtro.nivel));
    moduleEl.querySelectorAll('.ctb-kpi[data-ctb-filtro]').forEach(cartao => cartao.classList.toggle('is-filtro', cartao.dataset.ctbFiltro === filtro.nivel));
    const chipFonte = moduleEl.querySelector('[data-ctb-fonte-chip]');
    if (chipFonte) {
        const fonte = (dados.fontes || []).find(f => f.chave === filtro.fonte);
        chipFonte.classList.toggle('hidden', !fonte);
        ctbPreencher(moduleEl, 'filtro.fonte', fonte ? fonte.titulo : '');
    }
    moduleEl.querySelectorAll('.ctb-fonte').forEach(cartao => cartao.classList.toggle('is-filtro', Boolean(filtro.fonte) && cartao.dataset.fonte === filtro.fonte));

    if (!escolhidas.length) {
        const vazio = filtro.nivel === 'ignoradas' ? 'Nenhuma pendência ignorada nesta competência.'
            : (filtro.nivel !== 'todas' || filtro.fonte ? 'Nenhuma pendência com este filtro.' : 'Nenhuma pendência. A competência está limpa por aqui.');
        lista.appendChild(ctbCriar('li', 'ctb-vazio', vazio));
        return;
    }

    // Todas: o cartão tem altura fixa e a lista rola dentro dele.
    for (const p of escolhidas) {
        const item = ctbCriar('li', 'ctb-pendencia');
        item.dataset.chave = p.chave || '';
        if (p.ignorada) item.classList.add('is-ignorada');
        const status = ctbCriar('span', 'ctb-pendencia__status');
        status.dataset.nivel = p.nivel;

        const texto = ctbCriar('div', 'ctb-pendencia__texto');
        const titulo = ctbCriar('span', 'ctb-pendencia__titulo');
        const nivel = ctbCriar('span', 'ctb-pendencia__nivel', CTB_NIVEIS[p.nivel]?.curto || p.nivel);
        nivel.dataset.nivel = p.nivel;
        titulo.append(nivel, document.createTextNode(p.titulo || ''));
        texto.appendChild(titulo);
        const descricao = p.ignorada
            ? `Ignorada${p.ignorada_por ? ` por ${p.ignorada_por}` : ''}${p.ignorada_em ? ` em ${ctbFormatarInstante(p.ignorada_em)}` : ''}: ${p.justificativa || ''}`
            : (p.descricao || '');
        texto.appendChild(ctbCriar('span', 'ctb-pendencia__descricao', descricao));

        const acoes = ctbCriar('div', 'ctb-pendencia__acoes');
        if (p.destino === 'contabilidade') {
            const abrir = ctbCriar('button', 'btn-secondary text-white ctl-botao ctl-botao--pequeno', p.acao || 'Abrir');
            abrir.type = 'button';
            abrir.dataset.ctbAcao = 'abrir-pendencia';
            abrir.title = 'Abre aqui mesmo, na Contabilidade';
            abrir.ctbPendencia = p;
            acoes.appendChild(abrir);
        }
        if (p.destino === 'financeiro') {
            const ir = ctbCriar('button', 'btn-neutral text-white ctl-botao ctl-botao--pequeno', p.acao || 'Financeiro');
            ir.type = 'button';
            ir.dataset.ctbAcao = 'ir-financeiro';
            ir.title = 'Abre o módulo Financeiro, onde isto se resolve';
            ir.ctbPendencia = p;
            acoes.appendChild(ir);
        }
        if (p.ignorada) {
            const restaurar = ctbCriar('button', 'btn-neutral text-white ctl-botao ctl-botao--pequeno', 'Restaurar');
            restaurar.type = 'button';
            restaurar.dataset.ctbAcao = 'restaurar';
            restaurar.dataset.perm = 'contabilidade.pendencia.resolver';
            restaurar.ctbPendencia = p;
            acoes.appendChild(restaurar);
        } else if (p.ignoravel) {
            const ignorar = ctbCriar('button', 'btn-neutral text-white ctl-botao ctl-botao--pequeno', 'Ignorar');
            ignorar.type = 'button';
            ignorar.dataset.ctbAcao = 'ignorar';
            ignorar.dataset.perm = 'contabilidade.pendencia.resolver';
            ignorar.title = 'Deixa de contar, com justificativa';
            ignorar.ctbPendencia = p;
            acoes.appendChild(ignorar);
        }

        item.append(status, texto, ctbCriar('span', 'ctb-pendencia__data', p.data ? ctbFormatarData(p.data) : ''), acoes);
        lista.appendChild(item);
    }
    // Botões novos pedem a permissão deles (o `data-perm` só é lido na aplicação).
    try { window.Permissoes?.aplicarAcoesEColunas?.(lista); } catch (_) { /* sem permissões carregadas: fica como está */ }
}

function ctbRenderizarAtividade(moduleEl, eventos, hoje) {
    const lista = moduleEl.querySelector('[data-ctb-lista="atividade"]');
    if (!lista) return;
    lista.replaceChildren();
    if (!eventos.length) {
        lista.appendChild(ctbCriar('li', 'ctb-vazio', 'Nenhum movimento registrado ainda.'));
        return;
    }
    // Os mais recentes rolam no cartão; "Ver todas" abre o histórico inteiro, com filtros.
    for (const e of eventos) {
        const item = ctbCriar('li', 'ctb-evento');
        const texto = ctbCriar('div', 'ctb-evento__texto');
        texto.appendChild(ctbCriar('span', 'ctb-evento__titulo', `${e.rotulo || e.tipo}${e.competencia ? ` · ${e.competencia.split('-').reverse().join('/')}` : ''}${e.usuario ? ` · ${e.usuario}` : ''}`));
        texto.appendChild(ctbCriar('span', 'ctb-evento__detalhe', e.descricao || ''));
        item.append(ctbCriar('span', 'ctb-evento__hora', ctbFormatarQuando(e.quando, hoje)), texto);
        lista.appendChild(item);
    }
}

function ctbRenderizar(moduleEl, dados, hoje) {
    const { painel, erro, atividade } = dados;
    moduleEl.ctbDados = painel || { pendencias: [], fontes: [] };
    if (!painel) {
        const texto = erro?.status === 403 ? 'Você não tem permissão para ver a Contabilidade (contabilidade.view).'
            : (erro?.corpo?.sql_pendente ? erro.message : (erro ? `Não foi possível carregar a Contabilidade: ${erro.message}` : 'Sem dados.'));
        ctbMostrarAviso(moduleEl, texto);
        ctbRenderizarSituacao(moduleEl, null);
        ctbRenderizarContagem(moduleEl, null);
        ctbRenderizarFontes(moduleEl, [], null);
        ctbRenderizarPendencias(moduleEl);
        ctbRenderizarAtividade(moduleEl, atividade || [], hoje);
        return;
    }
    ctbMostrarAviso(moduleEl, painel.sql_pendente
        ? 'A Contabilidade ainda não foi ativada no banco: rode sql/contabilidade_base.sql e reinicie a API. Até lá o checklist aparece, mas nada é gravado.'
        : (painel.antes_do_inicio
            ? `Este mês é de antes do início da Contabilidade (${painel.antes_do_inicio.rotulo}): nada é cobrado nem fechado. As notas dele esperam a sua decisão na caixa de entrada (registrar ou guardar como histórico).`
            : ''));
    ctbRenderizarSituacao(moduleEl, painel);
    ctbRenderizarContagem(moduleEl, painel.contagem);
    ctbRenderizarFontes(moduleEl, painel.fontes, moduleEl.ctbFiltro?.fonte || null);
    ctbRenderizarPendencias(moduleEl);
    ctbRenderizarAtividade(moduleEl, atividade || [], hoje);
}

/* --------------------------------------------------------------- ações */

function ctbFiltrar(moduleEl, { nivel, fonte } = {}) {
    const atual = moduleEl.ctbFiltro || { nivel: 'todas', fonte: null };
    const novo = { ...atual };
    if (nivel !== undefined) novo.nivel = atual.nivel === nivel && nivel !== 'todas' ? 'todas' : nivel;
    if (fonte !== undefined) novo.fonte = atual.fonte === fonte ? null : (fonte || null);
    moduleEl.ctbFiltro = novo;
    ctbRenderizarPendencias(moduleEl);
}

/**
 * O cartão de erros críticos, documentais ou avisos: filtra a lista (sem o
 * vai-e-volta do chip — clicar de novo continua no mesmo filtro) e a tela
 * rola, suave, até o cartão das pendências, com a lista no começo.
 */
function ctbIrParaPendencias(moduleEl, nivel) {
    const atual = moduleEl.ctbFiltro || { nivel: 'todas', fonte: null };
    moduleEl.ctbFiltro = { ...atual, nivel: nivel || 'todas' };
    ctbRenderizarPendencias(moduleEl);
    const lista = moduleEl.querySelector('[data-ctb-lista="pendencias"]');
    if (lista) lista.scrollTop = 0;
    ctbRolarAte(moduleEl.querySelector('#ctbPendenciasPainel'));
}

/**
 * Um cartão do "Checklist por fonte": a lista mostra só as pendências da
 * fonte (todos os níveis) e a tela rola até o cartão das pendências, como
 * nos cartões do alto. Clicar de novo mantém o filtro (o chip da fonte tira).
 */
function ctbIrParaFonte(moduleEl, fonte) {
    moduleEl.ctbFiltro = { nivel: 'todas', fonte: fonte || null };
    ctbRenderizarPendencias(moduleEl);
    const lista = moduleEl.querySelector('[data-ctb-lista="pendencias"]');
    if (lista) lista.scrollTop = 0;
    ctbRolarAte(moduleEl.querySelector('#ctbPendenciasPainel'));
}

/** Rola a tela até o elemento, suave (sem animação para quem pediu menos movimento). */
function ctbRolarAte(alvo) {
    if (!alvo || typeof alvo.scrollIntoView !== 'function') return;
    const reduzir = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    alvo.scrollIntoView({ behavior: reduzir ? 'auto' : 'smooth', block: 'start' });
}

/* --------------------------------------------------------- mensagens */

/**
 * O que o "'" oferece enquanto se digita: as pendências da competência na
 * tela (já lidas) e o resto do módulo pelo backend. Sem permissão ou sem
 * rede, fica só o que é local. O ícone de cada tipo vem do componente
 * (HistoricoSocial.ICONES_OBJETO).
 */
async function ctbObjetosCitaveis(busca) {
    const raiz = document.querySelector('.modulo-container.contabilidade-module');
    const competencia = raiz?.querySelector('#ctbCompetencia')?.value || '';
    const locais = ctbCitaveisLocais(raiz?.ctbDados?.pendencias, competencia, busca);
    const { corpo } = await ctbChamarApi(`/api/contabilidade/citaveis?busca=${encodeURIComponent(busca || '')}&competencia=${encodeURIComponent(competencia)}`);
    const remotos = Array.isArray(corpo?.itens) ? corpo.itens : [];
    // A competência vem primeiro; as pendências logo depois; o resto na ordem do backend.
    // (no máximo 5 pendências, para os documentos e as contas também caberem na lista).
    const [comp, resto] = [remotos.filter(o => o.tipo === 'competencia'), remotos.filter(o => o.tipo !== 'competencia')];
    return [...comp, ...locais.slice(0, 5), ...resto];
}

/** Leva a tela para uma competência (e espera o painel dela). */
async function ctbIrParaCompetencia(moduleEl, competencia) {
    const campo = moduleEl?.querySelector('#ctbCompetencia');
    if (!campo || !/^\d{4}-\d{2}$/.test(String(competencia || ''))) return;
    if (campo.value !== competencia) {
        if (window.Competencia) window.Competencia.definir(campo, competencia);
        else campo.value = competencia;
        moduleEl.ctbFiltro = { nivel: 'todas', fonte: null };
        await ctbRecarregar(moduleEl);
    }
}

/**
 * Abre o objeto citado numa mensagem. Documento, conta, lançamento, pacote,
 * fechamento e contas abrem o modal deles (por cima das mensagens, quando
 * elas estão no modal grande); competência e pendência levam a própria tela
 * até lá; arquivo abre no programa do computador; fornecedor abre a ficha
 * em Contatos.
 */
async function ctbAbrirObjeto(objeto, { doModal = false } = {}) {
    const raiz = document.querySelector('.modulo-container.contabilidade-module');
    if (!objeto || !raiz) return;
    const id = String(objeto.id ?? '');
    const empilhar = doModal;
    const abrir = (chave, extra = {}) => ctbAbrirModal(chave, raiz, { ...extra, empilhar });
    // Os que mexem na própria tela fecham o modal grande antes.
    const naTela = async fn => {
        if (doModal) window.Modal?.close?.('ctbMensagens');
        await fn();
    };
    switch (objeto.tipo) {
        case 'competencia':
            await naTela(async () => {
                await ctbIrParaCompetencia(raiz, id);
                ctbRolarAte(raiz.querySelector('.ctb-kpis'));
            });
            return;
        case 'pendencia': {
            const [competencia, chave] = [id.slice(0, 7), id.slice(8)];
            await naTela(async () => {
                await ctbIrParaCompetencia(raiz, competencia);
                const pendencia = (raiz.ctbDados?.pendencias || []).find(p => p.chave === chave);
                raiz.ctbFiltro = { nivel: pendencia?.ignorada ? 'ignoradas' : 'todas', fonte: null };
                ctbRenderizarPendencias(raiz);
                ctbRolarAte(raiz.querySelector('#ctbPendenciasPainel'));
                const linha = [...raiz.querySelectorAll('.ctb-pendencia')].find(li => li.dataset.chave === chave);
                if (!linha) {
                    window.showToast?.('Esta pendência não aparece mais nesta competência: já foi resolvida.', 'info');
                    return;
                }
                linha.scrollIntoView({ block: 'nearest' });
                linha.classList.add('is-destaque');
                setTimeout(() => linha.classList.remove('is-destaque'), 2600);
            });
            return;
        }
        // O id traz o que é preciso para abrir (backend/contabilidade/citaveis.js).
        case 'documento': abrir('documento-recebido', { documento_id: Number(id) }); return;
        case 'titulo': abrir('conta-pagar', { titulo_id: Number(id) }); return;
        case 'movimento': abrir('dossie', { tipo: 'movimento', id: Number(id) }); return;
        case 'fechamento': abrir('fechamentos', { competencia: id.slice(0, 7) }); return;
        case 'pacote': abrir('pacote', { competencia: id.slice(0, 7) }); return;
        case 'conta_plano': abrir('plano-contas'); return;
        case 'conta_financeira': abrir('extrato', { conta_id: Number(id) }); return;
        case 'importacao': {
            const [conta, competencia] = id.split(':');
            abrir('extrato', { conta_id: Number(conta), ...(/^\d{4}-\d{2}$/.test(competencia || '') ? { competencia } : {}) });
            return;
        }
        case 'arquivo': await ctbAbrirArquivo(id); return;
        case 'fornecedor':
            if (doModal) window.Modal?.close?.('ctbMensagens');
            await window.loadPage?.('contatos');
            window.ContatosModulo?.abrirDetalhes?.({ id: Number(id) });
            return;
        default:
            window.showToast?.('Não sei abrir este item.', 'info');
    }
}

// Contatos também cita documentos e contas (o "'" da ficha) e abre por aqui.
window.ContabilidadeAbrirObjeto = (objeto, opcoes) => ctbAbrirObjeto(objeto, opcoes);

/** O arquivo guardado na Contabilidade, aberto no programa do computador. */
async function ctbAbrirArquivo(id) {
    window.showToast?.('Abrindo o arquivo…', 'info');
    const { corpo, erro } = await ctbChamarApi(`/api/contabilidade/arquivos/${encodeURIComponent(id)}`);
    if (erro || !corpo?.base64) {
        window.showToast?.(erro?.status === 404 ? 'O arquivo não existe mais.' : (erro?.message || 'Não foi possível abrir o arquivo.'), 'error');
        return;
    }
    const r = await window.electronAPI?.salvarArquivoBinario?.({ base64: corpo.base64, nomeSugerido: corpo.nome, abrir: true, titulo: 'Abrir arquivo' });
    if (r && !r.success && !r.canceled) window.showToast?.(r.message || 'Não foi possível abrir o arquivo.', 'error');
}

/** As opções do social da Contabilidade (o cartão e o modal grande usam as mesmas). */
function ctbOpcoesMensagens({ doModal = false, foco = null } = {}) {
    return {
        origem: 'contabilidade',
        registroId: CTB_MURAL,
        foco,
        objetos: ctbObjetosCitaveis,
        aoAbrirObjeto: objeto => ctbAbrirObjeto(objeto, { doModal }),
        textos: {
            placeholder: "Escreva uma mensagem… (@ menciona alguém · ' cita um item · Ctrl+Enter publica)",
            publicar: 'Publicar', publicado: 'Mensagem publicada.', vazio: 'Nenhuma mensagem ainda. Escreva a primeira.', etiqueta: 'Mensagem',
            sqlPendente: 'As mensagens ainda não estão ativadas: rode sql/contabilidade_mensagens.sql no banco e reinicie a API.',
            citarObjetos: 'Citar um item da Contabilidade — abre ao clicar'
        }
    };
}
window.ContabilidadeMensagensOpcoes = ctbOpcoesMensagens;
window.ContabilidadeAbrirMensagens = foco => ctbAbrirModal('mensagens', null, { foco: foco || null });

function ctbMontarMensagens(moduleEl) {
    const alvo = moduleEl.querySelector('[data-ctb-mensagens]');
    if (!alvo || typeof window.HistoricoSocial?.montar !== 'function') return;
    moduleEl.ctbMensagens = window.HistoricoSocial.montar(alvo, ctbOpcoesMensagens());
}

/** A pendência vem do Financeiro: abre o módulo (o filtro dela fica para a etapa que ligar os dois). */
async function ctbIrParaFinanceiro(extra) {
    if (typeof window.loadPage === 'function') {
        await window.loadPage('financeiro');
        const acao = extra?.pendencia?.filtro?.acao;
        if (acao) window.showToast?.(`No Financeiro, use "${CTB_ACOES_FINANCEIRO[acao] || acao}" para resolver.`, 'info');
        return;
    }
    window.showToast?.('Abra o módulo Financeiro para resolver esta pendência.', 'info');
}

/* Nome humano das ações do Financeiro para a dica ao trocar de módulo. */
const CTB_ACOES_FINANCEIRO = {
    'notas-fiscais': 'Notas fiscais',
    'aguardando-nf': 'Emitir NF-e',
    'fechar-competencia': 'Fechar competência — comissões',
    'fechar-competencia-producao': 'Fechar competência — produção',
    'confirmar-pagamento': 'Confirmar pagamento',
    'confirmar-reembolso': 'Confirmar reembolso',
    'reaplicar-devolucao': 'Tentar de novo (devolução)',
    'recebimentos-atraso': 'Recebimentos em atraso',
    'recebimentos-a-receber': 'Recebimentos a receber',
    'recebimentos-recebidos': 'Recebimentos',
    'conciliar': 'Conciliar BB',
    'configuracao-cobranca': 'Configuração de cobrança'
};

async function ctbRestaurarPendencia(moduleEl, pendencia) {
    if (!pendencia) return;
    const competencia = moduleEl.querySelector('#ctbCompetencia')?.value || null;
    const confirmado = window.DialogPadrao?.confirm
        ? await window.DialogPadrao.confirm({ title: 'Restaurar a pendência?', message: `"${pendencia.titulo}" volta a contar como ${(CTB_NIVEIS[pendencia.nivel]?.rotulo || 'pendência').toLowerCase()}.`, confirmText: 'Restaurar' })
        : window.confirm(`Restaurar "${pendencia.titulo}"?`);
    if (!confirmado) return;
    const { erro } = await ctbChamarApi('/api/contabilidade/pendencias/restaurar', { method: 'POST', body: JSON.stringify({ competencia, chave: pendencia.chave }) });
    if (erro) {
        window.showToast?.(erro.status === 403 ? 'Você não tem permissão para mexer nas pendências.' : erro.message, 'error');
        return;
    }
    window.showToast?.('Pendência restaurada.', 'success');
    ctbRecarregar(moduleEl);
}

/** Relê o painel da competência escolhida e redesenha. Os modais chamam ao fechar. */
function ctbRecarregar(moduleEl) {
    const raiz = moduleEl || document.querySelector('.modulo-container.contabilidade-module');
    if (!raiz) return Promise.resolve();
    const competencia = raiz.querySelector('#ctbCompetencia')?.value || null;
    const promessa = ctbCarregarDados(competencia)
        .then(dados => {
            raiz.ctbAtividade = dados.atividade;
            ctbRenderizar(raiz, dados, raiz.dataset.hoje);
        })
        .catch(erro => {
            console.error('[contabilidade] não foi possível montar a tela:', erro);
            window.showToast?.('Não foi possível carregar a Contabilidade agora.', 'error');
        });
    raiz.moduleReadyPromise = promessa;
    return promessa;
}
window.ContabilidadeRecarregar = () => ctbRecarregar(null);

/* --------------------------------------------------------------- init */

function ctbLigarAcoes(moduleEl) {
    // Um ouvinte só, por delegação: cartões, chips, linhas de pendência, botões
    // e links trazem `data-ctb-acao`. O botão dentro da linha vence a linha.
    const extraDe = alvo => {
        const extra = {};
        if (alvo.dataset.ctbFiltro) extra.filtro = alvo.dataset.ctbFiltro;
        if (alvo.dataset.ctbFonte !== undefined) extra.fonte = alvo.dataset.ctbFonte || null;
        if (alvo.ctbPendencia) extra.pendencia = alvo.ctbPendencia;
        if (alvo.classList.contains('ctb-kpi')) extra.cartao = true;
        return extra;
    };
    moduleEl.addEventListener('click', evento => {
        const alvo = evento.target.closest('[data-ctb-acao]');
        if (!alvo || !moduleEl.contains(alvo) || alvo.disabled) return;
        evento.stopPropagation();
        ctbExecutarAcao(alvo.dataset.ctbAcao, moduleEl, extraDe(alvo));
    });
    moduleEl.addEventListener('keydown', evento => {
        if (evento.key !== 'Enter' && evento.key !== ' ') return;
        const alvo = evento.target.closest('[data-ctb-acao][role="button"]');
        if (!alvo) return;
        evento.preventDefault();
        ctbExecutarAcao(alvo.dataset.ctbAcao, moduleEl, extraDe(alvo));
    });
}

function ctbCompetenciaAtual(hoje) {
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

function ctbDiaDe(hoje) {
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
}

function ctbIniciar(moduleEl) {
    if (moduleEl.dataset.iniciado === '1') return;
    moduleEl.dataset.iniciado = '1';

    const hoje = new Date();
    moduleEl.dataset.hoje = ctbDiaDe(hoje);
    moduleEl.ctbFiltro = { nivel: 'todas', fonte: null };
    const campo = moduleEl.querySelector('#ctbCompetencia');
    // A competência que se fecha é, quase sempre, o mês passado: a tela abre nele.
    const inicial = ctbCompetenciaAtual(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1));
    if (window.Competencia) window.Competencia.montar(campo, { valor: inicial });
    else if (campo) campo.value = inicial;
    campo?.addEventListener('change', () => {
        moduleEl.ctbFiltro = { nivel: 'todas', fonte: null };
        ctbRecarregar(moduleEl);
    });
    moduleEl.querySelector('#ctbHoje')?.addEventListener('click', () => {
        if (!campo) return;
        if (window.Competencia) window.Competencia.definir(campo, ctbCompetenciaAtual(hoje));
        else campo.value = ctbCompetenciaAtual(hoje);
        ctbRecarregar(moduleEl);
    });

    ctbLigarAcoes(moduleEl);

    // O menu espera esta promessa antes de tirar a máscara de carregamento.
    ctbRecarregar(moduleEl);
    // As mensagens carregam sozinhas (e ficam ao vivo, a cada 10 s).
    ctbMontarMensagens(moduleEl);
}

(function ctbBoot() {
    const moduleEl = document.querySelector('.modulo-container.contabilidade-module');
    if (moduleEl) ctbIniciar(moduleEl);
})();
