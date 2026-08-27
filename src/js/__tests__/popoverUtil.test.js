/**
 * O posicionador de popover (src/js/utils/popover.js), exercitado de verdade.
 *
 * Até aqui ele só tinha verificações de TEXTO — "existe um `addEventListener`
 * de scroll?" —, e três defeitos seguidos passaram por elas: o popover atrás do
 * modal, o popover esquecido no `<body>` ao trocar de módulo, e o popover que
 * abria e não fechava mais. Nenhum desses um `grep` pega.
 *
 * O duplo abaixo é o mínimo de DOM que o utilitário toca. Ele é pequeno de
 * propósito: cada coisa que ele finge é uma coisa que o teste NÃO está medindo,
 * e vale saber quais são.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

// ---------------------------------------------------------------------------
// O duplo de DOM
// ---------------------------------------------------------------------------

function criarElemento(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    parentElement: null,
    filhos: [],
    style: {},
    dataset: {},
    _classes: new Set(),
    _rect: { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 },
    _z: 'auto'
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

  el.appendChild = filho => {
    if (filho.parentElement) filho.parentElement.remover(filho);
    filho.parentElement = el;
    el.filhos.push(filho);
    return filho;
  };
  el.remover = filho => {
    const i = el.filhos.indexOf(filho);
    if (i >= 0) el.filhos.splice(i, 1);
  };
  el.remove = () => {
    el.parentElement?.remover(el);
    el.parentElement = null;
  };

  el.getBoundingClientRect = () => el._rect;
  el.matches = seletor => {
    const m = /^\[id\$="(.+)"\]$/.exec(seletor);
    if (m) return el.id.endsWith(m[1]);
    if (seletor.startsWith('#')) return el.id === seletor.slice(1);
    return false;
  };
  el.querySelector = seletor => descendentes(el).find(d => d.matches(seletor)) || null;
  el.querySelectorAll = seletor => descendentes(el).filter(d => d.matches(seletor));

  // Continência: é o que decide o que é "clique fora".
  el.contains = outro => {
    if (outro === el) return true;
    return descendentes(el).includes(outro);
  };

  return el;
}

function descendentes(el) {
  const saida = [];
  for (const f of el.filhos) { saida.push(f); saida.push(...descendentes(f)); }
  return saida;
}

/**
 * Monta o ambiente e carrega o utilitário nele.
 *
 * O utilitário é lido e avaliado a cada montagem porque ele se registra em
 * `window` e pendura escutas no `document` na carga: reaproveitar um módulo já
 * carregado faria um teste ver as escutas do teste anterior.
 */
function montar() {
  const body = criarElemento('body');
  body.id = 'body';

  const conteudo = criarElemento('div');
  conteudo.id = 'content';
  body.appendChild(conteudo);

  const escutasDoc = [];
  const escutasWin = [];
  const observadores = [];

  const doc = {
    body,
    readyState: 'complete',
    createElement: criarElemento,
    getElementById: id => (id === 'content' ? conteudo : descendentes(body).find(d => d.id === id) || null),
    querySelectorAll: seletor => {
      // Só o seletor que o utilitário usa: filhos diretos do body.
      if (seletor === 'body > div') return body.filhos.filter(f => f.tagName === 'DIV');
      const idm = /^#(.+)$/.exec(seletor);
      if (idm) return descendentes(body).filter(d => d.id === idm[1]);
      return [];
    },
    addEventListener: (tipo, fn, opcoes) => escutasDoc.push({ tipo, fn, opcoes })
  };

  const win = {
    innerWidth: 1600,
    innerHeight: 900,
    addEventListener: (tipo, fn, opcoes) => escutasWin.push({ tipo, fn, opcoes }),
    getComputedStyle: el => ({ zIndex: el._z })
  };

  class ObservadorFalso {
    constructor(fn) { this.fn = fn; observadores.push(this); }
    observe() { this.observando = true; }
  }

  const contexto = {
    window: win,
    document: doc,
    MutationObserver: ObservadorFalso,
    CSS: { escape: v => v },
    Number, String, Math, Set, Map, Array, Boolean
  };
  contexto.window.document = doc;

  const fonte = fs.readFileSync(
    path.join(__dirname, '..', 'utils', 'popover.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'MutationObserver', 'CSS', fonte)(
    win, doc, ObservadorFalso, contexto.CSS);

  const dispararDoc = (tipo, evento) =>
    escutasDoc.filter(e => e.tipo === tipo).forEach(e => e.fn(evento));
  // O alvo importa: rolar DENTRO do popover é diferente de rolar a página.
  const dispararWin = (tipo, evento = {}) =>
    escutasWin.filter(e => e.tipo === tipo).forEach(e => e.fn(evento));

  return {
    Popover: win.Popover,
    body, conteudo, doc, win, observadores,
    escutasDoc, escutasWin,
    dispararDoc, dispararWin,
    /** Um popover e a âncora dele, já dentro de um modal com desfoque. */
    montarPar(id = 'meuPopover') {
      const modal = criarElemento('div');
      modal.id = 'algumOverlay';
      modal._z = '2000';
      body.appendChild(modal);

      const popover = criarElemento('div');
      popover.id = id;
      popover._rect = { top: 0, left: 0, bottom: 0, right: 0, width: 300, height: 200 };
      modal.appendChild(popover);

      const ancora = criarElemento('i');
      ancora._rect = { top: 100, left: 400, bottom: 116, right: 416, width: 16, height: 16 };
      modal.appendChild(ancora);

      return { modal, popover, ancora };
    }
  };
}

const aberto = p => p._classes.has('show');

// ---------------------------------------------------------------------------
// Posição e camada
// ---------------------------------------------------------------------------

test('o popover sai de dentro do modal desfocado', () => {
  const b = montar();
  const { modal, popover, ancora } = b.montarPar();

  assert.strictEqual(popover.parentElement, modal);
  b.Popover.abrir(popover, ancora);

  // `backdrop-filter` cria bloco de contenção: lá dentro, `fixed` deixa de ser
  // relativo à janela e o popover aparece a uma distância exatamente igual ao
  // canto do modal. Fora, a conta volta a bater.
  assert.strictEqual(popover.parentElement, b.body);
  assert.strictEqual(popover.style.position, 'fixed');
});

test('a camada fica acima do modal que estiver aberto', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();

  b.Popover.abrir(popover, ancora);

  // O modal do duplo está em 2000, que é o que `Modal.open` aplica. Um popover
  // com número menor fica ATRÁS — e o sintoma engana: ele está lá, do tamanho
  // certo, na posição certa, coberto pela área borrada.
  assert.ok(Number(popover.style.zIndex) > 2000,
    `camada ${popover.style.zIndex} não passa do modal em 2000`);
});

