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
    'criado_em', 'atualizado_em', 'aplicado_em',
    // sql/ia_configuracao.sql
    'tokens_entrada', 'tokens_saida',
    // sql/ia_consumo_por_provedor.sql
    'tokens_ocr_entrada', 'tokens_ocr_saida', 'tokens_llm_entrada', 'tokens_llm_saida'
  ],
  ia_configuracao: ['id', 'chave', 'valor', 'atualizado_em', 'atualizado_por'],
  etapas_producao: ['id', 'nome', 'ordem'],
  ia_extracao_arquivos: [
    'id', 'extracao_id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes',
    'origem', 'paginas', 'texto', 'erro', 'criado_em',
    // sql/ia_texto_ajustado.sql
    'texto_ajustado'
  ],
  ia_extracao_itens: [
    'id', 'extracao_id', 'linha', 'dados', 'acao', 'alvo_tabela', 'alvo_id',
    'confianca', 'status', 'mensagem', 'criado_em', 'aplicado_em'
  ],
  materia_prima: ['id', 'nome', 'quantidade', 'preco_unitario', 'categoria', 'unidade',
    'infinito', 'processo', 'descricao', 'data_estoque', 'data_preco'],
  materia_prima_movimentacoes: ['id', 'insumo_id', 'tipo', 'quantidade_alterada',
    'quantidade_anterior', 'quantidade_atual', 'preco_atual', 'usuario_id', 'pedido_id',
    'realocacao_id', 'estoque_movimento_id', 'observacao', 'criado_em'],
  categoria: ['id', 'nome_categoria'],
  unidades: ['id', 'tipo'],
  // `atualizarPreco` repassa o custo aos produtos que usam o insumo. Sem estas
  // duas no duplo, a atualização de preço bate num 404 que não existe em
  // produção — e o teste passaria a medir o buraco do harness.
  produtos_insumos: ['id', 'produto_id', 'insumo_id', 'quantidade'],
  // O preço PRATICADO mora aqui, não em `produtos`. Sem esta tabela no duplo,
  // o item do orçamento chegaria sempre sem valor e o teste não veria.
  tabela_fixa: ['id', 'id_prod', 'cod_prod', 'vlr_prod'],
  // `atualizarProdutosComInsumo` grava `preco_base`/`preco_venda` e LÊ os
  // percentuais. Sem essas colunas no duplo, o recálculo roda mas não deixa
  // rastro — e o teste mediria o buraco do harness.
  produtos: ['id', 'codigo', 'nome', 'preco_custo', 'preco_base', 'preco_venda', 'margem', 'data',
    'pct_fabricacao', 'pct_acabamento', 'pct_montagem', 'pct_embalagem',
    'pct_markup', 'pct_comissao', 'pct_imposto'],
  clientes: ['id', 'nome_fantasia', 'razao_social', 'cnpj', 'inscricao_estadual', 'site',
    'status_cliente', 'dono_cliente', 'origem_captacao', 'anotacoes',
    'reg_logradouro', 'reg_numero', 'reg_complemento', 'reg_bairro', 'reg_cidade', 'reg_uf', 'reg_pais', 'reg_cep',
    'cob_logradouro', 'cob_numero', 'cob_complemento', 'cob_bairro', 'cob_cidade', 'cob_uf', 'cob_pais', 'cob_cep',
    'ent_logradouro', 'ent_numero', 'ent_complemento', 'ent_bairro', 'ent_cidade', 'ent_uf', 'ent_pais', 'ent_cep'],
  contatos_cliente: ['id', 'id_cliente', 'nome', 'cargo', 'email', 'telefone_fixo', 'telefone_celular'],
  orcamentos: ['id', 'numero', 'cliente_id', 'contato_id', 'prospeccao_id', 'prospeccao_contato_id',
    'data_emissao', 'situacao', 'parcelas', 'tipo_parcela', 'forma_pagamento', 'transportadora',
    'desconto_pagamento', 'desconto_especial', 'desconto_total', 'valor_final', 'observacoes',
    'validade', 'prazo', 'dono', 'data_aprovacao'],
  orcamentos_itens: ['id', 'orcamento_id', 'produto_id', 'codigo', 'nome', 'ncm', 'quantidade',
    'valor_unitario', 'valor_unitario_desc', 'desconto_total', 'valor_desc', 'valor_total'],
  orcamento_parcelas: ['id', 'orcamento_id', 'numero_parcela', 'valor', 'data_vencimento'],
  prospeccoes: ['id', 'nome_fantasia', 'razao_social', 'cnpj', 'inscricao_estadual', 'site', 'segmento',
    'origem', 'etapa', 'valor_estimado', 'probabilidade', 'responsavel_id',
    'end_logradouro', 'end_numero', 'end_complemento', 'end_bairro', 'end_cidade', 'end_uf', 'end_pais', 'end_cep',
    'status', 'cliente_id', 'anotacoes', 'criado_por', 'criado_em', 'atualizado_em'],
  prospeccao_contatos: ['id', 'prospeccao_id', 'nome', 'cargo', 'email', 'telefone_fixo',
    'telefone_celular', 'decisor', 'principal', 'observacao'],
  prospeccao_historico: ['id', 'prospeccao_id', 'tipo', 'acao', 'entidade', 'campo',
    'valor_anterior', 'valor_novo', 'detalhe', 'observacao', 'usuario_id', 'criado_em'],
  prospeccao_etapas_historico: ['id', 'prospeccao_id', 'etapa_anterior', 'etapa_nova', 'observacao', 'usuario_id'],
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
  // `db` e `materiaPrima` leem API_BASE_URL no carregamento do módulo: sem
  // limpar o cache deles, a aplicação de um teste falaria com o servidor do
  // teste anterior, já fechado.
  './db', './materiaPrima', './prospeccoesController', './clientesController',
  './orcamentosController',
  './iaProvedores', './iaLeitura', './iaEsquemas', './iaEstruturacao',
  './iaReconciliacao', './iaAplicacao', './iaController'
];

async function montar(dados, env = {}, opcoes = {}) {
  const upstream = criarUpstream(dados, opcoes);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;

  const envAnterior = {};
  for (const [chave, valor] of Object.entries(env)) {
    envAnterior[chave] = process.env[chave];
    // Vazio, não apagado: `backend/db.js` chama dotenv ao ser carregado, e
    // dotenv REPÕE toda chave que não estiver em process.env — apagar a
    // variável faria o .env real do desenvolvedor vazar para dentro do teste.
    process.env[chave] = valor === null ? '' : valor;
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
    // Vazia: sem linha gravada, tudo continua valendo pelo .env — que é
    // exatamente o comportamento de uma instalação que acabou de rodar o SQL.
    ia_configuracao: [],
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


// ===========================================================================
// ETAPA 3 — extração, revisão e aplicação
//
// O provedor de estruturação também é trocado por um servidor local (via
// GROQ_API_BASE). A aplicação passa pelo backend/materiaPrima.js de verdade,
// contra o mesmo duplo da API remota — é a única forma de provar que a entrada
// em estoque grava a movimentação junto com o saldo.
// ===========================================================================

/** Servidor que responde como o /chat/completions da Groq. */
function criarGroq(responder) {
  const chamadas = [];
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const body = corpo ? JSON.parse(corpo) : null;
      chamadas.push({ caminho: url.pathname, auth: req.headers.authorization, body });
      const r = responder ? responder({ chamadas, body }) : null;
      const { status = 200, payload = respostaGroq({ itens: [] }) } = r || {};
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  return { servidor, chamadas };
}

const respostaGroq = (objeto, finish = 'stop') => ({
  choices: [{ message: { content: typeof objeto === 'string' ? objeto : JSON.stringify(objeto) }, finish_reason: finish }]
});

/** Sobe o app com duplos de Gemini E Groq. */
async function montarComIA(dados, env = {}, { gemini: respGemini, groq: respGroq } = {}, opcoesUpstream = {}) {
  const gemini = criarGemini(respGemini);
  const groq = criarGroq(respGroq);
  await new Promise(r => gemini.servidor.listen(0, '127.0.0.1', r));
  await new Promise(r => groq.servidor.listen(0, '127.0.0.1', r));

  const ctx = await montar(dados, {
    GEMINI_API_BASE: `http://127.0.0.1:${gemini.servidor.address().port}/v1beta`,
    GEMINI_API_KEY: 'chave-gemini',
    GROQ_API_BASE: `http://127.0.0.1:${groq.servidor.address().port}`,
    GROQ_API_KEY: 'chave-groq',
    GROQ_MODEL: 'llama-de-teste',
    ...env
  }, opcoesUpstream);

  const encerrarOriginal = ctx.encerrar;
  ctx.gemini = gemini;
  ctx.groq = groq;
  ctx.encerrar = async () => {
    await encerrarOriginal();
    await new Promise(r => gemini.servidor.close(r));
    await new Promise(r => groq.servidor.close(r));
  };
  return ctx;
}

/** Base com uma leitura de matéria-prima já lida, pronta para estruturar. */
function baseParaEstruturar() {
  const dados = baseDados();
  dados.materia_prima = [
    { id: 70, nome: 'MDF 15mm Branco TX', quantidade: 12, preco_unitario: 180, unidade: 'CH', categoria: 'Chapas' },
    { id: 71, nome: 'Cola PVA extra 1kg', quantidade: 5, preco_unitario: 20, unidade: 'UN', categoria: 'Consumível' }
  ];
  dados.materia_prima_movimentacoes = [];
  dados.categoria = [{ id: 1, nome_categoria: 'Chapas' }, { id: 2, nome_categoria: 'Consumível' }];
  dados.unidades = [{ id: 1, tipo: 'CH' }, { id: 2, tipo: 'UN' }];
  dados.produtos_insumos = [];
  dados.produtos = [];
  dados.ia_extracoes.push({
    id: 4, titulo: 'Lista Bralux', destino: 'materia_prima', status: 'rascunho',
    arquivos_qtd: 1, itens_qtd: 0, aplicados_qtd: 0, usuario_id: 1, criado_em: RECENTE
  });
  dados.ia_extracao_arquivos.push({
    id: 41, extracao_id: 4, nome_arquivo: 'bralux.xlsx', origem: 'planilha',
    texto: 'ITEM | QTD | PRECO\nMDF 15mm Branco TX | 40 | 189,90\nFita 22mm | 500 | 1,35'
  });
  return dados;
}

const ITENS_LIDOS = {
  itens: [
    { nome: 'MDF 15mm Branco TX', quantidade: '40', unidade: 'CH', preco_unitario: '189,90', categoria: 'Chapas', descricao: null },
    { nome: 'Fita de borda 22mm', quantidade: '500', unidade: 'M', preco_unitario: '1,35', categoria: 'Acabamento', descricao: null }
  ]
};

const itensDa = (ctx, extracaoId) =>
  ctx.tabelas.ia_extracao_itens
    .filter(i => i.extracao_id === extracaoId)
    .sort((a, b) => a.linha - b.linha);

// ---------------------------------------------------------------------------
// Extração
// ---------------------------------------------------------------------------

test('a extração transforma o texto guardado em itens', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, { groq: () => ({ payload: respostaGroq(ITENS_LIDOS) }) });
  try {
    const resp = await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    assert.strictEqual(resp.status, 200);
    const corpo = await resp.json();
    assert.strictEqual(corpo.status, 'revisao');
    assert.strictEqual(corpo.itens_qtd, 2);

    const itens = itensDa(ctx, 4);
    assert.strictEqual(itens.length, 2);
    const primeiro = JSON.parse(itens[0].dados);
    // "189,90" precisa virar número: gravar a string faria o preço chegar ao
    // estoque como NaN.
    assert.strictEqual(primeiro.preco_unitario, 189.9);
    assert.strictEqual(primeiro.quantidade, 40);

    // O modelo usado fica registrado, como o de leitura.
    assert.strictEqual(ctx.tabelas.ia_extracoes.find(e => e.id === 4).modelo_llm, 'llama-de-teste');
  } finally {
    await ctx.encerrar();
  }
});

test('a extração pede JSON e temperatura zero', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, { groq: () => ({ payload: respostaGroq(ITENS_LIDOS) }) });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    const body = ctx.groq.chamadas[0].body;

    assert.strictEqual(body.model, 'llama-de-teste');
    // Extração é trabalho determinístico: variação aqui é um preço diferente
    // a cada execução sobre o mesmo documento.
    assert.strictEqual(body.temperature, 0);
    assert.strictEqual(body.response_format.type, 'json_object');
    // O texto lido tem de chegar ao modelo, com o nome do arquivo junto.
    assert.match(body.messages[1].content, /MDF 15mm Branco TX \| 40 \| 189,90/);
    assert.match(body.messages[1].content, /bralux\.xlsx/);
  } finally {
    await ctx.encerrar();
  }
});

test('o item que já existe no estoque sai marcado para dar entrada', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, { groq: () => ({ payload: respostaGroq(ITENS_LIDOS) }) });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    const itens = itensDa(ctx, 4);

    // Cadastrar de novo o que já existe reparte o saldo entre duas linhas do
    // mesmo insumo, e o erro só aparece no inventário.
    assert.strictEqual(itens[0].acao, 'atualizar');
    assert.strictEqual(itens[0].alvo_id, 70);
    assert.strictEqual(itens[0].alvo_tabela, 'materia_prima');
    // Nome IGUAL não levanta dúvida: confiança cheia e nenhuma ressalva. O
    // índice "sem pontuação" casaria o mesmo registro, mas com um aviso de
    // "confira" que não faz sentido quando o nome bate letra por letra.
    assert.strictEqual(Number(itens[0].confianca), 1);
    assert.strictEqual(itens[0].mensagem, null);

    assert.strictEqual(itens[1].acao, 'criar');
    assert.strictEqual(itens[1].alvo_id, null);
  } finally {
    await ctx.encerrar();
  }
});

test('nome parecido NÃO é casado sozinho — vira cadastro com aviso', async () => {
  // Juntar "MDF 15mm Branco TX" com "MDF 15mm Branco TX Guararapes" misturaria
  // dois insumos diferentes, e o estrago só apareceria no inventário.
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [{ nome: 'MDF 15mm Branco TX Guararapes', quantidade: '10' }] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    const item = itensDa(ctx, 4)[0];
    assert.strictEqual(item.acao, 'criar');
    assert.strictEqual(item.alvo_id, null);
    assert.match(item.mensagem, /Parecido com "MDF 15mm Branco TX" \(#70\)/);
  } finally {
    await ctx.encerrar();
  }
});

test('linha sem campo obrigatório é descartada, e o descarte é anunciado', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({
      payload: respostaGroq({
        itens: [
          { nome: 'Item bom', quantidade: '5' },
          { nome: null, quantidade: '9' },
          { nome: 'Sem quantidade', quantidade: null }
        ]
      })
    })
  });
  try {
    const corpo = await (await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' })).json();
    assert.strictEqual(corpo.itens_qtd, 1);
    assert.strictEqual(corpo.descartados, 2);

    // Se o documento tinha 3 linhas e sobrou 1, quem revisa PRECISA saber —
    // senão confere a que veio, aprova, e as outras somem sem ninguém notar.
    const extracao = ctx.tabelas.ia_extracoes.find(e => e.id === 4);
    assert.match(extracao.erro, /2 linha\(s\) descartada\(s\)/);
  } finally {
    await ctx.encerrar();
  }
});

test('resposta cortada por tamanho é anunciada', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({ payload: respostaGroq(ITENS_LIDOS, 'length') })
  });
  try {
    const corpo = await (await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' })).json();
    assert.strictEqual(corpo.truncado, true);
    // A resposta é JSON válido, só que incompleta: sem aviso o revisor aprova
    // metade da lista achando que é a lista inteira.
    assert.ok(corpo.avisos.some(a => /cortada/i.test(a)));
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Documento que não cabe numa resposta só
//
// Este é o modo de falha que mais dói no módulo, e o que o usuário encontrou
// na primeira planilha de verdade: 18 clientes no arquivo, 3 na tela. A
// resposta veio JSON válido e os 3 estavam certos — não havia nada para o
// revisor estranhar. Os outros 15 sumiram em silêncio.
// ---------------------------------------------------------------------------

/** Texto com `n` linhas longas o bastante para o fatiamento ter onde cortar. */
function documentoLongo(n) {
  return Array.from({ length: n }, (_, i) =>
    `Insumo ${String(i + 1).padStart(2, '0')} Chapa MDF Branco Texturizado 15mm | 5 | 10,00`).join('\n');
}

/**
 * Groq que se comporta como um modelo com teto de saída: devolve no máximo
 * `teto` itens e marca `length` quando o texto tinha mais linhas do que isso.
 */
function groqComTeto(teto) {
  return ({ body }) => {
    const linhas = String(body.messages[1].content).split('\n')
      .filter(l => l.trim() && !l.startsWith('###'));
    const cabe = linhas.slice(0, teto);
    const itens = cabe.map(l => ({
      nome: l.split('|')[0].trim(), quantidade: '5', unidade: 'CH',
      preco_unitario: '10,00', categoria: 'Chapas', descricao: null
    }));
    return { payload: respostaGroq({ itens }, linhas.length > teto ? 'length' : 'stop') };
  };
}

/** Base cuja leitura tem um texto longo em vez das duas linhas de sempre. */
function baseComDocumentoLongo(linhas) {
  const dados = baseParaEstruturar();
  dados.ia_extracao_arquivos[dados.ia_extracao_arquivos.length - 1].texto = documentoLongo(linhas);
  return dados;
}

test('documento cortado por tamanho é fatiado até caber, e nada se perde', async () => {
  const ctx = await montarComIA(baseComDocumentoLongo(24), {}, { groq: groqComTeto(6) });
  try {
    const corpo = await (await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' })).json();

    // As 24 linhas do documento viram 24 itens. Antes do fatiamento vinham 6.
    assert.strictEqual(corpo.itens_qtd, 24);
    // E, como tudo coube, o revisor não recebe aviso de resposta cortada.
    assert.strictEqual(corpo.truncado, false);

    const nomes = itensDa(ctx, 4).map(i => JSON.parse(i.dados).nome);
    assert.strictEqual(nomes.length, 24);
    // Sem duplicata: o resultado cortado do pai é descartado, senão os itens
    // que vieram antes do corte entrariam uma vez por nível de fatiamento.
    assert.strictEqual(new Set(nomes).size, 24);
    // E o último item do documento chegou — é ele que sumia.
    assert.ok(nomes.some(n => n.startsWith('Insumo 24')), nomes.join(', '));
  } finally {
    await ctx.encerrar();
  }
});

test('o documento que cabe de primeira continua custando uma chamada só', async () => {
  const ctx = await montarComIA(baseComDocumentoLongo(4), {}, { groq: groqComTeto(6) });
  try {
    const corpo = await (await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' })).json();
    assert.strictEqual(corpo.itens_qtd, 4);
    // Fatiar preventivamente faria todo documento pagar pelo caso raro.
    assert.strictEqual(ctx.groq.chamadas.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('o fatiamento tem teto de chamadas, e avisa quando esbarra nele', async () => {
  const ctx = await montarComIA(baseComDocumentoLongo(40), { IA_MAX_CHAMADAS: '3' },
    { groq: groqComTeto(2) });
  try {
    const corpo = await (await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' })).json();

    // Sem teto, um documento que o modelo se recusa a extrair geraria dezenas
    // de chamadas pagas sobre o mesmo arquivo.
    assert.ok(ctx.groq.chamadas.length <= 3, `gastou ${ctx.groq.chamadas.length}`);
    // O que veio continua valendo...
    assert.ok(corpo.itens_qtd > 0);
    // ...mas entregar parte da lista em silêncio é o bug que estamos consertando.
    assert.strictEqual(corpo.truncado, true);
    assert.ok(corpo.avisos.some(a => /cortada/i.test(a)));
  } finally {
    await ctx.encerrar();
  }
});

test('dividirEmDuas corta entre linhas, nunca no meio de uma', () => {
  const { dividirEmDuas } = require('./iaEstruturacao');

  const texto = documentoLongo(10);
  const [a, b] = dividirEmDuas(texto);
  // Um registro partido ao meio viraria dois itens pela metade — e um item
  // pela metade parece um item bom, que é o que o torna pior que o corte.
  for (const linha of [...a.split('\n'), ...b.split('\n')]) {
    assert.match(linha, /^Insumo \d\d .* \| 5 \| 10,00$/, `linha partida: ${linha}`);
  }
  assert.strictEqual(a.split('\n').length + b.split('\n').length, 10);

  // Pedaço curto, ou de uma linha só, não tem por onde ser partido.
  assert.strictEqual(dividirEmDuas('linha curta'), null);
  assert.strictEqual(dividirEmDuas('x'.repeat(900)), null);
});

test('JSON embrulhado em cerca de código ainda é aproveitado', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({ payload: respostaGroq('```json\n' + JSON.stringify(ITENS_LIDOS) + '\n```') })
  });
  try {
    const corpo = await (await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' })).json();
    assert.strictEqual(corpo.itens_qtd, 2);
  } finally {
    await ctx.encerrar();
  }
});

test('resposta que não é JSON vira erro explicado, não leitura vazia', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({ payload: respostaGroq('desculpe, não consegui') })
  });
  try {
    const resp = await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    assert.ok(resp.status >= 400);
    const extracao = ctx.tabelas.ia_extracoes.find(e => e.id === 4);
    assert.strictEqual(extracao.status, 'erro');
    assert.ok(extracao.erro);
  } finally {
    await ctx.encerrar();
  }
});

test('a extração nunca deixa a leitura pendurada em "lendo"', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({ status: 500, payload: { error: { message: 'boom' } } })
  });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    assert.strictEqual(ctx.tabelas.ia_extracoes.find(e => e.id === 4).status, 'erro');
  } finally {
    await ctx.encerrar();
  }
});

test('extrair de novo REFAZ a lista em vez de acrescentar', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, { groq: () => ({ payload: respostaGroq(ITENS_LIDOS) }) });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });

    // Sem a troca, reprocessar dobraria a lista e o revisor aprovaria tudo
    // duas vezes — o estoque entraria em dobro.
    assert.strictEqual(itensDa(ctx, 4).length, 2);
  } finally {
    await ctx.encerrar();
  }
});

test('leitura já aplicada não pode ser extraída de novo', async () => {
  const dados = baseParaEstruturar();
  dados.ia_extracoes.find(e => e.id === 4).status = 'aplicada';
  const ctx = await montarComIA(dados);
  try {
    const resp = await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    assert.strictEqual(resp.status, 409);
    assert.strictEqual(ctx.groq.chamadas.length, 0, 'gastou crédito numa leitura encerrada');
  } finally {
    await ctx.encerrar();
  }
});

