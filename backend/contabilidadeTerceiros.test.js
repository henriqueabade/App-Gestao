/**
 * Contabilidade — fase F (02/10/2026): o que a empresa pagou em nome de outra
 * (a Artdeco), pelas rotas, com a API genérica e a guarda de permissão de
 * mentira.
 *
 * O que fica preso:
 *   - anexar o comprovante do boleto em que o PAGADOR é a Artdeco: ele liga ao
 *     débito, o item a receber nasce sozinho e o débito fica conciliado com
 *     ele (critério "terceiro"); o Pix que a Artdeco manda (o CNPJ dela na
 *     descrição) liga sozinho como a devolução;
 *   - a tela (por terceiro: o item, o débito, o que voltou, o saldo), a
 *     conciliação com os rótulos, o painel sem cobrança (quitado);
 *   - à mão: lançar um débito como pago em nome de outro (o painel avisa o
 *     saldo), os débitos a conciliar do mês, cancelar (solta o débito); o item
 *     com devolução não cancela; o débito já conciliado não vira item;
 *   - permissões e "falta o SQL da fase F" (nada cobrado, nada quebra).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;
const semNbsp = t => String(t).replace(/ /g, ' ');
const EMPRESA = '11444777000161';
const ARTDECO = '12345678000195';

/** Um PDF no molde do jsPDF 1.5.2 do site do BB (dados de mentira). */
function pdfDoBB(linhas) {
  const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const conteudo = Buffer.from(`0.57 w\n0 G\nBT\n/F5 8 Tf\n9.20 TL\n0 g\n28.35 813.54 Td\n(${esc(linhas[0] || '')}) Tj\n${linhas.slice(1).map(l => `T* (${esc(l)}) Tj`).join('\n')}\nET\n`, 'latin1');
  return Buffer.concat([
    Buffer.from('%PDF-1.3\n1 0 obj\n<< /Type /Pages /Kids [3 0 R ] /Count 1 >>\nendobj\n2 0 obj\n<< /Font << /F5 9 0 R >> >>\nendobj\n'
      + '3 0 obj\n<</Type /Page /Parent 1 0 R /Resources 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R>>\nendobj\n'
      + `4 0 obj\n<</Length ${conteudo.length}>>\nstream\n`, 'latin1'),
    conteudo,
    Buffer.from('\nendstream\nendobj\n9 0 obj\n<< /BaseFont /Courier /Type /Font /Encoding /WinAnsiEncoding /Subtype /Type1 >>\nendobj\n'
      + '10 0 obj\n<< /Producer (jsPDF 1.5.2) >>\nendobj\n11 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj\ntrailer\n<< /Root 11 0 R >>\n%%EOF', 'latin1')
  ]);
}

