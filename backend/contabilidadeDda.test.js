/**
 * Contabilidade — fase H (02/10/2026): os boletos contra a empresa (DDA do
 * BB), pelas rotas, com a API genérica de mentira, a guarda de permissão de
 * mentira, um certificado A1 de teste e o BB de mentira (OAuth + GET /boletos).
 *
 * O que fica preso:
 *   - o cartão do DDA usa as credenciais do cartão do Extrato (mesma
 *     aplicação do portal), o certificado nos dois ambientes e o escopo
 *     dda-info; a janela de dias passa de 1 ano = 400;
 *   - a busca grava só os dados (com o JSON original), liga sozinha a conta
 *     de mesma linha digitável e a de mesmo CNPJ + valor + vencimento (e
 *     completa a linha digitável da parcela), e a conciliação roda depois: o
 *     débito do boleto liquidado sem conta vira a conta do boleto, paga; o do
 *     boleto liquidado ligado a uma parcela paga a parcela;
 *   - a busca seguinte guarda a mudança de estado e marca o que sumiu;
 *   - a tela: lista, detalhe com a conta já preenchida (a nota sugerida),
 *     lançar e ligar, contestar e restaurar, desligar, espelho;
 *   - o painel: boleto sem conta (aviso) e pagamento por boleto sem o boleto
 *     (documental, com o DDA ligado);
 *   - desfazer a conciliação devolve o boleto para "sem conta";
 *   - permissões e "falta o SQL da fase H".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { gerarPfx } = require('./fiscal/certificadoDeTeste');
const calculo = require('./cobranca/boletoCalculo');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;
const semNbsp = t => String(t).replace(/ /g, ' ');
const EMPRESA = '11444777000161';
const VIDROS = '57248237000103';
const IMOBILIARIA = '23132546000100';
const MADEIREIRA = '84031759000121';
const SERVICOS_X = '11222333000181';
const AGORA = Date.parse('2026-09-15T12:00:00-03:00');
const barras = (vencimento, valor, n) => calculo.codigoBarras({ vencimento, valor, campoLivre: String(n).padStart(25, '0'), banco: '237' });
const linha = codigo => calculo.linhaDigitavel(codigo).digitos;

const COD_A = barras('2026-09-10', 2500, 1);
const COD_B = barras('2026-09-21', 1800, 2);
const COD_C = barras('2026-09-05', 640, 3);
const COD_D = barras('2026-10-10', 999, 4);
const COD_E = barras('2026-09-25', 120, 5);

const COLUNAS = {
  contabil_parametros: ['id', 'chave', 'valor'],
  pedidos: ['id', 'numero', 'situacao', 'cliente_id'], notas_fiscais: ['id'], notas_devolucao: ['id'],
  configuracao_fiscal: ['id', 'cnpj', 'uf', 'razao_social'], configuracao_cobranca: ['id'],
  financeiro_fechamentos: ['id'], financeiro_fechamento_itens: ['id'], financeiro_pagamentos: ['id'],
  usuarios: ['id', 'nome'],
  contatos: ['id', 'nome', 'cnpj', 'cpf'],
  competencia_contabil: ['id', 'competencia', 'status'], contabil_pendencias_resolucoes: ['id', 'competencia', 'chave'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em', 'referencia_tipo', 'referencia_id'],
  contabil_arquivos: ['id'], contabil_arquivo_vinculos: ['id', 'arquivo_id', 'alvo_tipo', 'alvo_id'],
  documentos_recebidos: ['id', 'tipo', 'origem', 'numero', 'serie', 'emitente_nome', 'emitente_documento', 'contato_id', 'data_emissao', 'competencia', 'valor_total',
    'valor_iss', 'iss_retido', 'valor_retencoes', 'financeiro_pagamento_id', 'sem_pagamento', 'excluido_em', 'cfops'],
  titulos_pagar: ['id', 'contato_id', 'documento_recebido_id', 'descricao', 'categoria', 'numero_documento', 'data_emissao', 'competencia', 'valor_total', 'status', 'origem', 'observacao',
    'criado_por', 'criado_em', 'atualizado_em', 'cancelado_em', 'cancelado_por', 'motivo_cancelamento'],
  titulo_pagar_parcelas: ['id', 'titulo_id', 'numero', 'vencimento', 'valor', 'linha_digitavel'],
  titulo_pagar_pagamentos: ['id', 'parcela_id', 'titulo_id', 'data_pagamento', 'competencia', 'valor_pago', 'valor_juros', 'valor_desconto', 'forma', 'observacao', 'criado_por', 'criado_em',
    'estornado_em', 'estornado_por', 'motivo_estorno'],
  contas_financeiras: ['id', 'nome', 'tipo', 'banco_codigo', 'agencia', 'agencia_dv', 'conta', 'ativa'],
  extrato_importacoes: ['id', 'conta_id', 'origem', 'status', 'periodo_inicio', 'periodo_fim', 'saldo_final', 'saldo_final_data'],
  movimentos_bancarios: ['id', 'conta_id', 'importacao_id', 'data', 'competencia', 'valor', 'tipo', 'descricao', 'documento', 'identificador', 'contrapartida_documento', 'hash',
    'estado_conciliacao', 'conciliacao_diferenca', 'conciliacao_observacao', 'conciliado_em', 'conciliado_por'],
  conciliacao_vinculos: ['id', 'movimento_id', 'alvo_tipo', 'alvo_id', 'valor', 'criterio', 'detalhe', 'criado_por', 'criado_em', 'desfeito_em', 'desfeito_por', 'motivo_desfazer'],
  contabil_integracoes: ['id', 'chave', 'ativa', 'ambiente', 'automatica', 'intervalo_min', 'parametros', 'ultimo_nsu', 'max_nsu', 'proxima_consulta_apos', 'ultima_execucao_em', 'ultimo_sucesso_em', 'ultimo_erro', 'atualizado_em', 'atualizado_por'],
  contabil_integracao_execucoes: ['id', 'integracao', 'tipo', 'chave', 'maquina', 'usuario_id', 'iniciado_em', 'concluido_em', 'resumo', 'resultado', 'erro'],
  contabil_dfe_recebidos: ['id', 'origem', 'tipo', 'chave', 'status', 'data_emissao', 'situacao_nota'],
  contabil_dda_boletos: ['id', 'chave_interna', 'ambiente', 'pagador_documento', 'beneficiario_documento', 'beneficiario_tipo', 'beneficiario_nome', 'beneficiario_final_documento',
    'beneficiario_final_tipo', 'beneficiario_final_nome', 'seu_numero', 'codigo_barras', 'linha_digitavel', 'data_registro', 'vencimento', 'valor', 'estado_bb', 'estados', 'json_original',
    'capturado_em', 'visto_em', 'sumiu_em', 'situacao', 'titulo_id', 'parcela_id', 'documento_recebido_id', 'vinculo_criterio', 'vinculado_em', 'vinculado_por', 'motivo',
    'decidido_em', 'decidido_por', 'atualizado_em']
};

/** O tamanho das colunas de texto do SQL da fase H (o Postgres recusa o que passa: 22001). */
const LIMITES = {
  contabil_dda_boletos: {
    chave_interna: 64, ambiente: 12, pagador_documento: 14, beneficiario_documento: 14, beneficiario_tipo: 1, beneficiario_nome: 200, beneficiario_final_documento: 14,
    beneficiario_final_tipo: 1, beneficiario_final_nome: 200, seu_numero: 15, codigo_barras: 44, linha_digitavel: 47, situacao: 12, vinculo_criterio: 30
  },
  titulos_pagar: { descricao: 200, categoria: 80, numero_documento: 60, competencia: 7, status: 12, origem: 10 },
  titulo_pagar_parcelas: { linha_digitavel: 60 },
  titulo_pagar_pagamentos: { competencia: 7, forma: 30 },
  conciliacao_vinculos: { alvo_tipo: 30, criterio: 20 },
  contabil_eventos: { tipo: 40, competencia: 7, referencia_tipo: 30 },
  contabil_integracao_execucoes: { integracao: 30, tipo: 12, chave: 80, maquina: 80, resumo: 500 }
};
const passaDoLimite = (tabela, linha) => Object.entries(LIMITES[tabela] || {}).find(([coluna, max]) => typeof linha[coluna] === 'string' && linha[coluna].length > max) || null;

