const pool = require('./db');

async function listarMaterias(filtro = '') {
  // Busca por nome, categoria ou processo usando ILIKE em qualquer campo
  const res = await pool.query(
    `SELECT * FROM materia_prima
       WHERE nome ILIKE $1
          OR categoria ILIKE $1
          OR processo ILIKE $1
       ORDER BY nome`,
    [`%${filtro}%`]
  );
  return res.rows;
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

module.exports = {
  listarMaterias,
  adicionarMateria,
  atualizarMateria,
  excluirMateria,
  registrarEntrada,
  registrarSaida,
  atualizarPreco
};
