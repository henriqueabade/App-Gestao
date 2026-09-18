/**
 * Rolagem encadeada entre a página/modal e as tabelas
 * (src/js/utils/rolagem-encadeada.js).
 *
 * As decisões ficam em funções puras — o tamanho da roda, qual tabela recebe
 * a rolagem quando a página chega no fim, e se um elemento ainda rola —, e o
 * ouvinte é exercitado com um duplo mínimo de DOM: tabela no limite passa a
 * rolar o modal; modal no limite passa a rolar a tabela.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', '..');
const SCRIPT = fs.readFileSync(path.join(SRC, 'js', 'utils', 'rolagem-encadeada.js'), 'utf8');

/** Um elemento que rola: altura visível, altura do conteúdo e posição. */
function rolador({ nome, visivel = 100, conteudo = 100, topo = 0, tabela = false, pai = null, caixa = { top: 0, bottom: 100 } }) {
  const el = {
    nome, clientHeight: visivel, scrollHeight: conteudo, scrollTop: topo, parentElement: pai,
    _tabela: tabela, _caixa: caixa, _filhos: [], rolado: 0,
    matches: sel => (sel.includes('.table-scroll') ? el._tabela : false),
    querySelector: sel => (sel === ':scope > table' && el._tabela ? {} : null),
    querySelectorAll: sel => (sel === 'table' ? [] : el._filhos.filter(f => f._tabela)),
    closest: sel => (sel === '[role="dialog"]' ? el._dialogo || null : null),
    contains: outro => { for (let n = outro; n; n = n.parentElement) if (n === el) return true; return false; },
    getBoundingClientRect: () => el._caixa,
    scrollBy: ({ top }) => { el.rolado += top; el.scrollTop += top; }
  };
  return el;
}

function carregar() {
  let ouvinte = null;
  class Element {}
  const contexto = {
    Element,
    getComputedStyle: el => ({ overflowY: el.clientHeight < el.scrollHeight ? 'auto' : 'visible' }),
    document: { getElementById: () => null },
    Number, Math, Boolean, Array, String
  };
  contexto.window = {
    addEventListener: (tipo, fn, opcoes) => { if (tipo === 'wheel') ouvinte = { fn, opcoes }; }
  };
  vm.createContext(contexto);
  vm.runInContext(SCRIPT, contexto);
  return { api: contexto.window.RolagemEncadeada, ouvinte, Element };
}

/** Modal (que rola) com uma tabela (que rola) dentro. */
function cena({ Element }, { topoModal, topoTabela }) {
  const modal = rolador({ nome: 'modal', visivel: 500, conteudo: 900, topo: topoModal, caixa: { top: 0, bottom: 500 } });
  const tabela = rolador({ nome: 'tabela', visivel: 200, conteudo: 600, topo: topoTabela, tabela: true, pai: modal, caixa: { top: 150, bottom: 350 } });
  const celula = rolador({ nome: 'celula', pai: tabela });
  const texto = rolador({ nome: 'texto', pai: modal });
  modal._filhos = [tabela];
  for (const el of [modal, tabela, celula, texto]) { Object.setPrototypeOf(el, Element.prototype); el._dialogo = modal; }
  return { modal, tabela, celula, texto };
}

const roda = (alvo, deltaY, extra = {}) => ({
  target: alvo, deltaY, deltaX: 0, deltaMode: 0, clientY: 250, ctrlKey: false, defaultPrevented: false,
  impedido: false, preventDefault() { this.impedido = true; }, ...extra
});

test('um ouvinte só, na janela, que pode impedir a rolagem nativa', () => {
  const { ouvinte, api } = carregar();
  assert.ok(ouvinte, 'escuta a roda');
  assert.strictEqual(ouvinte.opcoes.passive, false);
  assert.strictEqual(ouvinte.opcoes.capture, true);
  assert.strictEqual(typeof api.aoRolar, 'function');
  assert.match(api.SELETOR_TABELA, /\.table-scroll/);
  assert.match(api.SELETOR_TABELA, /\.fin-tabela/);
});

test('normalizarDelta: pixels, linhas e páginas', () => {
  const { api } = carregar();
  assert.strictEqual(api.normalizarDelta({ deltaY: 120, deltaMode: 0 }), 120);
  assert.strictEqual(api.normalizarDelta({ deltaY: 3, deltaMode: 1 }), 48);
  assert.strictEqual(api.normalizarDelta({ deltaY: -1, deltaMode: 2 }, 500), -500);
  assert.strictEqual(api.normalizarDelta({}), 0);
});

test('podeRolar: no topo não sobe, no fim não desce', () => {
  const { api } = carregar();
  const noTopo = { scrollTop: 0, clientHeight: 100, scrollHeight: 300 };
  const noFim = { scrollTop: 200, clientHeight: 100, scrollHeight: 300 };
  assert.strictEqual(api.podeRolar(noTopo, -10), false);
  assert.strictEqual(api.podeRolar(noTopo, 10), true);
  assert.strictEqual(api.podeRolar(noFim, 10), false);
  assert.strictEqual(api.podeRolar(noFim, -10), true);
  // Arredondamento de zoom: meio pixel antes do fim já é o fim.
  assert.strictEqual(api.podeRolar({ scrollTop: 199.5, clientHeight: 100, scrollHeight: 300 }, 10), false);
});