test('leitura sem texto não chega a chamar o modelo', async () => {
  const dados = baseParaEstruturar();
  dados.ia_extracao_arquivos.find(a => a.id === 41).texto = null;
  const ctx = await montarComIA(dados);
  try {
    const resp = await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    assert.strictEqual(resp.status, 400);
    assert.strictEqual(ctx.groq.chamadas.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('sem ia.extract o usuário comum não extrai', async () => {
  const ctx = await montarComIA(permitir(baseParaEstruturar(), ['acao_view', 'acao_details_view']));
  try {
    const resp = await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST', usuario: 2 });
    assert.strictEqual(resp.status, 403);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Detalhe da revisão
// ---------------------------------------------------------------------------

test('o detalhe descreve os campos que a grade deve mostrar', async () => {
  const ctx = await montarComIA(baseParaEstruturar());
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/4')).json();

    // A grade é montada a partir daqui. Colunas escritas no HTML fariam a
    // tela divergir do que a IA extrai.
    const chaves = dados.campos.map(c => c.chave);
    assert.deepStrictEqual(chaves, ['nome', 'quantidade', 'unidade', 'preco_unitario', 'categoria', 'descricao']);
    assert.strictEqual(dados.campos.find(c => c.chave === 'nome').obrigatorio, true);
    assert.strictEqual(dados.campos.find(c => c.chave === 'preco_unitario').tipo, 'dinheiro');
    assert.strictEqual(dados.pode_aplicar_destino, true);
    assert.ok(dados.explicacoes.atualizar);
  } finally {
    await ctx.encerrar();
  }
});

test('o detalhe traz os insumos existentes para o revisor apontar', async () => {
  const ctx = await montarComIA(baseParaEstruturar());
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/4')).json();
    assert.deepStrictEqual(dados.alvos.map(a => a.id).sort(), [70, 71]);
    // Id, nome e a tabela de onde veio. Nada além disso: a tabela inteira do
    // estoque seria dezenas de campos por linha que a tela não usa.
    assert.deepStrictEqual(Object.keys(dados.alvos[0]).sort(), ['id', 'nome', 'tabela']);
    assert.strictEqual(dados.alvos[0].tabela, 'materia_prima');
  } finally {
    await ctx.encerrar();
  }
});

test('o detalhe sugere as categorias e unidades que já existem', async () => {
  const ctx = await montarComIA(baseParaEstruturar());
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/4')).json();
    assert.deepStrictEqual(dados.sugestoes.categoria, ['Chapas', 'Consumível']);
    assert.deepStrictEqual(dados.sugestoes.unidade, ['CH', 'UN']);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Revisão
// ---------------------------------------------------------------------------

async function prepararRevisao(env = {}) {
  const ctx = await montarComIA(baseParaEstruturar(), env, { groq: () => ({ payload: respostaGroq(ITENS_LIDOS) }) });
  await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
  return ctx;
}

test('a correção do revisor passa pela mesma coerção da IA', async () => {
  const ctx = await prepararRevisao();
  try {
    const item = itensDa(ctx, 4)[1];
    const resp = await chamar(ctx.porta, `/api/ia/4/itens/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify({ dados: { preco_unitario: '2,50', nome: '  Fita   corrigida  ' } })
    });
    assert.strictEqual(resp.status, 200);
    const salvo = await resp.json();

    // Sem a coerção, o revisor digitaria "2,50" e gravaria a string: o modelo
    // teria seus números validados e a pessoa não.
    assert.strictEqual(salvo.dados.preco_unitario, 2.5);
    assert.strictEqual(salvo.dados.nome, 'Fita corrigida');
    // Os campos não enviados continuam como estavam.
    assert.strictEqual(salvo.dados.quantidade, 500);
  } finally {
    await ctx.encerrar();
  }
});

test('valor impossível na correção é recusado com o motivo', async () => {
  const ctx = await prepararRevisao();
  try {
    const item = itensDa(ctx, 4)[1];
    const resp = await chamar(ctx.porta, `/api/ia/4/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ dados: { quantidade: 'umas cinquenta' } })
    });
    assert.strictEqual(resp.status, 400);
    assert.match((await resp.json()).error, /Qtde/);

    // E nada mudou no banco.
    assert.strictEqual(JSON.parse(itensDa(ctx, 4)[1].dados).quantidade, 500);
  } finally {
    await ctx.encerrar();
  }
});

test('mudar a ação para cadastrar solta o insumo de destino', async () => {
  const ctx = await prepararRevisao();
  try {
    const item = itensDa(ctx, 4)[0];
    assert.strictEqual(item.alvo_id, 70);

    const salvo = await (await chamar(ctx.porta, `/api/ia/4/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'criar' })
    })).json();

    // Sem soltar o alvo, o item sairia como novo apontando para um insumo
    // existente — e a gravação seguinte escreveria um por cima do outro.
    assert.strictEqual(salvo.acao, 'criar');
    assert.strictEqual(salvo.alvo_id, null);
  } finally {
    await ctx.encerrar();
  }
});

test('apontar o item para um insumo existente já muda a ação', async () => {
  const ctx = await prepararRevisao();
  try {
    const item = itensDa(ctx, 4)[1];
    const salvo = await (await chamar(ctx.porta, `/api/ia/4/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ alvo_id: 71 })
    })).json();

    assert.strictEqual(salvo.alvo_id, 71);
    assert.strictEqual(salvo.acao, 'atualizar');
  } finally {
    await ctx.encerrar();
  }
});

test('ação inventada é recusada', async () => {
  const ctx = await prepararRevisao();
  try {
    const item = itensDa(ctx, 4)[0];
    const resp = await chamar(ctx.porta, `/api/ia/4/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'apagar_tudo' })
    });
    assert.strictEqual(resp.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('item de outra leitura não é editável trocando o id', async () => {
  const ctx = await prepararRevisao();
  try {
    // O item 21 pertence à leitura 1.
    const resp = await chamar(ctx.porta, '/api/ia/4/itens/21', {
      method: 'PUT', body: JSON.stringify({ acao: 'ignorar' })
    });
    assert.strictEqual(resp.status, 404);
  } finally {
    await ctx.encerrar();
  }
});

test('sem ia.review.edit o usuário comum não corrige', async () => {
  const ctx = await prepararRevisao();
  try {
    const item = itensDa(ctx, 4)[0];
    // O perfil Vendedor não tem nenhuma permissão liberada nesta base.
    const resp = await chamar(ctx.porta, `/api/ia/4/itens/${item.id}`, {
      method: 'PUT', usuario: 2, body: JSON.stringify({ acao: 'ignorar' })
    });
    assert.strictEqual(resp.status, 403);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------

const aplicar = (ctx, id = 4, opcoes = {}) => chamar(ctx.porta, `/api/ia/${id}/aplicar`, {
  method: 'POST',
  body: JSON.stringify({ destino: 'materia_prima' }),
  ...opcoes
});

test('aplicar cadastra o insumo novo e dá entrada no que já existe', async () => {
  const ctx = await prepararRevisao();
  try {
    const resp = await aplicar(ctx);
    assert.strictEqual(resp.status, 200);
    const corpo = await resp.json();
    assert.strictEqual(corpo.aplicados, 2);
    assert.strictEqual(corpo.com_erro, 0);
    assert.strictEqual(corpo.status, 'aplicada');

    // O que já existia recebeu ENTRADA (12 + 40), não substituição.
    const existente = ctx.tabelas.materia_prima.find(m => m.id === 70);
    assert.strictEqual(Number(existente.quantidade), 52);
    assert.strictEqual(Number(existente.preco_unitario), 189.9);

    // O novo foi cadastrado com a quantidade como saldo inicial.
    const novo = ctx.tabelas.materia_prima.find(m => m.nome === 'Fita de borda 22mm');
    assert.ok(novo, 'o insumo novo não foi cadastrado');
    assert.strictEqual(Number(novo.quantidade), 500);
  } finally {
    await ctx.encerrar();
  }
});

test('a entrada em estoque grava a movimentação junto com o saldo', async () => {
  const ctx = await prepararRevisao();
  try {
    await aplicar(ctx);

    // Mexer no saldo sem escrever no razão é o que faz o histórico parar de
    // fechar com o estoque — e ninguém descobre até a conferência anual.
    const movimentos = ctx.tabelas.materia_prima_movimentacoes;
    assert.ok(movimentos.length >= 2, `só ${movimentos.length} movimentações`);

    const entrada = movimentos.find(m => Number(m.insumo_id) === 70);
    assert.ok(entrada, 'a entrada não deixou rastro');
    assert.strictEqual(Number(entrada.quantidade_anterior), 12);
    assert.strictEqual(Number(entrada.quantidade_atual), 52);
    // A procedência fica escrita: é como se descobre depois de onde veio um
    // saldo estranho.
    assert.match(String(entrada.observacao || ''), /Leitura de IA #4/);
  } finally {
    await ctx.encerrar();
  }
});

test('falha DEPOIS da entrada vira aviso, não erro', async () => {
  // O saldo já subiu quando o preço vai ser atualizado. Marcar o item como
  // erro convidaria a corrigir e aplicar de novo — e a segunda aplicação
  // somaria a quantidade outra vez.
  const ctx = await montarComIA(baseParaEstruturar(), {}, { groq: () => ({ payload: respostaGroq(ITENS_LIDOS) }) },
    { falharEm: ({ metodo, tabela }) => metodo === 'GET' && tabela === 'produtos_insumos' });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    const corpo = await (await aplicar(ctx)).json();

    assert.strictEqual(corpo.com_erro, 0, 'a falha no preço marcou o item como erro');
    assert.strictEqual(corpo.aplicados, 2);
    assert.strictEqual(corpo.status, 'aplicada');

    // O saldo entrou e o problema ficou escrito na linha.
    assert.strictEqual(Number(ctx.tabelas.materia_prima.find(m => m.id === 70).quantidade), 52);
    const item = itensDa(ctx, 4)[0];
    assert.strictEqual(item.status, 'aplicado');
    assert.match(item.mensagem, /preço não foi possível/i);
  } finally {
    await ctx.encerrar();
  }
});

test('o item descartado não vira estoque', async () => {
  const ctx = await prepararRevisao();
  try {
    const item = itensDa(ctx, 4)[1];
    await chamar(ctx.porta, `/api/ia/4/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'ignorar' })
    });

    const corpo = await (await aplicar(ctx)).json();
    assert.strictEqual(corpo.aplicados, 1);
    assert.strictEqual(corpo.ignorados, 1);
    assert.strictEqual(ctx.tabelas.materia_prima.some(m => m.nome === 'Fita de borda 22mm'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('aplicar duas vezes não duplica o estoque', async () => {
  const ctx = await prepararRevisao();
  try {
    await aplicar(ctx);
    const segunda = await aplicar(ctx);

    // A leitura já está encerrada: repetir não pode somar de novo.
    assert.strictEqual(segunda.status, 409);
    assert.strictEqual(Number(ctx.tabelas.materia_prima.find(m => m.id === 70).quantidade), 52);
    assert.strictEqual(ctx.tabelas.materia_prima.filter(m => m.nome === 'Fita de borda 22mm').length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('item que falha não derruba os que deram certo', async () => {
  const ctx = await prepararRevisao();
  try {
    // Deixa o segundo item sem quantidade válida, direto no banco: é o caso
    // de um dado que passou pela revisão sem ser olhado.
    const item = itensDa(ctx, 4)[1];
    item.dados = JSON.stringify({ ...JSON.parse(item.dados), quantidade: null });

    const corpo = await (await aplicar(ctx)).json();
    assert.strictEqual(corpo.aplicados, 1);
    assert.strictEqual(corpo.com_erro, 1);

    // Continua em revisão: é o que deixa corrigir e aplicar de novo sem
    // reaplicar o que já entrou.
    assert.strictEqual(corpo.status, 'revisao');
    assert.strictEqual(Number(ctx.tabelas.materia_prima.find(m => m.id === 70).quantidade), 52);
  } finally {
    await ctx.encerrar();
  }
});

test('aplicar de novo depois de corrigir não repete o que já entrou', async () => {
  const ctx = await prepararRevisao();
  try {
    const item = itensDa(ctx, 4)[1];
    item.dados = JSON.stringify({ ...JSON.parse(item.dados), quantidade: null });
    await aplicar(ctx);

    // Conserta e aplica de novo.
    const alvo = itensDa(ctx, 4)[1];
    await chamar(ctx.porta, `/api/ia/4/itens/${alvo.id}`, {
      method: 'PUT', body: JSON.stringify({ dados: { quantidade: '300' } })
    });
    const corpo = await (await aplicar(ctx)).json();

    assert.strictEqual(corpo.status, 'aplicada');
    // O primeiro item NÃO pode entrar de novo: 52, não 92.
    assert.strictEqual(Number(ctx.tabelas.materia_prima.find(m => m.id === 70).quantidade), 52);
    assert.strictEqual(Number(ctx.tabelas.materia_prima.find(m => m.nome === 'Fita de borda 22mm').quantidade), 300);
  } finally {
    await ctx.encerrar();
  }
});

test('categoria nova é cadastrada, e a que já existe é reaproveitada', async () => {
  const ctx = await prepararRevisao();
  try {
    await aplicar(ctx);

    const nomes = ctx.tabelas.categoria.map(c => c.nome_categoria);
    // "Acabamento" veio do documento e não existia.
    assert.ok(nomes.includes('Acabamento'), `categorias: ${nomes.join(', ')}`);
    // "Chapas" já existia: não pode virar uma segunda entrada.
    assert.strictEqual(nomes.filter(n => n === 'Chapas').length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('a grafia diferente encaixa na categoria que já existe', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [{ nome: 'Item novo', quantidade: '3', categoria: 'CHAPAS' }] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    await aplicar(ctx);

    // Sem o encaixe, cada fornecedor com uma grafia criaria uma entrada nova
    // e o filtro por categoria viraria uma lista de variações da mesma palavra.
    assert.strictEqual(ctx.tabelas.categoria.filter(c => /chapas/i.test(c.nome_categoria)).length, 1);
    assert.strictEqual(ctx.tabelas.materia_prima.find(m => m.nome === 'Item novo').categoria, 'Chapas');
  } finally {
    await ctx.encerrar();
  }
});

test('preço em branco não apaga o preço que o cadastro já tinha', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [{ nome: 'MDF 15mm Branco TX', quantidade: '10', preco_unitario: null }] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    await aplicar(ctx);

    // Campo vazio lido como zero sobrescreveria o preço bom do cadastro.
    assert.strictEqual(Number(ctx.tabelas.materia_prima.find(m => m.id === 70).preco_unitario), 180);
    assert.strictEqual(Number(ctx.tabelas.materia_prima.find(m => m.id === 70).quantidade), 22);
  } finally {
    await ctx.encerrar();
  }
});

test('preço ZERO não apaga o preço que o cadastro já tinha', async () => {
  // Diferente de `null`: aqui o modelo devolveu um número. Numa lista de
  // compra, zero é campo em branco lido como valor — e gravá-lo zeraria o
  // preço bom do cadastro, derrubando junto o custo dos produtos que usam o
  // insumo.
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [{ nome: 'MDF 15mm Branco TX', quantidade: '10', preco_unitario: '0' }] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    await aplicar(ctx);

    assert.strictEqual(Number(ctx.tabelas.materia_prima.find(m => m.id === 70).preco_unitario), 180);
    assert.strictEqual(Number(ctx.tabelas.materia_prima.find(m => m.id === 70).quantidade), 22);
  } finally {
    await ctx.encerrar();
  }
});

test('a entrada não sobrescreve a quantidade com o payload descritivo', async () => {
  // Unidade e categoria vão num PUT separado. Mandar o payload inteiro
  // desfaria a soma que a entrada acabou de fazer.
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [{ nome: 'MDF 15mm Branco TX', quantidade: '8', unidade: 'PC', categoria: 'Outra' }] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    await aplicar(ctx);

    const insumo = ctx.tabelas.materia_prima.find(m => m.id === 70);
    assert.strictEqual(Number(insumo.quantidade), 20, 'a quantidade foi sobrescrita pelo PUT descritivo');
    assert.strictEqual(insumo.unidade, 'PC');
    assert.strictEqual(insumo.categoria, 'Outra');
  } finally {
    await ctx.encerrar();
  }
});

test('aplicar em destino diferente do da leitura é recusado', async () => {
  const ctx = await prepararRevisao();
  try {
    const resp = await chamar(ctx.porta, '/api/ia/4/aplicar', {
      method: 'POST', body: JSON.stringify({ destino: 'clientes' })
    });
    assert.ok(resp.status >= 400);
    assert.strictEqual(ctx.tabelas.materia_prima.length, 2, 'gravou mesmo assim');
  } finally {
    await ctx.encerrar();
  }
});

test('aplicar exige a permissão do módulo de destino, não só a da IA', async () => {
  // `ia.apply.mp` sozinho seria um atalho para cadastrar insumo sem ter
  // permissão de cadastrar insumo.
  const dados = permitir(baseParaEstruturar(), [
    'acao_view', 'acao_details_view', 'acao_extract', 'acao_review_edit', 'acao_apply_mp'
  ]);
  const ctx = await montarComIA(dados, {}, { groq: () => ({ payload: respostaGroq(ITENS_LIDOS) }) });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    const resp = await aplicar(ctx, 4, { usuario: 2 });
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(ctx.tabelas.materia_prima.length, 2);
  } finally {
    await ctx.encerrar();
  }
});

test('leitura sem itens não pode ser aplicada', async () => {
  const ctx = await montarComIA(baseParaEstruturar());
  try {
    const resp = await aplicar(ctx);
    assert.strictEqual(resp.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Estruturação e reconciliação (unidade)
// ---------------------------------------------------------------------------

test('a coerção aceita número em português e recusa lixo', () => {
  const { coagir } = require('./iaEstruturacao');
  const { obterEsquema } = require('./iaEsquemas');
  const preco = obterEsquema('materia_prima').campos.find(c => c.chave === 'preco_unitario');

  assert.strictEqual(coagir(preco, '189,90'), 189.9);
  assert.strictEqual(coagir(preco, '1.234,56'), 1234.56);
  assert.strictEqual(coagir(preco, 'R$ 24,80'), 24.8);
  assert.strictEqual(coagir(preco, 'a combinar'), undefined);
  // Quantidade e preço negativos não existem numa lista de compra; quase
  // sempre é sinal trocado de um estorno lido fora de contexto.
  assert.strictEqual(coagir(preco, '-5'), undefined);
  assert.strictEqual(coagir(preco, null), null);
});

test('a coerção não deixa objeto virar "[object Object]" no texto', () => {
  const { coagir } = require('./iaEstruturacao');
  const { obterEsquema } = require('./iaEsquemas');
  const nome = obterEsquema('materia_prima').campos.find(c => c.chave === 'nome');

  assert.strictEqual(coagir(nome, { valor: 'x' }), undefined);
  assert.strictEqual(coagir(nome, ['a', 'b']), undefined);
  assert.strictEqual(coagir(nome, '  MDF   15mm '), 'MDF 15mm');
});

test('o texto é cortado no comprimento da coluna', () => {
  const { coagir } = require('./iaEstruturacao');
  const { obterEsquema } = require('./iaEsquemas');
  const nome = obterEsquema('materia_prima').campos.find(c => c.chave === 'nome');
  // Um nome de 4 mil caracteres estouraria a coluna do banco.
  assert.strictEqual(coagir(nome, 'x'.repeat(500)).length, nome.max);
});

test('a repetição dentro da própria leitura é sinalizada', () => {
  const { reconciliar } = require('./iaReconciliacao');
  const saida = reconciliar({
    destino: 'materia_prima',
    itens: [
      { linha: 1, dados: { nome: 'Cola PVA' } },
      { linha: 2, dados: { nome: 'cola  pva' } }
    ],
    existentes: []
  });

  // Duas entradas do mesmo item numa lista costumam ser linha duplicada no
  // documento; somar sozinho dobraria o estoque em silêncio.
  assert.strictEqual(saida[0].acao, 'criar');
  assert.strictEqual(saida[1].acao, 'ignorar');
  assert.match(saida[1].mensagem, /Repetido da linha 1/);
});

test('a mesma peça escrita com outra pontuação casa, e avisa', () => {
  const { reconciliar } = require('./iaReconciliacao');
  const saida = reconciliar({
    destino: 'materia_prima',
    itens: [{ linha: 1, dados: { nome: 'MDF-15mm-Branco' } }],
    existentes: [{ id: 5, nome: 'MDF 15 mm Branco' }]
  });

  assert.strictEqual(saida[0].acao, 'atualizar');
  assert.strictEqual(saida[0].alvo_id, 5);
  assert.match(saida[0].mensagem, /ignorando espaços e pontuação/);
});

test('o encaixe de taxonomia respeita a grafia que já existe', () => {
  const { encaixar } = require('./iaAplicacao');
  assert.strictEqual(encaixar('chapas', ['Chapas', 'Ferragens']), 'Chapas');
  assert.strictEqual(encaixar('FERRAGENS', ['Chapas', 'Ferragens']), 'Ferragens');
  assert.strictEqual(encaixar('Adesivos', ['Chapas']), 'Adesivos');
  assert.strictEqual(encaixar('  ', ['Chapas']), null);
});


// ===========================================================================
// ETAPA 4 — empresas (clientes e prospecções) com contatos aninhados
//
// A diferença que muda tudo em relação à matéria-prima: um item traz uma LISTA
// dentro. E a atualização passa a ter um risco novo — o de EMPOBRECER um
// cadastro que já estava completo, sobrescrevendo com o pouco que um cartão de
// visita trazia.
// ===========================================================================

function baseEmpresas() {
  const dados = baseDados();
  dados.clientes = [
    {
      id: 50, nome_fantasia: 'Casa Vicenzo', razao_social: 'Vicenzo Ltda',
      cnpj: '11.111.111/0001-11', site: 'vicenzo.com.br', inscricao_estadual: '123456',
      reg_logradouro: 'Rua das Flores', reg_numero: '100', reg_cidade: 'Bento Gonçalves',
      reg_uf: 'RS', reg_cep: '95700-000'
    }
  ];
  dados.contatos_cliente = [
    { id: 7, id_cliente: 50, nome: 'Ana Paula', cargo: 'Compras', email: 'ana@vicenzo.com.br' }
  ];
  dados.prospeccoes = [
    { id: 30, nome_fantasia: 'Marcenaria Serrana', cnpj: '22.222.222/0001-22', etapa: 'Proposta', status: 'ativa', probabilidade: 65 }
  ];
  dados.prospeccao_contatos = [
    { id: 40, prospeccao_id: 30, nome: 'Ricardo Menezes', email: 'ricardo@serrana.com.br', principal: true }
  ];
  dados.prospeccao_historico = [];
  dados.prospeccao_etapas_historico = [];
  return dados;
}

function comLeitura(dados, destino, texto = 'CONTEUDO DO DOCUMENTO') {
  dados.ia_extracoes.push({
    id: 5, titulo: 'Cartões da feira', destino, status: 'rascunho',
    arquivos_qtd: 1, itens_qtd: 0, aplicados_qtd: 0, usuario_id: 1, criado_em: RECENTE
  });
  dados.ia_extracao_arquivos.push({
    id: 51, extracao_id: 5, nome_arquivo: 'cartoes.pdf', origem: 'pdf', texto
  });
  return dados;
}

const EMPRESA_NOVA = {
  itens: [{
    nome_fantasia: 'Decor Alpina',
    razao_social: 'Decor Alpina Comércio de Móveis',
    cnpj: '33.333.333/0001-33',
    site: 'decoralpina.com.br',
    end_logradouro: 'Rua das Videiras',
    end_numero: '480',
    end_cidade: 'Bento Gonçalves',
    end_uf: 'RS',
    contatos: [
      { nome: 'Juliana Prass', cargo: 'Compras', email: 'juliana@decoralpina.com.br', telefone_celular: '(47) 99160-3388' },
      { nome: 'Marco Rossi', cargo: 'Diretor', email: 'marco@decoralpina.com.br' }
    ]
  }]
};

const aplicarEm = (ctx, destino, id = 5, opcoes = {}) =>
  chamar(ctx.porta, `/api/ia/${id}/aplicar`, {
    method: 'POST', body: JSON.stringify({ destino }), ...opcoes
  });

// ---------------------------------------------------------------------------
// Extração com lista aninhada
// ---------------------------------------------------------------------------

test('a empresa vem com os contatos dentro, não como linhas separadas', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({ payload: respostaGroq(EMPRESA_NOVA) })
  });
  try {
    const corpo = await (await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' })).json();
    assert.strictEqual(corpo.itens_qtd, 1, 'duas pessoas da mesma empresa viraram duas empresas');

    const item = JSON.parse(itensDa(ctx, 5)[0].dados);
    assert.strictEqual(item.nome_fantasia, 'Decor Alpina');
    assert.strictEqual(item.contatos.length, 2);
    assert.strictEqual(item.contatos[0].nome, 'Juliana Prass');
    assert.strictEqual(item.contatos[0].cargo, 'Compras');
  } finally {
    await ctx.encerrar();
  }
});

test('o prompt descreve a forma da sub-lista', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const sistema = ctx.groq.chamadas[0].body.messages[0].content;

    // Sem a descrição dos subcampos, o modelo devolve uma lista de strings ou
    // um objeto solto — e a lista inteira é descartada na coerção.
    assert.match(sistema, /Cada entrada de "contatos" tem:/);
    assert.match(sistema, /"telefone_celular"/);
    assert.match(sistema, /"contatos": \[\{"nome": \.\.\./);
  } finally {
    await ctx.encerrar();
  }
});

test('contato sem nome é descartado, e o descarte é anunciado', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({
      payload: respostaGroq({
        itens: [{
          nome_fantasia: 'Empresa X',
          contatos: [{ nome: 'Ana' }, { cargo: 'Compras' }, 'texto solto', { nome: '  ' }]
        }]
      })
    })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const linha = itensDa(ctx, 5)[0];

    // Contato sem nome viraria uma linha em branco no cadastro da empresa.
    assert.strictEqual(JSON.parse(linha.dados).contatos.length, 1);
    assert.match(linha.mensagem, /3 contatos sem os dados mínimos foram descartados/);
  } finally {
    await ctx.encerrar();
  }
});

test('lista que não veio como lista é recusada, não silenciada', async () => {
  // O modelo às vezes devolve "Ana, João" numa string em vez do array. Virar
  // lista vazia perderia os contatos sem dizer nada; recusar deixa o problema
  // à vista de quem revisa.
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [{ nome_fantasia: 'Empresa Y', contatos: 'Ana, João' }] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const linha = itensDa(ctx, 5)[0];
    assert.match(linha.mensagem, /Contatos: valor não reconhecido/);
  } finally {
    await ctx.encerrar();
  }
});

test('a chave forte decide quando as duas apontam para registros diferentes', async () => {
  // CNPJ leva à empresa A, nome fantasia leva à empresa B. Se a ordem de força
  // não for respeitada, o dado entra na empresa errada — e o erro só aparece
  // quando alguém for procurar o contato onde ele não está.
  const dados = baseEmpresas();
  dados.clientes.push({ id: 60, nome_fantasia: 'Outra Casa', cnpj: '55.555.555/0001-55' });

  const ctx = await montarComIA(comLeitura(dados, 'clientes'), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [{ nome_fantasia: 'Outra Casa', cnpj: '11.111.111/0001-11' }] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const item = itensDa(ctx, 5)[0];

    assert.strictEqual(item.alvo_id, 50, 'casou pelo nome em vez do CNPJ');
    assert.strictEqual(item.mensagem, null, 'casamento por CNPJ não devia levantar ressalva');
  } finally {
    await ctx.encerrar();
  }
});

test('empresa sem contato no documento fica com lista vazia, não nula', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [{ nome_fantasia: 'Sozinha', contatos: null }] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    // Quem consome espera um array; um null aqui estouraria no `.map`.
    assert.deepStrictEqual(JSON.parse(itensDa(ctx, 5)[0].dados).contatos, []);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Reconciliação de empresa
// ---------------------------------------------------------------------------

test('CNPJ igual casa sem levantar dúvida, mesmo com pontuação diferente', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [{ nome_fantasia: 'Vicenzo Casa', cnpj: '11111111000111' }] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const item = itensDa(ctx, 5)[0];

    // CNPJ é identificador, não apelido: o nome escrito de outro jeito não
    // muda o fato de ser a mesma empresa.
    assert.strictEqual(item.acao, 'atualizar');
    assert.strictEqual(item.alvo_id, 50);
    assert.strictEqual(Number(item.confianca), 1);
    assert.strictEqual(item.mensagem, null);
  } finally {
    await ctx.encerrar();
  }
});

test('casar só por nome vem com ressalva', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [{ nome_fantasia: 'Casa Vicenzo', cnpj: null }] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const item = itensDa(ctx, 5)[0];

    // Nome fantasia é apelido: pode ser filial, homônima ou a mesma empresa.
    assert.strictEqual(item.acao, 'atualizar');
    assert.strictEqual(item.alvo_id, 50);
    assert.match(item.mensagem, /Casou por Empresa/);
  } finally {
    await ctx.encerrar();
  }
});

