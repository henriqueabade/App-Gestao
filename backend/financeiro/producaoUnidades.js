/**
 * Produção por PROCESSO, fiel ao que foi feito — tudo puro.
 *
 * O processo paga o valor da regra (R$ por peça, ou % do preço da tabela
 * fixa) na proporção dos insumos DAQUELE processo que a peça ainda não
 * tinha. Cada insumo da rota conta igual: Marcenaria com 10 insumos paga
 * 1/10 do valor por insumo feito.
 *
 *   peça do zero ................................ paga o processo inteiro
 *   peça do estoque com 9 dos 10 já feitos ....... paga 1/10
 *   peça do estoque com o processo completo ...... não paga (nem aparece)
 *
 * As unidades de um item do pedido vêm de `pedido_itens_ext` (as que saíram
 * do estoque, com o ponto da rota em que estavam) e o resto é do zero. Na
 * hora de registrar, as do estoque entram primeiro — as mais adiantadas antes,
 * porque terminam antes.
 *
 * Os registros consomem as unidades na ordem em que foram feitos (data e id);
 * o registro estornado devolve as dele.
 */

const semAcento = t => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const numero = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const centavos = v => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const ativo = v => !(v === false || v === 'false' || v === 0 || v === 'f');

/** Quantos passos da rota são do processo e quantos já estavam feitos até `ordemOrigem`. */
function passosDoProcesso(rota, processo, ordemOrigem = 0) {
  const alvo = semAcento(processo);
  const doProcesso = (rota || []).filter(p => semAcento(p.processo) === alvo);
  const feitos = doProcesso.filter(p => numero(p.ordem) <= numero(ordemOrigem)).length;
  return { total: doProcesso.length, feitos };
}

/** A parte do processo que falta numa unidade (0 a 1), ou null se a peça não usa o processo. */
function fracao(rota, processo, ordemOrigem = 0) {
  const { total, feitos } = passosDoProcesso(rota, processo, ordemOrigem);
  if (!total) return null;
  return Math.max(0, total - feitos) / total;
}

/**
 * As unidades do item, de onde vieram: [{ origem, ordem_origem, quantidade }],
 * as do estoque primeiro (as mais adiantadas antes), depois as do zero.
 * `ext` são as linhas de pedido_itens_ext DESTE item.
 */
function unidadesDoItem({ item, ext = [], rota = [] }) {
  const quantidade = Math.max(0, Math.trunc(numero(item?.quantidade)));
  const ordemFinal = rota.length ? numero(rota[rota.length - 1].ordem) : 0;
  const grupos = [];
  let doEstoque = 0;
  for (const reg of ext) {
    const passo = rota.find(p => Number(p.passo_id) === Number(reg.ultimo_insumo_id)) || null;
    const q = Math.max(0, Math.trunc(numero(reg.quantidade)));
    if (!q) continue;
    grupos.push({ origem: 'estoque', ordem_origem: passo ? numero(passo.ordem) : ordemFinal, quantidade: q });
    doEstoque += q;
  }
  grupos.sort((a, b) => b.ordem_origem - a.ordem_origem);
  const doZero = Math.max(0, quantidade - doEstoque);
  if (doZero) grupos.push({ origem: 'producao', ordem_origem: 0, quantidade: doZero });
  return grupos;
}

/** A fila do processo: a fração de cada unidade que ainda precisa dele, na ordem em que entram. */
function filaDoProcesso({ grupos, rota, processo }) {
  const fila = [];
  for (const g of grupos) {
    const f = fracao(rota, processo, g.ordem_origem);
    if (!(f > 0)) continue;
    for (let i = 0; i < g.quantidade; i += 1) fila.push(f);
  }
  return fila;
}

const consome = e => e && e.status === 'ativo' && !e.estornado_em && !e.estorno_de && numero(e.quantidade) > 0;
const ordemDoEvento = (a, b) => String(a.data_finalizacao ?? '').localeCompare(String(b.data_finalizacao ?? '')) || numero(a.id) - numero(b.id);
const QUASE_ZERO = 1e-6;
const quatroCasas = v => Math.round((Number(v) || 0) * 10000) / 10000;

