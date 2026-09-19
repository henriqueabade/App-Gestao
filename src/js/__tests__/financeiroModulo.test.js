/**
 * Módulo Financeiro — Comissões e Produção (src/js/financeiro.js).
 *
 * A tela é montada a partir de três painéis reais (fiscal, recebimentos e
 * comissões/produção) e ação sem função real abre o aviso "em
 * implementação". Os testes prendem as
 * regras que não fazem barulho quando quebram: formatação de dinheiro e data
 * (um dia a menos em São Paulo se a data passar por new Date), o preenchimento
 * de TODOS os campos `data-fin` do HTML, e o ciclo de vida do módulo (o menu
 * reexecuta o script a cada visita — nada pode se acumular em `document`).
 */
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARQUIVO_JS = path.join(__dirname, '..', 'financeiro.js');
const ARQUIVO_HTML = path.join(__dirname, '..', '..', 'html', 'financeiro.html');
const ARQUIVO_CSS = path.join(__dirname, '..', '..', 'css', 'financeiro.css');
const FONTE_JS = fs.readFileSync(ARQUIVO_JS, 'utf8');
const FONTE_HTML = fs.readFileSync(ARQUIVO_HTML, 'utf8');
const FONTE_CSS = fs.readFileSync(ARQUIVO_CSS, 'utf8');

/** Elemento mínimo: só o que financeiro.js usa ao montar a tela. */
function criarElemento(tag) {
    const el = {
        tagName: String(tag).toUpperCase(),
        className: '',
        textContent: '',
        dataset: {},
        attributes: {},
        children: [],
        value: '',
        selected: false,
        tabIndex: -1,
        parent: null,
        setAttribute(nome, valor) { el.attributes[nome] = String(valor); },
        appendChild(filho) { filho.parent = el; el.children.push(filho); return filho; },
        append(...filhos) { filhos.forEach(f => el.appendChild(f)); },
        replaceChildren(...filhos) { el.children = []; el.append(...filhos); },
        addEventListener(tipo, fn) { (el.ouvintes ||= {})[tipo] = [...(el.ouvintes?.[tipo] || []), fn]; },
        contains(outro) { for (let n = outro; n; n = n.parent) if (n === el) return true; return false; },
        closest(seletor) {
            for (let n = el; n; n = n.parent) if (casa(n, seletor)) return n;
            return null;
        },
        querySelector(seletor) { return todos(el).find(n => casa(n, seletor)) || null; },
        querySelectorAll(seletor) { return todos(el).filter(n => casa(n, seletor)); }
    };
    return el;
}

function todos(raiz) {
    const saida = [];
    (function andar(n) { for (const f of n.children) { saida.push(f); andar(f); } })(raiz);
    return saida;
}

/** Seletores que a tela usa: #id, [data-x="y"], [data-x], .classe, e combinações simples. */
function casa(el, seletor) {
    return seletor.split(',').some(parte => {
        const s = parte.trim();
        const id = /^#([\w-]+)$/.exec(s);
        if (id) return el.attributes.id === id[1];
        const attrVal = /^\[data-([\w-]+)="([^"]*)"\](\[role="button"\])?$/.exec(s);
        if (attrVal) {
            const chave = attrVal[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            if (el.dataset[chave] !== attrVal[2]) return false;
            return attrVal[3] ? el.attributes.role === 'button' : true;
        }
        const attr = /^\[data-([\w-]+)\]$/.exec(s);
        if (attr) return el.dataset[attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] !== undefined;
        const classes = /^\.([\w.-]+)$/.exec(s);
        if (classes) return classes[1].split('.').every(c => el.className.split(/\s+/).includes(c));
        return false;
    });
}

/** Monta o .modulo-container a partir dos `data-fin` do HTML real. */
function montarModuloDoHtml() {
    const modulo = criarElemento('div');
    modulo.className = 'modulo-container financeiro-module';
    for (const m of FONTE_HTML.matchAll(/data-fin="([^"]+)"/g)) {
        const alvo = criarElemento('span');
        alvo.dataset.fin = m[1];
        alvo.textContent = '—';
        modulo.appendChild(alvo);
    }
    for (const m of FONTE_HTML.matchAll(/data-fin-lista="([^"]+)"/g)) {
        const lista = criarElemento('ul');
        lista.dataset.finLista = m[1];
        modulo.appendChild(lista);
    }
    for (const id of ['finCompetencia', 'finHoje', 'finAtualizar']) {
        const el = criarElemento(id === 'finCompetencia' ? 'select' : 'button');
        el.attributes.id = id;
        modulo.appendChild(el);
    }
    return modulo;
}

/** 'YYYY-MM-DD' de hoje, como o módulo calcula (relógio local). */
function hojeTexto() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** O painel fiscal que o backend devolve (GET /api/fiscal/painel), no formato de backend/fiscal/painel.js. */
function painelFalso() {
    return {
        competencia: '2026-09', desde: '2026-09-01', ambiente: 'homologacao',
        certificado: { configurado: true, vencido: false, venceEmBreve: false, diasRestantes: 59 },
        aguardando_nf: { quantidade: 2, total: 1900, dispensados: 1, pedidos: [] },
        notas: { competencia: '2026-09', emitidas: 3, autorizadas: 1, canceladas: 0, processando: 1, rejeitadas: 1, valor_autorizado: 800 },
        pendencias: [
            { nivel: 'critico', chave: 'processando', titulo: '1 nota aguardando resposta da SEFAZ', descricao: 'NF-e 1/3 — consulte para concluir a autorização', data: '2026-09-16', acao: 'Consultar', destino: 'notas-fiscais', filtro: { status: 'processando' } },
            { nivel: 'normal', chave: 'aguardando_nf', titulo: '2 pedidos enviados sem NF-e', descricao: 'Total: R$ 1.900,00', data: '2026-09-10', acao: 'Emitir', destino: 'aguardando-nf' }
        ],
        atividade: [
            { quando: `${hojeTexto()}T14:32:00-03:00`, tipo: 'autorizada', titulo: 'NF-e 1/5 autorizada', detalhe: 'Pedido 2548 • R$ 21.500,00', nota_id: 5 },
            { quando: '2026-09-15T09:00:00-03:00', tipo: 'cce', titulo: 'Carta de correção 1 da NF-e 1/4', detalhe: 'Pedido 2521', nota_id: 4 }
        ]
    };
}

