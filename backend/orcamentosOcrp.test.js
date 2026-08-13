/**
 * Orçamentos de prospecção (OCRP).
 *
 * O duplo da API abaixo repete as limitações do Santissimo-db-API real: filtra
 * só por igualdade em coluna existente, ignora `order`/`limit`/`select` e
 * devolve as linhas na ordem de inserção. Os orçamentos da massa são gravados
 * FORA de ordem numérica de propósito — se a numeração voltar a confiar no
 * último registro, o teste quebra.
 *
 * O que está sob teste aqui é sobretudo a numeração: duas famílias (ORC e OCRP)
 * dividindo a mesma tabela e a mesma constraint única.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  orcamentos: [
    'id', 'numero', 'cliente_id', 'contato_id', 'prospeccao_id', 'prospeccao_contato_id',
    'data_emissao', 'situacao', 'parcelas', 'tipo_parcela', 'forma_pagamento',
    'transportadora', 'desconto_pagamento', 'desconto_especial', 'desconto_total',
    'valor_final', 'observacoes', 'validade', 'prazo', 'dono', 'data_aprovacao'
  ],
  orcamentos_itens: ['id', 'orcamento_id', 'produto_id', 'nome', 'quantidade', 'valor_unitario', 'valor_total'],
  orcamento_parcelas: ['id', 'orcamento_id', 'numero_parcela', 'valor', 'data_vencimento'],
  prospeccoes: ['id', 'nome_fantasia', 'etapa', 'status', 'responsavel_id', 'cliente_id'],
  prospeccao_contatos: ['id', 'prospeccao_id', 'nome', 'principal'],
  prospeccao_historico: [
    'id', 'prospeccao_id', 'tipo', 'acao', 'entidade', 'campo',
    'valor_anterior', 'valor_novo', 'detalhe', 'observacao', 'usuario_id', 'criado_em'
  ],
  clientes: ['id', 'nome_fantasia'],
  pedidos: ['id', 'numero', 'orcamento_id'],
  usuarios: ['id', 'nome', 'perfil', 'modelo_permissoes_id'],
  modelos_permissoes: ['id', 'nome']
};

function criarUpstream(dados, opcoes = {}) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const chamadas = [];
  // Simula a corrida real: outro usuário gravou o mesmo número entre a leitura
  // da sequência e o INSERT. Nenhum estado do banco reproduz isso — só o
  // upstream recusando um número que, segundo a tabela lida, estava livre.
  let recusasRestantes = opcoes.recusarInserts || 0;

  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const partes = url.pathname.split('/').filter(Boolean);
      const tabela = partes[1];
      const id = partes[2];
      const body = corpo ? JSON.parse(corpo) : null;

      chamadas.push({ metodo: req.method, tabela, id, query: url.search, body });

      const responder = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (!tabelas[tabela]) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
      const colunas = COLUNAS[tabela] || [];

      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Registro não encontrado' });
      }

      if (req.method === 'GET') {
        let linhas = tabelas[tabela];
        for (const [chave, valor] of url.searchParams.entries()) {
          if (!colunas.includes(chave)) continue;
          linhas = linhas.filter(r => String(r[chave]) === String(valor));
        }
        return responder(200, linhas);
      }

      if (req.method === 'POST') {
        // A constraint única de `numero` é real no banco — o duplo precisa
        // recusar a duplicata, senão o teste de colisão passaria por acidente.
        if (tabela === 'orcamentos' && body?.numero && recusasRestantes > 0) {
          recusasRestantes--;
          return responder(500, {
            error: 'Erro no INSERT',
            detalhe: 'duplicate key value violates unique constraint "orcamentos_numero_key"'
          });
        }
        if (tabela === 'orcamentos' && body?.numero
            && tabelas.orcamentos.some(o => o.numero === body.numero)) {
          return responder(500, {
            error: 'Erro no INSERT',
            detalhe: 'duplicate key value violates unique constraint "orcamentos_numero_key"'
          });
        }
        const proximo = Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1;
        const linha = { id: proximo };
        for (const c of colunas) if (body?.[c] !== undefined) linha[c] = body[c];
        if (colunas.includes('criado_em') && !linha.criado_em) linha.criado_em = new Date().toISOString();
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
        return responder(200, { sucesso: true, deletado: removido });
      }

      responder(405, { error: 'Método não suportado' });
    });
  });

  return { servidor, tabelas, chamadas };
}

const MODULOS = [
  './apiHttpClient', './permissionsController', './permissionsRepository',
  './prospeccoesController', './orcamentosController'
];

async function montar(dados, opcoes = {}) {
  const upstream = criarUpstream(dados, opcoes);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;

  for (const m of MODULOS) delete require.cache[require.resolve(m)];

  const app = express();
  app.use(express.json());
  app.use('/api/orcamentos', require('./orcamentosController'));

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

function baseDados(orcamentos = []) {
  return {
    usuarios: [
      { id: 1, nome: 'Henrique', perfil: 'Sup Admin', modelo_permissoes_id: null },
      { id: 2, nome: 'Vendedora Ana', perfil: 'Vendedor', modelo_permissoes_id: null }
    ],
    modelos_permissoes: [],
    clientes: [{ id: 50, nome_fantasia: 'Cliente Antigo' }],
    prospeccoes: [
      { id: 1, nome_fantasia: 'Marmoraria Vitória', etapa: 'Proposta', status: 'ativa' },
      { id: 2, nome_fantasia: 'Outra Empresa', etapa: 'Novo', status: 'ativa' }
    ],
    prospeccao_contatos: [{ id: 10, prospeccao_id: 1, nome: 'Alberto', principal: true }],
    prospeccao_historico: [],
    orcamentos,
    orcamentos_itens: [],
    orcamento_parcelas: [],
    pedidos: []
  };
}

const ITEM = { produto_id: 7, nome: 'Bancada', quantidade: 1, valor_unitario: 100, valor_total: 100 };

// ---------------------------------------------------------------------------
// Numeração
// ---------------------------------------------------------------------------

test('orçamento de prospecção nasce com prefixo OCRP', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST',
      body: JSON.stringify({ prospeccao_id: 1, situacao: 'Rascunho', valor_final: 100, itens: [ITEM] })
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual((await resp.json()).numero, 'OCRP1');
  } finally {
    await ctx.encerrar();
  }
});

test('a data de emissão é carimbada quando o formulário não manda', async () => {
  // A tela não tem campo de emissão; sem o padrão no controller, a coluna
  // "Emissão" da ficha da prospecção nasceria vazia.
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST', body: JSON.stringify({ prospeccao_id: 1, itens: [] })
    });
    const emissao = ctx.tabelas.orcamentos[0].data_emissao;
    assert.ok(emissao, 'data_emissao deveria vir preenchida');
    assert.ok(!Number.isNaN(new Date(emissao).getTime()), 'data_emissao deveria ser uma data válida');
  } finally {
    await ctx.encerrar();
  }
});

test('orçamento de cliente continua ORC', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST',
      body: JSON.stringify({ cliente_id: 50, situacao: 'Rascunho', valor_final: 100, itens: [] })
    });
    assert.strictEqual((await resp.json()).numero, 'ORC1');
  } finally {
    await ctx.encerrar();
  }
});

test('as duas sequências não se contaminam', async () => {
  // Este é o ponto do prefixo. Somando só os dígitos, como a versão anterior
  // fazia, o OCRP80 empurraria o próximo orçamento de cliente para ORC81 e a
  // numeração de cliente daria um salto de 77 números sem explicação.
  const ctx = await montar(baseDados([
    { id: 1, numero: 'ORC3', cliente_id: 50 },
    { id: 2, numero: 'OCRP80', prospeccao_id: 1 },
    { id: 3, numero: 'ORC1', cliente_id: 50 }
  ]));
  try {
    const cliente = await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST', body: JSON.stringify({ cliente_id: 50, itens: [] })
    });
    assert.strictEqual((await cliente.json()).numero, 'ORC4');

    const prospeccao = await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST', body: JSON.stringify({ prospeccao_id: 1, itens: [] })
    });
    assert.strictEqual((await prospeccao.json()).numero, 'OCRP81');
  } finally {
    await ctx.encerrar();
  }
});

test('número legado fora do padrão ainda conta para ORC', async () => {
  // A versão anterior contava qualquer coisa com dígitos. Se passássemos a
  // exigir /^ORC\d+$/, o "ORC-9" deixaria de contar, a sequência voltaria para
  // trás e a constraint única recusaria o INSERT.
  const ctx = await montar(baseDados([{ id: 1, numero: 'ORC-9', cliente_id: 50 }]));
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST', body: JSON.stringify({ cliente_id: 50, itens: [] })
    });
    assert.strictEqual((await resp.json()).numero, 'ORC10');
  } finally {
    await ctx.encerrar();
  }
});

test('colisão na constraint única é contornada com a próxima sequência', async () => {
  // Dois usuários salvando ao mesmo tempo: ambos leem "o próximo é OCRP7" e um
  // deles perde a corrida no INSERT. Em vez de devolver erro para quem chegou
  // depois, o controller tenta OCRP8.
  const ctx = await montar(
    baseDados([
      { id: 1, numero: 'OCRP5', prospeccao_id: 1 },
      { id: 2, numero: 'OCRP6', prospeccao_id: 2 }
    ]),
    { recusarInserts: 1 }
  );
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST', body: JSON.stringify({ prospeccao_id: 1, itens: [] })
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual((await resp.json()).numero, 'OCRP8');
    assert.strictEqual(ctx.tabelas.orcamentos.length, 3);
  } finally {
    await ctx.encerrar();
  }
});

test('colisão insistente vira 409 explicado, não erro interno', async () => {
  // Vinte tentativas seguidas recusadas. O usuário precisa receber "não
  // consegui gerar um número", e não o "duplicate key" cru do Postgres embrulhado
  // num 500 — que foi o que aconteceu enquanto a última tentativa relançava o
  // erro do upstream em vez de cair no 409.
  const ctx = await montar(baseDados(), { recusarInserts: 999 });
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST', body: JSON.stringify({ prospeccao_id: 1, itens: [] })
    });
    assert.strictEqual(resp.status, 409);
    assert.strictEqual(ctx.tabelas.orcamentos.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Vínculo
// ---------------------------------------------------------------------------

test('orçamento sem cliente e sem prospecção é recusado', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST', body: JSON.stringify({ situacao: 'Rascunho', itens: [ITEM] })
    });
    assert.strictEqual(resp.status, 400);
    // Nada gravado: nem o orçamento, nem os itens.
    assert.strictEqual(ctx.tabelas.orcamentos.length, 0);
    assert.strictEqual(ctx.tabelas.orcamentos_itens.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('cliente vazio vindo do select não vira orçamento órfão', async () => {
  // Um <select> sem escolha manda "", que não é null e passaria por um
  // `!= null` desatento.
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST', body: JSON.stringify({ cliente_id: '', prospeccao_id: '', itens: [] })
    });
    assert.strictEqual(resp.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('prospecção inexistente é recusada antes de gravar qualquer coisa', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST', body: JSON.stringify({ prospeccao_id: 999, itens: [ITEM] })
    });
    assert.strictEqual(resp.status, 400);
    assert.strictEqual(ctx.tabelas.orcamentos.length, 0);
    assert.strictEqual(ctx.tabelas.orcamentos_itens.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('contato da prospecção é gravado na coluna própria', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST',
      body: JSON.stringify({ prospeccao_id: 1, prospeccao_contato_id: 10, itens: [] })
    });
    const orc = ctx.tabelas.orcamentos[0];
    assert.strictEqual(orc.prospeccao_contato_id, 10);
    // `contato_id` referencia contatos de CLIENTE: gravar ali o id de um
    // contato de prospecção apontaria para outra pessoa.
    assert.strictEqual(orc.contato_id ?? null, null);
    assert.strictEqual(orc.cliente_id ?? null, null);
  } finally {
    await ctx.encerrar();
  }
});

test('a listagem filtra por prospecção', async () => {
  const ctx = await montar(baseDados([
    { id: 1, numero: 'OCRP1', prospeccao_id: 1 },
    { id: 2, numero: 'OCRP2', prospeccao_id: 2 },
    { id: 3, numero: 'ORC1', cliente_id: 50 }
  ]));
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos?prospeccaoId=1');
    const lista = await resp.json();
    assert.deepStrictEqual(lista.map(o => o.numero), ['OCRP1']);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// O vínculo sobrevive à edição
// ---------------------------------------------------------------------------

test('editar um OCRP não apaga o vínculo com a prospecção', async () => {
  // O modal de edição não conhece `prospeccao_id` e não o envia. Sem a
  // preservação no controller, toda edição deixaria o orçamento órfão: sem
  // cliente e sem origem, invisível nas duas telas.
  const ctx = await montar(baseDados([
    { id: 1, numero: 'OCRP1', prospeccao_id: 1, prospeccao_contato_id: 10, situacao: 'Rascunho', valor_final: 100 }
  ]));
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos/1', {
      method: 'PUT',
      body: JSON.stringify({ situacao: 'Enviado', valor_final: 250, itens: [ITEM], parcelas_detalhes: [] })
    });
    assert.strictEqual(resp.status, 200);

    const orc = ctx.tabelas.orcamentos[0];
    assert.strictEqual(orc.prospeccao_id, 1);
    assert.strictEqual(orc.prospeccao_contato_id, 10);
    assert.strictEqual(orc.situacao, 'Enviado');
  } finally {
    await ctx.encerrar();
  }
});

test('editar um orçamento de cliente não apaga o cliente', async () => {
  const ctx = await montar(baseDados([
    { id: 1, numero: 'ORC1', cliente_id: 50, contato_id: 33, situacao: 'Rascunho' }
  ]));
  try {
    await chamar(ctx.porta, '/api/orcamentos/1', {
      method: 'PUT', body: JSON.stringify({ situacao: 'Enviado', itens: [], parcelas_detalhes: [] })
    });
    assert.strictEqual(ctx.tabelas.orcamentos[0].cliente_id, 50);
    assert.strictEqual(ctx.tabelas.orcamentos[0].contato_id, 33);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Histórico da prospecção
// ---------------------------------------------------------------------------

const historicoDe = ctx => ctx.tabelas.prospeccao_historico.filter(h => h.tipo === 'orcamento');

test('criar um OCRP entra no histórico da prospecção', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST',
      body: JSON.stringify({ prospeccao_id: 1, situacao: 'Rascunho', valor_final: 4200, itens: [ITEM] })
    });
    const [evento] = historicoDe(ctx);
    assert.strictEqual(evento.acao, 'criou');
    assert.strictEqual(evento.entidade, 'Orçamento OCRP1');
    assert.strictEqual(evento.valor_novo, 'OCRP1');
    assert.strictEqual(String(evento.prospeccao_id), '1');
    assert.strictEqual(evento.usuario_id, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('orçamento de cliente não polui histórico de prospecção nenhuma', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST', body: JSON.stringify({ cliente_id: 50, itens: [] })
    });
    assert.strictEqual(ctx.tabelas.prospeccao_historico.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('mudança de situação guarda o valor anterior', async () => {
  const ctx = await montar(baseDados([
    { id: 1, numero: 'OCRP1', prospeccao_id: 1, situacao: 'Rascunho', valor_final: 100 }
  ]));
  try {
    await chamar(ctx.porta, '/api/orcamentos/1/status', {
      method: 'PATCH', body: JSON.stringify({ situacao: 'Enviado' })
    });
    const [evento] = historicoDe(ctx);
    assert.strictEqual(evento.campo, 'situacao');
    assert.strictEqual(evento.valor_anterior, 'Rascunho');
    assert.strictEqual(evento.valor_novo, 'Enviado');
  } finally {
    await ctx.encerrar();
  }
});

test('orçamento excluído some da lista mas fica detalhado no histórico', async () => {
  const ctx = await montar(baseDados([
    { id: 1, numero: 'OCRP1', prospeccao_id: 1, situacao: 'Enviado', valor_final: 8500 }
  ]));
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos/1', { method: 'DELETE' });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(ctx.tabelas.orcamentos.length, 0);

    const [evento] = historicoDe(ctx);
    assert.strictEqual(evento.acao, 'excluiu');
    assert.strictEqual(evento.valor_anterior, 'OCRP1');
    // O detalhe é o que permite responder "quanto valia aquele orçamento?"
    // depois que a linha já não existe.
    const detalhe = typeof evento.detalhe === 'string' ? JSON.parse(evento.detalhe) : evento.detalhe;
    assert.strictEqual(detalhe.valor_final, 8500);
    assert.strictEqual(detalhe.situacao, 'Enviado');
  } finally {
    await ctx.encerrar();
  }
});

test('clonar um OCRP gera outro OCRP e registra a cópia', async () => {
  const ctx = await montar(baseDados([
    { id: 1, numero: 'OCRP1', prospeccao_id: 1, situacao: 'Enviado', valor_final: 100 }
  ]));
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos/1/clone', { method: 'POST' });
    const corpo = await resp.json();
    assert.strictEqual(corpo.numero, 'OCRP2');

    const copia = ctx.tabelas.orcamentos.find(o => o.numero === 'OCRP2');
    assert.strictEqual(copia.prospeccao_id, 1);
    assert.strictEqual(copia.situacao, 'Rascunho');

    const evento = historicoDe(ctx).find(h => h.valor_novo === 'OCRP2');
    assert.match(evento.observacao, /Cópia do orçamento OCRP1/);
  } finally {
    await ctx.encerrar();
  }
});

test('falha ao gravar histórico não derruba a criação do orçamento', async () => {
  const dados = baseDados();
  // Sem a tabela, o POST do histórico devolve 404 — o orçamento já está
  // gravado e desfazê-lo por causa de uma linha de log seria pior.
  delete dados.prospeccao_historico;
  const ctx = await montar(dados);
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos', {
      method: 'POST', body: JSON.stringify({ prospeccao_id: 1, itens: [ITEM] })
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(ctx.tabelas.orcamentos.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Conversão em pedido
//
// Tornar `cliente_id` anulável abriu a porta para um pedido sem dono. A criação
// automática do cliente a partir da prospecção vem depois; até lá a conversão
// precisa recusar em vez de gravar um pedido órfão.
// ---------------------------------------------------------------------------

test('aprovar um OCRP sem cliente não cria pedido órfão', async () => {
  const ctx = await montar(baseDados([
    { id: 1, numero: 'OCRP1', prospeccao_id: 1, situacao: 'Enviado', valor_final: 500 }
  ]));
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos/1/status', {
      method: 'PATCH', body: JSON.stringify({ situacao: 'Aprovado' })
    });
    const corpo = await resp.json();

    // A mudança de situação em si vale; o que não pode é o pedido sair.
    assert.strictEqual(corpo.convertido, false);
    assert.match(corpo.convertErro, /prospecção em cliente/i);
    assert.strictEqual(ctx.tabelas.pedidos.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('orçamento de cliente continua convertendo normalmente', async () => {
  const ctx = await montar(baseDados([
    { id: 1, numero: 'ORC1', cliente_id: 50, situacao: 'Enviado', valor_final: 500 }
  ]));
  try {
    const resp = await chamar(ctx.porta, '/api/orcamentos/1/status', {
      method: 'PATCH', body: JSON.stringify({ situacao: 'Aprovado' })
    });
    const corpo = await resp.json();
    assert.strictEqual(corpo.convertido, true, corpo.convertErro || '');
    assert.strictEqual(ctx.tabelas.pedidos.length, 1);
    assert.strictEqual(ctx.tabelas.pedidos[0].orcamento_id, 1);
  } finally {
    await ctx.encerrar();
  }
});
