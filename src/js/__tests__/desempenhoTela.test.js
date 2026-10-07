/**
 * Desempenho da tela (06/10/2026) — o que não pode voltar:
 *
 *  1. nove módulos tinham cada um a sua cópia do "abrir modal com spinner",
 *     com 1 s de piso e SEM relógio: modal que desse erro antes de avisar
 *     deixava a tela escura presa para sempre. Agora é um só,
 *     `Modal.openModuleModal`, com o mesmo piso de 1 s (o dono decidiu não
 *     baixar) e relógio de segurança;
 *  2. modais que avisavam "pronto" antes dos dados (Novo cliente, Novo
 *     orçamento, Novo insumo…) apareciam com os selects vazios;
 *  3. doze módulos não diziam ao menu quando a primeira carga terminava e a
 *     máscara saía por palpite.
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
function montar({ falhar = false } = {}) {
  const { janela, documento } = criarAmbiente();
  janela.MutationObserver = class {
    observe() { /* sem layout, sem observador */ }
    disconnect() {}
  };
  janela.fetch = async caminho => {
    if (falhar) throw new Error('arquivo não encontrado');
    return { text: async () => PAGINA(caminho.replace(/\.html$/, '')) };
  };
  const avisos = [];
  janela.console = { ...console, warn: (...a) => avisos.push(a.join(' ')), error: (...a) => avisos.push(a.join(' ')) };
  vm.createContext(janela);
  vm.runInContext(MODAL, janela);
  return { janela, documento, avisos, Modal: janela.Modal };
}

const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

test('openModuleModal: spinner até o modal avisar; a promessa resolve quando ele aparece', async () => {
  const { janela, documento, Modal } = montar();
  let resolvida = false;
  const promessa = Modal.openModuleModal('x.html', null, 'x', { minSpinnerMs: 0 });
  promessa.then(() => { resolvida = true; });
  await esperarTarefas();

  assert.ok(documento.getElementById('modalLoading'), 'sem o spinner da casa');
  assert.ok(documento.getElementById('xOverlay').classList.contains('hidden'), 'apareceu antes do aviso');
  assert.strictEqual(resolvida, false, 'a promessa resolveu antes de o modal aparecer');

  janela.dispatchEvent(new janela.CustomEvent('modalSpinnerLoaded', { detail: 'x' }));
  await promessa;
  assert.strictEqual(documento.getElementById('modalLoading'), null, 'o spinner ficou na tela');
  assert.ok(!documento.getElementById('xOverlay').classList.contains('hidden'), 'o modal continuou escondido');
});

test('openModuleModal: o aviso de OUTRO modal não revela este', async () => {
  const { janela, documento, Modal } = montar();
  const promessa = Modal.openModuleModal('x.html', null, 'x', { minSpinnerMs: 0, timeoutMs: 150 });
  await esperarTarefas();
  janela.dispatchEvent(new janela.CustomEvent('modalSpinnerLoaded', { detail: 'outro' }));
  await esperarTarefas();
  assert.ok(documento.getElementById('modalLoading'));
  assert.ok(documento.getElementById('xOverlay').classList.contains('hidden'));
  await promessa; // o relógio encerra, para o teste não ficar pendurado
});

test('openModuleModal: o piso de 1 s dos modais dos módulos continua (decisão do dono)', async () => {
  const { janela, documento, Modal } = montar();
  const inicio = Date.now();
  const promessa = Modal.openModuleModal('x.html', null, 'x');
  await esperarTarefas();
  janela.dispatchEvent(new janela.CustomEvent('modalSpinnerLoaded', { detail: 'x' }));
  await esperarTarefas();
  assert.ok(documento.getElementById('modalLoading'), 'revelou sem respeitar o piso');
  await promessa;
  const levou = Date.now() - inicio;
  assert.ok(levou >= 950 && levou < 1600, `levou ${levou} ms`);
});

test('openModuleModal: modal que nunca avisa é revelado pelo relógio, com rastro no console', async () => {
  const { documento, avisos, Modal } = montar();
  await Modal.openModuleModal('x.html', null, 'x', { minSpinnerMs: 0, timeoutMs: 40 });
  assert.strictEqual(documento.getElementById('modalLoading'), null, 'a tela escura ficou presa');
  assert.ok(!documento.getElementById('xOverlay').classList.contains('hidden'));
  assert.ok(avisos.some(a => a.includes('x não avisou')), 'sem o aviso no console');
});

test('openModuleModal: fechar antes de carregar tira o spinner e resolve a promessa', async () => {
  const { documento, Modal } = montar();
  const promessa = Modal.openModuleModal('x.html', null, 'x', { minSpinnerMs: 0 });
  await esperarTarefas();
  Modal.close('x');
  await promessa;
  assert.strictEqual(documento.getElementById('modalLoading'), null);
});

