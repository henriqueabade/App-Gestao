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
  const etapaSelect = document.getElementById('etapaSelect');

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
    tableBody.querySelectorAll('tr.item-row').forEach(tr => {
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

  function renderItens(itens){
    tableBody.innerHTML = '';
    let currentProcess = null;
    itens.forEach(item => {
      if(item.processo !== currentProcess){
        const procRow = document.createElement('tr');
        procRow.className = 'process-row';
        procRow.innerHTML = `<td colspan="4" class="pt-4 pb-2 text-left text-gray-300 font-semibold">${item.processo}</td>`;
        tableBody.appendChild(procRow);
        currentProcess = item.processo;
      }
      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/5 item-row';
      tr.innerHTML = `
        <td class="py-3 px-2 text-white">${item.nome}</td>
        <td class="py-3 px-2 text-center text-gray-300 item-qty">${item.quantidade}</td>
        <td class="py-3 px-2 text-right text-white item-total">${formatCurrency(item.total)}</td>
        <td class="py-3 px-2 text-center">
          <div class="flex justify-center gap-2">
            <button class="edit-item icon-only bg-blue-600/20 text-blue-400 hover:bg-blue-600/30">✎</button>
            <button class="remove-item icon-only bg-red-600/20 text-red-400 hover:bg-red-600/30">🗑</button>
          </div>
        </td>`;
      tableBody.appendChild(tr);
      attachRowEvents(tr);
    });
    updateTotals();
  }

  markupInput.addEventListener('input', updateTotals);
  commissionInput.addEventListener('input', updateTotals);
  taxInput.addEventListener('input', updateTotals);

  document.getElementById('limparTudo').addEventListener('click', () => {
    tableBody.innerHTML = '';
    updateTotals();
  });

  document.getElementById('salvarEditarProduto').addEventListener('click', close);

  const produto = window.produtoSelecionado;
  (async () => {
    try{
      const dados = await window.electronAPI.obterProduto(produto.id);
      if(dados){
        if(dados.pct_markup != null) markupInput.value = dados.pct_markup;
        if(dados.pct_comissao != null) commissionInput.value = dados.pct_comissao;
        if(dados.pct_imposto != null) taxInput.value = dados.pct_imposto;
      }
      const etapas = await window.electronAPI.listarEtapasProducao();
      etapaSelect.innerHTML = etapas.map(e => `<option value="${e.id}">${e.nome}</option>`).join('');
      const itens = await window.electronAPI.listarInsumosProduto(produto.codigo);
      renderItens(itens);
    } catch(err){
      console.error('Erro ao carregar dados do produto', err);
    }
  })();

})();

