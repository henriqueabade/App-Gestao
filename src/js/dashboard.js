// Dashboard do Santíssimo Decor — painel com dados REAIS de GET /api/dashboard.
//
// O painel anterior era todo simulado (números sorteados, pedidos e linha do
// tempo inventados, selo de "demonstração"). Este só DESENHA o que o BFF
// calculou em backend/dashboardResumo.js: o que conta como venda, o que está
// vencido e em que fuso cai cada data são regras de lá. Recalcular aqui criaria
// uma segunda versão do mesmo número — e as duas divergem na primeira mudança.
//
// Armadilhas do carregador de módulos (src/js/menu.js) que moldam o arquivo:
//  - menu.js RE-EXECUTA este script a cada visita, já embrulhado num IIFE. Por
//    isso não há IIFE próprio (os testes carregam o arquivo numa VM e chamam as
//    funções pelo nome) e o listener em `document` é registrado uma única vez —
//    o painel antigo empilhava um 'module-change' novo a cada visita.
//  - O estado vive no ELEMENTO do módulo, não em variável de topo: o listener
//    global pertence à primeira execução, e o elemento é a única coisa que ele
//    e as execuções seguintes enxergam em comum.
//  - Todo texto vindo do servidor (cliente, prospecção, insumo, dono) entra por
//    textContent. Não há innerHTML neste arquivo, nem para markup fixo: é o
//    jeito de garantir que um nome digitado com `<img onerror>` nunca execute.

const DASH_PAGINA = 'dashboard';

/**
 * Teto do lado da tela. O BFF já corta cada tabela em 20 s, mas a promessa da
 * primeira carga segura a máscara do menu (moduleReadyPromise, que o menu
 * aguarda sem limite): sem este teto, uma rede pendurada prenderia o spinner
 * para sempre.
 */
const DASH_TEMPO_LIMITE_MS = 30000;

// Nomes fixos em vez de Intl: `month: 'short'` devolve "set." com ponto e
// muda entre versões do ICU — o eixo do gráfico não pode depender disso.
const DASH_MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DASH_MESES_LONGOS = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

/** Sinal de menos tipográfico: o hífen do Intl some ao lado de "R$" e de "%". */
const DASH_MENOS = String.fromCharCode(0x2212);
/** Espaço que não quebra: "R$" nunca pode ficar numa linha e o número em outra. */
const DASH_ESPACO_FIXO = String.fromCharCode(0x00a0);

/** Cor de cada situação de pedido — a mesma no anel e na legenda. */
const DASH_TONS_SITUACAO = {
    'Produção': 'ouro',
    'Enviado': 'azul',
    'Entregue': 'verde',
    // Devolução: roxo. "Parcial" (voltou uma parte) é o lilás, "Devolvido" o roxo cheio.
    'Parcial': 'lilas',
    'Devolvido': 'roxo',
    'Cancelado': 'vermelho',
    'Outros': 'neutro'
};

/**
 * Rótulos das faixas de IDADE — há quanto tempo o pedido está na fábrica. Não
 * é atraso: o atraso é a previsão de embarque, na etiqueta de prazo ao lado.
 */
const DASH_FAIXAS_IDADE = {
    '0-15': 'Até 15 dias',
    '16-30': '16 a 30 dias',
    '31-60': '31 a 60 dias',
    '60+': 'Mais de 60 dias'
};

/**
 * Prazo de EMBARQUE de cada pedido em produção, pela classificação que o BFF
 * manda em `prazo` (embarqueEmProducao, em backend/dashboardResumo.js): a cor
 * da etiqueta e, nos dois que pedem ação, o símbolo de atenção junto do número.
 * Ouro é "em dia" (7 dias ou mais); vermelho, menos de 7 dias (hoje incluso);
 * roxo, passou da previsão. Roxo, e não vinho, para o atraso: o vinho já é a
 * idade acima de 60 dias, na etiqueta vizinha.
 */
const DASH_PRAZOS_EMBARQUE = {
    em_dia: { tom: 'ouro' },
    atencao: { tom: 'vermelho', alerta: 'Embarca em menos de 7 dias' },
    atrasado: { tom: 'roxo', alerta: 'Passou da previsão de embarque' },
    sem_previsao: { tom: 'neutro' }
};

const DASH_DICA_SEM_PREVISAO = 'Sem previsão de embarque — defina no pagamento do pedido';

/** Quantos pedidos o cartão de idade mostra antes do botão que abre a lista inteira. */
const DASH_IDADE_VISIVEIS = 5;
/** id da lista de idade: o botão de expandir aponta para ela (aria-controls). */
const DASH_IDADE_LISTA_ID = 'dash-idade-lista';

/**
 * As três partes do prazo no anel de fora do donut e na legenda, na ordem do
 * anel. Em Produção "em dia" é "ainda não passou da previsão"; em Enviado e
 * Entregue é "embarcou até a previsão" — daí os dois rótulos do <title>.
 */
const DASH_PARTES_PRAZO = [
    { chave: 'emDia', tom: 'verde', rotulo: 'em dia', rotuloEmbarcado: 'embarque no prazo' },
    { chave: 'atrasados', tom: 'roxo', rotulo: 'em atraso', rotuloEmbarcado: 'embarque atrasado' },
    { chave: 'semPrevisao', tom: 'neutro', rotulo: 'sem previsão', rotuloEmbarcado: 'sem previsão ou sem data de embarque' }
];

/**
 * Raio do anel de prazo: por fora do anel principal (15,915 ± 2,5 de traço,
 * 3,2 no hover) e dentro do viewBox de 42 — o SVG corta o que passa de 21.
 */
const DASH_RAIO_PRAZO = 19.9;

const dashFormatoMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
// `minimumFractionDigits` explícito: sem ele algumas versões do V8 lançam
// RangeError, porque o padrão do BRL (2 casas) passa do máximo pedido.
const dashFormatoMoedaInteira = new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0
});
const dashFormatoNumero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
// Saldo de insumo: até 4 casas, a precisão da coluna e o padrão do módulo de
// Estoque (modals/materia-prima-movimentos.js). Com as 2 casas de contagem, um
// déficit real de 0,0035 kg saía "−0 kg" — um saldo ZERO na lista de negativos.
const dashFormatoQuantidade = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const dashFormatoUmaCasa = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const dashFormatoPercentual = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

// ---------------------------------------------------------------------------
// Funções puras — não tocam em `document`. É aqui que os testes batem.
// ---------------------------------------------------------------------------

/**
 * Número do contrato ou null. O BFF manda número ou `null` — e `null` quer
 * dizer "sem permissão para ver valores", não zero. Por isso nada de `|| 0`
 * aqui: trocar null por 0 é exatamente o "R$ 0,00 no lugar de sem acesso" que
 * a tela não pode mostrar. Texto que não é número vira null (nunca NaN).
 */
function numeroOuNulo(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const numero = typeof valor === 'number' ? valor : Number(valor);
    return Number.isFinite(numero) ? numero : null;
}

/** Para CONTAGENS, em que ausência é mesmo zero. Nunca use em dinheiro. */
function quantidadeDe(valor) {
    return numeroOuNulo(valor) ?? 0;
}

function listaDe(valor) {
    return Array.isArray(valor) ? valor : [];
}

/** O que o BFF manda no lugar de um nome vazio (SEM_NOME em backend/dashboardResumo.js). */
const DASH_SEM_NOME = '—';

/**
 * Nome vindo do servidor, ou '' quando ele não existe. O BFF troca nome vazio
 * (vendedor, prospecção ou insumo com cadastro incompleto) por "—" para a linha
 * nunca sair em branco. Mas "—" é texto, e é verdadeiro: quem monta FRASE com o
 * nome ou tem um rótulo melhor para a falta dele precisa perguntar aqui antes —
 * senão o orçamento sem vendedor saía "com —".
 */
function textoInformado(valor) {
    const texto = String(valor ?? '').trim();
    return texto === DASH_SEM_NOME ? '' : texto;
}

function trocarHifenPorMenos(texto) {
    return String(texto).replace(/^-/, DASH_MENOS).replace(/-(?=R\$)/, DASH_MENOS);
}

/** "R$ 84.500,50". Null devolve vazio: quem chama decide o que mostrar. */
function formatarMoeda(valor) {
    const numero = numeroOuNulo(valor);
    return numero === null ? '' : trocarHifenPorMenos(dashFormatoMoeda.format(numero));
}

/**
 * Valor grande de destaque (KPI): sem centavos, que num número de 2 rem só
 * empurram o valor para fora do cartão. O valor exato vai no `title`.
 */
function formatarMoedaDestaque(valor) {
    const numero = numeroOuNulo(valor);
    if (numero === null) return '';
    if (Math.abs(numero) >= 10000000) return formatarMoedaCompacta(numero);
    return trocarHifenPorMenos(dashFormatoMoedaInteira.format(numero));
}

/**
 * "R$ 12,4 mil" / "R$ 1,2 mi". Arredonda ANTES de escolher a unidade: sem isso
 * R$ 999.960 virava "R$ 1.000 mil". E usa vírgula decimal — o funil antigo de
 * Prospecções fazia `toFixed(1)` e mostrava "320.0 mil", com ponto.
 */
function formatarMoedaCompacta(valor) {
    const numero = numeroOuNulo(valor);
    if (numero === null) return '';
    const absoluto = Math.abs(numero);
    if (absoluto < 1000) return formatarMoeda(numero);
    const sinal = numero < 0 ? DASH_MENOS : '';
    const milhares = Math.round(absoluto / 100) / 10;
    if (milhares < 1000) {
        return `${sinal}R$${DASH_ESPACO_FIXO}${dashFormatoUmaCasa.format(milhares)}${DASH_ESPACO_FIXO}mil`;
    }
    const milhoes = Math.round(absoluto / 100000) / 10;
    return `${sinal}R$${DASH_ESPACO_FIXO}${dashFormatoUmaCasa.format(milhoes)}${DASH_ESPACO_FIXO}mi`;
}

/** Rótulo do eixo Y: sem "R$" (o subtítulo já diz a unidade) para caber na margem. */
function formatarEixoCompacto(valor) {
    const numero = numeroOuNulo(valor) ?? 0;
    const absoluto = Math.abs(numero);
    if (absoluto < 1000) return dashFormatoNumero.format(numero);
    const milhares = Math.round(absoluto / 100) / 10;
    if (milhares < 1000) return `${dashFormatoUmaCasa.format(milhares)} mil`;
    return `${dashFormatoUmaCasa.format(Math.round(absoluto / 100000) / 10)} mi`;
}

function formatarNumero(valor) {
    const numero = numeroOuNulo(valor);
    return numero === null ? '' : trocarHifenPorMenos(dashFormatoNumero.format(numero));
}

/** 0.72 → "72%"; 0.125 → "12,5%". */
function formatarPercentual(fracao) {
    const numero = numeroOuNulo(fracao);
    return numero === null ? '' : trocarHifenPorMenos(dashFormatoPercentual.format(numero));
}

/**
 * Saldo de insumo com a unidade dele: "−3,5 L", "−0,0035 kg". Unidades nunca
 * são somadas. Formato próprio (4 casas), não o de formatarNumero: aquele é
 * de contagem e arredondaria o déficit pequeno para "−0".
 */
function formatarQuantidade(valor, unidade) {
    const numero = numeroOuNulo(valor);
    if (numero === null) return '';
    const texto = trocarHifenPorMenos(dashFormatoQuantidade.format(numero));
    const sufixo = String(unidade ?? '').trim();
    return sufixo ? `${texto}${DASH_ESPACO_FIXO}${sufixo}` : texto;
}

/** "12 pedidos" / "1 pedido". */
function pluralizar(quantidade, singular, plural) {
    const numero = quantidadeDe(quantidade);
    return `${formatarNumero(numero)} ${numero === 1 ? singular : plural}`;
}

/**
 * Variação do período atual contra a referência.
 *
 * Devolve null quando um dos lados é null (sem permissão ou sem dado): não há
 * comparação a mostrar. Referência zero não tem percentual — dividir por zero
 * daria "Infinity%"; `fracao: null` com `tipo: 'alta'` diz "subiu, sem base".
 */
function calcularVariacao(atual, anterior) {
    const a = numeroOuNulo(atual);
    const b = numeroOuNulo(anterior);
    if (a === null || b === null) return null;
    if (b === 0) {
        if (a === 0) return { tipo: 'estavel', fracao: 0 };
        return { tipo: a > 0 ? 'alta' : 'baixa', fracao: null };
    }
    const fracao = (a - b) / Math.abs(b);
    // Abaixo de 0,05% o Intl mostraria "+0%" com seta para cima: ruído.
    if (Math.abs(fracao) < 0.0005) return { tipo: 'estavel', fracao: 0 };
    return { tipo: fracao > 0 ? 'alta' : 'baixa', fracao };
}

/** "+20%", "−10%", "0%", ou "sem base" quando a referência era zero. */
function textoVariacao(variacao) {
    if (!variacao) return '';
    if (variacao.fracao === null) return 'sem base';
    if (variacao.tipo === 'estavel') return '0%';
    const modulo = formatarPercentual(Math.abs(variacao.fracao));
    return `${variacao.tipo === 'alta' ? '+' : DASH_MENOS}${modulo}`;
}

function partesDoMes(mes) {
    const casamento = /^(\d{4})-(\d{2})/.exec(String(mes ?? ''));
    if (!casamento) return null;
    const indice = Number(casamento[2]) - 1;
    if (indice < 0 || indice > 11) return null;
    return { ano: casamento[1], indice };
}

/** '2026-09' → 'set/26'. Montado pela string: 'YYYY-MM' não passa por Date. */
function rotuloMes(mes) {
    const partes = partesDoMes(mes);
    return partes ? `${DASH_MESES_CURTOS[partes.indice]}/${partes.ano.slice(2)}` : String(mes ?? '');
}

/** '2026-03' → 'março de 2026' (tooltip do gráfico). */
function rotuloMesLongo(mes) {
    const partes = partesDoMes(mes);
    return partes ? `${DASH_MESES_LONGOS[partes.indice]} de ${partes.ano}` : String(mes ?? '');
}

/**
 * Coluna DATE ('2026-09-15' ou '2026-09-15T00:00:00.000Z') → '15/09'.
 * Nunca `new Date(valor)`: a forma só-data é lida como meia-noite UTC e, em
 * São Paulo, vira o dia ANTERIOR — o orçamento que vence dia 13 apareceria 12.
 */
function formatarDataCurta(valor) {
    const casamento = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? ''));
    return casamento ? `${casamento[3]}/${casamento[2]}` : '';
}

/** `geradoEm` (instante ISO) → "15:04" no relógio local de quem olha. */
function horaAtualizacao(geradoEm) {
    if (!geradoEm) return '';
    const data = new Date(geradoEm);
    if (Number.isNaN(data.getTime())) return '';
    const hh = String(data.getHours()).padStart(2, '0');
    const mm = String(data.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

/** Prazo de validade de orçamento pendente. */
function textoPrazo(diasRestantes) {
    const dias = numeroOuNulo(diasRestantes);
    if (dias === null) return '';
    if (dias < 0) return Math.abs(dias) === 1 ? 'venceu ontem' : `venceu há ${Math.abs(dias)} dias`;
    if (dias === 0) return 'vence hoje';
    if (dias === 1) return 'vence amanhã';
    return `vence em ${dias} dias`;
}

/** Follow-up de prospecção: `dias` é negativo quando atrasado. */
function textoFollowup(dias) {
    const n = numeroOuNulo(dias);
    if (n === null) return '';
    if (n < 0) return Math.abs(n) === 1 ? 'atrasado há 1 dia' : `atrasado há ${Math.abs(n)} dias`;
    if (n === 0) return 'para hoje';
    if (n === 1) return 'amanhã';
    return `em ${n} dias`;
}

/** Idade de pedido em produção. */
function textoIdade(dias) {
    const n = numeroOuNulo(dias);
    if (n === null) return '';
    if (n <= 0) return 'desde hoje';
    return n === 1 ? 'há 1 dia' : `há ${n} dias`;
}

/** Coluna DATE → 'dd/mm/aa', cortada como texto pelo mesmo motivo de formatarDataCurta. */
function formatarDataComAno(valor) {
    const casamento = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? ''));
    return casamento ? `${casamento[3]}/${casamento[2]}/${casamento[1].slice(2)}` : '';
}

/** Quanto falta para o embarque previsto. `dias` negativo é atraso — vem pronto do BFF. */
function textoEmbarque(dias) {
    const n = numeroOuNulo(dias);
    if (n === null) return 'sem previsão';
    if (n < 0) return 'em atraso';
    if (n === 0) return 'embarca hoje';
    return n === 1 ? 'falta 1 dia' : `faltam ${n} dias`;
}

/**
 * Etiqueta de prazo de um pedido em produção: { texto, tom, dica, alerta }.
 * O texto vem de `diasParaEmbarque` e a cor de `prazo` — a classificação é do
 * BFF, a tela não recalcula. Sem `prazo` conhecido (servidor anterior à
 * previsão de embarque) não há etiqueta: dizer "sem previsão" ali seria
 * afirmar o que a tela não sabe. A data do title é cortada como texto.
 */
