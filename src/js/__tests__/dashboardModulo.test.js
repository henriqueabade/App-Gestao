process.env.TZ = 'America/Sao_Paulo';
// Fuso fixo ANTES de qualquer Date: os testes de "hora local" e de "DATE sem
// escorregar" só pegam a regressão num fuso negativo. Rodados em UTC (ou num
// fuso positivo) passariam com getUTCHours / new Date('2026-09-15').

/**
 * Dashboard com dados reais (src/js/dashboard.js, html/dashboard.html,
 * css/dashboard.css).
 *
 * O painel anterior era inteiro inventado — números sorteados, pedidos
 * fictícios, selo de demonstração — e sobreviveu porque número falso não gera
 * erro nenhum. Aqui as funções puras rodam de verdade numa VM (formatação,
 * variação, geometria dos gráficos, textos de prazo) e, por leitura dos
 * arquivos, conferimos as armadilhas do carregador de módulos (src/js/menu.js):
 * script reinjetado a cada visita, listener acumulado, máscara que precisa de
 * uma promessa para esperar.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', '..');
const FONTE_JS = fs.readFileSync(path.join(SRC, 'js', 'dashboard.js'), 'utf8');
const FONTE_HTML = fs.readFileSync(path.join(SRC, 'html', 'dashboard.html'), 'utf8');
const FONTE_CSS = fs.readFileSync(path.join(SRC, 'css', 'dashboard.css'), 'utf8');

/** O Intl separa "R$" do número com espaço que não quebra; comparamos com espaço comum. */
const semEspacoFixo = texto => String(texto).split(String.fromCharCode(0x00a0)).join(' ');
// `secoes` é opcional: sem nenhuma seção montada o selo diz "Sem leitura", então
// quem confere a hora no selo precisa mandar pelo menos uma.
const respostaVazia = (geradoEm, secoes = {}) => ({
    ok: true,
    status: 200,
    json: async () => ({ geradoEm, hoje: '2026-09-13', mesAtual: '2026-09', secoes, falhas: {} })
});

/** Elemento do módulo com o mínimo que o ciclo de vida toca. */
function criarModuloFalso({ selo = null } = {}) {
    const classes = new Set();
    return {
        dataset: {},
        isConnected: true,
        classList: {
            toggle: (classe, ativo) => (ativo ? classes.add(classe) : classes.delete(classe)),
            contains: classe => classes.has(classe),
            add: classe => classes.add(classe),
            remove: classe => classes.delete(classe)
        },
        addEventListener() {},
        querySelector: seletor => (seletor === '[data-dash-atualizado]' ? selo : null),
        querySelectorAll: () => []
    };
}

function criarContexto({ modulo = null, fetch = null } = {}) {
    const ouvintes = [];
    const chamadas = [];
    const contexto = {
        window: { apiConfig: { getApiBaseUrl: async () => 'http://bff.local' } },
        document: {
            querySelector: seletor => (seletor === '#content .dashboard-module' ? modulo : null),
            querySelectorAll: () => [],
            addEventListener: (tipo, fn) => ouvintes.push({ tipo, fn })
        },
        console: { log() {}, warn() {}, error() {}, info() {} },
        Intl,
        setTimeout,
        clearTimeout,
        fetch: fetch || (async url => {
            chamadas.push(url);
            return respostaVazia('2026-09-13T15:04:05.000Z');
        })
    };
    contexto.globalThis = contexto;
    vm.createContext(contexto);
    return { contexto, ouvintes, chamadas };
}

function carregar(opcoes) {
    const ambiente = criarContexto(opcoes);
    vm.runInContext(FONTE_JS, ambiente.contexto);
    ambiente.avaliar = expressao => vm.runInContext(expressao, ambiente.contexto);
    return ambiente;
}

const esperarFila = () => new Promise(resolve => setImmediate(resolve));
const { avaliar } = carregar();

// ------------------------------------------------------------- formatação

test('moeda sai no padrão brasileiro e valor nulo nunca vira "R$ 0,00"', () => {
    const moeda = avaliar('formatarMoeda');
    assert.strictEqual(semEspacoFixo(moeda(84500.5)), 'R$ 84.500,50');
    assert.strictEqual(semEspacoFixo(moeda(0)), 'R$ 0,00', 'zero de verdade continua zero');
    // null = sem a coluna de valor no perfil: quem chama esconde o R$.
    assert.strictEqual(moeda(null), '');
    assert.strictEqual(moeda(undefined), '');
    assert.strictEqual(moeda('1.234,56'), '', 'texto que não é número não vira NaN na tela');
});

test('moeda compacta usa vírgula e troca de unidade sem mostrar "1.000 mil"', () => {
    const compacta = avaliar('formatarMoedaCompacta');
    assert.strictEqual(semEspacoFixo(compacta(12400)), 'R$ 12,4 mil');
    assert.strictEqual(semEspacoFixo(compacta(150000)), 'R$ 150 mil');
    assert.strictEqual(semEspacoFixo(compacta(999960)), 'R$ 1 mi');
    assert.strictEqual(semEspacoFixo(compacta(1234567)), 'R$ 1,2 mi');
    assert.strictEqual(semEspacoFixo(compacta(950)), 'R$ 950,00', 'abaixo de mil mostra o valor inteiro');
    assert.strictEqual(compacta(null), '');
});

test('KPI em dinheiro não mostra centavos e usa o sinal de menos tipográfico', () => {
    const destaque = avaliar('formatarMoedaDestaque');
    assert.strictEqual(semEspacoFixo(destaque(84500.5)), 'R$ 84.501');
    assert.strictEqual(semEspacoFixo(destaque(-3200)), '−R$ 3.200');
    assert.strictEqual(destaque(null), '');
});

test('percentual, número e saldo de insumo com a unidade dele', () => {
    assert.strictEqual(avaliar('formatarPercentual')(0.72), '72%');
    assert.strictEqual(avaliar('formatarPercentual')(0.125), '12,5%');
    assert.strictEqual(avaliar('formatarNumero')(1247), '1.247');
    assert.strictEqual(semEspacoFixo(avaliar('formatarQuantidade')(-3.5, 'L')), '−3,5 L');
    assert.strictEqual(avaliar('pluralizar')(1, 'pedido', 'pedidos'), '1 pedido');
    assert.strictEqual(avaliar('pluralizar')(12, 'pedido', 'pedidos'), '12 pedidos');
});

test('saldo negativo pequeno de insumo não vira "−0 kg"', () => {
    // O saldo é gravado com 4 casas (backend/materiaPrima.js): 0,5 − 0,5035 = −0,0035.
    const quantidade = avaliar('formatarQuantidade');
    assert.strictEqual(semEspacoFixo(quantidade(-0.0035, 'kg')), '−0,0035 kg');
    assert.strictEqual(semEspacoFixo(quantidade(-0.005, 'kg')), '−0,005 kg', 'nada de arredondar para o dobro do déficit');
    assert.strictEqual(semEspacoFixo(quantidade(-3.5, 'L')), '−3,5 L');
    assert.strictEqual(quantidade(-2, null), '−2', 'sem unidade (coluna escondida) fica só o número');
    assert.strictEqual(quantidade(null, 'kg'), '');
    // Contagens e KPIs continuam com 2 casas.
    assert.strictEqual(avaliar('formatarNumero')(1.23456), '1,23');
});

test('variação percentual: alta, queda, estável e referência zero sem "Infinity%"', () => {
    const variacao = avaliar('calcularVariacao');
    const texto = avaliar('textoVariacao');

    const alta = variacao(120, 100);
    assert.strictEqual(alta.tipo, 'alta');
    assert.strictEqual(texto(alta), '+20%');

    const queda = variacao(90, 100);
    assert.strictEqual(queda.tipo, 'baixa');
    assert.strictEqual(texto(queda), '−10%');

    assert.strictEqual(texto(variacao(100.02, 100)), '0%', 'ruído de centavos não ganha seta');
    assert.strictEqual(texto(variacao(0, 0)), '0%');

    const semBase = variacao(5000, 0);
    assert.strictEqual(semBase.tipo, 'alta');
    assert.strictEqual(semBase.fracao, null);
    assert.strictEqual(texto(semBase), 'sem base');

    // Sem permissão para valores um dos lados vem null: não há o que comparar.
    assert.strictEqual(variacao(null, 100), null);
    assert.strictEqual(variacao(100, null), null);
    assert.strictEqual(texto(null), '');
});

test('rótulos de mês curtos em pt-BR, montados pela string', () => {
    assert.strictEqual(avaliar('rotuloMes')('2026-09'), 'set/26');
    assert.strictEqual(avaliar('rotuloMes')('2025-10'), 'out/25');
    assert.strictEqual(avaliar('rotuloMes')('2026-02'), 'fev/26');
    assert.strictEqual(avaliar('rotuloMesLongo')('2026-03'), 'março de 2026');
});

test('coluna DATE vira dd/mm sem escorregar para o dia anterior', () => {
    const data = avaliar('formatarDataCurta');
    // Meia-noite UTC do dia 13 é noite do dia 12 em São Paulo: não pode virar 12.
    assert.strictEqual(data('2026-09-13T00:00:00.000Z'), '13/09');
    assert.strictEqual(data('2026-09-15'), '15/09');
    assert.strictEqual(data(''), '');
    assert.strictEqual(data(null), '');
});

test('"Atualizado às" usa a hora local do instante geradoEm', () => {
    const hora = avaliar('horaAtualizacao');
    assert.strictEqual(hora(new Date(2026, 8, 13, 15, 4, 5).toISOString()), '15:04');
    assert.strictEqual(hora(new Date(2026, 8, 13, 7, 9).toISOString()), '07:09');
    assert.strictEqual(hora('não é data'), '');
    assert.strictEqual(hora(null), '');
});

test('textos de prazo, follow-up e idade no singular e no plural', () => {
    const prazo = avaliar('textoPrazo');
    assert.strictEqual(prazo(0), 'vence hoje');
    assert.strictEqual(prazo(1), 'vence amanhã');
    assert.strictEqual(prazo(2), 'vence em 2 dias');
    assert.strictEqual(prazo(7), 'vence em 7 dias');

    const followup = avaliar('textoFollowup');
    assert.strictEqual(followup(-3), 'atrasado há 3 dias');
    assert.strictEqual(followup(-1), 'atrasado há 1 dia');
    assert.strictEqual(followup(0), 'para hoje');

    const idade = avaliar('textoIdade');
    assert.strictEqual(idade(74), 'há 74 dias');
    assert.strictEqual(idade(1), 'há 1 dia');
});

test('lista cortada mostra "+N" com o total real menos os exibidos', () => {
    const mais = avaliar('textoMais');
    assert.strictEqual(mais(8, 5), '+3');
    assert.strictEqual(mais(5, 5), '');
    assert.strictEqual(mais(3, 5), '', 'lista inteira não ganha "+N"');
});

test('o "—" que o servidor põe no lugar de nome vazio não conta como nome', () => {
    // backend/dashboardResumo.js troca dono, prospecção e insumo sem nome por "—".
    const informado = avaliar('textoInformado');
    assert.strictEqual(informado('—'), '');
    assert.strictEqual(informado(' — '), '');
    assert.strictEqual(informado(null), '');
    assert.strictEqual(informado(undefined), '');
    assert.strictEqual(informado('  Ana '), 'Ana');
});

// ---------------------------------------------------------------- gráficos

test('escala do eixo é redonda, cobre o maior valor e não fraciona pedidos', () => {
    const escala = avaliar('escalaEixo');

    const dinheiro = escala(84500);
    assert.strictEqual(dinheiro.topo, 100000);
    assert.strictEqual(dinheiro.marcas.length, 5);
    dinheiro.marcas.forEach((marca, i) => assert.strictEqual(marca, i * dinheiro.passo));

    for (const maximo of [1, 3, 7, 23]) {
        const contagem = escala(maximo, { inteiro: true });
        assert.ok(contagem.topo >= maximo, `topo ${contagem.topo} < ${maximo}`);
        contagem.marcas.forEach(marca => assert.ok(Number.isInteger(marca), `marca ${marca} fracionada`));
    }
});

/** Só a série de vendas (perfil sem a previsão): uma coluna por mês, sem verde. */
const soVendas = serie => avaliar('colunasDoGrafico')(serie, []);

test('barras dos 12 meses cabem na área, nascem da base e o mês fraco continua visível', () => {
    const geometria = avaliar('geometriaGrafico');
    const serie = Array.from({ length: 12 }, (_, i) => ({
        mes: `2026-${String(i + 1).padStart(2, '0')}`,
        quantidade: i === 0 ? 0 : 1,
        valor: i === 11 ? 84500 : i === 3 ? 50 : i === 0 ? 0 : 20000
    }));
    const geo = geometria(soVendas(serie), { largura: 600, altura: 240, chave: 'valor' });
    const barras = geo.colunas.map(coluna => coluna.vendas);

    assert.strictEqual(barras.length, 12);
    assert.strictEqual(geo.grade.length, 5, 'linha de base + 4 linhas de grade');
    assert.ok(geo.escala.topo >= 84500);
    const limiteDireito = geo.largura - geo.margem.direita;
    barras.forEach((barra, i) => {
        assert.ok(barra.x >= geo.margem.esquerda && barra.x + barra.largura <= limiteDireito + 1e-9, `barra ${i} fora da área`);
        assert.ok(barra.y >= geo.topoY - 1e-9, `barra ${i} passa do topo`);
        assert.ok(Math.abs(barra.y + barra.altura - geo.baseY) < 1e-9, `barra ${i} não nasce na base`);
        if (i > 0) {
            const anterior = barras[i - 1];
            assert.ok(anterior.x + anterior.largura <= barra.x, `barras ${i - 1} e ${i} se sobrepõem`);
        }
    });
    assert.strictEqual(barras[0].altura, 0, 'mês sem venda não desenha barra');
    assert.ok(barras[3].altura >= 3, 'R$ 50 perto de R$ 84 mil ainda aparece');
});

test('sem a previsão o gráfico é o de antes: uma barra de ouro centrada por mês e nenhum separador', () => {
    // O dono já usa este gráfico: quem não vê a previsão não pode notar diferença.
    const geo = avaliar('geometriaGrafico')(soVendas(amostraDoContrato().secoes.vendas.serie12m),
        { largura: 600, altura: 240, mesAtual: '2026-09' });
    const banda = (600 - 48 - 8) / 12;
    const largura = Math.min(banda * 0.62, 46);
    assert.strictEqual(geo.agrupado, false);
    assert.strictEqual(geo.separadorX, null);
    assert.strictEqual(geo.indiceAtual, 11);
    geo.colunas.forEach((coluna, i) => {
        assert.strictEqual(coluna.previsao, null, `mês ${i} ganhou barra verde`);
        assert.strictEqual(coluna.futura, false);
        assert.ok(Math.abs(coluna.vendas.largura - largura) < 1e-9);
        assert.ok(Math.abs(coluna.vendas.x - (48 + i * banda + (banda - largura) / 2)) < 1e-9, `barra ${i} fora do centro`);
        assert.deepStrictEqual({ ...coluna.vendas.alvo }, { x: 48 + i * banda, largura: banda }, 'o alvo continua a banda inteira');
    });
});

test('em cartão estreito os rótulos alternam, mas o mês atual nunca perde o nome', () => {
    const geometria = avaliar('geometriaGrafico');
    const serie = Array.from({ length: 12 }, (_, i) => ({ mes: `2026-${String(i + 1).padStart(2, '0')}`, valor: 10 }));
    const estreito = geometria(soVendas(serie), { largura: 300, altura: 240 });
    assert.strictEqual(estreito.colunas[11].mostrarRotulo, true);
    assert.strictEqual(estreito.colunas[10].mostrarRotulo, false);
    assert.strictEqual(estreito.colunas[9].mostrarRotulo, true);
    const largo = geometria(soVendas(serie), { largura: 900, altura: 240 });
    assert.ok(largo.colunas.every(coluna => coluna.mostrarRotulo));
});

test('rótulos de mês nunca ficam a menos de 40 px um do outro', () => {
    // Banda de 36 px: o limiar fixo antigo (34 px) mostrava os 12 nomes, e o
    // mais largo ("set/26", ~38 px) encostava no vizinho.
    const geometria = avaliar('geometriaGrafico');
    const serie = Array.from({ length: 12 }, (_, i) => ({ mes: `2026-${String(i + 1).padStart(2, '0')}`, valor: 10 }));
    for (const largura of [200, 300, 488, 530, 640, 900]) {
        const geo = geometria(soVendas(serie), { largura, altura: 240 });
        const centros = geo.colunas.filter(coluna => coluna.mostrarRotulo).map(coluna => coluna.centro);
        assert.strictEqual(geo.colunas[11].mostrarRotulo, true, `${largura}px: o mês atual perdeu o nome`);
        for (let i = 1; i < centros.length; i += 1) {
            assert.ok(centros[i] - centros[i - 1] >= 40 - 1e-9, `${largura}px: rótulos a ${centros[i] - centros[i - 1]} px`);
        }
    }
    assert.strictEqual(geometria(soVendas(serie), { largura: 488 }).colunas[10].mostrarRotulo, false, 'banda de 36 px já alterna');
});

// ------------------------------------------------ previsão de faturamento

/**
 * Parcelas REAIS do banco (SPEC-previsao §2), com agora = 2026-09-14: a janela
 * vai de out/25 a jan/27 (16 meses, a última parcela é de jan/27). A amostra
 * só traz ids: números de pedido e nomes de cliente são ilustrativos, menos
 * "PED105 · Vetri", que é o exemplo do SPEC para o pedido 96.
 */
