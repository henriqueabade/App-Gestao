/**
 * Modal "Importar boletos do BB" (src/js/modals/pedido-importar-boletos.js e
 * src/html/modals/pedidos/importar-boletos.html).
 *
 * As funções puras (o que cada linha mostra na coluna Parcela, o que vai para
 * o backend e o resumo do que entrou) são recortadas e executadas sem DOM; o
 * resto prende a anatomia do HTML e as duas portas de entrada — Configuração
 * de cobrança e Visualizar pedido.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = relativo => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
const FONTE = ler('js/modals/pedido-importar-boletos.js');
const HTML = ler('html/modals/pedidos/importar-boletos.html');
const VISUALIZAR = ler('js/modals/pedido-visualizar.js');
const VIS_HTML = ler('html/modals/pedidos/visualizar.html');
const FIN_MODAIS = ler('js/modals/financeiro-modais.js');
const FIN_HTML = ler('html/modals/financeiro/configuracao-cobranca.html');

function puras() {
  const inicio = FONTE.indexOf('function diaCurto');
  const fim = FONTE.indexOf('// fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  const contexto = vm.createContext({});
  return vm.runInContext(
    `${FONTE.slice(inicio, fim)}\n({ diaCurto, moeda, nossoNumeroLegivel, documentoLegivel, textoDaParcela, marcadosDeSaida, textoDoResumo, escolhidosParaEnviar, resumoDaImportacao, mensagemDeErro })`,
    contexto
  );
}

const LINHA = {
  nosso_numero: '00034534810000000393', seu_numero: 'PED120P1', valor: 1500, vencimento: '2026-10-15',
  situacao_texto: 'NORMAL', pagador_nome: 'MAG CONFECCOES LTDA', pagador_documento: '98765432000110',
  ja_importado: false,
  sugestao: { parcela_id: 71, numero_parcela: 1, pedido_id: 12, pedido_numero: 'PED120', motivo: 'Seu número PED120P1.', confianca: 'alta' }
};

test('a coluna Parcela: sugestão, escolha do usuário, "sem relacionar" e o que já está no app', () => {
  const f = puras();
  const sugerida = f.textoDaParcela(LINHA, undefined);
  assert.strictEqual(sugerida.texto, 'PED120 · parcela 1 (sugerida)');
  assert.strictEqual(sugerida.classe, 'badge-info');
  assert.match(sugerida.titulo, /Seu número/);

  const escolhida = f.textoDaParcela(LINHA, { parcela_id: 81, numero_parcela: 2, pedido_id: 13, pedido_numero: 'PED121' });
  assert.strictEqual(escolhida.texto, 'PED121 · parcela 2');
  assert.strictEqual(escolhida.classe, 'badge-success');

  const conferir = f.textoDaParcela({ ...LINHA, sugestao: { ...LINHA.sugestao, confianca: 'media' } }, undefined);
  assert.strictEqual(conferir.texto, 'PED120 · parcela 1 (confira)', 'sugestão de confiança média pede conferência');
  assert.strictEqual(conferir.classe, 'badge-warning');

  assert.strictEqual(f.textoDaParcela(LINHA, { sem_parcela: true }).texto, 'sem relacionar');
  assert.strictEqual(f.textoDaParcela({ ...LINHA, sugestao: null }, undefined).texto, 'escolher');
  assert.strictEqual(f.textoDaParcela({ ...LINHA, ja_importado: true, boleto_status: 'pago' }, undefined).texto, 'já importado (pago)');
});

test('a busca já entrega marcado o que o app casou com segurança', () => {
  const f = puras();
  const linhas = [
    { ...LINHA, nosso_numero: 'A' },
    { ...LINHA, nosso_numero: 'B', sugestao: { ...LINHA.sugestao, confianca: 'media' } },
    { ...LINHA, nosso_numero: 'C', sugestao: null },
    { ...LINHA, nosso_numero: 'D', ja_importado: true },
    { ...LINHA, nosso_numero: 'E', sugestao: { ...LINHA.sugestao, parcela_id: null } }
  ];
  const marcados = f.marcadosDeSaida(linhas);
  assert.deepStrictEqual([...marcados], ['A'], 'só a sugestão de confiança alta, e nunca o que já está no app');

  // O que vem marcado já sai com a parcela sugerida, sem o usuário tocar.
  const saida = f.escolhidosParaEnviar(linhas, marcados, new Map());
  assert.strictEqual(saida.length, 1);
  assert.strictEqual(saida[0].parcela_id, 71);
});

test('o resumo conta o que veio marcado, o que pede conferência e o que não casou', () => {
  const f = puras();
  const texto = f.textoDoResumo({ resumo: { total: 9, ja_importados: 1, com_sugestao: 5, certos: 3, a_conferir: 2 } });
  assert.match(texto, /9 boleto\(s\) no BB/);
  assert.match(texto, /1 já no app/);
  assert.match(texto, /3 já marcado\(s\)/);
  assert.match(texto, /2 parecido\(s\), para conferir/);
  assert.match(texto, /3 sem parcela encontrada/);
});

test('o que vai para o backend: só o marcado e ainda não importado, com a parcela que vale', () => {
  const f = puras();
  const linhas = [
    LINHA,
    { ...LINHA, nosso_numero: '00034534810000000394', seu_numero: 'PED121P1', sugestao: null },
    { ...LINHA, nosso_numero: '00034534810000000395', ja_importado: true }
  ];
  const marcados = new Set(['00034534810000000393', '00034534810000000394', '00034534810000000395']);
  const escolhas = new Map([['00034534810000000394', { sem_parcela: true }]]);

  const saida = f.escolhidosParaEnviar(linhas, marcados, escolhas);
  assert.strictEqual(saida.length, 2, 'o já importado não vai de novo');
  assert.deepStrictEqual({ ...saida[0] }, {
    nosso_numero: '00034534810000000393', pedido_id: 12, parcela_id: 71, numero_parcela: 1, pedido_numero: 'PED120'
  }, 'sem escolha, vale a sugestão');
  assert.deepStrictEqual({ ...saida[1] }, {
    nosso_numero: '00034534810000000394', pedido_id: null, parcela_id: null, numero_parcela: null, pedido_numero: null
  }, '"sem relacionar" manda tudo nulo');

  // A escolha do usuário vence a sugestão.
  const trocada = f.escolhidosParaEnviar([LINHA], new Set([LINHA.nosso_numero]), new Map([[LINHA.nosso_numero, { pedido_id: 13, parcela_id: 81, numero_parcela: 2, pedido_numero: 'PED121' }]]));
  assert.strictEqual(trocada[0].parcela_id, 81);
  assert.strictEqual(f.escolhidosParaEnviar(linhas, new Set(), escolhas).length, 0, 'nada marcado, nada enviado');
});

test('resumo da importação e os enfeites da tabela', () => {
  const f = puras();
  const ok = f.resumoDaImportacao({ importados: 2, ja_existiam: 1, erros: 0, proximo_sequencial: 500 });
  assert.match(ok.texto, /2 boletos importados · 1 já estava no app/);
  assert.match(ok.texto, /sai no 500/);
  assert.strictEqual(ok.tipo, 'ok');
  assert.strictEqual(f.resumoDaImportacao({ importados: 0, ja_existiam: 0, erros: 1 }).tipo, 'erro');
  assert.match(f.resumoDaImportacao({}).texto, /Nenhum boleto importado/);

  assert.strictEqual(f.nossoNumeroLegivel('00034534810000000393'), '000.3453481.0000000393');
  assert.strictEqual(f.nossoNumeroLegivel(''), '—');
  assert.strictEqual(f.documentoLegivel('98765432000110'), '98.765.432/0001-10');
  assert.strictEqual(f.diaCurto('2026-10-15'), '15/10/2026');
  assert.strictEqual(f.mensagemDeErro(403, null), 'Você não tem permissão para isso.');
  assert.strictEqual(f.mensagemDeErro(409, { error: 'só em produção' }), 'só em produção');
});

test('HTML: busca por situação e faixa, tabela com marcar todos, escolha da parcela e o rodapé com a guarda', () => {
  for (const id of ['importarBoletosOverlay', 'importarBoletosSituacao', 'importarBoletosDe', 'importarBoletosAte', 'importarBoletosBuscar',
    'importarBoletosTabela', 'importarBoletosLinhas', 'importarBoletosTodos', 'importarBoletosVazio', 'importarBoletosEscolha',
    'importarBoletosBusca', 'importarBoletosSemParcela', 'importarBoletosResultadoBusca', 'importarBoletosResumo',
    'importarBoletosMensagem', 'importarBoletosResultado', 'confirmarImportarBoletos', 'fecharImportarBoletos']) {
    assert.ok(HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="confirmarImportarBoletos"[^>]*data-perm="financeiro\.boleto\.emit"/.test(HTML), 'importar pede financeiro.boleto.emit');
  assert.ok(/id="importarBoletosBuscar"[^>]*data-perm="financeiro\.boleto\.view"/.test(HTML), 'buscar pede financeiro.boleto.view');
  assert.ok(HTML.includes('<option value="A">Em aberto</option>') && HTML.includes('<option value="B">Pagos e baixados</option>'));
  assert.ok(HTML.includes('z-[1200]'), 'mesmo plano dos outros modais de pedido');
  assert.ok(!HTML.includes('onclick'), 'sem handler inline');
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(FONTE), 'linhas montadas por createElement');
});

test('script: fala com as rotas da importação e avisa quem está aberto', () => {
  assert.ok(FONTE.includes('/api/cobranca/importacao/boletos?'), 'busca a lista do BB');
  assert.ok(FONTE.includes("fetchApi('/api/cobranca/importacao/boletos'"), 'importa pelo POST');
  assert.ok(FONTE.includes('/api/cobranca/importacao/parcelas?busca='), 'procura a parcela à mão');
  assert.ok(FONTE.includes("new CustomEvent('boletos:alterados'"), 'o pedido aberto embaixo se atualiza');
  assert.ok(FONTE.includes('window.DialogPadrao?.confirm'), 'importar sem parcela pede confirmação na caixa da casa');
  assert.ok(FONTE.includes("window.EstadoTrabalho?.registrarContexto"), 'o modal volta ao ser restaurado');
});

test('as duas portas: Configuração de cobrança e Visualizar pedido abrem o mesmo modal', () => {
  assert.ok(/id="finCobImportar"[^>]*data-perm="financeiro\.boleto\.view"/.test(FIN_HTML), 'botão na Configuração de cobrança');
  assert.ok(FIN_MODAIS.includes("window.Modal.openWithSpinner('modals/pedidos/importar-boletos.html', '../js/modals/pedido-importar-boletos.js', 'importarBoletos', { keepExisting: true })"), 'abre por cima da configuração, com o spinner da casa');

  assert.ok(/id="visualizarPedidoImportarBoletos"[^>]*data-perm="financeiro\.boleto\.view"[^>]*class="hidden/.test(VIS_HTML), 'botão no Visualizar nasce escondido');
  assert.ok(VISUALIZAR.includes("abrirPorCima('modals/pedidos/importar-boletos.html', '../js/modals/pedido-importar-boletos.js', 'importarBoletos')"));
  assert.ok(VISUALIZAR.includes('if (!botao || pedidoCancelado(pedido) || !pagaComBoleto(pedido)) return;'), 'só em pedido pago com boleto e não cancelado');
  assert.ok(VISUALIZAR.includes("'importarBoletos'];"), 'entra na lista de modais filhos, que fecham junto');
  assert.ok(VISUALIZAR.includes('ligarImportarBoletos(data);'));
});

test('boletos de fora: a linha reconhecida no BB avisa que entra como boleto de verdade', () => {
  const EXTERNOS = ler('js/modals/pedido-dados-externos.js');
  const inicio = EXTERNOS.indexOf('function frasedaPrevia');
  const fim = EXTERNOS.indexOf('/** A mensagem de erro que a tela mostra');
  const contexto = vm.createContext({});
  const f = vm.runInContext(
    `const diaBR = iso => String(iso).split('-').reverse().join('/');
     const moedaBR = v => 'R$ ' + Number(v).toFixed(2);
     ${EXTERNOS.slice(inicio, fim)}\n({ frasedaPrevia })`,
    contexto
  );
  const noBB = f.frasedaPrevia({ ok: true, no_bb: true, boleto: { vencimento: '2026-10-15', valor: 1500, situacao_bb: 'NORMAL' } });
  assert.strictEqual(noBB.tom, 'ok');
  assert.match(noBB.texto, /Reconhecido no Banco do Brasil/);
  assert.match(noBB.texto, /não como boleto de fora/);

  const deFora = f.frasedaPrevia({ ok: true, boleto: { banco_nome: 'Itaú', vencimento: '2026-10-15', valor: 1500 }, avisos: [] });
  assert.match(deFora.texto, /Itaú/);
  assert.ok(!/Reconhecido/.test(deFora.texto));
});
