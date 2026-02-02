const { contextBridge, ipcRenderer } = require('electron');
const DEBUG = process.env.DEBUG === 'true';

function recordAction(action) {
  if (!action || typeof action !== 'object') return;
  const payload = {
    ...action,
    timestamp: action.timestamp || Date.now()
  };
  if (!payload.source) payload.source = 'ipc';
  ipcRenderer.invoke('record-user-action', payload).catch(err => {
    if (DEBUG) console.error('record-user-action failed', err);
  });
}

function recordIpcAction(channel, payload, result) {
  recordAction({ source: 'ipc', channel, payload, result });
}

function formatErrorForRecord(err) {
  if (!err) return null;
  const error = err instanceof Error ? err : new Error(String(err));
  return {
    message: error.message || String(error),
    code: error.code,
    stack: DEBUG ? error.stack : undefined
  };
}

async function invokeIpc(channel, payload, { trackAction = false } = {}) {
  try {
    const result = await ipcRenderer.invoke(channel, payload);
    if (trackAction) {
      recordIpcAction(channel, payload, result);
    }
    return result;
  } catch (err) {
    if (trackAction) {
      recordIpcAction(channel, payload, { error: formatErrorForRecord(err) });
    }
    if (DEBUG) console.error(`${channel} failed`, err);
    throw err;
  }
}

