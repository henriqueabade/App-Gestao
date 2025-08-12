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

async function listarInsumosProduto(id) {
  const query = `
    SELECT pi.id,
           mp.nome,
           pi.quantidade,
           mp.preco_unitario,
           mp.preco_unitario * pi.quantidade AS total,
           mp.processo
      FROM produtos_insumos pi
      JOIN materia_prima mp ON mp.id = pi.insumo_id
     WHERE pi.produto_id = $1
     ORDER BY mp.processo, mp.nome`;
  const res = await pool.query(query, [id]);
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

// Atualiza percentuais e insumos do produto em uma única transação
async function salvarProdutoDetalhado(id, produto, itens) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      pct_fabricacao,
      pct_acabamento,
      pct_montagem,
      pct_embalagem,
      pct_markup,
      pct_comissao,
      pct_imposto,
      preco_base,
      preco_venda
    } = produto;

    await client.query(
      `UPDATE produtos
          SET pct_fabricacao=$1,
              pct_acabamento=$2,
              pct_montagem=$3,
              pct_embalagem=$4,
              pct_markup=$5,
              pct_comissao=$6,
              pct_imposto=$7,
              preco_base=$8,
              preco_venda=$9,
              data=NOW()
       WHERE id=$10`,
      [
        pct_fabricacao,
        pct_acabamento,
        pct_montagem,
        pct_embalagem,
        pct_markup,
        pct_comissao,
        pct_imposto,
        preco_base,
        preco_venda,
        id
      ]
    );

    // Processa exclusões
    for (const del of itens.deletados || []) {
      await client.query('DELETE FROM produtos_insumos WHERE id=$1', [del.id]);
    }
    // Processa atualizações
    for (const up of itens.atualizados || []) {
      await client.query('UPDATE produtos_insumos SET quantidade=$1 WHERE id=$2', [up.quantidade, up.id]);
    }
    // Processa inserções
    for (const ins of itens.inseridos || []) {
      await client.query(
        'INSERT INTO produtos_insumos (produto_id, insumo_id, quantidade) VALUES ($1,$2,$3)',
        [id, ins.insumo_id, ins.quantidade]
      );
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
  excluirLoteProduto,
  salvarProdutoDetalhado
};
