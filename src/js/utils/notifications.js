/**
 * Utility functions for toast notifications and contextual pop-ups.
 *
 * These helpers centralize UI feedback so that modules can simply call
 * `showToast(message, type)` to display temporary messages and
 * `showPopup(target, html, margin)` to render pop-ups anchored to a
 * specific element. Use `hidePopup(popup)` to remove them.
 */

let notificationContainer;

/**
 * Display a toast notification with a message and optional type.
 * @param {string} message - Text to display.
 * @param {'info'|'success'|'error'} [type='info'] - Toast style.
 */
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
 * Create a pop-up element with provided HTML and append it to the body.
 * @param {string} html - Markup for the pop-up content.
 * @returns {HTMLElement} The newly created pop-up element.
 */
function createPopup(html) {
    const popup = document.createElement('div');
    popup.className = 'absolute z-50';
    popup.style.position = 'absolute';
    popup.style.zIndex = '10000';
    popup.innerHTML = html;
    document.body.appendChild(popup);
    return popup;
}

/**
 * Position a pop-up relative to a target element, keeping it within viewport.
 * @param {HTMLElement} popup - The pop-up element to position.
 * @param {HTMLElement} target - Element to anchor the pop-up to.
 * @param {number} [margin=8] - Space in pixels between target and pop-up.
 */
function positionPopup(popup, target, margin = 8) {
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
}

/**
 * Remove a pop-up element created by {@link createPopup}.
 * @param {HTMLElement} popup - The pop-up to remove.
 */
function hidePopup(popup) {
    if (popup) popup.remove();
}

// Expose utilities globally for non-module scripts.
window.showToast = window.showToast || showToast;
window.createPopup = window.createPopup || createPopup;
window.positionPopup = window.positionPopup || positionPopup;
window.hidePopup = window.hidePopup || hidePopup;


