
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const DEBUG = process.env.DEBUG === 'true';
const {
  registrarUsuario,
  loginUsuario,
  isPinError,
  isNetworkError
} = require('./backend/backend');
const db = require('./backend/db');
const fs = require('fs');
const {
  listarMaterias,
  adicionarMateria,
  atualizarMateria,
  excluirMateria,
  registrarEntrada,
  registrarSaida,
  atualizarPreco,
  listarCategorias,
  listarUnidades,
  adicionarCategoria,
  adicionarUnidade,
  removerCategoria,
  removerUnidade,
  categoriaTemDependencias,
  unidadeTemDependencias,
  processoTemDependencias
} = require('./backend/materiaPrima');
const {
  listarProdutos,
  obterProduto,
  adicionarProduto,
  atualizarProduto,
  excluirProduto,
  listarDetalhesProduto,
  listarInsumosProduto,
  listarEtapasProducao,
  adicionarEtapaProducao,
  removerEtapaProducao,
  listarItensProcessoProduto,
  inserirLoteProduto,
  atualizarLoteProduto,
  excluirLoteProduto,
  salvarProdutoDetalhado,
  listarColecoes,
  adicionarColecao,
  removerColecao,
  colecaoTemDependencias
} = require('./backend/produtos');
const apiServer = require('./backend/server');

function showStartupBanner() {
  const banner = `\n==============================\n Aplicativo iniciado com sucesso! \n==============================\n`;
  console.log(banner);
}

// Impede que múltiplas instâncias do aplicativo sejam abertas
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Garante que qualquer janela criada permaneça em tela cheia
app.on('browser-window-created', (_event, win) => {
  win.setFullScreen(true);
  win.setResizable(false);
  win.setMaximizable(false);
  win.setMinimizable(false);
  win.setFullScreenable(false);
  win.on('leave-full-screen', () => {
    win.setFullScreen(true);
  });
  win.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    if (input.control && key === 'w') {
      event.preventDefault();
      app.quit();
    }
    if (input.control && key === 'r') {
      event.preventDefault();
      const url = win.webContents.getURL();
      if (url.includes('login/login.html')) {
        win.loadFile(
          path.join(__dirname, 'src/login/login.html'),
          { query: { hidden: '1' } }
        );
      } else {
        win.reload();
      }
    }
  });
});

let loginWindow = null;
let dashboardWindow = null;
let stateFile;
let displayFile;
let currentDisplayId;

function logDisplayInfo(context, selected) {
  if (!DEBUG) return;
  try {
    const displays = screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds }));
    console.log(`[${context}] available displays:`, JSON.stringify(displays));
    if (selected) {
      console.log(`[${context}] using display`, selected.id, 'bounds:', selected.bounds);
    }
  } catch (err) {
    console.error(`[${context}] logDisplayInfo error`, err);
  }
}

const offsetX = 0;
const offsetY = 0;

