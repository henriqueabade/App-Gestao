/**
 * Dados fiscais nos cadastros (etapa 2 da NF-e).
 *
 * src/js/utils/cliente-fiscal.js é um utilitário só para os três modais de
 * cliente: troca CNPJ/CPF pelo tipo de pessoa, preenche e coleta os campos
 * fiscais e busca o código IBGE em GET /api/fiscal/municipios. O resto do
 * arquivo prende a anatomia: os ids nos seis modais (cliente e peça), o script
 * carregado pelo menu e os modais de cliente usando o utilitário.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const SCRIPT = fs.readFileSync(path.join(RAIZ, 'js', 'utils', 'cliente-fiscal.js'), 'utf8');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

// ---------------------------------------------------------------------------
// Duplo de DOM: elementos por id, classList, dataset e eventos
// ---------------------------------------------------------------------------

function elemento(id, extra = {}) {
  const classes = new Set(extra.classes || []);
  const ouvintes = {};
  return {
    id, value: '', checked: false, type: extra.type || 'text', dataset: {},
    classList: {
      toggle(nome, forcar) { const por = forcar === undefined ? !classes.has(nome) : forcar; por ? classes.add(nome) : classes.delete(nome); return por; },
      contains: nome => classes.has(nome)
    },
    addEventListener(tipo, fn) { (ouvintes[tipo] ||= []).push(fn); },
    disparar(tipo) { (ouvintes[tipo] || []).forEach(fn => fn({ target: this })); }
  };
}

function montar({ rotas = {}, comBotaoAcao = false } = {}) {
  const ids = ['empresaTipoPessoa', 'empresaCnpjBloco', 'empresaCpfBloco', 'empresaCpf', 'empresaIndicadorIe', 'empresaEmailNfe',
    'regCidade', 'regEstado', 'regCodigoMunicipio', 'regBuscarIbge', 'entCidade', 'entEstado', 'entCodigoMunicipio', 'entBuscarIbge'];
  const dom = Object.fromEntries(ids.map(id => [id, elemento(id)]));
  dom.empresaCpfBloco.classList.toggle('hidden', true);
  dom.empresaConsumidorFinal = elemento('empresaConsumidorFinal', { type: 'checkbox' });
  const document = { querySelector: seletor => dom[seletor.replace(/^#/, '')] || null };
  const toasts = [];
  const chamadas = [];
  const window = {
    showToast: (texto, tipo) => toasts.push({ texto, tipo }),
    apiConfig: { getApiBaseUrl: async () => 'http://local' }
  };
  if (comBotaoAcao) window.BotaoAcao = { run: (botao, fn) => { chamadas.push(`run:${botao.id}`); return fn(); } };
  const fetch = async url => {
    chamadas.push(url);
    const caminho = url.replace('http://local', '');
    const rota = Object.keys(rotas).find(r => caminho.startsWith(r));
    const resposta = rota ? rotas[rota] : { status: 404, corpo: { error: 'não há' } };
    return { ok: (resposta.status || 200) < 400, status: resposta.status || 200, json: async () => resposta.corpo };
  };
  const contexto = { window, document, fetch, console, String, Boolean, Object, Error, Promise, encodeURIComponent };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(SCRIPT, contexto);
  return { dom, document, toasts, chamadas, fiscal: window.ClienteFiscal };
}

test('ligar: o tipo de pessoa mostra o CNPJ ou o CPF, e não liga duas vezes', () => {
  const { dom, document, fiscal } = montar();
  fiscal.ligar(document);
  fiscal.ligar(document);
  assert.strictEqual(dom.empresaCnpjBloco.classList.contains('hidden'), false);
  assert.strictEqual(dom.empresaCpfBloco.classList.contains('hidden'), true);
  dom.empresaTipoPessoa.value = 'PF';
  dom.empresaTipoPessoa.disparar('change');
  assert.strictEqual(dom.empresaCnpjBloco.classList.contains('hidden'), true);
  assert.strictEqual(dom.empresaCpfBloco.classList.contains('hidden'), false);
  assert.strictEqual(dom.empresaTipoPessoa.dataset.fiscalLigado, '1');
  assert.strictEqual(dom.regBuscarIbge.dataset.acaoGerida, 'true', 'o botão de busca é gerido pelo BotaoAcao');
});

test('preencher e coletar: PF com CPF só dígitos, indicador de IE, e-mail, consumidor final e códigos IBGE', () => {
  const { dom, document, fiscal } = montar();
  fiscal.preencher(document, {
    tipo_pessoa: 'PF', cpf: '12345678909', indicador_ie: 2, email_nfe: 'nf@cli.com', consumidor_final: true,
    endereco_registro: { codigo_municipio: '3106200' }, endereco_entrega: { codigo_municipio: '3170206' }
  });
  assert.strictEqual(dom.empresaTipoPessoa.value, 'PF');
  assert.strictEqual(dom.empresaCpf.value, '12345678909');
  assert.strictEqual(dom.empresaIndicadorIe.value, '2');
  assert.strictEqual(dom.empresaEmailNfe.value, 'nf@cli.com');
  assert.strictEqual(dom.empresaConsumidorFinal.checked, true);
  assert.strictEqual(dom.regCodigoMunicipio.value, '3106200');
  assert.strictEqual(dom.entCodigoMunicipio.value, '3170206');
  assert.strictEqual(dom.empresaCnpjBloco.classList.contains('hidden'), true, 'PF esconde o CNPJ ao preencher');

  dom.empresaCpf.value = '123.456.789-09';
  assert.deepStrictEqual(JSON.parse(JSON.stringify(fiscal.coletar(document))), {
    tipo_pessoa: 'PF', cpf: '12345678909', indicador_ie: '2', email_nfe: 'nf@cli.com', consumidor_final: true
  });

  // Cliente antigo, sem as colunas: volta aos padrões PJ / não contribuinte.
  fiscal.preencher(document, { tipo_pessoa: null, cpf: null, indicador_ie: null, email_nfe: null, consumidor_final: null });
  assert.strictEqual(dom.empresaTipoPessoa.value, 'PJ');
  assert.strictEqual(dom.empresaIndicadorIe.value, '9');
  assert.strictEqual(dom.empresaCpf.value, '');
  assert.strictEqual(dom.empresaConsumidorFinal.checked, false);
  assert.strictEqual(dom.regCodigoMunicipio.value, '');
  assert.strictEqual(dom.empresaCnpjBloco.classList.contains('hidden'), false);
});

test('buscarIbge: consulta a rota com cidade e estado, preenche o exato ou o único parecido e avisa o resto', async () => {
  const rotas = {
    '/api/fiscal/municipios?uf=Minas%20Gerais&nome=Uberl%C3%A2ndia': { corpo: { uf: 'MG', exato: { codigo: '3170206', nome: 'Uberlândia' }, candidatos: [] } },
    '/api/fiscal/municipios?uf=MG&nome=Montes': { corpo: { uf: 'MG', exato: null, candidatos: [{ codigo: '3143302', nome: 'Montes Claros' }] } },
    '/api/fiscal/municipios?uf=MG&nome=Uber': { corpo: { uf: 'MG', exato: null, candidatos: [{ codigo: '1', nome: 'Uberaba' }, { codigo: '2', nome: 'Uberlândia' }] } },
    '/api/fiscal/municipios?uf=MG&nome=Xyz': { corpo: { uf: 'MG', exato: null, candidatos: [] } },
    '/api/fiscal/municipios?uf=Marte': { status: 400, corpo: { error: 'Informe o estado (sigla ou nome).' } }
  };
  const { dom, document, toasts, chamadas, fiscal } = montar({ rotas, comBotaoAcao: true });
  fiscal.ligar(document);

  assert.strictEqual(await fiscal.buscarIbge(document, 'reg'), null);
  assert.match(toasts.at(-1).texto, /Preencha a cidade e o estado/);
  assert.strictEqual(chamadas.length, 0, 'sem cidade/estado não vai à rede');

  dom.regCidade.value = ' Uberlândia ';
  dom.regEstado.value = 'Minas Gerais';
  dom.regBuscarIbge.disparar('click');
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(chamadas[0], 'run:regBuscarIbge');
  assert.strictEqual(chamadas[1], 'http://local/api/fiscal/municipios?uf=Minas%20Gerais&nome=Uberl%C3%A2ndia');
  assert.strictEqual(dom.regCodigoMunicipio.value, '3170206');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(toasts.at(-1))), { texto: 'Código IBGE de Uberlândia/MG: 3170206.', tipo: 'success' });

  dom.entCidade.value = 'Montes'; dom.entEstado.value = 'MG';
  await fiscal.buscarIbge(document, 'ent');
  assert.strictEqual(dom.entCodigoMunicipio.value, '3143302', 'um único parecido serve');

  dom.entCidade.value = 'Uber';
  assert.strictEqual(await fiscal.buscarIbge(document, 'ent'), null);
  assert.match(toasts.at(-1).texto, /Parecidas: Uberaba, Uberlândia/);
  assert.strictEqual(dom.entCodigoMunicipio.value, '3143302', 'não apaga o que já estava');

  dom.entCidade.value = 'Xyz';
  await fiscal.buscarIbge(document, 'ent');
  assert.match(toasts.at(-1).texto, /Nenhum município "Xyz" em MG/);

  dom.entEstado.value = 'Marte';
  await fiscal.buscarIbge(document, 'ent');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(toasts.at(-1))), { texto: 'Informe o estado (sigla ou nome).', tipo: 'error' });
});

test('os três modais de cliente têm os campos fiscais e os códigos IBGE de registro e entrega', () => {
  for (const arquivo of ['novo', 'editar', 'detalhes']) {
    const html = ler('html', 'modals', 'clientes', `${arquivo}.html`);
    for (const id of ['empresaTipoPessoa', 'empresaCnpjBloco', 'empresaCpfBloco', 'empresaCpf', 'empresaIndicadorIe', 'empresaEmailNfe', 'empresaConsumidorFinal', 'regCodigoMunicipio', 'entCodigoMunicipio']) {
      assert.ok(html.includes(`id="${id}"`), `${arquivo}.html sem #${id}`);
    }
    assert.ok(/id="empresaCpfBloco" class="hidden"/.test(html), `${arquivo}.html: o CPF começa escondido (padrão PJ)`);
    assert.ok(html.indexOf('id="empresaTipoPessoa"') < html.indexOf('id="empresaCnpj"'), `${arquivo}.html: tipo de pessoa antes do CNPJ`);
    for (const valor of ['value="1"', 'value="2"', 'value="9"']) assert.ok(html.includes(valor), `${arquivo}.html: indicador de IE ${valor}`);
    assert.ok(!html.includes('cobCodigoMunicipio'), 'o endereço de cobrança não entra na NF-e');
  }
  for (const arquivo of ['novo', 'editar']) {
    const html = ler('html', 'modals', 'clientes', `${arquivo}.html`);
    assert.ok(html.includes('id="regBuscarIbge"') && html.includes('id="entBuscarIbge"'), `${arquivo}.html tem os botões de busca`);
  }
  const detalhes = ler('html', 'modals', 'clientes', 'detalhes.html');
  assert.ok(!detalhes.includes('BuscarIbge'), 'detalhes só mostra');
  for (const id of ['empresaTipoPessoa', 'empresaIndicadorIe']) assert.ok(detalhes.includes(`id="${id}" disabled`), `detalhes: #${id} travado como os outros selects`);
  assert.ok(detalhes.includes('id="empresaConsumidorFinal" type="checkbox" disabled'), 'detalhes: consumidor final travado');
});

test('os três modais de peça têm a linha fiscal (origem, unidade, CEST, GTIN, CFOPs, CSOSN)', () => {
  for (const arquivo of ['novo', 'editar', 'visualizar']) {
    const html = ler('html', 'modals', 'produtos', `${arquivo}.html`);
    for (const id of ['origemMercadoriaInput', 'unidadeComercialInput', 'cestInput', 'gtinInput', 'cfopDentroInput', 'cfopForaInput', 'csosnInput']) {
      assert.ok(html.includes(`id="${id}"`), `${arquivo}.html sem #${id}`);
    }
  }
  for (const [arquivo, trecho] of [['produto-novo.js', 'camposFiscais()'], ['produto-editar.js', 'preencherCamposFiscais('], ['produto-visualizar.js', 'origemMercadoriaInput']]) {
    assert.ok(ler('js', 'modals', arquivo).includes(trecho), `${arquivo} sem ${trecho}`);
  }
});

test('o menu carrega o utilitário e os modais de cliente o usam; CNPJ só é obrigatório para PJ', () => {
  const menu = ler('html', 'menu.html');
  assert.ok(menu.includes('js/utils/cliente-fiscal.js'), 'menu.html carrega cliente-fiscal.js');
  assert.ok(menu.indexOf('cliente-fiscal.js') > menu.indexOf('campo-zerado.js'), 'depois dos utilitários que ele não substitui');

  const novo = ler('js', 'modals', 'cliente-novo.js');
  assert.ok(novo.includes('window.ClienteFiscal?.ligar(document)') && novo.includes('window.ClienteFiscal?.coletar(document)'));
  assert.ok(novo.includes("pessoaFisica ? { empresaCpf: 'CPF' } : { empresaCnpj: 'CNPJ' }"), 'CNPJ para PJ, CPF para PF');
  assert.ok(novo.includes("if(k === 'codigo_municipio') continue;"), 'o código IBGE não é obrigatório no cadastro');
  assert.ok(/String\(fiscal\.indicador_ie\) === '1' \? \{ empresaInscricaoEstadual/.test(novo), 'IE obrigatória só para contribuinte');

  const editar = ler('js', 'modals', 'cliente-editar.js');
  assert.ok(editar.includes('window.ClienteFiscal?.preencher(document, cli)') && editar.includes('window.ClienteFiscal?.ligar(document)') && editar.includes('window.ClienteFiscal?.coletar(document)'));
  assert.ok(editar.includes('codigo_municipio: getVal(prefix+\'CodigoMunicipio\')'));
  assert.ok(ler('js', 'modals', 'cliente-detalhes.js').includes('window.ClienteFiscal?.preencher(document, cli)'));
});
