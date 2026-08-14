/**
 * Testes do módulo Prospecções.
 *
 * O duplo da API remota abaixo NÃO é um mock complacente: ele reproduz de
 * propósito as limitações do Santissimo-db-API real —
 *
 *   • devolve as linhas em ordem de inserção e IGNORA `order`/`limit`/`select`;
 *   • filtra só por igualdade em coluna que existe;
 *   • aplica ON DELETE CASCADE como o banco faz.
 *
 * Os dados de apoio são inseridos FORA da ordem esperada justamente para que,
 * se o controller voltar a confiar na ordenação da API, o teste quebre.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  prospeccoes: [
    'id', 'nome_fantasia', 'razao_social', 'cnpj', 'inscricao_estadual', 'site', 'segmento',
    'origem', 'etapa', 'valor_estimado', 'probabilidade', 'responsavel_id',
    'proximo_passo', 'proximo_passo_data',
    'end_logradouro', 'end_numero', 'end_complemento', 'end_bairro',
    'end_cidade', 'end_uf', 'end_pais', 'end_cep',
    'status', 'motivo_perda', 'cliente_id', 'convertida_em',
    'anotacoes', 'criado_por', 'criado_em', 'atualizado_em'
  ],
  prospeccao_contatos: ['id', 'prospeccao_id', 'nome', 'cargo', 'email', 'telefone_fixo', 'telefone_celular', 'decisor', 'principal', 'observacao'],
  prospeccao_interacoes: ['id', 'prospeccao_id', 'contato_id', 'tipo', 'data', 'resumo', 'detalhe', 'duracao_min', 'usuario_id', 'passo_planejado', 'passo_planejado_data'],
  prospeccao_etapas_historico: ['id', 'prospeccao_id', 'etapa_anterior', 'etapa_nova', 'observacao', 'usuario_id', 'criado_em'],
  prospeccao_historico: ['id', 'prospeccao_id', 'tipo', 'acao', 'entidade', 'campo', 'valor_anterior', 'valor_novo', 'detalhe', 'observacao', 'usuario_id', 'criado_em'],
  prospeccao_notas: ['id', 'prospeccao_id', 'titulo', 'conteudo', 'usuario_id', 'criado_em'],
  prospeccao_campanhas: ['id', 'prospeccao_id', 'nome', 'canal', 'status', 'data_envio', 'resposta', 'observacao', 'usuario_id'],
  prospeccao_anexos: ['id', 'prospeccao_id', 'nota_id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes', 'usuario_id', 'criado_em'],
  orcamentos: ['id', 'numero', 'cliente_id', 'prospeccao_id', 'situacao'],
  clientes: ['id', 'nome_fantasia', 'razao_social', 'cnpj', 'status_cliente'],
  contatos_cliente: ['id', 'id_cliente', 'nome', 'cargo', 'email', 'telefone_fixo', 'telefone_celular'],
  usuarios: ['id', 'nome', 'perfil', 'modelo_permissoes_id'],
  modelos_permissoes: ['id', 'nome'],
  // Tabela real de permissões do módulo (`perm_pros` no catálogo). Sem ela no
  // duplo, todo usuário sem Sup Admin cai em "tudo negado" e um teste de
  // permissão específica passaria por vazio.
  perm_pros: [
    'id', 'modelo_id', 'modulo_ativo',
    'acao_view', 'acao_search', 'acao_details_view', 'acao_create',
    'acao_edit', 'acao_delete', 'acao_stage_update'
  ]
};

/** Filhas que caem junto com a prospecção (ON DELETE CASCADE no DDL real). */
const CASCATA = [
  'prospeccao_contatos', 'prospeccao_interacoes', 'prospeccao_etapas_historico',
  'prospeccao_notas', 'prospeccao_campanhas', 'prospeccao_anexos', 'prospeccao_historico'
];

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

      if (falharEm({ metodo: req.method, tabela, body })) {
        return responder(500, { error: 'Erro no INSERT', detalhe: 'falha simulada' });
      }

      if (!tabelas[tabela]) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
      const colunas = COLUNAS[tabela] || [];

      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Registro não encontrado' });
      }

      if (req.method === 'GET') {
        // Igual à API real: só entram no WHERE as chaves que são coluna real.
        // `order`, `limit` e `select` caem fora sem aviso — e a ordem devolvida
        // é a de inserção.
        let linhas = tabelas[tabela];
        for (const [chave, valor] of url.searchParams.entries()) {
          if (!colunas.includes(chave)) continue;
          linhas = linhas.filter(r => String(r[chave]) === String(valor));
        }
        return responder(200, linhas);
      }

      // Índice único PARCIAL do banco: no máximo um contato principal por
      // prospecção (`pros_contatos_principal_unq ... WHERE principal`). Sem
      // reproduzir isto aqui, o teste da troca de principal passaria por vazio.
      const violaPrincipal = (linha, ignorarId) =>
        tabela === 'prospeccao_contatos'
        && linha?.principal
        && tabelas.prospeccao_contatos.some(c =>
             c.principal
             && String(c.prospeccao_id) === String(linha.prospeccao_id)
             && String(c.id) !== String(ignorarId));

      if (req.method === 'POST') {
        if (violaPrincipal(body, null)) {
          return responder(500, {
            error: 'Erro no INSERT',
            detalhe: 'duplicate key value violates unique constraint \"pros_contatos_principal_unq\"'
          });
        }
        const proximo = Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1;
        const linha = { id: proximo };
        for (const c of colunas) if (body?.[c] !== undefined) linha[c] = body[c];
        linha.id = proximo;
        if (colunas.includes('criado_em') && !linha.criado_em) linha.criado_em = new Date().toISOString();
        if (colunas.includes('atualizado_em')) linha.atualizado_em = new Date().toISOString();
        tabelas[tabela].push(linha);
        return responder(201, linha);
      }

      if (req.method === 'PUT') {
        const alvo = tabelas[tabela].find(r => String(r.id) === String(id));
        if (!alvo) return responder(404, { error: 'Registro não encontrado' });
        if (violaPrincipal({ ...alvo, ...body }, id)) {
          return responder(500, {
            error: 'Erro no UPDATE',
            detalhe: 'duplicate key value violates unique constraint \"pros_contatos_principal_unq\"'
          });
        }
        for (const c of colunas) if (body?.[c] !== undefined) alvo[c] = body[c];
        // O trigger do banco carimba a data a cada UPDATE.
        if (colunas.includes('atualizado_em')) alvo.atualizado_em = new Date().toISOString();
        return responder(200, alvo);
      }

      if (req.method === 'DELETE') {
        const idx = tabelas[tabela].findIndex(r => String(r.id) === String(id));
        if (idx === -1) return responder(404, { error: 'Registro não encontrado' });
        const [removido] = tabelas[tabela].splice(idx, 1);
        if (tabela === 'prospeccoes') {
          for (const filha of CASCATA) {
            tabelas[filha] = (tabelas[filha] || []).filter(r => String(r.prospeccao_id) !== String(id));
          }
        }
        return responder(200, { sucesso: true, deletado: removido });
      }

      responder(405, { error: 'Método não suportado' });
    });
  });

  return { servidor, tabelas, chamadas };
}

const MODULOS = [
  './apiHttpClient', './permissionsController', './permissionsRepository', './prospeccoesController'
];

