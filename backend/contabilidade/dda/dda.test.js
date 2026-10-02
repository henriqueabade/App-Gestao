/**
 * Fase H (02/10/2026) — os boletos contra a empresa (DDA do BB), as partes
 * puras: o cliente da API (bbDda), o casamento boleto × conta a pagar, o
 * Espelho DDA, a obrigação na conciliação e as pendências do painel.
 *
 * O que fica preso:
 *   - a consulta é a do Swagger 1.0.1: GET /boletos com gw-dev-app-key,
 *     numeroProximoRegistro (começa em 1, segue o da resposta enquanto
 *     indicadorContinuidade = S), datas dd/mm/aaaa, um pedido por estado;
 *     período maior que 1 ano vira mais de uma consulta;
 *   - o cabeçalho de teste só vai na homologação e só se foi informado;
 *   - a chave interna é um SHA-256 estável (muda com o valor);
 *   - a linha digitável é calculada do código de barras;
 *   - liga sozinho só com a mesma linha digitável ou CNPJ + valor + vencimento
 *     a até 3 dias, com o par único; o resto é sugestão (inclusive a nota);
 *   - o espelho traz o rodapé do BB palavra por palavra;
 *   - o boleto liquidado sem conta é obrigação; o liquidado ligado a uma
 *     parcela deixa o débito conciliar sozinho;
 *   - boleto do mês sem conta é aviso; pagamento por boleto sem o boleto é
 *     documental só com o DDA ligado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const calculo = require('../../cobranca/boletoCalculo');
const bbDda = require('../integracoes/bbDda');
const dda = require('./dda');
const espelho = require('./espelho');
const L = require('../conciliacao/liquidacoes');
const motor = require('../conciliacao/motor');
const checklist = require('../checklist');

const EMPRESA = '11444777000161';
const VIDROS = '57248237000103';
const barras = (vencimento, valor, n, banco = '237') => calculo.codigoBarras({ vencimento, valor, campoLivre: String(n).padStart(25, '0'), banco });

/** Um objeto da lista do BB (Swagger 1.0.1). */
const objeto = ({ venc = '10/09/2026', valor = 2500, cnpj = VIDROS, nome = 'VIDROS NORTE LTDA', seu = 'NF 4521/1', codigo = null, finalCnpj = null, finalNome = null } = {}) => ({
  objetoObrigacao: {
    valorVencimentoObrigacao: valor, codigoIdentificadorDocumentoCobranca: seu,
    numeroIdentificadorBeneficiario: cnpj, codigoTipoPessoaBeneficiario: 'J', nomeBeneficiarioObrigacao: nome,
    codigoTipoPessoaBeneficiarioFim: 'J', numeroIdentificadorBeneficiarioFim: finalCnpj || cnpj, nomeBeneficiarioFimObrigacao: finalNome || nome,
    dataRegistroObrigacao: '20/08/2026', dataVencimentoObrigacao: venc,
    textoCodigoBarrasObrigacao: codigo || barras(venc.split('/').reverse().join('-'), valor, 1)
  }
});

const json = (status, dados) => ({ status, corpo: Buffer.from(JSON.stringify(dados)) });

test('bbDda: datas dd/mm/aaaa, documento com os zeros, valor americano, linha digitável calculada do código de barras', () => {
  assert.equal(bbDda.dataBB('2026-09-01'), '01/09/2026');
  assert.equal(bbDda.lerData('28/02/2025'), '2025-02-28');
  assert.equal(bbDda.lerData('2025-02-28T00:00:00'), '2025-02-28');
  assert.equal(bbDda.lerData('31/13/2025'), null);
  assert.equal(bbDda.documentoDe('86409841115', 'F'), '86409841115');
  assert.equal(bbDda.documentoDe('1444777000161', 'J'), '01444777000161', 'CNPJ sem o zero da frente');
  assert.equal(bbDda.documentoDe('4HVMEWJW000130', 'J'), '4HVMEWJW000130', 'o CNPJ alfanumérico');
  assert.equal(bbDda.documentoDe('0', 'J'), null);
  assert.equal(bbDda.valorDe('250185.90'), 250185.9);
  assert.equal(bbDda.valorDe(0), null);
  const codigo = barras('2026-09-10', 2500, 7);
  assert.equal(bbDda.linhaDe(codigo), calculo.linhaDigitavel(codigo).digitos);
  assert.equal(bbDda.linhaDe(codigo).length, 47);
  assert.equal(bbDda.linhaDe('8'.repeat(44)), null, 'arrecadação (começa com 8) não tem a linha de boleto');
  assert.equal(bbDda.linhaDe('123'), null);
});

