// Rotas do módulo Prospecções (CRM).
//
// A prospecção é uma EMPRESA (entidade), não um contato solto. Os contatos,
// interações, notas e campanhas pendem dela.
//
// ---------------------------------------------------------------------------
// TRÊS LIMITAÇÕES DA API REMOTA MOLDAM TODO ESTE ARQUIVO
//
// O endpoint genérico da API (Santissimo-db-API/server.js, GET /api/:table)
// percorre a query string e só aproveita chaves que sejam NOME DE COLUNA REAL,
// montando `WHERE coluna = $n`. Disso decorre:
//
//   1. `order`, `limit`, `offset` e `select` são DESCARTADOS em silêncio.
//      -> toda ordenação e todo recorte acontecem aqui, depois de receber.
//
//   2. Não existe filtro por lista de ids. `?id=1&id=2` faz o Express montar um
//      array, a API compara `"id" = $1` contra ele e o Postgres estoura
//      ("cannot cast type array to integer"). -> para resolver vínculos,
//      buscamos a tabela de apoio inteira e casamos em memória, como já faz o
//      clientesController.
//
//   3. Não há agregação. -> os totais do funil são calculados aqui.
//
// (Ver DEV-ONBOARDING.md, seção 3.)
//
// ---------------------------------------------------------------------------
// SEM TRANSAÇÃO
//
// Cada chamada à API é uma requisição HTTP isolada; não há como abrir uma
// transação entre elas. Criar uma prospecção com contatos são N requisições.
// Onde a falha no meio deixaria lixo, desfazemos explicitamente — ver
// `POST /` e `POST /:id/converter`.

const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao, exigirSupAdmin, ehSupAdmin } = require('./permissionsController');
const { normalizarCamposNumericos } = require('./numeros');

const router = express.Router();

// ---------------------------------------------------------------------------
// Funil
// ---------------------------------------------------------------------------

/** Ordem oficial do funil. Espelha o CHECK de prospeccoes.etapa. */
const ETAPAS = [
  'Novo',
  'Contactado',
  'Qualificado',
  'Proposta',
  'Negociação',
  'Ganho',
  'Perdido'
];

/** Etapas terminais: uma vez aqui, a prospecção sai do pipeline ativo. */
const ETAPAS_TERMINAIS = new Set(['Ganho', 'Perdido']);

/** Probabilidade sugerida por etapa, usada quando quem chama não informa. */
const PROBABILIDADE_PADRAO = {
  'Novo': 10,
  'Contactado': 25,
  'Qualificado': 50,
  'Proposta': 65,
  'Negociação': 80,
  'Ganho': 100,
  'Perdido': 0
};

const TIPOS_INTERACAO = new Set([
  'Ligação', 'E-mail', 'Reunião', 'WhatsApp', 'Visita', 'Nota', 'Proposta',
  // Gerado ao concluir um passo planejado. Fica fora da lista oferecida no
  // formulário de interação: quem cria este tipo é o fluxo de conclusão.
  'Atividade realizada'
]);

