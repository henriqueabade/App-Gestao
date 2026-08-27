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
    // O foco vive no DOCUMENTO, e é de lá que o módulo o lê para devolvê-lo
    // depois de redesenhar a grade.
    focus() { foco.atual = el; },
    // Guardar o cursor dentro do campo: o módulo tenta restaurá-lo, e um
    // método ausente aqui viraria "o teste mede o buraco do harness".
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange(inicio, fim) { el.selectionStart = inicio; el.selectionEnd = fim; },
    // O popover se posiciona pela caixa do (i). Sem isto o teste mede o buraco
    // do harness em vez do comportamento.
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    appendChild(f) { el.filhos.push(f); f.pai = el; return f; },
    // O véu se remove sozinho quando o preenchimento acaba.
    remove() {
      if (el.pai) el.pai.filhos = el.pai.filhos.filter(f => f !== el);
      el.pai = null;
    },
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

/**
 * Quem tem o foco agora.
 *
 * No navegador o foco é do DOCUMENTO, não do elemento — e é de lá que o módulo
 * o lê para devolvê-lo depois de redesenhar a grade. Mora no arquivo porque
 * `criarElemento` não conhece bancada nenhuma; cada montagem o zera.
 */
const foco = { atual: null };

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
  for (const id of idsDoModal()) {
    const el = criarElemento();
    // O `id` importa: o posicionador de popover usa ele para limpar órfãos, e
    // sem isso o teste mediria o buraco do harness.
    el.id = id;
    elementos.set(id, el);
  }

  // O duplo cria um elemento por `id` do HTML. Os poucos filhos que o módulo
  // procura por tag precisam existir também, senão o teste mede o buraco do
  // harness em vez do comportamento.
  const paragrafo = criarElemento('p');
  elementos.get('iaDetItensVazio')?.appendChild(paragrafo);

  const raiz = criarElemento('body');
  for (const [, el] of elementos) raiz.appendChild(el);

  const chamadas = [];
  // Tudo que o modal anuncia para a janela. A tabela do módulo escuta daqui.
  const avisos = [];
  const toasts = [];
  const confirmacoes = [];
  const gradesRecarregadas = [];
  const modaisAbertos = [];
  const preenchimentos = [];
  const ouvintesDaJanela = {};
  const ancorados = [];
  const copiado = [];
  let dadosLeitura = leitura || leituraPadrao();

  // O véu com a logo é anexado ao <body>: sem ele no duplo, o teste mediria o
  // buraco do harness em vez do comportamento.
  const corpoDaPagina = criarElemento('body');

  foco.atual = null;

  const document = {
    body: corpoDaPagina,
    head: criarElemento('head'),
    get activeElement() { return foco.atual; },
    addEventListener() {},
    removeEventListener() {},
    // O mapa tem os ids do HTML; a ÁRVORE tem os que o módulo cria em tempo de
    // execução — as listas de opções de cada linha, por exemplo. O DOM de
    // verdade acha os dois, e um duplo que só olha o mapa faria o módulo criar
    // um elemento novo a cada redesenho sem ninguém notar.
    getElementById: id => elementos.get(id) || raiz.todos().find(f => f.id === id) || null,
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
      avisos.push(evento?.type);
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
        // O modal de destino cria o overlay dele, nascendo `hidden` — é assim
        // que o `Modal.open` de verdade se comporta, e é o que permite testar
        // QUANDO ele é revelado.
        if (!elementos.has(`${overlay}Overlay`)) {
          const el = criarElemento();
          el.id = `${overlay}Overlay`;
          el.className = 'hidden';
          elementos.set(el.id, el);
        }
        setTimeout(() => sandbox.dispatchEvent({ type: 'modalSpinnerLoaded', detail: overlay }), 0);
      }
    },
    // O utilitário de popover de verdade não roda aqui (ele mexe no <body>),
    // mas o duplo precisa registrar as chamadas para os testes conferirem que
    // o popover foi ancorado no (i) certo.
    Popover: {
      abrir(popover, ancora) { ancorados.push({ popover, ancora }); popover?.classList.add('show'); },
      fechar(popover) { popover?.classList.remove('show'); },
      descartar() {}
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
    navigator: { clipboard: { writeText: async texto => { copiado.push(texto); } } },
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
        // Um gancho para olhar a TELA no meio da requisição: é o único momento
        // em que dá para conferir que o véu de carregamento está de pé.
        r.aoGravar?.(bancada);
        if (r.status && r.status >= 400) {
          return { ok: false, status: r.status, json: async () => r.corpo };
        }
        const id = Number(/\/itens\/(\d+)$/.exec(url)[1]);
        const item = dadosLeitura.itens.find(i => i.id === id);
        const salvo = {
          ...(respostaPut?.corpoExtra || {}),
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
      if (metodo === 'GET' && /\/texto$/.test(url)) {
        return {
          ok: true, status: 200,
          json: async () => ({ id: 41, nome_arquivo: 'bralux.xlsx', texto: 'ITEM | QTD | PRECO\nMDF | 40 | 189,90' })
        };
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

  const bancada = {
    el: id => elementos.get(id),
    chamadas,
    toasts,
    confirmacoes,
    gradesRecarregadas,
    modaisAbertos,
    avisos,
    preenchimentos,
    copiado,
    ancorados,
    corpoDaPagina,
    // O aviso do módulo de destino chega pela janela.
    dispararNaJanela: (tipo, detalhe) => sandbox.dispatchEvent({ type: tipo, ...detalhe }),
    focar: el => { foco.atual = el; },
    focado: () => foco.atual,
    // Um modal fala com o outro por `window.<algo>`: `menu.js` embrulha cada
    // script numa IIFE, então não há chamada direta entre eles.
    janela: sandbox,
    trocarLeitura: nova => { dadosLeitura = nova; },
    pronta: () => new Promise(r => setTimeout(r, 10))
  };
  return bancada;
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
/** A caixa de seleção da linha, que substituiu o antigo seletor de ação. */
const marcaDa = linha => linha.todos().find(f => f.classList.contains('ia-selecao'));

/** O (i) que abre os campos que não viraram coluna. */
const infoDa = linha => linha.todos().find(f => f.classList.contains('ia-info-item'));

// ---------------------------------------------------------------------------
// Estrutura da grade
// ---------------------------------------------------------------------------

test('as colunas vêm do esquema do destino, não do HTML', async () => {
  const b = criarBancada();
  await b.pronta();

  // A primeira coluna é a caixa de seleção, que não tem título: marcar linhas
  // é gesto, não informação. E "O que fazer" saiu — descartar virou o botão do
  // rodapé, apontar virou o "É o mesmo" da ressalva.
  const cabecalho = b.el('iaDetItensCabecalho').filhos.map(th => th.textContent);
  assert.deepEqual(cabecalho,
    ['', 'Insumo', 'Qtde', 'Un.', 'Preço un.', 'Categoria', 'Observação', 'Situação']);

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
  assert.ok(linha.classList.contains('ia-linha-item--aplicada'));

  // E nem pode ser marcado: descartar algo que já virou cadastro não desfaz
  // nada, só dá a impressão de ter desfeito.
  assert.equal(linha.todos().some(f => f.classList.contains('ia-selecao')), false);
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
  // A grade é redesenhada inteira a cada marcação. Sem guardar o estado, a
  // lista que o revisor acabou de abrir se fecharia sozinha.
  const b = criarBancada({ leitura: leituraEmpresa() });
  await b.pronta();

  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  // Marcar outra linha redesenha a grade inteira.
  marcaDa(linhasDeItem(b)[1]).checked = true;
  marcaDa(linhasDeItem(b)[1]).disparar('change');
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









test('leitura aplicada não mostra seletor de destino', async () => {
  const b = criarBancada({ leitura: leituraFicha({ status: 'aplicada', status_rotulo: 'Aplicada' }) });
  await b.pronta();

  assert.equal(seletorDeAlvo(linhasDeItem(b)[0]), undefined);
});

// ---------------------------------------------------------------------------
// Alvo que é vínculo (orçamento)
// ---------------------------------------------------------------------------







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

test('a linha marcada é a que abre no formulário', async () => {
  // Antes, cada linha tinha o seu próprio botão de abrir, dentro da coluna
  // "O que fazer". Com a coluna fora, quem escolhe é a marcação — e o mesmo
  // gesto que serve para descartar serve para abrir.
  const b = criarBancada();
  await b.pronta();

  marcaDa(linhasDeItem(b)[1]).checked = true;
  marcaDa(linhasDeItem(b)[1]).disparar('change');
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  const pedido = b.chamadas.find(c => /\/preenchimento$/.test(c.url));
  assert.match(pedido.url, /\/itens\/2\/preenchimento$/,
    'abriu a primeira linha em vez da que estava marcada');
});

test('sem marcação, abre a primeira pendente', async () => {
  const b = criarBancada();
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  const pedido = b.chamadas.find(c => /\/preenchimento$/.test(c.url));
  assert.match(pedido.url, /\/itens\/1\/preenchimento$/);
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

  assert.equal(b.el('iaDetAplicar').classList.contains('hidden'), false);
  assert.match(b.el('iaDetAplicar').innerHTML, /Novo Produto/);
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


// ===========================================================================
// ETAPA 10 — SELEÇÃO, DETALHE E LIMPEZA DA GRADE
//
// A grade responde uma pergunta: "esta linha está certa?". Tudo o que não
// ajuda a respondê-la estava atrapalhando — o número da linha, o seletor de
// ação, o botão de acrescentar sub-item, e sete colunas de pedido espremidas
// a quatro caracteres cada.
// ===========================================================================

/** Leitura de orçamento com campos que ficam fora da grade. */
function leituraComDetalhe(extra = {}) {
  return leituraPadrao({
    destino: 'orcamentos',
    destino_rotulo: 'Orçamentos',
    campos: [
      { chave: 'cliente', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true, largura: 'grande', naGrade: true },
      { chave: 'prazo', rotulo: 'Prazo', tipo: 'texto', obrigatorio: false, largura: 'grande', naGrade: true },
      { chave: 'forma_pagamento', rotulo: 'Pagamento', tipo: 'texto', obrigatorio: false, largura: 'media', naGrade: false },
      { chave: 'transportadora', rotulo: 'Transportadora', tipo: 'texto', obrigatorio: false, largura: 'media', naGrade: false },
      { chave: 'observacoes', rotulo: 'Observações', tipo: 'texto', obrigatorio: false, largura: 'media', naGrade: false }
    ],
    itens: [
      {
        id: 1, linha: 1, acao: 'criar', alvo_id: 50, status: 'pendente', mensagem: null,
        dados: { cliente: 'Casa Vicenzo', prazo: '30/60/90', forma_pagamento: 'pix', transportadora: 'Rodonaves', observacoes: null }
      }
    ],
    ...extra
  });
}

test('a coluna do número da linha deu lugar à caixa de seleção', async () => {
  const b = criarBancada();
  await b.pronta();

  // O número não dizia nada que a ordem da tabela já não dissesse, e ocupava
  // a largura de que a primeira coluna de verdade precisava.
  const linha = linhasDeItem(b)[0];
  assert.ok(marcaDa(linha), 'a linha ficou sem caixa de seleção');
  assert.equal(marcaDa(linha).type, 'checkbox');
});

test('marcar linhas revela o botão de descartar, com a contagem', async () => {
  const b = criarBancada();
  await b.pronta();

  // Um botão permanentemente sem efeito ensina o usuário a ignorar aquele
  // canto da tela.
  assert.equal(b.el('iaDetDescartar').classList.contains('hidden'), true);

  marcaDa(linhasDeItem(b)[0]).checked = true;
  marcaDa(linhasDeItem(b)[0]).disparar('change');
  await b.pronta();

  assert.equal(b.el('iaDetDescartar').classList.contains('hidden'), false);
  assert.match(b.el('iaDetDescartar').texto(), /Descartar 1 selecionada/);
});

test('descartar manda ignorar e não apaga a linha', async () => {
  const b = criarBancada();
  await b.pronta();

  marcaDa(linhasDeItem(b)[0]).checked = true;
  marcaDa(linhasDeItem(b)[0]).disparar('change');
  await b.pronta();

  b.el('iaDetDescartar').disparar('click');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.deepEqual(put.corpo, { acao: 'ignorar' });

  // Descartar não apaga: a linha continua na leitura com a procedência
  // intacta. Apagar de verdade jogaria fora a resposta para "de onde veio
  // este dado", que é metade do motivo de a leitura existir.
  assert.equal(b.chamadas.some(c => c.metodo === 'DELETE'), false);
  assert.equal(linhasDeItem(b).length, 2);
});

test('descartar pergunta antes', async () => {
  const b = criarBancada();
  await b.pronta();

  marcaDa(linhasDeItem(b)[0]).checked = true;
  marcaDa(linhasDeItem(b)[0]).disparar('change');
  await b.pronta();
  b.el('iaDetDescartar').disparar('click');
  await b.pronta();

  assert.ok(b.confirmacoes.at(-1), 'descartou sem perguntar');
});

test('marcar tudo de uma vez marca só o que ainda pode ser marcado', async () => {
  const leitura = leituraPadrao();
  leitura.itens[0].status = 'aplicado';
  const b = criarBancada({ leitura });
  await b.pronta();

  const todos = b.el('iaDetItensCabecalho').filhos[0].todos()
    .find(f => f.classList.contains('ia-selecao'));
  assert.ok(todos, 'o cabeçalho ficou sem o "marcar todas"');

  todos.checked = true;
  todos.disparar('change');
  await b.pronta();

  // A linha já gravada não entra: descartá-la não desfaz o que virou cadastro.
  assert.equal(b.el('iaDetDescartar').texto().includes('1 selecionada'), true);
});

test('a sub-lista perdeu o botão de acrescentar', async () => {
  const b = criarBancada({ leitura: leituraEmpresa() });
  await b.pronta();

  // Uma linha em branco na sub-lista não tem o que a torna útil: busca contra
  // o catálogo, validação, preço do cadastro. Isso existe no formulário do
  // módulo, e é lá que acrescentar faz sentido.
  assert.equal(
    linhasDeItem(b)[0].todos().some(f => f.classList.contains('ia-lista-adicionar')),
    false);
});

test('campo fora da grade não vira coluna, e vai para o (i)', async () => {
  const b = criarBancada({ leitura: leituraComDetalhe() });
  await b.pronta();

  const cabecalho = b.el('iaDetItensCabecalho').filhos.map(th => th.textContent);
  // Sete colunas de pedido espremidas deixavam cada uma com quatro caracteres.
  // "Valor total" não vem do esquema: é calculada a partir dos itens.
  assert.deepEqual(cabecalho, ['', 'Cliente', 'Prazo', 'Valor total', 'Situação']);

  const info = infoDa(linhasDeItem(b)[0]);
  assert.ok(info, 'a linha ficou sem o caminho para os campos escondidos');
  assert.match(info.title, /3 campo/);
});

test('os campos do (i) continuam editáveis', async () => {
  const b = criarBancada({ leitura: leituraComDetalhe() });
  await b.pronta();

  infoDa(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const popover = b.el('iaDetLinhaPopover');
  const campos = popover.todos().filter(f => f.tagName === 'INPUT');
  assert.equal(campos.length, 3, 'o popover não montou os campos escondidos');

  // Só de leitura, o revisor que visse a forma de pagamento errada teria de
  // corrigir no formulário, linha por linha — e a correção não voltaria para a
  // leitura, então extrair de novo a perderia.
  assert.equal(campos.every(c => c.readOnly), false);

  campos[0].value = 'boleto';
  campos[0].disparar('change');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.deepEqual(put.corpo.dados, { forma_pagamento: 'boleto' });
});

test('leitura aplicada abre o (i) apenas para leitura', async () => {
  const b = criarBancada({
    leitura: leituraComDetalhe({ status: 'aplicada', status_rotulo: 'Aplicada' })
  });
  await b.pronta();

  infoDa(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const campos = b.el('iaDetLinhaPopover').todos().filter(f => f.tagName === 'INPUT');
  assert.ok(campos.length);
  assert.ok(campos.every(c => c.readOnly), 'dá para editar o que já foi gravado');
});

test('o botão Fechar é vermelho, como nos outros modais', () => {
  const html = fs.readFileSync(HTML_MODAL, 'utf8');
  const fechar = /<button id="iaDetFechar"[\s\S]*?class="([^"]+)"/.exec(html);
  assert.ok(fechar);
  assert.match(fechar[1], /btn-danger/);
});

test('descartar fica entre Fechar e Extrair, e é transparente', () => {
  const html = fs.readFileSync(HTML_MODAL, 'utf8');
  const ordem = ['iaDetFechar', 'iaDetDescartar', 'iaDetExtrair']
    .map(id => html.indexOf(`id="${id}"`));
  assert.ok(ordem.every(i => i > 0), 'faltou algum botão no rodapé');
  assert.ok(ordem[0] < ordem[1] && ordem[1] < ordem[2], 'a ordem do rodapé mudou');

  const descartar = /<button id="iaDetDescartar"[\s\S]*?class="([^"]+)"/.exec(html);
  assert.match(descartar[1], /ia-btn-transparente/);
});

test('cada arquivo tem um botão de copiar o texto lido', async () => {
  const b = criarBancada();
  await b.pronta();

  const copiar = b.el('iaDetArquivosLista').todos()
    .find(f => f.classList.contains('ia-btn-copiar'));
  assert.ok(copiar, 'não dá para tirar o texto lido da tela');
  assert.match(copiar.title, /copiar/i);
});

test('copiar busca o texto no servidor e usa a área de transferência', async () => {
  const b = criarBancada();
  await b.pronta();

  const copiar = b.el('iaDetArquivosLista').todos()
    .find(f => f.classList.contains('ia-btn-copiar'));
  copiar.disparar('click');
  await b.pronta();

  // Busca no servidor, e não na tela: o painel do texto só existe depois de
  // "Ver o que foi lido", e copiar não deveria exigir abrir antes.
  assert.ok(b.chamadas.some(c => /\/texto$/.test(c.url)));
  assert.match(b.copiado.at(-1) || '', /ITEM \| QTD/);
});

test('arquivo sem texto não oferece copiar', async () => {
  const leitura = leituraPadrao();
  leitura.arquivos[0].texto_tamanho = 0;
  const b = criarBancada({ leitura });
  await b.pronta();

  const copiar = b.el('iaDetArquivosLista').todos()
    .find(f => f.classList.contains('ia-btn-copiar'));
  assert.equal(copiar.disabled, true);
});

test('"Ver o que foi lido" busca o texto e mostra na tela', async () => {
  // Esta era a única forma de conferir a transcrição, e não tinha teste
  // nenhum: trocar a busca por qualquer coisa passava despercebido.
  const b = criarBancada();
  await b.pronta();

  // Pelo tagName, não só pelo texto: a <div> que envolve os dois botões tem
  // exatamente o mesmo textContent, e vem antes na varredura.
  const ver = b.el('iaDetArquivosLista').todos()
    .find(f => f.tagName === 'BUTTON' && f.texto() === 'Ver o que foi lido');
  assert.ok(ver, 'não há como conferir a transcrição');

  ver.disparar('click');
  await b.pronta();

  assert.ok(b.chamadas.some(c => /\/arquivos\/41\/texto$/.test(c.url)));
  const painel = b.el('iaDetArquivosLista').todos().find(f => /ITEM \| QTD/.test(f.textContent || ''));
  assert.ok(painel, 'o texto lido não apareceu na tela');
});

// ---------------------------------------------------------------------------
// ETAPA 11 — o pedido chega inteiro
// ---------------------------------------------------------------------------

test('o valor total é a soma dos itens, não o total escrito no papel', async () => {
  const leitura = leituraComDetalhe();
  leitura.itens[0].dados.itens = [
    { nome: 'Apaga Velas Silvia', quantidade: 7, valor_unitario: 388.7 },
    { nome: 'Bandeja Vero PP', quantidade: 2, valor_unitario: 100 }
  ];
  const b = criarBancada({ leitura });
  await b.pronta();

  const celula = linhasDeItem(b)[0].todos().find(f => f.classList.contains('ia-valor-total'));
  assert.ok(celula, 'a coluna de valor total sumiu');
  // 7 × 388,70 + 2 × 100 = 2.920,90. É quanto o orçamento vai valer quando for
  // criado — e a diferença contra o total do PDF é o que revela um item que
  // ficou de fora.
  assert.match(celula.textContent, /2\.920,90/);
});

test('linha sem item mostra zero, não vazio', async () => {
  const leitura = leituraComDetalhe();
  leitura.itens[0].dados.itens = [];
  const b = criarBancada({ leitura });
  await b.pronta();

  const celula = linhasDeItem(b)[0].todos().find(f => f.classList.contains('ia-valor-total'));
  // Célula vazia se confunde com "ainda não calculei"; zero diz o que é.
  assert.match(celula.textContent, /0,00/);
});

test('o bloco comercial do pedido chega ao formulário', async () => {
  const b = criarBancada({
    leitura: leituraComDetalhe(),
    respostaPreenchimento: {
      status: 200,
      corpo: {
        modal: { overlay: 'novoOrcamento', html: 'x', script: 'y', rotulo: 'Novo Orçamento' },
        campos: { cliente: 'Casa Vicenzo', prazo: '30/60/90' },
        alvo: { tabela: 'clientes', id: 50, nome: 'Casa Vicenzo' },
        contato: { id: 7, nome: 'Lílian' },
        transportadora: { id: 3, nome: 'Rodonaves' },
        pagamento: {
          forma: 'pix',
          condicao: 'prazo',
          prazo_vista: null,
          parcelas: { count: 3, mode: 'custom', items: [
            { amount: 6162, dueInDays: 30 },
            { amount: 166162, dueInDays: 60 },
            { amount: 86162, dueInDays: 90 }
          ] }
        },
        itens: [{ produto_id: 9, nome: 'Apaga Velas Silvia', quantidade: 7, valor_unitario: 388.7 }],
        avisos: []
      }
    }
  });
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  const { conteudo } = b.preenchimentos.at(-1);

  // Tudo isto estava no PDF e nada disso chegava: a pessoa relia o documento e
  // digitava de novo, que é o trabalho que este módulo existe para tirar.
  assert.equal(conteudo.selects.novoCliente, '50');
  assert.equal(conteudo.selects.novoContato, '7');
  assert.equal(conteudo.selects.novoTransportadora, '3');
  assert.equal(conteudo.selects.novoFormaPagamento, 'pix');
  assert.equal(conteudo.condicao, 'prazo');
  assert.equal(conteudo.condicaoDefinida, true);

  // As parcelas vêm com valor E vencimento, do jeito que o documento escreveu.
  assert.equal(conteudo.parcelamento.count, 3);
  assert.equal(conteudo.parcelamento.mode, 'custom');
  assert.deepEqual(conteudo.parcelamento.items.map(i => i.dueInDays), [30, 60, 90]);
  assert.equal(conteudo.parcelamento.items[1].amount, 166162);
});

test('venda à vista leva o prazo de entrega, não parcelas', async () => {
  const b = criarBancada({
    leitura: leituraComDetalhe(),
    respostaPreenchimento: {
      status: 200,
      corpo: {
        modal: { overlay: 'novoOrcamento', html: 'x', script: 'y', rotulo: 'Novo Orçamento' },
        campos: {}, alvo: null, itens: [], avisos: [],
        pagamento: { forma: 'pix', condicao: 'vista', prazo_vista: '15 dias', parcelas: null }
      }
    }
  });
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  const { conteudo } = b.preenchimentos.at(-1);
  assert.equal(conteudo.condicao, 'vista');
  assert.equal(conteudo.prazoVista, '15 dias');
  assert.equal(conteudo.parcelamento, null);
});

// ---------------------------------------------------------------------------
// ETAPA 12 — a sub-lista de insumos diz o que casou e o que não casou
// ---------------------------------------------------------------------------

/** Ficha com um insumo de cada desfecho de casamento. */
function leituraFichaCasada() {
  const leitura = leituraFicha();
  leitura.campos[2].subcampos = [
    { chave: 'processo', rotulo: 'Processo', tipo: 'texto', obrigatorio: false },
    { chave: 'nome', rotulo: 'Insumo', tipo: 'texto', obrigatorio: true },
    { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero', obrigatorio: true },
    { chave: 'unidade', rotulo: 'Un.', tipo: 'texto', obrigatorio: false }
  ];
  leitura.itens = [{
    id: 1, linha: 1, acao: 'criar', alvo_id: null, status: 'pendente', mensagem: null,
    dados: {
      codigo: null, nome: 'Bandeja Vero PP',
      insumos: [
        { processo: 'MARCENARIA', nome: 'MDF 06', quantidade: 0.07, unidade: 'm2', _casamento: 'exato', _cadastro: 'MDF 06' },
        { processo: 'ACABAMENTO', nome: 'Verniz FO10 - 6717 Em Lamina De Madeira', quantidade: 16, unidade: 'ml', _casamento: 'semelhante', _cadastro: 'Verniz FO10 6717' },
        { processo: 'MONTAGEM', nome: 'Couro Serpente Amêndoa', quantidade: 0.04, unidade: 'm2', _casamento: null, _cadastro: null }
      ]
    }
  }];
  return leitura;
}

/** Abre a sub-lista de insumos e devolve as linhas dela. */
async function abrirInsumos(b) {
  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();
  return subLinhas(b)[0].todos().filter(f => f.tagName === 'TR');
}

test('o insumo que não existe no estoque fica com a linha vermelha', async () => {
  const b = criarBancada({ leitura: leituraFichaCasada() });
  await b.pronta();
  const linhas = await abrirInsumos(b);

  const marcadas = linhas.filter(l => l.classList.contains('ia-sublinha-item--sem-cadastro'));
  // Ele NÃO vai para o formulário. Descobrir isso depois de salvar é
  // descobrir tarde demais — aqui ainda dá para cadastrar o que falta.
  assert.equal(marcadas.length, 1, 'a linha sem cadastro não se distingue das outras');
  assert.ok(marcadas[0].todos().some(f => f.value === 'Couro Serpente Amêndoa'));
});

test('só o casamento por semelhança ganha (i), com o nome do cadastro', async () => {
  const b = criarBancada({ leitura: leituraFichaCasada() });
  await b.pronta();
  const linhas = await abrirInsumos(b);

  const comInfo = linhas.filter(l => l.todos().some(f => f.classList.contains('ia-info-insumo')));
  // Casamento exato não tem nada a revelar, e um ícone em toda linha viraria
  // ruído que ninguém mais olha.
  assert.equal(comInfo.length, 1);

  const info = comInfo[0].todos().find(f => f.classList.contains('ia-info-insumo'));

  // A TABELA mostra o nome do cadastro: é ele que vai para a receita, com o id
  // e o preço dele, e é ele que precisa ser conferido.
  assert.ok(comInfo[0].todos().some(f => f.value === 'Verniz FO10 6717'),
    'a tabela não mostra o nome que vai para a ficha');

  // O (i) diz de onde veio. Essa é a direção útil: a origem só interessa
  // quando algo parece errado.
  assert.match(info.title, /Verniz FO10 - 6717 Em Lamina De Madeira/);
});

test('as colunas curtas da sub-lista têm largura fixa', async () => {
  const b = criarBancada({ leitura: leituraFichaCasada() });
  await b.pronta();
  const linhas = await abrirInsumos(b);

  // Deixá-las crescerem à vontade espremia o NOME DO INSUMO, que é a única
  // coluna que precisa ser lida inteira para se conferir a ficha.
  const celulas = linhas[1].todos().filter(f => f.tagName === 'TD');
  assert.ok(celulas.some(c => c.classList.contains('ia-sub-processo')));
  assert.ok(celulas.some(c => c.classList.contains('ia-sub-qtde')));
  assert.ok(celulas.some(c => c.classList.contains('ia-sub-unidade')));
  // O nome não: é ele que fica com o que sobra.
  const nome = celulas.find(c => c.todos().some(f => f.value === 'MDF 06'));
  assert.equal(nome.className.includes('ia-sub-'), false);
});

// ---------------------------------------------------------------------------
// ETAPA 18 — o popover ancorado no (i) certo
// ---------------------------------------------------------------------------

test('o popover é ancorado no (i) que o abriu', async () => {
  // Ele aparecia longe do ícone porque o `backdrop-filter` do modal cria um
  // bloco de contenção: dentro dele `position: fixed` deixa de ser relativo à
  // janela, e as coordenadas certas viram posição errada.
  const b = criarBancada({ leitura: leituraComDetalhe() });
  await b.pronta();

  const info = infoDa(linhasDeItem(b)[0]);
  info.disparar('click');
  await b.pronta();

  const ancorado = b.ancorados.at(-1);
  assert.ok(ancorado, 'o popover não passou pelo posicionador');
  assert.strictEqual(ancorado.ancora, info, 'ancorou no elemento errado');
  assert.strictEqual(ancorado.popover.id, 'iaDetLinhaPopover');
});

test('fechar o modal leva o popover junto', async () => {
  const b = criarBancada({ leitura: leituraComDetalhe() });
  await b.pronta();

  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  // O popover é movido para o <body> e não sai com o modal. Órfão, ele duplica
  // o id e faz `getElementById` devolver um elemento que não está ligado a
  // nada — e o sintoma ("o popover parou de abrir") não aponta para a causa.
  assert.match(fonte, /Popover\?\.descartar\(/);
});

// ---------------------------------------------------------------------------
// ETAPA 19 — linha descartada sai de circulação
// ---------------------------------------------------------------------------

test('linha descartada TAMBÉM se marca', async () => {
  const leitura = leituraPadrao();
  leitura.itens[0].acao = 'ignorar';
  const b = criarBancada({ leitura });
  await b.pronta();

  // Antes não se marcava, para os contadores do rodapé não mentirem. Só que o
  // remédio adoecia o paciente: a linha que mais precisa de uma decisão era
  // justamente a que não podia ser apontada, e com ela o rodapé sumia.
  //
  // Marcar é dizer "é desta que eu falo". Contar é problema de cada botão.
  assert.ok(marcaDa(linhasDeItem(b)[0]), 'a linha descartada não pode ser apontada');
  assert.ok(marcaDa(linhasDeItem(b)[1]));
});

test('linha já aplicada continua fora da seleção', async () => {
  const leitura = leituraPadrao();
  leitura.itens[0].status = 'aplicado';
  const b = criarBancada({ leitura });
  await b.pronta();

  // Aplicada não muda mais: o registro já está no módulo de destino, e marcá-la
  // ofereceria decisões que não têm mais efeito nenhum.
  assert.equal(marcaDa(linhasDeItem(b)[0]), undefined);
});

test('marcar a descartada abre a decisão para ela', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    exige_alvo: true, rotulo_alvo: 'Cliente',
    alvos: [{ id: 50, nome: 'Casa Vicenzo', tabela: 'clientes' }]
  });
  leitura.itens = [
    { ...leitura.itens[0], acao: 'ignorar' },
    { ...leitura.itens[1], alvo_id: null, acao: 'criar' }
  ];

  const b = criarBancada({ leitura });
  await b.pronta();

  marcaDa(linhasDeItem(b)[0]).checked = true;
  marcaDa(linhasDeItem(b)[0]).disparar('change');
  await b.pronta();

  b.el('iaDetEscolherAlvo').disparar('click');
  await b.pronta();

  // A MARCADA vem primeiro, e vem sozinha: é o gesto explícito de dizer "é
  // desta que eu falo". Sem isso o rodapé resolveria a outra linha travada e a
  // pessoa mexeria na linha errada sem perceber.
  assert.strictEqual(b.janela.iaAcaoPedido.itemId, leitura.itens[0].id);
  assert.strictEqual(b.janela.iaAcaoPedido.descartada, true);
});

test('a decisão de uma linha descartada é trazê-la de volta', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    exige_alvo: true, rotulo_alvo: 'Cliente',
    alvos: [{ id: 50, nome: 'Casa Vicenzo', tabela: 'clientes' }]
  });
  leitura.itens = leitura.itens.map(i => ({ ...i, acao: 'ignorar' }));

  const b = criarBancada({ leitura });
  await b.pronta();
  marcaDa(linhasDeItem(b)[0]).checked = true;
  marcaDa(linhasDeItem(b)[0]).disparar('change');
  await b.pronta();
  b.el('iaDetEscolherAlvo').disparar('click');
  await b.pronta();

  await b.janela.iaAcaoPedido.aoDecidir({ tipo: 'restaurar' });
  await b.pronta();

  assert.strictEqual(b.chamadas.find(c => c.metodo === 'PUT').corpo.acao, 'criar');
});

test('marcar todas ignora as descartadas', async () => {
  const leitura = leituraPadrao();
  leitura.itens[0].acao = 'ignorar';
  const b = criarBancada({ leitura });
  await b.pronta();

  const todos = b.el('iaDetItensCabecalho').filhos[0].todos()
    .find(f => f.classList.contains('ia-selecao'));
  todos.checked = true;
  todos.disparar('change');
  await b.pronta();

  assert.match(b.el('iaDetDescartar').texto(), /Descartar 1 selecionada/);
});

test('descartar uma linha marcada a tira da seleção', async () => {
  const b = criarBancada();
  await b.pronta();

  marcaDa(linhasDeItem(b)[0]).checked = true;
  marcaDa(linhasDeItem(b)[0]).disparar('change');
  await b.pronta();
  b.el('iaDetDescartar').disparar('click');
  await b.pronta();

  // Descartar o que já está descartado não faz nada, e um botão que às vezes
  // não funciona é pior do que um botão que some.
  assert.equal(b.el('iaDetDescartar').classList.contains('hidden'), true);
});

test('a empresa deixa doze colunas e fica com quatro', () => {
  const { camposParaTela } = require('../../../backend/iaEsquemas');
  const naGrade = camposParaTela('clientes').filter(c => c.naGrade);

  // Doze colunas espremidas davam a cada uma menos de dez caracteres:
  // "PROVENCE CAS…", "39.778.846…", "Rua Modes…".
  assert.deepEqual(naGrade.map(c => c.chave),
    ['nome_fantasia', 'razao_social', 'cnpj', 'contatos']);

  const largura = chave => camposParaTela('clientes').find(c => c.chave === chave).largura;
  assert.equal(largura('nome_fantasia'), 'enorme');
  assert.equal(largura('razao_social'), 'enorme');
  assert.equal(largura('cnpj'), 'grande');
});

// ---------------------------------------------------------------------------
// ETAPA 17 — unidade, processo e insumo são TABELA, não texto livre
// ---------------------------------------------------------------------------

/** Ficha com as listas restritas que o backend manda. */
function leituraFichaRestrita() {
  const leitura = leituraFichaCasada();
  leitura.sugestoes = {
    'insumos.nome': ['MDF 06', 'Verniz FO10 6717', 'Cola Branca'],
    'insumos.unidade': ['CH', 'ML', 'M2'],
    'insumos.processo': ['MARCENARIA', 'ACABAMENTO', 'MONTAGEM', 'EMBALAGEM'],
    __restritos: ['insumos.nome', 'insumos.unidade', 'insumos.processo']
  };
  return leitura;
}

test('os campos de tabela ganham a lista de opções do banco', async () => {
  const b = criarBancada({ leitura: leituraFichaRestrita() });
  await b.pronta();
  const linhas = await abrirInsumos(b);

  // linhas[0] é o cabeçalho da sub-tabela; os itens começam em 1.
  const campos = linhas[1].todos().filter(f => f.tagName === 'INPUT');
  const chaves = campos.map(c => c.dataset.chave);
  assert.ok(chaves.includes('insumos.unidade'));
  assert.ok(chaves.includes('insumos.processo'));
  assert.ok(chaves.includes('insumos.nome'));
});

test('valor que não está na tabela é recusado e o campo volta atrás', async () => {
  const b = criarBancada({ leitura: leituraFichaRestrita() });
  await b.pronta();
  const linhas = await abrirInsumos(b);

  const unidade = linhas[1].todos()
    .find(f => f.tagName === 'INPUT' && f.dataset.chave === 'insumos.unidade');
  const antes = unidade.value;

  unidade.value = 'litros';
  unidade.disparar('change');
  await b.pronta();

  // Digitar "litros" não cria a unidade: cria um texto que não corresponde a
  // nada e que o formulário do outro lado ignora em silêncio.
  assert.equal(unidade.value, antes, 'aceitou um valor que não existe na tabela');
  assert.equal(b.chamadas.some(c => c.metodo === 'PUT'), false);
  assert.match(b.toasts.at(-1).msg, /não está cadastrado/);
});

test('digitar serve para PROCURAR: caixa e acento não impedem', async () => {
  const b = criarBancada({ leitura: leituraFichaRestrita() });
  await b.pronta();
  const linhas = await abrirInsumos(b);

  const processo = linhas[1].todos()
    .find(f => f.tagName === 'INPUT' && f.dataset.chave === 'insumos.processo');

  processo.value = 'montagem';
  processo.disparar('change');
  await b.pronta();

  // Grava a opção como ela é na tabela, não como foi digitada.
  assert.equal(processo.value, 'MONTAGEM');
  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.equal(put.corpo.dados.insumos[0].processo, 'MONTAGEM');
});

test('trocar o nome à mão descarta o casamento anterior', async () => {
  const b = criarBancada({ leitura: leituraFichaRestrita() });
  await b.pronta();
  const linhas = await abrirInsumos(b);

  // O segundo insumo é o que casou por semelhança e carrega `_cadastro`.
  const nome = linhas[2].todos()
    .find(f => f.tagName === 'INPUT' && f.dataset.chave === 'insumos.nome');
  nome.value = 'Cola Branca';
  nome.disparar('change');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  // O `_cadastro` guardado valia para o nome antigo. Mantê-lo faria o (i)
  // apontar para um casamento que já não existe.
  assert.equal(put.corpo.dados.insumos[1]._cadastro, null);
  assert.equal(put.corpo.dados.insumos[1].nome, 'Cola Branca');
});

// ---------------------------------------------------------------------------
// ETAPA 20 — a transição não parece defeito
// ---------------------------------------------------------------------------

test('o véu com a logo cobre a montagem do formulário', async () => {
  const b = criarBancada();
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  // Sem esperar: o véu tem de estar lá ENQUANTO a carga é buscada.
  const durante = b.corpoDaPagina.filhos.some(f => f.id === 'iaAbrindoModulo');
  assert.equal(durante, true, 'a tela ficou sem aviso de carregando');

  await b.pronta();
  // E some quando acaba: um véu que fica é a tela travada.
  assert.equal(b.corpoDaPagina.filhos.some(f => f.id === 'iaAbrindoModulo'), false);
});

test('o formulário só aparece depois de preenchido', async () => {
  const b = criarBancada();
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  // Revelar antes mostraria o formulário em branco enchendo-se sozinho, campo
  // a campo — que parece defeito, não carregamento. E não revelar nunca é o
  // outro lado do mesmo erro: o formulário abriria invisível.
  assert.equal(b.el('novoInsumoOverlay').classList.contains('hidden'), false,
    'o formulário nunca apareceu');

  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  const abrir = /function abrirPorCima\(config\) \{[\s\S]*?\n  \}/.exec(fonte)[0];
  assert.doesNotMatch(abrir, /classList\.remove\('hidden'\)/,
    'o overlay é revelado antes do preenchimento');
});

test('a falha no preenchimento não deixa o véu preso', async () => {
  const b = criarBancada({
    respostaPreenchimento: { status: 500, corpo: { error: 'boom' } }
  });
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  // Um véu que fica é a tela bloqueada por algo que ninguém consegue tirar.
  assert.equal(b.corpoDaPagina.filhos.some(f => f.id === 'iaAbrindoModulo'), false);
  assert.match(b.toasts.at(-1).msg, /boom|não foi possível/i);
});

test('o CSS do módulo de destino é carregado junto', async () => {
  const b = criarBancada();
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  // O programa carrega uma folha de módulo por vez. Sem esta, o formulário de
  // Produtos abre com metade do estilo: botões quadrados onde deviam ser
  // redondos, espaçamentos de outro lugar.
  const link = b.el('iaDetItensCorpo') && null;
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  assert.match(fonte, /garantirEstiloDoModulo/);
  for (const css of ['materia-prima', 'clientes', 'prospeccoes', 'produtos', 'orcamentos']) {
    assert.match(fonte, new RegExp(`css: '${css}'`), `${css} ficou sem folha de estilo`);
  }
  assert.equal(link, null);
});


// ---------------------------------------------------------------------------
// ETAPA 23 e 26 — pendências bloqueiam, e o módulo avisa quando salva
// ---------------------------------------------------------------------------

/** Ficha com um insumo incompleto e outro sem cadastro. */
function leituraFichaIncompleta() {
  const leitura = leituraFichaRestrita();
  leitura.campos[2].subcampos = leitura.campos[2].subcampos.map(sc => ({ ...sc, exigido: true }));
  leitura.itens[0].dados.insumos = [
    { processo: 'MARCENARIA', nome: 'MDF 06', quantidade: 0.07, unidade: 'm2', _casamento: 'exato', _cadastro: 'MDF 06' },
    { processo: 'ACABAMENTO', nome: 'Wash Primer', quantidade: 1, unidade: '', _casamento: 'exato', _cadastro: 'Wash Primer' }
  ];
  return leitura;
}

test('insumo sem unidade impede abrir o formulário, dizendo qual', async () => {
  const b = criarBancada({ leitura: leituraFichaIncompleta() });
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  // Um insumo sem unidade entra direto na tabela do produto, já montado — e do
  // outro lado não há onde corrigir. O que não pode ser completado depois tem
  // de ser completado aqui.
  assert.equal(b.chamadas.some(c => /\/preenchimento$/.test(c.url)), false,
    'abriu o formulário com insumo incompleto');
  assert.match(b.toasts.at(-1).msg, /Wash Primer: sem un/i);
});

test('o botão avisa da pendência antes do clique', async () => {
  const b = criarBancada({ leitura: leituraFichaIncompleta() });
  await b.pronta();

  // Descobrir depois é descobrir com o formulário já na frente.
  assert.equal(b.el('iaDetAplicar').classList.contains('ia-btn-pendente'), true);
  assert.match(b.el('iaDetAplicar').title, /Falta preencher/);
});

test('insumo fora do cadastro também impede', async () => {
  const leitura = leituraFichaIncompleta();
  leitura.itens[0].dados.insumos[1] = {
    processo: 'MONTAGEM', nome: 'Couro Serpente', quantidade: 1, unidade: 'm2',
    _casamento: null, _cadastro: null
  };
  const b = criarBancada({ leitura });
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  assert.match(b.toasts.at(-1).msg, /não está no cadastro/);
});

test('linha completa abre normalmente', async () => {
  const leitura = leituraFichaIncompleta();
  leitura.itens[0].dados.insumos[1].unidade = 'ML';
  const b = criarBancada({ leitura });
  await b.pronta();

  assert.equal(b.el('iaDetAplicar').classList.contains('ia-btn-pendente'), false);
  b.el('iaDetAplicar').disparar('click');
  await b.pronta();
  assert.equal(b.chamadas.some(c => /\/preenchimento$/.test(c.url)), true);
});

test('o aviso do módulo marca a linha como resolvida', async () => {
  const b = criarBancada();
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  // A leitura não tem como saber sozinha que o cadastro entrou: ela não gravou
  // nada e não fica olhando o banco. Quem sabe é quem salvou.
  b.dispararNaJanela('moduloSalvou', { detail: { overlay: 'novoInsumo' } });
  await b.pronta();

  const put = b.chamadas.filter(c => c.metodo === 'PUT').at(-1);

  // `resolvido` e não `acao: 'ignorar'`: a linha VIROU cadastro do outro lado,
  // e "ignorar" é a marca de quem JOGA FORA uma linha. Com as duas usando a
  // mesma marca, nada distinguia uma leitura que rendeu de uma inteiramente
  // descartada — nem na lista, nem na contagem de aplicados.
  assert.deepEqual(put.corpo, { resolvido: true });
  assert.match(b.toasts.at(-1).msg, /resolvida/i);
});

test('aviso de outro modal não marca nada', async () => {
  const b = criarBancada();
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();
  const antes = b.chamadas.filter(c => c.metodo === 'PUT').length;

  // Salvar um cliente noutra aba não pode marcar a linha de um insumo.
  b.dispararNaJanela('moduloSalvou', { detail: { overlay: 'novoCliente' } });
  await b.pronta();

  assert.equal(b.chamadas.filter(c => c.metodo === 'PUT').length, antes);
});

test('aviso sem ninguém esperando é ignorado', async () => {
  const b = criarBancada();
  await b.pronta();

  b.dispararNaJanela('moduloSalvou', { detail: { overlay: 'novoInsumo' } });
  await b.pronta();

  assert.equal(b.chamadas.some(c => c.metodo === 'PUT'), false);
});

test('todos os formulários de destino avisam quando salvam', () => {
  // O contrato só fecha se as duas pontas existirem. Um módulo que não avisa
  // deixa a linha pendente para sempre, sem erro nenhum.
  const modais = {
    'materia-prima-novo': 'novoInsumo',
    'cliente-novo': 'novoCliente',
    'prospeccao-novo': 'novaProspeccao',
    'produto-novo': 'novoProduto',
    'orcamento-novo': 'overlayId'
  };
  for (const [arquivo, overlay] of Object.entries(modais)) {
    const fonte = fs.readFileSync(path.join(__dirname, '..', 'modals', `${arquivo}.js`), 'utf8');
    assert.match(fonte, /moduloSalvou/, `${arquivo} não avisa que salvou`);
    assert.ok(fonte.includes(overlay), `${arquivo} avisa sem dizer de qual formulário`);
  }
});

// ---------------------------------------------------------------------------
// ETAPA 27 — divergência de unidade e etapa
// ---------------------------------------------------------------------------

/** Ficha com um insumo cuja unidade não bate com o cadastro. */
function leituraFichaDivergente() {
  const leitura = leituraFichaRestrita();
  leitura.itens[0].dados.insumos = [
    {
      processo: 'MARCENARIA', nome: 'MDF 06', quantidade: 0.07, unidade: 'm2',
      _casamento: 'exato', _cadastro: 'MDF 06',
      _unidade_cadastro: 'M2', _processo_cadastro: 'MARCENARIA',
      _unidade_ok: true, _processo_ok: true
    },
    {
      processo: 'ACABAMENTO', nome: 'Wash Primer', quantidade: 1, unidade: 'm2',
      _casamento: 'exato', _cadastro: 'Wash Primer',
      _unidade_cadastro: 'ML', _processo_cadastro: 'ACABAMENTO',
      _unidade_ok: false, _processo_ok: true
    }
  ];
  return leitura;
}

test('a célula divergente ganha sinal de atenção com o valor do cadastro', async () => {
  const b = criarBancada({ leitura: leituraFichaDivergente() });
  await b.pronta();
  const linhas = await abrirInsumos(b);

  // O aviso tem de estar na CÉLULA que diverge: a linha inteira em vermelho
  // não diria qual dos campos está errado.
  const alertas = linhas.flatMap(l => l.todos().filter(f => f.classList.contains('ia-alerta-campo')));
  assert.equal(alertas.length, 1, 'a divergência não se anuncia');
  assert.match(alertas[0].title, /ML/);

  // E o campo se distingue dos outros.
  const divergentes = linhas.flatMap(l => l.todos().filter(f => f.classList.contains('ia-campo--divergente')));
  assert.equal(divergentes.length, 1);
  assert.equal(divergentes[0].value, 'm2');
});

test('divergência impede enviar ao formulário, dizendo qual', async () => {
  const b = criarBancada({ leitura: leituraFichaDivergente() });
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();

  // O insumo entra na ficha com a unidade do CADASTRO. Enviar divergente faria
  // a linha virar outra coisa do outro lado, sem nada parecer errado.
  assert.equal(b.chamadas.some(c => /\/preenchimento$/.test(c.url)), false);
  assert.match(b.toasts.at(-1).msg, /unidade não é "ML"/);
});

test('etapa divergente também bloqueia', async () => {
  const leitura = leituraFichaDivergente();
  leitura.itens[0].dados.insumos[1]._unidade_ok = true;
  leitura.itens[0].dados.insumos[1]._processo_ok = false;
  leitura.itens[0].dados.insumos[1]._processo_cadastro = 'MONTAGEM';

  const b = criarBancada({ leitura });
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();
  assert.match(b.toasts.at(-1).msg, /etapa não é "MONTAGEM"/);
});

test('tudo congruente abre normalmente', async () => {
  const leitura = leituraFichaDivergente();
  leitura.itens[0].dados.insumos[1]._unidade_ok = true;
  const b = criarBancada({ leitura });
  await b.pronta();

  b.el('iaDetAplicar').disparar('click');
  await b.pronta();
  assert.equal(b.chamadas.some(c => /\/preenchimento$/.test(c.url)), true);
});

test('a coluna de unidade cabe cinco caracteres', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'ia.css'), 'utf8');
  const regra = /\.ia-sub-unidade \{([\s\S]*?)\}/.exec(css);
  assert.ok(regra);
  // 7ch: cinco caracteres mais o respiro da caixa de texto.
  assert.match(regra[1], /width:\s*7ch/);
});

