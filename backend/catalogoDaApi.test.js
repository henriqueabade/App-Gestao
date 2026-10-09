/**
 * A API confere permissão por tabela com as mesmas chaves da tela; o catálogo
 * dela (Santissimo-db-API/acesso/catalogo-permissoes.json) é exportado deste
 * (backend/permissionsCatalog.js) por scripts/exportar-catalogo-para-api.js.
 * Mudou uma ação aqui e esqueceu de exportar: a API não conheceria a chave
 * nova (e negaria). Quando o repositório da API não está ao lado, o teste pula.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { texto, DESTINO, catalogoParaApi } = require('../scripts/exportar-catalogo-para-api');

test('o catálogo exportado tem cada chave com a tabela perm_* e a coluna', () => {
  const c = catalogoParaApi();
  assert.ok(c.modulos.length >= 20);
  for (const m of c.modulos) {
    assert.match(m.table, /^perm_/);
    for (const a of [...m.actions, ...m.columns]) assert.ok(a.key && a.column, `${m.code}: ${JSON.stringify(a)}`);
  }
  assert.ok(c.modulos.find(m => m.code === 'ped').actions.some(a => a.key === 'ped.trocar_pecas' && a.column === 'acao_trocar_pecas'));
});

test('a cópia da API está em dia com este catálogo', { skip: !fs.existsSync(DESTINO) && 'repositório da API não está ao lado' }, () => {
  assert.equal(fs.readFileSync(DESTINO, 'utf8').replace(/\r\n/g, '\n'), texto(), 'rode: node scripts/exportar-catalogo-para-api.js');
});
