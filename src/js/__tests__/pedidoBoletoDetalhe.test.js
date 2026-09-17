/**
 * Modal "Boleto" (src/js/modals/pedido-boleto-detalhe.js e
 * src/html/modals/pedidos/boleto-detalhe.html) — fase D da cobrança BB.
 *
 * As funções puras (tag, dados da situação, seções por permissão, corpo da
 * baixa, textos das confirmações, histórico) são recortadas e executadas sem
 * DOM; o resto prende a anatomia do HTML (guardas escritas, botões só com
 * texto, não fecha por fora) e a ligação com as rotas da fase D.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'pedido-boleto-detalhe.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'pedidos', 'boleto-detalhe.html'), 'utf8');
const plano = v => JSON.parse(JSON.stringify(v));

function puras() {
  const inicio = FONTE.indexOf('const ROTULO_STATUS');
  const fim = FONTE.indexOf('// ------------------------------------------------- fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  const contexto = vm.createContext({});
  return vm.runInContext(`${FONTE.slice(inicio, fim)}\n({ rotuloDoStatus, linhasDeDados, secoesVisiveis, camposDoMotivo, corpoDaBaixa, textoDaConfirmacao, rotuloDoEvento, mensagemDeErro })`, contexto);
}

const BOLETO = {
  id: 41, numero_parcela: 1, numero_documento: '2548P1', nosso_numero: '00031285570000000001', nosso_numero_dv: '9', valor: '1000.00', valor_abatimento: '0.00',
  data_emissao: '2026-09-16', data_vencimento: '2027-01-18', vencimento_original: null, linha_digitavel: '00190.00009 …', status: 'registrado', sincronizado_em: null, ambiente: 'sandbox'
};

test('tag e dados da situação: motivo da baixa, abatimento, prorrogação, pagamento e última consulta', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.rotuloDoStatus(BOLETO)), { classe: 'badge-success', texto: 'Registrado' });
  assert.deepStrictEqual(plano(f.rotuloDoStatus({ status: 'baixado', motivo_baixa: 'cancelado' })), { classe: 'badge-neutral', texto: 'Baixado · cancelado' });
  assert.deepStrictEqual(plano(f.rotuloDoStatus({ status: 'baixado', motivo_baixa: 'banco' })), { classe: 'badge-neutral', texto: 'Baixado · baixado pelo banco' });
  assert.deepStrictEqual(plano(f.rotuloDoStatus(null)), { classe: 'badge-neutral', texto: '—' });

  const simples = Object.fromEntries(plano(f.linhasDeDados(BOLETO)));
  assert.strictEqual(simples.Parcela, '1ª · documento 2548P1');
  assert.strictEqual(simples['Nosso número'], '00031285570000000001-9');
  assert.strictEqual(simples.Valor, 'R$ 1.000,00');
  assert.strictEqual(simples.Vencimento, '18/01/2027');
  assert.strictEqual(simples['Última consulta ao BB'], 'ainda não consultado');
  assert.ok(!('Pagamento' in simples) && !('Baixa' in simples));

  const mexido = Object.fromEntries(plano(f.linhasDeDados({
    ...BOLETO, valor_abatimento: '100.00', data_vencimento: '2027-02-10', vencimento_original: '2027-01-18', sincronizado_em: '2026-09-16T13:05:00Z',
    status: 'baixado', motivo_baixa: 'quitado_por_fora', data_baixa: '2026-09-16', observacao_baixa: 'pago na conta', data_pagamento: '2026-09-15', valor_pago: '900.00',
    canal_pagamento: 'Fora do boleto · Pix', substitui_boleto_id: 12
  })));
  assert.strictEqual(mexido.Valor, 'R$ 1.000,00 − abatimento R$ 100,00 = R$ 900,00');
  assert.strictEqual(mexido.Vencimento, '10/02/2027 (prorrogado; era 18/01/2027)');
  assert.strictEqual(mexido.Pagamento, '15/09/2026 · R$ 900,00 · Fora do boleto · Pix');
  assert.strictEqual(mexido.Baixa, '16/09/2026 · quitado por fora · pago na conta');
  assert.strictEqual(mexido['Reemissão'], 'substitui o boleto nº 12');
  assert.strictEqual(mexido['Última consulta ao BB'], '16/09/2026, 10:05', 'horário de Brasília');
  assert.deepStrictEqual(plano(f.linhasDeDados(null)), []);
});

test('seções: só com o SQL da fase, a ação possível e a permissão; PDF não depende do SQL', () => {
  const f = puras();
  const tudo = () => true;
  const soVer = chave => chave === 'financeiro.boleto.view';
  const acoes = { sincronizar: true, prorrogar: true, abatimento: true, baixar: true, pdf: true };
  assert.deepStrictEqual(plano(f.secoesVisiveis({ sql_pronto: true, acoes }, tudo)), { semSql: false, sincronizar: true, prorrogar: true, abatimento: true, baixar: true, pdf: true });
  assert.deepStrictEqual(plano(f.secoesVisiveis({ sql_pronto: true, acoes }, soVer)), { semSql: false, sincronizar: true, prorrogar: false, abatimento: false, baixar: false, pdf: true });
  assert.deepStrictEqual(plano(f.secoesVisiveis({ sql_pronto: false, acoes }, tudo)), { semSql: true, sincronizar: false, prorrogar: false, abatimento: false, baixar: false, pdf: true });
  assert.deepStrictEqual(plano(f.secoesVisiveis({ sql_pronto: true, acoes: { sincronizar: true } }, tudo)), { semSql: false, sincronizar: true, prorrogar: false, abatimento: false, baixar: false, pdf: false });
  assert.deepStrictEqual(plano(f.secoesVisiveis(null, tudo)), { semSql: false, sincronizar: false, prorrogar: false, abatimento: false, baixar: false, pdf: false });
});

test('baixa: campos por motivo, corpo do POST e o que falta', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.camposDoMotivo('quitado_por_fora')), { quitado: true, reemissao: false, observacaoObrigatoria: false });
  assert.deepStrictEqual(plano(f.camposDoMotivo('reemissao')), { quitado: false, reemissao: true, observacaoObrigatoria: false });
  assert.deepStrictEqual(plano(f.camposDoMotivo('cancelado')), { quitado: false, reemissao: false, observacaoObrigatoria: true });

  assert.strictEqual(f.corpoDaBaixa({}).falta, 'Escolha o motivo da baixa.');
  assert.strictEqual(f.corpoDaBaixa({ motivo: 'cancelado', observacao: '  ' }).falta, 'Diga na observação por que a cobrança foi cancelada.');
  assert.deepStrictEqual(plano(f.corpoDaBaixa({ motivo: 'cancelado', observacao: ' desistiu ' })), { corpo: { motivo: 'cancelado', observacao: 'desistiu' }, falta: '' });
  assert.strictEqual(f.corpoDaBaixa({ motivo: 'quitado_por_fora', valorRecebido: 10, forma: 'Pix' }).falta, 'Informe a data em que o valor foi recebido.');
  assert.strictEqual(f.corpoDaBaixa({ motivo: 'quitado_por_fora', dataRecebimento: '2026-09-15', valorRecebido: NaN, forma: 'Pix' }).falta, 'Informe o valor recebido.');
  assert.strictEqual(f.corpoDaBaixa({ motivo: 'quitado_por_fora', dataRecebimento: '2026-09-15', valorRecebido: 10 }).falta, 'Informe como o valor foi recebido.');
  assert.deepStrictEqual(plano(f.corpoDaBaixa({ motivo: 'quitado_por_fora', dataRecebimento: '2026-09-15', valorRecebido: 1000, forma: 'Pix', novoVencimento: '2026-10-01' })),
    { corpo: { motivo: 'quitado_por_fora', observacao: '', data_recebimento: '2026-09-15', valor_recebido: 1000, forma: 'Pix' }, falta: '' }, 'só os campos do motivo');
  assert.strictEqual(f.corpoDaBaixa({ motivo: 'reemissao' }).falta, 'Informe o vencimento do boleto novo.');
  assert.deepStrictEqual(plano(f.corpoDaBaixa({ motivo: 'reemissao', novoVencimento: '2026-10-01', dataRecebimento: '2026-09-15' })),
    { corpo: { motivo: 'reemissao', observacao: '', novo_vencimento: '2026-10-01' }, falta: '' });
});

test('confirmações: dizem o ambiente, o que muda e que a baixa não tem volta; histórico e erros', () => {
  const f = puras();
  const p = plano(f.textoDaConfirmacao('prorrogar', { boleto: BOLETO, producao: false, novaData: '2027-02-10' }));
  assert.strictEqual(p.title, 'Prorrogar o vencimento?');
  assert.strictEqual(p.message, 'O boleto da parcela 1 passa a vencer em 10/02/2027 (era 18/01/2027) na homologação do BB (teste, sem valor). Nada é enviado ao cliente.');
  const a = plano(f.textoDaConfirmacao('abatimento', { boleto: BOLETO, producao: true, valor: 100 }));
  assert.match(a.message, /passa a cobrar R\$ 900,00 \(abatimento de R\$ 100,00\) no Banco do Brasil \(PRODUÇÃO\)/);
  const b = plano(f.textoDaConfirmacao('baixar', { boleto: BOLETO, producao: false, baixa: { motivo: 'reemissao', novo_vencimento: '2026-10-01' } }));
  assert.strictEqual(b.confirmText, 'Baixar boleto');
  assert.match(b.message, /\(reemissão\) sai de cobrança .* Não tem volta\. Em seguida um boleto novo é registrado para a parcela, vencendo em 01\/10\/2026\./);
  const q = plano(f.textoDaConfirmacao('baixar', { boleto: { valor: 1 }, producao: false, baixa: { motivo: 'quitado_por_fora', valor_recebido: 1000, data_recebimento: '2026-09-15', forma: 'Pix' } }));
  assert.match(q.message, /^O boleto \(quitado por fora\).*recebimento de R\$ 1\.000,00 em 15\/09\/2026 \(Pix\)\./);

  assert.strictEqual(f.rotuloDoEvento({ tipo: 'baixa_operacional', origem: 'webhook' }), 'Aviso de pagamento do BB (webhook)');
  assert.strictEqual(f.rotuloDoEvento({ tipo: 'prorrogado', origem: 'app' }), 'Vencimento prorrogado');
  assert.strictEqual(f.rotuloDoEvento({ tipo: 'consulta', origem: 'consulta' }), 'Consulta ao BB (consulta)');
  assert.strictEqual(f.rotuloDoEvento({ tipo: 'novo_tipo' }), 'novo_tipo');
  assert.strictEqual(f.mensagemDeErro(403, null, 'x'), 'Você não tem permissão para esta ação.');
  assert.strictEqual(f.mensagemDeErro(404, null, 'x'), 'Boleto não encontrado.');
  assert.strictEqual(f.mensagemDeErro(422, { error: 'O BB respondeu 400' }, 'x'), 'O BB respondeu 400');
  assert.strictEqual(f.mensagemDeErro(500, null, 'padrão'), 'padrão');
});

test('HTML: overlay acima da lista, seções escondidas, guardas escritas, botões só com texto; não fecha clicando fora', () => {
  for (const id of ['boletoDetalheOverlay', 'boletoDetalheTitulo', 'boletoDetalheTituloTexto', 'boletoDetalheSubtitulo', 'boletoDetalheAmbiente', 'boletoDetalheCarregando',
    'boletoDetalheSemSql', 'boletoDetalheSituacao', 'boletoDetalheStatus', 'boletoDetalheSituacaoBB', 'boletoDetalheDados',
    'boletoDetalheProrrogar', 'boletoDetalheNovaData', 'boletoDetalheProrrogarBtn', 'boletoDetalheAbatimento', 'boletoDetalheValorAbatimento', 'boletoDetalheAbatimentoBtn',
    'boletoDetalheBaixar', 'boletoDetalheMotivo', 'boletoDetalheQuitado', 'boletoDetalheDataRecebimento', 'boletoDetalheValorRecebido', 'boletoDetalheForma',
    'boletoDetalheReemissao', 'boletoDetalheNovoVencimento', 'boletoDetalheObservacao', 'boletoDetalheBaixarBtn', 'boletoDetalheMensagem', 'boletoDetalheAvisos',
    'boletoDetalheHistorico', 'boletoDetalheEventos', 'voltarBoletoDetalhe', 'fecharBoletoDetalhe', 'boletoDetalhePdf', 'boletoDetalheSincronizar']) {
    assert.ok(HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(HTML.includes('z-[1300]'), 'por cima da lista de boletos (z-[1200])');
  for (const secao of ['boletoDetalheSituacao', 'boletoDetalheProrrogar', 'boletoDetalheAbatimento', 'boletoDetalheBaixar', 'boletoDetalheHistorico']) {
    assert.ok(new RegExp(`id="${secao}" class="hidden`).test(HTML), `#${secao} nasce escondida`);
  }
  for (const botao of ['boletoDetalheProrrogarBtn', 'boletoDetalheAbatimentoBtn', 'boletoDetalheBaixarBtn']) {
    assert.ok(new RegExp(`id="${botao}"[^>]*data-perm="financeiro\\.boleto\\.baixa"`).test(HTML), `#${botao} pede financeiro.boleto.baixa`);
  }
  assert.ok(/id="boletoDetalheSincronizar"[^>]*data-perm="financeiro\.boleto\.view"[^>]*class="hidden/.test(HTML));
  assert.ok(/id="boletoDetalhePdf"[^>]*data-perm="financeiro\.boleto\.view"[^>]*class="hidden/.test(HTML));
  assert.ok(/<option value="quitado_por_fora">/.test(HTML) && /<option value="cancelado">/.test(HTML) && /<option value="reemissao">/.test(HTML));
  assert.ok(/id="boletoDetalheValorAbatimento"[^>]*data-numeric="true"/.test(HTML), 'valor pelo NumericInput da casa');
  assert.ok(!/<button[^>]*>\s*<i class="fas/.test(HTML), 'botões só com texto');
  assert.ok(!HTML.includes('onclick'));
  assert.ok(HTML.includes('Não tem volta'), 'a baixa avisa que é definitiva');
});

test('script: rotas da fase D, confirmação na caixa da casa, avisa a lista, sem innerHTML nem confirm()', () => {
  assert.ok(FONTE.includes('/api/cobranca/boletos/${encodeURIComponent(ctx.boletoId)}/historico'));
  assert.ok(FONTE.includes('/api/cobranca/boletos/${encodeURIComponent(ctx.boletoId)}/${acao}'));
  for (const acao of ["executar('sincronizar'", "executar('prorrogar', { data_vencimento: novaData }", "executar('abatimento', { valor }", "executar('baixar', corpo"]) {
    assert.ok(FONTE.includes(acao), `sem ${acao}`);
  }
  assert.strictEqual((FONTE.match(/window\.DialogPadrao\?\.confirm\?\.\(/g) || []).length, 3, 'prorrogar, abatimento e baixa confirmam');
  assert.ok(FONTE.includes("window.dispatchEvent(new CustomEvent('boletos:alterados'"));
  assert.ok(FONTE.includes('window.BoletoDocumentos.gerarBoletoPdf(ctx.boletoId)'));
  assert.ok(FONTE.includes("ligar('boletoDetalheBaixarBtn', baixar)") && FONTE.includes('window.BotaoAcao.bind(botao, fn)'), 'trava de clique duplo');
  assert.ok(FONTE.includes("window.Permissoes.pode(chave)"));
  assert.ok(!/window\.confirm\(|showStatusConfirmDialog|innerHTML|insertAdjacentHTML/.test(FONTE));
  assert.ok(FONTE.includes("document.removeEventListener('keydown', aoEsc)") && FONTE.includes("window.removeEventListener('modalFechado', aoFecharModal)"));
  assert.ok(FONTE.includes("if (document.querySelector('dialog[data-dialog-padrao][open]')) return;"), 'Esc com a caixa de confirmação aberta é dela');
  assert.ok(FONTE.includes('window.Modal?.signalReady?.(overlayId)'));
  assert.ok(!FONTE.includes("overlay.addEventListener('click'"), 'não fecha clicando fora');
});
