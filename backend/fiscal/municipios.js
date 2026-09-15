/**
 * Municípios do IBGE: o código de 7 dígitos que a NF-e exige no endereço do
 * destinatário (cMun). O cadastro de clientes guarda o ESTADO pelo nome
 * ("Minas Gerais") e a cidade por extenso; a SEFAZ quer a sigla e o código.
 *
 * A lista vem da API pública do IBGE, por estado, e fica em cache por 24 h —
 * ela não muda de um dia para o outro. `buscarNaRede` é injetável para os
 * testes não saírem para a internet.
 */
const UFS = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins'
};

/** Código IBGE do estado (cUF), para a chave de acesso e o cabeçalho da NF-e. */
const CODIGO_UF = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24',
  PB: '25', PE: '26', AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42',
  RS: '43', MS: '50', MT: '51', GO: '52', DF: '53'
};

const VALIDADE_MS = 24 * 60 * 60 * 1000;
const URL_IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
}

/** "Minas Gerais", "mg" ou "MG" -> "MG"; desconhecido -> null. */
function siglaDaUf(texto) {
  const limpo = String(texto ?? '').trim();
  if (!limpo) return null;
  const maiusculo = limpo.toUpperCase();
  if (UFS[maiusculo]) return maiusculo;
  const alvo = normalizar(limpo);
  const achada = Object.entries(UFS).find(([, nome]) => normalizar(nome) === alvo);
  return achada ? achada[0] : null;
}

const cache = new Map();

async function buscarNaRedePadrao(uf) {
  const resposta = await fetch(`${URL_IBGE}/${uf}/municipios`, { signal: AbortSignal.timeout(15000) });
  if (!resposta.ok) throw new Error(`IBGE respondeu HTTP ${resposta.status}`);
  return resposta.json();
}

/** Municípios do estado: [{ codigo, nome }]. Falha de rede vira erro claro. */
async function listar(uf, { buscarNaRede = buscarNaRedePadrao, agora = Date.now() } = {}) {
  const sigla = siglaDaUf(uf);
  if (!sigla) throw erro(`Estado desconhecido: ${uf}`);
  const guardado = cache.get(sigla);
  if (guardado && agora < guardado.ate) return guardado.lista;

  let bruto;
  try {
    bruto = await buscarNaRede(sigla);
  } catch (e) {
    throw erro('Não foi possível consultar os municípios no IBGE agora (sem internet?).', 502);
  }
  const lista = (Array.isArray(bruto) ? bruto : [])
    .map(m => ({ codigo: String(m?.id ?? ''), nome: String(m?.nome ?? '').trim() }))
    .filter(m => /^\d{7}$/.test(m.codigo) && m.nome);
  if (!lista.length) throw erro('O IBGE devolveu uma lista vazia de municípios.', 502);
  cache.set(sigla, { lista, ate: agora + VALIDADE_MS });
  return lista;
}

/**
 * Procura o município pelo nome. `exato` é o que casa sem acento/caixa;
 * `candidatos` são os que começam ou contêm o texto (até 10), para a tela
 * oferecer quando o nome cadastrado tem grafia diferente.
 */
async function buscar(uf, nome, opcoes) {
  const lista = await listar(uf, opcoes);
  const alvo = normalizar(nome);
  if (!alvo) return { exato: null, candidatos: [] };
  const exato = lista.find(m => normalizar(m.nome) === alvo) || null;
  const candidatos = exato ? [exato] : lista.filter(m => normalizar(m.nome).startsWith(alvo) || normalizar(m.nome).includes(alvo)).slice(0, 10);
  return { exato, candidatos };
}

function limparCache() {
  cache.clear();
}

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

module.exports = { UFS, CODIGO_UF, VALIDADE_MS, normalizar, siglaDaUf, listar, buscar, limparCache };
