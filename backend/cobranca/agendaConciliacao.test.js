/**
 * Conciliação automática (backend/cobranca/agendaConciliacao.js) e o registro
 * das execuções (execucoes.js): a trava entre máquinas pela chave UNIQUE da
 * faixa de horário, o que impede de rodar (sem sessão, sem o SQL, desligada),
 * uma tentativa por faixa em cada máquina, o registro do resultado e do erro,
 * a limpeza dos registros velhos e o timer que não segura o app.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const agenda = require('./agendaConciliacao');
const execucoes = require('./execucoes');

const HORA = 60 * 60 * 1000;
const CFG = { id: 1, conciliacao_automatica: true, conciliacao_intervalo_min: 60 };

/** API com a tabela cobranca_execucoes (chave UNIQUE); `semTabela` simula o SQL não rodado. */
function apiFalsa({ semTabela = false, linhas = [] } = {}) {
  const dados = { cobranca_execucoes: JSON.parse(JSON.stringify(linhas)) };
  let proximoId = 50;
  const apagadas = [];
  const ausente = () => Object.assign(new Error("Falha na requisição GET /api/cobranca_execucoes: 404 — Tabela 'cobranca_execucoes' não encontrada."), { status: 404 });
  return {
    dados, apagadas,
    async get() { if (semTabela) throw ausente(); return dados.cobranca_execucoes; },
    async post(caminho, corpo) {
      if (semTabela) throw ausente();
      if (dados.cobranca_execucoes.some(l => l.chave === corpo.chave)) {
        throw Object.assign(new Error('Falha na requisição POST /api/cobranca_execucoes: 500 — Erro no INSERT: duplicate key value violates unique constraint "cobranca_execucoes_chave_key"'), { status: 500 });
      }
      const linha = { id: proximoId++, ...corpo };
      dados.cobranca_execucoes.push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const id = Number(caminho.split('/').pop());
      Object.assign(dados.cobranca_execucoes.find(l => l.id === id), corpo);
      return {};
    },
    async delete(caminho) {
      const id = Number(caminho.split('/').pop());
      apagadas.push(id);
      dados.cobranca_execucoes = dados.cobranca_execucoes.filter(l => l.id !== id);
      return {};
    }
  };
}

test('execuções (puras): faixa de horário, resumo e o que se guarda do resultado', () => {
  assert.equal(execucoes.faixaDe(10 * HORA, 60), 10);
  assert.equal(execucoes.faixaDe(10 * HORA + 59 * 60 * 1000, 60), 10);
  assert.equal(execucoes.faixaDe(10 * HORA, 30), 20);
  assert.equal(execucoes.faixaDe(10 * HORA, 0), 10, 'intervalo vazio vira 60 minutos');
  const r = {
    fila: { lidos: 2, pagos: 1, cancelados: 0, alertas: 1, erros: 0, mensagens: Array.from({ length: 12 }, (_, i) => `m${i}`) },
    consultas: { consultados: 5, mudaram: 2, pagos: 1, erros: 1, mensagens: [] },
    acerto: { lancados: 3, erros: 0, mensagens: [] }, sql_pendente: false
  };
  assert.equal(execucoes.resumoDoResultado(r), '2 aviso(s) do BB · 1 pagamento(s) · 1 alerta(s) · 5 boleto(s) consultado(s) · 2 mudaram · 3 recebimento(s) lançado(s) · 1 erro(s)');
  assert.equal(execucoes.resumoDoResultado({ sql_pendente: true }), 'Recebimentos ainda não ativados (falta o SQL da fase E).');
  assert.equal(execucoes.resumoDoResultado(null), 'Sem resultado.');
  assert.equal(execucoes.resultadoEnxuto(r).fila.mensagens.length, 10, 'mensagens cortadas');
  assert.equal(execucoes.tabelaAusente(Object.assign(new Error("Tabela 'cobranca_execucoes' não encontrada."), { status: 404 })), true);
  assert.equal(execucoes.tabelaAusente(Object.assign(new Error('relation "public.cobranca_execucoes" does not exist'), { code: '42P01' })), true);
  assert.equal(execucoes.tabelaAusente(Object.assign(new Error('Registro não encontrado'), { status: 404 })), false);
});