const SEP = '================================================';
const LIN = '------------------------------------------------';
const BOLETO_ARTDECO = ['', '15/09/2026    -  BANCO  DO  BRASIL  -   09:00:00', '987654321                                   1614', '     COMPROVANTE DE PAGAMENTO DE TITULOS',
  'CLIENTE: SANTISSIMO DECOR LTDA', 'AGENCIA: 1614-4          CONTA:         16.773-8', SEP, 'BCO BRADESCO S.A.', LIN, '23790000090000000000000000000919915770000055000', 'BENEFICIARIO:',
  'PATRIMONIUM CONTABILIDADE', 'CNPJ:  57.248.237/0001-03', 'BENEFICIARIO FINAL:', 'PATRIMONIUM CONTABILIDADE', 'CNPJ:  57.248.237/0001-03', 'PAGADOR:', 'ARTDECO MOVEIS LTDA',
  'CNPJ:  12.345.678/0001-95', LIN, 'NR. DOCUMENTO                             12.345', 'DATA DE VENCIMENTO                    15/09/2026', 'DATA DO PAGAMENTO                     15/09/2026',
  'VALOR DO DOCUMENTO                         550,00', 'VALOR COBRADO                              550,00', SEP, 'NR.AUTENTICACAO            F.123.DC4.5C6.78E.901', SEP];

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
  movimentos_bancarios: ['id', 'conta_id', 'importacao_id', 'data', 'competencia', 'valor', 'tipo', 'descricao', 'documento', 'identificador', 'contrapartida_documento', 'contrapartida_tipo', 'hash',
    'estado_conciliacao', 'conciliacao_diferenca', 'conciliacao_observacao', 'conciliado_em', 'conciliado_por'],
  conciliacao_vinculos: ['id', 'movimento_id', 'alvo_tipo', 'alvo_id', 'valor', 'criterio', 'detalhe', 'criado_por', 'criado_em', 'desfeito_em', 'desfeito_por', 'motivo_desfazer'],
  contabil_integracoes: ['id', 'chave', 'ativa', 'parametros'], contabil_dfe_recebidos: ['id'],
  contabil_comprovantes: ['id', 'sha256', 'nome_arquivo', 'tamanho_bytes', 'formato', 'layout', 'linhas', 'confere', 'diferenca', 'arquivo_id', 'original_descartado_em', 'tipo', 'data', 'valor', 'tarifa',
    'autenticacao', 'documento', 'controle', 'favorecido_nome', 'favorecido_documento', 'pagador_nome', 'pagador_documento', 'codigo', 'e2e', 'agencia', 'conta', 'segunda_via', 'competencia',
    'conta_id', 'movimento_id', 'dda_boleto_id', 'situacao', 'ligacao_criterio', 'ligado_em', 'ligado_por', 'motivo', 'decidido_em', 'decidido_por', 'importado_em', 'importado_por', 'atualizado_em'],
  contabil_terceiros_itens: ['id', 'terceiro_nome', 'terceiro_documento', 'descricao', 'data', 'valor', 'competencia', 'movimento_id', 'comprovante_id', 'origem', 'situacao', 'motivo',
    'criado_em', 'criado_por', 'cancelado_em', 'cancelado_por', 'atualizado_em']
};

/** O tamanho das colunas de texto do SQL da fase F (o Postgres recusa o que passa). */
const LIMITES = {
  contabil_terceiros_itens: { terceiro_nome: 200, terceiro_documento: 20, descricao: 300, competencia: 7, origem: 12, situacao: 12 },
  movimentos_bancarios: { contrapartida_documento: 14, contrapartida_tipo: 2 },
  conciliacao_vinculos: { alvo_tipo: 30, criterio: 20 }, contabil_eventos: { tipo: 40 }
};
const passaDoLimite = (tabela, linha) => Object.entries(LIMITES[tabela] || {}).find(([col, max]) => typeof linha[col] === 'string' && linha[col].length > max) || null;
const UNICOS = {
  contabil_comprovantes: (n, l) => l.some(r => r.sha256 === n.sha256) || (n.movimento_id && l.some(r => String(r.movimento_id) === String(n.movimento_id))),
  contabil_terceiros_itens: (n, l) => Boolean(n.comprovante_id) && l.some(r => String(r.comprovante_id) === String(n.comprovante_id)),
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
  './apiHttpClient', './permissionsController', './contabilidadeController', './contabilidade/checklist', './contabilidade/base', './contabilidade/eventos',
  './contabilidade/titulos', './contabilidade/arquivos', './contabilidade/evidencias', './contabilidade/extrato/extrato', './contabilidade/conciliacao/conciliacao',
  './contabilidade/conciliacao/liquidacoes', './contabilidade/comprovantes/comprovantes', './contabilidade/terceiros/terceiros', './contabilidade/pacote/pacote',
  './contabilidade/relatorio/dossie', './fiscal/configuracaoFiscal'
];

const mov = (id, data, valor, descricao, extra = {}) => ({
  id, conta_id: 1, data, competencia: data.slice(0, 7), valor, tipo: valor < 0 ? 'debito' : 'credito', descricao, hash: `h${id}`, estado_conciliacao: 'pendente', ...extra
});

