/**
 * Lógica da tela de IA (src/js/ia.js).
 *
 * O arquivo é um script de navegador: define funções no escopo global e, no
 * fim, decide se chama `initIA()` olhando `document.readyState`. Carregamos com
 * readyState 'loading' justamente para que ele registre o listener e NÃO
 * dispare a inicialização (que faria fetch) — sobra o que interessa testar:
 * escape, filtro combinado e o que a grade desenha.
 *
 * O foco é onde o estrago seria silencioso:
 *   • nome de ARQUIVO vindo de fora do sistema entrando por innerHTML;
 *   • a lixeira aberta numa leitura que já foi aplicada;
 *   • o filtro combinando destino, situação e busca ao mesmo tempo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARQUIVO = path.join(__dirname, '..', 'ia.js');

/** Campo de formulário mínimo, com o que o módulo lê/escreve. */
function campo(valor = '') {
  return {
    value: valor,
    innerHTML: '',
    textContent: '',
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0 })
  };
}

function criarSandbox(campos = {}) {
  const elementos = new Map(Object.entries(campos));

  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById: id => elementos.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => campo()
  };

  const sandbox = {
    document,
    console,
    Intl,
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    Event: class {},
    CustomEvent: class {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    showToast() {},
    fetch: async () => { throw new Error('fetch não deveria ser chamado neste teste'); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ARQUIVO, 'utf8'), sandbox, { filename: 'ia.js' });
  return sandbox;
}

/**
 * `let` no topo de um script vai para o ambiente LEXICAL do contexto, não vira
 * propriedade do objeto global — então `sandbox.todasLeituras = x` criaria uma
 * variável paralela que o módulo nunca lê. A atribuição precisa ser executada
 * dentro do próprio contexto.
 */
function definir(sandbox, nome, valor) {
  sandbox.__valorTemporario = valor;
  vm.runInContext(`${nome} = __valorTemporario;`, sandbox);
  delete sandbox.__valorTemporario;
}

// ---------------------------------------------------------------------------
// Escape
// ---------------------------------------------------------------------------

