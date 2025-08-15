(() => {
  const overlayId = 'editarOrcamento';

  // carga de dados
  const data = window.selectedQuoteData || {};
  const titulo = document.getElementById('tituloEditarOrcamento');
  if (data.id && data.cliente) {
    titulo.textContent = `Editar Orçamento #${data.id} – ${data.cliente}`;
  }
  document.getElementById('editarCliente').value = data.cliente || '';
  document.getElementById('editarCondicao').value = data.condicao || 'vista';
  document.getElementById('editarStatus').value = (data.status || 'rascunho').toLowerCase();

  const itensTbody = document.querySelector('#orcamentoItens tbody');

  function formatCurrency(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // manipulação de itens
  function addItem(item) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="py-2 px-4 text-white">${item.nome}</td>
      <td class="py-2 px-4 text-center"><input type="number" class="w-16 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${item.qtd}" min="1"></td>
      <td class="py-2 px-4 text-right"><input type="number" class="w-24 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-right focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${item.valor.toFixed(2)}" min="0" step="0.01"></td>
      <td class="py-2 px-4 text-center"><input type="number" class="w-16 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${item.desc}" min="0" max="100"></td>
      <td class="py-2 px-4 text-right text-white total-cell"></td>
      <td class="py-2 px-4 text-center"><button class="icon-only bg-red-600/20 text-red-400 hover:bg-red-600/30 transition">🗑</button></td>
    `;
    itensTbody.appendChild(tr);

    const qtyInput = tr.children[1].querySelector('input');
    const valInput = tr.children[2].querySelector('input');
    const descInput = tr.children[3].querySelector('input');
    const totalCell = tr.querySelector('.total-cell');

    function recalc() {
      const q = parseFloat(qtyInput.value) || 0;
      const v = parseFloat(valInput.value) || 0;
      const d = parseFloat(descInput.value) || 0;
      const line = q * v * (1 - d / 100);
      totalCell.textContent = formatCurrency(line);
      recalcTotals();
    }
    qtyInput.addEventListener('input', recalc);
    valInput.addEventListener('input', recalc);
    descInput.addEventListener('input', recalc);
    tr.querySelector('button').addEventListener('click', () => {
      tr.remove();
      recalcTotals();
    });
    recalc();
  }

  (data.items || [{ nome: 'Item Exemplo', qtd: 1, valor: 100, desc: 0 }]).forEach(addItem);

  document.getElementById('adicionarItem').addEventListener('click', () => {
    const nome = document.getElementById('novoItemNome').value.trim();
    const qtd = parseFloat(document.getElementById('novoItemQtd').value) || 1;
    const valor = parseFloat(document.getElementById('novoItemValor').value) || 0;
    const desc = parseFloat(document.getElementById('novoItemDesc').value) || 0;
    if (!nome) return;
    addItem({ nome, qtd, valor, desc });
    document.getElementById('novoItemNome').value = '';
    document.getElementById('novoItemQtd').value = 1;
    document.getElementById('novoItemValor').value = '';
    document.getElementById('novoItemDesc').value = 0;
  });

  function recalcTotals() {
    // recálculo de totais
    let subtotal = 0;
    let desconto = 0;
    document.querySelectorAll('#orcamentoItens tbody tr').forEach(tr => {
      const qty = parseFloat(tr.children[1].querySelector('input').value) || 0;
      const val = parseFloat(tr.children[2].querySelector('input').value) || 0;
      const desc = parseFloat(tr.children[3].querySelector('input').value) || 0;
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
      const statusValue = document.getElementById('editarStatus').value;
      const statusText = document.getElementById('editarStatus').options[document.getElementById('editarStatus').selectedIndex].textContent;
      const statusSpan = document.createElement('span');
      statusSpan.className = `badge-${statusValue} px-3 py-1 rounded-full text-xs font-medium`;
      statusSpan.textContent = statusText;
      statusCell.appendChild(statusSpan);
    }
    if (closeAfter) Modal.close(overlayId);
  }

  document.getElementById('salvarOrcamento').addEventListener('click', () => saveChanges(false));
  document.getElementById('salvarFecharOrcamento').addEventListener('click', () => saveChanges(true));
  document.getElementById('cancelarOrcamento').addEventListener('click', () => Modal.close(overlayId));
  document.getElementById('fecharEditarOrcamento').addEventListener('click', () => Modal.close(overlayId));
  document.getElementById('converterOrcamento').addEventListener('click', () => {
    saveChanges(true);
    alert('Orçamento convertido em pedido!');
  });
})();