const PARCELAS_REAIS = [
    [90, 1, 3327.01, '2026-08-21'], [90, 2, 3327.01, '2026-09-20'], [90, 3, 3327.01, '2026-10-20'],
    [90, 4, 3327.01, '2026-11-19'], [90, 5, 3327.01, '2026-12-19'], [90, 6, 3327.01, '2027-01-18'],
    [91, 1, 3326.51, '2026-08-28'], [91, 2, 3326.51, '2026-09-27'], [91, 3, 3326.51, '2026-10-27'],
    [91, 4, 3326.51, '2026-11-26'], [91, 5, 3326.51, '2026-12-26'], [91, 6, 3326.51, '2027-01-25'],
    [95, 1, 12774.28, '2026-09-04'],
    [96, 1, 1731.30, '2026-10-02'], [96, 2, 1731.29, '2026-10-16'], [96, 3, 1731.29, '2026-10-30'],
    [99, 1, 2006.68, '2026-10-10'], [99, 2, 2006.68, '2026-10-24'],
    [98, 1, 3490.55, '2026-10-10'], [98, 2, 3490.55, '2026-10-24'], [98, 3, 3490.54, '2026-11-07'],
    [92, 1, 1891.55, '2026-09-30'], [92, 2, 1891.54, '2026-10-14'],
    [93, 1, 2700.53, '2026-09-12']
];
const PEDIDOS_REAIS = {
    90: ['PED99', 'Casa Aurora'], 91: ['PED100', 'Móveis Vicenzo'], 92: ['PED101', 'Ana Ribeiro Interiores'],
    93: ['PED102', 'Loja Solar'], 95: ['PED104', 'Atelier Lume'], 96: ['PED105', 'Vetri'],
    98: ['PED107', 'Studio Ferraz'], 99: ['PED108', 'Casa Bela Decorações ME']
};
const MESES_PREVISAO = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
    '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01'];
const centavos = valor => Math.round(valor * 100) / 100;

/** A seção `previsao` que o BFF monta com a amostra real, na forma do contrato (SPEC-previsao §5). */
function previsaoDaAmostraReal() {
    const totalDoPedido = id => PARCELAS_REAIS.filter(([pedido]) => pedido === id).length;
    const meses = MESES_PREVISAO.map(mes => {
        const doMes = PARCELAS_REAIS.filter(([, , , vencimento]) => vencimento.startsWith(mes));
        const porPedido = new Map();
        for (const [pedidoId, numero, valor, vencimento] of doMes) {
            if (!porPedido.has(pedidoId)) {
                const [numeroPedido, cliente] = PEDIDOS_REAIS[pedidoId];
                porPedido.set(pedidoId, {
                    pedidoId, numero: numeroPedido, cliente, totalParcelas: totalDoPedido(pedidoId),
                    valor: 0, estimada: false, parcelas: []
                });
            }
            const item = porPedido.get(pedidoId);
            item.valor += valor;
            item.parcelas.push({ numero, vencimento, valor });
        }
        // Ordem do contrato: 1º vencimento do mês, depois o número do pedido.
        const itens = [...porPedido.values()]
            .map(item => ({ ...item, valor: centavos(item.valor) }))
            .sort((a, b) => a.parcelas[0].vencimento.localeCompare(b.parcelas[0].vencimento) || a.numero.localeCompare(b.numero));
        return {
            mes,
            valor: centavos(doMes.reduce((soma, [, , valor]) => soma + valor, 0)),
            parcelas: doMes.length,
            pedidos: itens.length,
            outros: Math.max(0, itens.length - 8),
            itens: itens.slice(0, 8)
        };
    });
    return {
        meses,
        programadoDesteMes: centavos(meses.filter(m => m.mes >= '2026-09').reduce((soma, m) => soma + m.valor, 0)),
        alemDoHorizonte: { valor: 0, parcelas: 0, ate: null },
        semParcelas: { pedidos: 0, valor: 0 },
        orfas: 0,
        semData: 0
    };
}

test('a amostra real de parcelas bate com a conta feita à mão', () => {
    // Confere o próprio fixture antes de usá-lo: out/26 = 3327,01 + 3326,51 +
    // (3 × PED105 = 5193,88) + 4013,36 + 6981,10 + 1891,54.
    const previsao = previsaoDaAmostraReal();
    const mes = chave => previsao.meses.find(m => m.mes === chave);
    assert.deepStrictEqual([mes('2026-10').valor, mes('2026-10').parcelas, mes('2026-10').pedidos], [24733.4, 10, 6]);
    assert.deepStrictEqual([mes('2026-09').valor, mes('2026-09').parcelas, mes('2026-09').pedidos], [24019.88, 5, 5]);
    assert.deepStrictEqual([mes('2026-08').valor, mes('2026-11').valor, mes('2027-01').valor], [6653.52, 10144.06, 6653.52]);
    assert.strictEqual(previsao.programadoDesteMes, 72204.38, 'set/26 + out + nov + dez + jan/27');
    assert.strictEqual(mes('2026-10').itens[0].valor, 5193.88);
});

test('com a previsão cada mês tem ouro à esquerda e verde à direita, e os meses futuros só a verde', () => {
    const colunas = avaliar('colunasDoGrafico')(amostraDoContrato().secoes.vendas.serie12m, previsaoDaAmostraReal().meses);
    // Espalhado: a lista nasce dentro da VM, com outro Array.prototype.
    assert.deepStrictEqual([...colunas].map(coluna => coluna.mes), MESES_PREVISAO, 'eixo X = 12 meses passados + futuros, sem buraco');
    const geo = avaliar('geometriaGrafico')(colunas, { largura: 720, altura: 240, mesAtual: '2026-09', margem: { esquerda: 52 } });

    assert.strictEqual(geo.agrupado, true);
    assert.strictEqual(geo.indiceAtual, 11);
    assert.ok(geo.colunas[11].atual && geo.colunas[11].mostrarRotulo, 'o mês atual continua destacado e com nome');
    assert.ok(Math.abs(geo.separadorX - (52 + 12 * geo.banda)) < 1e-9, 'a linha tracejada fica logo depois do mês atual');
    const deslocamentoVerde = geo.colunas[0].previsao.x - geo.colunas[0].banda.x;
    geo.colunas.forEach((coluna, i) => {
        const fim = coluna.banda.x + coluna.banda.largura;
        assert.strictEqual(coluna.futura, i > 11);
        assert.ok(coluna.previsao, `${coluna.mes} sem barra verde`);
        assert.strictEqual(coluna.vendas === null, i > 11, `${coluna.mes}: venda fechada só no passado`);
        for (const barra of [coluna.vendas, coluna.previsao].filter(Boolean)) {
            assert.ok(barra.x >= coluna.banda.x - 1e-9 && barra.x + barra.largura <= fim + 1e-9, `${coluna.mes}: barra fora da banda`);
            assert.ok(Math.abs(barra.y + barra.altura - geo.baseY) < 1e-9, `${coluna.mes}: barra não nasce na base`);
        }
        // Verde sempre no mesmo lugar, inclusive nos futuros: o vão à esquerda é a informação.
        assert.ok(Math.abs(coluna.previsao.x - coluna.banda.x - deslocamentoVerde) < 1e-9, `${coluna.mes}: verde fora do lugar`);
        if (coluna.vendas) {
            assert.ok(coluna.vendas.x + coluna.vendas.largura <= coluna.previsao.x, `${coluna.mes}: ouro não fica à esquerda`);
            assert.deepStrictEqual({ ...coluna.vendas.alvo }, { x: coluna.banda.x, largura: coluna.banda.largura / 2 });
            assert.deepStrictEqual({ ...coluna.previsao.alvo }, { x: coluna.banda.x + coluna.banda.largura / 2, largura: coluna.banda.largura / 2 });
        } else {
            assert.deepStrictEqual({ ...coluna.previsao.alvo }, { ...coluna.banda }, 'sozinha, a verde tem a banda inteira como alvo');
        }
    });
    assert.strictEqual(geo.colunas[0].previsao.altura, 0, 'mês sem parcela não desenha barra verde');
});

test('o eixo Y cobre as duas séries: o topo acompanha a maior barra, seja ouro ou verde', () => {
    const colunasDoGrafico = avaliar('colunasDoGrafico');
    const geometria = avaliar('geometriaGrafico');
    // Previsão maior que qualquer venda: escalar só pelas vendas cortaria a verde.
    const alta = geometria(colunasDoGrafico(
        [{ mes: '2026-08', quantidade: 2, valor: 10000 }, { mes: '2026-09', quantidade: 3, valor: 20000 }],
        [{ mes: '2026-08', valor: 5000 }, { mes: '2026-09', valor: 7000 }, { mes: '2026-10', valor: 150000 }]
    ), { largura: 400, altura: 240, mesAtual: '2026-09' });
    assert.strictEqual(alta.maximo, 150000);
    assert.ok(alta.escala.topo >= 150000);
    const verde = alta.colunas[2].previsao;
    assert.ok(verde.y >= alta.topoY - 1e-9, 'a verde mais alta não passa do topo');
    assert.ok(Math.abs(verde.altura - (150000 / alta.escala.topo) * alta.areaAltura) < 1e-9);
    assert.ok(Math.abs(alta.colunas[1].vendas.altura - (20000 / alta.escala.topo) * alta.areaAltura) < 1e-9,
        'o ouro usa a mesma escala');
    // Vendas maiores: o topo acompanha o ouro (84 mil na amostra; a previsão vai a 24,7 mil).
    const real = geometria(colunasDoGrafico(amostraDoContrato().secoes.vendas.serie12m, previsaoDaAmostraReal().meses),
        { largura: 720, mesAtual: '2026-09' });
    assert.strictEqual(real.maximo, 84000);
    assert.strictEqual(real.escala.topo, 100000);
});

test('só a previsão (sem vendas): uma série verde centrada; sem mês futuro não há separador', () => {
    const colunasDoGrafico = avaliar('colunasDoGrafico');
    const geometria = avaliar('geometriaGrafico');
    const meses = previsaoDaAmostraReal().meses;
    const passado = geometria(colunasDoGrafico([], meses.slice(0, 12)), { largura: 600, mesAtual: '2026-09' });
    const banda = (600 - 48 - 8) / 12;
    assert.strictEqual(passado.agrupado, false);
    assert.strictEqual(passado.separadorX, null, 'fim da janela = mês atual: nada a separar');
    passado.colunas.forEach((coluna, i) => {
        assert.strictEqual(coluna.vendas, null);
        assert.ok(Math.abs(coluna.previsao.x - (48 + i * banda + (banda - Math.min(banda * 0.62, 46)) / 2)) < 1e-9);
    });
    // Sem `mesAtual` na resposta, o atual é o 12º mês: os 12 primeiros da previsão são os da série de vendas.
    const semMes = geometria(colunasDoGrafico([], meses), { largura: 600 });
    assert.strictEqual(semMes.indiceAtual, 11);
    assert.notStrictEqual(semMes.separadorX, null);
});

test('com meses futuros os rótulos contam a partir do mês atual e mantêm 40 px entre si', () => {
    const colunas = avaliar('colunasDoGrafico')(amostraDoContrato().secoes.vendas.serie12m, previsaoDaAmostraReal().meses);
    for (const largura of [300, 480, 720, 1000]) {
        const geo = avaliar('geometriaGrafico')(colunas, { largura, mesAtual: '2026-09' });
        const centros = geo.colunas.filter(coluna => coluna.mostrarRotulo).map(coluna => coluna.centro);
        assert.strictEqual(geo.colunas[11].mostrarRotulo, true, `${largura}px: set/26 perdeu o nome`);
        for (let i = 1; i < centros.length; i += 1) {
            assert.ok(centros[i] - centros[i - 1] >= 40 - 1e-9, `${largura}px: rótulos a ${centros[i] - centros[i - 1]} px`);
        }
    }
});

test('tooltip da previsão: "PED105 · Vetri", "parcelas 1, 2 e 3 de 3 · vence 02/10, 16/10 e 30/10" e o valor', () => {
    const conteudo = avaliar('conteudoDicaPrevisao')(previsaoDaAmostraReal().meses[12]);
    assert.strictEqual(conteudo.serie, 'previsao');
    assert.strictEqual(conteudo.titulo, 'Previsão · out/26');
    assert.strictEqual(semEspacoFixo(conteudo.resumo), 'R$ 24.733,40 · 6 pedidos · 10 parcelas');
    assert.deepStrictEqual(conteudo.itens.map(item => item.nome), [
        'PED105 · Vetri', 'PED107 · Studio Ferraz', 'PED108 · Casa Bela Decorações ME',
        'PED101 · Ana Ribeiro Interiores', 'PED99 · Casa Aurora', 'PED100 · Móveis Vicenzo'
    ]);
    assert.strictEqual(conteudo.itens[0].detalhe, 'parcelas 1, 2 e 3 de 3 · vence 02/10, 16/10 e 30/10');
    assert.strictEqual(semEspacoFixo(conteudo.itens[0].valor), 'R$ 5.193,88');
    assert.strictEqual(conteudo.itens[4].detalhe, 'parcela 3 de 6 · vence 20/10');
    assert.strictEqual(conteudo.itens[0].estimada, false);
    assert.strictEqual(conteudo.rodape, '', 'nenhum pedido ficou de fora');
});

test('tooltip da previsão: DATE cortada como texto, "+N outros pedidos", estimada e cliente sem permissão', () => {
    const dica = avaliar('conteudoDicaPrevisao');
    const conteudo = dica({
        mes: '2026-10', valor: 1000, parcelas: 12, pedidos: 11, outros: 3,
        itens: [
            {
                pedidoId: 1, numero: 'PED1', cliente: null, totalParcelas: 2, valor: 100, estimada: false,
                parcelas: [
                    // Meia-noite UTC do dia 2 é noite do dia 1 em São Paulo: não pode virar 01/10.
                    { numero: 1, vencimento: '2026-10-02T00:00:00.000Z', valor: 50 },
                    { numero: 2, vencimento: '2026-10-31', valor: 50 }
                ]
            },
            {
                pedidoId: 2, numero: 'PED2', cliente: '—', totalParcelas: 1, valor: 200, estimada: true,
                parcelas: [{ numero: 1, vencimento: '2026-10-05', valor: 200 }]
            }
        ]
    });
    assert.strictEqual(conteudo.itens[0].nome, 'PED1', 'sem a coluna Cliente fica só o número');
    assert.strictEqual(conteudo.itens[0].detalhe, 'parcelas 1 e 2 de 2 · vence 02/10 e 31/10');
    assert.strictEqual(conteudo.itens[1].nome, 'PED2', 'cadastro sem nome ("—") também fica só com o número');
    assert.strictEqual(conteudo.itens[1].detalhe, 'sem parcelas cadastradas — valor total na data do pedido');
    assert.strictEqual(conteudo.itens[1].estimada, true);
    assert.strictEqual(conteudo.rodape, '+3 outros pedidos');
    assert.strictEqual(dica({ mes: '2026-10', valor: 10, parcelas: 9, pedidos: 9, outros: 1, itens: [] }).rodape, '+1 outro pedido');
    assert.strictEqual(dica({ mes: '2026-05', valor: 0, parcelas: 0, pedidos: 0, outros: 0, itens: [] }).resumo,
        'Nenhuma parcela neste mês');
    // Nenhum `new Date` no caminho do texto das parcelas.
    const fonte = ['juntarLista', 'textoParcelasDoItem', 'conteudoDicaPrevisao', 'formatarDataCurta']
        .map(nome => avaliar(nome).toString()).join('\n');
    assert.doesNotMatch(fonte, /new Date/);
});

test('enumeração em português: "1", "1 e 2", "1, 2 e 3"', () => {
    const juntar = avaliar('juntarLista');
    assert.strictEqual(juntar([]), '');
    assert.strictEqual(juntar(['1']), '1');
    assert.strictEqual(juntar(['1', '2']), '1 e 2');
    assert.strictEqual(juntar(['1', '2', '3']), '1, 2 e 3');
    assert.strictEqual(juntar(['02/10', '', '30/10']), '02/10 e 30/10', 'vazio não vira vírgula solta');
});

test('tooltip da barra de ouro: "Vendas fechadas · set/26" e "R$ 58,9 mil · 7 pedidos"', () => {
    const vendas = avaliar('conteudoDicaVendas');
    const conteudo = vendas({ mes: '2026-09', quantidade: 7, valor: 58900 });
    assert.strictEqual(conteudo.serie, 'vendas');
    assert.strictEqual(conteudo.titulo, 'Vendas fechadas · set/26');
    assert.strictEqual(semEspacoFixo(conteudo.resumo), 'R$ 58,9 mil · 7 pedidos');
    assert.deepStrictEqual([...conteudo.itens], []);
    assert.strictEqual(vendas({ mes: '2026-09', quantidade: 1, valor: null }, { emDinheiro: false }).resumo, '1 pedido',
        'sem a coluna de valor, só a contagem');
    assert.strictEqual(vendas({ mes: '2026-02', quantidade: 0, valor: 0 }).resumo, 'Nenhuma venda fechada');
    assert.strictEqual(semEspacoFixo(avaliar('rotuloAcessivelDica')(conteudo)), 'Vendas fechadas em setembro de 2026: R$ 58,9 mil · 7 pedidos',
        'o aria-label repete o resumo do tooltip, com o mês por extenso para o leitor de tela');
});

test('título e estado do cartão do gráfico seguem as duas seções', () => {
    const titulos = avaliar('titulosDoGrafico');
    const cartao = avaliar('estadoDoCartao');
    const vendas = amostraDoContrato().secoes.vendas;
    const previsao = previsaoDaAmostraReal();
    const falha = 'Não foi possível ler as parcelas dos pedidos agora.';

    assert.strictEqual(titulos({ secoes: { vendas, previsao }, falhas: {} }).titulo, 'Vendas fechadas e previsão de faturamento');
    assert.strictEqual(titulos({ secoes: { vendas }, falhas: {} }).titulo, 'Vendas fechadas — últimos 12 meses',
        'sem a previsão no perfil, o gráfico de antes');
    assert.strictEqual(titulos({ secoes: { vendas }, falhas: { previsao: falha } }).titulo, 'Vendas fechadas e previsão de faturamento',
        'em falha a previsão continua sendo do cartão');
    assert.strictEqual(titulos({ secoes: { previsao }, falhas: {} }).titulo, 'Previsão de faturamento');
    assert.strictEqual(titulos({ secoes: { vendas: anularDinheiro(vendas), previsao }, falhas: {} }).titulo,
        'Vendas fechadas — últimos 12 meses', 'vendas em contagem não dividem o eixo com R$');

    assert.strictEqual(cartao({ secoes: { previsao }, falhas: {} }, 'grafico-vendas'), 'ok', 'só a previsão já sustenta o cartão');
    assert.strictEqual(cartao({ secoes: { vendas }, falhas: { previsao: falha } }, 'grafico-vendas'), 'ok');
    assert.strictEqual(cartao({ secoes: {}, falhas: { vendas: 'x', previsao: falha } }, 'grafico-vendas'), 'falha');
    assert.strictEqual(cartao({ secoes: {}, falhas: { previsao: falha } }, 'grafico-vendas'), 'falha');
    assert.strictEqual(cartao({ secoes: {}, falhas: {} }, 'grafico-vendas'), 'oculto');
    assert.strictEqual(cartao({ secoes: { previsao }, falhas: {} }, 'kpi-vendas'), 'oculto', 'os KPIs continuam só de vendas');
});

