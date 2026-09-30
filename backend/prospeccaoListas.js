/**
 * Prospecções — as listas editáveis pela tela (a caixa com + e −) e as redes
 * sociais da empresa (pedido do dono, 30/09/2026).
 *
 *   origens          → a "Origem" da prospecção (Website, Indicação, Feira…),
 *                       gravada como texto em prospeccoes.origem;
 *   tipos-interacao  → o "Tipo" de Registrar interação (Ligação, E-mail…),
 *                       gravado como texto em prospeccao_interacoes.tipo.
 *
 * O valor gravado continua sendo o NOME (as colunas já eram texto): a lista é
 * o que a tela oferece e o que o backend aceita. Excluir um nome que alguma
 * prospecção/interação usa é recusado (decisão do dono, como o Tipo de
 * Contatos). "Atividade realizada" é do sistema (nasce ao concluir o próximo
 * passo): vale sempre e não aparece na lista.
 *
 * Tabelas em sql/prospeccoes_listas_redes.sql. Sem o SQL, a leitura devolve a
 * lista padrão (a tela e o backend seguem funcionando como antes) e o + e o −
 * respondem 409 com `sql_pendente`.
 */
const social = require('./historicoSocial');

const SQL_ARQUIVO = 'sql/prospeccoes_listas_redes.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`;

/** Tipo criado pelo fluxo de concluir o próximo passo: aceito sempre, fora da lista. */
const TIPO_DO_SISTEMA = 'Atividade realizada';

const LISTAS = {
  origens: {
    tabela: 'prospeccao_origens',
    nome: 'origem',
    artigo: 'a',
    max: 60,
    padrao: ['Website', 'Redes Sociais', 'Indicação', 'Evento', 'Feira', 'Prospecção ativa'],
    uso: { tabela: 'prospeccoes', coluna: 'origem', singular: 'prospecção', plural: 'prospecções' }
  },
  'tipos-interacao': {
    tabela: 'prospeccao_tipos_interacao',
    nome: 'tipo de interação',
    artigo: 'o',
    max: 40,
    padrao: ['Ligação', 'E-mail', 'Reunião', 'WhatsApp', 'Visita', 'Proposta', 'Nota'],
    uso: { tabela: 'prospeccao_interacoes', coluna: 'tipo', singular: 'interação', plural: 'interações' }
  }
};

