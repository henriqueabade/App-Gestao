/**
 * Regras das Tarefas e do Calendário (backend/tarefasRegras.js).
 */
const test = require('node:test');
const assert = require('node:assert');
const R = require('./tarefasRegras');

// 18/09/2026 (sexta), 14:00 em Brasília = 17:00 UTC.
const AGORA = new Date('2026-09-18T17:00:00Z');

test('datas e horas: qualquer formato vira AAAA-MM-DD e HH:MM', () => {
  assert.strictEqual(R.diaISO('2026-10-01T03:00:00.000Z'), '2026-10-01');
  assert.strictEqual(R.diaISO('01/10/2026'), '2026-10-01');
  assert.strictEqual(R.diaISO('31/02/2026'), undefined);
  assert.strictEqual(R.diaISO(''), null);
  assert.strictEqual(R.horaHHMM('14:30:00'), '14:30');
  assert.strictEqual(R.horaHHMM('9h'), '09:00');
  assert.strictEqual(R.horaHHMM('9h5'), '09:05');
  assert.strictEqual(R.horaHHMM('25:00'), undefined);
  assert.strictEqual(R.horaHHMM(null), null);
});

test('agora é lido em Brasília, qualquer que seja o fuso da máquina', () => {
  assert.deepStrictEqual(R.agoraEmBrasilia(new Date('2026-09-18T02:30:00Z')), { dia: '2026-09-17', minutos: 23 * 60 + 30 });
  assert.deepStrictEqual(R.agoraEmBrasilia(AGORA), { dia: '2026-09-18', minutos: 14 * 60 });
});

test('Admin e Sup Admin são gestores por natureza', () => {
  assert.ok(R.ehGestor({ perfil: 'Sup Admin' }));
  assert.ok(R.ehGestor({ perfil: 'Admin' }));
  assert.ok(R.ehGestor({ perfil: 'Administrador' }));
  assert.ok(!R.ehGestor({ perfil: 'Vendedor' }));
  assert.ok(!R.ehGestor(null));
});

test('recorrência: diária, dias úteis, semanal com dias escolhidos e intervalo', () => {
  assert.deepStrictEqual(R.proximaOcorrencia('2026-09-18', { freq: 'diaria' }), { data: '2026-09-19', ocorrencia: 2 });
  // Sexta → segunda, pulando o fim de semana.
  assert.strictEqual(R.proximaOcorrencia('2026-09-18', { freq: 'diaria', somente_uteis: true }).data, '2026-09-21');
  // Segunda e quarta: de segunda vai para quarta; de quarta, para a segunda seguinte.
  const segQua = { freq: 'semanal', dias_semana: [1, 3] };
  assert.strictEqual(R.proximaOcorrencia('2026-09-21', segQua).data, '2026-09-23');
  assert.strictEqual(R.proximaOcorrencia('2026-09-23', segQua).data, '2026-09-28');
  // A cada 2 semanas, só na segunda.
  assert.strictEqual(R.proximaOcorrencia('2026-09-21', { freq: 'semanal', intervalo: 2, dias_semana: [1] }).data, '2026-10-05');
});

test('recorrência: mensal pelo dia (31 vira o último dia), pela posição e anual', () => {
  assert.strictEqual(R.proximaOcorrencia('2026-10-31', { freq: 'mensal' }).data, '2026-11-30');
  // 2ª terça de setembro/2026 (08/09) → 2ª terça de outubro (13/10).
  assert.strictEqual(R.proximaOcorrencia('2026-09-08', { freq: 'mensal', modo: 'posicao' }).data, '2026-10-13');
  // Última sexta de setembro (25/09) → última sexta de outubro (30/10).
  assert.strictEqual(R.proximaOcorrencia('2026-09-25', { freq: 'mensal', modo: 'posicao' }).data, '2026-10-30');
  assert.strictEqual(R.proximaOcorrencia('2028-02-29', { freq: 'anual' }).data, '2029-02-28');
});

test('recorrência: fim por data e por número de vezes; ocorrências perdidas são puladas', () => {
  assert.strictEqual(R.proximaOcorrencia('2026-09-18', { freq: 'diaria', fim: { tipo: 'data', data: '2026-09-18' } }), null);
  assert.strictEqual(R.proximaOcorrencia('2026-09-18', { freq: 'diaria', ocorrencia: 3, fim: { tipo: 'vezes', vezes: 3 } }), null);
  assert.deepStrictEqual(R.proximaOcorrencia('2026-09-18', { freq: 'diaria', ocorrencia: 2, fim: { tipo: 'vezes', vezes: 3 } }), { data: '2026-09-19', ocorrencia: 3 });
  // Concluída com atraso: a próxima segunda é a partir de hoje, não a perdida.
  assert.strictEqual(R.proximaOcorrencia('2026-09-07', { freq: 'semanal' }, '2026-09-18').data, '2026-09-21');
  assert.throws(() => R.normalizarRecorrencia({ freq: 'quinzenal' }), e => e.status === 400);
  assert.throws(() => R.normalizarRecorrencia({ freq: 'diaria', fim: { tipo: 'vezes', vezes: 1 } }), e => e.status === 400);
});

