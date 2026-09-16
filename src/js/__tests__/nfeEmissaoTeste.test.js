/**
 * Emissão de teste em homologação no modal "Configuração fiscal" (etapa 3 da
 * NF-e): a anatomia do bloco no HTML e a ligação no financeiro-modais.js —
 * acha o pedido pelo número, chama POST /api/fiscal/pedidos/:id/emitir com
 * ambiente homologação e mostra o resultado ou as pendências.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'financeiro', 'configuracao-fiscal.html'), 'utf8');
const JS = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'financeiro-modais.js'), 'utf8');

test('o modal tem o bloco de emissão de teste dentro da seção da SEFAZ, com o botão sob a permissão de emitir', () => {
  for (const id of ['finCfgTestePedido', 'finCfgTesteEmitir', 'finCfgTesteResultado']) assert.ok(HTML.includes(`id="${id}"`), `sem #${id}`);
  assert.ok(HTML.indexOf('id="finCfgTestePedido"') > HTML.indexOf('Conexão com a SEFAZ-MG'), 'fica na seção da SEFAZ');
  assert.ok(HTML.indexOf('id="finCfgTestePedido"') < HTML.indexOf('<!-- Emitente -->'), 'antes do emitente');
  assert.ok(/id="finCfgTesteEmitir"[^>]*data-perm="financeiro\.nfe\.emit"/.test(HTML), 'o botão pede financeiro.nfe.emit');
  assert.ok(/id="finCfgTesteResultado" class="hidden/.test(HTML), 'o resultado começa escondido');
  assert.ok(/homologação/i.test(HTML.slice(HTML.indexOf('Emissão de teste'), HTML.indexOf('finCfgTestePedido'))), 'o texto deixa claro que é homologação');
  assert.ok(!HTML.includes('Série nova (2)'), 'o texto da série 2 saiu: o dono continua na série 1');
});

test('emitirTeste: acha o pedido pelo número, força homologação, mostra a resposta e lista as pendências do 422', () => {
  const trecho = JS.slice(JS.indexOf('async function emitirTeste()'), JS.indexOf("ligar('finCfgTesteEmitir', emitirTeste)"));
  assert.ok(trecho.length > 0, 'a função existe e está ligada ao botão');
  assert.ok(trecho.includes('/api/pedidos?numero=${encodeURIComponent(numeroPedido)}'), 'procura pelo número do pedido');
  assert.ok(trecho.includes("fetchApi(`/api/fiscal/pedidos/${pedido.id}/emitir`, { method: 'POST', body: JSON.stringify({ ambiente: 'homologacao' }) })"), 'sempre homologação');
  assert.ok(trecho.includes('corpo.pendencias') && trecho.includes("p?.mensagem"), 'lista as pendências que o backend devolveu');
  assert.ok(trecho.includes('r.sefaz?.cStat') && trecho.includes('n.chave_acesso'), 'mostra cStat e chave');
  assert.ok(JS.includes('e.corpo = corpo;'), 'fetchApi guarda o corpo do erro para a tela ler as pendências');
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(trecho) && trecho.includes('.textContent = '), 'texto do servidor entra por textContent, nunca como HTML');
});
