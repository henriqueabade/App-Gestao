(() => {
  const productModalOverlay = document.getElementById('modal-products-edit');
  const backBtn = document.getElementById('backBtn');
  const closeBtn = document.getElementById('closeBtn');

  function closeProductsEditModal() {
    Modal.close('modal-products-edit');
  }

  backBtn.addEventListener('click', closeProductsEditModal);
  closeBtn.addEventListener('click', closeProductsEditModal);

  const editRegistryDataCheckbox = document.getElementById('editRegistryData');
  const registryInputs = document.querySelectorAll('.form-group input[disabled]');
  editRegistryDataCheckbox.addEventListener('change', function () {
    registryInputs.forEach(input => { input.disabled = !this.checked; });
  });

  const updateOptions = document.querySelectorAll('input[name="updateOption"]');
  const saveBtn = document.getElementById('saveBtn');
  updateOptions.forEach(option => {
    option.addEventListener('change', () => { saveBtn.disabled = false; });
  });

  const startProcessBtn = document.getElementById('startProcessBtn');

  async function openProductsProcessModal() {
    ModalManager.closeAll();
    await ModalManager.open('modal-products-process');
  }

  startProcessBtn?.addEventListener('click', openProductsProcessModal);

  const clearAllBtn = document.getElementById('clearAllBtn');
  const clearPopup = document.getElementById('clearPopup');
  const clearPopupBackdrop = document.getElementById('clearPopupBackdrop');
  const cancelClearBtn = document.getElementById('cancelClearBtn');
  const confirmClearBtn = document.getElementById('confirmClearBtn');
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
    document.querySelectorAll('input[type="number"]').forEach(i => { i.value = '0'; });
    document.querySelectorAll('input[type="radio"]').forEach(r => { r.checked = false; });
    editRegistryDataCheckbox.checked = false;
    registryInputs.forEach(i => { i.disabled = true; });
    saveBtn.disabled = true;
    closeClearPopup();
  });

  const editQuantityButtons = document.querySelectorAll('.edit-quantity');
  const editPopup = document.getElementById('editPopup');
  const editPopupBackdrop = document.getElementById('editPopupBackdrop');
  const newQuantityInput = document.getElementById('newQuantityInput');
  const quantityUnit = document.getElementById('quantityUnit');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const confirmEditBtn = document.getElementById('confirmEditBtn');
  const quantityToast = document.getElementById('quantityToast');
  let currentEditRow;
  editQuantityButtons.forEach(button => {
    button.addEventListener('click', function () {
      currentEditRow = this.closest('tr');
      const currentQuantity = currentEditRow.cells[1].textContent;
      const match = currentQuantity.match(/(\d+)\s+(\w+)/);
      if (match) { newQuantityInput.value = match[1]; quantityUnit.textContent = match[2]; }
      editPopup.classList.remove('hidden');
      editPopupBackdrop.classList.remove('hidden');
    });
  });
  function closeEditPopup() { editPopup.classList.add('hidden'); editPopupBackdrop.classList.add('hidden'); }
  cancelEditBtn.addEventListener('click', closeEditPopup);
  confirmEditBtn.addEventListener('click', () => {
    if (currentEditRow) {
      const newQuantity = newQuantityInput.value;
      const unit = quantityUnit.textContent;
      currentEditRow.cells[1].textContent = `${newQuantity} ${unit}`;
      showToast(quantityToast);
    }
    closeEditPopup();
  });

  const deleteItemButtons = document.querySelectorAll('.delete-item');
  const deletePopup = document.getElementById('deletePopup');
  const deletePopupBackdrop = document.getElementById('deletePopupBackdrop');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  const deleteToast = document.getElementById('deleteToast');
  let currentDeleteRow;
  deleteItemButtons.forEach(button => {
    button.addEventListener('click', function () {
      currentDeleteRow = this.closest('tr');
      deletePopup.classList.remove('hidden');
      deletePopupBackdrop.classList.remove('hidden');
    });
  });
  function closeDeletePopup() { deletePopup.classList.add('hidden'); deletePopupBackdrop.classList.add('hidden'); }
  cancelDeleteBtn.addEventListener('click', closeDeletePopup);
  confirmDeleteBtn.addEventListener('click', () => {
    if (currentDeleteRow) {
      currentDeleteRow.remove();
      showToast(deleteToast);
    }
    closeDeletePopup();
  });

  const saveSpinner = document.getElementById('saveSpinner');
  const saveToast = document.getElementById('saveToast');
  saveBtn.addEventListener('click', () => {
    saveSpinner.style.display = 'block';
    saveBtn.disabled = true;
    setTimeout(() => {
      saveSpinner.style.display = 'none';
      saveBtn.disabled = false;
      showToast(saveToast);
      closeProductsEditModal();
    }, 1000);
  });

  const toastCloseButtons = document.querySelectorAll('.toast-close');
  function showToast(toast) { toast.classList.add('show'); setTimeout(() => { toast.classList.remove('show'); }, 3000); }
  toastCloseButtons.forEach(btn => { btn.addEventListener('click', () => btn.closest('.toast').classList.remove('show')); });
})();
