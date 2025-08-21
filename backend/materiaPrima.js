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
  const dup = await pool.query('SELECT 1 FROM materia_prima WHERE lower(nome)=lower($1) LIMIT 1', [nome]);
  if (dup.rowCount > 0) {
    const err = new Error('DUPLICADO');
    err.code = 'DUPLICADO';
    throw err;
  }
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
  const dup = await pool.query('SELECT 1 FROM materia_prima WHERE lower(nome)=lower($1) AND id<>$2 LIMIT 1', [nome, id]);
  if (dup.rowCount > 0) {
    const err = new Error('DUPLICADO');
    err.code = 'DUPLICADO';
    throw err;
  }
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
  if (preco_unitario !== undefined) {
    await atualizarProdutosComInsumo(id);
  }
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

async function atualizarProdutosComInsumo(insumoId) {
  const { rows: produtos } = await pool.query('SELECT DISTINCT produto_codigo FROM produtos_insumos WHERE insumo_id=$1', [insumoId]);
  for (const { produto_codigo } of produtos) {
    const { rows } = await pool.query(
      `SELECT p.pct_fabricacao, p.pct_acabamento, p.pct_montagem, p.pct_embalagem,
              p.pct_markup, p.pct_comissao, p.pct_imposto,
              SUM(pi.quantidade * mp.preco_unitario) AS base
         FROM produtos p
         JOIN produtos_insumos pi ON pi.produto_codigo = p.codigo
         JOIN materia_prima mp ON mp.id = pi.insumo_id
        WHERE p.codigo=$1
        GROUP BY p.pct_fabricacao, p.pct_acabamento, p.pct_montagem, p.pct_embalagem,
                 p.pct_markup, p.pct_comissao, p.pct_imposto`,
      [produto_codigo]
    );
    const info = rows[0];
    if (!info) continue;
    const base = Number(info.base) || 0;
    const pctFab = Number(info.pct_fabricacao) || 0;
    const pctAcab = Number(info.pct_acabamento) || 0;
    const pctMont = Number(info.pct_montagem) || 0;
    const pctEmb = Number(info.pct_embalagem) || 0;
    const pctMarkup = Number(info.pct_markup) || 0;
    const pctCom = Number(info.pct_comissao) || 0;
    const pctImp = Number(info.pct_imposto) || 0;

    const totalMaoObra = base * (pctFab + pctAcab + pctMont + pctEmb) / 100;
    const subTotal = base + totalMaoObra;
    const markupVal = base * (pctMarkup / 100);
    const custoTotal = subTotal + markupVal;
    const denom = 1 - (pctImp + pctCom) / 100;
    const comissaoVal = denom !== 0 ? (pctCom / 100) * (custoTotal / denom) : 0;
    const impostoVal = denom !== 0 ? (pctImp / 100) * (custoTotal / denom) : 0;
    const valorVenda = custoTotal + comissaoVal + impostoVal;

    await pool.query('UPDATE produtos SET preco_base=$1, preco_venda=$2, data=NOW() WHERE codigo=$3', [base, valorVenda, produto_codigo]);
  }
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
  await atualizarProdutosComInsumo(id);
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

async function adicionarCategoria(nome) {
  const res = await pool.query(
    'INSERT INTO categoria (nome_categoria) VALUES ($1) RETURNING nome_categoria',
    [nome]
  );
  return res.rows[0]?.nome_categoria;
}

async function adicionarUnidade(tipo) {
  const res = await pool.query(
    'INSERT INTO unidades (tipo) VALUES ($1) RETURNING tipo',
    [tipo]
  );
  return res.rows[0]?.tipo;
}

async function removerCategoria(nome) {
  const dep = await pool.query(
    'SELECT 1 FROM materia_prima WHERE categoria=$1 LIMIT 1',
    [nome]
  );
  if (dep.rowCount > 0) {
    const err = new Error('DEPENDENTE');
    err.code = 'DEPENDENTE';
    throw err;
  }
  await pool.query('DELETE FROM categoria WHERE nome_categoria=$1', [nome]);
  return true;
}

async function removerUnidade(tipo) {
  const dep = await pool.query(
    'SELECT 1 FROM materia_prima WHERE unidade=$1 LIMIT 1',
    [tipo]
  );
  if (dep.rowCount > 0) {
    const err = new Error('DEPENDENTE');
    err.code = 'DEPENDENTE';
    throw err;
  }
  await pool.query('DELETE FROM unidades WHERE tipo=$1', [tipo]);
  return true;
}

async function categoriaTemDependencias(nome) {
  const dep = await pool.query(
    'SELECT 1 FROM materia_prima WHERE categoria=$1 LIMIT 1',
    [nome]
  );
  return dep.rowCount > 0;
}

async function unidadeTemDependencias(tipo) {
  const dep = await pool.query(
    'SELECT 1 FROM materia_prima WHERE unidade=$1 LIMIT 1',
    [tipo]
  );
  return dep.rowCount > 0;
}

async function processoTemDependencias(nome) {
  const dep = await pool.query(
    'SELECT 1 FROM materia_prima WHERE processo=$1 LIMIT 1',
    [nome]
  );
  return dep.rowCount > 0;
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
  listarUnidades,
  adicionarCategoria,
  adicionarUnidade,
  removerCategoria,
  removerUnidade,
  categoriaTemDependencias,
  unidadeTemDependencias,
  processoTemDependencias
};