const STATUS_CAMPANHA = new Set(['Planejada', 'Em andamento', 'Concluída', 'Cancelada']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const texto = v => (v === undefined || v === null ? null : String(v).trim() || null);

function erro(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

/** Ordena por data decrescente tolerando nulo — a API nunca ordena por nós. */
function porDataDesc(campo) {
  return (a, b) => {
    const va = a?.[campo] ? new Date(a[campo]).getTime() : 0;
    const vb = b?.[campo] ? new Date(b[campo]).getTime() : 0;
    return vb - va;
  };
}

/**
 * Mapa id -> nome dos usuários.
 *
 * Puxa a tabela inteira de propósito: não existe filtro por lista de ids na API
 * (limitação 2 no topo). Uma requisição para todos é muito melhor que uma por
 * responsável.
 */
async function carregarNomesDeUsuario(api) {
  try {
    const usuarios = await api.get('/api/usuarios');
    return new Map(
      (Array.isArray(usuarios) ? usuarios : []).map(u => [u.id, u.nome])
    );
  } catch (err) {
    // Nome de responsável é enfeite: a lista não pode cair por causa disso.
    console.warn('[prospeccoes] não foi possível resolver nomes de usuário:', err?.message || err);
    return new Map();
  }
}

function mapProspeccaoLista(row = {}, { nomes, contatoPrincipal }) {
  return {
    id: row.id,
    nome_fantasia: row.nome_fantasia,
    razao_social: row.razao_social,
    cnpj: row.cnpj,
    segmento: row.segmento,
    origem: row.origem,
    etapa: row.etapa,
    valor_estimado: Number(row.valor_estimado ?? 0),
    probabilidade: Number(row.probabilidade ?? 0),
    responsavel_id: row.responsavel_id ?? null,
    responsavel: row.responsavel_id ? (nomes.get(row.responsavel_id) || null) : null,
    proximo_passo: row.proximo_passo,
    proximo_passo_data: row.proximo_passo_data,
    cidade: row.end_cidade,
    estado: row.end_uf,
    pais: row.end_pais,
    status: row.status,
    cliente_id: row.cliente_id ?? null,
    atualizado_em: row.atualizado_em,
    criado_em: row.criado_em,
    // A anotação do cadastro aparece no popover (i) da grade. É a "Anotação"
    // da ficha — NÃO se confunde com as `prospeccao_notas`, que são o
    // histórico de notas do acompanhamento e vivem só no detalhe.
    anotacoes: row.anotacoes,
    // O contato principal alimenta a coluna de e-mail/telefone da grade sem
    // exigir que o front abra o detalhe de cada linha.
    contato_principal: contatoPrincipal
      ? {
          id: contatoPrincipal.id,
          nome: contatoPrincipal.nome,
          cargo: contatoPrincipal.cargo,
          email: contatoPrincipal.email,
          telefone_celular: contatoPrincipal.telefone_celular
        }
      : null
  };
}

/**
 * Totais do funil: contagem e valor por etapa, na ordem oficial.
 * Calculado aqui porque a API não agrega (limitação 3 no topo).
 */
function montarFunil(lista) {
  const base = ETAPAS.map(etapa => ({
    etapa,
    quantidade: 0,
    valor: 0,
    valor_ponderado: 0
  }));
  const porEtapa = new Map(base.map(b => [b.etapa, b]));

  for (const p of lista) {
    const alvo = porEtapa.get(p.etapa);
    if (!alvo) continue;
    const valor = Number(p.valor_estimado ?? 0);
    alvo.quantidade += 1;
    alvo.valor += valor;
    alvo.valor_ponderado += valor * (Number(p.probabilidade ?? 0) / 100);
  }

  const abertas = lista.filter(p => !ETAPAS_TERMINAIS.has(p.etapa));
  const ganhas = lista.filter(p => p.etapa === 'Ganho').length;
  const fechadas = ganhas + lista.filter(p => p.etapa === 'Perdido').length;

  return {
    etapas: base,
    total: lista.length,
    em_aberto: abertas.length,
    valor_em_aberto: abertas.reduce((s, p) => s + Number(p.valor_estimado ?? 0), 0),
    valor_ponderado: abertas.reduce(
      (s, p) => s + Number(p.valor_estimado ?? 0) * (Number(p.probabilidade ?? 0) / 100),
      0
    ),
    // Taxa sobre o que FECHOU, não sobre o total: incluir as em andamento no
    // denominador faria a taxa despencar toda vez que entrasse lead novo.
    taxa_conversao: fechadas ? Math.round((ganhas / fechadas) * 100) : 0
  };
}

/**
 * Monta o corpo que vai para a tabela `prospeccoes`.
 *
 * Campo que o chamador NÃO enviou fica de fora do payload — não vai como
 * `null`. A API remota grava toda coluna presente no corpo: com o
 * comportamento anterior, um PUT que só quisesse renomear a empresa mandava
 * `responsavel_id: null` junto e APAGAVA o responsável sem ninguém pedir.
 *
 * Para limpar um campo de propósito, mande-o explicitamente vazio: a chave
 * está presente e vira `null`, como deve ser.
 */
function montarPayload(dados = {}) {
  const tem = chave => Object.prototype.hasOwnProperty.call(dados, chave);
  const temEndereco = campo =>
    (dados.endereco && Object.prototype.hasOwnProperty.call(dados.endereco, campo));

  const payload = {};
  const por = (coluna, valor, presente) => {
    if (presente) payload[coluna] = valor;
  };

  por('nome_fantasia', texto(dados.nome_fantasia), tem('nome_fantasia'));
  por('razao_social', texto(dados.razao_social), tem('razao_social'));
  por('cnpj', texto(dados.cnpj), tem('cnpj'));
  por('inscricao_estadual', texto(dados.inscricao_estadual), tem('inscricao_estadual'));
  por('site', texto(dados.site), tem('site'));
  por('segmento', texto(dados.segmento), tem('segmento'));
  por('origem', texto(dados.origem), tem('origem'));
  por('valor_estimado', dados.valor_estimado ?? 0, tem('valor_estimado'));
  por('probabilidade', dados.probabilidade, tem('probabilidade'));
  por('responsavel_id', dados.responsavel_id ?? null, tem('responsavel_id'));
  por('proximo_passo', texto(dados.proximo_passo), tem('proximo_passo'));
  por('proximo_passo_data', dados.proximo_passo_data || null, tem('proximo_passo_data'));
  por('anotacoes', texto(dados.anotacoes), tem('anotacoes'));

  por('end_logradouro', texto(dados.endereco?.rua ?? dados.end_logradouro), temEndereco('rua') || tem('end_logradouro'));
  por('end_numero', texto(dados.endereco?.numero ?? dados.end_numero), temEndereco('numero') || tem('end_numero'));
  por('end_complemento', texto(dados.endereco?.complemento ?? dados.end_complemento), temEndereco('complemento') || tem('end_complemento'));
  por('end_bairro', texto(dados.endereco?.bairro ?? dados.end_bairro), temEndereco('bairro') || tem('end_bairro'));
  por('end_cidade', texto(dados.endereco?.cidade ?? dados.end_cidade), temEndereco('cidade') || tem('end_cidade'));
  por('end_uf', texto(dados.endereco?.estado ?? dados.end_uf), temEndereco('estado') || tem('end_uf'));
  por('end_pais', texto(dados.endereco?.pais ?? dados.end_pais), temEndereco('pais') || tem('end_pais'));
  por('end_cep', texto(dados.endereco?.cep ?? dados.end_cep), temEndereco('cep') || tem('end_cep'));

  // A etapa tem padrão porque toda prospecção nasce em alguma: no PUT ela é
  // sobrescrita pela atual logo adiante, e no POST 'Novo' é o certo.
  payload.etapa = texto(dados.etapa) || 'Novo';

  if (payload.probabilidade === undefined || payload.probabilidade === null) {
    payload.probabilidade = PROBABILIDADE_PADRAO[payload.etapa] ?? 0;
  }

  // O front manda decimal com vírgula em alguns campos; normaliza antes de gravar.
  normalizarCamposNumericos(payload, ['valor_estimado', 'probabilidade']);
  // `probabilidade` é SMALLINT: mandar 62.5 faria o Postgres arredondar por
  // conta própria e o valor lido de volta não bateria com o enviado.
  if (payload.probabilidade !== null && payload.probabilidade !== undefined) {
    payload.probabilidade = Math.round(payload.probabilidade);
  }
  return payload;
}

function montarPayloadContato(c = {}, prospeccaoId) {
  return {
    // Number(): o id vem de req.params como string, e a coluna é INTEGER.
    prospeccao_id: Number(prospeccaoId),
    nome: texto(c.nome),
    cargo: texto(c.cargo),
    email: texto(c.email),
    telefone_fixo: texto(c.telefone_fixo),
    telefone_celular: texto(c.telefone_celular),
    decisor: Boolean(c.decisor),
    principal: Boolean(c.principal),
    observacao: texto(c.observacao)
  };
}

/** Valida o que é obrigatório para CRIAR/EDITAR. Dados fiscais são opcionais. */
function validarProspeccao(payload) {
  if (!payload.nome_fantasia) throw erro(400, 'Informe o nome da empresa');
  if (!ETAPAS.includes(payload.etapa)) throw erro(400, `Etapa inválida: ${payload.etapa}`);
  const prob = Number(payload.probabilidade);
  if (!Number.isFinite(prob) || prob < 0 || prob > 100) {
    throw erro(400, 'Probabilidade deve estar entre 0 e 100');
  }
  if (Number(payload.valor_estimado) < 0) throw erro(400, 'Valor estimado não pode ser negativo');
}

/**
 * Só um contato pode ser `principal` (índice único parcial no banco). Se vierem
 * vários marcados, mantém o primeiro — melhor que devolver 500 vindo do banco.
 */
function normalizarPrincipais(contatos) {
  let jaTem = false;
  return contatos.map(c => {
    if (c.principal && !jaTem) {
      jaTem = true;
      return c;
    }
    return c.principal ? { ...c, principal: false } : c;
  });
}

// ---------------------------------------------------------------------------
// Histórico
//
// TUDO que acontece com a prospecção vira uma linha em `prospeccao_historico`,
// sempre com o valor anterior ao lado do novo. Em exclusão, o registro inteiro
// é fotografado em `detalhe` — é o que responde "o que era antes?" depois de o
// dado original deixar de existir.
//
// Registrar histórico NUNCA derruba a operação principal: um erro aqui é
// registrado no log e a ação segue. O oposto — perder a alteração porque a
// auditoria falhou — seria pior para quem está usando.
// ---------------------------------------------------------------------------

/** Campos da ficha que geram linha de histórico quando mudam. */
const CAMPOS_AUDITADOS = {
  nome_fantasia: 'Nome fantasia',
  razao_social: 'Razão social',
  cnpj: 'CNPJ',
  inscricao_estadual: 'Inscrição estadual',
  site: 'Site',
  segmento: 'Segmento',
  origem: 'Origem',
  etapa: 'Etapa do funil',
  valor_estimado: 'Valor estimado',
  probabilidade: 'Probabilidade',
  responsavel_id: 'Responsável',
  proximo_passo: 'Próximo passo',
  proximo_passo_data: 'Prazo do próximo passo',
  status: 'Situação',
  motivo_perda: 'Motivo da perda',
  anotacoes: 'Anotação',
  end_logradouro: 'Endereço · rua',
  end_numero: 'Endereço · número',
  end_complemento: 'Endereço · complemento',
  end_bairro: 'Endereço · bairro',
  end_cidade: 'Endereço · cidade',
  end_uf: 'Endereço · estado',
  end_pais: 'Endereço · país',
  end_cep: 'Endereço · CEP'
};

/** Campos monetários/percentuais: comparar como número, não como texto. */
const CAMPOS_NUMERICOS = new Set(['valor_estimado', 'probabilidade', 'responsavel_id']);
/** Colunas DATE: comparar só o dia, senão "2026-09-20" e o ISO completo diferem. */
const CAMPOS_DATA = new Set(['proximo_passo_data']);

/**
 * Deixa o valor comparável.
 *
 * Sem isto, `48000` (número, vindo do formulário) e `"48000.00"` (texto, vindo
 * do Postgres) contariam como alteração a cada gravação, e o histórico
 * encheria de mudanças que ninguém fez.
 */
function paraComparacao(campo, valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (CAMPOS_NUMERICOS.has(campo)) {
    const n = Number(valor);
    return Number.isFinite(n) ? String(n) : String(valor);
  }
  if (CAMPOS_DATA.has(campo)) return String(valor).slice(0, 10);
  return String(valor).trim() || null;
}

/** Grava um ou vários eventos. Silencioso em caso de falha, por decisão. */
async function registrarHistorico(api, prospeccaoId, eventos, usuarioId) {
  const lista = (Array.isArray(eventos) ? eventos : [eventos]).filter(Boolean);
  if (!lista.length) return;

  await Promise.all(lista.map(async evento => {
    try {
      await api.post('/api/prospeccao_historico', {
        prospeccao_id: Number(prospeccaoId),
        tipo: evento.tipo,
        acao: evento.acao,
        entidade: texto(evento.entidade),
        campo: texto(evento.campo),
        valor_anterior: evento.valor_anterior ?? null,
        valor_novo: evento.valor_novo ?? null,
        detalhe: evento.detalhe ?? null,
        observacao: texto(evento.observacao),
        usuario_id: usuarioId ?? null
      });
    } catch (err) {
      console.error('[prospeccoes] falha ao gravar histórico:', err?.message || err);
    }
  }));
}

/**
 * Compara a ficha antes e depois, devolvendo um evento por campo alterado.
 *
 * `nomes` resolve `responsavel_id` para o nome da pessoa: guardar "3 → 7" no
 * histórico não diria nada a quem for ler daqui a seis meses.
 */
function diferencasDaFicha(antes = {}, depois = {}, nomes = new Map()) {
  const eventos = [];
  for (const [campo, rotulo] of Object.entries(CAMPOS_AUDITADOS)) {
    if (!(campo in depois)) continue;
    const a = paraComparacao(campo, antes[campo]);
    const d = paraComparacao(campo, depois[campo]);
    if (a === d) continue;

    const humano = valor => {
      if (valor === null) return null;
      if (campo === 'responsavel_id') return nomes.get(Number(valor)) || `#${valor}`;
      return valor;
    };

    eventos.push({
      tipo: campo === 'etapa' ? 'etapa' : 'campo',
      acao: 'alterou',
      entidade: rotulo,
      campo,
      valor_anterior: humano(a),
      valor_novo: humano(d)
    });
  }
  return eventos;
}

/** Resumo curto de um contato, para rotular a linha do histórico. */
const rotuloContato = c => `Contato ${c?.nome || ''}`.trim();

/** Uma linha legível do contato, para o par anterior/novo do histórico. */
const resumoContato = c => [
  c?.nome,
  c?.cargo,
  c?.email,
  c?.telefone_celular,
  c?.principal ? 'principal' : null,
  c?.decisor ? 'decisor' : null
].filter(Boolean).join(' · ');

/** Registra a movimentação no funil. Mantido como atalho do caso mais comum. */
async function registrarEtapa(api, prospeccaoId, anterior, nova, observacao, usuarioId) {
  await registrarHistorico(api, prospeccaoId, {
    tipo: 'etapa',
    acao: anterior ? 'moveu' : 'criou',
    entidade: 'Etapa do funil',
    campo: 'etapa',
    valor_anterior: anterior || null,
    valor_novo: nova,
    observacao
  }, usuarioId);
}

/** Id do usuário autenticado, lido do JWT sem validar assinatura (só leitura). */
function usuarioDaRequisicao(req) {
  try {
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const parte = token.split('.')[1];
    if (!parte) return null;
    const json = Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload.id ?? payload.userId ?? payload.sub ?? null;
  } catch (_) {
    return null;
  }
}

async function buscarProspeccao(api, id) {
  const row = await api.get(`/api/prospeccoes/${id}`);
  if (!row || row.error === 'Not found') throw erro(404, 'Prospecção não encontrada');
  return row;
}

// ---------------------------------------------------------------------------
// LISTA + FUNIL
// ---------------------------------------------------------------------------

router.get('/lista', exigirPermissao('pros.view'), async (req, res) => {
  try {
    const api = createApiClient(req);

    // Três requisições independentes em paralelo: 1 RTT em vez de 3.
    const [prospeccoes, contatos, nomes] = await Promise.all([
      api.get('/api/prospeccoes'),
      api.get('/api/prospeccao_contatos').catch(() => []),
      carregarNomesDeUsuario(api)
    ]);

    const lista = Array.isArray(prospeccoes) ? prospeccoes : [];

    // Contato principal de cada prospecção, casado em memória (limitação 2).
    const principalPorProspeccao = new Map();
    for (const c of Array.isArray(contatos) ? contatos : []) {
      const atual = principalPorProspeccao.get(c.prospeccao_id);
      if (!atual || (c.principal && !atual.principal)) {
        principalPorProspeccao.set(c.prospeccao_id, c);
      }
    }

    // Por padrão a grade mostra só o pipeline ativo. Arquivadas (convertidas ou
    // perdidas) entram sob demanda — senão a lista só cresce e nunca esvazia.
    const incluirArquivadas = ['1', 'true', 'sim'].includes(
      String(req.query.incluirArquivadas || '').toLowerCase()
    );
    const visiveis = incluirArquivadas ? lista : lista.filter(p => p.status !== 'arquivada');

    const itens = visiveis
      .map(row =>
        mapProspeccaoLista(row, {
          nomes,
          contatoPrincipal: principalPorProspeccao.get(row.id)
        })
      )
      // Ordenação aqui, não na query: a API ignora `order` (limitação 1).
      .sort(porDataDesc('atualizado_em'));

    res.json({
      itens,
      // O funil considera TODAS as prospecções, inclusive arquivadas — sem elas
      // não existe taxa de conversão.
      funil: montarFunil(lista.map(p => mapProspeccaoLista(p, { nomes }))),
      etapas: ETAPAS
    });
  } catch (err) {
    console.error('Erro ao listar prospecções:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao listar prospecções' });
  }
});

// ---------------------------------------------------------------------------
// DETALHE COMPLETO
// ---------------------------------------------------------------------------

router.get('/:id', exigirPermissao('pros.details.view'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const prospeccao = await buscarProspeccao(api, id);

    // Filtro por prospeccao_id é igualdade em coluna real — isto a API faz.
    // Sete buscas independentes viram 1 RTT.
    const [contatos, interacoes, historico, notas, campanhas, anexos, orcamentos, nomes] =
      await Promise.all([
        api.get('/api/prospeccao_contatos', { query: { prospeccao_id: id } }).catch(() => []),
        api.get('/api/prospeccao_interacoes', { query: { prospeccao_id: id } }).catch(() => []),
        api.get('/api/prospeccao_historico', { query: { prospeccao_id: id } }).catch(() => []),
        api.get('/api/prospeccao_notas', { query: { prospeccao_id: id } }).catch(() => []),
        api.get('/api/prospeccao_campanhas', { query: { prospeccao_id: id } }).catch(() => []),
        api.get('/api/prospeccao_anexos', { query: { prospeccao_id: id } }).catch(() => []),
        api.get('/api/orcamentos', { query: { prospeccao_id: id } }).catch(() => []),
        carregarNomesDeUsuario(api)
      ]);

    const nome = uid => (uid ? nomes.get(uid) || null : null);

    res.json({
      prospeccao: {
        ...prospeccao,
        valor_estimado: Number(prospeccao.valor_estimado ?? 0),
        probabilidade: Number(prospeccao.probabilidade ?? 0),
        responsavel: nome(prospeccao.responsavel_id),
        criado_por_nome: nome(prospeccao.criado_por),
        endereco: {
          rua: prospeccao.end_logradouro,
          numero: prospeccao.end_numero,
          complemento: prospeccao.end_complemento,
          bairro: prospeccao.end_bairro,
          cidade: prospeccao.end_cidade,
          estado: prospeccao.end_uf,
          pais: prospeccao.end_pais,
          cep: prospeccao.end_cep
        }
      },
      // Principal primeiro, depois alfabético — a API não ordena nada.
      contatos: (contatos || []).sort((a, b) => {
        if (Boolean(b.principal) !== Boolean(a.principal)) return b.principal ? 1 : -1;
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
      }),
      interacoes: (interacoes || [])
        .map(i => ({ ...i, responsavel: nome(i.usuario_id) }))
        .sort(porDataDesc('data')),
      historico: (historico || [])
        .map(h => ({ ...h, responsavel: nome(h.usuario_id) }))
        .sort(porDataDesc('criado_em')),
      notas: (notas || [])
        .map(n => ({ ...n, autor: nome(n.usuario_id) }))
        .sort(porDataDesc('criado_em')),
      campanhas: (campanhas || []).sort(porDataDesc('data_envio')),
      // Só metadados: o conteúdo binário mora em prospeccao_anexo_conteudo e só
      // desce no download (ver comentário em sql/prospeccoes.sql).
      anexos: (anexos || []).sort(porDataDesc('criado_em')),
      orcamentos: orcamentos || [],
      etapas: ETAPAS
    });
  } catch (err) {
    console.error('Erro ao buscar prospecção:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao buscar prospecção' });
  }
});

