/**
 * Alterações, baixa e consulta de boletos já registrados no BB — fase D.
 *
 *   sincronizar  GET   /boletos/{nosso número}?numeroConvenio= → estado,
 *                pagamento, vencimento e abatimento que valem no banco
 *   prorrogar    PATCH /boletos/{nosso número} com a nova data; se a multa
 *                do BB ficou para antes do novo vencimento, outro PATCH a leva
 *   abatimento   PATCH (inclui ou altera o abatimento)
 *   baixar       POST  /boletos/{nosso número}/baixar — quitado por fora,
 *                cancelado ou reemissão (baixa e registra outro na parcela)
 *
 * A alteração leva todos os indicadores da API: um "S" (o que muda) e os
 * demais "N". O BB é a verdade: depois de mexer, o app consulta de novo.
 * Cada passo deixa rastro em boletos_eventos. Nada vai para o cliente.
 */
const calculo = require('./boletoCalculo');
const bbBoleto = require('./bbBoleto');
const boletos = require('./boletos');
const recebimentos = require('./recebimentos');

/** codigoEstadoTituloCobranca (documentação da API Cobranças v2). */
const ESTADOS_BB = {
  1: 'NORMAL', 2: 'MOVIMENTO CARTORIO', 3: 'EM CARTORIO', 4: 'TITULO COM OCORRENCIA DE CARTORIO', 5: 'PROTESTADO ELETRONICO',
  6: 'LIQUIDADO', 7: 'BAIXADO', 8: 'TITULO COM PENDENCIA DE CARTORIO', 9: 'TITULO PROTESTADO MANUAL', 10: 'TITULO BAIXADO/PAGO EM CARTORIO',
  11: 'TITULO LIQUIDADO/PROTESTADO', 12: 'TITULO LIQUID/PGCRTO', 13: 'TITULO PROTESTADO AGUARDANDO BAIXA', 14: 'TITULO EM LIQUIDACAO',
  15: 'TITULO AGENDADO', 16: 'TITULO CREDITADO', 17: 'PAGO EM CHEQUE - AGUARD.LIQUIDACAO', 18: 'PAGO PARCIALMENTE',
  19: 'PAGO PARCIALMENTE CREDITADO', 21: 'TITULO AGENDADO COMPE', 80: 'EM PROCESSAMENTO'
};
/** codigoTipoBaixaTitulo. */
const TIPOS_BAIXA_BB = {
  1: 'BAIXADO POR SOLICITACAO', 2: 'ENTREGA FRANCO PAGAMENTO', 9: 'COMANDADA BANCO', 10: 'COMANDADA CLIENTE - ARQUIVO', 11: 'COMANDADA CLIENTE - ON-LINE',
  12: 'DECURSO PRAZO - CLIENTE', 13: 'DECURSO PRAZO - BANCO', 15: 'PROTESTADO', 31: 'LIQUIDADO ANTERIORMENTE', 32: 'HABILITADO EM PROCESSO',
  35: 'TRANSFERIDO PARA PERDAS', 51: 'REGISTRADO INDEVIDAMENTE', 90: 'BAIXA AUTOMATICA'
};
const ESTADOS_PAGOS = new Set([6, 10, 11, 12, 16]);
const ESTADOS_PROTESTADOS = new Set([5, 9, 13]);
const ESTADOS_EM_CARTORIO = new Set([2, 3, 4, 8]);
// Os demais (14, 15, 17, 18, 19, 21, 80) são transitórios: o app espera o banco decidir.

/** codigoCanalPagamento: 1º dígito = forma; os dois últimos = onde foi pago. */
const FORMAS_NO_BB = { 1: 'espécie', 2: 'débito em conta', 3: 'cartão de crédito', 4: 'cheque' };
const LOCAIS_NO_BB = { 1: 'agência', 2: 'autoatendimento', 3: 'internet', 5: 'correspondente bancário', 6: 'central de atendimento', 7: 'arquivo eletrônico', 8: 'DDA', 61: 'Pix' };

/** Motivos que a tela oferece; "banco" é a baixa que o próprio BB fez (prazo, protesto…). */
const MOTIVOS_BAIXA = { quitado_por_fora: 'quitado por fora', cancelado: 'cancelado', reemissao: 'reemissão', banco: 'baixado pelo banco', quitacao_estornada: 'quitação estornada' };
const MOTIVOS_ESCOLHIVEIS = ['quitado_por_fora', 'cancelado', 'reemissao'];
const FORMAS_RECEBIMENTO = recebimentos.FORMAS;