function etiquetaDeEmbarque(pedido) {
    const definicao = DASH_PRAZOS_EMBARQUE[pedido?.prazo];
    if (!definicao) return null;
    const dias = numeroOuNulo(pedido?.diasParaEmbarque);
    const data = formatarDataComAno(pedido?.embarque);
    const dica = [pedido.prazo === 'sem_previsao' || !data ? DASH_DICA_SEM_PREVISAO : `Data prevista: ${data}`];
    // "em atraso" não diz quanto: a conta vai numa 2ª linha do title.
    if (pedido.prazo === 'atrasado' && dias !== null && dias < 0) {
        dica.push(Math.abs(dias) === 1 ? 'atrasado há 1 dia' : `atrasado há ${Math.abs(dias)} dias`);
    }
    return {
        texto: pedido.prazo === 'sem_previsao' ? 'sem previsão' : textoEmbarque(dias),
        tom: definicao.tom,
        dica: dica.join('\n'),
        alerta: definicao.alerta ? { tom: definicao.tom, titulo: definicao.alerta } : null
    };
}

/** "2 em atraso · R$ 20 mil"; sem a coluna de valor (null) ou com zero, só a contagem. */
function textoContagemComValor(quantidade, rotulo, valor) {
    const n = quantidadeDe(quantidade);
    const texto = `${formatarNumero(n)} ${rotulo}`;
    const v = numeroOuNulo(valor);
    return v !== null && n > 0 ? `${texto} · ${formatarMoedaCompacta(v)}` : texto;
}

/**
 * "+N" quando a lista veio cortada. O backend manda o total real junto de
 * cada lista justamente para nada sumir em silêncio.
 */
function textoMais(total, exibidos) {
    const t = quantidadeDe(total);
    const e = quantidadeDe(exibidos);
    return t > e ? `+${formatarNumero(t - e)}` : '';
}

/**
 * Escala "redonda" do eixo Y: passos de 1, 2, 2,5 ou 5 × 10^n, com o topo
 * sempre ≥ ao maior valor. Em contagens (`inteiro`) o passo nunca é fração —
 * "1,5 pedido" no eixo não existe.
 */
function escalaEixo(maximo, { divisoes = 4, inteiro = false } = {}) {
    let partes = Math.max(1, Math.round(divisoes));
    const alvo = Number.isFinite(maximo) && maximo > 0 ? maximo : 0;
    const montar = passo => {
        const marcas = Array.from({ length: partes + 1 }, (_, i) => Number((passo * i).toPrecision(12)));
        return { passo, topo: marcas[marcas.length - 1], marcas };
    };
    if (alvo === 0) return montar(1);
    // Poucos pedidos: 4 divisões de 1 deixariam a barra de 1 pedido em 25%.
    if (inteiro && alvo < partes) partes = Math.max(2, Math.ceil(alvo));
    const bruto = alvo / partes;
    const magnitude = 10 ** Math.floor(Math.log10(bruto));
    const normal = bruto / magnitude;
    const fator = normal <= 1 ? 1 : normal <= 2 ? 2 : normal <= 2.5 ? 2.5 : normal <= 5 ? 5 : 10;
    let passo = Number((fator * magnitude).toPrecision(12));
    if (inteiro) passo = Math.max(1, Math.ceil(passo));
    return montar(passo);
}

/**
 * Caminho SVG de uma barra com os cantos de CIMA arredondados. O raio é
 * limitado pela largura e pela altura: barra baixa com raio cheio desenhava
 * uma "gota" que passava da linha de base.
 */
function caminhoBarra(x, y, largura, altura, raio = 5) {
    if (!(largura > 0) || !(altura > 0)) return '';
    const r = Math.max(0, Math.min(raio, largura / 2, altura));
    const f = n => Number(n.toFixed(2));
    const base = y + altura;
    return `M${f(x)},${f(base)}V${f(y + r)}Q${f(x)},${f(y)} ${f(x + r)},${f(y)}`
        + `H${f(x + largura - r)}Q${f(x + largura)},${f(y)} ${f(x + largura)},${f(y + r)}V${f(base)}Z`;
}

/**
 * Uma coluna por mês do gráfico: a união dos meses de vendas (os 12 últimos)
 * com os da previsão (os mesmos 12 e os futuros), em ordem. Guarda os itens
 * crus do contrato, porque o tooltip de cada barra é montado a partir deles.
 * Mês que não veio numa série fica `null` nela: no futuro não há venda
 * fechada, e sem a seção de previsão não há barra verde nenhuma.
 */
function colunasDoGrafico(serie, meses) {
    const porMes = new Map();
    const colunaDe = mes => {
        if (!porMes.has(mes)) porMes.set(mes, { mes, vendas: null, previsao: null });
        return porMes.get(mes);
    };
    listaDe(serie).forEach(item => {
        if (partesDoMes(item?.mes)) colunaDe(String(item.mes).slice(0, 7)).vendas = item;
    });
    listaDe(meses).forEach(item => {
        if (partesDoMes(item?.mes)) colunaDe(String(item.mes).slice(0, 7)).previsao = item;
    });
    // 'YYYY-MM' ordena como texto; o BFF já manda as duas séries sem buracos.
    return [...porMes.values()].sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0));
}

/**
 * Geometria do gráfico de vendas e previsão, em pixels reais (a tela mede a
 * largura do cartão e chama de novo quando ela muda). Com viewBox fixo o SVG
 * inteiro escalava junto e, num cartão estreito, os rótulos viravam letras de
 * 5 px.
 *
 * Com uma série só (vendas sem previsão, ou só a previsão) é o gráfico de
 * sempre: uma barra centrada por mês. Com as duas, cada mês ganha o par ouro
 * (vendas) à esquerda e verde (previsão) à direita — no mesmo lugar em todos
 * os meses, inclusive nos futuros, onde só existe a verde: o vão à esquerda já
 * diz "ainda não há venda fechada ali". O eixo Y vai até o maior valor das
 * DUAS séries; escalar só pelas vendas cortaria a barra verde mais alta.
 *
 * O QUE SAIU — cancelado (vermelho) e devolvido (roxo) — pendura ABAIXO da
 * linha de base, sob a barra da série de que saiu, na mesma escala: a venda
 * sobe, o que foi tirado desce. Não é somado à barra de cima (nas vendas o
 * cancelamento e a devolução contam no mês em que aconteceram, não no da
 * venda) e não rouba largura dela. Sem nada a mostrar, a linha de base fica no
 * pé do gráfico e a geometria é exatamente a de antes.
 */
function geometriaGrafico(colunas, opcoes = {}) {
    const lista = listaDe(colunas);
    const largura = opcoes.largura > 0 ? opcoes.largura : 640;
    const altura = opcoes.altura > 0 ? opcoes.altura : 240;
    const margem = { topo: 26, direita: 8, base: 30, esquerda: 48, ...(opcoes.margem || {}) };
    const chave = opcoes.chave || 'valor';
    // Vendas seguem o eixo (R$ ou contagem); a previsão é sempre R$ (`valor`).
    const medir = (item, campo) => (item ? Math.max(0, numeroOuNulo(item[campo]) ?? 0) : null);
    const medidas = lista.map(coluna => ({ vendas: medir(coluna?.vendas, chave), previsao: medir(coluna?.previsao, 'valor') }));
    const comVendas = medidas.some(medida => medida.vendas !== null);
    const comPrevisao = medidas.some(medida => medida.previsao !== null);
    const agrupado = comVendas && comPrevisao;
    const maximo = Math.max(0, ...medidas.map(medida => Math.max(medida.vendas ?? 0, medida.previsao ?? 0)));
    // Nas vendas o que saiu segue o eixo (R$ ou contagem); na previsão é sempre R$.
    const medirSaidas = (item, ler) => (item
        ? DASH_SAIDAS.map(tipo => ({ tipo, valor: Math.max(0, numeroOuNulo(ler(item, tipo)) ?? 0) })).filter(saida => saida.valor > 0)
        : []);
    const saidas = lista.map(coluna => ({
        vendas: medirSaidas(coluna?.vendas, (item, tipo) => item?.[tipo]?.[chave]),
        previsao: medirSaidas(coluna?.previsao, (item, tipo) => item?.[tipo])
    }));
    const somaDasSaidas = itens => itens.reduce((total, saida) => total + saida.valor, 0);
    const maximoSaida = Math.max(0, ...saidas.map(s => Math.max(somaDasSaidas(s.vendas), somaDasSaidas(s.previsao))));
    const opcoesDaEscala = { divisoes: opcoes.divisoes || 4, inteiro: chave === 'quantidade' };
    let escala = escalaEixo(maximo, opcoesDaEscala);
    // Saiu mais do que entrou em algum mês: a escala passa a ser a do que saiu,
    // senão a parte de baixo teria dezenas de divisões.
    if (maximoSaida > escala.topo) escala = escalaEixo(maximoSaida, opcoesDaEscala);
    const fundo = maximoSaida > 0 ? Math.ceil(maximoSaida / escala.passo) * escala.passo : 0;
    const areaLargura = Math.max(1, largura - margem.esquerda - margem.direita);
    const areaAltura = Math.max(1, altura - margem.topo - margem.base);
    const pxPorUnidade = escala.topo + fundo > 0 ? areaAltura / (escala.topo + fundo) : 0;
    const baseY = fundo > 0 ? margem.topo + escala.topo * pxPorUnidade : margem.topo + areaAltura;
    const banda = lista.length ? areaLargura / lista.length : areaLargura;
    // Uma série: 62% da banda, até 46 px (a barra de antes). Duas: o par ocupa
    // 74% da banda, até 64 px, com um vão fino entre o ouro e o verde.
    const larguraGrupo = agrupado ? Math.min(banda * 0.74, 64) : Math.min(banda * 0.62, 46);
    const vao = agrupado ? Math.min(3, larguraGrupo * 0.1) : 0;
    const larguraBarra = agrupado ? (larguraGrupo - vao) / 2 : larguraGrupo;

    // Mês atual: o destacado e o marco onde a previsão vira futuro. Sem
    // `mesAtual` na resposta vale o último mês de vendas (o atual, por
    // contrato) ou, só com a previsão, o 12º: os 12 primeiros meses dela são
    // os mesmos da série de vendas.
    let indiceAtual = opcoes.mesAtual ? lista.findIndex(coluna => coluna?.mes === opcoes.mesAtual) : -1;
    if (indiceAtual < 0) {
        const ultimoComVendas = medidas.map(medida => medida.vendas !== null).lastIndexOf(true);
        indiceAtual = ultimoComVendas >= 0 ? ultimoComVendas : Math.min(11, lista.length - 1);
    }
    // Cartão estreito: pula rótulos de mês na medida da banda. O mais largo
    // ("set/26" a 11 px) mede ~38 px, então cada rótulo pede 40 px; o limiar
    // fixo antigo (alternar só abaixo de 34 px) deixava os nomes se encostarem
    // entre 34 e 40 px. Contado a partir do MÊS ATUAL, para o destacado nunca
    // perder o nome — com a previsão ele deixou de ser o último da fila.
    const passoRotulo = Math.max(1, Math.ceil(40 / banda));
    const barra = (valor, x, alvo) => {
        let alturaBarra = fundo > 0 ? valor * pxPorUnidade : (escala.topo > 0 ? (valor / escala.topo) * areaAltura : 0);
        // Mês com valor pequeno ainda precisa ser visto: 3 px de piso.
        if (valor > 0) alturaBarra = Math.max(alturaBarra, 3);
        return { valor, x, y: baseY - alturaBarra, largura: larguraBarra, altura: alturaBarra, alvo };
    };

    // As penduradas: empilhadas para baixo a partir da linha de base. Cada uma
    // ocupa o trecho do seu valor, e os 2 px de vão (da linha e entre elas) saem
    // de dentro desse trecho — assim a pilha nunca passa do pé do gráfico. O
    // piso de 3 px é o mesmo das barras de cima.
    const penduradas = (itens, x) => {
        let cursor = baseY;
        return itens.map(saida => {
            const trecho = saida.valor * pxPorUnidade;
            const geoSaida = { tipo: saida.tipo, valor: saida.valor, x, y: cursor + 2, largura: larguraBarra, altura: Math.max(3, trecho - 2) };
            cursor += Math.max(trecho, 5);
            return geoSaida;
        });
    };

    const colunasGeo = lista.map((coluna, indice) => {
        const { vendas, previsao } = medidas[indice];
        const inicioBanda = margem.esquerda + indice * banda;
        const inicioGrupo = inicioBanda + (banda - larguraGrupo) / 2;
        // Alvo do mouse e do foco: a banda inteira (a barra de 3 px de um mês
        // fraco era impossível de acertar); com as duas barras, meia para cada.
        const inteira = { x: inicioBanda, largura: banda };
        const dupla = vendas !== null && previsao !== null;
        return {
            indice,
            mes: coluna?.mes,
            centro: inicioBanda + banda / 2,
            banda: inteira,
            atual: indice === indiceAtual,
            futura: indice > indiceAtual,
            mostrarRotulo: Math.abs(indice - indiceAtual) % passoRotulo === 0,
            vendas: vendas === null ? null
                : barra(vendas, inicioGrupo, dupla ? { x: inicioBanda, largura: banda / 2 } : inteira),
            previsao: previsao === null ? null
                : barra(previsao, agrupado ? inicioGrupo + larguraBarra + vao : inicioGrupo,
                    dupla ? { x: inicioBanda + banda / 2, largura: banda / 2 } : inteira),
            saidasVendas: vendas === null ? [] : penduradas(saidas[indice].vendas, inicioGrupo),
            saidasPrevisao: previsao === null ? []
                : penduradas(saidas[indice].previsao, agrupado ? inicioGrupo + larguraBarra + vao : inicioGrupo)
        };
    });

    const grade = escala.marcas.map(valor => ({
        valor,
        y: fundo > 0 ? baseY - valor * pxPorUnidade : baseY - (escala.topo > 0 ? (valor / escala.topo) * areaAltura : 0)
    }));
    // Abaixo de zero: as mesmas divisões do eixo, até cobrir o que mais saiu.
    for (let passos = 1; fundo > 0 && passos * escala.passo <= fundo + 1e-9; passos += 1) {
        grade.push({ valor: -passos * escala.passo, y: baseY + passos * escala.passo * pxPorUnidade });
    }
    // Linha tracejada entre o mês atual e os futuros: só com previsão e mês futuro.
    const separadorX = comPrevisao && indiceAtual < lista.length - 1 ? margem.esquerda + (indiceAtual + 1) * banda : null;

    return {
        largura, altura, margem, baseY, topoY: margem.topo, areaAltura, escala, grade, maximo,
        maximoSaida, fundo, banda, agrupado, indiceAtual, separadorX, colunas: colunasGeo
    };
}

/**
 * Fatias do anel no mesmo esquema de relatorios.js (renderDonutChart): raio
 * 15.915 dá circunferência 100, então o traço é o próprio percentual. O
 * deslocamento começa em 25 para a primeira fatia nascer às 12 h, sem girar
 * o SVG. Fatia zero sai do anel e da legenda; entre fatias fica uma fresta.
 */
function geometriaDonut(fatias, opcoes = {}) {
    const chave = opcoes.chave || 'quantidade';
    const lista = listaDe(fatias)
        .map(fatia => ({ ...fatia, medida: Math.max(0, numeroOuNulo(fatia?.[chave]) ?? 0) }))
        .filter(fatia => fatia.medida > 0);
    const total = lista.reduce((soma, fatia) => soma + fatia.medida, 0);
    if (!(total > 0)) return { total: 0, segmentos: [] };
    const fresta = lista.length > 1 ? (opcoes.fresta ?? 0.8) : 0;
    let acumulado = 0;
    const segmentos = lista.map(fatia => {
        const percentual = (fatia.medida / total) * 100;
        const comprimento = Math.max(percentual - fresta, 0.01);
        const segmento = {
            ...fatia,
            percentual,
            // Onde a fatia começa e quanto do anel ela ocupa (sem a fresta), na
            // circunferência 100: o anel de prazo (arcosDePrazo) segue os dois.
            inicio: acumulado,
            comprimento,
            dasharray: `${comprimento.toFixed(3)} ${(100 - comprimento).toFixed(3)}`,
            dashoffset: (25 - acumulado).toFixed(3)
        };
        acumulado += percentual;
        return segmento;
    });
    return { total, segmentos };
}

/**
 * Em dia × em atraso × sem previsão de uma situação do donut (campos do BFF em
 * porSituacao12m), ou null sem nada a mostrar: Cancelado e Outros vêm
 * zerados, e o servidor anterior à previsão de embarque nem manda os campos.
 */
function prazoDaSituacao(item) {
    const partes = DASH_PARTES_PRAZO.map(parte => ({
        ...parte,
        quantidade: Math.max(0, numeroOuNulo(item?.[parte.chave]) ?? 0)
    }));
    const total = partes.reduce((soma, parte) => soma + parte.quantidade, 0);
    return total > 0 ? { total, partes } : null;
}

/** O que a legenda lista: em dia e em atraso sempre; sem previsão só quando há. */
function partesDaLegendaDePrazo(prazo) {
    return prazo ? prazo.partes.filter(parte => parte.chave !== 'semPrevisao' || parte.quantidade > 0) : [];
}

