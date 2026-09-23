/**
 * DOM mínimo para os testes de modal.
 *
 * O projeto não usa jsdom: cada teste que precisa de DOM monta um de mentira
 * do tamanho do que exercita. Este cobre o que os modais de datas e de
 * pagamento do pedido usam de verdade:
 *
 *  - HTML lido por `innerHTML` (o arquivo real do modal, não uma cópia);
 *  - seletores simples: tag, #id, .classe, [atributo], [atributo="valor"]
 *    (aspas simples ou duplas, e ^= $= *=), `:checked`, listas separadas por
 *    vírgula e descendente por espaço;
 *  - eventos com captura, alvo e borbulha, `stopPropagation` e
 *    `stopImmediatePropagation` — é o que decide se um Esc vaza para o modal
 *    de baixo;
 *  - propriedades de formulário: value, checked (com exclusão entre rádios
 *    do mesmo nome), disabled, options de select.
 *
 * Não é um navegador: não há layout, estilo computado nem foco de verdade.
 * Um seletor fora do que está acima LANÇA, para o teste não passar olhando
 * para nada.
 *
 * Fica fora do padrão `*.test.js`, então o `node --test` não o executa como
 * teste.
 */
'use strict';

const VAZIOS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const TEXTO_CRU = new Set(['script', 'style', 'textarea', 'title']);
const OUVINTES = Symbol('ouvintes');

function decodificar(texto) {
  return String(texto)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const escaparTexto = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escaparAtributo = t => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------ eventos

class Evento {
  constructor(tipo, init = {}) {
    Object.assign(this, init);
    this.type = tipo;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.detail = init.detail === undefined ? null : init.detail;
    this.defaultPrevented = false;
    this.isTrusted = false;
    this.target = null;
    this.currentTarget = null;
    this._parado = false;
    this._paradoJa = false;
  }

  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._parado = true; }
  stopImmediatePropagation() { this._parado = true; this._paradoJa = true; }
}

function ehCaptura(opcoes) {
  return opcoes === true || Boolean(opcoes && typeof opcoes === 'object' && opcoes.capture);
}

function ouvir(alvo, tipo, fn, opcoes) {
  if (!fn) return;
  const captura = ehCaptura(opcoes);
  const lista = alvo[OUVINTES];
  if (lista.some(o => o.tipo === tipo && o.fn === fn && o.captura === captura)) return;
  lista.push({ tipo, fn, captura, uma: Boolean(opcoes && typeof opcoes === 'object' && opcoes.once) });
}

function desouvir(alvo, tipo, fn, opcoes) {
  const captura = ehCaptura(opcoes);
  const lista = alvo[OUVINTES];
  const i = lista.findIndex(o => o.tipo === tipo && o.fn === fn && o.captura === captura);
  if (i >= 0) lista.splice(i, 1);
}

/** Do alvo até a janela: elemento → ... → <html> → document → window. */
function caminhoDe(alvo) {
  const caminho = [];
  let no = alvo;
  while (no) {
    caminho.push(no);
    if (no._ehJanela) break;
    if (no._ehDocumento) { no = no._janela; continue; }
    if (no.parentNode) { no = no.parentNode; continue; }
    const doc = no.ownerDocument;
    no = doc && doc.documentElement === no ? doc : null;
  }
  return caminho;
}

/**
 * Despacho com as três fases. No alvo, os ouvintes de captura rodam antes
 * dos outros, como no Chromium desde a versão 89.
 */
function despachar(alvo, evento) {
  evento.target = alvo;
  evento._parado = false;
  evento._paradoJa = false;
  const caminho = caminhoDe(alvo);

  const chamar = (no, fase) => {
    evento.currentTarget = no;
    evento.eventPhase = fase;
    const doTipo = no[OUVINTES].filter(o => o.tipo === evento.type);
    const lista = fase === 2
      ? [...doTipo.filter(o => o.captura), ...doTipo.filter(o => !o.captura)]
      : doTipo.filter(o => (fase === 1 ? o.captura : !o.captura));
    for (const o of lista) {
      if (!no[OUVINTES].includes(o)) continue; // saiu durante o despacho
      if (o.uma) desouvir(no, o.tipo, o.fn, o.captura);
      if (typeof o.fn === 'function') o.fn.call(no, evento);
      else o.fn.handleEvent(evento);
      if (evento._paradoJa) break;
    }
  };

  for (let i = caminho.length - 1; i >= 1 && !evento._parado; i--) chamar(caminho[i], 1);
  if (!evento._parado) chamar(caminho[0], 2);
  if (evento.bubbles) {
    for (let i = 1; i < caminho.length && !evento._parado; i++) chamar(caminho[i], 3);
  }
  evento.currentTarget = null;
  return !evento.defaultPrevented;
}

