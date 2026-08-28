/**
 * As duas correções do modal de conversão e dos botões de salvar orçamento.
 *
 * ---------------------------------------------------------------------------
 * 1. O SEGUNDO CLIQUE EM "SALVAR"
 *
 * "Salvar" e "Salvar e Enviar" (novo) e "Salvar" e "Salvar e Fechar" (editar)
 * mandam o MESMO formulário com intenções diferentes, e os quatro ficam FORA
 * dele, ligados por `form="id"`. Nenhum tinha trava: entre o clique e a
 * resposta do servidor dava tempo de clicar de novo — e o mesmo orçamento
 * entrava duas vezes.
 *
 * 2. AS PENDÊNCIAS DA CONVERSÃO
 *
 * A tarja vermelha trazia UM motivo por vez, escolhido por uma escada de
 * `else if`, com a lista de peças escrita por extenso dentro da frase. Com
 * oito peças por confirmar virava um parágrafo no alto do modal; e resolver as
 * peças só então revelava a justificativa que também faltava.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', '..', '..');
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

const converterJs = () => ler('src', 'js', 'modals', 'orcamento-converter.js');
const converterHtml = () => ler('src', 'html', 'modals', 'orcamentos', 'converter.html');
const folhaConversao = () => ler('src', 'styles', 'conversao-orcamento.css');

// ---------------------------------------------------------------------------
// 1. Anti duplo clique nos botões de salvar
// ---------------------------------------------------------------------------

const TELAS = [
  {
    nome: 'Novo Orçamento',
    js: ['src', 'js', 'modals', 'orcamento-novo.js'],
    html: ['src', 'html', 'modals', 'orcamentos', 'novo.html'],
    form: 'novoOrcamentoForm',
    botoes: ['salvarNovoOrcamento', 'enviarNovoOrcamento']
  },
  {
    nome: 'Editar Orçamento',
    js: ['src', 'js', 'modals', 'orcamento-editar.js'],
    html: ['src', 'html', 'modals', 'orcamentos', 'editar.html'],
    form: 'editarOrcamentoForm',
    botoes: ['salvarOrcamento', 'salvarFecharOrcamento']
  }
];

test('os dois botões de salvar ficam fora do form — é por isso que a trava é do form', () => {
  for (const tela of TELAS) {
    const html = ler(...tela.html);
    for (const id of tela.botoes) {
      const marcacao = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
      assert.ok(marcacao, `${tela.nome}: não achei o botão ${id}`);
      assert.match(marcacao[0], new RegExp(`form="${tela.form}"`),
        `${tela.nome}: ${id} precisa continuar ligado ao form por atributo — `
        + 'a trava do BotaoAcao depende disso para achá-lo');
    }
  }
});

test('as duas telas travam o envio pelo formulário', () => {
  for (const tela of TELAS) {
    const js = ler(...tela.js);

    // No formulário e não no botão: travar só o botão clicado ainda deixaria
    // clicar no de ao lado, que manda o mesmo orçamento.
    assert.match(js, /BotaoAcao\?\.bindSubmit/,
      `${tela.nome}: o envio não passa pelo bindSubmit`);
  }
});

test('a intenção do botão clicado sobrevive à trava', () => {
  const novo = ler('src', 'js', 'modals', 'orcamento-novo.js');
  const editar = ler('src', 'js', 'modals', 'orcamento-editar.js');

  // É o `submitter` que separa "Salvar" de "Salvar e Enviar" (data-status) e
  // de "Salvar e Fechar" (id). Um envelope que perdesse o submitter faria todo
  // clique virar rascunho, e "Salvar e Fechar" pararia de fechar.
  assert.match(novo, /submitter\?\.dataset\.status/,
    'Novo: perdeu o status do botão clicado');
  assert.match(editar, /submitter\?\.id === 'salvarFecharOrcamento'/,
    'Editar: perdeu a identificação de "Salvar e Fechar"');
});

test('saveQuote devolve promessa — sem isso a trava soltava antes da gravação', () => {
  const novo = ler('src', 'js', 'modals', 'orcamento-novo.js');

  // O diálogo de confirmação fecha e SÓ ENTÃO a requisição sai. Uma saveQuote
  // que devolvesse `undefined` faria o botão ser liberado no instante do
  // "sim", bem no meio da janela em que o segundo clique cabia.
  assert.match(novo, /return new Promise\(resolve =>/,
    'saveQuote precisa devolver promessa que só resolve no fim');
  assert.match(novo, /finally\s*{[^}]*resolve\(\);/,
    'a promessa precisa resolver também quando a gravação falha, senão o '
    + 'botão fica em carregando para sempre');
});

test('todo botão de envio é marcado como gerido, não só o primeiro', () => {
  const util = ler('src', 'utils', 'botaoAcao.js');

  // A rede automática trava no CLIQUE qualquer botão que não se declare
  // gerido. O botão não marcado chegava ao envio JÁ ocupado, e `run` descartava
  // a ação em silêncio: clique sem gravação e sem erro na tela.
  assert.match(util, /function botoesDeEnvio\(form\)/,
    'falta a varredura de todos os botões de envio');
  assert.match(util, /for \(const b of botoesDeEnvio\(form\)\) b\.dataset\.acaoGerida = 'true';/,
    'bindSubmit precisa marcar TODOS os botões, não só o localizado');
});

test('o caminho "Aprovado" remonta a trava que ele mesmo cortou', () => {
  const editar = ler('src', 'js', 'modals', 'orcamento-editar.js');

  // Orçamento aprovado não salva direto: o envio é interceptado na CAPTURA,
  // que corta a propagação para abrir a revisão de conversão. Cortada a
  // propagação, o envio nunca chega ao `bindSubmit` — e a trava dele também
  // não. Sem remontá-la aqui, clicar em "Salvar" e logo em "Salvar e Fechar"
  // abria duas revisões, uma por cima da outra.
  const captura = editar.slice(
    editar.indexOf('Captura o submit antes do handler'),
    editar.indexOf('Captura o clique de "Converter em Pedido"')
  );
  assert.ok(captura.length > 0, 'não achei o handler de captura');

  assert.match(captura, /BotaoAcao\?\.estaOcupado\?\.\(form\)/,
    'a captura precisa perguntar se já há uma abertura em curso');
  assert.match(captura, /marcarOcupado\?\.\(form, \{ visual: false \}\)/,
    'a trava é do formulário: no botão, o de ao lado ainda abriria a segunda');
  assert.match(captura, /\.finally\(\(\) => BotaoAcao\.liberar\?\.\(form\)\)/,
    'sem soltar no fim, o formulário fica travado para o resto da edição');
});

test('a recusa da transportadora acontece ANTES de travar', () => {
  const editar = ler('src', 'js', 'modals', 'orcamento-editar.js');
  const captura = editar.slice(
    editar.indexOf('Captura o submit antes do handler'),
    editar.indexOf('Captura o clique de "Converter em Pedido"')
  );

  // `exigeTransportadora` é uma RECUSA: ela volta sem abrir nada. Marcada
  // antes dela, a trava ficaria posta sem nada em curso para soltá-la — e o
  // orçamento não seria mais salvo até fechar e reabrir o modal.
  assert.ok(
    captura.indexOf('exigeTransportadora()') < captura.indexOf('marcarOcupado'),
    'a checagem da transportadora precisa vir antes de marcar o formulário'
  );
});

test('o carregando acende no botão que foi clicado', () => {
  const util = ler('src', 'utils', 'botaoAcao.js');

  // Com o botão fixado na ligação, clicar em "Salvar e Enviar" acendia
  // "Salvar" — e o botão de fato clicado ficava parado, parecendo que não
  // respondeu ao clique.
  assert.match(util, /function botaoQueSubmeteu\(evento\)/);
  assert.match(util, /run\(botaoQueSubmeteu\(evento\) \|\| botao,/,
    'o run precisa preferir o submitter ao botão localizado na ligação');
});

// ---------------------------------------------------------------------------
// 2. Cabeçalho fixo
// ---------------------------------------------------------------------------

test('o cabeçalho das tabelas de conversão acompanha a rolagem', () => {
  const css = folhaConversao();
  const regra = css.match(/#converterOrcamentoOverlay \.table-scroll thead th \{[^}]+\}/);
  assert.ok(regra, 'falta a regra de cabeçalho fixo');

  assert.match(regra[0], /position:\s*sticky/);
  assert.match(regra[0], /top:\s*0/);

  // Sem fundo opaco as linhas passam POR BAIXO do cabeçalho e os dois textos
  // se sobrepõem — o card do modal é translúcido.
  assert.match(regra[0], /background:\s*#[0-9a-fA-F]{6}/,
    'o cabeçalho fixo precisa de fundo opaco');
});

test('o cabeçalho fixo tem separador próprio', () => {
  const css = folhaConversao();
  const regra = css.match(/#converterOrcamentoOverlay \.table-scroll thead th \{[^}]+\}/);

  // A tabela é `border-collapse: collapse`, e o Chromium não leva a borda
  // colapsada do `<tr>` junto com a célula grudada: sem uma linha própria, o
  // cabeçalho rola encostado na primeira peça, sem nada separando os dois.
  assert.match(regra[0], /box-shadow:\s*inset 0 -1px 0/,
    'o separador do cabeçalho fixo precisa ser sombra interna, não borda de <tr>');
});

test('o estilo do modal vale também na conversão em lote de Pedidos', () => {
  // Só uma folha de módulo fica carregada por vez (`menu.js` troca
  // `../css/{pagina}.css`). Este modal é aberto por Orçamentos E por Pedidos:
  // em `orcamentos.css`, nada disto existia no segundo caminho.
  const menu = ler('src', 'html', 'menu.html');
  assert.match(menu, /styles\/conversao-orcamento\.css/,
    'a folha da conversão precisa ser carregada sempre, pelo menu.html');

  const orcamentos = ler('src', 'css', 'orcamentos.css');
  assert.doesNotMatch(orcamentos, /#converterOrcamentoOverlay/,
    'as regras do modal não podem voltar para a folha de um módulo só');
});

// ---------------------------------------------------------------------------
// 3. A tarja e o (i) de pendências
// ---------------------------------------------------------------------------

test('a tarja diz só que há pendências; quem lista é o (i)', () => {
  const html = converterHtml();

  assert.match(html, /Pendências não resolvidas/,
    'falta o texto fixo da tarja');
  assert.match(html, /id="converterPendenciasInfo"[^>]*class="[^"]*info-icon/,
    'o (i) precisa usar o mesmo ícone dos outros módulos');
  assert.match(html, /id="converterPendenciasPopover"/,
    'falta a caixa das pendências');
});

test('o popover fica fora da tarja, para poder ser movido ao body', () => {
  const html = converterHtml();

  const tarja = html.indexOf('id="converterWarning"');
  const fimDaTarja = html.indexOf('</div>', html.indexOf('id="converterPendenciasInfo"'));
  const popover = html.indexOf('id="converterPendenciasPopover"');

  assert.ok(tarja >= 0 && popover > fimDaTarja,
    'o popover precisa ser irmão da tarja, não filho: `Popover.abrir` o move '
    + 'para o <body> e o devolve depois');
});

test('a lista sai da MESMA conta que habilita o botão', () => {
  const js = converterJs();

  // Duas contas separadas sobre a mesma pergunta divergem, e a divergência
  // aparece do pior jeito: botão travado com a lista vazia.
  assert.match(js, /function listarPendencias\(v\)/);
  assert.match(js, /const pendencias = listarPendencias\(v\);/,
    'validate precisa alimentar a lista a partir do computeValidation');
  assert.doesNotMatch(js, /function listarPendencias\(\)\s*\{[\s\S]*computeValidation\(\)/,
    'listarPendencias não pode recalcular a validação por conta própria');
});

test('a escada de else if saiu — todas as pendências aparecem juntas', () => {
  const js = converterJs();

  // Antes, resolver as peças sem confirmação só então revelava a justificativa
  // que faltava. A pessoa descobria uma por vez, sem nunca ver o total.
  assert.doesNotMatch(js, /message = 'Nenhuma peça no orçamento\.'/,
    'a escada de mensagem única não pode voltar');
  assert.doesNotMatch(js, /Confirme todas para converter/,
    'a lista de peças não é mais escrita por extenso dentro da frase');
});

test('cada tipo de pendência vira um grupo, com quantas e o que fazer', () => {
  const js = converterJs();

  for (const titulo of ['Peças com dados inválidos', 'Peças sem confirmação', 'Justificativa da decisão']) {
    assert.ok(js.includes(titulo), `falta o grupo "${titulo}"`);
  }

  // A contagem é o que diz se falta uma peça ou onze.
  assert.match(js, /quantas: invalidas\.length/);
  assert.match(js, /quantas: v\.unapproved\.length/);
});

test('a lista é redesenhada a cada validação, e some quando zera', () => {
  const js = converterJs();

  // É isto que faz a pendência SAIR do popover conforme vai sendo resolvida.
  assert.match(js, /desenharPendencias\(pendencias\);/);
  assert.match(js, /warning\.classList\.add\('hidden'\);\s*\r?\n\s*fecharPendencias\(\);/,
    'sem pendências, a tarja some e o popover fecha junto — senão ele fica '
    + 'aberto na tela apontando para uma tarja que já não existe');
});

test('a caixa aberta é reposicionada quando encolhe', () => {
  const js = converterJs();

  // Ela é ancorada acima do ícone quando não cabe abaixo. Uma lista de dez que
  // vira de três continuaria desenhada no lugar calculado para a de dez.
  assert.match(js, /if \(pendenciasPopover\.classList\.contains\('show'\)\) \{[\s\S]{0,200}Popover\?\.abrir/,
    'o popover aberto precisa ser reposicionado depois de redesenhado');
});

test('passar o mouse abre, e sair não fecha na hora', () => {
  const js = converterJs();

  assert.match(js, /pendenciasInfo\.addEventListener\('mouseenter', abrir\)/);

  // Entre o ícone e a caixa há um vão (a margem do Popover). Sem a folga, o
  // ponteiro atravessa terra de ninguém e a caixa some antes de ser alcançada.
  assert.match(js, /saindo = setTimeout\(fecharPendencias, \d+\)/,
    'falta a folga ao sair do ícone');
  assert.match(js, /pendenciasPopover\.addEventListener\('mouseenter', \(\) => clearTimeout\(saindo\)\)/,
    'entrar na caixa precisa cancelar o fechamento pendente');
});

test('clicar fixa a caixa, para dar para rolar a lista longa', () => {
  const js = converterJs();
  assert.match(js, /fixado = !fixado;/,
    'o clique precisa fixar: com oito peças a lista rola, e sair do ícone '
    + 'para alcançar a barra fecharia a caixa');
});

test('o popover é devolvido quando o modal fecha', () => {
  const js = converterJs();

  // Ele foi movido para o `<body>` e não sai junto com o modal: sem devolver,
  // fica pendurado por cima do módulo seguinte, congelado.
  assert.match(js, /Popover\?\.descartar\(pendenciasPopover\)/);

  const limpeza = js.slice(js.indexOf('function cleanupReplaceModalIntegration'));
  assert.ok(limpeza.indexOf('descartar(pendenciasPopover)') < limpeza.indexOf('}'),
    'o descarte precisa estar na limpeza, que roda no cancelar, no confirmar '
    + 'e no fechar');
});

test('o toast diz o que falta, não repete a tarja', () => {
  const js = converterJs();

  // A tarja agora diz sempre a mesma frase. Um toast que a repetisse não
  // ajudaria ninguém a saber o que fazer.
  assert.match(js, /function resumoPendencias\(grupos\)/);
  assert.match(js, /const resumo = resumoPendencias\(v\.pendencias \|\| \[\]\);/);
  assert.doesNotMatch(js, /showToast\(warningText\?\.textContent/,
    'o toast não pode voltar a ler o texto fixo da tarja');
});

test('os nomes das peças entram como texto, nunca como marcação', () => {
  const js = converterJs();

  // Nome de peça vem do cadastro e do que a IA leu de um PDF. Montado com
  // innerHTML, um nome com `<` quebraria a caixa inteira.
  const desenho = js.slice(
    js.indexOf('function desenharPendencias'),
    js.indexOf('function fecharPendencias')
  );
  assert.ok(desenho.length > 0, 'não achei desenharPendencias');
  assert.doesNotMatch(desenho, /innerHTML/,
    'a caixa é montada por textContent, não por innerHTML');
  assert.match(desenho, /item\.textContent = nome;/);
});

// ---------------------------------------------------------------------------
// 4. O comportamento, e não só o texto do arquivo
//
// Tudo acima é `grep`. O popover deste programa já teve três defeitos seguidos
// que nenhuma verificação de texto pegaria — ele atrás do modal, esquecido no
// `<body>`, e o que abria e não fechava mais. Daqui para baixo o código REAL é
// recortado do arquivo e executado.
//
// O recorte vai de `computeValidation` (a conta que habilita o botão) até
// `fecharPendencias`, e leva junto `listarPendencias`, `resumoPendencias` e
// `desenharPendencias`. É de propósito: o valor do teste está em provar que a
// lista mostrada e a decisão de deixar converter saem da MESMA conta.
// ---------------------------------------------------------------------------

const vm = require('node:vm');

function elemento(tag = 'div') {
  return {
    tagName: String(tag).toUpperCase(),
    className: '',
    _texto: '',
    filhos: [],
    _classes: new Set(),
    dataset: {},
    get textContent() {
      return this._texto || this.filhos.map(f => f.textContent).join('');
    },
    set textContent(v) { this._texto = String(v); this.filhos = []; },
    get childElementCount() { return this.filhos.length; },
    appendChild(f) { this.filhos.push(f); return f; },
    replaceChildren(...f) { this.filhos = f; },
    classList: {
      add(c) { this._dono._classes.add(c); },
      remove(c) { this._dono._classes.delete(c); },
      contains(c) { return this._dono._classes.has(c); }
    },
    setAttribute(nome, valor) { this.dataset[nome] = valor; },
    contains() { return false; }
  };
}

function criarElemento(tag) {
  const el = elemento(tag);
  el.classList._dono = el;
  return el;
}

/** Recorta do arquivo o trecho que vai de `de` até (exclusive) `ate`. */
function recortar(fonte, de, ate) {
  const i = fonte.indexOf(de);
  const f = fonte.indexOf(ate);
  assert.ok(i >= 0, `não achei "${de}" no arquivo`);
  assert.ok(f > i, `não achei "${ate}" depois de "${de}"`);
  return fonte.slice(i, f);
}