test('descreverRecorrencia fala a língua da tela', () => {
  assert.strictEqual(R.descreverRecorrencia({ freq: 'semanal', dias_semana: [1, 3] }), 'Toda semana (seg, qua)');
  assert.strictEqual(R.descreverRecorrencia({ freq: 'diaria', somente_uteis: true }), 'Todo dia útil');
  assert.strictEqual(R.descreverRecorrencia({ freq: 'mensal', intervalo: 2, fim: { tipo: 'vezes', vezes: 6 } }), 'A cada 2 meses, 6 vezes');
  assert.strictEqual(R.descreverRecorrencia(null), '');
});

test('normalizarTarefa: obrigatórios, coerência e limpeza', () => {
  assert.throws(() => R.normalizarTarefa({ titulo: '  ' }), e => e.status === 400);
  assert.throws(() => R.normalizarTarefa({ titulo: 'x', tipo: 'Festa' }), e => e.status === 400);
  assert.throws(() => R.normalizarTarefa({ titulo: 'x', hora: '14:00' }), /dia antes da hora/);
  assert.throws(() => R.normalizarTarefa({ titulo: 'x', data: '2026-02-30' }), e => e.status === 400);
  assert.throws(() => R.normalizarTarefa({ titulo: 'x', recorrencia: { freq: 'diaria' } }), /data de início/);
  const t = R.normalizarTarefa({ titulo: ' Ligar ', data: '25/09/2026', hora: '9h', marcadores: [3, '3', 5, 'x'], cliente_id: '7', lembrete_min: 15 });
  assert.deepStrictEqual(
    { titulo: t.titulo, data: t.data, hora: t.hora, marcadores: t.marcadores, cliente_id: t.cliente_id, tipo: t.tipo, prioridade: t.prioridade, lembrete_min: t.lembrete_min },
    { titulo: 'Ligar', data: '2026-09-25', hora: '09:00', marcadores: [3, 5], cliente_id: 7, tipo: 'Tarefa', prioridade: 'media', lembrete_min: 15 }
  );
  // Edição parcial: só o que veio; a hora aceita porque a tarefa já tem dia.
  assert.deepStrictEqual(R.normalizarTarefa({ hora: '10:00', __data_atual: '2026-09-25' }, { parcial: true }), { hora: '10:00' });
});

test('atrasada e grupo do prazo', () => {
  const base = { status: 'a_fazer' };
  assert.ok(R.atrasada({ ...base, data: '2026-09-17' }, AGORA));
  assert.ok(!R.atrasada({ ...base, data: '2026-09-18' }, AGORA), 'hoje sem hora: vale até o fim do dia');
  assert.ok(R.atrasada({ ...base, data: '2026-09-18', hora: '13:59' }, AGORA));
  assert.ok(!R.atrasada({ ...base, data: '2026-09-18', hora: '14:30' }, AGORA));
  assert.ok(!R.atrasada({ status: 'concluida', data: '2026-09-01' }, AGORA));
  assert.strictEqual(R.grupoDoPrazo({ ...base, data: '2026-09-19' }, AGORA), 'amanha');
  assert.strictEqual(R.grupoDoPrazo({ ...base, data: '2026-09-24' }, AGORA), 'semana');
  assert.strictEqual(R.grupoDoPrazo({ ...base, data: '2026-10-24' }, AGORA), 'depois');
  assert.strictEqual(R.grupoDoPrazo({ ...base }, AGORA), 'sem_data');
  assert.strictEqual(R.grupoDoPrazo({ status: 'concluida' }, AGORA), 'concluida');
});

test('ordem da lista: dia, hora (dia inteiro primeiro), prioridade; sem data por último', () => {
  const lista = [
    { id: 1, data: null, prioridade: 'urgente' },
    { id: 2, data: '2026-09-20', hora: '10:00', prioridade: 'media' },
    { id: 3, data: '2026-09-20', hora: null, prioridade: 'baixa' },
    { id: 4, data: '2026-09-19', prioridade: 'baixa' },
    { id: 5, data: '2026-09-20', hora: '10:00', prioridade: 'urgente' }
  ].sort(R.compararTarefas);
  assert.deepStrictEqual(lista.map(t => t.id), [4, 3, 5, 2, 1]);
});