test('bbDda: o boleto da lista vira o do app; a chave interna é estável e muda com o valor', () => {
  const b1 = bbDda.boletoDe(objeto(), { estado: 3, pagador: EMPRESA });
  assert.deepEqual(
    [b1.beneficiario_documento, b1.beneficiario_nome, b1.seu_numero, b1.vencimento, b1.valor, b1.data_registro, b1.estado, b1.pagador_documento, b1.codigo_barras.length, b1.linha_digitavel.length],
    [VIDROS, 'VIDROS NORTE LTDA', 'NF 4521/1', '2026-09-10', 2500, '2026-08-20', 3, EMPRESA, 44, 47]
  );
  assert.equal(b1.beneficiario_final_documento, VIDROS, 'sem intermediário, o final é o próprio beneficiário');
  const comFinal = bbDda.boletoDe(objeto({ finalCnpj: '84031759000121', finalNome: 'FACTORING X' }), { estado: 1 });
  assert.deepEqual([comFinal.beneficiario_final_documento, comFinal.beneficiario_final_nome], ['84031759000121', 'FACTORING X']);
  assert.equal(bbDda.boletoDe(objeto({ seu: '' }), { estado: 1 }).seu_numero, null, 'o seu número pode vir vazio');
  assert.equal(bbDda.boletoDe({ objetoObrigacao: { ...objeto().objetoObrigacao, textoCodigoBarrasObrigacao: '123' } }, { estado: 1 }), null);
  const k = bbDda.chaveInterna(b1);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(bbDda.chaveInterna({ ...b1 }), k);
  assert.notEqual(bbDda.chaveInterna({ ...b1, valor: 2500.01 }), k);
  assert.equal(bbDda.chaveInterna({ ...b1, estado: 1 }), k, 'o estado não entra na chave (o boleto muda de estado)');
});