// ---------------------------------------------------------------------------
// CRIAR
// ---------------------------------------------------------------------------

router.post(
  '/',
  exigirPermissao(req =>
    Array.isArray(req.body?.contatos) && req.body.contatos.length
      ? ['pros.create', 'pros.contact.add']
      : ['pros.create']
  ),
  async (req, res) => {
    const api = createApiClient(req);
    const usuarioId = usuarioDaRequisicao(req);
    let criadaId = null;

    try {
      const payload = montarPayload(req.body);
      validarProspeccao(payload);
      payload.criado_por = usuarioId ?? null;

      // Mesma empresa não pode estar em prospecção ativa duas vezes. O banco
      // tem índice único parcial, mas conferir antes devolve 409 em vez de 500.
      if (payload.cnpj) {
        const existentes = await api
          .get('/api/prospeccoes', { query: { cnpj: payload.cnpj } })
          .catch(() => []);
        if ((existentes || []).some(p => p.status === 'ativa')) {
          return res.status(409).json({ error: 'Já existe uma prospecção ativa para este CNPJ' });
        }
      }

      const criada = await api.post('/api/prospeccoes', payload);
      criadaId = criada?.id ?? criada?.[0]?.id;
      if (!criadaId) throw erro(500, 'A API não devolveu o id da prospecção criada');

      const contatos = normalizarPrincipais(
        (Array.isArray(req.body.contatos) ? req.body.contatos : []).filter(c => texto(c?.nome))
      );
      for (const c of contatos) {
        await api.post('/api/prospeccao_contatos', montarPayloadContato(c, criadaId));
      }

      await registrarHistorico(api, criadaId, [
        {
          tipo: 'criacao', acao: 'criou', entidade: 'Prospecção',
          valor_novo: payload.nome_fantasia,
          observacao: 'Cadastro inicial',
          detalhe: payload
        },
        {
          tipo: 'etapa', acao: 'criou', entidade: 'Etapa do funil', campo: 'etapa',
          valor_novo: payload.etapa
        },
        ...contatos.map(c => ({
          tipo: 'contato', acao: 'criou', entidade: rotuloContato(c), detalhe: c
        }))
      ], usuarioId);

      res.status(201).json({ id: criadaId });
    } catch (err) {
      // Sem transação (ver topo): se a prospecção entrou mas um contato falhou,
      // o registro ficaria meio pronto e invisível para quem tentasse recriar,
      // travado pelo índice único do CNPJ. Desfazemos — o CASCADE leva junto os
      // contatos que chegaram a entrar.
      if (criadaId) {
        try {
          await api.delete(`/api/prospeccoes/${criadaId}`);
        } catch (limpeza) {
          console.error(
            `[prospeccoes] prospecção ${criadaId} ficou órfã após falha e não pôde ser removida:`,
            limpeza?.message || limpeza
          );
        }
      }
      console.error('Erro ao criar prospecção:', err);
      res.status(err.status || 500).json({ error: err.message || 'Erro ao criar prospecção' });
    }
  }
);

