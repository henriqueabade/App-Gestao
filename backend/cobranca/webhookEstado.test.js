/**
 * O estado do webhook para a Configuração de cobrança
 * (backend/cobranca/webhookEstado.js): a URL a cadastrar sem o token, a
 * situação de cada aviso, as contagens, a agenda e as execuções.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const w = require('./webhookEstado');

test('situação do aviso, horário de Brasília e a origem da API', () => {
  assert.equal(w.situacaoDoAviso({ processado_em: null }), 'na fila');
  assert.equal(w.situacaoDoAviso({ processado_em: null, erro_processamento: 'x' }), 'na fila (erro)');
  assert.equal(w.situacaoDoAviso({ processado_em: 'T', boleto_id: null, erro_processamento: 'não é deste sistema' }), 'ignorado');
  assert.equal(w.situacaoDoAviso({ processado_em: 'T', boleto_id: 4, erro_processamento: 'pagamento em dobro?' }), 'alerta');
  assert.equal(w.situacaoDoAviso({ processado_em: 'T', boleto_id: 4, erro_processamento: null }), 'conciliado');
  assert.equal(w.momentoBR('2026-09-16T13:05:00Z'), '16/09/2026 10:05');
  assert.equal(w.momentoBR(''), '');
  assert.equal(w.momentoBR('lixo'), '');
  assert.equal(w.origemDaApi({}), 'https://api.santissimodecor.com.br');
  assert.equal(w.origemDaApi({ API_BASE_URL: 'https://outra.api/api/' }), 'https://outra.api');
});

test('montar: URL sem token, contagens, avisos recentes, agenda e execuções', () => {
  const eventos = [
    { id: 1, origem: 'webhook', processado_em: 'T', boleto_id: 41, criado_em: '2026-09-15T12:00:00Z', nosso_numero: '1', mensagem: 'Baixa operacional: estado 1' },
    { id: 2, origem: 'webhook', processado_em: 'T', boleto_id: null, erro_processamento: 'não é deste sistema', criado_em: '2026-09-15T13:00:00Z', nosso_numero: '2' },
    { id: 3, origem: 'webhook', processado_em: null, erro_processamento: 'Falta rodar sql', criado_em: '2026-09-16T12:00:00Z', nosso_numero: '3' },
    { id: 4, origem: 'webhook', processado_em: null, criado_em: '2026-09-16T12:30:00Z', nosso_numero: '4' },
    { id: 5, origem: 'app', tipo: 'registrado' }
  ];
  const execs = {
    sem_tabela: false,
    linhas: [
      { id: 9, tipo: 'conciliacao_manual', tipo_rotulo: 'pelo botão', maquina: 'PC-2', iniciado_em: '2026-09-16T12:40:00Z', concluido_em: 'T', resumo: '0 aviso(s)' },
      { id: 8, tipo: 'conciliacao_automatica', tipo_rotulo: 'automática', maquina: 'PC-1', iniciado_em: '2026-09-16T12:05:00Z', concluido_em: null, resumo: null }
    ]
  };
  const r = w.montar({ cfg: { conciliacao_automatica: true, conciliacao_intervalo_min: 60 }, eventos, execucoes: execs, env: {}, agoraMs: Date.parse('2026-09-16T12:45:00Z') });
  assert.equal(r.url_modelo, 'https://api.santissimodecor.com.br/webhooks/bb/baixa-operacional/<token>');
  assert.ok(!JSON.stringify(r).includes('BB_WEBHOOK_TOKEN='), 'nada de token');
  assert.deepEqual(r.avisos, { total: 4, na_fila: 2, com_erro: 1, conciliados: 1, ignorados: 1, alertas: 0, ultimo_em: '16/09/2026 09:30' });
  assert.deepEqual(r.recentes.map(a => [a.id, a.situacao]), [[4, 'na fila'], [3, 'na fila (erro)'], [2, 'ignorado'], [1, 'conciliado']]);
  assert.equal(r.recentes[1].detalhe, 'Falta rodar sql');
  assert.deepEqual(r.agenda, {
    sql_pronto: true, ligada: true, intervalo_min: 60,
    ultima_automatica: { quando: '16/09/2026 09:05', maquina: 'PC-1', resumo: 'não terminou', erro: null },
    proxima_por_volta: '16/09/2026 10:00'
  });
  assert.deepEqual(r.execucoes.map(x => [x.como, x.maquina, x.terminou]), [['pelo botão', 'PC-2', true], ['automática', 'PC-1', false]]);

  const semSql = w.montar({ cfg: { id: 1 }, eventos: [], execucoes: { sem_tabela: true, linhas: [] }, env: {} });
  assert.deepEqual([semSql.agenda.sql_pronto, semSql.agenda.ligada, semSql.agenda.proxima_por_volta, semSql.avisos.ultimo_em], [false, null, null, null]);
  const desligada = w.montar({ cfg: { conciliacao_automatica: false, conciliacao_intervalo_min: 30 }, execucoes: { linhas: [] }, env: {} });
  assert.deepEqual([desligada.agenda.ligada, desligada.agenda.proxima_por_volta, desligada.agenda.intervalo_min], [false, null, 30]);
});