test('openModuleModal: página do modal que não chega não deixa spinner nenhum', async () => {
  const { documento, avisos, Modal } = montar({ falhar: true });
  const inicio = Date.now();
  await Modal.openModuleModal('x.html', null, 'x', { minSpinnerMs: 0 });
  assert.ok(Date.now() - inicio < 1000, 'esperou o relógio em vez de desistir na hora');
  assert.strictEqual(documento.getElementById('modalLoading'), null);
  assert.ok(avisos.some(a => a.includes('x não abriu')));
});

test('openModuleModal: abertura cancelada no meio (closeAll) não deixa o spinner na tela', async () => {
  const { documento, Modal } = montar();
  const inicio = Date.now();
  const promessa = Modal.openModuleModal('x.html', null, 'x', { minSpinnerMs: 0 });
  Modal.closeAll(); // antes de a página chegar
  await promessa;
  assert.ok(Date.now() - inicio < 1000, 'esperou o relógio');
  assert.strictEqual(documento.getElementById('modalLoading'), null);
});

test('openWithSpinner: aviso extra (orcamentoModalLoaded) só vale para quem pede', async () => {
  const { janela, documento, Modal } = montar();
  const comExtra = Modal.openModuleModal('x.html', null, 'x', { minSpinnerMs: 0, eventosDePronto: ['orcamentoModalLoaded'] });
  await esperarTarefas();
  janela.dispatchEvent(new janela.CustomEvent('orcamentoModalLoaded', { detail: 'x' }));
  await comExtra;
  assert.ok(!documento.getElementById('xOverlay').classList.contains('hidden'));

  // Sem pedir, o mesmo evento não revela — o Novo orçamento o dispara antes dos dados.
  const semExtra = Modal.openModuleModal('y.html', null, 'y', { minSpinnerMs: 0, timeoutMs: 150 });
  await esperarTarefas();
  janela.dispatchEvent(new janela.CustomEvent('orcamentoModalLoaded', { detail: 'y' }));
  await esperarTarefas();
  assert.ok(documento.getElementById('yOverlay').classList.contains('hidden'), 'revelou com um aviso que não pediu');
  await semExtra;
});

test('openModuleModal: abrir um modal fecha os que estavam abertos (como as cópias antigas)', async () => {
  const { janela, documento, Modal } = montar();
  await Modal.open('velho.html', null, 'velho', true);
  await esperarTarefas();
  assert.ok(documento.getElementById('velhoOverlay'));
  const promessa = Modal.openModuleModal('x.html', null, 'x', { minSpinnerMs: 0 });
  await esperarTarefas();
  janela.dispatchEvent(new janela.CustomEvent('modalSpinnerLoaded', { detail: 'x' }));
  await promessa;
  await esperar(0);
  assert.strictEqual(documento.getElementById('velhoOverlay'), null);
  assert.ok(documento.getElementById('xOverlay'));
});

const MODULOS_COM_SPINNER = [
  'clientes', 'contatos', 'ia', 'laminacao-clientes', 'laminacao-servicos',
  'materia-prima', 'produtos', 'prospeccoes', 'usuarios'
];

test('os módulos abrem os modais pelo spinner único, sem cópia própria', () => {
  for (const modulo of MODULOS_COM_SPINNER) {
    const js = ler(`js/${modulo}.js`);
    assert.ok(js.includes('return Modal.openModuleModal(htmlPath, scriptPath, overlayId);'), `${modulo} sem o spinner único`);
    assert.doesNotMatch(js, /MIN_SPINNER_MS\s*=\s*1000/, `${modulo} voltou a ter o piso de 1 s`);
    assert.doesNotMatch(js, /spinner\.id\s*=\s*'modalLoading'/, `${modulo} voltou a montar o spinner na mão`);
  }
  const orcamentos = ler('js/orcamentos.js');
  assert.ok(orcamentos.includes("Modal.openModuleModal('modals/orcamentos/novo.html'"), 'Novo orçamento sem o spinner único');
  // Visualizar e Editar: a décima cópia, que ouvia `orcamentoModalLoaded` sem relógio.
  assert.ok(orcamentos.includes("return Modal.openModuleModal(htmlPath, scriptPath, overlayId, { eventosDePronto: ['orcamentoModalLoaded'], minSpinnerMs: 0 });"),
    'openQuoteModal sem o spinner único');
  assert.doesNotMatch(orcamentos, /function openQuoteModal[^}]*createElement\('div'\)/, 'openQuoteModal voltou a montar spinner próprio');
});

