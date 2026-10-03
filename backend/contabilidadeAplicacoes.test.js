/**
 * Contabilidade — fase C (02/10/2026): as aplicações do BB (Rende Fácil e CDB)
 * pelos PDFs mensais, pelas rotas, com a API genérica e a guarda de
 * permissão de mentira.
 *
 * O que fica preso:
 *   - importar os dois PDFs guarda os dados, as conferências e o que o extrato
 *     tem de mostrar; o original fica guardado (até o pacote); cada linha do
 *     extrato do Rende Fácil e do CDB liga sozinha (critério "aplicacao") e o
 *     lançamento fica conciliado;
 *   - a tela do mês (tudo "Confere com o extrato"), o painel sem pendência, a
 *     conciliação com o rótulo, o PDF original, o mesmo PDF de novo (repetido),
 *     o PDF mais novo do mês substituindo o anterior (solta e liga de novo);
 *   - desfazer a conciliação e "Conferir de novo"; o extrato que chega depois
 *     do PDF liga pela conciliação automática;
 *   - o pacote salvo tira o original do servidor (ficam os dados);
 *   - o mês com o Rende Fácil no extrato e sem o PDF: pendência crítica;
 *   - permissões e "falta o SQL da fase C".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { pdfRendeFacil, pdfCdb } = require('./contabilidade/aplicacoes/pdfsDeTeste');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;
const semNbsp = t => String(t).replace(/ /g, ' ');

const COLUNAS = {
  contabil_parametros: ['id', 'chave', 'valor'],
  pedidos: ['id', 'numero', 'situacao', 'cliente_id'], notas_fiscais: ['id'], notas_devolucao: ['id'],
  configuracao_fiscal: ['id', 'cnpj', 'uf', 'razao_social'], configuracao_cobranca: ['id'],
  financeiro_fechamentos: ['id'], financeiro_fechamento_itens: ['id'], financeiro_pagamentos: ['id'], usuarios: ['id', 'nome'], contatos: ['id', 'nome', 'cnpj', 'cpf'],
  competencia_contabil: ['id', 'competencia', 'status'], contabil_pendencias_resolucoes: ['id', 'competencia', 'chave'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em', 'referencia_tipo', 'referencia_id'],
  contabil_arquivos: ['id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes', 'sha256', 'partes', 'completo', 'categoria', 'origem', 'competencia', 'descricao', 'criado_por', 'criado_em',
    'excluido_em', 'excluido_por', 'motivo_exclusao'],
  contabil_arquivo_partes: ['id', 'arquivo_id', 'ordem', 'dados'], contabil_arquivo_vinculos: ['id', 'arquivo_id', 'alvo_tipo', 'alvo_id'],
  contabil_pacotes: ['id', 'competencia', 'versao', 'hash'],
  documentos_recebidos: ['id', 'competencia'], titulos_pagar: ['id'], titulo_pagar_parcelas: ['id'], titulo_pagar_pagamentos: ['id'],
  contas_financeiras: ['id', 'nome', 'tipo', 'banco_codigo', 'agencia', 'agencia_dv', 'conta', 'ativa'],
  extrato_importacoes: ['id', 'conta_id', 'origem', 'status', 'periodo_inicio', 'periodo_fim', 'saldo_final', 'saldo_final_data'],
  movimentos_bancarios: ['id', 'conta_id', 'importacao_id', 'data', 'competencia', 'valor', 'tipo', 'descricao', 'documento', 'identificador', 'contrapartida_documento', 'hash',
    'estado_conciliacao', 'conciliacao_diferenca', 'conciliacao_observacao', 'conciliado_em', 'conciliado_por'],
  conciliacao_vinculos: ['id', 'movimento_id', 'alvo_tipo', 'alvo_id', 'valor', 'criterio', 'detalhe', 'criado_por', 'criado_em', 'desfeito_em', 'desfeito_por', 'motivo_desfazer'],
  contabil_integracoes: ['id', 'chave', 'ativa', 'parametros'], contabil_dfe_recebidos: ['id'], contabil_comprovantes: ['id', 'competencia'],
  contabil_aplicacoes: ['id', 'produto', 'competencia', 'sha256', 'nome_arquivo', 'tamanho_bytes', 'agencia', 'conta', 'periodo_inicio', 'periodo_fim', 'saldo_inicial', 'saldo_final',
    'rendimento_mes', 'ir_mes', 'iof_mes', 'resumo', 'movimentos', 'depositos', 'conferencias', 'confere', 'arquivo_id', 'original_descartado_em', 'substituida_em', 'substituida_por',
    'importado_em', 'importado_por'],
  contabil_aplicacao_lancamentos: ['id', 'aplicacao_id', 'data', 'sentido', 'parte', 'valor', 'descricao']
};

/** O tamanho das colunas de texto do SQL da fase C (o Postgres recusa o que passa). */
const LIMITES = {
  contabil_aplicacoes: { produto: 20, competencia: 7, sha256: 64, nome_arquivo: 255, agencia: 10, conta: 20 },
  contabil_aplicacao_lancamentos: { sentido: 10, parte: 12, descricao: 160 },
  conciliacao_vinculos: { alvo_tipo: 30, criterio: 20 }, contabil_eventos: { tipo: 40 }
};
const passaDoLimite = (tabela, linha) => Object.entries(LIMITES[tabela] || {}).find(([col, max]) => typeof linha[col] === 'string' && linha[col].length > max) || null;
const UNICOS = {
  contabil_aplicacoes: (n, l) => l.some(r => r.sha256 === n.sha256) || (!n.substituida_em && l.some(r => !r.substituida_em && r.produto === n.produto && r.competencia === n.competencia)),
  conciliacao_vinculos: (n, l) => l.some(r => !r.desfeito_em && String(r.movimento_id) === String(n.movimento_id) && r.alvo_tipo === n.alvo_tipo && String(r.alvo_id) === String(n.alvo_id))
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
        for (const [k, v] of url.searchParams.entries()) if (colunas.includes(k)) linhas = linhas.filter(r => String(r[k]) === String(v));
        return responder(200, linhas);
      }
      if (req.method === 'POST') {
        const linha = {};
        for (const c of colunas) if (body?.[c] !== undefined) linha[c] = body[c];
        if (passaDoLimite(tabela, linha)) return responder(500, { error: `value too long (${passaDoLimite(tabela, linha)[0]})` });
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
        const i = tabelas[tabela].findIndex(r => String(r.id) === String(id));
        if (i >= 0) tabelas[tabela].splice(i, 1);
        return responder(200, { sucesso: true });
      }
      return responder(405, { error: 'Método não suportado' });
    });
  });
  return { servidor, tabelas };
}

