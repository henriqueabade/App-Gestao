/**
 * Contabilidade — etapa 9 (o pacote para a contabilidade): as rotas de
 * /api/contabilidade com a API genérica e a guarda de permissão de mentira.
 *
 * O que fica preso (29/09/2026):
 *   - o pacote só sai com a competência fechada e sem pendência documental
 *     viva (ignorada com justificativa vale);
 *   - o ZIP traz LEIA-ME, índice com o SHA-256 de cada arquivo, o relatório
 *     (PDF que a tela mandou e a planilha) e os originais em cada pasta; o que
 *     falta fica no LEIA-ME;
 *   - cada pacote fica registrado com o SHA-256 do ZIP; marcar como enviado
 *     guarda para quem e como, e o aviso "pacote não enviado" some;
 *   - sem o SQL da etapa 9, o pacote sai (com aviso) mas não fica registrado;
 *   - gerar e marcar pedem "Gerar relatório e pacote"; ver, só "ver".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const crypto = require('crypto');
const zip = require('./contabilidade/pacote/zip');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  pedidos: ['id', 'numero', 'cliente_id'], clientes: ['id', 'nome', 'nome_fantasia', 'cnpj', 'cpf'],
  pedido_parcelas: ['id', 'pedido_id', 'numero_parcela', 'data_vencimento', 'valor'],
  notas_fiscais: ['id', 'pedido_id', 'serie', 'numero', 'status_fiscal', 'data_emissao', 'valor_total', 'xml_autorizado', 'chave_acesso'], notas_devolucao: ['id'], configuracao_fiscal: ['id', 'cnpj'], configuracao_cobranca: ['id'],
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
  contabil_arquivo_partes: ['id', 'arquivo_id', 'ordem', 'dados'],
  contabil_pacotes: ['id', 'competencia', 'versao', 'nome_arquivo', 'hash', 'tamanho_bytes', 'arquivos', 'faltando', 'gerado_em', 'gerado_por', 'enviado_em', 'enviado_por', 'enviado_para', 'envio_meio', 'envio_observacao'],
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
  classificacoes: ['id', 'movimento_id', 'conta_id', 'observacao', 'criado_por', 'criado_em', 'substituida_em', 'substituida_por'],
  // Fase D: os comprovantes do BB (só os dados; o original só quando não refaz idêntico).
  contabil_comprovantes: ['id', 'sha256', 'nome_arquivo', 'formato', 'layout', 'linhas', 'confere', 'arquivo_id', 'original_descartado_em', 'tipo', 'data', 'valor', 'autenticacao',
    'favorecido_nome', 'competencia', 'movimento_id', 'situacao', 'atualizado_em']
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
  './contabilidade/relatorio/relatorio', './contabilidade/relatorio/documento', './contabilidade/relatorio/planilha', './contabilidade/relatorio/dossie',
  './contabilidade/pacote/pacote', './contabilidade/pacote/zip'
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

const CHAVE = '31260811444777000161550020000000891000000895';
const XML_NFE = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00"><NFe><infNFe Id="NFe${CHAVE}"/></NFe></nfeProc>`;
const BOLETO = Buffer.from('%PDF-1.4 boleto do aluguel de agosto');
const COMPROVANTE = Buffer.from('%PDF-1.4 comprovante do aluguel de agosto');
const OFX = Buffer.from('OFXHEADER:100\r\nDATA:OFXSGML\r\n<OFX></OFX>');

function cenario(extra = {}) {
  return {
    pedidos: [{ id: 1, numero: 2540, cliente_id: 8 }], clientes: [{ id: 8, nome_fantasia: 'Casa Vicenzo' }],
    pedido_parcelas: [{ id: 51, pedido_id: 1, numero_parcela: 1, data_vencimento: '2026-08-08', valor: 3700 }],
    notas_fiscais: [
      { id: 30, pedido_id: 1, serie: 2, numero: 88, status_fiscal: 'autorizada', data_emissao: '2026-07-20', valor_total: 3700 },
      { id: 31, pedido_id: 1, serie: 2, numero: 89, status_fiscal: 'autorizada', data_emissao: '2026-08-12T10:00:00-03:00', valor_total: 3700, chave_acesso: CHAVE, xml_autorizado: XML_NFE }
    ],
    notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: '11444777000161' }], configuracao_cobranca: [],
    financeiro_fechamentos: [{ id: 1, tipo: 'comissao', competencia: '2026-07', status: 'fechado', total: 900 }], financeiro_fechamento_itens: [],
    financeiro_pagamentos: [{ id: 70, fechamento_id: 1, tipo: 'comissao', competencia: '2026-07', valor: 900, data_pagamento: '2026-08-15', forma: 'Pix', beneficiario: 'Ana' }],
    recebimentos: [{ id: 1, pedido_id: 1, numero_parcela: 1, origem: 'boleto', forma: 'Boleto', data_recebimento: '2026-08-10', valor_recebido: 3700, status: 'confirmado' }],
    reembolsos: [], usuarios: [{ id: 3, nome: 'Henrique' }],
    contatos: [{ id: 5, nome: 'Imobiliária Centro' }, { id: 6, nome: 'Vidros Norte', cnpj: '84031759000121' }],
    competencia_contabil: [], contabil_pendencias_resolucoes: [],
    contabil_eventos: [{ id: 1, tipo: 'conciliacao_feita', competencia: '2026-08', descricao: 'Lançamento de 05/08/2026 conciliado', dados: JSON.stringify({ movimento_id: 1 }), usuario_id: 3, criado_em: '2026-09-01T12:00:00Z' }],
    contabil_arquivos: [
      { id: 9, nome_arquivo: 'boleto-aluguel.pdf', tipo_mime: 'application/pdf', tamanho_bytes: BOLETO.length, sha256: 'a'.repeat(64), categoria: 'boleto', origem: 'fornecido', competencia: '2026-08', criado_em: '2026-08-02T10:00:00Z', completo: true, partes: 1 },
      { id: 20, nome_arquivo: 'agosto.ofx', tipo_mime: 'application/x-ofx', tamanho_bytes: OFX.length, sha256: 'b'.repeat(64), categoria: 'extrato', origem: 'oficial', competencia: '2026-08', descricao: 'Extrato BB — conta corrente', criado_em: '2026-09-01T11:00:00Z', completo: true, partes: 1 },
      // 02/10/2026 (C3 crítico): o pagamento do aluguel tem o comprovante do banco.
      { id: 21, nome_arquivo: 'comprovante-aluguel.pdf', tipo_mime: 'application/pdf', tamanho_bytes: COMPROVANTE.length, sha256: 'c'.repeat(64), categoria: 'comprovante', origem: 'oficial', competencia: '2026-08', criado_em: '2026-08-05T10:00:00Z', completo: true, partes: 1 }
    ],
    contabil_arquivo_partes: [{ id: 1, arquivo_id: 9, ordem: 0, dados: BOLETO.toString('base64') }, { id: 2, arquivo_id: 20, ordem: 0, dados: OFX.toString('base64') }, { id: 3, arquivo_id: 21, ordem: 0, dados: COMPROVANTE.toString('base64') }],
    contabil_pacotes: [],
    contabil_arquivo_vinculos: [{ id: 1, arquivo_id: 9, alvo_tipo: 'titulo', alvo_id: '1' }, { id: 2, arquivo_id: 21, alvo_tipo: 'pagamento', alvo_id: '101' }],
    documentos_recebidos: [{ id: 4, tipo: 'nfse', numero: '77', emitente_nome: 'Imobiliária Centro', contato_id: 5, data_emissao: '2026-08-01', competencia: '2026-08', valor_total: 2500, origem: 'manual', itens: '[]' }],
    titulos_pagar: [{ id: 1, contato_id: 5, documento_recebido_id: 4, descricao: 'Aluguel de agosto', categoria: 'Serviços de Terceiros', competencia: '2026-08', valor_total: 2500, status: 'aberto', origem: 'nfse' }],
    titulo_pagar_parcelas: [{ id: 11, titulo_id: 1, numero: 1, vencimento: '2026-08-05', valor: 2500 }],
    titulo_pagar_pagamentos: [{ id: 101, parcela_id: 11, titulo_id: 1, data_pagamento: '2026-08-05', competencia: '2026-08', valor_pago: 2500, forma: 'Boleto' }],
    contas_financeiras: [{ id: 1, nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1234', conta: '123456', ativa: true }],
    extrato_importacoes: [{ id: 1, conta_id: 1, status: 'completa', origem: 'ofx', periodo_inicio: '2026-08-01', periodo_fim: '2026-08-31', saldo_final: 10000, saldo_final_data: '2026-08-31', nome_arquivo: 'agosto.ofx', arquivo_id: 20, criado_por: 3, criado_em: '2026-09-01T11:00:00Z' }],
    movimentos_bancarios: [
      mov(1, '2026-08-05', -2500, 'Pagamento de boleto - Imobiliária Centro', 'conciliado', { documento: '000123' }),
      mov(2, '2026-08-11', 3700, 'LIQUIDAÇÃO DE COBRANÇA', 'conciliado'),
      // C5 (crítico): nada fica a conciliar — a tarifa e o Pix de balcão ficaram sem par, com justificativa.
      mov(3, '2026-08-31', -12.9, 'Tarifa pacote de serviços', 'ignorado'),
      mov(4, '2026-08-12', 1850, 'PIX RECEBIDO - CLIENTE <b>DA</b> LOJA', 'ignorado', { contrapartida_documento: '12345678909' }),
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
    // C7 (crítico): tudo classificado.
    classificacao_regras: [
      regra(1, 'origem', 'recebimento', 'credito', 1), regra(2, 'origem', 'comissao', 'debito', 4), regra(3, 'descricao', 'TARIFA', 'debito', 3),
      regra(4, 'descricao', 'PIX RECEBIDO', 'credito', 1)
    ],
    classificacoes: [],
    competencia_fechamentos: [],
    ...extra
  };
}

const PDF = Buffer.from('%PDF-1.4 relatório mensal de agosto').toString('base64');

/** Fecha agosto e ignora (com justificativa) as pendências documentais: o pacote passa a poder sair. */
async function prontoParaPacote(ctx) {
  const f = await ctx.chamar('POST', '/fechar', { competencia: '2026-08' });
  assert.equal(f.status, 200, JSON.stringify(f.corpo));
  const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
  for (const p of painel.corpo.pendencias.filter(x => x.nivel === 'documental' && !x.ignorada)) {
    const r = await ctx.chamar('POST', '/pendencias/ignorar', { competencia: '2026-08', chave: p.chave, justificativa: 'Conferido com a contabilidade' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
  }
}

const nomes = lista => lista.map(x => x.nome);

test('pacote: bloqueado até fechar e sem documental viva; o ZIP com as pastas, o índice e o LEIA-ME; registrado; marcar como enviado', async () => {
  const ctx = await montar(cenario());
  try {
    const antes = await ctx.chamar('GET', '/pacote?competencia=2026-08');
    assert.equal(antes.status, 200, JSON.stringify(antes.corpo));
    assert.equal(antes.corpo.pode, false);
    assert.ok(antes.corpo.bloqueios.includes('A competência precisa estar fechada.'), JSON.stringify(antes.corpo.bloqueios));
    const pasta = chave => antes.corpo.pastas.find(x => x.chave === chave);
    assert.deepEqual([pasta('relatorio').quantidade, pasta('extrato').quantidade, pasta('saida').quantidade, pasta('outros').quantidade], [2, 1, 1, 1]);
    assert.deepEqual(antes.corpo.faltando.map(x => [x.titulo, x.motivo]), [['NFS-e 77', 'Sem o arquivo']]);
    const bloqueado = await ctx.chamar('POST', '/pacote', { competencia: '2026-08', pdf_base64: PDF });
    assert.equal(bloqueado.status, 409);
    assert.ok(bloqueado.corpo.bloqueios.length);

    await prontoParaPacote(ctx);
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.ok(painel.corpo.pendencias.some(x => x.chave === 'pacote_nao_enviado' && !x.ignorada), 'fechada: o aviso do pacote aparece');
    assert.equal(painel.corpo.pode.pacote, true);

    const r = await ctx.chamar('POST', '/pacote', { competencia: '2026-08', pdf_base64: PDF });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual([r.corpo.nome, r.corpo.versao, r.corpo.aviso, r.corpo.faltando.length], ['Contabilidade-2026-08-v1.zip', 1, null, 1]);
    const bytes = Buffer.from(r.corpo.base64, 'base64');
    assert.equal(r.corpo.hash, crypto.createHash('sha256').update(bytes).digest('hex'));
    const dentro = zip.ler(bytes);
    assert.deepEqual(nomes(dentro), [
      'Contabilidade-2026-08-v1/LEIA-ME.txt', 'Contabilidade-2026-08-v1/indice.csv',
      'Contabilidade-2026-08-v1/01-Relatorio/Relatorio-2026-08-v1.pdf', 'Contabilidade-2026-08-v1/01-Relatorio/Relatorio-2026-08-v1.xlsx',
      'Contabilidade-2026-08-v1/02-Extrato/agosto.ofx', `Contabilidade-2026-08-v1/03-NF-e-de-saida/${CHAVE}-procNFe.xml`,
      'Contabilidade-2026-08-v1/06-Comprovantes/comprovante-aluguel.pdf', 'Contabilidade-2026-08-v1/07-Outros/boleto-aluguel.pdf'
    ], 'na ordem das pastas');
    const arq = nome => dentro.find(x => x.nome.endsWith(nome)).dados;
    assert.ok(arq('agosto.ofx').equals(OFX) && arq('boleto-aluguel.pdf').equals(BOLETO) && arq(`${CHAVE}-procNFe.xml`).toString('utf8') === XML_NFE, 'os originais, byte a byte');
    const leia = arq('LEIA-ME.txt').toString('utf8');
    assert.match(leia, /Fechamento: versão 1, fechada em/);
    assert.match(leia, /Faltando \(1\):\r\n  - NFS-e 77 — Imobiliária Centro: Sem o arquivo/);
    assert.match(leia, /Pendências ignoradas com justificativa:/);
    const indice = arq('indice.csv').toString('utf8');
    assert.ok(indice.includes(`02-Extrato;agosto.ofx;Extrato bancário;Oficial;`) && indice.includes(crypto.createHash('sha256').update(OFX).digest('hex')));

    const reg = ctx.tabelas.contabil_pacotes[0];
    assert.deepEqual([reg.competencia, reg.versao, reg.hash, reg.tamanho_bytes], ['2026-08', 1, r.corpo.hash, bytes.length]);
    assert.equal(JSON.parse(reg.arquivos).length, 6);
    assert.match(ctx.tabelas.contabil_eventos.at(-1).descricao, /^Pacote de agosto\/2026 \(versão 1\) gerado: 6 arquivos, .* 1 faltando · SHA-256 [0-9a-f]{12}…$/);

    const semEnviar = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.match(semEnviar.corpo.pendencias.find(x => x.chave === 'pacote_nao_enviado').descricao, /^Gerado em /);

    assert.equal((await ctx.chamar('POST', `/pacote/${reg.id}/enviado`, { para: 'contabil@exemplo.com', meio: 'Fax' })).status, 400);
    const env = await ctx.chamar('POST', `/pacote/${reg.id}/enviado`, { para: 'contabil@exemplo.com', meio: 'E-mail', observacao: 'mandado junto com a folha' });
    assert.equal(env.status, 200, JSON.stringify(env.corpo));
    const depois = await ctx.chamar('GET', '/pacote?competencia=2026-08');
    assert.deepEqual([depois.corpo.pacotes[0].enviado_para, depois.corpo.pacotes[0].envio_meio, depois.corpo.ultimo_destinatario, depois.corpo.pacotes[0].gerado_por], ['contabil@exemplo.com', 'E-mail', 'contabil@exemplo.com', 'Henrique']);
    const painelFinal = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.ok(!painelFinal.corpo.pendencias.some(x => x.chave === 'pacote_nao_enviado'));
    assert.equal(painelFinal.corpo.situacao.pacote.enviado_para, 'contabil@exemplo.com');
    assert.match(ctx.tabelas.contabil_eventos.at(-1).descricao, /enviado para contabil@exemplo\.com \(E-mail\): mandado junto com a folha/);
  } finally {
    await ctx.encerrar();
  }
});

test('sem o PDF o pacote sai só com a planilha (avisando); PDF estragado é recusado', async () => {
  const ctx = await montar(cenario());
  try {
    await prontoParaPacote(ctx);
    const r = await ctx.chamar('POST', '/pacote', { competencia: '2026-08' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.match(r.corpo.aviso, /PDF não veio/);
    const dentro = nomes(zip.ler(Buffer.from(r.corpo.base64, 'base64')));
    assert.ok(!dentro.some(n => n.endsWith('.pdf') && n.includes('01-Relatorio')) && dentro.some(n => n.endsWith('Relatorio-2026-08-v1.xlsx')));
    const ruim = await ctx.chamar('POST', '/pacote', { competencia: '2026-08', pdf_base64: Buffer.from('<html>').toString('base64') });
    assert.equal(ruim.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('sem o SQL da etapa 9: o pacote sai com aviso e sem registro; marcar como enviado diz qual SQL falta', async () => {
  const dados = cenario();
  delete dados.contabil_pacotes;
  const ctx = await montar(dados);
  try {
    await prontoParaPacote(ctx);
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.ok(!painel.corpo.pendencias.some(x => x.chave === 'pacote_nao_enviado'), 'sem o SQL não cobra o envio');
    const previa = await ctx.chamar('GET', '/pacote?competencia=2026-08');
    assert.deepEqual([previa.status, previa.corpo.sql_pacotes, previa.corpo.pode], [200, false, true]);
    const r = await ctx.chamar('POST', '/pacote', { competencia: '2026-08', pdf_base64: PDF });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.id, null);
    assert.match(r.corpo.aviso, /sql\/contabilidade_pacote\.sql/);
    const env = await ctx.chamar('POST', '/pacote/1/enviado', { para: 'contabil@exemplo.com', meio: 'E-mail' });
    assert.equal(env.status, 409);
    assert.match(env.corpo.error, /contabilidade_pacote\.sql/);
  } finally {
    await ctx.encerrar();
  }
});

test('fase D: o comprovante do BB vai refeito dos dados (com o pé "Reproduzido…") e o original guardado vai como veio; o pacote salvo tira o original do servidor', async () => {
  const leitor = require('./contabilidade/comprovantes/leitor');
  const ORIGINAL = Buffer.from('%PDF-1.4 comprovante do BB que o app não refaz');
  const layout = { pagina: [595.28, 841.89], fonte: 'Courier', tamanho: 8, entrelinha: 9.2, x: 28.35, y: 813.54, linha_espessura: 0.57, cor_traco: 0, cor_texto: 0 };
  const linhas = ['', '                Comprovante Pix', 'VALOR:                                  R$900,00', 'DOCUMENTO: 081501', 'AUTENTICACAO SISBB:        A.1B2.C3D.4E5.F67.890'];
  const base = cenario();
  const ctx = await montar(cenario({
    contabil_arquivos: [...base.contabil_arquivos, { id: 30, nome_arquivo: '5 - 05082026 - Pagamento - 2.500,00.pdf', tipo_mime: 'application/pdf', tamanho_bytes: ORIGINAL.length, sha256: 'd'.repeat(64), categoria: 'comprovante', origem: 'oficial', competencia: null, criado_em: '2026-09-02T10:00:00Z', completo: true, partes: 1 }],
    contabil_arquivo_partes: [...base.contabil_arquivo_partes, { id: 4, arquivo_id: 30, ordem: 0, dados: ORIGINAL.toString('base64') }],
    contabil_comprovantes: [
      { id: 1, sha256: 'e'.repeat(64), nome_arquivo: '4 - 15082026 - Transferência - 900,00.pdf', formato: 'bb_texto', layout: JSON.stringify(layout), linhas: JSON.stringify(linhas), confere: true, tipo: 'pix', data: '2026-08-15', valor: 900, autenticacao: 'A.1B2.C3D.4E5.F67.890', favorecido_nome: 'Ana', competencia: '2026-08', movimento_id: 5, situacao: 'ligado' },
      { id: 2, sha256: 'd'.repeat(64), nome_arquivo: '5 - 05082026 - Pagamento - 2.500,00.pdf', formato: 'desconhecido', layout: null, linhas: '[]', confere: false, arquivo_id: 30, tipo: 'boleto', data: '2026-08-05', valor: 2500, favorecido_nome: 'Imobiliária Centro', competencia: '2026-08', movimento_id: 1, situacao: 'ligado' }
    ]
  }));
  try {
    await prontoParaPacote(ctx);
    const r = await ctx.chamar('POST', '/pacote', { competencia: '2026-08', pdf_base64: PDF });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const dentro = zip.ler(Buffer.from(r.corpo.base64, 'base64'));
    const refeito = dentro.find(x => x.nome.endsWith('06-Comprovantes/4 - 15082026 - Transferência - 900,00.pdf'));
    assert.ok(refeito, nomes(dentro).join('\n'));
    const lido = leitor.lerPdf(refeito.dados);
    assert.deepEqual(lido.blocos[0].linhas.map(l => l.texto), linhas);
    assert.match(lido.blocos[1].linhas.map(l => l.texto).join(' '), /^Reproduzido pelo App-Gestão a partir do comprovante original do BB \(arquivo "4 - 15082026 - Transferência - 900,00\.pdf", SHA-256 e{64}\)/);
    assert.ok(dentro.find(x => x.nome.endsWith('06-Comprovantes/5 - 05082026 - Pagamento - 2.500,00.pdf')).dados.equals(ORIGINAL), 'o original guardado vai como veio');
    const indice = dentro.find(x => x.nome.endsWith('indice.csv')).dados.toString('utf8');
    assert.ok(indice.includes('Reproduzido (idêntico ao original do BB)'));
    assert.match(dentro.find(x => x.nome.endsWith('LEIA-ME.txt')).dados.toString('utf8'), /Comprovantes do BB com a origem "Reproduzido"/);

    // A tela avisa que salvou: o original sai do servidor (ficam os dados e o SHA-256).
    const reg = ctx.tabelas.contabil_pacotes[0];
    const salvo = await ctx.chamar('POST', `/pacote/${reg.id}/salvo`, {});
    assert.deepEqual([salvo.status, salvo.corpo.originais_descartados], [200, 1]);
    assert.ok(!ctx.tabelas.contabil_arquivo_partes.some(p => p.arquivo_id === 30));
    assert.ok(ctx.tabelas.contabil_arquivos.find(a => a.id === 30).excluido_em);
    assert.ok(ctx.tabelas.contabil_comprovantes.find(x => x.id === 2).original_descartado_em);
    assert.ok(ctx.tabelas.contabil_arquivo_partes.some(p => p.arquivo_id === 21), 'os outros arquivos ficam');
  } finally {
    await ctx.encerrar();
  }
});

test('permissões: ver o pacote pede só "ver"; gerar e marcar como enviado pedem "Gerar relatório e pacote"', async () => {
  const ctx = await montar(cenario(), { permitir: ['contabilidade.view'] });
  try {
    assert.equal((await ctx.chamar('GET', '/pacote?competencia=2026-08')).status, 200);
    for (const [rota, corpo] of [['/pacote', { competencia: '2026-08' }], ['/pacote/1/enviado', { para: 'x@y.com', meio: 'E-mail' }]]) {
      const r = await ctx.chamar('POST', rota, corpo);
      assert.deepEqual([r.status, r.corpo.pedidas], [403, ['contabilidade.pacote.gerar']]);
    }
  } finally {
    await ctx.encerrar();
  }
});
