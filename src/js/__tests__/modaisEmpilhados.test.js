/**
 * Modais que abrem POR CIMA de outro — o que quebrou em 23/09/2026 e não
 * pode voltar:
 *
 *  1. abrir o MESMO modal duas vezes deixava a primeira cópia órfã no corpo
 *     da página. Com dois elementos de mesmo id, o script do modal novo
 *     ligava os botões no fantasma (getElementById devolve o primeiro) e o
 *     `close` tirava o invisível: o Voltar/Cancelar do "Emitir NF-e e
 *     enviar" não fechava nada;
 *  2. quem abria por cima não mostrava o spinner da casa nem revelava a
 *     tela. Os modais que esperam o aviso de pronto — Emitir NF-e e Importar
 *     boletos do BB — ficavam ESCONDIDOS para sempre (o botão parecia
 *     morto), e os que se revelam sozinhos apareciam vazios, com os dados
 *     caindo depois.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente, esperarTarefas } = require('./apoio/domMinimo');

const SRC = path.join(__dirname, '..', '..');
const ler = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');
const MODAL = ler('utils/modal.js');

const PAGINA = id => `<div id="${id}Overlay" class="hidden fixed inset-0 z-[1200]"><div role="dialog"><p>conteúdo</p></div></div>`;

/** O utils/modal.js de verdade rodando sobre o DOM mínimo. */
function montar() {
  const { janela, documento, disparar } = criarAmbiente();
  janela.MutationObserver = class {
    observe() { /* sem layout, sem observador */ }
    disconnect() {}
  };
  const pedidos = [];
  janela.fetch = async caminho => {
    pedidos.push(caminho);
    return { text: async () => PAGINA(caminho.replace(/\.html$/, '')) };
  };
  vm.createContext(janela);
  vm.runInContext(MODAL, janela);
  return { janela, documento, disparar, pedidos, Modal: janela.Modal };
}

const quantosOverlays = (documento, id) => documento.querySelectorAll(`#${id}Overlay`).length;

test('abrir o mesmo modal duas vezes não deixa cópia antiga na página', async () => {
  const { documento, Modal } = montar();
  await Modal.open('x.html', null, 'x', true);
  await Modal.open('x.html', null, 'x', true);
  await esperarTarefas();
  assert.strictEqual(quantosOverlays(documento, 'x'), 1, 'o fantasma da primeira abertura ficou no corpo da página');
});

test('o Fechar tira o modal que está na tela, não uma cópia invisível', async () => {
  const { documento, Modal } = montar();
  await Modal.open('x.html', null, 'x', true);
  await Modal.open('x.html', null, 'x', true);
  await esperarTarefas();
  Modal.close('x');
  assert.strictEqual(quantosOverlays(documento, 'x'), 0, 'sobrou modal na tela depois do Fechar');
});

test('modal aberto por cima de outro não derruba o de baixo', async () => {
  const { documento, Modal } = montar();
  await Modal.open('pai.html', null, 'pai', true);
  await Modal.open('filho.html', null, 'filho', true);
  await esperarTarefas();
  assert.strictEqual(quantosOverlays(documento, 'pai'), 1);
  assert.strictEqual(quantosOverlays(documento, 'filho'), 1);
});

test('openWithSpinner: spinner na tela e modal escondido até o aviso de pronto', async () => {
  const { janela, documento, Modal } = montar();
  await Modal.openWithSpinner('x.html', null, 'x', { keepExisting: true, minSpinnerMs: 0 });
  await esperarTarefas();

  assert.ok(documento.getElementById('modalLoading'), 'sem o spinner da casa');
  assert.ok(documento.getElementById('xOverlay').classList.contains('hidden'), 'o modal apareceu antes de estar pronto');

  janela.dispatchEvent(new janela.CustomEvent('pedidoModalLoaded', { detail: 'x' }));
  await esperarTarefas();

  assert.strictEqual(documento.getElementById('modalLoading'), null, 'o spinner ficou preso na tela');
  assert.ok(!documento.getElementById('xOverlay').classList.contains('hidden'), 'o modal continuou escondido');
});

test('openWithSpinner: o signalReady do próprio modal também revela', async () => {
  const { documento, Modal } = montar();
  await Modal.openWithSpinner('x.html', null, 'x', { keepExisting: true, minSpinnerMs: 0 });
  await esperarTarefas();
  Modal.signalReady('x');
  await esperarTarefas();
  assert.ok(!documento.getElementById('xOverlay').classList.contains('hidden'));
  assert.strictEqual(documento.getElementById('modalLoading'), null);
});

test('openWithSpinner: fechar antes de carregar não deixa o spinner preso', async () => {
  const { documento, Modal } = montar();
  await Modal.openWithSpinner('x.html', null, 'x', { keepExisting: true, minSpinnerMs: 0 });
  await esperarTarefas();
  Modal.close('x');
  await esperarTarefas();
  assert.strictEqual(documento.getElementById('modalLoading'), null);
});

