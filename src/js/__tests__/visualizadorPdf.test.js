/**
 * "Visualizar documento" (src/js/utils/visualizador-pdf.js, pedido do dono em
 * 09/10/2026): todo PDF abre num modal padrão — ver, imprimir direto ou salvar
 * —, sem precisar salvar antes. O espelho é 100%: os bytes mostrados são os que
 * o "Salvar PDF" grava e os que o "Imprimir" imprime.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');
const ler = rel => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

function carregarUtil() {
    const contexto = { window: {}, console, atob, btoa, Uint8Array, ArrayBuffer };
    vm.createContext(contexto);
    vm.runInContext(ler('src/js/utils/visualizador-pdf.js'), contexto);
    return contexto.window.VisualizadorPdf;
}

test('o visualizador entra no menu, e a página deixa o quadro do PDF (blob:) aparecer', () => {
    const menu = ler('src/html/menu.html');
    assert.ok(menu.includes('src="../js/utils/visualizador-pdf.js"'));
    assert.ok(menu.includes('href="../styles/visualizador-pdf.css"'));
    assert.ok(menu.indexOf('visualizador-pdf.css') < menu.indexOf('controles.css'), 'controles.css continua por último');
    assert.match(menu, /frame-src 'self' blob:;/);
});

test('paraBytes e contarFolhas: base64, ArrayBuffer e a mesma conta de folhas do backend', () => {
    const V = carregarUtil();
    const pdf = '%PDF-1.4\n1 0 obj <</Type /Pages /Count 2>>\n2 0 obj <</Type /Page>>\n3 0 obj <</Type/Page>>\n%%EOF';
    const base64 = Buffer.from(pdf, 'latin1').toString('base64');
    const bytes = V.paraBytes({ base64 });
    assert.strictEqual(bytes.length, pdf.length);
    assert.strictEqual(V.contarFolhas(bytes), 2, '/Pages não conta; /Page e /Page sem espaço contam');
    assert.strictEqual(V.paraBytes(base64).length, pdf.length);
    assert.strictEqual(V.paraBytes(new Uint8Array([1, 2, 3]).buffer).length, 3);
    assert.strictEqual(V.paraBytes(null), null);
});

test('o modal: vidro padrão, à frente de tudo, Voltar/Salvar PDF/Fechar/Imprimir e o PDF sem a barra do visor', () => {
    const js = ler('src/js/utils/visualizador-pdf.js');
    assert.match(js, /'app-message-overlay visualizador-pdf fixed inset-0 bg-black\/50/, 'top layer (DialogTopLayer) sobre o véu padrão');
    assert.match(js, /glass-surface backdrop-blur-xl rounded-3xl border border-white\/10 ring-1 ring-white\/5 shadow-2xl/, 'o vidro padrão');
    assert.match(js, /botao\('Voltar', 'btn-neutral/);
    assert.match(js, /botao\('Salvar PDF', 'btn-secondary/);
    assert.match(js, /botao\('Fechar', 'btn-danger/);
    assert.match(js, /botao\('Imprimir', 'btn-primary/);
    assert.match(js, /#toolbar=0&navpanes=0&view=FitH/);
    // Clicar fora não fecha (padrão do programa): nada de clique no véu.
    assert.ok(!/overlay\.addEventListener\('click'/.test(js));
});

test('o espelho é 100%: salvar e imprimir usam os MESMOS bytes mostrados', () => {
    const js = ler('src/js/utils/visualizador-pdf.js');
    // Os bytes do quadro são os gerados uma vez...
    assert.match(js, /url = URL\.createObjectURL\(new Blob\(\[bytes\], \{ type: 'application\/pdf' \}\)\);/);
    // ...e são eles que vão para o "Salvar PDF" e para a impressão de reserva.
    assert.match(js, /api\(\{ base64: paraBase64\(bytes\), nomeSugerido: nomeAtual, titulo: tituloSalvar \}\)/);
    assert.match(js, /api\(\{ base64: paraBase64\(bytes\) \}\)/);
    // A impressão principal é a do próprio quadro do PDF.
    assert.match(js, /const janela = quadro\.contentWindow;[\s\S]*janela\.print\(\);/);
    // O deHtml gera pelo mesmo caminho do Salvar de antes (gerar-pdf-de-html).
    assert.match(js, /window\.electronAPI\?\.gerarPdfDeHtml/);
});

test('o processo principal salva e imprime os bytes que recebe, sem gerar de novo', () => {
    const main = ler('main.js');
    const salvar = main.slice(main.indexOf("ipcMain.handle('salvar-pdf'"), main.indexOf("ipcMain.handle('imprimir-pdf'"));
    assert.match(salvar, /writeFile\(filePath, Buffer\.from\(base64, 'base64'\)\)/);
    assert.match(salvar, /app\.getPath\('documents'\)/, 'a mesma pasta do Salvar de sempre');
    const imprimir = main.slice(main.indexOf("ipcMain.handle('imprimir-pdf'"), main.indexOf("ipcMain.handle('open-pdf'"));
    assert.match(imprimir, /print\(\{ silent: false, printBackground: true \}/, 'janela de impressão do Windows (nunca silenciosa)');
    const preload = ler('preload.js');
    assert.match(preload, /salvarPdf: \(payload\) => ipcRenderer\.invoke\('salvar-pdf', payload\)/);
    assert.match(preload, /imprimirPdf: \(payload\) => ipcRenderer\.invoke\('imprimir-pdf', payload\)/);
});

test('Fase 1: o DANFE da lista de Pedidos abre no visualizador', () => {
    const pedidos = ler('src/js/pedidos.js');
    assert.match(pedidos, /tr\.querySelector\('\.tag-danfe'\)\?\.addEventListener\('click', e => \{\s*\n\s*e\.stopPropagation\(\);\s*\n\s*window\.NfeDocumentos\?\.verDanfe\(/);
    const nfe = ler('src/js/utils/nfe-documentos.js');
    assert.match(nfe, /window\.VisualizadorPdf\.deHtml\(corpo\.html, \{ retrato: true \}\)/, 'o mesmo HTML e a mesma orientação do Salvar');
});

test('Fase 2: o PDF do orçamento e do pedido é o mesmo de antes, em bytes, sem a janela de salvar', () => {
    const main = ler('main.js');
    const openPdf = main.slice(main.indexOf("ipcMain.handle('open-pdf'"), main.indexOf("ipcMain.handle('open-external'"));
    assert.match(openPdf, /async \(_event, \{ id, tipo, somenteBytes = false \}\)/);
    assert.ok(openPdf.indexOf('if (somenteBytes)') > openPdf.indexOf('const pdfData = await webContents.printToPDF('), 'o mesmo printToPDF (paisagem, A4, sem margem)');
    assert.ok(openPdf.indexOf('if (somenteBytes)') < openPdf.indexOf('dialog.showSaveDialog'), 'antes da janela de salvar');
    assert.ok(openPdf.indexOf('const permissaoExport') < openPdf.indexOf('if (somenteBytes)'), 'a permissão de exportar vale para os dois');
    assert.match(ler('preload.js'), /gerarPdfDocumento: \(id, tipo\) => ipcRenderer\.invoke\('open-pdf', \{ id, tipo, somenteBytes: true \}\)/);
    const util = ler('src/js/utils/visualizador-pdf.js');
    assert.ok(util.includes('function doDocumento(id, tipo)'));
    assert.ok(util.includes('window.VisualizadorPdf = { abrir, deHtml, doDocumento, paraBytes, contarFolhas };'));
    for (const [arquivo, tipo, rotulo] of [['src/js/pedidos.js', 'pedido', 'Salvar Pedido em PDF'], ['src/js/orcamentos.js', 'orcamento', 'Salvar Orçamento em PDF']]) {
        const js = ler(arquivo);
        assert.ok(js.includes(`gerar: window.VisualizadorPdf.doDocumento(id, '${tipo}')`), arquivo);
        assert.ok(js.includes(`tituloSalvar: '${rotulo}'`), arquivo);
        assert.ok(!js.includes('electronAPI.openPdf('), `${arquivo}: nada mais vai direto para a janela de salvar`);
        assert.ok(js.includes("'PDF indisponível' : 'Ver PDF'"), `${arquivo}: o balão do ícone`);
    }
});

test('Fase 2: DANFE, cartas de correção, boletos, etiquetas e relatório de produção abrem no visualizador', () => {
    const nfe = ler('src/js/utils/nfe-documentos.js');
    for (const fn of ['gerarCartaCorrecaoPdf', 'gerarDanfeExterna', 'gerarCartaExternaPdf']) {
        const inicio = nfe.indexOf(`async function ${fn}(`);
        assert.ok(nfe.slice(inicio, nfe.indexOf('\n  }', inicio)).includes('return paraVisualizador('), fn);
    }
    assert.match(nfe, /async function gerarDanfe\(notaId\) \{\s*\n\s*return verDanfe\(notaId\);/);
    const boleto = ler('src/js/utils/boleto-documentos.js');
    assert.ok(boleto.includes('window.VisualizadorPdf.abrir({') && boleto.includes("'Boletos do pedido', 'Salvar boletos em PDF'"));
    const vis = ler('src/js/modals/pedido-visualizar.js');
    const etiquetas = vis.slice(vis.indexOf('function ligarEtiquetas'), vis.indexOf('function ligarEtiquetaProduto'));
    assert.ok(etiquetas.includes('window.VisualizadorPdf.abrir({') && !etiquetas.includes('salvarHtmlComoPdf'));
    const producao = ler('src/js/modals/pedido-relatorio-producao.js');
    assert.ok(producao.includes('gerar: window.VisualizadorPdf.deHtml(montarDocumentoParaPdf(numero))'), 'o mesmo documento, em paisagem');
    assert.ok(!producao.includes('salvarHtmlComoPdf'));
});

test('Fase 4: Relatórios — PDF da tabela, Master-Detail, Imprimir e Agrupamento no visualizador', () => {
    const rel = ler('src/js/relatorios.js');
    assert.ok(rel.includes("gerar: async () => (await montarPdfDaTabela(title, headers, rows)).output('arraybuffer')"), 'o mesmo PDF do jsPDF, em bytes');
    assert.ok(rel.includes("gerar: async () => (await montarPdfMasterDetail(title, entries, options)).output('arraybuffer')"));
    assert.strictEqual((rel.match(/gerar: window\.VisualizadorPdf\?\.deHtml\(html, \{ tamanhoDoCss: true \}\)/g) || []).length, 2, 'Imprimir e Agrupamento: o @page do documento manda');
    // Fora do aplicativo (sem o visualizador), o caminho antigo continua.
    assert.ok(rel.includes('if (!aberto) (await montarPdfDaTabela(title, headers, rows)).save(filename);'));
    const main = ler('main.js');
    const gerar = main.slice(main.indexOf("ipcMain.handle('gerar-pdf-de-html'"), main.indexOf("ipcMain.handle('salvar-texto-como-arquivo'"));
    assert.match(gerar, /\{ html, retrato = false, tamanhoDoCss = false \}/);
    assert.match(gerar, /\? \{ printBackground: true, pageSize: 'A4', preferCSSPageSize: true \}/);
    assert.match(ler('src/js/utils/visualizador-pdf.js'), /const r = await api\(\{ html, retrato, tamanhoDoCss \}\);/);
});

test('Fase 5: Contabilidade — relatório mensal, Espelho DDA, comprovantes e aplicações no visualizador', () => {
    const ctb = ler('src/js/modals/contabilidade-modais.js');
    assert.ok(!ctb.includes('salvarHtmlComoPdf'), 'nenhum PDF da Contabilidade vai mais direto para a janela de salvar');
    assert.ok(ctb.includes("tituloSalvar: 'Salvar o relatório mensal em PDF'") && ctb.includes("tituloSalvar: 'Salvar o Espelho DDA em PDF'"));
    assert.strictEqual((ctb.match(/const pdf = await window\.VisualizadorPdf\.deHtml\(r\.html\)\(\);/g) || []).length, 2, 'o mesmo HTML e a mesma orientação (paisagem) do Salvar');
    // Os PDFs guardados vão com os bytes que vieram, sem refazer.
    assert.ok(ctb.includes('function verPdfGuardado(caminho, { titulo, tituloSalvar = \'Salvar PDF\' })'));
    assert.ok(ctb.includes("return { base64: r.base64, nomeArquivo: String(r.nome || 'documento').replace(/\\.pdf$/i, ''), subtitulo: r.nome || '' };"));
    assert.strictEqual((ctb.match(/verPdfGuardado\(`\/api\/contabilidade\/(comprovantes|aplicacoes)\//g) || []).length, 3, 'os dois botões do comprovante e o da aplicação');
    // O pacote continua gerando o PDF por dentro, sem mostrar.
    assert.ok(ctb.includes('const impresso = await window.electronAPI.gerarPdfDeHtml({ html: doc.html });'));
    assert.match(ler('src/html/modals/contabilidade/relatorio.html'), /id="ctbRelPdf"[^>]*>Ver PDF<\/button>/);
});

test('Fase 3: relatórios do Financeiro, ficha e movimentações de Produtos, auditoria da Matéria-prima', () => {
    const fin = ler('src/js/modals/financeiro-modais.js');
    const exportar = fin.slice(fin.indexOf('async function exportarRelatorio'), fin.indexOf('function montarAjuste'));
    assert.ok(exportar.includes('gerar: window.VisualizadorPdf.deHtml(documentoDoRelatorio(r))') && !exportar.includes('salvarHtmlComoPdf'));
    assert.ok(exportar.includes("extensao: 'csv'"), 'a planilha continua indo para a janela de salvar');
    const produto = ler('src/js/modals/produto-visualizar.js');
    assert.ok(produto.includes("gerar: async () => (await montarPdfDoProduto()).output('arraybuffer')"), 'o mesmo PDF do jsPDF, em bytes');
    assert.ok(!produto.includes('doc.save('));
    for (const [arquivo, titulo] of [['src/js/modals/produto-movimentos.js', 'Salvar Movimentações em PDF'], ['src/js/modals/materia-prima-movimentos.js', 'Salvar Auditoria do Insumo em PDF']]) {
        const js = ler(arquivo);
        assert.ok(js.includes('gerar: window.VisualizadorPdf.deHtml(montarDocumentoParaPdf(nome))'), arquivo);
        assert.ok(js.includes(`tituloSalvar: '${titulo}'`) && !js.includes('salvarHtmlComoPdf'), arquivo);
    }
});
