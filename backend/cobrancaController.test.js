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

/** O BB de mentira: token para qualquer par com secret "ok"; listagem vazia (404) na conta certa. */
function bbFalso(chamadas) {
  return async (url, opcoes = {}) => {
    chamadas.push({ url, opcoes });
    const responder = (status, corpo) => ({ ok: status < 300, status, text: async () => JSON.stringify(corpo) });
    if (url.endsWith('/oauth/token')) {
      const [, secret] = Buffer.from(opcoes.headers.Authorization.replace('Basic ', ''), 'base64').toString().split(':');
      if (secret !== 'ok') return responder(401, { error: 'invalid_client', error_description: 'Invalid client credentials' });
      return responder(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 600, scope: 'cobrancas.boletos-info cobrancas.boletos-requisicao' });
    }
    if (url.includes('/boletos?')) return responder(404, { erros: [{ codigo: '4874916', mensagem: 'Nenhum boleto encontrado' }] });
    return responder(500, { erros: [{ mensagem: 'inesperado' }] });
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
      exigirPermissao: chave => (req, res, next) => (estado.supAdmin || estado.chaves.has(chave) ? next() : res.status(403).json({ error: 'Sem permissão' })),
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
    assert.deepEqual(corpo.credenciais.sandbox.pendencias, ['Sem client_secret de sandbox guardado (banco ou este computador)']);
    assert.equal(corpo.nosso_numero.producao, '00034534810000000394-X'.replace('-X', `-${require('./cobranca/boletoCalculo').dvNossoNumero('00034534810000000394')}`));
    assert.equal(corpo.nosso_numero.sandbox, '00034534810000000001-' + require('./cobranca/boletoCalculo').dvNossoNumero('00034534810000000001'));
    assert.equal(corpo.urls.sandbox.api, 'https://api.sandbox.bb.com.br/cobrancas/v2');
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
    assert.match(t.chamadasBB[0].url, /oauth\.sandbox\.bb\.com\.br/);
    assert.match(t.chamadasBB[1].url, /api\.sandbox\.bb\.com\.br\/cobrancas\/v2\/boletos\?gw-dev-app-key=key-sb&indicadorSituacao=A&agenciaBeneficiario=1614&contaBeneficiario=16773/);

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
    assert.match(semSecret.corpo.error, /Antes de testar: Sem client_secret de sandbox/);
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

test('server.js monta /api/cobranca depois do fiscal e antes do proxy genérico /api/:table', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const fiscal = fonte.indexOf("app.use('/api/fiscal'");
  const cobranca = fonte.indexOf("app.use('/api/cobranca'");
  const generico = fonte.indexOf("app.get('/api/:table'");
  assert.ok(fiscal > 0 && cobranca > fiscal && generico > cobranca);
});