// ---------------------------------------------------------------------------
// EDITAR
// ---------------------------------------------------------------------------

/**
 * O mesmo PUT edita a empresa E mexe nos contatos. Guardar só por `pros.edit`
 * deixaria quem pode editar a empresa criar e apagar contatos sem ter essas
 * permissões — mesmo raciocínio do clientesController.
 */
function permissoesDeEdicao(req) {
  const corpo = req.body || {};
  const chaves = ['pros.edit'];
  const tem = lista => Array.isArray(lista) && lista.length > 0;
  if (tem(corpo.contatosNovos)) chaves.push('pros.contact.add');
  if (tem(corpo.contatosAtualizados)) chaves.push('pros.contact.edit');
  if (tem(corpo.contatosExcluidos)) chaves.push('pros.contact.remove');
  return chaves;
}

router.put('/:id', exigirPermissao(permissoesDeEdicao), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const atual = await buscarProspeccao(api, id);

    const payload = montarPayload({ ...req.body, etapa: req.body.etapa || atual.etapa });
    validarProspeccao(payload);

    // A etapa não muda por aqui: mover no funil exige `pros.stage.update` e
    // grava histórico. Quem edita a ficha não deveria conseguir pular etapas.
    payload.etapa = atual.etapa;
    if (req.body.probabilidade === undefined || req.body.probabilidade === null) {
      payload.probabilidade = Number(atual.probabilidade ?? 0);
    }

    // Trocar o responsável é privativo do Sup Admin. Sem esta trava, o botão
    // restrito na grade seria decorativo: bastaria abrir "Editar" e mudar o
    // campo para contornar a regra.
    if ('responsavel_id' in payload
        && Number(payload.responsavel_id ?? 0) !== Number(atual.responsavel_id ?? 0)
        && !(await ehSupAdmin(req))) {
      throw erro(403, 'Somente o Sup Admin pode alterar o responsável pela prospecção');
    }

    // Nomes resolvidos ANTES de gravar: o histórico mostra "Maria -> João",
    // não "3 -> 7".
    const nomes = await carregarNomesDeUsuario(api);
    const eventos = diferencasDaFicha(atual, payload, nomes);

    await api.put(`/api/prospeccoes/${id}`, payload);

    for (const c of Array.isArray(req.body.contatosNovos) ? req.body.contatosNovos : []) {
      if (!texto(c?.nome)) continue;
      await api.post('/api/prospeccao_contatos', montarPayloadContato(c, id));
      eventos.push({ tipo: 'contato', acao: 'criou', entidade: rotuloContato(c), detalhe: c });
    }

    for (const c of Array.isArray(req.body.contatosAtualizados) ? req.body.contatosAtualizados : []) {
      if (!c?.id) continue;
      // Lê o estado anterior ANTES de sobrescrever — é a única chance.
      const antes = await api.get(`/api/prospeccao_contatos/${c.id}`).catch(() => null);
      await api.put(`/api/prospeccao_contatos/${c.id}`, montarPayloadContato(c, id));
      eventos.push({
        tipo: 'contato', acao: 'alterou', entidade: rotuloContato(c),
        valor_anterior: antes ? resumoContato(antes) : null,
        valor_novo: resumoContato(c),
        detalhe: { antes, depois: c }
      });
    }

    for (const contatoId of Array.isArray(req.body.contatosExcluidos) ? req.body.contatosExcluidos : []) {
      if (!contatoId) continue;
      const antes = await api.get(`/api/prospeccao_contatos/${contatoId}`).catch(() => null);
      await api.delete(`/api/prospeccao_contatos/${contatoId}`);
      eventos.push({
        tipo: 'contato', acao: 'excluiu',
        entidade: rotuloContato(antes || {}),
        valor_anterior: antes ? resumoContato(antes) : null,
        detalhe: antes
      });
    }

    await registrarHistorico(api, id, eventos, usuarioDaRequisicao(req));

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar prospecção:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao atualizar prospecção' });
  }
});

