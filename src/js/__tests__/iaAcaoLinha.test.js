/**
 * "O que fazer com esta linha" (src/js/modals/ia-acao.js).
 *
 * A tela existe para desatolar alguém: um pedido cuja empresa não foi
 * reconhecida não tem para onde ir, e antes disto a linha ficava vermelha, sem
 * caixa de seleção e sem caminho nenhum.
 *
 * São duas decisões e só duas — descartar, ou apontar para uma empresa que já
 * existe. O que este arquivo mede é que nenhuma das duas sai pela metade.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = path.join(__dirname, '..', '..', 'html', 'modals', 'ia', 'acao.html');
const SCRIPT = path.join(__dirname, '..', 'modals', 'ia-acao.js');

// ---------------------------------------------------------------------------
// Duplo de DOM
// ---------------------------------------------------------------------------

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
    parentElement: null,
    filhos: [],
    dataset: {},
    _classes: new Set(),
    _escutas: new Map()
  };

  el.classList = {
    add: (...c) => c.forEach(x => el._classes.add(x)),
    remove: (...c) => c.forEach(x => el._classes.delete(x)),
    contains: c => el._classes.has(c),
    toggle: (c, forcar) => {
      const querAdicionar = forcar === undefined ? !el._classes.has(c) : forcar;
      if (querAdicionar) el._classes.add(c); else el._classes.delete(c);
      return querAdicionar;
    }
  };

  el.appendChild = f => { f.parentElement = el; el.filhos.push(f); return f; };
  el.replaceChildren = (...novos) => {
    el.filhos = [];
    novos.forEach(n => el.appendChild(n));
  };
  el.addEventListener = (tipo, fn) => {
    if (!el._escutas.has(tipo)) el._escutas.set(tipo, []);
    el._escutas.get(tipo).push(fn);
  };
  el.dispatchEvent = evento => {
    (el._escutas.get(evento.type) || []).forEach(fn => fn(evento));
    // `bubbles` do duplo: só até o pai, que é tudo o que este módulo usa.
    if (evento.bubbles && el.parentElement) el.parentElement.dispatchEvent(evento);
    return true;
  };
  el.disparar = (tipo, extra = {}) =>
    el.dispatchEvent({ type: tipo, target: el, ...extra });
  el.focus = () => { el._focado = true; };
  el.querySelector = seletor =>
    todos(el).find(d => casa(d, seletor)) || null;
  el.escondido = () => el._classes.has('hidden');

  return el;
}

function todos(el) {
  const saida = [];
  for (const f of el.filhos) { saida.push(f); saida.push(...todos(f)); }
  return saida;
}

function casa(el, seletor) {
  if (seletor === 'input[name="iaAcaoEscolha"]:checked') {
    return el.name === 'iaAcaoEscolha' && el.checked;
  }
  if (seletor === 'input[name="iaAcaoEscolha"]') return el.name === 'iaAcaoEscolha';
  if (seletor === 'input[type="radio"]') return el.type === 'radio';
  if (seletor === '.ia-acao__opcao') return el._classes.has('ia-acao__opcao');
  if (seletor.startsWith('#')) return el.id === seletor.slice(1);
  return false;
}

/** Os ids vêm do HTML de verdade: um id renomeado lá quebra aqui. */
function idsDoHtml() {
  const html = fs.readFileSync(HTML, 'utf8');
  return [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
}

/**
 * O texto que cada elemento já traz escrito no HTML.
 *
 * Sem semear isto, o duplo nasce com tudo em branco — e um teste que espera o
 * rótulo PADRÃO ("Descartar esta linha") estaria medindo o buraco do harness
 * em vez do que a tela mostra. Só elementos de texto simples, que é o que o
 * módulo lê.
 */
function textosDoHtml() {
  const html = fs.readFileSync(HTML, 'utf8');
  const saida = new Map();
  const padrao = new RegExp('<span[^>]* id="([^"]+)"[^>]*>([^<]*)</span>', 'g');
  for (const [, id, dentro] of html.matchAll(padrao)) {
    saida.set(id, dentro.replace(/[ \t\r\n]+/g, ' ').trim());
  }
  return saida;
}

function montar({ pedido } = {}) {
  const ids = idsDoHtml();
  for (const obrigatorio of ['iaAcaoLido', 'iaAcaoMotivo', 'iaAcaoEmpresa',
    'iaAcaoEmpresas', 'iaAcaoConfirmar', 'iaAcaoCancelar', 'iaAcaoBuscaEmpresa']) {
    assert.ok(ids.includes(obrigatorio), `acao.html perdeu #${obrigatorio}`);
  }

  const textos = textosDoHtml();
  const elementos = new Map();
  const raiz = criarElemento('body');
  for (const id of ids) {
    const el = criarElemento(id === 'iaAcaoEmpresas' ? 'datalist' : 'div');
    el.id = id;
    el.textContent = textos.get(id) || '';
    elementos.set(id, el);
    raiz.appendChild(el);
  }
  elementos.get('iaAcaoBuscaEmpresa').classList.add('hidden');
  elementos.get('iaAcaoConfirmar').disabled = true;

  // Os dois cartões e seus rádios — o HTML os declara sem id, e é por nome que
  // o módulo os encontra.
  const cartoes = {};
  for (const valor of ['apontar', 'descartar']) {
    const cartao = criarElemento('label');
    cartao.classList.add('ia-acao__opcao');
    cartao.dataset.opcao = valor;

    const radio = criarElemento('input');
    radio.type = 'radio';
    radio.name = 'iaAcaoEscolha';
    radio.value = valor;
    cartao.appendChild(radio);

    raiz.appendChild(cartao);
    cartoes[valor] = { cartao, radio };
  }

  const fechados = [];
  const toasts = [];

  const doc = {
    getElementById: id => elementos.get(id) || null,
    querySelector: seletor => todos(raiz).find(d => casa(d, seletor)) || null,
    querySelectorAll: seletor => todos(raiz).filter(d => casa(d, seletor)),
    createElement: criarElemento,
    addEventListener: () => {}
  };

  const sandbox = {
    document: doc,
    Modal: { close: id => fechados.push(id) },
    Event: class { constructor(tipo, o = {}) { this.type = tipo; this.bubbles = !!o.bubbles; } },
    HTMLInputElement: class {},
    Array, String, Object, Promise, console,
    setTimeout, clearTimeout
  };
  sandbox.window = sandbox;
  sandbox.showToast = (msg, tipo) => toasts.push({ msg, tipo });
  sandbox.iaAcaoPedido = pedido;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SCRIPT, 'utf8'), sandbox, { filename: 'ia-acao.js' });

  return {
    el: id => elementos.get(id),
    cartoes, fechados, toasts, sandbox,
    marcar(valor) {
      const { radio } = cartoes[valor];
      radio.checked = true;
      for (const outro of Object.values(cartoes)) {
        if (outro.radio !== radio) outro.radio.checked = false;
      }
      radio.disparar('change');
    },
    digitar(texto) {
      const campo = elementos.get('iaAcaoEmpresa');
      campo.value = texto;
      campo.disparar('input');
    },
    confirmar: () => elementos.get('iaAcaoConfirmar').disparar('click'),
    pronta: () => new Promise(r => setTimeout(r, 5))
  };
}

