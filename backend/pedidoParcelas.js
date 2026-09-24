/**
 * As parcelas no "Pagamento do pedido" (decisões do dono, 24/09/2026).
 *
 *   - As parcelas podem ter valores DIFERENTES, e a soma pode sair do total
 *     dos itens: para mais (ADICIONAL) ou para menos (DESCONTO), sempre com
 *     uma JUSTIFICATIVA. O total do pedido (`valor_final`) passa a ser a soma
 *     — o dashboard, os relatórios e o Financeiro leem ele e as parcelas —, os
 *     produtos não mudam, e a diferença aparece como uma linha a mais nos
 *     itens ("Adicional" ou "Desconto") e na NF-e (outras despesas ou
 *     desconto, xmlNfe.js).
 *   - Parcela TRAVADA — com boleto do BB (registrado, vencido, em protesto ou
 *     pago), boleto de fora, pagamento registrado ou ordem de pagamento
 *     aberta: o valor fica como está ou vai EXATAMENTE para o valor do
 *     boleto/pagamento/ordem; qualquer outro é recusado com o aviso. Ela não
 *     sai do pedido e o vencimento dela não muda.
 *   - Só em pedido em Produção (a rota confere).
 *   - As parcelas são atualizadas NO LUGAR, pelo número: boletos, pagamentos,
 *     boletos de fora e ordens apontam para o id delas. Antes a rota apagava
 *     e recriava tudo, e esses vínculos se perdiam.
 *
 * Tudo aqui é puro.
 */
const centavos = v => Math.round(Number(v || 0) * 100) / 100;
const dia = v => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const reais = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Diferença até R$ 0,02 é arredondamento, não ajuste. */
const TOLERANCIA = 0.02;
/** A justificativa precisa dizer alguma coisa. */
const MINIMO_JUSTIFICATIVA = 10;

const STATUS_DO_BOLETO_QUE_TRAVA = new Set(['registrado', 'vencido', 'protestado', 'pago']);
const ROTULO_DA_TRAVA = {
  boleto: 'boleto do BB',
  boleto_fora: 'boleto de fora',
  pagamento: 'pagamento registrado',
  ordem: 'ordem de pagamento'
};

const ativo = v => v === undefined || v === null || v === true || v === 't' || v === 'true' || v === 1;

/**
 * As travas, por número de parcela: `Map(numero → { origem, atual, permitido,
 * vencimento, texto })`. `permitido` é o único valor novo aceito além do atual.
 */
function travasDasParcelas({ parcelas = [], boletos = [], recebimentos = [], externos = [], ordens = [] }) {
  const travas = new Map();
  for (const p of parcelas || []) {
    if (!p) continue;
    const n = Number(p.numero_parcela);
    const boleto = (boletos || []).filter(b => b && Number(b.numero_parcela) === n && STATUS_DO_BOLETO_QUE_TRAVA.has(String(b.status)))
      .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
    const pago = (recebimentos || []).find(r => r && r.status === 'confirmado' && Number(r.numero_parcela) === n) || null;
    const deFora = (externos || []).find(e => e && ativo(e.ativo) && Number(e.numero_parcela) === n) || null;
    const ordem = (ordens || []).find(o => o && o.status === 'aberta' && Number(o.numero_parcela) === n) || null;
    let origem = null;
    let permitido = null;
    if (boleto) { origem = 'boleto'; permitido = centavos(boleto.valor); } else if (pago) { origem = 'pagamento'; permitido = centavos(pago.valor_recebido); } else if (deFora) { origem = 'boleto_fora'; permitido = deFora.valor === null || deFora.valor === undefined ? null : centavos(deFora.valor); } else if (ordem) { origem = 'ordem'; permitido = centavos(ordem.valor); }
    if (!origem) continue;
    const atual = centavos(p.valor);
    const texto = permitido !== null && Math.abs(permitido - atual) > 0.005
      ? `A ${n}ª parcela tem ${ROTULO_DA_TRAVA[origem]} de ${reais(permitido)}: o valor dela fica em ${reais(atual)} ou vai exatamente para ${reais(permitido)}.`
      : `A ${n}ª parcela tem ${ROTULO_DA_TRAVA[origem]}: o valor dela (${reais(atual)}) não muda.`;
    travas.set(n, { numero: n, origem, atual, permitido, vencimento: dia(p.data_vencimento), texto });
  }
  return travas;
}