/** O painel de recebimentos que o backend devolve (GET /api/cobranca/recebimentos/painel), no formato de backend/cobranca/contasReceber.js. */
function receberFalso(extra = {}) {
    return {
        competencia: '2026-09', desde: '2026-09-01', sql_pendente: false,
        recebido: { quantidade: 3, total: 3010.5, encargos: 10.5, estornados: 1 },
        a_receber: { quantidade: 2, total: 1900 },
        em_atraso: { quantidade: 1, total: 300, mais_antigo: '2026-09-05', dias_max: 11 },
        boletos_abertos: { quantidade: 1, total: 900 },
        a_conciliar: { fila: 0, lancamentos: 0, alertas: 0 },
        pendencias: [
            { nivel: 'normal', chave: 'em_atraso', titulo: '1 parcela vencida sem recebimento', descricao: 'Total: R$ 300,00 · mais antiga venceu em 05/09/2026', data: '2026-09-05', acao: 'Ver', destino: 'recebimentos-atraso' },
            { nivel: 'critico', chave: 'boletos_erro', titulo: '1 boleto recusado pelo BB', descricao: 'Pedido PED103, parcela 1: 4678420', data: '2026-09-05', acao: 'Ver', destino: 'recebimentos-a-receber' }
        ],
        ...extra
    };
}

/** O painel de comissões e produção (GET /api/financeiro/painel), no formato de backend/financeiro/painel.js. */
function comissoesFalso(extra = {}) {
    return {
        competencia: '2026-09', tem_regras: true,
        configuracao: { comissao_dia_pagamento: 15, producao_dia_util: 5, sabado_dia_util: false },
        comissoes: { situacao: 'aberta', valor: 18450, total: 18450, pago: 0, parcelas: 12, pagar_ate: '2026-10-15', pago_em: null },
        atrasadas: { valor: 7320, parcelas: 11 },
        producao: { situacao: 'fechada', valor: 9870, total: 9870, pago: 0, pecas: 327, pagar_ate: '2026-10-07', dia_util: 5, pago_em: null },
        resumo_comissoes: { previstas: 32500, apuradas: 18450, atrasadas: 7320, ajustes: -840, ajustes_manuais: { quantidade: 2, valor: 3000, comissao: 600 }, proximo_pagamento: '2026-10-15', situacao: 'aberta' },
        resumo_producao: { em_producao: 21, parciais: 8, pecas_mes: 327, valor: 9870, proximo_pagamento: '2026-10-07', dia_util: 5, situacao: 'fechada' },
        pendencias: [],
        atividade: [],
        ...extra
    };
}

/**
 * Carrega o módulo. `painel` é o que GET /api/fiscal/painel devolve,
 * `receber` o que GET /api/cobranca/recebimentos/painel devolve e
 * `comissoes` o que GET /api/financeiro/painel devolve (padrão: sem
 * pendências); `statusHttp` diferente de 200 simula a recusa (403 sem
 * permissão). Sem `painel`, não há apiConfig nem fetch — como no teste que
 * só olha funções.
 */
function carregar({ modulo = null, painel = undefined, receber = undefined, comissoes = undefined, statusHttp = 200, conciliacao = null } = {}) {
    const avisos = [];
    const chamadas = [];
    const documento = {
        createElement: criarElemento,
        querySelector: seletor => (modulo && casa(modulo, seletor) ? modulo : null),
        querySelectorAll: () => [],
        addEventListener: () => { throw new Error('financeiro.js não pode registrar ouvinte em document'); }
    };
    const contexto = {
        window: {
            DialogPadrao: { info: opcoes => { avisos.push(opcoes); return Promise.resolve(true); } },
            showToast: () => {}
        },
        document: documento,
        console: { log() {}, warn() {}, error() {}, info() {} },
        Intl,
        Number,
        Date,
        String,
        Math,
        Promise
    };
    if (painel !== undefined) {
        contexto.window.apiConfig = { getApiBaseUrl: async () => 'http://api.teste' };
        const deReceber = receber === undefined ? receberFalso({ pendencias: [] }) : receber;
        const deComissoes = comissoes === undefined ? comissoesFalso() : comissoes;
        contexto.fetch = async (url, opcoes = {}) => {
            chamadas.push(opcoes.method === 'POST' ? `POST ${url} ${opcoes.body}` : url);
            const corpo = url.includes('/api/cobranca/conciliar') ? conciliacao
                : (url.includes('/api/cobranca/recebimentos/painel') ? deReceber
                    : (url.includes('/api/financeiro/painel') ? deComissoes : painel));
            return { ok: statusHttp === 200, status: statusHttp, json: async () => (statusHttp === 200 ? corpo : { error: 'Sem permissão' }) };
        };
    }
    contexto.globalThis = contexto;
    vm.createContext(contexto);
    vm.runInContext(`(function(){\n${FONTE_JS}\n})();`, contexto);
    return { avisos, contexto, chamadas };
}

/** Expõe as funções de nível superior sem depender do embrulho do menu. */
function funcoes() {
    return funcoesCom({});
}

