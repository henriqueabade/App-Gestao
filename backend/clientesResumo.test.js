const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { newDb } = require('pg-mem');
const { seedRbacPermissions } = require('./scripts/seed_rbac_permissions');

function setupDb() {
  const db = newDb();
  db.public.none(`
    CREATE TABLE clientes (
      id integer primary key,
      nome_fantasia text,
      razao_social text,
      cnpj text,
      inscricao_estadual text,
      ent_logradouro text,
      ent_numero text,
      ent_complemento text,
      ent_bairro text,
      ent_cidade text,
      ent_uf text,
      ent_cep text,
      ent_pais text,
      cob_logradouro text,
      cob_numero text,
      cob_complemento text,
      cob_bairro text,
      cob_cidade text,
      cob_uf text,
      cob_cep text,
      cob_pais text,
      reg_logradouro text,
      reg_numero text,
      reg_complemento text,
      reg_bairro text,
      reg_cidade text,
      reg_uf text,
      reg_cep text,
      reg_pais text,
      status_cliente text,
      dono_cliente text,
      origem_captacao text
    );
  `);
  db.public.none(`
    CREATE TABLE contatos_cliente (
      id serial primary key,
      id_cliente integer references clientes(id),
      nome text,
      cargo text,
      telefone_fixo text,
      telefone_celular text,
      email text
    );
  `);
  db.public.none(`
    CREATE TABLE orcamentos (
      id serial primary key,
      cliente_id integer
    );
  `);
  db.public.none(`
    CREATE TABLE usuarios (
      id serial primary key,
      nome text,
      email text,
      classificacao text,
      perfil text
    );
  `);
  return db;
}

async function bootstrapApp(pool) {
  const dbModulePath = require.resolve('./db');
  const originalDbModule = require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect()
    }
  };

  await seedRbacPermissions({ query: (text, params) => pool.query(text, params) });
  await pool.query(
    "INSERT INTO usuarios (id, nome, email, classificacao, perfil) VALUES (1, 'Sup', 'sup@example.com', 'sup_admin', 'Sup Admin')"
  );
  await pool.query(
    "INSERT INTO usuarios (id, nome, email, classificacao, perfil) VALUES (2, 'Vendas', 'vendas@example.com', 'vendas', 'Vendas')"
  );

  delete require.cache[require.resolve('./clientesController')];
  const clientesRouter = require('./clientesController');

  const app = express();
  app.use('/api/clientes', clientesRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;

  async function close() {
    await new Promise(resolve => server.close(resolve));
    if (originalDbModule) {
      require.cache[dbModulePath] = originalDbModule;
    } else {
      delete require.cache[dbModulePath];
    }
    delete require.cache[require.resolve('./clientesController')];
  }

  return { port, close };
}

