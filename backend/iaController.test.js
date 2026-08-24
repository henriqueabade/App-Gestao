/**
 * Testes do módulo IA — Etapa 1 (fundação e configuração dos provedores).
 *
 * O duplo da API remota abaixo NÃO é um mock complacente: ele reproduz de
 * propósito as limitações do Santissimo-db-API real —
 *
 *   • devolve as linhas em ordem de INSERÇÃO e ignora `order`/`limit`/`select`;
 *   • filtra só por igualdade em coluna que existe;
 *   • NÃO aplica ON DELETE CASCADE: a API é um CRUD genérico e um DELETE numa
 *     linha pai não dispara nada além do próprio DELETE. É por isso que o
 *     controller apaga os filhos explicitamente — e é isso que precisa ser
 *     provado aqui.
 *
 * As leituras são inseridas FORA de ordem cronológica justamente para que, se
 * o controller voltar a confiar na ordem da API, o teste quebre.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  ia_extracoes: [
    'id', 'titulo', 'destino', 'status', 'modelo_ocr', 'modelo_llm',
    'arquivos_qtd', 'itens_qtd', 'aplicados_qtd', 'erro', 'usuario_id',
    'criado_em', 'atualizado_em', 'aplicado_em'
  ],
  ia_extracao_arquivos: [
    'id', 'extracao_id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes',
    'origem', 'paginas', 'texto', 'erro', 'criado_em'
  ],
  ia_extracao_itens: [
    'id', 'extracao_id', 'linha', 'dados', 'acao', 'alvo_tabela', 'alvo_id',
    'confianca', 'status', 'mensagem', 'criado_em', 'aplicado_em'
  ],
  usuarios: ['id', 'nome', 'perfil', 'modelo_permissoes_id'],
  modelos_permissoes: ['id', 'nome'],
  // Tabela real de permissões do módulo. Sem ela no duplo, todo usuário sem
  // Sup Admin cai em "tudo negado" e um teste de permissão passaria por vazio.
  perm_ia: [
    'id', 'modelo_id', 'modulo_ativo',
    'acao_view', 'acao_search', 'acao_details_view', 'acao_delete',
    'acao_upload', 'acao_extract', 'acao_review_edit',
    'acao_apply_mp', 'acao_apply_prod', 'acao_apply_cli', 'acao_apply_pros',
    'acao_apply_orc', 'acao_config'
  ]
};

function criarUpstream(dados, opcoes = {}) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const chamadas = [];
  const falharEm = opcoes.falharEm || (() => false);

  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const partes = url.pathname.split('/').filter(Boolean); // ['api', tabela, id?]
      const tabela = partes[1];
      const id = partes[2];
      const body = corpo ? JSON.parse(corpo) : null;

      chamadas.push({ metodo: req.method, tabela, id, query: url.search, body });

      const responder = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      // A API real só atende sob /api. Sem esta recusa, um caminho sem o
      // prefixo passaria no teste e continuaria quebrado em produção.
      if (partes[0] !== 'api') return responder(404, { error: 'Rota não encontrada' });
      if (falharEm({ metodo: req.method, tabela, id })) {
        return responder(500, { error: 'Falha simulada' });
      }
      if (!tabelas[tabela]) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
      const colunas = COLUNAS[tabela] || [];

      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Registro não encontrado' });
      }

      if (req.method === 'GET') {
        // Igual à API real: só entram no WHERE as chaves que são coluna real.
        let linhas = tabelas[tabela];
        for (const [chave, valor] of url.searchParams.entries()) {
          if (!colunas.includes(chave)) continue;
          linhas = linhas.filter(r => String(r[chave]) === String(valor));
        }
        return responder(200, linhas);
      }

      if (req.method === 'POST') {
        const proximo = Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1;
        const linha = { id: proximo };
        for (const c of colunas) if (body?.[c] !== undefined) linha[c] = body[c];
        tabelas[tabela].push(linha);
        return responder(201, linha);
      }

      if (req.method === 'PUT') {
        const alvo = tabelas[tabela].find(r => String(r.id) === String(id));
        if (!alvo) return responder(404, { error: 'Registro não encontrado' });
        for (const c of colunas) if (body?.[c] !== undefined) alvo[c] = body[c];
        return responder(200, alvo);
      }

      if (req.method === 'DELETE') {
        const idx = tabelas[tabela].findIndex(r => String(r.id) === String(id));
        if (idx === -1) return responder(404, { error: 'Registro não encontrado' });
        const [removido] = tabelas[tabela].splice(idx, 1);
        // Sem cascata de propósito: é assim que a API real se comporta.
        return responder(200, { sucesso: true, deletado: removido });
      }

      responder(405, { error: 'Método não suportado' });
    });
  });

  return { servidor, tabelas, chamadas };
}

const MODULOS = [
  './apiHttpClient', './permissionsController', './permissionsRepository',
  './iaProvedores', './iaLeitura', './iaController'
];

async function montar(dados, env = {}, opcoes = {}) {
  const upstream = criarUpstream(dados, opcoes);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;

  const envAnterior = {};
  for (const [chave, valor] of Object.entries(env)) {
    envAnterior[chave] = process.env[chave];
    if (valor === null) delete process.env[chave];
    else process.env[chave] = valor;
  }

  // Limpa o cache: permissionsController guarda usuário e permissões em
  // memória, e um teste vazaria no seguinte.
  for (const m of MODULOS) delete require.cache[require.resolve(m)];

  const app = express();
  app.use(express.json());
  app.use('/api/ia', require('./iaController'));

  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));

  return {
    porta: server.address().port,
    tabelas: upstream.tabelas,
    chamadas: upstream.chamadas,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const [chave, valor] of Object.entries(envAnterior)) {
        if (valor === undefined) delete process.env[chave];
        else process.env[chave] = valor;
      }
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

function chamar(porta, caminho, opcoes = {}) {
  const { usuario = 1, ...resto } = opcoes;
  return fetch(`http://127.0.0.1:${porta}${caminho}`, {
    ...resto,
    headers: {
      authorization: `Bearer ${tokenDe(usuario)}`,
      'content-type': 'application/json',
      ...(resto.headers || {})
    }
  });
}

// ---------------------------------------------------------------------------
// Massa de teste
// ---------------------------------------------------------------------------

const ANTIGA = '2026-01-10T10:00:00.000Z';
const MEIO = '2026-05-15T10:00:00.000Z';
const RECENTE = '2026-08-01T10:00:00.000Z';

function baseDados() {
  return {
    usuarios: [
      { id: 1, nome: 'Henrique', perfil: 'Sup Admin', modelo_permissoes_id: null },
      { id: 2, nome: 'Vendedora Ana', perfil: 'Vendedor', modelo_permissoes_id: 10 }
    ],
    modelos_permissoes: [{ id: 10, nome: 'Vendedor' }],
    perm_ia: [],
    // Inseridas FORA de ordem cronológica de propósito.
    ia_extracoes: [
      {
        id: 1, titulo: 'Planilha de chapas', destino: 'materia_prima', status: 'revisao',
        modelo_ocr: 'gemini-2.5-flash', modelo_llm: 'llama-3.3-70b-versatile',
        arquivos_qtd: 1, itens_qtd: 2, aplicados_qtd: 0, usuario_id: 2, criado_em: MEIO
      },
      {
        id: 2, titulo: 'Cartões da feira', destino: 'prospeccoes', status: 'aplicada',
        modelo_ocr: 'gemini-2.5-flash', modelo_llm: 'llama-3.3-70b-versatile',
        arquivos_qtd: 1, itens_qtd: 1, aplicados_qtd: 1, usuario_id: 1,
        criado_em: ANTIGA, aplicado_em: ANTIGA
      },
      {
        id: 3, titulo: 'Pedido escaneado', destino: 'orcamentos', status: 'erro',
        arquivos_qtd: 1, itens_qtd: 0, aplicados_qtd: 0, usuario_id: 1,
        erro: 'PDF ilegível', criado_em: RECENTE
      }
    ],
    ia_extracao_arquivos: [
      { id: 11, extracao_id: 1, nome_arquivo: 'chapas.xlsx', origem: 'planilha', tamanho_bytes: 1024, texto: 'MDF 15mm | 40 | 189,90' },
      { id: 12, extracao_id: 2, nome_arquivo: 'cartao.jpg', origem: 'imagem', tamanho_bytes: 2048, texto: 'MARCENARIA SERRANA' },
      { id: 13, extracao_id: 3, nome_arquivo: 'pedido.pdf', origem: 'pdf', tamanho_bytes: 4096, texto: null, erro: 'nada lido' }
    ],
    ia_extracao_itens: [
      { id: 21, extracao_id: 1, linha: 2, dados: '{"nome":"Fita de borda","quantidade":500}', acao: 'criar', status: 'pendente' },
      { id: 22, extracao_id: 1, linha: 1, dados: '{"nome":"MDF 15mm","quantidade":40}', acao: 'atualizar', alvo_tabela: 'materia_prima', alvo_id: 77, status: 'pendente' },
      { id: 23, extracao_id: 2, linha: 1, dados: '{"nome_fantasia":"Marcenaria Serrana"}', acao: 'criar', status: 'aplicado' }
    ]
  };
}

/** Libera as ações informadas para o perfil Vendedor (modelo 10). */
function permitir(dados, acoes) {
  const linha = { id: 1, modelo_id: 10, modulo_ativo: true };
  for (const a of acoes) linha[a] = true;
  dados.perm_ia = [linha];
  return dados;
}