/** Os indicadores do PATCH /boletos/{id}: todos vão, um com "S". */
const INDICADORES = [
  'indicadorNovaDataVencimento', 'indicadorNovoValorNominal', 'indicadorAtribuirDesconto', 'indicadorAlterarDesconto', 'indicadorAlterarDataDesconto',
  'indicadorProtestar', 'indicadorSustacaoProtesto', 'indicadorCancelarProtesto', 'indicadorIncluirAbatimento', 'indicadorAlterarAbatimento',
  'indicadorCobrarJuros', 'indicadorDispensarJuros', 'indicadorCobrarMulta', 'indicadorDispensarMulta', 'indicadorNegativar',
  'indicadorAlterarSeuNumero', 'indicadorAlterarEnderecoPagador', 'indicadorAlterarPrazoBoletoVencido'
];

const STATUS_ALTERAVEIS = new Set(['registrado', 'vencido']);
const STATUS_BAIXAVEIS = new Set(['registrado', 'vencido', 'protestado']);
const STATUS_CONSULTAVEIS = new Set(['registrado', 'vencido', 'protestado', 'pago', 'baixado']);
/** Colunas de sql/cobranca_alteracoes.sql: sem elas a API ignora o que a fase D grava. */
const COLUNAS_DA_FASE = ['valor_abatimento', 'vencimento_original', 'motivo_baixa', 'sincronizado_em'];

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

const digitos = v => String(v ?? '').replace(/\D/g, '');
const centavos = v => Math.round(Number(v) * 100) / 100;
const numero = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const dia = v => String(v || '').slice(0, 10);
const impressa = iso => calculo.dataImpressa(iso);
const reais = v => `R$ ${calculo.valorImpresso(v)}`;

/** 'YYYY-MM-DD' de verdade (31/02 não passa). */
function dataValida(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** 'dd.mm.aaaa' do BB → 'YYYY-MM-DD' (vazio ou "00.00.0000" → null). */
function isoDoBB(v) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(v || '').trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return dataValida(iso) ? iso : null;
}

function canalDePagamento(codigo) {
  const n = Number(codigo);
  if (!Number.isInteger(n) || n <= 0) return null;
  const forma = FORMAS_NO_BB[Math.floor(n / 100)];
  const local = LOCAIS_NO_BB[n % 100];
  if (local === 'Pix') return 'Pix';
  if (!forma && !local) return `canal ${n}`;
  return [local, forma].filter(Boolean).join(' · ');
}

/** O detalhe do GET /boletos/{id} no que o app usa. */
function lerDetalhe(detalhe) {
  const r = detalhe || {};
  const codigo = numero(r.codigoEstadoTituloCobranca);
  const tipoBaixa = numero(r.codigoTipoBaixaTitulo);
  const linha = digitos(r.codigoLinhaDigitavel);
  const barras = digitos(r.textoCodigoBarrasTituloCobranca);
  return {
    codigo,
    situacao: codigo !== null ? (ESTADOS_BB[codigo] || `ESTADO ${codigo}`) : null,
    vencimento: isoDoBB(r.dataVencimentoTituloCobranca),
    valorOriginal: numero(r.valorOriginalTituloCobranca),
    valorAtual: numero(r.valorAtualTituloCobranca),
    abatimento: numero(r.valorAbatimentoTituloCobranca) ?? numero(r.valorAbatimentoTotal),
    pagoEm: isoDoBB(r.dataRecebimentoTitulo) || isoDoBB(r.dataCreditoLiquidacao),
    creditoEm: isoDoBB(r.dataCreditoLiquidacao),
    valorPago: numero(r.valorPagoSacado),
    canal: canalDePagamento(r.codigoCanalPagamento),
    tipoBaixa: tipoBaixa ? (TIPOS_BAIXA_BB[tipoBaixa] || `BAIXA ${tipoBaixa}`) : null,
    baixaAutomaticaEm: isoDoBB(r.dataBaixaAutomaticoTitulo),
    multaAPartirDe: isoDoBB(r.dataMultaTitulo),
    linha: linha.length === 47 ? bbBoleto.formatarLinha(linha) : null,
    barras: barras.length === 44 ? barras : null
  };
}

