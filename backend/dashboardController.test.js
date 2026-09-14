/**
 * GET /api/dashboard — quem vê o quê, e de onde vem.
 *
 * As contas são provadas em dashboardResumo.test.js. Aqui ficam as travas da
 * rota: permissão seção a seção (o painel não tem chave própria, e uma chave
 * errada esconderia a seção de TODO MUNDO), R$ que viram null sem a coluna,
 * tabela fora do ar que derruba só o que depende dela, permissão ilegível que
 * fecha o painel, e o cache — que não pode servir a um login as linhas lidas
 * com o token de outro.
 *
 * Rode com DASHBOARD_AMOSTRA=1 para ver a resposta inteira do cenário
 * realista (útil para conferir a tela contra o contrato).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { fromSelections } = require('./permissionsRepository');
const { resolvePermissionKey } = require('./permissionsCatalog');
const { contextoDeTempo, somarDias, resumirPrevisao } = require('./dashboardResumo');

// Carregados DENTRO de `montar`, depois de apontar API_BASE_URL para o duplo:
// `apiHttpClient` congela a URL no require, e um require no topo deixaria o
// cliente apontando para a API de verdade — que o modo de teste bloqueia.
const MODULOS = ['./apiHttpClient', './permissionsController', './dashboardController'];

const LIMITE_DA_CHAMADA_MS = 10 * 1000;

const TOKEN = 'x.eyJpZCI6MX0.assinatura-do-login-a';
const OUTRO_TOKEN = 'x.eyJpZCI6Mn0.assinatura-do-login-b';

// Em ordem alfabética: o teste das leituras compara com a lista ordenada.
const TODAS_AS_TABELAS = ['clientes', 'ia_extracoes', 'materia_prima', 'orcamentos', 'pedido_parcelas', 'pedidos', 'prospeccoes'];

// ---------------------------------------------------------------------------
// Permissões de verdade (estrutura do permissionsRepository), montadas por chave
// ---------------------------------------------------------------------------

function permissoesCom(...chaves) {
  const acoes = [];
  const colunas = [];
  const modulos = new Set();
  for (const chave of chaves) {
    const achada = resolvePermissionKey(chave);
    if (!achada) throw new Error(`chave inexistente no catálogo: ${chave}`);
    (achada.type === 'action' ? acoes : colunas).push(chave);
    modulos.add(achada.module);
  }
  return fromSelections({ acoes, colunas, modulos: [...modulos] });
}

const CHAVES_DO_PAINEL = [
  'ped.view', 'col_ped_total', 'col_ped_condicao', 'orc.view', 'col_orc_total', 'pros.view', 'col_pros_valor',
  'cli.view', 'mp.view', 'col_mp_estoque_atual', 'col_mp_custo_medio', 'ia.view',
  // Os nomes das listas e a probabilidade do ponderado: sem elas, o texto (ou
  // o ponderado) sai null — ver o teste do perfil Vendedor.
  'col_ped_cliente', 'col_orc_cliente', 'col_orc_campo_dono', 'col_pros_entidade',
  'col_pros_proximo_passo', 'col_pros_prob', 'col_mp_nome', 'col_mp_unidade'
];
const tudoMenos = (...fora) => permissoesCom(...CHAVES_DO_PAINEL.filter(c => !fora.includes(c)));

const TODAS_AS_SECOES = ['vendas', 'previsao', 'producao', 'orcamentos', 'alertas', 'prospeccao', 'clientes', 'estoque', 'ia'];

const SEM_PERMISSOES = { error: 'Não foi possível conferir suas permissões agora.' };
const FALHA_DOS_PEDIDOS = 'Não foi possível ler os pedidos agora.';
const FALHA_DA_PREVISAO = 'Não foi possível ler as parcelas dos pedidos agora.';

// ---------------------------------------------------------------------------
// Duplo do upstream: tabelas inteiras, como a API genérica devolve
// ---------------------------------------------------------------------------

function criarUpstream(dados, { falhar = {}, atrasarMs = {} } = {}) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const leituras = [];
  const pendentes = new Set();

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const tabela = url.pathname.split('/').filter(Boolean)[1];
    leituras.push({ metodo: req.method, tabela, autorizacao: req.headers.authorization });

    const responder = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.method !== 'GET') return responder(405, { error: 'Somente leitura' });
    if (falhar[tabela]) return responder(falhar[tabela], { error: 'Erro no SELECT', detalhe: 'falha simulada' });
    if (!tabelas[tabela]) return responder(404, { error: 'Tabela não encontrada' });

    const atraso = atrasarMs[tabela];
    if (!atraso) return responder(200, tabelas[tabela]);
    const timer = setTimeout(() => {
      pendentes.delete(timer);
      responder(200, tabelas[tabela]);
    }, atraso);
    pendentes.add(timer);
  });

  return { servidor, tabelas, leituras, pendentes };
}

/**
 * `permissoesReais`: usa o permissionsController DE VERDADE, que identifica o
 * usuário no upstream (GET /api/usuarios/:id). O duplo então precisa servir
 * `usuarios` (o objeto do usuário) — e `falhar.usuarios` simula o 401.
 */
