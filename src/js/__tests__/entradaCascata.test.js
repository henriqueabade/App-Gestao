/**
 * Entrada em cascata nos módulos (06/10/2026 — "o mesmo efeito do Financeiro
 * e da Contabilidade nos outros módulos") e a tabela de Contatos.
 *
 * O que não pode voltar:
 *  - o JavaScript dos módulos pondo opacity/transform inline nos blocos da
 *    entrada: o `fadeInUp` (só `to`) partia de opacity 1 e a animação ficava
 *    invisível — eram 12 módulos assim;
 *  - o atraso pela posição entre irmãos: em Prospecções e na IA a tabela
 *    subia antes dos filtros;
 *  - a subida refeita toda vez que um bloco some e volta (lista vazia ao
 *    filtrar, depois com resultado);
 *  - o cabeçalho 20 px abaixo do lugar até o fim da entrada;
 *  - a tabela de Contatos sem rolagem (faltava na lista do scroll.css).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente } = require('./apoio/domMinimo');

const SRC = path.join(__dirname, '..', '..');
const ler = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');
const UTIL = ler('js/utils/entrada-cascata.js');

function montar(html) {
  const { janela, documento, montar: pendurar } = criarAmbiente();
  vm.createContext(janela);
  vm.runInContext(UTIL, janela);
  const wrapper = pendurar(html);
  return { janela, documento, modulo: wrapper.querySelector('.modulo-container'), Cascata: janela.EntradaCascata };
}

const MODULO_DE_LISTA = `
  <div class="modulo-container"><div>
    <div class="clientes-header animate-fade-in-up module-introduction-row"><div><h1>Clientes</h1></div></div>
    <div id="filtros" class="glass-surface animate-fade-in-up"></div>
    <div id="aviso" class="hidden"></div>
    <div id="tabela" class="table-scroll animate-fade-in-up"></div>
    <div id="vazio" class="hidden animate-fade-in-up"></div>
  </div></div>`;

test('ordenar: o atraso vem da ORDEM dos blocos (0,2 s, 0,3 s…), e o cabeçalho fica de fora', () => {
  const { documento, modulo, Cascata } = montar(MODULO_DE_LISTA);
  Cascata.ordenar(modulo, 'clientes');
  assert.strictEqual(documento.getElementById('filtros').style.animationDelay, '0.2s');
  // Um aviso escondido entre os dois não empurra mais o atraso da tabela.
  assert.strictEqual(documento.getElementById('tabela').style.animationDelay, '0.3s');
  assert.strictEqual(documento.getElementById('vazio').style.animationDelay, '0.4s');
  assert.strictEqual(modulo.querySelector('.module-introduction-row').style.animationDelay || '', '', 'o cabeçalho não anima');
});

test('ordenar: o atraso para em 0,6 s, e Financeiro/Contabilidade/Dashboard/Relatórios ficam como são', () => {
  const blocos = Array.from({ length: 9 }, (_, i) => `<div id="b${i}" class="animate-fade-in-up"></div>`).join('');
  const { documento, modulo, Cascata } = montar(`<div class="modulo-container">${blocos}</div>`);
  Cascata.ordenar(modulo, 'pedidos');
  assert.strictEqual(documento.getElementById('b8').style.animationDelay, '0.6s');

  for (const pagina of ['financeiro', 'contabilidade', 'dashboard', 'relatorios']) {
    const amb = montar(MODULO_DE_LISTA);
    amb.Cascata.ordenar(amb.modulo, pagina);
    assert.strictEqual(amb.documento.getElementById('tabela').style.animationDelay || '', '', `${pagina} mexido`);
  }
});

test('concluir: depois da entrada os blocos ficam parados (entrada-feita); cascata própria não é tocada', async () => {
  const { documento, modulo, Cascata } = montar(MODULO_DE_LISTA);
  Cascata.concluir(modulo, 'clientes', 20);
  assert.ok(!documento.getElementById('tabela').classList.contains('entrada-feita'), 'marcou antes do fim da entrada');
  await new Promise(r => setTimeout(r, 40));
  for (const id of ['filtros', 'tabela', 'vazio']) {
    assert.ok(documento.getElementById(id).classList.contains('entrada-feita'), `${id} sem a marca`);
  }
  const outro = montar(MODULO_DE_LISTA);
  assert.strictEqual(outro.Cascata.concluir(outro.modulo, 'dashboard', 0), null);
  assert.strictEqual(Cascata.FIM_DA_ENTRADA_MS, 1600);
});

test('nenhum módulo põe opacity/transform inline nos blocos da entrada (era o que anulava a animação)', () => {
  const pasta = path.join(SRC, 'js');
  const culpados = fs.readdirSync(pasta).filter(n => n.endsWith('.js')).filter(nome => {
    const js = fs.readFileSync(path.join(pasta, nome), 'utf8');
    return /querySelectorAll\(['"]\.animate-fade-in-up['"]\)[\s\S]{0,200}?style\.(opacity|transform)\s*=/.test(js);
  });
  assert.deepStrictEqual(culpados, [], `voltou o trecho que anula a entrada: ${culpados.join(', ')}`);
});

test('menu: ordena na montagem, conclui depois de revelar; o utilitário vem antes do menu.js', () => {
  const menu = ler('js/menu.js');
  const corpo = menu.slice(menu.indexOf('async function loadPage('), menu.indexOf('window.loadPage = loadPage;'));
  assert.match(corpo, /\n\s*window\.EntradaCascata\?\.ordenar\(module, page\);/);
  assert.ok(corpo.indexOf('window.EntradaCascata?.ordenar(module, page);') < corpo.indexOf('content.replaceChildren(module'),
    'os atrasos têm de estar postos antes de o módulo entrar na tela');
  const revela = corpo.indexOf("content.classList.remove('is-module-loading');");
  const conclui = corpo.indexOf('window.EntradaCascata?.concluir(module, page);');
  assert.ok(revela > 0 && conclui > revela, 'concluir tem de vir depois de a máscara sair');

  const html = ler('html/menu.html');
  const util = html.indexOf('<script src="../js/utils/entrada-cascata.js"></script>');
  assert.ok(util > 0 && util < html.indexOf('<script src="../js/menu.js"></script>'));
});

test('CSS: bloco parado no estado final, cabeçalho no lugar, e visível para quem pede menos movimento', () => {
  const css = ler('css/menu.css');
  assert.match(css, /\.animate-fade-in-up\.entrada-feita \{\s*animation: none;\s*opacity: 1;\s*transform: translateY\(0\);\s*\}/);
  assert.match(css, /\.module-introduction-row\.animate-fade-in-up \{\s*opacity: 1;\s*animation: none;\s*transform: translateY\(0\);\s*\}/,
    'o cabeçalho ficava 20 px abaixo até o fim da entrada');
  const reduzido = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n    .animate-fade-in-up,'));
  assert.match(reduzido.slice(0, 900), /\.animate-fade-in-up \{\s*opacity: 1;\s*\}/, 'sem animação o bloco ficava invisível');
});

test('voltar a um módulo recarrega a tela de verdade: a foto da última visita saiu (decisão do dono, 07/10/2026)', () => {
  // "A foto ao reentrar dá como se fosse uma travada, uma piscada" — o dono
  // prefere a recarga normal (máscara, spinner de 1 s e a entrada em cascata).
  const menu = ler('js/menu.js');
  assert.doesNotMatch(menu, /FotoDoModulo|fotoDaSaida|veuDaFoto|modulo-volta-instantanea/);
  assert.ok(!fs.existsSync(path.join(SRC, 'js', 'utils', 'foto-do-modulo.js')));
  assert.doesNotMatch(ler('html/menu.html'), /foto-do-modulo\.js/);
  assert.doesNotMatch(ler('css/menu.css'), /module-snapshot|modulo-volta-instantanea/);
  const raiz = path.join(SRC, '..');
  assert.doesNotMatch(fs.readFileSync(path.join(raiz, 'main.js'), 'utf8'), /modulo:fotografar|modulo:foto/);
  assert.doesNotMatch(fs.readFileSync(path.join(raiz, 'preload.js'), 'utf8'), /fotografarArea|lerFotoDaArea/);
});

test('todo módulo que não rola e tem tabela com rolagem própria está na lista do scroll.css (Contatos faltava)', () => {
  const menu = ler('js/menu.js');
  const lista = menu.slice(menu.indexOf('const MODULES_WITHOUT_SCROLL = new Set(['), menu.indexOf(']);', menu.indexOf('const MODULES_WITHOUT_SCROLL')));
  const modulos = [...lista.matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
  assert.ok(modulos.includes('contatos'));
  const scroll = ler('styles/scroll.css');
  const faltando = modulos.filter(m => {
    const html = path.join(SRC, 'html', `${m}.html`);
    if (!fs.existsSync(html) || !/class="[^"]*\btable-scroll\b/.test(fs.readFileSync(html, 'utf8'))) return false;
    return !scroll.includes(`body[data-current-module="${m}"] #content.no-scroll .table-scroll`);
  });
  assert.deepStrictEqual(faltando, [], `tabela sem rolagem em: ${faltando.join(', ')}`);
});

test('Contatos: Filtrar e Limpar não quebram linha; quem cede é o bloco das etiquetas', () => {
  const css = ler('css/contatos.css');
  assert.match(css, /\.filter-bar > #bt-actions \{\s*flex-shrink: 0;\s*flex-wrap: nowrap;\s*\}/);
  assert.match(css, /\.filter-bar > \.contatos-totais \{\s*flex: 0 1 auto;\s*min-width: 0;\s*\}/);
  assert.match(ler('html/contatos.html'), /<div class="contatos-totais flex flex-col">\s*<label class="ctl-rotulo text-white">Totais por Tipo<\/label>\s*<div id="totaisBadges" class="tags-uma-linha">/);
});
