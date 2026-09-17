/**
 * Rotas da cobrança (backend/cobrancaController.js): configuração,
 * credenciais e teste de conexão com o BB.
 *
 * Upstream falso serve configuracao_cobranca (linha 1) e segredos_app; as
 * permissões são um dublê; o cofre é falso; o BB é um fetch de mentira. O
 * que se prende: quem vê e quem grava, a palavra PRODUCAO, o secret que
 * nunca volta na resposta (nem no banco em claro), a ordem banco → cofre →
 * .env e o teste que só sai para produção quando ela vale.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const MODULOS = ['./apiHttpClient', './permissionsController', './cobrancaController'];
const TOKEN = 'x.eyJpZCI6MX0.assinatura';

const LINHA = {
  id: 1, banco: '001', ambiente: 'sandbox', agencia: '1614', agencia_dv: '4', conta: '16773', conta_dv: '8', convenio: '3453481', carteira: 17, variacao: 19,
  beneficiario_nome: 'SANTISSIMO DECOR LTDA', beneficiario_cnpj: '44039257000122', beneficiario_endereco: 'RUA RUBI 150 - SAO JOAQUIM', beneficiario_cep: '32113270', beneficiario_cidade: 'CONTAGEM', beneficiario_uf: 'MG',
  client_id_sandbox: 'cid-sb', app_key_sandbox: 'key-sb', client_id_producao: 'cid-pr', app_key_producao: 'key-pr',
  proximo_sequencial_sandbox: 1, proximo_sequencial_producao: 394,
  especie: 'DM', aceite: false, juros_tipo: 'valor_dia', juros_percentual_mes: 9, multa_percentual: 2, multa_dias: 1, protesto_dias: 7, negativacao_dias: null,
  dias_limite_recebimento: 15, desconto_percentual: 0, desconto_dias: 0, indicador_pix: true, gerar_ao_emitir_nfe: true, mensagem_boleto: null
};

function cofreFalso() {
  return { nome: 'teste', cifrar: t => Buffer.from(t).toString('base64'), decifrar: b => Buffer.from(b, 'base64').toString() };
}

/** API genérica de mentira: GET filtra por igualdade, POST cria, PUT mescla, DELETE apaga. */
function criarUpstream(tabelas) {
  const puts = [];
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const responder = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    const [, tabela, id] = url.pathname.match(/^\/api\/([a-z_]+)(?:\/(\d+))?$/) || [];
    const lista = tabela && tabelas[tabela];
    if (!lista) return responder(404, { error: 'não há' });
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const dados = corpo ? JSON.parse(corpo) : {};
      if (req.method === 'GET') {
        if (id) return responder(200, lista.find(l => String(l.id) === id) || null);
        const filtros = [...url.searchParams.entries()];
        return responder(200, lista.filter(l => filtros.every(([c, v]) => String(l[c]) === String(v))));
      }
      if (req.method === 'POST') {
        if (tabela === 'boletos' && lista.some(l => l.ambiente === dados.ambiente && l.nosso_numero === dados.nosso_numero)) {
          return responder(500, { error: 'duplicate key value violates unique constraint "boletos_nosso_numero_unico"' });
        }
        const linha = { id: lista.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1, ...dados };
        lista.push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT' && id) {
        const linha = lista.find(l => String(l.id) === id);
        if (!linha) return responder(404, { error: 'não há' });
        puts.push({ tabela, dados });
        Object.assign(linha, dados);
        return responder(200, linha);
      }
      if (req.method === 'DELETE' && id) {
        const i = lista.findIndex(l => String(l.id) === id);
        if (i >= 0) lista.splice(i, 1);
        return responder(200, {});
      }
      return responder(404, { error: 'não há' });
    });
    return undefined;
  });
  return { servidor, puts };
}

/**
 * O BB de mentira: token para qualquer par com secret "ok"; listagem vazia
 * (404) na conta certa; registro; e (fase D) o boleto registrado guardado
 * para a consulta, a alteração e a baixa.
 */
function bbFalso(chamadas) {
  const registrados = new Map();
  return async (url, opcoes = {}) => {
    chamadas.push({ url, opcoes });
    const responder = (status, corpo) => ({ ok: status < 300, status, text: async () => JSON.stringify(corpo) });
    const umBoleto = /\/boletos\/(\d{20})(\/baixar)?\?/.exec(url);
    if (umBoleto) {
      const b = registrados.get(umBoleto[1]);
      if (!b) return responder(404, { erros: [{ codigoMensagem: '4874917', textoMensagem: 'Boleto não encontrado' }] });
      const corpo = opcoes.body ? JSON.parse(opcoes.body) : null;
      if (umBoleto[2]) { b.estado = 7; b.tipoBaixa = 11; return responder(200, { numeroContratoCobranca: 1, dataBaixa: '16.09.2026', horarioBaixa: '10:00:00' }); }
      if (opcoes.method === 'PATCH') {
        if (corpo.indicadorNovaDataVencimento === 'S') b.vencimento = corpo.alteracaoData.novaDataVencimento;
        if (corpo.indicadorIncluirAbatimento === 'S') b.abatimento = corpo.abatimento.valorAbatimento;
        return responder(200, { numeroContratoCobranca: 1, dataAtualizacao: '16.09.2026', horarioAtualizacao: '10:00:00' });
      }
      return responder(200, {
        codigoEstadoTituloCobranca: b.estado, codigoTipoBaixaTitulo: b.tipoBaixa || 0, dataVencimentoTituloCobranca: b.vencimento,
        valorOriginalTituloCobranca: b.valor, valorAbatimentoTituloCobranca: b.abatimento, dataMultaTitulo: '', codigoLinhaDigitavel: '', textoCodigoBarrasTituloCobranca: ''
      });
    }
    if (url.endsWith('/oauth/token')) {
      const [, secret] = Buffer.from(opcoes.headers.Authorization.replace('Basic ', ''), 'base64').toString().split(':');
      if (secret !== 'ok') return responder(401, { error: 'invalid_client', error_description: 'Invalid client credentials' });
      return responder(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 600, scope: 'cobrancas.boletos-info cobrancas.boletos-requisicao' });
    }
    if (url.includes('/boletos?') && opcoes.method !== 'POST') return responder(404, { erros: [{ codigo: '4874916', mensagem: 'Nenhum boleto encontrado' }] });
    if (url.includes('/boletos?') && opcoes.method === 'POST') {
      const corpo = JSON.parse(opcoes.body);
      if (corpo.valorOriginal === 999) return responder(422, { erros: [{ codigo: '4874990', versao: '1', mensagem: 'Valor inválido', ocorrencia: 'x' }] });
      registrados.set(corpo.numeroTituloCliente, { estado: 1, vencimento: corpo.dataVencimento, valor: corpo.valorOriginal, abatimento: 0 });
      return responder(201, {
        numero: corpo.numeroTituloCliente, linhaDigitavel: '00190000090345348100800000393173116950000332700', codigoBarraNumerico: '00191169500003327000000003453481000000039317',
        qrCode: { url: 'https://qrcodepix.bb.com.br/x', txId: `tx-${corpo.numeroTituloCliente}`, emv: '000201...' }
      });
    }
    return responder(500, { erros: [{ mensagem: 'inesperado' }] });
  };
}

