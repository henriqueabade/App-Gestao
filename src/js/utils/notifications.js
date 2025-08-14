(function () {
    /**
     * Exibe um toast com estilos padrões.
     * Exemplo: showToast('Salvo com sucesso', 'success');
     */
    let notificationContainer;
    function showToast(message, type = 'info') {
        if (!notificationContainer) {
            notificationContainer = document.getElementById('notification');
            if (!notificationContainer) {
                notificationContainer = document.createElement('div');
                notificationContainer.id = 'notification';
                notificationContainer.className = 'fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 mt-20 space-y-2 z-[10000]';
                document.body.appendChild(notificationContainer);
            }
        }
        const div = document.createElement('div');
        let toastClass = 'toast-info';
        if (type === 'success') toastClass = 'toast-success';
        else if (type === 'error') toastClass = 'toast-error';
        div.className = `toast ${toastClass}`;
        div.textContent = message;
        notificationContainer.appendChild(div);
        setTimeout(() => {
            div.classList.add('opacity-0');
            setTimeout(() => div.remove(), 500);
        }, 3000);
    }

    /**
     * Cria e posiciona um popup próximo ao elemento alvo.
     * Retorna o elemento criado para que o chamador possa removê-lo posteriormente.
     * Exemplo:
     *   const popup = showPopup(botao, '<p>Detalhes</p>');
     *   popup.addEventListener('mouseleave', () => hidePopup(popup));
     */
    function showPopup(target, htmlContent, margin = 8) {
        const popup = document.createElement('div');
        popup.className = 'absolute z-50';
        popup.style.position = 'absolute';
        popup.style.zIndex = '10000';
        popup.innerHTML = htmlContent;
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

        popup.style.left = `${left + window.scrollX}px`;
        popup.style.top = `${top + window.scrollY}px`;
        return popup;
    }

    /** Remove um popup previamente criado. */
    function hidePopup(popup) {
        if (popup) popup.remove();
    }

    window.showToast = showToast;
    window.showPopup = showPopup;
    window.hidePopup = hidePopup;
})();
