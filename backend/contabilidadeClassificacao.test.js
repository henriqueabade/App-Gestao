/**
 * Contabilidade — etapa 6 (classificação): as rotas de /api/contabilidade com
 * a API genérica e a guarda de permissão de mentira.
 *
 * O que fica preso (29/09/2026):
 *   - o mês: cada lançamento com a conta do plano e como ela veio (categoria
 *     da conta a pagar, origem do dinheiro, regra, à mão) e o total por conta;
 *   - classificar à mão, um ou vários; reclassificar guarda a anterior;
 *     voltar ao automático; mês fechado recusa;
 *   - o plano: nome repetido recusado; renomear leva a categoria das contas a
 *     pagar junto; conta com regra ativa não desativa;
 *   - as regras: criar, testar sem gravar, as sugeridas pelas classificações
 *     à mão; conta a pagar nova ganha a categoria pela regra do fornecedor;
 *   - o checklist cobra o lançamento sem classificação (documental);
 *   - cada rota pede a sua permissão; sem o SQL, 409 dizendo qual arquivo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  pedidos: ['id', 'numero', 'cliente_id'], clientes: ['id', 'nome', 'nome_fantasia', 'cnpj', 'cpf'],
  notas_fiscais: ['id'], notas_devolucao: ['id'], configuracao_fiscal: ['id', 'cnpj'], configuracao_cobranca: ['id'],
  financeiro_fechamentos: ['id', 'tipo', 'competencia', 'status', 'total', 'quantidade', 'pagar_ate', 'fechado_em'], financeiro_fechamento_itens: ['id'],
  financeiro_pagamentos: ['id', 'fechamento_id', 'tipo', 'competencia', 'valor', 'data_pagamento', 'forma', 'beneficiario'],
  recebimentos: ['id', 'pedido_id', 'numero_parcela', 'origem', 'forma', 'data_recebimento', 'valor_recebido', 'status'],
  reembolsos: ['id'], usuarios: ['id', 'nome'], contatos: ['id', 'nome', 'cnpj', 'cpf'],
  competencia_contabil: ['id', 'competencia', 'status'], contabil_pendencias_resolucoes: ['id', 'competencia', 'chave'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em', 'referencia_tipo', 'referencia_id'],
  contabil_arquivos: ['id'], contabil_arquivo_vinculos: ['id', 'alvo_tipo', 'alvo_id'], documentos_recebidos: ['id', 'cfops', 'excluido_em'],
  titulos_pagar: ['id', 'contato_id', 'documento_recebido_id', 'descricao', 'categoria', 'numero_documento', 'data_emissao', 'competencia', 'valor_total', 'status', 'origem',
    'observacao', 'criado_por', 'criado_em', 'atualizado_em'],
  titulo_pagar_parcelas: ['id', 'titulo_id', 'numero', 'vencimento', 'valor', 'linha_digitavel'],
  titulo_pagar_pagamentos: ['id', 'parcela_id', 'titulo_id', 'data_pagamento', 'competencia', 'valor_pago', 'forma', 'estornado_em'],
  contas_financeiras: ['id', 'nome', 'tipo', 'banco_codigo', 'agencia', 'conta', 'ativa'],
  extrato_importacoes: ['id', 'conta_id', 'status', 'periodo_inicio', 'periodo_fim'],
  movimentos_bancarios: ['id', 'conta_id', 'data', 'competencia', 'valor', 'tipo', 'descricao', 'documento', 'contrapartida_documento', 'estado_conciliacao'],
  conciliacao_vinculos: ['id', 'movimento_id', 'alvo_tipo', 'alvo_id', 'valor', 'criterio', 'desfeito_em'],
  plano_contas: ['id', 'codigo', 'nome', 'tipo', 'ativa', 'observacao', 'origem', 'criado_por', 'criado_em', 'atualizado_em',
    // Fase B (sql/contabilidade_fase_b.sql).
    'codigo_reduzido', 'natureza', 'analitica', 'nivel', 'conta_pai_id', 'em_uso', 'comprovante_basta', 'desdobra', 'contato_id', 'cliente_id', 'conta_financeira_id'],
  classificacao_regras: ['id', 'condicao_tipo', 'valor', 'sentido', 'conta_id', 'prioridade', 'ativa', 'origem', 'observacao', 'criado_por', 'criado_em', 'atualizado_em'],
  classificacoes: ['id', 'movimento_id', 'conta_id', 'observacao', 'criado_por', 'criado_em', 'substituida_em', 'substituida_por']
};

const UNICOS = {
  // Como no banco depois da fase B: o nome é único só entre as contas criadas à mão (e as que vieram com o app).
  plano_contas: (novo, linhas) => ['manual', 'padrao'].includes(novo.origem || 'manual')
    && linhas.some(r => ['manual', 'padrao'].includes(r.origem || 'manual') && String(r.nome).toLowerCase() === String(novo.nome).toLowerCase()),
  classificacoes: (novo, linhas) => linhas.some(r => !r.substituida_em && String(r.movimento_id) === String(novo.movimento_id))
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
  './contabilidade/documentosRecebidos', './contabilidade/extrato/extrato', './contabilidade/extrato/ofx',
  './contabilidade/conciliacao/conciliacao', './contabilidade/conciliacao/liquidacoes', './contabilidade/conciliacao/motor',
  './contabilidade/classificacao/classificacao', './contabilidade/classificacao/regras', './contabilidade/classificacao/plano'
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
      method: metodo, headers: { authorization: `Bearer ${tokenDe(3)}`, 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined
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

const mov = (id, data, valor, descricao, estado = 'pendente') => ({ id, conta_id: 1, data, competencia: data.slice(0, 7), valor, tipo: valor < 0 ? 'debito' : 'credito', descricao, estado_conciliacao: estado });
const regra = (id, condicao_tipo, valor, sentido, conta_id, extra = {}) => ({ id, condicao_tipo, valor, sentido, conta_id, prioridade: 0, ativa: true, origem: 'padrao', ...extra });

function cenario(extra = {}) {
  return {
    pedidos: [{ id: 1, numero: 2540, cliente_id: 8 }], clientes: [{ id: 8, nome_fantasia: 'Casa Vicenzo' }],
    notas_fiscais: [], notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: '11444777000161' }], configuracao_cobranca: [],
    financeiro_fechamentos: [{ id: 1, tipo: 'comissao', competencia: '2026-07', status: 'fechado', total: 900 }], financeiro_fechamento_itens: [],
    financeiro_pagamentos: [{ id: 70, fechamento_id: 1, tipo: 'comissao', competencia: '2026-07', valor: 900, data_pagamento: '2026-08-15', forma: 'Pix', beneficiario: 'Ana' }],
    recebimentos: [{ id: 1, pedido_id: 1, numero_parcela: 1, origem: 'boleto', forma: 'Boleto', data_recebimento: '2026-08-10', valor_recebido: 3700, status: 'confirmado' }],
    reembolsos: [], usuarios: [{ id: 3, nome: 'Henrique' }],
    contatos: [{ id: 5, nome: 'Imobiliária Centro' }, { id: 6, nome: 'Vidros Norte', cnpj: '84031759000121' }],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [], contabil_arquivos: [], contabil_arquivo_vinculos: [], documentos_recebidos: [],
    titulos_pagar: [{ id: 1, contato_id: 5, descricao: 'Aluguel de agosto', categoria: 'Serviços de Terceiros', competencia: '2026-08', valor_total: 2500, status: 'aberto' }],
    titulo_pagar_parcelas: [{ id: 11, titulo_id: 1, numero: 1, vencimento: '2026-08-05', valor: 2500 }],
    titulo_pagar_pagamentos: [{ id: 101, parcela_id: 11, titulo_id: 1, data_pagamento: '2026-08-05', competencia: '2026-08', valor_pago: 2500, forma: 'Boleto' }],
    contas_financeiras: [{ id: 1, nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1234', conta: '123456', ativa: true }],
    extrato_importacoes: [{ id: 1, conta_id: 1, status: 'completa', periodo_inicio: '2026-08-01', periodo_fim: '2026-08-31' }],
    movimentos_bancarios: [
      mov(1, '2026-08-05', -2500, 'Pagamento de boleto - Imobiliária Centro', 'conciliado'),
      mov(2, '2026-08-11', 3700, 'LIQUIDAÇÃO DE COBRANÇA', 'conciliado'),
      mov(3, '2026-08-31', -12.9, 'Tarifa pacote de serviços'),
      mov(4, '2026-08-12', 1850, 'PIX RECEBIDO - CLIENTE DA LOJA'),
      mov(5, '2026-08-15', -900, 'PIX ENVIADO - ANA', 'conciliado')
    ],
    conciliacao_vinculos: [
      { id: 1, movimento_id: 1, alvo_tipo: 'titulo_pagamento', alvo_id: 101, valor: 2500, criterio: 'sugestao' },
      { id: 2, movimento_id: 2, alvo_tipo: 'recebimento', alvo_id: 1, valor: 3700, criterio: 'sugestao' },
      { id: 3, movimento_id: 5, alvo_tipo: 'financeiro_pagamento', alvo_id: 70, valor: 900, criterio: 'manual' }
    ],
    plano_contas: [
      { id: 1, nome: 'Receita de vendas', tipo: 'receita', ativa: true, origem: 'padrao' }, { id: 2, nome: 'Serviços de Terceiros', tipo: 'despesa', ativa: true, origem: 'padrao' },
      { id: 3, nome: 'Despesas bancárias', tipo: 'despesa', ativa: true, origem: 'padrao' }, { id: 4, nome: 'Comissões sobre vendas', tipo: 'despesa', ativa: true, origem: 'padrao' },
      { id: 5, nome: 'Aquisição de Bens', tipo: 'custo', ativa: true, origem: 'padrao' }, { id: 6, nome: 'Aporte de Capital', tipo: 'patrimonio', ativa: true, origem: 'padrao' }
    ],
    classificacao_regras: [
      regra(1, 'origem', 'recebimento', 'credito', 1), regra(2, 'origem', 'comissao', 'debito', 4),
      regra(3, 'descricao', 'TARIFA', 'debito', 3), regra(4, 'fornecedor', '6', 'ambos', 5)
    ],
    classificacoes: [],
    ...extra
  };
}

test('o mês: a conta de cada lançamento e como veio; o total por conta; os totais', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('GET', '/classificacao?competencia=2026-08');
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const porId = new Map(r.corpo.linhas.map(l => [l.id, l.classificacao]));
    assert.deepEqual([porId.get(1).conta, porId.get(1).criterio], ['Serviços de Terceiros', 'titulo']);
    assert.deepEqual([porId.get(2).conta, porId.get(2).criterio], ['Receita de vendas', 'origem']);
    assert.deepEqual([porId.get(3).conta, porId.get(3).criterio], ['Despesas bancárias', 'regra']);
    assert.deepEqual([porId.get(4).conta, porId.get(4).criterio], [null, 'sem']);
    assert.deepEqual([porId.get(5).conta, porId.get(5).criterio], ['Comissões sobre vendas', 'origem']);
    assert.deepEqual(r.corpo.totais, { total: 5, classificados: 4, sem: 1, sem_valor: 1850, manuais: 0, automaticos: 4 });
    assert.deepEqual(r.corpo.por_conta.map(g => [g.conta, g.resultado]), [
      ['Receita de vendas', 3700], ['Comissões sobre vendas', -900], ['Despesas bancárias', -12.9], ['Serviços de Terceiros', -2500], ['Sem classificação', 1850]
    ]);
    assert.equal(r.corpo.plano.length, 6);
    assert.equal((await ctx.chamar('GET', '/classificacao?competencia=2026-08&visao=sem')).corpo.linhas.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('à mão: um ou vários; reclassificar guarda a anterior; voltar ao automático; mês fechado recusa', async () => {
  const ctx = await montar(cenario());
  try {
    const um = await ctx.chamar('POST', '/classificacao/classificar', { ids: [4], conta_id: 1, observacao: 'Venda de balcão' });
    assert.equal(um.status, 200, JSON.stringify(um.corpo));
    let linha = (await ctx.chamar('GET', '/classificacao?competencia=2026-08')).corpo.linhas.find(l => l.id === 4).classificacao;
    assert.deepEqual([linha.conta, linha.criterio, linha.detalhe], ['Receita de vendas', 'manual', 'Venda de balcão']);
    await ctx.chamar('POST', '/classificacao/classificar', { ids: [4], conta_id: 6 });
    assert.equal(ctx.tabelas.classificacoes.length, 2);
    assert.ok(ctx.tabelas.classificacoes[0].substituida_em, 'a anterior fica, substituída');
    // A mão vence a regra: a tarifa vira "Serviços de Terceiros".
    const lote = await ctx.chamar('POST', '/classificacao/classificar', { ids: [3, 4], conta_id: 2 });
    assert.deepEqual(lote.corpo, { classificados: 2, conta: 'Serviços de Terceiros' });
    linha = (await ctx.chamar('GET', '/classificacao?competencia=2026-08')).corpo.linhas.find(l => l.id === 3).classificacao;
    assert.deepEqual([linha.conta, linha.criterio], ['Serviços de Terceiros', 'manual']);
    const volta = await ctx.chamar('POST', '/classificacao/movimentos/3/automatico', {});
    assert.equal(volta.status, 200);
    linha = (await ctx.chamar('GET', '/classificacao?competencia=2026-08')).corpo.linhas.find(l => l.id === 3).classificacao;
    assert.deepEqual([linha.conta, linha.criterio], ['Despesas bancárias', 'regra']);
    assert.equal((await ctx.chamar('POST', '/classificacao/movimentos/3/automatico', {})).status, 409, 'não está mais à mão');
    assert.deepEqual(ctx.tabelas.contabil_eventos.map(e => e.tipo), ['lancamento_classificado', 'lancamento_classificado', 'lancamento_classificado', 'classificacao_removida']);
    assert.equal((await ctx.chamar('POST', '/classificacao/classificar', { ids: [4], conta_id: 99 })).status, 404);
    assert.equal((await ctx.chamar('POST', '/classificacao/classificar', { ids: [], conta_id: 1 })).status, 400);
    ctx.tabelas.competencia_contabil.push({ id: 1, competencia: '2026-08', status: 'fechada' });
    const fechado = await ctx.chamar('POST', '/classificacao/classificar', { ids: [4], conta_id: 1 });
    assert.equal(fechado.status, 409);
    assert.match(fechado.corpo.error, /agosto\/2026 está fechada/);
    assert.equal((await ctx.chamar('GET', '/classificacao?competencia=2026-08')).corpo.fechada, true);
  } finally {
    await ctx.encerrar();
  }
});

test('plano: uso de cada conta; nome repetido recusado; renomear leva a categoria das contas a pagar; conta com regra ativa não desativa', async () => {
  const ctx = await montar(cenario());
  try {
    const lista = await ctx.chamar('GET', '/plano-contas');
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.corpo.contas.find(p => p.id === 2).uso, { titulos: 1, regras: 0, classificacoes: 0, desdobramentos: 0 });
    assert.equal((await ctx.chamar('POST', '/plano-contas', { nome: 'Energia elétrica', tipo: 'despesa' })).status, 200);
    const repetida = await ctx.chamar('POST', '/plano-contas', { nome: '  despesas  BANCARIAS ' });
    assert.equal(repetida.status, 409);
    assert.match(repetida.corpo.error, /Já existe a conta "Despesas bancárias"/);
    const renomeada = await ctx.chamar('PUT', '/plano-contas/2', { nome: 'Serviços de terceiros (PJ)', tipo: 'despesa' });
    assert.deepEqual([renomeada.status, renomeada.corpo.renomeadas], [200, 1]);
    assert.equal(ctx.tabelas.titulos_pagar[0].categoria, 'Serviços de terceiros (PJ)');
    const mes = await ctx.chamar('GET', '/classificacao?competencia=2026-08');
    assert.equal(mes.corpo.linhas.find(l => l.id === 1).classificacao.conta, 'Serviços de terceiros (PJ)', 'o aluguel continua classificado');
    const comRegra = await ctx.chamar('PUT', '/plano-contas/3', { nome: 'Despesas bancárias', tipo: 'despesa', ativa: false });
    assert.equal(comRegra.status, 409);
    assert.match(comRegra.corpo.error, /1 regra ativa usa esta conta/);
    assert.equal((await ctx.chamar('PUT', '/plano-contas/6', { nome: 'Aporte de Capital', tipo: 'patrimonio', ativa: false })).status, 200);
    assert.ok(ctx.tabelas.contabil_eventos.some(e => e.tipo === 'plano_conta_salva' && /nome "Serviços de Terceiros" → "Serviços de terceiros \(PJ\)" \(1 conta a pagar acompanhou\)/.test(e.descricao)));
  } finally {
    await ctx.encerrar();
  }
});

test('regras: criar, testar sem gravar, sugeridas pelas classificações à mão; conta a pagar nova ganha a categoria pela regra do fornecedor', async () => {
  const ctx = await montar(cenario({ movimentos_bancarios: [...cenario().movimentos_bancarios, mov(6, '2026-08-20', 800, 'PIX RECEBIDO - CLIENTE DA LOJA')] }));
  try {
    const teste = await ctx.chamar('POST', '/regras/testar', { condicao_tipo: 'descricao', valor: 'cliente da loja', sentido: 'credito', conta_id: 1, competencia: '2026-08' });
    assert.equal(teste.status, 200, JSON.stringify(teste.corpo));
    assert.deepEqual([teste.corpo.quantidade, teste.corpo.mudariam, teste.corpo.conta], [2, 2, 'Receita de vendas']);
    assert.equal(ctx.tabelas.classificacao_regras.length, 4, 'testar não grava');

    await ctx.chamar('POST', '/classificacao/classificar', { ids: [4, 6], conta_id: 1 });
    const antes = await ctx.chamar('GET', '/regras');
    assert.deepEqual(antes.corpo.sugeridas.map(s => [s.valor, s.sentido, s.conta, s.quantidade]), [['CLIENTE DA LOJA', 'credito', 'Receita de vendas', 2]]);
    assert.deepEqual(antes.corpo.regras.map(r => [r.condicao_tipo, r.valor_rotulo, r.conta]).slice(0, 2), [['descricao', '"TARIFA"', 'Despesas bancárias'], ['fornecedor', 'Vidros Norte', 'Aquisição de Bens']]);

    const criada = await ctx.chamar('POST', '/regras', { condicao_tipo: 'descricao', valor: 'Cliente da loja', sentido: 'credito', conta_id: 1 });
    assert.equal(criada.status, 200, JSON.stringify(criada.corpo));
    assert.deepEqual(ctx.tabelas.classificacao_regras.at(-1).valor, 'CLIENTE DA LOJA');
    const depois = await ctx.chamar('GET', '/regras');
    assert.deepEqual(depois.corpo.sugeridas, [], 'a regra nova cobre as duas');
    assert.equal((await ctx.chamar('POST', '/regras', { condicao_tipo: 'descricao', valor: 'x' })).status, 400);
    assert.equal((await ctx.chamar('PUT', `/regras/${criada.corpo.id}`, { condicao_tipo: 'descricao', valor: 'CLIENTE DA LOJA', sentido: 'credito', conta_id: 1, ativa: false })).status, 200);
    assert.equal(ctx.tabelas.classificacao_regras.at(-1).ativa, false);

    // Conta a pagar nova da Vidros (fornecedor com regra) sem categoria: vem "Aquisição de Bens".
    const conta = await ctx.chamar('POST', '/titulos', { descricao: 'Vidros da obra', contato_id: 6, valor_total: '600,00', data_emissao: '2026-08-10', quantidade_parcelas: 1, primeiro_vencimento: '2026-08-20' });
    assert.equal(conta.status, 200, JSON.stringify(conta.corpo));
    assert.equal(ctx.tabelas.titulos_pagar.at(-1).categoria, 'Aquisição de Bens');
    const cats = await ctx.chamar('GET', '/categorias');
    assert.deepEqual(cats.corpo.categorias.slice(0, 3), ['Aporte de Capital', 'Aquisição de Bens', 'Comissões sobre vendas']);
    assert.equal(cats.corpo.plano, true);
  } finally {
    await ctx.encerrar();
  }
});

test('checklist: lançamento sem classificação é crítico (C7) na fonte "Conciliação e classificação"; classificado, some', async () => {
  const ctx = await montar(cenario());
  try {
    const antes = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.equal(antes.status, 200);
    const fonte = antes.corpo.fontes.find(f => f.chave === 'conciliacao');
    assert.equal(fonte.titulo, 'Conciliação e classificação');
    assert.equal(fonte.resumo.find(r => r.rotulo === 'Sem classificação').valor.replace(/ /g, ' '), '1 · R$ 1.850,00');
    const p = antes.corpo.pendencias.find(x => x.chave === 'classificacao_pendente');
    assert.deepEqual([p.nivel, p.titulo, p.filtro], ['critico', '1 lançamento do extrato sem classificação', { acao: 'classificacao', visao: 'sem' }]);
    await ctx.chamar('POST', '/classificacao/classificar', { ids: [4], conta_id: 1 });
    const depois = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.ok(!depois.corpo.pendencias.some(x => x.chave === 'classificacao_pendente'));
  } finally {
    await ctx.encerrar();
  }
});

test('permissões: ver e testar pedem só "ver"; classificar pede "classificar"; plano e regras pedem "plano e regras"', async () => {
  const ctx = await montar(cenario(), { permitir: ['contabilidade.view'] });
  try {
    for (const rota of ['/classificacao?competencia=2026-08', '/plano-contas', '/regras']) assert.equal((await ctx.chamar('GET', rota)).status, 200, rota);
    assert.equal((await ctx.chamar('POST', '/regras/testar', { condicao_tipo: 'descricao', valor: 'TARIFA', conta_id: 3, competencia: '2026-08' })).status, 200);
    const pedidas = async (metodo, caminho) => (await ctx.chamar(metodo, caminho, {})).corpo.pedidas;
    assert.deepEqual(await pedidas('POST', '/classificacao/classificar'), ['contabilidade.classificar']);
    assert.deepEqual(await pedidas('POST', '/classificacao/movimentos/3/automatico'), ['contabilidade.classificar']);
    for (const [m, c] of [['POST', '/plano-contas'], ['PUT', '/plano-contas/1'], ['PUT', '/plano-contas/1/marcas'], ['POST', '/plano-contas/1/desdobrar'], ['POST', '/regras'], ['PUT', '/regras/1']]) {
      assert.deepEqual(await pedidas(m, c), ['contabilidade.plano.gerir'], `${m} ${c}`);
    }
  } finally {
    await ctx.encerrar();
  }
});

/** Um pedaço do plano da AEA como o SQL da fase B grava. */
const aea = (id, reduzido, codigo, nome, tipo, extra = {}) => ({
  id, codigo_reduzido: reduzido, codigo, nome, tipo, natureza: 'D', analitica: true, nivel: codigo.split('.').length, ativa: true,
  origem: 'aea', em_uso: true, comprovante_basta: false, desdobra: false, conta_pai_id: null, contato_id: null, cliente_id: null, conta_financeira_id: null, ...extra
});