test('CNPJ diferente manda cadastrar, mesmo com nome parecido', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({ payload: respostaGroq({ itens: [{ nome_fantasia: 'Casa Vicenzo Filial', cnpj: '99.999.999/0001-99' }] }) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const item = itensDa(ctx, 5)[0];
    assert.strictEqual(item.acao, 'criar');
    assert.match(item.mensagem, /Parecido com "Casa Vicenzo"/);
  } finally {
    await ctx.encerrar();
  }
});

test('a mesma empresa duas vezes no documento entra uma vez só', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({
      payload: respostaGroq({
        itens: [
          { nome_fantasia: 'Nova A', cnpj: '44.444.444/0001-44' },
          { nome_fantasia: 'Nova A (matriz)', cnpj: '44444444000144' }
        ]
      })
    })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const itens = itensDa(ctx, 5);
    assert.strictEqual(itens[0].acao, 'criar');
    assert.strictEqual(itens[1].acao, 'ignorar');
    assert.match(itens[1].mensagem, /Repetido da linha 1 \(mesmo CNPJ\)/);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Aplicar em Clientes
// ---------------------------------------------------------------------------

async function prepararClientes(resposta = EMPRESA_NOVA, dados) {
  const ctx = await montarComIA(comLeitura(dados || baseEmpresas(), 'clientes'), {}, {
    groq: () => ({ payload: respostaGroq(resposta) })
  });
  await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
  return ctx;
}

test('aplicar cadastra o cliente com os contatos', async () => {
  const ctx = await prepararClientes();
  try {
    const corpo = await (await aplicarEm(ctx, 'clientes')).json();
    assert.strictEqual(corpo.aplicados, 1, JSON.stringify(corpo.itens));

    const novo = ctx.tabelas.clientes.find(c => c.nome_fantasia === 'Decor Alpina');
    assert.ok(novo, 'o cliente não foi cadastrado');
    assert.strictEqual(novo.cnpj, '33.333.333/0001-33');
    // O endereço plano da leitura tem de chegar às colunas reg_* do cliente.
    assert.strictEqual(novo.reg_logradouro, 'Rua das Videiras');
    assert.strictEqual(novo.reg_cidade, 'Bento Gonçalves');
    assert.strictEqual(novo.reg_uf, 'RS');

    const contatos = ctx.tabelas.contatos_cliente.filter(c => c.id_cliente === novo.id);
    assert.strictEqual(contatos.length, 2);
    assert.strictEqual(contatos[0].cargo, 'Compras');
  } finally {
    await ctx.encerrar();
  }
});

test('atualizar NÃO apaga o que o cadastro já tinha', async () => {
  // O caso que mais importa nesta etapa: um cartão de visita traz nome e
  // telefone; o cliente tem endereço, IE e site preenchidos há anos. Mandar o
  // payload inteiro com null apagaria tudo isso em silêncio.
  const ctx = await prepararClientes({
    itens: [{
      nome_fantasia: 'Casa Vicenzo',
      cnpj: '11.111.111/0001-11',
      contatos: [{ nome: 'Bruno Reis', cargo: 'Financeiro', email: 'bruno@vicenzo.com.br' }]
    }]
  });
  try {
    const corpo = await (await aplicarEm(ctx, 'clientes')).json();
    assert.strictEqual(corpo.aplicados, 1, JSON.stringify(corpo.itens));

    const cliente = ctx.tabelas.clientes.find(c => c.id === 50);
    assert.strictEqual(cliente.site, 'vicenzo.com.br');
    assert.strictEqual(cliente.inscricao_estadual, '123456');
    assert.strictEqual(cliente.reg_logradouro, 'Rua das Flores');
    assert.strictEqual(cliente.reg_cep, '95700-000');
    assert.strictEqual(cliente.razao_social, 'Vicenzo Ltda');
  } finally {
    await ctx.encerrar();
  }
});

test('atualizar acrescenta o contato novo sem duplicar o que já existe', async () => {
  const ctx = await prepararClientes({
    itens: [{
      nome_fantasia: 'Casa Vicenzo',
      cnpj: '11.111.111/0001-11',
      contatos: [
        { nome: 'Ana Paula', cargo: 'Compras', email: 'ana@vicenzo.com.br' },
        { nome: 'Bruno Reis', cargo: 'Financeiro', email: 'bruno@vicenzo.com.br' }
      ]
    }]
  });
  try {
    await aplicarEm(ctx, 'clientes');

    const contatos = ctx.tabelas.contatos_cliente.filter(c => c.id_cliente === 50);
    // Ana já estava lá: aplicar a mesma lista duas vezes encheria a ficha de
    // linhas iguais.
    assert.strictEqual(contatos.length, 2, contatos.map(c => c.nome).join(', '));
    assert.ok(contatos.some(c => c.nome === 'Bruno Reis'));
    assert.strictEqual(contatos.filter(c => c.nome === 'Ana Paula').length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('CNPJ já cadastrado recusa o cadastro e diz o que fazer', async () => {
  const ctx = await prepararClientes({
    itens: [{ nome_fantasia: 'Outro Nome', cnpj: '11.111.111/0001-11' }]
  });
  try {
    // A reconciliação teria casado; forçamos "criar" para exercitar a trava,
    // que é a rede para quando o revisor muda a ação à mão.
    const item = itensDa(ctx, 5)[0];
    await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'criar' })
    });

    const corpo = await (await aplicarEm(ctx, 'clientes')).json();
    assert.strictEqual(corpo.com_erro, 1);
    assert.match(corpo.itens[0].mensagem, /Já existe um cliente com o CNPJ/);
    assert.strictEqual(ctx.tabelas.clientes.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('aplicar em Clientes exige a permissão de cadastrar cliente', async () => {
  const dados = permitir(baseEmpresas(), [
    'acao_view', 'acao_details_view', 'acao_extract', 'acao_apply_cli'
  ]);
  const ctx = await montarComIA(comLeitura(dados, 'clientes'), {}, {
    groq: () => ({ payload: respostaGroq(EMPRESA_NOVA) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const resp = await aplicarEm(ctx, 'clientes', 5, { usuario: 2 });
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(ctx.tabelas.clientes.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Aplicar em Prospecções
// ---------------------------------------------------------------------------

async function prepararProspeccoes(resposta = EMPRESA_NOVA, dados) {
  const ctx = await montarComIA(comLeitura(dados || baseEmpresas(), 'prospeccoes'), {}, {
    groq: () => ({ payload: respostaGroq(resposta) })
  });
  await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
  return ctx;
}

test('aplicar cadastra a prospecção na etapa Novo, com os contatos', async () => {
  const ctx = await prepararProspeccoes();
  try {
    const corpo = await (await aplicarEm(ctx, 'prospeccoes')).json();
    assert.strictEqual(corpo.aplicados, 1, JSON.stringify(corpo.itens));

    const nova = ctx.tabelas.prospeccoes.find(p => p.nome_fantasia === 'Decor Alpina');
    assert.ok(nova, 'a prospecção não foi cadastrada');
    assert.strictEqual(nova.etapa, 'Novo');
    assert.strictEqual(nova.end_logradouro, 'Rua das Videiras');
    assert.strictEqual(Number(nova.criado_por), 1);

    const contatos = ctx.tabelas.prospeccao_contatos.filter(c => c.prospeccao_id === nova.id);
    assert.strictEqual(contatos.length, 2);
  } finally {
    await ctx.encerrar();
  }
});

test('só o primeiro contato entra como principal', async () => {
  // Índice único parcial no banco: dois principais na mesma prospecção fazem
  // a gravação estourar.
  const ctx = await prepararProspeccoes();
  try {
    await aplicarEm(ctx, 'prospeccoes');
    const nova = ctx.tabelas.prospeccoes.find(p => p.nome_fantasia === 'Decor Alpina');
    const principais = ctx.tabelas.prospeccao_contatos
      .filter(c => c.prospeccao_id === nova.id && c.principal);
    assert.strictEqual(principais.length, 1);
    assert.strictEqual(principais[0].nome, 'Juliana Prass');
  } finally {
    await ctx.encerrar();
  }
});

test('a prospecção criada pela IA deixa rastro no histórico', async () => {
  const ctx = await prepararProspeccoes();
  try {
    await aplicarEm(ctx, 'prospeccoes');
    const nova = ctx.tabelas.prospeccoes.find(p => p.nome_fantasia === 'Decor Alpina');
    const historico = ctx.tabelas.prospeccao_historico.filter(h => h.prospeccao_id === nova.id);

    // Sem isto, uma prospecção apareceria no funil sem ninguém saber de onde
    // veio nem quando.
    assert.ok(historico.length >= 2, `só ${historico.length} linhas de histórico`);
    const criacao = historico.find(h => h.tipo === 'criacao');
    assert.ok(criacao, 'a criação não foi registrada');
    assert.match(String(criacao.observacao || ''), /Leitura de IA #5/);
  } finally {
    await ctx.encerrar();
  }
});

test('CNPJ com prospecção ATIVA recusa o cadastro e diz o que fazer', async () => {
  const ctx = await prepararProspeccoes({
    itens: [{ nome_fantasia: 'Serrana Outra Grafia', cnpj: '22.222.222/0001-22' }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'criar' })
    });

    const corpo = await (await aplicarEm(ctx, 'prospeccoes')).json();
    assert.strictEqual(corpo.com_erro, 1);
    assert.match(corpo.itens[0].mensagem, /prospecção ativa/i);
    assert.strictEqual(ctx.tabelas.prospeccoes.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('atualizar prospecção não a move no funil', async () => {
  // Mover no funil é decisão de quem vende, não de quem leu o documento.
  const ctx = await prepararProspeccoes({
    itens: [{
      nome_fantasia: 'Marcenaria Serrana',
      cnpj: '22.222.222/0001-22',
      site: 'serrana.com.br',
      contatos: [{ nome: 'Paula Nunes', cargo: 'Compras' }]
    }]
  });
  try {
    const corpo = await (await aplicarEm(ctx, 'prospeccoes')).json();
    assert.strictEqual(corpo.aplicados, 1, JSON.stringify(corpo.itens));

    const p = ctx.tabelas.prospeccoes.find(x => x.id === 30);
    assert.strictEqual(p.etapa, 'Proposta', 'a leitura mexeu na etapa do funil');
    assert.strictEqual(Number(p.probabilidade), 65);
    assert.strictEqual(p.site, 'serrana.com.br');
  } finally {
    await ctx.encerrar();
  }
});

test('contato acrescentado a prospecção existente nunca vira principal', async () => {
  // A prospecção já tem o principal dela, e o índice único parcial do banco
  // recusaria um segundo.
  const ctx = await prepararProspeccoes({
    itens: [{
      nome_fantasia: 'Marcenaria Serrana',
      cnpj: '22.222.222/0001-22',
      contatos: [{ nome: 'Paula Nunes' }]
    }]
  });
  try {
    await aplicarEm(ctx, 'prospeccoes');
    const contatos = ctx.tabelas.prospeccao_contatos.filter(c => c.prospeccao_id === 30);
    assert.strictEqual(contatos.length, 2);
    assert.strictEqual(contatos.filter(c => c.principal).length, 1);
    assert.strictEqual(contatos.find(c => c.nome === 'Paula Nunes').principal, false);
  } finally {
    await ctx.encerrar();
  }
});

test('aplicar em Prospecções exige a permissão de cadastrar prospecção', async () => {
  const dados = permitir(baseEmpresas(), [
    'acao_view', 'acao_details_view', 'acao_extract', 'acao_apply_pros'
  ]);
  const ctx = await montarComIA(comLeitura(dados, 'prospeccoes'), {}, {
    groq: () => ({ payload: respostaGroq(EMPRESA_NOVA) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const resp = await aplicarEm(ctx, 'prospeccoes', 5, { usuario: 2 });
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(ctx.tabelas.prospeccoes.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Revisão da sub-lista
// ---------------------------------------------------------------------------

test('o revisor pode reescrever a lista de contatos inteira', async () => {
  const ctx = await prepararClientes();
  try {
    const item = itensDa(ctx, 5)[0];
    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify({ dados: { contatos: [{ nome: 'Só Esta', cargo: 'Compras' }] } })
    })).json();

    assert.strictEqual(salvo.dados.contatos.length, 1);
    assert.strictEqual(salvo.dados.contatos[0].nome, 'Só Esta');
    // Os campos de fora da lista não podem ser afetados.
    assert.strictEqual(salvo.dados.nome_fantasia, 'Decor Alpina');
  } finally {
    await ctx.encerrar();
  }
});

test('contato sem nome também é recusado na correção do revisor', async () => {
  const ctx = await prepararClientes();
  try {
    const item = itensDa(ctx, 5)[0];
    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify({ dados: { contatos: [{ nome: 'Boa' }, { cargo: 'sem nome' }] } })
    })).json();

    // Mesma regra que vale para o modelo: linha sem os dados mínimos não vira
    // contato. O revisor não é exceção.
    assert.strictEqual(salvo.dados.contatos.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('o detalhe descreve os subcampos para a grade desenhar a sub-tabela', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'));
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/5')).json();
    const contatos = dados.campos.find(c => c.chave === 'contatos');

    assert.strictEqual(contatos.tipo, 'lista');
    assert.deepStrictEqual(
      contatos.subcampos.map(s => s.chave),
      ['nome', 'cargo', 'email', 'telefone_celular', 'telefone_fixo']
    );
    assert.strictEqual(contatos.subcampos[0].obrigatorio, true);
  } finally {
    await ctx.encerrar();
  }
});

test('os alvos de empresa vêm com o nome fantasia', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'));
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/5')).json();
    assert.deepStrictEqual(dados.alvos, [{ id: 50, nome: 'Casa Vicenzo', tabela: 'clientes' }]);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Unidade
// ---------------------------------------------------------------------------

test('somenteVindos deixa de fora o que o documento não trouxe', () => {
  const { somenteVindos } = require('./iaAplicacao');
  const saida = somenteVindos(
    { nome_fantasia: 'X', cnpj: null, site: '   ', end_cidade: 'Bento' },
    ['nome_fantasia', 'cnpj', 'site', 'end_cidade', 'razao_social']
  );
  // O que não veio nem aparece no payload — é o que impede o PUT de apagar.
  assert.deepStrictEqual(saida, { nome_fantasia: 'X', end_cidade: 'Bento' });
});

test('contatosInexistentes casa por e-mail e, na falta dele, por nome', () => {
  const { contatosInexistentes } = require('./iaAplicacao');
  const atuais = [
    { nome: 'Ana Paula', email: 'ana@x.com' },
    { nome: 'João Silva', email: null }
  ];

  const saida = contatosInexistentes([
    { nome: 'Ana P.', email: 'ANA@X.COM' },   // mesmo e-mail, nome diferente
    { nome: 'joão silva' },                   // sem e-mail, nome já existe
    { nome: 'Bruno', email: 'bruno@x.com' },  // novo
    { nome: 'Bruno Reis', email: 'bruno@x.com' } // repetido dentro do lote
  ], atuais);

  assert.deepStrictEqual(saida.map(c => c.nome), ['Bruno']);
});

test('todo destino aplicável tem esquema, e todo esquema tem aplicador', () => {
  const { DESTINOS_PRONTOS } = require('./iaEsquemas');
  const { DESTINOS_APLICAVEIS } = require('./iaAplicacao');
  // Um esquema sem aplicador deixaria a tela oferecer "Aplicar" num destino
  // que não sabe gravar; um aplicador sem esquema nunca receberia item.
  assert.deepStrictEqual(DESTINOS_PRONTOS.slice().sort(), DESTINOS_APLICAVEIS.slice().sort());
});


// ===========================================================================
// ETAPA 5 — insumos de produto (a ficha técnica)
//
// Destino diferente dos outros em duas coisas, e as duas são a razão de ele
// existir separado:
//
//   • NÃO CADASTRA. A ficha técnica diz de que o produto é feito, não quanto
//     ele custa nem em que coleção está.
//   • NÃO REMOVE. A ficha pode ser parcial; substituir a receita inteira por
//     ela apagaria em silêncio os insumos que o documento não citou, e o
//     produto passaria a custar menos do que custa.
// ===========================================================================

function baseFicha() {
  const dados = baseDados();
  // `unidade` e `processo` existem na matéria-prima de verdade, e são eles que
  // o formulário de produto usa para calcular custo e agrupar a tabela.
  dados.materia_prima = [
    { id: 70, nome: 'MDF 15mm Branco TX', quantidade: 100, preco_unitario: 180, unidade: 'CH', processo: 'MARCENARIA' },
    { id: 71, nome: 'Cola PVA extra 1kg', quantidade: 50, preco_unitario: 20, unidade: 'UN', processo: 'MARCENARIA' },
    { id: 72, nome: 'Fita de borda 22mm', quantidade: 900, preco_unitario: 1.3, unidade: 'M', processo: 'ACABAMENTO' }
  ];
  dados.materia_prima_movimentacoes = [];
  dados.categoria = [];
  dados.unidades = [{ id: 1, tipo: 'CH' }, { id: 2, tipo: 'UN' }, { id: 3, tipo: 'M' }];
  // Um insumo só casa dentro da etapa que a ficha declara — sem esta tabela a
  // restrição não teria contra o que conferir.
  dados.etapas_producao = [
    { id: 1, nome: 'MARCENARIA', ordem: 1 },
    { id: 2, nome: 'ACABAMENTO', ordem: 2 },
    { id: 3, nome: 'MONTAGEM', ordem: 3 },
    { id: 4, nome: 'EMBALAGEM', ordem: 4 }
  ];
  dados.produtos = [
    {
      id: 9, codigo: 'PR-210', nome: 'Painel Ripado 2,10', preco_base: 400, preco_venda: 900,
      pct_fabricacao: 10, pct_acabamento: 5, pct_montagem: 5, pct_embalagem: 2,
      pct_markup: 30, pct_comissao: 5, pct_imposto: 10
    },
    {
      id: 10, codigo: 'ML-01', nome: 'Mesa Lateral Carvalho', preco_base: 0, preco_venda: 0,
      pct_fabricacao: 0, pct_acabamento: 0, pct_montagem: 0, pct_embalagem: 0,
      pct_markup: 0, pct_comissao: 0, pct_imposto: 0
    }
  ];
  // O painel já tem UM insumo na ficha: é o que a leitura não pode apagar.
  dados.produtos_insumos = [{ id: 300, produto_id: 9, insumo_id: 71, quantidade: 0.5 }];
  return dados;
}

const FICHA_LIDA = {
  itens: [{
    codigo: 'PR-210',
    nome: 'Painel Ripado',
    insumos: [
      { nome: 'MDF 15mm Branco TX', quantidade: '2,5' },
      { nome: 'Fita de borda 22mm', quantidade: '6' }
    ]
  }]
};

async function prepararFicha(resposta = FICHA_LIDA, dados) {
  const ctx = await montarComIA(comLeitura(dados || baseFicha(), 'produto_insumos'), {}, {
    groq: () => ({ payload: respostaGroq(resposta) })
  });
  await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
  return ctx;
}

const insumosDoProduto = (ctx, produtoId) =>
  ctx.tabelas.produtos_insumos.filter(l => Number(l.produto_id) === produtoId);

// ---------------------------------------------------------------------------
// Reconciliação
// ---------------------------------------------------------------------------

test('o produto casa pelo código, mesmo com o nome escrito diferente', async () => {
  const ctx = await prepararFicha();
  try {
    const item = itensDa(ctx, 5)[0];
    // Código é identificador do catálogo; nome de produto varia ("2,10" e
    // "2,10m"). Casar pelo código não levanta dúvida.
    assert.strictEqual(item.acao, 'atualizar');
    assert.strictEqual(item.alvo_id, 9);
    assert.strictEqual(item.mensagem, null);
  } finally {
    await ctx.encerrar();
  }
});

test('ficha de peça NOVA vira cadastro, não descarte', async () => {
  const ctx = await prepararFicha({
    itens: [{ codigo: null, nome: 'Banqueta Alta', insumos: [{ nome: 'MDF 15mm Branco TX', quantidade: '1' }] }]
  });
  try {
    const item = itensDa(ctx, 5)[0];

    // A ficha técnica de uma peça que ainda não existe é o caso mais comum de
    // se querer ler: é para não digitar os 23 insumos à mão que o módulo
    // existe. Descartá-la fechava a porta para quem mais precisava dela.
    //
    // O que antes justificava o descarte — a ficha não tem preço, coleção nem
    // markup — deixou de valer quando a leitura passou a ABRIR O FORMULÁRIO em
    // vez de gravar: lá esses campos estão à vista de quem sabe respondê-los.
    assert.strictEqual(item.acao, 'criar');
    assert.strictEqual(item.alvo_id, null);
    assert.match(item.mensagem, /Produto NOVO/);
  } finally {
    await ctx.encerrar();
  }
});

test('o parecido entra como pista na mensagem, sem decidir', async () => {
  const ctx = await prepararFicha({
    itens: [{ codigo: null, nome: 'Mesa Lateral Carvalho Escuro', insumos: [{ nome: 'MDF 15mm Branco TX', quantidade: '1' }] }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    // A pista NÃO decide: "Mesa Lateral Carvalho Escuro" pode ser uma peça
    // nova da mesma linha, e casar sozinho sobrescreveria a ficha da outra.
    assert.strictEqual(item.acao, 'criar');
    assert.strictEqual(item.alvo_id, null);
    assert.match(item.mensagem, /Parecido com "Mesa Lateral Carvalho" \(#10\)/);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------

test('aplicar acrescenta os insumos que faltam na ficha', async () => {
  const ctx = await prepararFicha();
  try {
    const corpo = await (await aplicarEm(ctx, 'produto_insumos')).json();
    assert.strictEqual(corpo.aplicados, 1, JSON.stringify(corpo.itens));

    const ficha = insumosDoProduto(ctx, 9);
    assert.strictEqual(ficha.length, 3, ficha.map(l => l.insumo_id).join(','));
    assert.strictEqual(Number(ficha.find(l => l.insumo_id === 70).quantidade), 2.5);
    assert.strictEqual(Number(ficha.find(l => l.insumo_id === 72).quantidade), 6);
  } finally {
    await ctx.encerrar();
  }
});

test('o insumo que a ficha NÃO citou continua lá', async () => {
  // O caso que mais importa: uma ficha parcial não pode apagar a receita.
  const ctx = await prepararFicha();
  try {
    await aplicarEm(ctx, 'produto_insumos');

    const cola = insumosDoProduto(ctx, 9).find(l => Number(l.insumo_id) === 71);
    assert.ok(cola, 'a leitura apagou um insumo que o documento não citou');
    assert.strictEqual(Number(cola.quantidade), 0.5, 'a quantidade do insumo antigo mudou');
  } finally {
    await ctx.encerrar();
  }
});

test('a quantidade de um insumo que já estava na ficha é corrigida', async () => {
  const ctx = await prepararFicha({
    itens: [{ codigo: 'PR-210', nome: 'Painel', insumos: [{ nome: 'Cola PVA extra 1kg', quantidade: '0,8' }] }]
  });
  try {
    const corpo = await (await aplicarEm(ctx, 'produto_insumos')).json();
    assert.strictEqual(corpo.aplicados, 1, JSON.stringify(corpo.itens));

    const ficha = insumosDoProduto(ctx, 9);
    assert.strictEqual(ficha.length, 1, 'criou uma linha em vez de corrigir a existente');
    assert.strictEqual(Number(ficha[0].quantidade), 0.8);
  } finally {
    await ctx.encerrar();
  }
});

test('quantidade que não mudou não gera escrita', async () => {
  // A cola já está na ficha com 0,5 e o documento repete 0,5. Um PUT que não
  // muda nada só suja o log de alterações e gasta requisição.
  const ctx = await prepararFicha({
    itens: [{ codigo: 'PR-210', nome: 'Painel', insumos: [{ nome: 'Cola PVA extra 1kg', quantidade: '0,5' }] }]
  });
  try {
    const antes = ctx.chamadas.filter(c => c.metodo === 'PUT' && c.tabela === 'produtos_insumos').length;
    const corpo = await (await aplicarEm(ctx, 'produto_insumos')).json();
    const depois = ctx.chamadas.filter(c => c.metodo === 'PUT' && c.tabela === 'produtos_insumos').length;

    assert.strictEqual(corpo.aplicados, 1);
    assert.strictEqual(depois, antes, 'gravou uma quantidade que já era a mesma');
    assert.match(corpo.itens[0].mensagem, /já estava assim/i);
  } finally {
    await ctx.encerrar();
  }
});

test('insumo que não existe no estoque é pulado, com o nome no aviso', async () => {
  // Inventar o insumo encheria o estoque de linhas com preço zero. A linha é
  // pulada e o nome fica escrito, para cadastrar pelo caminho certo.
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel',
      insumos: [
        { nome: 'MDF 15mm Branco TX', quantidade: '2' },
        { nome: 'Verniz Fosco Premium', quantidade: '0,3' }
      ]
    }]
  });
  try {
    const corpo = await (await aplicarEm(ctx, 'produto_insumos')).json();
    assert.strictEqual(corpo.aplicados, 1);
    assert.match(corpo.itens[0].mensagem, /Verniz Fosco Premium/);
    assert.match(corpo.itens[0].mensagem, /não existe/i);

    // O insumo inventado não virou matéria-prima.
    assert.strictEqual(ctx.tabelas.materia_prima.length, 3);
    assert.strictEqual(insumosDoProduto(ctx, 9).length, 2);
  } finally {
    await ctx.encerrar();
  }
});

test('quando NENHUM insumo existe, o item vira erro', async () => {
  const ctx = await prepararFicha({
    itens: [{ codigo: 'PR-210', nome: 'Painel', insumos: [{ nome: 'Coisa Inventada', quantidade: '1' }] }]
  });
  try {
    const corpo = await (await aplicarEm(ctx, 'produto_insumos')).json();
    assert.strictEqual(corpo.com_erro, 1);
    assert.match(corpo.itens[0].mensagem, /Nenhum insumo desta linha existe no estoque/);
    assert.strictEqual(insumosDoProduto(ctx, 9).length, 1, 'a ficha original foi mexida');
  } finally {
    await ctx.encerrar();
  }
});

test('quantidade zero ou negativa não entra na ficha', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel',
      insumos: [
        { nome: 'MDF 15mm Branco TX', quantidade: '2' },
        { nome: 'Fita de borda 22mm', quantidade: '0' }
      ]
    }]
  });
  try {
    await aplicarEm(ctx, 'produto_insumos');
    // Insumo com quantidade zero na receita é linha morta que ainda entra no
    // cálculo de custo.
    assert.strictEqual(insumosDoProduto(ctx, 9).some(l => Number(l.insumo_id) === 72), false);
  } finally {
    await ctx.encerrar();
  }
});

test('mudar a receita recalcula o preço do produto', async () => {
  const ctx = await prepararFicha();
  try {
    const antes = Number(ctx.tabelas.produtos.find(p => p.id === 9).preco_base);
    await aplicarEm(ctx, 'produto_insumos');
    const depois = Number(ctx.tabelas.produtos.find(p => p.id === 9).preco_base);

    // 2,5 × 180 + 6 × 1,30 + 0,5 × 20 = 467,80. Sem o recálculo, o produto
    // continuaria com o custo da receita antiga.
    assert.notStrictEqual(depois, antes);
    assert.strictEqual(Math.round(depois * 100) / 100, 467.8);
  } finally {
    await ctx.encerrar();
  }
});

test('aplicar sem produto de destino não grava nada', async () => {
  const ctx = await prepararFicha({
    itens: [{ codigo: null, nome: 'Banqueta Alta', insumos: [{ nome: 'MDF 15mm Branco TX', quantidade: '1' }] }]
  });
  try {
    // A reconciliação marcou "ignorar". Forçamos "atualizar" sem alvo, que é o
    // que aconteceria se o revisor mexesse na ação sem escolher o produto.
    const item = itensDa(ctx, 5)[0];
    await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'atualizar' })
    });

    const corpo = await (await aplicarEm(ctx, 'produto_insumos')).json();
    assert.strictEqual(corpo.com_erro, 1);
    assert.match(corpo.itens[0].mensagem, /Sem produto de destino/);
  } finally {
    await ctx.encerrar();
  }
});

test('nenhum destino aceita id de alvo nulo como registro zero', async () => {
  // `Number(null)` é ZERO, e zero passa por finito. Sem a checagem, um item
  // sem destino escolhido gravaria apontando para o registro de id 0.
  const { idAlvo } = require('./iaAplicacao');
  for (const vazio of [null, undefined, '', 0, -1, 1.5, 'abc']) {
    assert.throws(
      () => idAlvo({ alvo_id: vazio }, 'produto'),
      /Sem produto de destino|Destino inválido/,
      `alvo_id ${JSON.stringify(vazio)} passou`
    );
  }
  assert.strictEqual(idAlvo({ alvo_id: 9 }, 'produto'), 9);
  assert.strictEqual(idAlvo({ alvo_id: '9' }, 'produto'), 9);
});

test('cadastrar produto pela ficha técnica é recusado com explicação', async () => {
  const ctx = await prepararFicha();
  try {
    const item = itensDa(ctx, 5)[0];
    await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'criar' })
    });

    const corpo = await (await aplicarEm(ctx, 'produto_insumos')).json();
    assert.strictEqual(corpo.com_erro, 1);
    assert.match(corpo.itens[0].mensagem, /não tem preço nem coleção/i);
    assert.strictEqual(ctx.tabelas.produtos.length, 2);
  } finally {
    await ctx.encerrar();
  }
});

test('aplicar de novo não duplica linha na ficha', async () => {
  const ctx = await prepararFicha();
  try {
    await aplicarEm(ctx, 'produto_insumos');
    const depoisDaPrimeira = insumosDoProduto(ctx, 9).length;

    // A leitura fica encerrada; repetir é recusado. E mesmo que não fosse, o
    // item já aplicado não seria gravado de novo.
    const segunda = await aplicarEm(ctx, 'produto_insumos');
    assert.strictEqual(segunda.status, 409);
    assert.strictEqual(insumosDoProduto(ctx, 9).length, depoisDaPrimeira);
  } finally {
    await ctx.encerrar();
  }
});

test('aplicar em Produtos exige a permissão de editar produto', async () => {
  const dados = permitir(baseFicha(), [
    'acao_view', 'acao_details_view', 'acao_extract', 'acao_apply_prod'
  ]);
  const ctx = await montarComIA(comLeitura(dados, 'produto_insumos'), {}, {
    groq: () => ({ payload: respostaGroq(FICHA_LIDA) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const resp = await aplicarEm(ctx, 'produto_insumos', 5, { usuario: 2 });
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(insumosDoProduto(ctx, 9).length, 1);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------

test('o destino de ficha técnica oferece cadastrar E apontar produto', async () => {
  const ctx = await montarComIA(comLeitura(baseFicha(), 'produto_insumos'));
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/5')).json();

    // Peça nova cadastra; peça que já existe recebe os insumos na ficha dela.
    assert.deepStrictEqual(dados.acoes, ['criar', 'atualizar', 'ignorar']);
    assert.strictEqual(dados.exige_alvo, false);
    assert.strictEqual(dados.pode_aplicar_destino, true);
    // O seletor de produto continua existindo: é ele que aponta a ficha certa
    // quando a peça JÁ está no catálogo.
    assert.deepStrictEqual(dados.alvos.map(a => a.nome).sort(),
      ['Mesa Lateral Carvalho', 'Painel Ripado 2,10']);
  } finally {
    await ctx.encerrar();
  }
});

test('os outros destinos NÃO exigem alvo', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'));
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/5')).json();
    assert.strictEqual(dados.exige_alvo, false);
  } finally {
    await ctx.encerrar();
  }
});

test('a sub-lista de insumos é obrigatória no esquema', () => {
  const { obterEsquema } = require('./iaEsquemas');
  const campo = obterEsquema('produto_insumos').campos.find(c => c.chave === 'insumos');
  // Um produto sem nenhum insumo não é ficha técnica nenhuma.
  assert.strictEqual(campo.obrigatorio, true);

  // `processo` e `unidade` não são enfeite: a ficha é escrita em blocos de
  // etapa ("MARCENARIA", "ACABAMENTO") e a quantidade vem com a unidade entre
  // parênteses — "0,07 (m2)". Sem esses dois campos a leitura devolvia uma
  // lista achatada de 23 nomes e números soltos, que é justamente o que o
  // usuário NÃO consegue conferir contra o papel que tem na mão.
  assert.deepStrictEqual(campo.subcampos.map(s => s.chave),
    ['processo', 'nome', 'quantidade', 'unidade']);

  // Só nome e quantidade derrubam o insumo: uma ficha sem título de etapa
  // continua sendo uma ficha.
  assert.deepStrictEqual(campo.subcampos.filter(s => s.obrigatorio).map(s => s.chave),
    ['nome', 'quantidade']);
});

test('a ordem dos insumos do documento é preservada', async () => {
  // A ordem é a SEQUÊNCIA DE PRODUÇÃO. Reordenar (por nome, por processo, por
  // qualquer coisa) descaracteriza a ficha: quem monta a peça lê de cima para
  // baixo.
  const ctx = await prepararFicha({
    itens: [{
      codigo: null, nome: 'Bandeja Vero PP',
      insumos: [
        { processo: 'MARCENARIA', nome: 'MDF 06', quantidade: '0,07', unidade: 'm2' },
        { processo: 'MARCENARIA', nome: 'Cola Branca', quantidade: '33,5', unidade: 'ml' },
        { processo: 'ACABAMENTO', nome: 'Wash Primer', quantidade: '1', unidade: 'ml' },
        { processo: 'EMBALAGEM', nome: 'Caixa No6', quantidade: '1', unidade: null }
      ]
    }]
  });
  try {
    const insumos = JSON.parse(itensDa(ctx, 5)[0].dados).insumos;
    assert.deepStrictEqual(insumos.map(i => i.nome),
      ['MDF 06', 'Cola Branca', 'Wash Primer', 'Caixa No6']);
    assert.deepStrictEqual(insumos.map(i => i.processo),
      ['MARCENARIA', 'MARCENARIA', 'ACABAMENTO', 'EMBALAGEM']);
    // A unidade vem junto: "0,07" sem "m2" não diz nada a quem confere.
    assert.strictEqual(insumos[0].unidade, 'm2');
    assert.strictEqual(insumos[0].quantidade, 0.07);
    // Insumo sem unidade no documento não é problema: fica vazio.
    assert.strictEqual(insumos[3].unidade, null);
  } finally {
    await ctx.encerrar();
  }
});


// ===========================================================================
// ETAPA 6 — orçamentos
//
// O destino que obrigou a separar duas ideias que até aqui andavam juntas: o
// ALVO e o registro que muda. Aqui o alvo é o CLIENTE, e o que se cria é um
// orçamento novo pendurado nele.
//
// E a regra que o diferencia da ficha técnica: ou entra inteiro, ou não entra.
// Uma receita incompleta continua utilizável; um orçamento incompleto é um
// PREÇO ERRADO que parece completo e vai para o cliente.
// ===========================================================================

function baseOrcamento() {
  const dados = baseDados();
  dados.clientes = [
    { id: 50, nome_fantasia: 'Casa Vicenzo', razao_social: 'Vicenzo Ltda', cnpj: '11.111.111/0001-11' },
    { id: 51, nome_fantasia: 'Decor Alpina', cnpj: null }
  ];
  dados.contatos_cliente = [];
  // O orçamento procura nas DUAS tabelas: a empresa lida tanto pode ser um
  // cliente quanto uma prospecção, e o documento não diz qual.
  dados.prospeccoes = [
    { id: 30, nome_fantasia: 'Marcenaria Serrana', cnpj: '22.222.222/0001-22', etapa: 'Proposta', status: 'ativa' }
  ];
  dados.prospeccao_contatos = [];
  dados.prospeccao_historico = [];
  dados.produtos = [
    { id: 9, codigo: 'PR-210', nome: 'Painel Ripado 2,10', preco_venda: 900, ncm: '9403' },
    { id: 10, codigo: 'ML-01', nome: 'Mesa Lateral Carvalho', preco_venda: 450, ncm: '9403' },
    // Peça sem linha na tabela fixa: existe no catálogo, mas não tem preço
    // praticado — e por isso não se vende.
    { id: 11, codigo: 'BV-01', nome: 'Bandeja Vero PP', preco_venda: 300, ncm: '9403' }
  ];
  // O praticado difere do calculado de propósito: um teste em que os dois
  // valem o mesmo passa mesmo lendo o campo errado. E o separador de milhar
  // está aí porque é assim que o valor volta do banco.
  dados.tabela_fixa = [
    { id: 1, id_prod: 9, cod_prod: 'PR-210', vlr_prod: '1.250,00' },
    { id: 2, id_prod: 10, cod_prod: 'ML-01', vlr_prod: '450' }
  ];
  dados.produtos_insumos = [];
  dados.orcamentos = [];
  dados.orcamentos_itens = [];
  dados.orcamento_parcelas = [];
  return dados;
}

const PEDIDO_LIDO = {
  itens: [{
    cliente: 'Casa Vicenzo',
    cnpj: '11.111.111/0001-11',
    validade: '30/09/2026',
    prazo: '30 dias',
    forma_pagamento: 'Boleto 30/60',
    observacoes: 'Entregar na obra',
    itens: [
      { codigo: 'PR-210', nome: 'Painel Ripado', quantidade: '3', valor_unitario: '850,00' },
      { codigo: null, nome: 'Mesa Lateral Carvalho', quantidade: '2', valor_unitario: null }
    ]
  }]
};

async function prepararOrcamento(resposta = PEDIDO_LIDO, dados) {
  const ctx = await montarComIA(comLeitura(dados || baseOrcamento(), 'orcamentos'), {}, {
    groq: () => ({ payload: respostaGroq(resposta) })
  });
  await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
  return ctx;
}

const itensDoOrcamento = (ctx, orcamentoId) =>
  ctx.tabelas.orcamentos_itens.filter(i => Number(i.orcamento_id) === orcamentoId);

// ---------------------------------------------------------------------------
// Reconciliação: o alvo é o CLIENTE
// ---------------------------------------------------------------------------

test('a empresa casa pela RAZÃO SOCIAL quando o pedido traz os dois nomes', async () => {
  // Um pedido de verdade traz "Nome Fantasia: Casa Vicenzo" e "Razão Social:
  // Lavoro e Decorazione Ltda", nessa ordem. Procurando só por nome fantasia,
  // o pedido caía como "empresa não encontrada" sempre que o cadastro tinha
  // sido feito pela razão social — e o usuário via "Descartar" numa linha cujo
  // cliente estava, sim, no sistema.
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Lavoro e Decorazione Comércio de Decoração Ltda',
      razao_social: 'Vicenzo Ltda',
      cnpj: null, validade: null, prazo: '30/60/90', forma_pagamento: 'pix', observacoes: null,
      itens: [{ codigo: 'P-100', nome: 'Painel Ripado 2,10', quantidade: '3', valor_unitario: null }]
    }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    assert.strictEqual(item.acao, 'criar');
    assert.strictEqual(item.alvo_id, 50);
    assert.strictEqual(item.alvo_tabela, 'clientes');
  } finally {
    await ctx.encerrar();
  }
});

test('a empresa casa mesmo com a razão social escrita no campo do nome', async () => {
  // O modelo lê de cima para baixo e nem sempre acerta qual nome é qual. Isso
  // não pode custar o casamento: os dois nomes são procurados nas duas colunas.
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Vicenzo Ltda', razao_social: null,
      cnpj: null, validade: null, prazo: null, forma_pagamento: null, observacoes: null,
      itens: [{ codigo: 'P-100', nome: 'Painel Ripado 2,10', quantidade: '1', valor_unitario: null }]
    }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    assert.strictEqual(item.alvo_id, 50);
  } finally {
    await ctx.encerrar();
  }
});

test('o CNPJ continua mandando mais que qualquer nome', async () => {
  // Nome é apelido; CNPJ é identidade. Se os dois apontarem para lados
  // diferentes, quem decide é o CNPJ — e sem ressalva.
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Decor Alpina', razao_social: 'Decor Alpina Ltda',
      cnpj: '11.111.111/0001-11', validade: null, prazo: null, forma_pagamento: null, observacoes: null,
      itens: [{ codigo: 'P-100', nome: 'Painel Ripado 2,10', quantidade: '1', valor_unitario: null }]
    }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    assert.strictEqual(item.alvo_id, 50, 'o CNPJ perdeu para o nome');
    assert.strictEqual(item.mensagem, null, 'casamento por CNPJ não precisa de ressalva');
  } finally {
    await ctx.encerrar();
  }
});

test('o cliente casa pelo CNPJ e a ação proposta é CRIAR', async () => {
  const ctx = await prepararOrcamento();
  try {
    const item = itensDa(ctx, 5)[0];

    // Diferente de todos os outros destinos: casar não quer dizer "atualizar".
    // O alvo é o cliente; o que se cria é um orçamento novo preso a ele.
    assert.strictEqual(item.acao, 'criar');
    assert.strictEqual(item.alvo_id, 50);
    assert.strictEqual(item.alvo_tabela, 'clientes');
    assert.strictEqual(item.mensagem, null);
  } finally {
    await ctx.encerrar();
  }
});

test('o campo lido "cliente" casa com a coluna nome_fantasia', async () => {
  // Primeira vez em que o item e a tabela chamam a mesma coisa por nomes
  // diferentes: sem `colunaAlvo`, a comparação seria contra uma coluna que
  // não existe e nada casaria.
  const ctx = await prepararOrcamento({
    itens: [{ cliente: 'Decor Alpina', cnpj: null, itens: [{ nome: 'Painel Ripado 2,10', quantidade: '1' }] }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    assert.strictEqual(item.alvo_id, 51);
    assert.match(item.mensagem, /Casou por Empresa/);
  } finally {
    await ctx.encerrar();
  }
});

test('cliente que não existe não vira orçamento solto', async () => {
  const ctx = await prepararOrcamento({
    itens: [{ cliente: 'Empresa Desconhecida', cnpj: null, itens: [{ nome: 'Painel Ripado 2,10', quantidade: '1' }] }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    assert.strictEqual(item.acao, 'ignorar');
    assert.match(item.mensagem, /Empresa não encontrada em Clientes nem em Prospecções/);
    // E manda para o caminho certo de cadastrá-la.
    assert.match(item.mensagem, /Clientes e contatos/);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------

test('aplicar cria o orçamento pendente com os itens', async () => {
  const ctx = await prepararOrcamento();
  try {
    const corpo = await (await aplicarEm(ctx, 'orcamentos')).json();
    assert.strictEqual(corpo.aplicados, 1, JSON.stringify(corpo.itens));

    const orc = ctx.tabelas.orcamentos[0];
    assert.ok(orc, 'o orçamento não foi criado');
    assert.strictEqual(Number(orc.cliente_id), 50);
    // Aprovar dispara conversão em pedido, que abate estoque: decisão de
    // gente, não de leitura de documento.
    assert.strictEqual(orc.situacao, 'Pendente');
    assert.match(String(orc.numero), /^ORC\d+$/);

    const itens = itensDoOrcamento(ctx, orc.id);
    assert.strictEqual(itens.length, 2);
    assert.strictEqual(Number(itens[0].produto_id), 9);
    assert.strictEqual(Number(itens[0].quantidade), 3);
    assert.strictEqual(Number(itens[0].valor_unitario), 850);
    assert.strictEqual(Number(itens[0].valor_total), 2550);
  } finally {
    await ctx.encerrar();
  }
});

test('item sem preço no documento usa o preço de tabela, e avisa', async () => {
  const ctx = await prepararOrcamento();
  try {
    const corpo = await (await aplicarEm(ctx, 'orcamentos')).json();

    const orc = ctx.tabelas.orcamentos[0];
    const mesa = itensDoOrcamento(ctx, orc.id).find(i => Number(i.produto_id) === 10);
    // Um pedido de compra costuma listar o que se quer, não quanto custa.
    assert.strictEqual(Number(mesa.valor_unitario), 450);
    assert.strictEqual(Number(mesa.valor_total), 900);
    assert.match(corpo.itens[0].mensagem, /preço de tabela/i);
    assert.match(corpo.itens[0].mensagem, /Mesa Lateral Carvalho/);
  } finally {
    await ctx.encerrar();
  }
});

test('o total do orçamento é a soma dos itens', async () => {
  const ctx = await prepararOrcamento();
  try {
    await aplicarEm(ctx, 'orcamentos');
    // 3 × 850 + 2 × 450 = 3450
    assert.strictEqual(Number(ctx.tabelas.orcamentos[0].valor_final), 3450);
  } finally {
    await ctx.encerrar();
  }
});

test('produto fora do catálogo NÃO gera orçamento pela metade', async () => {
  // A diferença que separa este destino da ficha técnica: um orçamento
  // incompleto é um PREÇO ERRADO, e ele parece completo.
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Casa Vicenzo', cnpj: '11.111.111/0001-11',
      itens: [
        { nome: 'Painel Ripado 2,10', quantidade: '2' },
        { nome: 'Banqueta Que Nao Existe', quantidade: '4' }
      ]
    }]
  });
  try {
    const corpo = await (await aplicarEm(ctx, 'orcamentos')).json();
    assert.strictEqual(corpo.com_erro, 1);
    assert.match(corpo.itens[0].mensagem, /Banqueta Que Nao Existe/);
    assert.match(corpo.itens[0].mensagem, /Nada foi gravado/i);

    // Nada entrou: aplicar de novo depois de corrigir é seguro.
    assert.strictEqual(ctx.tabelas.orcamentos.length, 0);
    assert.strictEqual(ctx.tabelas.orcamentos_itens.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('a numeração do orçamento continua de onde parou', async () => {
  const dados = baseOrcamento();
  dados.orcamentos.push({ id: 1, numero: 'ORC77', cliente_id: 50, situacao: 'Pendente' });
  const ctx = await prepararOrcamento(PEDIDO_LIDO, dados);
  try {
    await aplicarEm(ctx, 'orcamentos');
    const novo = ctx.tabelas.orcamentos.find(o => o.id !== 1);
    // A geração de número é a do próprio módulo de Orçamentos, com a
    // retentativa em cima da constraint única.
    assert.strictEqual(novo.numero, 'ORC78');
  } finally {
    await ctx.encerrar();
  }
});

test('o orçamento nasce com dono e com a procedência anotada', async () => {
  const ctx = await prepararOrcamento();
  try {
    await aplicarEm(ctx, 'orcamentos');
    const orc = ctx.tabelas.orcamentos[0];

    // Sem dono, o orçamento aparece sem responsável na tela.
    assert.strictEqual(orc.dono, 'Henrique');
    // E a observação diz de onde ele veio.
    assert.match(String(orc.observacoes), /Leitura de IA #5/);
    assert.match(String(orc.observacoes), /Entregar na obra/);
  } finally {
    await ctx.encerrar();
  }
});

test('a data lida em dd/mm/aaaa vira ISO na validade', async () => {
  const ctx = await prepararOrcamento();
  try {
    await aplicarEm(ctx, 'orcamentos');
    assert.strictEqual(ctx.tabelas.orcamentos[0].validade, '2026-09-30');
  } finally {
    await ctx.encerrar();
  }
});

test('atualizar não é oferecido: a leitura não mexe em orçamento existente', async () => {
  const ctx = await prepararOrcamento();
  try {
    const item = itensDa(ctx, 5)[0];
    await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'atualizar' })
    });

    const corpo = await (await aplicarEm(ctx, 'orcamentos')).json();
    assert.strictEqual(corpo.com_erro, 1);
    assert.match(corpo.itens[0].mensagem, /só cria orçamento novo/i);
    assert.strictEqual(ctx.tabelas.orcamentos.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('sem cliente escolhido, nada é gravado', async () => {
  const ctx = await prepararOrcamento({
    itens: [{ cliente: 'Empresa Desconhecida', cnpj: null, itens: [{ nome: 'Painel Ripado 2,10', quantidade: '1' }] }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'criar' })
    });

    const corpo = await (await aplicarEm(ctx, 'orcamentos')).json();
    assert.strictEqual(corpo.com_erro, 1);
    assert.match(corpo.itens[0].mensagem, /Sem cliente ou prospecção de destino/);
    assert.strictEqual(ctx.tabelas.orcamentos.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('escolher "cadastrar" NÃO solta o cliente quando o alvo é vínculo', async () => {
  // Nos outros destinos, trocar para "cadastrar" solta o alvo. Aqui isso
  // deixaria o orçamento sem cliente justo na ação em que ele mais precisa.
  const ctx = await prepararOrcamento();
  try {
    const item = itensDa(ctx, 5)[0];
    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'criar' })
    })).json();

    assert.strictEqual(salvo.acao, 'criar');
    assert.strictEqual(salvo.alvo_id, 50, 'o cliente foi solto ao escolher cadastrar');
  } finally {
    await ctx.encerrar();
  }
});

test('escolher "descartar" solta o alvo mesmo sendo vínculo', async () => {
  const ctx = await prepararOrcamento();
  try {
    const item = itensDa(ctx, 5)[0];
    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'ignorar' })
    })).json();

    assert.strictEqual(salvo.alvo_id, null);
  } finally {
    await ctx.encerrar();
  }
});

test('apontar o cliente já define a ação como CRIAR', async () => {
  const ctx = await prepararOrcamento({
    itens: [{ cliente: 'Empresa Desconhecida', cnpj: null, itens: [{ nome: 'Painel Ripado 2,10', quantidade: '1' }] }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ alvo_id: 51 })
    })).json();

    // Nos outros destinos, apontar significa "atualizar". Aqui, "criar".
    assert.strictEqual(salvo.acao, 'criar');
    assert.strictEqual(salvo.alvo_id, 51);
  } finally {
    await ctx.encerrar();
  }
});

test('aplicar em Orçamentos exige a permissão de criar orçamento', async () => {
  const dados = permitir(baseOrcamento(), [
    'acao_view', 'acao_details_view', 'acao_extract', 'acao_apply_orc'
  ]);
  const ctx = await montarComIA(comLeitura(dados, 'orcamentos'), {}, {
    groq: () => ({ payload: respostaGroq(PEDIDO_LIDO) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const resp = await aplicarEm(ctx, 'orcamentos', 5, { usuario: 2 });
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(ctx.tabelas.orcamentos.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------

test('o detalhe conta que o alvo é vínculo e quais ações valem', async () => {
  const ctx = await montarComIA(comLeitura(baseOrcamento(), 'orcamentos'));
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/5')).json();

    assert.strictEqual(dados.alvo_eh_vinculo, true);
    assert.strictEqual(dados.exige_alvo, true);
    assert.strictEqual(dados.rotulo_alvo, 'Cliente ou prospecção');
    assert.deepStrictEqual(dados.acoes, ['criar', 'ignorar']);

    // Os alvos são CLIENTES e PROSPECÇÕES, não orçamentos. E vêm com o tipo no
    // nome: a mesma empresa pode estar nas duas listas, e escolher a errada
    // criaria o orçamento na série errada.
    assert.deepStrictEqual(dados.alvos.map(a => a.nome).sort(),
      ['Casa Vicenzo (Cliente)', 'Decor Alpina (Cliente)', 'Marcenaria Serrana (Prospecção)']);
    assert.strictEqual(dados.alvos.find(a => /Serrana/.test(a.nome)).tabela, 'prospeccoes');
  } finally {
    await ctx.encerrar();
  }
});

test('os destinos comuns continuam oferecendo as três ações', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'));
  try {
    const dados = await (await chamar(ctx.porta, '/api/ia/5')).json();
    assert.deepStrictEqual(dados.acoes, ['criar', 'atualizar', 'ignorar']);
    assert.strictEqual(dados.alvo_eh_vinculo, false);
  } finally {
    await ctx.encerrar();
  }
});

test('a empresa que é PROSPECÇÃO casa e gera OCRP', async () => {
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Marcenaria Serrana', cnpj: '22.222.222/0001-22',
      itens: [{ nome: 'Painel Ripado 2,10', quantidade: '2' }]
    }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    assert.strictEqual(item.alvo_id, 30);
    assert.strictEqual(item.alvo_tabela, 'prospeccoes', 'casou na tabela errada');

    const corpo = await (await aplicarEm(ctx, 'orcamentos')).json();
    assert.strictEqual(corpo.aplicados, 1, JSON.stringify(corpo.itens));

    const orc = ctx.tabelas.orcamentos[0];
    // Série OCRP e vínculo pela prospecção: mandar o id no campo `cliente_id`
    // prenderia o orçamento ao CLIENTE de mesmo número, outra empresa.
    assert.match(String(orc.numero), /^OCRP\d+$/);
    assert.strictEqual(Number(orc.prospeccao_id), 30);
    assert.strictEqual(orc.cliente_id, null);
    assert.match(corpo.itens[0].mensagem, /para a prospecção/);
  } finally {
    await ctx.encerrar();
  }
});

test('o cliente tem precedência sobre a prospecção de mesmo nome', async () => {
  // A prospecção que virou cliente continua na tabela de prospecções. Sem uma
  // ordem definida, o orçamento cairia ora num lado ora no outro.
  const dados = baseOrcamento();
  dados.prospeccoes.push({ id: 31, nome_fantasia: 'Casa Vicenzo', cnpj: null, status: 'ativa' });
  const ctx = await prepararOrcamento({
    itens: [{ cliente: 'Casa Vicenzo', cnpj: null, itens: [{ nome: 'Painel Ripado 2,10', quantidade: '1' }] }]
  }, dados);
  try {
    const item = itensDa(ctx, 5)[0];
    assert.strictEqual(item.alvo_tabela, 'clientes');
    assert.strictEqual(item.alvo_id, 50);
  } finally {
    await ctx.encerrar();
  }
});

test('escolher a prospecção à mão exige dizer de qual tabela', async () => {
  const ctx = await prepararOrcamento({
    itens: [{ cliente: 'Empresa Desconhecida', cnpj: null, itens: [{ nome: 'Painel Ripado 2,10', quantidade: '1' }] }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ alvo_id: 30, alvo_tabela: 'prospeccoes' })
    })).json();

    assert.strictEqual(salvo.alvo_id, 30);
    assert.strictEqual(salvo.alvo_tabela, 'prospeccoes');
    assert.strictEqual(salvo.acao, 'criar');
  } finally {
    await ctx.encerrar();
  }
});

test('tabela de alvo que não é deste destino é recusada', async () => {
  // Sem a checagem, apontar para uma tabela qualquer criaria o orçamento com
  // um vínculo que não existe.
  const ctx = await prepararOrcamento();
  try {
    const item = itensDa(ctx, 5)[0];
    const resp = await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ alvo_id: 9, alvo_tabela: 'produtos' })
    });
    assert.strictEqual(resp.status, 400);
    assert.match((await resp.json()).error, /não é um alvo deste tipo/i);
  } finally {
    await ctx.encerrar();
  }
});