/**
 * Monta as funções reais num contexto mínimo.
 *
 * Cada coisa que este contexto finge é uma coisa que o teste NÃO mede, e vale
 * saber quais são: a nota de decisão, o sinalizador de saldo negativo e o
 * posicionador do popover.
 */
function montar({ linhas = [], saldoNegativo = false, nota = '' } = {}) {
  const fonte = converterJs();
  const trecho = recortar(fonte, 'function computeValidation() {', 'function fecharPendencias() {');

  const popover = criarElemento('div');
  const icone = criarElemento('button');
  const aberturas = [];

  const contexto = {
    rows: linhas,
    state: { hasNegative: saldoNegativo },
    decisionNote: () => ({ value: nota }),
    pendenciasPopover: popover,
    pendenciasInfo: icone,
    document: { createElement: criarElemento },
    console,
    assert
  };
  contexto.window = {
    Popover: { abrir: (p, a) => aberturas.push([p, a]), fechar: () => {} }
  };
  vm.createContext(contexto);

  // `fecharPendencias` é o único nome do recorte que ficou de fora — ele mora
  // logo depois do corte e só faz esconder a caixa.
  vm.runInContext(trecho + '\nfunction fecharPendencias() { fechou = true; }\nvar fechou = false;', contexto);

  return { contexto, popover, icone, aberturas };
}

