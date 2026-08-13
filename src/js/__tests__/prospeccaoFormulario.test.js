/**
 * Formulário compartilhado dos modais de prospecção
 * (src/js/modals/prospeccao-form-comum.js).
 *
 * O foco é a leitura de campo numérico e a montagem do payload. Motivo: a
 * primeira versão colapsava "campo vazio" e "texto inválido" no mesmo `null` e
 * o chamador trocava por 0 — digitar "85.000,50" gravava um negócio de
 * R$ 0,00, sem erro, com o número certo ainda visível na tela. Os testes de
 * valor abaixo existem para que isso não volte.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARQUIVO = path.join(__dirname, '..', 'modals', 'prospeccao-form-comum.js');

/** Campos que o formulário lê ou escreve. */
const IDS = [
  'prosNomeFantasia', 'prosRazaoSocial', 'prosSegmento', 'prosCnpj',
  'prosInscricaoEstadual', 'prosSite', 'prosOrigem', 'prosEtapa',
  'prosValorEstimado', 'prosProbabilidade', 'prosResponsavel',
  'prosProximoPasso', 'prosProximoPassoData', 'prosAnotacoes',
  'endRua', 'endNumero', 'endComplemento', 'endBairro', 'endCidade',
  'endPais', 'endEstado', 'endCep',
  'prospeccaoContatosTabela', 'prospeccaoAvatar', 'addContatoProspeccaoBtn',
  'tab-pros-empresa', 'tab-pros-oportunidade'
];

/**
 * Objetos criados dentro do `vm` pertencem a outro realm e têm outro
 * Object.prototype, então `assert.deepEqual` os recusa mesmo com conteúdo
 * idêntico ("same structure but not reference-equal"). O round-trip por JSON
 * traz o valor para o realm do teste.
 */
const plano = v => JSON.parse(JSON.stringify(v));

function elemento() {
  const el = {
    value: '', checked: false, innerHTML: '', textContent: '', disabled: false,
    dataset: {}, options: [], selectedOptions: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(tipo, fn) { (this.__ouvintes ||= {})[tipo] = fn; },
    removeEventListener() {}, dispatchEvent() {}, focus() {}, scrollIntoView() {},
    setAttribute() {}, getAttribute: () => null, querySelector: () => null,
    querySelectorAll: () => [], appendChild() {}, closest: () => null,
    __ouvintes: {}
  };
  return el;
}

function montar(valores = {}, opcoes = {}) {
  const campos = new Map(IDS.map(id => [id, elemento()]));
  for (const [id, v] of Object.entries(valores)) {
    if (!campos.has(id)) campos.set(id, elemento());
    campos.get(id).value = v;
  }

  const overlay = elemento();
  const document = {
    readyState: 'complete',
    getElementById: id => campos.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => elemento(),
    head: elemento(),
    addEventListener() {}
  };

  const toasts = [];
  const sandbox = {
    document, console, setTimeout, clearTimeout,
    Event: class {}, CustomEvent: class {},
    addEventListener() {}, removeEventListener() {},
    showToast: (msg, tipo) => toasts.push({ msg, tipo }),
    Modal: { open() {}, close() {} },
    fetch: async () => { throw new Error('sem rede no teste'); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ARQUIVO, 'utf8'), sandbox, { filename: 'prospeccao-form-comum.js' });

  const form = sandbox.window.ProspeccaoForm.criar(overlay, { modo: opcoes.modo || 'novo' });
  return { form, campos, toasts, sandbox };
}

// ---------------------------------------------------------------------------
// Valor estimado
// ---------------------------------------------------------------------------

test('valor no formato brasileiro com milhar e decimal é lido corretamente', () => {
  const { form } = montar({ prosNomeFantasia: 'Empresa X', prosValorEstimado: '85.000,50' });
  const dados = form.coletarDados();
  assert.ok(dados, 'deveria ter passado na validação');
  assert.equal(dados.valor_estimado, 85000.5);
});