test('esc neutraliza HTML vindo do título da leitura', () => {
  const s = criarSandbox();
  const perigoso = '<img src=x onerror="alert(1)">';
  const seguro = s.esc(perigoso);

  assert.equal(seguro.includes('<img'), false);
  assert.equal(seguro.includes('onerror="'), false);
  assert.equal(seguro, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('esc trata nulo e indefinido como vazio', () => {
  const s = criarSandbox();
  assert.equal(s.esc(null), '');
  assert.equal(s.esc(undefined), '');
  assert.equal(s.esc(0), '0');
});

// ---------------------------------------------------------------------------
// Normalização da busca
// ---------------------------------------------------------------------------

test('normalizar tira acento e caixa, para "orçamento" casar com "orcamento"', () => {
  const s = criarSandbox();
  assert.equal(s.normalizar('Orçamentos'), 'orcamentos');
  assert.equal(s.normalizar('  Matéria-PRIMA  '), 'materia-prima');
  assert.equal(s.normalizar('Prospecções'), 'prospeccoes');
  assert.equal(s.normalizar(null), '');
});

test('formatarDataHora devolve travessão para vazio e lixo', () => {
  const s = criarSandbox();
  assert.equal(s.formatarDataHora(null), '—');
  assert.equal(s.formatarDataHora(''), '—');
  assert.equal(s.formatarDataHora('nao-e-data'), '—');
});

// ---------------------------------------------------------------------------
// Filtro
// ---------------------------------------------------------------------------

const LEITURAS = [
  {
    id: 1, titulo: 'Planilha de chapas', destino: 'materia_prima',
    destino_rotulo: 'Matéria-prima (estoque)', status: 'revisao',
    usuario_nome: 'Ana', modelo_ocr: 'gemini-2.5-flash', modelo_llm: 'llama-3.3-70b-versatile',
    arquivos_qtd: 1, itens_qtd: 4, aplicados_qtd: 0
  },
  {
    id: 2, titulo: 'Cartões da feira', destino: 'prospeccoes',
    destino_rotulo: 'Prospecções e contatos', status: 'aplicada',
    usuario_nome: 'Henrique', arquivos_qtd: 2, itens_qtd: 2, aplicados_qtd: 2
  },
  {
    id: 3, titulo: 'Pedido escaneado', destino: 'orcamentos',
    destino_rotulo: 'Orçamentos', status: 'erro',
    usuario_nome: 'Henrique', arquivos_qtd: 1, itens_qtd: 0, aplicados_qtd: 0
  }
];

function montarFiltro({ busca = '', destino = '', status = '' } = {}) {
  const desenhadas = [];
  const s = criarSandbox({
    filtroBuscaIA: campo(busca),
    filtroDestinoIA: campo(destino),
    filtroStatusIA: campo(status),
    iaResumoTags: campo(),
    iaResumoPopover: campo()
  });
  definir(s, 'todasLeituras', LEITURAS);
  // Substitui o desenho: o que interessa é O QUE sobrou do filtro.
  s.__capturar = lista => desenhadas.push(...lista.map(l => l.id));
  vm.runInContext('renderTabela = __capturar;', s);
  vm.runInContext('aplicarFiltros();', s);
  return desenhadas;
}

test('sem filtro, tudo aparece', () => {
  assert.deepEqual(montarFiltro(), [1, 2, 3]);
});

test('o filtro de destino corta pelo destino', () => {
  assert.deepEqual(montarFiltro({ destino: 'materia_prima' }), [1]);
  assert.deepEqual(montarFiltro({ destino: 'orcamentos' }), [3]);
});

test('o filtro de situação corta pela situação', () => {
  assert.deepEqual(montarFiltro({ status: 'aplicada' }), [2]);
  assert.deepEqual(montarFiltro({ status: 'rascunho' }), []);
});

test('a busca acha por título, responsável e modelo', () => {
  assert.deepEqual(montarFiltro({ busca: 'chapas' }), [1]);
  assert.deepEqual(montarFiltro({ busca: 'henrique' }), [2, 3]);
  assert.deepEqual(montarFiltro({ busca: 'llama' }), [1]);
});

test('a busca ignora acento nos dois lados', () => {
  // "Orçamentos" é o rótulo do destino; quem digita raramente acentua.
  assert.deepEqual(montarFiltro({ busca: 'orcamentos' }), [3]);
  assert.deepEqual(montarFiltro({ busca: 'cartoes' }), [2]);
});

test('os critérios se somam, não se substituem', () => {
  // Cada um sozinho traz a leitura 2; juntos com uma situação que ela não tem,
  // o resultado precisa ser vazio.
  assert.deepEqual(montarFiltro({ busca: 'henrique', status: 'aplicada' }), [2]);
  assert.deepEqual(montarFiltro({ busca: 'henrique', status: 'revisao' }), []);
  assert.deepEqual(montarFiltro({ destino: 'prospeccoes', status: 'erro' }), []);
});

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

function renderizarLinha(leitura) {
  let html = '';
  const linha = {
    className: '', dataset: {},
    set innerHTML(v) { html = v; },
    get innerHTML() { return html; },
    querySelector: () => null,
    // O módulo varre a linha atrás dos ícones travados (`[data-inerte]`).
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const tbody = { innerHTML: '', appendChild() {}, classList: { add() {}, remove() {} } };

  const s = criarSandbox({ iaTableBody: tbody });
  s.document.createElement = () => linha;
  definir(s, 'todasLeituras', []);
  definir(s, 'situacoesDisponiveis', [
    { id: 'revisao', rotulo: 'Em revisão' },
    { id: 'aplicada', rotulo: 'Aplicada' },
    { id: 'erro', rotulo: 'Erro' }
  ]);
  definir(s, 'destinosDisponiveis', [
    { id: 'materia_prima', icone: 'fa-boxes-stacked' }
  ]);

  s.__lista = [leitura];
  vm.runInContext('renderTabela(__lista);', s);
  return html;
}

/** Nomes das ações que saíram travadas (`data-inerte`). */
function acoesTravadas(html) {
  return [...html.matchAll(/acao-tabela--(\w+)[^>]*data-inerte/g)].map(m => m[1]);
}

test('a lixeira fica travada numa leitura já aplicada', () => {
  const html = renderizarLinha({ ...LEITURAS[1] });
  assert.ok(acoesTravadas(html).includes('excluir'));
  assert.match(html, /title="Leitura já aplicada[^"]*"/);
  // E o texto explica que os registros criados continuam lá — a dúvida óbvia
  // de quem tentou excluir.
  assert.match(html, /permanecem nos módulos/);
});

test('a lixeira fica livre numa leitura em revisão', () => {
  const html = renderizarLinha({ ...LEITURAS[0] });
  assert.equal(acoesTravadas(html).includes('excluir'), false);
  assert.match(html, /acao-tabela--excluir acao-excluir/);
});

test('abrir a leitura nunca fica travado, nem na aplicada', () => {
  // Consultar o que foi lido é justamente o que se quer fazer depois de
  // aplicar: travar isso seria esconder a procedência do dado.
  for (const l of LEITURAS) {
    const html = renderizarLinha({ ...l });
    assert.equal(acoesTravadas(html).includes('ver'), false, `situação ${l.status}`);
    assert.match(html, /acao-tabela--ver acao-ver/);
  }
});

test('o badge da situação usa a classe da própria situação', () => {
  assert.match(renderizarLinha({ ...LEITURAS[0] }), /badge-ia badge-ia--revisao/);
  assert.match(renderizarLinha({ ...LEITURAS[1] }), /badge-ia badge-ia--aplicada/);
  assert.match(renderizarLinha({ ...LEITURAS[2] }), /badge-ia badge-ia--erro/);
});

test('as seis situações têm classe CSS definida', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'ia.css'), 'utf8');
  for (const s of ['rascunho', 'lendo', 'revisao', 'aplicada', 'erro', 'cancelada']) {
    assert.ok(css.includes(`.badge-ia--${s}`), `falta .badge-ia--${s} em ia.css (situação "${s}")`);
  }
});

test('o nome que veio do documento é escapado na grade', () => {
  // O título pode ter sido montado a partir do nome de um arquivo enviado —
  // texto de fora do sistema, que é o pior candidato a entrar por innerHTML.
  const html = renderizarLinha({
    ...LEITURAS[0],
    titulo: '<img src=x onerror=alert(1)>',
    usuario_nome: '"><script>alert(2)</script>'
  });
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;img src=x/);
});

