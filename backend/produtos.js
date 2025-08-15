const pool = require('./db');

/* Utilitário simples de log de tipos para debug */
function tipo(v) {
  const t = typeof v;
  if (v === null) return 'null';
  if (t !== 'object') return t;
  return Object.prototype.toString.call(v);
}

/**
 * Lista todos os produtos (resumo)
 */
async function listarProdutos() {
  try {
    const sql = `
      SELECT p.id,
             p.codigo,
             p.nome,
             p.descricao,
             p.categoria,
             p.preco_venda,
             p.pct_markup,
             p.status,
             p.criado_em,
             p.data,
             COALESCE(SUM(pe.quantidade), 0) AS quantidade_total
        FROM produtos p
   LEFT JOIN produtos_em_cada_ponto pe ON pe.produto_id = p.id
    GROUP BY p.id, p.codigo, p.nome, p.descricao, p.categoria, p.preco_venda,
             p.pct_markup, p.status, p.criado_em, p.data
    ORDER BY p.nome`;
    const res = await pool.query(sql);
    return res.rows;
  } catch (err) {
    console.error('Erro ao listar produtos:', err.message);
    throw err;
  }
}

async function listarDetalhesProduto(produtoCodigo, produtoId) {
  try {
    if (!produtoCodigo && !produtoId) {
      throw new Error('Produto não informado');
    }

    if (produtoCodigo && !produtoId) {
      const idRes = await pool.query(
        'SELECT id FROM produtos WHERE codigo = $1::text',
        [produtoCodigo]
      );
      produtoId = idRes.rows[0]?.id ?? null;
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
             mp.unidade,
             mp.processo
        FROM produtos_insumos pi
        JOIN materia_prima mp ON mp.id = pi.insumo_id
       WHERE pi.produto_codigo = $1::text
       ORDER BY mp.processo, mp.nome`;
    const itensRes = await pool.query(itensQuery, [produtoCodigo]);

    // Ajuste: alias que o front costuma usar é "etapa".
    // Também normalizamos espaços e evitamos string vazia.
    const lotesQuery = `
      SELECT
        pecp.id,
        pecp.quantidade,
        pecp.ultimo_insumo_id,
        mp.nome AS ultimo_item,
        pecp.tempo_estimado_minutos,
        pecp.data_hora_completa,
        COALESCE(NULLIF(TRIM(pecp.etapa_id::text), ''), '—') AS etapa
      FROM produtos_em_cada_ponto pecp
      LEFT JOIN materia_prima mp
        ON mp.id = pecp.ultimo_insumo_id
      JOIN produtos p
        ON p.id = pecp.produto_id
      WHERE p.codigo = $1::text
      ORDER BY pecp.data_hora_completa DESC`;
    const lotesRes = await pool.query(lotesQuery, [produtoCodigo]);

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


/**
 * Busca 1 produto pelo codigo (text)
 */
async function obterProduto(codigo) {
  const sql = 'SELECT * FROM produtos WHERE codigo = $1::text';
  const res = await pool.query(sql, [codigo]);
  return res.rows[0];
}

/**
 * Lista insumos (produtos_insumos + materia_prima) por codigo de produto (text)
 */
async function listarInsumosProduto(codigo) {
  const query = `
    SELECT pi.id,
           mp.nome,
           pi.quantidade,
           mp.preco_unitario,
           mp.unidade,
           mp.preco_unitario * pi.quantidade AS total,
           mp.processo
      FROM produtos_insumos pi
      JOIN materia_prima mp ON mp.id = pi.insumo_id
     WHERE pi.produto_codigo = $1::text
     ORDER BY mp.processo, mp.nome`;
  const res = await pool.query(query, [codigo]);
  return res.rows;
}

/**
 * Lista etapas (id + nome)
 */
async function listarEtapasProducao() {
  const res = await pool.query(
    'SELECT id, nome FROM etapas_producao ORDER BY id'
  );
  return res.rows;
}

async function adicionarEtapaProducao(nome) {
  const res = await pool.query(
    'INSERT INTO etapas_producao (nome) VALUES ($1) RETURNING id, nome',
    [nome]
  );
  return res.rows[0];
}

/**
 * Lista itens de um processo para um produto (dependente de etapa)
 * Aceita etapa por id (int) OU por nome (text).
 */
async function listarItensProcessoProduto(codigo, etapa, busca = '') {
  const sql = `
    SELECT DISTINCT mp.id, mp.nome
      FROM materia_prima mp
      JOIN produtos_insumos pi ON pi.insumo_id = mp.id
      JOIN etapas_producao ep ON (ep.id::text = $2::text OR ep.nome = $2::text)
     WHERE pi.produto_codigo = $1::text
       AND mp.processo = ep.nome
       AND mp.nome ILIKE $3
     ORDER BY mp.nome ASC`;
  const res = await pool.query(sql, [codigo, etapa, '%' + busca + '%']);
  return res.rows;
}

/**
 * CRUD básico de produtos
 */
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
     WHERE id=$7::int RETURNING *`,
    [codigo, nome, categoria, preco_venda, pct_markup, status, id]
  );
  return res.rows[0];
}

async function excluirProduto(id) {
  await pool.query('DELETE FROM produtos WHERE id=$1::int', [id]);
}

/**
 * Insere um novo lote de produção para o produto informado.
 *
 * @param {Object} params                Dados do lote a ser criado.
 * @param {number} params.produtoId      Identificador do produto.
 * @param {string} params.etapa          Etapa da produção em que o lote se encontra.
 * @param {number} params.ultimoInsumoId Último insumo utilizado na produção.
 * @param {number} params.quantidade     Quantidade de itens produzidos no lote.
 * @returns {Promise<Object>}            Registro completo do lote recém inserido.
 */
async function inserirLoteProduto({ produtoId, etapa, ultimoInsumoId, quantidade }) {
  const res = await pool.query(
    `INSERT INTO produtos_em_cada_ponto (produto_id, etapa_id, ultimo_insumo_id, quantidade, data_hora_completa)
     VALUES ($1::int, $2::text, $3::int, $4::int, NOW()) RETURNING *`,
    [produtoId, etapa, ultimoInsumoId, quantidade]
  );
  return res.rows[0];
}

/**
 * Atualiza um lote (quantidade + data)
 */
async function atualizarLoteProduto(id, quantidade) {
  const res = await pool.query(
    `UPDATE produtos_em_cada_ponto
        SET quantidade = $1,
            data_hora_completa = NOW()
     WHERE id = $2::int RETURNING *`,
    [quantidade, id]
  );
  return res.rows[0];
}

async function excluirLoteProduto(id) {
  await pool.query('DELETE FROM produtos_em_cada_ponto WHERE id=$1::int', [id]);
}

/**
 * Salva detalhes do produto (percentuais + itens) em transação
 */
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

    // Monta consulta dinâmica
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
    query += ` WHERE codigo=$${params.length + 1}::text`;
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
    for (const del of (itens.deletados || [])) {
      await client.query('DELETE FROM produtos_insumos WHERE id=$1::int', [del.id]);
    }
    // Processa atualizações
    for (const up of (itens.atualizados || [])) {
      await client.query(
        'UPDATE produtos_insumos SET quantidade=$1 WHERE id=$2::int',
        [up.quantidade, up.id]
      );
    }
    // Processa inserções
    for (const ins of (itens.inseridos || [])) {
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
  adicionarEtapaProducao,
  adicionarProduto,
  atualizarProduto,
  excluirProduto,
  inserirLoteProduto,
  atualizarLoteProduto,
  excluirLoteProduto,
  salvarProdutoDetalhado
};
