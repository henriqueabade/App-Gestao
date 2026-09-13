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

test('barras dos 12 meses cabem na área, nascem da base e o mês fraco continua visível', () => {
    const geometria = avaliar('geometriaBarras');
    const serie = Array.from({ length: 12 }, (_, i) => ({
        mes: `2026-${String(i + 1).padStart(2, '0')}`,
        quantidade: i === 0 ? 0 : 1,
        valor: i === 11 ? 84500 : i === 3 ? 50 : i === 0 ? 0 : 20000
    }));
    const geo = geometria(serie, { largura: 600, altura: 240, chave: 'valor' });

    assert.strictEqual(geo.barras.length, 12);
    assert.strictEqual(geo.grade.length, 5, 'linha de base + 4 linhas de grade');
    assert.ok(geo.escala.topo >= 84500);
    const limiteDireito = geo.largura - geo.margem.direita;
    geo.barras.forEach((barra, i) => {
        assert.ok(barra.x >= geo.margem.esquerda && barra.x + barra.largura <= limiteDireito + 1e-9, `barra ${i} fora da área`);
        assert.ok(barra.y >= geo.topoY - 1e-9, `barra ${i} passa do topo`);
        assert.ok(Math.abs(barra.y + barra.altura - geo.baseY) < 1e-9, `barra ${i} não nasce na base`);
        if (i > 0) {
            const anterior = geo.barras[i - 1];
            assert.ok(anterior.x + anterior.largura <= barra.x, `barras ${i - 1} e ${i} se sobrepõem`);
        }
    });
    assert.strictEqual(geo.barras[0].altura, 0, 'mês sem venda não desenha barra');
    assert.ok(geo.barras[3].altura >= 3, 'R$ 50 perto de R$ 84 mil ainda aparece');
});

test('em cartão estreito os rótulos alternam, mas o mês atual nunca perde o nome', () => {
    const geometria = avaliar('geometriaBarras');
    const serie = Array.from({ length: 12 }, (_, i) => ({ mes: `2026-${String(i + 1).padStart(2, '0')}`, valor: 10 }));
    const estreito = geometria(serie, { largura: 300, altura: 240 });
    assert.strictEqual(estreito.barras[11].mostrarRotulo, true);
    assert.strictEqual(estreito.barras[10].mostrarRotulo, false);
    assert.strictEqual(estreito.barras[9].mostrarRotulo, true);
    const largo = geometria(serie, { largura: 900, altura: 240 });
    assert.ok(largo.barras.every(barra => barra.mostrarRotulo));
});

test('rótulos de mês nunca ficam a menos de 40 px um do outro', () => {
    // Banda de 36 px: o limiar fixo antigo (34 px) mostrava os 12 nomes, e o
    // mais largo ("set/26", ~38 px) encostava no vizinho.
    const geometria = avaliar('geometriaBarras');
    const serie = Array.from({ length: 12 }, (_, i) => ({ mes: `2026-${String(i + 1).padStart(2, '0')}`, valor: 10 }));
    for (const largura of [200, 300, 488, 530, 640, 900]) {
        const geo = geometria(serie, { largura, altura: 240 });
        const centros = geo.barras.filter(barra => barra.mostrarRotulo).map(barra => barra.centro);
        assert.strictEqual(geo.barras[11].mostrarRotulo, true, `${largura}px: o mês atual perdeu o nome`);
        for (let i = 1; i < centros.length; i += 1) {
            assert.ok(centros[i] - centros[i - 1] >= 40 - 1e-9, `${largura}px: rótulos a ${centros[i] - centros[i - 1]} px`);
        }
    }
    assert.strictEqual(geometria(serie, { largura: 488 }).barras[10].mostrarRotulo, false, 'banda de 36 px já alterna');
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
        '--color-green', '--color-red', '--color-blue', '--color-violet', '--neutral-100', '--neutral-500'
    ]);
    const usadas = [...regras.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map(m => m[1]);
    const fora = [...new Set(usadas.filter(nome => !permitidas.has(nome) && !nome.startsWith('--dash-')))];
    assert.deepStrictEqual(fora, [], `variáveis fora do tema: ${fora.join(', ')}`);

    // Toda classe própria do painel leva o prefixo, para não vazar para outros módulos.
    const classes = [...regras.matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map(m => m[1]);
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
        addEventListener() {}
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

/** Módulo com um cartão por chave de DASH_CARTOES, na forma do dashboard.html. */
function montarPainelFalso({ fetch = null } = {}) {
    const { documento, ElementoFalso } = criarDomFalso();
    const erros = [];
    const contexto = {
        window: { apiConfig: { getApiBaseUrl: async () => 'http://bff.local' } },
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
        cartao.append(elemento('div', { dashCorpo: '' }));
        linha.append(cartao);
        cartoes[chave] = cartao;
    }
    painel.append(linha);
    modulo.append(selo, elemento('div', { dashAviso: '' }), estadoGeral, painel);
    const texto = chave => semEspacoFixo(cartoes[chave].textContent);
    return { avaliar: avaliarAqui, modulo, cartoes, selo, estadoGeral, painel, linha, erros, texto };
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
    painel.avaliar('renderizarDashboard')(painel.modulo, amostraDoContrato());

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
    painel.avaliar('renderizarDashboard')(painel.modulo, anularDinheiro(amostraDoContrato()));

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
    const dados = amostraDoContrato();
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
