/**
 * Corrigir as datas de um pedido ENVIADO sem NF-e do sistema
 * (backend/datasDoEnvio.js + GET/PUT /api/pedidos/:id/envio).
 *
 * O que estes testes prendem (decisões do dono, 24/09/2026):
 *   - só pedido Enviado, sem NF-e do sistema valendo, e não devolvido por
 *     inteiro; Entregue fica de fora;
 *   - a data de envio só move as parcelas quando o faturamento conta DO
 *     ENVIO ("ao embarcar"); nas outras escolhas ela muda sozinha;
 *   - parcela paga, com boleto ou ordem não muda;
 *   - o que ninguém mexeu fica como está, mesmo fora da conta;
 *   - a correção vai para o histórico do pedido.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const envio = require('./datasDoEnvio');

// ------------------------------------------------------------------ puras

test('bloqueio: só enviado, sem NF-e do sistema valendo e não devolvido por inteiro', () => {
  const p = { id: 7, situacao: 'Enviado' };
  assert.equal(envio.motivoDoBloqueio(p, []), null);
  assert.equal(envio.motivoDoBloqueio(p, [{ pedido_id: 7, status_fiscal: 'cancelada' }, { pedido_id: 7, status_fiscal: 'rejeitada' }]), null,
    'nota cancelada ou rejeitada não trava');
  assert.equal(envio.motivoDoBloqueio(p, [{ pedido_id: 8, status_fiscal: 'autorizada' }]), null, 'nota de OUTRO pedido não conta');
  assert.match(envio.motivoDoBloqueio(p, [{ id: 3, pedido_id: 7, numero: 812, status_fiscal: 'autorizada' }]),
    /Pedido enviado com NF-e nº 812: a data de envio e os vencimentos seguem a nota/);
  assert.match(envio.motivoDoBloqueio(p, [{ pedido_id: 7, status_fiscal: 'processando' }]), /está saindo pela SEFAZ/);
  assert.match(envio.motivoDoBloqueio({ ...p, situacao: 'Entregue' }, []), /Pedido entregue: as datas não mudam mais/);
  assert.match(envio.motivoDoBloqueio({ ...p, situacao: 'Produção' }, []), /Só dá para corrigir as datas do envio de pedido enviado/);
  assert.match(envio.motivoDoBloqueio({ ...p, devolucao: 'total' }, []), /devolvido por inteiro/);
  assert.equal(envio.motivoDoBloqueio({ ...p, devolucao: 'parcial' }, []), null, 'devolução parcial ainda corrige');
});

test('entrada: data de envio, previsão, escolha e um prazo por parcela', () => {
  const base = { data_envio: '2026-09-15', embarcar_previsao: '2026-09-10', faturamento_regra: 'ao_embarcar' };
  assert.deepEqual(envio.lerEntrada(base, 2), { ok: true, ...base, inicio_faturamento: null, prazos: null });
  assert.equal(envio.lerEntrada({ ...base, data_envio: '' }, 2).erro, 'Informe a data de envio.');
  assert.equal(envio.lerEntrada({ ...base, data_envio: '2026-02-30' }, 2).erro, 'A data de envio não é uma data válida.');
  assert.equal(envio.lerEntrada({ ...base, embarcar_previsao: '' }, 2).erro, 'Informe a previsão de embarque.');
  assert.equal(envio.lerEntrada({ ...base, faturamento_regra: 'data' }, 2).erro, 'Informe a data de início do faturamento.');
  assert.deepEqual(envio.lerEntrada({ ...base, prazos: [30, 60] }, 2).prazos, [30, 60]);
  assert.match(envio.lerEntrada({ ...base, prazos: [30] }, 2).erro, /não batem com as parcelas/);
  assert.match(envio.lerEntrada({ ...base, prazos: [30, -1] }, 2).erro, /prazo da 2ª parcela/);
  assert.match(envio.lerEntrada({ ...base, prazos: [30, 1.5] }, 2).erro, /prazo da 2ª parcela/);
});

const PEDIDO = {
  id: 7, situacao: 'Enviado', prazo: '30/60', data_emissao: '2026-08-20T15:00:00.000Z',
  embarcar_previsao: '2026-09-10', embarcar_real: '2026-09-24', inicio_faturamento: '2026-09-24', faturamento_regra: 'ao_embarcar'
};
const PARCELAS = [
  { id: 71, numero: 1, valor: 500, vencimento: '2026-10-24', prazo: 30, travada: false, trava: null },
  { id: 72, numero: 2, valor: 500, vencimento: '2026-11-23', prazo: 60, travada: false, trava: null }
];

test('"no envio": corrigir a data de envio move as parcelas', () => {
  const entrada = envio.lerEntrada({ data_envio: '2026-09-15', embarcar_previsao: '2026-09-10', faturamento_regra: 'ao_embarcar' }, 2);
  const plano = envio.planejar({ pedido: PEDIDO, parcelas: PARCELAS, entrada, dataConversao: '2026-08-20' });
  assert.equal(plano.ok, true);
  assert.deepEqual(plano.campos, { embarcar_real: '2026-09-15', faturamento_regra: 'ao_embarcar', inicio_faturamento: '2026-09-15' });
  assert.deepEqual(plano.parcelas.map(p => [p.vencimento, p.muda]), [['2026-10-15', true], ['2026-11-14', true]]);
  assert.match(plano.descricao, /data de envio 24\/09\/2026 → 15\/09\/2026/);
  assert.match(plano.descricao, /vencimentos: 1ª 24\/10\/2026 → 15\/10\/2026, 2ª 23\/11\/2026 → 14\/11\/2026/);
});

test('faturamento que não conta do envio: a data de envio muda sozinha', () => {
  const pedido = { ...PEDIDO, faturamento_regra: 'data', inicio_faturamento: '2026-09-01' };
  const parcelas = [{ ...PARCELAS[0], vencimento: '2026-10-01' }, { ...PARCELAS[1], vencimento: '2026-10-31' }];
  const entrada = envio.lerEntrada({ data_envio: '2026-09-15', embarcar_previsao: '2026-09-10', faturamento_regra: 'data', inicio_faturamento: '2026-09-01' }, 2);
  const plano = envio.planejar({ pedido, parcelas, entrada, dataConversao: '2026-08-20' });
  assert.deepEqual(plano.campos, { embarcar_real: '2026-09-15' });
  assert.equal(plano.parcelas.some(p => p.muda), false);
  assert.equal(plano.descricao, 'Datas do envio corrigidas: data de envio 24/09/2026 → 15/09/2026.');
});

test('parcela paga, com boleto ou ordem não muda; o prazo novo só vale nas outras', () => {
  const parcelas = [{ ...PARCELAS[0], travada: true, trava: 'Tem boleto do BB: o vencimento não muda.' }, PARCELAS[1]];
  const entrada = envio.lerEntrada({ data_envio: '2026-09-15', embarcar_previsao: '2026-09-10', faturamento_regra: 'ao_embarcar', prazos: [10, 45] }, 2);
  const plano = envio.planejar({ pedido: PEDIDO, parcelas, entrada, dataConversao: '2026-08-20' });
  assert.deepEqual(plano.parcelas.map(p => [p.prazo, p.vencimento, p.muda]), [[30, '2026-10-24', false], [45, '2026-10-30', true]]);
  assert.equal(plano.campos.prazo, '30/45', 'o prazo da travada fica o dela');
});

test('nada mexido: nada muda, mesmo com vencimento fora da conta', () => {
  const parcelas = [{ ...PARCELAS[0], vencimento: '2026-10-20' }, PARCELAS[1]];
  const entrada = envio.lerEntrada({ data_envio: '2026-09-24', embarcar_previsao: '2026-09-10', faturamento_regra: 'ao_embarcar', prazos: [30, 60] }, 2);
  const plano = envio.planejar({ pedido: PEDIDO, parcelas, entrada, dataConversao: '2026-08-20' });
  assert.equal(plano.nada, true);
  assert.equal(plano.descricao, null);
});

test('pedido antigo sem início: conta da conversão e só muda o que foi mexido', () => {
  const pedido = { ...PEDIDO, faturamento_regra: null, inicio_faturamento: null };
  const parcelas = [{ ...PARCELAS[0], vencimento: '2026-09-19' }, { ...PARCELAS[1], vencimento: '2026-10-19' }];
  const entrada = envio.lerEntrada({ data_envio: '2026-09-24', embarcar_previsao: '2026-09-10', faturamento_regra: 'ao_converter', prazos: [30, 90] }, 2);
  const plano = envio.planejar({ pedido, parcelas, entrada, dataConversao: '2026-08-20' });
  assert.deepEqual(plano.parcelas.map(p => [p.vencimento, p.muda]), [['2026-09-19', false], ['2026-11-18', true]]);
  assert.equal(plano.campos.faturamento_regra, 'ao_converter');
  assert.equal(plano.campos.inicio_faturamento, '2026-08-20');
});

// ------------------------------------------------------------ ponta a ponta

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  pedidos: ['id', 'numero', 'situacao', 'cliente_id', 'data_emissao', 'prazo', 'parcelas', 'devolucao',
    'embarcar_previsao', 'embarcar_real', 'inicio_faturamento', 'faturamento_regra'],
  pedido_parcelas: ['id', 'pedido_id', 'numero_parcela', 'valor', 'data_vencimento'],
  boletos: ['id', 'pedido_id', 'numero_parcela', 'status', 'valor'],
  recebimentos: ['id', 'pedido_id', 'numero_parcela', 'status', 'valor_recebido'],
  boletos_externos: ['id', 'pedido_id', 'numero_parcela', 'valor', 'ativo'],
  ordens_pagamento: ['id', 'pedido_id', 'numero_parcela', 'status', 'valor'],
  notas_fiscais: ['id', 'pedido_id', 'numero', 'serie', 'status_fiscal'],
  notas_fiscais_externas: ['id', 'pedido_id', 'numero', 'serie', 'data_emissao', 'ativo'],
  pedido_historico_eventos: ['id', 'pedido_id', 'tipo_evento', 'movimento_id', 'descricao', 'created_at', 'created_by']
};

function criarUpstream(dados) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const chamadas = [];
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const [, tabela, id] = url.pathname.split('/').filter(Boolean);
      const body = corpo ? JSON.parse(corpo) : null;
      chamadas.push({ metodo: req.method, tabela, id, body });
      const responder = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (!tabelas[tabela]) return responder(404, { error: 'Tabela não encontrada' });
      const colunas = COLUNAS[tabela] || [];
      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Not found' });
      }
      if (req.method === 'GET') {
        let linhas = tabelas[tabela];
        for (const [chave, valor] of url.searchParams.entries()) {
          if (colunas.includes(chave)) linhas = linhas.filter(r => String(r[chave]) === String(valor));
        }
        return responder(200, linhas);
      }
      if (req.method === 'POST') {
        const linha = {};
        for (const c of colunas) if (body?.[c] !== undefined) linha[c] = body[c];
        linha.id = Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1;
        tabelas[tabela].push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT') {
        const alvo = tabelas[tabela].find(r => String(r.id) === String(id));
        if (!alvo) return responder(404, { error: 'Not found' });
        for (const c of colunas) if (body?.[c] !== undefined) alvo[c] = body[c];
        return responder(200, alvo);
      }
      return responder(405, { error: 'Método não suportado' });
    });
  });
  return { servidor, tabelas, chamadas };
}

const MODULOS = ['./apiHttpClient', './permissionsController', './pedidosController'];

async function montar(dados, { permitir = true } = {}) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      exigirPermissao: chave => (req, res, next) => {
        const liberado = Array.isArray(permitir) ? permitir.includes(chave) : permitir;
        return liberado ? next() : res.status(403).json({ error: 'Sem permissão' });
      },
      exigirSupAdmin: (req, res, next) => next(),
      limparCachePermissoes: () => {}
    }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/pedidos', require('./pedidosController'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const porta = server.address().port;
  const chamar = (metodo, corpo) => fetch(`http://127.0.0.1:${porta}/api/pedidos/7/envio`, {
    method: metodo,
    headers: { authorization: `Bearer ${tokenDe(3)}`, 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  return {
    chamar,
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

function cenario(extra = {}) {
  return {
    pedidos: [{ ...PEDIDO, numero: 'P-7', cliente_id: 1, parcelas: 2 }],
    pedido_parcelas: [
      { id: 71, pedido_id: 7, numero_parcela: 1, valor: 500, data_vencimento: '2026-10-24' },
      { id: 72, pedido_id: 7, numero_parcela: 2, valor: 500, data_vencimento: '2026-11-23' }
    ],
    boletos: [],
    recebimentos: [],
    boletos_externos: [],
    ordens_pagamento: [],
    notas_fiscais: [],
    notas_fiscais_externas: [{ id: 1, pedido_id: 7, numero: 5501, serie: 1, data_emissao: '2026-09-15', ativo: true }],
    pedido_historico_eventos: [],
    ...extra
  };
}

const CORRECAO = { data_envio: '2026-09-15', embarcar_previsao: '2026-09-10', faturamento_regra: 'ao_embarcar' };

test('GET: devolve o pedido, as parcelas com as travas e a data da NF-e de fora', async () => {
  const ctx = await montar(cenario({
    recebimentos: [{ id: 1, pedido_id: 7, numero_parcela: 1, status: 'confirmado', valor_recebido: 500 }]
  }));
  try {
    const r = await ctx.chamar('GET');
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.bloqueio, null);
    assert.equal(corpo.pedido.embarcar_real, '2026-09-24');
    assert.equal(corpo.pedido.data_conversao, '2026-08-20');
    assert.deepEqual(corpo.parcelas.map(p => [p.numero, p.prazo, p.travada]), [[1, 30, true], [2, 60, false]]);
    assert.equal(corpo.parcelas[0].trava, 'Tem pagamento registrado: o vencimento não muda.');
    assert.deepEqual(corpo.nota_de_fora, { numero: 5501, serie: 1, data_emissao: '2026-09-15' });
  } finally {
    await ctx.encerrar();
  }
});

test('PUT: corrige o envio, move a parcela livre, deixa a paga e grava no histórico', async () => {
  const ctx = await montar(cenario({
    recebimentos: [{ id: 1, pedido_id: 7, numero_parcela: 1, status: 'confirmado', valor_recebido: 500 }]
  }));
  try {
    const r = await ctx.chamar('PUT', CORRECAO);
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.ok, true);
    const pedido = ctx.tabelas.pedidos[0];
    assert.equal(pedido.embarcar_real, '2026-09-15');
    assert.equal(pedido.inicio_faturamento, '2026-09-15');
    assert.deepEqual(ctx.tabelas.pedido_parcelas.map(p => p.data_vencimento), ['2026-10-24', '2026-11-14']);
    assert.equal(ctx.chamadas.filter(c => c.metodo === 'PUT' && c.tabela === 'pedido_parcelas').length, 1, 'só a parcela que muda');
    const [evento] = ctx.tabelas.pedido_historico_eventos;
    assert.equal(evento.tipo_evento, 'edicao');
    assert.equal(evento.created_by, 3);
    assert.match(evento.descricao, /^Datas do envio corrigidas: data de envio 24\/09\/2026 → 15\/09\/2026/);
  } finally {
    await ctx.encerrar();
  }
});

test('PUT: com NF-e do sistema autorizada, entregue ou sem permissão, nada é gravado', async () => {
  for (const [extra, status, texto] of [
    [{ notas_fiscais: [{ id: 9, pedido_id: 7, numero: 812, serie: 2, status_fiscal: 'autorizada' }] }, 409, /seguem a nota/],
    [{ pedidos: [{ ...PEDIDO, situacao: 'Entregue' }] }, 409, /Pedido entregue/]
  ]) {
    const ctx = await montar(cenario(extra));
    try {
      const r = await ctx.chamar('PUT', CORRECAO);
      assert.equal(r.status, status);
      assert.match((await r.json()).error, texto);
      assert.equal(ctx.chamadas.filter(c => c.metodo !== 'GET').length, 0);
    } finally {
      await ctx.encerrar();
    }
  }
  const semPermissao = await montar(cenario(), { permitir: ['ped.payment.edit'] });
  try {
    assert.equal((await semPermissao.chamar('PUT', CORRECAO)).status, 403, 'a rota pede ped.dates.edit');
    assert.equal((await semPermissao.chamar('GET')).status, 403);
  } finally {
    await semPermissao.encerrar();
  }
});

test('PUT: sem mexer em nada responde "nada" e não escreve', async () => {
  const ctx = await montar(cenario());
  try {
    const r = await ctx.chamar('PUT', { data_envio: '2026-09-24', embarcar_previsao: '2026-09-10', faturamento_regra: 'ao_embarcar' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).nada, true);
    assert.equal(ctx.chamadas.filter(c => c.metodo !== 'GET').length, 0);
  } finally {
    await ctx.encerrar();
  }
});