test('sem dizer a tabela, vale a primeira do destino', async () => {
  const ctx = await prepararOrcamento({
    itens: [{ cliente: 'Empresa Desconhecida', cnpj: null, itens: [{ nome: 'Painel Ripado 2,10', quantidade: '1' }] }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ alvo_id: 51 })
    })).json();
    assert.strictEqual(salvo.alvo_tabela, 'clientes');
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// As três tentativas contra a recusa de JSON da Groq
// ---------------------------------------------------------------------------

/** Recusa da Groq com o texto que o modelo chegou a gerar. */
const recusaDeJson = gerado => ({
  status: 400,
  payload: {
    error: {
      message: "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
      type: 'invalid_request_error',
      code: 'json_validate_failed',
      failed_generation: gerado
    }
  }
});

test('a extração pede um teto de saída ao modelo', async () => {
  // Sem teto, a Groq corta a geração antes do fim de uma lista longa — e o
  // JSON cortado é recusado pelo modo estrito, derrubando a extração inteira.
  const ctx = await montarComIA(baseParaEstruturar(), {}, { groq: () => ({ payload: respostaGroq(ITENS_LIDOS) }) });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    assert.ok(ctx.groq.chamadas[0].body.max_tokens >= 4000,
      `max_tokens veio ${ctx.groq.chamadas[0].body.max_tokens}`);
  } finally {
    await ctx.encerrar();
  }
});

