/**
 * O retrato dos vencimentos do pedido que acompanha a NF-e.
 *
 * A regra Y09-10 da NF-e (rejeição 900) não aceita dVenc anterior à
 * emissão. Essas datas continuam sendo verdadeiras: ficam nas informações
 * complementares do XML, sem trocar o dia registrado pelo dia da emissão.
 * O DANFE lê esse mesmo texto, nunca o cadastro atual de um pedido antigo.
 */
const { diaValido } = require('../faturamentoPedido');

const INICIO = 'VENCIMENTOS REGISTRADOS DO PEDIDO: ';
const FIM = 'FIM DOS VENCIMENTOS REGISTRADOS DO PEDIDO.';
const ROTULOS = { paga: 'Paga', parcial: 'Parcialmente paga', vencida: 'Vencida', em_aberto: 'Em aberto' };
const numero = valor => {
  if (typeof valor !== 'string') return Number(valor);
  const texto = valor.trim();
  return Number(texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto);
};
const centavos = valor => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
const reais = valor => centavos(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataImpressa = valor => valor.split('-').reverse().join('/');

function doPedido(linha, pedidoId, numeroParcela) {
  return linha && String(linha.pedido_id) === String(pedidoId)
    && Number(linha.numero_parcela) === Number(numeroParcela);
}

function principalRecebido(parcela, pedidoId, recebimentos = [], boletos = []) {
  const valor = centavos(numero(parcela.valor));
  const boletoQuitado = boletos.some(b => doPedido(b, pedidoId, parcela.numero_parcela)
    && (b.status === 'pago' || (b.status === 'baixado' && b.motivo_baixa === 'quitado_por_fora')));
  // O banco confirmou a liquidação, inclusive antes da conciliação criar
  // o lançamento financeiro. Não emitir de novo essa cobrança.
  if (boletoQuitado) return valor;
  const vistos = new Set();
  const recebido = recebimentos.filter(r => doPedido(r, pedidoId, parcela.numero_parcela)
    && r.status === 'confirmado').reduce((soma, r) => {
    if (r.id !== undefined && r.id !== null) {
      if (vistos.has(String(r.id))) return soma;
      vistos.add(String(r.id));
    }
    // Legado: o status era salvo sem o valor; ele já representa quitação.
    if (r.valor_recebido === undefined || r.valor_recebido === null) return soma + valor;
    const pago = numero(r.valor_recebido) || 0;
    // O sinal faz parte da quitação do app: encargos negativos representam
    // o desconto concedido no recebimento, não saldo ainda a receber.
    const encargos = numero(r.valor_encargos) || 0;
    const abatimento = Math.max(numero(r.valor_abatimento) || 0, 0);
    return soma + Math.max(pago - encargos + abatimento, 0);
  }, 0);
  return centavos(Math.min(Math.max(recebido, 0), valor));
}

function registrarParcelas({ parcelas = [], pedidoId, recebimentos = [], boletos = [], dataEmissao }) {
  return [...parcelas]
    .sort((a, b) => (Number(a.numero_parcela) || 0) - (Number(b.numero_parcela) || 0))
    .map((p, i) => {
      const numeroParcela = Number(p.numero_parcela) || i + 1;
      const vencimento = diaValido(p.data_vencimento);
      const valor = centavos(numero(p.valor));
      let mensagem;
      if (!vencimento) mensagem = `Parcela ${numeroParcela} sem data de vencimento válida.`;
      else if (!(valor > 0)) mensagem = `Parcela ${numeroParcela} sem valor positivo.`;
      if (mensagem) {
        const e = new Error(mensagem);
        e.status = 422;
        throw e;
      }
      const valorPago = principalRecebido(p, pedidoId, recebimentos, boletos);
      const saldo = centavos(Math.max(valor - valorPago, 0));
      return {
        numero: String(numeroParcela).padStart(3, '0'), vencimento, valor,
        situacao: saldo === 0 ? 'paga' : (valorPago > 0 ? 'parcial' : (vencimento < dataEmissao ? 'vencida' : 'em_aberto')),
        valor_pago: valorPago, saldo
      };
    });
}

function textoDasParcelas(parcelas) {
  if (!parcelas.length) return '';
  return INICIO + parcelas.map(p => `Parcela ${p.numero}: vencimento ${dataImpressa(p.vencimento)}, `
    + `valor R$ ${reais(p.valor)}, liquidado R$ ${reais(p.valor_pago)}, situacao ${ROTULOS[p.situacao]}, saldo R$ ${reais(p.saldo)}.`).join(' ') + ` ${FIM}`;
}

/** Texto livre pode citar datas, mas não produzir o retrato oficial. */
function textoLivreSemMarcadores(texto) {
  return String(texto || '').replaceAll(INICIO.trim(), 'Vencimentos informados no texto:')
    .replaceAll(FIM, 'Fim dos vencimentos informados no texto.');
}

/** Lê somente o bloco completo, com o formato produzido acima. */
function parcelasRegistradasDoTexto(texto) {
  const original = String(texto || '');
  const inicio = original.lastIndexOf(INICIO);
  if (inicio < 0) return [];
  const fim = original.indexOf(FIM, inicio + INICIO.length);
  if (fim < 0) return [];
  const bloco = original.slice(inicio + INICIO.length, fim).trim();
  const padrao = /Parcela (\d{1,3}): vencimento (\d{2}\/\d{2}\/\d{4}), valor R\$ ([\d.]+,\d{2}), liquidado R\$ ([\d.]+,\d{2}), situacao (Paga|Parcialmente paga|Vencida|Em aberto), saldo R\$ ([\d.]+,\d{2})\./g;
  const resultado = [];
  let cursor = 0;
  for (const m of bloco.matchAll(padrao)) {
    if (bloco.slice(cursor, m.index).trim()) return [];
    const vencimento = diaValido(m[2].split('/').reverse().join('-'));
    const valor = numero(m[3]);
    const valorPago = numero(m[4]);
    const saldo = numero(m[6]);
    if (!vencimento || !(valor > 0) || !(valorPago >= 0) || !(saldo >= 0)
      || valorPago > valor || Math.abs(centavos(valorPago + saldo) - valor) > 0.005) return [];
    resultado.push({
      numero: m[1].padStart(3, '0'), vencimento, valor,
      situacao: Object.keys(ROTULOS).find(chave => ROTULOS[chave] === m[5]), valor_pago: valorPago, saldo
    });
    cursor = m.index + m[0].length;
  }
  return bloco.slice(cursor).trim() ? [] : resultado;
}

module.exports = { registrarParcelas, textoDasParcelas, parcelasRegistradasDoTexto, textoLivreSemMarcadores };
