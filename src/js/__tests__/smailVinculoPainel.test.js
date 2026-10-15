const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente, esperarTarefas } = require('./apoio/domMinimo');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'utils', 'smail-vinculo.js'), 'utf8');
const plano = valor => JSON.parse(JSON.stringify(valor));
const adiar = () => { let resolver; const promessa = new Promise(r => { resolver = r; }); return { promessa, resolver }; };
const vinculo = {
  id: 'abc-123', caixa: 'pessoa@exemplo.com', status: 'ativo',
  criadoEm: '2026-10-01T12:00:00Z', expiraEm: '2027-10-01T12:00:00Z',
  escopos: ['crm', 'perfil'], reconhecimento_automatico: true
};

function preparar() {
  const amb = criarAmbiente();
  const { janela, documento } = amb;
  let agora = Date.parse('2026-10-15T16:00:00Z');
  const intervalos = new Map();
  let proximoIntervalo = 0;
  const observadores = new Set();
  const registro = { chamadas: [], copias: [], confirmacoes: [], toasts: [], auditorias: [] };
  let itens = [vinculo];
  let codigo = 0;
  let confirmar = true;
  let responder = null;
  janela.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [agora])); } static now() { return agora; } };
  janela.URL = URL;
  janela.setInterval = fn => { const id = ++proximoIntervalo; intervalos.set(id, fn); return id; };
  janela.clearInterval = id => intervalos.delete(id);
  janela.setTimeout = fn => { registro.temporizadorCopiar = fn; return 1; };
  janela.clearTimeout = () => { registro.temporizadorCopiar = null; };
  janela.MutationObserver = class {
    constructor(fn) { this.fn = fn; }
    observe() { observadores.add(this); }
    disconnect() { observadores.delete(this); }
  };
  janela.apiConfig = { getApiBaseUrl: async () => 'http://api.teste' };
  janela.navigator = { clipboard: { async writeText(texto) { registro.copias.push(texto); } } };
  janela.showToast = (...args) => registro.toasts.push(args);
  janela.DialogPadrao = { async confirm(opcoes) { registro.confirmacoes.push(opcoes); return typeof confirmar === 'function' ? confirmar() : confirmar; } };
  const resposta = (dados, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => plano(dados), headers: { get: () => null } });
  janela.fetch = async (url, opcoes) => {
    const chamada = { caminho: new URL(url).pathname, ...opcoes, corpo: opcoes.body ? JSON.parse(opcoes.body) : null };
    registro.chamadas.push(chamada);
    if (responder) {
      const especial = await responder(chamada);
      if (especial) return especial;
    }
    if (chamada.method === 'POST') {
      return resposta({ codigo: ++codigo === 1 ? 'ABCDE23456' : 'FGHJK789AB', expira_em: new Date(agora + 600000).toISOString(), validade_segundos: 600, escopos: chamada.corpo.escopos });
    }
    if (chamada.method === 'DELETE') {
      itens = itens.map(item => ({ ...item, revogadoEm: new Date(agora).toISOString(), status: 'revogado' }));
      return resposta(null, 204);
    }
    return resposta({ itens });
  };
  // A vinculação deve ser capturada antes da confirmação assíncrona de Encerrar.
  janela.AuditoriaAcao = { vincular() { const id = registro.auditorias.length + 1; registro.auditorias.push(id); return { fetch: (url, opcoes) => janela.fetch(url, { ...opcoes, auditoriaTeste: id }) }; } };
  vm.runInContext(fonte, vm.createContext(janela), { filename: 'smail-vinculo.js' });
  const raiz = amb.montar('<div class="sv-embutido"></div>').firstElementChild;
  const controle = janela.SmailVinculo.montarEm(raiz);
  return {
    ...amb, raiz, controle, registro, resposta,
    set confirmar(valor) { confirmar = valor; },
    set responder(fn) { responder = fn; },
    async pronto() { await controle.pronto; await esperarTarefas(); },
    async clicar(acao, painel = raiz) { const alvo = painel.querySelector(`[data-sv-acao="${acao}"]`); assert.ok(alvo, `botão ${acao} existe`); alvo.click(); await esperarTarefas(); },
    abrirModal() { janela.SmailVinculo.abrir(); return documento.querySelector('dialog'); },
    desmontar() { raiz.remove(); [...observadores].forEach(o => o.fn()); },
    avancar(ms) { agora += ms; [...intervalos.values()].forEach(fn => fn()); },
    intervalos,
    modal: () => documento.querySelector('dialog'),
    encerrados: painel => !painel.querySelector('[data-sv-acao="encerrar"]')
  };
}

