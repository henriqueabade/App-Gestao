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
    const produtos = await pool.get('/produtos');
    const lotes = await pool.get('/produtos_em_cada_ponto');
    const listaProdutos = Array.isArray(produtos) ? produtos : [];
    const listaLotes = Array.isArray(lotes) ? lotes : [];

    const quantidadesPorProduto = listaLotes.reduce((acc, lote) => {
      const produtoId = lote?.produto_id;
      const atual = Number(acc.get(produtoId) || 0);
      const qtd = Number(lote?.quantidade) || 0;
      acc.set(produtoId, atual + qtd);
      return acc;
    }, new Map());

    return listaProdutos
      .map(produto => ({
        ...produto,
        quantidade_total: quantidadesPorProduto.get(produto?.id) || 0
      }))
      .sort((a, b) => String(a?.nome || '').localeCompare(String(b?.nome || '')));
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

    const produtoFiltro = produtoCodigo
      ? { codigo: `eq.${produtoCodigo}`, limit: 1 }
      : { id: produtoId, limit: 1 };

    const produtos = await pool.get('/produtos', {
      query: { select: '*', ...produtoFiltro }
    });
    const produto = Array.isArray(produtos) ? produtos[0] : null;
    produtoId = produtoId || produto?.id || null;
    produtoCodigo = produtoCodigo || produto?.codigo || null;

    const itensQuery = {
      select:
        'id,produto_codigo,insumo_id,quantidade,ordem_insumo,materia_prima:insumo_id(nome,preco_unitario,unidade,processo)',
      order: 'materia_prima.processo,ordem_insumo'
    };

    if (produtoCodigo) {
      itensQuery.produto_codigo = `eq.${produtoCodigo}`;
    }

    const itens = await pool.get('/produtos_insumos', { query: itensQuery });

    const itensFormatados = (Array.isArray(itens) ? itens : []).map(item => {
      const precoUnitario = Number(item?.materia_prima?.preco_unitario) || 0;
      const quantidade = Number(item?.quantidade) || 0;
      return {
        id: item?.id,
        insumo_id: item?.insumo_id,
        quantidade,
        ordem_insumo: item?.ordem_insumo,
        nome: item?.materia_prima?.nome,
        preco_unitario: precoUnitario,
        unidade: item?.materia_prima?.unidade,
        processo: item?.materia_prima?.processo,
        total: precoUnitario * quantidade
      };
    });

    const lotesQuery = {
      select:
        'id,quantidade,ultimo_insumo_id,tempo_estimado_minutos,data_hora_completa,etapa_id,materia_prima:ultimo_insumo_id(nome)',
      order: 'data_hora_completa.desc'
    };

    if (produtoId) {
      lotesQuery.produto_id = `eq.${produtoId}`;
    }

    if (produtoCodigo) {
      lotesQuery.produto_codigo = `eq.${produtoCodigo}`;
    }

    let lotes = [];
    try {
      lotes = await pool.get('/produtos_em_cada_ponto', { query: lotesQuery });
    } catch (err) {
      console.error('Falha ao carregar lotes do produto, retornando lista vazia:', err?.message || err);
      lotes = [];
    }

    const lotesFormatados = (Array.isArray(lotes) ? lotes : []).map(lote => ({
      id: lote?.id,
      quantidade: lote?.quantidade,
      ultimo_insumo_id: lote?.ultimo_insumo_id,
      ultimo_item: lote?.materia_prima?.nome,
      tempo_estimado_minutos: lote?.tempo_estimado_minutos,
      data_hora_completa: lote?.data_hora_completa,
      etapa: lote?.etapa_id ? String(lote.etapa_id).trim() || '—' : '—'
    }));

    return {
      produto: produto || null,
      itens: itensFormatados,
      lotes: lotesFormatados
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
  const produtos = await pool.get('/produtos', {
    query: { select: '*', codigo: `eq.${codigo}`, limit: 1 }
  });
  return Array.isArray(produtos) ? produtos[0] : null;
}

/**
 * Lista insumos (produtos_insumos + materia_prima) por codigo de produto (text)
 */
async function listarInsumosProduto(codigo) {
  const itens = await pool.get('/produtos_insumos', {
    query: {
      select:
        'id,produto_codigo,insumo_id,quantidade,ordem_insumo,materia_prima:insumo_id(nome,preco_unitario,unidade,processo)',
      produto_codigo: `eq.${codigo}`,
      order: 'materia_prima.processo,ordem_insumo'
    }
  });

  const lista = Array.isArray(itens) ? itens : [];
  return lista.map(item => {
    const precoUnitario = Number(item?.materia_prima?.preco_unitario) || 0;
    const quantidade = Number(item?.quantidade) || 0;
    return {
      id: item?.id,
      nome: item?.materia_prima?.nome,
      quantidade,
      ordem_insumo: item?.ordem_insumo,
      preco_unitario: precoUnitario,
      unidade: item?.materia_prima?.unidade,
      total: precoUnitario * quantidade,
      processo: item?.materia_prima?.processo
    };
  });
}

