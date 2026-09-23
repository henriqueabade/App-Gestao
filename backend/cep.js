/**
 * Endereço pelo CEP (ViaCEP), para o cadastro de clientes e de prospecções:
 * o usuário digita o CEP e a tela preenche rua, bairro, cidade e estado.
 *
 * Por que passa pelo backend e não vai direto da tela: a janela do app não
 * fala com endereços de fora (e o proxy do app já é o caminho de tudo), o
 * cache fica num lugar só para todas as telas e a falha de rede vira uma
 * frase em português em vez de um erro cru do fetch.
 *
 * O estado volta pela sigla E pelo nome ("MG" e "Minas Gerais"): o cadastro
 * guarda o nome (é o que a lista de estados usa) e a NF-e quer o código IBGE,
 * que o ViaCEP também devolve. `buscarNaRede` é injetável para os testes não
 * saírem para a internet.
 */
const { UFS } = require('./fiscal/municipios');

const VALIDADE_MS = 24 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 8000;
const URL_VIACEP = 'https://viacep.com.br/ws';

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

/** Só os oito números do CEP; qualquer outra coisa é recusada. */
function normalizarCep(valor) {
  const numeros = String(valor ?? '').replace(/\D/g, '');
  return numeros.length === 8 ? numeros : null;
}

/** "31160370" → "31160-370". */
function cepFormatado(cep) {
  return `${cep.slice(0, 5)}-${cep.slice(5)}`;
}

/** O que a tela usa, a partir da resposta do ViaCEP. Pura. */
function enderecoDaResposta(cep, dados) {
  const texto = chave => String(dados?.[chave] ?? '').trim();
  const uf = texto('uf').toUpperCase();
  return {
    cep: cepFormatado(cep),
    logradouro: texto('logradouro'),
    complemento: texto('complemento'),
    bairro: texto('bairro'),
    cidade: texto('localidade'),
    uf: UFS[uf] ? uf : '',
    estado: UFS[uf] || '',
    // Código IBGE do município: a NF-e pede, e o cadastro do cliente tem campo.
    codigo_municipio: /^\d{7}$/.test(texto('ibge')) ? texto('ibge') : ''
  };
}

async function buscarNaRedePadrao(cep) {
  const resposta = await fetch(`${URL_VIACEP}/${cep}/json/`, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  if (!resposta.ok) throw new Error(`ViaCEP respondeu HTTP ${resposta.status}`);
  return resposta.json();
}

const cache = new Map();

/**
 * O endereço do CEP. CEP que não existe é 404; sem internet, 503 — nos dois
 * casos com a frase pronta para a tela.
 */
async function buscar(valor, { buscarNaRede = buscarNaRedePadrao, agora = Date.now() } = {}) {
  const cep = normalizarCep(valor);
  if (!cep) throw erro('CEP inválido: informe os 8 números.');

  const guardado = cache.get(cep);
  if (guardado && agora < guardado.ate) return guardado.endereco;

  let dados;
  try {
    dados = await buscarNaRede(cep);
  } catch (err) {
    console.error('Falha ao consultar o CEP:', err?.message || err);
    throw erro('Não foi possível consultar o CEP agora. Verifique a internet e tente de novo.', 503);
  }
  // O ViaCEP responde 200 com { erro: true } quando o CEP não existe.
  if (!dados || dados.erro === true || String(dados.erro).toLowerCase() === 'true') {
    throw erro('CEP não encontrado.', 404);
  }

  const endereco = enderecoDaResposta(cep, dados);
  cache.set(cep, { endereco, ate: agora + VALIDADE_MS });
  return endereco;
}

function limparCache() {
  cache.clear();
}

module.exports = { VALIDADE_MS, normalizarCep, cepFormatado, enderecoDaResposta, buscar, limparCache };