// ---------------------------------------------------------------------------
// MOVER NO FUNIL
// ---------------------------------------------------------------------------

router.patch('/:id/etapa', exigirPermissao('pros.stage.update'), async (req, res) => {
  const { id } = req.params;
  const novaEtapa = texto(req.body?.etapa);
  try {
    if (!ETAPAS.includes(novaEtapa)) throw erro(400, `Etapa inválida: ${novaEtapa}`);

    const api = createApiClient(req);
    const atual = await buscarProspeccao(api, id);
    if (atual.etapa === novaEtapa) return res.json({ success: true, semMudanca: true });

    // "Perdido" sem motivo vira um buraco no relatório: daqui a três meses
    // ninguém lembra por que caiu.
    const motivo = texto(req.body?.motivo_perda);
    if (novaEtapa === 'Perdido' && !motivo) {
      throw erro(400, 'Informe o motivo da perda');
    }

    const patch = {
      etapa: novaEtapa,
      probabilidade:
        req.body?.probabilidade ?? PROBABILIDADE_PADRAO[novaEtapa] ?? atual.probabilidade,
      motivo_perda: novaEtapa === 'Perdido' ? motivo : null
    };

    // Perdido sai do pipeline ativo na hora. Ganho só arquiva na conversão —
    // até lá segue visível para quem vai gerar o cliente.
    if (novaEtapa === 'Perdido') patch.status = 'arquivada';
    else if (atual.status === 'arquivada' && !atual.cliente_id) patch.status = 'ativa';

    normalizarCamposNumericos(patch, ['probabilidade']);
    await api.put(`/api/prospeccoes/${id}`, patch);

    const eventos = [{
      tipo: 'etapa', acao: 'moveu', entidade: 'Etapa do funil', campo: 'etapa',
      valor_anterior: atual.etapa, valor_novo: novaEtapa,
      observacao: req.body?.observacao || motivo
    }];
    if (Number(atual.probabilidade) !== Number(patch.probabilidade)) {
      eventos.push({
        tipo: 'campo', acao: 'alterou', entidade: 'Probabilidade', campo: 'probabilidade',
        valor_anterior: String(atual.probabilidade ?? ''), valor_novo: String(patch.probabilidade)
      });
    }
    if (patch.status && patch.status !== atual.status) {
      eventos.push({
        tipo: 'arquivamento', acao: 'alterou', entidade: 'Situação', campo: 'status',
        valor_anterior: atual.status, valor_novo: patch.status
      });
    }
    if (novaEtapa === 'Perdido' && motivo) {
      eventos.push({
        tipo: 'campo', acao: 'alterou', entidade: 'Motivo da perda', campo: 'motivo_perda',
        valor_anterior: atual.motivo_perda || null, valor_novo: motivo
      });
    }
    await registrarHistorico(api, id, eventos, usuarioDaRequisicao(req));

    res.json({ success: true, etapa: novaEtapa });
  } catch (err) {
    console.error('Erro ao mover prospecção no funil:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao mover prospecção' });
  }
});

// ---------------------------------------------------------------------------
// PRÓXIMO PASSO
// ---------------------------------------------------------------------------

/**
 * Fecha o passo planejado transformando-o numa atividade da timeline.
 *
 * "Ligar para o Ricardo" não é uma ligação, um e-mail nem uma reunião — é o
 * CUMPRIMENTO de um combinado. Por isso o tipo próprio: encaixá-lo num dos
 * outros falsearia o relatório de atividades. O texto do passo é guardado em
 * `passo_planejado`, ao lado do que de fato aconteceu, para depois dar para
 * comparar combinado x realizado.
 *
 * Devolve os eventos de histórico para quem chamou registrar em bloco.
 */
async function concluirPassoPlanejado(api, id, prospeccao, { nota, data, contatoId }, usuarioId) {
  const passo = texto(prospeccao.proximo_passo);
  if (!passo) return [];

  const quando = data || new Date().toISOString();
  await api.post('/api/prospeccao_interacoes', {
    prospeccao_id: Number(id),
    contato_id: contatoId ?? null,
    tipo: 'Atividade realizada',
    data: quando,
    resumo: passo,
    detalhe: texto(nota),
    passo_planejado: passo,
    passo_planejado_data: prospeccao.proximo_passo_data || null,
    usuario_id: usuarioId ?? null
  });

  return [{
    tipo: 'interacao', acao: 'criou',
    entidade: `Atividade realizada — ${passo}`,
    valor_anterior: passo,
    valor_novo: texto(nota) || 'Concluído',
    observacao: 'Passo planejado concluído',
    detalhe: { passo_planejado: passo, passo_planejado_data: prospeccao.proximo_passo_data || null, nota: texto(nota) }
  }];
}

router.put('/:id/proximo-passo', exigirPermissao('pros.next.step'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const alvo = await buscarProspeccao(api, id);
    const usuarioId = usuarioDaRequisicao(req);
    const novoPasso = texto(req.body?.proximo_passo);
    const novaData = req.body?.proximo_passo_data || null;

    // Trocar o passo sem dizer o que houve com o anterior faz a timeline
    // perder o combinado. Quando existe passo em aberto, a nota é obrigatória.
    const notaAnterior = texto(req.body?.nota_passo_anterior);
    const tinhaPasso = Boolean(texto(alvo.proximo_passo));
    if (tinhaPasso && novoPasso && !notaAnterior) {
      throw erro(400, 'Descreva o que aconteceu com o passo anterior antes de definir o próximo');
    }

    const eventos = tinhaPasso && notaAnterior
      ? await concluirPassoPlanejado(api, id, alvo, { nota: notaAnterior }, usuarioId)
      : [];

    await api.put(`/api/prospeccoes/${id}`, {
      proximo_passo: novoPasso,
      proximo_passo_data: novaData
    });

    eventos.push(...diferencasDaFicha(alvo, { proximo_passo: novoPasso, proximo_passo_data: novaData }));
    await registrarHistorico(api, id, eventos, usuarioId);

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao definir próximo passo:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao definir próximo passo' });
  }
});

