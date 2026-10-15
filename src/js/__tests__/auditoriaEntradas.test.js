const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { criarAmbiente, esperarTarefas } = require('./apoio/domMinimo');

const RAIZ = path.join(__dirname, '..', '..', '..');
const ler = arquivo => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
const TRACKER = ler('src/utils/activityTracker.js');
const BOTOES = ler('src/utils/botaoAcao.js');
const PEDIDO = ler('src/js/modals/pedido-editar-pecas.js');
const USUARIOS = ler('src/js/usuarios.js');
const EDITAR_USUARIO = ler('src/js/modals/usuario-editar.js');
function recorte(fonte, inicio, fim) {
  const a = fonte.indexOf(inicio);
  const b = fonte.indexOf(fim, a + inicio.length);
  assert.ok(a >= 0 && b > a, inicio);
  return fonte.slice(a, b);
}
const adiar = () => {
  let resolver;
  const promessa = new Promise(resolve => { resolver = resolve; });
  return { promessa, resolver };
};

function ambiente() {
  const amb = criarAmbiente();
  const { janela } = amb;
  // O navegador fornece isTrusted; a classe de teste representa esse limite.
  janela.Event = class EventoDoNavegador extends amb.Evento {
    constructor(tipo, init = {}) { super(tipo, init); this.isTrusted = init.trusted === true; }
  };
  janela.crypto = webcrypto;
  janela.Request = Request;
  janela.URL = URL;
  janela.Headers = Headers;
  janela.location = { href: 'https://app.test/menu.html', pathname: '/menu.html' };
  const chamadas = [];
  janela.fetch = async (url, init) => {
    chamadas.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ id: 7, avisos: [], totais: { valor_final: 100 }, edicao_id: 55 }) };
  };
  janela.apiConfig = { getApiBaseUrl: async () => { await Promise.resolve(); return 'https://app.test'; } };
  const contexto = vm.createContext(janela);
  vm.runInContext(TRACKER, contexto);
  const gesto = (tipo = 'click', trusted = true) => new janela.Event(tipo, { trusted, bubbles: true, cancelable: true });
  return { ...amb, contexto, chamadas, gesto, avaliar: fonte => vm.runInContext(fonte, contexto) };
}

function conferir(m, gesto, indice) {
  const headers = m.chamadas[indice].init.headers;
  assert.equal(headers.get('X-Auditoria-Origem'), 'manual');
  assert.equal(headers.get('X-Auditoria-Acao'), m.janela.AuditoriaAcao.capturar(gesto).acao_id);
}

test('BotaoAcao transmite o client capturado no clique e no submit, sem atribuir o polling concorrente', async () => {
  for (const tipo of ['click', 'submit']) {
    const m = ambiente();
    m.avaliar(BOTOES);
    const botao = m.documento.createElement('button');
    botao.type = 'submit';
    botao.id = 'salvar';
    const form = m.documento.createElement('form');
    form.appendChild(botao);
    m.documento.body.appendChild(form);
    const confirmacao = adiar();
    const terminou = adiar();
    const handler = async (evento, auditoria) => {
      assert.ok(auditoria, 'o segundo argumento é capturado antes do primeiro await');
      await confirmacao.promessa;
      await auditoria.fetch('https://app.test/api/pedidos/1', { method: 'PUT' });
      terminou.resolver();
    };
    if (tipo === 'click') m.janela.BotaoAcao.bind(botao, handler);
    else m.janela.BotaoAcao.bindSubmit(form, handler, { botao });
    const evento = m.gesto(tipo);
    (tipo === 'click' ? botao : form).dispatchEvent(evento);
    await Promise.resolve();
    await m.janela.fetch('https://app.test/api/avisos/1', { method: 'PUT' });
    assert.equal(m.chamadas[0].init.headers.get('X-Auditoria-Origem'), 'nao_confirmada');
    confirmacao.resolver(true);
    await terminou.promessa;
    conferir(m, evento, 1);
  }
});

