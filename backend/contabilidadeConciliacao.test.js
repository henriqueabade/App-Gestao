/**
 * Contabilidade — etapa 5 (conciliação do extrato): as rotas de
 * /api/contabilidade com a API genérica e a guarda de permissão de mentira.
 *
 * O que fica preso (28/09/2026):
 *   - o painel do mês: cada lançamento com o estado, a sugestão do motor
 *     (única, composição dos boletos do dia) e o que o app registrou pelo
 *     banco sem lançamento no extrato;
 *   - em lote: automático só com chave (CNPJ da contrapartida) ou o nome a
 *     até 3 dias (16b); as sugestões únicas só quando pedido; composição nunca;
 *   - fase A (02/10/2026): a nota sem conta e a parcela em aberto casam com o
 *     débito — o lote lança/paga a conta e concilia; desfazer estorna e
 *     cancela; registrar a nota já concilia sozinho;
 *   - conciliar à mão: a soma tem de bater (ou justificar a diferença, que
 *     fica gravada); o que já está ligado e o outro sentido são recusados;
 *   - desfazer e ignorar pedem motivo; reativar volta a "a conciliar";
 *   - débito sem conta: vira conta paga e conciliada; o pagamento
 *     conciliado não se estorna;
 *   - competência fechada recusa; o checklist cobra os pendentes
 *     (documental) e a conciliação com registro estornado (crítico);
 *   - cada rota pede a sua permissão; sem o SQL, 409 dizendo qual arquivo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;
const semNbsp = t => String(t).replace(/ /g, ' ');

const COLUNAS = {
  pedidos: ['id', 'numero', 'cliente_id', 'situacao'], clientes: ['id', 'nome', 'nome_fantasia', 'razao_social', 'cnpj', 'cpf'],
  notas_fiscais: ['id'], notas_devolucao: ['id'], configuracao_fiscal: ['id', 'cnpj'], configuracao_cobranca: ['id'],
  financeiro_fechamentos: ['id', 'tipo', 'competencia', 'status', 'total', 'quantidade', 'pagar_ate', 'fechado_em'],
  financeiro_fechamento_itens: ['id', 'fechamento_id'],
  financeiro_pagamentos: ['id', 'fechamento_id', 'tipo', 'competencia', 'valor', 'data_pagamento', 'forma', 'beneficiario', 'tipo_comissao'],
  recebimentos: ['id', 'pedido_id', 'numero_parcela', 'boleto_id', 'origem', 'forma', 'data_recebimento', 'data_credito', 'valor_recebido', 'status', 'competencia'],
  reembolsos: ['id', 'pedido_id', 'valor', 'status', 'data_pagamento', 'forma'],
  usuarios: ['id', 'nome'],
  contatos: ['id', 'nome', 'cnpj', 'cpf'],
  competencia_contabil: ['id', 'competencia', 'status'],
  contabil_pendencias_resolucoes: ['id', 'competencia', 'chave', 'justificativa', 'usuario_id', 'criado_em'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em', 'referencia_tipo', 'referencia_id'],
  contabil_arquivos: ['id'], contabil_arquivo_vinculos: ['id', 'arquivo_id', 'alvo_tipo', 'alvo_id'],
  documentos_recebidos: ['id', 'tipo', 'origem', 'numero', 'serie', 'municipio', 'emitente_nome', 'emitente_documento', 'contato_id', 'data_emissao', 'competencia', 'valor_total',
    'valor_iss', 'iss_retido', 'valor_retencoes', 'financeiro_pagamento_id', 'sem_pagamento', 'excluido_em', 'descricao', 'observacao', 'criado_por', 'criado_em'],
  titulos_pagar: ['id', 'contato_id', 'documento_recebido_id', 'descricao', 'categoria', 'numero_documento', 'data_emissao', 'competencia', 'valor_total', 'status', 'origem', 'observacao',
    'criado_por', 'criado_em', 'atualizado_em', 'cancelado_em', 'cancelado_por', 'motivo_cancelamento'],
  titulo_pagar_parcelas: ['id', 'titulo_id', 'numero', 'vencimento', 'valor', 'linha_digitavel'],
  titulo_pagar_pagamentos: ['id', 'parcela_id', 'titulo_id', 'data_pagamento', 'competencia', 'valor_pago', 'valor_juros', 'valor_desconto', 'forma', 'observacao', 'criado_por', 'criado_em',
    'estornado_em', 'estornado_por', 'motivo_estorno'],
  contas_financeiras: ['id', 'nome', 'tipo', 'banco_codigo', 'agencia', 'agencia_dv', 'conta', 'ativa'],
  extrato_importacoes: ['id', 'conta_id', 'origem', 'status', 'periodo_inicio', 'periodo_fim', 'saldo_final', 'saldo_final_data'],
  movimentos_bancarios: ['id', 'conta_id', 'importacao_id', 'data', 'competencia', 'valor', 'tipo', 'descricao', 'documento', 'identificador', 'contrapartida_documento', 'hash',
    'estado_conciliacao', 'conciliacao_diferenca', 'conciliacao_observacao', 'conciliado_em', 'conciliado_por'],
  conciliacao_vinculos: ['id', 'movimento_id', 'alvo_tipo', 'alvo_id', 'valor', 'criterio', 'detalhe', 'criado_por', 'criado_em', 'desfeito_em', 'desfeito_por', 'motivo_desfazer']
};

const UNICOS = {
  conciliacao_vinculos: (novo, linhas) => linhas.some(r => !r.desfeito_em && String(r.movimento_id) === String(novo.movimento_id) && r.alvo_tipo === novo.alvo_tipo && String(r.alvo_id) === String(novo.alvo_id)),
  titulo_pagar_pagamentos: (novo, linhas) => linhas.some(r => String(r.parcela_id) === String(novo.parcela_id) && !r.estornado_em)
};

function criarUpstream(dados) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const [, tabela, id] = url.pathname.split('/').filter(Boolean);
      const body = corpo ? JSON.parse(corpo) : null;
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
        if (UNICOS[tabela]?.(linha, tabelas[tabela])) return responder(500, { error: 'duplicate key value violates unique constraint' });
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
  return { servidor, tabelas };
}

const MODULOS = [
  './apiHttpClient', './permissionsController', './contabilidadeController',
  './contabilidade/checklist', './contabilidade/fechamento', './contabilidade/base', './contabilidade/eventos', './contabilidade/arquivos', './contabilidade/titulos',
  './contabilidade/extrato/extrato', './contabilidade/extrato/ofx',
  './contabilidade/conciliacao/conciliacao', './contabilidade/conciliacao/liquidacoes', './contabilidade/conciliacao/motor'
];

async function montar(dados, { permitir = true } = {}) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
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
      ehSupAdmin: async () => false,
      limparCachePermissoes: () => {}
    }
  };
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use('/api/contabilidade', require('./contabilidadeController'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const porta = server.address().port;
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(`http://127.0.0.1:${porta}/api/contabilidade${caminho}`, {
      method: metodo,
      headers: { authorization: `Bearer ${tokenDe(3)}`, 'content-type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    return { status: r.status, corpo: await r.json().catch(() => null) };
  };
  return {
    chamar, tabelas: upstream.tabelas,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

const mov = (id, data, valor, descricao, extra = {}) => ({
  id, conta_id: 1, importacao_id: 1, data, competencia: data.slice(0, 7), valor, tipo: valor < 0 ? 'debito' : 'credito', descricao,
  documento: null, identificador: `F${id}`, contrapartida_documento: null, hash: `h${id}`, estado_conciliacao: 'pendente', ...extra
});

function cenario(extra = {}) {
  return {
    pedidos: [{ id: 1, numero: 2540, cliente_id: 8 }, { id: 2, numero: 2541, cliente_id: 8 }, { id: 3, numero: 2542, cliente_id: 9 }],
    clientes: [{ id: 8, nome_fantasia: 'Casa Vicenzo', cnpj: '11444777000161' }, { id: 9, nome: 'Ateliê das Flores', cpf: '00589039334' }],
    notas_fiscais: [], notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: '11444777000161' }], configuracao_cobranca: [],
    financeiro_fechamentos: [{ id: 1, tipo: 'comissao', competencia: '2026-07', status: 'fechado', total: 900, quantidade: 1, pagar_ate: '2026-08-10', fechado_em: '2026-08-02T12:00:00Z' }],
    financeiro_fechamento_itens: [],
    financeiro_pagamentos: [{ id: 70, fechamento_id: 1, tipo: 'comissao', competencia: '2026-07', valor: 900, data_pagamento: '2026-08-15', forma: 'Pix', beneficiario: 'Ana' }],
    recebimentos: [
      { id: 1, pedido_id: 1, numero_parcela: 1, boleto_id: 41, origem: 'boleto', forma: 'Boleto', data_recebimento: '2026-08-10', valor_recebido: 1200, status: 'confirmado', competencia: '2026-08' },
      { id: 2, pedido_id: 2, numero_parcela: 1, boleto_id: 42, origem: 'boleto', forma: 'Boleto', data_recebimento: '2026-08-10', valor_recebido: 2500, status: 'confirmado', competencia: '2026-08' },
      { id: 3, pedido_id: 3, numero_parcela: 1, origem: 'manual', forma: 'Dinheiro', data_recebimento: '2026-08-12', valor_recebido: 300, status: 'confirmado', competencia: '2026-08' }
    ],
    reembolsos: [],
    usuarios: [{ id: 3, nome: 'Henrique' }],
    contatos: [{ id: 5, nome: 'Imobiliária Centro', cnpj: '23132546000100' }, { id: 6, nome: 'Vidros Norte', cnpj: '84031759000121' }],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [],
    contabil_arquivos: [], contabil_arquivo_vinculos: [], documentos_recebidos: [],
    titulos_pagar: [
      { id: 1, contato_id: 5, descricao: 'Aluguel de agosto', categoria: 'Serviços de Terceiros', competencia: '2026-08', valor_total: 2500, status: 'aberto' },
      { id: 2, contato_id: 6, descricao: 'NF-e 1/4521', categoria: 'Aquisição de Bens', competencia: '2026-08', valor_total: 600, status: 'aberto' }
    ],
    titulo_pagar_parcelas: [{ id: 11, titulo_id: 1, numero: 1, vencimento: '2026-08-05', valor: 2500 }, { id: 21, titulo_id: 2, numero: 1, vencimento: '2026-08-20', valor: 600 }],
    titulo_pagar_pagamentos: [
      { id: 101, parcela_id: 11, titulo_id: 1, data_pagamento: '2026-08-05', competencia: '2026-08', valor_pago: 2500, forma: 'Boleto' },
      { id: 102, parcela_id: 21, titulo_id: 2, data_pagamento: '2026-08-20', competencia: '2026-08', valor_pago: 600, forma: 'Pix' }
    ],
    contas_financeiras: [{ id: 1, nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1234', conta: '123456', ativa: true }],
    extrato_importacoes: [{ id: 1, conta_id: 1, origem: 'ofx', status: 'completa', periodo_inicio: '2026-08-01', periodo_fim: '2026-08-31', saldo_final: 1000, saldo_final_data: '2026-08-31' }],
    movimentos_bancarios: [
      mov(1, '2026-08-09', -2500, 'Pagamento de boleto - Imobiliária Centro'),
      mov(2, '2026-08-11', 3700, 'LIQUIDAÇÃO DE COBRANÇA'),
      mov(3, '2026-08-20', -600, 'PIX ENVIADO', { contrapartida_documento: '84031759000121' }),
      mov(4, '2026-08-31', -12.9, 'Tarifa pacote de serviços')
    ],
    conciliacao_vinculos: [],
    ...extra
  };
}

test('painel do mês: sugestão única, automático com CNPJ, a soma dos boletos do dia e o que o app registrou sem lançamento', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('GET', '/conciliacao?competencia=2026-08');
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const porId = new Map(r.corpo.linhas.map(l => [l.id, l]));
    assert.deepEqual([porId.get(1).sugestao.tipo, porId.get(1).sugestao.unica, porId.get(1).sugestao.itens[0].rotulo], ['sugestao', true, 'Aluguel de agosto']);
    assert.ok(porId.get(1).sugestao.motivos.includes('nome na descrição'));
    assert.equal(porId.get(3).sugestao.tipo, 'automatico');
    assert.deepEqual([porId.get(2).sugestao.tipo, porId.get(2).sugestao.itens.map(i => i.rotulo).sort()], ['composicao', ['Pedido 2540 · parcela 1', 'Pedido 2541 · parcela 1']]);
    assert.equal(porId.get(4).sugestao, null);
    assert.deepEqual(r.corpo.totais, { total: 4, a_conciliar: { quantidade: 4, total: 6812.9 }, com_sugestao: 3, conciliados: 0, ignorados: 0 });
    // A comissão paga por Pix em 15/08 não tem lançamento; o recebimento em dinheiro não conta.
    assert.deepEqual(r.corpo.sem_lancamento.map(l => l.chave), ['financeiro_pagamento:70']);
    const soPendentes = await ctx.chamar('GET', '/conciliacao?competencia=2026-08&visao=sugestoes');
    assert.equal(soPendentes.corpo.linhas.length, 3);
  } finally {
    await ctx.encerrar();
  }
});

test('em lote: só o automático; com "aceitar sugestões", as únicas também; a composição nunca', async () => {
  const ctx = await montar(cenario());
  try {
    const so = await ctx.chamar('POST', '/conciliacao/automatica', { conta_id: 1, competencia: '2026-08' });
    assert.equal(so.status, 200, JSON.stringify(so.corpo));
    assert.deepEqual([so.corpo.automatico, so.corpo.sugestao, so.corpo.total], [1, 0, 1]);
    assert.deepEqual(ctx.tabelas.conciliacao_vinculos.map(v => [v.movimento_id, v.alvo_tipo, v.alvo_id, v.valor, v.criterio]), [[3, 'titulo_pagamento', 102, 600, 'automatico']]);
    assert.equal(ctx.tabelas.movimentos_bancarios.find(m => m.id === 3).estado_conciliacao, 'conciliado');
    const tudo = await ctx.chamar('POST', '/conciliacao/automatica', { conta_id: 1, competencia: '2026-08', aceitar_sugestoes: true });
    assert.deepEqual([tudo.corpo.automatico, tudo.corpo.sugestao, tudo.corpo.restantes], [0, 1, 2]);
    assert.equal(ctx.tabelas.movimentos_bancarios.find(m => m.id === 2).estado_conciliacao, 'pendente', 'a soma dos boletos espera alguém');
    assert.deepEqual(ctx.tabelas.contabil_eventos.map(e => e.tipo), ['conciliacao_automatica', 'conciliacao_automatica']);
  } finally {
    await ctx.encerrar();
  }
});

test('à mão: a soma dos boletos; diferença só com justificativa (gravada); o que já está ligado e o outro sentido são recusados', async () => {
  const ctx = await montar(cenario());
  try {
    const soma = await ctx.chamar('POST', '/conciliacao/movimentos/2/conciliar', { itens: [{ tipo: 'recebimento', id: 1 }, { tipo: 'recebimento', id: 2 }], criterio: 'composicao' });
    assert.equal(soma.status, 200, JSON.stringify(soma.corpo));
    assert.deepEqual(ctx.tabelas.conciliacao_vinculos.map(v => [v.alvo_id, v.valor, v.criterio]), [[1, 1200, 'composicao'], [2, 2500, 'composicao']]);
    assert.match(ctx.tabelas.contabil_eventos[0].descricao, /conciliado com Pedido 2540 · parcela 1 \(Casa Vicenzo\) \+ Pedido 2541 · parcela 1 \(Casa Vicenzo\)/);

    const outroSentido = await ctx.chamar('POST', '/conciliacao/movimentos/1/conciliar', { itens: [{ tipo: 'recebimento', id: 3 }] });
    assert.equal(outroSentido.status, 422);
    const jaLigado = await ctx.chamar('POST', '/conciliacao/movimentos/4/conciliar', { itens: [{ tipo: 'titulo_pagamento', id: 102 }], justificativa: 'teste de ligado' });
    assert.equal(jaLigado.status, 200, 'o 102 ainda está livre');
    const deNovo = await ctx.chamar('POST', '/conciliacao/movimentos/3/conciliar', { itens: [{ tipo: 'titulo_pagamento', id: 102 }] });
    assert.equal(deNovo.status, 409);
    assert.match(deNovo.corpo.error, /já está conciliado com outro lançamento/);

    const semJust = await ctx.chamar('POST', '/conciliacao/movimentos/1/conciliar', { itens: [{ tipo: 'financeiro_pagamento', id: 70 }] });
    assert.equal(semJust.status, 422);
    assert.match(semNbsp(semJust.corpo.error), /diferença de R\$ 1\.600,00/);
    const comJust = await ctx.chamar('POST', '/conciliacao/movimentos/1/conciliar', { itens: [{ tipo: 'titulo_pagamento', id: 101 }], justificativa: '' });
    assert.equal(comJust.status, 200, 'soma exata não pede justificativa');
    const conc = await ctx.chamar('POST', '/conciliacao/movimentos/1/conciliar', { itens: [{ tipo: 'titulo_pagamento', id: 101 }] });
    assert.equal(conc.status, 409, 'lançamento conciliado não concilia de novo');
    const m4 = ctx.tabelas.movimentos_bancarios.find(m => m.id === 4);
    assert.deepEqual([m4.estado_conciliacao, m4.conciliacao_diferenca, m4.conciliacao_observacao], ['conciliado', -587.1, 'teste de ligado']);
  } finally {
    await ctx.encerrar();
  }
});

test('desfazer e ignorar pedem motivo; reativar volta a "a conciliar"; desfeito não apaga o vínculo', async () => {
  const ctx = await montar(cenario());
  try {
    await ctx.chamar('POST', '/conciliacao/movimentos/1/conciliar', { itens: [{ tipo: 'titulo_pagamento', id: 101 }] });
    assert.equal((await ctx.chamar('POST', '/conciliacao/movimentos/1/desfazer', { motivo: '' })).status, 400);
    const d = await ctx.chamar('POST', '/conciliacao/movimentos/1/desfazer', { motivo: 'Era o boleto errado' });
    assert.equal(d.status, 200, JSON.stringify(d.corpo));
    const v = ctx.tabelas.conciliacao_vinculos[0];
    assert.deepEqual([Boolean(v.desfeito_em), v.motivo_desfazer], [true, 'Era o boleto errado']);
    const m1 = ctx.tabelas.movimentos_bancarios.find(m => m.id === 1);
    assert.deepEqual([m1.estado_conciliacao, m1.conciliado_em], ['pendente', null]);
    // Desfeito libera o pagamento para outro lançamento.
    assert.equal((await ctx.chamar('POST', '/conciliacao/movimentos/1/conciliar', { itens: [{ tipo: 'titulo_pagamento', id: 101 }] })).status, 200);

    assert.equal((await ctx.chamar('POST', '/conciliacao/movimentos/4/ignorar', { motivo: 'x' })).status, 400);
    const ig = await ctx.chamar('POST', '/conciliacao/movimentos/4/ignorar', { motivo: 'Tarifa do banco: a contabilidade lança pelo extrato' });
    assert.equal(ig.status, 200);
    assert.equal(ctx.tabelas.movimentos_bancarios.find(m => m.id === 4).estado_conciliacao, 'ignorado');
    assert.equal((await ctx.chamar('POST', '/conciliacao/movimentos/4/conciliar', { itens: [{ tipo: 'titulo_pagamento', id: 102 }], justificativa: 'qualquer coisa' })).status, 409);
    const re = await ctx.chamar('POST', '/conciliacao/movimentos/4/reativar', {});
    assert.equal(re.status, 200);
    assert.deepEqual([ctx.tabelas.movimentos_bancarios.find(m => m.id === 4).estado_conciliacao, ctx.tabelas.movimentos_bancarios.find(m => m.id === 4).conciliacao_observacao], ['pendente', null]);
    assert.deepEqual(ctx.tabelas.contabil_eventos.map(e => e.tipo), ['conciliacao_feita', 'conciliacao_desfeita', 'conciliacao_feita', 'lancamento_ignorado', 'lancamento_reativado']);
  } finally {
    await ctx.encerrar();
  }
});

test('débito sem conta vira conta paga e conciliada; pagamento conciliado não se estorna; mês fechado recusa', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('POST', '/conciliacao/movimentos/4/criar-conta', { descricao: 'Tarifa bancária de agosto', categoria: 'Impostos e Taxas' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const t = ctx.tabelas.titulos_pagar.find(x => x.id === r.corpo.titulo_id);
    assert.deepEqual([t.descricao, t.valor_total, t.competencia, t.categoria], ['Tarifa bancária de agosto', 12.9, '2026-08', 'Impostos e Taxas']);
    const p = ctx.tabelas.titulo_pagar_pagamentos.find(x => x.id === r.corpo.pagamento_id);
    assert.deepEqual([p.data_pagamento, p.valor_pago, p.forma], ['2026-08-31', 12.9, 'Débito automático']);
    assert.deepEqual(ctx.tabelas.conciliacao_vinculos.map(v => [v.movimento_id, v.alvo_tipo, v.alvo_id, v.criterio]), [[4, 'titulo_pagamento', p.id, 'conta_criada']]);
    const estorno = await ctx.chamar('POST', `/pagamentos/${p.id}/estornar`, { motivo: 'Lançado errado' });
    assert.equal(estorno.status, 409);
    assert.match(estorno.corpo.error, /conciliado com o lançamento do extrato de 31\/08\/2026/);
    const credito = await ctx.chamar('POST', '/conciliacao/movimentos/2/criar-conta', { descricao: 'Não pode' });
    assert.equal(credito.status, 422);

    ctx.tabelas.competencia_contabil.push({ id: 1, competencia: '2026-08', status: 'fechada' });
    const fechado = await ctx.chamar('POST', '/conciliacao/movimentos/1/conciliar', { itens: [{ tipo: 'titulo_pagamento', id: 101 }] });
    assert.equal(fechado.status, 409);
    assert.match(fechado.corpo.error, /fechada/);
    assert.equal((await ctx.chamar('POST', '/conciliacao/automatica', { conta_id: 1, competencia: '2026-08' })).status, 409);
    const painel = await ctx.chamar('GET', '/conciliacao?competencia=2026-08');
    assert.equal(painel.corpo.fechada, true);
  } finally {
    await ctx.encerrar();
  }
});

test('checklist: pendentes = crítico (C5); conciliação com recebimento estornado = crítico; tudo resolvido = em dia', async () => {
  const ctx = await montar(cenario());
  try {
    const antes = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.equal(antes.status, 200);
    const fonte = antes.corpo.fontes.find(f => f.chave === 'conciliacao');
    assert.deepEqual([fonte.titulo, fonte.estado, fonte.pendencias], ['Conciliação e classificação', 'critico', 2]);
    const doc = antes.corpo.pendencias.find(p => p.chave === 'conciliacao_pendente');
    assert.deepEqual([doc.nivel, doc.filtro], ['critico', { acao: 'conciliacao', visao: 'pendentes' }]);
    assert.match(semNbsp(doc.descricao), /^Total R\$ 6\.812,90 · 3 com sugestão/);
    assert.equal(antes.corpo.pendencias.find(p => p.chave === 'conciliacao_sem_lancamento').nivel, 'aviso');

    await ctx.chamar('POST', '/conciliacao/movimentos/2/conciliar', { itens: [{ tipo: 'recebimento', id: 1 }, { tipo: 'recebimento', id: 2 }] });
    ctx.tabelas.recebimentos.find(r => r.id === 2).status = 'estornado';
    const depois = await ctx.chamar('GET', '/painel?competencia=2026-08');
    const crit = depois.corpo.pendencias.find(p => p.chave === 'conciliacao_invalida_2');
    assert.equal(crit.nivel, 'critico');
    assert.match(crit.descricao, /Pedido 2541 · parcela 1: recebimento estornado/);
    assert.ok(depois.corpo.bloqueios.fechar.some(t => /erro crítico/.test(t)));

    // Resolve tudo: desfaz a errada, concilia o resto e registra a comissão no extrato como ignorada.
    ctx.tabelas.recebimentos.find(r => r.id === 2).status = 'confirmado';
    await ctx.chamar('POST', '/conciliacao/automatica', { conta_id: 1, competencia: '2026-08', aceitar_sugestoes: true });
    await ctx.chamar('POST', '/conciliacao/movimentos/4/ignorar', { motivo: 'Tarifa do banco' });
    ctx.tabelas.movimentos_bancarios.push(mov(5, '2026-08-15', -900, 'PIX ENVIADO - ANA'));
    await ctx.chamar('POST', '/conciliacao/movimentos/5/conciliar', { itens: [{ tipo: 'financeiro_pagamento', id: 70 }] });
    const ok = await ctx.chamar('GET', '/painel?competencia=2026-08');
    const f = ok.corpo.fontes.find(x => x.chave === 'conciliacao');
    assert.deepEqual([f.estado, f.pendencias, f.resumo[0].valor], ['ok', 0, '4 de 5']);
  } finally {
    await ctx.encerrar();
  }
});

test('permissões: ver pede só "ver"; conciliar, desfazer, ignorar, reativar e o lote pedem "conciliar"; lançar conta pede as três', async () => {
  const ctx = await montar(cenario(), { permitir: ['contabilidade.view'] });
  try {
    assert.equal((await ctx.chamar('GET', '/conciliacao?competencia=2026-08')).status, 200);
    assert.equal((await ctx.chamar('GET', '/conciliacao/movimentos/1')).status, 200);
    const pedidas = async (caminho, corpo = {}) => (await ctx.chamar('POST', caminho, corpo)).corpo.pedidas;
    for (const acao of ['conciliar', 'desfazer', 'ignorar', 'reativar']) assert.deepEqual(await pedidas(`/conciliacao/movimentos/1/${acao}`), ['contabilidade.conciliar'], acao);
    assert.deepEqual(await pedidas('/conciliacao/automatica'), ['contabilidade.conciliar']);
    assert.deepEqual(await pedidas('/conciliacao/movimentos/1/criar-conta'), ['contabilidade.conciliar', 'contabilidade.pagar.lancar', 'contabilidade.pagar.pagar']);
    // Fase A: conciliar com a nota sem conta lança e paga; com a parcela em aberto, paga.
    assert.deepEqual(await pedidas('/conciliacao/movimentos/1/conciliar', { itens: [{ tipo: 'documento', id: 4 }] }), ['contabilidade.conciliar', 'contabilidade.pagar.lancar', 'contabilidade.pagar.pagar']);
    assert.deepEqual(await pedidas('/conciliacao/movimentos/1/conciliar', { itens: [{ tipo: 'parcela', id: 31 }] }), ['contabilidade.conciliar', 'contabilidade.pagar.pagar']);
  } finally {
    await ctx.encerrar();
  }
});

/** O caso do Bruno (NFS-e 17 sem conta, Pix no mesmo dia) e a conta de energia em aberto paga por boleto. */
function cenarioFaseA() {
  const base = cenario();
  return cenario({
    contatos: [...base.contatos, { id: 7, nome: 'Bruno Henrique Vigato Maia', cpf: '12345678909' }, { id: 8, nome: 'CEMIG Distribuição', cnpj: '06981180000116' }],
    documentos_recebidos: [{
      id: 4, tipo: 'nfse', origem: 'adn', numero: '17', emitente_nome: 'BRUNO HENRIQUE VIGATO MAIA', emitente_documento: '61234567000190', contato_id: 7,
      data_emissao: '2026-08-08', competencia: '2026-08', valor_total: 2800
    }],
    titulos_pagar: [...base.titulos_pagar, { id: 3, contato_id: 8, descricao: 'Energia de agosto', categoria: 'Energia', competencia: '2026-08', valor_total: 410.55, status: 'aberto' }],
    titulo_pagar_parcelas: [...base.titulo_pagar_parcelas, { id: 31, titulo_id: 3, numero: 1, vencimento: '2026-08-25', valor: 410.55 }],
    movimentos_bancarios: [
      ...base.movimentos_bancarios,
      mov(6, '2026-08-08', -2800, 'PIX ENVIADO - BRUNO HENRIQUE VIGATO MAI'),
      mov(7, '2026-08-26', -410.55, 'PAGAMENTO DE BOLETO', { contrapartida_documento: '06981180000116' })
    ]
  });
}