const PEDIDO = decididas => ({
  itemId: 7,
  lido: 'DS CONTEMPORÂNEA',
  motivo: 'Empresa não encontrada em Clientes nem em Prospecções',
  rotuloAlvo: 'Cliente ou prospecção',
  alvos: [
    { id: 50, nome: 'Casa Vicenzo', tabela: 'clientes' },
    { id: 30, nome: 'Marcenaria Serrana', tabela: 'prospeccoes' }
  ],
  aoDecidir: async d => { decididas.push(d); }
});

// ---------------------------------------------------------------------------
// O que a tela mostra
// ---------------------------------------------------------------------------

test('a tela diz de qual linha se trata e por que ela parou', () => {
  const b = montar({ pedido: PEDIDO([]) });

  // Sem o nome, a pessoa não sabe qual das linhas está decidindo; sem o motivo,
  // decide no escuro.
  assert.match(b.el('iaAcaoLido').textContent, /DS CONTEMPORÂNEA/);
  assert.match(b.el('iaAcaoMotivo').textContent, /não encontrada/);
  assert.equal(b.el('iaAcaoRotuloAlvo').textContent, 'Cliente ou prospecção');
});

test('a lista traz o que existe no sistema', () => {
  const b = montar({ pedido: PEDIDO([]) });
  const opcoes = b.el('iaAcaoEmpresas').filhos.map(o => o.value);
  assert.deepEqual(opcoes, ['Casa Vicenzo', 'Marcenaria Serrana']);
});

test('sem motivo do backend, ainda explica alguma coisa', () => {
  const b = montar({ pedido: { ...PEDIDO([]), motivo: null } });

  // Uma caixa vermelha vazia é pior que nenhuma: a pessoa fica procurando o
  // texto que não veio.
  assert.ok(b.el('iaAcaoMotivo').textContent.trim().length > 10);
});

// ---------------------------------------------------------------------------
// A escolha
// ---------------------------------------------------------------------------

test('a busca só aparece quando se escolhe apontar', () => {
  const b = montar({ pedido: PEDIDO([]) });
  assert.ok(b.el('iaAcaoBuscaEmpresa').escondido());

  b.marcar('apontar');
  assert.equal(b.el('iaAcaoBuscaEmpresa').escondido(), false);

  b.marcar('descartar');
  assert.ok(b.el('iaAcaoBuscaEmpresa').escondido());
});

