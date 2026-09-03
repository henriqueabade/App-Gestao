/**
 * Diálogo "Editar Preço" do modal de produto (src/js/modals/produto-editar.js).
 *
 * O campo é uma MÁSCARA de moeda, não um `<input type="number">`: o valor fica
 * sempre formatado como "R$ 1.234,56" — inclusive enquanto se digita — e o
 * usuário nunca escreve nem apaga o "R$". Só dígitos contam, e os dois últimos
 * são os centavos.
 *
 * Testar a máscara importa porque o erro típico dela é silencioso e caro:
 * "R$ 781,80" virar 78180 ou 7,8180 grava um preço errado na tabela fixa e
 * remarca todo orçamento em aberto.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const FONTE_MODAL = fs.readFileSync(
    path.join(RAIZ, 'js', 'modals', 'produto-editar.js'),
    'utf8'
);

/**
 * Recorta as duas funções da máscara do arquivo real. Se forem renomeadas ou
 * removidas, o teste falha em vez de passar exercitando uma cópia própria.
 */
function carregarMascara() {
    const inicio = FONTE_MODAL.indexOf('function formatarMoedaBR');
    const fim = FONTE_MODAL.indexOf('if (precoTabelaOverlay');
    assert.ok(inicio !== -1 && fim > inicio, 'as funções da máscara não foram encontradas');
    // eslint-disable-next-line no-new-func
    return new Function(
        `${FONTE_MODAL.slice(inicio, fim)} return { formatarMoedaBR, centavosDoTexto };`
    )();
}

const { formatarMoedaBR, centavosDoTexto } = carregarMascara();

// Espaço não-quebrável: é o que o Intl usa entre "R$" e o número.
const nbsp = String.fromCharCode(160);
const moeda = texto => texto.replace(/ /g, nbsp);

// -------------------------------------------------------------- formatação

test('centavos viram moeda brasileira completa', () => {
    assert.strictEqual(formatarMoedaBR(78180), moeda(`R$${nbsp}781,80`));
    assert.strictEqual(formatarMoedaBR(0), moeda(`R$${nbsp}0,00`));
    assert.strictEqual(formatarMoedaBR(5), moeda(`R$${nbsp}0,05`));
    // Separador de milhar, para o valor não virar uma tira de dígitos.
    assert.strictEqual(formatarMoedaBR(123456789), moeda(`R$${nbsp}1.234.567,89`));
});

test('as duas casas aparecem sempre, mesmo em valor redondo', () => {
    // "R$ 100" pareceria contagem; o campo é dinheiro.
    assert.strictEqual(formatarMoedaBR(10000), moeda(`R$${nbsp}100,00`));
});

// ------------------------------------------------------------------ leitura

test('só os dígitos contam — o "R$" e a pontuação são ignorados', () => {
    // É isto que permite o usuário nunca precisar apagar o "R$" para digitar.
    assert.strictEqual(centavosDoTexto('R$ 781,80'), 78180);
    assert.strictEqual(centavosDoTexto('781,80'), 78180);
    assert.strictEqual(centavosDoTexto('R$ 1.234,56'), 123456);
    assert.strictEqual(centavosDoTexto('78180'), 78180);
});

test('campo vazio ou sem dígito nenhum vale zero, não NaN', () => {
    // NaN aqui viraria "R$ NaN" na tela e um POST com valor inválido.
    for (const entrada of ['', '   ', 'R$', 'abc', null, undefined]) {
        assert.strictEqual(centavosDoTexto(entrada), 0, `falhou para ${JSON.stringify(entrada)}`);
    }
});

test('digitar dígito a dígito percorre os centavos, como numa calculadora', () => {
    // O usuário digita "78180" e vê o valor crescer da direita para a esquerda.
    const passos = ['7', '78', '781', '7818', '78180'];
    const esperado = [
        `R$${nbsp}0,07`,
        `R$${nbsp}0,78`,
        `R$${nbsp}7,81`,
        `R$${nbsp}78,18`,
        `R$${nbsp}781,80`
    ];

    passos.forEach((digitado, i) => {
        assert.strictEqual(formatarMoedaBR(centavosDoTexto(digitado)), moeda(esperado[i]));
    });
});

test('reformatar o que já está formatado não altera o valor', () => {
    // A cada tecla o campo é reescrito a partir do próprio conteúdo. Se esta
    // ida e volta não fosse estável, o valor derivaria a cada digitação.
    let texto = formatarMoedaBR(78180);
    for (let i = 0; i < 5; i++) {
        texto = formatarMoedaBR(centavosDoTexto(texto));
    }
    assert.strictEqual(texto, moeda(`R$${nbsp}781,80`));
});

test('o valor enviado é o número, não o texto da máscara', () => {
    // O backend grava `vlr_prod` numeric: mandar "R$ 781,80" gravaria lixo.
    const valor = centavosDoTexto('R$ 781,80') / 100;
    assert.strictEqual(valor, 781.8);
    assert.strictEqual(typeof valor, 'number');
});