function getBoundsForDisplay(display, offX = offsetX, offY = offsetY) {
  const { bounds } = display;
  return {
    x: Math.round(bounds.x + offX),
    y: Math.round(bounds.y + offY),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
}

function loadSavedDisplay() {
  try {
    if (fs.existsSync(displayFile)) {
      const { id } = JSON.parse(fs.readFileSync(displayFile, 'utf-8'));
      const display = screen.getAllDisplays().find(d => d.id === id);
      logDisplayInfo('load-saved-display', display);
      if (display) {
        currentDisplayId = id;
        return display;
      }
      fs.unlinkSync(displayFile);
    }
  } catch (err) {
    console.error('loadSavedDisplay error', err);
  }
  const primary = screen.getPrimaryDisplay();
  logDisplayInfo('load-saved-display-primary', primary);
  currentDisplayId = primary.id;
  return primary;
}

function saveDisplayId(id) {
  try {
    currentDisplayId = id;
    fs.writeFileSync(displayFile, JSON.stringify({ id }));
  } catch (err) {
    console.error('saveDisplayId error', err);
  }
}

function handleDisplaysChanged() {
  const display = screen.getAllDisplays().find(d => d.id === currentDisplayId);
  const target = display || screen.getPrimaryDisplay();
  logDisplayInfo('display-changed', target);
  if (!display) {
    saveDisplayId(target.id);
  }
  const bounds = getBoundsForDisplay(target);
  if (loginWindow) {
    loginWindow.setBounds(bounds);
    loginWindow.setFullScreen(true);
  }
  if (dashboardWindow) {
    dashboardWindow.setBounds(bounds);
    dashboardWindow.setFullScreen(true);
  }
}

function createLoginWindow(show = true, showOnLoad = true) {
  // Se já existir, não cria de novo
  if (loginWindow) return;

  const savedDisplay = loadSavedDisplay();
  logDisplayInfo('create-login', savedDisplay);
  const { x, y, width, height } = getBoundsForDisplay(savedDisplay);

  loginWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    fullscreen: true,
    frame: false,
    fullscreenable: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    useContentSize: true,
    center: false,
    autoHideMenuBar: false,

    // ********** NOVO **********
    transparent: true,             // janela sem fundo branco
    backgroundColor: '#00000000',  // totalmente transparente
    show: false,                   // NUNCA mostra automaticamente
    // **************************

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    nodeIntegration: false
  }
  });

  // Espera o conteúdo estar pronto para posicionar e exibir
  loginWindow.once('ready-to-show', () => {
    loginWindow.setBounds(getBoundsForDisplay(savedDisplay));
    loginWindow.setFullScreen(true);
    if (show && showOnLoad) {
      loginWindow.show();
      loginWindow.focus();
      loginWindow.webContents.send('activate-tab', 'login');
    } else if (show) {
      loginWindow.show();
      loginWindow.focus();
      loginWindow.webContents.send('activate-tab', 'login');
    }
  });

  // Garante full-screen contínuo
  loginWindow.on('leave-full-screen', () => {
    loginWindow.setFullScreen(true);
  });

  // Carrega o HTML, passando hidden=0/1 via query (como você já fazia)
  loginWindow.loadFile(
    path.join(__dirname, 'src/login/login.html'),
    { query: { hidden: showOnLoad ? '0' : '1'
     } }
  );  

  loginWindow.on('closed', () => {
    loginWindow = null;
  });
}


function revealLoginWindow() {
  return new Promise((resolve) => {
    if (!loginWindow || loginWindow.isDestroyed()) {
      resolve();
      return;
    }

    const finish = () => {
      if (!loginWindow || loginWindow.isDestroyed()) {
        resolve();
        return;
      }

      try {
        loginWindow.show();
        loginWindow.focus();
        loginWindow.webContents.send('activate-tab', 'login');
      } catch (err) {
        console.error('Failed to show login window', err);
      }
      resolve();
    };

    if (loginWindow.webContents.isLoading()) {
      loginWindow.once('ready-to-show', finish);
    } else {
      finish();
    }
  });
}


function createDashboardWindow(show = true) {
  const savedDisplay = loadSavedDisplay();
  logDisplayInfo('create-dashboard', savedDisplay);
  const { x, y, width, height } = getBoundsForDisplay(savedDisplay);

  dashboardWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    fullscreen: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    useContentSize: true,
    fullscreenable: false,
    frame: false,
    center: false,
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    nodeIntegration: false
  }
  });

  dashboardWindow.once('ready-to-show', () => {
    dashboardWindow.webContents.send('select-tab', 'dashboard');
    dashboardWindow.setBounds(getBoundsForDisplay(savedDisplay));
    dashboardWindow.setFullScreen(true);
    if (show) {
      dashboardWindow.show();
      dashboardWindow.focus();
    }
  });

  dashboardWindow.on('leave-full-screen', () => {
    dashboardWindow.setFullScreen(true);
  });

  dashboardWindow.webContents.on('did-finish-load', () => {
    dashboardWindow.webContents.send('select-tab', 'dashboard');
  });

  // Carrega a nova tela de menu
  dashboardWindow.loadFile(path.join(__dirname, 'src/html/menu.html'));
  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
}

