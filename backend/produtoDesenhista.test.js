/**
 * "Desenhado por" da peça (backend/produtos.js): obrigatório para criar, só
 * nomes da tabela `desenhistas` (gravados com a grafia do cadastro), editar
 * sem mandar o campo não apaga, e a peça antiga sem desenhista precisa ganhar
 * um ao salvar a ficha. Sem o SQL, a mensagem diz qual arquivo rodar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// `remoteDatabase` guarda a URL da API ao ser carregado: recarregado a cada teste.
const MODULOS = ['./produtos', './db', './remoteDatabase'];

function criarUpstream(tabelasIniciais) {
  const tabelas = JSON.parse(JSON.stringify(tabelasIniciais));
  let proximoId = 1000;
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const [tabela, id] = url.pathname.replace(/^\/api\//, '').split('/');
      const body = corpo ? JSON.parse(corpo) : null;
      const responder = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const linhas = tabelas[tabela];
      if (!linhas) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
      if (req.method === 'GET') {
        let saida = linhas;
        for (const [campo, valor] of url.searchParams) {
          if (['select', 'limit', 'order'].includes(campo)) continue;
          saida = saida.filter(l => String(l[campo]) === String(valor));
        }
        return responder(200, saida);
      }
      if (req.method === 'POST') {
        const nova = { id: proximoId++, ...body };
        linhas.push(nova);
        return responder(201, nova);
      }
      if (req.method === 'PUT') {
        const linha = linhas.find(l => String(l.id) === String(id));
        if (!linha) return responder(404, { error: 'Not found' });
        Object.assign(linha, body);
        return responder(200, linha);
      }
      return responder(404, { error: 'Not found' });
    });
  });
  return { servidor, tabelas };
}

async function montar(tabelasIniciais) {
  const upstream = criarUpstream(tabelasIniciais);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  const anterior = process.env.API_BASE_URL;
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  require('./db').init('token-de-teste');
  return {
    produtos: require('./produtos'),
    tabelas: upstream.tabelas,
    async encerrar() {
      process.env.API_BASE_URL = anterior;
      await new Promise(r => upstream.servidor.close(r));
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

const NOVA = { codigo: 'POL-02', nome: 'Poltrona Nova', preco_venda: 1000, pct_markup: 10, status: 'ativo' };
const FICHA = { pct_fabricacao: 0, pct_acabamento: 0, pct_montagem: 0, pct_embalagem: 0, pct_markup: 0, pct_comissao: 0, pct_imposto: 0, preco_base: 0, preco_venda: 0 };

const base = () => ({
  desenhistas: [{ id: 1, nome: 'Barral & Lamounier' }, { id: 2, nome: 'Estúdio Ninho' }],
  produtos: [
    { id: 7, codigo: 'VASO-01', nome: 'Vaso', desenhado_por: 'Barral & Lamounier' },
    { id: 8, codigo: 'MESA-01', nome: 'Mesa', desenhado_por: null }
  ],
  produtos_insumos: [],
  tabela_fixa: []
});

test('criar peça: desenhista obrigatório e só da lista, gravado com a grafia do cadastro', async () => {
  const ctx = await montar(base());
  try {
    await assert.rejects(ctx.produtos.adicionarProduto({ ...NOVA }), e => e.code === 'CAMPO_OBRIGATORIO' && e.field === 'desenhado_por');
    await assert.rejects(ctx.produtos.adicionarProduto({ ...NOVA, desenhado_por: '   ' }), e => e.field === 'desenhado_por');
    await assert.rejects(ctx.produtos.adicionarProduto({ ...NOVA, desenhado_por: 'Fulano' }), e => e.code === 'DESENHISTA_DESCONHECIDO' && /inclua pelo \+/.test(e.message));
    assert.equal(ctx.tabelas.produtos.length, 2, 'nada foi gravado');
    await ctx.produtos.adicionarProduto({ ...NOVA, desenhado_por: '  estudio   NINHO ' });
    assert.equal(ctx.tabelas.produtos.find(p => p.codigo === 'POL-02').desenhado_por, 'Estúdio Ninho');
  } finally {
    await ctx.encerrar();
  }
});

test('editar: sem o campo não mexe; vazio é recusado; trocar grava o novo', async () => {
  const ctx = await montar(base());
  try {
    await ctx.produtos.atualizarProduto(7, { nome: 'Vaso Alto' });
    assert.equal(ctx.tabelas.produtos[0].desenhado_por, 'Barral & Lamounier');
    await assert.rejects(ctx.produtos.atualizarProduto(7, { desenhado_por: '' }), e => e.field === 'desenhado_por');
    await ctx.produtos.atualizarProduto(7, { desenhado_por: 'estúdio ninho' });
    assert.equal(ctx.tabelas.produtos[0].desenhado_por, 'Estúdio Ninho');
  } finally {
    await ctx.encerrar();
  }
});

test('ficha: a peça sem desenhista precisa ganhar um ao salvar; a que tem pode salvar sem mandar', async () => {
  const ctx = await montar(base());
  const itens = id => ({ produto_id: id, inseridos: [], atualizados: [], deletados: [] });
  try {
    await assert.rejects(ctx.produtos.salvarProdutoDetalhado('MESA-01', { ...FICHA }, itens(8), 8), e => e.field === 'desenhado_por');
    await ctx.produtos.salvarProdutoDetalhado('MESA-01', { ...FICHA, desenhado_por: 'Barral & Lamounier' }, itens(8), 8);
    assert.equal(ctx.tabelas.produtos[1].desenhado_por, 'Barral & Lamounier');
    await ctx.produtos.salvarProdutoDetalhado('VASO-01', { ...FICHA }, itens(7), 7);
    assert.equal(ctx.tabelas.produtos[0].desenhado_por, 'Barral & Lamounier');
  } finally {
    await ctx.encerrar();
  }
});

test('sem a tabela de desenhistas (SQL não rodou): a peça não é criada e a mensagem diz o arquivo', async () => {
  const dados = base();
  delete dados.desenhistas;
  const ctx = await montar(dados);
  try {
    await assert.rejects(
      ctx.produtos.adicionarProduto({ ...NOVA, desenhado_por: 'Barral & Lamounier' }),
      e => e.code === 'SQL_PENDENTE' && /desenhistas_producao_parcela\.sql/.test(e.message)
    );
  } finally {
    await ctx.encerrar();
  }
});
