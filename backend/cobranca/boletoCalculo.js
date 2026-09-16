/**
 * As contas do boleto do Banco do Brasil (convênio de 7 posições, carteira
 * 17), sem rede: nosso número com dígito, campo livre, código de barras
 * (44 posições, FEBRABAN), linha digitável, fator de vencimento, juros por
 * dia, multa e as instruções impressas.
 *
 * Tudo conferido contra um boleto real do convênio 3453481 (nosso número
 * 00034534810000000393-4, linha 00190.00009 03453.481008 00000.393173 1
 * 16950000332700, vencimento 18/01/2027, R$ 3.327,00, juros R$ 9,98/dia).
 *
 * Datas são texto 'YYYY-MM-DD' somadas por Date.UTC — passar pelo relógio
 * local volta um dia em São Paulo.
 */
const BANCO = '001';
const MOEDA = '9';

const digitos = v => String(v ?? '').replace(/\D/g, '');
const centavos = v => Math.round(Number(v || 0) * 100) / 100;

/** Soma ponderada da direita para a esquerda com os pesos 2..9 (módulo 11). */
function somaModulo11(texto) {
  let soma = 0;
  let peso = 2;
  for (let i = texto.length - 1; i >= 0; i -= 1) {
    soma += Number(texto[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma;
}

/** Dígito do nosso número (BB): 11 − resto; 10 vira 'X'; 11 vira 0. */
function dvNossoNumero(numero) {
  const dv = 11 - (somaModulo11(digitos(numero)) % 11);
  if (dv === 10) return 'X';
  if (dv === 11) return '0';
  return String(dv);
}

/**
 * Nosso número do convênio de 7 posições: "000" + convênio + sequencial de
 * 10 dígitos (17 dígitos significativos, 20 com o prefixo — é o
 * `numeroTituloCliente` da API).
 */
function nossoNumero(convenio, sequencial) {
  const conv = digitos(convenio);
  if (conv.length !== 7) throw new Error('O convênio precisa ter 7 dígitos.');
  const seq = Number(sequencial);
  if (!Number.isInteger(seq) || seq < 1 || seq > 9999999999) throw new Error('Sequencial do nosso número inválido.');
  const numero = `000${conv}${String(seq).padStart(10, '0')}`;
  const dv = dvNossoNumero(numero);
  return { numero, dv, formatado: `${numero}-${dv}`, numeroTituloCliente: numero, sequencial: seq };
}

/** Campo livre (25 posições) do BB para convênio de 7 posições: 000000 + convênio + sequencial + carteira. */
function campoLivre({ convenio, sequencial, carteira = 17 }) {
  const conv = digitos(convenio);
  if (conv.length !== 7) throw new Error('O convênio precisa ter 7 dígitos.');
  const seq = String(Number(sequencial)).padStart(10, '0');
  const cart = String(Number(carteira)).padStart(2, '0');
  return `000000${conv}${seq}${cart}`;
}

/** 'YYYY-MM-DD' → dia em UTC. */
function diaUtc(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function utcParaIso(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Soma dias a 'YYYY-MM-DD' sem passar pelo fuso. */
function somarDias(iso, dias) {
  const base = diaUtc(iso);
  if (base === null) return null;
  return utcParaIso(base + Number(dias || 0) * 86400000);
}

/**
 * Fator de vencimento FEBRABAN: até 21/02/2025 contava os dias desde
 * 07/10/1997 (chegou a 9999); a partir de 22/02/2025 recomeça em 1000.
 */
function fatorVencimento(iso) {
  const dia = diaUtc(iso);
  if (dia === null) throw new Error('Vencimento inválido.');
  const novaBase = Date.UTC(2025, 1, 22);
  if (dia >= novaBase) return 1000 + Math.round((dia - novaBase) / 86400000);
  return Math.round((dia - Date.UTC(1997, 9, 7)) / 86400000);
}

/** Dígito verificador geral do código de barras (módulo 11; 0, 10 e 11 viram 1). */
function dvCodigoBarras(semDv) {
  const dv = 11 - (somaModulo11(semDv) % 11);
  return dv === 0 || dv === 10 || dv === 11 ? '1' : String(dv);
}

/** Código de barras de 44 posições: banco, moeda, DV, fator, valor (10) e campo livre (25). */
function codigoBarras({ vencimento, valor, campoLivre: livre, banco = BANCO, moeda = MOEDA }) {
  if (String(livre).length !== 25) throw new Error('O campo livre precisa ter 25 posições.');
  const centavosTotais = Math.round(Number(valor) * 100);
  if (!Number.isInteger(centavosTotais) || centavosTotais <= 0 || centavosTotais > 9999999999) throw new Error('Valor do boleto inválido.');
  const fator = String(fatorVencimento(vencimento)).padStart(4, '0');
  const valorTexto = String(centavosTotais).padStart(10, '0');
  const semDv = `${banco}${moeda}${fator}${valorTexto}${livre}`;
  const dv = dvCodigoBarras(semDv);
  return `${banco}${moeda}${dv}${fator}${valorTexto}${livre}`;
}

/** Dígito de cada campo da linha digitável (módulo 10, dobrando da direita). */
function dvModulo10(texto) {
  let soma = 0;
  let dobra = true;
  for (let i = texto.length - 1; i >= 0; i -= 1) {
    let n = Number(texto[i]) * (dobra ? 2 : 1);
    if (n > 9) n = Math.floor(n / 10) + (n % 10);
    soma += n;
    dobra = !dobra;
  }
  const resto = soma % 10;
  return String(resto === 0 ? 0 : 10 - resto);
}

/**
 * Linha digitável a partir do código de barras: 5 campos, o quarto é o DV
 * geral e o quinto fator + valor. Devolve o texto como sai impresso e a
 * versão só com dígitos (47).
 */
function linhaDigitavel(barras) {
  const b = digitos(barras);
  if (b.length !== 44) throw new Error('O código de barras precisa ter 44 posições.');
  const banco = b.slice(0, 3);
  const moeda = b[3];
  const dvGeral = b[4];
  const fatorValor = b.slice(5, 19);
  const livre = b.slice(19);
  const c1 = `${banco}${moeda}${livre.slice(0, 5)}`;
  const c2 = livre.slice(5, 15);
  const c3 = livre.slice(15, 25);
  const campo = (c) => `${c}${dvModulo10(c)}`;
  const f1 = campo(c1);
  const f2 = campo(c2);
  const f3 = campo(c3);
  return {
    texto: `${f1.slice(0, 5)}.${f1.slice(5)} ${f2.slice(0, 5)}.${f2.slice(5)} ${f3.slice(0, 5)}.${f3.slice(5)} ${dvGeral} ${fatorValor}`,
    digitos: `${f1}${f2}${f3}${dvGeral}${fatorValor}`
  };
}

/** Juros por dia de atraso a partir da taxa mensal (9% ao mês ÷ 30), sobre o valor bruto. */
function jurosPorDia(valor, percentualMes) {
  return centavos(Number(valor) * (Number(percentualMes) / 100) / 30);
}

/** Multa fixa em reais sobre o valor bruto. */
function valorMulta(valor, percentual) {
  return centavos(Number(valor) * (Number(percentual) / 100));
}

/** 'YYYY-MM-DD' → 'dd.mm.aaaa' (o formato de data da API do BB). */
function dataBB(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/** 'YYYY-MM-DD' → 'dd/mm/aaaa' (impresso). */
function dataImpressa(iso, { anoCurto = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  return `${m[3]}/${m[2]}/${anoCurto ? m[1].slice(2) : m[1]}`;
}

const moedaBR = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const valorImpresso = v => moedaBR.format(Number(v || 0));

/**
 * Os encargos de um boleto pela configuração: juros (por dia ou % ao mês),
 * multa, protesto/negativação e a data-limite de recebimento — em números e
 * nas instruções impressas, com a redação do boleto que o cliente já conhece.
 */
function encargos({ valor, vencimento, cfg = {} }) {
  const bruto = centavos(valor);
  const diaSeguinte = somarDias(vencimento, 1);
  const tipoJuros = String(cfg.juros_tipo || 'valor_dia');
  const pctMes = Number(cfg.juros_percentual_mes || 0);
  const juros = tipoJuros === 'sem' || pctMes <= 0 ? null
    : (tipoJuros === 'percentual_mes'
      ? { tipo: 'percentual_mes', percentual: pctMes, aPartirDe: diaSeguinte }
      : { tipo: 'valor_dia', valorDia: jurosPorDia(bruto, pctMes), percentualMes: pctMes, aPartirDe: diaSeguinte });
  const pctMulta = Number(cfg.multa_percentual || 0);
  const multa = pctMulta > 0 ? { percentual: pctMulta, valor: valorMulta(bruto, pctMulta), aPartirDe: somarDias(vencimento, Number(cfg.multa_dias ?? 1)) } : null;
  const protesto = cfg.protesto_dias !== null && cfg.protesto_dias !== undefined && Number(cfg.protesto_dias) >= 0
    ? { dias: Number(cfg.protesto_dias), aPartirDe: somarDias(vencimento, Number(cfg.protesto_dias)) } : null;
  const negativacao = cfg.negativacao_dias !== null && cfg.negativacao_dias !== undefined && Number(cfg.negativacao_dias) >= 0
    ? { dias: Number(cfg.negativacao_dias), aPartirDe: somarDias(vencimento, Number(cfg.negativacao_dias)) } : null;
  const limite = Number(cfg.dias_limite_recebimento ?? 0);
  const pctDesc = Number(cfg.desconto_percentual || 0);
  const desconto = pctDesc > 0 ? { percentual: pctDesc, valor: valorMulta(bruto, pctDesc), ate: somarDias(vencimento, -Number(cfg.desconto_dias || 0)) } : null;

  const instrucoes = [];
  if (juros?.tipo === 'valor_dia') instrucoes.push(`JRS: Vl p/Dia Atraso R$${valorImpresso(juros.valorDia)} A PARTIR DE ${dataImpressa(juros.aPartirDe, { anoCurto: true })}`);
  if (juros?.tipo === 'percentual_mes') instrucoes.push(`JUROS DE ${valorImpresso(juros.percentual)}% AO MÊS A PARTIR DE ${dataImpressa(juros.aPartirDe)}`);
  if (multa) instrucoes.push(`MULTA DE ${valorImpresso(multa.percentual)}% A PARTIR DE ${dataImpressa(multa.aPartirDe)}`);
  if (desconto) instrucoes.push(`DESCONTO DE ${valorImpresso(desconto.valor)} ATÉ ${dataImpressa(desconto.ate)}`);
  if (protesto) instrucoes.push(`PROTESTO: A partir de ${dataImpressa(protesto.aPartirDe)}`);
  if (negativacao) instrucoes.push(`NEGATIVAÇÃO: A partir de ${dataImpressa(negativacao.aPartirDe)}`);
  if (limite > 0) instrucoes.push(`Receber até ${limite} dias após o vencimento`);

  return { valor: bruto, vencimento, juros, multa, desconto, protesto, negativacao, diasLimiteRecebimento: limite, instrucoes };
}

module.exports = {
  BANCO, MOEDA,
  somaModulo11, dvNossoNumero, nossoNumero, campoLivre, fatorVencimento, dvCodigoBarras, codigoBarras,
  dvModulo10, linhaDigitavel, jurosPorDia, valorMulta, dataBB, dataImpressa, valorImpresso, somarDias, encargos
};
