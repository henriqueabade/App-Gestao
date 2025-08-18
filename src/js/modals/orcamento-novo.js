(() => {
  const overlayId = 'novoOrcamento';
  const overlay = document.getElementById('novoOrcamentoOverlay');
  const close = () => Modal.close(overlayId);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e){ if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', esc); } });

  const clients = {
    'joao-silva': { nome: 'João Silva', contatos: ['João Contato'] },
    'maria-santos': { nome: 'Maria Santos', contatos: ['Maria Contato'] },
    'pedro-oliveira': { nome: 'Pedro Oliveira', contatos: ['Pedro Contato'] },
    'ana-costa': { nome: 'Ana Costa', contatos: ['Ana Contato'] }
  };

  const products = {
    'mesa-paris': { nome: 'Mesa de Jantar Modelo Paris', valor: 1500 },
    'cadeira-colonial': { nome: 'Cadeira Colonial Estofada', valor: 300 },
    'armario-rustico': { nome: 'Armário Rústico 6 Portas', valor: 2400 },
    'mesa-centro': { nome: 'Mesa de Centro Redonda', valor: 700 }
  };

  const clienteSelect = document.getElementById('novoCliente');
  const contatoSelect = document.getElementById('novoContato');
  const produtoSelect = document.getElementById('itemProduto');
  const itensTbody = document.querySelector('#novoItensTabela tbody');

  // sincroniza labels flutuantes
  ['novoCliente','novoContato','novoCondicao','itemProduto'].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    const sync = () => el.setAttribute('data-filled', el.value !== '' ? 'true' : 'false');
    sync();
    el.addEventListener('change', sync);
    el.addEventListener('blur', sync);
  });

  clienteSelect.addEventListener('change', () => {
    contatoSelect.innerHTML = '<option value="">Selecione um contato</option>';
    const c = clients[clienteSelect.value];
    if (c) {
      c.contatos.forEach(ct => {
        const opt = document.createElement('option');
        opt.value = ct;
        opt.textContent = ct;
        contatoSelect.appendChild(opt);
      });
    }
    contatoSelect.setAttribute('data-filled', 'false');
  });

  function formatCurrency(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function updateLineTotal(tr){
    const qty = parseFloat(tr.children[1].textContent) || 0;
    const val = parseFloat(tr.children[2].textContent) || 0;
    const desc = parseFloat(tr.children[3].textContent) || 0;
    const line = qty * val * (1 - desc / 100);
    tr.querySelector('.total-cell').textContent = formatCurrency(line);
  }

  function recalcTotals() {
    let subtotal = 0;
    let desconto = 0;
    itensTbody.querySelectorAll('tr').forEach(tr => {
      const qty = parseFloat(tr.children[1].textContent) || 0;
      const val = parseFloat(tr.children[2].textContent) || 0;
      const desc = parseFloat(tr.children[3].textContent) || 0;
      subtotal += qty * val;
      desconto += qty * val * (desc / 100);
    });
    document.getElementById('novoSubtotal').textContent = formatCurrency(subtotal);
    document.getElementById('novoDesconto').textContent = formatCurrency(desconto);
    document.getElementById('novoTotal').textContent = formatCurrency(subtotal - desconto);
    itensTbody.querySelectorAll('tr').forEach(updateLineTotal);
  }

  function attachRowEvents(tr){
    const editBtn = tr.querySelector('.fa-edit');
    const delBtn = tr.querySelector('.fa-trash');
    delBtn.addEventListener('click', () => { tr.remove(); recalcTotals(); });
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

  function showDuplicateDialog(callback) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
          <h3 class="text-lg font-semibold mb-4 text-white">Item já adicionado</h3>
          <p class="text-sm text-gray-300 mb-6">O item selecionado já está na lista. O que deseja fazer?</p>
          <div class="flex justify-center gap-4">
            <button id="dupSomar" class="btn-primary px-4 py-2 rounded-lg text-white font-medium">Somar</button>
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

  function addItem(prodId, qtd){
    const product = products[prodId];
    if (!product) return;
    const existing = Array.from(itensTbody.children).find(tr => tr.dataset.id === prodId);
    if (existing) {
      showDuplicateDialog(choice => {
        if (choice === 'somar') {
          const qtyCell = existing.children[1];
          qtyCell.textContent = (parseFloat(qtyCell.textContent) || 0) + qtd;
        } else if (choice === 'substituir') {
          existing.children[1].textContent = qtd;
          existing.children[2].textContent = product.valor.toFixed(2);
          existing.children[3].textContent = '0';
        }
        updateLineTotal(existing);
        recalcTotals();
      });
      return;
    }

    const tr = document.createElement('tr');
    tr.dataset.id = prodId;
    tr.innerHTML = `
      <td class="px-6 py-4 text-sm text-white">${product.nome}</td>
      <td class="px-6 py-4 text-center text-sm text-white">${qtd}</td>
      <td class="px-6 py-4 text-right text-sm text-white">${product.valor.toFixed(2)}</td>
      <td class="px-6 py-4 text-center text-sm text-white">0</td>
      <td class="px-6 py-4 text-right text-sm text-white total-cell"></td>
      <td class="px-6 py-4 text-center">
        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
        <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
      </td>`;
    itensTbody.appendChild(tr);
    updateLineTotal(tr);
    attachRowEvents(tr);
    recalcTotals();
  }

  document.getElementById('adicionarItemNovo').addEventListener('click', () => {
    const prodId = produtoSelect.value;
    const qtd = parseFloat(document.getElementById('itemQtd').value) || 1;
    if (!prodId || qtd <= 0) return;
    addItem(prodId, qtd);
    produtoSelect.value = '';
    produtoSelect.setAttribute('data-filled', 'false');
    document.getElementById('itemQtd').value = 1;
  });

  function saveQuote(status) {
    const clienteVal = clienteSelect.value;
    if (!clienteVal) { alert('Cliente é obrigatório'); return; }
    if (itensTbody.children.length === 0) { alert('Adicione pelo menos um item'); return; }
    const clienteText = clienteSelect.options[clienteSelect.selectedIndex].textContent;
    const condicaoText = document.getElementById('novoCondicao').options[document.getElementById('novoCondicao').selectedIndex].textContent;
    const total = document.getElementById('novoTotal').textContent;
    const tabela = document.getElementById('orcamentosTabela');
    const newId = `ORC${String(tabela.children.length + 1).padStart(3, '0')}`;
    const tr = document.createElement('tr');
    tr.className = 'transition-colors duration-150';
    tr.style.cursor = 'pointer';
    tr.setAttribute('onmouseover', "this.style.background='rgba(163, 148, 167, 0.05)'");
    tr.setAttribute('onmouseout', "this.style.background='transparent'");
    const statusClasses = {
      'Rascunho': 'badge-neutral',
      'Pendente': 'badge-warning',
      'Aprovado': 'badge-success',
      'Rejeitado': 'badge-danger',
      'Expirado': 'badge-neutral'
    };
    const badgeClass = statusClasses[status] || 'badge-neutral';
    tr.innerHTML = `
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${newId}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${clienteText}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${new Date().toLocaleDateString('pt-BR')}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${total}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${condicaoText}</td>
      <td class="px-6 py-4 whitespace-nowrap"><span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">${status}</span></td>
      <td class="px-6 py-4 whitespace-nowrap text-center"><div class="flex items-center justify-center space-x-2">
        <i class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color:var(--color-primary)" title="Visualizar"></i>
        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
        <i class="fas fa-download w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Baixar PDF"></i>
      </div></td>`;
    tabela.appendChild(tr);
    const editIcon = tr.querySelector('.fa-edit');
    editIcon.addEventListener('click', e => {
      e.stopPropagation();
      const row = e.currentTarget.closest('tr');
      const id = row.cells[0].textContent.trim();
      const cliente = row.cells[1].textContent.trim();
      const condicao = row.cells[4]?.textContent.trim();
      const statusTxt = row.cells[5]?.innerText.trim();
      window.selectedQuoteData = { id, cliente, condicao, status: statusTxt, row };
      Modal.open('modals/orcamentos/editar.html', '../js/modals/orcamento-editar.js', 'editarOrcamento');
    });
    Modal.close(overlayId);
  }

  document.getElementById('salvarNovoOrcamento').addEventListener('click', () => saveQuote('Rascunho'));
  document.getElementById('enviarNovoOrcamento').addEventListener('click', () => saveQuote('Pendente'));
  document.getElementById('cancelarNovoOrcamento').addEventListener('click', close);
  document.getElementById('voltarNovoOrcamento').addEventListener('click', close);

  const limparBtn = document.getElementById('limparNovoOrcamento');
  if (limparBtn) {
    limparBtn.addEventListener('click', () => {
      overlay.querySelectorAll('input').forEach(i => i.value = '');
      overlay.querySelectorAll('select').forEach(s => { s.selectedIndex = 0; s.setAttribute('data-filled', 'false'); });
      itensTbody.innerHTML = '';
      recalcTotals();
    });
  }
})();