const MODULOS = [
  './apiHttpClient', './permissionsController', './contabilidadeController', './contabilidade/checklist', './contabilidade/base', './contabilidade/eventos',
  './contabilidade/arquivos', './contabilidade/evidencias', './contabilidade/extrato/extrato', './contabilidade/conciliacao/conciliacao', './contabilidade/conciliacao/liquidacoes',
  './contabilidade/aplicacoes/aplicacoes', './contabilidade/comprovantes/comprovantes', './contabilidade/pacote/pacote', './fiscal/configuracaoFiscal'
];

const mov = (id, data, valor, descricao, extra = {}) => ({
  id, conta_id: 1, data, competencia: data.slice(0, 7), valor, tipo: valor < 0 ? 'debito' : 'credito', descricao, hash: `h${id}`, estado_conciliacao: 'pendente', ...extra
});
const RF = 'BB RENDE FÁCIL - RENDE FACIL';
const CDB = 'RESGATE BB CDB DI';

function cenario(extra = {}) {
  return {
    contabil_parametros: [], pedidos: [], notas_fiscais: [], notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: '11444777000161', uf: 'MG', razao_social: 'SANTISSIMO DECOR LTDA' }],
    configuracao_cobranca: [], financeiro_fechamentos: [], financeiro_fechamento_itens: [], financeiro_pagamentos: [], usuarios: [{ id: 3, nome: 'Henrique' }], contatos: [],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [], contabil_arquivos: [], contabil_arquivo_partes: [], contabil_arquivo_vinculos: [],
    contabil_pacotes: [{ id: 1, competencia: '2026-09', versao: 1, hash: 'h' }],
    documentos_recebidos: [], titulos_pagar: [], titulo_pagar_parcelas: [], titulo_pagar_pagamentos: [],
    contas_financeiras: [{ id: 1, nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1614', agencia_dv: '4', conta: '167738', ativa: true }],
    extrato_importacoes: [],
    movimentos_bancarios: [
      mov(601, '2026-09-04', 499.7, RF), mov(602, '2026-09-10', -500, RF), mov(603, '2026-09-20', 300.45, RF),
      mov(611, '2026-09-15', -2000, 'APLICACAO BB CDB DI'), mov(612, '2026-09-21', 500, CDB), mov(613, '2026-09-21', 35.84, CDB),
      mov(620, '2026-09-22', -80, 'PIX ENVIADO - FULANO')
    ],
    conciliacao_vinculos: [], contabil_integracoes: [], contabil_dfe_recebidos: [], contabil_comprovantes: [],
    contabil_aplicacoes: [], contabil_aplicacao_lancamentos: [],
    ...extra
  };
}

