/**
 * Um cabeçalho só para as tabelas de todos os modais.
 *
 * ---------------------------------------------------------------------------
 * O QUE HAVIA
 *
 * QUATRO cabeçalhos diferentes, espalhados por 22 modais:
 *
 *   bg-gray-50 + text-gray-500      Produtos — o padrão, o do print
 *   bg-gray-50 + font-semibold      Orçamentos e Pedidos: mesma faixa, outra fonte
 *   glass-surface + text-gray-300   Clientes, Laminação, Prospecções
 *   sem fundo + text-gray-300       Conversão, Cancelar, Converter em lote, IA
 *
 * Nenhum era decisão de ninguém: cada modal novo copiou o vizinho mais
 * próximo. A mesma tabela mudava de cara conforme a porta por onde se entrava.
 *
 * ---------------------------------------------------------------------------
 * POR QUE OS TESTES OLHAM PARA A AUSÊNCIA DAS CLASSES
 *
 * A cor agora é de UMA folha. Enquanto as classes antigas continuassem no
 * HTML, elas seriam inertes mas visíveis: quem fosse ajustar uma cor mexeria
 * no `text-gray-300` do arquivo, não veria efeito nenhum, e ou desistiria ou
 * subiria a especificidade — trazendo a divergência de volta por uma porta só.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', '..', '..');
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const folha = () => ler('src', 'styles', 'tabelas-modais.css');

/** Todo modal do programa que tem tabela. */
function modaisComTabela() {
  const base = path.join(raiz, 'src', 'html', 'modals');
  const achados = [];
  for (const pasta of fs.readdirSync(base)) {
    const dir = path.join(base, pasta);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const arquivo of fs.readdirSync(dir)) {
      if (!arquivo.endsWith('.html')) continue;
      const texto = fs.readFileSync(path.join(dir, arquivo), 'utf8');
      if (texto.includes('<thead')) achados.push({ nome: `${pasta}/${arquivo}`, texto });
    }
  }
  return achados;
}

/** Só o que está dentro dos `<thead>` — o resto do modal não é assunto aqui. */
const cabecalhos = texto => (texto.match(/<thead[\s\S]*?<\/thead>/g) || []).join('\n');

test('há modal com tabela para conferir', () => {
  // Se a varredura parar de achar arquivos, todos os testes abaixo passam sem
  // olhar para nada.
  assert.ok(modaisComTabela().length >= 20,
    'a varredura precisa alcançar os modais — achou de menos');
});

// ---------------------------------------------------------------------------
// Nenhum cabeçalho define a própria cor
// ---------------------------------------------------------------------------

const CORES_PROIBIDAS = [
  'glass-surface', 'bg-gray-50', 'bg-surface/60', 'bg-white/5',
  'text-gray-300', 'text-gray-500', 'border-gray-200', 'font-semibold'
];

test('nenhum <thead> de modal carrega cor própria', () => {
  for (const modal of modaisComTabela()) {
    const cabecalho = cabecalhos(modal.texto);
    for (const classe of CORES_PROIBIDAS) {
      assert.ok(!new RegExp(`\\b${classe.replace('/', '\\/')}\\b`).test(cabecalho),
        `${modal.nome}: o cabeçalho voltou a definir a própria cor ("${classe}"). `
        + 'A cor é de src/styles/tabelas-modais.css, para todos ao mesmo tempo.');
    }
  }
});

test('o que é comportamento continua no HTML', () => {
  // `sticky top-0` não é cor: é o cabeçalho acompanhando a rolagem, e algumas
  // tabelas dependem disso. A limpeza não podia levá-lo junto.
  const produtos = ler('src', 'html', 'modals', 'produtos', 'visualizar.html');
  assert.match(produtos, /<thead class="sticky top-0">/,
    'Produtos perdeu o cabeçalho grudento junto com as cores');
});

// ---------------------------------------------------------------------------
// A folha diz o que o print mostra
// ---------------------------------------------------------------------------

