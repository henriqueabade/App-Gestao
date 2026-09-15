/**
 * Modais de ação do Financeiro (src/js/modals/financeiro-modais.js e
 * src/html/modals/financeiro/*.html) — etapa visual.
 *
 * As contas de conferência mostradas nos modais são reais (parcelas da NF,
 * impacto do ajuste, saldo da produção) e ficam em funções puras: são elas
 * que o backend vai reaproveitar, então cada regra tem um caso aqui. O resto
 * prende a anatomia da casa nos seis HTML e a ligação com o módulo.
 */
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const SCRIPT = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'financeiro-modais.js'), 'utf8');
const MODULO = fs.readFileSync(path.join(RAIZ, 'js', 'financeiro.js'), 'utf8');
const PASTA_HTML = path.join(RAIZ, 'html', 'modals', 'financeiro');
const MODAIS = {
    'registrar-nf': 'finRegistrarNf',
    'registrar-recebimento': 'finRegistrarRecebimento',
    'registrar-ajuste': 'finRegistrarAjuste',
    'registrar-producao': 'finRegistrarProducao',
    'fechar-competencia': 'finFecharCompetencia',
    'relatorios': 'finRelatorios'
};

/** Carrega o script sem overlay no DOM: só as funções puras ficam expostas. */
function puro() {
    const contexto = {
        window: {},
        document: { getElementById: () => null, createElement: () => ({}) },
        console: { error() {} },
        Intl, Number, Math, String, Array, Date, Promise
    };
    contexto.globalThis = contexto;
    vm.createContext(contexto);
    vm.runInContext(SCRIPT, contexto);
    return contexto.window.FinanceiroModais;
}

const semNbsp = t => String(t).replace(/ /g, ' ');
/* Objetos criados dentro da VM são de outro contexto: deepStrictEqual os
   rejeita mesmo iguais. O JSON os traz para cá. */
const plano = v => JSON.parse(JSON.stringify(v));

test('parcelas da NF: partes iguais em centavos, sobra um centavo por parcela a partir da primeira', () => {
    const f = puro();
    const tres = plano(f.calcularParcelas(5193.88, [30, 60, 90], '2026-09-14'));
    assert.deepStrictEqual(tres.map(p => p.valor), [1731.30, 1731.29, 1731.29]);
    assert.deepStrictEqual(tres.map(p => p.vencimento), ['2026-10-14', '2026-11-13', '2026-12-13']);
    assert.deepStrictEqual(tres.map(p => `${p.numero}/${p.total}`), ['1/3', '2/3', '3/3']);

    const duasSobras = plano(f.calcularParcelas(10471.64, [30, 60, 90], '2026-09-14'));
    assert.deepStrictEqual(duasSobras.map(p => p.valor), [3490.55, 3490.55, 3490.54]);

    const vista = plano(f.calcularParcelas(2700.53, [0], '2026-09-12'));
    assert.deepStrictEqual(vista, [{ numero: 1, total: 1, prazo: 0, vencimento: '2026-09-12', valor: 2700.53 }]);

    assert.deepStrictEqual(plano(f.calcularParcelas(0, [30], '2026-09-14')), []);
    assert.deepStrictEqual(plano(f.calcularParcelas('abc', [30], '2026-09-14')), []);
});

test('somar dias vira o mês e o ano sem passar pelo relógio local', () => {
    const f = puro();
    assert.strictEqual(f.somarDias('2026-12-31', 30), '2027-01-30');
    assert.strictEqual(f.somarDias('2026-02-28', 1), '2026-03-01');
    assert.strictEqual(f.somarDias('2026-10-15T00:00:00.000Z', 0), '2026-10-15');
    assert.strictEqual(f.somarDias('', 10), null);
    assert.strictEqual(f.formatarData('2026-10-14'), '14/10/2026');
    assert.strictEqual(f.competenciaDe('2026-09-20'), 'Setembro/2026');
    assert.strictEqual(f.rotuloCompetencia('2026-09'), 'Setembro / 2026');
});

test('leitura de dinheiro aceita os formatos que o usuário digita', () => {
    const f = puro();
    assert.strictEqual(f.lerMoeda('R$ 1.234,56'), 1234.56);
    assert.strictEqual(f.lerMoeda('1234,56'), 1234.56);
    assert.strictEqual(f.lerMoeda('1234.56'), 1234.56);
    assert.strictEqual(f.lerMoeda('17.560'), 17560);
    assert.strictEqual(f.lerMoeda(''), null);
    assert.strictEqual(f.lerMoeda('abc'), null);
    assert.strictEqual(semNbsp(f.formatarMoeda(-840)), '- R$ 840,00');
    assert.strictEqual(f.formatarMoeda(null), '—');
    assert.deepStrictEqual(plano(f.lerPrazos('30/60/90')), [30, 60, 90]);
    assert.deepStrictEqual(plano(f.lerPrazos('0')), [0]);
    assert.strictEqual(f.lerPrazos(''), null);
});