test('bbDda.buscar: GET /boletos por estado, páginas pelo numeroProximoRegistro, mais de 1 ano em duas consultas, cabeçalho de teste só na homologação', async () => {
  const chamadas = [];
  const transporte = async (url, { metodo = 'GET', cabecalhos = {} } = {}) => {
    chamadas.push({ url, metodo, cabecalhos });
    if (url.includes('/oauth/token')) return json(200, { access_token: 'tk', token_type: 'Bearer', expires_in: 600, scope: 'dda-info' });
    const q = new URL(url).searchParams;
    const estado = Number(q.get('codigoEstadoObrigacao'));
    const proximo = Number(q.get('numeroProximoRegistro'));
    if (estado === 2) return json(404, { erros: [{ mensagemErro: 'Nenhum boleto' }] });
    if (estado === 1 && proximo === 1) {
      return json(200, { indicadorContinuidade: 'S', quantidadeListaTitulo: 1, numeroProximoRegistro: 151, numeroIdentificadorPagador: EMPRESA, codigoTipoPessoaPagador: 'J', codigoEstadoObrigacao: 1,
        listaTitulo: [objeto({ venc: '15/09/2026', valor: 300, seu: 'A' })] });
    }
    if (estado === 1 && proximo === 151) {
      return json(200, { indicadorContinuidade: 'N', quantidadeListaTitulo: 2, numeroProximoRegistro: 0, numeroIdentificadorPagador: EMPRESA, codigoTipoPessoaPagador: 'J', codigoEstadoObrigacao: 1,
        listaTitulo: [objeto({ venc: '20/09/2026', valor: 400, seu: 'B' }), { objetoObrigacao: { textoCodigoBarrasObrigacao: 'xx' } }] });
    }
    return json(200, { indicadorContinuidade: 'N', quantidadeListaTitulo: 1, numeroProximoRegistro: 0, numeroIdentificadorPagador: EMPRESA, codigoTipoPessoaPagador: 'J', codigoEstadoObrigacao: 3,
      listaTitulo: [objeto({ venc: '10/09/2026', valor: 2500 })] });
  };
  const r = await bbDda.buscar({
    transporte, urlOauth: 'https://oauth.hm.bb.com.br/oauth/token', urlApi: 'https://dda.mtls.api.hm.bb.com.br/v1/',
    credenciais: { clientId: 'cid', secret: 'sec', appKey: 'app' }, escopo: 'dda-info', ambiente: 'homologacao', mciTeste: '999',
    inicio: '2026-08-01', fim: '2026-10-31', estados: [1, 2, 3]
  });
  assert.deepEqual(r.boletos.map(x => [x.vencimento, x.valor, x.estado]), [['2026-09-10', 2500, 3], ['2026-09-15', 300, 1], ['2026-09-20', 400, 1]]);
  assert.deepEqual([r.consultas, r.invalidos, r.pagador, r.escopos], [4, 1, EMPRESA, ['dda-info']]);
  const consultas = chamadas.filter(x => x.url.includes('/boletos'));
  const q = new URL(consultas[0].url).searchParams;
  assert.equal(new URL(consultas[0].url).pathname, '/v1/boletos');
  assert.deepEqual([q.get('gw-dev-app-key'), q.get('numeroProximoRegistro'), q.get('dataVencimentoInicial'), q.get('dataVencimentoFinal'), q.get('codigoEstadoObrigacao')],
    ['app', '1', '01/08/2026', '31/10/2026', '1']);
  assert.equal(new URL(consultas[1].url).searchParams.get('numeroProximoRegistro'), '151', 'a página seguinte pelo número da resposta');
  assert.equal(consultas[0].cabecalhos['x-br-com-bb-ipa-mciteste'], '999');
  assert.equal(consultas[0].cabecalhos.Authorization, 'Bearer tk');

  // Produção: o cabeçalho de teste nunca vai; período de 400 dias = 2 consultas por estado.
  chamadas.length = 0;
  const p = await bbDda.buscar({
    transporte, urlOauth: 'https://oauth.bb.com.br/oauth/token', urlApi: 'https://dda.mtls.api.bb.com.br/v1',
    credenciais: { clientId: 'cid', secret: 'sec', appKey: 'app' }, escopo: 'dda-info', ambiente: 'producao', mciTeste: '999',
    inicio: '2026-01-01', fim: '2027-02-04', estados: [3]
  });
  const janelas = chamadas.filter(x => x.url.includes('/boletos')).map(x => [new URL(x.url).searchParams.get('dataVencimentoInicial'), new URL(x.url).searchParams.get('dataVencimentoFinal')]);
  assert.deepEqual(janelas, [['01/01/2026', '26/12/2026'], ['27/12/2026', '04/02/2027']]);
  assert.ok(chamadas.every(x => !x.cabecalhos['x-br-com-bb-ipa-mciteste']));
  assert.equal(p.boletos.length, 1, 'o mesmo boleto nas duas janelas conta uma vez');
  await assert.rejects(bbDda.buscar({ transporte, urlOauth: 'x', urlApi: 'y', credenciais: {}, ambiente: 'producao', inicio: '2026-01-02', fim: '2026-01-01' }), /Período inválido/);
});

// ------------------------------------------------------------------ casamento