/** O mesmo, com pedaços do `window` trocados (ex.: o utilitário de competência). */
function funcoesCom(extra = {}) {
    const contexto = {
        window: { DialogPadrao: { info: () => Promise.resolve(true) }, ...(extra.window || {}) },
        document: { createElement: criarElemento, querySelector: () => null },
        console: { log() {}, warn() {}, error() {}, info() {} },
        Intl, Number, Date, String, Math, Promise
    };
    contexto.globalThis = contexto;
    vm.createContext(contexto);
    vm.runInContext(FONTE_JS, contexto);
    return nome => vm.runInContext(nome, contexto);
}

test('dinheiro sai em pt-BR e o negativo leva o sinal antes do símbolo, como na descrição', () => {
    const f = funcoes();
    const formatar = f('finFormatarMoeda');
    assert.strictEqual(formatar(18450).replace(/ /g, ' '), 'R$ 18.450,00');
    assert.strictEqual(formatar(-840).replace(/ /g, ' '), '- R$ 840,00');
    assert.strictEqual(formatar(null), '—');
});

test('data DATE vira dd/mm/aaaa por corte de texto, sem passar por new Date', () => {
    const f = funcoes();
    const formatar = f('finFormatarData');
    assert.strictEqual(formatar('2026-10-15'), '15/10/2026');
    assert.strictEqual(formatar('2026-10-15T00:00:00.000Z'), '15/10/2026');
    assert.strictEqual(formatar(''), '—');
    assert.doesNotMatch(FONTE_JS.replace(/const hoje = new Date\(\);/, ''), /new Date\(/,
        'só o relógio do módulo pode usar new Date');
});

test('competência: o seletor é mês + ano + lupa (utilitário compartilhado), e o mês atual já vem escolhido', () => {
    const f = funcoes();
    // Sem o utilitário carregado, o campo ainda guarda a competência de hoje.
    const campo = criarElemento('input');
    f('finMontarCompetencias')(campo, new Date(2026, 0, 15));
    assert.strictEqual(campo.value, '2026-01');

    // Com ele, quem monta o seletor é o utilitário (mesma casa do módulo e dos modais).
    const chamadas = [];
    const contexto = { window: { Competencia: { montar: (c, o) => chamadas.push([c, o]), definir: (c, v) => { c.value = v; } } } };
    const comUtil = funcoesCom(contexto);
    const campo2 = criarElemento('input');
    comUtil('finMontarCompetencias')(campo2, new Date(2026, 0, 15));
    assert.strictEqual(chamadas.length, 1, 'o módulo delega para window.Competencia');
    assert.strictEqual(chamadas[0][1].valor, '2026-01');

    // O HTML tem os três controles e o valor continua no id de sempre.
    assert.match(FONTE_HTML, /<select id="finCompetenciaMes" data-competencia-mes/);
    assert.match(FONTE_HTML, /<input id="finCompetenciaAno" data-competencia-ano/);
    assert.match(FONTE_HTML, /<button id="finCompetenciaIr" data-competencia-ir/);
    assert.match(FONTE_HTML, /<input type="hidden" id="finCompetencia" \/>/);
    const mes = FONTE_HTML.indexOf('id="finCompetenciaMes"');
    const ano = FONTE_HTML.indexOf('id="finCompetenciaAno"');
    const lupa = FONTE_HTML.indexOf('id="finCompetenciaIr"');
    assert.ok(mes < ano && ano < lupa, 'mês à esquerda do ano, e a lupa depois dos dois');
});

test('a tela preenche TODOS os campos data-fin: fiscal, contas a receber, comissões e produção vêm dos painéis reais', async () => {
    const modulo = montarModuloDoHtml();
    const { chamadas } = carregar({ modulo, painel: painelFalso() });
    await modulo.moduleReadyPromise;
    const competencia = hojeTexto().slice(0, 7);
    assert.deepStrictEqual(chamadas, [
        `http://api.teste/api/fiscal/painel?competencia=${competencia}`,
        `http://api.teste/api/cobranca/recebimentos/painel?competencia=${competencia}`,
        `http://api.teste/api/financeiro/painel?competencia=${competencia}`
    ], 'os três painéis são lidos na competência selecionada');

    const vazios = modulo.querySelectorAll('[data-fin]').filter(el => el.textContent === '—' || el.textContent === '');
    assert.deepStrictEqual(vazios.map(el => el.dataset.fin), [], 'campos ainda com o marcador inicial');

    const valores = Object.fromEntries(modulo.querySelectorAll('[data-fin]').map(el => [el.dataset.fin, el.textContent.replace(/ /g, ' ')]));
    assert.strictEqual(valores['nf.valor'], '2');
    assert.strictEqual(valores['nf.auxiliar'], 'pedidos');
    assert.strictEqual(valores['nf.rodape'], 'Total: R$ 1.900,00 · enviados desde 01/09/2026 · 1 sem NF-e (S/NF)');
    assert.strictEqual(valores['comissoes.valor'], 'R$ 18.450,00');
    assert.strictEqual(valores['comissoes.auxiliar'], '12 parcelas');
    assert.strictEqual(valores['comissoes.rodape'], 'Pagamento até 15/10/2026');
    assert.strictEqual(valores['atrasadas.valor'], 'R$ 7.320,00');
    assert.strictEqual(valores['atrasadas.rodape'], 'Aguardando recebimento');
    assert.strictEqual(valores['producao.auxiliar'], '327 peças finalizadas');
    assert.strictEqual(valores['producao.rodape'], 'Fechada · pagar até 07/10/2026 (5º dia útil)');
    // O cartão diz o que FALTA pagar e de quanto era a competência.
    assert.strictEqual(valores['comissoes.total'], '/ R$ 18.450,00');
    assert.strictEqual(valores['producao.total'], '/ R$ 9.870,00');
    // Ajustes: o estorno do que já estava fechado (-840) mais a comissão que os
    // ajustes à mão tiraram das parcelas do mês (-600), com quantos são.
    assert.strictEqual(valores['resumoComissoes.ajustes'], '- R$ 1.440,00');
    assert.strictEqual(valores['resumoComissoes.ajustesQuantidade'], '(2 manuais · R$ 3.000,00)');
    assert.strictEqual(valores['resumoComissoes.proximoPagamento'], '15/10/2026');
    assert.strictEqual(valores['resumoProducao.emProducao'], '21');
    assert.strictEqual(valores['resumoProducao.proximoPagamento'], '07/10/2026 (5º dia útil) · fechada');
    assert.strictEqual(valores['pendencias.total'], '2');

    const pendencias = modulo.querySelector('[data-fin-lista="pendencias"]').children;
    assert.strictEqual(pendencias.length, 2);
    assert.strictEqual(pendencias[0].children[0].dataset.nivel, 'critico', 'nota parada na SEFAZ é crítica (bordô)');
    assert.strictEqual(pendencias[1].children[0].dataset.nivel, 'normal');
    assert.strictEqual(pendencias[0].children[3].textContent, 'Consultar');
    assert.strictEqual(pendencias[0].children[3].dataset.finAcao, 'notas-fiscais');
    assert.strictEqual(pendencias[0].children[3].dataset.finFiltro, '{"status":"processando"}', 'a pendência abre a lista de notas já filtrada');
    assert.strictEqual(pendencias[1].children[3].textContent, 'Emitir');
    assert.strictEqual(pendencias[1].dataset.finAcao, 'aguardando-nf');
    assert.strictEqual(pendencias[1].children[2].textContent, '10/09/2026');

    const eventos = modulo.querySelector('[data-fin-lista="atividade"]').children;
    assert.strictEqual(eventos.length, 2);
    assert.strictEqual(eventos[0].children[0].textContent, '14:32', 'hoje: só a hora');
    assert.strictEqual(eventos[1].children[0].textContent, '15/09', 'outro dia: dia/mês');
    assert.strictEqual(eventos[0].children[1].children[0].textContent, 'NF-e 1/5 autorizada');

    // Contas a receber.
    assert.strictEqual(valores['receber.nota'], 'Parcelas controladas a partir de 01/09/2026');
    assert.strictEqual(valores['receber.recebido.valor'], 'R$ 3.010,50');
    assert.strictEqual(valores['receber.recebido.auxiliar'], '3 recebimentos');
    assert.strictEqual(valores['receber.recebido.rodape'], 'Inclui juros e multa R$ 10,50 · 1 estornado');
    assert.strictEqual(valores['receber.aReceber.valor'], 'R$ 1.900,00');
    assert.strictEqual(valores['receber.aReceber.auxiliar'], '2 parcelas');
    assert.strictEqual(valores['receber.atraso.valor'], 'R$ 300,00');
    assert.strictEqual(valores['receber.atraso.rodape'], 'Mais antiga venceu em 05/09/2026 (11 dias)');
    assert.strictEqual(valores['receber.boletos.auxiliar'], '1 boleto');
    assert.strictEqual(valores['receber.boletos.rodape'], 'Registrados no BB, aguardando pagamento');
});

test('as pendências de cobrança entram na mesma lista: críticas primeiro, fiscal antes de cobrança', async () => {
    const modulo = montarModuloDoHtml();
    carregar({ modulo, painel: painelFalso(), receber: receberFalso() });
    await modulo.moduleReadyPromise;
    const titulos = modulo.querySelector('[data-fin-lista="pendencias"]').children.map(l => l.children[1].children[0].textContent);
    assert.deepStrictEqual(titulos, ['1 nota aguardando resposta da SEFAZ', '1 boleto recusado pelo BB', '2 pedidos enviados sem NF-e', '1 parcela vencida sem recebimento']);
    assert.strictEqual(modulo.querySelector('[data-fin="pendencias.total"]').textContent, '4');
    const atraso = modulo.querySelector('[data-fin-lista="pendencias"]').children[3];
    assert.strictEqual(atraso.dataset.finAcao, 'recebimentos-atraso');
});

test('comissões e produção: pendências entram na lista (com tipo e competência), a atividade se junta à fiscal e sem SQL a tela diz o arquivo', async () => {
    const modulo = montarModuloDoHtml();
    const comissoes = comissoesFalso({
        pendencias: [
            { nivel: 'normal', chave: 'sem_regras', titulo: 'Regras de CMS e Royalty não cadastradas', descricao: 'x', data: '2026-09-16', acao: 'Cadastrar', destino: 'regras' },
            { nivel: 'critico', chave: 'fechar_comissao', titulo: 'Comissões de agosto/2026 prontas para fechamento', descricao: 'y', data: '2026-09-15', acao: 'Conferir', destino: 'fechar-competencia', filtro: { tipo: 'comissao', competencia: '2026-08' } }
        ],
        atividade: [
            { quando: `${hojeTexto()}T15:00-03:00`, titulo: 'Competência fechada', detalhe: 'Comissões de agosto/2026' },
            { quando: '2026-09-14T08:00-03:00', titulo: 'Ajuste registrado', detalhe: 'Devolução' }
        ]
    });
    carregar({ modulo, painel: painelFalso(), comissoes });
    await modulo.moduleReadyPromise;
    const linhas = modulo.querySelector('[data-fin-lista="pendencias"]').children;
    assert.deepStrictEqual(linhas.map(l => l.children[1].children[0].textContent), [
        '1 nota aguardando resposta da SEFAZ', 'Comissões de agosto/2026 prontas para fechamento',
        '2 pedidos enviados sem NF-e', 'Regras de CMS e Royalty não cadastradas'
    ]);
    assert.strictEqual(linhas[1].children[3].dataset.finFiltro, '{"tipo":"comissao","competencia":"2026-08"}');
    const eventos = modulo.querySelector('[data-fin-lista="atividade"]').children;
    assert.deepStrictEqual(eventos.map(e => e.children[1].children[0].textContent),
        ['Competência fechada', 'NF-e 1/5 autorizada', 'Carta de correção 1 da NF-e 1/4', 'Ajuste registrado'], 'mais recentes primeiro');

    const semSql = montarModuloDoHtml();
    const r = carregar({ modulo: semSql, painel: painelFalso() });
    r.contexto.fetch = async url => (url.includes('/api/financeiro/painel')
        ? { ok: false, status: 409, json: async () => ({ error: 'Falta rodar', sql_pendente: true }) }
        : { ok: true, status: 200, json: async () => (url.includes('/recebimentos/') ? receberFalso({ pendencias: [] }) : painelFalso()) });
    await r.contexto.window.FinanceiroRecarregar?.();
    await semSql.moduleReadyPromise;
    const valores = Object.fromEntries(semSql.querySelectorAll('[data-fin]').map(el => [el.dataset.fin, el.textContent]));
    assert.strictEqual(valores['comissoes.rodape'], 'Falta ativar: rode sql/financeiro_comissoes_producao.sql e reinicie a API.');

    const f = funcoes();
    const filtro = f('finDoFiltro');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(filtro({ filtro: { tipo: 'producao', competencia: '2026-08', outro: 1 } }))), { tipo: 'producao', competencia: '2026-08' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(filtro({ filtro: { tipo: 'x', competencia: 'agosto' } }))), {});
    for (const destino of ['regras', 'fechar-competencia', 'confirmar-pagamento', 'comissoes-atrasadas']) {
        assert.match(FONTE_JS, new RegExp(`'${destino}': \\{ rotulo:`), `destino "${destino}" do painel da fase G sem ação`);
    }
    assert.match(FONTE_HTML, /data-perm="financeiro\.comissao\.view" data-fin-acao="regras"/);
    assert.match(FONTE_HTML, /data-perm="financeiro\.ajuste\.registrar" data-fin-acao="registrar-ajuste"/);
    assert.match(FONTE_HTML, /data-perm="financeiro\.producao\.registrar" data-fin-acao="registrar-producao"/);
});

