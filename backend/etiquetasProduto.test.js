/**
 * Planilha "Etiqueta Produto" do Visualizar pedido (backend/etiquetasProduto.js).
 */
const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const {
  dividirNome,
  prontasDoEstoque,
  unidadesDoItem,
  linhasDasEtiquetas,
  nomeDoArquivo,
  gerarPlanilha
} = require('./etiquetasProduto');

test('o nome perde as medidas e a variação é o último trecho', () => {
  assert.deepStrictEqual(
    dividirNome('Platter Pietra - M (25 x 50 x 3h) - Quartzito Nacarado'),
    { nome: 'Platter Pietra - M', variacao: 'Quartzito Nacarado' }
  );
  // O "×" que o cadastro também usa, e travessão no lugar do hífen.
  assert.deepStrictEqual(
    dividirNome('Platter Pietra – P (15 × 30 × 3h) – Quartzito Branco'),
    { nome: 'Platter Pietra - P', variacao: 'Quartzito Branco' }
  );
});

test('hífen dentro de palavra não divide o nome', () => {
  assert.deepStrictEqual(
    dividirNome('Porta-joias - G (20 x 10) - Mármore Carrara'),
    { nome: 'Porta-joias - G', variacao: 'Mármore Carrara' }
  );
});

test('nomes fora do padrão não quebram', () => {
  assert.deepStrictEqual(dividirNome('Bandeja (30 x 20) - Ônix'), { nome: 'Bandeja', variacao: 'Ônix' });
  assert.deepStrictEqual(dividirNome('Peça avulsa (10 x 10)'), { nome: 'Peça avulsa', variacao: '' });
  assert.deepStrictEqual(dividirNome(''), { nome: '', variacao: '' });
  assert.deepStrictEqual(dividirNome(null), { nome: '', variacao: '' });
  // Mais de três trechos: tudo menos o último é o nome.
  assert.deepStrictEqual(
    dividirNome('Bandeja - Oval - G (40 x 25) - Mármore Branco'),
    { nome: 'Bandeja - Oval - G', variacao: 'Mármore Branco' }
  );
});

test('uma linha por unidade, na ordem dos itens do pedido', () => {
  const linhas = linhasDasEtiquetas([
    { id: 12, nome: 'Platter Pietra - P (15 x 30 x 3h) - Quartzito Branco', quantidade: '2.00' },
    { id: 11, nome: 'Platter Pietra - M (25 x 50 x 3h) - Quartzito Nacarado', quantidade: 3 },
    { id: 13, nome: 'Sem quantidade - Ônix', quantidade: 0 }
  ]);
  assert.deepStrictEqual(linhas.map(l => `${l.nome} | ${l.variacao}`), [
    'Platter Pietra - M | Quartzito Nacarado',
    'Platter Pietra - M | Quartzito Nacarado',
    'Platter Pietra - M | Quartzito Nacarado',
    'Platter Pietra - P | Quartzito Branco',
    'Platter Pietra - P | Quartzito Branco'
  ]);
  assert.strictEqual(linhasDasEtiquetas([{ id: 1, nome: 'X - Y', quantidade: 10 }]).length, 10);
});

test('quantidade inválida ou negativa não gera etiqueta', () => {
  for (const quantidade of [null, undefined, 'abc', -2, 0]) {
    assert.strictEqual(unidadesDoItem({ quantidade }), 0, String(quantidade));
  }
  assert.strictEqual(unidadesDoItem({ quantidade: '1,00'.replace(',', '.') }), 1);
});

test('peça que saiu pronta do estoque não gera etiqueta (dono, 08/10/2026)', () => {
  const linhas = linhasDasEtiquetas([
    // 3 pedidas, 2 prontas do estoque: só 1 etiqueta.
    { id: 1, nome: 'Platter Pietra - M (25 x 50 x 3h) - Quartzito Nacarado', quantidade: 3, qtd_usar_pronta: 2, qtd_a_produzir: 1 },
    // Toda do estoque: nenhuma.
    { id: 2, nome: 'Bandeja (30 x 20) - Ônix', quantidade: '2.00', qtd_usar_pronta: '2.00', qtd_a_produzir: 0 },
    // Pela metade do estoque conta como produção (qtd_usar_pronta = 0): etiqueta.
    { id: 3, nome: 'Porta-joias - G (20 x 10) - Mármore Carrara', quantidade: 1, qtd_usar_pronta: 0, qtd_a_produzir: 1 }
  ]);
  assert.deepStrictEqual(linhas.map(l => l.nome), ['Platter Pietra - M', 'Porta-joias - G']);
  // A coluna pode guardar o estoque que havia (maior que o pedido): teto na quantidade.
  assert.strictEqual(prontasDoEstoque({ quantidade: 2, qtd_usar_pronta: 3 }), 2);
  assert.strictEqual(unidadesDoItem({ quantidade: 2, qtd_usar_pronta: 3 }), 0);
  assert.strictEqual(unidadesDoItem({ quantidade: 5, qtd_usar_pronta: null }), 5);
});

test('o arquivo leva o número do pedido e o cliente separados por "_"', () => {
  assert.strictEqual(nomeDoArquivo('PED115', 'Jackie'), 'PED115_Jackie.xlsx');
  assert.strictEqual(nomeDoArquivo('PED104', 'DS Contemporânea'), 'PED104_DS Contemporânea.xlsx');
  // O que o Windows recusa em nome de arquivo sai.
  assert.strictEqual(nomeDoArquivo('PED9', 'Casa/Lar: "Bela"'), 'PED9_Casa Lar Bela.xlsx');
  assert.strictEqual(nomeDoArquivo('PED9', ''), 'PED9.xlsx');
});

test('a planilha tem o cabeçalho Nome e Variação e uma linha por etiqueta', async () => {
  const linhas = linhasDasEtiquetas([
    { id: 1, nome: 'Platter Pietra - M (25 x 50 x 3h) - Quartzito Nacarado', quantidade: 2 }
  ]);
  const bytes = await gerarPlanilha(linhas);
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0);

  const livro = new ExcelJS.Workbook();
  await livro.xlsx.load(bytes);
  const aba = livro.worksheets[0];
  const valores = [];
  aba.eachRow(linha => valores.push([linha.getCell(1).value, linha.getCell(2).value]));
  assert.deepStrictEqual(valores, [
    ['Nome', 'Variação'],
    ['Platter Pietra - M', 'Quartzito Nacarado'],
    ['Platter Pietra - M', 'Quartzito Nacarado']
  ]);
});
