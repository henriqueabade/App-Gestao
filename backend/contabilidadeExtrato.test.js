/**
 * Contabilidade — etapa 4 (extrato bancário por OFX): as rotas de
 * /api/contabilidade com a API genérica e a guarda de permissão de mentira.
 *
 * O que fica preso (28/09/2026):
 *   - a conta dos boletos (configuração de cobrança) vira sugestão de conta;
 *     a mesma conta não se cadastra duas vezes;
 *   - a prévia lê o OFX sem gravar e diz se o arquivo é da conta escolhida;
 *   - importar grava os lançamentos e guarda o OFX como evidência oficial
 *     dos meses dele; o mesmo arquivo de novo só conta "já importados";
 *   - o painel do mês: saldo do banco, cobertura e a fonte "Extrato" do
 *     checklist (completa = ok; desfeita = pendência documental);
 *   - desfazer: pede motivo, vai da mais nova para a mais antiga no mesmo
 *     período, tira os lançamentos e o OFX das evidências;
 *   - competência fechada recusa importar e desfazer nela;
 *   - cada rota pede a sua permissão; sem o SQL, 409 dizendo qual arquivo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  pedidos: ['id'], notas_fiscais: ['id'], notas_devolucao: ['id'], configuracao_fiscal: ['id', 'cnpj'],
  financeiro_fechamentos: ['id', 'tipo', 'competencia', 'status', 'total', 'quantidade', 'pagar_ate', 'fechado_em'],
  financeiro_fechamento_itens: ['id', 'fechamento_id'], financeiro_pagamentos: ['id', 'fechamento_id', 'competencia'],
  configuracao_cobranca: ['id', 'agencia', 'agencia_dv', 'conta', 'conta_dv'],
  usuarios: ['id', 'nome'],
  competencia_contabil: ['id', 'competencia', 'status', 'fechada_em', 'fechada_por'],
  contabil_pendencias_resolucoes: ['id', 'competencia', 'chave', 'nivel', 'titulo', 'justificativa', 'usuario_id', 'criado_em'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em', 'referencia_tipo', 'referencia_id'],
  contabil_arquivos: ['id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes', 'sha256', 'partes', 'completo', 'categoria', 'origem', 'competencia', 'descricao', 'criado_por', 'criado_em', 'excluido_em', 'excluido_por', 'motivo_exclusao'],
  contabil_arquivo_partes: ['id', 'arquivo_id', 'ordem', 'dados'],
  contabil_arquivo_vinculos: ['id', 'arquivo_id', 'alvo_tipo', 'alvo_id', 'criado_por', 'criado_em'],
  contas_financeiras: ['id', 'nome', 'tipo', 'banco_codigo', 'agencia', 'agencia_dv', 'conta', 'saldo_inicial', 'saldo_inicial_data', 'ativa', 'observacao', 'criado_por', 'criado_em', 'atualizado_em'],
  extrato_importacoes: ['id', 'conta_id', 'origem', 'status', 'periodo_inicio', 'periodo_fim', 'saldo_final', 'saldo_final_data', 'arquivo_id', 'nome_arquivo', 'linhas_lidas', 'novos', 'repetidos',
    'observacao', 'criado_por', 'criado_em', 'desfeita_em', 'desfeita_por', 'motivo_desfazer'],
  movimentos_bancarios: ['id', 'conta_id', 'importacao_id', 'data', 'competencia', 'valor', 'tipo', 'descricao', 'documento', 'identificador', 'tipo_banco', 'contrapartida_documento',
    'contrapartida_tipo', 'codigo_historico', 'codigo_sub_historico', 'sistema_pagamento', 'hash', 'estado_conciliacao', 'criado_em']
};

/** Os índices únicos do SQL (a API remota responde "duplicate key"). */
const UNICOS = {
  contas_financeiras: (novo, linhas) => linhas.some(r => r.banco_codigo === novo.banco_codigo && r.agencia === novo.agencia && r.conta === novo.conta),
  movimentos_bancarios: (novo, linhas) => linhas.some(r => String(r.conta_id) === String(novo.conta_id) && r.hash === novo.hash),
  contabil_arquivo_vinculos: (novo, linhas) => linhas.some(r => String(r.arquivo_id) === String(novo.arquivo_id) && r.alvo_tipo === novo.alvo_tipo && String(r.alvo_id) === String(novo.alvo_id))
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
  './contabilidade/checklist', './contabilidade/fechamento', './contabilidade/base', './contabilidade/eventos', './contabilidade/arquivos',
  './contabilidade/extrato/extrato', './contabilidade/extrato/ofx'
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

/** Um OFX 1.x do jeito do Gerenciador Financeiro do BB, em Windows-1252. */
function ofxDoBB({ agencia = '1234-5', conta = '12345-6', inicio, fim, saldo = null, linhas }) {
  const d = iso => iso.replace(/-/g, '');
  const corpo = [
    'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
    '<OFX>', '<BANKMSGSRSV1>', '<STMTTRNRS>', '<STMTRS>', '<CURDEF>BRL',
    '<BANKACCTFROM>', '<BANKID>1', `<BRANCHID>${agencia}`, `<ACCTID>${conta}`, '<ACCTTYPE>CHECKING', '</BANKACCTFROM>',
    '<BANKTRANLIST>', `<DTSTART>${d(inicio)}`, `<DTEND>${d(fim)}`,
    ...linhas.flatMap(l => ['<STMTTRN>', `<TRNTYPE>${l.valor < 0 ? 'DEBIT' : 'CREDIT'}`, `<DTPOSTED>${d(l.data)}120000[-3:BRT]`, `<TRNAMT>${l.valor.toFixed(2)}`,
      ...(l.fitid ? [`<FITID>${l.fitid}`] : []), ...(l.doc ? [`<CHECKNUM>${l.doc}`] : []), `<MEMO>${l.memo}`, '</STMTTRN>']),
    '</BANKTRANLIST>',
    ...(saldo ? ['<LEDGERBAL>', `<BALAMT>${saldo.valor.toFixed(2)}`, `<DTASOF>${d(saldo.data)}`, '</LEDGERBAL>'] : []),
    '</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>', '</OFX>', ''
  ].join('\r\n');
  return Buffer.from(corpo, 'latin1').toString('base64');
}

const AGOSTO = () => ofxDoBB({
  inicio: '2026-08-01', fim: '2026-08-31', saldo: { valor: 10987.1, data: '2026-08-31' },
  linhas: [
    { data: '2026-08-05', valor: -2500, fitid: '1', doc: '123', memo: 'Pagamento de boleto - Imobiliária' },
    { data: '2026-08-10', valor: 1500, fitid: '2', memo: 'Pix recebido - Casa Vicenzo' },
    { data: '2026-08-31', valor: -12.9, memo: 'Tarifa pacote de serviços' },
    { data: '2026-08-31', valor: -12.9, memo: 'Tarifa pacote de serviços' }
  ]
});

function cenario(extra = {}) {
  return {
    pedidos: [], notas_fiscais: [], notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: '11444777000161' }],
    financeiro_fechamentos: [], financeiro_fechamento_itens: [], financeiro_pagamentos: [],
    configuracao_cobranca: [{ id: 1, agencia: '1234', agencia_dv: '5', conta: '12345-6' }],
    usuarios: [{ id: 3, nome: 'Henrique' }],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [],
    contabil_arquivos: [], contabil_arquivo_partes: [], contabil_arquivo_vinculos: [],
    contas_financeiras: [], extrato_importacoes: [], movimentos_bancarios: [],
    ...extra
  };
}

