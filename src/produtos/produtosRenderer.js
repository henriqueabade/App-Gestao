function initProducts() {
    async function openProductsDetailsModal() {
        ModalManager.closeAll();
        await ModalManager.open('modal-products-details');
    }

    async function openProductsEditModal() {
        ModalManager.closeAll();
        await ModalManager.open('modal-products-edit');
    }

    async function openProductsNewModal() {
        ModalManager.closeAll();
        await ModalManager.open('modal-products-new');
    }

    document.querySelectorAll('.btn-view').forEach(btn => {
        btn.addEventListener('click', openProductsDetailsModal);
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', openProductsEditModal);
    });

    const newBtn = document.getElementById('new-product-btn');
    if (newBtn) newBtn.addEventListener('click', openProductsNewModal);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProducts);
} else {
    initProducts();
}
