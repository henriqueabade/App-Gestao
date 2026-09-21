/**
 * Utility helpers for user notifications and contextual popups.
 *
 * - showToast(message, type): display a toast with styling based on type
 *   ('info', 'success' or 'error').
 * - createPopup(target, html, options): generate a popup positioned around
 *   the target element, automatically flipping to stay within the viewport.
 *   Returns an object containing the popup element and its computed
 *   coordinates.
 */

let notificationContainer;

function applyContainerFallbackStyles(container) {
  if (!container) return;
  const style = container.style;
  style.position = 'fixed';
  // Popover tem estilo próprio do navegador (`inset: 0`, `margin: auto`,
  // borda, recuo e fundo de "Canvas"): zerado aqui, a caixa continua sendo
  // só a coluna de avisos centralizada de sempre.
  style.inset = 'auto';
  style.left = '50%';
  style.top = '50%';
  style.transform = 'translate(-50%, -50%)';
  style.margin = '0';
  style.marginTop = '5rem';
  style.padding = '0';
  style.border = '0';
  style.background = 'transparent';
  style.color = 'inherit';
  style.overflow = 'visible';
  style.zIndex = '11000';
  style.display = 'flex';
  style.flexDirection = 'column';
  style.alignItems = 'center';
  style.gap = '0.5rem';
  style.pointerEvents = 'none';
}

/*
 * O aviso fica por cima de TUDO, inclusive dos diálogos da top layer.
 *
 * O editor de tarefa (TarefasUI), os diálogos do Calendário e de Tarefas, a
 * importação de planilha, o DialogPadrao e as caixas promovidas por
 * src/utils/dialogTopLayer.js abrem com `<dialog>.showModal()`, que entra na
 * top layer do navegador. Nenhum z-index passa por cima dela: o aviso ficava
 * ATRÁS do modal, só uma mancha borrada pelo vidro.
 *
 * A caixa dos avisos vira um popover manual e entra na top layer também. Lá
 * vale a ordem de chegada — quem entrou por último fica na frente —, então ela
 * é reposta no topo a cada aviso e quando um diálogo abre com aviso na tela.
 * Popover manual não fecha os outros nem rouba o foco do campo em que se está
 * digitando. Sem suporte a popover, fica o z-index de antes.
 *
 * Para repor no topo: esconde, força a atualização de estilo e mostra de
 * novo. O Chromium não tira da top layer na hora quem foi escondido — só na
 * próxima atualização de estilo. Reaberto antes dela, o popover continua na
 * posição antiga, atrás do diálogo que abriu depois dele (foi o que a prévia
 * mostrou). Ler `offsetHeight` faz essa atualização acontecer ali mesmo.
 */
function trazerAvisosParaFrente() {
  const container = notificationContainer;
  if (!container || typeof container.showPopover !== 'function') return;
  if (!container.isConnected) return;
  try {
    if (!container.hasAttribute('popover')) container.setAttribute('popover', 'manual');
    if (container.matches(':popover-open')) container.hidePopover();
    void container.offsetHeight;
    container.showPopover();
  } catch (err) {
    /* sem top layer disponível: vale o z-index */
  }
}

/** Sem aviso na tela, a caixa sai da top layer. */
function recolherAvisosSeVazio() {
  const container = notificationContainer;
  if (!container || container.childElementCount > 0) return;
  if (typeof container.hidePopover !== 'function') return;
  try {
    if (container.matches(':popover-open')) container.hidePopover();
  } catch (err) {
    /* já fechado */
  }
}

let vigiaDeDialogos = null;

/** Diálogo aberto DEPOIS do aviso: o aviso volta para a frente dele. */
function vigiarDialogos() {
  if (vigiaDeDialogos || typeof MutationObserver !== 'function') return;
  if (typeof document === 'undefined' || !document.documentElement) return;
  vigiaDeDialogos = new MutationObserver(registros => {
    if (!notificationContainer || notificationContainer.childElementCount === 0) return;
    const abriuDialogo = registros.some(r => r.target && r.target.tagName === 'DIALOG' && r.target.open);
    if (abriuDialogo) trazerAvisosParaFrente();
  });
  vigiaDeDialogos.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
  });
}

function applyToastFallbackStyles(element, type) {
  if (!element) return;
  const style = element.style;
  style.color = '#ffffff';
  style.padding = '0.5rem 1rem';
  style.borderRadius = '0.375rem';
  style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.15)';
  style.transition = 'opacity 0.5s ease-in-out';
  style.backgroundColor = '#374151';
  // O aviso não tem clique. Por cima de um modal, ele não pode tomar o clique
  // do botão que estiver embaixo dele.
  style.pointerEvents = 'none';

  if (type === 'success') {
    style.backgroundColor = '#16a34a';
  } else if (type === 'error') {
    style.backgroundColor = '#dc2626';
  } else if (type === 'info') {
    style.backgroundColor = '#2563eb';
  }
}

