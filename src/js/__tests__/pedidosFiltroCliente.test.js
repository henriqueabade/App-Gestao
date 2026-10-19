/**
 * Pedidos › filtro por cliente (19/10/2026): compara o CÓDIGO do cliente.
 * Comparando o nome, o value cru da opção não batia com o nome aparado da
 * linha quando o cadastro tinha espaço sobrando (ou aspas), e o filtro do
 * cliente do PED118 não mostrava nada.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PEDIDOS = fs.readFileSync(path.join(__dirname, '..', 'pedidos.js'), 'utf8');

test('a opção leva o código do cliente e é montada pelo DOM (nome com aspas não quebra)', () => {
  const popular = PEDIDOS.slice(PEDIDOS.indexOf('async function popularClientes('), PEDIDOS.indexOf('function showFunctionUnavailableDialog('));
  assert.match(popular, /new Option\(String\(c\.nome_fantasia \|\| c\.razao_social \|\| c\.nome \|\| 'Sem nome'\)\.trim\(\), String\(c\.id \?\? ''\)\)/);
  assert.ok(!popular.includes('innerHTML'), 'sem HTML montado com o nome');
});

test('a linha guarda o código e o filtro compara o código, não o nome', () => {
  assert.ok(PEDIDOS.includes("tr.dataset.clienteId = String(p.cliente_id ?? '');"));
  const filtro = PEDIDOS.slice(PEDIDOS.indexOf('function aplicarFiltro('), PEDIDOS.indexOf('function aplicarFiltro(') + 3000);
  assert.ok(filtro.includes("const clienteId = document.getElementById('filterClient')?.value || '';"));
  assert.ok(filtro.includes('if (clienteId) show &&= row.dataset.clienteId === clienteId;'));
  assert.ok(!/rowCliente === cliente/.test(filtro), 'a comparação pelo nome saiu');
});
