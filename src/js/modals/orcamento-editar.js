(() => {
  const overlayId = 'editarOrcamento';
  const overlay = document.getElementById('editarOrcamentoOverlay');
  const close = () => Modal.close(overlayId);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e){ if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', esc); } });

  // carga de dados
  const data = window.selectedQuoteData || {};
  const titulo = document.getElementById('tituloEditarOrcamento');
  if (data.id && data.cliente) {
    titulo.textContent = `EDITAR ORÇAMENTO #${data.id} – ${data.cliente}`;
  }
  const editarCliente = document.getElementById('editarCliente');
  const editarContato = document.getElementById('editarContato');
  const editarCondicao = document.getElementById('editarCondicao');
  const produtoSelect = document.getElementById('novoItemProduto');

  const products = {
    'mesa-paris': { nome: 'Mesa de Jantar Modelo Paris', valor: 1500 },
    'cadeira-colonial': { nome: 'Cadeira Colonial Estofada', valor: 300 },
    'armario-rustico': { nome: 'Armário Rústico 6 Portas', valor: 2400 },
    'mesa-centro': { nome: 'Mesa de Centro Redonda', valor: 700 }
  };
  editarCliente.value = data.cliente || '';
  if (data.contato) editarContato.value = data.contato;
  editarCondicao.value = data.condicao || 'vista';
  [editarCliente, editarContato, editarCondicao, produtoSelect].forEach(sel => {
    const sync = () => sel.setAttribute('data-filled', sel.value !== '');
    sync();
    sel.addEventListener('change', sync);
    sel.addEventListener('blur', sync);
  });

  const statusMap = {
    'Rascunho': 'badge-neutral',
    'Pendente': 'badge-warning',
    'Aprovado': 'badge-success',
    'Rejeitado': 'badge-danger',
    'Expirado': 'badge-neutral'
  };
  let currentStatus = data.status || 'Rascunho';
  const statusTag = document.getElementById('statusTag');
  const statusOptions = document.getElementById('statusOptions');

  function updateStatusTag() {
    statusTag.className = `${statusMap[currentStatus] || 'badge-neutral'} px-3 py-1 rounded-full text-xs font-medium cursor-pointer`;
    statusTag.textContent = currentStatus;
  }
  updateStatusTag();

  statusTag.addEventListener('click', () => {
    statusOptions.classList.toggle('hidden');
  });
  statusOptions.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      currentStatus = btn.dataset.status;
      updateStatusTag();
      statusOptions.classList.add('hidden');
    });
  });

  const itensTbody = document.querySelector('#orcamentoItens tbody');

  function formatCurrency(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // manipulação de itens
    function updateLineTotal(tr){
      const qty = parseFloat(tr.children[1].textContent) || 0;
      const val = parseFloat(tr.children[2].textContent) || 0;
      const desc = parseFloat(tr.children[3].textContent) || 0;
      const line = qty * val * (1 - desc / 100);
      tr.querySelector('.total-cell').textContent = formatCurrency(line);
    }

    function showDuplicateDialog(callback) {
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="max-w-lg w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade">
          <div class="p-6 text-center">
            <h3 class="text-lg font-semibold mb-4 text-white">Item já adicionado</h3>
            <p class="text-sm text-gray-300 mb-6">O item selecionado já está na lista. O que deseja fazer?</p>
            <div class="flex justify-center gap-4">
              <button id="dupSomar" class="btn-warning px-4 py-2 rounded-lg text-white font-medium">Somar</button>
              <button id="dupSubstituir" class="btn-danger px-4 py-2 rounded-lg text-white font-medium">Substituir</button>
              <button id="dupManter" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Manter</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#dupSomar').addEventListener('click', () => { overlay.remove(); callback('somar'); });
      overlay.querySelector('#dupSubstituir').addEventListener('click', () => { overlay.remove(); callback('substituir'); });
      overlay.querySelector('#dupManter').addEventListener('click', () => { overlay.remove(); callback('manter'); });
    }

  function attachRowEvents(tr){
    const editBtn = tr.querySelector('.fa-edit');
    const delBtn = tr.querySelector('.fa-trash');
    delBtn.addEventListener('click', () => {
      const actionsCell = tr.children[5];
      actionsCell.innerHTML = `
        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-green-400"></i>
        <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
      `;
      const confirmBtn = actionsCell.querySelector('.fa-check');
      const cancelBtn = actionsCell.querySelector('.fa-times');
      confirmBtn.addEventListener('click', () => {
        tr.remove();
        recalcTotals();
      });
      cancelBtn.addEventListener('click', () => {
        actionsCell.innerHTML = `
          <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
          <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
        `;
        attachRowEvents(tr);
      });
    });
    editBtn.addEventListener('click', () => startEdit(tr));
  }

  function startEdit(tr){
    const qtyCell = tr.children[1];
    const valCell = tr.children[2];
    const descCell = tr.children[3];
    const actionsCell = tr.children[5];

    const qtyVal = qtyCell.textContent.trim();
    const valVal = valCell.textContent.trim();
    const descVal = descCell.textContent.trim();

    qtyCell.innerHTML = `<input type="number" class="w-16 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-center focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${qtyVal}" min="1">`;
    valCell.innerHTML = `<input type="number" class="w-24 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-right focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${valVal}" min="0" step="0.01">`;
    descCell.innerHTML = `<input type="number" class="w-16 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-center focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${descVal}" min="0" max="100">`;

    actionsCell.innerHTML = `
      <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-green-400"></i>
      <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
    `;
    const confirmBtn = actionsCell.querySelector('.fa-check');
    const cancelBtn = actionsCell.querySelector('.fa-times');
    const qtyInput = qtyCell.querySelector('input');
    const valInput = valCell.querySelector('input');
    const descInput = descCell.querySelector('input');

    confirmBtn.addEventListener('click', () => {
      qtyCell.textContent = qtyInput.value;
      valCell.textContent = parseFloat(valInput.value).toFixed(2);
      descCell.textContent = descInput.value;
      actionsCell.innerHTML = `
        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
        <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
      `;
      updateLineTotal(tr);
      attachRowEvents(tr);
      recalcTotals();
    });

    cancelBtn.addEventListener('click', () => {
      qtyCell.textContent = qtyVal;
      valCell.textContent = valVal;
      descCell.textContent = descVal;
      actionsCell.innerHTML = `
        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
        <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
      `;
      attachRowEvents(tr);
    });
  }

    function addItem(item) {
      const existing = Array.from(itensTbody.children).find(tr => tr.dataset.id === item.id);
      if (existing) {
        showDuplicateDialog(choice => {
          if (choice === 'somar') {
            const qtyCell = existing.children[1];
            qtyCell.textContent = (parseFloat(qtyCell.textContent) || 0) + item.qtd;
          } else if (choice === 'substituir') {
            existing.children[1].textContent = item.qtd;
            existing.children[2].textContent = item.valor.toFixed(2);
            existing.children[3].textContent = item.desc;
          }
          updateLineTotal(existing);
          recalcTotals();
        });
        return;
      }
      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/10';
      if (item.id) tr.dataset.id = item.id;
      tr.innerHTML = `
        <td class="px-6 py-4 text-sm text-white">${item.nome}</td>
        <td class="px-6 py-4 text-center text-sm text-white">${item.qtd}</td>
        <td class="px-6 py-4 text-right text-sm text-white">${item.valor.toFixed(2)}</td>
        <td class="px-6 py-4 text-center text-sm text-white">${item.desc}</td>
        <td class="px-6 py-4 text-right text-sm text-white total-cell"></td>
        <td class="px-6 py-4 text-center">
          <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
          <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
        </td>
      `;
      itensTbody.appendChild(tr);
      updateLineTotal(tr);
      attachRowEvents(tr);
      recalcTotals();
    }

    (data.items || [{ id: 'mesa-paris', nome: 'Mesa de Jantar Modelo Paris', qtd: 1, valor: 1500, desc: 0 }]).forEach(addItem);

    document.getElementById('adicionarItem').addEventListener('click', () => {
      const prodId = produtoSelect.value;
      const qtd = parseFloat(document.getElementById('novoItemQtd').value) || 1;
      if (!prodId) return;
      const prod = products[prodId];
      addItem({ id: prodId, nome: prod.nome, qtd, valor: prod.valor, desc: 0 });
      produtoSelect.value = '';
      produtoSelect.setAttribute('data-filled', 'false');
      document.getElementById('novoItemQtd').value = 1;
    });

  function recalcTotals() {
    let subtotal = 0;
    let desconto = 0;
    document.querySelectorAll('#orcamentoItens tbody tr').forEach(tr => {
      const qty = parseFloat(tr.children[1].textContent) || 0;
      const val = parseFloat(tr.children[2].textContent) || 0;
      const desc = parseFloat(tr.children[3].textContent) || 0;
      subtotal += qty * val;
      desconto += qty * val * (desc / 100);
    });
    const total = subtotal - desconto;
    document.getElementById('subtotalOrcamento').textContent = formatCurrency(subtotal);
    document.getElementById('descontoOrcamento').textContent = formatCurrency(desconto);
    document.getElementById('totalOrcamento').textContent = formatCurrency(total);
  }

  function saveChanges(closeAfter) {
    // salvar/fechar e converter
    if (data.row) {
      data.row.cells[3].textContent = document.getElementById('totalOrcamento').textContent;
      const statusCell = data.row.cells[5];
      statusCell.innerHTML = '';
      const statusSpan = document.createElement('span');
      const cls = statusMap[currentStatus] || 'badge-neutral';
      statusSpan.className = `${cls} px-3 py-1 rounded-full text-xs font-medium`;
      statusSpan.textContent = currentStatus;
      statusCell.appendChild(statusSpan);
    }
    if (closeAfter) Modal.close(overlayId);
  }

  document.getElementById('salvarOrcamento').addEventListener('click', () => saveChanges(false));
  document.getElementById('salvarFecharOrcamento').addEventListener('click', () => saveChanges(true));
  document.getElementById('cancelarOrcamento').addEventListener('click', close);
  document.getElementById('voltarEditarOrcamento').addEventListener('click', close);
  document.getElementById('converterOrcamento').addEventListener('click', () => {
    saveChanges(true);
    alert('Orçamento convertido em pedido!');
  });
})();
