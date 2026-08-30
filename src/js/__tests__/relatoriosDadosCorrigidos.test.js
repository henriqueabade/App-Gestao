/**
 * Correções de dados nos Relatórios (src/js/relatorios.js).
 *
 * Cada teste aqui corresponde a um campo que a tela pedia e a resposta nunca
 * teve — o tipo de defeito que não gera erro nenhum no console: a coluna
 * simplesmente mostra "—", o seletor abre vazio, o filtro devolve zero linhas.
 * É exatamente por não fazer barulho que ele sobrevive tanto tempo.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** Carrega relatorios.js num contexto mínimo e expõe o que o teste precisar. */
function carregar() {
    const arquivo = path.join(__dirname, '..', 'relatorios.js');
    const fonte = fs.readFileSync(arquivo, 'utf8');

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
            // Em produção vem de src/utils/precoTabela.js, carregado pelo
            // menu. Sem ele `precoDeVendaProduto` devolveria null para toda
            // peça — e o teste passaria por engano.
            PrecoTabela: {
                precoDeVenda: produto => {
                    const valor = produto?.preco_tabela;
                    if (valor === undefined || valor === null || valor === '') return null;
                    const numero = Number(valor);
                    return Number.isFinite(numero) ? numero : null;
                }
            }
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
    vm.runInContext(fonte, contexto);

    return expressao => vm.runInContext(expressao, contexto);
}

const avaliar = carregar();

// ------------------------------------------------ cliente em orç. e pedidos

test('o nome do cliente vem de cliente_nome, com o antigo campo como reserva', () => {
    const nome = avaliar('nomeDoClienteDoDocumento');

    // É `cliente_nome` que o backend passou a enviar nas listas.
    assert.strictEqual(nome({ cliente_nome: 'Loja Central' }), 'Loja Central');
    // Fluxos internos que montam o objeto à mão ainda usam `cliente`.
    assert.strictEqual(nome({ cliente: 'Silvia' }), 'Silvia');
    assert.strictEqual(nome({ cliente_nome: 'Novo', cliente: 'Antigo' }), 'Novo');
    // Sem nenhum dos dois devolve string vazia — quem chama decide o "—".
    assert.strictEqual(nome({ cliente_id: 50 }), '');
    assert.strictEqual(nome(null), '');
});

// ------------------------------------------------------- usuários: conexão

test('a conexão do usuário sai das colunas reais, em snake_case', () => {
    const online = avaliar('usuarioEstaOnline');
    const agora = new Date().toISOString();
    const ontem = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    // A regra é a do módulo de Usuários: entrada mais recente que a saída.
    assert.strictEqual(online({ ultima_entrada: agora, ultima_saida: ontem }), true);
    assert.strictEqual(online({ ultima_entrada: ontem, ultima_saida: agora }), false);
    assert.strictEqual(online({ ultima_entrada: agora }), true, 'entrou e não saiu');

    // Sem o par entrada/saída, a atividade recente decide.
    assert.strictEqual(online({ ultima_atividade: agora }), true);
    assert.strictEqual(online({ ultima_atividade: ontem }), false);

    // Sem registro nenhum: offline, não "indefinido".
    assert.strictEqual(online({ nome: 'Sem dados' }), false);
});

test('a atividade só conta dentro da janela de cinco minutos', () => {
    const online = avaliar('usuarioEstaOnline');
    const quatroMin = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    const seisMin = new Date(Date.now() - 6 * 60 * 1000).toISOString();

    assert.strictEqual(online({ ultima_atividade: quatroMin }), true);
    assert.strictEqual(online({ ultima_atividade: seisMin }), false);
});

test('data inválida não é confundida com presença', () => {
    const online = avaliar('usuarioEstaOnline');
    assert.strictEqual(online({ ultima_entrada: 'nao-e-data' }), false);
    assert.strictEqual(online({ ultima_atividade: '' }), false);
});

test('o último acesso encontra o campo, seja qual for o nome da coluna', () => {
    const acesso = avaliar('usuarioUltimoAcesso');

    // Antes o relatório procurava só por `ultimoLoginEm`/`ultimaAtividadeEm`,
    // que a API nunca devolveu: a coluna vivia em "—".
    assert.notStrictEqual(acesso({ ultimo_login: '2026-01-10T12:00:00.000Z' }), '—');
    assert.notStrictEqual(acesso({ ultima_entrada: '2026-01-10T12:00:00.000Z' }), '—');
    assert.notStrictEqual(acesso({ ultima_atividade: '2026-01-10T12:00:00.000Z' }), '—');
    // E o camelCase continua aceito, para quem já o enviava.
    assert.notStrictEqual(acesso({ ultimoLoginEm: '2026-01-10T12:00:00.000Z' }), '—');

    assert.strictEqual(acesso({ nome: 'Sem acesso' }), '—');
});

// -------------------------------------------------------- produtos: filtro

test('o filtro de coleção enxerga a categoria, que é onde a coleção mora', () => {
    const opcoes = avaliar('FILTER_OPTION_CONFIGS.produtos.colecao');
    // A lista de opções vinha de `colecao`/`linha`, campos que o produto não
    // tem: o seletor abria vazio e o filtro nunca casava.
    assert.ok(opcoes({ categoria: 'Silvia' }).includes('Silvia'));

    const filtrar = avaliar('applyReportFilters');
    const produtos = [
        { id: 1, nome: 'Apaga Velas', categoria: 'Silvia' },
        { id: 2, nome: 'Bandeja', categoria: 'Acervo' }
    ];
    const raiz = {
        querySelectorAll: () => [{ dataset: { filterKey: 'colecao' }, value: 'Silvia', type: 'text' }],
        querySelector: () => null
    };
    const resultado = filtrar('produtos', produtos, raiz);
    assert.strictEqual(resultado.length, 1);
    assert.strictEqual(resultado[0].nome, 'Apaga Velas');
});

test('o filtro morto de "destaque" saiu do lugar', () => {
    const fonte = fs.readFileSync(path.join(__dirname, '..', 'relatorios.js'), 'utf8');
    // `destaque` não existe em produto nenhum: marcá-lo esvaziava a tabela.
    // Só o comentário que explica a troca pode citar a palavra.
    const usos = fonte.split('\n').filter(linha =>
        /destaque/.test(linha) && !/^\s*\/\//.test(linha.trim())
    );
    assert.deepStrictEqual(usos, [], `ainda há código lendo "destaque": ${usos.join(' | ')}`);
});

test('o filtro novo mostra as peças sem preço de tabela', () => {
    const filtrar = avaliar('applyReportFilters');
    const produtos = [
        { id: 1, nome: 'Com preço', preco_tabela: 120 },
        { id: 2, nome: 'Sem preço', preco_tabela: null },
        // Zero é um preço escolhido, não uma ausência.
        { id: 3, nome: 'Preço zero', preco_tabela: 0 }
    ];
    const raiz = {
        querySelectorAll: () => [{ dataset: { filterKey: 'semPrecoTabela' }, checked: true, type: 'checkbox' }],
        querySelector: () => null
    };

    const resultado = filtrar('produtos', produtos, raiz);
    assert.strictEqual(resultado.length, 1);
    assert.strictEqual(resultado[0].nome, 'Sem preço');
});