async function montar(dados, { permitir = true } = {}) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  require('./fiscal/configuracaoFiscal').limparCache?.();
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      exigirPermissao: chaveOuFn => (req, res, next) => {
        const chaves = typeof chaveOuFn === 'function' ? chaveOuFn(req) : chaveOuFn;
        const pedidas = Array.isArray(chaves) ? chaves : [chaves];
        const liberado = Array.isArray(permitir) ? pedidas.every(c => permitir.includes(c)) : permitir;
        return liberado ? next() : res.status(403).json({ error: 'Sem permissão', pedidas });
      },
      exigirAlgumaPermissao: () => (req, res, next) => next(),
      exigirSupAdmin: (req, res, next) => next(),
      ehSupAdmin: async () => true,
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

const arquivoDe = (nome, buf) => ({ nome, base64: buf.toString('base64') });
const ativos = ctx => ctx.tabelas.conciliacao_vinculos.filter(v => !v.desfeito_em);

test('importar os PDFs do Rende Fácil e do CDB: os dados, o original guardado e cada linha do extrato conferida e conciliada; a tela, o painel, a conciliação, o PDF e o repetido', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('POST', '/aplicacoes/importar', { arquivos: [arquivoDe('SantíssimoDecor_BB_RendeFácil.pdf', pdfRendeFacil()), arquivoDe('SantíssimoDecor_BB_AplicCDB.pdf', pdfCdb())] });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(semNbsp(r.corpo.resumo), '2 PDFs lidos · 2 importados · 6 linhas do extrato conferidas com o PDF');
    assert.deepEqual(r.corpo.falhas, []);
    const [rf, cdb] = ctx.tabelas.contabil_aplicacoes;
    assert.deepEqual([rf.produto, rf.competencia, rf.confere, Number(rf.saldo_final), cdb.produto, cdb.confere, Number(cdb.saldo_final)], ['rende_facil', '2026-09', true, 701.55, 'cdb', true, 11500]);
    assert.equal(ctx.tabelas.contabil_aplicacao_lancamentos.length, 6);
    // O original guardado só até o pacote (competência nula: não entra na lista geral dos Documentos).
    const original = ctx.tabelas.contabil_arquivos.find(a => a.id === rf.arquivo_id);
    assert.deepEqual([original.categoria, original.origem, original.competencia], ['extrato', 'oficial', null]);

    // Cada linha do extrato das aplicações ligada pela conciliação (o Pix de fora fica como estava).
    assert.deepEqual(ativos(ctx).map(v => [v.movimento_id, v.alvo_tipo, Number(v.valor), v.criterio]).sort((a, b) => a[0] - b[0]), [
      [601, 'resgate', 499.7, 'aplicacao'], [602, 'aplicacao', 500, 'aplicacao'], [603, 'resgate', 300.45, 'aplicacao'],
      [611, 'aplicacao', 2000, 'aplicacao'], [612, 'resgate', 500, 'aplicacao'], [613, 'resgate', 35.84, 'aplicacao']
    ]);
    const estados = id => ctx.tabelas.movimentos_bancarios.find(m => m.id === id).estado_conciliacao;
    assert.deepEqual([601, 602, 603, 611, 612, 613, 620].map(estados), ['conciliado', 'conciliado', 'conciliado', 'conciliado', 'conciliado', 'conciliado', 'pendente']);
    assert.ok(ctx.tabelas.contabil_eventos.some(e => e.tipo === 'aplicacao_importada') && ctx.tabelas.contabil_eventos.some(e => e.tipo === 'aplicacao_conciliada'));

    // A tela do mês: as duas confirmam o extrato.
    const lista = await ctx.chamar('GET', '/aplicacoes?competencia=2026-09');
    assert.deepEqual(lista.corpo.produtos.map(p => [p.produto, p.situacao, p.lancamentos.length, p.sobras.length]), [['rende_facil', 'ok', 3, 0], ['cdb', 'ok', 3, 0]]);
    assert.equal(lista.corpo.produtos[0].aplicacao.original_guardado, true);
    assert.deepEqual(lista.corpo.produtos[1].lancamentos.map(l => [l.parte_rotulo, l.movimentos.map(m => m.id)]), [['capital', [611]], ['capital', [612]], ['rendimento líquido', [613]]]);

    // O painel não cobra nada das aplicações; a conciliação mostra de onde veio.
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-09');
    assert.equal(painel.corpo.pendencias.some(p => p.chave.startsWith('aplicacao_')), false, JSON.stringify(painel.corpo.pendencias.map(p => p.chave)));
    const conc = await ctx.chamar('GET', '/conciliacao?competencia=2026-09&visao=todos&conta_id=1');
    const linha = conc.corpo.linhas.find(l => l.id === 613);
    assert.deepEqual([linha.vinculos[0].criterio_rotulo, linha.vinculos[0].liquidacao.tipo_rotulo, linha.vinculos[0].liquidacao.rotulo], ['Conferido com o PDF da aplicação', 'Resgate de aplicação', 'BB CDB DI — resgate (rendimento líquido) · depósito 1111111111111']);

    // O PDF original (enquanto guardado) e o mesmo PDF de novo.
    const pdf = await ctx.chamar('GET', `/aplicacoes/${rf.id}/pdf`);
    assert.ok(Buffer.from(pdf.corpo.base64, 'base64').equals(pdfRendeFacil()));
    const deNovo = await ctx.chamar('POST', '/aplicacoes/importar', { arquivos: [arquivoDe('rf.pdf', pdfRendeFacil())] });
    assert.equal(semNbsp(deNovo.corpo.resumo), '1 PDF lido · 1 já estava no app');
  } finally {
    await ctx.encerrar();
  }
});

