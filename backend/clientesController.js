const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao } = require('./permissionsController');
const { usuarioDaRequisicao } = require('./usuarioAtual');
const clienteHistorico = require('./clienteHistorico');
const csv = require('./importacaoCsv');
const social = require('./historicoSocial');

const router = express.Router();

function mapClienteBasico(row = {}) {
  return {
    id: row.id,
    nome_fantasia: row.nome_fantasia,
    razao_social: row.razao_social,
    cnpj: row.cnpj,
    pais: row.ent_pais || row.pais || '',
    estado: row.ent_uf || row.estado || '',
    // Cidade, e-mail e telefones acompanham o resumo porque o detalhe do
    // cliente nos Relatórios os exibe. Sem eles o painel abria com "—" em
    // três linhas — não por falta de cadastro, mas porque a resposta não
    // carregava os campos.
    cidade: row.ent_cidade || row.cidade || '',
    email: row.email || '',
    telefone_fixo: row.telefone_fixo || '',
    telefone_celular: row.telefone_celular || '',
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
    // Dados fiscais do destinatário da NF-e (sql/notas_fiscais_base.sql).
    tipo_pessoa: row.tipo_pessoa || 'PJ',
    cpf: row.cpf,
    indicador_ie: row.indicador_ie ?? null,
    email_nfe: row.email_nfe,
    consumidor_final: Boolean(row.consumidor_final),
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
      cep: row.reg_cep,
      codigo_municipio: row.reg_codigo_municipio
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
      cep: row.ent_cep,
      codigo_municipio: row.ent_codigo_municipio
    },
    status_cliente: row.status_cliente,
    dono_cliente: row.dono_cliente,
    origem_captacao: row.origem_captacao,
    anotacoes: row.anotacoes
  };
}

/** Campos fiscais do cliente, limpos. Ausente fica ausente (não apaga). */
function camposFiscaisDoCliente(cli = {}) {
  const saida = {};
  if (cli.tipo_pessoa !== undefined) saida.tipo_pessoa = String(cli.tipo_pessoa).toUpperCase() === 'PF' ? 'PF' : 'PJ';
  if (cli.cpf !== undefined) saida.cpf = String(cli.cpf ?? '').replace(/\D/g, '') || null;
  if (cli.indicador_ie !== undefined && cli.indicador_ie !== null && cli.indicador_ie !== '') {
    const n = Number(cli.indicador_ie);
    saida.indicador_ie = [1, 2, 9].includes(n) ? n : 9;
  }
  if (cli.email_nfe !== undefined) saida.email_nfe = String(cli.email_nfe ?? '').trim() || null;
  if (cli.consumidor_final !== undefined) saida.consumidor_final = Boolean(cli.consumidor_final);
  if (cli.endereco_registro && 'codigo_municipio' in cli.endereco_registro) {
    saida.reg_codigo_municipio = String(cli.endereco_registro.codigo_municipio ?? '').replace(/\D/g, '') || null;
  }
  if (cli.endereco_entrega && 'codigo_municipio' in cli.endereco_entrega) {
    saida.ent_codigo_municipio = String(cli.endereco_entrega.codigo_municipio ?? '').replace(/\D/g, '') || null;
  }
  return saida;
}

function buildPayload(cli = {}) {
  return {
    ...camposFiscaisDoCliente(cli),
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

router.get('/lista', exigirPermissao('cli.view'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const clientes = await api.get('/api/clientes');

    res.json(Array.isArray(clientes) ? clientes.map(mapClienteBasico) : []);
  } catch (err) {
    console.error('Erro ao listar clientes:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar clientes' });
  }
});

// ---------------------------------------------------------------------------
// PLANILHA (Ações Rápidas): modelo, exportação e importação em CSV.
// As colunas, a leitura e a conferência de cada linha moram em
// backend/importacaoCsv.js — o mesmo arquivo para os três, então o que se
// exporta volta pela importação sem ajuste.
// ---------------------------------------------------------------------------

// Data local (o toISOString daria o dia seguinte depois das 21h em Brasília).
const hojeNoNome = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

router.get('/csv/modelo', exigirPermissao('cli.import.csv'), (req, res) => {
  res.json({ nome: 'modelo-clientes', conteudo: csv.modeloDeClientes() });
});

