(() => {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const tabId = this.getAttribute('data-tab');
      tabButtons.forEach(b => {
        b.classList.remove('text-[var(--color-primary)]', 'border-b-2', 'border-[var(--color-primary)]');
        b.classList.add('text-gray-600');
      });
      tabContents.forEach(c => c.classList.remove('active'));
      this.classList.remove('text-gray-600');
      this.classList.add('text-[var(--color-primary)]', 'border-b-2', 'border-[var(--color-primary)]');
      setTimeout(() => {
        document.getElementById(`tab-${tabId}`).classList.add('active');
      }, 50);
    });
  });

  const userStatus = document.getElementById('userStatus');
  const confirmationCodeSection = document.getElementById('confirmationCodeSection');
  if (userStatus) {
    userStatus.addEventListener('change', function() {
      if (this.value === 'aguardando') confirmationCodeSection.classList.remove('hidden');
      else confirmationCodeSection.classList.add('hidden');
    });
  }

  const btnSendCode = document.getElementById('btnSendCode');
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');
  if (btnSendCode) {
    btnSendCode.addEventListener('click', function() {
      toastMessage.textContent = 'Código enviado para maria.silva@empresa.com.br';
      showToast();
    });
  }

  const btnSave = document.getElementById('btnSave');
  const btnSaveText = document.getElementById('btnSaveText');
  const btnSaveSpinner = document.getElementById('btnSaveSpinner');
  if (btnSave) {
    btnSave.addEventListener('click', function() {
      btnSaveText.textContent = 'Salvando';
      btnSaveSpinner.classList.remove('hidden');
      btnSave.disabled = true;
      setTimeout(function() {
        btnSaveText.textContent = 'Salvar';
        btnSaveSpinner.classList.add('hidden');
        btnSave.disabled = false;
        toastMessage.textContent = 'Usuário atualizado com sucesso!';
        showToast();
      }, 1500);
    });
  }

  const overlay = document.getElementById('modal-users-edit');

  function closeUserEditModal() {
    Modal.close('modal-users-edit');
  }

  const btnBack = document.getElementById('btnBack');
  const btnClose = document.getElementById('btnClose');
  if (btnBack) btnBack.addEventListener('click', closeUserEditModal);
  if (btnClose) btnClose.addEventListener('click', closeUserEditModal);

  function showToast() {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
})();
