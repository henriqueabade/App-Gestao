/**
 * Grade de revisão do módulo IA (src/js/modals/ia-detalhes.js).
 *
 * É a última tela antes de o dado entrar no estoque de verdade, e a única que
 * decide o que vai ser gravado. Por isso ela roda aqui contra um DOM mínimo, e
 * não é conferida por expressão regular sobre o arquivo: o que precisa ser
 * provado é COMPORTAMENTO — que a correção do revisor chega ao servidor, que o
 * botão de aplicar trava com campo obrigatório vazio, que item já gravado
 * deixa de ser editável.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARQUIVO = path.join(__dirname, '..', 'modals', 'ia-detalhes.js');
const HTML_MODAL = path.join(__dirname, '..', '..', 'html', 'modals', 'ia', 'detalhes.html');

// ---------------------------------------------------------------------------
// DOM mínimo
// ---------------------------------------------------------------------------

function criarElemento(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    filhos: [],
    ouvintes: {},
    dataset: {},
    style: {},
    atributos: {},
    className: '',
    textContent: '',
    innerHTML: '',
    value: '',
    title: '',
    type: '',
    disabled: false,
    readOnly: false,
    selected: false,
    colSpan: 1,
    classList: {
      add(c) { if (!el.classList.contains(c)) el.className = `${el.className} ${c}`.trim(); },
      remove(c) { el.className = el.className.split(' ').filter(x => x && x !== c).join(' '); },
      toggle(c, ligado) {
        const alvo = ligado === undefined ? !el.classList.contains(c) : ligado;
        if (alvo) el.classList.add(c); else el.classList.remove(c);
      },
      contains: c => el.className.split(' ').filter(Boolean).includes(c)
    },
    setAttribute(nome, valor) { el.atributos[nome] = String(valor); },
    getAttribute: nome => el.atributos[nome] ?? null,
    addEventListener(evento, fn) { (el.ouvintes[evento] ||= []).push(fn); },
    removeEventListener(evento, fn) {
      el.ouvintes[evento] = (el.ouvintes[evento] || []).filter(f => f !== fn);
    },
    disparar(evento, detalhe = {}) {
      const e = { type: evento, preventDefault() {}, stopPropagation() {}, ...detalhe };
      for (const fn of el.ouvintes[evento] || []) fn(e);
      return e;
    },
    // O preenchimento avisa a tela por evento: sem isto, o formulário ficaria
    // com o valor visível e o estado interno vazio.
    dispatchEvent(e) { el.disparar(e?.type || 'evento', e); return true; },
    appendChild(f) { el.filhos.push(f); f.pai = el; return f; },
    append(...fs) { for (const f of fs) el.appendChild(f); },
    replaceChildren(...fs) { el.filhos = []; for (const f of fs) el.appendChild(f); },
    querySelector(sel) { return el.todos().find(f => casa(f, sel)) || null; },
    querySelectorAll(sel) { return el.todos().filter(f => casa(f, sel)); },
    todos() {
      const saida = [];
      const andar = no => { for (const f of no.filhos || []) { saida.push(f); andar(f); } };
      andar(el);
      return saida;
    },
    /** Espelha `textContent` do DOM real: concatena os descendentes SEM
     *  separador. Juntar com espaço inventaria um espaço que a tela não tem. */
    texto() {
      return [el.textContent, ...el.todos().map(f => f.textContent)].join('');
    }
  };
  return el;
}

/** Seletores usados pelo módulo: classe, atributo `[x="v"]` e `tag[attr="v"]`. */
function casa(el, seletor) {
  const s = String(seletor).trim();

  // Seletor de tag pura (`p`, `button`).
  if (/^[a-z]+$/.test(s)) return el.tagName === s.toUpperCase();

  const comAtributo = /^([a-z-]*)\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/.exec(s);
  if (comAtributo) {
    const [, tag, attr, valor] = comAtributo;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    const chaveDataset = attr.startsWith('data-')
      ? attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      : null;
    const atual = chaveDataset ? el.dataset[chaveDataset] : el.getAttribute(attr);
    if (atual === undefined || atual === null) return false;
    return valor === undefined || String(atual) === valor;
  }

  const comClasse = /^\.([\w-]+)(\[([a-zA-Z-]+)="([^"]*)"\])?$/.exec(s);
  if (comClasse) {
    const [, classe, , attr, valor] = comClasse;
    if (!el.classList.contains(classe)) return false;
    if (!attr) return true;
    const chaveDataset = attr.startsWith('data-')
      ? attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      : null;
    const atual = chaveDataset ? el.dataset[chaveDataset] : el.getAttribute(attr);
    return String(atual) === valor;
  }

  return false;
}

