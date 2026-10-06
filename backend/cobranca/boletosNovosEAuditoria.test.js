/**
 * Pedido do dono de 06/10/2026, na cobrança:
 *
 *  1. PDF sem dados em produção: o boleto IMPORTADO do BB entra sem pagador,
 *     "seu número", instruções e Pix (a lista do banco não traz). A consulta
 *     ao BB completa o que está vazio, o Pix vem de GET /boletos/{id}/pix e,
 *     no que o banco não der, o PDF tira do pedido (cliente e configuração).
 *  2. Boleto novo depois do cancelado, com a data e o valor que se quiser: o
 *     cancelado deixa a parcela livre, a parcela passa a ter a data e o valor
 *     do boleto novo, e o total do pedido muda só com justificativa.
 *  3. Auditoria: quem emitiu, quem registrou o pagamento, se foi automático.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const configuracao = require('./configuracaoCobranca');
const boletos = require('./boletos');
const op = require('./boletoOperacoes');
const doc = require('./boletoDocumento');

const CFG = {
  id: 1, ambiente: 'sandbox', convenio: '3453481', carteira: 17, variacao: 19, especie: 'DM', aceite: false, juros_tipo: 'valor_dia', juros_percentual_mes: 9,
  multa_percentual: 2, multa_dias: 1, protesto_dias: 7, negativacao_dias: null, dias_limite_recebimento: 15, desconto_percentual: 0, desconto_dias: 0,
  indicador_pix: true, proximo_sequencial_sandbox: 1, proximo_sequencial_producao: 394,
  beneficiario_nome: 'SANTISSIMO DECOR LTDA', beneficiario_cnpj: '44039257000122'
};
const CLIENTE = { id: 7, tipo_pessoa: 'PJ', razao_social: 'Jackie Decoracoes LTDA', cnpj: '11222333000181', reg_logradouro: 'Rua Diamante', reg_numero: '504', reg_bairro: 'São Joaquim', reg_cidade: 'Contagem', reg_uf: 'Minas Gerais', reg_cep: '32113000' };
const HOJE = '2026-10-06';

function tabelasBase() {
  return {
    configuracao_cobranca: [{ ...CFG }],
    pedidos: [{ id: 115, numero: 'PED115', situacao: 'Produção', cliente_id: 7, valor_final: 7320.85, ajuste_valor: 0, ajuste_historico: null }],
    pedido_parcelas: [
      { id: 1, pedido_id: 115, numero_parcela: 1, valor: 2440.29, data_vencimento: '2026-10-12' },
      { id: 2, pedido_id: 115, numero_parcela: 2, valor: 2440.28, data_vencimento: '2026-10-26' },
      { id: 3, pedido_id: 115, numero_parcela: 3, valor: 2440.28, data_vencimento: '2026-11-09' }
    ],
    clientes: [{ ...CLIENTE }],
    notas_fiscais: [],
    // As três parcelas com o boleto baixado como cobrança cancelada (o print do PED115).
    boletos: [1, 2, 3].map(n => ({
      id: 390 + n, pedido_id: 115, parcela_id: n, numero_parcela: n, ambiente: 'sandbox', status: 'baixado', motivo_baixa: 'cancelado',
      nosso_numero: `0003453481000000039${6 + n}`, valor: 2440.28, data_vencimento: '2026-10-12', baixado_por: 2, data_baixa: '2026-10-01'
    })),
    boletos_eventos: [],
    usuarios: [{ id: 1, nome: 'Henrique Viana Abade' }, { id: 2, nome: 'Iara Abade' }]
  };
}

function apiFalsa(tabelas = tabelasBase()) {
  const dados = JSON.parse(JSON.stringify(tabelas));
  let proximoId = 2000;
  const tabelaDe = caminho => caminho.replace(/^\/api\//, '').split('/');
  return {
    dados,
    async get(caminho, { query = {} } = {}) {
      const [tabela, id] = tabelaDe(caminho);
      const lista = dados[tabela];
      if (!lista) throw Object.assign(new Error('não há'), { status: 404 });
      if (id) return lista.find(l => String(l.id) === String(id)) || null;
      return lista.filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
    },
    async post(caminho, corpo) {
      const [tabela] = tabelaDe(caminho);
      const lista = dados[tabela];
      if (!lista) throw Object.assign(new Error('não há'), { status: 404 });
      if (tabela === 'boletos' && lista.some(l => l.ambiente === corpo.ambiente && l.nosso_numero === corpo.nosso_numero)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "boletos_nosso_numero_unico"'), { status: 500 });
      }
      const linha = { id: proximoId++, ...corpo };
      lista.push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const [tabela, id] = tabelaDe(caminho);
      const linha = (dados[tabela] || []).find(l => String(l.id) === String(id));
      if (!linha) throw Object.assign(new Error('não há'), { status: 404 });
      Object.assign(linha, corpo);
      return linha;
    }
  };
}

function bbFalso({ detalhe = {}, pix = null, recusar = [] } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async chamar({ corpo, caminho, metodo }) {
      chamadas.push({ caminho, metodo, corpo });
      if (metodo === 'GET' && /\/pix$/.test(caminho)) {
        if (!pix) throw Object.assign(new Error('O BB respondeu 404: boleto sem Pix'), { status: 404 });
        return pix;
      }
      if (metodo === 'GET') return { codigoEstadoTituloCobranca: 1, dataVencimentoTituloCobranca: '12.10.2026', ...detalhe };
      if (recusar.includes(corpo?.valorOriginal)) throw Object.assign(new Error('O BB respondeu 422: valor inválido'), { status: 422 });
      return {
        numero: corpo.numeroTituloCliente, linhaDigitavel: '00190000090345348100800000393173116950000332700', codigoBarraNumerico: '00191169500003327000000003453481000000039317',
        qrCode: { url: 'https://qrcodepix.bb.com.br/x', txId: `tx-${corpo.numeroTituloCliente}`, emv: '000201...' }
      };
    }
  };
}

/** O "R$" do Intl vem com espaço inseparável (NBSP): compara com espaço comum. */
const semNbsp = v => (Array.isArray(v) ? v.map(semNbsp) : String(v).replace(/ /g, ' '));

