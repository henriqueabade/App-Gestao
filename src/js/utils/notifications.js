/**
 * Utility functions for displaying toast notifications and generic pop-up positioning.
 *
 * Usage:
 *   import { showToast, createPopup, positionPopup, positionPopupAboveCenter } from './utils/notifications.js';
 *
 *   const popup = createPopup('<p>Content</p>');
 *   positionPopup(targetElement, popup); // positions near the element
 *   positionPopupAboveCenter(targetElement, existingPopover); // centers above the element
 */

let notificationContainer;

/**
 * Display a toast message with optional type (info, success, error).
 * @param {string} message - Message to display.
 * @param {string} [type='info'] - Style of the toast.
 */
export function showToast(message, type = 'info') {
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

window.showToast = window.showToast || showToast;

/**
 * Create a generic popup element appended to the document body.
 * @param {string} html - HTML content for the popup.
 * @param {string} [className='absolute z-50'] - Additional classes.
 * @returns {HTMLElement} The created popup element.
 */
export function createPopup(html, className = 'absolute z-50') {
    const popup = document.createElement('div');
    popup.className = className;
    popup.style.position = 'absolute';
    popup.style.zIndex = '10000';
    popup.innerHTML = html;
    document.body.appendChild(popup);
    return popup;
}

window.createPopup = window.createPopup || createPopup;

/**
 * Position a popup near a target element, avoiding viewport overflow.
 * Prefers placing the popup to the bottom-right of the target.
 * @param {HTMLElement} target - The reference element.
 * @param {HTMLElement} popup - The popup element to position.
 * @param {number} [margin=8] - Margin around the popup.
 */
export function positionPopup(target, popup, margin = 8) {
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

window.positionPopup = window.positionPopup || positionPopup;

/**
 * Center a popup above a target element.
 * Useful for small tooltip-like popovers.
 * @param {HTMLElement} target - The reference element.
 * @param {HTMLElement} popup - The popup element to position.
 * @param {number} [margin=4] - Margin between target and popup.
 */
export function positionPopupAboveCenter(target, popup, margin = 4) {
    const rect = target.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - popupRect.width / 2;
    let top = rect.top - popupRect.height - margin;
    left = Math.max(margin, Math.min(left, window.innerWidth - popupRect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - popupRect.height - margin));
    popup.style.left = `${left + window.scrollX}px`;
    popup.style.top = `${top + window.scrollY}px`;
}

window.positionPopupAboveCenter = window.positionPopupAboveCenter || positionPopupAboveCenter;

