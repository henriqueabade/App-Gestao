const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');

const {
  loadPermissionsCatalog,
  loadPermissionsForRole,
  buildPermissionsStructure
} = require('./permissionsCatalogRepository');

function createClient() {
  const db = newDb();
  const { Client } = db.adapters.createPg();
  const client = new Client();
  return { db, client };
}

test('loadPermissionsCatalog handles wide permission tables', async () => {
  const { client } = createClient();
  await client.connect();

  await client.query(`
    CREATE TABLE roles_modules_matrix (
      tipo_usuario TEXT PRIMARY KEY,
      mp BOOLEAN,
      prod BOOLEAN,
      prod_pode_gerenciar BOOLEAN,
      pode_relatorios BOOLEAN
    );
  `);

  await client.query(`
    CREATE TABLE perm_mp (
      tipo_usuario TEXT,
      campo TEXT,
      pode_visualizar BOOLEAN,
      pode_editar BOOLEAN
    );
  `);

  await client.query(`
    CREATE TABLE perm_prod (
      tipo_usuario TEXT,
      campo TEXT,
      pode_listar BOOLEAN,
      pode_criar BOOLEAN
    );
  `);

  await client.query(`
    INSERT INTO roles_modules_matrix (tipo_usuario, mp, prod, prod_pode_gerenciar, pode_relatorios)
    VALUES
      ('admin', true, true, true, true),
      ('viewer', false, true, false, false);
  `);

  await client.query(`
    INSERT INTO perm_mp (tipo_usuario, campo, pode_visualizar, pode_editar)
    VALUES
      ('admin', 'preco', true, true),
      ('admin', 'estoque', true, false),
      ('viewer', 'preco', true, false),
      ('viewer', 'estoque', true, false);
  `);

  await client.query(`
    INSERT INTO perm_prod (tipo_usuario, campo, pode_listar, pode_criar)
    VALUES
      ('admin', 'catalogo', true, true),
      ('viewer', 'catalogo', true, false);
  `);

  const catalog = await loadPermissionsCatalog(client);

  assert.strictEqual(catalog.matrix.roleColumn, 'tipo_usuario');
  assert.strictEqual(catalog.matrix.moduleColumn, null);
  assert.ok(Array.isArray(catalog.matrix.derivedColumns));

  const matrixModules = new Map(
    catalog.matrix.derivedColumns.map(entry => [entry.moduleKey, entry])
  );
  assert.ok(matrixModules.has('mp'));
  assert.ok(matrixModules.has('prod'));
  assert.ok(matrixModules.has('geral'));

  const mpPermTable = catalog.permTables.get('mp');
  assert.ok(mpPermTable);
  assert.ok(mpPermTable.derivedColumns.some(entry => entry.actionKey === 'visualizar'));
  assert.ok(mpPermTable.derivedColumns.some(entry => entry.actionKey === 'editar'));

  const prodPermTable = catalog.permTables.get('prod');
  assert.ok(prodPermTable);
  assert.ok(prodPermTable.derivedColumns.some(entry => entry.actionKey === 'listar'));
  assert.ok(prodPermTable.derivedColumns.some(entry => entry.actionKey === 'criar'));

  const permissoesAdmin = await loadPermissionsForRole(client, 'admin', catalog);
  assert.strictEqual(permissoesAdmin.mp.acesso.permitido, true);
  assert.strictEqual(permissoesAdmin.prod.gerenciar.permitido, true);
  assert.strictEqual(permissoesAdmin.geral.relatorios.permitido, true);
  assert.strictEqual(permissoesAdmin.mp.editar.campos.preco.editar, true);
  assert.strictEqual(permissoesAdmin.mp.editar.campos.estoque.editar, false);
  assert.strictEqual(permissoesAdmin.prod.criar.campos.catalogo.criar, true);

  const permissoesViewer = await loadPermissionsForRole(client, 'viewer', catalog);
  assert.strictEqual(permissoesViewer.mp.acesso.permitido, false);
  assert.strictEqual(permissoesViewer.prod.gerenciar.permitido, false);
  assert.strictEqual(permissoesViewer.geral.relatorios.permitido, false);
  assert.strictEqual(permissoesViewer.prod.criar.campos.catalogo.criar, false);

  const estrutura = await buildPermissionsStructure(client, catalog);
  const mpModulo = estrutura.find(entry => entry.chave === 'mp');
  assert.ok(mpModulo);
  const mpEditar = mpModulo.campos.find(acao => acao.chave === 'editar');
  assert.ok(mpEditar);
  assert.ok(mpEditar.colunas.some(coluna => coluna.chave === 'preco'));
  assert.ok(mpEditar.colunas.some(coluna => coluna.chave === 'estoque'));

  const prodModulo = estrutura.find(entry => entry.chave === 'prod');
  assert.ok(prodModulo);
  const prodGerenciar = prodModulo.campos.find(acao => acao.chave === 'gerenciar');
  assert.ok(prodGerenciar);
  const prodCriar = prodModulo.campos.find(acao => acao.chave === 'criar');
  assert.ok(prodCriar);
  assert.ok(prodCriar.colunas.some(coluna => coluna.chave === 'catalogo'));

  const geralModulo = estrutura.find(entry => entry.chave === 'geral');
  assert.ok(geralModulo);
  assert.ok(geralModulo.campos.some(acao => acao.chave === 'relatorios'));

  await client.end();
});