const registrar = (api, bb, extra = {}) => boletos.registrar({
  api, pedidoId: 115, bb, credenciais: { clientId: 'c', clientSecret: 's' }, appKey: 'k', ambiente: 'sandbox', usuarioId: 1, hoje: HOJE, ...extra
});

// ---------------------------------------------------------------------------
// 1. PDF do boleto importado
// ---------------------------------------------------------------------------

/** O detalhe do BB com o cadastro (os nomes da API Cobranças v2). */
const DETALHE_COM_CADASTRO = {
  codigoTipoInscricaoSacado: 2, numeroInscricaoSacadoCobranca: 1222333000181, nomeSacadoCobranca: 'LA RARITA COMERCIO LTDA',
  textoEnderecoSacadoCobranca: 'RUA DOS GOITACAZES 100', nomeBairroSacadoCobranca: 'CENTRO', nomeMunicipioSacadoCobranca: 'BELO HORIZONTE',
  siglaUnidadeFederacaoSacadoCobranca: 'mg', numeroCepSacadoCobranca: 1310100, numeroTituloCedenteCobranca: 'NF360 P1', dataEmissaoTituloCobranca: '14.09.2026',
  codigoTipoJuroMora: 1, valorJuroMoraTitulo: 6.02, codigoTipoMulta: 2, percentualMultaTitulo: 2, quantidadeDiaProtesto: 7, quantidadeDiaPrazoLimiteRecebimento: 15
};

test('cadastro do BB: pagador (documento e CEP com os zeros da frente), seu número, emissão, juros, multa e protesto', () => {
  const c = op.lerCadastroDoBB(DETALHE_COM_CADASTRO);
  assert.deepEqual(c.pagador, {
    tipo_pessoa: 'PJ', documento: '01222333000181', nome: 'LA RARITA COMERCIO LTDA', endereco: 'RUA DOS GOITACAZES 100',
    bairro: 'CENTRO', cidade: 'BELO HORIZONTE', uf: 'MG', cep: '01310100'
  });
  assert.equal(c.seuNumero, 'NF360 P1');
  assert.equal(c.emissao, '2026-09-14');
  assert.deepEqual([c.jurosValorDia, c.jurosPercentualMes, c.multaPercentual, c.protestoDias, c.diasLimite], [6.02, null, 2, 7, 15]);
  const pf = op.lerCadastroDoBB({ codigoTipoInscricaoSacado: 1, numeroInscricaoSacadoCobranca: 1234567890, nomeSacadoCobranca: 'MARIA', codigoTipoMulta: 0 });
  assert.equal(pf.pagador.documento, '01234567890');
  assert.equal(pf.pagador.tipo_pessoa, 'PF');
  assert.equal(pf.multaPercentual, 0, 'sem multa no BB: zero, não a da configuração');
  assert.equal(op.lerCadastroDoBB({}).pagador, null, 'sem nome: nada de pagador');
});