const titulo = (id, { descricao = 'Vidros — NF 4521', contato_id = 7, parcelas = [], status = 'aberto', fornecedor = 'Vidros Norte' } = {}) => ({
  id, descricao, contato_id, status, fornecedor, competencia: '2026-09',
  parcelas: parcelas.map((p, i) => ({ id: p.id, numero: i + 1, de: parcelas.length, vencimento: p.vencimento, valor: p.valor, linha_digitavel: p.linha || null, situacao: p.situacao || 'a_vencer', situacao_rotulo: 'A vencer', pagamento: p.pagamento || null }))
});
const boletoApp = (id, extra = {}) => {
  const venc = extra.vencimento || '2026-09-10';
  const valor = extra.valor ?? 2500;
  const codigo = extra.codigo_barras || barras(venc, valor, id);
  return dda.normalizar({
    id, chave_interna: `k${id}`, situacao: 'novo', estado_bb: 1, estados: '[]', beneficiario_documento: VIDROS, beneficiario_final_documento: VIDROS,
    beneficiario_nome: 'VIDROS NORTE LTDA', beneficiario_final_nome: 'VIDROS NORTE LTDA', vencimento: venc, valor, codigo_barras: codigo,
    linha_digitavel: bbDda.linhaDe(codigo), ...extra
  });
};
const CONTATOS = new Map([['7', { id: 7, nome: 'Vidros Norte', cnpj: '57.248.237/0001-03' }], ['8', { id: 8, nome: 'Madeireira Ipê', cnpj: '84031759000121' }]]);

test('casar: a mesma linha digitável liga sozinha; CNPJ + valor + vencimento a até 3 dias também; o resto é sugestão', () => {
  const b1 = boletoApp(1);
  const b2 = boletoApp(2, { vencimento: '2026-10-10', valor: 2500 });
  const b3 = boletoApp(3, { vencimento: '2026-11-10', valor: 999 });
  const titulos = [
    titulo(10, { parcelas: [{ id: 100, vencimento: '2026-09-01', valor: 2500, linha: b1.linha_digitavel }] }),
    titulo(11, { parcelas: [{ id: 110, vencimento: '2026-10-12', valor: 2500 }] }),
    titulo(12, { parcelas: [{ id: 120, vencimento: '2026-11-10', valor: 1000 }] })
  ];
  const r = dda.casar({ boletos: [b1, b2, b3], titulos, contatos: CONTATOS });
  assert.deepEqual([r.get(1).automatico.parcela_id, r.get(1).automatico.criterio], [100, 'linha_digitavel'], 'a linha digitável vence a data diferente');
  assert.deepEqual([r.get(2).automatico.parcela_id, r.get(2).automatico.criterio], [110, 'cnpj_valor_vencimento']);
  assert.equal(r.get(3).automatico, null, 'valor diferente nunca liga sozinho');
  assert.deepEqual(r.get(3).sugestoes.map(s => s.parcela_id), [120], 'mesmo CNPJ e vencimento: sugestão (juros/desconto)');
  assert.match(r.get(3).sugestoes[0].motivos.join(' '), /valor diferente/);
});

test('casar: dois boletos para a mesma parcela não ligam sozinhos; parcela já ligada não é candidata; outra filial e o nome são só sugestão', () => {
  const a = boletoApp(1, { vencimento: '2026-09-10' });
  const b = boletoApp(2, { vencimento: '2026-09-11', codigo_barras: barras('2026-09-11', 2500, 22) });
  const t = [titulo(10, { parcelas: [{ id: 100, vencimento: '2026-09-10', valor: 2500 }] })];
  const r = dda.casar({ boletos: [a, b], titulos: t, contatos: CONTATOS });
  assert.equal(r.get(1).automatico, null);
  assert.equal(r.get(2).automatico, null);
  assert.equal(r.get(1).sugestoes[0].parcela_id, 100);
  const ligado = boletoApp(3, { situacao: 'vinculado', parcela_id: 100 });
  const r2 = dda.casar({ boletos: [a, ligado], titulos: t, contatos: CONTATOS });
  assert.deepEqual(r2.get(1).sugestoes, [], 'a parcela já é de outro boleto');
  assert.equal(r2.has(3), false, 'só os boletos sem conta entram');
  const filial = boletoApp(4, { beneficiario_documento: '57248237000285', beneficiario_final_documento: '57248237000285' });
  const rf = dda.casar({ boletos: [filial], titulos: t, contatos: CONTATOS }).get(4);
  assert.deepEqual([rf.automatico, rf.sugestoes[0].parcela_id, rf.sugestoes[0].motivos[0]], [null, 100, 'mesma empresa (outra filial)']);
  const semCnpj = dda.casar({ boletos: [boletoApp(5)], titulos: [titulo(13, { contato_id: null, fornecedor: null, descricao: 'Vidros Norte — espelhos', parcelas: [{ id: 130, vencimento: '2026-09-10', valor: 2500 }] })], contatos: CONTATOS }).get(5);
  assert.deepEqual([semCnpj.automatico, semCnpj.sugestoes[0].motivos[0]], [null, 'nome do beneficiário']);
});

