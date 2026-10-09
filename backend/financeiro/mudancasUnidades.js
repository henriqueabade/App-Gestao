/**
 * As MUDANÇAS de unidade dos itens de pedido (pedido do dono, 09/10/2026):
 *
 *   troca    uma peça de um pedido vai para outro, no estado em que estava, e
 *            a peça do mesmo produto que estava lá vem no lugar dela — sem
 *            mexer na matéria-prima (as peças só trocam de dono). Cada troca é
 *            uma linha de `trocas_pecas` e nunca é alterada nem apagada.
 *   avulsa   no cancelamento, a peça que continua sendo produzida mesmo fora
 *            de pedido (`pecas_avulsas`): o resto da pendência do pedido some,
 *            e só ela segue, do ponto em que estava.
 *
 * O motor da produção (producaoUnidades.alocarComMudancas) recebe daqui, por
 * item e processo, a lista de mudanças com hora. O estado de cada unidade é
 * gravado como o RESTANTE de cada processo (a fração que faltava nela; null
 * quando ela nem precisava do processo) — é isso que faz quem recebe a peça
 * pronta não pagar de novo, e quem a deu voltar a dever.
 *
 * Sem o SQL (sql/trocas_pecas_e_avulsas.sql), nada muda: não há mudança
 * nenhuma e as filas são as de sempre.
 */
const c = require('./comum');

const TABELA_TROCAS = 'trocas_pecas';
const TABELA_AVULSAS = 'pecas_avulsas';
const SQL_ARQUIVO = 'sql/trocas_pecas_e_avulsas.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`;
const STATUS_AVULSA = { em_producao: 'Em produção', no_estoque: 'No estoque', descartada: 'Descartada', trocada: 'Trocada' };

function tabelaAusente(err) {
  const bruto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  if (/42P01/.test(bruto)) return true;
  const cita = [TABELA_TROCAS, TABELA_AVULSAS].some(t => bruto.includes(t));
  return cita && (/does not exist|não encontrada|não existe/i.test(bruto) || err?.status === 404);
}

/** Lê uma das tabelas; sem o SQL, null. */
async function lerTabela(api, tabela, query = {}) {
  try {
    const linhas = c.lista(await api.get(`/api/${tabela}`, { query }));
    return linhas.filter(l => l && Object.entries(query).every(([col, v]) => String(l[col]) === String(v)));
  } catch (e) {
    if (tabelaAusente(e)) return null;
    throw e;
  }
}

/** O estado gravado (texto JSON) de volta em objeto. Pura. */
function estadoDe(valor) {
  const e = c.jsonDe(valor, null);
  return e && typeof e === 'object' ? e : null;
}

/**
 * As trocas e as avulsas que tocam os itens dados. `sql_pendente` quando as
 * tabelas ainda não existem (aí as listas vêm vazias e nada muda).
 */
async function lerDosItens(api, itemIds = []) {
  const ids = new Set((itemIds || []).filter(v => v !== null && v !== undefined).map(String));
  const [trocas, avulsas] = await Promise.all([
    lerTabela(api, TABELA_TROCAS).catch(() => null),
    lerTabela(api, TABELA_AVULSAS).catch(() => null)
  ]);
  const doItem = (l, ...campos) => campos.some(k => ids.has(String(l[k])));
  return {
    sql_pendente: trocas === null || avulsas === null,
    trocas: (trocas || []).filter(t => doItem(t, 'pedido_item_id_a', 'pedido_item_id_b'))
      .map(t => ({ ...t, estado_a: estadoDe(t.estado_a), estado_b: estadoDe(t.estado_b) })),
    avulsas: (avulsas || []).filter(a => doItem(a, 'pedido_item_id'))
      .map(a => ({ ...a, estado_inicio: estadoDe(a.estado_inicio), encerramento: estadoDe(a.encerramento) }))
  };
}

/** O restante de um processo no estado, `quantidade` vezes (null = a unidade nem usa o processo). Pura. */
function restantes(estado, etapaId, quantidade) {
  const r = estado?.restante?.[String(etapaId)];
  if (r === null || r === undefined || !Number.isFinite(Number(r))) return [];
  return Array.from({ length: Math.max(0, Math.trunc(Number(quantidade) || 0)) }, () => Number(r));
}