/** "5 em dia · 2 em atraso" (e "· 1 sem previsão" quando há). */
function textoPrazoDaSituacao(prazo) {
    return partesDaLegendaDePrazo(prazo)
        .map(parte => `${formatarNumero(parte.quantidade)} ${parte.rotulo}`)
        .join(' · ');
}

/**
 * O anel fino de fora do donut: o arco de cada situação dividido em em dia,
 * em atraso e sem previsão, na proporção dos pedidos dela — começando onde a
 * fatia começa e terminando onde ela termina (`inicio` e `comprimento` de
 * geometriaDonut, na circunferência 100). O raio é outro, então tudo é
 * multiplicado pela razão das circunferências; entre as partes fica uma
 * fresta menor que a das fatias.
 */
function arcosDePrazo(segmentos, { raio = DASH_RAIO_PRAZO, fresta = 0.35 } = {}) {
    const escala = (2 * Math.PI * raio) / 100;
    const arcos = [];
    listaDe(segmentos).forEach(segmento => {
        const prazo = prazoDaSituacao(segmento);
        const inicio = numeroOuNulo(segmento?.inicio);
        const comprimentoDaFatia = numeroOuNulo(segmento?.comprimento);
        if (!prazo || inicio === null || comprimentoDaFatia === null) return;
        const partes = prazo.partes.filter(parte => parte.quantidade > 0);
        const util = Math.max(comprimentoDaFatia - fresta * (partes.length - 1), 0.01);
        let posicao = inicio;
        partes.forEach(parte => {
            const comprimento = Math.max((util * parte.quantidade) / prazo.total, 0.01);
            arcos.push({
                ...parte,
                situacao: segmento.situacao,
                dasharray: `${(comprimento * escala).toFixed(3)} ${((100 - comprimento) * escala).toFixed(3)}`,
                dashoffset: ((25 - posicao) * escala).toFixed(3)
            });
            posicao += comprimento + fresta;
        });
    });
    return arcos;
}

/**
 * Largura (%) de barra horizontal. Valor positivo tem piso — como no
 * renderBarChart de relatorios.js — senão 1 prospecção ao lado de 80 some.
 */
function larguraPercentual(valor, maximo, minimo = 4) {
    const v = numeroOuNulo(valor) ?? 0;
    const m = numeroOuNulo(maximo) ?? 0;
    if (!(v > 0) || !(m > 0)) return 0;
    return Math.min(100, Math.max(minimo, (v / m) * 100));
}

/** "1", "1 e 2", "1, 2 e 3": a enumeração do português, sem depender do Intl.ListFormat. */
function juntarLista(itens) {
    const lista = listaDe(itens).map(item => String(item ?? '').trim()).filter(Boolean);
    if (lista.length <= 1) return lista.join('');
    return `${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}`;
}

/** Pedido sem parcelas: o BFF o põe inteiro, estimado, no dia do pedido. */
const DASH_NOTA_ESTIMADA = 'sem parcelas cadastradas — valor total na data do pedido';

/**
 * "parcelas 1, 2 e 3 de 3 · vence 02/10, 16/10 e 30/10". O vencimento é DATE
 * e passa por formatarDataCurta, cortado como texto: com
 * `new Date('2026-10-02')` a parcela do dia 2 apareceria dia 1 em São Paulo.
 */
function textoParcelasDoItem(item) {
    const parcelas = listaDe(item?.parcelas);
    const numeros = parcelas.map(parcela => numeroOuNulo(parcela?.numero)).filter(n => n !== null).map(n => formatarNumero(n));
    const datas = parcelas.map(parcela => formatarDataCurta(parcela?.vencimento)).filter(Boolean);
    const total = numeroOuNulo(item?.totalParcelas);
    const partes = [];
    if (numeros.length) {
        const de = total !== null && total > 0 ? ` de ${formatarNumero(total)}` : '';
        partes.push(`${numeros.length === 1 ? 'parcela' : 'parcelas'} ${juntarLista(numeros)}${de}`);
    } else if (parcelas.length) {
        partes.push(pluralizar(parcelas.length, 'parcela', 'parcelas'));
    }
    if (datas.length) partes.push(`vence ${juntarLista(datas)}`);
    return partes.join(' · ');
}

/**
 * Conteúdo do tooltip da barra verde: quais pedidos compõem a previsão do mês.
 * Puro (só texto), para o teste conferir exatamente o que a caixa mostra.
 * Parcela é "programada" — nunca "recebida" nem "vencida": o banco não tem
 * baixa de pagamento. Sem o nome (perfil sem a coluna Cliente) fica só o número.
 */
/** As séries do que SAIU, na ordem em que penduram abaixo da linha de base. */
const DASH_SAIDAS = ['cancelado', 'devolvido'];

/**
 * O que saiu da PREVISÃO no mês (pelo vencimento): parcelas de pedidos
 * cancelados e o que a devolução tirou das parcelas. Pura; [] sem nada.
 */
function saidasDaPrevisao(mes) {
    const nomes = { cancelado: 'Parcelas de pedidos cancelados', devolvido: 'Tirado das parcelas por devolução' };
    return DASH_SAIDAS
        .map(tipo => ({ tipo, numero: numeroOuNulo(mes?.[tipo]) ?? 0 }))
        .filter(saida => saida.numero > 0)
        .map(saida => ({ tipo: saida.tipo, nome: nomes[saida.tipo], valor: formatarMoeda(saida.numero), detalhe: '' }));
}

/**
 * O que saiu das VENDAS no mês: cancelado no mês do cancelamento, devolvido no
 * mês da devolução. Sem a coluna de valor fica só a contagem. Pura; [] sem nada.
 */
function saidasDasVendas(item, { emDinheiro = true } = {}) {
    const nomes = { cancelado: 'Cancelado no mês', devolvido: 'Devolvido no mês' };
    const contagem = {
        cancelado: n => pluralizar(n, 'pedido', 'pedidos'),
        devolvido: n => pluralizar(n, 'devolução', 'devoluções')
    };
    return DASH_SAIDAS
        .map(tipo => ({ tipo, quantidade: quantidadeDe(item?.[tipo]?.quantidade), numero: emDinheiro ? numeroOuNulo(item?.[tipo]?.valor) : null }))
        .filter(saida => saida.quantidade > 0 || (saida.numero ?? 0) > 0)
        .map(saida => ({
            tipo: saida.tipo, nome: nomes[saida.tipo],
            valor: saida.numero !== null ? formatarMoedaCompacta(saida.numero) : '',
            detalhe: contagem[saida.tipo](saida.quantidade)
        }));
}

function conteudoDicaPrevisao(mes) {
    const valor = numeroOuNulo(mes?.valor);
    const parcelas = quantidadeDe(mes?.parcelas);
    const pedidos = quantidadeDe(mes?.pedidos);
    const outros = quantidadeDe(mes?.outros);
    const itens = listaDe(mes?.itens).map(item => {
        const numero = item?.numero ? String(item.numero) : 'Pedido';
        const cliente = textoInformado(item?.cliente);
        const estimada = item?.estimada === true;
        return {
            nome: cliente ? `${numero} · ${cliente}` : numero,
            detalhe: estimada ? DASH_NOTA_ESTIMADA : textoParcelasDoItem(item),
            valor: numeroOuNulo(item?.valor) !== null ? formatarMoeda(item.valor) : '',
            estimada
        };
    });
    const vazio = parcelas === 0 && pedidos === 0 && !((valor ?? 0) > 0);
    return {
        serie: 'previsao',
        mes: mes?.mes,
        titulo: `Previsão · ${rotuloMes(mes?.mes)}`,
        resumo: vazio
            ? 'Nenhuma parcela neste mês'
            : [valor !== null ? formatarMoeda(valor) : '', pluralizar(pedidos, 'pedido', 'pedidos'),
                pluralizar(parcelas, 'parcela', 'parcelas')].filter(Boolean).join(' · '),
        itens,
        saidas: saidasDaPrevisao(mes),
        // O BFF lista até 8 pedidos por mês; o total do mês continua completo.
        rodape: outros > 0 ? `+${formatarNumero(outros)} ${outros === 1 ? 'outro pedido' : 'outros pedidos'}` : ''
    };
}

/** Tooltip da barra de ouro: o mesmo formato, só com o resumo do mês. */
function conteudoDicaVendas(item, { emDinheiro = true } = {}) {
    const quantidade = quantidadeDe(item?.quantidade);
    const valor = emDinheiro ? numeroOuNulo(item?.valor) : null;
    const vazio = quantidade === 0 && !((valor ?? 0) > 0);
    return {
        serie: 'vendas',
        mes: item?.mes,
        titulo: `Vendas fechadas · ${rotuloMes(item?.mes)}`,
        resumo: vazio
            ? 'Nenhuma venda fechada'
            : [valor !== null ? formatarMoedaCompacta(valor) : '', pluralizar(quantidade, 'pedido', 'pedidos')].filter(Boolean).join(' · '),
        itens: [],
        saidas: saidasDasVendas(item, { emDinheiro }),
        rodape: ''
    };
}

const DASH_NOMES_SERIE = { vendas: 'Vendas fechadas', previsao: 'Previsão de faturamento' };

/**
 * aria-label da barra focável: o mesmo resumo do tooltip, com a série e o mês
 * por extenso — no leitor de tela "set/26" sai como "set barra 26".
 */
function rotuloAcessivelDica(conteudo) {
    const nome = DASH_NOMES_SERIE[conteudo.serie] || conteudo.titulo;
    const mes = partesDoMes(conteudo.mes) ? ` em ${rotuloMesLongo(conteudo.mes)}` : '';
    // O que saiu vai junto: para o leitor de tela as barras de baixo não existem à parte.
    const saidas = listaDe(conteudo.saidas).map(saida => `${saida.nome}: ${[saida.valor, saida.detalhe].filter(Boolean).join(', ')}`);
    return [`${nome}${mes}: ${conteudo.resumo}`, ...saidas].join('. ');
}

/**
 * Estado de uma seção no contrato:
 *  - 'ok'     → veio em `secoes`;
 *  - 'falha'  → a fonte falhou (está em `falhas`): o cartão mostra o erro;
 *  - 'oculta' → não veio em lugar nenhum = sem permissão. O servidor é quem
 *    garante (a tela falha aberta de propósito); aqui só se esconde.
 */
function estadoDaSecao(dados, secao) {
    const secoes = dados?.secoes && typeof dados.secoes === 'object' ? dados.secoes : {};
    const falhas = dados?.falhas && typeof dados.falhas === 'object' ? dados.falhas : {};
    if (Object.prototype.hasOwnProperty.call(secoes, secao) && secoes[secao]) return 'ok';
    if (Object.prototype.hasOwnProperty.call(falhas, secao)) return 'falha';
    return 'oculta';
}

/**
 * O que o gráfico de vendas desenha, a partir das DUAS seções de que depende.
 * `mostra*` diz se a série pertence ao cartão (liberada, mesmo que tenha
 * falhado agora): é o que escolhe o título, a legenda e a nota de falha.
 */
function seriesDoGrafico(dados) {
    const estadoVendas = estadoDaSecao(dados, 'vendas');
    const estadoPrevisao = estadoDaSecao(dados, 'previsao');
    const serie = estadoVendas === 'ok' ? listaDe(dados.secoes.vendas?.serie12m) : [];
    // Sem a coluna de valor todos os `valor` de vendas vêm null: o gráfico conta pedidos.
    const emDinheiro = estadoVendas !== 'ok' || serie.some(item => numeroOuNulo(item?.valor) !== null);
    // A previsão é R$ e exige a mesma coluna de valor: sem ela o BFF nem a
    // manda. Se viesse ao lado de vendas em contagem, R$ e pedidos dividiriam
    // um eixo só — fica a contagem.
    const mostraPrevisao = estadoPrevisao !== 'oculta' && emDinheiro;
    return {
        estadoVendas,
        estadoPrevisao,
        serie,
        emDinheiro,
        mostraVendas: estadoVendas !== 'oculta',
        mostraPrevisao,
        previsao: mostraPrevisao && estadoPrevisao === 'ok' ? dados.secoes.previsao : null
    };
}

const DASH_TITULOS_GRAFICO = {
    ambos: {
        titulo: 'Vendas fechadas e previsão de faturamento',
        subtitulo: 'Pedidos gerados por mês, sem os cancelados, e parcelas pelo mês de vencimento'
    },
    vendas: {
        titulo: 'Vendas fechadas — últimos 12 meses',
        subtitulo: 'Pedidos gerados na aprovação do orçamento, sem os cancelados'
    },
    previsao: {
        titulo: 'Previsão de faturamento',
        subtitulo: 'Parcelas dos pedidos pelo mês de vencimento'
    }
};

/**
 * Título do cartão do gráfico. Sem a previsão no perfil volta a ser o gráfico
 * de antes — prometer "previsão" a quem não pode vê-la seria mentira. Com a
 * previsão em falha o título fica: ela é do cartão, só não veio agora.
 */
function titulosDoGrafico(dados) {
    const { mostraVendas, mostraPrevisao } = seriesDoGrafico(dados);
    if (mostraVendas && mostraPrevisao) return DASH_TITULOS_GRAFICO.ambos;
    return mostraPrevisao ? DASH_TITULOS_GRAFICO.previsao : DASH_TITULOS_GRAFICO.vendas;
}

/**
 * Cada cartão da tela, a seção de que depende e quem o desenha. A chave é o
 * `data-dash-cartao` do HTML (um teste confere os dois lados). `mostrar`
 * esconde os cartões que só fazem sentido quando têm algo a dizer.
 * `outrasSecoes`: o cartão também aparece com qualquer uma delas, e só vira
 * erro quando nenhuma veio. `titulos` troca o título conforme o que veio.
 */
const DASH_CARTOES = {
    'kpi-vendas': { secao: 'vendas', desenhar: desenharKpiVendas },
    // Ticket médio é só dinheiro: sem a coluna de valor não há contagem que o
    // substitua, e um cartão dizendo "sem acesso" seria ruído.
    'kpi-ticket': {
        secao: 'vendas',
        mostrar: s => numeroOuNulo(s?.mesAtual?.ticketMedio) !== null,
        desenhar: desenharKpiTicket
    },
    'kpi-producao': { secao: 'producao', desenhar: desenharKpiProducao },
    'kpi-orcamentos': { secao: 'orcamentos', desenhar: desenharKpiOrcamentos },
    // Vendas (ouro) e previsão de faturamento (verde) no mesmo eixo. A previsão
    // tem permissão própria (valor + condição de pagamento do pedido), por isso
    // é outra seção: quem só vê vendas continua com o gráfico de antes.
    'grafico-vendas': {
        secao: 'vendas',
        outrasSecoes: ['previsao'],
        titulos: titulosDoGrafico,
        desenhar: desenharGraficoVendas
    },
    'grafico-situacao': { secao: 'producao', desenhar: desenharGraficoSituacao },
    'funil': { secao: 'prospeccao', desenhar: desenharFunil },
    'idade': { secao: 'producao', desenhar: desenharIdade },
    // Alerta de integridade: só aparece quando existe o problema.
    'sem-pedido': {
        secao: 'alertas',
        mostrar: s => quantidadeDe(s?.aprovadosSemPedido?.quantidade) > 0,
        desenhar: desenharSemPedido
    },
    'vencendo': { secao: 'orcamentos', desenhar: desenharVencendo },
    'followups': { secao: 'prospeccao', desenhar: desenharFollowups },
    'estoque': { secao: 'estoque', desenhar: desenharEstoque },
    'ia': { secao: 'ia', mostrar: s => quantidadeDe(s?.emRevisao) > 0, desenhar: desenharIa },
    'aprovacao': { secao: 'orcamentos', desenhar: desenharAprovacao },
    'clientes': { secao: 'clientes', desenhar: desenharClientes }
};

function secoesDoCartao(cartao) {
    return [cartao.secao, ...listaDe(cartao.outrasSecoes)];
}

/**
 * 'ok' | 'falha' | 'oculto' para um cartão, a partir da resposta. Cartão de
 * mais de uma seção fica de pé com qualquer uma delas: o gráfico desenha a
 * série que veio e avisa, discreto, da que falhou.
 */
function estadoDoCartao(dados, chave) {
    const cartao = DASH_CARTOES[chave];
    if (!cartao) return 'oculto';
    const estados = secoesDoCartao(cartao).map(secao => estadoDaSecao(dados, secao));
    if (!estados.includes('ok')) return estados.includes('falha') ? 'falha' : 'oculto';
    if (typeof cartao.mostrar === 'function' && !cartao.mostrar(dados.secoes[cartao.secao])) return 'oculto';
    return 'ok';
}

/**
 * O que a tela inteira mostra quando nenhum cartão sobra:
 *  - 'sem-permissao' → nenhuma seção veio: o perfil não tem indicador liberado;
 *  - 'tudo-em-dia'   → há seção liberada, mas só as que aparecem sob demanda
 *    (IA, aprovados sem pedido) e estão zeradas. Dizer "sem permissão" aqui
 *    seria mentira.
 */
function estadoGeral(dados) {
    const algumVisivel = Object.keys(DASH_CARTOES).some(chave => estadoDoCartao(dados, chave) !== 'oculto');
    if (algumVisivel) return 'ok';
    const secoes = dados?.secoes && typeof dados.secoes === 'object' ? dados.secoes : {};
    return Object.keys(secoes).some(secao => secoes[secao]) ? 'tudo-em-dia' : 'sem-permissao';
}

