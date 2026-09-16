/**
 * Alterações, baixa e consulta de boletos (backend/cobranca/boletoOperacoes.js)
 * com API e BB de mentira: o detalhe do BB lido para o app (estado, pagamento,
 * canal), os payloads do PATCH (um indicador "S", os demais "N"), as
 * validações, a prorrogação que leva a multa junto, o abatimento, as três
 * baixas (quitado por fora, cancelado, reemissão com boleto novo) e o
 * histórico que junta os eventos do webhook.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const configuracao = require('./configuracaoCobranca');
const boletos = require('./boletos');
const op = require('./boletoOperacoes');

const HOJE = '2026-09-16';
const CFG = {
  id: 1, ambiente: 'sandbox', convenio: '3453481', carteira: 17, variacao: 19, especie: 'DM', aceite: false, juros_tipo: 'valor_dia', juros_percentual_mes: 9,
  multa_percentual: 2, multa_dias: 1, protesto_dias: 7, negativacao_dias: null, dias_limite_recebimento: 15, desconto_percentual: 0, desconto_dias: 0,
  indicador_pix: true, proximo_sequencial_sandbox: 10, proximo_sequencial_producao: 394
};
const CONEXAO = { ambiente: 'sandbox', appKey: 'k', credenciais: { clientId: 'c', clientSecret: 's' } };

/** Um boleto registrado com as colunas da fase D. */
function boletoBase(extra = {}) {
  return {
    id: 41, pedido_id: 55, parcela_id: 1, numero_parcela: 1, nota_fiscal_id: 10, ambiente: 'sandbox', convenio: '3128557', carteira: 17, variacao: 35,
    sequencial: 1, nosso_numero: '00031285570000000001', nosso_numero_dv: '9', numero_documento: '2548P1',
    linha_digitavel: '00190.00009 03128.557000 00000.001179 1 16950000100000', codigo_barras: '00191169500001000000000003128557000000000117',
    valor: '1000.00', data_emissao: '2026-09-16', data_vencimento: '2027-01-18', juros_valor_dia: '3.00', juros_percentual_mes: '9.000', multa_percentual: '2.00',
    protesto_dias: 7, dias_limite_recebimento: 15, instrucoes: ['JRS: Vl p/Dia Atraso R$3,00 A PARTIR DE 19/01/27'], status: 'registrado',
    codigo_estado_bb: '01', situacao_bb: 'Normal', data_pagamento: null, valor_pago: null, canal_pagamento: null,
    valor_abatimento: '0.00', vencimento_original: null, motivo_baixa: null, observacao_baixa: null, data_baixa: null, baixado_por: null,
    substitui_boleto_id: null, sincronizado_em: null,
    ...extra
  };
}

