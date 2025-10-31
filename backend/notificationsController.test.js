const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const { newDb } = require('pg-mem');

function setup() {
  const db = newDb();
  db.public.none(`CREATE TABLE materia_prima (
    id serial primary key,
    nome text,
    quantidade numeric,
    unidade text,
    preco_unitario numeric,
    data_estoque timestamp,
    data_preco timestamp
  );`);
  db.public.none(`CREATE TABLE materia_prima_movimentacoes (
    id serial primary key,
    insumo_id integer,
    tipo text,
    quantidade numeric,
    quantidade_anterior numeric,
    quantidade_atual numeric,
    preco_anterior numeric,
    preco_atual numeric,
    usuario_id integer,
    criado_em timestamp default NOW()
  );`);
  db.public.none(`CREATE TABLE produtos (
    id serial primary key,
    nome text,
    status text
  );`);
  db.public.none(`CREATE TABLE produtos_em_cada_ponto (
    id serial primary key,
    produto_id integer,
    quantidade numeric,
    data_atualizacao timestamp,
    data_hora_completa timestamp
  );`);
  db.public.none(`CREATE TABLE pedidos (
    id serial primary key,
    numero text,
    situacao text,
    data_emissao timestamp,
    data_aprovacao timestamp,
    data_envio timestamp,
    data_entrega timestamp,
    orcamento_id integer
  );`);
  db.public.none(`CREATE TABLE orcamentos (
    id serial primary key,
    numero text,
    situacao text,
    validade date,
    data_aprovacao timestamp,
    cliente_id integer
  );`);
  db.public.none(`CREATE TABLE clientes (
    id serial primary key,
    nome_fantasia text,
    status_cliente text,
    dono_cliente text
  );`);
  db.public.none(`CREATE TABLE contatos_cliente (
    id serial primary key,
    id_cliente integer,
    nome text
  );`);
  db.public.none(`CREATE TABLE usuarios (
    id serial primary key,
    nome text,
    verificado boolean,
    ultima_atividade timestamp,
    ultima_atividade_em timestamp,
    ultimo_login timestamp,
    ultimo_login_em timestamp,
    ultima_entrada timestamp,
    ultima_saida timestamp,
    ultima_entrada_em timestamp,
    ultima_saida_em timestamp
  );`);

  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  const dbModulePath = require.resolve('./db');
  const originalDbModule = require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect()
    }
  };

  const materiaPrimaPath = require.resolve('./materiaPrima');
  delete require.cache[materiaPrimaPath];
  const notificationsPath = require.resolve('./notificationsController');
  delete require.cache[notificationsPath];
  const notificationsRouter = require('./notificationsController');

  const app = express();
  app.use('/api/notifications', notificationsRouter);
  const server = http.createServer(app);

  async function listen() {
    await new Promise(resolve => server.listen(0, resolve));
    const address = server.address();
    return typeof address === 'object' && address ? address.port : 0;
  }

  async function close() {
    await new Promise(resolve => server.close(resolve));
    if (originalDbModule) {
      require.cache[dbModulePath] = originalDbModule;
    } else {
      delete require.cache[dbModulePath];
    }
    delete require.cache[notificationsPath];
    delete require.cache[materiaPrimaPath];
  }

  return { pool, listen, close, notificationsModule: notificationsRouter };
}