test('a camada sobe se um modal abrir mais alto ainda', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();

  const outro = criarElemento('div');
  outro.id = 'outroOverlay';
  outro._z = '5000';
  b.body.appendChild(outro);

  b.Popover.abrir(popover, ancora);
  assert.ok(Number(popover.style.zIndex) > 5000);
});

test('sem modal nenhum aberto, ainda fica acima da página', () => {
  const b = montar();

  // O (i) da LISTA do módulo abre sem modal nenhum na tela. Sem piso, a camada
  // seria calculada a partir do nada e o popover nasceria no rés do chão —
  // atrás do cabeçalho, dos filtros e da própria tabela.
  const popover = criarElemento('div');
  popover.id = 'iaLinhaPopover';
  popover._rect = { top: 0, left: 0, bottom: 0, right: 0, width: 300, height: 200 };
  b.conteudo.appendChild(popover);

  const ancora = criarElemento('i');
  ancora._rect = { top: 100, left: 400, bottom: 116, right: 416, width: 16, height: 16 };
  b.conteudo.appendChild(ancora);

  b.Popover.abrir(popover, ancora);

  // O número vem do utilitário de MODAL, não do próprio popover: comparar com
  // `Popover.PISO` seria tautologia — baixar o piso baixaria a régua junto, e o
  // teste continuaria verde com o popover atrás de todo modal do programa.
  const modalJs = fs.readFileSync(
    path.join(__dirname, '..', '..', 'utils', 'modal.js'), 'utf8');
  const minimo = Number(/minZIndex\s*=\s*(\d+)/.exec(modalJs)[1]);
  assert.ok(Number(popover.style.zIndex) > minimo,
    `camada ${popover.style.zIndex} não passa do minZIndex ${minimo} dos modais`);
});

test('não cabendo embaixo, abre para cima', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();

  // Âncora numa linha do fim da tabela: 800 + 8 + 200 passa dos 900 da janela.
  ancora._rect = { top: 790, left: 400, bottom: 806, right: 416, width: 16, height: 16 };
  b.Popover.abrir(popover, ancora);

  // Abrindo para baixo, o conteúdo ficaria fora da tela e inalcançável.
  assert.ok(Number.parseInt(popover.style.top, 10) < 790,
    `abriu em ${popover.style.top}, abaixo da âncora`);
});

test('não cabendo à direita, encosta na borda', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();

  ancora._rect = { top: 100, left: 1560, bottom: 116, right: 1576, width: 16, height: 16 };
  b.Popover.abrir(popover, ancora);

  const esquerda = Number.parseInt(popover.style.left, 10);
  assert.ok(esquerda + 300 <= 1600, `direita em ${esquerda + 300} passa da janela`);
});

// ---------------------------------------------------------------------------
// Fechar
// ---------------------------------------------------------------------------

test('clique fora fecha', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);
  assert.ok(aberto(popover));

  const longe = criarElemento('div');
  b.conteudo.appendChild(longe);
  b.dispararDoc('click', { target: longe });

  // Sem isto ele só sumia clicando no mesmo (i) de novo — e, morando no
  // `<body>` por cima de tudo, ficava plantado na frente das linhas que a
  // pessoa queria ler.
  assert.strictEqual(aberto(popover), false);
});

test('clique DENTRO não fecha', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);

  const campo = criarElemento('input');
  popover.appendChild(campo);
  b.dispararDoc('click', { target: campo });

  // A caixa de escolha tem campo e botões dentro: fechar ao clicar neles a
  // tornaria impossível de usar.
  assert.ok(aberto(popover));
});

