/**
 * Contas a receber (backend/cobranca/contasReceber.js): o estado de cada
 * parcela de pedido faturado (recebida, cancelada, a receber, em atraso), o
 * corte de "controlar a partir de", o vencimento do boleto prorrogado, as
 * visões da tela e o resumo com as pendências de cobrança.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const contas = require('./contasReceber');

const HOJE = '2026-09-16';

function base() {
  return {
    pedidos: [
      { id: 1, numero: 'PED100', situacao: 'Enviado', cliente_id: 7 },
      { id: 2, numero: 'PED101', situacao: 'Produção', cliente_id: 8 },
      { id: 3, numero: 'PED102', situacao: 'Cancelado', cliente_id: 7 },
      { id: 4, numero: 'PED103', situacao: 'Produção', cliente_id: 8 },
      { id: 5, numero: 'PED104', situacao: 'Entregue', cliente_id: 9 }
    ],
    parcelas: [
      { id: 11, pedido_id: 1, numero_parcela: 1, valor: '1000.00', data_vencimento: '2026-08-20' },
      { id: 12, pedido_id: 1, numero_parcela: 2, valor: '1000.00', data_vencimento: '2026-09-10' },
      { id: 13, pedido_id: 1, numero_parcela: 3, valor: '1000.00', data_vencimento: '2026-09-25' },
      { id: 14, pedido_id: 1, numero_parcela: 4, valor: '1000.00', data_vencimento: '2026-10-25' },
      { id: 21, pedido_id: 2, numero_parcela: 1, valor: '500.00', data_vencimento: '2026-09-20' },
      { id: 31, pedido_id: 3, numero_parcela: 1, valor: '800.00', data_vencimento: '2026-09-01' },
      { id: 41, pedido_id: 4, numero_parcela: 1, valor: '300.00', data_vencimento: '2026-09-05' },
      { id: 51, pedido_id: 5, numero_parcela: 1, valor: '200.00', data_vencimento: '2026-09-12' },
      { id: 52, pedido_id: 5, numero_parcela: 2, valor: '200.00', data_vencimento: '2026-09-13' },
      { id: 53, pedido_id: 5, numero_parcela: 3, valor: '200.00', data_vencimento: '2026-07-01' }
    ],
    boletos: [
      // Parcela 3 do PED100: boleto prorrogado, com abatimento.
      { id: 101, pedido_id: 1, parcela_id: 13, numero_parcela: 3, status: 'registrado', data_vencimento: '2026-09-30', valor_abatimento: '100.00', nosso_numero: 'N3', ambiente: 'sandbox' },
      // Parcela 2 do PED100: pago no banco, ainda sem lançamento.
      { id: 102, pedido_id: 1, parcela_id: 12, numero_parcela: 2, status: 'pago', data_vencimento: '2026-09-10', nosso_numero: 'N2' },
      // PED103 em produção mas com boleto (faturado mesmo assim), recusado pelo BB.
      { id: 103, pedido_id: 4, parcela_id: 41, numero_parcela: 1, status: 'erro', erro: '4678420 — campo inválido', nosso_numero: 'N4' },
      // PED104: parcela 1 cancelada, parcela 2 quitada por fora.
      { id: 104, pedido_id: 5, parcela_id: 51, numero_parcela: 1, status: 'baixado', motivo_baixa: 'cancelado', nosso_numero: 'N5' },
      { id: 105, pedido_id: 5, parcela_id: 52, numero_parcela: 2, status: 'baixado', motivo_baixa: 'quitado_por_fora', nosso_numero: 'N6' }
    ],
    recebimentos: [
      { id: 1, pedido_id: 1, numero_parcela: 1, status: 'confirmado', data_recebimento: '2026-09-02', valor_parcela: '1000.00', valor_abatimento: '0', valor_recebido: '1000.00', valor_encargos: '0', competencia: '2026-09', forma: 'Pix', origem: 'manual', nota_fiscal_id: 90 },
      { id: 2, pedido_id: 5, numero_parcela: 2, status: 'confirmado', data_recebimento: '2026-08-30', valor_parcela: '200.00', valor_abatimento: '0', valor_recebido: '200.00', valor_encargos: '0', competencia: '2026-08', forma: 'Dinheiro', origem: 'quitado_por_fora', boleto_id: 105 },
      { id: 3, pedido_id: 1, numero_parcela: 4, status: 'estornado', data_recebimento: '2026-09-03', valor_parcela: '1000.00', valor_abatimento: '0', valor_recebido: '1000.00', valor_encargos: '0', competencia: '2026-09', origem: 'manual', motivo_estorno: 'engano' },
      { id: 4, pedido_id: 1, numero_parcela: 9, status: 'confirmado', data_recebimento: '2026-09-05', valor_parcela: '50.00', valor_abatimento: '0', valor_recebido: '52.30', valor_encargos: '2.30', competencia: '2026-09 ', origem: 'boleto' }
    ],
    notas: [{ id: 90, pedido_id: 1, serie: 1, numero: 7, status_fiscal: 'autorizada' }],
    clientes: [{ id: 7, nome_fantasia: 'Cliente Bom' }]
  };
}

test('estado de cada parcela: recebida, cancelada, a receber, atraso pelo vencimento do boleto; pedido em produção e cancelado ficam fora', () => {
  const linhas = contas.parcelasDosPedidos({ ...base(), hoje: HOJE, desde: '2026-08-01' });
  const chave = l => `${l.pedido}/${l.numero_parcela}`;
  assert.deepEqual(linhas.map(chave), ['PED100/1', 'PED100/2', 'PED100/3', 'PED100/4', 'PED103/1', 'PED104/1', 'PED104/2', 'PED104/3']);
  const por = Object.fromEntries(linhas.map(l => [chave(l), l]));

  assert.deepEqual([por['PED100/1'].estado, por['PED100/1'].recebimento.forma, por['PED100/1'].lancamento_pendente, por['PED100/1'].nf, por['PED100/1'].cliente], ['recebida', 'Pix', false, '1/7', 'Cliente Bom']);
  assert.deepEqual([por['PED100/2'].estado, por['PED100/2'].lancamento_pendente, por['PED100/2'].dias_atraso], ['recebida', true, 0], 'pago no banco sem lançamento');
  const p3 = por['PED100/3'];
  assert.deepEqual([p3.estado, p3.vencimento, p3.valor, p3.abatimento, p3.a_receber, p3.dias_atraso, p3.parcela], ['a_receber', '2026-09-30', 1000, 100, 900, 0, '3/4'], 'vence na data do boleto prorrogado');
  assert.deepEqual([por['PED100/4'].estado, por['PED100/4'].recebimento], ['a_receber', null], 'o estornado não conta');
  assert.deepEqual([por['PED103/1'].estado, por['PED103/1'].dias_atraso, por['PED103/1'].boleto.erro], ['a_receber', 11, '4678420 — campo inválido'], 'boleto (mesmo com erro) fatura o pedido em produção');
  assert.equal(por['PED104/1'].estado, 'cancelada');
  assert.equal(por['PED104/2'].estado, 'recebida');
  assert.deepEqual([por['PED104/3'].estado, por['PED104/3'].controlada, por['PED104/3'].dias_atraso], ['a_receber', false, 77], 'antes do corte: fora do controle');
});

test('visões e resumo da competência: recebidos (com estornados), a receber do mês, em atraso só do controle, pendências', () => {
  const b = base();
  const linhas = contas.parcelasDosPedidos({ ...b, hoje: HOJE, desde: '2026-08-01' });
  const recebidos = contas.recebidosDaCompetencia({ ...b, competencia: '2026-09' });
  assert.deepEqual(recebidos.map(r => [r.id, r.status, r.pedido, r.nf]), [[4, 'confirmado', 'PED100', null], [3, 'estornado', 'PED100', null], [1, 'confirmado', 'PED100', '1/7']]);
  assert.equal(recebidos[1].motivo_estorno, 'engano');

  const v = contas.visoes({ linhas, recebidos, competencia: '2026-09' });
  assert.deepEqual(v.a_receber.map(l => `${l.pedido}/${l.numero_parcela}`), ['PED103/1', 'PED100/3']);
  assert.deepEqual(v.em_atraso.map(l => `${l.pedido}/${l.numero_parcela}`), ['PED103/1']);
  assert.deepEqual(v.abertas.map(l => `${l.pedido}/${l.numero_parcela}`), ['PED103/1', 'PED100/3', 'PED100/4', 'PED104/3'], 'as controladas primeiro, por vencimento');

  const alertas = [{ mensagem: 'O BB avisou pagamento de um boleto já baixado aqui', quando: '2026-09-15' }];
  const r = contas.resumir({ linhas, recebidos, competencia: '2026-09', desde: '2026-08-01', fila: 2, alertas, hoje: HOJE });
  assert.deepEqual(r.recebido, { quantidade: 2, total: 1052.3, encargos: 2.3, estornados: 1 });
  assert.deepEqual(r.a_receber, { quantidade: 2, total: 1200 });
  assert.deepEqual(r.em_atraso, { quantidade: 1, total: 300, mais_antigo: '2026-09-05', dias_max: 11, em_dia: 300, encargos: 0 });
  assert.deepEqual(r.boletos_abertos, { quantidade: 1, total: 900 });
  assert.deepEqual(r.a_conciliar, { fila: 2, lancamentos: 1, alertas: 1 }, 'só o PED100/2: a quitação do PED104 já tem recebimento');
  assert.deepEqual(r.pendencias.map(p => [p.chave, p.nivel, p.destino]), [
    ['em_atraso', 'normal', 'recebimentos-atraso'],
    ['conciliar', 'normal', 'conciliar'],
    ['alertas', 'critico', 'recebimentos-recebidos'],
    ['boletos_erro', 'critico', 'recebimentos-a-receber']
  ]);
  assert.equal(r.pendencias[0].titulo, '1 parcela vencida sem recebimento');
  assert.match(r.pendencias[0].descricao, /Total: R\$\s300,00 · mais antiga venceu em 05\/09\/2026$/);
  assert.equal(r.pendencias[1].descricao, '2 avisos de pagamento do BB na fila · 1 boleto pago ainda não lançado');
  assert.match(r.pendencias[3].descricao, /Pedido PED103, parcela 1: 4678420/);

  // Atraso acima de 15 dias é crítico e avisa que o boleto não é mais aceito; SQL pendente vem primeiro.
  const tarde = contas.resumir({ linhas, recebidos: [], competencia: '2026-09', desde: '2026-08-01', hoje: '2026-10-01', sqlPendente: true });
  assert.equal(tarde.pendencias[0].chave, 'recebimentos_sql');
  assert.equal(tarde.pendencias[0].destino, 'configuracao-cobranca');
  assert.deepEqual(contas.resumir({ linhas: contas.parcelasDosPedidos({ ...b, hoje: '2026-10-01', desde: '2026-08-01' }), recebidos: [], competencia: '2026-10', desde: '2026-08-01', hoje: '2026-10-01' }).pendencias[0].nivel, 'critico');
  assert.equal(contas.competenciaValida('2026-13', HOJE), '2026-09');
  assert.equal(contas.competenciaValida('2026-10', HOJE), '2026-10');
});

test('carregar: lê a base (sem XML das notas), conta a fila e os alertas recentes, e devolve a visão com os nomes', async () => {
  const b = base();
  const tabelas = {
    pedidos: b.pedidos, pedido_parcelas: b.parcelas, boletos: b.boletos, recebimentos: b.recebimentos, clientes: [...b.clientes, { id: 9, razao_social: 'Outro LTDA' }, { id: 8, nome: 'Terceiro' }],
    notas_fiscais: b.notas.map(n => ({ ...n, xml_autorizado: '<xml/>' })),
    boletos_eventos: [
      { id: 1, origem: 'webhook', processado_em: null },
      { id: 2, origem: 'webhook', processado_em: '2026-09-15T10:00:00Z', boleto_id: 105, erro_processamento: 'pagamento em dobro?', criado_em: '2026-09-15T10:00:00Z' },
      { id: 3, origem: 'webhook', processado_em: '2026-06-01T10:00:00Z', boleto_id: 105, erro_processamento: 'velho', criado_em: '2026-06-01T10:00:00Z' },
      { id: 4, origem: 'webhook', processado_em: '2026-09-15T10:00:00Z', boleto_id: null, erro_processamento: 'não é deste sistema', criado_em: '2026-09-15T10:00:00Z' }
    ]
  };
  const pedidosFeitos = [];
  const api = {
    async get(caminho, { query = {} } = {}) {
      pedidosFeitos.push(caminho);
      const tabela = caminho.replace('/api/', '');
      return (tabelas[tabela] || []).filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
    }
  };
  const painel = await contas.carregarPainel({ api, competencia: '2026-09', hoje: HOJE, desde: '2026-08-01' });
  assert.deepEqual(painel.a_conciliar, { fila: 1, lancamentos: 1, alertas: 1 });
  assert.equal(painel.pendencias.find(p => p.chave === 'alertas').descricao, 'pagamento em dobro?');
  assert.ok(!pedidosFeitos.includes('/api/clientes'), 'o painel não lê clientes');

  const visao = await contas.carregarVisao({ api, competencia: '2026-09', visao: 'abertas', hoje: HOJE, desde: '2026-08-01' });
  assert.deepEqual(visao.linhas.map(l => l.cliente), ['Terceiro', 'Cliente Bom', 'Cliente Bom', 'Outro LTDA']);
  assert.equal(visao.resumo.em_atraso.quantidade, 1);
  await assert.rejects(() => contas.carregarVisao({ api, competencia: '2026-09', visao: 'tudo', hoje: HOJE }), /Visão desconhecida/);

  const semTabela = { async get(caminho) { if (caminho === '/api/recebimentos') throw Object.assign(new Error("Tabela 'recebimentos' não encontrada."), { status: 404 }); return api.get(caminho); } };
  const p2 = await contas.carregarPainel({ api: semTabela, competencia: '2026-09', hoje: HOJE, desde: null });
  assert.equal(p2.sql_pendente, true);
  assert.equal(p2.pendencias[0].chave, 'recebimentos_sql');
});

test('vencimento em fim de semana ou feriado: em dia até o próximo dia útil; depois, o atraso conta desde o vencimento (dono, 24/09/2026)', async () => {
  const b = base();
  // A parcela 4 do PED100 (sem boleto) passa a vencer no domingo 20/09.
  b.parcelas.find(p => p.id === 14).data_vencimento = '2026-09-20';
  const linha = (hoje, feriados) => contas.parcelasDosPedidos({ ...b, hoje, feriados }).find(l => l.pedido === 'PED100' && l.numero_parcela === 4);
  assert.equal(linha('2026-09-21').dias_atraso, 0, 'segunda: ainda em dia');
  assert.equal(linha('2026-09-22').dias_atraso, 2, 'terça: 2 dias desde o domingo');
  assert.equal(linha('2026-09-23').dias_atraso, 3, 'quarta: 3 dias desde 20/09');
  assert.equal(linha('2026-09-22', [{ data: '2026-09-21', descricao: 'Feriado municipal' }]).dias_atraso, 0, 'com a segunda feriado (cadastrado), vale até terça');

  // Os feriados vêm da tabela do Financeiro; sem ela, só os nacionais.
  assert.deepEqual(await contas.lerFeriados({ get: async () => [{ data: '2026-09-21T00:00:00.000Z', descricao: 'Municipal' }, { data: null }] }), [{ data: '2026-09-21', descricao: 'Municipal' }]);
  assert.deepEqual(await contas.lerFeriados({ get: async () => { throw new Error('404'); } }), []);
});

test('pagamento registrado (Pix, cartão…) fatura o pedido ainda em produção: a parcela entra nas contas e na comissão', () => {
  const b = base();
  b.recebimentos.push({ id: 9, pedido_id: 2, numero_parcela: 1, status: 'confirmado', data_recebimento: '2026-09-15', valor_parcela: '500.00', valor_abatimento: '0', valor_recebido: '500.00', valor_encargos: '0', competencia: '2026-09', forma: 'Cartão de crédito', origem: 'manual' });
  const l = contas.parcelasDosPedidos({ ...b, hoje: HOJE }).find(x => x.pedido === 'PED101');
  assert.deepEqual([l.estado, l.recebimento.forma, l.recebimento.competencia], ['recebida', 'Cartão de crédito', '2026-09']);
  // O estornado não conta: o pedido volta a ser só previsão.
  b.recebimentos[b.recebimentos.length - 1].status = 'estornado';
  assert.ok(!contas.parcelasDosPedidos({ ...b, hoje: HOJE }).some(x => x.pedido === 'PED101'));
});
