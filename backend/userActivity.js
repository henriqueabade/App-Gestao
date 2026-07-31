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

  const campos = {
    ultima_saida: saida,
    ultima_saida_em: saida
  };

  const ultimaAcao = info.ultimaAcao || {};
  const modulo = typeof ultimaAcao.modulo === 'string' ? ultimaAcao.modulo.trim() : '';
  const descricao = typeof ultimaAcao.descricao === 'string' ? ultimaAcao.descricao.trim() : '';
  // A alteração aconteceu nesta sessão, que termina agora: sem carimbo próprio,
  // a saída é o instante mais próximo que se pode afirmar com honestidade.
  const quando = normalizarData(ultimaAcao.timestamp, (modulo || descricao) ? saida : null);

  if (quando && (modulo || descricao)) {
    campos.ultima_alteracao = quando;
    campos.ultima_alteracao_em = quando;
    campos.ultima_acao_em = quando;
    if (modulo) {
      campos.local_ultima_alteracao = modulo;
      campos.local_ultima_acao = modulo;
    }
    if (descricao) {
      campos.especificacao_ultima_alteracao = descricao;
      campos.especificacao_ultima_acao = descricao;
    }
  }

  await updateUsuarioCampos(usuarioId, campos);
}

module.exports = {
  registrarUltimaEntrada,
  registrarUltimaSaida,
  updateUsuarioCampos
};
