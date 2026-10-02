/**
 * Contabilidade — etapa 8 (relatório mensal e dossiê): as rotas de
 * /api/contabilidade com a API genérica e a guarda de permissão de mentira.
 *
 * O que fica preso (29/09/2026):
 *   - mês aberto: o relatório é PRÉVIA, com os números de hoje; o livro-caixa
 *     traz o saldo inicial pelo saldo do banco, a conta do plano, de quem é o
 *     dinheiro e o vencimento do título;
 *   - mês fechado: o relatório é a foto da versão — regra nova depois do
 *     fechamento não muda o livro, vira diferença na nota;
 *   - o PDF (HTML) e a planilha pedem "Relatório e pacote"; ver na tela e o
 *     dossiê pedem só "ver";
 *   - o dossiê liga lançamento → conta a pagar → documento e o caminho de
 *     volta, com arquivos e histórico;
 *   - sem o SQL do extrato, o relatório sai com o aviso (sem quebrar).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const ExcelJS = require('exceljs');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  pedidos: ['id', 'numero', 'cliente_id'], clientes: ['id', 'nome', 'nome_fantasia', 'cnpj', 'cpf'],
  pedido_parcelas: ['id', 'pedido_id', 'numero_parcela', 'data_vencimento', 'valor'],
  notas_fiscais: ['id', 'pedido_id', 'serie', 'numero', 'status_fiscal', 'data_emissao', 'valor_total'], notas_devolucao: ['id'], configuracao_fiscal: ['id', 'cnpj'], configuracao_cobranca: ['id'],
  financeiro_fechamentos: ['id', 'tipo', 'competencia', 'status', 'total', 'quantidade', 'pagar_ate', 'fechado_em'], financeiro_fechamento_itens: ['id'],
  financeiro_pagamentos: ['id', 'fechamento_id', 'tipo', 'competencia', 'valor', 'data_pagamento', 'forma', 'beneficiario'],
  recebimentos: ['id', 'pedido_id', 'numero_parcela', 'origem', 'forma', 'data_recebimento', 'valor_recebido', 'status'],
  reembolsos: ['id'], usuarios: ['id', 'nome'], contatos: ['id', 'nome', 'cnpj', 'cpf'],
  competencia_contabil: ['id', 'competencia', 'status', 'fechada_em', 'fechada_por', 'reaberta_em', 'reaberta_por', 'justificativa_reabertura', 'totais', 'pendencias_no_fechamento', 'criado_em', 'atualizado_em'],
  contabil_pendencias_resolucoes: ['id', 'competencia', 'chave', 'nivel', 'titulo', 'justificativa', 'usuario_id', 'criado_em'],
  competencia_fechamentos: ['id', 'competencia', 'versao', 'fechada_em', 'fechada_por', 'foto', 'lancamentos', 'pendencias', 'hash', 'reaberta_em', 'reaberta_por', 'justificativa_reabertura'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em', 'referencia_tipo', 'referencia_id'],
  contabil_arquivos: ['id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes', 'sha256', 'categoria', 'origem', 'competencia', 'descricao', 'criado_em', 'criado_por', 'excluido_em', 'completo', 'partes'],
  contabil_arquivo_vinculos: ['id', 'arquivo_id', 'alvo_tipo', 'alvo_id'],
  documentos_recebidos: ['id', 'tipo', 'numero', 'serie', 'emitente_nome', 'emitente_documento', 'contato_id', 'data_emissao', 'competencia', 'valor_total', 'excluido_em', 'cfops', 'itens', 'origem'],
  titulos_pagar: ['id', 'contato_id', 'documento_recebido_id', 'descricao', 'categoria', 'numero_documento', 'data_emissao', 'competencia', 'valor_total', 'status', 'origem',
    'observacao', 'criado_por', 'criado_em', 'atualizado_em'],
  titulo_pagar_parcelas: ['id', 'titulo_id', 'numero', 'vencimento', 'valor', 'linha_digitavel'],
  titulo_pagar_pagamentos: ['id', 'parcela_id', 'titulo_id', 'data_pagamento', 'competencia', 'valor_pago', 'forma', 'estornado_em'],
  contas_financeiras: ['id', 'nome', 'tipo', 'banco_codigo', 'agencia', 'conta', 'ativa'],
  extrato_importacoes: ['id', 'conta_id', 'status', 'origem', 'periodo_inicio', 'periodo_fim', 'saldo_final', 'saldo_final_data', 'nome_arquivo', 'arquivo_id', 'criado_por', 'criado_em'],
  movimentos_bancarios: ['id', 'conta_id', 'importacao_id', 'data', 'competencia', 'valor', 'tipo', 'descricao', 'documento', 'contrapartida_documento', 'estado_conciliacao', 'conciliacao_observacao', 'conciliado_em', 'conciliado_por'],
  conciliacao_vinculos: ['id', 'movimento_id', 'alvo_tipo', 'alvo_id', 'valor', 'criterio', 'desfeito_em', 'motivo_desfazer'],
  plano_contas: ['id', 'codigo', 'nome', 'tipo', 'ativa', 'observacao', 'origem', 'criado_por', 'criado_em', 'atualizado_em'],
  classificacao_regras: ['id', 'condicao_tipo', 'valor', 'sentido', 'conta_id', 'prioridade', 'ativa', 'origem', 'observacao', 'criado_por', 'criado_em', 'atualizado_em'],
  classificacoes: ['id', 'movimento_id', 'conta_id', 'observacao', 'criado_por', 'criado_em', 'substituida_em', 'substituida_por']
};

const UNICOS = {
  competencia_fechamentos: (novo, linhas) => linhas.some(r => r.competencia === novo.competencia && Number(r.versao) === Number(novo.versao)),
  competencia_contabil: (novo, linhas) => linhas.some(r => r.competencia === novo.competencia),
  plano_contas: (novo, linhas) => linhas.some(r => String(r.nome).toLowerCase() === String(novo.nome).toLowerCase())
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
  './contabilidade/documentosRecebidos', './contabilidade/evidencias', './contabilidade/extrato/extrato', './contabilidade/extrato/ofx',
  './contabilidade/conciliacao/conciliacao', './contabilidade/conciliacao/liquidacoes', './contabilidade/conciliacao/motor',
  './contabilidade/classificacao/classificacao', './contabilidade/classificacao/regras', './contabilidade/classificacao/plano', './contabilidade/versoes',
  './contabilidade/relatorio/relatorio', './contabilidade/relatorio/documento', './contabilidade/relatorio/planilha', './contabilidade/relatorio/dossie'
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

const mov = (id, data, valor, descricao, estado = 'pendente', extra = {}) => ({
  id, conta_id: 1, importacao_id: 1, data, competencia: data.slice(0, 7), valor, tipo: valor < 0 ? 'debito' : 'credito', descricao, estado_conciliacao: estado, ...extra
});
const regra = (id, condicao_tipo, valor, sentido, conta_id) => ({ id, condicao_tipo, valor, sentido, conta_id, prioridade: 0, ativa: true, origem: 'padrao' });

function cenario(extra = {}) {
  return {
    pedidos: [{ id: 1, numero: 2540, cliente_id: 8 }], clientes: [{ id: 8, nome_fantasia: 'Casa Vicenzo' }],
    pedido_parcelas: [{ id: 51, pedido_id: 1, numero_parcela: 1, data_vencimento: '2026-08-08', valor: 3700 }],
    notas_fiscais: [{ id: 30, pedido_id: 1, serie: 2, numero: 88, status_fiscal: 'autorizada', data_emissao: '2026-07-20', valor_total: 3700 }],
    notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: '11444777000161' }], configuracao_cobranca: [],
    financeiro_fechamentos: [{ id: 1, tipo: 'comissao', competencia: '2026-07', status: 'fechado', total: 900 }], financeiro_fechamento_itens: [],
    financeiro_pagamentos: [{ id: 70, fechamento_id: 1, tipo: 'comissao', competencia: '2026-07', valor: 900, data_pagamento: '2026-08-15', forma: 'Pix', beneficiario: 'Ana' }],
    recebimentos: [{ id: 1, pedido_id: 1, numero_parcela: 1, origem: 'boleto', forma: 'Boleto', data_recebimento: '2026-08-10', valor_recebido: 3700, status: 'confirmado' }],
    reembolsos: [], usuarios: [{ id: 3, nome: 'Henrique' }],
    contatos: [{ id: 5, nome: 'Imobiliária Centro' }, { id: 6, nome: 'Vidros Norte', cnpj: '84031759000121' }],
    competencia_contabil: [], contabil_pendencias_resolucoes: [],
    contabil_eventos: [{ id: 1, tipo: 'conciliacao_feita', competencia: '2026-08', descricao: 'Lançamento de 05/08/2026 conciliado', dados: JSON.stringify({ movimento_id: 1 }), usuario_id: 3, criado_em: '2026-09-01T12:00:00Z' }],
    contabil_arquivos: [{ id: 9, nome_arquivo: 'boleto-aluguel.pdf', tipo_mime: 'application/pdf', tamanho_bytes: 1200, sha256: 'a'.repeat(64), categoria: 'boleto', origem: 'fornecido', competencia: '2026-08', criado_em: '2026-08-02T10:00:00Z', completo: true, partes: 1 }],
    contabil_arquivo_vinculos: [{ id: 1, arquivo_id: 9, alvo_tipo: 'titulo', alvo_id: '1' }],
    documentos_recebidos: [{ id: 4, tipo: 'nfse', numero: '77', emitente_nome: 'Imobiliária Centro', contato_id: 5, data_emissao: '2026-08-01', competencia: '2026-08', valor_total: 2500, origem: 'manual', itens: '[]' }],
    titulos_pagar: [{ id: 1, contato_id: 5, documento_recebido_id: 4, descricao: 'Aluguel de agosto', categoria: 'Serviços de Terceiros', competencia: '2026-08', valor_total: 2500, status: 'aberto', origem: 'nfse' }],
    titulo_pagar_parcelas: [{ id: 11, titulo_id: 1, numero: 1, vencimento: '2026-08-05', valor: 2500 }],
    titulo_pagar_pagamentos: [{ id: 101, parcela_id: 11, titulo_id: 1, data_pagamento: '2026-08-05', competencia: '2026-08', valor_pago: 2500, forma: 'Boleto' }],
    contas_financeiras: [{ id: 1, nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1234', conta: '123456', ativa: true }],
    extrato_importacoes: [{ id: 1, conta_id: 1, status: 'completa', origem: 'ofx', periodo_inicio: '2026-08-01', periodo_fim: '2026-08-31', saldo_final: 10000, saldo_final_data: '2026-08-31', nome_arquivo: 'agosto.ofx', criado_por: 3, criado_em: '2026-09-01T11:00:00Z' }],
    movimentos_bancarios: [
      mov(1, '2026-08-05', -2500, 'Pagamento de boleto - Imobiliária Centro', 'conciliado', { documento: '000123' }),
      mov(2, '2026-08-11', 3700, 'LIQUIDAÇÃO DE COBRANÇA', 'conciliado'),
      mov(3, '2026-08-31', -12.9, 'Tarifa pacote de serviços'),
      mov(4, '2026-08-12', 1850, 'PIX RECEBIDO - CLIENTE <b>DA</b> LOJA', 'pendente', { contrapartida_documento: '12345678909' }),
      mov(5, '2026-08-15', -900, 'PIX ENVIADO - ANA', 'conciliado')
    ],
    conciliacao_vinculos: [
      { id: 1, movimento_id: 1, alvo_tipo: 'titulo_pagamento', alvo_id: 101, valor: 2500, criterio: 'sugestao' },
      { id: 2, movimento_id: 2, alvo_tipo: 'recebimento', alvo_id: 1, valor: 3700, criterio: 'sugestao' },
      { id: 3, movimento_id: 5, alvo_tipo: 'financeiro_pagamento', alvo_id: 70, valor: 900, criterio: 'manual' }
    ],
    plano_contas: [
      { id: 1, nome: 'Receita de vendas', tipo: 'receita', ativa: true, origem: 'padrao' }, { id: 2, nome: 'Serviços de Terceiros', tipo: 'despesa', ativa: true, origem: 'padrao' },
      { id: 3, nome: 'Despesas bancárias', tipo: 'despesa', ativa: true, origem: 'padrao' }, { id: 4, nome: 'Comissões sobre vendas', tipo: 'despesa', ativa: true, origem: 'padrao' }
    ],
    classificacao_regras: [regra(1, 'origem', 'recebimento', 'credito', 1), regra(2, 'origem', 'comissao', 'debito', 4), regra(3, 'descricao', 'TARIFA', 'debito', 3)],
    classificacoes: [],
    competencia_fechamentos: [],
    ...extra
  };
}

/**
 * 02/10/2026 (C3, C5, C7 críticos): para fechar, o aluguel pago tem o comprovante,
 * a tarifa e o Pix de balcão ficaram sem par (ignorados) e o Pix tem regra.
 */