test('JSON cortado devolvido na recusa é aproveitado, sem repetir o mesmo pedido', async () => {
  // A própria Groq devolve o que o modelo gerou. Fechá-lo sai de graça; pedir
  // tudo de novo custa outra chamada paga.
  const cortado = '{"itens": [{"nome": "MDF 15mm Branco TX", "quantidade": 40}, {"nome": "Fita';
  const ctx = await montarComIA(baseParaEstruturar(), {}, { groq: () => recusaDeJson(cortado) });
  try {
    const corpo = await (await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' })).json();

    assert.strictEqual(corpo.status, 'revisao');
    assert.ok(corpo.itens_qtd >= 1, 'o item completo antes do corte foi perdido');

    // Depois de aproveitar o pedaço, o texto é fatiado para buscar o resto —
    // é esse o conserto. O que continua proibido é gastar uma chamada
    // repetindo EXATAMENTE o mesmo pedido, que já se sabe que não cabe.
    const pedidos = ctx.groq.chamadas.map(c => c.body.messages[1].content);
    assert.strictEqual(new Set(pedidos).size, pedidos.length,
      'repetiu um pedido idêntico, que já se sabia que não cabia');
  } finally {
    await ctx.encerrar();
  }
});

test('recusa sem nada aproveitável cai para uma chamada sem modo estrito', async () => {
  let chamada = 0;
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => {
      chamada += 1;
      // A primeira recusa não traz geração aproveitável; a segunda, solta,
      // devolve o JSON no corpo do texto.
      return chamada === 1
        ? recusaDeJson('desculpe, não consegui')
        : { payload: respostaGroq('Segue o resultado:\n```json\n' + JSON.stringify(ITENS_LIDOS) + '\n```') };
    }
  });
  try {
    const corpo = await (await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' })).json();
    assert.strictEqual(corpo.itens_qtd, 2);
    assert.strictEqual(ctx.groq.chamadas.length, 2);

    // A segunda tentativa vai SEM o modo estrito: é justamente ele que estava
    // recusando.
    assert.ok(ctx.groq.chamadas[0].body.response_format, 'a primeira devia ser estrita');
    assert.strictEqual(ctx.groq.chamadas[1].body.response_format, undefined);
  } finally {
    await ctx.encerrar();
  }
});

test('quando as duas tentativas falham, a mensagem diz o que fazer', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => recusaDeJson('nada de útil')
  });
  try {
    const resp = await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    assert.ok(resp.status >= 400);

    const extracao = ctx.tabelas.ia_extracoes.find(e => e.id === 4);
    assert.strictEqual(extracao.status, 'erro');
    // A mensagem crua da Groq ("Failed to validate JSON. Please adjust your
    // prompt") não diz nada a quem está usando o programa.
    assert.strictEqual(/adjust your prompt/i.test(extracao.erro), false);
    assert.match(extracao.erro, /troque o modelo em Configurar|não é JSON/i);
  } finally {
    await ctx.encerrar();
  }
});

test('erro que NÃO é de JSON não gera segunda chamada', async () => {
  // Chave recusada não melhora tentando de outro jeito: insistir só gastaria
  // outra requisição e atrasaria a mensagem certa.
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({ status: 401, payload: { error: { message: 'Invalid API Key' } } })
  });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    assert.strictEqual(ctx.groq.chamadas.length, 1);
    assert.match(ctx.tabelas.ia_extracoes.find(e => e.id === 4).erro, /chave recusada/i);
  } finally {
    await ctx.encerrar();
  }
});

test('fecharJsonCortado aproveita o que veio inteiro e descarta o resto', () => {
  const { fecharJsonCortado } = require('./iaEstruturacao');

  assert.deepStrictEqual(
    fecharJsonCortado('{"itens": [{"a": 1}, {"b": 2}, {"c": '),
    { itens: [{ a: 1 }, { b: 2 }] }
  );
  assert.deepStrictEqual(fecharJsonCortado('{"itens": [{"a": 1}'), { itens: [{ a: 1 }] });
  // JSON completo não é assunto desta função.
  assert.strictEqual(fecharJsonCortado('{"itens": []}'), null);
  // Sem nada aproveitável, melhor dizer que não deu.
  assert.strictEqual(fecharJsonCortado('texto solto'), null);
});

test('todos os cinco destinos estão prontos', () => {
  const { DESTINOS_PRONTOS } = require('./iaEsquemas');
  const { DESTINOS_APLICAVEIS } = require('./iaAplicacao');
  const { DESTINOS } = require('./iaController');

  const doModulo = DESTINOS.map(d => d.id).sort();
  assert.deepStrictEqual(DESTINOS_PRONTOS.slice().sort(), doModulo);
  assert.deepStrictEqual(DESTINOS_APLICAVEIS.slice().sort(), doModulo);
});


// ===========================================================================
// ETAPA 8 — ABRIR O MODAL PREENCHIDO
//
// A leitura deixou de gravar. Ela prepara o formulário que a pessoa já conhece
// e devolve o controle: quem confere, corrige e salva é o usuário, no módulo de
// destino, com a validação daquele módulo valendo.
//
// O que estes testes protegem é a FIDELIDADE do que chega ao formulário. Um
// preenchimento incompleto é pior do que nenhum: o formulário abre parecendo
// pronto, a pessoa confere por cima, salva — e o que faltou não deixa rastro.
// ===========================================================================

const carga = (ctx, extracaoId, itemId) =>
  chamar(ctx.porta, `/api/ia/${extracaoId}/itens/${itemId}/preenchimento`).then(r => r.json());

test('a ficha técnica chega ao formulário com processo, ordem e custo', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: null, nome: 'Bandeja Vero PP',
      insumos: [
        { processo: 'MARCENARIA', nome: 'MDF 15mm Branco TX', quantidade: '0,07', unidade: 'm2' },
        { processo: 'MARCENARIA', nome: 'Cola PVA extra 1kg', quantidade: '33,5', unidade: 'ml' },
        { processo: 'ACABAMENTO', nome: 'Fita de borda 22mm', quantidade: '1', unidade: null }
      ]
    }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    const r = await carga(ctx, 5, item.id);

    assert.strictEqual(r.modal.overlay, 'novoProduto');
    assert.strictEqual(r.campos.nome, 'Bandeja Vero PP');
    assert.strictEqual(r.insumos.length, 3);

    // O `insumo_id` é a razão de esta rota existir: sem ele o formulário teria
    // um nome escrito e nenhum vínculo com o cadastro.
    assert.strictEqual(r.insumos[0].insumo_id, 70);
    // Preço e unidade vêm do CADASTRO — são eles que fazem o custo bater.
    assert.strictEqual(r.insumos[0].preco_unitario, 180);
    assert.strictEqual(r.insumos[0].unidade, 'CH');

    // O processo é o que agrupa a tabela do produto. Sem ele os 23 insumos
    // caíam num monte só, que não se parece com o papel que a pessoa tem.
    assert.deepStrictEqual(r.insumos.map(i => i.processo),
      ['MARCENARIA', 'MARCENARIA', 'ACABAMENTO']);
    // E a ordem é a sequência de produção, lida de cima para baixo.
    assert.deepStrictEqual(r.insumos.map(i => i.ordem), [1, 2, 3]);
  } finally {
    await ctx.encerrar();
  }
});

test('insumo fora da matéria-prima não entra — e o nome dele é dito', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: null, nome: 'Bandeja Vero PP',
      insumos: [
        { processo: 'MARCENARIA', nome: 'MDF 15mm Branco TX', quantidade: '1', unidade: 'CH' },
        { processo: 'MONTAGEM', nome: 'Couro Serpente Amêndoa', quantidade: '0,04', unidade: 'm2' }
      ]
    }]
  });
  try {
    const r = await carga(ctx, 5, itensDa(ctx, 5)[0].id);

    // Preencher com um id chutado abriria o formulário completo, a pessoa
    // salvaria confiando, e a peça ficaria com o material errado na receita.
    assert.strictEqual(r.insumos.length, 1);
    assert.strictEqual(r.insumos[0].nome, 'MDF 15mm Branco TX');
    // A perda tem de doer na hora certa: antes de salvar, com o nome escrito.
    assert.ok(r.avisos.some(a => /Couro Serpente/.test(a)), r.avisos.join(' | '));
  } finally {
    await ctx.encerrar();
  }
});

test('unidade do documento diferente da cadastrada vira aviso, não silêncio', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: null, nome: 'Bandeja Vero PP',
      insumos: [{ processo: 'MARCENARIA', nome: 'MDF 15mm Branco TX', quantidade: '2', unidade: 'm2' }]
    }]
  });
  try {
    const r = await carga(ctx, 5, itensDa(ctx, 5)[0].id);
    // Divergência de unidade aqui não é diferença de escrita: é erro de custo.
    // 2 m2 e 2 CH de MDF são preços diferentes.
    assert.ok(r.avisos.some(a => /Unidade diferente/.test(a)), r.avisos.join(' | '));
    // Mesmo assim o insumo entra: quem decide é quem vai salvar.
    assert.strictEqual(r.insumos.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('o pedido chega com os produtos casados e o cliente apontado', async () => {
  const ctx = await prepararOrcamento();
  try {
    const item = itensDa(ctx, 5)[0];
    const r = await carga(ctx, 5, item.id);

    assert.strictEqual(r.modal.overlay, 'novoOrcamento');
    assert.ok(r.itens.length >= 1);
    // `produto_id` é o que prende a linha ao catálogo; o nome sozinho não
    // serve para calcular preço nem para virar pedido depois.
    assert.ok(Number.isInteger(r.itens[0].produto_id));
    assert.ok(r.itens[0].valor_unitario > 0, 'item entrou com preço zero');

    // E o cliente reconhecido vai junto: é ele que o formulário precisa
    // selecionar antes de qualquer outra coisa.
    assert.strictEqual(r.alvo.tabela, 'clientes');
    assert.strictEqual(r.alvo.id, 50);
    assert.strictEqual(r.alvo.nome, 'Casa Vicenzo');
  } finally {
    await ctx.encerrar();
  }
});

test('item de pedido sem preço no documento usa o preço de tabela, avisando', async () => {
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Casa Vicenzo', razao_social: null, cnpj: null, validade: null,
      prazo: null, forma_pagamento: null, observacoes: null,
      itens: [{ codigo: 'P-100', nome: 'Painel Ripado 2,10', quantidade: '3', valor_unitario: null }]
    }]
  });
  try {
    const r = await carga(ctx, 5, itensDa(ctx, 5)[0].id);
    assert.ok(r.itens[0].valor_unitario > 0);
    assert.strictEqual(r.itens[0].preco_de_tabela, true);
    // Preço que não veio do documento precisa ser conferido antes de ir ao
    // cliente — é a diferença entre uma proposta e um chute.
    assert.ok(r.avisos.some(a => /preço de tabela/i.test(a)), r.avisos.join(' | '));
  } finally {
    await ctx.encerrar();
  }
});

test('a carga de preenchimento não grava nada', async () => {
  const ctx = await prepararFicha();
  try {
    const antes = JSON.stringify(ctx.tabelas);
    await carga(ctx, 5, itensDa(ctx, 5)[0].id);
    // O ponto inteiro desta etapa: o usuário pediu que a leitura parasse de
    // escrever no banco por conta própria.
    assert.strictEqual(JSON.stringify(ctx.tabelas), antes, 'a leitura escreveu no banco');
  } finally {
    await ctx.encerrar();
  }
});

test('item de outra leitura não é legível pelo id', async () => {
  const ctx = await prepararFicha();
  try {
    const item = itensDa(ctx, 5)[0];
    const resp = await chamar(ctx.porta, `/api/ia/999/itens/${item.id}/preenchimento`);
    // Sem conferir o vínculo, um id de item qualquer seria legível por quem só
    // tem acesso a outra leitura.
    assert.strictEqual(resp.status, 404);
  } finally {
    await ctx.encerrar();
  }
});


test('os contatos da empresa chegam ao formulário, o primeiro como principal', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({
      payload: respostaGroq({
        itens: [{
          nome_fantasia: 'Decor Alpina', razao_social: null, cnpj: null,
          inscricao_estadual: null, site: null,
          end_logradouro: 'Rua das Videiras', end_numero: '480', end_complemento: null,
          end_bairro: 'Centro', end_cidade: 'Bento Gonçalves', end_uf: 'RS', end_cep: '95700-000',
          contatos: [
            { nome: 'Juliana Prass', cargo: 'Compras', email: 'juliana@alpina.com.br', telefone_celular: '47 99160-3388', telefone_fixo: null },
            { nome: 'Marco Rossi', cargo: 'Diretor', email: null, telefone_celular: null, telefone_fixo: '47 3333-0000' }
          ]
        }]
      })
    })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const r = await carga(ctx, 5, itensDa(ctx, 5)[0].id);

    assert.strictEqual(r.modal.overlay, 'novoCliente');
    // O endereço é o que o usuário viu na planilha: perder cidade ou CEP aqui
    // é a queixa "no momento de extrair não puxa os dados corretamente".
    assert.strictEqual(r.campos.end_cidade, 'Bento Gonçalves');
    assert.strictEqual(r.campos.end_cep, '95700-000');

    // Contatos são a parte que o preenchimento por campo NÃO alcançava: a
    // tabela de contatos é um array interno do modal, não caixas de texto.
    assert.strictEqual(r.contatos.length, 2);
    assert.strictEqual(r.contatos[0].nome, 'Juliana Prass');
    assert.strictEqual(r.contatos[0].cargo, 'Compras');
    assert.strictEqual(r.contatos[0].telefone_celular, '47 99160-3388');
    // Um deles tem de ser o principal, como em toda criação de empresa.
    assert.strictEqual(r.contatos[0].principal, true);
    assert.strictEqual(r.contatos[1].principal, false);
  } finally {
    await ctx.encerrar();
  }
});

test('contato sem nome não vira linha em branco no cadastro', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({
      payload: respostaGroq({
        itens: [{
          nome_fantasia: 'Decor Alpina', razao_social: null, cnpj: null,
          inscricao_estadual: null, site: null, end_logradouro: null, end_numero: null,
          end_complemento: null, end_bairro: null, end_cidade: null, end_uf: null, end_cep: null,
          contatos: [
            { nome: 'Juliana Prass', cargo: 'Compras', email: null, telefone_celular: null, telefone_fixo: null },
            // Cargo sem pessoa: o documento cita "Diretoria" e ninguém.
            { nome: '   ', cargo: 'Diretoria', email: null, telefone_celular: null, telefone_fixo: null }
          ]
        }]
      })
    })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const r = await carga(ctx, 5, itensDa(ctx, 5)[0].id);

    // Um contato só de cargo não serve para nada e, pior, vira uma linha em
    // branco no cadastro da empresa — que alguém vai ter de apagar depois.
    assert.strictEqual(r.contatos.length, 1);
    assert.strictEqual(r.contatos[0].nome, 'Juliana Prass');
  } finally {
    await ctx.encerrar();
  }
});