app.whenReady().then(() => {
  const userDataPath = path.join(app.getPath('appData'), 'santissimo-decor');
  app.setPath('userData', userDataPath);
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
  } catch (err) {
    console.error('Failed to create userData directory', err);
  }
  stateFile = path.join(app.getPath('userData'), 'session-state.json');
  displayFile = path.join(app.getPath('userData'), 'display.json');

  const apiPort = process.env.API_PORT || 3000;
  if (!process.env.API_PORT) {
    console.warn('API_PORT not set, defaulting to 3000');
  }
  apiServer.listen(apiPort, () => {
    if (DEBUG) console.log(`API server running on port ${apiPort}`);
  });

  // Cria a janela de login sem exibí-la imediatamente.
  // Ela será mostrada somente após o carregamento completo do conteúdo
  // pelo renderer (via IPC 'show-login'), evitando flashes iniciais.
  createLoginWindow(false, true);
  screen.on('display-added', handleDisplaysChanged);
  screen.on('display-removed', handleDisplaysChanged);
  screen.on('display-metrics-changed', handleDisplaysChanged);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // Em sistemas macOS, ao reativar o aplicativo sem janelas abertas,
      // criamos a tela de login oculta e deixamos que o renderer a exiba
      // quando estiver pronto, garantindo uma transição suave.
      createLoginWindow(false, true);
    }
  });

  showStartupBanner();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('registrar-usuario', async (_event, dados) => {
  try {
    await registrarUsuario(dados.name, dados.email, dados.password, dados.pin);
    return { success: true, message: 'Usuário cadastrado com sucesso!' };
  } catch (err) {
    return { success: false, message: err.message || 'Erro ao cadastrar usuário' };
  }
});

