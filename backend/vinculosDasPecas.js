/**
 * Filtro avançado de Produtos, Orçamentos e Pedidos (pedido do dono, 08/10/2026):
 *
 *   - em Produtos, digita-se o nome do cliente ou o número do pedido e ficam
 *     só as peças que estão nos pedidos (e orçamentos) dele;
 *   - em Orçamentos e Pedidos, digita-se o cliente, o nome ou o código da peça
 *     e ficam só os documentos que têm essa peça.
 *
 * As listas das três telas não trazem os itens. Estas rotas devolvem, numa
 * leitura só, o elo peça ↔ documento que falta — e a tela filtra em memória,
 * enquanto a pessoa digita.
 *
 *   GET /api/vinculos-pecas/pedidos     (ped.view)  → { pecas: { [pedido_id]: [peça] } }
 *   GET /api/vinculos-pecas/orcamentos  (orc.view)  → { pecas: { [orcamento_id]: [peça] } }
 *   GET /api/vinculos-pecas/produtos    (prod.view) → { vinculos: { [produto_id]: [documento] } }
 *
 * Em Produtos, quem não pode ver Pedidos (ou Orçamentos) não recebe os
 * documentos daquele módulo: o filtro não pode virar uma porta lateral para o
 * número e o cliente de um pedido que a pessoa não enxerga.
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao, obterPermissoesEfetivas } = require('./permissionsController');
const permissoesRepo = require('./permissionsRepository');

const lista = r => (Array.isArray(r) ? r : []);
const texto = v => (v === undefined || v === null ? '' : String(v).trim());
const numero = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Peças de cada documento, sem repetir: a mesma peça lançada duas vezes no
 * pedido vira uma linha só, com as quantidades somadas.
 * `campo` é a coluna do documento no item ('pedido_id' ou 'orcamento_id').
 */
function pecasPorDocumento(itens, campo) {
  const porDocumento = new Map();
  for (const item of lista(itens)) {
    const doc = item?.[campo];
    if (doc === undefined || doc === null || doc === '') continue;
    const codigo = texto(item.codigo);
    const nome = texto(item.nome);
    if (!codigo && !nome) continue;
    const chaveDoc = String(doc);
    if (!porDocumento.has(chaveDoc)) porDocumento.set(chaveDoc, new Map());
    const pecas = porDocumento.get(chaveDoc);
    const chave = item.produto_id !== undefined && item.produto_id !== null && item.produto_id !== ''
      ? `id:${item.produto_id}`
      : `txt:${codigo.toUpperCase()}|${nome.toUpperCase()}`;
    const atual = pecas.get(chave) || { produto_id: item.produto_id ?? null, codigo, nome, quantidade: 0 };
    if (!atual.codigo && codigo) atual.codigo = codigo;
    if (!atual.nome && nome) atual.nome = nome;
    atual.quantidade += numero(item.quantidade);
    pecas.set(chave, atual);
  }
  const saida = {};
  for (const [doc, pecas] of porDocumento) saida[doc] = [...pecas.values()];
  return saida;
}

/** Nome de quem recebe o documento: o cliente ou, num OCRP, a prospecção. */
function nomeDoDestinatario(doc, clientes, prospeccoes) {
  if (doc?.cliente_id !== undefined && doc?.cliente_id !== null) {
    const nome = clientes.get(String(doc.cliente_id));
    if (nome) return nome;
  }
  if (doc?.prospeccao_id !== undefined && doc?.prospeccao_id !== null) {
    const nome = prospeccoes.get(String(doc.prospeccao_id));
    if (nome) return nome;
  }
  return '';
}

/**
 * Para cada peça (produto_id), os documentos em que ela está:
 * { tipo: 'pedido'|'orcamento', id, numero, cliente, situacao }.
 * Mais novos primeiro (id maior), que é o que a pessoa costuma procurar.
 */
