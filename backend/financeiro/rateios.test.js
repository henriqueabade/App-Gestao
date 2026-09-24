/**
 * Rateio das comissões entre colaboradores, peça a peça.
 *
 * As regras que o dono pediu e que não podem afrouxar:
 *   - a soma de cada peça vai até 100% e NUNCA passa;
 *   - peça já em 100% não recebe mais ninguém;
 *   - quem já está na peça não entra duas vezes;
 *   - fechar a competência exige 100% em toda peça contabilizada — mas só
 *     quando há colaborador cadastrado (senão o Financeiro travaria sozinho
 *     na primeira virada de mês depois de subir o código).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const rateios = require('./rateios');

const linha = (id, colaboradorId, percentual) => ({ id, colaborador_id: colaboradorId, percentual, ativo: true });

test('percentual digitado: vírgula, ponto, com % e o que não é número', () => {
  assert.equal(rateios.lerPercentual('12,5'), 12.5);
  assert.equal(rateios.lerPercentual('12.5'), 12.5);
  assert.equal(rateios.lerPercentual('50%'), 50);
  assert.equal(rateios.lerPercentual(33.3333), 33.3333);
  assert.equal(rateios.lerPercentual(''), null);
  assert.equal(rateios.lerPercentual('abc'), null);
  assert.equal(rateios.formatarPercentual(100), '100%');
  assert.equal(rateios.formatarPercentual(12.5), '12,5%');
});

test('soma, restante e "está completo" de uma peça', () => {
  const linhas = [linha(1, 10, 20), linha(2, 11, 30)];
  assert.equal(rateios.somaDosPercentuais(linhas), 50);
  assert.equal(rateios.restanteDoRateio(linhas), 50);
  assert.equal(rateios.rateioCompleto(linhas), false);
  assert.equal(rateios.rateioCompleto([...linhas, linha(3, 12, 50)]), true);
  // Linha desligada não conta.
  assert.equal(rateios.somaDosPercentuais([...linhas, { id: 9, colaborador_id: 13, percentual: 50, ativo: false }]), 50);
  assert.equal(rateios.restanteDoRateio([]), 100);
  assert.equal(rateios.restanteDoRateio([linha(1, 10, 100)]), 0);
});

test('a trava do cadastro: não passa do restante, não repete gente e não entra em peça fechada', () => {
  const vinte = [linha(1, 10, 20)];
  assert.equal(rateios.problemaDaLinha({ linhas: vinte, colaboradorId: 11, percentual: 80 }), null, '80% no que restava entra');
  assert.match(rateios.problemaDaLinha({ linhas: vinte, colaboradorId: 11, percentual: 80.01 }), /Só restam 80%/);
  assert.match(rateios.problemaDaLinha({ linhas: vinte, colaboradorId: 11, percentual: 90 }), /Só restam 80%/);
  assert.match(rateios.problemaDaLinha({ linhas: vinte, colaboradorId: 10, percentual: 10 }), /já está nesta peça/);
  assert.match(rateios.problemaDaLinha({ linhas: [linha(1, 10, 100)], colaboradorId: 11, percentual: 1 }), /já está 100% distribuída/);

  assert.match(rateios.problemaDaLinha({ linhas: [], colaboradorId: 10, percentual: 0 }), /maior que zero/);
  assert.match(rateios.problemaDaLinha({ linhas: [], colaboradorId: 10, percentual: -5 }), /maior que zero/);
  assert.match(rateios.problemaDaLinha({ linhas: [], colaboradorId: 10, percentual: 101 }), /não pode passar de 100/);
  assert.match(rateios.problemaDaLinha({ linhas: [], colaboradorId: 10, percentual: '' }), /Informe o percentual/);
  assert.match(rateios.problemaDaLinha({ linhas: [], colaboradorId: null, percentual: 10 }), /Escolha o colaborador/);

  // Editando a própria linha, o percentual dela não conta duas vezes.
  const cheia = [linha(1, 10, 60), linha(2, 11, 40)];
  assert.equal(rateios.problemaDaLinha({ linhas: cheia, colaboradorId: 12, percentual: 60, ignorarId: 1 }), null);
  assert.match(rateios.problemaDaLinha({ linhas: cheia, colaboradorId: 12, percentual: 61, ignorarId: 1 }), /Só restam 60%/);
});

test('distribuir o valor da peça não perde nem inventa centavo', () => {
  const tres = rateios.distribuirValor(100, [linha(1, 1, 33.3333), linha(2, 2, 33.3333), linha(3, 3, 33.3334)]);
  assert.equal(tres.reduce((s, p) => s + p.valor, 0), 100);
  const meio = rateios.distribuirValor(1000, [linha(1, 1, 50), linha(2, 2, 50)]);
  assert.deepEqual(meio.map(p => p.valor), [500, 500]);
  assert.deepEqual(rateios.distribuirValor(100, []), []);
  // Estorno (valor negativo) reparte do mesmo jeito.
  assert.equal(rateios.distribuirValor(-300, [linha(1, 1, 100)])[0].valor, -300);
});

test('a peça puxa a fatia da comissão do pedido, na proporção do que foi vendido', () => {
  const itens = [
    { id: 501, pedido_id: 7, produto_id: 9, quantidade: 2, valor_total: 3000 },
    { id: 502, pedido_id: 7, produto_id: 10, quantidade: 1, valor_total: 1000 }
  ];
  const pecas = rateios.pecasContabilizadas({
    itens: [{ pedido_id: 7, pedido: 'PED007', cliente: 'La Raritá', total: 1000 }, { pedido_id: 7, total: 200 }],
    pedidosItens: itens,
    produtos: [{ id: 9, codigo: 'VASO1', nome: 'Vaso Essencial' }, { id: 10, codigo: 'CX2', nome: 'Caixa' }]
  });
  const porId = new Map(pecas.map(p => [p.id, p]));
  assert.equal(porId.get(501).participacao, 0.75);
  assert.equal(porId.get(501).comissao, 900, '75% dos R$ 1.200 do pedido');
  assert.equal(porId.get(502).comissao, 300);
  assert.equal(pecas.reduce((s, p) => s + p.comissao, 0), 1200, 'a soma das peças bate com a comissão do pedido');
  assert.equal(porId.get(501).produto, 'VASO1 · Vaso Essencial');
  assert.equal(porId.get(501).pedido_numero, 'PED007');

  // Peça devolvida sai da conta; tudo devolvido divide pelo valor vendido.
  const comDevolucao = rateios.participacaoDasPecas([
    { id: 1, quantidade: 2, quantidade_devolvida: 1, valor_total: 2000 },
    { id: 2, quantidade: 1, quantidade_devolvida: 0, valor_total: 1000 }
  ]);
  assert.equal(comDevolucao.get('1').valor, 1000);
  assert.equal(comDevolucao.get('2').valor, 1000);
  const tudoDevolvido = rateios.participacaoDasPecas([{ id: 1, quantidade: 1, quantidade_devolvida: 1, valor_total: 500 }]);
  assert.equal(tudoDevolvido.get('1').participacao, 1, 'sem base, a divisão fica pelo vendido');

  // Pedido sem item cadastrado não vira peça (não há o que distribuir).
  assert.deepEqual(rateios.pecasContabilizadas({ itens: [{ pedido_id: 99, total: 100 }], pedidosItens: [], produtos: [] }), []);
});

test('estado das peças: o que já foi distribuído, o que falta e quanto cada um leva', () => {
  const pecas = [
    { id: 501, pedido_id: 7, pedido_numero: 'PED007', produto: 'Vaso', comissao: 900 },
    { id: 502, pedido_id: 7, pedido_numero: 'PED007', produto: 'Caixa', comissao: 300 }
  ];
  const estado = rateios.estadoDasPecas({
    pecas,
    rateios: [
      { id: 1, pedido_item_id: 501, colaborador_id: 3, percentual: 60, ativo: true },
      { id: 2, pedido_item_id: 501, colaborador_id: 4, percentual: 40, ativo: true },
      { id: 3, pedido_item_id: 502, colaborador_id: 3, percentual: 50, ativo: true },
      { id: 4, pedido_item_id: 502, colaborador_id: 4, percentual: 50, ativo: false }
    ],
    colaboradores: [{ id: 3, nome: 'Ana' }, { id: 4, nome: 'Bruno' }]
  });
  const porId = new Map(estado.map(p => [p.id, p]));
  assert.equal(porId.get(501).distribuido, 100);
  assert.equal(porId.get(501).completo, true);
  assert.equal(porId.get(501).restante, 0);
  assert.deepEqual(porId.get(501).linhas.map(l => [l.colaborador, l.percentual, l.valor]), [['Ana', 60, 540], ['Bruno', 40, 360]]);
  assert.equal(porId.get(502).distribuido, 50, 'a linha desligada não conta');
  assert.equal(porId.get(502).completo, false);
  assert.equal(porId.get(502).restante, 50);

  assert.deepEqual(rateios.pecasPendentes(estado).map(p => p.id), [502]);
  assert.deepEqual(
    rateios.resumoPorColaborador(estado).map(r => [r.colaborador, r.valor, r.pecas]),
    [['Ana', 690, 2], ['Bruno', 360, 1]],
    'do maior para o menor'
  );
});

test('o bloqueio do fechamento só existe com colaborador cadastrado', () => {
  const estado = rateios.estadoDasPecas({
    pecas: [{ id: 501, pedido_id: 7, pedido_numero: 'PED007', produto: 'Vaso', comissao: 900 }],
    rateios: [], colaboradores: [{ id: 3, nome: 'Ana' }]
  });
  assert.equal(rateios.bloqueioDoFechamento({ estado, temColaboradores: false }), null, 'sem ninguém cadastrado, o Financeiro fecha como sempre');
  const bloqueio = rateios.bloqueioDoFechamento({ estado, temColaboradores: true });
  assert.match(bloqueio, /1 peça contabilizada ainda não foi distribuída/);
  assert.match(bloqueio, /PED007 · Vaso \(0% de 100%\)/);
  assert.match(bloqueio, /Regras › Colaboradores/);

  const completo = rateios.estadoDasPecas({
    pecas: [{ id: 501, comissao: 900 }],
    rateios: [{ id: 1, pedido_item_id: 501, colaborador_id: 3, percentual: 100, ativo: true }],
    colaboradores: [{ id: 3, nome: 'Ana' }]
  });
  assert.equal(rateios.bloqueioDoFechamento({ estado: completo, temColaboradores: true }), null, 'tudo distribuído: nada bloqueia');
});

// --------------------------------------------------------------- com a API

function apiFalsa(tabelas = {}) {
  let proximo = 100;
  const casa = (l, query = {}) => Object.entries(query).every(([col, v]) => String(l[col]) === String(v));
  return {
    tabelas,
    async get(caminho, { query } = {}) {
      const nome = caminho.replace('/api/', '');
      if (!(nome in tabelas)) { const e = new Error(`relation "${nome}" does not exist`); e.status = 404; throw e; }
      return tabelas[nome].filter(l => casa(l, query));
    },
    async post(caminho, corpo) {
      const nome = caminho.replace('/api/', '');
      if (!(nome in tabelas)) { const e = new Error(`relation "${nome}" does not exist`); e.status = 404; throw e; }
      const linha = { id: proximo += 1, ...corpo };
      tabelas[nome].push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const [, , nome, id] = caminho.split('/');
      const alvo = tabelas[nome].find(l => String(l.id) === String(id));
      Object.assign(alvo, corpo);
      return alvo;
    }
  };
}

const base = (extra = {}) => apiFalsa({
  comissao_colaboradores: [], comissao_rateios: [], financeiro_eventos: [],
  pedidos_itens: [{ id: 501, pedido_id: 7, produto_id: 9, quantidade: 1, valor_total: 1000 }],
  produtos: [{ id: 9, codigo: 'VASO1', nome: 'Vaso' }],
  ...extra
});

test('sem o SQL da fase, nada quebra: a leitura avisa e o fechamento não exige nada', async () => {
  const api = apiFalsa({ pedidos_itens: [], produtos: [] });
  assert.equal(await rateios.listarColaboradores(api), null);
  assert.equal(await rateios.listarRateios(api), null);
  const visao = await rateios.lerVisao({ api, itens: [] });
  assert.equal(visao.sql_pendente, true);
  assert.equal(visao.bloqueio, null);
  assert.match(visao.arquivo, /comissao_colaboradores_rateio\.sql/);
  await assert.rejects(() => rateios.salvarColaborador({ api, dados: { nome: 'Ana' } }), /comissao_colaboradores_rateio\.sql/);
});

test('colaborador: cadastra, recusa nome repetido e desligar tira o rateio dele', async () => {
  const api = base();
  const { colaborador } = await rateios.salvarColaborador({ api, dados: { nome: '  Ana Silva ', funcao: 'Montagem' }, usuarioId: 5 });
  assert.equal(colaborador.nome, 'Ana Silva');
  assert.equal(api.tabelas.comissao_colaboradores[0].criado_por, 5);
  await assert.rejects(() => rateios.salvarColaborador({ api, dados: { nome: 'ana silva' } }), /Já existe um colaborador/);
  await assert.rejects(() => rateios.salvarColaborador({ api, dados: { nome: 'A' } }), /Informe o nome/);

  const outro = (await rateios.salvarColaborador({ api, dados: { nome: 'Bruno' } })).colaborador;
  await rateios.salvarLinha({ api, dados: { pedido_id: 7, pedido_item_id: 501, produto_id: 9, colaborador_id: colaborador.id, percentual: 60 } });
  await rateios.salvarLinha({ api, dados: { pedido_id: 7, pedido_item_id: 501, produto_id: 9, colaborador_id: outro.id, percentual: 40 } });
  assert.equal((await rateios.listarRateios(api)).length, 2);

  const r = await rateios.removerColaborador({ api, id: colaborador.id, usuarioId: 5 });
  assert.equal(r.pecas_afetadas, 1, 'a parte dele sai das peças');
  assert.equal((await rateios.listarRateios(api)).length, 1);
  assert.deepEqual((await rateios.listarColaboradores(api)).map(x => x.nome), ['Bruno']);
  // O rastro fica: a linha foi desligada, não apagada.
  assert.equal(api.tabelas.comissao_rateios.length, 2);
  await assert.rejects(() => rateios.removerColaborador({ api, id: 9999 }), /não encontrado/);
});

test('rateio pela API: respeita o restante, recusa colaborador desligado e remover desliga', async () => {
  const api = base();
  const ana = (await rateios.salvarColaborador({ api, dados: { nome: 'Ana' } })).colaborador;
  const bruno = (await rateios.salvarColaborador({ api, dados: { nome: 'Bruno' } })).colaborador;
  const peca = { pedido_id: 7, pedido_item_id: 501, produto_id: 9 };

  await rateios.salvarLinha({ api, dados: { ...peca, colaborador_id: ana.id, percentual: '70' } });
  await assert.rejects(
    () => rateios.salvarLinha({ api, dados: { ...peca, colaborador_id: bruno.id, percentual: 40 } }),
    e => { assert.equal(e.status, 422); assert.match(e.message, /Só restam 30%/); assert.equal(e.extra.restante, 30); return true; }
  );
  await assert.rejects(() => rateios.salvarLinha({ api, dados: { ...peca, colaborador_id: 9999, percentual: 10 } }), /colaborador ativo/);
  await assert.rejects(() => rateios.salvarLinha({ api, dados: { ...peca, pedido_item_id: 0, colaborador_id: ana.id, percentual: 10 } }), /Peça inválida/);

  const linhaBruno = (await rateios.salvarLinha({ api, dados: { ...peca, colaborador_id: bruno.id, percentual: 30 } })).linha;
  const visao = await rateios.lerVisao({ api, itens: [{ pedido_id: 7, pedido: 'PED007', total: 1000 }] });
  assert.equal(visao.pecas[0].completo, true);
  assert.equal(visao.pendentes, 0);
  assert.equal(visao.bloqueio, null);
  assert.deepEqual(visao.resumo.map(r => [r.colaborador, r.valor]), [['Ana', 700], ['Bruno', 300]]);
  assert.equal(visao.total, 1000);

  await rateios.removerLinha({ api, id: linhaBruno.id, usuarioId: 5 });
  const depois = await rateios.lerVisao({ api, itens: [{ pedido_id: 7, pedido: 'PED007', total: 1000 }] });
  assert.equal(depois.pecas[0].distribuido, 70);
  assert.equal(depois.pendentes, 1);
  assert.match(depois.bloqueio, /ainda não foi distribuída/);
  await assert.rejects(() => rateios.removerLinha({ api, id: 9999 }), /não encontrada/);
});
