/**
 * Parcela mínima (backend/cobranca/parcelaMinima.js): só a parcela única e a
 * 1ª à vista ficam livres; a devolução junta as parcelas em aberto nas
 * primeiras; o abatimento não pode deixar o boleto abaixo do mínimo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('./parcelaMinima');

test('conferir: parcela única livre; a 1ª com prazo 0 livre; as outras ≥ mínimo (o igual vale)', () => {
  assert.equal(m.conferir({ valores: [500], prazos: [30], minimo: 1500 }).ok, true, 'uma parcela só: qualquer valor');
  assert.equal(m.conferir({ valores: [1500, 1500], prazos: [30, 60], minimo: 1500 }).ok, true, 'igual ao mínimo vale');
  assert.equal(m.conferir({ valores: [200, 1500], prazos: [0, 30], minimo: 1500 }).ok, true, 'entrada à vista menor');
  const primeira = m.conferir({ valores: [200, 1800], prazos: [30, 60], minimo: 1500 });
  assert.deepEqual([primeira.ok, primeira.indice], [false, 0]);
  assert.match(primeira.erro, /1ª parcela .* abaixo da parcela mínima de R\$\s1\.500,00\. Só a primeira parcela com prazo 0/);
  const segunda = m.conferir({ valores: [1000, 1499.99], prazos: [0, 30], minimo: 1500 });
  assert.deepEqual([segunda.ok, segunda.indice], [false, 1]);
  const pequeno = m.conferir({ valores: [500, 500], prazos: [30, 60], minimo: 1500 });
  assert.match(pequeno.erro, /O total \(R\$\s1\.000,00\) fica abaixo do mínimo: use uma parcela só\./);
  assert.equal(m.conferir({ valores: [10, 10, 10], prazos: [30, 60, 90], minimo: 0 }).ok, true, 'sem mínimo (SQL não rodou): nada muda');
});

test('quantas parcelas cabem: iguais pedem o mínimo em todas; diferentes deixam a entrada livre', () => {
  assert.equal(m.maximoDeParcelas({ total: 4500, minimo: 1500, iguais: true }), 3);
  assert.equal(m.maximoDeParcelas({ total: 4499.99, minimo: 1500, iguais: true }), 2);
  assert.equal(m.maximoDeParcelas({ total: 4500.01, minimo: 1500 }), 4, '1 centavo de entrada à vista + 3 de 1.500');
  assert.equal(m.maximoDeParcelas({ total: 1000, minimo: 1500 }), 1);
  assert.equal(m.maximoDeParcelas({ total: 1000, minimo: 0, limite: 10 }), 10);
  assert.equal(m.quantidadePossivel(1, 10, 1500), true);
  assert.equal(m.quantidadePossivel(3, 3000, 1500), false);
  assert.deepEqual(m.prazosDoTexto('0/30/60'), [0, 30, 60]);
  assert.deepEqual(m.prazosDoTexto('30', 3), [30, null, null]);
});

test('abatimento: recusado quando deixa o boleto abaixo do mínimo, salvo parcela única ou 1ª à vista', () => {
  const base = { valorBoleto: 2000, numeroParcela: 2, totalParcelas: 3, prazoDaPrimeira: 30, minimo: 1500 };
  assert.equal(m.recusaDoAbatimento({ ...base, abatimento: 500 }), null, 'fica em 1.500');
  assert.match(m.recusaDoAbatimento({ ...base, abatimento: 500.01 }), /passa a cobrar R\$\s1\.499,99, abaixo da parcela mínima/);
  assert.equal(m.recusaDoAbatimento({ ...base, abatimento: 1900, totalParcelas: 1, numeroParcela: 1 }), null, 'parcela única');
  assert.equal(m.recusaDoAbatimento({ ...base, abatimento: 1900, numeroParcela: 1, prazoDaPrimeira: 0 }), null, '1ª à vista');
  assert.ok(m.recusaDoAbatimento({ ...base, abatimento: 1900, numeroParcela: 1, prazoDaPrimeira: 30 }), '1ª a prazo não é livre');
  assert.equal(m.recusaDoAbatimento({ ...base, abatimento: 1900, minimo: 0 }), null);
});

test('juntar (devolução): 5 × R$ 100 viram 1 × R$ 500 no primeiro vencimento; o que cabe fica nas primeiras, igual', () => {
  const cinco = [1, 2, 3, 4, 5].map(n => ({ numero: n, valor: 100 }));
  assert.deepEqual(m.juntarParcelas(cinco, 1500).map(p => [p.numero, p.valor]), [[1, 500], [2, 0], [3, 0], [4, 0], [5, 0]]);
  const tres = [{ numero: 2, valor: 1400 }, { numero: 3, valor: 1400 }, { numero: 4, valor: 1400 }];
  assert.deepEqual(m.juntarParcelas(tres, 1500).map(p => p.valor), [2100, 2100, 0], '4.200 cabe em 2 de 1.500 ou mais');
  assert.equal(m.juntarParcelas([{ numero: 2, valor: 1600 }, { numero: 3, valor: 1500 }], 1500), null, 'nenhuma abaixo: não junta');
  assert.equal(m.juntarParcelas([{ numero: 2, valor: 100 }], 1500), null, 'uma só: já é livre');
  const comEntrada = [{ numero: 1, valor: 50, isenta: true }, { numero: 2, valor: 700 }, { numero: 3, valor: 700 }];
  assert.deepEqual(m.juntarParcelas(comEntrada, 1500).map(p => [p.numero, p.valor]), [[1, 50], [2, 1400], [3, 0]], 'a entrada à vista não entra na junção');
  assert.deepEqual(m.partesIguais(1000, 3), [333.33, 333.33, 333.34]);
});
