(() => {
  const escapeHtml = text =>
    text == null ? '' :
    String(text).replace(/[&<>"']/g, m =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])
    );

  function createDialog({
    title,
    message,
    variant = 'info',
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

    // 🔥 DIALOG NATIVO (TOP LAYER)
    const dialog = document.createElement('dialog');
    dialog.setAttribute('data-dialog-padrao', 'true');

    Object.assign(dialog.style, {
      padding: '0',
      border: 'none',
      background: 'transparent'
    });

    dialog.innerHTML = `
      <div style="
        background: rgba(20,20,20,.92);
        backdrop-filter: blur(18px);
        color: #fff;
        padding: 24px;
        border-radius: 16px;
        max-width: 420px;
        width: 100%;
        box-shadow: 0 30px 90px rgba(0,0,0,.8);
        text-align: center;
      ">
        <h2 style="font-size:18px;font-weight:600;margin-bottom:12px">
          ${escapeHtml(title || (isConfirm ? 'Confirmação' : 'Aviso'))}
        </h2>

        <p style="opacity:.85;margin-bottom:20px">
          ${escapeHtml(message || '')}
        </p>

        <div style="display:flex;justify-content:center;gap:16px">
          ${isConfirm ? `
            <button data-cancel style="
              padding:8px 18px;
              border-radius:8px;
              background:#444;
              color:#fff;
              border:none;
            ">${cancelLabel}</button>
          ` : ''}

          <button data-confirm style="
            padding:8px 18px;
            border-radius:8px;
            background:#c8b24a;
            color:#000;
            font-weight:600;
            border:none;
          ">
            ${isConfirm ? confirmLabel : okLabel}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const confirmBtn = dialog.querySelector('[data-confirm]');
    const cancelBtn = dialog.querySelector('[data-cancel]');

    const close = result => {
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

  function openDialogAsync({
    title,
    message,
    variant = 'info',
    confirmText,
    cancelText,
    okText
  } = {}) {
    return new Promise(resolve => {
      createDialog({
        title,
        message,
        variant,
        confirmText,
        cancelText,
        okText,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });
  }

  window.DialogPadrao = {
    open: createDialog,
    openAsync: openDialogAsync,
    info: (options = {}) => openDialogAsync({ ...options, variant: 'info' }),
    confirm: (options = {}) => openDialogAsync({ ...options, variant: 'confirm' })
  };
})();