test('o PDF mais novo do mês substitui o anterior; desfazer e "Conferir de novo"; o extrato que chega depois liga pela conciliação automática; o pacote salvo tira o original', async () => {
  const base = cenario();
  // O extrato do Rende Fácil ainda não chegou: só o CDB está no banco.
  const ctx = await montar(cenario({ movimentos_bancarios: base.movimentos_bancarios.filter(m => !String(m.descricao).includes('RENDE')) }));
  try {
    await ctx.chamar('POST', '/aplicacoes/importar', { arquivos: [arquivoDe('rf.pdf', pdfRendeFacil()), arquivoDe('cdb.pdf', pdfCdb())] });
    assert.equal(ativos(ctx).length, 3, 'só as do CDB');
    const tela = await ctx.chamar('GET', '/aplicacoes?competencia=2026-09');
    assert.equal(tela.corpo.produtos[0].situacao, 'divergente', 'mês encerrado: o PDF tem resgates que o extrato não tem');
    assert.ok((await ctx.chamar('GET', '/painel?competencia=2026-09')).corpo.pendencias.some(p => p.chave === 'aplicacao_divergente_rende_facil' && p.nivel === 'critico'));

    // O extrato chega: a conciliação automática do mês liga o Rende Fácil.
    ctx.tabelas.movimentos_bancarios.push(...base.movimentos_bancarios.filter(m => String(m.descricao).includes('RENDE')));
    const auto = await ctx.chamar('POST', '/conciliacao/automatica', { conta_id: 1, competencia: '2026-09' });
    assert.equal(auto.status, 200, JSON.stringify(auto.corpo));
    assert.equal(ativos(ctx).length, 6);

    // Desfazer uma e "Conferir de novo".
    const des = await ctx.chamar('POST', '/conciliacao/movimentos/601/desfazer', { motivo: 'Conferindo de novo' });
    assert.equal(des.status, 200, JSON.stringify(des.corpo));
    assert.equal(ctx.tabelas.movimentos_bancarios.find(m => m.id === 601).estado_conciliacao, 'pendente');
    const conf = await ctx.chamar('POST', '/aplicacoes/conferir', { competencia: '2026-09' });
    assert.deepEqual([conf.status, conf.corpo.ligados], [200, 1], JSON.stringify(conf.corpo));
    assert.equal(ctx.tabelas.movimentos_bancarios.find(m => m.id === 601).estado_conciliacao, 'conciliado');

    // Um PDF mais novo do mesmo mês (outro arquivo): o anterior sai, o que ele ligou é solto e ligado de novo ao novo.
    const novo = await ctx.chamar('POST', '/aplicacoes/importar', { arquivos: [arquivoDe('rf-novo.pdf', pdfRendeFacil({ invertido: false }))] });
    assert.equal(semNbsp(novo.corpo.resumo), '1 PDF lido · 1 importado · 1 substituiu o do mesmo mês · 3 linhas do extrato conferidas com o PDF');
    const rfs = ctx.tabelas.contabil_aplicacoes.filter(a => a.produto === 'rende_facil');
    assert.deepEqual(rfs.map(a => Boolean(a.substituida_em)), [true, false]);
    const novosIds = ctx.tabelas.contabil_aplicacao_lancamentos.filter(l => l.aplicacao_id === rfs[1].id).map(l => l.id);
    assert.deepEqual(ativos(ctx).filter(v => [601, 602, 603].includes(v.movimento_id)).map(v => novosIds.includes(v.alvo_id)), [true, true, true]);
    assert.ok(ctx.tabelas.conciliacao_vinculos.some(v => v.desfeito_em && /substituído/.test(v.motivo_desfazer)));

    // O pacote salvo: os originais saem do servidor; os dados ficam e a tela avisa.
    const salvo = await ctx.chamar('POST', '/pacote/1/salvo', {});
    assert.equal(salvo.status, 200, JSON.stringify(salvo.corpo));
    assert.equal(salvo.corpo.originais_descartados, 3, 'os dois do Rende Fácil (o substituído também) e o do CDB');
    assert.equal(ctx.tabelas.contabil_arquivo_partes.length, 0);
    assert.equal((await ctx.chamar('GET', `/aplicacoes/${rfs[1].id}/pdf`)).status, 409);
    const evid = await ctx.chamar('GET', '/evidencias?competencia=2026-09');
    assert.deepEqual(evid.corpo.itens.filter(i => i.chave.startsWith('aplicacao:')).map(i => [i.falta, i.falta_rotulo]), [[true, 'O original já saiu no pacote: importe de novo'], [true, 'O original já saiu no pacote: importe de novo']]);
  } finally {
    await ctx.encerrar();
  }
});

