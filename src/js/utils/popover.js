// Posiciona um popover ao lado do (i) que o abriu.
//
// ---------------------------------------------------------------------------
// POR QUE ISSO PRECISOU DE UM ARQUIVO
//
// O popover aparecia longe do ícone — às vezes centenas de pixels abaixo e à
// esquerda. A causa não é o cálculo: é onde o elemento mora.
//
// `backdrop-filter` (o `backdrop-blur-xl` dos modais) cria um BLOCO DE
// CONTENÇÃO. Dentro dele, `position: fixed` deixa de ser relativo à janela e
// passa a ser relativo ao elemento borrado. As coordenadas de
// `getBoundingClientRect()` continuam sendo da JANELA, então o popover é
// posicionado com os números certos no sistema de referência errado — e o erro
// é exatamente a distância entre o canto da janela e o canto do modal.
//
// A saída é tirar o popover de dentro do ancestral borrado: movido para o
// `<body>`, `fixed` volta a significar "em relação à janela" e a conta passa a
// bater.
//
// ---------------------------------------------------------------------------
// MAS SAIR DE LÁ CUSTA DUAS COISAS
//
// 1. A CAMADA. Dentro do modal o popover herdava a pilha dele; no `<body>` ele
//    passa a competir com o próprio modal. E `Modal.open` eleva TODO modal a
//    `z-[2000]` (ver `ensureHighZIndex` em src/utils/modal.js) — o `z-[1200]`
//    escrito no HTML é trocado na abertura. Um popover com z-index menor fica
//    ATRÁS, e o sintoma engana: ele está lá, do tamanho certo, na posição
//    certa, e o que se vê é a área borrada do modal por cima.
//
//    Por isso a camada é CALCULADA a partir do que está na tela, e não fixada
//    num número: qualquer mudança no `minZIndex` do modal continuaria valendo.
//
// 2. A LIMPEZA. O elemento não sai mais junto com o modal nem com o módulo.
//    Sem devolvê-lo, ele fica pendurado no `<body>` — e foi assim que um
//    popover da lista de leituras apareceu por cima de Relatórios e de
//    Produtos, congelado, sem nada que o fizesse sumir.
//
// ---------------------------------------------------------------------------
// E O POPOVER NÃO PODE SAIR DA TELA
//
// Ancorado numa linha do fim da tabela, ele abriria abaixo da borda de baixo e
// o que mostra ficaria inalcançável. Quando não cabe embaixo, vai para cima do
// ícone; quando não cabe à direita, encosta na borda direita.

