const express = require('express');
const pool = require('./db');

const router = express.Router();

// GET /api/clientes/lista
router.get('/lista', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nome_fantasia, cnpj, ent_pais AS pais, ent_uf AS estado, status_cliente, dono_cliente FROM clientes ORDER BY nome_fantasia'
    );
    const clientes = result.rows.map(c => ({
      id: c.id,
      nome_fantasia: c.nome_fantasia,
      cnpj: c.cnpj,
      pais: c.pais || '',
      estado: c.estado || '',
      status_cliente: c.status_cliente,
      dono_cliente: c.dono_cliente
    }));
    res.json(clientes);
  } catch (err) {
    console.error('Erro ao listar clientes:', err);
    res.status(500).json({ error: 'Erro ao listar clientes' });
  }
});

// GET /api/clientes/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const clienteRes = await pool.query('SELECT * FROM clientes WHERE id = $1', [id]);
    if (clienteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }
    const row = clienteRes.rows[0];

    const cliente = {
      id: row.id,
      nome_fantasia: row.nome_fantasia,
      razao_social: row.razao_social,
      cnpj: row.cnpj,
      inscricao_estadual: row.inscricao_estadual,
      site: row.site,
      comprador_nome: row.comprador_nome,
      telefone_fixo: row.telefone_fixo,
      telefone_celular: row.telefone_celular,
      email: row.email,
      transportadora: row.transportadora,
      endereco_registro: {
        rua: row.reg_logradouro,
        numero: row.reg_numero,
        complemento: row.reg_complemento,
        bairro: row.reg_bairro,
        cidade: row.reg_cidade,
        pais: row.reg_pais,
        estado: row.reg_uf,
        cep: row.reg_cep
      },
      endereco_cobranca: {
        rua: row.cob_logradouro,
        numero: row.cob_numero,
        complemento: row.cob_complemento,
        bairro: row.cob_bairro,
        cidade: row.cob_cidade,
        pais: row.cob_pais,
        estado: row.cob_uf,
        cep: row.cob_cep
      },
      endereco_entrega: {
        rua: row.ent_logradouro,
        numero: row.ent_numero,
        complemento: row.ent_complemento,
        bairro: row.ent_bairro,
        cidade: row.ent_cidade,
        pais: row.ent_pais,
        estado: row.ent_uf,
        cep: row.ent_cep
      },
      status_cliente: row.status_cliente,
      dono_cliente: row.dono_cliente,
      origem_captacao: row.origem_captacao,
      anotacoes: row.anotacoes
    };

    let contatos = [];
    let contratos = [];
    let notas = [];
    try {
      // contatos_cliente relaciona contatos cadastrados com cada empresa
      const r = await pool.query(
        'SELECT id, id_cliente, nome, cargo, telefone_celular, telefone_fixo, email\n' +
        '  FROM contatos_cliente WHERE id_cliente = $1 ORDER BY nome',
        [id]
      );
      contatos = r.rows;
    } catch (_) {}
    try {
      const r = await pool.query('SELECT * FROM contratos WHERE cliente_id = $1', [id]);
      contratos = r.rows;
    } catch (_) {}
    try {
      const r = await pool.query('SELECT * FROM cliente_notas WHERE cliente_id = $1 ORDER BY data DESC', [id]);
      notas = r.rows;
    } catch (_) {}

    res.json({ cliente, contatos, contratos, notas });
  } catch (err) {
    console.error('Erro ao buscar cliente:', err);
    res.status(500).json({ error: 'Erro ao buscar cliente' });
  }
});