async function montar(dados, { permissoes = tudoMenos(), falhar, atrasarMs, tempoLimiteMs, permissoesReais = false } = {}) {
  const upstream = criarUpstream(dados, { falhar, atrasarMs });
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  if (tempoLimiteMs) process.env.DASHBOARD_TEMPO_LIMITE_MS = String(tempoLimiteMs);
  else delete process.env.DASHBOARD_TEMPO_LIMITE_MS;

  for (const m of MODULOS) delete require.cache[require.resolve(m)];

  // Permissões dubladas: cada teste diz o que o usuário pode, e pode trocar no
  // meio (`estado`) para simular outro perfil, uma falha na identificação ou
  // uma identificação que nunca responde (`pendurar`).
  const estado = { permissoes, falha: null, pendurar: false };
  if (!permissoesReais) {
    const caminhoPerm = require.resolve('./permissionsController');
    require.cache[caminhoPerm] = {
      id: caminhoPerm,
      filename: caminhoPerm,
      loaded: true,
      exports: {
        obterPermissoesEfetivas: async () => {
          if (estado.falha) throw estado.falha;
          if (estado.pendurar) return new Promise(() => {});
          return estado.permissoes;
        }
      }
    };
  }

  const controller = require('./dashboardController');
  const app = express();
  app.use('/api/dashboard', controller);
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  const porta = servidor.address().port;

  return {
    estado,
    upstream,
    controller,
    lidas: tabela => upstream.leituras.filter(l => l.tabela === tabela).length,
    async chamar(consulta = '', token = TOKEN) {
      // Uma rota que nunca responde tem de REPROVAR o teste, não pendurar a
      // suíte inteira — o undici só desiste por conta própria em ~300 s.
      const resposta = await fetch(`http://127.0.0.1:${porta}/api/dashboard${consulta}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(LIMITE_DA_CHAMADA_MS)
      });
      const texto = await resposta.text();
      return {
        status: resposta.status,
        corpo: JSON.parse(texto),
        texto,
        cacheControl: resposta.headers.get('cache-control')
      };
    },
    async encerrar() {
      for (const timer of upstream.pendentes) clearTimeout(timer);
      upstream.servidor.closeAllConnections();
      servidor.closeAllConnections();
      await new Promise(r => servidor.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      delete process.env.DASHBOARD_TEMPO_LIMITE_MS;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

/**
 * Um mês de loja, com as datas presas a HOJE (em São Paulo) — a rota usa o
 * relógio de verdade. Meio-dia em São Paulo fica longe de qualquer virada.
 */
function cenario() {
  const { hoje } = contextoDeTempo(new Date());
  const dia = n => somarDias(hoje, n);
  const meioDia = n => `${dia(n)}T15:00:00.000Z`;

  return {
    clientes: [
      { id: 50, nome_fantasia: 'Móveis Aurora', razao_social: 'Aurora Móveis Ltda', status_cliente: 'Ativo' },
      { id: 51, nome_fantasia: '', razao_social: 'Casa Bela Decorações ME', status_cliente: 'ativo' },
      { id: 52, nome_fantasia: 'Decorações Silvia', razao_social: 'Silvia ME', status_cliente: 'Inativo' }
    ],
    pedidos: [
      { id: 101, numero: 'PED101', orcamento_id: 101, cliente_id: 50, situacao: 'Produção', data_emissao: meioDia(0), data_aprovacao: dia(0), valor_final: '8.200,00' },
      { id: 102, numero: 'PED102', orcamento_id: 102, cliente_id: 51, situacao: 'Produção', data_emissao: meioDia(-74), data_aprovacao: dia(-74), valor_final: 5000 },
      { id: 103, numero: 'PED103', orcamento_id: 103, cliente_id: 50, situacao: 'Entregue', data_emissao: meioDia(-40), data_aprovacao: dia(-40), valor_final: 12000 },
      { id: 104, numero: 'PED104', orcamento_id: 104, cliente_id: 52, situacao: 'Cancelado', data_emissao: meioDia(-20), data_aprovacao: dia(-20), data_cancelamento: meioDia(0), valor_final: 3200 },
      { id: 105, numero: 'PED105', orcamento_id: 105, cliente_id: 51, situacao: 'Enviado', data_emissao: meioDia(0), data_aprovacao: dia(0), valor_final: '1234.50' }
    ],
    // O 101 em 2x, a 2ª daqui a 400 dias — sempre além do horizonte de 12
    // meses; o 103 em 3x, uma delas no formato em que o upstream serializa um
    // DATE. O 104 é cancelado (some), o 105 não tem parcela (vira estimado) e
    // a do pedido 999 é órfã.
    pedido_parcelas: [
      { id: 1, pedido_id: 101, numero_parcela: 1, valor: '4100.00', data_vencimento: dia(10) },
      { id: 2, pedido_id: 101, numero_parcela: 2, valor: '4100.00', data_vencimento: dia(400) },
      { id: 3, pedido_id: 102, numero_parcela: 1, valor: '5000.00', data_vencimento: dia(-60) },
      { id: 4, pedido_id: 103, numero_parcela: 1, valor: '4000.00', data_vencimento: dia(-40) },
      { id: 5, pedido_id: 103, numero_parcela: 2, valor: '4000.00', data_vencimento: `${dia(-10)}T00:00:00.000Z` },
      { id: 6, pedido_id: 103, numero_parcela: 3, valor: '4000.00', data_vencimento: dia(20) },
      { id: 7, pedido_id: 104, numero_parcela: 1, valor: '3200.00', data_vencimento: dia(5) },
      { id: 8, pedido_id: 999, numero_parcela: 1, valor: '100.00', data_vencimento: dia(3) }
    ],
    orcamentos: [
      { id: 101, numero: 'ORC101', situacao: 'Aprovado', cliente_id: 50, data_aprovacao: meioDia(0), valor_final: '8.200,00', dono: 'Ana' },
      { id: 102, numero: 'ORC102', situacao: 'Aprovado', cliente_id: 51, data_aprovacao: meioDia(-74), valor_final: 5000, dono: 'Bruno' },
      { id: 103, numero: 'ORC103', situacao: 'Aprovado', cliente_id: 50, data_aprovacao: meioDia(-40), valor_final: 12000, dono: 'Bruno' },
      { id: 104, numero: 'ORC104', situacao: 'Aprovado', cliente_id: 52, data_aprovacao: meioDia(-20), valor_final: 3200, dono: 'Carla' },
      { id: 105, numero: 'ORC105', situacao: 'Aprovado', cliente_id: 51, data_aprovacao: meioDia(0), valor_final: '1234.50', dono: 'Ana' },
      { id: 201, numero: 'ORC201', situacao: 'Pendente', cliente_id: 51, validade: dia(2), valor_final: 4500, dono: 'Ana' },
      { id: 202, numero: 'OCRP202', situacao: 'Pendente', cliente_id: null, prospeccao_id: 301, validade: dia(5), valor_final: '2.300,00', dono: 'Bruno' },
      { id: 203, numero: 'ORC203', situacao: 'Pendente', cliente_id: 50, validade: dia(-3), valor_final: 9000, dono: 'Ana' },
      { id: 204, numero: 'ORC204', situacao: 'Rascunho', cliente_id: 52, valor_final: 1500, dono: 'Carla' },
      // A conversão falhou: aprovado, e pedido nenhum.
      { id: 205, numero: 'ORC205', situacao: 'Aprovado', cliente_id: 52, data_aprovacao: meioDia(-1), valor_final: 1000, dono: 'Carla' },
      { id: 206, numero: 'ORC206', situacao: 'Rejeitado', cliente_id: 50, data_aprovacao: meioDia(-20), valor_final: 7000, dono: 'Ana' }
    ],
    prospeccoes: [
      { id: 301, nome_fantasia: 'Casa Vicenzo', etapa: 'Proposta', status: 'ativa', valor_estimado: 50000, probabilidade: 65, proximo_passo: 'Ligar para fechar', proximo_passo_data: dia(-3) },
      { id: 302, nome_fantasia: 'Marcenaria Serrana', etapa: 'Novo', status: 'ativa', valor_estimado: '12.000,00', probabilidade: 10, proximo_passo: 'Enviar catálogo', proximo_passo_data: dia(0) },
      { id: 303, razao_social: 'Hotel Atlântico S.A.', etapa: 'Negociação', status: 'ativa', valor_estimado: 80000, probabilidade: 80, proximo_passo: 'Revisar proposta', proximo_passo_data: dia(4) },
      { id: 304, nome_fantasia: 'Loja Nova', etapa: 'Ganho', status: 'arquivada', cliente_id: 51, convertida_em: meioDia(0), valor_estimado: 15000, probabilidade: 100 },
      { id: 305, nome_fantasia: 'Sem Retorno', etapa: 'Perdido', status: 'arquivada', valor_estimado: 9000, probabilidade: 0 }
    ],
    materia_prima: [
      { id: 401, nome: 'Cola PVA', quantidade: -3.5, unidade: 'L', processo: 'Montagem', preco_unitario: 20 },
      { id: 402, nome: 'MDF 15mm', quantidade: 40, unidade: 'CH', processo: 'Corte', preco_unitario: '189,90' },
      { id: 403, nome: 'Parafuso 4x40', quantidade: 0, unidade: 'UN', processo: 'Montagem', preco_unitario: 0.12 },
      { id: 404, nome: 'Lixa 120', quantidade: 6, unidade: 'UN', processo: 'Acabamento', preco_unitario: 2.5 },
      { id: 405, nome: 'Energia', quantidade: 0, unidade: 'KWH', infinito: true, preco_unitario: 1 }
    ],
    ia_extracoes: [
      { id: 1, titulo: 'Planilha de chapas', status: 'revisao' },
      { id: 2, titulo: 'Cartões da feira', status: 'aplicada' },
      { id: 3, titulo: 'Pedido escaneado', status: 'revisao' }
    ]
  };
}

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

test('o painel completo sai no formato do contrato, com cada tabela lida uma vez', async t => {
  const ctx = await montar(cenario());
  try {
    const { status, corpo, cacheControl } = await ctx.chamar();
    assert.equal(status, 200);
    if (process.env.DASHBOARD_AMOSTRA) t.diagnostic(JSON.stringify(corpo));

    assert.deepEqual(Object.keys(corpo), ['geradoEm', 'hoje', 'mesAtual', 'secoes', 'falhas']);
    assert.deepEqual(Object.keys(corpo.secoes), TODAS_AS_SECOES);
    assert.deepEqual(corpo.falhas, {}, '`falhas` vem sempre, vazio quando nada falhou');
    assert.match(corpo.hoje, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(corpo.mesAtual, corpo.hoje.slice(0, 7));
    assert.ok(!Number.isNaN(Date.parse(corpo.geradoEm)));
    assert.equal(cacheControl, 'no-store', 'dado de negócio não vai para o cache de disco');

    const { secoes } = corpo;
    assert.equal(secoes.vendas.mesAtual.quantidade, 2, 'o cancelado fica fora');
    assert.equal(secoes.vendas.mesAtual.valor, 9434.5);
    assert.equal(secoes.vendas.canceladosMes.quantidade, 1);
    assert.equal(secoes.vendas.serie12m.length, 12);
    assert.equal(secoes.producao.quantidade, 2);
    assert.deepEqual(secoes.producao.maisAntigos.map(p => [p.numero, p.cliente, p.dias]),
      [['PED102', 'Casa Bela Decorações ME', 74], ['PED101', 'Móveis Aurora', 0]]);
    assert.equal(secoes.orcamentos.vencendo7d.total, 2);
    assert.equal(secoes.orcamentos.vencendo7d.itens[1].destinatario, 'Casa Vicenzo');
    assert.deepEqual(secoes.alertas.aprovadosSemPedido.itens.map(i => i.numero), ['ORC205']);
    assert.equal(secoes.prospeccao.abertos, 3);
    assert.equal(secoes.prospeccao.convertidosMes, 1);
    assert.deepEqual(secoes.clientes, { ativos: 2, total: 3 });
    assert.equal(secoes.estoque.negativos.quantidade, 1);
    assert.deepEqual(secoes.ia, { emRevisao: 2 });

    // Previsão: o 104 (cancelado) some, o 105 (sem parcela) entra estimado, a
    // parcela do pedido 999 é órfã e a de daqui a 400 dias passa do horizonte.
    const itensDaPrevisao = secoes.previsao.meses.flatMap(m => m.itens);
    assert.equal(itensDaPrevisao.some(i => i.pedidoId === 104), false);
    assert.ok(itensDaPrevisao.some(i => i.pedidoId === 105 && i.estimada));
    assert.deepEqual(secoes.previsao.semParcelas, { pedidos: 1, valor: 1234.5 });
    assert.equal(secoes.previsao.orfas, 1);
    assert.equal(secoes.previsao.alemDoHorizonte.parcelas, 1);
    assert.equal(secoes.previsao.alemDoHorizonte.valor, 4100);
    assert.deepEqual(secoes.previsao.meses.slice(0, 12).map(m => m.mes), secoes.vendas.serie12m.map(m => m.mes),
      'as barras verdes dividem o eixo com as de ouro');
    // O resto é a conta pura: a rota só a alimenta, com as tabelas que leu.
    // Meio-dia do dia que a rota respondeu dá o mesmo mês que ela usou.
    assert.deepEqual(secoes.previsao, resumirPrevisao(cenario(), { agora: new Date(`${corpo.hoje}T15:00:00.000Z`) }));

    for (const tabela of TODAS_AS_TABELAS) {
      assert.equal(ctx.lidas(tabela), 1, `${tabela} lida uma vez só, mesmo usada por várias seções`);
    }
  } finally {
    await ctx.encerrar();
  }
});

/*
 * A seção 5 do SPEC, folha a folha — é exatamente o que src/js/dashboard.js lê.
 * Um campo renomeado ou com tipo trocado não quebra nada na tela: o cartão só
 * passa a mostrar zero, ou esconde o R$ como se o perfil não tivesse a coluna.
 * Por isso a forma inteira fica presa aqui, e não só os números da amostra.
 *
 *   dinheiro  número com até 2 casas, ou null quando falta a coluna de valor
 *   contagem  inteiro >= 0;   numero  número finito (dias de atraso, saldo)
 *   texto     string não vazia — nome ausente chega como "—", nunca vazio
 */
/**
 * Lista que pode vir vazia em PARTE dos elementos: os meses sem parcela da
 * previsão. A forma do item continua conferida nos meses que têm; o teste do
 * contrato exige que o cenário tenha pelo menos um.
 */
const PODE_VIR_VAZIA = Symbol('pode vir vazia');
const podeVirVazia = forma => Object.assign([...forma], { [PODE_VIR_VAZIA]: true });

const FORMA_SOMA = { quantidade: 'contagem', valor: 'dinheiro' };
const FORMA_TICKET = { ...FORMA_SOMA, ticketMedio: 'dinheiro' };
const FORMA_DO_CONTRATO = {
  vendas: {
    mesAtual: FORMA_TICKET,
    mesAnteriorMesmoPeriodo: FORMA_TICKET,
    mesAnterior: FORMA_TICKET,
    canceladosMes: FORMA_SOMA,
    serie12m: [{ mes: 'mes', quantidade: 'contagem', valor: 'dinheiro' }]
  },
  previsao: {
    meses: [{
      mes: 'mes', valor: 'dinheiro', parcelas: 'contagem', pedidos: 'contagem', outros: 'contagem',
      itens: podeVirVazia([{
        pedidoId: 'id', numero: 'texto|null', cliente: 'texto', totalParcelas: 'contagem',
        valor: 'dinheiro', estimada: 'booleano',
        parcelas: [{ numero: 'contagem', vencimento: 'dia', valor: 'dinheiro' }]
      }])
    }],
    programadoDesteMes: 'dinheiro',
    alemDoHorizonte: { valor: 'dinheiro', parcelas: 'contagem', ate: 'mes|null' },
    semParcelas: { pedidos: 'contagem', valor: 'dinheiro' },
    orfas: 'contagem',
    semData: 'contagem'
  },
  producao: {
    quantidade: 'contagem',
    valor: 'dinheiro',
    porIdade: [{ faixa: 'texto', quantidade: 'contagem' }],
    maisAntigos: [{ id: 'id', numero: 'texto|null', cliente: 'texto', dias: 'contagem', valor: 'dinheiro' }],
    porSituacao12m: [{ situacao: 'texto', quantidade: 'contagem', valor: 'dinheiro' }]
  },
  orcamentos: {
    pendentesVigentes: FORMA_SOMA,
    pendentesVencidos: FORMA_SOMA,
    rascunhos: FORMA_SOMA,
    vencendo7d: {
      total: 'contagem',
      itens: [{
        id: 'id', numero: 'texto|null', destinatario: 'texto', dono: 'texto',
        validade: 'dia', diasRestantes: 'contagem', valor: 'dinheiro'
      }]
    },
    decisao90d: {
      aprovados: 'contagem', rejeitados: 'contagem', expirados: 'contagem',
      decididos: 'contagem', taxaAprovacao: 'fracao|null'
    }
  },
  alertas: {
    aprovadosSemPedido: {
      quantidade: 'contagem',
      itens: [{ id: 'id', numero: 'texto|null', destinatario: 'texto', valor: 'dinheiro' }]
    }
  },
  prospeccao: {
    abertos: 'contagem',
    valorEmAberto: 'dinheiro',
    valorPonderado: 'dinheiro',
    funil: [{ etapa: 'texto', quantidade: 'contagem', valor: 'dinheiro' }],
    followups: {
      atrasados: 'contagem',
      hoje: 'contagem',
      proximos7: 'contagem',
      itens: [{ id: 'id', nome: 'texto', etapa: 'texto|null', proximoPasso: 'texto|null', data: 'dia', dias: 'numero' }]
    },
    convertidosMes: 'contagem'
  },
  clientes: { ativos: 'contagem', total: 'contagem' },
  estoque: {
    negativos: {
      quantidade: 'contagem',
      itens: [{ id: 'id', nome: 'texto', quantidade: 'numero', unidade: 'texto|null', processo: 'texto|null' }]
    },
    zerados: 'contagem',
    criticos: 'contagem',
    limiteCritico: 'numero',
    valorEstoque: 'dinheiro'
  },
  ia: { emRevisao: 'contagem' }
};

const FOLHA_VALIDA = {
  contagem: v => Number.isInteger(v) && v >= 0,
  numero: v => typeof v === 'number' && Number.isFinite(v),
  texto: v => typeof v === 'string' && v.trim() !== '',
  'texto|null': v => v === null || (typeof v === 'string' && v.trim() !== ''),
  id: v => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== ''),
  dia: v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  mes: v => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v),
  'fracao|null': v => v === null || (typeof v === 'number' && v >= 0 && v <= 1),
  'mes|null': v => v === null || (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v)),
  booleano: v => typeof v === 'boolean'
};

/**
 * As divergências entre `valor` e `forma`. `comValores` diz se o R$ deve vir
 * número (true) ou null (false). Lista vazia conta como divergência: sem uma
 * linha, a forma do item não foi conferida — o cenário tem de ter linha em
 * toda lista.
 */
function divergenciasDaForma(valor, forma, caminho, comValores) {
  if (Array.isArray(forma)) {
    if (!Array.isArray(valor)) return [`${caminho}: não é lista`];
    if (!valor.length) return forma[PODE_VIR_VAZIA] ? [] : [`${caminho}: lista vazia no cenário`];
    return valor.flatMap((item, i) => divergenciasDaForma(item, forma[0], `${caminho}[${i}]`, comValores));
  }
  if (typeof forma === 'object') {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return [`${caminho}: não é objeto`];
    const faltam = Object.keys(forma).filter(k => !(k in valor)).map(k => `${caminho}.${k}: ausente`);
    const sobram = Object.keys(valor).filter(k => !(k in forma)).map(k => `${caminho}.${k}: fora do contrato`);
    const filhos = Object.keys(forma).filter(k => k in valor)
      .flatMap(k => divergenciasDaForma(valor[k], forma[k], `${caminho}.${k}`, comValores));
    return [...faltam, ...sobram, ...filhos];
  }
  const veio = JSON.stringify(valor);
  if (forma === 'dinheiro') {
    if (!comValores) return valor === null ? [] : [`${caminho}: R$ devia ser null sem a coluna (veio ${veio})`];
    const centavos = typeof valor === 'number' && Number.isFinite(valor) && Math.round(valor * 100) / 100 === valor;
    return centavos ? [] : [`${caminho}: R$ devia ser número com até 2 casas (veio ${veio})`];
  }
  return FOLHA_VALIDA[forma](valor) ? [] : [`${caminho}: esperava ${forma} (veio ${veio})`];
}

test('cada seção sai com exatamente os campos do contrato, e o R$ é número ou null conforme a coluna', async () => {
  const perfis = [
    { nome: 'com as colunas de valor', permissoes: tudoMenos(), comValores: true, secoes: TODAS_AS_SECOES },
    {
      nome: 'sem nenhuma coluna de valor',
      permissoes: tudoMenos('col_ped_total', 'col_orc_total', 'col_pros_valor', 'col_mp_custo_medio'),
      comValores: false,
      // A previsão é só dinheiro: sem col_ped_total ela nem vem, em vez de vir com R$ null.
      secoes: TODAS_AS_SECOES.filter(s => s !== 'previsao')
    }
  ];
  assert.deepEqual(Object.keys(FORMA_DO_CONTRATO), TODAS_AS_SECOES);
  for (const perfil of perfis) {
    const ctx = await montar(cenario(), { permissoes: perfil.permissoes });
    try {
      const { corpo } = await ctx.chamar();
      assert.deepEqual(Object.keys(corpo.secoes), perfil.secoes, perfil.nome);
      assert.deepEqual(corpo.falhas, {}, perfil.nome);
      const divergencias = perfil.secoes.flatMap(secao =>
        divergenciasDaForma(corpo.secoes[secao], FORMA_DO_CONTRATO[secao], secao, perfil.comValores));
      assert.deepEqual(divergencias, [], perfil.nome);
      if (corpo.secoes.previsao) {
        // Mês sem parcela vem sem itens; algum mês tem de ter, senão a forma
        // do item da previsão não foi conferida.
        const itens = corpo.secoes.previsao.meses.flatMap(m => m.itens);
        assert.ok(itens.some(i => !i.estimada) && itens.some(i => i.estimada), 'item parcelado e item estimado');
      }
    } finally {
      await ctx.encerrar();
    }
  }
});

test('só as tabelas das seções visíveis são lidas, e nada além de GET', async () => {
  const soIa = await montar(cenario(), { permissoes: permissoesCom('ia.view') });
  try {
    const { corpo } = await soIa.chamar();
    assert.deepEqual(Object.keys(corpo.secoes), ['ia']);
    assert.deepEqual(soIa.upstream.leituras.map(l => l.tabela), ['ia_extracoes']);
  } finally {
    await soIa.encerrar();
  }

  const completo = await montar(cenario());
  try {
    await completo.chamar();
    // Tabelas de itens e de movimentos nunca: são as maiores do sistema.
    const lidas = [...new Set(completo.upstream.leituras.map(l => l.tabela))].sort();
    assert.deepEqual(lidas, TODAS_AS_TABELAS);
    assert.ok(completo.upstream.leituras.every(l => l.metodo === 'GET'), 'o painel só lê');
  } finally {
    await completo.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Permissões
// ---------------------------------------------------------------------------

test('sem a view de pedidos, vendas, previsão, produção e alertas somem — e não viram falha', async () => {
  const ctx = await montar(cenario(), { permissoes: tudoMenos('ped.view') });
  try {
    const { corpo } = await ctx.chamar();
    for (const secao of ['vendas', 'previsao', 'producao', 'alertas']) {
      assert.equal(secao in corpo.secoes, false, `${secao} não pode aparecer`);
      assert.equal(secao in corpo.falhas, false, `${secao} sem permissão não é falha, é ausência`);
    }
    assert.ok(corpo.secoes.orcamentos);
    assert.equal(ctx.lidas('pedidos'), 0, 'nem se lê o que não vai ser mostrado');
    assert.equal(ctx.lidas('pedido_parcelas'), 0);
  } finally {
    await ctx.encerrar();
  }
});

test('sem a coluna de valor os R$ viram null e as contagens ficam', async () => {
  const ctx = await montar(cenario(), { permissoes: tudoMenos('col_ped_total', 'col_mp_custo_medio') });
  try {
    const { secoes } = (await ctx.chamar()).corpo;
    assert.deepEqual(secoes.vendas.mesAtual, { quantidade: 2, valor: null, ticketMedio: null });
    assert.ok(secoes.vendas.serie12m.every(m => m.valor === null && typeof m.quantidade === 'number'));
    assert.equal(secoes.producao.quantidade, 2);
    assert.equal(secoes.producao.valor, null);
    assert.ok(secoes.producao.maisAntigos.every(p => p.valor === null));
    assert.equal(secoes.estoque.valorEstoque, null);
    assert.equal(secoes.estoque.zerados, 1);
    // Coluna de outro módulo: orçamentos continuam com R$.
    assert.equal(secoes.orcamentos.pendentesVigentes.valor, 6800);
  } finally {
    await ctx.encerrar();
  }
});

test('estoque exige a coluna de quantidade além da view', async () => {
  const ctx = await montar(cenario(), { permissoes: permissoesCom('mp.view', 'col_mp_custo_medio') });
  try {
    const { corpo } = await ctx.chamar();
    assert.deepEqual(corpo.secoes, {});
    assert.deepEqual(corpo.falhas, {});
    assert.equal(ctx.lidas('materia_prima'), 0);
  } finally {
    await ctx.encerrar();
  }
});

test('estoque exige a view além da coluna de quantidade', async () => {
  // O espelho do teste acima: coluna liberada sem a view também não abre o card.
  const ctx = await montar(cenario(), { permissoes: permissoesCom('col_mp_estoque_atual', 'col_mp_custo_medio') });
  try {
    const { corpo } = await ctx.chamar();
    assert.deepEqual(corpo.secoes, {});
    assert.deepEqual(corpo.falhas, {});
    assert.equal(ctx.lidas('materia_prima'), 0);
  } finally {
    await ctx.encerrar();
  }
});

test('cada view tira só as seções dela, e a tabela dela nem é lida', async () => {
  const casos = [
    // Sem cli.view a tabela de clientes continua lida: ela dá nome às listas
    // de produção, previsão, orçamentos e alertas (o nome segue a coluna).
    { view: 'cli.view', secoes: ['clientes'], tabela: null },
    { view: 'orc.view', secoes: ['orcamentos', 'alertas'], tabela: 'orcamentos' },
    { view: 'pros.view', secoes: ['prospeccao'], tabela: 'prospeccoes' },
    { view: 'mp.view', secoes: ['estoque'], tabela: 'materia_prima' },
    { view: 'ia.view', secoes: ['ia'], tabela: 'ia_extracoes' }
  ];
  for (const caso of casos) {
    const ctx = await montar(cenario(), { permissoes: tudoMenos(caso.view) });
    try {
      const { corpo } = await ctx.chamar();
      assert.deepEqual(Object.keys(corpo.secoes), TODAS_AS_SECOES.filter(s => !caso.secoes.includes(s)), caso.view);
      assert.deepEqual(corpo.falhas, {}, `${caso.view}: sem permissão não é falha, é ausência`);
      if (caso.tabela) assert.equal(ctx.lidas(caso.tabela), 0, `${caso.view}: ${caso.tabela} não é lida`);
      else assert.equal(ctx.lidas('clientes'), 1, 'cli.view: clientes continua lida, só para os nomes');
    } finally {
      await ctx.encerrar();
    }
  }
});

test('alertas exige orçamentos E pedidos', async () => {
  const soOrc = await montar(cenario(), { permissoes: permissoesCom('orc.view', 'col_orc_total') });
  try {
    const { corpo } = await soOrc.chamar();
    assert.ok(corpo.secoes.orcamentos);
    assert.equal('alertas' in corpo.secoes, false);
    assert.equal(soOrc.lidas('pedidos'), 0);
  } finally {
    await soOrc.encerrar();
  }

  const soPed = await montar(cenario(), { permissoes: permissoesCom('ped.view', 'col_ped_total') });
  try {
    const { corpo } = await soPed.chamar();
    assert.ok(corpo.secoes.vendas);
    assert.equal('alertas' in corpo.secoes, false);
    assert.equal(soPed.lidas('orcamentos'), 0);
  } finally {
    await soPed.encerrar();
  }

  const ambos = await montar(cenario(), { permissoes: permissoesCom('orc.view', 'ped.view') });
  try {
    const { corpo } = await ambos.chamar();
    assert.equal(corpo.secoes.alertas.aprovadosSemPedido.quantidade, 1);
    assert.equal(corpo.secoes.alertas.aprovadosSemPedido.itens[0].valor, null, 'sem col_orc_total');
  } finally {
    await ambos.encerrar();
  }
});

test('o R$ de alertas segue a coluna de valor de Orçamentos, não a de Pedidos', async () => {
  // O item é um ORÇAMENTO aprovado: quem não vê o R$ dele no card de
  // orçamentos não pode vê-lo aqui só porque vê o R$ dos pedidos.
  const soPedidos = await montar(cenario(), { permissoes: permissoesCom('orc.view', 'ped.view', 'col_ped_total') });
  try {
    const { itens } = (await soPedidos.chamar()).corpo.secoes.alertas.aprovadosSemPedido;
    assert.ok(itens.length > 0);
    assert.ok(itens.every(i => i.valor === null));
  } finally {
    await soPedidos.encerrar();
  }

  const soOrcamentos = await montar(cenario(), { permissoes: permissoesCom('orc.view', 'ped.view', 'col_orc_total') });
  try {
    const { itens } = (await soOrcamentos.chamar()).corpo.secoes.alertas.aprovadosSemPedido;
    assert.ok(itens.length > 0);
    assert.ok(itens.every(i => typeof i.valor === 'number'));
  } finally {
    await soOrcamentos.encerrar();
  }
});

test('sem col_pros_valor só os R$ da prospecção somem', async () => {
  const ctx = await montar(cenario(), { permissoes: tudoMenos('col_pros_valor') });
  try {
    const { secoes } = (await ctx.chamar()).corpo;
    assert.equal(secoes.prospeccao.valorEmAberto, null);
    assert.equal(secoes.prospeccao.valorPonderado, null);
    assert.ok(secoes.prospeccao.funil.every(e => e.valor === null));
    assert.equal(secoes.prospeccao.abertos, 3, 'as contagens ficam');
    assert.equal(typeof secoes.orcamentos.pendentesVigentes.valor, 'number', 'coluna de outro módulo');
  } finally {
    await ctx.encerrar();
  }
});

test('perfil sem as colunas de nome lê as contas, mas nenhum nome de cliente, prospecção, responsável ou insumo', async () => {
  // O perfil "Vendedor" real: vê pedidos e orçamentos, com a coluna Cliente
  // escondida na grade. O painel não pode ser a única tela que mostra o nome.
  const colunasDeNome = ['col_ped_cliente', 'col_orc_cliente', 'col_orc_campo_dono', 'col_pros_entidade',
    'col_pros_proximo_passo', 'col_mp_nome', 'col_mp_unidade'];
  const ctx = await montar(cenario(), { permissoes: tudoMenos(...colunasDeNome) });
  try {
    const { corpo, texto } = await ctx.chamar();
    const { secoes } = corpo;
    const semTexto = (linhas, ...campos) => {
      assert.ok(linhas.length > 0, 'lista vazia não prova nada');
      return linhas.every(linha => campos.every(c => linha[c] === null));
    };
    assert.ok(semTexto(secoes.producao.maisAntigos, 'cliente'));
    assert.ok(semTexto(secoes.previsao.meses.flatMap(m => m.itens), 'cliente'));
    assert.ok(semTexto(secoes.orcamentos.vencendo7d.itens, 'destinatario', 'dono'));
    assert.ok(semTexto(secoes.alertas.aprovadosSemPedido.itens, 'destinatario'));
    assert.ok(semTexto(secoes.prospeccao.followups.itens, 'nome', 'proximoPasso'));
    assert.ok(semTexto(secoes.estoque.negativos.itens, 'nome', 'unidade'));
    // O que não identifica ninguém continua: número, etapa, datas, contagens.
    assert.equal(secoes.producao.maisAntigos[0].numero, 'PED102');
    assert.equal(secoes.prospeccao.followups.itens[0].etapa, 'Proposta');
    for (const nome of ['Móveis Aurora', 'Casa Bela', 'Casa Vicenzo', 'Marcenaria Serrana', 'Ligar para fechar', 'Cola PVA']) {
      assert.equal(texto.includes(nome), false, `"${nome}" não pode sair`);
    }
  } finally {
    await ctx.encerrar();
  }
});

test('o nome da prospecção no destinatário só sai com pros.view e col_pros_entidade, e só atrás da coluna Cliente', async () => {
  // A coluna Cliente de Orçamentos abre o TEXTO do destinatário; sem ela sai
  // null (a tela cai no rótulo genérico). Com ela, o orçamento de prospecção
  // mostra a categoria "Prospecção" até o perfil poder ver o NOME da
  // prospecção — pros.view (o pipeline) E col_pros_entidade (a coluna do nome).
  const casos = [
    { extras: [], esperado: null },
    { extras: ['pros.view'], esperado: null },
    { extras: ['pros.view', 'col_pros_entidade'], esperado: null },
    { extras: ['col_orc_cliente'], esperado: 'Prospecção' },
    { extras: ['col_orc_cliente', 'pros.view'], esperado: 'Prospecção' },
    { extras: ['col_orc_cliente', 'pros.view', 'col_pros_entidade'], esperado: 'Casa Vicenzo' }
  ];
  for (const { extras, esperado } of casos) {
    const perfil = `orc.view + ${extras.join(' + ') || 'nada'}`;
    const ctx = await montar(cenario(), { permissoes: permissoesCom('orc.view', 'col_orc_total', ...extras) });
    try {
      const { corpo, texto } = await ctx.chamar();
      const ocrp = corpo.secoes.orcamentos.vencendo7d.itens.find(i => i.numero === 'OCRP202');
      assert.equal(ocrp.destinatario, esperado, perfil);
      // Quem não pode ver o nome não o recebe por campo nenhum.
      if (!(extras.includes('pros.view') && extras.includes('col_pros_entidade'))) {
        assert.equal(texto.includes('Casa Vicenzo'), false, perfil);
      }
      if (!extras.includes('pros.view')) {
        assert.equal(ctx.lidas('prospeccoes'), 0, `${perfil}: o pipeline nem é lido para quem não pode vê-lo`);
      }
    } finally {
      await ctx.encerrar();
    }
  }
});

test('falha ao obter as permissões fecha o painel com 503, sem ler tabela nenhuma', async () => {
  // 503, e não 200 vazio: vazio a tela lê como "seu perfil não tem
  // indicadores" — mentira quando a sessão venceu ou o upstream caiu.
  const ctx = await montar(cenario());
  try {
    ctx.estado.falha = new Error('upstream de usuários fora do ar');
    const lancou = await ctx.chamar();
    assert.equal(lancou.status, 503);
    assert.deepEqual(lancou.corpo, SEM_PERMISSOES);

    ctx.estado.falha = null;
    ctx.estado.permissoes = { ...tudoMenos(), erro: true };
    const comErro = await ctx.chamar();
    assert.equal(comErro.status, 503);
    assert.deepEqual(comErro.corpo, SEM_PERMISSOES);

    assert.equal(ctx.upstream.leituras.length, 0, 'sem permissão conhecida, nada sai do upstream');
  } finally {
    await ctx.encerrar();
  }
});

test('identificação que não responde também vira 503, no prazo das tabelas', async () => {
  const ctx = await montar(cenario(), { tempoLimiteMs: 100 });
  try {
    ctx.estado.pendurar = true;
    const inicio = Date.now();
    const { status, corpo } = await ctx.chamar();
    assert.ok(Date.now() - inicio < 1000, 'não espera o tempo-limite do undici (~300 s)');
    assert.equal(status, 503);
    assert.deepEqual(corpo, SEM_PERMISSOES);
    assert.equal(ctx.upstream.leituras.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('com as permissões de verdade, usuário não identificado (401) dá 503 — e a falha não fica guardada', async () => {
  // Sem o dublê: o permissionsController real pergunta ao upstream quem é o
  // dono do token (GET /api/usuarios/1). O 401 ali é "não sei quem é você".
  const falhar = { usuarios: 401 };
  const dados = { ...cenario(), usuarios: { id: 1, perfil: 'Sup Admin' } };
  const ctx = await montar(dados, { permissoesReais: true, falhar });
  try {
    const recusada = await ctx.chamar();
    assert.equal(recusada.status, 503);
    assert.deepEqual(recusada.corpo, SEM_PERMISSOES);
    assert.deepEqual(ctx.upstream.leituras.map(l => l.tabela), ['usuarios'], 'nenhuma tabela do painel é lida');

    // A sessão volta: a mesma instância, sem reiniciar nada, abre o painel.
    delete falhar.usuarios;
    const aceita = await ctx.chamar();
    assert.equal(aceita.status, 200);
    assert.deepEqual(Object.keys(aceita.corpo.secoes), TODAS_AS_SECOES, 'Sup Admin vê tudo');
    assert.deepEqual(aceita.corpo.falhas, {});
  } finally {
    await ctx.encerrar();
  }
});

test('toda chave de permissão do painel existe no catálogo', async () => {
  // can() devolve false para chave desconhecida: um erro de digitação aqui
  // esconderia a seção de TODO MUNDO, sem uma linha no log.
  const ctx = await montar(cenario());
  try {
    const chaves = new Set(['pros.view']);
    for (const secao of ctx.controller.SECOES) {
      secao.exige.forEach(c => chaves.add(c));
      if (secao.valores) chaves.add(secao.valores);
    }
    for (const chave of chaves) assert.ok(resolvePermissionKey(chave), `"${chave}" não existe no catálogo`);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Falhas do upstream
// ---------------------------------------------------------------------------

test('tabela que falha derruba só as seções que dependem dela', async () => {
  const ctx = await montar(cenario(), { falhar: { materia_prima: 500 } });
  try {
    const { status, corpo } = await ctx.chamar();
    assert.equal(status, 200);
    assert.deepEqual(corpo.falhas, { estoque: 'Não foi possível ler a matéria-prima agora.' });
    assert.deepEqual(Object.keys(corpo.secoes), TODAS_AS_SECOES.filter(s => s !== 'estoque'));
  } finally {
    await ctx.encerrar();
  }
});

test('pedidos fora do ar derrubam vendas, previsão, produção e alertas, e só elas', async () => {
  const ctx = await montar(cenario(), { falhar: { pedidos: 503 } });
  try {
    const { corpo, texto } = await ctx.chamar();
    assert.deepEqual(Object.keys(corpo.falhas), ['vendas', 'previsao', 'producao', 'alertas']);
    assert.equal(corpo.falhas.vendas, FALHA_DOS_PEDIDOS);
    // A previsão tem mensagem própria, qualquer que seja a fonte que caiu.
    assert.equal(corpo.falhas.previsao, FALHA_DA_PREVISAO);
    assert.ok(corpo.secoes.orcamentos);
    // O erro cru (rota, status, detalhe do banco) não vai para a tela.
    assert.equal(texto.includes('falha simulada'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('pedidos que chegam fora de lista derrubam as seções deles em vez de virar zero', async () => {
  // Zero pedido no painel seria uma afirmação — e falsa.
  const dados = cenario();
  dados.pedidos = { rows: dados.pedidos };
  const ctx = await montar(dados);
  try {
    const { corpo } = await ctx.chamar();
    for (const secao of ['vendas', 'producao', 'alertas']) {
      assert.equal(secao in corpo.secoes, false, secao);
      assert.equal(corpo.falhas[secao], FALHA_DOS_PEDIDOS, secao);
    }
    assert.equal(corpo.falhas.previsao, FALHA_DA_PREVISAO);
    assert.ok(corpo.secoes.orcamentos);
  } finally {
    await ctx.encerrar();
  }
});

test('clientes fora do ar não levam produção, previsão e orçamentos: os nomes caem para travessão', async () => {
  const ctx = await montar(cenario(), { falhar: { clientes: 500 } });
  try {
    const { corpo } = await ctx.chamar();
    assert.deepEqual(corpo.falhas, { clientes: 'Não foi possível ler os clientes agora.' });
    assert.ok(corpo.secoes.producao.maisAntigos.every(p => p.cliente === '—'));
    assert.ok(corpo.secoes.previsao.meses.flatMap(m => m.itens).every(i => i.cliente === '—'));
    assert.equal(corpo.secoes.orcamentos.vencendo7d.itens[0].destinatario, '—');
  } finally {
    await ctx.encerrar();
  }
});

test('leitura que estoura o tempo derruba só a seção dela e não fica guardada', async () => {
  const ctx = await montar(cenario(), { tempoLimiteMs: 100, atrasarMs: { ia_extracoes: 1500 } });
  try {
    const inicio = Date.now();
    const { corpo } = await ctx.chamar();
    assert.ok(Date.now() - inicio < 1000, 'o painel não espera o upstream pendurado');
    assert.deepEqual(corpo.falhas, { ia: 'As leituras da IA demoraram demais para responder.' });
    assert.ok(corpo.secoes.vendas);

    await ctx.chamar();
    assert.equal(ctx.lidas('ia_extracoes'), 2, 'estouro de tempo não fica em cache');
    assert.equal(ctx.lidas('pedidos'), 1, 'o que deu certo continua em cache');
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

test('a segunda chamada usa o cache e não relê o upstream', async () => {
  const ctx = await montar(cenario());
  try {
    const primeira = await ctx.chamar();
    const segunda = await ctx.chamar();
    assert.deepEqual(segunda.corpo.secoes, primeira.corpo.secoes);
    assert.equal(segunda.corpo.geradoEm, primeira.corpo.geradoEm,
      '"Atualizado às" é a hora da leitura, não a da resposta');
    for (const tabela of TODAS_AS_TABELAS) assert.equal(ctx.lidas(tabela), 1);
  } finally {
    await ctx.encerrar();
  }
});

test('chamadas simultâneas dividem uma leitura', async () => {
  const ctx = await montar(cenario());
  try {
    await Promise.all(Array.from({ length: 5 }, () => ctx.chamar()));
    for (const tabela of TODAS_AS_TABELAS) assert.equal(ctx.lidas(tabela), 1);
  } finally {
    await ctx.encerrar();
  }
});

test('?atualizar=1 relê o upstream', async () => {
  const ctx = await montar(cenario());
  try {
    await ctx.chamar();
    ctx.upstream.tabelas.ia_extracoes.push({ id: 4, titulo: 'Nova', status: 'revisao' });

    const semAtualizar = await ctx.chamar();
    assert.equal(semAtualizar.corpo.secoes.ia.emRevisao, 2, 'dentro da validade, o cache vale');

    const atualizado = await ctx.chamar('?atualizar=1');
    assert.equal(atualizado.corpo.secoes.ia.emRevisao, 3);
    for (const tabela of TODAS_AS_TABELAS) assert.equal(ctx.lidas(tabela), 2);
  } finally {
    await ctx.encerrar();
  }
});

test('outro login no mesmo computador não herda as linhas do anterior', async () => {
  const ctx = await montar(cenario());
  try {
    await ctx.chamar('', TOKEN);
    await ctx.chamar('', OUTRO_TOKEN);
    assert.equal(ctx.lidas('pedidos'), 2, 'o cache é por usuário');
    const ultima = ctx.upstream.leituras.filter(l => l.tabela === 'pedidos').at(-1);
    assert.equal(ultima.autorizacao, `Bearer ${OUTRO_TOKEN}`, 'e a releitura sai com o token de quem pediu');
  } finally {
    await ctx.encerrar();
  }
});

test('o token não vaza na resposta, nem cru nem como hash', async () => {
  const ctx = await montar(cenario());
  try {
    const { texto } = await ctx.chamar();
    const hash = crypto.createHash('sha256').update(TOKEN).digest('hex');
    assert.equal(texto.includes(TOKEN), false);
    assert.equal(texto.includes(hash), false);
  } finally {
    await ctx.encerrar();
  }
});

test('geradoEm é o instante da leitura mais antiga entre as usadas', async () => {
  const ctx = await montar(cenario(), { permissoes: permissoesCom('ia.view') });
  try {
    const antes = Date.now();
    await ctx.chamar(); // lê só ia_extracoes
    const depois = Date.now();
    await new Promise(r => setTimeout(r, 40));

    ctx.estado.permissoes = tudoMenos();
    const inicioDaSegunda = Date.now();
    const { corpo } = await ctx.chamar(); // ia_extracoes do cache; o resto, agora
    const geradoEm = Date.parse(corpo.geradoEm);

    assert.equal(ctx.lidas('ia_extracoes'), 1);
    assert.equal(ctx.lidas('pedidos'), 1);
    assert.ok(geradoEm >= antes && geradoEm <= depois, 'é a hora da leitura guardada, a mais antiga');
    assert.ok(geradoEm < inicioDaSegunda);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Previsão de faturamento
// ---------------------------------------------------------------------------

test('a previsão exige ped.view, col_ped_total E col_ped_condicao — sem uma delas, nem as parcelas são lidas', async () => {
  for (const chave of ['ped.view', 'col_ped_total', 'col_ped_condicao']) {
    const ctx = await montar(cenario(), { permissoes: tudoMenos(chave) });
    try {
      const { corpo } = await ctx.chamar();
      assert.equal('previsao' in corpo.secoes, false, `sem ${chave}`);
      assert.equal('previsao' in corpo.falhas, false, `sem ${chave}: é ausência, não falha`);
      assert.equal(ctx.lidas('pedido_parcelas'), 0, `sem ${chave}: as parcelas nem são lidas`);
      // Vendas não depende da condição de pagamento: continua, com ou sem R$.
      if (chave !== 'ped.view') assert.ok(corpo.secoes.vendas, `sem ${chave}: vendas fica`);
    } finally {
      await ctx.encerrar();
    }
  }

  const exato = await montar(cenario(), { permissoes: permissoesCom('ped.view', 'col_ped_total', 'col_ped_condicao') });
  try {
    const { corpo } = await exato.chamar();
    assert.deepEqual(Object.keys(corpo.secoes), ['vendas', 'previsao', 'producao']);
    // Sem col_ped_cliente: o número do pedido sim, o nome do cliente não.
    const itens = corpo.secoes.previsao.meses.flatMap(m => m.itens);
    assert.ok(itens.length > 0);
    assert.ok(itens.every(i => i.cliente === null && typeof i.numero === 'string'));
  } finally {
    await exato.encerrar();
  }
});

test('parcelas fora do ar derrubam só a previsão; as barras de venda ficam', async () => {
  const ctx = await montar(cenario(), { falhar: { pedido_parcelas: 500 } });
  try {
    const { corpo, texto } = await ctx.chamar();
    assert.deepEqual(corpo.falhas, { previsao: FALHA_DA_PREVISAO });
    assert.deepEqual(Object.keys(corpo.secoes), TODAS_AS_SECOES.filter(s => s !== 'previsao'));
    assert.equal(corpo.secoes.vendas.mesAtual.valor, 9434.5);
    assert.equal(texto.includes('falha simulada'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('parcelas que estouram o tempo dão a mensagem da previsão e não ficam guardadas', async () => {
  const ctx = await montar(cenario(), { tempoLimiteMs: 100, atrasarMs: { pedido_parcelas: 1500 } });
  try {
    const { corpo } = await ctx.chamar();
    assert.deepEqual(corpo.falhas, { previsao: FALHA_DA_PREVISAO });
    assert.ok(corpo.secoes.vendas);

    await ctx.chamar();
    assert.equal(ctx.lidas('pedido_parcelas'), 2, 'estouro de tempo não fica em cache');
    assert.equal(ctx.lidas('pedidos'), 1, 'o que deu certo continua em cache');
  } finally {
    await ctx.encerrar();
  }
});

test('as parcelas vêm do mesmo cache das outras tabelas: parcela nova só aparece com ?atualizar=1', async () => {
  const ctx = await montar(cenario());
  try {
    const primeira = (await ctx.chamar()).corpo.secoes.previsao;
    const { hoje } = contextoDeTempo(new Date());
    ctx.upstream.tabelas.pedido_parcelas.push({
      id: 50, pedido_id: 102, numero_parcela: 2, valor: '777.00', data_vencimento: somarDias(hoje, 1)
    });

    const doCache = (await ctx.chamar()).corpo.secoes.previsao;
    assert.deepEqual(doCache, primeira, 'dentro da validade, o cache vale');
    assert.equal(ctx.lidas('pedido_parcelas'), 1);

    const relida = (await ctx.chamar('?atualizar=1')).corpo.secoes.previsao;
    assert.equal(ctx.lidas('pedido_parcelas'), 2);
    assert.equal(Math.round((relida.programadoDesteMes - primeira.programadoDesteMes) * 100), 77700,
      'a parcela de amanhã entra no programado');
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Montagem no servidor
// ---------------------------------------------------------------------------

test('server.js monta /api/dashboard antes da rota genérica /api/:table', () => {
  // Montado depois, o proxy genérico responderia /api/dashboard como se
  // "dashboard" fosse uma tabela — sem conferir permissão nenhuma.
  const fonte = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  // Só linha de CÓDIGO (começando na coluna 0): o comentário que explica a
  // ordem cita a rota genérica, e um indexOf solto acharia o comentário.
  const posicao = padrao => (padrao.exec(fonte) || { index: -1 }).index;
  const montagem = posicao(/^app\.use\('\/api\/dashboard', dashboardRouter\)/m);
  const generica = posicao(/^app\.get\('\/api\/:table'/m);

  assert.ok(fonte.includes("require('./dashboardController')"), 'o router precisa ser carregado');
  assert.ok(montagem > -1, 'a rota do painel precisa estar montada');
  assert.ok(generica > -1);
  assert.ok(montagem < generica);
});
