const pool = require('./db');

let cachedColumns = null;

async function getUsuarioColumns() {
  if (cachedColumns) return cachedColumns;
  try {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usuarios'`
    );
    cachedColumns = new Set(rows.map(r => r.column_name));
  } catch (err) {
    console.error('Falha ao obter colunas da tabela usuarios:', err);
    cachedColumns = new Set();
  }
  return cachedColumns;
}

function normalizarData(valor, padrao = null) {
  if (!valor) return padrao;
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return padrao;
  return data;
}

async function updateUsuarioCampos(id, campos) {
  if (!id) return false;
  const colunas = await getUsuarioColumns();
  const entries = Object.entries(campos || {})
    .filter(([col, valor]) => colunas.has(col) && valor !== undefined);
  if (!entries.length) return false;

  const sets = entries.map(([col], idx) => `${col} = $${idx + 2}`);
  const valores = entries.map(([, valor]) => valor);

  try {
    await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = $1`, [id, ...valores]);
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