/** A fração de peça que o registro pagou à mão (`fracao_paga`), ou null. */
function fracaoDoRegistro(e) {
  if (e?.fracao_paga === null || e?.fracao_paga === undefined || e.fracao_paga === '') return null;
  const f = Number(e.fracao_paga);
  return Number.isFinite(f) && f > 0 ? f : null;
}

/**
 * Distribui a fila entre os registros (na ordem em que foram feitos).
 *
 * Registro comum (`quantidade` peças): cada peça leva o que faltava dela.
 * Registro com `fracao_paga` (o cancelamento e a decisão QUEBRADA do
 * fechamento — "0,5 da Marcenaria ficou pronta", 07/10/2026): consome
 * exatamente essa fração, e pode parar no MEIO de uma unidade — o que falta
 * dela continua pendente para o mês seguinte.
 *
 * Devolve { porEvento: Map(id → { fracoes, fracao }), usadas, pendentes, cotas }:
 * `usadas` são as unidades terminadas; `pendentes`, a fração de peça que
 * falta em cada unidade em aberto (a primeira pode estar pela metade); e
 * `cotas`, quanto de cada uma ainda falta (1 = a unidade inteira, 0,5 =
 * metade dela).
 */
function alocar({ fila = [], eventos = [] }) {
  const resta = fila.map(numero);
  const porEvento = new Map();
  let i = 0;
  const pular = () => { while (i < resta.length && resta[i] <= QUASE_ZERO) { resta[i] = 0; i += 1; } };
  for (const e of eventos.filter(consome).sort(ordemDoEvento)) {
    pular();
    const fracoes = [];
    const manual = fracaoDoRegistro(e);
    if (manual === null) {
      for (let q = Math.trunc(numero(e.quantidade)); q > 0 && i < resta.length; q -= 1) {
        fracoes.push(resta[i]);
        resta[i] = 0;
        i += 1;
      }
    } else {
      let f = manual;
      while (f > QUASE_ZERO && i < resta.length) {
        const parte = Math.min(f, resta[i]);
        fracoes.push(parte);
        resta[i] -= parte;
        f -= parte;
        pular();
      }
    }
    porEvento.set(String(e.id), { fracoes, fracao: fracoes.reduce((s, x) => s + x, 0) });
  }
  pular();
  const pendentes = resta.slice(i).map(quatroCasas);
  const cotas = pendentes.map((r, k) => (numero(fila[i + k]) > 0 ? quatroCasas(r / numero(fila[i + k])) : 0));
  return { porEvento, usadas: i, pendentes, cotas };
}

/**
 * `alocar` com as MUDANÇAS de unidade do item (09/10/2026): a troca de peças
 * entre pedidos e a peça avulsa de um pedido cancelado.
 *
 * Cada mudança tem hora (`em`) e diz, neste processo, o restante de cada
 * unidade que SAI (`sai`: a fração que faltava nela quando saiu — 0 se o
 * processo já estava feito) e o que falta em cada unidade que ENTRA
 * (`entra`). `zerar` (cancelamento) tira todas as unidades antes de entrar.
 *
 * O que foi registrado ANTES da mudança consome a fila como era — o valor
 * de cada registro não muda por causa de uma troca feita depois. O que é
 * registrado depois consome a fila nova: a unidade que saiu deixou de ser
 * pendência daqui, e a que entrou deve só o que falta nela (quem a recebeu
 * pronta não paga de novo). O registro cai no trecho pela hora em que foi
 * GRAVADO (`criado_em`); sem hora, conta como antes de tudo.
 *
 * Devolve o mesmo que `alocar` e mais `pedida`: quantas unidades precisam do
 * processo agora (a `fila.length` de sempre, depois das mudanças) — e `feito`:
 * quanto do processo já foi feito nas unidades que estão no item.
 */
