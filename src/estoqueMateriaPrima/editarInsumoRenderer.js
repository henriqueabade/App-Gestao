(() => {
  const data = window.modalData || {};

  const overlay = document.getElementById('modal-raw-material-edit');
  const escHandler = e => { if (e.key === 'Escape') closeRawMaterialEditModal(); };
  const clickHandler = e => { if (e.target === overlay) closeRawMaterialEditModal(); };

  function closeRawMaterialEditModal() {
    overlay.removeEventListener('click', clickHandler);
    document.removeEventListener('keydown', escHandler);
    overlay.classList.add('fade-out');
    setTimeout(() => {
      if (window.Modal && window.Modal.close) {
        window.Modal.close('modal-raw-material-edit');
      } else if (window.closeAllModals) {
        window.closeAllModals();
      }
    }, 300);
  }

  overlay.addEventListener('click', clickHandler);
  document.addEventListener('keydown', escHandler);

  document.getElementById('editNome').value = data.nome || '';
  document.getElementById('editCategoria').value = data.categoria || '';
  document.getElementById('editQuantidade').value = data.quantidade ?? '';
  document.getElementById('editUnidade').value = data.unidade || '';
  document.getElementById('editPreco').value = data.preco_unitario || 0;
  document.getElementById('editProcesso').value = data.processo || '';
  document.getElementById('editInfinito').checked = data.infinito || false;
  document.getElementById('editDescricao').value = data.descricao || '';

  const quantidadeInput = document.getElementById('editQuantidade');
  const infinitoCheck = document.getElementById('editInfinito');

  if (infinitoCheck.checked) {
    quantidadeInput.disabled = true;
  }

  infinitoCheck.addEventListener('change', () => {
    if (infinitoCheck.checked) {
      quantidadeInput.value = '';
      quantidadeInput.disabled = true;
    } else {
      quantidadeInput.disabled = false;
    }
  });

  document.getElementById('cancelEdit').addEventListener('click', closeRawMaterialEditModal);

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
      </div>`;
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

  document.getElementById('deleteEdit').addEventListener('click', async () => {
    const ok = await showConfirm('Tem certeza que deseja excluir este insumo?');
    if (!ok) return;
    await window.electronAPI.excluirMateriaPrima(data.id);
    closeRawMaterialEditModal();
    if (window.afterModalSave) window.afterModalSave();
    window.showSystemMessage('Insumo excluído com sucesso!');
  });

  document.getElementById('saveEdit').addEventListener('click', async () => {
    const nome = document.getElementById('editNome').value.trim();
    const categoria = document.getElementById('editCategoria').value.trim();
    const unidade = document.getElementById('editUnidade').value.trim();
    const preco = document.getElementById('editPreco').value.trim();
    const processo = document.getElementById('editProcesso').value.trim();
    const descricao = document.getElementById('editDescricao').value.trim();
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

    const ok = await showConfirm('Tem certeza que deseja salvar as alterações deste insumo?');
    if (!ok) {
      closeRawMaterialEditModal();
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
    await window.electronAPI.atualizarMateriaPrima(data.id, obj);
    closeRawMaterialEditModal();
    if (window.afterModalSave) window.afterModalSave();
    window.showSystemMessage('Insumo atualizado com sucesso!');
  });
})();