test('barra de cantos arredondados não gera NaN nem passa da base', () => {
    const caminho = avaliar('caminhoBarra');
    assert.strictEqual(caminho(10, 10, 20, 0), '', 'altura zero não desenha nada');
    const baixa = caminho(10, 97, 20, 3, 5);
    assert.ok(/^M/.test(baixa) && /Z$/.test(baixa));
    assert.doesNotMatch(baixa, /NaN/);
    // O raio é limitado pela altura: nenhum ponto abaixo da base (y = 100).
    const ys = [...baixa.matchAll(/[\d.]+,([\d.]+)/g)].map(m => Number(m[1]));
    assert.ok(ys.every(y => y <= 100 + 1e-9), `ponto abaixo da base: ${ys}`);
});

test('donut soma 100%, esconde a fatia zero e começa às 12 horas', () => {
    const donut = avaliar('geometriaDonut');
    const geo = donut([
        { situacao: 'Produção', quantidade: 7, valor: 52000 },
        { situacao: 'Enviado', quantidade: 0, valor: 0 },
        { situacao: 'Entregue', quantidade: 3, valor: 21000 }
    ]);
    assert.strictEqual(geo.total, 10);
    assert.strictEqual(geo.segmentos.length, 2, 'fatia zero sai do anel e da legenda');
    assert.strictEqual(geo.segmentos[0].situacao, 'Produção');
    assert.ok(Math.abs(geo.segmentos[0].percentual - 70) < 1e-9);
    assert.ok(Math.abs(geo.segmentos[1].percentual - 30) < 1e-9);
    assert.strictEqual(geo.segmentos[0].dashoffset, '25.000', 'deslocamento 25 = primeira fatia às 12 h');
    assert.strictEqual(geo.segmentos[1].dashoffset, '-45.000', 'a segunda começa onde a primeira termina');
    const soma = geo.segmentos.reduce((total, s) => total + s.percentual, 0);
    assert.ok(Math.abs(soma - 100) < 1e-9);

    assert.strictEqual(donut([{ situacao: 'Produção', quantidade: 0 }]).total, 0);
    assert.strictEqual(donut(null).segmentos.length, 0);
});

test('barra horizontal tem piso para o valor pequeno e zero continua zero', () => {
    const largura = avaliar('larguraPercentual');
    assert.strictEqual(largura(0, 10), 0);
    assert.strictEqual(largura(1, 100), 4);
    assert.strictEqual(largura(50, 100), 50);
    assert.strictEqual(largura(10, 0), 0);
    assert.strictEqual(largura(200, 100), 100);
});

// ------------------------------------------------- permissões e cartões

test('seção ausente some, seção em falhas mostra erro e cartão sob demanda só aparece com algo', () => {
    const cartao = avaliar('estadoDoCartao');
    const dados = {
        secoes: {
            vendas: { mesAtual: { quantidade: 3, valor: null, ticketMedio: null } },
            ia: { emRevisao: 0 },
            alertas: { aprovadosSemPedido: { quantidade: 1, itens: [] } }
        },
        falhas: { estoque: 'Não foi possível ler a matéria-prima agora.' }
    };
    assert.strictEqual(cartao(dados, 'kpi-vendas'), 'ok');
    assert.strictEqual(cartao(dados, 'kpi-ticket'), 'oculto', 'ticket é só dinheiro: sem a coluna, some');
    assert.strictEqual(cartao(dados, 'estoque'), 'falha');
    assert.strictEqual(cartao(dados, 'clientes'), 'oculto', 'sem permissão: ausente de secoes e de falhas');
    assert.strictEqual(cartao(dados, 'ia'), 'oculto', 'nenhuma leitura em revisão');
    assert.strictEqual(cartao(dados, 'sem-pedido'), 'ok');
});

test('estado vazio distingue perfil sem indicadores de painel sem nada a mostrar', () => {
    const geral = avaliar('estadoGeral');
    assert.strictEqual(geral({ secoes: {}, falhas: {} }), 'sem-permissao');
    assert.strictEqual(geral({ secoes: { ia: { emRevisao: 0 } }, falhas: {} }), 'tudo-em-dia');
    assert.strictEqual(geral({ secoes: {}, falhas: { vendas: 'fora do ar' } }), 'ok', 'a falha aparece no cartão');
    assert.strictEqual(geral({ secoes: { clientes: { ativos: 1, total: 2 } }, falhas: {} }), 'ok');
});

test('aprovados sem pedido zerado some e não impede o "tudo em dia"', () => {
    // O BFF manda o bloco com quantidade 0 em quase toda carga de quem vê
    // orçamentos e pedidos: um ">= 0" deixaria o cartão vermelho sempre de pé.
    const dados = { secoes: { alertas: { aprovadosSemPedido: { quantidade: 0, itens: [] } } }, falhas: {} };
    assert.strictEqual(avaliar('estadoDoCartao')(dados, 'sem-pedido'), 'oculto');
    assert.strictEqual(avaliar('estadoGeral')(dados), 'tudo-em-dia');
});

test('cada cartão do HTML tem quem o desenhe e depende da seção declarada', () => {
    const cartoes = avaliar('DASH_CARTOES');
    const noHtml = [...FONTE_HTML.matchAll(/data-dash-cartao="([^"]+)"\s+data-secao="([^"]+)"/g)]
        .map(m => ({ chave: m[1], secao: m[2] }));
    assert.deepStrictEqual(noHtml.map(c => c.chave).sort(), Object.keys(cartoes).sort());
    for (const { chave, secao } of noHtml) {
        assert.strictEqual(cartoes[chave].secao, secao, `${chave}: seção diferente no HTML e no JS`);
        assert.strictEqual(typeof cartoes[chave].desenhar, 'function', `${chave} sem desenhista`);
    }
});

// -------------------------------------------------------- ciclo de vida

test('o listener de module-change é registrado uma vez, mesmo com o script reinjetado', () => {
    const { contexto, ouvintes } = criarContexto();
    // Exatamente como src/js/menu.js injeta: embrulhado num IIFE, de novo a cada visita.
    for (let i = 0; i < 3; i += 1) vm.runInContext(`(function(){\n${FONTE_JS}\n})();`, contexto);
    assert.strictEqual(ouvintes.filter(o => o.tipo === 'module-change').length, 1);
    assert.strictEqual(contexto.window.__dashboardOuvintes, true);
});

test('a primeira carga vira moduleReadyPromise e o aviso do próprio menu não relê', async () => {
    assert.match(FONTE_JS, /moduleEl\.moduleReadyPromise\s*=\s*carregarDashboard\(/);
    const modulo = criarModuloFalso();
    const { ouvintes, chamadas, avaliar: avaliarAqui } = carregar({ modulo });

    assert.ok(modulo.moduleReadyPromise && typeof modulo.moduleReadyPromise.then === 'function',
        'o menu precisa de uma promessa para segurar a máscara');
    await modulo.moduleReadyPromise;
    assert.deepStrictEqual([...chamadas], ['http://bff.local/api/dashboard']);
    assert.strictEqual(avaliarAqui('iniciarDashboard')(modulo), modulo.moduleReadyPromise, 'iniciar de novo é inofensivo');

    const aoMudar = ouvintes.find(o => o.tipo === 'module-change').fn;
    aoMudar({ detail: { page: 'dashboard' } }); // o finally do loadPage desta mesma carga
    await esperarFila();
    assert.strictEqual(chamadas.length, 1, 'o aviso do carregador não é pedido de recarga');

    aoMudar({ detail: { page: 'pedidos' } });
    aoMudar({ detail: { page: 'dashboard' } }); // clique em Dashboard estando nele
    await esperarFila();
    await esperarFila();
    assert.strictEqual(chamadas.length, 2);
    assert.strictEqual(chamadas[1], 'http://bff.local/api/dashboard', 'recarga comum não força o upstream');
});

test('"Atualizar" pede ?atualizar=1 e leitura comum em curso é reaproveitada', async () => {
    const modulo = criarModuloFalso();
    const { chamadas, avaliar: avaliarAqui } = carregar({ modulo });
    await modulo.moduleReadyPromise;
    const carregarDashboard = avaliarAqui('carregarDashboard');

    const primeira = carregarDashboard(modulo);
    const segunda = carregarDashboard(modulo);
    assert.strictEqual(primeira, segunda, 'duas leituras comuns simultâneas dividem a requisição');
    await primeira;
    await carregarDashboard(modulo, { atualizar: true });
    assert.deepStrictEqual([...chamadas], [
        'http://bff.local/api/dashboard',
        'http://bff.local/api/dashboard',
        'http://bff.local/api/dashboard?atualizar=1'
    ]);
});

test('resposta que chega atrasada não sobrescreve a leitura mais nova', async () => {
    const selo = { textContent: '' };
    const modulo = criarModuloFalso({ selo });
    const pendentes = [];
    const { avaliar: avaliarAqui } = carregar({
        modulo,
        fetch: url => new Promise(resolve => pendentes.push({ url, resolve }))
    });
    const nova = avaliarAqui('carregarDashboard')(modulo, { atualizar: true });
    await esperarFila();
    assert.strictEqual(pendentes.length, 2, 'carga automática + atualização');

    const clientes = { clientes: { ativos: 1, total: 1 } };
    pendentes[1].resolve(respostaVazia(new Date(2026, 8, 13, 10, 30).toISOString(), clientes));
    await nova;
    pendentes[0].resolve(respostaVazia(new Date(2026, 8, 13, 9, 0).toISOString(), clientes));
    await modulo.moduleReadyPromise;
    assert.strictEqual(selo.textContent, 'Atualizado às 10:30');
});

test('clique em Dashboard com a máscara de pé não gasta a guarda do aviso do menu', async () => {
    // O menu põe `module-loading-content` antes de montar o módulo e só tira
    // logo antes do aviso do finally. Um clique nesse meio despacha
    // 'module-change' na hora; se ele consumisse a guarda, o aviso final virava
    // uma 2ª leitura que esmaece os cartões e perde a contagem animada.
    const modulo = criarModuloFalso();
    modulo.classList.add('module-loading-content');
    const { ouvintes, chamadas } = carregar({ modulo });
    const aoMudar = ouvintes.find(o => o.tipo === 'module-change').fn;

    aoMudar({ detail: { page: 'dashboard' } }); // clique com a máscara de pé
    await modulo.moduleReadyPromise;
    modulo.classList.remove('module-loading-content'); // o loadPage revela
    aoMudar({ detail: { page: 'dashboard' } }); // o aviso do finally
    await esperarFila();
    await esperarFila();
    assert.strictEqual(chamadas.length, 1, 'uma leitura por visita');

    aoMudar({ detail: { page: 'dashboard' } }); // clique depois de revelado: relê
    await esperarFila();
    await esperarFila();
    assert.strictEqual(chamadas.length, 2);
});

test('clique entre o HTML importado e o script injetado inicia uma vez só', async () => {
    // 2ª visita: o ouvinte é o da 1ª execução e o elemento é novo (ainda não
    // iniciado). O clique inicia e arma a guarda; o script reinjetado e o aviso
    // final não geram leitura nenhuma.
    const { contexto, ouvintes, chamadas } = criarContexto();
    vm.runInContext(`(function(){\n${FONTE_JS}\n})();`, contexto);
    const aoMudar = ouvintes.find(o => o.tipo === 'module-change').fn;

    const novo = criarModuloFalso();
    novo.classList.add('module-loading-content');
    contexto.document.querySelector = seletor => (seletor === '#content .dashboard-module' ? novo : null);
    aoMudar({ detail: { page: 'dashboard' } });
    vm.runInContext(`(function(){\n${FONTE_JS}\n})();`, contexto);
    await novo.moduleReadyPromise;
    novo.classList.remove('module-loading-content');
    aoMudar({ detail: { page: 'dashboard' } });
    await esperarFila();
    await esperarFila();
    assert.strictEqual(chamadas.length, 1);
});

test('tempo-limite durante a leitura do corpo vira a mensagem de demora, não "formato inesperado"', async () => {
    // O fetch já resolveu com o cabeçalho; o abort dos 30 s cai no json().
    const abortado = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    for (const status of [200, 500]) {
        const { avaliar: avaliarAqui } = carregar({
            fetch: async () => ({ ok: status === 200, status, json: async () => { throw abortado(); } })
        });
        await assert.rejects(avaliarAqui('buscarResumoDashboard')(), { message: 'O painel demorou demais para responder.' },
            `status ${status}`);
    }
    // Corpo que não é JSON continua sendo formato inesperado.
    const { avaliar: avaliarHtml } = carregar({
        fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } })
    });
    await assert.rejects(avaliarHtml('buscarResumoDashboard')(), { message: 'A resposta do painel veio num formato inesperado.' });
});

// ------------------------------------------------------ leitura dos arquivos

test('nada de simulação: sem sorteio de números e sem os textos do painel falso', () => {
    assert.doesNotMatch(FONTE_JS, /Math\.random/);
    const textosFalsos = [
        'Ambiente demonstrativo', 'Simular Atualização', 'Dados ilustrativos', 'Visual fake',
        'Exportação desabilitada', 'Atualizações fictícias', 'Sugestões fake', 'Integrações em andamento'
    ];
    for (const texto of textosFalsos) {
        for (const [nome, fonte] of [['html', FONTE_HTML], ['js', FONTE_JS], ['css', FONTE_CSS]]) {
            assert.ok(!fonte.toLowerCase().includes(texto.toLowerCase()), `"${texto}" ainda aparece no ${nome}`);
        }
    }
});

