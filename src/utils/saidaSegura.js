/**
 * Sair de um modal sem perder o que foi digitado.
 *
 * Um Esc distraído, ou um clique em "Voltar" para conferir uma informação,
 * apagava um formulário inteiro sem perguntar nada. Este arquivo põe uma
 * confirmação no caminho — mas SÓ quando há o que perder.
 *
 * COMO ELE SE ENCAIXA SEM TOCAR NOS 40 MODAIS
 * -------------------------------------------
 * Ele não fecha modal nenhum: apenas ATRASA a saída. Escuta o Esc e o clique
 * nos botões de sair em fase de CAPTURA, ou seja, antes do próprio modal; se
 * houver alteração pendente, engole o evento e pergunta. Se a resposta for sim,
 * marca o modal como limpo e REEMITE o mesmo gesto — daí em diante tudo segue
 * pelo caminho de fechamento que cada modal já tem, com a limpeza que ele já
 * faz.
 *
 * POR QUE NÃO INTERCEPTAR `Modal.close`
 * -------------------------------------
 * Porque ele também é chamado DEPOIS de salvar. Perguntar "vai perder os dados"
 * a quem acabou de gravar seria pior do que não perguntar nada. Aqui a pergunta
 * nasce de um gesto de SAIR — tecla ou botão —, nunca de código concluindo uma
 * ação.
 *
 * O QUE CONTA COMO "TEM DADOS"
 * ----------------------------
 * O usuário ter mudado algum campo dentro daquele modal. Não é comparação com o
 * estado inicial: modal de edição chega preenchido, e preenchido de forma
 * assíncrona, então comparar geraria alarme falso em tela que ninguém tocou.
 * Alterar e desfazer à mão continua contando como alteração — conservador de
 * propósito: o preço de perguntar à toa é um clique; o de não perguntar é o
 * trabalho da pessoa.
 *
 * COMO ESCAPAR DA GUARDA
 * ----------------------
 *   data-sem-guarda  em um CAMPO  -> digitar nele não suja o modal (busca,
 *                                    filtro, campo de conferência)
 *                    em um BOTÃO  -> a guarda ignora o botão: ou ele não sai
 *                                    do modal (é ação, apesar do nome), ou sai
 *                                    de propósito sem perguntar
 *   SaidaSegura.limpar(raiz)      -> some com a pendência (use após salvar)
 */
