/**
 * Fim natural das tarefas automáticas (pedido do dono, 08/10/2026):
 *
 *   "um orçamento gera tarefa de follow-up; se esse orçamento for convertido em
 *    pedido (aprovado) ou for negado, a tarefa de follow-up deve ser concluída
 *    na data do fechamento desse orçamento".
 *
 * A regra geral (backend/tarefasAutomaticas.js › ENCERRAMENTOS) e quem a
 * aplica (backend/tarefasServico.js › encerrarTarefasDoRegistro e
 * conferirEncerramentos), com uma API de mentira em memória.
 */
const test = require('node:test');
const assert = require('node:assert');
const A = require('./tarefasAutomaticas');
const S = require('./tarefasServico');

/** API em memória: GET filtra por igualdade, PUT mescla, POST acrescenta. */
function apiFalsa(dados = {}) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const chamadas = [];
  let proximo = 1000;
  const partes = caminho => caminho.replace(/^\/api\//, '').split('/');
  const erro404 = () => Object.assign(new Error('Registro não encontrado'), { status: 404 });
  return {
    tabelas,
    chamadas,
    async get(caminho, { query = {} } = {}) {
      chamadas.push(['GET', caminho, query]);
      const [tabela, id] = partes(caminho);
      const linhas = tabelas[tabela] || [];
      if (id) {
        const achado = linhas.find(r => String(r.id) === String(id));
        if (!achado) throw erro404();
        return achado;
      }
      return linhas.filter(r => Object.entries(query).every(([k, v]) => k === 'select' || String(r[k]) === String(v)));
    },
    async put(caminho, corpo) {
      chamadas.push(['PUT', caminho, corpo]);
      const [tabela, id] = partes(caminho);
      const linha = (tabelas[tabela] || []).find(r => String(r.id) === String(id));
      if (linha) Object.assign(linha, corpo);
      return linha || {};
    },
    async post(caminho, corpo) {
      chamadas.push(['POST', caminho, corpo]);
      const [tabela] = partes(caminho);
      const linha = { id: proximo++, ...corpo };
      (tabelas[tabela] = tabelas[tabela] || []).push(linha);
      return linha;
    },
    async delete(caminho) {
      chamadas.push(['DELETE', caminho]);
      return {};
    }
  };
}

const followUp = (extra = {}) => ({
  id: 1, titulo: 'Cobrar resposta do orçamento ORC-30', status: 'a_fazer', data: '2026-10-15', hora: null,
  responsavel_id: 7, criado_por: 7, origem: 'automacao', chave_origem: 'orcamento_enviado:30', orcamento_id: 30,
  cliente_id: null, prospeccao_id: null, ...extra
});

test('a regra: orçamento aprovado, rejeitado ou expirado conclui; excluído cancela', () => {
  const t = followUp();
  const aprovado = A.encerramentoDaTarefa(t, { id: 30, numero: 'ORC-30', situacao: 'Aprovado', data_aprovacao: '2026-10-08T14:00:00.000Z' });
  assert.deepStrictEqual(aprovado, { acao: 'concluir', quando: '2026-10-08T14:00:00.000Z', motivo: 'O orçamento ORC-30 foi aprovado (virou pedido)' });
  assert.strictEqual(A.encerramentoDaTarefa(t, { numero: 'ORC-30', situacao: 'Rejeitado' }).motivo, 'O orçamento ORC-30 foi rejeitado');
  assert.strictEqual(A.encerramentoDaTarefa(t, { numero: 'ORC-30', situacao: 'Expirado' }).acao, 'concluir');
  // Ainda em aberto: nada a fazer.
  assert.strictEqual(A.encerramentoDaTarefa(t, { situacao: 'Pendente' }), null);
  assert.strictEqual(A.encerramentoDaTarefa(t, { situacao: 'Rascunho' }), null);
  // Não existe mais: cancela. Não conferido (undefined): nada.
  assert.deepStrictEqual(A.encerramentoDaTarefa(t, null), { acao: 'cancelar', quando: null, motivo: 'O orçamento foi excluído' });
  assert.strictEqual(A.encerramentoDaTarefa(t, undefined), null);
});

test('as outras automáticas: pós-venda e boas-vindas só fecham com o registro excluído; as de pagar ficam com a ação', () => {
  const posVenda = { chave_origem: 'pedido_entregue:5', pedido_id: 5 };
  assert.strictEqual(A.encerramentoDaTarefa(posVenda, { id: 5, situacao: 'Entregue' }), null);
  assert.strictEqual(A.encerramentoDaTarefa(posVenda, null).acao, 'cancelar');
  const boasVindas = { chave_origem: 'prospeccao_convertida:9', cliente_id: 3 };
  assert.strictEqual(A.encerramentoDaTarefa(boasVindas, { id: 3 }), null);
  assert.strictEqual(A.encerramentoDaTarefa(boasVindas, null).motivo, 'O cliente foi excluído');
  for (const chave of ['comissoes_fechadas:2026-09', 'producao_fechada:2026-09', 'nota_de_fechamento:4-ana']) {
    assert.strictEqual(A.encerramentoDaTarefa({ chave_origem: chave }, null), null, chave);
  }
  assert.strictEqual(A.regraDaTarefa({ chave_origem: 'orcamento_enviado:30' }), 'orcamento_enviado');
  assert.strictEqual(A.regraDaTarefa({}), null);
});

