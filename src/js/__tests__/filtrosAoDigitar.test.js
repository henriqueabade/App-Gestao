/**
 * Rodada de 08/10/2026 (pedidos do dono):
 *   - toda caixa de texto de filtro pesquisa enquanto se digita, sem "Filtrar";
 *   - "Filtros avançados" retráteis em Produtos, Orçamentos e Pedidos (o
 *     padrão de Prospecções), com o cliente / pedido / peça;
 *   - Fechar competência — produção: barra de filtro retraída e a tela parada
 *     ao confirmar uma peça;
 *   - o menu lateral rola quando passa da altura, sem mudar largura nenhuma.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', '..');
const ler = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');

function carregarUtil(rel) {
    const contexto = { window: {}, console, setTimeout, clearTimeout };
    vm.createContext(contexto);
    vm.runInContext(ler(rel), contexto);
    return contexto.window;
}

test('os utilitários entram no menu (script e folha)', () => {
    const menu = ler('html/menu.html');
    assert.ok(menu.includes('src="../js/utils/busca-ao-digitar.js"'));
    assert.ok(menu.includes('src="../js/utils/filtros-avancados.js"'));
    assert.ok(menu.includes('href="../styles/filtros-avancados.css"'));
    // controles.css continua por último entre as folhas globais.
    assert.ok(menu.indexOf('filtros-avancados.css') < menu.indexOf('controles.css'));
});

test('BuscaAoDigitar: termos sem acento e caixa; todos têm de casar em algum texto', () => {
    const { BuscaAoDigitar } = carregarUtil('js/utils/busca-ao-digitar.js');
    assert.deepStrictEqual(Array.from(BuscaAoDigitar.termos('  Jackie   Pietrá ')), ['jackie', 'pietra']);
    assert.strictEqual(BuscaAoDigitar.casa(['jackie', 'pietra'], 'PED1', ['Jackie', ['Platter Pietra - M']]), true);
    assert.strictEqual(BuscaAoDigitar.casa(['jackie', 'onix'], 'PED1', 'Jackie', 'Platter Pietra'), false);
    assert.strictEqual(BuscaAoDigitar.casa([], 'qualquer'), true);
});

test('BuscaAoDigitar.ligar: espera a pausa na digitação; Enter não espera; ligar duas vezes não duplica', async () => {
    const { BuscaAoDigitar } = carregarUtil('js/utils/busca-ao-digitar.js');
    const ouvintes = {};
    const campo = { dataset: {}, addEventListener: (ev, fn) => { (ouvintes[ev] = ouvintes[ev] || []).push(fn); } };
    let vezes = 0;
    BuscaAoDigitar.ligar(campo, () => { vezes += 1; }, { espera: 20 });
    BuscaAoDigitar.ligar(campo, () => { vezes += 100; }, { espera: 20 });
    assert.strictEqual(ouvintes.input.length, 1);
    ouvintes.input[0](); ouvintes.input[0](); ouvintes.input[0]();
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(vezes, 1, 'três teclas seguidas, um filtro só');
    ouvintes.keydown[0]({ key: 'Enter', preventDefault() {} });
    assert.strictEqual(vezes, 2);
});

test('toda caixa de texto de filtro dos módulos filtra enquanto digita', () => {
    // [arquivo, id do campo, como filtra]
    const casos = [
        ['js/clientes.js', 'filtroBusca', /BuscaAoDigitar\?\.ligar\(document\.getElementById\('filtroBusca'\)/],
        ['js/contatos.js', 'filtroBusca', /BuscaAoDigitar\?\.ligar\(document\.getElementById\('filtroBusca'\)/],
        ['js/laminacao-clientes.js', 'filtroBusca', /BuscaAoDigitar\?\.ligar\(document\.getElementById\('filtroBusca'\)/],
        ['js/ia.js', 'filtroBuscaIA', /BuscaAoDigitar\?\.ligar\(document\.getElementById\('filtroBuscaIA'\)/],
        ['js/materia-prima.js', 'materiaPrimaSearch', /getElementById\('materiaPrimaSearch'\)\?\.addEventListener\('input'/],
        ['js/produtos.js', 'filterSearch', /getElementById\('filterSearch'\)\?\.addEventListener\('input'/],
        ['js/prospeccoes.js', 'filtroBusca', /getElementById\('filtroBusca'\)\?\.addEventListener\('input'/],
        ['js/usuarios.js', 'filtroBusca', /getElementById\('filtroBusca'\)\?\.addEventListener\('input'/],
        ['js/tarefas.js', 'tarefasBusca', /\$\('tarefasBusca'\)\.addEventListener\('input'/]
    ];
    for (const [arquivo, id, padrao] of casos) assert.match(ler(arquivo), padrao, `${arquivo} (#${id})`);
    // O IA não volta a filtrar só no Enter.
    assert.ok(!/filtroBuscaIA'\)\?\.addEventListener\('keydown'/.test(ler('js/ia.js')));
    // Contatos também não.
    assert.ok(!/filtroBusca'\)\?\.addEventListener\('keydown'/.test(ler('js/contatos.js')));
    // Os valores mínimo/máximo (Prospecções) e o preço (Produtos) também.
    assert.match(ler('js/prospeccoes.js'), /BuscaAoDigitar\.ligar\(campo, aplicarFiltros/);
    assert.match(ler('js/produtos.js'), /BuscaAoDigitar\.ligar\(campo, \(\) => aplicarFiltro\(true\)/);
    // Importar boletos: a busca de pedido também, sem misturar respostas atrasadas.
    const boletos = ler('js/modals/pedido-importar-boletos.js');
    assert.match(boletos, /BuscaAoDigitar\.ligar\(buscaEl, procurarParcelas/);
    assert.match(boletos, /if \(minha !== senhaDaBusca\) return;/);
});

test('as buscas dos modais (Financeiro, Contabilidade, Pedidos) já filtravam enquanto digita', () => {
    const fin = ler('js/modals/financeiro-modais.js');
    for (const nome of ['finRecebimentosBusca', 'finNotasBusca', 'finAguardNfeBusca', 'finAtividadeBusca', 'finProducaoPedidoBusca', 'finRecebimentoBusca']) {
        assert.ok(fin.includes(`el('${nome}')`), nome);
    }
    assert.match(ler('js/modals/pedido-converter-orcamentos.js'), /busca\??\.addEventListener\('input'/);
    const ctb = ler('js/modals/contabilidade-modais.js');
    assert.ok((ctb.match(/busca\.addEventListener\('input'/g) || []).length >= 12, 'as 13 buscas da Contabilidade');
});

test('Filtros avançados em Produtos, Orçamentos e Pedidos: nascem retraídos, com a setinha, no card de filtros', () => {
    const casos = [
        ['html/produtos.html', 'btnFiltrosAvancadosProdutos', 'produtosFiltrosAvancados', 'filtroVinculoProdutos'],
        ['html/orcamentos.html', 'btnFiltrosAvancadosOrcamentos', 'orcamentosFiltrosAvancados', 'filtroAvancadoOrcamentos'],
        ['html/pedidos.html', 'btnFiltrosAvancadosPedidos', 'pedidosFiltrosAvancados', 'filtroAvancadoPedidos']
    ];
    for (const [arquivo, botao, painel, campo] of casos) {
        const html = ler(arquivo);
        assert.match(html, new RegExp(`id="${botao}"[^>]*aria-expanded="false"[^>]*aria-controls="${painel}"`), arquivo);
        assert.match(html, new RegExp(`id="${painel}" class="filtros-avancados" aria-hidden="true"`), arquivo);
        assert.ok(html.includes('botao-filtros-avancados__seta'), `${arquivo}: setinha`);
        assert.ok(html.includes(`id="${campo}" type="search"`), `${arquivo}: campo`);
        // O painel mora DENTRO do card de filtros, logo depois da barra.
        const painelEm = html.indexOf(`id="${painel}"`);
        const tabela = html.indexOf('TableWrapper');
        assert.ok(painelEm > html.indexOf('filter-bar') && painelEm < tabela, `${arquivo}: painel no card de filtros`);
    }
    for (const [arquivo, campo] of [['js/produtos.js', 'filtroVinculoProdutos'], ['js/orcamentos.js', 'filtroAvancadoOrcamentos'], ['js/pedidos.js', 'filtroAvancadoPedidos']]) {
        const js = ler(arquivo);
        assert.ok(js.includes('FiltrosAvancados?.ligar('), arquivo);
        assert.ok(js.includes(`BuscaAoDigitar?.ligar(document.getElementById('${campo}')`), `${arquivo}: filtra enquanto digita`);
    }
});

test('FiltrosAvancados.documentoCasa: cliente, peça ou código — e diz QUAIS peças fizeram casar', () => {
    const { FiltrosAvancados } = carregarUtil('js/utils/filtros-avancados.js');
    const pecas = [{ codigo: 'BBRO 3015', nome: 'Banco Bromélia', quantidade: 2 }, { codigo: 'PLT 01', nome: 'Platter Pietra', quantidade: 1 }];
    const doc = { numero: 'PED115', cliente: 'Jackie', pecas };
    assert.deepStrictEqual(JSON.parse(JSON.stringify(FiltrosAvancados.documentoCasa(['jackie'], doc))), { casa: true, pecas: [] }, 'só pelo cliente: nenhuma peça listada');
    const porPeca = FiltrosAvancados.documentoCasa(['jackie', 'pietra'], doc);
    assert.strictEqual(porPeca.casa, true);
    assert.deepStrictEqual(Array.from(porPeca.pecas, p => p.codigo), ['PLT 01']);
    assert.strictEqual(FiltrosAvancados.documentoCasa(['bbro'], doc).pecas[0].codigo, 'BBRO 3015');
    assert.strictEqual(FiltrosAvancados.documentoCasa(['onix'], doc).casa, false);
    assert.strictEqual(FiltrosAvancados.documentoCasa(['ped115'], doc).casa, true);
    assert.strictEqual(FiltrosAvancados.rotuloDaPeca(pecas[0]), 'BBRO 3015 — Banco Bromélia (2)');
    assert.ok(FiltrosAvancados.achadosHtml(['a', 'b', 'c', 'd', 'e']).includes('>+2<'));
});

test('Orçamentos e Pedidos: o filtro de cliente lê o nome guardado na linha (a célula ganha as peças achadas)', () => {
    for (const arquivo of ['js/orcamentos.js', 'js/pedidos.js']) {
        const js = ler(arquivo);
        assert.match(js, /tr\.dataset\.cliente = /, arquivo);
        assert.match(js, /row\.dataset\.cliente \?\? row\.cells\[1\]/, arquivo);
        // A lista refeita volta a aplicar os filtros da tela.
        assert.match(js, /\.limpar\(\);\s*\n\s*aplicarFiltro\(\);/, arquivo);
    }
});

test('Fechar competência — produção: barra "Filtrar pedidos" retraída e a tela parada ao confirmar', () => {
    const html = ler('html/modals/financeiro/fechar-producao.html');
    assert.match(html, /id="finFecharProducaoFiltroSecao" class="secao-retratil" data-secao-retratil data-secao-resumo="valores"/);
    assert.match(html, /id="finFecharProducaoFiltroCorpo" data-secao-corpo[^>]*hidden>/);
    assert.ok(html.indexOf('finFecharProducaoFiltroSecao') < html.indexOf('finFecharProducaoCards'), 'a barra vem antes dos cards');
    const js = ler('js/modals/financeiro-modais.js');
    const fp = js.slice(js.indexOf('function montarFecharProducao'), js.indexOf('function montarConfirmarPagamento'));
    assert.ok(fp.includes("window.BuscaAoDigitar?.ligar(filtroCampo, pintar)"), 'filtra enquanto digita, sem reler');
    assert.ok(fp.includes('function visivelNoFiltro'), 'pedido inteiro ou só as peças que casaram');
    // Confirmar: o "Carregando" não aparece em cima dos cards e o bloco volta ao mesmo ponto.
    assert.ok(fp.includes('async function carregar({ silencioso = false, ancora = null } = {})'));
    assert.ok(fp.includes("if (!silencioso) el('finFecharProducaoCarregando').classList.remove('hidden');"));
    assert.match(fp, /const ancora = marcarAncora\(seletorDaPeca\(pedido, peca\)\);\s*\n\s*abertas\.delete/);
    assert.ok(fp.includes('await carregar({ silencioso: true, ancora });'));
});

test('SecaoRetratil: barra de filtro resume o que está filtrando e acompanha a digitação', () => {
    const js = ler('js/utils/secao-retratil.js');
    assert.ok(js.includes("secao?.dataset?.secaoResumo === 'valores'"));
    assert.ok(js.includes("campo.addEventListener('input', () => resumir(secao))"));
});

test('menu lateral: rola quando passa da altura, sem mudar largura (barra reservada no lugar do recuo)', () => {
    const css = ler('css/menu.css');
    const bloco = css.slice(css.indexOf('#sidebar > nav {'), css.indexOf('}', css.indexOf('#sidebar > nav {')));
    assert.ok(bloco.includes('scrollbar-gutter: stable'), 'o lugar da barra fica sempre reservado');
    assert.ok(bloco.includes('padding-right: 2px'), '2 px + 6 px da barra = os 8 px de recuo de antes');
    assert.ok(bloco.includes('overflow-y: hidden'), 'fora do menu, a barra não aparece');
    assert.match(css, /#sidebar:hover > nav,\s*\n#sidebar:focus-within > nav \{\s*\n\s*overflow-y: auto;/);
    // A barra é a global (scroll.css 3d), sem regra própria.
    assert.ok(!/#sidebar > nav::-webkit-scrollbar/.test(css));
    assert.match(ler('styles/scroll.css'), /:where\(\*\)::-webkit-scrollbar \{\s*\n\s*width: 6px;/);
});

// Correções de 09/10/2026 (prints do dono).
test('Pedidos e Orçamentos: etiqueta só com código e quantidade, o nome no balão do mouse', () => {
    const { FiltrosAvancados } = carregarUtil('js/utils/filtros-avancados.js');
    const peca = { codigo: 'AVSØ 0114 MUI', nome: 'Apaga Velas Silvia - 1 (Ø50 × 14h) - Muiracatiara', quantidade: 1 };
    assert.deepStrictEqual(JSON.parse(JSON.stringify(FiltrosAvancados.etiquetaCurtaDaPeca(peca))),
        { texto: 'AVSØ 0114 MUI (1)', titulo: 'Apaga Velas Silvia - 1 (Ø50 × 14h) - Muiracatiara' });
    const html = FiltrosAvancados.achadosHtml([FiltrosAvancados.etiquetaCurtaDaPeca(peca)]);
    assert.ok(html.includes('title="Apaga Velas Silvia - 1 (Ø50 × 14h) - Muiracatiara">AVSØ 0114 MUI (1)</span>'), html);
    // Texto solto continua valendo (o +N junta o resto no balão).
    assert.ok(FiltrosAvancados.achadosHtml(['a', 'b', 'c', { texto: 'X (2)', titulo: 'Peça X' }]).includes('title="X (2) — Peça X">+1<'));
    for (const arquivo of ['js/orcamentos.js', 'js/pedidos.js']) {
        assert.ok(ler(arquivo).includes('achadosHtml(resultado.pecas.map(window.FiltrosAvancados.etiquetaCurtaDaPeca))'), arquivo);
    }
});

test('Pedidos e Orçamentos: "Cód.", "Valor Tot." e código, data, valor e status sem quebrar a linha', () => {
    for (const [html, js, pre, cond] of [['html/pedidos.html', 'js/pedidos.js', 'ped', 'condicao'], ['html/orcamentos.html', 'js/orcamentos.js', 'orc', 'cond_pagto']]) {
        const pagina = ler(html);
        const cabecalhos = pagina.match(/<th[^>]*>[^<]*<\/th>/g);
        assert.strictEqual(cabecalhos.length, 7, html);
        cabecalhos.forEach(th => assert.ok(th.includes('class="sem-quebra '), `${html}: ${th}`));
        assert.match(pagina, new RegExp(`col_${pre}_num"[^>]*>Cód\\.</th>`));
        assert.match(pagina, new RegExp(`col_${pre}_total"[^>]*>Valor Tot\\.</th>`));
        const linha = ler(js);
        for (const col of ['num', 'data', 'total', cond, 'status']) {
            assert.ok(linha.includes(`<td data-perm-col="col_${pre}_${col}" class="sem-quebra `), `${js}: ${col}`);
        }
        assert.ok(!linha.includes(`<td data-perm-col="col_${pre}_cliente" class="sem-quebra`), `${js}: o cliente quebra, para as etiquetas descerem`);
    }
    // Mais forte que a `.table-scroll td` do scroll.css, que deixa quebrar no meio da palavra.
    assert.match(ler('styles/utilitarios.css'), /\.table-scroll td\.sem-quebra \{ white-space: nowrap; word-break: normal;/);
});

test('Matéria-prima: o "0 Estoque" não puxa mais para cima das etiquetas', () => {
    const css = ler('css/materia-prima.css');
    const bloco = css.slice(css.indexOf('#zeroStockbt {'), css.indexOf('}', css.indexOf('#zeroStockbt {')));
    assert.ok(!/margin-left:\s*-/.test(bloco), 'a margem negativa punha o botão por cima do "Acabando"');
    assert.ok(bloco.includes('flex-shrink: 0'));
});

test('"Abater a matéria-prima?": a explicação quebra dentro do botão de escolha', () => {
    const js = ler('utils/insumosDaPeca.js');
    assert.strictEqual((js.match(/class="botao-escolha w-full btn-(primary|neutral) /g) || []).length, 2);
    assert.match(ler('css/menu.css'), /\.botao-escolha\[class\*="btn-"\] \{\s*\n\s*white-space: normal;/);
});