// ---------------------------------------------------------------------------
// ETAPAS 28 A 31 — situação, catálogo e escolha do destino
// ---------------------------------------------------------------------------

test('o cabeçalho acompanha a leitura que se fechou', async () => {
  const b = criarBancada({
    respostaPut: { corpoExtra: { leitura_status: 'aplicada', leitura_status_rotulo: 'Concluída' } }
  });
  await b.pronta();

  marcaDa(linhasDeItem(b)[0]).checked = true;
  marcaDa(linhasDeItem(b)[0]).disparar('change');
  await b.pronta();
  b.el('iaDetDescartar').disparar('click');
  await b.pronta();

  // Sem trazer a situação para cá, o cabeçalho continuaria dizendo "Em
  // revisão" até alguém fechar e reabrir — e o rodapé continuaria oferecendo
  // botões para uma leitura que já acabou.
  assert.equal(b.el('iaDetStatus').texto(), 'Concluída');
});

test('a peça e o preço do pedido não se digitam', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos',
    destino_rotulo: 'Orçamentos',
    campos: [
      { chave: 'cliente', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true, largura: 'grande', naGrade: true },
      {
        chave: 'itens', rotulo: 'Itens', tipo: 'lista', largura: 'media', naGrade: true,
        subcampos: [
          { chave: 'codigo', rotulo: 'Código', tipo: 'texto' },
          { chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true },
          { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero', obrigatorio: true },
          { chave: 'valor_unitario', rotulo: 'Valor un.', tipo: 'dinheiro' }
        ]
      }
    ],
    itens: [{
      id: 1, linha: 1, acao: 'criar', alvo_id: 50, status: 'pendente', mensagem: null,
      dados: {
        cliente: 'Casa Vicenzo',
        itens: [{
          codigo: 'PR-210', nome: 'Painel de Ripas', quantidade: 2, valor_unitario: 1,
          _casamento: 'exato', _cadastro: 'Painel Ripado 2,10', _lido: 'Painel de Ripas', _preco: 900
        }]
      }
    }]
  });

  const b = criarBancada({ leitura });
  await b.pronta();
  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();
  const linhas = subLinhas(b)[0].todos().filter(f => f.tagName === 'TR');

  const campos = linhas[1].todos().filter(f => f.tagName === 'INPUT');
  const porChave = c => campos.find(f => f.dataset.chave === `itens.${c}`);

  // Um código digitado à mão não existe; um preço digitado à mão ninguém
  // aprovou. Os dois vêm da peça, e é a peça que se escolhe.
  assert.equal(porChave('codigo').readOnly, true);
  assert.equal(porChave('valor_unitario').readOnly, true);
  assert.equal(porChave('quantidade').readOnly, false);

  // E o campo AVISA que é fixo. Um input travado sem marca nenhuma parece um
  // input quebrado: o usuário clica, digita, nada acontece, e não há nada na
  // tela dizendo por quê.
  assert.ok(porChave('codigo').classList.contains('ia-campo--fixo'));
  assert.ok(porChave('valor_unitario').classList.contains('ia-campo--fixo'));
  assert.equal(porChave('quantidade').classList.contains('ia-campo--fixo'), false);


  // O preço mostrado é o do catálogo, não o do documento.
  assert.equal(porChave('valor_unitario').value, '900');
});

