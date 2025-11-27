const pool = require('./db');

function normalizarData(valor, padrao = null) {
  if (!valor) return padrao;
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return padrao;
  return data;
}

async function updateUsuarioCampos(id, campos) {
  if (!id) return false;
  const payload = Object.fromEntries(
    Object.entries(campos || {}).filter(([, valor]) => valor !== undefined)
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

async function registrarUltimaSaida(usuarioId, info = {}) {
  const saida = normalizarData(info.saida, new Date());
  const ultimaAcao = info.ultimaAcao || {};
  const timestamp = normalizarData(ultimaAcao.timestamp);
  const descricaoDet = typeof ultimaAcao.descricao === 'string' ? ultimaAcao.descricao : null;

  const campos = {
    ultima_saida: saida,
    ultima_saida_em: saida,
    ultima_alteracao: timestamp,
    ultima_acao_em: timestamp,
    ultima_alteracao_em: timestamp,
    local_ultima_alteracao: ultimaAcao.modulo,
    local_ultima_acao: ultimaAcao.modulo,
    especificacao_ultima_alteracao: descricaoDet,
    especificacao_ultima_acao: descricaoDet
  };

  await updateUsuarioCampos(usuarioId, campos);
}

module.exports = {
  registrarUltimaEntrada,
  registrarUltimaSaida,
  updateUsuarioCampos
};