const fechavel = dados => ({
  ...dados,
  contabil_arquivos: [...dados.contabil_arquivos, { id: 10, nome_arquivo: 'comprovante-aluguel.pdf', tipo_mime: 'application/pdf', tamanho_bytes: 900, sha256: 'c'.repeat(64), categoria: 'comprovante', origem: 'oficial', competencia: '2026-08', criado_em: '2026-08-05T10:00:00Z', completo: true, partes: 1 }],
  contabil_arquivo_vinculos: [...dados.contabil_arquivo_vinculos, { id: 2, arquivo_id: 10, alvo_tipo: 'pagamento', alvo_id: '101' }],
  movimentos_bancarios: dados.movimentos_bancarios.map(m => ([3, 4].includes(m.id) ? { ...m, estado_conciliacao: 'ignorado' } : m)),
  plano_contas: [...dados.plano_contas, { id: 5, nome: 'Aporte de Capital', tipo: 'patrimonio', ativa: true, origem: 'padrao' }],
  classificacao_regras: [...dados.classificacao_regras, regra(4, 'descricao', 'PIX RECEBIDO', 'credito', 1)]
});

const semNbsp = t => String(t).replace(/ /g, ' ');

test('mês aberto: prévia com o livro-caixa (saldo pelo banco, conta do plano, de quem é o dinheiro, vencimento), resultado e conciliação', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('GET', '/relatorio?competencia=2026-08');
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const rel = r.corpo;
    assert.deepEqual([rel.situacao.previa, rel.situacao.versao, rel.arquivo], [true, null, 'contabilidade-2026-08-relatorio-previa']);
    assert.match(rel.situacao.nota, /^PRÉVIA — a competência está aberta/);
    assert.equal(rel.livro.length, 1);
    const livro = rel.livro[0];
    assert.deepEqual([livro.saldo_inicial, livro.saldo_final], [7862.9, 10000], 'saldo do banco em 31/08 menos o resultado do mês');
    assert.deepEqual(livro.linhas.map(l => [l.id, l.conta_plano]), [[1, 'Serviços de Terceiros'], [2, 'Receita de vendas'], [4, null], [5, 'Comissões sobre vendas'], [3, 'Despesas bancárias']]);
    const l = id => livro.linhas.find(x => x.id === id);
    assert.deepEqual([l(1).observacao, l(1).vencimento, l(1).numero], ['Imobiliária Centro — Aluguel de agosto', '2026-08-05', '000123']);
    assert.deepEqual([l(2).observacao, l(2).vencimento], ['Casa Vicenzo — Pedido 2540 · parcela 1', '2026-08-08']);
    assert.equal(l(4).observacao, 'A conciliar · CNPJ/CPF 123.456.789-09');
    assert.equal(l(5).observacao, 'Ana — Comissões de julho/2026 — Ana');
    assert.deepEqual([rel.resultado.receitas, rel.resultado.despesas, rel.resultado.resultado, rel.resultado.sem_classificacao], [3700, -3412.9, 287.1, 1850]);
    assert.equal(rel.resultado.por_conta.find(g => g.conta === 'Receita de vendas').tipo_rotulo, 'Receita');
    assert.equal(rel.partidas.length, 10);
    const conc = rel.conciliacao[0];
    assert.deepEqual([conc.totais.conciliados, conc.a_conciliar.map(x => x.id)], [3, [4, 3]]);
    assert.equal(rel.pendencias.origem, 'hoje');
    assert.ok(rel.documentos.itens.some(i => i.titulo === 'NFS-e 77'));
    assert.equal(rel.empresa.cnpj, '11.444.777/0001-61');
  } finally {
    await ctx.encerrar();
  }
});