test('a peça do pedido só aceita nome que existe no catálogo', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    campos: [{
      chave: 'itens', rotulo: 'Itens', tipo: 'lista', largura: 'media', naGrade: true,
      subcampos: [
        { chave: 'codigo', rotulo: 'Código', tipo: 'texto' },
        { chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true }
      ]
    }],
    sugestoes: { 'itens.nome': ['Painel Ripado 2,10', 'Mesa Lateral Carvalho'], __restritos: ['itens.nome'] },
    itens: [{
      id: 1, linha: 1, acao: 'criar', alvo_id: 50, status: 'pendente', mensagem: null,
      dados: { itens: [{ codigo: 'PR-210', nome: 'Painel Ripado 2,10', _casamento: 'exato' }] }
    }]
  });

  const b = criarBancada({ leitura });
  await b.pronta();
  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const daSubLinha = chave => subLinhas(b)[0].todos()
    .find(f => f.tagName === 'INPUT' && f.dataset.chave === `itens.${chave}`);
  const nome = daSubLinha('nome');

  // O campo anuncia que é uma lista. Sem isso, casado o item e desfeita a linha
  // vermelha, ele vira texto comum — e nada mais na tela diz que aquela peça se
  // troca escolhendo outra.
  assert.ok(nome.classList.contains('ia-campo--lista'));
  assert.equal(daSubLinha('codigo').classList.contains('ia-campo--lista'), false);

  nome.value = 'Cadeira Que Não Existe';
  nome.disparar('change');
  await b.pronta();

  // Um nome livre cria um item que o orçamento recusa do outro lado — e o
  // erro só apareceria com o formulário já aberto. O campo volta ao que era.
  assert.equal(b.chamadas.some(c => c.metodo === 'PUT'), false);
  assert.equal(nome.value, 'Painel Ripado 2,10');
  assert.match(b.toasts.at(-1).msg, /não está cadastrado/);
});