test('os dados vêm de /api/dashboard e nunca entram por innerHTML', () => {
    assert.match(FONTE_JS, /\/api\/dashboard/);
    assert.match(FONTE_JS, /getApiBaseUrl\(\)/);
    // Nome de cliente, prospecção e insumo é texto livre: só textContent.
    assert.doesNotMatch(FONTE_JS, /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML/);
    // Com parêntese: o comentário que explica por que não há polling pode citar o nome.
    assert.doesNotMatch(FONTE_JS, /setInterval\s*\(/, 'polling manteria a rede ocupada para o menu');
});

test('o módulo mantém o contêiner e o cabeçalho que o menu procura', () => {
    assert.match(FONTE_HTML, /class="[^"]*\bmodulo-container\b[^"]*\bdashboard-module\b/);
    assert.match(FONTE_HTML, /class="[^"]*\bmodule-header\b/);
    assert.match(FONTE_HTML, /<h1[^>]*>Dashboard<\/h1>/);
});

test('o CSS só usa as cores do tema, que trocam entre claro e escuro', () => {
    assert.doesNotMatch(FONTE_CSS, /rgba\(\s*255\s*,\s*255\s*,\s*255/);
    // Comentários citam arquivos (menu.css) e a história do CSS antigo: ficam
    // fora das varreduras abaixo, que olham só as regras.
    const regras = FONTE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    // Nenhuma cor escrita à mão: toda cor passa pelas variáveis de menu.css.
    assert.doesNotMatch(regras, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    assert.doesNotMatch(regras, /(?<![\w-])(white|black)(?![\w-])/i, 'white-space pode; a cor branca não');

    const permitidas = new Set([
        '--menu-text-strong', '--menu-text-primary', '--menu-text-secondary', '--menu-text-muted', '--menu-text-tertiary',
        '--menu-surface-soft', '--menu-surface-strong', '--menu-surface-highlight',
        '--menu-surface-border', '--menu-surface-border-soft', '--menu-surface-border-strong',
        '--color-primary', '--color-primary-light', '--color-primary-dark', '--color-bordeaux', '--color-bg-deep',
        '--color-green', '--color-red', '--color-blue', '--color-violet', '--color-purple', '--neutral-100', '--neutral-500'
    ]);
    const usadas = [...regras.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map(m => m[1]);
    const fora = [...new Set(usadas.filter(nome => !permitidas.has(nome) && !nome.startsWith('--dash-')))];
    assert.deepStrictEqual(fora, [], `variáveis fora do tema: ${fora.join(', ')}`);

    // Toda classe própria do painel leva o prefixo, para não vazar para outros módulos.
    // A única de fora é `.show`, a classe do contrato do window.Popover (quem a
    // põe e tira é src/js/utils/popover.js) — e só GRUDADA numa classe do
    // painel: sozinha, ou como descendente, valeria para todo popover do app.
    assert.doesNotMatch(regras, /(?<!\.dash-[a-z0-9_-]+)\.show\b/i, '`.show` fora de uma classe dash-');
    const classes = [...regras.replace(/(\.dash-[a-z0-9_-]+)\.show\b/gi, '$1').matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map(m => m[1]);
    const semPrefixo = [...new Set(classes.filter(c => !c.startsWith('dash-')
        && !['dashboard-module', 'module-loading-content'].includes(c)))];
    assert.deepStrictEqual(semPrefixo, [], `classes sem prefixo dash-: ${semPrefixo.join(', ')}`);
});

// ------------------------------------------------- desenho com DOM falso
//
// As funções de desenho só rodam dentro do app, e uma exceção nelas vira em
// silêncio o cartão de erro ("formato inesperado"). Um DOM mínimo basta para
// passar a amostra do contrato por TODOS os cartões e ler o texto que o
// usuário veria.

function criarDomFalso() {
    const paraDataset = nome => nome.replace(/-([a-z])/g, (_, letra) => letra.toUpperCase());

    class TextoFalso {
        constructor(texto) {
            this.textContent = String(texto);
        }
    }

    class ElementoFalso {
        constructor(tag) {
            this.tagName = String(tag).toUpperCase();
            this.filhos = [];
            this.dataset = {};
            this.style = {};
            this.atributos = {};
            this.className = '';
            this.hidden = false;
            this.texto = '';
            // Guardados para o teste disparar foco, mouse e clique nas barras.
            this.ouvintes = [];
        }
        get childNodes() { return this.filhos; }
        get classList() {
            const lista = () => this.className.split(' ').filter(Boolean);
            return {
                contains: c => lista().includes(c),
                add: c => { if (!lista().includes(c)) this.className = [...lista(), c].join(' '); },
                remove: c => { this.className = lista().filter(x => x !== c).join(' '); },
                toggle: (c, ativo) => {
                    const fica = ativo === undefined ? !lista().includes(c) : Boolean(ativo);
                    this.className = [...lista().filter(x => x !== c), ...(fica ? [c] : [])].join(' ');
                    return fica;
                }
            };
        }
        get textContent() { return this.texto + this.filhos.map(filho => filho.textContent).join(''); }
        set textContent(valor) {
            this.filhos = [];
            this.texto = String(valor);
        }
        get clientWidth() { return 720; }
        get isConnected() { return true; }
        append(...nos) { nos.forEach(no => this.filhos.push(typeof no === 'string' ? new TextoFalso(no) : no)); }
        replaceChildren(...nos) {
            this.filhos = [];
            this.texto = '';
            this.append(...nos);
        }
        setAttribute(nome, valor) {
            this.atributos[nome] = String(valor);
            if (nome === 'class') this.className = String(valor);
            if (nome.startsWith('data-')) this.dataset[paraDataset(nome.slice(5))] = String(valor);
        }
        removeAttribute(nome) { delete this.atributos[nome]; }
        getAttribute(nome) { return Object.prototype.hasOwnProperty.call(this.atributos, nome) ? this.atributos[nome] : null; }
        addEventListener(tipo, fn) { this.ouvintes.push({ tipo, fn }); }
        casa(seletor) {
            const classe = /^\.([\w-]+)$/.exec(seletor);
            if (classe) return this.classList.contains(classe[1]);
            const atributo = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(seletor);
            if (!atributo) throw new Error(`seletor não suportado no DOM falso: ${seletor}`);
            const valor = this.dataset[paraDataset(atributo[1])];
            return valor !== undefined && (atributo[2] === undefined || valor === atributo[2]);
        }
        querySelectorAll(seletor) {
            const achados = [];
            const visitar = no => no.filhos.forEach(filho => {
                if (!(filho instanceof ElementoFalso)) return;
                if (filho.casa(seletor)) achados.push(filho);
                visitar(filho);
            });
            visitar(this);
            return achados;
        }
        querySelector(seletor) { return this.querySelectorAll(seletor)[0] || null; }
    }

    const documento = {
        createElement: tag => new ElementoFalso(tag),
        createElementNS: (_, tag) => new ElementoFalso(tag),
        createTextNode: texto => new TextoFalso(texto),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {}
    };
    return { documento, ElementoFalso };
}

/**
 * Dublê de window.Popover com o contrato de src/js/utils/popover.js: `abrir`
 * põe `.show` (e posiciona pela âncora), `fechar` tira. Guarda as aberturas.
 */
function criarPopoverFalso() {
    const popover = {
        aberturas: [],
        abrir(caixa, ancora) {
            caixa.classList.add('show');
            popover.aberturas.push({ caixa, ancora });
        },
        fechar(caixa) {
            caixa.classList.remove('show');
        }
    };
    return popover;
}

/** Roda os ouvintes que o DOM falso guardou, como o navegador faria no alvo. */
function disparar(no, tipo, extra = {}) {
    no.ouvintes.filter(ouvinte => ouvinte.tipo === tipo).forEach(ouvinte => ouvinte.fn({ type: tipo, target: no, ...extra }));
}

/** Módulo com um cartão por chave de DASH_CARTOES, na forma do dashboard.html. */
function montarPainelFalso({ fetch = null, popover = criarPopoverFalso() } = {}) {
    const { documento, ElementoFalso } = criarDomFalso();
    const erros = [];
    const contexto = {
        window: { apiConfig: { getApiBaseUrl: async () => 'http://bff.local' }, Popover: popover },
        document: documento,
        console: { log() {}, warn() {}, info() {}, error: (...args) => erros.push(args.map(String).join(' ')) },
        Intl,
        setTimeout,
        clearTimeout,
        fetch: fetch || (async () => { throw new Error('este teste não esperava leitura'); })
    };
    contexto.globalThis = contexto;
    vm.createContext(contexto);
    vm.runInContext(FONTE_JS, contexto);
    const avaliarAqui = expressao => vm.runInContext(expressao, contexto);

    const elemento = (tag, dados = {}) => {
        const no = new ElementoFalso(tag);
        Object.assign(no.dataset, dados);
        return no;
    };
    const modulo = elemento('div');
    modulo.className = 'modulo-container dashboard-module';
    const selo = elemento('span', { dashAtualizado: '' });
    const estadoGeral = elemento('div', { dashEstadoGeral: '' });
    const painel = elemento('div', { dashPainel: '' });
    const linha = elemento('div', { dashLinha: '' });
    const cartoes = {};
    for (const chave of Object.keys(avaliarAqui('DASH_CARTOES'))) {
        const cartao = elemento('article', { dashCartao: chave });
        // O gráfico troca o próprio título conforme as seções que vieram.
        if (chave === 'grafico-vendas') cartao.append(elemento('h2', { dashTitulo: '' }), elemento('p', { dashSubtitulo: '' }));
        cartao.append(elemento('div', { dashCorpo: '' }));
        linha.append(cartao);
        cartoes[chave] = cartao;
    }
    painel.append(linha);
    modulo.append(selo, elemento('div', { dashAviso: '' }), estadoGeral, painel);
    const texto = chave => semEspacoFixo(cartoes[chave].textContent);
    return { avaliar: avaliarAqui, modulo, cartoes, selo, estadoGeral, painel, linha, erros, texto, popover };
}

/** A amostra da seção 5 do contrato, completa (12 meses, listas cortadas). */
function amostraDoContrato() {
    const meses = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
        '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    return {
        geradoEm: new Date(2026, 8, 13, 15, 4, 5).toISOString(),
        hoje: '2026-09-13',
        mesAtual: '2026-09',
        secoes: {
            vendas: {
                mesAtual: { quantidade: 12, valor: 84500.5, ticketMedio: 7041.71 },
                mesAnteriorMesmoPeriodo: { quantidade: 9, valor: 61200, ticketMedio: 6800 },
                mesAnterior: { quantidade: 20, valor: 150000, ticketMedio: 7500 },
                canceladosMes: { quantidade: 1, valor: 3200 },
                serie12m: meses.map((mes, i) => ({ mes, quantidade: i === 4 ? 0 : i + 1, valor: i === 4 ? 0 : (i + 1) * 7000 }))
            },
            producao: {
                quantidade: 7,
                valor: 52000,
                porIdade: [
                    { faixa: '0-15', quantidade: 3 }, { faixa: '16-30', quantidade: 2 },
                    { faixa: '31-60', quantidade: 1 }, { faixa: '60+', quantidade: 1 }
                ],
                maisAntigos: [{ id: 1, numero: 'PED12', cliente: 'Móveis Aurora', dias: 74, valor: 8200 }],
                porSituacao12m: [
                    { situacao: 'Produção', quantidade: 7, valor: 52000 },
                    { situacao: 'Enviado', quantidade: 3, valor: 21000 },
                    { situacao: 'Entregue', quantidade: 20, valor: 150000 },
                    { situacao: 'Cancelado', quantidade: 1, valor: 3200 },
                    { situacao: 'Outros', quantidade: 0, valor: 0 }
                ]
            },
            orcamentos: {
                pendentesVigentes: { quantidade: 14, valor: 120000 },
                pendentesVencidos: { quantidade: 6, valor: 30000 },
                rascunhos: { quantidade: 3, valor: 9000 },
                vencendo7d: {
                    total: 3,
                    itens: [
                        { id: 5, numero: 'ORC88', destinatario: 'Casa Bela', dono: 'Ana', validade: '2026-09-13', diasRestantes: 0, valor: 4500 },
                        { id: 6, numero: 'ORC90', destinatario: 'Prospecção', dono: 'Bia', validade: '2026-09-15', diasRestantes: 2, valor: 900 }
                    ]
                },
                decisao90d: { aprovados: 18, rejeitados: 5, expirados: 2, decididos: 25, taxaAprovacao: 0.72 }
            },
            alertas: { aprovadosSemPedido: { quantidade: 1, itens: [{ id: 9, numero: 'ORC9', destinatario: 'X', valor: 1000 }] } },
            prospeccao: {
                abertos: 23,
                valorEmAberto: 450000,
                valorPonderado: 180000,
                funil: ['Novo', 'Contactado', 'Qualificado', 'Proposta', 'Negociação']
                    .map((etapa, i) => ({ etapa, quantidade: 5 - i, valor: (5 - i) * 10000 })),
                followups: {
                    atrasados: 4, hoje: 2, proximos7: 5,
                    itens: [{ id: 3, nome: 'Casa Bela', etapa: 'Proposta', proximoPasso: 'Ligar', data: '2026-09-10', dias: -3 }]
                },
                convertidosMes: 2
            },
            clientes: { ativos: 120, total: 150 },
            estoque: {
                negativos: { quantidade: 2, itens: [{ id: 1, nome: 'Cola PVA', quantidade: -3.5, unidade: 'L', processo: 'Montagem' }] },
                zerados: 4,
                criticos: 7,
                limiteCritico: 10,
                valorEstoque: 23000.12
            },
            ia: { emRevisao: 3 }
        },
        falhas: {}
    };
}

/**
 * As seções do Financeiro (24/09/2026, backend/dashboardFinanceiro.js), na
 * forma do contrato. Ficam fora da amostra de sempre: os testes do gráfico e
 * dos KPIs descrevem o perfil SEM recebimentos, e ele continua igual.
 */
function financeiroDaAmostra() {
    const meses = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
        '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    return {
            receber: {
                recebido: { quantidade: 8, valor: 42000, encargos: { valor: 120.5 }, estornados: 1, mesAnteriorMesmoPeriodo: { quantidade: 6, valor: 35000 } },
                aReceber: { quantidade: 5, valor: 26000, comBoleto: 3, comOrdem: 1, semCobranca: 1 },
                emAtraso: { quantidade: 2, valor: 9000, maisAntigo: '2026-08-10', diasMax: 34, criticos: 1, limiteCritico: 15 },
                porVencimento: {
                    faixas: [
                        { faixa: 'atraso_30', quantidade: 1, valor: 5000 }, { faixa: 'atraso_16_30', quantidade: 0, valor: 0 },
                        { faixa: 'atraso_1_15', quantidade: 1, valor: 4000 }, { faixa: 'vence_7', quantidade: 2, valor: 8000 },
                        { faixa: 'vence_30', quantidade: 3, valor: 15000 }, { faixa: 'depois', quantidade: 4, valor: 20000 }
                    ],
                    quantidade: 11,
                    valor: 52000,
                    semData: 0,
                    maioresAtrasos: {
                        total: 2,
                        itens: [{ pedidoId: 3, pedido: 'PED88', cliente: 'Casa Bela', parcela: '2/3', vencimento: '2026-08-10', dias: 34, valor: 5000 }]
                    }
                },
                ordens: {
                    abertas: 2, atrasadas: 1, proximas7: 1,
                    itens: [{ pedidoId: 4, pedido: 'PED90', cliente: 'Móveis Aurora', parcela: '1/2', vencimento: '2026-09-10', dias: 3, valor: 3000, forma: 'Pix', data: '2026-09-10', atrasada: true }]
                },
                conciliacao: {
                    fila: 2, aLancar: 1, alertas: 0, boletosComErro: 0,
                    itens: [{ chave: 'conciliar', nivel: 'normal', titulo: 'Pagamentos a conciliar', descricao: '2 avisos de pagamento do BB na fila · 1 boleto pago ainda não lançado' }]
                },
                antecipadoEmProducao: { pedidos: 2, valor: 7800 },
                serie12m: meses.map((mes, i) => ({ mes, quantidade: i, valor: i * 5000 })),
                parcelas: { '1:1': 'paga' },
                desde: '2026-01-01'
            },
            fiscal: {
                notasMes: { emitidas: 9, autorizadas: { quantidade: 7, valor: 61000 }, canceladas: 1, processando: 0, rejeitadas: 1 },
                aguardandoNfe: {
                    desde: '2026-08-01', quantidade: 2, valor: 9800, dispensados: 0,
                    itens: [{ pedidoId: 12, numero: 'PED12', cliente: 'Móveis Aurora', enviadoEm: '2026-09-10', dias: 3, valor: 8200 }]
                },
                problemas: {
                    quantidade: 1, criticos: 1,
                    itens: [{ chave: 'rejeitadas', nivel: 'critico', titulo: '1 nota recusada pela SEFAZ sem nova emissão', descricao: '539 — Duplicidade de NF-e' }]
                },
                certificado: { vencido: false, venceEmBreve: false, diasRestantes: 200, validoAte: '2027-03-31' }
            },
            pagar: {
                competencia: '2026-09',
                aPagar: { valor: 6200 },
                comissoes: { valor: 3200, total: { valor: 5400 }, pago: { valor: 2200 }, situacao: 'parcial', pagarAte: '2026-10-05', parcelas: 9 },
                producao: { valor: 3000, total: { valor: 3000 }, pago: { valor: 0 }, situacao: 'aberta', pagarAte: '2026-10-06', pecas: 40 },
                atrasadas: { quantidade: 2, valor: 350.5 },
                aConfirmar: {
                    quantidade: 2, atrasados: 1, valor: 4100,
                    itens: [{ tipo: 'producao', competencia: '2026-08', valor: 2800, total: { valor: 2800 }, pagarAte: '2026-09-08', atrasado: true }]
                }
            }
    };
}

/** A amostra de sempre com o Financeiro: para os testes que passam por TODOS os cartões. */
function amostraComFinanceiro() {
    const dados = amostraDoContrato();
    Object.assign(dados.secoes, financeiroDaAmostra());
    return dados;
}

/** O que o backend manda quando o perfil não tem a coluna de valor (§2). */
function anularDinheiro(no) {
    if (Array.isArray(no)) return no.map(anularDinheiro);
    if (!no || typeof no !== 'object') return no;
    const dinheiro = new Set(['valor', 'ticketMedio', 'valorEmAberto', 'valorPonderado', 'valorEstoque']);
    return Object.fromEntries(Object.entries(no).map(([chave, valor]) =>
        [chave, dinheiro.has(chave) ? null : anularDinheiro(valor)]));
}

test('todos os cartões desenham a amostra do contrato sem cair no cartão de erro', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, amostraComFinanceiro());

    assert.deepStrictEqual(painel.erros, [], 'nenhum desenhista pode lançar exceção');
    for (const [chave, cartao] of Object.entries(painel.cartoes)) {
        assert.strictEqual(cartao.dataset.estado, 'ok', `${chave} não desenhou`);
        assert.strictEqual(cartao.hidden, false, `${chave} ficou escondido`);
    }
    assert.strictEqual(painel.selo.textContent, 'Atualizado às 15:04');
    assert.strictEqual(painel.painel.hidden, false);

    const vendas = painel.texto('kpi-vendas');
    assert.match(vendas, /R\$ 84\.501/);
    assert.match(vendas, /12 pedidos fechados/);
    assert.match(vendas, /\+38,1%/, '84.500,50 contra 61.200 no mesmo período');
    assert.match(vendas, /1 cancelado no mês/);
    assert.match(painel.texto('kpi-orcamentos'), /6 vencidos ainda pendentes/);
    assert.match(painel.texto('kpi-producao'), /1 há mais de 60 dias/);

    const vencendo = painel.texto('vencendo');
    assert.match(vencendo, /vence hoje/);
    assert.match(vencendo, /vence em 2 dias/);
    assert.match(vencendo, /\+1 não listados/, 'total 3 com 2 na lista');
    assert.match(painel.texto('followups'), /atrasado há 3 dias/);
    assert.match(painel.texto('followups'), /\+5 não listados/, '4 atrasados + 2 hoje, 1 na lista');
    assert.match(painel.texto('estoque'), /−3,5 L/);
    assert.match(painel.texto('estoque'), /7 abaixo de 10 \(limite fixo\)/);
    assert.match(painel.texto('funil'), /2 clientes novos via prospecção este mês/);
    assert.match(painel.texto('aprovacao'), /72%/);
    assert.match(painel.texto('clientes'), /120/);

    // Gráfico: 12 colunas, só o mês atual em destaque, rótulo "set/26".
    const colunas = painel.cartoes['grafico-vendas'].querySelectorAll('.dash-barras__coluna');
    assert.strictEqual(colunas.length, 12);
    const atuais = colunas.filter(coluna => coluna.classList.contains('dash-barras__coluna--atual'));
    assert.strictEqual(atuais.length, 1);
    assert.match(atuais[0].textContent, /set\/26/);
    // Donut: a fatia "Outros" (zero) some; o total vai no centro.
    assert.strictEqual(painel.cartoes['grafico-situacao'].querySelectorAll('.dash-donut__fatia').length, 4);
    assert.match(painel.texto('grafico-situacao'), /31pedidos/);
});

test('sem a coluna de valor nenhum cartão mostra R$ e o gráfico passa a contar pedidos', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, anularDinheiro(amostraComFinanceiro()));

    assert.deepStrictEqual(painel.erros, []);
    assert.strictEqual(painel.cartoes['kpi-ticket'].hidden, true, 'ticket médio é só dinheiro');
    for (const [chave, cartao] of Object.entries(painel.cartoes)) {
        if (cartao.hidden) continue;
        assert.doesNotMatch(painel.texto(chave), /R\$/, `${chave} mostrou R$ sem permissão`);
    }
    assert.match(painel.texto('kpi-vendas'), /^12/, 'o número grande vira a contagem de pedidos');
    assert.match(painel.texto('kpi-vendas'), /\+33,3%/, '12 pedidos contra 9 no mesmo período');
    assert.match(painel.texto('grafico-vendas'), /quantidade de pedidos/);
});

test('vendedor, prospecção e insumo sem nome ("—") não viram "com —" nem título de travessão', () => {
    const painel = montarPainelFalso();
    const dados = amostraDoContrato();
    // É o que o BFF manda quando o cadastro está incompleto (SEM_NOME em dashboardResumo.js).
    dados.secoes.orcamentos.vencendo7d.itens[0].dono = '—';
    dados.secoes.prospeccao.followups.itens[0].nome = '—';
    dados.secoes.estoque.negativos.itens[0].nome = '—';
    painel.avaliar('renderizarDashboard')(painel.modulo, dados);

    assert.deepStrictEqual(painel.erros, []);
    const vencendo = painel.texto('vencendo');
    assert.doesNotMatch(vencendo, /com —/);
    assert.match(vencendo, /Casa Bela/, 'o destinatário continua na linha');
    assert.match(vencendo, /com Bia/, 'o dono informado continua');
    assert.match(painel.texto('followups'), /Prospecção/, 'follow-up sem nome ganha o rótulo genérico');
    assert.match(painel.texto('estoque'), /Insumo/, 'insumo sem nome ganha o rótulo genérico');
});