test('orçamento aprovado: o follow-up conclui NO DIA DO FECHAMENTO, mesmo marcado para depois', async () => {
  const api = apiFalsa({
    tarefas: [followUp(), followUp({ id: 2, chave_origem: null, origem: 'manual', titulo: 'Tarefa à mão do mesmo orçamento' })],
    usuarios: [{ id: 7, nome: 'Henrique' }, { id: 8, nome: 'Iara' }]
  });
  const feitas = await S.encerrarTarefasDoRegistro(api, {
    tipo: 'orcamento', id: 30, usuarioId: 8,
    registro: { id: 30, numero: 'ORC-30', situacao: 'Aprovado', data_aprovacao: '2026-10-08T14:00:00.000Z' }
  });
  assert.deepStrictEqual(feitas, [{ id: 1, como: 'concluida' }]);
  const [automatica, manual] = api.tabelas.tarefas;
  assert.strictEqual(automatica.status, 'concluida');
  assert.strictEqual(automatica.data, '2026-10-08', 'a data da tarefa passa a ser a do fechamento');
  assert.strictEqual(automatica.concluida_em, '2026-10-08T14:00:00.000Z');
  assert.strictEqual(automatica.resultado, 'feito');
  assert.match(automatica.resultado_nota, /Concluída sozinha: O orçamento ORC-30 foi aprovado/);
  // A tarefa criada à mão não é mexida.
  assert.strictEqual(manual.status, 'a_fazer');
  // A troca do dia e a conclusão ficam na linha do tempo da tarefa; quem responde é avisado.
  const linhaDoTempo = api.chamadas.filter(c => c[0] === 'POST' && /historico/.test(c[1])).map(c => c[2]);
  assert.ok(linhaDoTempo.some(e => e.campo === 'data' && /concluída/.test(e.observacao || '')), 'evento da troca do dia');
  assert.ok(linhaDoTempo.some(e => e.acao === 'concluiu'), 'evento da conclusão');
  const aviso = api.chamadas.find(c => c[0] === 'POST' && /notificacoes/.test(c[1]));
  assert.ok(aviso && aviso[2].usuario_id === 7 && /concluída no dia do fechamento/.test(aviso[2].mensagem), 'aviso a quem responde');
});

test('orçamento excluído: o follow-up é CANCELADO (não foi feito)', async () => {
  const api = apiFalsa({ tarefas: [followUp()], usuarios: [] });
  const feitas = await S.encerrarTarefasDoRegistro(api, { tipo: 'orcamento', id: 30, registro: null });
  assert.deepStrictEqual(feitas, [{ id: 1, como: 'cancelada' }]);
  assert.strictEqual(api.tabelas.tarefas[0].status, 'cancelada');
  assert.strictEqual(api.tabelas.tarefas[0].data, '2026-10-15', 'cancelada não muda de dia');
});

test('sem registro informado, lê o orçamento; um que continua em aberto não mexe em nada', async () => {
  const api = apiFalsa({
    tarefas: [followUp()],
    orcamentos: [{ id: 30, numero: 'ORC-30', situacao: 'Pendente' }]
  });
  assert.deepStrictEqual(await S.encerrarTarefasDoRegistro(api, { tipo: 'orcamento', id: 30 }), []);
  assert.strictEqual(api.tabelas.tarefas[0].status, 'a_fazer');
});

test('a conferência fecha as que ficaram para trás, sem avisar; "excluído" só com o 404 do registro', async () => {
  const api = apiFalsa({
    tarefas: [
      followUp({ id: 1, chave_origem: 'orcamento_enviado:30', orcamento_id: 30 }),
      followUp({ id: 2, chave_origem: 'orcamento_enviado:31', orcamento_id: 31 }),
      followUp({ id: 3, chave_origem: 'orcamento_enviado:32', orcamento_id: 32 }),
      followUp({ id: 4, chave_origem: 'orcamento_enviado:33', orcamento_id: 33, status: 'concluida' })
    ],
    orcamentos: [
      { id: 30, numero: 'ORC-30', situacao: 'Rejeitado', data_aprovacao: '2026-10-02T12:00:00.000Z' },
      { id: 31, numero: 'ORC-31', situacao: 'Pendente' }
      // 32 não existe mais
    ],
    usuarios: []
  });
  const feitas = await S.conferirEncerramentos(api, api.tabelas.tarefas, { forcar: true });
  assert.deepStrictEqual(feitas, [{ id: 1, como: 'concluida' }, { id: 3, como: 'cancelada' }]);
  const porId = id => api.tabelas.tarefas.find(t => t.id === id);
  assert.strictEqual(porId(1).data, '2026-10-02');
  assert.strictEqual(porId(2).status, 'a_fazer');
  assert.strictEqual(porId(3).status, 'cancelada');
  assert.ok(!api.chamadas.some(c => c[0] === 'POST' && /notificacoes/.test(c[1])), 'a conferência não avisa');
});

test('a conferência não cancela nada quando a lista não pôde ser lida', async () => {
  const api = apiFalsa({ tarefas: [followUp()] });
  api.get = async (caminho) => {
    if (/orcamentos/.test(caminho)) throw Object.assign(new Error('Sem permissão'), { status: 403 });
    return [];
  };
  assert.deepStrictEqual(await S.conferirEncerramentos(api, [followUp()], { forcar: true }), []);
});

test('tarefa automática concluída por quem quer que seja vai para o dia da conclusão; a feita à mão, não', async () => {
  const api = apiFalsa({ tarefas: [followUp({ id: 5, origem: 'automacao' }), followUp({ id: 6, origem: 'manual', chave_origem: null })] });
  await S.concluirTarefa(api, api.tabelas.tarefas[0], { usuarioId: 7, quando: '2026-10-09T15:00:00.000Z' });
  await S.concluirTarefa(api, api.tabelas.tarefas[1], { usuarioId: 7, quando: '2026-10-09T15:00:00.000Z' });
  assert.strictEqual(api.tabelas.tarefas[0].data, '2026-10-09');
  assert.strictEqual(api.tabelas.tarefas[1].data, '2026-10-15');
});
