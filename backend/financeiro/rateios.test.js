/**
 * Rateio da PRODUÇÃO entre colaboradores, processo a processo.
 *
 * As regras que o dono pediu e que não podem afrouxar:
 *   - a unidade é o PROCESSO de cada peça (peça + setor), não a peça inteira;
 *   - a soma de cada processo vai até 100% e NUNCA passa;
 *   - processo já em 100% não recebe mais ninguém;
 *   - quem já está no processo não entra duas vezes;
 *   - o atalho copia a divisão para os outros processos da MESMA peça, sem
 *     pisar no que já foi distribuído;
 *   - fechar a competência de PRODUÇÃO exige 100% em todo processo — mas só
 *     quando há colaborador cadastrado;
 *   - peças e processos são números diferentes (2 peças × 4 processos = 8).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const rateios = require('./rateios');
const producao = require('./producao');

const linha = (id, colaboradorId, percentual) => ({ id, colaborador_id: colaboradorId, percentual, ativo: true });

/** Uma linha de produção como `montarCompetencia` devolve. */
const producaoLinha = (pedidoItemId, setorId, setor, total, extra = {}) => ({
  tipo_item: 'producao', pedido_id: 7, pedido: 'PED107',
  pedido_item_id: pedidoItemId, produto_id: 9, produto: `peça ${pedidoItemId}`,
  setor_id: setorId, setor, quantidade: 1, total, data: '2026-09-23', ...extra
});

test('percentual digitado: vírgula, ponto, com % e o que não é número', () => {
  assert.equal(rateios.lerPercentual('12,5'), 12.5);
  assert.equal(rateios.lerPercentual('50%'), 50);
  assert.equal(rateios.lerPercentual(33.3333), 33.3333);
  assert.equal(rateios.lerPercentual(''), null);
  assert.equal(rateios.lerPercentual('abc'), null);
  assert.equal(rateios.formatarPercentual(100), '100%');
  assert.equal(rateios.formatarPercentual(12.5), '12,5%');
});

test('soma, restante e "está completo" de um processo', () => {
  const linhas = [linha(1, 10, 20), linha(2, 11, 30)];
  assert.equal(rateios.somaDosPercentuais(linhas), 50);
  assert.equal(rateios.restanteDoRateio(linhas), 50);
  assert.equal(rateios.rateioCompleto(linhas), false);
  assert.equal(rateios.rateioCompleto([...linhas, linha(3, 12, 50)]), true);
  assert.equal(rateios.somaDosPercentuais([...linhas, { id: 9, colaborador_id: 13, percentual: 50, ativo: false }]), 50, 'linha desligada não conta');
  assert.equal(rateios.restanteDoRateio([]), 100);
});

test('a trava do cadastro: não passa do restante, não repete gente e não entra em processo fechado', () => {
  const vinte = [linha(1, 10, 20)];
  assert.equal(rateios.problemaDaLinha({ linhas: vinte, colaboradorId: 11, percentual: 80 }), null);
  assert.match(rateios.problemaDaLinha({ linhas: vinte, colaboradorId: 11, percentual: 80.01 }), /Só restam 80%/);
  assert.match(rateios.problemaDaLinha({ linhas: vinte, colaboradorId: 10, percentual: 10 }), /já está neste processo/);
  assert.match(rateios.problemaDaLinha({ linhas: [linha(1, 10, 100)], colaboradorId: 11, percentual: 1 }), /já está 100% distribuído/);
  assert.match(rateios.problemaDaLinha({ linhas: [], colaboradorId: 10, percentual: 0 }), /maior que zero/);
  assert.match(rateios.problemaDaLinha({ linhas: [], colaboradorId: 10, percentual: 101 }), /não pode passar de 100/);
  assert.match(rateios.problemaDaLinha({ linhas: [], colaboradorId: null, percentual: 10 }), /Escolha o colaborador/);
  // Editando a própria linha, o percentual dela não conta duas vezes.
  const cheio = [linha(1, 10, 60), linha(2, 11, 40)];
  assert.equal(rateios.problemaDaLinha({ linhas: cheio, colaboradorId: 12, percentual: 60, ignorarId: 1 }), null);
  assert.match(rateios.problemaDaLinha({ linhas: cheio, colaboradorId: 12, percentual: 61, ignorarId: 1 }), /Só restam 60%/);
});