const CONTA_BB = { id: 1, nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1234', agencia_dv: '5', conta: '123456', ativa: true };

test('contas: a conta dos boletos vira sugestão; cadastrar; a mesma conta de novo é recusada; depois a sugestão some', async () => {
  const ctx = await montar(cenario());
  try {
    const lista = await ctx.chamar('GET', '/contas-financeiras');
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.corpo.contas, []);
    assert.deepEqual(lista.corpo.sugestao_cobranca, { nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1234', agencia_dv: '5', conta: '123456' });
    const criada = await ctx.chamar('POST', '/contas-financeiras', lista.corpo.sugestao_cobranca);
    assert.equal(criada.status, 200, JSON.stringify(criada.corpo));
    assert.deepEqual(ctx.tabelas.contabil_eventos.map(e => e.tipo), ['conta_financeira_criada']);
    const deNovo = await ctx.chamar('POST', '/contas-financeiras', { ...lista.corpo.sugestao_cobranca, nome: 'Outra' });
    assert.equal(deNovo.status, 409);
    assert.match(deNovo.corpo.error, /Já existe uma conta/);
    const semBanco = await ctx.chamar('POST', '/contas-financeiras', { nome: 'Sem banco', tipo: 'corrente' });
    assert.equal(semBanco.status, 400);
    const depois = await ctx.chamar('GET', '/contas-financeiras');
    assert.equal(depois.corpo.sugestao_cobranca, null);
    assert.deepEqual(depois.corpo.contas.map(x => [x.nome, x.rotulo, x.ativa]), [['BB — conta corrente', 'Banco do Brasil · ag. 1234-5 · c/c 123456', true]]);
    const alterada = await ctx.chamar('PUT', `/contas-financeiras/${criada.corpo.id}`, { ...lista.corpo.sugestao_cobranca, ativa: false });
    assert.equal(alterada.status, 200);
    assert.equal(ctx.tabelas.contas_financeiras[0].ativa, false);
  } finally {
    await ctx.encerrar();
  }
});

test('importar: prévia sem gravar; lançamentos + OFX oficial ligado ao mês; o mesmo arquivo de novo só conta "já importados"; o painel do mês', async () => {
  const ctx = await montar(cenario({ contas_financeiras: [CONTA_BB] }));
  try {
    const previa = await ctx.chamar('POST', '/extrato/previa', { conta_id: 1, base64: AGOSTO() });
    assert.equal(previa.status, 200, JSON.stringify(previa.corpo));
    assert.deepEqual([previa.corpo.confere, previa.corpo.lidos, previa.corpo.novos, previa.corpo.repetidos, previa.corpo.creditos, previa.corpo.debitos], [true, 4, 4, 0, 1500, -2525.8]);
    assert.deepEqual(previa.corpo.periodo, { inicio: '2026-08-01', fim: '2026-08-31' });
    assert.deepEqual(previa.corpo.bloqueios, []);
    assert.equal(ctx.tabelas.movimentos_bancarios.length, 0, 'a prévia não grava');

    const r = await ctx.chamar('POST', '/extrato/importar', { conta_id: 1, nome: 'extrato-agosto.ofx', base64: AGOSTO() });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual([r.corpo.novos, r.corpo.repetidos], [4, 0]);
    assert.deepEqual(ctx.tabelas.movimentos_bancarios.map(m => [m.data, m.valor, m.tipo, m.competencia, m.documento]), [
      ['2026-08-05', -2500, 'debito', '2026-08', '123'], ['2026-08-10', 1500, 'credito', '2026-08', null],
      ['2026-08-31', -12.9, 'debito', '2026-08', null], ['2026-08-31', -12.9, 'debito', '2026-08', null]
    ]);
    const imp = ctx.tabelas.extrato_importacoes[0];
    assert.deepEqual([imp.status, imp.origem, imp.periodo_inicio, imp.periodo_fim, imp.saldo_final, imp.linhas_lidas, imp.novos], ['completa', 'ofx', '2026-08-01', '2026-08-31', 10987.1, 4, 4]);
    const arquivo = ctx.tabelas.contabil_arquivos[0];
    assert.deepEqual([arquivo.categoria, arquivo.origem, arquivo.competencia, imp.arquivo_id], ['extrato', 'oficial', '2026-08', arquivo.id]);
    assert.deepEqual(ctx.tabelas.contabil_arquivo_vinculos.map(v => [v.alvo_tipo, v.alvo_id]), [['competencia', '2026-08']]);
    assert.deepEqual(ctx.tabelas.contabil_eventos.map(e => e.tipo), ['extrato_importado']);

    const deNovo = await ctx.chamar('POST', '/extrato/importar', { conta_id: 1, nome: 'extrato-agosto.ofx', base64: AGOSTO() });
    assert.deepEqual([deNovo.corpo.novos, deNovo.corpo.repetidos], [0, 4]);
    assert.equal(ctx.tabelas.movimentos_bancarios.length, 4);
    assert.equal(ctx.tabelas.contabil_arquivos.length, 1, 'o mesmo OFX não é guardado duas vezes');

    const mes = await ctx.chamar('GET', '/extrato?conta_id=1&competencia=2026-08');
    assert.equal(mes.status, 200);
    assert.deepEqual(mes.corpo.totais, { quantidade: 4, entradas: { quantidade: 1, total: 1500 }, saidas: { quantidade: 3, total: -2525.8 }, resultado: -1025.8 });
    assert.deepEqual(mes.corpo.saldo_banco, { valor: 10987.1, data: '2026-08-31' });
    assert.equal(mes.corpo.cobertura.completa, true);
    assert.deepEqual(mes.corpo.importacoes.map(i => [i.novos, i.repetidos, i.criado_por]), [[0, 4, 'Henrique'], [4, 0, 'Henrique']]);

    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.equal(painel.status, 200);
    const fonte = painel.corpo.fontes.find(f => f.chave === 'extrato');
    assert.deepEqual([fonte.estado, fonte.pendencias], ['ok', 0]);
    assert.ok(!painel.corpo.pendencias.some(p => p.fonte === 'extrato'));
  } finally {
    await ctx.encerrar();
  }
});

test('desfazer: pede motivo; a mais nova primeiro; tira os lançamentos e o OFX das evidências; o mês volta a cobrar o extrato', async () => {
  const ctx = await montar(cenario({ contas_financeiras: [CONTA_BB] }));
  try {
    const meio = ofxDoBB({ inicio: '2026-08-01', fim: '2026-08-15', linhas: [{ data: '2026-08-05', valor: -2500, fitid: '1', doc: '123', memo: 'Pagamento de boleto - Imobiliária' }] });
    const primeira = await ctx.chamar('POST', '/extrato/importar', { conta_id: 1, nome: 'ate-15.ofx', base64: meio });
    const segunda = await ctx.chamar('POST', '/extrato/importar', { conta_id: 1, nome: 'agosto.ofx', base64: AGOSTO() });
    assert.deepEqual([primeira.corpo.novos, segunda.corpo.novos, segunda.corpo.repetidos], [1, 3, 1]);

    const semMotivo = await ctx.chamar('POST', `/extrato/importacoes/${primeira.corpo.importacao_id}/desfazer`, { motivo: '' });
    assert.equal(semMotivo.status, 400);
    const foraDeOrdem = await ctx.chamar('POST', `/extrato/importacoes/${primeira.corpo.importacao_id}/desfazer`, { motivo: 'Arquivo errado' });
    assert.equal(foraDeOrdem.status, 409);
    assert.match(foraDeOrdem.corpo.error, /importação mais nova no mesmo período \(01\/08\/2026 a 31\/08\/2026\)/);

    const d2 = await ctx.chamar('POST', `/extrato/importacoes/${segunda.corpo.importacao_id}/desfazer`, { motivo: 'Arquivo errado' });
    assert.equal(d2.status, 200, JSON.stringify(d2.corpo));
    assert.deepEqual([d2.corpo.retirados, d2.corpo.arquivo_retirado], [3, true]);
    const d1 = await ctx.chamar('POST', `/extrato/importacoes/${primeira.corpo.importacao_id}/desfazer`, { motivo: 'Arquivo errado' });
    assert.deepEqual([d1.status, d1.corpo.retirados], [200, 1]);
    assert.equal(ctx.tabelas.movimentos_bancarios.length, 0);
    assert.ok(ctx.tabelas.contabil_arquivos.every(a => a.excluido_em && /Importação do extrato desfeita: Arquivo errado/.test(a.motivo_exclusao)));
    const deNovo = await ctx.chamar('POST', `/extrato/importacoes/${primeira.corpo.importacao_id}/desfazer`, { motivo: 'Arquivo errado' });
    assert.equal(deNovo.status, 409);
    assert.deepEqual(ctx.tabelas.contabil_eventos.map(e => e.tipo), ['extrato_importado', 'extrato_importado', 'extrato_desfeito', 'extrato_desfeito']);

    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    const pend = painel.corpo.pendencias.find(p => p.chave === 'extrato_1');
    assert.deepEqual([pend.nivel, pend.titulo, pend.filtro], ['documental', 'Extrato de agosto/2026 — BB — conta corrente não importado', { acao: 'importar-extrato', conta_id: 1 }]);

    // Reimportar depois de desfazer: os lançamentos voltam e o OFX volta a ser evidência.
    const volta = await ctx.chamar('POST', '/extrato/importar', { conta_id: 1, nome: 'agosto.ofx', base64: AGOSTO() });
    assert.deepEqual([volta.corpo.novos, volta.corpo.repetidos], [4, 0]);
    assert.equal(ctx.tabelas.contabil_arquivos.filter(a => !a.excluido_em).length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('conferências: arquivo de outra conta avisa; mês fechado recusa importar e desfazer; conta desativada não importa', async () => {
  const ctx = await montar(cenario({
    contas_financeiras: [CONTA_BB, { ...CONTA_BB, id: 2, nome: 'Conta velha', conta: '777', ativa: false }],
    competencia_contabil: [{ id: 1, competencia: '2026-08', status: 'fechada' }]
  }));
  try {
    const outra = await ctx.chamar('POST', '/extrato/previa', { conta_id: 1, base64: ofxDoBB({ agencia: '1234', conta: '99999-9', inicio: '2026-09-01', fim: '2026-09-10', linhas: [{ data: '2026-09-02', valor: 10, memo: 'x' }] }) });
    assert.equal(outra.status, 200);
    assert.equal(outra.corpo.confere, false);
    assert.match(outra.corpo.avisos[0], /não parece ser BB — conta corrente/);

    const fechado = await ctx.chamar('POST', '/extrato/importar', { conta_id: 1, base64: AGOSTO() });
    assert.equal(fechado.status, 422);
    assert.match(fechado.corpo.error, /agosto\/2026, que está fechada na Contabilidade/);
    assert.equal(ctx.tabelas.movimentos_bancarios.length, 0);

    const desativada = await ctx.chamar('POST', '/extrato/previa', { conta_id: 2, base64: AGOSTO() });
    assert.ok(desativada.corpo.bloqueios.includes('Esta conta está desativada.'));

    const naoOfx = await ctx.chamar('POST', '/extrato/previa', { conta_id: 1, base64: Buffer.from('%PDF-1.4').toString('base64') });
    assert.equal(naoOfx.status, 400);
    assert.match(naoOfx.corpo.error, /não é um extrato OFX/);

    // Importação já gravada num mês que depois fechou: desfazer é recusado.
    ctx.tabelas.extrato_importacoes.push({ id: 50, conta_id: 1, origem: 'ofx', status: 'completa', periodo_inicio: '2026-08-01', periodo_fim: '2026-08-31' });
    ctx.tabelas.movimentos_bancarios.push({ id: 60, conta_id: 1, importacao_id: 50, data: '2026-08-05', competencia: '2026-08', valor: -1, hash: 'h', estado_conciliacao: 'pendente' });
    const desfazer = await ctx.chamar('POST', '/extrato/importacoes/50/desfazer', { motivo: 'Arquivo errado' });
    assert.equal(desfazer.status, 409);
    assert.match(desfazer.corpo.error, /fechada/);
    assert.equal(ctx.tabelas.movimentos_bancarios.length, 1);

    // Conciliado (etapa 5) também segura o desfazer.
    ctx.tabelas.competencia_contabil = [];
    ctx.tabelas.movimentos_bancarios[0].estado_conciliacao = 'conciliado';
    const conciliado = await ctx.chamar('POST', '/extrato/importacoes/50/desfazer', { motivo: 'Arquivo errado' });
    assert.equal(conciliado.status, 409);
    assert.match(conciliado.corpo.error, /já está conciliado/);
  } finally {
    await ctx.encerrar();
  }
});

test('permissões: ver o extrato pede só "ver"; importar/desfazer e cadastrar conta pedem as suas', async () => {
  const ctx = await montar(cenario({ contas_financeiras: [CONTA_BB] }), { permitir: ['contabilidade.view'] });
  try {
    assert.equal((await ctx.chamar('GET', '/contas-financeiras')).status, 200);
    assert.equal((await ctx.chamar('GET', '/extrato?competencia=2026-08')).status, 200);
    const pedidas = async (metodo, caminho, corpo) => (await ctx.chamar(metodo, caminho, corpo)).corpo.pedidas;
    assert.deepEqual(await pedidas('POST', '/contas-financeiras', {}), ['contabilidade.contas.gerir']);
    assert.deepEqual(await pedidas('PUT', '/contas-financeiras/1', {}), ['contabilidade.contas.gerir']);
    assert.deepEqual(await pedidas('POST', '/extrato/previa', {}), ['contabilidade.extrato.importar']);
    assert.deepEqual(await pedidas('POST', '/extrato/importar', {}), ['contabilidade.extrato.importar']);
    assert.deepEqual(await pedidas('POST', '/extrato/importacoes/1/desfazer', {}), ['contabilidade.extrato.importar']);
  } finally {
    await ctx.encerrar();
  }
});

test('sem o SQL da etapa 4: as rotas respondem 409 dizendo qual arquivo rodar; o painel mostra a fonte como "falta o SQL"', async () => {
  const dados = cenario();
  for (const t of ['contas_financeiras', 'extrato_importacoes', 'movimentos_bancarios']) delete dados[t];
  const ctx = await montar(dados);
  try {
    const r = await ctx.chamar('GET', '/extrato?competencia=2026-08');
    assert.equal(r.status, 409);
    assert.equal(r.corpo.sql_pendente, true);
    assert.match(r.corpo.error, /sql\/contabilidade_extrato\.sql/);
    assert.equal((await ctx.chamar('GET', '/contas-financeiras')).status, 409);
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.equal(painel.status, 200);
    const fonte = painel.corpo.fontes.find(f => f.chave === 'extrato');
    assert.deepEqual([fonte.estado], ['indisponivel']);
    assert.match(fonte.nota, /contabilidade_extrato\.sql/);
  } finally {
    await ctx.encerrar();
  }
});