test('execuções: iniciar (ok, ocupada, sem tabela), concluir, recentes e limpeza dos velhos', async () => {
  const api = apiFalsa();
  const e1 = await execucoes.iniciar(api, { tipo: 'conciliacao_automatica', chave: 'auto:60:10', maquina: 'PC-1', usuarioId: 3 });
  assert.ok(e1.id);
  assert.deepEqual(await execucoes.iniciar(api, { tipo: 'conciliacao_automatica', chave: 'auto:60:10', maquina: 'PC-2' }), { ocupada: true });
  await execucoes.concluir(api, e1, { resultado: { fila: { lidos: 0 }, consultas: { consultados: 1 } } });
  assert.equal(api.dados.cobranca_execucoes[0].resumo, '0 aviso(s) do BB · 1 boleto(s) consultado(s)');
  assert.ok(api.dados.cobranca_execucoes[0].concluido_em);
  const e2 = await execucoes.iniciar(api, { tipo: 'conciliacao_manual', chave: 'manual:1' });
  await execucoes.concluir(api, e2, { erro: 'O BB respondeu 503' });
  assert.equal(api.dados.cobranca_execucoes[1].resumo, 'Falhou: O BB respondeu 503');

  api.dados.cobranca_execucoes.push({ id: 9, tipo: 'conciliacao_automatica', chave: 'auto:60:1', iniciado_em: '2026-07-01T10:00:00Z' });
  api.dados.cobranca_execucoes[0].iniciado_em = '2026-09-16T10:00:00Z';
  api.dados.cobranca_execucoes[1].iniciado_em = '2026-09-16T11:00:00Z';
  const r = await execucoes.recentes(api, 2);
  assert.deepEqual(r.linhas.map(l => [l.tipo_rotulo, l.resumo]), [['pelo botão', 'Falhou: O BB respondeu 503'], ['automática', '0 aviso(s) do BB · 1 boleto(s) consultado(s)']]);
  assert.equal(r.todas.length, 3);
  const apagadas = await execucoes.limparAntigas(api, r.todas, Date.parse('2026-09-16T12:00:00Z'));
  assert.equal(apagadas, 1);
  assert.deepEqual(api.apagadas, [9]);

  const sem = apiFalsa({ semTabela: true });
  assert.deepEqual(await execucoes.iniciar(sem, { tipo: 'x', chave: 'y' }), { sem_tabela: true });
  assert.deepEqual(await execucoes.recentes(sem), { sem_tabela: true, linhas: [], todas: [] });
});

test('agenda: roda uma vez por faixa, a segunda máquina desiste, registra resultado e erro, limpa os velhos', async () => {
  const api = apiFalsa({ linhas: [{ id: 1, tipo: 'conciliacao_automatica', chave: 'auto:60:1', iniciado_em: '2026-01-01T00:00:00Z' }] });
  let relogio = Date.parse('2026-09-16T13:10:00Z');
  const chamadas = [];
  const criarMaquina = (maquina, conciliar) => agenda.criar({
    criarApi: () => api, carregarCfg: async () => ({ ...CFG }), agora: () => relogio, maquina, usuarioDoToken: () => 7,
    conciliar: conciliar || (async p => { chamadas.push({ maquina, usuarioId: p.usuarioId, cfg: p.cfg.id }); return { fila: { lidos: 1, pagos: 1 }, consultas: { consultados: 2 } }; })
  });
  const pc1 = criarMaquina('PC-1');
  const pc2 = criarMaquina('PC-2');

  const r1 = await pc1.verificar();
  assert.equal(r1.situacao, 'rodou');
  assert.deepEqual(chamadas, [{ maquina: 'PC-1', usuarioId: 7, cfg: 1 }]);
  const exec = api.dados.cobranca_execucoes.find(l => l.maquina === 'PC-1');
  assert.deepEqual([exec.tipo, exec.usuario_id, exec.resumo], ['conciliacao_automatica', 7, '1 aviso(s) do BB · 1 pagamento(s) · 2 boleto(s) consultado(s)']);
  assert.match(exec.chave, /^auto:60:\d+$/);
  assert.deepEqual(api.apagadas, [1], 'o registro velho sai');

  assert.equal((await pc2.verificar()).situacao, 'outra_maquina');
  assert.equal((await pc1.verificar()).situacao, 'ja_tentada', 'na mesma faixa, nem tenta de novo');
  assert.equal(chamadas.length, 1);

  relogio += HORA;
  assert.equal((await pc2.verificar()).situacao, 'rodou', 'faixa nova: quem chegar primeiro');
  assert.equal((await pc1.verificar()).situacao, 'outra_maquina');
  assert.equal(chamadas.length, 2);

  relogio += HORA;
  const quebra = criarMaquina('PC-3', async () => { throw new Error('O BB respondeu 503'); });
  const r3 = await quebra.verificar();
  assert.deepEqual([r3.situacao, r3.erro], ['erro', 'O BB respondeu 503']);
  const falha = api.dados.cobranca_execucoes.find(l => l.maquina === 'PC-3');
  assert.deepEqual([falha.resumo, falha.erro], ['Falhou: O BB respondeu 503', 'O BB respondeu 503']);
});

