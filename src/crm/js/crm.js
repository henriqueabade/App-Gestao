function initCrm() {
    const infoIcons = document.querySelectorAll('#crm-section .cursor-help');

    infoIcons.forEach(icon => {
        icon.addEventListener('mouseenter', () => {
            const tooltip = document.createElement('div');
            tooltip.className = 'fixed z-50 bg-gray-800 text-white text-xs rounded py-1 px-2';
            tooltip.textContent = icon.getAttribute('title') || 'Informações';
            document.body.appendChild(tooltip);
            const rect = icon.getBoundingClientRect();
            tooltip.style.top = rect.bottom + 6 + 'px';
            tooltip.style.left = rect.left + 'px';
            icon._tooltip = tooltip;
        });
        icon.addEventListener('mouseleave', () => {
            if (icon._tooltip) {
                icon._tooltip.remove();
                icon._tooltip = null;
            }
        });
    });

    const sidebarItems = document.querySelectorAll('.sidebar-item');
    sidebarItems.forEach(item => {
        if (!item.classList.contains('disabled')) {
            item.addEventListener('click', () => {
                sidebarItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        }
    });
    if (window.feather) feather.replace();
}

window.initCrm = initCrm;