/** Formatação dos números animados (a contagem reformata a cada quadro). */
function formatarPorTipo(valor, tipo) {
    if (tipo === 'moeda') return formatarMoedaDestaque(valor);
    if (tipo === 'compacta') return formatarMoedaCompacta(valor);
    if (tipo === 'percentual') return formatarPercentual(valor);
    return formatarNumero(Math.round(numeroOuNulo(valor) ?? 0));
}

// ---------------------------------------------------------------------------
// Construção de DOM — sempre createElement + textContent.
// ---------------------------------------------------------------------------

const DASH_SVG_NS = 'http://www.w3.org/2000/svg';

function criarEl(tag, classe, texto) {
    const no = document.createElement(tag);
    if (classe) no.className = classe;
    if (texto !== undefined && texto !== null && texto !== '') no.textContent = String(texto);
    return no;
}

function criarSvg(tag, atributos = {}) {
    const no = document.createElementNS(DASH_SVG_NS, tag);
    Object.entries(atributos).forEach(([nome, valor]) => {
        if (valor !== undefined && valor !== null) no.setAttribute(nome, String(valor));
    });
    return no;
}

function criarIcone(classes) {
    const icone = criarEl('i', classes);
    icone.setAttribute('aria-hidden', 'true');
    return icone;
}

/** `data-tom` escolhe a cor pelo CSS, que já troca sozinha com o tema. */
function comTom(no, tom) {
    if (tom) no.dataset.tom = tom;
    return no;
}

function montarChip(texto, tom = 'neutro', icone) {
    const chip = comTom(criarEl('span', 'dash-chip'), tom);
    if (icone) chip.append(criarIcone(`fas ${icone}`));
    chip.append(document.createTextNode(texto));
    return chip;
}

function montarVazio(texto, { icone = 'fa-circle-check', tom = 'verde', grande = false } = {}) {
    const caixa = comTom(criarEl('div', `dash-vazio${grande ? ' dash-vazio--grande' : ''}`), tom);
    caixa.append(criarIcone(`fas ${icone}`), criarEl('p', 'dash-vazio__texto', texto));
    return caixa;
}

/**
 * Botão "Atualizar" criado pela tela. `data-acao-gerida` é obrigatório: sem
 * ele a rede automática do BotaoAcao (listener em CAPTURA no document) marca o
 * botão como ocupado antes do nosso handler, e o `BotaoAcao.run` desiste
 * achando que é um segundo clique — o botão simplesmente não faria nada.
 */
function montarBotaoAtualizar(texto = 'Atualizar') {
    const botao = criarEl('button', 'dash-botao-leve');
    botao.type = 'button';
    botao.dataset.dashAcao = 'atualizar';
    botao.dataset.acaoGerida = 'true';
    botao.append(criarIcone('fas fa-rotate'), criarEl('span', '', texto));
    return botao;
}

/** Erro discreto de UMA seção: o resto do painel continua de pé. */
function montarErroDoCartao(mensagem) {
    const caixa = criarEl('div', 'dash-erro-cartao');
    caixa.setAttribute('role', 'status');
    const titulo = criarEl('p', 'dash-erro-cartao__titulo');
    titulo.append(criarIcone('fas fa-triangle-exclamation'), document.createTextNode('Não foi possível carregar agora'));
    caixa.append(titulo);
    if (mensagem) caixa.append(criarEl('p', 'dash-erro-cartao__detalhe', mensagem));
    caixa.append(montarBotaoAtualizar());
    return caixa;
}

function montarItemLista({ titulo, detalhe, etiqueta, etiquetas, alerta, valor, dica }) {
    const item = criarEl('li', 'dash-lista__item');
    if (dica) item.title = dica;
    // Título e detalhe são cortados com reticências na largura do cartão
    // ("Casa Bela Decorações ME · com Ana" virava "Casa Bela Deco…"). O texto
    // inteiro vai no `title` de cada um — por PROPRIEDADE, nunca innerHTML — e
    // leva a dica junto, senão o title do span esconderia o do item.
    const comDica = texto => (dica ? `${texto}\n${dica}` : texto);
    const tituloEl = criarEl('span', 'dash-lista__titulo', titulo || '—');
    tituloEl.title = comDica(tituloEl.textContent);
    // Símbolo de atenção DEPOIS do número, na cor do prazo: o ícone não tem
    // texto, então o textContent (e o title acima) continuam só o número.
    if (alerta) {
        const icone = comTom(criarIcone('fas fa-triangle-exclamation dash-lista__alerta'), alerta.tom);
        if (alerta.titulo) icone.title = alerta.titulo;
        tituloEl.append(icone);
    }
    item.append(tituloEl);
    if (detalhe) {
        const detalheEl = criarEl('span', 'dash-lista__detalhe', detalhe);
        detalheEl.title = comDica(detalheEl.textContent);
        item.append(detalheEl);
    }
    const lado = criarEl('span', 'dash-lista__lado');
    const chips = [etiqueta, ...listaDe(etiquetas)].filter(e => e?.texto).map(e => {
        const chip = montarChip(e.texto, e.tom);
        if (e.dica) chip.title = e.dica;
        return chip;
    });
    // Duas etiquetas (idade e prazo de embarque): lado a lado, na mesma linha,
    // e o valor embaixo — o .dash-lista__lado continua em coluna.
    if (chips.length > 1) {
        const grupo = criarEl('span', 'dash-lista__etiquetas');
        grupo.append(...chips);
        lado.append(grupo);
    } else if (chips.length) {
        lado.append(chips[0]);
    }
    if (valor) lado.append(criarEl('span', 'dash-lista__valor', valor));
    if (lado.childNodes.length) item.append(lado);
    return item;
}

function montarLista(itens, descrever) {
    const lista = criarEl('ul', 'dash-lista');
    itens.forEach(item => lista.append(montarItemLista(descrever(item))));
    return lista;
}

/** Rodapé "+N não listados" — só existe quando a lista veio cortada. */
function montarMais(total, exibidos) {
    const texto = textoMais(total, exibidos);
    if (!texto) return null;
    const linha = criarEl('p', 'dash-mais');
    linha.append(criarEl('strong', '', texto), document.createTextNode(' não listados'));
    return linha;
}

function montarRodape(texto, icone) {
    const rodape = criarEl('p', 'dash-rodape');
    if (icone) rodape.append(criarIcone(`fas ${icone}`));
    rodape.append(document.createTextNode(texto));
    return rodape;
}

/**
 * Número animável. O texto FINAL é gravado já na criação: se a animação não
 * rodar (movimento reduzido, aba oculta), o número certo está lá; a contagem
 * só parte do zero depois que a máscara do menu sai (ver `animarContadores`).
 */
function definirContador(no, id, valor, tipo = 'numero') {
    const numero = numeroOuNulo(valor);
    if (numero === null) {
        no.textContent = '—';
        return no;
    }
    no.dataset.dashContar = tipo;
    no.dataset.dashId = id;
    no.dataset.dashAlvo = String(numero);
    no.textContent = formatarPorTipo(numero, tipo);
    return no;
}

function montarDelta(variacao, comparacao) {
    if (!variacao) return null;
    const semBase = variacao.fracao === null;
    const tipo = semBase || variacao.tipo === 'estavel' ? 'neutro' : variacao.tipo;
    const icone = tipo === 'alta' ? 'fa-arrow-up' : tipo === 'baixa' ? 'fa-arrow-down' : 'fa-minus';
    const linha = criarEl('div', 'dash-kpi__variacao');
    const pilula = criarEl('span', `dash-delta dash-delta--${tipo}`);
    pilula.append(criarIcone(`fas ${icone}`), document.createTextNode(textoVariacao(variacao)));
    linha.append(pilula, criarEl('span', 'dash-kpi__comparacao',
        semBase ? 'nada no mesmo período do mês passado' : comparacao));
    return linha;
}

function preencherKpi(corpo, { id, valor, tipo = 'numero', exato, sub, variacao, comparacao, notas = [] }) {
    const valorEl = definirContador(criarEl('p', 'dash-kpi__valor'), id, valor, tipo);
    if (exato) valorEl.title = exato;
    const filhos = [valorEl];
    if (sub) filhos.push(criarEl('p', 'dash-kpi__sub', sub));
    const delta = montarDelta(variacao, comparacao);
    if (delta) filhos.push(delta);
    const notasValidas = notas.filter(Boolean);
    if (notasValidas.length) {
        const rodape = criarEl('div', 'dash-kpi__notas');
        notasValidas.forEach(nota => {
            const chip = montarChip(nota.texto, nota.tom, nota.icone);
            if (nota.dica) chip.title = nota.dica;
            rodape.append(chip);
        });
        filhos.push(rodape);
    }
    corpo.replaceChildren(...filhos);
}

function montarContagem({ id, numero, tipo = 'numero', legenda }) {
    const bloco = criarEl('div', 'dash-contagem');
    bloco.append(definirContador(criarEl('span', 'dash-contagem__numero'), id, numero, tipo));
    if (legenda) bloco.append(criarEl('span', 'dash-contagem__legenda', legenda));
    return bloco;
}

function montarDestaque({ rotulo, id, numero, tipo = 'numero', tom, exato }) {
    const bloco = comTom(criarEl('div', 'dash-destaque'), tom);
    bloco.append(criarEl('span', 'dash-destaque__rotulo', rotulo));
    const valor = definirContador(criarEl('span', 'dash-destaque__valor'), id, numero, tipo);
    if (exato) valor.title = exato;
    bloco.append(valor);
    return bloco;
}

function montarBarraHorizontal({ rotulo, largura, numero, complemento, tom, nivel, dica }) {
    const linha = comTom(criarEl('div', 'dash-hbarra'), tom);
    if (nivel !== undefined) linha.dataset.nivel = String(nivel);
    if (dica) linha.title = dica;
    const trilho = criarEl('span', 'dash-hbarra__trilho');
    const preenchimento = criarEl('span', 'dash-hbarra__preenchimento');
    preenchimento.style.width = `${largura.toFixed(2)}%`;
    trilho.append(preenchimento);
    const numeros = criarEl('span', 'dash-hbarra__numeros', numero);
    if (complemento) numeros.append(criarEl('small', '', complemento));
    linha.append(criarEl('span', 'dash-hbarra__rotulo', rotulo), trilho, numeros);
    return linha;
}

/** Barra fina dividida em partes (aprovados × rejeitados, ativos × inativos). */
function montarBarraEmpilhada(partes, rotuloAcessivel) {
    const total = partes.reduce((soma, parte) => soma + Math.max(0, parte.valor), 0);
    const barra = criarEl('div', 'dash-empilhada');
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', rotuloAcessivel);
    partes.forEach(parte => {
        if (!(parte.valor > 0) || !(total > 0)) return;
        const pedaco = comTom(criarEl('span', 'dash-empilhada__parte'), parte.tom);
        pedaco.style.width = `${((parte.valor / total) * 100).toFixed(2)}%`;
        pedaco.title = `${parte.rotulo}: ${formatarNumero(parte.valor)}`;
        barra.append(pedaco);
    });
    return barra;
}

// ---------------------------------------------------------------------------
// Cartões — cada um recebe o corpo, a própria seção e a resposta inteira.
// ---------------------------------------------------------------------------

function desenharKpiVendas(corpo, s) {
    const atual = s?.mesAtual || {};
    const referencia = s?.mesAnteriorMesmoPeriodo || {};
    const quantidade = quantidadeDe(atual.quantidade);
    const valor = numeroOuNulo(atual.valor);
    const emDinheiro = valor !== null;
    const cancelados = quantidadeDe(s?.canceladosMes?.quantidade);
    const valorCancelado = numeroOuNulo(s?.canceladosMes?.valor);
    const devolucoes = quantidadeDe(s?.devolvidosMes?.quantidade);
    const valorDevolvido = numeroOuNulo(s?.devolvidosMes?.valor);
    preencherKpi(corpo, {
        id: 'kpi-vendas',
        valor: emDinheiro ? valor : quantidade,
        tipo: emDinheiro ? 'moeda' : 'numero',
        exato: emDinheiro ? formatarMoeda(valor) : '',
        sub: emDinheiro
            ? pluralizar(quantidade, 'pedido fechado', 'pedidos fechados')
            : (quantidade === 1 ? 'pedido fechado no mês' : 'pedidos fechados no mês'),
        // Sem a coluna de valor compara contagem com contagem — nunca R$ com nada.
        // A referência é o MESMO trecho do mês passado: o mês corrente parcial
        // contra o anterior inteiro pareceria sempre uma queda.
        variacao: emDinheiro
            ? calcularVariacao(valor, numeroOuNulo(referencia.valor))
            : calcularVariacao(quantidade, numeroOuNulo(referencia.quantidade)),
        comparacao: 'vs. mesmo período do mês passado',
        notas: [cancelados > 0 && {
            tom: 'vermelho',
            icone: 'fa-ban',
            texto: `${pluralizar(cancelados, 'cancelado', 'cancelados')} no mês`
                + (valorCancelado !== null ? ` (${formatarMoedaCompacta(valorCancelado)})` : '')
        }, devolucoes > 0 && {
            // O valor do mês continua o da venda: o que voltou é dito aqui, em roxo.
            tom: 'roxo',
            icone: 'fa-rotate-left',
            texto: `${pluralizar(devolucoes, 'devolução', 'devoluções')} no mês`
                + (valorDevolvido !== null ? ` (${formatarMoedaCompacta(valorDevolvido)})` : '')
        }]
    });
}

function desenharKpiTicket(corpo, s) {
    const quantidade = quantidadeDe(s?.mesAtual?.quantidade);
    const ticket = numeroOuNulo(s?.mesAtual?.ticketMedio);
    if (quantidade === 0) {
        // Sem pedido o backend manda ticket 0 — "R$ 0" leria como venda de graça.
        preencherKpi(corpo, { id: 'kpi-ticket', valor: null, sub: 'Nenhum pedido fechado no mês ainda' });
        return;
    }
    const quantidadeAnterior = quantidadeDe(s?.mesAnteriorMesmoPeriodo?.quantidade);
    const ticketAnterior = numeroOuNulo(s?.mesAnteriorMesmoPeriodo?.ticketMedio);
    preencherKpi(corpo, {
        id: 'kpi-ticket',
        valor: ticket,
        tipo: 'moeda',
        exato: formatarMoeda(ticket),
        sub: 'por pedido fechado no mês',
        // Período anterior sem pedido tem ticket 0 por convenção, não um ticket
        // de R$ 0: comparado como referência zero, vira "sem base" — e não +∞%.
        variacao: calcularVariacao(ticket, quantidadeAnterior > 0 ? ticketAnterior : 0),
        comparacao: 'vs. mesmo período do mês passado'
    });
}

function desenharKpiProducao(corpo, s) {
    const quantidade = quantidadeDe(s?.quantidade);
    const valor = numeroOuNulo(s?.valor);
    const faixaAntiga = listaDe(s?.porIdade).find(faixa => faixa?.faixa === '60+');
    const antigos = quantidadeDe(faixaAntiga?.quantidade);
    // Em dia × em atraso pela previsão de embarque. O `emDia` do BFF já inclui
    // quem embarca em menos de 7 dias (ainda no prazo). Sem o bloco (servidor
    // anterior à previsão) os chips não saem: "0 em atraso" seria afirmação
    // sem base.
    const prazo = quantidade > 0 && s?.prazo && typeof s.prazo === 'object' ? s.prazo : null;
    const contar = chave => quantidadeDe(prazo?.[chave]?.quantidade);
    const emDia = contar('emDia');
    const atencao = contar('atencao');
    const atrasados = contar('atrasados');
    const semPrevisao = contar('semPrevisao');
    preencherKpi(corpo, {
        id: 'kpi-producao',
        valor: quantidade,
        tipo: 'numero',
        sub: valor !== null
            ? `${quantidade === 1 ? 'pedido' : 'pedidos'} · ${formatarMoedaCompacta(valor)} em produção`
            : (quantidade === 1 ? 'pedido em produção' : 'pedidos em produção'),
        notas: [
            prazo && {
                tom: emDia > 0 ? 'verde' : 'neutro',
                icone: 'fa-circle-check',
                texto: textoContagemComValor(emDia, 'em dia', prazo.emDia?.valor),
                dica: atencao > 0
                    ? `Inclui ${formatarNumero(atencao)} ${atencao === 1 ? 'que embarca' : 'que embarcam'} em menos de 7 dias`
                    : ''
            },
            prazo && {
                tom: atrasados > 0 ? 'roxo' : 'neutro',
                icone: 'fa-triangle-exclamation',
                texto: textoContagemComValor(atrasados, 'em atraso', prazo.atrasados?.valor),
                dica: 'Passaram da previsão de embarque e continuam em produção'
            },
            semPrevisao > 0 && {
                tom: 'neutro',
                icone: 'fa-calendar',
                texto: `${formatarNumero(semPrevisao)} sem previsão`,
                dica: DASH_DICA_SEM_PREVISAO
            },
            antigos > 0 && {
                tom: 'ouro',
                icone: 'fa-hourglass-end',
                texto: `${formatarNumero(antigos)} há mais de 60 dias`
            }
        ]
    });
}

