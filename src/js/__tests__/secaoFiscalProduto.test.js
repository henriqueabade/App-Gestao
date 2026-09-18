/**
 * A parte fiscal da peça (Novo e Editar) numa seção retraída
 * (src/js/utils/secao-retratil.js + src/html/modals/produtos/*.html).
 *
 * O que prende aqui: a seção nasce fechada, o NCM (obrigatório) mora dentro
 * dela, e ao salvar com o NCM vazio ela ABRE — senão o navegador recusa o
 * envio sem dizer por quê, porque não consegue focar um campo escondido.
 */
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const UTIL = fs.readFileSync(path.join(RAIZ, 'js', 'utils', 'secao-retratil.js'), 'utf8');
const NOVO_HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'produtos', 'novo.html'), 'utf8');
const EDITAR_HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'produtos', 'editar.html'), 'utf8');
const NOVO_JS = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'produto-novo.js'), 'utf8');
const EDITAR_JS = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'produto-editar.js'), 'utf8');
const MENU = fs.readFileSync(path.join(RAIZ, 'html', 'menu.html'), 'utf8');
const CSS = fs.readFileSync(path.join(RAIZ, 'styles', 'secao-retratil.css'), 'utf8');

/* --------------------------------------------------- DOM de mentira */

function criar(tag) {
    const el = {
        tagName: String(tag).toUpperCase(),
        className: '',
        textContent: '',
        value: '',
        type: 'text',
        required: false,
        disabled: false,
        hidden: false,
        dataset: {},
        atributos: {},
        children: [],
        parent: null,
        ouvintes: {},
        focado: false,
        classList: {
            add(n) { if (!el.classList.contains(n)) el.className = `${el.className} ${n}`.trim(); },
            remove(n) { el.className = el.className.split(/\s+/).filter(c => c && c !== n).join(' '); },
            toggle(n, ligado) { const quer = ligado === undefined ? !el.classList.contains(n) : Boolean(ligado); return quer ? el.classList.add(n) : el.classList.remove(n); },
            contains(n) { return el.className.split(/\s+/).includes(n); }
        },
        setAttribute(nome, valor) { el.atributos[nome] = String(valor); },
        getAttribute(nome) { return el.atributos[nome] ?? null; },
        appendChild(filho) { filho.parent = el; el.children.push(filho); return filho; },
        addEventListener(tipo, fn) { (el.ouvintes[tipo] ||= []).push(fn); },
        disparar(tipo, evento = {}) { (el.ouvintes[tipo] || []).forEach(fn => fn({ type: tipo, target: el, ...evento })); },
        focus() { el.focado = true; },
        closest(seletor) { for (let n = el; n; n = n.parent) if (casa(n, seletor)) return n; return null; },
        querySelector(seletor) { return descendentes(el).find(n => casa(n, seletor)) || null; },
        querySelectorAll(seletor) { return descendentes(el).filter(n => seletor.split(',').some(s => casa(n, s.trim()))); }
    };
    return el;
}

function descendentes(raiz) {
    const saida = [];
    (function andar(n) { for (const f of n.children) { saida.push(f); andar(f); } })(raiz);
    return saida;
}

function casa(el, seletor) {
    const s = seletor.trim();
    const attr = /^\[data-([\w-]+)\]$/.exec(s);
    if (attr) return el.dataset[attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] !== undefined;
    if (s === 'form') return el.tagName === 'FORM';
    if (['input', 'select', 'textarea'].includes(s)) return el.tagName === s.toUpperCase();
    const id = /^#([\w-]+)$/.exec(s);
    if (id) return el.atributos.id === id[1];
    return false;
}

/** Um formulário com a seção fiscal dentro, como nos modais de peça. */
function montarCasa() {
    const form = criar('form');
    const secao = criar('section');
    secao.dataset.secaoRetratil = '';
    const barra = criar('button');
    barra.dataset.secaoBarra = '';
    const nota = criar('span');
    nota.dataset.secaoNota = '';
    barra.appendChild(nota);
    const corpo = criar('div');
    corpo.dataset.secaoCorpo = '';
    corpo.hidden = false;
    const ncm = criar('input');
    ncm.atributos.id = 'ncmInput';
    ncm.required = true;
    const cest = criar('input');
    const csosn = criar('input');
    corpo.appendChild(ncm);
    corpo.appendChild(cest);
    corpo.appendChild(csosn);
    secao.appendChild(barra);
    secao.appendChild(corpo);
    form.appendChild(secao);
    return { form, secao, barra, nota, corpo, ncm, cest, csosn };
}

function carregar() {
    const contexto = { window: {}, document: { querySelectorAll: () => [] }, Boolean, String, Number, Array, Object, setTimeout: fn => fn() };
    contexto.globalThis = contexto;
    vm.createContext(contexto);
    vm.runInContext(UTIL, contexto);
    return contexto.window.SecaoRetratil;
}