test('a UF vira o nome do estado que o formulário conhece', async () => {
  const ctx = await montarComIA(comLeitura(baseEmpresas(), 'clientes'), {}, {
    groq: () => ({
      payload: respostaGroq({
        itens: [{
          nome_fantasia: 'Decor Alpina', razao_social: null, cnpj: null,
          inscricao_estadual: null, site: null, end_logradouro: null, end_numero: null,
          end_complemento: null, end_bairro: null, end_cidade: 'Bento Gonçalves',
          end_uf: 'RS', end_cep: null, contatos: []
        }]
      })
    })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const r = await carga(ctx, 5, itensDa(ctx, 5)[0].id);

    // O documento escreve "RS". O <select> de estado tem nomes por extenso,
    // porque vêm de um serviço de geografia internacional. Mandar a sigla para
    // lá não seleciona nada e não dá erro: o campo fica vazio, e o endereço
    // chega ao cadastro sem estado.
    assert.strictEqual(r.campos.end_uf, 'RS');
    assert.strictEqual(r.campos.end_estado_nome, 'Rio Grande do Sul');
  } finally {
    await ctx.encerrar();
  }
});

test('item de OUTRA leitura que existe também não é legível', async () => {
  // A leitura 4 e a 5 existem as duas. Sem conferir o vínculo, o id do item de
  // uma seria legível pela rota da outra — e este é o caso que o teste com um
  // id inexistente NÃO cobre, porque lá a leitura já barra antes.
  const dados = comLeitura(baseFicha(), 'produto_insumos');
  dados.ia_extracoes.push({
    id: 6, titulo: 'Outra leitura', destino: 'produto_insumos', status: 'revisao',
    arquivos_qtd: 0, itens_qtd: 0, aplicados_qtd: 0, usuario_id: 1, criado_em: RECENTE
  });

  const ctx = await montarComIA(dados, {}, {
    groq: () => ({
      payload: respostaGroq({
        itens: [{ codigo: 'PR-210', nome: 'Painel Ripado 2,10', insumos: [{ nome: 'MDF 15mm Branco TX', quantidade: '1' }] }]
      })
    })
  });
  try {
    await chamar(ctx.porta, '/api/ia/5/estruturar', { method: 'POST' });
    const item = itensDa(ctx, 5)[0];

    const resp = await chamar(ctx.porta, `/api/ia/6/itens/${item.id}/preenchimento`);
    assert.strictEqual(resp.status, 404);
  } finally {
    await ctx.encerrar();
  }
});

test('montarContatos descarta o que não tem nome', () => {
  // A extração já derruba contato sem nome, porque o nome é obrigatório no
  // esquema. Este filtro é a segunda tranca: `montarContatos` é exportada e
  // recebe dados de quem a chamar, e um contato sem nome vira uma linha em
  // branco no cadastro da empresa — que alguém vai ter de apagar depois.
  const { montarContatos } = require('./iaPreenchimento');

  const r = montarContatos([
    { nome: 'Juliana Prass', cargo: 'Compras' },
    { nome: '   ', cargo: 'Diretoria' },
    { nome: null, email: 'contato@empresa.com.br' },
    { cargo: 'Sócio' },
    { nome: 'Marco Rossi' }
  ]);

  assert.deepStrictEqual(r.map(c => c.nome), ['Juliana Prass', 'Marco Rossi']);
  assert.strictEqual(r[0].principal, true);
  assert.strictEqual(r[1].principal, false);
  // Campo ausente vira string vazia, nunca "undefined" escrito na coluna.
  assert.strictEqual(r[1].email, '');
});


// ===========================================================================
// ETAPA 11 — O BLOCO COMERCIAL DO PEDIDO
//
// Contato, transportadora, forma de pagamento, condição, prazo e parcelas.
// Tudo isso estava escrito no PDF, tudo isso era lido, e nada disso chegava ao
// formulário — a pessoa relia o documento e digitava de novo.
// ===========================================================================

test('o pedido a prazo vira parcelas com valor e vencimento', () => {
  const { interpretarPagamento } = require('./iaPreenchimento');

  // Exatamente como o pedido de verdade escreve.
  const r = interpretarPagamento({
    forma_pagamento: 'pix',
    condicao_pagamento: null,
    prazo: '30/60/90',
    parcelas: '3x R$61,62/R$1.661,62/R$861,62'
  });

  assert.strictEqual(r.forma, 'pix');
  assert.strictEqual(r.condicao, 'prazo');
  assert.strictEqual(r.parcelas.count, 3);

  // Valores DIFERENTES entre si: o formulário só respeita valor a valor no
  // modo "diferentes". No modo "iguais" ele redistribuiria o total.
  assert.strictEqual(r.parcelas.mode, 'custom');

  // Centavos, que é a unidade do parcelamento. Em reais com casas decimais o
  // arredondamento se espalha por cada parcela até a soma não fechar.
  assert.deepStrictEqual(r.parcelas.items.map(i => i.amount), [6162, 166162, 86162]);
  assert.deepStrictEqual(r.parcelas.items.map(i => i.dueInDays), [30, 60, 90]);
});

test('parcelas iguais entram no modo "iguais"', () => {
  const { interpretarPagamento } = require('./iaPreenchimento');
  const r = interpretarPagamento({
    forma_pagamento: 'boleto', condicao_pagamento: 'a prazo',
    prazo: '30/60', parcelas: 'R$500,00/R$500,00'
  });
  assert.strictEqual(r.parcelas.mode, 'equal');
  assert.strictEqual(r.parcelas.count, 2);
});

test('sem prazo escrito, os vencimentos caem de 30 em 30 dias', () => {
  const { interpretarPagamento } = require('./iaPreenchimento');
  const r = interpretarPagamento({
    forma_pagamento: null, condicao_pagamento: 'a prazo',
    prazo: null, parcelas: 'R$100,00/R$200,00/R$300,00'
  });
  // Chutar 30/60/90 é o costume do mercado, e o usuário vê e corrige no
  // formulário. Deixar em branco travaria o bloco de parcelamento inteiro.
  assert.deepStrictEqual(r.parcelas.items.map(i => i.dueInDays), [30, 60, 90]);
});

test('venda à vista leva o prazo de ENTREGA, sem parcelas', () => {
  const { interpretarPagamento } = require('./iaPreenchimento');
  const r = interpretarPagamento({
    forma_pagamento: 'pix', condicao_pagamento: 'à vista',
    prazo: '15 dias', parcelas: null
  });
  assert.strictEqual(r.condicao, 'vista');
  assert.strictEqual(r.prazo_vista, '15 dias');
  assert.strictEqual(r.parcelas, null);
});

test('uma parcela só é à vista, mesmo sem o documento dizer', () => {
  const { interpretarPagamento } = require('./iaPreenchimento');
  const r = interpretarPagamento({
    forma_pagamento: 'pix', condicao_pagamento: null, prazo: '30 dias', parcelas: 'R$500,00'
  });
  // Deduzir é seguro: a pessoa vê o resultado no formulário antes de salvar.
  // Deixar em branco obrigaria a preencher à mão o campo que decide o resto.
  assert.strictEqual(r.condicao, 'vista');
});

test('a forma de pagamento vira uma opção que o select tem', () => {
  const { formaDePagamento } = require('./iaPreenchimento');

  assert.strictEqual(formaDePagamento('pix'), 'pix');
  assert.strictEqual(formaDePagamento('PIX'), 'pix');
  assert.strictEqual(formaDePagamento('Boleto bancário'), 'boleto');
  assert.strictEqual(formaDePagamento('Cartão de Crédito'), 'cartao');

  // Um <select> que recebe valor inexistente não reclama: fica vazio, e o
  // pedido sai sem forma de pagamento sem ninguém notar.
  assert.strictEqual(formaDePagamento('permuta'), null);
  assert.strictEqual(formaDePagamento(null), null);
});

test('contato e transportadora são casados com o cadastro do cliente', async () => {
  const dados = baseOrcamento();
  dados.contatos_cliente = [
    { id: 7, id_cliente: 50, nome: 'Lílian' },
    { id: 8, id_cliente: 50, nome: 'Marcos' }
  ];
  dados.transportadoras = [{ id: 3, id_cliente: 50, transportadora: 'Rodonaves' }];

  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Casa Vicenzo', razao_social: null, cnpj: null, validade: null,
      prazo: '30/60/90', forma_pagamento: 'pix', condicao_pagamento: null,
      parcelas: 'R$61,62/R$1.661,62/R$861,62', transportadora: 'Rodonaves',
      contato: 'Lílian', observacoes: null,
      itens: [{ codigo: 'P-100', nome: 'Painel Ripado 2,10', quantidade: '3', valor_unitario: null }]
    }]
  }, dados);
  try {
    const r = await carga(ctx, 5, itensDa(ctx, 5)[0].id);

    // O formulário quer o ID; o documento traz o NOME. Sem casar aqui,
    // "Contato: Lílian" chega como texto que o <select> ignora.
    assert.strictEqual(r.contato.id, 7);
    assert.strictEqual(r.transportadora.id, 3);
    assert.strictEqual(r.pagamento.forma, 'pix');
    assert.strictEqual(r.pagamento.condicao, 'prazo');
    assert.strictEqual(r.pagamento.parcelas.count, 3);
  } finally {
    await ctx.encerrar();
  }
});

test('contato que não está no cadastro é dito, não inventado', async () => {
  const dados = baseOrcamento();
  dados.contatos_cliente = [{ id: 7, id_cliente: 50, nome: 'Lílian' }];
  dados.transportadoras = [];

  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Casa Vicenzo', razao_social: null, cnpj: null, validade: null,
      prazo: null, forma_pagamento: null, condicao_pagamento: null, parcelas: null,
      transportadora: 'Braspress', contato: 'Roberta', observacoes: null,
      itens: [{ codigo: 'P-100', nome: 'Painel Ripado 2,10', quantidade: '1', valor_unitario: null }]
    }]
  }, dados);
  try {
    const r = await carga(ctx, 5, itensDa(ctx, 5)[0].id);

    assert.strictEqual(r.contato, null);
    assert.strictEqual(r.transportadora, null);
    // Escolher outro contato porque o nome é parecido colocaria o orçamento no
    // nome da pessoa errada — o aviso manda cadastrar, que é o certo.
    assert.ok(r.avisos.some(a => /Roberta/.test(a)), r.avisos.join(' | '));
    assert.ok(r.avisos.some(a => /Braspress/.test(a)), r.avisos.join(' | '));
  } finally {
    await ctx.encerrar();
  }
});


// ===========================================================================
// ETAPA 12 — INSUMO CASADO POR SEMELHANÇA
//
// Uma ficha técnica é escrita por quem faz a peça, não por quem cadastrou o
// insumo. "Verniz FO10 - 6717 Em Lamina De Madeira" no papel é "Verniz FO10
// 6717" no estoque. Exigir que as duas grafias batam letra por letra fazia
// metade da ficha ficar de fora — 23 insumos na lista, 6 no formulário.
// ===========================================================================

test('insumo com grafia diferente casa por semelhança', () => {
  const { casarInsumo, indexarPor } = require('./iaPreenchimento');
  const materias = [
    { id: 70, nome: 'Verniz FO10 6717' },
    { id: 71, nome: 'Cola PVA extra 1kg' }
  ];
  const porNome = indexarPor(materias, 'nome');

  const igual = casarInsumo('Cola PVA extra 1kg', porNome, materias);
  assert.strictEqual(igual.tipo, 'exato');
  assert.strictEqual(igual.registro.id, 71);

  const parecido = casarInsumo('Verniz FO10 - 6717 Em Lamina De Madeira', porNome, materias);
  assert.strictEqual(parecido.tipo, 'semelhante');
  assert.strictEqual(parecido.registro.id, 70);

  // Longe demais continua sendo "não existe": casar qualquer coisa poria o
  // material errado na receita, que é pior do que deixar de fora.
  assert.strictEqual(casarInsumo('Bolinha de Silicone 08 mm', porNome, materias).tipo, null);
});

test('a ficha diz, por insumo, como cada um casou', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [
        { processo: 'MARCENARIA', nome: 'MDF 15mm Branco TX', quantidade: '1', unidade: 'CH' },
        { processo: 'MARCENARIA', nome: 'Cola PVA extra', quantidade: '2', unidade: 'UN' },
        { processo: 'MONTAGEM', nome: 'Couro Serpente Amêndoa', quantidade: '1', unidade: 'm2' }
      ]
    }]
  });
  try {
    const detalhe = await (await chamar(ctx.porta, '/api/ia/5')).json();
    const insumos = detalhe.itens[0].dados.insumos;

    // Exato: nada a dizer.
    assert.strictEqual(insumos[0]._casamento, 'exato');
    // Semelhante: a tela mostra o nome LIDO e revela o do cadastro no (i).
    assert.strictEqual(insumos[1]._casamento, 'semelhante');
    assert.strictEqual(insumos[1]._cadastro, 'Cola PVA extra 1kg');
    // Fora do estoque: a linha inteira fica vermelha na grade.
    assert.strictEqual(insumos[2]._casamento, null);
    assert.strictEqual(insumos[2]._cadastro, null);
  } finally {
    await ctx.encerrar();
  }
});

test('o insumo casado por semelhança entra na ficha com o nome do cadastro', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [{ processo: 'MARCENARIA', nome: 'Cola PVA extra', quantidade: '2', unidade: 'UN' }]
    }]
  });
  try {
    const r = await carga(ctx, 5, itensDa(ctx, 5)[0].id);

    // O que vai para a receita é o registro, com o id e o preço dele.
    assert.strictEqual(r.insumos.length, 1);
    assert.strictEqual(r.insumos[0].insumo_id, 71);
    assert.strictEqual(r.insumos[0].nome, 'Cola PVA extra 1kg');

    // E o palpite é anunciado: casamento por semelhança é palpite bom, não
    // certeza, e quem confere precisa poder pegar o palpite errado.
    assert.ok(r.avisos.some(a => /semelhança/i.test(a)), r.avisos.join(' | '));
  } finally {
    await ctx.encerrar();
  }
});

test('a anotação de casamento se refaz a cada abertura', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [{ processo: 'MONTAGEM', nome: 'Perfil U 3/8', quantidade: '1', unidade: 'm2' }]
    }]
  });
  try {
    const antes = await (await chamar(ctx.porta, '/api/ia/5')).json();
    assert.strictEqual(antes.itens[0].dados.insumos[0]._casamento, null);

    // Alguém cadastra o insumo que faltava.
    ctx.tabelas.materia_prima.push({
      id: 99, nome: 'Perfil U 3/8', quantidade: 10, preco_unitario: 5, unidade: 'm2', processo: 'MONTAGEM'
    });

    // A anotação não é gravada em lugar nenhum: ela é o resultado de uma conta
    // feita agora, contra o estoque de agora. Se fosse gravada na extração, a
    // tela continuaria vermelha depois do cadastro.
    const depois = await (await chamar(ctx.porta, '/api/ia/5')).json();
    assert.strictEqual(depois.itens[0].dados.insumos[0]._casamento, 'exato');
  } finally {
    await ctx.encerrar();
  }
});

test('a proximidade de insumo entende o nome qualificado', () => {
  const { proximidadeDeInsumo } = require('./iaPreenchimento');
  const perto = (a, b) => proximidadeDeInsumo(a, b) >= 0.6;

  // A ficha QUALIFICA o material: o nome do cadastro inteiro está lá dentro,
  // mais palavras de contexto. Jaccard conta o contexto contra o casamento.
  assert.strictEqual(perto('Verniz FO10 - 6717 Em Lamina De Madeira', 'Verniz FO10 6717'), true);
  assert.strictEqual(perto('Tinta Golf M115 (Bronze) Em Pintura/WFCT', 'Tinta Golf M115'), true);
  assert.strictEqual(perto('Diluente DF4068 Em Lamina De Madeira', 'Diluente DF4068'), true);

  // Mas contenção sozinha casa demais: com UMA palavra em comum decide o
  // Jaccard, que é conservador. É o que mantém materiais diferentes separados.
  assert.strictEqual(perto('MDF 06', 'MDF 09'), false);
  assert.strictEqual(perto('Cola Branca', 'Cola Fórmica'), false);
  assert.strictEqual(perto('Cola', 'Cola PVA extra 1kg'), false);

  // E nada em comum é nada.
  assert.strictEqual(proximidadeDeInsumo('Bolinha de Silicone', 'Verniz FO10 6717'), 0);
  assert.strictEqual(proximidadeDeInsumo('', 'Verniz'), 0);
});


// ===========================================================================
// ETAPA 13 — CONFIGURAÇÃO NO PROGRAMA
//
// Trocar o modelo ou um limite exigia editar o .env e reiniciar o aplicativo
// em cada máquina. Quem opera não tem acesso ao arquivo, e cada instalação
// acabava com uma configuração diferente sem ninguém perceber.
//
// A CREDENCIAL continua no .env, e continua sendo a única coisa lá.
// ===========================================================================

test('a validação recusa fora da faixa, dizendo por quê', () => {
  const { validar } = require('./iaConfiguracao');

  const bom = validar({ arquivo_mb: '15', groq_modelo: ' llama-3.3-70b ' });
  assert.deepStrictEqual(bom.erros, []);
  assert.strictEqual(bom.valores.arquivo_mb, '15');
  assert.strictEqual(bom.valores.groq_modelo, 'llama-3.3-70b');

  // O motivo do teto vai junto: "valor inválido" manda a pessoa adivinhar.
  const alto = validar({ arquivo_mb: '500' });
  assert.strictEqual(alto.erros.length, 1);
  assert.match(alto.erros[0], /entre 1 e 50/);
  assert.match(alto.erros[0], /recusa o envio/);

  assert.match(validar({ arquivo_mb: 'grande' }).erros[0], /não é um número/);
  assert.match(validar({ chave_secreta: 'x' }).erros[0], /não é uma configuração/);
});

test('vazio quer dizer "volte ao padrão"', () => {
  const { validar } = require('./iaConfiguracao');
  const r = validar({ groq_modelo: '', arquivo_mb: '   ' });
  assert.deepStrictEqual(r.erros, []);
  // `null` é o sinal de apagar a linha. É a única forma de desfazer uma
  // escolha sem ter de adivinhar qual era o valor de antes.
  assert.strictEqual(r.valores.groq_modelo, null);
  assert.strictEqual(r.valores.arquivo_mb, null);
});

test('o que está na tela vence o .env, e o .env vence o padrão', async () => {
  const configuracao = require('./iaConfiguracao');
  const provedores = require('./iaProvedores');
  const anterior = process.env.GROQ_MODEL;

  try {
    configuracao.limparCache();
    process.env.GROQ_MODEL = 'do-env';
    assert.strictEqual(provedores.modeloGroq(), 'do-env');

    await configuracao.carregar({
      get: async () => [{ id: 1, chave: 'groq_modelo', valor: 'da-tela' }]
    });
    assert.strictEqual(provedores.modeloGroq(), 'da-tela');
    assert.strictEqual(provedores.origemDe('groq_modelo', 'GROQ_MODEL'), 'tela');

    // Sem linha no banco, tudo volta a ser exatamente como era antes desta
    // tabela existir — que é o que permite subi-la sem mudar comportamento.
    configuracao.limparCache();
    await configuracao.carregar({ get: async () => [] });
    assert.strictEqual(provedores.modeloGroq(), 'do-env');
    assert.strictEqual(provedores.origemDe('groq_modelo', 'GROQ_MODEL'), 'env');

    delete process.env.GROQ_MODEL;
    assert.strictEqual(provedores.origemDe('groq_modelo', 'GROQ_MODEL'), 'padrao');
  } finally {
    if (anterior === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = anterior;
    configuracao.limparCache();
  }
});

test('tabela ausente não derruba o módulo', async () => {
  // Numa instalação que ainda não rodou o SQL, a leitura falha — e o módulo
  // tem de continuar funcionando pelo .env, como funcionava antes.
  const configuracao = require('./iaConfiguracao');
  configuracao.limparCache();
  const valores = await configuracao.carregar({
    get: async () => { throw new Error('relation nao existe'); }
  });
  assert.deepStrictEqual(valores, {});
  configuracao.limparCache();
});

test('gravar apaga a linha quando o valor volta ao padrão', async () => {
  const configuracao = require('./iaConfiguracao');
  const feitos = [];
  const api = {
    get: async () => [{ id: 7, chave: 'groq_modelo', valor: 'antigo' }],
    put: async (caminho, corpo) => feitos.push(['PUT', caminho, corpo]),
    post: async (caminho, corpo) => feitos.push(['POST', caminho, corpo]),
    delete: async caminho => feitos.push(['DELETE', caminho])
  };

  await configuracao.gravar(api, { groq_modelo: null, arquivo_mb: '20' }, 3);

  // Uma linha com valor em branco continuaria vencendo o .env, e o "volte ao
  // padrão" não voltaria a padrão nenhum.
  assert.deepStrictEqual(feitos[0], ['DELETE', '/api/ia_configuracao/7']);
  assert.strictEqual(feitos[1][0], 'POST');
  assert.strictEqual(feitos[1][2].valor, '20');
  assert.strictEqual(feitos[1][2].atualizado_por, 3);
  configuracao.limparCache();
});

test('o estado da configuração diz de onde veio cada valor', async () => {
  const ctx = await montarComIA(baseDados(), { GROQ_MODEL: 'llama-de-teste' });
  try {
    const cfg = await (await chamar(ctx.porta, '/api/ia/config/estado')).json();

    // "Por que este modelo?" é a primeira pergunta de quem abre a tela e vê
    // algo diferente do que esperava.
    assert.strictEqual(cfg.groq.modelo_origem, 'env');
    assert.ok(cfg.campos.arquivo_mb, 'a tela não recebe a faixa aceita de cada campo');
    assert.ok(cfg.campos.arquivo_mb.porque, 'a tela não recebe o motivo do teto');

    // A chave continua mascarada: o que muda de lugar é a configuração, não a
    // credencial.
    assert.doesNotMatch(JSON.stringify(cfg), /chave-groq/);
  } finally {
    await ctx.encerrar();
  }
});

test('a extração guarda quanto de contexto gastou', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({
      payload: {
        ...respostaGroq(ITENS_LIDOS),
        usage: { prompt_tokens: 1200, completion_tokens: 340 }
      }
    })
  });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    const leitura = ctx.tabelas.ia_extracoes.find(e => e.id === 4);

    // "Cabe neste modelo?" é a pergunta que decide trocar de modelo ou dividir
    // o documento, e até aqui só dava para responder tentando.
    assert.strictEqual(leitura.tokens_entrada, 1200);
    assert.strictEqual(leitura.tokens_saida, 340);
  } finally {
    await ctx.encerrar();
  }
});

test('num documento fatiado, o consumo é a soma das fatias', async () => {
  let chamadas = 0;
  const ctx = await montarComIA(baseComDocumentoLongo(24), {}, {
    groq: ({ body }) => {
      chamadas += 1;
      const cru = String(body.messages[1].content);
      const linhas = cru.split(String.fromCharCode(10))
        .filter(l => l.trim() && !l.startsWith('###'));
      const itens = linhas.slice(0, 6).map(l => ({
        nome: l.split('|')[0].trim(), quantidade: '5', unidade: 'CH',
        preco_unitario: '10,00', categoria: 'Chapas', descricao: null
      }));
      return {
        payload: {
          ...respostaGroq({ itens }, linhas.length > 6 ? 'length' : 'stop'),
          usage: { prompt_tokens: 100, completion_tokens: 50 }
        }
      };
    }
  });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    const leitura = ctx.tabelas.ia_extracoes.find(e => e.id === 4);

    // O que interessa é quanto o DOCUMENTO gastou, não quanto gastou o último
    // pedaço dele.
    assert.ok(chamadas > 1, 'o documento nem chegou a ser fatiado');
    assert.strictEqual(leitura.tokens_entrada, chamadas * 100);
    assert.strictEqual(leitura.tokens_saida, chamadas * 50);
  } finally {
    await ctx.encerrar();
  }
});


// ===========================================================================
// ETAPA 14 — O CASAMENTO DE INSUMO, CONSERTADO
//
// Três defeitos no tokenizador, todos encontrados com o estoque de verdade:
//
//   "MDF 6 mm" virava {mdf, mm} .......... o `6` era descartado por ter um
//                                          caractere só, e as sete espessuras
//                                          de MDF viravam sete nomes iguais;
//   "DF4068" != "DF 4068" ................ letra colada em dígito;
//   "MDF 06" != "MDF 6 mm" ............... zero à esquerda.
//
// E uma regra que faltava: um insumo só casa DENTRO da etapa que a ficha diz.
// ===========================================================================

test('os termos de um insumo separam número, letra e ruído', () => {
  const { termosDeInsumo } = require('./iaPreenchimento');
  const t = v => [...termosDeInsumo(v)].join(',');

  // O número de um caractere é justamente o que distingue um MDF do outro.
  assert.strictEqual(t('MDF 6 mm'), 'mdf,6');
  // Zero à esquerda é forma de escrever, não número diferente.
  assert.strictEqual(t('MDF 06'), 'mdf,6');
  // Letra colada em dígito são dois termos: a ficha escreve junto, o cadastro
  // separado, e é o mesmo código.
  assert.strictEqual(t('DF4068'), 'df,4068');
  // Preposição e unidade não distinguem insumo nenhum.
  assert.strictEqual(t('Diluente DF 4068 Em Lamina De Madeira'), 'diluente,df,4068,lamina,madeira');
});

test('os casos que estavam errados no estoque de verdade', () => {
  const { proximidadeDeInsumo } = require('./iaPreenchimento');
  const casa = (a, b) => proximidadeDeInsumo(a, b) >= 0.6;

  // Estes dois vinham VERMELHOS na tela, e o material existia no estoque.
  assert.strictEqual(casa('MDF 06', 'MDF 6 mm'), true);
  assert.strictEqual(casa('MDF 09', 'MDF 9 mm'), true);
  assert.strictEqual(casa('Diluente DF4068 Em Lamina De Madeira', 'Diluente DF 4068'), true);

  // E estes NÃO podem casar: sete espessuras de MDF são sete materiais, com
  // preços que vão de R$ 11 a R$ 56 o metro quadrado.
  assert.strictEqual(casa('MDF 06', 'MDF 9 mm'), false);
  assert.strictEqual(casa('MDF 06', 'MDF 12 mm'), false);
  assert.strictEqual(casa('MDF 06', 'MDF 25 mm'), false);
  assert.strictEqual(casa('Cola Branca', 'Cola Fórmica'), false);
  assert.strictEqual(casa('Freijó', 'MDF 6 mm'), false);
});

test('o insumo só casa dentro da etapa que a ficha declara', () => {
  const { mesmoProcesso } = require('./iaPreenchimento');
  const etapas = new Map([['1', 'MARCENARIA'], ['3', 'MONTAGEM']]);

  assert.strictEqual(mesmoProcesso('MARCENARIA', { processo: 'MARCENARIA' }, etapas), true);
  // Caixa e acento não distinguem etapa.
  assert.strictEqual(mesmoProcesso('marcenaria', { processo: 'MARCENARIA' }, etapas), true);
  // O cadastro grava o nome, mas há código no programa que aceita o id.
  assert.strictEqual(mesmoProcesso('MARCENARIA', { processo: '1' }, etapas), true);

  // Montar a peça com o material de outra etapa é o erro que o nome batendo
  // esconde: ninguém percebe, porque o nome está certo.
  assert.strictEqual(mesmoProcesso('MARCENARIA', { processo: 'MONTAGEM' }, etapas), false);
  assert.strictEqual(mesmoProcesso('MARCENARIA', { processo: null }, etapas), false);

  // Ficha que não diz a etapa não tem o que restringir.
  assert.strictEqual(mesmoProcesso('', { processo: 'MONTAGEM' }, etapas), true);
});

test('nome certo na etapa errada não entra, e o motivo é dito', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [
        // "MDF 15mm Branco TX" está cadastrado em MARCENARIA.
        { processo: 'MONTAGEM', nome: 'MDF 15mm Branco TX', quantidade: '1', unidade: 'CH' }
      ]
    }]
  });
  try {
    const r = await carga(ctx, 5, itensDa(ctx, 5)[0].id);

    assert.strictEqual(r.insumos.length, 0, 'entrou material de outra etapa');
    // "Não existe" e "existe em outra etapa" pedem coisas diferentes de quem
    // revisa: um manda cadastrar, o outro manda conferir a etapa.
    assert.ok(r.avisos.some(a => /outra etapa/.test(a)), r.avisos.join(' | '));
    assert.ok(r.avisos.some(a => /MARCENARIA/.test(a)), r.avisos.join(' | '));
  } finally {
    await ctx.encerrar();
  }
});

