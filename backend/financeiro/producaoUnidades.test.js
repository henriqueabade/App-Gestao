/**
 * Produção por processo, fiel ao que foi feito (backend/financeiro/producaoUnidades.js)
 * e as regras novas de CMS (dono do cliente) e Royalty (desenhista da peça).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./producaoUnidades');
const regras = require('./regras');
const base = require('./base');

// Rota de uma peça: 10 insumos de Marcenaria (ordens 1..10) e 4 de Acabamento (11..14).
const ROTA = [
  ...Array.from({ length: 10 }, (_, i) => ({ passo_id: 100 + i, insumo_id: 1 + i, processo: 'Marcenaria', ordem: i + 1 })),
  ...Array.from({ length: 4 }, (_, i) => ({ passo_id: 200 + i, insumo_id: 20 + i, processo: 'Acabamento', ordem: 11 + i }))
];

test('fração: cada insumo do processo conta igual; o estoque adiantado paga só o que falta', () => {
  assert.equal(u.fracao(ROTA, 'Marcenaria', 0), 1, 'do zero: o processo inteiro');
  assert.equal(u.fracao(ROTA, 'marcenária', 9), 0.1, '9 de 10 feitos: 1/10 (e o nome vale sem acento)');
  assert.equal(u.fracao(ROTA, 'Marcenaria', 5), 0.5);
  assert.equal(u.fracao(ROTA, 'Marcenaria', 10), 0, '10 de 10: não paga');
  assert.equal(u.fracao(ROTA, 'Acabamento', 10), 1, 'marcenaria pronta, acabamento inteiro');
  assert.equal(u.fracao(ROTA, 'Acabamento', 12), 0.5);
  assert.equal(u.fracao(ROTA, 'Embalagem', 0), null, 'a peça não usa o processo');
});

test('unidades do item: do estoque primeiro (as mais adiantadas antes), depois as do zero; a fila pula quem não precisa', () => {
  const ext = [
    { pedido_item_id: 1, ultimo_insumo_id: 104, quantidade: 1 }, // parou no 5º insumo de marcenaria
    { pedido_item_id: 1, ultimo_insumo_id: 108, quantidade: 1 }, // parou no 9º
    { pedido_item_id: 1, ultimo_insumo_id: 203, quantidade: 1 } // pronta (fim da rota)
  ];
  const grupos = u.unidadesDoItem({ item: { quantidade: 5 }, ext, rota: ROTA });
  assert.deepEqual(grupos.map(g => [g.origem, g.ordem_origem, g.quantidade]), [['estoque', 14, 1], ['estoque', 9, 1], ['estoque', 5, 1], ['producao', 0, 2]]);
  assert.deepEqual(u.filaDoProcesso({ grupos, rota: ROTA, processo: 'Marcenaria' }), [0.1, 0.5, 1, 1], 'a pronta não entra');
  assert.deepEqual(u.filaDoProcesso({ grupos, rota: ROTA, processo: 'Acabamento' }), [1, 1, 1, 1]);
  // Sem ext nenhum, tudo do zero.
  assert.deepEqual(u.unidadesDoItem({ item: { quantidade: 2 }, ext: [], rota: ROTA }), [{ origem: 'producao', ordem_origem: 0, quantidade: 2 }]);
});

test('alocar: os registros consomem a fila na ordem; o estornado devolve as peças dele', () => {
  const fila = [0.1, 0.5, 1, 1];
  const eventos = [
    { id: 7, status: 'ativo', quantidade: 2, data_finalizacao: '2026-09-02' },
    { id: 5, status: 'ativo', quantidade: 1, data_finalizacao: '2026-09-01' },
    { id: 6, status: 'estornado', quantidade: 1, data_finalizacao: '2026-09-01' },
    { id: 8, status: 'ativo', quantidade: -1, estorno_de: 5, data_finalizacao: '2026-09-03' }
  ];
  const r = u.alocar({ fila, eventos });
  assert.deepEqual(r.porEvento.get('5').fracoes, [0.1]);
  assert.deepEqual(r.porEvento.get('7').fracoes, [0.5, 1]);
  assert.equal(r.porEvento.has('6'), false);
  assert.equal(r.usadas, 3);
  assert.deepEqual(r.pendentes, [1]);
});

test('regra de todas as peças: vale para toda peça sem regra própria ATIVA; a que tem a dela segue a dela', () => {
  // Regra do dono (21/09/2026): "a regra de todas as peças é válida para todas
  // as peças que não têm cadastro específico ativo; se tiver algum cadastro
  // ativo ele rege aquela peça; não tendo, o de todas vale para ela."
  const MARCENARIA = 1;
  const ACABAMENTO = 3;
  const valores = [
    { id: 1, etapa_id: MARCENARIA, produto_id: null, tipo: 'percentual', percentual: '7.2', ativo: true }, // todas as peças
    { id: 2, etapa_id: ACABAMENTO, produto_id: null, tipo: 'percentual', percentual: '3.6', ativo: true }, // todas as peças
    { id: 3, etapa_id: MARCENARIA, produto_id: 50, tipo: 'valor', valor_unitario: '120', ativo: true },   // própria, ativa
    { id: 4, etapa_id: MARCENARIA, produto_id: 60, tipo: 'valor', valor_unitario: '999', ativo: false },  // própria, DESLIGADA
    { id: 5, etapa_id: MARCENARIA, produto_id: 70, tipo: 'valor', valor_unitario: '80', ativo: 'f' }      // desligada (como o banco devolve)
  ];
  const origem = (peca, etapa) => {
    const r = u.regraDaPeca(valores, peca, etapa);
    return r && `${r.origem}:${r.tipo === 'valor' ? r.valor : r.percentual}`;
  };

  assert.equal(origem(50, MARCENARIA), 'peca:120', 'a peça com regra própria ativa segue a dela');
  assert.equal(origem(50, ACABAMENTO), 'padrao:3.6', 'a regra própria de um processo não mexe nos outros processos da peça');
  assert.equal(origem(60, MARCENARIA), 'padrao:7.2', 'regra própria desligada não vale: fica a de todas as peças');
  assert.equal(origem(70, MARCENARIA), 'padrao:7.2', 'desligada vinda do banco como "f" também não vale');
  assert.equal(origem(99, MARCENARIA), 'padrao:7.2', 'peça sem cadastro próprio: a de todas as peças');
  assert.equal(origem(null, MARCENARIA), 'padrao:7.2');
  // Sem a regra de todas as peças no processo, só quem tem a própria recebe.
  assert.equal(u.regraDaPeca(valores, 99, 2), null);
});

test('regra da peça: a da peça vale mais que o padrão; % usa o preço cheio da tabela fixa', () => {
  const valores = [
    { id: 1, etapa_id: 1, produto_id: null, tipo: 'percentual', percentual: '10', valor_unitario: 0, ativo: true },
    { id: 2, etapa_id: 1, produto_id: 10, tipo: 'valor', valor_unitario: '45.50', ativo: true },
    { id: 3, etapa_id: 2, produto_id: 10, tipo: 'valor', valor_unitario: '99', ativo: false },
    { id: 4, setor_id: 1, produto_id: null, valor_unitario: '30', ativo: true } // fase G (setor): não vale
  ];
  const daPeca = u.regraDaPeca(valores, 10, 1);
  assert.deepEqual([daPeca.origem, daPeca.tipo, daPeca.valor], ['peca', 'valor', 45.5]);
  const padrao = u.regraDaPeca(valores, 11, 1);
  assert.deepEqual([padrao.origem, padrao.tipo, padrao.percentual], ['padrao', 'percentual', 10]);
  assert.equal(u.valorDaPecaInteira(padrao, 1000), 100, '10% de R$ 1.000');
  assert.equal(u.valorDaPecaInteira(padrao, null), null, '% sem preço de tabela: sem valor');
  assert.equal(u.regraDaPeca(valores, 10, 2), null);
  assert.equal(u.descreverRegra(padrao), '10% da tabela fixa');
  // O exemplo do dono: marcenaria a 10% da tabela; peça com 9 de 10 insumos feitos paga 1% (R$ 10 numa peça de R$ 1.000).
  assert.equal(Math.round(u.valorDaPecaInteira(padrao, 1000) * u.fracao(ROTA, 'Marcenaria', 9) * 100) / 100, 10);

  const pend = u.pendenciasDaPeca({
    processos: [{ nome: 'Marcenaria', insumos: 10 }, { nome: 'Acabamento', insumos: 4 }, { nome: 'Embalagem', insumos: 0 }],
    etapas: [{ id: 1, nome: 'Marcenaria', producao_ativa: true }, { id: 2, nome: 'Acabamento', producao_ativa: true }, { id: 4, nome: 'Embalagem', producao_ativa: true }],
    valores, produtoId: 11
  });
  assert.deepEqual(pend.faltam.map(f => f.nome), ['Acabamento'], 'Embalagem sem insumo não precisa de regra');
  const desligado = u.pendenciasDaPeca({
    processos: [{ nome: 'Acabamento', insumos: 4 }], etapas: [{ id: 2, nome: 'Acabamento', producao_ativa: false }], valores, produtoId: 11
  });
  assert.deepEqual(desligado.faltam, [], 'processo com o pagamento desligado não precisa de regra');
});

test('CMS vai para o dono do cliente (só nas regras dele); Royalty vai para os desenhistas, na proporção das peças', () => {
  const lista = [
    { id: 1, tipo: 'cms', beneficiario: 'Marcia Lamounier', percentual: '8', escopo: 'todos', ativo: true },
    { id: 2, tipo: 'cms', beneficiario: 'Iara Abade', percentual: '5', escopo: 'todos', ativo: true },
    { id: 3, tipo: 'cms', beneficiario: 'Marcia Lamounier', percentual: '3', escopo: 'cliente', cliente_id: 7, ativo: true },
    { id: 4, tipo: 'royalty', beneficiario: null, percentual: '10', escopo: 'todos', ativo: true },
    { id: 5, tipo: 'royalty', beneficiario: null, percentual: '4', escopo: 'pedido', pedido_id: 60, ativo: true }
  ];
  const contexto = {
    dono_cliente: 'Marcia Lamounier',
    desenhistas: [{ nome: 'Barral & Lamounier', valor: 600 }, { nome: 'Estúdio Ninho', valor: 300 }, { nome: '', valor: 100 }]
  };
  const t = regras.taxasDoPedido(lista, { id: 55, cliente_id: 7 }, contexto);
  assert.deepEqual(t.cms.map(r => [r.beneficiario, r.percentual]), [['Marcia Lamounier', 3]], 'a regra do cliente dela vence a geral dela; a da Iara não vale aqui');
  assert.deepEqual(t.royalty.map(r => [r.beneficiario, r.percentual, r.participacao]), [['Barral & Lamounier', 6, 0.6], ['Estúdio Ninho', 3, 0.3]]);
  assert.equal(t.pct_royalty, 9, 'a peça sem desenhista não paga royalty a ninguém');
  assert.equal(t.sem_desenhista, 0.1);
  const v = regras.valoresSobre(1000, t);
  assert.deepEqual(v.beneficiarios.map(b => [b.tipo, b.beneficiario, b.valor]), [['cms', 'Marcia Lamounier', 30], ['royalty', 'Barral & Lamounier', 60], ['royalty', 'Estúdio Ninho', 30]]);

  // Cliente de outro dono: a regra da Marcia não vale; a da Iara vale (dono do cliente, não do pedido).
  const daIara = regras.taxasDoPedido(lista, { id: 56, cliente_id: 9 }, { dono_cliente: 'iara abade', desenhistas: contexto.desenhistas });
  assert.deepEqual(daIara.cms.map(r => [r.beneficiario, r.percentual]), [['iara abade', 5]]);
  // Pedido com regra própria de royalty.
  assert.equal(regras.taxasDoPedido(lista, { id: 60, cliente_id: 7 }, contexto).pct_royalty_regra, 4);
  // Sem dono e sem peças: nada.
  const vazio = regras.taxasDoPedido(lista, { id: 61, cliente_id: 1 }, { dono_cliente: null, desenhistas: [] });
  assert.deepEqual([vazio.cms.length, vazio.royalty.length, vazio.sem_regra, vazio.sem_cms], [0, 0, false, true]);
});

test('contexto dos pedidos: dono do cliente e valor vendido por desenhista, sem as peças devolvidas', () => {
  const ctx = base.contextoDosPedidos({
    pedidos: [{ id: 55, cliente_id: 7 }, { id: 56, cliente_id: null }, { id: 57, cliente_id: 7 }],
    itens: [
      { pedido_id: 55, produto_id: 10, quantidade: 4, valor_total: '3000', quantidade_devolvida: 1 },
      { pedido_id: 55, produto_id: 11, quantidade: 1, valor_total: '1000' },
      { pedido_id: 57, produto_id: 10, quantidade: 2, valor_total: '500', quantidade_devolvida: 2 }
    ],
    produtos: [{ id: 10, desenhado_por: 'Barral & Lamounier' }, { id: 11, desenhado_por: 'Estúdio Ninho' }],
    clientes: [{ id: 7, dono_cliente: ' Marcia Lamounier ' }]
  });
  assert.deepEqual(ctx.get('55'), { dono_cliente: 'Marcia Lamounier', desenhistas: [{ nome: 'Barral & Lamounier', valor: 2250 }, { nome: 'Estúdio Ninho', valor: 1000 }] });
  assert.deepEqual(ctx.get('56'), { dono_cliente: null, desenhistas: [] });
  assert.deepEqual(ctx.get('57').desenhistas, [{ nome: 'Barral & Lamounier', valor: 500 }], 'tudo devolvido: a divisão fica pelas peças vendidas');
});
