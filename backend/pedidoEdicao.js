/**
 * Editar as peças de um pedido em Produção (pedido do dono, 14/10/2026).
 *
 * Quem: só os dois e-mails do dono (EDITORES). Quando: pedido em Produção, sem
 * NF-e (do sistema ou de fora) e sem nenhuma parcela travada (boleto do BB,
 * boleto de fora, pagamento registrado ou ordem de pagamento).
 *
 * O que dá para fazer: mudar a quantidade de uma linha, tirar uma linha,
 * pôr uma peça nova e JUNTAR linhas da mesma peça (o PED121 nasceu com duas
 * linhas iguais vindas da IA). Tudo é recalculado pelas regras de sempre.
 *
 * AS UNIDADES QUE SAEM (decisões do dono)
 * ---------------------------------------
 *   - ordem de retirada: as produzidas do zero primeiro (as menos adiantadas
 *     antes), depois as que vieram pela metade do estoque, e as prontas do
 *     estoque por último;
 *   - cada uma volta ao estoque no ponto em que está (nunca antes do ponto em
 *     que entrou no pedido), e o material do resto da rota volta à
 *     matéria-prima — a do zero que nem começou não vira peça, e todo o
 *     material dela volta. É a regra do cancelamento (cancelamentoEstorno.js);
 *   - o trabalho de produção já registrado continua pago: a edição é uma
 *     MUDANÇA de unidades para a produção (pedido_edicoes.unidades, lida por
 *     financeiro/mudancasUnidades.js), como as trocas de peças.
 *
 * AS UNIDADES QUE ENTRAM
 * ----------------------
 *   A mesma escolha da conversão do orçamento — pronta do estoque, pela
 *   metade ou do zero — feita no mesmo modal (orcamento-converter.js em modo
 *   edição), só para as unidades novas, e aplicada pelo mesmo código
 *   (conversaoAplicar.aplicarConversaoNoEstoque).
 *
 * OS VALORES
 * ----------
 *   Linha alterada ou nova: preço da tabela fixa, desconto de pagamento pela
 *   regra (descontos.js) e o desconto especial da linha mantido. Linha que não
 *   mudou fica como está. O Adicional/Desconto do pagamento (ajuste_valor) é
 *   mantido; as parcelas ficam com a mesma quantidade e as mesmas datas, e o
 *   total novo é dividido em partes iguais, como no orçamento (splitEqual).
 *
 * O REGISTRO
 * ----------
 *   Uma linha em `pedido_edicoes` (sql/pedido_edicoes.sql, nunca alterada) com
 *   o antes, o depois, o motivo e o que aconteceu; o evento "edição" no
 *   histórico do pedido; os movimentos do razão de estoque; o histórico de
 *   cada insumo (registrarEntrada/registrarSaida); e o evento do Financeiro.
 *
 * Sem transação (como todo o app): tudo é conferido antes da primeira escrita
 * e a simulação devolve uma `assinatura` — se o pedido mudou entre a revisão e
 * a confirmação, nada é gravado.
 */
const crypto = require('crypto');
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { carregarUsuarioAtual } = require('./permissionsController');
const descontos = require('./descontos');
const parcelaMinima = require('./cobranca/parcelaMinima');
const pedidoParcelas = require('./pedidoParcelas');
const { getMaxId, inserirLinhaComId } = require('./idsSequenciais');
const { aplicarConversaoNoEstoque } = require('./conversaoAplicar');
const { planejarConsumo } = require('./conversaoEstoque');
const estorno = require('./cancelamentoEstorno');
const { MOV, ITEM, RESERVA, EVENTO, registrarMovimento, registrarEventoDoPedido } = require('./estoqueLedger');
const materiaPrima = require('./materiaPrima');
const regras = require('./financeiro/regras');
const producao = require('./financeiro/producao');
const unidadesProducao = require('./financeiro/producaoUnidades');
const mudancas = require('./financeiro/mudancasUnidades');
const auditoria = require('./financeiro/auditoria');
const { usuarioDaRequisicao } = require('./usuarioAtual');
const { paraDecimal } = require('./numeros');

/** Os dois e-mails do dono (14/10/2026): "pode travar pelo e-mail". */
const EDITORES = new Set(['henrique.abade@santissimodecor.com.br', 'henrique.vabade@gmail.com']);
const SITUACAO = 'Produção';
const MINIMO_MOTIVO = 10;
const TABELA = mudancas.TABELA_EDICOES;
const SQL_ARQUIVO = 'sql/pedido_edicoes.sql';
/** NF-e do sistema que conta como "o pedido tem nota" (as mesmas do painel fiscal). */
const NFE_VIVA = new Set(['autorizada', 'processando', 'enviando', 'cancelamento_pendente']);

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const numero = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const arredondar = v => Math.round((numero(v) + Number.EPSILON) * 10000) / 10000;
const centavos = v => Math.round((numero(v) + Number.EPSILON) * 100) / 100;
const reais = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const plural = (n, um, varios) => `${n} ${Number(n) === 1 ? um : varios}`;
const ativo = v => !(v === false || v === 'false' || v === 0 || v === 'f');
const nomeDaPeca = item => [item?.codigo, item?.nome].filter(Boolean).join(' — ') || `peça ${item?.id ?? ''}`.trim();

