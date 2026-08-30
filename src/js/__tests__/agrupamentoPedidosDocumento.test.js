/**
 * Documento "Agrupamento Pedidos" (src/js/relatorios.js).
 *
 * O documento é o entregável: quem produz lê o consolidado para saber quantas
 * peças fazer, e quem separa lê o detalhamento para saber o que é de qual
 * loja. Um erro aqui não aparece na tela — aparece na bancada.
 *
 * A soma em si é testada em backend/agrupamentoPedidos.test.js. Aqui o que se
 * verifica é o desenho: colunas escolhidas, presença do detalhamento, a loja
 * no cabeçalho e o fluxo contínuo entre pedidos.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * `relatorios.js` é um script de página, sem exports. Carregamos o arquivo
 * inteiro num contexto mínimo e pegamos as funções de dentro dele — assim o
 * teste acompanha o arquivo real, e não uma cópia que envelhece.
 */
function carregarModulo({ colunasVisiveis = null } = {}) {
    const arquivo = path.join(__dirname, '..', 'relatorios.js');
    const fonte = fs.readFileSync(arquivo, 'utf8');

    const armazenamento = new Map();
    const janela = {
        apiConfig: { getApiBaseUrl: async () => '' },
        localStorage: {
            getItem: chave => (armazenamento.has(chave) ? armazenamento.get(chave) : null),
            setItem: (chave, valor) => armazenamento.set(chave, valor),
            removeItem: chave => armazenamento.delete(chave)
        },
        Permissoes: { pode: () => true }
    };

    const contexto = {
        window: janela,
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

    if (colunasVisiveis) {
        vm.runInContext(
            `setVisibleColumns(AGRUPAMENTO_PEDIDOS_KEY, ${JSON.stringify(colunasVisiveis)});`,
            contexto
        );
    }

    return {
        gerar: (doc, opcoes) => vm.runInContext('createAgrupamentoPrintHtml', contexto)(doc, opcoes),
        colunas: () => vm.runInContext('colunasDoAgrupamento()', contexto)
    };
}

/** Duas peças consolidadas e dois pedidos detalhados. */
function documento() {
    return {
        pecas: [
            { produto_id: 9, codigo: 'AV01', nome: 'Apaga Velas', quantidade: 5, pronta: 1, a_fazer: 4, valor_unitario: 94, valor_total: 470, em_pedidos: 2 },
            { produto_id: 7, codigo: 'BD01', nome: 'Bandeja', quantidade: 1, pronta: 0, a_fazer: 1, valor_unitario: 300, valor_total: 300, em_pedidos: 1 }
        ],
        pedidos: [
            {
                id: 1, numero: 'PED1', cliente: 'Loja Central',
                itens: [
                    { codigo: 'AV01', nome: 'Apaga Velas', quantidade: 2 },
                    { codigo: 'BD01', nome: 'Bandeja', quantidade: 1 }
                ]
            },
            {
                id: 2, numero: 'PED2', cliente: 'Decorações Silvia',
                itens: [{ codigo: 'AV01', nome: 'Apaga Velas', quantidade: 3 }]
            }
        ],
        totais: { linhas: 2, quantidade: 6, pronta: 1, a_fazer: 5, valor_total: 770 },
        ausentes: 0
    };
}

// ------------------------------------------------------------- consolidado

test('o consolidado sai com título, colunas e totais', () => {
    const html = carregarModulo().gerar(documento());

    assert.match(html, /<h1>Agrupamento Pedidos<\/h1>/);
    for (const rotulo of ['Código', 'Nome', 'Quantidade', 'Pronta', 'A Fazer', 'Valor Unit.', 'Valor Total']) {
        assert.ok(html.includes(`>${rotulo}</th>`), `faltou a coluna ${rotulo}`);
    }

    assert.ok(html.includes('AV01'));
    assert.ok(html.includes('Apaga Velas'));
    // A linha de totais é o que a produção confere de relance.
    assert.match(html, /<tfoot>[\s\S]*Total[\s\S]*<\/tfoot>/);
});

test('o unitário fica fora do rodapé — média de médias não soma', () => {
    const html = carregarModulo().gerar(documento());
    const rodape = html.slice(html.indexOf('<tfoot>'), html.indexOf('</tfoot>'));

    // Total geral e quantidades aparecem; o unitário médio, não.
    assert.ok(rodape.includes('770'), 'o total em dinheiro tem de estar no rodapé');
    assert.ok(!rodape.includes('94'), 'o unitário médio não pode ser somado');
});

// ----------------------------------------------------------------- colunas

test('só as colunas escolhidas entram no documento', () => {
    const modulo = carregarModulo({ colunasVisiveis: ['codigo', 'nome', 'quantidade'] });
    const html = modulo.gerar(documento());

    // join em vez de deepStrictEqual: o array vem de dentro do VM e tem outro
    // Array.prototype, o que reprova a comparação estrita por identidade.
    assert.strictEqual(modulo.colunas().map(c => c.key).join(','), 'codigo,nome,quantidade');
    assert.ok(html.includes('>Quantidade</th>'));
    assert.ok(!html.includes('>Valor Unit.</th>'), 'coluna desmarcada não pode aparecer');
    assert.ok(!html.includes('>A Fazer</th>'));
});

test('sem coluna somável visível, o rodapé de totais some', () => {
    // Um rodapé com todas as células vazias é ruído, não informação.
    const html = carregarModulo({ colunasVisiveis: ['codigo', 'nome'] }).gerar(documento());
    assert.ok(!html.includes('<tfoot>'));
});

test('desmarcar tudo cai para o conjunto completo, não para um documento vazio', () => {
    const modulo = carregarModulo({ colunasVisiveis: [] });
    assert.strictEqual(modulo.colunas().length, 7);
});

// ------------------------------------------------------------ detalhamento

test('o detalhamento só entra quando pedido', () => {
    const doc = documento();

    const semDetalhe = carregarModulo().gerar(doc, { incluirDetalhe: false });
    assert.ok(!semDetalhe.includes('Detalhamento por pedido'));

    const comDetalhe = carregarModulo().gerar(doc, { incluirDetalhe: true });
    assert.ok(comDetalhe.includes('Detalhamento por pedido'));
});

test('a loja é o cabeçalho de cada bloco do detalhamento', () => {
    const html = carregarModulo().gerar(documento(), { incluirDetalhe: true });

    // É pela loja que quem separa acha o pedido na bancada, não pelo número.
    assert.match(html, /<h3>Loja Central &middot; PED1<\/h3>/);
    assert.match(html, /<h3>Decorações Silvia &middot; PED2<\/h3>/);
});

test('o detalhamento mostra código, nome e quantidade de cada peça', () => {
    const html = carregarModulo().gerar(documento(), { incluirDetalhe: true });
    const detalhe = html.slice(html.indexOf('Detalhamento por pedido'));

    assert.ok(detalhe.includes('<th>Código</th>'));
    assert.ok(detalhe.includes('<th>Nome</th>'));
    assert.ok(detalhe.includes('Qtd.'));
    // Sem valores aqui: esta parte serve para separar peça, não para cobrar.
    assert.ok(!detalhe.includes('Valor Unit.'));
});

test('os pedidos fluem um após o outro, sem quebra de página entre eles', () => {
    const html = carregarModulo().gerar(documento(), { incluirDetalhe: true });

    // Um pedido por folha gastaria dez folhas quase vazias num agrupamento
    // de dez pedidos curtos.
    assert.ok(html.includes('break-inside: avoid'), 'o bloco não deve se partir ao meio');
    assert.ok(!html.includes('page-break-before'), 'nada pode forçar folha nova por pedido');
    assert.ok(html.includes('display: table-header-group'), 'o cabeçalho repete entre páginas');
});

test('cliente sem nome não vira cabeçalho vazio', () => {
    const doc = documento();
    doc.pedidos[0].cliente = '';
    const html = carregarModulo().gerar(doc, { incluirDetalhe: true });

    assert.ok(html.includes('Cliente não informado'));
});

// ------------------------------------------------------------------ bordas

test('conjunto sem peças gera documento legível, não quebrado', () => {
    const html = carregarModulo().gerar({ pecas: [], pedidos: [], totais: {}, ausentes: 0 });

    assert.ok(html.includes('Nenhuma peça nos pedidos selecionados.'));
    assert.ok(!html.includes('<tfoot>'), 'sem linhas não há o que totalizar');
});

test('pedidos que sumiram são avisados no próprio documento', () => {
    const doc = documento();
    doc.ausentes = 2;
    const html = carregarModulo().gerar(doc);

    assert.match(html, /2 pedido\(s\) selecionado\(s\) não foram encontrados/);
});

test('o resumo diz quantos pedidos e quantas peças distintas', () => {
    const html = carregarModulo().gerar(documento());
    assert.match(html, /2 pedidos &middot; 2 peças distintas &middot; 6 no total/);
});