function desenharKpiOrcamentos(corpo, s) {
    const vigentes = s?.pendentesVigentes || {};
    const quantidade = quantidadeDe(vigentes.quantidade);
    const valor = numeroOuNulo(vigentes.valor);
    const vencidos = quantidadeDe(s?.pendentesVencidos?.quantidade);
    preencherKpi(corpo, {
        id: 'kpi-orcamentos',
        valor: valor !== null ? valor : quantidade,
        tipo: valor !== null ? 'moeda' : 'numero',
        exato: valor !== null ? formatarMoeda(valor) : '',
        sub: valor !== null
            ? `${pluralizar(quantidade, 'orçamento pendente', 'orçamentos pendentes')} na validade`
            : (quantidade === 1 ? 'orçamento pendente na validade' : 'orçamentos pendentes na validade'),
        // Nada no sistema expira orçamento sozinho: o Pendente vencido continua
        // Pendente e ficaria escondido dentro do total se não fosse separado.
        notas: [vencidos > 0 && {
            tom: 'vermelho',
            icone: 'fa-calendar-xmark',
            texto: `${formatarNumero(vencidos)} ${vencidos === 1 ? 'vencido ainda pendente' : 'vencidos ainda pendentes'}`
        }]
    });
}

function montarDadoResumo(rotulo, valor) {
    const dado = criarEl('div', 'dash-grafico__dado');
    dado.append(criarEl('span', 'dash-grafico__dado-rotulo', rotulo), criarEl('strong', 'dash-grafico__dado-valor', valor));
    return dado;
}

/**
 * "PROGRAMADO DE SET/26 EM DIANTE": o que as parcelas ainda vão trazer, do mês
 * atual em diante, incluindo o que passa do último mês do gráfico — esse vem
 * à parte ("+R$ Y depois de jan/27"), para nada sumir em silêncio.
 */
function montarDadoPrevisao(previsao, mesAtual, ultimoMes) {
    const programado = numeroOuNulo(previsao?.programadoDesteMes);
    const dado = montarDadoResumo(`Programado de ${rotuloMes(mesAtual)} em diante`,
        programado !== null ? formatarMoedaCompacta(programado) : '—');
    dado.classList.add('dash-grafico__dado--previsao');
    if (programado !== null) dado.title = formatarMoeda(programado);
    const alem = previsao?.alemDoHorizonte || {};
    const valorAlem = numeroOuNulo(alem.valor);
    if (valorAlem !== null && valorAlem > 0) {
        const nota = criarEl('span', 'dash-grafico__dado-nota',
            `+${formatarMoedaCompacta(valorAlem)} depois de ${rotuloMes(ultimoMes)}`);
        const ate = partesDoMes(alem.ate) ? ` até ${rotuloMes(alem.ate)}` : '';
        nota.title = `${pluralizar(alem.parcelas, 'parcela', 'parcelas')}${ate}: ${formatarMoeda(valorAlem)}`;
        dado.append(nota);
    }
    return dado;
}

/** Legenda das séries desenhadas — sem a previsão no perfil, só o ouro. */
function montarLegendaGrafico({ comVendas, comPrevisao, comCancelado = false, comDevolvido = false }) {
    const legenda = criarEl('ul', 'dash-grafico__legenda');
    legenda.setAttribute('aria-label', 'Legenda do gráfico');
    const item = (serie, texto) => {
        const linha = criarEl('li', `dash-grafico__legenda-item dash-grafico__legenda-item--${serie}`);
        const cor = criarEl('span', `dash-grafico__legenda-cor dash-grafico__legenda-cor--${serie}`);
        cor.setAttribute('aria-hidden', 'true');
        linha.append(cor, criarEl('span', '', texto));
        return linha;
    };
    if (comVendas) legenda.append(item('vendas', 'Vendas fechadas'));
    if (comPrevisao) legenda.append(item('previsao', 'Previsão de faturamento (parcelas pelo vencimento)'));
    // Só quando há o que mostrar: a legenda não promete barra que o gráfico não tem.
    if (comCancelado) legenda.append(item('cancelado', 'Cancelado (abaixo da linha)'));
    if (comDevolvido) legenda.append(item('devolvido', 'Devolvido (abaixo da linha)'));
    return legenda;
}

/** Nota discreta de uma série que não veio agora; o motivo do BFF vai no title. */
function montarNotaGrafico(texto, detalhe) {
    const nota = criarEl('p', 'dash-grafico__nota');
    nota.setAttribute('role', 'status');
    nota.append(criarIcone('fas fa-circle-info'), document.createTextNode(texto));
    if (typeof detalhe === 'string' && detalhe.trim()) nota.title = detalhe;
    return nota;
}

function desenharGraficoVendas(corpo, s, dados) {
    const { estadoVendas, estadoPrevisao, serie, emDinheiro, mostraPrevisao, previsao } = seriesDoGrafico(dados);
    const comVendas = estadoVendas === 'ok';
    const mesesPrevisao = previsao ? listaDe(previsao.meses) : [];
    const mesAtual = dados?.mesAtual || serie[serie.length - 1]?.mes
        || mesesPrevisao[Math.min(11, mesesPrevisao.length - 1)]?.mes;

    // A série que falhou agora vira nota discreta; a outra continua desenhada
    // e o "Atualizar" do cabeçalho relê as duas.
    const notas = [];
    if (comVendas && mostraPrevisao && estadoPrevisao === 'falha') {
        notas.push(montarNotaGrafico('Previsão de faturamento indisponível agora.', dados.falhas.previsao));
    }
    if (previsao && estadoVendas === 'falha') {
        notas.push(montarNotaGrafico('Vendas fechadas indisponíveis agora.', dados.falhas.vendas));
    }

    const houveVenda = serie.some(item => quantidadeDe(item?.quantidade) > 0 || (numeroOuNulo(item?.valor) ?? 0) > 0);
    const houvePrevisao = mesesPrevisao.some(item => (numeroOuNulo(item?.valor) ?? 0) > 0)
        || (numeroOuNulo(previsao?.alemDoHorizonte?.valor) ?? 0) > 0;
    if (!houveVenda && !houvePrevisao) {
        const texto = comVendas && previsao
            ? 'Nenhuma venda fechada nos últimos 12 meses e nenhuma parcela programada.'
            : (previsao ? 'Nenhuma parcela de pedido programada.' : 'Nenhuma venda fechada nos últimos 12 meses.');
        corpo.replaceChildren(montarVazio(texto, { icone: 'fa-chart-bar', tom: 'neutro', grande: true }), ...notas);
        return;
    }

    const resumo = criarEl('div', 'dash-grafico__resumo');
    if (comVendas) {
        const totalQuantidade = serie.reduce((soma, item) => soma + quantidadeDe(item?.quantidade), 0);
        const totalValor = serie.reduce((soma, item) => soma + (numeroOuNulo(item?.valor) ?? 0), 0);
        const anterior = s?.mesAnterior || {};
        const valorAnterior = numeroOuNulo(anterior.valor);
        const pedidosAnterior = pluralizar(anterior.quantidade, 'pedido', 'pedidos');
        resumo.append(
            montarDadoResumo('Nos 12 meses', emDinheiro
                ? `${formatarMoedaCompacta(totalValor)} · ${pluralizar(totalQuantidade, 'pedido', 'pedidos')}`
                : pluralizar(totalQuantidade, 'pedido', 'pedidos')),
            montarDadoResumo('Mês passado inteiro', valorAnterior !== null
                ? `${formatarMoedaCompacta(valorAnterior)} · ${pedidosAnterior}`
                : pedidosAnterior)
        );
    }
    if (previsao) resumo.append(montarDadoPrevisao(previsao, mesAtual, mesesPrevisao[mesesPrevisao.length - 1]?.mes));
    resumo.append(montarDadoResumo('Eixo', emDinheiro ? 'valor em R$' : 'quantidade de pedidos'));

    const figura = criarEl('div', 'dash-grafico');
    // Cancelado e devolvido só entram na legenda quando alguma barra deles existe.
    const saiu = tipo => serie.some(item => quantidadeDe(item?.[tipo]?.quantidade) > 0 || (numeroOuNulo(item?.[tipo]?.valor) ?? 0) > 0)
        || mesesPrevisao.some(item => (numeroOuNulo(item?.[tipo]) ?? 0) > 0);
    corpo.replaceChildren(resumo, montarLegendaGrafico({
        comVendas, comPrevisao: Boolean(previsao), comCancelado: saiu('cancelado'), comDevolvido: saiu('devolvido')
    }), ...notas, figura);
    // Guardado no elemento (não numa variável do script) porque quem redesenha
    // no redimensionamento pode ser o código de outra execução do arquivo.
    corpo.__dashGrafico = {
        colunas: colunasDoGrafico(serie, mesesPrevisao),
        chave: emDinheiro ? 'valor' : 'quantidade',
        mesAtual
    };
    desenharBarrasNoCartao(corpo);
    observarLargura(corpo, () => desenharBarrasNoCartao(corpo));
}

/** Redesenha em pixels reais; ignora quando a largura não mudou. */
function desenharBarrasNoCartao(corpo) {
    const estado = corpo.__dashGrafico;
    const figura = corpo.querySelector('.dash-grafico');
    if (!estado || !figura) return;
    const largura = Math.round(figura.clientWidth) || 640;
    if (figura.dataset.larguraDesenhada === String(largura)) return;
    figura.dataset.larguraDesenhada = String(largura);
    // As barras vão ser trocadas: a caixa aberta apontaria para uma que sumiu.
    fecharDica(corpo);
    figura.replaceChildren(montarSvgBarras(estado, largura, corpo));
}

/** aria-label do gráfico inteiro, conforme as séries desenhadas. */
function rotuloDoGrafico({ comVendas, comPrevisao, emDinheiro }) {
    if (comVendas && comPrevisao) {
        return 'Vendas fechadas por mês e previsão de faturamento pelo mês de vencimento das parcelas, em reais';
    }
    if (comPrevisao) return 'Previsão de faturamento pelo mês de vencimento das parcelas, em reais';
    return emDinheiro
        ? 'Vendas fechadas por mês, em reais, nos últimos 12 meses'
        : 'Pedidos fechados por mês nos últimos 12 meses';
}

function montarSvgBarras({ colunas, chave, mesAtual }, largura, corpo) {
    const emDinheiro = chave === 'valor';
    const geo = geometriaGrafico(colunas, {
        largura, altura: 240, chave, mesAtual, margem: { esquerda: emDinheiro ? 52 : 34 }
    });
    const svg = criarSvg('svg', {
        class: 'dash-barras',
        viewBox: `0 0 ${geo.largura} ${geo.altura}`,
        width: geo.largura,
        height: geo.altura,
        // `group`, não `img`: dentro de uma imagem as barras focáveis (e o
        // resumo de cada uma) virariam decoração para o leitor de tela.
        role: 'group',
        'aria-label': rotuloDoGrafico({
            comVendas: geo.colunas.some(coluna => coluna.vendas),
            comPrevisao: geo.colunas.some(coluna => coluna.previsao),
            emDinheiro
        })
    });

    const defs = criarSvg('defs');
    const gradiente = criarSvg('linearGradient', { id: 'dashGradienteOuro', x1: 0, y1: 0, x2: 0, y2: 1 });
    gradiente.append(
        criarSvg('stop', { offset: '0%', class: 'dash-barras__ouro-claro' }),
        criarSvg('stop', { offset: '100%', class: 'dash-barras__ouro' })
    );
    defs.append(gradiente);
    svg.append(defs);

    const grade = criarSvg('g', { class: 'dash-barras__grade' });
    geo.grade.forEach((linha, indice) => {
        // A marca zero é a linha de base, desenhada por cima das barras.
        if (indice > 0) {
            grade.append(criarSvg('line', {
                x1: geo.margem.esquerda, x2: geo.largura - geo.margem.direita, y1: linha.y, y2: linha.y
            }));
        }
        const rotulo = criarSvg('text', {
            class: 'dash-barras__eixo', x: geo.margem.esquerda - 8, y: linha.y + 4, 'text-anchor': 'end'
        });
        const marca = Math.abs(linha.valor);
        rotulo.textContent = (linha.valor < 0 ? DASH_MENOS : '') + (emDinheiro ? formatarEixoCompacto(marca) : formatarNumero(marca));
        grade.append(rotulo);
    });
    svg.append(grade);

    if (geo.separadorX !== null) {
        svg.append(criarSvg('line', {
            class: 'dash-barras__separador', x1: geo.separadorX, x2: geo.separadorX, y1: geo.topoY - 6, y2: geo.baseY
        }));
        const rotulo = criarSvg('text', {
            class: 'dash-barras__previsao-rotulo', x: geo.separadorX + 5, y: geo.topoY - 10, 'text-anchor': 'start'
        });
        rotulo.textContent = 'previsão';
        svg.append(rotulo);
    }

    const grupo = criarSvg('g');
    geo.colunas.forEach(colunaGeo => {
        const coluna = colunas[colunaGeo.indice] || {};
        const classes = ['dash-barras__coluna'];
        if (colunaGeo.atual) classes.push('dash-barras__coluna--atual');
        if (colunaGeo.futura) classes.push('dash-barras__coluna--futura');
        const g = criarSvg('g', { class: classes.join(' ') });
        g.append(criarSvg('rect', {
            class: 'dash-barras__faixa', x: colunaGeo.banda.x, y: geo.topoY, width: colunaGeo.banda.largura, height: geo.altura - geo.topoY
        }));
        const series = [
            ['vendas', colunaGeo.vendas, () => conteudoDicaVendas(coluna.vendas, { emDinheiro }), colunaGeo.saidasVendas],
            ['previsao', colunaGeo.previsao, () => conteudoDicaPrevisao(coluna.previsao), colunaGeo.saidasPrevisao]
        ];
        series.forEach(([serie, barra, montarConteudo, saidas]) => {
            if (!barra) return;
            const conteudo = montarConteudo();
            // Focável por teclado, com o mesmo resumo do tooltip no aria-label:
            // o tooltip próprio substitui o <title> nativo, que só o mouse via.
            const item = criarSvg('g', {
                class: `dash-barras__item dash-barras__item--${serie}`,
                tabindex: 0,
                role: 'img',
                'aria-label': rotuloAcessivelDica(conteudo)
            });
            // Alvo da barra inteira: sem ele o tooltip de um mês fraco (barra de
            // 3 px) era praticamente impossível de acertar com o mouse.
            item.append(criarSvg('rect', {
                class: 'dash-barras__alvo', x: barra.alvo.x, y: geo.topoY, width: barra.alvo.largura, height: geo.areaAltura, rx: 6
            }));
            const caminho = caminhoBarra(barra.x, barra.y, barra.largura, barra.altura, 5);
            if (caminho) item.append(criarSvg('path', { class: 'dash-barras__barra', d: caminho }));
            // O que saiu, pendurado sob a barra (mesmo item: um tooltip só conta as duas coisas).
            listaDe(saidas).forEach(saida => item.append(criarSvg('rect', {
                class: `dash-barras__saida dash-barras__saida--${saida.tipo}`,
                x: saida.x, y: saida.y, width: saida.largura, height: saida.altura, rx: 2
            })));
            // Âncora = a coluna inteira: a caixa abre abaixo dos rótulos de mês, e
            // o clique na outra barra do mesmo mês troca o conteúdo em vez de o
            // Popover tratá-lo como "clique fora".
            ligarDica(corpo, item, g, conteudo);
            g.append(item);
        });
        const ouro = colunaGeo.vendas;
        if (colunaGeo.atual && ouro && ouro.valor > 0) {
            const topo = colunaGeo.previsao ? Math.min(ouro.y, colunaGeo.previsao.y) : ouro.y;
            // Com meses futuros o valor encosta à esquerda da linha tracejada:
            // centrado na coluna, ele invadia o rótulo "previsão" do outro lado.
            let x = colunaGeo.centro;
            let ancora = 'middle';
            if (geo.separadorX !== null) {
                x = geo.separadorX - 5;
                ancora = 'end';
            } else if (colunaGeo.centro > geo.largura - 40) {
                x = geo.largura - 2;
                ancora = 'end';
            }
            const destaque = criarSvg('text', { class: 'dash-barras__valor', x, y: Math.max(12, topo - 8), 'text-anchor': ancora });
            destaque.textContent = emDinheiro ? formatarMoedaCompacta(ouro.valor) : formatarNumero(ouro.valor);
            g.append(destaque);
        }
        if (colunaGeo.mostrarRotulo || colunaGeo.atual) {
            const mes = criarSvg('text', {
                class: 'dash-barras__mes', x: colunaGeo.centro, y: geo.altura - 9, 'text-anchor': 'middle'
            });
            mes.textContent = rotuloMes(coluna.mes);
            g.append(mes);
        }
        grupo.append(g);
    });
    svg.append(grupo);
    svg.append(criarSvg('line', {
        class: 'dash-barras__base', x1: geo.margem.esquerda, x2: geo.largura - geo.margem.direita, y1: geo.baseY, y2: geo.baseY
    }));
    return svg;
}