function cenario(extra = {}) {
  return {
    contabil_parametros: [], pedidos: [], notas_fiscais: [], notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: EMPRESA, uf: 'MG', razao_social: 'SANTISSIMO DECOR LTDA' }],
    configuracao_cobranca: [], financeiro_fechamentos: [], financeiro_fechamento_itens: [], financeiro_pagamentos: [], usuarios: [{ id: 3, nome: 'Henrique' }], contatos: [],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [], contabil_arquivos: [], contabil_arquivo_partes: [], contabil_arquivo_vinculos: [],
    contabil_pacotes: [{ id: 1, competencia: '2026-09', versao: 1, hash: 'h' }],
    documentos_recebidos: [], titulos_pagar: [], titulo_pagar_parcelas: [], titulo_pagar_pagamentos: [],
    contas_financeiras: [{ id: 1, nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1614', agencia_dv: '4', conta: '167738', ativa: true }],
    extrato_importacoes: [],
    movimentos_bancarios: [
      mov(701, '2026-09-15', -550, 'PAGAMENTO DE BOLETO'),
      mov(702, '2026-09-23', 550, `PIX - RECEBIDO - 23/09 14:32 ${ARTDECO} ARTDECO MOV`),
      mov(703, '2026-09-25', -120, 'PIX ENVIADO - CONSERTO DE MAQUINA'),
      mov(704, '2026-09-26', -80, 'PIX ENVIADO - FULANO')
    ],
    conciliacao_vinculos: [], contabil_integracoes: [], contabil_dfe_recebidos: [], contabil_comprovantes: [], contabil_terceiros_itens: [],
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

const ativos = ctx => ctx.tabelas.conciliacao_vinculos.filter(v => !v.desfeito_em);
const estado = (ctx, id) => ctx.tabelas.movimentos_bancarios.find(m => m.id === id).estado_conciliacao;

test('o comprovante do boleto pago em nome da Artdeco: o item a receber nasce sozinho, o débito fica conciliado com ele e o Pix dela liga como a devolução; a tela, a conciliação e o painel', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('POST', '/comprovantes/importar', { arquivos: [{ nome: 'boleto patrimonium.pdf', base64: pdfDoBB(BOLETO_ARTDECO).toString('base64') }] });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(semNbsp(r.corpo.resumo),
      '1 comprovante lido · 1 novo · 1 refeito idêntico (o arquivo não foi guardado) · 1 ligado ao extrato (1 CPF/CNPJ completado no lançamento) · 2 lançamentos de terceiros (a receber) ligados');

    // O item a receber da Artdeco, pelo comprovante.
    const [item] = ctx.tabelas.contabil_terceiros_itens;
    assert.deepEqual([item.terceiro_nome, item.terceiro_documento, item.data, Number(item.valor), item.competencia, item.movimento_id, item.origem, item.situacao],
      ['ARTDECO MOVEIS LTDA', ARTDECO, '2026-09-15', 550, '2026-09', 701, 'comprovante', 'aberto']);
    assert.equal(item.descricao, 'Boleto de PATRIMONIUM CONTABILIDADE pago pela empresa em nome de ARTDECO MOVEIS LTDA');
    // O débito (pago) e o Pix (devolvido) conciliados com o item; os outros débitos, como estavam.
    assert.deepEqual(ativos(ctx).map(v => [v.movimento_id, v.alvo_tipo, v.alvo_id, Number(v.valor), v.criterio]),
      [[701, 'terceiro_pago', item.id, 550, 'terceiro'], [702, 'terceiro_devolvido', item.id, 550, 'terceiro']]);
    assert.deepEqual([701, 702, 703, 704].map(id => estado(ctx, id)), ['conciliado', 'conciliado', 'pendente', 'pendente']);
    assert.ok(['terceiro_lancado', 'terceiro_recebido'].every(t => ctx.tabelas.contabil_eventos.some(e => e.tipo === t)));

    // A tela: por terceiro, o item, o débito, o que voltou.
    const tela = await ctx.chamar('GET', '/terceiros?competencia=2026-09&visao=todos');
    assert.equal(tela.status, 200, JSON.stringify(tela.corpo));
    const [art] = tela.corpo.terceiros;
    assert.deepEqual([art.nome, art.documento, art.pago, art.devolvido, art.saldo], ['ARTDECO MOVEIS LTDA', '12.345.678/0001-95', 550, 550, 0]);
    const [linha] = art.itens;
    assert.deepEqual([linha.situacao, linha.situacao_rotulo, linha.debito.id, linha.debito_ligado, linha.comprovante.nome_arquivo, linha.recebimentos.map(x => [x.valor, x.movimento.id])],
      ['quitado', 'Recebido', 701, true, 'boleto patrimonium.pdf', [[550, 702]]]);
    assert.deepEqual((await ctx.chamar('GET', '/terceiros?competencia=2026-09')).corpo.terceiros, [], 'a visão "A receber" não mostra o quitado');

    // A conciliação mostra de onde veio.
    const conc = await ctx.chamar('GET', '/conciliacao?competencia=2026-09&visao=todos&conta_id=1');
    const v701 = conc.corpo.linhas.find(l => l.id === 701).vinculos[0];
    const v702 = conc.corpo.linhas.find(l => l.id === 702).vinculos[0];
    assert.deepEqual([v701.criterio_rotulo, v701.liquidacao.tipo_rotulo, v702.liquidacao.tipo_rotulo], ['De terceiro (a receber)', 'Pago em nome de terceiro', 'Devolução de terceiro']);

    // O painel: quitado, nada a cobrar da Artdeco.
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-09');
    assert.equal(painel.status, 200);
    assert.equal(painel.corpo.pendencias.some(p => p.chave.startsWith('terceiro')), false, JSON.stringify(painel.corpo.pendencias.map(p => p.chave)));

    // De novo: nada muda (o item não se repete, nada liga duas vezes).
    const conf = await ctx.chamar('POST', '/terceiros/conferir', { competencia: '2026-09' });
    assert.deepEqual([conf.status, conf.corpo.criados, conf.corpo.ligados, conf.corpo.recebidos], [200, 0, 0, 0]);
    assert.equal(ctx.tabelas.contabil_terceiros_itens.length, 1);

    // O item com devolução não cancela.
    const can = await ctx.chamar('POST', `/terceiros/${item.id}/cancelar`, { motivo: 'Lançado por engano' });
    assert.equal(can.status, 409);
    assert.match(can.corpo.error, /já devolveu parte/);
  } finally {
    await ctx.encerrar();
  }
});