test('valor no formato americano também é lido', () => {
  const { form } = montar({ prosNomeFantasia: 'Empresa X', prosValorEstimado: '85,000.50' });
  assert.equal(form.coletarDados().valor_estimado, 85000.5);
});

test('valor só com vírgula decimal', () => {
  const { form } = montar({ prosNomeFantasia: 'Empresa X', prosValorEstimado: '1234,56' });
  assert.equal(form.coletarDados().valor_estimado, 1234.56);
});

test('valor inteiro simples', () => {
  const { form } = montar({ prosNomeFantasia: 'Empresa X', prosValorEstimado: '48000' });
  assert.equal(form.coletarDados().valor_estimado, 48000);
});

test('valor em branco vira zero, sem barrar o salvamento', () => {
  const { form } = montar({ prosNomeFantasia: 'Empresa X', prosValorEstimado: '' });
  const dados = form.coletarDados();
  assert.ok(dados);
  assert.equal(dados.valor_estimado, 0);
});

test('valor inválido BARRA o salvamento em vez de virar zero', () => {
  const { form, toasts } = montar({ prosNomeFantasia: 'Empresa X', prosValorEstimado: 'abc' });
  const dados = form.coletarDados();
  // Esta é a regressão que motivou o teste: antes devolvia o payload com
  // valor_estimado 0 e o negócio era gravado sem valor.
  assert.equal(dados, null);
  assert.match(toasts.at(-1).msg, /inválido/i);
});

test('valor negativo é recusado', () => {
  const { form, toasts } = montar({ prosNomeFantasia: 'Empresa X', prosValorEstimado: '-500' });
  assert.equal(form.coletarDados(), null);
  assert.match(toasts.at(-1).msg, /negativo/i);
});

// ---------------------------------------------------------------------------
// Probabilidade
// ---------------------------------------------------------------------------

test('probabilidade em branco é omitida para o backend aplicar o padrão da etapa', () => {
  const { form } = montar({ prosNomeFantasia: 'Empresa X', prosProbabilidade: '' });
  const dados = form.coletarDados();
  assert.equal(Object.prototype.hasOwnProperty.call(dados, 'probabilidade'), false);
});

test('probabilidade zero é enviada — não confundir com vazio', () => {
  const { form } = montar({ prosNomeFantasia: 'Empresa X', prosProbabilidade: '0' });
  assert.equal(form.coletarDados().probabilidade, 0);
});

test('probabilidade acima de 100 é recusada', () => {
  const { form, toasts } = montar({ prosNomeFantasia: 'Empresa X', prosProbabilidade: '150' });
  assert.equal(form.coletarDados(), null);
  assert.match(toasts.at(-1).msg, /entre 0 e 100/i);
});

// ---------------------------------------------------------------------------
// Obrigatórios
// ---------------------------------------------------------------------------

test('nome da empresa é obrigatório', () => {
  const { form, toasts } = montar({ prosNomeFantasia: '   ' });
  assert.equal(form.coletarDados(), null);
  assert.match(toasts.at(-1).msg, /nome da empresa/i);
});

test('campos opcionais em branco viram null, não string vazia', () => {
  const { form } = montar({ prosNomeFantasia: 'Empresa X' });
  const dados = form.coletarDados();
  assert.equal(dados.cnpj, null);
  assert.equal(dados.razao_social, null);
  assert.equal(dados.site, null);
  assert.equal(dados.responsavel_id, null);
});

// ---------------------------------------------------------------------------
// Contatos — inclusão, principal único e delta de edição
// ---------------------------------------------------------------------------

test('modo novo manda os contatos numa lista só', () => {
  const { form } = montar({ prosNomeFantasia: 'Empresa X' });
  form.setContatos([
    { nome: 'Ana', cargo: 'Diretora', principal: true, decisor: true, status: 'new' },
    { nome: 'Bruno', cargo: 'Compras', status: 'new' }
  ]);
  const dados = form.coletarDados();
  assert.equal(dados.contatos.length, 2);
  // `status` é controle interno e não pode vazar para a API.
  assert.equal(Object.prototype.hasOwnProperty.call(dados.contatos[0], 'status'), false);
  assert.equal(dados.contatosNovos, undefined);
});