test('casar: a nota registrada sem conta do mesmo CNPJ vira sugestão (nunca liga sozinha); a conta cancelada fica de fora', () => {
  const doc = { id: 40, tipo: 'nfe', numero: '4521', emitente_documento: VIDROS, emitente_nome: 'Vidros Norte LTDA', data_emissao: '2026-08-28', competencia: '2026-08', valor_total: 5000 };
  const r = dda.casar({
    boletos: [boletoApp(1)], titulos: [titulo(10, { status: 'cancelado', parcelas: [{ id: 100, vencimento: '2026-09-10', valor: 2500 }] })],
    documentos: [doc], contatos: CONTATOS, contasPorDocumento: new Map()
  }).get(1);
  assert.equal(r.automatico, null);
  assert.deepEqual(r.sugestoes.map(s => [s.tipo, s.documento_recebido_id]), [['documento', 40]]);
  assert.match(r.sugestoes[0].motivos.join(' '), /parte da nota de R\$/);
  const comConta = dda.casar({ boletos: [boletoApp(1)], documentos: [doc], contasPorDocumento: new Map([['40', [{ id: 1, status: 'aberto' }]]]) }).get(1);
  assert.deepEqual(comConta.sugestoes, [], 'a nota que já tem conta não é sugestão');
});

test('a conta preenchida do boleto, a parcela do boleto na conta lançada e a linha impressa', () => {
  const bol = boletoApp(1, { seu_numero: 'NF 4521/1' });
  const conta = dda.contaSugerida(bol, { contatos: CONTATOS });
  assert.deepEqual([conta.descricao, conta.contato_id, conta.numero_documento, conta.competencia, conta.valor_total, conta.parcelas[0].vencimento, conta.parcelas[0].linha_digitavel],
    ['Boleto — Vidros Norte', 7, 'NF 4521/1', '2026-09', 2500, '2026-09-10', bol.linha_digitavel]);
  const comNota = dda.contaSugerida(bol, { contatos: CONTATOS, documento: { rotulo: 'NF-e 4521', documento_recebido_id: 40, data_emissao: '2026-08-28', competencia: '2026-08' } });
  assert.deepEqual([comNota.descricao, comNota.documento_recebido_id, comNota.competencia], ['NF-e 4521 — Vidros Norte', 40, '2026-08']);
  const parcelas = [{ id: 1, vencimento: '2026-08-10', valor: 2500 }, { id: 2, vencimento: '2026-09-10', valor: 2500 }];
  assert.equal(dda.parcelaDoBoleto(bol, parcelas).id, 2, 'mesmo vencimento e valor');
  assert.equal(dda.parcelaDoBoleto(bol, [{ id: 3, vencimento: '2026-09-01', valor: 9, linha_digitavel: bol.linha_digitavel }, ...parcelas]).id, 3, 'a linha digitável primeiro');
  assert.equal(dda.parcelaDoBoleto(bol, [{ id: 4, vencimento: '2026-12-01', valor: 1 }]).id, 4, 'a única');
  assert.match(dda.linhaImpressa(bol.linha_digitavel), /^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/);
});