/** O status do app a partir do estado no BB. Pago é final; transitório não mexe. */
function statusPeloBB(codigo, { statusAtual, vencimento, hoje }) {
  if (statusAtual === 'pago' || ESTADOS_PAGOS.has(codigo)) return 'pago';
  if (codigo === 7) return 'baixado';
  if (ESTADOS_PROTESTADOS.has(codigo)) return 'protestado';
  const vencido = Boolean(vencimento && hoje && vencimento < hoje);
  if (codigo === 1 || ESTADOS_EM_CARTORIO.has(codigo)) return vencido ? 'vencido' : 'registrado';
  if (statusAtual === 'registrado' && vencido) return 'vencido';
  return statusAtual;
}

/**
 * Os encargos do boleto para um vencimento: as taxas gravadas no próprio
 * boleto (as da época do registro), completadas pela configuração.
 */
function encargosDoBoleto(boleto, vencimento, cfg) {
  const base = cfg || {};
  const temValorDia = boleto.juros_valor_dia !== null && boleto.juros_valor_dia !== undefined;
  const pctMes = boleto.juros_percentual_mes ?? base.juros_percentual_mes;
  return calculo.encargos({
    valor: boleto.valor,
    vencimento,
    cfg: {
      ...base,
      juros_tipo: temValorDia ? 'valor_dia' : (Number(boleto.juros_percentual_mes) > 0 ? 'percentual_mes' : 'sem'),
      juros_percentual_mes: pctMes,
      multa_percentual: boleto.multa_percentual ?? base.multa_percentual,
      protesto_dias: boleto.protesto_dias ?? base.protesto_dias,
      dias_limite_recebimento: boleto.dias_limite_recebimento ?? base.dias_limite_recebimento
    }
  });
}

/**
 * O que gravar depois de uma consulta. `manter` protege o que o app acabou
 * de mudar no BB (a consulta logo em seguida pode ainda mostrar o antigo) e
 * devolve a divergência para a tela avisar.
 */
function camposDaSincronizacao(boleto, lido, { hoje, agora, cfg = null, manter = [] }) {
  const protegidos = new Set(manter);
  const vencimentoAtual = dia(boleto.data_vencimento) || null;
  const divergencias = [];
  const vencimento = !protegidos.has('data_vencimento') && lido.vencimento ? lido.vencimento : vencimentoAtual;
  const status = lido.codigo === null ? boleto.status : statusPeloBB(lido.codigo, { statusAtual: boleto.status, vencimento, hoje });
  const campos = { status, sincronizado_em: agora };
  if (lido.codigo !== null) {
    campos.codigo_estado_bb = String(lido.codigo).padStart(2, '0');
    campos.situacao_bb = (status === 'baixado' && lido.tipoBaixa ? `${lido.situacao} - ${lido.tipoBaixa}` : lido.situacao).slice(0, 80);
  }
  if (lido.vencimento && lido.vencimento !== vencimentoAtual) {
    if (protegidos.has('data_vencimento')) {
      divergencias.push(`o BB ainda mostra o vencimento ${impressa(lido.vencimento)}`);
    } else {
      campos.data_vencimento = lido.vencimento;
      if (!boleto.vencimento_original) campos.vencimento_original = vencimentoAtual;
      campos.instrucoes = encargosDoBoleto(boleto, lido.vencimento, cfg).instrucoes;
    }
  }
  const abatimentoAtual = centavos(boleto.valor_abatimento || 0);
  if (lido.abatimento !== null && centavos(lido.abatimento) !== abatimentoAtual) {
    if (protegidos.has('valor_abatimento')) divergencias.push(`o BB ainda mostra o abatimento de ${reais(lido.abatimento)}`);
    else campos.valor_abatimento = centavos(lido.abatimento);
  }
  if (lido.linha && lido.linha !== boleto.linha_digitavel) campos.linha_digitavel = lido.linha;
  if (lido.barras && lido.barras !== boleto.codigo_barras) campos.codigo_barras = lido.barras;
  if (status === 'pago') {
    if (lido.pagoEm && lido.pagoEm !== dia(boleto.data_pagamento)) campos.data_pagamento = lido.pagoEm;
    if (lido.valorPago !== null && lido.valorPago > 0 && centavos(lido.valorPago) !== centavos(boleto.valor_pago)) campos.valor_pago = centavos(lido.valorPago);
    if (lido.canal && lido.canal !== boleto.canal_pagamento) campos.canal_pagamento = lido.canal.slice(0, 60);
  }
  if (status === 'baixado' && boleto.status !== 'baixado') {
    campos.data_baixa = hoje;
    if (!boleto.motivo_baixa) campos.motivo_baixa = 'banco';
  }
  return { campos, divergencias };
}

