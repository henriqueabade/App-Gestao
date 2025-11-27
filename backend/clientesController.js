const express = require('express');
const { createApiClient } = require('./apiHttpClient');

const router = express.Router();

function mapClienteBasico(row = {}) {
  return {
    id: row.id,
    nome_fantasia: row.nome_fantasia,
    cnpj: row.cnpj,
    pais: row.ent_pais || row.pais || '',
    estado: row.ent_uf || row.estado || '',
    status_cliente: row.status_cliente,
    dono_cliente: row.dono_cliente
  };
}

function mapClienteCompleto(row = {}) {
  return {
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
}

function buildPayload(cli = {}) {
  return {
    razao_social: cli.razao_social,
    nome_fantasia: cli.nome_fantasia,
    cnpj: cli.cnpj,
    inscricao_estadual: cli.inscricao_estadual,
    site: cli.site,
    reg_pais: cli.endereco_registro?.pais,
    reg_logradouro: cli.endereco_registro?.rua,
    reg_numero: cli.endereco_registro?.numero,
    reg_complemento: cli.endereco_registro?.complemento,
    reg_bairro: cli.endereco_registro?.bairro,
    reg_cidade: cli.endereco_registro?.cidade,
    reg_uf: cli.endereco_registro?.estado,
    reg_cep: cli.endereco_registro?.cep,
    cob_pais: cli.endereco_cobranca?.pais,
    cob_logradouro: cli.endereco_cobranca?.rua,
    cob_numero: cli.endereco_cobranca?.numero,
    cob_complemento: cli.endereco_cobranca?.complemento,
    cob_bairro: cli.endereco_cobranca?.bairro,
    cob_cidade: cli.endereco_cobranca?.cidade,
    cob_uf: cli.endereco_cobranca?.estado,
    cob_cep: cli.endereco_cobranca?.cep,
    ent_pais: cli.endereco_entrega?.pais,
    ent_logradouro: cli.endereco_entrega?.rua,
    ent_numero: cli.endereco_entrega?.numero,
    ent_complemento: cli.endereco_entrega?.complemento,
    ent_bairro: cli.endereco_entrega?.bairro,
    ent_cidade: cli.endereco_entrega?.cidade,
    ent_uf: cli.endereco_entrega?.estado,
    ent_cep: cli.endereco_entrega?.cep,
    anotacoes: cli.anotacoes,
    status_cliente: cli.status_cliente,
    dono_cliente: cli.dono_cliente,
    origem_captacao: cli.origem_captacao
  };
}

router.get('/lista', async (req, res) => {
  try {
    const api = createApiClient(req);
    const clientes = await api.get('/api/clientes');

    res.json(Array.isArray(clientes) ? clientes.map(mapClienteBasico) : []);
  } catch (err) {
    console.error('Erro ao listar clientes:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar clientes' });
  }
});

router.get('/contatos', async (req, res) => {
  try {
    const api = createApiClient(req);
    const [contatos, clientes] = await Promise.all([
      api.get('/api/contatos_cliente', { query: { order: 'nome' } }),
      api.get('/api/clientes', { query: { select: 'id,nome_fantasia,dono_cliente,status_cliente' } })
    ]);

    const clienteMap = new Map((clientes || []).map((c) => [c.id, c]));
    const resposta = Array.isArray(contatos)
      ? contatos.map((row) => {
          const cliente = clienteMap.get(row.id_cliente) || {};
          return {
            id: row.id,
            id_cliente: row.id_cliente,
            nome: row.nome,
            cargo: row.cargo,
            telefone_celular: row.telefone_celular,
            telefone_fixo: row.telefone_fixo,
            email: row.email,
            cliente: cliente.nome_fantasia,
            dono: cliente.dono_cliente,
            status_cliente: cliente.status_cliente
          };
        })
      : [];

    res.json(resposta);
  } catch (err) {
    console.error('Erro ao listar contatos dos clientes:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar contatos dos clientes' });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const cliente = await api.get(`/api/clientes/${id}`);
    if (!cliente || cliente.error === 'Not found') {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    let contatos = [];
    let contratos = [];
    let notas = [];
    try {
      contatos = await api.get('/api/contatos_cliente', {
        query: { cliente_id: id, order: 'nome' }
      });
    } catch (_) {}
    try {
      contratos = await api.get('/api/contratos', { query: { cliente_id: id } });
    } catch (_) {}
    try {
      notas = await api.get('/api/cliente_notas', { query: { cliente_id: id, order: 'data.desc' } });
    } catch (_) {}

    res.json({
      cliente: mapClienteCompleto(cliente),
      contatos: contatos || [],
      contratos: contratos || [],
      notas: notas || []
    });
  } catch (err) {
    console.error('Erro ao buscar cliente:', err);
    res.status(err.status || 500).json({ error: 'Erro ao buscar cliente' });
  }
});

