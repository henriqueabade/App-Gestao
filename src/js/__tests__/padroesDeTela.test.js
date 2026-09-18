/**
 * Padrões visuais que valem para o app inteiro, travados aqui porque cada um
 * já quebrou em silêncio pelo menos uma vez:
 *
 *  - classe utilitária que não existe no CSS: o Tailwind do app é
 *    PRÉ-COMPILADO (tailwind-offline.css), e classe que não estava lá na hora
 *    da compilação simplesmente não faz nada. Era daí que vinham títulos
 *    colados na linha, grades que não abriam e modais na largura errada. As
 *    que faltavam foram para src/styles/utilitarios.css;
 *  - o botão Fechar/Cancelar do rodapé dos modais é vermelho (btn-danger);
 *  - os botões do BB são azul escuro (btn-bb); "Ver relatório" é azul claro;
 *  - o Novo insumo tem o liga/desliga de estoque infinito, como o Editar;
 *  - o (i) do resumo em Prospecções e em Usuários usa o posicionador comum
 *    (window.Popover), que leva o balão para o <body>.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..');
const ler = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');
const MENU = ler('html/menu.html');

function arquivos(pasta, extensao) {
  const lista = [];
  (function andar(d) {
    for (const nome of fs.readdirSync(d)) {
      const p = path.join(d, nome);
      if (fs.statSync(p).isDirectory()) {
        if (!/__tests__|node_modules|assets/.test(p)) andar(p);
      } else if (nome.endsWith(extensao)) lista.push(p);
    }
  })(path.join(SRC, pasta));
  return lista;
}
const relativo = f => path.relative(SRC, f).split(path.sep).join('/');

test('utilitarios.css entra logo depois do tailwind-offline.css no menu', () => {
  const tailwind = MENU.indexOf('href="../styles/tailwind-offline.css"');
  const utilitarios = MENU.indexOf('href="../styles/utilitarios.css"');
  assert.ok(tailwind >= 0 && utilitarios > tailwind, 'as variantes responsivas precisam vir depois das classes base');
  const entre = MENU.slice(tailwind, utilitarios);
  assert.ok(!/<link[^>]+href="\.\.\/(?:css)\//.test(entre), 'nenhuma folha de módulo entre as duas');
});

test('toda classe de espaço/tamanho usada nas telas existe numa folha global', () => {
  // Só as folhas que o menu.html carrega: a folha de um módulo só vale
  // enquanto ele está aberto, então classe definida só lá não conta.
  const folhas = [...MENU.matchAll(/href="\.\.\/((?:styles|css)\/[^"]+\.css)"/g)].map(m => m[1]);
  assert.ok(folhas.includes('styles/utilitarios.css'));
  const css = folhas.map(ler).join('\n');
  const escapar = c => c.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  const existe = c => css.includes(`.${escapar(c)}`) || css.includes(`.${c}`);
  const dinamica = c => /[${}<>()]/.test(c) || /^\d/.test(c) || c.length < 2;
  // Só os utilitários que mexem em distância e tamanho (os que causaram os defeitos).
  const DE_LAYOUT = /^(?:[a-z]+:)*(-?(m|p)[trblxy]?-|gap-|space-[xy]-|w-|h-|min-w-|max-w-|min-h-|max-h-|grid-cols-|col-span-|text-(xs|sm|base|lg|xl|2xl|3xl)|leading-|tracking-|rounded|inset|top-|left-|right-|bottom-|z-|flex-|basis-|order-)/;

  const faltando = new Map();
  for (const f of [...arquivos('html', '.html'), ...arquivos('js', '.js')]) {
    const fonte = fs.readFileSync(f, 'utf8');
    const achadas = new Set();
    for (const m of fonte.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]+)["'`]/g)) m[1].split(/\s+/).forEach(c => achadas.add(c));
    for (const c of achadas) {
      if (!c || dinamica(c) || !DE_LAYOUT.test(c) || existe(c)) continue;
      if (!faltando.has(c)) faltando.set(c, new Set());
      faltando.get(c).add(relativo(f));
    }
  }
  const relato = [...faltando].map(([c, onde]) => `${c} (${[...onde].slice(0, 3).join(', ')})`);
  assert.deepStrictEqual(relato, [], `classes sem CSS — acrescente em src/styles/utilitarios.css:\n${relato.join('\n')}`);
});

test('Fechar e Cancelar dos modais são vermelhos (btn-danger)', () => {
  const botao = /<button\b([^>]*)>\s*(?:<i[^>]*><\/i>\s*)?(Fechar|Cancelar)\s*<\/button>/g;
  const foraDoPadrao = [];
  for (const f of arquivos('html/modals', '.html')) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(botao)) {
      const classes = (m[1].match(/class="([^"]*)"/) || [])[1] || '';
      if (!/\bbtn-danger\b/.test(classes)) foraDoPadrao.push(`${relativo(f)}: ${m[2]} (${classes})`);
    }
  }
  assert.deepStrictEqual(foraDoPadrao, []);
  // Os que não estão em html/modals mas são diálogos.
  assert.match(ler('html/relatorios.html'), /id="relatoriosCancelSaveTemplate" class="btn-danger /);
  assert.match(ler('html/relatorios.html'), /id="relatoriosCancelSchedule" class="btn-danger /);
  assert.match(ler('js/modals/pedido-cancelar.js'), /data-action="cancel" class="btn-danger /);
});

test('Financeiro: Conciliar BB é botão azul escuro à esquerda do Atualizar, e a faixa de texto saiu', () => {
  const html = ler('html/financeiro.html');
  const conciliar = html.indexOf('id="finConciliar"');
  const atualizar = html.indexOf('id="finAtualizar"');
  assert.ok(conciliar > 0 && atualizar > conciliar, 'Conciliar BB vem antes (à esquerda) do Atualizar');
  const tag = html.slice(html.lastIndexOf('<button', conciliar), html.indexOf('</button>', conciliar));
  assert.match(tag, /class="btn-bb /);
  assert.match(tag, /data-fin-acao="conciliar"/);
  assert.match(tag, />\s*(?:<i[^>]*><\/i>\s*)?Conciliar BB\s*$/);
  assert.ok(!/fin-faixa[^"]*conciliar|>\s*Conciliar com o BB\s*</.test(html), 'o texto-link acima de Boletos em aberto não existe mais');
});

test('Novo insumo: liga/desliga de estoque infinito, que vira ∞ e deixa de exigir quantidade', () => {
  const html = ler('html/modals/materia-prima/novo.html');
  assert.match(html, /<input id="infinito"[^>]*type="checkbox"[^>]*class="component-toggle"/);
  // Campo desabilitado não é :valid: sem o peer-disabled o rótulo ficava por cima do ∞.
  const rotulo = html.slice(html.indexOf('<label for="quantidade"'), html.indexOf('</label>', html.indexOf('<label for="quantidade"')));
  assert.match(rotulo, /peer-disabled:top-0 peer-disabled:-translate-y-full peer-disabled:text-xs/);
  const js = ler('js/modals/materia-prima-novo.js');
  assert.ok(js.includes("quantidadeInput.value = '∞'") && js.includes('quantidadeInput.required = false'));
  assert.ok(js.includes('const quantidade = infinito ? null : parseFloat(form.quantidade.value);'), 'infinito grava quantidade nula');
  assert.ok(js.includes('infinito,'), 'e manda o infinito no cadastro');
  const editar = ler('js/modals/materia-prima-editar.js');
  assert.ok(editar.includes("quantidadeInput.type = 'text'") && editar.includes("quantidadeInput.type = 'number'"), 'o Editar troca o tipo do campo para mostrar o ∞');
});

test('(i) do resumo em Prospecções e Usuários usa o posicionador comum', () => {
  for (const arquivo of ['js/prospeccoes.js', 'js/usuarios.js']) {
    const js = ler(arquivo);
    assert.ok(js.includes('window.Popover.abrir('), `${arquivo}: abre pelo window.Popover`);
  }
  assert.ok(ler('js/prospeccoes.js').includes('window.Popover.fechar('));
  assert.ok(MENU.indexOf('../js/utils/popover.js') > 0, 'o utilitário é carregado pelo menu');
});

test('Produto (novo e editar): seta e "x de y preenchidos" da seção fiscal em cinza', () => {
  // O cinza dos rótulos (o do "Preço de Venda"), pela classe da casa.
  for (const arquivo of ['html/modals/produtos/novo.html', 'html/modals/produtos/editar.html']) {
    const html = ler(arquivo);
    assert.match(html, /class="secao-retratil__nota text-gray-400"/, `${arquivo}: a nota`);
    assert.match(html, /class="fas fa-chevron-down secao-retratil__seta text-gray-400"/, `${arquivo}: a seta`);
  }
  // E a folha não pinta por cima (o --color-pen do produtos.css é AZUL).
  const css = ler('styles/secao-retratil.css');
  for (const seletor of ['.secao-retratil__nota {', '.secao-retratil__seta {']) {
    const regra = css.slice(css.indexOf(seletor), css.indexOf('}', css.indexOf(seletor)));
    assert.ok(regra.length > 0 && !/\bcolor\s*:/.test(regra), `${seletor} sem cor própria`);
  }
});

test('botões do Banco do Brasil: azul escuro (btn-bb, global) no Financeiro e em Pedidos', () => {
  const css = ler('css/menu.css');
  assert.match(css, /\.btn-bb \{\s*background: #1e3a8a;/, 'o mesmo azul escuro do Regra Produção, no menu.css (global)');
  const alvos = [
    ['html/financeiro.html', 'finConciliar'],
    ['html/modals/financeiro/recebimentos.html', 'finRecebimentosConciliar'],
    ['html/modals/financeiro/configuracao-cobranca.html', 'finCobTestar'],
    ['html/modals/financeiro/configuracao-cobranca.html', 'finCobWebhookConciliar'],
    ['html/modals/pedidos/boleto-detalhe.html', 'boletoDetalheSincronizar'],
    ['html/modals/pedidos/gerar-boletos.html', 'consultarBoletosBB']
  ];
  for (const [arquivo, id] of alvos) {
    const html = ler(arquivo);
    const inicio = html.indexOf(`id="${id}"`);
    const tag = html.slice(inicio, html.indexOf('>', inicio));
    assert.match(tag, /class="(hidden )?btn-bb /, `${arquivo}#${id}`);
  }
  // Nenhum outro botão com "BB" no texto ficou de fora.
  for (const f of arquivos('html', '.html')) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/<button\b([^>]*)>([^<]*\bBB\b[^<]*)<\/button>/g)) {
      assert.match(m[1], /\bbtn-bb\b/, `${relativo(f)}: ${m[2].trim()}`);
    }
  }
});

test('Ver relatório / Ver itens: azul claro (btn-secondary)', () => {
  for (const [arquivo, trecho] of [
    ['html/modals/financeiro/aguardando-nfe.html', 'data-fin-relatorio="aguardando-nf"'],
    ['html/modals/financeiro/comissoes-atrasadas.html', 'data-fin-relatorio="comissoes-atrasadas"'],
    ['html/modals/financeiro/producao-competencia.html', 'id="finProdCompRelatorio"'],
    ['html/modals/financeiro/fechar-competencia.html', 'id="finFechamentoVerItens"']
  ]) {
    const html = ler(arquivo);
    const tag = html.slice(html.indexOf(trecho), html.indexOf('>', html.indexOf(trecho)));
    assert.match(tag, /class="btn-secondary /, arquivo);
  }
});

test('Fechar competência — produção: Tudo verde, Nada vermelho, Tudo pronto verde e o código da peça em etiqueta bordô', () => {
  const js = ler('js/modals/financeiro-modais.js');
  assert.ok(js.includes("criar('button', 'btn-success px-3 py-1 rounded-md text-xs font-medium', 'Tudo')"), 'Tudo verde');
  assert.ok(js.includes("criar('button', 'btn-danger text-white px-3 py-1 rounded-md text-xs font-medium', 'Nada')"), 'Nada vermelho');
  assert.ok(js.includes("criar('button', 'btn-success px-3 py-1 rounded-md text-xs font-medium', 'Tudo pronto neste pedido')"), 'Tudo pronto verde');
  assert.match(js, /const codigo = criar\('span', 'fin-tag-produto fin-tag-produto--bordo', peca\.codigo \|\| nomeInteiro\);\s*codigo\.title = nomeInteiro;/, 'só o código; o nome inteiro no hover');
  assert.match(ler('css/financeiro.css'), /\.fin-tag-produto--bordo \{[^}]*background: #6a152c;/);
});