/**
 * Concluir o passo planejado e decidir o rumo da prospecção.
 *
 * Três desfechos possíveis, exclusivos entre si:
 *   • mover para outra etapa do funil;
 *   • marcar para conversão em cliente (a conversão em si segue pelo fluxo
 *     próprio, que valida os dados fiscais);
 *   • só concluir, sem mexer no funil.
 *
 * As permissões são cobradas conforme o que o corpo pede: mover exige
 * `pros.stage.update`, e definir o próximo passo exige `pros.next.step`.
 */
function permissoesDeConclusao(req) {
  const chaves = ['pros.interaction.add'];
  if (texto(req.body?.etapa)) chaves.push('pros.stage.update');
  if (req.body?.proximo_passo !== undefined) chaves.push('pros.next.step');
  return chaves;
}

router.post('/:id/concluir-passo', exigirPermissao(permissoesDeConclusao), async (req, res) => {
  const { id } = req.params;
  try {
    const nota = texto(req.body?.nota);
    if (!nota) throw erro(400, 'Descreva o que aconteceu');

    const api = createApiClient(req);
    const usuarioId = usuarioDaRequisicao(req);
    const alvo = await buscarProspeccao(api, id);

    if (!texto(alvo.proximo_passo)) {
      throw erro(400, 'Não há passo planejado para concluir');
    }

    const eventos = await concluirPassoPlanejado(api, id, alvo, {
      nota,
      data: req.body?.data,
      contatoId: req.body?.contato_id ?? null
    }, usuarioId);

    // --- desfecho: nova etapa (opcional) ---
    const novaEtapa = texto(req.body?.etapa);
    if (novaEtapa) {
      if (!ETAPAS.includes(novaEtapa)) throw erro(400, `Etapa inválida: ${novaEtapa}`);
      const motivo = texto(req.body?.motivo_perda);
      if (novaEtapa === 'Perdido' && !motivo) throw erro(400, 'Informe o motivo da perda');

      if (novaEtapa !== alvo.etapa) {
        const patch = {
          etapa: novaEtapa,
          probabilidade: PROBABILIDADE_PADRAO[novaEtapa] ?? alvo.probabilidade,
          motivo_perda: novaEtapa === 'Perdido' ? motivo : null
        };
        if (novaEtapa === 'Perdido') patch.status = 'arquivada';
        await api.put(`/api/prospeccoes/${id}`, patch);

        eventos.push({
          tipo: 'etapa', acao: 'moveu', entidade: 'Etapa do funil', campo: 'etapa',
          valor_anterior: alvo.etapa, valor_novo: novaEtapa,
          observacao: 'Definida ao concluir o passo planejado'
        });
        if (Number(alvo.probabilidade) !== Number(patch.probabilidade)) {
          eventos.push({
            tipo: 'campo', acao: 'alterou', entidade: 'Probabilidade', campo: 'probabilidade',
            valor_anterior: String(alvo.probabilidade ?? ''), valor_novo: String(patch.probabilidade)
          });
        }
        if (patch.status) {
          eventos.push({
            tipo: 'arquivamento', acao: 'alterou', entidade: 'Situação', campo: 'status',
            valor_anterior: alvo.status, valor_novo: patch.status
          });
        }
      }
    }

    // --- próximo passo (opcional) ---
    // A chave presente é o que sinaliza intenção: enviar vazio à toa apagaria
    // um passo que ninguém pediu para apagar.
    let proximoPasso = null;
    if (req.body?.proximo_passo !== undefined) {
      proximoPasso = texto(req.body.proximo_passo);
      const proximaData = req.body?.proximo_passo_data || null;
      await api.put(`/api/prospeccoes/${id}`, {
        proximo_passo: proximoPasso,
        proximo_passo_data: proximaData
      });
      eventos.push(...diferencasDaFicha(alvo, {
        proximo_passo: proximoPasso, proximo_passo_data: proximaData
      }));
    } else {
      // Sem novo passo, o antigo não pode continuar em aberto: ele acabou de
      // ser concluído e ficaria eternamente marcado como pendente.
      await api.put(`/api/prospeccoes/${id}`, { proximo_passo: null, proximo_passo_data: null });
      eventos.push(...diferencasDaFicha(alvo, { proximo_passo: null, proximo_passo_data: null }));
    }

    await registrarHistorico(api, id, eventos, usuarioId);

    // `converter` é só um sinal para a interface abrir o fluxo de conversão,
    // que valida os dados fiscais e pede status e dono do cliente. Converter
    // aqui, por baixo, pularia essas checagens.
    res.json({
      success: true,
      etapa: novaEtapa || alvo.etapa,
      converter: Boolean(req.body?.converter)
    });
  } catch (err) {
    console.error('Erro ao concluir passo planejado:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao concluir passo' });
  }
});

// ---------------------------------------------------------------------------
// INTERAÇÕES
// ---------------------------------------------------------------------------

router.post('/:id/interacoes', exigirPermissao('pros.interaction.add'), async (req, res) => {
  const { id } = req.params;
  try {
    const tipo = texto(req.body?.tipo);
    const resumo = texto(req.body?.resumo);
    if (!TIPOS_INTERACAO.has(tipo)) throw erro(400, `Tipo de interação inválido: ${tipo}`);
    if (!resumo) throw erro(400, 'Informe um resumo da interação');

    const api = createApiClient(req);
    await buscarProspeccao(api, id);

    // Sem esta conferência dava para pendurar a interação no contato de OUTRA
    // prospecção: a FK aponta para prospeccao_contatos, mas nada garante que o
    // contato seja desta prospecção.
    const contatoId = req.body?.contato_id ?? null;
    if (contatoId) {
      const contato = await api.get(`/api/prospeccao_contatos/${contatoId}`).catch(() => null);
      if (!contato || Number(contato.prospeccao_id) !== Number(id)) {
        throw erro(400, 'Contato não pertence a esta prospecção');
      }
    }

    const criada = await api.post('/api/prospeccao_interacoes', {
      prospeccao_id: Number(id),
      contato_id: contatoId,
      tipo,
      data: req.body?.data || new Date().toISOString(),
      resumo,
      detalhe: texto(req.body?.detalhe),
      duracao_min: req.body?.duracao_min ?? null,
      usuario_id: usuarioDaRequisicao(req)
    });

    // Registrar contato costuma vir junto de "e o próximo passo é...". Aceitar
    // os dois no mesmo POST evita a segunda ida à rede e o risco de esquecer.
    if (req.body?.proximo_passo !== undefined) {
      await api.put(`/api/prospeccoes/${id}`, {
        proximo_passo: texto(req.body.proximo_passo),
        proximo_passo_data: req.body?.proximo_passo_data || null
      });
    }

    await registrarHistorico(api, id, {
      tipo: 'interacao', acao: 'criou',
      entidade: `${tipo} — ${resumo}`,
      valor_novo: resumo,
      detalhe: { tipo, resumo, detalhe: texto(req.body?.detalhe), duracao_min: req.body?.duracao_min ?? null }
    }, usuarioDaRequisicao(req));

    res.status(201).json({ id: criada?.id ?? null });
  } catch (err) {
    console.error('Erro ao registrar interação:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao registrar interação' });
  }
});