async function montar(dados, opcoes = {}) {
  const upstream = criarUpstream(dados, opcoes);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;

  // Limpa o cache dos módulos: permissionsController guarda usuário e
  // permissões em memória, e um teste vazaria no seguinte.
  for (const m of MODULOS) delete require.cache[require.resolve(m)];

  const app = express();
  app.use(express.json());
  app.use('/api/prospeccoes', require('./prospeccoesController'));

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

const ANTIGO = '2026-01-10T10:00:00.000Z';
const RECENTE = '2026-08-01T10:00:00.000Z';
const MEIO = '2026-05-15T10:00:00.000Z';

function baseDados() {
  return {
    usuarios: [
      { id: 1, nome: 'Henrique', perfil: 'Sup Admin', modelo_permissoes_id: null },
      { id: 2, nome: 'Vendedora Ana', perfil: 'Vendedor', modelo_permissoes_id: null },
      { id: 3, nome: 'João Silva', perfil: 'Vendedor', modelo_permissoes_id: null }
    ],
    modelos_permissoes: [],
    perm_pros: [],
    clientes: [],
    contatos_cliente: [],
    orcamentos: [],
    // Inseridas FORA de ordem cronológica de propósito.
    prospeccoes: [
      {
        id: 1, nome_fantasia: 'Antiga Ltda', razao_social: 'Antiga Comercio Ltda',
        cnpj: '11.111.111/0001-11', etapa: 'Qualificado', valor_estimado: 10000,
        probabilidade: 50, responsavel_id: 3, status: 'ativa',
        criado_em: ANTIGO, atualizado_em: ANTIGO
      },
      {
        id: 2, nome_fantasia: 'Recente SA', razao_social: 'Recente Participacoes SA',
        cnpj: '22.222.222/0001-22', etapa: 'Proposta', valor_estimado: 40000,
        probabilidade: 65, responsavel_id: 3, status: 'ativa',
        criado_em: RECENTE, atualizado_em: RECENTE
      },
      {
        id: 3, nome_fantasia: 'Meio Termo ME', etapa: 'Novo', valor_estimado: 5000,
        probabilidade: 10, responsavel_id: null, status: 'ativa',
        criado_em: MEIO, atualizado_em: MEIO
      },
      {
        id: 4, nome_fantasia: 'Ganha Convertida', razao_social: 'Ganha SA',
        cnpj: '44.444.444/0001-44', etapa: 'Ganho', valor_estimado: 90000,
        probabilidade: 100, status: 'arquivada', cliente_id: 77,
        criado_em: ANTIGO, atualizado_em: ANTIGO
      },
      {
        id: 5, nome_fantasia: 'Perdida Ltda', etapa: 'Perdido', valor_estimado: 30000,
        probabilidade: 0, status: 'arquivada', motivo_perda: 'Preço',
        criado_em: ANTIGO, atualizado_em: ANTIGO
      }
    ],
    // O principal é inserido DEPOIS do secundário, de novo para não deixar a
    // ordenação passar por acidente.
    prospeccao_contatos: [
      { id: 10, prospeccao_id: 1, nome: 'Zuleica Auxiliar', cargo: 'Assistente', email: 'z@antiga.com', principal: false, decisor: false },
      { id: 11, prospeccao_id: 1, nome: 'Alberto Decisor', cargo: 'Diretor', email: 'alberto@antiga.com', principal: true, decisor: true },
      { id: 12, prospeccao_id: 2, nome: 'Bruno Comprador', cargo: 'Compras', email: 'bruno@recente.com', principal: true, decisor: false }
    ],
    prospeccao_interacoes: [
      { id: 20, prospeccao_id: 1, tipo: 'Ligação', data: ANTIGO, resumo: 'Primeiro contato', usuario_id: 3 },
      { id: 21, prospeccao_id: 1, tipo: 'Reunião', data: RECENTE, resumo: 'Apresentação', usuario_id: 3 }
    ],
    prospeccao_historico: [],
    prospeccao_etapas_historico: [
      { id: 30, prospeccao_id: 1, etapa_anterior: null, etapa_nova: 'Novo', criado_em: ANTIGO, usuario_id: 3 }
    ],
    prospeccao_notas: [
      { id: 40, prospeccao_id: 1, titulo: 'Perfil', conteudo: 'Cliente exigente', usuario_id: 3, criado_em: ANTIGO },
      { id: 41, prospeccao_id: 2, titulo: 'Outra', conteudo: 'De outra prospeccao', usuario_id: 3, criado_em: ANTIGO }
    ],
    prospeccao_campanhas: [
      {
        id: 60, prospeccao_id: 1, nome: 'Lancamento outono', canal: 'E-mail',
        status: 'Em andamento', data_envio: '2026-08-01', resposta: null,
        observacao: null, usuario_id: 3
      }
    ],
    prospeccao_anexos: []
  };
}

// ---------------------------------------------------------------------------
// LISTA
// ---------------------------------------------------------------------------

test('GET /lista esconde arquivadas, ordena por atualizado_em e resolve responsável', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/lista');
    assert.strictEqual(resp.status, 200);
    const body = await resp.json();

    // 5 no banco, 2 arquivadas -> 3 visíveis.
    assert.strictEqual(body.itens.length, 3);

    // Ordenação decrescente feita pelo controller — a API devolveu 1,2,3.
    assert.deepStrictEqual(body.itens.map(i => i.nome_fantasia), [
      'Recente SA', 'Meio Termo ME', 'Antiga Ltda'
    ]);

    // JOIN manual de responsavel_id -> nome.
    assert.strictEqual(body.itens[0].responsavel, 'João Silva');
    assert.strictEqual(body.itens[1].responsavel, null);

    // Contato principal anexado à linha, mesmo tendo sido inserido depois.
    const antiga = body.itens.find(i => i.id === 1);
    assert.strictEqual(antiga.contato_principal.nome, 'Alberto Decisor');
  } finally {
    await ctx.encerrar();
  }
});

test('GET /lista?incluirArquivadas=1 traz as arquivadas', async () => {
  const ctx = await montar(baseDados());
  try {
    const body = await (await chamar(ctx.porta, '/api/prospeccoes/lista?incluirArquivadas=1')).json();
    assert.strictEqual(body.itens.length, 5);
  } finally {
    await ctx.encerrar();
  }
});

test('funil agrega por etapa e calcula taxa de conversão sobre o que fechou', async () => {
  const ctx = await montar(baseDados());
  try {
    const { funil } = await (await chamar(ctx.porta, '/api/prospeccoes/lista')).json();

    const porEtapa = Object.fromEntries(funil.etapas.map(e => [e.etapa, e]));
    assert.strictEqual(porEtapa['Novo'].quantidade, 1);
    assert.strictEqual(porEtapa['Qualificado'].quantidade, 1);
    assert.strictEqual(porEtapa['Proposta'].valor, 40000);
    assert.strictEqual(porEtapa['Ganho'].quantidade, 1);
    assert.strictEqual(porEtapa['Perdido'].quantidade, 1);

    // Em aberto: Qualificado + Proposta + Novo = 10000 + 40000 + 5000
    assert.strictEqual(funil.em_aberto, 3);
    assert.strictEqual(funil.valor_em_aberto, 55000);

    // Ponderado: 10000*0.5 + 40000*0.65 + 5000*0.10 = 5000 + 26000 + 500
    assert.strictEqual(funil.valor_ponderado, 31500);

    // 1 ganha de 2 fechadas = 50%. As 3 em andamento NÃO entram no denominador.
    assert.strictEqual(funil.taxa_conversao, 50);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// DETALHE
// ---------------------------------------------------------------------------

test('GET /:id agrega filhos, põe o contato principal primeiro e ordena a timeline', async () => {
  const ctx = await montar(baseDados());
  try {
    const body = await (await chamar(ctx.porta, '/api/prospeccoes/1')).json();

    assert.strictEqual(body.prospeccao.nome_fantasia, 'Antiga Ltda');
    assert.strictEqual(body.prospeccao.responsavel, 'João Silva');

    assert.strictEqual(body.contatos[0].nome, 'Alberto Decisor');
    assert.strictEqual(body.contatos[1].nome, 'Zuleica Auxiliar');

    // Mais recente primeiro, apesar de inserida por último.
    assert.deepStrictEqual(body.interacoes.map(i => i.resumo), ['Apresentação', 'Primeiro contato']);
    assert.strictEqual(body.interacoes[0].responsavel, 'João Silva');

    // Só as notas desta prospecção.
    assert.strictEqual(body.notas.length, 1);
    assert.strictEqual(body.notas[0].titulo, 'Perfil');
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// CRIAR
// ---------------------------------------------------------------------------

test('POST cria empresa, contatos e registra a etapa inicial', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes', {
      method: 'POST',
      body: JSON.stringify({
        nome_fantasia: 'Nova Empresa',
        cnpj: '99.999.999/0001-99',
        origem: 'Indicação',
        valor_estimado: '12.500,50',
        responsavel_id: 3,
        contatos: [
          { nome: 'Primeiro', cargo: 'Diretor', principal: true, decisor: true },
          { nome: 'Segundo', cargo: 'Compras' }
        ]
      })
    });

    assert.strictEqual(resp.status, 201);
    const { id } = await resp.json();

    const criada = ctx.tabelas.prospeccoes.find(p => p.id === id);
    assert.strictEqual(criada.nome_fantasia, 'Nova Empresa');
    assert.strictEqual(criada.etapa, 'Novo');
    // Probabilidade padrão da etapa Novo.
    assert.strictEqual(criada.probabilidade, 10);
    // "12.500,50" normalizado.
    assert.strictEqual(criada.valor_estimado, 12500.5);
    assert.strictEqual(criada.criado_por, 1);

    const contatos = ctx.tabelas.prospeccao_contatos.filter(c => c.prospeccao_id === id);
    assert.strictEqual(contatos.length, 2);

    // O histórico agora registra criação, etapa inicial e cada contato.
    const historico = ctx.tabelas.prospeccao_historico.filter(h => h.prospeccao_id === id);
    assert.strictEqual(historico.some(h => h.tipo === 'criacao' && h.acao === 'criou'), true);
    assert.strictEqual(historico.some(h => h.tipo === 'etapa' && h.valor_novo === 'Novo'), true);
    assert.strictEqual(historico.filter(h => h.tipo === 'contato').length, 2);
  } finally {
    await ctx.encerrar();
  }
});

test('POST recusa CNPJ que já tem prospecção ativa', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes', {
      method: 'POST',
      body: JSON.stringify({ nome_fantasia: 'Duplicada', cnpj: '11.111.111/0001-11' })
    });
    assert.strictEqual(resp.status, 409);
  } finally {
    await ctx.encerrar();
  }
});

test('POST aceita CNPJ cuja prospecção anterior foi arquivada', async () => {
  const ctx = await montar(baseDados());
  try {
    // 44.444.444/0001-44 pertence à prospecção 4, que está arquivada.
    const resp = await chamar(ctx.porta, '/api/prospeccoes', {
      method: 'POST',
      body: JSON.stringify({ nome_fantasia: 'Reabordagem', cnpj: '44.444.444/0001-44' })
    });
    assert.strictEqual(resp.status, 201);
  } finally {
    await ctx.encerrar();
  }
});