(function () {
  const MARGEM = 8;

  /** Piso: acima do `minZIndex` que `Modal.open` aplica aos overlays. */
  const PISO = 2100;

  /** Teto: abaixo do aviso de desconexão, que precisa cobrir tudo. */
  const TETO = 2147482000;

  /** Popovers que foram movidos para o `<body>`, para poder devolvê-los. */
  const movidos = new Set();

  /**
   * Uma camada acima de tudo o que está aberto agora.
   *
   * Lida da tela em vez de fixada: `Modal.open` reescreve o z-index de cada
   * overlay na abertura, e um número cravado aqui envelheceria em silêncio na
   * primeira vez que aquele valor mudasse.
   */
  function camadaAcimaDeTudo() {
    let maior = PISO;
    for (const el of document.querySelectorAll('body > div')) {
      const overlay = el.matches('[id$="Overlay"]') ? el : el.querySelector('[id$="Overlay"]');
      if (!overlay) continue;
      const z = Number(window.getComputedStyle(overlay).zIndex);
      if (Number.isFinite(z) && z >= maior) maior = z + 10;
    }
    return Math.min(maior, TETO);
  }

  /**
   * Mostra `popover` ancorado em `ancora`.
   *
   * O popover é movido para o `<body>` na primeira abertura e fica lá: mover a
   * cada abertura recriaria os nós filhos e perderia o foco de quem estivesse
   * digitando dentro dele.
   */
  function abrir(popover, ancora) {
    if (!popover || !ancora) return;

    if (popover.parentElement !== document.body) {
      // Um popover de uma abertura anterior pode ter ficado no <body>. Dois
      // elementos com o mesmo id fazem `getElementById` devolver o antigo —
      // que não está mais ligado a nada — e o novo nunca aparece.
      if (popover.id) {
        for (const velho of document.querySelectorAll(`#${CSS.escape(popover.id)}`)) {
          if (velho !== popover) velho.remove();
        }
      }
      // De onde ele veio, para poder voltar quando o dono fechar.
      popover.__popoverOrigem = popover.parentElement || null;
      document.body.appendChild(popover);
      movidos.add(popover);
    }

    popover.style.position = 'fixed';
    popover.style.zIndex = String(camadaAcimaDeTudo());
    // Precisa estar visível para ser medido: a caixa só tem altura depois de
    // `.show`, e medir antes daria zero.
    popover.classList.add('show');

    const r = ancora.getBoundingClientRect();
    const caixa = popover.getBoundingClientRect();

    // Embaixo do ícone; se não couber, em cima dele.
    let topo = r.bottom + MARGEM;
    if (topo + caixa.height > window.innerHeight - MARGEM) {
      const acima = r.top - caixa.height - MARGEM;
      topo = acima >= MARGEM ? acima : Math.max(MARGEM, window.innerHeight - caixa.height - MARGEM);
    }

    // Alinhado à esquerda do ícone, sem passar da borda direita.
    let esquerda = r.left;
    if (esquerda + caixa.width > window.innerWidth - MARGEM) {
      esquerda = window.innerWidth - caixa.width - MARGEM;
    }
    if (esquerda < MARGEM) esquerda = MARGEM;

    popover.style.top = `${Math.round(topo)}px`;
    popover.style.left = `${Math.round(esquerda)}px`;
  }

  function fechar(popover) {
    popover?.classList.remove('show');
  }

  /**
   * Tira o popover do `<body>` de vez.
   *
   * Chamado quando o dono dele fecha: o elemento foi movido para fora e não sai
   * junto.
   */
  function descartar(popover) {
    if (!popover) return;
    fechar(popover);
    if (popover.parentElement === document.body) popover.remove();
    movidos.delete(popover);
  }

  /**
   * Devolve TODOS os popovers pendurados no `<body>`.
   *
   * É a rede de segurança para quem esqueceu de chamar `descartar` — e para o
   * caso em que não há a quem chamar: trocar de módulo substitui o conteúdo da
   * página inteira, e o popover que estava aberto continuaria flutuando por
   * cima do módulo seguinte, congelado, sem nada que o fizesse sumir.
   */
  function limparTudo() {
    for (const popover of [...movidos]) descartar(popover);
  }

  // Trocar de módulo troca o conteúdo de `#content`. Observar isso é o que
  // torna a limpeza automática: nenhum módulo precisa lembrar de fazê-la.
  function observarTrocaDeModulo() {
    const conteudo = document.getElementById('content');
    if (!conteudo || typeof MutationObserver !== 'function') return;
    new MutationObserver(mutacoes => {
      // Só a substituição do módulo interessa — não cada linha de tabela que
      // entra e sai.
      if (mutacoes.some(m => m.removedNodes?.length)) limparTudo();
    }).observe(conteudo, { childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observarTrocaDeModulo, { once: true });
  } else {
    observarTrocaDeModulo();
  }

  // Rolar ou redimensionar move a âncora e deixa o popover para trás, apontando
  // para lugar nenhum.
  //
  // `capture: true` porque a rolagem que importa não é a da janela: a grade de
  // revisão rola por DENTRO, e o evento de um contêiner não sobe até `window`
  // na fase de bolha. Sem isto, rolar a tabela com um (i) aberto deixaria a
  // caixa parada no ar, apontando para uma linha que já saiu de vista.
  window.addEventListener('resize', limparTudo);
  window.addEventListener('scroll', limparTudo, { capture: true, passive: true });

  window.Popover = { abrir, fechar, descartar, limparTudo, PISO };
})();