function idsDoModal() {
  const html = fs.readFileSync(HTML_MODAL, 'utf8');
  return [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
}

// ---------------------------------------------------------------------------
// Bancada
// ---------------------------------------------------------------------------

const CAMPOS = [
  { chave: 'nome', rotulo: 'Insumo', tipo: 'texto', obrigatorio: true, largura: 'grande' },
  { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero', obrigatorio: true, largura: 'pequena' },
  { chave: 'unidade', rotulo: 'Un.', tipo: 'texto', obrigatorio: false, largura: 'pequena' },
  { chave: 'preco_unitario', rotulo: 'Preço un.', tipo: 'dinheiro', obrigatorio: false, largura: 'pequena' },
  { chave: 'categoria', rotulo: 'Categoria', tipo: 'texto', obrigatorio: false, largura: 'media' },
  { chave: 'descricao', rotulo: 'Observação', tipo: 'texto', obrigatorio: false, largura: 'media' }
];

function leituraPadrao(extra = {}) {
  return {
    id: 4,
    titulo: 'Lista Bralux',
    destino: 'materia_prima',
    destino_rotulo: 'Matéria-prima (estoque)',
    status: 'revisao',
    status_rotulo: 'Em revisão',
    criado_em: '2026-08-20T10:00:00.000Z',
    usuario_nome: 'Henrique',
    campos: CAMPOS,
    pode_estruturar: true,
    pode_aplicar_destino: true,
    explicacoes: { criar: 'Cadastra o insumo', atualizar: 'Dá entrada no que existe' },
    sugestoes: { categoria: ['Chapas', 'Ferragens'], unidade: ['CH', 'UN'] },
    alvos: [{ id: 70, nome: 'MDF 15mm Branco TX' }, { id: 71, nome: 'Cola PVA extra 1kg' }],
    arquivos: [{ id: 41, nome_arquivo: 'bralux.xlsx', origem: 'planilha', tamanho_bytes: 900, texto_tamanho: 120 }],
    itens: [
      {
        id: 1, linha: 1, acao: 'atualizar', alvo_id: 70, status: 'pendente', mensagem: null,
        dados: { nome: 'MDF 15mm Branco TX', quantidade: 40, unidade: 'CH', preco_unitario: 189.9, categoria: 'Chapas', descricao: null }
      },
      {
        id: 2, linha: 2, acao: 'criar', alvo_id: null, status: 'pendente', mensagem: null,
        dados: { nome: 'Fita de borda 22mm', quantidade: 500, unidade: 'M', preco_unitario: 1.35, categoria: 'Acabamento', descricao: null }
      }
    ],
    ...extra
  };
}

function criarBancada({ leitura, respostaPut, respostaAplicar, respostaExtrair,
  respostaPreenchimento, confirmar = true } = {}) {
  const elementos = new Map();
  for (const id of idsDoModal()) elementos.set(id, criarElemento());

  // O duplo cria um elemento por `id` do HTML. Os poucos filhos que o módulo
  // procura por tag precisam existir também, senão o teste mede o buraco do
  // harness em vez do comportamento.
  const paragrafo = criarElemento('p');
  elementos.get('iaDetItensVazio')?.appendChild(paragrafo);

  const raiz = criarElemento('body');
  for (const [, el] of elementos) raiz.appendChild(el);

  const chamadas = [];
  const toasts = [];
  const confirmacoes = [];
  const gradesRecarregadas = [];
  const modaisAbertos = [];
  const preenchimentos = [];
  const ouvintesDaJanela = {};
  let dadosLeitura = leitura || leituraPadrao();

  const document = {
    addEventListener() {},
    removeEventListener() {},
    getElementById: id => elementos.get(id) || null,
    createElement: tag => criarElemento(tag),
    // O resumo monta a frase com nó de texto entre os números — sem isto o
    // módulo estoura e o erro vira um toast, deixando a grade vazia.
    createTextNode: texto => {
      const no = criarElemento('#text');
      no.textContent = String(texto);
      return no;
    },
    querySelector: sel => raiz.querySelector(sel),
    querySelectorAll: sel => raiz.querySelectorAll(sel)
  };

  const sandbox = {
    document,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    Promise,
    Math,
    Number,
    String,
    Boolean,
    JSON,
    Array,
    Object,
    Error,
    Date,
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i?.detail; } },
    Event: class { constructor(t, i) { this.type = t; this.bubbles = Boolean(i?.bubbles); } },
    dispatchEvent(evento) {
      for (const fn of ouvintesDaJanela[evento?.type] || []) fn(evento);
      return true;
    },
    addEventListener(tipo, fn) { (ouvintesDaJanela[tipo] ||= []).push(fn); },
    removeEventListener(tipo, fn) {
      ouvintesDaJanela[tipo] = (ouvintesDaJanela[tipo] || []).filter(f => f !== fn);
    },
    showToast: (msg, tipo) => toasts.push({ msg, tipo }),
    Modal: {
      close() {},
      // O modal de destino anuncia que terminou de montar, como fazem os
      // módulos de verdade. Sem isso o preenchimento só aconteceria no
      // desencalhe por tempo, e o teste mediria a espera em vez do caminho.
      open(html, script, overlay) {
        modaisAbertos.push({ html, script, overlay });
        setTimeout(() => sandbox.dispatchEvent({ type: 'modalSpinnerLoaded', detail: overlay }), 0);
      }
    },
    EstadoTrabalho: {
      registrarContexto() {},
      registrarConteudo() {},
      preencher: async (overlay, carga) => {
        preenchimentos.push({ overlay, ...carga });
        return { campos: (carga?.campos || []).length, conteudo: Boolean(carga?.conteudo) };
      }
    },
    apiConfig: { getApiBaseUrl: async () => 'http://local' },
    IaModulo: { carregar: async () => { gradesRecarregadas.push(true); } },
    DialogPadrao: {
      confirm: async opcoes => { confirmacoes.push(opcoes); return confirmar; }
    },
    iaLeituraSelecionada: { id: 4, titulo: 'Lista Bralux', status: 'revisao' },
    fetch: async (url, opcoes = {}) => {
      const metodo = opcoes.method || 'GET';
      const corpo = opcoes.body ? JSON.parse(opcoes.body) : null;
      chamadas.push({ url, metodo, corpo });

      if (metodo === 'GET' && /\/api\/ia\/4$/.test(url)) {
        return { ok: true, status: 200, json: async () => dadosLeitura };
      }
      if (metodo === 'PUT' && /\/itens\/(\d+)$/.test(url)) {
        const r = respostaPut || {};
        if (r.status && r.status >= 400) {
          return { ok: false, status: r.status, json: async () => r.corpo };
        }
        const id = Number(/\/itens\/(\d+)$/.exec(url)[1]);
        const item = dadosLeitura.itens.find(i => i.id === id);
        const salvo = {
          ...item,
          ...(corpo.acao ? { acao: corpo.acao, alvo_id: corpo.acao === 'atualizar' ? item.alvo_id : null } : {}),
          ...(corpo.alvo_id !== undefined ? { alvo_id: corpo.alvo_id, acao: 'atualizar' } : {}),
          dados: { ...item.dados, ...(corpo.dados || {}) },
          mensagem: null
        };
        Object.assign(item, salvo);
        return { ok: true, status: 200, json: async () => salvo };
      }
      if (metodo === 'POST' && /\/estruturar$/.test(url)) {
        const r = respostaExtrair || { status: 200, corpo: { status: 'revisao', itens_qtd: 2, avisos: [] } };
        return { ok: r.status < 400, status: r.status, json: async () => r.corpo };
      }
      if (metodo === 'GET' && /\/preenchimento$/.test(url)) {
        const r = respostaPreenchimento || {
          status: 200,
          corpo: {
            modal: { overlay: 'novoInsumo', html: 'modals/materia-prima/novo.html',
              script: '../js/modals/materia-prima-novo.js', rotulo: 'Novo Insumo' },
            campos: { nome: 'MDF 15mm Branco TX', quantidade: 40, preco_unitario: 189.9 },
            alvo: null, avisos: []
          }
        };
        return { ok: r.status < 400, status: r.status, json: async () => r.corpo };
      }
      if (metodo === 'POST' && /\/aplicar$/.test(url)) {
        const r = respostaAplicar || { status: 200, corpo: { aplicados: 2, com_erro: 0, ignorados: 0, status: 'aplicada' } };
        return { ok: r.status < 400, status: r.status, json: async () => r.corpo };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ARQUIVO, 'utf8'), sandbox, { filename: 'ia-detalhes.js' });

  return {
    el: id => elementos.get(id),
    chamadas,
    toasts,
    confirmacoes,
    gradesRecarregadas,
    modaisAbertos,
    preenchimentos,
    trocarLeitura: nova => { dadosLeitura = nova; },
    pronta: () => new Promise(r => setTimeout(r, 10))
  };
}

/**
 * Leitura de EMPRESA: um campo `lista` com os contatos dentro.
 *
 * É a forma que Clientes e Prospecções usam, e a mesma que os itens de
 * orçamento vão usar. O que se testa aqui não é "contato": é sub-lista.
 */
const SUBCAMPOS_CONTATO = [
  { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
  { chave: 'cargo', rotulo: 'Cargo', tipo: 'texto', obrigatorio: false },
  { chave: 'email', rotulo: 'E-mail', tipo: 'texto', obrigatorio: false }
];

function leituraEmpresa(extra = {}) {
  return leituraPadrao({
    destino: 'clientes',
    destino_rotulo: 'Clientes e contatos',
    campos: [
      { chave: 'nome_fantasia', rotulo: 'Empresa', tipo: 'texto', obrigatorio: true, largura: 'grande' },
      { chave: 'cnpj', rotulo: 'CNPJ', tipo: 'texto', obrigatorio: false, largura: 'media' },
      { chave: 'contatos', rotulo: 'Contatos', tipo: 'lista', obrigatorio: false, largura: 'media', subcampos: SUBCAMPOS_CONTATO }
    ],
    alvos: [{ id: 50, nome: 'Casa Vicenzo' }],
    sugestoes: {},
    itens: [
      {
        id: 1, linha: 1, acao: 'criar', alvo_id: null, status: 'pendente', mensagem: null,
        dados: {
          nome_fantasia: 'Decor Alpina', cnpj: '33.333.333/0001-33',
          contatos: [
            { nome: 'Juliana Prass', cargo: 'Compras', email: 'juliana@x.com' },
            { nome: 'Marco Rossi', cargo: 'Diretor', email: null }
          ]
        }
      },
      {
        id: 2, linha: 2, acao: 'criar', alvo_id: null, status: 'pendente', mensagem: null,
        dados: { nome_fantasia: 'Sozinha Ltda', cnpj: null, contatos: [] }
      }
    ],
    ...extra
  });
}

/**
 * Leitura de FICHA TÉCNICA: destino que só atualiza.
 *
 * Não cadastra produto — a ficha não tem preço, coleção nem markup. O item
 * precisa apontar para um produto que já existe, e é isso que o seletor de
 * destino resolve.
 */
function leituraFicha(extra = {}) {
  return leituraPadrao({
    destino: 'produto_insumos',
    destino_rotulo: 'Insumos de produtos',
    exige_alvo: true,
    rotulo_alvo: 'Produto',
    acoes: ['atualizar', 'ignorar'],
    campos: [
      { chave: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: false, largura: 'media' },
      { chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true, largura: 'grande' },
      {
        chave: 'insumos', rotulo: 'Insumos', tipo: 'lista', obrigatorio: true, largura: 'media',
        subcampos: [
          { chave: 'nome', rotulo: 'Insumo', tipo: 'texto', obrigatorio: true },
          { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero', obrigatorio: true }
        ]
      }
    ],
    alvos: [
      { id: 9, nome: 'Painel Ripado 2,10' },
      { id: 10, nome: 'Mesa Lateral Carvalho' }
    ],
    sugestoes: {},
    explicacoes: { criar: 'Indisponível', atualizar: 'Acrescenta os insumos que faltam' },
    itens: [
      {
        id: 1, linha: 1, acao: 'atualizar', alvo_id: 9, status: 'pendente', mensagem: null,
        dados: { codigo: 'PR-210', nome: 'Painel Ripado', insumos: [{ nome: 'MDF 15mm', quantidade: 2 }] }
      },
      {
        id: 2, linha: 2, acao: 'ignorar', alvo_id: null, status: 'pendente',
        mensagem: 'Produto não encontrado no catálogo — escolha o produto na coluna "O que fazer".',
        dados: { codigo: null, nome: 'Banqueta Alta', insumos: [{ nome: 'Tubo 1/2', quantidade: 4 }] }
      }
    ],
    ...extra
  });
}

/**
 * Leitura de ORÇAMENTO: o alvo é VÍNCULO.
 *
 * O item não aponta para um orçamento que já existe — aponta para o CLIENTE a
 * quem o orçamento novo vai se prender. É por isso que a ação proposta ao casar
 * é "criar" e não "atualizar", e por isso que escolher "cadastrar" não pode
 * soltar o alvo.
 */
function leituraOrcamento(extra = {}) {
  return leituraPadrao({
    destino: 'orcamentos',
    destino_rotulo: 'Orçamentos',
    exige_alvo: true,
    alvo_eh_vinculo: true,
    rotulo_alvo: 'Cliente',
    acoes: ['criar', 'ignorar'],
    campos: [
      { chave: 'cliente', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true, largura: 'grande' },
      { chave: 'cnpj', rotulo: 'CNPJ', tipo: 'texto', obrigatorio: false, largura: 'media' },
      {
        chave: 'itens', rotulo: 'Itens', tipo: 'lista', obrigatorio: true, largura: 'media',
        subcampos: [
          { chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true },
          { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero', obrigatorio: true },
          { chave: 'valor_unitario', rotulo: 'Valor un.', tipo: 'dinheiro', obrigatorio: false }
        ]
      }
    ],
    alvos: [
      { id: 50, nome: 'Casa Vicenzo (Cliente)', tabela: 'clientes' },
      { id: 30, nome: 'Marcenaria Serrana (Prospecção)', tabela: 'prospeccoes' }
    ],
    sugestoes: {},
    explicacoes: { criar: 'Cria um orçamento pendente', atualizar: 'Indisponível' },
    itens: [
      {
        id: 1, linha: 1, acao: 'criar', alvo_id: 50, status: 'pendente', mensagem: null,
        dados: { cliente: 'Casa Vicenzo', cnpj: '11.111.111/0001-11', itens: [{ nome: 'Painel', quantidade: 3, valor_unitario: 850 }] }
      },
      {
        id: 2, linha: 2, acao: 'ignorar', alvo_id: null, status: 'pendente',
        mensagem: 'Cliente não encontrado — escolha o cliente na coluna "O que fazer".',
        dados: { cliente: 'Empresa Nova', cnpj: null, itens: [{ nome: 'Mesa', quantidade: 1, valor_unitario: null }] }
      }
    ],
    ...extra
  });
}

/** Botão que abre/fecha a sub-lista de uma linha. */
const botaoDaLista = linha => linha.todos().find(f => f.classList.contains('ia-lista-abrir'));
const botaoAdicionar = linha => linha.todos().find(f => f.classList.contains('ia-lista-adicionar'));
const subLinhas = b => b.el('iaDetItensCorpo').filhos.filter(l => l.classList.contains('ia-sublinha'));

/** Linhas de item (as de nota não têm campos). */
const linhasDeItem = b => b.el('iaDetItensCorpo').filhos.filter(l => l.classList.contains('ia-linha-item'));
const notas = b => b.el('iaDetItensCorpo').filhos.filter(l => !l.classList.contains('ia-linha-item'));
/** Campos do item. O seletor de destino também é `.ia-campo`, mas não é coluna. */
const camposDa = linha => linha.todos()
  .filter(f => f.classList.contains('ia-campo') && !f.classList.contains('ia-alvo'));
const seletorDeAlvo = linha => linha.todos().find(f => f.classList.contains('ia-alvo'));
const seletorDa = linha => linha.todos().find(f => f.classList.contains('ia-acao-select'));

// ---------------------------------------------------------------------------
// Estrutura da grade
// ---------------------------------------------------------------------------

test('as colunas vêm do esquema do destino, não do HTML', async () => {
  const b = criarBancada();
  await b.pronta();

  const cabecalho = b.el('iaDetItensCabecalho').filhos.map(th => th.textContent);
  assert.deepEqual(cabecalho,
    ['#', 'Insumo', 'Qtde', 'Un.', 'Preço un.', 'Categoria', 'Observação', 'O que fazer', 'Situação']);

  // Colunas escritas no HTML obrigariam a mexer no arquivo a cada destino
  // novo — e deixariam as duas listas divergirem.
  const html = fs.readFileSync(HTML_MODAL, 'utf8');
  assert.equal(/>\s*Insumo\s*</.test(html), false, 'a coluna foi escrita no HTML');
});

test('cada item vira uma linha com um campo por coluna', async () => {
  const b = criarBancada();
  await b.pronta();

  const linhas = linhasDeItem(b);
  assert.equal(linhas.length, 2);
  assert.equal(camposDa(linhas[0]).length, CAMPOS.length);
  assert.equal(camposDa(linhas[0])[0].value, 'MDF 15mm Branco TX');
  assert.equal(camposDa(linhas[0])[1].value, '40');
});

test('campo obrigatório vazio fica marcado', async () => {
  const leitura = leituraPadrao();
  leitura.itens[1].dados.quantidade = null;
  const b = criarBancada({ leitura });
  await b.pronta();

  const quantidade = camposDa(linhasDeItem(b)[1])[1];
  assert.ok(quantidade.classList.contains('ia-campo--faltando'));
});

// ---------------------------------------------------------------------------
// Correção
// ---------------------------------------------------------------------------

test('corrigir um campo manda a alteração ao servidor', async () => {
  const b = criarBancada();
  await b.pronta();

  const preco = camposDa(linhasDeItem(b)[0])[3];
  preco.value = '199,90';
  preco.disparar('change');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.ok(put, 'a correção não saiu do navegador');
  assert.match(put.url, /\/api\/ia\/4\/itens\/1$/);
  // Manda o valor CRU: quem converte "199,90" é o backend, com a mesma
  // coerção que valida o que o modelo devolveu.
  assert.deepEqual(put.corpo, { dados: { preco_unitario: '199,90' } });
});

test('campo que não mudou não gera requisição', async () => {
  const b = criarBancada();
  await b.pronta();

  const nome = camposDa(linhasDeItem(b)[0])[0];
  nome.disparar('change');
  await b.pronta();

  assert.equal(b.chamadas.filter(c => c.metodo === 'PUT').length, 0);
});

test('valor recusado pelo backend volta ao que estava, com aviso', async () => {
  const b = criarBancada({
    respostaPut: { status: 400, corpo: { error: 'Qtde: valor não reconhecido' } }
  });
  await b.pronta();

  const quantidade = camposDa(linhasDeItem(b)[0])[1];
  quantidade.value = 'umas cinquenta';
  quantidade.disparar('change');
  await b.pronta();

  // Deixar o valor inválido na tela faria o revisor acreditar que gravou.
  assert.equal(quantidade.value, '40');
  assert.equal(b.toasts.at(-1).tipo, 'error');
  assert.match(b.toasts.at(-1).msg, /Qtde/);
});

test('o campo pisca ao gravar, para a correção não parecer perdida', async () => {
  const b = criarBancada();
  await b.pronta();

  const unidade = camposDa(linhasDeItem(b)[0])[2];
  unidade.value = 'PC';
  unidade.disparar('change');
  await b.pronta();

  assert.ok(unidade.classList.contains('ia-campo--salvo'));
});

// ---------------------------------------------------------------------------
// Ação
// ---------------------------------------------------------------------------

test('"dar entrada" fica desabilitado sem insumo de destino', async () => {
  const b = criarBancada();
  await b.pronta();

  // O item 2 é novo: sem alvo, "dar entrada" não tem onde entrar, e deixar a
  // opção clicável só produziria erro na hora de aplicar.
  const opcoes = seletorDa(linhasDeItem(b)[1]).filhos;
  const atualizar = opcoes.find(o => o.value === 'atualizar');
  assert.equal(atualizar.disabled, true);

  const doPrimeiro = seletorDa(linhasDeItem(b)[0]).filhos.find(o => o.value === 'atualizar');
  assert.equal(doPrimeiro.disabled, false);
  // E diz em qual insumo vai entrar, não só "no existente".
  assert.match(doPrimeiro.textContent, /MDF 15mm Branco TX/);
});

test('trocar a ação manda a mudança e redesenha', async () => {
  const b = criarBancada();
  await b.pronta();

  const select = seletorDa(linhasDeItem(b)[0]);
  select.value = 'ignorar';
  select.disparar('change');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.deepEqual(put.corpo, { acao: 'ignorar' });
  assert.ok(linhasDeItem(b)[0].classList.contains('ia-linha-item--ignorada'));
});

test('a ressalva "parecido com" vira um botão de aceitar', async () => {
  const leitura = leituraPadrao();
  leitura.itens[1].mensagem = 'Parecido com "MDF 15mm Branco TX" (#70) — confira se não é o mesmo';
  const b = criarBancada({ leitura });
  await b.pronta();

  const botao = notas(b)[0]?.todos().find(f => f.tagName === 'BUTTON');
  assert.ok(botao, 'a ressalva não virou ação');
  assert.equal(botao.textContent, 'É o mesmo');

  botao.disparar('click');
  await b.pronta();

  // Sem este atalho, a única saída seria cadastrar um quase-duplicado e
  // consertar depois no módulo de Matéria-prima.
  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.deepEqual(put.corpo, { alvo_id: 70, acao: 'atualizar' });
});

// ---------------------------------------------------------------------------
// Item já aplicado
// ---------------------------------------------------------------------------

test('item já gravado não volta a ser editável', async () => {
  const leitura = leituraPadrao();
  leitura.itens[0].status = 'aplicado';
  const b = criarBancada({ leitura });
  await b.pronta();

  const linha = linhasDeItem(b)[0];
  // Mexer nele daria a impressão de corrigir um estoque que já entrou.
  assert.ok(camposDa(linha).every(c => c.readOnly));
  assert.equal(seletorDa(linha).disabled, true);
  assert.ok(linha.classList.contains('ia-linha-item--aplicada'));
});

test('leitura aplicada abre inteira em leitura apenas', async () => {
  const b = criarBancada({ leitura: leituraPadrao({ status: 'aplicada', status_rotulo: 'Aplicada' }) });
  await b.pronta();

  assert.ok(linhasDeItem(b).every(l => camposDa(l).every(c => c.readOnly)));
  assert.ok(b.el('iaDetAplicar').classList.contains('hidden'));
});

// ---------------------------------------------------------------------------
// Resumo e trava do botão
// ---------------------------------------------------------------------------

test('o resumo conta o que vai acontecer antes do clique', async () => {
  const b = criarBancada();
  await b.pronta();

  // Sem isso, o revisor só descobre que 12 itens iam cadastrar em vez de dar
  // entrada depois que o estoque já ganhou 12 insumos novos.
  const texto = b.el('iaDetResumoRevisao').texto();
  assert.match(texto, /1 a cadastrar/);
  assert.match(texto, /1 a dar entrada/);
});

test('o resumo acompanha a mudança de ação', async () => {
  const b = criarBancada();
  await b.pronta();

  const select = seletorDa(linhasDeItem(b)[1]);
  select.value = 'ignorar';
  select.disparar('change');
  await b.pronta();

  assert.match(b.el('iaDetResumoRevisao').texto(), /1 descartados/);
});

test('campo obrigatório vazio trava o botão de aplicar', async () => {
  const leitura = leituraPadrao();
  leitura.itens[1].dados.nome = '';
  const b = criarBancada({ leitura });
  await b.pronta();

  // Item incompleto falha na hora de gravar. Travar aqui evita aplicar, ver o
  // erro e ter de voltar.
  const botao = b.el('iaDetGravarTodos');
  assert.equal(botao.disabled, true);
  assert.match(botao.title, /obrigatório/i);
  assert.match(b.el('iaDetResumoRevisao').texto(), /1 sem campo obrigatório/);
});

test('sem nada a gravar o botão também trava', async () => {
  const leitura = leituraPadrao();
  leitura.itens.forEach(i => { i.acao = 'ignorar'; });
  const b = criarBancada({ leitura });
  await b.pronta();

  assert.equal(b.el('iaDetGravarTodos').disabled, true);
  assert.match(b.el('iaDetGravarTodos').title, /descartados|já aplicados/i);
});

// ---------------------------------------------------------------------------
// Extrair e aplicar
// ---------------------------------------------------------------------------

test('com o texto lido e sem itens, aparece "Extrair os dados"', async () => {
  const b = criarBancada({
    leitura: leituraPadrao({ status: 'rascunho', status_rotulo: 'Texto lido', itens: [] })
  });
  await b.pronta();

  assert.equal(b.el('iaDetExtrair').classList.contains('hidden'), false);
  assert.equal(b.el('iaDetAplicar').classList.contains('hidden'), true);
  assert.match(b.el('iaDetExtrair').innerHTML, /Extrair os dados/);
  // O estado vazio manda para a ação certa, em vez de dizer "nada foi lido".
  assert.match(b.el('iaDetItensVazio').texto(), /Extrair os dados/);
});

test('extrair de novo avisa que as correções serão perdidas', async () => {
  const b = criarBancada();
  await b.pronta();

  assert.match(b.el('iaDetExtrair').innerHTML, /Extrair de novo/);
  b.el('iaDetExtrair').disparar('click');
  await b.pronta();

  const pergunta = b.confirmacoes.at(-1);
  assert.ok(pergunta, 'refez a lista sem perguntar');
  assert.match(pergunta.message, /perdidas/i);
});

test('depois de extrair, a grade do módulo é atualizada', async () => {
  // A leitura muda de situação e ganha itens: deixar a lista de trás
  // desatualizada faria o usuário achar que a extração não rodou.
  const b = criarBancada();
  await b.pronta();

  b.el('iaDetExtrair').disparar('click');
  await b.pronta();

  assert.ok(b.chamadas.some(c => /estruturar$/.test(c.url)), 'não chamou a extração');
  assert.ok(b.gradesRecarregadas.length >= 1, 'a grade do módulo não foi atualizada');
});

test('recusar a confirmação não chama o servidor', async () => {
  const b = criarBancada({ confirmar: false });
  await b.pronta();

  b.el('iaDetExtrair').disparar('click');
  await b.pronta();

  assert.equal(b.chamadas.some(c => /estruturar/.test(c.url)), false);
});

test('aplicar pergunta antes, dizendo quantos e para onde', async () => {
  const b = criarBancada();
  await b.pronta();

  b.el('iaDetGravarTodos').disparar('click');
  await b.pronta();

  const pergunta = b.confirmacoes.at(-1);
  assert.ok(pergunta, 'gravou no estoque sem perguntar');
  assert.match(pergunta.message, /2 item/);
  assert.match(pergunta.message, /Matéria-prima/);
  // Mexer em estoque não é desfeito automaticamente — o texto precisa dizer.
  assert.match(pergunta.message, /não é desfeito/i);
});

test('aplicar manda o destino junto e atualiza a grade', async () => {
  const b = criarBancada();
  await b.pronta();

  b.el('iaDetGravarTodos').disparar('click');
  await b.pronta();

  const post = b.chamadas.find(c => /aplicar$/.test(c.url));
  assert.deepEqual(post.corpo, { destino: 'materia_prima' });
  assert.equal(b.gradesRecarregadas.length >= 1, true);
  assert.equal(b.toasts.at(-1).tipo, 'success');
});

test('aplicação parcial avisa quantos ficaram com erro', async () => {
  const b = criarBancada({
    respostaAplicar: { status: 200, corpo: { aplicados: 1, com_erro: 1, ignorados: 0, status: 'revisao' } }
  });
  await b.pronta();

  b.el('iaDetGravarTodos').disparar('click');
  await b.pronta();

  assert.equal(b.toasts.at(-1).tipo, 'error');
  assert.match(b.toasts.at(-1).msg, /1 gravados, 1 com erro/);
});

test('o destino que ainda não grava esconde o botão e explica', async () => {
  const b = criarBancada({ leitura: leituraPadrao({ pode_aplicar_destino: false }) });
  await b.pronta();

  assert.equal(b.el('iaDetAplicar').classList.contains('hidden'), true);
  assert.match(b.el('iaDetRodapeAviso').textContent, /próxima etapa/i);
});

// ---------------------------------------------------------------------------
// Sub-lista (contatos da empresa)
// ---------------------------------------------------------------------------

test('a célula da lista diz quantos são, sem abrir', async () => {
  // Vinte empresas com três contatos cada dariam oitenta linhas na tela — a
  // grade deixaria de ser conferível. Fechada por padrão.
  const b = criarBancada({ leitura: leituraEmpresa() });
  await b.pronta();

  assert.equal(subLinhas(b).length, 0);
  assert.match(botaoDaLista(linhasDeItem(b)[0]).texto(), /2 contatos/);
  assert.match(botaoDaLista(linhasDeItem(b)[1]).texto(), /sem contatos/);
});

test('o resumo dos contatos aparece no title, para conferir sem abrir', async () => {
  const b = criarBancada({ leitura: leituraEmpresa() });
  await b.pronta();

  const botao = botaoDaLista(linhasDeItem(b)[0]);
  assert.match(botao.title, /Juliana Prass · Compras/);
  assert.match(botao.title, /Marco Rossi/);
});

test('abrir a lista mostra a sub-tabela com as colunas dos subcampos', async () => {
  const b = criarBancada({ leitura: leituraEmpresa() });
  await b.pronta();

  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const sub = subLinhas(b);
  assert.equal(sub.length, 1);

  // As colunas saem de `subcampos`, pelo mesmo caminho que desenha as de cima.
  const cabecalhos = sub[0].todos().filter(f => f.tagName === 'TH').map(f => f.textContent);
  assert.deepEqual(cabecalhos.slice(0, 3), ['Nome', 'Cargo', 'E-mail']);

  const campos = sub[0].todos().filter(f => f.classList.contains('ia-campo'));
  assert.equal(campos.length, 6 + 0, 'dois contatos × três campos');
  assert.equal(campos[0].value, 'Juliana Prass');
});

test('a lista aberta continua aberta depois de redesenhar', async () => {
  // A grade é redesenhada inteira a cada mudança de ação. Sem guardar o
  // estado, a lista que o revisor acabou de abrir se fecharia sozinha.
  const b = criarBancada({ leitura: leituraEmpresa() });
  await b.pronta();

  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const select = seletorDa(linhasDeItem(b)[1]);
  select.value = 'ignorar';
  select.disparar('change');
  await b.pronta();

  assert.equal(subLinhas(b).length, 1, 'a sub-lista fechou ao redesenhar');
});

test('editar um contato manda a lista INTEIRA, não só o campo', async () => {
  // O backend valida a lista entrada por entrada; mandar um campo solto
  // deixaria os outros contatos de fora do que foi gravado.
  const b = criarBancada({ leitura: leituraEmpresa() });
  await b.pronta();

  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const cargo = subLinhas(b)[0].todos().filter(f => f.classList.contains('ia-campo'))[1];
  cargo.value = 'Gerente de Compras';
  cargo.disparar('change');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.ok(put, 'a correção do contato não saiu do navegador');
  assert.equal(put.corpo.dados.contatos.length, 2);
  assert.equal(put.corpo.dados.contatos[0].cargo, 'Gerente de Compras');
  assert.equal(put.corpo.dados.contatos[1].nome, 'Marco Rossi');
});

test('remover um contato manda a lista sem ele', async () => {
  const b = criarBancada({ leitura: leituraEmpresa() });
  await b.pronta();

  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const remover = subLinhas(b)[0].todos().find(f => f.classList.contains('ia-arquivo__remover'));
  remover.disparar('click');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.equal(put.corpo.dados.contatos.length, 1);
  assert.equal(put.corpo.dados.contatos[0].nome, 'Marco Rossi');
});

test('acrescentar contato abre a lista e manda uma entrada em branco', async () => {
  const b = criarBancada({ leitura: leituraEmpresa() });
  await b.pronta();

  botaoAdicionar(linhasDeItem(b)[1]).disparar('click');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.equal(put.corpo.dados.contatos.length, 1);
  assert.deepEqual(Object.keys(put.corpo.dados.contatos[0]).sort(), ['cargo', 'email', 'nome']);
  // Abre junto: acrescentar sem mostrar onde digitar seria um clique mudo.
  assert.equal(subLinhas(b).length, 1);
});

test('subcampo obrigatório vazio fica marcado', async () => {
  const leitura = leituraEmpresa();
  leitura.itens[0].dados.contatos[1].nome = '';
  const b = criarBancada({ leitura });
  await b.pronta();

  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const campos = subLinhas(b)[0].todos().filter(f => f.classList.contains('ia-campo'));
  assert.ok(campos[3].classList.contains('ia-campo--faltando'));
});

test('empresa sem contato não é acusada de campo obrigatório em branco', async () => {
  // `String([])` é vazio: sem tratar o tipo lista à parte, a linha 2 travaria
  // o botão de aplicar por um campo que nem é obrigatório.
  const b = criarBancada({ leitura: leituraEmpresa() });
  await b.pronta();

  assert.equal(b.el('iaDetGravarTodos').disabled, false);
  assert.equal(/sem campo obrigatório/.test(b.el('iaDetResumoRevisao').texto()), false);
});

test('lista OBRIGATÓRIA vazia trava o aplicar', async () => {
  // Nenhum destino de hoje tem sub-lista obrigatória, mas os itens de um
  // orçamento serão. Um orçamento sem nenhum item não é gravável, e a checagem
  // de vazio precisa entender que, para lista, vazio é não ter entrada.
  const leitura = leituraEmpresa();
  leitura.campos = leitura.campos.map(c =>
    (c.chave === 'contatos' ? { ...c, obrigatorio: true } : c));
  const b = criarBancada({ leitura });
  await b.pronta();

  // A linha 2 tem `contatos: []`.
  assert.equal(b.el('iaDetGravarTodos').disabled, true);
  assert.match(b.el('iaDetResumoRevisao').texto(), /1 sem campo obrigatório/);
});

test('lista obrigatória COM entrada não trava o aplicar', async () => {
  const leitura = leituraEmpresa();
  leitura.campos = leitura.campos.map(c =>
    (c.chave === 'contatos' ? { ...c, obrigatorio: true } : c));
  leitura.itens[1].dados.contatos = [{ nome: 'Alguém', cargo: null, email: null }];
  const b = criarBancada({ leitura });
  await b.pronta();

  assert.equal(b.el('iaDetGravarTodos').disabled, false);
});

test('leitura aplicada mostra os contatos, mas travados', async () => {
  const leitura = leituraEmpresa({ status: 'aplicada', status_rotulo: 'Aplicada' });
  const b = criarBancada({ leitura });
  await b.pronta();

  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const campos = subLinhas(b)[0].todos().filter(f => f.classList.contains('ia-campo'));
  assert.ok(campos.length > 0, 'os contatos sumiram da leitura aplicada');
  assert.ok(campos.every(c => c.readOnly));
  // E não há como remover nem acrescentar.
  assert.equal(subLinhas(b)[0].todos().some(f => f.classList.contains('ia-arquivo__remover')), false);
  assert.equal(botaoAdicionar(linhasDeItem(b)[0]), undefined);
});

// ---------------------------------------------------------------------------
// Destino que só atualiza (ficha técnica)
// ---------------------------------------------------------------------------

test('"Cadastrar" nem é oferecido quando o destino só atualiza', async () => {
  // A ficha técnica não tem preço, coleção nem markup: cadastrar produto a
  // partir dela produziria uma ficha pela metade no meio do catálogo. Oferecer
  // a opção só para deixá-la cinza faria o revisor tentar antes de ler.
  const b = criarBancada({ leitura: leituraFicha() });
  await b.pronta();

  const valores = seletorDa(linhasDeItem(b)[0]).filhos.map(o => o.value);
  assert.deepEqual(valores, ['atualizar', 'ignorar']);
});

test('sem `acoes` no destino, as três continuam disponíveis', async () => {
  // Resposta antiga em cache não pode deixar a grade sem nenhuma ação.
  const leitura = leituraFicha();
  delete leitura.acoes;
  const b = criarBancada({ leitura });
  await b.pronta();

  const valores = seletorDa(linhasDeItem(b)[0]).filhos.map(o => o.value);
  assert.deepEqual(valores, ['criar', 'atualizar', 'ignorar']);
});

test('o item sem produto ganha um seletor de destino', async () => {
  // Sem ele, um nome que não casou ficaria sem saída nenhuma — o atalho
  // "É o mesmo" só aparece quando a reconciliação achou um parecido.
  const b = criarBancada({ leitura: leituraFicha() });
  await b.pronta();

  const seletor = seletorDeAlvo(linhasDeItem(b)[1]);
  assert.ok(seletor, 'o item sem produto ficou sem como apontar');
  assert.equal(seletor.value, '');
  assert.equal(seletor.getAttribute('list'), 'iaDetAlvos');
});

test('o item que já aponta mostra o destino atual, e permite trocar', async () => {
  const b = criarBancada({ leitura: leituraFicha() });
  await b.pronta();

  const seletor = seletorDeAlvo(linhasDeItem(b)[0]);
  assert.equal(seletor.value, 'Painel Ripado 2,10');
});

test('escolher um produto da lista aponta o item', async () => {
  const b = criarBancada({ leitura: leituraFicha() });
  await b.pronta();

  const seletor = seletorDeAlvo(linhasDeItem(b)[1]);
  seletor.value = 'Mesa Lateral Carvalho';
  seletor.disparar('change');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.deepEqual(put.corpo, { alvo_id: 10, acao: 'atualizar' });
});

test('nome fora do catálogo é recusado e o campo volta atrás', async () => {
  // Apontar para o que não existe daria erro só na hora de gravar.
  const b = criarBancada({ leitura: leituraFicha() });
  await b.pronta();

  const seletor = seletorDeAlvo(linhasDeItem(b)[0]);
  seletor.value = 'Produto Inventado';
  seletor.disparar('change');
  await b.pronta();

  assert.equal(b.chamadas.some(c => c.metodo === 'PUT'), false);
  assert.equal(b.toasts.at(-1).tipo, 'error');
  assert.equal(seletor.value, 'Painel Ripado 2,10');
});

test('o seletor casa ignorando caixa e acento', async () => {
  const b = criarBancada({ leitura: leituraFicha() });
  await b.pronta();

  const seletor = seletorDeAlvo(linhasDeItem(b)[1]);
  seletor.value = '  mesa lateral CARVALHO  ';
  seletor.disparar('change');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.deepEqual(put.corpo, { alvo_id: 10, acao: 'atualizar' });
});

test('a datalist de destinos é preenchida com o catálogo', async () => {
  const b = criarBancada({ leitura: leituraFicha() });
  await b.pronta();

  const opcoes = b.el('iaDetAlvos').filhos.map(o => o.value);
  assert.deepEqual(opcoes, ['Painel Ripado 2,10', 'Mesa Lateral Carvalho']);
});

test('leitura aplicada não mostra seletor de destino', async () => {
  const b = criarBancada({ leitura: leituraFicha({ status: 'aplicada', status_rotulo: 'Aplicada' }) });
  await b.pronta();

  assert.equal(seletorDeAlvo(linhasDeItem(b)[0]), undefined);
});

// ---------------------------------------------------------------------------
// Alvo que é vínculo (orçamento)
// ---------------------------------------------------------------------------

test('o destino de vínculo oferece só criar e descartar', async () => {
  const b = criarBancada({ leitura: leituraOrcamento() });
  await b.pronta();

  const valores = seletorDa(linhasDeItem(b)[0]).filhos.map(o => o.value);
  assert.deepEqual(valores, ['criar', 'ignorar']);
});

test('"Criar" mostra a quem o orçamento vai se prender', async () => {
  const b = criarBancada({ leitura: leituraOrcamento() });
  await b.pronta();

  const criar = seletorDa(linhasDeItem(b)[0]).filhos.find(o => o.value === 'criar');
  assert.match(criar.textContent, /Criar para: Casa Vicenzo/);
});

test('sem cliente escolhido, "Criar" fica desabilitado', async () => {
  // Um orçamento sem cliente não tem a quem se prender: existiria no banco e
  // em lugar nenhum na tela.
  const b = criarBancada({ leitura: leituraOrcamento() });
  await b.pronta();

  const criar = seletorDa(linhasDeItem(b)[1]).filhos.find(o => o.value === 'criar');
  assert.equal(criar.disabled, true);
  assert.match(criar.textContent, /escolha o cliente/i);
});

test('o seletor de cliente aparece em toda linha editável', async () => {
  // Diferente dos outros destinos, aqui ele não é exceção — é o controle
  // principal, porque o cliente é obrigatório em qualquer caso.
  const b = criarBancada({ leitura: leituraOrcamento() });
  await b.pronta();

  assert.ok(seletorDeAlvo(linhasDeItem(b)[0]), 'a linha que já tem cliente ficou sem seletor');
  assert.ok(seletorDeAlvo(linhasDeItem(b)[1]), 'a linha sem cliente ficou sem seletor');
  assert.match(seletorDeAlvo(linhasDeItem(b)[1]).placeholder, /escolher cliente/i);
});

test('escolher o cliente aponta o item e diz de qual tabela ele é', async () => {
  const b = criarBancada({ leitura: leituraOrcamento() });
  await b.pronta();

  const seletor = seletorDeAlvo(linhasDeItem(b)[1]);
  seletor.value = 'Marcenaria Serrana (Prospecção)';
  seletor.disparar('change');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  // A tabela é obrigatória aqui: o id sozinho é ambíguo entre clientes e
  // prospecções, e a errada criaria o orçamento na série errada, preso a
  // outra empresa.
  assert.equal(put.corpo.alvo_id, 30);
  assert.equal(put.corpo.alvo_tabela, 'prospeccoes');
});

test('destino de tabela única não manda tabela à toa', async () => {
  const b = criarBancada();
  await b.pronta();

  const seletor = seletorDeAlvo(linhasDeItem(b)[0]);
  seletor.value = 'Cola PVA extra 1kg';
  seletor.disparar('change');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.equal(put.corpo.alvo_id, 71);
  assert.equal(put.corpo.alvo_tabela, undefined);
});

test('a sub-lista de itens do orçamento abre com as colunas certas', async () => {
  const b = criarBancada({ leitura: leituraOrcamento() });
  await b.pronta();

  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const cabecalhos = subLinhas(b)[0].todos().filter(f => f.tagName === 'TH').map(f => f.textContent);
  assert.deepEqual(cabecalhos.slice(0, 3), ['Produto', 'Qtde', 'Valor un.']);
});

test('orçamento sem nenhum item trava o aplicar', async () => {
  // A lista de itens é obrigatória: um orçamento sem item não é orçamento.
  const leitura = leituraOrcamento();
  leitura.itens[0].dados.itens = [];
  const b = criarBancada({ leitura });
  await b.pronta();

  assert.equal(b.el('iaDetGravarTodos').disabled, true);
  assert.match(b.el('iaDetResumoRevisao').texto(), /1 sem campo obrigatório/);
});

// ---------------------------------------------------------------------------
// Abrir no módulo preenchido
// ---------------------------------------------------------------------------

/**
 * Este é o teste que sustenta a abordagem inteira.
 *
 * O preenchimento acontece DE FORA do módulo de destino, por id de campo. É a
 * escolha certa — a alternativa seria alterar cinco arquivos em produção para
 * um recurso de um sexto módulo —, mas o preço é depender de ids que vivem em
 * outro arquivo. Sem esta conferência, renomear um campo de formulário faria o
 * preenchimento parar em silêncio, e ninguém notaria até alguém salvar um
 * cadastro pela metade.
 */
test('todo id do mapa de preenchimento existe no HTML do modal', () => {
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  const bloco = /const MODULOS_DE_DESTINO = \{[\s\S]*?\n  \};/.exec(fonte);
  assert.ok(bloco, 'não achei o mapa de módulos de destino');

  // Cada destino declara `html:` e, abaixo, os ids dos campos.
  const destinos = [...bloco[0].matchAll(
    /(\w+): \{\s*\n\s*rotulo: '[^']*',\s*\n\s*html: '([^']+)'[\s\S]*?(?=\n    \w+: \{\s*\n\s*rotulo:|\n  \};)/g)];
  assert.ok(destinos.length >= 4, `só ${destinos.length} destinos no mapa`);

  for (const [trecho, destino, caminhoHtml] of destinos) {
    const html = fs.readFileSync(
      path.join(__dirname, '..', '..', 'html', caminhoHtml), 'utf8');
    const idsDoHtml = new Set(
      [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));

    // Ids que o mapa aponta: os de `campos` e os dos `selects`.
    const usados = [
      ...[...trecho.matchAll(/^\s{8}\w+: '([^']+)',?$/gm)].map(m => m[1]),
      ...[...trecho.matchAll(/id: '([^']+)'/g)].map(m => m[1])
    ];
    assert.ok(usados.length, `o destino ${destino} não mapeia campo nenhum`);

    for (const id of usados) {
      assert.ok(idsDoHtml.has(id),
        `${destino}: o campo "${id}" não existe mais em ${caminhoHtml}`);
    }
  }
});

test('o overlay de cada módulo de destino existe com o id esperado', () => {
  // `Modal.close` e a revelação usam `<overlay>Overlay`. Um nome errado aqui
  // abriria o modal e o deixaria invisível.
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  const bloco = /const MODULOS_DE_DESTINO = \{[\s\S]*?\n  \};/.exec(fonte)[0];
  const pares = [...bloco.matchAll(/html: '([^']+)'[\s\S]*?overlay: '([^']+)'/g)];
  assert.ok(pares.length >= 4);

  for (const [, caminhoHtml, overlay] of pares) {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'html', caminhoHtml), 'utf8');
    assert.ok(html.includes(`id="${overlay}Overlay"`),
      `${caminhoHtml} não tem o overlay "${overlay}Overlay"`);
  }
});

test('o script de cada módulo de destino existe', () => {
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  const bloco = /const MODULOS_DE_DESTINO = \{[\s\S]*?\n  \};/.exec(fonte)[0];
  for (const [, caminho] of bloco.matchAll(/script: '\.\.\/js\/([^']+)'/g)) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', caminho)),
      `o script ${caminho} não existe`);
  }
});

