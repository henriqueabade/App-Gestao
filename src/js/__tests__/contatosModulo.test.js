/**
 * Módulo Contatos = fornecedores, prestadores e parceiros (28/09/2026):
 * a lista (src/js/contatos.js), a ficha comum dos modais
 * (src/js/utils/contato-ficha.js) e a marcação dos modais.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const LISTA = ler('js', 'contatos.js');
const FICHA = ler('js', 'utils', 'contato-ficha.js');
const HTML = ler('html', 'contatos.html');
const CATALOGO = require('../../../backend/permissionsCatalog').PERMISSIONS_CATALOG;
const plano = v => JSON.parse(JSON.stringify(v));

function purasDaLista() {
  const inicio = LISTA.indexOf('function filtrarContatos');
  const fim = LISTA.indexOf('// ------------------------------------------------------- fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'bloco de funções puras não encontrado');
  return vm.runInContext(`${LISTA.slice(inicio, fim)}\n({ filtrarContatos, totaisPorTipo, badgeForStatus, escaparHtml })`, vm.createContext({}));
}

/** O utilitário da ficha num `window` mínimo (só as funções sem DOM são chamadas). */
function ficha() {
  const janela = { document: { getElementById: () => null }, addEventListener() {}, removeEventListener() {} };
  janela.window = janela;
  vm.runInContext(FICHA, vm.createContext(janela));
  return janela.ContatoFicha;
}

const CONTATOS = [
  { id: 1, nome: 'Madeiras Silva', razao_social: 'Madeiras Silva LTDA', tipo: 'Fornecedor', cnpj: '11222333000181', documento: '11.222.333/0001-81', cidade: 'Contagem', email: 'v@silva.com', status: 'Ativo' },
  { id: 2, nome: 'Ana Pintura', tipo: 'Prestador de serviço', cpf: '12345678909', documento: '123.456.789-09', cidade: 'Belo Horizonte', email: '', status: 'Ativo' },
  { id: 3, nome: 'Vidros Norte', tipo: 'Fornecedor', cnpj: '57248237000103', documento: '57.248.237/0001-03', cidade: 'Contagem', email: 'x@vidros.com', status: 'Inativo' },
  { id: 4, nome: 'Sem Tipo', tipo: null, documento: '', status: 'Ativo' }
];

test('filtro: nome, razão social, CNPJ com ou sem pontuação, cidade, e-mail; tipo e status', () => {
  const f = purasDaLista();
  const ids = lista => plano(lista).map(c => c.id);
  assert.deepEqual(ids(f.filtrarContatos(CONTATOS, {})), [1, 2, 3, 4]);
  assert.deepEqual(ids(f.filtrarContatos(CONTATOS, { termo: 'silva' })), [1]);
  assert.deepEqual(ids(f.filtrarContatos(CONTATOS, { termo: '11.222' })), [1], 'CNPJ digitado com ponto');
  assert.deepEqual(ids(f.filtrarContatos(CONTATOS, { termo: '57248' })), [3], 'CNPJ só dígitos');
  assert.deepEqual(ids(f.filtrarContatos(CONTATOS, { termo: 'contagem' })), [1, 3]);
  assert.deepEqual(ids(f.filtrarContatos(CONTATOS, { termo: 'vidros.com' })), [3]);
  assert.deepEqual(ids(f.filtrarContatos(CONTATOS, { tipo: 'Fornecedor' })), [1, 3]);
  assert.deepEqual(ids(f.filtrarContatos(CONTATOS, { tipo: 'Fornecedor', status: 'Inativo' })), [3]);
  assert.deepEqual(ids(f.filtrarContatos(null, {})), []);
});

test('totais por tipo: o total e um por tipo, o mais numeroso primeiro; sem tipo vira "Sem tipo"', () => {
  const f = purasDaLista();
  assert.deepEqual(plano(f.totaisPorTipo(CONTATOS)), { total: 4, porTipo: [['Fornecedor', 2], ['Prestador de serviço', 1], ['Sem tipo', 1]] });
  assert.match(f.badgeForStatus('Ativo'), /badge-success/);
  assert.match(f.badgeForStatus('Inativo'), /badge-danger/);
  assert.equal(f.escaparHtml('<b>'), '&lt;b&gt;');
});

test('ficha: máscaras de CNPJ e CPF e as iniciais do avatar', () => {
  const F = ficha();
  assert.equal(F.mascararCnpj('11222333000181'), '11.222.333/0001-81');
  assert.equal(F.mascararCnpj('112223330001819999'), '11.222.333/0001-81', 'para nos 14 dígitos');
  assert.equal(F.mascararCnpj('112'), '11.2');
  assert.equal(F.mascararCpf('12345678909'), '123.456.789-09');
  assert.equal(F.mascararCpf('1234567'), '123.456.7');
  assert.equal(F.iniciais('Madeiras Silva Comércio'), 'MS');
  assert.equal(F.escaparHtml('"a" & b'), '&quot;a&quot; &amp; b');
});

