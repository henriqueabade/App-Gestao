/**
 * Trava de DESEMPENHO dos painéis (06/10/2026).
 *
 * A lentidão do Financeiro e da Contabilidade não era a tela: eram as idas à
 * API da internet. O painel de comissões fazia 402 idas — 150 delas em FILA,
 * uma por peça (a rota de produção de cada produto) — e levava ~20 s com
 * 120 ms por ida; o modal de Produção, 817 idas e ~39 s; a Contabilidade lia
 * pedido e cliente um por um (125 idas). Ver docs/plano-desempenho-carregamento.md.
 *
 * Aqui as rotas de verdade sobem em cima de uma API de mentira que CONTA as
 * idas e espera um pouco em cada uma. O teste falha se alguma rota voltar a
 * buscar uma linha por vez (ou em fila): o número de idas tem teto, e o tempo
 * com latência também.
 *
 * Também prende a "leitura única por requisição" (apiHttpClient): a mesma
 * tabela, com o mesmo filtro, é lida uma vez por rota; quem lê recebe uma
 * cópia; qualquer escrita esquece o que foi lido.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const TOKEN = 'x.eyJpZCI6MX0.assinatura';
const LATENCIA_MS = 25;

function dados() {
  const T = {};
  const add = (t, linha) => { (T[t] = T[t] || []).push(linha); };
  const situacoes = ['Enviado', 'Entregue', 'Produção', 'Aprovado', 'Enviado'];
  for (let c = 1; c <= 30; c++) add('clientes', { id: c, nome_fantasia: `Cliente ${c}`, dono_cliente: c % 2 ? 'Marcia Lamounier' : 'Iara Abade' });
  for (let p = 1; p <= 60; p++) add('produtos', { id: p, codigo: `P-${p}`, nome: `Peça ${p}`, desenhado_por: p % 2 ? 'Barral' : 'Atelier' });
  for (let m = 1; m <= 40; m++) add('materia_prima', { id: m, nome: `Insumo ${m}`, processo: ['Marcenaria', 'Acabamento', 'Montagem', 'Embalagem'][m % 4] });
  let pi = 1;
  for (let p = 1; p <= 60; p++) for (let k = 0; k < 4; k++) add('produtos_insumos', { id: pi++, produto_id: p, insumo_id: ((p + k * 7) % 40) + 1, quantidade: 1, ordem_insumo: k + 1 });
  for (let p = 1; p <= 60; p++) add('tabela_fixa', { id_prod: p, vlr_prod: '1000.00' });
  let it = 1; let pa = 1; let nf = 1; let ev = 1; let re = 1;
  for (let id = 1; id <= 50; id++) {
    const situacao = situacoes[id % situacoes.length];
    add('pedidos', { id, numero: `PED${id}`, situacao, cliente_id: (id % 30) + 1, valor_final: 6000, prazo: '30/60', data_aprovacao: '2026-08-01' });
    for (let k = 0; k < 2; k++) add('pedidos_itens', { id: it++, pedido_id: id, produto_id: ((id * 3 + k) % 60) + 1, codigo: 'P', nome: 'Peça', quantidade: 2, valor_total: '3000.00' });
    for (let k = 1; k <= 2; k++) {
      add('pedido_parcelas', { id: pa++, pedido_id: id, numero_parcela: k, valor: '3000.00', data_vencimento: `2026-0${7 + k}-10` });
      if (['Enviado', 'Entregue'].includes(situacao)) add('recebimentos', { id: re++, pedido_id: id, numero_parcela: k, status: 'confirmado', origem: 'manual', data_recebimento: `2026-0${7 + k}-10`, competencia: `2026-0${7 + k}`, valor_parcela: '3000', valor_recebido: '3000', valor_abatimento: '0' });
    }
    if (['Enviado', 'Entregue'].includes(situacao)) add('notas_fiscais', { id: nf++, pedido_id: id, serie: 2, numero: nf, status_fiscal: 'autorizada', valor_total: 6000 });
    if (situacao !== 'Aprovado') add('producao_eventos', { id: ev++, pedido_id: id, pedido_item_id: (id - 1) * 2 + 1, etapa_id: 1, quantidade: 1, data_finalizacao: '2026-09-15', competencia: '2026-09', status: 'ativo' });
  }
  add('usuarios', { id: 1, nome: 'Henrique' });
  add('configuracao_cobranca', { id: 1, recebimentos_desde: null });
  add('financeiro_configuracao', { id: 1, comissao_dia_pagamento: 15, producao_dia_util: 5, sabado_dia_util: false });
  add('comissao_regras', { id: 1, tipo: 'cms', beneficiario: 'Marcia Lamounier', percentual: 10, escopo: 'todos', ativo: true });
  ['Marcenaria', 'Acabamento', 'Montagem', 'Embalagem'].forEach((nome, i) => add('etapas_producao', { id: i + 1, nome, ordem: i + 1, producao_ativa: true }));
  return T;
}

function criarUpstream(T, contagem) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const [, tabela, id] = url.pathname.match(/^\/api\/([a-z_]+)(?:\/(\d+))?$/) || [];
    contagem.total += 1;
    const chave = `${req.method} ${tabela}${id ? '/:id' : ''}`;
    contagem.porRota.set(chave, (contagem.porRota.get(chave) || 0) + 1);
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => setTimeout(() => {
      const lista = T[tabela] || (T[tabela] = []);
      let payload = [];
      if (req.method === 'GET') {
        if (id) payload = lista.find(l => String(l.id) === id) || null;
        else {
          const filtros = [...url.searchParams.entries()].filter(([k]) => k !== 'select' && k !== 'order');
          payload = lista.filter(l => filtros.every(([k, v]) => !(k in l) || String(l[k]) === String(v)));
        }
      } else if (req.method === 'POST') {
        payload = { id: 90000 + lista.length, ...(corpo ? JSON.parse(corpo) : {}) };
        lista.push(payload);
      } else payload = {};
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    }, LATENCIA_MS));
  });
}

async function montar() {
  const contagem = { total: 0, porRota: new Map() };
  const upstream = criarUpstream(dados(), contagem);
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  for (const chave of Object.keys(require.cache)) {
    if (/[\\/]backend[\\/]/.test(chave) && !/node_modules/.test(chave)) delete require.cache[chave];
  }
  const caminhoPerm = require.resolve('./permissionsController');
  const passa = () => (req, res, next) => next();
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: { exigirPermissao: passa, exigirAlgumaPermissao: passa, exigirSupAdmin: (req, res, next) => next(), ehSupAdmin: async () => true, obterPermissoesEfetivas: async () => ({ permissoes: [], supAdmin: true }) }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/fiscal', require('./fiscalController'));
  app.use('/api/cobranca', require('./cobrancaController'));
  app.use('/api/financeiro', require('./financeiroController'));
  app.use('/api/contabilidade', require('./contabilidadeController'));
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const medir = async caminho => {
    contagem.total = 0;
    contagem.porRota.clear();
    const inicio = Date.now();
    const r = await fetch(base + caminho, { headers: { Authorization: `Bearer ${TOKEN}` } });
    await r.text();
    return { status: r.status, ms: Date.now() - inicio, idas: contagem.total, porRota: new Map(contagem.porRota) };
  };
  const fechar = () => Promise.all([new Promise(r => servidor.close(r)), new Promise(r => upstream.close(r))]);
  return { medir, fechar };
}

test('cada painel tem teto de idas à API e nenhuma rota busca linha por linha', async () => {
  const t = await montar();
  try {
    const comp = '2026-09';
    // Tetos com folga sobre o medido em 06/10/2026 (antes: 402, 817, 438, 204).
    const tetos = [
      [`/api/financeiro/painel?competencia=${comp}`, 45],
      [`/api/financeiro/producao?competencia=${comp}`, 30],
      [`/api/financeiro/parcelas?visao=atrasadas&competencia=${comp}`, 45],
      [`/api/financeiro/ajustes-pessoa?competencia=${comp}`, 45],
      [`/api/contabilidade/painel?competencia=${comp}`, 70],
      [`/api/cobranca/recebimentos/painel?competencia=${comp}`, 15],
      [`/api/fiscal/painel?competencia=${comp}`, 12]
    ];
    for (const [rota, teto] of tetos) {
      const m = await t.medir(rota);
      assert.equal(m.status, 200, rota);
      assert.ok(m.idas <= teto, `${rota}: ${m.idas} idas à API (teto ${teto}) — ${[...m.porRota].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join(', ')}`);
      // Nada de uma ida por pedido, por cliente ou por peça.
      for (const [chave, vezes] of m.porRota) {
        assert.ok(vezes <= 4, `${rota}: ${chave} lido ${vezes} vezes (linha por linha?)`);
      }
    }
    // Com 25 ms por ida, o painel do Financeiro não pode passar de uns poucos
    // "degraus" de espera (antes, ~60 peças em fila = 1,5 s só de fila).
    const painel = await t.medir(`/api/financeiro/painel?competencia=${comp}`);
    assert.ok(painel.ms < 1200, `painel do Financeiro levou ${painel.ms} ms com ${LATENCIA_MS} ms por ida`);
  } finally {
    await t.fechar();
  }
});

test('leitura única por requisição: lê uma vez, entrega cópias, escrita esquece', async () => {
  const { comLeituraUnica } = require('./apiHttpClient');
  const chamadas = [];
  const base = {
    get: async (p, o) => { chamadas.push(['get', p, JSON.stringify(o?.query || {})]); return [{ id: 1, nome: 'A' }]; },
    post: async () => { chamadas.push(['post']); return { id: 2 }; },
    put: async () => { chamadas.push(['put']); return {}; },
    delete: async () => { chamadas.push(['delete']); return {}; }
  };
  const api = comLeituraUnica(base);
  const [a, b] = await Promise.all([api.get('/api/x'), api.get('/api/x')]);
  assert.equal(chamadas.filter(c => c[0] === 'get').length, 1, 'a mesma leitura vai à API uma vez');
  a[0].nome = 'mexido';
  assert.equal(b[0].nome, 'A', 'cada um recebe a sua cópia');
  assert.equal((await api.get('/api/x'))[0].nome, 'A', 'quem mexeu na cópia não estraga a guardada');
  await api.get('/api/x', { query: { id: 1 } });
  assert.equal(chamadas.filter(c => c[0] === 'get').length, 2, 'outro filtro, outra leitura');
  await api.post('/api/x', {});
  await api.get('/api/x');
  assert.equal(chamadas.filter(c => c[0] === 'get').length, 3, 'depois de gravar, lê de novo');
  await api.put('/api/x/1', {});
  await api.get('/api/x');
  assert.equal(chamadas.filter(c => c[0] === 'get').length, 4);
});

test('o cliente da API só guarda leitura numa requisição de verdade (tarefas em segundo plano, não)', () => {
  const fonte = require('node:fs').readFileSync(path.join(__dirname, 'apiHttpClient.js'), 'utf8');
  assert.match(fonte, /const ehRequisicaoExpress = req => Boolean\(req && typeof req\.method === 'string' && req\.headers\);/);
  assert.match(fonte, /return ehRequisicaoExpress\(req\) \? comLeituraUnica\(api\) : api;/);
});
