/**
 * A tabela de itens dos modais de produto segue o tema do programa.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTAVA ERRADO
 *
 * As três tabelas — inserir, editar e visualizar — nasceram com as classes de
 * tema CLARO do Tailwind: `bg-gray-50` no cabeçalho e nas faixas de processo,
 * `text-gray-500` no texto delas, `border-gray-200` nas divisórias. Num
 * programa de fundo vinho, isso é uma faixa quase branca atravessando o modal,
 * com o título das colunas em cinza médio — o pedaço mais claro da tela
 * inteira, bem no meio do que é escuro.
 *
 * As LINHAS de dados nunca tiveram o problema: já vinham com `text-white`. Era
 * só a moldura.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É UM TESTE E NÃO "foi só trocar a cor"
 *
 * As três telas mostram a MESMA tabela e sempre divergiram sozinhas — a
 * divisória das linhas já estava em dois valores diferentes entre elas. Uma
 * classe clara que voltasse a qualquer uma das três reabriria exatamente o
 * mesmo defeito, numa porta só, que é a forma mais difícil de perceber.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', '..', '..');
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const folha = () => ler('src', 'styles', 'tabelas-produto.css');

const TELAS = [
  { nome: 'Inserir Produto', html: 'novo.html', js: 'produto-novo.js', overlay: 'novoProdutoOverlay' },
  { nome: 'Editar Produto', html: 'editar.html', js: 'produto-editar.js', overlay: 'editarProdutoOverlay' },
  { nome: 'Visualizar Produto', html: 'visualizar.html', js: 'produto-visualizar.js', overlay: 'visualizarProdutoOverlay' }
];

const lerHtml = t => ler('src', 'html', 'modals', 'produtos', t.html);
const lerJs = t => ler('src', 'js', 'modals', t.js);

// ---------------------------------------------------------------------------
// Nenhuma classe de tema claro sobrou
// ---------------------------------------------------------------------------

// `bg-white` fica de fora da lista: `hover:bg-white/10` é o realce ESCURO dos
// ícones de ação, e proibi-lo pegaria o certo junto com o errado.
const CLASSES_CLARAS = ['bg-gray-50', 'bg-gray-100', 'text-gray-500', 'border-gray-200', 'divide-gray-200'];

test('as três telas não têm classe de tema claro na tabela', () => {
  for (const tela of TELAS) {
    for (const classe of CLASSES_CLARAS) {
      assert.ok(!lerHtml(tela).includes(classe),
        `${tela.nome}: "${classe}" voltou ao HTML da tabela`);
    }
  }
});

test('a faixa de processo, montada em JS, também não', () => {
  for (const tela of TELAS) {
    const js = lerJs(tela);
    const faixa = js.slice(js.indexOf('process-row'), js.indexOf('process-row') + 400);
    assert.ok(faixa.length > 0, `${tela.nome}: não achei a faixa de processo`);

    for (const classe of CLASSES_CLARAS) {
      assert.ok(!faixa.includes(classe),
        `${tela.nome}: a faixa MARCENARIA/ACABAMENTO/MONTAGEM voltou a ser clara `
        + `("${classe}")`);
    }
  }
});

test('a faixa de processo continua marcada, para a folha alcançá-la', () => {
  for (const tela of TELAS) {
    // A cor saiu do JS e foi para a folha; o gancho que liga as duas é a
    // classe. Sem ela, a faixa fica sem cor nenhuma em vez de com a cor certa.
    assert.match(lerJs(tela), /process-row/,
      `${tela.nome}: a faixa perdeu a classe que a folha usa`);
  }
});

// ---------------------------------------------------------------------------
// As cores
// ---------------------------------------------------------------------------

test('o cabeçalho é opaco — ele é grudento e as linhas passam por baixo', () => {
  const css = folha();
  const regra = css.match(/thead th \{[^}]+\}/);
  assert.ok(regra, 'falta a regra do cabeçalho');

  assert.match(regra[0], /background:\s*#[0-9a-fA-F]{6}/,
    'fundo translúcido deixa o título da coluna e a peça se sobreporem');
  assert.match(regra[0], /color:\s*#d1d5db/,
    'o cinza claro é o mesmo dos outros modais com tabela do programa');
  assert.match(regra[0], /box-shadow:\s*inset 0 -1px 0/,
    'a tabela é border-collapse: collapse e o Chromium não leva a borda do '
    + '<tr> junto com o cabeçalho grudado — o separador tem de ser próprio');
});

test('as três telas recebem as mesmas regras', () => {
  const css = folha();

  // Escritas para uma tela só, elas voltariam a divergir na primeira mudança —
  // que é como a divisória das linhas já tinha ficado em dois valores.
  for (const tela of TELAS) {
    const quantas = (css.match(new RegExp('#' + tela.overlay, 'g')) || []).length;
    assert.equal(quantas, 4,
      `${tela.nome}: esperava as 4 regras (cabeçalho, faixa, divisória e a `
      + `faixa sem divisória de baixo), achei ${quantas}`);
  }
});

test('a divisória das linhas é a mesma nas três', () => {
  const css = folha();

  // Antes: `border-white/10` numa tela e `border-white/5` nas outras duas. A
  // mesma tabela mudava de contraste conforme a porta por onde se entrava.
  const regra = css.match(/tbody tr \{[^}]+\}/);
  assert.ok(regra, 'falta a regra da divisória das linhas');
  assert.match(regra[0], /border-bottom:\s*1px solid rgba\(255, 255, 255, 0\.1\)/);
});

test('a faixa de processo separa sem competir com as linhas', () => {
  const css = folha();
  const regra = css.match(/\.process-row > td \{[^}]+\}/);
  assert.ok(regra, 'falta a regra da faixa de processo');

  // Ela é um realce leve, não um bloco: no tom do cabeçalho ela viraria um
  // segundo cabeçalho no meio da tabela.
  assert.match(regra[0], /background:\s*rgba\(255, 255, 255, 0\.0\d\)/);
  assert.match(regra[0], /color:\s*#d1d5db/);
  assert.match(regra[0], /border-top:/,
    'a divisória da faixa é a de CIMA: ela abre uma seção');
});

// ---------------------------------------------------------------------------
// Onde a folha mora
// ---------------------------------------------------------------------------

test('a folha vale também quando o modal é aberto pela IA', () => {
  // Só uma folha de módulo fica carregada por vez (`menu.js` troca
  // `../css/{pagina}.css`), e o modal de INSERIR produto também é aberto pelo
  // módulo de IA, ao aplicar uma leitura. Em `produtos.css`, a correção valeria
  // numa porta e não na outra.
  const menu = ler('src', 'html', 'menu.html');
  assert.match(menu, /styles\/tabelas-produto\.css/,
    'a folha precisa ser carregada sempre, pelo menu.html');

  const ia = ler('src', 'js', 'modals', 'ia-detalhes.js');
  assert.match(ia, /modals\/produtos\/novo\.html/,
    'se a IA parou de abrir este modal, o motivo acima mudou — reveja o '
    + 'comentário da folha antes de mover as regras para produtos.css');
});

test('as regras não escapam para a tabela do módulo', () => {
  const css = folha();

  // O pedido foi explícito: só as tabelas dos modais. Um seletor solto pegaria
  // a listagem de Produtos junto.
  const seletores = css.match(/^[^@/\s][^{]*\{/gm) || [];
  assert.ok(seletores.length > 0, 'não achei seletor nenhum na folha');
  for (const seletor of seletores) {
    assert.match(seletor, /#(novo|editar|visualizar)ProdutoOverlay/,
      `seletor sem o modal na frente pegaria a tabela do módulo: ${seletor.trim()}`);
  }
});
