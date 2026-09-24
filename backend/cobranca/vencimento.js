/**
 * Vencimento em dia não útil (decisão do dono, 24/09/2026).
 *
 * O vencimento do papel NÃO muda: a parcela que vence no domingo 20/09 continua
 * vencendo em 20/09. Mas quem paga até o próximo dia útil (segunda, 21/09)
 * está em dia — sem atraso, sem multa, sem juros. Pagou depois disso, o atraso
 * conta desde o vencimento do papel: pago em 23/09, são 3 dias desde 20/09.
 *
 * Dia útil aqui é o bancário: sábado e domingo nunca, nem os feriados
 * nacionais, nem os cadastrados no Financeiro (o mesmo calendário do 5º dia
 * útil da produção — `financeiro/calendario.js`). O status do boleto no app
 * usa só os nacionais (é o calendário do banco); contas a receber, comissão e
 * o modal de pagamentos usam também os cadastrados.
 *
 * O boleto do BB já segue a mesma regra no banco (regra da FEBRABAN): nada
 * muda no registro. Tudo aqui é puro; datas são texto 'YYYY-MM-DD'.
 */
const calendario = require('../financeiro/calendario');
const calculo = require('./boletoCalculo');

const DIA_MS = 86400000;
const centavos = v => Math.round(Number(v || 0) * 100) / 100;

function diaDe(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const utc = iso => {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
};
const somarDia = iso => new Date(utc(iso) + DIA_MS).toISOString().slice(0, 10);

/** Dias corridos de `desde` até `ate` (positivo quando `ate` vem depois). */
function diasEntre(ate, desde) {
  const a = diaDe(ate);
  const d = diaDe(desde);
  if (!a || !d) return null;
  return Math.round((utc(a) - utc(d)) / DIA_MS);
}

/**
 * O último dia para pagar sem encargos: o próprio vencimento, se for dia útil;
 * senão, o primeiro dia útil depois dele. `feriados` são os cadastrados
 * (`[{ data, descricao }]`); os nacionais entram sempre.
 */
function limiteSemEncargos(vencimento, feriados = []) {
  const venc = diaDe(vencimento);
  if (!venc) return null;
  const ano = Number(venc.slice(0, 4));
  const mapa = calendario.mapaDeFeriados([ano, ano + 1], feriados);
  let dia = venc;
  // Nunca passa de duas semanas (Carnaval + fim de semana não chega perto).
  for (let i = 0; i < 15 && !calendario.ehDiaUtil(dia, { feriados: mapa, sabado: false }); i += 1) dia = somarDia(dia);
  return dia;
}

/**
 * Dias de atraso de um pagamento feito (ou não) em `data`: zero até o limite
 * sem encargos; passou dele, conta desde o vencimento do papel.
 */
function diasDeAtraso(vencimento, data, feriados = []) {
  const venc = diaDe(vencimento);
  const quando = diaDe(data);
  if (!venc || !quando) return 0;
  const limite = limiteSemEncargos(venc, feriados);
  if (!limite || quando <= limite) return 0;
  return diasEntre(quando, venc);
}

/** Está atrasado em `hoje`? */
const estaAtrasado = (vencimento, hoje, feriados = []) => diasDeAtraso(vencimento, hoje, feriados) > 0;

/**
 * Multa e juros de um pagamento em atraso, pelas regras dos boletos
 * (configuração de cobrança): a multa é o % sobre o valor, a partir do dia
 * seguinte ao vencimento (ou de `multa_dias`); os juros, a taxa do mês ÷ 30
 * por dia de atraso — as mesmas contas do boleto (`boletoCalculo.encargos`).
 * É uma SUGESTÃO: quem registra confirma o que de fato entrou.
 */
function encargosDoAtraso({ valor, vencimento, data, cfg = {}, feriados = [] }) {
  const venc = diaDe(vencimento);
  const quando = diaDe(data);
  const limite = venc ? limiteSemEncargos(venc, feriados) : null;
  const dias = venc && quando ? diasDeAtraso(venc, quando, feriados) : 0;
  const base = centavos(valor);
  const vazio = { dias: 0, limite, multa: 0, juros: 0, total: 0, valor: base, com_encargos: base };
  if (!(dias > 0) || !(base > 0)) return vazio;

  const regra = calculo.encargos({ valor: base, vencimento: venc, cfg: cfg || {} });
  const multa = regra.multa && quando >= regra.multa.aPartirDe ? regra.multa.valor : 0;
  const pctMes = Number(cfg?.juros_percentual_mes || 0);
  const juros = regra.juros ? centavos(calculo.jurosPorDia(base, pctMes) * dias) : 0;
  const total = centavos(multa + juros);
  return { dias, limite, multa, juros, total, valor: base, com_encargos: centavos(base + total) };
}

module.exports = { diaDe, diasEntre, limiteSemEncargos, diasDeAtraso, estaAtrasado, encargosDoAtraso };