// `ids` (opcional): só os clientes da tela, na ordem da tela — o filtro que
// a pessoa aplicou vale para o arquivo. GET com ?ids=1,2 ou POST com
// { ids: [...] } (a tela usa o POST: milhares de ids não cabem numa URL).
const idsPedidos = req => (Array.isArray(req.body?.ids) ? req.body.ids : String(req.query?.ids || '').split(','))
  .map(s => String(s).trim()).filter(Boolean);

router.get('/csv/exportar', exigirPermissao('cli.export.csv'), exportarClientes);
router.post('/csv/exportar', exigirPermissao('cli.export.csv'), exportarClientes);
async function exportarClientes(req, res) {
  try {
    const api = createApiClient(req);
    const [clientes, contatos] = await Promise.all([
      api.get('/api/clientes'),
      api.get('/api/contatos_cliente').catch(() => [])
    ]);
    const primeiro = new Map();
    for (const c of (Array.isArray(contatos) ? contatos : []).slice().sort((a, b) => Number(a.id) - Number(b.id))) {
      if (!primeiro.has(String(c.id_cliente))) primeiro.set(String(c.id_cliente), c);
    }
    let lista = Array.isArray(clientes) ? clientes : [];
    const ids = idsPedidos(req);
    if (ids.length) {
      const porId = new Map(lista.map(c => [String(c.id), c]));
      lista = ids.map(id => porId.get(id)).filter(Boolean);
    } else {
      lista = lista.slice().sort((a, b) => String(a.nome_fantasia || '').localeCompare(String(b.nome_fantasia || ''), 'pt-BR'));
    }
    const linhas = lista.map(c => csv.clienteParaLinha(c, primeiro.get(String(c.id)) || null));
    res.json({ nome: `clientes-${hojeNoNome()}`, total: linhas.length, conteudo: csv.gerarCsv(csv.COLUNAS_CLIENTE, linhas) });
  } catch (err) {
    console.error('Erro ao exportar clientes:', err);
    res.status(err.status || 500).json({ error: 'Não foi possível exportar os clientes.' });
  }
}

/**
 * Importa a planilha linha a linha, sem parar no primeiro erro. Cada linha
 * volta com a situação (registrado, com pendências, não registrado, ignorado)
 * e o porquê — é o relatório que a tela mostra no fim.
 */
async function importarClientes(api, conteudo, { usuarioId = null, nomeArquivo = 'planilha.csv' } = {}) {
  const { linhas } = csv.lerCsv(conteudo);
  if (linhas.length < 2) {
    const e = new Error('A planilha está vazia: nenhuma linha de cliente abaixo do cabeçalho.');
    e.status = 400;
    throw e;
  }
  const [cabecalho, ...dados] = linhas;
  const mapa = csv.mapearCabecalho(cabecalho.valores, csv.COLUNAS_CLIENTE);
  if (mapa.indice.nome_fantasia === undefined && mapa.indice.razao_social === undefined) {
    const e = new Error('O cabeçalho não tem as colunas do modelo. Use "Salvar modelo CSV" e preencha a partir dele.');
    e.status = 400;
    throw e;
  }
  const [clientes, usuarios] = await Promise.all([
    api.get('/api/clientes'),
    api.get('/api/usuarios').catch(() => [])
  ]);
  const documentosCadastrados = new Set((Array.isArray(clientes) ? clientes : [])
    .flatMap(c => [csv.digitos(c.cnpj), csv.digitos(c.cpf)]).filter(Boolean));
  const documentosDoArquivo = new Map();
  const donos = (Array.isArray(usuarios) ? usuarios : []).map(u => u.nome).filter(Boolean);

  const resultados = [];
  const aGravar = [];
  for (const linha of dados) {
    const r = csv.registroDaLinha(linha.valores, mapa.indice);
    if (csv.ehLinhaDeExemplo(r)) {
      resultados.push({ linha: linha.numero, identificacao: r.nome_fantasia || '', situacao: 'ignorado', id: null, bloqueios: [], pendencias: [], avisos: ['Linha de exemplo do modelo: ignorada.'] });
      continue;
    }
    const conf = csv.conferirCliente(r, { documentosCadastrados, documentosDoArquivo, donos });
    const resultado = {
      linha: linha.numero, identificacao: conf.identificacao, situacao: csv.situacaoDaLinha(conf), id: null,
      bloqueios: conf.bloqueios, pendencias: conf.pendencias, avisos: conf.avisos
    };
    resultados.push(resultado);
    if (resultado.situacao === 'nao_registrado') continue;
    if (conf.documento) documentosDoArquivo.set(conf.documento, linha.numero);
    aGravar.push({ resultado, conf });
  }

  await csv.emParalelo(aGravar, 4, async ({ resultado, conf }) => {
    try {
      resultado.id = await criarCliente(api, conf.payload, usuarioId, {
        observacao: `Importado da planilha ${nomeArquivo} (linha ${resultado.linha})`,
        pendencias: conf.pendencias
      });
    } catch (err) {
      resultado.situacao = 'nao_registrado';
      resultado.bloqueios = [...resultado.bloqueios, `Erro ao gravar: ${err?.body?.detalhe || err?.message || 'falha na API'}`];
    }
  });

  return {
    arquivo: nomeArquivo,
    colunas_desconhecidas: mapa.desconhecidas,
    colunas_ausentes: mapa.ausentes,
    resumo: csv.resumirImportacao(resultados),
    linhas: resultados
  };
}

