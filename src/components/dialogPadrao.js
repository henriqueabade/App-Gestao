/**
 * Caixa de diálogo padrão do programa (aviso, erro, sucesso e confirmação).
 *
 * `window.DialogPadrao.open(opcoes)` / `.info(opcoes)` / `.confirm(opcoes)`.
 *
 * O visual (src/styles/dialogo-padrao.css) tem o ícone do tom num círculo,
 * título, subtítulo e um corpo organizado. O corpo pode vir de duas formas:
 *
 *  1. ESTRUTURADO — o jeito certo para caixa com muita informação:
 *       resumo:  [{ rotulo, valor, tom?, dica? }]              cartões de número
 *       secoes:  [{ titulo, icone?, texto?, lista?, itens? }]   quadros com título
 *                itens: [{ rotulo, valor?, detalhe?, tag?, dica?, tom? }]
 *       alerta:  'o que não tem volta'                          quadro vermelho
 *       nota:    'observação final'                             quadro azul
 *
 *     confirmVariant: 'danger' | 'success' | 'primary' — a cor do Confirmar
 *     (padrão: o vinho de sempre). largura: 'normal' | 'larga'.
 *
 *  2. TEXTO (`message`) — o que as chamadas antigas mandam. Ele é organizado
 *     sozinho por `estruturarTexto`: linha em branco separa blocos; bloco cuja
 *     primeira linha termina em ":" vira seção; linhas "Rótulo: valor" viram
 *     pares alinhados; linhas com "-" ou "•" viram lista; frase de "não tem
 *     volta" vai para o quadro de alerta. Frase curta fica centralizada.
 *
 * Tom: `tom` ('info' | 'sucesso' | 'aviso' | 'erro' | 'pergunta'); sem ele,
 * vem do `variant` ('info' → info, 'erro' → erro, 'confirm' → pergunta).
 */
