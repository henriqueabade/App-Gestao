/**
 * Contatos — fornecedores, prestadores de serviço e parceiros: o cadastro de
 * TERCEIROS do CRM (decisão do dono, 28/09/2026), no mesmo padrão do módulo
 * Clientes (backend/clientesController.js): lista, planilha, ficha com as
 * pessoas de contato, atividades e a linha do tempo (origem 'contato' do
 * histórico social). Sem orçamentos, pedidos nem transportadoras.
 *
 * O campo "Tipo" é uma lista editável pela tela (a caixa com + e −), como os
 * desenhistas das peças: `contato_tipos`. Tabelas em sql/contatos_fornecedores.sql;
 * sem o SQL, as rotas respondem 409 com `sql_pendente` e a tela diz o que fazer.
 *
 * Os contatos das EMPRESAS CLIENTES (contatos_cliente) continuam onde estão,
 * dentro de Clientes: não são a mesma coisa.
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao, obterPermissoesEfetivas } = require('./permissionsController');
const permissoesRepo = require('./permissionsRepository');
const { usuarioDaRequisicao } = require('./usuarioAtual');
const historico = require('./contatoHistorico');
const csv = require('./importacaoCsv');
const social = require('./historicoSocial');
// Aviso no sino para quem cadastrou quando outra pessoa mexe no contato.
const avisos = require('./avisosEnvolvidos');
const { quandoAconteceu } = require('./tarefasRegras');

const SQL_ARQUIVO = 'sql/contatos_fornecedores.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`;
const STATUS = ['Ativo', 'Inativo'];
const TIPOS_ATIVIDADE = new Set(['Ligação', 'E-mail', 'Reunião', 'WhatsApp', 'Visita', 'Nota', 'Proposta', 'Atividade realizada']);
const CAMPOS_PESSOA = ['nome', 'cargo', 'email', 'telefone_celular', 'telefone_fixo'];

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const texto = v => (v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim());
const digitos = v => String(v ?? '').replace(/\D/g, '');
const chave = nome => texto(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const agora = () => new Date().toISOString();

function erroHttp(status, mensagem, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** A tabela ainda não existe (SQL não rodou): API remota (404 "Tabela") ou banco DEV (42P01). */
function tabelaAusente(err) {
  return social.semTabela(err);
}

function responder(res, err, contexto) {
  if (tabelaAusente(err)) return res.status(409).json({ error: SQL_FALTANDO, sql_pendente: true });
  const status = err?.status || 500;
  if (status >= 500) console.error(`Erro em ${contexto}:`, err);
  res.status(status).json({ error: err?.message || 'Erro interno nos contatos', ...(err?.extra || {}) });
}

// ---------------------------------------------------------------- tipos