function alocarComMudancas({ fila = [], eventos = [], mudancas = [] }) {
  const lista = (mudancas || []).filter(Boolean);
  if (!lista.length) {
    const r = alocar({ fila, eventos });
    const soma = v => v.reduce((s, x) => s + numero(x), 0);
    return { ...r, pedida: fila.length, feito: quatroCasas(soma(fila) - soma(r.pendentes)) };
  }
  const ordem = [...lista].sort((a, b) => String(a.em ?? '').localeCompare(String(b.em ?? '')));
  const unidadesDaFila = fila.map(f => ({ total: numero(f), resta: numero(f), viva: true }));
  const porEvento = new Map();
  let i = 0;
  const pular = () => {
    while (i < unidadesDaFila.length && (!unidadesDaFila[i].viva || unidadesDaFila[i].resta <= QUASE_ZERO)) {
      if (unidadesDaFila[i].viva) unidadesDaFila[i].resta = 0;
      i += 1;
    }
  };
  const consumir = e => {
    pular();
    const fracoes = [];
    const manual = fracaoDoRegistro(e);
    if (manual === null) {
      for (let q = Math.trunc(numero(e.quantidade)); q > 0 && i < unidadesDaFila.length; q -= 1) {
        fracoes.push(unidadesDaFila[i].resta);
        unidadesDaFila[i].resta = 0;
        i += 1;
        pular();
      }
    } else {
      let f = manual;
      while (f > QUASE_ZERO && i < unidadesDaFila.length) {
        const parte = Math.min(f, unidadesDaFila[i].resta);
        fracoes.push(parte);
        unidadesDaFila[i].resta -= parte;
        f -= parte;
        pular();
      }
    }
    porEvento.set(String(e.id), { fracoes, fracao: fracoes.reduce((s, x) => s + x, 0) });
  };
  // A unidade que sai: a viva de restante mais parecido com o dela (as do
  // mesmo processo são iguais entre si; o que as distingue é quanto falta).
  const tirar = restante => {
    const r = numero(restante);
    let melhor = -1;
    let distancia = Infinity;
    unidadesDaFila.forEach((u, k) => {
      if (!u.viva) return;
      const d = Math.abs(u.resta - r);
      if (d < distancia - QUASE_ZERO) { melhor = k; distancia = d; }
    });
    if (melhor >= 0) unidadesDaFila[melhor].viva = false;
  };
  const aplicar = m => {
    // Cancelamento: toda unidade do pedido ganhou um destino (estoque,
    // descarte, outro pedido, avulsa) — sai tudo; só as avulsas voltam a entrar.
    if (m.zerar) unidadesDaFila.forEach(u => { u.viva = false; });
    for (const r of m.sai || []) tirar(r);
    for (const r of m.entra || []) {
      const f = numero(r);
      if (f > QUASE_ZERO) unidadesDaFila.push({ total: f, resta: f, viva: true });
    }
    i = 0;
    pular();
  };

  const vivos = eventos.filter(consome).sort(ordemDoEvento);
  // No empate (mesmo instante), o registro conta como ANTES da mudança: é o
  // caso do trecho pago no cancelamento logo antes de a avulsa nascer.
  const trecho = e => ordem.filter(m => String(e.criado_em ?? '') !== '' && String(e.criado_em) > String(m.em ?? '')).length;
  for (let k = 0; k <= ordem.length; k += 1) {
    for (const e of vivos.filter(x => trecho(x) === k)) consumir(e);
    if (k < ordem.length) aplicar(ordem[k]);
  }
  pular();
  const abertas = unidadesDaFila.filter(u => u.viva && u.resta > QUASE_ZERO);
  return {
    porEvento,
    usadas: unidadesDaFila.filter(u => u.viva && u.resta <= QUASE_ZERO).length,
    pendentes: abertas.map(u => quatroCasas(u.resta)),
    cotas: abertas.map(u => (u.total > 0 ? quatroCasas(u.resta / u.total) : 0)),
    pedida: unidadesDaFila.filter(u => u.viva).length,
    // O que já foi feito nas unidades que ESTÃO no item (a que saiu levou o dela).
    feito: quatroCasas(unidadesDaFila.filter(u => u.viva).reduce((s, u) => s + (u.total - u.resta), 0))
  };
}

/**
 * O que uma decisão de `unidades` (pode ser quebrada: 0,5 = metade de uma
 * unidade) consome da fila em aberto, na ordem — pura.
 * `pendentes`/`cotas` são os de `alocar`. Devolve a fração de peça paga, as
 * unidades tocadas e se a decisão parou no meio de uma unidade (`parcial`).
 */
