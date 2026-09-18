/**
 * O seletor de competência do Financeiro (src/js/utils/competencia.js):
 * mês (nomes) à esquerda, ano digitável (2025–2100) e a LUPA, que é quem
 * "entra" no mês. Escolher não recarrega nada — o `change` (a leitura de
 * verdade) só sai na lupa ou no Enter do ano.
 *
 * O DOM daqui é de mentira, com só o que o utilitário usa.
 */
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FONTE = fs.readFileSync(path.join(__dirname, '..', 'utils', 'competencia.js'), 'utf8');

/** Elemento mínimo: atributos, filhos, ouvintes e o `closest` de verdade. */
function criarElemento(tag) {
    const el = {
        tagName: String(tag).toUpperCase(),
        className: '',
        textContent: '',
        value: '',
        dataset: {},
        atributos: {},
        children: [],
        parent: null,
        ouvintes: {},
        classList: {
            toggle(nome, ligado) {
                const tem = el.className.split(/\s+/).filter(Boolean);
                const quer = ligado === undefined ? !tem.includes(nome) : Boolean(ligado);
                el.className = (quer ? [...new Set([...tem, nome])] : tem.filter(c => c !== nome)).join(' ');
            },
            contains(nome) { return el.className.split(/\s+/).includes(nome); }
        },
        get options() { return el.children.filter(f => f.tagName === 'OPTION'); },
        setAttribute(nome, valor) { el.atributos[nome] = String(valor); },
        getAttribute(nome) { return el.atributos[nome] ?? null; },
        appendChild(filho) { filho.parent = el; el.children.push(filho); return filho; },
        replaceChildren(...filhos) { el.children = []; filhos.forEach(f => el.appendChild(f)); },
        addEventListener(tipo, fn) { (el.ouvintes[tipo] ||= []).push(fn); },
        dispatchEvent(evento) { (el.ouvintes[evento.type] || []).forEach(fn => fn(evento)); return true; },
        disparar(tipo, evento = {}) { (el.ouvintes[tipo] || []).forEach(fn => fn({ type: tipo, preventDefault() {}, ...evento })); },
        closest(seletor) { for (let n = el; n; n = n.parent) if (casa(n, seletor)) return n; return null; },
        querySelector(seletor) { return todos(el).find(n => casa(n, seletor)) || null; }
    };
    return el;
}

function todos(raiz) {
    const saida = [];
    (function andar(n) { for (const f of n.children) { saida.push(f); andar(f); } })(raiz);
    return saida;
}

function casa(el, seletor) {
    const attr = /^\[data-([\w-]+)\]$/.exec(seletor.trim());
    if (!attr) return false;
    const chave = attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return el.dataset[chave] !== undefined;
}

/** A casa do seletor, como está nos HTML do Financeiro. */
function montarCasa(contexto, id = 'finXCompetencia') {
    const caixa = criarElemento('div');
    caixa.dataset.competencia = '';
    const mes = criarElemento('select');
    mes.dataset.competenciaMes = '';
    const ano = criarElemento('input');
    ano.dataset.competenciaAno = '';
    const ir = criarElemento('button');
    ir.dataset.competenciaIr = '';
    const campo = criarElemento('input');
    campo.atributos.id = id;
    caixa.appendChild(mes);
    caixa.appendChild(ano);
    caixa.appendChild(ir);
    caixa.appendChild(campo);
    contexto.document.corpo.push(caixa);
    return { caixa, mes, ano, ir, campo };
}

function carregar() {
    const listas = new Map();
    const contexto = {
        window: {},
        document: {
            corpo: [],
            createElement: criarElemento,
            getElementById: id => listas.get(id) || null,
            body: { appendChild(filho) { if (filho.id) listas.set(filho.id, filho); return filho; } }
        },
        Event: class { constructor(tipo, opcoes = {}) { this.type = tipo; this.bubbles = Boolean(opcoes.bubbles); } },
        Number, String, Math, Date, Array, Object, Boolean
    };
    contexto.globalThis = contexto;
    vm.createContext(contexto);
    vm.runInContext(FONTE, contexto);
    return { contexto, util: contexto.window.Competencia, listas };
}