const peca = (nome, extra = {}) => ({ nome, approved: false, error: false, ...extra });

test('a lista bate com o motivo pelo qual o botão está travado', () => {
  const { contexto } = montar({ linhas: [peca('Porta 2 Folhas'), peca('Rodapé 15cm')] });

  const v = contexto.computeValidation();
  assert.equal(v.canConfirm, false, 'com peças sem confirmar, não dá para converter');

  const grupos = contexto.listarPendencias(v);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].titulo, 'Peças sem confirmação');
  assert.equal(grupos[0].quantas, 2);
  assert.deepEqual(grupos[0].itens, ['Porta 2 Folhas', 'Rodapé 15cm']);
});

test('confirmar uma peça a tira do popover', () => {
  const linhas = [peca('Porta 2 Folhas'), peca('Rodapé 15cm')];
  const { contexto } = montar({ linhas });

  linhas[0].approved = true;
  const grupos = contexto.listarPendencias(contexto.computeValidation());

  assert.equal(grupos[0].quantas, 1);
  assert.deepEqual(grupos[0].itens, ['Rodapé 15cm'],
    'a peça confirmada tem de sair da lista — era isto que a tarja antiga não '
    + 'conseguia mostrar sem reescrever a frase inteira');
});

test('resolvido tudo, não sobra pendência nenhuma', () => {
  const { contexto } = montar({
    linhas: [peca('Porta 2 Folhas', { approved: true }), peca('Rodapé 15cm', { approved: true })]
  });

  const v = contexto.computeValidation();
  assert.equal(v.canConfirm, true);
  // `Array.from` do realm de fora: a lista nasce DENTRO da VM, e um array
  // de outro realm nao passa no deepStrictEqual mesmo com o mesmo conteudo.
  assert.deepEqual(Array.from(contexto.listarPendencias(v)), []);
});

