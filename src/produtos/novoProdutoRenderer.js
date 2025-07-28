(() => {
  function updateCurrentDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('currentDate').textContent = `${day}/${month}/${year} às ${hours}:${minutes}`;
  }
  updateCurrentDate();

  const productModalOverlay = document.getElementById('modal-products-new');
  const backBtn = document.getElementById('backBtn');
  const closeBtn = document.getElementById('closeBtn');

  function closeProductsNewModal() {
    Modal.close('modal-products-new');
  }

  backBtn.addEventListener('click', closeProductsNewModal);
  closeBtn.addEventListener('click', closeProductsNewModal);


  const clearAllBtn = document.getElementById('clearAllBtn');
  const clearPopup = document.getElementById('clearPopup');
  const clearPopupBackdrop = document.getElementById('clearPopupBackdrop');
  const cancelClearBtn = document.getElementById('cancelClearBtn');
  const confirmClearBtn = document.getElementById('confirmClearBtn');
  const clearToast = document.getElementById('clearToast');

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
    document.getElementById('productName').value = '';
    document.getElementById('productCode').value = '';
    document.getElementById('ncmCode').value = '';
    document.getElementById('processSelect').selectedIndex = 0;
    showToast(clearToast);
    closeClearPopup();
  });

  const deleteButtons = document.querySelectorAll('.delete-item');
  const deletePopup = document.getElementById('deletePopup');
  const deletePopupBackdrop = document.getElementById('deletePopupBackdrop');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  const deleteToast = document.getElementById('deleteToast');
  let currentDeleteRow;
  deleteButtons.forEach(btn => {
    btn.addEventListener('click', function () {
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
  confirmDeleteBtn.addEventListener('click', () => {
    showToast(deleteToast);
    closeDeletePopup();
  });

  const editButtons = document.querySelectorAll('.edit-quantity');
  const editPopup = document.getElementById('editPopup');
  const editPopupBackdrop = document.getElementById('editPopupBackdrop');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const confirmEditBtn = document.getElementById('confirmEditBtn');
  const quantityToast = document.getElementById('quantityToast');
  editButtons.forEach(btn => {
    btn.addEventListener('click', function () {
      const row = this.closest('tr');
      const currentQuantity = row.cells[1].textContent;
      document.getElementById('newQuantityInput').value = currentQuantity;
      editPopup.classList.remove('hidden');
      editPopupBackdrop.classList.remove('hidden');
    });
  });
  function closeEditPopup() {
    editPopup.classList.add('hidden');
    editPopupBackdrop.classList.add('hidden');
  }
  cancelEditBtn.addEventListener('click', closeEditPopup);
  confirmEditBtn.addEventListener('click', () => {
    showToast(quantityToast);
    closeEditPopup();
  });

  const registerBtn = document.getElementById('registerBtn');
  const registerPopup = document.getElementById('registerPopup');
  const registerPopupBackdrop = document.getElementById('registerPopupBackdrop');
  const cancelRegisterBtn = document.getElementById('cancelRegisterBtn');
  const confirmRegisterBtn = document.getElementById('confirmRegisterBtn');
  const registerToast = document.getElementById('registerToast');

  const startProcessBtn = document.getElementById('startProcessBtn');

  async function openProductsProcessModal() {
    ModalManager.closeAll();
    await ModalManager.open('modal-products-process');
  }

  startProcessBtn?.addEventListener('click', openProductsProcessModal);

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
    setTimeout(() => { closeProductsNewModal(); }, 1000);
  });

  const toastCloseButtons = document.querySelectorAll('.toast-close');
  function showToast(toast) {
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
  }
  toastCloseButtons.forEach(btn => {
    btn.addEventListener('click', function () {
      this.closest('.toast').classList.remove('show');
    });
  });
})();