test('avisos do BB na fila são processados em segundo plano (sem chamar o banco) e a tela relê só se algo foi resolvido', async () => {
    const modulo = montarModuloDoHtml();
    const conciliacao = { fila: { lidos: 2, pagos: 1, cancelados: 0, alertas: 0, ignorados: 1, erros: 0 }, sql_pendente: false };
    const { chamadas } = carregar({ modulo, painel: painelFalso(), receber: receberFalso({ a_conciliar: { fila: 2, lancamentos: 0, alertas: 0 } }), conciliacao });
    await modulo.moduleReadyPromise;
    await new Promise(r => setTimeout(r, 20));
    assert.ok(chamadas.includes('POST http://api.teste/api/cobranca/conciliar {"so_fila":true}'), JSON.stringify(chamadas));
    assert.ok(chamadas.filter(c => c.includes('/recebimentos/painel')).length >= 2, 'relê depois de resolver');

    const parado = montarModuloDoHtml();
    const semProgresso = { fila: { lidos: 2, pagos: 0, cancelados: 0, alertas: 0, ignorados: 0, erros: 2 } };
    const r2 = carregar({ modulo: parado, painel: painelFalso(), receber: receberFalso({ a_conciliar: { fila: 2 } }), conciliacao: semProgresso });
    await parado.moduleReadyPromise;
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(r2.chamadas.filter(c => c.startsWith('POST')).length, 1, 'aviso com erro não vira laço');
    assert.strictEqual(r2.chamadas.filter(c => c.includes('/recebimentos/painel')).length, 1);
});