test('seção em falhas vira erro discreto com Atualizar e seção ausente some', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, {
        geradoEm: new Date(2026, 8, 13, 9, 30).toISOString(),
        secoes: { clientes: { ativos: 3, total: 4 } },
        falhas: { estoque: 'Não foi possível ler a matéria-prima agora.' }
    });

    const estoque = painel.cartoes.estoque;
    assert.strictEqual(estoque.dataset.estado, 'falha');
    assert.match(estoque.textContent, /Não foi possível carregar agora/);
    assert.match(estoque.textContent, /Não foi possível ler a matéria-prima agora\./);
    const [botao] = estoque.querySelectorAll('[data-dash-acao="atualizar"]');
    assert.ok(botao, 'o erro traz o botão de atualizar');
    assert.strictEqual(botao.dataset.acaoGerida, 'true', 'sem isso a rede do BotaoAcao engole o clique');

    assert.strictEqual(painel.cartoes['kpi-vendas'].hidden, true, 'sem permissão: some');
    assert.strictEqual(painel.cartoes.clientes.hidden, false);
    assert.strictEqual(painel.linha.dataset.visiveis, '2');
});

test('perfil sem nenhuma seção vê o estado vazio amigável no lugar do painel', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, { geradoEm: null, secoes: {}, falhas: {} });

    assert.strictEqual(painel.painel.hidden, true);
    assert.strictEqual(painel.estadoGeral.hidden, false);
    assert.match(painel.estadoGeral.textContent, /Seu perfil ainda não tem indicadores liberados/);
    assert.ok(Object.values(painel.cartoes).every(cartao => cartao.hidden));
});

test('toda lista cortada mostra "+N não listados"', () => {
    const painel = montarPainelFalso();
    const dados = amostraDoContrato();
    dados.secoes.alertas.aprovadosSemPedido.quantidade = 3;
    painel.avaliar('renderizarDashboard')(painel.modulo, dados);

    assert.match(painel.texto('idade'), /\+6 não listados/, '7 em produção, 1 na lista');
    assert.match(painel.texto('sem-pedido'), /\+2 não listados/, '3 aprovados sem pedido, 1 na lista');
    assert.match(painel.texto('estoque'), /\+1 não listados/, '2 negativos, 1 na lista');
});

test('"Aprovados sem pedido" não manda refazer uma conversão que nenhuma tela faz', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, amostraDoContrato());
    const texto = painel.texto('sem-pedido');
    assert.doesNotMatch(texto, /refaça a conversão/);
    assert.match(texto, /a conversão falhou ou o pedido foi excluído/);
    assert.match(texto, /avise o administrador/);
});

test('título e detalhe cortados nas listas guardam o texto inteiro no title', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, amostraDoContrato());

    for (const chave of ['idade', 'sem-pedido', 'vencendo', 'followups', 'estoque']) {
        const cartao = painel.cartoes[chave];
        const nos = [...cartao.querySelectorAll('.dash-lista__titulo'), ...cartao.querySelectorAll('.dash-lista__detalhe')];
        assert.ok(nos.length > 0, `${chave} sem lista`);
        for (const no of nos) {
            assert.strictEqual(String(no.title).split('\n')[0], no.textContent, `${chave}: title sem o texto inteiro`);
        }
    }
    // A dica do item (validade) continua no tooltip de quem passa sobre o texto.
    const [detalhe] = painel.cartoes.vencendo.querySelectorAll('.dash-lista__detalhe');
    assert.match(detalhe.title, /Validade: 13\/09/);
});

test('sem nenhuma seção montada o selo diz "Sem leitura", não a hora da resposta', () => {
    const painel = montarPainelFalso();
    const agora = new Date(2026, 8, 13, 12, 47).toISOString();
    // Perfil só com pedidos e a tabela fora do ar: o BFF não leu nada.
    painel.avaliar('renderizarDashboard')(painel.modulo, {
        geradoEm: agora, secoes: {}, falhas: { vendas: 'Não foi possível ler os pedidos agora.' }
    });
    assert.strictEqual(painel.cartoes['kpi-vendas'].dataset.estado, 'falha');
    assert.strictEqual(painel.selo.textContent, 'Sem leitura');

    const semPermissao = montarPainelFalso();
    semPermissao.avaliar('renderizarDashboard')(semPermissao.modulo, { geradoEm: agora, secoes: {}, falhas: {} });
    assert.strictEqual(semPermissao.selo.textContent, 'Sem leitura');
});

test('503 ao conferir permissões mostra o erro com "Tentar novamente", nunca "sem permissão"', async () => {
    const mensagem = 'Não foi possível conferir suas permissões agora.';
    const painel = montarPainelFalso({
        fetch: async () => ({ ok: false, status: 503, json: async () => ({ error: mensagem }) })
    });
    await painel.avaliar('carregarDashboard')(painel.modulo);

    const texto = painel.estadoGeral.textContent;
    assert.strictEqual(painel.estadoGeral.hidden, false);
    assert.strictEqual(painel.painel.hidden, true);
    assert.match(texto, /Não foi possível carregar o painel/);
    assert.ok(texto.includes(mensagem), 'o motivo do BFF aparece no detalhe');
    assert.doesNotMatch(texto, /Seu perfil ainda não tem indicadores liberados/);
    const [botao] = painel.estadoGeral.querySelectorAll('[data-dash-acao="atualizar"]');
    assert.ok(botao, 'sem o botão o usuário não tem como tentar de novo');
    assert.match(botao.textContent, /Tentar novamente/);
    assert.strictEqual(painel.selo.textContent, 'Sem leitura');
});

test('nomes escondidos por permissão (null) não viram "null", "com —" nem título vazio', () => {
    const painel = montarPainelFalso();
    const dados = amostraComFinanceiro();
    // O que o BFF manda quando o perfil não tem a coluna que mostra o nome.
    dados.secoes.producao.maisAntigos[0].cliente = null;
    Object.assign(dados.secoes.orcamentos.vencendo7d.itens[0], { destinatario: null, dono: null });
    dados.secoes.orcamentos.vencendo7d.itens[1].dono = null;
    dados.secoes.alertas.aprovadosSemPedido.itens[0].destinatario = null;
    Object.assign(dados.secoes.prospeccao.followups.itens[0], { nome: null, proximoPasso: null });
    Object.assign(dados.secoes.estoque.negativos.itens[0], { nome: null, unidade: null });
    dados.secoes.prospeccao.valorPonderado = null;
    painel.avaliar('renderizarDashboard')(painel.modulo, dados);

    assert.deepStrictEqual(painel.erros, []);
    for (const [chave, cartao] of Object.entries(painel.cartoes)) {
        assert.strictEqual(cartao.dataset.estado, 'ok', `${chave} caiu no cartão de erro`);
        assert.doesNotMatch(painel.texto(chave), /null|undefined/, `${chave} mostrou "null"`);
        assert.doesNotMatch(painel.texto(chave), /com —/, `${chave} mostrou "com —"`);
    }
    // Sem nome a linha fica só com o número — nada de "—" solto no detalhe.
    assert.strictEqual(painel.cartoes.idade.querySelectorAll('.dash-lista__detalhe').length, 0);
    assert.strictEqual(painel.cartoes['sem-pedido'].querySelectorAll('.dash-lista__detalhe').length, 0);
    const detalhesVencendo = painel.cartoes.vencendo.querySelectorAll('.dash-lista__detalhe').map(no => no.textContent);
    assert.deepStrictEqual(detalhesVencendo, ['Prospecção'], 'o 1º item fica sem detalhe; o 2º só com o destinatário');
    const [titulo] = painel.cartoes.followups.querySelectorAll('.dash-lista__titulo');
    assert.strictEqual(titulo.textContent, 'Prospecção');
    const [detalhe] = painel.cartoes.followups.querySelectorAll('.dash-lista__detalhe');
    assert.strictEqual(detalhe.textContent, 'Proposta', 'só a etapa, sem o próximo passo escondido');
    const [insumo] = painel.cartoes.estoque.querySelectorAll('.dash-lista__titulo');
    assert.strictEqual(insumo.textContent, 'Insumo');
    assert.match(painel.texto('estoque'), /−3,5(?! L)/, 'sem a unidade fica só o número');
    assert.doesNotMatch(painel.texto('funil'), /Ponderado/, 'ponderado null some');
    assert.match(painel.texto('funil'), /Valor em aberto/);
});

// ------------------------------------------------------- CSS das correções

/** Corpo de todo `@media <condição> { ... }`, contando chaves (as regras de dentro também têm). */
function blocosDaMedia(css, condicao) {
    const blocos = [];
    let inicio = css.indexOf(`@media ${condicao}`);
    while (inicio !== -1) {
        const abre = css.indexOf('{', inicio);
        let nivel = 0;
        let fim = abre;
        for (; fim < css.length; fim += 1) {
            if (css[fim] === '{') nivel += 1;
            else if (css[fim] === '}' && --nivel === 0) break;
        }
        blocos.push(css.slice(abre + 1, fim));
        inicio = css.indexOf(`@media ${condicao}`, fim);
    }
    return blocos.join('\n');
}

const REGRAS_CSS = FONTE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