test('POST desfaz a prospecção quando a gravação de um contato falha', async () => {
  const ctx = await montar(baseDados(), {
    falharEm: ({ metodo, tabela }) => metodo === 'POST' && tabela === 'prospeccao_contatos'
  });
  try {
    const antes = ctx.tabelas.prospeccoes.length;
    const resp = await chamar(ctx.porta, '/api/prospeccoes', {
      method: 'POST',
      body: JSON.stringify({
        nome_fantasia: 'Vai Falhar',
        contatos: [{ nome: 'Contato' }]
      })
    });

    assert.strictEqual(resp.status >= 400, true);
    // Nada de registro meio criado: o rollback manual apagou.
    assert.strictEqual(ctx.tabelas.prospeccoes.length, antes);
    assert.strictEqual(ctx.tabelas.prospeccoes.some(p => p.nome_fantasia === 'Vai Falhar'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('POST recusa nome vazio e probabilidade fora da faixa', async () => {
  const ctx = await montar(baseDados());
  try {
    const semNome = await chamar(ctx.porta, '/api/prospeccoes', {
      method: 'POST', body: JSON.stringify({ nome_fantasia: '   ' })
    });
    assert.strictEqual(semNome.status, 400);

    const probRuim = await chamar(ctx.porta, '/api/prospeccoes', {
      method: 'POST', body: JSON.stringify({ nome_fantasia: 'X', probabilidade: 150 })
    });
    assert.strictEqual(probRuim.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// EDITAR
// ---------------------------------------------------------------------------

test('PUT edita a ficha mas NÃO deixa pular etapa por fora do funil', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({ nome_fantasia: 'Antiga Renomeada', etapa: 'Ganho' })
    });
    assert.strictEqual(resp.status, 200);

    const p = ctx.tabelas.prospeccoes.find(x => x.id === 1);
    assert.strictEqual(p.nome_fantasia, 'Antiga Renomeada');
    // A etapa continua a original: mover exige pros.stage.update e histórico.
    assert.strictEqual(p.etapa, 'Qualificado');
  } finally {
    await ctx.encerrar();
  }
});

test('PUT aplica os deltas de contatos', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        contatosNovos: [{ nome: 'Novo Contato', cargo: 'TI' }],
        contatosAtualizados: [{ id: 10, nome: 'Zuleica Promovida', cargo: 'Gerente' }],
        contatosExcluidos: [11]
      })
    });

    const contatos = ctx.tabelas.prospeccao_contatos.filter(c => Number(c.prospeccao_id) === 1);
    const nomes = contatos.map(c => c.nome).sort();
    assert.deepStrictEqual(nomes, ['Novo Contato', 'Zuleica Promovida']);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// FUNIL
// ---------------------------------------------------------------------------

test('PATCH /:id/etapa move, aplica probabilidade padrão e grava histórico', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/etapa', {
      method: 'PATCH',
      body: JSON.stringify({ etapa: 'Negociação', observacao: 'Cliente pediu proposta' })
    });
    assert.strictEqual(resp.status, 200);

    const p = ctx.tabelas.prospeccoes.find(x => x.id === 1);
    assert.strictEqual(p.etapa, 'Negociação');
    assert.strictEqual(p.probabilidade, 80);

    const hist = ctx.tabelas.prospeccao_historico.filter(h => String(h.prospeccao_id) === '1');
    const etapa = hist.find(h => h.tipo === 'etapa');
    assert.strictEqual(etapa.valor_anterior, 'Qualificado');
    assert.strictEqual(etapa.valor_novo, 'Negociação');
    assert.strictEqual(etapa.usuario_id, 1);
    // A mudança de probabilidade que acompanha a etapa vira evento próprio.
    const prob = hist.find(h => h.campo === 'probabilidade');
    assert.strictEqual(prob.valor_anterior, '50');
    assert.strictEqual(prob.valor_novo, '80');
  } finally {
    await ctx.encerrar();
  }
});

test('PATCH para Perdido exige motivo e arquiva', async () => {
  const ctx = await montar(baseDados());
  try {
    const semMotivo = await chamar(ctx.porta, '/api/prospeccoes/1/etapa', {
      method: 'PATCH', body: JSON.stringify({ etapa: 'Perdido' })
    });
    assert.strictEqual(semMotivo.status, 400);

    const comMotivo = await chamar(ctx.porta, '/api/prospeccoes/1/etapa', {
      method: 'PATCH',
      body: JSON.stringify({ etapa: 'Perdido', motivo_perda: 'Fechou com concorrente' })
    });
    assert.strictEqual(comMotivo.status, 200);

    const p = ctx.tabelas.prospeccoes.find(x => x.id === 1);
    assert.strictEqual(p.status, 'arquivada');
    assert.strictEqual(p.motivo_perda, 'Fechou com concorrente');
    assert.strictEqual(p.probabilidade, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('PATCH recusa etapa fora do funil', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/etapa', {
      method: 'PATCH', body: JSON.stringify({ etapa: 'Inventada' })
    });
    assert.strictEqual(resp.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// INTERAÇÕES E NOTAS
// ---------------------------------------------------------------------------

test('POST /:id/interacoes grava a interação e o próximo passo de uma vez', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/interacoes', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'Ligação',
        resumo: 'Retorno do cliente',
        duracao_min: 20,
        proximo_passo: 'Enviar proposta',
        proximo_passo_data: '2026-09-01'
      })
    });
    assert.strictEqual(resp.status, 201);

    const inter = ctx.tabelas.prospeccao_interacoes.filter(i => String(i.prospeccao_id) === '1');
    assert.strictEqual(inter.length, 3);
    assert.strictEqual(inter[inter.length - 1].resumo, 'Retorno do cliente');
    assert.strictEqual(inter[inter.length - 1].usuario_id, 1);

    const p = ctx.tabelas.prospeccoes.find(x => x.id === 1);
    assert.strictEqual(p.proximo_passo, 'Enviar proposta');
  } finally {
    await ctx.encerrar();
  }
});

test('POST /:id/interacoes recusa tipo inválido e resumo vazio', async () => {
  const ctx = await montar(baseDados());
  try {
    const tipoRuim = await chamar(ctx.porta, '/api/prospeccoes/1/interacoes', {
      method: 'POST', body: JSON.stringify({ tipo: 'Telepatia', resumo: 'x' })
    });
    assert.strictEqual(tipoRuim.status, 400);

    const semResumo = await chamar(ctx.porta, '/api/prospeccoes/1/interacoes', {
      method: 'POST', body: JSON.stringify({ tipo: 'Ligação', resumo: '  ' })
    });
    assert.strictEqual(semResumo.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('POST /:id/interacoes recusa contato de outra prospecção', async () => {
  const ctx = await montar(baseDados());
  try {
    // O contato 12 pertence à prospecção 2.
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/interacoes', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'Ligação', resumo: 'Tentativa', contato_id: 12 })
    });
    assert.strictEqual(resp.status, 400);
    assert.strictEqual(
      ctx.tabelas.prospeccao_interacoes.some(i => i.resumo === 'Tentativa'),
      false
    );

    // O contato 11 é da prospecção 1 — este passa.
    const ok = await chamar(ctx.porta, '/api/prospeccoes/1/interacoes', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'Ligação', resumo: 'Válida', contato_id: 11 })
    });
    assert.strictEqual(ok.status, 201);
  } finally {
    await ctx.encerrar();
  }
});

test('DELETE de nota recusa nota de OUTRA prospecção', async () => {
  const ctx = await montar(baseDados());
  try {
    // A nota 41 é da prospecção 2, não da 1.
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/notas/41', { method: 'DELETE' });
    assert.strictEqual(resp.status, 404);
    assert.strictEqual(ctx.tabelas.prospeccao_notas.some(n => n.id === 41), true);

    const certa = await chamar(ctx.porta, '/api/prospeccoes/1/notas/40', { method: 'DELETE' });
    assert.strictEqual(certa.status, 200);
    assert.strictEqual(ctx.tabelas.prospeccao_notas.some(n => n.id === 40), false);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// CONVERSÃO
// ---------------------------------------------------------------------------

test('POST /:id/converter cria cliente, copia contatos e arquiva a prospecção', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/converter', {
      method: 'POST',
      body: JSON.stringify({ dono_cliente: 'João Silva' })
    });
    assert.strictEqual(resp.status, 201);
    const { clienteId } = await resp.json();

    const cliente = ctx.tabelas.clientes.find(c => c.id === clienteId);
    assert.strictEqual(cliente.cnpj, '11.111.111/0001-11');
    assert.strictEqual(cliente.razao_social, 'Antiga Comercio Ltda');

    // Os dois contatos foram copiados para contatos_cliente.
    const copiados = ctx.tabelas.contatos_cliente.filter(c => c.id_cliente === clienteId);
    assert.strictEqual(copiados.length, 2);

    // A prospecção sobrevive, arquivada, apontando para o cliente.
    const p = ctx.tabelas.prospeccoes.find(x => x.id === 1);
    assert.strictEqual(p.etapa, 'Ganho');
    assert.strictEqual(p.status, 'arquivada');
    assert.strictEqual(p.cliente_id, clienteId);
    assert.ok(p.convertida_em);

    // E a timeline continua lá.
    assert.strictEqual(ctx.tabelas.prospeccao_interacoes.filter(i => String(i.prospeccao_id) === '1').length, 2);
  } finally {
    await ctx.encerrar();
  }
});

