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
const { exigirPermissao } = require('./permissionsController');
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
  'Ligação', 'E-mail', 'Reunião', 'WhatsApp', 'Visita', 'Nota', 'Proposta'
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

/** Monta o corpo que vai para a tabela `prospeccoes`. */
function montarPayload(dados = {}) {
  const payload = {
    nome_fantasia: texto(dados.nome_fantasia),
    razao_social: texto(dados.razao_social),
    cnpj: texto(dados.cnpj),
    inscricao_estadual: texto(dados.inscricao_estadual),
    site: texto(dados.site),
    segmento: texto(dados.segmento),
    origem: texto(dados.origem),
    etapa: texto(dados.etapa) || 'Novo',
    valor_estimado: dados.valor_estimado ?? 0,
    probabilidade: dados.probabilidade,
    responsavel_id: dados.responsavel_id ?? null,
    proximo_passo: texto(dados.proximo_passo),
    proximo_passo_data: dados.proximo_passo_data || null,
    end_logradouro: texto(dados.endereco?.rua ?? dados.end_logradouro),
    end_numero: texto(dados.endereco?.numero ?? dados.end_numero),
    end_complemento: texto(dados.endereco?.complemento ?? dados.end_complemento),
    end_bairro: texto(dados.endereco?.bairro ?? dados.end_bairro),
    end_cidade: texto(dados.endereco?.cidade ?? dados.end_cidade),
    end_uf: texto(dados.endereco?.estado ?? dados.end_uf),
    end_pais: texto(dados.endereco?.pais ?? dados.end_pais),
    end_cep: texto(dados.endereco?.cep ?? dados.end_cep),
    anotacoes: texto(dados.anotacoes)
  };

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

/** Registra a movimentação no funil. Nunca derruba a operação principal. */
async function registrarEtapa(api, prospeccaoId, anterior, nova, observacao, usuarioId) {
  try {
    await api.post('/api/prospeccao_etapas_historico', {
      prospeccao_id: prospeccaoId,
      etapa_anterior: anterior || null,
      etapa_nova: nova,
      observacao: texto(observacao),
      usuario_id: usuarioId ?? null
    });
  } catch (err) {
    console.error('[prospeccoes] falha ao gravar histórico de etapa:', err?.message || err);
  }
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
        api.get('/api/prospeccao_etapas_historico', { query: { prospeccao_id: id } }).catch(() => []),
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

      await registrarEtapa(api, criadaId, null, payload.etapa, 'Cadastro inicial', usuarioId);

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

    await api.put(`/api/prospeccoes/${id}`, payload);

    for (const c of Array.isArray(req.body.contatosNovos) ? req.body.contatosNovos : []) {
      if (!texto(c?.nome)) continue;
      await api.post('/api/prospeccao_contatos', montarPayloadContato(c, id));
    }

    for (const c of Array.isArray(req.body.contatosAtualizados) ? req.body.contatosAtualizados : []) {
      if (!c?.id) continue;
      await api.put(`/api/prospeccao_contatos/${c.id}`, montarPayloadContato(c, id));
    }

    for (const contatoId of Array.isArray(req.body.contatosExcluidos) ? req.body.contatosExcluidos : []) {
      if (!contatoId) continue;
      await api.delete(`/api/prospeccao_contatos/${contatoId}`);
    }

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

    await registrarEtapa(
      api, id, atual.etapa, novaEtapa,
      req.body?.observacao || motivo, usuarioDaRequisicao(req)
    );

    res.json({ success: true, etapa: novaEtapa });
  } catch (err) {
    console.error('Erro ao mover prospecção no funil:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao mover prospecção' });
  }
});

// ---------------------------------------------------------------------------
// PRÓXIMO PASSO
// ---------------------------------------------------------------------------

router.put('/:id/proximo-passo', exigirPermissao('pros.next.step'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    await buscarProspeccao(api, id);

    await api.put(`/api/prospeccoes/${id}`, {
      proximo_passo: texto(req.body?.proximo_passo),
      proximo_passo_data: req.body?.proximo_passo_data || null
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao definir próximo passo:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao definir próximo passo' });
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

    await registrarEtapa(
      api, id, p.etapa, 'Ganho',
      `Convertida no cliente #${clienteCriadoId}`, usuarioId
    );

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