/** Um pedido enviado com três parcelas (vencimentos no futuro) e o cliente completo para ser pagador. */
function tabelasDoPedido() {
  const venc = meses => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + meses); return d.toISOString().slice(0, 10); };
  return {
    pedidos: [{ id: 55, numero: '2548', situacao: 'Enviado', cliente_id: 7, valor_final: 3000 }],
    pedido_parcelas: [
      { id: 1, pedido_id: 55, numero_parcela: 1, valor: 1000, data_vencimento: venc(1) },
      { id: 2, pedido_id: 55, numero_parcela: 2, valor: 1000, data_vencimento: venc(2) },
      { id: 3, pedido_id: 55, numero_parcela: 3, valor: 1000, data_vencimento: venc(3) }
    ],
    clientes: [{ id: 7, tipo_pessoa: 'PJ', razao_social: 'Cliente Bom LTDA', nome_fantasia: 'Cliente Bom', cnpj: '11222333000181', reg_logradouro: 'Rua Diamante', reg_numero: '504', reg_bairro: 'São Joaquim', reg_cidade: 'Contagem', reg_uf: 'Minas Gerais', reg_cep: '32113000' }],
    notas_fiscais: [{ id: 10, pedido_id: 55, serie: 1, numero: 5, status_fiscal: 'autorizada' }],
    boletos: [], boletos_eventos: []
  };
}

async function montar({ linhas = [JSON.parse(JSON.stringify(LINHA))], env = {}, tabelas = {} } = {}) {
  tabelas.configuracao_cobranca = linhas;
  tabelas.segredos_app = tabelas.segredos_app || [];
  const upstream = criarUpstream(tabelas);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  for (const chave of Object.keys(require.cache)) {
    if (chave.includes(`${path.sep}backend${path.sep}cobranca${path.sep}`) || chave.includes(`${path.sep}backend${path.sep}fiscal${path.sep}`)) delete require.cache[chave];
  }

  const estado = { chaves: new Set(['financeiro.config.view']), supAdmin: false };
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      // Como o real: a chave pode ser uma função da requisição e pedir mais de uma permissão.
      exigirPermissao: chave => (req, res, next) => {
        const bruto = typeof chave === 'function' ? chave(req) : chave;
        const chaves = Array.isArray(bruto) ? bruto : [bruto];
        return estado.supAdmin || chaves.every(c => estado.chaves.has(c)) ? next() : res.status(403).json({ error: 'Sem permissão', permissao: chaves.find(c => !estado.chaves.has(c)) });
      },
      exigirAlgumaPermissao: chaves => (req, res, next) => (estado.supAdmin || [].concat(chaves).some(c => estado.chaves.has(c)) ? next() : res.status(403).json({ error: 'Sem permissão' })),
      exigirSupAdmin: (req, res, next) => (estado.supAdmin ? next() : res.status(403).json({ error: 'Somente Sup Admin' })),
      ehSupAdmin: async () => estado.supAdmin
    }
  };

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cobranca-rotas-'));
  const segredoLocal = require('./fiscal/segredoLocal');
  const segredo = segredoLocal.criar({ pasta, cofre: cofreFalso(), env: {} });
  const chamadasBB = [];

  const { criarRouter } = require('./cobrancaController');
  const app = express();
  app.use(express.json());
  app.use('/api/cobranca', criarRouter({ segredo, env, fetchImpl: bbFalso(chamadasBB) }));
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function chamar(metodo, caminho, corpo) {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    return { status: r.status, corpo: await r.json() };
  }
  const fechar = () => Promise.all([new Promise(r => servidor.close(r)), new Promise(r => upstream.servidor.close(r))]);
  return { chamar, estado, upstream, chamadasBB, fechar, segredo, tabelas };
}

test('ver a configuração exige financeiro.config.view; a resposta traz conta, convênio, credenciais sem secret e o próximo nosso número', async () => {
  const t = await montar();
  try {
    t.estado.chaves.clear();
    assert.equal((await t.chamar('GET', '/api/cobranca/configuracao')).status, 403);
    t.estado.chaves.add('financeiro.config.view');
    const { status, corpo } = await t.chamar('GET', '/api/cobranca/configuracao');
    assert.equal(status, 200);
    assert.equal(corpo.configuracao.convenio, '3453481');
    assert.equal(corpo.ambiente, 'sandbox');
    assert.equal(corpo.pode_editar, false);
    assert.equal(corpo.credenciais.sandbox.client_id, 'cid-sb');
    assert.equal(corpo.credenciais.sandbox.secret_guardado, false);
    assert.deepEqual(corpo.credenciais.sandbox.pendencias, ['Sem client_secret de homologação guardado (banco ou este computador)']);
    assert.equal(corpo.nosso_numero.producao, '00034534810000000394-X'.replace('-X', `-${require('./cobranca/boletoCalculo').dvNossoNumero('00034534810000000394')}`));
    assert.equal(corpo.nosso_numero.sandbox, '00031285570000000001-' + require('./cobranca/boletoCalculo').dvNossoNumero('00031285570000000001'), 'homologação numera no convênio de teste');
    assert.equal(corpo.contas.sandbox.convenio, '3128557');
    assert.equal(corpo.contas.sandbox.teste, true);
    assert.equal(corpo.contas.producao.convenio, '3453481');
    assert.equal(corpo.contas.producao.teste, false);
    assert.equal(corpo.urls.sandbox.api, 'https://api.hm.bb.com.br/cobrancas/v2');
    assert.equal(corpo.banco_chave_mestra, false);
    assert.ok(!JSON.stringify(corpo).toLowerCase().includes('secret_"') && !JSON.stringify(corpo).includes('"secret"'), 'nenhum secret na resposta');
  } finally {
    await t.fechar();
  }
});

test('BB_AMBIENTE=sandbox prende a máquina; só o Sup Admin grava e ligar produção exige PRODUCAO', async () => {
  const t = await montar({ linhas: [{ ...LINHA, ambiente: 'producao' }], env: { BB_AMBIENTE: 'sandbox' } });
  try {
    const preso = await t.chamar('GET', '/api/cobranca/configuracao');
    assert.equal(preso.corpo.ambiente, 'sandbox');
    assert.equal(preso.corpo.ambiente_no_banco, 'producao');
    assert.equal(preso.corpo.travado_em_sandbox_nesta_maquina, true);
  } finally {
    await t.fechar();
  }

  const t2 = await montar();
  try {
    assert.equal((await t2.chamar('PUT', '/api/cobranca/configuracao', { multa_percentual: '1' })).status, 403);
    t2.estado.supAdmin = true;
    assert.equal((await t2.chamar('PUT', '/api/cobranca/configuracao', {})).status, 400);
    assert.equal((await t2.chamar('PUT', '/api/cobranca/configuracao', { convenio: '12' })).status, 400);
    const semPalavra = await t2.chamar('PUT', '/api/cobranca/configuracao', { ambiente: 'producao' });
    assert.equal(semPalavra.status, 400);
    assert.match(semPalavra.corpo.error, /PRODUCAO/);
    const ok = await t2.chamar('PUT', '/api/cobranca/configuracao', { ambiente: 'producao', confirmacao: 'producao', multa_percentual: '2,5', protesto_dias: '' });
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
    assert.equal(ok.corpo.ambiente, 'producao');
    assert.equal(ok.corpo.configuracao.multa_percentual, 2.5);
    assert.equal(ok.corpo.configuracao.protesto_dias, null);
    assert.equal(t2.upstream.puts.at(-1).dados.atualizado_por, 1, 'usuário do JWT');
    assert.equal((await t2.chamar('PUT', '/api/cobranca/configuracao', { ambiente: 'sandbox' })).status, 200, 'voltar para sandbox não pede palavra');
  } finally {
    await t2.fechar();
  }
});

