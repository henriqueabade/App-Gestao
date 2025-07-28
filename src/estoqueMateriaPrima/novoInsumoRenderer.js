(() => {
  // Modal aberto por Modal.open já bloqueia o scroll

  const overlay = document.getElementById('modal-raw-material-new');
  const escHandler = e => { if (e.key === 'Escape') closeRawMaterialNewModal(); };
  const clickHandler = e => { if (e.target === overlay) closeRawMaterialNewModal(); };
  let cleanupPersistence = () => {};

  function closeRawMaterialNewModal() {
    overlay.removeEventListener('click', clickHandler);
    document.removeEventListener('keydown', escHandler);
    overlay.classList.add('fade-out');
    setTimeout(() => {
      if (window.Modal && window.Modal.close) {
        window.Modal.close('modal-raw-material-new');
      } else if (window.closeAllModals) {
        window.closeAllModals();
      }
    }, 300);
    cleanupPersistence();
    localStorage.removeItem('rawMaterialNewOpen');
    localStorage.removeItem('newInsumoForm');
  }

  overlay.addEventListener('click', clickHandler);
  document.addEventListener('keydown', escHandler);
  localStorage.setItem('rawMaterialNewOpen', '1');
  cleanupPersistence = FormPersistence.init('#modal-raw-material-new', 'newInsumoForm');

  document.getElementById('cancelNew').addEventListener('click', closeRawMaterialNewModal);

  function showAlert(message) {
    const overlay = document.createElement('div');
    overlay.className =
      'fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 fade-in';
    overlay.innerHTML = `
      <div class="bg-white p-6 rounded-lg shadow-lg text-center space-y-4">
        <i data-feather="alert-triangle" class="mx-auto h-12 w-12 text-[var(--color-primary)] mb-3"></i>
        <p class="text-gray-800">${message}</p>
        <button id="alertOk" class="mx-auto bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white px-6 py-2 rounded">OK</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#alertOk').addEventListener('click', () => {
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.remove(), 300);
    });
  }

  const quantidadeInput = document.getElementById('newQuantidade');
  const infinitoCheck = document.getElementById('newInfinito');

  infinitoCheck.addEventListener('change', () => {
    if (infinitoCheck.checked) {
      quantidadeInput.value = '';
      quantidadeInput.disabled = true;
    } else {
      quantidadeInput.disabled = false;
    }
  });

  function showConfirm(message) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className =
        'fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50';
      overlay.innerHTML = `
      <div class="bg-white p-4 rounded-lg space-y-4 w-full max-w-xs">
        <p class="text-gray-800">${message}</p>
        <div class="flex justify-end space-x-2">
          <button id="confirmNo" class="bg-[var(--color-negative)] hover:bg-[var(--color-negative-hover)] text-white px-4 py-1 rounded">Não</button>
          <button id="confirmYes" class="bg-[var(--color-positive)] hover:bg-[var(--color-positive)] text-black px-4 py-1 rounded">Sim</button>
        </div>
      </div>
    `;
      document.body.appendChild(overlay);
      overlay.querySelector('#confirmNo').addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
      overlay.querySelector('#confirmYes').addEventListener('click', () => {
        overlay.remove();
        resolve(true);
      });
    });
  }

  document.getElementById('saveNew').addEventListener('click', async () => {
    const nome = document.getElementById('newNome').value.trim();
    const categoria = document.getElementById('newCategoria').value.trim();
    const unidade = document.getElementById('newUnidade').value.trim();
    const preco = document.getElementById('newPreco').value.trim();
    const processo = document.getElementById('newProcesso').value.trim();
    const descricao = document.getElementById('newDescricao').value.trim();
    const quantidadeVal = quantidadeInput.value.trim();

    if (
      !nome ||
      !categoria ||
      !unidade ||
      !preco ||
      !processo ||
      !descricao ||
      (!infinitoCheck.checked && !quantidadeVal)
    ) {
      showAlert('Preencha todos os campos.');
      return;
    }

    const ok = await showConfirm('Tem certeza que deseja salvar este novo insumo?');
    if (!ok) {
      closeRawMaterialNewModal();
      return;
    }
    const obj = {
      nome,
      categoria,
      quantidade: infinitoCheck.checked ? null : Number(quantidadeVal),
      unidade,
      preco_unitario: Number(preco),
      processo,
      infinito: infinitoCheck.checked,
      descricao
    };
    await window.electronAPI.adicionarMateriaPrima(obj);
    closeRawMaterialNewModal();
    if (window.afterModalSave) window.afterModalSave();
    window.showSystemMessage('Insumo cadastrado com sucesso!');
  });
})();