test('com movimento reduzido nada do painel fica invisível', () => {
    // menu.css zera a animação de .animate-fade-in-up, mas não o opacity: 0 de
    // partida: sem compensação o corpo inteiro do painel sumia.
    const comAnimacao = [...FONTE_HTML.matchAll(/<[a-z]+\b[^>]*class="[^"]*\banimate-fade-in-up\b[^"]*"[^>]*>/g)].map(m => m[0]);
    assert.ok(comAnimacao.length >= 5, 'cabeçalho e as quatro linhas');
    for (const tag of comAnimacao) {
        assert.ok(/\bdata-dash-linha\b/.test(tag) || /\bdash-cabecalho\b/.test(tag), `sem compensação: ${tag}`);
    }
    assert.doesNotMatch(FONTE_JS, /animate-fade-in-up/, 'o script não cria elemento com a animação');

    const reduzido = blocosDaMedia(REGRAS_CSS, '(prefers-reduced-motion: reduce)');
    assert.match(reduzido, /\.dash-painel\s*>\s*\[data-dash-linha\][^{]*\{[^}]*opacity:\s*1/);
    assert.match(reduzido, /\.dashboard-module\s*>\s*\.dash-cabecalho[^{]*\{[^}]*opacity:\s*1/);
});

test('3 KPIs entre 768 e 1279 px não deixam célula vazia na faixa', () => {
    assert.match(FONTE_HTML, /class="dash-kpis[^"]*"\s+data-dash-linha/, 'sem data-dash-linha o script não conta os visíveis');
    const faixa = blocosDaMedia(REGRAS_CSS, '(min-width: 768px) and (max-width: 1279px)');
    assert.match(faixa, /\.dash-kpis\[data-visiveis="3"\]\s*>\s*\.dash-card:not\(\[hidden\]\)\s*~\s*\.dash-card:not\(\[hidden\]\)\s*~\s*\.dash-card:not\(\[hidden\]\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
});

test('tema claro: texto de apoio, tons, foco e descrição com contraste', () => {
    // muted e tertiary davam 1,7-2,7:1 no cartão claro: nenhum texto usa mais.
    assert.doesNotMatch(REGRAS_CSS, /var\(--menu-text-muted\)/);
    assert.doesNotMatch(REGRAS_CSS, /(?:color|fill):\s*var\(--menu-text-tertiary\)/);
    assert.match(REGRAS_CSS, /\[data-menu-theme="light"\] \.dashboard-module\s*\{[^}]*--dash-texto-apoio:/);
    assert.match(REGRAS_CSS, /\[data-menu-theme="light"\] \.dashboard-module \[data-tom="ouro"\],\s*\[data-menu-theme="dark"\] \.dashboard-module \[data-tom="vinho"\],\s*\[data-menu-theme="dark"\] \.dashboard-module \[data-tom="neutro"\]\s*\{[^}]*--dash-tom-texto:\s*color-mix\(in srgb, var\(--dash-tom\) 50%/);
    assert.match(REGRAS_CSS, /:focus-visible\s*\{[^}]*outline:\s*2px solid color-mix\(in srgb, var\(--color-primary\) 60%, var\(--menu-text-strong\)\)/);
    assert.match(FONTE_HTML, /class="module-header__description dash-descricao"/);
    assert.match(REGRAS_CSS, /\.dash-cabecalho \.dash-descricao\s*\{[^}]*color:/);
    // O chip da nota do KPI quebra a linha em vez de ser cortado pelo cartão.
    assert.match(REGRAS_CSS, /\.dash-kpi__notas \.dash-chip\s*\{[^}]*white-space:\s*normal/);
});

/** Declarações de todas as regras (dentro de @media ou não) cuja lista de seletores inclui exatamente `seletor`. */
function declaracoesDo(seletor) {
    const achadas = [];
    for (const regra of REGRAS_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const seletores = regra[1].split(',').map(parte => parte.trim().replace(/\s+/g, ' '));
        if (seletores.includes(seletor)) achadas.push(regra[2]);
    }
    return achadas.join('\n');
}

test('tema claro: cada texto de apoio apontado na revisão usa o token de apoio (--menu-text-secondary)', () => {
    // O token é o --menu-text-secondary no escuro e um pouco mais forte no claro
    // (4,7:1 ou mais). Trocar UM seletor de volta para muted/tertiary, ou para
    // uma cor qualquer, não passava em teste nenhum.
    assert.match(REGRAS_CSS, /\.dashboard-module\s*\{[^}]*--dash-texto-apoio:\s*var\(--menu-text-secondary\)/);
    const seletores = [
        '.dash-barras__eixo', '.dash-barras__mes', '.dash-kpi__comparacao', '.dash-kpi__sub', '.dash-lista__detalhe',
        '.dash-legenda__valor', '.dash-legenda__numeros small', '.dash-hbarra__numeros small', '.dash-card__subtitulo',
        '.dash-grafico__dado-rotulo', '.dash-donut__rotulo', '.dash-destaque__rotulo'
    ];
    for (const seletor of seletores) {
        assert.match(declaracoesDo(seletor), /(?:^|[;\s])(?:color|fill):\s*var\(--dash-texto-apoio\)/, `${seletor} sem o texto de apoio`);
    }
    // Mês atual: dourado misturado à cor forte (5:1 no claro), não o dourado cru (1,9:1).
    assert.match(declaracoesDo('.dash-barras__coluna--atual .dash-barras__mes'),
        /fill:\s*color-mix\(in srgb, var\(--color-primary\) 50%, var\(--menu-text-strong\)\)/);
});

test('tooltip do gráfico: opaco, só com cores do tema, verde da legenda igual ao da barra', () => {
    const caixa = declaracoesDo('.dash-balao');
    // O fundo termina numa cor SÓLIDA do tema: o dono recusou pop-up transparente.
    assert.match(caixa, /background:\s*linear-gradient\([^;]*\),\s*var\(--color-bg-deep\)\s*;/);
    assert.match(caixa, /pointer-events:\s*none/, 'a caixa não pode roubar o mouse da barra');
    assert.match(caixa, /visibility:\s*hidden/, 'escondida por visibilidade: o Popover mede antes de posicionar');
    assert.match(declaracoesDo('.dash-balao.show'), /visibility:\s*visible/, '`.show` é a classe do contrato do Popover');
    assert.match(REGRAS_CSS, /\[data-menu-theme="light"\] \.dash-balao\s*\{[^}]*--dash-verde-barra:/,
        'o tooltip mora no <body>: precisa dos próprios tokens do tema claro');
    // `.dash-dica` é o parágrafo de dica dos cartões: nada da caixa pode valer para ele.
    assert.match(declaracoesDo('.dash-dica'), /font-size/);
    assert.doesNotMatch(declaracoesDo('.dash-dica'), /visibility|position|pointer-events/);
    assert.match(declaracoesDo('.dash-grafico__legenda-cor--previsao'), /background:\s*var\(--dash-verde-barra\)/);
    assert.match(declaracoesDo('.dash-barras__item--previsao .dash-barras__barra'), /fill:\s*var\(--dash-verde-barra\)/);
    // O dourado cheio do mês atual não pode pintar a barra verde do mesmo mês.
    assert.doesNotMatch(REGRAS_CSS, /\.dash-barras__coluna--atual \.dash-barras__barra\s*[,{]/);
});

test('o tooltip não pendura ouvinte em document/window: continua só o module-change', () => {
    // O script é reexecutado a cada visita: todo ouvinte global acumula.
    const globais = FONTE_JS.match(/\b(?:document|window)\.addEventListener\s*\(/g) || [];
    assert.strictEqual(globais.length, 1);
    assert.match(FONTE_JS, /window\.Popover/, 'Escape, rolagem e troca de módulo ficam com o utilitário do menu');
});

// -------------------------------------------- previsão na tela (DOM falso)

/** Todos os nós abaixo de `no` (o DOM falso só entende seletor de classe e de data-). */
function nosAbaixo(no) {
    const lista = [];
    const visitar = pai => (pai.filhos || []).forEach(filho => {
        lista.push(filho);
        visitar(filho);
    });
    visitar(no);
    return lista;
}

function comPrevisaoReal() {
    const dados = amostraDoContrato();
    dados.secoes.previsao = previsaoDaAmostraReal();
    return dados;
}

const legendaDe = painel => painel.cartoes['grafico-vendas'].querySelectorAll('.dash-grafico__legenda-item')
    .map(item => item.textContent);

test('render com a previsão da amostra real: ouro e verde agrupados, separador, legenda e programado', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, comPrevisaoReal());

    assert.deepStrictEqual(painel.erros, []);
    const grafico = painel.cartoes['grafico-vendas'];
    assert.strictEqual(grafico.dataset.estado, 'ok');
    assert.strictEqual(grafico.querySelector('[data-dash-titulo]').textContent, 'Vendas fechadas e previsão de faturamento');
    const colunas = grafico.querySelectorAll('.dash-barras__coluna');
    assert.strictEqual(colunas.length, 16, '12 meses passados + 4 futuros');
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__item--vendas').length, 12);
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__item--previsao').length, 16);
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__coluna--futura').length, 4);
    const atuais = colunas.filter(coluna => coluna.classList.contains('dash-barras__coluna--atual'));
    assert.strictEqual(atuais.length, 1);
    assert.match(atuais[0].textContent, /set\/26/);
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__separador').length, 1);
    assert.strictEqual(grafico.querySelector('.dash-barras__previsao-rotulo').textContent, 'previsão');
    assert.deepStrictEqual(legendaDe(painel), ['Vendas fechadas', 'Previsão de faturamento (parcelas pelo vencimento)']);
    const texto = painel.texto('grafico-vendas');
    assert.match(texto, /Programado de set\/26 em diante/);
    assert.match(texto, /R\$ 72,2 mil/, 'programadoDesteMes = 72.204,38');
    assert.doesNotMatch(texto, /depois de/, 'nada além do horizonte na amostra');
    assert.ok(nosAbaixo(grafico).every(no => no.tagName !== 'TITLE'), 'o tooltip próprio substitui o <title> nativo');
    const verdeOut = colunas[12].querySelectorAll('.dash-barras__item--previsao')[0];
    assert.strictEqual(verdeOut.getAttribute('tabindex'), '0');
    assert.strictEqual(verdeOut.getAttribute('role'), 'img');
    assert.strictEqual(semEspacoFixo(verdeOut.getAttribute('aria-label')),
        'Previsão de faturamento em outubro de 2026: R$ 24.733,40 · 6 pedidos · 10 parcelas');
    const [svg] = grafico.querySelectorAll('.dash-barras');
    assert.strictEqual(svg.getAttribute('role'), 'group', 'dentro de role=img as barras focáveis sumiriam do leitor de tela');
});

test('legenda: sem a previsão no perfil só o ouro, com o título e o gráfico de antes', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, amostraDoContrato());
    const grafico = painel.cartoes['grafico-vendas'];
    assert.deepStrictEqual(legendaDe(painel), ['Vendas fechadas']);
    assert.strictEqual(grafico.querySelector('[data-dash-titulo]').textContent, 'Vendas fechadas — últimos 12 meses');
    assert.strictEqual(grafico.querySelector('[data-dash-subtitulo]').textContent,
        'Pedidos gerados na aprovação do orçamento, sem os cancelados');
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__item--previsao').length, 0);
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__separador').length, 0);
    assert.strictEqual(grafico.querySelectorAll('.dash-grafico__nota').length, 0);
    assert.doesNotMatch(painel.texto('grafico-vendas'), /Programado|previsão/i);
});

test('previsão em falha: o gráfico de ouro fica como está e ganha só a nota discreta', () => {
    const painel = montarPainelFalso();
    const dados = amostraDoContrato();
    dados.falhas.previsao = 'Não foi possível ler as parcelas dos pedidos agora.';
    painel.avaliar('renderizarDashboard')(painel.modulo, dados);

    const grafico = painel.cartoes['grafico-vendas'];
    assert.strictEqual(grafico.dataset.estado, 'ok');
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__coluna').length, 12);
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__item--previsao').length, 0);
    const [nota] = grafico.querySelectorAll('.dash-grafico__nota');
    assert.ok(nota, 'nota da previsão indisponível');
    assert.strictEqual(nota.textContent, 'Previsão de faturamento indisponível agora.');
    assert.strictEqual(nota.title, dados.falhas.previsao, 'o motivo do BFF fica no title');
    assert.strictEqual(nota.querySelectorAll('[data-dash-acao="atualizar"]').length, 0, 'o Atualizar do cabeçalho já relê');
    assert.deepStrictEqual(legendaDe(painel), ['Vendas fechadas']);
    assert.strictEqual(grafico.querySelector('[data-dash-titulo]').textContent, 'Vendas fechadas e previsão de faturamento');
});

test('previsão sem vendas: gráfico só verde e título ajustado; vendas sem R$ não misturam a previsão', () => {
    const painel = montarPainelFalso();
    const dados = comPrevisaoReal();
    delete dados.secoes.vendas;
    painel.avaliar('renderizarDashboard')(painel.modulo, dados);

    assert.deepStrictEqual(painel.erros, []);
    const grafico = painel.cartoes['grafico-vendas'];
    assert.strictEqual(grafico.hidden, false);
    assert.strictEqual(grafico.querySelector('[data-dash-titulo]').textContent, 'Previsão de faturamento');
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__item--vendas').length, 0);
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__item--previsao').length, 16);
    assert.deepStrictEqual(legendaDe(painel), ['Previsão de faturamento (parcelas pelo vencimento)']);
    assert.doesNotMatch(painel.texto('grafico-vendas'), /Nos 12 meses/);
    assert.strictEqual(painel.cartoes['kpi-vendas'].hidden, true, 'os KPIs continuam dependendo só de vendas');

    // Sem a coluna de valor as vendas contam pedidos: R$ da previsão não entra nesse eixo.
    const contagem = montarPainelFalso();
    const semDinheiro = anularDinheiro(amostraDoContrato());
    semDinheiro.secoes.previsao = previsaoDaAmostraReal();
    contagem.avaliar('renderizarDashboard')(contagem.modulo, semDinheiro);
    const graficoContagem = contagem.cartoes['grafico-vendas'];
    assert.strictEqual(graficoContagem.querySelectorAll('.dash-barras__coluna').length, 12);
    assert.strictEqual(graficoContagem.querySelectorAll('.dash-barras__item--previsao').length, 0);
    assert.match(contagem.texto('grafico-vendas'), /quantidade de pedidos/);
    assert.deepStrictEqual(legendaDe(contagem), ['Vendas fechadas']);
});

test('parcela além do último mês do gráfico aparece como "+R$ Y depois de <mês>"', () => {
    const painel = montarPainelFalso();
    const dados = comPrevisaoReal();
    dados.secoes.previsao.alemDoHorizonte = { valor: 6653.52, parcelas: 2, ate: '2027-11' };
    painel.avaliar('renderizarDashboard')(painel.modulo, dados);
    const [nota] = painel.cartoes['grafico-vendas'].querySelectorAll('.dash-grafico__dado-nota');
    assert.ok(nota, 'nada é cortado em silêncio');
    assert.strictEqual(semEspacoFixo(nota.textContent), '+R$ 6,7 mil depois de jan/27');
    assert.strictEqual(semEspacoFixo(nota.title), '2 parcelas até nov/27: R$ 6.653,52');
});

test('foco de teclado abre o tooltip único; blur, Escape, sair do mouse e o segundo toque fecham', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, comPrevisaoReal());
    const colunas = painel.cartoes['grafico-vendas'].querySelectorAll('.dash-barras__coluna');
    const verdeOut = colunas[12].querySelectorAll('.dash-barras__item--previsao')[0];
    const ouroSet = colunas[11].querySelectorAll('.dash-barras__item--vendas')[0];

    disparar(verdeOut, 'focus');
    assert.strictEqual(painel.popover.aberturas.length, 1);
    const { caixa, ancora } = painel.popover.aberturas[0];
    assert.strictEqual(ancora, colunas[12], 'ancorada na coluna: abre abaixo dos rótulos de mês');
    assert.ok(caixa.classList.contains('show'));
    assert.strictEqual(caixa.id, 'dash-balao-grafico');
    // Nunca a classe do parágrafo de dica dos cartões: as regras da caixa o apagariam.
    assert.strictEqual(caixa.className, 'dash-balao show');
    assert.strictEqual(caixa.getAttribute('role'), 'tooltip');
    assert.strictEqual(caixa.dataset.serie, 'previsao');
    const texto = semEspacoFixo(caixa.textContent);
    assert.match(texto, /Previsão · out\/26/);
    assert.match(texto, /R\$ 24\.733,40 · 6 pedidos · 10 parcelas/);
    assert.match(texto, /PED105 · VetriR\$ 5\.193,88parcelas 1, 2 e 3 de 3 · vence 02\/10, 16\/10 e 30\/10/);
    assert.strictEqual(caixa.querySelectorAll('.dash-balao__item').length, 6);
    assert.strictEqual(verdeOut.getAttribute('aria-describedby'), 'dash-balao-grafico');
    disparar(verdeOut, 'blur');
    assert.strictEqual(caixa.classList.contains('show'), false, 'o blur fecha');
    assert.strictEqual(verdeOut.getAttribute('aria-describedby'), null);

    // Mouse na barra de ouro: a MESMA caixa, com o resumo simples.
    disparar(ouroSet, 'pointerenter', { pointerType: 'mouse' });
    assert.strictEqual(painel.popover.aberturas.at(-1).caixa, caixa, 'um único tooltip por módulo');
    assert.strictEqual(semEspacoFixo(caixa.textContent), 'Vendas fechadas · set/26R$ 84 mil · 12 pedidos');
    assert.strictEqual(caixa.dataset.serie, 'vendas');
    disparar(ouroSet, 'pointerleave', { pointerType: 'mouse' });
    assert.strictEqual(caixa.classList.contains('show'), false, 'sair com o mouse fecha');

    // Toque: o "entrar" do dedo não abre (não haveria "sair"); o toque alterna.
    disparar(ouroSet, 'pointerenter', { pointerType: 'touch' });
    assert.strictEqual(caixa.classList.contains('show'), false);
    disparar(ouroSet, 'click');
    assert.ok(caixa.classList.contains('show'), 'o toque abre');
    disparar(ouroSet, 'click');
    assert.strictEqual(caixa.classList.contains('show'), false, 'o segundo toque fecha');

    disparar(verdeOut, 'focus');
    disparar(verdeOut, 'keydown', { key: 'Escape' });
    assert.strictEqual(caixa.classList.contains('show'), false, 'Escape fecha');

    // O blur atrasado de uma barra antiga não fecha a caixa aberta por outra.
    disparar(verdeOut, 'focus');
    disparar(ouroSet, 'blur');
    assert.ok(caixa.classList.contains('show'));
    // Nova leitura redesenha as barras: a caixa fecha junto.
    painel.avaliar('renderizarDashboard')(painel.modulo, comPrevisaoReal());
    assert.strictEqual(caixa.classList.contains('show'), false);
    assert.deepStrictEqual(painel.erros, []);
});

test('sem o window.Popover as barras continuam com o aria-label e nada quebra', () => {
    const painel = montarPainelFalso({ popover: null });
    painel.avaliar('renderizarDashboard')(painel.modulo, comPrevisaoReal());
    const [verde] = painel.cartoes['grafico-vendas'].querySelectorAll('.dash-barras__item--previsao');
    assert.doesNotThrow(() => {
        disparar(verde, 'focus');
        disparar(verde, 'click');
        disparar(verde, 'blur');
    });
    assert.match(verde.getAttribute('aria-label'), /^Previsão de faturamento em outubro de 2025: Nenhuma parcela neste mês$/);
    assert.deepStrictEqual(painel.erros, []);
});

// ---------------------------------------------- prazo de embarque (produção)

/**
 * A seção `producao` com o prazo de embarque (contrato novo), hoje = 13/09/2026:
 * sete pedidos na lista — dois atrasados, dois em atenção (embarca hoje e
 * amanhã), dois em dia e um sem previsão. `emDia` inclui a atenção.
 */
function producaoComPrazo() {
    const pedido = (n, dias, embarque, diasParaEmbarque, prazo) => ({
        id: n, numero: `PED${n}`, cliente: `Cliente ${n}`, dias, valor: n * 1000, embarque, diasParaEmbarque, prazo
    });
    return {
        quantidade: 7,
        valor: 52000,
        prazo: {
            emDia: { quantidade: 4, valor: 32000 },
            atencao: { quantidade: 2, valor: 12000 },
            atrasados: { quantidade: 2, valor: 20000 },
            semPrevisao: { quantidade: 1, valor: 0 }
        },
        porIdade: [
            { faixa: '0-15', quantidade: 3 }, { faixa: '16-30', quantidade: 2 },
            { faixa: '31-60', quantidade: 1 }, { faixa: '60+', quantidade: 1 }
        ],
        maisAntigos: [
            pedido(1, 74, '2026-09-10', -3, 'atrasado'),
            // DATE como o upstream serializa: 12/09, não 11/09.
            pedido(2, 40, '2026-09-12T00:00:00.000Z', -1, 'atrasado'),
            pedido(3, 30, '2026-09-13', 0, 'atencao'),
            pedido(4, 20, '2026-09-14', 1, 'atencao'),
            pedido(5, 12, '2026-09-25', 12, 'em_dia'),
            pedido(6, 5, null, null, 'sem_previsao'),
            pedido(7, 2, '2026-09-20', 7, 'em_dia')
        ],
        porSituacao12m: [
            { situacao: 'Produção', quantidade: 7, valor: 52000, emDia: 4, atrasados: 2, semPrevisao: 1 },
            { situacao: 'Enviado', quantidade: 3, valor: 21000, emDia: 2, atrasados: 1, semPrevisao: 0 },
            { situacao: 'Entregue', quantidade: 20, valor: 150000, emDia: 15, atrasados: 3, semPrevisao: 2 },
            { situacao: 'Cancelado', quantidade: 1, valor: 3200, emDia: 0, atrasados: 0, semPrevisao: 0 },
            { situacao: 'Outros', quantidade: 0, valor: 0, emDia: 0, atrasados: 0, semPrevisao: 0 }
        ]
    };
}

/** Painel desenhado com a produção de `producaoComPrazo`; `mudar` ajusta (ou troca) a resposta antes. */
function painelComPrazo(mudar = () => {}) {
    const painel = montarPainelFalso();
    const inicial = amostraDoContrato();
    inicial.secoes.producao = producaoComPrazo();
    const dados = mudar(inicial) || inicial;
    const redesenhar = () => painel.avaliar('renderizarDashboard')(painel.modulo, dados);
    redesenhar();
    return { painel, dados, redesenhar };
}

test('prazo de embarque: "faltam X dias", "falta 1 dia", "embarca hoje", "em atraso" e a data prevista em dd/mm/aa', () => {
    const texto = avaliar('textoEmbarque');
    assert.strictEqual(texto(12), 'faltam 12 dias');
    assert.strictEqual(texto(7), 'faltam 7 dias');
    assert.strictEqual(texto(2), 'faltam 2 dias');
    assert.strictEqual(texto(1), 'falta 1 dia');
    assert.strictEqual(texto(0), 'embarca hoje');
    assert.strictEqual(texto(-1), 'em atraso');
    assert.strictEqual(texto(-30), 'em atraso');
    assert.strictEqual(texto(null), 'sem previsão');

    const data = avaliar('formatarDataComAno');
    // Meia-noite UTC do dia 13 é noite do dia 12 em São Paulo: não pode virar 12.
    assert.strictEqual(data('2026-09-13T00:00:00.000Z'), '13/09/26');
    assert.strictEqual(data('2027-01-05'), '05/01/27');
    assert.strictEqual(data(null), '');
    assert.strictEqual(data('a combinar'), '');

    const etiqueta = avaliar('etiquetaDeEmbarque');
    const partes = e => (e ? [e.texto, e.tom, e.dica, e.alerta ? e.alerta.tom : null] : null);
    assert.deepStrictEqual(partes(etiqueta({ prazo: 'em_dia', diasParaEmbarque: 12, embarque: '2026-09-25' })),
        ['faltam 12 dias', 'ouro', 'Data prevista: 25/09/26', null]);
    assert.deepStrictEqual(partes(etiqueta({ prazo: 'atencao', diasParaEmbarque: 0, embarque: '2026-09-13T00:00:00.000Z' })),
        ['embarca hoje', 'vermelho', 'Data prevista: 13/09/26', 'vermelho']);
    assert.deepStrictEqual(partes(etiqueta({ prazo: 'atrasado', diasParaEmbarque: -3, embarque: '2026-09-10' })),
        ['em atraso', 'roxo', 'Data prevista: 10/09/26\natrasado há 3 dias', 'roxo']);
    assert.deepStrictEqual(partes(etiqueta({ prazo: 'sem_previsao', diasParaEmbarque: null, embarque: null })),
        ['sem previsão', 'neutro', 'Sem previsão de embarque — defina no pagamento do pedido', null]);
    // Servidor anterior à previsão (sem `prazo`): nada de "sem previsão" inventado.
    assert.strictEqual(etiqueta({ dias: 12 }), null);

    // A data do title é cortada como texto, nunca por `new Date`.
    const fonte = ['formatarDataComAno', 'textoEmbarque', 'etiquetaDeEmbarque'].map(nome => avaliar(nome).toString()).join('\n');
    assert.doesNotMatch(fonte, /new Date/);
});

test('produção por idade: etiqueta de prazo à direita da de idade, na cor do prazo, com a data prevista no title', () => {
    const { painel } = painelComPrazo();
    assert.deepStrictEqual(painel.erros, []);
    const cartao = painel.cartoes.idade;
    assert.strictEqual(cartao.dataset.estado, 'ok');
    const itens = cartao.querySelectorAll('.dash-lista__item');
    assert.strictEqual(itens.length, 7, 'o BFF manda a lista inteira');

    const linhas = itens.map(item => {
        const [grupo] = item.querySelectorAll('.dash-lista__etiquetas');
        const [idade, prazo] = grupo.querySelectorAll('.dash-chip');
        const [alerta] = item.querySelectorAll('.dash-lista__alerta');
        return [idade.textContent, idade.dataset.tom, prazo.textContent, prazo.dataset.tom, prazo.title, alerta ? alerta.dataset.tom : null];
    });
    assert.deepStrictEqual(linhas, [
        ['há 74 dias', 'vinho', 'em atraso', 'roxo', 'Data prevista: 10/09/26\natrasado há 3 dias', 'roxo'],
        ['há 40 dias', 'neutro', 'em atraso', 'roxo', 'Data prevista: 12/09/26\natrasado há 1 dia', 'roxo'],
        ['há 30 dias', 'neutro', 'embarca hoje', 'vermelho', 'Data prevista: 13/09/26', 'vermelho'],
        ['há 20 dias', 'neutro', 'falta 1 dia', 'vermelho', 'Data prevista: 14/09/26', 'vermelho'],
        ['há 12 dias', 'neutro', 'faltam 12 dias', 'ouro', 'Data prevista: 25/09/26', null],
        ['há 5 dias', 'neutro', 'sem previsão', 'neutro', 'Sem previsão de embarque — defina no pagamento do pedido', null],
        ['há 2 dias', 'neutro', 'faltam 7 dias', 'ouro', 'Data prevista: 20/09/26', null]
    ]);

    // O símbolo vai junto do número, sem mexer no texto nem no title dele.
    const [primeiro] = itens;
    const [titulo] = primeiro.querySelectorAll('.dash-lista__titulo');
    assert.strictEqual(titulo.textContent, 'PED1');
    assert.strictEqual(titulo.title, 'PED1');
    const [alerta] = titulo.querySelectorAll('.dash-lista__alerta');
    assert.ok(alerta.classList.contains('fa-triangle-exclamation'));
    assert.strictEqual(alerta.getAttribute('aria-hidden'), 'true');
    // Idade e prazo na mesma linha (o grupo); o valor continua embaixo.
    const [lado] = primeiro.querySelectorAll('.dash-lista__lado');
    assert.deepStrictEqual(lado.childNodes.map(no => no.className), ['dash-lista__etiquetas', 'dash-lista__valor']);
    assert.match(painel.texto('idade'), /Idade contada desde a aprovação; o prazo é a previsão de embarque\./);
    assert.doesNotMatch(painel.texto('idade'), /não é atraso/);
});

test('"+N não listados" vira botão que abre a lista inteira e recolhe, e o estado sobrevive ao Atualizar', () => {
    const { painel, redesenhar } = painelComPrazo();
    const cartao = painel.cartoes.idade;
    const visiveis = () => cartao.querySelectorAll('.dash-lista__item').filter(item => !item.hidden).length;
    const botaoAtual = () => cartao.querySelectorAll('.dash-mais__botao')[0];

    const botao = botaoAtual();
    assert.ok(botao, 'lista com mais de cinco ganha o botão');
    assert.strictEqual(botao.tagName, 'BUTTON');
    assert.strictEqual(botao.type, 'button');
    assert.strictEqual(botao.dataset.semGuarda, 'true', 'só mostra e esconde: a trava de duplo clique engoliria o 2º clique');
    assert.strictEqual(botao.getAttribute('aria-controls'), 'dash-idade-lista');
    assert.strictEqual(cartao.querySelectorAll('.dash-lista')[0].id, 'dash-idade-lista');
    assert.strictEqual(visiveis(), 5);
    assert.strictEqual(botao.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(botao.textContent, '+2 não listados');
    assert.strictEqual(botao.querySelectorAll('.fa-chevron-down').length, 1);
    // Escondidos pelo ATRIBUTO hidden — a classe `hidden` do Tailwind offline pode não existir.
    const ocultos = cartao.querySelectorAll('.dash-lista__item').filter(item => item.hidden);
    assert.deepStrictEqual(ocultos.map(item => item.querySelectorAll('.dash-lista__titulo')[0].textContent), ['PED6', 'PED7']);
    assert.ok(ocultos.every(item => !item.classList.contains('hidden')));

    disparar(botao, 'click');
    assert.strictEqual(visiveis(), 7, 'aberto: a lista inteira');
    assert.strictEqual(botao.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(botao.textContent, 'mostrar menos');
    assert.strictEqual(botao.querySelectorAll('.fa-chevron-up').length, 1);

    // "Atualizar" recria o corpo inteiro: quem abriu continua vendo tudo.
    redesenhar();
    const novo = botaoAtual();
    assert.notStrictEqual(novo, botao, 'o botão é outro, recriado');
    assert.strictEqual(visiveis(), 7);
    assert.strictEqual(novo.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(novo.textContent, 'mostrar menos');

    disparar(novo, 'click');
    assert.strictEqual(visiveis(), 5, '"mostrar menos" recolhe');
    assert.strictEqual(novo.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(novo.textContent, '+2 não listados');
    redesenhar();
    assert.strictEqual(visiveis(), 5, 'e recolhido também sobrevive ao Atualizar');
    // O ouvinte é do próprio botão (o do module-change continua o único global).
    assert.deepStrictEqual(botaoAtual().ouvintes.map(ouvinte => ouvinte.tipo), ['click']);
    assert.deepStrictEqual(painel.erros, []);
});

test('pedido que nem vem na lista continua no "+N": fechado conta todos, aberto fica ao lado do "mostrar menos"', () => {
    // Nove em produção e sete na lista: dois sem data de início, que o BFF não lista.
    const { painel } = painelComPrazo(dados => { dados.secoes.producao.quantidade = 9; });
    const cartao = painel.cartoes.idade;
    const [botao] = cartao.querySelectorAll('.dash-mais__botao');
    const [resto] = cartao.querySelectorAll('.dash-mais__resto');
    assert.strictEqual(botao.textContent, '+4 não listados', '2 escondidos + 2 fora da lista');
    assert.strictEqual(resto.hidden, true);
    disparar(botao, 'click');
    assert.strictEqual(resto.hidden, false);
    assert.strictEqual(resto.textContent, '+2 não listados');
    assert.strictEqual(botao.textContent, 'mostrar menos');
    assert.strictEqual(cartao.querySelectorAll('.dash-mais')[0].textContent, '+2 não listadosmostrar menos');

    // Lista de até cinco: sem botão, o "+N não listados" de sempre.
    const curta = painelComPrazo(dados => { dados.secoes.producao.maisAntigos = dados.secoes.producao.maisAntigos.slice(0, 5); });
    assert.strictEqual(curta.painel.cartoes.idade.querySelectorAll('.dash-mais__botao').length, 0);
    assert.match(curta.painel.texto('idade'), /\+2 não listados/);
});

test('KPI "Em produção": em dia × em atraso nos chips, com o valor compacto, e "sem previsão" só quando há', () => {
    const chipsDe = painel => painel.cartoes['kpi-producao'].querySelectorAll('.dash-chip')
        .map(chip => [semEspacoFixo(chip.textContent), chip.dataset.tom]);

    const { painel } = painelComPrazo();
    assert.deepStrictEqual(chipsDe(painel), [
        ['4 em dia · R$ 32 mil', 'verde'],
        ['2 em atraso · R$ 20 mil', 'roxo'],
        ['1 sem previsão', 'neutro'],
        ['1 há mais de 60 dias', 'ouro']
    ]);
    const [emDia] = painel.cartoes['kpi-producao'].querySelectorAll('.dash-chip');
    assert.strictEqual(emDia.title, 'Inclui 2 que embarcam em menos de 7 dias', 'a atenção está dentro do "em dia"');

    // Sem a coluna de valor: só as contagens.
    const semValor = painelComPrazo(dados => anularDinheiro(dados));
    assert.deepStrictEqual(chipsDe(semValor.painel).slice(0, 2), [['4 em dia', 'verde'], ['2 em atraso', 'roxo']]);

    // Nada atrasado nem sem previsão: "0 em atraso" neutro, e o "sem previsão" some.
    const emOrdem = painelComPrazo(dados => {
        Object.assign(dados.secoes.producao.prazo, {
            emDia: { quantidade: 7, valor: 52000 },
            atrasados: { quantidade: 0, valor: 0 },
            semPrevisao: { quantidade: 0, valor: 0 }
        });
    });
    assert.deepStrictEqual(chipsDe(emOrdem.painel), [
        ['7 em dia · R$ 52 mil', 'verde'], ['0 em atraso', 'neutro'], ['1 há mais de 60 dias', 'ouro']
    ]);

    // Servidor anterior à previsão (a amostra antiga): só o chip dos 60 dias, nenhum "0 em atraso" inventado.
    const antigo = montarPainelFalso();
    antigo.avaliar('renderizarDashboard')(antigo.modulo, amostraDoContrato());
    assert.deepStrictEqual(chipsDe(antigo), [['1 há mais de 60 dias', 'ouro']]);
});

test('donut: anel fino de prazo por fora das situações, sem anel no Cancelado, e "em dia · em atraso" na legenda', () => {
    const { painel } = painelComPrazo();
    assert.deepStrictEqual(painel.erros, []);
    const cartao = painel.cartoes['grafico-situacao'];
    assert.strictEqual(cartao.querySelectorAll('.dash-donut__fatia').length, 4, 'o anel de prazo não conta como fatia');
    assert.match(painel.texto('grafico-situacao'), /31pedidos/);

    const tituloDe = no => no.filhos.find(filho => filho.tagName === 'TITLE').textContent;
    const arcos = cartao.querySelectorAll('.dash-donut__prazo');
    assert.deepStrictEqual(arcos.map(arco => [tituloDe(arco), arco.dataset.tom]), [
        ['Produção · em dia: 4 pedidos', 'verde'],
        ['Produção · em atraso: 2 pedidos', 'roxo'],
        ['Produção · sem previsão: 1 pedido', 'neutro'],
        ['Enviado · embarque no prazo: 2 pedidos', 'verde'],
        ['Enviado · embarque atrasado: 1 pedido', 'roxo'],
        ['Entregue · embarque no prazo: 15 pedidos', 'verde'],
        ['Entregue · embarque atrasado: 3 pedidos', 'roxo'],
        ['Entregue · sem previsão ou sem data de embarque: 2 pedidos', 'neutro']
    ]);
    assert.ok(arcos.every(arco => arco.getAttribute('r') === '19.9'), 'por fora do anel principal');
    // A fatia leva o resumo do prazo numa 2ª linha do <title>.
    const [fatiaProducao] = cartao.querySelectorAll('.dash-donut__fatia');
    assert.strictEqual(tituloDe(fatiaProducao), 'Produção: 7 pedidos (22,6%)\n4 em dia · 2 em atraso · 1 sem previsão');

    const legenda = cartao.querySelectorAll('.dash-legenda__item').map(item => {
        const [prazo] = item.querySelectorAll('.dash-legenda__prazo');
        return [item.querySelectorAll('.dash-legenda__nome')[0].textContent, prazo ? prazo.textContent : null];
    });
    assert.deepStrictEqual(legenda, [
        ['Produção', '4 em dia · 2 em atraso · 1 sem previsão'],
        ['Enviado', '2 em dia · 1 em atraso'],
        ['Entregue', '15 em dia · 3 em atraso · 2 sem previsão'],
        ['Cancelado', null]
    ]);
    const tons = cartao.querySelectorAll('.dash-legenda__prazo-parte').slice(0, 3).map(parte => parte.dataset.tom);
    assert.deepStrictEqual(tons, ['verde', 'roxo', 'neutro'], 'cada parte na cor do anel');

    // Sem os campos novos (servidor anterior): o donut de antes, sem anel e sem linha.
    const antigo = montarPainelFalso();
    antigo.avaliar('renderizarDashboard')(antigo.modulo, amostraDoContrato());
    assert.strictEqual(antigo.cartoes['grafico-situacao'].querySelectorAll('.dash-donut__prazo').length, 0);
    assert.strictEqual(antigo.cartoes['grafico-situacao'].querySelectorAll('.dash-legenda__prazo').length, 0);
});

test('anel de prazo: cada situação dividida na proporção, começando onde a fatia começa e cabendo nela', () => {
    const geo = avaliar('geometriaDonut')(producaoComPrazo().porSituacao12m);
    const arcos = avaliar('arcosDePrazo')(geo.segmentos);
    const escala = (2 * Math.PI * avaliar('DASH_RAIO_PRAZO')) / 100;
    for (const segmento of geo.segmentos) {
        const daFatia = arcos.filter(arco => arco.situacao === segmento.situacao);
        if (segmento.situacao === 'Cancelado') {
            assert.strictEqual(daFatia.length, 0, 'Cancelado não tem prazo');
            continue;
        }
        const comprimentos = daFatia.map(arco => Number(arco.dasharray.split(' ')[0]) / escala);
        const ocupado = comprimentos.reduce((soma, c) => soma + c, 0) + 0.35 * (daFatia.length - 1);
        assert.ok(Math.abs(ocupado - segmento.comprimento) < 0.01, `${segmento.situacao}: o anel sai da fatia`);
        assert.ok(Math.abs(Number(daFatia[0].dashoffset) / escala - (25 - segmento.inicio)) < 0.01,
            `${segmento.situacao}: o anel não começa com a fatia`);
        daFatia.forEach(arco => {
            const [traco, vao] = arco.dasharray.split(' ').map(Number);
            assert.ok(Math.abs(traco + vao - 100 * escala) < 0.01, 'o padrão do traço é a circunferência do anel de fora');
        });
        // 4 em dia contra 2 em atraso na Produção: o dobro do comprimento.
        if (segmento.situacao === 'Produção') assert.ok(Math.abs(comprimentos[0] / comprimentos[1] - 2) < 0.01);
    }
    const semCampos = avaliar('geometriaDonut')(amostraDoContrato().secoes.producao.porSituacao12m);
    assert.strictEqual(avaliar('arcosDePrazo')(semCampos.segmentos).length, 0, 'sem os campos novos, nenhum anel');
});

const FONTE_MENU_CSS = fs.readFileSync(path.join(SRC, 'css', 'menu.css'), 'utf8');

/** [r, g, b] de uma cor hexadecimal de um tema de menu.css. */
function corDoTema(tema, variavel) {
    const bloco = new RegExp(`\\[data-menu-theme="${tema}"\\]\\s*\\{([^}]*)\\}`).exec(FONTE_MENU_CSS)[1];
    const hex = new RegExp(`${variavel}:\\s*#([0-9a-f]{6})\\b`, 'i').exec(bloco)[1];
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
}

/** Matiz (0–360°) e saturação (0–1, HSL) de [r, g, b]. */
function matizESaturacao([r, g, b]) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (!d) return { matiz: 0, saturacao: 0 };
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    const luz = (max + min) / 2 / 255;
    return { matiz: (h * 60 + 360) % 360, saturacao: d / 255 / (1 - Math.abs(2 * luz - 1)) };
}

test('o roxo do "em atraso" é roxo de verdade nos dois temas, e o --color-violet do tema não serviria', () => {
    assert.match(REGRAS_CSS, /\.dashboard-module \[data-tom="roxo"\]\s*\{[^}]*--dash-tom:\s*var\(--dash-roxo\)/);
    assert.match(declaracoesDo('.dashboard-module'), /--dash-roxo:\s*var\(--color-purple\)/);
    for (const tema of ['dark', 'light']) {
        const { matiz, saturacao } = matizESaturacao(corDoTema(tema, '--color-purple'));
        assert.ok(matiz >= 265 && matiz <= 300, `${tema}: matiz ${matiz.toFixed(0)}° não é roxo`);
        // Roxo forte, como o #7300ba do app — o color-mix de antes dava um lilás acinzentado.
        assert.ok(saturacao >= 0.6, `${tema}: saturação ${saturacao.toFixed(2)} é apagada demais`);
    }
    // O porquê de não usar o --color-violet: no escuro ele é cinza.
    assert.ok(matizESaturacao(corDoTema('dark', '--color-violet')).saturacao < 0.1);
});

test('CSS do prazo: etiquetas lado a lado, símbolo e anel na cor do tom, botão de expandir com foco visível', () => {
    assert.match(declaracoesDo('.dash-lista__etiquetas'), /display:\s*flex/);
    assert.doesNotMatch(declaracoesDo('.dash-lista__etiquetas'), /flex-direction:\s*column/, 'lado a lado, não empilhadas');
    assert.match(declaracoesDo('.dash-lista__alerta'), /color:\s*var\(--dash-tom\)/);
    assert.match(declaracoesDo('.dash-donut__prazo'), /stroke:\s*var\(--dash-tom\)/);
    assert.match(declaracoesDo('.dash-mais__botao:focus-visible'), /outline:\s*2px solid/);
});

// ------------------------------------------------- cancelado e devolvido

const ZERO_SAIDA = { quantidade: 0, valor: 0 };
// O que sai do vm é de outro 'realm': sem isto o deepStrictEqual recusa vetores iguais.
const daqui = valor => JSON.parse(JSON.stringify(valor));
const serieComSaidas = () => Array.from({ length: 12 }, (_, i) => ({
    mes: `2026-${String(i + 1).padStart(2, '0')}`,
    quantidade: 2,
    valor: 40000,
    cancelado: i === 7 ? { quantidade: 1, valor: 20000 } : ZERO_SAIDA,
    devolvido: i === 7 ? { quantidade: 2, valor: 10000 } : (i === 8 ? { quantidade: 1, valor: 1500 } : ZERO_SAIDA)
}));

test('cancelado e devolvido penduram abaixo da linha de base, na mesma escala, sem mexer nas barras de cima', () => {
    const geometria = avaliar('geometriaGrafico');
    const opcoes = { largura: 720, altura: 240, chave: 'valor', mesAtual: '2026-12' };
    const semNada = geometria(soVendas(serieComSaidas().map(m => ({ ...m, cancelado: ZERO_SAIDA, devolvido: ZERO_SAIDA }))), opcoes);
    const geo = geometria(soVendas(serieComSaidas()), opcoes);

    // Sem o que mostrar a geometria é a de sempre: base no pé, nenhuma marca negativa.
    assert.strictEqual(semNada.fundo, 0);
    assert.strictEqual(semNada.baseY, semNada.topoY + semNada.areaAltura);
    assert.ok(semNada.grade.every(linha => linha.valor >= 0));
    assert.ok(semNada.colunas.every(coluna => coluna.saidasVendas.length === 0 && coluna.saidasPrevisao.length === 0));

    // Com saídas a linha de base sobe e as barras de cima continuam nascendo nela.
    assert.ok(geo.fundo >= 30000, 'o fundo cobre o mês em que mais saiu (20 mil + 10 mil)');
    assert.ok(geo.baseY < semNada.baseY);
    geo.colunas.forEach((coluna, i) => {
        assert.ok(Math.abs(coluna.vendas.y + coluna.vendas.altura - geo.baseY) < 1e-9, `a barra ${i} não nasce na base`);
        assert.strictEqual(coluna.vendas.x, semNada.colunas[i].vendas.x, 'o que saiu não rouba largura da barra');
        assert.strictEqual(coluna.vendas.largura, semNada.colunas[i].vendas.largura);
    });
    const agosto = geo.colunas[7];
    assert.deepStrictEqual(daqui(agosto.saidasVendas.map(s => s.tipo)), ['cancelado', 'devolvido'], 'o vermelho vem antes do roxo');
    const [vermelha, roxa] = agosto.saidasVendas;
    assert.ok(vermelha.y >= geo.baseY && roxa.y >= vermelha.y + vermelha.altura, 'empilhadas para baixo, sem se sobrepor');
    // Os 2 px de vão saem de dentro do trecho de cada uma: o trecho é que segue a escala.
    assert.ok(Math.abs((vermelha.altura + 2) / (roxa.altura + 2) - 2) < 1e-9, '20 mil é o dobro de 10 mil: mesma escala');
    assert.ok(Math.abs((vermelha.altura + 2) / agosto.vendas.altura - 0.5) < 1e-9, 'e a mesma escala das barras de cima');
    assert.ok(roxa.y + roxa.altura <= geo.topoY + geo.areaAltura + 1e-9, 'nada passa do pé do gráfico');
    assert.strictEqual(vermelha.x, agosto.vendas.x);
    assert.strictEqual(geo.colunas[8].saidasVendas.length, 1);
    assert.ok(geo.colunas[8].saidasVendas[0].altura >= 3, 'devolução pequena ainda aparece');
    assert.deepStrictEqual(daqui(geo.colunas[0].saidasVendas), []);
    // A grade ganha as marcas abaixo de zero, no mesmo passo do eixo.
    const negativas = geo.grade.filter(linha => linha.valor < 0);
    assert.ok(negativas.length >= 1 && negativas.length <= 4);
    negativas.forEach(linha => assert.ok(linha.y > geo.baseY && linha.valor % geo.escala.passo === 0));
});

test('na previsão o que saiu é em R$ (pelo vencimento) e fica sob a barra verde; saída maior que tudo não estoura a grade', () => {
    const geometria = avaliar('geometriaGrafico');
    const colunas = avaliar('colunasDoGrafico')(
        [{ mes: '2026-09', quantidade: 1, valor: 1000, cancelado: ZERO_SAIDA, devolvido: ZERO_SAIDA }],
        [{ mes: '2026-09', valor: 500, cancelado: 0, devolvido: 0 }, { mes: '2026-10', valor: 800, cancelado: 90000, devolvido: 250 }]
    );
    const geo = geometria(colunas, { largura: 400, altura: 240, chave: 'valor', mesAtual: '2026-09' });
    const outubro = geo.colunas[1];
    assert.strictEqual(outubro.vendas, null);
    assert.deepStrictEqual(daqui(outubro.saidasVendas), []);
    assert.deepStrictEqual(daqui(outubro.saidasPrevisao.map(s => [s.tipo, s.valor])), [['cancelado', 90000], ['devolvido', 250]]);
    assert.strictEqual(outubro.saidasPrevisao[0].x, outubro.previsao.x, 'sob a barra verde');
    assert.ok(geo.grade.length <= 9, 'saiu muito mais do que entrou: a escala vira a do que saiu, sem dezenas de linhas');
    assert.ok(geo.escala.topo >= 90000);

    // Eixo em contagem: nas vendas o que saiu também é contagem.
    const contagem = geometria(soVendas(serieComSaidas()), { largura: 720, chave: 'quantidade' });
    assert.deepStrictEqual(daqui(contagem.colunas[7].saidasVendas.map(s => s.valor)), [1, 2]);
});

test('tooltip e aria-label dizem o que saiu no mês; sem nada, continuam como eram', () => {
    const vendas = avaliar('conteudoDicaVendas');
    const limpo = vendas({ mes: '2026-09', quantidade: 7, valor: 58900, cancelado: ZERO_SAIDA, devolvido: ZERO_SAIDA });
    assert.deepStrictEqual([...limpo.saidas], []);
    const conteudo = vendas({ mes: '2026-09', quantidade: 7, valor: 58900, cancelado: { quantidade: 1, valor: 20000 }, devolvido: { quantidade: 2, valor: 1500 } });
    assert.deepStrictEqual(daqui(conteudo.saidas.map(s => [s.tipo, s.nome, semEspacoFixo(s.valor), s.detalhe])), [
        ['cancelado', 'Cancelado no mês', 'R$ 20 mil', '1 pedido'],
        ['devolvido', 'Devolvido no mês', 'R$ 1,5 mil', '2 devoluções']
    ]);
    assert.strictEqual(semEspacoFixo(avaliar('rotuloAcessivelDica')(conteudo)),
        'Vendas fechadas em setembro de 2026: R$ 58,9 mil · 7 pedidos. Cancelado no mês: R$ 20 mil, 1 pedido. Devolvido no mês: R$ 1,5 mil, 2 devoluções');
    // Sem a coluna de valor fica só a contagem.
    const semValor = vendas({ mes: '2026-09', quantidade: 1, valor: null, cancelado: { quantidade: 1, valor: null }, devolvido: ZERO_SAIDA }, { emDinheiro: false });
    assert.deepStrictEqual(daqui(semValor.saidas.map(s => [s.valor, s.detalhe])), [['', '1 pedido']]);

    const previsao = avaliar('conteudoDicaPrevisao')({ mes: '2026-10', valor: 800, parcelas: 1, pedidos: 1, outros: 0, itens: [], cancelado: 3200, devolvido: 0 });
    assert.deepStrictEqual(daqui(previsao.saidas.map(s => [s.tipo, s.nome, semEspacoFixo(s.valor)])), [['cancelado', 'Parcelas de pedidos cancelados', 'R$ 3.200,00']]);
});

test('legenda: cancelado e devolvido só entram quando o gráfico tem a barra; o donut pinta Parcial e Devolvido de roxo', () => {
    const legenda = avaliar('montarLegendaGrafico');
    assert.strictEqual(typeof legenda, 'function');
    const tons = avaliar('DASH_TONS_SITUACAO');
    assert.strictEqual(tons.Devolvido, 'roxo');
    assert.strictEqual(tons.Parcial, 'lilas');
    assert.strictEqual(tons.Cancelado, 'vermelho');
    assert.deepStrictEqual([...avaliar('DASH_SAIDAS')], ['cancelado', 'devolvido']);
});

test('CSS: as barras penduradas e a legenda têm cor (vermelho e roxo), e o tom lilás existe', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'dashboard.css'), 'utf8');
    assert.match(css, /\.dash-barras__saida--cancelado\s*\{[^}]*fill:\s*var\(--color-red\)/);
    assert.match(css, /\.dash-barras__saida--devolvido\s*\{[^}]*fill:\s*var\(--dash-roxo\)/);
    assert.match(css, /\.dash-grafico__legenda-cor--cancelado\s*\{[^}]*var\(--color-red\)/);
    assert.match(css, /\.dash-grafico__legenda-cor--devolvido\s*\{[^}]*var\(--dash-roxo\)/);
    assert.match(css, /\[data-tom="lilas"\]\s*\{\s*--dash-tom:\s*var\(--dash-lilas\)/);
    assert.match(css, /--dash-lilas:\s*color-mix\(in srgb, var\(--color-purple\)/);
});

// ------------------------------------------------ Financeiro (24/09/2026)
//
// Contas a receber, NF-e e o que falta pagar de comissões e produção
// (backend/dashboardFinanceiro.js): indicadores novos, cartões de atenção e
// o que entrou nos cartões de antes (Recebido no gráfico, recebido antes da
// nota no KPI de produção, enviados sem NF-e no donut).

const plano = valor => JSON.parse(JSON.stringify(valor));

test('Financeiro: os indicadores dizem o recebido, o a receber, o atraso, as NF-e e o que falta pagar', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, amostraComFinanceiro());
    assert.deepStrictEqual(painel.erros, []);

    const recebido = painel.texto('kpi-recebido');
    assert.match(recebido, /R\$ 42\.000/);
    assert.match(recebido, /8 parcelas recebidas/);
    assert.match(recebido, /\+20%/, '42 mil contra 35 mil no mesmo período do mês passado');
    assert.match(recebido, /R\$ 120,50 de multa e juros/);
    assert.match(recebido, /1 estorno no mês/);

    const aReceber = painel.texto('kpi-a-receber');
    assert.match(aReceber, /R\$ 26\.000/);
    assert.match(aReceber, /3 com boleto/);
    assert.match(aReceber, /1 com ordem de pagamento/);
    assert.match(aReceber, /1 sem cobrança/);

    const atraso = painel.texto('kpi-atraso');
    assert.match(atraso, /2 parcelas vencidas sem pagamento/);
    assert.match(atraso, /1 há mais de 15 dias/);
    assert.match(atraso, /a mais antiga venceu em 10\/08\/26/);

    const nfe = painel.texto('kpi-nfe');
    assert.match(nfe, /^7notas autorizadas · R\$ 61 mil/);
    assert.match(nfe, /1 recusada pela SEFAZ/);
    assert.match(nfe, /1 cancelada/);

    const aPagar = painel.texto('kpi-a-pagar');
    assert.match(aPagar, /R\$ 6\.200/);
    assert.match(aPagar, /Comissões R\$ 3,2 mil · Produção R\$ 3 mil/);
    assert.match(aPagar, /pagar até 05\/10/, 'o prazo mais próximo dos dois');
    assert.match(aPagar, /comissões pagas em parte/);
    assert.match(aPagar, /R\$ 350,50 em comissões atrasadas/);
});

test('Financeiro: vencimentos em faixas, as maiores em atraso e os cartões de atenção com a lista cortada', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, amostraComFinanceiro());

    const vencimentos = painel.texto('vencimentos');
    for (const rotulo of ['Atraso de 31+ dias', 'Atraso de 16 a 30 dias', 'Atraso de 1 a 15 dias', 'Vence em até 7 dias', 'Vence em 8 a 30 dias', 'Vence depois de 30 dias']) {
        assert.ok(vencimentos.includes(rotulo), rotulo);
    }
    assert.match(vencimentos, /Maiores em atraso/);
    assert.match(vencimentos, /PED88 · parcela 2\/3/);
    assert.match(vencimentos, /venceu há 34 dias/);
    assert.match(vencimentos, /\+1 não listados/, '2 em atraso, 1 na lista');
    assert.match(vencimentos, /parcelas controladas a partir de 01\/01\/26/);
    const barras = painel.cartoes.vencimentos.querySelectorAll('.dash-hbarra');
    assert.deepStrictEqual(barras.map(b => b.dataset.tom), ['vermelho', 'vinho', 'ouro', 'azul', 'verde', 'neutro']);

    assert.match(painel.texto('nfe-problemas'), /1 nota recusada pela SEFAZ sem nova emissão/);
    assert.match(painel.texto('nfe-problemas'), /urgente/);
    assert.match(painel.texto('sem-nfe'), /PED12/);
    assert.match(painel.texto('sem-nfe'), /há 3 dias/);
    assert.match(painel.texto('sem-nfe'), /\+1 não listados/);
    assert.match(painel.texto('a-confirmar'), /Produção · agosto de 2026/);
    assert.match(painel.texto('a-confirmar'), /1 depois do prazo/);
    assert.match(painel.texto('a-confirmar'), /\+1 não listados/);
    assert.match(painel.texto('ordens'), /PED90 · parcela 1\/2/);
    assert.match(painel.texto('ordens'), /Móveis Aurora · Pix/);
    assert.match(painel.texto('ordens'), /passou há 3 dias/);
    assert.match(painel.texto('conciliacao'), /3avisos do banco a resolver/);
    assert.match(painel.texto('conciliacao'), /Pagamentos a conciliar/);
});

