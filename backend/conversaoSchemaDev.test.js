const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { newDb } = require('pg-mem');
process.env.BANCO = 'DEV';
const { createLocalDataClient } = require('./localDataClient');

function controller(file, api, stockCalls = []) {
  const filename = path.join(__dirname, file);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + (file === 'orcamentosController.js'
    ? '\nmodule.exports.converter = converterOrcamentoEmPedido;' : ''), {
    module, exports: module.exports, Buffer, Date,
    console: { ...console, warn: (...args) => assert.fail(`Não deveria tentar colunas ausentes: ${args[0]}`) },
    require: name => name === './apiHttpClient' ? { createApiClient: () => api }
      : name === './conversaoAplicar' ? { aplicarConversaoNoEstoque: async (_api, data) => { stockCalls.push(data); return { avisos: [] }; } }
      : realRequire(name)
  }, { filename });
  return module.exports;
}

function fixture(withLink = false) {
  const db = newDb();
  // Nomes usados no schema local, sem pedidos.orcamento_id e sem os aliases
  // opcionais de atividade. Apenas dados fictícios; não carrega o .env.
  db.public.none(`
    CREATE TABLE orcamentos (id integer PRIMARY KEY, cliente_id integer, parcelas integer, prazo text, valor_final numeric);
    CREATE TABLE orcamentos_itens (id integer PRIMARY KEY, orcamento_id integer, produto_id integer, nome text, quantidade numeric, valor_unitario numeric, valor_total numeric);
    CREATE TABLE orcamento_parcelas (id integer PRIMARY KEY, orcamento_id integer, numero_parcela integer, valor numeric, data_vencimento date);
    CREATE TABLE pedidos (
      id integer PRIMARY KEY, numero text UNIQUE, cliente_id integer, data_emissao timestamptz,
      data_aprovacao date, situacao text, parcelas integer, valor_final numeric, prazo text,
      pode_saldo_negativo boolean NOT NULL, decisao_estoque_note text, decisao_estoque_by integer
      ${withLink ? ', orcamento_id integer' : ''}
    );
    CREATE TABLE pedidos_itens (id integer PRIMARY KEY, pedido_id integer REFERENCES pedidos(id), produto_id integer,
      nome text, quantidade numeric, valor_unitario numeric, valor_total numeric, qtd_a_produzir numeric NOT NULL, qtd_usar_pronta numeric NOT NULL);
    CREATE TABLE pedido_parcelas (id integer PRIMARY KEY, pedido_id integer REFERENCES pedidos(id), numero_parcela integer, valor numeric, data_vencimento date);
    CREATE TABLE usuarios (id integer PRIMARY KEY, nome text, email text, perfil text, status text, permissoes jsonb,
      foto_usuario text, avatar_version integer, modelo_permissoes_id integer, data_ativacao date,
      ultima_entrada timestamptz, ultima_saida timestamptz, ultima_alteracao timestamptz,
      local_ultima_alteracao text, especificacao_ultima_alteracao text, senha text, confirmacao_token text);
    INSERT INTO orcamentos VALUES (7, 5, 2, '30/60', 100);
    INSERT INTO orcamentos_itens VALUES (1, 7, 10, 'Peça', 2, 50, 100);
    INSERT INTO orcamento_parcelas VALUES (1, 7, 1, 50, '2026-10-15'), (2, 7, 2, 50, '2026-11-15');
    INSERT INTO usuarios (id,nome,email,perfil,status,ultima_entrada,local_ultima_alteracao,senha,confirmacao_token)
      VALUES (1,'Teste','teste@example.invalid','Admin','ativo','2026-09-15T12:00:00Z','Produtos','SEGREDO-SENHA','SEGREDO-TOKEN');
  `);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  return { pool, api: createLocalDataClient(pool) };
}

for (const withLink of [false, true]) {
  test(`conversão DEV cria pedido, itens e parcelas sem duplicar; coluna orcamento_id=${withLink}`, async t => {
    const { pool, api } = fixture(withLink);
    t.after(() => pool.end());
    const stockCalls = [];
    const { converter } = controller('orcamentosController.js', api, stockCalls);
    const first = await converter(api, 7);
    assert.equal(first.jaExistia, false);
    assert.equal(first.pedido.id, 7);
    const second = await converter(api, 7);
    assert.equal(second.jaExistia, true);
    assert.equal(second.pedido.id, 7);
    assert.equal((await api.get('/pedidos')).length, 1);
    const itens = await api.get('/pedidos_itens');
    assert.equal(itens.length, 1);
    assert.equal(Number(itens[0].qtd_a_produzir), 2);
    const parcelas = await api.get('/pedido_parcelas');
    assert.equal(parcelas.length, 2);
    assert.equal(parcelas.reduce((sum, row) => sum + Number(row.valor), 0), 100);
    assert.equal(stockCalls.length, 1);
    assert.equal(stockCalls[0].itens[0].pedido_item_id, itens[0].id);
    if (withLink) {
      // Com a coluna real, o vínculo não deve ser inferido pelo id do pedido.
      await api.post('/pedidos', { id: 20, numero: 'PED20', orcamento_id: 30, pode_saldo_negativo: false });
      assert.equal((await converter(api, 30)).pedido.id, 20);
    }
  });
}

test('lista DEV mantém atividade existente sem expor senha/token nem tentar aliases ausentes', async t => {
  const { pool, api } = fixture();
  t.after(() => pool.end());
  const router = controller('usuariosController.js', api);
  const handler = router.stack.find(layer => layer.route?.path === '/lista').route.stack[0].handle;
  let status;
  let body;
  await handler({ query: {} }, { status: code => { status = code; return { json: data => { body = data; } }; } });
  assert.equal(status, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].local_ultima_alteracao, 'Produtos');
  assert.equal(body[0].ultima_entrada, '2026-09-15T12:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(body), /SEGREDO|senha|confirmacao_token/);
});

test('erro real ao procurar pedido existente impede nova gravação', async t => {
  const { pool, api } = fixture();
  t.after(() => pool.end());
  let writes = 0;
  const broken = { ...api, get: async () => { throw new Error('falha de leitura'); }, post: async () => { writes++; } };
  const { converter } = controller('orcamentosController.js', broken);
  await assert.rejects(converter(broken, 7), /falha de leitura/);
  assert.equal(writes, 0);
});