/** Uma linha para o histórico: o que o BB disse e o que mudou aqui. */
function resumoDaConsulta(boleto, lido, campos) {
  const partes = [`BB: ${lido.situacao || 'sem estado'}`];
  if (campos.status !== boleto.status) partes.push(`${boleto.status} → ${campos.status}`);
  if (campos.data_vencimento) partes.push(`vencimento ${impressa(campos.data_vencimento)}`);
  if (campos.valor_abatimento !== undefined) partes.push(`abatimento ${reais(campos.valor_abatimento)}`);
  if (campos.status === 'pago' && (lido.pagoEm || lido.valorPago)) {
    partes.push(`pago${lido.pagoEm ? ` em ${impressa(lido.pagoEm)}` : ''}${lido.valorPago ? ` ${reais(lido.valorPago)}` : ''}${lido.canal ? ` (${lido.canal})` : ''}`);
  }
  if (campos.status === 'baixado' && lido.tipoBaixa) partes.push(lido.tipoBaixa);
  return partes.join(' · ');
}

// ------------------------------------------------------------ payloads

function payloadAlteracao(convenio, indicador, campos = {}) {
  if (!INDICADORES.includes(indicador)) throw erro(`Indicador de alteração desconhecido: ${indicador}`, 500);
  const corpo = { numeroConvenio: Number(digitos(convenio)) };
  for (const i of INDICADORES) corpo[i] = i === indicador ? 'S' : 'N';
  return { ...corpo, ...campos };
}

const payloadProrrogacao = (convenio, data) => payloadAlteracao(convenio, 'indicadorNovaDataVencimento', { alteracaoData: { novaDataVencimento: calculo.dataBB(data) } });

const payloadAbatimento = (convenio, valor, jaTem) => (jaTem
  ? payloadAlteracao(convenio, 'indicadorAlterarAbatimento', { alteracaoAbatimento: { novoValorAbatimento: valor } })
  : payloadAlteracao(convenio, 'indicadorIncluirAbatimento', { abatimento: { valorAbatimento: valor } }));

const payloadMulta = (convenio, { percentual, aPartirDe }) => payloadAlteracao(convenio, 'indicadorCobrarMulta', {
  multa: { tipoMulta: 2, valorMulta: 0, dataInicioMulta: calculo.dataBB(aPartirDe), taxaMulta: Number(percentual) }
});

const payloadBaixa = convenio => ({ numeroConvenio: Number(digitos(convenio)) });

// ---------------------------------------------------------- validações

/** O que dá para fazer com o boleto agora (a permissão a rota confere). */
function acoesDoBoleto(boleto) {
  const s = String(boleto?.status || '');
  return {
    sincronizar: STATUS_CONSULTAVEIS.has(s),
    prorrogar: STATUS_ALTERAVEIS.has(s),
    abatimento: STATUS_ALTERAVEIS.has(s),
    baixar: STATUS_BAIXAVEIS.has(s),
    pdf: boletos.STATUS_A_PAGAR.has(s)
  };
}

const sqlPronto = boleto => Boolean(boleto) && COLUNAS_DA_FASE.every(c => Object.prototype.hasOwnProperty.call(boleto, c));

function exigirSql(boleto) {
  if (!sqlPronto(boleto)) throw erro('Falta rodar sql/cobranca_alteracoes.sql no banco e reiniciar a API para alterar, baixar ou consultar boletos.', 409);
}

