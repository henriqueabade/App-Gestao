const pool = require('./db');

function normalizarData(valor, padrao = null) {
  if (!valor) return padrao;
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return padrao;
  return data;
}

/**
 * Grava campos de atividade do usuário.
 *
 * Descarta `undefined`, `null` e string vazia. Isso NÃO é preciosismo: todas as
 * colunas aqui são do tipo "último X conhecido". Mandar vazio significa "não sei
 * o valor agora", e não sei nunca pode apagar o que já estava registrado —
 * era assim que a data da última alteração era zerada a cada saída.
 */
async function updateUsuarioCampos(id, campos) {
  if (!id) return false;
  const payload = Object.fromEntries(
    Object.entries(campos || {}).filter(
      ([, valor]) => valor !== undefined && valor !== null && valor !== ''
    )
  );
  if (!Object.keys(payload).length) return false;

  try {
    await pool.put(`/usuarios/${id}`, payload);
    return true;
  } catch (err) {
    console.error('Falha ao atualizar dados do usuário:', err);
    return false;
  }
}

/**
 * Monta os campos da "última alteração" a partir de uma ação.
 *
 * Quando, onde e o quê descrevem UM evento: ou vão os três, ou não vai nenhum.
 * Devolve `{}` quando não há alteração de verdade — e `{}` faz o
 * `updateUsuarioCampos` não gravar nada, em vez de escrever vazio por cima do
 * que já estava lá.
 */
function camposDaAlteracao(acao = {}, quandoPadrao = null) {
  const modulo = typeof acao.modulo === 'string' ? acao.modulo.trim() : '';
  const descricao = typeof acao.descricao === 'string' ? acao.descricao.trim() : '';
  if (!modulo && !descricao) return {};

  const quando = normalizarData(acao.timestamp, quandoPadrao || new Date());
  if (!quando) return {};

  const campos = {
    ultima_alteracao: quando,
    ultima_alteracao_em: quando,
    ultima_acao_em: quando
  };
  if (modulo) {
    campos.local_ultima_alteracao = modulo;
    campos.local_ultima_acao = modulo;
  }
  if (descricao) {
    campos.especificacao_ultima_alteracao = descricao;
    campos.especificacao_ultima_acao = descricao;
  }
  return campos;
}

/**
 * Registra a última alteração ASSIM QUE ELA ACONTECE.
 *
 * Antes isso só era gravado na saída do usuário, e o efeito prático era que a
 * tela de Gestão de Usuários nunca mostrava nada de quem estava trabalhando —
 * e, se o app fechasse de forma anormal (queda, corte de energia), o registro
 * se perdia inteiro. Quem chama é o processo principal, com folga entre uma
 * gravação e outra para não transformar cada clique num PUT.
 */
async function registrarUltimaAlteracao(usuarioId, acao = {}) {
  const campos = camposDaAlteracao(acao);
  if (!Object.keys(campos).length) return false;
  // A alteração também é atividade: mantém o usuário como "online" na listagem.
  campos.ultima_atividade = campos.ultima_alteracao;
  campos.ultima_atividade_em = campos.ultima_alteracao;
  return updateUsuarioCampos(usuarioId, campos);
}

async function registrarUltimaEntrada(usuarioId, data = new Date()) {
  const entrada = normalizarData(data, new Date());
  const campos = {
    ultima_entrada: entrada,
    ultima_entrada_em: entrada,
    ultima_atividade: entrada,
    ultima_atividade_em: entrada
  };
  await updateUsuarioCampos(usuarioId, campos);
}

/**
 * Registra a saída do usuário e, quando houve alguma, a última alteração feita
 * na sessão.
 *
 * Os três dados da alteração — QUANDO, ONDE e O QUÊ — descrevem um mesmo evento
 * e por isso são gravados juntos ou não são gravados. Antes eles eram montados
 * um a um e, numa saída sem ação registrada, a data ia como `null` enquanto o
 * módulo ia como `undefined`: o `undefined` era filtrado e o `null` não. O
 * resultado era o popover de Gestão de Usuários mostrando "Última alteração: Sem
 * registro" ao lado de "Usuário alterou o módulo Produtos" — a data tinha sido
 * apagada pela própria saída, o módulo tinha sobrevivido.
 */
async function registrarUltimaSaida(usuarioId, info = {}) {
  const saida = normalizarData(info.saida, new Date());

  // A alteração aconteceu nesta sessão, que termina agora: sem carimbo próprio,
  // a saída é o instante mais próximo que se pode afirmar com honestidade.
  const campos = {
    ultima_saida: saida,
    ultima_saida_em: saida,
    ...camposDaAlteracao(info.ultimaAcao || {}, saida)
  };

  await updateUsuarioCampos(usuarioId, campos);
}

module.exports = {
  registrarUltimaEntrada,
  registrarUltimaSaida,
  registrarUltimaAlteracao,
  camposDaAlteracao,
  updateUsuarioCampos
};
