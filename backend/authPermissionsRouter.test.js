const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const { newDb } = require('pg-mem');

const { seedRbacPermissions } = require('./scripts/seed_rbac_permissions');

async function createTestContext() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  await seedRbacPermissions({ query: (text, params) => pool.query(text, params) });

  const dbModulePath = require.resolve('./db');
  const originalDbModule = require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect()
    }
  };

  const repoPath = require.resolve('./rbac/permissionsRepository');
  const routerPath = require.resolve('./authPermissionsRouter');
  delete require.cache[repoPath];
  delete require.cache[routerPath];

  const router = require('./authPermissionsRouter');

  const app = express();
  app.use((req, _res, next) => {
    const roleCode = req.headers['x-role-code'] || req.headers['x-role'] || 'SUPERADMIN';
    req.user = { id: 1, role: { code: roleCode } };
    next();
  });
  app.use('/auth/permissions', router);

  const server = http.createServer(app);
  let port = 0;

  async function start() {
    await new Promise(resolve => server.listen(0, resolve));
    const address = server.address();
    port = typeof address === 'object' && address ? address.port : 0;
    return port;
  }

  async function close() {
    await new Promise(resolve => server.close(resolve));
    if (originalDbModule) {
      require.cache[dbModulePath] = originalDbModule;
    } else {
      delete require.cache[dbModulePath];
    }
    delete require.cache[routerPath];
    delete require.cache[repoPath];
  }

  function fetchWithRole(path, { role = 'SUPERADMIN', headers = {}, method = 'GET' } = {}) {
    if (!port) {
      throw new Error('Server not started');
    }

    const requestHeaders = Object.assign({ 'x-role-code': role }, headers);
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: requestHeaders
    });
  }

  return { start, close, fetchWithRole };
}

test('menu endpoint respeita o papel informado', async () => {
  const context = await createTestContext();
  try {
    await context.start();

    const supResponse = await context.fetchWithRole('/auth/permissions/menu', { role: 'SUPERADMIN' });
    assert.strictEqual(supResponse.status, 200);
    const supBody = await supResponse.json();
    assert.ok(Array.isArray(supBody.modules));
    const financeiroSup = supBody.modules.find(mod => mod.code === 'financeiro');
    assert.ok(financeiroSup && financeiroSup.permitted, 'super admin deve acessar financeiro');

    const vendasResponse = await context.fetchWithRole('/auth/permissions/menu', { role: 'vendas' });
    assert.strictEqual(vendasResponse.status, 200);
    const vendasBody = await vendasResponse.json();
    const financeiroVendas = vendasBody.modules.find(mod => mod.code === 'financeiro');
    assert.ok(financeiroVendas && financeiroVendas.permitted === false, 'vendas não deve acessar financeiro');
  } finally {
    await context.close();
  }
});

test('features endpoint diferencia permissões por papel', async () => {
  const context = await createTestContext();
  try {
    await context.start();

    const adminResponse = await context.fetchWithRole('/auth/permissions/features?module=usuarios', { role: 'admin' });
    assert.strictEqual(adminResponse.status, 200);
    const adminBody = await adminResponse.json();
    const adminFeature = adminBody.features.find(feature => feature.code === 'permissoes');
    assert.ok(adminFeature, 'feature permissoes deve existir');
    assert.strictEqual(adminFeature.permitted, false, 'admin não pode gerenciar permissões');

    const supResponse = await context.fetchWithRole('/auth/permissions/features?module=usuarios', { role: 'SUPERADMIN' });
    assert.strictEqual(supResponse.status, 200);
    const supBody = await supResponse.json();
    const supFeature = supBody.features.find(feature => feature.code === 'permissoes');
    assert.ok(supFeature && supFeature.permitted, 'super admin deve gerenciar permissões');
  } finally {
    await context.close();
  }
});

test('grid endpoint respeita capacidades de edição por papel', async () => {
  const context = await createTestContext();
  try {
    await context.start();

    const supResponse = await context.fetchWithRole('/auth/permissions/grid?module=clientes', { role: 'SUPERADMIN' });
    assert.strictEqual(supResponse.status, 200);
    const supBody = await supResponse.json();
    assert.ok(supBody.columns.every(column => column.can_edit), 'super admin edita todas as colunas de clientes');

    const vendasResponse = await context.fetchWithRole('/auth/permissions/grid?module=clientes', { role: 'vendas' });
    assert.strictEqual(vendasResponse.status, 200);
    const vendasBody = await vendasResponse.json();
    assert.ok(vendasBody.columns.some(column => column.can_edit === false), 'vendas deve possuir colunas somente leitura');
  } finally {
    await context.close();
  }
});

test('bootstrap agrega módulos, features e grids para o papel', async () => {
  const context = await createTestContext();
  try {
    await context.start();

    const response = await context.fetchWithRole('/auth/permissions/bootstrap', { role: 'vendas' });
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.modules) && body.modules.length > 0, 'deve retornar lista de módulos');
    assert.ok(body.features && body.features.clientes, 'payload deve conter features por módulo');
    assert.ok(body.grids && body.grids.clientes, 'payload deve conter grids por módulo');
    const clientesFeatures = body.features.clientes;
    const editarFeature = clientesFeatures.find(feature => feature.code === 'editar');
    assert.ok(editarFeature && editarFeature.permitted, 'vendas pode editar clientes');
  } finally {
    await context.close();
  }
});

test('retorna 304 quando o ETag informado permanece válido', async () => {
  const context = await createTestContext();
  try {
    await context.start();

    const firstResponse = await context.fetchWithRole('/auth/permissions/menu', { role: 'admin' });
    assert.strictEqual(firstResponse.status, 200);
    const etag = firstResponse.headers.get('etag');
    assert.ok(etag, 'primeira resposta deve retornar ETag');

    const secondResponse = await context.fetchWithRole('/auth/permissions/menu', {
      role: 'admin',
      headers: { 'If-None-Match': etag }
    });
    assert.strictEqual(secondResponse.status, 304, 'segunda resposta deve ser 304');
    assert.strictEqual(secondResponse.headers.get('etag'), etag, 'ETag deve ser preservado');
  } finally {
    await context.close();
  }
});
