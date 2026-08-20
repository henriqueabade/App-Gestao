/**
 * A matemática de desconto de um item — orçamento ou pedido.
 *
 * A CONVENÇÃO DAS COLUNAS, que não é óbvia e já causou erro:
 *
 *   valor_unitario        preço cheio da unidade
 *   desconto_*_prc        percentuais
 *   desconto_pagamento    \
 *   desconto_especial      >  em reais, POR UNIDADE
 *   valor_desc            /   (soma dos dois acima)
 *   valor_unitario_desc   preço da unidade já com desconto
 *   desconto_total        em reais, DA LINHA (valor_desc × quantidade)
 *   valor_total           DA LINHA, JÁ COM DESCONTO
 *
 * Note que `valor_total` é líquido, não bruto — somar `valor_total` de todas
 * as linhas dá o total do documento. Tratá-lo como bruto faz a soma das linhas
 * divergir do total gravado, e o erro só aparece na conferência do financeiro.
 *
 * Espelha o cálculo de `src/js/modals/orcamento-editar.js`, que é onde o
 * usuário monta o documento pela primeira vez.
 */

/**
 * Desconto de pagamento padrão, em pontos percentuais.
 *
 * São duas concessões independentes e cumulativas: 5% por levar mais de uma
 * peça e 5% por pagar à vista. O que passar disso é desconto ESPECIAL —
 * negociado caso a caso — e sobrevive à troca da condição de pagamento.
 */
function descontoPadrao(quantidade, condicao) {
  return (Number(quantidade) > 1 ? 5 : 0) + (condicao === 'vista' ? 5 : 0);
}

/**
 * Reparte o desconto total da linha entre "pagamento" (o padrão) e
 * "especial" (o excedente). A ordem importa: o padrão é preenchido primeiro,
 * então uma linha com 10% em condição à vista tem 10 de pagamento e 0 de
 * especial — e a mesma linha a prazo teria 5 e 5.
 */
function repartirDesconto(descontoTotalPrc, quantidade, condicao) {
  const total = Number(descontoTotalPrc) || 0;
  const padrao = descontoPadrao(quantidade, condicao);
  const pagamento = Math.min(padrao, total);
  return { pagamento, especial: Math.max(total - pagamento, 0) };
}

/**
 * Recalcula o desconto de uma linha quando a CONDIÇÃO muda.
 *
 * O desconto especial é preservado e o padrão é substituído — quem tinha 3%
 * negociados continua com eles depois de trocar "à vista" por "a prazo",
 * perdendo só os 5% que existiam por ser à vista.
 */
function descontoAoTrocarCondicao(item, condicaoAnterior, condicaoNova) {
  const quantidade = Number(item?.quantidade) || 0;
  const atualPrc = (Number(item?.desconto_pagamento_prc) || 0)
                 + (Number(item?.desconto_especial_prc) || 0);
  const especial = Math.max(atualPrc - descontoPadrao(quantidade, condicaoAnterior), 0);
  return especial + descontoPadrao(quantidade, condicaoNova);
}

/**
 * Monta os campos monetários da linha a partir do unitário cheio e dos
 * percentuais. Devolve só as colunas de valor — quantidade, produto e nome
 * não são assunto deste cálculo.
 */
function calcularItem({ valorUnitario, quantidade, pctPagamento = 0, pctEspecial = 0 }) {
  const unitario = Number(valorUnitario) || 0;
  const qtd = Number(quantidade) || 0;

  const descontoPagamento = unitario * ((Number(pctPagamento) || 0) / 100);
  const descontoEspecial = unitario * ((Number(pctEspecial) || 0) / 100);
  const descontoUnitario = descontoPagamento + descontoEspecial;
  const unitarioComDesconto = unitario - descontoUnitario;

  return {
    valor_unitario: unitario,
    valor_unitario_desc: unitarioComDesconto,
    desconto_pagamento: descontoPagamento,
    desconto_pagamento_prc: Number(pctPagamento) || 0,
    desconto_especial: descontoEspecial,
    desconto_especial_prc: Number(pctEspecial) || 0,
    valor_desc: descontoUnitario,
    desconto_total: descontoUnitario * qtd,
    valor_total: unitarioComDesconto * qtd
  };
}

/**
 * Totais do documento a partir das linhas já calculadas.
 *
 * `desconto_pagamento` e `desconto_especial` na tabela do documento são
 * SOMAS DE LINHA (por unidade × quantidade), diferente das colunas de mesmo
 * nome no item, que são por unidade.
 */
function totaisDoDocumento(linhas = []) {
  let subtotal = 0;
  let descontoPagamento = 0;
  let descontoEspecial = 0;

  for (const linha of Array.isArray(linhas) ? linhas : []) {
    const qtd = Number(linha?.quantidade) || 0;
    subtotal += (Number(linha?.valor_unitario) || 0) * qtd;
    descontoPagamento += (Number(linha?.desconto_pagamento) || 0) * qtd;
    descontoEspecial += (Number(linha?.desconto_especial) || 0) * qtd;
  }

  const descontoTotal = descontoPagamento + descontoEspecial;
  return {
    subtotal,
    desconto_pagamento: descontoPagamento,
    desconto_especial: descontoEspecial,
    desconto_total: descontoTotal,
    valor_final: subtotal - descontoTotal
  };
}

module.exports = {
  descontoPadrao,
  repartirDesconto,
  descontoAoTrocarCondicao,
  calcularItem,
  totaisDoDocumento
};
