/**
 * A mesma peça em duas linhas (pedido do dono, 14/10/2026 — o PED121 nasceu
 * com duas "Caixa Rio" iguais vindas da IA, e "deveria ter sido somado").
 *
 *   - a IA soma as linhas da mesma peça ao montar o orçamento
 *     (iaPreenchimento.somarLinhasIguais, usada pelo formulário e pela
 *     aplicação direta);
 *   - na conversão, a decisão de estoque da peça é REPARTIDA entre as linhas
 *     (orcamentosController.repartirDecisao) — antes valia inteira em cada
 *     uma e o estoque saía em dobro. O lado dos lotes pela metade está em
 *     conversaoAplicar.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { somarLinhasIguais } = require('./iaPreenchimento');
const { repartirDecisao } = require('./orcamentosController');

test('a IA soma as linhas da mesma peça (mesmo preço do cadastro), na ordem da primeira', () => {
  const linhas = somarLinhasIguais([
    { produto_id: 10, nome: 'Caixa Rio - P', quantidade: 2, valor_unitario: 918.69, valor_total: 1837.38 },
    { produto_id: 20, nome: 'Bandeja La Vie', quantidade: 1, valor_unitario: 1860.39, valor_total: 1860.39 },
    { produto_id: 10, nome: 'Caixa Rio - P', quantidade: 2, valor_unitario: 918.69, valor_total: 1837.38 }
  ]);
  assert.equal(linhas.length, 2);
  assert.deepEqual(linhas.map(l => [l.produto_id, l.quantidade]), [[10, 4], [20, 1]]);
  assert.equal(linhas[0].valor_total, 918.69 * 4);
  assert.deepEqual(somarLinhasIguais([]), []);
  // Preço diferente (não acontece pela IA, que usa o do cadastro) não é a mesma linha.
  assert.equal(somarLinhasIguais([{ produto_id: 1, quantidade: 1, valor_unitario: 10 }, { produto_id: 1, quantidade: 1, valor_unitario: 12 }]).length, 2);
});

test('as duas rotas da IA usam a soma (formulário e aplicação direta)', () => {
  const fonte = arquivo => fs.readFileSync(path.join(__dirname, arquivo), 'utf8');
  assert.match(fonte('iaPreenchimento.js'), /return \{ itens: somarLinhasIguais\(itens\), semCadastro \}/);
  assert.match(fonte('iaAplicacao.js'), /preenchimento\.somarLinhasIguais\(itens\)/);
});

test('conversão: a decisão da peça é repartida entre as linhas, nunca inteira em cada uma', () => {
  const resto = new Map();
  const decisao = { produto_id: 10, qtd_usar_pronta: 3, qtd_produzir_parcial: 1, parciais: [{ ultimo_insumo_id: 303, ordem: 3, quantidade: 1 }], forcarProduzirDoZero: false };
  const a = repartirDecisao(decisao, { produto_id: 10, quantidade: 2 }, resto);
  const b = repartirDecisao(decisao, { produto_id: 10, quantidade: 2 }, resto);
  assert.deepEqual([a.qtd_usar_pronta, a.qtd_produzir_parcial, a.parciais.map(p => p.quantidade)], [2, 0, []], 'a primeira leva 2 prontas');
  assert.deepEqual([b.qtd_usar_pronta, b.qtd_produzir_parcial, b.parciais.map(p => p.quantidade)], [1, 1, [1]], 'a segunda, a pronta que sobrou e a pela metade');
  assert.equal(a.qtd_usar_pronta + b.qtd_usar_pronta, 3, 'no total, as 3 prontas da decisão — e não 4 (2 + 2)');
  // Uma linha só: igual a antes.
  const so = repartirDecisao({ qtd_usar_pronta: 5 }, { produto_id: 7, quantidade: 2 }, new Map());
  assert.equal(so.qtd_usar_pronta, 2);
});
