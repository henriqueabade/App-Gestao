const express = require('express');
const pool = require('./db');

const router = express.Router();

// GET /api/clientes/lista
// The database now stores address fields in individual columns (ent_uf, reg_uf,
// etc.).  Keep the utility for backwards compatibility but simply return the
// value when it's already a 2-letter state.
function extractUF(endereco) {
  if (!endereco) return '';
  if (typeof endereco === 'string' && endereco.length === 2) return endereco.toUpperCase();
  const regex = /,\s*([A-Za-z]{2})\s*,\s*CEP/i;
  const match = endereco.match(regex);
  const validUF = [
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
    'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
  ];
  if (match) {
    const uf = match[1].toUpperCase();
    return validUF.includes(uf) ? uf : '';
  }
  const beforeCep = endereco.split(/CEP/i)[0];
  const parts = beforeCep.split(',').map(p => p.trim()).filter(Boolean);
  const ufCandidate = parts[parts.length - 1]?.toUpperCase();
  return validUF.includes(ufCandidate) ? ufCandidate : '';
}

router.get('/lista', async (_req, res) => {
  try {
    // 'ent_uf' holds the two letter state for the delivery address
    const result = await pool.query(
      'SELECT id, nome_fantasia, cnpj, ent_uf, status_cliente, dono_cliente FROM clientes ORDER BY nome_fantasia'
    );
    const clientes = result.rows.map(c => ({
      id: c.id,
      nome_fantasia: c.nome_fantasia,
      cnpj: c.cnpj,
      estado: extractUF(c.ent_uf) || 'Unidentified State',
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
        estado: row.reg_uf,
        cep: row.reg_cep
      },
      endereco_cobranca: {
        rua: row.cob_logradouro,
        numero: row.cob_numero,
        complemento: row.cob_complemento,
        bairro: row.cob_bairro,
        cidade: row.cob_cidade,
        estado: row.cob_uf,
        cep: row.cob_cep
      },
      endereco_entrega: {
        rua: row.ent_logradouro,
        numero: row.ent_numero,
        complemento: row.ent_complemento,
        bairro: row.ent_bairro,
        cidade: row.ent_cidade,
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

module.exports = router;