function subscribeToChannel(channel, callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  const listener = (_event, payload) => {
    try {
      callback(payload);
    } catch (err) {
      if (DEBUG) console.error(`listener for ${channel} failed`, err);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

let runtimeConfigPromise = null;

function getRuntimeConfigCached() {
  if (!runtimeConfigPromise) {
    runtimeConfigPromise = ipcRenderer.invoke('get-runtime-config').catch(err => {
      runtimeConfigPromise = null;
      throw err;
    });
  }
  return runtimeConfigPromise;
}

contextBridge.exposeInMainWorld('electronAPI', {
  log: (msg) => {
    if (DEBUG) ipcRenderer.send('debug-log', msg);
  },
  getRuntimeConfig: () => getRuntimeConfigCached(),
  login: (email, password) => ipcRenderer.invoke('login-usuario', { email, password }),
  register: async (name, email, password) => {
    const result = await ipcRenderer.invoke('registrar-usuario', { name, email, password });
    if (result && result.success) {
      recordIpcAction('registrar-usuario', { name, email }, result);
    }
    return result;
  },
  // Módulo de Matéria-Prima
  listarMateriaPrima: (filtro) => ipcRenderer.invoke('listar-materia-prima', { filtro }),
  listarCategorias: () =>
    ipcRenderer.invoke('listar-categorias').catch((err) => {
      console.error('listar-categorias error', err);
      return [];
    }),
  listarUnidades: () =>
    ipcRenderer.invoke('listar-unidades').catch((err) => {
      console.error('listar-unidades error', err);
      return [];
    }),
  listarColecoes: () =>
    ipcRenderer.invoke('listar-colecoes').catch((err) => {
      console.error('listar-colecoes error', err);
      return [];
    }),
  adicionarCategoria: async (nome) => {
    const result = await ipcRenderer.invoke('adicionar-categoria', nome);
    recordIpcAction('adicionar-categoria', nome, result);
    return result;
  },
  adicionarUnidade: async (nome) => {
    const result = await ipcRenderer.invoke('adicionar-unidade', nome);
    recordIpcAction('adicionar-unidade', nome, result);
    return result;
  },
  adicionarColecao: async (nome) => {
    const result = await ipcRenderer.invoke('adicionar-colecao', nome);
    recordIpcAction('adicionar-colecao', nome, result);
    return result;
  },
  removerCategoria: async (nome) => {
    const result = await ipcRenderer.invoke('remover-categoria', nome);
    recordIpcAction('remover-categoria', nome, result);
    return result;
  },
  removerUnidade: async (nome) => {
    const result = await ipcRenderer.invoke('remover-unidade', nome);
    recordIpcAction('remover-unidade', nome, result);
    return result;
  },
  removerColecao: async (nome) => {
    const result = await ipcRenderer.invoke('remover-colecao', nome);
    recordIpcAction('remover-colecao', nome, result);
    return result;
  },
  verificarDependenciaCategoria: (nome) => ipcRenderer.invoke('verificar-dependencia-categoria', nome),
  verificarDependenciaUnidade: (nome) => ipcRenderer.invoke('verificar-dependencia-unidade', nome),
  verificarDependenciaColecao: (nome) => ipcRenderer.invoke('verificar-dependencia-colecao', nome),
  verificarDependenciaProcesso: (nome) => ipcRenderer.invoke('verificar-dependencia-processo', nome),
  listarProdutos: () => ipcRenderer.invoke('listar-produtos'),
  obterProduto: (codigo) => ipcRenderer.invoke('obter-produto', codigo),
  adicionarProduto: async (dados) => {
    const result = await ipcRenderer.invoke('adicionar-produto', dados);
    recordIpcAction('adicionar-produto', dados, result);
    return result;
  },
  atualizarProduto: async (id, dados) => {
    const result = await ipcRenderer.invoke('atualizar-produto', { id, dados });
    recordIpcAction('atualizar-produto', { id, dados }, result);
    return result;
  },
  excluirProduto: async (info) => {
    const payload = typeof info === 'object' && info !== null ? info : { id: info };
    const result = await ipcRenderer.invoke('excluir-produto', payload.id);
    if (result && result.error) {
      throw new Error(result.error);
    }
    recordIpcAction('excluir-produto', payload, result);
    return result;
  },
  listarDetalhesProduto: (params) => ipcRenderer.invoke('listar-detalhes-produto', params),
  inserirLoteProduto: async (dados) => {
    const result = await ipcRenderer.invoke('inserir-lote-produto', dados);
    recordIpcAction('inserir-lote-produto', dados, result);
    return result;
  },
  atualizarLoteProduto: async (dados) => {
    const result = await ipcRenderer.invoke('atualizar-lote-produto', dados);
    recordIpcAction('atualizar-lote-produto', dados, result);
    return result;
  },
  excluirLoteProduto: async (info) => {
    const payload = typeof info === 'object' && info !== null ? info : { id: info };
    if (payload.id === undefined || payload.id === null) {
      throw new Error('ID do lote não informado');
    }
    const result = await ipcRenderer.invoke('excluir-lote-produto', payload.id);
    recordIpcAction('excluir-lote-produto', payload, result);
    return result;
  },
  listarInsumosProduto: (codigo) => ipcRenderer.invoke('listar-insumos-produto', codigo),
  listarEtapasProducao: () => ipcRenderer.invoke('listar-etapas-producao'),
  adicionarEtapaProducao: async (dados) => {
    const result = await ipcRenderer.invoke('adicionar-etapa-producao', dados);
    recordIpcAction('adicionar-etapa-producao', dados, result);
    return result;
  },
  removerEtapaProducao: async (nome) => {
    const result = await ipcRenderer.invoke('remover-etapa-producao', nome);
    recordIpcAction('remover-etapa-producao', nome, result);
    return result;
  },
  listarItensProcessoProduto: (codigo, etapa, busca, produtoId) =>
    ipcRenderer.invoke('listar-itens-processo-produto', { codigo, etapa, busca, produtoId }),
  salvarProdutoDetalhado: async (codigo, produto, itens, produtoId) => {
    const result = await ipcRenderer.invoke('salvar-produto-detalhado', {
      codigo,
      produto,
      itens,
      produtoId
    });
    recordIpcAction('salvar-produto-detalhado', { codigo, produto, itens, produtoId }, result);
    return result;
  },
  adicionarMateriaPrima: async (dados) => {
    const result = await ipcRenderer.invoke('adicionar-materia-prima', dados);
    if (result && result.success === false) {
      const err = new Error(result.message);
      if (result.code) err.code = result.code;
      throw err;
    }
    recordIpcAction('adicionar-materia-prima', dados, result);
    return result.materia;
  },
  atualizarMateriaPrima: async (id, dados) => {
    const result = await ipcRenderer.invoke('atualizar-materia-prima', { id, dados });
    if (result && result.success === false) {
      const err = new Error(result.message);
      if (result.code) err.code = result.code;
      throw err;
    }
    recordIpcAction('atualizar-materia-prima', { id, dados }, result);
    return result.materia;
  },
  excluirMateriaPrima: async (info) => {
    const payload = typeof info === 'object' && info !== null ? info : { id: info };
    if (payload.id === undefined || payload.id === null) {
      throw new Error('ID do insumo não informado');
    }
    const result = await ipcRenderer.invoke('excluir-materia-prima', payload.id);
    if (result && result.success === false) {
      const err = new Error(result.message);
      if (result.code) err.code = result.code;
      throw err;
    }
    recordIpcAction('excluir-materia-prima', payload, result);
    return result;
  },
  registrarEntrada: async (id, quantidade) => {
    const result = await ipcRenderer.invoke('registrar-entrada-materia-prima', { id, quantidade });
    recordIpcAction('registrar-entrada-materia-prima', { id, quantidade }, result);
    return result;
  },
  registrarSaida: async (id, quantidade) => {
    const result = await ipcRenderer.invoke('registrar-saida-materia-prima', { id, quantidade });
    recordIpcAction('registrar-saida-materia-prima', { id, quantidade }, result);
    return result;
  },
  atualizarPreco: async (id, preco) => {
    const result = await ipcRenderer.invoke('atualizar-preco-materia-prima', { id, preco });
    recordIpcAction('atualizar-preco-materia-prima', { id, preco }, result);
    return result;
  },
  autoLogin: (user) => ipcRenderer.invoke('auto-login', { user }),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  closeLogin: () => ipcRenderer.invoke('close-login'),
  openLoginHidden: () => ipcRenderer.invoke('open-login-hidden'),
  logout: () => ipcRenderer.invoke('logout'),
  checkPin: () => ipcRenderer.invoke('check-pin'),
  getConnectionStatus: () => ipcRenderer.invoke('connection-monitor:get-status'),
  requestConnectionCheck: (options) =>
    ipcRenderer.invoke('connection-monitor:request-check', options || {}),
  onConnectionStatus: (callback) => subscribeToChannel('connection-monitor:status', callback),
  onSessionForceLogout: (callback) => subscribeToChannel('session:force-logout', callback),
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  loadState: () => ipcRenderer.invoke('load-state'),
  clearState: () => ipcRenderer.invoke('clear-state'),
  getUpdateStatus: (options) => invokeIpc('get-update-status', options),
  checkForUpdates: () => invokeIpc('check-for-updates', null, { trackAction: true }),
  downloadUpdate: () => invokeIpc('download-update', null, { trackAction: true }),
  installUpdate: () => invokeIpc('install-update', null, { trackAction: true }),
  publishUpdate: (payload) => invokeIpc('publish-update', payload, { trackAction: true }),
  showLogin: () => ipcRenderer.invoke('show-login'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  reloadWindow: () => ipcRenderer.invoke('reload-window'),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  setDisplay: (id) => ipcRenderer.invoke('set-display', id),
  openPdf: (id, tipo) => ipcRenderer.invoke('open-pdf', { id, tipo }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openExternalHtml: (html) => ipcRenderer.invoke('open-external-html', html),
  recordActivity: (info) => {
    if (!info || typeof info !== 'object') return;
    const payload = { ...info };
    if (!payload.source) payload.source = 'renderer';
    recordAction(payload);
  },
  getSavedDisplay: () => ipcRenderer.invoke('get-saved-display'),
  onActivateTab: (callback) =>
    ipcRenderer.on('activate-tab', (_event, tab) => callback(tab)),
  onSelectTab: (callback) =>
    ipcRenderer.on('select-tab', (_event, tab) => callback(tab)),
  onUpdateStatus: (callback) => subscribeToChannel('update-status', callback),
  onNetworkStatus: (callback) => subscribeToChannel('network-status', callback),
  onPublishStatus: (callback) => {
    const unsubscribes = ['publish-progress', 'publish-done'].map(channel =>
      subscribeToChannel(channel, callback)
    );
    return () => {
      unsubscribes.forEach(unsub => {
        if (typeof unsub === 'function') unsub();
      });
    };
  },
  onPublishError: (callback) => subscribeToChannel('publish-error', callback)
  });



// Changelog:
// - 2024-05-17: adicionadas APIs de monitoramento de conexão (status, request e listener) para uso pelo renderer.
// - 2024-06-09: exposto listener session:force-logout para reutilizar fluxo de logout centralizado.