test('distribuir o valor do processo não perde nem inventa centavo', () => {
  const tres = rateios.distribuirValor(100, [linha(1, 1, 33.3333), linha(2, 2, 33.3333), linha(3, 3, 33.3334)]);
  assert.equal(tres.reduce((s, p) => s + p.valor, 0), 100);
  assert.deepEqual(rateios.distribuirValor(1000, [linha(1, 1, 50), linha(2, 2, 50)]).map(p => p.valor), [500, 500]);
  assert.equal(rateios.distribuirValor(-300, [linha(1, 1, 100)])[0].valor, -300);
  assert.deepEqual(rateios.distribuirValor(100, []), []);
});

test('peças e processos são números diferentes (2 peças × 4 processos = 8 linhas)', () => {
  const linhas = [];
  for (const item of [501, 502]) {
    for (const [id, nome] of [[1, 'Marcenaria'], [2, 'Acabamento'], [3, 'Montagem'], [4, 'Embalagem']]) {
      linhas.push(producaoLinha(item, id, nome, 10));
    }
  }
  assert.deepEqual(producao.contarPecasEProcessos(linhas), { pecas: 2, processos: 8, unidades: 8 });

  const pecas = rateios.pecasDaCompetencia(linhas);
  assert.equal(pecas.length, 2, 'duas peças');
  assert.equal(pecas[0].processos.length, 4, 'quatro processos em cada');
  assert.equal(pecas[0].valor, 40);

  // Saldo e estorno sem peça não se rateiam.
  const comSaldo = [...linhas, { tipo_item: 'saldo', setor_id: 1, total: 99 }, producaoLinha(null, 1, 'Marcenaria', 5)];
  assert.equal(rateios.pecasDaCompetencia(comSaldo).length, 2);

  // Dois registros do mesmo processo (dias diferentes) viram um só.
  const doisDias = [producaoLinha(501, 1, 'Marcenaria', 10, { data: '2026-09-10' }), producaoLinha(501, 1, 'Marcenaria', 5, { data: '2026-09-20' })];
  const juntas = rateios.pecasDaCompetencia(doisDias);
  assert.equal(juntas[0].processos.length, 1);
  assert.equal(juntas[0].processos[0].valor, 15);
  assert.equal(juntas[0].processos[0].quantidade, 2);
  assert.equal(juntas[0].processos[0].data, '2026-09-20', 'a data mais recente é a que a tela mostra');
});

test('estado dos processos: o que falta em cada um e quanto cada colaborador leva', () => {
  const linhas = [
    producaoLinha(501, 1, 'Marcenaria', 100),
    producaoLinha(501, 2, 'Acabamento', 50),
    producaoLinha(502, 1, 'Marcenaria', 200)
  ];
  const estado = rateios.estadoDasPecas({
    pecas: rateios.pecasDaCompetencia(linhas),
    rateios: [
      { id: 1, pedido_item_id: 501, setor_id: 1, colaborador_id: 3, percentual: 60, ativo: true },
      { id: 2, pedido_item_id: 501, setor_id: 1, colaborador_id: 4, percentual: 40, ativo: true },
      { id: 3, pedido_item_id: 501, setor_id: 2, colaborador_id: 3, percentual: 50, ativo: true },
      { id: 4, pedido_item_id: 502, setor_id: 1, colaborador_id: 4, percentual: 100, ativo: false }
    ],
    colaboradores: [{ id: 3, nome: 'Ana' }, { id: 4, nome: 'Bruno' }]
  });

  const peca501 = estado.find(p => p.pedido_item_id === 501);
  const marcenaria = peca501.processos.find(p => p.setor_id === 1);
  assert.equal(marcenaria.completo, true);
  assert.deepEqual(marcenaria.linhas.map(l => [l.colaborador, l.percentual, l.valor]), [['Ana', 60, 60], ['Bruno', 40, 40]]);
  const acabamento = peca501.processos.find(p => p.setor_id === 2);
  assert.equal(acabamento.distribuido, 50);
  assert.equal(acabamento.restante, 50);
  assert.equal(peca501.completo, false, 'a peça só fecha com todos os processos dela fechados');
  assert.equal(peca501.processos_completos, 1);

  assert.equal(rateios.processosPendentes(estado).length, 2, 'acabamento da 501 e marcenaria da 502 (a linha estava desligada)');
  assert.deepEqual(rateios.contagem(estado), { pecas: 2, processos: 3, unidades: 3 });
  assert.deepEqual(
    rateios.resumoPorColaborador(estado).map(r => [r.colaborador, r.valor, r.processos]),
    [['Ana', 85, 2], ['Bruno', 40, 1]]
  );
});

