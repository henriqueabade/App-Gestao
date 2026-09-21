/**
 * Modal "Gerar boletos" (src/js/modals/pedido-gerar-boletos.js e
 * src/html/modals/pedidos/gerar-boletos.html) — fase B da cobrança BB.
 *
 * As funções puras (a linha de cada parcela, o resumo do que saiu e as
 * mensagens de erro) são recortadas e executadas sem DOM; o resto prende a
 * anatomia do HTML (guardas escritas, sem ícone nos botões, não fecha por
 * fora) e a ligação com o backend (GET/POST /api/cobranca/pedidos/:id/boletos,
 * confirmação na caixa da casa, nada de innerHTML nem confirm()).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'pedido-gerar-boletos.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'pedidos', 'gerar-boletos.html'), 'utf8');
const plano = v => JSON.parse(JSON.stringify(v));

function puras() {
  const inicio = FONTE.indexOf('const ROTULO_STATUS');
  const fim = FONTE.indexOf('// ------------------------------------------------- fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  const contexto = vm.createContext({});
  return vm.runInContext(`${FONTE.slice(inicio, fim)}\n({ linhaDaParcela, resumoDosResultados, mensagemDeErro, estadoDoRodape, resumoDaConsulta })`, contexto);
}

test('linhaDaParcela: só a parcela sem boleto vivo pode ser marcada; a tag e o detalhe seguem o boleto', () => {
  const f = puras();
  const sem = plano(f.linhaDaParcela({ parcela: { id: 1, numero_parcela: 1, data_vencimento: '2027-01-18T00:00:00.000Z', valor: '1000.00' }, boleto: null, tem_boleto_vivo: false }));
  assert.deepStrictEqual(sem, { id: 1, numero: 1, vencimento: '2027-01-18', valor: 1000, podeGerar: true, temPdf: false, temDetalhe: false, boletoId: null, classe: 'badge-neutral', rotulo: 'Sem boleto', detalhe: '' });
  const registrado = plano(f.linhaDaParcela({ parcela: { id: 2, numero_parcela: 2, data_vencimento: '2027-02-17', valor: 1000 }, tem_boleto_vivo: true,
    boleto: { id: 41, status: 'registrado', nosso_numero: '00034534810000000002', nosso_numero_dv: '5', linha_digitavel: '00190.00009 …' } }));
  assert.strictEqual(registrado.temPdf, true, 'registrado tem PDF');
  assert.strictEqual(registrado.boletoId, 41);
  assert.strictEqual(registrado.podeGerar, false);
  assert.strictEqual(registrado.rotulo, 'Registrado');
  assert.strictEqual(registrado.classe, 'badge-success');
  assert.strictEqual(registrado.detalhe, '00034534810000000002-5 · 00190.00009 …');
  const erro = plano(f.linhaDaParcela({ parcela: { id: 3, numero_parcela: 3 }, tem_boleto_vivo: false, boleto: { status: 'erro', erro: 'O BB respondeu 422: Valor inválido' } }));
  assert.strictEqual(erro.podeGerar, true, 'boleto com erro pode ser gerado de novo (mesmo nosso número)');
  assert.strictEqual(erro.temPdf, false, 'boleto com erro não tem PDF');
  assert.deepStrictEqual([erro.classe, erro.rotulo, erro.detalhe], ['badge-danger', 'Erro no BB', 'O BB respondeu 422: Valor inválido']);
  const pago = plano(f.linhaDaParcela({ parcela: { id: 4 }, boleto: { status: 'pago' }, tem_boleto_vivo: true }));
  assert.strictEqual(pago.rotulo, 'Pago');
  assert.strictEqual(pago.temPdf, false, 'pago não se paga mais: sem PDF');
  assert.strictEqual(registrado.temDetalhe, true);
  assert.strictEqual(erro.temDetalhe, false, 'sem id não há o que abrir');
  assert.strictEqual(f.linhaDaParcela({ parcela: { id: 5 }, boleto: { id: 7, status: 'reservado' } }).temDetalhe, false, 'reservado ainda não passou pelo BB');

  // Fase D: baixado diz o motivo (e a parcela quitada por fora fica ocupada); prorrogado e abatimento aparecem no detalhe.
  const quitado = plano(f.linhaDaParcela({ parcela: { id: 6, numero_parcela: 1 }, tem_boleto_vivo: true, boleto: { id: 8, status: 'baixado', motivo_baixa: 'quitado_por_fora', nosso_numero: '1' } }));
  assert.deepStrictEqual([quitado.rotulo, quitado.podeGerar, quitado.temPdf, quitado.temDetalhe], ['Baixado · quitado por fora', false, false, true]);
  const reemitido = plano(f.linhaDaParcela({ parcela: { id: 6 }, tem_boleto_vivo: false, boleto: { id: 8, status: 'baixado', motivo_baixa: 'reemissao' } }));
  assert.deepStrictEqual([reemitido.rotulo, reemitido.podeGerar], ['Baixado · reemissão', true]);
  const prorrogado = plano(f.linhaDaParcela({ parcela: { id: 2, data_vencimento: '2027-02-17', valor: 1000 }, tem_boleto_vivo: true,
    boleto: { id: 41, status: 'registrado', nosso_numero: '00031285570000000002', nosso_numero_dv: '5', data_vencimento: '2027-03-01', valor_abatimento: '50.00' } }));
  assert.strictEqual(prorrogado.vencimento, '2027-02-17', 'a coluna mostra a parcela');
  assert.strictEqual(prorrogado.detalhe, '00031285570000000002-5 · vence 01/03/2027 · abatimento R$ 50,00');

  // Rodapé: "Gerar" só com parcela sem boleto (e cobrança pronta); "Boletos (PDF)" e "Consultar no BB" com boleto a pagar; aviso quando está tudo gerado.
  const reg = { parcela: { id: 1 }, tem_boleto_vivo: true, boleto: { id: 9, status: 'registrado' } };
  const semBol = { parcela: { id: 2 }, tem_boleto_vivo: false, boleto: null };
  assert.deepStrictEqual(plano(f.estadoDoRodape({ pode_gerar: false, parcelas: [reg, { ...reg, parcela: { id: 3 } }] })),
    { mostrarGerar: false, mostrarPdf: true, mostrarConsultar: true, titulo: 'Boletos do pedido', aviso: 'Todas as parcelas já têm boleto registrado.' });
  assert.deepStrictEqual(plano(f.estadoDoRodape({ pode_gerar: true, parcelas: [reg, semBol] })), { mostrarGerar: true, mostrarPdf: true, mostrarConsultar: true, titulo: 'Gerar boletos', aviso: '' });
  assert.deepStrictEqual(plano(f.estadoDoRodape({ pode_gerar: false, parcelas: [semBol] })), { mostrarGerar: false, mostrarPdf: false, mostrarConsultar: false, titulo: 'Gerar boletos', aviso: '' }, 'cobrança não pronta: nem gerar');
  assert.deepStrictEqual(plano(f.estadoDoRodape(null)), { mostrarGerar: false, mostrarPdf: false, mostrarConsultar: false, titulo: 'Gerar boletos', aviso: '' });
  const soQuitado = { parcela: { id: 1 }, tem_boleto_vivo: true, boleto: { id: 9, status: 'baixado', motivo_baixa: 'quitado_por_fora' } };
  assert.deepStrictEqual(plano(f.estadoDoRodape({ pode_gerar: false, parcelas: [soQuitado] })),
    { mostrarGerar: false, mostrarPdf: false, mostrarConsultar: false, titulo: 'Boletos do pedido', aviso: 'Todas as parcelas já têm boleto registrado.' });
});

test('resumoDaConsulta: o aviso depois de consultar o pedido no BB', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.resumoDaConsulta({ consultados: 2, mudaram: 1, erros: 0 })), { texto: '2 boletos consultados no BB · 1 mudou de situação.', tipo: 'success' });
  assert.deepStrictEqual(plano(f.resumoDaConsulta({ consultados: 1, mudaram: 0, erros: 1 })), { texto: '1 boleto consultado no BB · nenhuma mudança · 1 com erro.', tipo: 'error' });
  assert.deepStrictEqual(plano(f.resumoDaConsulta({ consultados: 0, mudaram: 0, erros: 0 })), { texto: 'Nenhum boleto a pagar para consultar.', tipo: 'info' });
});

test('resumoDosResultados e mensagemDeErro', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.resumoDosResultados({ registrados: 2, erros: 1, resultados: [{ ok: true }, { ok: true }, { ok: false }] })), { texto: '2 boletos registrados no BB · 1 com erro.', tipo: 'error' });
  assert.deepStrictEqual(plano(f.resumoDosResultados({ registrados: 1, erros: 0, resultados: [{ ok: true }, { ok: true, ja_existia: true }] })), { texto: '1 boleto registrado no BB · 1 já existia.', tipo: 'success' });
  assert.deepStrictEqual(plano(f.resumoDosResultados(null)), { texto: 'Nenhum boleto para gerar.', tipo: 'info' });
  assert.strictEqual(f.mensagemDeErro(403, null), 'Você não tem permissão para gerar boletos.');
  assert.strictEqual(f.mensagemDeErro(404, null), 'Pedido não encontrado.');
  assert.strictEqual(f.mensagemDeErro(409, { error: 'A cobrança não está pronta: Sem client_secret.', pendencias: ['x'] }), 'A cobrança não está pronta: Sem client_secret.');
  assert.strictEqual(f.mensagemDeErro(500, { error: 'boom' }), 'boom');
  assert.strictEqual(f.mensagemDeErro(500, null), 'Não foi possível gerar os boletos.');
});

test('HTML: overlay escondido, parcelas com caixa, pendências, botões só com texto e com a guarda escrita; não fecha clicando fora', () => {
  for (const id of ['gerarBoletosOverlay', 'gerarBoletosTitulo', 'gerarBoletosSubtitulo', 'gerarBoletosAmbiente', 'gerarBoletosCarregando', 'gerarBoletosPendencias',
    'gerarBoletosTabela', 'gerarBoletosLinhas', 'gerarBoletosMensagem', 'gerarBoletosResultado', 'voltarGerarBoletos', 'desistirGerarBoletos', 'confirmarGerarBoletos',
    'baixarBoletosPdf', 'gerarBoletosCompleto']) {
    assert.ok(HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="confirmarGerarBoletos"[^>]*data-perm="financeiro\.boleto\.emit"[^>]*class="hidden/.test(HTML), 'gerar pede financeiro.boleto.emit e nasce escondido');
  assert.ok(/id="baixarBoletosPdf"[^>]*data-perm="financeiro\.boleto\.view"[^>]*class="hidden/.test(HTML), 'PDF pede financeiro.boleto.view e nasce escondido');
  assert.ok(!/<button[^>]*>\s*<i class="fas/.test(HTML), 'botões só com texto');
  assert.ok(HTML.includes('z-[1200]') && !HTML.includes('onclick'));
  assert.ok(HTML.includes('Nada é enviado ao cliente'), 'a tela diz que nada vai para o cliente');
});

test('script: lê e grava em /api/cobranca, confirma na caixa da casa, marca só as parcelas sem boleto, sem innerHTML nem confirm()', () => {
  assert.ok(FONTE.includes('/api/cobranca/pedidos/${encodeURIComponent(ctx.pedidoId)}/boletos'));
  assert.ok(FONTE.includes("body: JSON.stringify({ parcelas: ids, nota_fiscal_id: estado?.nota_fiscal?.id ?? null })"), 'manda as parcelas marcadas e a NF-e viva');
  assert.ok(FONTE.includes('window.DialogPadrao?.confirm?.({') && FONTE.includes("confirmText: 'Gerar boletos'"));
  assert.ok(!/window\.confirm\(|showStatusConfirmDialog|innerHTML|insertAdjacentHTML/.test(FONTE));
  assert.ok(FONTE.includes('caixa.checked = l.podeGerar && Boolean(estado?.pode_gerar);') && FONTE.includes('caixa.disabled = !l.podeGerar || !estado?.pode_gerar;'));
  assert.ok(FONTE.includes('window.BotaoAcao.bind(confirmarBtn, confirmar)'), 'trava de clique duplo');
  assert.ok(FONTE.includes("document.removeEventListener('keydown', aoEsc)") && FONTE.includes("window.removeEventListener('modalFechado', aoFecharModal)"));
  assert.ok(FONTE.includes("window.dispatchEvent(new CustomEvent('boletos:gerados'") && FONTE.includes('window.carregarPedidos?.()'));
  assert.ok(FONTE.includes("window.Modal?.signalReady?.(overlayId)"));
  // Fase C: nada a gerar → o botão some (não fica verde e "desabilitado" parecendo ativo); PDF por linha e de todos.
  assert.ok(FONTE.includes("confirmarBtn.classList.toggle('hidden', !rodape.mostrarGerar);"));
  assert.ok(FONTE.includes("pdfTodosBtn?.classList.toggle('hidden', !rodape.mostrarPdf);"));
  assert.ok(FONTE.includes('window.BoletoDocumentos.gerarBoletoPdf(boletoId)') && FONTE.includes('window.BoletoDocumentos.gerarBoletosDoPedidoPdf(ctx.pedidoId)'));
  assert.ok(FONTE.includes("pdf.dataset.perm = 'financeiro.boleto.view';"));
  assert.ok(!FONTE.includes("overlay.addEventListener('click'"), 'não fecha clicando fora');
  // Fase D: o boleto abre POR CIMA (keepExisting), a lista se relê quando ele muda algo, o Esc é do modal de cima.
  assert.ok(FONTE.includes("Modal.open('modals/pedidos/boleto-detalhe.html', '../js/modals/pedido-boleto-detalhe.js', 'boletoDetalhe', true)"));
  assert.ok(FONTE.includes("ver.dataset.perm = 'financeiro.boleto.view';") && FONTE.includes("ver.textContent = 'Detalhes';"));
  assert.ok(FONTE.includes("window.addEventListener('boletos:alterados', aoAlterarBoleto)") && FONTE.includes("window.removeEventListener('boletos:alterados', aoAlterarBoleto)"));
  assert.ok(FONTE.includes("if (document.getElementById('boletoDetalheOverlay')) return;"));
  assert.ok(FONTE.includes('/api/cobranca/pedidos/${encodeURIComponent(ctx.pedidoId)}/boletos/sincronizar'));
  assert.ok(FONTE.includes('window.BotaoAcao.bind(consultarBtn, consultarNoBB)'));
  assert.ok(/id="consultarBoletosBB"[^>]*data-perm="financeiro\.boleto\.view"[^>]*class="hidden/.test(HTML), 'consultar pede financeiro.boleto.view e nasce escondido');
  assert.ok(HTML.includes('<span id="gerarBoletosTituloTexto">Gerar boletos</span>'));
});

test('Visualizar pedido: "Boletos" abre a lista quando está tudo gerado, para quem só vê, e no pedido cancelado', () => {
  const VISUALIZAR = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'pedido-visualizar.js'), 'utf8');
  const VIS_HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'pedidos', 'visualizar.html'), 'utf8');
  assert.ok(/id="visualizarPedidoBoletos"[^>]*data-perm="financeiro\.boleto\.view"[^>]*class="hidden/.test(VIS_HTML));
  assert.ok(VISUALIZAR.includes('if (botao && falta && !cancelado && podeGerar && pedidoJaSaiu(pedido) && pagaComBoleto(pedido)) ligar(botao);') && VISUALIZAR.includes('else if (lista && temBoleto) ligar(lista);'), 'gerar só depois que o pedido saiu, e só em pedido pago com boleto');
  assert.ok(VISUALIZAR.includes("window.Permissoes.pode('financeiro.boleto.emit')"));
  assert.ok(VISUALIZAR.includes("const MOTIVO = { quitado_por_fora: 'quitado por fora'"), 'a tag do baixado diz o motivo');
});

test('utilitário BoletoDocumentos: PDF de um boleto e de todos do pedido, em retrato, pelo Electron; carregado no menu', () => {
  const UTIL = fs.readFileSync(path.join(RAIZ, 'js', 'utils', 'boleto-documentos.js'), 'utf8');
  const MENU = fs.readFileSync(path.join(RAIZ, 'html', 'menu.html'), 'utf8');
  assert.ok(UTIL.includes('/api/cobranca/boletos/${encodeURIComponent(boletoId)}/documento'));
  assert.ok(UTIL.includes('/api/cobranca/pedidos/${encodeURIComponent(pedidoId)}/boletos/documento'));
  assert.ok(UTIL.includes('salvarHtmlComoPdf?.({ html: corpo.html, nomeSugerido: corpo.nome, titulo, retrato: true })'));
  assert.ok(UTIL.includes('window.BoletoDocumentos = { gerarBoletoPdf, gerarBoletosDoPedidoPdf };'));
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(UTIL));
  assert.ok(MENU.indexOf('js/utils/boleto-documentos.js') > MENU.indexOf('js/utils/nfe-documentos.js'), 'o menu carrega o utilitário');
});