test('sub-modais que leem dados abrem com spinner e nascem escondidos', () => {
  const produtos = ler('js/produtos.js');
  assert.ok(produtos.includes("openModalWithSpinner('modals/produtos/novo.html', '../js/modals/produto-novo.js', 'novoProduto');"),
    'Novo produto sem spinner');
  const novoProduto = ler('js/modals/produto-novo.js');
  assert.ok(novoProduto.includes('Promise.allSettled(cargasIniciais).finally('), 'Novo produto avisa antes dos dados');
  for (const carga of ['cargasIniciais.push(carregarColecoes());', "cargasIniciais.push(carregarDesenhistas(''));",
    'cargasIniciais.push(prepararRegra()', 'cargasIniciais.push(window.electronAPI.listarEtapasProducao()']) {
    assert.ok(novoProduto.includes(carga), `Novo produto não espera: ${carga}`);
  }
  assert.match(ler('html/modals/produtos/novo.html'), /<div id="novoProdutoOverlay" class="hidden /);

  const prospeccoes = ler('js/prospeccoes.js');
  assert.ok(prospeccoes.includes("return openModalWithSpinner('modals/prospeccoes/responsavel.html'"), 'Responsável sem spinner');
  assert.match(ler('html/modals/prospeccoes/responsavel.html'), /<div id="responsavelProspeccaoOverlay" class="hidden /);

  // A ficha da prospecção abre o Novo orçamento esperando o aviso que vem DEPOIS dos dados.
  assert.ok(ler('js/modals/prospeccao-detalhes.js')
    .includes("const aviso = overlayId === 'novoOrcamento' ? 'modalSpinnerLoaded' : 'orcamentoModalLoaded';"));
});

test('os pisos de spinner continuam os de antes (o dono decidiu NÃO baixar)', () => {
  const modal = ler('utils/modal.js');
  assert.match(modal, /minSpinnerMs = 500,/, 'openWithSpinner (Pedidos e por cima) era 0,5 s');
  assert.match(modal, /const PISO_DOS_MODAIS_DO_MODULO_MS = 1000;/, 'modais dos módulos eram 1 s');
  assert.match(modal, /minSpinnerMs: PISO_DOS_MODAIS_DO_MODULO_MS,\s*\.\.\.opcoes,/);
  assert.match(ler('js/menu.js'), /const MIN_MODULE_SPINNER_MS = 1000;/);
  assert.match(ler('js/financeiro.js'), /const FIN_SPINNER_MINIMO_MS = 1000;/);
  assert.match(ler('js/contabilidade.js'), /const CTB_SPINNER_MINIMO_MS = 1000;/);
  // Visualizar/Editar orçamento nunca teve piso: aparece quando o orçamento chega.
  assert.ok(ler('js/orcamentos.js').includes("{ eventosDePronto: ['orcamentoModalLoaded'], minSpinnerMs: 0 }"));
});

test('os modais de cadastro só avisam "pronto" depois dos dados', () => {
  const casos = [
    ['js/modals/cliente-novo.js', 'Promise.allSettled(cargas).finally(avisarPronto);'],
    ['js/modals/laminacao-clientes/cliente-novo.js', 'Promise.allSettled(cargas).finally(avisarPronto);'],
    ['js/modals/laminacao-servicos/servico-novo.js', 'Promise.resolve(clientesProntos).catch(() => null).finally(avisarPronto);'],
    ['js/modals/orcamento-novo.js', 'Promise.allSettled(cargasIniciais).finally('],
    ['js/modals/materia-prima-novo.js', 'Promise.resolve(carregarOpcoes()).catch(() => null).finally(']
  ];
  for (const [arquivo, trecho] of casos) {
    assert.ok(ler(arquivo).includes(trecho), `${arquivo} avisa antes dos dados`);
  }
  // E nascem escondidos: quem revela é o spinner.
  for (const html of ['html/modals/orcamentos/novo.html', 'html/modals/materia-prima/novo.html']) {
    assert.match(ler(html), /<div id="\w+Overlay" class="hidden /, `${html} nasce visível`);
  }
});

test('os módulos dizem ao menu quando a primeira carga terminou', () => {
  const casos = {
    clientes: 'carregarClientes()', contatos: 'carregarContatos()', ia: 'carregarLeituras()',
    'laminacao-clientes': 'carregarClientes()', 'laminacao-servicos': 'carregarServicos()',
    orcamentos: 'carregarOrcamentos()', pedidos: 'carregarPedidos()', produtos: 'carregarProdutos()',
    prospeccoes: 'carregarProspeccoes()', usuarios: 'carregarUsuarios()', 'materia-prima': 'carregarMateriais()',
    relatorios: 'loadTableForTab(initialTabKey)'
  };
  for (const [modulo, carga] of Object.entries(casos)) {
    const js = ler(`js/${modulo}.js`);
    const linha = js.split(/\r?\n/).find(l => l.includes('window.moduloPronto?.('));
    assert.ok(linha && linha.includes(carga), `${modulo} não publica a primeira carga`);
  }
  const menu = ler('js/menu.js');
  assert.match(menu, /window\.moduloPronto = promessa =>/);
  assert.match(menu, /const TETO_DA_CARGA_DO_MODULO_MS = 20000;/);
});