test('credenciais: o secret vai para o cofre (ou para o banco cifrado), nunca volta; teste de conexão usa banco → cofre → .env', async () => {
  const t = await montar();
  try {
    assert.equal((await t.chamar('POST', '/api/cobranca/credenciais', { ambiente: 'sandbox', client_secret: 'ok' })).status, 403);
    t.estado.supAdmin = true;
    assert.equal((await t.chamar('POST', '/api/cobranca/credenciais', { ambiente: 'sandbox', client_secret: '' })).status, 400);
    assert.equal((await t.chamar('POST', '/api/cobranca/credenciais', { ambiente: 'sandbox', client_secret: 'ok', destino: 'banco' })).status, 409, 'sem chave mestra não vai para o banco');

    const guardado = await t.chamar('POST', '/api/cobranca/credenciais', { ambiente: 'sandbox', client_secret: 'ok', destino: 'computador' });
    assert.equal(guardado.status, 200, JSON.stringify(guardado.corpo));
    assert.equal(guardado.corpo.secret_guardado, true);
    assert.equal(guardado.corpo.origem, 'computador');
    assert.deepEqual(guardado.corpo.pendencias, []);
    assert.ok(!JSON.stringify(guardado.corpo).includes('"ok"'), 'o secret não volta');
    assert.equal(t.segredo.lerSegredo('bb-sandbox').valor, 'ok');

    const teste = await t.chamar('POST', '/api/cobranca/testar', {});
    assert.equal(teste.status, 200, JSON.stringify(teste.corpo));
    assert.equal(teste.corpo.ok, true);
    assert.equal(teste.corpo.ambiente, 'sandbox');
    assert.equal(teste.corpo.boletosAbertos, 0);
    assert.equal(teste.corpo.origem_secret, 'computador');
    // O ambiente de testes é a homologação do BB, com a conta de teste da documentação (não a real 1614/16773).
    assert.match(t.chamadasBB[0].url, /^https:\/\/oauth\.hm\.bb\.com\.br\/oauth\/token$/);
    assert.match(t.chamadasBB[1].url, /^https:\/\/api\.hm\.bb\.com\.br\/cobrancas\/v2\/boletos\?gw-dev-app-key=key-sb&indicadorSituacao=A&agenciaBeneficiario=452&contaBeneficiario=123873$/);
    assert.deepEqual(teste.corpo.conta, { agencia: '452', conta: '123873', convenio: '3128557', teste: true });

    // Produção não vale (banco em sandbox): o teste cai em sandbox mesmo pedindo produção.
    assert.equal((await t.chamar('POST', '/api/cobranca/testar', { ambiente: 'producao' })).corpo.ambiente, 'sandbox');

    // Secret errado: o BB recusa e a tela recebe o motivo.
    await t.chamar('POST', '/api/cobranca/credenciais', { ambiente: 'sandbox', client_secret: 'errado', destino: 'computador' });
    const recusado = await t.chamar('POST', '/api/cobranca/testar', {});
    assert.equal(recusado.status, 401);
    assert.match(recusado.corpo.error, /recusou as credenciais/);

    assert.equal((await t.chamar('DELETE', '/api/cobranca/credenciais?ambiente=sandbox')).corpo.secret_guardado, false);
    const semSecret = await t.chamar('POST', '/api/cobranca/testar', {});
    assert.equal(semSecret.status, 409);
    assert.match(semSecret.corpo.error, /Antes de testar: Sem client_secret de homologação/);
  } finally {
    await t.fechar();
  }
});