test('"Conciliar com o BB" chama a conciliação inteira, mostra o resumo na caixa da casa e relê a tela', async () => {
    const modulo = montarModuloDoHtml();
    const conciliacao = {
        fila: { lidos: 1, pagos: 1, cancelados: 0, alertas: 0, ignorados: 0, erros: 0, mensagens: [] },
        consultas: { consultados: 3, mudaram: 1, pagos: 1, erros: 1, mensagens: ['Boleto 000312: O BB respondeu 503'] },
        acerto: { lancados: 2, erros: 0, mensagens: [] }, sql_pendente: false
    };
    const { chamadas, avisos } = carregar({ modulo, painel: painelFalso(), conciliacao });
    await modulo.moduleReadyPromise;
    const botao = criarElemento('button');
    botao.dataset.finAcao = 'conciliar';
    modulo.appendChild(botao);
    modulo.ouvintes.click[0]({ target: botao, stopPropagation() {} });
    await new Promise(r => setTimeout(r, 20));
    assert.ok(chamadas.includes('POST http://api.teste/api/cobranca/conciliar {}'));
    // A caixa vem organizada: cartões com os números e seções com o detalhe.
    const caixa = JSON.parse(JSON.stringify(avisos[0]));
    assert.strictEqual(caixa.title, 'Conciliação com o BB');
    assert.strictEqual(caixa.tom, 'aviso', 'houve erro na consulta: tom de atenção');
    assert.deepStrictEqual(caixa.resumo.map(c => [c.rotulo, c.valor]),
        [['Avisos na fila', '1'], ['Boletos consultados', '3'], ['Pagamentos', '2'], ['Recebimentos lançados', '2']]);
    assert.deepStrictEqual(caixa.secoes.map(s => s.titulo), ['Avisos de pagamento do BB', 'Consulta ao BB', 'Ocorrências']);
    assert.deepStrictEqual(caixa.secoes[1].itens.map(i => [i.rotulo, i.valor]), [['Mudaram de situação', '1'], ['Pagos', '1'], ['Com erro', '1']]);
    assert.deepStrictEqual(caixa.secoes[2].lista, ['Boleto 000312: O BB respondeu 503']);
    assert.strictEqual(chamadas.filter(c => c.includes('/recebimentos/painel')).length, 2, 'relê depois de conciliar');
});