test('salvar peças preserva o gesto original depois da confirmação e da resolução assíncrona da API', async () => {
  const m = ambiente();
  const confirmacao = adiar();
  Object.assign(m.janela, {
    previa: { assinatura: 'assinatura', valores: { antes: { valor_final: 90 }, depois: { valor_final: 100 } } },
    dados: { pedido: { numero: 'PED121' } }, edicao: {}, pedidoId: 121, decisoes: [], conversao: null,
    el: () => ({ value: 'Cliente escolheu outra peça' }), reais: v => String(v), entradaDaEdicao: () => ({ linhas: [] }),
    fechar() {}, mensagem() {}, avisar() {}, carregar() {},
    DialogPadrao: { confirm: () => confirmacao.promessa }
  });
  const salvar = m.avaliar(`${recorte(PEDIDO, '  async function fetchApi(', '  const fechar =')}\n${recorte(PEDIDO, '  async function salvar(', '  function adicionar(')}\nsalvar`);
  const evento = m.gesto();
  const pendente = salvar(evento);
  await Promise.resolve();
  assert.equal(m.chamadas.length, 0);
  await m.janela.fetch('https://app.test/api/avisos/1', { method: 'PUT' });
  assert.equal(m.chamadas[0].init.headers.get('X-Auditoria-Origem'), 'nao_confirmada');
  confirmacao.resolver(true);
  await pendente;
  conferir(m, evento, 1);
  assert.equal(m.chamadas[1].url, 'https://app.test/api/pedido-edicao/121');
});

test('solicitar termos preserva autoria após diálogo, e eventos sintéticos continuam sem origem confirmada', async () => {
  for (const trusted of [true, false]) {
    const m = ambiente();
    const confirmacao = adiar();
    Object.assign(m.janela, {
      usuarioLogado: { id: 1, email: 'dono@teste.com' }, carregarUsuarioLogado: () => null,
      baseApiParaFotos: '', usuariosCache: [], usuariosRecemAlterados: new Set(),
      refreshUsuariosAposAtualizacao() {}, showToast() {},
      DialogPadrao: { confirm: () => confirmacao.promessa },
      BotaoAcao: { comCarregamento: fn => fn() }
    });
    const pedir = m.avaliar(`${recorte(USUARIOS, 'async function fetchApi(', '// Cache local')}\n${recorte(USUARIOS, 'async function pedirAceiteDosTermos(', 'function criarBotaoAuditoriaUsuario(')}\npedirAceiteDosTermos`);
    const evento = m.gesto('click', trusted);
    const pendente = pedir({ id: 7, nome: 'Henrique' }, { disabled: false }, evento);
    await Promise.resolve();
    confirmacao.resolver(true);
    await pendente;
    assert.equal(m.chamadas.length, 1);
    if (trusted) conferir(m, evento, 0);
    else assert.equal(m.chamadas[0].init.headers.get('X-Auditoria-Origem'), 'nao_confirmada');
  }
});

test('salvar dados do usuário usa o client explícito e não recaptura outro gesto durante await', async () => {
  const m = ambiente();
  const botao = m.documento.createElement('button');
  Object.assign(m.janela, {
    salvarBtn: botao, podeEditarDados: true, usuarioBase: { id: 7 },
    limparMensagem() {}, coletarDadosFormulario: () => ({ nome: 'Henrique Abade' }),
    exibirMensagem() {}, close() {}
  });
  const salvar = m.avaliar(`${recorte(EDITAR_USUARIO, '  async function fetchApi(', '  const close =')}\n${recorte(EDITAR_USUARIO, '  async function salvarAlteracoes(', '  salvarBtn?.addEventListener')}\nsalvarAlteracoes`);
  const evento = m.gesto();
  const vinculado = m.janela.AuditoriaAcao.vincular(evento);
  await Promise.resolve();
  await salvar(undefined, vinculado);
  conferir(m, evento, 0);
  assert.equal(m.chamadas[0].url, 'https://app.test/api/usuarios/7/dados');
  await m.janela.fetch('https://app.test/api/avisos/1', { method: 'PUT' });
  assert.equal(m.chamadas[1].init.headers.get('X-Auditoria-Origem'), 'nao_confirmada');
  await esperarTarefas();
});

test('os três helpers aceitam override assíncrono e operações sem gesto não herdam o client anterior', async () => {
  for (const [fonte, inicio, fim] of [
    [PEDIDO, '  async function fetchApi(', '  const fechar ='],
    [EDITAR_USUARIO, '  async function fetchApi(', '  const close ='],
    [USUARIOS, 'async function fetchApi(', '// Cache local']
  ]) {
    const m = ambiente();
    Object.assign(m.janela, { usuarioLogado: null, carregarUsuarioLogado: () => null, baseApiParaFotos: '' });
    const fetchApi = m.avaliar(`${recorte(fonte, inicio, fim)}\nfetchApi`);
    const evento = m.gesto();
    const auditoria = m.janela.AuditoriaAcao.vincular(evento);
    await Promise.resolve();
    await fetchApi('/api/usuarios/7', { method: 'PUT' }, auditoria);
    conferir(m, evento, 0);
    await fetchApi('/api/avisos/1', { method: 'PUT' });
    assert.equal(m.chamadas[1].init.headers.get('X-Auditoria-Origem'), 'nao_confirmada');
  }
});
