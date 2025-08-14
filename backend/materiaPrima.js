const pool = require('./db');

async function listarMaterias(filtro = '') {
  const params = [];
  let whereClause = '';

  if (filtro) {
    const normalized = filtro.trim().toLowerCase();

    // Lógica para filtro de "infinito"
    if (['sim', 's', 'true', 'infinito', 'infinita', '∞'].includes(normalized)) {
      whereClause = 'WHERE infinito = $1';
      params.push(true); // Adiciona o valor booleano ao array de parâmetros
    } else if (['nao', 'não', 'n', 'false', 'finito', 'finita'].includes(normalized)) {
      whereClause = 'WHERE infinito = $1';
      params.push(false); // Adiciona o valor booleano ao array de parâmetros
    } else {
      // Lógica para filtro de texto (nome, categoria, processo)
      params.push(`%${filtro}%`);
      whereClause = 'WHERE (nome ILIKE $1 OR categoria ILIKE $1 OR processo ILIKE $1)';
    }
  }

  // Monta a query final com a cláusula WHERE e a ordenação
  const query = `SELECT * FROM materia_prima ${whereClause} ORDER BY nome`;

  try {
    const res = await pool.query(query, params);
    return res.rows;
  } catch (err) {
    console.error('Erro ao listar materiais:', err.message);
    throw err;
  }
}

async function adicionarMateria(dados) {
  const { nome, quantidade, preco_unitario, categoria, unidade, infinito, processo, descricao } = dados;
  const res = await pool.query(
    `INSERT INTO materia_prima
      (nome, quantidade, preco_unitario, data_estoque, data_preco, categoria, unidade, infinito, processo, descricao)
     VALUES ($1,$2,$3, NOW(), NOW(), $4,$5,$6,$7,$8)
     RETURNING *`,
    [nome, quantidade, preco_unitario, categoria, unidade, infinito, processo, descricao]
  );
  return res.rows[0];
}

async function atualizarMateria(id, dados) {
  const {
    nome,
    categoria,
    quantidade,
    unidade,
    preco_unitario,
    processo,
    infinito,
    descricao
  } = dados;
  const res = await pool.query(
    `UPDATE materia_prima
        SET nome=$1,
            categoria=$2,
            quantidade=$3,
            unidade=$4,
            preco_unitario=$5,
            processo=$6,
            infinito=$7,
            descricao=$8,
            data_preco=NOW(),
            data_estoque=NOW()
     WHERE id=$9 RETURNING *`,
    [
      nome,
      categoria,
      quantidade,
      unidade,
      preco_unitario,
      processo,
      infinito,
      descricao,
      id
    ]
  );
  return res.rows[0];
}

async function excluirMateria(id) {
  await pool.query('DELETE FROM materia_prima WHERE id=$1', [id]);
}

async function registrarEntrada(id, quantidade) {
  const res = await pool.query(
    `UPDATE materia_prima SET quantidade = quantidade + $1, data_estoque = NOW()
     WHERE id=$2 RETURNING *`,
    [quantidade, id]
  );
  return res.rows[0];
}

async function registrarSaida(id, quantidade) {
  const res = await pool.query(
    `UPDATE materia_prima SET quantidade = quantidade - $1, data_estoque = NOW()
     WHERE id=$2 RETURNING *`,
    [quantidade, id]
  );
  return res.rows[0];
}

async function atualizarPreco(id, preco) {
  const res = await pool.query(
    `UPDATE materia_prima SET preco_unitario=$1, data_preco = NOW()
     WHERE id=$2 RETURNING *`,
    [preco, id]
  );
  return res.rows[0];
}

async function listarCategorias() {
  const res = await pool.query(
    'SELECT nome_categoria FROM categoria ORDER BY nome_categoria'
  );
  return res.rows.map(r => r.nome_categoria);
}

async function listarUnidades() {
  const res = await pool.query('SELECT tipo FROM unidades ORDER BY tipo');
  return res.rows.map(r => r.tipo);
}

module.exports = {
  listarMaterias,
  adicionarMateria,
  atualizarMateria,
  excluirMateria,
  registrarEntrada,
  registrarSaida,
  atualizarPreco,
  listarCategorias,
  listarUnidades
};
