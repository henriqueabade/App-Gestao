const express = require('express');
const db = require('./db');

const router = express.Router();

// Lista todos os orçamentos
router.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT o.id, o.numero, c.nome_fantasia AS cliente, to_char(o.data_emissao,'DD/MM/YYYY') AS data_emissao,
              o.valor_final, o.parcelas, o.situacao
         FROM orcamentos o
         LEFT JOIN clientes c ON c.id = o.cliente_id
        ORDER BY o.id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar orçamentos:', err);
    res.status(500).json({ error: 'Erro ao listar orçamentos' });
  }
});

// Obtém um orçamento específico com itens e parcelas
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  try {
    const { rows } = await client.query('SELECT * FROM orcamentos WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Orçamento não encontrado' });
    const orcamento = rows[0];
    const { rows: itens } = await client.query('SELECT * FROM orcamentos_itens WHERE orcamento_id=$1', [id]);
    const { rows: parcelas } = await client.query(
      'SELECT * FROM orcamento_parcelas WHERE orcamento_id=$1 ORDER BY numero_parcela',
      [id]
    );
    orcamento.itens = itens;
    orcamento.parcelas = parcelas;
    res.json(orcamento);
  } catch (err) {
    console.error('Erro ao buscar orçamento:', err);
    res.status(500).json({ error: 'Erro ao buscar orçamento' });
  } finally {
    client.release();
  }
});

router.post('/', async (req, res) => {
  const {
    cliente_id,
    contato_id,
    situacao,
    parcelas,
    forma_pagamento,
    transportadora,
    desconto_pagamento,
    desconto_especial,
    desconto_total,
    valor_final,
    observacoes,
    validade,
    prazo,
    itens = [],
    parcelas_detalhes = []
  } = req.body;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: last } = await client.query('SELECT numero FROM orcamentos ORDER BY id DESC LIMIT 1');
    let numero = 'ORC1';
    if (last.length) {
      const seq = parseInt(String(last[0].numero).replace(/\D/g, ''), 10) + 1;
      numero = `ORC${seq}`;
    }
    const now = new Date();
    const insertOrc = await client.query(
      `INSERT INTO orcamentos (numero, cliente_id, contato_id, data_emissao, situacao, parcelas, forma_pagamento, transportadora, desconto_pagamento, desconto_especial, desconto_total, valor_final, observacoes, validade, prazo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [
        numero,
        cliente_id,
        contato_id,
        now,
        situacao,
        parcelas,
        forma_pagamento,
        transportadora,
        desconto_pagamento,
        desconto_especial,
        desconto_total,
        valor_final,
        observacoes,
        validade,
        prazo
      ]
    );
    const orcamentoId = insertOrc.rows[0].id;

    for (const item of itens) {
      await client.query(
        `INSERT INTO orcamentos_itens (orcamento_id, produto_id, codigo, nome, ncm, quantidade, valor_unitario, valor_unitario_desc, valor_desc, desconto_total, valor_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          orcamentoId,
          item.produto_id,
          item.codigo,
          item.nome,
          item.ncm,
          item.quantidade,
          item.valor_unitario,
          item.valor_unitario_desc,
          item.valor_desc,
          item.desconto_total,
          item.valor_total
        ]
      );
    }

    for (let i = 0; i < parcelas_detalhes.length; i++) {
      const p = parcelas_detalhes[i];
      await client.query(
        `INSERT INTO orcamento_parcelas (orcamento_id, numero_parcela, valor, data_vencimento)
        VALUES ($1,$2,$3,$4)`,
        [orcamentoId, i + 1, p.valor, p.data_vencimento]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, numero });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao salvar orçamento:', err);
    res.status(500).json({ error: 'Erro ao salvar orçamento' });
  } finally {
    client.release();
  }
});

