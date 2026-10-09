/**
 * "Visualizar documento": o modal padrão de todo PDF do programa (pedido do
 * dono, 09/10/2026). Antes, para ver um PDF era preciso salvá-lo; agora ele
 * abre aqui, e daqui se imprime direto, se salva ou se sai.
 *
 *   window.VisualizadorPdf.abrir({
 *     titulo: 'DANFE — NF-e 123',          // o cabeçalho
 *     subtitulo: 'Pedido PED115',           // opcional (o nº de folhas entra sozinho)
 *     nomeArquivo: 'DANFE-123',             // a sugestão do "Salvar PDF"
 *     tituloSalvar: 'Salvar DANFE em PDF',  // o título da janela de salvar
 *     gerar: async () => ({ base64 })       // ou ArrayBuffer / Uint8Array; o objeto
 *   });                                     // pode trazer nomeArquivo, subtitulo e titulo
 *
 *   window.VisualizadorPdf.deHtml(html, { retrato })  // o `gerar` de um HTML
 *
 * O ESPELHO É 100%: o PDF é gerado UMA vez, pelo mesmo gerador que antes fazia
 * o arquivo salvo (o HTML impresso pelo Electron, o PDF do orçamento, o PDF do
 * jsPDF, o PDF guardado). O modal mostra esses bytes; "Salvar PDF" grava esses
 * bytes; "Imprimir" imprime esses bytes. Nada é refeito no caminho.
 *
 * Como mostra: o visor de PDF do próprio Chromium, num quadro (blob:), sem a
 * barra de ferramentas dele e ocupando a largura. A lupa é Ctrl + roda.
 *
 * Como imprime: pelo próprio quadro do PDF (a janela de impressão do Windows:
 * impressora, cópias, folhas). Se isso falhar, o processo principal imprime os
 * mesmos bytes (`electronAPI.imprimirPdf`).
 *
 * Fica à frente de tudo (`app-message-overlay`, src/utils/dialogTopLayer.js):
 * abre por cima do modal de onde foi chamado sem fechá-lo, e os avisos rápidos
 * continuam por cima dele. Esc e Voltar/Fechar saem; Ctrl+P imprime.
 */
