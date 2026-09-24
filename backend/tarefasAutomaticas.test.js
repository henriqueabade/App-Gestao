/**
 * Tarefas automáticas (backend/tarefasAutomaticas.js) — decisões do dono de
 * 24/09/2026: cada regra ligada a uma permissão, cada pessoa desliga para si,
 * a regra da competência fechada vai para o dia marcado e todo aviso diz onde
 * desligar. As rotas e a criação estão em tarefasController.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const A = require('./tarefasAutomaticas');
const { PERMISSIONS_CATALOG } = require('./permissionsCatalog');

test('toda regra aponta para uma permissão que existe no catálogo', () => {
  const chaves = new Set(Object.values(PERMISSIONS_CATALOG).flatMap(m => (m.actions || []).map(a => a.key)));
  for (const regra of A.REGRAS) assert.ok(chaves.has(regra.permissao), `${regra.chave}: ${regra.permissao}`);
  assert.ok(chaves.has(A.PERMISSAO_TAREFAS));
  assert.deepStrictEqual(A.REGRAS.map(r => [r.chave, r.permissao]), [
    ['orcamento_enviado', 'orc.send'],
    ['prospeccao_convertida', 'pros.view'],
    ['pedido_entregue', 'ped.view'],
    ['comissoes_fechadas', 'financeiro.pagamento.confirmar'],
    ['producao_fechada', 'financeiro.pagamento.confirmar']
  ]);
  assert.ok(A.REGRAS.every(r => r.chave.length <= 40), 'tarefa_automacoes.chave é varchar(40)');
});

test('quem pode receber: ver Tarefas E a permissão da regra', () => {
  const pode = (...chaves) => c => chaves.includes(c);
  assert.strictEqual(A.podeReceber('orcamento_enviado', pode('tarefas.view', 'orc.send')), true);
  assert.strictEqual(A.podeReceber('orcamento_enviado', pode('orc.send')), false, 'sem ver Tarefas, nada');
  assert.strictEqual(A.podeReceber('comissoes_fechadas', pode('tarefas.view', 'financeiro.competencia.fechar')), false, 'fechar não basta: é quem confirma o pagamento');
  assert.strictEqual(A.podeReceber('regra_feita_a_mao', pode('tarefas.view')), true, 'regra fora do catálogo: só ver Tarefas');
  assert.strictEqual(A.podeReceber('orcamento_enviado', null), false);
});

test('o dia da tarefa: "depois" conta de hoje; "antes do pagamento" é o dia marcado menos a antecedência', () => {
  const hoje = '2026-09-24';
  assert.strictEqual(A.dataDaTarefa({ prazo: 'depois', dias: 3, hoje }), '2026-09-27');
  assert.strictEqual(A.dataDaTarefa({ prazo: 'antes_do_pagamento', dias: 0, hoje, base: '2026-10-05' }), '2026-10-05');
  assert.strictEqual(A.dataDaTarefa({ prazo: 'antes_do_pagamento', dias: 2, hoje, base: '2026-10-05T00:00:00.000Z' }), '2026-10-03');
  assert.strictEqual(A.dataDaTarefa({ prazo: 'antes_do_pagamento', dias: 30, hoje, base: '2026-10-05' }), hoje, 'a antecedência não empurra para antes de hoje');
  assert.strictEqual(A.dataDaTarefa({ prazo: 'antes_do_pagamento', dias: 0, hoje, base: '2026-09-20' }), '2026-09-20', 'fechou depois do prazo: nasce atrasada, que é a verdade');
  assert.strictEqual(A.dataDaTarefa({ prazo: 'antes_do_pagamento', dias: 1, hoje, base: null }), '2026-09-25', 'sem o dia marcado, conta de hoje');
});

test('o aviso: o que aconteceu, a tarefa e o prazo', () => {
  const regra = A.regraDoCatalogo('pedido_entregue');
  assert.strictEqual(A.mensagemDoAviso({ gatilho: regra.gatilho({ pedido: 'PED-40' }), titulo: 'Pós-venda do pedido PED-40 — Loja Boa', prazo: '01/10/2026' }),
    'Pedido PED-40 entregue: “Pós-venda do pedido PED-40 — Loja Boa”, para 01/10/2026.');
  assert.strictEqual(A.regraDoCatalogo('producao_fechada').gatilho({ competencia: 'setembro/2026' }), 'Produção de setembro/2026 fechada');
  assert.strictEqual(A.mensagemDoAviso({ gatilho: '', titulo: 'X', prazo: '' }), '“X”, para sem data.');
  assert.strictEqual(A.DICA_DO_AVISO, 'Pode ser desativada em Tarefas ou em Configurações.');
});

test('preferências e a lista da tela: sem linha vale ligada; só as regras permitidas', () => {
  const prefs = A.mapaDePreferencias([
    { id: 1, usuario_id: 2, chave: 'orcamento_enviado', ativa: false },
    { id: 2, usuario_id: 3, chave: 'orcamento_enviado', ativa: false },
    { id: 3, usuario_id: 2, chave: 'pedido_entregue', ativa: 't' }
  ], 2);
  assert.deepStrictEqual([...prefs], [['orcamento_enviado', false], ['pedido_entregue', true]]);

  const linhas = [
    { id: 3, chave: 'comissoes_fechadas', ativa: true, dias: 0 },
    { id: 1, chave: 'orcamento_enviado', ativa: true, dias: 3 },
    { id: 2, chave: 'pedido_entregue', ativa: false, dias: 7 }
  ];
  const tela = A.paraTela(linhas, { pode: c => ['tarefas.view', 'orc.send', 'ped.view'].includes(c), preferencias: prefs });
  assert.deepStrictEqual(tela.map(r => [r.chave, r.ativa, r.minha, r.modulo, r.pode_configurar]), [
    ['orcamento_enviado', true, false, 'Orçamentos', false],
    ['pedido_entregue', false, true, 'Pedidos', false]
  ]);
});
