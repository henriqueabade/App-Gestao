/**
 * Conciliação com o BB (backend/cobranca/conciliacao.js): o aviso do webhook
 * lido nos formatos que o BB usa; a fila casando o aviso com o boleto
 * (pagamento → boleto pago + recebimento; cancelamento → estorno; boleto já
 * baixado → alerta de pagamento em dobro; nosso número de fora → ignorado;
 * erro → fica na fila); e a conciliação inteira com a consulta dos boletos
 * a pagar e o acerto dos pagos sem recebimento.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const conc = require('./conciliacao');

const HOJE = '2026-09-16';
const CONEXAO = { ambiente: 'sandbox', appKey: 'k', credenciais: { clientId: 'c', clientSecret: 's' } };
const COLUNAS_D = { valor_abatimento: '0.00', vencimento_original: null, motivo_baixa: null, observacao_baixa: null, data_baixa: null, baixado_por: null, substitui_boleto_id: null, sincronizado_em: null };

function boleto(extra) {
  return {
    pedido_id: 55, nota_fiscal_id: 10, ambiente: 'sandbox', convenio: '3128557', carteira: 17, variacao: 35, valor: '1000.00',
    data_emissao: '2026-09-16', data_vencimento: '2026-10-18', status: 'registrado', data_pagamento: null, valor_pago: null, canal_pagamento: null,
    ...COLUNAS_D, ...extra
  };
}

function apiFalsa(tabelas) {
  const dados = JSON.parse(JSON.stringify(tabelas));
  let proximoId = 900;
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
      const [tabela] = tabelaDe(caminho);
      return exigir(tabela).filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
    },
    async post(caminho, corpo) {
      const [tabela] = tabelaDe(caminho);
      const linhas = exigir(tabela);
      if (tabela === 'recebimentos' && linhas.some(l => l.status === 'confirmado' && l.pedido_id === corpo.pedido_id && l.numero_parcela === corpo.numero_parcela)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "recebimentos_parcela_confirmada"'), { status: 500 });
      }
      const linha = { id: proximoId++, ...corpo };
      linhas.push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const [tabela, id] = tabelaDe(caminho);
      const linha = exigir(tabela).find(l => String(l.id) === String(id));
      if (!linha) throw Object.assign(new Error('não há'), { status: 404 });
      Object.assign(linha, corpo);
      return linha;
    }
  };
}

const aviso = (id, payload, extra = {}) => ({ id, boleto_id: null, origem: 'webhook', tipo: 'baixa_operacional', nosso_numero: payload.id || null, payload, processado_em: null, erro_processamento: null, criado_em: '2026-09-16T12:00:00Z', ...extra });

test('lerAviso: nosso número, convênio, data e valor nos formatos do BB; cancelamento pelo código', () => {
  const a = conc.lerAviso(aviso(1, {
    id: '00031285570000000001', numeroConvenio: 3128557, codigoEstadoBaixaOperacional: 1, dataLiquidacao: '20.09.2026 10:15:00',
    valorPagoSacado: '1.012,50', canalLiquidacao: 61, formaPagamento: 1, instituicaoLiquidacao: 'BB'
  }));
  assert.deepEqual(a, { nossoNumero: '00031285570000000001', convenio: '3128557', codigo: 1, cancelamento: false, data: '2026-09-20', valor: 1012.5, canal: 'Pix', forma: 'espécie', instituicao: 'BB' });
  const texto = conc.lerAviso(aviso(2, JSON.stringify({ numeroTituloCliente: '00031285570000000002', codigoEstadoBaixaOperacional: '10', dataAgendamento: '2026-09-21', valorPagoSacado: 99.9 })));
  assert.deepEqual([texto.nossoNumero, texto.cancelamento, texto.data, texto.valor, texto.convenio], ['00031285570000000002', true, '2026-09-21', 99.9, null]);
  assert.equal(conc.lerAviso(aviso(3, { id: '1', estadoBaixaOperacional: 'Cancelamento de baixa' })).cancelamento, true);
  assert.equal(conc.lerAviso({ id: 4, nosso_numero: '00031285570000000009', payload: null }).nossoNumero, '00031285570000000009');
  assert.equal(conc.dataFlexivel('31/02/2026'), null);
  assert.equal(conc.dataFlexivel('20/09/2026'), '2026-09-20');
  assert.equal(conc.numeroFlexivel('abc'), null);
  assert.equal(conc.numeroFlexivel(''), null);
});

test('fila: pagamento vira boleto pago + recebimento; cancelamento estorna; já baixado vira alerta; de fora é ignorado; erro fica na fila', async () => {
  const api = apiFalsa({
    boletos: [
      boleto({ id: 41, numero_parcela: 1, parcela_id: 1, nosso_numero: '00031285570000000001' }),
      boleto({ id: 42, numero_parcela: 2, parcela_id: 2, nosso_numero: '00031285570000000002', status: 'pago', data_pagamento: '2026-09-10', valor_pago: '1000.00', data_vencimento: '2026-09-15' }),
      boleto({ id: 43, numero_parcela: 3, parcela_id: 3, nosso_numero: '00031285570000000003', status: 'baixado', motivo_baixa: 'quitado_por_fora' }),
      boleto({ id: 44, numero_parcela: 4, parcela_id: 4, nosso_numero: '00031285570000000004', convenio: '3453481', ambiente: 'producao' })
    ],
    recebimentos: [{ id: 1, pedido_id: 55, numero_parcela: 2, boleto_id: 42, origem: 'boleto', status: 'confirmado', valor_recebido: '1000.00', chave_idempotencia: 'boleto:42:1' }],
    boletos_eventos: [
      aviso(10, { id: '00031285570000000001', numeroConvenio: 3128557, codigoEstadoBaixaOperacional: 1, dataLiquidacao: '15.09.2026', valorPagoSacado: 1003, canalLiquidacao: 61 }),
      aviso(11, { id: '00031285570000000002', numeroConvenio: 3128557, codigoEstadoBaixaOperacional: 10 }),
      aviso(12, { id: '00031285570000000003', numeroConvenio: 3128557, codigoEstadoBaixaOperacional: 1, valorPagoSacado: 1000 }),
      aviso(13, { id: '00031285579999999999', numeroConvenio: 3128557, codigoEstadoBaixaOperacional: 1 }),
      aviso(14, { id: '00031285570000000004', numeroConvenio: 3128557, codigoEstadoBaixaOperacional: 1 }, { erro_processamento: null }),
      aviso(15, { codigoEstadoBaixaOperacional: 1 }),
      aviso(9, { id: '00031285570000000001' }, { processado_em: '2026-09-15T10:00:00Z' }),
      { id: 16, origem: 'app', tipo: 'registrado', processado_em: null }
    ]
  });
  const r = await conc.processarFila({ api, hoje: HOJE, usuarioId: 3 });
  assert.deepEqual([r.lidos, r.pagos, r.cancelados, r.alertas, r.ignorados, r.erros], [6, 1, 1, 1, 3, 0], JSON.stringify(r));

  const [b41, b42, b43] = api.dados.boletos;
  assert.deepEqual([b41.status, b41.data_pagamento, b41.valor_pago, b41.canal_pagamento, b41.situacao_bb], ['pago', '2026-09-15', 1003, 'Pix', 'BAIXA OPERACIONAL']);
  const novo = api.dados.recebimentos.find(x => x.boleto_id === 41);
  assert.deepEqual([novo.origem, novo.data_recebimento, novo.valor_recebido, novo.valor_encargos, novo.evento_id, novo.competencia], ['boleto', '2026-09-15', 1003, 3, 10, '2026-09']);

  assert.deepEqual([b42.status, b42.data_pagamento, b42.valor_pago], ['vencido', null, null], 'cancelado: volta a cobrar (vencido pela data)');
  assert.equal(api.dados.recebimentos.find(x => x.id === 1).status, 'estornado');
  assert.equal(b43.status, 'baixado', 'baixado continua baixado');
  assert.match(r.mensagens[0], /já baixado aqui \(quitado por fora\): confira, pode ser pagamento em dobro/);

  const ev = id => api.dados.boletos_eventos.find(e => e.id === id);
  assert.deepEqual([ev(10).boleto_id, Boolean(ev(10).processado_em), ev(10).erro_processamento], [41, true, null]);
  assert.deepEqual([ev(11).boleto_id, Boolean(ev(11).processado_em)], [42, true]);
  assert.deepEqual([ev(12).boleto_id, Boolean(ev(12).processado_em)], [43, true]);
  assert.match(ev(12).erro_processamento, /pagamento em dobro/);
  assert.match(ev(13).erro_processamento, /não é de um boleto deste sistema/);
  assert.match(ev(14).erro_processamento, /não é de um boleto deste sistema/, 'convênio diferente não casa');
  assert.match(ev(15).erro_processamento, /sem nosso número/);
  assert.equal(ev(9).processado_em, '2026-09-15T10:00:00Z', 'o já processado não é mexido');
  const tipos = api.dados.boletos_eventos.filter(e => e.origem === 'webhook' && e.boleto_id !== null && e.tipo !== 'baixa_operacional').map(e => e.tipo);
  assert.deepEqual(tipos, ['pago', 'pagamento_cancelado', 'alerta']);

  // Repetir não faz nada: a fila está vazia.
  const vazia = await conc.processarFila({ api, hoje: HOJE });
  assert.equal(vazia.lidos, 0);

  // Aviso de pagamento com a tabela de recebimentos ausente: o boleto fica pago e o aviso fica na fila com o erro.
  const semTabela = apiFalsa({ boletos: [boleto({ id: 41, numero_parcela: 1, nosso_numero: '00031285570000000001' })], boletos_eventos: [aviso(20, { id: '00031285570000000001', codigoEstadoBaixaOperacional: 1 })] });
  const r2 = await conc.processarFila({ api: semTabela, hoje: HOJE });
  assert.equal(r2.erros, 1);
  assert.equal(semTabela.dados.boletos[0].status, 'pago');
  assert.equal(semTabela.dados.boletos_eventos[0].processado_em, null);
  assert.match(semTabela.dados.boletos_eventos[0].erro_processamento, /sql\/cobranca_recebimentos\.sql/);
});

test('conciliar: fila, consulta dos a pagar (mais antigos primeiro, com limite), acerto dos pagos sem recebimento; só a fila; SQL pendente', async () => {
  const api = apiFalsa({
    pedidos: [{ id: 55, numero: 'PED120', situacao: 'Enviado' }], pedido_parcelas: [], notas_fiscais: [], clientes: [], configuracao_cobranca: [],
    boletos: [
      boleto({ id: 41, numero_parcela: 1, nosso_numero: '00031285570000000001', sincronizado_em: '2026-09-16T10:00:00Z' }),
      boleto({ id: 42, numero_parcela: 2, nosso_numero: '00031285570000000002', sincronizado_em: null }),
      boleto({ id: 43, numero_parcela: 3, nosso_numero: '00031285570000000003', status: 'pago', data_pagamento: '2026-09-01', valor_pago: '1000.00' }),
      boleto({ id: 44, numero_parcela: 4, nosso_numero: '00031285570000000004', status: 'baixado', motivo_baixa: 'quitado_por_fora', data_pagamento: '2026-09-02', valor_pago: '900.00', canal_pagamento: 'Fora do boleto · Dinheiro', observacao_baixa: 'pago no balcão' }),
      boleto({ id: 45, numero_parcela: 5, nosso_numero: '00031285570000000005', ambiente: 'producao' })
    ],
    recebimentos: [],
    boletos_eventos: []
  });
  const consultados = [];
  const bb = {
    async chamar({ caminho }) {
      consultados.push(caminho);
      if (caminho.endsWith('0002')) return { codigoEstadoTituloCobranca: 6, dataRecebimentoTitulo: '14.09.2026', valorPagoSacado: 1000, codigoCanalPagamento: 161 };
      return { codigoEstadoTituloCobranca: 1, dataVencimentoTituloCobranca: '18.10.2026' };
    }
  };
  const conexao = async ambiente => { if (ambiente === 'producao') throw new Error('Este boleto é de produção, mas a cobrança está em homologação.'); return CONEXAO; };

  const soFila = await conc.conciliar({ api, bb, conexao, hoje: HOJE, soFila: true });
  assert.equal(consultados.length, 0, 'só a fila não chama o BB');
  assert.equal(soFila.sql_pendente, false);

  const r = await conc.conciliar({ api, bb, conexao, hoje: HOJE, usuarioId: 3, limiteConsultas: 2 });
  // Limite 2: os nunca consultados (42 e 45) antes do 41; o de produção falha antes de chamar o BB.
  assert.deepEqual(consultados, ['/boletos/00031285570000000002']);
  assert.deepEqual([r.consultas.consultados, r.consultas.mudaram, r.consultas.pagos, r.consultas.erros], [1, 1, 1, 1]);
  assert.match(r.consultas.mensagens.join(' '), /é de produção/);
  assert.equal(r.acerto.lancados, 2, JSON.stringify(r.acerto));
  const porBoleto = id => api.dados.recebimentos.find(x => x.boleto_id === id);
  assert.deepEqual([porBoleto(42).origem, porBoleto(42).canal, porBoleto(42).data_recebimento], ['boleto', 'Pix', '2026-09-14']);
  assert.deepEqual([porBoleto(43).origem, porBoleto(43).valor_recebido], ['boleto', 1000]);
  assert.deepEqual([porBoleto(44).origem, porBoleto(44).forma, porBoleto(44).valor_recebido, porBoleto(44).observacao, porBoleto(44).data_recebimento], ['quitado_por_fora', 'Dinheiro', 900, 'pago no balcão', '2026-09-02']);
  assert.equal(api.dados.recebimentos.length, 3);

  // De novo: nada novo.
  const r2 = await conc.conciliar({ api, bb, conexao, hoje: HOJE, limiteConsultas: 5 });
  assert.equal(r2.acerto.lancados, 0);
  assert.equal(api.dados.recebimentos.length, 3);

  const semTabela = apiFalsa({ boletos: [], boletos_eventos: [] });
  const r3 = await conc.conciliar({ api: semTabela, bb, conexao, hoje: HOJE });
  assert.equal(r3.sql_pendente, true);
});
