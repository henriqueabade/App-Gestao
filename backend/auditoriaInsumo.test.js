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
    observacao: 'Quantidade alterada na edição do insumo' },
  // Ajuste para CIMA: o saldo subiu, então é entrada.
  { id: 4, insumo_id: 151, tipo: 'ajuste_quantidade', quantidade: 200,
    quantidade_anterior: 1019, quantidade_atual: 1219, criado_em: semFuso(5), usuario_id: 13,
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

function montarAmbiente(sobrescrever = {}) {
  const caminhoDb = require.resolve('./db');
  const caminhoAlvo = require.resolve('./materiaPrima');
  const anterior = require.cache[caminhoDb];

  const razao = sobrescrever.razao || RAZAO;
  const historico = sobrescrever.historico || HISTORICO;

  const fake = {
    async get(rota, opcoes = {}) {
      const q = opcoes?.query || {};
      if (rota === '/materia_prima/151') {
        return { id: 151, nome: 'Etiqueta do Produto', unidade: 'Pç', quantidade: 1189, preco_unitario: 0.03 };
      }
      if (rota === '/materia_prima_movimentacoes') {
        return historico.filter(m => String(m.insumo_id) === String(q.insumo_id));
      }
      if (rota === '/estoque_movimentos') {
        return razao.filter(m =>
          String(m.item_id) === String(q.item_id) && String(m.tipo_item) === String(q.tipo_item));
      }
      if (rota === '/pedidos_itens_faltantes') return [];
      if (rota === '/usuarios') return [{ id: 13, nome: 'Henrique Viana Abade' }];
      if (rota === '/pedidos') {
        return sobrescrever.pedidos || [{ id: 69, numero: 'PED22' }, { id: 68, numero: 'PED21' }];
      }
      if (rota === '/pedidos_itens') {
        return sobrescrever.itens || [
          { id: 10, pedido_id: 69, codigo: 'AVSØ 0114 MUI', nome: 'Apaga Velas Silvia - 1' },
          { id: 28, pedido_id: 68, codigo: 'BAGR 3580 GRA', nome: 'Bandeja Acervo - G' }
        ];
      }
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
      r.movimentos.length, 4,
      '4 eventos: duas baixas por pedido e dois ajustes. Somar as tabelas daria '
      + '6 e o total que saiu apareceria dobrado.'
    );

    const saiu = r.movimentos.reduce((acc, m) => acc + (m.efeito < 0 ? -m.efeito : 0), 0);
    assert.equal(saiu, 30, 'saiu 20 + 6 (pedidos) + 4 (ajuste para baixo) — não o dobro');
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

    assert.equal(de20.peca_codigo, 'AVSØ 0114 MUI', 'e de qual peça, pelo código');

    const de6 = r.movimentos.find(m => m.quantidade === 6);
    assert.equal(de6.peca_codigo, 'BAGR 3580 GRA', 'cada baixa aponta a sua peça');

    const ajuste = r.movimentos.find(m => m.quantidade === 4);
    assert.equal(ajuste.pedido_numero, null, 'ajuste manual não tem pedido');
    assert.equal(ajuste.origem, 'Módulo de Matéria-Prima');
    assert.equal(ajuste.peca_codigo, null, 'nem peça');
  } finally {
    amb.restaurar();
  }
});