test('o bloqueio do fechamento da produção só existe com colaborador cadastrado', () => {
  const estado = rateios.estadoDasPecas({
    pecas: rateios.pecasDaCompetencia([producaoLinha(501, 1, 'Marcenaria', 100)]),
    rateios: [], colaboradores: [{ id: 3, nome: 'Ana' }]
  });
  assert.equal(rateios.bloqueioDoFechamento({ estado, temColaboradores: false }), null, 'sem ninguém cadastrado, a produção fecha como sempre');
  const bloqueio = rateios.bloqueioDoFechamento({ estado, temColaboradores: true });
  assert.match(bloqueio, /1 processo ainda não foi distribuído/);
  assert.match(bloqueio, /PED107 · peça 501 · Marcenaria \(0% de 100%\)/);
  assert.match(bloqueio, /Rateio da produção/);

  const completo = rateios.estadoDasPecas({
    pecas: rateios.pecasDaCompetencia([producaoLinha(501, 1, 'Marcenaria', 100)]),
    rateios: [{ id: 1, pedido_item_id: 501, setor_id: 1, colaborador_id: 3, percentual: 100, ativo: true }],
    colaboradores: [{ id: 3, nome: 'Ana' }]
  });
  assert.equal(rateios.bloqueioDoFechamento({ estado: completo, temColaboradores: true }), null);
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
      const l = { id: proximo += 1, ...corpo };
      tabelas[nome].push(l);
      return l;
    },
    async put(caminho, corpo) {
      const [, , nome, id] = caminho.split('/');
      const alvo = tabelas[nome].find(l => String(l.id) === String(id));
      Object.assign(alvo, corpo);
      return alvo;
    }
  };
}

const base = () => apiFalsa({ producao_colaboradores: [], producao_rateios: [], financeiro_eventos: [] });

test('sem o SQL da fase, nada quebra: a leitura avisa e o fechamento não exige nada', async () => {
  const api = apiFalsa({});
  assert.equal(await rateios.listarColaboradores(api), null);
  const visao = await rateios.lerVisao({ api, linhas: [] });
  assert.equal(visao.sql_pendente, true);
  assert.equal(visao.bloqueio, null);
  assert.match(visao.arquivo, /producao_colaboradores_rateio\.sql/);
  await assert.rejects(() => rateios.salvarColaborador({ api, dados: { nome: 'Ana' } }), /producao_colaboradores_rateio\.sql/);
});

test('colaborador: cadastra, recusa nome repetido e desligar tira o rateio dele', async () => {
  const api = base();
  const { colaborador } = await rateios.salvarColaborador({ api, dados: { nome: '  Ana Silva ', funcao: 'Montagem' }, usuarioId: 5 });
  assert.equal(colaborador.nome, 'Ana Silva');
  await assert.rejects(() => rateios.salvarColaborador({ api, dados: { nome: 'ana silva' } }), /Já existe um colaborador/);
  await assert.rejects(() => rateios.salvarColaborador({ api, dados: { nome: 'A' } }), /Informe o nome/);

  const outro = (await rateios.salvarColaborador({ api, dados: { nome: 'Bruno' } })).colaborador;
  const processo = { pedido_id: 7, pedido_item_id: 501, setor_id: 1, produto_id: 9 };
  await rateios.salvarLinha({ api, dados: { ...processo, colaborador_id: colaborador.id, percentual: 60 } });
  await rateios.salvarLinha({ api, dados: { ...processo, colaborador_id: outro.id, percentual: 40 } });

  const r = await rateios.removerColaborador({ api, id: colaborador.id, usuarioId: 5 });
  assert.equal(r.processos_afetados, 1);
  assert.equal((await rateios.listarRateios(api)).length, 1);
  assert.deepEqual((await rateios.listarColaboradores(api)).map(x => x.nome), ['Bruno']);
  assert.equal(api.tabelas.producao_rateios.length, 2, 'o rastro fica: a linha foi desligada, não apagada');
});

