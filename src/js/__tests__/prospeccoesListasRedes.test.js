/**
 * Prospecções (30/09/2026): a Origem e o Tipo da interação viraram listas
 * editáveis com + e − (utils/prospeccao-listas.js), e a ficha ganhou as
 * Redes sociais — uma por linha, a rede, o endereço e o + no fim da linha.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

test('Nova e Editar prospecção: a Origem é a lista com + e −, e as Redes sociais vêm logo abaixo do Site', () => {
  for (const arquivo of ['novo.html', 'editar.html']) {
    const html = ler('html', 'modals', 'prospeccoes', arquivo);
    assert.ok(!html.includes('prosOrigemSugestoes') && !/id="prosOrigem" type="text"/.test(html), `${arquivo}: a caixa de texto com sugestões saiu`);
    assert.match(html, /<select id="prosOrigem" title="Origem da prospecção" class="w-full appearance-none ctl-campo ctl-campo--dois-icones bg-input/);
    assert.match(html, /id="delOrigemProspeccao" data-perm="pros\.lists\.manage" class="absolute right-10[^"]*btn-neutral icon-only/);
    assert.match(html, /id="addOrigemProspeccao" data-perm="pros\.lists\.manage" class="absolute right-2[^"]*btn-neutral icon-only/);
    const site = html.indexOf('id="prosSite"');
    const redes = html.indexOf('id="prosRedesLista"');
    assert.ok(site > 0 && redes > site && html.slice(site, redes).includes('Redes sociais'), `${arquivo}: Redes sociais abaixo do Site`);
  }
});

test('Registrar interação: o Tipo é a lista com + e −', () => {
  const html = ler('html', 'modals', 'prospeccoes', 'interacao.html');
  assert.match(html, /<select id="interacaoTipo" title="Tipo da interação" class="w-full appearance-none ctl-campo ctl-campo--dois-icones/);
  assert.ok(html.includes('id="delTipoInteracao" data-perm="pros.lists.manage"') && html.includes('id="addTipoInteracao" data-perm="pros.lists.manage"'));
  const js = ler('js', 'modals', 'prospeccao-interacao.js');
  assert.ok(js.includes("lista: 'tipos-interacao'") && js.includes("botaoMais: get('addTipoInteracao')"));
});

test('os modais do + e do −: por cima de tudo, no padrão dos modais (Cancelar e Excluir vermelhos)', () => {
  const incluir = ler('html', 'modals', 'prospeccoes', 'lista-incluir.html');
  const excluir = ler('html', 'modals', 'prospeccoes', 'lista-excluir.html');
  for (const html of [incluir, excluir]) {
    assert.ok(html.includes('z-[2000]') && html.includes('ctl-padrao') && html.includes('glass-surface backdrop-blur-xl'));
  }
  assert.match(incluir, /type="submit" data-perm="pros\.lists\.manage" form="incluirListaForm" class="btn-primary ctl-botao/);
  assert.match(excluir, /id="cancelarExcluirLista" class="btn-danger ctl-botao/);
  assert.match(excluir, /id="confirmarExcluirLista" data-perm="pros\.lists\.manage" class="btn-danger ctl-botao/);
});

test('a permissão nova está no catálogo, na tela de permissões e no SQL', () => {
  const catalogo = require(path.join(RAIZ, '..', 'backend', 'permissionsCatalog.js')).PERMISSIONS_CATALOG;
  const acao = catalogo.pros.actions.find(a => a.key === 'pros.lists.manage');
  assert.deepEqual([acao?.column, acao?.label], ['acao_lists_manage', 'Gerenciar origens e tipos de interação']);
  assert.ok(ler('html', 'modals', 'usuarios', 'permissoes.html').includes('name="pros.lists.manage" data-role="item" data-group="acoes-pros"'));
  const arquivoSql = path.join(RAIZ, '..', 'sql', 'prospeccoes_listas_redes.sql');
  if (fs.existsSync(arquivoSql)) {
    const sql = fs.readFileSync(arquivoSql, 'utf8');
    for (const trecho of ['acao_lists_manage', 'prospeccao_origens', 'prospeccao_tipos_interacao', 'redes_sociais JSONB', "nome = 'Administrador'"]) assert.ok(sql.includes(trecho), trecho);
  }
});

test('o (i) da lista mostra o Site e as redes, quando há, com link e copiar', () => {
  const js = ler('js', 'prospeccoes.js');
  assert.ok(js.includes('Site e redes sociais') && js.includes('data-link-externo') && js.includes("copiar(valor, rotulo)"));
  assert.ok(js.includes('window.electronAPI.openExternal(link.href)'), 'o link abre no navegador do sistema');
});

function carregarListas() {
  const sandbox = {
    console, setTimeout,
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    Option: class { constructor(t, v) { this.textContent = t; this.value = v; this.dataset = {}; } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(ler('js', 'utils', 'prospeccao-listas.js'), sandbox);
  return sandbox.window.ProspeccaoListas;
}

function selectFalso() {
  return {
    opcoes: [], value: '',
    replaceChildren(...o) { this.opcoes = o; this.value = o[0]?.value ?? ''; }
  };
}

test('preencher: o valor é o nome; o que saiu da lista continua, marcado "(fora da lista)", sem se perder', () => {
  const L = carregarListas();
  const itens = [{ id: 1, nome: 'Feira' }, { id: 2, nome: 'Indicação' }];
  const s = selectFalso();
  L.preencher(s, itens, 'indicacao', { vazio: 'Selecione a origem' });
  assert.deepEqual([s.opcoes.map(o => o.value), s.value], [['', 'Feira', 'Indicação'], 'Indicação']);
  L.preencher(s, itens, 'Outdoor', { vazio: 'Selecione a origem' });
  assert.deepEqual([s.opcoes.at(-1).textContent, s.opcoes.at(-1).value, s.value], ['Outdoor (fora da lista)', 'Outdoor', 'Outdoor']);
  const tipo = selectFalso();
  L.preencher(tipo, itens, '');
  assert.equal(tipo.value, 'Feira', 'sem opção vazia, fica o primeiro da lista');
});

// ---------------------------------------------------------------------------
// As redes no formulário (prospeccao-form-comum.js)
// ---------------------------------------------------------------------------

function elemento() {
  return {
    value: '', dataset: {}, options: [], selectedOptions: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, focus() {}, scrollIntoView() {},
    setAttribute() {}, getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, append() {}, after() {}, remove() {}, replaceChildren() {}, closest: () => null
  };
}

function montarForm(valores, linhasDeRede) {
  const campos = new Map();
  const get = id => {
    if (!campos.has(id)) campos.set(id, elemento());
    return campos.get(id);
  };
  for (const [id, v] of Object.entries(valores)) get(id).value = v;
  // O container das redes devolve as linhas já "desenhadas".
  const container = get('prosRedesLista');
  container.children = [];
  container.querySelectorAll = sel => (sel === '.pros-redes__linha'
    ? linhasDeRede.map(([rede, valor]) => ({
      querySelector: q => (q === '.pros-redes__rede' ? { value: rede } : q === '.pros-redes__valor' ? { value: valor } : null)
    }))
    : sel === '.pros-redes__rede' ? linhasDeRede.map(() => elemento()) : []);
  const toasts = [];
  const sandbox = {
    console, setTimeout, clearTimeout,
    document: {
      getElementById: get, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => elemento(), head: elemento(), addEventListener() {}
    },
    addEventListener() {}, removeEventListener() {},
    showToast: (msg, tipo) => toasts.push({ msg, tipo }),
    Modal: { open() {}, close() {} },
    Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    fetch: async () => { throw new Error('sem rede no teste'); }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(ler('js', 'modals', 'prospeccao-form-comum.js'), sandbox);
  // setRedes([]) do início trocou os filhos: devolve as linhas do teste.
  const form = sandbox.window.ProspeccaoForm.criar(elemento(), { modo: 'novo' });
  return { form, toasts };
}

test('redes: linha sem endereço não conta; linha com endereço e sem rede barra o salvamento', () => {
  const ok = montarForm({ prosNomeFantasia: 'Empresa X', prosOrigem: 'Feira' }, [['Instagram', '@empresa'], ['', ''], ['LinkedIn', 'linkedin.com/company/x']]);
  const dados = ok.form.coletarDados();
  assert.deepEqual(JSON.parse(JSON.stringify(dados.redes_sociais)), [{ rede: 'Instagram', valor: '@empresa' }, { rede: 'LinkedIn', valor: 'linkedin.com/company/x' }]);
  assert.equal(dados.origem, 'Feira');

  const semRede = montarForm({ prosNomeFantasia: 'Empresa X' }, [['', '@perdido']]);
  assert.equal(semRede.form.coletarDados(), null);
  assert.match(semRede.toasts.at(-1).msg, /Escolha a rede social/);
});