async function lerTipos(api) {
  return lista(await api.get('/api/contato_tipos'))
    .filter(t => t && texto(t.nome))
    .map(t => ({ id: t.id, nome: texto(t.nome) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

const nomeDoTipo = (tipos, id) => (id === null || id === undefined ? null : (tipos.find(t => String(t.id) === String(id))?.nome || null));

// ---------------------------------------------------------------- mapas

const formatarDocumento = row => (String(row?.tipo_pessoa || 'PJ').toUpperCase() === 'PF'
  ? csv.formatarCpf(row?.cpf) : csv.formatarCnpj(row?.cnpj));

/** A linha da lista. */
function mapBasico(row = {}, tipos = []) {
  return {
    id: row.id,
    nome: row.nome,
    razao_social: row.razao_social || null,
    tipo_id: row.tipo_id ?? null,
    tipo: nomeDoTipo(tipos, row.tipo_id),
    tipo_pessoa: String(row.tipo_pessoa || 'PJ').toUpperCase() === 'PF' ? 'PF' : 'PJ',
    cnpj: row.cnpj || null,
    cpf: row.cpf || null,
    documento: formatarDocumento(row) || '',
    email: row.email || '',
    telefone_celular: row.telefone_celular || '',
    telefone_fixo: row.telefone_fixo || '',
    cidade: row.end_cidade || '',
    estado: row.end_uf || '',
    status: row.status || 'Ativo'
  };
}

/** A ficha inteira. */
function mapCompleto(row = {}, tipos = []) {
  return {
    ...mapBasico(row, tipos),
    inscricao_estadual: row.inscricao_estadual || '',
    inscricao_municipal: row.inscricao_municipal || '',
    site: row.site || '',
    endereco: {
      rua: row.end_logradouro || '',
      numero: row.end_numero || '',
      complemento: row.end_complemento || '',
      bairro: row.end_bairro || '',
      cidade: row.end_cidade || '',
      pais: row.end_pais || '',
      estado: row.end_uf || '',
      cep: row.end_cep || '',
      codigo_municipio: row.end_codigo_municipio || ''
    },
    anotacoes: row.anotacoes || '',
    criado_por: row.criado_por ?? null,
    criado_em: row.criado_em ?? null
  };
}

/** O contato como a linha do tempo compara: as colunas mais o NOME do tipo. */
const paraHistorico = (row = {}, tipos = []) => ({ ...row, tipo: nomeDoTipo(tipos, row.tipo_id) });

/**
 * Corpo da tela → colunas de `contatos`, conferidas. `parcial` (PUT) aceita
 * campo ausente (não apaga); o cadastro exige nome, tipo e documento.
 */
function buildPayload(corpo = {}, tipos = [], { parcial = false } = {}) {
  const payload = {};
  const tem = campo => corpo[campo] !== undefined;

  if (!parcial || tem('nome')) {
    payload.nome = texto(corpo.nome).slice(0, 150);
    if (payload.nome.length < 2) throw erroHttp(400, 'Informe o nome do contato (a empresa ou a pessoa).');
  }
  if (!parcial || tem('razao_social')) payload.razao_social = texto(corpo.razao_social).slice(0, 200) || null;

  if (!parcial || tem('tipo_id') || tem('tipo')) {
    let tipoId = corpo.tipo_id;
    if ((tipoId === undefined || tipoId === null || tipoId === '') && texto(corpo.tipo)) {
      tipoId = tipos.find(t => chave(t.nome) === chave(corpo.tipo))?.id;
    }
    const achado = tipos.find(t => String(t.id) === String(tipoId));
    if (!achado) throw erroHttp(400, 'Escolha o tipo do contato (Fornecedor, Prestador de serviço…).');
    payload.tipo_id = Number(achado.id);
  }

  const tipoPessoa = String(corpo.tipo_pessoa ?? (parcial ? undefined : 'PJ') ?? '').toUpperCase();
  if (!parcial || tem('tipo_pessoa')) payload.tipo_pessoa = tipoPessoa === 'PF' ? 'PF' : 'PJ';
  if (!parcial || tem('cnpj') || tem('cpf') || tem('tipo_pessoa')) {
    const pf = (payload.tipo_pessoa || tipoPessoa) === 'PF';
    const cnpj = digitos(corpo.cnpj);
    const cpf = digitos(corpo.cpf);
    if (pf) {
      if (cpf && !csv.cpfValido(cpf)) throw erroHttp(400, 'CPF inválido (confira os dígitos).');
      if (!parcial && !cpf) throw erroHttp(400, 'Informe o CPF.');
      if (tem('cpf') || !parcial) payload.cpf = cpf || null;
      if (tem('tipo_pessoa') || !parcial) payload.cnpj = null;
    } else {
      if (cnpj && !csv.cnpjValido(cnpj)) throw erroHttp(400, 'CNPJ inválido (confira os dígitos).');
      if (!parcial && !cnpj) throw erroHttp(400, 'Informe o CNPJ.');
      if (tem('cnpj') || !parcial) payload.cnpj = cnpj || null;
      if (tem('tipo_pessoa') || !parcial) payload.cpf = null;
    }
  }

  for (const [campo, max] of [['inscricao_estadual', 20], ['inscricao_municipal', 20], ['email', 150], ['telefone_celular', 40], ['telefone_fixo', 40], ['site', 150]]) {
    if (!parcial || tem(campo)) payload[campo] = texto(corpo[campo]).slice(0, max) || null;
  }
  if (!parcial || tem('status')) {
    const status = STATUS.find(s => chave(s) === chave(corpo.status)) || (parcial ? null : 'Ativo');
    if (!status) throw erroHttp(400, 'Status inválido: use Ativo ou Inativo.');
    payload.status = status;
  }
  if (!parcial || tem('anotacoes')) payload.anotacoes = String(corpo.anotacoes ?? '').trim() || null;

  const end = corpo.endereco;
  if (end && typeof end === 'object') {
    const partes = { logradouro: 'rua', numero: 'numero', complemento: 'complemento', bairro: 'bairro', cidade: 'cidade', uf: 'estado', pais: 'pais', cep: 'cep' };
    for (const [coluna, campo] of Object.entries(partes)) {
      if (!parcial || end[campo] !== undefined) payload[`end_${coluna}`] = texto(end[campo]).slice(0, 200) || null;
    }
    if (!parcial || end.codigo_municipio !== undefined) payload.end_codigo_municipio = digitos(end.codigo_municipio).slice(0, 7) || null;
  } else if (!parcial) {
    for (const coluna of ['logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'pais', 'cep', 'codigo_municipio']) payload[`end_${coluna}`] = null;
  }
  return payload;
}

/** Uma pessoa de contato, limpa. Nome obrigatório. */
function limparPessoa(p = {}) {
  const pessoa = {};
  for (const campo of CAMPOS_PESSOA) pessoa[campo] = texto(p[campo]).slice(0, 150) || null;
  if (!pessoa.nome) throw erroHttp(400, 'Informe o nome da pessoa de contato.');
  return pessoa;
}

/** Já existe outro contato com este CNPJ/CPF? Devolve a linha ou null. */
async function documentoJaUsado(api, payload, ignorarId = null) {
  const consultas = [];
  if (payload.cnpj) consultas.push(api.get('/api/contatos', { query: { cnpj: payload.cnpj } }));
  if (payload.cpf) consultas.push(api.get('/api/contatos', { query: { cpf: payload.cpf } }));
  const achados = (await Promise.all(consultas)).flatMap(lista)
    .filter(c => c && String(c.id) !== String(ignorarId) && ((payload.cnpj && c.cnpj === payload.cnpj) || (payload.cpf && c.cpf === payload.cpf)));
  return achados[0] || null;
}

// ----------------------------------------------------------------- rotas

const router = express.Router();

router.get('/lista', exigirPermissao('ctt.view'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const [contatos, tipos] = await Promise.all([api.get('/api/contatos'), lerTipos(api)]);
    res.json(lista(contatos).map(c => mapBasico(c, tipos)).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')));
  } catch (err) {
    responder(res, err, 'GET /api/contatos/lista');
  }
});

router.get('/tipos', exigirPermissao('ctt.view'), async (req, res) => {
  try {
    res.json({ tipos: await lerTipos(createApiClient(req)) });
  } catch (err) {
    responder(res, err, 'GET /api/contatos/tipos');
  }
});

router.post('/tipos', exigirPermissao('ctt.type.manage'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const nome = texto(req.body?.nome).slice(0, 60);
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do tipo.');
    const existentes = await lerTipos(api);
    const igual = existentes.find(t => chave(t.nome) === chave(nome));
    if (igual) throw erroHttp(409, `${igual.nome} já está na lista.`, { tipo: igual });
    const criado = await api.post('/api/contato_tipos', { nome, criado_por: usuarioDaRequisicao(req), criado_em: agora() });
    const id = criado?.id ?? criado?.[0]?.id ?? null;
    res.json({ tipo: { id, nome }, tipos: await lerTipos(api) });
  } catch (err) {
    responder(res, err, 'POST /api/contatos/tipos');
  }
});

router.delete('/tipos/:id', exigirPermissao('ctt.type.manage'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const alvo = (await lerTipos(api)).find(t => String(t.id) === String(req.params.id));
    if (!alvo) throw erroHttp(404, 'Tipo não encontrado.');
    const usados = lista(await api.get('/api/contatos', { query: { tipo_id: alvo.id } })).filter(c => String(c?.tipo_id) === String(alvo.id)).length;
    if (usados > 0) {
      throw erroHttp(409, `${alvo.nome} é o tipo de ${usados === 1 ? '1 contato' : `${usados} contatos`}: troque o tipo deles antes de excluir.`, { dependente: true });
    }
    await api.delete(`/api/contato_tipos/${alvo.id}`);
    res.json({ removido: alvo, tipos: await lerTipos(api) });
  } catch (err) {
    responder(res, err, 'DELETE /api/contatos/tipos/:id');
  }
});

// ---------------------------------------------------------------------------
// PLANILHA (Ações Rápidas): modelo, exportação e importação em CSV — as
// colunas moram em backend/importacaoCsv.js, como as de clientes.
// ---------------------------------------------------------------------------
const hojeNoNome = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const idsPedidos = req => (Array.isArray(req.body?.ids) ? req.body.ids : String(req.query?.ids || '').split(','))
  .map(s => String(s).trim()).filter(Boolean);

router.get('/csv/modelo', exigirPermissao('ctt.import.csv'), (req, res) => {
  res.json({ nome: 'modelo-contatos', conteudo: csv.modeloDeContatos() });
});

router.get('/csv/exportar', exigirPermissao('ctt.export.csv'), exportarContatos);
router.post('/csv/exportar', exigirPermissao('ctt.export.csv'), exportarContatos);
async function exportarContatos(req, res) {
  try {
    const api = createApiClient(req);
    const [contatos, pessoas, tipos] = await Promise.all([
      api.get('/api/contatos'),
      api.get('/api/contato_pessoas').catch(() => []),
      lerTipos(api)
    ]);
    const primeira = new Map();
    for (const p of lista(pessoas).slice().sort((a, b) => Number(a.id) - Number(b.id))) {
      if (!primeira.has(String(p.contato_id))) primeira.set(String(p.contato_id), p);
    }
    let selecionados = lista(contatos);
    const ids = idsPedidos(req);
    if (ids.length) {
      const porId = new Map(selecionados.map(c => [String(c.id), c]));
      selecionados = ids.map(id => porId.get(id)).filter(Boolean);
    } else {
      selecionados = selecionados.slice().sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    }
    const linhas = selecionados.map(c => csv.contatoParaLinha(c, primeira.get(String(c.id)) || null, nomeDoTipo(tipos, c.tipo_id)));
    res.json({ nome: `contatos-${hojeNoNome()}`, total: linhas.length, conteudo: csv.gerarCsv(csv.COLUNAS_CONTATO, linhas) });
  } catch (err) {
    responder(res, err, 'exportar contatos');
  }
}

/** Importa linha a linha, sem parar no primeiro erro (o relatório da tela). */
async function importarContatos(api, conteudo, { usuarioId = null, nomeArquivo = 'planilha.csv' } = {}) {
  const { linhas } = csv.lerCsv(conteudo);
  if (linhas.length < 2) throw erroHttp(400, 'A planilha está vazia: nenhuma linha de contato abaixo do cabeçalho.');
  const [cabecalho, ...dados] = linhas;
  const mapa = csv.mapearCabecalho(cabecalho.valores, csv.COLUNAS_CONTATO);
  if (mapa.indice.nome === undefined) throw erroHttp(400, 'O cabeçalho não tem as colunas do modelo. Use "Salvar modelo CSV" e preencha a partir dele.');
  const [contatos, tipos] = await Promise.all([api.get('/api/contatos'), lerTipos(api)]);
  const documentosCadastrados = new Set(lista(contatos).flatMap(c => [digitos(c.cnpj), digitos(c.cpf)]).filter(Boolean));
  const documentosDoArquivo = new Map();

  const resultados = [];
  const aGravar = [];
  for (const linha of dados) {
    const r = csv.registroDaLinha(linha.valores, mapa.indice);
    if (csv.ehLinhaDeExemplo({ ...r, nome_fantasia: r.nome })) {
      resultados.push({ linha: linha.numero, identificacao: r.nome || '', situacao: 'ignorado', id: null, bloqueios: [], pendencias: [], avisos: ['Linha de exemplo do modelo: ignorada.'] });
      continue;
    }
    const conf = csv.conferirContato(r, { documentosCadastrados, documentosDoArquivo, tipos });
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
      resultado.id = await criarContato(api, conf.payload, conf.pessoas, tipos, usuarioId, {
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

router.post('/csv/importar', exigirPermissao(['ctt.import.csv', 'ctt.create']), async (req, res) => {
  try {
    const api = createApiClient(req);
    res.json(await importarContatos(api, String(req.body?.conteudo || ''), {
      usuarioId: usuarioDaRequisicao(req),
      nomeArquivo: String(req.body?.nome_arquivo || 'planilha.csv').slice(0, 200)
    }));
  } catch (err) {
    responder(res, err, 'importar contatos');
  }
});

// ---------------------------------------------------------------------------
// ATIVIDADES do contato (a mesma aba de Clientes): o que foi FEITO.
// Tabela: contato_interacoes.
// ---------------------------------------------------------------------------
async function dadosDaAtividade(api, contatoId, corpo = {}) {
  const tipo = texto(corpo.tipo);
  const resumo = texto(corpo.resumo).slice(0, 300);
  if (!TIPOS_ATIVIDADE.has(tipo)) throw erroHttp(400, `Tipo de atividade inválido: ${tipo}`);
  if (!resumo) throw erroHttp(400, 'Descreva a atividade em uma linha.');
  const pessoaId = corpo.pessoa_id ? Number(corpo.pessoa_id) : null;
  if (pessoaId) {
    const pessoa = await api.get(`/api/contato_pessoas/${pessoaId}`).catch(() => null);
    if (!pessoa || Number(pessoa.contato_id) !== Number(contatoId)) throw erroHttp(400, 'A pessoa não é deste contato.');
  }
  const duracao = corpo.duracao_min === null || corpo.duracao_min === undefined || corpo.duracao_min === '' ? null : Number(corpo.duracao_min);
  if (duracao !== null && (!Number.isInteger(duracao) || duracao < 0 || duracao > 1440)) throw erroHttp(400, 'Duração inválida.');
  const data = quandoAconteceu(corpo.data);
  return { tipo, resumo, detalhe: String(corpo.detalhe ?? '').trim() || null, pessoa_id: pessoaId, duracao_min: duracao, data };
}

const retratoDaAtividade = a => [
  ['Tipo', a.tipo], ['Resumo', a.resumo], ['Detalhe', a.detalhe], ['Duração', a.duracao_min ? `${a.duracao_min} min` : null]
].filter(([, v]) => v).map(([rotulo, valor]) => ({ rotulo, valor: String(valor) }));

router.get('/:id/interacoes', exigirPermissao('ctt.details.view'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const [linhas, nomes, pessoas] = await Promise.all([
      api.get('/api/contato_interacoes', { query: { contato_id: req.params.id } }),
      social.nomesDosUsuarios(api),
      api.get('/api/contato_pessoas', { query: { contato_id: req.params.id } }).catch(() => [])
    ]);
    const nomePessoa = new Map(lista(pessoas).map(p => [Number(p.id), p.nome]));
    const atividades = lista(linhas)
      .filter(a => String(a.contato_id) === String(req.params.id))
      .sort((a, b) => String(b.data).localeCompare(String(a.data)) || Number(b.id) - Number(a.id))
      .map(a => ({
        ...a,
        usuario: a.usuario_id ? nomes.get(Number(a.usuario_id)) || null : null,
        pessoa: a.pessoa_id ? nomePessoa.get(Number(a.pessoa_id)) || null : null
      }));
    res.json({ atividades });
  } catch (err) {
    if (tabelaAusente(err)) return res.json({ atividades: [], sql_pendente: true });
    responder(res, err, 'GET /api/contatos/:id/interacoes');
  }
});

router.post('/:id/interacoes', exigirPermissao('ctt.interaction.add'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const contato = await api.get(`/api/contatos/${req.params.id}`).catch(() => null);
    if (!contato || contato.error) throw erroHttp(404, 'Contato não encontrado.');
    const dados = await dadosDaAtividade(api, req.params.id, req.body);
    const usuarioId = usuarioDaRequisicao(req);
    const criada = await api.post('/api/contato_interacoes', { ...dados, contato_id: Number(req.params.id), usuario_id: usuarioId, criado_em: agora() });
    await historico.registrarNoContato(api, req.params.id, [{
      tipo: 'interacao', acao: 'criou', entidade: `${dados.tipo} — ${dados.resumo}`, valor_novo: dados.resumo,
      detalhe: { campos: retratoDaAtividade(dados), atividade_id: criada?.id ?? null }
    }], usuarioId, { nota: dados.detalhe || null });
    res.status(201).json({ id: criada?.id ?? null });
  } catch (err) {
    responder(res, err, 'POST /api/contatos/:id/interacoes');
  }
});

async function atividadeDoContato(api, contatoId, atividadeId) {
  const a = await api.get(`/api/contato_interacoes/${Number(atividadeId)}`).catch(err => {
    if (tabelaAusente(err)) throw err;
    return null;
  });
  if (!a || a.error || Number(a.contato_id) !== Number(contatoId)) throw erroHttp(404, 'Atividade não encontrada.');
  return a;
}

router.put('/:id/interacoes/:atividadeId', exigirPermissao('ctt.interaction.add'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const antes = await atividadeDoContato(api, req.params.id, req.params.atividadeId);
    const dados = await dadosDaAtividade(api, req.params.id, { ...antes, ...req.body });
    await api.put(`/api/contato_interacoes/${antes.id}`, dados);
    const eventos = [['tipo', 'Tipo'], ['resumo', 'Resumo'], ['detalhe', 'Detalhe'], ['duracao_min', 'Duração']]
      .filter(([campo]) => String(antes[campo] ?? '') !== String(dados[campo] ?? ''))
      .map(([campo, rotulo]) => ({
        tipo: 'interacao', acao: 'alterou', entidade: `${antes.tipo} — ${antes.resumo}`, campo,
        valor_anterior: antes[campo] ?? null, valor_novo: dados[campo] ?? null, detalhe: { rotulo }
      }));
    // Quem registrou a atividade fica sabendo que outra pessoa a mudou.
    await historico.registrarNoContato(api, req.params.id, eventos, usuarioDaRequisicao(req), { autores: [antes.usuario_id] });
    res.json({ success: true });
  } catch (err) {
    responder(res, err, 'PUT /api/contatos/:id/interacoes/:atividadeId');
  }
});

router.delete('/:id/interacoes/:atividadeId', exigirPermissao('ctt.interaction.add'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const antes = await atividadeDoContato(api, req.params.id, req.params.atividadeId);
    await api.delete(`/api/contato_interacoes/${antes.id}`);
    await historico.registrarNoContato(api, req.params.id, [{
      tipo: 'interacao', acao: 'excluiu', entidade: `${antes.tipo} — ${antes.resumo}`,
      valor_anterior: [antes.resumo, antes.detalhe].filter(Boolean).join(' · '),
      detalhe: { campos: retratoDaAtividade(antes) }
    }], usuarioDaRequisicao(req), { autores: [antes.usuario_id] });
    res.json({ success: true });
  } catch (err) {
    responder(res, err, 'DELETE /api/contatos/:id/interacoes/:atividadeId');
  }
});

// ---------------------------------------------------------------------------
// O "'" da linha do tempo do contato (29/09/2026): cita o que é LIGADO a ele —
// as pessoas, as atividades e, para quem vê a Contabilidade, os documentos
// recebidos, as contas a pagar e os arquivos deles (a tela abre cada um).
// ---------------------------------------------------------------------------
const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Pessoas e atividades do contato → os objetos que batem com a busca (puro; até 6 de cada). */
function citaveisDoContato({ busca = '', pessoas = [], interacoes = [], contatoId }) {
  const termo = semAcento(busca).replace(/\s+/g, ' ').trim();
  const bate = t => !termo || termo.split(' ').every(p => semAcento(t).includes(p));
  const doContato = x => x && String(x.contato_id) === String(contatoId);
  const itens = [];
  const pessoasDoContato = lista(pessoas).filter(doContato).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  for (const p of pessoasDoContato.filter(p => bate(`${p.nome} ${p.cargo || ''} ${p.email || ''}`)).slice(0, 6)) {
    itens.push({ tipo: 'pessoa', id: String(p.id), rotulo: `Pessoa: ${texto(p.nome)}${p.cargo ? ` (${texto(p.cargo)})` : ''}`.slice(0, 110), detalhe: texto(p.email || p.telefone_celular || p.telefone_fixo || '') });
  }
  const atividades = lista(interacoes).filter(doContato).sort((a, b) => String(b.data).localeCompare(String(a.data)) || Number(b.id) - Number(a.id));
  for (const a of atividades.filter(a => bate(`${a.tipo} ${a.resumo} ${a.detalhe || ''}`)).slice(0, 6)) {
    const quando = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(a.data || ''));
    itens.push({ tipo: 'interacao', id: String(a.id), rotulo: `Atividade: ${texto(a.tipo)} · ${texto(a.resumo)}`.slice(0, 110), detalhe: quando ? `${quando[3]}/${quando[2]}/${quando[1]}` : '' });
  }
  return itens;
}

router.get('/:id/citaveis', exigirPermissao('ctt.details.view'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const id = Number(req.params.id);
    const busca = String(req.query?.busca || '').slice(0, 80);
    const [pessoas, interacoes, permissoes] = await Promise.all([
      api.get('/api/contato_pessoas', { query: { contato_id: id } }).catch(() => []),
      api.get('/api/contato_interacoes', { query: { contato_id: id } }).catch(() => []),
      obterPermissoesEfetivas(req).catch(() => null)
    ]);
    // Documentos e contas só para quem vê a Contabilidade (é lá que eles abrem).
    const veContabilidade = Boolean(permissoes && permissoesRepo.can(permissoes, 'contabilidade.view'));
    const daContabilidade = veContabilidade
      ? (await require('./contabilidade/citaveis').carregar({ api, busca, contatoId: id }).catch(() => ({ itens: [] }))).itens
      : [];
    res.json({ itens: [...citaveisDoContato({ busca, pessoas, interacoes, contatoId: id }), ...daContabilidade] });
  } catch (err) {
    responder(res, err, 'GET /api/contatos/:id/citaveis');
  }
});

// ------------------------------------------------------------------ ficha

router.get('/:id', exigirPermissao('ctt.details.view'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const [contato, pessoas, tipos] = await Promise.all([
      api.get(`/api/contatos/${req.params.id}`),
      api.get('/api/contato_pessoas', { query: { contato_id: req.params.id } }).catch(() => []),
      lerTipos(api)
    ]);
    if (!contato || contato.error === 'Not found') return res.status(404).json({ error: 'Contato não encontrado' });
    res.json({
      contato: mapCompleto(contato, tipos),
      pessoas: lista(pessoas).filter(p => String(p.contato_id) === String(req.params.id)).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')),
      tipos
    });
  } catch (err) {
    responder(res, err, 'GET /api/contatos/:id');
  }
});

/** Cadastra o contato com as pessoas e grava quem cadastrou e o histórico (formulário e planilha). */
async function criarContato(api, payload, pessoas, tipos, usuarioId, { observacao = 'Cadastro inicial', pendencias = [] } = {}) {
  const criado = await api.post('/api/contatos', { ...payload, criado_por: usuarioId ?? null, criado_em: agora() });
  const contatoId = criado?.id || criado?.[0]?.id || criado?.data?.id;
  const limpas = (Array.isArray(pessoas) ? pessoas : []).map(limparPessoa);
  for (const p of limpas) await api.post('/api/contato_pessoas', { ...p, contato_id: contatoId, criado_em: agora() });
  // Sem aviso: quem cadastra é quem cria, e o contato não tem responsável.
  await historico.registrarNoContato(api, contatoId, historico.eventosDaCriacao(paraHistorico(payload, tipos), limpas, { observacao, pendencias }), usuarioId, false);
  return contatoId;
}

router.post('/', exigirPermissao(req => (Array.isArray(req.body?.pessoas) && req.body.pessoas.length ? ['ctt.create', 'ctt.person.add'] : ['ctt.create'])), async (req, res) => {
  try {
    const api = createApiClient(req);
    const tipos = await lerTipos(api);
    const payload = buildPayload(req.body, tipos);
    const repetido = await documentoJaUsado(api, payload);
    if (repetido) throw erroHttp(409, `Já existe o contato "${repetido.nome}" com este ${payload.cpf ? 'CPF' : 'CNPJ'}.`, { contato_id: repetido.id });
    const id = await criarContato(api, payload, req.body?.pessoas, tipos, usuarioDaRequisicao(req));
    res.json({ id });
  } catch (err) {
    responder(res, err, 'POST /api/contatos');
  }
});

/** O PUT também cria, altera e exclui PESSOAS: a rota pede o que o corpo manda fazer. */
function permissoesDeEdicao(req) {
  const corpo = req.body || {};
  const chaves = ['ctt.edit'];
  const tem = l => Array.isArray(l) && l.length > 0;
  if (tem(corpo.pessoasNovas)) chaves.push('ctt.person.add');
  if (tem(corpo.pessoasAtualizadas)) chaves.push('ctt.person.edit');
  if (tem(corpo.pessoasExcluidas)) chaves.push('ctt.person.remove');
  return chaves;
}

router.put('/:id', exigirPermissao(permissoesDeEdicao), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const [antes, pessoasAntes, tipos] = await Promise.all([
      api.get(`/api/contatos/${id}`).catch(() => null),
      api.get('/api/contato_pessoas', { query: { contato_id: id } }).catch(() => []),
      lerTipos(api)
    ]);
    if (!antes || antes.error) throw erroHttp(404, 'Contato não encontrado.');
    const payload = buildPayload({ ...req.body, tipo_pessoa: req.body?.tipo_pessoa ?? antes.tipo_pessoa }, tipos, { parcial: true });
    const repetido = await documentoJaUsado(api, payload, id);
    if (repetido) throw erroHttp(409, `Já existe o contato "${repetido.nome}" com este ${payload.cpf ? 'CPF' : 'CNPJ'}.`, { contato_id: repetido.id });
    await api.put(`/api/contatos/${id}`, { ...payload, atualizado_em: agora() });

    const pessoasNovas = (Array.isArray(req.body?.pessoasNovas) ? req.body.pessoasNovas : []).map(limparPessoa);
    for (const p of pessoasNovas) await api.post('/api/contato_pessoas', { ...p, contato_id: Number(id), criado_em: agora() });
    const pessoasAtualizadas = (Array.isArray(req.body?.pessoasAtualizadas) ? req.body.pessoasAtualizadas : [])
      .filter(p => p?.id && lista(pessoasAntes).some(a => String(a.id) === String(p.id)))
      .map(p => ({ id: p.id, ...limparPessoa(p) }));
    for (const p of pessoasAtualizadas) {
      const { id: pessoaId, ...campos } = p;
      await api.put(`/api/contato_pessoas/${pessoaId}`, campos);
    }
    const pessoasExcluidas = (Array.isArray(req.body?.pessoasExcluidas) ? req.body.pessoasExcluidas : [])
      .filter(pid => lista(pessoasAntes).some(a => String(a.id) === String(pid)));
    for (const pid of pessoasExcluidas) await api.delete(`/api/contato_pessoas/${pid}`);

    await historico.registrarNoContato(api, id, [
      ...historico.diferencasDoContato(paraHistorico(antes, tipos), paraHistorico(payload, tipos)),
      ...historico.eventosDasPessoas({ pessoasNovas, pessoasAtualizadas, pessoasExcluidas }, { pessoasAntes: lista(pessoasAntes) })
    ], usuarioDaRequisicao(req));
    res.json({ success: true });
  } catch (err) {
    responder(res, err, 'PUT /api/contatos/:id');
  }
});

