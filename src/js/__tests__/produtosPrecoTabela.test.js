/**
 * A coluna e o filtro de preço do módulo de Produtos (src/js/produtos.js).
 *
 * A peça carrega DOIS preços e eles não são a mesma coisa:
 *
 *   preco_venda  → CALCULADO. Se move sozinho quando um insumo encarece.
 *   preco_tabela → PRATICADO. Só muda quando alguém marca "Atualizar Tabela
 *                  Fixa" ao salvar. É este que vai para o cliente.
 *
 * A tela mostrava e filtrava pelo primeiro. O erro era do tipo que não parece
 * erro: os dois números vivem na mesma ordem de grandeza, então uma busca por
 * "entre 2.000 e 2.100" devolvia uma lista plausível e errada.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MODULO = path.join(__dirname, '..', 'produtos.js');

/**
 * `produtos.js` roda no navegador e não exporta nada. Recortamos a função pelo
 * texto — se ela for renomeada ou movida, este teste falha em vez de passar
 * testando o nada.
 */
function carregarFuncao(nome, ate) {
  const fonte = fs.readFileSync(MODULO, 'utf8');
  const inicio = fonte.indexOf(`function ${nome}`);
  const fim = fonte.indexOf(`function ${ate}`);
  assert.ok(inicio !== -1 && fim > inicio,
    `${nome} não foi encontrada em src/js/produtos.js`);

  // O `window` do recorte: a função consulta o mesmo utilitário que o
  // orçamento usa para decidir se a peça pode ser vendida.
  const precoTabela = fs.readFileSync(
    path.join(__dirname, '..', '..', 'utils', 'precoTabela.js'), 'utf8');
  const janela = {};
  // eslint-disable-next-line no-new-func
  new Function('window', precoTabela)(janela);

  // eslint-disable-next-line no-new-func
  return new Function('window', `${fonte.slice(inicio, fim)} return ${nome};`)(janela);
}

const naFaixaDePreco = carregarFuncao('naFaixaDePreco', 'valorPrecoDaLinha');

const peca = (extra = {}) => ({
  id: 1, codigo: 'BACR 3060 MNM', nome: 'Base Ao Cubo Retangular - G',
  preco_venda: 900, preco_tabela: 2064.29, ...extra
});

// ---------------------------------------------------------------------------
// A faixa é sobre o preço praticado
// ---------------------------------------------------------------------------

test('a faixa mede o preço PRATICADO, não o calculado', () => {
  const p = peca();

  // 2.064,29 é o praticado; 900 é o custo apurado. Procurar "entre 2.000 e
  // 2.100" tem de achar esta peça.
  assert.strictEqual(naFaixaDePreco(p, 2000, 2100), true);

  // E procurar a faixa do CALCULADO não pode achá-la: quem digitou 900 estava
  // procurando uma peça que custa 900 para o cliente, e esta custa 2.064,29.
  assert.strictEqual(naFaixaDePreco(p, 800, 1000), false);
});

test('só o mínimo, só o máximo, ou os dois', () => {
  const p = peca({ preco_tabela: 500 });

  assert.strictEqual(naFaixaDePreco(p, 400, NaN), true);
  assert.strictEqual(naFaixaDePreco(p, 600, NaN), false);
  assert.strictEqual(naFaixaDePreco(p, NaN, 600), true);
  assert.strictEqual(naFaixaDePreco(p, NaN, 400), false);
  assert.strictEqual(naFaixaDePreco(p, 400, 600), true);
});

test('as bordas entram na faixa', () => {
  const p = peca({ preco_tabela: 500 });

  // Quem digita 500 espera ver a peça de 500. Excluir a borda faz o filtro
  // "quase" funcionar, que é o pior jeito de não funcionar.
  assert.strictEqual(naFaixaDePreco(p, 500, 500), true);
});

test('peça sem preço praticado fica fora de qualquer faixa', () => {
  const semTabela = peca({ preco_tabela: null, preco_venda: 2064.29 });

  // Ela não pode ser vendida — o orçamento a recusa. Deixá-la aparecer numa
  // busca por faixa de preço prometeria uma peça que não se vende, e ainda por
  // cima pelo número errado, que é o custo.
  assert.strictEqual(naFaixaDePreco(semTabela, 2000, 2100), false);
  assert.strictEqual(naFaixaDePreco(semTabela, NaN, 5000), false);
});

test('sem faixa pedida, a peça sem preço aparece', () => {
  const semTabela = peca({ preco_tabela: null });

  // O catálogo mostra tudo, e é dele que se descobre o que ainda falta
  // cadastrar. Esconder as peças sem preço quando ninguém filtrou seria
  // esconder justamente o trabalho pendente.
  assert.strictEqual(naFaixaDePreco(semTabela, NaN, NaN), true);
  assert.strictEqual(naFaixaDePreco(peca(), NaN, NaN), true);
});

test('preço praticado zero é um preço, e entra na conta', () => {
  const gratis = peca({ preco_tabela: 0 });

  // Zero é diferente de ausência: alguém escreveu zero na tabela fixa. A tela
  // mostra e o filtro considera; julgar se isso está certo é de quem cadastra.
  assert.strictEqual(naFaixaDePreco(gratis, NaN, 100), true);
  assert.strictEqual(naFaixaDePreco(gratis, 1, NaN), false);
});

// ---------------------------------------------------------------------------
// A coluna que a tela abre mostrando
// ---------------------------------------------------------------------------

test('a coluna de preço nasce no praticado', () => {
  const fonte = fs.readFileSync(MODULO, 'utf8');
  const inicial = /let modoPreco = '(\w+)'/.exec(fonte);
  assert.ok(inicial, 'o modo inicial da coluna saiu do arquivo');

  // É este o número que a peça "vale" para quem olha o catálogo: é o que vai
  // no orçamento e é o que o cliente paga. Abrir a tela no calculado fazia
  // todo mundo ler um custo achando que era preço de venda.
  assert.strictEqual(inicial[1], 'tabela');
});

test('o filtro e a coluna leem o mesmo campo', () => {
  const fonte = fs.readFileSync(MODULO, 'utf8');

  // Uma segunda leitura de `preco_tabela` no filtro viraria uma segunda regra
  // sobre o mesmo campo, e as duas divergiriam na primeira mudança.
  assert.match(fonte, /naFaixaDePreco[\s\S]{0,900}PrecoTabela\.precoDeVenda/);

  // E nada de filtrar por `preco_venda` de novo.
  const faixa = /function naFaixaDePreco[\s\S]*?\n}/.exec(fonte);
  assert.doesNotMatch(faixa[0], /preco_venda/);
});
