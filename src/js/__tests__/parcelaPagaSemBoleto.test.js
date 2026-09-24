/**
 * Pedidos do dono de 24/09/2026 (3ª rodada):
 *   - parcela já PAGA (Pix, cartão…) não recebe boleto — gerado, importado ou
 *     de fora — até o pagamento ser estornado;
 *   - o pagamento lançado à mão se EDITA (não só se estorna);
 *   - a tabela de parcelas do Visualizar tem a coluna VENCIMENTO, com a de
 *     parcela encurtada para "PRC.".
 * O backend está em backend/cobranca/{boletos,importacao,recebimentos}.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const GERAR = ler('js', 'modals', 'pedido-gerar-boletos.js');
const EXTERNOS = ler('js', 'modals', 'pedido-dados-externos.js');
const IMPORTAR = ler('js', 'modals', 'pedido-importar-boletos.js');
const PAGAMENTOS = ler('js', 'modals', 'pedido-pagamentos-parcelas.js');
const VISUALIZAR = ler('js', 'modals', 'pedido-visualizar.js');
const plano = v => JSON.parse(JSON.stringify(v));

function bloco(fonte, inicio, fim, nomes) {
  const i = fonte.indexOf(inicio);
  const f = fonte.indexOf(fim);
  assert.ok(i !== -1 && f > i, 'bloco de funções puras não encontrado');
  return vm.runInContext(`${fonte.slice(i, f)}\n({ ${nomes.join(', ')} })`, vm.createContext({}));
}

test('gerar boletos: a parcela paga aparece como "Paga · Pix" e não se marca', () => {
  const f = bloco(GERAR, 'const ROTULO_STATUS', '/** O aviso depois de gerar', ['linhaDaParcela']);
  const paga = plano(f.linhaDaParcela({ parcela: { id: 1, numero_parcela: 1, data_vencimento: '2026-08-20', valor: 3326.51 }, boleto: null, tem_boleto_vivo: false, recebimento: { forma: 'Pix', data: '2026-08-20' } }));
  assert.deepStrictEqual([paga.podeGerar, paga.classe, paga.rotulo], [false, 'badge-success', 'Paga · Pix']);
  assert.match(paga.detalhe, /em 20\/08\/2026 · para gerar boleto, estorne o pagamento em "Pagamentos"/);
  assert.strictEqual(f.linhaDaParcela({ parcela: { id: 2 }, boleto: null, tem_boleto_vivo: false, recebimento: null }).podeGerar, true);
});

test('boletos de fora e importar: a parcela paga não recebe linha nem é escolhida', () => {
  const f = bloco(EXTERNOS, 'const TAMANHO_MAXIMO_DO_XML', '// ------------------------------------------------- fim das funções puras', ['estadoDaParcela']);
  assert.deepStrictEqual(plano(f.estadoDaParcela({ recebimento: { forma: 'Pix', data: '2026-08-20' } })), { tipo: 'paga', texto: 'Paga · Pix · 20/08/2026' });
  assert.strictEqual(f.estadoDaParcela({ recebimento: { forma: 'Boleto' }, tem_boleto_vivo: true, boleto: { status: 'pago' } }).tipo, 'bb', 'paga pelo boleto: é o boleto que aparece');
  assert.ok(EXTERNOS.includes("} else if (estado.tipo === 'paga') {"), 'no lugar do campo, a tag e o aviso');
  assert.ok(IMPORTAR.includes('const travada = Boolean(parcela.ocupada || parcela.paga);') && IMPORTAR.includes("' (paga)'"));
  assert.ok(VISUALIZAR.includes('const falta = estado.parcelas.some(l => !l?.tem_boleto_vivo && !l?.boleto_externo && !l?.recebimento);'), '"Gerar boletos" não conta a paga como faltando');
});

test('pagamentos: o lançado à mão ganha "Editar" (mesmo formulário, PUT), além de "Estornar"', () => {
  const f = bloco(PAGAMENTOS, 'const MESES', '// ------------------------------------------------- fim das funções puras', ['acoesDaParcela']);
  const todas = { podeRegistrar: true, podeEstornar: true };
  assert.deepStrictEqual(plano(f.acoesDaParcela({ situacao: 'paga', recebimento: { pode_editar: true, pode_estornar: true } }, todas)), ['editar', 'estornar']);
  assert.deepStrictEqual(plano(f.acoesDaParcela({ situacao: 'paga', recebimento: { pode_editar: false, pode_estornar: true } }, todas)), ['estornar'], 'quitação por fora: só estorna');
  assert.deepStrictEqual(plano(f.acoesDaParcela({ situacao: 'paga', recebimento: { pode_editar: true, pode_estornar: true } }, { podeRegistrar: false, podeEstornar: true })), ['estornar'], 'editar pede a permissão de registrar');
  assert.ok(PAGAMENTOS.includes("fetchApi(`/api/cobranca/recebimentos/${encodeURIComponent(r.id)}`, comoJson({ data_recebimento: data, valor_recebido: valor, forma, observacao }, 'PUT'))"));
  assert.ok(PAGAMENTOS.includes("el('pagamentosParcelasRegistrar').textContent = editando ? 'Salvar alteração' : 'Registrar pagamento';"));
  assert.ok(PAGAMENTOS.includes('() => abrirRegistro(p, p.recebimento)'));
});

test('Visualizar: parcelas com a coluna VENCIMENTO e a de parcela como "PRC." (4 caracteres), sem rolagem de lado', () => {
  assert.ok(VISUALIZAR.includes('style="width: 4ch" title="Parcela">PRC.</th>'));
  assert.ok(VISUALIZAR.includes('uppercase tracking-wider">VENCIMENTO</th>'));
  assert.ok(VISUALIZAR.includes("const venceEm = vencimento ? formatarDia(vencimento) : '—';"));
  const ordem = ['PRC.', '>VALOR<', '>PRAZO<', '>VENCIMENTO<'].map(t => VISUALIZAR.indexOf(t));
  assert.deepStrictEqual([...ordem].sort((a, b) => a - b), ordem, 'PRC., VALOR, PRAZO, VENCIMENTO (e o BOLETO entra depois)');
});