test('linha sem destino revela o botão de escolher', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    exige_alvo: true, rotulo_alvo: 'Cliente ou prospecção',
    alvos: [{ id: 50, nome: 'Casa Vicenzo (Cliente)', tabela: 'clientes' }]
  });
  leitura.itens = leitura.itens.map(i => ({ ...i, alvo_id: null, acao: 'criar' }));

  const b = criarBancada({ leitura });
  await b.pronta();

  // A coluna "O que fazer" saiu, e com ela o único lugar em que se podia
  // apontar o cliente. Sem este botão a linha ficava num beco: vermelha, sem
  // caminho, e o botão de abrir recusando sem oferecer saída.
  assert.equal(b.el('iaDetEscolherAlvo').classList.contains('hidden'), false);
  assert.match(b.el('iaDetEscolherAlvo').title, /sem cliente ou prospecção/i);
});

test('a linha travada abre "O que fazer", com o motivo e a lista', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    exige_alvo: true, rotulo_alvo: 'Cliente ou prospecção',
    alvos: [{ id: 50, nome: 'Casa Vicenzo (Cliente)', tabela: 'clientes' }]
  });
  leitura.itens = leitura.itens.map(i => ({
    ...i, alvo_id: null, acao: 'criar',
    mensagem: 'Empresa não encontrada em Clientes nem em Prospecções'
  }));

  const b = criarBancada({ leitura });
  await b.pronta();

  const decidir = linhasDeItem(b)[0].todos()
    .find(f => f.classList?.contains('ia-btn-decidir'));
  assert.ok(decidir, 'a linha travada não oferece saída nenhuma');

  decidir.disparar('click');
  await b.pronta();

  // A tela precisa dos três: de qual linha se trata, por que ela parou, e o
  // que existe no sistema para apontar. Sem o motivo, a pessoa decide no
  // escuro; sem a lista, não decide nada.
  const pedido = b.janela.iaAcaoPedido;
  assert.ok(pedido, 'o modal abriu sem pedido nenhum');
  assert.match(pedido.motivo, /não encontrada/);
  assert.equal(pedido.rotuloAlvo, 'Cliente ou prospecção');
  assert.deepEqual(pedido.alvos.map(a => a.id), [50]);

  const aberto = b.modaisAbertos.at(-1);
  assert.equal(aberto.overlay, 'iaAcao');
  assert.match(aberto.html, /ia\/acao\.html$/);
});