test('quem vê, quem mexe e quem exclui', () => {
  const t = { id: 10, criado_por: 1, responsavel_id: 2 };
  const participantes = [{ tarefa_id: 10, usuario_id: 3, status: 'aceito' }, { tarefa_id: 10, usuario_id: 4, status: 'pendente' }, { tarefa_id: 10, usuario_id: 5, status: 'recusado' }];
  const nada = R.escopoDeVisao({ usuario: { id: 9, perfil: 'Vendedor' } });
  const ve = (id, escopo = nada) => R.podeVerTarefa(t, { usuarioId: id, escopo, participantes });
  assert.ok(ve(1) && ve(2) && ve(3) && ve(4), 'quem fez, quem responde, quem participa e quem foi convidado');
  assert.ok(!ve(5), 'recusou: deixa de ver');
  assert.ok(!ve(9));
  const gestor = R.escopoDeVisao({ usuario: { id: 7, perfil: 'Admin' } });
  assert.ok(ve(7, gestor));
  const doJoao = R.escopoDeVisao({ usuario: { id: 9 }, permissaoVerOutros: true, linhas: [{ usuario_id: 9, alvo_id: 2 }] });
  assert.ok(ve(9, doJoao), 'vê a agenda da pessoa 2');
  const deTodos = R.escopoDeVisao({ usuario: { id: 9 }, permissaoVerOutros: true, linhas: [{ usuario_id: 9, alvo_id: null }] });
  assert.ok(deTodos.todos);
  const semPermissao = R.escopoDeVisao({ usuario: { id: 9 }, permissaoVerOutros: false, linhas: [{ usuario_id: 9, alvo_id: null }] });
  assert.ok(!semPermissao.todos, 'sem a ação no perfil, a lista não vale');

  const mexe = id => R.podeMexerNaTarefa(t, { usuarioId: id, escopo: nada, participantes });
  assert.ok(mexe(1) && mexe(2) && mexe(3));
  assert.ok(!mexe(4), 'convite pendente: ainda não mexe');
  assert.ok(!R.podeExcluirTarefa(t, { usuarioId: 1, escopo: nada }), 'criou mas passou para outro: quem decide é o gestor');
  assert.ok(R.podeExcluirTarefa({ ...t, responsavel_id: 1 }, { usuarioId: 1, escopo: nada }));
  assert.ok(R.podeExcluirTarefa(t, { usuarioId: 7, escopo: gestor }));
});

test('criar para outra pessoa só com "Atribuir tarefa"', () => {
  assert.strictEqual(R.conferirResponsavel(null, { usuarioId: 5, podeAtribuir: false }), 5);
  assert.strictEqual(R.conferirResponsavel(5, { usuarioId: 5, podeAtribuir: false }), 5);
  assert.throws(() => R.conferirResponsavel(6, { usuarioId: 5, podeAtribuir: false }), e => e.status === 403);
  assert.strictEqual(R.conferirResponsavel(6, { usuarioId: 5, podeAtribuir: true }), 6);
});

test('diferencasDaTarefa: legível e só o que mudou', () => {
  const nomes = { usuarios: new Map([[2, 'Ana'], [3, 'João']]), marcadores: new Map([[1, 'vip']]) };
  const eventos = R.diferencasDaTarefa(
    { titulo: 'A', data: '2026-09-18T03:00:00.000Z', hora: '14:00:00', responsavel_id: 2, marcadores: [], prioridade: 'media' },
    { titulo: 'A', data: '2026-09-20', hora: '14:00', responsavel_id: 3, marcadores: [1], prioridade: 'alta' },
    nomes
  );
  assert.deepStrictEqual(eventos.map(e => [e.campo, e.valor_anterior, e.valor_novo, e.acao]), [
    ['prioridade', 'Média', 'Alta', 'alterou'],
    ['data', '18/09/2026', '20/09/2026', 'alterou'],
    ['responsavel_id', 'Ana', 'João', 'atribuiu'],
    ['marcadores', null, 'vip', 'alterou']
  ]);
});

