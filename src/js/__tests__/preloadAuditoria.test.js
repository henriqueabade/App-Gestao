const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fonte = fs.readFileSync(path.join(__dirname, '../../../preload.js'), 'utf8');
const plano = valor => JSON.parse(JSON.stringify(valor));

function montar(responder = async () => ({ success: true })) {
  const chamadas = [];
  let api;
  const ipcRenderer = {
    invoke: (...args) => {
      chamadas.push(args);
      return args[0] === 'record-user-action' ? Promise.resolve() : Promise.resolve().then(() => responder(...args));
    },
    send() {}, on() {}, removeListener() {}
  };
  vm.runInNewContext(fonte, {
    require: nome => {
      assert.equal(nome, 'electron');
      return { contextBridge: { exposeInMainWorld: (_nome, valor) => { api = valor; } }, ipcRenderer };
    },
    process: { env: {} }, console: { warn() {}, error() {} }, setTimeout, Date
  });
  return { api, chamadas, registros: () => chamadas.filter(c => c[0] === 'record-user-action').map(c => c[1]) };
}

test('IPC captura contexto antes de aguardar, registra uma vez e nunca copia payload/retorno bruto', async () => {
  let concluir;
  const m = montar(() => new Promise(resolve => { concluir = resolve; }));
  let contexto = { origem: 'manual', acao_id: 'acao-1', evento: 'submit', tela: 'usuarios', alvo_id: 'salvar' };
  m.api.registrarContextoAuditoria(() => contexto);
  const operacao = m.api.atualizarProduto(9, {
    nome: 'Caixa Rio', quantidade: 2, senha: 'senha-secreta', bb: { client_secret: 'segredo-bb' },
    itens: [{ authorization: 'Bearer segredo', valor: 30 }]
  });
  await Promise.resolve();
  contexto = { origem: 'automatico', acao_id: 'timer-1' };
  concluir({ success: true, token: 'token-retorno', produto: { nome: 'Caixa Rio' } });
  await operacao;
  assert.equal(m.registros().length, 1);
  const registro = m.registros()[0];
  assert.equal(registro.manual, true);
  assert.equal(registro.contexto.acao_id, 'acao-1');
  assert.equal(registro.ok, true);
  assert.equal(registro.method, 'IPC');
  assert.equal(registro.url, 'atualizar-produto');
  assert.equal(registro.details.alvo.id, '9');
  assert.equal(registro.details.alvo.nome, 'Caixa Rio');
  assert.ok(registro.details.campos_protegidos.includes('dados.senha'));
  assert.ok(registro.details.campos_protegidos.includes('dados.bb.client_secret'));
  assert.ok(registro.details.campos_protegidos.includes('dados.itens.0.authorization'));
  assert.doesNotMatch(JSON.stringify(registro), /senha-secreta|segredo-bb|Bearer segredo|token-retorno/);
  assert.equal('payload' in registro, false);
  assert.equal('result' in registro, false);
  assert.equal(m.chamadas[0][2].__auditoria.acao_id, 'acao-1', 'main recebe o token antes do write');
});

test('sem gesto comprovado é nao_confirmada; rotina explicitamente automática não vira manual', async () => {
  const m = montar();
  await m.api.adicionarCategoria('Madeira');
  assert.equal(m.registros()[0].manual, false);
  assert.equal(m.registros()[0].contexto.origem, 'nao_confirmada');
  assert.equal(m.registros()[0].details.alvo.nome, 'Madeira');
  m.api.registrarContextoAuditoria(() => ({ origem: 'automatico', acao_id: 'sync-1' }));
  await m.api.gravarPrecoTabela({ produto_id: 9, preco: 10 });
  assert.equal(m.registros()[1].manual, false);
  assert.equal(m.registros()[1].contexto.origem, 'automatico');
});

test('API bound preserva contexto após await e não publica canais arbitrários', async () => {
  const m = montar();
  m.api.registrarContextoAuditoria(() => ({ origem: 'automatico' }));
  const bound = m.api.comAuditoria({ origem: 'manual', acao_id: 'salvar-9', evento: 'click', usuario_id: 999 });
  await Promise.resolve();
  await bound.registrarEntrada(9, 2);
  assert.equal(m.registros()[0].contexto.acao_id, 'salvar-9');
  assert.equal(m.registros()[0].manual, true);
  assert.equal('usuario_id' in m.registros()[0].contexto, false);
  assert.equal(bound.invoke, undefined);
  assert.equal(bound.auditoriaInvoke, undefined);
  assert.equal(bound.comAuditoria, undefined);
  assert.equal(typeof bound.avisosWindows.lerPreferencias, 'function', 'preserva somente os métodos existentes, inclusive objetos');
});

test('trackAction também cobre operações fora do antigo IPC_ACTION_MAP sem detalhes sensíveis', async () => {
  const m = montar();
  await m.api.publishUpdate({ version: '1.2.3', password: 'senha-publicacao', token: 'token-publicacao' });
  assert.equal(m.registros().length, 1);
  assert.equal(m.registros()[0].channel, 'publish-update');
  assert.deepEqual(plano(m.registros()[0].details.campos_protegidos), ['password', 'token']);
  assert.doesNotMatch(JSON.stringify(m.registros()), /senha-publicacao|token-publicacao/);
});

test('falha é registrada sem mensagem/stack sensível e nunca como gravação bem-sucedida', async () => {
  const m = montar(async () => { throw new Error('senha: segredo-na-mensagem'); });
  await assert.rejects(m.api.adicionarProduto({ nome: 'Caixa' }), /segredo-na-mensagem/);
  assert.equal(m.registros().length, 1);
  assert.equal(m.registros()[0].ok, false);
  assert.doesNotMatch(JSON.stringify(m.registros()), /segredo-na-mensagem|stack|message/);
});

test('recordActivity descarta fetch duplicado e campos livres do renderer', () => {
  const m = montar();
  m.api.recordActivity({ source: 'fetch', bodySummary: '{"senha":"segredo"}' });
  assert.equal(m.registros().length, 0);
  m.api.recordActivity({ source: 'renderer', description: 'senha: segredo', result: { token: 'secreto' }, bodySummary: 'segredo' });
  assert.equal(m.registros().length, 1);
  assert.equal(m.registros()[0].manual, false);
  assert.doesNotMatch(JSON.stringify(m.registros()), /segredo|secreto|description|bodySummary|result/);
});
