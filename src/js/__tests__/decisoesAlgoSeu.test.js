/**
 * Respostas do dono aos avisos de "algo seu" (02/10/2026), na tela:
 *   3c  excluir prospecção, cliente, orçamento e pedido pede o motivo;
 *   7b  confirmar pagamento de comissão/produção: "Avisar no sino" quem
 *       recebeu, com o usuário de mesmo nome sugerido e escolha livre;
 *   8b  cada categoria de Configurações › Notificações esconde só os avisos
 *       dela, no sino e na janela do canto.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

test('3c: as quatro exclusões têm o campo "Motivo da exclusão" e não mandam o DELETE sem ele', () => {
  for (const [html, id] of [['html/modals/prospeccoes/excluir.html', 'excluirProspeccaoMotivo'], ['html/modals/clientes/excluir.html', 'excluirClienteMotivo']]) {
    const tela = ler(html);
    assert.match(tela, new RegExp(`<label for="${id}" class="ctl-rotulo text-gray-300">Motivo da exclusão <span class="text-\\[var\\(--color-red\\)\\]">\\*</span></label>`), html);
    assert.match(tela, new RegExp(`<textarea id="${id}" rows="3" maxlength="600"`), html);
  }
  for (const js of ['js/modals/prospeccao-excluir.js', 'js/modals/cliente-excluir.js']) {
    const codigo = ler(js);
    assert.ok(codigo.includes("showToast('Escreva o motivo da exclusão.', 'error');"), js);
    assert.ok(codigo.includes("method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo })"), js);
    assert.ok(codigo.indexOf('if (!motivo) {') < codigo.indexOf("method: 'DELETE'"), `${js}: confere antes de mandar`);
  }
  for (const js of ['js/orcamentos.js', 'js/pedidos.js']) {
    const codigo = ler(js);
    assert.ok(codigo.includes('<textarea id="excluirMotivo" rows="3" maxlength="600"'), js);
    assert.ok(codigo.includes("overlay.querySelector('#excluirMotivoErro').classList.remove('hidden');"), js);
    assert.ok(codigo.includes('cb(true, motivo);'), js);
    assert.ok(codigo.includes('async (ok, motivo) => {'), js);
    assert.ok(codigo.includes("method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo })"), js);
  }
});

test('8b: o sino liga e desliga pelo interruptor geral; as categorias só filtram (no servidor) e valem para a janela do canto', () => {
  const sino = ler('js/notifications.js');
  assert.ok(sino.includes('const ativo = () => !desligado && currentPreferences.enabled !== false;'), 'desmarcar "Vendas e pedidos" não cala mais o sino inteiro');
  assert.ok(!/const CATEGORIA = 'sales'/.test(sino));
  assert.ok(sino.includes("if (ocultas.length) endereco.searchParams.set('ocultar', ocultas.join(','));"));
  assert.ok(sino.includes('window.electronAPI?.avisosWindows?.categorias?.(currentPreferences)'));
  assert.ok(sino.includes("(ativo() && ocultasAntes !== categoriasOcultas().join(','))"), 'mudou a categoria: busca de novo');
  assert.ok(sino.includes("pagamento_feito: 'fa-money-bill-wave'"));
  const menu = ler('html/menu.html');
  assert.ok(menu.indexOf('../js/utils/categorias-aviso.js') > 0 && menu.indexOf('../js/utils/categorias-aviso.js') < menu.indexOf('../js/notifications.js'));
  const cfg = ler('html/configuracoes.html');
  assert.ok(cfg.includes('Desmarcar uma categoria esconde só os avisos dela, no sino e na janela do canto da tela. Os avisos sobre o seu próprio cadastro (acesso, senha) sempre aparecem.'));
  assert.ok(cfg.includes('Lembretes, atrasos, convites e o que mudar nas suas tarefas.'));
  assert.ok(cfg.includes('Prospecções, clientes, contatos, orçamentos e pedidos, e os comentários do histórico.'));
  assert.ok(cfg.includes('Financeiro, Cobrança e Contabilidade.'));
});

test('7b: confirmar pagamento tem "Avisar no sino" (sugestão pelo nome, outro usuário ou ninguém) e manda os avisos depois de gravar', () => {
  const html = ler('html/modals/financeiro/confirmar-pagamento.html');
  assert.match(html, /<div id="finPagamentoAvisar" class="hidden md:col-span-2 fin-benef">/);
  assert.ok(html.includes('<ul id="finPagamentoAvisarLista" class="fin-benef__lista"'));
  assert.ok(html.indexOf('finPagamentoAvisar') > html.indexOf('finPagamentoQuemRecebe'), 'logo depois de "Quem recebe"');
  const js = ler('js/modals/financeiro-modais.js');
  assert.ok(js.includes("seletor.appendChild(new Option('Não avisar', ''));"));
  assert.ok(js.includes('const sugestao = nome => (usuarios || []).find(u => semAcento(u.nome) === semAcento(nome)) || null;'), 'o de mesmo nome (sem acento) vem escolhido');
  assert.ok(js.includes("const r = await fetchApi('/api/usuarios/lista');"));
  assert.ok(js.includes('fetchApi(`/api/financeiro/rateio?competencia=${encodeURIComponent(comp)}`)'), 'produção: os colaboradores do rateio');
  assert.ok(js.includes("if (r?.pagamento?.id !== undefined) ids.push(r.pagamento.id);"));
  assert.ok(js.includes("fetchApi('/api/financeiro/pagamentos/avisos', {"));
  assert.ok(js.indexOf("fetchApi('/api/financeiro/pagamentos/avisos'") > js.indexOf("fetchApi('/api/financeiro/pagamentos', {"), 'depois de gravar os pagamentos');
  assert.ok(js.includes("window.showToast?.(`Os avisos do pagamento não foram enviados: ${semAviso}`, 'warning');"), 'aviso que falha não desfaz o pagamento');
  assert.ok(ler('css/financeiro.css').includes('.fin-avisar__item {'));
});
