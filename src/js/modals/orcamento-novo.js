(() => {
  const overlayId = 'novoOrcamento';
  const overlay = document.getElementById('novoOrcamentoOverlay');
  const close = () => Modal.close(overlayId);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e){ if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', esc); } });

  const clients = {};
  const products = {};

  const parseCurrencyToCents = window.parseCurrencyToCents || (v => {
    if (!v) return 0;
    const normalized = v.toString()
      .replace(/\s/g,'')
      .replace(/[A-Za-z\$]/g,'')
      .replace(/\./g,'')
      .replace(',', '.');
    const value = Number(normalized);
    return isNaN(value) ? 0 : Math.round(value * 100);
  });

  const clienteSelect = document.getElementById('novoCliente');
  const contatoSelect = document.getElementById('novoContato');
  const produtoSelect = document.getElementById('itemProduto');
  const itensTbody = document.querySelector('#novoItensTabela tbody');
  const condicaoSelect = document.getElementById('novoCondicao');
  const transportadoraSelect = document.getElementById('novoTransportadora');
  const formaPagamentoSelect = document.getElementById('novoFormaPagamento');
  const donoSelect = document.getElementById('novoDono');
  const pagamentoBox = document.getElementById('novoPagamento');
  const condicaoWrapper = condicaoSelect.parentElement;
  let parcelamentoLoaded = false;
  let condicaoDefinida = false;
  let prevCondicao = condicaoSelect.value;
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
    condicaoSelect.value = '';
    condicaoSelect.setAttribute('data-filled','false');
    pagamentoBox.classList.add('hidden');
    pagamentoBox.innerHTML='';
    condicaoDefinida = false;
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
    overlay.innerHTML=`<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-yellow-500/20 ring-1 ring-yellow-500/30 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-yellow-400">Condição de Pagamento Bloqueada</h3><p class="text-sm text-gray-300 mb-6">Para definir condição de pagamento é necessario adicionar itens ao orçamento primeiro!</p><div class="flex justify-center"><button id="blockedOk" class="btn-warning px-6 py-2 rounded-lg text-white font-medium active:scale-95">OK</button></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#blockedOk').addEventListener('click',()=>overlay.remove());
  }

  function showMissingDialog(fields){
    const overlay=document.createElement('div');
    overlay.className='fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.innerHTML=`<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-yellow-500/20 ring-1 ring-yellow-500/30 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-yellow-400">Dados Incompletos</h3><p class="text-sm text-gray-300 mb-6">Preencha os campos: ${fields.join(', ')}</p><div class="flex justify-center"><button id="missingOk" class="btn-warning px-6 py-2 rounded-lg text-white font-medium active:scale-95">OK</button></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#missingOk').addEventListener('click',()=>overlay.remove());
  }
  function confirmResetIfNeeded(action){
    if(!condicaoDefinida){action();return;}
    showResetDialog(ok=>{
      if(!ok) return;
      resetCondicao();
      action();
    });
  }
  function updateCondicao(){
    if(condicaoSelect.value==='vista'){
      pagamentoBox.innerHTML=`
        <div class="relative w-40">
          <input id="novoPrazoVista" type="number" min="0" placeholder=" " class="peer w-full bg-input border border-inputBorder rounded-lg px-4 py-3 text-white placeholder-transparent focus:border-primary focus:ring-2 focus:ring-primary/50 transition" />
          <label for="novoPrazoVista" class="absolute left-4 top-1/2 -translate-y-1/2 text-base text-gray-300 pointer-events-none transition-all duration-150 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-focus:top-0 peer-focus:-translate-y-full peer-focus:text-xs peer-focus:text-primary peer-valid:top-0 peer-valid:-translate-y-full peer-valid:text-xs">Prazo (dias)</label>
        </div>`;
      pagamentoBox.classList.remove('hidden');
    } else if(condicaoSelect.value==='prazo'){
      pagamentoBox.classList.remove('hidden');
      pagamentoBox.innerHTML='<div id="novoParcelamento"></div>';
      loadParcelamento().then(()=>Parcelamento.init('novoParcelamento',{getTotal:()=>parseCurrencyToCents(document.getElementById('novoTotal').textContent)}));
    } else {
      pagamentoBox.classList.add('hidden');
      pagamentoBox.innerHTML='';
    }
  }
  condicaoSelect.addEventListener('change', ()=>{condicaoDefinida=true;condicaoSelect.setAttribute('data-filled','true');updateCondicao();applyDefaultDiscounts();recalcTotals();});
  condicaoWrapper.addEventListener('click',e=>{if(condicaoSelect.disabled){e.preventDefault();showBlockedDialog();}});
  condicaoSelect.disabled = true;
  condicaoSelect.style.pointerEvents='none';
  updateCondicao();

  async function carregarClientes(){
    try {
      const resp = await fetch('http://localhost:3000/api/clientes/lista');
      const data = await resp.json();
      clienteSelect.innerHTML = '<option value="" disabled selected hidden></option>' +
        data.map(c => `<option value="${c.id}">${c.nome_fantasia}</option>`).join('');
      data.forEach(c => { clients[c.id] = c; });
      clienteSelect.setAttribute('data-filled', 'false');
    } catch(err){ console.error('Erro ao carregar clientes', err); }
  }

  async function carregarUsuarios(){
    try {
      const resp = await fetch('http://localhost:3000/api/usuarios/lista');
      const data = await resp.json();
      donoSelect.innerHTML = '<option value="" disabled selected hidden></option>' +
        data.map(u => `<option value="${u.nome}">${u.nome}</option>`).join('');
      donoSelect.setAttribute('data-filled','false');
    } catch(err){ console.error('Erro ao carregar usuários', err); }
  }

  async function carregarContatos(clienteId){
    contatoSelect.innerHTML = '<option value="" disabled selected hidden></option>';
    contatoSelect.setAttribute('data-filled', 'false');
    if(!clienteId) return;
    try {
      const resp = await fetch(`http://localhost:3000/api/clientes/${clienteId}`);
      const data = await resp.json();
      (data.contatos || []).forEach(ct => {
        const opt = document.createElement('option');
        opt.value = ct.id;
        opt.textContent = ct.nome;
        contatoSelect.appendChild(opt);
      });
    } catch(err){ console.error('Erro ao carregar contatos', err); }
  }

  async function carregarTransportadoras(clienteId){
    transportadoraSelect.innerHTML = '<option value="" disabled selected hidden></option>';
    transportadoraSelect.setAttribute('data-filled', 'false');
    if(!clienteId) return;
    try {
      const resp = await fetch(`http://localhost:3000/api/transportadoras/${clienteId}`);
      const data = await resp.json();
      data.forEach(tp => {
        const opt = document.createElement('option');
        opt.value = tp.id;
        opt.textContent = tp.nome;
        transportadoraSelect.appendChild(opt);
      });
    } catch(err){ console.error('Erro ao carregar transportadoras', err); }
  }

  async function carregarProdutos(){
    try {
      const lista = await (window.electronAPI?.listarProdutos?.() ?? []);
      produtoSelect.innerHTML = '<option value="" disabled selected hidden></option>' +
        lista.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
      lista.forEach(p => {
        products[p.id] = {
          nome: p.nome,
          valor: Number(p.preco_venda) || 0,
          codigo: p.codigo,
          ncm: p.ncm
        };
      });
      produtoSelect.setAttribute('data-filled', 'false');
    } catch(err){ console.error('Erro ao carregar produtos', err); }
  }

  // sincroniza labels flutuantes
  ['novoCliente','novoContato','novoCondicao','novoTransportadora','novoFormaPagamento','itemProduto','novoDono'].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    const sync = () => el.setAttribute('data-filled', el.value !== '' ? 'true' : 'false');
    sync();
    el.addEventListener('change', sync);
    el.addEventListener('blur', sync);
  });

  clienteSelect.addEventListener('change', () => {
    carregarContatos(clienteSelect.value);
    carregarTransportadoras(clienteSelect.value);
    if(!donoSelect.value){
      const donoCli = clients[clienteSelect.value]?.dono_cliente;
      if(donoCli){
        donoSelect.value = donoCli;
        donoSelect.setAttribute('data-filled','true');
      }
    }
  });

  carregarClientes();
  carregarUsuarios();
  carregarProdutos();

  function formatCurrency(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function updateLineTotal(tr){
    const qty = parseFloat(tr.children[1].textContent) || 0;
    const val = parseFloat(tr.children[2].textContent) || 0;
    const desc = parseFloat(tr.children[4].textContent) || 0;
    const valDesc = val * (1 - desc / 100);
    tr.children[3].textContent = valDesc.toFixed(2);
    tr.querySelector('.total-cell').textContent = formatCurrency(qty * valDesc);
  }

  function applyDefaultDiscounts(){
    const newCond = condicaoSelect.value;
    itensTbody.querySelectorAll('tr').forEach(tr => {
      const qty = parseFloat(tr.children[1].textContent) || 0;
      const currentDesc = parseFloat(tr.children[4].textContent) || 0;
      const oldDefault = (qty > 1 ? 5 : 0) + (prevCondicao === 'vista' ? 5 : 0);
      const special = Math.max(currentDesc - oldDefault, 0);
      const newDefault = (qty > 1 ? 5 : 0) + (newCond === 'vista' ? 5 : 0);
      const newDesc = special + newDefault;
      tr.children[4].textContent = newDesc.toFixed(2);
      updateLineTotal(tr);
    });
    prevCondicao = newCond;
  }

  function recalcTotals() {
    let subtotal = 0;
    let descPagTot = 0;
    let descEspTot = 0;
    itensTbody.querySelectorAll('tr').forEach(tr => {
      const qty = parseFloat(tr.children[1].textContent) || 0;
      const val = parseFloat(tr.children[2].textContent) || 0;
      const descTotal = parseFloat(tr.children[4].textContent) || 0;
      const defaultDesc = (qty > 1 ? 5 : 0) + (condicaoSelect.value === 'vista' ? 5 : 0);
      const descPagPrc = Math.min(defaultDesc, descTotal);
      const descEspPrc = Math.max(descTotal - descPagPrc, 0);
      const line = qty * val;
      subtotal += line;
      descPagTot += (val * (descPagPrc / 100)) * qty;
      descEspTot += (val * (descEspPrc / 100)) * qty;
    });
    const desconto = descPagTot + descEspTot;
    document.getElementById('novoSubtotal').textContent = formatCurrency(subtotal);
    document.getElementById('novoDescPag').textContent = formatCurrency(descPagTot);
    document.getElementById('novoDescEsp').textContent = formatCurrency(descEspTot);
    document.getElementById('novoDesconto').textContent = formatCurrency(desconto);
    const total = subtotal - desconto;
    document.getElementById('novoTotal').textContent = formatCurrency(total);
    itensTbody.querySelectorAll('tr').forEach(updateLineTotal);
    condicaoSelect.disabled = total === 0;
    condicaoSelect.style.pointerEvents = condicaoSelect.disabled ? 'none' : 'auto';
    if(total === 0) resetCondicao();
    if(condicaoSelect.value==='prazo' && window.Parcelamento){
      Parcelamento.updateTotal('novoParcelamento', parseCurrencyToCents(document.getElementById('novoTotal').textContent));
    }
  }

  function attachRowEvents(tr){
    const editBtn = tr.querySelector('.fa-edit');
    const delBtn = tr.querySelector('.fa-trash');
    delBtn.addEventListener('click', () => {
      showActionDialog('Deseja remover este item?', ok => {
        if(!ok) return;
        confirmResetIfNeeded(() => { tr.remove(); recalcTotals(); });
      });
    });
    editBtn.addEventListener('click', () => startEdit(tr));
  }

  function startEdit(tr){
    const qtyCell = tr.children[1];
    const valCell = tr.children[2];
    const descCell = tr.children[4];
    const actionsCell = tr.children[6];

    const qtyVal = qtyCell.textContent.trim();
    const valVal = valCell.textContent.trim();
    const descVal = descCell.textContent.trim();

    qtyCell.innerHTML = `<input type="number" class="w-16 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-center focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${qtyVal}" min="1">`;
    valCell.innerHTML = `<input type="number" class="w-24 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-right focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${valVal}" min="0" step="0.01">`;
    descCell.innerHTML = `<input type="number" class="w-16 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-center focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${descVal}" min="0" step="0.01">`;

    actionsCell.innerHTML = `
      <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-green-400"></i>
      <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
    `;
    const confirmBtn = actionsCell.querySelector('.fa-check');
    const cancelBtn = actionsCell.querySelector('.fa-times');
    const qtyInput = qtyCell.querySelector('input');
    const valInput = valCell.querySelector('input');
    const descInput = descCell.querySelector('input');

    qtyInput.addEventListener('input', () => {
      const q = parseFloat(qtyInput.value) || 0;
      const condDesc = (condicaoSelect.value === 'vista' ? 5 : 0);
      const qtyDesc = q > 1 ? 5 : 0;
      descInput.value = (condDesc + qtyDesc).toFixed(2);
    });

    confirmBtn.addEventListener('click', () => {
      showActionDialog('Deseja salvar as alterações deste item?', ok => {
        if(!ok) return;
        confirmResetIfNeeded(() => {
          qtyCell.textContent = qtyInput.value;
          valCell.textContent = parseFloat(valInput.value).toFixed(2);
          descCell.textContent = parseFloat(descInput.value).toFixed(2);
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
      descCell.textContent = descVal;
      actionsCell.innerHTML = `
        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
        <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
      `;
      attachRowEvents(tr);
      recalcTotals();
    });
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

  function showActionDialog(message, cb){
    const overlay=document.createElement('div');
    overlay.className='fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.innerHTML=`<div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-yellow-300">Atenção</h3><p class="text-sm text-gray-300 mb-6">${message}</p><div class="flex justify-center gap-4"><button id="actYes" class="btn-warning px-4 py-2 rounded-lg text-white font-medium">Sim</button><button id="actNo" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Não</button></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#actYes').addEventListener('click',()=>{overlay.remove();cb(true);});
    overlay.querySelector('#actNo').addEventListener('click',()=>{overlay.remove();cb(false);});
  }

  function addItem(prodId, qtd){
    const product = products[prodId];
    if (!product) return;
    const existing = Array.from(itensTbody.children).find(tr => tr.dataset.id === prodId);
    if (existing) {
      showDuplicateDialog(choice => {
        if (choice === 'somar') {
          const qtyCell = existing.children[1];
          const newQty = (parseFloat(qtyCell.textContent) || 0) + qtd;
          qtyCell.textContent = newQty;
          const defaultDesc = (newQty > 1 ? 5 : 0) + (condicaoSelect.value === 'vista' ? 5 : 0);
          existing.children[4].textContent = defaultDesc.toFixed(2);
        } else if (choice === 'substituir') {
          existing.children[1].textContent = qtd;
          existing.children[2].textContent = product.valor.toFixed(2);
          const defaultDesc = (qtd > 1 ? 5 : 0) + (condicaoSelect.value === 'vista' ? 5 : 0);
          existing.children[4].textContent = defaultDesc.toFixed(2);
        }
        updateLineTotal(existing);
        recalcTotals();
      });
      return;
    }

    const defaultDesc = (qtd > 1 ? 5 : 0) + (condicaoSelect.value === 'vista' ? 5 : 0);
    const tr = document.createElement('tr');
    tr.dataset.id = prodId;
    tr.className = 'border-b border-white/10';
    tr.innerHTML = `
        <td class="px-6 py-4 text-sm text-white">${product.nome}</td>
        <td class="px-6 py-4 text-center text-sm text-white">${qtd}</td>
        <td class="px-6 py-4 text-right text-sm text-white">${product.valor.toFixed(2)}</td>
        <td class="px-6 py-4 text-right text-sm text-white">0.00</td>
        <td class="px-6 py-4 text-center text-sm text-white">${defaultDesc.toFixed(2)}</td>
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
    confirmResetIfNeeded(() => {
      addItem(prodId, qtd);
      produtoSelect.value = '';
      produtoSelect.setAttribute('data-filled', 'false');
      document.getElementById('itemQtd').value = 1;
    });
  });

  function saveQuote(status) {
    const missing = [];
    const clienteVal = clienteSelect.value;
    if (!clienteVal) missing.push('Cliente');
    const contatoVal = contatoSelect.value;
    if (!contatoVal) missing.push('Contato');
    const validadeVal = document.getElementById('novoValidade').value;
    if (!validadeVal) missing.push('Validade');
    const condicaoVal = condicaoSelect.value;
    if (!condicaoVal) missing.push('Condição de pagamento');
    const transportadoraVal = transportadoraSelect.value;
    if (!transportadoraVal) missing.push('Transportadora');
    const formaPagamentoVal = formaPagamentoSelect.value;
    if (!formaPagamentoVal) missing.push('Forma de Pagamento');
    const donoVal = donoSelect.value;
    if (!donoVal) missing.push('Dono');
    if (itensTbody.children.length === 0) missing.push('Itens');

    const dataEmissao = new Date();
    let parcelas = 1;
    let prazo = '';
    let parcelasDetalhes = [];
    let tipoParcela = 'a vista';
    if (condicaoVal === 'vista') {
      const prazoVista = document.getElementById('novoPrazoVista')?.value;
      if (!prazoVista) missing.push('Prazo (dias)');
      else {
        prazo = prazoVista;
        const totalCents = parseCurrencyToCents(document.getElementById('novoTotal').textContent);
        parcelasDetalhes.push({
          valor: totalCents / 100,
          data_vencimento: new Date(dataEmissao.getTime() + parseInt(prazoVista, 10) * 86400000).toISOString().split('T')[0]
        });
      }
    } else if (condicaoVal === 'prazo') {
      const pdata = Parcelamento.getData('novoParcelamento');
      if (!pdata || !pdata.canRegister) missing.push('Parcelamento');
      else {
        parcelas = pdata.count;
        prazo = pdata.items.map(it => it.dueInDays).join('/');
        parcelasDetalhes = pdata.items.map(it => ({
          valor: it.amount / 100,
          data_vencimento: new Date(dataEmissao.getTime() + (it.dueInDays || 0) * 86400000).toISOString().split('T')[0]
        }));
        tipoParcela = pdata.mode === 'equal' ? 'igual' : 'diferente';
      }
    }

    if (missing.length) {
      showMissingDialog(missing);
      return;
    }

    const confirmMsg = status === 'Rascunho' ? 'Deseja salvar este orçamento?' : 'Deseja salvar e enviar este orçamento?';
    showActionDialog(confirmMsg, async ok => {
      if (!ok) return;
      try {
        const subtotal = parseCurrencyToCents(document.getElementById('novoSubtotal').textContent) / 100;
        let descPagTot = 0;
        let descEspTot = 0;
        const itens = Array.from(itensTbody.children).map(tr => {
          const prodId = tr.dataset.id;
          const qty = parseFloat(tr.children[1].textContent) || 0;
          const val = parseFloat(tr.children[2].textContent) || 0;
          const descTotal = parseFloat(tr.children[4].textContent) || 0;
          const defaultDesc = (qty > 1 ? 5 : 0) + (condicaoVal === 'vista' ? 5 : 0);
          const descPagPrc = Math.min(defaultDesc, descTotal);
          const descEspPrc = Math.max(descTotal - descPagPrc, 0);
          const descPagVal = val * (descPagPrc / 100);
          const descEspVal = val * (descEspPrc / 100);
          const valorDesc = descPagVal + descEspVal;
          const valDesc = val - valorDesc;
          descPagTot += descPagVal * qty;
          descEspTot += descEspVal * qty;
          return {
            produto_id: prodId,
            codigo: products[prodId]?.codigo || '',
            nome: tr.children[0].textContent.trim(),
            ncm: products[prodId]?.ncm || '',
            quantidade: qty,
            valor_unitario: val,
            valor_unitario_desc: valDesc,
            desconto_pagamento: descPagVal,
            desconto_pagamento_prc: descPagPrc,
            desconto_especial: descEspVal,
            desconto_especial_prc: descEspPrc,
            valor_desc: valorDesc,
            desconto_total: valorDesc * qty,
            valor_total: valDesc * qty
          };
        });
        const descontoTotal = descPagTot + descEspTot;
        const total = subtotal - descontoTotal;
        const body = {
          cliente_id: clienteVal,
          contato_id: contatoVal,
          situacao: status,
          parcelas,
          forma_pagamento: formaPagamentoVal,
          transportadora: transportadoraSelect.options[transportadoraSelect.selectedIndex]?.textContent || '',
          desconto_pagamento: descPagTot,
          desconto_especial: descEspTot,
          desconto_total: descontoTotal,
          valor_final: total,
          observacoes: document.getElementById('novoObservacoes').value || '',
          validade: validadeVal,
          prazo,
          dono: donoVal,
          tipo_parcela: tipoParcela,
          itens,
          parcelas_detalhes: parcelasDetalhes
        };
        const resp = await fetch('http://localhost:3000/api/orcamentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error('Erro ao salvar');
        await resp.json();
        if (window.reloadOrcamentos) await window.reloadOrcamentos();
        Modal.close(overlayId);
        showToast(status === 'Rascunho' ? 'Orçamento salvo com sucesso!' : 'Orçamento salvo e enviado com sucesso!', 'success');
      } catch (err) {
        console.error(err);
        showToast('Erro ao salvar orçamento', 'error');
      }
    });
  }

  document.getElementById('salvarNovoOrcamento').addEventListener('click', () => saveQuote('Rascunho'));
  document.getElementById('enviarNovoOrcamento').addEventListener('click', () => saveQuote('Pendente'));
  document.getElementById('cancelarNovoOrcamento').addEventListener('click', close);
  document.getElementById('voltarNovoOrcamento').addEventListener('click', close);

  const limparBtn = document.getElementById('limparNovoOrcamento');
  if (limparBtn) {
    limparBtn.addEventListener('click', () => {
      confirmResetIfNeeded(() => {
        overlay.querySelectorAll('input').forEach(i => i.value = '');
        overlay.querySelectorAll('textarea').forEach(t => t.value = '');
        overlay.querySelectorAll('select').forEach(s => { s.selectedIndex = 0; s.setAttribute('data-filled', 'false'); });
        itensTbody.innerHTML = '';
        recalcTotals();
      });
    });
  }
})();