router.post('/csv/importar', exigirPermissao(['cli.import.csv', 'cli.create']), async (req, res) => {
  try {
    const api = createApiClient(req);
    res.json(await importarClientes(api, String(req.body?.conteudo || ''), {
      usuarioId: usuarioDaRequisicao(req),
      nomeArquivo: String(req.body?.nome_arquivo || 'planilha.csv').slice(0, 200)
    }));
  } catch (err) {
    console.error('Erro ao importar clientes:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Não foi possível importar a planilha.' });
  }
});

router.get('/contatos', exigirPermissao('ctt.view'), async (req, res) => {
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

// ---------------------------------------------------------------------------
// ATIVIDADES do cliente (a mesma aba da prospecção): ligação, e-mail, reunião,
// WhatsApp, visita... O que foi FEITO. O que ainda vai ser feito é tarefa
// (/api/tarefas, com cliente_id), e a tarefa concluída também vira atividade.
// Tabela: cliente_interacoes (sql/tarefas_calendario.sql).
// ---------------------------------------------------------------------------
const TIPOS_ATIVIDADE = new Set(['Ligação', 'E-mail', 'Reunião', 'WhatsApp', 'Visita', 'Nota', 'Proposta', 'Atividade realizada']);
const textoLimpo = v => (v === undefined || v === null ? '' : String(v).trim());
const erroHttp = (status, mensagem) => Object.assign(new Error(mensagem), { status });

function responderAtividade(res, err, onde) {
  if (social.semTabela(err)) {
    return res.status(409).json({ error: 'As atividades do cliente ainda não estão ativadas: rode sql/tarefas_calendario.sql e reinicie a API.', sql_pendente: true });
  }
  if (!err.status || err.status >= 500) console.error(`[clientes] atividade (${onde}):`, err);
  return res.status(err.status || 500).json({ error: err.message || 'Erro na atividade.' });
}

/** Corpo da tela → linha de cliente_interacoes (confere tipo, resumo, contato do próprio cliente). */
async function dadosDaAtividade(api, clienteId, corpo = {}) {
  const tipo = textoLimpo(corpo.tipo);
  const resumo = textoLimpo(corpo.resumo).slice(0, 300);
  if (!TIPOS_ATIVIDADE.has(tipo)) throw erroHttp(400, `Tipo de atividade inválido: ${tipo}`);
  if (!resumo) throw erroHttp(400, 'Descreva a atividade em uma linha.');
  const contatoId = corpo.contato_id ? Number(corpo.contato_id) : null;
  if (contatoId) {
    const contato = await api.get(`/api/contatos_cliente/${contatoId}`).catch(() => null);
    if (!contato || Number(contato.id_cliente) !== Number(clienteId)) throw erroHttp(400, 'Contato não pertence a este cliente.');
  }
  const duracao = corpo.duracao_min === null || corpo.duracao_min === undefined || corpo.duracao_min === '' ? null : Number(corpo.duracao_min);
  if (duracao !== null && (!Number.isInteger(duracao) || duracao < 0 || duracao > 1440)) throw erroHttp(400, 'Duração inválida.');
  const data = corpo.data ? new Date(corpo.data) : new Date();
  if (Number.isNaN(data.getTime())) throw erroHttp(400, 'Data inválida.');
  return { tipo, resumo, detalhe: textoLimpo(corpo.detalhe) || null, contato_id: contatoId, duracao_min: duracao, data: data.toISOString() };
}

const retratoDaAtividade = a => [
  ['Tipo', a.tipo], ['Resumo', a.resumo], ['Detalhe', a.detalhe],
  ['Duração', a.duracao_min ? `${a.duracao_min} min` : null]
].filter(([, v]) => v).map(([rotulo, valor]) => ({ rotulo, valor: String(valor) }));

router.get('/:id/interacoes', exigirPermissao('cli.details.view'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const [linhas, nomes, contatos] = await Promise.all([
      api.get('/api/cliente_interacoes', { query: { cliente_id: req.params.id } }),
      social.nomesDosUsuarios(api),
      api.get('/api/contatos_cliente', { query: { id_cliente: req.params.id } }).catch(() => [])
    ]);
    const nomeContato = new Map((Array.isArray(contatos) ? contatos : []).map(c => [Number(c.id), c.nome]));
    const atividades = (Array.isArray(linhas) ? linhas : [])
      .sort((a, b) => String(b.data).localeCompare(String(a.data)) || Number(b.id) - Number(a.id))
      .map(a => ({
        ...a,
        usuario: a.usuario_id ? nomes.get(Number(a.usuario_id)) || null : null,
        contato: a.contato_id ? nomeContato.get(Number(a.contato_id)) || null : null
      }));
    res.json({ atividades });
  } catch (err) {
    if (social.semTabela(err)) return res.json({ atividades: [], sql_pendente: true });
    responderAtividade(res, err, 'listar');
  }
});

router.post('/:id/interacoes', exigirPermissao('cli.interaction.add'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const cliente = await api.get(`/api/clientes/${req.params.id}`).catch(() => null);
    if (!cliente || cliente.error) throw erroHttp(404, 'Cliente não encontrado.');
    const dados = await dadosDaAtividade(api, req.params.id, req.body);
    const usuarioId = usuarioDaRequisicao(req);
    const criada = await api.post('/api/cliente_interacoes', { ...dados, cliente_id: Number(req.params.id), usuario_id: usuarioId });
    await clienteHistorico.registrarNoCliente(api, req.params.id, [{
      tipo: 'interacao', acao: 'criou', entidade: `${dados.tipo} — ${dados.resumo}`, valor_novo: dados.resumo,
      detalhe: { campos: retratoDaAtividade(dados), atividade_id: criada?.id ?? null }
    }], usuarioId);
    res.status(201).json({ id: criada?.id ?? null });
  } catch (err) {
    responderAtividade(res, err, 'registrar');
  }
});