test('consulta completa SÓ o que está vazio no boleto importado; o que o app gravou continua valendo', () => {
  const importado = { id: 5, status: 'registrado', origem: 'importado', valor: 2006.68, data_vencimento: '2026-10-12', pagador: null, numero_documento: null, instrucoes: null };
  const lido = op.lerDetalhe({ codigoEstadoTituloCobranca: 1, dataVencimentoTituloCobranca: '12.10.2026', ...DETALHE_COM_CADASTRO });
  const { campos } = op.camposDaSincronizacao(importado, lido, { hoje: HOJE, agora: 'T', cfg: CFG });
  assert.equal(campos.pagador.nome, 'LA RARITA COMERCIO LTDA');
  assert.equal(campos.numero_documento, 'NF360 P1');
  assert.equal(campos.data_emissao, '2026-09-14');
  assert.equal(campos.juros_valor_dia, 6.02);
  assert.equal(campos.multa_percentual, 2);
  assert.ok(campos.instrucoes.some(t => /JRS: Vl p\/Dia Atraso R\$6,02/.test(t)), 'as instruções saem das regras do BB');
  assert.ok(campos.instrucoes.some(t => /MULTA DE 2,00%/.test(t)));
  assert.match(op.resumoDaConsulta(importado, lido, campos), /pagador e número do documento completados com o cadastro do BB/);

  const doApp = { ...importado, origem: null, pagador: { nome: 'CLIENTE DO APP' }, numero_documento: 'PED115P1', instrucoes: JSON.stringify(['JRS X']) };
  const r = op.camposDaSincronizacao(doApp, lido, { hoje: HOJE, agora: 'T', cfg: CFG }).campos;
  assert.equal(r.pagador, undefined, 'não passa por cima do pagador gravado no registro');
  assert.equal(r.numero_documento, undefined);
  assert.equal(r.instrucoes, undefined);
});

test('o Pix do BB em qualquer dos formatos; sem emv, nada', () => {
  assert.deepEqual(op.lerPixDoBB({ qrCode: { emv: '0002A', txId: 't1', url: 'u' } }), { pix_emv: '0002A', pix_txid: 't1', pix_url: 'u' });
  assert.deepEqual(op.lerPixDoBB({ emv: '0002B', txId: 't2' }), { pix_emv: '0002B', pix_txid: 't2', pix_url: null });
  assert.equal(op.lerPixDoBB({ qrCode: {} }), null);
  assert.equal(op.lerPixDoBB(null), null);
});

test('antes do PDF: o importado é consultado UMA vez no BB (cadastro + Pix) e fica a marca; falha do BB não impede', async () => {
  configuracao.limparCache();
  const importado = {
    id: 384, pedido_id: 107, parcela_id: 9, numero_parcela: 1, status: 'registrado', origem: 'importado', ambiente: 'producao', convenio: '3453481',
    nosso_numero: '00034534810000000384', valor: 2006.68, data_vencimento: '2026-10-12', pagador: null, numero_documento: null, instrucoes: null, pix_emv: null,
    valor_abatimento: 0, vencimento_original: null, motivo_baixa: null, sincronizado_em: null
  };
  const api = apiFalsa({ boletos: [importado], boletos_eventos: [], recebimentos: [] });
  const bb = bbFalso({ detalhe: DETALHE_COM_CADASTRO, pix: { qrCode: { emv: '00020101PIX', txId: 'tx384', url: 'https://pix' } } });
  const pronto = await op.completarParaDocumento({ api, bb, conexao: { ambiente: 'producao' }, boleto: api.dados.boletos[0], cfg: CFG, hoje: HOJE, usuarioId: 1 });
  assert.equal(pronto.pagador.nome, 'LA RARITA COMERCIO LTDA');
  assert.equal(pronto.numero_documento, 'NF360 P1');
  assert.equal(pronto.pix_emv, '00020101PIX');
  assert.deepEqual(bb.chamadas.map(c => `${c.metodo} ${c.caminho}`), ['GET /boletos/00034534810000000384', 'GET /boletos/00034534810000000384/pix']);
  assert.ok(api.dados.boletos_eventos.some(e => e.tipo === 'completado_para_pdf' && /cadastro consultado no BB; Pix do BB guardado/.test(e.mensagem)));

  // Completo, não vai mais ao BB; e com a marca, nem o que ainda faltasse vai.
  await op.completarParaDocumento({ api, bb, conexao: { ambiente: 'producao' }, boleto: pronto, cfg: CFG, hoje: HOJE });
  await op.completarParaDocumento({ api, bb, conexao: { ambiente: 'producao' }, boleto: { ...pronto, pix_emv: null }, cfg: CFG, hoje: HOJE });
  assert.equal(bb.chamadas.length, 2);

  // BB fora do ar: o boleto volta como estava e a marca diz o que não deu.
  const api2 = apiFalsa({ boletos: [{ ...importado }], boletos_eventos: [], recebimentos: [] });
  const quebrado = { async chamar() { throw new Error('Não foi possível falar com o BB: ECONNRESET'); } };
  const mesmo = await op.completarParaDocumento({ api: api2, bb: quebrado, conexao: { ambiente: 'producao' }, boleto: api2.dados.boletos[0], cfg: CFG, hoje: HOJE });
  assert.equal(mesmo.pagador, null);
  assert.match(api2.dados.boletos_eventos.find(e => e.tipo === 'completado_para_pdf').mensagem, /cadastro não consultado .*ECONNRESET.*Pix não consultado/);
  // Sem conexão (cobrança não pronta), nem tenta.
  assert.equal(await op.completarParaDocumento({ api: api2, bb: quebrado, conexao: null, boleto: importado, cfg: CFG, hoje: HOJE }), importado);
});

