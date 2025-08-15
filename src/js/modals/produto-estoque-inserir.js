(function(){
  const overlay = document.getElementById('inserirEstoqueOverlay');
  const voltarBtn = document.getElementById('voltarInserirEstoque');

  function closeOverlay(){
    Modal.close('inserirEstoque');
    const baseOverlay = document.getElementById('detalhesProdutoOverlay');
    baseOverlay.classList.remove('pointer-events-none', 'blur-sm');
  }

  overlay.addEventListener('click', e => { if(e.target === overlay) closeOverlay(); });
  voltarBtn.addEventListener('click', closeOverlay);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ closeOverlay(); document.removeEventListener('keydown', esc); } });

  const processoSelect = document.getElementById('processoSelect');
  const itemInput = document.getElementById('itemInput');
  const itemOptions = document.getElementById('itemOptions');
  const itemMensagem = document.getElementById('itemMensagem');
  const quantidadeInput = overlay.querySelector('input[type="number"]');
  let debounce;

  async function carregarProcessos(){ // carga de processos
    try{
      const processos = await window.electronAPI.listarEtapasProducao();
      processos.sort((a,b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      processoSelect.innerHTML = '<option value="">Selecione um processo…</option>' +
        processos.map(p => `<option value="${p.nome}" data-id="${p.id}">${p.nome}</option>`).join('');
    }catch(err){
      console.error('Erro ao listar processos', err);
    }
  }

  async function carregarItens(termo=''){ // filtro por processo + produto
    itemInput.disabled = true;
    itemMensagem.textContent = '';
    itemOptions.innerHTML = '';
    const etapa = processoSelect.value;
    const codigo = window.produtoDetalhes?.codigo;
    if(!etapa || !codigo){ itemInput.disabled = true; return; }
    try{
      const itens = await window.electronAPI.listarItensProcessoProduto(codigo, etapa, termo);
      if(itens.length){
        itemOptions.innerHTML = itens.map(i => `<option value="${i.nome}" data-id="${i.id}"></option>`).join('');
      }else{
        itemMensagem.textContent = 'Nenhum item disponível para este processo';
      }
    }catch(err){
      console.error('Erro ao listar itens', err);
    }
    itemInput.disabled = false;
  }

  processoSelect.addEventListener('change', () => {
    itemInput.value = '';
    carregarItens();
  });

  itemInput.addEventListener('input', () => { // debounce de busca
    clearTimeout(debounce);
    debounce = setTimeout(() => carregarItens(itemInput.value), 250);
  });

  carregarProcessos();

  const form = overlay.querySelector('form');
  if(form){
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const etapa = processoSelect.value;
      const itemNome = itemInput.value.trim();
      const option = Array.from(itemOptions.querySelectorAll('option')).find(o => o.value === itemNome);
      const itemId = option?.dataset.id;
      const quantidade = Number(quantidadeInput.value);
      if(!etapa || !itemId || !quantidade){
        showToast('Preencha todos os campos', 'error');
        return;
      }
      const produto = window.produtoDetalhes;
      if(!produto) return;
      const existente = produto.lotes?.find(l => String(l.etapa) === String(etapa) && String(l.ultimo_insumo_id) === String(itemId));
      if(existente){
        window.somarEstoqueInfo = {
          existing: existente,
          adicionar: quantidade,
          reload: () => {
            processoSelect.value = '';
            itemInput.value = '';
            itemOptions.innerHTML = '';
            itemInput.disabled = true;
            quantidadeInput.value = '';
            window.reloadDetalhesProduto?.();
            if(typeof carregarProdutos === 'function') carregarProdutos();
          }
        };
        Modal.open('modals/produtos/estoque-somar.html', '../js/modals/produto-estoque-somar.js', 'somarEstoque', true);
        return;
      }
      try{
        await window.electronAPI.inserirLoteProduto({
          produtoId: produto.id,
          etapa,
          ultimoInsumoId: itemId,
          quantidade
        });
        showToast('Produto inserido', 'success');
        processoSelect.value = '';
        itemInput.value = '';
        itemOptions.innerHTML = '';
        itemInput.disabled = true;
        quantidadeInput.value = '';
        window.reloadDetalhesProduto?.();
        if(typeof carregarProdutos === 'function') carregarProdutos();
      }catch(err){
        console.error(err);
        showToast('Erro ao inserir produto', 'error');
      }
    });
  }
})();