test('apontar a empresa grava o id, não o nome', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    exige_alvo: true, rotulo_alvo: 'Cliente',
    alvos: [{ id: 50, nome: 'Casa Vicenzo', tabela: 'clientes' }]
  });
  leitura.itens = leitura.itens.map(i => ({ ...i, alvo_id: null, acao: 'criar' }));

  const b = criarBancada({ leitura });
  await b.pronta();
  linhasDeItem(b)[0].todos()
    .find(f => f.classList?.contains('ia-btn-decidir')).disparar('click');
  await b.pronta();

  // O que o formulário do outro lado precisa é o ID. Um nome não aponta para
  // registro nenhum — e o erro só apareceria com o orçamento já aberto.
  await b.janela.iaAcaoPedido.aoDecidir({
    tipo: 'apontar', alvo: { id: 50, nome: 'Casa Vicenzo', tabela: 'clientes' }
  });
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.equal(put.corpo.alvo_id, 50);
  assert.equal(put.corpo.alvo_tabela, 'clientes');
});

test('descartar pela mesma tela marca a linha', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    exige_alvo: true, rotulo_alvo: 'Cliente',
    alvos: [{ id: 50, nome: 'Casa Vicenzo', tabela: 'clientes' }]
  });
  leitura.itens = leitura.itens.map(i => ({ ...i, alvo_id: null, acao: 'criar' }));

  const b = criarBancada({ leitura });
  await b.pronta();
  linhasDeItem(b)[0].todos()
    .find(f => f.classList?.contains('ia-btn-decidir')).disparar('click');
  await b.pronta();

  await b.janela.iaAcaoPedido.aoDecidir({ tipo: 'descartar' });
  await b.pronta();

  assert.equal(b.chamadas.find(c => c.metodo === 'PUT').corpo.acao, 'ignorar');
});

