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
    'relatorios': 'finRelatorios',
    'detalhes-parcela': 'finDetalhesParcela',
    'detalhes-pedido': 'finDetalhesPedido',
    'confirmar-pagamento': 'finConfirmarPagamento',
    'visualizar-relatorio': 'finVisualizarRelatorio',
    'comissoes-atrasadas': 'finComissoesAtrasadas',
    'producao-competencia': 'finProducaoCompetencia',
    'configuracao-fiscal': 'finConfiguracaoFiscal'
};
/* Os seis de ação têm Cancelar + ação principal; os de consulta fecham com "Fechar". */
const DE_ACAO = ['registrar-nf', 'registrar-recebimento', 'registrar-ajuste', 'registrar-producao', 'fechar-competencia', 'relatorios', 'confirmar-pagamento'];

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

test('os doze HTML seguem a anatomia da casa: overlay escondido, Voltar, rodapé no padrão, obrigatórios marcados', () => {
    for (const [arquivo, overlay] of Object.entries(MODAIS)) {
        const html = fs.readFileSync(path.join(PASTA_HTML, `${arquivo}.html`), 'utf8');
        assert.match(html, new RegExp(`id="${overlay}Overlay" data-fin-modal class="hidden fixed inset-0 z-\\[1200\\]`), `${arquivo}: overlay`);
        assert.match(html, /glass-surface backdrop-blur-xl rounded-3xl border border-white\/10/, `${arquivo}: diálogo`);
        assert.strictEqual((html.match(/data-fin-fechar/g) || []).length, 2, `${arquivo}: Voltar e Cancelar/Fechar`);
        if (DE_ACAO.includes(arquivo)) {
            assert.strictEqual((html.match(/data-fin-principal=/g) || []).length, 1, `${arquivo}: uma ação principal`);
            assert.match(html, /btn-danger[^>]*>Cancelar</, `${arquivo}: Cancelar no padrão`);
            assert.match(html, /data-fin-principal="[^"]+" (data-fin-sensivel="true" )?class="btn-success/, `${arquivo}: ação principal no padrão`);
        } else {
            assert.match(html, /btn-neutral[^>]*>Fechar</, `${arquivo}: Fechar no padrão`);
        }
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
        assert.ok(fs.existsSync(path.join(PASTA_HTML, `${chave}.html`)));
        assert.match(SCRIPT, new RegExp(`\\b${overlay}: montar`), `${overlay} sem montador no script`);
    }
    for (const chave of ['registrar-nf', 'registrar-recebimento', 'registrar-ajuste', 'registrar-producao', 'fechar-competencia', 'relatorios']) {
        assert.match(MODULO, new RegExp(`'${chave}': \\{ rotulo: '[^']+', abrir: m => finAbrirModal\\('${chave}', m\\) \\}`));
    }
    assert.match(MODULO, /window\.Modal\.open\(modal\.html, FIN_SCRIPT_MODAIS, modal\.overlay, extra\.empilhar === true\)/);
    assert.match(MODULO, /window\.FinanceiroAbrirModal = finAbrirModal/);
    // Os cartões e os rodapés "Próximo pagamento" abrem modais de consulta.
    assert.match(MODULO, /'comissoes-atrasadas': \{ rotulo: '[^']+', abrir: m => finAbrirModal\('comissoes-atrasadas', m\) \}/);
    assert.match(MODULO, /'producao-competencia': \{ rotulo: '[^']+', abrir: m => finAbrirModal\('producao-competencia', m\) \}/);
    assert.match(MODULO, /'aguardando-nf': \{[^}]*relatorio: 'aguardando-nf'/);
    assert.match(MODULO, /'confirmar-pagamento-producao': \{[^}]*tipo: 'producao'/);
});

test('modais empilhados: o Esc só fecha o de cima, e as linhas/botões abrem outro modal por cima', () => {
    assert.match(SCRIPT, /ehOModalDeCima/);
    assert.match(SCRIPT, /if \(e\.key !== 'Escape' \|\| !ehOModalDeCima\(\)\) return;/);
    assert.match(SCRIPT, /window\.FinanceiroAbrirModal\(chave, null, \{ \.\.\.extra, empilhar: true/);
    assert.match(SCRIPT, /\{ abrir: 'detalhes-parcela' \}/, 'linha de comissão atrasada abre Detalhes da parcela');
    assert.match(SCRIPT, /botao\.dataset\.finAbrir = 'detalhes-pedido'/, 'número do pedido abre Detalhes do pedido');
    assert.match(SCRIPT, /abrirOutro\('visualizar-relatorio', \{ relatorio, competencia, periodo \}\)/, '"Gerar relatório" com Visualizar abre a folha');
});

test('comissões atrasadas: 11 parcelas, líquido 36.600 e comissão potencial 7.320; as 3 com mais de 30 dias dão 4.280', () => {
    const f = puro();
    const linhas = plano(f.calcularAtrasadas(f.EXEMPLO.atrasadas, '2026-09-15'));
    const resumo = plano(f.resumoAtrasadas(linhas));
    assert.deepStrictEqual(resumo, { quantidade: 11, liquido: 36600, comissao: 7320 });
    const maisDe30 = linhas.filter(l => l.dias > 30);
    assert.strictEqual(maisDe30.length, 3);
    assert.strictEqual(plano(f.resumoAtrasadas(maisDe30)).comissao, 4280);
    assert.strictEqual(linhas.find(l => l.pedido === '2455').dias, 77);
    assert.deepStrictEqual(plano(f.agingDe(linhas)).map(a => `${a.faixa}:${a.parcelas}`), ['1–15:5', '16–30:3', '31–60:2', '61–90:1', '+90:0']);
    assert.strictEqual(f.faixaDeAtraso(15), '1–15');
    assert.strictEqual(f.faixaDeAtraso(16), '16–30');
    assert.strictEqual(f.faixaDeAtraso(91), '+90');
    assert.strictEqual(f.diferencaDias('2026-09-15', '2026-06-30'), 77);
});

test('produção da competência: 327 peças, 5 pedidos, pintura 4.230 + marcenaria 5.640 = 9.870', () => {
    const f = puro();
    assert.deepStrictEqual(plano(f.resumoProducao(f.EXEMPLO.producaoCompetencia)),
        { pecas: 327, pedidos: 5, pintura: 4230, marcenaria: 5640, total: 9870 });
});

test('todo relatório da central tem folha: colunas, linhas e totais fecham com os indicadores da tela', () => {
    const f = puro();
    const chavesDaCentral = [...fs.readFileSync(path.join(PASTA_HTML, 'relatorios.html'), 'utf8').matchAll(/name="finRelatorio" value="([^"]+)"/g)].map(m => m[1]);
    assert.strictEqual(chavesDaCentral.length, 9);
    for (const chave of chavesDaCentral) {
        const r = plano(f.montarRelatorio(chave));
        assert.ok(r && r.linhas.length > 0, `relatório "${chave}" sem folha ou sem linhas`);
        assert.ok(r.colunas.length >= 4, `relatório "${chave}" com poucas colunas`);
    }
    assert.strictEqual(plano(f.montarRelatorio('comissoes-apuradas')).totais.comissao, 18450);
    assert.strictEqual(plano(f.montarRelatorio('previsao-comissoes')).totais.comissao, 32500);
    assert.strictEqual(plano(f.montarRelatorio('aguardando-nf')).totais.valor, 124680);
    assert.strictEqual(plano(f.montarRelatorio('aguardando-nf')).linhas.length, 8);
    assert.strictEqual(plano(f.montarRelatorio('producao-competencia')).totais.total, 9870);
    assert.strictEqual(plano(f.montarRelatorio('producao-por-pedido')).totais.pecas, 327);
    assert.strictEqual(f.montarRelatorio('inexistente'), null);
});

test('configuração fiscal é o modal REAL: lê e grava em /api/fiscal, só o Sup Admin edita, a senha do certificado é limpa após guardar', () => {
    const html = fs.readFileSync(path.join(PASTA_HTML, 'configuracao-fiscal.html'), 'utf8');
    for (const chave of ['ambiente', 'serie_homologacao', 'proximo_numero_homologacao', 'serie_producao', 'proximo_numero_producao',
        'cnpj', 'razao_social', 'inscricao_estadual', 'crt', 'logradouro', 'numero', 'bairro', 'codigo_municipio', 'municipio', 'uf', 'cep',
        'natureza_operacao', 'cfop_dentro_uf', 'cfop_fora_uf', 'csosn', 'pcred_sn', 'pis_cst', 'cofins_cst', 'unidade_padrao', 'modalidade_frete_padrao']) {
        assert.ok(html.includes(`data-fin-cfg="${chave}"`), `campo ${chave} sem data-fin-cfg`);
    }
    assert.match(html, /id="finCfgCertSenha" type="password"/);
    assert.match(html, /id="finCfgConfirmacao"/, 'palavra de confirmação para ligar a produção');
    assert.ok(!/data-fin-principal/.test(html), 'nada aqui é "em implementação"');
    assert.match(SCRIPT, /fetchApi\('\/api\/fiscal\/configuracao'\)/);
    assert.match(SCRIPT, /fetchApi\('\/api\/fiscal\/configuracao', \{ method: 'PUT'/);
    assert.match(SCRIPT, /fetchApi\('\/api\/fiscal\/certificado', \{ method: 'POST'/);
    assert.match(SCRIPT, /fetchApi\('\/api\/fiscal\/sefaz\/status', \{ method: 'POST'/);
    assert.match(SCRIPT, /el\('finCfgCertSenha'\)\.value = '';/);
    assert.match(SCRIPT, /campo\.disabled = !podeEditar;/);
    assert.match(SCRIPT, /window\.electronAPI\?\.selecionarCertificadoFiscal/);
    assert.match(MODULO, /'configuracao-fiscal': \{ rotulo: 'Configuração fiscal', abrir: m => finAbrirModal\('configuracao-fiscal', m\) \}/);
    const tela = fs.readFileSync(path.join(RAIZ, 'html', 'financeiro.html'), 'utf8');
    assert.match(tela, /data-perm="financeiro\.config\.view" data-fin-acao="configuracao-fiscal"/);
});

test('o script dos modais não monta dado por innerHTML e solta os ouvintes globais ao fechar', () => {
    assert.doesNotMatch(SCRIPT, /innerHTML|insertAdjacentHTML/);
    assert.match(SCRIPT, /document\.removeEventListener\('keydown', aoEsc\)/);
    assert.match(SCRIPT, /window\.removeEventListener\('modalFechado', aoFecharPorFora\)/);
    assert.match(SCRIPT, /if \(processando\) return;/, 'fechamento em andamento não fecha por Esc/Cancelar');
    assert.match(SCRIPT, /window\.BotaoAcao\?\.run\) window\.BotaoAcao\.run\(botao, executar\)/, 'trava de clique duplo');
});