function planoDaDecisao({ pendentes = [], cotas = [] }, unidades) {
  let resta = Math.max(0, numero(unidades));
  let fracaoPaga = 0;
  let tocadas = 0;
  let parcial = false;
  for (let k = 0; k < cotas.length && resta > QUASE_ZERO; k += 1) {
    const cota = numero(cotas[k]);
    if (!(cota > 0)) continue;
    const parte = Math.min(resta, cota);
    fracaoPaga += numero(pendentes[k]) * (parte / cota);
    tocadas += 1;
    if (cota - parte > QUASE_ZERO) parcial = true;
    resta -= parte;
  }
  return { fracao: quatroCasas(fracaoPaga), tocadas, parcial };
}

/**
 * A regra que vale para a peça no processo: a da peça, senão o padrão do
 * processo. `valores` são as linhas ativas de producao_valores.
 */
function regraDaPeca(valores, produtoId, etapaId) {
  const doProcesso = (valores || []).filter(v => v && ativo(v.ativo) && v.etapa_id !== null && v.etapa_id !== undefined && String(v.etapa_id) === String(etapaId));
  const daPeca = produtoId !== null && produtoId !== undefined
    ? doProcesso.find(v => v.produto_id !== null && v.produto_id !== undefined && String(v.produto_id) === String(produtoId)) : null;
  const padrao = doProcesso.find(v => v.produto_id === null || v.produto_id === undefined);
  const escolhida = daPeca || padrao || null;
  if (!escolhida) return null;
  const tipo = escolhida.tipo === 'percentual' ? 'percentual' : 'valor';
  return {
    id: escolhida.id ?? null, origem: daPeca ? 'peca' : 'padrao', tipo,
    valor: tipo === 'valor' ? centavos(escolhida.valor_unitario) : null,
    percentual: tipo === 'percentual' ? numero(escolhida.percentual) : null
  };
}

/** Quanto a regra paga por uma peça inteira (R$), ou null (sem regra, ou % sem preço de tabela). */
function valorDaPecaInteira(regra, precoTabela) {
  if (!regra) return null;
  if (regra.tipo === 'valor') return centavos(regra.valor);
  const preco = Number(precoTabela);
  if (!Number.isFinite(preco) || preco <= 0) return null;
  return centavos(preco * numero(regra.percentual) / 100);
}

/** Como a regra se lê na tela. */
function descreverRegra(regra) {
  if (!regra) return 'sem regra';
  if (regra.tipo === 'percentual') return `${String(numero(regra.percentual)).replace('.', ',')}% da tabela fixa`;
  return `${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numero(regra.valor))} por peça`;
}

/**
 * Os processos que uma peça usa (os que têm insumo na rota) e os que ficam
 * sem regra. `processos`: [{ nome, insumos }]; `etapas`: etapas_producao
 * (com producao_ativa). Processo desligado não precisa de regra.
 */
function pendenciasDaPeca({ processos = [], etapas = [], valores = [], produtoId = null }) {
  const faltam = [];
  const usados = [];
  for (const p of processos) {
    if (!(numero(p.insumos) > 0)) continue;
    const etapa = etapas.find(e => semAcento(e.nome) === semAcento(p.nome)) || null;
    if (!etapa) { faltam.push({ nome: p.nome, motivo: 'processo não cadastrado' }); continue; }
    const pagando = ativo(etapa.producao_ativa);
    const regra = regraDaPeca(valores, produtoId, etapa.id);
    usados.push({ etapa_id: etapa.id, nome: etapa.nome, insumos: numero(p.insumos), pagando, regra });
    if (pagando && !regra) faltam.push({ nome: etapa.nome, motivo: 'sem valor' });
  }
  return { usados, faltam };
}

module.exports = {
  semAcento, passosDoProcesso, fracao, unidadesDoItem, filaDoProcesso, alocar, alocarComMudancas, planoDaDecisao, fracaoDoRegistro,
  regraDaPeca, valorDaPecaInteira, descreverRegra, pendenciasDaPeca
};
