// Modal para inserção de insumos por processo
(function(){
  const overlay = document.getElementById('proximaEtapaOverlay');
  const voltarBtn = document.getElementById('voltarProximaEtapa');
  const tituloEl = document.getElementById('proximaEtapaTitulo');
  const itemSelect = document.getElementById('proximaEtapaItem');
  const qtdInput   = document.getElementById('proximaEtapaQuantidade');
  const inserirBtn = document.getElementById('inserirProximaEtapa');
  const limparBtn  = document.getElementById('limparProximaEtapa');
  const registrarBtn = document.getElementById('registrarProximaEtapa');
  const tabelaBody = document.querySelector('#proximaEtapaTabela tbody');
  const totalEl = document.getElementById('proximaEtapaTotal');

  const titulo = window.proximaEtapaTitulo || '';
  if (tituloEl) tituloEl.textContent = titulo; // título dinâmico

  let materiais = [];
  let itens = [];

  function formatCurrency(val){
    return (val || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }
  function formatNumber(val){
    const n = parseFloat(val) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  // totais
  function updateTotal(){
    const total = itens.reduce((s,it)=> s + (it.quantidade*it.preco_unitario),0);
    if(totalEl) totalEl.textContent = formatCurrency(total);
  }

  // ações editar/excluir
  function renderActions(item){
    const cell = item.row.querySelector('.action-cell');
    cell.innerHTML = `
      <div class="flex items-center justify-center space-x-2">
        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 edit-item" style="color: var(--color-primary)" title="Editar"></i>
        <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white delete-item" style="color: var(--color-red)" title="Excluir"></i>
      </div>`;
    cell.querySelector('.edit-item').addEventListener('click',()=>startEdit(item));
    cell.querySelector('.delete-item').addEventListener('click',()=>startDelete(item));
  }

  function startEdit(item){
    const cell = item.row.querySelector('.quantidade-cell');
    const original = item.quantidade;
    cell.innerHTML = `
      <div class="flex items-center justify-center space-x-1">
        <input type="number" step="0.01" class="w-20 bg-input border border-inputBorder rounded text-white text-sm text-center" value="${formatNumber(item.quantidade)}">
        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded text-green-400 confirm-edit"></i>
        <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded text-red-400 cancel-edit"></i>
      </div>`;
    const input = cell.querySelector('input');
    cell.querySelector('.confirm-edit').addEventListener('click',()=>{
      item.quantidade = parseFloat(input.value) || 0;
      cell.innerHTML = `<span class="quantidade-text">${formatNumber(item.quantidade)}</span>`;
      item.totalEl.textContent = formatCurrency(item.quantidade * item.preco_unitario);
      updateTotal();
      renderActions(item);
    });
    cell.querySelector('.cancel-edit').addEventListener('click',()=>{
      cell.innerHTML = `<span class="quantidade-text">${formatNumber(original)}</span>`;
      renderActions(item);
    });
  }

  function startDelete(item){
    const cell = item.row.querySelector('.action-cell');
    cell.innerHTML = `
      <div class="flex items-center justify-center space-x-2">
        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded text-green-400 confirm-del"></i>
        <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded text-red-400 cancel-del"></i>
      </div>`;
    cell.querySelector('.confirm-del').addEventListener('click',()=>{
      itens = itens.filter(i => i !== item);
      item.row.remove();
      updateTotal();
    });
    cell.querySelector('.cancel-del').addEventListener('click',()=>{
      renderActions(item);
    });
  }

  function renderItem(item){
    const tr = document.createElement('tr');
    tr.className = 'border-b border-white/5 item-row';
    tr.innerHTML = `
      <td class="py-4 px-4 text-white">${item.nome}</td>
      <td class="py-4 px-4 text-center quantidade-cell"><span class="quantidade-text">${formatNumber(item.quantidade)}</span></td>
      <td class="py-4 px-4 text-right text-white">${formatCurrency(item.preco_unitario)}</td>
      <td class="py-4 px-4 text-right text-white item-total">${formatCurrency(item.quantidade * item.preco_unitario)}</td>
      <td class="py-4 px-4 text-center action-cell"></td>`;
    tabelaBody.appendChild(tr);
    item.row = tr;
    item.totalEl = tr.querySelector('.item-total');
    renderActions(item);
  }

  // aviso de duplicidade
  function showDuplicateWarning(onConfirm){
    const warn = document.createElement('div');
    warn.id = 'duplicadoOverlay';
    warn.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    warn.innerHTML = `
      <div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
          <h3 class="text-lg font-semibold mb-4 text-yellow-300">Atenção</h3>
          <p class="text-sm text-gray-300">Somar à quantidade existente?</p>
          <div class="flex justify-center gap-6 mt-8">
            <button id="confirmarSomar" class="btn-warning px-6 py-2 rounded-lg text-white font-medium">Sim</button>
            <button id="cancelarSomar" class="btn-neutral px-6 py-2 rounded-lg text-white font-medium">Não</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(warn);
    warn.querySelector('#confirmarSomar').addEventListener('click',()=>{
      onConfirm();
      warn.remove();
    });
    warn.querySelector('#cancelarSomar').addEventListener('click',()=>warn.remove());
  }

  function resetFields(){
    if(itemSelect) itemSelect.value = '';
    if(qtdInput) qtdInput.value = '';
  }

  // inserção/duplicidade
  if (inserirBtn) inserirBtn.addEventListener('click',()=>{
    const id = itemSelect ? itemSelect.value : '';
    const quantidade = parseFloat(qtdInput && qtdInput.value);
    if(!id || !quantidade || quantidade <= 0) return;
    const materia = materiais.find(m=>String(m.id)===String(id));
    if(!materia) return;
    const existente = itens.find(it=>it.id===materia.id);
    if(existente){
      showDuplicateWarning(()=>{
        existente.quantidade += quantidade;
        existente.row.querySelector('.quantidade-text').textContent = formatNumber(existente.quantidade);
        existente.totalEl.textContent = formatCurrency(existente.quantidade * existente.preco_unitario);
        updateTotal();
        resetFields();
      });
      return;
    }
    const item = {
      id: materia.id,
      nome: materia.nome,
      unidade: materia.unidade,
      preco_unitario: materia.preco_unitario || 0,
      quantidade,
      processo: titulo
    };
    itens.push(item);
    renderItem(item);
    updateTotal();
    resetFields();
  });

  if (limparBtn) limparBtn.addEventListener('click',()=>{
    itens = [];
    if(tabelaBody) tabelaBody.innerHTML='';
    updateTotal();
    resetFields();
  });

  // registrar/transferir
  if (registrarBtn) registrarBtn.addEventListener('click',()=>{
    if(window.produtoEditarAPI && typeof window.produtoEditarAPI.adicionarProcessoItens==='function' && itens.length){
      const novos = itens.map(it=>({ ...it }));
      window.produtoEditarAPI.adicionarProcessoItens(novos);
    }
    closeOverlay();
  });

  // Helper function to close this overlay and restore the underlying modal
  function closeOverlay(){
    itens = [];
    if(tabelaBody) tabelaBody.innerHTML='';
    resetFields();
    updateTotal();
    Modal.close('proximaEtapa');
    const baseOverlay = document.getElementById('editarProdutoOverlay');
    baseOverlay.classList.remove('pointer-events-none', 'blur-sm');
  }

  // Fecha ao clicar fora do conteúdo
  overlay.addEventListener('click',(e)=>{ if(e.target===overlay) closeOverlay(); });
  if(voltarBtn) voltarBtn.addEventListener('click', closeOverlay);

  // carga filtrada
  (async ()=>{
    try{
      materiais = await window.electronAPI.listarMateriaPrima('');
      materiais = (materiais||[]).filter(m=> (m.categoria||'').toLowerCase() === titulo.toLowerCase());
      if(itemSelect){
        itemSelect.innerHTML = '<option value="">Nome do Item</option>' +
          materiais.map(m=>`<option value="${m.id}">${m.nome}</option>`).join('');
      }
    }catch(err){
      console.error('Erro ao carregar matérias', err);
    }
  })();
})();