test('card funciona sem modal: escopos, validação, gerar e copiar sem espaços', async () => {
  const m = preparar();
  await m.pronto();
  assert.equal(m.modal(), null);
  assert.equal(m.raiz.querySelectorAll('[data-sv-escopo]').length, 5);
  assert.match(m.raiz.textContent, /pessoa@exemplo.com/);
  for (const campo of m.raiz.querySelectorAll('[data-sv-escopo]')) campo.click();
  await m.clicar('gerar');
  assert.match(m.raiz.textContent, /Escolha ao menos uma/);
  assert.equal(m.registro.chamadas.filter(c => c.method === 'POST').length, 0);
  m.raiz.querySelector('[data-sv-escopo="crm"]').click();
  await m.clicar('gerar');
  const post = m.registro.chamadas.find(c => c.method === 'POST');
  assert.deepEqual(post.corpo, { escopos: ['crm'] });
  assert.equal(post.cache, 'no-store');
  assert.equal(m.raiz.querySelector('[data-sv="codigo"]').textContent, 'ABCDE 23456');
  await m.clicar('copiar');
  assert.deepEqual(m.registro.copias, ['ABCDE23456']);
  m.controle.destruir();
});

test('modal e card coexistem: fechar janela preserva card; código novo invalida o anterior nas duas superfícies', async () => {
  const m = preparar();
  await m.pronto();
  await m.clicar('gerar');
  let modal = m.abrirModal();
  await esperarTarefas();
  assert.equal(m.documento.querySelectorAll('#svTitulo').length, 1);
  assert.equal(modal.querySelector('[data-sv="codigo"]'), null);
  m.janela.SmailVinculo.fechar();
  assert.ok(m.raiz.querySelector('[data-sv="codigo"]'), 'fechar modal não destrói código do card');
  modal = m.abrirModal();
  await esperarTarefas();
  await m.clicar('gerar', modal);
  assert.equal(m.raiz.querySelector('[data-sv="codigo"]'), null, 'código antigo do card deixa de aparecer');
  assert.equal(modal.querySelector('[data-sv="codigo"]').textContent, 'FGHJK 789AB');
  assert.equal(m.intervalos.size, 1);
  m.janela.SmailVinculo.fechar();
  assert.equal(m.intervalos.size, 0);
  m.controle.destruir();
});

test('fechar modal com geração em andamento descarta resposta e apaga código do card invalidado pela API', async () => {
  const m = preparar();
  await m.pronto();
  await m.clicar('gerar');
  const modal = m.abrirModal();
  await esperarTarefas();
  const pendente = adiar();
  m.responder = c => c.method === 'POST' ? pendente.promessa : null;
  await m.clicar('gerar', modal);
  m.janela.SmailVinculo.fechar();
  pendente.resolver(m.resposta({ codigo: 'FGHJK789AB', expira_em: '2026-10-15T16:10:00Z' }));
  await esperarTarefas();
  assert.equal(m.modal(), null);
  assert.equal(m.raiz.querySelector('[data-sv="codigo"]'), null);
  assert.equal(m.intervalos.size, 0);
  assert.ok(!m.raiz.textContent.includes('FGHJK'));
  m.controle.destruir();
});