// ---------------------------------------------------------------------------
// LISTA
// ---------------------------------------------------------------------------

test('a lista devolve as leituras da mais recente para a mais antiga', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/ia/lista');
    assert.strictEqual(resp.status, 200);
    const { itens } = await resp.json();

    // A API devolve na ordem de inserção (1, 2, 3); quem ordena é o controller.
    assert.deepStrictEqual(itens.map(i => i.id), [3, 1, 2]);
  } finally {
    await ctx.encerrar();
  }
});

test('a lista resolve o nome do responsável', async () => {
  const ctx = await montar(baseDados());
  try {
    const { itens } = await (await chamar(ctx.porta, '/api/ia/lista')).json();
    const porId = new Map(itens.map(i => [i.id, i]));
    assert.strictEqual(porId.get(1).usuario_nome, 'Vendedora Ana');
    assert.strictEqual(porId.get(2).usuario_nome, 'Henrique');
  } finally {
    await ctx.encerrar();
  }
});

test('a lista traduz o destino para um rótulo legível', async () => {
  const ctx = await montar(baseDados());
  try {
    const { itens } = await (await chamar(ctx.porta, '/api/ia/lista')).json();
    const porId = new Map(itens.map(i => [i.id, i]));
    assert.match(porId.get(1).destino_rotulo, /Matéria-prima/);
    assert.match(porId.get(2).destino_rotulo, /Prospecções/);
  } finally {
    await ctx.encerrar();
  }
});

test('a lista traz os catálogos de destino e situação', async () => {
  const ctx = await montar(baseDados());
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/lista')).json();

    // O front monta os filtros a partir disto — não de uma cópia própria.
    assert.deepStrictEqual(
      dados.destinos.map(d => d.id).sort(),
      ['clientes', 'materia_prima', 'orcamentos', 'produto_insumos', 'prospeccoes']
    );
    assert.deepStrictEqual(
      dados.situacoes.map(s => s.id),
      ['rascunho', 'lendo', 'revisao', 'aplicada', 'erro', 'cancelada']
    );
  } finally {
    await ctx.encerrar();
  }
});