test('a grade distingue "não existe" de "está em outra etapa"', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [
        { processo: 'MONTAGEM', nome: 'MDF 15mm Branco TX', quantidade: '1', unidade: 'CH' },
        { processo: 'MONTAGEM', nome: 'Couro Serpente Amêndoa', quantidade: '1', unidade: 'm2' }
      ]
    }]
  });
  try {
    const detalhe = await (await chamar(ctx.porta, '/api/ia/5')).json();
    const insumos = detalhe.itens[0].dados.insumos;

    assert.strictEqual(insumos[0]._casamento, null);
    assert.strictEqual(insumos[0]._fora_do_processo, 'MARCENARIA');

    assert.strictEqual(insumos[1]._casamento, null);
    assert.strictEqual(insumos[1]._fora_do_processo, null);
  } finally {
    await ctx.encerrar();
  }
});

test('a etapa entra ANTES do nome, não como desempate', async () => {
  const dados = baseFicha();
  // Dois insumos com nome parecido, em etapas diferentes. Sem a restrição, o
  // de MONTAGEM ganharia por ser mais parecido — e a peça sairia com o
  // material da etapa errada.
  dados.materia_prima.push(
    { id: 80, nome: 'Catalisador FC 6975', quantidade: 100, preco_unitario: 3, unidade: 'ML', processo: 'ACABAMENTO' },
    { id: 81, nome: 'Catalisador FC 6975 Montagem', quantidade: 100, preco_unitario: 9, unidade: 'ML', processo: 'MONTAGEM' }
  );

  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [{ processo: 'ACABAMENTO', nome: 'Catalisador FC 6975 Em Lamina De Madeira', quantidade: '22', unidade: 'ml' }]
    }]
  }, dados);
  try {
    const r = await carga(ctx, 5, itensDa(ctx, 5)[0].id);
    assert.strictEqual(r.insumos.length, 1);
    assert.strictEqual(r.insumos[0].insumo_id, 80, 'pegou o da etapa errada');
    assert.strictEqual(r.insumos[0].preco_unitario, 3);
  } finally {
    await ctx.encerrar();
  }
});

test('o recorte substitui o texto inteiro na extração', async () => {
  const dados = baseParaEstruturar();
  dados.ia_extracao_arquivos.find(a => a.id === 41).texto_ajustado = 'SO ESTA LINHA | 1 | 5,00';

  const ctx = await montarComIA(dados, {}, { groq: () => ({ payload: respostaGroq(ITENS_LIDOS) }) });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    const enviado = ctx.groq.chamadas[0].body.messages[1].content;

    // Quem está olhando o documento sabe o que interessa ao destino. O que não
    // interessa custa contexto e — pior — dá ao modelo em que se distrair.
    assert.match(enviado, /SO ESTA LINHA/);
    assert.doesNotMatch(enviado, /Fita 22mm/, 'mandou o texto inteiro mesmo com recorte');
  } finally {
    await ctx.encerrar();
  }
});

test('sem recorte, vai o texto inteiro — como sempre foi', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({ payload: respostaGroq(ITENS_LIDOS) })
  });
  try {
    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    assert.match(ctx.groq.chamadas[0].body.messages[1].content, /Fita 22mm/);
  } finally {
    await ctx.encerrar();
  }
});

test('salvar o recorte guarda, e apagar volta ao texto inteiro', async () => {
  const ctx = await montarComIA(baseParaEstruturar());
  try {
    const salvar = corpo => chamar(ctx.porta, '/api/ia/4/arquivos/41/texto', {
      method: 'PUT', body: JSON.stringify(corpo)
    });

    const r = await (await salvar({ texto_ajustado: '  SO ISTO  ' })).json();
    assert.strictEqual(r.texto_ajustado, 'SO ISTO');
    const arquivo = () => ctx.tabelas.ia_extracao_arquivos.find(a => a.id === 41);
    assert.strictEqual(arquivo().texto_ajustado, 'SO ISTO');

    // Vazio é "volte a usar a transcrição inteira". Guardar string vazia
    // continuaria vencendo o texto original.
    await salvar({ texto_ajustado: '   ' });
    assert.strictEqual(arquivo().texto_ajustado, null);
  } finally {
    await ctx.encerrar();
  }
});

test('recorte de arquivo de outra leitura é recusado', async () => {
  const ctx = await montarComIA(baseParaEstruturar());
  try {
    const resp = await chamar(ctx.porta, '/api/ia/1/arquivos/41/texto', {
      method: 'PUT', body: JSON.stringify({ texto_ajustado: 'x' })
    });
    assert.strictEqual(resp.status, 404);
  } finally {
    await ctx.encerrar();
  }
});


// ===========================================================================
// ETAPA 21 — O TERMO RARO IDENTIFICA; O COMUM, NÃO
//
// "Freijó" está inteiro dentro de "Lâmina de Freijó" e é a mesma madeira.
// "Cola" está inteiro dentro de "Cola PVA", de "Cola Branca" e de "Cola
// Fórmica", e não é nenhuma das três.
//
// A diferença não é o tamanho do nome — é quantos insumos do catálogo usam
// aquela palavra.
// ===========================================================================

/** Catálogo pequeno com os dois casos lado a lado. */
const CATALOGO_MARCENARIA = [
  { id: 1, nome: 'Lâmina de Freijó', processo: 'MARCENARIA' },
  { id: 2, nome: 'Cola PVA extra 1kg', processo: 'MARCENARIA' },
  { id: 3, nome: 'Cola Branca', processo: 'MARCENARIA' },
  { id: 4, nome: 'Cola Fórmica', processo: 'MARCENARIA' },
  { id: 5, nome: 'MDF 6 mm', processo: 'MARCENARIA' },
  { id: 6, nome: 'MDF 9 mm', processo: 'MARCENARIA' }
];

const casar = lido => {
  const { casarInsumo, indexarPor } = require('./iaPreenchimento');
  return casarInsumo(lido, indexarPor(CATALOGO_MARCENARIA, 'nome'),
    CATALOGO_MARCENARIA, 'MARCENARIA', new Map());
};

test('uma palavra RARA basta para identificar o insumo', () => {
  // "freijo" aparece uma vez no catálogo: é o nome daquela madeira.
  const r = casar('Freijó');
  assert.strictEqual(r.tipo, 'semelhante');
  assert.strictEqual(r.registro.nome, 'Lâmina de Freijó');
});

test('uma palavra COMUM não identifica nada', () => {
  // "cola" aparece em três: é família, e escolher uma das três seria sorteio.
  const r = casar('Cola');
  assert.strictEqual(r.registro, null);
});

test('empate no topo é recusado, não sorteado', () => {
  const { casarInsumo, indexarPor } = require('./iaPreenchimento');
  const catalogo = [
    { id: 1, nome: 'Verniz Fosco 900', processo: 'ACABAMENTO' },
    { id: 2, nome: 'Verniz Fosco 901', processo: 'ACABAMENTO' }
  ];
  const r = casarInsumo('Verniz Fosco', indexarPor(catalogo, 'nome'),
    catalogo, 'ACABAMENTO', new Map());

  // Dois igualmente parecidos querem dizer que a ficha não foi específica. Um
  // sorteio aqui põe metade da chance de material errado na receita — em
  // silêncio, porque o nome escolhido parece plausível.
  assert.strictEqual(r.registro, null);
  assert.ok(r.ambiguo, 'não avisou que era ambíguo');
});

test('os casos do estoque de verdade continuam certos', () => {
  assert.strictEqual(casar('MDF 06').registro.nome, 'MDF 6 mm');
  assert.strictEqual(casar('MDF 09').registro.nome, 'MDF 9 mm');
  assert.strictEqual(casar('Cola Branca').tipo, 'exato');
  // E o que não existe continua não existindo.
  assert.strictEqual(casar('Perfil U 3/8').registro, null);
});

test('a frequência sai dos CANDIDATOS da etapa, não do catálogo inteiro', () => {
  const { frequenciaDeTermos } = require('./iaPreenchimento');
  const freq = frequenciaDeTermos(CATALOGO_MARCENARIA);

  // Dentro de MARCENARIA, "cola" é comum e "freijo" é único — e é essa
  // comparação que decide entre eles.
  assert.strictEqual(freq.get('cola'), 3);
  assert.strictEqual(freq.get('freijo'), 1);
  assert.strictEqual(freq.get('mdf'), 2);
});


// ===========================================================================
// ETAPA 22 — O QUE FOI LIDO NÃO SE PERDE AO CORRIGIR
// ===========================================================================

test('corrigir um campo não apaga os marcadores da linha', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [
        { processo: 'MARCENARIA', nome: 'Cola PVA extra', quantidade: '2', unidade: 'UN' },
        { processo: 'MARCENARIA', nome: 'MDF 15mm Branco TX', quantidade: '1', unidade: 'CH' }
      ]
    }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    const dados = JSON.parse(item.dados);
    dados.insumos[0].quantidade = 5;

    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ dados })
    })).json();

    // As anotações são conta, não dado: não são gravadas e se refazem a cada
    // leitura. Devolver o item sem elas fazia a linha inteira perder os
    // marcadores assim que UM campo era corrigido — e só voltavam fechando e
    // reabrindo o modal.
    assert.strictEqual(salvo.dados.insumos[0]._casamento, 'semelhante');
    assert.strictEqual(salvo.dados.insumos[0]._cadastro, 'Cola PVA extra 1kg');
    assert.strictEqual(salvo.dados.insumos[1]._casamento, 'exato');
  } finally {
    await ctx.encerrar();
  }
});

test('o nome que o documento escreveu sobrevive à troca', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [{ processo: 'MARCENARIA', nome: 'Cola PVA extra', quantidade: '2', unidade: 'UN' }]
    }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    const primeiro = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ dados: JSON.parse(item.dados) })
    })).json();
    assert.strictEqual(primeiro.dados.insumos[0]._lido, 'Cola PVA extra');

    // Agora a pessoa troca o nome à mão.
    const trocado = { ...primeiro.dados };
    trocado.insumos = [{ ...primeiro.dados.insumos[0], nome: 'MDF 15mm Branco TX' }];

    const depois = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ dados: trocado })
    })).json();

    // Sem isto, trocar o nome apagava a única prova de que a ficha dizia outra
    // coisa — e o (i) da linha ficava vazio justo nas linhas que a pessoa mexeu.
    assert.strictEqual(depois.dados.insumos[0]._lido, 'Cola PVA extra');
    assert.strictEqual(depois.dados.insumos[0]._casamento, 'exato');
  } finally {
    await ctx.encerrar();
  }
});

test('linha apagada no meio não desalinha o que foi lido', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [
        { processo: 'MARCENARIA', nome: 'Cola PVA extra', quantidade: '2', unidade: 'UN' },
        { processo: 'MARCENARIA', nome: 'MDF 15 Branco', quantidade: '1', unidade: 'CH' },
        { processo: 'MARCENARIA', nome: 'Fita de borda 22', quantidade: '5', unidade: 'M' }
      ]
    }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    const primeiro = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ dados: JSON.parse(item.dados) })
    })).json();
    assert.deepStrictEqual(primeiro.dados.insumos.map(i => i._lido),
      ['Cola PVA extra', 'MDF 15 Branco', 'Fita de borda 22']);

    // A pessoa apaga o NOME da primeira linha — mid-edição, ou por engano. A
    // coerção descarta a linha sem campo obrigatório, e a lista encurta.
    const editado = { ...primeiro.dados };
    editado.insumos = primeiro.dados.insumos.map(
      (sub, i) => (i === 0 ? { ...sub, nome: '' } : sub));

    const depois = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ dados: editado })
    })).json();

    // Enquanto o que foi lido era reencaixado por POSIÇÃO, toda linha depois
    // do buraco herdava a leitura da anterior: o (i) do MDF passava a mostrar
    // "Cola PVA extra", e quem revisava conferia contra o papel errado.
    assert.deepStrictEqual(depois.dados.insumos.map(i => i.nome),
      ['MDF 15 Branco', 'Fita de borda 22']);
    assert.deepStrictEqual(depois.dados.insumos.map(i => i._lido),
      ['MDF 15 Branco', 'Fita de borda 22']);
  } finally {
    await ctx.encerrar();
  }
});

test('leitura antiga, gravada antes do _lido, ainda mostra a origem', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [{ processo: 'MARCENARIA', nome: 'Cola PVA extra', quantidade: '2', unidade: 'UN' }]
    }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    // Como o banco guardava antes de o `_lido` existir: só os campos do
    // esquema, sem anotação nenhuma.
    const cru = JSON.parse(item.dados);
    assert.strictEqual(cru.insumos[0]._lido, undefined);

    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ dados: cru })
    })).json();

    // Nessas linhas o nome no banco É o que o documento escreveu — ninguém
    // tinha corrigido nada ainda. Sem essa herança, uma leitura velha reaberta
    // perderia o (i) de todas as linhas de uma vez.
    assert.strictEqual(salvo.dados.insumos[0]._lido, 'Cola PVA extra');

    // E a herança tem de chegar ao BANCO, não só à resposta: a anotação
    // preenche `_lido` de novo a cada leitura, então a resposta pareceria certa
    // mesmo com nada gravado — e a origem só se fixaria no salvamento seguinte.
    const guardado = JSON.parse(
      ctx.tabelas.ia_extracao_itens.find(i => i.id === item.id).dados);
    assert.strictEqual(guardado.insumos[0]._lido, 'Cola PVA extra');
  } finally {
    await ctx.encerrar();
  }
});


// ===========================================================================
// ETAPA 25 — CONSUMO SEPARADO POR PROVEDOR
// ===========================================================================

test('leitura e extração guardam o consumo de cada uma', async () => {
  const ctx = await montarComIA(baseParaEstruturar(), {}, {
    groq: () => ({
      payload: { ...respostaGroq(ITENS_LIDOS), usage: { prompt_tokens: 900, completion_tokens: 120 } }
    })
  });
  try {
    // A leitura já tinha registrado o gasto do Gemini.
    const leitura = ctx.tabelas.ia_extracoes.find(e => e.id === 4);
    leitura.tokens_ocr_entrada = 40000;
    leitura.tokens_ocr_saida = 3000;

    await chamar(ctx.porta, '/api/ia/4/estruturar', { method: 'POST' });
    const depois = ctx.tabelas.ia_extracoes.find(e => e.id === 4);

    // Cada passo usa um modelo com contexto diferente. Somar os dois e
    // comparar contra um deles daria uma porcentagem que não significa nada.
    assert.strictEqual(depois.tokens_ocr_entrada, 40000);
    assert.strictEqual(depois.tokens_llm_entrada, 900);
    // E o total continua sendo o número útil para "quanto custou o documento".
    assert.strictEqual(depois.tokens_entrada, 40900);
  } finally {
    await ctx.encerrar();
  }
});

test('a configuração devolve o consumo de cada provedor', async () => {
  const dados = baseDados();
  dados.ia_extracoes[0].tokens_ocr_entrada = 40000;
  dados.ia_extracoes[0].tokens_llm_entrada = 900;
  dados.ia_extracoes[0].tokens_entrada = 40900;
  dados.ia_extracoes[0].modelo_ocr = 'gemini-de-teste';
  dados.ia_extracoes[0].modelo_llm = 'llama-de-teste';

  const ctx = await montarComIA(dados);
  try {
    const cfg = await (await chamar(ctx.porta, '/api/ia/config/estado')).json();

    assert.strictEqual(cfg.ultimo_uso.gemini.entrada, 40000);
    assert.strictEqual(cfg.ultimo_uso.gemini.modelo, 'gemini-de-teste');
    assert.strictEqual(cfg.ultimo_uso.groq.entrada, 900);
    assert.strictEqual(cfg.ultimo_uso.groq.modelo, 'llama-de-teste');
  } finally {
    await ctx.encerrar();
  }
});

test('a raridade decide sozinha, sem depender da guarda de empate', () => {
  // Isolado da recusa por ambiguidade: aqui o que se mede é a REGRA, não o
  // desfecho. Com um catálogo em que "cola" é comum e "freijo" é único, a
  // mesma conta tem de dar respostas diferentes para os dois.
  const { proximidadeDeInsumo, frequenciaDeTermos } = require('./iaPreenchimento');
  const freq = frequenciaDeTermos(CATALOGO_MARCENARIA);

  assert.ok(proximidadeDeInsumo('Freijó', 'Lâmina de Freijó', freq) >= 0.6,
    'palavra única deixou de identificar');
  assert.ok(proximidadeDeInsumo('Cola', 'Cola Branca', freq) < 0.6,
    'palavra comum passou a identificar');

  // E sem a tabela de frequência, o conservador vale: uma palavra em comum
  // não basta. É o que protege quem chamar a função sem o catálogo em mãos.
  assert.ok(proximidadeDeInsumo('Freijó', 'Lâmina de Freijó') < 0.6);
});


// ===========================================================================
// ETAPA 27 — UNIDADE E ETAPA TÊM DE BATER COM O CADASTRO
//
// Não basta o insumo existir: ele existe COM uma unidade e NUMA etapa, e é com
// essas que a ficha do produto é montada. Uma linha que diz "m²" para um
// insumo cadastrado em "ML" produz uma receita com o custo errado por três
// ordens de grandeza — e o nome bate, então nada parece fora do lugar.
// ===========================================================================

test('a grade diz, por insumo, se unidade e etapa batem', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [
        // MDF 15mm está cadastrado em MARCENARIA, unidade CH.
        { processo: 'MARCENARIA', nome: 'MDF 15mm Branco TX', quantidade: '1', unidade: 'CH' },
        { processo: 'MARCENARIA', nome: 'Cola PVA extra 1kg', quantidade: '2', unidade: 'm2' }
      ]
    }]
  });
  try {
    const detalhe = await (await chamar(ctx.porta, '/api/ia/5')).json();
    const insumos = detalhe.itens[0].dados.insumos;

    assert.strictEqual(insumos[0]._unidade_ok, true);
    assert.strictEqual(insumos[0]._processo_ok, true);

    // "m2" contra "UN" do cadastro.
    assert.strictEqual(insumos[1]._unidade_ok, false);
    assert.strictEqual(insumos[1]._unidade_cadastro, 'UN');
    assert.strictEqual(insumos[1]._processo_ok, true);
  } finally {
    await ctx.encerrar();
  }
});

test('caixa e acento não contam como divergência', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [{ processo: 'marcenaria', nome: 'MDF 15mm Branco TX', quantidade: '1', unidade: 'ch' }]
    }]
  });
  try {
    const detalhe = await (await chamar(ctx.porta, '/api/ia/5')).json();
    const insumo = detalhe.itens[0].dados.insumos[0];

    // Exigir a mesma grafia transformaria uma questão de escrita num bloqueio.
    assert.strictEqual(insumo._unidade_ok, true);
    assert.strictEqual(insumo._processo_ok, true);
  } finally {
    await ctx.encerrar();
  }
});

test('unidade em branco é divergência, não indiferença', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [{ processo: 'MARCENARIA', nome: 'MDF 15mm Branco TX', quantidade: '1', unidade: null }]
    }]
  });
  try {
    const detalhe = await (await chamar(ctx.porta, '/api/ia/5')).json();
    // O insumo TEM unidade no cadastro; a linha não diz qual. Deixar passar
    // mandaria para a ficha uma quantidade sem unidade nenhuma.
    assert.strictEqual(detalhe.itens[0].dados.insumos[0]._unidade_ok, false);
  } finally {
    await ctx.encerrar();
  }
});

test('insumo sem cadastro não tem o que divergir', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [{ processo: 'MONTAGEM', nome: 'Couro Serpente', quantidade: '1', unidade: 'm2' }]
    }]
  });
  try {
    const detalhe = await (await chamar(ctx.porta, '/api/ia/5')).json();
    const insumo = detalhe.itens[0].dados.insumos[0];

    // `null` e `false` dizem coisas diferentes: "não há com o que comparar" e
    // "comparei e não bate". A tela desenha os dois de forma diferente.
    assert.strictEqual(insumo._unidade_ok, null);
    assert.strictEqual(insumo._processo_ok, null);
    assert.strictEqual(insumo._casamento, null);
  } finally {
    await ctx.encerrar();
  }
});


// ===========================================================================
// ETAPAS 28 A 31 — A LEITURA SE FECHA, E O PEDIDO CASA COM O CATÁLOGO
// ===========================================================================

test('a leitura vira "Concluída" quando não sobra linha pendente', async () => {
  const ctx = await prepararFicha({
    itens: [{
      codigo: 'PR-210', nome: 'Painel Ripado 2,10',
      insumos: [{ processo: 'MARCENARIA', nome: 'MDF 15mm Branco TX', quantidade: '1', unidade: 'CH' }]
    }]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    assert.strictEqual(ctx.tabelas.ia_extracoes.find(e => e.id === 5).status, 'revisao');

    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'ignorar' })
    })).json();

    // Com um item só, resolvido pelo formulário do módulo, a leitura ficava
    // dizendo "Em revisão" para sempre — e a lista, que é onde se procura o
    // que ainda falta fazer, mostrava trabalho já feito.
    assert.strictEqual(salvo.leitura_status, 'aplicada');
    assert.strictEqual(salvo.leitura_status_rotulo, 'Concluída');
    assert.strictEqual(ctx.tabelas.ia_extracoes.find(e => e.id === 5).status, 'aplicada');
  } finally {
    await ctx.encerrar();
  }
});

test('com linha ainda pendente, a leitura continua em revisão', async () => {
  const ctx = await prepararFicha({
    itens: [
      { codigo: 'PR-210', nome: 'Painel Ripado 2,10', insumos: [{ processo: 'MARCENARIA', nome: 'MDF 15mm Branco TX', quantidade: '1', unidade: 'CH' }] },
      { codigo: 'ML-01', nome: 'Mesa Lateral Carvalho', insumos: [{ processo: 'MARCENARIA', nome: 'Cola PVA extra 1kg', quantidade: '1', unidade: 'UN' }] }
    ]
  });
  try {
    const item = itensDa(ctx, 5)[0];
    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ acao: 'ignorar' })
    })).json();

    assert.strictEqual(salvo.leitura_status, 'revisao');
  } finally {
    await ctx.encerrar();
  }
});

test('o produto do pedido casa por código, e o código manda', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  const catalogo = [
    { id: 9, codigo: 'PR-210', nome: 'Painel Ripado 2,10', preco_tabela: 900 },
    { id: 10, codigo: 'ML-01', nome: 'Mesa Lateral Carvalho', preco_tabela: 400 }
  ];
  const porCodigo = indexarPor(catalogo, 'codigo');
  const porNome = indexarPor(catalogo, 'nome');

  // Código é identidade. O nome do pedido costuma ser como o CLIENTE chama a
  // peça, não como o catálogo a chama — deixá-lo desempatar seria trocar uma
  // certeza por um palpite.
  const r = casarProduto('PR-210', 'Painel de Ripas Grande', porCodigo, porNome, catalogo);
  assert.strictEqual(r.registro.id, 9);
  assert.strictEqual(r.por, 'codigo');
  assert.strictEqual(r.tipo, 'exato');
});

test('sem código, o produto casa pelo nome — exato ou parecido', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  const catalogo = [
    { id: 9, codigo: 'PR-210', nome: 'Painel Ripado 2,10', preco_tabela: 900 },
    { id: 11, codigo: 'BV-01', nome: 'Bandeja Vero PP', preco_tabela: 300 }
  ];
  const porCodigo = indexarPor(catalogo, 'codigo');
  const porNome = indexarPor(catalogo, 'nome');
  const casar = (cod, nome) => casarProduto(cod, nome, porCodigo, porNome, catalogo);

  assert.strictEqual(casar(null, 'Bandeja Vero PP').tipo, 'exato');
  assert.strictEqual(casar(null, 'Bandeja Vero PP - Muiracatiara').tipo, 'semelhante');
  assert.strictEqual(casar(null, 'Cadeira Dobrável').registro, null);
});

test('o item do pedido chega anotado, com o preço do catálogo', async () => {
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Casa Vicenzo', razao_social: null, cnpj: null, validade: null,
      prazo: null, forma_pagamento: null, condicao_pagamento: null, parcelas: null,
      transportadora: null, contato: null, observacoes: null,
      itens: [
        { codigo: 'PR-210', nome: 'Painel de Ripas', quantidade: '2', valor_unitario: '1' },
        { codigo: null, nome: 'Cadeira Dobrável', quantidade: '1', valor_unitario: '50' }
      ]
    }]
  });
  try {
    const detalhe = await (await chamar(ctx.porta, '/api/ia/5')).json();
    const itens = detalhe.itens[0].dados.itens;

    // Casou pelo código: o nome mostrado passa a ser o do catálogo, e o que o
    // pedido escreveu fica no (i).
    assert.strictEqual(itens[0]._casamento, 'exato');
    assert.strictEqual(itens[0]._cadastro, 'Painel Ripado 2,10');
    assert.strictEqual(itens[0]._lido, 'Painel de Ripas');
    assert.strictEqual(itens[0].codigo, 'PR-210');

    // O preço é o PRATICADO do cadastro, não o do documento. Vender pelo que
    // o pedido escreveu seria vender por um número que ninguém aprovou.
    assert.strictEqual(itens[0]._preco, 1250);

    // O que não existe no catálogo fica sem casamento — e vermelho na tela.
    assert.strictEqual(itens[1]._casamento, null);
    assert.strictEqual(itens[1]._preco, null);
  } finally {
    await ctx.encerrar();
  }
});

