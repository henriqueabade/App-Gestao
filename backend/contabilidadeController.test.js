/**
 * Rotas da Contabilidade (backend/contabilidadeController.js) com a API
 * genérica de mentira e a guarda de permissão de mentira.
 *
 * O que fica preso (decisões do dono, 28/09/2026):
 *   - o painel calcula o checklist só com o que já existe e diz o que bloqueia;
 *   - fechar recusa com erro crítico, com o mês em curso e quando já fechada;
 *     fecha gravando a foto e o evento, com quem fechou;
 *   - reabrir exige justificativa e competência fechada;
 *   - ignorar só documental/aviso, com justificativa; restaurar desfaz;
 *   - sem o SQL, o painel avisa (`sql_pendente`) e as gravações respondem 409;
 *   - cada rota pede a permissão dela.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  pedidos: ['id', 'numero', 'situacao', 'cliente_id', 'valor_final', 'embarcar_real', 'parcelas', 'nfe_dispensada'],
  notas_fiscais: ['id', 'pedido_id', 'serie', 'numero', 'status_fiscal', 'valor_total', 'data_emissao', 'criado_em', 'atualizado_em', 'motivo_sefaz', 'codigo_status_sefaz'],
  pedido_parcelas: ['id', 'pedido_id', 'numero_parcela', 'valor', 'vencimento'],
  boletos: ['id', 'pedido_id', 'status'],
  boletos_eventos: ['id', 'origem', 'processado_em'],
  recebimentos: ['id', 'pedido_id', 'numero_parcela', 'status', 'valor_recebido', 'data_recebimento', 'competencia'],
  financeiro_fechamentos: ['id', 'tipo', 'competencia', 'status', 'total', 'quantidade', 'pagar_ate', 'fechado_em', 'por_setor'],
  financeiro_fechamento_itens: ['id', 'fechamento_id'],
  financeiro_pagamentos: ['id', 'fechamento_id', 'valor', 'data_pagamento', 'forma', 'beneficiario', 'tipo_comissao'],
  reembolsos: ['id', 'pedido_id', 'status', 'valor', 'criado_em'],
  devolucoes: ['id', 'pedido_id', 'status', 'data_devolucao'],
  usuarios: ['id', 'nome'],
  competencia_contabil: ['id', 'competencia', 'status', 'fechada_em', 'fechada_por', 'reaberta_em', 'reaberta_por', 'justificativa_reabertura', 'totais', 'pendencias_no_fechamento', 'criado_em', 'atualizado_em'],
  contabil_pendencias_resolucoes: ['id', 'competencia', 'chave', 'nivel', 'titulo', 'justificativa', 'usuario_id', 'criado_em'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em']
};

function criarUpstream(dados) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const chamadas = [];
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const [, tabela, id] = url.pathname.split('/').filter(Boolean);
      const body = corpo ? JSON.parse(corpo) : null;
      chamadas.push({ metodo: req.method, tabela, id, body });
      const responder = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
      if (!tabelas[tabela]) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
      const colunas = COLUNAS[tabela] || [];
      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Not found' });
      }
      if (req.method === 'GET') {
        let linhas = tabelas[tabela];
        for (const [chave, valor] of url.searchParams.entries()) {
          if (colunas.includes(chave)) linhas = linhas.filter(r => String(r[chave]) === String(valor));
        }
        return responder(200, linhas);
      }
      if (req.method === 'POST') {
        const linha = {};
        for (const c of colunas) if (body?.[c] !== undefined) linha[c] = body[c];
        if (tabela === 'competencia_contabil' && tabelas[tabela].some(r => r.competencia === linha.competencia)) return responder(409, { error: 'duplicate key value violates unique constraint' });
        if (tabela === 'contabil_pendencias_resolucoes' && tabelas[tabela].some(r => r.competencia === linha.competencia && r.chave === linha.chave)) return responder(409, { error: 'duplicate key value violates unique constraint' });
        linha.id = Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1;
        tabelas[tabela].push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT') {
        const alvo = tabelas[tabela].find(r => String(r.id) === String(id));
        if (!alvo) return responder(404, { error: 'Not found' });
        for (const c of colunas) if (body?.[c] !== undefined) alvo[c] = body[c];
        return responder(200, alvo);
      }
      if (req.method === 'DELETE') {
        const idx = tabelas[tabela].findIndex(r => String(r.id) === String(id));
        if (idx === -1) return responder(404, { error: 'Not found' });
        tabelas[tabela].splice(idx, 1);
        return responder(200, { sucesso: true });
      }
      return responder(405, { error: 'Método não suportado' });
    });
  });
  return { servidor, tabelas, chamadas };
}

const MODULOS = ['./apiHttpClient', './permissionsController', './contabilidadeController', './contabilidade/checklist', './contabilidade/fechamento', './contabilidade/base'];

async function montar(dados, { permitir = true } = {}) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  // A configuração de cobrança guarda cache entre leituras: zera para não vazar entre cenários.
  require('./cobranca/configuracaoCobranca').limparCache?.();
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      exigirPermissao: chave => (req, res, next) => {
        const chaves = typeof chave === 'function' ? chave(req) : chave;
        const pedidas = Array.isArray(chaves) ? chaves : [chaves];
        const liberado = Array.isArray(permitir) ? pedidas.every(c => permitir.includes(c)) : permitir;
        return liberado ? next() : res.status(403).json({ error: 'Sem permissão', pedidas });
      },
      exigirAlgumaPermissao: () => (req, res, next) => next(),
      exigirSupAdmin: (req, res, next) => next(),
      limparCachePermissoes: () => {}
    }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/contabilidade', require('./contabilidadeController'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const porta = server.address().port;
  const chamar = (metodo, caminho, corpo) => fetch(`http://127.0.0.1:${porta}/api/contabilidade${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${tokenDe(3)}`, 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  return {
    chamar, tabelas: upstream.tabelas, chamadas: upstream.chamadas,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

const COMP = '2026-08';

/** Agosto/2026 com um pedido enviado sem nota, comissões fechadas e pagas, produção sem fechar. */
function cenario(extra = {}) {
  return {
    pedidos: [
      { id: 1, numero: '2600', situacao: 'Enviado', cliente_id: 7, valor_final: '400.00', embarcar_real: '2026-08-12', parcelas: 1 },
      { id: 2, numero: '2601', situacao: 'Entregue', cliente_id: 7, valor_final: '1500.00', embarcar_real: '2026-08-05', parcelas: 1 }
    ],
    notas_fiscais: [{ id: 1, pedido_id: 2, serie: 2, numero: 10, status_fiscal: 'autorizada', valor_total: '1500.00', data_emissao: '2026-08-05T10:00:00-03:00', criado_em: '2026-08-05T10:00:00-03:00' }],
    pedido_parcelas: [], boletos: [], boletos_eventos: [], recebimentos: [],
    financeiro_fechamentos: [{ id: 1, tipo: 'comissao', competencia: COMP, status: 'fechado', total: 1000, quantidade: 2, pagar_ate: '2026-09-10', fechado_em: '2026-09-02T12:00:00.000Z', por_setor: null }],
    financeiro_fechamento_itens: [],
    financeiro_pagamentos: [{ id: 1, fechamento_id: 1, valor: 1000, data_pagamento: '2026-09-09', forma: 'Pix' }],
    reembolsos: [], devolucoes: [],
    usuarios: [{ id: 3, nome: 'Henrique' }],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [],
    ...extra
  };
}