test('lista: as colunas pedidas pelo dono (Nome, Tipo, CNPJ, Celular, Telefone, Ações) com as permissões do catálogo', () => {
  const colunas = [...HTML.matchAll(/<th data-perm-col="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(colunas, ['col_ctt_nome', 'col_ctt_tipo', 'col_ctt_cnpj', 'col_ctt_tel', 'col_ctt_fixo']);
  assert.match(HTML, /<th class="[^"]*">Ações<\/th>/);
  const chavesDoCatalogo = new Set([...CATALOGO.ctt.actions.map(a => a.key), ...CATALOGO.ctt.columns.map(c => c.key)]);
  const usadas = new Set([...HTML.matchAll(/data-perm(?:-col|-hide)?="([^"]+)"/g)].map(m => m[1]));
  for (const chave of usadas) assert.ok(chavesDoCatalogo.has(chave), `${chave} não está no catálogo do módulo Contatos`);
  // O ícone de cada ação da linha pede a permissão dela.
  for (const chave of ['ctt.details.view', 'ctt.edit', 'ctt.delete', 'ctt.person.add']) assert.ok(LISTA.includes(`data-perm="${chave}"`), chave);
  assert.equal(HTML.includes('Materiais Silva Ltda'), false, 'os dados de mentira da tela antiga saíram');
});

test('catálogo e tela de permissões: toda ação nova do módulo Contatos aparece nos dois', () => {
  const PERMISSOES = ler('html', 'modals', 'usuarios', 'permissoes.html');
  for (const a of CATALOGO.ctt.actions) assert.ok(PERMISSOES.includes(`name="${a.key}"`), `${a.key} não está em permissoes.html`);
  for (const c of CATALOGO.ctt.columns) assert.ok(PERMISSOES.includes(`name="${c.key}"`), `${c.key} não está em permissoes.html`);
  assert.equal(PERMISSOES.includes('name="col_ctt_cliente"'), false);
  assert.deepEqual(CATALOGO.ctt.actions.map(a => a.column).filter(c => /person|type|interaction|details|delete/.test(c)),
    ['acao_details_view', 'acao_delete', 'acao_person_add', 'acao_person_edit', 'acao_person_remove', 'acao_interaction_add', 'acao_type_manage']);
  // `sql/` fica fora do git e o dono apaga o arquivo depois de rodar: sem ele, a conferência do SQL é pulada.
  const caminhoSql = path.join(RAIZ, '..', 'sql', 'contatos_fornecedores.sql');
  if (fs.existsSync(caminhoSql)) {
    const SQL = fs.readFileSync(caminhoSql, 'utf8');
    for (const a of CATALOGO.ctt.actions) assert.ok(SQL.includes(a.column), `${a.column} não está no SQL`);
    for (const c of CATALOGO.ctt.columns) assert.ok(SQL.includes(c.column), `${c.column} não está no SQL`);
  }
});

test('modais: novo/editar têm o Tipo com + e −, CNPJ/CPF, endereço "end" e as pessoas; detalhes tem atividades e histórico', () => {
  for (const nome of ['novo', 'editar']) {
    const html = ler('html', 'modals', 'contatos', `${nome}.html`);
    assert.ok(html.includes('id="contatoTipo"') && html.includes('id="addTipoContato"') && html.includes('id="delTipoContato"'), `${nome}: tipo com + e −`);
    assert.ok(html.includes('data-perm="ctt.type.manage"'), `${nome}: os botões + e − pedem ctt.type.manage`);
    assert.ok(html.includes('id="contatoTipoPessoa"') && html.includes('id="contatoCnpjBloco"') && html.includes('id="contatoCpfBloco"'), `${nome}: CNPJ ou CPF`);
    for (const id of ['endRua', 'endNumero', 'endBairro', 'endCidade', 'endPais', 'endEstado', 'endCep', 'endBuscarCep', 'endCodigoMunicipio']) assert.ok(html.includes(`id="${id}"`), `${nome}: ${id}`);
    assert.ok(html.includes('id="addPessoaBtn"') && html.includes('data-perm="ctt.person.add"'), `${nome}: nova pessoa`);
    assert.equal(/Transportadora|Ordens|Orçamento/.test(html), false, `${nome}: sem ordens, orçamentos e transportadoras`);
  }
  const detalhes = ler('html', 'modals', 'contatos', 'detalhes.html');
  assert.ok(detalhes.includes('id="contatoAtividades"') && detalhes.includes('id="contatoHistorico" data-historico-social'));
  assert.ok(detalhes.includes('data-perm="ctt.edit"'));
  const DETALHES_JS = ler('js', 'modals', 'contato-detalhes.js');
  assert.ok(DETALHES_JS.includes("origem: 'contato'"), 'a linha do tempo é a origem contato');
  assert.ok(DETALHES_JS.includes("'ctt.interaction.add'"));
  const excluir = ler('html', 'modals', 'contatos', 'excluir.html');
  assert.ok(excluir.includes('data-perm="ctt.delete"'));
});

test('o sino abre a ficha do contato e o menu trata o módulo como Clientes (a tabela rola por dentro)', () => {
  const NOTIF = ler('js', 'notifications.js');
  assert.ok(NOTIF.includes("contato: 'contatos'") && NOTIF.includes('window.ContatosModulo?.abrirDetalhes'));
  assert.ok(LISTA.includes('window.ContatosModulo = { abrirDetalhes: abrirDetalhesContato, carregar: carregarContatos }'));
  const MENU = ler('js', 'menu.js');
  assert.match(MENU, /MODULES_WITHOUT_SCROLL = new Set\(\[[^\]]*'contatos'/);
  const CSS = ler('css', 'contatos.css');
  assert.ok(CSS.includes('body[data-current-module="contatos"] #content.no-scroll #contatosTableWrapper.table-scroll'));
});