class AlvoDeEventos {
  constructor() { this[OUVINTES] = []; }
  addEventListener(tipo, fn, opcoes) { ouvir(this, tipo, fn, opcoes); }
  removeEventListener(tipo, fn, opcoes) { desouvir(this, tipo, fn, opcoes); }
  dispatchEvent(evento) { return despachar(this, evento); }
}

// ---------------------------------------------------------------- seletores

/** Divide por `sep` fora de colchetes e aspas. */
function dividirFora(texto, ehSeparador) {
  const partes = [];
  let atual = '';
  let colchetes = 0;
  let aspas = null;
  for (const c of String(texto)) {
    if (aspas) { atual += c; if (c === aspas) aspas = null; continue; }
    if (c === '"' || c === "'") { aspas = c; atual += c; continue; }
    if (c === '[') colchetes += 1;
    if (c === ']') colchetes -= 1;
    if (colchetes === 0 && ehSeparador(c)) { partes.push(atual); atual = ''; continue; }
    atual += c;
  }
  partes.push(atual);
  return partes.map(p => p.trim()).filter(Boolean);
}

function compilarComposto(texto) {
  const testes = [];
  let resto = texto;
  const tag = /^(\*|[a-zA-Z][\w-]*)/.exec(resto);
  if (tag) {
    const nome = tag[1].toLowerCase();
    if (nome !== '*') testes.push(el => el.localName === nome);
    resto = resto.slice(tag[0].length);
  }
  while (resto) {
    let m;
    if ((m = /^#([\w-]+)/.exec(resto))) {
      const id = m[1];
      testes.push(el => el.id === id);
    } else if ((m = /^\.([\w-]+)/.exec(resto))) {
      const classe = m[1];
      testes.push(el => el.classList.contains(classe));
    } else if ((m = /^\[\s*([\w-]+)\s*(?:([\^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/.exec(resto))) {
      const [, nome, op, v1, v2, v3] = m;
      const valor = v1 ?? v2 ?? v3;
      testes.push(el => {
        if (!el.hasAttribute(nome)) return false;
        if (!op) return true;
        const atual = el.getAttribute(nome);
        if (op === '=') return atual === valor;
        if (op === '^=') return atual.startsWith(valor);
        if (op === '$=') return atual.endsWith(valor);
        return atual.includes(valor);
      });
    } else if ((m = /^:checked/.exec(resto))) {
      testes.push(el => el.checked === true);
    } else {
      throw new Error(`seletor não suportado pelo DOM mínimo: ${texto}`);
    }
    resto = resto.slice(m[0].length);
  }
  return el => testes.every(t => t(el));
}

function compilarSeletor(seletor) {
  return dividirFora(seletor, c => c === ',').map(parte => {
    const cadeia = dividirFora(parte, c => /\s/.test(c)).map(compilarComposto);
    return el => {
      if (!cadeia[cadeia.length - 1](el)) return false;
      let atual = el.parentElement;
      for (let i = cadeia.length - 2; i >= 0; i--) {
        while (atual && !cadeia[i](atual)) atual = atual.parentElement;
        if (!atual) return false;
        atual = atual.parentElement;
      }
      return true;
    };
  });
}

// -------------------------------------------------------------------- nós

class No extends AlvoDeEventos {
  constructor(doc) {
    super();
    this.ownerDocument = doc;
    this.parentNode = null;
  }

  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }

  get isConnected() {
    let no = this;
    while (no.parentNode) no = no.parentNode;
    return Boolean(this.ownerDocument) && no === this.ownerDocument.documentElement;
  }

  remove() { if (this.parentNode) this.parentNode._retirar(this); }
}

class Texto extends No {
  constructor(doc, dados) {
    super(doc);
    this.nodeType = 3;
    this.data = String(dados);
  }

  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v ?? ''); }
}

function parsearHtml(html, doc) {
  const topo = [];
  const pilha = [];
  const anexar = no => {
    const pai = pilha[pilha.length - 1];
    if (pai) pai._inserir(no);
    else topo.push(no);
  };
  const fonte = String(html);
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(fonte))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = pilha.length - 1; i >= 0; i--) {
        if (pilha[i].localName === tag) { pilha.length = i; break; }
      }
      continue;
    }
    if (m[2]) {
      const tag = m[2].toLowerCase();
      const el = doc.createElement(tag);
      const reAtributo = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = reAtributo.exec(m[3] || ''))) {
        el.setAttribute(a[1], decodificar(a[2] ?? a[3] ?? a[4] ?? ''));
      }
      anexar(el);
      if (VAZIOS.has(tag) || m[4] === '/') continue;
      if (TEXTO_CRU.has(tag)) {
        const fim = fonte.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
        const conteudo = fim === -1 ? fonte.slice(re.lastIndex) : fonte.slice(re.lastIndex, fim);
        if (conteudo) el._inserir(doc.createTextNode(decodificar(conteudo)));
        re.lastIndex = fim === -1 ? fonte.length : fonte.indexOf('>', fim) + 1;
        continue;
      }
      pilha.push(el);
      continue;
    }
    if (m[5]) anexar(doc.createTextNode(decodificar(m[5])));
  }
  return topo;
}