test('conversão exige os dados fiscais que o cadastro de prospecção não pede', async () => {
  const ctx = await montar(baseDados());
  try {
    // A prospecção 3 nasceu sem CNPJ nem razão social — legítimo para um lead.
    const resp = await chamar(ctx.porta, '/api/prospeccoes/3/converter', { method: 'POST' });
    assert.strictEqual(resp.status, 422);
    const body = await resp.json();
    assert.deepStrictEqual(body.camposFaltantes, ['Razão Social', 'CNPJ']);
    assert.strictEqual(ctx.tabelas.clientes.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('conversão recusa prospecção já convertida', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/4/converter', { method: 'POST' });
    assert.strictEqual(resp.status, 409);
  } finally {
    await ctx.encerrar();
  }
});

test('conversão desfaz o cliente se a prospecção não puder ser fechada', async () => {
  const ctx = await montar(baseDados(), {
    falharEm: ({ metodo, tabela, body }) =>
      metodo === 'PUT' && tabela === 'prospeccoes' && body?.status === 'arquivada'
  });
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/converter', { method: 'POST' });
    assert.strictEqual(resp.status >= 400, true);
    // Sem rollback ficariam cliente e prospecção vivos, e o próximo "Converter"
    // esbarraria no CNPJ duplicado.
    assert.strictEqual(ctx.tabelas.clientes.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// EXCLUSÃO
// ---------------------------------------------------------------------------

test('DELETE remove a prospecção e os filhos em cascata', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1', { method: 'DELETE' });
    assert.strictEqual(resp.status, 200);

    assert.strictEqual(ctx.tabelas.prospeccoes.some(p => p.id === 1), false);
    assert.strictEqual(ctx.tabelas.prospeccao_contatos.some(c => String(c.prospeccao_id) === '1'), false);
    assert.strictEqual(ctx.tabelas.prospeccao_interacoes.some(i => String(i.prospeccao_id) === '1'), false);
    assert.strictEqual(ctx.tabelas.prospeccao_notas.some(n => String(n.prospeccao_id) === '1'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('DELETE recusa prospecção já convertida em cliente', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/4', { method: 'DELETE' });
    assert.strictEqual(resp.status, 400);
    assert.strictEqual(ctx.tabelas.prospeccoes.some(p => p.id === 4), true);
  } finally {
    await ctx.encerrar();
  }
});

test('DELETE recusa prospecção com orçamento vinculado', async () => {
  const dados = baseDados();
  dados.orcamentos.push({ id: 500, numero: 'ORC1', prospeccao_id: 1, situacao: 'Aberto' });
  const ctx = await montar(dados);
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1', { method: 'DELETE' });
    assert.strictEqual(resp.status, 400);
    assert.strictEqual(ctx.tabelas.prospeccoes.some(p => p.id === 1), true);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// PERMISSÕES
// ---------------------------------------------------------------------------

test('usuário sem permissão recebe 403 e não altera nada', async () => {
  const ctx = await montar(baseDados());
  try {
    // O usuário 2 não é Sup Admin e não tem modelo de permissões -> tudo negado.
    const lista = await chamar(ctx.porta, '/api/prospeccoes/lista', { usuario: 2 });
    assert.strictEqual(lista.status, 403);

    const criar = await chamar(ctx.porta, '/api/prospeccoes', {
      usuario: 2, method: 'POST', body: JSON.stringify({ nome_fantasia: 'Proibida' })
    });
    assert.strictEqual(criar.status, 403);
    assert.strictEqual(ctx.tabelas.prospeccoes.some(p => p.nome_fantasia === 'Proibida'), false);

    const excluir = await chamar(ctx.porta, '/api/prospeccoes/1', { usuario: 2, method: 'DELETE' });
    assert.strictEqual(excluir.status, 403);
    assert.strictEqual(ctx.tabelas.prospeccoes.some(p => p.id === 1), true);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Histórico universal
//
// A regra é: TODA alteração vira evento, e o evento guarda o que era ANTES.
// Em exclusão, o registro inteiro é fotografado — é a única coisa capaz de
// responder "o que essa nota dizia?" depois que ela deixou de existir.
// ---------------------------------------------------------------------------

test('editar a ficha registra um evento por campo, com o valor anterior', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Renomeada',
        valor_estimado: 25000,
        origem: 'Feira'
      })
    });

    const hist = ctx.tabelas.prospeccao_historico.filter(h => String(h.prospeccao_id) === '1');
    const porCampo = Object.fromEntries(hist.filter(h => h.campo).map(h => [h.campo, h]));

    assert.strictEqual(porCampo.nome_fantasia.valor_anterior, 'Antiga Ltda');
    assert.strictEqual(porCampo.nome_fantasia.valor_novo, 'Antiga Renomeada');
    assert.strictEqual(porCampo.valor_estimado.valor_anterior, '10000');
    assert.strictEqual(porCampo.valor_estimado.valor_novo, '25000');
    assert.strictEqual(porCampo.origem.valor_novo, 'Feira');
    assert.strictEqual(porCampo.nome_fantasia.acao, 'alterou');
  } finally {
    await ctx.encerrar();
  }
});

test('campo que nao mudou NAO gera evento', async () => {
  const ctx = await montar(baseDados());
  try {
    // Regrava exatamente o que ja estava la.
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        razao_social: 'Antiga Comercio Ltda',
        cnpj: '11.111.111/0001-11',
        // Numero vindo como texto: o historico nao pode enxergar mudanca onde
        // nao houve, senao enche de ruido a cada gravacao.
        valor_estimado: '10000.00',
        probabilidade: 50
      })
    });

    const hist = ctx.tabelas.prospeccao_historico.filter(h => String(h.prospeccao_id) === '1');
    assert.deepStrictEqual(hist.map(h => h.campo).filter(Boolean), []);
  } finally {
    await ctx.encerrar();
  }
});

test('excluir nota guarda o conteudo no historico', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1/notas/40', { method: 'DELETE' });

    const evento = ctx.tabelas.prospeccao_historico.find(h => h.tipo === 'nota' && h.acao === 'excluiu');
    assert.ok(evento, 'a exclusao da nota deveria virar evento');
    // O conteudo sobrevive a exclusao — e o ponto da auditoria.
    assert.strictEqual(evento.valor_anterior, 'Cliente exigente');
    assert.strictEqual(evento.detalhe.registro.titulo, 'Perfil');
    // Retrato rotulado, que é o que a tela mostra.
    assert.ok(evento.detalhe.campos.some(c => c.rotulo === 'Conteúdo'));
    assert.strictEqual(ctx.tabelas.prospeccao_notas.some(n => n.id === 40), false);
  } finally {
    await ctx.encerrar();
  }
});

test('excluir campanha some da lista mas fica detalhada no historico', async () => {
  const dados = baseDados();
  dados.prospeccao_campanhas.push({
    id: 70, prospeccao_id: 1, nome: 'Outbound Q3', canal: 'E-mail',
    status: 'Concluída', resposta: 'Interessado'
  });
  const ctx = await montar(dados);
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1/campanhas/70', { method: 'DELETE' });

    assert.strictEqual(ctx.tabelas.prospeccao_campanhas.some(c => c.id === 70), false);
    const evento = ctx.tabelas.prospeccao_historico.find(h => h.tipo === 'campanha' && h.acao === 'excluiu');
    assert.match(evento.valor_anterior, /Outbound Q3/);
    assert.match(evento.valor_anterior, /Interessado/);
    assert.strictEqual(evento.detalhe.registro.canal, 'E-mail');
    assert.ok(evento.detalhe.campos.some(c => c.rotulo === 'Canal' && c.valor === 'E-mail'));
  } finally {
    await ctx.encerrar();
  }
});

test('excluir contato guarda como ele era', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({ nome_fantasia: 'Antiga Ltda', contatosExcluidos: [11] })
    });

    const evento = ctx.tabelas.prospeccao_historico.find(h => h.tipo === 'contato' && h.acao === 'excluiu');
    assert.match(evento.entidade, /Alberto Decisor/);
    assert.match(evento.valor_anterior, /Diretor/);
    // O registro cru continua guardado, agora ao lado do retrato rotulado.
    assert.strictEqual(evento.detalhe.registro.email, 'alberto@antiga.com');

    // O retrato é o que se lê na tela: ninguém decifra {"telefone_fixo": null}.
    const campos = evento.detalhe.campos;
    assert.ok(Array.isArray(campos) && campos.length, 'faltou o retrato legível');
    assert.deepStrictEqual(
      campos.find(c => c.rotulo === 'E-mail'),
      { rotulo: 'E-mail', valor: 'alberto@antiga.com' }
    );
    // Campo vazio não entra: encheria a tela de "—".
    assert.strictEqual(campos.some(c => c.valor === '' || c.valor === 'null'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('conversao registra conversao, etapa e arquivamento', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1/converter', { method: 'POST' });

    const hist = ctx.tabelas.prospeccao_historico.filter(h => String(h.prospeccao_id) === '1');
    const tipos = hist.map(h => h.tipo);
    assert.ok(tipos.includes('conversao'));
    assert.ok(tipos.includes('etapa'));
    assert.ok(tipos.includes('arquivamento'));

    const conv = hist.find(h => h.tipo === 'conversao');
    assert.strictEqual(conv.acao, 'converteu');
    assert.match(conv.valor_novo, /^Cliente #/);
  } finally {
    await ctx.encerrar();
  }
});

test('registrar interacao e proximo passo viram eventos', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1/interacoes', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'Ligação', resumo: 'Retorno do cliente' })
    });
    await chamar(ctx.porta, '/api/prospeccoes/1/proximo-passo', {
      method: 'PUT',
      body: JSON.stringify({ proximo_passo: 'Enviar contrato', proximo_passo_data: '2026-09-20' })
    });

    const hist = ctx.tabelas.prospeccao_historico.filter(h => String(h.prospeccao_id) === '1');
    assert.ok(hist.some(h => h.tipo === 'interacao' && /Retorno do cliente/.test(h.entidade)));
    assert.ok(hist.some(h => h.campo === 'proximo_passo' && h.valor_novo === 'Enviar contrato'));
    assert.ok(hist.some(h => h.campo === 'proximo_passo_data' && h.valor_novo === '2026-09-20'));
  } finally {
    await ctx.encerrar();
  }
});

test('so o Sup Admin apaga evento do historico', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1/notas', {
      method: 'POST', body: JSON.stringify({ conteudo: 'para gerar evento' })
    });
    const evento = ctx.tabelas.prospeccao_historico.find(h => h.tipo === 'nota');
    assert.ok(evento);

    // Usuario 2 e Vendedor: barrado mesmo que tivesse a permissao do modulo.
    const negado = await chamar(ctx.porta, `/api/prospeccoes/1/historico/${evento.id}`, {
      usuario: 2, method: 'DELETE'
    });
    assert.strictEqual(negado.status, 403);
    assert.strictEqual(ctx.tabelas.prospeccao_historico.some(h => h.id === evento.id), true);

    // Usuario 1 e Sup Admin.
    const permitido = await chamar(ctx.porta, `/api/prospeccoes/1/historico/${evento.id}`, {
      usuario: 1, method: 'DELETE'
    });
    assert.strictEqual(permitido.status, 200);
    assert.strictEqual(ctx.tabelas.prospeccao_historico.some(h => h.id === evento.id), false);
  } finally {
    await ctx.encerrar();
  }
});