function showToast(message, type = 'info') {
  if (!notificationContainer) {
    notificationContainer = document.getElementById('notification');
    if (!notificationContainer) {
      notificationContainer = document.createElement('div');
      notificationContainer.id = 'notification';
      notificationContainer.className = 'fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 mt-20 space-y-2 z-[11000]';
      document.body.appendChild(notificationContainer);
    }
    applyContainerFallbackStyles(notificationContainer);
  }
  const div = document.createElement('div');
  let toastClass = 'toast-info';
  if (type === 'success') toastClass = 'toast-success';
  else if (type === 'error') toastClass = 'toast-error';
  div.className = `toast ${toastClass}`;
  applyToastFallbackStyles(div, type);
  div.textContent = message;
  notificationContainer.appendChild(div);
  trazerAvisosParaFrente();
  vigiarDialogos();
  setTimeout(() => {
    div.classList.add('opacity-0');
    setTimeout(() => {
      div.remove();
      recolherAvisosSeVazio();
    }, 500);
  }, 3000);
}

function notifyPdfGeneration(message = 'Gerando PDF...') {
  if (typeof showToast === 'function') {
    showToast(message, 'info');
    return;
  }

  const fallback = document.createElement('div');
  fallback.textContent = message;
  fallback.style.position = 'fixed';
  fallback.style.left = '50%';
  fallback.style.top = '2.5rem';
  fallback.style.transform = 'translateX(-50%)';
  fallback.style.backgroundColor = '#2563eb';
  fallback.style.color = '#ffffff';
  fallback.style.padding = '0.75rem 1.5rem';
  fallback.style.borderRadius = '0.75rem';
  fallback.style.boxShadow = '0 10px 25px rgba(37, 99, 235, 0.35)';
  fallback.style.zIndex = '12000';
  fallback.style.fontWeight = '600';
  fallback.style.fontSize = '0.95rem';
  document.body.appendChild(fallback);
  setTimeout(() => fallback.remove(), 3000);
}

async function notifyDesktopOnlyPdf(
  id,
  { message = 'Disponível apenas no aplicativo desktop', type } = {},
) {
  try {
    showToast(message, 'error');
  } catch (err) {
    console.warn('Não foi possível exibir toast padrão, usando alerta simples.', err);
    if (typeof alert === 'function') {
      alert(message); // eslint-disable-line no-alert
    }
  }

  if (!id) return;

  try {
    const fallbackBaseUrl = 'http://localhost:3000';
    let apiBaseUrl;

    try {
      apiBaseUrl = await window.apiConfig?.getApiBaseUrl?.();
    } catch (err) {
      console.warn('Não foi possível recuperar a base da API.', err);
    }

    const normalizedBaseUrl =
      typeof apiBaseUrl === 'string' && apiBaseUrl.trim().length > 0
        ? apiBaseUrl
        : fallbackBaseUrl;

    const pdfUrl = new URL('/pdf', normalizedBaseUrl);
    pdfUrl.searchParams.set('id', String(id));
    if (type) {
      pdfUrl.searchParams.set('tipo', String(type));
    }
    pdfUrl.searchParams.set('apiBaseUrl', normalizedBaseUrl);

    window.open(pdfUrl.toString(), '_blank', 'noopener,noreferrer');
  } catch (err) {
    console.warn('Não foi possível abrir o PDF no navegador.', err);
    try {
      showToast('Não foi possível abrir o PDF no navegador.', 'error');
    } catch (toastErr) {
      console.warn('Não foi possível exibir toast de erro.', toastErr);
      if (typeof alert === 'function') {
        alert('Não foi possível abrir o PDF no navegador.'); // eslint-disable-line no-alert
      }
    }
  }
}

/**
 * Create and position a popup relative to a target element.
 * @param {HTMLElement} target anchor element
 * @param {string} html HTML content for the popup
 * @param {object} [options]
 * @param {number} [options.margin=8] spacing from the target
 * @param {Function} [options.onHide] callback when mouse leaves the popup
 * @returns {{popup: HTMLElement, left: number, top: number}} reference to the popup
 */
function createPopup(target, html, { margin = 8, onHide } = {}) {
  const popup = document.createElement('div');
  popup.className = 'fixed z-50';
  popup.style.position = 'fixed';
  popup.style.zIndex = '11000';
  popup.innerHTML = html;
  document.body.appendChild(popup);

  const rect = target.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();

  let top = rect.bottom + margin;
  if (top + popupRect.height > window.innerHeight) {
    if (rect.top - margin - popupRect.height >= 0) {
      top = rect.top - popupRect.height - margin;
    } else {
      top = Math.max(margin, window.innerHeight - popupRect.height - margin);
    }
  }

  let left = rect.right + margin;
  if (left + popupRect.width > window.innerWidth) {
    if (rect.left - margin - popupRect.width >= 0) {
      left = rect.left - popupRect.width - margin;
    } else {
      left = Math.max(margin, window.innerWidth - popupRect.width - margin);
    }
  }

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  if (typeof onHide === 'function') {
    popup.addEventListener('mouseleave', onHide);
  }

  return { popup, left, top };
}

window.showToast = window.showToast || showToast;
window.createPopup = window.createPopup || createPopup;
window.notifyPdfGeneration = window.notifyPdfGeneration || notifyPdfGeneration;
window.notifyDesktopOnlyPdf = window.notifyDesktopOnlyPdf || notifyDesktopOnlyPdf;
window.Notifications = window.Notifications || {
  showToast,
  createPopup,
  notifyPdfGeneration,
  notifyDesktopOnlyPdf,
};