test('quem abre por cima usa o spinner da casa', () => {
  const VISUALIZAR = ler('js/modals/pedido-visualizar.js');
  assert.ok(VISUALIZAR.includes("Modal.openWithSpinner(htmlPath, scriptPath, filhoId, { keepExisting: true })"),
    'o abrirPorCima do Visualizar precisa do spinner');
  const FINANCEIRO = ler('js/modals/financeiro-modais.js');
  assert.ok(FINANCEIRO.includes("window.Modal.openWithSpinner(htmlPath, scriptPath, id, { keepExisting: true })"),
    'os modais de pedido abertos do Financeiro também');
  assert.ok(FINANCEIRO.includes("window.Modal.openWithSpinner('modals/pedidos/importar-boletos.html'"),
    'Importar boletos do BB, na Configuração de cobrança');
  const GERAR = ler('js/modals/pedido-gerar-boletos.js');
  assert.ok(GERAR.includes("Modal.openWithSpinner('modals/pedidos/boleto-detalhe.html'"), 'o boleto por cima do Gerar boletos');
  const PEDIDOS = ler('js/pedidos.js');
  assert.ok(PEDIDOS.includes('Modal.openWithSpinner(htmlPath, scriptPath, overlayId)'), 'a lista de Pedidos usa a mesma mecânica');
});

test('modal com leitura própria só aparece depois da primeira carga', () => {
  for (const arquivo of ['pedido-gerar-boletos.js', 'pedido-boleto-detalhe.js', 'pedido-dados-externos.js', 'pedido-devolucao.js']) {
    const fonte = ler(`js/modals/${arquivo}`);
    assert.ok(fonte.includes('Promise.resolve(carregar())') && fonte.includes('.finally(revelar)'),
      `${arquivo} ainda aparece vazio antes de carregar`);
    const revelar = fonte.indexOf('const revelar = () => {');
    assert.ok(revelar > 0 && fonte.indexOf("overlay.classList.remove('hidden')", revelar) > revelar,
      `${arquivo} precisa revelar dentro do revelar()`);
  }
});

test('Importar boletos do BB: a tela de verdade sai do "hidden" e avisa que está pronta', async () => {
  const { janela, documento, montar } = (() => {
    const amb = criarAmbiente();
    return { ...amb, montar: amb.montar };
  })();
  montar(ler('html/modals/pedidos/importar-boletos.html'));
  janela.URLSearchParams = URLSearchParams;
  janela.apiConfig = { getApiBaseUrl: async () => '' };
  janela.importarBoletosContext = {};
  const chamadas = [];
  janela.fetch = async (caminho) => {
    chamadas.push(caminho);
    return {
      ok: true,
      json: async () => ({
        ambiente: 'producao', conta: { agencia: '1614', conta: '16773', convenio: '3453481' },
        situacao: 'A', de: '2025-09-23', ate: '2027-09-23',
        boletos: [], resumo: { total: 0, ja_importados: 0, com_sugestao: 0 }
      })
    };
  };
  const avisos = [];
  janela.addEventListener('pedidoModalLoaded', e => avisos.push(e.detail));
  janela.Modal = { close() {}, signalReady: id => avisos.push(`pronto:${id}`) };

  vm.createContext(janela);
  vm.runInContext(ler('js/modals/pedido-importar-boletos.js'), janela);
  await esperarTarefas(12);

  const overlay = documento.getElementById('importarBoletosOverlay');
  assert.ok(!overlay.classList.contains('hidden'), 'o modal ficaria invisível — foi exatamente o defeito relatado');
  assert.ok(chamadas.some(c => c.includes('/api/cobranca/importacao/boletos')), 'nem chegou a perguntar ao BB');
  assert.ok(avisos.includes('importarBoletos') && avisos.includes('pronto:importarBoletos'), 'sem os dois avisos de pronto');
});

test('os modais que avisam pelo pedidoModalLoaded também se revelam sozinhos', () => {
  for (const arquivo of ['pedido-emitir-nfe.js', 'pedido-importar-boletos.js']) {
    const fonte = ler(`js/modals/${arquivo}`);
    const aviso = fonte.indexOf("new CustomEvent('pedidoModalLoaded'");
    assert.ok(aviso > 0, `${arquivo} sem o aviso de pronto`);
    const trecho = fonte.slice(aviso - 400, aviso);
    assert.ok(trecho.includes("overlay.classList.remove('hidden')"), `${arquivo} pode ficar escondido para sempre`);
    assert.ok(trecho.includes('window.Modal?.signalReady?.(overlayId)'), `${arquivo} sem o signalReady`);
  }
});
