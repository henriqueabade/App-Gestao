/**
 * Os avisos do sino no Windows com o programa em segundo plano (01/10/2026):
 * o aparelho fica do último usuário que entrou, pergunta pelo token só dos
 * avisos (renovado sozinho), cai para a sessão quando a API ainda não tem as
 * rotas, gera os lembretes das tarefas e só mostra o que é novo — nunca com o
 * programa na frente, e nunca o histórico inteiro na primeira vez.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const W = require('./avisosNoWindows');
const { criarAvisosDoDispositivo } = require('./avisosDoDispositivo');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'avisos-windows-'));
let contador = 0;
const arquivoNovo = () => path.join(pasta, `estado-${++contador}.json`);
test.after(() => fs.rmSync(pasta, { recursive: true, force: true }));

/** "Cifra" de mentira: dá para ver que o texto puro não foi para o disco. */
const cofre = { cifrar: t => `cifrado:${Buffer.from(t).toString('base64')}`, decifrar: c => Buffer.from(c.replace('cifrado:', ''), 'base64').toString() };

/** A API remota e o servidor interno de mentira: respondem pelo caminho e guardam as chamadas. */
function redeFalsa(rotas) {
  const chamadas = [];
  const fetch = async (url, opcoes = {}) => {
    const caminho = new URL(url).pathname;
    const metodo = opcoes.method || 'GET';
    chamadas.push({ metodo, caminho, auth: opcoes.headers?.Authorization || null, corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
    const r = rotas[`${metodo} ${caminho}`];
    const resposta = typeof r === 'function' ? r(opcoes) : r;
    if (!resposta) return { ok: false, status: 404, json: async () => ({ error: 'não existe' }) };
    return { ok: resposta.status < 400, status: resposta.status, json: async () => resposta.corpo };
  };
  return { fetch, chamadas };
}

const AVISO = (id, extra = {}) => ({ id, tipo: 'registro_alterado', titulo: 'Prospecção atualizada', mensagem: 'Ana atualizou a prospecção ACME.\n• Etapa: A → B\n» por causa do preço', lida_em: null, criado_em: '2026-10-01T10:00:00Z', ...extra });

test('normalizarAviso: linha crua da API e aviso do sino ficam no mesmo formato', () => {
  const daApi = W.normalizarAviso(AVISO(7, { autor: 'Ana' }));
  assert.deepStrictEqual([daApi.mensagem, daApi.mudancas, daApi.notas, daApi.lida, daApi.autor], ['Ana atualizou a prospecção ACME.', ['Etapa: A → B'], ['por causa do preço'], false, 'Ana']);
  const doSino = W.normalizarAviso({ id: 8, titulo: 'x', mensagem: 'y', mudancas: [], notas: ['n'], lida: true });
  assert.deepStrictEqual([doSino.mensagem, doSino.notas, doSino.lida], ['y', ['n'], true]);
  assert.strictEqual(W.normalizarAviso({ titulo: 'sem id' }), null);
  assert.deepStrictEqual(W.novosParaMostrar([{ id: 5, lida: false }, { id: 9, lida: false }, { id: 7, lida: true }, { id: 3, lida: false }], 4).map(a => a.id), [5, 9]);
});

test('login → token do aparelho (cifrado no disco); a 1ª volta só marca; depois, só o novo — e nada com o programa na frente', async () => {
  const arquivo = arquivoNovo();
  let itens = [AVISO(10), AVISO(11)];
  const rede = redeFalsa({
    'POST /avisos/dispositivo': { status: 200, corpo: { token: 'tok-aparelho', usuario: { id: 2, nome: 'Ana' } } },
    'GET /avisos/meus': () => ({ status: 200, corpo: { itens } }),
    'GET /avisos/tarefas': { status: 200, corpo: { tarefas: [] } }
  });
  const aparelho = { computador: 'PC-VENDAS-01', usuario_windows: 'ana' };
  const s = W.criarAvisosNoWindows({ arquivo, cofre, apiBase: 'https://api.teste', fetch: rede.fetch, aparelho });
  assert.strictEqual(await s.lembrarUsuario({ id: 2, nome: 'Ana' }, 'tok-sessao'), true);
  assert.deepStrictEqual(rede.chamadas[0], { metodo: 'POST', caminho: '/avisos/dispositivo', auth: 'Bearer tok-sessao', corpo: aparelho }, 'diz qual computador é');
  const noDisco = fs.readFileSync(arquivo, 'utf8');
  assert.ok(!noDisco.includes('tok-aparelho') && noDisco.includes('cifrado:'), 'o token não fica em texto no disco');

  assert.deepStrictEqual((await s.ciclo()).novos, [], '1ª vez: não despeja o histórico');
  itens = [AVISO(12, { notas: undefined }), ...itens];
  const r = await s.ciclo();
  assert.deepStrictEqual(r.novos.map(a => a.id), [12]);
  assert.strictEqual(r.naoLidos, 3);
  assert.ok(rede.chamadas.filter(c => c.caminho === '/avisos/meus').every(c => c.auth === 'Bearer tok-aparelho'));

  itens = [AVISO(13), ...itens];
  assert.deepStrictEqual((await s.ciclo({ emFoco: true })).novos, [], 'programa na frente: quem avisa é o sino');
  assert.deepStrictEqual((await s.ciclo()).novos, [], 'e não aparece depois');

  // Outro computador ligado: um serviço novo lê o estado do disco.
  const outro = W.criarAvisosNoWindows({ arquivo, cofre, apiBase: 'https://api.teste', fetch: rede.fetch });
  itens = [AVISO(14), ...itens];
  assert.deepStrictEqual((await outro.ciclo()).novos.map(a => a.id), [14], 'o que chegou com o programa fechado aparece ao abrir');
});

test('renovação: o token novo da resposta substitui o velho; 401 derruba o token e a sessão segura', async () => {
  const arquivo = arquivoNovo();
  let tokenAceito = 'tok-1';
  const rede = redeFalsa({
    'POST /avisos/dispositivo': { status: 200, corpo: { token: 'tok-1' } },
    'GET /avisos/meus': o => (o.headers.Authorization === `Bearer ${tokenAceito}`
      ? { status: 200, corpo: { itens: [AVISO(1)], token_novo: tokenAceito === 'tok-1' ? 'tok-2' : undefined } }
      : { status: 401, corpo: { error: 'não' } }),
    'GET /api/notificacoes': { status: 200, corpo: { itens: [{ id: 1, titulo: 'x', mensagem: 'y', mudancas: [], notas: [], lida: false }] } }
  });
  let sessaoValida = false;
  const s = W.criarAvisosNoWindows({
    arquivo, cofre, apiBase: 'https://api.teste', fetch: rede.fetch,
    sessao: () => ({ token: 'tok-sessao', valido: sessaoValida, usuarioId: 2 }), enderecoLocal: () => 'http://127.0.0.1:3000'
  });
  await s.lembrarUsuario({ id: 2 }, 'tok-sessao');
  await s.buscar();
  tokenAceito = 'tok-2';
  assert.ok(await s.buscar(), 'o renovado vale');
  assert.strictEqual(rede.chamadas.filter(c => c.caminho === '/avisos/meus').pop().auth, 'Bearer tok-2');

  tokenAceito = 'outro';
  assert.strictEqual(await s.buscar(), null, '401 e sem sessão: nada a perguntar');
  assert.strictEqual(s.temTokenDoAparelho(), false, 'o token recusado sai');
  sessaoValida = true;
  const pelaSessao = await s.buscar();
  assert.deepStrictEqual(pelaSessao.map(a => a.id), [1]);
  assert.strictEqual(rede.chamadas.pop().auth, 'Bearer tok-sessao');
});

test('computador cancelado pelo Sup Admin: fica quieto (nem pela sessão aberta) até a pessoa entrar de novo', async () => {
  let cancelado = false;
  const rede = redeFalsa({
    'POST /avisos/dispositivo': { status: 200, corpo: { token: 'tok-pc', computador_id: 4 } },
    'GET /avisos/meus': () => (cancelado ? { status: 401, corpo: { error: 'cancelado', cancelado: true } } : { status: 200, corpo: { itens: [AVISO(1)] } }),
    'GET /avisos/tarefas': () => (cancelado ? { status: 401, corpo: { cancelado: true } } : { status: 200, corpo: { tarefas: [] } }),
    'GET /api/notificacoes': { status: 200, corpo: { itens: [{ id: 1, titulo: 'x', mensagem: 'y', lida: false }] } }
  });
  const arquivo = arquivoNovo();
  const s = W.criarAvisosNoWindows({
    arquivo, cofre, apiBase: 'https://api.teste', fetch: rede.fetch,
    sessao: () => ({ token: 'tok-sessao', valido: true, usuarioId: 2 }), enderecoLocal: () => 'http://127.0.0.1:3000'
  });
  await s.lembrarUsuario({ id: 2 }, 'tok-sessao');
  assert.ok(await s.buscar());
  cancelado = true;
  assert.strictEqual(await s.buscar(), null);
  assert.strictEqual(s.cancelado(), true);
  assert.strictEqual(s.temTokenDoAparelho(), false);
  const antes = rede.chamadas.length;
  assert.strictEqual(await s.buscar(), null, 'nem pela sessão aberta');
  assert.strictEqual(await s.gerarLembretes(), 0);
  assert.strictEqual(rede.chamadas.length, antes, 'não pergunta mais nada, nem pede outro token');
  assert.strictEqual(W.criarAvisosNoWindows({ arquivo, cofre, apiBase: 'https://api.teste', fetch: rede.fetch }).cancelado(), true, 'vale depois de reiniciar');

  cancelado = false;
  await s.lembrarUsuario({ id: 2 }, 'tok-sessao');
  assert.strictEqual(s.cancelado(), false, 'entrar de novo religa');
  assert.ok(await s.buscar());
});

test('esteComputador: o nome do computador e o usuário do Windows', () => {
  assert.deepStrictEqual(W.esteComputador({ hostname: () => 'PC-1', userInfo: () => ({ username: 'marcia' }) }), { computador: 'PC-1', usuario_windows: 'marcia' });
  assert.deepStrictEqual(W.esteComputador({ hostname: () => 'PC-2', userInfo: () => { throw new Error('sem'); } }), { computador: 'PC-2', usuario_windows: null });
});

test('API sem as rotas novas (404): o aparelho usa a sessão do programa enquanto ela vale e é do mesmo usuário', async () => {
  const rede = redeFalsa({
    'GET /api/notificacoes': { status: 200, corpo: { itens: [{ id: 3, titulo: 'x', mensagem: 'y', lida: false }] } },
    'POST /api/tarefas/avisos': { status: 200, corpo: { novos: [{ id: 9 }] } }
  });
  let usuarioDaSessao = 2;
  const s = W.criarAvisosNoWindows({
    arquivo: arquivoNovo(), cofre, apiBase: 'https://api.teste', fetch: rede.fetch,
    sessao: () => ({ token: 'tok-sessao', valido: true, usuarioId: usuarioDaSessao }), enderecoLocal: () => 'http://127.0.0.1:3000'
  });
  assert.strictEqual(await s.lembrarUsuario({ id: 2 }, 'tok-sessao'), false);
  assert.deepStrictEqual((await s.buscar()).map(a => a.id), [3]);
  assert.strictEqual(await s.gerarLembretes(), 1, 'os lembretes pelo mesmo caminho do sino');
  usuarioDaSessao = 5;
  assert.strictEqual(await s.buscar(), null, 'a sessão de OUTRA pessoa não serve');
});

test('lembretes pelo token do aparelho: as tarefas dele → os devidos (o cálculo do programa) → gravados na API', async () => {
  const rede = redeFalsa({
    'POST /avisos/dispositivo': { status: 200, corpo: { token: 'tok' } },
    'GET /avisos/tarefas': { status: 200, corpo: { tarefas: [{ id: 7, titulo: 'Ligar', data: '2026-09-28', hora: null, status: 'a_fazer' }, { id: 8, titulo: 'Futura', data: '2026-12-01', status: 'a_fazer' }] } },
    'POST /avisos/lembretes': o => ({ status: 200, corpo: { gravados: JSON.parse(o.body).avisos.length } })
  });
  const s = W.criarAvisosNoWindows({ arquivo: arquivoNovo(), cofre, apiBase: 'https://api.teste', fetch: rede.fetch, agora: () => new Date('2026-10-01T15:00:00Z') });
  await s.lembrarUsuario({ id: 2 }, 'tok-sessao');
  assert.strictEqual(await s.gerarLembretes(), 1);
  const enviado = rede.chamadas.find(c => c.caminho === '/avisos/lembretes').corpo.avisos;
  assert.deepStrictEqual(enviado.map(a => [a.tipo, a.registro_id, a.chave]), [['tarefa_atrasada', 7, 'atraso:7:2026-10-01']]);
});

test('sem cofre, o token fica só na memória; outro usuário que entra troca o dono; desligar esquece tudo', async () => {
  const arquivo = arquivoNovo();
  const rede = redeFalsa({ 'POST /avisos/dispositivo': o => ({ status: 200, corpo: { token: `tok-de-${o.headers.Authorization.slice(-1)}` } }) });
  const s = W.criarAvisosNoWindows({ arquivo, cofre: null, apiBase: 'https://api.teste', fetch: rede.fetch });
  await s.lembrarUsuario({ id: 2, nome: 'Ana' }, 'sessao-2');
  assert.ok(s.temTokenDoAparelho());
  assert.ok(!fs.readFileSync(arquivo, 'utf8').includes('tok-de'), 'nada em texto no disco');
  await s.lembrarUsuario({ id: 3, nome: 'Bruno' }, 'sessao-3');
  assert.deepStrictEqual(s.usuario(), { id: 3, nome: 'Bruno' });
  s.esquecer();
  assert.strictEqual(s.usuario(), null);
  assert.strictEqual(s.temTokenDoAparelho(), false);
  assert.strictEqual(await s.buscar(), null);
});

test('DEV: a cópia do módulo da API contra o banco local, com o assinador desta execução', async () => {
  const banco = {
    async query(sql, p) {
      if (sql.startsWith('SELECT id, nome, status FROM usuarios')) return { rows: p[0] === 2 ? [{ id: 2, nome: 'Ana', status: 'ativo' }] : [] };
      if (sql.includes('FROM notificacoes n LEFT JOIN usuarios')) return { rows: [AVISO(40, { autor: 'Carla' })] };
      // Sem sql/avisos_dispositivos.sql no banco local: funciona sem a lista.
      if (sql.includes('avisos_dispositivos')) throw Object.assign(new Error('relation "avisos_dispositivos" does not exist'), { code: '42P01' });
      throw new Error('consulta inesperada: ' + sql);
    }
  };
  const assinador = W.criarAssinadorLocal();
  const s = W.criarAvisosNoWindows({
    arquivo: arquivoNovo(), cofre, emDev: true,
    local: { modulo: criarAvisosDoDispositivo({ pool: banco, ...assinador }), verificarSessao: () => ({ id: 2 }) }
  });
  assert.strictEqual(await s.lembrarUsuario({ id: 2 }, 'sessao-dev'), true);
  const avisos = await s.buscar();
  assert.deepStrictEqual([avisos[0].id, avisos[0].autor, avisos[0].notas], [40, 'Carla', ['por causa do preço']]);
  assert.throws(() => assinador.verificar('x.y'), 'assinatura de outra execução não vale');
});

test('a cópia do app é o módulo da API, com o mesmo corpo', () => {
  const daApi = path.join(__dirname, '..', '..', 'Santissimo-db-API', 'avisos', 'dispositivo.js');
  if (!fs.existsSync(daApi)) return; // a API não está ao lado nesta máquina
  const corpo = t => t.slice(t.indexOf('const ESCOPO'));
  assert.strictEqual(corpo(fs.readFileSync(path.join(__dirname, 'avisosDoDispositivo.js'), 'utf8')), corpo(fs.readFileSync(daApi, 'utf8')));
});
