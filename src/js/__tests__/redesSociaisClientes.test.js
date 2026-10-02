/**
 * Redes sociais em Clientes (01/10/2026, decisão do dono: o campo nasce em
 * Clientes e vem da prospecção na conversão) e a aba Computadores de Usuários
 * (só o Sup Admin cancela os avisos do Windows de um computador).
 *
 * O componente das redes (src/js/utils/redes-sociais.js) roda num DOM de
 * mentira — o projeto não usa jsdom; o resto confere o código das telas.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const REDES_JS = ler('js/utils/redes-sociais.js');

/** Um DOM mínimo: classes, filhos, after/remove, querySelector por classe ou tag. */
function domFalso() {
  const dom = { focado: null };
  class El {
    constructor(tag) {
      Object.assign(this, { tagName: String(tag).toUpperCase(), children: [], parent: null, className: '', atributos: {}, ouvintes: {}, value: '', textContent: '', disabled: false, readOnly: false });
    }
    tem(c) { return this.className.split(/\s+/).includes(c); }
    get classList() {
      const el = this;
      return {
        add: c => { if (!el.tem(c)) el.className = `${el.className} ${c}`.trim(); },
        contains: c => el.tem(c),
        toggle: (c, forcar) => {
          const ligar = forcar === undefined ? !el.tem(c) : Boolean(forcar);
          el.className = [...el.className.split(/\s+/).filter(x => x && x !== c), ...(ligar ? [c] : [])].join(' ');
          return ligar;
        }
      };
    }
    appendChild(f) { f.parent = this; this.children.push(f); return f; }
    append(...fs) { fs.forEach(f => this.appendChild(f)); }
    replaceChildren(...fs) { this.children.forEach(c => { c.parent = null; }); this.children = []; this.append(...fs); }
    after(n) { const irmaos = this.parent.children; n.parent = this.parent; irmaos.splice(irmaos.indexOf(this) + 1, 0, n); }
    remove() { if (!this.parent) return; const irmaos = this.parent.children; irmaos.splice(irmaos.indexOf(this), 1); this.parent = null; }
    setAttribute(k, v) { this.atributos[k] = v; }
    addEventListener(evento, fn) { this.ouvintes[evento] = fn; }
    focus() { dom.focado = this; }
    todos() { return this.children.flatMap(c => [c, ...c.todos()]); }
    querySelectorAll(sel) {
      return this.todos().filter(e => (sel.startsWith('.') ? e.tem(sel.slice(1)) : e.tagName === sel.toUpperCase()));
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  function Option(texto, valor) {
    const o = new El('option');
    o.textContent = texto;
    o.value = valor;
    return o;
  }
  dom.El = El;
  dom.contexto = { window: {}, document: { createElement: tag => new El(tag) }, Option };
  vm.runInNewContext(REDES_JS, dom.contexto);
  dom.RedesSociais = dom.contexto.window.RedesSociais;
  return dom;
}

const linhas = c => c.children;
const rede = l => l.querySelector('.redes-sociais__rede');
const valor = l => l.querySelector('.redes-sociais__valor');
const menos = l => l.querySelector('.redes-sociais__menos');
const mais = l => l.querySelector('.redes-sociais__mais');
const comoJson = v => JSON.parse(JSON.stringify(v));

test('redes sociais: a mesma lista do backend; nasce com uma linha vazia (sem −, com +)', () => {
  const dom = domFalso();
  assert.deepStrictEqual(comoJson(dom.RedesSociais.REDES), require('../../../backend/prospeccaoListas').REDES);
  const caixa = new dom.El('div');
  const redes = dom.RedesSociais.montar(caixa);
  assert.ok(caixa.tem('redes-sociais'));
  assert.strictEqual(linhas(caixa).length, 1);
  assert.strictEqual(menos(linhas(caixa)[0]).tem('hidden'), true, 'uma linha só: sem o −');
  assert.strictEqual(mais(linhas(caixa)[0]).tem('hidden'), false);
  assert.strictEqual(rede(linhas(caixa)[0]).children.length, 1 + dom.RedesSociais.REDES.length, '"Rede" + a lista');
  assert.deepStrictEqual(comoJson(redes.ler()), []);
  assert.strictEqual(dom.RedesSociais.montar(null), null);
});

test('redes sociais: definir, + abre a linha logo abaixo, − tira; ler só as completas; linha sem rede é apontada', () => {
  const dom = domFalso();
  const caixa = new dom.El('div');
  const redes = dom.RedesSociais.montar(caixa);
  redes.definir([{ rede: 'Instagram', valor: '@loja' }, { rede: 'Threads', valor: '@loja.th' }, { rede: '', valor: '' }]);
  assert.strictEqual(linhas(caixa).length, 2, 'linha vazia não entra');
  assert.ok(linhas(caixa).every(l => !menos(l).tem('hidden')), 'duas linhas: o − aparece');
  assert.ok(rede(linhas(caixa)[1]).children.some(o => o.value === 'Threads'), 'rede de fora da lista ganha a opção dela');
  assert.deepStrictEqual(comoJson(redes.ler()), [{ rede: 'Instagram', valor: '@loja' }, { rede: 'Threads', valor: '@loja.th' }]);

  // + na primeira: a nova entra logo abaixo dela, já com o foco na rede.
  mais(linhas(caixa)[0]).ouvintes.click();
  assert.strictEqual(linhas(caixa).length, 3);
  const nova = linhas(caixa)[1];
  assert.strictEqual(dom.focado, rede(nova));
  valor(nova).value = '  instagram.com/outra  ';
  assert.strictEqual(redes.linhaSemRede(), 1, 'endereço sem rede: a tela avisa antes de salvar');
  assert.strictEqual(redes.ler().length, 2, 'incompleta não vai');
  rede(nova).value = 'Instagram';
  assert.strictEqual(redes.linhaSemRede(), -1);
  assert.strictEqual(redes.ler()[1].valor, 'instagram.com/outra', 'sem espaços nas pontas');
  redes.focarRede(2);
  assert.strictEqual(dom.focado, rede(linhas(caixa)[2]));

  // − tira; a última que sobra perde o −; tirar a última deixa uma vazia.
  menos(linhas(caixa)[0]).ouvintes.click();
  menos(linhas(caixa)[0]).ouvintes.click();
  assert.strictEqual(linhas(caixa).length, 1);
  assert.strictEqual(menos(linhas(caixa)[0]).tem('hidden'), true);
  menos(linhas(caixa)[0]).ouvintes.click();
  assert.strictEqual(linhas(caixa).length, 1);
  assert.deepStrictEqual(comoJson(redes.ler()), []);
});

test('redes sociais só para ler (Detalhes): sem − e sem +, caixa e campo travados', () => {
  const dom = domFalso();
  const caixa = new dom.El('div');
  dom.RedesSociais.montar(caixa, { somenteLeitura: true }).definir([{ rede: 'Instagram', valor: '@loja' }, { rede: 'Facebook', valor: 'fb.com/loja' }]);
  for (const l of linhas(caixa)) {
    assert.strictEqual(rede(l).disabled, true);
    assert.strictEqual(valor(l).readOnly, true);
    assert.ok(menos(l).tem('hidden') && mais(l).tem('hidden'));
  }
  assert.ok(!/innerHTML/.test(REDES_JS), 'tudo por textContent/value');
});

test('Clientes: Redes sociais logo abaixo do Site nos três modais; salvar manda redes_sociais e barra linha sem rede', () => {
  for (const modal of ['novo', 'editar', 'detalhes']) {
    const html = ler(`html/modals/clientes/${modal}.html`);
    assert.match(html, /<label class="ctl-rotulo text-gray-300">Redes sociais<\/label>\s*<div id="empresaRedesLista"><\/div>/, modal);
    assert.ok(html.indexOf('empresaRedesLista') > html.indexOf('Site'), `${modal}: depois do Site`);
  }
  const menu = ler('html/menu.html');
  assert.ok(menu.includes('<script src="../js/utils/redes-sociais.js"></script>'));
  for (const arquivo of ['js/modals/cliente-novo.js', 'js/modals/cliente-editar.js']) {
    const js = ler(arquivo);
    assert.ok(js.includes("const redesSociais = window.RedesSociais?.montar(document.getElementById('empresaRedesLista'));"), arquivo);
    assert.ok(js.includes('redes_sociais: redesSociais ? redesSociais.ler() : undefined,'), `${arquivo}: vai no payload`);
    assert.ok(js.includes('const semRede = redesSociais ? redesSociais.linhaSemRede() : -1;'), `${arquivo}: confere antes de salvar`);
    assert.ok(js.includes('redesSociais.focarRede(semRede);'));
    assert.ok(js.includes('redes: redesSociais ? redesSociais.ler() : []'), `${arquivo}: o rascunho guarda as redes`);
  }
  assert.ok(ler('js/modals/cliente-editar.js').includes('redesSociais?.definir(cli.redes_sociais);'));
  assert.ok(ler('js/modals/cliente-detalhes.js').includes("window.RedesSociais?.montar(document.getElementById('empresaRedesLista'), { somenteLeitura: true })?.definir(cli.redes_sociais);"));
});

test('Usuários › Computadores: aba escondida, só o Sup Admin vê; Cancelar vermelho com confirmação; lê e cancela pela rota', () => {
  const html = ler('html/modals/usuarios/editar.html');
  assert.match(html, /<div class="ctl-acoes justify-end w-full md:w-auto ml-auto">\s*<button id="cancelarEditarUsuario"/, 'Cancelar e Salvar à direita do rodapé');
  assert.match(ler('html/modals/usuarios/novo.html'), /<div class="ctl-acoes justify-end w-full md:w-auto ml-auto">\s*<button id="cancelarNovoUsuario"/, 'Novo usuário: Cancelar e Adicionar à direita');
  assert.match(html, /<button id="tab-computadores-usuario" role="tab"[^>]*class="usuario-modal-tab hidden">Computadores<\/button>/);
  assert.match(html, /<section id="panel-computadores-usuario" role="tabpanel"[^>]*hidden">\s*<div id="usuarioComputadores" class="usr-pcs"><\/div>/);
  const js = ler('js/modals/usuario-editar.js');
  assert.ok(js.includes("if (abaComputadores && window.Permissoes?.supAdmin) {"));
  assert.ok(js.includes('fetch(`${base}/api/usuarios/${usuarioBase.id}/computadores`)'));
  assert.ok(js.includes("fetch(`${base}/api/usuarios/${usuarioBase.id}/computadores/${c.id}/cancelar`, { method: 'POST'"));
  assert.ok(js.includes("const cancelar = el('button', 'btn-danger ctl-botao text-white');"));
  assert.match(js, /window\.DialogPadrao\?\.confirm\(\{\s*title: 'Cancelar os avisos deste computador\?', tom: 'erro'/);
  assert.ok(js.includes("if (dados.sql_pendente) {"), 'sem o SQL, a aba diz o que fazer');
  assert.ok(!/innerHTML/.test(js.slice(js.indexOf('const abaComputadores'), js.indexOf('const inputs = {'))), 'tudo por textContent');
});
