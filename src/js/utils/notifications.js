/**
 * Utilities for toast notifications and contextual pop-ups.
 *
 * Usage:
 *   showToast('Saved successfully', 'success');
 *   const popup = createPopup('<p>Info</p>');
 *   positionPopup(triggerElement, popup, { margin: 4, position: 'top-center' });
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

function createPopup(content, className = 'absolute z-50') {
    const popup = document.createElement('div');
    popup.className = className;
    popup.style.position = 'absolute';
    popup.style.zIndex = '10000';
    popup.innerHTML = content;
    document.body.appendChild(popup);
    return popup;
}

function positionPopup(target, popup, { margin = 8, position = 'auto' } = {}) {
    const rect = target.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();

    if (position === 'top-center') {
        const left = rect.left + rect.width / 2 - popupRect.width / 2;
        const top = rect.top - popupRect.height - margin;
        popup.style.left = `${left + window.scrollX}px`;
        popup.style.top = `${top + window.scrollY}px`;
        return;
    }

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
}

window.showToast = window.showToast || showToast;
window.createPopup = window.createPopup || createPopup;
window.positionPopup = window.positionPopup || positionPopup;