test('rateio pela API: respeita o restante do PROCESSO e remover desliga', async () => {
  const api = base();
  const ana = (await rateios.salvarColaborador({ api, dados: { nome: 'Ana' } })).colaborador;
  const bruno = (await rateios.salvarColaborador({ api, dados: { nome: 'Bruno' } })).colaborador;
  const marcenaria = { pedido_id: 7, pedido_item_id: 501, setor_id: 1, produto_id: 9 };
  const acabamento = { ...marcenaria, setor_id: 2 };

  await rateios.salvarLinha({ api, dados: { ...marcenaria, colaborador_id: ana.id, percentual: '70' } });
  await assert.rejects(
    () => rateios.salvarLinha({ api, dados: { ...marcenaria, colaborador_id: bruno.id, percentual: 40 } }),
    e => { assert.equal(e.status, 422); assert.match(e.message, /Só restam 30%/); assert.equal(e.extra.restante, 30); return true; }
  );
  // O outro processo da MESMA peça é independente: lá cabem 100%.
  await rateios.salvarLinha({ api, dados: { ...acabamento, colaborador_id: bruno.id, percentual: 100 } });
  await assert.rejects(() => rateios.salvarLinha({ api, dados: { ...marcenaria, colaborador_id: 9999, percentual: 10 } }), /colaborador ativo/);
  await assert.rejects(() => rateios.salvarLinha({ api, dados: { ...marcenaria, setor_id: 0, colaborador_id: ana.id, percentual: 10 } }), /Processo inválido/);

  const linhaBruno = (await rateios.salvarLinha({ api, dados: { ...marcenaria, colaborador_id: bruno.id, percentual: 30 } })).linha;
  const linhas = [producaoLinha(501, 1, 'Marcenaria', 100), producaoLinha(501, 2, 'Acabamento', 50)];
  const visao = await rateios.lerVisao({ api, linhas });
  assert.equal(visao.pendentes, 0);
  assert.equal(visao.bloqueio, null);
  assert.deepEqual(visao.resumo.map(r => [r.colaborador, r.valor]), [['Bruno', 80], ['Ana', 70]], 'do maior para o menor');
  assert.deepEqual(visao.contagem, { pecas: 1, processos: 2, unidades: 2 });

  await rateios.removerLinha({ api, id: linhaBruno.id, usuarioId: 5 });
  const depois = await rateios.lerVisao({ api, linhas });
  assert.equal(depois.pendentes, 1);
  assert.match(depois.bloqueio, /ainda não foi distribuído/);
  await assert.rejects(() => rateios.removerLinha({ api, id: 9999 }), /não encontrada/);
});

test('o atalho copia a divisão para os outros processos da peça, sem pisar no que já tem', async () => {
  const api = base();
  const ana = (await rateios.salvarColaborador({ api, dados: { nome: 'Ana' } })).colaborador;
  const bruno = (await rateios.salvarColaborador({ api, dados: { nome: 'Bruno' } })).colaborador;
  const peca = { pedido_id: 7, pedido_item_id: 501, produto_id: 9 };
  await rateios.salvarLinha({ api, dados: { ...peca, setor_id: 1, colaborador_id: ana.id, percentual: 60 } });
  await rateios.salvarLinha({ api, dados: { ...peca, setor_id: 1, colaborador_id: bruno.id, percentual: 40 } });
  // O processo 4 já tem gente: o atalho não mexe nele.
  await rateios.salvarLinha({ api, dados: { ...peca, setor_id: 4, colaborador_id: ana.id, percentual: 100 } });

  const r = await rateios.aplicarNaPeca({
    api, dados: { ...peca, setores: [2, 3, 4], linhas: [{ colaborador_id: ana.id, percentual: 60 }, { colaborador_id: bruno.id, percentual: 40 }] }, usuarioId: 5
  });
  assert.equal(r.aplicados, 2);
  assert.equal(r.pulados, 1, 'o processo que já tinha divisão fica como estava');

  const linhas = [1, 2, 3, 4].map(s => producaoLinha(501, s, `Processo ${s}`, 100));
  const visao = await rateios.lerVisao({ api, linhas });
  assert.equal(visao.pendentes, 0, 'os quatro processos fecham 100%');
  assert.deepEqual(visao.resumo.map(r2 => [r2.colaborador, r2.valor]), [['Ana', 280], ['Bruno', 120]]);

  await assert.rejects(() => rateios.aplicarNaPeca({ api, dados: { ...peca, setores: [5], linhas: [] } }), /distribua um processo primeiro/);
  await assert.rejects(
    () => rateios.aplicarNaPeca({ api, dados: { ...peca, setores: [5], linhas: [{ colaborador_id: ana.id, percentual: 50 }] } }),
    /fecha 100%/
  );
});