/** "5 em dia · 2 em atraso" sob a situação na legenda do donut, cada parte na cor do anel. */
function montarPrazoDaLegenda(prazo) {
    const partes = partesDaLegendaDePrazo(prazo);
    if (!partes.length) return null;
    const linha = criarEl('span', 'dash-legenda__prazo');
    partes.forEach((parte, indice) => {
        if (indice > 0) linha.append(document.createTextNode(' · '));
        linha.append(comTom(criarEl('span', 'dash-legenda__prazo-parte',
            `${formatarNumero(parte.quantidade)} ${parte.rotulo}`), parte.tom));
    });
    return linha;
}

function desenharGraficoSituacao(corpo, s) {
    const geo = geometriaDonut(listaDe(s?.porSituacao12m), { chave: 'quantidade' });
    if (!geo.total) {
        corpo.replaceChildren(montarVazio('Nenhum pedido emitido nos últimos 12 meses.', {
            icone: 'fa-chart-pie', tom: 'neutro', grande: true
        }));
        return;
    }
    // Anel fino por fora: o prazo de embarque de cada situação. Sem os campos
    // (servidor anterior à previsão) ele não sai e o donut é o de antes.
    const arcos = arcosDePrazo(geo.segmentos);
    const figura = criarEl('div', 'dash-donut');
    const svg = criarSvg('svg', {
        viewBox: '0 0 42 42',
        role: 'img',
        'aria-label': arcos.length
            ? 'Pedidos dos últimos 12 meses por situação, com o prazo de embarque no anel de fora'
            : 'Pedidos dos últimos 12 meses por situação'
    });
    svg.append(criarSvg('circle', { class: 'dash-donut__trilha', cx: 21, cy: 21, r: 15.915 }));
    geo.segmentos.forEach(segmento => {
        const circulo = criarSvg('circle', {
            class: 'dash-donut__fatia',
            cx: 21,
            cy: 21,
            r: 15.915,
            'stroke-dasharray': segmento.dasharray,
            'stroke-dashoffset': segmento.dashoffset,
            'data-tom': DASH_TONS_SITUACAO[segmento.situacao] || 'neutro'
        });
        const dica = criarSvg('title');
        const prazo = textoPrazoDaSituacao(prazoDaSituacao(segmento));
        dica.textContent = `${segmento.situacao}: ${pluralizar(segmento.medida, 'pedido', 'pedidos')}`
            + ` (${formatarPercentual(segmento.percentual / 100)})` + (prazo ? `\n${prazo}` : '');
        circulo.append(dica);
        svg.append(circulo);
    });
    arcos.forEach(arco => {
        const circulo = criarSvg('circle', {
            class: 'dash-donut__prazo',
            cx: 21,
            cy: 21,
            r: DASH_RAIO_PRAZO,
            'stroke-dasharray': arco.dasharray,
            'stroke-dashoffset': arco.dashoffset,
            'data-tom': arco.tom
        });
        // Em Produção "em dia" é "ainda não passou da previsão"; em Enviado e
        // Entregue, se o embarque de verdade saiu até ela.
        const rotulo = arco.situacao === 'Produção' ? arco.rotulo : arco.rotuloEmbarcado;
        const dica = criarSvg('title');
        dica.textContent = `${arco.situacao} · ${rotulo}: ${pluralizar(arco.quantidade, 'pedido', 'pedidos')}`;
        circulo.append(dica);
        svg.append(circulo);
    });
    const centro = criarEl('div', 'dash-donut__centro');
    centro.append(
        definirContador(criarEl('strong', 'dash-donut__total'), 'donut-total', geo.total, 'numero'),
        criarEl('span', 'dash-donut__rotulo', geo.total === 1 ? 'pedido' : 'pedidos')
    );
    figura.append(svg, centro);

    const legenda = criarEl('ul', 'dash-legenda');
    geo.segmentos.forEach(segmento => {
        const item = comTom(criarEl('li', 'dash-legenda__item'), DASH_TONS_SITUACAO[segmento.situacao] || 'neutro');
        const texto = criarEl('span', 'dash-legenda__texto');
        texto.append(criarEl('span', 'dash-legenda__nome', segmento.situacao || 'Outros'));
        const valor = numeroOuNulo(segmento.valor);
        if (valor !== null) texto.append(criarEl('span', 'dash-legenda__valor', formatarMoedaCompacta(valor)));
        const prazo = montarPrazoDaLegenda(prazoDaSituacao(segmento));
        if (prazo) texto.append(prazo);
        const numeros = criarEl('span', 'dash-legenda__numeros', formatarNumero(segmento.medida));
        numeros.append(criarEl('small', '', formatarPercentual(segmento.percentual / 100)));
        item.append(criarEl('span', 'dash-legenda__cor'), texto, numeros);
        legenda.append(item);
    });

    const bloco = criarEl('div', 'dash-donut-bloco');
    bloco.append(figura, legenda);
    corpo.replaceChildren(bloco);
}

function desenharFunil(corpo, s) {
    const abertos = quantidadeDe(s?.abertos);
    const emAberto = numeroOuNulo(s?.valorEmAberto);
    const ponderado = numeroOuNulo(s?.valorPonderado);
    const destaques = criarEl('div', 'dash-destaques');
    destaques.append(montarDestaque({
        rotulo: abertos === 1 ? 'Prospecção aberta' : 'Prospecções abertas', id: 'funil-abertos', numero: abertos
    }));
    if (emAberto !== null) {
        destaques.append(montarDestaque({
            rotulo: 'Valor em aberto', id: 'funil-valor', numero: emAberto, tipo: 'compacta', tom: 'ouro', exato: formatarMoeda(emAberto)
        }));
    }
    if (ponderado !== null) {
        destaques.append(montarDestaque({
            rotulo: 'Ponderado pela probabilidade', id: 'funil-ponderado', numero: ponderado, tipo: 'compacta', exato: formatarMoeda(ponderado)
        }));
    }

    const conteudo = [destaques];
    const etapas = listaDe(s?.funil);
    const maximo = Math.max(0, ...etapas.map(etapa => quantidadeDe(etapa?.quantidade)));
    if (abertos === 0 || maximo === 0) {
        conteudo.push(montarVazio('Nenhuma prospecção aberta no momento.', { icone: 'fa-filter', tom: 'neutro' }));
    } else {
        const barras = criarEl('div', 'dash-hbarras dash-hbarras--funil');
        etapas.forEach((etapa, indice) => {
            const quantidade = quantidadeDe(etapa?.quantidade);
            const valor = numeroOuNulo(etapa?.valor);
            const nome = etapa?.etapa || '—';
            barras.append(montarBarraHorizontal({
                rotulo: nome,
                largura: larguraPercentual(quantidade, maximo),
                numero: formatarNumero(quantidade),
                complemento: valor !== null && quantidade > 0 ? formatarMoedaCompacta(valor) : '',
                nivel: Math.min(indice, 4),
                dica: `${nome}: ${pluralizar(quantidade, 'prospecção', 'prospecções')}`
                    + (valor !== null ? ` · ${formatarMoeda(valor)}` : '')
            }));
        });
        conteudo.push(barras);
    }

    // "via prospecção": clientes não tem data de criação, então só dá para
    // contar os que nasceram de uma prospecção convertida neste mês.
    const convertidos = quantidadeDe(s?.convertidosMes);
    conteudo.push(montarRodape(convertidos > 0
        ? `${pluralizar(convertidos, 'cliente novo', 'clientes novos')} via prospecção este mês`
        : 'Nenhum cliente novo via prospecção este mês ainda', 'fa-seedling'));
    corpo.replaceChildren(...conteudo);
}

/**
 * Um pedido da lista de idade: o número (com o símbolo de atenção quando o
 * embarque pede ação), o cliente, a etiqueta de idade e, à direita dela, a de
 * prazo de embarque.
 */
function descreverPedidoEmProducao(pedido) {
    const prazo = etiquetaDeEmbarque(pedido);
    return {
        titulo: pedido?.numero ? String(pedido.numero) : 'Pedido',
        // Cliente null = perfil sem a coluna Cliente de Pedidos; "—" = cadastro
        // sem nome. Nos dois a linha fica só com o número: um "—" solto no
        // lugar do nome não diz nada a ninguém. O prazo NÃO vai no detalhe —
        // sem cliente, a linha continua sem detalhe nenhum.
        detalhe: textoInformado(pedido?.cliente),
        etiquetas: [
            { texto: textoIdade(pedido?.dias), tom: quantidadeDe(pedido?.dias) > 60 ? 'vinho' : 'neutro' },
            prazo
        ],
        alerta: prazo?.alerta || null,
        valor: numeroOuNulo(pedido?.valor) !== null ? formatarMoeda(pedido.valor) : ''
    };
}

/**
 * "+N não listados" que abre a lista INTEIRA no próprio cartão (ele cresce) e
 * vira "mostrar menos" para recolher.
 *  - Os itens além dos cinco primeiros já estão no DOM, com o atributo
 *    `hidden` (a regra `.dashboard-module [hidden]` do CSS vence o Tailwind).
 *  - O estado mora no CORPO do cartão, que persiste entre leituras: o
 *    "Atualizar" recria a lista, e quem abriu continua vendo tudo.
 *  - O ouvinte é do próprio botão, que morre com o redesenho — nada vai para
 *    document/window. `data-sem-guarda`: o botão só mostra e esconde, e a
 *    trava de duplo clique do BotaoAcao engoliria o segundo clique rápido.
 *  - O "+N" conta pelo total em produção: quem nem vem na lista (sem data de
 *    início, ou além do teto do BFF) continua contado e, com a lista aberta,
 *    fica num "+N não listados" ao lado do "mostrar menos".
 */
function montarExpansorDaLista(corpo, { lista, extras, listados, total }) {
    const visiveis = listados - extras.length;
    const foraDaLista = Math.max(0, quantidadeDe(total) - listados);
    const linha = criarEl('p', 'dash-mais');
    const resto = criarEl('span', 'dash-mais__resto');
    resto.title = 'Contam no total, mas não vêm na lista: pedido sem data de aprovação nem de emissão, ou além do limite da lista.';
    const botao = criarEl('button', 'dash-mais__botao');
    botao.type = 'button';
    botao.dataset.semGuarda = 'true';
    botao.setAttribute('aria-controls', lista.id);
    const aplicar = aberta => {
        corpo.__dashIdadeAberta = aberta;
        extras.forEach(item => { item.hidden = !aberta; });
        botao.setAttribute('aria-expanded', aberta ? 'true' : 'false');
        if (aberta) {
            botao.replaceChildren(document.createTextNode('mostrar menos'), criarIcone('fas fa-chevron-up'));
        } else {
            botao.replaceChildren(
                criarEl('strong', '', `+${formatarNumero(Math.max(0, quantidadeDe(total) - visiveis))}`),
                document.createTextNode(' não listados'),
                criarIcone('fas fa-chevron-down')
            );
        }
        resto.hidden = !(aberta && foraDaLista > 0);
        if (resto.hidden) resto.replaceChildren();
        else resto.replaceChildren(criarEl('strong', '', `+${formatarNumero(foraDaLista)}`), document.createTextNode(' não listados'));
    };
    // O botão fica no lugar (só o conteúdo dele muda): quem o acionou pelo
    // teclado não perde o foco.
    botao.addEventListener('click', () => aplicar(corpo.__dashIdadeAberta !== true));
    linha.append(resto, botao);
    aplicar(corpo.__dashIdadeAberta === true);
    return linha;
}

function desenharIdade(corpo, s) {
    const quantidade = quantidadeDe(s?.quantidade);
    if (quantidade === 0) {
        corpo.replaceChildren(montarVazio('Nenhum pedido em produção agora.', { icone: 'fa-industry', tom: 'neutro', grande: true }));
        return;
    }
    const faixas = listaDe(s?.porIdade);
    const maximo = Math.max(0, ...faixas.map(faixa => quantidadeDe(faixa?.quantidade)));
    const barras = criarEl('div', 'dash-hbarras dash-hbarras--idade');
    faixas.forEach((faixa, indice) => {
        const n = quantidadeDe(faixa?.quantidade);
        const rotulo = DASH_FAIXAS_IDADE[faixa?.faixa] || String(faixa?.faixa ?? '—');
        barras.append(montarBarraHorizontal({
            rotulo,
            largura: larguraPercentual(n, maximo),
            numero: formatarNumero(n),
            nivel: Math.min(indice, 3),
            dica: `${rotulo}: ${pluralizar(n, 'pedido', 'pedidos')}`
        }));
    });

    const conteudo = [barras];
    const antigos = listaDe(s?.maisAntigos);
    if (antigos.length) {
        conteudo.push(criarEl('p', 'dash-subtitulo-lista', 'Há mais tempo em produção'));
        // O BFF manda a lista INTEIRA: cinco à vista, o resto escondido atrás
        // do botão que expande o cartão.
        const lista = criarEl('ul', 'dash-lista');
        lista.id = DASH_IDADE_LISTA_ID;
        const itens = antigos.map(pedido => montarItemLista(descreverPedidoEmProducao(pedido)));
        lista.append(...itens);
        conteudo.push(lista);
        const extras = itens.slice(DASH_IDADE_VISIVEIS);
        const mais = extras.length
            ? montarExpansorDaLista(corpo, { lista, extras, listados: itens.length, total: quantidade })
            : montarMais(quantidade, itens.length);
        if (mais) conteudo.push(mais);
    }
    conteudo.push(montarRodape('Idade contada desde a aprovação; o prazo é a previsão de embarque.', 'fa-circle-info'));
    corpo.replaceChildren(...conteudo);
}

function desenharSemPedido(corpo, s) {
    const bloco = s?.aprovadosSemPedido || {};
    const total = quantidadeDe(bloco.quantidade);
    const itens = listaDe(bloco.itens);
    const conteudo = [
        montarContagem({
            id: 'sem-pedido', numero: total,
            legenda: total === 1 ? 'orçamento aprovado sem pedido' : 'orçamentos aprovados sem pedido'
        }),
        // Texto honesto: o painel não distingue conversão que falhou de pedido
        // excluído depois (nos dois o orçamento fica Aprovado sem pedido), e a
        // tela de Orçamentos bloqueia Editar e Converter para Aprovado — mandar
        // "refazer a conversão" era uma instrução impossível.
        criarEl('p', 'dash-dica', `Não há pedido ligado ${total === 1 ? 'a este orçamento aprovado' : 'a estes orçamentos aprovados'}: `
            + 'a conversão falhou ou o pedido foi excluído. Hoje nenhuma tela refaz essa conversão — avise o administrador do sistema.')
    ];
    if (itens.length) {
        conteudo.push(montarLista(itens, item => ({
            titulo: item?.numero ? String(item.numero) : 'Orçamento',
            // null = perfil sem a coluna Cliente de Orçamentos: fica só o número.
            detalhe: textoInformado(item?.destinatario),
            valor: numeroOuNulo(item?.valor) !== null ? formatarMoeda(item.valor) : ''
        })));
    }
    const mais = montarMais(total, itens.length);
    if (mais) conteudo.push(mais);
    corpo.replaceChildren(...conteudo);
}

function desenharVencendo(corpo, s) {
    const bloco = s?.vencendo7d || {};
    const itens = listaDe(bloco.itens);
    const total = numeroOuNulo(bloco.total) ?? itens.length;
    const conteudo = [montarContagem({
        id: 'vencendo', numero: total,
        legenda: total === 1 ? 'orçamento pendente vence em até 7 dias' : 'orçamentos pendentes vencem em até 7 dias'
    })];
    if (!itens.length) {
        conteudo.push(montarVazio('Nenhum orçamento vence nos próximos 7 dias.'));
    } else {
        conteudo.push(montarLista(itens, item => {
            const dias = quantidadeDe(item?.diasRestantes);
            // Dono vazio chega como "—" e, sem a coluna Dono no perfil, como null:
            // sem o filtro a linha dizia "com —" (ou "com null"). O mesmo vale
            // para o destinatário sem a coluna Cliente.
            const dono = textoInformado(item?.dono);
            return {
                titulo: item?.numero ? String(item.numero) : 'Orçamento',
                detalhe: [textoInformado(item?.destinatario), dono ? `com ${dono}` : ''].filter(Boolean).join(' · '),
                etiqueta: { texto: textoPrazo(dias), tom: dias <= 1 ? 'vermelho' : dias <= 3 ? 'ouro' : 'neutro' },
                valor: numeroOuNulo(item?.valor) !== null ? formatarMoeda(item.valor) : '',
                dica: item?.validade ? `Validade: ${formatarDataCurta(item.validade)}` : ''
            };
        }));
        const mais = montarMais(total, itens.length);
        if (mais) conteudo.push(mais);
    }
    corpo.replaceChildren(...conteudo);
}

