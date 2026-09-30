/**
 * Contabilidade — etapas 2 e 3 (documentos, evidências e contas a pagar):
 * as rotas de /api/contabilidade com a API genérica e a guarda de permissão
 * de mentira.
 *
 * O que fica preso (28/09/2026):
 *   - a NF-e de entrada pelo XML: prévia sem gravar; registro com o
 *     fornecedor cadastrado em Contatos, o XML guardado como oficial (em
 *     partes, com o sha256) e a conta com as duplicatas; a mesma nota de novo
 *     é recusada;
 *   - pagar a parcela (juros quando se paga a mais), com o comprovante; o
 *     mesmo arquivo não é guardado duas vezes; parcela paga não se paga de
 *     novo; estornar libera; conta com pagamento não muda valor nem cancela;
 *   - competência fechada recusa pagamento nela;
 *   - a NFS-e do pagamento de comissão/produção se liga ao pagamento (não
 *     vira conta) e some da pendência;
 *   - excluir o documento cancela a conta dele (sem pagamento);
 *   - as evidências da competência e o download dos arquivos;
 *   - cada rota pede a sua permissão; sem o SQL, 409 dizendo qual arquivo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;
const semNbsp = v => String(v).replace(/ /g, ' ');

const EMPRESA = '11444777000161';
const CHAVE = '31260857248237000103550010000012341000012344';

const COLUNAS = {
  pedidos: ['id', 'numero', 'situacao', 'cliente_id', 'valor_final', 'embarcar_real'],
  notas_fiscais: ['id', 'pedido_id', 'serie', 'numero', 'status_fiscal', 'valor_total', 'data_emissao', 'criado_em', 'xml_autorizado', 'chave_acesso', 'destinatario'],
  notas_devolucao: ['id', 'pedido_id', 'serie', 'numero', 'data_emissao', 'valor_total', 'xml', 'chave_acesso', 'emitente_nome', 'protocolo'],
  configuracao_fiscal: ['id', 'cnpj'],
  financeiro_fechamentos: ['id', 'tipo', 'competencia', 'status', 'total', 'quantidade', 'pagar_ate', 'fechado_em', 'por_setor'],
  financeiro_fechamento_itens: ['id', 'fechamento_id'],
  financeiro_pagamentos: ['id', 'fechamento_id', 'tipo', 'competencia', 'valor', 'data_pagamento', 'forma', 'beneficiario', 'tipo_comissao'],
  usuarios: ['id', 'nome'],
  contatos: ['id', 'nome', 'razao_social', 'tipo_id', 'tipo_pessoa', 'cnpj', 'cpf', 'inscricao_estadual', 'inscricao_municipal', 'email', 'telefone_celular', 'telefone_fixo', 'site',
    'end_logradouro', 'end_numero', 'end_complemento', 'end_bairro', 'end_cidade', 'end_uf', 'end_pais', 'end_cep', 'end_codigo_municipio', 'status', 'anotacoes', 'criado_por', 'criado_em'],
  contato_tipos: ['id', 'nome'],
  contato_pessoas: ['id', 'contato_id', 'nome'],
  contato_historico: ['id', 'contato_id', 'tipo', 'acao', 'entidade', 'campo', 'valor_anterior', 'valor_novo', 'detalhe', 'observacao', 'usuario_id', 'criado_em'],
  competencia_contabil: ['id', 'competencia', 'status', 'fechada_em', 'fechada_por'],
  contabil_pendencias_resolucoes: ['id', 'competencia', 'chave', 'nivel', 'titulo', 'justificativa', 'usuario_id', 'criado_em'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em', 'referencia_tipo', 'referencia_id'],
  contabil_arquivos: ['id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes', 'sha256', 'partes', 'completo', 'categoria', 'origem', 'competencia', 'descricao', 'criado_por', 'criado_em', 'excluido_em', 'excluido_por', 'motivo_exclusao'],
  contabil_arquivo_partes: ['id', 'arquivo_id', 'ordem', 'dados'],
  contabil_arquivo_vinculos: ['id', 'arquivo_id', 'alvo_tipo', 'alvo_id', 'criado_por', 'criado_em'],
  documentos_recebidos: ['id', 'tipo', 'especie', 'origem', 'chave_acesso', 'modelo', 'serie', 'numero', 'codigo_verificacao', 'municipio', 'emitente_documento', 'emitente_nome', 'contato_id',
    'data_emissao', 'competencia', 'natureza_operacao', 'descricao', 'valor_total', 'valor_produtos', 'valor_iss', 'iss_retido', 'valor_retencoes', 'itens', 'cfops', 'protocolo',
    'financeiro_pagamento_id', 'sem_pagamento', 'observacao', 'criado_por', 'criado_em', 'atualizado_em', 'excluido_em', 'excluido_por', 'motivo_exclusao'],
  titulos_pagar: ['id', 'contato_id', 'documento_recebido_id', 'descricao', 'categoria', 'numero_documento', 'data_emissao', 'competencia', 'valor_total', 'status', 'origem', 'observacao',
    'criado_por', 'criado_em', 'atualizado_em', 'cancelado_em', 'cancelado_por', 'motivo_cancelamento'],
  titulo_pagar_parcelas: ['id', 'titulo_id', 'numero', 'vencimento', 'valor', 'linha_digitavel'],
  titulo_pagar_pagamentos: ['id', 'parcela_id', 'titulo_id', 'data_pagamento', 'competencia', 'valor_pago', 'valor_juros', 'valor_desconto', 'forma', 'observacao', 'criado_por', 'criado_em',
    'estornado_em', 'estornado_por', 'motivo_estorno']
};

/** Os índices únicos do SQL (a API remota responde "duplicate key"). */
const UNICOS = {
  documentos_recebidos: (novo, linhas) => novo.chave_acesso && linhas.some(r => r.chave_acesso === novo.chave_acesso && !r.excluido_em),
  titulo_pagar_pagamentos: (novo, linhas) => linhas.some(r => String(r.parcela_id) === String(novo.parcela_id) && !r.estornado_em),
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
      const pk = tabela.startsWith('perm_') ? 'modelo_id' : 'id';
      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r[pk]) === String(id));
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
        if (tabela === 'titulo_pagar_parcelas') tabelas.titulo_pagar_pagamentos = (tabelas.titulo_pagar_pagamentos || []).filter(p => String(p.parcela_id) !== String(id));
        if (tabela === 'contabil_arquivos') tabelas.contabil_arquivo_partes = (tabelas.contabil_arquivo_partes || []).filter(p => String(p.arquivo_id) !== String(id));
        return responder(200, { sucesso: true });
      }
      return responder(405, { error: 'Método não suportado' });
    });
  });
  return { servidor, tabelas };
}

