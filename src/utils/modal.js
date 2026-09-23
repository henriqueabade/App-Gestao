const ModalManager = (() => {
  const modals = new Map();
  const readyModals = new Set();
  // Token used to ensure only the latest open() call displays a modal.
  // Any call to closeAll() increments this token, invalidating in-flight opens.
  let openToken = 0;
  const modalConfigs = {
  };

  function setupEmptyStates(wrapper) {
    wrapper.querySelectorAll('table').forEach(table => {
      const tbody = table.tBodies[0];
      if (!tbody) return;
      const empty = document.createElement('div');
      empty.className = 'modal-empty-state hidden py-12 flex flex-col items-center justify-center text-center px-4';
      empty.innerHTML = `
        <div class="rounded-full bg-[var(--color-primary-opacity)] p-8 mb-6">
          <i class="fas fa-box-open text-[var(--color-primary)] text-8xl"></i>
        </div>
        <h3 class="text-lg font-medium text-white">Nenhum resultado encontrado</h3>
      `;
      table.parentNode.insertBefore(empty, table.nextSibling);
      const check = () => {
        const visible = Array.from(tbody.querySelectorAll('tr')).filter(r =>
          r.style.display !== 'none' && !r.classList.contains('hidden') && !r.hidden
        );
        if (visible.length === 0) {
          table.classList.add('hidden');
          empty.classList.remove('hidden');
        } else {
          table.classList.remove('hidden');
          empty.classList.add('hidden');
        }
      };
      new MutationObserver(check).observe(tbody, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden']
      });
      check();
    });
  }

  function ensureHighZIndex(element, minZIndex = 2000) {
    if (!element) return;
    const zClassRegex = /^z-(?:\[(\d+)\]|(\d+))$/;
    let currentZIndex = null;
    element.classList.forEach(className => {
      const match = className.match(zClassRegex);
      if (!match) return;
      const value = Number(match[1] ?? match[2]);
      if (!Number.isNaN(value)) {
        currentZIndex = currentZIndex === null ? value : Math.max(currentZIndex, value);
      }
    });
    if (currentZIndex !== null && currentZIndex >= minZIndex) return;
    [...element.classList].forEach(className => {
      if (zClassRegex.test(className)) {
        element.classList.remove(className);
      }
    });
    element.classList.add(`z-[${minZIndex}]`);
  }

  function mergeModalTemplate(templateHtml, contentHtml) {
    const parser = new DOMParser();
    const templateDoc = parser.parseFromString(templateHtml, 'text/html');
    const contentDoc = parser.parseFromString(contentHtml, 'text/html');
    const slots = ['header', 'body', 'footer'];
    const copyAttributes = (target, source, ignored = []) => {
      if (!target || !source) return;
      const ignoreSet = new Set(ignored);
      Array.from(source.attributes).forEach(attr => {
        if (ignoreSet.has(attr.name)) return;
        if (attr.name === 'class') {
          target.className = attr.value;
          return;
        }
        target.setAttribute(attr.name, attr.value);
      });
    };
    const contentHasSlots = Boolean(
      contentDoc.querySelector('[data-modal-slot], [data-modal-header], [data-modal-body], [data-modal-footer]')
    );

    const overlayTarget = templateDoc.querySelector('[data-modal-overlay]');
    const overlaySource = contentDoc.querySelector('[data-modal-overlay]');
    if (overlaySource) {
      copyAttributes(overlayTarget, overlaySource, ['data-modal-overlay']);
    }

    const dialogTarget = templateDoc.querySelector('[data-modal-dialog]');
    const dialogSource = contentDoc.querySelector('[data-modal-dialog]');
    if (dialogSource) {
      copyAttributes(dialogTarget, dialogSource, ['data-modal-dialog']);
    }

    slots.forEach(slot => {
      const target = templateDoc.querySelector(`[data-modal-slot="${slot}"]`);
      if (!target) return;
      const source = contentDoc.querySelector(`[data-modal-slot="${slot}"]`)
        || contentDoc.querySelector(`[data-modal-${slot}]`);
      if (source) {
        copyAttributes(target, source, [`data-modal-${slot}`, 'data-modal-slot']);
        target.innerHTML = source.innerHTML;
      }
    });

    if (!contentHasSlots) {
      const bodySlot = templateDoc.querySelector('[data-modal-slot="body"]');
      if (bodySlot) {
        bodySlot.innerHTML = contentDoc.body.innerHTML;
      }
    }

    return templateDoc.body.innerHTML.trim();
  }

  async function buildModalWrapper(html) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    ensureHighZIndex(wrapper.firstElementChild);
    document.body.appendChild(wrapper);
    document.body.classList.add('overflow-hidden');
    setupEmptyStates(wrapper);
    return wrapper;
  }

  /**
   * Tira da página a cópia anterior DESTE mesmo modal, antes de pendurar a
   * nova.
   *
   * Abrir duas vezes o mesmo modal (o "Enviar" do Visualizar, por exemplo)
   * deixava a primeira cópia para trás: o mapa só guarda a última, e a antiga
   * ficava órfã no corpo da página. Com dois elementos de mesmo id, o script
   * do modal novo pegava o FANTASMA no getElementById — os botões eram
   * ligados nele — e o `close` tirava o invisível: era daí que vinha o modal
   * que "não fecha" no Voltar/Cancelar.
   *
   * Não dispara `modalFechado`: não é o usuário desistindo da tela, é a mesma
   * tela sendo trocada — quem ouve o fechamento (o Visualizar, por exemplo)
   * não pode reagir como se o filho tivesse sido fechado.
   */
  function descartarCopiaAntiga(overlayId) {
    const anterior = modals.get(overlayId);
    if (anterior) {
      anterior.remove();
      modals.delete(overlayId);
    }
    if (!overlayId) return;
    document.querySelectorAll(`#${overlayId}Overlay`).forEach(elemento => {
      // Só o que o `open` pendurou tem a forma <body> › wrapper › overlay.
      // Overlay que veio no HTML da página (o `exitOverlay` do menu) não é
      // nosso e não se mexe.
      const wrapper = elemento.parentElement;
      if (wrapper && wrapper !== document.body && wrapper.parentElement === document.body) wrapper.remove();
    });
  }

  async function open(htmlPath, scriptPath, overlayId, keepExisting = false) {
    if (arguments.length === 1) {
      const cfg = modalConfigs[htmlPath];
      if (!cfg) return;
      overlayId = htmlPath;
      scriptPath = cfg.script;
      htmlPath = cfg.html;
    }

    // Closing existing modals invalidates older open() calls via openToken.
    if (!keepExisting) closeAll();
    readyModals.delete(overlayId);
    // Increment and store token so async steps know if they should continue.
    const token = ++openToken;

    const resp = await fetch(htmlPath);
    if (token !== openToken) return;
    const html = await resp.text();
    if (token !== openToken) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    ensureHighZIndex(wrapper.firstElementChild);
    if (token !== openToken) return;
    descartarCopiaAntiga(overlayId);
    document.body.appendChild(wrapper);
    document.body.classList.add('overflow-hidden');
    setupEmptyStates(wrapper);

    if (scriptPath) {
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = scriptPath;
      wrapper.appendChild(script);
    }

    modals.set(overlayId, wrapper);

    // Ponto único onde TODO modal aberto por aqui fica conhecido pela
    // preservação de trabalho. Antes só os modais abertos via
    // openModalWithSpinner se registravam, então os empilhados (ex.: itens do
    // processo sobre "Novo Produto") nunca eram reabertos após a desconexão.
    try {
      window.__registrarModalAberto?.({ htmlPath, scriptPath, overlayId });
    } catch (err) {
      console.error('[estado] falha ao registrar a abertura do modal', err);
    }
  }

  async function openWithTemplate({
    templatePath,
    contentPath,
    scriptPath,
    overlayId,
    keepExisting = false
  } = {}) {
    if (!templatePath || !contentPath || !overlayId) return;

    if (!keepExisting) closeAll();
    readyModals.delete(overlayId);
    const token = ++openToken;

    const [templateResp, contentResp] = await Promise.all([
      fetch(templatePath),
      fetch(contentPath)
    ]);
    if (token !== openToken) return;
    const [templateHtml, contentHtml] = await Promise.all([
      templateResp.text(),
      contentResp.text()
    ]);
    if (token !== openToken) return;

    const mergedHtml = mergeModalTemplate(templateHtml, contentHtml);
    if (token !== openToken) return;
    descartarCopiaAntiga(overlayId);
    const wrapper = await buildModalWrapper(mergedHtml);

    if (scriptPath) {
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = scriptPath;
      wrapper.appendChild(script);
    }

    modals.set(overlayId, wrapper);
  }

  /** O spinner da casa (o mesmo de openModalWithSpinner), sem innerHTML. */
  function criarSpinner() {
    const caixa = document.createElement('div');
    caixa.id = 'modalLoading';
    caixa.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    caixa.style.zIndex = 'var(--z-dialog)';
    const indicador = document.createElement('div');
    indicador.className = 'app-loading-indicator app-loading-indicator--compact';
    indicador.setAttribute('aria-hidden', 'true');
    const orbita = document.createElement('span');
    orbita.className = 'module-loading-orbit';
    const nucleo = document.createElement('span');
    nucleo.className = 'module-loading-core';
    const logo = document.createElement('img');
    logo.src = '../assets/Logo.ico';
    logo.alt = '';
    nucleo.appendChild(logo);
    indicador.append(orbita, nucleo);
    caixa.appendChild(indicador);
    return caixa;
  }

  /**
   * Abre um modal com o spinner da casa e só o revela quando ele avisa que
   * está PRONTO — `pedidoModalLoaded` (Pedidos) ou `Modal.signalReady`.
   *
   * É o que pedidos.js já fazia no openPedidoModal. Faltava para os modais
   * que abrem POR CIMA de outro: lá eles ou nasciam na tela vazios ("um
   * pedaço do modal e depois os dados") ou, quando esperavam o aviso — o
   * Emitir NF-e e o Importar boletos —, ficavam escondidos para sempre e o
   * botão parecia morto.
   *
   * `minSpinnerMs` segura a revelação para o spinner não "piscar"; o relógio
   * de segurança revela assim mesmo se o aviso nunca vier, para ninguém ficar
   * preso atrás de uma tela escura.
   */
  function openWithSpinner(htmlPath, scriptPath, overlayId, {
    keepExisting = false,
    minSpinnerMs = 500,
    timeoutMs = 15000
  } = {}) {
    const spinner = criarSpinner();
    document.body.appendChild(spinner);
    const inicio = Date.now();
    let encerrado = false;
    let relogio = null;

    const desligar = () => {
      window.removeEventListener('pedidoModalLoaded', aoAvisar);
      window.removeEventListener('modal-ready', aoAvisar);
      window.removeEventListener('modalFechado', aoFechar);
      if (relogio) clearTimeout(relogio);
    };
    const revelar = () => {
      if (encerrado) return;
      encerrado = true;
      desligar();
      const aplicar = () => {
        spinner.remove();
        const alvo = document.getElementById(`${overlayId}Overlay`);
        alvo?.classList.remove('hidden');
        alvo?.removeAttribute('aria-hidden');
      };
      const resta = Math.max(0, minSpinnerMs - (Date.now() - inicio));
      if (resta <= 0) aplicar();
      else setTimeout(aplicar, resta);
    };
    function aoAvisar(evento) {
      if (evento?.detail === overlayId) revelar();
    }
    function aoFechar(evento) {
      if (evento?.detail !== overlayId || encerrado) return;
      encerrado = true;
      desligar();
      spinner.remove();
    }

    // Os ouvintes entram DEPOIS da chamada: o trecho síncrono de `open` pode
    // fechar este mesmo id (closeAll ao reabrir), e esse fechamento não é o
    // nosso — ouvi-lo tiraria o spinner antes da hora.
    const aberto = open(htmlPath, scriptPath, overlayId, keepExisting);
    window.addEventListener('pedidoModalLoaded', aoAvisar);
    window.addEventListener('modal-ready', aoAvisar);
    window.addEventListener('modalFechado', aoFechar);
    relogio = setTimeout(revelar, timeoutMs);
    return aberto;
  }

  function close(overlayId) {
    if (!readyModals.has(overlayId)) {
      readyModals.add(overlayId);
      window.dispatchEvent(new CustomEvent('modal-ready', { detail: overlayId }));
    }
    readyModals.delete(overlayId);
    const wrapper = modals.get(overlayId);
    if (wrapper) {
      wrapper.remove();
      modals.delete(overlayId);
    }
    if (modals.size === 0) {
      document.body.classList.remove('overflow-hidden');
    }

    // Fechar avisa, como abrir já avisava.
    //
    // Quem abre um sub-modal para colher UMA resposta precisa saber que a
    // pessoa desistiu — senão fica esperando para sempre, e o botão que abriu
    // o sub-modal nunca sai do estado de carregando.
    window.dispatchEvent(new CustomEvent('modalFechado', { detail: overlayId }));
  }

  function closeAll() {
    // Increment token so any pending open() calls know they were cancelled.
    openToken++;
    Array.from(modals.keys()).forEach(id => close(id));
    document.querySelectorAll('.order-detail-overlay.open')
      .forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.contact-overlay.active')
      .forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.client-overlay')
      .forEach(el => (el.style.display = 'none'));
    document.querySelectorAll('.modal.active')
      .forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.create-menu.active')
      .forEach(el => el.classList.remove('active'));
    document.getElementById('overlay')?.classList.remove('active');
    if (modals.size === 0) {
      document.body.classList.remove('overflow-hidden');
    }
    if (window.hideRawMaterialInfoPopup) {
      window.hideRawMaterialInfoPopup();
    }
  }

  function signalReady(overlayId) {
    readyModals.add(overlayId);
    window.dispatchEvent(new CustomEvent('modal-ready', { detail: overlayId }));
  }

  function waitForReady(overlayId, timeout = 15000) {
    if (readyModals.has(overlayId)) return Promise.resolve();
    return new Promise(resolve => {
      let timer = null;
      const cleanup = () => {
        window.removeEventListener('modal-ready', onReady);
        if (timer) clearTimeout(timer);
      };
      const onReady = event => {
        if (event?.detail !== overlayId) return;
        cleanup();
        resolve();
      };
      window.addEventListener('modal-ready', onReady);
      if (timeout > 0) {
        timer = setTimeout(() => {
          cleanup();
          resolve();
        }, timeout);
      }
    });
  }

  return { open, openWithTemplate, openWithSpinner, close, closeAll, signalReady, waitForReady };
})();