test('finMapearReceber e finCaixaDaConciliacao são puras', () => {
    const f = funcoes();
    const mapear = f('finMapearReceber');
    const r = mapear(receberFalso({ sql_pendente: true, a_conciliar: { fila: 3 } }), null);
    assert.strictEqual(r.nota, 'Falta ativar: rode sql/cobranca_recebimentos.sql e reinicie a API.');
    assert.strictEqual(r.fila, 3);
    assert.strictEqual(r.boletos.rodape, '3 avisos de pagamento do BB para conciliar');
    assert.strictEqual(mapear(receberFalso({ desde: null }), null).nota, 'Todas as parcelas dos pedidos faturados');
    assert.strictEqual(mapear(receberFalso({ ultima_conciliacao: { quando: '16/09/2026 10:05', como: 'automática', resumo: 'x' } }), null).nota,
        'Parcelas controladas a partir de 01/09/2026 · última conciliação com o BB: 16/09/2026 10:05 (automática)');
    assert.strictEqual(mapear(receberFalso({ em_atraso: { quantidade: 0, total: 0 } }), null).atraso.rodape, 'Nenhuma parcela vencida');
    const semPermissao = mapear(null, Object.assign(new Error('x'), { status: 403 }));
    assert.strictEqual(semPermissao.recebido.valor, null);
    assert.strictEqual(semPermissao.recebido.rodape, 'Sem permissão para ver os recebimentos.');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(semPermissao.pendencias)), []);
    const fora = mapear(null, new Error('rede caiu'));
    assert.strictEqual(fora.pendencias[0].titulo, 'Painel de recebimentos indisponível');
    assert.strictEqual(fora.pendencias[0].destino, 'atualizar');

    const caixaDe = r => JSON.parse(JSON.stringify(f('finCaixaDaConciliacao')(r)));
    const semSql = caixaDe({ fila: { lidos: 0 }, sql_pendente: true });
    assert.strictEqual(semSql.alerta, 'Os recebimentos ainda não estão ativados: rode sql/cobranca_recebimentos.sql e reinicie a API.');
    assert.strictEqual(semSql.tom, 'aviso');
    assert.strictEqual(semSql.resumo[1].valor, '—', 'sem o SQL não houve consulta');
    const comAvisos = caixaDe({ fila: { lidos: 3, pagos: 1, cancelados: 1, ignorados: 1, mensagens: [] }, consultas: { consultados: 0 }, acerto: {} });
    assert.strictEqual(comAvisos.tom, 'sucesso');
    assert.deepStrictEqual(comAvisos.secoes[0].itens.map(i => [i.rotulo, i.valor]),
        [['Pagamentos', '1'], ['Cancelamentos', '1'], ['Ignorados (não são deste sistema)', '1']]);
    // Nada mudou: nenhuma seção vazia, só os cartões e a nota de "tudo em dia".
    const emDia = caixaDe({ fila: { lidos: 0 }, consultas: { consultados: 5, mudaram: 0, pagos: 0, erros: 0, mensagens: [] }, acerto: { lancados: 0 } });
    assert.deepStrictEqual(emDia.secoes, []);
    assert.strictEqual(emDia.resumo[1].valor, '5');
    assert.match(emDia.nota, /Tudo em dia/);
});

test('sem permissão (403) ou sem rede, a parte fiscal fica vazia e avisa; o resto da tela segue', async () => {
    const modulo = montarModuloDoHtml();
    carregar({ modulo, painel: {}, statusHttp: 403 });
    await modulo.moduleReadyPromise;
    const valores = Object.fromEntries(modulo.querySelectorAll('[data-fin]').map(el => [el.dataset.fin, el.textContent.replace(/ /g, ' ')]));
    assert.strictEqual(valores['nf.valor'], '—');
    assert.strictEqual(valores['nf.rodape'], 'Sem permissão para ver as notas fiscais.');
    assert.strictEqual(valores['pendencias.total'], '0');
    assert.strictEqual(valores['comissoes.valor'], '—');
    assert.strictEqual(valores['comissoes.rodape'], 'Sem permissão para ver comissões e produção.');
    assert.strictEqual(valores['resumoProducao.pecasMes'], '—');
    const pendencias = modulo.querySelector('[data-fin-lista="pendencias"]').children;
    assert.strictEqual(pendencias.length, 1);
    assert.strictEqual(pendencias[0].className, 'fin-vazio');

    const semRede = montarModuloDoHtml();
    carregar({ modulo: semRede, painel: {}, statusHttp: 500 });
    await semRede.moduleReadyPromise;
    const linha = semRede.querySelector('[data-fin-lista="pendencias"]').children[0];
    assert.strictEqual(linha.children[1].children[0].textContent, 'Painel fiscal indisponível');
    assert.strictEqual(linha.children[3].dataset.finAcao, 'atualizar', 'a pendência leva ao "Atualizar"');
    assert.strictEqual(semRede.querySelector('[data-fin-lista="pendencias"]').children[1].children[1].children[0].textContent, 'Painel de recebimentos indisponível');
    assert.strictEqual(semRede.querySelector('[data-fin-lista="pendencias"]').children[2].children[1].children[0].textContent, 'Painel de comissões indisponível');
    const valoresSemRede = Object.fromEntries(semRede.querySelectorAll('[data-fin]').map(el => [el.dataset.fin, el.textContent]));
    assert.strictEqual(valoresSemRede['receber.nota'], 'Não foi possível carregar os recebimentos.');
});