// ---------------------------------------------------------------------------
// NOTAS
// ---------------------------------------------------------------------------

router.post('/:id/notas', exigirPermissao('pros.note.add'), async (req, res) => {
  const { id } = req.params;
  try {
    const conteudo = texto(req.body?.conteudo);
    if (!conteudo) throw erro(400, 'A nota não pode estar vazia');

    const api = createApiClient(req);
    await buscarProspeccao(api, id);

    const criada = await api.post('/api/prospeccao_notas', {
      prospeccao_id: Number(id),
      titulo: texto(req.body?.titulo),
      conteudo,
      usuario_id: usuarioDaRequisicao(req)
    });

    await registrarHistorico(api, id, {
      tipo: 'nota', acao: 'criou',
      entidade: texto(req.body?.titulo) || 'Nota',
      valor_novo: conteudo,
      detalhe: { titulo: texto(req.body?.titulo), conteudo }
    }, usuarioDaRequisicao(req));

    res.status(201).json({ id: criada?.id ?? null });
  } catch (err) {
    console.error('Erro ao adicionar nota:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao adicionar nota' });
  }
});

router.delete('/:id/notas/:notaId', exigirPermissao('pros.note.remove'), async (req, res) => {
  const { id, notaId } = req.params;
  try {
    const api = createApiClient(req);

    // Sem esta conferência, /prospeccoes/1/notas/999 apagaria a nota 999 de
    // OUTRA prospecção — o id do caminho não é validado por ninguém.
    const nota = await api.get(`/api/prospeccao_notas/${notaId}`).catch(() => null);
    if (!nota || nota.error === 'Not found') throw erro(404, 'Nota não encontrada');
    if (Number(nota.prospeccao_id) !== Number(id)) {
      throw erro(404, 'Nota não pertence a esta prospecção');
    }

    await api.delete(`/api/prospeccao_notas/${notaId}`);

    // Fotografia ANTES de apagar: sem isto ninguém mais consegue responder o
    // que a nota dizia.
    await registrarHistorico(api, id, {
      tipo: 'nota', acao: 'excluiu',
      entidade: texto(nota.titulo) || 'Nota',
      valor_anterior: nota.conteudo,
      detalhe: nota
    }, usuarioDaRequisicao(req));

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao remover nota:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao remover nota' });
  }
});

// ---------------------------------------------------------------------------
// CAMPANHAS
// ---------------------------------------------------------------------------

router.post('/:id/campanhas', exigirPermissao('pros.campaign.manage'), async (req, res) => {
  const { id } = req.params;
  try {
    const nome = texto(req.body?.nome);
    if (!nome) throw erro(400, 'Informe o nome da campanha');
    const status = texto(req.body?.status) || 'Planejada';
    if (!STATUS_CAMPANHA.has(status)) throw erro(400, `Status de campanha inválido: ${status}`);

    const api = createApiClient(req);
    await buscarProspeccao(api, id);

    const criada = await api.post('/api/prospeccao_campanhas', {
      prospeccao_id: Number(id),
      nome,
      canal: texto(req.body?.canal),
      status,
      data_envio: req.body?.data_envio || null,
      resposta: texto(req.body?.resposta),
      observacao: texto(req.body?.observacao),
      usuario_id: usuarioDaRequisicao(req)
    });

    await registrarHistorico(api, id, {
      tipo: 'campanha', acao: 'criou',
      entidade: `Campanha ${nome}`,
      valor_novo: [nome, texto(req.body?.canal), status].filter(Boolean).join(' · '),
      detalhe: criada || { nome, status }
    }, usuarioDaRequisicao(req));

    res.status(201).json({ id: criada?.id ?? null });
  } catch (err) {
    console.error('Erro ao registrar campanha:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao registrar campanha' });
  }
});

router.delete('/:id/campanhas/:campanhaId', exigirPermissao('pros.campaign.manage'), async (req, res) => {
  const { id, campanhaId } = req.params;
  try {
    const api = createApiClient(req);
    const campanha = await api.get(`/api/prospeccao_campanhas/${campanhaId}`).catch(() => null);
    if (!campanha || campanha.error === 'Not found') throw erro(404, 'Campanha não encontrada');
    if (Number(campanha.prospeccao_id) !== Number(id)) {
      throw erro(404, 'Campanha não pertence a esta prospecção');
    }

    await api.delete(`/api/prospeccao_campanhas/${campanhaId}`);

    // A campanha some da lista, mas o histórico guarda o registro inteiro.
    await registrarHistorico(api, id, {
      tipo: 'campanha', acao: 'excluiu',
      entidade: `Campanha ${campanha.nome || ''}`.trim(),
      valor_anterior: [campanha.nome, campanha.canal, campanha.status, campanha.resposta]
        .filter(Boolean).join(' · '),
      detalhe: campanha
    }, usuarioDaRequisicao(req));

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao remover campanha:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao remover campanha' });
  }
});

// ---------------------------------------------------------------------------
// CONVERTER EM CLIENTE
// ---------------------------------------------------------------------------