function serializar(no) {
  if (no.nodeType === 3) return escaparTexto(no.data);
  const atributos = Array.from(no._atributos.entries())
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escaparAtributo(v)}"`))
    .join('');
  if (VAZIOS.has(no.localName)) return `<${no.localName}${atributos}>`;
  return `<${no.localName}${atributos}>${no.childNodes.map(serializar).join('')}</${no.localName}>`;
}

/**
 * `style`: propriedades soltas (el.style.color = ...) mais a API de
 * declaração (setProperty com prioridade), que o código usa quando precisa
 * de `!important`.
 */
function criarEstilo() {
  const prioridades = new Map();
  const estilo = {};
  const paraCamelo = nome => String(nome).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  Object.defineProperties(estilo, {
    setProperty: {
      value(nome, valor, prioridade = '') {
        estilo[paraCamelo(nome)] = String(valor);
        if (prioridade) prioridades.set(nome, prioridade);
        else prioridades.delete(nome);
      }
    },
    removeProperty: {
      value(nome) {
        const antes = estilo[paraCamelo(nome)] ?? '';
        delete estilo[paraCamelo(nome)];
        prioridades.delete(nome);
        return antes;
      }
    },
    getPropertyValue: { value: nome => estilo[paraCamelo(nome)] ?? '' },
    getPropertyPriority: { value: nome => prioridades.get(nome) || '' }
  });
  return estilo;
}

const BOOLEANOS = ['disabled', 'hidden', 'readOnly', 'required'];
const CONTROLES = new Set(['button', 'input', 'select', 'textarea']);