test('à mão: o débito pago em nome de outro vira item (o painel avisa o saldo); cancelar solta o débito; o já conciliado e o crédito não viram item', async () => {
  const ctx = await montar(cenario());
  try {
    const debitos = await ctx.chamar('GET', '/terceiros/debitos?competencia=2026-09');
    assert.deepEqual(debitos.corpo.debitos.map(d => d.id), [701, 703, 704]);

    const novo = await ctx.chamar('POST', '/terceiros', { movimento_id: 703, terceiro_nome: 'José da Silva', terceiro_documento: '529.982.247-25', descricao: 'Conserto da máquina do José' });
    assert.equal(novo.status, 200, JSON.stringify(novo.corpo));
    const item = ctx.tabelas.contabil_terceiros_itens.find(i => i.id === novo.corpo.id);
    assert.deepEqual([item.terceiro_documento, item.origem, Number(item.valor), item.descricao], ['52998224725', 'manual', 120, 'Conserto da máquina do José']);
    assert.equal(estado(ctx, 703), 'conciliado');

    // O painel avisa quanto ele deve.
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-09');
    const p = painel.corpo.pendencias.find(x => x.chave === 'terceiro_saldo_doc_52998224725');
    assert.deepEqual([p.nivel, semNbsp(p.titulo), p.fonte], ['aviso', 'José da Silva deve R$ 120,00 à empresa', 'contas_pagar']);
    assert.deepEqual(p.filtro, { acao: 'terceiros' });

    // O já conciliado, o crédito, sem nome, CPF incompleto e o CNPJ da empresa: não.
    const erros = [
      [{ movimento_id: 703, terceiro_nome: 'Outro' }, 409],
      [{ movimento_id: 702, terceiro_nome: 'Outro' }, 422],
      [{ movimento_id: 704, terceiro_nome: '' }, 400],
      [{ movimento_id: 704, terceiro_nome: 'Outro', terceiro_documento: '123' }, 400],
      [{ movimento_id: 704, terceiro_nome: 'A própria', terceiro_documento: EMPRESA }, 400]
    ];
    for (const [corpo, status] of erros) assert.equal((await ctx.chamar('POST', '/terceiros', corpo)).status, status, JSON.stringify(corpo));

    // Cancelar: o motivo é obrigatório; o débito volta a ficar a conciliar.
    assert.equal((await ctx.chamar('POST', `/terceiros/${item.id}/cancelar`, { motivo: 'x' })).status, 400);
    const can = await ctx.chamar('POST', `/terceiros/${item.id}/cancelar`, { motivo: 'Era despesa da empresa' });
    assert.equal(can.status, 200, JSON.stringify(can.corpo));
    assert.equal(ctx.tabelas.contabil_terceiros_itens.find(i => i.id === novo.corpo.id).situacao, 'cancelado');
    assert.equal(estado(ctx, 703), 'pendente');
    assert.ok(ctx.tabelas.conciliacao_vinculos.some(v => v.movimento_id === 703 && /Item de terceiro cancelado: Era despesa da empresa/.test(v.motivo_desfazer)));
    assert.equal((await ctx.chamar('GET', '/painel?competencia=2026-09')).corpo.pendencias.some(x => x.chave.startsWith('terceiro')), false);
    assert.equal((await ctx.chamar('POST', `/terceiros/${item.id}/cancelar`, { motivo: 'De novo, por engano' })).status, 409);

    // O mês fechado não aceita.
    ctx.tabelas.competencia_contabil.push({ id: 1, competencia: '2026-09', status: 'fechada' });
    assert.equal((await ctx.chamar('POST', '/terceiros', { movimento_id: 704, terceiro_nome: 'Fulano' })).status, 409);
  } finally {
    await ctx.encerrar();
  }
});