function cenarioFaseB() {
  const base = cenario();
  return cenario({
    // O aluguel virou "00372 · Aluguel" (custo de fabricação) e a conta de luz é da CEMIG (o comprovante basta).
    titulos_pagar: [
      { ...base.titulos_pagar[0], categoria: '00372 · Aluguel' },
      { id: 2, contato_id: null, descricao: 'Conta de luz — agosto', categoria: '00383 · Energia Eletrica', competencia: '2026-08', valor_total: 410.55, status: 'aberto' }
    ],
    plano_contas: [
      aea(1, '00528', '4.01.01.01.002', 'Industrialização de Mercadorias', 'receita', { natureza: 'C' }),
      aea(2, '00438', '3.02.01.03', 'DESPESAS ADMINISTRATIVAS', 'despesa', { analitica: false, em_uso: false }),
      aea(3, '00491', '3.02.02.01.001', 'Despesas Bancárias', 'despesa', { comprovante_basta: true }),
      aea(4, '00445', '3.02.01.03.007', 'Comissões sobre Vendas', 'despesa'),
      aea(5, '00340', '3.01.01.01.001', 'Compra de Mercadorias', 'custo'),
      aea(6, '00440', '3.02.01.03.002', 'Aluguel', 'despesa', { em_uso: false }),
      aea(7, '00372', '3.01.02.04.002', 'Aluguel', 'custo'),
      aea(8, '00383', '3.01.02.04.013', 'Energia Eletrica', 'custo', { comprovante_basta: true }),
      aea(9, '00223', '2.01.02.01.001', 'Fornecedores Nacionais', 'passivo', { natureza: 'C', desdobra: true }),
      aea(10, '00008', '1.01.01.02.002', 'Banco do Brasil', 'ativo'),
      { id: 20, nome: 'Receita de vendas', tipo: 'receita', ativa: false, origem: 'padrao', codigo: null, codigo_reduzido: null, em_uso: false, observacao: 'Substituída por 00528 · Industrialização de Mercadorias (plano da AEA, fase B).' }
    ],
    contas_financeiras: [{ ...base.contas_financeiras[0], plano_conta_id: 10 }]
  });
}