test('a lista conta as leituras por situação (a API não agrega)', async () => {
  const ctx = await montar(baseDados());
  try {
    const { resumo } = await (await chamar(ctx.porta, '/api/ia/lista')).json();
    assert.strictEqual(resumo.revisao, 1);
    assert.strictEqual(resumo.aplicada, 1);
    assert.strictEqual(resumo.erro, 1);
    assert.strictEqual(resumo.rascunho, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('a lista sobrevive à falha ao buscar os nomes de usuário', async () => {
  // Derruba SÓ a listagem de usuários (`GET /api/usuarios`, sem id). A busca
  // por id continua de pé de propósito: é por ela que passa a checagem de
  // permissão, e derrubar as duas daria 403 — um resultado que não diz nada
  // sobre o caminho que este teste quer exercitar.
  const ctx = await montar(baseDados(), {}, {
    falharEm: ({ metodo, tabela, id }) => metodo === 'GET' && tabela === 'usuarios' && !id
  });
  try {
    const resp = await chamar(ctx.porta, '/api/ia/lista');
    assert.strictEqual(resp.status, 200);
    const { itens } = await resp.json();
    assert.strictEqual(itens.length, 3);
    assert.strictEqual(itens[0].usuario_nome, null);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// DETALHE
// ---------------------------------------------------------------------------

test('o detalhe ordena os itens pela linha do documento', async () => {
  const ctx = await montar(baseDados());
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/1')).json();
    // Gravados como 2 e depois 1; precisam sair na ordem do documento.
    assert.deepStrictEqual(dados.itens.map(i => i.linha), [1, 2]);
  } finally {
    await ctx.encerrar();
  }
});

test('o detalhe entrega `dados` já como objeto', async () => {
  const ctx = await montar(baseDados());
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/1')).json();
    const item = dados.itens.find(i => i.linha === 1);
    assert.strictEqual(item.dados.nome, 'MDF 15mm');
    assert.strictEqual(item.dados.quantidade, 40);
    assert.strictEqual(item.dados_corrompidos, false);
  } finally {
    await ctx.encerrar();
  }
});

test('item com JSON corrompido não derruba a leitura inteira', async () => {
  const dados = baseDados();
  dados.ia_extracao_itens.push({
    id: 24, extracao_id: 1, linha: 3, dados: '{isto nao e json', acao: 'criar', status: 'pendente'
  });
  const ctx = await montar(dados);
  try {
    const resp = await chamar(ctx.porta, '/api/ia/1');
    assert.strictEqual(resp.status, 200);
    const corpo = await resp.json();

    // Os dois itens bons continuam lá, e o ruim aparece marcado.
    assert.strictEqual(corpo.itens.length, 3);
    const ruim = corpo.itens.find(i => i.linha === 3);
    assert.strictEqual(ruim.dados_corrompidos, true);
    assert.deepStrictEqual(ruim.dados, {});
    assert.match(ruim.mensagem, /não pôde ser interpretado/);
  } finally {
    await ctx.encerrar();
  }
});

test('o detalhe manda o tamanho do texto, não o texto', async () => {
  const ctx = await montar(baseDados());
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/1')).json();
    const arquivo = dados.arquivos[0];
    // O texto lido de um PDF longo tem dezenas de milhares de caracteres;
    // mandá-lo junto da lista pesaria a abertura de todo detalhe.
    assert.strictEqual(arquivo.texto, undefined);
    assert.strictEqual(arquivo.texto_tamanho, 'MDF 15mm | 40 | 189,90'.length);
  } finally {
    await ctx.encerrar();
  }
});

test('o texto de um arquivo vem por rota própria', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/ia/1/arquivos/11/texto');
    assert.strictEqual(resp.status, 200);
    const dados = await resp.json();
    assert.strictEqual(dados.texto, 'MDF 15mm | 40 | 189,90');
  } finally {
    await ctx.encerrar();
  }
});

test('não dá para ler o arquivo de outra leitura trocando o id', async () => {
  const ctx = await montar(baseDados());
  try {
    // O arquivo 12 pertence à leitura 2. Pedir por /api/ia/1/... não pode
    // entregá-lo: sem a checagem do vínculo, qualquer id seria legível.
    const resp = await chamar(ctx.porta, '/api/ia/1/arquivos/12/texto');
    assert.strictEqual(resp.status, 404);
  } finally {
    await ctx.encerrar();
  }
});

test('leitura inexistente devolve 404', async () => {
  const ctx = await montar(baseDados());
  try {
    assert.strictEqual((await chamar(ctx.porta, '/api/ia/999')).status, 404);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// EXCLUSÃO
// ---------------------------------------------------------------------------

test('excluir uma leitura leva arquivos e itens junto', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/ia/1', { method: 'DELETE' });
    assert.strictEqual(resp.status, 200);

    assert.strictEqual(ctx.tabelas.ia_extracoes.some(e => e.id === 1), false);
    // A API não faz cascata: se o controller não apagar, sobra órfão.
    assert.strictEqual(ctx.tabelas.ia_extracao_arquivos.some(a => a.extracao_id === 1), false);
    assert.strictEqual(ctx.tabelas.ia_extracao_itens.some(i => i.extracao_id === 1), false);
  } finally {
    await ctx.encerrar();
  }
});

test('excluir uma leitura não toca nas outras', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/ia/1', { method: 'DELETE' });
    assert.strictEqual(ctx.tabelas.ia_extracao_itens.filter(i => i.extracao_id === 2).length, 1);
    assert.strictEqual(ctx.tabelas.ia_extracao_arquivos.filter(a => a.extracao_id === 2).length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('leitura já aplicada não pode ser excluída', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/ia/2', { method: 'DELETE' });
    assert.strictEqual(resp.status, 409);
    const corpo = await resp.json();
    assert.match(corpo.error, /já foi aplicada/);

    // E nada saiu do banco.
    assert.strictEqual(ctx.tabelas.ia_extracoes.some(e => e.id === 2), true);
    assert.strictEqual(ctx.tabelas.ia_extracao_itens.some(i => i.extracao_id === 2), true);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// PERMISSÕES
// ---------------------------------------------------------------------------

test('sem ia.view o usuário comum não lê a lista', async () => {
  const ctx = await montar(permitir(baseDados(), ['acao_details_view']));
  try {
    assert.strictEqual((await chamar(ctx.porta, '/api/ia/lista', { usuario: 2 })).status, 403);
  } finally {
    await ctx.encerrar();
  }
});

test('com ia.view o usuário comum lê a lista', async () => {
  const ctx = await montar(permitir(baseDados(), ['acao_view']));
  try {
    assert.strictEqual((await chamar(ctx.porta, '/api/ia/lista', { usuario: 2 })).status, 200);
  } finally {
    await ctx.encerrar();
  }
});

test('sem ia.delete o usuário comum não exclui', async () => {
  const ctx = await montar(permitir(baseDados(), ['acao_view', 'acao_details_view']));
  try {
    const resp = await chamar(ctx.porta, '/api/ia/1', { method: 'DELETE', usuario: 2 });
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(ctx.tabelas.ia_extracoes.some(e => e.id === 1), true);
  } finally {
    await ctx.encerrar();
  }
});

test('sem ia.config o usuário comum não vê o estado das credenciais', async () => {
  const ctx = await montar(permitir(baseDados(), ['acao_view']));
  try {
    assert.strictEqual((await chamar(ctx.porta, '/api/ia/config/estado', { usuario: 2 })).status, 403);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// CONFIGURAÇÃO DOS PROVEDORES
// ---------------------------------------------------------------------------

test('o estado diz o que falta quando as chaves não estão no .env', async () => {
  const ctx = await montar(baseDados(), { GEMINI_API_KEY: null, GROQ_API_KEY: null });
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/config/estado')).json();
    assert.strictEqual(dados.gemini.configurado, false);
    assert.strictEqual(dados.groq.configurado, false);
    assert.strictEqual(dados.pronto, false);
    assert.strictEqual(dados.gemini.variavelChave, 'GEMINI_API_KEY');
    assert.strictEqual(dados.groq.variavelChave, 'GROQ_API_KEY');
  } finally {
    await ctx.encerrar();
  }
});

test('a chave NUNCA sai do backend — só os quatro últimos caracteres', async () => {
  const CHAVE = 'AIzaSyPARECE-UMA-CHAVE-DE-VERDADE-9Q7x';
  const ctx = await montar(baseDados(), { GEMINI_API_KEY: CHAVE, GROQ_API_KEY: 'gsk_secretissimo_1234' });
  try {
    const resp = await chamar(ctx.porta, '/api/ia/config/estado');
    const bruto = await resp.text();

    // O corpo inteiro, não só o campo: um vazamento em qualquer canto conta.
    assert.strictEqual(bruto.includes(CHAVE), false, 'a chave do Gemini vazou na resposta');
    assert.strictEqual(bruto.includes('gsk_secretissimo_1234'), false, 'a chave da Groq vazou na resposta');

    const dados = JSON.parse(bruto);
    assert.strictEqual(dados.gemini.configurado, true);
    assert.match(dados.gemini.chave_mascarada, /^AIza••••9Q7x$/);
    assert.strictEqual(dados.pronto, true);
  } finally {
    await ctx.encerrar();
  }
});

test('sem GEMINI_MODEL no .env o estado avisa que o modelo é o padrão', async () => {
  const ctx = await montar(baseDados(), { GEMINI_API_KEY: 'x'.repeat(20), GEMINI_MODEL: null });
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/config/estado')).json();
    assert.strictEqual(dados.gemini.modelo_do_env, false);
    assert.strictEqual(dados.gemini.modelo, dados.gemini.modelo_padrao);
  } finally {
    await ctx.encerrar();
  }
});

test('GEMINI_MODEL no .env manda no modelo usado', async () => {
  const ctx = await montar(baseDados(), { GEMINI_API_KEY: 'x'.repeat(20), GEMINI_MODEL: 'gemini-inventado-9' });
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/config/estado')).json();
    assert.strictEqual(dados.gemini.modelo, 'gemini-inventado-9');
    assert.strictEqual(dados.gemini.modelo_do_env, true);
  } finally {
    await ctx.encerrar();
  }
});

test('o teste de conexão não chama provedor sem chave e diz o porquê', async () => {
  const ctx = await montar(baseDados(), { GEMINI_API_KEY: null, GROQ_API_KEY: null });
  try {
    const resp = await chamar(ctx.porta, '/api/ia/config/testar', { method: 'POST' });
    assert.strictEqual(resp.status, 200);
    const dados = await resp.json();

    assert.strictEqual(dados.gemini.ok, false);
    assert.match(dados.gemini.motivo, /GEMINI_API_KEY/);
    assert.strictEqual(dados.groq.ok, false);
    assert.match(dados.groq.motivo, /GROQ_API_KEY/);
    assert.strictEqual(dados.pronto, false);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Camada de provedores (unidade, sem rede)
// ---------------------------------------------------------------------------

test('mascarar não devolve a chave nem quando ela é curta', () => {
  const { mascarar } = require('./iaProvedores');
  assert.strictEqual(mascarar('abc'), '••••');
  assert.strictEqual(mascarar('12345678'), '••••');
  assert.strictEqual(mascarar('123456789'), '1234••••6789');
  assert.strictEqual(mascarar(''), null);
});

test('a falha do provedor vira uma mensagem que diz o que fazer', () => {
  const { traduzirFalha } = require('./iaProvedores');

  // "Erro 401" não diz a ninguém o que fazer; cada status leva a uma ação
  // diferente e a mensagem precisa refletir isso.
  assert.match(traduzirFalha('Gemini', 401, {}).message, /chave recusada/i);
  assert.match(traduzirFalha('Gemini', 403, {}).message, /chave recusada/i);
  assert.match(traduzirFalha('Groq', 404, {}).message, /modelo não encontrado/i);
  assert.match(traduzirFalha('Groq', 429, {}).message, /limite de uso/i);
  assert.match(traduzirFalha('Gemini', 500, {}).message, /erro/i);
  assert.strictEqual(traduzirFalha('Gemini', 500, {}).status, 502);
});

test('a mensagem de erro do provedor não vaza a chave que foi enviada', () => {
  const { traduzirFalha } = require('./iaProvedores');
  // Alguns provedores ecoam a URL da requisição na mensagem de erro — e a
  // chave do Gemini viaja na query string.
  const corpo = { error: { message: 'API key not valid: AIzaSyCHAVE-REAL-AQUI-123' } };
  const e = traduzirFalha('Gemini', 401, corpo);
  assert.strictEqual(e.message.includes('AIzaSyCHAVE-REAL-AQUI-123'), false);
});

test('o catálogo de destinos aponta para a permissão do módulo alvo', () => {
  const { DESTINOS } = require('./iaController');

  // Aplicar pela IA não pode ser um atalho para furar a permissão do outro
  // módulo: cada destino declara também a permissão de lá.
  for (const d of DESTINOS) {
    assert.ok(d.permissao.startsWith('ia.apply.'), `destino ${d.id} sem permissão de aplicação`);
    assert.ok(d.moduloAlvo && d.moduloAlvo.includes('.'), `destino ${d.id} sem permissão do módulo alvo`);
    assert.strictEqual(d.moduloAlvo.startsWith('ia.'), false, `destino ${d.id} aponta para a própria IA`);
  }
});

test('toda ação do destino existe no catálogo de permissões', () => {
  const { DESTINOS } = require('./iaController');
  const { resolvePermissionKey } = require('./permissionsCatalog');

  // O catálogo é gerado do modal de permissões. Se um destino citar uma chave
  // que não foi gerada, `exigirPermissao` nega para todo mundo em silêncio.
  for (const d of DESTINOS) {
    assert.ok(resolvePermissionKey(d.permissao), `${d.permissao} não existe no catálogo`);
    assert.ok(resolvePermissionKey(d.moduloAlvo), `${d.moduloAlvo} não existe no catálogo`);
  }
});


// ===========================================================================
// ETAPA 2 — envio e leitura
//
// O provedor de leitura é substituído por um servidor local (via
// GEMINI_API_BASE) em vez de um `fetch` global sequestrado: o app usa `fetch`
// para falar com a própria API, e trocar o global derrubaria as duas coisas —
// um teste "verde" que só provaria que nada saiu do lugar.
// ===========================================================================

const ExcelJS = require('exceljs');

/** Servidor que responde como o generateContent do Gemini. */
function criarGemini(responder) {
  const chamadas = [];
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const body = corpo ? JSON.parse(corpo) : null;
      chamadas.push({ caminho: url.pathname, chave: url.searchParams.get('key'), body });
      const r = responder ? responder({ chamadas, body }) : null;
      const { status = 200, payload = respostaGemini('TEXTO LIDO') } = r || {};
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  return { servidor, chamadas };
}

const respostaGemini = (texto, finishReason = 'STOP') => ({
  candidates: [{ content: { parts: [{ text: texto }] }, finishReason }]
});

/** Sobe o app com um duplo do Gemini apontado por GEMINI_API_BASE. */
async function montarComGemini(dados, env = {}, responderGemini) {
  const gemini = criarGemini(responderGemini);
  await new Promise(r => gemini.servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${gemini.servidor.address().port}/v1beta`;

  const ctx = await montar(dados, {
    GEMINI_API_BASE: base,
    GEMINI_API_KEY: 'chave-de-teste',
    GEMINI_MODEL: 'gemini-de-teste',
    ...env
  });

  const encerrarOriginal = ctx.encerrar;
  ctx.gemini = gemini;
  ctx.encerrar = async () => {
    await encerrarOriginal();
    await new Promise(r => gemini.servidor.close(r));
  };
  return ctx;
}

/** Envia um multipart de verdade — o mesmo caminho que o navegador usa. */
async function enviarArquivos(porta, { destino, titulo, arquivos = [], usuario = 1 }) {
  const form = new FormData();
  if (destino !== undefined) form.append('destino', destino);
  if (titulo !== undefined) form.append('titulo', titulo);
  for (const a of arquivos) {
    form.append('arquivos', new Blob([a.conteudo], { type: a.mime || 'application/octet-stream' }), a.nome);
  }
  return fetch(`http://127.0.0.1:${porta}/api/ia`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenDe(usuario)}` },
    body: form
  });
}

async function planilhaXlsx(linhas, nomeAba = 'Dados') {
  const wb = new ExcelJS.Workbook();
  const aba = wb.addWorksheet(nomeAba);
  for (const l of linhas) aba.addRow(l);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const CSV = Buffer.from('nome;quantidade;preco\nMDF 15mm;40;189,90\nFita 22mm;500;1,35\n', 'utf8');
const PDF_FALSO = Buffer.from('%PDF-1.4 conteudo qualquer', 'utf8');

// ---------------------------------------------------------------------------
// Planilha: lida na máquina, sem passar pela IA
// ---------------------------------------------------------------------------

test('planilha vira texto sem chamar o provedor de IA', async () => {
  const ctx = await montarComGemini(baseDados());
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      arquivos: [{ nome: 'lista.csv', conteudo: CSV, mime: 'text/csv' }]
    });
    assert.strictEqual(resp.status, 201);
    const corpo = await resp.json();
    assert.strictEqual(corpo.status, 'rascunho');
    assert.strictEqual(corpo.arquivos_lidos, 1);

    const arquivo = ctx.tabelas.ia_extracao_arquivos.find(a => a.extracao_id === corpo.id);
    assert.strictEqual(arquivo.origem, 'planilha');
    assert.match(arquivo.texto, /MDF 15mm \| 40 \| 189,90/);

    // O ponto do desenho: planilha é dado exato; mandá-la para um modelo de
    // visão só acrescentaria erro de leitura — e custaria crédito.
    assert.strictEqual(ctx.gemini.chamadas.length, 0, 'a planilha foi parar na IA');

    // E sem chamada ao Gemini não há modelo de OCR a registrar.
    const extracao = ctx.tabelas.ia_extracoes.find(e => e.id === corpo.id);
    assert.strictEqual(extracao.modelo_ocr, null);
  } finally {
    await ctx.encerrar();
  }
});

test('o xlsx é lido com o resultado das fórmulas, não com a expressão', async () => {
  const wb = new ExcelJS.Workbook();
  const aba = wb.addWorksheet('Chapas');
  aba.addRow(['ITEM', 'QTD', 'PRECO', 'TOTAL']);
  const linha = aba.addRow(['MDF 15mm', 40, 189.9, null]);
  linha.getCell(4).value = { formula: 'B2*C2', result: 7596 };
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  const ctx = await montarComGemini(baseDados());
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      arquivos: [{ nome: 'chapas.xlsx', conteudo: buffer }]
    });
    const corpo = await resp.json();
    const arquivo = ctx.tabelas.ia_extracao_arquivos.find(a => a.extracao_id === corpo.id);

    assert.match(arquivo.texto, /7596/);
    // Sem tratamento do tipo rico do exceljs, a célula viraria isto:
    assert.strictEqual(arquivo.texto.includes('[object Object]'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('planilha em branco não vira leitura válida', async () => {
  const buffer = await planilhaXlsx([]);
  const ctx = await montarComGemini(baseDados());
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      arquivos: [{ nome: 'vazia.xlsx', conteudo: buffer }]
    });
    const corpo = await resp.json();
    assert.strictEqual(corpo.status, 'erro');
    assert.match(corpo.erro, /nenhuma linha preenchida/i);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// PDF e imagem: passam pelo Gemini
// ---------------------------------------------------------------------------

test('o PDF vai para o Gemini e o texto lido é gravado', async () => {
  const ctx = await montarComGemini(baseDados(), {}, () => ({
    payload: respostaGemini('PEDIDO 8842\nMDF 15mm | 40 | 189,90')
  }));
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'orcamentos',
      arquivos: [{ nome: 'pedido.pdf', conteudo: PDF_FALSO, mime: 'application/pdf' }]
    });
    assert.strictEqual(resp.status, 201);
    const corpo = await resp.json();

    assert.strictEqual(ctx.gemini.chamadas.length, 1);
    const chamada = ctx.gemini.chamadas[0];
    assert.match(chamada.caminho, /gemini-de-teste:generateContent$/);
    assert.strictEqual(chamada.chave, 'chave-de-teste');

    // O arquivo viaja como inline_data em base64, com o mime que o backend
    // decidiu pela extensão — não o que o navegador declarou.
    const parte = chamada.body.contents[0].parts[0];
    assert.strictEqual(parte.inline_data.mime_type, 'application/pdf');
    assert.strictEqual(Buffer.from(parte.inline_data.data, 'base64').toString(), PDF_FALSO.toString());

    // Transcrição precisa ser determinística: variação aqui é erro de leitura.
    assert.strictEqual(chamada.body.generationConfig.temperature, 0);

    const arquivo = ctx.tabelas.ia_extracao_arquivos.find(a => a.extracao_id === corpo.id);
    assert.strictEqual(arquivo.origem, 'pdf');
    assert.match(arquivo.texto, /PEDIDO 8842/);

    // O modelo usado fica gravado: quando uma leitura antiga sair torta, é
    // isto que explica o porquê.
    const extracao = ctx.tabelas.ia_extracoes.find(e => e.id === corpo.id);
    assert.strictEqual(extracao.modelo_ocr, 'gemini-de-teste');
  } finally {
    await ctx.encerrar();
  }
});

test('o mime vai pela EXTENSÃO, não pelo que o navegador declarou', async () => {
  // O mesmo .png chega como image/png, application/octet-stream ou vazio
  // dependendo do sistema do usuário. Repassar isso ao Gemini daria 400.
  const ctx = await montarComGemini(baseDados());
  try {
    await enviarArquivos(ctx.porta, {
      destino: 'prospeccoes',
      arquivos: [{ nome: 'cartao.PNG', conteudo: Buffer.from('imagem'), mime: 'application/octet-stream' }]
    });
    const parte = ctx.gemini.chamadas[0].body.contents[0].parts[0];
    assert.strictEqual(parte.inline_data.mime_type, 'image/png');
  } finally {
    await ctx.encerrar();
  }
});

test('PDF sem GEMINI_API_KEY é recusado ANTES de criar a leitura', async () => {
  const ctx = await montarComGemini(baseDados(), { GEMINI_API_KEY: null });
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'orcamentos',
      arquivos: [{ nome: 'pedido.pdf', conteudo: PDF_FALSO, mime: 'application/pdf' }]
    });
    assert.strictEqual(resp.status, 400);
    assert.match((await resp.json()).error, /GEMINI_API_KEY/);

    // Nada foi criado: uma leitura fadada a falhar não pode sujar a grade.
    assert.strictEqual(ctx.tabelas.ia_extracoes.length, 3);
  } finally {
    await ctx.encerrar();
  }
});

test('planilha continua funcionando sem GEMINI_API_KEY', async () => {
  const ctx = await montarComGemini(baseDados(), { GEMINI_API_KEY: null });
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      arquivos: [{ nome: 'lista.csv', conteudo: CSV, mime: 'text/csv' }]
    });
    assert.strictEqual(resp.status, 201);
    assert.strictEqual((await resp.json()).status, 'rascunho');
  } finally {
    await ctx.encerrar();
  }
});