async function atividadeDoCliente(api, clienteId, atividadeId) {
  const a = await api.get(`/api/cliente_interacoes/${Number(atividadeId)}`).catch(err => {
    if (social.semTabela(err)) throw err;
    return null;
  });
  if (!a || a.error || Number(a.cliente_id) !== Number(clienteId)) throw erroHttp(404, 'Atividade não encontrada.');
  return a;
}

router.put('/:id/interacoes/:atividadeId', exigirPermissao('cli.interaction.add'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const antes = await atividadeDoCliente(api, req.params.id, req.params.atividadeId);
    const dados = await dadosDaAtividade(api, req.params.id, { ...antes, ...req.body });
    await api.put(`/api/cliente_interacoes/${antes.id}`, dados);
    const eventos = [['tipo', 'Tipo'], ['resumo', 'Resumo'], ['detalhe', 'Detalhe'], ['duracao_min', 'Duração']]
      .filter(([campo]) => String(antes[campo] ?? '') !== String(dados[campo] ?? ''))
      .map(([campo, rotulo]) => ({
        tipo: 'interacao', acao: 'alterou', entidade: `${antes.tipo} — ${antes.resumo}`, campo,
        valor_anterior: antes[campo] ?? null, valor_novo: dados[campo] ?? null, detalhe: { rotulo }
      }));
    await clienteHistorico.registrarNoCliente(api, req.params.id, eventos, usuarioDaRequisicao(req));
    res.json({ success: true });
  } catch (err) {
    responderAtividade(res, err, 'editar');
  }
});

