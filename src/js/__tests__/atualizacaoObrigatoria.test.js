const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Atualização obrigatória.
 *
 * Duas coisas são testadas aqui, e as duas quebram em silêncio:
 *
 *  1. A CAIXA não pode ter saída. Um `<dialog>` fecha com Esc por padrão e
 *     qualquer código pode chamar `close()` — se qualquer um desses caminhos
 *     passar, o usuário segue usando uma versão velha achando que atualizou.
 *  2. A REGRA de quando exigir. Exigir de menos deixa versões antigas rodando;
 *     exigir de mais tranca o app numa caixa sem saída para uma atualização que
 *     não dá para baixar.
 */

// ==================================================================
// Parte 1 — a caixa não fecha
// ==================================================================

const SELETORES = [
  '[data-versao-local]',
  '[data-versao-disponivel]',
  '[data-atualizar]',
  '[data-etapa]',
  '[data-erro]'
];

function criarElemento(tag) {
  const el = {
    tagName: tag,
    id: '',
    textContent: '',
    innerHTML: '',
    isConnected: false,
    open: false,
    aberturas: 0,
    dataset: {},
    atributos: {},
    ouvintes: {},
    filhos: [],
    classes: new Set(),
    classList: {
      add: c => el.classes.add(c),
      remove: c => el.classes.delete(c),
      contains: c => el.classes.has(c),
      toggle: c => (el.classes.has(c) ? el.classes.delete(c) : el.classes.add(c))
    },
    setAttribute(chave, valor) { this.atributos[chave] = String(valor); },
    getAttribute(chave) { return this.atributos[chave] ?? null; },
    removeAttribute(chave) { delete this.atributos[chave]; },
    appendChild(filho) { this.filhos.push(filho); filho.isConnected = true; return filho; },
    addEventListener(tipo, fn) { (this.ouvintes[tipo] ||= []).push(fn); },
    removeEventListener() {},
    focus() { this.focado = true; },
    querySelector(seletor) { return this.mapa?.[seletor] || null; },
    querySelectorAll() { return []; },
    showModal() { this.open = true; this.aberturas += 1; },
    close() { this.open = false; this.disparar('close'); },
    disparar(tipo, evento = {}) {
      (this.ouvintes[tipo] || []).forEach(fn => fn(evento));
      return evento;
    }
  };
  return el;
}

function montarAmbiente({ comBotaoAcao = false } = {}) {
  const originais = { window: global.window, document: global.document };

  const criados = [];
  const documentStub = {
    head: criarElemento('head'),
    documentElement: criarElemento('html'),
    body: criarElemento('body'),
    getElementById: () => null,
    createElement: tag => {
      const el = criarElemento(tag);
      if (tag === 'dialog') {
        // O módulo monta o conteúdo por `innerHTML`; aqui os alvos já existem.
        el.mapa = Object.fromEntries(SELETORES.map(s => [s, criarElemento('span')]));
      }
      criados.push(el);
      return el;
    }
  };

  const chamadasBind = [];
  const windowStub = {
    document: documentStub
  };
  if (comBotaoAcao) {
    windowStub.BotaoAcao = {
      bind: (el, handler) => {
        chamadasBind.push({ el, handler });
        el.addEventListener('click', handler);
      }
    };
  }

  global.window = windowStub;
  global.document = documentStub;

  const caminho = path.join(__dirname, '..', '..', 'utils', 'atualizacaoObrigatoria.js');
  delete require.cache[require.resolve(caminho)];
  require(caminho);

  return {
    api: windowStub.AtualizacaoObrigatoria,
    chamadasBind,
    dialogo: () => criados.find(el => el.tagName === 'dialog'),
    restaurar: () => {
      if (originais.window === undefined) delete global.window; else global.window = originais.window;
      if (originais.document === undefined) delete global.document; else global.document = originais.document;
    }
  };
}

