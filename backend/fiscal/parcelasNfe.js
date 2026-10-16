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
  // O banco confirmou a liquidação, inclusive antes da conciliação criar
  // o lançamento financeiro. Não emitir de novo essa cobrança.
  const boletoQuitado = boletos.some(b => doPedido(b, pedidoId, parcela.numero_parcela)
    && (b.status === 'pago' || (b.status === 'baixado' && b.motivo_baixa === 'quitado_por_fora')));
  // Pagamento confirmado quita a parcela, como o boleto pago (decisão do dono,
  // 16/10/2026): Pix, cartão, dinheiro… O Financeiro aceita um só recebimento
  // confirmado por parcela, e a diferença para o valor dela (a mais ou a menos)
  // é encargo ou desconto daquele pagamento, não saldo a receber. Sem conta
  // de encargos aqui: com ela, parcela que mudou de valor depois do Pix saía
  // "PARCIAL" no DANFE e voltava como duplicata na nota.
  const recebimentoConfirmado = recebimentos.some(r => doPedido(r, pedidoId, parcela.numero_parcela)
    && r.status === 'confirmado');
  return boletoQuitado || recebimentoConfirmado ? valor : 0;
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
        // Sem "parcial": a parcela está paga ou não está (ver principalRecebido).
        // O rótulo continua em ROTULOS só para ler o texto de notas antigas.
        situacao: saldo === 0 ? 'paga' : (vencimento < dataEmissao ? 'vencida' : 'em_aberto'),
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

/** Só pagamentos datados ANTES da emissão podem aparecer como PAGO no DANFE. */
function parcelasParaDanfe({ parcelas = [], pedidoId, recebimentos = [], boletos = [], dataEmissao }) {
  const anterior = data => {
    const dia = diaValido(data);
    return Boolean(dia && dataEmissao && dia < dataEmissao);
  };
  return registrarParcelas({
    parcelas, pedidoId, dataEmissao,
    recebimentos: recebimentos.filter(r => anterior(r.data_recebimento)),
    boletos: boletos.filter(b => anterior(b.data_pagamento))
  });
}

/** Não mostrar o bloco antigo em DANFEs de XMLs previamente emitidos. */
function retirarHistoricoParcelas(texto) {
  const original = String(texto || '');
  const inicio = original.lastIndexOf(INICIO);
  if (inicio < 0) return original;
  const fim = original.indexOf(FIM, inicio + INICIO.length);
  if (fim < 0) return original;
  return (original.slice(0, inicio) + original.slice(fim + FIM.length)).trim();
}

module.exports = {
  registrarParcelas, parcelasParaDanfe, retirarHistoricoParcelas,
  textoDasParcelas, parcelasRegistradasDoTexto, textoLivreSemMarcadores
};
