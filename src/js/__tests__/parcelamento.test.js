/**
 * O bloco de parcelamento (src/js/utils/parcelamento.js).
 *
 * É a peça que decide em quantas vezes um orçamento ou pedido é dividido, e o
 * teto dela era 5 — escrito à mão dentro do HTML do seletor, no meio de uma
 * string de marcação. O backend nunca teve esse teto: ele grava quantas
 * parcelas vierem e confere a SOMA contra o total, que é a regra que de fato
 * protege o documento.
 *
 * O duplo abaixo é o mínimo de DOM que o utilitário toca.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARQUIVO = path.join(__dirname, '..', 'utils', 'parcelamento.js');

// ---------------------------------------------------------------------------
// Duplo de DOM
// ---------------------------------------------------------------------------

/** Registro de elementos por id, compartilhado pelo documento e pelos nós. */
let REGISTRO = new Map();

function criarElemento(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    name: '',
    value: '',
    type: '',
    checked: false,
    disabled: false,
    textContent: '',
    filhos: [],
    dataset: {},
    style: {},
    _classes: new Set(),
    _escutas: new Map(),
    _html: ''
  };

  el.classList = {
    add: (...c) => c.forEach(x => el._classes.add(x)),
    remove: (...c) => c.forEach(x => el._classes.delete(x)),
    contains: c => el._classes.has(c),
    toggle: (c, f) => { const q = f === undefined ? !el._classes.has(c) : f; if (q) el._classes.add(c); else el._classes.delete(c); }
  };

  el.appendChild = f => { el.filhos.push(f); return f; };
  el.addEventListener = (t, fn) => {
    if (!el._escutas.has(t)) el._escutas.set(t, []);
    el._escutas.get(t).push(fn);
  };
  el.disparar = t => (el._escutas.get(t) || []).forEach(fn => fn({ target: el }));
  // O utilitário busca os próprios filhos por `container.querySelector('#id')`.
  // Como ele desenha o bloco com `innerHTML` (uma string), não há nó de
  // verdade para achar — o registro faz esse papel.
  el.querySelector = sel => (sel?.startsWith('#') ? REGISTRO.get(sel.slice(1)) || null : null);
  el.querySelectorAll = sel => {
    const m = /\[name="([^"]+)"\]/.exec(sel || '');
    return m ? [...REGISTRO.values()].filter(e => e.name === m[1]) : [];
  };

  // `value` de um `<select>` de verdade é sempre string: `select.value = 12`
  // guarda '12'. Sem isto o duplo deixaria passar código que compara o valor
  // com uma string e nunca casa.
  Object.defineProperty(el, 'value', {
    get() { return el._value ?? ''; },
    set(v) { el._value = v === null || v === undefined ? '' : String(v); }
  });

  // `innerHTML` é onde o utilitário desenha o bloco inteiro. Além de guardar o
  // texto, criamos as `<option>` que ele escreveu: no DOM de verdade elas
  // viram filhos do `<select>`, e é sobre esses filhos que o código pergunta
  // "esta opção já existe?".
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) {
      el._html = String(v);
      // Só a marcação que DESENHA o seletor refaz as opções dele. O bloco
      // repinta as linhas de parcela a cada mudança, e sem este recorte cada
      // repintura apagaria as opções — inclusive a que o documento pediu.
      if (!el._html.includes('<select')) return;

      const select = [...REGISTRO.values()].find(e => e.tagName === 'SELECT');
      if (!select) return;
      select.filhos = [];
      for (const [, valor] of el._html.matchAll(/<option value="(\d+)"/g)) {
        const op = criarElemento('option');
        op.value = valor;
        select.filhos.push(op);
      }
    }
  });

  Object.defineProperty(el, 'options', {
    get() { return el.filhos.filter(f => f.tagName === 'OPTION'); }
  });

  return el;
}

/** Carrega o utilitário num ambiente próprio e devolve o que ele publicou. */
function montar() {
  REGISTRO = new Map();
  const porId = REGISTRO;
  const doc = {
    getElementById: id => porId.get(id) || null,
    createElement: criarElemento,
    querySelectorAll: sel => {
      const m = /\[name="([^"]+)"\]/.exec(sel || '');
      return m ? [...porId.values()].filter(e => e.name === m[1]) : [];
    }
  };

  const janela = { document: doc };
  const sandbox = {
    window: janela, document: doc,
    Array, Math, Number, String, Object, Map, parseInt, parseFloat,
    Intl, console, setTimeout
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ARQUIVO, 'utf8'), sandbox, { filename: 'parcelamento.js' });

  return { Parcelamento: sandbox.Parcelamento, porId, criar: criarElemento };
}

/** As opções que o seletor de quantidade oferece, lidas do HTML gerado. */
function opcoesGeradas(html) {
  return [...html.matchAll(/<option value="(\d+)"/g)].map(m => Number(m[1]));
}

// ---------------------------------------------------------------------------

test('a lista de parcelas vai até 10', () => {
  const { Parcelamento } = montar();

  // O número que a tela oferece. O backend não tem teto: ele confere a SOMA
  // das parcelas contra o total, que é a regra que protege o documento.
  assert.strictEqual(Parcelamento.MAX_PARCELAS, 10);
});

