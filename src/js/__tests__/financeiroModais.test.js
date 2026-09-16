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
    'aguardando-nfe': 'finAguardandoNfe',
    'notas-fiscais': 'finNotasFiscais',
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
    'configuracao-fiscal': 'finConfiguracaoFiscal',
    'configuracao-cobranca': 'finConfiguracaoCobranca',
    'recebimentos': 'finRecebimentos'
};
/* Os de ação têm Cancelar + ação principal; os de consulta fecham com "Fechar". */
const DE_ACAO = ['registrar-ajuste', 'registrar-producao', 'fechar-competencia', 'relatorios', 'confirmar-pagamento'];

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
        } else if (arquivo === 'registrar-recebimento') {
            // De ação e REAL: Cancelar e a ação de verdade, sem o aviso "em implementação".
            assert.match(html, /btn-danger[^>]*>Cancelar</, `${arquivo}: Cancelar no padrão`);
            assert.ok(!/data-fin-principal/.test(html), `${arquivo}: nada aqui é "em implementação"`);
            assert.match(html, /id="finRecebimentoRegistrar" type="button" data-perm="financeiro\.recebimento\.registrar" class="btn-success/);
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
    for (const chave of ['registrar-recebimento', 'registrar-ajuste', 'registrar-producao', 'fechar-competencia', 'relatorios']) {
        assert.match(MODULO, new RegExp(`'${chave}': \\{ rotulo: '[^']+', abrir: m => finAbrirModal\\('${chave}', m\\) \\}`));
    }
    // Os fiscais recebem o `extra` da linha clicada (o filtro de uma pendência).
    assert.match(MODULO, /'emitir-nfe': \{ rotulo: 'Emitir NF-e', abrir: \(m, extra\) => finAbrirModal\('aguardando-nfe', m, extra\) \}/);
    assert.match(MODULO, /'aguardando-nf': \{ rotulo: '[^']+', abrir: \(m, extra\) => finAbrirModal\('aguardando-nfe', m, extra\) \}/);
    assert.match(MODULO, /'notas-fiscais': \{ rotulo: 'Notas fiscais', abrir: \(m, extra\) => finAbrirModal\('notas-fiscais', m, extra\) \}/);
    assert.match(MODULO, /'atividade-todas': \{ rotulo: '[^']+', abrir: m => finAbrirModal\('notas-fiscais', m\) \}/);
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
        // "Pedidos aguardando NF-e" é real: as linhas vêm do painel fiscal.
        const r = plano(f.montarRelatorio(chave, chave === 'aguardando-nf' ? { linhas: f.linhasDoRelatorioAguardando(PAINEL) } : {}));
        assert.ok(r && r.linhas.length > 0, `relatório "${chave}" sem folha ou sem linhas`);
        assert.ok(r.colunas.length >= 4, `relatório "${chave}" com poucas colunas`);
    }
    assert.strictEqual(plano(f.montarRelatorio('comissoes-apuradas')).totais.comissao, 18450);
    assert.strictEqual(plano(f.montarRelatorio('previsao-comissoes')).totais.comissao, 32500);
    const aguardando = plano(f.montarRelatorio('aguardando-nf', { linhas: f.linhasDoRelatorioAguardando(PAINEL) }));
    assert.strictEqual(aguardando.totais.valor, 1900, 'o dispensado (S/NF) não entra no relatório');
    assert.strictEqual(aguardando.linhas.length, 2);
    assert.deepStrictEqual(aguardando.linhas[0], { pedido: '2540', pedido_id: 1, cliente: 'Casa Vicenzo', entrega: '2026-09-10', condicao: '3x · Boleto', dias: 6, valor: 1500 });
    assert.strictEqual(aguardando.colunas[0].tipo, 'pedido-real', 'o número abre o Visualizar pedido de verdade');
    assert.deepStrictEqual(plano(f.montarRelatorio('aguardando-nf')).linhas, [], 'sem painel, sem linhas de exemplo');
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
    assert.deepStrictEqual(plano(f.resumoDeNotas(f.filtrarNotas(notas, { competencia: '2026-09' }))), { emitidas: 3, autorizadas: 1, canceladas: 0, valor: 800 });

    assert.strictEqual(f.condicaoDoPedido({ parcelas: 3, forma_pagamento: 'Boleto' }), '3x · Boleto');
    assert.strictEqual(f.condicaoDoPedido({ parcelas: 1 }), 'À vista');
    assert.strictEqual(f.condicaoDoPedido({ parcelas: null, forma_pagamento: 'Pix' }), 'À vista · Pix');

    assert.deepStrictEqual(plano(f.linhasAguardando(PAINEL)).map(l => l.numero), ['2540', '2544'], 'o dispensado (S/NF) fica de fora por padrão');
    assert.deepStrictEqual(plano(f.linhasAguardando(PAINEL, { incluirDispensados: true })).map(l => l.numero), ['2540', '2543', '2544']);
    assert.deepStrictEqual(plano(f.linhasAguardando(PAINEL, { busca: 'serrana' })).map(l => l.numero), ['2544']);
    assert.deepStrictEqual(plano(f.linhasAguardando(null)), []);
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
    assert.ok(!/<button[^>]*>\s*<i class="fas/.test(notas) && !/<button[^>]*>\s*<i class="fas/.test(aguardando), 'botões só com texto, sem ícone');

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
    assert.ok(!/CMS|Royalty|Comprovante/.test(registrar), 'sem o que ainda não existe (comissões, comprovante)');
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
    assert.ok(!/data-fin-principal/.test(lista) && !/<button[^>]*>\s*<i class="fas/.test(lista));

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
    assert.match(SCRIPT, /new Set\(\['finAguardandoNfe', 'finNotasFiscais', 'finConfiguracaoFiscal', 'finConfiguracaoCobranca', 'finRecebimentos', 'finRegistrarRecebimento'\]\)/, 'fechar relê o painel');
    assert.ok(!/window\.confirm\(/.test(SCRIPT));

    // O módulo: os cartões abrem a lista na visão certa; "Registrar recebimento" pede a permissão.
    assert.match(MODULO, /'recebimentos-atraso': \{ rotulo: 'Recebimentos', abrir: m => finAbrirModal\('recebimentos', m, \{ visao: 'em_atraso' \}\) \}/);
    assert.match(MODULO, /'recebimentos-boletos': \{[^}]*filtro: \{ boleto: 'aberto' \}/);
    const tela = fs.readFileSync(path.join(RAIZ, 'html', 'financeiro.html'), 'utf8');
    assert.match(tela, /data-perm="financeiro\.recebimento\.registrar" data-fin-acao="registrar-recebimento"/);
    assert.match(tela, /data-perm-hide="financeiro\.recebimento\.view"/, 'a faixa some para quem não vê recebimentos');
    assert.match(tela, /data-perm="financeiro\.recebimento\.view" data-fin-acao="conciliar"/);
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
