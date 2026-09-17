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

/**
 * Distribui a fila entre os registros (na ordem em que foram feitos).
 * Devolve { porEvento: Map(id → { fracoes, fracao }), usadas, pendentes }.
 */
function alocar({ fila = [], eventos = [] }) {
  const porEvento = new Map();
  let usadas = 0;
  for (const e of eventos.filter(consome).sort(ordemDoEvento)) {
    const q = Math.trunc(numero(e.quantidade));
    const fracoes = fila.slice(usadas, usadas + q);
    usadas += q;
    porEvento.set(String(e.id), { fracoes, fracao: fracoes.reduce((s, f) => s + f, 0) });
  }
  return { porEvento, usadas: Math.min(usadas, fila.length), pendentes: fila.slice(usadas) };
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
  semAcento, passosDoProcesso, fracao, unidadesDoItem, filaDoProcesso, alocar,
  regraDaPeca, valorDaPecaInteira, descreverRegra, pendenciasDaPeca
};