function vinculosPorProduto({ pedidos = [], pedidosItens = [], orcamentos = [], orcamentosItens = [], clientes = new Map(), prospeccoes = new Map() } = {}) {
  const porProduto = new Map();
  const juntar = (docs, itens, campo, tipo) => {
    const docPorId = new Map(lista(docs).map(d => [String(d.id), d]));
    const vistos = new Set();
    for (const item of lista(itens)) {
      const produto = item?.produto_id;
      if (produto === undefined || produto === null || produto === '') continue;
      const doc = docPorId.get(String(item?.[campo]));
      if (!doc) continue;
      const chave = `${produto}|${tipo}|${doc.id}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      if (!porProduto.has(String(produto))) porProduto.set(String(produto), []);
      porProduto.get(String(produto)).push({
        tipo,
        id: doc.id,
        numero: texto(doc.numero),
        cliente: nomeDoDestinatario(doc, clientes, prospeccoes),
        situacao: texto(doc.situacao)
      });
    }
  };
  juntar(pedidos, pedidosItens, 'pedido_id', 'pedido');
  juntar(orcamentos, orcamentosItens, 'orcamento_id', 'orcamento');
  const saida = {};
  for (const [produto, docs] of porProduto) {
    saida[produto] = docs.sort((a, b) => (a.tipo === b.tipo ? numero(b.id) - numero(a.id) : (a.tipo === 'pedido' ? -1 : 1)));
  }
  return saida;
}

/** Os itens só com o que o filtro usa (a tabela inteira, sem as colunas de preço). */
async function lerItens(api, tabela, campo) {
  return lista(await api.get(`/api/${tabela}`, { query: { select: `${campo},produto_id,codigo,nome,quantidade` } }));
}

async function nomesDosClientes(api) {
  const clientes = await api.get('/api/clientes', { query: { select: 'id,nome_fantasia,razao_social' } }).catch(() => []);
  return new Map(lista(clientes).map(c => [String(c.id), c.nome_fantasia || c.razao_social || '']));
}

async function nomesDasProspeccoes(api) {
  const prospeccoes = await api.get('/api/prospeccoes', { query: { select: 'id,nome_fantasia,razao_social' } }).catch(() => []);
  return new Map(lista(prospeccoes).map(p => [String(p.id), p.nome_fantasia || p.razao_social || '']));
}

const router = express.Router();

const responder = (rotulo, fn) => async (req, res) => {
  try {
    res.json(await fn(createApiClient(req), req));
  } catch (err) {
    console.error(`[vinculos-pecas] ${rotulo}:`, err?.message || err);
    res.status(err.status || 500).json({ error: 'Não foi possível ler as peças dos documentos.' });
  }
};

router.get('/pedidos', exigirPermissao('ped.view'), responder('pedidos', async api =>
  ({ pecas: pecasPorDocumento(await lerItens(api, 'pedidos_itens', 'pedido_id'), 'pedido_id') })));

router.get('/orcamentos', exigirPermissao('orc.view'), responder('orcamentos', async api =>
  ({ pecas: pecasPorDocumento(await lerItens(api, 'orcamentos_itens', 'orcamento_id'), 'orcamento_id') })));

router.get('/produtos', exigirPermissao('prod.view'), responder('produtos', async (api, req) => {
  const permissoes = await obterPermissoesEfetivas(req);
  const verPedidos = permissoesRepo.can(permissoes, 'ped.view');
  const verOrcamentos = permissoesRepo.can(permissoes, 'orc.view');
  const [pedidos, pedidosItens, orcamentos, orcamentosItens, clientes, prospeccoes] = await Promise.all([
    verPedidos ? api.get('/api/pedidos', { query: { select: 'id,numero,cliente_id,situacao' } }) : [],
    verPedidos ? lerItens(api, 'pedidos_itens', 'pedido_id') : [],
    verOrcamentos ? api.get('/api/orcamentos', { query: { select: 'id,numero,cliente_id,prospeccao_id,situacao' } }) : [],
    verOrcamentos ? lerItens(api, 'orcamentos_itens', 'orcamento_id') : [],
    nomesDosClientes(api),
    verOrcamentos ? nomesDasProspeccoes(api) : new Map()
  ]);
  return {
    vinculos: vinculosPorProduto({ pedidos, pedidosItens, orcamentos, orcamentosItens, clientes, prospeccoes }),
    pedidos: verPedidos,
    orcamentos: verOrcamentos
  };
}));

module.exports = router;
module.exports.pecasPorDocumento = pecasPorDocumento;
module.exports.vinculosPorProduto = vinculosPorProduto;
module.exports.nomeDoDestinatario = nomeDoDestinatario;
