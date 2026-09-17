/**
 * As contas da devolução de um pedido — puras, sem rede.
 *
 * O VALOR. Cada peça devolvida vale o que o cliente pagou por ela: o total da
 * linha (que já é líquido dos descontos — ver backend/descontos.js) dividido
 * pela quantidade. Os percentuais negociados não mudam por causa da
 * devolução. Quando a linha inteira volta, vale o que restava dela, para os
 * centavos fecharem com o total do pedido.
 *
 * O TIPO. É `total` quando, com esta devolução, todas as peças do pedido
 * voltaram; senão `parcial`.
 *
 * O DINHEIRO (D = valor devolvido; P = soma do que está em aberto):
 *
 *   total                 as parcelas em aberto são canceladas e tudo o que
 *                         já foi pago é reembolsado;
 *   parcial, D <= P       D vira desconto em TODAS as parcelas em aberto, na
 *                         proporção do saldo de cada uma (os centavos que
 *                         sobram vão para a última). Nenhum reembolso;
 *   parcial, D > P        as parcelas em aberto zeram e a diferença (D - P) é
 *                         reembolsada, repartida entre as parcelas pagas na
 *                         proporção do que cada uma pagou.
 *
 * Os PRAZOS nunca mudam: a devolução só mexe em valor.
 *
 * PARCELA MÍNIMA (cobranca/parcelaMinima.js). Se o desconto deixa alguma
 * parcela em aberto abaixo do mínimo, as parcelas em aberto são JUNTADAS nas
 * primeiras, na ordem (os vencimentos das primeiras ficam): cabem tantas
 * quanto o total comportar (ao menos uma), em partes iguais. Ex.: 5 × R$ 100
 * viram 1 × R$ 500 no primeiro vencimento. A parcela que cresce e tinha boleto
 * ganha boleto novo (baixa e reemissão no BB, mesma data). A 1ª parcela com
 * prazo 0 (entrada à vista) fica de fora da junção.
 *
 * "Pago" é o que está pago no momento do registro (recebimento confirmado ou
 * boleto pago), e o reembolso é do principal — juros e multa ficam de fora.
 */

const parcelaMinima = require('../cobranca/parcelaMinima');

const centavos = v => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const emCentavos = v => Math.round((Number(v || 0) + Number.EPSILON) * 100);
const inteiro = v => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = v => moeda.format(centavos(v));

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** O preço que o cliente pagou por UMA peça da linha (líquido dos descontos). */
function valorDaUnidade(item) {
  const quantidade = inteiro(item?.quantidade);
  const total = Number(item?.valor_total);
  if (quantidade > 0 && Number.isFinite(total)) return total / quantidade;
  const comDesconto = Number(item?.valor_unitario_desc);
  if (Number.isFinite(comDesconto) && comDesconto > 0) return comDesconto;
  return Number(item?.valor_unitario) || 0;
}

/** O que a linha vale no pedido: o `valor_total` gravado, senão unidade × quantidade. */
function valorDaLinha(item) {
  const total = Number(item?.valor_total);
  return centavos(Number.isFinite(total) ? total : valorDaUnidade(item) * inteiro(item?.quantidade));
}

/** Quanto valem `quantidade` peças desta linha, contando o que já voltou antes. */
function valorDaDevolucaoDoItem(item, quantidade) {
  const total = inteiro(item?.quantidade);
  const antes = Math.min(total, Math.max(0, inteiro(item?.quantidade_devolvida)));
  const unidade = valorDaUnidade(item);
  // A linha fecha: devolve o que sobrou dela, e os centavos batem com o pedido.
  if (antes + quantidade >= total) return centavos(valorDaLinha(item) - centavos(unidade * antes));
  return centavos(unidade * quantidade);
}

/** As peças do pedido para a tela: quantas saíram, quantas já voltaram e quantas ainda podem voltar. */
function itensParaDevolver(itens = []) {
  return (Array.isArray(itens) ? itens : []).filter(Boolean).map(item => {
    const quantidade = inteiro(item.quantidade);
    const devolvida = Math.min(quantidade, Math.max(0, inteiro(item.quantidade_devolvida)));
    return {
      pedido_item_id: item.id,
      produto_id: item.produto_id ?? null,
      codigo: item.codigo || '',
      nome: item.nome || item.codigo || `Item ${item.id}`,
      ncm: item.ncm || '',
      quantidade,
      devolvida,
      disponivel: quantidade - devolvida,
      valor_unitario: centavos(valorDaUnidade(item)),
      valor_cheio: centavos(item.valor_unitario),
      valor_total: valorDaLinha(item)
    };
  });
}

/**
 * Reparte `total` na proporção dos `pesos`, em centavos, sem passar do peso de
 * cada parte. O que o arredondamento deixa sobrar vai para a ÚLTIMA parte (e,
 * se ela não comportar, para a anterior).
 */
