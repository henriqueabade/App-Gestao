/**
 * Citações com # no chat interno (backend/chatReferencias.js, 12/10/2026).
 *
 * Pedido do dono: "obviamente restrito ao que o perfil deles permite ver".
 * O que trava:
 *   - ao buscar, só os tipos que o perfil vê (e, nas tarefas, só as que a
 *     pessoa vê pela regra das Tarefas);
 *   - ao ler, o nome sai só para quem tem a permissão — sem ela, "sem
 *     acesso" e o nome NÃO vai na resposta;
 *   - o Sup Admin vê tudo; pedido e orçamento levam o nome do cliente;
 *   - lixo no pedido (tipo desconhecido, id torto) é ignorado.
 *
 * Os módulos de fora (API, permissões, contexto das tarefas) são duplos
 * postos no cache do require; as regras de permissão e de tarefas são as
 * de verdade (permissionsRepository, tarefasRegras).
 */
const test = require('node:test');
const assert = require('node:assert');

const { MODULE_CODES } = require('./permissionsCatalog');

const TABELAS = {
  clientes: [
    { id: 50, nome_fantasia: 'Casa Vicenzo', razao_social: 'Vicenzo Ltda' },
    { id: 51, nome_fantasia: null, razao_social: 'São Bento Decorações' }
  ],
  prospeccoes: [{ id: 7, nome_fantasia: 'Loja Nova', razao_social: 'Nova ME', status: 'Em contato' }],
  contatos: [{ id: 3, nome_fantasia: 'Transportes Rápido', razao_social: null, nome: null }],
  pedidos: [{ id: 900, numero: 'PED-0900', cliente_id: 50, situacao: 'Produção' }],
  orcamentos: [{ id: 800, numero: 'ORC-0800', cliente_id: 51, situacao: 'Aprovado' }],
  produtos: [{ id: 20, codigo: 'AB-01', nome: 'Aparador Bento' }],
  tarefas: [
    { id: 1, titulo: 'Ligar para a Casa Vicenzo', status: 'aberta', criado_por: 2, responsavel_id: 2 },
    { id: 2, titulo: 'Tarefa secreta do financeiro', status: 'aberta', criado_por: 9, responsavel_id: 9 },
    { id: 3, titulo: 'Tarefa em que participo', status: 'aberta', criado_por: 9, responsavel_id: 9 },
    { id: 4, titulo: 'Excluída', status: 'aberta', criado_por: 2, responsavel_id: 2, excluida_em: '2026-10-01' }
  ],
  tarefa_participantes: [{ tarefa_id: 3, usuario_id: 2, status: 'aceito' }]
};

const api = {
  chamadas: [],
  async get(caminho) {
    this.chamadas.push(caminho);
    const tabela = caminho.replace(/^\/api\//, '').split('?')[0];
    return JSON.parse(JSON.stringify(TABELAS[tabela] || []));
  }
};

function duplo(relativo, exportacoes) {
  const caminho = require.resolve(relativo);
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: exportacoes };
}

/** Carrega chatReferencias com um usuário e as chaves que o perfil dele tem. */
function carregar({ usuario, chaves = [] }) {
  const acoes = Object.fromEntries(chaves.map(c => [c, true]));
  const permissoes = { [MODULE_CODES[0]]: { ativo: true, acoes, colunas: {} } };
  duplo('./apiHttpClient', { createApiClient: () => api });
  duplo('./permissionsController', {
    obterPermissoesEfetivas: async () => permissoes,
    carregarUsuarioAtual: async () => usuario
  });
  duplo('./tarefasController', {
    montarContexto: async () => ({ api, usuarioId: usuario.id, escopo: { gestor: false, todos: false, alvos: new Set() } })
  });
  delete require.cache[require.resolve('./chatReferencias')];
  return require('./chatReferencias');
}

test.after(() => {
  for (const m of ['./apiHttpClient', './permissionsController', './tarefasController', './chatReferencias']) delete require.cache[require.resolve(m)];
});

const VENDEDOR = { id: 2, nome: 'Bia Vendas', perfil: 'Vendedor' };

