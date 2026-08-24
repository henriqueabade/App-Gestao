/**
 * Modal "Nova leitura" (src/js/modals/ia-nova.js).
 *
 * O script é uma IIFE que monta a tela e liga os eventos assim que carrega, e
 * boa parte do que interessa não é exportado. Em vez de conferir o texto do
 * arquivo por expressão regular — que provaria só que uma linha existe —, aqui
 * ele roda de verdade contra um DOM mínimo, e os testes disparam eventos como
 * o usuário faria.
 *
 * O foco é a conferência ANTES do envio. Ela não é a barreira de segurança (o
 * backend confere de novo, e é lá que a decisão vale): é o que evita o usuário
 * subir 40 MB por uma rede de escritório para receber "tipo não aceito" no fim.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARQUIVO = path.join(__dirname, '..', 'modals', 'ia-nova.js');
const HTML_MODAL = path.join(__dirname, '..', '..', 'html', 'modals', 'ia', 'nova.html');

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
    className: '',
    textContent: '',
    innerHTML: '',
    value: '',
    title: '',
    disabled: false,
    files: [],
    atributos: {},
    classList: {
      add(c) { el.className = `${el.className} ${c}`.trim(); },
      remove(c) { el.className = el.className.split(' ').filter(x => x && x !== c).join(' '); },
      toggle(c, ligado) { if (ligado) el.classList.add(c); else el.classList.remove(c); },
      contains: c => el.className.split(' ').includes(c)
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
    },
    appendChild(filho) { el.filhos.push(filho); return filho; },
    append(...fs) { el.filhos.push(...fs); },
    replaceChildren(...fs) { el.filhos = fs; },
    click() { el.disparar('click'); },
    /** Todos os descendentes, para as buscas do teste. */
    todos() {
      const saida = [];
      const andar = no => {
        for (const f of no.filhos || []) { saida.push(f); andar(f); }
      };
      andar(el);
      return saida;
    },
    /** Texto visível, juntando os descendentes. */
    texto() {
      return [el.textContent, ...el.todos().map(f => f.textContent)].filter(Boolean).join(' ');
    }
  };
  return el;
}

