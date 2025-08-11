(function(){
  const overlay = document.getElementById('editarProdutoOverlay');
  const close = () => Modal.close('editarProduto');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharEditarProduto').addEventListener('click', close);
  document.getElementById('voltarEditarProduto').addEventListener('click', close);

  const tableBody = document.querySelector('#itensTabela tbody');
  const markupInput = document.getElementById('markupInput');
  const commissionInput = document.getElementById('commissionInput');
  const taxInput = document.getElementById('taxInput');

  const totalInsumosEl = document.getElementById('totalInsumos');
  const totalMaoObraEl = document.getElementById('totalMaoObra');
  const subTotalEl = document.getElementById('subTotal');
  const markupValorEl = document.getElementById('markupValor');
  const custoTotalEl = document.getElementById('custoTotal');
  const comissaoValorEl = document.getElementById('comissaoValor');
  const impostoValorEl = document.getElementById('impostoValor');

  function parseCurrency(str){
    return parseFloat(str.replace(/[^0-9,-]+/g, '').replace('.', '').replace(',', '.')) || 0;
  }

  function formatCurrency(val){
    return val.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }

  function attachRowEvents(row){
    const qtyCell = row.querySelector('.item-qty');
    const totalCell = row.querySelector('.item-total');
    const unit = parseCurrency(totalCell.textContent) / parseFloat(qtyCell.textContent);
    row.dataset.unit = unit;

    row.querySelector('.edit-item').addEventListener('click', () => {
      const current = parseInt(qtyCell.textContent.trim(), 10);
      const newQty = parseInt(prompt('Nova quantidade', current), 10);
      if(!isNaN(newQty) && newQty > 0){
        qtyCell.textContent = newQty;
        totalCell.textContent = formatCurrency(unit * newQty);
        updateTotals();
      }
    });

    row.querySelector('.remove-item').addEventListener('click', () => {
      row.remove();
      updateTotals();
    });
  }

  function updateTotals(){
    let totalInsumos = 0;
    tableBody.querySelectorAll('tr').forEach(tr => {
      totalInsumos += parseCurrency(tr.querySelector('.item-total').textContent);
    });
    const totalMaoObra = totalInsumos * 0.5;
    const subTotal = totalInsumos + totalMaoObra;
    const markupPct = parseFloat(markupInput.value) || 0;
    const markupVal = subTotal * (markupPct/100);
    const custoTotal = subTotal + markupVal;
    const commissionPct = parseFloat(commissionInput.value) || 0;
    const commissionVal = custoTotal * (commissionPct/100);
    const taxPct = parseFloat(taxInput.value) || 0;
    const taxVal = custoTotal * (taxPct/100);

    totalInsumosEl.textContent = formatCurrency(totalInsumos);
    totalMaoObraEl.textContent = formatCurrency(totalMaoObra);
    subTotalEl.textContent = formatCurrency(subTotal);
    markupValorEl.textContent = formatCurrency(markupVal);
    custoTotalEl.textContent = formatCurrency(custoTotal);
    comissaoValorEl.textContent = formatCurrency(commissionVal);
    impostoValorEl.textContent = formatCurrency(taxVal);
  }

  tableBody.querySelectorAll('tr').forEach(attachRowEvents);
  markupInput.addEventListener('input', updateTotals);
  commissionInput.addEventListener('input', updateTotals);
  taxInput.addEventListener('input', updateTotals);

  document.getElementById('limparTudo').addEventListener('click', () => {
    tableBody.innerHTML = '';
    updateTotals();
  });

  document.getElementById('salvarEditarProduto').addEventListener('click', close);

  updateTotals();
})();

