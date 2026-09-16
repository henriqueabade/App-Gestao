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
  assert.equal(chamadas[0].url, 'https://oauth.hm.bb.com.br/oauth/token');
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
  const { fetchImpl, chamadas } = fetchFalso(() => ({ status: 401, corpo: { error: 'invalid_client', error_description: 'Invalid client credentials' } }));
  const cliente = bb.criar({ fetchImpl, env: { BB_URL_OAUTH_SANDBOX: 'https://oauth.exemplo/token', BB_URL_API_SANDBOX: 'https://api.exemplo/v2/' } });
  assert.deepEqual(cliente.urls('sandbox'), { nome: 'env', oauth: 'https://oauth.exemplo/token', api: 'https://api.exemplo/v2' });
  await assert.rejects(() => cliente.obterToken(CRED), e => e.status === 401 && /recusou as credenciais \(401\): Invalid client credentials/.test(e.message));
  assert.equal(chamadas.length, 1, 'credencial recusada é definitiva: não tenta outro host');

  const quebrado = bb.criar({ fetchImpl: async () => { const e = new Error('fetch failed'); e.cause = { code: 'ECONNRESET' }; throw e; }, env: {} });
  await assert.rejects(() => quebrado.obterToken(CRED), /A homologação do BB está fora do ar \(oauth\.hm\.bb\.com\.br: Não foi possível falar com o BB: ECONNRESET\)\. Não é a sua configuração/);

  const semToken = bb.criar({ fetchImpl: fetchFalso(() => ({ status: 200, corpo: {} })).fetchImpl, env: {} });
  await assert.rejects(() => semToken.obterToken(CRED), /não devolveu o token/);
});

test('o ambiente de testes é a HOMOLOGAÇÃO (oauth.hm / api.hm), nunca o sandbox do portal; fora do ar, a tela diz que é o banco', async () => {
  assert.deepEqual(bb.HOSTS.sandbox, [{ nome: 'homologacao', oauth: 'https://oauth.hm.bb.com.br/oauth/token', api: 'https://api.hm.bb.com.br/cobrancas/v2' }]);
  assert.deepEqual(bb.HOSTS.producao.map(h => h.nome), ['producao']);
  assert.ok(!JSON.stringify(bb.HOSTS).includes('.sandbox.'), 'o sandbox do portal não é usado');

  // Token e API pelo mesmo par: a listagem vai para api.hm com a app key em gw-dev-app-key.
  const { fetchImpl, chamadas } = fetchFalso(url => {
    if (url.startsWith('https://oauth.hm.bb.com.br/')) return { status: 200, corpo: { access_token: 'tok-hm', expires_in: 600 } };
    if (url.startsWith('https://api.hm.bb.com.br/cobrancas/v2/boletos')) return { status: 200, corpo: { indicadorContinuidade: 'N', boletos: [{ numeroBoletoBB: '00031285570792275389' }], quantidadeRegistros: 1 } };
    return { status: 500, corpo: { erros: [{ mensagem: 'host errado' }] } };
  });
  const r = await bb.criar({ fetchImpl, env: {} }).testarConexao({ ...CRED, appKey: 'app', agencia: '452', conta: '123873' });
  assert.equal(r.boletosAbertos, 1);
  assert.equal(r.hosts.nome, 'homologacao');
  assert.equal(chamadas[1].url, 'https://api.hm.bb.com.br/cobrancas/v2/boletos?gw-dev-app-key=app&indicadorSituacao=A&agenciaBeneficiario=452&contaBeneficiario=123873');

  // Fora do ar (504 do nginx): mensagem de banco, não de configuração.
  const { fetchImpl: fora } = fetchFalso(() => ({ status: 504, corpo: '<html>\r\n<head><title>504 Gateway Time-out</title></head><body>nginx</body></html>' }));
  await assert.rejects(() => bb.criar({ fetchImpl: fora, env: {} }).obterToken(CRED),
    e => e.status === 502 && /A homologação do BB está fora do ar \(oauth\.hm\.bb\.com\.br: respondeu 504 — o banco devolveu uma página \(504 Gateway Time-out\)\)\. Não é a sua configuração/.test(e.message));

  // Certificado vencido do lado do banco vira texto claro.
  const vencido = bb.criar({ fetchImpl: async () => { const e = new Error('fetch failed'); e.cause = { code: 'CERT_HAS_EXPIRED' }; throw e; }, env: {} });
  await assert.rejects(() => vencido.obterToken(CRED), /fora do ar \(oauth\.hm\.bb\.com\.br: Não foi possível falar com o BB: certificado TLS do banco vencido\)/);
  assert.equal(bb.mensagemDoBB({ bruto: '<html><body>x</body></html>' }), 'o banco devolveu uma página HTML em vez da resposta (bloqueio ou indisponibilidade)');
  // O formato de erro da API Cobranças (codigoMensagem / textoMensagem / textoProvidencia).
  assert.equal(bb.mensagemDoBB({ erros: [{ codigoMensagem: '4874915', versaoMensagem: '1', textoMensagem: 'Nosso Número já incluído anteriormente.', textoProvidencia: 'Informar outro Nosso Número.', codigoRetorno: '1053' }] }),
    '4874915 — Nosso Número já incluído anteriormente. — Informar outro Nosso Número.');
});

