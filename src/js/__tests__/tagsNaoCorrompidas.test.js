/**
 * Tags HTML íntegras nos templates de modal.
 *
 * Origem deste teste: um commit que adicionou `data-perm` em massa casou o
 * `<i` de `<input` e produziu
 *
 *     <i data-perm="orc.item.edit"nput id="novoPrazoVista" type="number" ...>
 *
 * O navegador não reclama: aceita um `<i>` itálico com atributos estranhos e
 * segue. O campo "Prazo (dias)" do orçamento à vista simplesmente deixou de
 * existir — sem formatação (o observador de `numericInput` procura
 * `input[type="number"]`) e sem aceitar digitação. Nenhum erro no console, e
 * o defeito sobreviveu a vários commits.
 *
 * A varredura é textual porque o HTML mora dentro de template strings de
 * JavaScript: nenhum parser de JS acusaria o problema.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');

/** Todos os .js e .html sob src/, menos os próprios testes. */
function arquivosDeInterface(diretorio = RAIZ, acumulado = []) {
    for (const entrada of fs.readdirSync(diretorio, { withFileTypes: true })) {
        const caminho = path.join(diretorio, entrada.name);
        if (entrada.isDirectory()) {
            // `vendor` é código de terceiros, minificado: a heurística acusa
            // falso positivo lá e não é nosso para corrigir de todo modo.
            if (['__tests__', 'node_modules', 'vendor'].includes(entrada.name)) continue;
            arquivosDeInterface(caminho, acumulado);
        } else if (/\.(js|html)$/.test(entrada.name)) {
            acumulado.push(caminho);
        }
    }
    return acumulado;
}

const ARQUIVOS = arquivosDeInterface();

test('nenhuma tag ficou partida por atributo injetado no meio do nome', () => {
    // `<tag atributo="valor"resto` — o fecha-aspas colado em letra só acontece
    // quando alguém inseriu um atributo dentro do NOME da tag.
    const padrao = /<[a-zA-Z][a-zA-Z0-9]*\s+[a-zA-Z-]+="[^"]*"[a-zA-Z]/;
    const quebrados = [];

    for (const arquivo of ARQUIVOS) {
        fs.readFileSync(arquivo, 'utf8').split('\n').forEach((linha, i) => {
            if (padrao.test(linha)) {
                quebrados.push(`${path.relative(RAIZ, arquivo)}:${i + 1}`);
            }
        });
    }

    assert.deepStrictEqual(quebrados, [], `tags partidas em: ${quebrados.join(', ')}`);
});

test('os campos de prazo à vista são inputs de verdade', () => {
    // Estes dois foram as vítimas reais. O teste nomeia-os para que, se a
    // varredura genérica acima algum dia afrouxar, eles continuem cobertos.
    const casos = [
        ['js/modals/orcamento-novo.js', 'novoPrazoVista'],
        ['js/modals/orcamento-editar.js', 'editarPrazoVista']
    ];

    for (const [arquivo, id] of casos) {
        const fonte = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
        const linha = fonte.split('\n').find(l => l.includes(`id="${id}"`) && !l.includes('<label'));

        assert.ok(linha, `campo ${id} não encontrado em ${arquivo}`);
        assert.match(linha.trim(), /^<input\s/, `${id} precisa ser um <input>, não outra tag`);
        assert.ok(linha.includes('type="number"'), `${id} precisa de type="number" para o numericInput formatá-lo`);
    }
});

test('o prazo de pagamento não é gated pela permissão de itens', () => {
    // `orc.item.edit` governa os ITENS do orçamento. Amarrar o prazo a ela
    // esconderia o campo de quem pode definir a condição de pagamento mas não
    // mexe em itens — recriando o sintoma "prazo bloqueado" por outra via.
    for (const arquivo of ['js/modals/orcamento-novo.js', 'js/modals/orcamento-editar.js']) {
        const fonte = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
        const linha = fonte.split('\n').find(l => /id="\w*PrazoVista"/.test(l) && !l.includes('<label'));
        assert.ok(!/data-perm=/.test(linha), `${arquivo}: o campo de prazo não deve ter data-perm`);
    }
});