test('PDF do importado sem nada do BB: pagador do cliente do pedido, nº do documento PED107P1 e as instruções pelas regras', async () => {
  const importado = {
    id: 384, numero_parcela: 1, status: 'registrado', origem: 'importado', ambiente: 'producao', convenio: '3453481', sequencial: 384,
    nosso_numero: '00034534810000000384', nosso_numero_dv: '5', valor: 2006.68, data_vencimento: '2026-10-12', data_emissao: '2026-09-14',
    pagador: null, numero_documento: null, instrucoes: null, pix_emv: null
  };
  const complemento = op.complementoDoDocumento(importado, { pedido: { id: 107, numero: 'PED107' }, cliente: CLIENTE, cfg: CFG });
  assert.equal(complemento.numeroDocumento, 'PED107P1');
  assert.equal(complemento.pagador.nome, 'JACKIE DECORACOES LTDA');
  const d = doc.dadosDoBoleto(importado, CFG, complemento);
  assert.equal(d.pagador.nome, 'JACKIE DECORACOES LTDA');
  assert.equal(d.pagador.documento, '11.222.333/0001-81');
  assert.match(d.pagador.endereco, /RUA DIAMANTE, 504 - SAO JOAQUIM/);
  assert.match(d.pagador.cidade, /CEP: 32113-000, CONTAGEM - MG/);
  assert.equal(d.numeroDocumento, 'PED107P1');
  assert.ok(d.instrucoes.some(t => /^JRS: Vl p\/Dia Atraso/.test(t)) && d.instrucoes.some(t => /^MULTA DE 2,00%/.test(t)) && d.instrucoes.some(t => /^PROTESTO/.test(t)));
  const { html } = await doc.gerarBoletosHtml(importado, CFG, { complementos: { 384: complemento } });
  assert.ok(html.includes('JACKIE DECORACOES LTDA') && html.includes('PED107P1') && html.includes('MULTA DE 2,00%'));

  // O gravado no boleto vale mais que o complemento.
  const gravado = doc.dadosDoBoleto({ ...importado, pagador: { nome: 'LA RARITA', documento: '01222333000181' }, numero_documento: 'NF360 P1' }, CFG, complemento);
  assert.equal(gravado.pagador.nome, 'LA RARITA');
  assert.equal(gravado.numeroDocumento, 'NF360 P1');
});

// ---------------------------------------------------------------------------
// 2. Boleto novo depois do cancelado, com data e valor escolhidos
// ---------------------------------------------------------------------------

