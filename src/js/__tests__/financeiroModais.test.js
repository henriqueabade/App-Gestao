/**
 * Modais de ação do Financeiro (src/js/modals/financeiro-modais.js e
 * src/html/modals/financeiro/*.html).
 *
 * As contas de conferência mostradas nos modais (parcelas da NF, impacto do
 * ajuste, saldo da produção, aging, CSV) ficam em funções puras, com um caso
 * aqui para cada regra; o resto prende a anatomia da casa nos HTML, a
 * ligação com o módulo e as chamadas reais (fiscal, cobrança e fase G).
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
    'aguardando-nfe': 'finAguardandoNfe',
    'notas-fiscais': 'finNotasFiscais',
    'registrar-recebimento': 'finRegistrarRecebimento',
    'registrar-ajuste': 'finRegistrarAjuste',
    'registrar-producao': 'finRegistrarProducao',
    'fechar-competencia': 'finFecharCompetencia',
    'fechar-producao': 'finFecharProducao',
    'relatorios': 'finRelatorios',
    'detalhes-parcela': 'finDetalhesParcela',
    'detalhes-pedido': 'finDetalhesPedido',
    'confirmar-pagamento': 'finConfirmarPagamento',
    'visualizar-relatorio': 'finVisualizarRelatorio',
    'comissoes-atrasadas': 'finComissoesAtrasadas',
    'producao-competencia': 'finProducaoCompetencia',
    'configuracao-fiscal': 'finConfiguracaoFiscal',
    'configuracao-cobranca': 'finConfiguracaoCobranca',
    'recebimentos': 'finRecebimentos',
    'regras': 'finRegras',
    'atividade': 'finAtividade'
};
/* Os de ação têm Cancelar + ação principal; os de consulta fecham com "Fechar". */
const DE_ACAO = ['registrar-ajuste', 'registrar-producao', 'fechar-competencia', 'fechar-producao', 'relatorios', 'confirmar-pagamento'];

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

test('Regras › Produção: "Todas as peças" sempre no topo da tabela, depois as peças; processos na ordem da lista', () => {
    const f = puro();
    const etapas = [{ id: 1, ordem: 1 }, { id: 3, ordem: 2 }, { id: 2, ordem: 3 }, { id: 4, ordem: 4 }]; // Marcenaria, Acabamento, Montagem, Embalagem
    const v = (id, etapa_id, etapa, produto_codigo = null) => ({ id, etapa_id, etapa, produto_id: produto_codigo ? id : null, produto_codigo });
    const valores = [
        v(1, 3, 'Acabamento', 'BROO 3030 BRZ'), v(2, 3, 'Acabamento'), v(3, 3, 'Acabamento', 'BROO 1050 BRZ'),
        v(4, 1, 'Marcenaria', 'BROO 1050 PRA'), v(5, 4, 'Embalagem'), v(6, 1, 'Marcenaria'), v(7, 2, 'Montagem')
    ];
    const ordem = plano(f.ordenarValoresDeProducao(valores, etapas)).map(x => `${x.etapa}:${x.produto_codigo || 'TODAS'}`);
    assert.deepStrictEqual(ordem, [
        'Marcenaria:TODAS', 'Acabamento:TODAS', 'Montagem:TODAS', 'Embalagem:TODAS',
        'Marcenaria:BROO 1050 PRA', 'Acabamento:BROO 1050 BRZ', 'Acabamento:BROO 3030 BRZ'
    ]);
    assert.ok(SCRIPT.includes('const valores = ordenarValoresDeProducao(dados?.valores, dados?.etapas);'), 'a tabela usa a ordem');
    assert.deepStrictEqual(plano(f.ordenarValoresDeProducao(undefined)), []);
});

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

test('impacto do ajuste: novo líquido e comissão recalculada com os percentuais da parcela (espelho do backend)', () => {
    const f = puro();
    // Parcela de 20.000 com 1.000 de ajuste anterior; CMS de dois arquitetos (6% + 4%) e Royalty 10%.
    const parcela = {
        valor_original: 20000, ajustes_total: 1000, abatimento_boleto: 0, liquido: 19000, estado_parcela: 'a_receber', comissao_fechada: false,
        taxas: { pct_cms: 10, pct_royalty: 10, cms: [{ percentual: 6 }, { percentual: 4 }], royalty: [{ percentual: 10 }] }
    };
    const i = plano(f.impactoDoAjuste(parcela, 2000));
    assert.deepStrictEqual(i, {
        original: 20000, anteriores: -1000, novo: -2000, liquido_antes: 19000, liquido: 17000,
        cms: 1700, royalty: 1700, pct_cms: 10, pct_royalty: 10, excede: false, gera_estorno: false
    });
    const maior = plano(f.impactoDoAjuste(parcela, 19500));
    assert.strictEqual(maior.excede, true, 'ajuste maior que o líquido é sinalizado');
    assert.strictEqual(maior.liquido, 0);
    const fechada = plano(f.impactoDoAjuste({ ...parcela, estado_parcela: 'recebida', comissao_fechada: true }, 3000));
    assert.strictEqual(fechada.gera_estorno, true, 'parcela recebida e já fechada: estorno na próxima competência');
    assert.strictEqual(plano(f.impactoDoAjuste({ ...parcela, taxas: {} }, 0)).cms, 0, 'sem regra, comissão zero');
    assert.strictEqual(f.percentualTexto(7.5), '7,5%');
    assert.strictEqual(f.percentualTexto('10.0000'), '10%');
    const linhas = [{ pedido: '2548', cliente: 'Casa Vicenzo', nf: '1/7' }, { pedido: '2560', cliente: 'Outra', nf: null }];
    assert.deepStrictEqual(plano(f.filtrarParcelasAjuste(linhas, 'vicen')).map(l => l.pedido), ['2548']);
    assert.deepStrictEqual(plano(f.filtrarParcelasAjuste(linhas, '1/7')).map(l => l.pedido), ['2548']);
    assert.strictEqual(semNbsp(f.rotuloDaParcelaAjuste({ pedido: '2548', parcela: '1/3', cliente: 'Casa', vencimento: '2026-10-14', liquido: 1000, situacao: 'atrasada' })),
        'Pedido 2548 • parcela 1/3 • Casa • venc. 14/10/2026 • líquido R$ 1.000,00 • Atrasada');
    assert.strictEqual(f.alcanceDaRegra({ escopo: 'cliente', alvo: 'Casa Vicenzo' }), 'Cliente: Casa Vicenzo');
    assert.strictEqual(f.alcanceDaRegra({ escopo: 'todos' }), 'Todos os pedidos');
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
        // Nada mais é "em implementação": toda ação tem botão real com id.
        assert.ok(!/data-fin-principal/.test(html), `${arquivo}: nada aqui é "em implementação"`);
        if (DE_ACAO.includes(arquivo) || arquivo === 'registrar-recebimento') {
            assert.match(html, /btn-danger[^>]*>Cancelar</, `${arquivo}: Cancelar no padrão`);
            assert.match(html, /<button id="fin\w+" type="button"( data-perm="financeiro\.[a-z.]+")? class="btn-success[^"]*">[^<]+<\/button>\s*<\/footer>/, `${arquivo}: ação principal no padrão, só texto`);
        } else {
            // Fechar/Cancelar do rodapé é VERMELHO no programa inteiro (os cinzas eram só os modais novos).
            assert.match(html, /btn-danger[^>]*>Fechar</, `${arquivo}: Fechar no padrão (vermelho)`);
        }
        assert.doesNotMatch(html, /\*<\/label>/, `${arquivo}: asterisco solto fora do fin-obrigatorio`);
        assert.doesNotMatch(html, /role="[^"]*"[^>]*role="/, `${arquivo}: atributo role duplicado`);
    }
    const permissoes = {
        'registrar-ajuste': 'finAjusteRegistrar" type="button" data-perm="financeiro.ajuste.registrar"',
        'registrar-producao': 'finProducaoRegistrar" type="button" data-perm="financeiro.producao.registrar"',
        'fechar-competencia': 'finFechamentoConfirmar" type="button" data-perm="financeiro.competencia.fechar"',
        'confirmar-pagamento': 'finPagamentoConfirmar" type="button" data-perm="financeiro.pagamento.confirmar"',
        'registrar-recebimento': 'finRecebimentoRegistrar" type="button" data-perm="financeiro.recebimento.registrar"'
    };
    for (const [arquivo, trecho] of Object.entries(permissoes)) {
        assert.ok(fs.readFileSync(path.join(PASTA_HTML, `${arquivo}.html`), 'utf8').includes(trecho), `${arquivo}: a ação pede a sua permissão`);
    }
    const fechamento = fs.readFileSync(path.join(PASTA_HTML, 'fechar-competencia.html'), 'utf8');
    assert.match(fechamento, /class="fin-aviso"/, 'aviso bordô do bloqueio');
    // Fechar competência virou dois: aqui só comissões — a produção tem tela própria.
    assert.doesNotMatch(fechamento, /name="finFechamentoTipo"/, 'o fechamento de comissões não escolhe mais o tipo');
    assert.match(fechamento, /Fechar competência — comissões/, 'o título diz que é só de comissões');
    assert.match(SCRIPT, /const tipoAtual = \(\) => 'comissao';/, 'o modal manda sempre comissao para o backend');
    const producaoHtml = fs.readFileSync(path.join(PASTA_HTML, 'fechar-producao.html'), 'utf8');
    assert.match(producaoHtml, /id="finFecharProducaoCards"/, 'a tela nova tem um card por pedido');
    const regras = fs.readFileSync(path.join(PASTA_HTML, 'regras.html'), 'utf8');
    for (const id of ['finRegraSalvar', 'finProcessoIncluir', 'finProcessoExcluir', 'finProcessoNovoSalvar', 'finProcessoRenomear', 'finProcessoPagamento', 'finValorSalvar', 'finCfgSalvar', 'finFeriadoIncluir']) {
        assert.match(regras, new RegExp(`id="${id}" type="button" data-perm="financeiro\\.regras\\.editar"`), `regras: ${id} pede financeiro.regras.editar`);
    }
    const relatorios = fs.readFileSync(path.join(PASTA_HTML, 'relatorios.html'), 'utf8');
    assert.match(relatorios, /data-fin-painel="comissoes"/, 'as abas da central trocam o painel');
    assert.match(relatorios, /data-fin-painel="producao"/);
});