class Elemento extends No {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.childNodes = [];
    this._atributos = new Map();
    this.style = criarEstilo();
    this._valor = undefined;
    this._marcado = undefined;
    this._escolhida = undefined;
    this._semSelecao = false;
    this.selectionStart = null;
    this.selectionEnd = null;
  }

  // ----- atributos
  getAttribute(nome) { return this._atributos.has(nome) ? this._atributos.get(nome) : null; }
  setAttribute(nome, valor) { this._atributos.set(String(nome), String(valor)); }
  hasAttribute(nome) { return this._atributos.has(nome); }
  removeAttribute(nome) { this._atributos.delete(nome); }

  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get name() { return this.getAttribute('name') || ''; }
  set name(v) { this.setAttribute('name', v); }
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', v); }

  get type() {
    const bruto = this.getAttribute('type');
    if (this.localName === 'input') return (bruto || 'text').toLowerCase();
    if (this.localName === 'button') return (bruto || 'submit').toLowerCase();
    return bruto || '';
  }
  set type(v) { this.setAttribute('type', v); }

  get classList() {
    const el = this;
    const ler = () => el.className.split(/\s+/).filter(Boolean);
    const gravar = lista => el.setAttribute('class', lista.join(' '));
    const api = {
      contains: c => ler().includes(c),
      add: (...cs) => { const l = ler(); cs.forEach(c => { if (!l.includes(c)) l.push(c); }); gravar(l); },
      remove: (...cs) => gravar(ler().filter(c => !cs.includes(c))),
      toggle: (c, forcar) => {
        const quer = forcar === undefined ? !ler().includes(c) : Boolean(forcar);
        if (quer) api.add(c); else api.remove(c);
        return quer;
      },
      // O classList do navegador é uma LISTA: dá para percorrer e espalhar.
      // O utils/modal.js faz os dois para achar a classe de camada (z-...).
      forEach: (fn, alvo) => ler().forEach(fn, alvo),
      item: i => (ler()[i] === undefined ? null : ler()[i]),
      get length() { return ler().length; },
      [Symbol.iterator]: () => ler()[Symbol.iterator](),
      toString: () => ler().join(' ')
    };
    return api;
  }

  get dataset() {
    const el = this;
    const atributo = chave => `data-${String(chave).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
    return new Proxy({}, {
      get: (_, chave) => (typeof chave === 'string' && el.hasAttribute(atributo(chave)) ? el.getAttribute(atributo(chave)) : undefined),
      set: (_, chave, valor) => { el.setAttribute(atributo(chave), valor); return true; },
      deleteProperty: (_, chave) => { el.removeAttribute(atributo(chave)); return true; },
      has: (_, chave) => el.hasAttribute(atributo(chave))
    });
  }

  // ----- árvore
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }

  _inserir(no, antes = null) {
    if (no.parentNode) no.parentNode._retirar(no);
    no.parentNode = this;
    const i = antes ? this.childNodes.indexOf(antes) : -1;
    if (i >= 0) this.childNodes.splice(i, 0, no);
    else this.childNodes.push(no);
    return no;
  }

  _retirar(no) {
    const i = this.childNodes.indexOf(no);
    if (i >= 0) this.childNodes.splice(i, 1);
    no.parentNode = null;
  }

  appendChild(no) { return this._inserir(no); }
  insertBefore(no, referencia) { return this._inserir(no, referencia); }
  removeChild(no) { this._retirar(no); return no; }
  append(...nos) {
    nos.forEach(n => this._inserir(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n));
  }
  /** Troca tudo o que está dentro — é como os modais redesenham as listas. */
  replaceChildren(...nos) {
    [...this.childNodes].forEach(n => this._retirar(n));
    this.append(...nos);
  }

  contains(outro) {
    let no = outro;
    while (no) {
      if (no === this) return true;
      no = no.parentNode;
    }
    return false;
  }

  _limpar() {
    this.childNodes.forEach(n => { n.parentNode = null; });
    this.childNodes = [];
  }

  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) {
    this._limpar();
    const texto = v === null || v === undefined ? '' : String(v);
    if (texto) this._inserir(this.ownerDocument.createTextNode(texto));
  }

  get innerHTML() { return this.childNodes.map(serializar).join(''); }
  set innerHTML(html) {
    this._limpar();
    parsearHtml(html, this.ownerDocument).forEach(n => this._inserir(n));
  }

  get outerHTML() { return serializar(this); }

  // ----- busca
  _descendentes() {
    const lista = [];
    const andar = no => no.children.forEach(filho => { lista.push(filho); andar(filho); });
    andar(this);
    return lista;
  }

  querySelectorAll(seletor) {
    const testes = compilarSeletor(seletor);
    return this._descendentes().filter(el => testes.some(t => t(el)));
  }

  querySelector(seletor) { return this.querySelectorAll(seletor)[0] || null; }

  matches(seletor) { return compilarSeletor(seletor).some(t => t(this)); }

  closest(seletor) {
    const testes = compilarSeletor(seletor);
    let no = this;
    while (no && no.nodeType === 1) {
      if (testes.some(t => t(no))) return no;
      no = no.parentNode;
    }
    return null;
  }

  // ----- formulário
  get options() { return this.localName === 'select' ? this.querySelectorAll('option') : []; }

  get selected() { return this._escolhida !== undefined ? this._escolhida : this.hasAttribute('selected'); }
  set selected(v) { this._escolhida = Boolean(v); }

  get value() {
    if (this.localName === 'select') {
      if (this._semSelecao) return '';
      const opcoes = this.options;
      const escolhida = opcoes.find(o => o.selected) || opcoes[0];
      return escolhida ? escolhida.value : '';
    }
    if (this.localName === 'option') {
      return this.hasAttribute('value') ? this.getAttribute('value') : this.textContent;
    }
    if (this._valor !== undefined) return this._valor;
    if (this.localName === 'textarea') return this.textContent;
    return this.getAttribute('value') ?? '';
  }

  set value(v) {
    const texto = v === null || v === undefined ? '' : String(v);
    if (this.localName === 'select') {
      let achou = false;
      this.options.forEach(o => {
        const esta = !achou && o.value === texto;
        o._escolhida = esta;
        if (esta) achou = true;
      });
      this._semSelecao = !achou;
      return;
    }
    if (this.localName === 'option') { this.setAttribute('value', texto); return; }
    this._valor = texto;
  }

  get checked() { return this._marcado !== undefined ? this._marcado : this.hasAttribute('checked'); }
  set checked(v) {
    const marcado = Boolean(v);
    this._marcado = marcado;
    if (!marcado || this.type !== 'radio' || !this.name) return;
    let raiz = this;
    while (raiz.parentNode) raiz = raiz.parentNode;
    if (raiz.nodeType !== 1) return;
    raiz.querySelectorAll('input[type="radio"]').forEach(outro => {
      if (outro !== this && outro.name === this.name) outro._marcado = false;
    });
  }

  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() {
    const doc = this.ownerDocument;
    if (doc && doc.activeElement === this) doc.activeElement = doc.body;
  }

  setSelectionRange(inicio, fim) { this.selectionStart = inicio; this.selectionEnd = fim; }
  getClientRects() { return [{}]; }

  click() {
    if (this.disabled && CONTROLES.has(this.localName)) return;
    const marcavel = this.localName === 'input' && (this.type === 'radio' || this.type === 'checkbox');
    const antes = marcavel ? this.checked : null;
    if (marcavel) this.checked = this.type === 'radio' ? true : !this.checked;
    const evento = new Evento('click', { bubbles: true, cancelable: true });
    despachar(this, evento);
    if (marcavel && evento.defaultPrevented) { this.checked = antes; return; }
    if (marcavel && antes !== this.checked) {
      despachar(this, new Evento('input', { bubbles: true }));
      despachar(this, new Evento('change', { bubbles: true }));
    }
  }
}

BOOLEANOS.forEach(prop => {
  const atributo = prop.toLowerCase();
  Object.defineProperty(Elemento.prototype, prop, {
    get() { return this.hasAttribute(atributo); },
    set(v) { if (v) this.setAttribute(atributo, ''); else this.removeAttribute(atributo); },
    configurable: true
  });
});

class Documento extends AlvoDeEventos {
  constructor(janela) {
    super();
    this._ehDocumento = true;
    this._janela = janela;
    this.nodeType = 9;
    this.readyState = 'complete';
    this.documentElement = new Elemento(this, 'html');
    this.head = new Elemento(this, 'head');
    this.body = new Elemento(this, 'body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  createElement(tag) { return new Elemento(this, tag); }
  createTextNode(texto) { return new Texto(this, texto); }

  getElementById(id) {
    return this.documentElement._descendentes().find(el => el.id === String(id)) || null;
  }

  querySelectorAll(seletor) { return this.documentElement.querySelectorAll(seletor); }
  querySelector(seletor) { return this.documentElement.querySelector(seletor); }
}

/**
 * Uma janela com documento, pronta para `vm.createContext`.
 *
 * A janela é um objeto simples com os métodos como propriedades PRÓPRIAS:
 * num contexto do `vm`, o global é o próprio objeto, e o que vem do protótipo
 * não é garantido como global.
 */
function criarAmbiente() {
  const janela = { _ehJanela: true };
  janela[OUVINTES] = [];
  janela.addEventListener = (tipo, fn, opcoes) => ouvir(janela, tipo, fn, opcoes);
  janela.removeEventListener = (tipo, fn, opcoes) => desouvir(janela, tipo, fn, opcoes);
  janela.dispatchEvent = evento => despachar(janela, evento);

  const documento = new Documento(janela);
  janela.window = janela;
  janela.self = janela;
  janela.document = documento;
  janela.Event = Evento;
  janela.CustomEvent = class CustomEvent extends Evento {};
  janela.KeyboardEvent = class KeyboardEvent extends Evento {};
  janela.console = console;
  janela.setTimeout = setTimeout;
  janela.clearTimeout = clearTimeout;
  janela.setInterval = setInterval;
  janela.clearInterval = clearInterval;
  janela.queueMicrotask = queueMicrotask;

  /** Injeta o HTML num wrapper no <body>, como o `Modal.open` faz. */
  const montar = html => {
    const wrapper = documento.createElement('div');
    wrapper.innerHTML = html;
    documento.body.appendChild(wrapper);
    return wrapper;
  };

  /** Dispara um evento num elemento (ou na janela), com borbulha por padrão. */
  const disparar = (alvo, tipo, init = {}) => {
    const evento = new Evento(tipo, { bubbles: true, cancelable: true, ...init });
    alvo.dispatchEvent(evento);
    return evento;
  };

  return { janela, documento, montar, disparar, Evento };
}

/** Deixa as promessas pendentes andarem (fetch, json, awaits encadeados). */
async function esperarTarefas(voltas = 5) {
  for (let i = 0; i < voltas; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

module.exports = { criarAmbiente, esperarTarefas, Evento };