test('a mensagem de erro da leitura entra escapada no title', () => {
  const html = renderizarLinha({ ...LEITURAS[2], erro: 'falhou "de novo" <b>' });
  assert.equal(html.includes('<b>'), false);
  assert.match(html, /&quot;de novo&quot;/);
});

test('o módulo publica IaModulo para os modais alcançarem a grade', () => {
  // menu.js embrulha o script do módulo numa IIFE; sem este objeto, o modal de
  // exclusão não teria como mandar recarregar a lista.
  const s = criarSandbox();
  assert.equal(typeof s.IaModulo?.carregar, 'function');
  assert.equal(typeof s.IaModulo?.abrirDetalhes, 'function');
  assert.equal(typeof s.IaModulo?.abrirConfiguracao, 'function');
});

// ---------------------------------------------------------------------------
// Contrato com o backend
// ---------------------------------------------------------------------------

test('os destinos do front e do backend são a mesma lista', () => {
  // O front monta o filtro com o que o backend manda. Este teste tranca a
  // porta pelo outro lado: uma constante paralela no front é como as etapas do
  // funil saíram de sincronia uma vez.
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  assert.equal(
    /const\s+DESTINOS\s*=/.test(fonte), false,
    'ia.js não pode ter a própria lista de destinos — ela vem de GET /api/ia/lista'
  );
  assert.match(fonte, /dados\.destinos/);
  assert.match(fonte, /dados\.situacoes/);
});

test('os modais grandes revelam o overlay pelo evento do spinner', () => {
  // O overlay de configuração e o de detalhes nascem `hidden`. Tirar o spinner
  // sem remover o `hidden` deixa a tela em branco — foi assim que o
  // "visualizar orçamento" ficou sem abrir por um tempo.
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  const bloco = /function openModalWithSpinner[\s\S]*?\n\}/.exec(fonte);
  assert.ok(bloco, 'não achei openModalWithSpinner');
  assert.match(bloco[0], /modalSpinnerLoaded/);
  assert.match(bloco[0], /classList\.remove\('hidden'\)/);

  for (const arquivo of ['configuracao.html', 'detalhes.html', 'nova.html']) {
    const html = fs.readFileSync(
      path.join(__dirname, '..', '..', 'html', 'modals', 'ia', arquivo), 'utf8');
    assert.match(html, /Overlay" class="hidden /,
      `${arquivo}: o overlay precisa nascer hidden para o spinner revelá-lo`);
  }
});