test('mês fechado: o relatório é a foto da versão; regra mudada depois não muda o livro e vira diferença na nota', async () => {
  const ctx = await montar(fechavel(cenario()));
  try {
    const f = await ctx.chamar('POST', '/fechar', { competencia: '2026-08' });
    assert.equal(f.status, 200, JSON.stringify(f.corpo));
    const nova = await ctx.chamar('PUT', '/regras/4', { condicao_tipo: 'descricao', valor: 'PIX RECEBIDO', sentido: 'credito', conta_id: 5 });
    assert.equal(nova.status, 200, JSON.stringify(nova.corpo));
    const r = await ctx.chamar('GET', '/relatorio?competencia=2026-08');
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const rel = r.corpo;
    assert.deepEqual([rel.situacao.previa, rel.situacao.versao, rel.situacao.diferencas, rel.arquivo], [false, 1, 1, 'contabilidade-2026-08-relatorio-v1']);
    assert.match(rel.situacao.nota, /versão 1\. Os números são os da foto do fechamento\. Há 1 diferença desde o fechamento/);
    assert.equal(rel.livro[0].linhas.find(x => x.id === 4).conta_plano, 'Receita de vendas', 'vale a conta congelada');
    assert.equal(rel.resultado.resultado, 2137.1);
    assert.equal(rel.pendencias.origem, 'fechamento');
  } finally {
    await ctx.encerrar();
  }
});

