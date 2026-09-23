/**
 * Busca de CEP nos endereços (src/js/utils/cep.js).
 *
 * O usuário digita o CEP e o bloco se preenche: rua, bairro, cidade, país,
 * estado e o código IBGE da NF-e. Número e complemento NÃO são tocados — são
 * do imóvel, não do CEP. Aqui o utilitário roda num DOM de mentira
 * (./apoio/domMinimo.js), com o fetch simulado; o resto prende a anatomia do
 * HTML dos cadastros e a ligação de cada tela.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente, esperarTarefas } = require('./apoio/domMinimo');

const RAIZ = path.join(__dirname, '..', '..');
const ler = relativo => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
const FONTE = ler('js/utils/cep.js');

const ENDERECO = {
  cep: '31160-370', logradouro: 'Rua Rubi', complemento: 'de 1 a 99', bairro: 'São Joaquim',
  cidade: 'Contagem', uf: 'MG', estado: 'Minas Gerais', codigo_municipio: '3118601'
};

const BLOCO = `
  <input id="regRua" type="text">
  <input id="regNumero" type="text">
  <input id="regComplemento" type="text">
  <input id="regBairro" type="text">
  <input id="regCidade" type="text">
  <select id="regPais"><option value="">Selecione</option><option value="Brazil" data-code="BR">Brazil</option></select>
  <select id="regEstado"><option value="">Selecione</option><option value="Minas Gerais">Minas Gerais</option><option value="São Paulo">São Paulo</option></select>
  <input id="regCep" type="text">
  <button id="regBuscarCep" type="button"></button>
  <p id="regCepRecado" class="hidden"></p>
  <input id="regCodigoMunicipio" type="text">`;

/** O utilitário rodando num DOM de mentira, com o fetch simulado. */
function montar({ resposta = { status: 200, corpo: ENDERECO } } = {}) {
  const { janela, documento, montar: injetar, disparar } = criarAmbiente();
  injetar(BLOCO);
  const chamadas = [];
  janela.apiConfig = { getApiBaseUrl: async () => '' };
  janela.fetch = async (url) => {
    chamadas.push(String(url));
    return { ok: resposta.status === 200, status: resposta.status, json: async () => resposta.corpo };
  };
  vm.createContext(janela);
  vm.runInContext(FONTE, janela);
  return { janela, documento, disparar, chamadas, valor: id => documento.getElementById(id)?.value };
}

test('CEP completo busca sozinho e preenche rua, bairro, cidade, estado e o código IBGE', async () => {
  const t = montar();
  t.janela.CepBusca.ligar('reg', { escopo: t.documento });
  const campo = t.documento.getElementById('regCep');
  campo.value = '31160370';
  t.disparar(campo, 'input');
  await esperarTarefas(20);

  assert.deepEqual(t.chamadas, ['/api/cep/31160370'], 'uma consulta só');
  assert.equal(campo.value, '31160-370', 'o campo fica com a máscara do CEP');
  assert.equal(t.valor('regRua'), 'Rua Rubi');
  assert.equal(t.valor('regBairro'), 'São Joaquim');
  assert.equal(t.valor('regCidade'), 'Contagem');
  assert.equal(t.valor('regPais'), 'Brazil', 'o país é achado pela sigla BR, não pelo nome');
  assert.equal(t.valor('regEstado'), 'Minas Gerais');
  assert.equal(t.valor('regCodigoMunicipio'), '3118601');
  // O que é do imóvel continua com quem digitou.
  assert.equal(t.valor('regNumero'), '');
  assert.equal(t.valor('regComplemento'), '', 'o "de 1 a 99" do ViaCEP não entra no complemento');

  const recado = t.documento.getElementById('regCepRecado');
  assert.match(recado.textContent, /Contagem\/MG/);
  assert.equal(recado.classList.contains('hidden'), false);
});

test('máscara do CEP e o mesmo CEP não é consultado duas vezes; o botão força de novo', async () => {
  const t = montar();
  assert.equal(t.janela.CepBusca.mascararCep('31160370999'), '31160-370');
  assert.equal(t.janela.CepBusca.mascararCep('311'), '311');

  t.janela.CepBusca.ligar('reg', { escopo: t.documento });
  const campo = t.documento.getElementById('regCep');
  campo.value = '31160370';
  t.disparar(campo, 'input');
  await esperarTarefas(20);
  t.disparar(campo, 'blur');
  await esperarTarefas(10);
  assert.equal(t.chamadas.length, 1, 'o blur não repete a consulta do mesmo CEP');

  t.documento.getElementById('regBuscarCep').dispatchEvent(new t.janela.Event('click', { bubbles: true }));
  await esperarTarefas(20);
  assert.equal(t.chamadas.length, 2, 'a lupa consulta de novo');
});

test('CEP que não existe: o recado explica e nada é preenchido', async () => {
  const t = montar({ resposta: { status: 404, corpo: { error: 'CEP não encontrado.' } } });
  t.janela.CepBusca.ligar('reg', { escopo: t.documento });
  const campo = t.documento.getElementById('regCep');
  campo.value = '99999999';
  t.disparar(campo, 'input');
  await esperarTarefas(20);

  assert.equal(t.documento.getElementById('regCepRecado').textContent, 'CEP não encontrado.');
  assert.equal(t.valor('regRua'), '');
  assert.equal(t.valor('regCidade'), '');
});

test('HTML dos cadastros: lupa e recado em cada bloco de endereço, e o utilitário ligado nas telas', () => {
  const blocos = [
    ['html/modals/clientes/novo.html', ['reg', 'cob', 'ent']],
    ['html/modals/clientes/editar.html', ['reg', 'cob', 'ent']],
    ['html/modals/clientes/detalhes.html', ['reg', 'cob', 'ent']],
    ['html/modals/prospeccoes/novo.html', ['end']],
    ['html/modals/prospeccoes/editar.html', ['end']]
  ];
  for (const [arquivo, prefixos] of blocos) {
    const html = ler(arquivo);
    for (const p of prefixos) {
      assert.ok(html.includes(`id="${p}Cep"`), `${arquivo}: sem #${p}Cep`);
      assert.ok(html.includes(`id="${p}BuscarCep"`), `${arquivo}: sem a lupa de ${p}`);
      assert.ok(html.includes(`id="${p}CepRecado"`), `${arquivo}: sem o recado de ${p}`);
    }
  }

  for (const [arquivo, trecho] of [
    ['js/modals/cliente-novo.js', "['reg','cob','ent'].forEach(p => window.CepBusca?.ligar(p));"],
    ['js/modals/cliente-editar.js', "['reg','cob','ent'].forEach(p => window.CepBusca?.ligar(p));"],
    ['js/modals/cliente-detalhes.js', "['reg','cob','ent'].forEach(p => window.CepBusca?.ligar(p));"],
    ['js/modals/prospeccao-form-comum.js', "window.CepBusca?.ligar('end');"]
  ]) {
    assert.ok(ler(arquivo).includes(trecho), `${arquivo} não liga a busca de CEP`);
  }
  assert.ok(ler('html/menu.html').includes('js/utils/cep.js'), 'o menu carrega o utilitário');
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(FONTE), 'listas montadas por createElement');
});
