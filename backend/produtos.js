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

// Ajuste: separação de params (produtoCodigo text, produtoId integer) e casts explícitos
async function listarDetalhesProduto(produtoCodigo, produtoId) {
  try {
    if (!produtoCodigo && !produtoId) {
      throw new Error('Produto não informado');
    }

    // Se vier apenas o código, busca o ID correspondente
    if (produtoCodigo && !produtoId) {
      const idRes = await pool.query(
        'SELECT id FROM produtos WHERE codigo = $1::text',
        [produtoCodigo]
      );
      produtoId = idRes.rows[0]?.id;
    }

    const produtoQuery = `
      SELECT id, codigo, nome, descricao, categoria, preco_base, criado_em,
             pct_fabricacao, pct_acabamento, pct_montagem, pct_embalagem,
             pct_markup, pct_comissao, pct_imposto, preco_venda, status, ncm, data
        FROM produtos
       WHERE codigo = $1::text`;
    const produtoRes = await pool.query(produtoQuery, [produtoCodigo]);

    const itensQuery = `
      SELECT pi.id,
             pi.insumo_id,
             pi.quantidade,
             mp.nome,
             mp.preco_unitario,
             mp.processo
        FROM produtos_insumos pi
        JOIN materia_prima mp ON mp.id = pi.insumo_id
       WHERE pi.produto_codigo = $1::text
       ORDER BY mp.processo, mp.nome`;
    const itensRes = await pool.query(itensQuery, [produtoCodigo]);

    let lotesRes = { rows: [] };
    if (produtoId) {
      const lotesQuery = `
        SELECT pecp.id,
               pecp.quantidade,
               pecp.ultimo_insumo_id,
               pecp.tempo_estimado_minutos,
               pecp.data_hora_completa,
               ep.nome AS etapa
          FROM produtos_em_cada_ponto pecp
          JOIN etapas_producao ep ON ep.id = pecp.etapa_id
         WHERE pecp.produto_id = $2::int
         ORDER BY pecp.data_hora_completa DESC`;
      lotesRes = await pool.query(lotesQuery, [produtoCodigo, produtoId]);
    }

    return {
      produto: produtoRes.rows[0] || null,
      itens: itensRes.rows,
      lotes: lotesRes.rows,
    };
  } catch (err) {
    console.error('Erro ao listar detalhes do produto:', err.message);
    throw new Error('Erro ao listar detalhes do produto');
  }
}

// Busca produto pelo código
async function obterProduto(codigo) {
  // Cast explícito para evitar problemas de tipo
  const res = await pool.query('SELECT * FROM produtos WHERE codigo = $1::text', [codigo]);
  return res.rows[0];
}

// Lista insumos vinculados a um produto usando o código
async function listarInsumosProduto(codigo) {
  // Cast explícito para o parâmetro de código
  const query = `
    SELECT pi.id,
           mp.nome,
           pi.quantidade,
           mp.preco_unitario,
           mp.preco_unitario * pi.quantidade AS total,
           mp.processo
      FROM produtos_insumos pi
      JOIN materia_prima mp ON mp.id = pi.insumo_id
     WHERE pi.produto_codigo = $1::text
     ORDER BY mp.processo, mp.nome`;
  const res = await pool.query(query, [codigo]);
  return res.rows;
}

async function listarEtapasProducao() {
  const res = await pool.query(
    'SELECT id, nome FROM etapas_producao ORDER BY nome ASC'
  );
  return res.rows;
}

async function listarItensProcessoProduto(codigo, etapaId, busca = '') {
  const res = await pool.query(
    `SELECT DISTINCT mp.id, mp.nome
       FROM materia_prima mp
       JOIN produtos_insumos pi ON pi.insumo_id = mp.id
       JOIN etapas_producao ep ON ep.id = $2
      WHERE pi.produto_codigo = $1::text
        AND mp.processo = ep.nome
        AND mp.nome ILIKE $3
      ORDER BY mp.nome ASC`,
    [codigo, etapaId, '%' + busca + '%']
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
async function salvarProdutoDetalhado(codigoOriginal, produto, itens) {
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
      preco_venda,
      nome,
      codigo,
      ncm
    } = produto;

    // Monta consulta dinâmica para atualizar campos obrigatórios e opcionais
    let query = `UPDATE produtos
          SET pct_fabricacao=$1,
              pct_acabamento=$2,
              pct_montagem=$3,
              pct_embalagem=$4,
              pct_markup=$5,
              pct_comissao=$6,
              pct_imposto=$7,
              preco_base=$8,
              preco_venda=$9,
              data=NOW()`;
    const params = [
      pct_fabricacao,
      pct_acabamento,
      pct_montagem,
      pct_embalagem,
      pct_markup,
      pct_comissao,
      pct_imposto,
      preco_base,
      preco_venda
    ];
    if (nome !== undefined) {
      query += `, nome=$${params.length + 1}`;
      params.push(nome);
    }
    if (codigo !== undefined) {
      query += `, codigo=$${params.length + 1}`;
      params.push(codigo);
    }
    if (ncm !== undefined) {
      query += `, ncm=$${params.length + 1}`;
      params.push(ncm);
    }
    query += ` WHERE codigo=$${params.length + 1}`;
    params.push(codigoOriginal);

    await client.query(query, params);

    // Se o código foi alterado, atualiza relacionamentos
    const codigoDestino = codigo !== undefined ? codigo : codigoOriginal;
    if (codigo !== undefined && codigo !== codigoOriginal) {
      await client.query(
        'UPDATE produtos_insumos SET produto_codigo=$1 WHERE produto_codigo=$2',
        [codigo, codigoOriginal]
      );
    }

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
        'INSERT INTO produtos_insumos (produto_codigo, insumo_id, quantidade) VALUES ($1,$2,$3)',
        [codigoDestino, ins.insumo_id, ins.quantidade]
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
  listarItensProcessoProduto,
  adicionarProduto,
  atualizarProduto,
  excluirProduto,
  atualizarLoteProduto,
  excluirLoteProduto,
  salvarProdutoDetalhado
};