test('recusa do Gemini por política vira mensagem, não texto vazio', async () => {
  // A recusa vem com HTTP 200 e nenhum candidato. Sem a checagem, o arquivo
  // terminaria em branco e ninguém saberia por quê.
  const ctx = await montarComGemini(baseDados(), {}, () => ({
    payload: { promptFeedback: { blockReason: 'SAFETY' } }
  }));
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'orcamentos',
      arquivos: [{ nome: 'doc.pdf', conteudo: PDF_FALSO, mime: 'application/pdf' }]
    });
    const corpo = await resp.json();
    assert.strictEqual(corpo.status, 'erro');
    assert.match(corpo.erro, /recusou|SAFETY/i);

    const arquivo = ctx.tabelas.ia_extracao_arquivos.find(a => a.extracao_id === corpo.id);
    assert.ok(arquivo.erro, 'o arquivo ficou sem explicação');
  } finally {
    await ctx.encerrar();
  }
});

test('PDF escaneado sem texto explica o que fazer', async () => {
  const ctx = await montarComGemini(baseDados(), {}, () => ({
    payload: respostaGemini('SEM TEXTO')
  }));
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'orcamentos',
      arquivos: [{ nome: 'escaneado.pdf', conteudo: PDF_FALSO, mime: 'application/pdf' }]
    });
    const corpo = await resp.json();
    assert.strictEqual(corpo.status, 'erro');
    assert.match(corpo.erro, /digitaliza/i);
  } finally {
    await ctx.encerrar();
  }
});