test('movimento antigo sem peça: resolve pelo pedido quando não há dúvida', async () => {
  const amb = montarAmbiente({
    // Como os registros gravados antes de o razão anotar a peça: só o pedido.
    razao: [
      { id: 910, tipo_movimento: 'consumo_insumo', tipo_item: 'insumo', item_id: 151,
        quantidade: 20, pedido_id: 69, pedido_item_id: null,
        created_at: comFuso(52), created_by: 13 },
      { id: 911, tipo_movimento: 'consumo_insumo', tipo_item: 'insumo', item_id: 151,
        quantidade: 6, pedido_id: 70, pedido_item_id: null,
        created_at: comFuso(30), created_by: 13 }
    ],
    pedidos: [{ id: 69, numero: 'PED22' }, { id: 70, numero: 'PED23' }],
    itens: [
      // PED22 tem UMA peça: o insumo só pode ter ido para ela.
      { id: 10, pedido_id: 69, codigo: 'AVSØ 0114 MUI', nome: 'Apaga Velas Silvia - 1' },
      // PED23 tem DUAS: aí não dá para saber.
      { id: 40, pedido_id: 70, codigo: 'BAGR 3580 GRA', nome: 'Bandeja Acervo - G' },
      { id: 41, pedido_id: 70, codigo: 'BAME 3070 MEN', nome: 'Bandeja Acervo - M' }
    ]
  });
  try {
    const r = await amb.listarMovimentosInsumo(151);

    const de20 = r.movimentos.find(m => m.quantidade === 20);
    assert.equal(
      de20.peca_codigo, 'AVSØ 0114 MUI',
      'pedido de uma peça só: não há dúvida de para onde o insumo foi'
    );

    const de6 = r.movimentos.find(m => m.quantidade === 6);
    assert.equal(
      de6.peca_codigo, null,
      'pedido com duas peças: em auditoria, chutar é pior que admitir que não se sabe'
    );
  } finally {
    amb.restaurar();
  }
});

test('ajuste manual é ENTRADA se o saldo subiu e SAÍDA se desceu', async () => {
  const amb = montarAmbiente();
  try {
    const r = await amb.listarMovimentosInsumo(151);

    const paraCima = r.movimentos.find(m => m.quantidade === 200);
    assert.equal(paraCima.descricao, 'Entrada por ajuste manual');
    assert.equal(paraCima.efeito, 200, '1019 -> 1219: entraram 200');

    const paraBaixo = r.movimentos.find(m => m.quantidade === 4);
    assert.equal(paraBaixo.descricao, 'Saída por ajuste manual');
    assert.equal(paraBaixo.efeito, -4, '1219 -> 1215: saíram 4');

    // Antes o ajuste saía sem sinal e ficava FORA dos totais: um insumo podia
    // ganhar 200 pela tela e o resumo dizer "total que entrou: 0".
    const entrou = r.movimentos.reduce((acc, m) => acc + (m.efeito > 0 ? m.efeito : 0), 0);
    assert.equal(entrou, 200, 'o ajuste para cima conta no total que entrou');
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

test('devolução e consumo no mesmo instante não trocam de pedido', async () => {
  // O que uma realocação produz: o pedido de origem DEVOLVE 1 unidade do insumo
  // e o de destino CONSOME 1 unidade do mesmo insumo, no mesmo instante e com a
  // mesma quantidade. Parear só por quantidade e horário podia explicar a
  // entrada com a saída do outro pedido — e o extrato mostraria o pedido
  // errado ao lado do movimento.
  const amb = montarAmbiente({
    historico: [
      { id: 1, insumo_id: 151, tipo: 'entrada_pedido', quantidade: 1,
        quantidade_anterior: 10, quantidade_atual: 11, criado_em: semFuso(52),
        usuario_id: 13, pedido_id: 69 },
      { id: 2, insumo_id: 151, tipo: 'saida_pedido', quantidade: 1,
        quantidade_anterior: 11, quantidade_atual: 10, criado_em: semFuso(52),
        usuario_id: 13, pedido_id: 68 }
    ],
    // O consumo vem PRIMEIRO na lista de propósito: parear pela menor distância
    // de tempo pegaria este para explicar a entrada, que é o erro que se quer
    // impedir.
    razao: [
      { id: 901, tipo_movimento: 'consumo_insumo', tipo_item: 'insumo', item_id: 151,
        quantidade: 1, pedido_id: 68, created_at: comFuso(52), created_by: 13 },
      { id: 900, tipo_movimento: 'retorno_cancelamento', tipo_item: 'insumo', item_id: 151,
        quantidade: 1, pedido_id: 69, created_at: comFuso(52), created_by: 13 }
    ]
  });

  try {
    const r = await amb.listarMovimentosInsumo(151);

    assert.equal(r.movimentos.length, 2, 'dois eventos, não quatro nem um');

    const entrada = r.movimentos.find(m => m.efeito > 0);
    const saida = r.movimentos.find(m => m.efeito < 0);

    assert.equal(entrada.pedido_numero, 'PED22', 'a devolução é do pedido cancelado');
    assert.equal(saida.pedido_numero, 'PED21', 'e o consumo é do pedido de destino');
  } finally {
    amb.restaurar();
  }
});