test('o seletor oferece de 1 até o teto, sem buraco', () => {
  const { Parcelamento, porId } = montar();
  const container = criarElemento();
  container.id = 'p';
  porId.set('p', container);

  // Os filhos que o utilitário procura depois de desenhar.
  for (const sufixo of ['_count', '_rows', '_summary']) {
    const el = criarElemento(sufixo === '_count' ? 'select' : 'div');
    el.id = `p${sufixo}`;
    porId.set(`p${sufixo}`, el);
  }

  Parcelamento.init('p', { getTotal: () => 100000 });

  const opcoes = opcoesGeradas(container.innerHTML);
  assert.deepStrictEqual(opcoes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('a lista é GERADA, não escrita à mão', () => {
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');

  // Com a lista cravada dentro do HTML do seletor, mudar o teto significava
  // caçá-la no meio de uma string de marcação — e foi assim que ela ficou em 5
  // enquanto o backend aceitava qualquer número.
  assert.doesNotMatch(fonte, /\[1,\s*2,\s*3,\s*4,\s*5\]/);
  assert.match(fonte, /const MAX_PARCELAS = \d+;/);
  assert.match(fonte, /length:\s*MAX_PARCELAS/);
});

test('o backend não repete o teto da tela', () => {
  // O teto é da TELA. O que protege o documento é a soma das parcelas bater
  // com o total — e essa conferência é do servidor. Um segundo teto lá viraria
  // uma segunda regra sobre a mesma coisa.
  for (const arquivo of ['orcamentosController.js', 'pedidosController.js']) {
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'backend', arquivo), 'utf8');
    assert.doesNotMatch(fonte, /parcelas[^\n]{0,40}>\s*5\b/,
      `${arquivo} tem um teto de parcelas próprio`);
  }
});

test('pedido de 12 parcelas não deixa o bloco em branco', () => {
  const { Parcelamento, porId } = montar();
  const container = criarElemento();
  container.id = 'q';
  porId.set('q', container);

  const count = criarElemento('select');
  count.id = 'q_count';
  porId.set('q_count', count);
  for (const sufixo of ['_rows', '_summary']) {
    const el = criarElemento('div');
    el.id = `q${sufixo}`;
    porId.set(`q${sufixo}`, el);
  }

  Parcelamento.init('q', {
    getTotal: () => 120000,
    prefill: { count: 12, mode: 'equal', items: [] }
  });

  // `select.value = 12` num seletor que vai até 10 não erra: simplesmente não
  // faz nada, e o campo fica em branco. Um pedido de 12 parcelas abria o bloco
  // vazio e ninguém sabia por quê.
  assert.strictEqual(count.value, '12');
  assert.ok(count.options.some(o => o.value === '12'),
    'a opção do documento não entrou na lista');
});

test('contagem sem sentido não vira opção', () => {
  const { Parcelamento, porId } = montar();
  const container = criarElemento();
  container.id = 's';
  porId.set('s', container);

  const count = criarElemento('select');
  count.id = 's_count';
  porId.set('s_count', count);
  for (const sufixo of ['_rows', '_summary']) {
    const el = criarElemento('div');
    el.id = `s${sufixo}`;
    porId.set(`s${sufixo}`, el);
  }

  // O número vem de um documento lido por um modelo: "0x", "-3" e texto solto
  // acontecem. Criar a opção assim mesmo poria no seletor uma escolha que o
  // resto do bloco não sabe dividir — e o campo aceitaria o absurdo.
  Parcelamento.init('s', { getTotal: () => 90000, prefill: { count: 0 } });
  assert.strictEqual(count.options.length, Parcelamento.MAX_PARCELAS);

  for (const invalido of [-3, 'muitas', null]) {
    Parcelamento.init('s', { getTotal: () => 90000, prefill: { count: invalido } });
    assert.strictEqual(count.options.length, Parcelamento.MAX_PARCELAS,
      `${JSON.stringify(invalido)} virou opção`);
  }
});

test('pedido dentro do teto não inventa opção repetida', () => {
  const { Parcelamento, porId } = montar();
  const container = criarElemento();
  container.id = 'r';
  porId.set('r', container);

  const count = criarElemento('select');
  count.id = 'r_count';
  porId.set('r_count', count);
  for (const sufixo of ['_rows', '_summary']) {
    const el = criarElemento('div');
    el.id = `r${sufixo}`;
    porId.set(`r${sufixo}`, el);
  }

  Parcelamento.init('r', { getTotal: () => 90000, prefill: { count: 3 } });

  // Três já está na lista desenhada. Acrescentá-lo de novo daria duas opções
  // com o mesmo número, uma delas dizendo "(do documento)" — e a pessoa
  // escolhendo entre duas linhas idênticas sem saber qual é qual.
  const tres = count.options.filter(o => o.value === '3');
  assert.strictEqual(tres.length, 1, 'a opção 3 apareceu duas vezes');
  assert.strictEqual(count.options.length, Parcelamento.MAX_PARCELAS);
  assert.strictEqual(count.value, '3');
});