/** Ids que o modal procura, lidos do próprio HTML para não divergirem dele. */
function idsDoModal() {
  const html = fs.readFileSync(HTML_MODAL, 'utf8');
  return [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
}

function criarBancada({ opcoes, respostaEnvio } = {}) {
  const elementos = new Map();
  for (const id of idsDoModal()) elementos.set(id, criarElemento());

  const enviosXhr = [];
  const toasts = [];
  const modaisFechados = [];
  const gradesRecarregadas = [];
  const detalhesAbertos = [];

  const document = {
    addEventListener() {},
    removeEventListener() {},
    getElementById: id => elementos.get(id) || null,
    createElement: tag => criarElemento(tag),
    // O modal usa `[data-destino]` para marcar o cartão escolhido.
    querySelectorAll(seletor) {
      if (seletor !== '[data-destino]') return [];
      const caixa = elementos.get('iaNovaDestinos');
      return (caixa?.filhos || []).filter(f => f.dataset.destino);
    }
  };

  class XHRFalso {
    constructor() {
      this.upload = { ouvintes: {}, addEventListener(e, fn) { (this.ouvintes[e] ||= []).push(fn); } };
      this.ouvintes = {};
      this.status = 0;
      this.responseText = '';
    }
    open(metodo, url) { this.metodo = metodo; this.url = url; }
    addEventListener(evento, fn) { (this.ouvintes[evento] ||= []).push(fn); }
    send(corpo) {
      enviosXhr.push({ metodo: this.metodo, url: this.url, corpo, xhr: this });
      const r = respostaEnvio || { status: 201, corpo: { id: 9, status: 'rascunho', titulo: 'x', arquivos_lidos: 1, arquivos_com_falha: 0 } };
      // Progresso de upload primeiro, como o navegador faz.
      for (const fn of this.upload.ouvintes.progress || []) {
        fn({ lengthComputable: true, loaded: 50, total: 100 });
        fn({ lengthComputable: true, loaded: 100, total: 100 });
      }
      this.status = r.status;
      this.responseText = JSON.stringify(r.corpo);
      queueMicrotask(() => { for (const fn of this.ouvintes.load || []) fn(); });
    }
  }

  class FormDataFalso {
    constructor() { this.campos = []; }
    append(nome, valor, nomeArquivo) { this.campos.push({ nome, valor, nomeArquivo }); }
    valor(nome) { return this.campos.find(c => c.nome === nome)?.valor; }
    todos(nome) { return this.campos.filter(c => c.nome === nome); }
  }

  const OPCOES_PADRAO = {
    destinos: [
      { id: 'materia_prima', rotulo: 'Matéria-prima (estoque)', descricao: 'Insumos', icone: 'fa-boxes-stacked', pode_aplicar: true },
      { id: 'clientes', rotulo: 'Clientes e contatos', descricao: 'Cadastro', icone: 'fa-user-tie', pode_aplicar: true },
      { id: 'orcamentos', rotulo: 'Orçamentos', descricao: 'Itens', icone: 'fa-file-invoice-dollar', pode_aplicar: false }
    ],
    extensoes: ['.xlsx', '.csv', '.pdf', '.png'],
    limites: { arquivo_mb: 10, arquivos: 3, timeout_s: 120, texto_max_chars: 120000 },
    provedores: { gemini: true, groq: true, pronto: true }
  };

  const sandbox = {
    document,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Promise,
    Math,
    Number,
    String,
    Boolean,
    JSON,
    Array,
    Object,
    Error,
    XMLHttpRequest: XHRFalso,
    FormData: FormDataFalso,
    CustomEvent: class { constructor(tipo, init) { this.type = tipo; this.detail = init?.detail; } },
    Event: class { constructor(tipo) { this.type = tipo; } },
    dispatchEvent() {},
    addEventListener() {},
    showToast: (msg, tipo) => toasts.push({ msg, tipo }),
    Modal: { close: id => modaisFechados.push(id) },
    apiConfig: { getApiBaseUrl: async () => 'http://local' },
    IaModulo: {
      carregar: async () => { gradesRecarregadas.push(true); },
      abrirDetalhes: l => detalhesAbertos.push(l)
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => (opcoes === undefined ? OPCOES_PADRAO : opcoes)
    })
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ARQUIVO, 'utf8'), sandbox, { filename: 'ia-nova.js' });

  return {
    sandbox,
    el: id => elementos.get(id),
    enviosXhr,
    toasts,
    modaisFechados,
    gradesRecarregadas,
    detalhesAbertos,
    /** Espera a IIFE terminar de buscar as opções e pintar a tela. */
    pronta: () => new Promise(r => setTimeout(r, 5)),
    arquivo: (nome, bytes = 1024) => ({ name: nome, size: bytes })
  };
}

/** Simula o usuário escolhendo arquivos pelo seletor. */
function escolher(b, arquivos) {
  const input = b.el('iaNovaInput');
  input.files = arquivos;
  input.disparar('change');
}

const linhasDeArquivo = b => b.el('iaNovaLista').filhos;

// ---------------------------------------------------------------------------
// Destinos
// ---------------------------------------------------------------------------

test('o destino sem permissão aparece na lista, mas desabilitado e com o motivo', async () => {
  const b = criarBancada();
  await b.pronta();

  const cartoes = b.el('iaNovaDestinos').filhos;
  assert.equal(cartoes.length, 3, 'destino travado não pode sumir da lista');

  const orcamentos = cartoes.find(c => c.dataset.destino === 'orcamentos');
  assert.equal(orcamentos.disabled, true);
  assert.match(orcamentos.title, /permissão/i);
  // Some a ação, não a informação de que ela existe.
  assert.match(orcamentos.texto(), /Orçamentos/);
});

test('com um único destino liberado, ele já vem escolhido', async () => {
  const b = criarBancada({
    opcoes: {
      destinos: [
        { id: 'materia_prima', rotulo: 'Matéria-prima', descricao: '', icone: '', pode_aplicar: true },
        { id: 'clientes', rotulo: 'Clientes', descricao: '', icone: '', pode_aplicar: false }
      ],
      extensoes: ['.csv'],
      limites: { arquivo_mb: 10, arquivos: 3 },
      provedores: { gemini: true, groq: true, pronto: true }
    }
  });
  await b.pronta();

  const escolhido = b.el('iaNovaDestinos').filhos.find(c => c.getAttribute('aria-pressed') === 'true');
  assert.equal(escolhido?.dataset.destino, 'materia_prima');
});