test('chave recusada pelo Gemini vira mensagem acionável', async () => {
  const ctx = await montarComGemini(baseDados(), {}, () => ({
    status: 401, payload: { error: { message: 'API key not valid' } }
  }));
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'orcamentos',
      arquivos: [{ nome: 'doc.pdf', conteudo: PDF_FALSO, mime: 'application/pdf' }]
    });
    const corpo = await resp.json();
    assert.match(corpo.erro, /chave recusada/i);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Lote com problema no meio
// ---------------------------------------------------------------------------

test('um arquivo ruim no meio não derruba o que já foi lido', async () => {
  let chamada = 0;
  const ctx = await montarComGemini(baseDados(), {}, () => {
    chamada += 1;
    // O segundo PDF falha; o primeiro e a planilha precisam sobreviver.
    return chamada === 1
      ? { status: 500, payload: { error: { message: 'boom' } } }
      : { payload: respostaGemini('LIDO') };
  });
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'orcamentos',
      arquivos: [
        { nome: 'a.pdf', conteudo: PDF_FALSO, mime: 'application/pdf' },
        { nome: 'b.pdf', conteudo: PDF_FALSO, mime: 'application/pdf' },
        { nome: 'c.csv', conteudo: CSV, mime: 'text/csv' }
      ]
    });
    assert.strictEqual(resp.status, 201);
    const corpo = await resp.json();

    // Perder o lote inteiro por um arquivo obrigaria a reenviar tudo — sem
    // saber qual dos três era o problema.
    assert.strictEqual(corpo.status, 'rascunho');
    assert.strictEqual(corpo.arquivos_lidos, 2);
    assert.strictEqual(corpo.arquivos_com_falha, 1);

    const arquivos = ctx.tabelas.ia_extracao_arquivos.filter(a => a.extracao_id === corpo.id);
    assert.strictEqual(arquivos.length, 3, 'o arquivo que falhou também precisa ficar registrado');
    assert.strictEqual(arquivos.filter(a => a.texto).length, 2);
    assert.ok(arquivos.find(a => a.erro), 'a falha ficou sem explicação');
  } finally {
    await ctx.encerrar();
  }
});

