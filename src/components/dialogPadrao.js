(() => {
  const escapeHtml = text =>
    text == null ? '' :
    String(text).replace(/[&<>"']/g, m =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])
    );

  // A mensagem é renderizada com `white-space: pre-line`, então um "\n" vira
  // quebra de linha de verdade. Sem isso toda lista enviada em várias linhas
  // (orçamentos a converter, itens que falharam) desabava num parágrafo único e
  // ilegível. O alinhamento à esquerda só entra quando há mais de uma linha:
  // mensagem curta continua centralizada, como sempre foi.
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
      background: 'transparent',
      // O cartão usa `w-full`: sem uma largura no hospedeiro ele encolheria
      // para o tamanho do texto e a caixa ficaria espremida.
      width: 'min(32rem, calc(100vw - 2rem))',
      maxWidth: 'none',
      color: '#fff'
    });

    // Mesma aparência das caixas montadas à mão pelos modais (o "Item já
    // adicionado" de Orçamentos é o modelo): cartão `glass-surface`, título,
    // texto e os botões do próprio app. Antes daqui saía um cartão preto com
    // estilos inline que não combinava com nada — dois padrões de diálogo
    // convivendo na mesma tela.
    const alinhamento = /\n/.test(String(message || '')) ? 'text-left' : 'text-center';
    dialog.innerHTML = `
      <div class="max-w-lg w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
          <h3 class="text-lg font-semibold mb-4 text-white">
            ${escapeHtml(title || (isConfirm ? 'Confirmação' : 'Aviso'))}
          </h3>
          <p class="text-sm text-gray-300 mb-6 ${alinhamento}" style="white-space:pre-line">
            ${escapeHtml(message || '')}
          </p>
          <div class="flex justify-center gap-4">
            <button data-confirm class="${isConfirm ? 'btn-warning' : 'btn-primary'} px-4 py-2 rounded-lg text-white font-medium">
              ${isConfirm ? confirmLabel : okLabel}
            </button>
            ${isConfirm ? `
              <button data-cancel class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">${cancelLabel}</button>
            ` : ''}
          </div>
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
