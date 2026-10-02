/**
 * A janela dos avisos no canto inferior direito da tela (01/10/2026, pedido
 * do dono): aparece quando chega aviso e o programa NÃO está na frente; toca
 * o "tum-tum" se o som estiver ligado. Por cima de tudo, sem roubar o foco de
 * quem está digitando em outro programa.
 *
 * PERSISTENTE (decisão do dono, 01/10/2026): só fecha no X dela — não some
 * sozinha, não fecha ao perder o foco. Clicar num aviso (ou em "Abrir o
 * programa") abre o programa e a janela continua; o aviso aberto sai da lista
 * (`retirar`), e os lidos no sino também (`retirar` pelo main.js). Aviso novo
 * entra em cima. Sem nenhum, ela mostra "Tudo visto por aqui" até o X.
 *
 * Com o programa na frente quem avisa é o sino: a janela SE RECOLHE (fica
 * escondida, com a lista) e volta quando o programa sai da frente
 * (`recolher` / `voltar`, chamados pelos eventos da janela do menu).
 *
 * A página é src/html/aviso-windows.html (src/js/aviso-windows.js); ela pede
 * os avisos (`pronto`), desenha, diz a altura que precisa e o main.js a mostra.
 * Janela com sandbox: o main.js não a força para tela cheia como as outras.
 */
const path = require('path');

const LARGURA = 400;
const MARGEM = 16;
const ALTURA_MINIMA = 160;
// Até uns 4 avisos à vista; com mais, só o meio da janela rola (02/10/2026).
const ALTURA_MAXIMA = 520;
const MAX_NA_FILA = 20;

let janela = null;
let fila = [];
let tocarSom = false;
let somArquivo = null;
let recolhida = false;

/** Junta os avisos novos aos que já estão na janela: mais novos primeiro, sem repetir. Pura. */
function juntar(atual = [], novos = [], max = MAX_NA_FILA) {
  const porId = new Map();
  for (const a of [...atual, ...novos]) if (a && a.id !== undefined) porId.set(Number(a.id), a);
  return [...porId.values()].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, max);
}

/** Tira da lista os avisos destes ids (`todas`: tira todos). Pura. */
function semOsLidos(atual = [], { ids = [], todas = false } = {}) {
  if (todas) return [];
  const fora = new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isFinite));
  return atual.filter(a => !fora.has(Number(a.id)));
}

/**
 * Onde a janela fica: canto inferior direito da área útil (acima da barra de
 * tarefas). A altura é a que a página pediu, entre ALTURA_MINIMA e
 * ALTURA_MAXIMA (e nunca maior que a tela); o que não couber rola dentro dela.
 * Pura.
 */
function posicao(area, altura) {
  const teto = Math.min(ALTURA_MAXIMA, area.height - 2 * MARGEM);
  const h = Math.max(Math.min(ALTURA_MINIMA, teto), Math.min(Number(altura) || ALTURA_MINIMA, teto));
  return { x: area.x + area.width - LARGURA - MARGEM, y: area.y + area.height - h - MARGEM, width: LARGURA, height: h };
}

function viva() {
  return Boolean(janela && !janela.isDestroyed());
}

function enviar() {
  if (!viva()) return;
  janela.webContents.send('avisos-windows:avisos', { avisos: fila, som: tocarSom, somArquivo });
  tocarSom = false;
}

function criar(raiz) {
  const { BrowserWindow, screen } = require('electron');
  const area = screen.getPrimaryDisplay().workArea;
  janela = new BrowserWindow({
    ...posicao(area, 180), show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, closable: true,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, title: 'Avisos — Santíssimo Decor',
    webPreferences: {
      preload: path.join(raiz, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  // Por cima até de programa em tela cheia (vídeo, apresentação).
  janela.setAlwaysOnTop(true, 'screen-saver');
  janela.on('closed', () => { janela = null; });
  janela.loadFile(path.join(raiz, 'src', 'html', 'aviso-windows.html'));
}

/**
 * Mostra (ou acrescenta) avisos. `som`: tocar o tum-tum desta vez;
 * `somArquivo`: o som escolhido pelo dono (src/assets), se houver.
 */
function mostrar(avisos = [], { som = true, raiz, arquivoDoSom = null } = {}) {
  if (!avisos.length) return;
  fila = juntar(fila, avisos);
  tocarSom = Boolean(som);
  somArquivo = arquivoDoSom || null;
  if (!viva()) {
    criar(raiz);
    return; // a página pede os avisos quando carregar (pronto)
  }
  enviar();
}

/** A página carregou: leva os avisos e se toca o som. */
function pronto() {
  const resposta = { avisos: fila, som: tocarSom, somArquivo };
  tocarSom = false;
  return resposta;
}

/** A página diz quanto precisa de altura; a janela se ajusta e aparece sem tomar o foco. */
function ajustarAltura(altura) {
  if (!viva()) return;
  const { screen } = require('electron');
  janela.setBounds(posicao(screen.getPrimaryDisplay().workArea, altura));
  if (!recolhida && !janela.isVisible()) janela.showInactive();
}

/** Tira avisos da lista (abertos ou lidos no programa). A janela fica, mesmo vazia. */
function retirar(lidos = {}) {
  const antes = fila.length;
  fila = semOsLidos(fila, lidos);
  if (fila.length !== antes) enviar();
  return fila.length;
}

/** O programa veio para a frente: a janela sai do caminho, com a lista guardada. */
function recolher() {
  recolhida = true;
  if (viva() && janela.isVisible()) janela.hide();
}

/** O programa saiu da frente: a janela (se não foi fechada no X) volta. */
function voltar() {
  recolhida = false;
  if (viva() && !janela.isVisible()) janela.showInactive();
}

/** Fecha e esvazia: o X da janela (ou os avisos desligados, ou sair do programa). */
function fechar() {
  fila = [];
  tocarSom = false;
  if (viva()) janela.close();
}

module.exports = {
  LARGURA, MARGEM, ALTURA_MINIMA, ALTURA_MAXIMA, MAX_NA_FILA, juntar, semOsLidos, posicao, mostrar, pronto, ajustarAltura,
  retirar, recolher, voltar, fechar, estaAberta: viva, estaRecolhida: () => recolhida
};
