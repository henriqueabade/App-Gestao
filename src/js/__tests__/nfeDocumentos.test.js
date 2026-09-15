/**
 * DANFE, XML e cancelamento da NF-e a partir do Visualizar pedido (etapa 5a):
 * os botões no rodapé (guardas escritas no HTML), o caminho do PDF em retrato
 * e do XML pelo Electron, e o modal "Cancelar NF-e" com a justificativa.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const VIS_HTML = ler('html', 'modals', 'pedidos', 'visualizar.html');
const VIS_JS = ler('js', 'modals', 'pedido-visualizar.js');
const CANC_HTML = ler('html', 'modals', 'pedidos', 'cancelar-nfe.html');
const CANC_JS = ler('js', 'modals', 'pedido-cancelar-nfe.js');
const MAIN = ler('..', 'main.js');
const PRELOAD = ler('..', 'preload.js');

function recortarFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada`);
  let i = fonte.indexOf('{', inicio);
  let nivel = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}') { nivel -= 1; if (nivel === 0) break; }
  }
  return fonte.slice(inicio, i + 1);
}

test('visualizar: botões DANFE/XML/Cancelar NF-e escondidos no HTML com as guardas, ao lado das tags', () => {
  assert.ok(/id="visualizarPedidoDanfe"[^>]*data-perm="financeiro\.nfe\.view"[^>]*class="hidden/.test(VIS_HTML));
  assert.ok(/id="visualizarPedidoXml"[^>]*data-perm="financeiro\.nfe\.view"[^>]*class="hidden/.test(VIS_HTML));
  assert.ok(/id="visualizarPedidoCancelarNfe"[^>]*data-perm="financeiro\.nfe\.cancel"[^>]*class="hidden btn-danger/.test(VIS_HTML));
  assert.ok(VIS_HTML.indexOf('id="visualizarPedidoTagsLista"') < VIS_HTML.indexOf('id="visualizarPedidoDanfe"'));
  assert.ok(VIS_HTML.indexOf('id="visualizarPedidoCancelarNfe"') < VIS_HTML.indexOf('id="cancelarVisualizarPedido"'), 'dentro do bloco central, antes dos botões do rodapé');
});

test('visualizar: DANFE vai ao PDF em retrato, XML ao arquivo .xml (e o do cancelamento), cancelar abre o modal próprio', () => {
  const contexto = vm.createContext({});
  vm.runInContext(recortarFuncao(VIS_JS, 'notaParaDocumentos'), contexto);
  const f = contexto.notaParaDocumentos;
  assert.strictEqual(f([{ id: 1, status_fiscal: 'rejeitada' }]), null);
  assert.strictEqual(f([{ id: 1, status_fiscal: 'autorizada' }, { id: 2, status_fiscal: 'cancelada' }]).id, 2);
  assert.strictEqual(f([{ id: 3, status_fiscal: 'processando' }, { id: 1, status_fiscal: 'autorizada' }]).id, 1);

  assert.ok(VIS_JS.includes('/api/fiscal/notas/${encodeURIComponent(nota.id)}/danfe'));
  assert.ok(VIS_JS.includes("salvarHtmlComoPdf?.({ html: corpo.html, nomeSugerido: corpo.nome, titulo: 'Salvar DANFE em PDF', retrato: true })"));
  assert.ok(VIS_JS.includes('/api/fiscal/notas/${encodeURIComponent(nota.id)}/xml'));
  assert.ok(VIS_JS.includes("extensao: 'xml'") && VIS_JS.includes('corpo.xml_cancelamento'));
  assert.ok(VIS_JS.includes("Modal.open('modals/pedidos/cancelar-nfe.html', '../js/modals/pedido-cancelar-nfe.js', 'cancelarNfe')"));
  assert.ok(VIS_JS.includes("if (nota.status_fiscal === 'autorizada') ligar(cancelarBtn, cancelarNfe);"), 'cancelar só com nota autorizada');
  assert.ok(VIS_JS.includes('ligarDocumentosDaNota(notaParaDocumentos(notas), data)'));
});

test('Electron: o PDF aceita retrato e existe o IPC de salvar texto, exposto no preload', () => {
  assert.ok(MAIN.includes("ipcMain.handle('salvar-html-como-pdf', async (_event, { html, nomeSugerido, titulo, retrato = false } = {})"));
  assert.ok(MAIN.includes('landscape: !retrato'));
  assert.ok(MAIN.includes("ipcMain.handle('salvar-texto-como-arquivo'"));
  assert.ok(PRELOAD.includes("salvarTextoComoArquivo: (payload) => ipcRenderer.invoke('salvar-texto-como-arquivo', payload)"));
});

test('modal Cancelar NF-e: justificativa de 15 a 255, confirmação na caixa da casa, POST /cancelar e mensagens', () => {
  for (const id of ['cancelarNfeOverlay', 'cancelarNfeJustificativa', 'cancelarNfeContador', 'cancelarNfeMensagem', 'voltarCancelarNfe', 'desistirCancelarNfe', 'confirmarCancelarNfe']) {
    assert.ok(CANC_HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="confirmarCancelarNfe"[^>]*data-perm="financeiro\.nfe\.cancel"/.test(CANC_HTML));
  assert.ok(CANC_HTML.includes('maxlength="255"'));
  assert.ok(!CANC_HTML.includes('onclick'));

  const inicio = CANC_JS.indexOf('const MINIMO');
  const fim = CANC_JS.indexOf('// ------------------------------------------------- fim das funções puras');
  assert.ok(inicio > 0 && fim > inicio);
  const contexto = vm.createContext({});
  const f = vm.runInContext(`${CANC_JS.slice(inicio, fim)}\n({ avaliarJustificativa, textoDoContador, mensagemDeErro })`, contexto);
  assert.strictEqual(f.avaliarJustificativa('  Pedido   cancelado pelo cliente ').erro, null);
  assert.strictEqual(f.avaliarJustificativa('  Pedido   cancelado pelo cliente ').limpa, 'Pedido cancelado pelo cliente');
  assert.match(f.avaliarJustificativa('curta').erro, /pelo menos 15 caracteres \(faltam 10\)/);
  assert.match(f.avaliarJustificativa('x'.repeat(300)).erro, /passa de 255/);
  assert.strictEqual(f.textoDoContador('abc'), '3 / 255 — mínimo de 15 caracteres');
  assert.strictEqual(f.textoDoContador('x'.repeat(20)), '20 / 255');
  assert.match(f.mensagemDeErro(422, { sefaz: { cStat: '573', xMotivo: 'Duplicidade de Evento' } }), /recusou o cancelamento \(573\): Duplicidade de Evento/);
  assert.match(f.mensagemDeErro(409, { error: 'Só uma nota autorizada pode ser cancelada' }), /Só uma nota autorizada/);
  assert.match(f.mensagemDeErro(403, null), /permissão/);

  assert.ok(CANC_JS.includes('/api/fiscal/notas/${encodeURIComponent(ctx.notaId)}/cancelar'));
  assert.ok(CANC_JS.includes('window.DialogPadrao?.confirm?.({') && !/window\.confirm\(/.test(CANC_JS));
  assert.ok(CANC_JS.includes("window.dispatchEvent(new CustomEvent('nfe:cancelada'"));
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(CANC_JS));
  assert.ok(CANC_JS.includes("document.removeEventListener('keydown', aoEsc)"));
});
