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
             p.ncm,
             p.preco_venda,
             p.pct_markup,
             p.status,
             p.criado_em,
             p.data,
             COALESCE(SUM(pe.quantidade), 0) AS quantidade_total
        FROM produtos p
   LEFT JOIN produtos_em_cada_ponto pe ON pe.produto_id = p.id
   GROUP BY p.id, p.codigo, p.nome, p.descricao, p.categoria, p.preco_venda,
             p.ncm, p.pct_markup, p.status, p.criado_em, p.data
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
 * Lista etapas de produção ordenadas pela coluna "ordem".
 */
async function listarEtapasProducao() {
  const res = await pool.query(
    'SELECT id, nome, ordem FROM etapas_producao ORDER BY ordem ASC'
  );
  return res.rows;
}

/**
 * Insere uma nova etapa de produção em uma ordem específica.
 * Caso a ordem seja informada, todos os registros com ordem igual ou
 * superior são incrementados.
 * Se nenhuma ordem for informada, a etapa é adicionada ao final.
 */
async function adicionarEtapaProducao(nome, ordem) {
  // Permite chamada com um único objeto: adicionarEtapaProducao({ nome, ordem })
  if (typeof nome === 'object' && nome !== null) {
    ({ nome, ordem } = nome);
  }

  // Garante que 'ordem' seja um número válido
  ordem = Number(ordem);

  // Se ordem não for fornecida ou inválida, calcula a próxima ordem disponível
  if (!Number.isInteger(ordem) || ordem <= 0) {
    const { rows } = await pool.query(
      'SELECT COALESCE(MAX(ordem), 0) + 1 AS prox FROM etapas_producao'
    );
    ordem = rows[0].prox;
  }

  const res = await pool.query(
    `WITH moved AS (
       UPDATE etapas_producao
          SET ordem = ordem + 1
        WHERE ordem >= $2
        RETURNING id
     )
     INSERT INTO etapas_producao (nome, ordem)
     VALUES ($1, $2)
     RETURNING id, nome, ordem`,
    [nome, ordem]
  );
  return res.rows[0];
}