test('Esc não fecha a caixa obrigatória', async () => {
  const amb = montarAmbiente();
  try {
    amb.api.exigir({ versaoLocal: '1.0.45', versaoDisponivel: '1.0.46', aoAtualizar: async () => {} });
    const dialogo = amb.dialogo();
    assert.equal(dialogo.open, true, 'a caixa precisa abrir em modal');

    let impedido = false;
    dialogo.disparar('cancel', { preventDefault() { impedido = true; } });

    assert.equal(impedido, true, 'o `cancel` (Esc) precisa ser cancelado');
    assert.equal(dialogo.open, true, 'a caixa continua aberta');
  } finally {
    await amb.restaurar();
  }
});

test('close() chamado de fora reabre a caixa', async () => {
  const amb = montarAmbiente();
  try {
    amb.api.exigir({ versaoLocal: '1.0.45', versaoDisponivel: '1.0.46', aoAtualizar: async () => {} });
    const dialogo = amb.dialogo();

    dialogo.close();

    assert.equal(dialogo.open, true, 'fechar por fora não pode deixar o usuário passar');
    assert.equal(dialogo.aberturas, 2, 'a caixa precisa ter sido reaberta');
  } finally {
    await amb.restaurar();
  }
});

test('existe um único botão, e ele é o Atualizar', async () => {
  const amb = montarAmbiente();
  try {
    amb.api.exigir({ versaoLocal: '1.0.45', versaoDisponivel: '1.0.46', aoAtualizar: async () => {} });
    const marcacao = amb.dialogo().innerHTML;

    const botoes = marcacao.match(/<button/g) || [];
    assert.equal(botoes.length, 1, 'mais de um botão significa que existe uma saída');
    assert.match(marcacao, /data-atualizar/, 'o botão precisa ser o de atualizar');
    assert.doesNotMatch(marcacao, /data-(cancel|fechar|close)/, 'nenhum botão de saída');
  } finally {
    await amb.restaurar();
  }
});

test('sem BotaoAcao, o clique repetido ainda é ignorado', async () => {
  const amb = montarAmbiente();
  try {
    let chamadas = 0;
    let liberar;
    const espera = new Promise(resolve => { liberar = resolve; });

    amb.api.exigir({
      versaoLocal: '1.0.45',
      versaoDisponivel: '1.0.46',
      aoAtualizar: () => { chamadas += 1; return espera; }
    });

    const botao = amb.dialogo().mapa['[data-atualizar]'];
    botao.disparar('click');
    botao.disparar('click');
    botao.disparar('click');

    liberar();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(chamadas, 1, 'duplo clique não pode disparar duas atualizações');
  } finally {
    await amb.restaurar();
  }
});

test('quando existe BotaoAcao, é ele quem protege o botão', async () => {
  const amb = montarAmbiente({ comBotaoAcao: true });
  try {
    amb.api.exigir({ versaoLocal: '1.0.45', versaoDisponivel: '1.0.46', aoAtualizar: async () => {} });

    assert.equal(amb.chamadasBind.length, 1, 'o botão precisa passar por BotaoAcao.bind');
    assert.equal(
      amb.chamadasBind[0].el,
      amb.dialogo().mapa['[data-atualizar]'],
      'quem recebe a trava é o botão Atualizar'
    );
  } finally {
    await amb.restaurar();
  }
});

test('falha ao atualizar mostra o erro e devolve o botão, sem liberar o app', async () => {
  const amb = montarAmbiente();
  try {
    amb.api.exigir({
      versaoLocal: '1.0.45',
      versaoDisponivel: '1.0.46',
      aoAtualizar: async () => { throw new Error('servidor fora do ar'); }
    });

    const dialogo = amb.dialogo();
    dialogo.mapa['[data-atualizar]'].disparar('click');
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(dialogo.mapa['[data-erro]'].textContent, 'servidor fora do ar');
    assert.equal(dialogo.mapa['[data-erro]'].classes.has('visivel'), true);
    assert.equal(dialogo.mapa['[data-atualizar]'].textContent, 'Tentar novamente');
    assert.equal(dialogo.open, true, 'erro não é saída: a caixa continua');
  } finally {
    await amb.restaurar();
  }
});