test('com a chave mestra o secret vai cifrado para segredos_app e vale sem cofre; o .env é o último recurso', async () => {
  const chaveMestra = require('./fiscal/chaveMestra');
  const env = { SEGREDOS_CHAVE_MESTRA: chaveMestra.gerar() };
  const tabelas = { segredos_app: [] };
  const t = await montar({ env, tabelas });
  try {
    t.estado.supAdmin = true;
    const r = await t.chamar('POST', '/api/cobranca/credenciais', { ambiente: 'producao', client_secret: 'ok' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.origem, 'banco');
    assert.equal(tabelas.segredos_app.length, 1);
    assert.equal(tabelas.segredos_app[0].nome, 'bb_client_secret_producao');
    assert.ok(!JSON.stringify(tabelas.segredos_app[0]).includes('"ok"'), 'no banco só cifrado');
    const estado = await t.chamar('GET', '/api/cobranca/configuracao');
    assert.equal(estado.corpo.banco_chave_mestra, true);
    assert.equal(estado.corpo.credenciais.producao.secret_guardado, true);
    assert.equal(estado.corpo.credenciais.producao.origem, 'banco');
    assert.equal(estado.corpo.credenciais.sandbox.secret_guardado, false);
    assert.equal((await t.chamar('DELETE', '/api/cobranca/credenciais?ambiente=producao&destino=banco')).corpo.secret_guardado, false);
    assert.equal(tabelas.segredos_app.length, 0);
  } finally {
    await t.fechar();
  }

  const t2 = await montar({ env: { BB_CLIENT_SECRET_SANDBOX: 'ok' } });
  try {
    const estado = await t2.chamar('GET', '/api/cobranca/configuracao');
    assert.equal(estado.corpo.credenciais.sandbox.origem, 'env');
    assert.equal((await t2.chamar('POST', '/api/cobranca/testar', {})).corpo.origem_secret, 'env');
  } finally {
    await t2.fechar();
  }
});

test('sem a tabela (SQL não rodou): GET avisa nas pendências e testar responde 409', async () => {
  const t = await montar({ linhas: [] });
  try {
    const estado = await t.chamar('GET', '/api/cobranca/configuracao');
    assert.equal(estado.status, 200);
    assert.equal(estado.corpo.configuracao, null);
    assert.match(estado.corpo.credenciais.sandbox.pendencias[0], /sql\/cobranca_base\.sql/);
    assert.equal((await t.chamar('POST', '/api/cobranca/testar', {})).status, 409);
  } finally {
    await t.fechar();
  }
});

test('boletos do pedido: ver exige financeiro.boleto.view; o estado diz o que impede; gerar registra no BB parcela a parcela e não duplica', async () => {
  const tabelas = tabelasDoPedido();
  const t = await montar({ tabelas, env: { BB_CLIENT_SECRET_SANDBOX: 'ok' } });
  try {
    assert.equal((await t.chamar('GET', '/api/cobranca/pedidos/55/boletos')).status, 403);
    t.estado.chaves.add('financeiro.boleto.view');
    const antes = await t.chamar('GET', '/api/cobranca/pedidos/55/boletos');
    assert.equal(antes.status, 200, JSON.stringify(antes.corpo));
    assert.equal(antes.corpo.pedido.numero, '2548');
    assert.equal(antes.corpo.pedido.cliente, 'Cliente Bom');
    assert.equal(antes.corpo.ambiente, 'sandbox');
    assert.deepEqual(antes.corpo.nota_fiscal, { id: 10, serie: 1, numero: 5 });
    assert.equal(antes.corpo.parcelas.length, 3);
    assert.ok(antes.corpo.parcelas.every(l => l.boleto === null && l.tem_boleto_vivo === false));
    assert.deepEqual(antes.corpo.pendencias, []);
    assert.equal(antes.corpo.pode_gerar, true);
    assert.equal(antes.corpo.gerar_ao_emitir_nfe, true);
    assert.equal((await t.chamar('GET', '/api/cobranca/pedidos/999/boletos')).status, 404);

    assert.equal((await t.chamar('POST', '/api/cobranca/pedidos/55/boletos', {})).status, 403);
    t.estado.chaves.add('financeiro.boleto.emit');
    const gerado = await t.chamar('POST', '/api/cobranca/pedidos/55/boletos', { parcelas: [1, 2] });
    assert.equal(gerado.status, 200, JSON.stringify(gerado.corpo));
    assert.equal(gerado.corpo.registrados, 2);
    assert.equal(gerado.corpo.erros, 0);
    assert.deepEqual(gerado.corpo.resultados.map(r => r.boleto.nosso_numero), ['00031285570000000001', '00031285570000000002']);
    assert.equal(gerado.corpo.resultados[0].boleto.linha_digitavel, '00190.00009 03453.481008 00000.393173 1 16950000332700');
    assert.equal(gerado.corpo.resultados[0].boleto.tem_pix, true);
    assert.ok(!('pix_emv' in gerado.corpo.resultados[0].boleto) && !('requisicao' in gerado.corpo.resultados[0].boleto), 'a resposta não carrega os payloads');
    assert.equal(tabelas.boletos.length, 2);
    assert.equal(tabelas.boletos[0].status, 'registrado');
    assert.equal(tabelas.boletos[0].nota_fiscal_id, 10);
    assert.equal(tabelas.boletos[0].criado_por, 1, 'usuário do JWT');
    assert.equal(tabelas.boletos[0].requisicao.pagador.numeroInscricao, 86761393000171, 'homologação: pagador de teste do BB');
    assert.equal(tabelas.boletos[0].pagador.documento, '11222333000181', 'o documento real do cliente fica gravado');
    assert.equal(tabelas.boletos[0].requisicao.jurosMora.valor, 3, '9% ÷ 30 sobre R$ 1.000,00');
    assert.equal(tabelas.configuracao_cobranca[0].proximo_sequencial_sandbox, 3);
    assert.deepEqual(tabelas.boletos_eventos.map(e => e.tipo), ['reservado', 'registrado', 'reservado', 'registrado']);
    const registro = t.chamadasBB.find(c => c.opcoes.method === 'POST' && c.url.includes('/cobrancas/v2/boletos?gw-dev-app-key=key-sb'));
    assert.ok(registro, 'o registro foi para o sandbox com a app key');

    // O resto (parcela 3) sem lista = todas as que faltam; as duas primeiras não duplicam.
    const resto = await t.chamar('POST', '/api/cobranca/pedidos/55/boletos', {});
    assert.equal(resto.corpo.registrados, 1);
    assert.equal(resto.corpo.resultados.filter(r => r.ja_existia).length, 2);
    assert.equal(tabelas.boletos.length, 3);

    const depois = await t.chamar('GET', '/api/cobranca/pedidos/55/boletos');
    assert.ok(depois.corpo.parcelas.every(l => l.tem_boleto_vivo));
    assert.equal(depois.corpo.pode_gerar, false, 'nada mais a gerar');
    assert.deepEqual(depois.corpo.resumo, { total: 3, registrados: 3, pagos: 0, com_erro: 0, valor_registrado: 3000 });

    // Fase C: o PDF (HTML) de um boleto e de todos os do pedido.
    t.estado.chaves.delete('financeiro.boleto.view');
    assert.equal((await t.chamar('GET', `/api/cobranca/boletos/${tabelas.boletos[0].id}/documento`)).status, 403);
    t.estado.chaves.add('financeiro.boleto.view');
    const pdfUm = await t.chamar('GET', `/api/cobranca/boletos/${tabelas.boletos[0].id}/documento`);
    assert.equal(pdfUm.status, 200, JSON.stringify(pdfUm.corpo));
    assert.equal(pdfUm.corpo.nome, 'Boleto-2548P1-00031285570000000001');
    assert.ok(pdfUm.corpo.html.includes('Recibo do Pagador') && pdfUm.corpo.html.includes('Ficha de Compensação'));
    assert.ok(pdfUm.corpo.html.includes('00190.00009 03453.481008 00000.393173 1 16950000332700'), 'a linha digitável do BB');
    assert.ok(pdfUm.corpo.html.includes('452/123873'), 'homologação: conta de teste');
    assert.ok(pdfUm.corpo.html.includes('HOMOLOGAÇÃO — SEM VALOR'));
    assert.ok(pdfUm.corpo.html.includes('Pague agora com o seu Pix'), 'o BB devolveu Pix');
    assert.ok(!('requisicao' in pdfUm.corpo.boleto));
    const todos = await t.chamar('GET', '/api/cobranca/pedidos/55/boletos/documento');
    assert.equal(todos.status, 200);
    assert.equal(todos.corpo.nome, 'Boletos-2548');
    assert.equal(todos.corpo.quantidade, 3);
    assert.equal((todos.corpo.html.match(/<section class="pagina">/g) || []).length, 3);
    assert.equal((await t.chamar('GET', '/api/cobranca/boletos/999/documento')).status, 404);

    const lista = await t.chamar('GET', '/api/cobranca/boletos?pedido_id=55');
    assert.equal(lista.corpo.length, 3);
    const um = await t.chamar('GET', `/api/cobranca/boletos/${tabelas.boletos[0].id}`);
    assert.equal(um.corpo.nosso_numero, '00031285570000000001');
    assert.equal((await t.chamar('GET', '/api/cobranca/boletos/999')).status, 404);
  } finally {
    await t.fechar();
  }
});

test('sem o secret a cobrança não está pronta (409 com as pendências); recusa do BB fica "erro" na parcela sem derrubar as outras', async () => {
  const semSecret = await montar({ tabelas: tabelasDoPedido() });
  try {
    semSecret.estado.chaves.add('financeiro.boleto.view');
    semSecret.estado.chaves.add('financeiro.boleto.emit');
    const estado = await semSecret.chamar('GET', '/api/cobranca/pedidos/55/boletos');
    assert.equal(estado.corpo.pode_gerar, false);
    assert.deepEqual(estado.corpo.pendencias, ['Sem client_secret de homologação guardado (banco ou este computador)']);
    const r = await semSecret.chamar('POST', '/api/cobranca/pedidos/55/boletos', {});
    assert.equal(r.status, 409);
    assert.match(r.corpo.error, /A cobrança não está pronta: Sem client_secret/);
    assert.deepEqual(r.corpo.pendencias, ['Sem client_secret de homologação guardado (banco ou este computador)']);
  } finally {
    await semSecret.fechar();
  }

  const tabelas = tabelasDoPedido();
  tabelas.pedido_parcelas[1].valor = 999;
  const t = await montar({ tabelas, env: { BB_CLIENT_SECRET_SANDBOX: 'ok' } });
  try {
    t.estado.chaves.add('financeiro.boleto.view');
    t.estado.chaves.add('financeiro.boleto.emit');
    const r = await t.chamar('POST', '/api/cobranca/pedidos/55/boletos', {});
    assert.equal(r.status, 200);
    assert.equal(r.corpo.registrados, 2);
    assert.equal(r.corpo.erros, 1);
    assert.match(r.corpo.resultados[1].erro, /4874990 — Valor inválido/);
    assert.equal(tabelas.boletos.find(b => b.numero_parcela === 2).status, 'erro');
    const estado = await t.chamar('GET', '/api/cobranca/pedidos/55/boletos');
    assert.equal(estado.corpo.parcelas[1].tem_boleto_vivo, false);
    assert.equal(estado.corpo.parcelas[1].boleto.status, 'erro');
    assert.equal(estado.corpo.pode_gerar, true, 'a parcela com erro ainda pode ser gerada');
  } finally {
    await t.fechar();
  }
});

test('fase D: histórico, SQL exigido, consultar, prorrogar, abatimento e baixas pelas rotas, com as permissões certas', async () => {
  const tabelas = tabelasDoPedido();
  const t = await montar({ tabelas, env: { BB_CLIENT_SECRET_SANDBOX: 'ok' } });
  const somar = (iso, dias) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
  try {
    t.estado.chaves.add('financeiro.boleto.view');
    t.estado.chaves.add('financeiro.boleto.emit');
    assert.equal((await t.chamar('POST', '/api/cobranca/pedidos/55/boletos', {})).corpo.registrados, 3);
    const [b1, b2, b3] = tabelas.boletos;

    const hist = await t.chamar('GET', `/api/cobranca/boletos/${b1.id}/historico`);
    assert.equal(hist.status, 200, JSON.stringify(hist.corpo));
    assert.equal(hist.corpo.sql_pronto, false);
    assert.deepEqual(hist.corpo.eventos.map(e => e.tipo), ['registrado', 'reservado']);
    assert.deepEqual(hist.corpo.acoes, { sincronizar: true, prorrogar: true, abatimento: true, baixar: true, pdf: true });
    assert.ok(hist.corpo.formas_recebimento.includes('Pix') && hist.corpo.motivos.quitado_por_fora === 'quitado por fora');
    assert.ok(!('requisicao' in hist.corpo.boleto));

    // Sem o SQL da fase: 409 explicando o que falta.
    const semSql = await t.chamar('POST', `/api/cobranca/boletos/${b1.id}/sincronizar`);
    assert.equal(semSql.status, 409);
    assert.match(semSql.corpo.error, /sql\/cobranca_alteracoes\.sql/);
    for (const b of tabelas.boletos) Object.assign(b, { valor_abatimento: 0, vencimento_original: null, motivo_baixa: null, observacao_baixa: null, data_baixa: null, baixado_por: null, substitui_boleto_id: null, sincronizado_em: null });

    const sinc = await t.chamar('POST', `/api/cobranca/boletos/${b1.id}/sincronizar`);
    assert.equal(sinc.status, 200, JSON.stringify(sinc.corpo));
    assert.equal(sinc.corpo.boleto.status, 'registrado');
    assert.equal(sinc.corpo.mudou, false);
    assert.ok(tabelas.boletos[0].sincronizado_em);
    const consulta = t.chamadasBB.find(c => c.opcoes.method === 'GET' && c.url.includes(`/boletos/${b1.nosso_numero}?`));
    assert.ok(consulta.url.includes('numeroConvenio=3128557') && consulta.url.includes('gw-dev-app-key=key-sb'));

    // Prorrogar e abatimento pedem financeiro.boleto.baixa.
    const nova = somar(b1.data_vencimento, 10);
    assert.equal((await t.chamar('POST', `/api/cobranca/boletos/${b1.id}/prorrogar`, { data_vencimento: nova })).status, 403);
    t.estado.chaves.add('financeiro.boleto.baixa');
    const venc = b1.data_vencimento;
    const pr = await t.chamar('POST', `/api/cobranca/boletos/${b1.id}/prorrogar`, { data_vencimento: nova });
    assert.equal(pr.status, 200, JSON.stringify(pr.corpo));
    assert.equal(pr.corpo.boleto.data_vencimento, nova);
    assert.equal(pr.corpo.boleto.vencimento_original, venc);
    assert.deepEqual(pr.corpo.avisos, []);
    assert.ok(t.chamadasBB.some(c => c.opcoes.method === 'PATCH' && JSON.parse(c.opcoes.body).indicadorNovaDataVencimento === 'S'));
    const invalida = await t.chamar('POST', `/api/cobranca/boletos/${b1.id}/prorrogar`, { data_vencimento: '2020-01-01' });
    assert.equal(invalida.status, 400);
    assert.match(invalida.corpo.error, /já passou/);

    const ab = await t.chamar('POST', `/api/cobranca/boletos/${b1.id}/abatimento`, { valor: 50 });
    assert.equal(ab.status, 200, JSON.stringify(ab.corpo));
    assert.equal(Number(ab.corpo.boleto.valor_abatimento), 50);

    // Reemissão pede também financeiro.boleto.emit: baixa o boleto 1 e registra outro para a parcela 1.
    t.estado.chaves.delete('financeiro.boleto.emit');
    const semEmit = await t.chamar('POST', `/api/cobranca/boletos/${b1.id}/baixar`, { motivo: 'reemissao', novo_vencimento: somar(nova, 5) });
    assert.equal(semEmit.status, 403);
    assert.equal(semEmit.corpo.permissao, 'financeiro.boleto.emit');
    t.estado.chaves.add('financeiro.boleto.emit');
    const re = await t.chamar('POST', `/api/cobranca/boletos/${b1.id}/baixar`, { motivo: 'reemissao', novo_vencimento: somar(nova, 5) });
    assert.equal(re.status, 200, JSON.stringify(re.corpo));
    assert.equal(re.corpo.boleto.status, 'baixado');
    assert.equal(re.corpo.boleto.motivo_baixa, 'reemissao');
    assert.equal(re.corpo.reemissao.registrados, 1, JSON.stringify(re.corpo.reemissao));
    assert.deepEqual(re.corpo.avisos, []);
    const novo = tabelas.boletos.find(b => b.substitui_boleto_id === b1.id);
    assert.ok(novo, 'boleto novo ligado ao baixado');
    assert.equal(novo.status, 'registrado');
    assert.equal(novo.data_vencimento, somar(nova, 5));
    assert.equal(novo.nosso_numero, '00031285570000000004');
    assert.ok(t.chamadasBB.some(c => c.url.includes(`/boletos/${b1.nosso_numero}/baixar?`)));

    // Quitado por fora (só baixa) e cancelado sem motivo escrito.
    t.estado.chaves.delete('financeiro.boleto.emit');
    const qf = await t.chamar('POST', `/api/cobranca/boletos/${b2.id}/baixar`, { motivo: 'quitado_por_fora', data_recebimento: '2026-09-01', valor_recebido: 1000, forma: 'Transferência' });
    assert.equal(qf.status, 200, JSON.stringify(qf.corpo));
    assert.equal(qf.corpo.boleto.canal_pagamento, 'Fora do boleto · Transferência');
    assert.deepEqual(qf.corpo.acoes, { sincronizar: true, prorrogar: false, abatimento: false, baixar: false, pdf: false });
    const semObs = await t.chamar('POST', `/api/cobranca/boletos/${b3.id}/baixar`, { motivo: 'cancelado' });
    assert.equal(semObs.status, 400);
    const deNovo = await t.chamar('POST', `/api/cobranca/boletos/${b2.id}/baixar`, { motivo: 'cancelado', observacao: 'x' });
    assert.equal(deNovo.status, 409, 'já baixado');

    // O pedido: parcela 1 com o boleto novo, parcela 2 resolvida (quitada), nada a gerar.
    const estado = await t.chamar('GET', '/api/cobranca/pedidos/55/boletos');
    assert.deepEqual(estado.corpo.parcelas.map(l => [l.boleto.id, l.boleto.status, l.tem_boleto_vivo]), [[novo.id, 'registrado', true], [b2.id, 'baixado', true], [b3.id, 'registrado', true]]);
    assert.equal(estado.corpo.pode_gerar, false);

    // Consultar todos os a pagar do pedido: o novo e o da parcela 3.
    t.estado.chaves.delete('financeiro.boleto.view');
    assert.equal((await t.chamar('POST', '/api/cobranca/pedidos/55/boletos/sincronizar')).status, 403);
    t.estado.chaves.add('financeiro.boleto.view');
    // No banco real a linha nova já nasce com as colunas da fase; aqui o dublê só guarda o que foi enviado.
    Object.assign(novo, { valor_abatimento: 0, vencimento_original: null, motivo_baixa: null, sincronizado_em: null });
    const todos = await t.chamar('POST', '/api/cobranca/pedidos/55/boletos/sincronizar');
    assert.equal(todos.status, 200, JSON.stringify(todos.corpo));
    assert.deepEqual(todos.corpo.resultados.map(r => r.boleto_id).sort(), [novo.id, b3.id].sort());
    assert.equal(todos.corpo.consultados, 2);
    assert.equal(todos.corpo.erros, 0);

    const hist2 = await t.chamar('GET', `/api/cobranca/boletos/${b1.id}/historico`);
    assert.deepEqual(hist2.corpo.eventos.map(e => e.tipo).slice(0, 5), ['baixado', 'consulta', 'abatimento', 'consulta', 'prorrogado']);
    assert.equal(hist2.corpo.acoes.baixar, false);
    assert.equal(hist2.corpo.sql_pronto, true);
  } finally {
    await t.fechar();
  }
});

test('fase E: painel, visões, recebimento à mão (e com boleto em aberto), estorno e conciliação, com as permissões certas', async () => {
  const tabelas = tabelasDoPedido();
  const COLUNAS_D = { valor_abatimento: 0, vencimento_original: null, motivo_baixa: null, observacao_baixa: null, data_baixa: null, baixado_por: null, substitui_boleto_id: null, sincronizado_em: null };
  const t = await montar({ tabelas, env: { BB_CLIENT_SECRET_SANDBOX: 'ok' } });
  try {
    // Sem a tabela de recebimentos: o painel responde e diz o que falta.
    t.estado.chaves.add('financeiro.recebimento.view');
    const semSql = await t.chamar('GET', '/api/cobranca/recebimentos/painel?competencia=2026-09');
    assert.equal(semSql.status, 200, JSON.stringify(semSql.corpo));
    assert.equal(semSql.corpo.sql_pendente, true);
    assert.equal(semSql.corpo.pendencias[0].chave, 'recebimentos_sql');

    tabelas.recebimentos = [];
    tabelas.pedidos[0].situacao = 'Enviado';
    t.estado.chaves.add('financeiro.boleto.view');
    t.estado.chaves.add('financeiro.boleto.emit');
    assert.equal((await t.chamar('POST', '/api/cobranca/pedidos/55/boletos', { parcelas: [1] })).corpo.registrados, 1);
    for (const b of tabelas.boletos) Object.assign(b, COLUNAS_D);

    t.estado.chaves.delete('financeiro.recebimento.view');
    assert.equal((await t.chamar('GET', '/api/cobranca/recebimentos/painel')).status, 403);
    assert.equal((await t.chamar('GET', '/api/cobranca/recebimentos?visao=abertas')).status, 403);
    assert.equal((await t.chamar('POST', '/api/cobranca/conciliar', {})).status, 403);
    t.estado.chaves.add('financeiro.recebimento.view');

    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const abertas = await t.chamar('GET', '/api/cobranca/recebimentos?visao=abertas');
    assert.equal(abertas.status, 200, JSON.stringify(abertas.corpo));
    assert.deepEqual(abertas.corpo.linhas.map(l => [l.numero_parcela, l.cliente, l.boleto?.status || null]), [[1, 'Cliente Bom', 'registrado'], [2, 'Cliente Bom', null], [3, 'Cliente Bom', null]]);
    assert.equal((await t.chamar('GET', '/api/cobranca/recebimentos?visao=tudo')).status, 400);

    // Registrar à mão: pede financeiro.recebimento.registrar.
    const entrada = { pedido_id: 55, numero_parcela: 2, data_recebimento: hoje, valor_recebido: 1000, forma: 'Pix', observacao: 'Pix na conta' };
    assert.equal((await t.chamar('POST', '/api/cobranca/recebimentos', entrada)).status, 403);
    t.estado.chaves.add('financeiro.recebimento.registrar');
    const manual = await t.chamar('POST', '/api/cobranca/recebimentos', entrada);
    assert.equal(manual.status, 200, JSON.stringify(manual.corpo));
    assert.equal(manual.corpo.recebimento.origem, 'manual');
    assert.equal(tabelas.recebimentos.length, 1);
    assert.equal((await t.chamar('POST', '/api/cobranca/recebimentos', entrada)).status, 409, 'já recebida');

    // Parcela 1 tem boleto em aberto: sem a confirmação, 409 dizendo qual; com ela, pede também a baixa.
    const comBoleto = { ...entrada, numero_parcela: 1, forma: 'Transferência' };
    const aviso = await t.chamar('POST', '/api/cobranca/recebimentos', comBoleto);
    assert.equal(aviso.status, 409);
    assert.equal(aviso.corpo.boleto_em_aberto.nosso_numero, '00031285570000000001');
    const semBaixa = await t.chamar('POST', '/api/cobranca/recebimentos', { ...comBoleto, baixar_boleto: true });
    assert.equal(semBaixa.status, 403);
    assert.equal(semBaixa.corpo.permissao, 'financeiro.boleto.baixa');
    t.estado.chaves.add('financeiro.boleto.baixa');
    const baixou = await t.chamar('POST', '/api/cobranca/recebimentos', { ...comBoleto, baixar_boleto: true });
    assert.equal(baixou.status, 200, JSON.stringify(baixou.corpo));
    assert.equal(baixou.corpo.boleto.status, 'baixado');
    assert.equal(baixou.corpo.boleto.motivo_baixa, 'quitado_por_fora');
    assert.equal(baixou.corpo.recebimento.origem, 'quitado_por_fora');
    assert.equal(baixou.corpo.recebimento.forma, 'Transferência');
    assert.ok(t.chamadasBB.some(c => c.url.includes('/boletos/00031285570000000001/baixar?')));
    assert.equal(tabelas.recebimentos.length, 2);

    // Painel e visão dos recebidos da competência.
    const comp = hoje.slice(0, 7);
    const painel = await t.chamar('GET', `/api/cobranca/recebimentos/painel?competencia=${comp}`);
    assert.deepEqual(painel.corpo.recebido, { quantidade: 2, total: 2000, encargos: 0, estornados: 0 });
    const recebidos = await t.chamar('GET', `/api/cobranca/recebimentos?visao=recebidos&competencia=${comp}`);
    assert.deepEqual(recebidos.corpo.linhas.map(l => [l.numero_parcela, l.origem, l.cliente]).sort(), [[1, 'quitado_por_fora', 'Cliente Bom'], [2, 'manual', 'Cliente Bom']]);

    // Estorno: pede financeiro.recebimento.estornar.
    const idManual = manual.corpo.recebimento.id;
    assert.equal((await t.chamar('POST', `/api/cobranca/recebimentos/${idManual}/estornar`, { motivo: 'lançado errado' })).status, 403);
    t.estado.chaves.add('financeiro.recebimento.estornar');
    const est = await t.chamar('POST', `/api/cobranca/recebimentos/${idManual}/estornar`, { motivo: 'lançado errado' });
    assert.equal(est.status, 200, JSON.stringify(est.corpo));
    assert.equal(est.corpo.recebimento.status, 'estornado');
    assert.equal((await t.chamar('POST', `/api/cobranca/recebimentos/${idManual}/estornar`, { motivo: 'de novo' })).status, 409);

    // Conciliar: aviso do webhook de um boleto novo (parcela 3) → pago + recebimento.
    assert.equal((await t.chamar('POST', '/api/cobranca/pedidos/55/boletos', { parcelas: [3] })).corpo.registrados, 1);
    const b3 = tabelas.boletos.find(b => b.numero_parcela === 3);
    Object.assign(b3, COLUNAS_D);
    tabelas.boletos_eventos.push({ id: 999, origem: 'webhook', tipo: 'baixa_operacional', nosso_numero: b3.nosso_numero, processado_em: null,
      payload: { id: b3.nosso_numero, numeroConvenio: 3128557, codigoEstadoBaixaOperacional: 1, dataLiquidacao: hoje.split('-').reverse().join('.'), valorPagoSacado: 1000 } });
    const soFila = await t.chamar('POST', '/api/cobranca/conciliar', { so_fila: true });
    assert.equal(soFila.status, 200, JSON.stringify(soFila.corpo));
    assert.equal(soFila.corpo.fila.pagos, 1);
    assert.equal(b3.status, 'pago');
    assert.equal(tabelas.recebimentos.filter(r => r.boleto_id === b3.id).length, 1);
    const tudo = await t.chamar('POST', '/api/cobranca/conciliar', {});
    assert.equal(tudo.status, 200, JSON.stringify(tudo.corpo));
    assert.equal(tudo.corpo.consultas.consultados, 0, 'não há boleto a pagar');
    assert.equal(tudo.corpo.acerto.lancados, 0);
  } finally {
    await t.fechar();
  }
});

test('fase F: estado do webhook (sem token), a conciliação pelo botão fica registrada e a agenda usa a mesma conciliação', async () => {
  const tabelas = tabelasDoPedido();
  tabelas.recebimentos = [];
  tabelas.cobranca_execucoes = [];
  tabelas.boletos_eventos = [
    { id: 1, origem: 'webhook', tipo: 'baixa_operacional', nosso_numero: '00031285579999999999', processado_em: null, criado_em: '2026-09-16T12:00:00Z',
      payload: { id: '00031285579999999999', numeroConvenio: 3128557, codigoEstadoBaixaOperacional: 1 } }
  ];
  const linha = { ...JSON.parse(JSON.stringify(LINHA)), conciliacao_automatica: true, conciliacao_intervalo_min: 30 };
  const t = await montar({ linhas: [linha], tabelas, env: { BB_CLIENT_SECRET_SANDBOX: 'ok' } });
  try {
    t.estado.chaves.clear();
    assert.equal((await t.chamar('GET', '/api/cobranca/webhook/estado')).status, 403);
    t.estado.chaves.add('financeiro.config.view');
    const antes = await t.chamar('GET', '/api/cobranca/webhook/estado');
    assert.equal(antes.status, 200, JSON.stringify(antes.corpo));
    assert.equal(antes.corpo.url_modelo, 'https://api.santissimodecor.com.br/webhooks/bb/baixa-operacional/<token>');
    assert.deepEqual([antes.corpo.avisos.total, antes.corpo.avisos.na_fila], [1, 1]);
    assert.deepEqual([antes.corpo.agenda.sql_pronto, antes.corpo.agenda.ligada, antes.corpo.agenda.intervalo_min], [true, true, 30]);
    assert.deepEqual(antes.corpo.execucoes, []);

    t.estado.chaves.add('financeiro.recebimento.view');
    const r = await t.chamar('POST', '/api/cobranca/conciliar', {});
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.fila.ignorados, 1, 'o nosso número não é deste sistema');
    assert.equal(tabelas.cobranca_execucoes.length, 1);
    const exec = tabelas.cobranca_execucoes[0];
    assert.equal(exec.tipo, 'conciliacao_manual');
    assert.equal(exec.usuario_id, 1);
    assert.match(exec.chave, /^manual:\d+:/);
    assert.ok(exec.concluido_em);
    assert.equal(exec.resumo, '1 aviso(s) do BB · 0 boleto(s) consultado(s)');
    // Só a fila não fica no registro (é a leitura automática da tela).
    await t.chamar('POST', '/api/cobranca/conciliar', { so_fila: true });
    assert.equal(tabelas.cobranca_execucoes.length, 1);

    const depois = await t.chamar('GET', '/api/cobranca/webhook/estado');
    assert.deepEqual([depois.corpo.avisos.na_fila, depois.corpo.avisos.ignorados], [0, 1]);
    assert.equal(depois.corpo.recentes[0].situacao, 'ignorado');
    assert.deepEqual(depois.corpo.execucoes.map(x => [x.como, x.terminou]), [['pelo botão', true]]);

    // O painel de recebimentos conta a última conciliação.
    const painel = await t.chamar('GET', '/api/cobranca/recebimentos/painel');
    assert.equal(painel.corpo.ultima_conciliacao.como, 'pelo botão');
    assert.match(painel.corpo.ultima_conciliacao.quando, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);

    const { conciliarEmSegundoPlano } = require('./cobrancaController');
    assert.equal(typeof conciliarEmSegundoPlano, 'function', 'a agenda automática usa a conciliação do controller');
  } finally {
    await t.fechar();
  }
});

