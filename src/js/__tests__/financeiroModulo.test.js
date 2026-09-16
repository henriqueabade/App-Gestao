/**
 * Módulo Financeiro — Comissões e Produção (src/js/financeiro.js).
 *
 * Etapa visual: a tela é montada a partir de um objeto de dados e cada ação
 * sem função real abre o aviso "em implementação". Os testes prendem as
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

/**
 * Carrega o módulo. `painel` é o que GET /api/fiscal/painel devolve;
 * `statusHttp` diferente de 200 simula a recusa (403 sem permissão). Sem
 * `painel`, não há apiConfig nem fetch — como no teste que só olha funções.
 */
function carregar({ modulo = null, painel = undefined, statusHttp = 200 } = {}) {
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
        contexto.fetch = async url => {
            chamadas.push(url);
            return { ok: statusHttp === 200, status: statusHttp, json: async () => (statusHttp === 200 ? painel : { error: 'Sem permissão' }) };
        };
    }
    contexto.globalThis = contexto;
    vm.createContext(contexto);
    vm.runInContext(`(function(){\n${FONTE_JS}\n})();`, contexto);
    return { avisos, contexto, chamadas };
}

/** Expõe as funções de nível superior sem depender do embrulho do menu. */
function funcoes() {
    const contexto = {
        window: { DialogPadrao: { info: () => Promise.resolve(true) } },
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

test('competências vão de 12 meses atrás a 3 à frente, com a atual selecionada e virada de ano certa', () => {
    const f = funcoes();
    const select = criarElemento('select');
    f('finMontarCompetencias')(select, new Date(2026, 0, 15));
    assert.strictEqual(select.children.length, 16);
    assert.strictEqual(select.children[0].value, '2025-01');
    assert.strictEqual(select.children[0].textContent, 'Janeiro / 2025');
    const atual = select.children.find(o => o.selected);
    assert.strictEqual(atual.value, '2026-01');
    assert.strictEqual(select.children[15].textContent, 'Abril / 2026');
});

test('a tela preenche TODOS os campos data-fin: a parte fiscal vem do painel real, comissões e produção do exemplo', async () => {
    const modulo = montarModuloDoHtml();
    const { chamadas } = carregar({ modulo, painel: painelFalso() });
    await modulo.moduleReadyPromise;
    assert.deepStrictEqual(chamadas, ['http://api.teste/api/fiscal/painel?competencia=' + hojeTexto().slice(0, 7)], 'o painel é lido na competência selecionada');

    const vazios = modulo.querySelectorAll('[data-fin]').filter(el => el.textContent === '—' || el.textContent === '');
    assert.deepStrictEqual(vazios.map(el => el.dataset.fin), [], 'campos ainda com o marcador inicial');

    const valores = Object.fromEntries(modulo.querySelectorAll('[data-fin]').map(el => [el.dataset.fin, el.textContent.replace(/ /g, ' ')]));
    assert.strictEqual(valores['nf.valor'], '2');
    assert.strictEqual(valores['nf.auxiliar'], 'pedidos');
    assert.strictEqual(valores['nf.rodape'], 'Total: R$ 1.900,00 · enviados desde 01/09/2026 · 1 sem NF-e (S/NF)');
    assert.strictEqual(valores['comissoes.valor'], 'R$ 18.450,00');
    assert.strictEqual(valores['comissoes.rodape'], 'Pagamento até 15/10/2026');
    assert.strictEqual(valores['resumoComissoes.ajustes'], '- R$ 840,00');
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
});

test('sem permissão (403) ou sem rede, a parte fiscal fica vazia e avisa; o resto da tela segue', async () => {
    const modulo = montarModuloDoHtml();
    carregar({ modulo, painel: {}, statusHttp: 403 });
    await modulo.moduleReadyPromise;
    const valores = Object.fromEntries(modulo.querySelectorAll('[data-fin]').map(el => [el.dataset.fin, el.textContent.replace(/ /g, ' ')]));
    assert.strictEqual(valores['nf.valor'], '—');
    assert.strictEqual(valores['nf.rodape'], 'Sem permissão para ver as notas fiscais.');
    assert.strictEqual(valores['pendencias.total'], '0');
    assert.strictEqual(valores['comissoes.valor'], 'R$ 18.450,00');
    const pendencias = modulo.querySelector('[data-fin-lista="pendencias"]').children;
    assert.strictEqual(pendencias.length, 1);
    assert.strictEqual(pendencias[0].className, 'fin-vazio');

    const semRede = montarModuloDoHtml();
    carregar({ modulo: semRede, painel: {}, statusHttp: 500 });
    await semRede.moduleReadyPromise;
    const linha = semRede.querySelector('[data-fin-lista="pendencias"]').children[0];
    assert.strictEqual(linha.children[1].children[0].textContent, 'Painel fiscal indisponível');
    assert.strictEqual(linha.children[3].dataset.finAcao, 'atualizar', 'a pendência leva ao "Atualizar"');
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
    botao.dataset.finAcao = 'registrar-recebimento';
    modulo.appendChild(botao);
    modulo.ouvintes.click[0]({ target: botao, stopPropagation() {} });

    assert.strictEqual(avisos.length, 1);
    assert.strictEqual(avisos[0].title, 'Função em implementação');
    assert.match(avisos[0].message, /"Registrar recebimento" ainda está em implementação/);
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
    assert.strictEqual(chamadas.length, 1);

    const atualizar = criarElemento('button');
    atualizar.dataset.finAcao = 'atualizar';
    modulo.appendChild(atualizar);
    modulo.ouvintes.click[0]({ target: atualizar, stopPropagation() {} });
    await modulo.moduleReadyPromise;
    assert.strictEqual(chamadas.length, 2, '"Atualizar" é real: relê o painel');

    const select = modulo.querySelector('#finCompetencia');
    select.value = '2026-08';
    select.ouvintes.change[0]();
    await modulo.moduleReadyPromise;
    assert.strictEqual(chamadas.at(-1), 'http://api.teste/api/fiscal/painel?competencia=2026-08');

    await contexto.window.FinanceiroRecarregar();
    assert.strictEqual(chamadas.length, 4);
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
    for (const trecho of ['Comissões e Produção', 'Acompanhamento financeiro e produtivo dos pedidos',
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
