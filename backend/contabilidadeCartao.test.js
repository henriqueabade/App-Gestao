/**
 * Contabilidade — fase G (02/10/2026): o cartão de crédito do BB pela fatura
 * em XLSX, pelas rotas, com a API genérica e a guarda de permissão de
 * mentira.
 *
 * O que fica preso:
 *   - importar o XLSX guarda os dados (sem o número do cartão), casa sozinha
 *     a nota única (a compra simples e a parcelada inteira) e concilia o
 *     pagamento da fatura no extrato (critério "cartao");
 *   - a tela do mês (as compras, a situação, as sugestões da dúvida, o
 *     pagamento), a conciliação com os rótulos, o painel (a compra sem nota é
 *     crítica; a nota ligada sai de "documento sem conta a pagar");
 *   - escolher a nota (a de outra compra não), "sem nota" e desfazer, o recibo
 *     anexado à compra;
 *   - a fatura corrigida do mesmo vencimento substitui a anterior e guarda as
 *     decisões; a fatura seguinte: a parcela herda a nota; a repetida; o mês
 *     sem a fatura (crítico depois do mês);
 *   - permissões, o cartão fora de uso e "falta o SQL da fase G".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { xlsxDaFatura, desc, parc } = require('./contabilidade/cartao/faturasDeTeste');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;
const semNbsp = t => String(t).replace(/ /g, ' ');

const COLUNAS = {
  contabil_parametros: ['id', 'chave', 'valor', 'atualizado_em', 'atualizado_por'],
  pedidos: ['id', 'numero', 'situacao', 'cliente_id'], notas_fiscais: ['id'], notas_devolucao: ['id'],
  configuracao_fiscal: ['id', 'cnpj', 'uf', 'razao_social'], configuracao_cobranca: ['id'],
  financeiro_fechamentos: ['id'], financeiro_fechamento_itens: ['id'], financeiro_pagamentos: ['id'], usuarios: ['id', 'nome'], contatos: ['id', 'nome', 'cnpj', 'cpf'],
  competencia_contabil: ['id', 'competencia', 'status'], contabil_pendencias_resolucoes: ['id', 'competencia', 'chave'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em', 'referencia_tipo', 'referencia_id'],
  contabil_arquivos: ['id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes', 'sha256', 'partes', 'completo', 'categoria', 'origem', 'competencia', 'descricao', 'criado_por', 'criado_em',
    'excluido_em', 'excluido_por', 'motivo_exclusao'],
  contabil_arquivo_partes: ['id', 'arquivo_id', 'ordem', 'dados'], contabil_arquivo_vinculos: ['id', 'arquivo_id', 'alvo_tipo', 'alvo_id'],
  contabil_pacotes: ['id', 'competencia', 'versao', 'hash'],
  documentos_recebidos: ['id', 'tipo', 'origem', 'numero', 'serie', 'emitente_nome', 'emitente_documento', 'contato_id', 'data_emissao', 'competencia', 'valor_total',
    'financeiro_pagamento_id', 'sem_pagamento', 'excluido_em'],
  titulos_pagar: ['id', 'documento_recebido_id', 'status', 'descricao', 'contato_id', 'valor_total', 'competencia'], titulo_pagar_parcelas: ['id', 'titulo_id'], titulo_pagar_pagamentos: ['id'],
  contas_financeiras: ['id', 'nome', 'tipo', 'banco_codigo', 'agencia', 'agencia_dv', 'conta', 'ativa'],
  extrato_importacoes: ['id', 'conta_id', 'origem', 'status', 'periodo_inicio', 'periodo_fim', 'saldo_final', 'saldo_final_data'],
  movimentos_bancarios: ['id', 'conta_id', 'importacao_id', 'data', 'competencia', 'valor', 'tipo', 'descricao', 'documento', 'identificador', 'contrapartida_documento', 'contrapartida_tipo', 'hash',
    'estado_conciliacao', 'conciliacao_diferenca', 'conciliacao_observacao', 'conciliado_em', 'conciliado_por'],
  conciliacao_vinculos: ['id', 'movimento_id', 'alvo_tipo', 'alvo_id', 'valor', 'criterio', 'detalhe', 'criado_por', 'criado_em', 'desfeito_em', 'desfeito_por', 'motivo_desfazer'],
  contabil_integracoes: ['id', 'chave', 'ativa', 'parametros'], contabil_dfe_recebidos: ['id'],
  contabil_cartao_faturas: ['id', 'cartao_final', 'titular', 'vencimento', 'competencia', 'valor_total', 'valor_minimo', 'saldo_anterior', 'limite', 'sha256', 'nome_arquivo', 'tamanho_bytes',
    'linhas', 'conferencias', 'confere', 'substituida_em', 'substituida_por', 'importado_em', 'importado_por'],
  contabil_cartao_compras: ['id', 'fatura_id', 'ordem', 'tipo', 'secao', 'data', 'descricao', 'cidade', 'valor', 'parcela_numero', 'parcela_total', 'valor_compra', 'documento_id', 'criterio',
    'decisao', 'motivo', 'decidido_em', 'decidido_por', 'atualizado_em']
};

/** O tamanho das colunas de texto do SQL da fase G (o Postgres recusa o que passa). */
const LIMITES = {
  contabil_cartao_faturas: { cartao_final: 4, titular: 200, competencia: 7, sha256: 64, nome_arquivo: 255 },
  contabil_cartao_compras: { tipo: 12, secao: 60, descricao: 120, cidade: 40, criterio: 20, decisao: 12 },
  conciliacao_vinculos: { alvo_tipo: 30, criterio: 20 }, contabil_eventos: { tipo: 40 }, contabil_arquivo_vinculos: { alvo_tipo: 30 }
};
const passaDoLimite = (tabela, linha) => Object.entries(LIMITES[tabela] || {}).find(([col, max]) => typeof linha[col] === 'string' && linha[col].length > max) || null;
const UNICOS = {
  contabil_cartao_faturas: (n, l) => l.some(r => r.sha256 === n.sha256) || (!n.substituida_em && l.some(r => !r.substituida_em && String(r.cartao_final || '') === String(n.cartao_final || '') && r.vencimento === n.vencimento)),
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
        if (passaDoLimite(tabela, alvo)) return responder(500, { error: `value too long (${passaDoLimite(tabela, alvo)[0]})` });
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
  './apiHttpClient', './permissionsController', './contabilidadeController', './contabilidade/checklist', './contabilidade/base', './contabilidade/eventos', './contabilidade/parametros',
  './contabilidade/titulos', './contabilidade/arquivos', './contabilidade/evidencias', './contabilidade/extrato/extrato', './contabilidade/conciliacao/conciliacao',
  './contabilidade/conciliacao/liquidacoes', './contabilidade/cartao/cartao', './contabilidade/documentosRecebidos', './contabilidade/pacote/pacote',
  './contabilidade/relatorio/dossie', './fiscal/configuracaoFiscal'
];