/**
 * As mudanças de um item num processo, para producaoUnidades.alocarComMudancas.
 * Pura.
 *
 *   - troca em que o item deu (lado A ou B): sai o estado que ele deu, entra o
 *     que ele recebeu;
 *   - avulsas criadas num cancelamento: uma mudança por cancelamento (o
 *     `lote`), que zera o pendente e põe as avulsas, cada uma do ponto em que
 *     estava;
 *   - avulsa encerrada (foi para o estoque, ou descartada): sai.
 * A avulsa que nasceu de uma troca não gera mudança própria: a troca já diz
 * o que entrou.
 */
function mudancasDoItem({ itemId, trocas = [], avulsas = [] }, etapaId) {
  const id = String(itemId);
  const lista = [];
  for (const t of trocas || []) {
    const ehA = String(t.pedido_item_id_a) === id;
    const ehB = String(t.pedido_item_id_b) === id;
    if (!ehA && !ehB) continue;
    const deu = ehA ? t.estado_a : t.estado_b;
    const recebeu = ehA ? t.estado_b : t.estado_a;
    lista.push({ em: t.criado_em, sai: restantes(deu, etapaId, t.quantidade), entra: restantes(recebeu, etapaId, t.quantidade), troca_id: t.id });
  }
  const doItem = (avulsas || []).filter(a => String(a.pedido_item_id) === id);
  const lotes = new Map();
  for (const a of doItem.filter(x => (x.origem || 'cancelamento') === 'cancelamento')) {
    const k = String(a.lote || a.criado_em);
    const atual = lotes.get(k) || { em: a.criado_em, zerar: true, entra: [], lote: k };
    if (String(a.criado_em) < String(atual.em)) atual.em = a.criado_em;
    atual.entra.push(...restantes(a.estado_inicio, etapaId, a.quantidade));
    lotes.set(k, atual);
  }
  lista.push(...lotes.values());
  for (const a of doItem.filter(x => x.encerrada_em && (x.status === 'no_estoque' || x.status === 'descartada'))) {
    lista.push({ em: a.encerrada_em, sai: restantes(a.encerramento, etapaId, a.quantidade), avulsa_id: a.id });
  }
  return lista;
}

/** `(itemId, etapaId) → mudanças` a partir do que `lerDosItens` trouxe. Pura. */
function indice({ trocas = [], avulsas = [] } = {}) {
  const porItem = new Map();
  const juntar = (itemId, campo, linha) => {
    const k = String(itemId);
    if (!porItem.has(k)) porItem.set(k, { trocas: [], avulsas: [] });
    porItem.get(k)[campo].push(linha);
  };
  for (const t of trocas) {
    juntar(t.pedido_item_id_a, 'trocas', t);
    if (String(t.pedido_item_id_b) !== String(t.pedido_item_id_a)) juntar(t.pedido_item_id_b, 'trocas', t);
  }
  for (const a of avulsas) juntar(a.pedido_item_id, 'avulsas', a);
  return (itemId, etapaId) => {
    const doItem = porItem.get(String(itemId));
    return doItem ? mudancasDoItem({ itemId, ...doItem }, etapaId) : [];
  };
}

/**
 * Os ESTADOS das unidades de um item, a partir do que o motor diz de cada
 * processo. As unidades andam pelos processos na ordem da rota, então a mais
 * adiantada num processo é a mais adiantada nos outros: unidade j recebe, em
 * cada processo, o j-ésimo restante do menor para o maior (quem nem precisa
 * do processo — veio com ele feito — é a mais adiantada). Pura.
 *
 * `processos`: [{ etapa_id, nome, pedida, usadas, pendentes }] (o motor por
 * processo) · `quantidade`: as unidades do item · `rota`: os passos (com o
 * processo de cada um), para dizer em que ponto a unidade está.
 *
 * Devolve os grupos de unidades iguais: [{ chave, quantidade, restante:
 * { etapaId: r|null }, ordem, passo_id, pronta, rotulo, detalhe }].
 */
