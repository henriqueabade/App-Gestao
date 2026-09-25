/**
 * Boleto com o VALOR CHEIO e desconto até o vencimento (decisões do dono,
 * 25/09/2026 — backend/cobranca/descontoCondicional.js).
 *
 * O exemplo do dono: pedido cheio R$ 10.000 com R$ 500 de desconto = R$ 9.500
 * em 2 × 4.750. Cada boleto sai com R$ 5.000 e "desconto de R$ 250 até o
 * vencimento"; pagou em dia, R$ 4.750; venceu, R$ 5.000 + multa e juros sobre
 * os 5.000. A comissão fica nos 4.750; o que passar é encargo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const dc = require('./descontoCondicional');
const bb = require('./bbBoleto');
const configuracao = require('./configuracaoCobranca');
const boletos = require('./boletos');
const recebimentos = require('./recebimentos');
const contasReceber = require('./contasReceber');
const vencimentos = require('./vencimento');
const op = require('./boletoOperacoes');
const pedidoParcelas = require('../pedidoParcelas');

// Mesa: 2 × 2.500 com R$ 500 de desconto; Cadeira: 1 × 5.000 sem desconto.
const ITENS = [
  { id: 1, pedido_id: 55, codigo: 'MESA', quantidade: 2, valor_unitario: 2500, valor_total: 4500 },
  { id: 2, pedido_id: 55, codigo: 'CAD', quantidade: 1, valor_unitario: 5000, valor_total: 5000 }
];
const PEDIDO = { id: 55, numero: '2548', situacao: 'Enviado', cliente_id: 7, valor_final: 9500 };
const PARCELAS = [
  { id: 1, pedido_id: 55, numero_parcela: 1, valor: 4750, data_vencimento: '2027-01-18' },
  { id: 2, pedido_id: 55, numero_parcela: 2, valor: 4750, data_vencimento: '2027-02-17' }
];
const CFG = {
  id: 1, ambiente: 'sandbox', convenio: '3453481', carteira: 17, variacao: 19, especie: 'DM', aceite: false, juros_tipo: 'valor_dia', juros_percentual_mes: 9,
  multa_percentual: 2, multa_dias: 1, protesto_dias: 7, negativacao_dias: null, dias_limite_recebimento: 15, desconto_percentual: 1, desconto_dias: 5,
  indicador_pix: true, proximo_sequencial_sandbox: 1, proximo_sequencial_producao: 394
};
const CLIENTE = { id: 7, tipo_pessoa: 'PJ', razao_social: 'Cliente Bom LTDA', cnpj: '11222333000181', reg_logradouro: 'Rua Diamante', reg_numero: '504', reg_bairro: 'São Joaquim', reg_cidade: 'Contagem', reg_uf: 'Minas Gerais', reg_cep: '32113000' };

// ------------------------------------------------------------------ puras

test('o desconto do pedido é o da NF-e (itens + ajuste para menos) e se reparte pelas parcelas', () => {
  assert.deepEqual(
    (({ desconto, valor_pedido, valor_cheio }) => ({ desconto, valor_pedido, valor_cheio }))(dc.descontoDoPedido({ pedido: PEDIDO, itens: ITENS })),
    { desconto: 500, valor_pedido: 9500, valor_cheio: 10000 }
  );
  assert.deepEqual([...dc.descontosDasParcelas({ pedido: PEDIDO, itens: ITENS, parcelas: PARCELAS })], [[1, 250], [2, 250]]);

  // Três parcelas: os centavos que sobram ficam na última e a soma fecha.
  const tres = [{ numero_parcela: 1, valor: 3166.67 }, { numero_parcela: 2, valor: 3166.67 }, { numero_parcela: 3, valor: 3166.66 }];
  const mapa = dc.descontosDasParcelas({ pedido: PEDIDO, itens: ITENS, parcelas: tres });
  assert.deepEqual([...mapa.values()], [166.67, 166.67, 166.66]);

  // Adicional entra no cheio (não é desconto); Desconto do ajuste soma ao desconto.
  const adicional = dc.descontoDoPedido({ pedido: { ...PEDIDO, ajuste_valor: 300, valor_final: 9800 }, itens: ITENS });
  assert.deepEqual([adicional.desconto, adicional.valor_pedido, adicional.valor_cheio], [500, 9800, 10300]);
  const menos = dc.descontoDoPedido({ pedido: { ...PEDIDO, ajuste_valor: -200, valor_final: 9300 }, itens: ITENS });
  assert.deepEqual([menos.desconto, menos.valor_pedido, menos.valor_cheio], [700, 9300, 10000]);

  // Sem desconto, o boleto é a parcela.
  const cheios = ITENS.map(i => ({ ...i, valor_total: i.quantidade * i.valor_unitario }));
  assert.equal(dc.descontoDoPedido({ pedido: PEDIDO, itens: cheios }), null);
  assert.equal(dc.descontosDasParcelas({ pedido: PEDIDO, itens: cheios, parcelas: PARCELAS }).size, 0);
  assert.equal(dc.descontosDasParcelas({ pedido: PEDIDO, itens: [], parcelas: PARCELAS }).size, 0, 'sem itens, sem conta');
});

const BOLETO = {
  id: 41, pedido_id: 55, parcela_id: 1, numero_parcela: 1, status: 'registrado', valor: '5000.00', valor_desconto: '250.00', desconto_ate: '2027-01-18',
  valor_abatimento: '0.00', data_vencimento: '2027-01-18', juros_valor_dia: '15.00', juros_percentual_mes: '9.000', multa_percentual: '2.00', nosso_numero: '00034534810000000001'
};

test('em dia o boleto cobra 4.750; vencido, 5.000 + multa (2% de 5.000) + juros por dia sobre os 5.000', () => {
  assert.equal(dc.valorEmDia(BOLETO), 4750);
  assert.deepEqual(dc.devidoHoje({ boleto: BOLETO, hoje: '2027-01-18' }), { dias: 0, em_dia: 4750, desconto_perdido: 0, multa: 0, juros: 0, encargos: 0, total: 4750 });
  assert.deepEqual(dc.devidoHoje({ boleto: BOLETO, hoje: '2027-01-21' }), { dias: 3, em_dia: 4750, desconto_perdido: 250, multa: 100, juros: 45, encargos: 395, total: 5145 });
  // Vencimento no sábado: em dia até segunda.
  const sabado = { ...BOLETO, data_vencimento: '2027-01-16' };
  assert.equal(dc.devidoHoje({ boleto: sabado, hoje: '2027-01-18' }).total, 4750);
  // Boleto antigo, sem desconto: vencido cobra o valor + multa + juros.
  assert.equal(dc.devidoHoje({ boleto: { ...BOLETO, valor: '4750.00', valor_desconto: null, juros_valor_dia: '14.25' }, hoje: '2027-01-21' }).total, 4887.75);
});

test('a sugestão de multa e juros (pagamento à mão) também perde o desconto e conta sobre o cheio', () => {
  const e = vencimentos.encargosDoAtraso({ valor: 4750, desconto: 250, vencimento: '2027-01-18', data: '2027-01-21', cfg: CFG });
  assert.deepEqual([e.desconto_perdido, e.multa, e.juros, e.total, e.com_encargos], [250, 100, 45, 395, 5145]);
  const emDia = vencimentos.encargosDoAtraso({ valor: 4750, desconto: 250, vencimento: '2027-01-18', data: '2027-01-18', cfg: CFG });
  assert.equal(emDia.com_encargos, 4750);
});

test('registro no BB: valor cheio, desconto de valor fixo até o vencimento (no lugar do da configuração), juros e multa sobre o cheio', () => {
  const r = bb.montarRegistro({ cfg: CFG, ambiente: 'sandbox', sequencial: 1, pedido: PEDIDO, parcela: PARCELAS[0], cliente: CLIENTE, hoje: '2026-09-25', desconto: 250 });
  assert.equal(r.payload.valorOriginal, 5000);
  assert.deepEqual(r.payload.desconto, { tipo: 1, dataExpiracao: '18.01.2027', valor: 250 });
  assert.deepEqual(r.payload.jurosMora, { tipo: 1, valor: 15 });
  assert.deepEqual(r.payload.multa, { tipo: 2, data: '19.01.2027', porcentagem: 2 });
  assert.ok(r.encargos.instrucoes.includes('DESCONTO DE 250,00 ATÉ 18/01/2027'));
  assert.equal(r.valor, 5000);
  assert.equal(r.valorParcela, 4750);
  assert.deepEqual(r.desconto, { valor: 250, ate: '2027-01-18' });

  // Pedido sem desconto: o boleto é a parcela e o "Desconto por antecipação" da configuração continua.
  const sem = bb.montarRegistro({ cfg: CFG, ambiente: 'sandbox', sequencial: 2, pedido: PEDIDO, parcela: PARCELAS[0], cliente: CLIENTE, hoje: '2026-09-25' });
  assert.equal(sem.payload.valorOriginal, 4750);
  assert.deepEqual(sem.payload.desconto, { tipo: 1, dataExpiracao: '13.01.2027', valor: 47.5 });
  assert.equal(sem.desconto, null);
});

// ------------------------------------------------------------ registro

function apiFalsa(tabelas, { semColuna = false } = {}) {
  const dados = JSON.parse(JSON.stringify(tabelas));
  let proximoId = 1000;
  const tabelaDe = caminho => caminho.replace(/^\/api\//, '').split('/');
  // Sem o SQL, a API ignora as colunas que não conhece — e não as devolve.
  const sem = linha => {
    if (!semColuna || !linha) return linha;
    const { valor_desconto: _v, desconto_ate: _d, ...resto } = linha;
    return resto;
  };
  return {
    dados,
    async get(caminho, { query = {} } = {}) {
      const [tabela, id] = tabelaDe(caminho);
      const lista = dados[tabela];
      if (!lista) { const e = new Error('não há'); e.status = 404; throw e; }
      if (id) return sem(lista.find(l => String(l.id) === String(id)) || null);
      return lista.filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v))).map(sem);
    },
    async post(caminho, corpo) {
      const [tabela] = tabelaDe(caminho);
      const linha = sem({ id: proximoId++, ...corpo });
      dados[tabela].push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const [tabela, id] = tabelaDe(caminho);
      const linha = dados[tabela].find(l => String(l.id) === String(id));
      Object.assign(linha, sem(corpo));
      return linha;
    }
  };
}

function bbFalso() {
  const chamadas = [];
  return {
    chamadas,
    async chamar({ metodo, caminho, corpo }) {
      chamadas.push({ metodo, caminho, corpo });
      if (metodo === 'PATCH' || metodo === 'GET') return {};
      return { numero: corpo.numeroTituloCliente, linhaDigitavel: '00190000090345348100800000393173116950000332700', codigoBarraNumerico: '00191169500003327000000003453481000000039317', qrCode: {} };
    }
  };
}

const tabelas = () => ({
  configuracao_cobranca: [{ ...CFG }], pedidos: [{ ...PEDIDO }], pedido_parcelas: PARCELAS.map(p => ({ ...p })), pedidos_itens: ITENS.map(i => ({ ...i })),
  clientes: [{ ...CLIENTE }], notas_fiscais: [], boletos: [], boletos_eventos: []
});
const registrar = (api, banco) => boletos.registrar({
  api, pedidoId: 55, bb: banco, credenciais: { clientId: 'c', clientSecret: 's' }, appKey: 'k', ambiente: 'sandbox', usuarioId: 1, hoje: '2026-09-25'
});

test('gerar boletos: cada parcela sai com 5.000 e guarda o desconto de 250 até o vencimento', async () => {
  configuracao.limparCache();
  const api = apiFalsa(tabelas());
  const banco = bbFalso();
  const r = await registrar(api, banco);
  assert.equal(r.registrados, 2);
  assert.deepEqual(banco.chamadas.map(c => [c.corpo.valorOriginal, c.corpo.desconto.valor, c.corpo.desconto.dataExpiracao]), [[5000, 250, '18.01.2027'], [5000, 250, '17.02.2027']]);
  assert.deepEqual(api.dados.boletos.map(b => [b.valor, b.valor_desconto, b.desconto_ate, b.status]), [[5000, 250, '2027-01-18', 'registrado'], [5000, 250, '2027-02-17', 'registrado']]);

  // A tela do "Gerar boletos" sabe o desconto que o boleto novo vai levar.
  const dados = await boletos.lerPedidoCobranca(api, 55);
  assert.deepEqual(boletos.parcelasComBoletos(dados).map(l => l.desconto_condicional), [250, 250]);
});

test('sem o SQL do desconto, o boleto com desconto NÃO vai ao BB e a linha diz qual arquivo rodar', async () => {
  configuracao.limparCache();
  const api = apiFalsa(tabelas(), { semColuna: true });
  const banco = bbFalso();
  const r = await registrar(api, banco);
  assert.equal(banco.chamadas.length, 0, 'nada foi ao banco');
  assert.equal(r.erros, 2);
  assert.ok(r.resultados.every(x => x.sql_pendente && /boletos_desconto_condicional\.sql/.test(x.erro)));
  assert.ok(api.dados.boletos.every(b => b.status === 'erro'), 'o nosso número fica para a próxima tentativa');
});

// ------------------------------------------------------------ depois

test('pago em dia: a parcela é 4.750 e não há encargo; pago atrasado: o que passar (desconto + multa + juros) é encargo', () => {
  assert.deepEqual(recebimentos.valoresDoBoleto({ ...BOLETO, valor_pago: '4750.00' }), { valor_parcela: 4750, valor_abatimento: 0, valor_recebido: 4750, valor_encargos: 0 });
  assert.deepEqual(recebimentos.valoresDoBoleto({ ...BOLETO, valor_pago: '5145.00' }), { valor_parcela: 4750, valor_abatimento: 0, valor_recebido: 5145, valor_encargos: 395 });
});

test('contas a receber: a_receber é o valor em dia (base da comissão); a_receber_hoje, o que o boleto cobra hoje', () => {
  const base = { pedidos: [{ ...PEDIDO }], parcelas: PARCELAS.map(p => ({ ...p })), boletos: [{ ...BOLETO }], recebimentos: [], notas: [], clientes: [] };
  const [emDia] = contasReceber.parcelasDosPedidos({ ...base, hoje: '2027-01-10' });
  assert.deepEqual([emDia.a_receber, emDia.a_receber_hoje, emDia.desconto_condicional, emDia.valor_boleto, emDia.encargos_hoje], [4750, 4750, 250, 5000, null]);
  const [vencida] = contasReceber.parcelasDosPedidos({ ...base, hoje: '2027-01-21' });
  assert.deepEqual([vencida.a_receber, vencida.a_receber_hoje], [4750, 5145]);
  assert.deepEqual(vencida.encargos_hoje, { dias: 3, desconto_perdido: 250, multa: 100, juros: 45, total: 395 });
  const resumo = contasReceber.resumir({ linhas: [vencida], recebidos: [], competencia: '2027-01', hoje: '2027-01-21' });
  assert.deepEqual([resumo.em_atraso.total, resumo.em_atraso.em_dia, resumo.em_atraso.encargos], [5145, 4750, 395]);
});

test('parcela com boleto de valor cheio: a trava do pagamento aceita o valor em dia; a devolução abate do valor em dia', () => {
  const travas = pedidoParcelas.travasDasParcelas({ parcelas: [PARCELAS[0]], boletos: [{ ...BOLETO }] });
  assert.equal(travas.get(1).permitido, 4750);
  assert.throws(() => op.validarAbatimento({ ...BOLETO }, 4750), /menor que o valor em dia do boleto \(R\$\s4\.750,00/);
  assert.equal(op.validarAbatimento({ ...BOLETO }, 1000), 1000);
});

test('prorrogar leva o desconto para a nova data; se o BB recusar, avisa e o desconto fica na data antiga', async () => {
  const tabelasOp = { boletos: [{ ...BOLETO, convenio: '3453481', ambiente: 'sandbox', instrucoes: '[]' }], boletos_eventos: [] };
  const conexao = { ambiente: 'sandbox', appKey: 'k', credenciais: {} };
  const api = apiFalsa(tabelasOp);
  const banco = bbFalso();
  const r = await op.prorrogar({ api, bb: banco, conexao, boleto: api.dados.boletos[0], cfg: CFG, novaData: '2027-02-01', hoje: '2026-09-25' });
  const desconto = banco.chamadas.find(c => c.corpo?.indicadorAlterarDataDesconto === 'S');
  assert.deepEqual(desconto.corpo.alteracaoDataDesconto, { novaDataLimitePrimeiroDesconto: '01.02.2027' });
  assert.equal(api.dados.boletos[0].desconto_ate, '2027-02-01');
  assert.ok(JSON.parse(api.dados.boletos[0].instrucoes).includes('DESCONTO DE 250,00 ATÉ 01/02/2027'));
  assert.ok(!r.avisos.some(a => /desconto/.test(a)));

  const api2 = apiFalsa(tabelasOp);
  const recusa = {
    chamadas: [],
    async chamar({ metodo, caminho, corpo }) {
      this.chamadas.push({ metodo, caminho, corpo });
      if (corpo?.indicadorAlterarDataDesconto === 'S') { const e = new Error('O BB respondeu 400: Desconto não alterável.'); e.status = 422; throw e; }
      return {};
    }
  };
  const r2 = await op.prorrogar({ api: api2, bb: recusa, conexao, boleto: api2.dados.boletos[0], cfg: CFG, novaData: '2027-02-01', hoje: '2026-09-25' });
  assert.equal(api2.dados.boletos[0].data_vencimento, '2027-02-01', 'a prorrogação vale');
  assert.equal(api2.dados.boletos[0].desconto_ate, '2027-01-18');
  assert.match(r2.avisos[0], /não aceitou mover o desconto de R\$\s250,00 para 01\/02\/2027: ele continua até 18\/01\/2027/);
});