const UNICOS = {
  conciliacao_vinculos: (n, l) => l.some(r => !r.desfeito_em && String(r.movimento_id) === String(n.movimento_id) && r.alvo_tipo === n.alvo_tipo && String(r.alvo_id) === String(n.alvo_id)),
  titulo_pagar_pagamentos: (n, l) => l.some(r => String(r.parcela_id) === String(n.parcela_id) && !r.estornado_em),
  contabil_integracao_execucoes: (n, l) => l.some(r => r.chave === n.chave),
  contabil_dda_boletos: (n, l) => l.some(r => r.chave_interna === n.chave_interna)
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
        if (passaDoLimite(tabela, linha)) return responder(500, { error: `value too long for type character varying (${passaDoLimite(tabela, linha)[0]})` });
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
        if (passaDoLimite(tabela, novo)) return responder(500, { error: `value too long for type character varying (${passaDoLimite(tabela, novo)[0]})` });
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

// ------------------------------------------------------------------ o BB de mentira

const json = (status, dados) => ({ status, corpo: Buffer.from(JSON.stringify(dados)) });
const item = ({ cnpj, nome, venc, valor, codigo, seu = '' }) => ({
  objetoObrigacao: {
    valorVencimentoObrigacao: valor, codigoIdentificadorDocumentoCobranca: seu,
    numeroIdentificadorBeneficiario: cnpj, codigoTipoPessoaBeneficiario: 'J', nomeBeneficiarioObrigacao: nome,
    codigoTipoPessoaBeneficiarioFim: 'J', numeroIdentificadorBeneficiarioFim: cnpj, nomeBeneficiarioFimObrigacao: nome,
    dataRegistroObrigacao: '20/08/2026', dataVencimentoObrigacao: venc, textoCodigoBarrasObrigacao: codigo
  }
});
const A = item({ cnpj: VIDROS, nome: 'VIDROS NORTE LTDA', venc: '10/09/2026', valor: 2500, codigo: COD_A, seu: 'NF 4521/1' });
const B = item({ cnpj: IMOBILIARIA, nome: 'IMOBILIARIA CENTRO LTDA', venc: '21/09/2026', valor: 1800, codigo: COD_B });
const C = item({ cnpj: MADEIREIRA, nome: 'MADEIREIRA IPE LTDA', venc: '05/09/2026', valor: 640, codigo: COD_C });
const D = item({ cnpj: VIDROS, nome: 'VIDROS NORTE LTDA', venc: '10/10/2026', valor: 999, codigo: COD_D, seu: 'NF 77' });
const E = item({ cnpj: SERVICOS_X, nome: 'SERVICOS X LTDA', venc: '25/09/2026', valor: 120, codigo: COD_E });

/** Rodada 1: A e C liquidados; B, D e E a pagar. Rodada 2: B liquidado; E sumiu. */
function redeDeMentira(chamadas, estado) {
  return (cert, { destino } = {}) => async (url, { metodo = 'GET', corpo = null, cabecalhos = {} } = {}) => {
    chamadas.push({ url, metodo, corpo: String(corpo ?? ''), cabecalhos, comCertificado: Boolean(cert?.certificadoPem), destino });
    if (url.includes('/oauth/token')) return json(200, { access_token: 'tk', token_type: 'Bearer', expires_in: 600, scope: 'dda-info' });
    if (url.includes('/v1/boletos')) {
      const e = Number(new URL(url).searchParams.get('codigoEstadoObrigacao'));
      const lista = estado.rodada === 1
        ? { 1: [B, D, E], 2: [], 3: [A, C] }[e]
        : { 1: [D], 2: [], 3: [A, B, C] }[e];
      if (!lista.length) return json(404, { erros: [{ mensagemErro: 'Nenhum boleto encontrado' }] });
      return json(200, { indicadorContinuidade: 'N', quantidadeListaTitulo: lista.length, numeroProximoRegistro: 0, numeroIdentificadorPagador: EMPRESA, codigoTipoPessoaPagador: 'J', codigoEstadoObrigacao: e, listaTitulo: lista });
    }
    return json(500, { erro: `rota de mentira sem resposta: ${url}` });
  };
}

// ------------------------------------------------------------------ montagem

const MODULOS = [
  './apiHttpClient', './permissionsController', './contabilidadeController', './contabilidade/checklist', './contabilidade/base', './contabilidade/eventos',
  './contabilidade/titulos', './contabilidade/documentosRecebidos', './contabilidade/extrato/extrato', './contabilidade/conciliacao/conciliacao',
  './contabilidade/conciliacao/liquidacoes', './contabilidade/dda/dda', './contabilidade/dda/espelho', './fiscal/configuracaoFiscal',
  './contabilidade/integracoes/rotas', './contabilidade/integracoes/servico', './contabilidade/integracoes/configuracao', './contabilidade/integracoes/execucoes',
  './contabilidade/integracoes/segredos', './contabilidade/integracoes/entrada'
];

function cenario(extra = {}) {
  const integ = (id, chave, parametros, intervalo, ativa = false) => ({ id, chave, ativa, ambiente: 'homologacao', automatica: false, intervalo_min: intervalo, parametros: JSON.stringify(parametros) });
  return {
    pedidos: [], notas_fiscais: [], notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: EMPRESA, uf: 'MG', razao_social: 'SANTISSIMO DECOR LTDA' }], configuracao_cobranca: [],
    financeiro_fechamentos: [], financeiro_fechamento_itens: [], financeiro_pagamentos: [], usuarios: [{ id: 3, nome: 'Henrique' }],
    contatos: [{ id: 7, nome: 'Vidros Norte', cnpj: '57.248.237/0001-03' }, { id: 8, nome: 'Imobiliária Centro', cnpj: IMOBILIARIA }],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [], contabil_arquivos: [], contabil_arquivo_vinculos: [],
    documentos_recebidos: [{ id: 77, tipo: 'nfe', origem: 'sefaz', numero: '77', emitente_nome: 'Vidros Norte LTDA', emitente_documento: VIDROS, contato_id: 7, data_emissao: '2026-09-01', competencia: '2026-09', valor_total: 999, iss_retido: false, sem_pagamento: false }],
    titulos_pagar: [
      { id: 1, contato_id: 7, descricao: 'NF-e 4521 — Vidros Norte', competencia: '2026-08', valor_total: 2500, status: 'aberto', origem: 'nfe', categoria: null },
      { id: 2, contato_id: 8, descricao: 'Aluguel de setembro', competencia: '2026-09', valor_total: 1800, status: 'aberto', origem: 'manual', categoria: null },
      { id: 3, contato_id: null, descricao: 'Material de limpeza', competencia: '2026-09', valor_total: 90, status: 'aberto', origem: 'manual', categoria: null }
    ],
    titulo_pagar_parcelas: [
      { id: 11, titulo_id: 1, numero: 1, vencimento: '2026-09-10', valor: 2500, linha_digitavel: null },
      { id: 21, titulo_id: 2, numero: 1, vencimento: '2026-09-20', valor: 1800, linha_digitavel: linha(COD_B) },
      { id: 31, titulo_id: 3, numero: 1, vencimento: '2026-09-03', valor: 90, linha_digitavel: null }
    ],
    titulo_pagar_pagamentos: [{ id: 301, parcela_id: 31, titulo_id: 3, data_pagamento: '2026-09-03', competencia: '2026-09', valor_pago: 90, valor_juros: 0, valor_desconto: 0, forma: 'Boleto' }],
    contas_financeiras: [{ id: 1, nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1614', agencia_dv: '4', conta: '167738', ativa: true }],
    extrato_importacoes: [],
    movimentos_bancarios: [
      { id: 501, conta_id: 1, data: '2026-09-06', competencia: '2026-09', valor: -640, tipo: 'debito', descricao: 'PAGAMENTO DE BOLETO MADEIREIRA IPE', hash: 'h1', estado_conciliacao: 'pendente' },
      { id: 502, conta_id: 1, data: '2026-09-10', competencia: '2026-09', valor: -2500, tipo: 'debito', descricao: 'PAGTO TITULO', hash: 'h2', estado_conciliacao: 'pendente' }
    ],
    conciliacao_vinculos: [],
    contabil_integracoes: [
      integ(2, 'bb_extrato', { usar_credenciais_da_cobranca: false, client_id_homologacao: 'cid', app_key_homologacao: 'app', conta_id: 1, agencia: '1614', conta: '16773', homologacao_agencia: '452', homologacao_conta: '123873' }, 1440),
      integ(5, 'bb_dda', { usar_credenciais_do_extrato: true, escopo: 'dda-info', mtls: 'sim', dias_para_tras: 60, dias_para_frente: 180, buscar_a_pagar: true, buscar_agendados: true, buscar_liquidados: true }, 720)
    ],
    contabil_integracao_execucoes: [], contabil_dfe_recebidos: [], contabil_dda_boletos: [],
    ...extra
  };
}

const PFX = gerarPfx({ cn: `SANTISSIMO DECOR LTDA:${EMPRESA}` });

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
  const segredosBanco = { certificado: { pfxBase64: PFX.toString('base64'), senha: 'segredo' }, bb_extrato_client_secret_homologacao: { secret: 'sec' } };
  const banco = {
    disponivel: true,
    ler: async (_api, nome) => (segredosBanco[nome] ? { valor: segredosBanco[nome], atualizadoEm: '2026-09-01T00:00:00Z' } : null),
    guardar: async (_api, nome, valor) => { segredosBanco[nome] = valor; return true; },
    remover: async (_api, nome) => { delete segredosBanco[nome]; return true; }
  };
  const cofre = { temCofre: true, fonte: () => null, lerSegredo: () => null, guardarSegredo: () => true, removerSegredo: () => true };
  const chamadas = [];
  const estadoRede = { rodada: 1 };
  const servico = require('./contabilidade/integracoes/servico').criar({ env: { BANCO: 'DEV' }, cofre, banco, transporteFabrica: redeDeMentira(chamadas, estadoRede), agora: () => AGORA });
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use('/api/contabilidade', require('./contabilidade/integracoes/rotas').criarRouter({ servico }));
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
    chamar, tabelas: upstream.tabelas, chamadas, estadoRede,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

const boletoDe = (ctx, codigo) => ctx.tabelas.contabil_dda_boletos.find(x => x.codigo_barras === codigo);

test('DDA: o cartão usa as credenciais do Extrato; a busca grava só os dados, liga sozinha as contas e a conciliação paga o que o DDA diz liquidado', async () => {
  const ctx = await montar(cenario());
  try {
    const antes = await ctx.chamar('GET', '/integracoes');
    const cartao = antes.corpo.integracoes.find(i => i.chave === 'bb_dda');
    assert.deepEqual([cartao.fase, cartao.vezes_por_dia, cartao.credenciais_de, cartao.pronta, cartao.pendencias], ['H', true, 'bb_extrato', true, []]);
    assert.deepEqual([cartao.credenciais.origem, cartao.credenciais.client_id, cartao.credenciais.secret_guardado], ['extrato', 'cid', true]);
    assert.ok(!JSON.stringify(antes.corpo).includes('"sec"'), 'o secret nunca volta numa resposta');

    // A janela passa de 1 ano: recusada.
    const longa = await ctx.chamar('PUT', '/integracoes/bb_dda', { parametros: { dias_para_tras: 300, dias_para_frente: 100 } });
    assert.equal(longa.status, 400);
    assert.match(longa.corpo.error, /no máximo 365 somados.*hoje dá 400/);
    const nenhum = await ctx.chamar('PUT', '/integracoes/bb_dda', { parametros: { buscar_a_pagar: false, buscar_agendados: false, buscar_liquidados: false } });
    assert.match(nenhum.corpo.error, /Marque ao menos um estado/);
    // Duas vezes por dia = a cada 720 minutos.
    const ligar = await ctx.chamar('PUT', '/integracoes/bb_dda', { ativa: true, automatica: true, intervalo_min: 720 });
    assert.equal(ligar.status, 200, JSON.stringify(ligar.corpo));

    const r = await ctx.chamar('POST', '/integracoes/bb_dda/sincronizar', {});
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.match(semNbsp(r.corpo.resumo), /^5 boletos no DDA com vencimento de 17\/07\/2026 a 14\/03\/2027 \(3 a pagar, 2 liquidados\) · 5 novos · 2 ligados sozinhos às contas \(1 linha digitável completada\)/);
    assert.match(semNbsp(r.corpo.resumo), /2 lançamentos conciliados sozinhos \(1 conta paga, 1 boleto do DDA lançado e pago\)/);

    // A chamada ao BB: o gateway mTLS do DDA, as credenciais do Extrato, o escopo, a app key e o certificado.
    const token = ctx.chamadas.find(x => x.url.includes('/oauth/token'));
    assert.equal(token.cabecalhos.Authorization, `Basic ${Buffer.from('cid:sec').toString('base64')}`);
    assert.match(token.corpo, /scope=dda-info/);
    const consultas = ctx.chamadas.filter(x => x.url.includes('/boletos'));
    assert.equal(consultas.length, 3, 'uma consulta por estado');
    const q = new URL(consultas[0].url);
    assert.equal(`${q.host}${q.pathname}`, 'dda.mtls.api.hm.bb.com.br/v1/boletos');
    assert.deepEqual([q.searchParams.get('gw-dev-app-key'), q.searchParams.get('dataVencimentoInicial'), q.searchParams.get('dataVencimentoFinal')], ['app', '17/07/2026', '14/03/2027']);
    assert.ok(ctx.chamadas.every(x => x.comCertificado), 'o certificado da empresa nos dois ambientes');
    assert.ok(consultas.every(x => !x.cabecalhos['x-br-com-bb-ipa-mciteste']), 'sem massa de teste informada, o cabeçalho não vai');

    // Só os dados (e o JSON original); a chave é do app.
    const [a, b, c, d, e] = [COD_A, COD_B, COD_C, COD_D, COD_E].map(cod => boletoDe(ctx, cod));
    assert.equal(ctx.tabelas.contabil_dda_boletos.length, 5);
    assert.match(a.chave_interna, /^[0-9a-f]{64}$/);
    assert.deepEqual([a.estado_bb, a.situacao, a.parcela_id, a.vinculo_criterio, a.linha_digitavel, a.seu_numero, a.ambiente], [3, 'vinculado', 11, 'cnpj_valor_vencimento', linha(COD_A), 'NF 4521/1', 'homologacao']);
    assert.equal(JSON.parse(a.json_original).objeto.textoCodigoBarrasObrigacao, COD_A);
    assert.equal(ctx.tabelas.titulo_pagar_parcelas.find(p => p.id === 11).linha_digitavel, linha(COD_A), 'a linha digitável da parcela foi completada');
    assert.deepEqual([b.situacao, b.parcela_id, b.vinculo_criterio], ['vinculado', 21, 'linha_digitavel']);
    assert.deepEqual([d.situacao, e.situacao], ['novo', 'novo'], 'boleto a pagar sem conta nunca vira conta sozinho');

    // A conciliação: o débito de 06/09 virou a conta do boleto C (paga, ligada); o de 10/09 pagou a parcela de A.
    const contaC = ctx.tabelas.titulos_pagar.find(t => t.origem === 'dda');
    assert.deepEqual([contaC.descricao, contaC.competencia, Number(contaC.valor_total)], ['Boleto — MADEIREIRA IPE LTDA', '2026-09', 640]);
    assert.deepEqual([c.situacao, c.titulo_id, c.vinculo_criterio], ['vinculado', contaC.id, 'conciliacao']);
    const pagC = ctx.tabelas.titulo_pagar_pagamentos.find(p => p.titulo_id === contaC.id);
    assert.deepEqual([pagC.data_pagamento, Number(pagC.valor_pago), pagC.forma], ['2026-09-06', 640, 'Boleto']);
    assert.deepEqual(ctx.tabelas.conciliacao_vinculos.map(v => [v.movimento_id, v.criterio]).sort(), [[501, 'dda_pago'], [502, 'parcela_paga']]);
    assert.ok(ctx.tabelas.contabil_eventos.some(x => x.tipo === 'dda_vinculado' && x.referencia_tipo === 'titulo' && x.referencia_id === 1));

    // A tela: sem conta (D com a nota sugerida, E), a contagem.
    const lista = await ctx.chamar('GET', '/dda?visao=sem_conta');
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.corpo.linhas.map(l => l.beneficiario_nome), ['SERVICOS X LTDA', 'VIDROS NORTE LTDA']);
    assert.deepEqual([lista.corpo.contagem.total, lista.corpo.contagem.sem_conta, lista.corpo.contagem.ligados, lista.corpo.contagem.com_sugestao], [5, 2, 3, 1]);
    const linhaD = lista.corpo.linhas.find(l => l.beneficiario_nome === 'VIDROS NORTE LTDA');
    assert.deepEqual([linhaD.estado_rotulo, linhaD.sugestoes[0].tipo, linhaD.sugestoes[0].rotulo, linhaD.pode.lancar, linhaD.pode.desligar], ['A pagar', 'documento', 'NF-e 77', true, false]);
    assert.match(linhaD.linha_digitavel, /^\d{5}\.\d{5} /);
    const ligados = await ctx.chamar('GET', '/dda?visao=ligados');
    assert.equal(ligados.corpo.linhas.find(l => l.vinculo?.titulo_id === 1).vinculo.criterio_rotulo, 'mesmo CNPJ, valor e vencimento');

    // Lançar a conta do D (o formulário vem preenchido com a nota 77) — o boleto liga à parcela.
    const det = await ctx.chamar('GET', `/dda/${d.id}`);
    assert.equal(det.status, 200);
    const conta = det.corpo.conta_sugerida;
    assert.deepEqual([conta.descricao, conta.documento_recebido_id, conta.contato_id, conta.competencia, conta.numero_documento], ['NF-e 77 — Vidros Norte', 77, 7, '2026-09', 'NF 77']);
    const lancou = await ctx.chamar('POST', `/dda/${d.id}/lancar`, { ...conta, categoria: '00340 · Compra de Mercadorias' });
    assert.equal(lancou.status, 200, JSON.stringify(lancou.corpo));
    const contaD = ctx.tabelas.titulos_pagar.find(t => t.id === lancou.corpo.titulo_id);
    assert.deepEqual([contaD.origem, contaD.documento_recebido_id, ctx.tabelas.titulo_pagar_parcelas.find(p => p.titulo_id === contaD.id).linha_digitavel], ['dda', 77, linha(COD_D)]);
    assert.deepEqual([boletoDe(ctx, COD_D).situacao, boletoDe(ctx, COD_D).vinculo_criterio], ['vinculado', 'lancada']);
    assert.equal((await ctx.chamar('POST', `/dda/${d.id}/lancar`, conta)).status, 409, 'o boleto já ligado não lança de novo');

    // O painel de setembro: E sem conta (aviso); a conta 3 paga por boleto sem o boleto (documental, DDA ligado).
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-09');
    const pend = new Map(painel.corpo.pendencias.map(p => [p.chave, p]));
    assert.equal(pend.get('dda_sem_conta').nivel, 'aviso');
    assert.match(semNbsp(pend.get('dda_sem_conta').descricao), /^Total: R\$ 120,00/);
    assert.deepEqual([pend.get('pagar_sem_boleto').nivel, pend.get('pagar_sem_boleto').titulo], ['documental', '1 pagamento por boleto sem o boleto']);
    // Contestar tira o aviso; restaurar devolve.
    assert.equal((await ctx.chamar('POST', `/dda/${e.id}/contestar`, { motivo: 'curto' })).status, 200);
    assert.equal((await ctx.chamar('POST', `/dda/${e.id}/restaurar`, {})).status, 200);
    assert.equal((await ctx.chamar('POST', `/dda/${e.id}/contestar`, { motivo: '' })).status, 400);
    assert.equal((await ctx.chamar('POST', `/dda/${e.id}/contestar`, { motivo: 'A empresa não comprou nada da Serviços X' })).status, 200);
    assert.equal(boletoDe(ctx, COD_E).situacao, 'contestado');
    assert.equal((await ctx.chamar('GET', '/painel?competencia=2026-09')).corpo.pendencias.some(p => p.chave === 'dda_sem_conta'), false);

    // A 2ª busca: B passou a liquidado (o histórico guarda); E sumiu do DDA.
    ctx.estadoRede.rodada = 2;
    const r2 = await ctx.chamar('POST', '/integracoes/bb_dda/sincronizar', {});
    assert.match(semNbsp(r2.corpo.resumo), /1 mudou de estado · 1 sumiu do DDA/);
    const b2 = boletoDe(ctx, COD_B);
    assert.deepEqual([b2.estado_bb, JSON.parse(b2.estados).map(x => x.estado)], [3, [1, 3]]);
    assert.ok(boletoDe(ctx, COD_E).sumiu_em);

    // O espelho: documento interno, com o rodapé do BB.
    const esp = await ctx.chamar('GET', `/dda/${a.id}/espelho`);
    assert.equal(esp.status, 200);
    assert.match(esp.corpo.nome, /^Espelho DDA 10-09-2026 VIDROS NORTE LTDA 2500,00\.pdf$/);
    assert.ok(esp.corpo.html.includes('Não constitui segunda via ou representação gráfica oficial do boleto.') && esp.corpo.html.includes('SANTISSIMO DECOR LTDA'));

    // Desfazer a conciliação do débito de 06/09: a conta do boleto é cancelada e o boleto C volta a ficar sem conta.
    const desfez = await ctx.chamar('POST', '/conciliacao/movimentos/501/desfazer', { motivo: 'Teste de desfazer' });
    assert.equal(desfez.status, 200, JSON.stringify(desfez.corpo));
    assert.equal(ctx.tabelas.titulos_pagar.find(t => t.id === contaC.id).status, 'cancelado');
    assert.deepEqual([boletoDe(ctx, COD_C).situacao, boletoDe(ctx, COD_C).titulo_id], ['novo', null]);

    // Desligar à mão pede o motivo; volta a "sem conta" e a linha digitável da parcela fica.
    assert.equal((await ctx.chamar('POST', `/dda/${b.id}/desvincular`, {})).status, 400);
    assert.equal((await ctx.chamar('POST', `/dda/${b.id}/desvincular`, { motivo: 'Boleto de outro mês' })).status, 200);
    assert.equal(boletoDe(ctx, COD_B).situacao, 'novo');
    // Ligar à mão a uma parcela já de outro boleto: recusado.
    assert.equal((await ctx.chamar('POST', `/dda/${b.id}/vincular`, { parcela_id: 11 })).status, 409);
    const religou = await ctx.chamar('POST', `/dda/${b.id}/vincular`, { parcela_id: 21 });
    assert.deepEqual([religou.status, boletoDe(ctx, COD_B).vinculo_criterio], [200, 'manual']);

    // O teste de conexão: os boletos a pagar dos próximos 30 dias, nada gravado.
    const antesTeste = ctx.tabelas.contabil_dda_boletos.length;
    const teste = await ctx.chamar('POST', '/integracoes/bb_dda/testar', {});
    assert.equal(teste.status, 200, JSON.stringify(teste.corpo));
    assert.match(semNbsp(teste.corpo.resumo), /^Token e DDA ok \(escopos: dda-info; com o certificado da empresa\)\. 1 boleto a pagar com vencimento de 15\/09\/2026 a 15\/10\/2026\. Pagador no BB: 11\.444\.777\/0001-61\. Nada foi gravado\.$/);
    assert.equal(ctx.tabelas.contabil_dda_boletos.length, antesTeste);
  } finally {
    await ctx.encerrar();
  }
});

