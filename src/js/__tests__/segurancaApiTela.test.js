/**
 * Usuários › Segurança da API (09/10/2026): o modo da trava (observar ou
 * bloquear) e o registro do que a API negou ou negaria. O modal roda de
 * verdade no DOM mínimo, com a resposta do backend simulada.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente, esperarTarefas } = require('./apoio/domMinimo');

const SRC = path.join(__dirname, '..', '..');
const ler = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');

const LINHAS = [
  { id: 1, usuario: 'Vera Lucia', tabela: 'boletos', operacao: 'ler', decisao: 'seria_negado', motivo: 'Exige: financeiro.boleto.view.', rota: 'GET /api/financeiro/painel', permissoes_rota: 'financeiro.view', vezes: 12, ultimo_em: '2026-10-09T21:00:00Z' },
  { id: 2, usuario: 'Gil Souza', tabela: 'usuarios', operacao: 'alterar', decisao: 'negado', motivo: 'Só o Sup Admin dá o perfil Sup Admin.', rota: 'segundo-plano', permissoes_rota: '', vezes: 1, ultimo_em: '2026-10-09T20:00:00Z' }
];

async function abrir(resposta, status = 200) {
  const { janela, documento, montar, disparar } = criarAmbiente();
  montar(ler('html/modals/usuarios/seguranca.html'));
  const chamadas = [];
  const fechados = [];
  const prontos = [];
  janela.apiConfig = { getApiBaseUrl: async () => '' };
  janela.fetch = async caminho => { chamadas.push(caminho); return { ok: status < 400, status, json: async () => resposta }; };
  janela.Modal = { close: id => fechados.push(id) };
  janela.addEventListener('modalSpinnerLoaded', e => prontos.push(e.detail));
  vm.createContext(janela);
  vm.runInContext(ler('js/modals/usuario-seguranca.js'), janela);
  await esperarTarefas(10);
  return { janela, documento, disparar, el: id => documento.getElementById(id), chamadas, fechados, prontos };
}

test('modo observar: o selo, a explicação, as linhas e o pronto do spinner', async () => {
  const t = await abrir({ situacao: { modo: 'observar', registro: true, jwtProprio: true }, linhas: LINHAS });
  assert.deepEqual(t.chamadas, ['/api/usuarios/seguranca/registro']);
  assert.deepEqual(t.prontos, ['segurancaApi']);
  assert.match(t.el('segurancaApiModo').textContent, /Modo observar/);
  assert.match(t.el('segurancaApiExplica').textContent, /DEIXA PASSAR/);
  assert.match(t.el('segurancaApiExplica').textContent, /PERMISSOES_MODO=bloquear/);
  const linhas = t.el('segurancaApiLinhas').querySelectorAll('tr');
  assert.equal(linhas.length, 2);
  assert.match(linhas[0].textContent, /Vera Lucia/);
  assert.match(linhas[0].textContent, /boletos/);
  assert.match(linhas[0].textContent, /Seria negado/);
  assert.match(linhas[0].textContent, /GET \/api\/financeiro\/painel/);
  assert.match(linhas[1].textContent, /Negado/);
  assert.match(t.el('segurancaApiTotal').textContent, /2 de 2 combinações/);
});

test('filtros: decisão e busca (usuário, tabela ou tela); Esc fecha', async () => {
  const t = await abrir({ situacao: { modo: 'observar', registro: true }, linhas: LINHAS });
  t.el('segurancaApiDecisao').value = 'negado';
  t.disparar(t.el('segurancaApiDecisao'), 'change');
  assert.equal(t.el('segurancaApiLinhas').querySelectorAll('tr').length, 1);
  assert.match(t.el('segurancaApiLinhas').textContent, /Gil Souza/);
  t.el('segurancaApiDecisao').value = '';
  t.disparar(t.el('segurancaApiDecisao'), 'change');
  t.el('segurancaApiBusca').value = 'painel';
  t.disparar(t.el('segurancaApiBusca'), 'input');
  assert.match(t.el('segurancaApiLinhas').textContent, /Vera Lucia/);
  assert.doesNotMatch(t.el('segurancaApiLinhas').textContent, /Gil Souza/);
  t.disparar(t.documento, 'keydown', { key: 'Escape' });
  assert.deepEqual(t.fechados, ['segurancaApi']);
});

test('registro desligado, JWT padrão, API antiga e quem não é Sup Admin', async () => {
  const sem = await abrir({ situacao: { modo: 'observar', registro: false, jwtProprio: false }, linhas: [] });
  assert.match(sem.el('segurancaApiModo').textContent, /Registro desligado/);
  assert.match(sem.el('segurancaApiModo').textContent, /JWT_SECRET padrão/);
  assert.match(sem.el('segurancaApiExplica').textContent, /sql\/seguranca_registro_api\.sql/);
  assert.match(sem.el('segurancaApiLinhas').textContent, /Nada registrado/);
  const bloquear = await abrir({ situacao: { modo: 'bloquear', registro: true, jwtProprio: true }, linhas: [] });
  assert.match(bloquear.el('segurancaApiModo').textContent, /Modo bloquear/);
  assert.match(bloquear.el('segurancaApiExplica').textContent, /NEGA/);
  const antiga = await abrir({ situacao: { modo: null, registro: false, erro: 'A API ainda não tem a permissão por tabela (publique a versão nova).' }, linhas: [] });
  assert.match(antiga.el('segurancaApiExplica').textContent, /publique a versão nova/);
  const negado = await abrir({ error: 'Ação restrita ao Sup Admin' }, 403);
  assert.match(negado.el('segurancaApiAviso').textContent, /Só o Sup Admin/);
});

test('o botão no cabeçalho de Usuários só aparece para o Sup Admin', () => {
  const html = ler('html/usuarios.html');
  assert.match(html, /<button id="btnSegurancaApi" type="button" class="btn-secondary ctl-botao hidden text-white">/);
  const js = ler('js/usuarios.js');
  assert.ok(js.includes("btnSegurancaApi.classList.toggle('hidden', !veSeguranca);"));
  assert.ok(js.includes("openModalWithSpinner('modals/usuarios/seguranca.html', '../js/modals/usuario-seguranca.js', 'segurancaApi');"));
  const rota = fs.readFileSync(path.join(SRC, '..', 'backend', 'usuariosController.js'), 'utf8');
  assert.ok(rota.includes("router.get('/seguranca/registro', exigirSupAdminUsuarios,"), 'a rota é só do Sup Admin');
  assert.ok(rota.indexOf("router.get('/seguranca/registro'") < rota.indexOf("router.get('/:id', exigirOProprioOuVerUsuarios"), 'antes do /:id');
});
