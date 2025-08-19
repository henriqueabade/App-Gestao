 (async () => {
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
  const editarTransportadora = document.getElementById('editarTransportadora');
  const editarFormaPagamento = document.getElementById('editarFormaPagamento');
  const produtoSelect = document.getElementById('novoItemProduto');
  const pagamentoBox = document.getElementById('editarPagamento');
  const condicaoWrapper = editarCondicao.parentElement;
  let parcelamentoLoaded = false;
  let condicaoDefinida = Boolean(data.condicao);
  function loadParcelamento(){
    return new Promise(res=>{
      if(parcelamentoLoaded){res();return;}
      const s=document.createElement('script');
      s.src='../js/utils/parcelamento.js';
      s.onload=()=>{parcelamentoLoaded=true;res();};
      document.head.appendChild(s);
    });
  }
  function resetCondicao(){
    editarCondicao.value='vista';
    editarCondicao.setAttribute('data-filled','true');
    pagamentoBox.classList.add('hidden');
    pagamentoBox.innerHTML='';
    condicaoDefinida=false;
  }
  function showResetDialog(cb){
    const overlay=document.createElement('div');
    overlay.className='fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.innerHTML=`<div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-yellow-300">Atenção</h3><p class="text-sm text-gray-300 mb-6">Esta ação irá reiniciar a condição de pagamento. Deseja continuar?</p><div class="flex justify-center gap-4"><button id="resetYes" class="btn-warning px-4 py-2 rounded-lg text-white font-medium">Sim</button><button id="resetNo" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Não</button></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#resetYes').addEventListener('click',()=>{overlay.remove();cb(true);});
    overlay.querySelector('#resetNo').addEventListener('click',()=>{overlay.remove();cb(false);});
  }

  function showBlockedDialog(){
    const overlay=document.createElement('div');
    overlay.className='fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.innerHTML=`<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-yellow-500/20 ring-1 ring-yellow-500/30 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-yellow-400">Atenção</h3><p class="text-sm text-gray-300 mb-6">Você não pode escolher uma condição de pagamento bloqueada. Se desejar manter esta condição de pagamento, desbloqueie-a antes de continuar.</p><div class="flex justify-center"><button id="blockedOk" class="btn-warning px-6 py-2 rounded-lg text-white font-medium active:scale-95">OK</button></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#blockedOk').addEventListener('click',()=>overlay.remove());
  }

  function showActionDialog(message, cb){
    const overlay=document.createElement('div');
    overlay.className='fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.innerHTML=`<div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-yellow-300">Atenção</h3><p class="text-sm text-gray-300 mb-6">${message}</p><div class="flex justify-center gap-4"><button id="actYes" class="btn-warning px-4 py-2 rounded-lg text-white font-medium">Sim</button><button id="actNo" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Não</button></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#actYes').addEventListener('click',()=>{overlay.remove();cb(true);});
    overlay.querySelector('#actNo').addEventListener('click',()=>{overlay.remove();cb(false);});
  }
  function confirmResetIfNeeded(action){
    if(!condicaoDefinida){action();return;}
    showResetDialog(ok=>{if(!ok) return;resetCondicao();action();});
  }
  function updateCondicao(){
    if(editarCondicao.value==='vista'){
      pagamentoBox.innerHTML=`
        <div class="relative w-40">
          <input id="editarPrazoVista" type="number" min="0" placeholder=" " class="peer w-full bg-input border border-inputBorder rounded-lg px-4 py-3 text-white placeholder-transparent focus:border-primary focus:ring-2 focus:ring-primary/50 transition" />
          <label for="editarPrazoVista" class="absolute left-4 top-1/2 -translate-y-1/2 text-base text-gray-300 pointer-events-none transition-all duration-150 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-focus:top-0 peer-focus:-translate-y-full peer-focus:text-xs peer-focus:text-primary peer-valid:top-0 peer-valid:-translate-y-full peer-valid:text-xs">Prazo (dias)</label>
        </div>`;
      pagamentoBox.classList.remove('hidden');
    } else if(editarCondicao.value==='prazo'){
      pagamentoBox.classList.remove('hidden');
      pagamentoBox.innerHTML='<div id="editarParcelamento"></div>';
      loadParcelamento().then(()=>Parcelamento.init('editarParcelamento',{getTotal:()=>parseCurrencyToCents(document.getElementById('totalOrcamento').textContent)}));
    } else {
      pagamentoBox.classList.add('hidden');
      pagamentoBox.innerHTML='';
    }
  }
  editarCondicao.addEventListener('change',()=>{condicaoDefinida=true;editarCondicao.setAttribute('data-filled','true');updateCondicao();recalcTotals();});
  condicaoWrapper.addEventListener('click',e=>{if(editarCondicao.disabled){e.preventDefault();showBlockedDialog();}});
  editarCondicao.disabled=true;
  editarCondicao.style.pointerEvents='none';

  const clients = {};
  const products = {};

  async function carregarClientes(){
    try {
      const resp = await fetch('http://localhost:3000/api/clientes/lista');
      const data = await resp.json();
      editarCliente.innerHTML = '<option value="" disabled selected hidden></option>' +
        data.map(c => `<option value="${c.id}">${c.nome_fantasia}</option>`).join('');
      data.forEach(c => { clients[c.id] = c; });
    } catch(err){ console.error('Erro ao carregar clientes', err); }
  }

  async function carregarContatos(clienteId){
    editarContato.innerHTML = '<option value="" disabled selected hidden></option>';
    editarContato.setAttribute('data-filled','false');
    if(!clienteId) return;
    try {
      const resp = await fetch(`http://localhost:3000/api/clientes/${clienteId}`);
      const data = await resp.json();
      (data.contatos || []).forEach(ct => {
        const opt = document.createElement('option');
        opt.value = ct.id;
        opt.textContent = ct.nome;
        editarContato.appendChild(opt);
      });
    } catch(err){ console.error('Erro ao carregar contatos', err); }
  }

  async function carregarTransportadoras(clienteId){
    editarTransportadora.innerHTML = '<option value="" disabled selected hidden></option>';
    editarTransportadora.setAttribute('data-filled','false');
    if(!clienteId) return;
    try {
      const resp = await fetch(`http://localhost:3000/api/transportadoras/${clienteId}`);
      const data = await resp.json();
      data.forEach(tp => {
        const opt = document.createElement('option');
        opt.value = tp.id;
        opt.textContent = tp.nome;
        editarTransportadora.appendChild(opt);
      });
    } catch(err){ console.error('Erro ao carregar transportadoras', err); }
  }

  async function carregarProdutos(){
    try {
      const lista = await (window.electronAPI?.listarProdutos?.() ?? []);
      produtoSelect.innerHTML = '<option value="" disabled selected hidden></option>' +
        lista.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
      lista.forEach(p => { products[p.id] = { nome: p.nome, valor: Number(p.preco_venda) || 0 }; });
    } catch(err){ console.error('Erro ao carregar produtos', err); }
  }

  editarCliente.addEventListener('change', () => {
    carregarContatos(editarCliente.value);
    carregarTransportadoras(editarCliente.value);
  });

  await carregarClientes();
  if (data.clienteId) {
    editarCliente.value = data.clienteId;
    editarCliente.setAttribute('data-filled', 'true');
    await carregarContatos(data.clienteId);
    await carregarTransportadoras(data.clienteId);
    if (data.contatoId) {
      editarContato.value = data.contatoId;
      editarContato.setAttribute('data-filled', 'true');
    }
    if (data.transportadoraId) {
      editarTransportadora.value = data.transportadoraId;
      editarTransportadora.setAttribute('data-filled','true');
    }
  } else if (data.cliente) {
    const opt = Array.from(editarCliente.options).find(o => o.textContent === data.cliente);
    if (opt) {
      editarCliente.value = opt.value;
      editarCliente.setAttribute('data-filled', 'true');
      await carregarContatos(opt.value);
      await carregarTransportadoras(opt.value);
    }
  }
  editarCondicao.value = data.condicao || 'vista';
  updateCondicao();
  editarFormaPagamento.value = data.formaPagamento || '';
  if(editarFormaPagamento.value){ editarFormaPagamento.setAttribute('data-filled','true'); }
  await carregarProdutos();
  [editarCliente, editarContato, editarCondicao, editarTransportadora, editarFormaPagamento, produtoSelect].forEach(sel => {
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
      const desc = (qty > 1 ? 5 : 0) + (editarCondicao.value === 'vista' ? 5 : 0);
      tr.children[4].textContent = desc;
      const valDesc = val * (1 - desc / 100);
      tr.children[3].textContent = valDesc.toFixed(2);
      tr.querySelector('.total-cell').textContent = formatCurrency(qty * valDesc);
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
      showActionDialog('Deseja remover este item?', ok => {
        if(!ok) return;
        confirmResetIfNeeded(() => {
          tr.remove();
          recalcTotals();
        });
      });
    });
    editBtn.addEventListener('click', () => startEdit(tr));
  }

  function startEdit(tr){
    const qtyCell = tr.children[1];
    const valCell = tr.children[2];
    const actionsCell = tr.children[6];

    const qtyVal = qtyCell.textContent.trim();
    const valVal = valCell.textContent.trim();

    qtyCell.innerHTML = `<input type="number" class="w-16 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-center focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${qtyVal}" min="1">`;
    valCell.innerHTML = `<input type="number" class="w-24 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-right focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${valVal}" min="0" step="0.01">`;

    actionsCell.innerHTML = `
      <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-green-400"></i>
      <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
    `;
    const confirmBtn = actionsCell.querySelector('.fa-check');
    const cancelBtn = actionsCell.querySelector('.fa-times');
    const qtyInput = qtyCell.querySelector('input');
    const valInput = valCell.querySelector('input');

    confirmBtn.addEventListener('click', () => {
      showActionDialog('Deseja salvar as alterações deste item?', ok => {
        if(!ok) return;
        confirmResetIfNeeded(() => {
          qtyCell.textContent = qtyInput.value;
          valCell.textContent = parseFloat(valInput.value).toFixed(2);
          actionsCell.innerHTML = `
            <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
            <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
          `;
          updateLineTotal(tr);
          attachRowEvents(tr);
          recalcTotals();
        });
      });
    });

    cancelBtn.addEventListener('click', () => {
      qtyCell.textContent = qtyVal;
      valCell.textContent = valVal;
      actionsCell.innerHTML = `
        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
        <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
      `;
      attachRowEvents(tr);
      recalcTotals();
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
            existing.children[3].textContent = '0.00';
            existing.children[4].textContent = '0';
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
        <td class="px-6 py-4 text-right text-sm text-white">0.00</td>
        <td class="px-6 py-4 text-center text-sm text-white">0</td>
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

    (data.items || []).forEach(addItem);

    document.getElementById('adicionarItem').addEventListener('click', () => {
      const prodId = produtoSelect.value;
      const qtd = parseFloat(document.getElementById('novoItemQtd').value) || 1;
      if (!prodId) return;
      confirmResetIfNeeded(() => {
        const prod = products[prodId];
        addItem({ id: prodId, nome: prod.nome, qtd, valor: prod.valor, desc: 0 });
        produtoSelect.value = '';
        produtoSelect.setAttribute('data-filled', 'false');
        document.getElementById('novoItemQtd').value = 1;
      });
    });

  function recalcTotals() {
    let subtotal = 0;
    let desconto = 0;
    document.querySelectorAll('#orcamentoItens tbody tr').forEach(tr => {
      const qty = parseFloat(tr.children[1].textContent) || 0;
      const val = parseFloat(tr.children[2].textContent) || 0;
      const desc = (qty > 1 ? 5 : 0) + (editarCondicao.value === 'vista' ? 5 : 0);
      tr.children[4].textContent = desc;
      const line = qty * val;
      const lineDesc = line * (desc / 100);
      subtotal += line;
      desconto += lineDesc;
    });
    const total = subtotal - desconto;
    document.getElementById('subtotalOrcamento').textContent = formatCurrency(subtotal);
    document.getElementById('descontoOrcamento').textContent = formatCurrency(desconto);
    document.getElementById('totalOrcamento').textContent = formatCurrency(total);
    document.querySelectorAll('#orcamentoItens tbody tr').forEach(updateLineTotal);
    editarCondicao.disabled = total === 0;
    editarCondicao.style.pointerEvents = editarCondicao.disabled ? 'none' : 'auto';
    if(total === 0) resetCondicao();
    if(editarCondicao.value==='prazo' && window.Parcelamento){
      Parcelamento.updateTotal('editarParcelamento', parseCurrencyToCents(document.getElementById('totalOrcamento').textContent));
    }
  }

  function saveChanges(closeAfter) {
    const clienteVal = editarCliente.value;
    const clienteText = editarCliente.options[editarCliente.selectedIndex]?.textContent || '';
    const contatoVal = editarContato.value;
    const contatoText = editarContato.options[editarContato.selectedIndex]?.textContent || '';
    const condicaoVal = editarCondicao.value;
    const condicaoText = editarCondicao.options[editarCondicao.selectedIndex]?.textContent || '';
    const transportadoraVal = editarTransportadora.value;
    const transportadoraText = editarTransportadora.options[editarTransportadora.selectedIndex]?.textContent || '';
    const formaPagamentoVal = editarFormaPagamento.value;
    const totalTxt = document.getElementById('totalOrcamento').textContent;
    const itens = Array.from(itensTbody.children).map(tr => ({
      id: tr.dataset.id,
      nome: tr.children[0].textContent.trim(),
      qtd: parseFloat(tr.children[1].textContent) || 0,
      valor: parseFloat(tr.children[2].textContent) || 0,
      desc: parseFloat(tr.children[4].textContent) || 0
    }));
    if (data.row) {
      data.row.cells[1].textContent = clienteText;
      data.row.cells[3].textContent = totalTxt;
      data.row.cells[4].textContent = condicaoText;
      const statusCell = data.row.cells[5];
      statusCell.innerHTML = '';
      const statusSpan = document.createElement('span');
      const cls = statusMap[currentStatus] || 'badge-neutral';
      statusSpan.className = `${cls} px-3 py-1 rounded-full text-xs font-medium`;
      statusSpan.textContent = currentStatus;
      statusCell.appendChild(statusSpan);
      data.row.dataset.clienteId = clienteVal;
      data.row.dataset.cliente = clienteText;
      data.row.dataset.contatoId = contatoVal;
      data.row.dataset.contato = contatoText;
      data.row.dataset.transportadoraId = transportadoraVal;
      data.row.dataset.transportadora = transportadoraText;
      data.row.dataset.formaPagamento = formaPagamentoVal;
      data.row.dataset.items = JSON.stringify(itens);
      data.row.dataset.condicao = condicaoVal;
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