const mov = (id, data, valor, descricao, extra = {}) => ({
  id, conta_id: 1, data, competencia: data.slice(0, 7), valor, tipo: valor < 0 ? 'debito' : 'credito', descricao, hash: `h${id}`, estado_conciliacao: 'pendente', ...extra
});
const doc = (id, data, valor, emitente, extra = {}) => ({
  id, tipo: 'nfe', origem: 'sefaz', numero: String(id), serie: '1', emitente_nome: emitente, data_emissao: data, competencia: data.slice(0, 7), valor_total: valor, ...extra
});

function cenario(extra = {}) {
  return {
    contabil_parametros: [{ id: 1, chave: 'inicio_competencia', valor: '2026-08' }, { id: 2, chave: 'cartao_ativo', valor: 'sim' }, { id: 3, chave: 'cartao_limite_sem_nota', valor: '50.00' }],
    pedidos: [], notas_fiscais: [], notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: '11444777000161', uf: 'MG', razao_social: 'SANTISSIMO DECOR LTDA' }],
    configuracao_cobranca: [], financeiro_fechamentos: [], financeiro_fechamento_itens: [], financeiro_pagamentos: [], usuarios: [{ id: 3, nome: 'Henrique' }], contatos: [],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [], contabil_arquivos: [], contabil_arquivo_partes: [], contabil_arquivo_vinculos: [],
    contabil_pacotes: [{ id: 1, competencia: '2026-09', versao: 1, hash: 'h' }],
    documentos_recebidos: [
      doc(11, '2026-08-20', 320, 'KALUNGA COMERCIO E INDUSTRIA GRAFICA LTDA'),
      doc(12, '2026-09-02', 150, 'LEROY MERLIN CIA BRASILEIRA DE BRICOLAGEM'), doc(13, '2026-09-03', 150, 'OUTRA LOJA LTDA'),
      doc(14, '2026-06-10', 999, 'TOK STOK LTDA')
    ],
    titulos_pagar: [], titulo_pagar_parcelas: [], titulo_pagar_pagamentos: [],
    contas_financeiras: [{ id: 1, nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1614', agencia_dv: '4', conta: '167738', ativa: true }],
    extrato_importacoes: [],
    movimentos_bancarios: [mov(801, '2026-09-14', -616.6, 'PAGAMENTO DE BOLETO - BANCO DO BRASIL S/A - BRASILIA'), mov(802, '2026-09-20', -80, 'PIX ENVIADO - FULANO')],
    conciliacao_vinculos: [], contabil_integracoes: [], contabil_dfe_recebidos: [], contabil_cartao_faturas: [], contabil_cartao_compras: [],
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

const xlsx = async (opcoes, nome = 'fatura.xlsx') => ({ nome, base64: (await xlsxDaFatura(opcoes)).toString('base64') });
const ativos = ctx => ctx.tabelas.conciliacao_vinculos.filter(v => !v.desfeito_em);
const compraDe = (ctx, texto, faturaId = null) => ctx.tabelas.contabil_cartao_compras.find(x => x.descricao === texto && (faturaId === null || x.fatura_id === faturaId));
const doCartao = p => p.chave.startsWith('cartao_');

test('importar a fatura: os dados, a nota única casada sozinha (simples e parcelada), o pagamento conciliado; a tela, a conciliação, o painel; escolher, sem nota, desfazer e o recibo', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('POST', '/cartao/importar', { arquivos: [await xlsx()] });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(semNbsp(r.corpo.resumo), '1 fatura lida · 1 importada · 2 notas ligadas sozinhas · 1 pagamento conciliado no extrato');
    const [f] = ctx.tabelas.contabil_cartao_faturas;
    assert.deepEqual([f.cartao_final, f.vencimento, f.competencia, Number(f.valor_total), f.confere], ['9876', '2026-09-12', '2026-09', 616.6, true]);
    assert.equal(JSON.stringify(ctx.tabelas.contabil_cartao_faturas).includes('4984123412349876'), false, 'o número do cartão não é guardado');
    assert.equal(ctx.tabelas.contabil_cartao_compras.length, 8);
    assert.deepEqual([compraDe(ctx, 'KALUNGA LOJA 12').documento_id, compraDe(ctx, 'KALUNGA LOJA 12').criterio, compraDe(ctx, 'TOK STOK').documento_id], [11, 'automatico', 14]);
    assert.deepEqual(ativos(ctx).map(v => [v.movimento_id, v.alvo_tipo, v.alvo_id, Number(v.valor), v.criterio]), [[801, 'fatura_cartao', f.id, 616.6, 'cartao']]);
    assert.ok(['cartao_fatura_importada', 'cartao_nota_ligada', 'cartao_conciliado'].every(t => ctx.tabelas.contabil_eventos.some(e => e.tipo === t)));

    // A tela do mês.
    const tela = await ctx.chamar('GET', '/cartao?competencia=2026-09');
    assert.equal(tela.status, 200, JSON.stringify(tela.corpo));
    const [ft] = tela.corpo.faturas;
    assert.deepEqual(ft.contagem, { compras: 5, com_nota: 2, sem_nota: 0, abaixo_do_limite: 2, anteriores: 0, pendentes: 1, valor_compras: 633.4 });
    assert.deepEqual([ft.pagamento.pago, ft.pagamento.restante, ft.pagamento.movimentos.map(m => m.id)], [616.6, 0, [801]]);
    const leroy = ft.compras.find(x => x.descricao === 'LEROY MERLIN BH');
    assert.deepEqual([leroy.situacao, leroy.situacao_rotulo, leroy.sugestoes.map(s => s.id)], ['pendente', 'Falta a nota', [12, 13]]);
    assert.deepEqual(ft.compras.find(x => x.descricao === 'TOK STOK').parcela, '03/10');
    assert.deepEqual(ft.compras.filter(x => x.tipo !== 'compra').map(x => [x.tipo, x.situacao]), [['pagamento', 'nao_se_aplica'], ['encargo', 'nao_se_aplica'], ['credito', 'nao_se_aplica']]);

    // A conciliação mostra de onde veio.
    const conc = await ctx.chamar('GET', '/conciliacao?competencia=2026-09&visao=todos&conta_id=1');
    const v801 = conc.corpo.linhas.find(l => l.id === 801).vinculos[0];
    assert.deepEqual([v801.criterio_rotulo, v801.liquidacao.tipo_rotulo, v801.liquidacao.rotulo], ['Pela fatura do cartão importada', 'Fatura do cartão', 'Fatura do cartão final 9876 · venc. 12/09/2026']);

    // O painel: a compra sem nota é crítica; nada de "fatura a importar" nem "sem o pagamento".
    let painel = await ctx.chamar('GET', '/painel?competencia=2026-09');
    assert.equal(painel.status, 200);
    assert.deepEqual(painel.corpo.pendencias.filter(doCartao).map(p => [p.nivel, p.chave, p.fonte, semNbsp(p.titulo)]),
      [['critico', `cartao_sem_nota_${f.id}`, 'contas_pagar', '1 compra do cartão sem nota (venc. 12/09/2026)']]);
    assert.deepEqual(painel.corpo.pendencias.find(doCartao).filtro, { acao: 'cartao' });

    // Escolher a nota da dúvida: a de outra compra não serve.
    assert.equal((await ctx.chamar('POST', `/cartao/compras/${leroy.id}/nota`, { documento_id: 11 })).status, 409);
    const ligou = await ctx.chamar('POST', `/cartao/compras/${leroy.id}/nota`, { documento_id: 12 });
    assert.equal(ligou.status, 200, JSON.stringify(ligou.corpo));
    assert.deepEqual([compraDe(ctx, 'LEROY MERLIN BH').documento_id, compraDe(ctx, 'LEROY MERLIN BH').criterio], [12, 'escolhido']);
    painel = await ctx.chamar('GET', '/painel?competencia=2026-09');
    assert.equal(painel.corpo.pendencias.some(doCartao), false);
    // A nota da compra no cartão não pede conta a pagar; a outra de 150 (não usada) continua pedindo.
    const semConta = painel.corpo.pendencias.find(p => p.chave === 'docrec_sem_conta');
    assert.equal(semConta.titulo, '1 documento sem conta a pagar');

    // "Sem nota" com o motivo, e desfazer.
    const padaria = ft.compras.find(x => x.descricao === 'SUPERMERCADO BH');
    assert.equal((await ctx.chamar('POST', `/cartao/compras/${padaria.id}/sem-nota`, { motivo: 'x' })).status, 400);
    assert.equal((await ctx.chamar('POST', `/cartao/compras/${padaria.id}/sem-nota`, { motivo: 'Cupom fiscal perdido' })).status, 200);
    assert.equal((await ctx.chamar('GET', '/cartao?competencia=2026-09')).corpo.faturas[0].compras.find(x => x.id === padaria.id).situacao, 'sem_nota');
    assert.equal((await ctx.chamar('POST', `/cartao/compras/${padaria.id}/desfazer`, {})).status, 200);
    assert.equal((await ctx.chamar('GET', '/cartao?competencia=2026-09')).corpo.faturas[0].compras.find(x => x.id === padaria.id).situacao, 'abaixo_do_limite');
    const pagamentoDaFatura = ft.compras.find(x => x.tipo === 'pagamento');
    assert.equal((await ctx.chamar('POST', `/cartao/compras/${pagamentoDaFatura.id}/sem-nota`, { motivo: 'Não precisa' })).status, 422);

    // O recibo anexado à compra resolve (desfeita a nota da Leroy).
    assert.equal((await ctx.chamar('POST', `/cartao/compras/${leroy.id}/desfazer`, {})).status, 200);
    const anexo = await ctx.chamar('POST', '/arquivos', {
      nome: 'recibo leroy.pdf', tipo: 'application/pdf', base64: Buffer.from('%PDF-1.4 recibo').toString('base64'), categoria: 'recibo', competencia: '2026-09',
      vinculos: [{ alvo_tipo: 'cartao_compra', alvo_id: leroy.id }]
    });
    assert.equal(anexo.status, 200, JSON.stringify(anexo.corpo));
    const comRecibo = (await ctx.chamar('GET', '/cartao?competencia=2026-09')).corpo.faturas[0].compras.find(x => x.id === leroy.id);
    assert.deepEqual([comRecibo.situacao, comRecibo.com_recibo], ['com_recibo', true]);
  } finally {
    await ctx.encerrar();
  }
});