function validarProrrogacao(boleto, novaData, hoje) {
  if (!STATUS_ALTERAVEIS.has(String(boleto?.status))) throw erro(`Só se prorroga boleto registrado ou vencido (este está "${boleto?.status}").`, 409);
  if (!dataValida(novaData)) throw erro('Informe a nova data de vencimento.');
  const atual = dia(boleto.data_vencimento);
  if (novaData < hoje) throw erro(`A nova data (${impressa(novaData)}) já passou.`);
  if (novaData <= atual) throw erro(`A nova data precisa ser depois do vencimento atual (${impressa(atual)}).`);
}

function validarAbatimento(boleto, valor) {
  if (!STATUS_ALTERAVEIS.has(String(boleto?.status))) throw erro(`Só se concede abatimento em boleto registrado ou vencido (este está "${boleto?.status}").`, 409);
  const v = centavos(valor);
  if (!(v > 0)) throw erro('Informe o valor do abatimento.');
  if (v >= centavos(boleto.valor)) throw erro(`O abatimento precisa ser menor que o valor do boleto (${reais(boleto.valor)}).`);
  if (v === centavos(boleto.valor_abatimento || 0)) throw erro(`O abatimento deste boleto já é ${reais(v)}.`);
  return v;
}

function validarBaixa(boleto, entrada, hoje) {
  if (!STATUS_BAIXAVEIS.has(String(boleto?.status))) throw erro(`Só se baixa boleto em aberto (este está "${boleto?.status}").`, 409);
  const motivo = String(entrada?.motivo || '');
  if (!MOTIVOS_ESCOLHIVEIS.includes(motivo)) throw erro('Escolha o motivo da baixa: quitado por fora, cancelado ou reemissão.');
  const observacao = String(entrada?.observacao || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const saida = { motivo, observacao };
  if (motivo === 'quitado_por_fora') {
    const data = dia(entrada.data_recebimento);
    if (!dataValida(data)) throw erro('Informe a data em que o valor foi recebido.');
    if (data > hoje) throw erro('A data do recebimento não pode ser futura.');
    const valor = centavos(entrada.valor_recebido);
    if (!(valor > 0)) throw erro('Informe o valor recebido.');
    const forma = String(entrada.forma || '');
    if (!FORMAS_RECEBIMENTO.includes(forma)) throw erro(`Informe como o valor foi recebido (${FORMAS_RECEBIMENTO.join(', ')}).`);
    Object.assign(saida, { dataRecebimento: data, valorRecebido: valor, forma });
  }
  if (motivo === 'reemissao') {
    const data = dia(entrada.novo_vencimento);
    if (!dataValida(data)) throw erro('Informe o vencimento do boleto novo.');
    if (data < hoje) throw erro(`O vencimento do boleto novo (${impressa(data)}) já passou.`);
    saida.novoVencimento = data;
  }
  if (motivo === 'cancelado' && !observacao) throw erro('Diga na observação por que a cobrança foi cancelada.');
  return saida;
}

// ------------------------------------------------------------- operações

function caminhoNoBB(boleto) {
  const id = digitos(boleto?.nosso_numero || boleto?.numero_bb);
  if (id.length !== 20) throw erro('Boleto sem nosso número do BB.', 409);
  return `/boletos/${id}`;
}

function evento(api, boleto, usuarioId, tipo, mensagem, payload = null, origem = 'app') {
  return boletos.registrarEvento(api, boleto.id, { origem, tipo, nosso_numero: boleto.nosso_numero, mensagem, payload, usuario_id: usuarioId });
}

/** Uma chamada que mexe no boleto: se o BB recusar, fica o rastro e o erro sobe. */
async function alterarNoBB({ api, bb, conexao, boleto, usuarioId, metodo, caminho, corpo, descricao }) {
  try {
    return await bb.chamar({ ...conexao, metodo, caminho, corpo });
  } catch (e) {
    await evento(api, boleto, usuarioId, 'alteracao_erro', `${descricao}: ${e.message}`, { requisicao: corpo, bb: e?.extra?.bb || null });
    throw e;
  }
}

/**
 * Consulta o boleto no BB e grava o que vale lá.
 * @returns {{ boleto, lido, mudou, divergencias }}
 */
async function sincronizar({ api, bb, conexao, boleto, cfg = null, hoje, usuarioId = null, origem = 'consulta', manter = [] }) {
  if (!STATUS_CONSULTAVEIS.has(String(boleto?.status))) throw erro(`Boleto "${boleto?.status}" não está registrado no BB para consultar.`, 409);
  let detalhe;
  try {
    detalhe = await bb.chamar({ ...conexao, metodo: 'GET', caminho: caminhoNoBB(boleto), query: { numeroConvenio: digitos(boleto.convenio) } });
  } catch (e) {
    await evento(api, boleto, usuarioId, 'consulta_erro', `Consulta ao BB: ${e.message}`, null, origem);
    throw e;
  }
  const lido = lerDetalhe(detalhe);
  const { campos, divergencias } = camposDaSincronizacao(boleto, lido, { hoje, agora: new Date().toISOString(), cfg, manter });
  // Antes de gravar: a resposta da gravação pode trazer (ou ser) a linha já mudada.
  const mudou = campos.status !== boleto.status;
  const mensagem = resumoDaConsulta(boleto, lido, campos);
  const atualizado = await boletos.atualizarBoleto(api, boleto, campos);
  await evento(api, boleto, usuarioId, 'consulta', mensagem, lido, origem);

  // Pago no banco: o dinheiro entra no Financeiro (fase E). Falha aqui não desfaz a consulta.
  const avisos = [];
  let recebimento = null;
  // Boleto importado do BB que ainda não foi ligado a uma parcela: o
  // recebimento não tem a quem pertencer. Fica o alerta — nunca um
  // lançamento solto no Financeiro (decisão do dono, 23/09/2026).
  if (campos.status === 'pago' && !atualizado.pedido_id) {
    const alerta = `Boleto ${atualizado.nosso_numero} está pago no BB, mas não tem parcela vinculada: nada foi lançado no Financeiro. Ligue-o a uma parcela em "Importar boletos do BB".`;
    avisos.push(alerta);
    await evento(api, atualizado, usuarioId, 'alerta', alerta, null, origem);
    return { boleto: atualizado, lido, mudou, divergencias, recebimento: null, avisos };
  }
  if (campos.status === 'pago') {
    try {
      recebimento = await recebimentos.doBoleto({
        api, boleto: atualizado, origem: 'boleto', usuarioId, hoje,
        dados: { data: lido.pagoEm, valor: lido.valorPago, canal: lido.canal, dataCredito: lido.creditoEm }
      });
    } catch (e) {
      avisos.push(`Boleto pago, mas o recebimento não foi lançado no Financeiro: ${e.message}`);
    }
  }
  return { boleto: atualizado, lido, mudou, divergencias, recebimento, avisos };
}

/** Nova data de vencimento no BB (e a multa atrás dela, se o banco não a levou). */
async function prorrogar({ api, bb, conexao, boleto, cfg = null, novaData, hoje, usuarioId = null }) {
  validarProrrogacao(boleto, novaData, hoje);
  const anterior = dia(boleto.data_vencimento);
  const corpo = payloadProrrogacao(boleto.convenio, novaData);
  const resposta = await alterarNoBB({ api, bb, conexao, boleto, usuarioId, metodo: 'PATCH', caminho: caminhoNoBB(boleto), corpo, descricao: `Prorrogação para ${impressa(novaData)} recusada` });
  const enc = encargosDoBoleto(boleto, novaData, cfg);
  let atual = await boletos.atualizarBoleto(api, boleto, {
    data_vencimento: novaData, vencimento_original: boleto.vencimento_original || anterior, instrucoes: enc.instrucoes, status: 'registrado'
  });
  await evento(api, boleto, usuarioId, 'prorrogado', `Vencimento ${impressa(anterior)} → ${impressa(novaData)}.`, { requisicao: corpo, resposta });

  const avisos = [];
  try {
    const r = await sincronizar({ api, bb, conexao, boleto: atual, cfg, hoje, usuarioId, manter: ['data_vencimento'] });
    atual = r.boleto;
    avisos.push(...r.divergencias.map(d => `Prorrogado, mas ${d}: consulte de novo em instantes.`), ...r.avisos);
    if (enc.multa && r.lido.multaAPartirDe && r.lido.multaAPartirDe <= novaData) {
      const multa = payloadMulta(boleto.convenio, { percentual: enc.multa.percentual, aPartirDe: enc.multa.aPartirDe });
      try {
        await alterarNoBB({ api, bb, conexao, boleto, usuarioId, metodo: 'PATCH', caminho: caminhoNoBB(boleto), corpo: multa, descricao: `Multa para ${impressa(enc.multa.aPartirDe)} recusada` });
        await evento(api, boleto, usuarioId, 'multa_atualizada', `Multa de ${calculo.valorImpresso(enc.multa.percentual)}% a partir de ${impressa(enc.multa.aPartirDe)} (antes ${impressa(r.lido.multaAPartirDe)}).`, { requisicao: multa });
      } catch (e) {
        avisos.push(`Prorrogado, mas o BB não aceitou mover a multa para ${impressa(enc.multa.aPartirDe)}: ${e.message}`);
      }
    }
  } catch (e) {
    avisos.push(`Prorrogado, mas a consulta ao BB falhou agora (${e.message}). Use "Consultar no BB" depois.`);
  }
  return { boleto: atual, avisos };
}

/** Inclui ou altera o abatimento no BB. */
async function concederAbatimento({ api, bb, conexao, boleto, cfg = null, valor, hoje, usuarioId = null }) {
  const v = validarAbatimento(boleto, valor);
  const antes = centavos(boleto.valor_abatimento || 0);
  const corpo = payloadAbatimento(boleto.convenio, v, antes > 0);
  const resposta = await alterarNoBB({ api, bb, conexao, boleto, usuarioId, metodo: 'PATCH', caminho: caminhoNoBB(boleto), corpo, descricao: `Abatimento de ${reais(v)} recusado` });
  let atual = await boletos.atualizarBoleto(api, boleto, { valor_abatimento: v });
  await evento(api, boleto, usuarioId, 'abatimento', `Abatimento de ${reais(v)}${antes > 0 ? ` (era ${reais(antes)})` : ''}: o boleto passa a cobrar ${reais(centavos(boleto.valor) - v)}.`, { requisicao: corpo, resposta });

  const avisos = [];
  try {
    const r = await sincronizar({ api, bb, conexao, boleto: atual, cfg, hoje, usuarioId, manter: ['valor_abatimento'] });
    atual = r.boleto;
    avisos.push(...r.divergencias.map(d => `Abatimento concedido, mas ${d}: consulte de novo em instantes.`), ...r.avisos);
  } catch (e) {
    avisos.push(`Abatimento concedido, mas a consulta ao BB falhou agora (${e.message}). Use "Consultar no BB" depois.`);
  }
  return { boleto: atual, avisos };
}

/**
 * Baixa no BB. `registrarNovo({ vencimento, substitui })` (da rota) gera o
 * boleto da reemissão; se ele falhar, a baixa fica e a tela avisa.
 */
async function baixar({ api, bb, conexao, boleto, entrada, hoje, usuarioId = null, registrarNovo = null }) {
  const b = validarBaixa(boleto, entrada, hoje);
  const corpo = payloadBaixa(boleto.convenio);
  const resposta = await alterarNoBB({ api, bb, conexao, boleto, usuarioId, metodo: 'POST', caminho: `${caminhoNoBB(boleto)}/baixar`, corpo, descricao: 'Baixa recusada' });
  const campos = {
    status: 'baixado', motivo_baixa: b.motivo, observacao_baixa: b.observacao || null, data_baixa: hoje, baixado_por: usuarioId,
    codigo_estado_bb: '07', situacao_bb: ESTADOS_BB[7]
  };
  if (b.motivo === 'quitado_por_fora') {
    Object.assign(campos, { data_pagamento: b.dataRecebimento, valor_pago: b.valorRecebido, canal_pagamento: `Fora do boleto · ${b.forma}` });
  }
  const atual = await boletos.atualizarBoleto(api, boleto, campos);
  const detalhe = b.motivo === 'quitado_por_fora'
    ? `: recebido em ${impressa(b.dataRecebimento)}, ${reais(b.valorRecebido)} (${b.forma})`
    : (b.motivo === 'reemissao' ? `: boleto novo para ${impressa(b.novoVencimento)}` : '');
  await evento(api, boleto, usuarioId, 'baixado', `Baixado (${MOTIVOS_BAIXA[b.motivo]})${detalhe}.${b.observacao ? ` ${b.observacao}` : ''}`, { requisicao: corpo, resposta });

  const avisos = [];
  let recebimento = null;
  if (b.motivo === 'quitado_por_fora') {
    try {
      recebimento = await recebimentos.doBoleto({
        api, boleto: atual, origem: 'quitado_por_fora', usuarioId, hoje,
        dados: { data: b.dataRecebimento, valor: b.valorRecebido, forma: b.forma, observacao: b.observacao }
      });
    } catch (e) {
      avisos.push(`Baixado, mas o recebimento não foi lançado no Financeiro: ${e.message}`);
    }
  }
  let reemissao = null;
  if (b.motivo === 'reemissao' && typeof registrarNovo === 'function') {
    try {
      reemissao = await registrarNovo({ vencimento: b.novoVencimento, substitui: atual });
      const falhas = (reemissao?.resultados || []).filter(x => !x.ok);
      if (falhas.length) avisos.push(`Baixado, mas o boleto novo não saiu: ${falhas.map(x => x.erro).join(' | ')}. Tente de novo em "Gerar boletos".`);
    } catch (e) {
      reemissao = { erro: e.message };
      avisos.push(`Baixado, mas o boleto novo não saiu: ${e.message}. Tente de novo em "Gerar boletos".`);
    }
  }
  return { boleto: atual, reemissao, recebimento, avisos };
}

/** Consulta todos os boletos a pagar do pedido; um erro não para os outros. */
async function sincronizarPedido({ api, bb, conexao, pedidoId, cfg = null, hoje, usuarioId = null }) {
  const dados = await boletos.lerPedidoCobranca(api, pedidoId);
  const alvo = dados.boletos.filter(b => boletos.STATUS_A_PAGAR.has(String(b.status)));
  const resultados = [];
  for (const boleto of alvo) {
    const base = { boleto_id: boleto.id, numero_parcela: boleto.numero_parcela };
    try {
      exigirSql(boleto);
      const r = await sincronizar({ api, bb, conexao: await conexao(boleto.ambiente), boleto, cfg: cfg || dados.configuracao, hoje, usuarioId });
      resultados.push({ ...base, ok: true, status: r.boleto.status, mudou: r.mudou, situacao: r.lido.situacao, avisos: r.avisos });
    } catch (e) {
      resultados.push({ ...base, ok: false, erro: e.message });
    }
  }
  return {
    pedido: { id: dados.pedido.id, numero: dados.pedido.numero },
    resultados,
    consultados: resultados.filter(r => r.ok).length,
    mudaram: resultados.filter(r => r.ok && r.mudou).length,
    erros: resultados.filter(r => !r.ok).length
  };
}

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));

