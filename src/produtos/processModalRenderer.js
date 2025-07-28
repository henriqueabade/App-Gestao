(() => {
  const overlay = document.getElementById('modal-products-process');
  const backBtn = overlay.querySelector('#backBtn');
  const closeBtn = overlay.querySelector('#closeBtn');
  // elementos de confirmação não são mais necessários

  function closeProductsProcessModal() {
    Modal.close('modal-products-process');
  }
  backBtn.addEventListener('click', closeProductsProcessModal);
  closeBtn.addEventListener('click', closeProductsProcessModal);

  const clearAllBtn = overlay.querySelector('#clearAllBtn');
  const clearPopup = overlay.querySelector('#clearPopup');
  const clearPopupBackdrop = overlay.querySelector('#clearPopupBackdrop');
  const cancelClearBtn = overlay.querySelector('#cancelClearBtn');
  const confirmClearBtn = overlay.querySelector('#confirmClearBtn');
  const clearToast = overlay.querySelector('#clearToast');

  clearAllBtn.addEventListener('click', () => {
    clearPopup.classList.remove('hidden');
    clearPopupBackdrop.classList.remove('hidden');
  });
  function closeClearPopup() {
    clearPopup.classList.add('hidden');
    clearPopupBackdrop.classList.add('hidden');
  }
  cancelClearBtn.addEventListener('click', closeClearPopup);
  confirmClearBtn.addEventListener('click', () => {
    const tableBody = overlay.querySelector('#itemsTable tbody');
    tableBody.innerHTML = '';
    showToast(clearToast);
    overlay.querySelector('#registerBtn').disabled = true;
    closeClearPopup();
  });

  const deletePopup = overlay.querySelector('#deletePopup');
  const deletePopupBackdrop = overlay.querySelector('#deletePopupBackdrop');
  const cancelDeleteBtn = overlay.querySelector('#cancelDeleteBtn');
  const confirmDeleteBtn = overlay.querySelector('#confirmDeleteBtn');
  const deleteToast = overlay.querySelector('#deleteToast');
  let currentDeleteRow;

  overlay.addEventListener('click', e => {
    const btn = e.target.closest('.delete-item');
    if (btn && !btn.disabled) {
      currentDeleteRow = btn.closest('tr');
      deletePopup.classList.remove('hidden');
      deletePopupBackdrop.classList.remove('hidden');
    }
  });
  function closeDeletePopup() {
    deletePopup.classList.add('hidden');
    deletePopupBackdrop.classList.add('hidden');
  }
  cancelDeleteBtn.addEventListener('click', closeDeletePopup);
  confirmDeleteBtn.addEventListener('click', () => {
    if (currentDeleteRow) currentDeleteRow.remove();
    showToast(deleteToast);
    if (overlay.querySelectorAll('#itemsTable tbody tr').length === 0) {
      overlay.querySelector('#registerBtn').disabled = true;
    }
    closeDeletePopup();
  });

  const insertBtn = overlay.querySelector('#insertBtn');
  const itemSelect = overlay.querySelector('#itemSelect');
  const itemQuantity = overlay.querySelector('#itemQuantity');
  const insertToast = overlay.querySelector('#insertToast');
  const duplicateAlertPopup = overlay.querySelector('#duplicateAlertPopup');
  const duplicateAlertBackdrop = overlay.querySelector('#duplicateAlertBackdrop');
  const confirmDuplicateBtn = overlay.querySelector('#confirmDuplicateBtn');

  insertBtn.addEventListener('click', () => {
    const selectedItemValue = itemSelect.value;
    const selectedItemText = itemSelect.options[itemSelect.selectedIndex].text;
    const quantity = itemQuantity.value;
    if (!selectedItemValue || !quantity || parseFloat(quantity) <= 0) {
      alert('Por favor, selecione um item e informe uma quantidade válida.');
      return;
    }
    if (selectedItemText === 'Pregos sem Cabeça') {
      duplicateAlertPopup.classList.remove('hidden');
      duplicateAlertBackdrop.classList.remove('hidden');
      overlay.querySelectorAll('#itemsTable tbody tr').forEach(row => {
        if (row.cells[0].textContent === 'Pregos sem Cabeça') {
          row.classList.add('highlighted');
        }
      });
      return;
    }
    showToast(insertToast);
    overlay.querySelector('#registerBtn').disabled = false;
    itemSelect.selectedIndex = 0;
    itemQuantity.value = '1';
  });
  function closeDuplicateAlert() {
    duplicateAlertPopup.classList.add('hidden');
    duplicateAlertBackdrop.classList.add('hidden');
  }
  confirmDuplicateBtn.addEventListener('click', closeDuplicateAlert);

  const registerBtn = overlay.querySelector('#registerBtn');
  const registerPopup = overlay.querySelector('#registerPopup');
  const registerPopupBackdrop = overlay.querySelector('#registerPopupBackdrop');
  const cancelRegisterBtn = overlay.querySelector('#cancelRegisterBtn');
  const confirmRegisterBtn = overlay.querySelector('#confirmRegisterBtn');
  const registerToast = overlay.querySelector('#registerToast');

  registerBtn.addEventListener('click', () => {
    registerPopup.classList.remove('hidden');
    registerPopupBackdrop.classList.remove('hidden');
  });
  function closeRegisterPopup() {
    registerPopup.classList.add('hidden');
    registerPopupBackdrop.classList.add('hidden');
  }
  cancelRegisterBtn.addEventListener('click', closeRegisterPopup);
  confirmRegisterBtn.addEventListener('click', () => {
    showToast(registerToast);
    closeRegisterPopup();
    setTimeout(() => {
      closeProductsProcessModal();
    }, 1000);
  });

  const toastCloseButtons = overlay.querySelectorAll('.toast-close');
  function showToast(toast) {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
  toastCloseButtons.forEach(button => {
    button.addEventListener('click', function() {
      this.closest('.toast').classList.remove('show');
    });
  });

  const updateToast = overlay.querySelector('#updateToast');
  overlay.addEventListener('click', e => {
    const btn = e.target.closest('.edit-quantity');
    if (btn && !btn.disabled) {
      const row = btn.closest('tr');
      const quantityCell = row.cells[1];
      const currentQuantity = quantityCell.textContent;
      const editingHTML = `
                <div class="flex items-center space-x-2">
                    <input type="number" class="form-input w-20" min="0.001" step="0.001" value="${currentQuantity}">
                    <div class="flex space-x-1">
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
                </div>`;
      quantityCell.dataset.originalContent = quantityCell.innerHTML;
      quantityCell.innerHTML = editingHTML;
      const actionButtons = row.querySelector('td:last-child').querySelectorAll('button');
      actionButtons.forEach(b => {
        b.disabled = true;
        b.classList.add('opacity-50');
      });
      const confirmBtn = quantityCell.querySelector('.confirm-edit');
      const cancelBtn = quantityCell.querySelector('.cancel-edit');
      confirmBtn.addEventListener('click', () => {
        const newQuantity = quantityCell.querySelector('input').value;
        if (!newQuantity || parseFloat(newQuantity) <= 0) {
          alert('Por favor, informe uma quantidade válida.');
          return;
        }
        quantityCell.innerHTML = newQuantity;
        actionButtons.forEach(b => {
          b.disabled = false;
          b.classList.remove('opacity-50');
        });
        showToast(updateToast);
      });
      cancelBtn.addEventListener('click', () => {
        quantityCell.innerHTML = quantityCell.dataset.originalContent;
        actionButtons.forEach(b => {
          b.disabled = false;
          b.classList.remove('opacity-50');
        });
      });
      quantityCell.querySelector('input').focus();
    }
  });
})();
