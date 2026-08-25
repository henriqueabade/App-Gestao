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

function criarBancada({ leitura, respostaPut, respostaAplicar, respostaExtrair, confirmar = true } = {}) {
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
    dispatchEvent() {},
    addEventListener() {},
    showToast: (msg, tipo) => toasts.push({ msg, tipo }),
    Modal: { close() {} },
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
    trocarLeitura: nova => { dadosLeitura = nova; },
    pronta: () => new Promise(r => setTimeout(r, 10))
  };
}

/** Linhas de item (as de nota não têm campos). */
const linhasDeItem = b => b.el('iaDetItensCorpo').filhos.filter(l => l.classList.contains('ia-linha-item'));
const notas = b => b.el('iaDetItensCorpo').filhos.filter(l => !l.classList.contains('ia-linha-item'));
const camposDa = linha => linha.todos().filter(f => f.classList.contains('ia-campo'));
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
  const botao = b.el('iaDetAplicar');
  assert.equal(botao.disabled, true);
  assert.match(botao.title, /obrigatório/i);
  assert.match(b.el('iaDetResumoRevisao').texto(), /1 sem campo obrigatório/);
});

test('sem nada a gravar o botão também trava', async () => {
  const leitura = leituraPadrao();
  leitura.itens.forEach(i => { i.acao = 'ignorar'; });
  const b = criarBancada({ leitura });
  await b.pronta();

  assert.equal(b.el('iaDetAplicar').disabled, true);
  assert.match(b.el('iaDetAplicar').title, /descartados|já aplicados/i);
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

  b.el('iaDetAplicar').disparar('click');
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

  b.el('iaDetAplicar').disparar('click');
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

  b.el('iaDetAplicar').disparar('click');
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
// Contrato
// ---------------------------------------------------------------------------

test('o modal continua nascendo hidden e se revelando pelo spinner', () => {
  const html = fs.readFileSync(HTML_MODAL, 'utf8');
  assert.match(html, /id="iaDetalhesOverlay" class="hidden /);

  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  const bloco = /\} finally \{[\s\S]*?revelar\(\);[\s\S]*?\}/.exec(fonte);
  assert.ok(bloco, 'a revelação precisa estar num finally');
});

test('extrair e aplicar passam pela trava de duplo clique', () => {
  // Extrair consome crédito e aplicar mexe em estoque: dois cliques rápidos
  // gastariam duas vezes ou somariam o saldo em dobro.
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  assert.match(fonte, /BotaoAcao\?\.bind/);
  const bloco = /for \(const \[id, acao\] of \[\['iaDetExtrair'[\s\S]*?\n  \}/.exec(fonte);
  assert.ok(bloco, 'os dois botões precisam passar pelo mesmo laço de proteção');
  assert.match(bloco[0], /iaDetAplicar/);
});