function desenharFollowups(corpo, s) {
    const f = s?.followups || {};
    const atrasados = quantidadeDe(f.atrasados);
    const hoje = quantidadeDe(f.hoje);
    const proximos = quantidadeDe(f.proximos7);
    const itens = listaDe(f.itens);
    const urgentes = atrasados + hoje;

    const chips = criarEl('div', 'dash-chips');
    chips.append(
        montarChip(`${formatarNumero(atrasados)} ${atrasados === 1 ? 'atrasado' : 'atrasados'}`, atrasados > 0 ? 'vermelho' : 'neutro'),
        montarChip(`${formatarNumero(hoje)} para hoje`, hoje > 0 ? 'ouro' : 'neutro'),
        montarChip(`${formatarNumero(proximos)} nos próximos 7 dias`, proximos > 0 ? 'azul' : 'neutro')
    );
    const conteudo = [
        montarContagem({ id: 'followups', numero: urgentes, legenda: urgentes === 1 ? 'follow-up atrasado ou para hoje' : 'follow-ups atrasados ou para hoje' }),
        chips
    ];
    if (!itens.length) {
        conteudo.push(montarVazio('Nenhum follow-up atrasado ou para hoje.'));
    } else {
        conteudo.push(montarLista(itens, item => {
            const dias = quantidadeDe(item?.dias);
            return {
                // Nome e próximo passo vêm null sem as colunas de Prospecções no
                // perfil: título genérico e detalhe só com a etapa.
                titulo: textoInformado(item?.nome) || 'Prospecção',
                detalhe: [item?.etapa, textoInformado(item?.proximoPasso)].filter(Boolean).join(' · '),
                etiqueta: { texto: textoFollowup(dias), tom: dias < 0 ? 'vermelho' : 'ouro' },
                dica: item?.data ? `Próximo passo em ${formatarDataCurta(item.data)}` : ''
            };
        }));
        const mais = montarMais(urgentes, itens.length);
        if (mais) conteudo.push(mais);
    }
    corpo.replaceChildren(...conteudo);
}

function desenharEstoque(corpo, s) {
    const negativos = s?.negativos || {};
    const total = quantidadeDe(negativos.quantidade);
    const itens = listaDe(negativos.itens);
    const zerados = quantidadeDe(s?.zerados);
    const criticos = quantidadeDe(s?.criticos);
    const limite = numeroOuNulo(s?.limiteCritico) ?? 10;
    const valorEstoque = numeroOuNulo(s?.valorEstoque);

    const conteudo = [montarContagem({
        id: 'estoque-negativo', numero: total,
        legenda: total === 1 ? 'insumo com saldo negativo' : 'insumos com saldo negativo'
    })];
    if (!itens.length) {
        conteudo.push(montarVazio('Nenhum insumo com saldo negativo.'));
    } else {
        // Cada saldo com a SUA unidade: somar litro com metro não significa nada.
        conteudo.push(montarLista(itens, item => ({
            titulo: textoInformado(item?.nome) || 'Insumo',
            detalhe: item?.processo || '',
            etiqueta: { texto: formatarQuantidade(item?.quantidade, item?.unidade), tom: 'vermelho' }
        })));
        const mais = montarMais(total, itens.length);
        if (mais) conteudo.push(mais);
    }
    const chips = criarEl('div', 'dash-chips');
    chips.append(
        montarChip(`${formatarNumero(zerados)} ${zerados === 1 ? 'zerado' : 'zerados'}`, zerados > 0 ? 'ouro' : 'neutro'),
        // Limite fixo do app: não existe estoque mínimo por insumo no banco.
        montarChip(`${formatarNumero(criticos)} abaixo de ${formatarNumero(limite)} (limite fixo)`, criticos > 0 ? 'ouro' : 'neutro')
    );
    conteudo.push(chips);
    if (valorEstoque !== null) {
        conteudo.push(montarRodape(`Saldo positivo avaliado em ${formatarMoedaCompacta(valorEstoque)} pelo último preço de compra.`, 'fa-coins'));
    }
    corpo.replaceChildren(...conteudo);
}

function desenharIa(corpo, s) {
    const total = quantidadeDe(s?.emRevisao);
    corpo.replaceChildren(
        montarContagem({ id: 'ia', numero: total, legenda: total === 1 ? 'leitura aguardando revisão' : 'leituras aguardando revisão' }),
        criarEl('p', 'dash-dica', 'Os dados extraídos só entram no sistema depois de revisados no módulo de IA.')
    );
}

function desenharAprovacao(corpo, s) {
    const d = s?.decisao90d || {};
    const aprovados = quantidadeDe(d.aprovados);
    const rejeitados = quantidadeDe(d.rejeitados);
    const expirados = quantidadeDe(d.expirados);
    const decididos = quantidadeDe(d.decididos);
    const rascunhos = quantidadeDe(s?.rascunhos?.quantidade);
    const conteudo = [];
    if (decididos === 0) {
        conteudo.push(montarVazio('Nenhum orçamento aprovado, rejeitado ou expirado nos últimos 90 dias.', { icone: 'fa-scale-balanced', tom: 'neutro' }));
    } else {
        // Taxa sobre os DECIDIDOS: dividir por todos (com rascunho e pendente,
        // como em Relatórios) derruba a taxa sem ninguém ter recusado nada.
        conteudo.push(
            montarContagem({
                id: 'aprovacao', numero: numeroOuNulo(d.taxaAprovacao), tipo: 'percentual',
                legenda: `aprovados de ${pluralizar(decididos, 'orçamento decidido', 'orçamentos decididos')}`
            }),
            montarBarraEmpilhada([
                { rotulo: 'Aprovados', valor: aprovados, tom: 'verde' },
                { rotulo: 'Rejeitados', valor: rejeitados, tom: 'vermelho' },
                { rotulo: 'Expirados', valor: expirados, tom: 'neutro' }
            ], `${aprovados} aprovados, ${rejeitados} rejeitados, ${expirados} expirados`)
        );
        const chips = criarEl('div', 'dash-chips');
        chips.append(
            montarChip(`${formatarNumero(aprovados)} ${aprovados === 1 ? 'aprovado' : 'aprovados'}`, 'verde'),
            montarChip(`${formatarNumero(rejeitados)} ${rejeitados === 1 ? 'rejeitado' : 'rejeitados'}`, rejeitados > 0 ? 'vermelho' : 'neutro'),
            montarChip(`${formatarNumero(expirados)} ${expirados === 1 ? 'expirado' : 'expirados'}`, 'neutro')
        );
        conteudo.push(chips);
    }
    if (rascunhos > 0) {
        conteudo.push(montarRodape(`${pluralizar(rascunhos, 'rascunho', 'rascunhos')} ainda não ${rascunhos === 1 ? 'enviado' : 'enviados'} ao cliente`, 'fa-pen-to-square'));
    }
    corpo.replaceChildren(...conteudo);
}

function desenharClientes(corpo, s) {
    const ativos = quantidadeDe(s?.ativos);
    const total = quantidadeDe(s?.total);
    if (total === 0) {
        corpo.replaceChildren(montarVazio('Nenhum cliente cadastrado ainda.', { icone: 'fa-users', tom: 'neutro' }));
        return;
    }
    corpo.replaceChildren(
        montarContagem({ id: 'clientes', numero: ativos, legenda: `de ${pluralizar(total, 'cliente cadastrado', 'clientes cadastrados')} estão ativos` }),
        montarBarraEmpilhada([
            { rotulo: 'Ativos', valor: ativos, tom: 'verde' },
            { rotulo: 'Demais', valor: Math.max(0, total - ativos), tom: 'neutro' }
        ], `${ativos} ativos de ${total} clientes`)
    );
}

// ---------------------------------------------------------------------------
// Tooltip do gráfico
// ---------------------------------------------------------------------------

// `dash-balao` e não `dash-dica`: `.dash-dica` já é o parágrafo de dica dos
// cartões (aprovados sem pedido, IA), e com o mesmo nome as regras da caixa
// (visibility: hidden, position: fixed) apagavam aquele texto.
const DASH_DICA_ID = 'dash-balao-grafico';

/**
 * A caixa do tooltip: UMA por gráfico (e há um gráfico por módulo), criada na
 * primeira abertura e reaproveitada por todas as barras e releituras. Mora no
 * corpo do cartão, que persiste entre leituras — é o que o código de qualquer
 * execução do script enxerga em comum.
 */
function obterDica(corpo) {
    if (!corpo.__dashDica) {
        const caixa = criarEl('div', 'dash-balao');
        // id fixo: o Popover apaga outra caixa com o mesmo id que tenha sobrado
        // no <body>, então nunca há duas na tela.
        caixa.id = DASH_DICA_ID;
        caixa.setAttribute('role', 'tooltip');
        corpo.__dashDica = { caixa, alvo: null };
    }
    return corpo.__dashDica;
}

/** Aberta para ESTA barra? `.show` manda: o Popover a tira sozinho (Escape, rolagem, clique fora). */
function dicaAbertaEm(corpo, alvo) {
    const dica = corpo?.__dashDica;
    return Boolean(dica && dica.alvo === alvo && dica.caixa.classList.contains('show'));
}

function montarConteudoDica(caixa, conteudo) {
    caixa.dataset.serie = conteudo.serie;
    const filhos = [
        criarEl('p', 'dash-balao__titulo', conteudo.titulo),
        criarEl('p', 'dash-balao__resumo', conteudo.resumo)
    ];
    if (conteudo.itens.length) {
        const lista = criarEl('ul', 'dash-balao__lista');
        conteudo.itens.forEach(item => {
            const linha = criarEl('li', `dash-balao__item${item.estimada ? ' dash-balao__item--estimada' : ''}`);
            linha.append(criarEl('span', 'dash-balao__nome', item.nome));
            if (item.valor) linha.append(criarEl('span', 'dash-balao__valor', item.valor));
            if (item.detalhe) linha.append(criarEl('span', 'dash-balao__detalhe', item.detalhe));
            lista.append(linha);
        });
        filhos.push(lista);
    }
    // O que saiu no mês: a bolinha tem a cor da barra pendurada (vermelho, roxo).
    const saidas = listaDe(conteudo.saidas);
    if (saidas.length) {
        const lista = criarEl('ul', 'dash-balao__lista dash-balao__saidas');
        saidas.forEach(saida => {
            const linha = criarEl('li', `dash-balao__item dash-balao__item--saida dash-balao__item--${saida.tipo}`);
            linha.append(criarEl('span', 'dash-balao__nome', saida.nome));
            if (saida.valor) linha.append(criarEl('span', 'dash-balao__valor', saida.valor));
            if (saida.detalhe) linha.append(criarEl('span', 'dash-balao__detalhe', saida.detalhe));
            lista.append(linha);
        });
        filhos.push(lista);
    }
    if (conteudo.rodape) filhos.push(criarEl('p', 'dash-balao__rodape', conteudo.rodape));
    caixa.replaceChildren(...filhos);
}

/**
 * Abre a caixa pela barra `alvo`, ancorada na coluna. Quem posiciona é o
 * window.Popover (src/js/utils/popover.js, carregado pelo menu.html): ele move
 * a caixa para o <body> — o cartão tem overflow: hidden e backdrop-filter, que
 * cortariam ou deslocariam um `position: fixed` aqui dentro —, a encaixa na
 * janela e a fecha com Escape, rolagem, redimensionamento, clique fora e troca
 * de módulo. Tudo com os ouvintes DELE, registrados uma vez: este script é
 * reexecutado a cada visita e não pode pendurar nada em document/window.
 * Sem o Popover a barra fica só com o aria-label.
 */
function abrirDica(corpo, alvo, ancora, conteudo) {
    const popover = typeof window !== 'undefined' ? window.Popover : null;
    if (!popover || typeof popover.abrir !== 'function') return;
    const dica = obterDica(corpo);
    if (dica.alvo && dica.alvo !== alvo) dica.alvo.removeAttribute('aria-describedby');
    montarConteudoDica(dica.caixa, conteudo);
    dica.alvo = alvo;
    // A lista de pedidos chega também ao leitor de tela, não só o resumo.
    alvo.setAttribute('aria-describedby', DASH_DICA_ID);
    popover.abrir(dica.caixa, ancora);
}

/**
 * Fecha a caixa. Com `alvo`, só se ela for dessa barra: o blur ou a saída do
 * mouse de uma barra antiga não pode fechar a caixa que outra acabou de abrir.
 */
function fecharDica(corpo, alvo) {
    const dica = corpo?.__dashDica;
    if (!dica || (alvo && dica.alvo !== alvo)) return;
    if (dica.alvo) dica.alvo.removeAttribute('aria-describedby');
    dica.alvo = null;
    const popover = typeof window !== 'undefined' ? window.Popover : null;
    if (popover && typeof popover.fechar === 'function') popover.fechar(dica.caixa);
    else dica.caixa.classList.remove('show');
}

/**
 * Foco que veio do teclado. Toque e clique também focam a barra: se esse foco
 * abrisse a caixa, o clique logo em seguida a fecharia e o toque não mostraria
 * nada. `:focus-visible` é a regra do próprio navegador para foco de teclado.
 */
function focoPorTeclado(alvo) {
    try {
        return typeof alvo.matches !== 'function' || alvo.matches(':focus-visible');
    } catch (_) {
        return true;
    }
}

/**
 * Liga a barra ao tooltip, com ouvintes no PRÓPRIO elemento — que morre a cada
 * redesenho, então nada acumula entre leituras nem entre navegações.
 *  - mouse: entrar abre, sair fecha (o toque também "entra", mas não tem como
 *    sair: fica de fora aqui);
 *  - teclado: o foco abre; o blur e o Escape fecham;
 *  - toque ou clique: alterna.
 */
function ligarDica(corpo, alvo, ancora, conteudo) {
    const abrir = () => abrirDica(corpo, alvo, ancora, conteudo);
    const fechar = () => fecharDica(corpo, alvo);
    const doMouse = evento => !evento?.pointerType || evento.pointerType === 'mouse';
    alvo.addEventListener('pointerenter', evento => { if (doMouse(evento)) abrir(); });
    alvo.addEventListener('pointerleave', evento => { if (doMouse(evento)) fechar(); });
    alvo.addEventListener('focus', () => { if (focoPorTeclado(alvo)) abrir(); });
    alvo.addEventListener('blur', fechar);
    alvo.addEventListener('click', () => (dicaAbertaEm(corpo, alvo) ? fechar() : abrir()));
    alvo.addEventListener('keydown', evento => { if (evento.key === 'Escape') fechar(); });
}

// ---------------------------------------------------------------------------
// Tamanho e animação
// ---------------------------------------------------------------------------

/**
 * Observa a largura do corpo do gráfico (o elemento persiste entre leituras,
 * então é observado uma vez só). Não é polling: o navegador avisa quando o
 * tamanho muda — janela redimensionada, barra lateral recolhida.
 */
function observarLargura(alvo, aoMudar) {
    if (typeof ResizeObserver !== 'function' || alvo.__dashObservador) return;
    let agendado = false;
    const observador = new ResizeObserver(() => {
        if (agendado) return;
        agendado = true;
        requestAnimationFrame(() => {
            agendado = false;
            if (!alvo.isConnected) {
                observador.disconnect();
                return;
            }
            if (alvo.clientWidth > 0) aoMudar();
        });
    });
    observador.observe(alvo);
    alvo.__dashObservador = observador;
}

function prefereMenosMovimento() {
    try {
        return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
        return false;
    }
}

/**
 * Chama `fn` quando a máscara de carregamento do menu sair. Enquanto ela está
 * de pé o módulo fica invisível (`module-loading-content`): uma contagem que
 * rodasse ali terminaria antes de alguém ver.
 */
function aoRevelar(moduleEl, fn) {
    if (!moduleEl.classList.contains('module-loading-content') || typeof MutationObserver !== 'function') {
        fn();
        return;
    }
    const observador = new MutationObserver(() => {
        if (moduleEl.classList.contains('module-loading-content')) return;
        observador.disconnect();
        fn();
    });
    observador.observe(moduleEl, { attributes: true, attributeFilter: ['class'] });
}

/**
 * Conta do valor anterior (zero na primeira leitura) até o novo. Um único laço
 * de requestAnimationFrame que termina sozinho em 0,7 s — nada de setInterval,
 * que deixaria a tela "ocupada" para o menu.
 */
function animarContadores(moduleEl) {
    const estado = estadoDoModulo(moduleEl);
    const trechos = Array.from(moduleEl.querySelectorAll('[data-dash-contar]'))
        .map(no => {
            const alvo = Number(no.dataset.dashAlvo);
            const id = no.dataset.dashId;
            const de = estado.valores.has(id) ? estado.valores.get(id) : 0;
            estado.valores.set(id, alvo);
            return { no, de, alvo, tipo: no.dataset.dashContar };
        })
        .filter(trecho => Number.isFinite(trecho.alvo) && trecho.de !== trecho.alvo);
    if (!trechos.length || prefereMenosMovimento() || typeof requestAnimationFrame !== 'function') return;
    aoRevelar(moduleEl, () => {
        const inicio = performance.now();
        const duracao = 700;
        const quadro = agora => {
            // O carimbo do rAF é o INÍCIO do quadro e pode ser anterior a
            // `inicio`: com t negativo o primeiro quadro mostrava valor abaixo
            // de zero ("−R$ 2.535") antes de a contagem começar.
            const t = Math.max(0, Math.min(1, (agora - inicio) / duracao));
            const suave = 1 - Math.pow(1 - t, 3);
            trechos.forEach(({ no, de, alvo, tipo }) => {
                no.textContent = formatarPorTipo(t >= 1 ? alvo : de + (alvo - de) * suave, tipo);
            });
            if (t < 1) requestAnimationFrame(quadro);
        };
        requestAnimationFrame(quadro);
    });
}

// ---------------------------------------------------------------------------
// Dados e estado do módulo
// ---------------------------------------------------------------------------