test('Financeiro: os cartões de atenção só aparecem com o que resolver; sem a seção, somem sem virar erro', () => {
    const cartao = avaliar('estadoDoCartao');
    const dados = amostraComFinanceiro();
    Object.assign(dados.secoes.fiscal, { aguardandoNfe: { quantidade: 0, itens: [] }, problemas: { quantidade: 0, itens: [] } });
    Object.assign(dados.secoes.receber, { ordens: { abertas: 3, atrasadas: 0, proximas7: 0, itens: [] }, conciliacao: { fila: 0, aLancar: 0, itens: [] } });
    dados.secoes.pagar.aConfirmar = { quantidade: 0, itens: [] };
    for (const chave of ['sem-nfe', 'nfe-problemas', 'ordens', 'conciliacao', 'a-confirmar']) {
        assert.strictEqual(cartao(dados, chave), 'oculto', chave);
    }
    assert.strictEqual(cartao(dados, 'kpi-atraso'), 'ok', 'o indicador fica, mesmo zerado');

    const semFinanceiro = amostraDoContrato();
    for (const chave of ['kpi-recebido', 'kpi-nfe', 'kpi-a-pagar', 'vencimentos', 'sem-nfe']) {
        assert.strictEqual(cartao(semFinanceiro, chave), 'oculto', `${chave}: sem permissão, some`);
    }
    assert.strictEqual(cartao({ secoes: {}, falhas: { pagar: 'fora do ar' } }, 'kpi-a-pagar'), 'falha');
    assert.strictEqual(avaliar('estadoGeral')({ secoes: { receber: financeiroDaAmostra().receber }, falhas: {} }), 'ok');
});

