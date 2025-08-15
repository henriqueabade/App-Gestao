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
  });

  function formatCurrency(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function recalcTotals() {
    let subtotal = 0;
    let desconto = 0;
    itensTbody.querySelectorAll('tr').forEach(tr => {
      const id = tr.dataset.id;
      const qty = parseFloat(tr.querySelector('.qty').value) || 0;
      const desc = parseFloat(tr.querySelector('.desc').value) || 0;
      const unit = products[id].valor;
      subtotal += qty * unit;
      desconto += qty * unit * (desc / 100);
      const line = qty * unit * (1 - desc / 100);
      tr.querySelector('.total').textContent = formatCurrency(line);
    });
    document.getElementById('novoSubtotal').textContent = formatCurrency(subtotal);
    document.getElementById('novoDesconto').textContent = formatCurrency(desconto);
    document.getElementById('novoTotal').textContent = formatCurrency(subtotal - desconto);
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

  function addItem(prodId, qtd, desc) {
    const product = products[prodId];
    if (!product) return;
    const existing = Array.from(itensTbody.children).find(tr => tr.dataset.id === prodId);
    if (existing) {
      showDuplicateDialog(choice => {
        if (choice === 'somar') {
          const qtyInput = existing.querySelector('.qty');
          qtyInput.value = (parseFloat(qtyInput.value) || 0) + qtd;
        } else if (choice === 'substituir') {
          existing.querySelector('.qty').value = qtd;
          existing.querySelector('.desc').value = desc;
        }
        recalcTotals();
      });
      return;
    }
    const tr = document.createElement('tr');
    tr.dataset.id = prodId;
    tr.innerHTML = `
      <td class="py-2 px-4 text-white">${product.nome}</td>
      <td class="py-2 px-4 text-right text-white unit">${formatCurrency(product.valor)}</td>
      <td class="py-2 px-4 text-center"><input type="number" class="qty w-16 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${qtd}" min="1"></td>
      <td class="py-2 px-4 text-center"><input type="number" class="desc w-16 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${desc}" min="0" max="100"></td>
      <td class="py-2 px-4 text-right text-white total"></td>
      <td class="py-2 px-4 text-center"><button class="icon-only bg-red-600/20 text-red-400 hover:bg-red-600/30 transition">🗑</button></td>`;
    itensTbody.appendChild(tr);
    const qtyInput = tr.querySelector('.qty');
    const descInput = tr.querySelector('.desc');
    const removeBtn = tr.querySelector('button');
    qtyInput.addEventListener('input', () => { if (qtyInput.value <= 0) qtyInput.value = 1; recalcTotals(); });
    descInput.addEventListener('input', recalcTotals);
    removeBtn.addEventListener('click', () => { tr.remove(); recalcTotals(); });
    recalcTotals();
  }

  document.getElementById('adicionarItemNovo').addEventListener('click', () => {
    const prodId = produtoSelect.value;
    const qtd = parseFloat(document.getElementById('itemQtd').value) || 1;
    const desc = parseFloat(document.getElementById('itemDesc').value) || 0;
    if (!prodId || qtd <= 0) return;
    addItem(prodId, qtd, desc);
    produtoSelect.value = '';
    document.getElementById('itemQtd').value = 1;
    document.getElementById('itemDesc').value = 0;
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
        <i class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Visualizar"></i>
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
      overlay.querySelectorAll('select').forEach(s => s.selectedIndex = 0);
      itensTbody.innerHTML = '';
      recalcTotals();
    });
  }
})();
