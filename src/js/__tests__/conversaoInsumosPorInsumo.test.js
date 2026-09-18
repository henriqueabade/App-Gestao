/**
 * Revisar conversão (src/js/modals/orcamento-converter.js): a conta dos
 * insumos é por INSUMO, somando peças e etapas.
 *
 * A chave antiga (insumo + etapa) comparava o estoque INTEIRO com a parte de
 * cada etapa: MDF com 10 em estoque, 6 na Marcenaria e 6 no Acabamento dava
 * duas linhas "sobra 4" — e o botão Converter liberava faltando 2.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FONTE = fs.readFileSync(path.join(__dirname, '..', 'modals', 'orcamento-converter.js'), 'utf8');
const FONTE_SUBSTITUIR = fs.readFileSync(path.join(__dirname, '..', 'modals', 'orcamento-substituir-peca.js'), 'utf8');

/** Carrega o script sem o modal na tela: só a conta pura fica exposta. */
function carregar() {
    const contexto = { window: {}, document: { getElementById: () => null }, Number, String, Math, Map, Infinity };
    contexto.globalThis = contexto;
    vm.createContext(contexto);
    vm.runInContext(FONTE, contexto);
    return contexto.window.ConversaoInsumos;
}

const PECAS = [
    { produto_id: 1, faltantes: [
        { nome: 'MDF 18mm', un: 'm²', etapa: 'Marcenaria', necessario: 6, ordem: 1 },
        { nome: 'MDF 18mm', un: 'm²', etapa: 'Acabamento', necessario: 6, ordem: 4 },
        { nome: 'Verniz', un: 'l', etapa: 'Acabamento', necessario: 1, ordem: 5 }
    ] },
    { produto_id: 2, faltantes: [
        { nome: 'MDF 18mm', un: 'm²', etapa: 'Marcenaria', necessario: 3, ordem: 1 }
    ] }
];

test('o mesmo insumo em duas etapas soma numa linha só (e o estoque é comparado com o total)', () => {
    const { necessidadePorInsumo, saldoDoInsumo } = carregar();
    const total = necessidadePorInsumo(PECAS);
    const mdf = total.get('MDF 18mm');
    assert.strictEqual(mdf.necessario, 15, '6 + 6 da peça 1 e 3 da peça 2');
    assert.deepStrictEqual(Array.from(mdf.etapas), ['Marcenaria', 'Acabamento']);
    assert.strictEqual(total.size, 2, 'uma linha por insumo, não por etapa');
    // 10 em estoque para 15 de necessidade: faltam 5 (a chave antiga dizia "sobra 4").
    assert.strictEqual(saldoDoInsumo({ quantidade: 10 }, mdf.necessario), -5);
    assert.strictEqual(saldoDoInsumo({ quantidade: 0, infinito: true }, 999), Infinity);
});

test('a visão por peça mostra a necessidade dela, mas o saldo continua sendo o do pedido inteiro', () => {
    const { necessidadePorInsumo } = carregar();
    const daPeca2 = necessidadePorInsumo(PECAS, { pecaId: 2 });
    assert.strictEqual(daPeca2.get('MDF 18mm').necessario, 3, 'o "Necessário" é o desta peça');
    assert.ok(!daPeca2.has('Verniz'), 'só os insumos da peça');
    // A grade usa o total do pedido para o saldo (e mostra "de N no pedido").
    assert.match(FONTE, /const necessarioTotal = totalDoPedido\.get\(String\(v\.nome\)\)\?\.necessario \?\? v\.necessario;/);
    assert.match(FONTE, /const saldo = saldoDoInsumo\(stock, necessarioTotal\);/);
    assert.match(FONTE, /no pedido\)<\/span>/);
    // E a validação que libera "Converter" usa a mesma conta.
    assert.match(FONTE, /for \(const v of necessidadePorInsumo\(rows\)\.values\(\)\)/);
});

test('redesenhar as tabelas não leva a rolagem para o topo; o "−" do Substituir tira uma unidade', () => {
    assert.match(FONTE, /const rolagemDasPecas = guardarRolagem\(pecasBody\);[\s\S]*restaurarRolagem\(rolagemDasPecas\);/);
    assert.match(FONTE, /const rolagemDosInsumos = guardarRolagem\(insumosBody\);[\s\S]*restaurarRolagem\(rolagemDosInsumos\);/);
    assert.match(FONTE_SUBSTITUIR, /updateStagingQuantityForVariant\(variant, currentStaging - 1,/);
    assert.match(FONTE_SUBSTITUIR, /setCommittedQuantity\(variant\.key, confirmada - 1\);/);
    assert.doesNotMatch(FONTE_SUBSTITUIR, /setCommittedQuantity\(variant\.key, 0\);/, 'o − não zera mais a confirmada');
});
