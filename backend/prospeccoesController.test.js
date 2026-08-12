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
  prospeccao_interacoes: ['id', 'prospeccao_id', 'contato_id', 'tipo', 'data', 'resumo', 'detalhe', 'duracao_min', 'usuario_id'],
  prospeccao_etapas_historico: ['id', 'prospeccao_id', 'etapa_anterior', 'etapa_nova', 'observacao', 'usuario_id', 'criado_em'],
  prospeccao_notas: ['id', 'prospeccao_id', 'titulo', 'conteudo', 'usuario_id', 'criado_em'],
  prospeccao_campanhas: ['id', 'prospeccao_id', 'nome', 'canal', 'status', 'data_envio', 'resposta', 'observacao', 'usuario_id'],
  prospeccao_anexos: ['id', 'prospeccao_id', 'nota_id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes', 'usuario_id', 'criado_em'],
  orcamentos: ['id', 'numero', 'cliente_id', 'prospeccao_id', 'situacao'],
  clientes: ['id', 'nome_fantasia', 'razao_social', 'cnpj', 'status_cliente'],
  contatos_cliente: ['id', 'id_cliente', 'nome', 'cargo', 'email', 'telefone_fixo', 'telefone_celular'],
  usuarios: ['id', 'nome', 'perfil', 'modelo_permissoes_id'],
  modelos_permissoes: ['id', 'nome']
};

/** Filhas que caem junto com a prospecção (ON DELETE CASCADE no DDL real). */
const CASCATA = [
  'prospeccao_contatos', 'prospeccao_interacoes', 'prospeccao_etapas_historico',
  'prospeccao_notas', 'prospeccao_campanhas', 'prospeccao_anexos'
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

      if (req.method === 'POST') {
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
    prospeccao_etapas_historico: [
      { id: 30, prospeccao_id: 1, etapa_anterior: null, etapa_nova: 'Novo', criado_em: ANTIGO, usuario_id: 3 }
    ],
    prospeccao_notas: [
      { id: 40, prospeccao_id: 1, titulo: 'Perfil', conteudo: 'Cliente exigente', usuario_id: 3, criado_em: ANTIGO },
      { id: 41, prospeccao_id: 2, titulo: 'Outra', conteudo: 'De outra prospeccao', usuario_id: 3, criado_em: ANTIGO }
    ],
    prospeccao_campanhas: [],
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

    const historico = ctx.tabelas.prospeccao_etapas_historico.filter(h => h.prospeccao_id === id);
    assert.strictEqual(historico.length, 1);
    assert.strictEqual(historico[0].etapa_nova, 'Novo');
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

    const hist = ctx.tabelas.prospeccao_etapas_historico.filter(h => String(h.prospeccao_id) === '1');
    const ultimo = hist[hist.length - 1];
    assert.strictEqual(ultimo.etapa_anterior, 'Qualificado');
    assert.strictEqual(ultimo.etapa_nova, 'Negociação');
    assert.strictEqual(ultimo.usuario_id, 1);
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