test('linha descartada pode voltar', async () => {
  const leitura = leituraPadrao();
  leitura.itens = leitura.itens.map(i => ({ ...i, acao: 'ignorar' }));

  const b = criarBancada({ leitura });
  await b.pronta();

  const voltar = linhasDeItem(b)[0].todos()
    .find(f => f.classList?.contains('ia-btn-decidir'));
  assert.ok(voltar, 'linha descartada não tem volta');

  voltar.disparar('click');
  await b.pronta();

  // Sem volta, um clique errado obrigava a extrair a leitura inteira de novo —
  // e extrair custa crédito de API.
  assert.equal(b.chamadas.find(c => c.metodo === 'PUT').corpo.acao, 'criar');
});

test('destino que não exige alvo não mostra o botão', async () => {
  const b = criarBancada();
  await b.pronta();
  assert.equal(b.el('iaDetEscolherAlvo').classList.contains('hidden'), true);
});

// ---------------------------------------------------------------------------
// ETAPAS 32 A 35 — a linha travada tem saída, e a lista fica sabendo
// ---------------------------------------------------------------------------

test('o campo do catálogo anuncia que é uma lista', async () => {
  const leitura = leituraPadrao({
    sugestoes: { unidade: ['CH', 'UN'], __restritos: ['unidade'] }
  });

  const b = criarBancada({ leitura });
  await b.pronta();
  const campos = camposDa(linhasDeItem(b)[0]);
  const porChave = c => campos.find(f => f.dataset.chave === c);

  // A moldura do `.ia-campo` só aparece no foco, de propósito — uma borda em
  // todos vira tabuleiro. O efeito colateral era que, assim que o item casava,
  // o campo virava texto comum: nada mais dizia que aquele valor se TROCA, e
  // trocá-lo passou a parecer impossível.
  assert.ok(porChave('unidade').classList.contains('ia-campo--lista'));
  assert.equal(porChave('nome').classList.contains('ia-campo--lista'), false);
});

test('o cursor não sai da tabela a cada correção', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    campos: [{
      chave: 'itens', rotulo: 'Itens', tipo: 'lista', largura: 'media', naGrade: true,
      subcampos: [
        { chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true },
        { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero' }
      ]
    }],
    itens: [{
      id: 1, linha: 1, acao: 'criar', alvo_id: 50, status: 'pendente', mensagem: null,
      dados: { itens: [{ nome: 'Painel Ripado', quantidade: 3 }] }
    }]
  });

  const b = criarBancada({ leitura });
  await b.pronta();
  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const campoNome = () => subLinhas(b)[0].todos()
    .find(f => f.tagName === 'INPUT' && f.dataset.chave === 'itens.nome');

  const antes = campoNome();
  assert.ok(antes.dataset.campoId, 'o campo não tem identidade para ser reencontrado');
  b.focar(antes);

  antes.value = 'Painel Ripado 2,10';
  antes.disparar('change');
  await b.pronta();

  // Gravar um item da sub-lista refaz a grade inteira, e `replaceChildren`
  // destrói o campo em que a pessoa está digitando. Sem devolver o foco, cada
  // correção joga o cursor para fora da tabela — e o campo que ela acabou de
  // trocar deixa de parecer um campo, o que fez a troca seguinte parecer
  // impossível.
  const depois = campoNome();
  assert.notStrictEqual(depois, antes, 'a grade nem foi redesenhada');
  assert.strictEqual(b.focado(), depois);
});

test('a tabela do módulo fica sabendo quando a leitura se fecha', async () => {
  const b = criarBancada({
    respostaPut: { corpoExtra: { leitura_status: 'aplicada', leitura_status_rotulo: 'Concluída' } }
  });
  await b.pronta();

  marcaDa(linhasDeItem(b)[0]).checked = true;
  marcaDa(linhasDeItem(b)[0]).disparar('change');
  await b.pronta();
  b.el('iaDetDescartar').disparar('click');
  await b.pronta();

  // Sem este aviso, quem fechava o modal via "Em revisão" numa leitura que
  // acabara de virar "Concluída" — e só recarregando o módulo inteiro a lista
  // contava a verdade.
  assert.ok(b.avisos.includes('iaLeituraAlterada'),
    `a lista não foi avisada; avisos: ${JSON.stringify(b.avisos)}`);
});

test('correção que não fecha a leitura avisa ao fechar o modal', async () => {
  const b = criarBancada();
  await b.pronta();

  const preco = camposDa(linhasDeItem(b)[0])[3];
  preco.value = '199,90';
  preco.disparar('change');
  await b.pronta();
  assert.equal(b.avisos.includes('iaLeituraAlterada'), false, 'avisou cedo demais');

  b.el('iaDetFechar').disparar('click');
  await b.pronta();

  // A contagem de itens da lista sai daqui: ela precisa saber de qualquer
  // correção, não só das que fecham a leitura.
  assert.ok(b.avisos.includes('iaLeituraAlterada'));
});

test('modal sem nada gravado não incomoda a lista', async () => {
  const b = criarBancada();
  await b.pronta();
  b.el('iaDetFechar').disparar('click');
  await b.pronta();

  // Recarregar a grade do módulo por um modal que só foi aberto e fechado
  // gasta uma ida ao backend e pisca a tela sem motivo.
  assert.equal(b.avisos.includes('iaLeituraAlterada'), false);
});

test('a decisão leva o motivo que travou a linha', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    exige_alvo: true, rotulo_alvo: 'Cliente',
    alvos: [{ id: 50, nome: 'Casa Vicenzo', tabela: 'clientes' }]
  });
  leitura.itens = leitura.itens.map(i => ({
    ...i, alvo_id: null, acao: 'criar', mensagem: 'Empresa não encontrada'
  }));

  const b = criarBancada({ leitura });
  await b.pronta();
  linhasDeItem(b)[0].todos()
    .find(f => f.classList?.contains('ia-btn-decidir')).disparar('click');
  await b.pronta();

  // Sem o motivo, a caixa vermelha da tela fica vazia e a pessoa decide no
  // escuro — ou fica procurando o texto que não veio.
  assert.equal(b.janela.iaAcaoPedido.motivo, 'Empresa não encontrada');
});

// ---------------------------------------------------------------------------
// ETAPA 37 — apagar um campo não apaga a linha
// ---------------------------------------------------------------------------

