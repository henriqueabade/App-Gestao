(function(){
  const overlay = document.getElementById('inserirEstoqueOverlay');
  const fecharBtn = document.getElementById('fecharInserirEstoque');
  const voltarBtn = document.getElementById('voltarInserirEstoque');

  function closeOverlay(){
    Modal.close('inserirEstoque');
    const baseOverlay = document.getElementById('detalhesProdutoOverlay');
    baseOverlay.classList.remove('pointer-events-none', 'blur-sm');
  }

  overlay.addEventListener('click', e => { if(e.target === overlay) closeOverlay(); });
  fecharBtn.addEventListener('click', closeOverlay);
  voltarBtn.addEventListener('click', closeOverlay);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ closeOverlay(); document.removeEventListener('keydown', esc); } });

  const processoSelect = document.getElementById('processoSelect');
  const itemInput = document.getElementById('itemInput');
  const itemOptions = document.getElementById('itemOptions');
  const itemMensagem = document.getElementById('itemMensagem');
  let debounce;

  async function carregarProcessos(){ // carga de processos
    try{
      const processos = await window.electronAPI.listarEtapasProducao();
      processoSelect.innerHTML = '<option value="">Selecione um processo…</option>' +
        processos.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
    }catch(err){
      console.error('Erro ao listar processos', err);
    }
  }

  async function carregarItens(termo=''){ // filtro por processo + produto
    itemInput.disabled = true;
    itemMensagem.textContent = '';
    itemOptions.innerHTML = '';
    const etapaId = processoSelect.value;
    const codigo = window.produtoDetalhes?.codigo;
    if(!etapaId || !codigo){ itemInput.disabled = true; return; }
    try{
      const itens = await window.electronAPI.listarItensProcessoProduto(codigo, etapaId, termo);
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
    form.addEventListener('submit', e => {
      e.preventDefault();
      showToast('Funcionalidade em desenvolvimento', 'info');
    });
  }
})();
