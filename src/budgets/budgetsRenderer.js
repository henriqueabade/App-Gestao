function initBudgets() {
    const newBudgetToast = document.getElementById('newBudgetToast');
    const pdfToast = document.getElementById('pdfToast');
    const toastCloseButtons = document.querySelectorAll('.toast-close');
    const newBudgetBtn = document.getElementById('newBudgetBtn');
    const pdfButtons = document.querySelectorAll('.generate-pdf');

    function showToast(toast) {
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 5000);
    }

    if (newBudgetBtn) {
        newBudgetBtn.addEventListener('click', () => showToast(newBudgetToast));
    }

    pdfButtons.forEach(btn => {
        btn.addEventListener('click', () => showToast(pdfToast));
    });

    toastCloseButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const toast = btn.closest('.toast');
            if (toast) toast.classList.remove('show');
        });
    });

    const sortableHeaders = document.querySelectorAll('th');
    sortableHeaders.forEach(header => {
        header.addEventListener('click', function () {
            const sortIcon = this.querySelector('.sort-icon');
            if (!sortIcon) return;
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

    const statusFilter = document.querySelector('select:nth-of-type(1)');
    const periodFilter = document.querySelector('select:nth-of-type(2)');
    const sellerFilter = document.querySelector('select:nth-of-type(3)');

    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            console.log(`Filtering by status: ${statusFilter.value}`);
        });
    }

    if (periodFilter) {
        periodFilter.addEventListener('change', () => {
            console.log(`Filtering by period: ${periodFilter.value}`);
        });
    }

    if (sellerFilter) {
        sellerFilter.addEventListener('change', () => {
            console.log(`Filtering by seller: ${sellerFilter.value}`);
        });
    }

    const searchInput = document.querySelector('.search-input input');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            console.log(`Searching for: ${this.value}`);
        });
    }

    async function openBudgetEditModal() {
        await Modal.open(
            '../budgets/editBudget.html',
            '../budgets/editBudgetRenderer.js',
            'modal-budgets-edit'
        );
    }

    document.querySelectorAll('button[title="Editar"], .budget-card-footer button:nth-child(2)').forEach(btn => {
        btn.addEventListener('click', openBudgetEditModal);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBudgets);
} else {
    initBudgets();
}