/** As redes da caixa de seleção das "Redes sociais" (uma por linha). */
const REDES = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube', 'X (Twitter)', 'Pinterest', 'WhatsApp', 'Outra'];
const MAX_REDES = 12;
const MAX_VALOR_REDE = 200;

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const texto = v => (v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim());
/** Comparação sem acento, sem caixa e sem espaço sobrando ("Indicacao" = "indicação"). */
const chave = v => texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function erro(status, mensagem, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

function definicao(nomeDaLista) {
  const def = LISTAS[nomeDaLista];
  if (!def) throw erro(404, `Lista desconhecida: ${nomeDaLista}.`);
  return def;
}

const ordenar = itens => itens.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

/**
 * A lista: `{ itens: [{ id, nome }], sql_pendente }`. Sem a tabela (SQL não
 * rodou), a padrão com `id: null` — assim a tela e a validação não quebram.
 */
async function ler(api, nomeDaLista) {
  const def = definicao(nomeDaLista);
  try {
    const itens = lista(await api.get(`/api/${def.tabela}`))
      .filter(i => i && texto(i.nome))
      .map(i => ({ id: i.id, nome: texto(i.nome) }));
    return { itens: ordenar(itens), sql_pendente: false };
  } catch (err) {
    if (!social.semTabela(err)) throw err;
    return { itens: ordenar(def.padrao.map(nome => ({ id: null, nome }))), sql_pendente: true };
  }
}

/** Só os nomes. */
async function nomes(api, nomeDaLista) {
  return (await ler(api, nomeDaLista)).itens.map(i => i.nome);
}

/** O nome como está na lista (acento e caixa da lista), ou null. */
function naLista(nomesDaLista, valor) {
  const alvo = chave(valor);
  if (!alvo) return null;
  return (nomesDaLista || []).find(n => chave(n) === alvo) || null;
}

/** Os tipos de interação que o backend aceita: os da lista e o do sistema. */
async function tiposDeInteracaoAceitos(api) {
  return [...(await nomes(api, 'tipos-interacao')), TIPO_DO_SISTEMA];
}

async function incluir(api, nomeDaLista, nomeBruto, usuarioId = null) {
  const def = definicao(nomeDaLista);
  const nome = texto(nomeBruto).slice(0, def.max);
  if (nome.length < 2) throw erro(400, `Informe o nome d${def.artigo} ${def.nome}.`);
  if (chave(nome) === chave(TIPO_DO_SISTEMA) && nomeDaLista === 'tipos-interacao') {
    throw erro(400, `"${TIPO_DO_SISTEMA}" é do sistema (nasce ao concluir o próximo passo): escolha outro nome.`);
  }
  const atual = await ler(api, nomeDaLista);
  if (atual.sql_pendente) throw erro(409, SQL_FALTANDO, { sql_pendente: true });
  const igual = atual.itens.find(i => chave(i.nome) === chave(nome));
  if (igual) throw erro(409, `${igual.nome} já está na lista.`, { item: igual });
  const criado = await api.post(`/api/${def.tabela}`, { nome, criado_por: usuarioId ?? null, criado_em: new Date().toISOString() });
  const id = criado?.id ?? criado?.[0]?.id ?? null;
  return { item: { id, nome }, itens: (await ler(api, nomeDaLista)).itens };
}

/** Exclui da lista — recusado enquanto alguma prospecção/interação usa o nome. */
async function excluir(api, nomeDaLista, id) {
  const def = definicao(nomeDaLista);
  const atual = await ler(api, nomeDaLista);
  if (atual.sql_pendente) throw erro(409, SQL_FALTANDO, { sql_pendente: true });
  const alvo = atual.itens.find(i => String(i.id) === String(id));
  if (!alvo) throw erro(404, `${def.nome[0].toUpperCase()}${def.nome.slice(1)} não encontrad${def.artigo}.`);
  const usados = lista(await api.get(`/api/${def.uso.tabela}`).catch(() => []))
    .filter(r => chave(r?.[def.uso.coluna]) === chave(alvo.nome)).length;
  if (usados > 0) {
    throw erro(409, `${alvo.nome} está em ${usados === 1 ? `1 ${def.uso.singular}` : `${usados} ${def.uso.plural}`}: troque antes de excluir.`, { dependente: true, usados });
  }
  await api.delete(`/api/${def.tabela}/${alvo.id}`);
  return { removido: alvo, itens: (await ler(api, nomeDaLista)).itens };
}

// ------------------------------------------------------------ redes sociais

/** A rede como está na lista; desconhecida vira "Outra". */
const redeDaLista = v => REDES.find(r => chave(r) === chave(v)) || null;

/** Qual rede é o endereço (para quem cola só o link): instagram.com → Instagram. */
function redeDoEndereco(valor) {
  const v = chave(valor);
  const dominios = [
    ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['fb.com', 'Facebook'], ['linkedin', 'LinkedIn'],
    ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['youtu.be', 'YouTube'], ['twitter', 'X (Twitter)'], ['x.com', 'X (Twitter)'],
    ['pinterest', 'Pinterest'], ['wa.me', 'WhatsApp'], ['whatsapp', 'WhatsApp']
  ];
  return dominios.find(([d]) => v.includes(d))?.[1] || null;
}

/**
 * As redes limpas: lista de `{ rede, valor }` (a rede da lista, o valor com
 * até 200 letras), sem linha vazia nem repetida, no máximo 12. Aceita a lista
 * da tela, o JSON guardado (texto) ou nada.
 */
function normalizarRedes(entrada) {
  let bruto = entrada;
  if (typeof bruto === 'string') {
    try { bruto = JSON.parse(bruto); } catch (_) { bruto = []; }
  }
  const vistos = new Set();
  const saida = [];
  for (const item of Array.isArray(bruto) ? bruto : []) {
    const valor = texto(item?.valor).slice(0, MAX_VALOR_REDE);
    if (!valor) continue;
    const rede = redeDaLista(item?.rede) || 'Outra';
    const id = `${rede}|${chave(valor)}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    saida.push({ rede, valor });
    if (saida.length >= MAX_REDES) break;
  }
  return saida;
}

/** "Instagram: @loja | Facebook: /loja" — para o histórico, a planilha e a comparação. */
function redesEmTexto(entrada) {
  return normalizarRedes(entrada).map(r => `${r.rede}: ${r.valor}`).join(' | ');
}

/**
 * A célula da planilha → `{ redes, pendencias }`. Aceita "Rede: endereço"
 * separados por "|" ou quebra de linha; o endereço sozinho tem a rede
 * descoberta pelo domínio. Rede fora da lista entra como "Outra" (com o nome
 * dela no endereço) e vira pendência.
 */
function lerRedesDoCsv(celula) {
  const pendencias = [];
  const itens = [];
  const partes = String(celula ?? '').split(/\||\r?\n/).map(texto).filter(Boolean);
  for (const parte of partes) {
    const m = /^([^:/]{1,30}):\s*(.+)$/.exec(parte);
    let rede = null;
    let valor = parte;
    if (m && !/^https?$/i.test(m[1].trim())) {
      rede = redeDaLista(m[1]);
      valor = m[2];
      if (!rede) {
        pendencias.push(`Rede "${texto(m[1])}" não está na lista (${REDES.join(', ')}): gravada como Outra.`);
        rede = 'Outra';
        valor = parte;
      }
    } else {
      rede = redeDoEndereco(parte);
      if (!rede) {
        pendencias.push(`Não deu para saber a rede de "${parte}": gravada como Outra.`);
        rede = 'Outra';
      }
    }
    itens.push({ rede, valor });
  }
  const redes = normalizarRedes(itens);
  if (itens.length > redes.length && itens.length > MAX_REDES) pendencias.push(`Mais de ${MAX_REDES} redes: só as ${MAX_REDES} primeiras foram gravadas.`);
  return { redes, pendencias };
}

module.exports = {
  SQL_ARQUIVO, SQL_FALTANDO, LISTAS, TIPO_DO_SISTEMA, REDES, MAX_REDES,
  chave, definicao, ler, nomes, naLista, tiposDeInteracaoAceitos, incluir, excluir,
  redeDaLista, redeDoEndereco, normalizarRedes, redesEmTexto, lerRedesDoCsv
};