router.delete('/:id/interacoes/:atividadeId', exigirPermissao('cli.interaction.add'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const antes = await atividadeDoCliente(api, req.params.id, req.params.atividadeId);
    await api.delete(`/api/cliente_interacoes/${antes.id}`);
    await clienteHistorico.registrarNoCliente(api, req.params.id, [{
      tipo: 'interacao', acao: 'excluiu', entidade: `${antes.tipo} — ${antes.resumo}`,
      valor_anterior: [antes.resumo, antes.detalhe].filter(Boolean).join(' · '),
      detalhe: { campos: retratoDaAtividade(antes) }
    }], usuarioDaRequisicao(req));
    res.json({ success: true });
  } catch (err) {
    responderAtividade(res, err, 'excluir');
  }
});

router.get('/:id', exigirPermissao('cli.details.view'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const cliente = await api.get(`/api/clientes/${id}`);
    if (!cliente || cliente.error === 'Not found') {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    // Em paralelo: eram 3 idas sequenciais ao upstream (3 RTTs) só para montar
    // a tela de detalhe. Como são independentes, viram 1 RTT.
    const [contatos, contratos, notas] = await Promise.all([
      api.get('/api/contatos_cliente', { query: { id_cliente: id, order: 'nome' } }).catch(() => []),
      api.get('/api/contratos', { query: { cliente_id: id } }).catch(() => []),
      api.get('/api/cliente_notas', { query: { cliente_id: id, order: 'data.desc' } }).catch(() => [])
    ]);

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

router.get('/:id/resumo', exigirPermissao('cli.details.view'), async (req, res) => {
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
      query: { id_cliente: id, order: 'nome' }
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

/**
 * Cadastra o cliente com os contatos e grava quem cadastrou e o histórico.
 * O mesmo caminho do formulário (POST /) e da importação da planilha.
 */
async function criarCliente(api, cli, usuarioId, { observacao = 'Cadastro inicial', pendencias = [] } = {}) {
  const payload = buildPayload(cli);
  const created = await api.post('/api/clientes', payload);
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
  await clienteHistorico.marcarCriador(api, clienteId, usuarioId);
  await clienteHistorico.registrarNoCliente(api, clienteId, clienteHistorico.eventosDaCriacao(payload, contatos, { observacao, pendencias }), usuarioId);
  return clienteId;
}

router.post('/', exigirPermissao(req => (Array.isArray(req.body?.contatos) && req.body.contatos.length ? ['cli.create', 'cli.contact.add'] : ['cli.create'])), async (req, res) => {
  const cli = req.body || {};
  try {
    const api = createApiClient(req);
    const duplicados = await api.get('/api/clientes', {
      query: { cnpj: cli.cnpj, limit: 1 }
    });
    if (Array.isArray(duplicados) && duplicados.length) {
      return res.status(409).json({ error: 'Cliente já registrado' });
    }

    const clienteId = await criarCliente(api, cli, usuarioDaRequisicao(req));
    res.json({ id: clienteId });
  } catch(err){
    console.error('Erro ao criar cliente:', err);
    res.status(err.status || 500).json({ error: 'Erro ao criar cliente' });
  }
});

// PUT /clientes/:id faz MAIS do que editar o cliente: o mesmo payload cria,
// atualiza e exclui CONTATOS. Guardado so por `cli.edit`, quem podia editar o
// cliente mexia livremente nos contatos sem ter essas permissoes. Agora a rota
// pede exatamente o que o payload manda fazer.
function permissoesDeEdicaoCliente(req) {
  const corpo = req.body || {};
  const chaves = ['cli.edit'];
  const temItens = (lista) => Array.isArray(lista) && lista.length > 0;
  if (temItens(corpo.contatosNovos)) chaves.push('cli.contact.add');
  if (temItens(corpo.contatosAtualizados)) chaves.push('cli.contact.edit');
  if (temItens(corpo.contatosExcluidos)) chaves.push('cli.contact.remove');
  // Transportadora é dado do cliente, sem permissão própria no catálogo — quem
  // pode editar o cliente pode mexer nas transportadoras dele.
  return chaves;
}

/** Nome da transportadora, limpo. Vazio não vira linha no banco. */
const nomeTransportadora = t => String(t?.transportadora ?? t?.nome ?? '').trim();

router.put('/:id', exigirPermissao(permissoesDeEdicaoCliente), async (req, res) => {
  const { id } = req.params;
  const cli = req.body || {};
  try {
    const api = createApiClient(req);
    // O "antes" é o que a linha do tempo mostra riscado ("era X, virou Y").
    const [antes, contatosAntes, transportadorasAntes] = await Promise.all([
      api.get(`/api/clientes/${id}`).catch(() => null),
      api.get('/api/contatos_cliente', { query: { id_cliente: id } }).catch(() => []),
      api.get('/api/transportadoras', { query: { id_cliente: id } }).catch(() => [])
    ]);
    const payload = buildPayload(cli);
    await api.put(`/api/clientes/${id}`, payload);

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
      // O `/api` faltava aqui e no DELETE abaixo: `api.put` concatena o caminho
      // cru na base, então isso batia em https://.../contatos_cliente/N, que não
      // é rota nenhuma. Editar e excluir contato de cliente não funcionava.
      await api.put(`/api/contatos_cliente/${ct.id}`, {
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
      await api.delete(`/api/contatos_cliente/${cid}`);
    }

    // ----------------------------------------------------------------------
    // Transportadoras do cliente
    //
    // Mesmo desenho dos contatos: a tela acumula o que mudou e manda tudo no
    // salvamento. A tabela tem uma coluna só de conteúdo (`transportadora`).
    // ----------------------------------------------------------------------
    for (const t of Array.isArray(cli.transportadorasNovas) ? cli.transportadorasNovas : []) {
      const nome = nomeTransportadora(t);
      if (!nome) continue;
      await api.post('/api/transportadoras', { id_cliente: Number(id), transportadora: nome });
    }

    for (const t of Array.isArray(cli.transportadorasAtualizadas) ? cli.transportadorasAtualizadas : []) {
      const nome = nomeTransportadora(t);
      if (!t?.id || !nome) continue;
      await api.put(`/api/transportadoras/${t.id}`, { id_cliente: Number(id), transportadora: nome });
    }

    for (const tid of Array.isArray(cli.transportadorasExcluidas) ? cli.transportadorasExcluidas : []) {
      if (!tid) continue;
      await api.delete(`/api/transportadoras/${tid}`);
    }

    await clienteHistorico.registrarNoCliente(api, id, [
      ...clienteHistorico.diferencasDoCliente(antes && !antes.error ? antes : {}, payload),
      ...clienteHistorico.eventosDosFilhos({
        contatosNovos, contatosAtualizados, contatosExcluidos,
        transportadorasNovas: Array.isArray(cli.transportadorasNovas) ? cli.transportadorasNovas : [],
        transportadorasExcluidas: Array.isArray(cli.transportadorasExcluidas) ? cli.transportadorasExcluidas : []
      }, { contatosAntes, transportadorasAntes })
    ], usuarioDaRequisicao(req));

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar cliente:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar cliente' });
  }
});

router.delete('/:id', exigirPermissao('cli.delete'), async (req, res) => {
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
      const contatos = await api.get('/api/contatos_cliente', { query: { id_cliente: id } });
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
// Reaproveitado pelo módulo de IA: o mapeamento de endereço para as colunas
// reg_*/cob_*/ent_* mora aqui e não pode existir em dois lugares.
module.exports.buildPayload = buildPayload;
module.exports.mapClienteCompleto = mapClienteCompleto;
module.exports.camposFiscaisDoCliente = camposFiscaisDoCliente;
module.exports.criarCliente = criarCliente;
module.exports.importarClientes = importarClientes;