test('quando NADA é lido, a leitura fica marcada como erro', async () => {
  const ctx = await montarComGemini(baseDados(), {}, () => ({
    status: 500, payload: { error: { message: 'boom' } }
  }));
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'orcamentos',
      arquivos: [{ nome: 'a.pdf', conteudo: PDF_FALSO, mime: 'application/pdf' }]
    });
    const corpo = await resp.json();
    assert.strictEqual(corpo.status, 'erro');

    const extracao = ctx.tabelas.ia_extracoes.find(e => e.id === corpo.id);
    assert.strictEqual(extracao.status, 'erro');
    assert.ok(extracao.erro);
  } finally {
    await ctx.encerrar();
  }
});

test('a leitura nunca fica pendurada em "lendo"', async () => {
  // Grava a extração mas derruba o INSERT dos arquivos: é o caso em que a
  // linha ficaria com o ponto piscando na grade para sempre.
  const gemini = criarGemini();
  await new Promise(r => gemini.servidor.listen(0, '127.0.0.1', r));
  const ctx = await montar(baseDados(), {
    GEMINI_API_BASE: `http://127.0.0.1:${gemini.servidor.address().port}/v1beta`,
    GEMINI_API_KEY: 'x'
  }, {
    falharEm: ({ metodo, tabela }) => metodo === 'POST' && tabela === 'ia_extracao_arquivos'
  });
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      arquivos: [{ nome: 'lista.csv', conteudo: CSV, mime: 'text/csv' }]
    });
    assert.ok(resp.status >= 400);

    const criada = ctx.tabelas.ia_extracoes.find(e => e.id > 3);
    assert.ok(criada, 'a extração não chegou a ser criada');
    assert.strictEqual(criada.status, 'erro');
    assert.ok(criada.erro, 'ficou sem explicação do que houve');
  } finally {
    await ctx.encerrar();
    await new Promise(r => gemini.servidor.close(r));
  }
});

// ---------------------------------------------------------------------------
// Validação do envio
// ---------------------------------------------------------------------------

test('sem destino, não lê nada', async () => {
  const ctx = await montarComGemini(baseDados());
  try {
    const resp = await enviarArquivos(ctx.porta, {
      arquivos: [{ nome: 'lista.csv', conteudo: CSV, mime: 'text/csv' }]
    });
    assert.strictEqual(resp.status, 400);
    assert.strictEqual(ctx.tabelas.ia_extracoes.length, 3);
  } finally {
    await ctx.encerrar();
  }
});