test('peça inválida e peça sem confirmar são grupos SEPARADOS', () => {
  // A escada de `else if` mostrava só o primeiro motivo: quem tivesse os dois
  // resolvia as inválidas para só então descobrir que ainda faltava confirmar.
  const { contexto } = montar({
    linhas: [peca('Peça Fantasma', { error: true }), peca('Rodapé 15cm')]
  });

  const grupos = contexto.listarPendencias(contexto.computeValidation());
  assert.deepEqual(Array.from(grupos, g => g.titulo),
    ['Peças com dados inválidos', 'Peças sem confirmação']);

  // Uma peça com erro não entra também em "sem confirmação": ela seria contada
  // duas vezes e o total mentiria.
  assert.deepEqual(grupos[1].itens, ['Rodapé 15cm']);
});

test('a justificativa aparece junto das peças, não depois delas', () => {
  const { contexto } = montar({ linhas: [peca('Rodapé 15cm')], saldoNegativo: true });

  const grupos = contexto.listarPendencias(contexto.computeValidation());
  assert.deepEqual(Array.from(grupos, g => g.titulo),
    ['Peças sem confirmação', 'Justificativa da decisão']);
});

test('escrita a nota, a justificativa some da lista', () => {
  const { contexto } = montar({
    linhas: [peca('Rodapé 15cm', { approved: true })],
    saldoNegativo: true,
    nota: 'Reposição já pedida ao fornecedor.'
  });

  const v = contexto.computeValidation();
  assert.equal(v.canConfirm, true);
  // `Array.from` do realm de fora: a lista nasce DENTRO da VM, e um array
  // de outro realm nao passa no deepStrictEqual mesmo com o mesmo conteudo.
  assert.deepEqual(Array.from(contexto.listarPendencias(v)), []);
});