test('Financeiro nos cartões de antes: Recebido no gráfico, recebido antes da nota e enviados sem NF-e', () => {
    const painel = montarPainelFalso();
    painel.avaliar('renderizarDashboard')(painel.modulo, amostraComFinanceiro());
    const grafico = painel.cartoes['grafico-vendas'];
    assert.deepStrictEqual(legendaDe(painel), ['Vendas fechadas', 'Recebido (o que entrou no mês)']);
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__recebido-ponto').length, 12, 'um ponto por mês');
    assert.strictEqual(grafico.querySelectorAll('.dash-barras__recebido-linha').length, 1);
    assert.match(painel.texto('grafico-vendas'), /Recebido nos 12 meses/);
    assert.match(painel.texto('grafico-vendas'), /R\$ 330 mil/, '0 + 5 mil + … + 55 mil');

    // O balão do mês conta o que entrou.
    const ouroSet = grafico.querySelectorAll('.dash-barras__coluna')[11].querySelectorAll('.dash-barras__item--vendas')[0];
    disparar(ouroSet, 'focus');
    const { caixa } = painel.popover.aberturas.at(-1);
    assert.match(semEspacoFixo(caixa.textContent), /Recebido no mêsR\$ 55\.000,0011 parcelas recebidas/);
    assert.match(semEspacoFixo(ouroSet.getAttribute('aria-label')), /Recebido no mês: R\$ 55\.000,00, 11 parcelas recebidas$/);

    assert.match(painel.texto('kpi-producao'), /R\$ 7,8 mil já recebidos antes da nota/);
    assert.match(painel.texto('grafico-situacao'), /2 enviados sem NF-e/);

    // Sem a coluna de valor (contando pedidos) a linha de R$ some.
    const contagem = montarPainelFalso();
    contagem.avaliar('renderizarDashboard')(contagem.modulo, anularDinheiro(amostraComFinanceiro()));
    assert.strictEqual(contagem.cartoes['grafico-vendas'].querySelectorAll('.dash-barras__recebido-ponto').length, 0);
    assert.deepStrictEqual(legendaDe(contagem), ['Vendas fechadas']);
});

test('balão da previsão: "1 paga" e "1 em atraso" por pedido e o recebido do mês; sem as contas a receber, como antes', () => {
    const dica = avaliar('conteudoDicaPrevisao');
    const mes = {
        mes: '2026-10', valor: 100, parcelas: 2, pedidos: 1, outros: 0,
        itens: [{
            pedidoId: 7, numero: 'PED7', cliente: 'Loja Boa', totalParcelas: 3, valor: 100, estimada: false,
            parcelas: [{ numero: 1, vencimento: '2026-10-02', valor: 50 }, { numero: 2, vencimento: '2026-10-20', valor: 50 }]
        }]
    };
    const comEstado = dica(mes, { parcelas: { '7:1': 'paga', '7:2': 'atrasada', '8:1': 'paga' }, recebido: { mes: '2026-10', quantidade: 2, valor: 1500 } });
    assert.deepStrictEqual(plano(comEstado.itens[0].marcas), [{ tipo: 'paga', texto: '1 paga' }, { tipo: 'atrasada', texto: '1 em atraso' }]);
    assert.strictEqual(semEspacoFixo(comEstado.recebido.valor), 'R$ 1.500,00');
    assert.strictEqual(comEstado.recebido.detalhe, '2 parcelas recebidas');

    const semEstado = dica(mes);
    assert.deepStrictEqual(plano(semEstado.itens[0].marcas), []);
    assert.strictEqual(semEstado.recebido, null);
    assert.match(avaliar('rotuloAcessivelDica')(semEstado), /^Previsão de faturamento em outubro de 2026: /);
});

test('Financeiro: textos de prazo das listas e as faixas iguais às do backend', () => {
    assert.strictEqual(avaliar('textoAtrasoDaParcela')(1), 'venceu há 1 dia');
    assert.strictEqual(avaliar('textoAtrasoDaParcela')(12), 'venceu há 12 dias');
    assert.strictEqual(avaliar('textoDiasSemNota')(0), 'enviado hoje');
    assert.strictEqual(avaliar('textoDiasSemNota')(1), 'há 1 dia');
    assert.strictEqual(avaliar('textoDaOrdem')({ atrasada: true, dias: 2 }), 'passou há 2 dias');
    assert.strictEqual(avaliar('textoDaOrdem')({ atrasada: false, data: '2026-09-30T00:00:00.000Z' }), 'para 30/09', 'DATE cortada como texto');
    const { FAIXAS_VENCIMENTO } = require(path.join(SRC, '..', 'backend', 'dashboardFinanceiro'));
    assert.deepStrictEqual(Object.keys(avaliar('DASH_FAIXAS_VENCIMENTO')), FAIXAS_VENCIMENTO);
});

test('Financeiro no HTML: a faixa some inteira sem permissão, e os cartões de atenção nascem escondidos', () => {
    assert.match(FONTE_HTML, /<section class="dash-bloco-financeiro animate-fade-in-up" data-dash-linha>/);
    assert.match(FONTE_HTML, /class="dash-kpis dash-kpis--financeiro" data-dash-linha/);
    for (const chave of ['nfe-problemas', 'sem-nfe', 'a-confirmar', 'ordens', 'conciliacao']) {
        assert.match(FONTE_HTML, new RegExp(`data-dash-cartao="${chave}"[^>]*\\bhidden>`), `${chave} nasce escondido`);
    }
    // Cinco indicadores: uma linha só na tela larga.
    assert.match(REGRAS_CSS, /\.dash-kpis\.dash-kpis--financeiro\[data-visiveis="5"\]\s*\{[^}]*repeat\(5, minmax\(0, 1fr\)\)/);
    assert.match(FONTE_JS, /Estoque ou Financeiro para o seu perfil/);
});