const MODULOS = [
  './apiHttpClient', './permissionsController', './contabilidadeController', './contatosController', './historicoSocial', './contatoHistorico',
  './contabilidade/checklist', './contabilidade/fechamento', './contabilidade/base', './contabilidade/eventos', './contabilidade/arquivos',
  './contabilidade/titulos', './contabilidade/documentosRecebidos', './contabilidade/evidencias', './fiscal/configuracaoFiscal'
];

async function montar(dados, { permitir = true } = {}) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  require('./cobranca/configuracaoCobranca').limparCache?.();
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

function xmlDaNota() {
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${CHAVE}" versao="4.00">`
    + '<ide><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-08-10T10:00:00-03:00</dhEmi><finNFe>1</finNFe><natOp>Venda</natOp></ide>'
    + '<emit><CNPJ>57248237000103</CNPJ><xNome>Vidros Norte LTDA</xNome><xFant>Vidros Norte</xFant><enderEmit><xLgr>Rua A</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>3118601</cMun><xMun>Contagem</xMun><UF>MG</UF><CEP>32000000</CEP><fone>3133330000</fone></enderEmit><IE>0012345670011</IE></emit>'
    + `<dest><CNPJ>${EMPRESA}</CNPJ></dest>`
    + '<det nItem="1"><prod><cProd>V1</cProd><xProd>Vidro temperado</xProd><NCM>70071900</NCM><CFOP>5102</CFOP><uCom>M2</uCom><qCom>12</qCom><vUnCom>100</vUnCom><vProd>1200.00</vProd></prod></det>'
    + '<total><ICMSTot><vProd>1200.00</vProd><vNF>1200.00</vNF></ICMSTot></total>'
    + '<cobr><dup><nDup>001</nDup><dVenc>2026-09-10</dVenc><vDup>600.00</vDup></dup><dup><nDup>002</nDup><dVenc>2026-10-10</dVenc><vDup>600.00</vDup></dup></cobr>'
    + `</infNFe></NFe><protNFe><infProt><chNFe>${CHAVE}</chNFe><nProt>131260000012345</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
}

function cenario(extra = {}) {
  return {
    pedidos: [], notas_fiscais: [], notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: EMPRESA }],
    financeiro_fechamentos: [{ id: 1, tipo: 'comissao', competencia: '2026-07', status: 'fechado', total: 1000, quantidade: 1, pagar_ate: '2026-08-10', fechado_em: '2026-08-02T12:00:00Z', por_setor: null }],
    financeiro_fechamento_itens: [],
    financeiro_pagamentos: [{ id: 70, fechamento_id: 1, tipo: 'comissao', competencia: '2026-07', valor: 1000, data_pagamento: '2026-08-10', forma: 'Pix', beneficiario: 'Ana', tipo_comissao: 'cms' }],
    usuarios: [{ id: 3, nome: 'Henrique' }],
    contatos: [], contato_tipos: [{ id: 1, nome: 'Fornecedor' }, { id: 2, nome: 'Prestador de serviço' }, { id: 3, nome: 'Outro' }], contato_pessoas: [], contato_historico: [],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [],
    contabil_arquivos: [], contabil_arquivo_partes: [], contabil_arquivo_vinculos: [],
    documentos_recebidos: [], titulos_pagar: [], titulo_pagar_parcelas: [], titulo_pagar_pagamentos: [],
    ...extra
  };
}

const PDF = Buffer.from('%PDF-1.4 comprovante de mentira').toString('base64');

test('NF-e de entrada pelo XML: prévia sem gravar; registro com fornecedor novo, XML oficial e a conta com as duplicatas; a mesma nota de novo é recusada', async () => {
  const ctx = await montar(cenario());
  try {
    const previa = await ctx.chamar('POST', '/documentos/previa', { xml: xmlDaNota() });
    assert.equal(previa.status, 200);
    assert.deepEqual([previa.corpo.numero, previa.corpo.competencia, previa.corpo.contato, previa.corpo.bloqueios], [1234, '2026-08', null, []]);
    assert.deepEqual(previa.corpo.parcelas.map(p => [p.vencimento, p.valor]), [['2026-09-10', 600], ['2026-10-10', 600]]);
    assert.equal(ctx.tabelas.documentos_recebidos.length, 0, 'a prévia não grava');

    const r = await ctx.chamar('POST', '/documentos', { tipo: 'nfe', xml: xmlDaNota(), gerar_titulo: true, titulo: { categoria: 'Aquisição de Bens' } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.contato_criado, true);
    assert.deepEqual(r.corpo.avisos, []);
    const contato = ctx.tabelas.contatos[0];
    assert.deepEqual([contato.nome, contato.razao_social, contato.cnpj, contato.tipo_id, contato.end_uf, contato.end_cidade, contato.end_cep], ['Vidros Norte', 'Vidros Norte LTDA', '57248237000103', 1, 'Minas Gerais', 'Contagem', '32000-000']);
    const doc = ctx.tabelas.documentos_recebidos[0];
    assert.deepEqual([doc.tipo, doc.origem, doc.competencia, doc.contato_id, doc.valor_total, doc.cfops, doc.protocolo], ['nfe', 'xml', '2026-08', contato.id, 1200, '5102', '131260000012345']);
    const arquivo = ctx.tabelas.contabil_arquivos[0];
    assert.deepEqual([arquivo.categoria, arquivo.origem, arquivo.completo, arquivo.competencia, arquivo.partes], ['xml_nfe', 'oficial', true, '2026-08', 1]);
    assert.equal(arquivo.sha256.length, 64);
    assert.deepEqual(ctx.tabelas.contabil_arquivo_vinculos.map(v => [v.alvo_tipo, v.alvo_id]), [['documento_recebido', String(doc.id)]]);
    const titulo = ctx.tabelas.titulos_pagar[0];
    assert.deepEqual([titulo.origem, titulo.documento_recebido_id, titulo.categoria, titulo.valor_total, titulo.descricao], ['nfe', doc.id, 'Aquisição de Bens', 1200, 'NF-e 1/1234 — Vidros Norte']);
    assert.deepEqual(ctx.tabelas.titulo_pagar_parcelas.map(p => [p.numero, p.vencimento, p.valor]), [[1, '2026-09-10', 600], [2, '2026-10-10', 600]]);
    assert.deepEqual(ctx.tabelas.contabil_eventos.map(e => e.tipo), ['titulo_criado', 'fornecedor_cadastrado', 'documento_registrado']);
    assert.equal(ctx.tabelas.contabil_eventos[2].referencia_tipo, 'documento_recebido');

    const deNovo = await ctx.chamar('POST', '/documentos', { tipo: 'nfe', xml: xmlDaNota() });
    assert.equal(deNovo.status, 422);
    assert.deepEqual(deNovo.corpo.bloqueios, ['Esta NF-e já foi registrada.']);
    const previaDeNovo = await ctx.chamar('POST', '/documentos/previa', { xml: xmlDaNota() });
    assert.deepEqual([previaDeNovo.corpo.contato?.id, previaDeNovo.corpo.bloqueios], [contato.id, ['Esta NF-e já foi registrada.']]);

    const ficha = await ctx.chamar('GET', `/documentos/${doc.id}`);
    assert.equal(ficha.status, 200);
    assert.deepEqual([ficha.corpo.documento.rotulo, ficha.corpo.documento.tem_xml, ficha.corpo.documento.titulo.id, ficha.corpo.documento.itens.length, ficha.corpo.arquivos.length], ['NF-e 1/1234', true, titulo.id, 1, 1]);
    const baixado = await ctx.chamar('GET', `/arquivos/${arquivo.id}`);
    assert.equal(Buffer.from(baixado.corpo.base64, 'base64').toString('utf8'), xmlDaNota());
  } finally {
    await ctx.encerrar();
  }
});

test('pagar: juros quando paga a mais, comprovante guardado uma vez só; parcela paga não se paga de novo; estorno libera; conta paga não muda valor nem cancela', async () => {
  const ctx = await montar(cenario({ contatos: [{ id: 7, nome: 'Vidros Norte', cnpj: '57248237000103' }] }));
  try {
    const criada = await ctx.chamar('POST', '/titulos', { descricao: 'Vidros da obra', contato_id: 7, valor_total: '1.200,00', data_emissao: '2026-08-10', quantidade_parcelas: 2, primeiro_vencimento: '2026-08-20' });
    assert.equal(criada.status, 200, JSON.stringify(criada.corpo));
    const [p1, p2] = ctx.tabelas.titulo_pagar_parcelas;
    assert.deepEqual([p1.vencimento, p2.vencimento, p1.valor, p2.valor], ['2026-08-20', '2026-09-20', 600, 600]);

    const pago = await ctx.chamar('POST', `/parcelas/${p1.id}/pagar`, { data_pagamento: '2026-08-22', valor_pago: '612,00', forma: 'Pix', comprovante: { nome: 'pix.pdf', tipo: 'application/pdf', base64: PDF } });
    assert.equal(pago.status, 200, JSON.stringify(pago.corpo));
    assert.deepEqual([pago.corpo.pagamento.juros, pago.corpo.pagamento.desconto, pago.corpo.aviso], [12, 0, null]);
    assert.deepEqual(ctx.tabelas.contabil_arquivo_vinculos.map(v => v.alvo_tipo).sort(), ['pagamento', 'titulo']);

    const deNovo = await ctx.chamar('POST', `/parcelas/${p1.id}/pagar`, { data_pagamento: '2026-08-22', valor_pago: 600, forma: 'Pix' });
    assert.equal(deNovo.status, 409);
    assert.match(deNovo.corpo.error, /já foi paga em 22\/08\/2026/);
    const futuro = await ctx.chamar('POST', `/parcelas/${p2.id}/pagar`, { data_pagamento: '2099-01-01', valor_pago: 600, forma: 'Pix' });
    assert.equal(futuro.status, 400);

    // O mesmo PDF na segunda parcela: o arquivo é reaproveitado, só ganha vínculo.
    const segunda = await ctx.chamar('POST', `/parcelas/${p2.id}/pagar`, { data_pagamento: '2026-09-18', valor_pago: 590, forma: 'Boleto', comprovante: { nome: 'outro-nome.pdf', tipo: 'application/pdf', base64: PDF } });
    assert.equal(segunda.status, 200);
    assert.equal(segunda.corpo.pagamento.desconto, 10);
    assert.equal(ctx.tabelas.contabil_arquivos.length, 1, 'mesmo sha256 = mesmo arquivo');
    assert.equal(ctx.tabelas.contabil_arquivo_vinculos.length, 3);

    const mudarValor = await ctx.chamar('PUT', `/titulos/${criada.corpo.id}`, { valor_total: 1300, parcelas: [{ vencimento: '2026-08-20', valor: 650 }, { vencimento: '2026-09-20', valor: 650 }] });
    assert.equal(mudarValor.status, 409);
    const mudarNome = await ctx.chamar('PUT', `/titulos/${criada.corpo.id}`, { descricao: 'Vidros temperados da obra', categoria: 'Aquisição de Bens' });
    assert.equal(mudarNome.status, 200);
    assert.deepEqual(mudarNome.corpo.alterado, ['Descrição', 'Categoria']);
    const cancelar = await ctx.chamar('POST', `/titulos/${criada.corpo.id}/cancelar`, { motivo: 'Lançada em dobro' });
    assert.equal(cancelar.status, 409);

    const detalhe = await ctx.chamar('GET', `/titulos/${criada.corpo.id}`);
    assert.deepEqual([detalhe.corpo.titulo.situacao, detalhe.corpo.titulo.pago, detalhe.corpo.arquivos.length], ['pago', 1202, 1]);
    assert.ok(detalhe.corpo.historico.some(e => e.tipo === 'titulo_alterado'));

    const pagamentoId = ctx.tabelas.titulo_pagar_pagamentos[1].id;
    const semMotivo = await ctx.chamar('POST', `/pagamentos/${pagamentoId}/estornar`, { motivo: '' });
    assert.equal(semMotivo.status, 400);
    const estornado = await ctx.chamar('POST', `/pagamentos/${pagamentoId}/estornar`, { motivo: 'Valor errado' });
    assert.equal(estornado.status, 200);
    const outra = await ctx.chamar('POST', `/parcelas/${p2.id}/pagar`, { data_pagamento: '2026-09-18', valor_pago: 600, forma: 'Boleto' });
    assert.equal(outra.status, 200, 'estornado libera a parcela');

    const lista = await ctx.chamar('GET', '/titulos?visao=pagas&competencia=2026-09');
    assert.deepEqual(lista.corpo.linhas.map(l => [l.numero, l.pagamento.valor_pago]), [[2, 600]]);
    assert.deepEqual(lista.corpo.totais.pago_no_mes, { quantidade: 1, total: 600 });
    assert.ok(lista.corpo.formas.includes('Pix') && lista.corpo.categorias.includes('Aquisição de Bens'));
  } finally {
    await ctx.encerrar();
  }
});

test('competência fechada recusa pagamento, lançamento e documento nela', async () => {
  const ctx = await montar(cenario({ competencia_contabil: [{ id: 1, competencia: '2026-08', status: 'fechada' }] }));
  try {
    const conta = await ctx.chamar('POST', '/titulos', { descricao: 'Aluguel', valor_total: 2000, competencia: '2026-08', quantidade_parcelas: 1, primeiro_vencimento: '2026-08-05' });
    assert.equal(conta.status, 409);
    assert.match(conta.corpo.error, /agosto\/2026 está fechada/);
    assert.equal(conta.corpo.competencia_fechada, '2026-08');
    const setembro = await ctx.chamar('POST', '/titulos', { descricao: 'Aluguel', valor_total: 2000, competencia: '2026-09', quantidade_parcelas: 1, primeiro_vencimento: '2026-08-05' });
    assert.equal(setembro.status, 200);
    const parcela = ctx.tabelas.titulo_pagar_parcelas[0];
    const pagoEmAgosto = await ctx.chamar('POST', `/parcelas/${parcela.id}/pagar`, { data_pagamento: '2026-08-05', valor_pago: 2000, forma: 'TED/DOC' });
    assert.equal(pagoEmAgosto.status, 409);
    assert.match(pagoEmAgosto.corpo.error, /reabra-a para registrar pagamentos nela/);
    const doc = await ctx.chamar('POST', '/documentos', { tipo: 'nfe', xml: xmlDaNota() });
    assert.equal(doc.status, 409);
  } finally {
    await ctx.encerrar();
  }
});

test('NFS-e do pagamento de comissão: liga ao pagamento (não vira conta) e a pendência some; excluir documento cancela a conta dele', async () => {
  const ctx = await montar(cenario());
  try {
    const antes = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.ok(antes.corpo.pendencias.some(p => p.chave === 'nfse_fech_70'), JSON.stringify(antes.corpo.pendencias.map(p => p.chave)));
    const pagos = await ctx.chamar('GET', '/fechamentos-pagos');
    assert.deepEqual(pagos.corpo.pagamentos.map(p => [p.id, p.rotulo, p.falta]), [[70, 'Comissões de julho/2026 — Ana (CMS)', 1000]]);

    const nfse = await ctx.chamar('POST', '/documentos', {
      tipo: 'nfse', numero: '45', municipio: 'Contagem', emitente_documento: '12345678909', emitente_nome: 'Ana Souza', data_emissao: '2026-08-09',
      valor_total: '1.000,00', valor_iss: 50, financeiro_pagamento_id: 70, gerar_titulo: true, arquivo: { nome: 'nfse45.pdf', tipo: 'application/pdf', base64: PDF }
    });
    assert.equal(nfse.status, 200, JSON.stringify(nfse.corpo));
    assert.equal(nfse.corpo.titulo_id, null, 'NFS-e de fechamento não vira conta');
    assert.equal(ctx.tabelas.contatos[0].tipo_id, 2, 'o prestador vira "Prestador de serviço"');
    assert.equal(ctx.tabelas.contatos[0].tipo_pessoa, 'PF');
    assert.equal(ctx.tabelas.contabil_arquivos[0].categoria, 'nfse');
    const depois = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.equal(depois.corpo.pendencias.some(p => p.chave === 'nfse_fech_70'), false);
    assert.equal(depois.corpo.fontes.find(f => f.chave === 'documentos_recebidos').estado, 'ok');

    const recibo = await ctx.chamar('POST', '/documentos', { tipo: 'outro', especie: 'recibo', descricao: 'Frete da chapa', emitente_nome: 'João Frete', data_emissao: '2026-08-12', valor_total: 150, gerar_titulo: true, titulo: { primeiro_vencimento: '2026-08-12' } });
    assert.equal(recibo.status, 200);
    assert.ok(recibo.corpo.titulo_id);
    const semArquivo = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.ok(semArquivo.corpo.pendencias.some(p => p.chave === `docrec_sem_arquivo_${recibo.corpo.id}`));
    const excluido = await ctx.chamar('POST', `/documentos/${recibo.corpo.id}/excluir`, { motivo: 'Lançado errado' });
    assert.equal(excluido.status, 200);
    assert.deepEqual(excluido.corpo.contas_canceladas, [recibo.corpo.titulo_id]);
    assert.equal(ctx.tabelas.titulos_pagar.find(t => t.id === recibo.corpo.titulo_id).status, 'cancelado');

    const evid = await ctx.chamar('GET', '/evidencias?competencia=2026-08');
    assert.equal(evid.status, 200);
    assert.deepEqual(evid.corpo.itens.map(i => [i.grupo, i.titulo, i.origem, i.falta]), [['recebidos', 'NFS-e 45', 'fornecido', false]]);
  } finally {
    await ctx.encerrar();
  }
});

test('evidências: o XML das notas de saída e de devolução sai por aqui; anexar à competência e excluir com motivo', async () => {
  const ctx = await montar(cenario({
    pedidos: [{ id: 1, numero: '2540' }],
    notas_fiscais: [{ id: 10, pedido_id: 1, serie: 2, numero: 10, status_fiscal: 'autorizada', valor_total: 1500, data_emissao: '2026-08-05T10:00:00-03:00', xml_autorizado: '<nfeProc>saida</nfeProc>', chave_acesso: '3126' }],
    notas_devolucao: [{ id: 4, pedido_id: 1, serie: 1, numero: 5, data_emissao: '2026-08-25', valor_total: 300, xml: '<nfeProc>dev</nfeProc>', chave_acesso: '9999', protocolo: '1' }]
  }));
  try {
    const anexo = await ctx.chamar('POST', '/arquivos', { nome: 'contrato.pdf', tipo: 'application/pdf', base64: PDF, categoria: 'contrato', descricao: 'Contrato de aluguel', competencia: '2026-08', vinculos: [{ alvo_tipo: 'competencia', alvo_id: '2026-08' }] });
    assert.equal(anexo.status, 200);
    const evid = await ctx.chamar('GET', '/evidencias?competencia=2026-08');
    assert.deepEqual(evid.corpo.itens.map(i => [i.grupo, i.titulo]), [['saida', 'NF-e 2/10'], ['devolucao', 'NF-e de devolução 1/5'], ['outros', 'Contrato de aluguel']]);
    const xml = await ctx.chamar('GET', '/evidencias/xml/saida/10');
    assert.equal(Buffer.from(xml.corpo.base64, 'base64').toString('utf8'), '<nfeProc>saida</nfeProc>');
    const dev = await ctx.chamar('GET', '/evidencias/xml/devolucao/4');
    assert.equal(dev.corpo.nome, 'NFe-devolucao-9999.xml');
    const semMotivo = await ctx.chamar('POST', `/arquivos/${anexo.corpo.id}/excluir`, { motivo: 'x' });
    assert.equal(semMotivo.status, 400);
    const excluido = await ctx.chamar('POST', `/arquivos/${anexo.corpo.id}/excluir`, { motivo: 'Contrato errado' });
    assert.equal(excluido.status, 200);
    const depois = await ctx.chamar('GET', '/evidencias?competencia=2026-08');
    assert.equal(depois.corpo.itens.length, 2);
    assert.ok(ctx.tabelas.contabil_eventos.some(e => e.tipo === 'arquivo_excluido' && /Contrato errado/.test(e.descricao)));
  } finally {
    await ctx.encerrar();
  }
});

test('permissões: cada rota nova pede a sua; registrar com conta pede as duas', async () => {
  const ctx = await montar(cenario(), { permitir: ['contabilidade.view', 'contabilidade.documento.registrar'] });
  try {
    assert.equal((await ctx.chamar('GET', '/titulos')).status, 200);
    assert.equal((await ctx.chamar('GET', '/documentos')).status, 200);
    assert.equal((await ctx.chamar('GET', '/fornecedores')).status, 200);
    const comConta = await ctx.chamar('POST', '/documentos', { tipo: 'nfe', xml: xmlDaNota(), gerar_titulo: true });
    assert.equal(comConta.status, 403);
    assert.deepEqual(comConta.corpo.pedidas, ['contabilidade.documento.registrar', 'contabilidade.pagar.lancar']);
    const pedidas = async (metodo, caminho, corpo) => (await ctx.chamar(metodo, caminho, corpo)).corpo.pedidas;
    assert.deepEqual(await pedidas('POST', '/titulos', {}), ['contabilidade.pagar.lancar']);
    assert.deepEqual(await pedidas('PUT', '/titulos/1', {}), ['contabilidade.pagar.lancar']);
    assert.deepEqual(await pedidas('POST', '/titulos/1/cancelar', {}), ['contabilidade.pagar.estornar']);
    assert.deepEqual(await pedidas('POST', '/parcelas/1/pagar', {}), ['contabilidade.pagar.pagar']);
    assert.deepEqual(await pedidas('POST', '/pagamentos/1/estornar', {}), ['contabilidade.pagar.estornar']);
    assert.deepEqual(await pedidas('POST', '/documentos/1/excluir', {}), ['contabilidade.documento.excluir']);
    assert.deepEqual(await pedidas('POST', '/arquivos/1/excluir', {}), ['contabilidade.documento.excluir']);
  } finally {
    await ctx.encerrar();
  }
});

test('sem o SQL das etapas 2 e 3: as rotas respondem 409 dizendo qual arquivo rodar; o painel mostra as fontes como "falta o SQL"', async () => {
  const dados = cenario();
  for (const t of ['contabil_arquivos', 'contabil_arquivo_partes', 'contabil_arquivo_vinculos', 'documentos_recebidos', 'titulos_pagar', 'titulo_pagar_parcelas', 'titulo_pagar_pagamentos']) delete dados[t];
  const ctx = await montar(dados);
  try {
    const r = await ctx.chamar('GET', '/titulos');
    assert.equal(r.status, 409);
    assert.equal(r.corpo.sql_pendente, true);
    assert.match(r.corpo.error, /sql\/contabilidade_contas_pagar\.sql/);
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.equal(painel.status, 200);
    assert.match(painel.corpo.fontes.find(f => f.chave === 'contas_pagar').nota, /contabilidade_contas_pagar\.sql/);
    const evid = await ctx.chamar('GET', '/evidencias?competencia=2026-08');
    assert.equal(evid.corpo.sql_pendente, true);
  } finally {
    await ctx.encerrar();
  }
});