test('com mais de um destino liberado, nenhum vem escolhido', async () => {
  const b = criarBancada();
  await b.pronta();
  const marcados = b.el('iaNovaDestinos').filhos.filter(c => c.getAttribute('aria-pressed') === 'true');
  assert.equal(marcados.length, 0);
});

// ---------------------------------------------------------------------------
// Conferência dos arquivos
// ---------------------------------------------------------------------------

test('tipo não aceito é marcado e fica de fora do envio', async () => {
  const b = criarBancada();
  await b.pronta();
  escolher(b, [b.arquivo('lista.csv'), b.arquivo('virus.exe')]);

  const linhas = linhasDeArquivo(b);
  assert.equal(linhas.length, 2, 'o recusado precisa aparecer, para o usuário saber por quê');
  const recusada = linhas.find(l => l.className.includes('ia-arquivo--recusado'));
  assert.ok(recusada, 'o arquivo recusado não foi destacado');
  assert.match(recusada.texto(), /tipo não aceito/i);
});

test('.xls antigo diz o que fazer, em vez de "tipo não aceito"', async () => {
  const b = criarBancada();
  await b.pronta();
  escolher(b, [b.arquivo('antiga.xls')]);

  assert.match(linhasDeArquivo(b)[0].texto(), /salve como \.xlsx/i);
});

test('arquivo acima do limite é recusado com o limite na mensagem', async () => {
  const b = criarBancada();
  await b.pronta();
  escolher(b, [b.arquivo('grande.pdf', 11 * 1024 * 1024)]);

  const linha = linhasDeArquivo(b)[0];
  assert.ok(linha.className.includes('ia-arquivo--recusado'));
  assert.match(linha.texto(), /10 MB/);
});

test('arquivo vazio é recusado', async () => {
  const b = criarBancada();
  await b.pronta();
  escolher(b, [b.arquivo('nada.csv', 0)]);
  assert.match(linhasDeArquivo(b)[0].texto(), /vazio/i);
});

test('o mesmo arquivo escolhido duas vezes entra uma vez só', async () => {
  // Abrir a pasta de novo e reescolher é fácil; mandar o arquivo em dobro
  // custa crédito em dobro.
  const b = criarBancada();
  await b.pronta();
  escolher(b, [b.arquivo('lista.csv', 500)]);
  escolher(b, [b.arquivo('lista.csv', 500)]);

  assert.equal(linhasDeArquivo(b).length, 1);
});

test('mesmo nome com tamanho diferente são dois arquivos', async () => {
  const b = criarBancada();
  await b.pronta();
  escolher(b, [b.arquivo('lista.csv', 500)]);
  escolher(b, [b.arquivo('lista.csv', 900)]);

  assert.equal(linhasDeArquivo(b).length, 2);
});

test('acima do limite de quantidade, o excedente é ignorado com aviso', async () => {
  const b = criarBancada(); // limite de 3
  await b.pronta();
  escolher(b, [1, 2, 3, 4, 5].map(n => b.arquivo(`a${n}.csv`, 100 * n)));

  assert.equal(linhasDeArquivo(b).length, 3);
  const aviso = b.el('iaNovaErroArquivos');
  assert.equal(aviso.classList.contains('hidden'), false);
  assert.match(aviso.textContent, /3 arquivos/);
});

test('o nome do arquivo entra por textContent, nunca por innerHTML', async () => {
  // O nome vem de FORA do sistema — é o pior candidato a virar marcação.
  const b = criarBancada();
  await b.pronta();
  escolher(b, [b.arquivo('<img src=x onerror=alert(1)>.csv')]);

  const linha = linhasDeArquivo(b)[0];
  const nome = linha.filhos.find(f => f.className.includes('ia-arquivo__nome'));
  assert.equal(nome.textContent, '<img src=x onerror=alert(1)>.csv');
  assert.equal(nome.innerHTML, '', 'o nome do arquivo foi parar em innerHTML');
});