async function removerEtapaProducao(nome) {
  const dep = await pool.query(
    'SELECT 1 FROM materia_prima WHERE processo=$1 LIMIT 1',
    [nome]
  );
  if (dep.rowCount > 0) {
    const err = new Error('DEPENDENTE');
    err.code = 'DEPENDENTE';
    throw err;
  }
  const { rows } = await pool.query(
    'DELETE FROM etapas_producao WHERE nome=$1 RETURNING ordem',
    [nome]
  );
  if (rows[0]) {
    await pool.query(
      'UPDATE etapas_producao SET ordem=ordem-1 WHERE ordem>$1',
      [rows[0].ordem]
    );
  }
  return true;
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
  const { codigo, nome, preco_venda, pct_markup, status } = dados;
  const categoria = dados.categoria || (nome ? String(nome).trim().split(' ')[0] : null);
  const required = {
    codigo: 'Código',
    nome: 'Nome',
    preco_venda: 'Preço de venda',
    pct_markup: 'Markup',
    status: 'Status'
  };
  for (const [key, label] of Object.entries(required)) {
    const val = dados[key];
    if (val === undefined || val === null || String(val).trim() === '') {
      const err = new Error(`${label} é obrigatório`);
      err.code = 'CAMPO_OBRIGATORIO';
      err.field = key;
      throw err;
    }
  }
  const codigoDup = await pool.query('SELECT 1 FROM produtos WHERE codigo=$1', [codigo]);
  if (codigoDup.rowCount > 0) {
    const err = new Error('Código já existe');
    err.code = 'CODIGO_EXISTE';
    throw err;
  }
  const nomeDup = await pool.query('SELECT 1 FROM produtos WHERE nome=$1', [nome]);
  if (nomeDup.rowCount > 0) {
    const err = new Error('Nome já existe');
    err.code = 'NOME_EXISTE';
    throw err;
  }
  const res = await pool.query(
    `INSERT INTO produtos (codigo, nome, categoria, preco_venda, pct_markup, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [codigo, nome, categoria, preco_venda, pct_markup, status]
  );
  return res.rows[0];
}

async function atualizarProduto(id, dados) {
  const { codigo, nome, preco_venda, pct_markup, status } = dados;
  const categoria = dados.categoria || (nome ? String(nome).trim().split(' ')[0] : null);
  const { rows: atuaisRows } = await pool.query(
    'SELECT codigo, nome FROM produtos WHERE id=$1::int',
    [id]
  );
  const atuais = atuaisRows[0];
  if (!atuais) {
    throw new Error('Produto não encontrado');
  }
  if (codigo !== undefined && codigo !== atuais.codigo) {
    const dup = await pool.query('SELECT 1 FROM produtos WHERE codigo=$1', [codigo]);
    if (dup.rowCount > 0) {
      const err = new Error('Código já existe');
      err.code = 'CODIGO_EXISTE';
      throw err;
    }
  }
  if (nome !== undefined && nome !== atuais.nome) {
    const dup = await pool.query('SELECT 1 FROM produtos WHERE nome=$1', [nome]);
    if (dup.rowCount > 0) {
      const err = new Error('Nome já existe');
      err.code = 'NOME_EXISTE';
      throw err;
    }
  }
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
  if (codigo !== undefined && codigo !== atuais.codigo) {
    await pool.query(
      'UPDATE produtos_insumos SET produto_codigo=$1 WHERE produto_codigo=$2',
      [codigo, atuais.codigo]
    );
  }
  return res.rows[0];
}

async function excluirProduto(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT codigo FROM produtos WHERE id=$1::int',
      [id]
    );
    const codigo = rows[0]?.codigo;
    if (!codigo) {
      throw new Error('Produto não encontrado');
    }

    const { rowCount: orcamentoCount } = await client.query(
      'SELECT 1 FROM orcamentos_itens WHERE produto_id=$1::int LIMIT 1',
      [id]
    );
    if (orcamentoCount > 0) {
      throw new Error('Produto existe em Orçamentos, não é possível realizar a ação!');
    }

    await client.query(
      'DELETE FROM produtos_insumos WHERE produto_codigo=$1::text',
      [codigo]
    );
    await client.query(
      'DELETE FROM produtos_em_cada_ponto WHERE produto_id=$1::int',
      [id]
    );
    await client.query('DELETE FROM produtos WHERE id=$1::int', [id]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return true;
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
      ncm,
      categoria,
      status
    } = produto;

    // Garante que o NCM não exceda 8 caracteres (limite do banco)
    const ncmSanitizado =
      ncm !== undefined && ncm !== null ? String(ncm).slice(0, 8) : undefined;

    const codigoDestino = codigo !== undefined ? codigo : codigoOriginal;

    if (codigo !== undefined && codigo !== codigoOriginal) {
      const dup = await client.query('SELECT 1 FROM produtos WHERE codigo=$1', [codigo]);
      if (dup.rowCount > 0) {
        const err = new Error('Código já existe');
        err.code = 'CODIGO_EXISTE';
        throw err;
      }
    }
    if (nome !== undefined) {
      const dup = await client.query('SELECT codigo FROM produtos WHERE nome=$1', [nome]);
      if (dup.rowCount > 0 && dup.rows[0].codigo !== codigoOriginal) {
        const err = new Error('Nome já existe');
        err.code = 'NOME_EXISTE';
        throw err;
      }
    }

    // Verifica se há insumos duplicados no payload
    const insumosInseridos = itens?.inseridos || [];
    const insumoIds = new Set();
    for (const ins of insumosInseridos) {
      if (insumoIds.has(ins.insumo_id)) {
        const err = new Error('Insumo duplicado');
        err.code = 'INSUMO_DUPLICADO';
        throw err;
      }
      insumoIds.add(ins.insumo_id);
    }

    if (codigo !== undefined && codigo !== codigoOriginal) {
      const { rows } = await client.query(
        'SELECT * FROM produtos WHERE codigo=$1',
        [codigoOriginal]
      );
      const atuais = rows[0] || {};
      const temId = Object.prototype.hasOwnProperty.call(atuais, 'id');

      const cols = [
        'codigo',
        'pct_fabricacao',
        'pct_acabamento',
        'pct_montagem',
        'pct_embalagem',
        'pct_markup',
        'pct_comissao',
        'pct_imposto',
        'preco_base',
        'preco_venda',
        'nome',
        'ncm'
      ];
      const vals = [
        codigo,
        pct_fabricacao,
        pct_acabamento,
        pct_montagem,
        pct_embalagem,
        pct_markup,
        pct_comissao,
        pct_imposto,
        preco_base,
        preco_venda,
        nome !== undefined ? nome : atuais.nome,
        ncmSanitizado !== undefined ? ncmSanitizado : atuais.ncm
      ];
      if (Object.prototype.hasOwnProperty.call(atuais, 'categoria') || categoria !== undefined) {
        cols.push('categoria');
        vals.push(categoria !== undefined ? categoria : atuais.categoria);
      }
      if (Object.prototype.hasOwnProperty.call(atuais, 'status') || status !== undefined) {
        cols.push('status');
        vals.push(status !== undefined ? status : atuais.status);
      }
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      const insertSql = `INSERT INTO produtos (${cols.join(',')}, data) VALUES (${placeholders}, NOW())${temId ? ' RETURNING id' : ''}`;
      let novoId;
      if (temId) {
        const ins = await client.query(insertSql, vals);
        novoId = ins.rows[0].id;
      } else {
        await client.query(insertSql, vals);
      }
      await client.query(
        'UPDATE produtos_insumos SET produto_codigo=$1 WHERE produto_codigo=$2',
        [codigo, codigoOriginal]
      );
      await client.query('DELETE FROM produtos WHERE codigo=$1', [codigoOriginal]);
      if (temId && novoId !== undefined) {
        await client.query('UPDATE produtos SET id=$1 WHERE id=$2', [atuais.id, novoId]);
        await client.query(
          "SELECT setval('produtos_id_seq', (SELECT GREATEST(MAX(id),1) FROM produtos))"
        );
      }
    } else {
      // Monta consulta dinâmica para atualização sem mudança de código
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
      if (ncmSanitizado !== undefined) {
        query += `, ncm=$${params.length + 1}`;
        params.push(ncmSanitizado);
      }
      if (categoria !== undefined) {
        query += `, categoria=$${params.length + 1}`;
        params.push(categoria);
      }
      if (status !== undefined) {
        query += `, status=$${params.length + 1}`;
        params.push(status);
      }
      query += ` WHERE codigo=$${params.length + 1}::text`;
      params.push(codigoOriginal);

      await client.query(query, params);
    }

    // Processa exclusões
    const { rows: tableCheck } = await client.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='produtos_em_cada_ponto') AS exists"
    );
    const hasPecp = tableCheck[0] && tableCheck[0].exists;
    let produtoId = null;
    if (hasPecp) {
      const idRes = await client
        .query('SELECT id FROM produtos WHERE codigo=$1', [codigoDestino])
        .catch(() => null);
      produtoId = idRes && idRes.rows[0] ? idRes.rows[0].id : null;
    }
    for (const del of (itens.deletados || [])) {
      const resDel = await client.query(
        'DELETE FROM produtos_insumos WHERE id=$1::int RETURNING insumo_id',
        [del.id]
      );
      const insId = resDel.rows[0]?.insumo_id;
      if (hasPecp && produtoId && insId != null) {
        await client.query(
          'DELETE FROM produtos_em_cada_ponto WHERE produto_id=$1 AND ultimo_insumo_id=$2',
          [produtoId, insId]
        );
      }
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
        `INSERT INTO produtos_insumos (produto_codigo, insumo_id, quantidade)
         VALUES ($1,$2,$3)
         ON CONFLICT (produto_codigo, insumo_id)
         DO UPDATE SET quantidade = EXCLUDED.quantidade`,
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

async function listarColecoes() {
  await pool.query('CREATE TABLE IF NOT EXISTS colecao (nome TEXT PRIMARY KEY)');
  const { rows } = await pool.query(
    'SELECT nome FROM colecao UNION SELECT DISTINCT categoria AS nome FROM produtos WHERE categoria IS NOT NULL ORDER BY nome'
  );
  return rows.map(r => r.nome);
}

async function adicionarColecao(nome) {
  await pool.query('CREATE TABLE IF NOT EXISTS colecao (nome TEXT PRIMARY KEY)');
  const res = await pool.query(
    'INSERT INTO colecao (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING RETURNING nome',
    [nome]
  );
  return res.rows[0]?.nome || nome;
}

async function colecaoTemDependencias(nome) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM produtos WHERE categoria=$1 LIMIT 1',
    [nome]
  );
  return rowCount > 0;
}

async function removerColecao(nome) {
  await pool.query('CREATE TABLE IF NOT EXISTS colecao (nome TEXT PRIMARY KEY)');
  const dependente = await colecaoTemDependencias(nome);
  if (dependente) {
    const err = new Error('DEPENDENTE');
    err.code = 'DEPENDENTE';
    throw err;
  }
  await pool.query('DELETE FROM colecao WHERE nome=$1', [nome]);
}

module.exports = {
  listarProdutos,
  listarDetalhesProduto,
  obterProduto,
  listarInsumosProduto,
  listarEtapasProducao,
  listarItensProcessoProduto,
  adicionarEtapaProducao,
  removerEtapaProducao,
  adicionarProduto,
  atualizarProduto,
  excluirProduto,
  inserirLoteProduto,
  atualizarLoteProduto,
  excluirLoteProduto,
  salvarProdutoDetalhado,
  listarColecoes,
  adicionarColecao,
  removerColecao,
  colecaoTemDependencias
};