test('cancelado deixa a parcela livre; quitado por fora continua ocupando', () => {
  assert.equal(boletos.ocupaParcela({ status: 'baixado', motivo_baixa: 'cancelado' }), false);
  assert.equal(boletos.ocupaParcela({ status: 'baixado', motivo_baixa: 'quitado_por_fora' }), true);
  assert.equal(boletos.ocupaParcela({ status: 'registrado' }), true);
  const t = tabelasBase();
  const linhas = boletos.parcelasComBoletos({ parcelas: t.pedido_parcelas, boletos: t.boletos });
  assert.deepEqual(linhas.map(l => [l.tem_boleto_vivo, l.cancelado, l.boleto.motivo_baixa]), [[false, true, 'cancelado'], [false, true, 'cancelado'], [false, true, 'cancelado']]);
  // Com um boleto novo vivo, a parcela não está mais "cancelada".
  const comNovo = [...t.boletos, { id: 500, pedido_id: 115, parcela_id: 1, numero_parcela: 1, status: 'registrado' }];
  assert.equal(boletos.canceladoNaParcela(comNovo, t.pedido_parcelas[0]), null);
});

test('conferir data e valor: data que passou, valor zero, parcela não marcada; total diferente pede justificativa', () => {
  const t = tabelasBase();
  const base = { pedido: t.pedidos[0], parcelas: t.pedido_parcelas, alvoIds: new Set([1, 2, 3]), hoje: HOJE };
  assert.throws(() => boletos.conferirAjustes({ ...base, ajustes: { 1: { vencimento: '2026-10-01' } } }), e => e.status === 422 && /já passou/.test(e.message));
  assert.throws(() => boletos.conferirAjustes({ ...base, ajustes: { 1: { valor: 0 } } }), e => e.status === 422 && /Informe o valor da 1ª parcela/.test(e.message));
  assert.throws(() => boletos.conferirAjustes({ ...base, alvoIds: new Set([2]), ajustes: { 1: { valor: 10 } } }), e => /não está marcada/.test(e.message));
  assert.throws(() => boletos.conferirAjustes({ ...base, ajustes: { 9: { valor: 10 } } }), e => /não é deste pedido/.test(e.message));

  // Só a data, ou redistribuir mantendo o total: sem justificativa.
  const data = boletos.conferirAjustes({ ...base, ajustes: { 1: { vencimento: '2026-10-20' } } });
  assert.deepEqual([data.pedidas.size, data.mudaTotal], [1, false]);
  const redistribui = boletos.conferirAjustes({ ...base, ajustes: { 1: { valor: 3000 }, 2: { valor: 1880.57 } } });
  assert.equal(redistribui.mudaTotal, false);

  // Mudou o total: sem justificativa é recusado; com ela, passa.
  assert.throws(() => boletos.conferirAjustes({ ...base, ajustes: { 1: { valor: 3000 } } }), e => e.status === 422 && e.extra.code === 'JUSTIFICATIVA_OBRIGATORIA' && e.extra.ajuste === 559.71);
  const comMotivo = boletos.conferirAjustes({ ...base, ajustes: { 1: { valor: 3000 } }, justificativa: '  juros do atraso combinados  ' });
  assert.deepEqual([comMotivo.mudaTotal, comMotivo.ajuste, comMotivo.somaNova, comMotivo.justificativa], [true, 559.71, 7880.56, 'juros do atraso combinados']);
  assert.equal(semNbsp(boletos.textoDoAjuste(comMotivo.pedidas.get(1))), 'valor R$ 2.440,29 → R$ 3.000,00');
});

