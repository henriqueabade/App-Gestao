/**
 * "Datas do envio" (src/js/modals/pedido-datas-envio.js + datas-envio.html)
 * e o calendário da lista de Pedidos (`calendarioDaLinha` em pedidos.js).
 *
 * Decisões do dono (24/09/2026): o calendário do pedido Enviado sem NF-e do
 * sistema abre a correção da data de envio e dos prazos; Entregue fica
 * apagado. A data de envio só move as parcelas quando o faturamento conta do
 * envio, e a parcela paga, com boleto ou ordem não muda.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente, esperarTarefas } = require('./apoio/domMinimo');

const RAIZ = path.join(__dirname, '..', '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'pedido-datas-envio.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'pedidos', 'datas-envio.html'), 'utf8');
const PEDIDOS = fs.readFileSync(path.join(RAIZ, 'js', 'pedidos.js'), 'utf8');

const simples = valor => JSON.parse(JSON.stringify(valor));

function puras() {
  const inicio = FONTE.indexOf('const REGRAS_FATURAMENTO');
  const fim = FONTE.indexOf('// fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  // eslint-disable-next-line no-new-func
  return new Function(`${FONTE.slice(inicio, fim)}
    return { regraInicial, inicioDaRegra, planoDaTela, textoDaPrevia, linhaDaParcela, corpoDoEnvio, limparPrazo, mensagemDeErro };`)();
}

function recortar(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `função ${nome} não encontrada`);
  let i = fonte.indexOf('{', inicio);
  let nivel = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}') { nivel -= 1; if (nivel === 0) break; }
  }
  return vm.runInContext(`${fonte.slice(inicio, i + 1)}\n${nome}`, vm.createContext({}));
}

const F = puras();

const PEDIDO = {
  id: 7, numero: 'P-7', situacao: 'Enviado', embarcar_real: '2026-09-24', embarcar_previsao: '2026-09-10',
  inicio_faturamento: '2026-09-24', faturamento_regra: 'ao_embarcar', prazo: '30/60', data_conversao: '2026-08-20'
};
const PARCELAS = [
  { id: 71, numero: 1, valor: 500, vencimento: '2026-10-24', prazo: 30, travada: true, trava: 'Tem boleto do BB: o vencimento não muda.' },
  { id: 72, numero: 2, valor: 500, vencimento: '2026-11-23', prazo: 60, travada: false, trava: null }
];

// ================================================================ a lista

test('lista: o calendário muda de função pela situação', () => {
  const calendarioDaLinha = recortar(PEDIDOS, 'calendarioDaLinha');
  assert.deepEqual(simples(calendarioDaLinha({ situacao: 'Produção' })), { modo: 'pagamento', perm: 'ped.payment.edit', titulo: 'Alterar pagamento' });
  assert.deepEqual(simples(calendarioDaLinha({ situacao: 'Enviado' }, { status_fiscal: 'cancelada' })),
    { modo: 'envio', perm: 'ped.dates.edit', titulo: 'Corrigir a data de envio e os prazos' });
  const comNota = calendarioDaLinha({ situacao: 'Enviado' }, { status_fiscal: 'autorizada' });
  assert.equal(comNota.modo, null, 'enviado com NF-e do sistema: apagado');
  assert.match(comNota.titulo, /seguem a nota/);
  assert.equal(calendarioDaLinha({ situacao: 'Enviado', devolucao: 'total' }).modo, null);
  assert.equal(calendarioDaLinha({ situacao: 'Enviado', devolucao: 'parcial' }).modo, 'envio');
  const entregue = calendarioDaLinha({ situacao: 'Entregue' });
  assert.equal(entregue.modo, null);
  assert.equal(entregue.titulo, 'Pedido entregue: as datas não mudam mais');
  assert.equal(calendarioDaLinha({ situacao: 'Cancelado' }).modo, null);
});

test('lista: o ícone leva a permissão e o modo da linha, e o modo "envio" abre o modal novo', () => {
  assert.match(PEDIDOS, /data-perm="\$\{calendario\.perm\}" data-modo="\$\{calendario\.modo \|\| ''\}"[^>]*acao-calendario \$\{calendario\.modo \? '' : 'icon-disabled'\}/);
  assert.match(PEDIDOS, /icon\.dataset\.modo === 'envio'\) abrirDatasDoEnvio\(/);
  assert.match(PEDIDOS, /openPedidoModal\('modals\/pedidos\/datas-envio\.html', '\.\.\/js\/modals\/pedido-datas-envio\.js', 'datasEnvio'\)/);
});

// ========================================================== funções puras

test('pedido antigo sem escolha abre "na conversão" (ou "data" com início): salvar sem mexer não move nada', () => {
  assert.equal(F.regraInicial({ faturamento_regra: 'ao_embarcar' }), 'ao_embarcar');
  assert.equal(F.regraInicial({ inicio_faturamento: '2026-09-01' }), 'data');
  assert.equal(F.regraInicial({}), 'ao_converter');
});

test('prévia: "no envio" move a parcela livre; a travada fica', () => {
  const plano = F.planoDaTela({ pedido: PEDIDO, parcelas: PARCELAS, regra: 'ao_embarcar', dataEnvio: '2026-09-15', prazos: null });
  assert.equal(plano.inicio, '2026-09-15');
  assert.deepEqual(simples(plano.linhas.map(l => [l.vencimento, l.muda])), [['2026-10-24', false], ['2026-11-14', true]]);
  assert.equal(F.textoDaPrevia(plano, 'ao_embarcar'), 'Faturamento a partir de 15/09/2026. 1 parcela muda de vencimento.');

  const outra = F.planoDaTela({ pedido: { ...PEDIDO, faturamento_regra: 'ao_converter', inicio_faturamento: '2026-08-20' }, parcelas: PARCELAS, regra: 'ao_converter', dataEnvio: '2026-09-15', prazos: null });
  assert.equal(outra.movidas, 0, 'faturamento na conversão: mudar o envio não mexe nas parcelas');
  assert.equal(F.textoDaPrevia(outra, 'ao_converter'), 'Faturamento a partir de 20/08/2026. Nenhum vencimento muda.');

  const prazo = F.planoDaTela({ pedido: PEDIDO, parcelas: PARCELAS, regra: 'ao_embarcar', dataEnvio: '2026-09-24', prazos: [99, 45] });
  assert.deepEqual(simples(prazo.linhas.map(l => [l.prazo, l.vencimento])), [[30, '2026-10-24'], [45, '2026-11-08']]);
});

test('tabela: cadeado com o motivo na travada, prazo editável e data nova em destaque nas outras', () => {
  const plano = F.planoDaTela({ pedido: PEDIDO, parcelas: PARCELAS, regra: 'ao_embarcar', dataEnvio: '2026-09-15', prazos: null });
  const travada = F.linhaDaParcela(plano.linhas[0], 0);
  assert.match(travada, /fa-lock/);
  assert.match(travada, /Tem boleto do BB: o vencimento não muda\./);
  assert.doesNotMatch(travada, /data-prazo/);
  const livre = F.linhaDaParcela(plano.linhas[1], 1);
  assert.match(livre, /data-prazo="1" value="60"/);
  assert.match(livre, /data-numeric="false"/, 'dias inteiros: fora do NumericInput');
  assert.match(livre, /<strong style="color: var\(--color-primary\)">14\/11\/2026<\/strong>/);
  assert.equal(F.limparPrazo('4a5,6'), '456');
});

test('corpo do PUT: o início só vai na data específica; os prazos quando foram mexidos', () => {
  assert.deepEqual(simples(F.corpoDoEnvio({ dataEnvio: '2026-09-15', previsao: '2026-09-10', regra: 'ao_embarcar', inicioEscolhido: '2026-09-01', prazos: null })),
    { data_envio: '2026-09-15', embarcar_previsao: '2026-09-10', faturamento_regra: 'ao_embarcar' });
  assert.deepEqual(simples(F.corpoDoEnvio({ dataEnvio: '2026-09-15', previsao: '2026-09-10', regra: 'data', inicioEscolhido: '2026-09-01', prazos: [30, 45] })),
    { data_envio: '2026-09-15', embarcar_previsao: '2026-09-10', faturamento_regra: 'data', inicio_faturamento: '2026-09-01', prazos: [30, 45] });
});

// ================================================================= o modal

function abrirModal(resposta, { status = 200 } = {}) {
  const amb = criarAmbiente();
  const { janela, documento } = amb;
  const wrapper = amb.montar(HTML);
  const registro = { fechados: [], prontos: [], requisicoes: [], toasts: [], recarregou: 0 };
  janela.Modal = {
    close(id) { registro.fechados.push(id); wrapper.remove(); },
    signalReady(id) { registro.prontos.push(id); }
  };
  janela.apiConfig = { getApiBaseUrl: async () => 'http://api.teste' };
  janela.showToast = (texto, tipo) => registro.toasts.push([texto, tipo]);
  janela.carregarPedidos = async () => { registro.recarregou += 1; };
  janela.fetch = async (url, opcoes) => {
    const corpo = opcoes?.body ? JSON.parse(opcoes.body) : null;
    registro.requisicoes.push({ url, metodo: opcoes?.method || 'GET', corpo });
    if (opcoes?.method === 'PUT') return { ok: true, status: 200, json: async () => ({ ok: true, nada: false, avisos: [] }) };
    return { ok: status === 200, status, json: async () => simples(resposta) };
  };
  janela.datasEnvioContext = { pedidoId: 7, numero: 'P-7', cliente: 'Casa Bela' };
  vm.runInContext(FONTE, vm.createContext(janela), { filename: 'pedido-datas-envio.js' });
  const $ = id => documento.getElementById(id);
  return {
    ...amb, registro, $,
    digitar(id, texto) { const c = $(id); c.value = texto; amb.disparar(c, 'input'); return c; },
    novos: () => documento.querySelectorAll('td[data-novo-vencimento]').map(td => td.textContent.trim())
  };
}

const RESPOSTA = { pedido: PEDIDO, parcelas: PARCELAS, bloqueio: null, nota_de_fora: { numero: 5501, serie: 1, data_emissao: '2026-09-15' }, hoje: '2026-09-24' };

test('modal: abre preenchido, sugere a data da NF-e de fora e grava a correção', async () => {
  const m = abrirModal(RESPOSTA);
  await esperarTarefas();
  assert.deepEqual(m.registro.prontos, ['datasEnvio'], 'revela depois de carregar');
  assert.equal(m.$('datasEnvioSubtitulo').textContent, 'P-7 · Casa Bela');
  assert.equal(m.$('datasEnvioData').value, '24/09/2026');
  assert.equal(m.$('datasEnvioPrevisao').value, '10/09/2026');
  assert.equal(m.$('datasEnvioRegraEnvio').checked, true);
  assert.equal(m.$('datasEnvioInicio').disabled, true);
  assert.equal(m.$('datasEnvioNotaForaTexto').textContent, 'NF-e de fora nº 5501 emitida em 15/09/2026.');
  assert.deepEqual(m.novos(), ['Tem boleto do BB: o vencimento não muda.', 'não muda']);

  m.disparar(m.$('datasEnvioUsarNotaFora'), 'click');
  assert.equal(m.$('datasEnvioData').value, '15/09/2026');
  assert.deepEqual(m.novos(), ['Tem boleto do BB: o vencimento não muda.', '14/11/2026']);
  assert.equal(m.$('datasEnvioPreviaTexto').textContent, 'Faturamento a partir de 15/09/2026. 1 parcela muda de vencimento.');

  m.disparar(m.$('salvarDatasEnvio'), 'click');
  await esperarTarefas();
  const put = m.registro.requisicoes.find(r => r.metodo === 'PUT');
  assert.equal(put.url, 'http://api.teste/api/pedidos/7/envio');
  assert.deepEqual(put.corpo, { data_envio: '2026-09-15', embarcar_previsao: '2026-09-10', faturamento_regra: 'ao_embarcar' });
  assert.deepEqual(m.registro.toasts[0], ['Datas do envio corrigidas.', 'success']);
  assert.equal(m.registro.recarregou, 1, 'a lista é relida antes de fechar');
  assert.deepEqual(m.registro.fechados, ['datasEnvio']);
});

test('modal: o prazo digitado entra no corpo, com o da travada como estava', async () => {
  const m = abrirModal(RESPOSTA);
  await esperarTarefas();
  const campo = m.documento.querySelector('input[data-prazo="1"]');
  campo.value = '45';
  m.disparar(campo, 'input');
  assert.deepEqual(m.novos(), ['Tem boleto do BB: o vencimento não muda.', '08/11/2026']);
  m.disparar(m.$('salvarDatasEnvio'), 'click');
  await esperarTarefas();
  assert.deepEqual(m.registro.requisicoes.find(r => r.metodo === 'PUT').corpo.prazos, [30, 45]);
});

test('modal: pedido que não pode (NF-e do sistema) mostra o motivo e não salva', async () => {
  const m = abrirModal({ ...RESPOSTA, bloqueio: 'Pedido enviado com NF-e nº 812: a data de envio e os vencimentos seguem a nota.' });
  await esperarTarefas();
  assert.equal(m.$('datasEnvioBloqueio').classList.contains('hidden'), false);
  assert.match(m.$('datasEnvioBloqueio').textContent, /seguem a nota/);
  assert.equal(m.$('salvarDatasEnvio').disabled, true);
  assert.equal(m.$('datasEnvioData').disabled, true);
  assert.equal(m.documento.querySelector('input[data-prazo="1"]').disabled, true);
  m.disparar(m.$('salvarDatasEnvio'), 'click');
  await esperarTarefas();
  assert.equal(m.registro.requisicoes.filter(r => r.metodo === 'PUT').length, 0);
});

test('markup: vidro e botões do padrão, Salvar com a guarda ped.dates.edit', () => {
  assert.match(HTML, /id="datasEnvioOverlay" class="hidden fixed inset-0 z-\[1200\] bg-black\/50[^"]*ctl-padrao"/);
  assert.match(HTML, /glass-surface backdrop-blur-xl rounded-3xl border border-white\/10 ring-1 ring-white\/5 shadow-2xl/);
  assert.match(HTML, /id="cancelarDatasEnvio" type="button" class="btn-danger ctl-botao/);
  assert.match(HTML, /id="salvarDatasEnvio" type="button" data-perm="ped\.dates\.edit" class="btn-primary ctl-botao/);
});