test('o módulo abre cada modal pelo Modal.open com o script compartilhado e o HTML existe', () => {
    for (const [chave, overlay] of Object.entries(MODAIS)) {
        assert.match(MODULO, new RegExp(`'${chave}': \\{ html: 'modals/financeiro/${chave}\\.html', overlay: '${overlay}' \\}`));
        assert.ok(fs.existsSync(path.join(PASTA_HTML, `${chave}.html`)));
        assert.match(SCRIPT, new RegExp(`\\b${overlay}: montar`), `${overlay} sem montador no script`);
    }
    for (const chave of ['registrar-recebimento', 'registrar-ajuste', 'registrar-producao', 'relatorios', 'regras']) {
        assert.match(MODULO, new RegExp(`'${chave}': \\{ rotulo: '[^']+', abrir: m => finAbrirModal\\('${chave}', m\\) \\}`));
    }
    // Fechar e pagar recebem o tipo e a competência da pendência.
    // Fechar virou dois: comissões no modal de sempre, produção na tela dos cards.
    assert.match(MODULO, /'fechar-competencia': \{\s*rotulo: 'Fechar competência — comissões',/);
    assert.match(MODULO, /filtro\.tipo === 'producao'\s*\? finAbrirModal\('fechar-producao', m, filtro\)/, 'a pendência de produção abre a tela nova');
    assert.match(MODULO, /'fechar-competencia-producao': \{ rotulo: 'Fechar competência — produção', abrir: \(m, extra\) => finAbrirModal\('fechar-producao', m, finDoFiltro\(extra\)\) \}/);
    assert.match(MODULO, /'confirmar-pagamento': \{ rotulo: '[^']+', abrir: \(m, extra\) => finAbrirModal\('confirmar-pagamento', m, finDoFiltro\(extra\)\) \}/);
    // Os fiscais recebem o `extra` da linha clicada (o filtro de uma pendência).
    assert.match(MODULO, /'emitir-nfe': \{ rotulo: 'Emitir NF-e', abrir: \(m, extra\) => finAbrirModal\('aguardando-nfe', m, extra\) \}/);
    assert.match(MODULO, /'aguardando-nf': \{ rotulo: '[^']+', abrir: \(m, extra\) => finAbrirModal\('aguardando-nfe', m, extra\) \}/);
    assert.match(MODULO, /'notas-fiscais': \{ rotulo: 'Notas fiscais', abrir: \(m, extra\) => finAbrirModal\('notas-fiscais', m, extra\) \}/);
    assert.match(MODULO, /'atividade-todas': \{ rotulo: '[^']+', abrir: m => finAbrirModal\('atividade', m\) \}/, '"Ver todas" abre o modal da atividade');
    assert.ok(!MODULO.includes("'registrar-nf'"), 'não existe mais "Registrar NF" à mão');
    assert.match(MODULO, /window\.Modal\.open\(modal\.html, FIN_SCRIPT_MODAIS, modal\.overlay, extra\.empilhar === true\)/);
    assert.match(MODULO, /window\.FinanceiroAbrirModal = finAbrirModal/);
    // Os cartões e os rodapés "Próximo pagamento" abrem modais de consulta.
    assert.match(MODULO, /'comissoes-atrasadas': \{ rotulo: '[^']+', abrir: m => finAbrirModal\('comissoes-atrasadas', m\) \}/);
    assert.match(MODULO, /'producao-competencia': \{ rotulo: '[^']+', abrir: m => finAbrirModal\('producao-competencia', m\) \}/);
    assert.match(MODULO, /'confirmar-pagamento-producao': \{[^}]*tipo: 'producao'/);
});

test('modais empilhados: o Esc só fecha o de cima, e as linhas/botões abrem outro modal por cima', () => {
    assert.match(SCRIPT, /ehOModalDeCima/);
    assert.match(SCRIPT, /if \(e\.key !== 'Escape' \|\| filhoAberto \|\| !ehOModalDeCima\(\)\) return;/);
    assert.match(SCRIPT, /window\.FinanceiroAbrirModal\(chave, null, \{ \.\.\.extra, empilhar: true, competencia: extra\.competencia \|\| contexto\.competencia \}\)/);
    assert.match(SCRIPT, /\{ abrir: 'detalhes-parcela' \}/, 'linha de comissão atrasada abre Detalhes da parcela');
    assert.match(SCRIPT, /botao\.dataset\.finAbrir = 'detalhes-pedido'/, 'número do pedido abre Detalhes do pedido');
    assert.match(SCRIPT, /abrirOutro\('visualizar-relatorio', \{ relatorio, competencia, periodo \}\)/, '"Gerar relatório" com Visualizar abre a folha');
});

test('comissões atrasadas: totais e aging das linhas do backend (as 5 faixas, mesmo vazias)', () => {
    const f = puro();
    const linhas = [
        { pedido: '2455', dias: 77, faixa: '61–90', liquido: 10000, comissao: 2000 },
        { pedido: '2460', dias: 20, liquido: 5000, comissao: 1000 },
        { pedido: '2470', dias: 3, faixa: '1–15', liquido: 1200.5, comissao: 240.1 }
    ];
    assert.deepStrictEqual(plano(f.resumoAtrasadas(linhas)), { quantidade: 3, liquido: 16200.5, comissao: 3240.1 });
    assert.deepStrictEqual(plano(f.agingDe(linhas)).map(a => `${a.faixa}:${a.parcelas}:${a.comissao}`),
        ['1–15:1:240.1', '16–30:1:1000', '31–60:0:0', '61–90:1:2000', '+90:0:0'], 'sem faixa, ela sai dos dias');
    assert.strictEqual(f.faixaDeAtraso(15), '1–15');
    assert.strictEqual(f.faixaDeAtraso(16), '16–30');
    assert.strictEqual(f.faixaDeAtraso(91), '+90');
    assert.strictEqual(f.diferencaDias('2026-09-15', '2026-06-30'), 77);
});

test('produção da competência: um cartão por setor, total em destaque e o que fica a compensar', () => {
    const f = puro();
    const cartoes = plano(f.indicadoresDaProducao({
        pecas: 327, processos: 812, pedidos: 5, fechado: false, a_pagar: 9870, a_compensar: 0,
        setores: [{ setor: 'Marcenaria', total: 5640 }, { setor: 'Pintura', total: 4230 }]
    }));
    assert.deepStrictEqual(cartoes.map(c => [c.rotulo, semNbsp(c.valor)]), [
        // Peça e processo são números diferentes: 327 peças passaram por 812 processos.
        ['Peças finalizadas', '327'], ['Processos pagos', '812'], ['Pedidos envolvidos', '5'], ['Marcenaria', 'R$ 5.640,00'], ['Pintura', 'R$ 4.230,00'], ['Total a pagar', 'R$ 9.870,00']
    ]);
    assert.strictEqual(cartoes[5].destaque, true);
    const negativo = plano(f.indicadoresDaProducao({ pecas: -3, pedidos: 1, fechado: true, a_pagar: 0, a_compensar: -75, setores: [{ setor: 'Pintura', total: -75 }] }));
    assert.deepStrictEqual(negativo.slice(-2).map(c => [c.rotulo, semNbsp(c.valor)]), [['Total a pagar (fechado)', 'R$ 0,00'], ['A compensar', '- R$ 75,00']]);
    assert.strictEqual(negativo[negativo.length - 1].atencao, true);
});

test('todo relatório da central tem folha: colunas e totais; planilha CSV para o Excel', () => {
    const f = puro();
    const chavesDaCentral = [...fs.readFileSync(path.join(PASTA_HTML, 'relatorios.html'), 'utf8').matchAll(/name="finRelatorio" value="([^"]+)"/g)].map(m => m[1]);
    assert.strictEqual(chavesDaCentral.length, 12);
    assert.ok(chavesDaCentral.includes('resumo-comissoes'), 'Comissões do mês (o "Ver detalhes" do resumo) também na central');
    assert.ok(!chavesDaCentral.includes('pagamento-pintura'), 'Pintura não é processo');
    for (const processo of ['marcenaria', 'acabamento', 'montagem', 'embalagem']) assert.ok(chavesDaCentral.includes(`pagamento-${processo}`));
    for (const chave of chavesDaCentral) {
        const r = plano(f.montarRelatorio(chave, { linhas: [] }));
        assert.ok(r && Array.isArray(r.linhas), `relatório "${chave}" sem folha`);
        assert.ok(r.colunas.length >= 4, `relatório "${chave}" com poucas colunas`);
        assert.ok(SCRIPT.includes(`'${chave}'`), `relatório "${chave}" sem definição`);
    }
    assert.deepStrictEqual(plano(f.montarRelatorio('comissoes-apuradas')).linhas, [], 'sem linhas do backend, folha vazia (nada de exemplo)');
    const apuradas = plano(f.montarRelatorio('comissoes-apuradas', { linhas: [
        { pedido: '2548', pedido_id: 55, numero_parcela: 1, liquido: 17000, cms: 1700, royalty: 1700, comissao: 3400 },
        { pedido: '2560', pedido_id: 60, numero_parcela: 2, liquido: 1000.1, cms: 100.01, royalty: 100.01, comissao: 200.02 }
    ] }));
    assert.strictEqual(apuradas.totais.comissao, 3600.02);
    assert.strictEqual(apuradas.totais.liquido, 18000.1);
    const csv = f.relatorioEmCsv({ ...apuradas, linhas: [{ ...apuradas.linhas[0], cliente: 'Casa; "Vicenzo"', liquidacao: '2026-08-20' }] });
    const partes = csv.split('\r\n');
    assert.strictEqual(csv.charCodeAt(0), 0xFEFF, 'BOM para o Excel ler os acentos');
    assert.strictEqual(partes[0].slice(1), 'Pedido;Cliente;NF;Parcela;Liquidação;Valor líquido;CMS;Royalty;Total comissão;Quem recebe');
    assert.strictEqual(partes[1], '2548;"Casa; ""Vicenzo""";;;20/08/2026;17000,00;1700,00;1700,00;3400,00;', 'sem quem recebe, a coluna sai vazia');
    assert.strictEqual(partes[2], 'Total (1);;;;;18000,10;1800,01;1800,01;3600,02;', 'os totais são os da folha');
    assert.deepStrictEqual(plano(f.RELATORIOS_DE_PARCELA).sort(), ['ajustes-anteriores', 'comissoes-apuradas', 'comissoes-atrasadas', 'comissoes-nao-realizadas', 'previsao-comissoes', 'resumo-comissoes']);
    const aguardando = plano(f.montarRelatorio('aguardando-nf', { linhas: f.linhasDoRelatorioAguardando(PAINEL) }));
    assert.strictEqual(aguardando.totais.valor, 1900, 'o dispensado (S/NF) não entra no relatório');
    assert.strictEqual(aguardando.linhas.length, 2);
    assert.deepStrictEqual(aguardando.linhas[0], { pedido: '2540', pedido_id: 1, cliente: 'Casa Vicenzo', entrega: '2026-09-10', condicao: '3x · Boleto', dias: 6, valor: 1500 });
    assert.strictEqual(aguardando.colunas[0].tipo, 'pedido-real', 'o número abre o Visualizar pedido de verdade');
    assert.deepStrictEqual(plano(f.montarRelatorio('aguardando-nf')).linhas, [], 'sem painel, sem linhas de exemplo');
    const porPedido = plano(f.montarRelatorio('producao-por-pedido', { linhas: [{ pedido: '1', pecas: 3, total: 75 }, { pedido: '2', pecas: -1, total: -25 }] }));
    assert.strictEqual(porPedido.totais.pecas, 2, 'estorno desconta peças');
    assert.strictEqual(porPedido.totais.total, 50);
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

test('configuração de cobrança (boletos BB) é o modal REAL: lê e grava em /api/cobranca, o secret nunca fica na tela, teste de conexão', () => {
    const html = fs.readFileSync(path.join(PASTA_HTML, 'configuracao-cobranca.html'), 'utf8');
    for (const chave of ['ambiente', 'agencia', 'agencia_dv', 'conta', 'conta_dv', 'convenio', 'carteira', 'variacao',
        'beneficiario_nome', 'beneficiario_cnpj', 'beneficiario_endereco', 'beneficiario_cep', 'beneficiario_cidade', 'beneficiario_uf',
        'client_id_sandbox', 'app_key_sandbox', 'client_id_producao', 'app_key_producao', 'proximo_sequencial_sandbox', 'proximo_sequencial_producao',
        'homologacao_convenio', 'homologacao_carteira', 'homologacao_variacao', 'homologacao_agencia', 'homologacao_conta',
        'especie', 'aceite', 'juros_tipo', 'juros_percentual_mes', 'multa_percentual', 'multa_dias', 'protesto_dias', 'negativacao_dias',
        'dias_limite_recebimento', 'desconto_percentual', 'desconto_dias', 'indicador_pix', 'gerar_ao_emitir_nfe', 'mensagem_boleto', 'recebimentos_desde',
        'conciliacao_automatica', 'conciliacao_intervalo_min']) {
        assert.ok(html.includes(`data-fin-cob="${chave}"`), `campo ${chave} sem data-fin-cob`);
    }
    assert.match(html, /id="finCobSecret" type="password"/, 'o secret entra num campo de senha');
    assert.ok(!html.includes('data-fin-cob="client_secret'), 'o secret NÃO é um campo da configuração (nunca volta do servidor)');
    assert.match(html, /id="finCobConfirmacao"/, 'palavra de confirmação para ligar a produção');
    assert.match(html, /name="finCobSecretDestino" value="banco"/);
    assert.match(html, /name="finCobSecretDestino" value="computador"/);
    assert.ok(!/data-fin-principal/.test(html), 'nada aqui é "em implementação"');
    assert.ok(!/<button[^>]*>\s*<i class="fas/.test(html), 'botões só com texto, sem ícone');

    assert.match(SCRIPT, /fetchApi\('\/api\/cobranca\/configuracao'\)/);
    assert.match(SCRIPT, /fetchApi\('\/api\/cobranca\/configuracao', \{ method: 'PUT'/);
    assert.match(SCRIPT, /fetchApi\('\/api\/cobranca\/credenciais', \{ method: 'POST', body: JSON\.stringify\(\{ ambiente, client_secret: secret, destino \}\) \}\)/);
    assert.match(SCRIPT, /fetchApi\(`\/api\/cobranca\/credenciais\?ambiente=\$\{encodeURIComponent\(ambiente\)\}`, \{ method: 'DELETE' \}\)/);
    assert.match(SCRIPT, /fetchApi\('\/api\/cobranca\/testar', \{ method: 'POST'/);
    assert.match(SCRIPT, /el\('finCobSecret'\)\.value = '';/, 'o secret é limpo da tela depois de guardar');
    assert.match(SCRIPT, /finConfiguracaoCobranca: montarConfiguracaoCobranca/);
    assert.match(MODULO, /'configuracao-cobranca': \{ rotulo: 'Configuração de cobrança', abrir: m => finAbrirModal\('configuracao-cobranca', m\) \}/);
    const tela = fs.readFileSync(path.join(RAIZ, 'html', 'financeiro.html'), 'utf8');
    assert.match(tela, /data-perm="financeiro\.config\.view" data-fin-acao="configuracao-cobranca"/);

    // A prévia dos encargos é a mesma conta do backend (boleto real: R$ 3.327,00 → R$ 9,98/dia e multa R$ 66,54).
    const f = puro();
    assert.strictEqual(semNbsp(f.previaDeEncargos(3327, { juros_tipo: 'valor_dia', juros_percentual_mes: '9', multa_percentual: '2', protesto_dias: '7', dias_limite_recebimento: '15' })),
        'Num boleto de R$ 3.327,00: juros de R$ 9,98 por dia de atraso (9% ao mês) · multa de R$ 66,54 (2%) · protesto 7 dias após o vencimento · pagável até 15 dias depois de vencido.');
    assert.strictEqual(semNbsp(f.previaDeEncargos(100, { juros_tipo: 'sem', multa_percentual: '0', protesto_dias: '', dias_limite_recebimento: '0' })),
        'Num boleto de R$ 100,00: sem juros · sem multa · sem protesto · não aceita pagamento depois de vencido.');
    assert.match(f.previaDeEncargos(100, { juros_tipo: 'percentual_mes', juros_percentual_mes: '1,5' }), /juros de 1,5% ao mês/);
});

test('o script dos modais não monta dado por innerHTML e solta os ouvintes globais ao fechar', () => {
    assert.doesNotMatch(SCRIPT, /innerHTML|insertAdjacentHTML/);
    assert.match(SCRIPT, /document\.removeEventListener\('keydown', aoEsc\)/);
    assert.match(SCRIPT, /window\.removeEventListener\('modalFechado', aoFecharPorFora\)/);
    assert.match(SCRIPT, /if \(processando\) return;/, 'fechamento em andamento não fecha por Esc/Cancelar');
    assert.match(SCRIPT, /window\.BotaoAcao\?\.run\) window\.BotaoAcao\.run\(botao, executar\)/, 'trava de clique duplo');
});

/* O painel fiscal como o backend devolve (backend/fiscal/painel.js). */
const PAINEL = {
    competencia: '2026-09', desde: '2026-09-01', ambiente: 'homologacao',
    aguardando_nf: {
        quantidade: 2, total: 1900, dispensados: 1,
        pedidos: [
            { pedido_id: 1, numero: '2540', cliente_id: 7, cliente: 'Casa Vicenzo', situacao: 'Enviado', enviado_em: '2026-09-10', dias_sem_nfe: 6, valor: 1500, parcelas: 3, forma_pagamento: 'Boleto', dispensada: false, ultima_nota: null },
            { pedido_id: 4, numero: '2543', cliente_id: 9, cliente: null, situacao: 'Enviado', enviado_em: '2026-09-11', dias_sem_nfe: 5, valor: 250, parcelas: 1, forma_pagamento: null, dispensada: true, ultima_nota: null },
            { pedido_id: 6, numero: '2544', cliente_id: 8, cliente: 'Marcenaria Serrana', situacao: 'Enviado', enviado_em: '2026-09-15', dias_sem_nfe: 1, valor: 400, parcelas: null, forma_pagamento: 'Pix', dispensada: false, ultima_nota: { id: 11, serie: 1, numero: 2, status_fiscal: 'rejeitada', motivo_sefaz: 'NCM inexistente' } }
        ]
    },
    pendencias: [], atividade: []
};

test('NF-e (puras): situação da nota, filtros da lista, indicadores, condição do pedido e linhas de "aguardando"', () => {
    const f = puro();
    assert.deepStrictEqual(plano(f.rotuloStatusNota('autorizada')), { rotulo: 'Autorizada', badge: 'badge-success', grupo: 'autorizada' });
    assert.strictEqual(f.rotuloStatusNota('enviando').grupo, 'processando');
    assert.strictEqual(f.rotuloStatusNota('erro_tecnico').grupo, 'rejeitada');
    assert.strictEqual(f.rotuloStatusNota('cancelada').badge, 'badge-danger');
    assert.deepStrictEqual(plano(f.rotuloStatusNota('coisa')), { rotulo: 'coisa', badge: 'badge-neutral', grupo: 'outro' });

    const notas = [
        { id: 1, serie: 1, numero: 1, status_fiscal: 'autorizada', ambiente: 'homologacao', data_emissao: '2026-09-14T10:00:00-03:00', valor_total: '800.00', pedido_numero: '2541', cliente: 'Marcenaria Serrana' },
        { id: 2, serie: 1, numero: 2, status_fiscal: 'rejeitada', ambiente: 'homologacao', data_emissao: '2026-09-15T09:00:00-03:00', valor_total: 400, pedido_numero: '2544', cliente: 'Marcenaria Serrana' },
        { id: 3, serie: 1, numero: 3, status_fiscal: 'enviando', ambiente: 'producao', data_emissao: '2026-09-16T08:00:00-03:00', valor_total: 120, pedido_numero: '2546', cliente: 'Casa Vicenzo' },
        { id: 4, serie: 1, numero: 4, status_fiscal: 'cancelada', ambiente: 'homologacao', data_emissao: '2026-08-25T08:00:00-03:00', valor_total: 9999, pedido_numero: '2500', cliente: 'Casa Vicenzo' },
        { id: 5, serie: 1, numero: 5, status_fiscal: 'rascunho', ambiente: 'homologacao', data_emissao: '2026-09-16T09:00:00-03:00', valor_total: 1, pedido_numero: '2547', cliente: 'X' }
    ];
    assert.deepStrictEqual(plano(f.filtrarNotas(notas)).map(n => n.id), [1, 2, 3, 4], 'rascunho nunca aparece');
    assert.deepStrictEqual(plano(f.filtrarNotas(notas, { competencia: '2026-09' })).map(n => n.id), [1, 2, 3]);
    assert.deepStrictEqual(plano(f.filtrarNotas(notas, { status: 'processando' })).map(n => n.id), [3]);
    assert.deepStrictEqual(plano(f.filtrarNotas(notas, { status: 'rejeitada' })).map(n => n.id), [2]);
    assert.deepStrictEqual(plano(f.filtrarNotas(notas, { ambiente: 'producao' })).map(n => n.id), [3]);
    assert.deepStrictEqual(plano(f.filtrarNotas(notas, { busca: 'vicenzo' })).map(n => n.id), [3, 4], 'busca pelo cliente');
    assert.deepStrictEqual(plano(f.filtrarNotas(notas, { busca: '2544' })).map(n => n.id), [2], 'busca pelo pedido');
    assert.deepStrictEqual(plano(f.filtrarNotas(notas, { busca: '3' })).map(n => n.id), [3], 'busca pelo nº da nota');
    assert.deepStrictEqual(plano(f.filtrarNotas(null)), []);
    assert.deepStrictEqual(plano(f.resumoDeNotas(f.filtrarNotas(notas, { competencia: '2026-09' }))), { emitidas: 3, autorizadas: 1, canceladas: 0, valor: 800, deFora: 0 });

    assert.strictEqual(f.condicaoDoPedido({ parcelas: 3, forma_pagamento: 'Boleto' }), '3x · Boleto');
    assert.strictEqual(f.condicaoDoPedido({ parcelas: 1 }), 'À vista');
    assert.strictEqual(f.condicaoDoPedido({ parcelas: null, forma_pagamento: 'Pix' }), 'À vista · Pix');

    assert.deepStrictEqual(plano(f.linhasAguardando(PAINEL)).map(l => l.numero), ['2540', '2544'], 'o dispensado (S/NF) fica de fora por padrão');
    assert.deepStrictEqual(plano(f.linhasAguardando(PAINEL, { incluirDispensados: true })).map(l => l.numero), ['2540', '2543', '2544']);
    assert.deepStrictEqual(plano(f.linhasAguardando(PAINEL, { busca: 'serrana' })).map(l => l.numero), ['2544']);
    assert.deepStrictEqual(plano(f.linhasAguardando(null)), []);
});

test('Comissões atrasadas: o bloco "A repassar" (o cliente pagou, nós não repassamos no prazo) — comissões e produção', () => {
    const f = puro();
    const comissao = plano(f.textoDoRepasse({
        tipo: 'comissao', competencia: '2026-08', situacao_texto: 'competência não fechada', pagar_ate: '2026-09-15', dias_atraso: 9, valor: 554.4,
        beneficiarios: [{ tipo: 'cms', beneficiario: 'Marcia Lamounier', valor: 277.2 }, { tipo: 'royalty', beneficiario: 'Barral & Lamounier', valor: 277.2 }]
    }));
    assert.deepStrictEqual([comissao.tipo, comissao.competencia, comissao.situacao, comissao.pagarAte, comissao.dias], ['Comissões', 'Agosto/2026', 'competência não fechada', '15/09/2026', '9 dias']);
    assert.strictEqual(semNbsp(comissao.paraQuem), 'Marcia Lamounier (CMS) R$ 277,20 · Barral & Lamounier (Royalty) R$ 277,20');
    const producao = plano(f.textoDoRepasse({ tipo: 'producao', competencia: '2026-08', situacao_texto: 'fechada, falta pagar', dias_atraso: 1, valor: 300, setores: [{ setor: 'Marcenaria', pecas: 2, total: 300 }] }));
    assert.deepStrictEqual([producao.tipo, producao.dias, semNbsp(producao.paraQuem)], ['Produção', '1 dia', 'Marcenaria R$ 300,00']);

    const html = fs.readFileSync(path.join(PASTA_HTML, 'comissoes-atrasadas.html'), 'utf8');
    assert.ok(html.includes('id="finAtrasadasRepasse" class="hidden'), 'some sem atraso de repasse');
    assert.ok(html.includes('id="finAtrasadasRepasseCorpo"'));
    assert.match(SCRIPT, /repasses = Array\.isArray\(corpo\?\.repasses\) \? corpo\.repasses : \[\];/, 'vem da mesma rota das atrasadas');
});

test('Notas fiscais: as NF-e emitidas fora e informadas nos pedidos entram na lista, nos filtros e nos indicadores', () => {
    const f = puro();
    const proprias = [
        { id: 7, serie: 2, numero: 2, status_fiscal: 'autorizada', ambiente: 'homologacao', data_emissao: '2026-09-24T10:00:00-03:00', valor_total: 7320.85, pedido_id: 115 },
        { id: 6, serie: 2, numero: 1, status_fiscal: 'autorizada', ambiente: 'homologacao', data_emissao: '2026-09-20T10:00:00-03:00', valor_total: 4335.56, pedido_id: 111 }
    ];
    const deFora = [
        { id: 3, pedido_id: 104, serie: 1, numero: 8812, chave_acesso: '3126…', data_emissao: '2026-09-22', mes_emissao: '2026-09', valor_total: 2500, origem: 'xml', tem_xml: true, cartas_correcao: 1, ultima_carta_seq: 1 },
        // Informada só pela chave: sem o dia, vale o mês da chave.
        { id: 4, pedido_id: 99, serie: 1, numero: 8790, data_emissao: null, mes_emissao: '2026-08', valor_total: 900, origem: 'chave', tem_xml: false, cartas_correcao: 0 }
    ];
    const lista = plano(f.juntarNotas(proprias, deFora));
    assert.deepStrictEqual(lista.map(n => n.id), [7, 'fora-3', 6, 'fora-4'], 'numa lista só, da emissão mais nova para a mais velha');
    const fora = lista.find(n => n.id === 'fora-3');
    assert.deepStrictEqual([fora.de_fora, fora.status_fiscal, fora.ambiente, fora.pedido_id, fora.tem_xml, fora.cartas_correcao], [true, 'autorizada', 'fora', 104, true, 1]);

    assert.deepStrictEqual(plano(f.filtrarNotas(lista, { competencia: '2026-08' })).map(n => n.id), ['fora-4'], 'a de fora sem o dia entra pelo mês');
    assert.deepStrictEqual(plano(f.filtrarNotas(lista, { ambiente: 'fora' })).map(n => n.id), ['fora-3', 'fora-4']);
    assert.deepStrictEqual(plano(f.filtrarNotas(lista, { ambiente: 'homologacao' })).map(n => n.id), [7, 6]);
    assert.deepStrictEqual(plano(f.filtrarNotas(lista, { status: 'autorizada' })).map(n => n.id), [7, 'fora-3', 6, 'fora-4']);
    assert.deepStrictEqual(plano(f.resumoDeNotas(f.filtrarNotas(lista, { competencia: '2026-09' }))),
        { emitidas: 3, autorizadas: 3, canceladas: 0, valor: 14156.41, deFora: 1 });
    assert.deepStrictEqual(plano(f.juntarNotas(proprias, null)).map(n => n.id), [7, 6], 'sem as de fora (SQL por rodar), como era');

    // A tela: lê as duas listas, diz quantas são de fora e dá a cada uma o que ela permite.
    assert.match(SCRIPT, /fetchApi\('\/api\/fiscal\/notas-externas'\)\.catch\(\(\) => \[\]\)/);
    assert.match(SCRIPT, /lidas = juntarNotas\(lista, deFora\)/);
    assert.match(SCRIPT, /window\.NfeDocumentos\?\.gerarDanfeExterna\(n\.pedido_id\)/);
    assert.match(SCRIPT, /window\.NfeDocumentos\?\.salvarXmlExterna\(n\.pedido_id\)/);
    assert.match(SCRIPT, /abrirModalDePedido\('modals\/pedidos\/dados-externos\.html', '\.\.\/js\/modals\/pedido-dados-externos\.js', 'dadosExternos', \{ aoFechar: carregarLista \}\)/);
    assert.match(SCRIPT, /const documentos = !n\.de_fora && /, 'cancelar e e-mail são só das notas daqui');
    const html = fs.readFileSync(path.join(PASTA_HTML, 'notas-fiscais.html'), 'utf8');
    assert.ok(html.includes('<option value="fora">Emitidas fora</option>'));
    assert.ok(html.includes('id="finNotasDeFora"'));
    assert.ok(html.includes('NF-e emitidas pelo sistema e as emitidas fora, informadas nos pedidos'));
});

test('os modais fiscais são REAIS: aguardando NF-e e notas fiscais leem /api/fiscal e abrem os modais dos Pedidos por cima', () => {
    const aguardando = fs.readFileSync(path.join(PASTA_HTML, 'aguardando-nfe.html'), 'utf8');
    for (const id of ['finAguardNfeCompetencia', 'finAguardNfeBusca', 'finAguardNfeIncluirDispensados', 'finAguardNfeQuantidade', 'finAguardNfeTotal', 'finAguardNfeDesde', 'finAguardNfeCorpo', 'finAguardNfeVazio', 'finAguardNfeMensagem', 'finAguardNfeCarregando', 'finAguardNfeAmbiente']) {
        assert.ok(aguardando.includes(`id="${id}"`), `aguardando-nfe sem #${id}`);
    }
    assert.match(aguardando, /data-fin-abrir="visualizar-relatorio" data-fin-relatorio="aguardando-nf"/);
    assert.ok(!/data-fin-principal/.test(aguardando), 'nada aqui é "em implementação"');

    const notas = fs.readFileSync(path.join(PASTA_HTML, 'notas-fiscais.html'), 'utf8');
    for (const id of ['finNotasCompetencia', 'finNotasStatus', 'finNotasAmbienteFiltro', 'finNotasBusca', 'finNotasEmitidas', 'finNotasAutorizadas', 'finNotasCanceladas', 'finNotasValor', 'finNotasCorpo', 'finNotasVazio', 'finNotasMensagem', 'finNotasCarregando', 'finNotasAtualizar']) {
        assert.ok(notas.includes(`id="${id}"`), `notas-fiscais sem #${id}`);
    }
    for (const v of ['autorizada', 'cancelada', 'processando', 'rejeitada']) assert.ok(notas.includes(`<option value="${v}">`), `filtro de situação ${v}`);
    assert.ok(!/data-fin-principal/.test(notas), 'nada aqui é "em implementação"');
    // A lupa do seletor de competência é filtro, não ação: ícone com aria-label.
    const semLupa = t => t.replace(/<button[^>]*data-competencia-ir[\s\S]*?<\/button>/g, '');
    assert.ok(!/<button[^>]*>\s*<i class="fas/.test(semLupa(notas)) && !/<button[^>]*>\s*<i class="fas/.test(semLupa(aguardando)), 'botões só com texto, sem ícone');

    // O que o script faz com o backend.
    assert.match(SCRIPT, /fetchApi\(`\/api\/fiscal\/painel\?competencia=\$\{encodeURIComponent\(competenciaSel\.value \|\| ''\)\}`\)/, 'aguardando lê o painel da competência');
    assert.match(SCRIPT, /fetchApi\('\/api\/fiscal\/notas'\)/, 'a lista de notas vem do backend');
    assert.match(SCRIPT, /\/api\/fiscal\/pedidos\/\$\{encodeURIComponent\(l\.pedido_id\)\}\/dispensar-nfe/, '"Sem NF-e" marca o pedido');
    assert.match(SCRIPT, /\/api\/fiscal\/notas\/\$\{encodeURIComponent\(n\.id\)\}\/sincronizar/, '"Consultar na SEFAZ" da nota parada');
    assert.match(SCRIPT, /confirmText: 'Marcar sem NF-e'/, 'marcar sem nota confirma na caixa da casa');
    // Os modais dos Pedidos, com o contexto que eles esperam, empilhados (keepExisting = true).
    assert.match(SCRIPT, /window\.emitirNfeContext = \{ pedidoId: l\.pedido_id, numero: String\(l\.numero\), cliente: l\.cliente \|\| '' \}/);
    assert.match(SCRIPT, /abrirModalDePedido\('modals\/pedidos\/emitir-nfe\.html', '\.\.\/js\/modals\/pedido-emitir-nfe\.js', 'emitirNfePedido', \{ esperar: true, aoFechar: carregarLista \}\)/);
    assert.match(SCRIPT, /abrirModalDePedido\('modals\/pedidos\/visualizar\.html', '\.\.\/js\/modals\/pedido-visualizar\.js', 'visualizarPedido', \{ esperar: true \}\)/);
    assert.match(SCRIPT, /window\.Modal\.open\(htmlPath, scriptPath, id, true\)/);
    for (const [html, js, id, ctx] of [
        ['enviar-nfe-email', 'pedido-enviar-nfe-email', 'enviarNfeEmail', 'emailNfeContext'],
        ['carta-correcao-nfe', 'pedido-carta-correcao-nfe', 'cartaCorrecaoNfe', 'cartaCorrecaoContext'],
        ['cancelar-nfe', 'pedido-cancelar-nfe', 'cancelarNfe', 'cancelarNfeContext']]) {
        assert.ok(SCRIPT.includes(`'modals/pedidos/${html}.html', '../js/modals/${js}.js', '${id}', '${ctx}'`), `modal ${id} com o contexto ${ctx}`);
    }
    assert.match(SCRIPT, /email: n\.destinatario\?\.email \|\| ''/, 'o e-mail do destinatário da nota vai no contexto');
    assert.match(SCRIPT, /window\.NfeDocumentos\?\.gerarDanfe\(n\.id\)/);
    assert.match(SCRIPT, /window\.NfeDocumentos\?\.salvarXml\(n\.id\)/);
    assert.match(SCRIPT, /if \(e\.key !== 'Escape' \|\| filhoAberto \|\| !ehOModalDeCima\(\)\) return;/, 'com um modal de Pedidos por cima, o Esc é dele');
    assert.match(SCRIPT, /const RECARREGAM_O_PAINEL = new Set\(\['finAguardandoNfe', 'finNotasFiscais', 'finConfiguracaoFiscal'[,\]]/, 'fechar relê o painel da tela');
    assert.match(SCRIPT, /emitir\.dataset\.perm = 'financeiro\.nfe\.emit'/);
    assert.match(SCRIPT, /semNf\.dataset\.perm = 'ped\.status\.ship'/);
    assert.match(SCRIPT, /perm: 'financeiro\.nfe\.cancel'/);
    assert.match(SCRIPT, /const painel = await fetchApi\(`\/api\/fiscal\/painel\?competencia=\$\{encodeURIComponent\(competencia\)\}`\);/, 'o relatório "aguardando NF" é real');
    assert.ok(!SCRIPT.includes('montarRegistrarNf'), 'não existe mais "Registrar NF" à mão');
});

/* Contas a receber como o backend devolve (backend/cobranca/contasReceber.js). */
const PARCELAS = [
    { pedido_id: 1, pedido: 'PED120', cliente: 'Casa Vicenzo', nf: '1/7', numero_parcela: 1, parcela: '1/2', vencimento: '2026-09-05', a_receber: 900, dias_atraso: 11, controlada: true, boleto: { id: 41, status: 'vencido', nosso_numero: '00031285570000000001' } },
    { pedido_id: 1, pedido: 'PED120', cliente: 'Casa Vicenzo', nf: '1/7', numero_parcela: 2, parcela: '2/2', vencimento: '2026-10-05', a_receber: 1000, dias_atraso: 0, controlada: true, boleto: { id: 42, status: 'erro', erro: '4678420' } },
    { pedido_id: 2, pedido: 'PED121', cliente: 'Marcenaria São José', nf: null, numero_parcela: 1, parcela: '1/1', vencimento: '2026-07-01', a_receber: 250.5, dias_atraso: 77, controlada: false, boleto: null }
];

test('recebimentos (puras): tag do boleto, filtros por busca e boleto, total da visão, rótulo da parcela e resumo do registro', () => {
    const f = puro();
    assert.deepStrictEqual(plano(f.rotuloBoletoDaParcela(null)), { texto: 'Sem boleto', badge: 'badge-neutral' });
    assert.deepStrictEqual(plano(f.rotuloBoletoDaParcela({ status: 'registrado' })), { texto: 'Boleto registrado', badge: 'badge-success' });
    assert.deepStrictEqual(plano(f.rotuloBoletoDaParcela({ status: 'erro' })), { texto: 'Boleto recusado', badge: 'badge-danger' });
    assert.strictEqual(f.rotuloBoletoDaParcela({ status: 'baixado', motivo_baixa: 'quitacao_estornada' }).texto, 'Boleto baixado (quitação estornada)');

    const ids = linhas => plano(linhas).map(l => `${l.pedido}/${l.numero_parcela}`);
    assert.deepStrictEqual(ids(f.filtrarRecebimentos(PARCELAS, { visao: 'abertas', boleto: 'aberto' })), ['PED120/1']);
    assert.deepStrictEqual(ids(f.filtrarRecebimentos(PARCELAS, { visao: 'abertas', boleto: 'sem' })), ['PED120/2', 'PED121/1']);
    assert.deepStrictEqual(ids(f.filtrarRecebimentos(PARCELAS, { visao: 'abertas', boleto: 'erro' })), ['PED120/2']);
    assert.deepStrictEqual(ids(f.filtrarRecebimentos(PARCELAS, { visao: 'abertas', busca: 'sao jose' })), ['PED121/1'], 'busca sem acento');
    assert.deepStrictEqual(ids(f.filtrarRecebimentos(PARCELAS, { visao: 'abertas', busca: '1/7' })), ['PED120/1', 'PED120/2'], 'busca pela NF');
    assert.deepStrictEqual(ids(f.filtrarRecebimentos(PARCELAS, { visao: 'recebidos', boleto: 'aberto' })), ['PED120/1', 'PED120/2', 'PED121/1'], 'o filtro de boleto não vale para recebidos');
    assert.deepStrictEqual(plano(f.filtrarRecebimentos(null)), []);

    assert.strictEqual(f.totalDaVisao(PARCELAS, 'abertas'), 2150.5);
    assert.strictEqual(f.totalDaVisao([{ status: 'confirmado', valor: 10 }, { status: 'estornado', valor: 99 }, { status: 'confirmado', valor: '5.25' }], 'recebidos'), 15.25, 'estornado não soma');

    assert.strictEqual(semNbsp(f.rotuloDaParcelaAberta(PARCELAS[0])), 'Pedido PED120 · Casa Vicenzo · parcela 1/2 · vence 05/09/2026 · R$ 900,00 · 11 dias em atraso · boleto em aberto');
    assert.strictEqual(semNbsp(f.rotuloDaParcelaAberta(PARCELAS[2])), 'Pedido PED121 · Marcenaria São José · parcela 1/1 · vence 01/07/2026 · R$ 250,50 · 77 dias em atraso · antes do controle');

    assert.deepStrictEqual(plano(f.resumoDoRecebimento({ devido: 900, recebido: 912.5, data: '2026-09-16' })),
        { devido: 900, recebido: 912.5, diferenca: 12.5, rotuloDiferenca: 'Recebido a mais (juros, multa)', competencia: 'Setembro/2026' });
    assert.strictEqual(f.resumoDoRecebimento({ devido: 900, recebido: 850, data: '2026-10-01' }).rotuloDiferenca, 'Recebido a menos (desconto)');
    assert.deepStrictEqual(plano(f.resumoDoRecebimento({ devido: null, recebido: null, data: '' })), { devido: null, recebido: null, diferenca: null, rotuloDiferenca: 'Diferença', competencia: '—' });
    assert.deepStrictEqual(plano(f.ORIGENS_RECEBIMENTO), { boleto: 'Boleto pago', quitado_por_fora: 'Quitado por fora', manual: 'À mão' });
});

test('recebimentos são REAIS: o registro e a lista falam com /api/cobranca, confirmam na caixa da casa e abrem o boleto por cima', () => {
    const registrar = fs.readFileSync(path.join(PASTA_HTML, 'registrar-recebimento.html'), 'utf8');
    for (const id of ['finRecebimentoBusca', 'finRecebimentoParcela', 'finRecebimentoCliente', 'finRecebimentoPedido', 'finRecebimentoNf', 'finRecebimentoAvisoBoleto',
        'finRecebimentoData', 'finRecebimentoValor', 'finRecebimentoForma', 'finRecebimentoObservacoes', 'finRecebimentoDevido', 'finRecebimentoLiquido',
        'finRecebimentoDiferenca', 'finRecebimentoCompetencia', 'finRecebimentoMensagem', 'finRecebimentoRegistrar', 'finRecebimentoCarregando']) {
        assert.ok(registrar.includes(`id="${id}"`), `registrar-recebimento sem #${id}`);
    }
    for (const forma of ['Pix', 'Transferência', 'Depósito', 'Dinheiro', 'Cheque', 'Cartão de crédito', 'Outro']) {
        assert.ok(registrar.includes(`<option value="${forma}">`), `forma ${forma}`);
    }
    assert.ok(!registrar.includes('value="boleto"'), 'boleto pago não se registra à mão');
    assert.ok(!/Comprovante/.test(registrar), 'sem o que ainda não existe (comprovante)');
    // Fase G: a comissão que o recebimento gera, só para quem vê comissões.
    for (const id of ['finRecebimentoBase', 'finRecebimentoCms', 'finRecebimentoRoyalty']) {
        assert.match(registrar, new RegExp(`data-perm-hide="financeiro\\.comissao\\.view">\\s*<span[^>]*>[^<]+</span>\\s*<span id="${id}"`), `#${id} some sem financeiro.comissao.view`);
    }
    assert.match(SCRIPT, /if \(pode\('financeiro\.comissao\.view'\)\) \{\s*\/\/[^\n]*\n\s*fetchApi\('\/api\/financeiro\/parcelas\?visao=ajustaveis'\)/, 'a prévia da comissão vem das parcelas da fase G, em segundo plano');
    assert.ok(!/<button[^>]*>\s*<i class="fas/.test(registrar), 'botões só com texto');

    const lista = fs.readFileSync(path.join(PASTA_HTML, 'recebimentos.html'), 'utf8');
    for (const id of ['finRecebimentosVisao', 'finRecebimentosCompetencia', 'finRecebimentosBoleto', 'finRecebimentosBusca', 'finRecebimentosRecebido', 'finRecebimentosAReceber',
        'finRecebimentosAtraso', 'finRecebimentosBoletos', 'finRecebimentosCabeca', 'finRecebimentosCorpo', 'finRecebimentosVazio', 'finRecebimentosTotal',
        'finRecebimentosSemSql', 'finRecebimentosMensagem', 'finRecebimentosCarregando', 'finRecebimentosConciliar', 'finRecebimentosRegistrar', 'finRecebimentosDesde']) {
        assert.ok(lista.includes(`id="${id}"`), `recebimentos sem #${id}`);
    }
    for (const v of ['recebidos', 'a_receber', 'em_atraso', 'abertas']) assert.ok(lista.includes(`<option value="${v}">`), `visão ${v}`);
    assert.match(lista, /id="finRecebimentosConciliar" type="button" data-perm="financeiro\.recebimento\.view"/);
    assert.match(lista, /id="finRecebimentosRegistrar" type="button" data-perm="financeiro\.recebimento\.registrar"/);
    assert.ok(!/data-fin-principal/.test(lista) && !/<button[^>]*>\s*<i class="fas/.test(lista.replace(/<button[^>]*data-competencia-ir[\s\S]*?<\/button>/g, '')));

    assert.match(SCRIPT, /fetchApi\(`\/api\/cobranca\/recebimentos\?visao=abertas&competencia=/);
    assert.match(SCRIPT, /fetchApi\('\/api\/cobranca\/recebimentos', \{\s*method: 'POST'/);
    assert.match(SCRIPT, /\.\.\.\(aberto \? \{ baixar_boleto: true \} : \{\}\)/, 'boleto em aberto: pede a baixa junto');
    assert.match(SCRIPT, /confirmText: aberto \? 'Baixar e registrar' : 'Registrar'/);
    assert.match(SCRIPT, /fetchApi\(`\/api\/cobranca\/recebimentos\/\$\{encodeURIComponent\(l\.id\)\}\/estornar`, \{ method: 'POST'/);
    assert.match(SCRIPT, /fetchApi\('\/api\/cobranca\/conciliar', \{ method: 'POST', body: '\{\}' \}\)/);
    assert.match(SCRIPT, /abrirModalDePedido\('modals\/pedidos\/boleto-detalhe\.html', '\.\.\/js\/modals\/pedido-boleto-detalhe\.js', 'boletoDetalhe', \{ aoFechar: carregarLista \}\)/);
    assert.match(SCRIPT, /abrirOutro\('registrar-recebimento', \{ parcela: \{ pedido_id: l\.pedido_id, numero_parcela: l\.numero_parcela, pedido: l\.pedido \} \}\)/);
    assert.match(SCRIPT, /window\.dispatchEvent\(new CustomEvent\('financeiro:recebimentos-alterados'\)\)/);
    assert.match(SCRIPT, /aoDesligar\.push\(\(\) => window\.removeEventListener\('financeiro:recebimentos-alterados', aoAlterar\)\)/, 'o ouvinte sai quando a lista fecha');
    assert.match(SCRIPT, /'app-message-overlay fixed inset-0/, 'a caixa do motivo sobe para a top layer');
    assert.match(SCRIPT, /finRecebimentos: montarRecebimentos/);
    assert.match(SCRIPT, /const RECARREGAM_O_PAINEL = new Set\(\[[^\]]*'finFecharProducao'[^\]]*'finConfirmarPagamento'[^\]]*\]\)/, 'fechar relê o painel (inclusive a tela de produção)');
    assert.ok(!/window\.confirm\(/.test(SCRIPT));

    // O módulo: os cartões abrem a lista na visão certa; "Registrar recebimento" pede a permissão.
    assert.match(MODULO, /'recebimentos-atraso': \{ rotulo: 'Recebimentos', abrir: m => finAbrirModal\('recebimentos', m, \{ visao: 'em_atraso' \}\) \}/);
    assert.match(MODULO, /'recebimentos-boletos': \{[^}]*filtro: \{ boleto: 'aberto' \}/);
    const tela = fs.readFileSync(path.join(RAIZ, 'html', 'financeiro.html'), 'utf8');
    assert.match(tela, /data-perm="financeiro\.recebimento\.registrar" data-fin-acao="registrar-recebimento"/);
    assert.match(tela, /data-perm-hide="financeiro\.recebimento\.view"/, 'a faixa some para quem não vê recebimentos');
    assert.match(tela, /data-perm="financeiro\.recebimento\.view" data-fin-acao="conciliar"/);
});

test('comissões e produção são REAIS (fase G): cada modal fala com /api/financeiro e confirma na caixa da casa', () => {
    const chamadas = [
        "fetchApi('/api/financeiro/parcelas?visao=ajustaveis')",
        "fetchApi('/api/financeiro/ajustes', {",
        "fetchApi('/api/financeiro/producao/pedidos')",
        'fetchApi(`/api/financeiro/producao/pedidos/${encodeURIComponent(id)}`)',
        "fetchApi('/api/financeiro/producao', {",
        'fetchApi(`/api/financeiro/producao/${encodeURIComponent(e.id)}/estornar`',
        'fetchApi(`/api/financeiro/fechamentos/previa?tipo=${tipoAtual()}&competencia=',
        "fetchApi('/api/financeiro/fechamentos', { method: 'POST'",
        'fetchApi(`/api/financeiro/fechamentos?tipo=${tipo}`)',
        "fetchApi('/api/financeiro/pagamentos', {",
        'fetchApi(`/api/financeiro/relatorios/${encodeURIComponent(chave)}?${consulta}`)',
        'fetchApi(`/api/financeiro/parcelas/${encodeURIComponent(alvo.pedido_id)}/${encodeURIComponent(alvo.numero_parcela)}`)',
        'fetchApi(`/api/financeiro/ajustes/${encodeURIComponent(a.id)}/cancelar`',
        'fetchApi(`/api/financeiro/pedidos/${encodeURIComponent(pedidoId)}`)',
        // As atrasadas DO MÊS escolhido (dono, 24/09/2026).
        'fetchApi(`/api/financeiro/parcelas?visao=atrasadas&competencia=${encodeURIComponent(competencia)}`)',
        'fetchApi(`/api/financeiro/producao?competencia=${encodeURIComponent(mesSel.value)}`)',
        "fetchApi('/api/financeiro/regras')",
        "fetchApi('/api/financeiro/valores', {",
        "fetchApi('/api/financeiro/configuracao', { method: 'PUT'",
        "fetchApi('/api/financeiro/feriados', { method: 'POST'",
        'fetchApi(`/api/financeiro/buscas/${alvo}`)'
    ];
    for (const trecho of chamadas) assert.ok(SCRIPT.includes(trecho), `falta a chamada ${trecho}`);
    for (const titulo of ['Registrar o ajuste?', 'Registrar a produção?', 'Fechar as comissões?', 'Fechar a produção?', 'Confirmar o pagamento?', 'Desativar a regra?']) {
        assert.ok(SCRIPT.includes(`'${titulo}'`), `sem confirmação "${titulo}"`);
    }
    // O fechamento não se fecha por Esc no meio da gravação.
    assert.match(SCRIPT, /confirmText: 'Fechar competência'\s*\}\);\s*if \(!confirmado\) return;\s*processando = true;/);
    // As listas de baixo se relêem quando outro modal grava.
    assert.match(SCRIPT, /const avisarAlteracao = \(\) => window\.dispatchEvent\(new CustomEvent\('financeiro:alterado'\)\);/);
    assert.match(SCRIPT, /aoDesligar\.push\(\(\) => window\.removeEventListener\('financeiro:alterado', ouvinte\)\);/);
    // Exportação: PDF montado com DOM e planilha CSV pelo Electron.
    assert.match(SCRIPT, /document\.implementation\.createHTMLDocument/);
    assert.match(SCRIPT, /salvarHtmlComoPdf\?\.\(\{ html: documentoDoRelatorio\(r\)/);
    assert.match(SCRIPT, /salvarTextoComoArquivo\?\.\(\{\s*conteudo: relatorioEmCsv\(r\), nomeSugerido: nome, extensao: 'csv'/);
    assert.ok(!/EXEMPLO|TAXA_CMS|TAXA_ROYALTY/.test(SCRIPT), 'nenhum dado de exemplo sobrou');
    assert.match(SCRIPT, /finRegras: montarRegras/);
});

test('todo botão que chama BotaoAcao.run no próprio clique leva data-acao-gerida (senão a rede automática o ocupa antes e ele não faz nada)', () => {
    for (const [arquivo, fonte] of [['financeiro-modais.js', SCRIPT], ['pedido-gerar-boletos.js', fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'pedido-gerar-boletos.js'), 'utf8')]]) {
        const variaveis = [...fonte.matchAll(/window\.BotaoAcao\.run\((\w+),/g)].map(m => m[1]);
        assert.ok(variaveis.length > 0, arquivo);
        for (const v of new Set(variaveis)) {
            assert.ok(fonte.includes(`${v}.dataset.acaoGerida = 'true'`), `${arquivo}: ${v} chama BotaoAcao.run sem data-acao-gerida`);
        }
    }
    assert.match(SCRIPT, /function acionar\(botao, fn\) \{\s*botao\.dataset\.acaoGerida = 'true';/);
});

test('configuração de cobrança (fase F): avisos do BB e conciliação automática, sem token na tela', () => {
    const html = fs.readFileSync(path.join(PASTA_HTML, 'configuracao-cobranca.html'), 'utf8');
    for (const id of ['finCobWebhookSecao', 'finCobWebhookUrl', 'finCobWebhookUltimo', 'finCobWebhookFila', 'finCobWebhookContagens', 'finCobAgendaUltima',
        'finCobAgendaProxima', 'finCobWebhookSemSql', 'finCobWebhookAtualizar', 'finCobWebhookProcessar', 'finCobWebhookConciliar', 'finCobWebhookResultado',
        'finCobWebhookAvisos', 'finCobExecucoes']) {
        assert.ok(html.includes(`id="${id}"`), `configuração de cobrança sem #${id}`);
    }
    assert.match(html, /id="finCobWebhookProcessar" type="button" data-perm="financeiro\.recebimento\.view"/);
    assert.match(html, /id="finCobWebhookConciliar" type="button" data-perm="financeiro\.recebimento\.view"/);
    for (const coluna of ['recebimentos_desde', 'conciliacao_automatica', 'conciliacao_intervalo_min']) {
        assert.match(html, new RegExp(`data-fin-cob-bloco="${coluna}"`), `${coluna}: o bloco some sem a coluna`);
        assert.match(html, new RegExp(`data-fin-cob="${coluna}" data-fin-cob-coluna-nova="true"`), `${coluna}: não vai no PUT sem a coluna`);
    }
    assert.ok(!/BB_WEBHOOK_TOKEN=|data-fin-cob="[^"]*token/i.test(html), 'o token não é campo da tela');
    assert.ok(!/<button[^>]*>\s*<i class="fas/.test(html), 'botões só com texto');

    assert.match(SCRIPT, /fetchApi\('\/api\/cobranca\/webhook\/estado'\)/);
    assert.match(SCRIPT, /fetchApi\('\/api\/cobranca\/conciliar', \{ method: 'POST', body: JSON\.stringify\(soFila \? \{ so_fila: true \} : \{\}\) \}\)/);
    assert.match(SCRIPT, /ligar\('finCobWebhookProcessar', \(\) => conciliarDaConfiguracao\(true\)\)/);
    assert.match(SCRIPT, /ligar\('finCobWebhookConciliar', \(\) => conciliarDaConfiguracao\(false\)\)/);
    assert.match(SCRIPT, /overlay\.querySelectorAll\('\[data-fin-cob-bloco\]'\)\.forEach\(bloco => bloco\.classList\.toggle\('hidden', colunasAusentes\.has\(bloco\.dataset\.finCobBloco\)\)\)/);

    const f = puro();
    const r = {
        fila: { lidos: 3, pagos: 1, cancelados: 0, ignorados: 2, alertas: 0, mensagens: ['Aviso 7: erro'] },
        consultas: { consultados: 4, pagos: 1, mensagens: [] }, acerto: { lancados: 2, mensagens: [] }
    };
    assert.deepStrictEqual(plano(f.textoDaConciliacao(r)), { texto: '3 aviso(s) do BB lido(s) · 1 pagamento(s) · 2 ignorado(s) · 4 boleto(s) consultado(s) · 1 pago(s) na consulta · 2 recebimento(s) lançado(s).', erros: ['Aviso 7: erro'] });
    assert.strictEqual(f.textoDaConciliacao(r, true).texto, '3 aviso(s) do BB lido(s) · 1 pagamento(s) · 2 ignorado(s).', 'só a fila não fala da consulta');
    assert.match(f.textoDaConciliacao({ sql_pendente: true }).texto, /sql\/cobranca_recebimentos\.sql/);
    assert.deepStrictEqual(plano(f.BADGE_DO_AVISO), { 'conciliado': 'badge-success', 'na fila': 'badge-warning', 'na fila (erro)': 'badge-danger', 'alerta': 'badge-danger', 'ignorado': 'badge-neutral' });
});

test('regras: CMS só para dono de cliente, Royalty para o desenhista, processos com + e −, valor em R$ ou % da tabela fixa', () => {
    const html = fs.readFileSync(path.join(PASTA_HTML, 'regras.html'), 'utf8');
    assert.match(html, /<select id="finRegraBeneficiario"/, 'quem recebe a CMS é escolhido entre os donos');
    assert.match(html, /id="finRegraBeneficiarioRoyalty"[^>]*>Desenhista de cada peça</);
    assert.match(html, /<option value="cms">CMS \(dono do cliente\)<\/option>/);
    assert.match(html, /<option value="royalty">Royalty \(desenhista da peça\)<\/option>/);
    assert.match(html, /<select id="finProcessoSelect"/);
    assert.match(html, /<select id="finValorTipo"[\s\S]*?<option value="valor">R\$ por peça<\/option>[\s\S]*?<option value="percentual">% do preço da tabela fixa<\/option>/);
    assert.ok(!/finSetorNome|finSetorSalvar/.test(html), 'os setores da fase G saíram da tela');

    assert.match(SCRIPT, /gravarProcesso\('\/api\/financeiro\/etapas', 'POST', \{ nome \}/);
    assert.match(SCRIPT, /gravarProcesso\(`\/api\/financeiro\/etapas\/\$\{encodeURIComponent\(e\.id\)\}`, 'PUT', \{ nome \}/);
    assert.match(SCRIPT, /'PUT', \{ producao_ativa: ligar \}/);
    assert.match(SCRIPT, /'DELETE', null/);
    assert.match(SCRIPT, /beneficiario: ehRoyalty\(\) \? null : benefSel\.value/);
    assert.match(SCRIPT, /clientes\.filter\(c => dono && semAcento\(c\.dono\) === semAcento\(dono\)\)/, 'no cliente/pedido, só os do dono');
    assert.match(SCRIPT, /corpo\.tipo = emPercentual\(\) \? 'percentual' : 'valor';/);

    // Registrar produção grava o processo (etapa) e a prévia usa a parte que falta de cada peça.
    const producao = fs.readFileSync(path.join(PASTA_HTML, 'registrar-producao.html'), 'utf8');
    assert.match(producao, />Processo <span class="fin-obrigatorio">\*<\/span><\/label>/);
    assert.match(SCRIPT, /pedido_item_id: item\.id, etapa_id: Number\(setorSel\.value\)/);
    const f = puro();
    assert.strictEqual(f.valorDasProximas({ valor_unitario: 25, proximas: [0.5, 1, 1, 1] }, 3), 62.5, 'a do estoque adiantada vale meia peça');
    assert.strictEqual(f.valorDasProximas({ valor_unitario: 100, proximas: [0.1] }, 5), 10, 'só as peças que ainda precisam contam');
    assert.strictEqual(f.valorDasProximas({ valor_unitario: null, proximas: [1] }, 1), null);
    assert.strictEqual(f.valorDasProximas(null, 1), null);
});

test('configuração de cobrança: a seção Parcela vem antes de Padrões do boleto e grava com a própria permissão', () => {
    const html = fs.readFileSync(path.join(PASTA_HTML, 'configuracao-cobranca.html'), 'utf8');
    const parcela = html.indexOf('id="finCobParcelaSecao"');
    const padroes = html.indexOf('Padrões do boleto</h3>');
    assert.ok(parcela > 0 && padroes > parcela, 'Parcela acima de Padrões do boleto');
    assert.match(html, /id="finCobParcelaSalvar" type="button" data-perm="financeiro\.parcela\.editar"/);
    assert.ok(!/id="finCobParcelaMinima"[^>]*data-fin-cob=/.test(html), 'não vai no Salvar do Sup Admin');
    assert.match(SCRIPT, /fetchApi\('\/api\/cobranca\/parcela-minima'\)/);
    assert.match(SCRIPT, /fetchApi\('\/api\/cobranca\/configuracao\/parcela', \{ method: 'PUT', body: JSON\.stringify\(\{ parcela_minima: valor \}\) \}\)/);
    assert.match(SCRIPT, /ligar\('finCobParcelaSalvar', salvarParcela\)/);
});

test('quem recebe (puras): opções do filtro e a parte de cada um, com os valores recalculados', () => {
    const f = puro();
    const linhas = [
        { pedido: '2548', comissao: 340, cms: 170, royalty: 170, benef_lista: [
            { tipo: 'cms', beneficiario: 'Márcio', valor: 170, percentual: 5 },
            { tipo: 'royalty', beneficiario: 'Ana', valor: 170, percentual: 5 }
        ] },
        { pedido: '2560', comissao: 100, cms: 100, royalty: 0, benef_lista: [
            { tipo: 'cms', beneficiario: 'marcio', valor: 100, percentual: 5 }
        ] },
        { pedido: '2570', comissao: 50, cms: 0, royalty: 50, benef_lista: [] }
    ];
    const opcoes = plano(f.opcoesDeBeneficiario(linhas));
    assert.deepStrictEqual(opcoes.tipos, ['cms', 'royalty']);
    assert.deepStrictEqual(opcoes.pessoas.map(p => p.nome), ['Ana', 'Márcio'], 'uma entrada por pessoa, em ordem');
    assert.strictEqual(opcoes.pessoas.find(p => p.nome === 'Márcio').chave, 'marcio', 'a chave ignora acento e caixa');

    const soRoyalty = plano(f.filtrarPorBeneficiario(linhas, 'tipo:royalty'));
    assert.deepStrictEqual(soRoyalty.map(l => l.pedido), ['2548'], 'fica quem tem royalty');
    assert.deepStrictEqual([soRoyalty[0].cms, soRoyalty[0].royalty, soRoyalty[0].comissao], [0, 170, 170], 'os valores viram a parte do filtro');

    const doMarcio = plano(f.filtrarPorBeneficiario(linhas, 'pessoa:marcio'));
    assert.deepStrictEqual(doMarcio.map(l => l.pedido), ['2548', '2560'], 'o acento não separa a mesma pessoa');
    assert.strictEqual(doMarcio[0].comissao, 170);
    assert.strictEqual(doMarcio[0].beneficiarios, 'Márcio 5%', 'o texto exportado acompanha o filtro');
    assert.strictEqual(plano(f.filtrarPorBeneficiario(linhas, '')).length, 3, 'sem filtro, tudo');
    assert.strictEqual(f.rotuloDoFiltroBenef('tipo:cms', opcoes), 'CMS');
    assert.strictEqual(f.rotuloDoFiltroBenef('pessoa:marcio', opcoes), 'Márcio');

    // O total do relatório passa a ser o do filtro.
    const folha = plano(f.montarRelatorio('previsao-comissoes', { linhas: f.filtrarPorBeneficiario(linhas, 'pessoa:marcio') }));
    assert.strictEqual(folha.totais.comissao, 270);
    assert.ok(folha.colunas.some(c => c.chave === 'beneficiarios' && c.tipo === 'beneficiarios'), 'a folha mostra quem recebe');
});

test('comissões por quem recebe: etiquetas com cor, legenda e filtro nas telas; o pagamento vai por beneficiário', () => {
    // O utilitário das cores é carregado pelo menu e dá a mesma cor à mesma pessoa.
    const util = fs.readFileSync(path.join(RAIZ, 'js', 'utils', 'beneficiarios.js'), 'utf8');
    assert.match(util, /window\.Beneficiarios = \{/);
    assert.match(fs.readFileSync(path.join(RAIZ, 'html', 'menu.html'), 'utf8'), /js\/utils\/beneficiarios\.js/, 'o menu carrega o utilitário');
    assert.match(SCRIPT, /window\.Beneficiarios\.etiqueta\(b\.beneficiario, b\.tipo/, 'a célula "quem recebe" usa a etiqueta comum');

    // Onde aparece: card do módulo, atrasadas, fechar competência, detalhes (parcela e pedido) e relatórios.
    assert.match(MODULO, /function finRenderizarBeneficiarios\(moduleEl, resumo\)/);
    assert.match(fs.readFileSync(path.join(RAIZ, 'html', 'financeiro.html'), 'utf8'), /id="finResumoBeneficiariosLista"/);
    for (const [arquivo, id] of [['comissoes-atrasadas', 'finAtrasadasLegenda'], ['fechar-competencia', 'finFechamentoBeneficiariosLegenda'],
        ['detalhes-parcela', 'finParcelaBeneficiariosLegenda'], ['detalhes-pedido', 'finPedidoParcelasLegenda'], ['visualizar-relatorio', 'finRelatorioLegendaBenef']]) {
        assert.ok(fs.readFileSync(path.join(PASTA_HTML, `${arquivo}.html`), 'utf8').includes(`id="${id}"`), `${arquivo}: sem legenda de quem recebe`);
    }
    assert.match(fs.readFileSync(path.join(PASTA_HTML, 'comissoes-atrasadas.html'), 'utf8'), /id="finAtrasadasQuemRecebe"/, 'atrasadas filtra por quem recebe');
    assert.match(fs.readFileSync(path.join(PASTA_HTML, 'visualizar-relatorio.html'), 'utf8'), /id="finRelatorioQuemRecebe"/, 'a folha filtra por quem recebe');
    assert.match(SCRIPT, /await exportarRelatorio\(formato, mostrado\)/, 'exporta o que está na tela (com o filtro)');

    // Confirmar pagamento: tudo o que falta ou um POST por beneficiário escolhido.
    const pagamento = fs.readFileSync(path.join(PASTA_HTML, 'confirmar-pagamento.html'), 'utf8');
    assert.match(pagamento, /id="finPagamentoTudo" type="checkbox" checked/);
    assert.match(pagamento, /id="finPagamentoBeneficiarios"/);
    assert.match(SCRIPT, /const envios = porPessoa \? alvos\.map\(l => \(\{ \.\.\.base, beneficiario: l\.beneficiario, tipo_comissao: l\.tipo \}\)\) : \[base\];/);
    assert.match(SCRIPT, /confirmarBtn\.classList\.toggle\('hidden', !\(falta > 0\)\);/, 'com saldo, ainda dá para pagar o resto');
    assert.match(SCRIPT, /'Escolha quem foi pago \(ou marque "Pagar tudo o que falta"\)\.'/);
    assert.match(MODULO, /parcial: 'paga em parte'/, 'a competência paga pela metade tem situação própria');
});

test('atividade: Financeiro e SEFAZ numa linha só, do mais novo ao mais antigo, com quem fez', () => {
    const f = puro();
    assert.strictEqual(f.grupoDaAtividade('ajuste_desconto'), 'ajuste');
    assert.strictEqual(f.grupoDaAtividade('producao_registrada'), 'producao');
    assert.strictEqual(f.grupoDaAtividade('competencia_fechada'), 'fechamento');
    assert.strictEqual(f.grupoDaAtividade('pagamento_confirmado'), 'pagamento');
    assert.strictEqual(f.grupoDaAtividade('reembolso_confirmado'), 'pagamento');
    assert.strictEqual(f.grupoDaAtividade('devolucao_registrada'), 'devolucao');
    assert.strictEqual(f.grupoDaAtividade('regra_alterada'), 'regra');
    assert.strictEqual(f.grupoDaAtividade('qualquer', true), 'nfe', 'o que vem da SEFAZ é NF-e');

    const linha = plano(f.juntarAtividade(
        [
            { id: 1, quando: '2026-09-17T13:00:00Z', tipo: 'pagamento_confirmado', rotulo: 'Pagamento confirmado', descricao: 'Comissão paga', valor: 150, usuario_id: 7, usuario: 'Ana Souza' },
            { id: 2, quando: null, tipo: 'ajuste_desconto', rotulo: 'Ajuste' }
        ],
        [{ nota_id: 9, quando: '2026-09-18T10:00:00Z', tipo: 'autorizada', titulo: 'NF-e 123', detalhe: 'Pedido 45' }]
    ));
    assert.deepStrictEqual(linha.map(i => i.id), ['n9-autorizada-0', 'f1'], 'sem data não entra; o mais novo primeiro');
    assert.deepStrictEqual(linha[0], {
        id: 'n9-autorizada-0', quando: '2026-09-18T10:00:00Z', grupo: 'nfe', etiqueta: 'NF-e autorizada', badge: 'badge-success',
        texto: 'NF-e 123 — Pedido 45', valor: null, usuario_id: null, usuario: null, sistema: true
    });
    assert.strictEqual(linha[1].usuario, 'Ana Souza');
    assert.strictEqual(linha[1].etiqueta, 'Pagamento confirmado');
    assert.strictEqual(linha[1].badge, 'badge-success');
    assert.strictEqual(linha[1].valor, 150);

    // Cabeçalho do dia no fuso de quem vê: 01h UTC do dia 18 ainda é dia 17 em Brasília.
    assert.strictEqual(f.diaLocal('2026-09-18T01:00:00Z'), '2026-09-17');
    assert.strictEqual(semNbsp(f.rotuloDoDia('2026-09-18T15:00:00Z', '2026-09-18')), 'Hoje · 18/09/2026');
    assert.strictEqual(semNbsp(f.rotuloDoDia('2026-09-17T15:00:00Z', '2026-09-18')), 'Ontem · 17/09/2026');
    assert.strictEqual(semNbsp(f.rotuloDoDia('2026-09-10T15:00:00Z', '2026-09-18')), '10/09/2026');

    // A bolinha sem foto: primeira e última iniciais.
    assert.strictEqual(f.iniciais('Ana Maria Souza'), 'AS');
    assert.strictEqual(f.iniciais('joão'), 'J');
    assert.strictEqual(f.iniciais(''), '?');

    // O modal: busca, tipo, quem fez e a linha do tempo; lê as duas fontes e as fotos.
    const html = fs.readFileSync(path.join(PASTA_HTML, 'atividade.html'), 'utf8');
    for (const id of ['finAtividadeBusca', 'finAtividadeTipo', 'finAtividadeQuem', 'finAtividadeLinha', 'finAtividadeCarregando', 'finAtividadeVazio']) {
        assert.ok(html.includes(`id="${id}"`), `atividade.html: falta #${id}`);
    }
    assert.match(SCRIPT, /fetchApi\('\/api\/financeiro\/atividade\?limite=300'\)/);
    assert.match(SCRIPT, /fetchApi\('\/api\/fiscal\/atividade\?limite=200'\)/);
    assert.match(SCRIPT, /finAtividade: montarAtividade/);
});

test('spinner da casa: o modal só aparece depois da primeira leitura, com tempo mínimo', () => {
    // O módulo põe o spinner ANTES de abrir o modal (o mesmo desenho dos outros módulos)...
    assert.match(MODULO, /finSpinnerDoModal\(modal\.overlay\);\s*window\.Modal\.open\(modal\.html/);
    assert.match(MODULO, /const FIN_SPINNER_MINIMO_MS = 1000;/);
    assert.match(MODULO, /indicador\.className = 'app-loading-indicator app-loading-indicator--compact';/);
    assert.match(MODULO, /orbita\.className = 'module-loading-orbit';/);
    assert.match(MODULO, /limite = setTimeout\(\(\) => registro\.remover\(\), FIN_SPINNER_MAXIMO_MS\);/, 'nunca fica para sempre');
    // ...e o modal chama quando terminou de montar (dê certo ou errado).
    assert.match(SCRIPT, /\.finally\(\(\) => \{\s*if \(typeof window\.FinanceiroModalPronto === 'function'\) window\.FinanceiroModalPronto\(overlayId, revelar\);/);
    // A carga dentro do modal (trocar filtro) é uma linha só com o spinner, não esqueleto.
    assert.match(SCRIPT, /fin-linha-carregando/);
});

test('comissões do mês (dono, 24/09/2026): "Previsto no mês" = previstas + atrasadas; a previsão mostra a situação; o modal das atrasadas segue o mês', () => {
    const TELA = fs.readFileSync(path.join(RAIZ, 'html', 'financeiro.html'), 'utf8');
    assert.match(TELA, /<dt[^>]*>Previsto no mês<\/dt><dd data-fin="resumoComissoes\.previstoMes">/);
    assert.ok(MODULO.includes("finPreencher(moduleEl, 'resumoComissoes.previstoMes', finFormatarMoeda(c.previstoMes));"));
    assert.ok(MODULO.includes('rc.previsto_mes'), 'o valor vem do painel (previstas + atrasadas)');
    const inicio = SCRIPT.indexOf("'previsao-comissoes': {");
    const previsao = SCRIPT.slice(inicio, SCRIPT.indexOf("'comissoes-atrasadas': {", inicio));
    assert.ok(previsao.includes("{ chave: 'situacao', rotulo: 'Situação' }"), 'prevista ou atrasada, com os dias');
    assert.ok(SCRIPT.includes("el('finAtrasadasSubtitulo').textContent"), 'o modal diz de que mês e de quando é a foto');
    const atrasadasHtml = fs.readFileSync(path.join(PASTA_HTML, 'comissoes-atrasadas.html'), 'utf8');
    assert.ok(atrasadasHtml.includes('id="finAtrasadasSubtitulo"'));
});