test('boletos novos no lugar dos cancelados: data e valor escolhidos, a parcela sobrescreve, ligados ao cancelado, total com justificativa', async () => {
  configuracao.limparCache();
  const api = apiFalsa();
  const bb = bbFalso();
  const r = await registrar(api, bb, {
    parcelaIds: [1, 2],
    ajustes: { 1: { vencimento: '2026-10-20', valor: 3000 }, 2: { vencimento: '2026-11-20' } },
    justificativa: 'Renegociado com o cliente: entrada maior'
  });
  assert.equal(r.registrados, 2);
  const [b1, b2] = r.resultados.map(x => x.boleto);
  assert.deepEqual([b1.valor, b1.data_vencimento, b1.substitui_boleto_id], [3000, '2026-10-20', 391]);
  assert.deepEqual([b2.valor, b2.data_vencimento, b2.substitui_boleto_id], [2440.28, '2026-11-20', 392]);
  assert.equal(bb.chamadas[0].corpo.valorOriginal, 3000);
  assert.equal(bb.chamadas[0].corpo.dataVencimento, '20.10.2026');

  // A parcela ficou com o que o boleto novo tem.
  const [p1, p2, p3] = api.dados.pedido_parcelas;
  assert.deepEqual([p1.valor, p1.data_vencimento], [3000, '2026-10-20']);
  assert.deepEqual([p2.valor, p2.data_vencimento], [2440.28, '2026-11-20']);
  assert.deepEqual([p3.valor, p3.data_vencimento], [2440.28, '2026-11-09'], 'a não marcada não muda');

  // O total do pedido acompanha, com a justificativa no histórico.
  const pedido = api.dados.pedidos[0];
  assert.deepEqual([pedido.valor_final, pedido.ajuste_valor, pedido.ajuste_motivo], [7880.56, 559.71, 'Renegociado com o cliente: entrada maior']);
  const historico = JSON.parse(pedido.ajuste_historico);
  assert.deepEqual([historico[0].total_antes, historico[0].total_depois, historico[0].por, historico[0].origem], [7320.85, 7880.56, 1, 'boletos']);
  assert.deepEqual(r.total, { total_antes: 7320.85, total_depois: 7880.56, ajuste: 559.71 });
  assert.deepEqual(r.parcelas_ajustadas.map(a => [a.numero_parcela, a.valor, a.vencimento]), [[1, 3000, '2026-10-20'], [2, 2440.28, '2026-11-20']]);

  // O histórico do boleto novo diz no lugar de qual saiu e o que mudou.
  const evento = api.dados.boletos_eventos.find(e => e.tipo === 'parcela_ajustada' && e.boleto_id === b1.id);
  assert.match(semNbsp(evento.mensagem), /No lugar do boleto 00034534810000000397 \(cancelado\) · parcela 1: vencimento 12\/10\/2026 → 20\/10\/2026 · valor R\$ 2\.440,29 → R\$ 3\.000,00 · justificativa: Renegociado/);
  assert.equal(evento.usuario_id, 1);

  // Agora a parcela 1 tem boleto vivo; a 3 continua livre.
  const linhas = boletos.parcelasComBoletos({ parcelas: api.dados.pedido_parcelas, boletos: api.dados.boletos });
  assert.deepEqual(linhas.map(l => l.tem_boleto_vivo), [true, true, false]);
});

test('sem justificativa nada vai ao BB; o BB que recusa não muda a parcela nem o total', async () => {
  configuracao.limparCache();
  const api = apiFalsa();
  const bb = bbFalso({ recusar: [3000] });
  await assert.rejects(registrar(api, bb, { parcelaIds: [1], ajustes: { 1: { valor: 3000 } } }), e => e.status === 422 && e.extra.code === 'JUSTIFICATIVA_OBRIGATORIA');
  assert.equal(bb.chamadas.length, 0);

  const r = await registrar(api, bb, { parcelaIds: [1], ajustes: { 1: { valor: 3000 } }, justificativa: 'juros combinados com o cliente' });
  assert.equal(r.erros, 1);
  assert.deepEqual([api.dados.pedido_parcelas[0].valor, api.dados.pedidos[0].valor_final], [2440.29, 7320.85]);
  assert.equal(r.total, null);
});

test('a geração automática (ao emitir a NF-e) não refaz o boleto cancelado', async () => {
  configuracao.limparCache();
  const api = apiFalsa();
  await assert.rejects(registrar(api, bbFalso(), { parcelaIds: [] }), e => e.status === 404 && /Nenhuma parcela/.test(e.message));
  const t = tabelasBase();
  t.pedido_parcelas.push({ id: 4, pedido_id: 115, numero_parcela: 4, valor: 100, data_vencimento: '2026-12-01' });
  const api2 = apiFalsa(t);
  const bb = bbFalso();
  const r = await registrar(api2, bb, { parcelaIds: [] });
  assert.deepEqual(r.resultados.map(x => x.numero_parcela), [4], 'só a parcela sem boleto nenhum');
});

// ---------------------------------------------------------------------------
// 3. Auditoria: quem emitiu, quem registrou o pagamento, se foi automático
// ---------------------------------------------------------------------------

