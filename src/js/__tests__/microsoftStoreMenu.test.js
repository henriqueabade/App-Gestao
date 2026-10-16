/**
 * Alinhamento com a versão da Microsoft Store (App-Gestao-Store, 16/10/2026):
 * no pacote da Store o menu tira os itens que ainda não têm tela. Lá isso é
 * travado em backend/buildMicrosoftStore.test.js, que não existe aqui. Neste
 * app (instalador NSIS) o canal sempre responde `false` e o menu fica igual.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', '..', '..');
const ler = rel => fs.readFileSync(path.join(raiz, rel), 'utf8');

test('canal get-na-microsoft-store: só o pacote da Store diz sim; o menu tira as páginas sem tela só nele', () => {
  assert.ok(ler('main.js').includes("ipcMain.handle('get-na-microsoft-store', () => process.windowsStore === true);"));
  assert.ok(ler('preload.js').includes("getNaMicrosoftStore: () => ipcRenderer.invoke('get-na-microsoft-store')"));
  const MENU_JS = ler('src/js/menu.js');
  assert.ok(MENU_JS.includes("const PAGINAS_SEM_TELA = ['laminacao-precificacao', 'laminacao-relatorios'];"));
  assert.match(MENU_JS, /if \(!window\.electronAPI\?\.getNaMicrosoftStore\) return;/, 'preload antigo: nada muda');
  assert.match(MENU_JS, /if \(!\(await window\.electronAPI\.getNaMicrosoftStore\(\)\)\) return;\s+PAGINAS_SEM_TELA\.forEach/);
  // Fora da Store os itens continuam no menu, como sempre.
  const MENU_HTML = ler('src/html/menu.html');
  for (const pagina of ['laminacao-precificacao', 'laminacao-relatorios']) {
    assert.ok(MENU_HTML.includes(`data-page="${pagina}"`), `${pagina} continua no menu`);
    assert.ok(!fs.existsSync(path.join(raiz, 'src', 'html', `${pagina}.html`)), `${pagina} ganhou tela: tirar da lista`);
  }
});