test('o Rende Fácil no extrato sem o PDF: pendência crítica; permissões e "falta o SQL da fase C"', async () => {
  const ctx = await montar(cenario());
  try {
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-09');
    const p = painel.corpo.pendencias.filter(x => x.chave.startsWith('aplicacao_'));
    assert.deepEqual(p.map(x => [x.nivel, x.chave, x.fonte]), [['critico', 'aplicacao_sem_pdf_rende_facil', 'extrato'], ['critico', 'aplicacao_sem_pdf_cdb', 'extrato']]);
    assert.deepEqual(p[0].filtro, { acao: 'aplicacoes' });
  } finally {
    await ctx.encerrar();
  }
  const leitura = await montar(cenario(), { permitir: ['contabilidade.view'] });
  try {
    assert.equal((await leitura.chamar('GET', '/aplicacoes?competencia=2026-09')).status, 200);
    assert.deepEqual((await leitura.chamar('POST', '/aplicacoes/importar', {})).corpo.pedidas, ['contabilidade.extrato.importar']);
    assert.deepEqual((await leitura.chamar('POST', '/aplicacoes/conferir', { competencia: '2026-09' })).corpo.pedidas, ['contabilidade.conciliar']);
  } finally {
    await leitura.encerrar();
  }
  const dados = cenario();
  delete dados.contabil_aplicacoes;
  delete dados.contabil_aplicacao_lancamentos;
  const sem = await montar(dados);
  try {
    const lista = await sem.chamar('GET', '/aplicacoes?competencia=2026-09');
    assert.deepEqual([lista.corpo.sql_pendente, lista.corpo.sql_arquivo], [true, 'sql/contabilidade_fase_c.sql']);
    const imp = await sem.chamar('POST', '/aplicacoes/importar', { arquivos: [arquivoDe('rf.pdf', pdfRendeFacil())] });
    assert.deepEqual([imp.status, imp.corpo.sql_arquivo], [409, 'sql/contabilidade_fase_c.sql']);
    const painel = await sem.chamar('GET', '/painel?competencia=2026-09');
    assert.equal(painel.status, 200);
    assert.equal(painel.corpo.pendencias.some(x => x.chave.startsWith('aplicacao_')), false, 'sem o SQL, nada cobrado');
  } finally {
    await sem.encerrar();
  }
});