test('GET /api/clientes/:id/resumo formata endereços e contatos', async () => {
  const mem = setupDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  await pool.query(`INSERT INTO clientes (
    id, nome_fantasia, razao_social, cnpj, inscricao_estadual,
    ent_logradouro, ent_numero, ent_complemento, ent_bairro, ent_cidade, ent_uf, ent_cep, ent_pais,
    cob_logradouro, cob_numero, cob_complemento, cob_bairro, cob_cidade, cob_uf, cob_cep, cob_pais,
    reg_logradouro, reg_numero, reg_complemento, reg_bairro, reg_cidade, reg_uf, reg_cep, reg_pais
  ) VALUES (
    1, 'Cliente A', 'Cliente A SA', '123', '321',
    'Rua X', '10', '', 'Bairro X', 'Cidade X', 'São Paulo', '12345-678', 'Brasil',
    'Rua X', '10', '', 'Bairro X', 'Cidade X', 'São Paulo', '12345-678', 'Brasil',
    'Rua Y', '20', 'Sala 5', 'Bairro Y', 'Cidade Y', 'Rio de Janeiro', '98765-432', 'Brasil'
  );`);

  await pool.query(`INSERT INTO contatos_cliente (id_cliente, nome, telefone_fixo, telefone_celular, email)
    VALUES (1, 'Maria', '1111-1111', '9999-9999', 'maria@example.com');`);

  const { port, close } = await bootstrapApp(pool);

  const res = await fetch(`http://localhost:${port}/api/clientes/1/resumo`, {
    headers: { Authorization: 'Bearer 1' }
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();

  assert.strictEqual(body.endereco_entrega, 'Rua X, 10, Bairro X - Cidade X/São Paulo - 12345-678 - Brasil');
  assert.strictEqual(body.endereco_faturamento, 'Igual Entrega');
  assert.strictEqual(body.endereco_registro, 'Rua Y, 20 - Sala 5, Bairro Y - Cidade Y/Rio de Janeiro - 98765-432 - Brasil');
  assert.deepStrictEqual(body.contatos, [
    {
      id_cliente: 1,
      nome: 'Maria',
      telefone_fixo: '1111-1111',
      telefone_celular: '9999-9999',
      email: 'maria@example.com'
    }
  ]);

  await close();
});

test('GET /api/clientes/contatos retorna contatos com dados do cliente', async () => {
  const mem = setupDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  await pool.query(`INSERT INTO clientes (id, nome_fantasia, status_cliente, dono_cliente)
                    VALUES (1, 'Alpha Decor', 'Prospect', 'João'),
                           (2, 'Beta Imports', 'Negociação', 'Maria')`);

  await pool.query(`INSERT INTO contatos_cliente (id, id_cliente, nome, cargo, telefone_celular, telefone_fixo, email)
                    VALUES
                      (10, 1, 'Ana Souza', 'Compras', '(11) 99999-0000', '(11) 4000-1000', 'ana@alpha.com'),
                      (11, 2, 'Bruno Lima', 'Financeiro', '(21) 98888-1111', '(21) 4000-2000', 'bruno@beta.com'),
                      (12, 2, 'Carlos Alves', 'Compras', '(21) 97777-2222', '(21) 4000-3000', 'carlos@beta.com')`);

  const { port, close } = await bootstrapApp(pool);

  const res = await fetch(`http://localhost:${port}/api/clientes/contatos`, {
    headers: { Authorization: 'Bearer 1' }
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();

  assert.deepStrictEqual(body, [
    {
      id: 10,
      id_cliente: 1,
      nome: 'Ana Souza',
      cargo: 'Compras',
      telefone_celular: '(11) 99999-0000',
      telefone_fixo: '(11) 4000-1000',
      email: 'ana@alpha.com',
      cliente: 'Alpha Decor',
      dono: 'João',
      status_cliente: 'Prospect'
    },
    {
      id: 11,
      id_cliente: 2,
      nome: 'Bruno Lima',
      cargo: 'Financeiro',
      telefone_celular: '(21) 98888-1111',
      telefone_fixo: '(21) 4000-2000',
      email: 'bruno@beta.com',
      cliente: 'Beta Imports',
      dono: 'Maria',
      status_cliente: 'Negociação'
    },
    {
      id: 12,
      id_cliente: 2,
      nome: 'Carlos Alves',
      cargo: 'Compras',
      telefone_celular: '(21) 97777-2222',
      telefone_fixo: '(21) 4000-3000',
      email: 'carlos@beta.com',
      cliente: 'Beta Imports',
      dono: 'Maria',
      status_cliente: 'Negociação'
    }
  ]);

  await close();
});

test('GET /api/clientes/lista inclui pais', async () => {
  const mem = setupDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  await pool.query(`INSERT INTO clientes (id, nome_fantasia, cnpj, ent_uf, ent_pais, status_cliente, dono_cliente)
                    VALUES (1, 'Cliente A', '123', 'São Paulo', 'Brasil', 'Ativo', 'Joao')`);

  const { port, close } = await bootstrapApp(pool);

  const res = await fetch(`http://localhost:${port}/api/clientes/lista`, {
    headers: { Authorization: 'Bearer 1' }
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body, [{
    id: 1,
    nome_fantasia: 'Cliente A',
    cnpj: '123',
    pais: 'Brasil',
    estado: 'São Paulo',
    status_cliente: 'Ativo',
    dono_cliente: 'Joao'
  }]);

  await close();
});

test('DELETE /api/clientes/:id permite Sup Admin excluir registros', async () => {
  const mem = setupDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  await pool.query(`INSERT INTO clientes (id, nome_fantasia, cnpj, ent_uf, ent_pais, status_cliente, dono_cliente)
                    VALUES (5, 'Cliente Z', '999', 'São Paulo', 'Brasil', 'Ativo', 'Ana')`);

  const { port, close } = await bootstrapApp(pool);

  const res = await fetch(`http://localhost:${port}/api/clientes/5`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer 1' }
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body, { success: true });

  const remaining = await pool.query('SELECT COUNT(*)::int AS total FROM clientes WHERE id = $1', [5]);
  assert.strictEqual(remaining.rows[0].total, 0);

  await close();
});

test('DELETE /api/clientes/:id bloqueia quando falta permissão de exclusão', async () => {
  const mem = setupDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  await pool.query(`INSERT INTO clientes (id, nome_fantasia, cnpj, ent_uf, ent_pais, status_cliente, dono_cliente)
                    VALUES (7, 'Cliente W', '111', 'São Paulo', 'Brasil', 'Ativo', 'Ana')`);

  const { port, close } = await bootstrapApp(pool);

  const res = await fetch(`http://localhost:${port}/api/clientes/7`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer 2' }
  });
  assert.strictEqual(res.status, 403);
  const body = await res.json();
  assert.deepStrictEqual(body, { error: 'forbidden', feature: 'clientes.excluir' });

  await close();
});
