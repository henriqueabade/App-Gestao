const express = require('express');
const db = require('./db');

const router = express.Router();

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
        `INSERT INTO orcamento_parcelas (orcamento_id, numero_parcela, valor, data_vencimento, status)
         VALUES ($1,$2,$3,$4,$5)`,
        [orcamentoId, i + 1, p.valor, p.data_vencimento, 'Pendente']
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

module.exports = router;