ipcMain.handle('login-usuario', async (event, dados) => {
  try {
    const user = await loginUsuario(dados.email, dados.password, dados.pin);
    return { success: true, user };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('listar-materia-prima', async (_e, { filtro }) => {
  return listarMaterias(filtro);
});
ipcMain.handle('adicionar-materia-prima', async (_e, dados) => {
  try {
    const materia = await adicionarMateria(dados);
    return { success: true, materia };
  } catch (err) {
    return { success: false, message: err.message, code: err.code };
  }
});
ipcMain.handle('atualizar-materia-prima', async (_e, { id, dados }) => {
  try {
    const materia = await atualizarMateria(id, dados);
    return { success: true, materia };
  } catch (err) {
    return { success: false, message: err.message, code: err.code };
  }
});
ipcMain.handle('excluir-materia-prima', async (_e, id) => {
  try {
    await excluirMateria(id);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message, code: err.code };
  }
});
ipcMain.handle('registrar-entrada-materia-prima', async (_e, { id, quantidade }) => {
  return registrarEntrada(id, quantidade);
});
ipcMain.handle('registrar-saida-materia-prima', async (_e, { id, quantidade }) => {
  return registrarSaida(id, quantidade);
});
ipcMain.handle('atualizar-preco-materia-prima', async (_e, { id, preco }) => {
  return atualizarPreco(id, preco);
});
ipcMain.handle('listar-categorias', async () => {
  try {
    return await listarCategorias();
  } catch (err) {
    console.error('Erro ao listar categorias:', err);
    throw err;
  }
});
ipcMain.handle('listar-unidades', async () => {
  try {
    return await listarUnidades();
  } catch (err) {
    console.error('Erro ao listar unidades:', err);
    throw err;
  }
});
ipcMain.handle('listar-colecoes', async () => {
  try {
    return await listarColecoes();
  } catch (err) {
    console.error('Erro ao listar coleções:', err);
    throw err;
  }
});
ipcMain.handle('adicionar-categoria', async (_e, nome) => {
  try {
    return await adicionarCategoria(nome);
  } catch (err) {
    console.error('Erro ao adicionar categoria:', err);
    throw err;
  }
});
ipcMain.handle('adicionar-unidade', async (_e, nome) => {
  try {
    return await adicionarUnidade(nome);
  } catch (err) {
    console.error('Erro ao adicionar unidade:', err);
    throw err;
  }
});
ipcMain.handle('adicionar-colecao', async (_e, nome) => {
  try {
    return await adicionarColecao(nome);
  } catch (err) {
    console.error('Erro ao adicionar coleção:', err);
    throw err;
  }
});
ipcMain.handle('remover-categoria', async (_e, nome) => {
  try {
    return await removerCategoria(nome);
  } catch (err) {
    console.error('Erro ao remover categoria:', err);
    throw err;
  }
});
ipcMain.handle('remover-unidade', async (_e, nome) => {
  try {
    return await removerUnidade(nome);
  } catch (err) {
    console.error('Erro ao remover unidade:', err);
    throw err;
  }
});
ipcMain.handle('remover-colecao', async (_e, nome) => {
  try {
    return await removerColecao(nome);
  } catch (err) {
    console.error('Erro ao remover coleção:', err);
    throw err;
  }
});
ipcMain.handle('verificar-dependencia-categoria', async (_e, nome) => {
  try {
    return await categoriaTemDependencias(nome);
  } catch (err) {
    console.error('Erro ao verificar dependência de categoria:', err);
    throw err;
  }
});
ipcMain.handle('verificar-dependencia-unidade', async (_e, nome) => {
  try {
    return await unidadeTemDependencias(nome);
  } catch (err) {
    console.error('Erro ao verificar dependência de unidade:', err);
    throw err;
  }
});
ipcMain.handle('verificar-dependencia-colecao', async (_e, nome) => {
  try {
    return await colecaoTemDependencias(nome);
  } catch (err) {
    console.error('Erro ao verificar dependência de coleção:', err);
    throw err;
  }
});
ipcMain.handle('verificar-dependencia-processo', async (_e, nome) => {
  try {
    return await processoTemDependencias(nome);
  } catch (err) {
    console.error('Erro ao verificar dependência de processo:', err);
    throw err;
  }
});
ipcMain.handle('listar-produtos', async () => {
  return listarProdutos();
});
ipcMain.handle('obter-produto', async (_e, codigo) => {
  try {
    return await obterProduto(codigo);
  } catch (err) {
    console.error('Erro ao obter produto:', err);
    throw err;
  }
});
ipcMain.handle('adicionar-produto', async (_e, dados) => {
  return adicionarProduto(dados);
});
ipcMain.handle('atualizar-produto', async (_e, { id, dados }) => {
  return atualizarProduto(id, dados);
});
ipcMain.handle('excluir-produto', async (_e, id) => {
  try {
    await excluirProduto(id);
    return true;
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('listar-detalhes-produto', async (_e, { produtoCodigo, produtoId }) => {
  try {
    // Ajuste: encaminha ambos os parâmetros para o backend
    return await listarDetalhesProduto(produtoCodigo, produtoId);
  } catch (err) {
    console.error('Erro ao listar detalhes do produto:', err);
    throw err;
  }
});
ipcMain.handle('inserir-lote-produto', async (_e, dados) => {
  return inserirLoteProduto(dados);
});
ipcMain.handle('atualizar-lote-produto', async (_e, { id, quantidade }) => {
  return atualizarLoteProduto(id, quantidade);
});
ipcMain.handle('excluir-lote-produto', async (_e, id) => {
  await excluirLoteProduto(id);
  return true;
});
ipcMain.handle('listar-insumos-produto', async (_e, codigo) => {
  return listarInsumosProduto(codigo);
});
ipcMain.handle('listar-etapas-producao', async () => {
  return listarEtapasProducao();
});
ipcMain.handle('adicionar-etapa-producao', async (_e, dados) => {
  return adicionarEtapaProducao(dados);
});
ipcMain.handle('remover-etapa-producao', async (_e, nome) => {
  try {
    return await removerEtapaProducao(nome);
  } catch (err) {
    console.error('Erro ao remover etapa de produção:', err);
    throw err;
  }
});
ipcMain.handle('listar-itens-processo-produto', async (_e, { codigo, etapa, busca }) => {
  return listarItensProcessoProduto(codigo, etapa, busca);
});
ipcMain.handle('salvar-produto-detalhado', async (_e, { codigo, produto, itens }) => {
  return salvarProdutoDetalhado(codigo, produto, itens);
});

ipcMain.handle('auto-login', async (_event, pin) => {
  try {
    if (pin) {
      db.init(pin);
      await db.query('SELECT 1');
    }

    if (!dashboardWindow) {
      if (loginWindow) {
        try {
          const bounds = loginWindow.getBounds();
          const display = screen.getDisplayMatching(bounds);
          logDisplayInfo('auto-login-detected', display);
          if (display && display.id !== currentDisplayId) {
            saveDisplayId(display.id);
          }
        } catch (err) {
          console.error('Failed to detect login display', err);
        }
      }
      createDashboardWindow(true);
    }
    if (loginWindow) {
      loginWindow.close();
    }
    if (dashboardWindow) {
      dashboardWindow.show();
      dashboardWindow.focus();
    }
    return { success: true };
  } catch (err) {
    console.error('Auto-login failed:', err.message);
    if (isNetworkError(err)) {
      return { success: false, reason: 'offline' };
    }
    if (isPinError(err)) {
      return { success: false, reason: 'pin' };
    }
    return { success: false, message: err.message };
  }
});

ipcMain.handle('open-dashboard', async () => {
  if (!dashboardWindow) {
    if (loginWindow) {
      try {
        const bounds = loginWindow.getBounds();
        const display = screen.getDisplayMatching(bounds);
        logDisplayInfo('open-dashboard-detected', display);
        if (display && display.id !== currentDisplayId) {
          saveDisplayId(display.id);
        }
      } catch (err) {
        console.error('Failed to detect login display', err);
      }
    }
    createDashboardWindow(false);
  }
  return true;
});

ipcMain.handle('check-pin', async () => {
  try {
    await db.query('SELECT 1');
    return { success: true };
  } catch (err) {
    if (isNetworkError(err)) {
      return { success: false, reason: 'offline' };
    }
    if (isPinError(err)) {
      return { success: false, reason: 'pin' };
    }
    return { success: false };
  }
});

ipcMain.handle('save-state', async (_e, state) => {
  try {
    fs.writeFileSync(stateFile, JSON.stringify({ savedAt: Date.now(), state }));
    return true;
  } catch (err) {
    console.error('save-state error', err);
    return false;
  }
});

ipcMain.handle('load-state', async () => {
  try {
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      if (Date.now() - data.savedAt < 30 * 60 * 1000) {
        return data.state;
      }
      fs.unlinkSync(stateFile);
    }
  } catch (err) {
    console.error('load-state error', err);
  }
  return null;
});

ipcMain.handle('clear-state', () => {
  try {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  } catch (err) {
    console.error('clear-state error', err);
  }
  return true;
});

ipcMain.handle('close-dashboard', async () => {
  if (dashboardWindow) {
    dashboardWindow.close();
  }
  return true;
});

ipcMain.handle('close-login', async () => {
  if (loginWindow) {
    loginWindow.close();
  }
  if (dashboardWindow) {
    dashboardWindow.show();
    dashboardWindow.focus();
  }
  return true;
});

ipcMain.handle('logout', async () => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.close();
  }
  return true;
});

ipcMain.handle('open-login-hidden', async () => {
  if (!loginWindow) {
    // show = false, showOnLoad = false → janela carregada, mas não exibida
    createLoginWindow(false, false);
  }
  return true;
});

// 3) Mostra o loginWindow **somente** após o conteúdo terminar de carregar,
//    evitando o flash branco
ipcMain.handle('show-login', async () => {
  if (!loginWindow) {
    createLoginWindow(false, false);
  }
  await revealLoginWindow();
  return true;
});


ipcMain.handle('close-window', () => {
  app.quit();
});
ipcMain.handle('minimize-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});
ipcMain.handle('reload-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const url = win.webContents.getURL();
    if (url.includes('login/login.html')) {
      win.loadFile(
        path.join(__dirname, 'src/login/login.html'),
        { query: { hidden: '1' } }
      );
    } else {
      win.reload();
    }
  }
});

ipcMain.handle('get-displays', () => {
  const displays = screen.getAllDisplays();
  return displays.map((d, i) => ({ id: d.id, name: d.label || `Tela ${i + 1}` }));
});

ipcMain.handle('set-display', (_e, id) => {
  let display = screen.getAllDisplays().find(d => d.id === id);
  if (!display) {
    display = screen.getPrimaryDisplay();
    id = display.id;
  }
  logDisplayInfo('set-display', display);
  const bounds = getBoundsForDisplay(display);
  if (loginWindow) {
    const wasVisible = loginWindow.isVisible();
    loginWindow.setBounds(bounds);
    loginWindow.setFullScreen(true);
    if (wasVisible) {
      loginWindow.show();
      loginWindow.focus();
      loginWindow.webContents.send('activate-tab', 'login');
    }
  }
  if (dashboardWindow) {
    const wasVisible = dashboardWindow.isVisible();
    dashboardWindow.setBounds(bounds);
    dashboardWindow.setFullScreen(true);
    if (wasVisible) {
      dashboardWindow.show();
      dashboardWindow.focus();
    }
  }
  saveDisplayId(id);
  return true;
});

ipcMain.handle('get-saved-display', () => {
  try {
    if (fs.existsSync(displayFile)) {
      const { id } = JSON.parse(fs.readFileSync(displayFile, 'utf-8'));
      currentDisplayId = id;
    }
  } catch (err) {
    console.error('get-saved-display error', err);
  }
  return currentDisplayId || null;
});

ipcMain.handle('open-pdf', (_event, { id, tipo }) => {
  const url = new URL('http://localhost:3000/pdf');
  url.searchParams.set('id', id);
  if (tipo) url.searchParams.set('tipo', tipo);
  shell.openExternal(url.toString());
  return true;
});

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
  return true;
});

if (DEBUG) {
  ipcMain.on('debug-log', (_, m) => console.log('[popup]', m));
}
