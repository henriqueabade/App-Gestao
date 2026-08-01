/**
 * A máscara de carregamento do módulo só pode sair depois que as requisições
 * HTTP do módulo terminarem.
 *
 * Existe porque `waitForModuleLoading` (preload) só conta chamadas IPC:
 * Configurações busca os dados por fetch e a máscara saía no 1s com a tela
 * ainda vazia, preenchendo os campos na frente do usuário.
 *
 * O teste roda o código real extraído de src/js/menu.js — não uma cópia.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MENU = path.join(__dirname, '..', 'menu.js');

function carregarTrechoReal() {
  const fonte = fs.readFileSync(MENU, 'utf8');

  const inicio = fonte.indexOf('let fetchesEmVoo');
  const marcaFim = 'function readModuleIntroduction';
  const fim = fonte.indexOf(marcaFim);
  assert.ok(inicio > -1 && fim > inicio, 'trecho de espera não encontrado em menu.js');

  const trecho = fonte.slice(inicio, fim);
  assert.match(trecho, /instrumentarFetch/, 'instrumentação de fetch ausente');
  assert.match(trecho, /aguardarDadosDoModulo/, 'função de espera ausente');

  const janela = { __fetchInstrumentado: false };
  const contexto = { window: janela, setTimeout, Date, Math, Promise, console };
  contexto.globalThis = contexto;

  // fetch original: resolve depois de `ms`, informado via a própria URL
  janela.fetch = (ms = 0) => new Promise(r => setTimeout(() => r('ok'), ms));

  vm.createContext(contexto);
  vm.runInContext(`${trecho}\n; this.__api = { aguardarDadosDoModulo, get emVoo(){return fetchesEmVoo} };`, contexto);

  return { api: contexto.__api, janela };
}

test('libera quando não há requisição em voo', async () => {
  const { api } = carregarTrechoReal();
  const t0 = Date.now();
  const r = await api.aguardarDadosDoModulo({ quietMs: 120, timeoutMs: 3000 });
  const gasto = Date.now() - t0;
  assert.strictEqual(r.expirou, false);
  assert.ok(gasto < 1000, `deveria liberar rápido, levou ${gasto}ms`);
});

test('segura a máscara enquanto uma requisição está pendente', async () => {
  const { api, janela } = carregarTrechoReal();
  janela.fetch(400);                       // requisição lenta em voo
  assert.strictEqual(api.emVoo, 1, 'deveria contar a requisição em voo');

  const t0 = Date.now();
  const r = await api.aguardarDadosDoModulo({ quietMs: 120, timeoutMs: 5000 });
  const gasto = Date.now() - t0;

  assert.strictEqual(r.expirou, false);
  assert.strictEqual(api.emVoo, 0, 'nada pode ficar pendente ao liberar');
  assert.ok(gasto >= 400, `deveria esperar a requisição terminar, liberou em ${gasto}ms`);
});

test('espera também as requisições encadeadas', async () => {
  const { api, janela } = carregarTrechoReal();
  janela.fetch(150).then(() => janela.fetch(300));   // a segunda só nasce depois

  const t0 = Date.now();
  const r = await api.aguardarDadosDoModulo({ quietMs: 120, timeoutMs: 5000 });
  const gasto = Date.now() - t0;

  assert.strictEqual(r.expirou, false);
  assert.ok(gasto >= 450, `deveria cobrir as duas requisições, liberou em ${gasto}ms`);
});

test('não trava a tela quando a requisição fica pendurada', async () => {
  const { api, janela } = carregarTrechoReal();
  janela.fetch(60000);                     // nunca termina em tempo útil

  const t0 = Date.now();
  const r = await api.aguardarDadosDoModulo({ quietMs: 120, timeoutMs: 600 });
  const gasto = Date.now() - t0;

  assert.strictEqual(r.expirou, true, 'deveria expirar em vez de travar');
  assert.ok(gasto < 1500, `deveria respeitar o teto, levou ${gasto}ms`);
});

test('a instrumentação preserva o resultado do fetch original', async () => {
  const { janela } = carregarTrechoReal();
  assert.strictEqual(await janela.fetch(10), 'ok');
});