test('clique na própria âncora não fecha', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);

  // A escuta é de CAPTURA, então roda antes do handler que abre. Fechar aqui
  // faria o clique que abre fechar no mesmo gesto.
  b.dispararDoc('click', { target: ancora });
  assert.ok(aberto(popover));
});

test('Escape fecha', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);

  b.dispararDoc('keydown', { key: 'Escape' });
  assert.strictEqual(aberto(popover), false);
});

test('outra tecla não fecha', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);

  b.dispararDoc('keydown', { key: 'a' });
  assert.ok(aberto(popover));
});

test('rolar fecha — a âncora saiu de vista', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);

  const tabela = criarElemento('div');
  b.conteudo.appendChild(tabela);
  b.dispararWin('scroll', { target: tabela });
  assert.strictEqual(aberto(popover), false);
});

test('rolar DENTRO do popover não o fecha', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);

  // O popover tem teto de altura e rola sozinho quando a linha tem campos
  // demais. Fechar ao rolar tornaria os campos de baixo inalcançáveis — e foi
  // exatamente o que aconteceu com quem tentou arrastar a barra de dentro.
  b.dispararWin('scroll', { target: popover });
  assert.ok(aberto(popover));

  const campo = criarElemento('input');
  popover.appendChild(campo);
  b.dispararWin('scroll', { target: campo });
  assert.ok(aberto(popover));
});

test('fechado por rolagem, o popover ainda REABRE', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);

  b.dispararWin('scroll', { target: b.conteudo });
  assert.strictEqual(aberto(popover), false);

  // `descartar` tira o elemento do documento, e quem abre o procura por id.
  // Descartado, `getElementById` devolve null e o popover não reabre mais
  // enquanto o modal não for fechado e aberto de novo.
  assert.strictEqual(b.doc.getElementById(popover.id), popover,
    'o popover sumiu do documento e não pode mais ser reaberto');

  b.Popover.abrir(popover, ancora);
  assert.ok(aberto(popover));
});

test('redimensionar fecha, mas também não descarta', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);

  b.dispararWin('resize');
  assert.strictEqual(aberto(popover), false);
  assert.strictEqual(b.doc.getElementById(popover.id), popover);

  b.Popover.abrir(popover, ancora);
  assert.ok(aberto(popover));
});

test('a escuta de rolagem é de captura', () => {
  const b = montar();
  const escuta = b.escutasWin.find(e => e.tipo === 'scroll');
  assert.ok(escuta, 'ninguém escuta a rolagem');

  // A grade de revisão rola por DENTRO, e o evento de um contêiner que rola
  // não sobe até `window` na fase de bolha. Sem captura, a escuta existe e
  // não serve.
  assert.strictEqual(escuta.opcoes?.capture, true);
});

// ---------------------------------------------------------------------------
// Devolver
// ---------------------------------------------------------------------------

test('descartar tira o popover do body', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);
  assert.strictEqual(popover.parentElement, b.body);

  b.Popover.descartar(popover);
  assert.strictEqual(popover.parentElement, null);
});

test('trocar de módulo devolve o que ficou aberto', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);

  // Trocar de módulo substitui o conteúdo de `#content`. O popover não sai
  // junto: foi assim que um popover da lista de leituras apareceu por cima de
  // Relatórios, congelado, sem nada que o fizesse sumir.
  const observador = b.observadores[0];
  assert.ok(observador?.observando, 'ninguém observa a troca de módulo');
  observador.fn([{ removedNodes: [criarElemento('div')] }]);

  assert.strictEqual(popover.parentElement, null);
});

test('linha de tabela entrando e saindo não derruba o popover', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar();
  b.Popover.abrir(popover, ancora);

  // Só a substituição do módulo interessa — não cada redesenho da grade.
  b.observadores[0].fn([{ addedNodes: [criarElemento('tr')], removedNodes: [] }]);
  assert.strictEqual(popover.parentElement, b.body);
});

test('sobra de uma abertura anterior não sequestra o id', () => {
  const b = montar();
  const { popover, ancora } = b.montarPar('iaDetLinhaPopover');
  b.Popover.abrir(popover, ancora);

  // O modal reabriu e trouxe um popover novo com o MESMO id; o velho ficou no
  // `<body>`. `getElementById` devolve o primeiro do documento — o velho, que
  // está solto e não escuta mais ninguém.
  const novoModal = criarElemento('div');
  novoModal.id = 'algumOverlay';
  novoModal._z = '2000';
  b.body.appendChild(novoModal);
  const novo = criarElemento('div');
  novo.id = 'iaDetLinhaPopover';
  novo._rect = { top: 0, left: 0, bottom: 0, right: 0, width: 300, height: 200 };
  novoModal.appendChild(novo);

  b.Popover.abrir(novo, ancora);

  const comEsseId = b.body.filhos.filter(f => f.id === 'iaDetLinhaPopover');
  assert.strictEqual(comEsseId.length, 1, 'sobrou mais de um popover com o mesmo id');
  assert.strictEqual(comEsseId[0], novo);
});