test('403 depois do token: a tela recebe o detalhe do gateway; produção usa gw-app-key', async () => {
  const { fetchImpl, chamadas } = fetchFalso(url => {
    if (url.includes('/oauth/token')) return { status: 200, corpo: { access_token: 'tok', expires_in: 600 } };
    return { status: 403, corpo: { detail: 'A chave de aplicacao (AppKey) informada e invalida', userHelp: 'Verifique se a aplicacao esta autorizada' } };
  });
  const cliente = bb.criar({ fetchImpl, env: {} });
  await assert.rejects(() => cliente.testarConexao({ ...CRED, appKey: 'app', agencia: '1614', conta: '16773' }),
    e => e.status === 403 && /Token obtido .* recusou a consulta de boletos \(403\): A chave de aplicacao \(AppKey\) informada e invalida — Verifique se a aplicacao esta autorizada\. Consultou a agência 1614 \/ conta 16773: na homologação o BB só aceita a conta de teste da documentação \(452 \/ 123873\)/.test(e.message));
  assert.ok(chamadas.at(-1).url.includes('gw-dev-app-key=app'));

  await assert.rejects(() => cliente.chamar({ ambiente: 'producao', appKey: 'prod', credenciais: CRED, caminho: '/boletos' }));
  const prod = chamadas.at(-1);
  assert.match(prod.url, /^https:\/\/api\.bb\.com\.br\/cobrancas\/v2\/boletos\?gw-app-key=prod$/);
  assert.equal(prod.opcoes.headers['gw-app-key'], 'prod');
  assert.ok(!('gw-dev-app-key' in prod.opcoes.headers));
});

test('instabilidade do BB (503) numa consulta: espera e repete uma vez; se persistir, a mensagem diz que é o banco; registro (POST) não repete', async () => {
  const erro503 = { erros: [{ codigoMensagem: '3264812', textoMensagem: 'Aconteceu um problema técnico.', textoProvidencia: 'Tente novamente mais tarde.' }] };
  let consultas = 0;
  const esperas = [];
  const { fetchImpl } = fetchFalso(url => {
    if (url.includes('/oauth/token')) return { status: 200, corpo: { access_token: 'tok', expires_in: 600 } };
    consultas += 1;
    return consultas === 1 ? { status: 503, corpo: erro503 } : { status: 200, corpo: { boletos: [{}, {}] } };
  });
  const cliente = bb.criar({ fetchImpl, env: {}, esperar: async ms => { esperas.push(ms); } });
  const r = await cliente.testarConexao({ ...CRED, appKey: 'app', agencia: '452', conta: '123873' });
  assert.equal(r.boletosAbertos, 2, 'a segunda tentativa respondeu');
  assert.equal(consultas, 2);
  assert.deepEqual(esperas, [1500]);

  // Persistindo: duas tentativas e a mensagem de instabilidade.
  const { fetchImpl: sempre503, chamadas } = fetchFalso(url => (url.includes('/oauth/token') ? { status: 200, corpo: { access_token: 'tok', expires_in: 600 } } : { status: 503, corpo: erro503 }));
  const persistente = bb.criar({ fetchImpl: sempre503, env: {}, esperar: async () => {} });
  await assert.rejects(() => persistente.testarConexao({ ...CRED, appKey: 'app', agencia: '452', conta: '123873' }),
    e => e.status === 502 && /respondeu 503 em GET \/boletos: 3264812 — Aconteceu um problema técnico\. — Tente novamente mais tarde\.\. Instabilidade do Banco do Brasil, não da sua configuração/.test(e.message));
  assert.equal(chamadas.filter(c => !c.url.includes('/oauth/token')).length, 2);

  // POST não repete sozinho.
  const { fetchImpl: post503, chamadas: chamadasPost } = fetchFalso(url => (url.includes('/oauth/token') ? { status: 200, corpo: { access_token: 'tok', expires_in: 600 } } : { status: 503, corpo: erro503 }));
  await assert.rejects(() => bb.criar({ fetchImpl: post503, env: {}, esperar: async () => {} }).chamar({ ambiente: 'sandbox', appKey: 'app', credenciais: CRED, metodo: 'POST', caminho: '/boletos', corpo: {} }));
  assert.equal(chamadasPost.filter(c => !c.url.includes('/oauth/token')).length, 1);
});

test('mensagemDoBB cobre os formatos que o banco usa', () => {
  assert.equal(bb.mensagemDoBB({ erros: [{ codigo: '1', mensagem: 'a' }, { mensagem: 'b' }] }), '1 — a | b');
  assert.equal(bb.mensagemDoBB({ errors: [{ code: 'X', message: 'm' }] }), 'X — m');
  assert.equal(bb.mensagemDoBB({ error: 'invalid_client', error_description: 'desc' }), 'desc');
  assert.equal(bb.mensagemDoBB(null), '');
  assert.deepEqual(bb.ESCOPOS, ['cobrancas.boletos-info', 'cobrancas.boletos-requisicao']);
});