function erro(mensagem, status = 422, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** O usuário é um dos editores? Pura. */
function ehEditor(usuario) {
  const email = String(usuario?.email || '').trim().toLowerCase();
  return Boolean(email) && EDITORES.has(email);
}

/**
 * Middleware: só os editores passam (a tela também esconde o botão, mas a trava
 * é esta). O "SupAdmin" no nome é de propósito: o mapa de permissões da API
 * (scripts/mapa-permissoes-api.js) lê as guardas pelo nome, e esta rota tem de
 * contar como nível Sup Admin — sem isso as tabelas que ela lê (boletos,
 * notas…) virariam "de todos" no modo bloquear. A trava de verdade é mais
 * estreita que o Sup Admin: os dois e-mails do dono.
 */
function exigirDonoSupAdmin(req, res, next) {
  carregarUsuarioAtual(req)
    .then(usuario => {
      if (ehEditor(usuario)) {
        req.editorDoPedido = usuario;
        return next();
      }
      return res.status(403).json({ error: 'Editar as peças de um pedido é uma ação restrita ao dono do sistema.', code: 'SO_O_DONO' });
    })
    .catch(() => res.status(403).json({ error: 'Não foi possível conferir quem está pedindo.', code: 'SO_O_DONO' }));
}

// ===================================================================== travas

/**
 * O que impede a edição do pedido inteiro (lista vazia = pode). Pura.
 * `travas` é o Map de pedidoParcelas.travasDasParcelas.
 */
function motivosDoBloqueio({ pedido, notas = [], externas = [], travas = new Map() }) {
  const motivos = [];
  if (String(pedido?.situacao || '').trim() !== SITUACAO) {
    motivos.push(`O pedido está ${pedido?.situacao || 'sem situação'}: só dá para editar as peças de um pedido em Produção.`);
  }
  const viva = (notas || []).find(n => n && NFE_VIVA.has(String(n.status_fiscal)));
  if (viva) motivos.push(`O pedido tem a NF-e ${viva.serie ?? ''}/${viva.numero ?? ''} (${viva.status_fiscal}): cancele a nota antes de mexer nas peças.`.replace(' / ', ' '));
  if ((externas || []).some(n => n && ativo(n.ativo))) motivos.push('O pedido tem NF-e de fora registrada: tire a nota de fora antes de mexer nas peças.');
  for (const [numeroParcela, trava] of (travas instanceof Map ? travas : new Map())) {
    motivos.push(`A ${numeroParcela}ª parcela está travada (${trava?.texto || trava?.origem || 'com cobrança'}): cancele a cobrança antes de mexer nas peças.`);
  }
  return motivos;
}

// ================================================================== unidades

/**
 * De onde cada unidade da linha veio, uma a uma: as que saíram do estoque
 * (com o ponto da rota em que estavam e a linha de `pedido_itens_ext`) e as do
 * zero. Mesma conta de cancelamentoEstorno.montarGrupos e de
 * producaoUnidades.unidadesDoItem: as do estoque são as de pedido_itens_ext,
 * o resto da quantidade é do zero. As mais adiantadas primeiro. Pura.
 */
function unidadesDeOrigem({ item, ext = [], rota = [] }) {
  const quantidade = Math.max(0, Math.trunc(numero(item?.quantidade)));
  const ordemFinal = rota.length ? numero(rota[rota.length - 1].ordem) : 0;
  const doEstoque = [];
  for (const reg of ext || []) {
    const passo = rota.find(p => Number(p.passo_id) === Number(reg.ultimo_insumo_id)) || null;
    const ordem = passo ? numero(passo.ordem) : ordemFinal;
    const q = Math.max(0, Math.trunc(numero(reg.quantidade)));
    for (let k = 0; k < q; k += 1) {
      doEstoque.push({ origem: 'estoque', ordem_origem: ordem, lote_id: reg.etapa_id ?? null, ext_id: reg.id ?? null, pronta: ordemFinal > 0 && ordem >= ordemFinal });
    }
  }
  doEstoque.sort((a, b) => b.ordem_origem - a.ordem_origem);
  const saida = doEstoque.slice(0, quantidade);
  while (saida.length < quantidade) saida.push({ origem: 'producao', ordem_origem: 0, lote_id: null, ext_id: null, pronta: false });
  return saida;
}

/** Os grupos de estados.dasUnidades, unidade a unidade, na ordem em que vêm (mais adiantadas antes). Pura. */
function expandirEstados(estados = []) {
  const saida = [];
  for (const g of estados || []) {
    for (let k = 0; k < Math.max(0, Math.trunc(numero(g.quantidade))); k += 1) {
      saida.push({ ordem: numero(g.ordem), restante: g.restante || {}, rotulo: g.rotulo || '', pronta: Boolean(g.pronta) });
    }
  }
  return saida;
}

/**
 * As unidades da linha com origem e estado: as duas listas estão na mesma
 * ordem (a fila da produção dá o trabalho às do estoque primeiro, as mais
 * adiantadas antes; as do zero são as últimas), então a j-ésima de uma é a
 * j-ésima da outra. O ponto atual nunca é antes do de origem. Pura.
 */
function unidadesDoItem({ item, ext = [], rota = [], estados = [] }) {
  const ordemFinal = rota.length ? numero(rota[rota.length - 1].ordem) : 0;
  const origem = unidadesDeOrigem({ item, ext, rota });
  const estado = expandirEstados(estados);
  return origem.map((u, j) => {
    const e = estado[j] || { ordem: u.ordem_origem, restante: {}, rotulo: u.pronta ? 'Pronta' : 'Por começar', pronta: u.pronta };
    const atual = Math.min(Math.max(numero(e.ordem), u.ordem_origem), ordemFinal);
    return { ...u, item_id: item.id, estado: e, ordem_atual: atual };
  });
}

/** Ordem de ficar: pronta do estoque, depois pela metade, depois do zero; as mais adiantadas antes. */
const rankDaOrigem = u => (u.origem === 'estoque' ? (u.pronta ? 2 : 1) : 0);
const ordenarParaFicar = unidades => [...unidades].sort((a, b) => rankDaOrigem(b) - rankDaOrigem(a) || b.ordem_atual - a.ordem_atual);

/** "Pronta do estoque", "Pela metade do estoque (5/15)", "Do zero". Pura. */
function rotuloDaOrigem(u, rota = []) {
  if (u.origem !== 'estoque') return 'do zero';
  if (u.pronta) return 'pronta do estoque';
  return `pela metade do estoque (${estorno.rotuloDoEstagio(rota, u.ordem_origem)})`;
}

// ===================================================================== plano

/** Inteiro ≥ 0, ou null. */
function inteiro(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Divide `total` (R$) em `n` partes iguais em centavos, como src/js/utils/parcelamento.js (splitEqual). Pura. */
function partesIguais(total, n) {
  const cents = Math.round(numero(total) * 100);
  const partes = Math.max(1, Math.trunc(n));
  const base = Math.floor(cents / partes);
  const resto = cents - base * partes;
  return Array.from({ length: partes }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
}

/** Preço praticado da peça (tabela fixa, acoplado em `preco_tabela`), ou null. "1.234,56" vale. */
function precoDaTabela(produto) {
  const bruto = produto?.preco_tabela;
  if (bruto === null || bruto === undefined || String(bruto).trim() === '') return null;
  const n = paraDecimal(bruto);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Os valores de uma linha alterada ou nova (preço da tabela, desconto de
 * pagamento pela regra, especial mantido). Pura.
 */
function valoresDaLinha({ item = null, produto = null, quantidade, condicao }) {
  const daTabela = precoDaTabela(produto);
  const unitario = daTabela ?? numero(item?.valor_unitario);
  const totalPrc = numero(item?.desconto_pagamento_prc) + numero(item?.desconto_especial_prc);
  const especial = item ? Math.max(totalPrc - descontos.descontoPadrao(numero(item.quantidade), condicao), 0) : 0;
  const { pagamento, especial: esp } = descontos.repartirDesconto(especial + descontos.descontoPadrao(quantidade, condicao), quantidade, condicao);
  return {
    ...descontos.calcularItem({ valorUnitario: unitario, quantidade, pctPagamento: pagamento, pctEspecial: esp }),
    preco_mudou: Boolean(item && daTabela !== null && Math.abs(daTabela - numero(item.valor_unitario)) > 0.004),
    sem_preco: daTabela === null
  };
}

/** Os campos de valor zerados de uma linha que saiu do pedido. */
const VALORES_ZERADOS = {
  desconto_total: 0, valor_total: 0, valor_desc: 0, desconto_pagamento: 0, desconto_especial: 0
};

/**
 * O plano da edição — puro.
 *
 * @param {object} p
 * @param {Array}  p.itens      [{ item, unidades, rota, travado }] — as linhas atuais
 * @param {object} p.entrada    { linhas: [{ item_id?, produto_id?, quantidade, juntar_em? }], decisoes?: [{ produto_id, qtd_usar_pronta, qtd_a_produzir, parciais, forcarProduzirDoZero }] }
 * @param {Map}    p.produtosPor id → produto (preço da tabela, código, nome, NCM)
 * @param {string} p.condicao   'vista' | 'prazo'
 * @param {object} p.pedido     o pedido (ajuste_valor, parcelas)
 * @param {Array}  p.parcelas   as parcelas atuais
 * @param {boolean} p.exigirDecisoes  na confirmação, toda unidade nova precisa da decisão
 */
function planejar({ itens = [], entrada = {}, produtosPor = new Map(), condicao = 'vista', pedido = {}, parcelas = [], exigirDecisoes = false }) {
  const porId = new Map(itens.map(x => [String(x.item.id), x]));
  const vivos = itens.filter(x => numero(x.item.quantidade) > 0);
  const pedidas = Array.isArray(entrada?.linhas) ? entrada.linhas : [];
  const decisoesPor = new Map((Array.isArray(entrada?.decisoes) ? entrada.decisoes : [])
    .filter(d => d && Number.isFinite(Number(d.produto_id)))
    .map(d => [String(Number(d.produto_id)), d]));

  // ------------------------------------------------------------ o que foi pedido
  const alvo = new Map(); // item_id → { quantidade, juntar_em }
  const novas = []; // { produto_id, quantidade }
  for (const l of pedidas) {
    if (!l || typeof l !== 'object') continue;
    const q = inteiro(l.quantidade);
    if (l.item_id !== undefined && l.item_id !== null && l.item_id !== '') {
      const atual = porId.get(String(l.item_id));
      if (!atual) throw erro('Uma das linhas não é deste pedido. Feche e abra a edição de novo.', 409);
      if (alvo.has(String(l.item_id))) throw erro(`A linha de ${nomeDaPeca(atual.item)} veio duas vezes.`, 422);
      const juntar = l.juntar_em === undefined || l.juntar_em === null || l.juntar_em === '' ? null : String(l.juntar_em);
      if (juntar === null && q === null) throw erro(`Quantidade inválida em ${nomeDaPeca(atual.item)}: use um número inteiro.`, 422);
      alvo.set(String(l.item_id), { quantidade: juntar === null ? q : 0, juntar_em: juntar });
    } else {
      const pid = Number(l.produto_id);
      if (!Number.isFinite(pid) || !produtosPor.has(String(pid))) throw erro('Escolha a peça nova na lista do catálogo.', 422);
      if (!(q > 0)) throw erro(`Quantidade inválida na peça nova ${nomeDaPeca(produtosPor.get(String(pid)))}.`, 422);
      novas.push({ produto_id: pid, quantidade: q });
    }
  }
  // Linha que não veio fica como está.
  for (const x of vivos) {
    if (!alvo.has(String(x.item.id))) alvo.set(String(x.item.id), { quantidade: Math.trunc(numero(x.item.quantidade)), juntar_em: null });
  }

  // Juntar: só na mesma peça, numa linha que fica.
  for (const [id, a] of alvo) {
    if (a.juntar_em === null) continue;
    const de = porId.get(id);
    const para = porId.get(a.juntar_em);
    if (!para || a.juntar_em === id) throw erro(`A linha de ${nomeDaPeca(de.item)} foi juntada a uma linha que não existe.`, 422);
    if (String(de.item.produto_id) !== String(para.item.produto_id)) throw erro('Só dá para juntar linhas da mesma peça.', 422);
    if (alvo.get(a.juntar_em)?.juntar_em !== null) throw erro(`A linha de ${nomeDaPeca(para.item)} também foi juntada: junte tudo numa linha só.`, 422);
  }

  // Peça nova que o pedido já tem vira mais unidades na linha dela (uma linha por peça).
  const novasLinhas = [];
  for (const n of novas) {
    const existente = [...alvo.entries()].find(([id, a]) => a.juntar_em === null && String(porId.get(id).item.produto_id) === String(n.produto_id) && numero(porId.get(id).item.quantidade) > 0);
    if (existente) existente[1].quantidade += n.quantidade;
    else {
      const ja = novasLinhas.find(x => String(x.produto_id) === String(n.produto_id));
      if (ja) ja.quantidade += n.quantidade;
      else novasLinhas.push({ ...n });
    }
  }

  // ------------------------------------------------------------ por linha
  const linhas = [];
  const recebidasPor = new Map();
  for (const [id, a] of alvo) {
    if (a.juntar_em === null) continue;
    const de = porId.get(id);
    if (!recebidasPor.has(a.juntar_em)) recebidasPor.set(a.juntar_em, []);
    recebidasPor.get(a.juntar_em).push(...de.unidades.map(u => ({ ...u, veio_de: de.item.id })));
  }

  const produtosComNovas = new Map();
  for (const [id, a] of alvo) {
    const x = porId.get(id);
    const proprias = x.unidades.map(u => ({ ...u, veio_de: null }));
    if (a.juntar_em !== null) {
      linhas.push({ tipo: 'juntada', item: x.item, rota: x.rota, juntar_em: Number(a.juntar_em), quantidade_antes: proprias.length, quantidade_depois: 0, removidas: [], ficam: [], novas: 0, alterada: true });
      continue;
    }
    const recebidas = recebidasPor.get(id) || [];
    const pool = ordenarParaFicar([...proprias, ...recebidas]);
    const ficam = pool.slice(0, a.quantidade);
    const removidas = pool.slice(a.quantidade);
    const novasAqui = Math.max(0, a.quantidade - pool.length);
    const alterada = a.quantidade !== proprias.length || recebidas.length > 0;
    if (alterada && x.travado) throw erro(`${nomeDaPeca(x.item)}: ${x.travado}`, 409);
    if (novasAqui) produtosComNovas.set(String(x.item.produto_id), (produtosComNovas.get(String(x.item.produto_id)) || 0) + 1);
    linhas.push({ tipo: 'existente', item: x.item, rota: x.rota, quantidade_antes: proprias.length, quantidade_depois: a.quantidade, removidas, ficam, novas: novasAqui, alterada });
  }
  for (const id of alvo.keys()) {
    const a = alvo.get(id);
    if (a.juntar_em !== null && porId.get(id).travado) throw erro(`${nomeDaPeca(porId.get(id).item)}: ${porId.get(id).travado}`, 409);
  }
  for (const n of novasLinhas) {
    produtosComNovas.set(String(n.produto_id), (produtosComNovas.get(String(n.produto_id)) || 0) + 1);
    linhas.push({ tipo: 'nova', item: null, produto_id: n.produto_id, rota: null, quantidade_antes: 0, quantidade_depois: n.quantidade, removidas: [], ficam: [], novas: n.quantidade, alterada: true });
  }
  for (const [pid, vezes] of produtosComNovas) {
    if (vezes > 1) throw erro(`${nomeDaPeca(produtosPor.get(pid))} está em mais de uma linha e ganhou peças novas: junte as linhas dessa peça primeiro.`, 422);
  }
  if (!linhas.some(l => l.alterada)) throw erro('Nada foi mudado nas peças.', 422);
  if (!linhas.some(l => l.quantidade_depois > 0)) throw erro('O pedido não pode ficar sem nenhuma peça. Para desistir dele, use Cancelar.', 422);

  // ------------------------------------------------------------ decisões das novas
  for (const l of linhas) {
    if (!(l.novas > 0)) continue;
    const pid = String(l.item ? l.item.produto_id : l.produto_id);
    const d = decisoesPor.get(pid);
    if (!d) {
      if (exigirDecisoes) throw erro(`Escolha de onde saem as ${plural(l.novas, 'peça nova', 'peças novas')} de ${nomeDaPeca(l.item || produtosPor.get(pid))}.`, 422, { falta_decisao: true });
      l.decisao = null;
      continue;
    }
    const pronta = Math.max(0, Math.min(Math.trunc(numero(d.qtd_usar_pronta)), l.novas));
    l.decisao = {
      produto_id: Number(pid),
      qtd_usar_pronta: pronta,
      qtd_a_produzir: l.novas - pronta,
      qtd_produzir_parcial: Math.max(0, Math.min(Math.trunc(numero(d.qtd_produzir_parcial)), l.novas - pronta)),
      parciais: Array.isArray(d.parciais) ? d.parciais : [],
      forcarProduzirDoZero: d.forcarProduzirDoZero === true
    };
  }

  // ------------------------------------------------------------ valores
  const avisos = [];
  for (const l of linhas) {
    const produto = produtosPor.get(String(l.item ? l.item.produto_id : l.produto_id)) || null;
    l.produto = produto;
    if (l.tipo === 'juntada' || l.quantidade_depois === 0) {
      l.valores = { ...VALORES_ZERADOS, valor_unitario: numero(l.item?.valor_unitario), valor_unitario_desc: numero(l.item?.valor_unitario_desc), desconto_pagamento_prc: numero(l.item?.desconto_pagamento_prc), desconto_especial_prc: numero(l.item?.desconto_especial_prc) };
      continue;
    }
    if (!l.alterada) {
      l.valores = null; // fica como está
      continue;
    }
    const v = valoresDaLinha({ item: l.item, produto, quantidade: l.quantidade_depois, condicao });
    if (l.tipo === 'nova' && v.sem_preco) throw erro(`${nomeDaPeca(produto)} não tem preço na tabela fixa: cadastre o preço antes de pôr a peça no pedido.`, 422);
    if (v.preco_mudou) avisos.push(`${nomeDaPeca(l.item)}: o preço da tabela mudou de ${reais(l.item.valor_unitario)} para ${reais(v.valor_unitario)} e a linha passa a usar o da tabela.`);
    if (l.tipo === 'existente' && v.sem_preco) avisos.push(`${nomeDaPeca(l.item)} não tem preço na tabela fixa: a linha mantém ${reais(l.item.valor_unitario)}.`);
    const { preco_mudou: _p, sem_preco: _s, ...valores } = v;
    l.valores = valores;
  }
  const paraTotal = linhas.filter(l => l.quantidade_depois > 0).map(l => (l.valores
    ? { quantidade: l.quantidade_depois, ...l.valores }
    : { quantidade: numero(l.item.quantidade), valor_unitario: l.item.valor_unitario, desconto_pagamento: l.item.desconto_pagamento, desconto_especial: l.item.desconto_especial }));
  const totais = descontos.totaisDoDocumento(paraTotal);
  const ajuste = centavos(pedido?.ajuste_valor);
  const valorFinal = centavos(totais.valor_final + ajuste);
  const ordenadas = [...(parcelas || [])].sort((a, b) => numero(a.numero_parcela) - numero(b.numero_parcela));
  const partes = ordenadas.length ? partesIguais(valorFinal, ordenadas.length) : [];
  const novasParcelas = ordenadas.map((p, i) => ({ id: p.id, numero_parcela: numero(p.numero_parcela) || i + 1, data_vencimento: p.data_vencimento, antes: centavos(p.valor), valor: partes[i] }));

  return {
    linhas,
    totais: {
      subtotal: centavos(totais.subtotal), desconto_pagamento: centavos(totais.desconto_pagamento), desconto_especial: centavos(totais.desconto_especial),
      desconto_total: centavos(totais.desconto_total), valor_itens: centavos(totais.valor_final), ajuste, valor_final: valorFinal
    },
    parcelas: novasParcelas,
    avisos
  };
}

// ============================================================ estoque e MP

/**
 * O que volta de cada unidade que sai: a peça no ponto em que está (se já é
 * peça) e o material da rota DEPOIS dele (e depois de onde ela entrou). As
 * iguais são somadas. Insumo infinito não volta: a conversão não o abate.
 * Pura.
 */
function oQueVolta({ removidas = [], rota = [], insumos = new Map() }) {
  const pecas = new Map();
  const material = new Map();
  for (const u of removidas) {
    const chave = `${u.ordem_atual}:${u.ordem_origem}:${u.lote_id ?? ''}:${u.origem}`;
    const atual = pecas.get(chave) || { ordem_destino: u.ordem_atual, ordem_origem: u.ordem_origem, lote_id: u.lote_id ?? null, origem: u.origem, quantidade: 0 };
    atual.quantidade += 1;
    pecas.set(chave, atual);
    for (const passo of rota) {
      if (!(passo.ordem > u.ordem_atual) || !(passo.ordem > u.ordem_origem)) continue;
      if (insumos.get(Number(passo.insumo_id))?.infinito) continue;
      const q = arredondar(numero(passo.por_unidade));
      if (!(q > 0)) continue;
      material.set(Number(passo.insumo_id), arredondar((material.get(Number(passo.insumo_id)) || 0) + q));
    }
  }
  return { pecas: [...pecas.values()], material };
}

/** A matéria-prima que as unidades novas vão consumir (o mesmo plano da conversão), para a prévia. */
function consumoDasNovas({ linhas, rotaPorProduto, estoquePorInsumo }) {
  const itens = linhas.filter(l => l.novas > 0 && l.decisao).map(l => ({
    pedido_item_id: l.item?.id ?? `novo:${l.produto_id}`,
    produto_id: Number(l.item ? l.item.produto_id : l.produto_id),
    quantidade: l.novas,
    qtd_usar_pronta: l.decisao.qtd_usar_pronta,
    qtd_a_produzir: l.decisao.qtd_a_produzir,
    parciais: (l.decisao.parciais || []).map(p => ({ ...p, quantidade: numero(p.quantidade), ordem: numero(p.ordem) }))
  }));
  if (!itens.length) return new Map();
  const plano = planejarConsumo({ itens, rotaPorProduto, estoquePorInsumo });
  return new Map(plano.consumoPorInsumo.map(c => [Number(c.insumo_id), arredondar(c.quantidade)]));
}

/**
 * O que a PRODUÇÃO precisa guardar de cada linha mudada (pedido_edicoes.unidades),
 * no formato das trocas: a fila de cada processo antes, e o que faltava em cada
 * unidade que saiu ou entrou. As unidades novas entram com o que a origem
 * delas deixa por fazer. Pura.
 */
function unidadesParaProducao({ linhas, filaAntes, etapas = [] }) {
  const saida = [];
  const doEstado = (u, etapaId) => {
    const r = u.estado?.restante?.[String(etapaId)];
    return r === null || r === undefined || !Number.isFinite(Number(r)) ? null : Number(r);
  };
  const juntar = (alvo, etapaId, valor) => {
    if (valor === null) return;
    const k = String(etapaId);
    if (!alvo[k]) alvo[k] = [];
    alvo[k].push(arredondar(valor));
  };
  for (const l of linhas) {
    if (!l.item || !l.alterada) continue;
    const sai = {};
    const entra = {};
    const saem = l.tipo === 'juntada' ? [] : l.removidas.filter(u => u.veio_de === null);
    // A linha juntada: TODAS as unidades dela saem (as que ficam vão para a outra linha).
    const daJuntada = l.tipo === 'juntada' ? (linhas.find(x => x.item && String(x.item.id) === String(l.juntar_em))?.ficam || []).filter(u => String(u.veio_de) === String(l.item.id)) : [];
    const removidasDaJuntada = l.tipo === 'juntada' ? (linhas.find(x => x.item && String(x.item.id) === String(l.juntar_em))?.removidas || []).filter(u => String(u.veio_de) === String(l.item.id)) : [];
    const recebidas = l.tipo === 'existente' ? l.ficam.filter(u => u.veio_de !== null) : [];
    for (const e of etapas) {
      for (const u of [...saem, ...daJuntada, ...removidasDaJuntada]) juntar(sai, e.id, doEstado(u, e.id));
      for (const u of recebidas) juntar(entra, e.id, doEstado(u, e.id));
      if (l.novas > 0) {
        const rota = l.rota || [];
        const ordemFinal = rota.length ? numero(rota[rota.length - 1].ordem) : 0;
        const origens = [];
        const pronta = l.decisao ? l.decisao.qtd_usar_pronta : 0;
        for (let k = 0; k < pronta; k += 1) origens.push(ordemFinal);
        for (const p of (l.decisao?.parciais || [])) {
          for (let k = 0; k < Math.trunc(numero(p.quantidade)) && origens.length < l.novas; k += 1) origens.push(numero(p.ordem));
        }
        while (origens.length < l.novas) origens.push(0);
        for (const o of origens) {
          const f = unidadesProducao.fracao(rota, e.nome, o);
          if (f !== null && f > 0) juntar(entra, e.id, f);
        }
      }
    }
    saida.push({
      pedido_item_id: l.item.id,
      produto_id: l.item.produto_id ?? null,
      quantidade_antes: l.quantidade_antes,
      quantidade_depois: l.quantidade_depois,
      fila_antes: filaAntes.get(String(l.item.id)) || {},
      sai, entra
    });
  }
  return saida;
}

/** A assinatura do plano: muda se o pedido mudar entre a revisão e a confirmação. Pura. */
function assinar({ pedido, linhas, totais, parcelas }) {
  const essencial = {
    pedido: [pedido?.id, pedido?.situacao, centavos(pedido?.valor_final)],
    linhas: linhas.map(l => [
      l.tipo, l.item?.id ?? null, l.produto_id ?? l.item?.produto_id ?? null, l.quantidade_antes, l.quantidade_depois, l.juntar_em ?? null,
      l.removidas.map(u => [u.origem, u.ordem_origem, u.ordem_atual, u.ext_id, u.veio_de]),
      l.ficam.map(u => [u.origem, u.ordem_origem, u.ext_id, u.veio_de]), l.novas, l.decisao ? [l.decisao.qtd_usar_pronta, l.decisao.qtd_a_produzir] : null
    ]),
    totais: [totais.valor_final, totais.valor_itens],
    parcelas: parcelas.map(p => [p.id, p.valor])
  };
  return crypto.createHash('sha1').update(JSON.stringify(essencial)).digest('hex');
}

// ==================================================================== leitura

/** Tudo o que a edição precisa do pedido, numa passada. */
async function lerPedido(api, pedidoId) {
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) throw erro('Pedido inválido.', 400);
  const pedido = await api.get(`/api/pedidos/${id}`).catch(() => null);
  if (!pedido || pedido.error) throw erro('Pedido não encontrado.', 404);
  const ler = (tabela, query) => api.get(`/api/${tabela}`, { query }).then(lista).catch(() => []);
  const doPedido = (l, campo = 'pedido_id') => l.filter(x => Number(x?.[campo]) === id);
  const [itens, parcelas, ext, reservas, faltantes, notas, externas, boletos, recebimentos, boletosFora, ordens, insumos] = await Promise.all([
    ler('pedidos_itens', { pedido_id: id }),
    ler('pedido_parcelas', { pedido_id: id }),
    ler('pedido_itens_ext', { id_pedido: id }),
    ler('reservas_estoque', { pedido_id: id }),
    ler('pedidos_itens_faltantes', { pedido_id: id }),
    ler('notas_fiscais', { pedido_id: id }),
    ler('notas_fiscais_externas', { pedido_id: id }),
    ler('boletos', { pedido_id: id }),
    ler('recebimentos', { pedido_id: id }),
    ler('boletos_externos', { pedido_id: id }),
    ler('ordens_pagamento', { pedido_id: id, status: 'aberta' }),
    estorno.carregarInsumos(api)
  ]);
  const meus = {
    itens: doPedido(itens).sort((a, b) => Number(a.id) - Number(b.id)),
    parcelas: doPedido(parcelas),
    ext: doPedido(ext, 'id_pedido'),
    reservas: doPedido(reservas),
    faltantes: doPedido(faltantes),
    notas: doPedido(notas),
    externas: doPedido(externas)
  };
  const travas = pedidoParcelas.travasDasParcelas({
    parcelas: meus.parcelas, boletos: doPedido(boletos), recebimentos: doPedido(recebimentos),
    externos: doPedido(boletosFora), ordens: doPedido(ordens)
  });
  return { pedido: { ...pedido, id }, ...meus, travas, insumos };
}

/** As linhas com as unidades (origem + estado) e o que trava cada uma. */
async function composicao(api, lidos) {
  const { itens, ext, insumos } = lidos;
  const cacheRotas = new Map();
  await estorno.carregarRotas(api, itens.map(i => i.produto_id), cacheRotas, insumos);
  const vivos = itens.filter(i => numero(i.quantidade) > 0);
  const [estados, lidosMudancas] = await Promise.all([
    require('./trocasPecas').estadosDosItens(api, vivos),
    mudancas.lerDosItens(api, itens.map(i => i.id)).catch(() => ({ trocas: [], avulsas: [], edicoes: [] }))
  ]);
  const extPor = new Map();
  for (const r of ext) {
    const k = String(r.pedido_item_id);
    if (!extPor.has(k)) extPor.set(k, []);
    extPor.get(k).push(r);
  }
  const comTroca = new Set();
  for (const t of lidosMudancas.trocas || []) { comTroca.add(String(t.pedido_item_id_a)); comTroca.add(String(t.pedido_item_id_b)); }
  for (const a of lidosMudancas.avulsas || []) comTroca.add(String(a.pedido_item_id));
  const saida = [];
  for (const item of itens) {
    const rota = item.produto_id === null || item.produto_id === undefined ? [] : await estorno.carregarRota(api, item.produto_id, cacheRotas, insumos).catch(() => []);
    const unidades = unidadesDoItem({ item, ext: extPor.get(String(item.id)) || [], rota, estados: estados.get(String(item.id)) || [] });
    saida.push({
      item, rota, unidades, ext: extPor.get(String(item.id)) || [],
      // A troca de peças e a peça avulsa mudam as unidades por outro caminho:
      // juntar as duas coisas na mesma linha não tem volta segura. Fica para depois.
      travado: comTroca.has(String(item.id)) ? 'esta peça passou por troca entre pedidos ou virou peça avulsa; a edição dela não é permitida.' : null
    });
  }
  return { linhas: saida, cacheRotas, edicoesSqlPendente: null };
}

/**
 * O catálogo (código, nome, NCM) por id, com o preço PRATICADO da tabela fixa
 * acoplado em `preco_tabela` (tabela_fixa.vlr_prod — o mesmo que tabelaFixa.js
 * faz, aqui pela API da requisição). Peça sem linha na tabela fica com null.
 */
async function produtosPorId(api) {
  const [produtos, tabela] = await Promise.all([
    api.get('/api/produtos', { query: { select: 'id,codigo,nome,ncm' } }).then(lista).catch(() => []),
    api.get('/api/tabela_fixa').then(lista).catch(() => [])
  ]);
  const precos = new Map(tabela.filter(l => l && l.id_prod !== null && l.id_prod !== undefined).map(l => [String(Number(l.id_prod)), l.vlr_prod]));
  return new Map(produtos.filter(p => p && p.id !== undefined).map(p => [String(p.id), { ...p, preco_tabela: precos.has(String(Number(p.id))) ? precos.get(String(Number(p.id))) : null }]));
}

/** A fila de cada processo de cada linha, como está agora (antes da edição). */
async function filasAntes(api, itens) {
  const tudo = await regras.lerTudo(api);
  const etapasPor = new Map(tudo.etapas.map(e => [String(e.id), e]));
  const vivos = itens.filter(i => numero(i.quantidade) > 0);
  const { filaDe } = await producao.montarFilas(api, { itens: vivos, etapasPor });
  const porItem = new Map();
  for (const item of vivos) {
    const filas = {};
    for (const e of tudo.etapas) {
      const f = filaDe(item.id, e.id);
      if (Array.isArray(f) && f.length) filas[String(e.id)] = f.map(arredondar);
    }
    porItem.set(String(item.id), filas);
  }
  return { porItem, etapas: tudo.etapas };
}

/** A tabela da edição existe? (sem o SQL, null) */
async function sqlPendente(api) {
  const linhas = await mudancas.lerTabela(api, TABELA, { pedido_id: -1 }).catch(() => null);
  return linhas === null;
}

/** "Trocada por", "Do zero (por começar)" — a lista de unidades de uma linha, para a tela. Pura. */
function resumoDasUnidades(unidades = [], rota = []) {
  const grupos = new Map();
  for (const u of unidades) {
    const k = `${rotuloDaOrigem(u, rota)}|${u.estado?.rotulo || ''}`;
    const g = grupos.get(k) || { origem: rotuloDaOrigem(u, rota), estado: u.estado?.rotulo || '', quantidade: 0 };
    g.quantidade += 1;
    grupos.set(k, g);
  }
  return [...grupos.values()];
}

// ==================================================================== rotas puras

/** O que a tela abre: as linhas, de onde veio cada unidade e o que trava. */
async function situacao(api, pedidoId) {
  const lidos = await lerPedido(api, pedidoId);
  const comp = await composicao(api, lidos);
  const bloqueios = motivosDoBloqueio({ pedido: lidos.pedido, notas: lidos.notas, externas: lidos.externas, travas: lidos.travas });
  return {
    sql_pendente: await sqlPendente(api),
    sql_arquivo: SQL_ARQUIVO,
    pedido: {
      id: lidos.pedido.id, numero: lidos.pedido.numero || `#${lidos.pedido.id}`, situacao: lidos.pedido.situacao || null,
      valor_final: centavos(lidos.pedido.valor_final), ajuste: centavos(lidos.pedido.ajuste_valor),
      condicao: numero(lidos.pedido.parcelas) > 1 ? 'prazo' : 'vista', parcelas: lidos.parcelas.length
    },
    pode_editar: bloqueios.length === 0,
    bloqueios,
    linhas: comp.linhas.filter(l => numero(l.item.quantidade) > 0).map(l => ({
      item_id: l.item.id, produto_id: l.item.produto_id ?? null, codigo: l.item.codigo || null, nome: l.item.nome || null,
      quantidade: Math.trunc(numero(l.item.quantidade)), valor_unitario: centavos(l.item.valor_unitario), valor_total: centavos(l.item.valor_total),
      desconto_prc: numero(l.item.desconto_pagamento_prc) + numero(l.item.desconto_especial_prc),
      unidades: resumoDasUnidades(l.unidades, l.rota), travado: l.travado
    })),
    minimo_motivo: MINIMO_MOTIVO
  };
}

/**
 * Monta o plano completo (sem gravar nada): as linhas, o que volta ao estoque e
 * à matéria-prima, o que as novas consomem, os valores, as parcelas e a
 * assinatura.
 */
async function montar(api, pedidoId, entrada, { exigirDecisoes = false } = {}) {
  const lidos = await lerPedido(api, pedidoId);
  const bloqueios = motivosDoBloqueio({ pedido: lidos.pedido, notas: lidos.notas, externas: lidos.externas, travas: lidos.travas });
  if (bloqueios.length) throw erro(bloqueios[0], 409, { bloqueios });
  const [comp, produtosPor] = await Promise.all([composicao(api, lidos), produtosPorId(api)]);
  const condicao = numero(lidos.pedido.parcelas) > 1 ? 'prazo' : 'vista';
  const plano = planejar({ itens: comp.linhas, entrada, produtosPor, condicao, pedido: lidos.pedido, parcelas: lidos.parcelas, exigirDecisoes });

  // Parcela mínima: a divisão nova também tem de respeitar (Configuração de cobrança).
  const recusa = plano.parcelas.length > 1
    ? await parcelaMinima.recusaDaDivisao(api, { parcelas: plano.parcelas.map(p => ({ numero_parcela: p.numero_parcela, valor: p.valor })), prazo: lidos.pedido.prazo }).catch(() => null)
    : null;
  if (recusa) throw erro(`${recusa} Ajuste o pagamento do pedido antes de mexer nas peças, ou mude as peças.`, 422);

  // Rotas das peças novas (as das linhas que já existem vieram na composição).
  for (const l of plano.linhas) {
    if (!l.item && l.produto_id) l.rota = await estorno.carregarRota(api, l.produto_id, comp.cacheRotas, lidos.insumos).catch(() => []);
  }

  // O que volta ao estoque e à matéria-prima, linha a linha.
  const voltas = [];
  const materialVolta = new Map();
  for (const l of plano.linhas) {
    const removidas = l.removidas;
    if (!removidas.length) continue;
    // Cada unidade removida volta pela linha de onde ela veio (a juntada leva as dela).
    const porLinha = new Map();
    for (const u of removidas) {
      const k = String(u.veio_de ?? l.item.id);
      if (!porLinha.has(k)) porLinha.set(k, []);
      porLinha.get(k).push(u);
    }
    for (const [itemId, us] of porLinha) {
      const dona = comp.linhas.find(x => String(x.item.id) === itemId);
      const r = oQueVolta({ removidas: us, rota: dona.rota, insumos: lidos.insumos });
      voltas.push({ item: dona.item, rota: dona.rota, unidades: us, pecas: r.pecas, material: r.material });
      for (const [insumoId, q] of r.material) materialVolta.set(insumoId, arredondar((materialVolta.get(insumoId) || 0) + q));
    }
  }

  // O que as novas consomem (prévia, com o mesmo plano da conversão).
  const rotaPorProduto = new Map();
  for (const l of plano.linhas) {
    if (!(l.novas > 0)) continue;
    const pid = Number(l.item ? l.item.produto_id : l.produto_id);
    const bruta = await api.get('/api/produtos_insumos', { query: { produto_id: pid } }).then(lista).catch(() => []);
    rotaPorProduto.set(pid, bruta.map(i => ({ insumo_id: Number(i.insumo_id), quantidade: numero(i.quantidade), ordem_insumo: i.ordem_insumo, nome: lidos.insumos.get(Number(i.insumo_id))?.nome || '' })).sort((a, b) => numero(a.ordem_insumo) - numero(b.ordem_insumo)));
  }
  const estoquePorInsumo = new Map([...lidos.insumos].map(([id, m]) => [Number(id), { quantidade: numero(m.quantidade), infinito: Boolean(m.infinito) }]));
  const materialSai = consumoDasNovas({ linhas: plano.linhas, rotaPorProduto, estoquePorInsumo });

  const assinatura = assinar({ pedido: lidos.pedido, linhas: plano.linhas, totais: plano.totais, parcelas: plano.parcelas });
  return { lidos, comp, plano, voltas, materialVolta, materialSai, produtosPor, assinatura };
}

/** A prévia para a tela (sem as unidades internas). */
function previa({ lidos, plano, voltas, materialVolta, materialSai, assinatura }) {
  const insumo = id => lidos.insumos.get(Number(id)) || {};
  const nome = l => nomeDaPeca(l.item || l.produto);
  const pecas = [];
  for (const v of voltas) {
    for (const p of v.pecas) {
      pecas.push({
        peca: nomeDaPeca(v.item), quantidade: p.quantidade,
        origem: p.origem === 'estoque' ? (p.ordem_origem >= (v.rota.length ? v.rota[v.rota.length - 1].ordem : 0) ? 'pronta do estoque' : 'pela metade do estoque') : 'do zero',
        destino: p.ordem_destino > 0 ? `volta ao estoque em ${estorno.rotuloDoEstagio(v.rota, p.ordem_destino)}` : 'não vira peça: todo o material volta à matéria-prima'
      });
    }
  }
  const materiais = mapa => [...mapa].map(([id, q]) => ({ insumo_id: id, nome: insumo(id).nome || `Insumo ${id}`, unidade: insumo(id).unidade || '', quantidade: q, saldo: numero(insumo(id).quantidade) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return {
    pedido: { id: lidos.pedido.id, numero: lidos.pedido.numero || `#${lidos.pedido.id}` },
    linhas: plano.linhas.map(l => ({
      tipo: l.tipo, item_id: l.item?.id ?? null, produto_id: l.item ? l.item.produto_id : l.produto_id, peca: nome(l),
      quantidade_antes: l.quantidade_antes, quantidade_depois: l.quantidade_depois, juntar_em: l.juntar_em ?? null,
      saem: l.removidas.length, novas: l.novas, decisao: l.decisao || null, alterada: l.alterada,
      valor_unitario: l.valores ? centavos(l.valores.valor_unitario) : centavos(l.item?.valor_unitario),
      desconto_prc: l.valores ? numero(l.valores.desconto_pagamento_prc) + numero(l.valores.desconto_especial_prc) : numero(l.item?.desconto_pagamento_prc) + numero(l.item?.desconto_especial_prc),
      valor_total: l.valores ? centavos(l.valores.valor_total) : centavos(l.item?.valor_total)
    })),
    novas: plano.linhas.filter(l => l.novas > 0).map(l => ({ produto_id: Number(l.item ? l.item.produto_id : l.produto_id), peca: nome(l), quantidade: l.novas, decisao: l.decisao || null })),
    saem: pecas,
    materia_prima: { volta: materiais(materialVolta), sai: materiais(materialSai) },
    valores: {
      antes: { valor_final: centavos(lidos.pedido.valor_final), desconto_total: centavos(lidos.pedido.desconto_total) },
      depois: plano.totais
    },
    parcelas: plano.parcelas,
    avisos: plano.avisos,
    assinatura
  };
}

// ==================================================================== gravação

/** Os campos de uma linha nova de pedidos_itens. */
function linhaNova({ pedidoId, produto, quantidade, valores, decisao }) {
  return {
    pedido_id: pedidoId, produto_id: Number(produto.id), codigo: produto.codigo || null, nome: produto.nome || null, ncm: produto.ncm || null,
    quantidade, ...valores,
    qtd_usar_pronta: decisao ? decisao.qtd_usar_pronta : 0,
    qtd_a_produzir: decisao ? decisao.qtd_a_produzir : quantidade
  };
}

/** Quantas unidades de cada origem ficam (para qtd_usar_pronta / qtd_a_produzir). Pura. */
function contagemDeOrigem(ficam = [], decisao = null) {
  const prontas = ficam.filter(u => u.origem === 'estoque' && u.pronta).length + (decisao ? decisao.qtd_usar_pronta : 0);
  const total = ficam.length + (decisao ? decisao.qtd_usar_pronta + decisao.qtd_a_produzir : 0);
  return { qtd_usar_pronta: prontas, qtd_a_produzir: Math.max(0, total - prontas) };
}

/** O texto do evento do pedido, linha a linha. Pura. */
function descricaoDoEvento({ numeroPedido, plano, motivo, voltas }) {
  const partes = [`Peças do ${numeroPedido} editadas. Motivo: ${motivo}`];
  for (const l of plano.linhas) {
    if (!l.alterada) continue;
    const peca = nomeDaPeca(l.item || l.produto);
    if (l.tipo === 'juntada') partes.push(`- ${peca}: linha juntada à outra linha da mesma peça (${l.quantidade_antes} un.).`);
    else if (l.tipo === 'nova') partes.push(`- ${peca}: peça nova, ${l.quantidade_depois} un.`);
    else partes.push(`- ${peca}: ${l.quantidade_antes} → ${l.quantidade_depois} un.${l.novas ? ` (${l.novas} nova(s))` : ''}${l.removidas.length ? ` (${l.removidas.length} saíram)` : ''}.`);
  }
  for (const v of voltas) {
    for (const p of v.pecas) {
      partes.push(`  · ${p.quantidade} × ${nomeDaPeca(v.item)} ${p.ordem_destino > 0 ? `voltou ao estoque em ${estorno.rotuloDoEstagio(v.rota, p.ordem_destino)}` : 'não virou peça; o material voltou à matéria-prima'}.`);
    }
  }
  partes.push(`Total: ${reais(plano.totais.valor_final)}.`);
  return partes.join('\n');
}

/**
 * Grava a edição. Recalcula o plano agora e confere a `assinatura` da revisão:
 * se o pedido mudou no meio, nada é gravado.
 */
async function aplicar(api, { pedidoId, entrada = {}, usuarioId = null, registrarEntradaInsumo = materiaPrima.registrarEntrada } = {}) {
  const motivo = String(entrada?.motivo ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (motivo.replace(/[^\p{L}]/gu, '').length < MINIMO_MOTIVO) throw erro(`Diga o motivo da edição (ao menos ${MINIMO_MOTIVO} letras).`, 422);
  if (await sqlPendente(api)) throw erro(`Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`, 409, { sql_pendente: true, arquivo: SQL_ARQUIVO });

  const m = await montar(api, pedidoId, entrada, { exigirDecisoes: true });
  if (entrada.assinatura && entrada.assinatura !== m.assinatura) {
    throw erro('O pedido mudou enquanto a revisão estava aberta (produção, estoque ou valores). Revise de novo antes de salvar.', 409, { mudou: true });
  }
  const { lidos, plano, voltas } = m;
  const pedido = lidos.pedido;
  const numeroPedido = pedido.numero || `#${pedido.id}`;
  const avisos = [...plano.avisos];
  const { porItem: filaAntes, etapas } = await filasAntes(api, lidos.itens);

  // ------------------------------------------------------------ 1. o registro (primeiro: é a mudança da produção)
  const antes = {
    itens: lidos.itens.filter(i => numero(i.quantidade) > 0).map(i => ({ id: i.id, produto_id: i.produto_id, codigo: i.codigo, nome: i.nome, quantidade: numero(i.quantidade), valor_unitario: numero(i.valor_unitario), valor_total: numero(i.valor_total), qtd_usar_pronta: numero(i.qtd_usar_pronta), qtd_a_produzir: numero(i.qtd_a_produzir) })),
    valor_final: centavos(pedido.valor_final), desconto_total: centavos(pedido.desconto_total), ajuste: centavos(pedido.ajuste_valor),
    parcelas: lidos.parcelas.map(p => ({ id: p.id, numero_parcela: p.numero_parcela, valor: centavos(p.valor), data_vencimento: p.data_vencimento }))
  };
  const depois = {
    linhas: plano.linhas.map(l => ({ tipo: l.tipo, item_id: l.item?.id ?? null, produto_id: l.item ? l.item.produto_id : l.produto_id, quantidade: l.quantidade_depois, juntar_em: l.juntar_em ?? null, novas: l.novas, decisao: l.decisao || null, valores: l.valores })),
    totais: plano.totais, parcelas: plano.parcelas
  };
  const unidades = unidadesParaProducao({ linhas: plano.linhas, filaAntes, etapas });
  const resumo = {
    saem: voltas.map(v => ({ pedido_item_id: v.item.id, peca: nomeDaPeca(v.item), pecas: v.pecas, material: [...v.material] })),
    materia_prima_volta: [...m.materialVolta], materia_prima_sai_prevista: [...m.materialSai]
  };
  let edicao;
  try {
    edicao = await api.post(`/api/${TABELA}`, {
      pedido_id: pedido.id, numero: numeroPedido, motivo, antes: JSON.stringify(antes), depois: JSON.stringify(depois),
      unidades: JSON.stringify(unidades), resumo: JSON.stringify(resumo), valor_antes: centavos(pedido.valor_final), valor_depois: plano.totais.valor_final,
      criado_por: usuarioId, criado_em: new Date().toISOString()
    });
  } catch (e) {
    if (mudancas.tabelaAusente(e)) throw erro(`Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`, 409, { sql_pendente: true, arquivo: SQL_ARQUIVO });
    throw e;
  }
  const edicaoId = edicao?.id ?? edicao?.[0]?.id ?? null;

  // ------------------------------------------------------------ 2. as linhas
  let proximoItemId = null;
  const novasCriadas = [];
  for (const l of plano.linhas) {
    if (l.tipo === 'nova') {
      if (proximoItemId === null) proximoItemId = (await getMaxId(api, 'pedidos_itens')) + 1;
      const payload = linhaNova({ pedidoId: pedido.id, produto: l.produto, quantidade: l.quantidade_depois, valores: l.valores, decisao: l.decisao });
      const usado = await inserirLinhaComId(api, 'pedidos_itens', payload, proximoItemId);
      proximoItemId = usado + 1;
      l.novoItemId = usado;
      novasCriadas.push(l);
      continue;
    }
    if (!l.alterada) continue;
    const contagem = l.tipo === 'juntada' ? { qtd_usar_pronta: 0, qtd_a_produzir: 0 } : contagemDeOrigem(l.ficam, l.decisao);
    await api.put(`/api/pedidos_itens/${l.item.id}`, { quantidade: l.quantidade_depois, ...contagem, ...(l.valores || {}) });
  }

  // ------------------------------------------------------------ 3. o lastro: pedido_itens_ext, reservas, faltantes
  // Unidades do estoque que saíram: a linha de pedido_itens_ext diminui (zerada, sai).
  const saemDoExt = new Map();
  const saemDoZero = new Map();
  for (const l of plano.linhas) {
    for (const u of l.removidas) {
      const dona = String(u.veio_de ?? l.item.id);
      if (u.origem === 'estoque' && u.ext_id !== null) saemDoExt.set(String(u.ext_id), (saemDoExt.get(String(u.ext_id)) || 0) + 1);
      else if (u.origem !== 'estoque') saemDoZero.set(dona, (saemDoZero.get(dona) || 0) + 1);
    }
  }
  for (const reg of lidos.ext) {
    const sai = saemDoExt.get(String(reg.id)) || 0;
    const resta = Math.trunc(numero(reg.quantidade)) - sai;
    const juntada = plano.linhas.find(l => l.tipo === 'juntada' && String(l.item.id) === String(reg.pedido_item_id));
    try {
      if (sai && resta <= 0) await api.delete(`/api/pedido_itens_ext/${reg.id}`);
      else if (sai || juntada) {
        await api.put(`/api/pedido_itens_ext/${reg.id}`, { ...(sai ? { quantidade: resta } : {}), ...(juntada ? { pedido_item_id: juntada.juntar_em } : {}) });
      }
    } catch (e) {
      avisos.push(`Não foi possível atualizar o registro da peça do estoque ${reg.id}: ${e?.message || e}`);
    }
  }
  // Reservas de produção (as do zero): diminuem; a da linha juntada vai para a outra.
  for (const l of plano.linhas.filter(x => x.item)) {
    const doItem = lidos.reservas.filter(r => String(r.pedido_item_id) === String(l.item.id) && String(r.status) === RESERVA.PRODUCAO)
      .sort((a, b) => Number(b.id) - Number(a.id));
    let tirar = saemDoZero.get(String(l.item.id)) || 0;
    for (const r of doItem) {
      try {
        const q = numero(r.quantidade);
        const tira = Math.min(q, tirar);
        tirar -= tira;
        const resta = arredondar(q - tira);
        const campos = {};
        if (tira > 0) Object.assign(campos, resta > 0 ? { quantidade: resta } : { status: RESERVA.RETORNADA });
        if (l.tipo === 'juntada' && resta > 0) campos.pedido_item_id = l.juntar_em;
        if (Object.keys(campos).length) await api.put(`/api/reservas_estoque/${r.id}`, campos);
      } catch (e) {
        avisos.push(`Não foi possível atualizar a reserva de produção ${r.id}: ${e?.message || e}`);
      }
    }
  }
  // O que faltava (foto da conversão): na proporção do que ainda será produzido.
  for (const l of plano.linhas.filter(x => x.item && x.alterada)) {
    const antesProduzir = numero(l.item.qtd_a_produzir);
    const contagem = l.tipo === 'juntada' ? { qtd_a_produzir: 0 } : contagemDeOrigem(l.ficam, null);
    const fator = antesProduzir > 0 ? Math.min(1, contagem.qtd_a_produzir / antesProduzir) : 1;
    for (const f of lidos.faltantes.filter(x => String(x.pedido_item_id) === String(l.item.id))) {
      try {
        if (l.tipo === 'juntada') await api.put(`/api/pedidos_itens_faltantes/${f.id}`, { pedido_item_id: l.juntar_em });
        else if (fator <= 0) await api.delete(`/api/pedidos_itens_faltantes/${f.id}`);
        else if (fator < 1) await api.put(`/api/pedidos_itens_faltantes/${f.id}`, { quantidade: arredondar(numero(f.quantidade) * fator) });
      } catch (e) {
        avisos.push(`Não foi possível atualizar o que faltava de ${nomeDaPeca(l.item)}: ${e?.message || e}`);
      }
    }
  }

  // ------------------------------------------------------------ 4. o que volta ao estoque e à matéria-prima
  const cacheLotes = new Map();
  let pecasAoEstoque = 0;
  let pecasSemVolta = 0;
  for (const v of voltas) {
    const produtoId = Number(v.item.produto_id);
    for (const p of v.pecas) {
      if (p.ordem_destino > 0) {
        const passo = v.rota.find(x => x.ordem === p.ordem_destino) || v.rota[v.rota.length - 1] || null;
        const lote = await estorno.lotePara(api, { produtoId, passo, lotePreferido: p.ordem_destino === p.ordem_origem ? p.lote_id : null }, cacheLotes, avisos);
        if (!lote) {
          avisos.push(`${nomeDaPeca(v.item)}: não foi possível achar ou criar o lote no ponto ${p.ordem_destino} da rota — ${p.quantidade} peça(s) não voltaram ao estoque. Confira à mão.`);
          continue;
        }
        const nova = arredondar(numero(lote.quantidade) + p.quantidade);
        try {
          await api.put(`${estorno.TABELA_LOTES}/${lote.id}`, { quantidade: nova, data_hora_completa: new Date().toISOString() });
          lote.quantidade = nova;
        } catch (e) {
          avisos.push(`Falha ao devolver ao lote ${lote.id}: ${e?.message || e}`);
          continue;
        }
        await registrarMovimento(api, {
          tipoMovimento: MOV.RETORNO, tipoItem: ITEM.PECA, itemId: produtoId, quantidade: p.quantidade,
          pedidoId: pedido.id, pedidoItemId: v.item.id, loteId: lote.id, ultimoInsumoId: passo?.insumo_id ?? null,
          nota: `Edição do ${numeroPedido} (${edicaoId ? `edição ${edicaoId}` : 'edição'}): devolvida ao estoque em ${estorno.rotuloDoEstagio(v.rota, p.ordem_destino)}`,
          usuarioId
        }, avisos);
        pecasAoEstoque += p.quantidade;
      } else {
        pecasSemVolta += p.quantidade;
      }
    }
  }
  const contador = { insumosDevolvidos: 0 };
  await estorno.devolverInsumos(api, {
    porInsumo: m.materialVolta, pedidoId: pedido.id, nota: `Devolvido na edição das peças do ${numeroPedido}`,
    usuarioId, registrarEntradaInsumo, resumo: contador, tiposQueVoltaram: new Set()
  }, avisos);

  // ------------------------------------------------------------ 5. as unidades novas (o mesmo código da conversão)
  const pecasNovas = plano.linhas.filter(l => l.novas > 0).map(l => ({
    pedido_item_id: l.item ? l.item.id : l.novoItemId,
    produto_id: Number(l.item ? l.item.produto_id : l.produto_id),
    quantidade: l.novas,
    qtd_usar_pronta: l.decisao.qtd_usar_pronta,
    qtd_a_produzir: l.decisao.qtd_a_produzir,
    parciais: l.decisao.parciais,
    qtd_produzir_parcial: l.decisao.qtd_produzir_parcial,
    decisaoInformada: true,
    forcarProduzirDoZero: l.decisao.forcarProduzirDoZero
  })).filter(p => p.pedido_item_id !== null && p.pedido_item_id !== undefined);
  let estoqueNovas = null;
  if (pecasNovas.length) {
    try {
      estoqueNovas = await aplicarConversaoNoEstoque(api, {
        pedidoId: pedido.id, itens: pecasNovas, usuarioId,
        podeSaldoNegativo: entrada?.podeSaldoNegativo === true,
        decisaoNote: typeof entrada?.decisaoNote === 'string' && entrada.decisaoNote.trim() ? entrada.decisaoNote.trim() : `Edição das peças do ${numeroPedido}`,
        inserirLinhaComId, getMaxId,
        evento: false
      });
      avisos.push(...(estoqueNovas?.avisos || []));
    } catch (e) {
      avisos.push(`Falha ao aplicar o estoque das peças novas: ${e?.message || e}`);
    }
  }

  // ------------------------------------------------------------ 6. os valores do pedido e as parcelas
  await api.put(`/api/pedidos/${pedido.id}`, {
    desconto_pagamento: plano.totais.desconto_pagamento, desconto_especial: plano.totais.desconto_especial,
    desconto_total: plano.totais.desconto_total, valor_final: plano.totais.valor_final
  });
  for (const p of plano.parcelas) {
    if (Math.abs(p.valor - p.antes) < 0.005) continue;
    try {
      await api.put(`/api/pedido_parcelas/${p.id}`, { valor: p.valor });
    } catch (e) {
      avisos.push(`Falha ao atualizar a ${p.numero_parcela}ª parcela: ${e?.message || e}`);
    }
  }

  // ------------------------------------------------------------ 7. a história
  const descricao = descricaoDoEvento({ numeroPedido, plano, motivo, voltas });
  await registrarEventoDoPedido(api, { pedidoId: pedido.id, tipoEvento: EVENTO.EDICAO, descricao, usuarioId }, avisos);
  await auditoria.registrar(api, {
    tipo: 'edicao_pedido', pedidoId: pedido.id, referenciaId: edicaoId, usuarioId,
    valor: centavos(plano.totais.valor_final - centavos(pedido.valor_final)),
    descricao: `${numeroPedido}: peças editadas — total de ${reais(pedido.valor_final)} para ${reais(plano.totais.valor_final)}. ${motivo}`,
    dados: { edicao_id: edicaoId, antes: antes.valor_final, depois: plano.totais.valor_final }
  });
  try { require('./produtos').invalidarCacheLotes(); } catch (_) { /* cache é otimização */ }

  const resultado = {
    avisos, pecas_ao_estoque: pecasAoEstoque, pecas_sem_volta: pecasSemVolta, insumos_devolvidos: contador.insumosDevolvidos,
    novas: { unidades_do_estoque: estoqueNovas?.unidadesDoEstoque ?? 0, unidades_para_produzir: estoqueNovas?.unidadesParaProduzir ?? 0, insumos_abatidos: estoqueNovas?.insumosAbatidos ?? 0 },
    linhas_criadas: novasCriadas.map(l => l.novoItemId)
  };
  if (edicaoId) {
    await api.put(`/api/${TABELA}/${edicaoId}`, { resultado: JSON.stringify(resultado), concluida_em: new Date().toISOString() })
      .catch(e => avisos.push(`O fim da edição não foi anotado no registro ${edicaoId}: ${e?.message || e}`));
  }
  return { ok: true, edicao_id: edicaoId, pedido: { id: pedido.id, numero: numeroPedido }, totais: plano.totais, parcelas: plano.parcelas, ...resultado };
}

// ==================================================================== rotas

const router = express.Router();
const responder = (rotulo, fn) => async (req, res) => {
  try {
    res.json(await fn(createApiClient(req), req));
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error(`[pedido-edicao] ${rotulo}:`, err);
    res.status(status).json({ error: err?.message || 'Não foi possível editar as peças do pedido.', ...(err?.extra || {}) });
  }
};

/** Só para a tela saber se mostra o botão (a trava de verdade é a de cada rota). */
router.get('/permissao', (req, res) => {
  carregarUsuarioAtual(req).then(u => res.json({ pode: ehEditor(u) })).catch(() => res.json({ pode: false }));
});
router.get('/:id', exigirDonoSupAdmin, responder('situacao', (api, req) => situacao(api, req.params.id)));
router.post('/:id/simular', exigirDonoSupAdmin, responder('simular', async (api, req) => previa(await montar(api, req.params.id, req.body || {}))));
router.post('/:id', exigirDonoSupAdmin, responder('aplicar', (api, req) => aplicar(api, { pedidoId: req.params.id, entrada: req.body || {}, usuarioId: usuarioDaRequisicao(req) })));

module.exports = router;
Object.assign(module.exports, {
  EDITORES, MINIMO_MOTIVO, SQL_ARQUIVO,
  ehEditor, exigirDonoSupAdmin, motivosDoBloqueio, unidadesDeOrigem, expandirEstados, unidadesDoItem, ordenarParaFicar, rotuloDaOrigem,
  partesIguais, precoDaTabela, valoresDaLinha, planejar, oQueVolta, consumoDasNovas, unidadesParaProducao, assinar, contagemDeOrigem,
  descricaoDoEvento, linhaNova, resumoDasUnidades,
  lerPedido, composicao, situacao, montar, previa, aplicar
});