test('buscar: só os tipos que o perfil vê, sem acento e por parte do nome', async () => {
  const R = carregar({ usuario: VENDEDOR, chaves: ['cli.view', 'tarefas.view'] });
  const r = await R.buscar({ query: { q: 'sao' } });
  assert.deepStrictEqual(r.tipos.map(t => t.tipo).sort(), ['cliente', 'tarefa']);
  assert.deepStrictEqual(r.itens.map(i => `${i.tipo}:${i.id}:${i.rotulo}`), ['cliente:51:São Bento Decorações']);
  const pedidos = await R.buscar({ query: { q: 'ped', tipo: 'pedido' } });
  assert.deepStrictEqual(pedidos.itens, [], 'tipo sem permissão pedido de propósito: nada');
  assert.ok(!api.chamadas.includes('/api/pedidos'), 'nem pergunta à API pelos pedidos');
});

test('buscar tarefas: só as que a pessoa vê (fez, responde ou participa); excluída não', async () => {
  const R = carregar({ usuario: VENDEDOR, chaves: ['tarefas.view'] });
  const r = await R.buscar({ query: { q: 'tarefa', tipo: 'tarefa' } });
  assert.deepStrictEqual(r.itens.map(i => i.id), [3]);
  const todas = await R.buscar({ query: { tipo: 'tarefa' } });
  assert.deepStrictEqual(todas.itens.map(i => i.id).sort(), [1, 3]);
});

test('resolver: com permissão, o nome; sem, "sem acesso" e o nome não sai daqui', async () => {
  const R = carregar({ usuario: VENDEDOR, chaves: ['cli.view', 'tarefas.view'] });
  const r = await R.resolver({
    body: {
      itens: [
        { tipo: 'cliente', id: 50 }, { tipo: 'pedido', id: 900 }, { tipo: 'cliente', id: 999 },
        { tipo: 'tarefa', id: 1 }, { tipo: 'tarefa', id: 2 }, { tipo: 'usuarios', id: 1 }, { tipo: 'cliente', id: 'abc' }
      ]
    }
  });
  const por = Object.fromEntries(r.itens.map(i => [`${i.tipo}:${i.id}`, i]));
  assert.strictEqual(por['cliente:50'].rotulo, 'Casa Vicenzo');
  assert.strictEqual(por['pedido:900'].sem_acesso, true);
  assert.strictEqual(por['cliente:999'].nao_encontrado, true);
  assert.strictEqual(por['tarefa:1'].rotulo, 'Ligar para a Casa Vicenzo');
  assert.strictEqual(por['tarefa:2'].sem_acesso, true, 'tarefa de outro, fora do escopo: sem acesso');
  assert.strictEqual(r.itens.length, 5, 'tipo desconhecido e id torto ficam de fora');
  const texto = JSON.stringify(r);
  assert.ok(!texto.includes('PED-0900'), 'o número do pedido não vai para quem não vê pedidos');
  assert.ok(!texto.includes('secreta'), 'o título da tarefa alheia não vai');
});

test('Sup Admin vê todos os tipos; pedido e orçamento trazem o cliente', async () => {
  const R = carregar({ usuario: { id: 1, nome: 'Dono', perfil: 'Sup Admin' } });
  const r = await R.resolver({ body: { itens: [{ tipo: 'pedido', id: 900 }, { tipo: 'orcamento', id: 800 }, { tipo: 'produto', id: 20 }, { tipo: 'contato', id: 3 }, { tipo: 'prospeccao', id: 7 }] } });
  const por = Object.fromEntries(r.itens.map(i => [`${i.tipo}:${i.id}`, i]));
  assert.strictEqual(por['pedido:900'].rotulo, 'PED-0900');
  assert.strictEqual(por['pedido:900'].detalhe, 'Casa Vicenzo · Produção');
  assert.strictEqual(por['orcamento:800'].detalhe, 'São Bento Decorações · Aprovado');
  assert.strictEqual(por['produto:20'].rotulo, 'AB-01 — Aparador Bento');
  assert.strictEqual(por['contato:3'].rotulo, 'Transportes Rápido');
  assert.strictEqual(por['prospeccao:7'].rotulo, 'Loja Nova');
  const tipos = (await R.buscar({ query: { q: '' } })).tipos.map(t => t.tipo).sort();
  assert.deepStrictEqual(tipos, ['cliente', 'contato', 'orcamento', 'pedido', 'produto', 'prospeccao', 'tarefa']);
});
