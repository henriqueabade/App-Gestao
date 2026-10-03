/**
 * Contabilidade — fase D (02/10/2026): os comprovantes do BB pelas rotas, com
 * a API genérica e a guarda de permissão de mentira.
 *
 * O que fica preso:
 *   - anexar o ZIP do BB guarda SÓ OS DADOS de cada comprovante (o texto
 *     linha a linha, o layout, os campos, o SHA-256); refeito idêntico, o
 *     arquivo não é guardado; o de formato que o app não refaz fica guardado
 *     (até o pacote); o repetido (mesmo SHA-256) e o que não é PDF ficam de
 *     fora;
 *   - cada comprovante liga sozinho ao débito do extrato (o DOCUMENTO, o mesmo
 *     valor no mesmo dia); o CNPJ do favorecido completa o lançamento e a
 *     conciliação paga a conta sozinha; o boleto do DDA liga pela linha
 *     digitável;
 *   - o painel: o pagamento conciliado com o lançamento que tem o comprovante
 *     não pede comprovante (C3); o comprovante sem lançamento é aviso;
 *   - a tela: listar (com o aviso do pagador que não é a empresa), detalhe,
 *     desligar/ligar, ignorar/restaurar, o PDF refeito com o pé "Reproduzido…",
 *     os documentos da competência, o dossiê do lançamento;
 *   - o pacote salvo: o original guardado sai do servidor (ficam os dados);
 *   - permissões e "falta o SQL da fase D".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const zipMod = require('./contabilidade/pacote/zip');
const leitor = require('./contabilidade/comprovantes/leitor');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;
const semNbsp = t => String(t).replace(/ /g, ' ');
const EMPRESA = '11444777000161';

/** Um PDF no molde do jsPDF 1.5.2 do site do BB (dados de mentira). */
function pdfDoBB(linhas, extra = '') {
  const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const conteudo = Buffer.from(`0.57 w\n0 G\nBT\n/F5 8 Tf\n9.20 TL\n0 g\n28.35 813.54 Td\n(${esc(linhas[0] || '')}) Tj\n${linhas.slice(1).map(l => `T* (${esc(l)}) Tj`).join('\n')}\nET${extra}\n`, 'latin1');
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
const LINHA_DIG = '23790000090000000000000000000919915770000123456';
const PIX = ['', 'SISBB  -  SISTEMA DE INFORMACOES BANCO DO BRASIL', '30/09/2026 -     AUTOATENDIMENTO      - 10.15.00', '1234567890                                  1614', '',
  '                Comprovante Pix', 'CLIENTE: SANTISSIMO DECOR LTDA', 'AGENCIA: 1614-4 CONTA:        16.773-8', SEP, 'ID:             E00000000202609301015abcdefghijk',
  'CNPJ DO PAGADOR:              11.444.777/0001-61', 'VALOR:                                R$1.234,56', 'TARIFA:                                   R$0,00',
  'DATA:                      30/09/2026 - 10:15:00', LIN, 'PAGO PARA:  Fulano de Tal', 'CPF:  ***.456.789-**', LIN, ' Esta transação pode ser tarifada.', SEP,
  'DOCUMENTO: 093015', 'AUTENTICACAO SISBB:        A.1B2.C3D.4E5.F67.890', SEP];
const BOLETO = ['', '15/09/2026    -  BANCO  DO  BRASIL  -   09:00:00', '987654321                                   1614', '     COMPROVANTE DE PAGAMENTO DE TITULOS',
  'CLIENTE: SANTISSIMO DECOR LTDA', 'AGENCIA: 1614-4          CONTA:         16.773-8', SEP, 'BCO BRADESCO S.A.', LIN, LINHA_DIG, 'BENEFICIARIO:', 'VIDROS NORTE LTDA',
  'CNPJ:  57.248.237/0001-03', 'BENEFICIARIO FINAL:', 'VIDROS NORTE LTDA', 'CNPJ:  57.248.237/0001-03', 'PAGADOR:', 'ARTDECO MOVEIS LTDA', 'CNPJ:  12.345.678/0001-95', LIN,
  'NR. DOCUMENTO                             12.345', 'DATA DE VENCIMENTO                    15/09/2026', 'DATA DO PAGAMENTO                     15/09/2026',
  'VALOR DO DOCUMENTO                       2.500,00', 'VALOR COBRADO                            2.500,00', SEP, 'NR.AUTENTICACAO            F.123.DC4.5C6.78E.901', SEP];
const CREDITO = ['', 'SISBB  -  SISTEMA DE INFORMACOES BANCO DO BRASIL', '05/09/2026  -   AUTO-ATENDIMENTO     -  09:00:00', '4444444444',
  '       COMPROVANTE DE PAGAMENTO ELETRONICO', 'PAGADOR: SANTISSIMO DECOR LTDA', 'CNPJ: 11.444.777/0001-61', LIN, 'FAVORECIDO: CICLANA DA SILVA', 'CPF: 123.456.789-09',
  'DATA DE PAGAMENTO:                    05/09/2026', 'VALOR CREDITADO (R$):                   1.800,00', LIN, 'AUTENTICACAO SISBB: E.12C.3FC.45B.6EF.789'];
const PDF_PIX = pdfDoBB(PIX);
const PDF_BOLETO = pdfDoBB(BOLETO);
// Um formato que o app não refaz (um desenho a mais): o original fica guardado até o pacote.
const PDF_CREDITO = pdfDoBB(CREDITO, '\n28 20 540 0.5 re\nf');

const COLUNAS = {
  contabil_parametros: ['id', 'chave', 'valor'],
  pedidos: ['id', 'numero', 'situacao', 'cliente_id'], notas_fiscais: ['id'], notas_devolucao: ['id'],
  configuracao_fiscal: ['id', 'cnpj', 'uf', 'razao_social'], configuracao_cobranca: ['id'],
  financeiro_fechamentos: ['id'], financeiro_fechamento_itens: ['id'], financeiro_pagamentos: ['id'], usuarios: ['id', 'nome'],
  contatos: ['id', 'nome', 'cnpj', 'cpf'],
  competencia_contabil: ['id', 'competencia', 'status'], contabil_pendencias_resolucoes: ['id', 'competencia', 'chave'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em', 'referencia_tipo', 'referencia_id'],
  contabil_arquivos: ['id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes', 'sha256', 'partes', 'completo', 'categoria', 'origem', 'competencia', 'descricao', 'criado_por', 'criado_em',
    'excluido_em', 'excluido_por', 'motivo_exclusao'],
  contabil_arquivo_partes: ['id', 'arquivo_id', 'ordem', 'dados'], contabil_arquivo_vinculos: ['id', 'arquivo_id', 'alvo_tipo', 'alvo_id', 'criado_por', 'criado_em'],
  contabil_pacotes: ['id', 'competencia', 'versao', 'hash'],
  documentos_recebidos: ['id', 'tipo', 'origem', 'numero', 'emitente_nome', 'emitente_documento', 'contato_id', 'data_emissao', 'competencia', 'valor_total', 'excluido_em', 'cfops'],
  titulos_pagar: ['id', 'contato_id', 'documento_recebido_id', 'descricao', 'categoria', 'numero_documento', 'data_emissao', 'competencia', 'valor_total', 'status', 'origem', 'observacao',
    'criado_por', 'criado_em', 'atualizado_em', 'cancelado_em', 'cancelado_por', 'motivo_cancelamento'],
  titulo_pagar_parcelas: ['id', 'titulo_id', 'numero', 'vencimento', 'valor', 'linha_digitavel'],
  titulo_pagar_pagamentos: ['id', 'parcela_id', 'titulo_id', 'data_pagamento', 'competencia', 'valor_pago', 'valor_juros', 'valor_desconto', 'forma', 'observacao', 'criado_por', 'criado_em',
    'estornado_em', 'estornado_por', 'motivo_estorno'],
  contas_financeiras: ['id', 'nome', 'tipo', 'banco_codigo', 'agencia', 'agencia_dv', 'conta', 'ativa'],
  extrato_importacoes: ['id', 'conta_id', 'origem', 'status', 'periodo_inicio', 'periodo_fim', 'saldo_final', 'saldo_final_data'],
  movimentos_bancarios: ['id', 'conta_id', 'importacao_id', 'data', 'competencia', 'valor', 'tipo', 'descricao', 'documento', 'identificador', 'contrapartida_documento', 'contrapartida_tipo', 'hash',
    'estado_conciliacao', 'conciliacao_diferenca', 'conciliacao_observacao', 'conciliado_em', 'conciliado_por'],
  conciliacao_vinculos: ['id', 'movimento_id', 'alvo_tipo', 'alvo_id', 'valor', 'criterio', 'detalhe', 'criado_por', 'criado_em', 'desfeito_em', 'desfeito_por', 'motivo_desfazer'],
  contabil_integracoes: ['id', 'chave', 'ativa', 'parametros'], contabil_dfe_recebidos: ['id'],
  contabil_dda_boletos: ['id', 'chave_interna', 'situacao', 'estado_bb', 'codigo_barras', 'linha_digitavel', 'vencimento', 'valor', 'beneficiario_documento', 'beneficiario_nome', 'parcela_id', 'titulo_id', 'estados', 'json_original'],
  contabil_comprovantes: ['id', 'sha256', 'nome_arquivo', 'tamanho_bytes', 'formato', 'layout', 'linhas', 'confere', 'diferenca', 'arquivo_id', 'original_descartado_em', 'tipo', 'data', 'valor', 'tarifa',
    'autenticacao', 'documento', 'controle', 'favorecido_nome', 'favorecido_documento', 'pagador_nome', 'pagador_documento', 'codigo', 'e2e', 'agencia', 'conta', 'segunda_via', 'competencia',
    'conta_id', 'movimento_id', 'dda_boleto_id', 'situacao', 'ligacao_criterio', 'ligado_em', 'ligado_por', 'motivo', 'decidido_em', 'decidido_por', 'importado_em', 'importado_por', 'atualizado_em']
};

/** O tamanho das colunas de texto do SQL (o Postgres recusa o que passa). */
const LIMITES = {
  contabil_comprovantes: {
    sha256: 64, nome_arquivo: 255, formato: 20, tipo: 20, autenticacao: 60, documento: 30, controle: 30, favorecido_nome: 200, favorecido_documento: 20, pagador_nome: 200,
    pagador_documento: 20, codigo: 60, e2e: 40, agencia: 10, conta: 20, competencia: 7, situacao: 12, ligacao_criterio: 30
  },
  movimentos_bancarios: { contrapartida_documento: 14, contrapartida_tipo: 2 },
  contabil_eventos: { tipo: 40 }, conciliacao_vinculos: { criterio: 20 }
};
const passaDoLimite = (tabela, linha) => Object.entries(LIMITES[tabela] || {}).find(([col, max]) => typeof linha[col] === 'string' && linha[col].length > max) || null;
const UNICOS = {
  contabil_comprovantes: (n, l) => l.some(r => r.sha256 === n.sha256) || (n.movimento_id && l.some(r => String(r.movimento_id) === String(n.movimento_id))),
  conciliacao_vinculos: (n, l) => l.some(r => !r.desfeito_em && String(r.movimento_id) === String(n.movimento_id) && r.alvo_tipo === n.alvo_tipo && String(r.alvo_id) === String(n.alvo_id)),
  titulo_pagar_pagamentos: (n, l) => l.some(r => String(r.parcela_id) === String(n.parcela_id) && !r.estornado_em)
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
        const novo = { ...alvo };
        for (const c of colunas) if (body?.[c] !== undefined) novo[c] = body[c];
        if (passaDoLimite(tabela, novo)) return responder(500, { error: `value too long (${passaDoLimite(tabela, novo)[0]})` });
        if (tabela === 'contabil_comprovantes' && novo.movimento_id && tabelas[tabela].some(r => r !== alvo && String(r.movimento_id) === String(novo.movimento_id))) {
          return responder(500, { error: 'duplicate key value violates unique constraint' });
        }
        Object.assign(alvo, novo);
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
  './contabilidade/conciliacao/liquidacoes', './contabilidade/comprovantes/comprovantes', './contabilidade/pacote/pacote', './contabilidade/relatorio/dossie', './fiscal/configuracaoFiscal'
];

function cenario(extra = {}) {
  return {
    pedidos: [], notas_fiscais: [], notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: EMPRESA, uf: 'MG', razao_social: 'SANTISSIMO DECOR LTDA' }], configuracao_cobranca: [],
    financeiro_fechamentos: [], financeiro_fechamento_itens: [], financeiro_pagamentos: [], usuarios: [{ id: 3, nome: 'Henrique' }],
    contatos: [{ id: 7, nome: 'Vidros Norte', cnpj: '57.248.237/0001-03' }],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [],
    contabil_arquivos: [], contabil_arquivo_partes: [], contabil_arquivo_vinculos: [], contabil_pacotes: [{ id: 1, competencia: '2026-09', versao: 1, hash: 'h' }],
    documentos_recebidos: [{ id: 4, tipo: 'nfe', origem: 'sefaz', numero: '4521', emitente_nome: 'Vidros Norte', emitente_documento: '57248237000103', contato_id: 7, data_emissao: '2026-09-01', competencia: '2026-09', valor_total: 2500 }],
    titulos_pagar: [{ id: 1, contato_id: 7, documento_recebido_id: 4, descricao: 'NF-e 4521 — Vidros Norte', competencia: '2026-09', valor_total: 2500, status: 'aberto', origem: 'nfe' }],
    titulo_pagar_parcelas: [{ id: 11, titulo_id: 1, numero: 1, vencimento: '2026-09-15', valor: 2500, linha_digitavel: null }],
    titulo_pagar_pagamentos: [],
    contas_financeiras: [{ id: 1, nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1614', agencia_dv: '4', conta: '167738', ativa: true }],
    extrato_importacoes: [],
    movimentos_bancarios: [
      { id: 501, conta_id: 1, data: '2026-09-15', competencia: '2026-09', valor: -2500, tipo: 'debito', descricao: 'PAGAMENTO DE BOLETO', hash: 'h1', estado_conciliacao: 'pendente' },
      { id: 502, conta_id: 1, data: '2026-09-30', competencia: '2026-09', valor: -1234.56, tipo: 'debito', descricao: 'PIX ENVIADO', documento: '93015', hash: 'h2', estado_conciliacao: 'pendente' }
    ],
    conciliacao_vinculos: [], contabil_integracoes: [], contabil_dfe_recebidos: [],
    // O boleto da Vidros no DDA, já ligado à parcela pela busca do DDA (fase H).
    contabil_dda_boletos: [{ id: 9, chave_interna: 'k9', situacao: 'vinculado', parcela_id: 11, titulo_id: 1, estado_bb: 3, codigo_barras: '2'.repeat(44), linha_digitavel: LINHA_DIG, vencimento: '2026-09-15', valor: 2500, beneficiario_documento: '57248237000103', beneficiario_nome: 'VIDROS NORTE LTDA', estados: '[]', json_original: '{}' }],
    contabil_comprovantes: [],
    ...extra
  };
}

async function montar(dados, { permitir = true } = {}) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  require('./cobranca/configuracaoCobranca').limparCache?.();
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

const ZIP = zipMod.zipar([
  { nome: '1 - 30092026 - Transferência - 1.234,56.pdf', dados: PDF_PIX },
  { nome: '2 - 15092026 - Pagamento - 2.500,00.pdf', dados: PDF_BOLETO },
  { nome: '3 - 05092026 - Pagamento - 1.800,00.pdf', dados: PDF_CREDITO },
  { nome: 'leia-me.txt', dados: Buffer.from('lista dos comprovantes') }
]);
const porNome = (ctx, inicio) => ctx.tabelas.contabil_comprovantes.find(x => String(x.nome_arquivo).startsWith(inicio));

test('anexar o ZIP do BB: só os dados, liga ao extrato, completa o CNPJ, a conciliação paga a conta; o painel deixa de pedir o comprovante', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('POST', '/comprovantes/importar', {
      arquivos: [{ nome: 'SantissimoDecor_comprovantesBB.zip', base64: ZIP.toString('base64') }, { nome: 'de novo.pdf', base64: PDF_PIX.toString('base64') }]
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.match(semNbsp(r.corpo.resumo), /^4 comprovantes lidos · 3 novos · 1 já estava no app · 2 refeitos idênticos \(o arquivo não foi guardado\) · 1 original guardado até o pacote · 2 ligados ao extrato \(1 CPF\/CNPJ completado no lançamento\) · 1 lançamento conciliado sozinho \(1 conta paga\) · 1 arquivo ignorado$/);
    assert.deepEqual(r.corpo.ignorados, [{ nome: 'leia-me.txt', motivo: 'não é PDF' }]);

    // Só os dados: o texto linha a linha e o layout; o arquivo só do que não refaz.
    const pix = porNome(ctx, '1 -');
    const bol = porNome(ctx, '2 -');
    const cred = porNome(ctx, '3 -');
    assert.deepEqual(JSON.parse(pix.linhas), PIX);
    assert.deepEqual(JSON.parse(pix.layout).entrelinha, 9.2);
    assert.deepEqual([pix.confere, pix.arquivo_id, pix.tipo, pix.documento, pix.data, Number(pix.valor), pix.competencia, pix.conta_id], [true, null, 'pix', '93015', '2026-09-30', 1234.56, '2026-09', 1]);
    assert.deepEqual([cred.confere, cred.formato, Boolean(cred.arquivo_id)], [false, 'desconhecido', true]);
    const original = ctx.tabelas.contabil_arquivos.find(a => a.id === cred.arquivo_id);
    assert.deepEqual([original.categoria, original.origem, original.competencia], ['comprovante', 'oficial', null]);
    assert.equal(ctx.tabelas.contabil_arquivos.length, 1, 'os refeitos não guardam arquivo');

    // Ligado ao extrato: o Pix pelo DOCUMENTO, o boleto pelo mesmo valor no mesmo dia (e o CNPJ completado).
    assert.deepEqual([pix.situacao, pix.movimento_id, pix.ligacao_criterio], ['ligado', 502, 'documento']);
    assert.deepEqual([bol.situacao, bol.movimento_id, bol.ligacao_criterio, bol.dda_boleto_id], ['ligado', 501, 'mesmo_dia', 9]);
    assert.equal(ctx.tabelas.movimentos_bancarios.find(m => m.id === 501).contrapartida_documento, '57248237000103');
    assert.equal(cred.situacao, 'novo');
    // A conciliação casou pelo CNPJ e pagou a conta da Vidros.
    const v = ctx.tabelas.conciliacao_vinculos.find(x => x.movimento_id === 501);
    assert.equal(v.criterio, 'parcela_paga');
    assert.ok(ctx.tabelas.titulo_pagar_pagamentos.some(p => p.parcela_id === 11 && p.data_pagamento === '2026-09-15'));
    assert.ok(ctx.tabelas.contabil_eventos.some(e => e.tipo === 'comprovantes_importados') && ctx.tabelas.contabil_eventos.some(e => e.tipo === 'comprovante_ligado'));

    // O painel: o pagamento da Vidros tem comprovante (pelo lançamento); o crédito sem lançamento é aviso.
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-09');
    const chaves = painel.corpo.pendencias.map(p => p.chave);
    assert.equal(chaves.includes('pagar_sem_comprovante'), false, JSON.stringify(chaves));
    assert.equal(painel.corpo.pendencias.find(p => p.chave === 'comprovantes_sem_lancamento').nivel, 'aviso');

    // A lista: o lançamento de cada um e o aviso do pagador que não é a empresa (ARTDECO).
    const lista = await ctx.chamar('GET', '/comprovantes?competencia=2026-09');
    assert.deepEqual([lista.corpo.contagem.total, lista.corpo.contagem.ligados, lista.corpo.contagem.sem_par, lista.corpo.contagem.refeitos, lista.corpo.contagem.originais_guardados], [3, 2, 1, 2, 1]);
    const lb = lista.corpo.linhas.find(l => l.tipo === 'boleto');
    assert.deepEqual([lb.movimento.id, lb.criterio_rotulo, lb.favorecido_documento], [501, 'mesmo valor no mesmo dia', '57.248.237/0001-03']);
    assert.match(lb.avisos[0], /O pagador do boleto é ARTDECO MOVEIS LTDA, não a empresa/);
    const lc = lista.corpo.linhas.find(l => l.tipo === 'credito_conta');
    assert.match(lc.avisos.join(' '), /não refaz este idêntico ao do banco: o original fica guardado até o pacote/);

    // O PDF refeito com o pé "Reproduzido…" (e o corpo igual ao original); o guardado sai como veio.
    const doc = await ctx.chamar('GET', `/comprovantes/${pix.id}/pdf`);
    const lido = leitor.lerPdf(Buffer.from(doc.corpo.base64, 'base64'));
    assert.deepEqual([doc.corpo.nome, doc.corpo.origem, lido.blocos.length], ['1 - 30092026 - Transferência - 1.234,56.pdf', 'reproduzido', 2]);
    assert.deepEqual(lido.blocos[0].linhas.map(l => l.texto), PIX);
    assert.match(lido.blocos[1].linhas.map(l => l.texto).join(' '), new RegExp(`Reproduzido pelo App-Gestão a partir do comprovante original do BB .*SHA-256 ${pix.sha256}`));
    const orig = await ctx.chamar('GET', `/comprovantes/${cred.id}/pdf`);
    assert.ok(Buffer.from(orig.corpo.base64, 'base64').equals(PDF_CREDITO));

    // Os documentos da competência e o dossiê do lançamento.
    const evid = await ctx.chamar('GET', '/evidencias?competencia=2026-09');
    const cs = evid.corpo.itens.filter(i => i.chave.startsWith('comprovante:'));
    assert.deepEqual(cs.map(i => [i.origem_rotulo, i.baixar.tipo]).sort(), [['Oficial', 'arquivo'], ['Reproduzido (idêntico ao original do BB)', 'comprovante'], ['Reproduzido (idêntico ao original do BB)', 'comprovante']]);
    const dossie = await ctx.chamar('GET', '/dossie?tipo=movimento&id=501');
    const sec = dossie.corpo.secoes.find(s => s.chave === 'comprovante');
    assert.ok(sec, JSON.stringify(dossie.corpo.secoes.map(s => s.chave)));
    assert.ok(sec.linhas.some(([k, v]) => k === 'Autenticação' && v === 'F.123.DC4.5C6.78E.901'));

    // Desligar (com motivo) e ligar à mão; ignorar e restaurar.
    assert.equal((await ctx.chamar('POST', `/comprovantes/${pix.id}/desligar`, {})).status, 400);
    assert.equal((await ctx.chamar('POST', `/comprovantes/${pix.id}/desligar`, { motivo: 'Teste de desligar' })).status, 200);
    const det = await ctx.chamar('GET', `/comprovantes/${pix.id}`);
    assert.deepEqual([det.corpo.candidatos[0].movimento_id, det.corpo.candidatos[0].mesmo_valor], [502, true]);
    assert.deepEqual(det.corpo.comprovante.linhas, PIX);
    assert.equal((await ctx.chamar('POST', `/comprovantes/${pix.id}/ligar`, { movimento_id: 501 })).status, 409, 'o lançamento já tem outro comprovante');
    const ligou = await ctx.chamar('POST', `/comprovantes/${pix.id}/ligar`, { movimento_id: 502 });
    assert.deepEqual([ligou.status, porNome(ctx, '1 -').ligacao_criterio], [200, 'manual']);
    assert.equal((await ctx.chamar('POST', `/comprovantes/${cred.id}/ignorar`, { motivo: 'Salário pago pela folha' })).status, 200);
    assert.equal((await ctx.chamar('GET', '/painel?competencia=2026-09')).corpo.pendencias.some(p => p.chave === 'comprovantes_sem_lancamento'), false);
    assert.equal((await ctx.chamar('POST', `/comprovantes/${cred.id}/restaurar`, {})).status, 200);

    // O pacote salvo: o original guardado sai do servidor; ficam os dados.
    const salvo = await ctx.chamar('POST', '/pacote/1/salvo', {});
    assert.deepEqual([salvo.status, salvo.corpo.originais_descartados], [200, 1]);
    assert.equal(ctx.tabelas.contabil_arquivo_partes.length, 0);
    assert.ok(ctx.tabelas.contabil_arquivos[0].excluido_em);
    assert.ok(porNome(ctx, '3 -').original_descartado_em && JSON.parse(porNome(ctx, '3 -').linhas).length);
    assert.equal((await ctx.chamar('GET', `/comprovantes/${cred.id}/pdf`)).status, 409);
    assert.equal((await ctx.chamar('POST', '/pacote/1/salvo', {})).corpo.originais_descartados, 0);
    const depois = await ctx.chamar('GET', '/evidencias?competencia=2026-09');
    assert.equal(depois.corpo.itens.find(i => i.chave === `comprovante:${cred.id}`).falta, true);

    // O mesmo ZIP de novo: nada repete.
    const deNovo = await ctx.chamar('POST', '/comprovantes/importar', { arquivos: [{ nome: 'z.zip', base64: ZIP.toString('base64') }] });
    assert.match(deNovo.corpo.resumo, /^3 comprovantes lidos · 3 já estavam no app/);
    assert.equal(ctx.tabelas.contabil_comprovantes.length, 3);
  } finally {
    await ctx.encerrar();
  }
});

/** Um OFX 1.x do jeito do Gerenciador Financeiro do BB (o mesmo molde de contabilidadeExtrato.test.js). */
function ofxDoBB({ agencia, conta, inicio, fim, linhas }) {
  const d = iso => iso.replace(/-/g, '');
  return Buffer.from([
    'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
    '<OFX>', '<BANKMSGSRSV1>', '<STMTTRNRS>', '<STMTRS>', '<CURDEF>BRL',
    '<BANKACCTFROM>', '<BANKID>1', `<BRANCHID>${agencia}`, `<ACCTID>${conta}`, '<ACCTTYPE>CHECKING', '</BANKACCTFROM>',
    '<BANKTRANLIST>', `<DTSTART>${d(inicio)}`, `<DTEND>${d(fim)}`,
    ...linhas.flatMap(l => ['<STMTTRN>', `<TRNTYPE>${l.valor < 0 ? 'DEBIT' : 'CREDIT'}`, `<DTPOSTED>${d(l.data)}120000[-3:BRT]`, `<TRNAMT>${l.valor.toFixed(2)}`,
      `<FITID>${l.fitid}`, ...(l.doc ? [`<CHECKNUM>${l.doc}`] : []), `<MEMO>${l.memo}`, '</STMTTRN>']),
    '</BANKTRANLIST>', '</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>', '</OFX>', ''
  ].join('\r\n'), 'latin1').toString('base64');
}

test('o extrato chega DEPOIS do ZIP: o OFX importado liga os comprovantes e paga a conta; "Ligar sozinho" pega o que faltou', async () => {
  const ctx = await montar(cenario({ movimentos_bancarios: [] }));
  try {
    const r = await ctx.chamar('POST', '/comprovantes/importar', { arquivos: [{ nome: 'bb.zip', base64: ZIP.toString('base64') }] });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.ok(ctx.tabelas.contabil_comprovantes.every(x => x.situacao === 'novo'), 'sem o extrato, nada liga');
    const nada = await ctx.chamar('POST', '/comprovantes/conferir', {});
    assert.deepEqual([nada.status, nada.corpo.ligados, nada.corpo.resumo], [200, 0, 'Nenhum comprovante novo para ligar sozinho']);

    // O OFX de setembro: o boleto (mesmo valor no mesmo dia) se liga, completa o CNPJ e a conciliação paga a conta.
    const ofx = ofxDoBB({ agencia: '1614-4', conta: '16773-8', inicio: '2026-09-01', fim: '2026-09-20', linhas: [{ data: '2026-09-15', valor: -2500, fitid: 'a1', memo: 'Pagamento de boleto' }] });
    const imp = await ctx.chamar('POST', '/extrato/importar', { conta_id: 1, nome: 'setembro.ofx', base64: ofx });
    assert.equal(imp.status, 200, JSON.stringify(imp.corpo));
    assert.match(semNbsp(imp.corpo.conciliacao_resumo || ''), /^1 comprovante do BB ligado ao extrato · 1 lançamento conciliado sozinho \(1 conta paga\)$/);
    const bol = porNome(ctx, '2 -');
    const mov = ctx.tabelas.movimentos_bancarios.find(m => Number(m.valor) === -2500);
    assert.deepEqual([bol.situacao, String(bol.movimento_id), mov.contrapartida_documento], ['ligado', String(mov.id), '57248237000103']);
    assert.ok(ctx.tabelas.titulo_pagar_pagamentos.some(p => p.parcela_id === 11));

    // O Pix chega por fora (outra fonte do extrato): "Ligar sozinho" o pega pelo DOCUMENTO.
    ctx.tabelas.movimentos_bancarios.push({ id: 900, conta_id: 1, data: '2026-09-30', competencia: '2026-09', valor: -1234.56, tipo: 'debito', descricao: 'PIX ENVIADO', documento: '93015', hash: 'hx', estado_conciliacao: 'pendente' });
    const conf = await ctx.chamar('POST', '/comprovantes/conferir', {});
    assert.deepEqual([conf.status, conf.corpo.ligados], [200, 1], JSON.stringify(conf.corpo));
    assert.match(semNbsp(conf.corpo.resumo), /^1 comprovante ligado ao extrato/);
    assert.deepEqual([porNome(ctx, '1 -').movimento_id, porNome(ctx, '1 -').ligacao_criterio], [900, 'documento']);
  } finally {
    await ctx.encerrar();
  }
});

test('comprovantes: permissões e "falta o SQL da fase D"', async () => {
  const ctx = await montar(cenario(), { permitir: ['contabilidade.view'] });
  try {
    assert.equal((await ctx.chamar('GET', '/comprovantes')).status, 200);
    for (const rota of ['/comprovantes/importar', '/comprovantes/conferir', '/comprovantes/1/ligar', '/comprovantes/1/desligar', '/comprovantes/1/ignorar', '/comprovantes/1/restaurar']) {
      const r = await ctx.chamar('POST', rota, {});
      assert.deepEqual([r.status, r.corpo.pedidas], [403, ['contabilidade.documento.registrar']], rota);
    }
    assert.deepEqual((await ctx.chamar('POST', '/pacote/1/salvo', {})).corpo.pedidas, ['contabilidade.pacote.gerar']);
  } finally {
    await ctx.encerrar();
  }
  const dados = cenario();
  delete dados.contabil_comprovantes;
  const sem = await montar(dados);
  try {
    const lista = await sem.chamar('GET', '/comprovantes');
    assert.deepEqual([lista.corpo.sql_pendente, lista.corpo.sql_arquivo], [true, 'sql/contabilidade_fase_d.sql']);
    const imp = await sem.chamar('POST', '/comprovantes/importar', { arquivos: [{ nome: 'z.zip', base64: ZIP.toString('base64') }] });
    assert.deepEqual([imp.status, imp.corpo.sql_arquivo], [409, 'sql/contabilidade_fase_d.sql']);
    assert.equal((await sem.chamar('POST', '/comprovantes/importar', {})).status, 400);
    assert.deepEqual([(await sem.chamar('POST', '/comprovantes/conferir', {})).status], [409]);
    const painel = await sem.chamar('GET', '/painel?competencia=2026-09');
    assert.equal(painel.status, 200);
    assert.ok(painel.corpo.pendencias.some(p => p.chave === 'pagar_sem_comprovante') === false, 'sem pagamento no mês, nada a cobrar');
  } finally {
    await sem.encerrar();
  }
});