(() => {
  const TONS = {
    info: 'fa-circle-info',
    sucesso: 'fa-circle-check',
    aviso: 'fa-triangle-exclamation',
    erro: 'fa-circle-xmark',
    pergunta: 'fa-circle-question'
  };
  const TOM_DO_VARIANT = { info: 'info', erro: 'erro', error: 'erro', confirm: 'pergunta' };

  // Frases que avisam que a ação não se desfaz: ganham o quadro de alerta.
  const IRREVERSIVEL = /n[ãa]o tem volta|n[ãa]o poder[áa] mais|para sempre|irrevers[íi]vel|n[ãa]o pode ser desfeit|n[ãa]o d[áa] para desfazer/i;
  const MARCADOR = /^[-•·*–]\s+/;
  const PAR = /^([^:]{1,42}?):\s+(.+)$/;

  /** Quebra um parágrafo em frases (sem cortar "R$ 1.234,56" nem "Nº 12."). */
  function frases(texto) {
    return String(texto).split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ"(])/).map(f => f.trim()).filter(Boolean);
  }

  /**
   * Texto corrido → blocos { tipo: 'texto' | 'lista' | 'itens' | 'alerta', titulo?, ... }.
   * Pura: é o que decide a cara de toda caixa que ainda manda só `message`.
   */
  function estruturarTexto(texto) {
    const limpo = String(texto ?? '').replace(/\r\n?/g, '\n').trim();
    if (!limpo) return [];
    const blocos = [];
    const paragrafos = limpo.split(/\n\s*\n/)
      .map(p => p.split('\n').map(l => l.trim()).filter(Boolean))
      .filter(p => p.length);

    for (const linhas of paragrafos) {
      let titulo = null;
      let corpo = linhas;
      if (linhas.length > 1 && /:$/.test(linhas[0]) && linhas[0].length <= 70) {
        titulo = linhas[0].slice(0, -1).trim();
        corpo = linhas.slice(1);
      }

      if (corpo.every(l => MARCADOR.test(l))) {
        blocos.push({ tipo: 'lista', titulo, itens: corpo.map(l => l.replace(MARCADOR, '')) });
        continue;
      }
      if (corpo.length >= 2 && corpo.every(l => PAR.test(l) && !MARCADOR.test(l))) {
        blocos.push({ tipo: 'itens', titulo, itens: corpo.map(l => { const [, rotulo, valor] = PAR.exec(l); return { rotulo, valor }; }) });
        continue;
      }

      // Misturado: as corridas de "-"/"•" viram lista, o resto fica texto.
      const partes = [];
      for (const linha of corpo) {
        const ehItem = MARCADOR.test(linha);
        const ultima = partes[partes.length - 1];
        if (ehItem) {
          if (ultima?.tipo === 'lista') ultima.itens.push(linha.replace(MARCADOR, ''));
          else partes.push({ tipo: 'lista', itens: [linha.replace(MARCADOR, '')] });
        } else if (ultima?.tipo === 'texto') {
          ultima.linhas.push(linha);
        } else {
          partes.push({ tipo: 'texto', linhas: [linha] });
        }
      }

      // O que não tem volta sai do texto e vai para o alerta.
      const separadas = [];
      for (const parte of partes) {
        if (parte.tipo !== 'texto') { separadas.push(parte); continue; }
        const linhasNormais = [];
        const alertas = [];
        for (const linha of parte.linhas) {
          const todas = frases(linha);
          const normais = todas.filter(f => !IRREVERSIVEL.test(f));
          alertas.push(...todas.filter(f => IRREVERSIVEL.test(f)));
          if (normais.length) linhasNormais.push(normais.join(' '));
        }
        if (linhasNormais.length) separadas.push({ tipo: 'texto', linhas: linhasNormais });
        if (alertas.length) separadas.push({ tipo: 'alerta', texto: alertas.join(' ') });
      }

      if (titulo) blocos.push({ tipo: 'secao', titulo, partes: separadas });
      else blocos.push(...separadas);
    }
    return blocos;
  }

  // ------------------------------------------------------------ desenho

  function criar(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = String(texto);
    return el;
  }

  function icone(nome) {
    const i = criar('i', `fas ${nome}`);
    i.setAttribute('aria-hidden', 'true');
    return i;
  }

  const classeDoTom = tom => (tom && ['sucesso', 'aviso', 'erro', 'info'].includes(tom) ? ` dlg-valor--${tom}` : '');

  function desenharItens(itens) {
    const lista = criar('dl', 'dlg-itens');
    for (const item of itens || []) {
      if (!item) continue;
      const valor = item.valor === undefined || item.valor === null ? '' : String(item.valor);
      const longo = valor.length > 38;
      const linha = criar('div', `dlg-item${longo ? ' dlg-item--texto' : ''}`);
      const rotulo = criar('dt', 'dlg-item__rotulo');
      if (item.tag) {
        const tag = criar('span', 'dlg-tag', item.tag);
        if (item.dica) tag.title = item.dica;
        rotulo.appendChild(tag);
      }
      if (item.rotulo) rotulo.appendChild(criar('span', '', item.rotulo));
      if (!item.tag && item.dica) rotulo.title = item.dica;
      linha.appendChild(rotulo);
      if (valor) linha.appendChild(criar('dd', `dlg-item__valor${classeDoTom(item.tom)}`, valor));
      if (item.detalhe) linha.appendChild(criar('dd', 'dlg-item__detalhe', item.detalhe));
      lista.appendChild(linha);
    }
    return lista;
  }

  function desenharLista(itens) {
    const ul = criar('ul', 'dlg-lista');
    for (const t of itens || []) if (t) ul.appendChild(criar('li', '', t));
    return ul;
  }

  function desenharTexto(linhas) {
    const frag = document.createDocumentFragment();
    for (const linha of [].concat(linhas || [])) if (linha) frag.appendChild(criar('p', 'dlg-paragrafo', linha));
    return frag;
  }

  function quadro(classe, nomeIcone, texto) {
    const caixa = criar('div', classe);
    caixa.append(icone(nomeIcone), criar('span', '', texto));
    return caixa;
  }

  /** Um bloco de `estruturarTexto` (ou uma parte de seção) no corpo. */
  function desenharBloco(bloco) {
    if (bloco.tipo === 'texto') return desenharTexto(bloco.linhas);
    if (bloco.tipo === 'lista') return bloco.titulo ? desenharSecao({ titulo: bloco.titulo, lista: bloco.itens }) : desenharLista(bloco.itens);
    if (bloco.tipo === 'itens') return desenharSecao({ titulo: bloco.titulo, itens: bloco.itens });
    if (bloco.tipo === 'alerta') return quadro('dlg-alerta', 'fa-triangle-exclamation', bloco.texto);
    if (bloco.tipo === 'secao') {
      const secao = desenharSecao({ titulo: bloco.titulo });
      for (const parte of bloco.partes || []) secao.appendChild(desenharBloco(parte));
      return secao;
    }
    return document.createDocumentFragment();
  }

  function desenharSecao({ titulo, icone: nomeIcone, texto, lista, itens }) {
    const secao = criar('section', 'dlg-secao');
    if (titulo) {
      const h = criar('h4', 'dlg-secao__titulo');
      if (nomeIcone) h.appendChild(icone(nomeIcone));
      h.appendChild(criar('span', '', titulo));
      secao.appendChild(h);
    }
    if (texto) secao.appendChild(desenharTexto(texto));
    if (lista?.length) secao.appendChild(desenharLista(lista));
    if (itens?.length) secao.appendChild(desenharItens(itens));
    return secao;
  }

  function desenharResumo(cartoes) {
    const grade = criar('div', 'dlg-resumo');
    for (const c of cartoes || []) {
      if (!c) continue;
      const cartao = criar('div', 'dlg-resumo__cartao');
      cartao.appendChild(criar('span', 'dlg-resumo__rotulo', c.rotulo));
      cartao.appendChild(criar('span', `dlg-resumo__valor${classeDoTom(c.tom)}`, c.valor));
      if (c.dica) cartao.appendChild(criar('span', 'dlg-resumo__dica', c.dica));
      grade.appendChild(cartao);
    }
    return grade;
  }

  /** O corpo inteiro: texto organizado + resumo + seções + alerta + nota. */
  function desenharCorpo({ message, resumo, secoes, alerta, nota }) {
    const corpo = criar('div', 'dlg-corpo');
    const blocos = estruturarTexto(message);
    const estruturado = Boolean(resumo?.length || secoes?.length || alerta || nota);
    const soUmaFrase = blocos.length === 1 && blocos[0].tipo === 'texto' && blocos[0].linhas.length === 1
      && blocos[0].linhas[0].length <= 160;
    if (soUmaFrase && !estruturado) {
      corpo.appendChild(criar('p', 'dlg-lead', blocos[0].linhas[0]));
    } else {
      for (const bloco of blocos) corpo.appendChild(desenharBloco(bloco));
    }
    if (resumo?.length) corpo.appendChild(desenharResumo(resumo));
    for (const secao of secoes || []) if (secao) corpo.appendChild(desenharSecao(secao));
    if (alerta) corpo.appendChild(quadro('dlg-alerta', 'fa-triangle-exclamation', alerta));
    if (nota) corpo.appendChild(quadro('dlg-nota', 'fa-circle-info', nota));
    return { corpo, rico: estruturado || blocos.length > 2 || String(message || '').length > 280 };
  }

  function createDialog({
    title,
    subtitle,
    message,
    variant = 'info',
    tom,
    icone: iconeProprio,
    resumo,
    secoes,
    alerta,
    nota,
    largura,
    confirmVariant,
    onConfirm,
    onCancel,
    confirmText,
    cancelText,
    okText
  } = {}) {

    // Remove dialog antigo se existir
    document.querySelectorAll('dialog[data-dialog-padrao]')
      .forEach(d => d.remove());

    const isConfirm = variant === 'confirm';
    const resolveLabel = (customLabel, fallback) => {
      if (typeof customLabel !== 'string') {
        return fallback;
      }
      const trimmed = customLabel.trim();
      return trimmed ? trimmed : fallback;
    };
    const confirmLabel = resolveLabel(confirmText, 'Confirmar');
    const cancelLabel = resolveLabel(cancelText, 'Cancelar');
    const okLabel = resolveLabel(okText, 'OK');
    const tomFinal = TONS[tom] ? tom : (TOM_DO_VARIANT[variant] || 'info');

    // 🔥 DIALOG NATIVO (TOP LAYER)
    const dialog = document.createElement('dialog');
    dialog.setAttribute('data-dialog-padrao', 'true');
    dialog.setAttribute('aria-modal', 'true');

    const { corpo, rico } = desenharCorpo({ message, resumo, secoes, alerta, nota });
    const larga = largura === 'larga' || (largura !== 'normal' && rico);
    Object.assign(dialog.style, {
      padding: '0',
      border: 'none',
      background: 'transparent',
      // Sem uma largura no hospedeiro o cartão encolheria para o tamanho do texto.
      width: larga ? 'min(40rem, calc(100vw - 2rem))' : 'min(30rem, calc(100vw - 2rem))',
      maxWidth: 'none',
      maxHeight: 'none',
      overflow: 'visible',
      color: '#fff'
    });

    const cartao = criar('div', `dlg-cartao dlg-cartao--${tomFinal}`);
    const topo = criar('div', 'dlg-topo');
    const circulo = criar('div', 'dlg-icone');
    circulo.appendChild(icone(iconeProprio || TONS[tomFinal]));
    const idTitulo = `dlgTitulo${Date.now()}`;
    const h3 = criar('h3', 'dlg-titulo', title || (isConfirm ? 'Confirmação' : 'Aviso'));
    h3.id = idTitulo;
    dialog.setAttribute('aria-labelledby', idTitulo);
    topo.append(circulo, h3);
    if (subtitle) topo.appendChild(criar('p', 'dlg-subtitulo', subtitle));

    const rodape = criar('div', 'dlg-rodape');
    // Cor do confirmar: 'danger' para o que desfaz ou apaga, 'success' para o que conclui.
    const CLASSE_DO_BOTAO = { danger: 'btn-danger', success: 'btn-success', primary: 'btn-primary', warning: 'btn-warning' };
    const confirmBtn = criar('button', isConfirm ? (CLASSE_DO_BOTAO[confirmVariant] || 'btn-warning') : 'btn-primary', isConfirm ? confirmLabel : okLabel);
    confirmBtn.type = 'button';
    confirmBtn.setAttribute('data-confirm', '');
    rodape.appendChild(confirmBtn);
    let cancelBtn = null;
    if (isConfirm) {
      cancelBtn = criar('button', 'btn-neutral', cancelLabel);
      cancelBtn.type = 'button';
      cancelBtn.setAttribute('data-cancel', '');
      rodape.appendChild(cancelBtn);
    }

    cartao.append(topo, corpo, rodape);
    // Sem corpo (só título): não fica um vão vazio entre o título e os botões.
    if (!corpo.childNodes.length) corpo.remove();
    dialog.appendChild(cartao);
    document.body.appendChild(dialog);

    let fechado = false;
    const close = result => {
      if (fechado) return;
      fechado = true;
      dialog.close();
      dialog.remove();
      result ? onConfirm?.() : onCancel?.();
    };

    confirmBtn.onclick = () => close(true);
    cancelBtn && (cancelBtn.onclick = () => close(false));

    dialog.addEventListener('cancel', e => {
      e.preventDefault();
      close(false);
    });

    dialog.showModal(); // 🔥 TOP LAYER
    confirmBtn.focus();

    return { close: () => close(false) };
  }

  function openDialogAsync(opcoes = {}) {
    return new Promise(resolve => {
      createDialog({
        ...opcoes,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });
  }

  window.DialogPadrao = {
    open: createDialog,
    openAsync: openDialogAsync,
    info: (options = {}) => openDialogAsync({ ...options, variant: options.variant === 'erro' ? 'erro' : 'info' }),
    confirm: (options = {}) => openDialogAsync({ ...options, variant: 'confirm' }),
    estruturarTexto
  };
})();
