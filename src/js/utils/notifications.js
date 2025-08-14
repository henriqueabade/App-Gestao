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
  popup.style.zIndex = '10000';
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
window.Notifications = window.Notifications || { showToast, createPopup };