router.delete('/:id', exigirPermissao('ctt.delete'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const contato = await api.get(`/api/contatos/${id}`).catch(() => null);
    if (!contato || contato.error) throw erroHttp(404, 'Contato não encontrado.');
    // As pessoas, atividades e a linha do tempo caem em cascata no banco
    // (ON DELETE CASCADE); aqui só o contato.
    await api.delete(`/api/contatos/${id}`);
    // Quem cadastrou fica sabendo (com o motivo, se veio).
    const motivo = String(req.body?.motivo || '').trim();
    await avisos.avisarDaFicha(api, {
      origem: 'contato', registroId: id, registro: contato, usuarioId: usuarioDaRequisicao(req),
      situacao: 'excluiu', nota: motivo ? `Motivo: ${motivo}` : null
    });
    res.json({ success: true });
  } catch (err) {
    responder(res, err, 'DELETE /api/contatos/:id');
  }
});

module.exports = router;
module.exports.buildPayload = buildPayload;
module.exports.mapBasico = mapBasico;
module.exports.mapCompleto = mapCompleto;
module.exports.criarContato = criarContato;
module.exports.importarContatos = importarContatos;
module.exports.citaveisDoContato = citaveisDoContato;
module.exports.SQL_FALTANDO = SQL_FALTANDO;
