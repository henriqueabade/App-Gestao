const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { newDb } = require('pg-mem');

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
      telefone_fixo text,
      telefone_celular text,
      email text
    );
  `);
  return db;
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

  const dbModulePath = require.resolve('./db');
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect()
    }
  };
  delete require.cache[require.resolve('./clientesController')];
  const clientesRouter = require('./clientesController');

  const app = express();
  app.use('/api/clientes', clientesRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;

  const res = await fetch(`http://localhost:${port}/api/clientes/1/resumo`);
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

  server.close();
});

test('GET /api/clientes/lista inclui pais', async () => {
  const mem = setupDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  await pool.query(`INSERT INTO clientes (id, nome_fantasia, cnpj, ent_uf, ent_pais, status_cliente, dono_cliente)
                    VALUES (1, 'Cliente A', '123', 'São Paulo', 'Brasil', 'Ativo', 'Joao')`);

  const dbModulePath = require.resolve('./db');
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect()
    }
  };
  delete require.cache[require.resolve('./clientesController')];
  const clientesRouter = require('./clientesController');

  const app = express();
  app.use('/api/clientes', clientesRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;

  const res = await fetch(`http://localhost:${port}/api/clientes/lista`);
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

  server.close();
});
