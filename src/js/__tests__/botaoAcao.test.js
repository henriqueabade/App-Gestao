const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');
const espera = ms => new Promise(r => setTimeout(r, ms));

/**
 * Trava de duplo clique (src/utils/botaoAcao.js).
 *
 * A guarda bloqueia o segundo acionamento e só libera quando a ação termina.
 * Para saber quando terminou, ela rastreia as promessas de `electronAPI` e de
 * `fetch` criadas durante o clique.
 */
function montarAmbiente({ duracaoDaAcao = 500 } = {}) {
  class ClassList {
    constructor() { this.set = new Set(); }
    add(...c) { c.forEach(x => this.set.add(x)); }
    remove(...c) { c.forEach(x => this.set.delete(x)); }
    contains(c) { return this.set.has(c); }
  }

  class El {
    constructor(tagName) {
      this.tagName = tagName;
      this.dataset = {};
      this.classList = new ClassList();
      this.attrs = {};
      this.disabled = false;
      this.children = [];
      this.listeners = {};
      this.style = {};
    }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
    closest(sel) { return sel.includes('button') && this.tagName === 'BUTTON' ? this : null; }
    querySelector(sel) {
      if (sel.includes('submit')) return this.children.find(c => c.getAttribute('type') === 'submit') || null;
      return null;
    }
    querySelectorAll() { return []; }
    dispara(tipo, evento) { (this.listeners[tipo] || []).forEach(fn => fn(evento)); }
  }

  const capturados = {};
  const doc = new El('#document');
  doc.readyState = 'complete';
  doc.head = new El('HEAD');
  doc.documentElement = new El('HTML');
  doc.getElementById = () => null;
  doc.createElement = tag => new El(tag.toUpperCase());
  doc.addEventListener = (tipo, fn, captura) => {
    if (captura) capturados[tipo] = fn;
    else (doc.listeners[tipo] ||= []).push(fn);
  };

  const contadores = { fetch: 0, ipc: 0 };
  const janela = {
    document: doc,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask,
    Promise,
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: class { observe() {} disconnect() {} },
    async fetch() { contadores.fetch += 1; await espera(duracaoDaAcao); return { ok: true }; },
    electronAPI: Object.freeze({
      async salvar() { contadores.ipc += 1; await espera(duracaoDaAcao); return true; }
    })
  };
  janela.window = janela;
  janela.globalThis = janela;

  const contexto = vm.createContext(janela);
  vm.runInContext(
    fs.readFileSync(path.join(RAIZ, 'src/utils/botaoAcao.js'), 'utf8'),
    contexto,
    { filename: 'src/utils/botaoAcao.js' }
  );

  /** Simula um clique: captura primeiro; o handler só roda se não foi engolido. */
  function clicar(botao) {
    const evento = {
      target: botao,
      parado: false,
      preventDefault() {},
      stopImmediatePropagation() { this.parado = true; }
    };
    capturados.click(evento);
    if (!evento.parado) botao.dispara('click', evento);
    return evento;
  }

  return { janela, El, clicar, capturados, contadores };
}

test('segundo clique é engolido enquanto a ação está no ar', async () => {
  const { janela, El, clicar } = montarAmbiente();
  const botao = new El('BUTTON');
  let execucoes = 0;
  botao.addEventListener('click', async () => {
    execucoes += 1;
    await janela.electronAPI.salvar();
  });

  assert.strictEqual(clicar(botao).parado, false, '1o clique passa');
  assert.strictEqual(execucoes, 1);
  assert.strictEqual(clicar(botao).parado, true, '2o clique é engolido');
  assert.strictEqual(execucoes, 1, 'o handler não pode rodar duas vezes');

  await espera(700);
  assert.strictEqual(clicar(botao).parado, false, 'liberado depois de concluir');
  assert.strictEqual(execucoes, 2);
});

