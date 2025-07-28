function initOrders() {
    const toast = document.getElementById('toast');
    const toastClose = document.querySelector('.toast-close');
    const newOrderBtn = document.querySelector('.btn-primary');

    if (newOrderBtn) {
        newOrderBtn.addEventListener('click', () => {
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 5000);
        });
    }

    if (toastClose) {
        toastClose.addEventListener('click', () => {
            toast.classList.remove('show');
        });
    }

    const sortableHeaders = document.querySelectorAll('th.cursor-pointer');
    sortableHeaders.forEach(header => {
        header.addEventListener('click', function() {
            const sortIcon = this.querySelector('.sort-icon');
            document.querySelectorAll('.sort-icon').forEach(i => i.classList.remove('asc', 'desc'));
            if (sortIcon.classList.contains('asc')) {
                sortIcon.classList.remove('asc');
                sortIcon.classList.add('desc');
            } else if (sortIcon.classList.contains('desc')) {
                sortIcon.classList.remove('desc');
            } else {
                sortIcon.classList.add('asc');
            }
            console.log(`Sorting by ${this.textContent.trim()} ${sortIcon.classList.contains('asc') ? 'ascending' : sortIcon.classList.contains('desc') ? 'descending' : 'default'}`);
        });
    });

    const statusFilter = document.querySelector('select:first-of-type');
    const periodFilter = document.querySelector('select:last-of-type');

    if (statusFilter) {
        statusFilter.addEventListener('change', function() {
            console.log(`Filtering by status: ${this.value}`);
        });
    }

    if (periodFilter) {
        periodFilter.addEventListener('change', function() {
            console.log(`Filtering by period: ${this.value}`);
        });
    }

    const searchInput = document.querySelector('.search-input input');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            console.log(`Searching for: ${this.value}`);
        });
    }

    const viewButtons = document.querySelectorAll('.view-order');
    const orderOverlay = document.getElementById('modal-orders-detail');
    const backBtn = document.getElementById('btnBackOrder');
    const closeBtn = document.getElementById('btnCloseOrder');

    function openOrderDetailModal() {
        if (orderOverlay) {
            orderOverlay.classList.add('open');
            document.body.classList.add('overflow-hidden');
        }
    }

    function closeOrderDetailModal() {
        if (orderOverlay) {
            orderOverlay.classList.remove('open');
            document.body.classList.remove('overflow-hidden');
        }
        if (window.closeAllModals) window.closeAllModals();
    }

    viewButtons.forEach(btn => {
        btn.addEventListener('click', openOrderDetailModal);
    });

    if (backBtn) backBtn.addEventListener('click', closeOrderDetailModal);
    if (closeBtn) closeBtn.addEventListener('click', closeOrderDetailModal);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrders);
} else {
    initOrders();
}