test('esvaziar um campo obrigatório volta atrás em vez de apagar a linha', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    campos: [{
      chave: 'itens', rotulo: 'Itens', tipo: 'lista', largura: 'media', naGrade: true,
      subcampos: [
        { chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true },
        { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero', obrigatorio: true }
      ]
    }],
    itens: [{
      id: 1, linha: 1, acao: 'criar', alvo_id: 50, status: 'pendente', mensagem: null,
      dados: { itens: [{ nome: 'Painel Ripado 2,10', quantidade: 3, _lido: 'PAINEL' }] }
    }]
  });

  const b = criarBancada({ leitura });
  await b.pronta();
  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const nome = () => subLinhas(b)[0].todos()
    .find(f => f.tagName === 'INPUT' && f.dataset.chave === 'itens.nome');

  nome().value = '';
  nome().disparar('change');
  await b.pronta();

  // A coerção do backend descarta sub-item sem campo obrigatório — certo para
  // o que a IA extraiu, mas numa edição a mão quem apagou o nome para digitar
  // outro perdia junto a quantidade e o registro do que o documento dizia.
  assert.equal(b.chamadas.some(c => c.metodo === 'PUT'), false, 'gravou o campo vazio');
  assert.equal(nome().value, 'Painel Ripado 2,10');
  assert.match(b.toasts.at(-1).msg, /não pode ficar em branco/);
});

test('só espaço em branco também não passa', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    campos: [{
      chave: 'itens', rotulo: 'Itens', tipo: 'lista', largura: 'media', naGrade: true,
      subcampos: [{ chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true }]
    }],
    itens: [{
      id: 1, linha: 1, acao: 'criar', alvo_id: 50, status: 'pendente', mensagem: null,
      dados: { itens: [{ nome: 'Painel Ripado 2,10' }] }
    }]
  });

  const b = criarBancada({ leitura });
  await b.pronta();
  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const nome = () => subLinhas(b)[0].todos()
    .find(f => f.tagName === 'INPUT' && f.dataset.chave === 'itens.nome');
  nome().value = '   ';
  nome().disparar('change');
  await b.pronta();

  assert.equal(b.chamadas.some(c => c.metodo === 'PUT'), false);
  assert.equal(nome().value, 'Painel Ripado 2,10');
});

test('campo que NÃO é obrigatório pode ficar vazio', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    campos: [{
      chave: 'itens', rotulo: 'Itens', tipo: 'lista', largura: 'media', naGrade: true,
      subcampos: [
        { chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true },
        { chave: 'observacao', rotulo: 'Obs.', tipo: 'texto' }
      ]
    }],
    itens: [{
      id: 1, linha: 1, acao: 'criar', alvo_id: 50, status: 'pendente', mensagem: null,
      dados: { itens: [{ nome: 'Painel Ripado 2,10', observacao: 'entregar na obra' }] }
    }]
  });

  const b = criarBancada({ leitura });
  await b.pronta();
  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const obs = subLinhas(b)[0].todos()
    .find(f => f.tagName === 'INPUT' && f.dataset.chave === 'itens.observacao');
  obs.value = '';
  obs.disparar('change');
  await b.pronta();

  // Apagar uma observação é uma edição legítima, e a linha sobrevive a ela.
  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.ok(put, 'a correção não saiu do navegador');
  assert.equal(put.corpo.dados.itens[0].observacao, '');
});

test('o (i) de quem casou pelo preço é amarelo', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    campos: [{
      chave: 'itens', rotulo: 'Itens', tipo: 'lista', largura: 'media', naGrade: true,
      subcampos: [{ chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true }]
    }],
    itens: [{
      id: 1, linha: 1, acao: 'criar', alvo_id: 50, status: 'pendente', mensagem: null,
      dados: {
        itens: [
          { nome: 'BASE AO CUBO 3060', _casamento: 'valor', _cadastro: 'Base Ao Cubo Retangular - G', _lido: 'BASE AO CUBO 3060' },
          { nome: 'Painel de Ripas', _casamento: 'semelhante', _cadastro: 'Painel Ripado 2,10', _lido: 'Painel de Ripas' }
        ]
      }
    }]
  });

  const b = criarBancada({ leitura });
  await b.pronta();
  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const icones = subLinhas(b)[0].todos().filter(f => f.classList?.contains('ia-info-insumo'));
  assert.equal(icones.length, 2, 'os dois itens deviam ter (i)');

  // Casar só pelo preço é o desfecho mais fraco que o programa aceita. Numa
  // grade de vinte linhas, quem revisa precisa achar de relance as que merecem
  // uma segunda olhada antes de o preço sair para o cliente.
  assert.ok(icones[0].classList.contains('ia-info-insumo--fraco'));
  assert.equal(icones[1].classList.contains('ia-info-insumo--fraco'), false);

  // O aviso diz as DUAS coisas: o que o documento escreveu, e que quem
  // encontrou a peça foi a checagem de preço. Só a cor não explica nada a
  // quem chegou agora na tela.
  assert.match(icones[0].title, /BASE AO CUBO 3060/);
  assert.match(icones[0].title, /CHECAGEM DE PREÇO/);
  assert.match(icones[1].title, /Painel de Ripas/);
  assert.doesNotMatch(icones[1].title, /PREÇO/);
});

// ---------------------------------------------------------------------------
// ETAPA 38 — trocar uma peça que já casou
// ---------------------------------------------------------------------------

test('trocar o nome da peça solta o código da peça antiga', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    campos: [{
      chave: 'itens', rotulo: 'Itens', tipo: 'lista', largura: 'media', naGrade: true,
      subcampos: [
        { chave: 'codigo', rotulo: 'Código', tipo: 'texto' },
        { chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true },
        { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero' }
      ]
    }],
    sugestoes: {
      'itens.nome': ['Painel Ripado 2,10', 'Mesa Lateral Carvalho'],
      __restritos: ['itens.nome']
    },
    itens: [{
      id: 1, linha: 1, acao: 'criar', alvo_id: 50, status: 'pendente', mensagem: null,
      dados: {
        itens: [{
          codigo: 'PR-210', nome: 'Painel de Ripas', quantidade: 3,
          _casamento: 'exato', _cadastro: 'Painel Ripado 2,10', _lido: 'Painel de Ripas', _preco: 900
        }]
      }
    }]
  });

  const b = criarBancada({ leitura });
  await b.pronta();
  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const nome = subLinhas(b)[0].todos()
    .find(f => f.tagName === 'INPUT' && f.dataset.chave === 'itens.nome');
  assert.strictEqual(nome.value, 'Painel Ripado 2,10', 'a grade mostra a peça casada');

  nome.value = 'Mesa Lateral Carvalho';
  nome.disparar('change');
  await b.pronta();

  const enviado = b.chamadas.find(c => c.metodo === 'PUT').corpo.dados.itens[0];

  // O backend casa por CÓDIGO antes de olhar o nome — é identidade, e com
  // razão. Com o código velho viajando junto, a peça antiga vencia a escolha
  // que a pessoa acabara de fazer: o nome voltava ao anterior e nada na tela
  // dizia por quê.
  assert.strictEqual(enviado.codigo, null, 'o código da peça antiga foi junto');
  assert.strictEqual(enviado.nome, 'Mesa Lateral Carvalho');
  assert.strictEqual(enviado._cadastro, null);
  assert.strictEqual(enviado._preco, null);

  // A quantidade é da PESSOA, não do catálogo. Zerá-la faria trocar de peça
  // custar uma digitação a mais.
  assert.strictEqual(enviado.quantidade, 3);

  // E o que o documento escreveu continua sendo o que o documento escreveu.
  assert.strictEqual(enviado._lido, 'Painel de Ripas');
});

test('trocar outro campo não mexe no código', async () => {
  const leitura = leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    campos: [{
      chave: 'itens', rotulo: 'Itens', tipo: 'lista', largura: 'media', naGrade: true,
      subcampos: [
        { chave: 'codigo', rotulo: 'Código', tipo: 'texto' },
        { chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true },
        { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero' }
      ]
    }],
    itens: [{
      id: 1, linha: 1, acao: 'criar', alvo_id: 50, status: 'pendente', mensagem: null,
      dados: {
        itens: [{ codigo: 'PR-210', nome: 'Painel Ripado 2,10', quantidade: 3, _cadastro: 'Painel Ripado 2,10' }]
      }
    }]
  });

  const b = criarBancada({ leitura });
  await b.pronta();
  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const qtde = subLinhas(b)[0].todos()
    .find(f => f.tagName === 'INPUT' && f.dataset.chave === 'itens.quantidade');
  qtde.value = '7';
  qtde.disparar('change');
  await b.pronta();

  // Corrigir a quantidade não é trocar de peça. Soltar o código aqui obrigaria
  // o backend a redescobrir por nome uma peça que já estava identificada.
  const enviado = b.chamadas.find(c => c.metodo === 'PUT').corpo.dados.itens[0];
  assert.strictEqual(enviado.codigo, 'PR-210');
  assert.strictEqual(enviado._cadastro, 'Painel Ripado 2,10');
});