test('confirmar nasce desligado e só liga com a decisão inteira', () => {
  const b = montar({ pedido: PEDIDO([]) });
  const botao = b.el('iaAcaoConfirmar');
  assert.ok(botao.disabled);

  // "Apontar" com o campo vazio não é uma decisão — é uma intenção. Botão
  // aceso ali só adianta o erro para depois do clique.
  b.marcar('apontar');
  assert.ok(botao.disabled, 'ligou sem empresa nenhuma escolhida');

  b.digitar('Casa Vic');
  assert.ok(botao.disabled, 'ligou com um nome pela metade');

  b.digitar('Casa Vicenzo');
  assert.equal(botao.disabled, false);
});

test('descartar não precisa de mais nada', () => {
  const b = montar({ pedido: PEDIDO([]) });
  b.marcar('descartar');
  assert.equal(b.el('iaAcaoConfirmar').disabled, false);
});

test('clicar no cartão marca a opção', () => {
  const b = montar({ pedido: PEDIDO([]) });

  // O rádio tem 12px. É alvo pequeno demais para a única decisão que esta tela
  // pede — o cartão inteiro responde.
  b.cartoes.descartar.cartao.disparar('click', { target: b.cartoes.descartar.cartao });
  assert.ok(b.cartoes.descartar.radio.checked);
  assert.equal(b.el('iaAcaoConfirmar').disabled, false);
});

test('caixa e acento não impedem de achar a empresa', () => {
  const b = montar({ pedido: PEDIDO([]) });
  b.marcar('apontar');
  b.digitar('  marcenaria serrana ');
  assert.equal(b.el('iaAcaoConfirmar').disabled, false);
});

// ---------------------------------------------------------------------------
// A decisão que volta
// ---------------------------------------------------------------------------

test('apontar devolve o REGISTRO, não o texto digitado', async () => {
  const decididas = [];
  const b = montar({ pedido: PEDIDO(decididas) });

  b.marcar('apontar');
  b.digitar('Marcenaria Serrana');
  b.confirmar();
  await b.pronta();

  // O que o formulário do outro lado precisa é o id e a tabela. Devolver o
  // nome faria a gravação passar e o orçamento abrir sem empresa nenhuma.
  assert.deepEqual(decididas, [{
    tipo: 'apontar',
    alvo: { id: 30, nome: 'Marcenaria Serrana', tabela: 'prospeccoes' }
  }]);
  assert.deepEqual(b.fechados, ['iaAcao']);
});

test('descartar devolve só isso', async () => {
  const decididas = [];
  const b = montar({ pedido: PEDIDO(decididas) });

  b.marcar('descartar');
  b.confirmar();
  await b.pronta();

  assert.deepEqual(decididas, [{ tipo: 'descartar' }]);
  assert.deepEqual(b.fechados, ['iaAcao']);
});

test('nome inventado não decide nada, e a tela continua aberta', async () => {
  const decididas = [];
  const b = montar({ pedido: PEDIDO(decididas) });

  b.marcar('apontar');
  // Um clique no botão desligado não deveria chegar aqui, mas o `disabled` de
  // um duplo não impede o disparo — e num navegador basta um Enter no formulário
  // para tentar o mesmo caminho.
  b.digitar('Empresa Que Não Existe');
  b.confirmar();
  await b.pronta();

  assert.deepEqual(decididas, []);
  assert.deepEqual(b.fechados, []);
  assert.match(b.toasts.at(-1).msg, /da lista/);
});

test('numa linha descartada, a opção vira "trazer de volta"', async () => {
  const decididas = [];
  const b = montar({ pedido: { ...PEDIDO(decididas), descartada: true } });

  // Oferecer "descartar" numa linha já descartada é um botão sem efeito — e um
  // botão que às vezes não faz nada ensina a ignorar a tela toda.
  assert.match(b.el('iaAcaoTituloDescartar').textContent, /trazer.*de volta/i);
  assert.match(b.el('iaAcaoAjudaDescartar').textContent, /volta a valer/i);

  b.marcar('descartar');
  b.confirmar();
  await b.pronta();

  assert.deepEqual(decididas, [{ tipo: 'restaurar' }]);
});

test('numa linha viva, a opção continua sendo descartar', async () => {
  const decididas = [];
  const b = montar({ pedido: PEDIDO(decididas) });

  assert.match(b.el('iaAcaoTituloDescartar').textContent, /descartar/i);
  b.marcar('descartar');
  b.confirmar();
  await b.pronta();

  assert.deepEqual(decididas, [{ tipo: 'descartar' }]);
});

test('cancelar sai sem decidir', async () => {
  const decididas = [];
  const b = montar({ pedido: PEDIDO(decididas) });

  b.marcar('descartar');
  b.el('iaAcaoCancelar').disparar('click');
  await b.pronta();

  assert.deepEqual(decididas, []);
  assert.deepEqual(b.fechados, ['iaAcao']);
});

test('sem pedido nenhum, a tela não explode', () => {
  // Acontece na restauração depois de uma queda, antes de o contexto voltar.
  const b = montar({ pedido: undefined });
  assert.ok(b.el('iaAcaoConfirmar').disabled);
  assert.equal(b.el('iaAcaoEmpresas').filhos.length, 0);
});