test('remover um arquivo tira ele da lista', async () => {
  const b = criarBancada();
  await b.pronta();
  escolher(b, [b.arquivo('a.csv', 100), b.arquivo('b.csv', 200)]);

  const remover = linhasDeArquivo(b)[0].filhos.find(f => f.className.includes('ia-arquivo__remover'));
  remover.disparar('click');

  assert.equal(linhasDeArquivo(b).length, 1);
  assert.match(linhasDeArquivo(b)[0].texto(), /b\.csv/);
});

// ---------------------------------------------------------------------------
// Botão de enviar
// ---------------------------------------------------------------------------

test('sem destino escolhido o botão fica desabilitado, dizendo o que falta', async () => {
  const b = criarBancada();
  await b.pronta();
  escolher(b, [b.arquivo('lista.csv')]);

  const botao = b.el('iaNovaEnviar');
  assert.equal(botao.disabled, true);
  assert.match(botao.title, /destino|onde os dados vão/i);
});

test('sem arquivo válido o botão fica desabilitado', async () => {
  const b = criarBancada();
  await b.pronta();
  b.el('iaNovaDestinos').filhos[0].disparar('click');
  escolher(b, [b.arquivo('virus.exe')]);

  assert.equal(b.el('iaNovaEnviar').disabled, true);
});

test('com destino e arquivo válido o botão libera', async () => {
  const b = criarBancada();
  await b.pronta();
  b.el('iaNovaDestinos').filhos[0].disparar('click');
  escolher(b, [b.arquivo('lista.csv')]);

  assert.equal(b.el('iaNovaEnviar').disabled, false);
});

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

async function enviarCom(b, { destino = 0, arquivos = [{ nome: 'lista.csv', bytes: 500 }], titulo } = {}) {
  b.el('iaNovaDestinos').filhos[destino].disparar('click');
  escolher(b, arquivos.map(a => b.arquivo(a.nome, a.bytes)));
  if (titulo !== undefined) b.el('iaNovaTitulo').value = titulo;
  b.el('iaNovaEnviar').disparar('click');
  await new Promise(r => setTimeout(r, 10));
}

test('o envio manda destino e arquivos, e só os válidos', async () => {
  const b = criarBancada();
  await b.pronta();
  await enviarCom(b, {
    arquivos: [{ nome: 'boa.csv', bytes: 100 }, { nome: 'ruim.exe', bytes: 100 }]
  });

  assert.equal(b.enviosXhr.length, 1);
  const form = b.enviosXhr[0].corpo;
  assert.equal(form.valor('destino'), 'materia_prima');

  const enviados = form.todos('arquivos');
  assert.equal(enviados.length, 1, 'o arquivo recusado foi enviado assim mesmo');
  assert.equal(enviados[0].nomeArquivo, 'boa.csv');
});

test('o envio vai por XHR, para haver progresso de upload', async () => {
  // `fetch` não reporta progresso de UPLOAD. Com dez arquivos de vários MB, a
  // tela ficaria parada em "Enviando…" por minutos sem sinal de vida.
  const b = criarBancada();
  await b.pronta();
  await enviarCom(b);

  assert.equal(b.enviosXhr[0].metodo, 'POST');
  assert.match(b.enviosXhr[0].url, /\/api\/ia$/);
  // A barra saiu do zero durante o upload.
  assert.notEqual(b.el('iaNovaBarra').style.width, '');
});

test('quando o upload chega a 100%, o texto muda para "lendo"', async () => {
  // Barra cheia e parada em "Enviando…" faz parecer travado — a leitura é a
  // parte demorada e começa justo aí.
  const b = criarBancada();
  await b.pronta();
  await enviarCom(b);

  assert.match(b.el('iaNovaProgressoTexto').textContent, /lendo/i);
});

test('o título digitado vai junto; sem ele, o campo não é enviado', async () => {
  const b = criarBancada();
  await b.pronta();
  await enviarCom(b, { titulo: '  Lista do Bralux  ' });
  assert.equal(b.enviosXhr[0].corpo.valor('titulo'), 'Lista do Bralux');

  const b2 = criarBancada();
  await b2.pronta();
  await enviarCom(b2, { titulo: '   ' });
  assert.equal(b2.enviosXhr[0].corpo.valor('titulo'), undefined);
});