function estadoDoModulo(moduleEl) {
    if (!moduleEl.__dash) {
        moduleEl.__dash = { sequencia: 0, emVoo: null, dados: null, valores: new Map() };
    }
    return moduleEl.__dash;
}

function mensagemDeErro(erro) {
    return erro?.message || 'Erro desconhecido.';
}

/** GET /api/dashboard. O BFF injeta o token — nenhum header de autenticação aqui. */
async function buscarResumoDashboard({ atualizar = false } = {}) {
    let base;
    try {
        base = await window.apiConfig.getApiBaseUrl();
    } catch (_) {
        throw new Error('Não foi possível descobrir o endereço do servidor local.');
    }
    const controle = typeof AbortController === 'function' ? new AbortController() : null;
    const limite = controle ? setTimeout(() => controle.abort(), DASH_TEMPO_LIMITE_MS) : null;
    try {
        let resposta;
        try {
            // `no-store`: "Atualizar" tem de chegar ao BFF, nunca parar num cache do navegador.
            resposta = await fetch(`${base}/api/dashboard${atualizar ? '?atualizar=1' : ''}`, {
                cache: 'no-store',
                signal: controle ? controle.signal : undefined
            });
        } catch (erro) {
            // `fetch` rejeita com TypeError ("Failed to fetch") quando não há
            // resposta e com AbortError no tempo-limite — textos em inglês que não
            // dizem nada a quem está na tela. Traduzido AQUI, e não no catch
            // geral, para um erro de outro ponto não virar "servidor não respondeu".
            throw new Error(erro?.name === 'AbortError'
                ? 'O painel demorou demais para responder.'
                : 'O servidor local não respondeu. Verifique a conexão.');
        }
        let corpo = null;
        try {
            corpo = await resposta.json();
        } catch (erro) {
            // O teto de 30 s também corta a leitura do CORPO (o fetch já
            // resolveu com o cabeçalho): engolido aqui, virava "formato
            // inesperado" ou "erro (500)" em vez da mensagem de demora.
            if (erro?.name === 'AbortError') throw new Error('O painel demorou demais para responder.');
            corpo = null;
        }
        // 503 = o BFF não conseguiu identificar o usuário (sessão vencida,
        // upstream fora). Cai aqui como erro, com "Tentar novamente" — nunca
        // como "sem permissão", que mandaria procurar o administrador à toa.
        if (!resposta.ok) throw new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
        if (!corpo || typeof corpo !== 'object' || !corpo.secoes || typeof corpo.secoes !== 'object') {
            throw new Error('A resposta do painel veio num formato inesperado.');
        }
        if (!corpo.falhas || typeof corpo.falhas !== 'object') corpo.falhas = {};
        return corpo;
    } finally {
        if (limite) clearTimeout(limite);
    }
}

function marcarCarregando(moduleEl, ativo) {
    moduleEl.classList.toggle('dash-atualizando', ativo);
    const painel = moduleEl.querySelector('[data-dash-painel]');
    if (painel) painel.setAttribute('aria-busy', ativo ? 'true' : 'false');
}

/**
 * Carrega e desenha. Uma leitura comum já em curso é reaproveitada (a segunda
 * chamada não vira segunda requisição); "Atualizar" sempre sai, porque é o
 * usuário pedindo dado novo. Só a resposta MAIS RECENTE desenha: uma lenta que
 * chegasse depois sobrescreveria a nova. A promessa nunca rejeita — é ela que
 * o menu aguarda para tirar a máscara.
 */
function carregarDashboard(moduleEl, { atualizar = false } = {}) {
    const estado = estadoDoModulo(moduleEl);
    if (!atualizar && estado.emVoo) return estado.emVoo;
    const minhaVez = ++estado.sequencia;
    marcarCarregando(moduleEl, true);
    const promessa = buscarResumoDashboard({ atualizar })
        .then(dados => {
            if (minhaVez !== estado.sequencia) return;
            estado.dados = dados;
            esconderAviso(moduleEl);
            renderizarDashboard(moduleEl, dados);
        })
        .catch(erro => {
            if (minhaVez !== estado.sequencia) return;
            console.error('[dashboard] não foi possível carregar o painel:', erro);
            const mensagem = mensagemDeErro(erro);
            // Com números na tela, a falha de uma atualização não apaga o que
            // estava certo: avisa no topo e mantém a última leitura boa.
            if (estado.dados) mostrarAviso(moduleEl, mensagem, estado.dados.geradoEm);
            else mostrarEstadoGeral(moduleEl, 'erro', mensagem);
        })
        .finally(() => {
            if (minhaVez === estado.sequencia) marcarCarregando(moduleEl, false);
            if (estado.emVoo === promessa) estado.emVoo = null;
        });
    estado.emVoo = promessa;
    return promessa;
}

// ---------------------------------------------------------------------------
// Pintura da tela
// ---------------------------------------------------------------------------

function renderizarDashboard(moduleEl, dados) {
    // Sem nenhuma seção montada (tudo em falhas, ou perfil sem indicador) o BFF
    // não leu tabela nenhuma e `geradoEm` é só a hora da resposta: "Atualizado
    // às <agora>" ao lado de cartões de erro seria mentira. Mesma convenção do
    // estado de erro.
    if (Object.keys(dados.secoes || {}).length) {
        atualizarSelo(moduleEl, dados.geradoEm);
    } else {
        const selo = moduleEl.querySelector('[data-dash-atualizado]');
        if (selo) selo.textContent = 'Sem leitura';
    }
    moduleEl.querySelectorAll('[data-dash-cartao]').forEach(cartao => desenharCartao(cartao, dados));
    ajustarLinhas(moduleEl);
    mostrarEstadoGeral(moduleEl, estadoGeral(dados));
    animarContadores(moduleEl);
}

/** Troca título e subtítulo do cartão (os elementos `data-dash-titulo` e `data-dash-subtitulo`). */
function aplicarTitulos(cartao, titulos) {
    if (!titulos || typeof cartao.querySelector !== 'function') return;
    const titulo = cartao.querySelector('[data-dash-titulo]');
    if (titulo && titulos.titulo) titulo.textContent = titulos.titulo;
    const subtitulo = cartao.querySelector('[data-dash-subtitulo]');
    if (subtitulo && titulos.subtitulo) subtitulo.textContent = titulos.subtitulo;
}

function desenharCartao(cartao, dados) {
    const chave = cartao.dataset.dashCartao;
    const definicao = DASH_CARTOES[chave];
    const estado = definicao ? estadoDoCartao(dados, chave) : 'oculto';
    const corpo = cartao.querySelector('[data-dash-corpo]');
    cartao.hidden = estado === 'oculto';
    cartao.dataset.estado = estado;
    cartao.removeAttribute('aria-busy');
    if (!corpo) return;
    // O conteúdo vai ser trocado: a caixa do tooltip aberta ficaria apontando
    // para uma barra que não existe mais.
    fecharDica(corpo);
    if (estado === 'oculto') {
        corpo.replaceChildren();
        return;
    }
    // Também em falha: o erro sai debaixo do título certo para o perfil.
    if (typeof definicao.titulos === 'function') aplicarTitulos(cartao, definicao.titulos(dados));
    if (estado === 'falha') {
        // Cartão de mais de uma seção: a mensagem é a da seção que falhou.
        const secaoComFalha = secoesDoCartao(definicao).find(secao => estadoDaSecao(dados, secao) === 'falha');
        const mensagem = dados.falhas[secaoComFalha];
        corpo.replaceChildren(montarErroDoCartao(typeof mensagem === 'string' ? mensagem : ''));
        return;
    }
    try {
        definicao.desenhar(corpo, dados.secoes[definicao.secao], dados);
    } catch (erro) {
        // Um bloco com formato inesperado derruba só o próprio cartão.
        console.error(`[dashboard] falha ao desenhar o cartão "${chave}":`, erro);
        cartao.dataset.estado = 'falha';
        corpo.replaceChildren(montarErroDoCartao('Os dados deste indicador vieram num formato inesperado.'));
    }
}

/**
 * Linha sem cartão visível some; a contagem de visíveis vai para o CSS, que
 * dá a linha inteira a quem ficou sozinho (senão o gráfico ficaria preso em
 * 2/3 da largura com um buraco ao lado).
 */
function ajustarLinhas(moduleEl) {
    moduleEl.querySelectorAll('[data-dash-linha]').forEach(linha => {
        const visiveis = Array.from(linha.querySelectorAll('[data-dash-cartao]')).filter(cartao => !cartao.hidden).length;
        linha.hidden = visiveis === 0;
        linha.dataset.visiveis = String(visiveis);
    });
}

function atualizarSelo(moduleEl, geradoEm) {
    const alvo = moduleEl.querySelector('[data-dash-atualizado]');
    if (!alvo) return;
    // `geradoEm` é a leitura MAIS ANTIGA entre as tabelas (pode vir do cache
    // do BFF): usar a hora da resposta faria o selo mentir.
    const hora = horaAtualizacao(geradoEm);
    alvo.textContent = hora ? `Atualizado às ${hora}` : 'Horário da leitura indisponível';
}

const DASH_ESTADOS_GERAIS = {
    'sem-permissao': {
        icone: 'fa-user-lock',
        tom: 'neutro',
        titulo: 'Seu perfil ainda não tem indicadores liberados',
        texto: 'Os números aparecem aqui conforme o administrador libera Pedidos, Orçamentos, Prospecções, Clientes ou Estoque para o seu perfil.'
    },
    'tudo-em-dia': {
        icone: 'fa-circle-check',
        tom: 'verde',
        titulo: 'Tudo em dia por aqui',
        texto: 'Nenhum dos indicadores liberados para o seu perfil precisa de atenção agora.'
    },
    'erro': {
        icone: 'fa-triangle-exclamation',
        tom: 'vermelho',
        titulo: 'Não foi possível carregar o painel',
        texto: 'Verifique a conexão e tente de novo.',
        acao: true
    }
};

function mostrarEstadoGeral(moduleEl, tipo, detalhe) {
    const caixa = moduleEl.querySelector('[data-dash-estado-geral]');
    const painel = moduleEl.querySelector('[data-dash-painel]');
    if (!caixa || !painel) return;
    const definicao = DASH_ESTADOS_GERAIS[tipo];
    if (!definicao) {
        caixa.hidden = true;
        caixa.replaceChildren();
        painel.hidden = false;
        return;
    }
    painel.hidden = true;
    const icone = comTom(criarEl('span', 'dash-estado-geral__icone'), definicao.tom);
    icone.append(criarIcone(`fas ${definicao.icone}`));
    const filhos = [
        icone,
        criarEl('h2', 'dash-estado-geral__titulo', definicao.titulo),
        criarEl('p', 'dash-estado-geral__texto', definicao.texto)
    ];
    if (detalhe) filhos.push(criarEl('p', 'dash-estado-geral__detalhe', detalhe));
    if (definicao.acao) filhos.push(montarBotaoAtualizar('Tentar novamente'));
    caixa.replaceChildren(...filhos);
    caixa.hidden = false;
    if (tipo === 'erro') {
        const selo = moduleEl.querySelector('[data-dash-atualizado]');
        if (selo) selo.textContent = 'Sem leitura';
    }
}

function mostrarAviso(moduleEl, mensagem, geradoEm) {
    const aviso = moduleEl.querySelector('[data-dash-aviso]');
    if (!aviso) return;
    const hora = horaAtualizacao(geradoEm);
    const texto = criarEl('p', 'dash-aviso__texto');
    texto.append(
        criarEl('strong', '', 'Não foi possível atualizar agora.'),
        document.createTextNode(` ${mensagem}${hora ? ` Mostrando a leitura das ${hora}.` : ''}`)
    );
    aviso.replaceChildren(criarIcone('fas fa-triangle-exclamation dash-aviso__icone'), texto, montarBotaoAtualizar('Tentar de novo'));
    aviso.hidden = false;
}

function esconderAviso(moduleEl) {
    const aviso = moduleEl.querySelector('[data-dash-aviso]');
    if (!aviso) return;
    aviso.hidden = true;
    aviso.replaceChildren();
}

// ---------------------------------------------------------------------------
// Ações e ciclo de vida
// ---------------------------------------------------------------------------

/**
 * Anti-duplo-clique pelo utilitário global (src/utils/botaoAcao.js, carregado
 * pelo menu.html), com a mesma trava feita à mão se ele faltar.
 */
function executarComBotao(botao, acao) {
    if (window.BotaoAcao && typeof window.BotaoAcao.run === 'function') {
        return window.BotaoAcao.run(botao, acao);
    }
    if (botao.dataset.dashOcupado === '1') return undefined;
    botao.dataset.dashOcupado = '1';
    return Promise.resolve().then(acao).finally(() => {
        delete botao.dataset.dashOcupado;
    });
}

/**
 * Um listener no PRÓPRIO elemento do módulo (morre com ele) atende o
 * "Atualizar" do cabeçalho e os que nascem nos cartões com erro.
 */
function ligarAcoes(moduleEl) {
    moduleEl.addEventListener('click', evento => {
        const alvo = evento.target;
        const botao = alvo && typeof alvo.closest === 'function' ? alvo.closest('[data-dash-acao="atualizar"]') : null;
        if (!botao || !moduleEl.contains(botao)) return;
        evento.preventDefault();
        executarComBotao(botao, () => carregarDashboard(moduleEl, { atualizar: true }));
    });
}

function localizarModuloDashboard() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
    return document.querySelector('#content .dashboard-module');
}

/**
 * Idempotente por elemento. `moduleReadyPromise` é a primeira carga: menu.js
 * espera por ela antes de tirar a máscara, e a tela nasce pronta em vez de
 * montar os cartões na frente do usuário.
 */
/** "Meu dia" (tarefas de hoje, atrasadas, feitas e convites): clicar abre Tarefas no filtro. */
function montarMeuDia(moduleEl) {
    if (typeof window === 'undefined' || !window.TarefasUI?.montarMeuDia || typeof moduleEl?.querySelector !== 'function') return;
    const alvo = moduleEl.querySelector('[data-dash-meudia]');
    if (!alvo) return;
    window.TarefasUI.montarMeuDia(alvo, {
        aoClicar: filtro => {
            window.tarefasPedido = { filtro: ['hoje', 'atrasadas', 'concluidas', 'convites'].includes(filtro) ? filtro : 'hoje' };
            window.loadPage?.('tarefas');
        }
    });
}

function iniciarDashboard(moduleEl, { aguardarAvisoDoMenu = true } = {}) {
    if (!moduleEl || !moduleEl.dataset) return null;
    if (moduleEl.dataset.iniciado === '1') return moduleEl.moduleReadyPromise || null;
    moduleEl.dataset.iniciado = '1';
    // O menu dispara 'module-change' ao terminar ESTA mesma carga (o finally
    // do loadPage). Esse primeiro aviso não é pedido de ninguém e não pode
    // virar uma segunda requisição.
    if (aguardarAvisoDoMenu) moduleEl.dataset.aguardaAvisoDoMenu = '1';
    ligarAcoes(moduleEl);
    montarMeuDia(moduleEl);
    moduleEl.moduleReadyPromise = carregarDashboard(moduleEl, { atualizar: false });
    return moduleEl.moduleReadyPromise;
}

/**
 * 'module-change' do Dashboard:
 *  - máscara do menu ainda de pé → clique no meio da carga; no máximo inicia;
 *  - primeiro aviso depois da injeção → é o próprio carregador; ignora;
 *  - elemento ainda não iniciado → inicia (o script rodou sem achá-lo);
 *  - clique em "Dashboard" estando nele → o menu não recarrega o módulo, só
 *    avisa: relê os dados SEM `atualizar=1` (o cache de 60 s do BFF segura).
 */
function tratarMudancaDeModulo(evento) {
    if (evento?.detail?.page !== DASH_PAGINA) return;
    const moduleEl = localizarModuloDashboard();
    if (!moduleEl) return;
    // Com a máscara de pé (menu.js põe a classe antes de montar o módulo e só
    // tira logo antes do aviso do finally) o aviso vem de um clique na barra
    // lateral, que o loadPage despacha na hora. Se ele consumisse a guarda, o
    // aviso final virava 2ª leitura: cartões esmaecidos na revelação e a
    // contagem animada perdida. A 1ª carga já está em voo ou acabou há menos
    // de ~1 s, então ignorar o clique não perde dado; só inicia se o script
    // ainda não rodou — e aí com a guarda armada, para o aviso final.
    if (moduleEl.classList.contains('module-loading-content')) {
        if (moduleEl.dataset.iniciado !== '1') iniciarDashboard(moduleEl);
        return;
    }
    if (moduleEl.dataset.iniciado !== '1') {
        iniciarDashboard(moduleEl, { aguardarAvisoDoMenu: false });
        return;
    }
    if (moduleEl.dataset.aguardaAvisoDoMenu === '1') {
        delete moduleEl.dataset.aguardaAvisoDoMenu;
        return;
    }
    carregarDashboard(moduleEl, { atualizar: false });
}

if (typeof window !== 'undefined' && !window.__dashboardOuvintes) {
    window.__dashboardOuvintes = true;
    document.addEventListener('module-change', tratarMudancaDeModulo);
}

iniciarDashboard(localizarModuloDashboard());