test('DDA: credenciais próprias, permissões e "falta o SQL da fase H"', async () => {
  const ctx = await montar(cenario(), { permitir: ['contabilidade.view', 'contabilidade.config.view'] });
  try {
    assert.equal((await ctx.chamar('GET', '/dda')).status, 200);
    for (const [metodo, rota] of [['POST', '/dda/1/ignorar'], ['POST', '/dda/1/contestar'], ['POST', '/dda/1/vincular'], ['POST', '/dda/1/lancar'], ['POST', '/dda/conferir'], ['POST', '/integracoes/bb_dda/sincronizar']]) {
      const r = await ctx.chamar(metodo, rota, {});
      assert.deepEqual([r.status, r.corpo.pedidas], [403, ['contabilidade.pagar.lancar']], rota);
    }
    // Credenciais próprias: o cartão pede o client_secret do DDA (não usa o do Extrato).
    const proprias = await ctx.chamar('PUT', '/integracoes/bb_dda', { parametros: { usar_credenciais_do_extrato: false, client_id_homologacao: 'cid2', app_key_homologacao: 'app2' } });
    const cartao = proprias.corpo.integracoes.find(i => i.chave === 'bb_dda');
    assert.deepEqual([cartao.credenciais.origem, cartao.pendencias], ['propria', ['Sem client_secret de homologação guardado.']]);
  } finally {
    await ctx.encerrar();
  }
  const dados = cenario();
  delete dados.contabil_dda_boletos;
  const sem = await montar(dados);
  try {
    const lista = await sem.chamar('GET', '/dda');
    assert.deepEqual([lista.corpo.sql_pendente, lista.corpo.sql_arquivo], [true, 'sql/contabilidade_fase_h.sql']);
    const cartao = (await sem.chamar('GET', '/integracoes')).corpo.integracoes.find(i => i.chave === 'bb_dda');
    assert.deepEqual(cartao.pendencias, ['Falta rodar sql/contabilidade_fase_h.sql e reiniciar a API (a tabela dos boletos do DDA).']);
    const det = await sem.chamar('GET', '/dda/1');
    assert.deepEqual([det.status, det.corpo.sql_arquivo], [409, 'sql/contabilidade_fase_h.sql']);
    // O painel continua de pé (o DDA só não aparece).
    const painel = await sem.chamar('GET', '/painel?competencia=2026-09');
    assert.equal(painel.status, 200);
    assert.equal(painel.corpo.pendencias.some(p => /dda|boleto/.test(p.chave)), false);
  } finally {
    await sem.encerrar();
  }
  const semLinha = cenario();
  semLinha.contabil_integracoes = semLinha.contabil_integracoes.filter(x => x.chave !== 'bb_dda');
  const s2 = await montar(semLinha);
  try {
    const cartao = (await s2.chamar('GET', '/integracoes')).corpo.integracoes.find(i => i.chave === 'bb_dda');
    assert.deepEqual(cartao.pendencias, ['Falta rodar sql/contabilidade_fase_h.sql e reiniciar a API.']);
  } finally {
    await s2.encerrar();
  }
});
