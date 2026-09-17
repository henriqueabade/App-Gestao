/**
 * Cadastro de peça: "Desenhado por" (lista de desenhistas com + e −) e a
 * "Regra Produção" (src/js/utils/produto-regra-producao.js), nos modais Novo
 * e Editar produto.
 *
 * O que se prende: os dois modais têm a mesma linha do processo (mesmos
 * tamanhos) com "Regra Produção" à direita do "+ Começar" e o (i); o
 * desenhista e a regra são condição para salvar e vão para o backend; a
 * regra conta só os processos da ficha, respeita o padrão, o valor próprio
 * (R$ ou % da tabela fixa) e o pagamento desligado.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const plano = v => JSON.parse(JSON.stringify(v));

const MODAIS = [
  { nome: 'Novo produto', html: ler('html', 'modals', 'produtos', 'novo.html'), js: ler('js', 'modals', 'produto-novo.js'), sufixo: 'Novo', comecar: 'comecarNovoProduto' },
  { nome: 'Editar produto', html: ler('html', 'modals', 'produtos', 'editar.html'), js: ler('js', 'modals', 'produto-editar.js'), sufixo: 'Editar', comecar: 'comecarEditarProduto' }
];

/** As classes de um elemento pelo id. */
const classesDe = (html, id) => (new RegExp(`id="${id}"[^>]*class="([^"]+)"`).exec(html) || new RegExp(`class="([^"]+)"[^>]*id="${id}"`).exec(html) || [])[1];