test('o seletor monta mês por nome, ano digitável de 2025 a 2100, e só a lupa muda a competência', () => {
    const { contexto, util, listas } = carregar();
    const { mes, ano, ir, campo } = montarCasa(contexto);
    const mudancas = [];
    campo.addEventListener('change', e => mudancas.push([campo.value, e.bubbles]));

    util.montar(campo, { valor: '2026-09' });
    assert.strictEqual(mes.children.length, 12, 'os doze meses');
    assert.deepStrictEqual(mes.children.slice(0, 2).map(o => [o.value, o.textContent]), [['01', 'Janeiro'], ['02', 'Fevereiro']]);
    assert.strictEqual(mes.value, '09');
    assert.strictEqual(ano.value, '2026');
    assert.strictEqual(campo.value, '2026-09', 'o valor canônico continua AAAA-MM');
    const anos = listas.get('finCompetenciaAnos');
    assert.ok(anos, 'a lista de anos existe uma vez só no documento');
    assert.strictEqual(anos.children.length, 2100 - 2025 + 1);
    assert.deepStrictEqual([anos.children[0].value, anos.children[anos.children.length - 1].value], ['2025', '2100']);

    // Escolher não recarrega: o valor só muda na lupa.
    mes.value = '03';
    ano.value = '2027';
    assert.strictEqual(campo.value, '2026-09', 'escolher não mexe no valor');
    assert.strictEqual(mudancas.length, 0, 'escolher não avisa ninguém');

    ir.disparar('click');
    assert.strictEqual(campo.value, '2027-03');
    assert.deepStrictEqual(mudancas, [['2027-03', true]], 'a lupa dispara um change que sobe');

    // Enter no ano faz o mesmo que a lupa.
    ano.value = '2028';
    ano.disparar('keydown', { key: 'Enter' });
    assert.strictEqual(campo.value, '2028-03');
    assert.strictEqual(mudancas.length, 2);
});

test('ano fora da faixa volta para dentro dela, e o utilitário sabe ler, escrever e desligar o seletor', () => {
    const { contexto, util } = carregar();
    const { mes, ano, ir, campo, caixa } = montarCasa(contexto);
    util.montar(campo, { valor: '2026-09' });

    ano.value = '1999';
    ir.disparar('click');
    assert.strictEqual(campo.value, '2025-09', 'antes de 2025 vira 2025');
    ano.value = '3000';
    ir.disparar('click');
    assert.strictEqual(campo.value, '2100-09', 'depois de 2100 vira 2100');
    ano.value = '1800';
    ano.disparar('blur');
    assert.strictEqual(ano.value, '2025', 'sair do campo já arruma o ano');

    util.definir(campo, '2029-12');
    assert.deepStrictEqual([campo.value, mes.value, ano.value], ['2029-12', '12', '2029']);
    util.definir(campo, 'abacaxi');
    assert.strictEqual(campo.value, util.atual(), 'valor inválido volta para o mês de hoje');

    util.desabilitar(campo, true);
    assert.deepStrictEqual([mes.disabled, ano.disabled, ir.disabled], [true, true, true]);
    assert.ok(caixa.classList.contains('fin-competencia-campo--desligado'));
    util.desabilitar(campo, false);
    assert.deepStrictEqual([mes.disabled, ano.disabled, ir.disabled], [false, false, false]);

    assert.strictEqual(util.rotulo('2026-09'), 'Setembro / 2026');
    assert.strictEqual(util.rotulo('sem mês'), '—');
    assert.ok(util.valida('2026-01') && !util.valida('2026-13') && !util.valida('2026'));
});

test('a opção "Todas" (listas que filtram por mês) deixa a competência vazia e avisa sozinha', () => {
    const { contexto, util } = carregar();
    const { mes, ir, campo } = montarCasa(contexto);
    const mudancas = [];
    campo.addEventListener('change', () => mudancas.push(campo.value));

    util.montar(campo, { valor: '2026-09', vazio: 'Todas' });
    assert.strictEqual(mes.children.length, 13, 'os doze meses e "Todas"');
    assert.deepStrictEqual([mes.children[0].value, mes.children[0].textContent], ['', 'Todas']);
    assert.strictEqual(campo.value, '2026-09');

    util.definir(campo, '');
    assert.strictEqual(campo.value, '', 'com "Todas" o vazio é um valor de verdade');
    assert.strictEqual(mes.value, '');

    mes.value = '';
    mes.disparar('change');
    assert.deepStrictEqual(mudancas, [''], '"Todas" não espera a lupa: tira o filtro na hora');

    mes.value = '05';
    ir.disparar('click');
    assert.strictEqual(campo.value.slice(5), '05');
});

test('sem a casa nova (HTML antigo), o campo sozinho ainda guarda a competência', () => {
    const { util } = carregar();
    const solto = criarElemento('input');
    util.montar(solto, { valor: '2026-07' });
    assert.strictEqual(solto.value, '2026-07');
    util.montar(solto, { valor: 'nada' });
    assert.strictEqual(solto.value, util.atual());
});
