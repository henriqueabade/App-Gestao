/**
 * Revisão dos filtros e das funções dos Relatórios (pedido do dono, 08/10/2026).
 *
 * O que estava com falha e foi corrigido em src/js/relatorios.js:
 *   - Pedidos e Orçamentos: "Cliente" comparava com um campo que a lista não
 *     tem (a tabela esvaziava); "Dono" e "Período" não eram lidos por filtro
 *     nenhum; status e condição comparavam por "contém";
 *   - Prospecções: Estado e as datas de criação não estavam ligados, e o
 *     Filtrar/Limpar não faziam nada;
 *   - a coluna Data mostrava o dia anterior (DATE lido com fuso);
 *   - Master-Detail: o card marcado ia para o topo da lista;
 *   - "Carregar Modelo" listava modelos de mentira e "Salvar" não salvava.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARQUIVO = path.join(__dirname, '..', 'relatorios.js');
const FONTE = fs.readFileSync(ARQUIVO, 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'html', 'relatorios.html'), 'utf8');

function carregar(janelaExtra = {}) {
    const guardados = new Map();
    const contexto = {
        window: {
            apiConfig: { getApiBaseUrl: async () => '' },
            localStorage: {
                getItem: c => (guardados.has(c) ? guardados.get(c) : null),
                setItem: (c, v) => guardados.set(c, v),
                removeItem: c => guardados.delete(c)
            },
            Permissoes: { pode: () => true },
            ...janelaExtra
        },
        document: {
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: () => {},
            readyState: 'complete'
        },
        console: { log() {}, warn() {}, error() {}, info() {} },
        Intl,
        setTimeout,
        fetch: () => {}
    };
    contexto.globalThis = contexto;
    contexto.self = contexto;
    vm.createContext(contexto);
    vm.runInContext(FONTE, contexto);
    return expressao => vm.runInContext(expressao, contexto);
}

const PEDIDOS = [
    { id: 1, numero: 'PED1', cliente_nome: 'Loja Central', dono: 'Henrique', situacao: 'Produção', parcelas: 1, valor_final: 100, data_emissao: '2026-10-07T00:00:00.000Z' },
    { id: 2, numero: 'PED2', cliente_nome: 'Loja Central Norte', dono: 'Iara', situacao: 'Enviado', parcelas: 12, valor_final: 900, data_emissao: '2026-06-01' },
    { id: 3, numero: 'PED3', cliente_nome: 'Jackie', dono: 'Henrique', situacao: 'Entregue', parcelas: 2, valor_final: 300, data_emissao: '2026-09-25' }
];

test('Pedidos: o cliente escolhido acha os pedidos dele (e só dele)', () => {
    const avaliar = carregar();
    const filtrar = filtros => avaliar('REPORT_FILTERS.pedidos')(PEDIDOS, filtros).map(p => p.numero);
    assert.deepStrictEqual(filtrar({ cliente: 'Loja Central' }), ['PED1'], '"Loja Central" não traz a "Loja Central Norte"');
    assert.deepStrictEqual(filtrar({ cliente: 'Jackie' }), ['PED3']);
});

test('Pedidos: Dono e Status filtram de verdade, por igualdade', () => {
    const avaliar = carregar();
    const filtrar = filtros => avaliar('REPORT_FILTERS.pedidos')(PEDIDOS, filtros).map(p => p.numero);
    assert.deepStrictEqual(filtrar({ dono: 'Henrique' }), ['PED1', 'PED3']);
    assert.deepStrictEqual(filtrar({ status: 'Enviado' }), ['PED2']);
    // Condição: "2 parcelas" não traz o de 12.
    assert.deepStrictEqual(filtrar({ condicao: '2 parcelas' }), ['PED3']);
    assert.deepStrictEqual(filtrar({ condicao: 'Parcelado' }), ['PED2', 'PED3']);
});

test('Pedidos: o Período conta pela emissão; o personalizado usa o intervalo do balão', () => {
    const faixa = { start: '2026-09-01', end: '2026-09-30' };
    const avaliar = carregar({ __relatoriosDateRanges: { 'relatorios-pedidos': faixa } });
    const filtrar = filtros => avaliar('REPORT_FILTERS.pedidos')(PEDIDOS, filtros).map(p => p.numero);
    assert.deepStrictEqual(filtrar({ periodo: 'Personalizado' }), ['PED3']);
    const dentro = avaliar('dentroDoPeriodo');
    const agora = new Date(2026, 9, 8, 10, 0, 0);
    assert.strictEqual(dentro('2026-10-07T00:00:00.000Z', 'Última semana', null, agora), true, 'meia-noite UTC é o dia 07, não o 06');
    assert.strictEqual(dentro('2026-09-25', 'Última semana', null, agora), false);
    assert.strictEqual(dentro('2026-09-25', 'Último mês', null, agora), true);
    assert.strictEqual(dentro('2026-06-01', 'Último trimestre', null, agora), false);
    assert.strictEqual(dentro(null, 'Último mês', null, agora), false);
    assert.strictEqual(dentro('2026-06-01', '', null, agora), true, 'sem período, não filtra');
    assert.strictEqual(dentro('2026-06-01', 'Personalizado', null, agora), true, 'personalizado sem intervalo, não filtra');
});

test('Orçamentos: cliente pelo cliente_nome, dono e período lidos', () => {
    const avaliar = carregar();
    const orcamentos = [
        { id: 1, numero: 'ORC1', cliente_nome: 'Jackie', dono: 'Iara', situacao: 'Pendente', data_emissao: '2026-10-01' },
        { id: 2, numero: 'ORC2', cliente_nome: 'Loja Central', dono: 'Henrique', situacao: 'Aprovado', data_emissao: '2026-01-01' }
    ];
    const filtrar = filtros => avaliar('REPORT_FILTERS.orcamentos')(orcamentos, filtros).map(o => o.numero);
    assert.deepStrictEqual(filtrar({ cliente: 'Jackie' }), ['ORC1']);
    assert.deepStrictEqual(filtrar({ dono: 'Henrique' }), ['ORC2']);
    assert.deepStrictEqual(filtrar({ status: 'Pendente' }), ['ORC1']);
});

test('Prospecções: Estado e Data de criação ligados, e o Filtrar/Limpar falam com a aba', () => {
    const avaliar = carregar();
    const lista = [
        { id: 1, nome: 'A', status: 'Novo', estado: 'MG', criado_em: '2026-09-10T15:00:00.000Z' },
        { id: 2, nome: 'B', status: 'Novo', estado: 'SP', criado_em: '2026-10-05T15:00:00.000Z' }
    ];
    const filtrar = filtros => avaliar('REPORT_FILTERS.prospeccoes')(lista, filtros).map(p => p.nome);
    assert.deepStrictEqual(filtrar({ estado: 'mg' }), ['A']);
    assert.deepStrictEqual(filtrar({ criadoDe: '2026-10-01' }), ['B']);
    assert.deepStrictEqual(filtrar({ criadoAte: '2026-09-30' }), ['A']);
    const prospeccoes = HTML.slice(HTML.indexOf('data-relatorios-tab-content="prospeccoes"'), HTML.indexOf('data-relatorios-tab-content="orcamentos"'));
    for (const chave of ['estado', 'criadoDe', 'criadoAte']) {
        assert.ok(prospeccoes.includes(`data-relatorios-filter="prospeccoes" data-filter-key="${chave}"`), chave);
    }
    assert.ok(prospeccoes.includes('data-relatorios-apply="prospeccoes"'));
    assert.ok(prospeccoes.includes('data-relatorios-reset="prospeccoes"'));
    assert.ok(!/id="btnFiltrar"|id="btnLimpar"/.test(HTML), 'botões sem ligação (ids soltos) não voltam');
});

test('os seletores comparam por igualdade (coleção, categoria, dono do cliente, tipo do contato)', () => {
    const avaliar = carregar({ PrecoTabela: { precoDeVenda: () => null } });
    const produtos = [{ codigo: 'A', categoria: 'Mármore' }, { codigo: 'B', categoria: 'Mármore Branco' }];
    assert.deepStrictEqual(avaliar('REPORT_FILTERS.produtos')(produtos, { colecao: 'Mármore' }).map(p => p.codigo), ['A']);
    const mp = [{ nome: 'x', categoria: 'Pedra' }, { nome: 'y', categoria: 'Pedra Natural' }];
    assert.deepStrictEqual(avaliar('REPORT_FILTERS["materia-prima"]')(mp, { categoria: 'Pedra' }).map(m => m.nome), ['x']);
    const clientes = [{ nome_fantasia: 'C1', dono_cliente: 'Ana' }, { nome_fantasia: 'C2', dono_cliente: 'Ana Paula' }];
    assert.deepStrictEqual(avaliar('REPORT_FILTERS.clientes')(clientes, { owner: 'Ana' }).map(c => c.nome_fantasia), ['C1']);
});

test('a coluna Data mostra o dia gravado, sem o fuso puxar para o dia anterior', () => {
    const avaliar = carregar();
    const formatar = avaliar('formatDate');
    assert.strictEqual(formatar('2026-10-08'), '08/10/2026');
    assert.strictEqual(formatar('2026-10-08T00:00:00.000Z'), '08/10/2026');
    assert.strictEqual(formatar('08/10/2026'), '08/10/2026');
    assert.strictEqual(formatar(''), '—');
});

test('Master-Detail: marcar não muda a ordem da lista; o card fica no lugar (dono, 08/10/2026)', () => {
    // O desenho da lista usa a ordem do relatório, sempre — nada de "selecionados primeiro".
    const inicio = FONTE.indexOf('const renderList = key => {');
    const corpo = FONTE.slice(inicio, FONTE.indexOf('const atualizarCards', inicio));
    assert.ok(corpo.includes('baseOrder.forEach'), 'a lista sai na ordem do relatório');
    assert.ok(!/\[\.\.\.selectedIds, \.\.\.unselectedIds\]/.test(FONTE), 'a ordem "selecionados primeiro" não volta');
    // Marcar ou clicar só atualiza os cards que já estão na tela.
    for (const funcao of ['const setPreview', 'const toggleSelection']) {
        const trecho = FONTE.slice(FONTE.indexOf(funcao), FONTE.indexOf('};', FONTE.indexOf(funcao)));
        assert.ok(trecho.includes('atualizarCards(key)'), funcao);
    }
    assert.ok(HTML.includes('data-relatorios-master-contagem'), 'a contagem de selecionados ao lado de "Registros"');
});

test('Modelos: o que entra no modelo e o que fica de fora', () => {
    const avaliar = carregar();
    const montar = avaliar('montarModelo');
    const agora = new Date('2026-10-08T12:00:00.000Z');
    const modelo = montar({
        nome: '  Pedidos da Jackie  ', aba: 'pedidos', agora,
        filtros: { cliente: 'Jackie', periodo: 'Personalizado', status: '', codigo: '', semEstoque: false, paises: { values: [] } },
        faixa: { start: '2026-09-01', end: '2026-09-30' }, colunas: ['codigo', 'cliente']
    });
    assert.strictEqual(modelo.nome, 'Pedidos da Jackie');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(modelo.filtros)), { cliente: 'Jackie', periodo: 'Personalizado' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(modelo.faixa)), { start: '2026-09-01', end: '2026-09-30' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(modelo.colunas)), ['codigo', 'cliente']);
    const semPeriodo = montar({ nome: 'x', aba: 'pedidos', agora, filtros: { periodo: 'Último mês', cliente: 'J' }, incluirPeriodo: false });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(semPeriodo.filtros)), { cliente: 'J' });
    // Os exemplos de mentira e o "Agendar" sem envio saíram da tela.
    assert.ok(!/Análise de Vendas Q3|Relatório Estoque Mensal|joao@empresa\.com/.test(HTML));
    assert.ok(HTML.includes('id="relatoriosSalvarModelo"'));
});

test('os filtros dos Relatórios filtram enquanto digita (texto) e ao mudar (seletores)', () => {
    const trecho = FONTE.slice(FONTE.indexOf('function setupFilterInteractions'), FONTE.indexOf('async function getReportData'));
    assert.ok(trecho.includes('BuscaAoDigitar.ligar(element, update'), 'caixas de texto');
    assert.ok(trecho.includes("element.addEventListener('change', update)"), 'seletores, datas e marcadores');
    assert.ok(FONTE.includes("document.addEventListener('relatorios:geo-filter-change'"), 'País/Estado redesenham a tabela');
    assert.ok(FONTE.includes("document.addEventListener('relatorios:periodo-personalizado'"), 'o período personalizado redesenha a tabela');
});
