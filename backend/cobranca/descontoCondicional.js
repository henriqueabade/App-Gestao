/**
 * Boleto com o VALOR CHEIO e desconto até o vencimento (decisões do dono,
 * 25/09/2026).
 *
 * O pedido fica com desconto no sistema; o boleto sai com o valor cheio (sem
 * os descontos) e um desconto de valor fixo que vale até o vencimento — para
 * estimular o cliente a pagar em dia:
 *
 *   pedido cheio R$ 10.000, desconto R$ 500 → pedido R$ 9.500 (2 × 4.750)
 *   boleto de cada parcela: R$ 5.000, "desconto de R$ 250 até o vencimento"
 *   pagou até o vencimento ....... R$ 4.750
 *   venceu ....................... R$ 5.000 + multa e juros sobre os 5.000
 *
 * - O DESCONTO é o que a NF-e chama de desconto: o dos itens (quantidade, à
 *   vista, especial) mais o ajuste para menos das parcelas. O Adicional entra
 *   no valor cheio. Cada parcela leva a parte proporcional ao valor dela, e a
 *   última fica com o resto dos centavos. (B1)
 * - Pedido com desconto usa só o dele; o "Desconto por antecipação" da
 *   Configuração de cobrança continua valendo para pedido sem desconto. (B2)
 * - Vale para os boletos gerados daqui em diante e as reemissões; os já
 *   registrados ficam como estão. (B3)
 * - Parcela sem boleto (Pix, transferência, ordem) continua como antes. (B4)
 * - A NF-e não muda: as duplicatas saem com o valor do pedido. (B5)
 * - Comissão e royalty: sempre sobre o valor do pedido (a parcela). O que o
 *   cliente paga a mais depois do vencimento — o desconto perdido, a multa e
 *   os juros — é encargo.
 *
 * O boleto guarda `valor` (o cheio, o do banco), `valor_desconto` e
 * `desconto_ate` (sql/boletos_desconto_condicional.sql). O valor EM DIA —
 * o da parcela — é `valor − valor_desconto − valor_abatimento`.
 *
 * Tudo aqui é puro; datas são texto 'YYYY-MM-DD'.
 */
const xmlNfe = require('../fiscal/xmlNfe');
const calculo = require('./boletoCalculo');
const vencimentos = require('./vencimento');

const SQL_ARQUIVO = 'sql/boletos_desconto_condicional.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API: sem ele o boleto com desconto até o vencimento não pode ser gerado.`;

const centavos = v => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

/**
 * O desconto do pedido e sobre quanto ele vale: `taxa` é desconto ÷ valor do
 * pedido (o com desconto). null quando o pedido não tem desconto.
 */
function descontoDoPedido({ pedido, itens = [] }) {
  const t = xmlNfe.totaisPrevistos({ pedido, itens });
  if (!t || !(t.valor_total > 0) || !(t.valor_desconto > 0)) return null;
  return {
    desconto: t.valor_desconto,
    valor_pedido: t.valor_total,
    valor_cheio: centavos(t.valor_total + t.valor_desconto),
    taxa: t.valor_desconto / t.valor_total
  };
}

/**
 * O desconto de cada parcela: `Map(numero_parcela → valor)`. Proporcional ao
 * valor da parcela; a última com valor fica com o resto dos centavos, para a
 * soma fechar com o desconto do pedido. Parcela zerada não leva nada.
 */
function descontosDasParcelas({ pedido, itens = [], parcelas = [] }) {
  const mapa = new Map();
  const d = descontoDoPedido({ pedido, itens });
  if (!d) return mapa;
  const comValor = (parcelas || [])
    .filter(p => p && centavos(p.valor) > 0)
    .sort((a, b) => (Number(a.numero_parcela) || 0) - (Number(b.numero_parcela) || 0));
  if (!comValor.length) return mapa;
  const alvo = centavos(comValor.reduce((s, p) => s + centavos(p.valor), 0) * d.taxa);
  let soma = 0;
  comValor.forEach((p, i) => {
    const valor = i === comValor.length - 1 ? centavos(alvo - soma) : centavos(centavos(p.valor) * d.taxa);
    soma = centavos(soma + valor);
    mapa.set(Number(p.numero_parcela), Math.max(valor, 0));
  });
  return mapa;
}

/**
 * O que o boleto de uma parcela vai cobrar: o cheio (parcela + desconto) e o
 * desconto até o vencimento. Sem desconto, o boleto é a própria parcela.
 */
function boletoDaParcela({ parcela, desconto = 0, vencimento }) {
  const valorParcela = centavos(parcela?.valor);
  const d = centavos(desconto);
  return {
    valor_parcela: valorParcela,
    valor: centavos(valorParcela + (d > 0 ? d : 0)),
    desconto: d > 0 ? { valor: d, ate: vencimento } : null
  };
}

/** O valor EM DIA de um boleto: o cheio menos o desconto e o abatimento. */
function valorEmDia(boleto) {
  return centavos(Number(boleto?.valor || 0) - Number(boleto?.valor_desconto || 0) - Number(boleto?.valor_abatimento || 0));
}

/**
 * Quanto o boleto cobra em `hoje`. Até o último dia para pagar sem encargos
 * (o vencimento, ou o próximo dia útil), o valor em dia. Depois, o cheio (sem
 * o desconto) mais a multa e os juros sobre ele, com as taxas gravadas no
 * boleto — as que o banco vai cobrar.
 */
function devidoHoje({ boleto, vencimento, hoje, feriados = [] }) {
  const emDia = valorEmDia(boleto);
  const venc = vencimentos.diaDe(vencimento || boleto?.data_vencimento);
  const dias = venc && hoje ? vencimentos.diasDeAtraso(venc, hoje, feriados) : 0;
  const vazio = { dias: 0, em_dia: emDia, desconto_perdido: 0, multa: 0, juros: 0, encargos: 0, total: emDia };
  if (!(dias > 0)) return vazio;
  const cheio = centavos(Number(boleto?.valor || 0) - Number(boleto?.valor_abatimento || 0));
  const pctMulta = Number(boleto?.multa_percentual || 0);
  const multa = pctMulta > 0 ? calculo.valorMulta(cheio, pctMulta) : 0;
  const porDia = Number(boleto?.juros_valor_dia) > 0
    ? Number(boleto.juros_valor_dia)
    : (Number(boleto?.juros_percentual_mes) > 0 ? calculo.jurosPorDia(cheio, boleto.juros_percentual_mes) : 0);
  const juros = centavos(porDia * dias);
  const descontoPerdido = centavos(cheio - emDia);
  const total = centavos(cheio + multa + juros);
  return { dias, em_dia: emDia, desconto_perdido: descontoPerdido, multa, juros, encargos: centavos(total - emDia), total };
}

/**
 * O banco já tem as colunas? A linha que a API devolve depois de gravar traz
 * TODAS as colunas da tabela (`RETURNING *`): sem `valor_desconto` nela, o
 * SQL não rodou e o desconto se perderia — o boleto não pode sair.
 */
const colunasProntas = linha => Boolean(linha) && Object.prototype.hasOwnProperty.call(linha, 'valor_desconto');

module.exports = {
  SQL_ARQUIVO, SQL_FALTANDO,
  descontoDoPedido, descontosDasParcelas, boletoDaParcela, valorEmDia, devidoHoje, colunasProntas
};
