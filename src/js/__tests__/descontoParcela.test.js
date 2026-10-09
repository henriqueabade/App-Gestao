/**
 * "Desconto na parcela" nos Detalhes da parcela (dono, 09/10/2026): a volta
 * do ajuste antigo de parcela, agora mudando o valor da parcela livre e o
 * total do pedido (backend/financeiro/descontoParcela.js).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..');
const ler = rel => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

test('o botão fica no rodapé dos Detalhes da parcela, com a permissão do ajuste', () => {
  const html = ler('html/modals/financeiro/detalhes-parcela.html');
  const botao = html.match(/<button id="finParcelaDesconto"[^>]*>Desconto na parcela<\/button>/);
  assert.ok(botao, 'botão "Desconto na parcela"');
  assert.match(botao[0], /data-perm="financeiro\.ajuste\.registrar"/);
  assert.match(botao[0], /class="btn-primary ctl-botao text-white min-w-\[140px\] hidden"/, 'nasce escondido; acende pela resposta da parcela');
  assert.ok(html.indexOf('finParcelaDesconto') < html.indexOf('finParcelaRegistrarAjuste'), 'antes do "Registrar ajuste"');
});

test('a tela: aceso só quando a API diz que pode; apagado, o clique explica; a caixa grava pela rota nova', () => {
  const js = ler('js/modals/financeiro-modais.js');
  const detalhes = js.slice(js.indexOf('function montarDetalhesParcela'), js.indexOf('function montarDetalhesPedido'));
  assert.ok(detalhes.includes("const desconto = d.desconto_na_parcela || null;"));
  assert.ok(detalhes.includes("descontoBtn.setAttribute('aria-disabled', desconto?.pode ? 'false' : 'true');"));
  assert.ok(detalhes.includes("mostrarMensagem('finParcelaMensagem', permitido?.motivo || 'Esta parcela não aceita desconto.');"));
  assert.ok(detalhes.includes('/desconto`;'), 'POST /api/financeiro/parcelas/:pedido/:numero/desconto');
  assert.ok(detalhes.includes('avisarAlteracao();'), 'a parcela e as listas se releem');
  const caixa = js.slice(js.indexOf('function pedirDescontoNaParcela'), js.indexOf('const nomeDaPeca'));
  assert.ok(caixa.includes('const MINIMO = 10;'), 'a mesma justificativa mínima do Pagamento do pedido');
  assert.ok(caixa.includes("['Parcela', `${formatarMoeda(valor)} → ${formatarMoeda(depois)}`, true]"), 'o antes e depois da parcela');
  assert.ok(caixa.includes("criar('button', 'btn-primary ctl-botao text-white', 'Dar desconto')"));
  assert.ok(caixa.includes("criar('button', 'btn-neutral ctl-botao text-white', 'Voltar')"));
  // Erro da API: a caixa continua aberta com o recado.
  assert.match(caixa, /catch \(e\) \{\s*\n\s*erro\(textoDoErro\(e,/);
});

test('a rota existe no Financeiro, com a permissão do ajuste', () => {
  const ctrl = ler('../backend/financeiroController.js');
  assert.match(ctrl, /router\.post\('\/parcelas\/:pedidoId\/:numero\/desconto', exigirPermissao\(REGISTRAR_AJUSTE\)/);
  assert.ok(ler('../backend/financeiro/auditoria.js').includes("desconto_parcela: 'Desconto na parcela'"));
});
