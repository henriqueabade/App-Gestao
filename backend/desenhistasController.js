/**
 * Desenhistas das peças — /api/desenhistas (sql/desenhistas_producao_parcela.sql).
 *
 *   GET    /           os nomes, em ordem (o "Desenhado por" do cadastro de peça e as telas do royalty)
 *   POST   /           { nome } — prod.designer.create
 *   DELETE /:id        prod.designer.delete; recusa se alguma peça usa o nome
 *
 * O desenhista é só um nome (não é usuário do app) e vai gravado na peça
 * (`produtos.desenhado_por`), como a coleção. O Royalty de cada pedido é
 * pago ao desenhista de cada peça (financeiro/regras.js).
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao, exigirAlgumaPermissao } = require('./permissionsController');
const { usuarioDaRequisicao } = require('./cobrancaController');

const SQL_FALTANDO = 'Falta rodar sql/desenhistas_producao_parcela.sql no banco e reiniciar a API.';
const LEEM = ['prod.view', 'prod.create', 'prod.edit', 'prod.details.view', 'financeiro.comissao.view'];

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const limpar = nome => String(nome ?? '').replace(/\s+/g, ' ').trim();
const chave = nome => limpar(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

function tabelaAusente(err) {
  const bruto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.code || ''}`;
  return /42P01/.test(bruto) || (/desenhistas/.test(bruto) && /does not exist|não encontrada|não existe/i.test(bruto));
}

async function ler(api) {
  try {
    return lista(await api.get('/api/desenhistas')).filter(d => d && limpar(d.nome))
      .map(d => ({ id: d.id, nome: limpar(d.nome) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  } catch (e) {
    if (tabelaAusente(e)) throw erro(SQL_FALTANDO, 409, { sql_pendente: true });
    throw e;
  }
}

/** Quantas peças usam o nome (sem filtro na API: "Barral" e "barral" são o mesmo desenhista). */
async function pecasDoDesenhista(api, nome) {
  const linhas = lista(await api.get('/api/produtos', { query: { select: 'id,desenhado_por' } }));
  return linhas.filter(p => chave(p?.desenhado_por) === chave(nome)).length;
}

function responder(res, err, contexto) {
  const status = err?.status || 500;
  if (status >= 500) console.error(`Erro em ${contexto}:`, err);
  res.status(status).json({ error: err?.message || 'Erro interno nos desenhistas', ...(err?.extra || {}) });
}

function criarRouter() {
  const router = express.Router();

  router.get('/', exigirAlgumaPermissao(LEEM), async (req, res) => {
    try {
      res.json({ desenhistas: await ler(createApiClient(req)) });
    } catch (err) {
      responder(res, err, 'GET /api/desenhistas');
    }
  });

  router.post('/', exigirPermissao('prod.designer.create'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const nome = limpar(req.body?.nome).slice(0, 120);
      if (nome.length < 2) throw erro('Informe o nome do desenhista.');
      const existentes = await ler(api);
      const igual = existentes.find(d => chave(d.nome) === chave(nome));
      if (igual) throw erro(`${igual.nome} já está cadastrado.`, 409, { desenhista: igual });
      const criado = await api.post('/api/desenhistas', { nome, criado_por: usuarioDaRequisicao(req), criado_em: new Date().toISOString() });
      const id = criado?.id ?? criado?.[0]?.id ?? null;
      res.json({ desenhista: { id, nome }, desenhistas: await ler(api) });
    } catch (err) {
      responder(res, err, 'POST /api/desenhistas');
    }
  });

  router.delete('/:id', exigirPermissao('prod.designer.delete'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const alvo = (await ler(api)).find(d => String(d.id) === String(req.params.id));
      if (!alvo) throw erro('Desenhista não encontrado.', 404);
      const usadas = await pecasDoDesenhista(api, alvo.nome);
      if (usadas > 0) {
        throw erro(`${alvo.nome} é o desenhista de ${usadas === 1 ? '1 peça' : `${usadas} peças`}: troque o desenhista delas antes de excluir.`, 409, { dependente: true });
      }
      await api.delete(`/api/desenhistas/${alvo.id}`);
      res.json({ removido: alvo, desenhistas: await ler(api) });
    } catch (err) {
      responder(res, err, 'DELETE /api/desenhistas/:id');
    }
  });

  return router;
}

module.exports = criarRouter();
module.exports.criarRouter = criarRouter;
module.exports.chave = chave;
