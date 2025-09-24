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

async function updateUsuarioCampos(id, campos) {
  if (!id) return false;
  const colunas = await getUsuarioColumns();
  const entries = Object.entries(campos || {}).filter(([col]) => colunas.has(col));
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
  await updateUsuarioCampos(usuarioId, { ultima_entrada: data });
}

async function registrarUltimaSaida(usuarioId, info = {}) {
  const dados = { ultima_saida: info.saida || new Date() };
  if (info.ultimaAcao) {
    const { timestamp, modulo, descricao } = info.ultimaAcao;
    if (timestamp) dados.ultima_alteracao = timestamp;
    if (modulo) dados.local_ultima_alteracao = modulo;
    if (descricao) dados.especificacao_ultima_alteracao = descricao;
  }
  await updateUsuarioCampos(usuarioId, dados);
}

module.exports = {
  registrarUltimaEntrada,
  registrarUltimaSaida
};