test('os dois modais: Desenhado por com + e − (permissões próprias) e a mesma linha do processo', () => {
  for (const m of MODAIS) {
    assert.match(m.html, /<select id="desenhistaSelect" name="desenhado_por" required/, `${m.nome}: desenhista obrigatório`);
    assert.match(m.html, new RegExp(`id="addDesenhista${m.sufixo}" data-perm="prod\\.designer\\.create"`), `${m.nome}: + pede Incluir desenhista`);
    assert.match(m.html, new RegExp(`id="delDesenhista${m.sufixo}" data-perm="prod\\.designer\\.delete"`), `${m.nome}: − pede Excluir desenhista`);
    const linha = new RegExp(`id="${m.comecar}"[^>]*>\\+ Começar</button>\\s*<button id="regraProducao${m.sufixo}" type="button" class="btn-regra-producao px-6 py-3 rounded-lg font-medium"[^>]*>Regra Produção</button>\\s*<!--[^>]*-->\\s*<span id="regraProducaoInfoCaixa${m.sufixo}" class="hidden">\\s*<button id="regraProducaoInfo${m.sufixo}" type="button" class="btn-neutral icon-only`);
    assert.match(m.html, linha, `${m.nome}: Regra Produção à direita do + Começar, e o (i) escondido até a regra estar completa`);
    assert.match(m.html, new RegExp(`id="regraProducaoStatus${m.sufixo}"`));
  }
  const [novo, editar] = MODAIS;
  assert.strictEqual(classesDe(novo.html, 'etapaSelect'), classesDe(editar.html, 'etapaSelect'), 'a caixa do processo tem o mesmo tamanho nos dois');
  assert.strictEqual(classesDe(novo.html, 'comecarNovoProduto'), classesDe(editar.html, 'comecarEditarProduto'), 'o + Começar tem o mesmo tamanho nos dois');
  assert.match(classesDe(novo.html, 'etapaSelect'), /flex-1 min-w-\[200px\]/);
  assert.match(ler('css', 'menu.css'), /\.btn-regra-producao \{\s*background: #1e3a8a;/, 'azul escuro, global (o modal abre também fora de Produtos)');
});

test('o desenhista e a regra vão para o backend e são condição para salvar (e o clone leva os dois)', () => {
  const [novo, editar] = MODAIS;
  assert.match(novo.js, /adicionarProduto\(\{[\s\S]*?desenhado_por: desenhadoPor,/);
  assert.match(novo.js, /salvarProdutoDetalhado\(codigo, \{[\s\S]*?desenhado_por: desenhadoPor,/);
  assert.match(novo.js, /if \(!desenhistaValido\(\)\) \{\s*throw new Error\('Escolha quem desenhou a peça \(Desenhado por\)\.'\);/);
  assert.match(novo.js, /const faltamRegra = controleRegra\.pendencias\(\);\s*if \(faltamRegra\.length\) \{\s*throw new Error/);
  assert.match(novo.js, /await controleRegra\.gravar\(produtoId\)/, 'a regra é gravada depois da peça, com o id');
  assert.match(novo.js, /Antes da Regra Produção, preencha:/);

  assert.match(editar.js, /const controleRegra = await conferirDesenhistaERegra\(\);\s*const resultado = await window\.electronAPI\.salvarProdutoDetalhado\(/);
  assert.match(editar.js, /const avisoRegra = await gravarRegra\(controleRegra, produtoSelecionado\.id, 'A peça foi salva'\);/);
  assert.match(editar.js, /if \(desenhistaSelect && !desenhistaSelect\.disabled\) produto\.desenhado_por = desenhistaSelect\.value\.trim\(\);/);
  assert.match(editar.js, /const desenhistaLivre = editable \|\| !String\(registroOriginal\.desenhado_por \|\| ''\)\.trim\(\);/, 'peça antiga sem desenhista pode escolher um sem o botão de registro');
  // Clonar
  assert.match(editar.js, /const produtoCriado = await window\.electronAPI\.adicionarProduto\(\{\s*codigo: cloneCodigo,\s*nome: cloneNome,\s*desenhado_por: desenhadoPor,/);
  assert.match(editar.js, /const avisoRegraClone = await gravarRegra\(controleRegra, produtoCriado\?\.id, 'A cópia foi criada'\);/);

  for (const m of MODAIS) {
    assert.match(m.js, /Modal\.open\('modals\/produtos\/regra-producao\.html', '\.\.\/js\/modals\/produto-regra-producao\.js', 'regraProducaoPeca', true\)/);
    assert.match(m.js, /Modal\.open\('modals\/produtos\/desenhista-novo\.html', '\.\.\/js\/modals\/produto-desenhista-novo\.js', 'novoDesenhista', true\)/);
    assert.match(m.js, /window\.removeEventListener\('desenhistaAtualizado', handleDesenhistaAtualizado\)/, `${m.nome}: solta o ouvinte ao fechar`);
    assert.match(m.js, /window\.DialogPadrao\?\.info\(\{\s*title: 'Regra Produção',/, `${m.nome}: o (i) mostra o resumo`);
  }
});

test('modais de desenhista e da regra: sem innerHTML, Esc fecha só o de cima, rodapé só com texto', () => {
  for (const arquivo of ['produto-regra-producao.js', 'produto-desenhista-novo.js', 'produto-desenhista-excluir.js']) {
    const js = ler('js', 'modals', arquivo);
    assert.ok(!/innerHTML/.test(js), `${arquivo}: nada de innerHTML`);
    assert.match(js, /window\.addEventListener\('keydown', esc, true\)/, `${arquivo}: Esc na captura`);
    assert.match(js, /e\.stopPropagation\(\)/);
  }
  for (const arquivo of ['regra-producao.html', 'desenhista-novo.html', 'desenhista-excluir.html']) {
    const html = ler('html', 'modals', 'produtos', arquivo);
    const rodape = (/<footer[\s\S]*?<\/footer>/.exec(html) || [''])[0];
    assert.ok(rodape && !/<i class="fas/.test(rodape), `${arquivo}: rodapé só com texto`);
  }
  assert.match(ler('html', 'modals', 'produtos', 'desenhista-excluir.html'), /id="excluirDesenhista" data-perm="prod\.designer\.delete"/);
  assert.match(ler('html', 'modals', 'produtos', 'desenhista-novo.html'), /data-perm="prod\.designer\.create" form="novoDesenhistaForm"/);
});

// ---------------------------------------------------------------------------
// O utilitário da regra, rodado com um fetch de mentira.

function carregarUtil({ base, respostas = {} } = {}) {
  const chamadas = [];
  const sandbox = {
    console, Intl, Number, Math, String, Array, Map, Object, JSON, Promise, encodeURIComponent,
    window: {},
    fetch: async (url, opcoes = {}) => {
      chamadas.push({ url, metodo: opcoes.method || 'GET', corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
      const caminho = url.replace('http://api', '');
      const corpo = opcoes.method === 'PUT' ? (respostas.put || { completa: true, faltam: [] }) : base;
      return { ok: !(respostas.status >= 400), status: respostas.status || 200, json: async () => (respostas.status >= 400 ? respostas.erro : corpo), caminho };
    }
  };
  sandbox.window = sandbox;
  sandbox.apiConfig = { getApiBaseUrl: async () => 'http://api' };
  vm.createContext(sandbox);
  vm.runInContext(ler('js', 'utils', 'produto-regra-producao.js'), sandbox, { filename: 'produto-regra-producao.js' });
  return { R: sandbox.RegraProducaoPeca, chamadas };
}

const BASE = {
  produto_id: 10,
  preco_tabela: 1000,
  etapas: [
    { id: 1, nome: 'Marcenaria', ordem: 1, producao_ativa: true, padrao: { tipo: 'percentual', percentual: 10, valor: null, origem: 'padrao' }, da_peca: null },
    { id: 2, nome: 'Acabamento', ordem: 2, producao_ativa: true, padrao: null, da_peca: { tipo: 'valor', valor: 25, percentual: null, origem: 'peca' } },
    { id: 3, nome: 'Montagem', ordem: 3, producao_ativa: true, padrao: null, da_peca: null },
    { id: 4, nome: 'Embalagem', ordem: 4, producao_ativa: false, padrao: null, da_peca: null }
  ]
};

const ITENS = [
  { nome: 'MDF', processo: 'Marcenaria' }, { nome: 'Cola', processo: 'marcenária' }, { nome: 'Velho', processo: 'Marcenaria', status: 'deleted' },
  { nome: 'Verniz', processo: 'Acabamento' },
  { nome: 'Parafuso', processo: 'Montagem' },
  { nome: 'Caixa', processo: 'Embalagem' },
  { nome: 'Tinta', processo: 'Pintura' }
];

test('regra da peça: processos da ficha, padrão, valor próprio, pagamento desligado e processo não cadastrado', async () => {
  const { R, chamadas } = carregarUtil({ base: BASE });
  assert.deepStrictEqual(plano(R.processosDosItens(ITENS)), [
    { nome: 'Marcenaria', insumos: 2 }, { nome: 'Acabamento', insumos: 1 }, { nome: 'Montagem', insumos: 1 }, { nome: 'Embalagem', insumos: 1 }, { nome: 'Pintura', insumos: 1 }
  ], 'o excluído não conta; acento e caixa não separam');
  assert.strictEqual(R.lerNumero('R$ 1.234,56'), 1234.56);
  assert.strictEqual(R.lerNumero('7,5%'), 7.5);
  assert.strictEqual(R.erroDaEscolha({ modo: 'percentual', valor: '120' }), 'o percentual vai de 0 a 100');
  assert.strictEqual(R.erroDaEscolha({ modo: 'valor', valor: '' }), 'informe o valor em reais');
  assert.strictEqual(R.valorDaPeca({ tipo: 'percentual', percentual: 10 }, null), null, '% sem preço de tabela: sem valor');

  let mudou = 0;
  const controle = R.criar({ produtoId: 10, obterItens: () => ITENS, obterPreco: () => 1000, aoMudar: () => { mudou += 1; } });
  await controle.carregar();
  assert.ok(mudou >= 1);
  assert.strictEqual(chamadas[0].url, 'http://api/api/financeiro/regra-producao?produto_id=10');
  const linhas = controle.linhas();
  assert.deepStrictEqual(plano(linhas.map(l => [l.nome, l.origem, l.valor_peca, l.falta])), [
    ['Marcenaria', 'padrao', 100, ''],
    ['Acabamento', 'peca', 25, ''],
    ['Montagem', null, null, 'sem valor próprio nem padrão'],
    ['Embalagem', null, null, ''],
    ['Pintura', null, null, 'processo não cadastrado']
  ]);
  assert.deepStrictEqual(plano(controle.pendencias().map(p => p.nome)), ['Montagem', 'Pintura']);

  // Montagem em 5% da tabela fixa; a Pintura sai da ficha.
  controle.definirRascunho(new Map([...controle.rascunho(), ['3', { modo: 'percentual', valor: '5' }]]));
  const semPintura = ITENS.filter(i => i.processo !== 'Pintura');
  const outro = R.criar({ produtoId: 10, obterItens: () => semPintura, obterPreco: () => 1000 });
  await outro.carregar();
  outro.definirRascunho(controle.rascunho());
  assert.deepStrictEqual(plano(outro.pendencias()), []);
  const resumo = outro.resumo({ codigo: 'POL-01', nome: 'Poltrona' });
  assert.match(resumo, /Peça: POL-01 — Poltrona/);
  assert.match(resumo, /Base do %: R\$\s1\.000,00 \(tabela fixa\)/);
  assert.match(resumo, /Marcenaria \(2 insumos\): 10% da tabela fixa \(padrão do processo\) → R\$\s100,00 por peça inteira; cada insumo vale R\$\s50,00/);
  assert.match(resumo, /Montagem \(1 insumo\): 5% da tabela fixa \(desta peça\) → R\$\s50,00 por peça inteira/);
  assert.match(resumo, /Embalagem \(1 insumo\): pagamento desligado/);

  await outro.gravar(10);
  const put = chamadas.find(c => c.metodo === 'PUT');
  assert.strictEqual(put.url, 'http://api/api/financeiro/regra-producao/10');
  assert.deepStrictEqual(put.corpo, { valores: [
    { etapa_id: 1, modo: 'padrao' },
    { etapa_id: 2, modo: 'valor', valor: '25' },
    { etapa_id: 3, modo: 'percentual', valor: '5' },
    { etapa_id: 4, modo: 'padrao' }
  ] }, 'o valor próprio lido do banco volta como está; o padrão manda "padrao"');
});

test('regra da peça: sem o SQL, a pendência diz qual arquivo rodar', async () => {
  const { R } = carregarUtil({ respostas: { status: 409, erro: { error: 'Falta rodar sql/desenhistas_producao_parcela.sql no banco e reiniciar a API.', sql_pendente: true } } });
  const controle = R.criar({ obterItens: () => ITENS });
  await controle.carregar();
  assert.ok(controle.erro());
  assert.match(controle.pendencias()[0].falta, /desenhistas_producao_parcela\.sql/);
});
