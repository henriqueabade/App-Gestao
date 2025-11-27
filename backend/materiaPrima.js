const pool = require('./db');

function aplicarFiltroLocal(lista, filtro) {
  if (!filtro) return lista;
  const normalized = filtro.trim().toLowerCase();

  if (['sim', 's', 'true', 'infinito', 'infinita', '∞'].includes(normalized)) {
    return lista.filter(item => Boolean(item?.infinito));
  }

  if (['nao', 'não', 'n', 'false', 'finito', 'finita'].includes(normalized)) {
    return lista.filter(item => !item?.infinito);
  }

  return lista.filter(item => {
    const alvo = `${item?.nome || ''} ${item?.categoria || ''} ${item?.processo || ''}`.toLowerCase();
    return alvo.includes(normalized);
  });
}

async function listarMaterias(filtro = '') {
  try {
    const materias = await pool.get('/materia_prima');
    const lista = Array.isArray(materias) ? materias : [];
    const filtrada = aplicarFiltroLocal(lista, filtro);
    return filtrada.sort((a, b) => String(a?.nome || '').localeCompare(String(b?.nome || '')));
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

let movimentacoesTablePromise = null;

async function ensureMovimentacoesTable() {
  if (!movimentacoesTablePromise) {
    movimentacoesTablePromise = (async () => {
      try {
        await pool.query(
          `CREATE TABLE IF NOT EXISTS materia_prima_movimentacoes (
            id serial PRIMARY KEY,
            insumo_id integer NOT NULL,
            tipo text NOT NULL,
            quantidade numeric,
            quantidade_anterior numeric,
            quantidade_atual numeric,
            preco_anterior numeric,
            preco_atual numeric,
            usuario_id integer,
            criado_em timestamp WITHOUT TIME ZONE
          )`
        );
      } catch (err) {
        const message = typeof err?.message === 'string' ? err.message : '';
        const isNotSupported = message.includes('Not supported');
        if (isNotSupported) {
          try {
            await pool.query('SELECT 1 FROM materia_prima_movimentacoes LIMIT 1');
            return;
          } catch (inner) {
            throw err;
          }
        }
        throw err;
      }
    })().catch(err => {
      movimentacoesTablePromise = null;
      throw err;
    });
  }
  return movimentacoesTablePromise;
}

async function registrarMovimentacao({
  insumoId,
  tipo,
  quantidadeAlterada = null,
  quantidadeAnterior = null,
  quantidadeAtual = null,
  precoAnterior = null,
  precoAtual = null,
  usuarioId = null
}) {
  if (!insumoId || !tipo) return;
  await ensureMovimentacoesTable();
  try {
    await pool.query(
      `INSERT INTO materia_prima_movimentacoes
        (insumo_id, tipo, quantidade, quantidade_anterior, quantidade_atual,
         preco_anterior, preco_atual, usuario_id, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        insumoId,
        tipo,
        quantidadeAlterada,
        quantidadeAnterior,
        quantidadeAtual,
        precoAnterior,
        precoAtual,
        usuarioId,
        new Date()
      ]
    );
  } catch (err) {
    console.error('Erro ao registrar movimentação de matéria-prima:', err.message);
  }
}

async function registrarEntrada(id, quantidade, usuarioId = null) {
  const { rows: existentes } = await pool.query(
    'SELECT quantidade FROM materia_prima WHERE id=$1',
    [id]
  );
  const quantidadeAnterior = existentes.length ? Number(existentes[0].quantidade) || 0 : 0;
  const res = await pool.query(
    `UPDATE materia_prima SET quantidade = quantidade + $1, data_estoque = NOW()
     WHERE id=$2 RETURNING *`,
    [quantidade, id]
  );
  const materia = res.rows[0] || null;
  if (materia) {
    const quantidadeAtual = Number(materia.quantidade) || 0;
    await registrarMovimentacao({
      insumoId: id,
      tipo: 'entrada',
      quantidadeAlterada: quantidade,
      quantidadeAnterior,
      quantidadeAtual,
      usuarioId
    });
  }
  return materia;
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

async function registrarSaida(id, quantidade, usuarioId = null) {
  const { rows: existentes } = await pool.query(
    'SELECT quantidade FROM materia_prima WHERE id=$1',
    [id]
  );
  const quantidadeAnterior = existentes.length ? Number(existentes[0].quantidade) || 0 : 0;
  const res = await pool.query(
    `UPDATE materia_prima SET quantidade = quantidade - $1, data_estoque = NOW()
     WHERE id=$2 RETURNING *`,
    [quantidade, id]
  );
  const materia = res.rows[0] || null;
  if (materia) {
    const quantidadeAtual = Number(materia.quantidade) || 0;
    await registrarMovimentacao({
      insumoId: id,
      tipo: 'saida',
      quantidadeAlterada: quantidade,
      quantidadeAnterior,
      quantidadeAtual,
      usuarioId
    });
  }
  return materia;
}

async function atualizarPreco(id, preco, usuarioId = null) {
  const { rows: existentes } = await pool.query(
    'SELECT preco_unitario FROM materia_prima WHERE id=$1',
    [id]
  );
  const precoAnterior = existentes.length ? Number(existentes[0].preco_unitario) || 0 : null;
  const res = await pool.query(
    `UPDATE materia_prima SET preco_unitario=$1, data_preco = NOW()
     WHERE id=$2 RETURNING *`,
    [preco, id]
  );
  const materia = res.rows[0] || null;
  if (materia) {
    const precoAtual = Number(materia.preco_unitario) || 0;
    await registrarMovimentacao({
      insumoId: id,
      tipo: 'preco',
      precoAnterior,
      precoAtual,
      usuarioId
    });
  }
  await atualizarProdutosComInsumo(id);
  return materia;
}

async function listarCategorias() {
  const categorias = await pool.get('/categoria', {
    query: { select: 'nome_categoria', order: 'nome_categoria' }
  });
  const lista = Array.isArray(categorias) ? categorias : [];
  return lista.map(r => r.nome_categoria).filter(Boolean);
}

async function listarUnidades() {
  const unidades = await pool.get('/unidades', {
    query: { select: 'tipo', order: 'tipo' }
  });
  const lista = Array.isArray(unidades) ? unidades : [];
  return lista.map(r => r.tipo).filter(Boolean);
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

async function obterMovimentacoesRecentes({ tipos = null, desde = null, limite = null } = {}) {
  await ensureMovimentacoesTable();
  const condicoes = [];
  const valores = [];
  if (Array.isArray(tipos) && tipos.length) {
    valores.push(tipos);
    condicoes.push(`tipo = ANY($${valores.length}::text[])`);
  }
  if (desde instanceof Date) {
    valores.push(desde);
    condicoes.push(`criado_em >= $${valores.length}`);
  }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const limitClause = Number.isInteger(limite) && limite > 0 ? `LIMIT ${limite}` : '';
  const { rows } = await pool.query(
    `SELECT id, insumo_id, tipo, quantidade, quantidade_anterior, quantidade_atual,
            preco_anterior, preco_atual, usuario_id, criado_em
       FROM materia_prima_movimentacoes
       ${where}
       ORDER BY criado_em DESC, id DESC
       ${limitClause}`,
    valores
  );
  return rows;
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
  obterMovimentacoesRecentes,
  removerCategoria,
  removerUnidade,
  categoriaTemDependencias,
  unidadeTemDependencias,
  processoTemDependencias
};