(() => {
  if (window.VisualizadorPdf) return;

  const avisar = (texto, tipo = 'info') => window.showToast?.(texto, tipo);

  function criar(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  }

  function botao(rotulo, classe, icone) {
    const b = criar('button', `ctl-botao ${classe}`);
    b.type = 'button';
    if (icone) {
      const i = criar('i', `fas ${icone}`);
      i.setAttribute('aria-hidden', 'true');
      b.appendChild(i);
    }
    b.appendChild(document.createTextNode(rotulo));
    return b;
  }

  /** Os bytes, venham como vierem: { base64 }, base64, ArrayBuffer, Uint8Array. */
  function paraBytes(dado) {
    if (!dado) return null;
    if (dado instanceof Uint8Array) return dado;
    if (dado instanceof ArrayBuffer) return new Uint8Array(dado);
    const base64 = typeof dado === 'string' ? dado : dado.base64;
    if (typeof base64 !== 'string' || !base64) return null;
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  }

  function paraBase64(bytes) {
    let binario = '';
    const passo = 0x8000;
    for (let i = 0; i < bytes.length; i += passo) {
      binario += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
    }
    return btoa(binario);
  }

  /** Quantas folhas o PDF tem (a mesma conta de backend/fiscal/folhas.js). */
  function contarFolhas(bytes) {
    try {
      let texto = '';
      const passo = 0x8000;
      for (let i = 0; i < bytes.length; i += passo) texto += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
      return (texto.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
    } catch (_) {
      return 0;
    }
  }

  /** Um PDF começa com "%PDF": o que não começa não é PDF (um erro em HTML, por exemplo). */
  const ehPdf = bytes => bytes && bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

  let aberto = null;

  function abrir({ titulo = 'Visualizar documento', subtitulo = '', nomeArquivo = 'documento', tituloSalvar = 'Salvar PDF', gerar } = {}) {
    if (typeof gerar !== 'function') throw new Error('VisualizadorPdf.abrir precisa de gerar().');
    // Um visualizador por vez: abrir outro troca o documento.
    if (aberto) aberto.fechar();

    let bytes = null;
    let url = null;
    let fechado = false;
    // O `gerar` pode trazer o nome do arquivo e o subtítulo que só se sabem
    // depois de buscar o documento (o DANFE vem do servidor com o nome dele).
    let nomeAtual = nomeArquivo;
    let subtituloAtual = subtitulo;

    // ------------------------------------------------------------ o desenho
    const overlay = criar('div', 'app-message-overlay visualizador-pdf fixed inset-0 bg-black/50 flex items-center justify-center p-4 ctl-padrao');
    overlay.dataset.visualizadorPdf = 'true';
    const cartao = criar('div', 'visualizador-pdf__cartao w-full max-w-6xl glass-surface backdrop-blur-xl rounded-3xl border border-white/10 ring-1 ring-white/5 shadow-2xl overflow-hidden flex flex-col');
    cartao.setAttribute('role', 'dialog');
    cartao.setAttribute('aria-modal', 'true');
    cartao.setAttribute('aria-label', titulo);

    const cabecalho = criar('header', 'visualizador-pdf__cabecalho');
    const voltar = botao('Voltar', 'btn-neutral text-white', 'fa-arrow-left');
    voltar.title = 'Sair sem salvar (Esc)';
    const centro = criar('div', 'visualizador-pdf__titulos');
    const h2 = criar('h2', 'ctl-modal-titulo text-white visualizador-pdf__titulo', titulo);
    const sub = criar('p', 'visualizador-pdf__subtitulo', subtitulo || '');
    centro.append(h2, sub);
    const acoes = criar('div', 'ctl-acoes visualizador-pdf__acoes');
    const salvar = botao('Salvar PDF', 'btn-secondary text-white', 'fa-download');
    salvar.title = 'Gravar este mesmo PDF no computador';
    const fechar = botao('Fechar', 'btn-danger text-white');
    const imprimir = botao('Imprimir', 'btn-primary text-white', 'fa-print');
    imprimir.title = 'Imprimir este documento (Ctrl+P)';
    acoes.append(salvar, fechar, imprimir);
    cabecalho.append(voltar, centro, acoes);

    const corpo = criar('div', 'visualizador-pdf__corpo');
    const estado = criar('div', 'visualizador-pdf__estado');
    const quadro = criar('iframe', 'visualizador-pdf__quadro hidden');
    quadro.title = titulo;
    corpo.append(estado, quadro);
    cartao.append(cabecalho, corpo);
    overlay.appendChild(cartao);

    const habilitar = sim => { for (const b of [salvar, imprimir]) { b.disabled = !sim; b.classList.toggle('opacity-50', !sim); } };

    function mostrarCarregando() {
      estado.replaceChildren();
      const giro = criar('div', 'visualizador-pdf__giro');
      giro.setAttribute('aria-hidden', 'true');
      estado.append(giro, criar('p', 'visualizador-pdf__mensagem', 'Montando o documento…'));
      estado.classList.remove('hidden');
      quadro.classList.add('hidden');
      habilitar(false);
    }

    function mostrarErro(mensagem) {
      estado.replaceChildren();
      const icone = criar('i', 'fas fa-triangle-exclamation visualizador-pdf__icone-erro');
      icone.setAttribute('aria-hidden', 'true');
      const denovo = botao('Tentar de novo', 'btn-primary text-white', 'fa-rotate-right');
      denovo.addEventListener('click', carregar);
      estado.append(icone, criar('p', 'visualizador-pdf__mensagem', mensagem || 'Não foi possível montar o documento.'), denovo);
      estado.classList.remove('hidden');
      quadro.classList.add('hidden');
      habilitar(false);
    }

    async function carregar() {
      mostrarCarregando();
      try {
        const dado = await gerar();
        if (fechado) return;
        const novos = paraBytes(dado);
        if (!ehPdf(novos)) throw new Error(dado?.message || 'O documento veio vazio.');
        bytes = novos;
        if (dado && typeof dado === 'object' && !(dado instanceof ArrayBuffer) && !(dado instanceof Uint8Array)) {
          if (dado.nomeArquivo) nomeAtual = dado.nomeArquivo;
          if (dado.subtitulo !== undefined && dado.subtitulo !== null) subtituloAtual = dado.subtitulo;
          if (dado.titulo) { h2.textContent = dado.titulo; quadro.title = dado.titulo; cartao.setAttribute('aria-label', dado.titulo); }
        }
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        quadro.src = `${url}#toolbar=0&navpanes=0&view=FitH`;
        const folhas = contarFolhas(bytes);
        sub.textContent = [subtituloAtual, folhas ? `${folhas} ${folhas === 1 ? 'folha' : 'folhas'}` : ''].filter(Boolean).join(' · ');
        estado.classList.add('hidden');
        quadro.classList.remove('hidden');
        habilitar(true);
      } catch (err) {
        if (fechado) return;
        console.error('[VisualizadorPdf] o documento não foi montado:', err);
        mostrarErro(err?.message || 'Não foi possível montar o documento.');
      }
    }

    // ------------------------------------------------------------ as ações
    async function acaoSalvar() {
      if (!bytes) return;
      const api = window.electronAPI?.salvarPdf;
      if (typeof api !== 'function') { avisar('Salvar arquivo indisponível nesta janela.', 'error'); return; }
      const r = await api({ base64: paraBase64(bytes), nomeSugerido: nomeAtual, titulo: tituloSalvar });
      if (r?.success) avisar(`PDF salvo em ${r.filePath}.`, 'success');
      else if (!r?.canceled) avisar(r?.message || 'Não foi possível salvar o PDF.', 'error');
    }

    async function acaoImprimir() {
      if (!bytes) return;
      try {
        // O quadro é da mesma origem: imprime o PDF de dentro dele.
        const janela = quadro.contentWindow;
        if (!janela || typeof janela.print !== 'function') throw new Error('sem quadro');
        janela.focus();
        janela.print();
        // O foco volta para o modal: dentro do PDF, o Esc não chegaria aqui.
        imprimir.focus();
        return;
      } catch (err) {
        console.warn('[VisualizadorPdf] impressão pelo quadro falhou; tentando pelo processo principal.', err);
      }
      const api = window.electronAPI?.imprimirPdf;
      if (typeof api !== 'function') { avisar('Impressão indisponível nesta janela.', 'error'); return; }
      const r = await api({ base64: paraBase64(bytes) });
      if (!r?.success && !r?.canceled) avisar(r?.message || 'Não foi possível imprimir.', 'error');
    }

    function fecharVisualizador() {
      if (fechado) return;
      fechado = true;
      window.removeEventListener('keydown', aoTeclar, true);
      overlay.remove();
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (aberto && aberto.overlay === overlay) aberto = null;
    }

    function aoTeclar(evento) {
      if (fechado) return;
      // O visualizador é o de cima: o Esc e o Ctrl+P são dele, não do modal de baixo.
      if (evento.key === 'Escape') {
        evento.preventDefault();
        evento.stopImmediatePropagation();
        fecharVisualizador();
      } else if ((evento.ctrlKey || evento.metaKey) && String(evento.key).toLowerCase() === 'p') {
        evento.preventDefault();
        evento.stopImmediatePropagation();
        acaoImprimir();
      }
    }

    const ligar = (b, fn) => {
      if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(b, fn, { visual: false });
      else b.addEventListener('click', fn);
    };
    ligar(salvar, acaoSalvar);
    ligar(imprimir, acaoImprimir);
    voltar.addEventListener('click', fecharVisualizador);
    fechar.addEventListener('click', fecharVisualizador);
    window.addEventListener('keydown', aoTeclar, true);
    // Com o foco no quadro do PDF (a pessoa clicou para rolar), as teclas vão
    // para ele: o quadro é da mesma origem, e o Esc/Ctrl+P de lá também valem.
    quadro.addEventListener('load', () => {
      try { quadro.contentWindow?.addEventListener('keydown', aoTeclar, true); } catch (_) { /* outra origem: só os botões */ }
    });

    document.body.appendChild(overlay);
    aberto = { overlay, fechar: fecharVisualizador };
    carregar();
    return aberto;
  }

  /**
   * O `gerar` de um HTML: o mesmo PDF que o "Salvar" fazia (Electron, A4, sem
   * margem). `tamanhoDoCss`: o @page do documento manda (os documentos de
   * impressão dos Relatórios, que antes abriam no navegador).
   */
  function deHtml(html, { retrato = false, tamanhoDoCss = false } = {}) {
    return async () => {
      const api = window.electronAPI?.gerarPdfDeHtml;
      if (typeof api !== 'function') throw new Error('A geração de PDF só funciona dentro do aplicativo.');
      const r = await api({ html, retrato, tamanhoDoCss });
      if (!r?.success) throw new Error(r?.message || 'Não foi possível gerar o PDF.');
      return { base64: r.base64 };
    };
  }

  /**
   * O `gerar` do PDF do orçamento ou do pedido (a página /pdf impressa pelo
   * Electron, em paisagem): o mesmo arquivo que o ícone salvava, agora em
   * bytes. A permissão de exportar é conferida no processo principal.
   */
  function doDocumento(id, tipo) {
    return async () => {
      const api = window.electronAPI?.gerarPdfDocumento;
      if (typeof api !== 'function') throw new Error('A geração de PDF só funciona dentro do aplicativo.');
      const r = await api(id, tipo);
      if (!r?.success) throw new Error(r?.message || 'Não foi possível gerar o PDF.');
      return { base64: r.base64, nomeArquivo: r.nome };
    };
  }

  window.VisualizadorPdf = { abrir, deHtml, doDocumento, paraBytes, contarFolhas };
})();