test('auditoria: emitido/importado por quem, no lugar de qual, baixa, pagamento automático ou à mão', () => {
  const nomes = new Map([[1, 'Henrique Viana Abade'], [2, 'Iara Abade']]);
  const emitido = { id: 1, status: 'registrado', criado_por: 1, criado_em: '2026-10-06T13:05:00.000Z', substitui_boleto_id: 391 };
  assert.deepEqual(boletos.auditoriaDaParcela({ boleto: emitido, substituido: { id: 391, nosso_numero: '00034534810000000397', motivo_baixa: 'cancelado' }, nomes }), [
    'Emitido no programa por Henrique Viana Abade em 06/10/2026 10:05',
    'No lugar do boleto 00034534810000000397 (cobrança cancelada)'
  ]);
  assert.deepEqual(boletos.auditoriaDaParcela({ boleto: { status: 'registrado', origem: 'importado', criado_por: 2, criado_em: '2026-09-24T12:00:00Z', data_emissao: '2026-09-14' }, nomes }), [
    'Importado do Banco do Brasil por Iara Abade em 24/09/2026 09:00 (emitido no BB em 14/09/2026)'
  ]);
  const pago = { status: 'pago', criado_por: 1, criado_em: '2026-09-16T12:00:00Z' };
  const automatico = { origem: 'boleto', criado_por: null, criado_em: '2026-10-02T15:00:00Z', data_recebimento: '2026-10-02', valor_recebido: 3327, forma: 'Boleto', canal: 'Pix', evento_id: 9 };
  assert.match(semNbsp(boletos.auditoriaDaParcela({ boleto: pago, recebimento: automatico, nomes })[1]), /^Pago no Banco do Brasil \(em 02\/10\/2026 · R\$ 3\.327,00 · Boleto · Pix\) — baixa AUTOMÁTICA pelo aviso do banco em 02\/10\/2026 12:00$/);
  assert.match(boletos.auditoriaDaParcela({ boleto: pago, recebimento: { ...automatico, evento_id: null }, nomes })[1], /baixa AUTOMÁTICA pela conciliação com o BB/);
  assert.match(boletos.auditoriaDaParcela({ boleto: pago, recebimento: { ...automatico, criado_por: 2 }, nomes })[1], /conferido na consulta ao BB feita por Iara Abade/);
  assert.deepEqual(semNbsp(boletos.auditoriaDaParcela({ recebimento: { origem: 'manual', criado_por: 2, criado_em: '2026-08-20T18:30:00Z', data_recebimento: '2026-08-20', valor_recebido: 3327, forma: 'Pix' }, nomes })), [
    'Pagamento registrado à mão (em 20/08/2026 · R$ 3.327,00 · Pix) por Iara Abade em 20/08/2026 15:30'
  ]);
  assert.match(boletos.auditoriaDaParcela({ boleto: { status: 'baixado', motivo_baixa: 'cancelado', baixado_por: 2, data_baixa: '2026-10-01', observacao_baixa: 'cliente pediu', criado_por: 1 }, nomes })[1],
    /^Baixado \(cobrança cancelada\) por Iara Abade em 01\/10\/2026 — cliente pediu$/);
  assert.match(semNbsp(boletos.auditoriaDaParcela({ boleto: { status: 'pago', data_pagamento: '2026-10-03', valor_pago: 10, criado_por: 9 }, nomes }).join('|')),
    /Emitido no programa por usuário #9.*\|Pago no Banco do Brasil em 03\/10\/2026 \(R\$ 10,00\) — o lançamento no Financeiro ainda vai entrar/);
  assert.deepEqual(boletos.auditoriaDaParcela({}), []);
});

test('a tela recebe a auditoria de cada parcela e o total do pedido (para a data e o valor escolhidos)', () => {
  const t = tabelasBase();
  const nomes = new Map([[2, 'Iara Abade']]);
  const linhas = boletos.parcelasComBoletos({ parcelas: t.pedido_parcelas, boletos: t.boletos, nomes });
  assert.match(linhas[0].auditoria.join('|'), /Baixado \(cobrança cancelada\) por Iara Abade em 01\/10\/2026/);
  const fonte = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'cobrancaController.js'), 'utf8');
  assert.ok(fonte.includes("const linhas = boletos.parcelasComBoletos({ ...dados, nomes });"));
  assert.ok(fonte.includes('valor_final: total, ajuste_valor: ajuste, valor_itens: Math.round((total - ajuste) * 100) / 100'));
  assert.ok(fonte.includes('ajustes, justificativa: req.body?.justificativa ?? null'));
  assert.ok(fonte.includes("eventos: eventos.map(e => ({ ...e, usuario: e.usuario_id ? (nomes.get(Number(e.usuario_id)) || `usuário #${e.usuario_id}`) : null })),"));
});