// ===========================================================================
// ETAPA 9 — A CASCA
//
// Nada aqui muda o que o módulo faz. O que se prova é que ele PARECE com o
// resto do programa: a mesma distância até a barra de cima, a mesma barra de
// rolagem, e uma tabela cujos títulos não quebram em duas linhas.
//
// São conferências contra os arquivos, não contra comportamento — porque é
// disso que se trata: um valor de CSS que ninguém repara ter mudado até a tela
// ficar torta de novo.
// ===========================================================================

const HTML_MODULO = path.join(__dirname, '..', '..', 'html', 'ia.html');
const CSS_MODULO = path.join(__dirname, '..', '..', 'css', 'ia.css');
const HTML_PRODUTOS = path.join(__dirname, '..', '..', 'html', 'produtos.html');

test('o cabeçalho segue o mesmo espaçamento do módulo de Produtos', () => {
  const ia = fs.readFileSync(HTML_MODULO, 'utf8');
  const produtos = fs.readFileSync(HTML_PRODUTOS, 'utf8');

  // `module-header` é a classe que fixa `margin-top: 0` e CANCELA a animação
  // de entrada. Sem ela o cabeçalho nasce 20px abaixo do lugar e desce até a
  // posição final — que era exatamente a diferença que se via contra Produtos.
  const cabecalhoIa = /<div class="([^"]*)"[^>]*>\s*<div>\s*<h1[^>]*module-header__title/.exec(ia)
    || /<div class="(module-header[^"]*)"/.exec(ia);
  assert.ok(cabecalhoIa, 'não achei o cabeçalho do módulo de IA');
  assert.match(cabecalhoIa[1], /\bmodule-header\b/);

  // E a mesma margem inferior do padrão.
  const margemProdutos = /class="module-header[^"]*\bmb-(\d+)\b/.exec(produtos);
  const margemIa = /class="module-header[^"]*\bmb-(\d+)\b/.exec(ia);
  assert.ok(margemProdutos && margemIa);
  assert.strictEqual(margemIa[1], margemProdutos[1],
    'a margem do cabeçalho não bate com a de Produtos');
});

test('a barra de filtros tem o mesmo respiro de Produtos', () => {
  const ia = fs.readFileSync(HTML_MODULO, 'utf8');
  const produtos = fs.readFileSync(HTML_PRODUTOS, 'utf8');

  const respiro = fonte => {
    const m = /glass-surface rounded-xl (p-\d+ mb-\d+)/.exec(fonte);
    return m && m[1];
  };
  assert.strictEqual(respiro(ia), respiro(produtos),
    'o padding/margem da barra de filtros destoa de Produtos');
});

test('o módulo não recarrega Tailwind nem os ícones', () => {
  // Os dois já vêm do documento principal. Carregar de novo baixa a folha
  // inteira a cada troca de módulo — e o link de ícones aponta para a
  // internet, que num aplicativo de mesa pode simplesmente não existir.
  const ia = fs.readFileSync(HTML_MODULO, 'utf8');
  assert.doesNotMatch(ia, /tailwind-offline\.css/);
  assert.doesNotMatch(ia, /cdnjs\.cloudflare\.com/);
});

test('os modais têm tamanho fixo e quase cheio, com margens proporcionais', () => {
  const css = fs.readFileSync(CSS_MODULO, 'utf8');
  const regra = /\.modal-ia \{([\s\S]*?)\}/.exec(css);
  assert.ok(regra, 'não achei a regra do modal');

  // ALTURA, não max-height: uma caixa que se ajusta ao conteúdo muda de
  // tamanho a cada leitura aberta, e a tela pula entre uma e outra.
  assert.match(regra[1], /\n\s*height:\s*90vh;/);
  assert.doesNotMatch(regra[1], /max-height/);

  // Largura proporcional, com teto para telas muito largas.
  assert.match(regra[1], /width:\s*min\(\d+px,\s*\d+vw\)/);

  // A distinção "largo" deixou de existir: todos têm o mesmo tamanho.
  const largo = /\.modal-ia--largo \{([\s\S]*?)\}/.exec(css);
  assert.ok(largo);
  assert.doesNotMatch(largo[1], /max-width|width/);
});

