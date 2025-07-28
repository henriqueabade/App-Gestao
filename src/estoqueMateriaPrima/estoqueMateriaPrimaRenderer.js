const lista = document.getElementById('listaInsumos');
const search = document.getElementById('searchTerm');
const btnNovo = document.getElementById('btnNovo');
const emptyBtn = document.getElementById('emptyNew');
const loadingSpinner = document.getElementById('loadingSpinner');
const emptyState = document.getElementById('emptyState');
let materias = [];

let currentPopup = null;

function createPopupContent(item) {
  const infinitoBadge = item.infinito
    ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-[var(--color-positive)] text-black">✔ Sim</span>`
    : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-[var(--color-negative)] text-white">❌ Não</span>`;
  return `
    <div class="bg-white rounded-lg shadow-md border border-gray-100 overflow-hidden w-64">
      <div class="px-5 py-3 bg-gray-50 border-b border-gray-100">
        <p class="text-xs text-gray-500 mb-1">Categoria:</p>
        <h3 class="text-base font-medium text-gray-900">${item.categoria || ''}</h3>
      </div>
      <div class="px-5 py-4">
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p class="text-xs text-gray-500 mb-1">Data de Entrada:</p>
            <p class="text-sm font-medium text-gray-800">${formatDate(item.data_estoque)}</p>
          </div>
          <div>
            <p class="text-xs text-gray-500 mb-1">Última Atualização:</p>
            <p class="text-sm font-medium text-gray-800">${formatDate(item.data_preco)}</p>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p class="text-xs text-gray-500 mb-1">Estoque Infinito:</p>
            ${infinitoBadge}
          </div>
          <div>
            <p class="text-xs text-gray-500 mb-1">Processo Atual:</p>
            <p class="text-sm font-medium text-gray-800">${item.processo || ''}</p>
          </div>
        </div>
        <div class="pt-3 border-t border-gray-100">
          <p class="text-xs text-gray-500 mb-1">Descrição Técnica:</p>
          <p class="text-sm text-gray-700 leading-relaxed">${item.descricao || ''}</p>
        </div>
      </div>
    </div>`;
}

function showInfoPopup(target, item) {
  hideInfoPopup();
  const popup = document.createElement('div');
  popup.className = 'absolute z-50';
  popup.innerHTML = createPopupContent(item);
  document.body.appendChild(popup);
  const rect = target.getBoundingClientRect();
  const margin = 8;
  const popupRect = popup.getBoundingClientRect();

  let top = rect.bottom + margin;
  if (top + popupRect.height > window.innerHeight) {
    if (rect.top - margin - popupRect.height >= 0) {
      top = rect.top - popupRect.height - margin;
    } else {
      top = Math.max(margin, window.innerHeight - popupRect.height - margin);
    }
  }

  let left = rect.right + margin;
  if (left + popupRect.width > window.innerWidth) {
    if (rect.left - margin - popupRect.width >= 0) {
      left = rect.left - popupRect.width - margin;
    } else {
      left = Math.max(margin, window.innerWidth - popupRect.width - margin);
    }
  }

  popup.style.left = `${left + window.scrollX}px`;
  popup.style.top = `${top + window.scrollY}px`;
  currentPopup = popup;
}

function hideInfoPopup() {
  if (currentPopup) {
    currentPopup.remove();
    currentPopup = null;
  }
}

let infoMouseEnter;
let infoMouseLeave;

function attachInfoEvents() {
  // Remove previous listeners if reattached
  lista.removeEventListener('mouseover', infoMouseEnter);
  lista.removeEventListener('mouseout', infoMouseLeave);

  infoMouseEnter = e => {
    const icon = e.target.closest('.info-icon');
    if (!icon) return;
    const id = parseInt(icon.dataset.id);
    const item = materias.find(m => m.id === id);
    if (item) showInfoPopup(icon, item);
  };

  infoMouseLeave = e => {
    if (e.target.closest('.info-icon')) hideInfoPopup();
  };

  lista.addEventListener('mouseover', infoMouseEnter);
  lista.addEventListener('mouseout', infoMouseLeave);

  if (window.feather) feather.replace();
}

