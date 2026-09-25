/**
 * O registro de um boleto na API Cobranças v2 do BB, montado a partir da
 * parcela do pedido, do cliente (pagador) e da configuração da cobrança.
 * Funções puras: nada de rede nem banco — o teste confere o payload contra
 * o boleto real do convênio.
 *
 * Regras da casa (dono, 16/09/2026): juros = 9% ao mês enviados como VALOR
 * POR DIA sobre o bruto (tipo 1); multa 2% sobre o bruto a partir do dia
 * seguinte (tipo 2); protesto 7 dias; aceita pagamento até 15 dias após o
 * vencimento; Pix no boleto; espécie DM sem aceite.
 */
const calculo = require('./boletoCalculo');
const configuracao = require('./configuracaoCobranca');
const { siglaDaUf } = require('../fiscal/municipios');

const digitos = v => String(v ?? '').replace(/\D/g, '');
const limpar = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const semAcento = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Texto do jeito que o BB aceita: maiúsculas, sem acento, só letras, números,
 * espaço e a pontuação permitida. O boleto real sai assim ("RUA RUBI 150 -
 * SAO JOAQUIM"). O campo livre do beneficiário só aceita letras, números e
 * espaço: "NF-e 1/7" foi recusado com "4678420 — Campo utilização
 * beneficiário preenchido com dados inválidos" (16/09/2026).
 */
function textoBB(v, max, permitidos = ' .,/&-') {
  const escapado = permitidos.replace(/[\\\]^-]/g, '\\$&');
  const fora = new RegExp(`[^A-Z0-9${escapado}]`, 'g');
  return semAcento(v).toUpperCase().replace(fora, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}
const alfanumerico = (v, max) => textoBB(v, max, ' ');

/** codigoTipoTitulo da API do BB por espécie. */
const TIPO_TITULO = { DM: 2, DS: 4, NP: 12, RC: 17, OU: 99 };

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** O pagador do boleto a partir do cadastro do cliente (o mesmo endereço de registro da NF-e). */
function pagadorDoCliente(cliente) {
  const pf = String(cliente?.tipo_pessoa || 'PJ').toUpperCase() === 'PF';
  const documento = pf ? digitos(cliente?.cpf) : digitos(cliente?.cnpj);
  const logradouro = textoBB(cliente?.reg_logradouro, 60);
  const numero = textoBB(cliente?.reg_numero, 10);
  const complemento = textoBB(cliente?.reg_complemento, 20);
  return {
    tipo_pessoa: pf ? 'PF' : 'PJ',
    documento,
    nome: textoBB(pf ? (cliente?.nome || cliente?.razao_social || cliente?.nome_fantasia) : (cliente?.razao_social || cliente?.nome_fantasia || cliente?.nome), 60),
    endereco: textoBB([logradouro, numero].filter(Boolean).join(', ') + (complemento ? ` ${complemento}` : ''), 60),
    bairro: textoBB(cliente?.reg_bairro, 30),
    cidade: textoBB(cliente?.reg_cidade, 30),
    uf: siglaDaUf(cliente?.reg_uf) || '',
    cep: digitos(cliente?.reg_cep),
    telefone: digitos(cliente?.reg_telefone || cliente?.telefone).slice(0, 11) || null,
    email: limpar(cliente?.email_nfe || cliente?.email, 60) || null
  };
}

/** O que falta no cliente para o BB aceitar o pagador. */
function pendenciasDoPagador(pagador) {
  const p = [];
  if (!pagador?.nome) p.push('Cliente sem razão social/nome.');
  if (pagador?.tipo_pessoa === 'PF' ? pagador.documento.length !== 11 : pagador?.documento.length !== 14) p.push(pagador?.tipo_pessoa === 'PF' ? 'Cliente sem CPF válido.' : 'Cliente sem CNPJ válido.');
  if (!pagador?.endereco) p.push('Cliente sem logradouro/número no endereço de registro.');
  if (!pagador?.bairro) p.push('Cliente sem bairro no endereço de registro.');
  if (!pagador?.cidade) p.push('Cliente sem cidade no endereço de registro.');
  if (!pagador?.uf) p.push('Cliente sem UF no endereço de registro.');
  if (pagador?.cep.length !== 8) p.push('Cliente sem CEP de 8 dígitos no endereço de registro.');
  return p;
}

/**
 * Monta o registro (payload do POST /boletos) de UMA parcela. Devolve também
 * o nosso número, os encargos e o número do documento — o que fica gravado.
 *
 * `desconto` é a parte da parcela no desconto do pedido
 * (cobranca/descontoCondicional.js): o boleto sai com o VALOR CHEIO (parcela +
 * desconto) e o desconto vale até o vencimento; juros e multa, sobre o cheio
 * (decisões do dono, 25/09/2026). Sem desconto, o boleto é a parcela.
 *
 * @param {object} p { cfg, ambiente, sequencial, pedido, parcela, cliente, hoje ('YYYY-MM-DD'), notaNumero, desconto }
 */
function montarRegistro({ cfg, ambiente, sequencial, pedido, parcela, cliente, hoje, notaNumero = null, desconto = 0, pagadorTeste = process.env.BB_PAGADOR_TESTE || configuracao.PAGADOR_TESTE_CNPJ }) {
  if (!cfg) throw erro('Configuração de cobrança ausente.', 409);
  const valorParcela = Math.round(Number(parcela?.valor || 0) * 100) / 100;
  if (!(valorParcela > 0)) throw erro(`Parcela ${parcela?.numero_parcela ?? '?'} sem valor.`, 422);
  const descontoDoPedido = Math.round(Math.max(Number(desconto) || 0, 0) * 100) / 100;
  const valor = Math.round((valorParcela + descontoDoPedido) * 100) / 100;
  const vencimento = calculo.dataBB(parcela?.data_vencimento) ? String(parcela.data_vencimento).slice(0, 10) : null;
  if (!vencimento) throw erro(`Parcela ${parcela?.numero_parcela ?? '?'} sem data de vencimento.`, 422);
  if (vencimento < hoje) throw erro(`Parcela ${parcela?.numero_parcela ?? '?'} vence em ${calculo.dataImpressa(vencimento)}, que já passou: ajuste o vencimento no pedido antes de gerar o boleto.`, 422);

  const pagador = pagadorDoCliente(cliente);
  const faltas = pendenciasDoPagador(pagador);
  if (faltas.length) throw erro(`O cliente não pode ser pagador ainda: ${faltas.join(' ')}`, 422, { pendencias: faltas });

  // Na homologação vale a conta de teste do BB; em produção, a real.
  const conta = configuracao.dadosDaConta(cfg, ambiente);
  const nn = calculo.nossoNumero(conta.convenio, sequencial);
  const enc = calculo.encargos({ valor, vencimento, cfg, descontoFixo: descontoDoPedido > 0 ? { valor: descontoDoPedido, ate: vencimento } : null });
  const numeroDocumento = alfanumerico(`${pedido?.numero ?? pedido?.id ?? ''}P${parcela?.numero_parcela ?? 1}`, 15).replace(/ /g, '');
  const especie = String(cfg.especie || 'DM').toUpperCase();
  const limite = Number(cfg.dias_limite_recebimento ?? 0);

  const payload = {
    numeroConvenio: Number(digitos(conta.convenio)),
    numeroCarteira: Number(conta.carteira),
    numeroVariacaoCarteira: Number(conta.variacao),
    codigoModalidade: 1,
    dataEmissao: calculo.dataBB(hoje),
    dataVencimento: calculo.dataBB(vencimento),
    valorOriginal: valor,
    valorAbatimento: 0,
    quantidadeDiasProtesto: enc.protesto ? enc.protesto.dias : 0,
    quantidadeDiasNegativacao: enc.negativacao ? enc.negativacao.dias : 0,
    orgaoNegativador: enc.negativacao ? 10 : 0,
    indicadorAceiteTituloVencido: limite > 0 ? 'S' : 'N',
    numeroDiasLimiteRecebimento: limite > 0 ? limite : 0,
    codigoAceite: cfg.aceite === true ? 'A' : 'N',
    codigoTipoTitulo: TIPO_TITULO[especie] || 99,
    descricaoTipoTitulo: especie,
    indicadorPermissaoRecebimentoParcial: 'N',
    numeroTituloBeneficiario: numeroDocumento,
    campoUtilizacaoBeneficiario: alfanumerico(notaNumero ? `NFE ${notaNumero}` : `PEDIDO ${pedido?.numero ?? ''}`, 30),
    numeroTituloCliente: nn.numeroTituloCliente,
    mensagemBloquetoOcorrencia: textoBB(cfg.mensagem_boleto || '', 165) || undefined,
    desconto: enc.desconto ? { tipo: 1, dataExpiracao: calculo.dataBB(enc.desconto.ate), valor: enc.desconto.valor } : { tipo: 0 },
    segundoDesconto: { tipo: 0 },
    terceiroDesconto: { tipo: 0 },
    jurosMora: enc.juros
      ? (enc.juros.tipo === 'valor_dia' ? { tipo: 1, valor: enc.juros.valorDia } : { tipo: 2, porcentagem: enc.juros.percentual })
      : { tipo: 0 },
    multa: enc.multa ? { tipo: 2, data: calculo.dataBB(enc.multa.aPartirDe), porcentagem: enc.multa.percentual } : { tipo: 0 },
    // Na homologação o BB só aceita o documento de teste; nome e endereço seguem os do cliente.
    pagador: {
      tipoInscricao: conta.teste ? 2 : (pagador.tipo_pessoa === 'PF' ? 1 : 2),
      numeroInscricao: Number(conta.teste ? digitos(pagadorTeste) : pagador.documento),
      nome: pagador.nome,
      endereco: pagador.endereco,
      cep: Number(pagador.cep),
      cidade: pagador.cidade,
      bairro: pagador.bairro,
      uf: pagador.uf,
      ...(pagador.telefone ? { telefone: pagador.telefone } : {})
    },
    indicadorPix: cfg.indicador_pix === false ? 'N' : 'S'
  };
  if (payload.mensagemBloquetoOcorrencia === undefined) delete payload.mensagemBloquetoOcorrencia;

  return {
    payload, nossoNumero: nn, encargos: enc, numeroDocumento, pagador, valor, vencimento, emissao: hoje, conta,
    valorParcela, desconto: descontoDoPedido > 0 ? { valor: descontoDoPedido, ate: vencimento } : null
  };
}

/** O que o BB devolve no registro, no formato que a tabela guarda. */
function lerRetornoRegistro(resposta) {
  const r = resposta || {};
  const linha = String(r.linhaDigitavel || '').replace(/\D/g, '');
  return {
    numero_bb: r.numero ? String(r.numero) : null,
    linha_digitavel: linha ? formatarLinha(linha) : null,
    codigo_barras: r.codigoBarraNumerico ? String(r.codigoBarraNumerico).replace(/\D/g, '') : null,
    pix_txid: r.qrCode?.txId || null,
    pix_emv: r.qrCode?.emv || null,
    pix_url: r.qrCode?.url || null
  };
}

/** 47 dígitos → "00190.00009 03453.481008 00000.393173 1 16950000332700". */
function formatarLinha(d) {
  if (d.length !== 47) return d;
  return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
}

module.exports = { TIPO_TITULO, textoBB, alfanumerico, pagadorDoCliente, pendenciasDoPagador, montarRegistro, lerRetornoRegistro, formatarLinha };
