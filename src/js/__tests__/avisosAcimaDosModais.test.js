/**
 * O aviso (showToast) fica por cima de TODO modal, inclusive dos que abrem
 * com `<dialog>.showModal()` e entram na top layer do navegador (editor de
 * tarefa, Calendário, Tarefas, importação de planilha, DialogPadrao).
 *
 * Antes o aviso tinha só `z-index: 11000`, e nenhum z-index passa por cima da
 * top layer: ele aparecia ATRÁS do editor de tarefa, borrado pelo vidro.
 *
 * O arquivo roda num contexto isolado com um DOM falso que registra, em
 * ordem, o que a caixa dos avisos faz com a top layer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ARQUIVO = path.join(__dirname, '..', 'utils', 'notifications.js');

function montar({ comPopover = true } = {}) {
  const eventos = [];
  const timers = [];
  let observador = null;

  function criarElemento(tag) {
    const filhos = [];
    const atributos = new Map();
    const classes = new Set();
    let aberto = false;
    const el = {
      tagName: String(tag).toUpperCase(),
      id: '',
      style: {},
      textContent: '',
      parentNode: null,
      isConnected: false,
      get className() { return [...classes].join(' '); },
      set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
      classList: {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        contains: c => classes.has(c),
      },
      get childElementCount() { return filhos.length; },
      get firstElementChild() { return filhos[0] || null; },
      appendChild(filho) {
        filhos.push(filho);
        filho.parentNode = el;
        filho.isConnected = el.isConnected;
        return filho;
      },
      remove() {
        if (!el.parentNode) return;
        const irmaos = el.parentNode.__filhos;
        irmaos.splice(irmaos.indexOf(el), 1);
        el.parentNode = null;
        el.isConnected = false;
      },
      __filhos: filhos,
      setAttribute: (n, v) => atributos.set(n, String(v)),
      hasAttribute: n => atributos.has(n),
      getAttribute: n => (atributos.has(n) ? atributos.get(n) : null),
      matches: sel => (sel === ':popover-open' ? aberto : false),
      get offsetHeight() { eventos.push('estilo'); return 40; },
    };
    if (comPopover) {
      el.showPopover = () => {
        if (!atributos.has('popover')) throw new Error('NotSupportedError: sem atributo popover');
        if (aberto) throw new Error('InvalidStateError: já aberto');
        aberto = true;
        eventos.push('mostra');
      };
      el.hidePopover = () => {
        if (!aberto) throw new Error('InvalidStateError: já fechado');
        aberto = false;
        eventos.push('esconde');
      };
    }
    return el;
  }

  const body = criarElemento('body');
  body.isConnected = true;
  const documentElement = criarElemento('html');
  documentElement.isConnected = true;

  const document = {
    body,
    documentElement,
    getElementById: () => null,
    createElement: criarElemento,
  };

  class MutationObserverFalso {
    constructor(cb) { this.cb = cb; observador = this; }
    observe(alvo, opcoes) { this.alvo = alvo; this.opcoes = opcoes; }
    disparar(registros) { this.cb(registros); }
  }

  const sandbox = {
    document,
    MutationObserver: MutationObserverFalso,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ARQUIVO, 'utf8'), sandbox, { filename: 'notifications.js' });

  const caixa = () => body.__filhos.find(f => f.id === 'notification');
  const rodarTimers = () => {
    while (timers.length) timers.shift().fn();
  };
  return { sandbox, eventos, caixa, rodarTimers, observador: () => observador };
}

test('o aviso entra na top layer como popover manual, sem fundo nem borda de popover', () => {
  const { sandbox, eventos, caixa } = montar();
  sandbox.showToast('Não foi possível salvar', 'error');

  const c = caixa();
  assert.equal(c.getAttribute('popover'), 'manual', 'manual: não fecha outros popovers nem rouba o foco');
  assert.ok(c.matches(':popover-open'));
  assert.deepEqual(eventos, ['estilo', 'mostra']);

  // O estilo próprio do popover (inset 0, margin auto, borda, fundo Canvas)
  // tiraria a coluna de avisos do lugar e pintaria um quadro em volta.
  assert.equal(c.style.inset, 'auto');
  assert.equal(c.style.left, '50%');
  assert.equal(c.style.top, '50%');
  assert.equal(c.style.marginTop, '5rem');
  assert.equal(c.style.border, '0');
  assert.equal(c.style.padding, '0');
  assert.equal(c.style.background, 'transparent');
  assert.equal(c.style.pointerEvents, 'none');
  // Sem suporte a popover, o z-index continua valendo.
  assert.equal(c.style.zIndex, '11000');
});

test('o aviso não toma o clique do botão do modal que estiver embaixo dele', () => {
  const { sandbox, caixa } = montar();
  sandbox.showToast('Salvo', 'success');
  assert.equal(caixa().firstElementChild.style.pointerEvents, 'none');
});

test('cada aviso novo repõe a caixa no topo: esconde, atualiza o estilo e mostra', () => {
  // Esconder e mostrar sem atualizar o estilo no meio não adianta: o Chromium
  // só tira da top layer na próxima atualização de estilo e o popover voltava
  // para a posição antiga, atrás do diálogo que abriu depois dele.
  const { sandbox, eventos } = montar();
  sandbox.showToast('Primeiro', 'info');
  eventos.length = 0;
  sandbox.showToast('Segundo', 'info');
  assert.deepEqual(eventos, ['esconde', 'estilo', 'mostra']);
});

test('diálogo aberto com aviso na tela: o aviso volta para a frente dele', () => {
  const { sandbox, eventos, observador } = montar();
  sandbox.showToast('Tarefa criada.', 'success');

  const vigia = observador();
  assert.ok(vigia, 'ninguém vigia a abertura de diálogos');
  assert.equal(vigia.alvo, sandbox.document.documentElement);
  assert.equal(vigia.opcoes.subtree, true);
  assert.deepEqual([...vigia.opcoes.attributeFilter], ['open']);

  eventos.length = 0;
  vigia.disparar([{ target: { tagName: 'DIALOG', open: true } }]);
  assert.deepEqual(eventos, ['esconde', 'estilo', 'mostra']);

  // <details open> e diálogo fechando não mexem no aviso.
  eventos.length = 0;
  vigia.disparar([{ target: { tagName: 'DETAILS', open: true } }, { target: { tagName: 'DIALOG', open: false } }]);
  assert.deepEqual(eventos, []);
});

test('sem aviso na tela, a caixa sai da top layer e o diálogo que abrir não a traz de volta', () => {
  const { sandbox, eventos, caixa, rodarTimers, observador } = montar();
  sandbox.showToast('Some em 3 segundos', 'info');
  eventos.length = 0;
  rodarTimers();

  assert.equal(caixa().childElementCount, 0);
  assert.equal(caixa().matches(':popover-open'), false);
  assert.deepEqual(eventos, ['esconde']);

  eventos.length = 0;
  observador().disparar([{ target: { tagName: 'DIALOG', open: true } }]);
  assert.deepEqual(eventos, [], 'caixa vazia não volta para a top layer');
});

test('sem suporte a popover, o aviso aparece como antes (z-index), sem erro', () => {
  const { sandbox, caixa } = montar({ comPopover: false });
  assert.doesNotThrow(() => sandbox.showToast('Aviso', 'info'));
  const c = caixa();
  assert.equal(c.childElementCount, 1);
  assert.equal(c.style.zIndex, '11000');
});