test('finMapearPainel e finFormatarQuando são puras: painel → kpi, pendências e atividade; instante → hora ou dia', () => {
    const f = funcoes();
    const mapear = f('finMapearPainel');
    const r = mapear(painelFalso(), null);
    assert.strictEqual(r.nf.quantidade, 2);
    assert.strictEqual(r.nf.total, 1900);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.pendencias[0].filtro)), { status: 'processando' });
    assert.strictEqual(r.atividade[1].notaId, 4);
    assert.strictEqual(r.ambiente, 'homologacao');
    const semPermissao = mapear(null, Object.assign(new Error('x'), { status: 403 }));
    assert.strictEqual(semPermissao.nf.quantidade, null);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(semPermissao.pendencias)), []);
    assert.strictEqual(mapear(null, null).nf.rodape, 'Sem dados fiscais.');
    const quando = f('finFormatarQuando');
    assert.strictEqual(quando('2026-09-16T15:10:01-03:00', '2026-09-16'), '15:10');
    assert.strictEqual(quando('2026-09-15T15:10:01-03:00', '2026-09-16'), '15/09');
    assert.strictEqual(quando('2026-09-16', '2026-09-16'), '16/09', 'só a data (sem hora) mostra o dia');
    assert.strictEqual(quando('', '2026-09-16'), '—');
});

test('toda ação sem função real abre o diálogo padrão "em implementação" com o nome da função', async () => {
    const modulo = montarModuloDoHtml();
    const { avisos } = carregar({ modulo });
    await modulo.moduleReadyPromise;

    const botao = criarElemento('button');
    botao.dataset.finAcao = 'registrar-ajuste';
    modulo.appendChild(botao);
    modulo.ouvintes.click[0]({ target: botao, stopPropagation() {} });

    assert.strictEqual(avisos.length, 1);
    assert.strictEqual(avisos[0].title, 'Função em implementação');
    assert.match(avisos[0].message, /"Registrar ajuste" ainda está em implementação/);
});

test('o botão dentro da linha de pendência vence a linha: um clique, uma ação (sem Modal, vira o aviso com o nome do modal)', async () => {
    const modulo = montarModuloDoHtml();
    const { avisos } = carregar({ modulo, painel: painelFalso() });
    await modulo.moduleReadyPromise;
    const linha = modulo.querySelector('[data-fin-lista="pendencias"]').children[0];
    const botao = linha.children[3];
    modulo.ouvintes.click[0]({ target: botao, stopPropagation() {} });
    assert.strictEqual(avisos.length, 1);
    assert.match(avisos[0].message, /Notas fiscais/);
});

test('"Atualizar", a troca de competência e "Hoje" releem o painel; os modais releem por window.FinanceiroRecarregar', async () => {
    const modulo = montarModuloDoHtml();
    const { chamadas, contexto } = carregar({ modulo, painel: painelFalso() });
    await modulo.moduleReadyPromise;
    assert.strictEqual(chamadas.length, 3, 'painel fiscal, de recebimentos e de comissões');

    const atualizar = criarElemento('button');
    atualizar.dataset.finAcao = 'atualizar';
    modulo.appendChild(atualizar);
    modulo.ouvintes.click[0]({ target: atualizar, stopPropagation() {} });
    await modulo.moduleReadyPromise;
    assert.strictEqual(chamadas.length, 6, '"Atualizar" é real: relê os painéis');

    const select = modulo.querySelector('#finCompetencia');
    select.value = '2026-08';
    select.ouvintes.change[0]();
    await modulo.moduleReadyPromise;
    assert.deepStrictEqual(chamadas.slice(-3), [
        'http://api.teste/api/fiscal/painel?competencia=2026-08',
        'http://api.teste/api/cobranca/recebimentos/painel?competencia=2026-08',
        'http://api.teste/api/financeiro/painel?competencia=2026-08'
    ]);

    await contexto.window.FinanceiroRecarregar();
    assert.strictEqual(chamadas.length, 12);
    assert.match(FONTE_JS, /window\.FinanceiroRecarregar = \(\) => finRecarregar\(null\)/);
});


test('reexecutar o script (como o menu faz) não inicializa duas vezes nem toca em document', async () => {
    const modulo = montarModuloDoHtml();
    carregar({ modulo });
    await modulo.moduleReadyPromise;
    const promessa = modulo.moduleReadyPromise;
    carregar({ modulo });
    assert.strictEqual(modulo.moduleReadyPromise, promessa, 'segunda execução não pode montar de novo');
    assert.strictEqual(modulo.ouvintes.click.length, 1, 'um só ouvinte de clique no módulo');
    assert.doesNotMatch(FONTE_JS, /document\.addEventListener|window\.addEventListener/);
});

test('dado da tela entra por textContent; innerHTML não aparece no script', () => {
    assert.doesNotMatch(FONTE_JS, /innerHTML|insertAdjacentHTML/);
});

