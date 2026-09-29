/**
 * Contabilidade — etapa 7 (fechamento completo): as rotas de
 * /api/contabilidade com a API genérica e a guarda de permissão de mentira.
 *
 * O que fica preso (29/09/2026):
 *   - a prévia diz o que vai ser congelado (resultado por conta do plano,
 *     extrato com o saldo do banco, lançamentos sem conta) sem gravar;
 *   - fechar grava a versão 1 com a foto e a conta de cada lançamento; a
 *     classificação do mês fechado passa a ser a congelada;
 *   - regra nova depois do fechamento não muda o mês: vira diferença (aviso)
 *     com a lista no histórico;
 *   - reabrir marca a versão; fechar de novo cria a versão 2 e o histórico
 *     compara as duas;
 *   - sem o SQL da etapa 7, fechar continua (com aviso) e o histórico
 *     responde 409 dizendo qual arquivo.
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
  competencia_contabil: ['id', 'competencia', 'status', 'fechada_em', 'fechada_por', 'reaberta_em', 'reaberta_por', 'justificativa_reabertura', 'totais', 'pendencias_no_fechamento', 'criado_em', 'atualizado_em'],
  contabil_pendencias_resolucoes: ['id', 'competencia', 'chave', 'nivel', 'titulo', 'justificativa', 'usuario_id', 'criado_em'],
  competencia_fechamentos: ['id', 'competencia', 'versao', 'fechada_em', 'fechada_por', 'foto', 'lancamentos', 'pendencias', 'hash', 'reaberta_em', 'reaberta_por', 'justificativa_reabertura'],
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
  plano_contas: ['id', 'codigo', 'nome', 'tipo', 'ativa', 'observacao', 'origem', 'criado_por', 'criado_em', 'atualizado_em'],
  classificacao_regras: ['id', 'condicao_tipo', 'valor', 'sentido', 'conta_id', 'prioridade', 'ativa', 'origem', 'observacao', 'criado_por', 'criado_em', 'atualizado_em'],
  classificacoes: ['id', 'movimento_id', 'conta_id', 'observacao', 'criado_por', 'criado_em', 'substituida_em', 'substituida_por']
};

const UNICOS = {
  competencia_fechamentos: (novo, linhas) => linhas.some(r => r.competencia === novo.competencia && Number(r.versao) === Number(novo.versao)),
  competencia_contabil: (novo, linhas) => linhas.some(r => r.competencia === novo.competencia),
  plano_contas: (novo, linhas) => linhas.some(r => String(r.nome).toLowerCase() === String(novo.nome).toLowerCase()),
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
  './contabilidade/classificacao/classificacao', './contabilidade/classificacao/regras', './contabilidade/classificacao/plano', './contabilidade/versoes'
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
    competencia_fechamentos: [],
    ...extra
  };
}


const semNbsp = t => String(t).replace(/\u00a0/g, ' ');

test('prévia sem gravar; fechar grava a versão 1 com a foto; o mês fechado usa a classificação congelada', async () => {
  const ctx = await montar(cenario());
  try {
    const previa = await ctx.chamar('GET', '/fechar/previa?competencia=2026-08');
    assert.equal(previa.status, 200, JSON.stringify(previa.corpo));
    assert.deepEqual([previa.corpo.versao, previa.corpo.lancamentos, previa.corpo.sem_classificacao, previa.corpo.comparacao], [1, 5, 1, null]);
    const r = previa.corpo.resultado;
    assert.deepEqual([r.receitas, r.despesas, r.resultado, r.sem_classificacao], [3700, -3412.9, 287.1, 1850]);
    assert.deepEqual(previa.corpo.extrato.map(x => [x.conta, x.lancamentos, x.resultado, x.completo]), [['BB — conta corrente', 5, 2137.1, true]]);
    assert.equal(ctx.tabelas.competencia_fechamentos.length, 0, 'a prévia não grava');

    const f = await ctx.chamar('POST', '/fechar', { competencia: '2026-08' });
    assert.equal(f.status, 200, JSON.stringify(f.corpo));
    assert.deepEqual([f.corpo.versao, f.corpo.resultado, f.corpo.lancamentos, f.corpo.aviso], [1, 287.1, 5, null]);
    const v = ctx.tabelas.competencia_fechamentos[0];
    const lancamentos = JSON.parse(v.lancamentos);
    assert.deepEqual(lancamentos.map(l => [l.id, l.conta]), [[1, 'Serviços de Terceiros'], [2, 'Receita de vendas'], [4, null], [5, 'Comissões sobre vendas'], [3, 'Despesas bancárias']]);
    assert.equal(v.hash.length, 64);
    assert.equal(JSON.parse(ctx.tabelas.competencia_contabil[0].totais).resultado.resultado, 287.1);
    assert.match(ctx.tabelas.contabil_eventos.at(-1).descricao.replace(/\u00a0/g, ' '), /fechada \(versão 1\).*resultado do mês R\$ 287,10/);

    const cls = await ctx.chamar('GET', '/classificacao?competencia=2026-08');
    assert.deepEqual([cls.corpo.fechada, cls.corpo.versao], [true, 1]);
    assert.deepEqual(cls.corpo.linhas.map(l => l.classificacao.criterio), ['fechamento', 'fechamento', 'sem', 'fechamento', 'fechamento']);
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.deepEqual([painel.corpo.situacao.status, painel.corpo.situacao.versao, painel.corpo.situacao.diferencas], ['fechada', 1, 0]);
  } finally {
    await ctx.encerrar();
  }
});

test('regra nova depois do fechamento: o mês não muda; vira diferença (aviso) com a lista no histórico', async () => {
  const ctx = await montar(cenario());
  try {
    await ctx.chamar('POST', '/fechar', { competencia: '2026-08' });
    const regra = await ctx.chamar('POST', '/regras', { condicao_tipo: 'descricao', valor: 'CLIENTE DA LOJA', sentido: 'credito', conta_id: 1 });
    assert.equal(regra.status, 200, 'regra é do app inteiro: grava mesmo com o mês fechado');
    const cls = await ctx.chamar('GET', '/classificacao?competencia=2026-08');
    const pix = cls.corpo.linhas.find(l => l.id === 4);
    assert.deepEqual([pix.classificacao.conta, pix.atual.conta], [null, 'Receita de vendas'], 'vale a congelada; a de hoje vai junto');
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.equal(painel.corpo.situacao.diferencas, 1);
    const aviso = painel.corpo.pendencias.find(p => p.chave === 'fechamento_diferencas');
    assert.deepEqual([aviso.nivel, aviso.titulo], ['aviso', '1 diferença desde o fechamento (versão 1)']);
    const hist = await ctx.chamar('GET', '/fechamentos?competencia=2026-08');
    assert.equal(hist.status, 200, JSON.stringify(hist.corpo));
    assert.deepEqual([hist.corpo.status, hist.corpo.versoes.length, hist.corpo.versoes[0].versao, hist.corpo.diferencas.length], ['fechada', 1, 1, 1]);
    assert.equal(semNbsp(hist.corpo.diferencas[0].descricao), 'no fechamento: sem classificação; hoje: Receita de vendas');
  } finally {
    await ctx.encerrar();
  }
});

test('reabrir marca a versão; fechar de novo cria a 2; a prévia e o histórico comparam as duas', async () => {
  const ctx = await montar(cenario());
  try {
    await ctx.chamar('POST', '/fechar', { competencia: '2026-08' });
    await ctx.chamar('POST', '/regras', { condicao_tipo: 'descricao', valor: 'CLIENTE DA LOJA', sentido: 'credito', conta_id: 1 });
    const reab = await ctx.chamar('POST', '/reabrir', { competencia: '2026-08', justificativa: 'Classificar o Pix de balcão' });
    assert.deepEqual([reab.status, reab.corpo.versao], [200, 1]);
    const v1 = ctx.tabelas.competencia_fechamentos[0];
    assert.deepEqual([Boolean(v1.reaberta_em), v1.justificativa_reabertura], [true, 'Classificar o Pix de balcão']);
    const cls = await ctx.chamar('GET', '/classificacao?competencia=2026-08');
    assert.equal(cls.corpo.linhas.find(l => l.id === 4).classificacao.criterio, 'regra', 'reaberta: vale a de hoje');
    const previa = await ctx.chamar('GET', '/fechar/previa?competencia=2026-08');
    assert.deepEqual([previa.corpo.versao, previa.corpo.comparacao.reclassificados, previa.corpo.comparacao.resultado], [2, 1, { antes: 287.1, depois: 2137.1 }]);
    const f2 = await ctx.chamar('POST', '/fechar', { competencia: '2026-08' });
    assert.deepEqual([f2.status, f2.corpo.versao], [200, 2]);
    const hist = await ctx.chamar('GET', '/fechamentos?competencia=2026-08');
    assert.deepEqual(hist.corpo.versoes.map(v => [v.versao, Boolean(v.reaberta_em)]), [[2, false], [1, true]]);
    assert.deepEqual(hist.corpo.comparacoes.map(x => [x.de, x.para, x.reclassificados, x.contas.length]), [[1, 2, 1, 2]]);
    assert.equal(hist.corpo.diferencas.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('sem o SQL da etapa 7: fechar continua (com aviso); a prévia não numera a versão; o histórico responde 409', async () => {
  const dados = cenario();
  delete dados.competencia_fechamentos;
  const ctx = await montar(dados);
  try {
    const previa = await ctx.chamar('GET', '/fechar/previa?competencia=2026-08');
    assert.deepEqual([previa.status, previa.corpo.versao, previa.corpo.sql_versoes], [200, null, false]);
    const f = await ctx.chamar('POST', '/fechar', { competencia: '2026-08' });
    assert.equal(f.status, 200, JSON.stringify(f.corpo));
    assert.match(f.corpo.aviso, /sql\/contabilidade_fechamento\.sql/);
    assert.equal(ctx.tabelas.competencia_contabil[0].status, 'fechada');
    const hist = await ctx.chamar('GET', '/fechamentos?competencia=2026-08');
    assert.equal(hist.status, 409);
    assert.match(hist.corpo.error, /contabilidade_fechamento\.sql/);
    assert.equal((await ctx.chamar('GET', '/classificacao?competencia=2026-08')).status, 200, 'sem versão, a classificação é a de hoje');
  } finally {
    await ctx.encerrar();
  }
});

test('permissões: a prévia e o histórico pedem só "ver"', async () => {
  const ctx = await montar(cenario(), { permitir: ['contabilidade.view'] });
  try {
    assert.equal((await ctx.chamar('GET', '/fechar/previa?competencia=2026-08')).status, 200);
    assert.equal((await ctx.chamar('GET', '/fechamentos?competencia=2026-08')).status, 200);
    assert.deepEqual((await ctx.chamar('POST', '/fechar', { competencia: '2026-08' })).corpo.pedidas, ['contabilidade.fechar']);
  } finally {
    await ctx.encerrar();
  }
});
