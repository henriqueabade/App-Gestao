/**
 * O programa no Windows (01/10/2026): preferências ligadas de fábrica, a
 * janela do canto da tela, e como o main.js liga tudo — iniciar com o Windows
 * em segundo plano, fechar para a bandeja, abrir pelo atalho, lembrar o
 * usuário no login. O main.js só roda no Electron: aqui se confere o código.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = require('./preferenciasWindows');
const J = require('./janelaDeAviso');

const raiz = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(raiz, 'preload.js'), 'utf8');
const NSIS = fs.readFileSync(path.join(raiz, 'build', 'installer.nsh'), 'utf8');

test('preferências: tudo ligado de fábrica, primeira vez avisada, só booleanos, grava por cima', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'pref-windows-'));
  try {
    const arquivo = path.join(pasta, 'sub', 'preferencias-windows.json');
    assert.deepStrictEqual(P.ler(arquivo), { iniciarComWindows: true, avisosNoWindows: true, som: true, primeiraVez: true });
    assert.deepStrictEqual(P.gravar(arquivo, { som: false, lixo: 1, avisosNoWindows: 'não' }), { iniciarComWindows: true, avisosNoWindows: true, som: false });
    assert.deepStrictEqual(P.ler(arquivo), { iniciarComWindows: true, avisosNoWindows: true, som: false, primeiraVez: false });
    assert.deepStrictEqual(P.gravar(arquivo, { iniciarComWindows: false }).som, false, 'o que não veio fica como estava');
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('janela do canto: mais novos primeiro e sem repetir; canto inferior direito acima da barra de tarefas', () => {
  const fila = J.juntar([{ id: 3 }, { id: 5 }], [{ id: 5, titulo: 'novo' }, { id: 9 }]);
  assert.deepStrictEqual(fila.map(a => a.id), [9, 5, 3]);
  assert.strictEqual(fila[1].titulo, 'novo', 'o mais recente substitui');
  assert.strictEqual(J.juntar([], Array.from({ length: 30 }, (_, i) => ({ id: i }))).length, J.MAX_NA_FILA);
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepStrictEqual(J.posicao(area, 260), { x: 1920 - J.LARGURA - J.MARGEM, y: 1040 - 260 - J.MARGEM, width: J.LARGURA, height: 260 });
  // Até a altura máxima; o que passar rola dentro da janela (02/10/2026).
  assert.strictEqual(J.ALTURA_MAXIMA, 520);
  assert.strictEqual(J.posicao(area, 5000).height, J.ALTURA_MAXIMA, 'mais que isso, a lista rola');
  assert.strictEqual(J.posicao(area, 40).height, J.ALTURA_MINIMA, 'nunca menor que o topo e o rodapé');
  assert.strictEqual(J.posicao({ x: 0, y: 0, width: 1280, height: 400 }, 5000).height, 400 - 2 * J.MARGEM, 'nunca maior que a tela');
  assert.strictEqual(J.posicao({ x: 0, y: 0, width: 1280, height: 150 }, 5000).height, 150 - 2 * J.MARGEM, 'tela minúscula: cabe nela');
  assert.strictEqual(J.posicao({ x: 1920, y: 0, width: 1280, height: 984 }, 200).x, 1920 + 1280 - J.LARGURA - J.MARGEM, 'segunda tela à direita');
  // Os lidos (abertos na janela ou no sino) saem da lista.
  const lista = [{ id: 9 }, { id: 5 }, { id: 3 }];
  assert.deepStrictEqual(J.semOsLidos(lista, { ids: [5, '3'] }).map(a => a.id), [9]);
  assert.deepStrictEqual(J.semOsLidos(lista, { todas: true }), []);
  assert.strictEqual(J.semOsLidos(lista, {}).length, 3);
});

test('categorias do sino guardadas na máquina para a janela do canto: sem arquivo = tudo ligado; grava normalizado', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-sino-'));
  try {
    const arquivo = path.join(pasta, 'categorias-do-sino.json');
    assert.deepStrictEqual(P.lerCategorias(arquivo), { enabled: true, categories: { tasks: true, sales: true, finance: true } });
    assert.deepStrictEqual(P.gravarCategorias(arquivo, { enabled: true, categories: { tasks: false, system: false, lixo: 1 } }),
      { enabled: true, categories: { tasks: false, sales: true, finance: true } });
    assert.deepStrictEqual(P.lerCategorias(arquivo).categories.tasks, false, 'lida de volta depois de reiniciar');
    assert.deepStrictEqual(P.lerCategorias(null), { enabled: true, categories: { tasks: true, sales: true, finance: true } });
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('som do dono: som-aviso em src/assets, mp3 antes de wav antes de ogg; vazio ou ausente = tum-tum (null)', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'som-aviso-'));
  try {
    assert.strictEqual(P.arquivoDoSom(pasta), null);
    fs.writeFileSync(path.join(pasta, 'som-aviso.ogg'), 'x');
    assert.strictEqual(P.arquivoDoSom(pasta), 'som-aviso.ogg');
    fs.writeFileSync(path.join(pasta, 'som-aviso.mp3'), '');
    assert.strictEqual(P.arquivoDoSom(pasta), 'som-aviso.ogg', 'arquivo vazio não conta');
    fs.writeFileSync(path.join(pasta, 'som-aviso.wav'), 'x');
    fs.writeFileSync(path.join(pasta, 'som-aviso.mp3'), 'x');
    assert.strictEqual(P.arquivoDoSom(pasta), 'som-aviso.mp3');
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

/** Um Electron de mentira só com o que a janela do canto usa. */
function electronFalso() {
  const janelas = [];
  class BrowserWindow {
    constructor(opcoes) {
      Object.assign(this, { opcoes, visivel: false, destruida: false, enviados: [], ouvintes: {}, limites: null });
      this.webContents = { send: (canal, dados) => this.enviados.push([canal, dados]) };
      janelas.push(this);
    }
    setAlwaysOnTop(_v, nivel) { this.nivel = nivel; }
    on(evento, fn) { this.ouvintes[evento] = fn; }
    loadFile(arquivo) { this.arquivo = arquivo; }
    isDestroyed() { return this.destruida; }
    isVisible() { return this.visivel; }
    showInactive() { this.visivel = true; }
    hide() { this.visivel = false; }
    setBounds(b) { this.limites = b; }
    close() { this.destruida = true; this.visivel = false; this.ouvintes.closed?.(); }
  }
  return { janelas, modulo: { BrowserWindow, screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) } } };
}