router.get('/:id/resumo', async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const row = await api.get(`/api/clientes/${id}`);
    if (!row || row.error === 'Not found') {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

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

    const contatosRes = await api.get('/api/contatos_cliente', {
      query: { cliente_id: id, order: 'nome' }
    });

    res.json({
      nome_fantasia: row.nome_fantasia,
      razao_social: row.razao_social,
      cnpj: row.cnpj,
      inscricao_estadual: row.inscricao_estadual,
      comprador_nome: row.comprador_nome,
      telefone_fixo: row.telefone_fixo,
      telefone_celular: row.telefone_celular,
      email: row.email,
      endereco_entrega: entrega,
      endereco_faturamento: cobranca,
      endereco_registro: registro,
      anotacoes: row.anotacoes,
      status_cliente: row.status_cliente,
      contatos: (contatosRes || []).map((c) => ({
        nome: c.nome,
        telefone_fixo: c.telefone_fixo,
        telefone_celular: c.telefone_celular,
        email: c.email
      }))
    });
  } catch (err) {
    console.error('Erro ao buscar resumo do cliente:', err);
    res.status(err.status || 500).json({ error: 'Erro ao buscar resumo do cliente' });
  }
});

router.post('/', async (req, res) => {
  const cli = req.body || {};
  try {
    const api = createApiClient(req);
    const duplicados = await api.get('/api/clientes', {
      query: { cnpj: cli.cnpj, limit: 1 }
    });
    if (Array.isArray(duplicados) && duplicados.length) {
      return res.status(409).json({ error: 'Cliente já registrado' });
    }

    const created = await api.post('/api/clientes', buildPayload(cli));
    const clienteId = created?.id || created?.[0]?.id || created?.data?.id;
    const contatos = Array.isArray(cli.contatos) ? cli.contatos : [];
    for (const ct of contatos) {
      await api.post('/api/contatos_cliente', {
        id_cliente: clienteId,
        nome: ct.nome,
        cargo: ct.cargo,
        telefone_celular: ct.telefone_celular,
        telefone_fixo: ct.telefone_fixo,
        email: ct.email
      });
    }
    res.json({ id: clienteId });
  } catch(err){
    console.error('Erro ao criar cliente:', err);
    res.status(err.status || 500).json({ error: 'Erro ao criar cliente' });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const cli = req.body || {};
  try {
    const api = createApiClient(req);
    await api.put(`/api/clientes/${id}`, buildPayload(cli));

    const contatosNovos = Array.isArray(cli.contatosNovos) ? cli.contatosNovos : [];
    for(const ct of contatosNovos){
      await api.post('/api/contatos_cliente', {
        id_cliente: id,
        nome: ct.nome,
        cargo: ct.cargo,
        telefone_celular: ct.telefone_celular,
        telefone_fixo: ct.telefone_fixo,
        email: ct.email
      });
    }

    const contatosAtualizados = Array.isArray(cli.contatosAtualizados) ? cli.contatosAtualizados : [];
    for(const ct of contatosAtualizados){
      await api.put(`/contatos_cliente/${ct.id}`, {
        id_cliente: id,
        nome: ct.nome,
        cargo: ct.cargo,
        telefone_celular: ct.telefone_celular,
        telefone_fixo: ct.telefone_fixo,
        email: ct.email
      });
    }

    const contatosExcluidos = Array.isArray(cli.contatosExcluidos) ? cli.contatosExcluidos : [];
    for(const cid of contatosExcluidos){
      await api.delete(`/contatos_cliente/${cid}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar cliente:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar cliente' });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const orcRes = await api.get('/api/orcamentos', {
      query: { cliente_id: id, limit: 1 }
    });
    if (Array.isArray(orcRes) && orcRes.length) {
      return res.status(400).json({ error: 'Não é possível excluir: cliente possui orçamentos vinculados' });
    }

    try {
      const contatos = await api.get('/api/contatos_cliente', { query: { cliente_id: id } });
      if (Array.isArray(contatos)) {
        for (const contato of contatos) {
          if (contato?.id) {
            await api.delete(`/api/contatos_cliente/${contato.id}`);
          }
        }
      }
    } catch (_) {}
    try {
      const contratos = await api.get('/api/contratos', { query: { cliente_id: id } });
      if (Array.isArray(contratos)) {
        for (const contrato of contratos) {
          if (contrato?.id) {
            await api.delete(`/api/contratos/${contrato.id}`);
          }
        }
      }
    } catch (_) {}
    try {
      const notas = await api.get('/api/cliente_notas', { query: { cliente_id: id } });
      if (Array.isArray(notas)) {
        for (const nota of notas) {
          if (nota?.id) {
            await api.delete(`/api/cliente_notas/${nota.id}`);
          }
        }
      }
    } catch (_) {}
    await api.delete(`/api/clientes/${id}`);

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir cliente:', err);
    res.status(err.status || 500).json({ error: 'Erro ao excluir cliente' });
  }
});

module.exports = router;
