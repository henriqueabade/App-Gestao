const express = require('express');
const db = require('./db');

const router = express.Router();

async function converterParaPedido(orcamentoId) {
  try {
    const { rows } = await db.query('SELECT * FROM orcamentos WHERE id=$1', [orcamentoId]);
    if (!rows.length) return;
    const o = rows[0];
    const insertPedido = await db.query(
      `INSERT INTO pedidos (numero, cliente_id, contato_id, data_emissao, situacao, parcelas, tipo_parcela, forma_pagamento, transportadora, desconto_pagamento, desconto_especial, desconto_total, valor_final, observacoes, validade, prazo, dono, data_aprovacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [
        o.numero,
        o.cliente_id,
        o.contato_id,
        o.data_emissao,
        'Rascunho',
        o.parcelas,
        o.tipo_parcela,
        o.forma_pagamento,
        o.transportadora,
        o.desconto_pagamento,
        o.desconto_especial,
        o.desconto_total,
        o.valor_final,
        o.observacoes,
        o.validade,
        o.prazo,
        o.dono,
        o.data_aprovacao
      ]
    );
    const pedidoId = insertPedido.rows[0].id;
    await db.query(
      `INSERT INTO pedidos_itens (pedido_id, produto_id, codigo, nome, ncm, quantidade, valor_unitario, valor_unitario_desc, desconto_pagamento, desconto_pagamento_prc, desconto_especial, desconto_especial_prc, valor_desc, desconto_total, valor_total)
       SELECT $1, produto_id, codigo, nome, ncm, quantidade, valor_unitario, valor_unitario_desc, desconto_pagamento, desconto_pagamento_prc, desconto_especial, desconto_especial_prc, valor_desc, desconto_total, valor_total FROM orcamentos_itens WHERE orcamento_id=$2`,
      [pedidoId, orcamentoId]
    );
    await db.query(
      `INSERT INTO pedido_parcelas (pedido_id, numero_parcela, valor, data_vencimento)
       SELECT $1, numero_parcela, valor, data_vencimento FROM orcamento_parcelas WHERE orcamento_id=$2`,
      [pedidoId, orcamentoId]
    );
  } catch (err) {
    console.error('Erro ao converter orçamento para pedido:', err);
  }
}

// Lista todos os orçamentos
router.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT o.id, o.numero, c.nome_fantasia AS cliente, to_char(o.data_emissao,'DD/MM/YYYY') AS data_emissao,
              o.valor_final, o.parcelas, o.situacao, o.dono
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
    orcamento.parcelas_detalhes = parcelas;
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
    tipo_parcela,
    forma_pagamento,
    transportadora,
    desconto_pagamento,
    desconto_especial,
    desconto_total,
    valor_final,
    observacoes,
    validade,
    prazo,
    dono,
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
      `INSERT INTO orcamentos (numero, cliente_id, contato_id, data_emissao, situacao, parcelas, tipo_parcela, forma_pagamento, transportadora, desconto_pagamento, desconto_especial, desconto_total, valor_final, observacoes, validade, prazo, dono)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [
        numero,
        cliente_id,
        contato_id,
        now,
        situacao,
        parcelas,
        tipo_parcela,
        forma_pagamento,
        transportadora,
        desconto_pagamento,
        desconto_especial,
        desconto_total,
        valor_final,
        observacoes,
        validade,
        prazo,
        dono
      ]
    );
    const orcamentoId = insertOrc.rows[0].id;

    for (const item of itens) {
      await client.query(
        `INSERT INTO orcamentos_itens (orcamento_id, produto_id, codigo, nome, ncm, quantidade, valor_unitario, valor_unitario_desc, desconto_pagamento, desconto_pagamento_prc, desconto_especial, desconto_especial_prc, valor_desc, desconto_total, valor_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          orcamentoId,
          item.produto_id,
          item.codigo,
          item.nome,
          item.ncm,
          item.quantidade,
          item.valor_unitario,
          item.valor_unitario_desc,
          item.desconto_pagamento,
          item.desconto_pagamento_prc,
          item.desconto_especial,
          item.desconto_especial_prc,
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
    tipo_parcela,
    forma_pagamento,
    transportadora,
    desconto_pagamento,
    desconto_especial,
    desconto_total,
    valor_final,
    observacoes,
    validade,
    prazo,
    dono,
    itens = [],
    parcelas_detalhes = []
  } = req.body;

  const client = await db.connect();
  try {
    // Calcule o valor de data_aprovacao
    let data_aprovacao_valor = null;
    const situacoesComData = ['Aprovado', 'Rejeitado', 'Expirado'];
    if (situacoesComData.includes(situacao)) {
      data_aprovacao_valor = new Date(); // ou outra forma de pegar a data atual
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE orcamentos SET cliente_id=$1, contato_id=$2, situacao=$3, parcelas=$4, tipo_parcela=$5, forma_pagamento=$6,
      transportadora=$7, desconto_pagamento=$8, desconto_especial=$9, desconto_total=$10, valor_final=$11,
      observacoes=$12, validade=$13, prazo=$14, dono=$15, data_aprovacao=$16
      WHERE id=$17`,
      [
        cliente_id,
        contato_id,
        situacao,
        parcelas,
        tipo_parcela,
        forma_pagamento,
        transportadora,
        desconto_pagamento,
        desconto_especial,
        desconto_total,
        valor_final,
        observacoes,
        validade,
        prazo,
        dono,
        data_aprovacao_valor,
        id
      ]
    );
      await client.query('DELETE FROM orcamentos_itens WHERE orcamento_id=$1', [id]);
      for (const item of itens) {
        await client.query(
          `INSERT INTO orcamentos_itens (orcamento_id, produto_id, codigo, nome, ncm, quantidade, valor_unitario, valor_unitario_desc, desconto_pagamento, desconto_pagamento_prc, desconto_especial, desconto_especial_prc, valor_desc, desconto_total, valor_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            id,
            item.produto_id,
            item.codigo,
            item.nome,
            item.ncm,
            item.quantidade,
            item.valor_unitario,
            item.valor_unitario_desc,
            item.desconto_pagamento,
            item.desconto_pagamento_prc,
            item.desconto_especial,
            item.desconto_especial_prc,
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
        `INSERT INTO orcamento_parcelas (orcamento_id, numero_parcela, valor, data_vencimento)
         VALUES ($1,$2,$3,$4)`,
        [id, i + 1, p.valor, p.data_vencimento]
      );
    }

    await client.query('COMMIT');
    if (situacao === 'Aprovado') await converterParaPedido(id);
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao atualizar orçamento:', err);
    res.status(500).json({ error: 'Erro ao atualizar orçamento' });
  } finally {
    client.release();
  }
});

// Atualiza apenas o status de um orçamento
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { situacao } = req.body;
  try {
    await db.query(
      `UPDATE orcamentos SET situacao=$1, data_aprovacao = CASE WHEN $1 IN ('Aprovado','Rejeitado','Expirado') THEN NOW() ELSE NULL END WHERE id=$2`,
      [situacao, id]
    );
    if (situacao === 'Aprovado') await converterParaPedido(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar status do orçamento:', err);
    res.status(500).json({ error: 'Erro ao atualizar status do orçamento' });
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
      `INSERT INTO orcamentos (numero, cliente_id, contato_id, data_emissao, situacao, parcelas, tipo_parcela, forma_pagamento, transportadora,
       desconto_pagamento, desconto_especial, desconto_total, valor_final, observacoes, validade, prazo, dono)
       VALUES ($1,$2,$3,NOW(),'Rascunho',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [
        numero,
        orc.cliente_id,
        orc.contato_id,
        orc.parcelas,
        orc.tipo_parcela,
        orc.forma_pagamento,
        orc.transportadora,
        orc.desconto_pagamento,
        orc.desconto_especial,
        orc.desconto_total,
        orc.valor_final,
        orc.observacoes,
        orc.validade,
        orc.prazo,
        orc.dono
      ]
    );
    const newId = insert.rows[0].id;
      const { rows: itens } = await client.query(
        'SELECT produto_id, codigo, nome, ncm, quantidade, valor_unitario, valor_unitario_desc, desconto_pagamento, desconto_pagamento_prc, desconto_especial, desconto_especial_prc, valor_desc, desconto_total, valor_total FROM orcamentos_itens WHERE orcamento_id=$1',
        [id]
      );
      for (const item of itens) {
        await client.query(
          `INSERT INTO orcamentos_itens (orcamento_id, produto_id, codigo, nome, ncm, quantidade, valor_unitario, valor_unitario_desc, desconto_pagamento, desconto_pagamento_prc, desconto_especial, desconto_especial_prc, valor_desc, desconto_total, valor_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            newId,
            item.produto_id,
            item.codigo,
            item.nome,
            item.ncm,
            item.quantidade,
            item.valor_unitario,
            item.valor_unitario_desc,
            item.desconto_pagamento,
            item.desconto_pagamento_prc,
            item.desconto_especial,
            item.desconto_especial_prc,
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
        `INSERT INTO orcamento_parcelas (orcamento_id, numero_parcela, valor, data_vencimento)
         VALUES ($1,$2,$3,$4)`,
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