test('modo editar separa novos, atualizados e excluídos', () => {
  const { form } = montar({ prosNomeFantasia: 'Empresa X' }, { modo: 'editar' });
  form.setContatos([
    { id: 1, nome: 'Existente', status: 'unchanged' },
    { id: 2, nome: 'Alterado', status: 'updated' },
    { nome: 'Novinho', status: 'new' }
  ]);
  form.setExcluidos([9]);

  const dados = form.coletarDados();
  assert.equal(dados.contatos, undefined);
  assert.deepEqual(plano(dados.contatosNovos).map(c => c.nome), ['Novinho']);
  assert.deepEqual(plano(dados.contatosAtualizados).map(c => c.nome), ['Alterado']);
  assert.deepEqual(plano(dados.contatosExcluidos), [9]);
  // O 'unchanged' não entra em lugar nenhum: não há o que gravar.
  assert.equal(dados.contatosNovos.length + dados.contatosAtualizados.length, 2);
});

test('contato novo sem id não entra em contatosAtualizados', () => {
  const { form } = montar({ prosNomeFantasia: 'Empresa X' }, { modo: 'editar' });
  // Um contato adicionado e depois editado na mesma sessão continua 'new':
  // marcá-lo 'updated' faria o backend tentar PUT num id inexistente.
  form.setContatos([{ nome: 'Recem', status: 'new' }]);
  const dados = form.coletarDados();
  assert.equal(dados.contatosNovos.length, 1);
  assert.equal(dados.contatosAtualizados.length, 0);
});

// ---------------------------------------------------------------------------
// Endereço
// ---------------------------------------------------------------------------

test('endereço vai aninhado, como o backend espera', () => {
  const { form } = montar({
    prosNomeFantasia: 'Empresa X',
    endRua: 'Rua das Pedras', endNumero: '500', endCidade: 'Campinas',
    endPais: 'Brasil', endEstado: 'São Paulo', endCep: '13000-000'
  });
  const dados = form.coletarDados();
  assert.deepEqual(plano(dados.endereco), {
    rua: 'Rua das Pedras', numero: '500', complemento: null, bairro: null,
    cidade: 'Campinas', pais: 'Brasil', estado: 'São Paulo', cep: '13000-000'
  });
});

// ---------------------------------------------------------------------------
// Coerência com o backend
// ---------------------------------------------------------------------------

test('a tabela de probabilidade por etapa bate com a do backend', () => {
  const { sandbox } = montar({ prosNomeFantasia: 'X' });
  const doFront = sandbox.window.ProspeccaoForm.PROBABILIDADE_POR_ETAPA;

  const backend = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'backend', 'prospeccoesController.js'), 'utf8'
  );
  const bloco = /const PROBABILIDADE_PADRAO = \{([\s\S]*?)\};/.exec(backend);
  assert.ok(bloco, 'PROBABILIDADE_PADRAO não encontrada no controller');

  const doBackend = {};
  for (const [, etapa, valor] of bloco[1].matchAll(/'([^']+)':\s*(\d+)/g)) {
    doBackend[etapa] = Number(valor);
  }

  // Se alguém mudar a régua de um lado só, a sugestão da tela passa a mentir
  // sobre o que o servidor vai gravar.
  assert.deepEqual(plano(doFront), doBackend);
});

test('as etapas padrão do formulário batem com as do backend', () => {
  const { sandbox } = montar({ prosNomeFantasia: 'X' });
  const doFront = sandbox.window.ProspeccaoForm.ETAPAS_PADRAO;

  const backend = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'backend', 'prospeccoesController.js'), 'utf8'
  );
  const bloco = /const ETAPAS = \[([\s\S]*?)\];/.exec(backend);
  const doBackend = [...bloco[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

  assert.deepEqual(plano(doFront), doBackend);
});