test('fase B — plano da AEA: códigos, só as em uso se escolhem, marcar em uso / o comprovante basta, desdobrar com final .001', async () => {
  const ctx = await montar(cenarioFaseB());
  try {
    const lista = await ctx.chamar('GET', '/plano-contas');
    assert.equal(lista.status, 200, JSON.stringify(lista.corpo));
    assert.equal(lista.corpo.fase_b, true);
    const conta = id => lista.corpo.contas.find(p => p.id === id);
    assert.deepEqual([conta(7).rotulo, conta(7).classificacao, conta(7).selecionavel, conta(7).uso.titulos], ['00372 · Aluguel', '3.01.02.04.002', true, 1]);
    assert.deepEqual([conta(6).selecionavel, conta(2).selecionavel, conta(20).ativa], [false, false, false]);
    assert.equal(lista.corpo.contas[0].codigo, '00008', 'na ordem da classificação (1.01… primeiro)');

    // Classificação: a categoria pelo código; a lista de escolha só com as em uso.
    const mes = await ctx.chamar('GET', '/classificacao?competencia=2026-08');
    const aluguel = mes.corpo.linhas.find(l => l.id === 1).classificacao;
    assert.deepEqual([aluguel.conta, aluguel.conta_codigo, aluguel.criterio], ['Aluguel', '00372', 'titulo']);
    assert.deepEqual(mes.corpo.plano.map(p => p.codigo).sort(), ['00008', '00223', '00340', '00372', '00383', '00445', '00491', '00528']);
    const foraDeUso = await ctx.chamar('POST', '/classificacao/classificar', { ids: [4], conta_id: 6 });
    assert.deepEqual([foraDeUso.status, /não está em uso/.test(foraDeUso.corpo.error)], [409, true]);
    const cats = await ctx.chamar('GET', '/categorias');
    assert.ok(cats.corpo.categorias.includes('00383 · Energia Eletrica') && !cats.corpo.categorias.includes('00440 · Aluguel'), JSON.stringify(cats.corpo.categorias));

    // Marcas: a sintética não entra em uso; a 00440 entra; conta com regra não sai de uso; o comprovante basta.
    assert.equal((await ctx.chamar('PUT', '/plano-contas/2/marcas', { em_uso: true })).status, 422);
    const usa = await ctx.chamar('PUT', '/plano-contas/6/marcas', { em_uso: true });
    assert.deepEqual([usa.status, usa.corpo.alterado], [200, ['em uso']]);
    assert.equal(ctx.tabelas.plano_contas.find(p => p.id === 6).em_uso, true);
    const comRegra = await ctx.chamar('PUT', '/plano-contas/3/marcas', { em_uso: false });
    assert.deepEqual([comRegra.status, /regra ativa usa esta conta/.test(comRegra.corpo.error)], [409, true]);
    assert.equal((await ctx.chamar('PUT', '/plano-contas/7/marcas', { comprovante_basta: true })).corpo.alterado[0], 'o comprovante basta como documento');
    // A conta da AEA não se edita pelo formulário (nome, código, tipo).
    const editar = await ctx.chamar('PUT', '/plano-contas/7', { nome: 'Aluguel do galpão', tipo: 'custo' });
    assert.deepEqual([editar.status, /plano da AEA/.test(editar.corpo.error)], [409, true]);

    // Desdobrar fornecedores: 00223.001, 00223.002; nome repetido recusado; só conta analítica da AEA.
    const um = await ctx.chamar('POST', '/plano-contas/9/desdobrar', { nome: 'Vidros Norte', contato_id: 6 });
    assert.equal(um.status, 200, JSON.stringify(um.corpo));
    assert.deepEqual([um.corpo.codigo, um.corpo.classificacao, um.corpo.rotulo, um.corpo.tipo, um.corpo.contato_id], ['00223.001', '2.01.02.01.001.001', '00223.001 · Vidros Norte', 'passivo', 6]);
    assert.equal((await ctx.chamar('POST', '/plano-contas/9/desdobrar', { nome: 'Imobiliária Centro', contato_id: 5 })).corpo.codigo, '00223.002');
    assert.equal((await ctx.chamar('POST', '/plano-contas/9/desdobrar', { nome: 'vidros  norte' })).status, 409);
    assert.equal((await ctx.chamar('POST', '/plano-contas/9/desdobrar', { nome: 'X' })).status, 400);
    assert.equal((await ctx.chamar('POST', '/plano-contas/2/desdobrar', { nome: 'Algo' })).status, 422);
    assert.equal((await ctx.chamar('POST', '/plano-contas/20/desdobrar', { nome: 'Algo' })).status, 422);
    const depois = await ctx.chamar('GET', '/plano-contas');
    const ordem = depois.corpo.contas.map(p => p.codigo);
    assert.deepEqual(ordem.slice(ordem.indexOf('00223'), ordem.indexOf('00223') + 3), ['00223', '00223.001', '00223.002'], 'o desdobramento logo abaixo da conta');
    assert.equal(depois.corpo.contas.find(p => p.id === 9).uso.desdobramentos, 2);
    assert.ok(ctx.tabelas.contabil_eventos.some(e => /00223 · Fornecedores Nacionais desdobrada: 00223\.001 · Vidros Norte/.test(e.descricao)));
  } finally {
    await ctx.encerrar();
  }
});