test('destino inventado é recusado', async () => {
  const ctx = await montarComGemini(baseDados());
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'tabela_secreta',
      arquivos: [{ nome: 'lista.csv', conteudo: CSV, mime: 'text/csv' }]
    });
    assert.strictEqual(resp.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('sem arquivo, não lê nada', async () => {
  const ctx = await montarComGemini(baseDados());
  try {
    const resp = await enviarArquivos(ctx.porta, { destino: 'materia_prima' });
    assert.strictEqual(resp.status, 400);
    assert.match((await resp.json()).error, /pelo menos um arquivo/i);
  } finally {
    await ctx.encerrar();
  }
});

test('tipo não aceito é recusado antes de criar a leitura', async () => {
  const ctx = await montarComGemini(baseDados());
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      arquivos: [
        { nome: 'lista.csv', conteudo: CSV, mime: 'text/csv' },
        { nome: 'script.exe', conteudo: Buffer.from('MZ'), mime: 'application/octet-stream' }
      ]
    });
    assert.strictEqual(resp.status, 400);
    // Recusa o LOTE, não só o arquivo: metade da leitura é pior do que
    // nenhuma, porque parece completa.
    assert.strictEqual(ctx.tabelas.ia_extracoes.length, 3);
  } finally {
    await ctx.encerrar();
  }
});

test('o arquivo ruim é pego mesmo vindo DEPOIS de um PDF', async () => {
  // A checagem de tipo tem de varrer o lote inteiro. A conta de "precisa do
  // Gemini?" usa `.some()`, que para no primeiro PDF — sozinha, ela deixaria
  // passar tudo que viesse depois dele.
  const ctx = await montarComGemini(baseDados());
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'orcamentos',
      arquivos: [
        { nome: 'bom.pdf', conteudo: PDF_FALSO, mime: 'application/pdf' },
        { nome: 'script.exe', conteudo: Buffer.from('MZ'), mime: 'application/octet-stream' }
      ]
    });
    assert.strictEqual(resp.status, 400);
    assert.match((await resp.json()).error, /tipo não aceito/i);
    assert.strictEqual(ctx.tabelas.ia_extracoes.length, 3);
    assert.strictEqual(ctx.gemini.chamadas.length, 0, 'gastou crédito num lote que seria recusado');
  } finally {
    await ctx.encerrar();
  }
});

test('.xls antigo diz o que fazer em vez de dar erro genérico', async () => {
  const ctx = await montarComGemini(baseDados());
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      arquivos: [{ nome: 'antiga.xls', conteudo: Buffer.from('BIFF') }]
    });
    assert.strictEqual(resp.status, 400);
    assert.match((await resp.json()).error, /salve como \.xlsx/i);
  } finally {
    await ctx.encerrar();
  }
});

test('sem título, o nome do arquivo vira o título', async () => {
  const ctx = await montarComGemini(baseDados());
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      arquivos: [{ nome: 'chapas-bralux.csv', conteudo: CSV, mime: 'text/csv' }]
    });
    assert.strictEqual((await resp.json()).titulo, 'chapas-bralux.csv');
  } finally {
    await ctx.encerrar();
  }
});

test('com vários arquivos e sem título, o título diz quantos são', async () => {
  const ctx = await montarComGemini(baseDados());
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      arquivos: [
        { nome: 'a.csv', conteudo: CSV, mime: 'text/csv' },
        { nome: 'b.csv', conteudo: CSV, mime: 'text/csv' }
      ]
    });
    assert.strictEqual((await resp.json()).titulo, '2 arquivos');
  } finally {
    await ctx.encerrar();
  }
});

test('arquivo grande demais é recusado em português', async () => {
  // O erro do multer nasce no middleware, antes do handler: sem tratador, o
  // usuário receberia "File too large" ou um 500 mudo.
  const ctx = await montarComGemini(baseDados(), { IA_MAX_ARQUIVO_MB: '1' });
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      arquivos: [{ nome: 'grande.csv', conteudo: Buffer.alloc(2 * 1024 * 1024, 'a'), mime: 'text/csv' }]
    });
    assert.strictEqual(resp.status, 400);
    const erro = (await resp.json()).error;
    assert.match(erro, /limite é 1 MB/);
    assert.strictEqual(/too large/i.test(erro), false, 'a mensagem saiu em inglês');
  } finally {
    await ctx.encerrar();
  }
});

test('o texto lido é cortado no limite, e o corte é anunciado', async () => {
  const ctx = await montarComGemini(baseDados(), { IA_TEXTO_MAX_CHARS: '200' }, () => ({
    payload: respostaGemini('x'.repeat(5000))
  }));
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'orcamentos',
      arquivos: [{ nome: 'longo.pdf', conteudo: PDF_FALSO, mime: 'application/pdf' }]
    });
    const corpo = await resp.json();
    const arquivo = ctx.tabelas.ia_extracao_arquivos.find(a => a.extracao_id === corpo.id);

    // Sem o corte, este texto iria inteiro para a API externa — que recusa
    // corpo grande — e a gravação falharia sem explicação.
    assert.ok(arquivo.texto.length <= 200, `texto ficou com ${arquivo.texto.length}`);
    assert.match(arquivo.texto, /cortado/i);
    // E o aviso precisa chegar à tela: texto cortado pela metade faz item
    // sumir sem ninguém notar.
    assert.match(arquivo.erro, /cortad/i);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Permissões
// ---------------------------------------------------------------------------

test('sem ia.extract o usuário comum não dispara a leitura', async () => {
  // Enviar arquivo e gastar crédito da conta são decisões diferentes.
  const ctx = await montarComGemini(permitir(baseDados(), ['acao_view', 'acao_upload']));
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      usuario: 2,
      arquivos: [{ nome: 'lista.csv', conteudo: CSV, mime: 'text/csv' }]
    });
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(ctx.tabelas.ia_extracoes.length, 3);
  } finally {
    await ctx.encerrar();
  }
});