test('o HTML tem os blocos da descrição e todo data-fin-acao tem rótulo no script', () => {
    for (const trecho of ['>Financeiro</h1>', 'Acompanhe e controle o financeiro',
        'Aguardando NF-e', 'Comissões a pagar', 'Comissões atrasadas', 'Produção a pagar',
        'Pendências que exigem ação', 'Ações rápidas', 'Resumo de Comissões', 'Resumo de Produção',
        'Atividade recente', 'Emitir NF-e', 'Notas fiscais', 'Registrar recebimento', 'Registrar ajuste',
        'Registrar produção', 'Fechar competência', 'Relatórios', 'id="finCompetencia"', 'id="finHoje"']) {
        assert.ok(FONTE_HTML.includes(trecho), `HTML sem "${trecho}"`);
    }
    // A NF-e é emitida pelo sistema: não existe mais "Registrar NF" à mão.
    assert.ok(!FONTE_HTML.includes('Registrar NF<') && !FONTE_HTML.includes('registrar-nf'), 'o HTML não oferece "Registrar NF"');
    assert.match(FONTE_HTML, /data-perm="financeiro\.nfe\.emit" data-fin-acao="emitir-nfe"/);
    assert.match(FONTE_HTML, /data-perm="financeiro\.nfe\.view" data-fin-acao="notas-fiscais"/);
    // As duas engrenagens do cabeçalho: fiscal (NF-e) e cobrança (boletos BB), só para quem vê configuração.
    assert.match(FONTE_HTML, /data-perm="financeiro\.config\.view" data-fin-acao="configuracao-fiscal"/);
    assert.match(FONTE_HTML, /data-perm="financeiro\.config\.view" data-fin-acao="configuracao-cobranca"/);
    const acoesHtml = [...FONTE_HTML.matchAll(/data-fin-acao="([^"]+)"/g)].map(m => m[1]);
    const acoesJs = [...FONTE_JS.matchAll(/^\s+'([\w-]+)': \{ rotulo:/gm)].map(m => m[1]);
    for (const a of acoesHtml) assert.ok(acoesJs.includes(a), `ação "${a}" do HTML sem rótulo em FIN_ACOES`);
    const destinos = [...FONTE_JS.matchAll(/destino: '([\w-]+)'/g)].map(m => m[1]);
    for (const d of destinos) assert.ok(acoesJs.includes(d), `destino "${d}" das pendências sem rótulo em FIN_ACOES`);
});

test('o CSS traz a base da casa (só uma folha de módulo carrega por vez) e as cores seguem o tema', () => {
    for (const classe of ['.glass-surface', '.btn-primary', '.btn-neutral', '.btn-warning', '.badge-danger',
        '.input-glass', '.animate-fade-in-up', '.animate-modalFade', '.tab-active']) {
        assert.ok(FONTE_CSS.includes(classe + ' {') || FONTE_CSS.includes(classe + '{'), `CSS sem ${classe}`);
    }
    const modulo = FONTE_CSS.slice(FONTE_CSS.indexOf('.financeiro-module {'));
    assert.doesNotMatch(modulo, /color: #fff;/, 'texto fixo branco some no tema claro: usar --fin-texto-1');
    assert.match(modulo, /--fin-texto-1: var\(--menu-text-strong, #fff\)/);
    assert.match(modulo, /\.fin-kpi--atencao[^{]*\{[^}]*bordo/, 'o cartão de atenção usa o bordô da identidade');
});

test('cartões de comissão e produção mostram o que FALTA pagar sobre o total (x/x, y/x, 0/x)', async () => {
    const cenario = async comissoes => {
        const modulo = montarModuloDoHtml();
        carregar({ modulo, painel: painelFalso(), comissoes });
        await modulo.moduleReadyPromise;
        const valores = Object.fromEntries(modulo.querySelectorAll('[data-fin]').map(el => [el.dataset.fin, el.textContent.replace(/ /g, ' ')]));
        return valores;
    };

    // Nada pago: falta tudo.
    const aberta = await cenario(comissoesFalso());
    assert.deepStrictEqual([aberta['comissoes.valor'], aberta['comissoes.total']], ['R$ 18.450,00', '/ R$ 18.450,00']);

    // Pago em parte (um beneficiário): sobra o resto, e o rodapé diz quanto já saiu.
    const parcial = await cenario(comissoesFalso({
        comissoes: { situacao: 'parcial', valor: 12450, total: 18450, pago: 6000, parcelas: 12, pagar_ate: '2026-10-15', pago_em: null }
    }));
    assert.deepStrictEqual([parcial['comissoes.valor'], parcial['comissoes.total']], ['R$ 12.450,00', '/ R$ 18.450,00']);
    assert.strictEqual(parcial['comissoes.rodape'], 'Paga em parte (R$ 6.000,00) · pagar até 15/10/2026');

    // Pago tudo: zero a pagar, e o total continua à vista.
    const paga = await cenario(comissoesFalso({
        comissoes: { situacao: 'paga', valor: 0, total: 18450, pago: 18450, parcelas: 12, pagar_ate: '2026-10-15', pago_em: '2026-10-14' },
        producao: { situacao: 'paga', valor: 0, total: 9870, pago: 9870, pecas: 327, pagar_ate: '2026-10-07', dia_util: 5, pago_em: '2026-10-06' }
    }));
    assert.deepStrictEqual([paga['comissoes.valor'], paga['comissoes.total']], ['R$ 0,00', '/ R$ 18.450,00']);
    assert.strictEqual(paga['comissoes.rodape'], 'Paga em 14/10/2026');
    assert.deepStrictEqual([paga['producao.valor'], paga['producao.total']], ['R$ 0,00', '/ R$ 9.870,00']);

    // Sem ajuste manual nenhum, a nota do resumo some (nada de "(0 manuais)").
    const semAjuste = await cenario(comissoesFalso({
        resumo_comissoes: { previstas: 32500, apuradas: 18450, atrasadas: 7320, ajustes: 0, ajustes_manuais: { quantidade: 0, valor: 0, comissao: 0 }, proximo_pagamento: '2026-10-15', situacao: 'aberta' }
    }));
    assert.strictEqual(semAjuste['resumoComissoes.ajustesQuantidade'], '');
    assert.strictEqual(semAjuste['resumoComissoes.ajustes'], 'R$ 0,00');
});