test('fase D: boleto de produção com a cobrança em homologação não é mexido', async () => {
  const tabelas = tabelasDoPedido();
  tabelas.boletos.push({
    id: 7, pedido_id: 55, parcela_id: 1, numero_parcela: 1, ambiente: 'producao', convenio: '3453481', carteira: 17, variacao: 19, sequencial: 394,
    nosso_numero: '00034534810000000394', valor: 1000, data_emissao: '2026-09-16', data_vencimento: '2027-01-18', status: 'registrado', chave_idempotencia: 'producao:00034534810000000394',
    valor_abatimento: 0, vencimento_original: null, motivo_baixa: null, sincronizado_em: null
  });
  const t = await montar({ tabelas, env: { BB_CLIENT_SECRET_SANDBOX: 'ok', BB_CLIENT_SECRET_PRODUCAO: 'ok' } });
  try {
    t.estado.chaves.add('financeiro.boleto.view');
    const r = await t.chamar('POST', '/api/cobranca/boletos/7/sincronizar');
    assert.equal(r.status, 409);
    assert.match(r.corpo.error, /é de produção, mas a cobrança está em homologação/);
    assert.equal(t.chamadasBB.length, 0, 'nada saiu para o BB');
  } finally {
    await t.fechar();
  }
});

test('parcela mínima: quem lê e quem grava; sem o SQL avisa; o abatimento não deixa o boleto abaixo dela (a entrada à vista é livre)', async () => {
  const sem = await montar();
  try {
    sem.estado.chaves.clear();
    assert.equal((await sem.chamar('GET', '/api/cobranca/parcela-minima')).status, 403);
    sem.estado.chaves.add('orc.create');
    assert.deepEqual((await sem.chamar('GET', '/api/cobranca/parcela-minima')).corpo, { parcela_minima: 0, sql_pronto: false }, 'sem a coluna, nada muda');
    assert.equal((await sem.chamar('PUT', '/api/cobranca/configuracao/parcela', { parcela_minima: 1500 })).status, 403, 'ler não é gravar');
    sem.estado.chaves.add('financeiro.parcela.editar');
    const pendente = await sem.chamar('PUT', '/api/cobranca/configuracao/parcela', { parcela_minima: 1500 });
    assert.equal(pendente.status, 409);
    assert.equal(pendente.corpo.sql_pendente, true);
    assert.match(pendente.corpo.error, /desenhistas_producao_parcela\.sql/);
  } finally {
    await sem.fechar();
  }

  // Entrada à vista de R$ 1.000 e duas de R$ 2.000.
  const tabelas = tabelasDoPedido();
  Object.assign(tabelas.pedidos[0], { prazo: '0/30/60', valor_final: 5000 });
  [1000, 2000, 2000].forEach((v, i) => { tabelas.pedido_parcelas[i].valor = v; });
  const linha = { ...JSON.parse(JSON.stringify(LINHA)), parcela_minima: '1500.00' };
  const t = await montar({ linhas: [linha], tabelas, env: { BB_CLIENT_SECRET_SANDBOX: 'ok' } });
  try {
    t.estado.chaves.clear();
    t.estado.chaves.add('ped.payment.edit');
    assert.deepEqual((await t.chamar('GET', '/api/cobranca/parcela-minima')).corpo, { parcela_minima: 1500, sql_pronto: true });
    t.estado.chaves.add('financeiro.parcela.editar');
    for (const ruim of ['-1', 'abc', '', 2000000]) {
      assert.equal((await t.chamar('PUT', '/api/cobranca/configuracao/parcela', { parcela_minima: ruim })).status, 400, String(ruim));
    }
    const gravada = await t.chamar('PUT', '/api/cobranca/configuracao/parcela', { parcela_minima: 'R$ 1.500,00' });
    assert.equal(gravada.status, 200, JSON.stringify(gravada.corpo));
    assert.deepEqual(gravada.corpo, { parcela_minima: 1500 });
    assert.equal(tabelas.configuracao_cobranca[0].parcela_minima, 1500);
    assert.equal(tabelas.configuracao_cobranca[0].atualizado_por, 1);

    for (const chave of ['financeiro.boleto.view', 'financeiro.boleto.emit', 'financeiro.boleto.baixa']) t.estado.chaves.add(chave);
    assert.equal((await t.chamar('POST', '/api/cobranca/pedidos/55/boletos', {})).corpo.registrados, 3);
    for (const b of tabelas.boletos) Object.assign(b, { valor_abatimento: 0, vencimento_original: null, motivo_baixa: null, observacao_baixa: null, data_baixa: null, baixado_por: null, substitui_boleto_id: null, sincronizado_em: null });
    const [b1, b2] = tabelas.boletos;

    const abaixo = await t.chamar('POST', `/api/cobranca/boletos/${b2.id}/abatimento`, { valor: 500.01 });
    assert.equal(abaixo.status, 409);
    assert.match(abaixo.corpo.error, /passa a cobrar R\$\s1\.499,99, abaixo da parcela mínima/);
    assert.ok(!t.chamadasBB.some(c => c.opcoes.method === 'PATCH'), 'a recusa não chega ao BB');
    const noLimite = await t.chamar('POST', `/api/cobranca/boletos/${b2.id}/abatimento`, { valor: 500 });
    assert.equal(noLimite.status, 200, JSON.stringify(noLimite.corpo));
    const entrada = await t.chamar('POST', `/api/cobranca/boletos/${b1.id}/abatimento`, { valor: 900 });
    assert.equal(entrada.status, 200, 'a 1ª parcela com prazo 0 é livre');
  } finally {
    await t.fechar();
  }
});

test('server.js monta /api/cobranca depois do fiscal e antes do proxy genérico /api/:table', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const fiscal = fonte.indexOf("app.use('/api/fiscal'");
  const cobranca = fonte.indexOf("app.use('/api/cobranca'");
  const generico = fonte.indexOf("app.get('/api/:table'");
  assert.ok(fiscal > 0 && cobranca > fiscal && generico > cobranca);
});