router.post('/:id/converter', exigirPermissao(['pros.convert', 'cli.create']), async (req, res) => {
  const { id } = req.params;
  const api = createApiClient(req);
  const usuarioId = usuarioDaRequisicao(req);
  let clienteCriadoId = null;

  try {
    const p = await buscarProspeccao(api, id);
    if (p.cliente_id) {
      return res.status(409).json({
        error: 'Esta prospecção já foi convertida',
        clienteId: p.cliente_id
      });
    }

    // Aqui os dados fiscais deixam de ser opcionais: o cadastro de cliente
    // exige. É de propósito que a cobrança só apareça neste ponto — prospectar
    // um lead de feira sem CNPJ tem que continuar possível.
    const faltando = [];
    if (!texto(p.razao_social)) faltando.push('Razão Social');
    if (!texto(p.nome_fantasia)) faltando.push('Nome Fantasia');
    if (!texto(p.cnpj)) faltando.push('CNPJ');
    if (faltando.length) {
      return res.status(422).json({
        error: `Complete os dados da empresa antes de converter: ${faltando.join(', ')}`,
        camposFaltantes: faltando
      });
    }

    const duplicados = await api.get('/api/clientes', { query: { cnpj: p.cnpj } }).catch(() => []);
    if (Array.isArray(duplicados) && duplicados.length) {
      return res.status(409).json({ error: 'Já existe um cliente com este CNPJ' });
    }

    const contatos = await api
      .get('/api/prospeccao_contatos', { query: { prospeccao_id: id } })
      .catch(() => []);

    // O endereço da prospecção é único; o cliente tem três. Replicamos nos três
    // e a pessoa ajusta depois no módulo Clientes.
    const endereco = {
      logradouro: p.end_logradouro, numero: p.end_numero, complemento: p.end_complemento,
      bairro: p.end_bairro, cidade: p.end_cidade, uf: p.end_uf, pais: p.end_pais, cep: p.end_cep
    };
    const espalhar = prefixo =>
      Object.fromEntries(Object.entries(endereco).map(([k, v]) => [`${prefixo}_${k}`, v]));

    const cliente = await api.post('/api/clientes', {
      razao_social: p.razao_social,
      nome_fantasia: p.nome_fantasia,
      cnpj: p.cnpj,
      inscricao_estadual: p.inscricao_estadual,
      site: p.site,
      status_cliente: texto(req.body?.status_cliente) || 'Ativo',
      dono_cliente: texto(req.body?.dono_cliente) || null,
      origem_captacao: p.origem,
      anotacoes: p.anotacoes,
      ...espalhar('reg'),
      ...espalhar('cob'),
      ...espalhar('ent')
    });

    clienteCriadoId = cliente?.id ?? cliente?.[0]?.id;
    if (!clienteCriadoId) throw erro(500, 'A API não devolveu o id do cliente criado');

    for (const c of Array.isArray(contatos) ? contatos : []) {
      await api.post('/api/contatos_cliente', {
        id_cliente: clienteCriadoId,
        nome: c.nome,
        cargo: c.cargo,
        telefone_celular: c.telefone_celular,
        telefone_fixo: c.telefone_fixo,
        email: c.email
      });
    }

    // A prospecção NÃO é apagada: vira Ganho e arquiva, guardando a timeline de
    // como o negócio foi fechado.
    await api.put(`/api/prospeccoes/${id}`, {
      etapa: 'Ganho',
      probabilidade: 100,
      status: 'arquivada',
      cliente_id: clienteCriadoId,
      convertida_em: new Date().toISOString()
    });

    await registrarHistorico(api, id, [
      {
        tipo: 'conversao', acao: 'converteu', entidade: 'Conversão em cliente',
        valor_anterior: 'Prospecção', valor_novo: `Cliente #${clienteCriadoId}`,
        observacao: `${(Array.isArray(contatos) ? contatos : []).length} contato(s) copiado(s)`,
        detalhe: { clienteId: clienteCriadoId, status_cliente: texto(req.body?.status_cliente) || 'Ativo', dono_cliente: texto(req.body?.dono_cliente) }
      },
      {
        tipo: 'etapa', acao: 'moveu', entidade: 'Etapa do funil', campo: 'etapa',
        valor_anterior: p.etapa, valor_novo: 'Ganho'
      },
      {
        tipo: 'arquivamento', acao: 'alterou', entidade: 'Situação', campo: 'status',
        valor_anterior: p.status, valor_novo: 'arquivada'
      }
    ], usuarioId);

    res.status(201).json({ clienteId: clienteCriadoId });
  } catch (err) {
    // Sem transação: se o cliente entrou mas a prospecção não fechou, ficariam
    // os dois vivos e o próximo "Converter" esbarraria no CNPJ duplicado.
    if (clienteCriadoId) {
      try {
        await api.delete(`/api/clientes/${clienteCriadoId}`);
      } catch (limpeza) {
        console.error(
          `[prospeccoes] cliente ${clienteCriadoId} ficou órfão após falha na conversão:`,
          limpeza?.message || limpeza
        );
      }
    }
    console.error('Erro ao converter prospecção:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao converter prospecção' });
  }
});

// ---------------------------------------------------------------------------
// RESPONSÁVEL
//
// Trocar quem cuida da prospecção é decisão de gestão, não de operação: por
// isso `exigirSupAdmin` ALÉM da permissão do módulo.
//
// `criado_por` NUNCA muda. São coisas diferentes: quem cadastrou é fato
// histórico, quem responde hoje é atribuição. Sobrescrever o primeiro apagaria
// a origem do registro.
// ---------------------------------------------------------------------------

router.put(
  '/:id/responsavel',
  exigirPermissao('pros.edit'),
  exigirSupAdmin,
  async (req, res) => {
    const { id } = req.params;
    try {
      const api = createApiClient(req);
      const alvo = await buscarProspeccao(api, id);

      const bruto = req.body?.responsavel_id;
      const novo = bruto === null || bruto === '' || bruto === undefined ? null : Number(bruto);
      if (novo !== null && !Number.isFinite(novo)) throw erro(400, 'Responsável inválido');

      if (Number(alvo.responsavel_id ?? 0) === Number(novo ?? 0)) {
        return res.json({ success: true, semMudanca: true });
      }

      const nomes = await carregarNomesDeUsuario(api);
      if (novo !== null && !nomes.has(novo)) throw erro(400, 'Usuário não encontrado');

      // Só o responsável entra no corpo: `montarPayload` não é usado aqui de
      // propósito, para não haver caminho que roce em `criado_por`.
      await api.put(`/api/prospeccoes/${id}`, { responsavel_id: novo });

      await registrarHistorico(api, id, {
        tipo: 'responsavel', acao: 'alterou',
        entidade: 'Responsável', campo: 'responsavel_id',
        valor_anterior: alvo.responsavel_id ? (nomes.get(Number(alvo.responsavel_id)) || `#${alvo.responsavel_id}`) : null,
        valor_novo: novo ? (nomes.get(novo) || `#${novo}`) : null,
        observacao: texto(req.body?.observacao)
      }, usuarioDaRequisicao(req));

      res.json({ success: true });
    } catch (err) {
      console.error('Erro ao trocar responsável:', err);
      res.status(err.status || 500).json({ error: err.message || 'Erro ao trocar responsável' });
    }
  }
);

// ---------------------------------------------------------------------------
// HISTÓRICO
//
// A exclusão é restrita ao Sup Admin, e por isso usa `exigirSupAdmin` ALÉM da
// permissão do módulo: o histórico é a única defesa contra "não fui eu que
// mudei". Uma configuração equivocada de modelo de permissão não pode ser a
// única coisa entre o usuário e o apagamento da auditoria.
// ---------------------------------------------------------------------------

router.delete(
  '/:id/historico/:eventoId',
  exigirPermissao('pros.details.view'),
  exigirSupAdmin,
  async (req, res) => {
    const { id, eventoId } = req.params;
    try {
      const api = createApiClient(req);
      const evento = await api.get(`/api/prospeccao_historico/${eventoId}`).catch(() => null);
      if (!evento || evento.error === 'Not found') throw erro(404, 'Evento não encontrado');
      if (Number(evento.prospeccao_id) !== Number(id)) {
        throw erro(404, 'Evento não pertence a esta prospecção');
      }

      await api.delete(`/api/prospeccao_historico/${eventoId}`);
      res.json({ success: true });
    } catch (err) {
      console.error('Erro ao excluir evento do histórico:', err);
      res.status(err.status || 500).json({ error: err.message || 'Erro ao excluir evento' });
    }
  }
);

// ---------------------------------------------------------------------------
// EXCLUIR
// ---------------------------------------------------------------------------

router.delete('/:id', exigirPermissao('pros.delete'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const p = await buscarProspeccao(api, id);

    // Apagar uma prospecção convertida destruiria o histórico de como o cliente
    // foi conquistado — e o cliente continuaria lá, sem origem.
    if (p.cliente_id) {
      throw erro(400, 'Não é possível excluir: esta prospecção já virou cliente');
    }

    // orcamentos.prospeccao_id é ON DELETE SET NULL, então o orçamento
    // sobreviveria órfão. Mesma regra do módulo Clientes.
    const orcamentos = await api
      .get('/api/orcamentos', { query: { prospeccao_id: id } })
      .catch(() => []);
    if (Array.isArray(orcamentos) && orcamentos.length) {
      throw erro(400, 'Não é possível excluir: existem orçamentos vinculados');
    }

    // Contatos, interações, histórico, notas, anexos e campanhas caem por
    // ON DELETE CASCADE (ver sql/prospeccoes.sql) — uma chamada basta.
    await api.delete(`/api/prospeccoes/${id}`);

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir prospecção:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao excluir prospecção' });
  }
});

module.exports = router;
module.exports.ETAPAS = ETAPAS;
module.exports.PROBABILIDADE_PADRAO = PROBABILIDADE_PADRAO;