test('Espelho DDA: só os dados do BB, a linha digitável marcada como calculada, as barras e o rodapé do BB palavra por palavra', () => {
  const bol = boletoApp(1, { seu_numero: 'NF 4521/1', estado_bb: 3, estados: JSON.stringify([{ estado: 1, visto_em: '2026-09-01T12:00:00Z' }, { estado: 3, de: 1, visto_em: '2026-09-11T12:00:00Z' }]), capturado_em: '2026-09-01T12:00:00Z', ambiente: 'producao', data_registro: '2026-08-20' });
  const html = espelho.montarHtml(bol, { empresa: { razao_social: 'SANTISSIMO DECOR LTDA', cnpj: EMPRESA }, geradoEm: '2026-10-02T15:00:00Z' });
  assert.ok(html.includes('Documento interno gerado pelo App-Gestão a partir de dados obtidos diretamente da API DDA do Banco do Brasil. Não constitui segunda via ou representação gráfica oficial do boleto.'));
  assert.ok(html.includes('CALCULADA pelo app') && html.includes(bol.codigo_barras) && html.includes('<svg'));
  assert.ok(html.includes('ID interno do App-Gestão (não é identificador do BB)'));
  assert.ok(html.includes('Liquidado') && html.includes('A pagar em 01/09/2026'));
  assert.ok(html.includes('57.248.237/0001-03') && html.includes('11.444.777/0001-61'));
  assert.doesNotMatch(html, /nosso n[uú]mero|juros|multa/i, 'o que o DDA não dá não aparece');
  assert.equal(espelho.nomeDoArquivo(bol), 'Espelho DDA 10-09-2026 VIDROS NORTE LTDA 2500,00.pdf');
});

test('conciliação: o boleto liquidado sem conta é obrigação; o liquidado ligado à parcela deixa o débito conciliar sozinho', () => {
  const obrig = L.deBoletoDda({ id: 5, beneficiario_nome: 'VIDROS NORTE LTDA', beneficiario_documento: VIDROS, vencimento: '2026-09-10', valor: '2500.00', estado_bb: 3, seu_numero: 'NF 4521/1' });
  assert.deepEqual([obrig.chave, obrig.valor, obrig.obrigacao, obrig.dda_boleto_id, obrig.dda_liquidado, obrig.forma, obrig.documento], ['dda:5', -2500, true, 5, true, 'Boleto', VIDROS]);
  const mov = (id, data, valor, extra = {}) => ({ id, data, valor, restante: Math.abs(valor), descricao: extra.descricao || 'PAGAMENTO DE BOLETO', documento: null, contrapartida_documento: extra.cnpj || null });
  const comRestante = l => ({ ...l, restante: l.valor_abs });
  assert.equal(motor.sugerir([mov(1, '2026-09-12', -2500)], [comRestante(obrig)]).get(1).tipo, 'automatico', 'liquidado no DDA, mesmo valor, 2 dias');
  assert.equal(motor.sugerir([mov(2, '2026-09-20', -2500)], [comRestante(obrig)]).get(2).tipo, 'sugestao', 'a 10 dias, só com o CNPJ');
  assert.equal(motor.sugerir([mov(3, '2026-09-20', -2500, { cnpj: VIDROS })], [comRestante(obrig)]).get(3).tipo, 'automatico');
  const parcela = comRestante(L.deParcela({ id: 31, numero: 1, vencimento: '2026-09-10', valor: 2500 }, {
    titulo: { id: 9, descricao: 'Espelhos', contato_id: null }, boleto: { estado_bb: 3, beneficiario_nome: 'VIDROS NORTE LTDA', beneficiario_documento: VIDROS }
  }));
  assert.deepEqual([parcela.dda_liquidado, parcela.documento, parcela.nome], [true, VIDROS, 'VIDROS NORTE LTDA'], 'a conta sem fornecedor pega o CNPJ do beneficiário');
  assert.match(parcela.detalhe, /liquidado no DDA/);
  const s = motor.sugerir([mov(4, '2026-09-11', -2500, { descricao: 'PAGTO TITULO' })], [parcela]).get(4);
  assert.deepEqual([s.tipo, s.motivos.includes('liquidado no DDA')], ['automatico', true]);
  const aberta = comRestante(L.deParcela({ id: 32, numero: 1, vencimento: '2026-09-10', valor: 2500 }, { titulo: { id: 9, descricao: 'Espelhos', contato_id: null } }));
  assert.equal(motor.sugerir([mov(5, '2026-09-11', -2500, { descricao: 'PAGTO TITULO' })], [aberta]).get(5).tipo, 'sugestao', 'sem o DDA, sem nome e sem CNPJ: sugestão');
});