test('a trava dura o tempo REAL da ação, não só a janela mínima', async () => {
  // Janela mínima é 350 ms; a ação leva 800 ms.
  const { janela, El, clicar } = montarAmbiente({ duracaoDaAcao: 800 });
  const botao = new El('BUTTON');
  botao.addEventListener('click', async () => { await janela.electronAPI.salvar(); });

  clicar(botao);
  await espera(500);   // já passou da janela mínima, mas a ação continua
  assert.strictEqual(clicar(botao).parado, true, 'não pode liberar antes de a ação acabar');
  assert.strictEqual(botao.classList.contains('acao-carregando'), true, 'e deve estar carregando');

  await espera(500);
  assert.strictEqual(clicar(botao).parado, false, 'liberado ao concluir');
});

test('rastreia fetch disparado por função auxiliar, sem await no handler', async () => {
  // Padrão real de `salvarNovoServico`: o handler chama um helper e NÃO aguarda;
  // o helper ainda passa por `getApiBaseUrl()` antes do fetch.
  const { janela, El, clicar, contadores } = montarAmbiente({ duracaoDaAcao: 700 });

  janela.apiConfig = { getApiBaseUrl: async () => { await espera(10); return 'http://api'; } };
  const fetchApi = async (caminho, opcoes) => {
    const base = await janela.apiConfig.getApiBaseUrl();
    return janela.fetch(base + caminho, opcoes);
  };
  const salvarDados = async () => { await Promise.all([fetchApi('/api/pecas', { method: 'POST' })]); };

  const botao = new El('BUTTON');
  botao.addEventListener('click', () => { salvarDados(); });

  clicar(botao);
  await espera(400);   // depois da janela mínima
  assert.strictEqual(clicar(botao).parado, true, 'o fetch do helper precisa segurar a trava');
  assert.strictEqual(botao.classList.contains('acao-carregando'), true);

  await espera(600);
  assert.strictEqual(clicar(botao).parado, false, 'liberado quando o fetch termina');

  // O helper ainda passa por `getApiBaseUrl()` antes de chamar o fetch, então o
  // segundo disparo não é imediato — esperar aqui evita testar uma corrida.
  await espera(100);
  assert.strictEqual(contadores.fetch, 2, 'a segunda ação de fato aconteceu');
});

test('ação instantânea não mostra spinner e libera logo', async () => {
  const { El, clicar } = montarAmbiente();
  const botao = new El('BUTTON');
  let cliques = 0;
  botao.addEventListener('click', () => { cliques += 1; });

  clicar(botao);
  assert.strictEqual(clicar(botao).parado, true, 'duplo clique acidental é barrado');

  await espera(200);
  assert.strictEqual(botao.classList.contains('acao-carregando'), false,
    'sem spinner em ação que não vai ao back-end');

  await espera(300);
  assert.strictEqual(clicar(botao).parado, false, 'liberado após a janela mínima');
  assert.strictEqual(cliques, 2);
});

test('envio de formulário por Enter também é protegido', async () => {
  const { janela, El, capturados } = montarAmbiente();
  const form = new El('FORM');
  const enviar = new El('BUTTON');
  enviar.setAttribute('type', 'submit');
  form.appendChild(enviar);

  let envios = 0;
  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    envios += 1;
    await janela.electronAPI.salvar();
  });

  const enviarForm = () => {
    const evento = {
      target: form,
      parado: false,
      preventDefault() {},
      stopImmediatePropagation() { this.parado = true; }
    };
    capturados.submit(evento);
    if (!evento.parado) form.dispara('submit', evento);
    return evento;
  };

  enviarForm();
  assert.strictEqual(envios, 1);
  assert.strictEqual(enviarForm().parado, true, 'reenvio é engolido');
  assert.strictEqual(envios, 1);

  await espera(700);
  assert.strictEqual(form.dataset.acaoOcupada, undefined, 'form liberado ao fim');
  assert.strictEqual(enviar.dataset.acaoOcupada, undefined, 'botão liberado ao fim');
});

test('electronAPI continua funcionando depois de instrumentada', async () => {
  const { janela, contadores } = montarAmbiente({ duracaoDaAcao: 10 });
  assert.strictEqual(janela.electronAPI.__botaoAcaoInstrumentado, true);
  assert.strictEqual(await janela.electronAPI.salvar(), true, 'o retorno original precisa passar');
  assert.strictEqual(contadores.ipc, 1);
});