test('expiração e saída da tela apagam código e timer; o mesmo elemento pode ser montado outra vez', async () => {
  const m = preparar();
  await m.pronto();
  await m.clicar('gerar');
  const antes = m.registro.chamadas.length;
  m.avancar(600000);
  await esperarTarefas();
  assert.equal(m.raiz.querySelector('[data-sv="codigo"]'), null);
  assert.match(m.raiz.textContent, /O código venceu/);
  assert.ok(m.registro.chamadas.length > antes, 'expirar atualiza vínculos');
  await m.clicar('gerar');
  m.desmontar();
  assert.equal(m.intervalos.size, 0);
  assert.equal(m.raiz.querySelector('[data-sv="codigo"]').textContent, '');
  m.documento.body.appendChild(m.raiz);
  const novo = m.janela.SmailVinculo.montarEm(m.raiz);
  await novo.pronto;
  assert.notEqual(novo, m.controle);
  assert.equal(m.raiz.querySelector('[data-sv="codigo"]'), null);
  novo.destruir();
});

test('encerrar confirma a caixa, respeita cancelamento e sincroniza card/modal sem perder o contexto manual', async () => {
  const m = preparar();
  await m.pronto();
  const modal = m.abrirModal();
  await esperarTarefas();
  m.confirmar = false;
  await m.clicar('encerrar');
  assert.equal(m.registro.chamadas.filter(c => c.method === 'DELETE').length, 0);
  const confirmacao = adiar();
  m.confirmar = () => confirmacao.promessa;
  await m.clicar('encerrar');
  const auditoriaAntes = m.registro.auditorias.at(-1);
  confirmacao.resolver(true);
  await esperarTarefas();
  const exclusao = m.registro.chamadas.find(c => c.method === 'DELETE');
  assert.match(exclusao.caminho, /meus-vinculos\/abc-123$/);
  assert.equal(exclusao.auditoriaTeste, auditoriaAntes);
  assert.match(m.registro.confirmacoes.at(-1).message, /reconhecimento automático/);
  assert.equal(m.registro.confirmacoes.at(-1).resumo[0].valor, vinculo.caixa);
  assert.ok(m.encerrados(m.raiz) && m.encerrados(modal));
  assert.match(m.raiz.textContent, /Encerrado/);
  assert.match(modal.textContent, /Encerrado/);
  m.janela.SmailVinculo.fechar();
  m.controle.destruir();
});

test('resposta antiga da lista não ressuscita vínculo depois de encerrar', async () => {
  const m = preparar();
  await m.pronto();
  const pendente = adiar();
  let prender = true;
  m.responder = c => {
    if (c.method === 'GET' && prender) { prender = false; return pendente.promessa; }
    return null;
  };
  await m.clicar('atualizar');
  await m.clicar('encerrar');
  assert.ok(m.encerrados(m.raiz));
  pendente.resolver(m.resposta({ itens: [vinculo] }));
  await esperarTarefas();
  assert.ok(m.encerrados(m.raiz));
  assert.match(m.raiz.textContent, /Encerrado/);
  m.controle.destruir();
});

test('consulta iniciada no modal e concluída depois de fechar ainda atualiza card sem spinner preso', async () => {
  const m = preparar();
  await m.pronto();
  const pendente = adiar();
  m.responder = c => c.method === 'GET' ? pendente.promessa : null;
  m.abrirModal();
  await esperarTarefas();
  m.janela.SmailVinculo.fechar();
  pendente.resolver(m.resposta({ itens: [] }));
  await esperarTarefas();
  assert.equal(m.modal(), null);
  assert.match(m.raiz.textContent, /Nenhuma caixa vinculada/);
  assert.ok(!m.raiz.textContent.includes('Carregando'));
  m.controle.destruir();
});

test('revogação já confirmada atualiza card mesmo quando modal é fechado durante DELETE', async () => {
  const m = preparar();
  await m.pronto();
  const modal = m.abrirModal();
  await esperarTarefas();
  const pendente = adiar();
  m.responder = c => c.method === 'DELETE' ? pendente.promessa : c.method === 'GET' ? m.resposta({ itens: [{ ...vinculo, status: 'revogado', revogadoEm: '2026-10-15T16:00:00Z' }] }) : null;
  await m.clicar('encerrar', modal);
  m.janela.SmailVinculo.fechar();
  pendente.resolver(m.resposta(null, 204));
  await esperarTarefas();
  assert.ok(m.encerrados(m.raiz));
  assert.match(m.raiz.textContent, /Encerrado/);
  m.controle.destruir();
});
