const pool = require('./db');

async function listarProdutos() {
  try {
    const res = await pool.query('SELECT * FROM produtos ORDER BY nome');
    return res.rows;
  } catch (err) {
    console.error('Erro ao listar produtos:', err.message);
    throw err;
  }
}

module.exports = { listarProdutos };