function formatCurrency(valor) {
  if (valor == null) return '';
  return 'R$ ' + Number(valor).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(valor) {
  return valor ? new Date(valor).toLocaleDateString() : '';
}

async function carregar() {
  loadingSpinner.classList.remove('hidden');
  const termo = search.value.trim();
  materias = await window.electronAPI.listarMateriaPrima(termo);
  lista.innerHTML = '';

  if (materias.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    materias.forEach(item => {
      const tr = document.createElement('tr');
      tr.dataset.id = item.id;
      if (item.infinito) {
        tr.classList.add('infinite-stock');
      } else if (Number(item.quantidade) < 10) {
        tr.classList.add('low-stock');
      }

      let rowColor = '';
      if (item.quantidade === null) {
        rowColor = 'var(--color-positive)';
      } else if (Number(item.quantidade) < 10) {
        rowColor = 'var(--color-negative)';
      }
      const styleAttr = rowColor ? `style="color:${rowColor}"` : '';

      tr.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium" ${styleAttr}>
          <div class="flex items-center gap-1">
            <span>${item.nome}</span>
            <span class="info-icon ml-2 cursor-pointer" data-id="${item.id}"><i data-feather="info"></i></span>
          </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm" ${styleAttr}>${item.infinito ? '∞' : item.quantidade}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm" ${styleAttr}>${item.unidade || ''}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm" ${styleAttr}>${formatCurrency(item.preco_unitario)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium" ${styleAttr}>
          <button class="btn-edit action-icon mr-3" data-id="${item.id}" title="Editar">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
          </button>
          <button class="btn-delete action-icon" data-id="${item.id}" title="Excluir">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
          </button>
        </td>
      `;
      lista.appendChild(tr);
    });
    attachInfoEvents();
  }
  loadingSpinner.classList.add('hidden');
}

async function openRawMaterialEditModal(item) {
  if (window.closeAllModals) window.closeAllModals();
  window.modalData = item;
  window.afterModalSave = carregar;
  await Modal.open(
    '../estoqueMateriaPrima/editarInsumo.html',
    '../estoqueMateriaPrima/editarInsumoRenderer.js',
    'modal-raw-material-edit'
  );
}

async function openRawMaterialNewModal() {
  if (window.closeAllModals) window.closeAllModals();
  window.afterModalSave = carregar;
  await Modal.open(
    '../estoqueMateriaPrima/novoInsumo.html',
    '../estoqueMateriaPrima/novoInsumoRenderer.js',
    'modal-raw-material-new'
  );
}

function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50';
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
    overlay.querySelector('#confirmNo').addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.querySelector('#confirmYes').addEventListener('click', () => { overlay.remove(); resolve(true); });
  });
}


lista.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.btn-edit');
  const deleteBtn = e.target.closest('.btn-delete');
  if (!editBtn && !deleteBtn) return;
  const id = parseInt((editBtn || deleteBtn).dataset.id);
  const item = materias.find(m => m.id === id);
  if (editBtn && item) {
    openRawMaterialEditModal(item);
  } else if (deleteBtn && item) {
    const ok = await showConfirm('Tem certeza que deseja excluir este insumo?');
    if (ok) {
      await window.electronAPI.excluirMateriaPrima(id);
      window.showSystemMessage('Insumo excluído com sucesso!');
      carregar();
    }
  }
});

search.addEventListener('input', carregar);
btnNovo.addEventListener('click', openRawMaterialNewModal);
if (emptyBtn) emptyBtn.addEventListener('click', openRawMaterialNewModal);

// Carregamento inicial
carregar();

// Se o modal de novo insumo estava aberto antes de um logout automático,
// reabre-o e restaura os dados do formulário
if (localStorage.getItem('rawMaterialNewOpen') === '1') {
  setTimeout(() => {
    if (typeof openRawMaterialNewModal === 'function') {
      openRawMaterialNewModal();
    }
  }, 500);
}

// Expose popup hide function for global cleanup
window.hideRawMaterialInfoPopup = hideInfoPopup;