test('nao da para apagar evento de OUTRA prospeccao', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/2/notas', {
      method: 'POST', body: JSON.stringify({ conteudo: 'da prospeccao 2' })
    });
    const evento = ctx.tabelas.prospeccao_historico.find(h => String(h.prospeccao_id) === '2');

    const resp = await chamar(ctx.porta, `/api/prospeccoes/1/historico/${evento.id}`, { method: 'DELETE' });
    assert.strictEqual(resp.status, 404);
    assert.strictEqual(ctx.tabelas.prospeccao_historico.some(h => h.id === evento.id), true);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Fluxo do passo planejado
//
// A ideia central: o combinado em aberto nunca some sem deixar rastro. Trocar
// ou concluir um passo produz uma "Atividade realizada" na timeline, com o
// texto do passo guardado ao lado do que de fato aconteceu.
// ---------------------------------------------------------------------------

/** Prospecção 1 da massa base ganha um passo em aberto. */
function comPassoAberto() {
  const dados = baseDados();
  const p = dados.prospeccoes.find(x => x.id === 1);
  p.proximo_passo = 'Ligar para o Alberto';
  p.proximo_passo_data = '2026-09-10';
  return dados;
}

test('trocar o proximo passo exige dizer o que houve com o anterior', async () => {
  const ctx = await montar(comPassoAberto());
  try {
    const semNota = await chamar(ctx.porta, '/api/prospeccoes/1/proximo-passo', {
      method: 'PUT',
      body: JSON.stringify({ proximo_passo: 'Enviar proposta', proximo_passo_data: '2026-09-20' })
    });
    assert.strictEqual(semNota.status, 400);
    // Nada mudou: nem o passo, nem a timeline.
    assert.strictEqual(ctx.tabelas.prospeccoes.find(p => p.id === 1).proximo_passo, 'Ligar para o Alberto');
    assert.strictEqual(ctx.tabelas.prospeccao_interacoes.some(i => i.tipo === 'Atividade realizada'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('com a nota, o passo anterior vira Atividade realizada', async () => {
  const ctx = await montar(comPassoAberto());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/proximo-passo', {
      method: 'PUT',
      body: JSON.stringify({
        proximo_passo: 'Enviar proposta',
        proximo_passo_data: '2026-09-20',
        nota_passo_anterior: 'Alberto pediu para ligar depois do feriado'
      })
    });
    assert.strictEqual(resp.status, 200);

    const atividade = ctx.tabelas.prospeccao_interacoes.find(i => i.tipo === 'Atividade realizada');
    assert.ok(atividade, 'deveria ter criado a atividade');
    // O resumo é o passo COMBINADO; o detalhe é o que aconteceu.
    assert.strictEqual(atividade.resumo, 'Ligar para o Alberto');
    assert.strictEqual(atividade.detalhe, 'Alberto pediu para ligar depois do feriado');
    assert.strictEqual(atividade.passo_planejado, 'Ligar para o Alberto');
    assert.strictEqual(atividade.passo_planejado_data, '2026-09-10');

    assert.strictEqual(ctx.tabelas.prospeccoes.find(p => p.id === 1).proximo_passo, 'Enviar proposta');
  } finally {
    await ctx.encerrar();
  }
});

test('sem passo anterior, definir o primeiro nao exige nota', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/3/proximo-passo', {
      method: 'PUT',
      body: JSON.stringify({ proximo_passo: 'Primeiro contato', proximo_passo_data: '2026-09-01' })
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(ctx.tabelas.prospeccao_interacoes.some(i => i.tipo === 'Atividade realizada'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('concluir o passo registra atividade e encerra o combinado', async () => {
  const ctx = await montar(comPassoAberto());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/concluir-passo', {
      method: 'POST',
      body: JSON.stringify({ nota: 'Liguei, ele confirmou interesse.' })
    });
    assert.strictEqual(resp.status, 200);

    const atividade = ctx.tabelas.prospeccao_interacoes.find(i => i.tipo === 'Atividade realizada');
    assert.strictEqual(atividade.resumo, 'Ligar para o Alberto');

    // Sem novo passo, o antigo não pode continuar em aberto: ele acabou de ser
    // concluído e ficaria eternamente marcado como pendente.
    const p = ctx.tabelas.prospeccoes.find(x => x.id === 1);
    assert.strictEqual(p.proximo_passo, null);
    assert.strictEqual(p.proximo_passo_data, null);
  } finally {
    await ctx.encerrar();
  }
});

test('concluir sem nota e recusado', async () => {
  const ctx = await montar(comPassoAberto());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/concluir-passo', {
      method: 'POST', body: JSON.stringify({})
    });
    assert.strictEqual(resp.status, 400);
    assert.strictEqual(ctx.tabelas.prospeccao_interacoes.some(i => i.tipo === 'Atividade realizada'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('concluir sem passo planejado e recusado', async () => {
  const ctx = await montar(baseDados());
  try {
    // A prospecção 3 não tem passo em aberto.
    const resp = await chamar(ctx.porta, '/api/prospeccoes/3/concluir-passo', {
      method: 'POST', body: JSON.stringify({ nota: 'qualquer coisa' })
    });
    assert.strictEqual(resp.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('concluir movendo no funil e encadeando o proximo passo', async () => {
  const ctx = await montar(comPassoAberto());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/concluir-passo', {
      method: 'POST',
      body: JSON.stringify({
        nota: 'Reunião feita, escopo aprovado.',
        etapa: 'Proposta',
        proximo_passo: 'Montar a proposta',
        proximo_passo_data: '2026-09-30'
      })
    });
    assert.strictEqual(resp.status, 200);

    const p = ctx.tabelas.prospeccoes.find(x => x.id === 1);
    assert.strictEqual(p.etapa, 'Proposta');
    // A probabilidade acompanha a etapa.
    assert.strictEqual(p.probabilidade, 65);
    assert.strictEqual(p.proximo_passo, 'Montar a proposta');

    const hist = ctx.tabelas.prospeccao_historico.filter(h => String(h.prospeccao_id) === '1');
    assert.ok(hist.some(h => h.tipo === 'interacao' && /Atividade realizada/.test(h.entidade)));
    assert.ok(hist.some(h => h.tipo === 'etapa' && h.valor_novo === 'Proposta'));
    assert.ok(hist.some(h => h.campo === 'proximo_passo' && h.valor_novo === 'Montar a proposta'));
  } finally {
    await ctx.encerrar();
  }
});

test('concluir marcando Perdido exige motivo e arquiva', async () => {
  const ctx = await montar(comPassoAberto());
  try {
    const semMotivo = await chamar(ctx.porta, '/api/prospeccoes/1/concluir-passo', {
      method: 'POST',
      body: JSON.stringify({ nota: 'Cliente desistiu', etapa: 'Perdido' })
    });
    assert.strictEqual(semMotivo.status, 400);

    const comMotivo = await chamar(ctx.porta, '/api/prospeccoes/1/concluir-passo', {
      method: 'POST',
      body: JSON.stringify({ nota: 'Cliente desistiu', etapa: 'Perdido', motivo_perda: 'Sem verba' })
    });
    assert.strictEqual(comMotivo.status, 200);

    const p = ctx.tabelas.prospeccoes.find(x => x.id === 1);
    assert.strictEqual(p.etapa, 'Perdido');
    assert.strictEqual(p.status, 'arquivada');
    assert.strictEqual(p.motivo_perda, 'Sem verba');
  } finally {
    await ctx.encerrar();
  }
});

test('concluir com converter apenas SINALIZA, nao converte por baixo', async () => {
  const ctx = await montar(comPassoAberto());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/concluir-passo', {
      method: 'POST',
      body: JSON.stringify({ nota: 'Cliente fechou!', converter: true })
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual((await resp.json()).converter, true);

    // Nenhum cliente criado aqui: a conversão passa pelo fluxo próprio, que
    // confere os dados fiscais e pede status e dono.
    assert.strictEqual(ctx.tabelas.clientes.length, 0);
    assert.strictEqual(ctx.tabelas.prospeccoes.find(p => p.id === 1).cliente_id, undefined);
  } finally {
    await ctx.encerrar();
  }
});

test('concluir recusa etapa invalida', async () => {
  const ctx = await montar(comPassoAberto());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/concluir-passo', {
      method: 'POST',
      body: JSON.stringify({ nota: 'x', etapa: 'Inventada' })
    });
    assert.strictEqual(resp.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('concluir sem permissao de mover no funil e barrado', async () => {
  const ctx = await montar(comPassoAberto());
  try {
    // Usuário 2 não é Sup Admin e não tem modelo: tudo negado.
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/concluir-passo', {
      usuario: 2, method: 'POST',
      body: JSON.stringify({ nota: 'x', etapa: 'Proposta' })
    });
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(ctx.tabelas.prospeccao_interacoes.some(i => i.tipo === 'Atividade realizada'), false);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Responsável
//
// Trocar quem cuida da prospecção é decisão de gestão: privativo do Sup Admin,
// tanto pela rota dedicada quanto pelo PUT de edição — senão o botão restrito
// na grade seria decorativo.
// ---------------------------------------------------------------------------

test('Sup Admin troca o responsavel e o historico guarda o anterior', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/responsavel', {
      method: 'PUT',
      body: JSON.stringify({ responsavel_id: 2, observacao: 'Redistribuicao de carteira' })
    });
    assert.strictEqual(resp.status, 200);

    const p = ctx.tabelas.prospeccoes.find(x => x.id === 1);
    assert.strictEqual(p.responsavel_id, 2);

    const evento = ctx.tabelas.prospeccao_historico.find(h => h.tipo === 'responsavel');
    assert.strictEqual(evento.valor_anterior, 'João Silva');
    assert.strictEqual(evento.valor_novo, 'Vendedora Ana');
    assert.strictEqual(evento.observacao, 'Redistribuicao de carteira');
  } finally {
    await ctx.encerrar();
  }
});

test('trocar responsavel NAO mexe em quem cadastrou', async () => {
  const dados = baseDados();
  dados.prospeccoes.find(p => p.id === 1).criado_por = 3;
  const ctx = await montar(dados);
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1/responsavel', {
      method: 'PUT', body: JSON.stringify({ responsavel_id: 2 })
    });
    // Quem cadastrou é fato histórico; quem responde hoje é atribuição.
    assert.strictEqual(ctx.tabelas.prospeccoes.find(p => p.id === 1).criado_por, 3);
  } finally {
    await ctx.encerrar();
  }
});