test('painel: checklist por fonte, pendências com severidade, contagem e o que bloqueia', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('GET', `/painel?competencia=${COMP}`);
    assert.equal(r.status, 200);
    const p = await r.json();
    assert.equal(p.competencia, COMP);
    assert.equal(p.rotulo, 'agosto/2026');
    assert.equal(p.sql_pendente, false);
    assert.equal(p.situacao.status, 'aberta');
    assert.deepEqual(p.pendencias.map(x => [x.nivel, x.chave, x.fonte]), [['documental', 'nfe_aguardando', 'nfe_saida'], ['documental', 'fech_producao_fechar', 'fechamentos']]);
    assert.deepEqual(p.contagem, { critico: 0, documental: 2, aviso: 0, ignoradas: 0, total: 2 });
    assert.deepEqual(p.fontes.map(f => [f.chave, f.estado]), [
      ['nfe_saida', 'pendente'], ['recebimentos', 'ok'], ['fechamentos', 'pendente'], ['devolucoes', 'ok'],
      ['documentos_recebidos', 'indisponivel'], ['contas_pagar', 'indisponivel'], ['extrato', 'indisponivel'], ['conciliacao', 'indisponivel']
    ]);
    assert.equal(p.fontes[0].resumo[0].valor.replace(/ /g, ' '), '1 · R$ 1.500,00');
    assert.deepEqual(p.pode, { fechar: true, reabrir: false, pacote: false });
    assert.equal('situacao_bruta' in p, false, 'a linha crua do banco não vai para a tela');
  } finally {
    await ctx.encerrar();
  }
});