test('janela do canto PERSISTENTE: só o X fecha; aviso aberto/lido sai e ela fica; recolhe com o programa na frente e volta', () => {
  const idElectron = require.resolve('electron');
  const antes = require.cache[idElectron];
  const falso = electronFalso();
  require.cache[idElectron] = { id: idElectron, filename: idElectron, loaded: true, exports: falso.modulo };
  delete require.cache[require.resolve('./janelaDeAviso')];
  const JW = require('./janelaDeAviso');
  try {
    JW.mostrar([{ id: 1 }, { id: 2 }], { som: true, raiz, arquivoDoSom: 'som-aviso.mp3' });
    const janela = falso.janelas[0];
    assert.strictEqual(janela.opcoes.focusable, false, 'não rouba o foco');
    assert.strictEqual(janela.nivel, 'screen-saver');
    assert.strictEqual(janela.ouvintes.blur, undefined, 'nada fecha a janela ao perder o foco');
    assert.deepStrictEqual(JW.pronto(), { avisos: [{ id: 2 }, { id: 1 }], som: true, somArquivo: 'som-aviso.mp3' });
    assert.strictEqual(JW.pronto().som, false, 'o som toca uma vez');
    JW.ajustarAltura(300);
    assert.strictEqual(janela.visivel, true);
    assert.strictEqual(janela.limites.height, 300);

    // Clicou no aviso 2 (ou o sino o marcou como lido): sai; a janela fica.
    assert.strictEqual(JW.retirar({ ids: [2] }), 1);
    assert.deepStrictEqual(janela.enviados.at(-1), ['avisos-windows:avisos', { avisos: [{ id: 1 }], som: false, somArquivo: 'som-aviso.mp3' }]);
    assert.strictEqual(JW.retirar({ ids: [77] }), 1, 'id que não está: nada muda');
    assert.strictEqual(janela.enviados.length, 1);
    JW.retirar({ todas: true });
    assert.deepStrictEqual(janela.enviados.at(-1)[1].avisos, [], 'vazia: "Tudo visto por aqui"');
    assert.ok(JW.estaAberta() && janela.visivel, 'continua aberta e na tela');

    // Programa na frente: recolhe (nem a altura nem aviso novo a mostram); saiu: volta.
    JW.recolher();
    assert.strictEqual(janela.visivel, false);
    JW.mostrar([{ id: 3 }], { som: false, raiz });
    JW.ajustarAltura(200);
    assert.strictEqual(janela.visivel, false, 'recolhida não aparece');
    assert.strictEqual(falso.janelas.length, 1, 'a mesma janela');
    JW.voltar();
    assert.strictEqual(janela.visivel, true);
    assert.deepStrictEqual(janela.enviados.at(-1)[1].avisos, [{ id: 3 }], 'aviso novo entra em cima');

    // O X: fecha e esvazia; o próximo aviso abre uma janela nova só com ele.
    JW.fechar();
    assert.strictEqual(JW.estaAberta(), false);
    JW.mostrar([{ id: 4 }], { som: true, raiz });
    assert.strictEqual(falso.janelas.length, 2);
    assert.deepStrictEqual(JW.pronto().avisos, [{ id: 4 }]);
    JW.fechar();
  } finally {
    if (antes) require.cache[idElectron] = antes; else delete require.cache[idElectron];
    delete require.cache[require.resolve('./janelaDeAviso')];
  }
});

