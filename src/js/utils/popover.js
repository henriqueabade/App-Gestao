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
// A mesma armadilha vale para `transform` e `filter` em qualquer ancestral, o
// que torna isso difícil de prever olhando só o CSS do popover.
//
// A saída é tirar o popover de dentro do ancestral borrado: movido para o
// `<body>`, `fixed` volta a significar "em relação à janela" e a conta passa a
// bater. É o mesmo caminho que qualquer biblioteca de tooltip acaba tomando.
//
// ---------------------------------------------------------------------------
// E O POPOVER NÃO PODE SAIR DA TELA
//
// Um popover ancorado numa linha do fim da tabela abriria abaixo da borda de
// baixo, e o que ele mostra ficaria inalcançável. Por isso, quando não cabe
// embaixo, ele vai para cima do ícone; quando não cabe à direita, encosta na
// borda direita.

(function () {
  const MARGEM = 8;

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
      // Um popover de uma abertura anterior pode ter ficado no <body> depois
      // de o modal fechar. Dois elementos com o mesmo id fazem
      // `getElementById` devolver o antigo — que não está mais ligado a nada —
      // e o novo nunca aparece. Cair nisso é fácil e o sintoma ("o popover
      // parou de abrir") não aponta para a causa.
      if (popover.id) {
        for (const velho of document.querySelectorAll(`#${CSS.escape(popover.id)}`)) {
          if (velho !== popover) velho.remove();
        }
      }
      document.body.appendChild(popover);
    }

    popover.style.position = 'fixed';
    // Precisa estar visível para ser medido: com `visibility: hidden` a caixa
    // tem tamanho, mas o `.show` também muda o `transform`, e medir antes dele
    // daria uma altura que não é a final.
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
   * Chamado quando o modal dono dele fecha: o elemento foi movido para fora do
   * modal e não sai junto com ele.
   */
  function descartar(popover) {
    if (popover && popover.parentElement === document.body) popover.remove();
  }

  window.Popover = { abrir, fechar, descartar };
})();