test('ignorar e restaurar: documental com justificativa sai dos bloqueios e fica marcada com quem ignorou; sem justificativa é 400', async () => {
  const ctx = await montar(cenario());
  try {
    const curta = await ctx.chamar('POST', '/pendencias/ignorar', { competencia: COMP, chave: 'nfe_aguardando', justificativa: 'curta' });
    assert.equal(curta.status, 400);
    const ok = await ctx.chamar('POST', '/pendencias/ignorar', { competencia: COMP, chave: 'nfe_aguardando', justificativa: 'A nota foi emitida à mão pela contabilidade.' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { id: 1, competencia: COMP, chave: 'nfe_aguardando', nivel: 'documental', ignorada: true });
    const repetida = await ctx.chamar('POST', '/pendencias/ignorar', { competencia: COMP, chave: 'nfe_aguardando', justificativa: 'de novo, para ver o 409' });
    assert.equal(repetida.status, 409);
    const inexistente = await ctx.chamar('POST', '/pendencias/ignorar', { competencia: COMP, chave: 'nada_disso', justificativa: 'não existe esta pendência' });
    assert.equal(inexistente.status, 404);

    const p = await (await ctx.chamar('GET', `/painel?competencia=${COMP}`)).json();
    const ignorada = p.pendencias.find(x => x.chave === 'nfe_aguardando');
    assert.equal(ignorada.ignorada, true);
    assert.equal(ignorada.ignorada_por, 'Henrique');
    assert.match(ignorada.justificativa, /à mão/);
    assert.deepEqual(p.contagem, { critico: 0, documental: 1, aviso: 0, ignoradas: 1, total: 2 });
    assert.equal(ctx.tabelas.contabil_eventos[0].tipo, 'pendencia_ignorada');
    assert.equal(ctx.tabelas.contabil_eventos[0].usuario_id, 3);

    const volta = await ctx.chamar('POST', '/pendencias/restaurar', { competencia: COMP, chave: 'nfe_aguardando' });
    assert.equal(volta.status, 200);
    assert.deepEqual(ctx.tabelas.contabil_pendencias_resolucoes, []);
    assert.equal(ctx.tabelas.contabil_eventos.at(-1).tipo, 'pendencia_restaurada');
    const deNovo = await ctx.chamar('POST', '/pendencias/restaurar', { competencia: COMP, chave: 'nfe_aguardando' });
    assert.equal(deNovo.status, 404);
  } finally {
    await ctx.encerrar();
  }
});

test('erro crítico não se ignora: 409', async () => {
  const notaParada = { id: 2, pedido_id: 1, serie: 2, numero: 11, status_fiscal: 'processando', valor_total: 400, data_emissao: '2026-08-13T10:00:00-03:00', criado_em: '2026-08-13T10:00:00-03:00' };
  const ctx = await montar(cenario({ notas_fiscais: [...cenario().notas_fiscais, notaParada] }));
  try {
    const p = await (await ctx.chamar('GET', `/painel?competencia=${COMP}`)).json();
    assert.equal(p.contagem.critico, 1);
    assert.equal(p.pode.fechar, false);
    const r = await ctx.chamar('POST', '/pendencias/ignorar', { competencia: COMP, chave: 'nfe_processando', justificativa: 'quero ignorar mesmo assim' });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /Erro crítico não se ignora/);
    const fechar = await ctx.chamar('POST', '/fechar', { competencia: COMP });
    assert.equal(fechar.status, 409);
    const corpo = await fechar.json();
    assert.deepEqual(corpo.bloqueios, ['1 erro crítico a resolver (erro crítico não se ignora).']);
    assert.deepEqual(ctx.tabelas.competencia_contabil, [], 'nada gravado');
  } finally {
    await ctx.encerrar();
  }
});