function repartir(total, pesos = []) {
  const alvo = emCentavos(total);
  const tetos = pesos.map(p => Math.max(0, emCentavos(p)));
  const soma = tetos.reduce((s, p) => s + p, 0);
  if (!(alvo > 0) || !(soma > 0)) return tetos.map(() => 0);
  if (alvo >= soma) return tetos.map(p => p / 100);
  // BigInt: centavos × centavos passa de 2^53 em pedidos grandes.
  const partes = tetos.map(p => Number((BigInt(alvo) * BigInt(p)) / BigInt(soma)));
  let resto = alvo - partes.reduce((s, p) => s + p, 0);
  for (let i = partes.length - 1; i >= 0 && resto > 0; i -= 1) {
    const cabe = Math.min(tetos[i] - partes[i], resto);
    partes[i] += cabe;
    resto -= cabe;
  }
  return partes.map(p => p / 100);
}

/** Confere as escolhas da tela contra o que o pedido ainda tem, e devolve as linhas com o valor. */
function conferirEscolhas(itens, escolhas) {
  const porId = new Map(itensParaDevolver(itens).map(i => [String(i.pedido_item_id), i]));
  const crus = new Map((Array.isArray(itens) ? itens : []).filter(Boolean).map(i => [String(i.id), i]));
  const somadas = new Map();
  for (const e of Array.isArray(escolhas) ? escolhas : []) {
    const chave = String(e?.pedido_item_id ?? '');
    const quantidade = Number(e?.quantidade);
    if (!quantidade) continue;
    if (!porId.has(chave)) throw erro('Uma das peças escolhidas não é deste pedido. Reabra a devolução.', 422);
    if (!Number.isInteger(quantidade) || quantidade < 0) throw erro(`Quantidade inválida em "${porId.get(chave).nome}".`, 422);
    somadas.set(chave, (somadas.get(chave) || 0) + quantidade);
  }
  if (!somadas.size) throw erro('Escolha ao menos uma peça para devolver.', 422);

  const linhas = [];
  for (const [chave, quantidade] of somadas) {
    const item = porId.get(chave);
    if (quantidade > item.disponivel) {
      throw erro(item.disponivel > 0
        ? `"${item.nome}": só ${item.disponivel} ${item.disponivel === 1 ? 'peça pode' : 'peças podem'} ser devolvida${item.disponivel === 1 ? '' : 's'} (pediu ${quantidade}).`
        : `"${item.nome}" já foi devolvida por inteiro.`, 422);
    }
    linhas.push({
      pedido_item_id: item.pedido_item_id, produto_id: item.produto_id, codigo: item.codigo, nome: item.nome,
      quantidade, valor_unitario: item.valor_unitario,
      valor_total: valorDaDevolucaoDoItem(crus.get(chave), quantidade),
      fecha_a_linha: quantidade === item.disponivel
    });
  }
  // Tudo voltou quando nenhuma linha do pedido fica com peça na rua.
  const completa = [...porId.values()].every(i => (somadas.get(String(i.pedido_item_id)) || 0) === i.disponivel);
  return { linhas, completa };
}

const modoDaZerada = p => (p.boleto?.a_pagar ? 'baixa_boleto' : 'cancelada');
const modoDoDesconto = p => (p.boleto?.a_pagar ? 'abatimento_boleto' : 'valor_parcela');
/** A parcela que CRESCE na junção: o boleto não aumenta de valor, então é baixado e reemitido. */
const modoDoAumento = p => (p.boleto?.a_pagar ? 'reemissao_boleto' : 'valor_parcela');

function linhaDaParcela(p, { situacao, modo, antes, desconto }) {
  return {
    numero_parcela: p.numero, parcela_id: p.parcela_id ?? null, data_vencimento: p.vencimento || null,
    situacao, modo, valor_antes: centavos(antes), desconto: centavos(desconto), valor_depois: centavos(antes - desconto),
    boleto_id: p.boleto?.id ?? null, nosso_numero: p.boleto?.nosso_numero ?? null, recebimento_id: p.recebimento_id ?? null
  };
}

/**
 * O plano inteiro da devolução.
 *
 * `parcelas`: [{ numero, parcela_id, vencimento, estado: 'aberta' | 'paga' |
 * 'cancelada', saldo (aberta: o que falta pagar), pago (paga: o principal
 * pago), reembolsado (paga: o que devoluções anteriores já reembolsaram),
 * boleto: { id, nosso_numero, status, a_pagar } | null, recebimento_id,
 * isenta (a 1ª com prazo 0) }]. `minimo` é a parcela mínima (0 = sem).
 */