window.ModalManager = ModalManager;
window.Modal = ModalManager;

function createModalLoadingOverlay() {
  const existing = document.getElementById('modalLoading');
  if (existing) existing.remove();
  const spinner = document.createElement('div');
  spinner.id = 'modalLoading';
  spinner.className = 'fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center';
  spinner.innerHTML = '<div class="app-loading-indicator app-loading-indicator--compact" aria-hidden="true"><span class="module-loading-orbit"></span><span class="module-loading-core"><img src="../assets/Logo.ico" alt=""></span></div>';
  return spinner;
}

async function withModalLoading(duration = 0, action) {
  const spinner = createModalLoadingOverlay();
  document.body.appendChild(spinner);
  try {
    if (duration > 0) {
      await new Promise(resolve => setTimeout(resolve, duration));
    }
    if (typeof action === 'function') {
      return await action();
    }
    return action;
  } finally {
    if (spinner.isConnected) spinner.remove();
  }
}

window.withModalLoading = withModalLoading;

function closeAllModals() {
  ModalManager.closeAll();
  document.querySelectorAll('.order-detail-overlay.open')
    .forEach(el => el.classList.remove('open'));
  document.querySelectorAll('.contact-overlay.active')
    .forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.client-overlay')
    .forEach(el => (el.style.display = 'none'));
  document.querySelectorAll('.modal.active')
    .forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.create-menu.active')
    .forEach(el => el.classList.remove('active'));
  document.getElementById('overlay')?.classList.remove('active');
  document.body.classList.remove('overflow-hidden');
  if (window.hideRawMaterialInfoPopup) {
    window.hideRawMaterialInfoPopup();
  }
}

window.closeAllModals = closeAllModals;

// Close any active overlays when changing modules
document.addEventListener('module-change', closeAllModals);
