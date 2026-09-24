/**
 * Modal "Pagamentos das parcelas" (Pedidos → Visualizar → "Pagamentos"),
 * decisões do dono de 24/09/2026: registrar quando e como o cliente pagou
 * cada parcela (Pix, cartão…, com ou sem boleto), a multa e os juros
 * sugeridos pelo vencimento em dia não útil, e o estorno.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');
const FONTE = ler('js', 'modals', 'pedido-pagamentos-parcelas.js');
const HTML = ler('html', 'modals', 'pedidos', 'pagamentos-parcelas.html');
const VISUALIZAR = ler('js', 'modals', 'pedido-visualizar.js');
const VIS_HTML = ler('html', 'modals', 'pedidos', 'visualizar.html');
const plano = v => JSON.parse(JSON.stringify(v));
const semEspacoFixo = s => String(s).replace(/\s/g, ' ');

function puras() {
  const inicio = FONTE.indexOf('const MESES');
  const fim = FONTE.indexOf('// ------------------------------------------------- fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  return vm.runInContext(`${FONTE.slice(inicio, fim)}
({ rotuloDoMes, lerValor, textoDaCobranca, situacaoDaParcela, textoDoVencimento, acoesDaParcela, textoDosEncargos, mensagemDeErro })`, vm.createContext({}));
}

test('valor digitado e mês da comissão', () => {
  const f = puras();
  assert.strictEqual(f.lerValor('3.326,51'), 3326.51);
  assert.strictEqual(f.lerValor('R$ 3.326,51'), 3326.51);
  assert.strictEqual(f.lerValor('3326.51'), 3326.51);
  assert.strictEqual(f.lerValor('1000'), 1000);
  assert.strictEqual(f.lerValor(''), null);
  assert.strictEqual(f.rotuloDoMes('2026-09-21'), 'setembro/2026');
});

test('situação de cada parcela: paga (forma, encargos, observação), no banco, atrasada, em aberto com o boleto', () => {
  const f = puras();
  const paga = f.situacaoDaParcela({ situacao: 'paga', recebimento: { data: '2026-09-23', forma: 'Pix', valor: 3422.98, origem_rotulo: 'registrado à mão', encargos: 96.47, observacao: 'na conta' } });
  assert.strictEqual(paga.classe, 'badge-success');
  assert.strictEqual(paga.texto, 'Pago em 23/09/2026 · Pix');
  assert.strictEqual(semEspacoFixo(paga.detalhe), 'R$ 3.422,98 · registrado à mão · R$ 96,47 de multa e juros · na conta');
  assert.strictEqual(f.situacaoDaParcela({ situacao: 'paga_no_banco', boleto: { status: 'pago' } }).texto, 'Boleto pago no banco');
  assert.strictEqual(f.situacaoDaParcela({ situacao: 'paga_no_banco', boleto: { status: 'baixado' } }).texto, 'Quitado por fora');
  const atrasada = f.situacaoDaParcela({ situacao: 'atrasada', dias_atraso: 3, boleto_aberto: true, boleto: { status: 'vencido', nosso_numero: 'N1' } });
  assert.deepStrictEqual(plano(atrasada), { classe: 'badge-warning', texto: 'Atrasada · 3 dias', detalhe: 'Boleto do BB vencido · nº N1' });
  assert.strictEqual(f.situacaoDaParcela({ situacao: 'aberta', boleto_externo: { banco_nome: 'Itaú' } }).detalhe, 'Boleto de fora · Itaú');
  assert.strictEqual(f.situacaoDaParcela({ situacao: 'aberta' }).detalhe, 'Sem boleto');
});

test('vencimento em dia não útil: a coluna diz até quando vale, e o formulário explica o atraso e os encargos', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.textoDoVencimento({ vencimento: '2026-09-20', limite_sem_encargos: '2026-09-21' })), { principal: '20/09/2026', detalhe: 'sem encargos até 21/09/2026' });
  assert.deepStrictEqual(plano(f.textoDoVencimento({ vencimento: '2026-09-24', limite_sem_encargos: '2026-09-24' })), { principal: '24/09/2026', detalhe: '' });

  const emDia = f.textoDosEncargos({ dias: 0, vencimento: '2026-09-20', limite: '2026-09-21', total: 0 });
  assert.match(emDia.texto, /Em dia: o vencimento \(20\/09\/2026\) caiu em fim de semana ou feriado e vale até 21\/09\/2026/);
  assert.strictEqual(emDia.somar, false);
  assert.strictEqual(f.textoDosEncargos({ dias: 0, vencimento: '2026-09-24', limite: '2026-09-24', total: 0 }).texto, '', 'dia útil em dia: nada a dizer');

  const atrasado = f.textoDosEncargos({ dias: 3, vencimento: '2026-09-20', limite: '2026-09-21', multa: 66.53, juros: 29.94, total: 96.47 });
  assert.match(semEspacoFixo(atrasado.texto), /3 dias de atraso, contados desde o vencimento \(20\/09\/2026\) — sem encargos só até 21\/09\/2026\. Pelas regras dos boletos: multa R\$ 66,53 \+ juros R\$ 29,94 = R\$ 96,47\./);
  assert.strictEqual(atrasado.somar, true);
  assert.strictEqual(f.textoDosEncargos({ dias: 2, vencimento: '2026-09-24', limite: '2026-09-24', total: 0 }).somar, false, 'sem regras: mostra o atraso, não soma');
});

test('ações da linha: registrar a parcela em aberto, estornar o que foi pago à mão (nunca o que veio do banco)', () => {
  const f = puras();
  const todas = { podeRegistrar: true, podeEstornar: true };
  assert.deepStrictEqual(plano(f.acoesDaParcela({ pode_registrar: true, situacao: 'atrasada' }, todas)), ['registrar']);
  assert.deepStrictEqual(plano(f.acoesDaParcela({ pode_registrar: false, situacao: 'paga', recebimento: { pode_estornar: true } }, todas)), ['estornar']);
  assert.deepStrictEqual(plano(f.acoesDaParcela({ situacao: 'paga', recebimento: { pode_estornar: false } }, todas)), [], 'boleto pago: só o BB desfaz');
  assert.deepStrictEqual(plano(f.acoesDaParcela({ pode_registrar: true, situacao: 'aberta' }, { podeRegistrar: false })), [], 'sem a permissão, nada');
  assert.match(f.mensagemDeErro(409, { sql_pendente: true }), /cobranca_recebimentos\.sql/);
  assert.strictEqual(f.mensagemDeErro(403, {}), 'Sem permissão para esta ação.');
});

test('grava e estorna pelas rotas de recebimentos; boleto do BB em aberto pergunta antes e manda baixar_boleto', () => {
  assert.ok(FONTE.includes('fetchApi(`/api/cobranca/pedidos/${id}/pagamentos`)'), 'lê o estado do pedido');
  assert.ok(FONTE.includes('/api/cobranca/pedidos/${id}/pagamentos/encargos?numero_parcela='), 'a conta dos encargos é do backend');
  assert.ok(FONTE.includes("fetchApi('/api/cobranca/recebimentos', comoJson(envio))"));
  assert.ok(FONTE.includes('/api/cobranca/recebimentos/${encodeURIComponent(p.recebimento.id)}/estornar'));
  assert.ok(FONTE.includes("...(baixar ? { baixar_boleto: true } : {})"));
  assert.ok(FONTE.includes("pode('financeiro.boleto.baixa')"), 'baixar pede a permissão de baixa');
  assert.strictEqual((FONTE.match(/window\.DialogPadrao\?\.confirm\?\.\(/g) || []).length, 1, 'a baixa do boleto pede confirmação');
  assert.ok(FONTE.includes("avisarQuemEstaAberto('recebimentos:alterados')"));
  assert.ok(!/innerHTML|window\.confirm\(/.test(FONTE), 'montado por createElement, sem confirm() do sistema');
  assert.ok(FONTE.includes('window.Modal?.signalReady?.(overlayId)'), 'revela depois da primeira leitura');
  assert.ok(FONTE.includes('if (motivo.length < 5)'), 'o estorno pede o motivo');
});

test('anatomia do modal: largo, tabela sem rolagem de lado, coluna Ações, formulário e estorno com as permissões', () => {
  assert.match(HTML, /id="pagamentosParcelasOverlay" class="hidden fixed inset-0[^"]*ctl-padrao"/);
  assert.ok(HTML.includes('max-w-6xl'));
  assert.match(HTML, /id="pagamentosParcelasTabela" class="w-full table-fixed/);
  assert.ok(!HTML.includes('overflow-x-auto'), 'sem rolagem de lado');
  assert.ok(HTML.includes('>Ações</th>'));
  for (const idCampo of ['pagamentosParcelasData', 'pagamentosParcelasForma', 'pagamentosParcelasValor', 'pagamentosParcelasObservacao', 'pagamentosParcelasMotivoEstorno']) {
    assert.ok(HTML.includes(`id="${idCampo}"`), idCampo);
  }
  assert.match(HTML, /id="pagamentosParcelasRegistrar"[^>]*data-perm="financeiro\.recebimento\.registrar"/);
  assert.match(HTML, /id="pagamentosParcelasConfirmarEstorno"[^>]*data-perm="financeiro\.recebimento\.estornar"/);
  assert.match(HTML, /id="fecharPagamentosParcelas"[^>]*btn-danger/);
});

test('Visualizar: botão "Pagamentos" abre o modal por cima; o pagamento à mão aparece na coluna e na etiqueta', () => {
  assert.match(VIS_HTML, /id="visualizarPedidoPagamentos"[^>]*data-perm="financeiro\.recebimento\.view"[^>]*>Pagamentos</);
  assert.ok(VISUALIZAR.includes("abrirPorCima('modals/pedidos/pagamentos-parcelas.html', '../js/modals/pedido-pagamentos-parcelas.js', 'pagamentosParcelas')"));
  assert.match(VISUALIZAR, /const FILHOS = \[[^\]]*'pagamentosParcelas'/);
  assert.match(VISUALIZAR, /const EVENTOS_QUE_MUDAM_O_PEDIDO = \[[^\]]*'recebimentos:alterados'/);
  assert.ok(VISUALIZAR.includes('ligarPagamentos(data, data.parcelas_detalhes, boletosEstado)'));
  assert.ok(VISUALIZAR.includes("if (linha?.recebimento?.origem === 'manual')"), 'a coluna BOLETO mostra o pago à mão');

  const inicio = VISUALIZAR.indexOf('function rotuloDoPagamento(');
  const fim = VISUALIZAR.indexOf('/** Como o boleto emitido fora aparece');
  const rotulo = vm.runInContext(`${VISUALIZAR.slice(inicio, fim)}\nrotuloDoPagamento`, vm.createContext({}));
  assert.deepStrictEqual(plano(rotulo({ data: '2026-09-21', forma: 'Pix' })), { classe: 'badge-success', texto: 'pago · Pix · 21/09/2026' });
});
