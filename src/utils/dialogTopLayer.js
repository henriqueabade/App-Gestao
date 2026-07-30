/**
 * Garante que TODA caixa de diálogo fique à frente de qualquer outro elemento.
 *
 * O problema: os diálogos do app conviviam em dois mundos diferentes.
 *  - `DialogPadrao` usa `<dialog>.showModal()`, que entra na *top layer* do
 *    navegador — acima de qualquer z-index, sempre.
 *  - Os diálogos montados à mão (confirmações, escolhas, campos de digitação)
 *    eram `<div>` com `z-index: var(--z-dialog)`.
 * Um z-index, por alto que seja, NUNCA passa por cima da top layer. Então
 * qualquer diálogo montado à mão que abrisse junto de um `DialogPadrao` ficava
 * escondido atrás dele — e sem clique, porque `showModal()` deixa o resto do
 * documento inerte.
 *
 * A solução: um único mecanismo. Todo elemento marcado com
 * `.app-message-overlay` (ou `.warning-overlay`) é promovido automaticamente
 * para a top layer, embrulhado em um `<dialog>` hospedeiro invisível. Assim a
 * regra passa a ser simples e previsível: o último diálogo aberto fica na
 * frente, e nenhum modal/menu/toast consegue cobri-lo.
 *
 * O elemento original continua sendo o mesmo nó — `querySelector`,
 * `getElementById` e `remove()` do código que criou o diálogo seguem valendo.
 * Quando ele sai do DOM, o hospedeiro se fecha e se remove sozinho.
 */
(() => {
  const SELETOR = '.app-message-overlay, .warning-overlay';
  const ATRIBUTO_HOST = 'data-dialog-host';

  function injetarEstilos() {
    if (document.getElementById('dialogTopLayerEstilos')) return;
    const style = document.createElement('style');
    style.id = 'dialogTopLayerEstilos';
    style.textContent = `
      dialog[${ATRIBUTO_HOST}] {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        max-width: none;
        max-height: none;
        margin: 0;
        padding: 0;
        border: none;
        background: transparent;
        overflow: visible;
        color: inherit;
      }
      /* O próprio conteúdo já escurece o fundo; o backdrop nativo dobraria. */
      dialog[${ATRIBUTO_HOST}]::backdrop { background: transparent; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function jaPromovido(el) {
    return el.dataset.topLayer === 'true' || el.closest('dialog') !== null;
  }

  /**
   * Um overlay escondido não pode ser promovido: `showModal()` deixaria o
   * documento inteiro inerte sem nada visível na tela.
   */
  function estaVisivel(el) {
    if (el.hidden || el.classList.contains('hidden')) return false;
    const estilo = window.getComputedStyle(el);
    return estilo.display !== 'none' && estilo.visibility !== 'hidden';
  }

  function promover(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    if (el.dataset.semTopLayer === 'true') return;
    if (!el.isConnected || jaPromovido(el)) return;
    if (!estaVisivel(el)) return;

    injetarEstilos();

    const host = document.createElement('dialog');
    host.setAttribute(ATRIBUTO_HOST, 'true');

    el.parentNode.insertBefore(host, el);
    host.appendChild(el);
    el.dataset.topLayer = 'true';

    // Esc fechando o hospedeiro deixaria o conteúdo no DOM mas invisível (um
    // <dialog> fechado não renderiza), e o módulo nunca saberia. Quem fecha o
    // diálogo continua sendo o código que o criou.
    host.addEventListener('cancel', evento => evento.preventDefault());

    const encerrar = () => {
      observador.disconnect();
      if (host.open) {
        try {
          host.close();
        } catch (_) {
          /* já fechado */
        }
      }
      host.remove();
    };

    // O código do módulo remove o próprio overlay (`el.remove()`): quando isso
    // acontecer, o hospedeiro vazio precisa sair junto.
    const observador = new MutationObserver(() => {
      if (!el.isConnected || el.parentNode !== host) encerrar();
    });
    observador.observe(host, { childList: true });

    try {
      host.showModal();
    } catch (err) {
      // Sem top layer disponível, o overlay volta para o body e continua
      // valendo o z-index alto do CSS — nada se perde.
      console.error('[dialogTopLayer] showModal falhou, mantendo z-index', err);
      observador.disconnect();
      host.parentNode?.insertBefore(el, host);
      delete el.dataset.topLayer;
      host.remove();
    }
  }

  function varrer(raiz) {
    if (!raiz || raiz.nodeType !== Node.ELEMENT_NODE) return;
    if (raiz.matches?.(SELETOR)) promover(raiz);
    raiz.querySelectorAll?.(SELETOR).forEach(promover);
  }

  function iniciar() {
    injetarEstilos();
    varrer(document.body);
    new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes') {
          // Overlay que nasceu escondido e só depois foi revelado.
          const alvo = mutation.target;
          if (alvo?.nodeType === Node.ELEMENT_NODE && alvo.matches?.(SELETOR)) {
            promover(alvo);
          }
          return;
        }
        mutation.addedNodes.forEach(varrer);
      });
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  window.DialogTopLayer = { promover };
})();