test('com ia.upload e ia.extract o usuário comum lê', async () => {
  const ctx = await montarComGemini(permitir(baseDados(), ['acao_view', 'acao_upload', 'acao_extract']));
  try {
    const resp = await enviarArquivos(ctx.porta, {
      destino: 'materia_prima',
      usuario: 2,
      arquivos: [{ nome: 'lista.csv', conteudo: CSV, mime: 'text/csv' }]
    });
    assert.strictEqual(resp.status, 201);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Opções da tela de nova leitura
// ---------------------------------------------------------------------------

test('as opções marcam o destino que o usuário não pode aplicar', async () => {
  // Só a permissão da IA, sem a do módulo de destino: ler para lá seria
  // gastar crédito num dado que ele nunca vai conseguir gravar.
  const ctx = await montarComGemini(permitir(baseDados(), ['acao_view', 'acao_upload', 'acao_apply_mp']));
  try {
    const resp = await chamar(ctx.porta, '/api/ia/opcoes', { usuario: 2 });
    assert.strictEqual(resp.status, 200);
    const dados = await resp.json();

    const porId = new Map(dados.destinos.map(d => [d.id, d]));
    // `ia.apply.mp` sozinho não basta: falta `mp.create` no perfil.
    assert.strictEqual(porId.get('materia_prima').pode_aplicar, false);
    assert.strictEqual(porId.get('orcamentos').pode_aplicar, false);

    // Mesmo travado, o destino continua NA LISTA — some a ação, não a
    // informação de que ela existe.
    assert.strictEqual(dados.destinos.length, 5);
  } finally {
    await ctx.encerrar();
  }
});

test('para o Sup Admin todo destino está liberado', async () => {
  const ctx = await montarComGemini(baseDados());
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/opcoes')).json();
    assert.strictEqual(dados.destinos.every(d => d.pode_aplicar), true);
  } finally {
    await ctx.encerrar();
  }
});

test('as opções dizem os limites e as extensões aceitas', async () => {
  const ctx = await montarComGemini(baseDados(), { IA_MAX_ARQUIVO_MB: '7', IA_MAX_ARQUIVOS: '3' });
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/opcoes')).json();
    assert.strictEqual(dados.limites.arquivo_mb, 7);
    assert.strictEqual(dados.limites.arquivos, 3);
    assert.ok(dados.extensoes.includes('.xlsx'));
    assert.ok(dados.extensoes.includes('.pdf'));
    assert.strictEqual(dados.extensoes.includes('.xls'), false);
    assert.strictEqual(dados.provedores.gemini, true);
  } finally {
    await ctx.encerrar();
  }
});

test('as opções não vazam a chave', async () => {
  const ctx = await montarComGemini(baseDados(), { GEMINI_API_KEY: 'AIza-chave-secreta-do-henrique' });
  try {
    const bruto = await (await chamar(ctx.porta, '/api/ia/opcoes')).text();
    assert.strictEqual(bruto.includes('AIza-chave-secreta-do-henrique'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('sem ia.upload não dá para abrir a nova leitura', async () => {
  const ctx = await montarComGemini(permitir(baseDados(), ['acao_view']));
  try {
    assert.strictEqual((await chamar(ctx.porta, '/api/ia/opcoes', { usuario: 2 })).status, 403);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Leitura de arquivo (unidade)
// ---------------------------------------------------------------------------

test('o CSV é separado por ; como o Excel em português exporta', () => {
  const { lerCsv, detectarSeparador } = require('./iaLeitura');

  // Assumir vírgula juntaria a planilha inteira numa coluna só — e o erro
  // passaria despercebido, porque o texto "existe".
  assert.strictEqual(detectarSeparador('nome;qtd;preco'), ';');
  assert.deepStrictEqual(lerCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(lerCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('o CSV respeita aspas, inclusive com o separador dentro', () => {
  const { lerCsv } = require('./iaLeitura');
  assert.deepStrictEqual(
    lerCsv('nome;preco\n"Cola PVA; 1kg";24,80'),
    [['nome', 'preco'], ['Cola PVA; 1kg', '24,80']]
  );
  assert.deepStrictEqual(lerCsv('a\n"aspas ""dentro"""'), [['a'], ['aspas "dentro"']]);
});

test('o BOM do Excel não gruda na primeira célula', () => {
  const { lerCsv } = require('./iaLeitura');
  // O Excel salva CSV com BOM; sem remoção, a primeira coluna vira "﻿nome"
  // e o cabeçalho deixa de casar com o que o modelo procura.
  const linhas = lerCsv('﻿nome;qtd\nMDF;40');
  assert.strictEqual(linhas[0][0], 'nome');
});

test('linha em branco no meio da planilha é descartada', () => {
  const { lerCsv } = require('./iaLeitura');
  assert.deepStrictEqual(lerCsv('a;b\n\n1;2\n;\n3;4'), [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('valorDaCelula não deixa nada virar [object Object]', () => {
  const { valorDaCelula } = require('./iaLeitura');
  assert.strictEqual(valorDaCelula({ formula: 'A1*B1', result: 7596 }), '7596');
  assert.strictEqual(valorDaCelula({ richText: [{ text: 'MDF ' }, { text: '15mm' }] }), 'MDF 15mm');
  assert.strictEqual(valorDaCelula({ text: 'link', hyperlink: 'http://x' }), 'link');
  assert.strictEqual(valorDaCelula({ error: '#N/D' }), '#N/D');
  assert.strictEqual(valorDaCelula(new Date(Date.UTC(2026, 8, 15))), '15/09/2026');
  assert.strictEqual(valorDaCelula(null), '');
});

test('limitarTexto avisa dentro do próprio texto quando corta', () => {
  const anterior = process.env.IA_TEXTO_MAX_CHARS;
  process.env.IA_TEXTO_MAX_CHARS = '120';
  delete require.cache[require.resolve('./iaProvedores')];
  delete require.cache[require.resolve('./iaLeitura')];
  try {
    const { limitarTexto } = require('./iaLeitura');
    const r = limitarTexto('y'.repeat(500));
    assert.strictEqual(r.cortado, true);
    assert.ok(r.texto.length <= 120);
    // O aviso vai DENTRO do texto: quem revisar precisa saber que faltam
    // itens, e não concluir que o documento acabou ali.
    assert.match(r.texto, /cortado/i);

    assert.strictEqual(limitarTexto('curto').cortado, false);
    assert.strictEqual(limitarTexto('curto').texto, 'curto');
  } finally {
    if (anterior === undefined) delete process.env.IA_TEXTO_MAX_CHARS;
    else process.env.IA_TEXTO_MAX_CHARS = anterior;
    delete require.cache[require.resolve('./iaProvedores')];
    delete require.cache[require.resolve('./iaLeitura')];
  }
});

test('emParalelo preserva a ordem e respeita o teto de tarefas em voo', async () => {
  const { emParalelo } = require('./iaController');
  let emVoo = 0;
  let pico = 0;

  const r = await emParalelo([1, 2, 3, 4, 5, 6, 7], 3, async n => {
    emVoo += 1;
    pico = Math.max(pico, emVoo);
    await new Promise(res => setTimeout(res, 5));
    emVoo -= 1;
    return n * 10;
  });

  // A ordem importa: os arquivos são gravados pareados com o que foi lido.
  assert.deepStrictEqual(r, [10, 20, 30, 40, 50, 60, 70]);
  // Todos de uma vez bateria no limite de uso do provedor, que responde 429 e
  // derruba justamente os arquivos do fim da fila.
  assert.ok(pico <= 3, `chegou a ${pico} em voo`);
});