test('a fatura corrigida substitui a do mesmo vencimento e guarda as decisões; a seguinte: a parcela herda a nota; a repetida; o mês sem fatura', async () => {
  const ctx = await montar(cenario());
  try {
    const primeira = await xlsx();
    await ctx.chamar('POST', '/cartao/importar', { arquivos: [primeira] });
    const leroy = compraDe(ctx, 'LEROY MERLIN BH');
    await ctx.chamar('POST', `/cartao/compras/${leroy.id}/nota`, { documento_id: 12 });

    // O mesmo arquivo de novo: já estava.
    const rep = await ctx.chamar('POST', '/cartao/importar', { arquivos: [primeira] });
    assert.equal(semNbsp(rep.corpo.resumo), '1 fatura lida · 1 já estava no app');

    // Outro XLSX do mesmo vencimento (baixado de novo: o exceljs grava a hora, sai outro SHA-256): substitui,
    // guarda as decisões e concilia o pagamento de novo.
    const corr = await ctx.chamar('POST', '/cartao/importar', { arquivos: [await xlsx({ cliente: 'FULANO DE TAL (2a VIA)' }, 'fatura-de-novo.xlsx')] });
    assert.equal(corr.status, 200, JSON.stringify(corr.corpo));
    assert.match(semNbsp(corr.corpo.resumo), /^1 fatura lida · 1 importada · 1 substituiu a do mesmo vencimento .*· 1 pagamento conciliado no extrato$/);
    const [velha, nova] = ctx.tabelas.contabil_cartao_faturas;
    assert.deepEqual([Boolean(velha.substituida_em), Boolean(nova.substituida_em)], [true, false]);
    assert.deepEqual([compraDe(ctx, 'LEROY MERLIN BH', nova.id).documento_id, compraDe(ctx, 'LEROY MERLIN BH', nova.id).criterio], [12, 'escolhido']);
    assert.deepEqual(ativos(ctx).filter(v => v.alvo_tipo === 'fatura_cartao').map(v => [v.movimento_id, v.alvo_id]), [[801, nova.id]]);
    assert.ok(ctx.tabelas.conciliacao_vinculos.some(v => v.desfeito_em && /substituída/.test(v.motivo_desfazer)));

    // A fatura de outubro: a parcela 04/10 da mesma compra herda a nota; a compra nova pede a nota.
    const outubro = await ctx.chamar('POST', '/cartao/importar', {
      arquivos: [await xlsx({ vencimento: '12/10/2026', saldoAnterior: 616.6, pagamento: -616.6, compras: [['20/09', desc('MADEIREIRA SAO JOSE'), 600]], supermercados: [], parceladas: [['10/06', parc('TOK STOK', 4, 10), 99.9]] }, 'outubro.xlsx')]
    });
    assert.equal(outubro.status, 200, JSON.stringify(outubro.corpo));
    assert.match(semNbsp(outubro.corpo.resumo), /1 parcela com a nota da anterior/);
    const fOut = ctx.tabelas.contabil_cartao_faturas.find(x => x.vencimento === '2026-10-12');
    const tok = compraDe(ctx, 'TOK STOK', fOut.id);
    assert.deepEqual([tok.parcela_numero, tok.documento_id, tok.criterio], [4, 14, 'parcela']);
    const tela = await ctx.chamar('GET', '/cartao?competencia=2026-10');
    assert.equal(tela.corpo.faturas[0].compras.find(x => x.descricao === 'TOK STOK').criterio_rotulo, 'a mesma da parcela anterior');
    const painelOut = await ctx.chamar('GET', '/painel?competencia=2026-10');
    assert.deepEqual(painelOut.corpo.pendencias.filter(doCartao).map(p => [p.nivel, p.chave]), [['critico', `cartao_sem_nota_${fOut.id}`]], 'outubro em curso: sem cobrar o pagamento ainda');

    // Agosto (depois do início, já encerrado) sem a fatura: crítico.
    const agosto = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.deepEqual(agosto.corpo.pendencias.filter(doCartao).map(p => [p.nivel, p.chave, p.titulo]), [['critico', 'cartao_fatura_2026-08', 'Fatura do cartão de agosto/2026 a importar']]);
  } finally {
    await ctx.encerrar();
  }
});