test('fechar: grava a foto e o evento com quem fechou; fechar de novo é 409; o mês em curso não fecha; reabrir exige justificativa', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('POST', '/fechar', { competencia: COMP });
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.status, 'fechada');
    assert.deepEqual(corpo.contagem, { critico: 0, documental: 2, aviso: 0, ignoradas: 0, total: 2 });
    assert.deepEqual(corpo.pendencias_no_fechamento.map(x => x.chave), ['nfe_aguardando', 'fech_producao_fechar']);
    const linha = ctx.tabelas.competencia_contabil[0];
    assert.equal(linha.competencia, COMP);
    assert.equal(linha.status, 'fechada');
    assert.equal(linha.fechada_por, 3);
    assert.equal(typeof linha.totais, 'string', 'JSON vai como texto (a API remota recusa array em JSONB)');
    assert.equal(JSON.parse(linha.totais).fontes[0].chave, 'nfe_saida');
    assert.equal(ctx.tabelas.contabil_eventos[0].tipo, 'competencia_fechada');
    assert.match(ctx.tabelas.contabil_eventos[0].descricao, /agosto\/2026 fechada com 2 pendências documentais/);

    const p = await (await ctx.chamar('GET', `/painel?competencia=${COMP}`)).json();
    assert.equal(p.situacao.status, 'fechada');
    assert.equal(p.situacao.fechada_por, 'Henrique');
    assert.deepEqual(p.pode, { fechar: false, reabrir: true, pacote: false });

    const deNovo = await ctx.chamar('POST', '/fechar', { competencia: COMP });
    assert.equal(deNovo.status, 409);
    assert.deepEqual((await deNovo.json()).bloqueios, ['A competência já está fechada.']);

    const hoje = new Date();
    const emCurso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const cedo = await ctx.chamar('POST', '/fechar', { competencia: emCurso });
    assert.equal(cedo.status, 409);
    assert.match((await cedo.json()).bloqueios[0], /ainda está em curso/);

    const semJustificativa = await ctx.chamar('POST', '/reabrir', { competencia: COMP, justificativa: '' });
    assert.equal(semJustificativa.status, 400);
    const reaberta = await ctx.chamar('POST', '/reabrir', { competencia: COMP, justificativa: 'Entrou uma nota de agosto atrasada.' });
    assert.equal(reaberta.status, 200);
    assert.equal((await reaberta.json()).status, 'reaberta');
    assert.equal(ctx.tabelas.competencia_contabil[0].justificativa_reabertura, 'Entrou uma nota de agosto atrasada.');
    const naoFechada = await ctx.chamar('POST', '/reabrir', { competencia: COMP, justificativa: 'já está reaberta, não dá' });
    assert.equal(naoFechada.status, 409);

    // Reaberta fecha de novo (a mesma linha, sem duplicar).
    const outraVez = await ctx.chamar('POST', '/fechar', { competencia: COMP });
    assert.equal(outraVez.status, 200);
    assert.equal(ctx.tabelas.competencia_contabil.length, 1);
    assert.equal(ctx.tabelas.competencia_contabil[0].status, 'fechada');
    assert.equal(ctx.tabelas.competencia_contabil[0].justificativa_reabertura, null);

    const atividade = await (await ctx.chamar('GET', `/atividade?competencia=${COMP}`)).json();
    assert.deepEqual(atividade.eventos.map(e => [e.tipo, e.usuario]), [['competencia_fechada', 'Henrique'], ['competencia_reaberta', 'Henrique'], ['competencia_fechada', 'Henrique']]);
    assert.match(atividade.eventos[0].quando, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
    const competencias = await (await ctx.chamar('GET', '/competencias')).json();
    assert.deepEqual(competencias.competencias.map(c => [c.competencia, c.status, c.fechada_por]), [[COMP, 'fechada', 'Henrique']]);
  } finally {
    await ctx.encerrar();
  }
});

test('sem o SQL do módulo: o painel avisa e as gravações respondem 409 com sql_pendente', async () => {
  const { competencia_contabil, contabil_pendencias_resolucoes, contabil_eventos, ...semSql } = cenario();
  const ctx = await montar(semSql);
  try {
    const p = await (await ctx.chamar('GET', `/painel?competencia=${COMP}`)).json();
    assert.equal(p.sql_pendente, true);
    assert.equal(p.pendencias.length, 2, 'o checklist aparece mesmo assim');
    const fechar = await ctx.chamar('POST', '/fechar', { competencia: COMP });
    assert.equal(fechar.status, 409);
    assert.equal((await fechar.json()).sql_pendente, true);
    const ignorar = await ctx.chamar('POST', '/pendencias/ignorar', { competencia: COMP, chave: 'nfe_aguardando', justificativa: 'sem tabela isto não grava' });
    assert.equal(ignorar.status, 409);
    assert.equal((await ignorar.json()).sql_pendente, true);
  } finally {
    await ctx.encerrar();
  }
});

test('permissões: cada rota pede a sua', async () => {
  const ctx = await montar(cenario(), { permitir: ['contabilidade.view'] });
  try {
    assert.equal((await ctx.chamar('GET', `/painel?competencia=${COMP}`)).status, 200);
    assert.equal((await ctx.chamar('GET', '/atividade')).status, 200);
    const fechar = await ctx.chamar('POST', '/fechar', { competencia: COMP });
    assert.equal(fechar.status, 403);
    assert.deepEqual((await fechar.json()).pedidas, ['contabilidade.fechar']);
    assert.deepEqual((await (await ctx.chamar('POST', '/reabrir', { competencia: COMP, justificativa: 'x' })).json()).pedidas, ['contabilidade.reabrir']);
    assert.deepEqual((await (await ctx.chamar('POST', '/pendencias/ignorar', { competencia: COMP })).json()).pedidas, ['contabilidade.pendencia.resolver']);
    assert.deepEqual((await (await ctx.chamar('POST', '/pendencias/restaurar', { competencia: COMP })).json()).pedidas, ['contabilidade.pendencia.resolver']);
  } finally {
    await ctx.encerrar();
  }
  const semNada = await montar(cenario(), { permitir: [] });
  try {
    assert.equal((await semNada.chamar('GET', `/painel?competencia=${COMP}`)).status, 403);
  } finally {
    await semNada.encerrar();
  }
});
