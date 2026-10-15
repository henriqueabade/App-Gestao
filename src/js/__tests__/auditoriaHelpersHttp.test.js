/** O gesto capturado no início do helper sobrevive à resolução assíncrona da API. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');

const raiz = path.join(__dirname, '../..');
const tracker = fs.readFileSync(path.join(raiz, 'utils/activityTracker.js'), 'utf8');

function montar({ comAuditoria = true, resposta = { ok: true, status: 200, json: async () => ({ success: true }) } } = {}) {
  const requisicoes = [];
  const bases = [];
  class Evento {
    constructor() {
      this.type = 'click';
      this.isTrusted = true;
      this.target = { id: 'salvarCadastro', dataset: { perm: 'cli.edit' } };
    }
  }
  const window = {
    Event: Evento, Request, crypto: webcrypto,
    location: { href: 'https://app.test/menu.html', pathname: '/menu.html' },
    apiConfig: { getApiBaseUrl: () => new Promise(resolve => bases.push(resolve)) },
    fetch: async (input, init) => { requisicoes.push({ input, init }); return resposta; }
  };
  const contexto = vm.createContext({
    window, document: { getElementById: () => ({ dataset: { page: 'clientes' } }) },
    URL, Headers, Request, Uint8Array, console,
    fetch: (...args) => window.fetch(...args),
    base: () => window.apiConfig.getApiBaseUrl()
  });
  if (comAuditoria) vm.runInContext(tracker, contexto);
  function carregar(arquivo, nome) {
    const fonte = fs.readFileSync(path.join(raiz, arquivo), 'utf8');
    const ast = ts.createSourceFile(arquivo, fonte, ts.ScriptTarget.Latest, true);
    let funcao;
    function procurar(no) {
      if (ts.isFunctionDeclaration(no) && no.name?.text === nome) funcao = no;
      else ts.forEachChild(no, procurar);
    }
    procurar(ast);
    assert.ok(funcao, `${arquivo}: ${nome}`);
    return vm.runInContext(`(${funcao.getText(ast)})`, contexto);
  }
  return { window, Evento, requisicoes, bases, carregar, resposta };
}

const AMOSTRAS = [
  ['js/clientes.js', 'fetchApi'],
  ['js/modals/pedido-trocar-pecas.js', 'fetchApi'],
  ['js/financeiro.js', 'finChamarApi'],
  ['js/utils/transportadoras.js', 'pedir']
];

for (const [arquivo, nome] of AMOSTRAS) {
  test(`${arquivo}: ação, automação e consulta concorrente mantêm contextos separados após await`, async () => {
    const m = montar();
    const chamar = m.carregar(arquivo, nome);
    const corpo = JSON.stringify({ nome: 'Cliente', senha: 'segredo-excluido-do-contexto' });
    m.window.event = new m.Evento();
    const acao = chamar('/api/clientes/7', { method: 'PUT', body: corpo, headers: { 'X-Teste': 'preservado' } });
    assert.equal(m.bases.length, 1, 'o helper iniciou antes de sair do gesto');
    m.window.event = undefined;
    const automatico = m.window.AuditoriaAcao.automatico(() => chamar('/api/clientes/8'));
    const consulta = chamar('/api/clientes/9');
    assert.equal(m.requisicoes.length, 0, 'a URL ainda está sendo resolvida');
    for (const resolver of m.bases) resolver('https://app.test');
    await Promise.all([acao, automatico, consulta]);

    const [manual, sistema, naoConfirmada] = m.requisicoes;
    assert.equal(manual.input, 'https://app.test/api/clientes/7');
    assert.equal(manual.init.method, 'PUT');
    assert.equal(manual.init.body, corpo, 'a operação conserva seu corpo; a auditoria usa só cabeçalhos');
    assert.equal(manual.init.headers.get('X-Teste'), 'preservado');
    assert.equal(manual.init.headers.get('X-Auditoria-Origem'), 'manual');
    assert.equal(sistema.init.headers.get('X-Auditoria-Origem'), 'automatico');
    assert.equal(naoConfirmada.init.headers.get('X-Auditoria-Origem'), 'nao_confirmada');
    assert.notEqual(manual.init.headers.get('X-Auditoria-Acao'), sistema.init.headers.get('X-Auditoria-Acao'));
    assert.doesNotMatch(manual.init.headers.get('X-Auditoria-Contexto'), /segredo|senha|Cliente/);
  });
}

test('sem a ponte de auditoria o helper conserva a resposta e opções existentes', async () => {
  const m = montar({ comAuditoria: false });
  const chamar = m.carregar('js/clientes.js', 'fetchApi');
  const opcoes = { method: 'POST', body: '{"nome":"Cliente"}' };
  const pendente = chamar('/api/clientes', opcoes);
  m.bases[0]('https://app.test');
  assert.equal(await pendente, m.resposta);
  assert.equal(m.requisicoes[0].init, opcoes);
});

test('erro HTTP conserva a mensagem do servidor e o gesto da operação', async () => {
  const m = montar({ resposta: { ok: false, status: 422, json: async () => ({ error: 'Quantidade inválida.' }) } });
  const chamar = m.carregar('js/modals/pedido-trocar-pecas.js', 'fetchApi');
  m.window.event = new m.Evento();
  const pendente = chamar('/api/pedido-troca', { method: 'POST' });
  m.window.event = undefined;
  m.bases[0]('https://app.test');
  await assert.rejects(pendente, e => e.status === 422 && e.message === 'Quantidade inválida.');
  assert.equal(m.requisicoes[0].init.headers.get('X-Auditoria-Origem'), 'manual');
});