test('exigir duas vezes não empilha caixas', async () => {
  const amb = montarAmbiente();
  try {
    amb.api.exigir({ versaoLocal: '1.0.45', versaoDisponivel: '1.0.46', aoAtualizar: async () => {} });
    amb.api.exigir({ versaoLocal: '1.0.45', versaoDisponivel: '1.0.47', aoAtualizar: async () => {} });

    const dialogos = amb.dialogo();
    assert.equal(dialogos.aberturas, 1, 'a segunda chamada só atualiza o que já está na tela');
    assert.equal(dialogos.mapa['[data-versao-disponivel]'].textContent, '1.0.47');
  } finally {
    await amb.restaurar();
  }
});

// ==================================================================
// Parte 2 — quando exigir (regra dentro do AppUpdates)
// ==================================================================

function elementoDeMenu() {
  const noop = () => {};
  const alvo = {
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {},
    dataset: {}
  };
  return new Proxy(alvo, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'querySelectorAll') return () => [];
      if (p === 'querySelector') return () => elementoDeMenu();
      if (p === 'getBoundingClientRect') {
        return () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
      }
      if (p === 'textContent' || p === 'innerHTML') return t[p] || '';
      return noop;
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

function armazenamento() {
  const dados = new Map();
  return {
    getItem: k => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    removeItem: k => dados.delete(k),
    clear: () => dados.clear()
  };
}

/** Carrega o menu.js real com o mínimo de DOM e um `AtualizacaoObrigatoria` espião. */
function montarMenu({ comInstalador = true } = {}) {
  const originais = {
    window: global.window,
    document: global.document,
    localStorage: global.localStorage,
    sessionStorage: global.sessionStorage,
    setTimeout: global.setTimeout,
    requestAnimationFrame: global.requestAnimationFrame,
    requestIdleCallback: global.requestIdleCallback,
    CustomEvent: global.CustomEvent,
    fetch: global.fetch
  };

  global.setTimeout = () => 0;
  global.clearTimeout = () => {};
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
  global.requestIdleCallback = () => 0;
  global.cancelIdleCallback = () => {};
  global.fetch = async () => ({ ok: true, status: 200, async json() { return {}; } });
  global.CustomEvent = class { constructor(t, i = {}) { this.type = t; this.detail = i.detail; } };

  const exigencias = [];
  const electronAPI = {
    async getUpdateStatus() { return { status: 'up-to-date' }; },
    onUpdateStatus: () => {},
    onPublishStatus: () => {},
    onPublishError: () => {}
  };
  if (comInstalador) {
    electronAPI.downloadUpdate = async () => ({ status: 'downloaded' });
    electronAPI.installUpdate = async () => true;
  }

  const documentStub = {
    documentElement: elementoDeMenu(),
    body: elementoDeMenu(),
    head: elementoDeMenu(),
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => elementoDeMenu(),
    createDocumentFragment: () => elementoDeMenu(),
    getElementById: () => elementoDeMenu(),
    querySelector: () => elementoDeMenu(),
    querySelectorAll: () => []
  };

  const windowStub = {
    document: documentStub,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    apiConfig: { async getApiBaseUrl() { return 'http://localhost:3000'; } },
    showToast: () => {},
    electronAPI,
    AtualizacaoObrigatoria: {
      exigir: opcoes => { exigencias.push(opcoes); },
      definirEtapa: () => {},
      relatarErro: () => {},
      estaAberta: () => exigencias.length > 0
    }
  };

  global.window = windowStub;
  global.document = documentStub;
  global.localStorage = armazenamento();
  global.sessionStorage = armazenamento();
  global.sessionStorage.setItem('currentUser', JSON.stringify({ perfil: 'Admin', id: 'tester' }));

  const caminho = path.join(__dirname, '..', 'menu.js');
  delete require.cache[require.resolve(caminho)];
  require(caminho);

  return {
    updates: windowStub.AppUpdates,
    exigencias,
    // O menu dispara promessas de status ao definir o perfil; elas precisam
    // terminar ANTES de o `window` falso sumir, senão estouram fora do teste.
    restaurar: async () => {
      for (let i = 0; i < 5; i += 1) await new Promise(r => setImmediate(r));
      Object.entries(originais).forEach(([chave, valor]) => {
        if (valor === undefined) delete global[chave];
        else global[chave] = valor;
      });
    }
  };
}

const STATUS_ATRASADO = {
  status: 'update-available',
  localVersion: '1.0.45',
  latestVersion: '1.0.46'
};

test('versão 0.0.1 atrás com atualização pronta: exige atualizar', async () => {
  const amb = montarMenu();
  try {
    amb.updates.setUserProfile({ id: 'tester', perfil: 'Admin' });
    amb.updates.setUpdateStatus(STATUS_ATRASADO, { silent: true });

    assert.equal(amb.exigencias.length >= 1, true, 'a caixa obrigatória precisa ser pedida');
    const pedido = amb.exigencias[amb.exigencias.length - 1];
    assert.equal(pedido.versaoLocal, '1.0.45');
    assert.equal(pedido.versaoDisponivel, '1.0.46');
    assert.equal(typeof pedido.aoAtualizar, 'function', 'precisa reaproveitar o fluxo que aplica');
  } finally {
    await amb.restaurar();
  }
});

test('antes do login não exige nada', async () => {
  const amb = montarMenu();
  try {
    amb.updates.setUpdateStatus(STATUS_ATRASADO, { silent: true });
    assert.equal(amb.exigencias.length, 0, 'sem usuário definido não há a quem exigir');
  } finally {
    await amb.restaurar();
  }
});

test('mesma versão não exige nada', async () => {
  const amb = montarMenu();
  try {
    amb.updates.setUserProfile({ id: 'tester', perfil: 'Admin' });
    amb.updates.setUpdateStatus(
      { status: 'update-available', localVersion: '1.0.46', latestVersion: '1.0.46' },
      { silent: true }
    );
    assert.equal(amb.exigencias.length, 0);
  } finally {
    await amb.restaurar();
  }
});

test('atrasado mas sem pacote pronto não prende o usuário', async () => {
  const amb = montarMenu();
  try {
    amb.updates.setUserProfile({ id: 'tester', perfil: 'Admin' });
    amb.updates.setUpdateStatus(
      { status: 'up-to-date', localVersion: '1.0.45', latestVersion: '1.0.46' },
      { silent: true }
    );
    assert.equal(amb.exigencias.length, 0, 'sem update-available/downloaded não há o que aplicar');
  } finally {
    await amb.restaurar();
  }
});

test('sem instalador disponível não prende o usuário', async () => {
  const amb = montarMenu({ comInstalador: false });
  try {
    amb.updates.setUserProfile({ id: 'tester', perfil: 'Admin' });
    amb.updates.setUpdateStatus(STATUS_ATRASADO, { silent: true });
    assert.equal(
      amb.exigencias.length,
      0,
      'uma caixa sem saída para um update que não baixa travaria o app'
    );
  } finally {
    await amb.restaurar();
  }
});

test('versão local mais NOVA que a disponível não exige nada', async () => {
  const amb = montarMenu();
  try {
    amb.updates.setUserProfile({ id: 'tester', perfil: 'Admin' });
    amb.updates.setUpdateStatus(
      { status: 'update-available', localVersion: '1.1.0', latestVersion: '1.0.46' },
      { silent: true }
    );
    assert.equal(amb.exigencias.length, 0);
  } finally {
    await amb.restaurar();
  }
});