test('permissões e "falta o SQL da fase F": nada cobrado, a importação dos comprovantes segue', async () => {
  const leitura = await montar(cenario(), { permitir: ['contabilidade.view'] });
  try {
    assert.equal((await leitura.chamar('GET', '/terceiros?competencia=2026-09')).status, 200);
    assert.equal((await leitura.chamar('GET', '/terceiros/debitos?competencia=2026-09')).status, 200);
    for (const [rota, corpo] of [['/terceiros', { movimento_id: 703, terceiro_nome: 'José' }], ['/terceiros/conferir', { competencia: '2026-09' }], ['/terceiros/1/cancelar', { motivo: 'teste teste' }]]) {
      assert.deepEqual((await leitura.chamar('POST', rota, corpo)).corpo.pedidas, ['contabilidade.conciliar'], rota);
    }
  } finally {
    await leitura.encerrar();
  }
  const dados = cenario();
  delete dados.contabil_terceiros_itens;
  const sem = await montar(dados);
  try {
    const lista = await sem.chamar('GET', '/terceiros?competencia=2026-09');
    assert.deepEqual([lista.corpo.sql_pendente, lista.corpo.sql_arquivo], [true, 'sql/contabilidade_fase_f.sql']);
    const novo = await sem.chamar('POST', '/terceiros', { movimento_id: 703, terceiro_nome: 'José' });
    assert.deepEqual([novo.status, novo.corpo.sql_arquivo], [409, 'sql/contabilidade_fase_f.sql']);
    // Os comprovantes seguem como na fase D (o débito da Artdeco fica a conciliar).
    const r = await sem.chamar('POST', '/comprovantes/importar', { arquivos: [{ nome: 'b.pdf', base64: pdfDoBB(BOLETO_ARTDECO).toString('base64') }] });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(estado(sem, 701), 'pendente');
    const painel = await sem.chamar('GET', '/painel?competencia=2026-09');
    assert.equal(painel.status, 200);
    assert.equal(painel.corpo.pendencias.some(x => x.chave.startsWith('terceiro')), false);
  } finally {
    await sem.encerrar();
  }
});