test('PDF e planilha: o HTML escapa o banco; a planilha abre com as abas e os lançamentos', async () => {
  const ctx = await montar(cenario());
  try {
    const d = await ctx.chamar('GET', '/relatorio/documento?competencia=2026-08');
    assert.equal(d.status, 200, JSON.stringify(d.corpo));
    assert.equal(d.corpo.nome, 'contabilidade-2026-08-relatorio-previa');
    assert.ok(d.corpo.html.includes('CLIENTE &lt;b&gt;DA&lt;/b&gt; LOJA') && !d.corpo.html.includes('<b>DA</b>'));
    assert.match(d.corpo.html, /Livro-caixa — BB — conta corrente/);
    const p = await ctx.chamar('GET', '/relatorio/planilha?competencia=2026-08');
    assert.equal(p.status, 200, JSON.stringify(p.corpo));
    assert.equal(p.corpo.nome, 'contabilidade-2026-08-relatorio-previa.xlsx');
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(Buffer.from(p.corpo.base64, 'base64'));
    assert.equal(livro.worksheets.length, 8);
    assert.equal(livro.getWorksheet('Lançamentos').rowCount, 6);
  } finally {
    await ctx.encerrar();
  }
});

test('dossiê: lançamento → conta a pagar → documento e o caminho de volta, com arquivos e histórico', async () => {
  const ctx = await montar(cenario());
  try {
    const m = await ctx.chamar('GET', '/dossie?tipo=movimento&id=1');
    assert.equal(m.status, 200, JSON.stringify(m.corpo));
    const s = (d, chave) => d.secoes.find(x => x.chave === chave);
    assert.deepEqual(s(m.corpo, 'conciliacao').ligacoes.map(l => [l.tipo, l.id]), [['titulo', 1]]);
    assert.ok(s(m.corpo, 'banco').linhas.some(([k, v]) => k === 'Veio de' && /agosto\.ofx/.test(v) && /Henrique/.test(v)));
    assert.deepEqual(s(m.corpo, 'classificacao').linhas[0], ['Conta do plano', 'Serviços de Terceiros']);
    assert.deepEqual(m.corpo.arquivos.map(a => a.nome), ['boleto-aluguel.pdf']);
    assert.deepEqual(m.corpo.historico.map(e => e.tipo), ['conciliacao_feita']);

    const recebido = await ctx.chamar('GET', '/dossie?tipo=movimento&id=2');
    assert.ok(s(recebido.corpo, 'conciliacao').ligacoes.some(l => l.rotulo === 'NF-e 2/88 do pedido'), 'o recebimento leva à NF-e do pedido');

    const t = await ctx.chamar('GET', '/dossie?tipo=titulo&id=1');
    assert.equal(t.status, 200, JSON.stringify(t.corpo));
    assert.deepEqual(s(t.corpo, 'banco').ligacoes.map(l => [l.tipo, l.id]), [['movimento', 1]]);
    assert.deepEqual(s(t.corpo, 'documento').ligacoes.map(l => [l.tipo, l.id]), [['documento', 4]]);

    const doc = await ctx.chamar('GET', '/dossie?tipo=documento&id=4');
    assert.equal(doc.status, 200, JSON.stringify(doc.corpo));
    assert.deepEqual(s(doc.corpo, 'contas').ligacoes.map(l => [l.tipo, l.id]), [['titulo', 1]]);
    assert.deepEqual(s(doc.corpo, 'banco').ligacoes.map(l => [l.tipo, l.id]), [['movimento', 1]]);

    assert.equal((await ctx.chamar('GET', '/dossie?tipo=pedido&id=1')).status, 400);
    assert.equal((await ctx.chamar('GET', '/dossie?tipo=movimento&id=999')).status, 404);
    assert.equal((await ctx.chamar('GET', '/relatorio?competencia=')).status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('permissões: ver o relatório e o dossiê pede só "ver"; o PDF e a planilha pedem "Relatório e pacote"', async () => {
  const ctx = await montar(cenario(), { permitir: ['contabilidade.view'] });
  try {
    assert.equal((await ctx.chamar('GET', '/relatorio?competencia=2026-08')).status, 200);
    assert.equal((await ctx.chamar('GET', '/dossie?tipo=titulo&id=1')).status, 200);
    for (const rota of ['/relatorio/documento?competencia=2026-08', '/relatorio/planilha?competencia=2026-08']) {
      const r = await ctx.chamar('GET', rota);
      assert.deepEqual([r.status, r.corpo.pedidas], [403, ['contabilidade.pacote.gerar']]);
    }
  } finally {
    await ctx.encerrar();
  }
});

test('sem o SQL do extrato: o relatório sai com o aviso, sem livro e sem conciliação', async () => {
  const dados = cenario();
  for (const t of ['contas_financeiras', 'extrato_importacoes', 'movimentos_bancarios', 'conciliacao_vinculos', 'plano_contas', 'classificacao_regras', 'classificacoes', 'competencia_fechamentos']) delete dados[t];
  const ctx = await montar(dados);
  try {
    const r = await ctx.chamar('GET', '/relatorio?competencia=2026-08');
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual([r.corpo.livro.length, r.corpo.conciliacao, r.corpo.resumo.lancamentos], [0, null, 0]);
    assert.ok(r.corpo.avisos.some(a => /contabilidade_extrato\.sql/.test(a)), JSON.stringify(r.corpo.avisos));
    const d = await ctx.chamar('GET', '/relatorio/documento?competencia=2026-08');
    assert.equal(d.status, 200, JSON.stringify(d.corpo));
  } finally {
    await ctx.encerrar();
  }
});
