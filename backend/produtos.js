const pool = require('./db');

async function listarProdutos() {
  try {
    const res = await pool.query(
      `SELECT p.id,
              p.codigo,
              p.nome,
              p.categoria,
              p.preco_venda,
              p.pct_markup,
              p.status,
              COALESCE(SUM(pe.quantidade), 0) AS quantidade_total
         FROM produtos p
    LEFT JOIN produtos_em_cada_ponto pe ON pe.produto_id = p.id
     GROUP BY p.id, p.codigo, p.nome, p.categoria, p.preco_venda, p.pct_markup, p.status
     ORDER BY p.nome`
    );
    return res.rows;
  } catch (err) {
    console.error('Erro ao listar produtos:', err.message);
    throw err;
  }
}

async function listarDetalhesProduto(produtoId) {
  const query = `
    SELECT pe.id,
           pe.etapa_id AS etapa_nome,
           mp.nome AS ultimo_item,
           pe.quantidade,
           pe.data_hora_completa
      FROM produtos_em_cada_ponto pe
      LEFT JOIN materia_prima mp ON mp.id = pe.ultimo_insumo_id
     WHERE pe.produto_id = $1
     ORDER BY pe.data_hora_completa DESC`;
  const res = await pool.query(query, [produtoId]);
  return res.rows;
}

async function obterProduto(id) {
  const res = await pool.query('SELECT * FROM produtos WHERE id=$1', [id]);
  return res.rows[0];
}

async function listarInsumosProduto(codigo) {
  const query = `
    SELECT pi.id,
           mp.nome,
           pi.quantidade,
           mp.preco_unitario * pi.quantidade AS total,
           mp.processo
      FROM produtos_insumo pi
      JOIN materia_prima mp ON mp.id = pi.insumo_id
     WHERE pi.produto_codigo = $1
     ORDER BY mp.processo, mp.nome`;
  const res = await pool.query(query, [codigo]);
  return res.rows;
}

async function listarEtapasProducao() {
  const res = await pool.query(
    'SELECT id, nome FROM etapas_producao ORDER BY ordem'
  );
  return res.rows;
}

async function adicionarProduto(dados) {
  const { codigo, nome, categoria, preco_venda, pct_markup, status } = dados;
  const res = await pool.query(
    `INSERT INTO produtos (codigo, nome, categoria, preco_venda, pct_markup, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [codigo, nome, categoria, preco_venda, pct_markup, status]
  );
  return res.rows[0];
}

async function atualizarProduto(id, dados) {
  const { codigo, nome, categoria, preco_venda, pct_markup, status } = dados;
  const res = await pool.query(
    `UPDATE produtos
        SET codigo=$1,
            nome=$2,
            categoria=$3,
            preco_venda=$4,
            pct_markup=$5,
            status=$6
     WHERE id=$7 RETURNING *`,
    [codigo, nome, categoria, preco_venda, pct_markup, status, id]
  );
  return res.rows[0];
}

async function excluirProduto(id) {
  await pool.query('DELETE FROM produtos WHERE id=$1', [id]);
}

async function atualizarLoteProduto(id, quantidade) {
  const res = await pool.query(
    `UPDATE produtos_em_cada_ponto
        SET quantidade = $1,
            data_hora_completa = NOW()
     WHERE id = $2 RETURNING *`,
    [quantidade, id]
  );
  return res.rows[0];
}

async function excluirLoteProduto(id) {
  await pool.query('DELETE FROM produtos_em_cada_ponto WHERE id=$1', [id]);
}

module.exports = {
  listarProdutos,
  listarDetalhesProduto,
  obterProduto,
  listarInsumosProduto,
  listarEtapasProducao,
  adicionarProduto,
  atualizarProduto,
  excluirProduto,
  atualizarLoteProduto,
  excluirLoteProduto
};