test('agenda: não faz nada sem sessão, sem configuração, sem o SQL da fase F, desligada ou sem a tabela', async () => {
  let chamou = 0;
  const conciliar = async () => { chamou += 1; return {}; };
  const base = { agora: () => 0, conciliar };
  assert.equal((await agenda.criar({ ...base, criarApi: () => { throw new Error('sem sessão'); }, carregarCfg: async () => CFG }).verificar()).situacao, 'sem_sessao');
  assert.equal((await agenda.criar({ ...base, criarApi: () => apiFalsa(), carregarCfg: async () => { throw new Error('401'); } }).verificar()).situacao, 'sem_configuracao');
  assert.equal((await agenda.criar({ ...base, criarApi: () => apiFalsa(), carregarCfg: async () => ({ id: 1 }) }).verificar()).situacao, 'sql_pendente');
  assert.equal((await agenda.criar({ ...base, criarApi: () => apiFalsa(), carregarCfg: async () => ({ ...CFG, conciliacao_automatica: false }) }).verificar()).situacao, 'desligada');
  assert.equal((await agenda.criar({ ...base, criarApi: () => apiFalsa({ semTabela: true }), carregarCfg: async () => CFG }).verificar()).situacao, 'sql_pendente');
  assert.equal(chamou, 0);
  assert.equal(agenda.intervaloDe({ conciliacao_intervalo_min: 5 }), 15);
  assert.equal(agenda.intervaloDe({ conciliacao_intervalo_min: 9999 }), 720);
  assert.equal(agenda.intervaloDe({}), 60);
});

test('agenda: o timer não segura o app, espera a primeira verificação, repete e para', async () => {
  const timers = [];
  let limpo = null;
  let verificacoes = 0;
  const a = agenda.criar({
    criarApi: () => { verificacoes += 1; throw new Error('sem sessão'); }, carregarCfg: async () => CFG, conciliar: async () => ({}),
    definirTimer: (fn, ms) => { const t = { fn, ms, unref() { t.solto = true; } }; timers.push(t); return t; },
    limparTimer: t => { limpo = t; }, sorteio: () => 0
  });
  assert.equal(a.iniciar(), true);
  assert.equal(a.iniciar(), false, 'uma vez só');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, agenda.PRIMEIRA_EM_MS);
  assert.equal(timers[0].solto, true, 'unref');
  await timers[0].fn();
  assert.equal(verificacoes, 1);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].ms, agenda.VERIFICAR_A_CADA_MS);
  a.parar();
  assert.equal(limpo, timers[1]);
  assert.equal(a.ativa, false);
  await timers[1].fn();
  assert.equal(timers.length, 2, 'parada, não agenda mais');
});

test('server.js liga a agenda só dentro do Electron e fora dos testes', () => {
  const fonte = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(fonte, /if \(process\.versions && process\.versions\.electron && process\.env\.NODE_ENV !== 'test'\) \{\s*try \{\s*require\('\.\/cobranca\/agendaConciliacao'\)\.iniciarNoApp\(\);/);
});
