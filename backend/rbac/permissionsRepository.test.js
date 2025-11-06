const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');

const { seedRbacPermissions } = require('../scripts/seed_rbac_permissions');

function createContext() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  const dbModulePath = require.resolve('../db');
  const originalDbModule = require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect()
    }
  };

  const cleanup = () => {
    if (originalDbModule) {
      require.cache[dbModulePath] = originalDbModule;
    } else {
      delete require.cache[dbModulePath];
    }
  };

  return { db, pool, cleanup };
}

test('permissions repository resolves roles and access', async () => {
  const { pool, cleanup } = createContext();

  try {
    await seedRbacPermissions({ query: (text, params) => pool.query(text, params) });

    const repo = require('./permissionsRepository');

    const supAdmin = await repo.getRoleByCode('sup_admin');
    assert.ok(supAdmin, 'should locate sup_admin role');

    const vendas = await repo.getRoleByCode('vendas');
    assert.ok(vendas, 'should locate vendas role');

    const supModules = await repo.getModulesWithAccess(supAdmin.id);
    assert.ok(supModules.length > 0, 'sup_admin should have modules');
    assert.ok(supModules.every(m => m.permitted), 'sup_admin should access all modules');

    const vendasModules = await repo.getModulesWithAccess(vendas.id);
    assert.ok(vendasModules.some(m => m.code === 'clientes' && m.permitted), 'vendas should access clientes');
    assert.ok(vendasModules.some(m => m.code === 'financeiro' && !m.permitted), 'vendas should not access financeiro');

    const admin = await repo.getRoleByCode('admin');
    const adminUsuarioFeatures = await repo.getFeaturesByRoleAndModule(admin.id, 'usuarios');
    const permissoesFeature = adminUsuarioFeatures.find(f => f.code === 'permissoes');
    assert.ok(permissoesFeature, 'usuarios module should expose permissoes feature');
    assert.strictEqual(permissoesFeature.permitted, false, 'admin should not gerenciar permissoes');

    const vendasClientesFeatures = await repo.getFeaturesByRoleAndModule(vendas.id, 'clientes');
    assert.ok(vendasClientesFeatures.some(f => f.code === 'editar' && f.permitted), 'vendas pode editar clientes');
    assert.ok(!vendasClientesFeatures.some(f => f.code === 'excluir' && f.permitted), 'vendas não exclui clientes');

    const supColumns = await repo.getGridColumns(supAdmin.id, 'clientes');
    assert.ok(supColumns.length > 0, 'clientes deve possuir colunas');
    assert.ok(supColumns.every(col => col.can_view), 'sup_admin vê todas as colunas');
    assert.ok(supColumns.every(col => col.can_edit), 'sup_admin edita todas as colunas');

    const vendasColumns = await repo.getGridColumns(vendas.id, 'clientes');
    assert.ok(vendasColumns.length > 0, 'vendas também visualiza colunas de clientes');
    assert.ok(vendasColumns.some(col => !col.can_edit), 'algumas colunas ficam somente leitura para vendas');

    const modulesList = await repo.listAllModules();
    assert.ok(modulesList.some(m => m.code === 'clientes'), 'listAllModules inclui clientes');

    const featuresList = await repo.listFeaturesForModule('clientes');
    assert.ok(featuresList.some(f => f.code === 'visualizar'), 'clientes possui feature visualizar');
  } finally {
    cleanup();
  }
});