test('main.js: iniciar com o Windows (só instalado) em segundo plano, sem janela, com o ícone e os avisos', () => {
  assert.ok(MAIN.includes("const iniciouEmSegundoPlano = process.argv.includes('--segundo-plano');"));
  assert.ok(MAIN.includes("app.setLoginItemSettings({ openAtLogin: Boolean(preferencias.iniciarComWindows), path: process.execPath, args: ['--segundo-plano'] });"));
  assert.match(MAIN, /function aplicarInicioComWindows\(\) \{\s+if \(!app\.isPackaged \|\| process\.platform !== 'win32'\) return;/);
  assert.ok(MAIN.includes('if (preferencias.primeiraVez) preferencias = preferenciasWindows.gravar(arquivoDePreferencias, preferencias);'), 'na 1ª vez grava o padrão (liga)');
  assert.ok(MAIN.includes('if (!(iniciouEmSegundoPlano && preferencias.avisosNoWindows)) createLoginWindow(false, true);'));
  assert.match(MAIN, /createLoginWindow\(false, true\);\s+criarBandeja\(\);\s+iniciarAvisosNoWindows\(\);/);
});

test('main.js: fechar vai para a bandeja (avisos ligados); sair de verdade só pelo menu da bandeja, atualização ou Windows', () => {
  assert.match(MAIN, /ipcMain\.handle\('close-window', \(\) => \{\s+\/\/[^\n]*\n\s+fecharOuSair\('close-window'\);/);
  assert.match(MAIN, /app\.on\('window-all-closed', \(\) => \{\s+\/\/[^\n]*\n\s+if \(ficarNaBandeja\(\)\) \{/);
  assert.match(MAIN, /app\.on\('before-quit', \(event\) => \{\s+\/\/[^\n]*\n\s+saindoDeVerdade = true;/);
  assert.ok(MAIN.includes("{ label: 'Sair do programa', click: () => sairDeVerdade() }"));
  assert.ok(MAIN.includes("fecharOuSair('ctrl-w');"));
  assert.match(MAIN, /function ficarNaBandeja\(\) \{\s+return Boolean\(preferencias\.avisosNoWindows\) && !saindoDeVerdade;/);
  // Abrir pelo atalho com o programa só na bandeja: mostra a janela certa.
  assert.match(MAIN, /app\.on\('second-instance', \(\) => \{\s+abrirPrograma\(\);/);
});

test('main.js: o login (e a entrada automática) fazem a máquina ser do usuário; a janela do canto só com o programa atrás', () => {
  assert.strictEqual(MAIN.split('avisosAposEntrar(user);').length - 1, 2, 'login-usuario e auto-login');
  assert.match(MAIN, /function programaNaFrente\(\) \{\s+return Boolean\(dashboardWindow && !dashboardWindow\.isDestroyed\(\) && dashboardWindow\.isVisible\(\) && dashboardWindow\.isFocused\(\)\);/);
  // Só o que o sino mostraria (as categorias de Configurações › Notificações, 02/10/2026).
  assert.ok(MAIN.includes('const visiveis = novos.filter(aviso => CategoriasAviso.aparece(aviso, categoriasDoSino));'));
  assert.ok(MAIN.includes("if (visiveis.length && preferencias.avisosNoWindows && !programaNaFrente()) {"));
  assert.ok(MAIN.includes("janelaDeAviso.mostrar(visiveis, { som: preferencias.som, raiz: __dirname, arquivoDoSom: arquivoDoSomDoDono() });"));
  assert.ok(MAIN.includes("categoriasDoSino = preferenciasWindows.lerCategorias(arquivoDasCategorias);"), 'vale com o programa só na bandeja');
  assert.match(MAIN, /ipcMain\.handle\('avisos-windows:categorias', \(_event, escolha\) => \{\s+categoriasDoSino = preferenciasWindows\.gravarCategorias\(arquivoDasCategorias, escolha \|\| \{\}\);/);
  // O token só dos avisos é guardado cifrado pelo Windows.
  assert.ok(MAIN.includes('safeStorage.isEncryptionAvailable()'));
  // Desligar os avisos esquece o usuário e o token.
  assert.match(MAIN, /pararAvisosNoWindows\(\);\s+servicoDeAvisos\?\.esquecer\(\);/);
});

test('main.js: a janela do canto não fecha ao abrir um aviso (só no X); recolhe com o menu na frente; som do dono', () => {
  const abrir = MAIN.slice(MAIN.indexOf("ipcMain.handle('avisos-windows:abrir'"), MAIN.indexOf("ipcMain.handle('avisos-windows:lidos'"));
  assert.ok(abrir.includes('janelaDeAviso.retirar({ ids: [clicado.id] });'));
  assert.ok(!abrir.includes('janelaDeAviso.fechar()'), 'abrir o programa não fecha a janela do canto');
  assert.match(MAIN, /ipcMain\.handle\('avisos-windows:dispensar', \(\) => janelaDeAviso\.fechar\(\)\);/, 'o X fecha');
  assert.ok(MAIN.includes("ipcMain.handle('avisos-windows:lidos', (_event, lidos) => janelaDeAviso.retirar({"));
  assert.ok(MAIN.includes("dashboardWindow.on('focus', () => janelaDeAviso.recolher());"));
  assert.ok(MAIN.includes("for (const saiuDaFrente of ['blur', 'hide', 'minimize']) {"));
  // Fora o X, só desligar os avisos ou sair do programa fecham a janela.
  assert.strictEqual(MAIN.split('janelaDeAviso.fechar()').length - 1, 2, 'dispensar (X) e pararAvisosNoWindows');
  assert.ok(MAIN.includes("somArquivo: arquivoDoSomDoDono()"), 'o sino também sabe do som do dono');
  assert.ok(MAIN.includes("preferenciasWindows.arquivoDoSom(path.join(__dirname, 'src', 'assets'))"));
});

test('preload e instalador: o canal avisosWindows; desinstalar tira o início com o Windows (menos na atualização)', () => {
  for (const canal of ['avisos-windows:preferencias', 'avisos-windows:gravar-preferencias', 'avisos-windows:pronto', 'avisos-windows:avisos',
    'avisos-windows:altura', 'avisos-windows:abrir', 'avisos-windows:dispensar', 'avisos-windows:abrir-no-sino', 'avisos-windows:pendente', 'avisos-windows:lidos', 'avisos-windows:categorias']) {
    assert.ok(PRELOAD.includes(`'${canal}'`), `preload: ${canal}`);
  }
  for (const canal of ['avisos-windows:preferencias', 'avisos-windows:gravar-preferencias', 'avisos-windows:pronto', 'avisos-windows:altura', 'avisos-windows:dispensar', 'avisos-windows:abrir', 'avisos-windows:pendente', 'avisos-windows:lidos', 'avisos-windows:categorias']) {
    assert.ok(MAIN.includes(`ipcMain.handle('${canal}'`), `main: ${canal}`);
  }
  assert.match(NSIS, /!macro customUnInstall\s+\$\{ifNot\} \$\{isUpdated\}\s+DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "com\.santissimo\.decor"/);
});