test('permissões, o XLSX que não é fatura, o cartão fora de uso e "falta o SQL da fase G"', async () => {
  const leitura = await montar(cenario(), { permitir: ['contabilidade.view'] });
  try {
    assert.equal((await leitura.chamar('GET', '/cartao?competencia=2026-09')).status, 200);
    assert.deepEqual((await leitura.chamar('POST', '/cartao/importar', {})).corpo.pedidas, ['contabilidade.extrato.importar']);
    assert.deepEqual((await leitura.chamar('POST', '/cartao/conferir', { competencia: '2026-09' })).corpo.pedidas, ['contabilidade.conciliar']);
    for (const rota of ['/cartao/compras/1/nota', '/cartao/compras/1/sem-nota', '/cartao/compras/1/desfazer']) {
      assert.deepEqual((await leitura.chamar('POST', rota, {})).corpo.pedidas, ['contabilidade.documento.registrar'], rota);
    }
  } finally {
    await leitura.encerrar();
  }
  const ctx = await montar(cenario({ contabil_parametros: [{ id: 1, chave: 'inicio_competencia', valor: '2026-08' }, { id: 2, chave: 'cartao_ativo', valor: 'nao' }] }));
  try {
    const ruim = await ctx.chamar('POST', '/cartao/importar', { arquivos: [{ nome: 'x.xlsx', base64: Buffer.from('não é planilha').toString('base64') }] });
    assert.deepEqual([ruim.status, ruim.corpo.novos], [200, 0]);
    assert.match(ruim.corpo.falhas[0], /^x\.xlsx: Não é um arquivo XLSX/);
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.equal(painel.corpo.pendencias.some(doCartao), false, 'cartão fora de uso: nada cobrado');
  } finally {
    await ctx.encerrar();
  }
  const dados = cenario();
  delete dados.contabil_cartao_faturas;
  delete dados.contabil_cartao_compras;
  const sem = await montar(dados);
  try {
    const lista = await sem.chamar('GET', '/cartao?competencia=2026-09');
    assert.deepEqual([lista.corpo.sql_pendente, lista.corpo.sql_arquivo], [true, 'sql/contabilidade_fase_g.sql']);
    const imp = await sem.chamar('POST', '/cartao/importar', { arquivos: [await xlsx()] });
    assert.deepEqual([imp.status, imp.corpo.sql_arquivo], [409, 'sql/contabilidade_fase_g.sql']);
    const painel = await sem.chamar('GET', '/painel?competencia=2026-09');
    assert.equal(painel.status, 200);
    assert.equal(painel.corpo.pendencias.some(doCartao), false, 'sem o SQL, nada cobrado');
    assert.equal((await sem.chamar('POST', '/conciliacao/automatica', { conta_id: 1, competencia: '2026-09' })).status, 200);
  } finally {
    await sem.encerrar();
  }
});