test('fase A: a nota sem conta e a conta em aberto casam com o débito; o lote lança/paga e concilia; desfazer estorna e cancela', async () => {
  const ctx = await montar(cenarioFaseA());
  try {
    const painel = await ctx.chamar('GET', '/conciliacao?competencia=2026-08');
    assert.equal(painel.status, 200, JSON.stringify(painel.corpo));
    const porId = new Map(painel.corpo.linhas.map(l => [l.id, l]));
    const s6 = porId.get(6).sugestao;
    assert.deepEqual([s6.tipo, s6.itens[0].tipo, s6.itens[0].obrigacao, s6.itens[0].rotulo, s6.itens[0].tipo_rotulo], ['automatico', 'documento', true, 'NFS-e 17', 'Nota sem conta a pagar']);
    assert.deepEqual([porId.get(7).sugestao.tipo, porId.get(7).sugestao.itens[0].chave], ['automatico', 'parcela:31']);
    assert.ok(!painel.corpo.sem_lancamento.some(l => l.obrigacao), 'obrigação não é "registrado sem lançamento"');

    // A escolha à mão mostra a nota entre as candidatas.
    const cand = await ctx.chamar('GET', '/conciliacao/movimentos/6');
    assert.deepEqual([cand.corpo.candidatos[0].chave, cand.corpo.candidatos[0].exato], ['documento:4', true]);

    const lote = await ctx.chamar('POST', '/conciliacao/automatica', { conta_id: 1, competencia: '2026-08' });
    assert.equal(lote.status, 200, JSON.stringify(lote.corpo));
    assert.deepEqual([lote.corpo.automatico, lote.corpo.contas_pagas, lote.corpo.contas_lancadas, lote.corpo.falhas], [3, 1, 1, []]);
    const conta = ctx.tabelas.titulos_pagar.find(t => t.documento_recebido_id === 4);
    assert.deepEqual([conta.descricao, conta.valor_total, conta.competencia, conta.contato_id, conta.origem], ['NFS-e 17 — Bruno Henrique Vigato Maia', 2800, '2026-08', 7, 'nfse']);
    const pagNota = ctx.tabelas.titulo_pagar_pagamentos.find(p => p.titulo_id === conta.id);
    assert.deepEqual([pagNota.data_pagamento, pagNota.valor_pago, pagNota.forma], ['2026-08-08', 2800, 'Pix']);
    assert.match(pagNota.observacao, /Pago pela conciliação com o extrato \(08\/08\/2026, PIX ENVIADO - BRUNO/);
    const pagEnergia = ctx.tabelas.titulo_pagar_pagamentos.find(p => p.parcela_id === 31);
    assert.deepEqual([pagEnergia.data_pagamento, pagEnergia.valor_pago, pagEnergia.forma], ['2026-08-26', 410.55, 'Boleto']);
    const vinc = movId => ctx.tabelas.conciliacao_vinculos.filter(v => v.movimento_id === movId && !v.desfeito_em).map(v => [v.alvo_tipo, v.alvo_id, v.valor, v.criterio]);
    assert.deepEqual(vinc(6), [['titulo_pagamento', pagNota.id, 2800, 'documento_pago']]);
    assert.deepEqual(vinc(7), [['titulo_pagamento', pagEnergia.id, 410.55, 'parcela_paga']]);
    assert.match(ctx.tabelas.contabil_eventos.find(e => e.tipo === 'conciliacao_automatica').descricao, /3 lançamentos conciliados em lote \(3 automáticos; 1 conta paga, 1 nota lançada e paga\)/);

    // Misturar a nota com outro registro não pode (ela é paga sozinha).
    const desfeito = await ctx.chamar('POST', '/conciliacao/movimentos/6/desfazer', { motivo: 'Era outro Pix do Bruno' });
    assert.equal(desfeito.status, 200, JSON.stringify(desfeito.corpo));
    assert.deepEqual([desfeito.corpo.estornados, desfeito.corpo.avisos], [1, []]);
    assert.ok(ctx.tabelas.titulo_pagar_pagamentos.find(p => p.id === pagNota.id).estornado_em, 'o pagamento foi estornado');
    assert.equal(ctx.tabelas.titulos_pagar.find(t => t.id === conta.id).status, 'cancelado', 'a conta lançada da nota caiu junto');
    assert.match(ctx.tabelas.contabil_eventos.filter(e => e.tipo === 'conciliacao_desfeita').at(-1).descricao, /a conta lançada da nota foi cancelada/);
    const misturado = await ctx.chamar('POST', '/conciliacao/movimentos/6/conciliar', { itens: [{ tipo: 'documento', id: 4 }, { tipo: 'financeiro_pagamento', id: 70 }], justificativa: 'tentativa' });
    assert.deepEqual([misturado.status, /paga sozinha/.test(misturado.corpo.error)], [422, true]);

    // À mão, de novo: a nota volta a ser obrigação e concilia (e lança a conta outra vez).
    const mao = await ctx.chamar('POST', '/conciliacao/movimentos/6/conciliar', { itens: [{ tipo: 'documento', id: 4 }] });
    assert.equal(mao.status, 200, JSON.stringify(mao.corpo));
    assert.equal(mao.corpo.conta_criada, true);
    assert.equal(ctx.tabelas.titulos_pagar.filter(t => t.documento_recebido_id === 4 && t.status !== 'cancelado').length, 1);

    // Desfazer a conta paga: o pagamento é estornado e a parcela volta a ficar em aberto (a conta continua).
    assert.equal((await ctx.chamar('POST', '/conciliacao/movimentos/7/desfazer', { motivo: 'Boleto de outra unidade' })).status, 200);
    assert.ok(ctx.tabelas.titulo_pagar_pagamentos.find(p => p.id === pagEnergia.id).estornado_em);
    assert.equal(ctx.tabelas.titulos_pagar.find(t => t.id === 3).status, 'aberto');
  } finally {
    await ctx.encerrar();
  }
});

test('fase A: registrar a nota já concilia sozinho o Pix que esperava no extrato', async () => {
  const base = cenario();
  const ctx = await montar(cenario({ movimentos_bancarios: [...base.movimentos_bancarios, mov(8, '2026-08-14', -350, 'PIX ENVIADO - MARCENARIA SILVA')] }));
  try {
    const r = await ctx.chamar('POST', '/documentos', {
      tipo: 'nfse', numero: '88', municipio: 'Belo Horizonte', emitente_nome: 'Marcenaria Silva Ltda', emitente_documento: '11222333000181',
      data_emissao: '2026-08-13', valor_total: 350, criar_fornecedor: false
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.conciliacao_resumo, '2 lançamentos conciliados sozinhos (1 nota lançada e paga)', 'o Pix da marcenaria e o da Vidros Norte (CNPJ)');
    assert.equal(ctx.tabelas.movimentos_bancarios.find(m => m.id === 8).estado_conciliacao, 'conciliado');
    const conta = ctx.tabelas.titulos_pagar.find(t => t.documento_recebido_id === r.corpo.id);
    assert.deepEqual([conta.valor_total, conta.descricao], [350, 'NFS-e 88 — Marcenaria Silva Ltda']);
    assert.match(ctx.tabelas.contabil_eventos.find(e => e.tipo === 'conciliacao_automatica').descricao, /conciliados sozinhos/);
  } finally {
    await ctx.encerrar();
  }
});

test('escolha à mão: o lançamento e as candidatas (mesmo sentido, as de mesmo valor primeiro)', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('GET', '/conciliacao/movimentos/1?dias=15');
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual([r.corpo.movimento.estado, r.corpo.movimento.conta, r.corpo.dias], ['pendente', 'BB — conta corrente', 15]);
    assert.deepEqual(r.corpo.candidatos.map(x => [x.chave, x.exato]), [['titulo_pagamento:101', true], ['financeiro_pagamento:70', false], ['titulo_pagamento:102', false]]);
    assert.equal(r.corpo.sugestao.itens[0].chave, 'titulo_pagamento:101');
    assert.ok(r.corpo.formas.includes('Débito automático'));
  } finally {
    await ctx.encerrar();
  }
});

test('sem o SQL da etapa 5: as rotas respondem 409 dizendo qual arquivo; o painel mostra a fonte como "falta o SQL"; o extrato continua', async () => {
  const dados = cenario();
  delete dados.conciliacao_vinculos;
  const ctx = await montar(dados);
  try {
    const r = await ctx.chamar('GET', '/conciliacao?competencia=2026-08');
    assert.equal(r.status, 409);
    assert.match(r.corpo.error, /sql\/contabilidade_conciliacao\.sql/);
    assert.equal((await ctx.chamar('POST', '/conciliacao/movimentos/1/ignorar', { motivo: 'Tarifa do banco' })).status, 409);
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    const f = painel.corpo.fontes.find(x => x.chave === 'conciliacao');
    assert.deepEqual([f.estado, /contabilidade_conciliacao\.sql/.test(f.nota)], ['indisponivel', true]);
    assert.equal((await ctx.chamar('GET', '/extrato?competencia=2026-08')).status, 200);
    // O estorno de pagamento não depende da conciliação.
    assert.equal((await ctx.chamar('POST', '/pagamentos/101/estornar', { motivo: 'Lançado errado' })).status, 200);
  } finally {
    await ctx.encerrar();
  }
});