test('a linha ganha o botão de abrir no módulo', async () => {
  const b = criarBancada();
  await b.pronta();

  const botao = linhasDeItem(b)[0].todos().find(f => f.classList.contains('ia-abrir-modulo'));
  assert.ok(botao, 'a linha ficou sem o caminho de abrir o formulário do módulo');
  assert.match(botao.texto(), /Novo Insumo/);
  // O texto do title precisa deixar claro quem grava.
  assert.match(botao.title, /Quem salva é você/i);
});

test('a linha descartada não oferece abrir no módulo', async () => {
  const leitura = leituraPadrao();
  leitura.itens[0].acao = 'ignorar';
  const b = criarBancada({ leitura });
  await b.pronta();

  assert.equal(
    linhasDeItem(b)[0].todos().some(f => f.classList.contains('ia-abrir-modulo')),
    false);
});

test('a leitura aplicada não oferece abrir no módulo', async () => {
  const b = criarBancada({ leitura: leituraPadrao({ status: 'aplicada', status_rotulo: 'Aplicada' }) });
  await b.pronta();

  assert.equal(
    linhasDeItem(b)[0].todos().some(f => f.classList.contains('ia-abrir-modulo')),
    false);
});

test('a ficha técnica também abre o formulário de produto', async () => {
  // Antes este destino era o único sem caminho de volta: a ficha de uma peça
  // nova não tinha onde ser aproveitada, que é justamente o caso mais comum de
  // se querer ler uma ficha.
  const b = criarBancada({ leitura: leituraFicha() });
  await b.pronta();

  const botao = linhasDeItem(b)[0].todos().find(f => f.classList.contains('ia-abrir-modulo'));
  assert.ok(botao, 'a ficha ficou sem caminho para o formulário de produto');
  assert.match(botao.texto(), /Novo Produto/);
});