test('nao Sup Admin nao troca responsavel pela rota dedicada', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/responsavel', {
      usuario: 2, method: 'PUT', body: JSON.stringify({ responsavel_id: 2 })
    });
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(ctx.tabelas.prospeccoes.find(p => p.id === 1).responsavel_id, 3);
  } finally {
    await ctx.encerrar();
  }
});

test('o PUT de edicao tambem barra a troca de responsavel', async () => {
  const ctx = await montar(baseDados());
  try {
    // Usuario 2 nao e Sup Admin — sem esta trava, bastaria abrir "Editar"
    // para contornar a restricao do botao na grade.
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1', {
      usuario: 2, method: 'PUT',
      body: JSON.stringify({ nome_fantasia: 'Antiga Ltda', responsavel_id: 2 })
    });
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(ctx.tabelas.prospeccoes.find(p => p.id === 1).responsavel_id, 3);
  } finally {
    await ctx.encerrar();
  }
});

test('responsavel inexistente e recusado', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/responsavel', {
      method: 'PUT', body: JSON.stringify({ responsavel_id: 999 })
    });
    assert.strictEqual(resp.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('trocar para o mesmo responsavel nao gera evento', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/responsavel', {
      method: 'PUT', body: JSON.stringify({ responsavel_id: 3 })
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual((await resp.json()).semMudanca, true);
    assert.strictEqual(ctx.tabelas.prospeccao_historico.some(h => h.tipo === 'responsavel'), false);
  } finally {
    await ctx.encerrar();
  }
});


// ---------------------------------------------------------------------------
// Edição de notas, atividades e campanhas
//
// Editar é permitido; apagar o rastro não. Cada campo alterado vira uma linha
// do histórico com o valor anterior ao lado do novo — um despejo do registro
// inteiro obrigaria quem lê a caçar a diferença.
// ---------------------------------------------------------------------------

const eventosDe = (ctx, tipo) =>
  ctx.tabelas.prospeccao_historico.filter(h => h.tipo === tipo && h.acao === 'alterou');

test('editar uma nota grava um evento por campo, com o valor anterior', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/notas/40', {
      method: 'PUT',
      body: JSON.stringify({ titulo: 'Atenção ao decisor', conteudo: 'Quem assina é o Eduardo.' })
    });
    assert.strictEqual(resp.status, 200);

    const nota = ctx.tabelas.prospeccao_notas.find(n => n.id === 40);
    assert.strictEqual(nota.titulo, 'Atenção ao decisor');
    assert.strictEqual(nota.conteudo, 'Quem assina é o Eduardo.');

    const eventos = eventosDe(ctx, 'nota');
    const campos = eventos.map(e => e.campo).sort();
    assert.deepStrictEqual(campos, ['conteudo', 'titulo']);

    const conteudo = eventos.find(e => e.campo === 'conteudo');
    assert.ok(conteudo.valor_anterior, 'faltou o valor anterior do conteúdo');
    assert.strictEqual(conteudo.valor_novo, 'Quem assina é o Eduardo.');
  } finally {
    await ctx.encerrar();
  }
});

test('campo que não mudou não vira linha no histórico', async () => {
  // Ruído de auditoria é tão ruim quanto ausência: se toda gravação registra
  // tudo, ninguém mais lê o histórico.
  const ctx = await montar(baseDados());
  try {
    const antes = ctx.tabelas.prospeccao_notas.find(n => n.id === 40);
    await chamar(ctx.porta, '/api/prospeccoes/1/notas/40', {
      method: 'PUT',
      body: JSON.stringify({ titulo: antes.titulo, conteudo: 'Só o conteúdo mudou' })
    });
    const campos = eventosDe(ctx, 'nota').map(e => e.campo);
    assert.deepStrictEqual(campos, ['conteudo']);
  } finally {
    await ctx.encerrar();
  }
});

test('nota vazia é recusada e nada é gravado', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/notas/40', {
      method: 'PUT', body: JSON.stringify({ conteudo: '   ' })
    });
    assert.strictEqual(resp.status, 400);
    assert.strictEqual(eventosDe(ctx, 'nota').length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('não dá para editar a nota de OUTRA prospecção pelo caminho', async () => {
  // O id do caminho não é validado por ninguém: /prospeccoes/2/notas/40
  // alteraria a nota da prospecção 1.
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/2/notas/40', {
      method: 'PUT', body: JSON.stringify({ conteudo: 'invasão' })
    });
    assert.strictEqual(resp.status, 404);
    assert.notStrictEqual(ctx.tabelas.prospeccao_notas.find(n => n.id === 40).conteudo, 'invasão');
  } finally {
    await ctx.encerrar();
  }
});

test('editar uma campanha registra status e resposta separadamente', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/campanhas/60', {
      method: 'PUT',
      body: JSON.stringify({
        nome: 'Lançamento outono', canal: 'E-mail',
        status: 'Concluída', resposta: 'Pediu proposta'
      })
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(ctx.tabelas.prospeccao_campanhas.find(c => c.id === 60).status, 'Concluída');

    const status = eventosDe(ctx, 'campanha').find(e => e.campo === 'status');
    assert.ok(status, 'faltou o evento de status');
    assert.strictEqual(status.valor_novo, 'Concluída');
    assert.ok(status.valor_anterior, 'faltou o status anterior');
  } finally {
    await ctx.encerrar();
  }
});

test('status de campanha inválido é recusado', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/campanhas/60', {
      method: 'PUT', body: JSON.stringify({ nome: 'X', status: 'Inventado' })
    });
    assert.strictEqual(resp.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('editar uma interação guarda o contato pelo NOME, não pelo id', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/interacoes/20', {
      method: 'PUT',
      body: JSON.stringify({
        tipo: 'Reunião', resumo: 'Primeiro contato', contato_id: 11
      })
    });
    assert.strictEqual(resp.status, 200);

    const evento = eventosDe(ctx, 'interacao').find(e => e.campo === 'contato_id');
    assert.ok(evento, 'faltou o evento do contato');
    // "10 → 11" não diz nada a quem for ler daqui a seis meses.
    assert.strictEqual(evento.valor_novo, 'Alberto Decisor');
  } finally {
    await ctx.encerrar();
  }
});

test('interação não aceita contato de outra prospecção', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/interacoes/20', {
      method: 'PUT',
      // O contato 12 é da prospecção 2.
      body: JSON.stringify({ tipo: 'Ligação', resumo: 'x', contato_id: 12 })
    });
    assert.strictEqual(resp.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('editar a interação NÃO reescreve o passo planejado', async () => {
  // `passo_planejado` é o retrato do que havia sido combinado quando a
  // atividade foi concluída. Corrigir um erro de digitação no resumo não pode
  // reescrever a promessa original.
  const dados = baseDados();
  const alvo = dados.prospeccao_interacoes.find(i => i.id === 20);
  alvo.tipo = 'Atividade realizada';
  alvo.passo_planejado = 'Ligar para o Alberto';
  const ctx = await montar(dados);
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1/interacoes/20', {
      method: 'PUT',
      body: JSON.stringify({ tipo: 'Atividade realizada', resumo: 'Resumo corrigido' })
    });
    assert.strictEqual(
      ctx.tabelas.prospeccao_interacoes.find(i => i.id === 20).passo_planejado,
      'Ligar para o Alberto');
  } finally {
    await ctx.encerrar();
  }
});

test('excluir uma interação guarda o registro inteiro no histórico', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/interacoes/20', { method: 'DELETE' });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(ctx.tabelas.prospeccao_interacoes.some(i => i.id === 20), false);

    const evento = ctx.tabelas.prospeccao_historico.find(h => h.tipo === 'interacao' && h.acao === 'excluiu');
    assert.ok(evento, 'faltou o evento de exclusão');
    const detalhe = typeof evento.detalhe === 'string' ? JSON.parse(evento.detalhe) : evento.detalhe;
    assert.strictEqual(detalhe.registro.resumo, 'Primeiro contato');
    assert.ok(detalhe.campos.some(c => c.rotulo === 'Resumo' && c.valor === 'Primeiro contato'));
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Troca do contato principal
//
// `principal` tem índice único PARCIAL (`WHERE principal`): dois marcados ao
// mesmo tempo é erro, nem que seja por um instante. A faixa precisa ser
// PASSADA — o antigo perde antes de o novo receber.
// ---------------------------------------------------------------------------

test('marcar outro contato como principal substitui o anterior', async () => {
  const ctx = await montar(baseDados());
  try {
    // Na massa, o 11 (Alberto) é o principal da prospecção 1; o 10 não é.
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        contatosAtualizados: [{ id: 10, nome: 'Zuleica Auxiliar', principal: true }]
      })
    });
    assert.strictEqual(resp.status, 200);

    const daProspeccao = ctx.tabelas.prospeccao_contatos.filter(c => c.prospeccao_id === 1);
    const principais = daProspeccao.filter(c => c.principal);
    assert.strictEqual(principais.length, 1, 'a prospecção precisa ter exatamente um principal');
    assert.strictEqual(principais[0].id, 10);
  } finally {
    await ctx.encerrar();
  }
});