test('fase B — sem o SQL da fase B, marcar e desdobrar dizem qual arquivo rodar; o resto continua', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('PUT', '/plano-contas/1/marcas', { em_uso: true });
    assert.deepEqual([r.status, r.corpo.sql_arquivo], [409, 'sql/contabilidade_fase_b.sql']);
    assert.equal((await ctx.chamar('POST', '/plano-contas/1/desdobrar', { nome: 'Algo' })).corpo.sql_arquivo, 'sql/contabilidade_fase_b.sql');
    assert.equal((await ctx.chamar('GET', '/plano-contas')).corpo.fase_b, false);
  } finally {
    await ctx.encerrar();
  }
});

test('sem o SQL da etapa 6: 409 dizendo qual arquivo; o checklist mostra "falta o SQL"; conta a pagar nova continua', async () => {
  const dados = cenario();
  for (const t of ['plano_contas', 'classificacao_regras', 'classificacoes']) delete dados[t];
  const ctx = await montar(dados);
  try {
    const r = await ctx.chamar('GET', '/classificacao?competencia=2026-08');
    assert.equal(r.status, 409);
    assert.match(r.corpo.error, /sql\/contabilidade_classificacao\.sql/);
    assert.equal((await ctx.chamar('GET', '/regras')).status, 409);
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    const fonte = painel.corpo.fontes.find(f => f.chave === 'conciliacao');
    assert.equal(fonte.resumo.find(x => x.rotulo === 'Sem classificação').valor, 'falta o SQL');
    assert.ok(!painel.corpo.pendencias.some(x => x.chave === 'classificacao_pendente'));
    const conta = await ctx.chamar('POST', '/titulos', { descricao: 'Vidros', contato_id: 6, valor_total: 100, data_emissao: '2026-08-10', quantidade_parcelas: 1, primeiro_vencimento: '2026-08-20' });
    assert.equal(conta.status, 200, JSON.stringify(conta.corpo));
    assert.equal(ctx.tabelas.titulos_pagar.at(-1).categoria ?? null, null);
    assert.equal((await ctx.chamar('GET', '/categorias')).corpo.plano, false);
  } finally {
    await ctx.encerrar();
  }
});
