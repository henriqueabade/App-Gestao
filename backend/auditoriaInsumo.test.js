const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

/**
 * Auditoria de um insumo: o MESMO evento não pode ser contado duas vezes.
 *
 * A conversão de um orçamento grava a baixa em DUAS tabelas —
 * `materia_prima_movimentacoes` (o saldo antes/depois) e `estoque_movimentos`
 * (o pedido, a peça, a reserva). Listar as duas seguidas mostraria cada baixa
 * duas vezes e dobraria o total que saiu.
 *
 * O pareamento não pode olhar a data crua: `criado_em` é `timestamp` SEM fuso e
 * `created_at` é `timestamptz`, então o mesmo instante volta das duas com horas
 * diferentes. O fixture reproduz isso — as datas do razão estão 3 h à frente.
 */

const INSTANTE = '2026-08-04T00:19:52';

/** O mesmo momento, como cada tabela o devolve. */
const semFuso = seg => `2026-08-04T03:19:${String(seg).padStart(2, '0')}.500Z`;
const comFuso = seg => `2026-08-04T00:19:${String(seg).padStart(2, '0')}.560Z`;

const HISTORICO = [
  // Duas baixas por pedido (ambas também no razão) e um ajuste manual (só aqui).
  { id: 1, insumo_id: 151, tipo: 'saida_pedido', quantidade: 20,
    quantidade_anterior: 1209, quantidade_atual: 1189, criado_em: semFuso(52), usuario_id: 13 },
  { id: 2, insumo_id: 151, tipo: 'saida_pedido', quantidade: 6,
    quantidade_anterior: 1215, quantidade_atual: 1209, criado_em: semFuso(30), usuario_id: 13 },
  { id: 3, insumo_id: 151, tipo: 'ajuste_quantidade', quantidade: 4,
    quantidade_anterior: 1219, quantidade_atual: 1215, criado_em: semFuso(10), usuario_id: 13,
    observacao: 'Quantidade alterada na edição do insumo' }
];

const RAZAO = [
  { id: 900, tipo_movimento: 'consumo_insumo', tipo_item: 'insumo', item_id: 151,
    quantidade: 20, pedido_id: 69, pedido_item_id: 10, reserva_id: 8,
    created_at: comFuso(52), created_by: 13 },
  { id: 901, tipo_movimento: 'consumo_insumo', tipo_item: 'insumo', item_id: 151,
    quantidade: 6, pedido_id: 68, pedido_item_id: 28, reserva_id: null,
    created_at: comFuso(30), created_by: 13 },
  // Ruído que NÃO pode entrar: uma PEÇA cujo id coincide com o do insumo.
  { id: 902, tipo_movimento: 'consumo_peca_pronta', tipo_item: 'peca', item_id: 151,
    quantidade: 99, pedido_id: 69, created_at: comFuso(52), created_by: 13 }
];

function montarAmbiente() {
  const caminhoDb = require.resolve('./db');
  const caminhoAlvo = require.resolve('./materiaPrima');
  const anterior = require.cache[caminhoDb];

  const fake = {
    async get(rota, opcoes = {}) {
      const q = opcoes?.query || {};
      if (rota === '/materia_prima/151') {
        return { id: 151, nome: 'Etiqueta do Produto', unidade: 'Pç', quantidade: 1189, preco_unitario: 0.03 };
      }
      if (rota === '/materia_prima_movimentacoes') {
        return HISTORICO.filter(m => String(m.insumo_id) === String(q.insumo_id));
      }
      if (rota === '/estoque_movimentos') {
        return RAZAO.filter(m =>
          String(m.item_id) === String(q.item_id) && String(m.tipo_item) === String(q.tipo_item));
      }
      if (rota === '/pedidos_itens_faltantes') return [];
      if (rota === '/usuarios') return [{ id: 13, nome: 'Henrique Viana Abade' }];
      if (rota === '/pedidos') return [{ id: 69, numero: 'PED22' }, { id: 68, numero: 'PED21' }];
      return [];
    }
  };

  require.cache[caminhoDb] = new Module(caminhoDb, null);
  require.cache[caminhoDb].filename = caminhoDb;
  require.cache[caminhoDb].loaded = true;
  require.cache[caminhoDb].exports = fake;

  delete require.cache[caminhoAlvo];
  const { listarMovimentosInsumo } = require(caminhoAlvo);

  return {
    listarMovimentosInsumo,
    restaurar() {
      if (anterior) require.cache[caminhoDb] = anterior;
      else delete require.cache[caminhoDb];
      delete require.cache[caminhoAlvo];
    }
  };
}

test('o mesmo evento gravado nas duas tabelas vira UMA linha', async () => {
  const amb = montarAmbiente();
  try {
    const r = await amb.listarMovimentosInsumo(151);

    assert.equal(
      r.movimentos.length, 3,
      '3 eventos: duas baixas por pedido e um ajuste. Somar as tabelas daria 5 '
      + 'e o total que saiu apareceria dobrado.'
    );

    const saiu = r.movimentos.reduce((acc, m) => acc + (m.efeito < 0 ? -m.efeito : 0), 0);
    assert.equal(saiu, 26, 'saiu 20 + 6 — não 52');
  } finally {
    amb.restaurar();
  }
});

test('a linha ganha o pedido de origem, apesar da diferença de fuso', async () => {
  const amb = montarAmbiente();
  try {
    const r = await amb.listarMovimentosInsumo(151);

    const de20 = r.movimentos.find(m => m.quantidade === 20);
    assert.equal(de20.pedido_numero, 'PED22', 'o razão diz de qual pedido veio');
    assert.equal(de20.pedido_item_id, 10, 'e de qual peça');
    assert.equal(de20.reserva_id, 8, 'e sob qual reserva');
    // O saldo vem do histórico; o pedido vem do razão. É a fusão das duas.
    assert.equal(de20.saldo_anterior, 1209);
    assert.equal(de20.saldo_atual, 1189);

    const ajuste = r.movimentos.find(m => m.tipo === 'ajuste_quantidade');
    assert.equal(ajuste.pedido_numero, null, 'ajuste manual não tem pedido');
    assert.equal(ajuste.origem, 'Módulo de Matéria-Prima');
  } finally {
    amb.restaurar();
  }
});

test('movimento de PEÇA com o mesmo id não entra na auditoria do insumo', async () => {
  const amb = montarAmbiente();
  try {
    const r = await amb.listarMovimentosInsumo(151);

    assert.ok(
      r.movimentos.every(m => Number(m.quantidade) !== 99),
      '`estoque_movimentos` guarda peça e insumo na mesma tabela; sem filtrar '
      + '`tipo_item` o histórico do insumo mostraria movimentos de uma peça que '
      + 'só compartilha o número do id'
    );
  } finally {
    amb.restaurar();
  }
});

test('quem fez a alteração aparece em cada linha', async () => {
  const amb = montarAmbiente();
  try {
    const r = await amb.listarMovimentosInsumo(151);
    assert.ok(
      r.movimentos.every(m => m.usuario === 'Henrique Viana Abade'),
      'auditoria sem autor não é auditoria'
    );
  } finally {
    amb.restaurar();
  }
});