// GET /api/clientes/:id/resumo
router.get('/:id/resumo', async (req, res) => {
  const { id } = req.params;
  try {
    const clienteRes = await pool.query('SELECT * FROM clientes WHERE id = $1', [id]);
    if (clienteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    const row = clienteRes.rows[0];

    function formatEndereco(prefix) {
      const logradouro = row[`${prefix}_logradouro`] || '';
      const numero = row[`${prefix}_numero`] || '';
      const complemento = row[`${prefix}_complemento`];
      const bairro = row[`${prefix}_bairro`] || '';
      const cidade = row[`${prefix}_cidade`] || '';
      const uf = row[`${prefix}_uf`] || '';
      const cep = row[`${prefix}_cep`] || '';
      const pais = row[`${prefix}_pais`] || '';

      return (
        `${logradouro}, ${numero}` +
        (complemento ? ` - ${complemento}` : '') +
        `, ${bairro} - ${cidade}/${uf} - ${cep}` + (pais ? ` - ${pais}` : '')
      );
    }

    function enderecoIgual(aPrefix, bPrefix) {
      const fields = ['logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep', 'pais'];
      return fields.every((f) => row[`${aPrefix}_${f}`] === row[`${bPrefix}_${f}`]);
    }

    const entrega = formatEndereco('ent');
    const cobranca = enderecoIgual('cob', 'ent') ? 'Igual Entrega' : formatEndereco('cob');
    const registro = enderecoIgual('reg', 'ent') ? 'Igual Entrega' : formatEndereco('reg');

    const contatosRes = await pool.query(
      'SELECT id_cliente, nome, telefone_fixo, telefone_celular, email FROM contatos_cliente WHERE id_cliente = $1 ORDER BY nome',
      [id]
    );

    res.json({
      nome_fantasia: row.nome_fantasia,
      razao_social: row.razao_social,
      cnpj: row.cnpj,
      inscricao_estadual: row.inscricao_estadual,
      endereco_entrega: entrega,
      endereco_faturamento: cobranca,
      endereco_registro: registro,
      contatos: contatosRes.rows
    });
  } catch (err) {
    console.error('Erro ao buscar resumo do cliente:', err);
    res.status(500).json({ error: 'Erro ao buscar resumo do cliente' });
  }
});

router.post('/', async (req, res) => {
  const cli = req.body || {};
  const values = [
    cli.razao_social,
    cli.nome_fantasia,
    cli.cnpj,
    cli.inscricao_estadual,
    cli.site,
    cli.endereco_registro?.pais,
    cli.endereco_registro?.rua,
    cli.endereco_registro?.numero,
    cli.endereco_registro?.complemento,
    cli.endereco_registro?.bairro,
    cli.endereco_registro?.cidade,
    cli.endereco_registro?.estado,
    cli.endereco_registro?.cep,
    cli.endereco_cobranca?.pais,
    cli.endereco_cobranca?.rua,
    cli.endereco_cobranca?.numero,
    cli.endereco_cobranca?.complemento,
    cli.endereco_cobranca?.bairro,
    cli.endereco_cobranca?.cidade,
    cli.endereco_cobranca?.estado,
    cli.endereco_cobranca?.cep,
    cli.endereco_entrega?.pais,
    cli.endereco_entrega?.rua,
    cli.endereco_entrega?.numero,
    cli.endereco_entrega?.complemento,
    cli.endereco_entrega?.bairro,
    cli.endereco_entrega?.cidade,
    cli.endereco_entrega?.estado,
    cli.endereco_entrega?.cep,
    cli.anotacoes,
    cli.status_cliente,
    cli.dono_cliente,
    cli.origem_captacao
  ];
  try {
    const dupCheck = await pool.query('SELECT id FROM clientes WHERE cnpj = $1', [cli.cnpj]);
    if (dupCheck.rows.length) {
      return res.status(409).json({ error: 'Cliente já registrado' });
    }
    const insertRes = await pool.query(
      `INSERT INTO clientes (
        razao_social, nome_fantasia, cnpj, inscricao_estadual, site,
        reg_pais, reg_logradouro, reg_numero, reg_complemento, reg_bairro, reg_cidade, reg_uf, reg_cep,
        cob_pais, cob_logradouro, cob_numero, cob_complemento, cob_bairro, cob_cidade, cob_uf, cob_cep,
        ent_pais, ent_logradouro, ent_numero, ent_complemento, ent_bairro, ent_cidade, ent_uf, ent_cep,
        anotacoes, status_cliente, dono_cliente, origem_captacao
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
      ) RETURNING id`,
      values
    );
    const clienteId = insertRes.rows[0].id;
    const contatos = Array.isArray(cli.contatos) ? cli.contatos : [];
    for(const ct of contatos){
      await pool.query(
        'INSERT INTO contatos_cliente (id_cliente, nome, cargo, telefone_celular, telefone_fixo, email) VALUES ($1,$2,$3,$4,$5,$6)',
        [clienteId, ct.nome, ct.cargo, ct.telefone_celular, ct.telefone_fixo, ct.email]
      );
    }
    res.json({ id: clienteId });
  } catch(err){
    console.error('Erro ao criar cliente:', err);
    res.status(500).json({ error: 'Erro ao criar cliente' });
  }
});

// PUT /api/clientes/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const cli = req.body || {};
  const values = [
    cli.razao_social,
    cli.nome_fantasia,
    cli.cnpj,
    cli.inscricao_estadual,
    cli.site,
    cli.endereco_registro?.pais,
    cli.endereco_registro?.rua,
    cli.endereco_registro?.numero,
    cli.endereco_registro?.complemento,
    cli.endereco_registro?.bairro,
    cli.endereco_registro?.cidade,
    cli.endereco_registro?.estado,
    cli.endereco_registro?.cep,
    cli.endereco_cobranca?.pais,
    cli.endereco_cobranca?.rua,
    cli.endereco_cobranca?.numero,
    cli.endereco_cobranca?.complemento,
    cli.endereco_cobranca?.bairro,
    cli.endereco_cobranca?.cidade,
    cli.endereco_cobranca?.estado,
    cli.endereco_cobranca?.cep,
    cli.endereco_entrega?.pais,
    cli.endereco_entrega?.rua,
    cli.endereco_entrega?.numero,
    cli.endereco_entrega?.complemento,
    cli.endereco_entrega?.bairro,
    cli.endereco_entrega?.cidade,
    cli.endereco_entrega?.estado,
    cli.endereco_entrega?.cep,
    cli.anotacoes,
    cli.status_cliente,
    cli.dono_cliente,
    cli.origem_captacao,
    id
  ];
  try {
    await pool.query(
      `UPDATE clientes SET
        razao_social = $1,
        nome_fantasia = $2,
        cnpj = $3,
        inscricao_estadual = $4,
        site = $5,
        reg_pais = $6,
        reg_logradouro = $7,
        reg_numero = $8,
        reg_complemento = $9,
        reg_bairro = $10,
        reg_cidade = $11,
        reg_uf = $12,
        reg_cep = $13,
        cob_pais = $14,
        cob_logradouro = $15,
        cob_numero = $16,
        cob_complemento = $17,
        cob_bairro = $18,
        cob_cidade = $19,
        cob_uf = $20,
        cob_cep = $21,
        ent_pais = $22,
        ent_logradouro = $23,
        ent_numero = $24,
        ent_complemento = $25,
        ent_bairro = $26,
        ent_cidade = $27,
        ent_uf = $28,
        ent_cep = $29,
        anotacoes = $30,
        status_cliente = $31,
        dono_cliente = $32,
        origem_captacao = $33
       WHERE id = $34`,
      values
    );
    const contatos = Array.isArray(cli.contatos) ? cli.contatos : [];
    for(const ct of contatos){
      await pool.query(
        'INSERT INTO contatos_cliente (id_cliente, nome, cargo, telefone_celular, telefone_fixo, email) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, ct.nome, ct.cargo, ct.telefone_celular, ct.telefone_fixo, ct.email]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar cliente:', err);
    res.status(500).json({ error: 'Erro ao atualizar cliente' });
  }
});

// DELETE /api/clientes/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const orcRes = await pool.query('SELECT 1 FROM orcamentos WHERE cliente_id = $1 LIMIT 1', [id]);
    if (orcRes.rows.length) {
      return res.status(400).json({ error: 'Não é possível excluir: cliente possui orçamentos vinculados' });
    }

    await pool.query('BEGIN');
    await pool.query('DELETE FROM contatos_cliente WHERE id_cliente = $1', [id]);
    await pool.query('DELETE FROM contratos WHERE cliente_id = $1', [id]);
    await pool.query('DELETE FROM cliente_notas WHERE cliente_id = $1', [id]);
    await pool.query('DELETE FROM clientes WHERE id = $1', [id]);
    await pool.query('COMMIT');

    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('Erro ao excluir cliente:', err);
    res.status(500).json({ error: 'Erro ao excluir cliente' });
  }
});

module.exports = router;
