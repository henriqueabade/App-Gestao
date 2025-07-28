(() => {
  const overlay = document.getElementById('modal-budgets-edit');
  const backBtn = document.getElementById('editBudgetBack');

  function closeBudgetEditModal() {
    Modal.close('modal-budgets-edit');
  }

  if (backBtn) backBtn.addEventListener('click', closeBudgetEditModal);
})();