test('o código vem do catálogo, mesmo quando o pedido traz outro', async () => {
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Casa Vicenzo', razao_social: null, cnpj: null, validade: null,
      prazo: null, forma_pagamento: null, condicao_pagamento: null, parcelas: null,
      transportadora: null, contato: null, observacoes: null,
      // Sem código e com o nome do jeito que o cliente escreve.
      itens: [{ codigo: null, nome: 'Mesa Lateral de Carvalho', quantidade: '1', valor_unitario: '10' }]
    }]
  });
  try {
    const [item] = (await (await chamar(ctx.porta, '/api/ia/5')).json()).itens[0].dados.itens;

    // Um código digitado à mão não existe no sistema, e o orçamento o recusa
    // do outro lado — quando já não há o que corrigir aqui. Escolhida a peça,
    // o código é consequência dela.
    assert.strictEqual(item._casamento, 'semelhante');
    assert.strictEqual(item.codigo, 'ML-01');
    assert.strictEqual(item._cadastro, 'Mesa Lateral Carvalho');
    assert.strictEqual(item._lido, 'Mesa Lateral de Carvalho');
  } finally {
    await ctx.encerrar();
  }
});

test('o preço é o PRATICADO da tabela fixa, não o do documento', async () => {
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Casa Vicenzo', razao_social: null, cnpj: null, validade: null,
      prazo: null, forma_pagamento: null, condicao_pagamento: null, parcelas: null,
      transportadora: null, contato: null, observacoes: null,
      itens: [
        { codigo: 'PR-210', nome: 'Painel Ripado', quantidade: '3', valor_unitario: '850,00' },
        { codigo: 'BV-01', nome: 'Bandeja Vero PP', quantidade: '1', valor_unitario: '99' }
      ]
    }]
  });
  try {
    const itens = (await (await chamar(ctx.porta, '/api/ia/5')).json()).itens[0].dados.itens;

    // 1.250 é o praticado; 900 é o custo apurado e 850 é o que o pedido pediu.
    // Vender pelo do pedido é aceitar o preço que o CLIENTE escreveu; vender
    // pelo apurado é vender pelo custo. Nenhum dos dois foi aprovado.
    assert.strictEqual(itens[0]._preco, 1250);

    // Peça sem linha na tabela fixa não tem preço praticado — e null não é
    // zero: zero seria uma venda de graça, aprovada por ninguém.
    assert.strictEqual(itens[1]._casamento, 'exato');
    assert.strictEqual(itens[1]._preco, null);
  } finally {
    await ctx.encerrar();
  }
});

test('sem código e sem nome que bata, o PREÇO ainda aponta a peça', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  const catalogo = [
    { id: 9, codigo: 'PR-210', nome: 'Painel Ripado 2,10', preco_tabela: '1.250,00' },
    { id: 10, codigo: 'ML-01', nome: 'Mesa Lateral Carvalho', preco_tabela: 450 }
  ];
  const casar = (nome, valor) =>
    casarProduto(null, nome, indexarPor(catalogo, 'codigo'), indexarPor(catalogo, 'nome'),
      catalogo, valor);

  // Um pedido escrito à mão traz o nome que o cliente inventou e nenhum código.
  // O preço é a última pista que ainda aponta para o catálogo.
  const r = casar('AQUELA MESINHA', 450);
  assert.strictEqual(r.registro.id, 10);
  assert.strictEqual(r.tipo, 'valor');

  // "1.250,00" é como o valor volta do banco: `Number` faria NaN disso, e a
  // peça mais cara do catálogo é justamente a que tem separador de milhar.
  assert.strictEqual(casar('SEI LÁ O QUE', '1.250,00').registro.id, 9);
});

test('preço parecido não é preço igual', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  const catalogo = [{ id: 10, codigo: 'ML-01', nome: 'Mesa Lateral Carvalho', preco_tabela: 450 }];
  const casar = valor =>
    casarProduto(null, 'NOME QUE NÃO EXISTE', indexarPor(catalogo, 'codigo'),
      indexarPor(catalogo, 'nome'), catalogo, valor);

  // Dois centavos de diferença podem ser outra peça inteira. Casar por perto
  // significaria vender a errada pelo preço da certa — o erro que ninguém
  // percebe até o pedido chegar ao cliente.
  assert.strictEqual(casar(450).registro.id, 10);
  assert.strictEqual(casar(449.98).registro, null);
  assert.strictEqual(casar(460).registro, null);
});

test('nome que acerta a família e o preço que escolhe a variante', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  // O catálogo de verdade: uma linha de peças com o mesmo nome-base e seis
  // variantes de tamanho e material.
  const catalogo = [
    { id: 1, codigo: 'BACR 3060 MNM', nome: 'Base Ao Cubo Retangular - G', preco_tabela: '2.064,29' },
    { id: 2, codigo: 'BACR 3060 NOG', nome: 'Base Ao Cubo Retangular - G', preco_tabela: '1.331,04' },
    { id: 3, codigo: 'BACR 2550 MNM', nome: 'Base Ao Cubo Retangular - M', preco_tabela: '1.687,37' },
    { id: 4, codigo: 'BACR 2550 NOG', nome: 'Base Ao Cubo Retangular - M', preco_tabela: '1.138,54' },
    { id: 5, codigo: 'BACR 1530 MNM', nome: 'Base Ao Cubo Retangular - P', preco_tabela: '1.022,89' },
    { id: 6, codigo: 'BACR 1530 NOG', nome: 'Base Ao Cubo Retangular - P', preco_tabela: '728,25' }
  ];
  const casar = (nome, valor) =>
    casarProduto(null, nome, indexarPor(catalogo, 'codigo'), indexarPor(catalogo, 'nome'),
      catalogo, valor);

  // O nome acerta a família e não diz qual das seis. Escolher no par ou ímpar
  // poria cinco sextos de chance de vender a peça errada. O preço praticado é
  // exatamente o que separa as seis.
  const r = casar('BASE AO CUBO 3060', '2064,29');
  assert.strictEqual(r.registro.codigo, 'BACR 3060 MNM');
  assert.strictEqual(r.tipo, 'valor');

  // Sem preço que sirva, o empate continua sendo empate.
  assert.strictEqual(casar('BASE AO CUBO 3060', '999,00').registro, null);
  assert.strictEqual(casar('BASE AO CUBO 3060', null).registro, null);
});

test('o preço do empate não sai da família que o nome apontou', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  const catalogo = [
    { id: 1, codigo: 'BACR-G', nome: 'Base Ao Cubo Retangular - G', preco_tabela: 900 },
    { id: 2, codigo: 'BACR-P', nome: 'Base Ao Cubo Retangular - P', preco_tabela: 700 },
    // Nada a ver com a família, e custa o que o pedido escreveu.
    { id: 9, codigo: 'VS-01', nome: 'Vaso Silvia M', preco_tabela: 450 }
  ];
  const r = casarProduto(null, 'BASE AO CUBO', indexarPor(catalogo, 'codigo'),
    indexarPor(catalogo, 'nome'), catalogo, 450);

  // O nome já apontou a família. Deixar um preço coincidente arrastar o item
  // para fora dela seria trocar uma informação boa por uma coincidência.
  assert.strictEqual(r.registro, null);
});

test('nome que aponta uma só peça ganha do preço de outra', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  const catalogo = [
    { id: 1, codigo: 'A', nome: 'Bandeja Vero PP', preco_tabela: 300 },
    { id: 2, codigo: 'B', nome: 'Castiçal Eixo G', preco_tabela: 999 }
  ];
  const r = casarProduto(null, 'Bandeja Vero PP Muiracatiara', indexarPor(catalogo, 'codigo'),
    indexarPor(catalogo, 'nome'), catalogo, 999);

  // Sem empate não há o que desempatar: o nome decidiu sozinho, e um valor
  // digitado errado não pode desfazer isso.
  assert.strictEqual(r.registro.codigo, 'A');
  assert.strictEqual(r.tipo, 'semelhante');
});

test('preços iguais: o nome desempata pelo que o texto contém', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  // O caso real: uma linha de peças em que TAMANHO e MATERIAL custam o mesmo.
  // O preço não separa nada aqui — o que separa é qual palavra do pedido cada
  // candidata carrega.
  const catalogo = [
    { id: 1, codigo: 'BACR 3060 MNM', nome: 'Base Ao Cubo Retangular - G', preco_tabela: '1.500,00' },
    { id: 2, codigo: 'BACR 3060 NOG', nome: 'Base Ao Cubo Retangular - G', preco_tabela: '1.500,00' },
    { id: 3, codigo: 'BACR 1530 MNM', nome: 'Base Ao Cubo Retangular - P', preco_tabela: '1.500,00' }
  ];
  const casar = nome =>
    casarProduto(null, nome, indexarPor(catalogo, 'codigo'), indexarPor(catalogo, 'nome'),
      catalogo, '1500');

  // "P" está no nome de uma só.
  assert.strictEqual(casar('BASE AO CUBO RETANGULAR P').registro.codigo, 'BACR 1530 MNM');
  // "1530" está no código de uma só.
  assert.strictEqual(casar('BASE AO CUBO 1530').registro.codigo, 'BACR 1530 MNM');
  // "3060" está em duas, e "MNM" resolve entre elas.
  assert.strictEqual(casar('BASE AO CUBO 3060 MNM').registro.codigo, 'BACR 3060 MNM');

  // "3060" sozinho está em DUAS: continua sem resposta, e sortear seria pôr
  // metade da chance de vender o material errado.
  assert.strictEqual(casar('BASE AO CUBO 3060').registro, null);
  // E o que não distingue nada também não decide.
  assert.strictEqual(casar('BASE AO CUBO').registro, null);
});

test('a palavra rara pesa mais que a comum no desempate', () => {
  const { desempatarPorConteudo } = require('./iaPreenchimento');
  const candidatas = [
    { codigo: 'A1', nome: 'Bandeja Bath Marron Importada' },
    { codigo: 'A2', nome: 'Bandeja Bath Bege Importada' },
    { codigo: 'A3', nome: 'Bandeja Bath Preta Importada' }
  ];

  // "bandeja", "bath" e "importada" aparecem nas três e não separam nada;
  // "marron" aparece numa e resolve sozinha. Contar as quatro igual faria as
  // comuns abafarem a única que decide.
  const r = desempatarPorConteudo('BANDEJA BATH/MARRON IMPORTADA', candidatas);
  assert.strictEqual(r.codigo, 'A1');

  // Sem nenhuma palavra que separe, não há desempate.
  assert.strictEqual(desempatarPorConteudo('BANDEJA BATH IMPORTADA', candidatas), null);
});

test('cobrir mais do que foi escrito vem primeiro', () => {
  const { desempatarPorConteudo } = require('./iaPreenchimento');
  const candidatas = [
    { codigo: 'A1', nome: 'Base Ao Cubo Retangular Grande Nogueira' },
    { codigo: 'A2', nome: 'Base Ao Cubo Retangular G' }
  ];

  // As duas contêm "base", "cubo" e "retangular". Só a segunda contém o "G", e
  // por isso cobre quatro das palavras escritas contra três.
  assert.strictEqual(
    desempatarPorConteudo('BASE AO CUBO RETANGULAR G', candidatas).codigo, 'A2');
});

test('cobrindo o mesmo tanto, ganha quem acertou a palavra que distingue', () => {
  const { desempatarPorConteudo } = require('./iaPreenchimento');
  const candidatas = [
    { codigo: 'A1', nome: 'Caixa Peroba' },
    { codigo: 'A2', nome: 'Caixa Marron' },
    { codigo: 'A3', nome: 'Caixa Peroba Bege' }
  ];

  // As três cobrem duas palavras de "CAIXA PEROBA MARRON" e empatam na conta
  // grossa. "Caixa" está nas três e não separa nada; "peroba" está em duas;
  // "marron" está numa só — e é ela que diz de qual peça o pedido fala.
  assert.strictEqual(
    desempatarPorConteudo('CAIXA PEROBA MARRON', candidatas).codigo, 'A2');
});

test('uma palavra rara não vale mais que a família inteira', () => {
  const { desempatarPorConteudo } = require('./iaPreenchimento');
  const candidatas = [
    { codigo: 'A1', nome: 'Caixa Acervo Peroba' },
    { codigo: 'A2', nome: 'Caixa Acervo Cedro' },
    { codigo: 'A3', nome: 'Caixa Acervo Marfim' },
    { codigo: 'A4', nome: 'Laca' }
  ];

  // "CAIXA ACERVO LACA": três candidatas cobrem duas palavras e empatam; a
  // quarta cobre uma só, mas é a única com "laca" — a palavra mais rara do
  // lote. Deixar a raridade decidir ANTES da cobertura escolheria "Laca" e
  // jogaria fora o que o pedido diz mais alto: a família é Caixa Acervo.
  //
  // A resposta certa é não ter resposta: as três da família são
  // indistinguíveis com o que está escrito.
  assert.strictEqual(desempatarPorConteudo('CAIXA ACERVO LACA', candidatas), null);
});

test('o desempate não inventa vencedor sem nada em comum', () => {
  const { desempatarPorConteudo } = require('./iaPreenchimento');
  const candidatas = [
    { codigo: 'A1', nome: 'Bandeja Bath Marron' },
    { codigo: 'A2', nome: 'Bandeja Bath Bege' }
  ];

  assert.strictEqual(desempatarPorConteudo('CADEIRA DOBRAVEL', candidatas), null);
  assert.strictEqual(desempatarPorConteudo('', candidatas), null);

  // Uma candidata só é o caso perigoso: não há com quem empatar, então nada
  // impede de devolvê-la por não ter concorrente. Só que "sem concorrente" não
  // é o mesmo que "é esta" — o texto continua não dizendo nada sobre ela.
  const unica = [{ codigo: 'Z9', nome: 'Bandeja Bath Marron' }];
  assert.strictEqual(desempatarPorConteudo('CADEIRA DOBRAVEL', unica), null);
  assert.strictEqual(desempatarPorConteudo('', unica), null);
  assert.strictEqual(desempatarPorConteudo(null, unica), null);

  // E com o que bate, ela vale.
  assert.strictEqual(desempatarPorConteudo('BANDEJA MARRON', unica).codigo, 'Z9');
});

test('o nome decide antes do código', () => {
  const { desempatarPorConteudo } = require('./iaPreenchimento');
  const candidatas = [
    // O código desta contém "grande", mas o nome não.
    { codigo: 'XX-GRANDE', nome: 'Mesa Lateral Carvalho' },
    // O nome desta contém "grande".
    { codigo: 'YY-01', nome: 'Mesa Lateral Grande' }
  ];

  // O nome é o que a pessoa lê e o que o documento costuma copiar; o código é
  // a última pista, para quando o nome empatou. Deixar o código passar à frente
  // faria uma coincidência de sigla ganhar de uma palavra escrita por extenso.
  const r = desempatarPorConteudo('MESA LATERAL GRANDE', candidatas);
  assert.strictEqual(r.codigo, 'YY-01');
});

test('nome fraco não estreita a busca por preço', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  const catalogo = [
    { id: 1, codigo: 'A', nome: 'Bandeja Vero PP', preco_tabela: 300 },
    { id: 2, codigo: 'B', nome: 'Castiçal Eixo G', preco_tabela: 999 }
  ];
  // "bandeja" em comum e mais nada: 0,33 de proximidade, longe do limiar de
  // 0,6. Isso não é um palpite — é uma palavra que por acaso se repete.
  const r = casarProduto(null, 'Bandeja Que Nao Existe De Jeito Nenhum',
    indexarPor(catalogo, 'codigo'), indexarPor(catalogo, 'nome'), catalogo, 999);

  // O preço tem de procurar no catálogo INTEIRO. Deixar uma semelhança fraca
  // estreitar a busca faria a peça certa ficar de fora por causa de uma
  // palavra solta.
  assert.strictEqual(r.registro.codigo, 'B');
  assert.strictEqual(r.tipo, 'valor');
});

test('item sem nome nenhum ainda pode casar pelo preço', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  const catalogo = [{ id: 1, codigo: 'A', nome: 'Bandeja Vero PP', preco_tabela: 300 }];
  const r = casarProduto(null, '', indexarPor(catalogo, 'codigo'),
    indexarPor(catalogo, 'nome'), catalogo, 300);

  // Uma célula de nome que veio vazia da planilha não é motivo para desistir
  // enquanto o valor ainda aponta para uma peça só.
  assert.strictEqual(r.registro.codigo, 'A');
});

test('duas peças pelo mesmo preço não escolhem nenhuma', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  // Tamanhos de uma mesma linha custando igual é o caso comum num catálogo.
  const catalogo = [
    { id: 11, codigo: 'BV-P', nome: 'Bandeja Vero P', preco_tabela: 300 },
    { id: 12, codigo: 'BV-G', nome: 'Bandeja Vero G', preco_tabela: 300 }
  ];
  const r = casarProduto(null, 'ALGO', indexarPor(catalogo, 'codigo'),
    indexarPor(catalogo, 'nome'), catalogo, 300);

  assert.strictEqual(r.registro, null);
});

test('o preço só entra depois que nome e código falharam', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  const catalogo = [
    { id: 9, codigo: 'PR-210', nome: 'Painel Ripado 2,10', preco_tabela: 900 },
    { id: 10, codigo: 'ML-01', nome: 'Mesa Lateral Carvalho', preco_tabela: 450 }
  ];
  // O pedido traz o nome certo da peça 9 e, por engano, o preço da peça 10.
  const r = casarProduto(null, 'Painel Ripado 2,10', indexarPor(catalogo, 'codigo'),
    indexarPor(catalogo, 'nome'), catalogo, 450);

  // O nome é uma pista muito mais forte que o preço: um número digitado errado
  // não pode desfazer um nome que bate exato.
  assert.strictEqual(r.registro.id, 9);
  assert.strictEqual(r.tipo, 'exato');
});

test('sem valor nenhum, não inventa casamento', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  const catalogo = [{ id: 10, codigo: 'ML-01', nome: 'Mesa', preco_tabela: 450 }];
  const casar = valor =>
    casarProduto(null, 'INEXISTENTE', indexarPor(catalogo, 'codigo'),
      indexarPor(catalogo, 'nome'), catalogo, valor);

  for (const vazio of [null, undefined, '', 0, 'grátis']) {
    assert.strictEqual(casar(vazio).registro, null, `casou com valor ${JSON.stringify(vazio)}`);
  }
});

test('preço zero não casa com peça de preço zero', () => {
  const { casarProduto, indexarPor } = require('./iaPreenchimento');
  // Peça sem preço praticado no cadastro, e um item cujo valor o documento não
  // trouxe. Sem a guarda, os dois "batem" em zero — e o pedido sai com uma
  // peça que ninguém escolheu, de graça.
  const catalogo = [{ id: 13, codigo: 'XX-01', nome: 'Peça sem preço', preco_tabela: 0 }];
  const r = casarProduto(null, 'QUALQUER COISA', indexarPor(catalogo, 'codigo'),
    indexarPor(catalogo, 'nome'), catalogo, 0);

  assert.strictEqual(r.registro, null);
});

test('o item casado pelo preço chega marcado como tal', async () => {
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Casa Vicenzo', razao_social: null, cnpj: null, validade: null,
      prazo: null, forma_pagamento: null, condicao_pagamento: null, parcelas: null,
      transportadora: null, contato: null, observacoes: null,
      itens: [{ codigo: null, nome: 'AQUELA MESINHA DE CANTO', quantidade: '1', valor_unitario: '450' }]
    }]
  });
  try {
    const [item] = (await (await chamar(ctx.porta, '/api/ia/5')).json()).itens[0].dados.itens;

    // É o casamento mais fraco que o programa aceita. A tela precisa saber
    // disso para avisar quem revisa antes de o preço sair para o cliente.
    assert.strictEqual(item._casamento, 'valor');
    assert.strictEqual(item._cadastro, 'Mesa Lateral Carvalho');
    assert.strictEqual(item._lido, 'AQUELA MESINHA DE CANTO');
    assert.strictEqual(item.codigo, 'ML-01');
  } finally {
    await ctx.encerrar();
  }
});

test('o item resolvido pelo preço chega à tela marcado como tal', async () => {
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Casa Vicenzo', razao_social: null, cnpj: null, validade: null,
      prazo: null, forma_pagamento: null, condicao_pagamento: null, parcelas: null,
      transportadora: null, contato: null, observacoes: null,
      // Nome que não bate com nada e o preço exato da Mesa Lateral.
      itens: [{ codigo: null, nome: 'AQUELA MESINHA', quantidade: '1', valor_unitario: '450' }]
    }]
  });
  try {
    const [item] = (await (await chamar(ctx.porta, '/api/ia/5')).json()).itens[0].dados.itens;

    // É deste campo que a tela tira a cor do (i). Sem ele chegando como
    // 'valor', o aviso não tem como aparecer — e quem revisa não fica sabendo
    // que a peça foi escolhida pelo dado mais fraco que o programa aceita.
    assert.strictEqual(item._casamento, 'valor');
    assert.strictEqual(item._cadastro, 'Mesa Lateral Carvalho');
    assert.strictEqual(item._lido, 'AQUELA MESINHA');
  } finally {
    await ctx.encerrar();
  }
});

test('o item resolvido pelo DESEMPATE de preço também chega marcado', async () => {
  const ctx = await prepararOrcamento({
    itens: [{
      cliente: 'Casa Vicenzo', razao_social: null, cnpj: null, validade: null,
      prazo: null, forma_pagamento: null, condicao_pagamento: null, parcelas: null,
      transportadora: null, contato: null, observacoes: null,
      // "Painel Ripado" fica parecido com "Painel Ripado 2,10" e o preço da
      // tabela fixa confirma qual é.
      itens: [{ codigo: null, nome: 'PAINEL RIPADO GRANDE', quantidade: '1', valor_unitario: '1250' }]
    }]
  });
  try {
    const [item] = (await (await chamar(ctx.porta, '/api/ia/5')).json()).itens[0].dados.itens;

    // Casou ou por semelhança de nome ou pelo preço — as duas são desfechos
    // legítimos. O que não pode é chegar sem casamento nenhum.
    assert.ok(['valor', 'semelhante'].includes(item._casamento),
      `casamento inesperado: ${item._casamento}`);
    assert.strictEqual(item._cadastro, 'Painel Ripado 2,10');
  } finally {
    await ctx.encerrar();
  }
});

test('trocar a peça pelo nome, com o código solto, casa com a nova', async () => {
  const ctx = await prepararOrcamento();
  try {
    const item = itensDa(ctx, 5)[0];
    const dados = JSON.parse(item.dados);

    // É o que a grade manda ao trocar o nome de uma peça já casada: nome novo,
    // código solto. Com o código velho junto, o casamento por CÓDIGO — que vem
    // primeiro porque é identidade — devolvia a peça ANTIGA, e a escolha da
    // pessoa era desfeita sem aviso.
    dados.itens[0] = {
      ...dados.itens[0], codigo: null, nome: 'Mesa Lateral Carvalho',
      _cadastro: null, _preco: null
    };

    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ dados })
    })).json();

    assert.strictEqual(salvo.dados.itens[0]._cadastro, 'Mesa Lateral Carvalho');
    assert.strictEqual(salvo.dados.itens[0]._casamento, 'exato');
    // E o código volta preenchido — da peça NOVA.
    assert.strictEqual(salvo.dados.itens[0].codigo, 'ML-01');
  } finally {
    await ctx.encerrar();
  }
});

test('com o código junto, ele manda — e é isso que se quer quando não mudou', async () => {
  const ctx = await prepararOrcamento();
  try {
    const item = itensDa(ctx, 5)[0];
    const dados = JSON.parse(item.dados);

    // Corrigir a quantidade não é trocar de peça: o código continua junto, e é
    // ele que identifica. Redescobrir por nome uma peça já identificada seria
    // trocar uma certeza por um palpite.
    dados.itens[0] = { ...dados.itens[0], quantidade: 7 };

    const salvo = await (await chamar(ctx.porta, `/api/ia/5/itens/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ dados })
    })).json();

    assert.strictEqual(salvo.dados.itens[0].codigo, 'PR-210');
    assert.strictEqual(salvo.dados.itens[0]._cadastro, 'Painel Ripado 2,10');
    assert.strictEqual(salvo.dados.itens[0].quantidade, 7);
  } finally {
    await ctx.encerrar();
  }
});

test('a peça do pedido se escolhe da lista, não se digita', async () => {
  const ctx = await prepararOrcamento();
  try {
    const detalhe = await (await chamar(ctx.porta, '/api/ia/5')).json();

    // Digitar um nome livre num pedido cria um item que o orçamento recusa —
    // e o erro só aparece do outro lado, com o formulário já aberto.
    assert.ok(Array.isArray(detalhe.sugestoes['itens.nome']));
    assert.ok(detalhe.sugestoes.__restritos.includes('itens.nome'));
  } finally {
    await ctx.encerrar();
  }
});