test('todo destino do esquema tem um formulário para abrir', () => {
  // Um destino sem modal mapeado é uma leitura que não leva a lugar nenhum:
  // a pessoa envia o arquivo, revisa a grade, e descobre no fim que não há
  // como usar o resultado.
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  const mapeados = [...fonte.matchAll(/^    (\w+): \{$/gm)].map(m => m[1]);
  for (const destino of ['materia_prima', 'clientes', 'prospeccoes', 'produto_insumos', 'orcamentos']) {
    assert.ok(mapeados.includes(destino), `${destino} não abre formulário nenhum`);
  }
});

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

test('o modal continua nascendo hidden e se revelando pelo spinner', () => {
  const html = fs.readFileSync(HTML_MODAL, 'utf8');
  assert.match(html, /id="iaDetalhesOverlay" class="hidden /);

  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  const bloco = /\} finally \{[\s\S]*?revelar\(\);[\s\S]*?\}/.exec(fonte);
  assert.ok(bloco, 'a revelação precisa estar num finally');
});

test('os três botões de ação passam pela trava de duplo clique', () => {
  // Extrair consome crédito, gravar mexe em estoque, e abrir o formulário duas
  // vezes empilharia dois modais iguais. Um clique repetido custa caro em cada
  // um deles, de um jeito diferente.
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  assert.match(fonte, /BotaoAcao\?\.bind/);
  const bloco = /for \(const \[id, acao\] of \[[\s\S]*?\n  \}/.exec(fonte);
  assert.ok(bloco, 'os botões precisam passar pelo mesmo laço de proteção');
  for (const id of ['iaDetExtrair', 'iaDetAplicar', 'iaDetGravarTodos']) {
    assert.match(bloco[0], new RegExp(id), `${id} ficou fora da trava`);
  }
});


// ---------------------------------------------------------------------------
// O botão principal ABRE O FORMULÁRIO — não grava
//
// Era o ponto central da queixa do usuário: "esse botão aplicar não deveria
// aplicar no banco, mas sim levar para o modal referente à operação preenchendo
// os dados". Um cadastro que entra sozinho é um cadastro que ninguém conferiu.
// ---------------------------------------------------------------------------

test('o botão principal abre o formulário e não grava nada', async () => {
  const b = criarBancada();
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  // Abriu o modal do destino, por cima (o quarto argumento do Modal.open).
  assert.equal(b.modaisAbertos.at(-1)?.overlay, 'novoInsumo');
  // E não passou perto da rota que grava.
  assert.equal(b.chamadas.some(c => /\/aplicar$/.test(c.url)), false,
    'o botão principal gravou no banco');
  // Nem perguntou se podia gravar: não há o que confirmar.
  assert.equal(b.confirmacoes.length, 0);
});

test('o formulário recebe os campos e o conteúdo dinâmico', async () => {
  const b = criarBancada();
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  const carga = b.preenchimentos.at(-1);
  assert.ok(carga, 'o formulário abriu vazio');
  assert.equal(carga.overlay, 'novoInsumo');

  // Os campos vão por seletor de id, prontos para o EstadoTrabalho aplicar.
  const nome = carga.campos.find(c => c.chave === '#nome');
  assert.equal(nome?.valor, 'MDF 15mm Branco TX');

  // E o conteúdo dinâmico — aqui os selects que só têm opções depois de um
  // fetch — vai junto, na forma que o módulo de destino sabe repor.
  assert.ok(carga.conteudo, 'o conteúdo dinâmico não foi montado');
});

test('a linha pendente é a que abre, não a primeira da lista', async () => {
  const leitura = leituraPadrao();
  leitura.itens[0].status = 'aplicado';
  const b = criarBancada({ leitura });
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  // Reabrir uma linha já gravada convidaria a cadastrá-la duas vezes.
  const pedido = b.chamadas.find(c => /\/preenchimento$/.test(c.url));
  assert.match(pedido.url, /\/itens\/2\/preenchimento$/);
});

test('o rótulo do botão diz para onde vai e quantas faltam', async () => {
  const b = criarBancada();
  await b.pronta();

  // Duas pendentes: o botão precisa deixar claro que abre UMA por vez, senão
  // a pessoa clica, salva, e acha que resolveu a leitura inteira.
  assert.match(b.el('iaDetAplicar').innerHTML, /1ª de 2/);
  assert.match(b.el('iaDetAplicar').innerHTML, /Novo Insumo/);
  assert.match(b.el('iaDetAplicar').title, /quem salva é você/i);
});

test('gravar todos só aparece quando conferir uma a uma seria impraticável', async () => {
  const b = criarBancada();
  await b.pronta();
  assert.equal(b.el('iaDetGravarTodos').classList.contains('hidden'), false);

  // Com uma linha só, o caminho normal já dá conta — e um segundo botão ao
  // lado dele seria só um jeito de errar.
  const leitura = leituraPadrao();
  leitura.itens = [leitura.itens[0]];
  const c = criarBancada({ leitura });
  await c.pronta();
  assert.equal(c.el('iaDetGravarTodos').classList.contains('hidden'), true);
});

test('leitura sem nada pendente não oferece abrir formulário', async () => {
  const b = criarBancada({ leitura: leituraPadrao({ status: 'revisao' }) });
  b.trocarLeitura(leituraPadrao({
    status: 'revisao',
    itens: leituraPadrao().itens.map(i => ({ ...i, acao: 'ignorar' }))
  }));
  await b.pronta();
  b.el('iaDetExtrair');
  await b.pronta();
});

test('o que o backend não casou aparece antes de a pessoa salvar', async () => {
  const b = criarBancada({
    respostaPreenchimento: {
      status: 200,
      corpo: {
        modal: { overlay: 'novoInsumo', html: 'x', script: 'y', rotulo: 'Novo Insumo' },
        campos: { nome: 'MDF 15mm Branco TX' },
        alvo: null,
        avisos: ['Fora da lista, por não estarem em Matéria-prima: Couro Serpente']
      }
    }
  });
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  // Depois de salvo, o que faltou vira material errado numa receita. O aviso
  // só serve se chegar ANTES.
  const aviso = b.toasts.at(-1);
  assert.match(aviso.msg, /Couro Serpente/);
});