/** A primeira trava que as parcelas novas furam (frase), ou null. */
function conferirTravas(novas, travas) {
  for (const t of travas.values()) {
    const nova = (novas || []).find(p => Number(p?.numero_parcela) === t.numero);
    if (!nova) return `A ${t.numero}ª parcela tem ${ROTULO_DA_TRAVA[t.origem]}: ela não pode sair do pedido.`;
    const valor = centavos(nova.valor);
    const igualAtual = Math.abs(valor - t.atual) <= 0.005;
    const igualPermitido = t.permitido !== null && Math.abs(valor - t.permitido) <= 0.005;
    if (!igualAtual && !igualPermitido) return t.texto;
  }
  return null;
}

/** A diferença da soma das parcelas para o total dos itens (0 quando é só arredondamento). */
function ajusteDaSoma(soma, totalItens) {
  const diferenca = centavos(Number(soma) - Number(totalItens));
  return Math.abs(diferenca) <= TOLERANCIA ? 0 : diferenca;
}

/** "Adicional" (para mais) ou "Desconto" (para menos). */
const rotuloDoAjuste = ajuste => (Number(ajuste) > 0 ? 'Adicional' : 'Desconto');

/** A justificativa limpa, ou o erro quando falta. */
function conferirJustificativa(ajuste, texto) {
  const limpo = String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!ajuste) return { ok: true, texto: null };
  if (limpo.length < MINIMO_JUSTIFICATIVA) {
    return { ok: false, erro: `As parcelas somam ${reais(Math.abs(ajuste))} ${ajuste > 0 ? 'a mais' : 'a menos'} que os itens: escreva a justificativa (ao menos ${MINIMO_JUSTIFICATIVA} letras) para salvar.` };
  }
  return { ok: true, texto: limpo };
}

/** O histórico do ajuste (texto JSON no pedido) com mais um registro. */
function historicoComMais(historico, registro) {
  let lista = [];
  if (Array.isArray(historico)) lista = historico;
  else if (historico) {
    try { lista = JSON.parse(historico); } catch (_) { lista = []; }
  }
  return JSON.stringify([...(Array.isArray(lista) ? lista : []), registro].slice(-50));
}

/**
 * O que gravar nas parcelas: as que existem (pelo número) são ATUALIZADAS, as
 * novas são criadas e as que sobraram, apagadas. Parcela travada mantém o
 * vencimento dela.
 */
function planoDasParcelas(existentes, novas, travas = new Map()) {
  const porNumero = new Map();
  const apagar = [];
  for (const p of (existentes || []).slice().sort((a, b) => Number(a.id) - Number(b.id))) {
    const n = Number(p?.numero_parcela);
    if (!porNumero.has(n)) porNumero.set(n, p);
    else apagar.push(p.id);
  }
  const atualizar = [];
  const criar = [];
  const numerosNovos = new Set();
  for (const nova of novas || []) {
    const n = Number(nova.numero_parcela);
    numerosNovos.add(n);
    const trava = travas.get(n);
    const campos = { ...nova, valor: centavos(nova.valor), ...(trava && trava.vencimento ? { data_vencimento: trava.vencimento } : {}) };
    const existente = porNumero.get(n);
    if (existente) atualizar.push({ id: existente.id, campos });
    else criar.push(campos);
  }
  for (const [n, p] of porNumero) if (!numerosNovos.has(n)) apagar.push(p.id);
  return { atualizar, criar, apagar };
}

module.exports = {
  TOLERANCIA, MINIMO_JUSTIFICATIVA, ROTULO_DA_TRAVA,
  travasDasParcelas, conferirTravas, ajusteDaSoma, rotuloDoAjuste, conferirJustificativa, historicoComMais, planoDasParcelas
};