test('GET /api/notifications expõe alertas das regras configuradas', async () => {
  const { pool, listen, close } = setup();
  const critical = await pool.query(
    `INSERT INTO materia_prima (nome, quantidade, unidade, data_estoque, preco_unitario, data_preco)
     VALUES ('Insumo Crítico', 5, 'kg', NOW() - INTERVAL '1 day', 10, NOW()) RETURNING id`
  );
  const zero = await pool.query(
    `INSERT INTO materia_prima (nome, quantidade, unidade, data_estoque, preco_unitario, data_preco)
     VALUES ('Insumo Zerado', 0, 'kg', NOW() - INTERVAL '2 days', 8, NOW()) RETURNING id`
  );
  const ok = await pool.query(
    `INSERT INTO materia_prima (nome, quantidade, unidade, data_estoque, preco_unitario, data_preco)
     VALUES ('Insumo OK', 20, 'kg', NOW(), 12, NOW()) RETURNING id`
  );

  const movimentoRecente = await pool.query(
    `INSERT INTO materia_prima_movimentacoes (insumo_id, tipo, quantidade, quantidade_anterior, quantidade_atual, usuario_id, criado_em)
     VALUES ($1, 'entrada', 5, 0, 5, 101, NOW()) RETURNING id`,
    [critical.rows[0].id]
  );
  const movimentoAntigo = await pool.query(
    `INSERT INTO materia_prima_movimentacoes (insumo_id, tipo, quantidade, quantidade_anterior, quantidade_atual, usuario_id, criado_em)
     VALUES ($1, 'saida', 2, 10, 8, 102, NOW() - INTERVAL '10 days') RETURNING id`,
    [ok.rows[0].id]
  );
  const precoRecente = await pool.query(
    `INSERT INTO materia_prima_movimentacoes (insumo_id, tipo, preco_anterior, preco_atual, usuario_id, criado_em)
     VALUES ($1, 'preco', 10, 12, 103, NOW()) RETURNING id`,
    [critical.rows[0].id]
  );
  const precoAntigo = await pool.query(
    `INSERT INTO materia_prima_movimentacoes (insumo_id, tipo, preco_anterior, preco_atual, usuario_id, criado_em)
     VALUES ($1, 'preco', 9, 11, 104, NOW() - INTERVAL '20 days') RETURNING id`,
    [ok.rows[0].id]
  );

  const produtoSemEstoque = await pool.query(
    "INSERT INTO produtos (nome, status) VALUES ('Produto Sem Estoque', 'ativo') RETURNING id"
  );
  const produtoOffline = await pool.query(
    "INSERT INTO produtos (nome, status) VALUES ('Produto Offline', 'offline') RETURNING id"
  );
  const produtoOk = await pool.query(
    "INSERT INTO produtos (nome, status) VALUES ('Produto OK', 'ativo') RETURNING id"
  );
  await pool.query(
    `INSERT INTO produtos_em_cada_ponto (produto_id, quantidade, data_hora_completa)
     VALUES ($1, 15, NOW())`,
    [produtoOk.rows[0].id]
  );
  await pool.query(
    `INSERT INTO produtos_em_cada_ponto (produto_id, quantidade, data_hora_completa)
     VALUES ($1, 5, NOW())`,
    [produtoOffline.rows[0].id]
  );

  const pedidoProducao = await pool.query(
    `INSERT INTO pedidos (id, numero, situacao, data_emissao, data_aprovacao)
     VALUES (101, 'P-001', 'Em Produção', NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days') RETURNING id`
  );
  const pedidoEnvio = await pool.query(
    `INSERT INTO pedidos (id, numero, situacao, data_emissao, data_aprovacao, data_envio)
     VALUES (102, 'P-002', 'Enviado', NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days', NOW() - INTERVAL '4 days') RETURNING id`
  );
  await pool.query(
    `INSERT INTO pedidos (id, numero, situacao, data_emissao, data_aprovacao)
     VALUES (103, 'P-003', 'Em Produção', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')`
  );
  await pool.query(
    `INSERT INTO pedidos (id, numero, situacao, data_emissao, data_envio, data_entrega)
     VALUES (104, 'P-004', 'Enviado', NOW() - INTERVAL '4 days', NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day')`
  );

  const orcamentoExpirando = await pool.query(
    `INSERT INTO orcamentos (numero, situacao, validade, data_aprovacao, cliente_id)
     VALUES ('O-001', 'Aberto', CURRENT_DATE + INTERVAL '2 days', NULL, 1) RETURNING id`
  );
  const orcamentoLonge = await pool.query(
    `INSERT INTO orcamentos (numero, situacao, validade, data_aprovacao, cliente_id)
     VALUES ('O-002', 'Aberto', CURRENT_DATE + INTERVAL '15 days', NULL, 1) RETURNING id`
  );
  const orcamentoAprovadoSemPedido = await pool.query(
    `INSERT INTO orcamentos (numero, situacao, validade, data_aprovacao, cliente_id)
     VALUES ('O-003', 'Aprovado', CURRENT_DATE + INTERVAL '30 days', NOW() - INTERVAL '5 days', 2) RETURNING id`
  );
  const orcamentoAprovadoComPedido = await pool.query(
    `INSERT INTO orcamentos (numero, situacao, validade, data_aprovacao, cliente_id)
     VALUES ('O-004', 'Aprovado', CURRENT_DATE + INTERVAL '30 days', NOW() - INTERVAL '1 day', 3) RETURNING id`
  );
  await pool.query(
    `INSERT INTO pedidos (id, numero, situacao, data_emissao, data_aprovacao, orcamento_id)
     VALUES ($1, 'P-005', 'Produção', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', $1)` ,
    [orcamentoAprovadoComPedido.rows[0].id]
  );

  const clienteSemDono = await pool.query(
    `INSERT INTO clientes (nome_fantasia, status_cliente, dono_cliente)
     VALUES ('Cliente Sem Dono', 'Ativo', NULL) RETURNING id`
  );
  const clienteSemContato = await pool.query(
    `INSERT INTO clientes (nome_fantasia, status_cliente, dono_cliente)
     VALUES ('Cliente Sem Contato', 'Prospect', 'Ana') RETURNING id`
  );
  const clienteOk = await pool.query(
    `INSERT INTO clientes (nome_fantasia, status_cliente, dono_cliente)
     VALUES ('Cliente OK', 'Ativo', 'João') RETURNING id`
  );
  await pool.query(
    `INSERT INTO contatos_cliente (id_cliente, nome)
     VALUES ($1, 'Contato Principal')`,
    [clienteSemDono.rows[0].id]
  );
  await pool.query(
    `INSERT INTO contatos_cliente (id_cliente, nome)
     VALUES ($1, 'Contato OK')`,
    [clienteOk.rows[0].id]
  );

  const usuarioInativo = await pool.query(
    `INSERT INTO usuarios (nome, verificado, ultima_atividade, ultima_entrada)
     VALUES ('Usuário Inativo', false, NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days') RETURNING id`
  );
  const usuarioSessao = await pool.query(
    `INSERT INTO usuarios (nome, verificado, ultima_atividade, ultima_entrada, ultima_saida)
     VALUES ('Usuário Sessão', true, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '9 hours', NULL) RETURNING id`
  );
  await pool.query(
    `INSERT INTO usuarios (nome, verificado, ultima_atividade, ultima_entrada, ultima_saida)
     VALUES ('Usuário OK', true, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour')`
  );

  const port = await listen();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/notifications`);
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.items));

    const ids = new Set(body.items.map(item => item.id));

    assert.ok(ids.has(`stock-zero-${zero.rows[0].id}`));
    assert.ok(ids.has(`stock-critical-${critical.rows[0].id}`));
    assert.ok(ids.has(`movement-${movimentoRecente.rows[0].id}`));
    assert.ok(!ids.has(`movement-${movimentoAntigo.rows[0].id}`));
    assert.ok(ids.has(`price-${precoRecente.rows[0].id}`));
    assert.ok(!ids.has(`price-${precoAntigo.rows[0].id}`));
    assert.ok(ids.has(`product-nostock-${produtoSemEstoque.rows[0].id}`));
    assert.ok(ids.has(`product-offline-${produtoOffline.rows[0].id}`));
    assert.ok(!ids.has(`product-nostock-${produtoOk.rows[0].id}`));
    assert.ok(ids.has(`order-production-${pedidoProducao.rows[0].id}`));
    assert.ok(ids.has(`order-shipping-${pedidoEnvio.rows[0].id}`));
    assert.ok(ids.has(`budget-expiry-${orcamentoExpirando.rows[0].id}`));
    assert.ok(!ids.has(`budget-expiry-${orcamentoLonge.rows[0].id}`));
    assert.ok(ids.has(`budget-approved-${orcamentoAprovadoSemPedido.rows[0].id}`));
    assert.ok(!ids.has(`budget-approved-${orcamentoAprovadoComPedido.rows[0].id}`));
    assert.ok(ids.has(`crm-owner-${clienteSemDono.rows[0].id}`));
    assert.ok(ids.has(`crm-contact-${clienteSemContato.rows[0].id}`));
    assert.ok(!ids.has(`crm-contact-${clienteOk.rows[0].id}`));
    assert.ok(ids.has(`user-inactive-${usuarioInativo.rows[0].id}`));
    assert.ok(ids.has(`session-open-${usuarioSessao.rows[0].id}`));

    const zeroStock = body.items.find(item => item.id === `stock-zero-${zero.rows[0].id}`);
    assert.strictEqual(zeroStock.category, 'system');
    assert.strictEqual(zeroStock.metadata.quantidade, 0);

    const movement = body.items.find(item => item.id === `movement-${movimentoRecente.rows[0].id}`);
    assert.strictEqual(movement.category, 'tasks');
    assert.strictEqual(movement.metadata.usuarioId, 101);

    const price = body.items.find(item => item.id === `price-${precoRecente.rows[0].id}`);
    assert.strictEqual(price.category, 'finance');

    const crm = body.items.find(item => item.id === `crm-owner-${clienteSemDono.rows[0].id}`);
    assert.strictEqual(crm.category, 'sales');

    const session = body.items.find(item => item.id === `session-open-${usuarioSessao.rows[0].id}`);
    assert.strictEqual(session.category, 'system');
    assert.ok(session.metadata.ultimaSaida === null || session.metadata.ultimaSaida === undefined);
  } finally {
    await close();
  }
});

test('collectNotifications reutiliza cache por alguns minutos', async () => {
  const { pool, listen, close, notificationsModule } = setup();

  const estoqueCritico = await pool.query(
    `INSERT INTO materia_prima (nome, quantidade, unidade, data_estoque)
     VALUES ('Inicial', 0, 'kg', NOW()) RETURNING id`
  );

  const port = await listen();

  try {
    const firstResponse = await fetch(`http://127.0.0.1:${port}/api/notifications`);
    assert.strictEqual(firstResponse.status, 200);
    const firstBody = await firstResponse.json();
    const initialId = `stock-zero-${estoqueCritico.rows[0].id}`;
    assert.ok(firstBody.items.some((item) => item.id === initialId));

    const novoEstoque = await pool.query(
      `INSERT INTO materia_prima (nome, quantidade, unidade, data_estoque)
       VALUES ('Novo Estoque', 0, 'kg', NOW()) RETURNING id`
    );

    const secondResponse = await fetch(`http://127.0.0.1:${port}/api/notifications`);
    assert.strictEqual(secondResponse.status, 200);
    const secondBody = await secondResponse.json();
    const cachedId = `stock-zero-${novoEstoque.rows[0].id}`;
    assert.ok(!secondBody.items.some((item) => item.id === cachedId));

    notificationsModule.invalidateNotificationsCache();

    const thirdResponse = await fetch(`http://127.0.0.1:${port}/api/notifications`);
    assert.strictEqual(thirdResponse.status, 200);
    const thirdBody = await thirdResponse.json();
    assert.ok(thirdBody.items.some((item) => item.id === cachedId));
  } finally {
    notificationsModule.invalidateNotificationsCache();
    await close();
  }
});
