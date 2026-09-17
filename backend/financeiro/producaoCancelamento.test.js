/**
 * Cancelamento: a produção paga só o TRECHO QUE ANDOU.
 *
 * A peça entrou no pedido num ponto da rota e parou noutro (é o que o
 * cancelamento grava em `cancelamento_destinacoes`). O que está entre os dois
 * foi produzido aqui e é o que se paga; o resto da pendência some com o
 * pedido, e o que já tinha sido registrado é abatido para não pagar duas vezes.
 *
 * A rota da poltrona deste teste tem 5 passos: 3 de Marcenaria (1,2,3) e 2 de
 * Acabamento (4,5). A peça inteira paga R$ 300 de Marcenaria e R$ 200 de
 * Acabamento.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const confirmacao = require('./producaoConfirmacao');

/** API falsa em memória, no feitio do cliente de verdade (filtra por igualdade). */
function apiFalsa(tabelas) {
  let proximo = 9000;
  const nome = caminho => String(caminho).replace(/^\/api\//, '').split('?')[0].split('/')[0];
  return {
    tabelas,
    async get(caminho, opcoes = {}) {
      const tabela = nome(caminho);
      const linhas = tabelas[tabela];
      if (!linhas) throw new Error(`relation "${tabela}" does not exist`);
      const query = opcoes.query || {};
      return linhas.filter(l => Object.entries(query)
        .filter(([campo]) => !['select', 'order'].includes(campo))
        .every(([campo, valor]) => String(l[campo]) === String(valor)));
    },
    async post(caminho, corpo) {
      const tabela = nome(caminho);
      if (!tabelas[tabela]) throw new Error(`relation "${tabela}" does not exist`);
      // Como a API genérica: coluna que a tabela não tem é descartada.
      const conhecidas = tabelas[`__colunas__${tabela}`];
      const limpo = conhecidas ? Object.fromEntries(Object.entries(corpo).filter(([k]) => conhecidas.includes(k))) : { ...corpo };
      const linha = { id: (proximo += 1), ...limpo };
      tabelas[tabela].push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const partes = String(caminho).replace(/^\/api\//, '').split('/');
      const linha = (tabelas[partes[0]] || []).find(l => String(l.id) === partes[1]);
      if (linha) Object.assign(linha, corpo);
      return linha || {};
    }
  };
}

function tabelas({ destinacoes, eventos = [], colunaFracao = true }) {
  const t = {
    pedidos: [{ id: 55, numero: '2548', situacao: 'Cancelado', cliente_id: 7 }],
    pedidos_itens: [{ id: 501, pedido_id: 55, produto_id: 10, codigo: 'POL-01', nome: 'Poltrona', quantidade: 2 }],
    pedido_itens_ext: [],
    clientes: [{ id: 7, nome_fantasia: 'Cliente Bom', dono_cliente: 'Marcia' }],
    produtos: [{ id: 10, codigo: 'POL-01', nome: 'Poltrona' }],
    materia_prima: [
      { id: 301, nome: 'MDF', processo: 'Marcenaria' }, { id: 302, nome: 'Cola', processo: 'Marcenaria' }, { id: 303, nome: 'Parafuso', processo: 'Marcenaria' },
      { id: 304, nome: 'Seladora', processo: 'Acabamento' }, { id: 305, nome: 'Verniz', processo: 'Acabamento' }
    ],
    produtos_insumos: [301, 302, 303, 304, 305].map((insumo, i) => ({ id: 401 + i, produto_id: 10, insumo_id: insumo, quantidade: 1, ordem_insumo: i + 1 })),
    tabela_fixa: [{ id_prod: 10, cod_prod: 'POL-01', vlr_prod: '1000.00' }],
    etapas_producao: [
      { id: 1, nome: 'Marcenaria', ordem: 1, producao_ativa: true },
      { id: 2, nome: 'Acabamento', ordem: 2, producao_ativa: true }
    ],
    producao_setores: [],
    producao_valores: [
      { id: 1, etapa_id: 1, produto_id: null, tipo: 'valor', valor_unitario: '300.00', ativo: true },
      { id: 2, etapa_id: 2, produto_id: null, tipo: 'valor', valor_unitario: '200.00', ativo: true }
    ],
    comissao_regras: [],
    financeiro_feriados: [],
    financeiro_configuracao: [{ id: 1, comissao_dia_pagamento: 15, producao_dia_util: 5, sabado_dia_util: false }],
    financeiro_fechamentos: [],
    financeiro_fechamento_itens: [],
    financeiro_pagamentos: [],
    financeiro_auditoria: [],
    producao_confirmacoes: [],
    producao_eventos: eventos,
    cancelamento_destinacoes: destinacoes
  };
  // Sem o SQL novo, `fracao_paga` não existe: a API genérica descarta a coluna.
  if (!colunaFracao) {
    t.__colunas__producao_eventos = ['pedido_id', 'pedido_item_id', 'produto_id', 'setor_id', 'etapa_id', 'quantidade',
      'data_finalizacao', 'competencia', 'observacao', 'status', 'criado_por', 'criado_em', 'estornado_em', 'estornado_por', 'motivo_estorno'];
  }
  return t;
}

const HOJE = '2026-09-17';

test('avanço no processo: só os passos vencidos entre a saída e a volta', () => {
  const rota = [
    { ordem: 1, processo: 'Marcenaria' }, { ordem: 2, processo: 'Marcenaria' }, { ordem: 3, processo: 'Marcenaria' },
    { ordem: 4, processo: 'Acabamento' }, { ordem: 5, processo: 'Acabamento' }
  ];
  // Saiu em 3 e voltou em 3: nada foi feito (o exemplo do "8/12 volta 8/12").
  assert.equal(confirmacao.avancoNoProcesso(rota, 'Acabamento', 3, 3), 0);
  // Voltou um passo à frente: metade do Acabamento (1 dos 2 insumos).
  assert.equal(confirmacao.avancoNoProcesso(rota, 'Acabamento', 3, 4), 0.5);
  // Voltou pronta: o Acabamento inteiro, e a Marcenaria não (já estava feita).
  assert.equal(confirmacao.avancoNoProcesso(rota, 'Acabamento', 3, 5), 1);
  assert.equal(confirmacao.avancoNoProcesso(rota, 'Marcenaria', 3, 5), 0);
  // Peça do zero que parou no meio da Marcenaria: 2 dos 3 insumos.
  assert.equal(Math.round(confirmacao.avancoNoProcesso(rota, 'Marcenaria', 0, 2) * 1000) / 1000, 0.667);
  assert.equal(confirmacao.avancoNoProcesso(rota, 'Pintura', 0, 5), 0, 'processo que a peça não usa não paga');
});

test('cancelamento: paga o trecho que andou, abate o que já foi registrado e não repete se rodar de novo', async () => {
  const api = apiFalsa(tabelas({
    destinacoes: [
      // Uma peça do zero que parou no fim da Marcenaria (passo 3): paga a Marcenaria inteira.
      { id: 1, pedido_id: 55, pedido_item_id: 501, produto_id: 10, tipo_destino: 'estoque', quantidade: 1, ordem_origem: 0, ordem_destino: 3, falha: null },
      // Outra do zero que foi pronta para outro pedido (passo 5): paga Marcenaria + Acabamento.
      { id: 2, pedido_id: 55, pedido_item_id: 501, produto_id: 10, tipo_destino: 'realocacao', quantidade: 1, ordem_origem: 0, ordem_destino: 5, pedido_id_destino: 77, falha: null },
      // Falha registrada não conta.
      { id: 3, pedido_id: 55, pedido_item_id: 501, quantidade: 1, ordem_origem: 0, ordem_destino: 5, falha: 'não deu' }
    ]
  }));

  const r = await confirmacao.confirmarCancelamento({ api, pedidoId: 55, data: HOJE, hoje: HOJE, usuarioId: 1 });
  assert.equal(r.confirmado, true);
  assert.deepEqual(r.avisos, []);
  const porProcesso = Object.fromEntries(r.lancados.map(l => [l.processo, l]));
  assert.equal(porProcesso.Marcenaria.fracao, 2, 'duas peças fizeram a marcenaria inteira');
  assert.equal(porProcesso.Marcenaria.valor, 600);
  assert.equal(porProcesso.Acabamento.fracao, 1, 'só a que foi até o fim fez o acabamento');
  assert.equal(porProcesso.Acabamento.valor, 200);
  assert.equal(r.total, 800);

  // O evento guarda a fração: é ela que vale, não a fila inteira.
  const eventos = api.tabelas.producao_eventos;
  assert.equal(eventos.length, 2);
  assert.deepEqual(eventos.map(e => e.fracao_paga).sort(), [1, 2]);
  assert.ok(eventos.every(e => e.competencia === '2026-09' && e.status === 'ativo'));
  // E a decisão fica gravada na competência, como as do fechamento.
  assert.deepEqual(api.tabelas.producao_confirmacoes.map(x => x.origem), ['cancelamento', 'cancelamento']);

  // Rodar de novo não paga outra vez: o que já foi lançado é abatido.
  const denovo = await confirmacao.confirmarCancelamento({ api, pedidoId: 55, data: HOJE, hoje: HOJE, usuarioId: 1 });
  assert.equal(denovo.confirmado, false);
  assert.equal(api.tabelas.producao_eventos.length, 2);
});

test('cancelamento: o que já tinha sido registrado no mês sai da conta; peça que volta como saiu não paga nada', async () => {
  const api = apiFalsa(tabelas({
    // A peça saiu do estoque com a Marcenaria pronta (passo 3) e volta no mesmo ponto.
    destinacoes: [{ id: 1, pedido_id: 55, pedido_item_id: 501, produto_id: 10, tipo_destino: 'estoque', quantidade: 1, ordem_origem: 3, ordem_destino: 3, falha: null }]
  }));
  api.tabelas.pedido_itens_ext.push({ id: 1, pedido_item_id: 501, id_pedido: 55, ultimo_insumo_id: 403, quantidade: 1 });
  const r = await confirmacao.confirmarCancelamento({ api, pedidoId: 55, data: HOJE, hoje: HOJE, usuarioId: 1 });
  assert.equal(r.confirmado, false, 'nada andou: nada a pagar');
  assert.equal(api.tabelas.producao_eventos.length, 0);

  // Agora com o Acabamento já registrado à mão e a peça voltando pronta: não paga de novo.
  const api2 = apiFalsa(tabelas({
    destinacoes: [{ id: 1, pedido_id: 55, pedido_item_id: 501, produto_id: 10, tipo_destino: 'estoque', quantidade: 1, ordem_origem: 3, ordem_destino: 5, falha: null }],
    eventos: [{ id: 1, pedido_id: 55, pedido_item_id: 501, produto_id: 10, etapa_id: 2, quantidade: 1, data_finalizacao: '2026-09-10', competencia: '2026-09', status: 'ativo' }]
  }));
  api2.tabelas.pedido_itens_ext.push({ id: 1, pedido_item_id: 501, id_pedido: 55, ultimo_insumo_id: 403, quantidade: 1 });
  const r2 = await confirmacao.confirmarCancelamento({ api: api2, pedidoId: 55, data: HOJE, hoje: HOJE, usuarioId: 1 });
  assert.equal(r2.confirmado, false, 'o Acabamento já tinha sido pago no registro à mão');
  assert.equal(api2.tabelas.producao_eventos.length, 1);
});

test('cancelamento sem o SQL novo: o lançamento é desfeito e a tela recebe o aviso do arquivo', async () => {
  const api = apiFalsa(tabelas({
    destinacoes: [{ id: 1, pedido_id: 55, pedido_item_id: 501, produto_id: 10, tipo_destino: 'estoque', quantidade: 1, ordem_origem: 0, ordem_destino: 3, falha: null }],
    colunaFracao: false
  }));
  const r = await confirmacao.confirmarCancelamento({ api, pedidoId: 55, data: HOJE, hoje: HOJE, usuarioId: 1 });
  assert.equal(r.confirmado, false);
  assert.match(r.avisos.join(' '), /fechamento_producao_e_pagamentos\.sql/);
  assert.equal(api.tabelas.producao_eventos[0].status, 'estornado', 'sem a coluna, o evento pagaria a fila inteira');
});