test('impacto do ajuste: novo líquido e comissão recalculada, como no exemplo da descrição', () => {
    const f = puro();
    const i = plano(f.impactoDoAjuste(20000, -1000, 2000));
    assert.deepStrictEqual(i, { original: 20000, anteriores: -1000, novo: -2000, liquido: 17000, cms: 1700, royalty: 1700 });
    assert.strictEqual(f.impactoDoAjuste(100, 0, 150).liquido, -50, 'ajuste maior que a parcela fica negativo para a tela avisar');
});

test('status após registro de produção segue o saldo do item', () => {
    const f = puro();
    assert.deepStrictEqual(plano(f.statusAposRegistro(10, 6, 4)), { acumulado: 10, restante: 0, status: 'Totalmente finalizado', excede: false });
    assert.deepStrictEqual(plano(f.statusAposRegistro(10, 6, 2)), { acumulado: 8, restante: 2, status: 'Parcialmente finalizado', excede: false });
    assert.deepStrictEqual(plano(f.statusAposRegistro(10, 0, 0)), { acumulado: 0, restante: 10, status: 'Aguardando produção', excede: false });
    assert.strictEqual(f.statusAposRegistro(10, 6, 5).excede, true, 'passar do saldo é sinalizado, nunca escondido');
});

test('os seis HTML seguem a anatomia da casa: overlay escondido, Voltar/Cancelar, uma ação principal, obrigatórios marcados', () => {
    for (const [arquivo, overlay] of Object.entries(MODAIS)) {
        const html = fs.readFileSync(path.join(PASTA_HTML, `${arquivo}.html`), 'utf8');
        assert.match(html, new RegExp(`id="${overlay}Overlay" class="hidden fixed inset-0 z-\\[1200\\]`), `${arquivo}: overlay`);
        assert.match(html, /glass-surface backdrop-blur-xl rounded-3xl border border-white\/10/, `${arquivo}: diálogo`);
        assert.strictEqual((html.match(/data-fin-fechar/g) || []).length, 2, `${arquivo}: Voltar e Cancelar`);
        assert.strictEqual((html.match(/data-fin-principal=/g) || []).length, 1, `${arquivo}: uma ação principal`);
        assert.match(html, /btn-danger[^>]*>Cancelar</, `${arquivo}: Cancelar no padrão`);
        assert.match(html, /data-fin-principal="[^"]+" (data-fin-sensivel="true" )?class="btn-success/, `${arquivo}: ação principal no padrão`);
        assert.doesNotMatch(html, /\*<\/label>/, `${arquivo}: asterisco solto fora do fin-obrigatorio`);
        assert.doesNotMatch(html, /role="[^"]*"[^>]*role="/, `${arquivo}: atributo role duplicado`);
    }
    const fechamento = fs.readFileSync(path.join(PASTA_HTML, 'fechar-competencia.html'), 'utf8');
    assert.match(fechamento, /data-fin-sensivel="true"/, 'fechamento é ação sensível');
    assert.match(fechamento, /class="fin-aviso"/, 'aviso bordô do bloqueio');
});

test('o módulo abre cada modal pelo Modal.open com o script compartilhado e o HTML existe', () => {
    for (const [chave, overlay] of Object.entries(MODAIS)) {
        assert.match(MODULO, new RegExp(`'${chave}': \\{ html: 'modals/financeiro/${chave}\\.html', overlay: '${overlay}' \\}`));
        assert.match(MODULO, new RegExp(`'${chave}': \\{ rotulo: '[^']+', abrir: m => finAbrirModal\\('${chave}', m\\) \\}`));
        assert.ok(fs.existsSync(path.join(PASTA_HTML, `${chave}.html`)));
    }
    assert.match(MODULO, /window\.Modal\.open\(modal\.html, FIN_SCRIPT_MODAIS, modal\.overlay\)/);
    assert.match(SCRIPT, /const montadores = \{[\s\S]*finRegistrarNf[\s\S]*finRelatorios[\s\S]*\}/);
});

test('o script dos modais não monta dado por innerHTML e solta os ouvintes globais ao fechar', () => {
    assert.doesNotMatch(SCRIPT, /innerHTML|insertAdjacentHTML/);
    assert.match(SCRIPT, /document\.removeEventListener\('keydown', aoEsc\)/);
    assert.match(SCRIPT, /window\.removeEventListener\('modalFechado', aoFecharPorFora\)/);
    assert.match(SCRIPT, /if \(processando\) return;/, 'fechamento em andamento não fecha por Esc/Cancelar');
    assert.match(SCRIPT, /window\.BotaoAcao\?\.run\) window\.BotaoAcao\.run\(botao, executar\)/, 'trava de clique duplo');
});