/** O histórico do boleto: eventos do app e do webhook (casados pelo nosso número), mais novos primeiro. */
async function historico(api, boleto) {
  const [porId, porNumero] = await Promise.all([
    api.get('/api/boletos_eventos', { query: { boleto_id: boleto.id } }).then(lista).catch(() => []),
    boleto.nosso_numero ? api.get('/api/boletos_eventos', { query: { nosso_numero: boleto.nosso_numero } }).then(lista).catch(() => []) : []
  ]);
  const vistos = new Map();
  for (const e of [...porId, ...porNumero]) {
    if (!e || vistos.has(e.id)) continue;
    const doBoleto = Number(e.boleto_id) === Number(boleto.id)
      || ((e.boleto_id === null || e.boleto_id === undefined) && e.nosso_numero === boleto.nosso_numero);
    if (!doBoleto) continue;
    vistos.set(e.id, { id: e.id, origem: e.origem, tipo: e.tipo, mensagem: e.mensagem || '', criado_em: e.criado_em || null, pendente: !e.processado_em });
  }
  return [...vistos.values()].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 100);
}

module.exports = {
  ESTADOS_BB, TIPOS_BAIXA_BB, MOTIVOS_BAIXA, MOTIVOS_ESCOLHIVEIS, FORMAS_RECEBIMENTO, INDICADORES, COLUNAS_DA_FASE,
  dataValida, isoDoBB, canalDePagamento, lerDetalhe, statusPeloBB, encargosDoBoleto, camposDaSincronizacao, resumoDaConsulta,
  payloadAlteracao, payloadProrrogacao, payloadAbatimento, payloadMulta, payloadBaixa,
  acoesDoBoleto, sqlPronto, exigirSql, validarProrrogacao, validarAbatimento, validarBaixa,
  sincronizar, prorrogar, concederAbatimento, baixar, sincronizarPedido, historico
};