test('no sucesso, a grade recarrega ANTES do aviso e o detalhe abre', async () => {
  const b = criarBancada();
  await b.pronta();
  await enviarCom(b);

  assert.equal(b.gradesRecarregadas.length, 1, 'a grade não foi atualizada');
  assert.equal(b.modaisFechados[0], 'iaNova');
  assert.equal(b.toasts.at(-1).tipo, 'success');
  assert.equal(b.detalhesAbertos[0]?.id, 9);
});

test('leitura parcial avisa quantos arquivos entraram', async () => {
  const b = criarBancada({
    respostaEnvio: {
      status: 201,
      corpo: { id: 12, status: 'rascunho', titulo: 'x', arquivos_lidos: 2, arquivos_com_falha: 1 }
    }
  });
  await b.pronta();
  await enviarCom(b);

  assert.match(b.toasts.at(-1).msg, /2 de 3/);
});

test('falha no envio devolve o botão e mostra a mensagem do backend', async () => {
  const b = criarBancada({
    respostaEnvio: { status: 400, corpo: { error: 'Arquivo grande demais. O limite é 10 MB por arquivo.' } }
  });
  await b.pronta();
  await enviarCom(b);

  assert.equal(b.toasts.at(-1).tipo, 'error');
  assert.match(b.toasts.at(-1).msg, /limite é 10 MB/);
  // O modal continua aberto para o usuário corrigir, e o botão volta.
  assert.equal(b.modaisFechados.length, 0);
  assert.equal(b.el('iaNovaEnviar').disabled, false);
  assert.equal(b.el('iaNovaProgresso').classList.contains('hidden'), true);
});

// ---------------------------------------------------------------------------
// Provedores
// ---------------------------------------------------------------------------

test('sem a chave do Gemini, o aviso diz que só planilha vai funcionar', async () => {
  const b = criarBancada({
    opcoes: {
      destinos: [{ id: 'materia_prima', rotulo: 'MP', descricao: '', icone: '', pode_aplicar: true }],
      extensoes: ['.csv', '.pdf'],
      limites: { arquivo_mb: 10, arquivos: 3 },
      provedores: { gemini: false, groq: true, pronto: false }
    }
  });
  await b.pronta();

  const aviso = b.el('iaNovaAvisoProvedor');
  assert.equal(aviso.classList.contains('hidden'), false);
  assert.match(aviso.textContent, /GEMINI_API_KEY/);
  assert.match(aviso.textContent, /planilha/i);
});

test('os limites e as extensões vêm do backend, não de uma cópia no front', async () => {
  const b = criarBancada();
  await b.pronta();

  assert.match(b.el('iaNovaLimites').textContent, /3 arquivos/);
  assert.match(b.el('iaNovaLimites').textContent, /10 MB/);
  assert.match(b.el('iaNovaExtensoes').textContent, /\.xlsx/);
  assert.equal(b.el('iaNovaInput').accept, '.xlsx,.csv,.pdf,.png');

  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  assert.equal(
    /const\s+EXTENSOES_ACEITAS\s*=/.test(fonte), false,
    'o front não pode ter a própria lista de extensões — ela vem de GET /api/ia/opcoes'
  );
});

// ---------------------------------------------------------------------------
// Contrato do modal
// ---------------------------------------------------------------------------

test('o overlay nasce hidden, para o spinner revelá-lo', () => {
  const html = fs.readFileSync(HTML_MODAL, 'utf8');
  assert.match(html, /id="iaNovaOverlay" class="hidden /);
});

test('o modal revela a si mesmo mesmo quando as opções falham', async () => {
  // Um erro aqui não pode deixar o spinner girando para sempre com a tela em
  // branco por trás — foi assim que o "visualizar orçamento" ficou sem abrir.
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  const bloco = /\} finally \{[\s\S]*?revelar\(\);[\s\S]*?\}/.exec(fonte);
  assert.ok(bloco, 'a revelação precisa estar num finally');
});