function estadosDasUnidades({ processos = [], quantidade = 0, rota = [] }) {
  const n = Math.max(0, Math.trunc(Number(quantidade) || 0));
  if (!n) return [];
  const colunas = processos.map(p => {
    const fora = Math.max(0, n - (Number(p.pedida) || 0));
    const valores = [
      ...Array(fora).fill(null),
      ...Array(Math.max(0, Number(p.usadas) || 0)).fill(0),
      ...[...(p.pendentes || [])].map(Number).sort((a, b) => a - b)
    ];
    while (valores.length < n) valores.push(1);
    return { etapa_id: p.etapa_id, nome: p.nome, valores: valores.slice(0, n) };
  });
  const grupos = new Map();
  for (let j = 0; j < n; j += 1) {
    const restante = {};
    for (const col of colunas) {
      const v = col.valores[j];
      restante[String(col.etapa_id)] = v === null ? null : Math.round(v * 10000) / 10000;
    }
    const chave = JSON.stringify(Object.keys(restante).sort().map(k => [k, restante[k]]));
    const atual = grupos.get(chave) || { chave, quantidade: 0, restante };
    atual.quantidade += 1;
    grupos.set(chave, atual);
  }
  const nomes = new Map(processos.map(p => [String(p.etapa_id), p.nome]));
  return [...grupos.values()].map(g => {
    const ponto = pontoDaRota({ restante: g.restante, nomes, rota });
    const partes = Object.entries(g.restante).map(([k, r]) => ({ nome: nomes.get(k) || `processo ${k}`, r }));
    const feitos = partes.filter(p => p.r === null || p.r <= 0.0001);
    const meio = partes.filter(p => p.r !== null && p.r > 0.0001 && p.r < 0.9999);
    const pronta = partes.every(p => p.r === null || p.r <= 0.0001);
    const nada = partes.every(p => p.r !== null && p.r >= 0.9999);
    const rotulo = pronta ? 'Pronta' : (nada ? 'Por começar' : [
      ...feitos.map(p => `${p.nome} feita`),
      ...meio.map(p => `${p.nome} ${Math.round((1 - p.r) * 100)}%`)
    ].join(' · '));
    const detalhe = partes.map(p => `${p.nome}: ${p.r === null || p.r <= 0.0001 ? 'feita' : (p.r >= 0.9999 ? 'por fazer' : `${Math.round((1 - p.r) * 100)}% feita`)}`).join(' · ');
    return { ...g, ...ponto, pronta, rotulo, detalhe };
  }).sort((a, b) => b.ordem - a.ordem || b.quantidade - a.quantidade);
}

/**
 * Em que ponto da rota a unidade está: o último passo de uma sequência
 * contínua de passos feitos (dentro de cada processo, os primeiros
 * `round((1 − r) × passos)` estão feitos; passo de processo que não é pago
 * acompanha o anterior). É o "estágio" que o estoque e o cancelamento usam.
 * Pura.
 */
function pontoDaRota({ restante = {}, nomes = new Map(), rota = [] }) {
  const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const porNome = new Map([...nomes].map(([id, nome]) => [semAcento(nome), id]));
  const passosDo = new Map();
  for (const p of rota) {
    const k = semAcento(p.processo);
    passosDo.set(k, (passosDo.get(k) || 0) + 1);
  }
  const vistos = new Map();
  let ultimo = null;
  let anteriorFeito = true;
  for (const p of [...rota].sort((a, b) => Number(a.ordem) - Number(b.ordem))) {
    const k = semAcento(p.processo);
    const indiceNoProcesso = (vistos.get(k) || 0) + 1;
    vistos.set(k, indiceNoProcesso);
    const etapaId = porNome.get(k);
    let feito;
    if (etapaId === undefined || !(String(etapaId) in restante)) {
      feito = anteriorFeito;
    } else {
      const r = restante[String(etapaId)];
      const feitosNoProcesso = r === null ? passosDo.get(k) : Math.round((1 - Number(r)) * passosDo.get(k));
      feito = indiceNoProcesso <= feitosNoProcesso;
    }
    if (!feito) break;
    ultimo = p;
    anteriorFeito = true;
  }
  return { ordem: ultimo ? Number(ultimo.ordem) : 0, passo_id: ultimo ? (ultimo.passo_id ?? null) : null };
}

module.exports = {
  TABELA_TROCAS, TABELA_AVULSAS, SQL_ARQUIVO, SQL_FALTANDO, STATUS_AVULSA,
  tabelaAusente, lerTabela, estadoDe, lerDosItens, restantes, mudancasDoItem, indice, estadosDasUnidades, pontoDaRota
};
