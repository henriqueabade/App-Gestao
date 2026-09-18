/**
 * Caixa de diálogo padrão (src/components/dialogPadrao.js).
 *
 * Duas partes: o formatador que organiza o texto das chamadas antigas
 * (`estruturarTexto`, puro) e o desenho da caixa — ícone do tom, cartões de
 * resumo, seções, alerta, nota e botões —, exercitado com um DOM mínimo.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', '..');
const SCRIPT = fs.readFileSync(path.join(SRC, 'components', 'dialogPadrao.js'), 'utf8');

// ------------------------------------------------------------ DOM mínimo

function criarElemento(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), className: '', id: '', title: '', type: '',
    style: {}, atributos: {}, filhos: [], pai: null, ouvintes: {}, _texto: '', aberto: false,
    get childNodes() { return el.filhos; },
    get textContent() { return el._texto + el.filhos.map(f => f.textContent).join(''); },
    set textContent(v) { el._texto = String(v); el.filhos = []; },
    setAttribute(k, v) { el.atributos[k] = String(v); },
    getAttribute(k) { return el.atributos[k] ?? null; },
    appendChild(filho) {
      if (filho.fragmento) { for (const f of [...filho.filhos]) el.appendChild(f); return filho; }
      filho.pai = el; el.filhos.push(filho); return filho;
    },
    append(...filhos) { filhos.forEach(f => el.appendChild(f)); },
    remove() { if (el.pai) el.pai.filhos = el.pai.filhos.filter(f => f !== el); el.pai = null; },
    addEventListener(tipo, fn) { (el.ouvintes[tipo] ||= []).push(fn); },
    showModal() { el.aberto = true; },
    close() { el.aberto = false; },
    focus() { documento.focado = el; },
    todos() { return el.filhos.flatMap(f => [f, ...f.todos()]); },
    porClasse(classe) { return el.todos().filter(f => String(f.className).split(/\s+/).includes(classe)); }
  };
  return el;
}

const documento = {
  body: criarElemento('body'),
  focado: null,
  createElement: criarElemento,
  createDocumentFragment() { const f = criarElemento('#fragment'); f.fragmento = true; return f; },
  querySelectorAll: sel => (sel === 'dialog[data-dialog-padrao]' ? documento.body.filhos.filter(f => f.tagName === 'DIALOG') : [])
};

function carregar() {
  documento.body.filhos = [];
  const janela = {};
  const contexto = { window: janela, document: documento, Promise, Date, String, Array, Object, RegExp };
  vm.createContext(contexto);
  vm.runInContext(SCRIPT, contexto);
  return janela.DialogPadrao;
}

const plano = v => JSON.parse(JSON.stringify(v));
const dialogoAberto = () => documento.body.filhos.find(f => f.tagName === 'DIALOG');

// ------------------------------------------------------------ formatador

test('estruturarTexto: frase curta fica como texto; linha em branco separa blocos', () => {
  const { estruturarTexto } = carregar();
  assert.deepStrictEqual(plano(estruturarTexto('Processo concluído.')), [{ tipo: 'texto', linhas: ['Processo concluído.'] }]);
  assert.deepStrictEqual(plano(estruturarTexto('')), []);
  const dois = plano(estruturarTexto('Primeiro parágrafo.\n\nSegundo parágrafo.'));
  assert.deepStrictEqual(dois.map(b => b.tipo), ['texto', 'texto']);
});

test('estruturarTexto: "Título:" + marcadores vira seção com lista; "Rótulo: valor" vira pares', () => {
  const { estruturarTexto } = carregar();
  const lista = plano(estruturarTexto('Não convertidos (revisão cancelada):\n• ORC101\n• ORC102'));
  assert.deepStrictEqual(lista, [{ tipo: 'lista', titulo: 'Não convertidos (revisão cancelada)', itens: ['ORC101', 'ORC102'] }]);

  const pares = plano(estruturarTexto('Peça: POL-01 — Poltrona\nBase do %: R$ 1.000,00 (tabela fixa)'));
  assert.deepStrictEqual(pares, [{ tipo: 'itens', titulo: null, itens: [
    { rotulo: 'Peça', valor: 'POL-01 — Poltrona' }, { rotulo: 'Base do %', valor: 'R$ 1.000,00 (tabela fixa)' }
  ] }]);

  const misto = plano(estruturarTexto('Tem certeza que deseja converter estes 2 orçamentos?\n• ORC1\n• ORC2'));
  assert.deepStrictEqual(misto.map(b => b.tipo), ['texto', 'lista']);
});

test('estruturarTexto: a frase de "não tem volta" sai do texto e vai para o quadro de alerta', () => {
  const { estruturarTexto } = carregar();
  const blocos = plano(estruturarTexto('R$ 1.000,00 recebidos na parcela 1. O boleto 123 será BAIXADO no Banco do Brasil e não poderá mais ser pago. Não tem volta.'));
  assert.deepStrictEqual(blocos, [
    { tipo: 'texto', linhas: ['R$ 1.000,00 recebidos na parcela 1.'] },
    { tipo: 'alerta', texto: 'O boleto 123 será BAIXADO no Banco do Brasil e não poderá mais ser pago. Não tem volta.' }
  ]);
});

// ------------------------------------------------------------ desenho

test('caixa informativa: ícone e cor do tom, título, subtítulo e frase curta centralizada', async () => {
  const D = carregar();
  const promessa = D.info({ title: 'Tudo certo', subtitle: 'Conciliação', message: 'Nenhum boleto mudou.', tom: 'sucesso' });
  const dialogo = dialogoAberto();
  assert.ok(dialogo && dialogo.aberto, 'abre na top layer (showModal)');
  const cartao = dialogo.porClasse('dlg-cartao')[0];
  assert.match(cartao.className, /dlg-cartao--sucesso/);
  assert.match(dialogo.porClasse('dlg-icone')[0].filhos[0].className, /fa-circle-check/);
  assert.strictEqual(dialogo.porClasse('dlg-titulo')[0].textContent, 'Tudo certo');
  assert.strictEqual(dialogo.porClasse('dlg-subtitulo')[0].textContent, 'Conciliação');
  assert.strictEqual(dialogo.porClasse('dlg-lead')[0].textContent, 'Nenhum boleto mudou.');
  assert.strictEqual(dialogo.style.width, 'min(30rem, calc(100vw - 2rem))', 'caixa simples: largura normal');
  const ok = dialogo.todos().find(e => 'data-confirm' in e.atributos);
  assert.match(ok.className, /btn-primary/);
  assert.strictEqual(documento.focado, ok, 'o foco vai para o OK');
  ok.onclick();
  assert.strictEqual(await promessa, true);
  assert.strictEqual(dialogoAberto(), undefined, 'fecha e sai do documento');
});

test('caixa estruturada: cartões de resumo, seções com pares e lista, alerta e nota; fica larga', () => {
  const D = carregar();
  D.info({
    title: 'Conciliação com o BB', tom: 'aviso', icone: 'fa-building-columns',
    resumo: [{ rotulo: 'Boletos consultados', valor: '5' }, { rotulo: 'Pagamentos', valor: '2', tom: 'sucesso' }],
    secoes: [
      { titulo: 'Consulta ao BB', icone: 'fa-magnifying-glass', itens: [{ rotulo: 'Pagos', valor: '2', tom: 'sucesso' }, { rotulo: 'Com erro', valor: '1', tom: 'erro', detalhe: 'BB respondeu 503' }] },
      { titulo: 'Ocorrências', lista: ['Boleto 000312: O BB respondeu 503'] }
    ],
    alerta: 'Rode o SQL.', nota: 'A tela já foi atualizada.'
  });
  const dialogo = dialogoAberto();
  assert.strictEqual(dialogo.style.width, 'min(40rem, calc(100vw - 2rem))');
  assert.match(dialogo.porClasse('dlg-icone')[0].filhos[0].className, /fa-building-columns/, 'o ícone próprio vence o do tom');
  const cartoes = dialogo.porClasse('dlg-resumo__cartao');
  assert.deepStrictEqual(cartoes.map(c => c.textContent), ['Boletos consultados5', 'Pagamentos2']);
  assert.match(dialogo.porClasse('dlg-resumo__valor')[1].className, /dlg-valor--sucesso/);
  assert.deepStrictEqual(dialogo.porClasse('dlg-secao__titulo').map(t => t.textContent), ['Consulta ao BB', 'Ocorrências']);
  const itens = dialogo.porClasse('dlg-item');
  assert.strictEqual(itens.length, 2);
  assert.match(dialogo.porClasse('dlg-item__valor')[1].className, /dlg-valor--erro/);
  assert.strictEqual(dialogo.porClasse('dlg-item__detalhe')[0].textContent, 'BB respondeu 503');
  assert.strictEqual(dialogo.porClasse('dlg-lista')[0].filhos.length, 1);
  assert.strictEqual(dialogo.porClasse('dlg-alerta')[0].textContent, 'Rode o SQL.');
  assert.strictEqual(dialogo.porClasse('dlg-nota')[0].textContent, 'A tela já foi atualizada.');
});

test('confirmação: tom de pergunta, Cancelar neutro, Confirmar na cor pedida; Esc cancela', async () => {
  const D = carregar();
  const promessa = D.confirm({ title: 'Confirmar cancelamento', message: 'x', confirmText: 'Confirmar cancelamento', cancelText: 'Voltar', confirmVariant: 'danger' });
  const dialogo = dialogoAberto();
  assert.match(dialogo.porClasse('dlg-cartao')[0].className, /dlg-cartao--pergunta/);
  const botoes = dialogo.porClasse('dlg-rodape')[0].filhos;
  assert.deepStrictEqual(botoes.map(b => [b.textContent, b.className]), [['Confirmar cancelamento', 'btn-danger'], ['Voltar', 'btn-neutral']]);
  dialogo.ouvintes.cancel[0]({ preventDefault() {} });
  assert.strictEqual(await promessa, false);

  D.confirm({ title: 'Registrar?', message: 'y' });
  assert.strictEqual(dialogoAberto().porClasse('dlg-rodape')[0].filhos[0].className, 'btn-warning', 'sem pedido, o vinho de sempre');
});

test('uma caixa por vez, e o texto vai como texto (nada de HTML injetado)', () => {
  const D = carregar();
  D.info({ title: 'Primeira', message: 'a' });
  D.info({ title: '<b>Segunda</b>', message: '<img src=x onerror=alert(1)>' });
  const dialogos = documento.body.filhos.filter(f => f.tagName === 'DIALOG');
  assert.strictEqual(dialogos.length, 1);
  assert.strictEqual(dialogos[0].porClasse('dlg-titulo')[0].textContent, '<b>Segunda</b>');
  assert.ok(!/innerHTML/.test(SCRIPT), 'o componente monta tudo com textContent');
});

test('a folha da caixa é global e as caixas informativas do app usam o componente', () => {
  const menu = fs.readFileSync(path.join(SRC, 'html', 'menu.html'), 'utf8');
  assert.ok(menu.indexOf('../styles/dialogo-padrao.css') > 0 && menu.indexOf('../styles/dialogo-padrao.css') < menu.indexOf('../components/dialogPadrao.js'));
  // As caixas antigas, montadas à mão só com texto, saíram.
  const ANTIGAS = /funcUnavailableOk|blockedOk|missingOk|pieceApprovedOk|pdfUnavailableOk|pdfConvert|id="errOk"/;
  const arquivos = [];
  (function andar(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) { if (!/__tests__/.test(p)) andar(p); } else if (n.endsWith('.js')) arquivos.push(p);
    }
  })(path.join(SRC, 'js'));
  const restantes = arquivos.filter(f => ANTIGAS.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(SRC, f));
  assert.deepStrictEqual(restantes, []);
  // alert() do sistema nas telas que avisam "em desenvolvimento" / "escolha o país".
  for (const rel of ['js/calendario.js', 'js/clientes.js', 'js/laminacao-clientes.js', 'js/modals/cliente-novo.js', 'js/modals/cliente-editar.js']) {
    assert.ok(!/(^|[^.\w])alert\(/m.test(fs.readFileSync(path.join(SRC, rel), 'utf8')), `${rel}: sem alert() do sistema`);
  }
  // Os dois exemplos: Conciliação com o BB e Regra Produção vêm estruturados.
  assert.match(fs.readFileSync(path.join(SRC, 'js', 'financeiro.js'), 'utf8'), /await window\.DialogPadrao\.info\(caixa\);/);
  for (const rel of ['js/modals/produto-editar.js', 'js/modals/produto-novo.js']) {
    assert.match(fs.readFileSync(path.join(SRC, rel), 'utf8'), /title: 'Regra Produção',\s*\.\.\.regra\.caixa\(/);
  }
});