(function () {
  const SUJOS = new WeakSet();
  // Modais em que a pessoa já encostou. Ver `marcar()`.
  const TOCADOS = new WeakSet();

  /**
   * Um modal aberto é um overlay visível; o último no DOM está por cima —
   * `Modal.open` empilha cada um com um `appendChild` no body.
   */
  function estaNaTela(el) {
    if (!el.isConnected || el.classList.contains('hidden')) return false;
    // Nada de `offsetParent`: os overlays são `position: fixed`, e para
    // esses ele é SEMPRE null — o filtro descartaria todo modal aberto.
    return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
  }

  function modalDoTopo() {
    const abertos = Array.from(document.querySelectorAll('[id$="Overlay"]')).filter(estaNaTela);
    return abertos.length ? abertos[abertos.length - 1] : null;
  }

  function overlayDe(elemento) {
    return elemento?.closest?.('[id$="Overlay"]') || null;
  }

  function estaSujo(raiz) {
    return Boolean(raiz && SUJOS.has(raiz));
  }

  function sujar(raiz) {
    if (raiz) SUJOS.add(raiz);
  }

  /** Esquece a pendência — chame depois de salvar. */
  function limpar(raiz) {
    const alvo = raiz || modalDoTopo();
    if (alvo) SUJOS.delete(alvo);
  }

  /**
   * Campos que o usuário mexeu contam; os de apoio, não.
   *
   * Busca e filtro dentro de um modal não são "dados preenchidos": digitar num
   * campo de procura para achar um item e depois desistir não deveria virar
   * pergunta.
   */
  function campoConta(alvo) {
    if (!alvo || alvo.disabled || alvo.readOnly) return false;
    if (alvo.type === 'hidden' || alvo.type === 'search') return false;
    if (alvo.closest && alvo.closest('[data-sem-guarda]')) return false;
    return ['INPUT', 'SELECT', 'TEXTAREA'].includes(alvo.tagName) || alvo.isContentEditable === true;
  }

  /** O botão pediu para sair do modal? */
  function ehBotaoDeSair(elemento) {
    const botao = elemento && elemento.closest
      ? elemento.closest('button, [role="button"], a')
      : null;
    if (!botao) return null;
    if (botao.hasAttribute('data-sem-guarda')) return null;
    if (botao.hasAttribute('data-modal-sair')) return botao;
    // Convenção do projeto: voltarX / fecharX / cancelarX, e a variante em
    // sufixo dos modais de IA e Permissões (iaConfigFechar). Fora dela,
    // `data-modal-sair` declara a saída e `data-sem-guarda` tira o botão.
    return /^(voltar|fechar|cancelar)|(voltar|fechar|cancelar)$/i.test(botao.id || '')
      ? botao
      : null;
  }

  const TEXTO = {
    title: 'Sair sem salvar?',
    message: 'Você preencheu dados que ainda não foram salvos.\nSe sair agora, eles serão perdidos.',
    confirmText: 'Sair e perder',
    cancelText: 'Continuar editando'
  };

  /**
   * A caixa de confirmação — a mesma do resto do programa.
   *
   * `DialogPadrao` usa `<dialog>` nativo, que sobe para a top layer: a caixa
   * aparece acima do modal por mais alto que seja o z-index dele.
   *
   * O Esc aqui responde à CAIXA, e responde NÃO — sair sem querer é
   * justamente o que se está evitando. Por isso ele é engolido em captura,
   * antes de chegar ao `<dialog>` (que fecharia sozinho) e antes de voltar
   * ao modal de trás (que fecharia junto, levando os dados).
   */
  function perguntar() {
    if (!window.DialogPadrao || typeof window.DialogPadrao.open !== 'function') {
      // Sem o componente padrão, ainda é melhor perguntar do que não perguntar.
      return Promise.resolve(window.confirm(TEXTO.title + '\n\n' + TEXTO.message));
    }
    return new Promise(resolve => {
      let respondido = false;
      const responder = valor => {
        if (respondido) return;
        respondido = true;
        document.removeEventListener('keydown', aoTeclar, true);
        resolve(valor);
      };
      function aoTeclar(e) {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        caixa.close();
      }
      const caixa = window.DialogPadrao.open({
        ...TEXTO,
        variant: 'confirm',
        onConfirm: () => responder(true),
        onCancel: () => responder(false)
      });
      document.addEventListener('keydown', aoTeclar, true);
    });
  }

  /** Já perguntando? Um segundo Esc não pode abrir uma segunda caixa. */
  let perguntando = false;

  async function gatilho(raiz, repetirGesto) {
    if (perguntando) return;
    perguntando = true;
    let sair = false;
    try {
      sair = await perguntar();
    } finally {
      perguntando = false;
    }
    if (!sair) return;
    // Limpo: o gesto repetido agora atravessa, e o modal fecha do jeito dele.
    limpar(raiz);
    repetirGesto();
  }

  function instalar() {
    if (window.__saidaSeguraInstalada) return;
    window.__saidaSeguraInstalada = true;

    // Encostou no modal: clicou nele ou digitou dentro dele. Não suja nada
    // por si só — só abre a porta para as alterações feitas por código
    // valerem (ver `marcar`).
    const tocar = evento => {
      if (!evento.isTrusted) return;
      const raiz = overlayDe(evento.target);
      if (raiz) TOCADOS.add(raiz);
    };
    document.addEventListener('pointerdown', tocar, true);
    document.addEventListener('keydown', tocar, true);

    /**
     * Alteração dentro de um modal o marca como pendente.
     *
     * `isTrusted` separa quem digitou de quem preencheu por código: modal de
     * edição chega cheio, e vários deles despacham `input`/`change` à mão
     * depois de carregar (prazo em Orçamentos, item em Estoque). Sem esse
     * filtro, abrir e apertar Esc já perguntaria — com a tela intocada.
     *
     * Depois que a pessoa encosta no modal, o despacho por código volta a
     * contar: é assim que campo com máscara, seletor customizado e afins
     * gravam o que ela acabou de escolher.
     */
    const marcar = evento => {
      if (!campoConta(evento.target)) return;
      const raiz = overlayDe(evento.target);
      if (!raiz) return;
      if (!evento.isTrusted && !TOCADOS.has(raiz)) return;
      sujar(raiz);
    };
    document.addEventListener('input', marcar, true);
    document.addEventListener('change', marcar, true);

    document.addEventListener('keydown', evento => {
      if (evento.key !== 'Escape' || perguntando) return;
      const raiz = modalDoTopo();
      if (!estaSujo(raiz)) return;
      evento.preventDefault();
      evento.stopImmediatePropagation();
      gatilho(raiz, () => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true
        }));
      });
    }, true);

    document.addEventListener('click', evento => {
      if (perguntando) return;
      const botao = ehBotaoDeSair(evento.target);
      if (!botao) return;
      const raiz = overlayDe(botao);
      if (!estaSujo(raiz)) return;
      evento.preventDefault();
      evento.stopImmediatePropagation();
      gatilho(raiz, () => botao.click());
    }, true);
  }

  window.SaidaSegura = {
    instalar,
    limpar,
    marcarAlterado: sujar,
    temAlteracao: raiz => estaSujo(raiz || modalDoTopo()),
    // Expostos para teste: são as duas decisões que erram em silêncio.
    __testes__: { campoConta, ehBotaoDeSair }
  };

  instalar();
})();