test('a troca do principal fica registrada nos dois lados', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        contatosAtualizados: [{ id: 10, nome: 'Zuleica Auxiliar', principal: true }]
      })
    });

    const perdeu = ctx.tabelas.prospeccao_historico.find(
      h => h.campo === 'principal' && h.valor_novo === 'Contato comum');
    assert.ok(perdeu, 'quem perdeu a faixa precisa aparecer no histórico');
    assert.match(perdeu.entidade, /Alberto/);
    assert.match(perdeu.observacao, /Zuleica/);
  } finally {
    await ctx.encerrar();
  }
});

test('contato NOVO marcado como principal também substitui o atual', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        contatosNovos: [{ nome: 'Novo Decisor', principal: true }]
      })
    });
    assert.strictEqual(resp.status, 200);

    const principais = ctx.tabelas.prospeccao_contatos
      .filter(c => c.prospeccao_id === 1 && c.principal);
    assert.strictEqual(principais.length, 1);
    assert.strictEqual(principais[0].nome, 'Novo Decisor');
  } finally {
    await ctx.encerrar();
  }
});

test('reafirmar quem já é principal não gera troca', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        contatosAtualizados: [{ id: 11, nome: 'Alberto Decisor', principal: true }]
      })
    });
    const trocas = ctx.tabelas.prospeccao_historico.filter(
      h => h.campo === 'principal' && h.valor_novo === 'Contato comum');
    assert.deepStrictEqual(trocas, []);
    assert.strictEqual(
      ctx.tabelas.prospeccao_contatos.filter(c => c.prospeccao_id === 1 && c.principal).length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('a troca do principal não mexe em outra prospecção', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        contatosAtualizados: [{ id: 10, nome: 'Zuleica Auxiliar', principal: true }]
      })
    });
    // O contato 12 é o principal da prospecção 2 e não pode ter sido tocado.
    assert.strictEqual(ctx.tabelas.prospeccao_contatos.find(c => c.id === 12).principal, true);
  } finally {
    await ctx.encerrar();
  }
});


// ---------------------------------------------------------------------------
// Histórico detalhado
//
// O problema era concreto: editar um contato gerava UMA linha com o registro
// inteiro dos dois lados — duas frases quase idênticas, e quem lia tinha de
// caçar a diferença caractere a caractere.
// ---------------------------------------------------------------------------

const eventosContato = ctx =>
  ctx.tabelas.prospeccao_historico.filter(h => h.tipo === 'contato' && h.acao === 'alterou');

test('editar um contato gera um evento POR CAMPO alterado', async () => {
  const ctx = await montar(baseDados());
  try {
    // O contato 11 é "Alberto Decisor / Diretor / alberto@antiga.com".
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        contatosAtualizados: [{
          id: 11, nome: 'Alberto Decisor', cargo: 'Diretor de Compras',
          email: 'alberto.novo@antiga.com', decisor: true, principal: true
        }]
      })
    });

    const eventos = eventosContato(ctx);
    const campos = eventos.map(e => e.campo).sort();
    assert.deepStrictEqual(campos, ['cargo', 'email']);

    const cargo = eventos.find(e => e.campo === 'cargo');
    assert.strictEqual(cargo.valor_anterior, 'Diretor');
    assert.strictEqual(cargo.valor_novo, 'Diretor de Compras');
    // O rótulo viaja junto: a tela não pode ter de adivinhar "cargo".
    assert.strictEqual(cargo.detalhe.rotulo, 'Cargo');
  } finally {
    await ctx.encerrar();
  }
});

test('campo do contato que não mudou não vira linha', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        contatosAtualizados: [{
          id: 11, nome: 'Alberto Decisor', cargo: 'Diretor',
          email: 'alberto@antiga.com', decisor: true, principal: true
        }]
      })
    });
    assert.deepStrictEqual(eventosContato(ctx), []);
  } finally {
    await ctx.encerrar();
  }
});

test('marcar decisor aparece como Sim/Não, não true/false', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        // O contato 10 (Zuleica) não é decisor na massa.
        contatosAtualizados: [{ id: 10, nome: 'Zuleica Auxiliar', cargo: 'Assistente', decisor: true }]
      })
    });
    const evento = eventosContato(ctx).find(e => e.campo === 'decisor');
    assert.ok(evento, 'faltou o evento do decisor');
    assert.strictEqual(evento.valor_anterior, 'Não');
    assert.strictEqual(evento.valor_novo, 'Sim');
  } finally {
    await ctx.encerrar();
  }
});

test('criar contato guarda o retrato rotulado do que foi cadastrado', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        contatosNovos: [{ nome: 'Novo Contato', cargo: 'Compras', email: 'novo@antiga.com' }]
      })
    });
    const evento = ctx.tabelas.prospeccao_historico.find(h => h.tipo === 'contato' && h.acao === 'criou');
    const campos = evento.detalhe.campos;
    assert.deepStrictEqual(
      campos.map(c => c.rotulo).sort(),
      ['Cargo', 'E-mail', 'Nome']
    );
    // Campo vazio não entra: encheria a tela de linhas inúteis.
    assert.strictEqual(campos.some(c => c.rotulo === 'Telefone fixo'), false);
    // "Não" também fica de fora — só o que É verdade merece linha.
    assert.strictEqual(campos.some(c => c.valor === 'Não'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('sem conseguir ler o estado anterior, registra uma linha honesta', async () => {
  // Se a leitura do contato falhar, um diff acusaria mudança em TODOS os
  // campos — pior que não saber.
  const dados = baseDados();
  const ctx = await montar(dados, {
    falharEm: ({ metodo, tabela }) => metodo === 'GET' && tabela === 'prospeccao_contatos'
  });
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1', {
      method: 'PUT',
      body: JSON.stringify({
        nome_fantasia: 'Antiga Ltda',
        contatosAtualizados: [{ id: 11, nome: 'Alberto Decisor', cargo: 'Outro' }]
      })
    });
    const eventos = eventosContato(ctx);
    assert.strictEqual(eventos.length, 1);
    assert.match(eventos[0].observacao, /não pôde ser lido/i);
  } finally {
    await ctx.encerrar();
  }
});

test('mover no funil continua nomeando o campo', async () => {
  // A tela usa `campo` para rotular a linha; sem ele o histórico volta a ser
  // dois textos soltos.
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1/etapa', {
      method: 'PATCH', body: JSON.stringify({ etapa: 'Proposta' })
    });
    const evento = ctx.tabelas.prospeccao_historico.find(h => h.tipo === 'etapa');
    assert.strictEqual(evento.campo, 'etapa');
    assert.strictEqual(evento.valor_anterior, 'Qualificado');
    assert.strictEqual(evento.valor_novo, 'Proposta');
  } finally {
    await ctx.encerrar();
  }
});


// ---------------------------------------------------------------------------
// Regras do funil: Ganho e Perdido
//
// Mover para Ganho ou Perdido não é trocar de etiqueta — é encerrar a
// negociação. Antes o backend só gravava a etapa nova, e o fluxo combinado
// (converter / arquivar / rejeitar propostas) simplesmente não acontecia.
// ---------------------------------------------------------------------------

/** Prospecção 1 com os dados fiscais completos, apta a virar cliente. */
function aptaParaGanho() {
  const dados = baseDados();
  const p = dados.prospeccoes.find(x => x.id === 1);
  p.razao_social = 'Antiga Comercio Ltda';
  p.nome_fantasia = 'Antiga Ltda';
  p.cnpj = '11.111.111/0001-11';
  return dados;
}

test('mover para Ganho sinaliza a conversão para a interface', async () => {
  const ctx = await montar(aptaParaGanho());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/etapa', {
      method: 'PATCH', body: JSON.stringify({ etapa: 'Ganho' })
    });
    assert.strictEqual(resp.status, 200);
    const corpo = await resp.json();
    assert.strictEqual(corpo.converter, true);

    // O backend NÃO converte sozinho: a conversão pede status e dono do
    // cliente, que são decisões de quem está na tela.
    assert.strictEqual(ctx.tabelas.clientes.length, 0);
    assert.strictEqual(ctx.tabelas.prospeccoes.find(p => p.id === 1).cliente_id ?? null, null);
  } finally {
    await ctx.encerrar();
  }
});

test('Ganho sem CNPJ é recusado, com a lista do que falta', async () => {
  // Prospectar um lead de feira sem CNPJ é legítimo; dar como fechado, não —
  // e descobrir isso só na conversão seria um beco sem saída.
  const dados = baseDados();
  const p = dados.prospeccoes.find(x => x.id === 1);
  p.cnpj = null;
  const ctx = await montar(dados);
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/etapa', {
      method: 'PATCH', body: JSON.stringify({ etapa: 'Ganho' })
    });
    assert.strictEqual(resp.status, 422);
    const corpo = await resp.json();
    assert.ok(corpo.camposFaltantes.includes('CNPJ'));

    // Nada mudou: a etapa continua onde estava.
    assert.strictEqual(ctx.tabelas.prospeccoes.find(x => x.id === 1).etapa, 'Qualificado');
  } finally {
    await ctx.encerrar();
  }
});

