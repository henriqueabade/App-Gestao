const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  login: (email, password, pin) => ipcRenderer.invoke('login-usuario', { email, password, pin }),
  register: (name, email, password, pin) =>
    ipcRenderer.invoke('registrar-usuario', { name, email, password, pin }),
  // Módulo de Matéria-Prima
  listarMateriaPrima: (filtro) => ipcRenderer.invoke('listar-materia-prima', { filtro }),
  listarProdutos: () => ipcRenderer.invoke('listar-produtos'),
  obterProduto: (codigo) => ipcRenderer.invoke('obter-produto', codigo),
  adicionarProduto: (dados) => ipcRenderer.invoke('adicionar-produto', dados),
  atualizarProduto: (id, dados) => ipcRenderer.invoke('atualizar-produto', { id, dados }),
  excluirProduto: (id) => ipcRenderer.invoke('excluir-produto', id),
  listarDetalhesProduto: (params) => ipcRenderer.invoke('listar-detalhes-produto', params),
  inserirLoteProduto: (dados) => ipcRenderer.invoke('inserir-lote-produto', dados),
  atualizarLoteProduto: (dados) => ipcRenderer.invoke('atualizar-lote-produto', dados),
  excluirLoteProduto: (id) => ipcRenderer.invoke('excluir-lote-produto', id),
  listarInsumosProduto: (codigo) => ipcRenderer.invoke('listar-insumos-produto', codigo),
  listarEtapasProducao: () => ipcRenderer.invoke('listar-etapas-producao'),
  listarItensProcessoProduto: (codigo, etapa, busca) =>
    ipcRenderer.invoke('listar-itens-processo-produto', { codigo, etapa, busca }),
  salvarProdutoDetalhado: (codigo, produto, itens) =>
    ipcRenderer.invoke('salvar-produto-detalhado', { codigo, produto, itens }),
  adicionarMateriaPrima: (dados) => ipcRenderer.invoke('adicionar-materia-prima', dados),
  atualizarMateriaPrima: (id, dados) => ipcRenderer.invoke('atualizar-materia-prima', { id, dados }),
  excluirMateriaPrima: (id) => ipcRenderer.invoke('excluir-materia-prima', id),
  registrarEntrada: (id, quantidade) => ipcRenderer.invoke('registrar-entrada-materia-prima', { id, quantidade }),
  registrarSaida: (id, quantidade) => ipcRenderer.invoke('registrar-saida-materia-prima', { id, quantidade }),
  atualizarPreco: (id, preco) => ipcRenderer.invoke('atualizar-preco-materia-prima', { id, preco }),
  autoLogin: (pin) => ipcRenderer.invoke('auto-login', pin),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  closeLogin: () => ipcRenderer.invoke('close-login'),
  openLoginHidden: () => ipcRenderer.invoke('open-login-hidden'),
  logout: () => ipcRenderer.invoke('logout'),
  checkPin: () => ipcRenderer.invoke('check-pin'),
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  loadState: () => ipcRenderer.invoke('load-state'),
  clearState: () => ipcRenderer.invoke('clear-state'),
  showLogin: () => ipcRenderer.invoke('show-login'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  reloadWindow: () => ipcRenderer.invoke('reload-window'),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  setDisplay: (id) => ipcRenderer.invoke('set-display', id),
    getSavedDisplay: () => ipcRenderer.invoke('get-saved-display'),
    onActivateTab: (callback) =>
      ipcRenderer.on('activate-tab', (_event, tab) => callback(tab)),
    onSelectTab: (callback) =>
      ipcRenderer.on('select-tab', (_event, tab) => callback(tab))
  });



