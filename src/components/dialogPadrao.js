(() => {
  const escapeHtml = text => {
    if (text === null || text === undefined) return '';
    return String(text).replace(/[&<>"']+/g, match => {
      switch (match) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return match;
      }
    });
  };

  const iconByVariant = variant => {
    if (variant === 'erro') return 'fa-triangle-exclamation';
    if (variant === 'confirm') return 'fa-circle-question';
    return 'fa-circle-info';
  };

  const normalizeVariant = variant => {
    if (variant === 'erro' || variant === 'confirm') return variant;
    return 'info';
  };

  const createDialog = ({
    title,
    message,
    variant = 'info',
    onConfirm,
    onCancel,
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    okText = 'OK'
  } = {}) => {
    const normalizedVariant = normalizeVariant(variant);
    const isConfirm = normalizedVariant === 'confirm';

    const overlay = document.createElement('div');
    overlay.className = 'warning-overlay';

    const modal = document.createElement('div');
    modal.className = 'warning-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const titleId = `dialogPadraoTitle-${Date.now()}`;
    modal.setAttribute('aria-labelledby', titleId);

    const iconWrap = document.createElement('div');
    iconWrap.className = 'warning-icon';

    const circle = document.createElement('div');
    circle.className = 'warning-icon-circle';
    const icon = document.createElement('i');
    icon.classList.add('fas', iconByVariant(normalizedVariant));
    circle.appendChild(icon);
    iconWrap.appendChild(circle);

    const titleEl = document.createElement('h2');
    titleEl.id = titleId;
    titleEl.className = 'warning-title text-lg';
    titleEl.innerHTML = escapeHtml(title || (isConfirm ? 'Confirmação' : 'Aviso'));

    const messageEl = document.createElement('p');
    messageEl.className = 'warning-text mt-3';
    const safeMessage = escapeHtml(message || '');
    messageEl.innerHTML = safeMessage.replace(/\n/g, '<br>');

    const actions = document.createElement('div');
    actions.className = isConfirm ? 'warning-actions warning-actions--confirm' : 'warning-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'warning-button';
    confirmBtn.dataset.action = 'confirm';
    confirmBtn.textContent = isConfirm ? confirmText : okText;

    let cancelBtn = null;
    if (isConfirm) {
      cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.dataset.action = 'cancel';
      cancelBtn.textContent = cancelText;
      cancelBtn.className = 'warning-button warning-button-secondary';
      actions.appendChild(cancelBtn);
    }

    actions.appendChild(confirmBtn);

    modal.appendChild(iconWrap);
    modal.appendChild(titleEl);
    modal.appendChild(messageEl);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      modal.classList.add('show');
      confirmBtn.focus();
    });

    const cleanup = result => {
      modal.classList.remove('show');
      setTimeout(() => {
        if (overlay.isConnected) overlay.remove();
      }, 160);
      if (result) {
        if (typeof onConfirm === 'function') onConfirm();
      } else if (typeof onCancel === 'function') {
        onCancel();
      }
    };

    overlay.addEventListener('click', event => {
      if (event.target !== overlay) return;
      cleanup(!isConfirm);
    });

    confirmBtn.addEventListener('click', () => cleanup(true));
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => cleanup(false));
    }

    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        cleanup(!isConfirm);
      }
    });

    return {
      close: () => cleanup(false)
    };
  };

  window.DialogPadrao = {
    open: createDialog
  };
})();
