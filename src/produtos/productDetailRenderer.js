(() => {
  const stockModalOverlay = document.getElementById('modal-products-details');
  const backBtn = document.getElementById('backBtn');
  const closeBtn = document.getElementById('closeBtn');

  function closeProductsDetailsModal() {
    Modal.close('modal-products-details');
  }

  backBtn?.addEventListener('click', closeProductsDetailsModal);
  closeBtn?.addEventListener('click', closeProductsDetailsModal);

  const editQuantityButtons = document.querySelectorAll('.edit-quantity');

  editQuantityButtons.forEach(button => {
    button.addEventListener('click', function() {
      const row = this.closest('tr');
      const quantityCell = row.querySelector('.quantity-cell');
      const currentQuantity = quantityCell.textContent;
      quantityCell.dataset.originalContent = quantityCell.innerHTML;
      quantityCell.innerHTML = `
        <div class="flex items-center space-x-2">
          <input type="number" class="form-input" value="${currentQuantity}" min="0" style="width: 80px;">
          <button class="text-green-500 hover:text-green-700 confirm-edit" title="Confirmar">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
          </button>
          <button class="text-red-500 hover:text-red-700 cancel-edit" title="Cancelar">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
      `;
      const input = quantityCell.querySelector('input');
      input.focus();
      input.select();

      const confirmBtn = quantityCell.querySelector('.confirm-edit');
      const cancelBtn = quantityCell.querySelector('.cancel-edit');

      confirmBtn.addEventListener('click', function() {
        const newQuantity = input.value;
        quantityCell.innerHTML = newQuantity;
        showToast(document.getElementById('quantityToast'));
      });

      cancelBtn.addEventListener('click', function() {
        quantityCell.innerHTML = quantityCell.dataset.originalContent;
      });
    });
  });

  const deleteItemButtons = document.querySelectorAll('.delete-item');
  const deletePopup = document.getElementById('deletePopup');
  const deletePopupBackdrop = document.getElementById('deletePopupBackdrop');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

  let currentDeleteRow;

  deleteItemButtons.forEach(button => {
    button.addEventListener('click', function() {
      currentDeleteRow = this.closest('tr');
      deletePopup.classList.remove('hidden');
      deletePopupBackdrop.classList.remove('hidden');
    });
  });

  function closeDeletePopup() {
    deletePopup.classList.add('hidden');
    deletePopupBackdrop.classList.add('hidden');
  }

  cancelDeleteBtn.addEventListener('click', closeDeletePopup);

  confirmDeleteBtn.addEventListener('click', function() {
    if (currentDeleteRow) {
      currentDeleteRow.remove();
      showToast(document.getElementById('deleteToast'));
    }
    closeDeletePopup();
  });

  const toastCloseButtons = document.querySelectorAll('.toast-close');

  function showToast(toast) {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  toastCloseButtons.forEach(button => {
    button.addEventListener('click', function() {
      const toast = this.closest('.toast');
      toast.classList.remove('show');
    });
  });
})();