test('numa ficha de insumos, trocar o nome não inventa um campo código', async () => {
  const leitura = leituraPadrao({
    destino: 'produto_insumos', destino_rotulo: 'Insumos de produtos',
    campos: [{
      chave: 'insumos', rotulo: 'Insumos', tipo: 'lista', largura: 'media', naGrade: true,
      subcampos: [
        { chave: 'nome', rotulo: 'Insumo', tipo: 'texto', obrigatorio: true },
        { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero' }
      ]
    }],
    sugestoes: { 'insumos.nome': ['MDF 15mm Branco TX', 'Cola PVA extra 1kg'], __restritos: ['insumos.nome'] },
    itens: [{
      id: 1, linha: 1, acao: 'criar', alvo_id: null, status: 'pendente', mensagem: null,
      dados: { insumos: [{ nome: 'Cola PVA extra 1kg', quantidade: 2, _cadastro: 'Cola PVA extra 1kg' }] }
    }]
  });

  const b = criarBancada({ leitura });
  await b.pronta();
  botaoDaLista(linhasDeItem(b)[0]).disparar('click');
  await b.pronta();

  const nome = subLinhas(b)[0].todos()
    .find(f => f.tagName === 'INPUT' && f.dataset.chave === 'insumos.nome');
  nome.value = 'MDF 15mm Branco TX';
  nome.disparar('change');
  await b.pronta();

  // Insumo não tem código. Escrever a chave assim mesmo criaria um campo do
  // nada, que a coerção do backend descartaria calada — ou pior, gravaria.
  const enviado = b.chamadas.find(c => c.metodo === 'PUT').corpo.dados.insumos[0];
  assert.strictEqual('codigo' in enviado, false);
  assert.strictEqual(enviado.nome, 'MDF 15mm Branco TX');
});

// ---------------------------------------------------------------------------
// ETAPA 39 PARTE 2 — o cliente preenche o bloco comercial
// ---------------------------------------------------------------------------

/** Uma leitura de pedido com o bloco comercial na grade. */
function pedidoComEmpresa(dadosExtra = {}, opcoes = {}) {
  return leituraPadrao({
    destino: 'orcamentos', destino_rotulo: 'Orçamentos',
    exige_alvo: true, rotulo_alvo: 'Cliente ou prospecção',
    alvos: [
      { id: 50, nome: 'Casa Vicenzo (Cliente)', tabela: 'clientes' },
      { id: 30, nome: 'Marcenaria Serrana (Prospecção)', tabela: 'prospeccoes' }
    ],
    campos: [
      { chave: 'cliente', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true, largura: 'grande', naGrade: true },
      { chave: 'razao_social', rotulo: 'Razão social', tipo: 'texto', largura: 'media', naGrade: true },
      { chave: 'contato', rotulo: 'Contato', tipo: 'texto', largura: 'media', naGrade: true },
      { chave: 'transportadora', rotulo: 'Transportadora', tipo: 'texto', largura: 'media', naGrade: true }
    ],
    sugestoes: {},
    itens: [{
      id: 1, linha: 1, acao: 'criar', alvo_id: 50, alvo_tabela: 'clientes',
      status: 'pendente', mensagem: null,
      opcoes: {
        cliente: ['Casa Vicenzo (Cliente)', 'Marcenaria Serrana (Prospecção)'],
        contato: ['Lílian', 'Rogério'],
        transportadora: ['Rodonaves'],
        ...opcoes
      },
      dados: {
        cliente: 'Casa Vicenzo',
        razao_social: 'Vicenzo Ltda',
        contato: null,
        transportadora: 'Rodonaves',
        _origem: { cliente: 'cadastro', razao_social: 'cadastro', transportadora: 'cadastro' },
        ...dadosExtra
      }
    }]
  });
}

const campoDe = (b, chave) => camposDa(linhasDeItem(b)[0]).find(f => f.dataset.chave === chave);

test('cliente, contato e transportadora são caixas de seleção', async () => {
  const b = criarBancada({ leitura: pedidoComEmpresa() });
  await b.pronta();

  // Os três apontam REGISTROS. Digitar um nome livre num deles cria um texto
  // que o formulário do orçamento ignora — ele quer o id.
  for (const chave of ['cliente', 'contato', 'transportadora']) {
    assert.ok(campoDe(b, chave).classList.contains('ia-campo--lista'),
      `${chave} não anuncia que é uma lista`);
    assert.ok(campoDe(b, chave).getAttribute('list'), `${chave} ficou sem lista ligada`);
  }
});

test('as opções são as do CLIENTE daquela linha', async () => {
  const b = criarBancada({ leitura: pedidoComEmpresa() });
  await b.pronta();

  // Duas linhas do mesmo pedido podem apontar clientes diferentes. Uma lista
  // por chave, comum à leitura, ofereceria a uma delas os contatos da outra.
  const lista = b.janela.document.getElementById(campoDe(b, 'contato').getAttribute('list'));
  assert.deepEqual(lista.filhos.map(o => o.value), ['Lílian', 'Rogério']);
});

test('o que veio do cadastro não se digita', async () => {
  const b = criarBancada({ leitura: pedidoComEmpresa() });
  await b.pronta();

  // Razão social é do registro: muda quando o cliente muda. Digitá-la à mão
  // criaria um orçamento que diz uma coisa e aponta para outra.
  assert.equal(campoDe(b, 'razao_social').readOnly, true);
  assert.ok(campoDe(b, 'razao_social').classList.contains('ia-campo--fixo'));

  // E travado de verdade: sem a saída antecipada, a escuta de `change` fica
  // pendurada e um valor posto por fora — restauração de trabalho, autofill do
  // navegador — gravaria por cima do que veio do cadastro.
  campoDe(b, 'razao_social').value = 'Outra Coisa Ltda';
  campoDe(b, 'razao_social').disparar('change');
  await b.pronta();
  assert.equal(b.chamadas.some(c => c.metodo === 'PUT'), false, 'gravou um campo travado');

  // O cliente, não: é justamente por ele que se troca o resto.
  assert.equal(campoDe(b, 'cliente').readOnly, false);
  // E a transportadora tem alternativas no banco — escolher outra é legítimo.
  assert.equal(campoDe(b, 'transportadora').readOnly, false);
});

test('trocar o cliente re-aponta a linha, não grava um texto', async () => {
  const b = criarBancada({ leitura: pedidoComEmpresa() });
  await b.pronta();

  const cliente = campoDe(b, 'cliente');
  cliente.value = 'Marcenaria Serrana (Prospecção)';
  cliente.disparar('change');
  await b.pronta();

  // O que o formulário precisa é o id e a tabela. Gravar o texto faria a linha
  // continuar apontando o cliente antigo, com a tela dizendo outra coisa.
  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.equal(put.corpo.alvo_id, 30);
  assert.equal(put.corpo.alvo_tabela, 'prospeccoes');
  assert.equal(put.corpo.dados, undefined, 'gravou o nome como texto');
});

test('empresa fora da lista é recusada', async () => {
  const b = criarBancada({ leitura: pedidoComEmpresa() });
  await b.pronta();

  const cliente = campoDe(b, 'cliente');
  cliente.value = 'Empresa Que Não Existe';
  cliente.disparar('change');
  await b.pronta();

  assert.equal(b.chamadas.some(c => c.metodo === 'PUT'), false);
  assert.match(b.toasts.at(-1).msg, /não está cadastrado|da lista/);
});

test('contato fora da lista do cliente é recusado', async () => {
  const b = criarBancada({ leitura: pedidoComEmpresa() });
  await b.pronta();

  const contato = campoDe(b, 'contato');
  contato.value = 'Fulano de Tal';
  contato.disparar('change');
  await b.pronta();

  // O orçamento quer o ID do contato. Um nome que não está no cadastro daquele
  // cliente vira texto que ele ignora em silêncio.
  assert.equal(b.chamadas.some(c => c.metodo === 'PUT'), false);
  assert.match(b.toasts.at(-1).msg, /não está cadastrado/);
});

test('contato da lista grava normalmente', async () => {
  const b = criarBancada({ leitura: pedidoComEmpresa() });
  await b.pronta();

  const contato = campoDe(b, 'contato');
  contato.value = 'Rogério';
  contato.disparar('change');
  await b.pronta();

  const put = b.chamadas.find(c => c.metodo === 'PUT');
  assert.deepEqual(put.corpo, { dados: { contato: 'Rogério' } });
});

test('sem cliente apontado, os campos voltam a ser texto livre', async () => {
  const leitura = pedidoComEmpresa();
  leitura.itens[0] = {
    ...leitura.itens[0], alvo_id: null, alvo_tabela: null,
    // Sem empresa apontada, o backend ainda manda a lista DELAS: é justamente
    // a linha travada que precisa escolher uma.
    opcoes: { cliente: ['Casa Vicenzo (Cliente)', 'Marcenaria Serrana (Prospecção)'] },
    dados: { cliente: 'Empresa Que Não Existe', razao_social: null, contato: 'Fulano', transportadora: null }
  };

  const b = criarBancada({ leitura });
  await b.pronta();

  // Sem cadastro de onde puxar, travar os campos deixaria a pessoa com uma
  // linha vazia e sem como preenchê-la.
  assert.equal(campoDe(b, 'razao_social').readOnly, false);
  assert.equal(campoDe(b, 'contato').readOnly, false);
  assert.equal(campoDe(b, 'contato').classList.contains('ia-campo--lista'), false);

  // O cliente segue restrito: é ele que amarra a linha a um registro.
  assert.ok(campoDe(b, 'cliente').classList.contains('ia-campo--lista'));
});

// ---------------------------------------------------------------------------
// O véu enquanto o cadastro do cliente chega
// ---------------------------------------------------------------------------

/** O véu com a logo está na tela agora? */
const veuAberto = b => b.corpoDaPagina.filhos.some(f => f.id === 'iaAbrindoModulo');

test('trocar o cliente pela tabela mostra o carregamento', async () => {
  let durante = null;
  const b = criarBancada({
    leitura: pedidoComEmpresa(),
    // O véu tem de estar de pé ENQUANTO o servidor responde, não depois.
    respostaPut: { aoGravar: bancada => { durante = veuAberto(bancada); } }
  });
  await b.pronta();

  const cliente = campoDe(b, 'cliente');
  cliente.value = 'Marcenaria Serrana (Prospecção)';
  cliente.disparar('change');
  await b.pronta();

  // Trocar o cliente refaz razão social, CNPJ, contato e transportadora. Sem o
  // véu, o que se vê é a grade piscando e campos mudando sozinhos, um a um —
  // que parece defeito, não carregamento.
  assert.strictEqual(durante, true, 'o véu não apareceu durante a gravação');
  assert.strictEqual(veuAberto(b), false, 'o véu ficou na tela depois de carregar');
});

test('apontar pela tela "O que fazer" também mostra', async () => {
  const leitura = pedidoComEmpresa();
  leitura.itens[0] = { ...leitura.itens[0], alvo_id: null, alvo_tabela: null };

  let durante = null;
  const b = criarBancada({
    leitura,
    respostaPut: { aoGravar: bancada => { durante = veuAberto(bancada); } }
  });
  await b.pronta();

  linhasDeItem(b)[0].todos()
    .find(f => f.classList?.contains('ia-btn-decidir'))?.disparar('click');
  await b.pronta();

  await b.janela.iaAcaoPedido.aoDecidir({
    tipo: 'apontar', alvo: { id: 50, nome: 'Casa Vicenzo', tabela: 'clientes' }
  });
  await b.pronta();

  assert.strictEqual(durante, true, 'o véu não apareceu durante a gravação');
  assert.strictEqual(veuAberto(b), false);
});

test('descartar não põe véu: mexe numa coluna só', async () => {
  const leitura = pedidoComEmpresa();
  leitura.itens[0] = { ...leitura.itens[0], alvo_id: null, alvo_tabela: null };

  let durante = null;
  const b = criarBancada({
    leitura,
    respostaPut: { aoGravar: bancada => { durante = veuAberto(bancada); } }
  });
  await b.pronta();

  linhasDeItem(b)[0].todos()
    .find(f => f.classList?.contains('ia-btn-decidir'))?.disparar('click');
  await b.pronta();
  await b.janela.iaAcaoPedido.aoDecidir({ tipo: 'descartar' });
  await b.pronta();

  // Um véu de tela cheia para trocar uma coluna é mais interrupção do que
  // informação.
  assert.strictEqual(durante, false);
});

test('o véu sai mesmo quando a gravação falha', async () => {
  const b = criarBancada({
    leitura: pedidoComEmpresa(),
    respostaPut: { status: 500, corpo: { error: 'servidor fora do ar' } }
  });
  await b.pronta();

  const cliente = campoDe(b, 'cliente');
  cliente.value = 'Marcenaria Serrana (Prospecção)';
  cliente.disparar('change');
  await b.pronta();

  // O véu cobre a tela inteira: esquecê-lo aberto depois de um erro deixaria o
  // modal inutilizável, e o remédio seria pior que a doença.
  assert.strictEqual(veuAberto(b), false, 'o véu ficou preso na tela após o erro');
  assert.match(b.toasts.at(-1).msg, /servidor fora do ar/);
});