/**
 * Lista etapas de produção ordenadas pela coluna "ordem".
 */
async function listarEtapasProducao() {
  const etapas = await pool.get('/etapas_producao', {
    query: { select: 'id,nome,ordem', order: 'ordem.asc' }
  });
  return Array.isArray(etapas) ? etapas : [];
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
  const etapaBusca = String(etapa || '').trim().toLowerCase();
  const termoBusca = String(busca || '').trim().toLowerCase();

  const itens = await pool.get('/produtos_insumos', {
    query: {
      select: 'insumo_id,materia_prima:insumo_id(id,nome,processo)',
      produto_codigo: `eq.${codigo}`
    }
  });

  const lista = Array.isArray(itens) ? itens : [];

  const filtrados = lista
    .map(item => item?.materia_prima)
    .filter(mp => mp && (!etapaBusca || String(mp.processo || '').trim().toLowerCase() === etapaBusca))
    .filter(mp => !termoBusca || String(mp.nome || '').toLowerCase().includes(termoBusca));

  const unicoPorId = new Map();
  for (const mp of filtrados) {
    if (!unicoPorId.has(mp.id)) {
      unicoPorId.set(mp.id, { id: mp.id, nome: mp.nome });
    }
  }

  return Array.from(unicoPorId.values()).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
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
        'UPDATE produtos_insumos SET quantidade=$1, ordem_insumo=$2 WHERE id=$3::int',
        [up.quantidade, up.ordem_insumo, up.id]
      );
    }
    // Processa inserções
    for (const ins of (itens.inseridos || [])) {
      await client.query(
        `INSERT INTO produtos_insumos (produto_codigo, insumo_id, quantidade, ordem_insumo)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (produto_codigo, insumo_id)
         DO UPDATE SET quantidade = EXCLUDED.quantidade, ordem_insumo = EXCLUDED.ordem_insumo`,
        [codigoDestino, ins.insumo_id, ins.quantidade, ins.ordem_insumo]
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
  const colecoesPersistidas = await buscarColecoesPersistidas();
  const categoriasProdutos = await buscarCategoriasProdutos();

  const conjunto = new Set();
  for (const nome of [...colecoesPersistidas, ...categoriasProdutos]) {
    if (nome) conjunto.add(nome);
  }

  return [...conjunto].sort((a, b) => a.localeCompare(b));
}

async function adicionarColecao(nome) {
  const nomeNormalizado = (nome || '').trim();
  if (!nomeNormalizado) return '';

  try {
    const res = await pool.post('/colecao', { nome: nomeNormalizado });
    return res?.nome || nomeNormalizado;
  } catch (err) {
    if (err.status === 404) {
      return nomeNormalizado;
    }
    throw err;
  }
}

async function colecaoTemDependencias(nome) {
  const produtos = await pool.get('/produtos', {
    query: { select: 'id', categoria: `eq.${nome}`, limit: 1 }
  });

  return Array.isArray(produtos) && produtos.length > 0;
}

async function removerColecao(nome) {
  const nomeNormalizado = (nome || '').trim();
  if (!nomeNormalizado) return;

  const dependente = await colecaoTemDependencias(nomeNormalizado);
  if (dependente) {
    const err = new Error('DEPENDENTE');
    err.code = 'DEPENDENTE';
    throw err;
  }

  try {
    await pool.delete('/colecao', {
      query: { nome: `eq.${nomeNormalizado}` }
    });
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }
}

async function buscarColecoesPersistidas() {
  try {
    const colecao = await pool.get('/colecao', {
      query: { select: 'nome', order: 'nome' }
    });
    return Array.isArray(colecao) ? colecao.map(c => (c?.nome || '').trim()).filter(Boolean) : [];
  } catch (err) {
    if (err.status === 404) {
      return [];
    }
    throw err;
  }
}

async function buscarCategoriasProdutos() {
  try {
    const produtos = await pool.get('/produtos', {
      query: { select: 'categoria' }
    });
    const categorias = Array.isArray(produtos) ? produtos : [];
    return categorias
      .map(p => (p?.categoria || '').trim())
      .filter(Boolean);
  } catch (err) {
    if (err.status === 404) {
      return [];
    }
    throw err;
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
