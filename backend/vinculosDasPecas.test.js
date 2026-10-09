/**
 * Filtro avançado de Produtos, Orçamentos e Pedidos (backend/vinculosDasPecas.js).
 */
const test = require('node:test');
const assert = require('node:assert');
const { pecasPorDocumento, vinculosPorProduto } = require('./vinculosDasPecas');

test('peças de cada pedido, sem repetir a mesma peça', () => {
  const pecas = pecasPorDocumento([
    { pedido_id: 1, produto_id: 9, codigo: 'BBRO 3015', nome: 'Banco - Mármore', quantidade: 2 },
    { pedido_id: 1, produto_id: 9, codigo: 'BBRO 3015', nome: 'Banco - Mármore', quantidade: '1.00' },
    { pedido_id: 1, produto_id: 4, codigo: 'PLT 01', nome: 'Platter', quantidade: 1 },
    { pedido_id: 2, produto_id: null, codigo: '', nome: 'Peça avulsa', quantidade: 3 },
    { pedido_id: null, produto_id: 4, codigo: 'X', nome: 'Sem pedido', quantidade: 1 },
    { pedido_id: 3, produto_id: 5, codigo: '', nome: '', quantidade: 1 }
  ], 'pedido_id');
  assert.deepStrictEqual(Object.keys(pecas).sort(), ['1', '2']);
  assert.deepStrictEqual(pecas['1'].map(p => `${p.codigo}:${p.quantidade}`), ['BBRO 3015:3', 'PLT 01:1']);
  assert.deepStrictEqual(pecas['2'], [{ produto_id: null, codigo: '', nome: 'Peça avulsa', quantidade: 3 }]);
});

test('cada peça sabe em que pedidos e orçamentos está, com o cliente', () => {
  const vinculos = vinculosPorProduto({
    pedidos: [{ id: 10, numero: 'PED10', cliente_id: 1, situacao: 'Produção' }, { id: 11, numero: 'PED11', cliente_id: 2, situacao: 'Enviado' }],
    pedidosItens: [
      { pedido_id: 10, produto_id: 9 }, { pedido_id: 10, produto_id: 9 }, { pedido_id: 11, produto_id: 9 }, { pedido_id: 99, produto_id: 9 }
    ],
    orcamentos: [{ id: 5, numero: 'OCRP5', cliente_id: null, prospeccao_id: 7, situacao: 'Pendente' }],
    orcamentosItens: [{ orcamento_id: 5, produto_id: 9 }, { orcamento_id: 5, produto_id: 4 }],
    clientes: new Map([['1', 'Jackie'], ['2', 'DS Contemporânea']]),
    prospeccoes: new Map([['7', 'Loja Nova']])
  });
  // Pedidos antes de orçamentos; os mais novos primeiro; pedido que não existe fica de fora.
  assert.deepStrictEqual(vinculos['9'].map(d => `${d.tipo}:${d.numero}:${d.cliente}`), [
    'pedido:PED11:DS Contemporânea', 'pedido:PED10:Jackie', 'orcamento:OCRP5:Loja Nova'
  ]);
  assert.deepStrictEqual(vinculos['4'].map(d => d.numero), ['OCRP5']);
});