test('orçamento sem peça nenhuma diz isso, e só isso', () => {
  const { contexto } = montar({ linhas: [] });

  const grupos = contexto.listarPendencias(contexto.computeValidation());
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].titulo, 'Nenhuma peça no orçamento');

  // Sem linhas não há o que confirmar: listar "0 peças sem confirmação" ao
  // lado seria ruído.
  assert.equal(grupos[0].quantas, undefined);
});

test('peça sem nome não vira linha em branco no popover', () => {
  const { contexto } = montar({ linhas: [peca('   ')] });

  const grupos = contexto.listarPendencias(contexto.computeValidation());
  assert.deepEqual(grupos[0].itens, ['Peça sem nome'],
    'um marcador solto sem texto não diz a ninguém qual peça é');
});

test('o desenho põe uma peça por linha, como texto', () => {
  const { contexto, popover } = montar({ linhas: [peca('Porta 2 Folhas'), peca('Rodapé 15cm')] });

  contexto.desenharPendencias(contexto.listarPendencias(contexto.computeValidation()));

  assert.equal(popover.childElementCount, 1, 'um grupo');
  const itens = popover.filhos[0].filhos.find(f => f.className === 'conv-pendencia-itens');
  assert.ok(itens, 'falta a lista de itens');
  assert.deepEqual(itens.filhos.map(i => i.textContent), ['Porta 2 Folhas', 'Rodapé 15cm']);
});