// -------------------------------------------------------------- integração

test('o diálogo abre com o preço praticado atual, não com o calculado', () => {
    // `preco_venda` é o custo apurado; quem se edita aqui é `preco_tabela`.
    assert.match(FONTE_MODAL, /produtoSelecionado\?\.preco_tabela/);
    const trecho = FONTE_MODAL.slice(
        FONTE_MODAL.indexOf('const abrirPrecoTabela'),
        FONTE_MODAL.indexOf('const travarBotaoPreco')
    );
    assert.ok(!/preco_venda/.test(trecho), 'o diálogo não deve partir do preço calculado');
});

test('a recusa do processo principal não é reportada como sucesso', () => {
    // Permissão negada volta como objeto `{ success: false }`, não exceção.
    assert.match(FONTE_MODAL, /resultado\.success === false/);
});

test('o botão fica travado durante a gravação', () => {
    // Sem trava, dois cliques gravam duas vezes e remarcam orçamentos duas
    // vezes — e a segunda passada tem a resposta da primeira como base.
    assert.match(FONTE_MODAL, /precoTabelaEmAndamento/);
    assert.match(FONTE_MODAL, /travarBotaoPreco\(true\)/);
});

// ----------------------------------------------------------------- markup

test('o botão fica à esquerda de Salvar e usa o roxo do módulo', () => {
    const html = fs.readFileSync(
        path.join(RAIZ, 'html', 'modals', 'produtos', 'editar.html'),
        'utf8'
    );

    const posBotao = html.indexOf('id="editarPrecoTabela"');
    const posSalvar = html.indexOf('id="salvarEditarProduto"');
    assert.ok(posBotao !== -1 && posSalvar !== -1, 'os dois botões precisam existir');
    assert.ok(posBotao < posSalvar, '"Editar Preço" vem antes de "Salvar"');

    const linha = html.split('\n').find(l => l.includes('id="editarPrecoTabela"'));
    assert.ok(linha.includes('btn-preco-tabela'), 'precisa da classe do botão roxo');
    // Mexer no preço praticado remarca orçamentos: é a mesma permissão de
    // "Atualizar Tabela Fixa", não um atalho para escapar dela.
    assert.ok(linha.includes('data-perm="prod.tabela.update"'), 'precisa da guarda de permissão');
});

test('o roxo do botão é o mesmo do ícone de tabela na lista', () => {
    const css = fs.readFileSync(path.join(RAIZ, 'css', 'produtos.css'), 'utf8');
    const js = fs.readFileSync(path.join(RAIZ, 'js', 'produtos.js'), 'utf8');

    assert.match(css, /\.btn-preco-tabela\s*\{[^}]*background:\s*#7300ba/);
    assert.match(css, /\.btn-preco-tabela\s*\{[^}]*color:\s*#fff/);
    // A cor é o que amarra o botão ao ícone da calculadora sem precisar de
    // rótulo — se um mudar sozinho, o par se perde.
    assert.ok(js.includes("cor: '#7300ba'"), 'o ícone da lista deve usar o mesmo roxo');
});

test('nenhum botão do app quebra o texto em duas linhas', () => {
    const css = fs.readFileSync(path.join(RAIZ, 'css', 'menu.css'), 'utf8');

    // Quando a barra aperta, o navegador prefere quebrar o rótulo do botão —
    // "Limpar Tudo" vira duas linhas e desalinha a barra inteira. `menu.css` é
    // global, então a regra vale para todos os módulos e modais.
    const bloco = css.slice(css.indexOf('.btn-primary,'));
    assert.ok(bloco, 'a regra global de nowrap sumiu de menu.css');
    for (const classe of ['.btn-primary', '.btn-secondary', '.btn-success',
                          '.btn-danger', '.btn-warning', '.btn-neutral',
                          '.btn-preco-tabela']) {
        assert.ok(bloco.includes(classe), `${classe} ficou de fora da regra de nowrap`);
    }
    assert.match(bloco, /white-space:\s*nowrap/);
});

test('no cabeçalho quem cede espaço é o título, não os botões', () => {
    const html = fs.readFileSync(
        path.join(RAIZ, 'html', 'modals', 'produtos', 'editar.html'),
        'utf8'
    );

    // Com `flex-1` nos três blocos, o grupo de botões encolhia e o texto
    // quebrava. Agora os botões guardam a largura natural e o título trunca.
    const titulo = html.split('\n').find(l => l.includes('id="tituloeditar"'));
    assert.ok(titulo.includes('truncate'), 'o título precisa truncar');
    assert.ok(titulo.includes('min-w-0'), 'sem min-w-0 o truncate não funciona em flex');

    const grupoBotoes = html.split('\n').find(l => l.includes('justify-end gap-3'));
    assert.ok(grupoBotoes.includes('flex-shrink-0'), 'o grupo de botões não pode encolher');
    assert.ok(!grupoBotoes.includes('flex-1'), 'flex-1 no grupo é o que causava a quebra');
});