// Atualiza um orçamento existente
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    cliente_id,
    contato_id,
    situacao,
    parcelas,
    forma_pagamento,
    transportadora,
    desconto_pagamento,
    desconto_especial,
    desconto_total,
    valor_final,
    observacoes,
    validade,
    prazo,
    itens = [],
    parcelas_detalhes = []
  } = req.body;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE orcamentos SET cliente_id=$1, contato_id=$2, situacao=$3, parcelas=$4, forma_pagamento=$5,
       transportadora=$6, desconto_pagamento=$7, desconto_especial=$8, desconto_total=$9, valor_final=$10,
       observacoes=$11, validade=$12, prazo=$13 WHERE id=$14`,
      [
        cliente_id,
        contato_id,
        situacao,
        parcelas,
        forma_pagamento,
        transportadora,
        desconto_pagamento,
        desconto_especial,
        desconto_total,
        valor_final,
        observacoes,
        validade,
        prazo,
        id
      ]
    );

    await client.query('DELETE FROM orcamentos_itens WHERE orcamento_id=$1', [id]);
    for (const item of itens) {
      await client.query(
        `INSERT INTO orcamentos_itens (orcamento_id, produto_id, codigo, nome, ncm, quantidade, valor_unitario, valor_unitario_desc, valor_desc, desconto_total, valor_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          item.produto_id,
          item.codigo,
          item.nome,
          item.ncm,
          item.quantidade,
          item.valor_unitario,
          item.valor_unitario_desc,
          item.valor_desc,
          item.desconto_total,
          item.valor_total
        ]
      );
    }

    await client.query('DELETE FROM orcamento_parcelas WHERE orcamento_id=$1', [id]);
    for (let i = 0; i < parcelas_detalhes.length; i++) {
      const p = parcelas_detalhes[i];
      await client.query(
        `INSERT INTO orcamento_parcelas (orcamento_id, numero_parcela, valor, data_vencimento, status)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, i + 1, p.valor, p.data_vencimento, 'Pendente']
      );
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao atualizar orçamento:', err);
    res.status(500).json({ error: 'Erro ao atualizar orçamento' });
  } finally {
    client.release();
  }
});

// Clona um orçamento existente
router.post('/:id/clone', async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM orcamentos WHERE id=$1', [id]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orçamento não encontrado' });
    }
    const orc = rows[0];

    const { rows: last } = await client.query('SELECT numero FROM orcamentos ORDER BY id DESC LIMIT 1');
    let numero = 'ORC1';
    if (last.length) {
      const seq = parseInt(String(last[0].numero).replace(/\D/g, ''), 10) + 1;
      numero = `ORC${seq}`;
    }

    const insert = await client.query(
      `INSERT INTO orcamentos (numero, cliente_id, contato_id, data_emissao, situacao, parcelas, forma_pagamento, transportadora,
       desconto_pagamento, desconto_especial, desconto_total, valor_final, observacoes, validade, prazo)
       VALUES ($1,$2,$3,NOW(),'Rascunho',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        numero,
        orc.cliente_id,
        orc.contato_id,
        orc.parcelas,
        orc.forma_pagamento,
        orc.transportadora,
        orc.desconto_pagamento,
        orc.desconto_especial,
        orc.desconto_total,
        orc.valor_final,
        orc.observacoes,
        orc.validade,
        orc.prazo
      ]
    );
    const newId = insert.rows[0].id;

    const { rows: itens } = await client.query(
      'SELECT produto_id, codigo, nome, ncm, quantidade, valor_unitario, valor_unitario_desc, valor_desc, desconto_total, valor_total FROM orcamentos_itens WHERE orcamento_id=$1',
      [id]
    );
    for (const item of itens) {
      await client.query(
        `INSERT INTO orcamentos_itens (orcamento_id, produto_id, codigo, nome, ncm, quantidade, valor_unitario, valor_unitario_desc, valor_desc, desconto_total, valor_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          newId,
          item.produto_id,
          item.codigo,
          item.nome,
          item.ncm,
          item.quantidade,
          item.valor_unitario,
          item.valor_unitario_desc,
          item.valor_desc,
          item.desconto_total,
          item.valor_total
        ]
      );
    }

    const { rows: parcelas } = await client.query(
      'SELECT numero_parcela, valor, data_vencimento FROM orcamento_parcelas WHERE orcamento_id=$1',
      [id]
    );
    for (const p of parcelas) {
      await client.query(
        `INSERT INTO orcamento_parcelas (orcamento_id, numero_parcela, valor, data_vencimento, status)
         VALUES ($1,$2,$3,$4,'Pendente')`,
        [newId, p.numero_parcela, p.valor, p.data_vencimento]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, id: newId, numero });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao clonar orçamento:', err);
    res.status(500).json({ error: 'Erro ao clonar orçamento' });
  } finally {
    client.release();
  }
});

module.exports = router;