test('escolherTabela: a visível, que ainda rola, mais perto do mouse', () => {
  const { api } = carregar();
  const tela = { topoDaTela: 0, baseDaTela: 500 };
  const a = { el: 'a', top: 50, bottom: 150, podeRolar: true, ...tela };
  const b = { el: 'b', top: 300, bottom: 450, podeRolar: true, ...tela };
  const foraDaTela = { el: 'fora', top: 600, bottom: 800, podeRolar: true, ...tela };
  const noLimite = { el: 'limite', top: 200, bottom: 280, podeRolar: false, ...tela };
  assert.strictEqual(api.escolherTabela([a, b, foraDaTela, noLimite], 100), 'a', 'o mouse em cima de uma');
  assert.strictEqual(api.escolherTabela([a, b, foraDaTela, noLimite], 290), 'b', 'a mais perto');
  assert.strictEqual(api.escolherTabela([foraDaTela, noLimite], 250), null, 'nenhuma que sirva');
});

test('mouse na tabela: rola a tabela; no limite dela, a roda passa para o modal', () => {
  const carregado = carregar();
  const { aoRolar } = carregado.api;

  let c = cena(carregado, { topoModal: 100, topoTabela: 100 });
  let e = roda(c.celula, 50);
  aoRolar(e);
  assert.strictEqual(e.impedido, false, 'a tabela ainda rola: fica com o navegador');
  assert.strictEqual(c.modal.rolado, 0);

  c = cena(carregado, { topoModal: 100, topoTabela: 400 }); // tabela no fim
  e = roda(c.celula, 50);
  aoRolar(e);
  assert.strictEqual(e.impedido, true);
  assert.strictEqual(c.modal.rolado, 50, 'o modal rola no lugar da tabela');

  c = cena(carregado, { topoModal: 0, topoTabela: 0 }); // os dois no topo, subindo
  e = roda(c.celula, -50);
  aoRolar(e);
  assert.strictEqual(e.impedido, false, 'ninguém mais rola: não faz nada');
});

test('mouse fora da tabela: rola o modal; no limite dele, a roda passa para a tabela', () => {
  const carregado = carregar();
  const { aoRolar } = carregado.api;

  let c = cena(carregado, { topoModal: 100, topoTabela: 0 });
  let e = roda(c.texto, 50);
  aoRolar(e);
  assert.strictEqual(e.impedido, false, 'o modal ainda rola: fica com o navegador');

  c = cena(carregado, { topoModal: 400, topoTabela: 0 }); // modal no fim
  e = roda(c.texto, 50);
  aoRolar(e);
  assert.strictEqual(e.impedido, true);
  assert.strictEqual(c.tabela.rolado, 50, 'a tabela da tela rola');

  c = cena(carregado, { topoModal: 400, topoTabela: 0 });
  e = roda(c.texto, 50, { ctrlKey: true });
  aoRolar(e);
  assert.strictEqual(e.impedido, false, 'Ctrl+roda é o zoom: não mexe');
});

test('o menu carrega o utilitário, e a barra de rolagem das tabelas nos modais é a da casa', () => {
  const menu = fs.readFileSync(path.join(SRC, 'html', 'menu.html'), 'utf8');
  assert.ok(menu.includes('<script src="../js/utils/rolagem-encadeada.js"></script>'));
  const scroll = fs.readFileSync(path.join(SRC, 'styles', 'scroll.css'), 'utf8');
  assert.match(scroll, /\[role="dialog"\] \*::-webkit-scrollbar\s*\{[^}]*width:\s*6px/);
});

test('as caixas da DialogPadrao (<dialog> nativo) também têm a barra da casa', () => {
  // `[role="dialog"]` só casa com o ATRIBUTO escrito; o papel implícito do
  // <dialog> não conta. O relatório de importação CSV rolava com a barra cinza
  // e grossa do sistema por isso — e com ele toda caixa da DialogPadrao.
  const dialogo = fs.readFileSync(path.join(SRC, 'components', 'dialogPadrao.js'), 'utf8');
  assert.match(dialogo, /document\.createElement\('dialog'\)/,
    'a DialogPadrao deixou de ser <dialog> nativo — reveja o seletor da seção 3c do scroll.css');

  const scroll = fs.readFileSync(path.join(SRC, 'styles', 'scroll.css'), 'utf8');
  const bloco = seletor => {
    const i = scroll.indexOf(seletor);
    return i < 0 ? null : scroll.slice(i, scroll.indexOf('}', i) + 1);
  };

  const largura = bloco('dialog *::-webkit-scrollbar,');
  assert.ok(largura, 'a largura da barra não vale para <dialog> nativo');
  assert.match(largura, /width:\s*6px/);

  const trilho = bloco('dialog *::-webkit-scrollbar-track,');
  assert.ok(trilho, 'o trilho da barra não vale para <dialog> nativo');
  assert.match(trilho, /background:\s*transparent/);

  const cursor = bloco('dialog *::-webkit-scrollbar-thumb,');
  assert.ok(cursor, 'o cursor dourado não vale para <dialog> nativo');
  assert.match(cursor, /rgba\(255,\s*215,\s*0,\s*0\.4\)/);
});