test('Perdido rejeita os orçamentos em aberto da prospecção', async () => {
  const dados = baseDados();
  dados.orcamentos = [
    { id: 1, numero: 'OCRP1', prospeccao_id: 1, situacao: 'Rascunho' },
    { id: 2, numero: 'OCRP2', prospeccao_id: 1, situacao: 'Enviado' },
    { id: 3, numero: 'OCRP3', prospeccao_id: 2, situacao: 'Rascunho' }
  ];
  const ctx = await montar(dados);
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/etapa', {
      method: 'PATCH',
      body: JSON.stringify({ etapa: 'Perdido', motivo_perda: 'Preço' })
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual((await resp.json()).orcamentosRejeitados, 2);

    const situacao = n => ctx.tabelas.orcamentos.find(o => o.numero === n).situacao;
    assert.strictEqual(situacao('OCRP1'), 'Rejeitado');
    assert.strictEqual(situacao('OCRP2'), 'Rejeitado');
    // Orçamento de OUTRA prospecção não é tocado.
    assert.strictEqual(situacao('OCRP3'), 'Rascunho');
  } finally {
    await ctx.encerrar();
  }
});

test('Perdido NÃO mexe em orçamento já aprovado', async () => {
  // Aprovado virou pedido. Rejeitar aqui desencontraria os dois documentos.
  const dados = baseDados();
  dados.orcamentos = [
    { id: 1, numero: 'OCRP1', prospeccao_id: 1, situacao: 'Aprovado' },
    { id: 2, numero: 'OCRP2', prospeccao_id: 1, situacao: 'Expirado' }
  ];
  const ctx = await montar(dados);
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/etapa', {
      method: 'PATCH',
      body: JSON.stringify({ etapa: 'Perdido', motivo_perda: 'Desistiu' })
    });
    assert.strictEqual((await resp.json()).orcamentosRejeitados, 0);
    assert.strictEqual(ctx.tabelas.orcamentos.find(o => o.id === 1).situacao, 'Aprovado');
    assert.strictEqual(ctx.tabelas.orcamentos.find(o => o.id === 2).situacao, 'Expirado');
  } finally {
    await ctx.encerrar();
  }
});

test('cada orçamento rejeitado vira uma linha do histórico', async () => {
  const dados = baseDados();
  dados.orcamentos = [{ id: 1, numero: 'OCRP1', prospeccao_id: 1, situacao: 'Enviado' }];
  const ctx = await montar(dados);
  try {
    await chamar(ctx.porta, '/api/prospeccoes/1/etapa', {
      method: 'PATCH',
      body: JSON.stringify({ etapa: 'Perdido', motivo_perda: 'Sem verba' })
    });
    const evento = ctx.tabelas.prospeccao_historico
      .find(h => h.tipo === 'orcamento' && h.campo === 'situacao');
    assert.ok(evento, 'faltou o evento do orçamento rejeitado');
    assert.strictEqual(evento.valor_anterior, 'Enviado');
    assert.strictEqual(evento.valor_novo, 'Rejeitado');
    assert.match(evento.observacao, /Sem verba/);
  } finally {
    await ctx.encerrar();
  }
});

test('Perdido continua arquivando mesmo se os orçamentos falharem', async () => {
  // Um erro ao rejeitar proposta não pode impedir a prospecção de ser marcada
  // como perdida — senão o funil trava por causa de um efeito colateral.
  const dados = baseDados();
  dados.orcamentos = [{ id: 1, numero: 'OCRP1', prospeccao_id: 1, situacao: 'Enviado' }];
  const ctx = await montar(dados, {
    falharEm: ({ metodo, tabela }) => metodo === 'PUT' && tabela === 'orcamentos'
  });
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1/etapa', {
      method: 'PATCH',
      body: JSON.stringify({ etapa: 'Perdido', motivo_perda: 'Preço' })
    });
    assert.strictEqual(resp.status, 200);
    const p = ctx.tabelas.prospeccoes.find(x => x.id === 1);
    assert.strictEqual(p.etapa, 'Perdido');
    assert.strictEqual(p.status, 'arquivada');
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Prospecção convertida sai do funil
// ---------------------------------------------------------------------------

test('prospecção convertida não se move mais no funil', async () => {
  const ctx = await montar(baseDados());
  try {
    // A prospecção 4 já tem cliente_id na massa.
    const resp = await chamar(ctx.porta, '/api/prospeccoes/4/etapa', {
      method: 'PATCH', body: JSON.stringify({ etapa: 'Negociação' })
    });
    assert.strictEqual(resp.status, 409);
    assert.strictEqual(ctx.tabelas.prospeccoes.find(p => p.id === 4).etapa, 'Ganho');
  } finally {
    await ctx.encerrar();
  }
});

test('prospecção convertida não é editada pela ficha', async () => {
  // Os dados já foram copiados para o cadastro do cliente; a versão do cliente
  // é a que vale. Editar aqui criaria duas versões da mesma empresa.
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/4', {
      method: 'PUT', body: JSON.stringify({ nome_fantasia: 'Outro Nome' })
    });
    assert.strictEqual(resp.status, 409);
    assert.match((await resp.json()).error, /módulo Clientes/i);
    assert.strictEqual(ctx.tabelas.prospeccoes.find(p => p.id === 4).nome_fantasia, 'Ganha Convertida');
  } finally {
    await ctx.encerrar();
  }
});



/**
 * Dá ao usuário 2 (Vendedor, não Sup Admin) a permissão `pros.delete`.
 *
 * Sem isto ele seria barrado pelo `exigirPermissao` e o teste passaria por
 * vazio — não provaria nada sobre a trava de Sup Admin que veio depois.
 */
function darPermissaoDeExcluir(dados) {
  dados.modelos_permissoes = [{ id: 9, nome: 'Vendedor' }];
  dados.usuarios.find(u => u.id === 2).modelo_permissoes_id = 9;
  dados.perm_pros = [{
    id: 1, modelo_id: 9, modulo_ativo: true,
    acao_view: true, acao_delete: true, acao_details_view: true
  }];
}

// ---------------------------------------------------------------------------
// Perdido volta a ser trabalhável
//
// A trava da Etapa 12 pegou pesado: negócio perdido volta à mesa, e Ganho sem
// conversão precisa de conserto. Só a CONVERTIDA sai do jogo — os dados dela
// já viraram cadastro de cliente, e a versão do cliente é a que vale.
// ---------------------------------------------------------------------------

test('prospecção Perdida pode ser movida de volta no funil', async () => {
  const ctx = await montar(baseDados());
  try {
    // A 5 está Perdido/arquivada na massa.
    const resp = await chamar(ctx.porta, '/api/prospeccoes/5/etapa', {
      method: 'PATCH', body: JSON.stringify({ etapa: 'Negociação' })
    });
    assert.strictEqual(resp.status, 200);

    const p = ctx.tabelas.prospeccoes.find(x => x.id === 5);
    assert.strictEqual(p.etapa, 'Negociação');
    // Sai do arquivo junto: voltou a ser oportunidade viva.
    assert.strictEqual(p.status, 'ativa');
  } finally {
    await ctx.encerrar();
  }
});

test('prospecção Perdida pode ser editada', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/5', {
      method: 'PUT', body: JSON.stringify({ nome_fantasia: 'Perdida Ltda (retomada)' })
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(
      ctx.tabelas.prospeccoes.find(p => p.id === 5).nome_fantasia,
      'Perdida Ltda (retomada)');
  } finally {
    await ctx.encerrar();
  }
});

test('convertida continua fora do funil e da edição', async () => {
  const ctx = await montar(baseDados());
  try {
    const mover = await chamar(ctx.porta, '/api/prospeccoes/4/etapa', {
      method: 'PATCH', body: JSON.stringify({ etapa: 'Negociação' })
    });
    assert.strictEqual(mover.status, 409);

    const editar = await chamar(ctx.porta, '/api/prospeccoes/4', {
      method: 'PUT', body: JSON.stringify({ nome_fantasia: 'Outro' })
    });
    assert.strictEqual(editar.status, 409);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Excluir encerrada é do Sup Admin — cobrado no BACKEND
//
// A grade escondia o botão, mas o backend deixava passar: bastava a permissão
// `pros.delete` e uma chamada direta.
// ---------------------------------------------------------------------------

test('usuário comum não exclui prospecção Ganha', async () => {
  const dados = baseDados();
  darPermissaoDeExcluir(dados);
  const ctx = await montar(dados);
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/4', { usuario: 2, method: 'DELETE' });
    assert.strictEqual(resp.status, 403);
    assert.ok(ctx.tabelas.prospeccoes.some(p => p.id === 4), 'a prospecção não podia ter sumido');
  } finally {
    await ctx.encerrar();
  }
});

test('usuário comum não exclui prospecção Perdida', async () => {
  const dados = baseDados();
  darPermissaoDeExcluir(dados);
  const ctx = await montar(dados);
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/5', { usuario: 2, method: 'DELETE' });
    assert.strictEqual(resp.status, 403);
  } finally {
    await ctx.encerrar();
  }
});

test('Sup Admin exclui a encerrada normalmente', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/prospeccoes/5', { method: 'DELETE' });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(ctx.tabelas.prospeccoes.some(p => p.id === 5), false);
  } finally {
    await ctx.encerrar();
  }
});

test('prospecção em andamento não exige Sup Admin para excluir', async () => {
  // A restrição é sobre o registro ENCERRADO. Negócio em curso segue a
  // permissão normal do módulo.
  const dados = baseDados();
  darPermissaoDeExcluir(dados);
  const ctx = await montar(dados);
  try {
    // A 1 está Qualificado.
    const resp = await chamar(ctx.porta, '/api/prospeccoes/1', { usuario: 2, method: 'DELETE' });
    assert.strictEqual(resp.status, 200);
  } finally {
    await ctx.encerrar();
  }
});