test('painel: boleto do mês sem conta é aviso; liquidado com a conta aberta é aviso; pagamento por boleto sem o boleto é documental só com o DDA ligado', () => {
  const pago = { id: 900, data: '2026-09-10', valor_pago: 2500, forma: 'Boleto' };
  const pagar = {
    titulos: [
      titulo(10, { parcelas: [{ id: 100, vencimento: '2026-09-10', valor: 2500, situacao: 'paga', pagamento: pago }] }),
      titulo(11, { parcelas: [{ id: 110, vencimento: '2026-09-20', valor: 800 }] })
    ].map(t => ({ ...t, documento_recebido_id: 1, categoria: null })),
    documentos: [{ id: 1 }], arquivosMapa: new Map([['pagamento:900', [{ categoria: 'comprovante' }]]]),
    dda: [
      { id: 1, situacao: 'novo', vencimento: '2026-09-15', valor: '300.00', estado_bb: 1 },
      { id: 2, situacao: 'novo', vencimento: '2026-10-15', valor: '700.00', estado_bb: 1 },
      { id: 3, situacao: 'vinculado', parcela_id: 110, vencimento: '2026-09-20', valor: '800.00', estado_bb: 3 },
      { id: 4, situacao: 'contestado', vencimento: '2026-09-05', valor: '50.00', estado_bb: 1 }
    ]
  };
  const sem = checklist.fonteContasPagar({ pagar, competencia: '2026-09', hoje: '2026-10-02' });
  const chaves = sem.pendencias.map(p => [p.chave, p.nivel]);
  assert.deepEqual(chaves.filter(([k]) => k.startsWith('dda_') || k === 'pagar_sem_boleto'), [['dda_sem_conta', 'aviso'], ['dda_pago_em_aberto', 'aviso']]);
  assert.match(sem.pendencias.find(p => p.chave === 'dda_sem_conta').titulo, /^1 boleto do DDA sem conta a pagar$/);
  assert.deepEqual(sem.pendencias.find(p => p.chave === 'dda_sem_conta').filtro, { acao: 'dda', visao: 'sem_conta' });
  const com = checklist.fonteContasPagar({ pagar, competencia: '2026-09', hoje: '2026-10-02', ddaAtivo: true });
  const semBoleto = com.pendencias.find(p => p.chave === 'pagar_sem_boleto');
  assert.deepEqual([semBoleto.nivel, semBoleto.titulo], ['documental', '1 pagamento por boleto sem o boleto']);
  assert.deepEqual([com.numeros.dda_sem_conta, com.numeros.dda_pago_em_aberto, com.numeros.sem_boleto], [1, 1, 1]);
  // O boleto ligado à parcela (ou o PDF do boleto anexado) resolve.
  const ligado = { ...pagar, dda: [...pagar.dda, { id: 5, situacao: 'vinculado', parcela_id: 100, vencimento: '2026-09-10', valor: '2500.00', estado_bb: 3 }] };
  assert.equal(checklist.fonteContasPagar({ pagar: ligado, competencia: '2026-09', hoje: '2026-10-02', ddaAtivo: true }).pendencias.some(p => p.chave === 'pagar_sem_boleto'), false);
  const anexado = { ...pagar, arquivosMapa: new Map([['pagamento:900', [{ categoria: 'comprovante' }, { categoria: 'boleto' }]]]) };
  assert.equal(checklist.fonteContasPagar({ pagar: anexado, competencia: '2026-09', hoje: '2026-10-02', ddaAtivo: true }).pendencias.some(p => p.chave === 'pagar_sem_boleto'), false);
  // Sem o SQL da fase H: nada do DDA.
  assert.equal(checklist.fonteContasPagar({ pagar: { ...pagar, dda: null }, competencia: '2026-09', hoje: '2026-10-02', ddaAtivo: true }).pendencias.some(p => /dda|boleto/.test(p.chave)), false);
});