test('avisos: lembrete uma vez na hora escolhida; atraso uma vez por dia', () => {
  const t = { id: 1, titulo: 'Ligar ACME', status: 'a_fazer', data: '2026-09-18', hora: '14:10', lembrete_min: 15 };
  const avisos = R.avisosDevidos([t], { usuarioId: 2, agora: AGORA });
  assert.deepStrictEqual(avisos.map(a => [a.tipo, a.chave]), [['tarefa_lembrete', 'lembrete:1:2026-09-18 14:10']]);
  assert.strictEqual(R.avisosDevidos([t], { usuarioId: 2, agora: AGORA, jaEnviadas: new Set(['lembrete:1:2026-09-18 14:10']) }).length, 0);
  // Ainda cedo para o lembrete (15 min antes de 15:00 = 14:45).
  assert.strictEqual(R.avisosDevidos([{ ...t, hora: '15:00' }], { usuarioId: 2, agora: AGORA }).length, 0);
  // Sem hora: lembrete a partir das 9h.
  assert.strictEqual(R.avisosDevidos([{ ...t, hora: null, lembrete_min: 0 }], { usuarioId: 2, agora: AGORA })[0].tipo, 'tarefa_lembrete');
  const atrasada = { id: 2, titulo: 'Proposta', status: 'a_fazer', data: '2026-09-15' };
  const a = R.avisosDevidos([atrasada], { usuarioId: 2, agora: AGORA });
  assert.deepStrictEqual(a.map(x => [x.tipo, x.chave, x.mensagem]), [['tarefa_atrasada', 'atraso:2:2026-09-18', 'Proposta — venceu há 3 dias']]);
  assert.strictEqual(R.avisosDevidos([{ ...atrasada, status: 'concluida' }], { usuarioId: 2, agora: AGORA }).length, 0);
});

test('Meu dia: hoje, atrasadas, feitas hoje, convites e a próxima', () => {
  const tarefas = [
    { id: 1, responsavel_id: 2, status: 'a_fazer', data: '2026-09-18', hora: '16:00', titulo: 'Reunião' },
    { id: 2, responsavel_id: 2, status: 'a_fazer', data: '2026-09-18', hora: '09:00', titulo: 'Café' },
    { id: 3, responsavel_id: 2, status: 'a_fazer', data: '2026-09-10', titulo: 'Velha' },
    { id: 4, responsavel_id: 2, status: 'concluida', data: '2026-09-18', concluida_em: '2026-09-18T12:00:00Z', titulo: 'Feita' },
    { id: 5, responsavel_id: 3, status: 'a_fazer', data: '2026-09-18', titulo: 'De outro' }
  ];
  assert.deepStrictEqual(R.resumoDoDia(tarefas, { usuarioId: 2, convites: 1, agora: AGORA }), {
    hoje: 2, atrasadas: 2, concluidas_hoje: 1, convites: 1, proxima: { id: 1, titulo: 'Reunião', hora: '16:00' }
  });
});

test('estatísticas do período', () => {
  const tarefas = [
    { id: 1, responsavel_id: 2, tipo: 'Ligação', status: 'concluida', data: '2026-09-15', criado_em: '2026-09-14T12:00:00Z', concluida_em: '2026-09-15T12:00:00Z' },
    { id: 2, responsavel_id: 2, tipo: 'Ligação', status: 'concluida', data: '2026-09-10', criado_em: '2026-09-09T12:00:00Z', concluida_em: '2026-09-16T12:00:00Z' },
    { id: 3, responsavel_id: 3, tipo: 'Visita', status: 'a_fazer', data: '2026-09-01', criado_em: '2026-08-30T12:00:00Z' },
    { id: 4, responsavel_id: 3, tipo: 'Visita', status: 'concluida', data: null, criado_em: '2026-08-01T12:00:00Z', concluida_em: '2026-08-02T12:00:00Z' }
  ];
  const e = R.montarEstatisticas(tarefas, { de: '2026-09-01', ate: '2026-09-18', agora: AGORA, nomes: new Map([[2, 'Ana'], [3, 'João']]) });
  assert.strictEqual(e.concluidas, 2);
  assert.strictEqual(e.no_prazo, 1);
  assert.strictEqual(e.taxa_no_prazo, 50);
  assert.strictEqual(e.atrasadas, 1);
  assert.strictEqual(e.horas_medias, 96);
  assert.deepStrictEqual(e.por_tipo, [{ tipo: 'Ligação', concluidas: 2 }]);
  assert.deepStrictEqual(e.por_pessoa.map(p => [p.nome, p.concluidas, p.abertas, p.atrasadas]), [['Ana', 2, 0, 0], ['João', 0, 1, 1]]);
  assert.strictEqual(e.por_semana.find(s => s.semana === '2026-09-14').concluidas, 2);
});

test('título da automação preenche os nomes e some com o traço do que faltar', () => {
  assert.strictEqual(R.tituloDaAutomacao('Follow-up do orçamento {orcamento} — {cliente}', { orcamento: 'ORC-12', cliente: 'ACME' }), 'Follow-up do orçamento ORC-12 — ACME');
  assert.strictEqual(R.tituloDaAutomacao('Follow-up do orçamento {orcamento} — {cliente}', { orcamento: 'ORC-12' }), 'Follow-up do orçamento ORC-12');
});

test('tipo da atividade gerada ao concluir', () => {
  assert.strictEqual(R.tipoDaAtividade('Ligação'), 'Ligação');
  assert.strictEqual(R.tipoDaAtividade('Follow-up'), 'Atividade realizada');
  assert.strictEqual(R.tipoDaAtividade('Tarefa'), 'Atividade realizada');
});
