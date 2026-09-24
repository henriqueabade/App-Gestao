/**
 * Ordens de pagamento (backend/cobranca/ordens.js) — decisões do dono de
 * 24/09/2026: "pago em ou PARA QUANDO"; data futura até o vencimento da
 * parcela; não entra em parcela com boleto do BB em aberto; ocupa a parcela
 * (sem boleto até ser cancelada); passou da data sem baixa, fica atrasada
 * desde ela; a baixa confirma data, valor e forma e vira recebimento.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const ordens = require('./ordens');
const boletos = require('./boletos');
const contas = require('./contasReceber');

const HOJE = '2026-09-24';

function apiFalsa(tabelas) {
  const dados = JSON.parse(JSON.stringify(tabelas));
  let proximoId = 700;
  const tabelaDe = caminho => caminho.replace(/^\/api\//, '').split('/');
  const exigir = tabela => {
    if (dados[tabela]) return dados[tabela];
    const e = new Error(`API respondeu 404 — Tabela '${tabela}' não encontrada.`);
    e.status = 404;
    throw e;
  };
  return {
    dados,
    async get(caminho, { query = {} } = {}) {
      const [tabela, id] = tabelaDe(caminho);
      const linhas = exigir(tabela);
      if (id) return linhas.find(l => String(l.id) === String(id)) || null;
      return linhas.filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
    },
    async post(caminho, corpo) {
      const [tabela] = tabelaDe(caminho);
      const linha = { id: proximoId++, ...corpo };
      exigir(tabela).push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const [tabela, id] = tabelaDe(caminho);
      const linha = exigir(tabela).find(l => String(l.id) === String(id));
      Object.assign(linha, corpo);
      return linha;
    }
  };
}

function tabelas(extra = {}) {
  return {
    pedidos: [{ id: 55, numero: 'PED120', situacao: 'Produção', cliente_id: 7 }],
    pedido_parcelas: [
      { id: 1, pedido_id: 55, numero_parcela: 1, valor: '1000.00', data_vencimento: '2026-10-20' },
      { id: 2, pedido_id: 55, numero_parcela: 2, valor: '1000.00', data_vencimento: '2026-11-20' },
      { id: 3, pedido_id: 55, numero_parcela: 3, valor: '1000.00', data_vencimento: '2026-09-10' }
    ],
    clientes: [], notas_fiscais: [], configuracao_cobranca: [], boletos: [], boletos_eventos: [], boletos_externos: [],
    recebimentos: [], ordens_pagamento: [],
    ...extra
  };
}

test('a data: futura e no máximo o vencimento da parcela; valor e forma conhecida', () => {
  const regra = { hoje: HOJE, vencimentoParcela: '2026-10-20' };
  assert.throws(() => ordens.validarOrdem({ data_prevista: HOJE, valor: 10, forma: 'Pix' }, regra), /data futura/);
  assert.throws(() => ordens.validarOrdem({ data_prevista: '2026-10-21', valor: 10, forma: 'Pix' }, regra), /no máximo até o vencimento da parcela \(20\/10\/2026\)/);
  assert.throws(() => ordens.validarOrdem({ data_prevista: '2026-10-15', valor: 0, forma: 'Pix' }, regra), /valor/);
  assert.throws(() => ordens.validarOrdem({ data_prevista: '2026-10-15', valor: 10, forma: 'Boleto' }, regra), /como o cliente vai pagar/);
  assert.deepEqual(ordens.validarOrdem({ data_prevista: '2026-10-20', valor: '1000', forma: 'Pix', observacao: ' combinado ' }, regra), { data: '2026-10-20', valor: 1000, forma: 'Pix', observacao: 'combinado' });
});

test('criar: não entra em parcela com boleto em aberto, paga ou já com ordem; a parcela com ordem não gera boleto', async () => {
  const api = apiFalsa(tabelas({
    boletos: [{ id: 9, pedido_id: 55, parcela_id: 2, numero_parcela: 2, status: 'registrado', nosso_numero: 'N2', valor: '1000.00' }],
    recebimentos: [{ id: 4, pedido_id: 55, numero_parcela: 3, status: 'confirmado', origem: 'manual', forma: 'Pix', data_recebimento: '2026-09-10' }]
  }));
  const criar = (n, data = '2026-10-15') => ordens.criar({ api, pedidoId: 55, hoje: HOJE, usuarioId: 1, entrada: { numero_parcela: n, data_prevista: data, valor: 1000, forma: 'Cartão de crédito' } });
  await assert.rejects(() => criar(2, '2026-11-10'), /já é cobrada pelo boleto do BB N2: baixe ou estorne o boleto/);
  await assert.rejects(() => criar(3, '2026-09-30'), /no máximo até o vencimento|já tem pagamento/);
  const r = await criar(1);
  assert.deepEqual([r.ordem.data, r.ordem.valor, r.ordem.forma], ['2026-10-15', 1000, 'Cartão de crédito']);
  assert.equal(api.dados.ordens_pagamento[0].status, 'aberta');
  await assert.rejects(() => criar(1), /já tem ordem de pagamento aberta/);

  // A ordem ocupa a parcela: "gerar boletos" responde o motivo.
  const dados = await boletos.lerPedidoCobranca(api, 55);
  const p1 = dados.parcelas.find(p => p.numero_parcela === 1);
  assert.match(boletos.textoDaParcelaComOrdem(p1, boletos.ordemDaParcela(dados.ordens, p1)), /tem ordem de pagamento aberta \(Cartão de crédito para 15\/10\/2026\): cancele-a em "Pagamentos"/);
  assert.deepEqual(boletos.parcelasComBoletos(dados)[0].ordem, { id: api.dados.ordens_pagamento[0].id, data: '2026-10-15', valor: 1000, forma: 'Cartão de crédito', observacao: null, vencida: false });
});

test('a ordem vale como vencimento: prevista até a data dela, atrasada depois (com o dia útil); e fatura o pedido em produção', () => {
  const base = {
    pedidos: [{ id: 55, numero: 'PED120', situacao: 'Produção', cliente_id: 7 }],
    parcelas: [{ id: 1, pedido_id: 55, numero_parcela: 1, valor: '1000.00', data_vencimento: '2026-10-20' }],
    ordens: [{ id: 3, pedido_id: 55, parcela_id: 1, numero_parcela: 1, status: 'aberta', data_prevista: '2026-10-04', valor: '1000.00', forma: 'Pix' }]
  };
  const antes = contas.parcelasDosPedidos({ ...base, hoje: '2026-10-01' });
  assert.deepEqual([antes.length, antes[0].vencimento, antes[0].dias_atraso, antes[0].ordem.forma], [1, '2026-10-04', 0, 'Pix'], 'pedido em produção com ordem entra nas contas');
  // 04/10/2026 é domingo: em dia até segunda 05/10; na terça, 2 dias desde a data da ordem.
  assert.equal(contas.parcelasDosPedidos({ ...base, hoje: '2026-10-05' })[0].dias_atraso, 0);
  assert.equal(contas.parcelasDosPedidos({ ...base, hoje: '2026-10-06' })[0].dias_atraso, 2);
  assert.equal(contas.parcelasDosPedidos({ ...base, ordens: [], hoje: '2026-10-06' }).length, 0, 'sem a ordem, pedido em produção é só previsão');
});

test('baixa (vira recebimento, a ordem fica baixada), cancelamento e pagamento direto que cumpre a ordem', async () => {
  const api = apiFalsa(tabelas());
  const { ordem } = await ordens.criar({ api, pedidoId: 55, hoje: HOJE, usuarioId: 1, entrada: { numero_parcela: 1, data_prevista: '2026-10-15', valor: 1000, forma: 'Pix' } });
  await assert.rejects(() => ordens.baixar({ api, id: ordem.id, hoje: HOJE, entrada: { data_recebimento: '2026-10-15', valor_recebido: 1000, forma: 'Pix' } }), /não pode ser futura/, 'a baixa é o pagamento que entrou: até hoje');
  const baixa = await ordens.baixar({ api, id: ordem.id, hoje: HOJE, usuarioId: 1, entrada: { data_recebimento: HOJE, valor_recebido: 1000, forma: 'Transferência' } });
  assert.deepEqual([baixa.recebimento.origem, baixa.recebimento.forma, baixa.recebimento.numero_parcela], ['manual', 'Transferência', 1]);
  const gravada = api.dados.ordens_pagamento.find(o => o.id === ordem.id);
  assert.deepEqual([gravada.status, gravada.recebimento_id], ['baixada', baixa.recebimento.id]);
  await assert.rejects(() => ordens.baixar({ api, id: ordem.id, hoje: HOJE, entrada: {} }), /já foi baixada/);

  const segunda = (await ordens.criar({ api, pedidoId: 55, hoje: HOJE, entrada: { numero_parcela: 2, data_prevista: '2026-11-01', valor: 1000, forma: 'Pix' } })).ordem;
  await ordens.cancelar({ api, id: segunda.id, motivo: 'cliente vai pagar por boleto' });
  assert.equal(api.dados.ordens_pagamento.find(o => o.id === segunda.id).status, 'cancelada');

  // Pagamento registrado direto na parcela com ordem aberta: a ordem se cumpre.
  const terceira = (await ordens.criar({ api, pedidoId: 55, hoje: HOJE, entrada: { numero_parcela: 2, data_prevista: '2026-11-10', valor: 1000, forma: 'Pix' } })).ordem;
  const cumprida = await ordens.baixarPelaParcela(api, { id: 99, pedido_id: 55, numero_parcela: 2 });
  assert.equal(cumprida.id, terceira.id);
  assert.deepEqual([api.dados.ordens_pagamento.find(o => o.id === terceira.id).status, api.dados.ordens_pagamento.find(o => o.id === terceira.id).recebimento_id], ['baixada', 99]);
});