test('redesenhar substitui a lista, não empilha uma segunda', () => {
  const linhas = [peca('Porta 2 Folhas'), peca('Rodapé 15cm')];
  const { contexto, popover } = montar({ linhas });

  contexto.desenharPendencias(contexto.listarPendencias(contexto.computeValidation()));
  linhas[0].approved = true;
  contexto.desenharPendencias(contexto.listarPendencias(contexto.computeValidation()));

  assert.equal(popover.childElementCount, 1);
  const itens = popover.filhos[0].filhos.find(f => f.className === 'conv-pendencia-itens');
  assert.deepEqual(itens.filhos.map(i => i.textContent), ['Rodapé 15cm'],
    'a peça confirmada não pode continuar desenhada por baixo da lista nova');
});

test('a caixa aberta é reposicionada; a fechada não é aberta sozinha', () => {
  const linhas = [peca('Porta 2 Folhas'), peca('Rodapé 15cm')];
  const { contexto, popover, aberturas } = montar({ linhas });

  contexto.desenharPendencias(contexto.listarPendencias(contexto.computeValidation()));
  assert.equal(aberturas.length, 0,
    'redesenhar com a caixa fechada não pode abri-la na cara de quem está '
    + 'confirmando as peças');

  popover.classList.add('show');
  linhas[0].approved = true;
  contexto.desenharPendencias(contexto.listarPendencias(contexto.computeValidation()));
  assert.equal(aberturas.length, 1,
    'com a caixa aberta, a lista menor precisa ser reposicionada');
  assert.equal(aberturas[0][1], contexto.pendenciasInfo, 'reposicionada no (i)');
});

test('o resumo do toast cabe numa linha e diz quantas faltam', () => {
  const { contexto } = montar({
    linhas: [peca('Peça Fantasma', { error: true }), peca('Rodapé 15cm')],
    saldoNegativo: true
  });

  const resumo = contexto.resumoPendencias(contexto.listarPendencias(contexto.computeValidation()));
  assert.equal(resumo,
    '1 peças com dados inválidos · 1 peças sem confirmação · Justificativa da decisão');
});

test('sem pendências o resumo é vazio, e o toast cai no texto padrão', () => {
  const { contexto } = montar({ linhas: [peca('Rodapé 15cm', { approved: true })] });
  assert.equal(contexto.resumoPendencias(contexto.listarPendencias(contexto.computeValidation())), '');
});