test('os modais usam a barra de rolagem padrão do programa', () => {
  // `.modal-scroll` mora em src/styles/scroll.css e é o que todos os outros
  // modais usam. Sem ela este módulo mostrava a barra crua do sistema.
  const ler = a => fs.readFileSync(
    path.join(__dirname, '..', '..', 'html', 'modals', 'ia', `${a}.html`), 'utf8');

  for (const arquivo of ['nova', 'configuracao']) {
    assert.match(ler(arquivo), /class="modal-ia__corpo modal-scroll/,
      `${arquivo}.html não usa a barra de rolagem padrão`);
  }

  // No detalhe quem rola é a GRADE, não o corpo — e por isso o corpo é fixo.
  // Com o corpo rolando, a página inteira crescia junto com a tabela e o rodapé
  // descia com ela: a última linha ficava embaixo da borda da tela, fora de
  // alcance, com o cabeçalho da tabela já perdido lá em cima.
  const detalhes = ler('detalhes');
  assert.match(detalhes, /class="modal-ia__corpo modal-ia__corpo--fixo/);
  for (const seletor of ['ia-grade-revisao modal-scroll', 'modal-scroll ia-painel-rolante']) {
    assert.ok(detalhes.includes(seletor), `o detalhe perdeu o rolante "${seletor}"`);
  }

  // E a grade de revisão segue a barra das tabelas.
  const css = fs.readFileSync(CSS_MODULO, 'utf8');
  assert.match(css, /\.ia-grade-revisao::-webkit-scrollbar-thumb \{/);
});

test('a grade cresce até a borda da tela e para', () => {
  const css = fs.readFileSync(CSS_MODULO, 'utf8');

  // Três peças, e todas necessárias. O modal tem altura fixa (90vh); o corpo
  // esconde o que passa disso e reparte a sobra em coluna; a grade fica com a
  // sobra inteira. Falta `min-height: 0` e o flex se recusa a encolher o filho
  // abaixo do conteúdo dele — a grade estoura o corpo e a rolagem some.
  const modal = /\.modal-ia \{([\s\S]*?)\}/.exec(css);
  assert.match(modal[1], /height:\s*\d+vh/);

  const corpo = /\.modal-ia__corpo--fixo \{([\s\S]*?)\}/.exec(css);
  assert.ok(corpo, 'o corpo fixo saiu do CSS');
  assert.match(corpo[1], /overflow:\s*hidden/);
  assert.match(corpo[1], /flex-direction:\s*column/);

  const grade = /\.ia-grade-revisao \{([\s\S]*?)\}/.exec(css);
  assert.ok(grade, 'a grade saiu do CSS');
  assert.match(grade[1], /overflow:\s*auto/);
  assert.match(grade[1], /min-height:\s*0/);
});

test('o cabeçalho da tabela não some ao rolar', () => {
  const css = fs.readFileSync(CSS_MODULO, 'utf8');

  // Sem isto, rolar uma leitura de trinta linhas deixa o usuário olhando para
  // colunas sem nome.
  const th = /\.ia-grade-revisao thead th \{([\s\S]*?)\}/.exec(css);
  assert.ok(th, 'o cabeçalho fixo saiu do CSS');
  assert.match(th[1], /position:\s*sticky/);
  assert.match(th[1], /top:\s*0/);

  // Fundo opaco: `sticky` sem fundo deixa as linhas passarem POR BAIXO do
  // texto do cabeçalho, e os dois se misturam.
  assert.match(th[1], /background:\s*#[0-9a-f]{3,8}/i);
});

test('a coluna de unidade abre espaço quando há aviso', () => {
  const css = fs.readFileSync(CSS_MODULO, 'utf8');

  // "CH ⚠" não cabe em 7ch: ou o aviso sai da célula, ou empurra a coluna e
  // desalinha a tabela toda. O seletor só alarga a que TEM aviso.
  const larga = /\.ia-sub-unidade:has\(\.ia-alerta-campo\) \{([\s\S]*?)\}/.exec(css);
  assert.ok(larga, 'a unidade não alarga com o aviso');
  const normal = /\.ia-sub-unidade \{([\s\S]*?)\}/.exec(css);
  const ch = t => Number(/width:\s*(\d+)ch/.exec(t)[1]);
  assert.ok(ch(larga[1]) > ch(normal[1]),
    'a coluna com aviso não é mais larga que a sem');
});

test('a tabela tem cinco colunas, e nenhum título quebra em duas linhas', () => {
  const ia = fs.readFileSync(HTML_MODULO, 'utf8');
  const cabecalhos = [...ia.matchAll(/<th([^>]*)>([^<]+)<\/th>/g)];

  assert.strictEqual(cabecalhos.length, 5,
    `a tabela voltou a ter ${cabecalhos.length} colunas: ` + cabecalhos.map(c => c[2]).join(', '));
  assert.deepStrictEqual(cabecalhos.map(c => c[2]),
    ['Leitura', 'Destino', 'Situação', 'Responsável', 'Ações']);

  // Título que quebra em duas linhas empurra a altura do cabeçalho e desalinha
  // a tabela inteira.
  for (const [, atributos, texto] of cabecalhos) {
    assert.match(atributos, /whitespace-nowrap/, `o título "${texto}" pode quebrar`);
  }
});

test('as colunas que saíram da tabela continuam sob a mesma permissão', () => {
  // Arquivos, itens, modelos e data foram para o popover. O que mudou foi ONDE
  // aparecem, não quem pode vê-los — uma permissão que deixa de proteger algo
  // é pior do que uma que nunca existiu, porque continua marcada na tela de
  // perfis dando a impressão de que faz alguma coisa.
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  for (const perm of ['col_ia_arquivos', 'col_ia_itens', 'col_ia_modelo', 'col_ia_data']) {
    assert.match(fonte, new RegExp(`data-perm-col="\\$\\{perm\\}"|'${perm}'`),
      `${perm} deixou de proteger alguma coisa`);
  }
});

test('a linha da tabela ganha o (i) e perde as quatro colunas', () => {
  const html = renderizarLinha({ ...LEITURAS[0] });

  // O caminho para o que saiu da tabela precisa existir na linha.
  assert.match(html, /class="info-icon ia-info-linha"/);

  // E as células que viraram popover não podem ter ficado para trás: duas
  // fontes para o mesmo dado saem de sincronia na primeira mudança.
  for (const perm of ['col_ia_arquivos', 'col_ia_itens', 'col_ia_modelo', 'col_ia_data']) {
    assert.doesNotMatch(html, new RegExp(`<td[^>]*data-perm-col="${perm}"`),
      `a coluna ${perm} continua na linha`);
  }

  // As cinco que ficaram continuam lá.
  assert.match(html, /data-perm-col="col_ia_titulo"/);
  assert.match(html, /data-perm-col="col_ia_destino"/);
  assert.match(html, /data-perm-col="col_ia_status"/);
  assert.match(html, /data-perm-col="col_ia_usuario"/);
});

// ---------------------------------------------------------------------------
// O carregador de módulo executa UM script só
// ---------------------------------------------------------------------------

test('o módulo não depende de <script> que nunca roda', () => {
  // `menu.js` busca `../js/<pagina>.js` e injeta SÓ ele. Todo outro <script>
  // escrito no HTML do módulo é ignorado quando o módulo abre pelo menu — e
  // some sem erro nenhum: o que se vê é uma função global indefinida e um
  // `?.` engolindo a chamada.
  //
  // Foi assim que o posicionador de popover ficou uma etapa inteira sem rodar:
  // o arquivo existia, o <script> estava no HTML, e nada acontecia.
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'html', 'ia.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);

  assert.deepEqual(scripts, ['../js/ia.js'],
    'o HTML do módulo tem <script> que o carregador não executa');
});

test('os utilitários globais são carregados pelo menu', () => {
  const menu = fs.readFileSync(path.join(__dirname, '..', '..', 'html', 'menu.html'), 'utf8');
  for (const util of ['apiConfig.js', 'utils/notifications.js', 'utils/popover.js']) {
    assert.ok(menu.includes(util), `${util} não é carregado por ninguém`);
  }
});

test('o posicionador de popover não é chamado com `?.` sozinho', () => {
  // `window.Popover?.abrir(...)` engole a falha: se o utilitário não estiver
  // carregado, o popover simplesmente não abre e ninguém fica sabendo. O `?.`
  // continua ali (é defensivo e correto), mas o teste acima garante que o
  // utilitário CHEGA — que é a metade que faltava.
  const fonte = fs.readFileSync(ARQUIVO, 'utf8');
  assert.match(fonte, /Popover\?\.abrir\(/);
});

test('o popover fica acima de qualquer modal', () => {
  // `Modal.open` eleva TODO overlay a `z-[2000]` (ensureHighZIndex, em
  // src/utils/modal.js), trocando o `z-[1200]` escrito no HTML. Movido para o
  // <body>, o popover passa a competir com ele — e com z-index menor some
  // ATRÁS, com o sintoma enganando: está lá, do tamanho certo, e o que se vê
  // é a área borrada do modal por cima.
  const util = fs.readFileSync(path.join(__dirname, '..', 'utils', 'popover.js'), 'utf8');

  const piso = /const PISO = (\d+);/.exec(util);
  assert.ok(piso, 'o popover não fixa piso nenhum');
  assert.ok(Number(piso[1]) > 2000, 'o piso ficou abaixo do que Modal.open aplica');

  // E a camada é CALCULADA a partir do que está na tela: um número cravado
  // envelheceria em silêncio na primeira mudança daquele 2000.
  assert.match(util, /function camadaAcimaDeTudo/);
  assert.match(util, /getComputedStyle\(overlay\)\.zIndex/);

  // Abaixo do aviso de desconexão, que precisa cobrir tudo.
  const teto = /const TETO = (\d+);/.exec(util);
  assert.ok(Number(teto[1]) < 2147483000);
});

test('o piso do popover acompanha o que Modal.open aplica', () => {
  // Se `minZIndex` subir no utilitário de modal e o piso daqui não, o popover
  // volta a sumir atrás — e o sintoma não aponta para este arquivo.
  const modal = fs.readFileSync(path.join(__dirname, '..', '..', 'utils', 'modal.js'), 'utf8');
  const minimo = /minZIndex = (\d+)/.exec(modal);
  assert.ok(minimo, 'não achei o z-index mínimo dos modais');

  const util = fs.readFileSync(path.join(__dirname, '..', 'utils', 'popover.js'), 'utf8');
  const piso = Number(/const PISO = (\d+);/.exec(util)[1]);
  assert.ok(piso > Number(minimo[1]),
    `o piso do popover (${piso}) ficou abaixo do z-index dos modais (${minimo[1]})`);
});

test('o popover é devolvido ao trocar de módulo', () => {
  // Trocar de módulo substitui o conteúdo da página. O popover foi movido para
  // o <body> e não sai junto: sem esta limpeza ele fica flutuando por cima do
  // módulo seguinte, congelado, sem nada que o faça sumir.
  const util = fs.readFileSync(path.join(__dirname, '..', 'utils', 'popover.js'), 'utf8');
  assert.match(util, /function limparTudo/);
  assert.match(util, /MutationObserver/);
  assert.match(util, /getElementById\('content'\)/);
  assert.match(util, /addEventListener\('resize', limparTudo\)/);
});

test('todo popover do detalhe é devolvido ao fechar', () => {
  // Os popovers são movidos para o `<body>` para escapar do `backdrop-filter`
  // e não saem com o modal. Cada um esquecido na lista de limpeza vira um
  // elemento órfão flutuando sobre o módulo seguinte — e, na abertura
  // seguinte, um id duplicado que faz `getElementById` devolver o VELHO, solto
  // e sem escuta nenhuma.
  //
  // Este teste é estrutural de propósito: um popover novo que não entre na
  // lista sai calado, e o defeito só aparece na SEGUNDA vez que se abre.
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'html', 'modals', 'ia', 'detalhes.html'), 'utf8');
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'modals', 'ia-detalhes.js'), 'utf8');

  const noHtml = [...html.matchAll(/id="([^"]+)"[^>]*class="[^"]*resumo-popover/g)].map(m => m[1]);
  assert.ok(noHtml.length >= 2, `só ${noHtml.length} popover(s) no HTML — o seletor deixou de casar`);

  const lista = /const POPOVERS = \[([^\]]*)\]/.exec(js);
  assert.ok(lista, 'a lista de limpeza saiu de ia-detalhes.js');

  for (const id of noHtml) {
    assert.ok(lista[1].includes(`'${id}'`), `${id} não é devolvido ao fechar o modal`);
  }
});

test('rolar fecha os popovers abertos', () => {
  // A grade rola por DENTRO agora. Um popover ancorado numa linha fica parado
  // no ar quando a linha sai de vista, apontando para lugar nenhum.
  const js = fs.readFileSync(path.join(__dirname, '..', 'utils', 'popover.js'), 'utf8');
  const escuta = /addEventListener\('scroll'[^)]*\)/.exec(js);
  assert.ok(escuta, 'ninguém escuta a rolagem');

  // `capture: true` porque o evento de um contêiner que rola não sobe até
  // `window` na fase de bolha — sem isso a escuta existe e não serve.
  assert.match(escuta[0], /capture:\s*true/);
});
