/**
 * DANFE, XML e cancelamento da NF-e a partir do Visualizar pedido (etapa 5a):
 * os botões no rodapé (guardas escritas no HTML), o caminho do PDF em retrato
 * e do XML pelo Electron, e o modal "Cancelar NF-e" com a justificativa.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const VIS_HTML = ler('html', 'modals', 'pedidos', 'visualizar.html');
const VIS_JS = ler('js', 'modals', 'pedido-visualizar.js');
const CANC_HTML = ler('html', 'modals', 'pedidos', 'cancelar-nfe.html');
const CANC_JS = ler('js', 'modals', 'pedido-cancelar-nfe.js');
const MAIN = ler('..', 'main.js');
const PRELOAD = ler('..', 'preload.js');

function recortarFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada`);
  let i = fonte.indexOf('{', inicio);
  let nivel = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}') { nivel -= 1; if (nivel === 0) break; }
  }
  return fonte.slice(inicio, i + 1);
}

test('visualizar: botões DANFE/XML/Cancelar NF-e escondidos no HTML com as guardas, ao lado das tags', () => {
  assert.ok(/id="visualizarPedidoDanfe"[^>]*data-perm="financeiro\.nfe\.view"[^>]*class="hidden/.test(VIS_HTML));
  assert.ok(/id="visualizarPedidoXml"[^>]*data-perm="financeiro\.nfe\.view"[^>]*class="hidden/.test(VIS_HTML));
  assert.ok(/id="visualizarPedidoCancelarNfe"[^>]*data-perm="financeiro\.nfe\.cancel"[^>]*class="hidden btn-danger/.test(VIS_HTML));
  assert.ok(VIS_HTML.indexOf('id="visualizarPedidoTagsLista"') < VIS_HTML.indexOf('id="visualizarPedidoDanfe"'));
  assert.ok(VIS_HTML.indexOf('id="visualizarPedidoCancelarNfe"') < VIS_HTML.indexOf('id="cancelarVisualizarPedido"'), 'dentro do bloco central, antes dos botões do rodapé');
});

test('visualizar: DANFE vai ao PDF em retrato, XML ao arquivo .xml (e o do cancelamento), cancelar abre o modal próprio', () => {
  const contexto = vm.createContext({});
  vm.runInContext(recortarFuncao(VIS_JS, 'notaParaDocumentos'), contexto);
  const f = contexto.notaParaDocumentos;
  assert.strictEqual(f([{ id: 1, status_fiscal: 'rejeitada' }]), null);
  assert.strictEqual(f([{ id: 1, status_fiscal: 'autorizada' }, { id: 2, status_fiscal: 'cancelada' }]).id, 2);
  assert.strictEqual(f([{ id: 3, status_fiscal: 'processando' }, { id: 1, status_fiscal: 'autorizada' }]).id, 1);

  // DANFE e XML vivem no utilitário compartilhado com a lista de pedidos.
  const UTIL = ler('js', 'utils', 'nfe-documentos.js');
  const MENU = ler('html', 'menu.html');
  assert.ok(UTIL.includes('/api/fiscal/notas/${encodeURIComponent(notaId)}/danfe'));
  // O HTML do backend vai para o PDF em RETRATO (o helper `paraPdf` é o
  // caminho único, usado também pela nota de fora).
  assert.ok(UTIL.includes("salvarHtmlComoPdf?.({ html: corpo.html, nomeSugerido: corpo.nome, titulo, retrato: true })"));
  assert.ok(UTIL.includes("titulo: 'Salvar DANFE em PDF'"));
  assert.ok(UTIL.includes('/api/fiscal/notas/${encodeURIComponent(notaId)}/xml'));
  assert.ok(UTIL.includes("extensao: 'xml'") && UTIL.includes('corpo.xml_cancelamento'));
  assert.ok(UTIL.includes('gerarDanfe, salvarXml, gerarCartaCorrecaoPdf, salvarXmlCartaCorrecao, listarCartasCorrecao,'));
  assert.ok(MENU.indexOf('js/utils/nfe-documentos.js') > MENU.indexOf('js/utils/cliente-fiscal.js'), 'o menu carrega o utilitário');
  assert.ok(VIS_JS.includes('window.NfeDocumentos.gerarDanfe(nota.id)') && VIS_JS.includes('window.NfeDocumentos.salvarXml(nota.id)'));
  // Por cima do Visualizar, que continua aberto embaixo.
  assert.ok(VIS_JS.includes("abrirPorCima('modals/pedidos/cancelar-nfe.html', '../js/modals/pedido-cancelar-nfe.js', 'cancelarNfe')"));
  const soAutorizada = VIS_JS.slice(VIS_JS.indexOf("if (nota.status_fiscal === 'autorizada') {"), VIS_JS.indexOf('ligar(cancelarBtn, cancelarNfe);'));
  assert.ok(soAutorizada.length > 0 && soAutorizada.includes('cartaNfe'), 'cancelar e carta de correção só com nota autorizada');
  assert.ok(VIS_JS.includes("ligar(overlay.querySelector('#visualizarPedidoEmailNfe'), emailNfe);"), 'e-mail também para nota cancelada (DANFE cancelado)');
  assert.ok(VIS_JS.includes("abrirPorCima('modals/pedidos/enviar-nfe-email.html', '../js/modals/pedido-enviar-nfe-email.js', 'enviarNfeEmail')"));
  assert.ok(VIS_JS.includes("abrirPorCima('modals/pedidos/carta-correcao-nfe.html', '../js/modals/pedido-carta-correcao-nfe.js', 'cartaCorrecaoNfe')"));
  assert.ok(VIS_JS.includes("email: nota.destinatario?.email || ''"), 'o e-mail do destinatário da nota vai no contexto');
  assert.ok(/id="visualizarPedidoEmailNfe"[^>]*data-perm="financeiro\.nfe\.emit"/.test(VIS_HTML) && /id="visualizarPedidoCartaNfe"[^>]*data-perm="financeiro\.nfe\.emit"/.test(VIS_HTML));
  assert.ok(VIS_JS.includes('ligarDocumentosDaNota(notaDocs, data)') && VIS_JS.includes('window.NfeDocumentos.listarCartasCorrecao(notaDocs.id)'), 'as cartas da nota entram nas tags');
  // Botões só com texto (sem ícone), como o dono pediu.
  for (const id of ['visualizarPedidoDanfe', 'visualizarPedidoXml', 'visualizarPedidoEmailNfe', 'visualizarPedidoCartaNfe', 'visualizarPedidoCancelarNfe']) {
    const linha = VIS_HTML.split('\n').find(l => l.includes(`id="${id}"`)) || '';
    assert.ok(linha && !linha.includes('<i class="fas'), `#${id} sem ícone`);
  }
});

test('Electron: o PDF aceita retrato e existe o IPC de salvar texto, exposto no preload', () => {
  assert.ok(MAIN.includes("ipcMain.handle('salvar-html-como-pdf', async (_event, { html, nomeSugerido, titulo, retrato = false } = {})"));
  assert.ok(MAIN.includes('landscape: !retrato'));
  assert.ok(MAIN.includes("ipcMain.handle('salvar-texto-como-arquivo'"));
  assert.ok(PRELOAD.includes("salvarTextoComoArquivo: (payload) => ipcRenderer.invoke('salvar-texto-como-arquivo', payload)"));
});

test('modal E-mail: destinatários pré-preenchidos, DANFE gerado no app (base64) e POST /email; modal Carta de correção: 15 a 1000 e POST /carta-correcao', () => {
  const EMAIL_HTML = ler('html', 'modals', 'pedidos', 'enviar-nfe-email.html');
  const EMAIL_JS = ler('js', 'modals', 'pedido-enviar-nfe-email.js');
  for (const id of ['enviarNfeEmailOverlay', 'enviarNfeEmailPara', 'enviarNfeEmailMensagem', 'enviarNfeEmailDanfe', 'enviarNfeEmailXml', 'confirmarEnviarNfeEmail', 'cancelarEnviarNfeEmail']) {
    assert.ok(EMAIL_HTML.includes(`id="${id}"`), `e-mail sem #${id}`);
  }
  assert.ok(/id="confirmarEnviarNfeEmail"[^>]*data-perm="financeiro\.nfe\.emit"/.test(EMAIL_HTML));
  assert.ok(EMAIL_JS.includes("window.electronAPI?.gerarPdfDeHtml?.({ html: corpo.html, retrato: true })"), 'o DANFE é impresso no app e vai em base64');
  assert.ok(EMAIL_JS.includes('/api/fiscal/notas/${encodeURIComponent(ctx.notaId)}/email') && EMAIL_JS.includes('pdf_base64: pdfBase64, incluir_xml: querXml'));
  assert.ok(EMAIL_JS.includes("paraEl.value = ctx.email || '';"), 'vem com o e-mail da NF-e do cliente');
  const inicioE = EMAIL_JS.indexOf('const EMAIL_RE');
  const fimE = EMAIL_JS.indexOf('// ------------------------------------------------- fim das funções puras');
  const fe = vm.runInContext(`${EMAIL_JS.slice(inicioE, fimE)}\n({ lerDestinatarios, mensagemDeErro })`, vm.createContext({}));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(fe.lerDestinatarios('A@b.com; c@d.com a@b.com; ruim'))), { lista: ['a@b.com', 'c@d.com', 'ruim'], invalidos: ['ruim'] });
  assert.match(fe.mensagemDeErro(409, null), /não está configurado/);
  assert.match(fe.mensagemDeErro(502, { error: 'O servidor de e-mail recusou o envio: 535' }), /535/);
  assert.ok(!/innerHTML|insertAdjacentHTML|window\.confirm\(/.test(EMAIL_JS));

  const CCE_HTML = ler('html', 'modals', 'pedidos', 'carta-correcao-nfe.html');
  const CCE_JS = ler('js', 'modals', 'pedido-carta-correcao-nfe.js');
  for (const id of ['cartaCorrecaoNfeOverlay', 'cartaCorrecaoNfeTexto', 'cartaCorrecaoNfeContador', 'confirmarCartaCorrecaoNfe', 'cancelarCartaCorrecaoNfe']) {
    assert.ok(CCE_HTML.includes(`id="${id}"`), `carta sem #${id}`);
  }
  assert.ok(CCE_HTML.includes('maxlength="1000"') && /id="confirmarCartaCorrecaoNfe"[^>]*data-perm="financeiro\.nfe\.emit"/.test(CCE_HTML));
  const inicioC = CCE_JS.indexOf('const MINIMO');
  const fimC = CCE_JS.indexOf('// ------------------------------------------------- fim das funções puras');
  const fc = vm.runInContext(`${CCE_JS.slice(inicioC, fimC)}\n({ avaliarCorrecao, textoDoContador, mensagemDeErro })`, vm.createContext({}));
  assert.strictEqual(fc.avaliarCorrecao('Onde se lê Caixa, leia-se Engradado').erro, null);
  assert.match(fc.avaliarCorrecao('curta').erro, /pelo menos 15/);
  assert.match(fc.avaliarCorrecao('x'.repeat(1001)).erro, /passa de 1000/);
  assert.strictEqual(fc.textoDoContador('abc'), '3 / 1000 — mínimo de 15 caracteres');
  assert.match(fc.mensagemDeErro(422, { sefaz: { cStat: '573', xMotivo: 'Duplicidade' } }), /recusou a carta \(573\)/);
  assert.ok(CCE_JS.includes('/api/fiscal/notas/${encodeURIComponent(ctx.notaId)}/carta-correcao') && CCE_JS.includes('window.DialogPadrao?.confirm?.({'));
  // Onde as cartas ficam: lista no próprio modal, com segunda via em PDF e o XML; a registrada não fecha o modal.
  assert.ok(CCE_HTML.includes('id="cartaCorrecaoNfeRegistradas"') && CCE_HTML.includes('id="cartaCorrecaoNfeLista"'));
  assert.ok(CCE_JS.includes('window.NfeDocumentos.listarCartasCorrecao(ctx.notaId)') && CCE_JS.includes('gerarCartaCorrecaoPdf(ctx.notaId, carta.nSeqEvento)') && CCE_JS.includes('salvarXmlCartaCorrecao(ctx.notaId, carta.nSeqEvento)'));
  assert.ok(CCE_JS.includes('await pintarRegistradas();') && !CCE_JS.includes('fechar();\n    } finally'), 'depois de registrar, a lista é repintada');
  const UTIL2 = ler('js', 'utils', 'nfe-documentos.js');
  assert.ok(UTIL2.includes('/cartas-correcao/${encodeURIComponent(seq)}/documento') && UTIL2.includes("titulo: 'Salvar carta de correção em PDF'"));
  assert.ok(UTIL2.includes('gerarDanfe, salvarXml, gerarCartaCorrecaoPdf, salvarXmlCartaCorrecao, listarCartasCorrecao,'));
  assert.ok(!/innerHTML|insertAdjacentHTML|window\.confirm\(/.test(CCE_JS));
  assert.ok(MAIN.includes("ipcMain.handle('gerar-pdf-de-html'") && PRELOAD.includes("gerarPdfDeHtml: (payload) => ipcRenderer.invoke('gerar-pdf-de-html', payload)"));
});

test('configuração fiscal: seções de e-mail (senha só no computador) e de inutilização, ligadas no script', () => {
  const CFG_HTML = ler('html', 'modals', 'financeiro', 'configuracao-fiscal.html');
  const CFG_JS = ler('js', 'modals', 'financeiro-modais.js');
  for (const campo of ['smtp_host', 'smtp_porta', 'smtp_seguro', 'smtp_usuario', 'smtp_remetente', 'smtp_nome_remetente', 'email_copia', 'email_mensagem_padrao']) {
    assert.ok(CFG_HTML.includes(`data-fin-cfg="${campo}"`), `sem o campo ${campo}`);
  }
  assert.ok(!CFG_HTML.includes('data-fin-cfg="smtp_senha"'), 'a senha não é campo da configuração (não vai ao banco)');
  for (const id of ['finCfgEmailSenha', 'finCfgEmailGuardar', 'finCfgEmailRemover', 'finCfgEmailTestar', 'finCfgEmailEstado', 'finCfgInutSerie', 'finCfgInutInicio', 'finCfgInutFim', 'finCfgInutJustificativa', 'finCfgInutilizar', 'finCfgInutResultado', 'finCfgInutLinhas']) {
    assert.ok(CFG_HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="finCfgInutilizar"[^>]*data-perm="financeiro\.nfe\.cancel"/.test(CFG_HTML));
  assert.ok(CFG_JS.includes("fetchApi('/api/fiscal/email/senha', { method: 'POST', body: JSON.stringify({ senha, destino }) })"));
  // Destino dos segredos: banco (todas as máquinas, com chave mestra) ou só este computador.
  assert.ok(CFG_HTML.includes('name="finCfgCertDestino" value="banco"') && CFG_HTML.includes('name="finCfgCertDestino" value="computador"'));
  assert.ok(CFG_HTML.includes('name="finCfgEmailDestino" value="banco"') && CFG_HTML.includes('id="finCfgCertDestinoAviso"'));
  assert.ok(CFG_JS.includes("body: JSON.stringify({ caminho, senha, destino })") && CFG_JS.includes('pintarDestinos(Boolean(estado?.banco_chave_mestra))'));
  assert.ok(CFG_JS.includes("c.origem === 'banco' ? `Guardado no banco"), 'a tela diz onde o certificado está');
  assert.ok(CFG_JS.includes("fetchApi('/api/fiscal/email/testar', { method: 'POST'"));
  assert.ok(CFG_JS.includes("fetchApi('/api/fiscal/inutilizacoes', { method: 'POST'") && CFG_JS.includes("fetchApi('/api/fiscal/inutilizacoes')"));
  for (const par of ["ligar('finCfgEmailGuardar', guardarSenhaEmail)", "ligar('finCfgEmailRemover', removerSenhaEmail)", "ligar('finCfgEmailTestar', testarEmail)", "ligar('finCfgInutilizar', inutilizar)"]) {
    assert.ok(CFG_JS.includes(par), `sem ${par}`);
  }
  assert.ok(CFG_JS.includes("title: 'Inutilizar numeração na SEFAZ?'"), 'inutilizar confirma na caixa da casa');
});

test('modal Cancelar NF-e: justificativa de 15 a 255, confirmação na caixa da casa, POST /cancelar e mensagens', () => {
  for (const id of ['cancelarNfeOverlay', 'cancelarNfeJustificativa', 'cancelarNfeContador', 'cancelarNfeMensagem', 'voltarCancelarNfe', 'desistirCancelarNfe', 'confirmarCancelarNfe']) {
    assert.ok(CANC_HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="confirmarCancelarNfe"[^>]*data-perm="financeiro\.nfe\.cancel"/.test(CANC_HTML));
  assert.ok(CANC_HTML.includes('maxlength="255"'));
  assert.ok(!CANC_HTML.includes('onclick'));

  const inicio = CANC_JS.indexOf('const MINIMO');
  const fim = CANC_JS.indexOf('// ------------------------------------------------- fim das funções puras');
  assert.ok(inicio > 0 && fim > inicio);
  const contexto = vm.createContext({});
  const f = vm.runInContext(`${CANC_JS.slice(inicio, fim)}\n({ avaliarJustificativa, textoDoContador, mensagemDeErro })`, contexto);
  assert.strictEqual(f.avaliarJustificativa('  Pedido   cancelado pelo cliente ').erro, null);
  assert.strictEqual(f.avaliarJustificativa('  Pedido   cancelado pelo cliente ').limpa, 'Pedido cancelado pelo cliente');
  assert.match(f.avaliarJustificativa('curta').erro, /pelo menos 15 caracteres \(faltam 10\)/);
  assert.match(f.avaliarJustificativa('x'.repeat(300)).erro, /passa de 255/);
  assert.strictEqual(f.textoDoContador('abc'), '3 / 255 — mínimo de 15 caracteres');
  assert.strictEqual(f.textoDoContador('x'.repeat(20)), '20 / 255');
  assert.match(f.mensagemDeErro(422, { sefaz: { cStat: '573', xMotivo: 'Duplicidade de Evento' } }), /recusou o cancelamento \(573\): Duplicidade de Evento/);
  assert.match(f.mensagemDeErro(409, { error: 'Só uma nota autorizada pode ser cancelada' }), /Só uma nota autorizada/);
  assert.match(f.mensagemDeErro(403, null), /permissão/);

  assert.ok(CANC_JS.includes('/api/fiscal/notas/${encodeURIComponent(ctx.notaId)}/cancelar'));
  assert.ok(CANC_JS.includes('window.DialogPadrao?.confirm?.({') && !/window\.confirm\(/.test(CANC_JS));
  assert.ok(CANC_JS.includes("window.dispatchEvent(new CustomEvent('nfe:cancelada'"));
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(CANC_JS));
  assert.ok(CANC_JS.includes("document.removeEventListener('keydown', aoEsc)"));
});