function apiFalsa(tabelas) {
  const dados = JSON.parse(JSON.stringify(tabelas));
  let proximoId = 500;
  const tabelaDe = caminho => caminho.replace(/^\/api\//, '').split('/');
  return {
    dados,
    async get(caminho, { query = {} } = {}) {
      const [tabela] = tabelaDe(caminho);
      return (dados[tabela] || []).filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
    },
    async post(caminho, corpo) {
      const [tabela] = tabelaDe(caminho);
      const linha = { id: proximoId++, ...corpo };
      dados[tabela].push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const [tabela, id] = tabelaDe(caminho);
      const linha = dados[tabela].find(l => String(l.id) === String(id));
      Object.assign(linha, corpo);
      return linha;
    }
  };
}

/** O detalhe que o BB devolve (formato da API Cobranças v2). */
function detalheBB(extra = {}) {
  return {
    codigoLinhaDigitavel: '00190000090312855700000000001179116950000100000', codigoEstadoTituloCobranca: 1, dataVencimentoTituloCobranca: '18.01.2027',
    valorOriginalTituloCobranca: 1000, valorAtualTituloCobranca: 1000, valorAbatimentoTituloCobranca: 0, dataRecebimentoTitulo: '', dataCreditoLiquidacao: '',
    valorPagoSacado: 0, codigoCanalPagamento: 0, codigoTipoBaixaTitulo: 0, dataMultaTitulo: '19.01.2027',
    textoCodigoBarrasTituloCobranca: '00191169500001000000000003128557000000000117',
    ...extra
  };
}

/** BB de mentira: guarda as chamadas; o detalhe muda conforme o que foi alterado. */
function bbFalso({ detalhe = detalheBB(), recusar = {} } = {}) {
  const chamadas = [];
  const estado = { detalhe: { ...detalhe } };
  return {
    chamadas,
    estado,
    async chamar({ metodo, caminho, query, corpo }) {
      chamadas.push({ metodo, caminho, query, corpo });
      const chave = `${metodo} ${caminho}${corpo?.indicadorCobrarMulta === 'S' ? ' multa' : ''}`;
      if (recusar[chave]) {
        const e = new Error(`O BB respondeu 400 em ${metodo} ${caminho}: ${recusar[chave]}.`);
        e.status = 422;
        e.extra = { bb: { erros: [{ textoMensagem: recusar[chave] }] }, http: 400 };
        throw e;
      }
      if (metodo === 'GET') return { ...estado.detalhe };
      if (metodo === 'PATCH') {
        if (corpo.indicadorNovaDataVencimento === 'S') estado.detalhe.dataVencimentoTituloCobranca = corpo.alteracaoData.novaDataVencimento;
        if (corpo.indicadorIncluirAbatimento === 'S') estado.detalhe.valorAbatimentoTituloCobranca = corpo.abatimento.valorAbatimento;
        if (corpo.indicadorAlterarAbatimento === 'S') estado.detalhe.valorAbatimentoTituloCobranca = corpo.alteracaoAbatimento.novoValorAbatimento;
        if (corpo.indicadorCobrarMulta === 'S') estado.detalhe.dataMultaTitulo = corpo.multa.dataInicioMulta;
        return { numeroContratoCobranca: 1, dataAtualizacao: '16.09.2026', horarioAtualizacao: '10:00:00' };
      }
      if (metodo === 'POST' && caminho.endsWith('/baixar')) {
        estado.detalhe.codigoEstadoTituloCobranca = 7;
        estado.detalhe.codigoTipoBaixaTitulo = 11;
        return { numeroContratoCobranca: 1, dataBaixa: '16.09.2026', horarioBaixa: '10:00:00' };
      }
      throw new Error(`chamada inesperada ${chave}`);
    }
  };
}

test('leitura do BB: datas dd.mm.aaaa, canal de pagamento, estado e o detalhe no formato do app', () => {
  assert.equal(op.isoDoBB('20.01.2027'), '2027-01-20');
  assert.equal(op.isoDoBB('00.00.0000'), null);
  assert.equal(op.isoDoBB('31.02.2027'), null, 'data que não existe');
  assert.equal(op.isoDoBB(''), null);
  assert.equal(op.canalDePagamento(161), 'Pix');
  assert.equal(op.canalDePagamento(101), 'agência · espécie');
  assert.equal(op.canalDePagamento(203), 'internet · débito em conta');
  assert.equal(op.canalDePagamento(0), null);
  assert.equal(op.canalDePagamento(977), 'canal 977');

  const lido = op.lerDetalhe(detalheBB({ codigoEstadoTituloCobranca: 6, dataRecebimentoTitulo: '20.01.2027', dataCreditoLiquidacao: '21.01.2027', valorPagoSacado: 1012.5, codigoCanalPagamento: 161 }));
  assert.equal(lido.codigo, 6);
  assert.equal(lido.situacao, 'LIQUIDADO');
  assert.equal(lido.vencimento, '2027-01-18');
  assert.equal(lido.pagoEm, '2027-01-20');
  assert.equal(lido.creditoEm, '2027-01-21');
  assert.equal(lido.valorPago, 1012.5);
  assert.equal(lido.canal, 'Pix');
  assert.equal(lido.multaAPartirDe, '2027-01-19');
  assert.equal(lido.abatimento, 0);
  assert.equal(lido.linha, '00190.00009 03128.557000 00000.001179 1 16950000100000');
  assert.equal(lido.barras.length, 44);
  assert.equal(op.lerDetalhe(detalheBB({ codigoEstadoTituloCobranca: 7, codigoTipoBaixaTitulo: 13 })).tipoBaixa, 'DECURSO PRAZO - BANCO');
  assert.equal(op.lerDetalhe({}).codigo, null);

  const s = (codigo, statusAtual = 'registrado', vencimento = '2027-01-18') => op.statusPeloBB(codigo, { statusAtual, vencimento, hoje: HOJE });
  assert.equal(s(1), 'registrado');
  assert.equal(s(1, 'registrado', '2026-09-10'), 'vencido', 'normal e vencido pela data');
  assert.equal(s(1, 'vencido', '2027-01-18'), 'registrado', 'prorrogado volta a registrado');
  assert.equal(s(6), 'pago');
  assert.equal(s(16), 'pago');
  assert.equal(s(10), 'pago', 'pago em cartório');
  assert.equal(s(7), 'baixado');
  assert.equal(s(5), 'protestado');
  assert.equal(s(3, 'registrado', '2026-09-01'), 'vencido', 'em cartório: vencido, ainda a pagar');
  assert.equal(s(17), 'registrado', 'cheque aguardando: o app espera');
  assert.equal(s(80, 'registrado', '2026-09-01'), 'vencido', 'transitório só atualiza o vencido');
  assert.equal(s(7, 'pago'), 'pago', 'pago é final');
});

test('payloads: todos os indicadores vão, um só com "S"; datas no formato do BB', () => {
  const contaS = corpo => op.INDICADORES.filter(i => corpo[i] === 'S');
  const p = op.payloadProrrogacao('3128557', '2027-02-10');
  assert.equal(p.numeroConvenio, 3128557);
  assert.deepEqual(contaS(p), ['indicadorNovaDataVencimento']);
  assert.ok(op.INDICADORES.every(i => p[i] === 'S' || p[i] === 'N'));
  assert.deepEqual(p.alteracaoData, { novaDataVencimento: '10.02.2027' });
  const inc = op.payloadAbatimento('3128557', 50, false);
  assert.deepEqual(contaS(inc), ['indicadorIncluirAbatimento']);
  assert.deepEqual(inc.abatimento, { valorAbatimento: 50 });
  const alt = op.payloadAbatimento('3128557', 80, true);
  assert.deepEqual(contaS(alt), ['indicadorAlterarAbatimento']);
  assert.deepEqual(alt.alteracaoAbatimento, { novoValorAbatimento: 80 });
  const multa = op.payloadMulta('3128557', { percentual: '2.00', aPartirDe: '2027-02-11' });
  assert.deepEqual(contaS(multa), ['indicadorCobrarMulta']);
  assert.deepEqual(multa.multa, { tipoMulta: 2, valorMulta: 0, dataInicioMulta: '11.02.2027', taxaMulta: 2 });
  assert.deepEqual(op.payloadBaixa('3128557'), { numeroConvenio: 3128557 });
  assert.throws(() => op.payloadAlteracao('1', 'indicadorInventado'), /desconhecido/);
});

test('validações e ações por status; o SQL da fase é exigido', () => {
  const b = boletoBase();
  assert.throws(() => op.validarProrrogacao(b, '', HOJE), /Informe a nova data/);
  assert.throws(() => op.validarProrrogacao(b, '2026-09-15', HOJE), /já passou/);
  assert.throws(() => op.validarProrrogacao(b, '2027-01-18', HOJE), /depois do vencimento atual \(18\/01\/2027\)/);
  assert.throws(() => op.validarProrrogacao({ ...b, status: 'pago' }, '2027-02-10', HOJE), /Só se prorroga/);
  assert.doesNotThrow(() => op.validarProrrogacao({ ...b, status: 'vencido', data_vencimento: '2026-09-01' }, HOJE, HOJE), 'vencido pode ir para hoje');

  assert.equal(op.validarAbatimento(b, '100,5'.replace(',', '.')), 100.5);
  assert.throws(() => op.validarAbatimento(b, 0), /Informe o valor/);
  assert.throws(() => op.validarAbatimento(b, 1000), /menor que o valor do boleto \(R\$ 1\.000,00\)/);
  assert.throws(() => op.validarAbatimento({ ...b, valor_abatimento: '100.50' }, 100.5), /já é R\$ 100,50/);
  assert.throws(() => op.validarAbatimento({ ...b, status: 'protestado' }, 10), /Só se concede/);

  assert.throws(() => op.validarBaixa(b, {}, HOJE), /Escolha o motivo/);
  assert.throws(() => op.validarBaixa(b, { motivo: 'cancelado' }, HOJE), /por que a cobrança foi cancelada/);
  assert.deepEqual(op.validarBaixa(b, { motivo: 'cancelado', observacao: '  cliente   desistiu ' }, HOJE), { motivo: 'cancelado', observacao: 'cliente desistiu' });
  assert.throws(() => op.validarBaixa(b, { motivo: 'quitado_por_fora', data_recebimento: '2026-09-17', valor_recebido: 1000, forma: 'Pix' }, HOJE), /não pode ser futura/);
  assert.throws(() => op.validarBaixa(b, { motivo: 'quitado_por_fora', data_recebimento: HOJE, valor_recebido: 0, forma: 'Pix' }, HOJE), /Informe o valor recebido/);
  assert.throws(() => op.validarBaixa(b, { motivo: 'quitado_por_fora', data_recebimento: HOJE, valor_recebido: 10, forma: 'Boleto' }, HOJE), /como o valor foi recebido/);
  assert.deepEqual(op.validarBaixa(b, { motivo: 'quitado_por_fora', data_recebimento: HOJE, valor_recebido: '1000', forma: 'Transferência' }, HOJE),
    { motivo: 'quitado_por_fora', observacao: '', dataRecebimento: HOJE, valorRecebido: 1000, forma: 'Transferência' });
  assert.throws(() => op.validarBaixa(b, { motivo: 'reemissao', novo_vencimento: '2026-09-01' }, HOJE), /já passou/);
  assert.equal(op.validarBaixa(b, { motivo: 'reemissao', novo_vencimento: '2026-10-01' }, HOJE).novoVencimento, '2026-10-01');
  assert.throws(() => op.validarBaixa({ ...b, status: 'baixado' }, { motivo: 'cancelado', observacao: 'x' }, HOJE), /em aberto/);

  assert.deepEqual(op.acoesDoBoleto(b), { sincronizar: true, prorrogar: true, abatimento: true, baixar: true, pdf: true });
  assert.deepEqual(op.acoesDoBoleto({ status: 'protestado' }), { sincronizar: true, prorrogar: false, abatimento: false, baixar: true, pdf: true });
  assert.deepEqual(op.acoesDoBoleto({ status: 'pago' }), { sincronizar: true, prorrogar: false, abatimento: false, baixar: false, pdf: false });
  assert.deepEqual(op.acoesDoBoleto({ status: 'erro' }), { sincronizar: false, prorrogar: false, abatimento: false, baixar: false, pdf: false });

  assert.equal(op.sqlPronto(b), true);
  const { valor_abatimento, ...semColuna } = b;
  assert.equal(op.sqlPronto(semColuna), false);
  assert.throws(() => op.exigirSql(semColuna), /sql\/cobranca_alteracoes\.sql/);
});

test('consulta: pago grava data, valor e canal; vencimento mudado no BB guarda o original e refaz as instruções; manter protege o que acabou de mudar', () => {
  const b = boletoBase();
  const pago = op.camposDaSincronizacao(b, op.lerDetalhe(detalheBB({ codigoEstadoTituloCobranca: 6, dataRecebimentoTitulo: '20.01.2027', valorPagoSacado: 1012.5, codigoCanalPagamento: 161 })), { hoje: HOJE, agora: 'T' });
  assert.equal(pago.campos.status, 'pago');
  assert.equal(pago.campos.codigo_estado_bb, '06');
  assert.equal(pago.campos.situacao_bb, 'LIQUIDADO');
  assert.equal(pago.campos.data_pagamento, '2027-01-20');
  assert.equal(pago.campos.valor_pago, 1012.5);
  assert.equal(pago.campos.canal_pagamento, 'Pix');
  assert.equal(pago.campos.sincronizado_em, 'T');
  assert.ok(!('linha_digitavel' in pago.campos), 'a linha é a mesma');
  assert.equal(op.resumoDaConsulta(b, op.lerDetalhe(detalheBB({ codigoEstadoTituloCobranca: 6, dataRecebimentoTitulo: '20.01.2027', valorPagoSacado: 1012.5, codigoCanalPagamento: 161 })), pago.campos),
    'BB: LIQUIDADO · registrado → pago · pago em 20/01/2027 R$ 1.012,50 (Pix)');

  const mudou = op.camposDaSincronizacao(b, op.lerDetalhe(detalheBB({ dataVencimentoTituloCobranca: '10.02.2027' })), { hoje: HOJE, agora: 'T', cfg: CFG });
  assert.equal(mudou.campos.data_vencimento, '2027-02-10');
  assert.equal(mudou.campos.vencimento_original, '2027-01-18');
  assert.deepEqual(mudou.campos.instrucoes, [
    'JRS: Vl p/Dia Atraso R$3,00 A PARTIR DE 11/02/27', 'MULTA DE 2,00% A PARTIR DE 11/02/2027', 'PROTESTO: A partir de 17/02/2027', 'Receber até 15 dias após o vencimento'
  ]);
  const mantido = op.camposDaSincronizacao(b, op.lerDetalhe(detalheBB({ dataVencimentoTituloCobranca: '10.01.2027', valorAbatimentoTituloCobranca: 20 })), { hoje: HOJE, agora: 'T', manter: ['data_vencimento', 'valor_abatimento'] });
  assert.ok(!('data_vencimento' in mantido.campos) && !('valor_abatimento' in mantido.campos));
  assert.deepEqual(mantido.divergencias, ['o BB ainda mostra o vencimento 10/01/2027', 'o BB ainda mostra o abatimento de R$ 20,00']);

  const baixadoPeloBanco = op.camposDaSincronizacao(b, op.lerDetalhe(detalheBB({ codigoEstadoTituloCobranca: 7, codigoTipoBaixaTitulo: 13 })), { hoje: HOJE, agora: 'T' });
  assert.equal(baixadoPeloBanco.campos.status, 'baixado');
  assert.equal(baixadoPeloBanco.campos.motivo_baixa, 'banco');
  assert.equal(baixadoPeloBanco.campos.data_baixa, HOJE);
  assert.equal(baixadoPeloBanco.campos.situacao_bb, 'BAIXADO - DECURSO PRAZO - BANCO');
  const jaBaixado = op.camposDaSincronizacao({ ...b, status: 'baixado', motivo_baixa: 'cancelado' }, op.lerDetalhe(detalheBB({ codigoEstadoTituloCobranca: 7 })), { hoje: HOJE, agora: 'T' });
  assert.ok(!('motivo_baixa' in jaBaixado.campos), 'o motivo que o app gravou fica');
});

test('sincronizar: consulta GET com o convênio, grava e deixa rastro; erro do BB também fica no histórico', async () => {
  const api = apiFalsa({ boletos: [boletoBase()], boletos_eventos: [] });
  const bb = bbFalso({ detalhe: detalheBB({ codigoEstadoTituloCobranca: 6, dataRecebimentoTitulo: '20.01.2027', valorPagoSacado: 1000, codigoCanalPagamento: 101 }) });
  const r = await op.sincronizar({ api, bb, conexao: CONEXAO, boleto: api.dados.boletos[0], cfg: CFG, hoje: HOJE, usuarioId: 3 });
  assert.equal(r.mudou, true);
  assert.deepEqual(bb.chamadas[0], { metodo: 'GET', caminho: '/boletos/00031285570000000001', query: { numeroConvenio: '3128557' }, corpo: undefined });
  const b = api.dados.boletos[0];
  assert.equal(b.status, 'pago');
  assert.equal(b.canal_pagamento, 'agência · espécie');
  assert.ok(b.sincronizado_em);
  assert.equal(api.dados.boletos_eventos[0].tipo, 'consulta');
  assert.equal(api.dados.boletos_eventos[0].origem, 'consulta');
  assert.equal(api.dados.boletos_eventos[0].usuario_id, 3);

  const falha = bbFalso({ recusar: { 'GET /boletos/00031285570000000001': 'Boleto não encontrado' } });
  const api2 = apiFalsa({ boletos: [boletoBase()], boletos_eventos: [] });
  await assert.rejects(() => op.sincronizar({ api: api2, bb: falha, conexao: CONEXAO, boleto: api2.dados.boletos[0], hoje: HOJE }), /Boleto não encontrado/);
  assert.equal(api2.dados.boletos_eventos[0].tipo, 'consulta_erro');
  await assert.rejects(() => op.sincronizar({ api: api2, bb: falha, conexao: CONEXAO, boleto: { ...boletoBase(), status: 'erro' }, hoje: HOJE }), /não está registrado/);
});

test('prorrogar: PATCH com a nova data, instruções refeitas, original guardado; a multa que ficou para trás vai junto', async () => {
  const api = apiFalsa({ boletos: [boletoBase({ status: 'vencido', data_vencimento: '2026-09-10' })], boletos_eventos: [] });
  const bb = bbFalso({ detalhe: detalheBB({ dataVencimentoTituloCobranca: '10.09.2026', dataMultaTitulo: '11.09.2026' }) });
  const r = await op.prorrogar({ api, bb, conexao: CONEXAO, boleto: api.dados.boletos[0], cfg: CFG, novaData: '2026-09-30', hoje: HOJE, usuarioId: 3 });
  assert.deepEqual(bb.chamadas.map(c => `${c.metodo} ${c.caminho}`), ['PATCH /boletos/00031285570000000001', 'GET /boletos/00031285570000000001', 'PATCH /boletos/00031285570000000001']);
  assert.equal(bb.chamadas[0].corpo.alteracaoData.novaDataVencimento, '30.09.2026');
  assert.equal(bb.chamadas[2].corpo.indicadorCobrarMulta, 'S');
  assert.equal(bb.chamadas[2].corpo.multa.dataInicioMulta, '01.10.2026');
  const b = api.dados.boletos[0];
  assert.equal(b.data_vencimento, '2026-09-30');
  assert.equal(b.vencimento_original, '2026-09-10');
  assert.equal(b.status, 'registrado', 'vencido prorrogado volta a registrado');
  assert.deepEqual(JSON.parse(b.instrucoes)[1], 'MULTA DE 2,00% A PARTIR DE 01/10/2026', 'instruções gravadas como texto JSON');
  assert.deepEqual(r.avisos, []);
  assert.deepEqual(api.dados.boletos_eventos.map(e => e.tipo), ['prorrogado', 'consulta', 'multa_atualizada']);
  assert.match(api.dados.boletos_eventos[0].mensagem, /Vencimento 10\/09\/2026 → 30\/09\/2026/);

  // Multa já depois do novo vencimento: um PATCH só. Segunda prorrogação mantém o original.
  const bb2 = bbFalso({ detalhe: detalheBB({ dataVencimentoTituloCobranca: '30.09.2026', dataMultaTitulo: '31.12.2026' }) });
  await op.prorrogar({ api, bb: bb2, conexao: CONEXAO, boleto: api.dados.boletos[0], cfg: CFG, novaData: '2026-10-15', hoje: HOJE });
  assert.deepEqual(bb2.chamadas.map(c => c.metodo), ['PATCH', 'GET']);
  assert.equal(api.dados.boletos[0].vencimento_original, '2026-09-10');

  // Recusa da multa não desfaz a prorrogação: vira aviso. Recusa da data: erro e rastro.
  const api3 = apiFalsa({ boletos: [boletoBase()], boletos_eventos: [] });
  const bb3 = bbFalso({ recusar: { 'PATCH /boletos/00031285570000000001 multa': 'Multa não permitida' } });
  const r3 = await op.prorrogar({ api: api3, bb: bb3, conexao: CONEXAO, boleto: api3.dados.boletos[0], cfg: CFG, novaData: '2027-02-10', hoje: HOJE });
  assert.equal(api3.dados.boletos[0].data_vencimento, '2027-02-10');
  assert.match(r3.avisos[0], /não aceitou mover a multa para 11\/02\/2027: .*Multa não permitida/);
  const bb4 = bbFalso({ recusar: { 'PATCH /boletos/00031285570000000001': 'Data inválida' } });
  const api4 = apiFalsa({ boletos: [boletoBase()], boletos_eventos: [] });
  await assert.rejects(() => op.prorrogar({ api: api4, bb: bb4, conexao: CONEXAO, boleto: api4.dados.boletos[0], cfg: CFG, novaData: '2027-02-10', hoje: HOJE }), /Data inválida/);
  assert.equal(api4.dados.boletos[0].data_vencimento, '2027-01-18', 'nada mudou aqui');
  assert.equal(api4.dados.boletos_eventos[0].tipo, 'alteracao_erro');
  assert.equal(api4.dados.boletos_eventos[0].payload.requisicao.indicadorNovaDataVencimento, 'S');
});

test('abatimento: inclui na primeira vez, altera depois; a consulta não desfaz o que acabou de mudar', async () => {
  const api = apiFalsa({ boletos: [boletoBase()], boletos_eventos: [] });
  const bb = bbFalso();
  const r = await op.concederAbatimento({ api, bb, conexao: CONEXAO, boleto: api.dados.boletos[0], cfg: CFG, valor: 100, hoje: HOJE });
  assert.equal(bb.chamadas[0].corpo.indicadorIncluirAbatimento, 'S');
  assert.equal(api.dados.boletos[0].valor_abatimento, 100);
  assert.deepEqual(r.avisos, []);
  assert.match(api.dados.boletos_eventos[0].mensagem, /Abatimento de R\$ 100,00: o boleto passa a cobrar R\$ 900,00/);
  const bb2 = bbFalso({ detalhe: detalheBB({ valorAbatimentoTituloCobranca: 100 }) });
  await op.concederAbatimento({ api, bb: bb2, conexao: CONEXAO, boleto: api.dados.boletos[0], cfg: CFG, valor: 150, hoje: HOJE });
  assert.equal(bb2.chamadas[0].corpo.indicadorAlterarAbatimento, 'S');
  assert.equal(api.dados.boletos[0].valor_abatimento, 150);
  assert.match(api.dados.boletos_eventos.at(-2).mensagem, /era R\$ 100,00/);

  // O BB ainda mostra o valor antigo logo depois: fica o novo, com aviso.
  const atrasado = { async chamar(p) { if (p.metodo === 'GET') return detalheBB({ valorAbatimentoTituloCobranca: 150 }); return {}; } };
  const r3 = await op.concederAbatimento({ api, bb: atrasado, conexao: CONEXAO, boleto: api.dados.boletos[0], cfg: CFG, valor: 200, hoje: HOJE });
  assert.equal(api.dados.boletos[0].valor_abatimento, 200);
  assert.match(r3.avisos[0], /o BB ainda mostra o abatimento de R\$ 150,00/);
});

test('baixar: quitado por fora grava o recebimento; cancelado; reemissão chama o registro do boleto novo e avisa se ele falhar', async () => {
  const api = apiFalsa({ boletos: [boletoBase()], boletos_eventos: [] });
  const bb = bbFalso();
  const r = await op.baixar({ api, bb, conexao: CONEXAO, boleto: api.dados.boletos[0], entrada: { motivo: 'quitado_por_fora', data_recebimento: '2026-09-15', valor_recebido: '1000', forma: 'Pix', observacao: 'pago direto na conta' }, hoje: HOJE, usuarioId: 3 });
  assert.deepEqual(bb.chamadas[0], { metodo: 'POST', caminho: '/boletos/00031285570000000001/baixar', query: undefined, corpo: { numeroConvenio: 3128557 } });
  const b = api.dados.boletos[0];
  assert.equal(b.status, 'baixado');
  assert.equal(b.motivo_baixa, 'quitado_por_fora');
  assert.equal(b.data_baixa, HOJE);
  assert.equal(b.baixado_por, 3);
  assert.equal(b.data_pagamento, '2026-09-15');
  assert.equal(b.valor_pago, 1000);
  assert.equal(b.canal_pagamento, 'Fora do boleto · Pix');
  assert.equal(r.reemissao, null);
  assert.match(api.dados.boletos_eventos[0].mensagem, /Baixado \(quitado por fora\): recebido em 15\/09\/2026, R\$ 1\.000,00 \(Pix\)\. pago direto na conta/);
  assert.equal(boletos.ocupaParcela(b), true, 'quitado por fora: a parcela não ganha outro boleto');

  const api2 = apiFalsa({ boletos: [boletoBase()], boletos_eventos: [] });
  await op.baixar({ api: api2, bb: bbFalso(), conexao: CONEXAO, boleto: api2.dados.boletos[0], entrada: { motivo: 'cancelado', observacao: 'pedido desfeito' }, hoje: HOJE });
  assert.equal(api2.dados.boletos[0].motivo_baixa, 'cancelado');
  assert.equal(api2.dados.boletos[0].data_pagamento, null);
  assert.equal(boletos.ocupaParcela(api2.dados.boletos[0]), true);

  const api3 = apiFalsa({ boletos: [boletoBase()], boletos_eventos: [] });
  const pedidos = [];
  const r3 = await op.baixar({
    api: api3, bb: bbFalso(), conexao: CONEXAO, boleto: api3.dados.boletos[0], entrada: { motivo: 'reemissao', novo_vencimento: '2026-10-01' }, hoje: HOJE,
    registrarNovo: async p => { pedidos.push(p); return { resultados: [{ ok: true }] }; }
  });
  assert.equal(pedidos[0].vencimento, '2026-10-01');
  assert.equal(pedidos[0].substitui.id, 41);
  assert.equal(pedidos[0].substitui.status, 'baixado');
  assert.deepEqual(r3.avisos, []);
  assert.equal(boletos.ocupaParcela(api3.dados.boletos[0]), false, 'reemissão libera a parcela');

  const api4 = apiFalsa({ boletos: [boletoBase()], boletos_eventos: [] });
  const r4 = await op.baixar({
    api: api4, bb: bbFalso(), conexao: CONEXAO, boleto: api4.dados.boletos[0], entrada: { motivo: 'reemissao', novo_vencimento: '2026-10-01' }, hoje: HOJE,
    registrarNovo: async () => ({ resultados: [{ ok: false, erro: 'Cliente sem CEP' }] })
  });
  assert.equal(api4.dados.boletos[0].status, 'baixado', 'a baixa fica');
  assert.match(r4.avisos[0], /Baixado, mas o boleto novo não saiu: Cliente sem CEP/);

  const api5 = apiFalsa({ boletos: [boletoBase()], boletos_eventos: [] });
  await assert.rejects(() => op.baixar({ api: api5, bb: bbFalso({ recusar: { 'POST /boletos/00031285570000000001/baixar': 'Título liquidado' } }), conexao: CONEXAO, boleto: api5.dados.boletos[0], entrada: { motivo: 'cancelado', observacao: 'x' }, hoje: HOJE }), /Título liquidado/);
  assert.equal(api5.dados.boletos[0].status, 'registrado');
  assert.equal(api5.dados.boletos_eventos[0].tipo, 'alteracao_erro');
});

test('sincronizarPedido e histórico: um erro não para os outros; o histórico junta os eventos do webhook pelo nosso número', async () => {
  const api = apiFalsa({
    pedidos: [{ id: 55, numero: '2548', situacao: 'Enviado', cliente_id: null }],
    pedido_parcelas: [], notas_fiscais: [], clientes: [], configuracao_cobranca: [{ ...CFG }],
    boletos: [
      boletoBase(),
      boletoBase({ id: 42, parcela_id: 2, numero_parcela: 2, nosso_numero: '00031285570000000002', ambiente: 'producao' }),
      boletoBase({ id: 43, parcela_id: 3, numero_parcela: 3, nosso_numero: '00031285570000000003', status: 'pago' })
    ],
    boletos_eventos: [
      { id: 1, boleto_id: 41, origem: 'app', tipo: 'registrado', mensagem: 'Registrado', criado_em: '2026-09-16T10:00:00Z', processado_em: '2026-09-16T10:00:00Z' },
      { id: 2, boleto_id: null, origem: 'webhook', tipo: 'baixa_operacional', nosso_numero: '00031285570000000001', mensagem: null, processado_em: null },
      { id: 3, boleto_id: 42, origem: 'app', tipo: 'registrado', nosso_numero: '00031285570000000002' },
      { id: 4, boleto_id: null, origem: 'webhook', tipo: 'baixa_operacional', nosso_numero: '00031285570000000002' }
    ]
  });
  configuracao.limparCache();
  const conexao = async ambiente => { if (ambiente === 'producao') throw new Error('Este boleto é de produção, mas a cobrança está em homologação.'); return CONEXAO; };
  const r = await op.sincronizarPedido({ api, bb: bbFalso(), conexao, pedidoId: 55, hoje: HOJE });
  assert.equal(r.consultados, 1);
  assert.equal(r.erros, 1);
  assert.equal(r.mudaram, 0);
  assert.match(r.resultados.find(x => x.boleto_id === 42).erro, /é de produção/);
  assert.ok(!r.resultados.some(x => x.boleto_id === 43), 'pago não é consultado de novo');

  const h = await op.historico(api, api.dados.boletos[0]);
  assert.deepEqual(h.map(e => [e.id, e.origem, e.tipo, e.pendente]).slice(-2), [[2, 'webhook', 'baixa_operacional', true], [1, 'app', 'registrado', false]]);
  assert.ok(!h.some(e => e.id === 3 || e.id === 4), 'eventos de outro boleto ficam de fora');
  assert.ok(!('payload' in h[0]));
});

test('registro com reemissão: vencimento novo só no boleto, ligado ao baixado; a nova tentativa depois de erro usa a mesma data', async () => {
  configuracao.limparCache();
  const tabelas = {
    configuracao_cobranca: [{ ...CFG, proximo_sequencial_sandbox: 1 }],
    pedidos: [{ id: 55, numero: '2548', situacao: 'Enviado', cliente_id: 7 }],
    pedido_parcelas: [{ id: 1, pedido_id: 55, numero_parcela: 1, valor: 1000, data_vencimento: '2026-09-10' }],
    clientes: [{ id: 7, tipo_pessoa: 'PJ', razao_social: 'Cliente Bom LTDA', cnpj: '11222333000181', reg_logradouro: 'Rua Diamante', reg_numero: '504', reg_bairro: 'São Joaquim', reg_cidade: 'Contagem', reg_uf: 'MG', reg_cep: '32113000' }],
    notas_fiscais: [],
    boletos: [boletoBase({ status: 'baixado', motivo_baixa: 'reemissao', data_vencimento: '2026-09-10' })],
    boletos_eventos: []
  };
  const api = apiFalsa(tabelas);
  let recusar = true;
  const bb = {
    async chamar({ corpo }) {
      if (recusar) { const e = new Error('O BB respondeu 503 em POST /boletos.'); e.status = 502; throw e; }
      return { numero: corpo.numeroTituloCliente, linhaDigitavel: '00190000090312855700000000001179116950000100000' };
    }
  };
  const base = { api, pedidoId: 55, bb, credenciais: { clientId: 'c', clientSecret: 's' }, appKey: 'k', ambiente: 'sandbox', usuarioId: 1, hoje: HOJE };

  // A parcela venceu: sem data nova o pedido não gera; a reemissão manda a data.
  const semData = await boletos.registrar({ ...base, parcelaIds: [1] });
  assert.match(semData.resultados[0].erro, /já passou/);
  const r = await boletos.registrar({ ...base, parcelaIds: [1], vencimentos: { 1: '2026-10-01' }, substituiBoletoId: 41 });
  assert.equal(r.erros, 1);
  const novo = api.dados.boletos.find(b => b.id !== 41);
  assert.equal(novo.status, 'erro');
  assert.equal(novo.data_vencimento, '2026-10-01');
  assert.equal(novo.substitui_boleto_id, 41);
  assert.equal(api.dados.pedido_parcelas[0].data_vencimento, '2026-09-10', 'a parcela não muda');
  assert.equal(typeof novo.instrucoes, 'string', 'instruções como texto JSON');

  // Tentar de novo pelo pedido (sem data): usa a da reemissão e o mesmo nosso número.
  recusar = false;
  const r2 = await boletos.registrar({ ...base, parcelaIds: [1] });
  assert.equal(r2.registrados, 1, JSON.stringify(r2.resultados));
  assert.equal(api.dados.boletos.length, 2);
  assert.equal(novo.status, 'registrado');
  assert.equal(novo.requisicao.dataVencimento, '01.10.2026');

  const estado = boletos.parcelasComBoletos({ parcelas: api.dados.pedido_parcelas, boletos: api.dados.boletos });
  assert.equal(estado[0].boleto.id, novo.id);
  assert.equal(estado[0].tem_boleto_vivo, true);
  // Só o baixado para reemissão: a tela mostra ele, e a parcela fica livre.
  const soBaixado = boletos.parcelasComBoletos({ parcelas: api.dados.pedido_parcelas, boletos: [tabelas.boletos[0]] });
  assert.equal(soBaixado[0].boleto.id, 41);
  assert.equal(soBaixado[0].tem_boleto_vivo, false);
});