test('o padrão é o de Produtos: faixa clara, título em cinza médio', () => {
  const css = folha();

  // Os valores são os que Produtos sempre teve — `bg-gray-50` e
  // `text-gray-500` do Tailwind, agora escritos uma vez só.
  assert.match(css, /background:\s*#f9fafb/, 'a faixa clara (bg-gray-50)');
  assert.match(css, /color:\s*#6b7280/, 'o título em cinza médio (text-gray-500)');
  assert.match(css, /font-weight:\s*500/, 'o peso (font-medium), não semibold');
  assert.match(css, /text-transform:\s*uppercase/);
  assert.match(css, /letter-spacing:\s*0\.05em/, 'o espaçamento (tracking-wider)');
  assert.match(css, /border-bottom:\s*1px solid #e5e7eb/, 'a divisória (border-gray-200)');
});

test('a folha não fixa o tamanho da letra', () => {
  // Ele vem de `.table-scroll th`, que o calcula pela largura da tela. Fixá-lo
  // aqui tiraria essa adaptação de todas as tabelas de uma vez.
  assert.doesNotMatch(folha(), /font-size:/,
    'o tamanho da letra é de scroll.css, não desta folha');
});

test('a regra alcança todo modal, inclusive tabela montada em JS', () => {
  const css = folha();

  // `[id$="Overlay"]` é como o programa já identifica um modal (ver
  // src/js/utils/popover.js). Como a regra é por seletor e não por classe no
  // HTML, ela vale também para os `<thead>` criados em JavaScript.
  // Todo seletor precisa do `table` no meio: ele é o que levanta a
  // especificidade acima das folhas de módulo. Um seletor sem ele empata com
  // `.ia-grade-revisao thead th` e perde para quem carregar depois — e a
  // divergência volta por uma porta só.
  // Junta com vírgula, e não com nada: colados, o último seletor de uma regra
  // e o primeiro da seguinte viram um só, e um seletor errado no meio da
  // emenda passa sem ser visto.
  const seletores = (css.match(/^\[id[^{]*\{/gm) || [])
    .map(bloco => bloco.replace(/\{$/, ''))
    .join(',')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  assert.ok(seletores.length >= 3, 'não achei os seletores da folha');
  for (const seletor of seletores) {
    assert.match(seletor, /^\[id\$="Overlay"\] table thead/,
      `seletor sem "table" no meio, perde para a folha de módulo: ${seletor}`);
  }
});

test('todo modal com tabela mora num container que a regra alcança', () => {
  for (const modal of modaisComTabela()) {
    const id = modal.texto.match(/<div[^>]*id="([^"]+)"/);
    assert.ok(id, `${modal.nome}: não achei o id do container`);
    assert.match(id[1], /Overlay$/,
      `${modal.nome}: o container é "${id[1]}" e o seletor da folha procura `
      + '`[id$="Overlay"]` — este modal ficaria de fora do padrão');
  }
});

// ---------------------------------------------------------------------------
// Ninguém mais pinta um cabeçalho de modal
// ---------------------------------------------------------------------------

test('nenhuma folha de modal tem regra de cabeçalho própria', () => {
  // A cor e a grudagem são as duas de `tabelas-modais.css` agora. Esta
  // conferência era escrita com um `continue` que a fazia passar sem olhar
  // para nada assim que a regra saísse do arquivo — o tipo de teste que
  // sobrevive à própria utilidade.
  const conversao = ler('src', 'styles', 'conversao-orcamento.css');

  assert.doesNotMatch(conversao, /thead[^{}]*\{[^}]*background/,
    'a conversão voltou a pintar o próprio cabeçalho');
  assert.doesNotMatch(conversao, /thead[^{}]*\{[^}]*position:\s*sticky/,
    'a conversão voltou a grudar o próprio cabeçalho');

  // E ela continua existindo: o que é dela — as cores das linhas de peça, o
  // aviso de pendências — está lá.
  assert.match(conversao, /#converterOrcamentoOverlay/,
    'a folha da conversão sumiu inteira');
});

test('a grade da IA também segue o padrão', () => {
  const ia = ler('src', 'css', 'ia.css');
  const regra = ia.match(/\.ia-grade-revisao thead th \{[^}]*\}/);
  assert.ok(regra, 'não achei a regra do cabeçalho da grade da IA');

  assert.doesNotMatch(regra[0], /background:/,
    'a grade da IA voltou a ter um cabeçalho de cor própria');
  assert.match(regra[0], /position:\s*sticky/,
    'mas continua grudenta — isso é comportamento, não cor');
});

test('a folha é carregada sempre, e antes das específicas', () => {
  const menu = ler('src', 'html', 'menu.html');

  assert.match(menu, /styles\/tabelas-modais\.css/,
    'só uma folha de módulo fica carregada por vez; o padrão dos modais tem '
    + 'de vir do menu.html para valer em todos');

  // Antes das folhas que ajustam detalhes de um modal só: é a ordem que deixa
  // a conversão acrescentar a grudagem sem ter de repetir a cor.
  assert.ok(
    menu.indexOf('tabelas-modais.css') < menu.indexOf('conversao-orcamento.css'),
    'a folha comum precisa vir antes da folha da conversão'
  );
});

// ---------------------------------------------------------------------------
// O cabeçalho acompanha a rolagem
//
// Metade dos modais grudava o cabeçalho e a outra metade não, sem critério —
// quem escreveu cada um decidiu sozinho. É o cabeçalho que responde "que coluna
// é esta?", e é a primeira coisa que se perde numa lista longa.
// ---------------------------------------------------------------------------

test('toda tabela de modal tem o primeiro cabeçalho grudento', () => {
  const css = folha();
  const regra = css.match(/\[id\$="Overlay"\] table thead tr:first-child th \{[^}]+\}/);
  assert.ok(regra, 'falta a regra de cabeçalho grudento');

  assert.match(regra[0], /position:\s*sticky/);
  assert.match(regra[0], /top:\s*0/);
});

test('só o PRIMEIRO cabeçalho gruda', () => {
  const css = folha();

  // Numa tabela com duas linhas de cabeçalho, a segunda grudaria no mesmo
  // topo, uma por cima da outra.
  assert.match(css, /thead tr:first-child th/);
  assert.doesNotMatch(css, /\[id\$="Overlay"\] table thead th \{[^}]*position:\s*sticky/,
    'grudar todo <th> do cabeçalho empilharia as linhas de cabeçalho');
});

test('grudar só é possível porque o fundo é opaco', () => {
  const css = folha();

  // Grudar sem fundo opaco é PIOR que não grudar: as linhas passam por baixo e
  // os dois textos se misturam. As duas regras vivem na mesma folha de
  // propósito — separá-las deixaria uma sobreviver sem a outra.
  const fundo = css.indexOf('background: #f9fafb');
  const gruda = css.indexOf('position: sticky');
  assert.ok(fundo >= 0 && gruda > fundo,
    'o fundo opaco precisa vir antes, e na mesma folha, do que gruda');
});

test('a grudagem não está escrita duas vezes', () => {
  // Ela estava só na folha da conversão, e ter sozinha era o problema.
  const conversao = ler('src', 'styles', 'conversao-orcamento.css');
  assert.doesNotMatch(conversao, /position:\s*sticky/);

  const ia = ler('src', 'css', 'ia.css');
  const grade = ia.match(/\.ia-grade-revisao thead th \{[^}]+\}/);
  assert.ok(grade, 'a grade da IA tem regra própria');
  assert.match(grade[0], /position:\s*sticky/,
    'a grade da IA não vive dentro de `[id$="Overlay"] table` com a mesma '
    + 'estrutura, então a dela continua sendo dela');
});

test('os módulos já grudam o cabeçalho pelo HTML', () => {
  // Levantamento: todos declaram `sticky top-0` e `bg-gray-50` no `<thead>`.
  // Este teste existe para que uma limpeza de classes não leve isso junto —
  // foi exatamente o que quase aconteceu com as cores dos modais.
  const modulos = ['clientes', 'contatos', 'materia-prima', 'orcamentos',
    'pedidos', 'produtos', 'prospeccoes', 'usuarios',
    'laminacao-clientes', 'laminacao-servicos'];

  for (const modulo of modulos) {
    const html = ler('src', 'html', `${modulo}.html`);
    const thead = html.match(/<thead([^>]*)>/);
    assert.ok(thead, `${modulo}: não achei o <thead>`);
    assert.match(thead[1], /sticky/, `${modulo}: o cabeçalho parou de grudar`);
    assert.match(thead[1], /bg-gray-50/,
      `${modulo}: sem fundo opaco, grudar deixa as linhas passarem por baixo`);
  }
});
