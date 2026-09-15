/**
 * Modal "Emitir NF-e e enviar" (src/js/modals/pedido-emitir-nfe.js e
 * src/html/modals/pedidos/emitir-nfe.html) — etapa 4 da NF-e.
 *
 * O ✓ de um pedido em produção passa a abrir este modal em vez da pergunta
 * "alterar para Enviado?": a nota é emitida e SÓ então a situação muda. As
 * funções puras (qual nota conta, o corpo do POST, as validações dos campos,
 * a ação principal e as mensagens) são recortadas e executadas sem DOM; o
 * resto prende a anatomia do HTML e a ligação em pedidos.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'pedido-emitir-nfe.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'pedidos', 'emitir-nfe.html'), 'utf8');
const PEDIDOS = fs.readFileSync(path.join(RAIZ, 'js', 'pedidos.js'), 'utf8');

function puras() {
  const inicio = FONTE.indexOf('const STATUS_VIVOS');
  const fim = FONTE.indexOf('// fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  const trecho = FONTE.slice(inicio, fim);
  const contexto = vm.createContext({});
  return vm.runInContext(`${trecho}\n({ notaQueVale, ultimaNota, diaDoTexto, textoDaNota, lerNumero, corpoDaEmissao, validarCampos, classificarPendencias, rotuloAmbiente, acaoPrincipal, mensagemDeErro })`, contexto);
}
const plano = v => JSON.parse(JSON.stringify(v));

test('notaQueVale: a mais nova entre autorizada/processando/enviando; rejeitada não conta, mas é a "última"', () => {
  const f = puras();
  const notas = [
    { id: 1, status_fiscal: 'rejeitada' }, { id: 3, status_fiscal: 'autorizada' }, { id: 2, status_fiscal: 'processando' }
  ];
  assert.strictEqual(f.notaQueVale(notas).id, 3);
  assert.strictEqual(f.notaQueVale([{ id: 1, status_fiscal: 'rejeitada' }, { id: 2, status_fiscal: 'erro_tecnico' }]), null);
  assert.strictEqual(f.notaQueVale(null), null);
  assert.strictEqual(f.ultimaNota([{ id: 1, status_fiscal: 'rejeitada' }, { id: 5, status_fiscal: 'cancelada' }]).id, 5);
});

test('textoDaNota: número, situação, data, protocolo, chave e o motivo de uma rejeição', () => {
  const f = puras();
  assert.strictEqual(f.textoDaNota({ serie: 1, numero: 2, status_fiscal: 'autorizada', data_autorizacao: '2026-09-15T15:10:01-03:00', protocolo: '131', chave_acesso: '3126', ambiente: 'homologacao' }),
    'NF-e série 1 nº 2 — autorizada em 15/09/2026 (homologação, sem valor fiscal) · protocolo 131 · chave 3126');
  assert.strictEqual(f.textoDaNota({ serie: 1, numero: 3, status_fiscal: 'rejeitada', codigo_status_sefaz: '778', motivo_sefaz: 'NCM inexistente', ambiente: 'producao' }),
    'NF-e série 1 nº 3 — rejeitada · motivo: 778 — NCM inexistente');
  assert.strictEqual(f.textoDaNota({ serie: 1, numero: 4, status_fiscal: 'processando', ambiente: 'producao', chave_acesso: 'X' }), 'NF-e série 1 nº 4 — em processamento na SEFAZ · chave X');
  assert.strictEqual(f.textoDaNota(null), '');
  assert.strictEqual(f.diaDoTexto('2026-09-15'), '15/09/2026');
  assert.strictEqual(f.diaDoTexto(''), '');
});

test('lerNumero e corpoDaEmissao: pt-BR ou ponto, vazio é null, lixo é NaN; o corpo tem transporte, pagamento e informações', () => {
  const f = puras();
  assert.strictEqual(f.lerNumero('1.234,5'), 1234.5);
  assert.strictEqual(f.lerNumero('12.5'), 12.5);
  assert.strictEqual(f.lerNumero(' 3 '), 3);
  assert.strictEqual(f.lerNumero(''), null);
  assert.ok(Number.isNaN(f.lerNumero('abc')));
  assert.deepStrictEqual(plano(f.corpoDaEmissao({
    modalidade_frete: '1', transportadora: ' Transp XYZ ', volumes_quantidade: '2', volumes_especie: 'Caixa', peso_bruto: '12,5', peso_liquido: '', tPag: '17', informacoes_complementares: ' Obra 12 '
  })), {
    transporte: { modalidade_frete: 1, transportadora_nome: 'Transp XYZ', volumes_quantidade: 2, volumes_especie: 'Caixa', peso_bruto: 12.5, peso_liquido: null },
    pagamento: { tPag: '17' },
    informacoes_complementares: 'Obra 12'
  });
  assert.strictEqual(f.corpoDaEmissao({ tPag: '1' }).pagamento.tPag, '01');
  assert.strictEqual(f.corpoDaEmissao({}).transporte.modalidade_frete, 9);
});

test('validarCampos: números inválidos, volumes sem espécie, volumes quebrados e "sem frete" com volumes', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.validarCampos({ modalidade_frete: '4', volumes_quantidade: '2', volumes_especie: 'Caixa', peso_bruto: '10', peso_liquido: '9,5' })), []);
  assert.deepStrictEqual(plano(f.validarCampos({ modalidade_frete: '4' })), [], 'tudo vazio é válido');
  assert.match(f.validarCampos({ modalidade_frete: '4', volumes_quantidade: 'x' }).join(' '), /Volumes: informe um número válido/);
  assert.match(f.validarCampos({ modalidade_frete: '4', volumes_quantidade: '2' }).join(' '), /espécie dos volumes/);
  assert.match(f.validarCampos({ modalidade_frete: '4', volumes_quantidade: '1,5', volumes_especie: 'Caixa' }).join(' '), /número inteiro/);
  assert.match(f.validarCampos({ modalidade_frete: '9', volumes_quantidade: '2', volumes_especie: 'Caixa' }).join(' '), /Sem frete \(9\) não leva volumes/);
  assert.match(f.validarCampos({ modalidade_frete: '4', peso_bruto: '-1' }).join(' '), /Peso bruto/);
});

test('acaoPrincipal, classificarPendencias, rotuloAmbiente e mensagemDeErro', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.acaoPrincipal({ pronto: true, notaViva: null })), { acao: 'emitir', rotulo: 'Emitir NF-e e enviar', consultar: false, bloqueada: false });
  assert.strictEqual(f.acaoPrincipal({ pronto: false, notaViva: null }).bloqueada, true);
  assert.deepStrictEqual(plano(f.acaoPrincipal({ pronto: true, notaViva: { status_fiscal: 'autorizada' } })), { acao: 'marcar', rotulo: 'Marcar como Enviado', consultar: false });
  assert.deepStrictEqual(plano(f.acaoPrincipal({ pronto: true, notaViva: { status_fiscal: 'processando' } })), { acao: 'aguardar', rotulo: 'Aguardando a SEFAZ', consultar: true });

  const c = f.classificarPendencias([{ chave: 'a' }, { chave: 'b', automatico: true }]);
  assert.deepStrictEqual(plano(c.bloqueiam), [{ chave: 'a' }]);
  assert.deepStrictEqual(plano(c.automaticas), [{ chave: 'b', automatico: true }]);
  assert.deepStrictEqual(plano(f.classificarPendencias(undefined)), { bloqueiam: [], automaticas: [] });

  assert.deepStrictEqual(plano(f.rotuloAmbiente('producao')), { texto: 'Produção', classe: 'badge-success' });
  assert.strictEqual(f.rotuloAmbiente('homologacao').classe, 'badge-warning');

  assert.match(f.mensagemDeErro(403, null), /permissão para emitir/);
  assert.match(f.mensagemDeErro(403, null, 'enviar'), /permissão para marcar/);
  assert.match(f.mensagemDeErro(409, { code: 'JA_ENVIADO' }, 'enviar'), /já estava enviado/);
  assert.strictEqual(f.mensagemDeErro(422, { error: 'SEFAZ 778: x', sefaz: { cStat: '778', xMotivo: 'NCM inexistente' } }),
    'A SEFAZ rejeitou a nota (778): NCM inexistente. Corrija e emita de novo — o número será reaproveitado.');
  assert.strictEqual(f.mensagemDeErro(422, { error: 'O pedido ainda não pode ser faturado.' }), 'O pedido ainda não pode ser faturado.');
  assert.match(f.mensagemDeErro(504, null), /Consultar na SEFAZ/);
  assert.strictEqual(f.mensagemDeErro(500, null), 'Não foi possível emitir a NF-e.');
});

test('HTML: conferência, campos do embarque, pendências, botões com as guardas escritas e sem fechar clicando fora', () => {
  for (const id of ['emitirNfePedidoOverlay', 'emitirNfeAmbiente', 'emitirNfeSubtitulo', 'emitirNfeCliente', 'emitirNfeValor', 'emitirNfeParcelas', 'emitirNfeItens',
    'emitirNfePendencias', 'emitirNfePendenciasLista', 'emitirNfeNotaExistente', 'emitirNfeConsultar', 'emitirNfeFrete', 'emitirNfeTransportadora', 'emitirNfeVolumes',
    'emitirNfeEspecie', 'emitirNfePesoBruto', 'emitirNfePesoLiquido', 'emitirNfePagamento', 'emitirNfeInformacoes', 'emitirNfeMensagem',
    'voltarEmitirNfe', 'cancelarEmitirNfe', 'enviarSemNfe', 'emitirNfeConfirmar']) {
    assert.ok(HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="emitirNfeConfirmar"[^>]*data-perm="financeiro\.nfe\.emit"/.test(HTML), 'emitir pede financeiro.nfe.emit');
  assert.ok(/id="enviarSemNfe"[^>]*data-perm="ped\.status\.ship"/.test(HTML), 'enviar sem nota pede ped.status.ship');
  assert.strictEqual((HTML.match(/data-emitir-nfe-campos/g) || []).length, 2, 'transporte e pagamento somem quando já há nota');
  for (const v of ['"0"', '"1"', '"2"', '"3"', '"4"', '"9"']) assert.ok(HTML.includes(`<option value=${v}>`), `modalidade ${v}`);
  for (const v of ['"15"', '"17"', '"01"', '"03"', '"99"']) assert.ok(HTML.includes(`<option value=${v}>`), `tPag ${v}`);
  assert.ok(HTML.includes('z-[1200]'), 'mesmo plano dos outros modais de pedido');
  assert.ok(!HTML.includes('onclick'), 'sem handler inline');
});

test('script: carrega a prontidão, emite antes de mudar a situação, solta os ouvintes e não usa innerHTML', () => {
  assert.ok(FONTE.includes('/api/fiscal/pedidos/${encodeURIComponent(pedidoId)}/prontidao'));
  assert.ok(FONTE.includes('/api/fiscal/pedidos/${encodeURIComponent(pedidoId)}/emitir'));
  assert.ok(FONTE.includes("body: JSON.stringify({ status: 'Enviado' })"));
  assert.ok(FONTE.indexOf('async function emitir()') < FONTE.indexOf('if (corpo?.autorizada) return marcarEnviado(corpo.nota);'), 'só marca enviado com a nota autorizada');
  assert.ok(FONTE.includes('/api/fiscal/notas/${encodeURIComponent(viva.id)}/sincronizar'));
  assert.ok(FONTE.includes("window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }))"));
  assert.ok(FONTE.includes("document.removeEventListener('keydown', aoEsc)") && FONTE.includes("window.removeEventListener('modalFechado', aoFecharModal)"));
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(FONTE), 'linhas e listas montadas por createElement/textContent');
  assert.ok(FONTE.includes('window.BotaoAcao.bind(confirmarBtn, principal)'), 'trava de clique duplo');
  assert.ok(FONTE.includes('window.showStatusConfirmDialog') && FONTE.includes('SEM emitir a NF-e'), 'enviar sem nota pede confirmação');
  assert.ok(FONTE.includes('window.carregarPedidos?.()'), 'a lista é relida depois do envio');
  assert.ok(!FONTE.includes("overlay.addEventListener('click'"), 'não fecha clicando fora');
});

test('pedidos.js: o ✓ de Produção → Enviado abre o modal da NF-e; Enviado → Entregue continua na pergunta', () => {
  assert.ok(PEDIDOS.includes("if (nextStatus === 'Enviado') {") && PEDIDOS.includes('abrirEmitirNfePedido(p);'));
  assert.ok(PEDIDOS.indexOf("if (nextStatus === 'Enviado') {") < PEDIDOS.indexOf('showStatusConfirmDialog(`Deseja alterar o status para "${nextStatus}"?`'), 'a NF-e vem antes da pergunta genérica');
  assert.ok(PEDIDOS.includes("openPedidoModal('modals/pedidos/emitir-nfe.html', '../js/modals/pedido-emitir-nfe.js', 'emitirNfePedido')"));
  assert.ok(PEDIDOS.includes('window.emitirNfeContext = { pedidoId: p.id, numero: p.numero, cliente: obterNomeCliente(p.cliente_id) }'));
});