/* ------------------------------------------------------------ testes */

test('a seção nasce fechada, abre na barra e resume o que há dentro', () => {
    const util = carregar();
    const casa = montarCasa();
    util.ligar(casa.form);

    assert.strictEqual(casa.corpo.hidden, true, 'nasce fechada');
    assert.strictEqual(casa.barra.getAttribute('aria-expanded'), 'false');
    assert.match(casa.nota.textContent, /falta preencher 1 campo/, 'o NCM vazio já aparece na barra fechada');
    assert.ok(casa.secao.classList.contains('secao-retratil--atencao'));

    casa.barra.disparar('click');
    assert.strictEqual(casa.corpo.hidden, false, 'a setinha abre');
    assert.strictEqual(casa.barra.getAttribute('aria-expanded'), 'true');
    casa.barra.disparar('click');
    assert.strictEqual(casa.corpo.hidden, true, 'e fecha de novo');

    casa.ncm.value = '94036000';
    casa.cest.value = '0123456';
    casa.ncm.disparar('change');
    assert.strictEqual(casa.nota.textContent, '2 de 3 preenchidos');
    assert.ok(!casa.secao.classList.contains('secao-retratil--atencao'), 'sem falta, sem vermelho');
});

test('ao salvar com campo obrigatório vazio a seção abre sozinha e foca o campo', () => {
    const util = carregar();
    const casa = montarCasa();
    util.ligar(casa.form);
    util.fechar(casa.secao);

    // É o que o navegador dispara quando o campo obrigatório escondido barra o envio.
    casa.form.disparar('invalid', { target: casa.ncm });
    assert.strictEqual(casa.corpo.hidden, false, 'a seção abre antes de o navegador tentar focar');
    assert.strictEqual(casa.ncm.focado, true, 'e o campo que falta recebe o foco');
    assert.match(casa.nota.textContent, /falta preencher aqui/);

    // Pela mão do script do modal (o submit próprio), o efeito é o mesmo.
    util.fechar(casa.secao);
    util.abrirDe(casa.cest);
    assert.strictEqual(casa.corpo.hidden, false);
});

test('os dois modais de peça têm a seção fiscal, com o NCM dentro dela e nada solto no formulário', () => {
    for (const [nome, html, sufixo] of [['novo', NOVO_HTML, 'Novo'], ['editar', EDITAR_HTML, 'Editar']]) {
        assert.match(html, new RegExp(`<section class="secao-retratil[^"]*" data-secao-retratil>`), `${nome}: sem a seção`);
        assert.match(html, new RegExp(`id="dadosFiscaisBarra${sufixo}" data-secao-barra`), `${nome}: sem a barra`);
        assert.match(html, new RegExp(`id="dadosFiscais${sufixo}" data-secao-corpo[^>]*hidden`), `${nome}: o corpo não nasce fechado`);
        assert.match(html, /aria-expanded="false"/, `${nome}: a barra precisa dizer que está fechada`);

        // Todo campo fiscal (inclusive o NCM) mora DENTRO do corpo da seção.
        const corpo = html.slice(html.indexOf(`id="dadosFiscais${sufixo}"`), html.indexOf('</section>'));
        for (const id of ['ncmInput', 'origemMercadoriaInput', 'unidadeComercialInput', 'cestInput', 'gtinInput', 'cfopDentroInput', 'cfopForaInput', 'csosnInput']) {
            assert.ok(corpo.includes(`id="${id}"`), `${nome}: ${id} fora da seção`);
            assert.strictEqual(html.split(`id="${id}"`).length - 1, 1, `${nome}: ${id} duplicado`);
        }
        assert.match(corpo, /<label for="ncmInput"[^>]*>NCM/, `${nome}: o NCM ganhou rótulo`);
    }

    // O utilitário e o estilo são carregados pelo menu (os modais não trazem <script>).
    assert.match(MENU, /js\/utils\/secao-retratil\.js/);
    assert.match(MENU, /styles\/secao-retratil\.css/);
    assert.match(CSS, /\.secao-retratil__corpo\[hidden\] \{ display: none; \}/);

    // Os dois scripts ligam a seção e abrem quando falta o NCM.
    for (const [nome, js] of [['novo', NOVO_JS], ['editar', EDITAR_JS]]) {
        assert.match(js, /window\.SecaoRetratil\?\.ligar\(overlay \|\| document\)/, `${nome}: não liga a seção`);
        assert.match(js, /window\.SecaoRetratil\?\.abrir\(secaoFiscal, \{ foco: ncmInput \}\)/, `${nome}: não abre a seção ao faltar o NCM`);
    }
});