function planejar({ pedido, itens, escolhas, parcelas = [], minimo = 0 }) {
  const { linhas, completa } = conferirEscolhas(itens, escolhas);
  const valor = centavos(linhas.reduce((s, l) => s + l.valor_total, 0));
  const tipo = completa ? 'total' : 'parcial';
  const avisos = [];

  const ordenadas = (Array.isArray(parcelas) ? parcelas : []).filter(Boolean).slice().sort((a, b) => Number(a.numero) - Number(b.numero));
  const abertas = ordenadas.filter(p => p.estado === 'aberta' && centavos(p.saldo) > 0);
  const pagas = ordenadas
    .filter(p => p.estado === 'paga')
    .map(p => ({ ...p, restante: Math.max(0, centavos(centavos(p.pago) - centavos(p.reembolsado))) }))
    .filter(p => p.restante > 0);
  const emAberto = centavos(abertas.reduce((s, p) => s + centavos(p.saldo), 0));
  const pago = centavos(pagas.reduce((s, p) => s + p.restante, 0));

  let descontos;
  let reembolso;
  if (tipo === 'total') {
    descontos = abertas.map(p => centavos(p.saldo));
    reembolso = pago;
  } else if (valor <= emAberto) {
    descontos = repartir(valor, abertas.map(p => p.saldo));
    reembolso = 0;
  } else {
    descontos = abertas.map(p => centavos(p.saldo));
    reembolso = centavos(valor - emAberto);
    if (reembolso > pago) {
      avisos.push(`A devolução (${reais(valor)}) passa do que o pedido tem em aberto e pago (${reais(emAberto + pago)}): o reembolso ficou no que foi pago.`);
      reembolso = pago;
    }
  }
  const reembolsos = repartir(reembolso, pagas.map(p => p.restante));

  // Parcela mínima: o que ficaria abaixo dela é juntado nas primeiras em aberto.
  let juntadas = false;
  if (tipo === 'parcial' && valor <= emAberto) {
    const junta = parcelaMinima.juntarParcelas(
      abertas.map((p, i) => ({ numero: p.numero, valor: centavos(centavos(p.saldo) - centavos(descontos[i])), isenta: Boolean(p.isenta) })),
      minimo
    );
    if (junta) {
      descontos = abertas.map((p, i) => centavos(centavos(p.saldo) - junta[i].valor));
      juntadas = true;
      const ficam = junta.filter(p => p.valor > 0 && !p.isenta).length;
      avisos.push(`Parcela mínima de ${reais(minimo)}: as parcelas em aberto foram juntadas em ${ficam === 1 ? '1 parcela' : `${ficam} parcelas`}, nos primeiros vencimentos.`);
    }
  }

  const linhasDasParcelas = [];
  abertas.forEach((p, i) => {
    const desconto = centavos(descontos[i]);
    if (!desconto) return;
    if (desconto < 0) {
      linhasDasParcelas.push(linhaDaParcela(p, { situacao: 'aberta', modo: modoDoAumento(p), antes: p.saldo, desconto }));
      return;
    }
    const zera = desconto >= centavos(p.saldo);
    linhasDasParcelas.push(linhaDaParcela(p, { situacao: 'aberta', modo: zera ? modoDaZerada(p) : modoDoDesconto(p), antes: p.saldo, desconto: zera ? p.saldo : desconto }));
    if (p.boleto?.a_pagar && p.boleto.status === 'protestado') avisos.push(`A parcela ${p.numero} tem boleto protestado: o BB pode recusar a alteração.`);
  });
  pagas.forEach((p, i) => {
    const parte = centavos(reembolsos[i]);
    if (!(parte > 0)) return;
    linhasDasParcelas.push(linhaDaParcela(p, { situacao: 'paga', modo: 'reembolso', antes: p.restante, desconto: parte }));
  });
  if (!ordenadas.length) avisos.push('O pedido não tem parcelas lançadas: nada a ajustar no financeiro.');

  const original = centavos(pedido?.valor_original ?? pedido?.valor_final);
  const devolvidoAntes = centavos(pedido?.valor_devolvido);
  const devolvido = tipo === 'total' ? original : Math.min(original, centavos(devolvidoAntes + valor));
  return {
    tipo, valor, itens: linhas, parcelas: linhasDasParcelas,
    em_aberto: emAberto, pago, juntadas,
    valor_parcelas: centavos(linhasDasParcelas.filter(l => l.situacao === 'aberta').reduce((s, l) => s + l.desconto, 0)),
    valor_reembolso: centavos(linhasDasParcelas.filter(l => l.situacao === 'paga').reduce((s, l) => s + l.desconto, 0)),
    // Devolvido por inteiro, o pedido volta a mostrar o valor da venda (como o
    // cancelado mostra); parcial, mostra o que restou dela.
    pedido: { valor_original: original, valor_devolvido: devolvido, valor_final: tipo === 'total' ? original : Math.max(0, centavos(original - devolvido)) },
    avisos
  };
}

module.exports = { centavos, valorDaUnidade, valorDaLinha, valorDaDevolucaoDoItem, itensParaDevolver, repartir, conferirEscolhas, planejar };
