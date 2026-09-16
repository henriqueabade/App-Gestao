/**
 * Cliente da API do BB (backend/cobranca/bbCliente.js) com um fetch de
 * mentira: token pedido com Basic + client_credentials e guardado até perto
 * de vencer; chamada com a gw-dev-app-key (query e cabeçalho) e o Bearer;
 * 401 renova o token e repete uma vez; erros do BB viram texto em português;
 * o teste de conexão aceita "sem boletos" como resposta boa.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const bb = require('./bbCliente');

function fetchFalso(roteiro) {
  const chamadas = [];
  const fetchImpl = async (url, opcoes = {}) => {
    chamadas.push({ url, opcoes });
    const r = roteiro(url, opcoes, chamadas.length);
    const corpo = r.corpo === undefined ? '' : (typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo));
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => corpo };
  };
  return { fetchImpl, chamadas };
}

const CRED = { ambiente: 'sandbox', clientId: 'cid', clientSecret: 's3cr3t' };

test('token: POST no OAuth do sandbox com Basic e escopos, cache até 60 s antes de vencer, renovação forçada', async () => {
  let relogio = 1_000_000;
  let emitidos = 0;
  const { fetchImpl, chamadas } = fetchFalso(url => {
    if (url.endsWith('/oauth/token')) { emitidos += 1; return { status: 200, corpo: { access_token: `tok${emitidos}`, token_type: 'Bearer', expires_in: 600, scope: 'cobrancas.boletos-info cobrancas.boletos-requisicao' } }; }
    return { status: 404, corpo: {} };
  });
  const cliente = bb.criar({ fetchImpl, env: {}, agora: () => relogio });
  const t1 = await cliente.obterToken(CRED);
  assert.equal(t1.valor, 'tok1');
  assert.deepEqual(t1.escopos, ['cobrancas.boletos-info', 'cobrancas.boletos-requisicao']);
  assert.equal(chamadas[0].url, 'https://oauth.sandbox.bb.com.br/oauth/token');
  assert.equal(chamadas[0].opcoes.method, 'POST');
  assert.equal(chamadas[0].opcoes.headers.Authorization, `Basic ${Buffer.from('cid:s3cr3t').toString('base64')}`);
  assert.equal(chamadas[0].opcoes.body, 'grant_type=client_credentials&scope=cobrancas.boletos-info%20cobrancas.boletos-requisicao');

  relogio += 500 * 1000;
  assert.equal((await cliente.obterToken(CRED)).valor, 'tok1', 'ainda vale: do cache');
  relogio += 41 * 1000;
  assert.equal((await cliente.obterToken(CRED)).valor, 'tok2', 'a 60 s do fim, renova');
  assert.equal((await cliente.obterToken({ ...CRED, forcar: true })).valor, 'tok3');
  assert.equal((await cliente.obterToken({ ...CRED, ambiente: 'producao' })).valor, 'tok4', 'cada ambiente tem o seu');
  assert.equal(chamadas.at(-1).url, 'https://oauth.bb.com.br/oauth/token');
  await assert.rejects(() => cliente.obterToken({ ambiente: 'sandbox', clientId: 'x', clientSecret: '' }), /Faltam o client_id ou o client_secret/);
});

test('credenciais recusadas (401) e falha do OAuth viram mensagens claras; .env sobrepõe os endereços', async () => {
  const { fetchImpl } = fetchFalso(() => ({ status: 401, corpo: { error: 'invalid_client', error_description: 'Invalid client credentials' } }));
  const cliente = bb.criar({ fetchImpl, env: { BB_URL_OAUTH_SANDBOX: 'https://oauth.exemplo/token', BB_URL_API_SANDBOX: 'https://api.exemplo/v2/' } });
  assert.deepEqual(cliente.urls('sandbox'), { oauth: 'https://oauth.exemplo/token', api: 'https://api.exemplo/v2' });
  await assert.rejects(() => cliente.obterToken(CRED), e => e.status === 401 && /recusou as credenciais \(401\): Invalid client credentials/.test(e.message));

  const quebrado = bb.criar({ fetchImpl: async () => { throw new Error('ECONNRESET'); }, env: {} });
  await assert.rejects(() => quebrado.obterToken(CRED), /Não foi possível falar com o BB: ECONNRESET/);

  const semToken = bb.criar({ fetchImpl: fetchFalso(() => ({ status: 200, corpo: {} })).fetchImpl, env: {} });
  await assert.rejects(() => semToken.obterToken(CRED), /não devolveu o token/);
});

test('chamar: app key na query e no cabeçalho, Bearer, JSON; 401 renova e repete uma vez; erro do BB traduzido', async () => {
  let tokens = 0;
  let recusas = 0;
  const { fetchImpl, chamadas } = fetchFalso((url, opcoes) => {
    if (url.endsWith('/oauth/token')) { tokens += 1; return { status: 200, corpo: { access_token: `tok${tokens}`, expires_in: 600 } }; }
    if (url.includes('/boletos/999')) return { status: 404, corpo: { erros: [{ codigo: '4874915', versao: '1', mensagem: 'Boleto não encontrado', ocorrencia: 'x' }] } };
    if (recusas === 0 && opcoes.headers.Authorization === 'Bearer tok1') { recusas += 1; return { status: 401, corpo: {} }; }
    return { status: 200, corpo: { boletos: [{ numeroBoletoBB: '00034534810000000393' }] } };
  });
  const cliente = bb.criar({ fetchImpl, env: {} });
  const r = await cliente.chamar({ ambiente: 'sandbox', appKey: 'app123', credenciais: CRED, caminho: '/boletos', query: { indicadorSituacao: 'A', agenciaBeneficiario: '1614', contaBeneficiario: '16773', vazio: '' } });
  assert.equal(r.boletos.length, 1);
  const chamadaApi = chamadas.find(c => c.url.includes('/cobrancas/v2/boletos'));
  assert.equal(chamadaApi.url, 'https://api.sandbox.bb.com.br/cobrancas/v2/boletos?gw-dev-app-key=app123&indicadorSituacao=A&agenciaBeneficiario=1614&contaBeneficiario=16773');
  assert.equal(chamadaApi.opcoes.headers['gw-dev-app-key'], 'app123');
  assert.equal(chamadaApi.opcoes.headers.Authorization, 'Bearer tok1');
  assert.equal(tokens, 2, 'o 401 renovou o token');
  assert.equal(chamadas.at(-1).opcoes.headers.Authorization, 'Bearer tok2');

  await assert.rejects(() => cliente.chamar({ ambiente: 'sandbox', appKey: 'app123', credenciais: CRED, caminho: 'boletos/999' }),
    e => e.status === 422 && e.message === 'O BB respondeu 404 em GET boletos/999: 4874915 — Boleto não encontrado — x.' && e.extra.http === 404);
  await assert.rejects(() => cliente.chamar({ ambiente: 'sandbox', appKey: '', credenciais: CRED, caminho: '/boletos' }), /Falta a app key/);

  const post = await cliente.chamar({ ambiente: 'sandbox', appKey: 'app123', credenciais: CRED, metodo: 'POST', caminho: '/boletos', corpo: { numeroConvenio: 3453481 } });
  assert.ok(post.boletos);
  const ultima = chamadas.at(-1);
  assert.equal(ultima.opcoes.method, 'POST');
  assert.equal(ultima.opcoes.body, '{"numeroConvenio":3453481}');
  assert.equal(ultima.opcoes.headers['Content-Type'], 'application/json');
});

test('testarConexao: token + listagem da conta; 404 "sem boletos" é sucesso; outro erro sobe', async () => {
  let relogio = 0;
  const { fetchImpl } = fetchFalso(url => {
    relogio += 15;
    if (url.endsWith('/oauth/token')) return { status: 200, corpo: { access_token: 'tok', expires_in: 600, scope: 'cobrancas.boletos-info' } };
    if (url.includes('agenciaBeneficiario=1614&contaBeneficiario=16773')) return { status: 404, corpo: { erros: [{ codigo: '4874916', mensagem: 'Nenhum boleto encontrado' }] } };
    if (url.includes('contaBeneficiario=1')) return { status: 200, corpo: { boletos: [{}, {}] } };
    return { status: 500, corpo: { erros: [{ mensagem: 'Erro interno' }] } };
  });
  const cliente = bb.criar({ fetchImpl, env: {}, agora: () => relogio });
  // Agência e conta SEM o dígito (ele tem coluna própria); um "1614-4" viraria 16144 e o BB não acharia a conta.
  const r = await cliente.testarConexao({ ...CRED, appKey: 'app', agencia: '1614', conta: '16773' });
  assert.equal(r.ok, true);
  assert.equal(r.boletosAbertos, 0);
  assert.match(r.observacao, /ainda não tem boletos/);
  assert.deepEqual(r.escopos, ['cobrancas.boletos-info']);
  assert.ok(r.tempoMs > 0);
  assert.equal((await cliente.testarConexao({ ...CRED, appKey: 'app', agencia: '1', conta: '1' })).boletosAbertos, 2);
  await assert.rejects(() => cliente.testarConexao({ ...CRED, appKey: 'app', agencia: '9', conta: '9' }), /respondeu 500 .*Erro interno/);
});

test('mensagemDoBB cobre os formatos que o banco usa', () => {
  assert.equal(bb.mensagemDoBB({ erros: [{ codigo: '1', mensagem: 'a' }, { mensagem: 'b' }] }), '1 — a | b');
  assert.equal(bb.mensagemDoBB({ errors: [{ code: 'X', message: 'm' }] }), 'X — m');
  assert.equal(bb.mensagemDoBB({ error: 'invalid_client', error_description: 'desc' }), 'desc');
  assert.equal(bb.mensagemDoBB(null), '');
  assert.deepEqual(bb.ESCOPOS, ['cobrancas.boletos-info', 'cobrancas.boletos-requisicao']);
});
