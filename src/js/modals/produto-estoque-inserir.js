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
  document.addEventListener('keydown', function esc(e){
    if (e.key === 'Escape') {
      closeOverlay();
      document.removeEventListener('keydown', esc);
    }
  });

  const processoSelect = document.getElementById('processoSelect');
  const itemInput = document.getElementById('itemInput');
  const itensList = document.getElementById('itensList');
  const itemMsg = document.getElementById('itemMessage');
  const codigoAtual = window.produtoDetalhes?.codigo;

  // carga de processos
  (async () => {
    try {
      const processos = await window.electronAPI.listarEtapasProducao();
      processoSelect.innerHTML = '<option value="">Selecione um processo…</option>';
      processos.sort((a, b) => a.nome.localeCompare(b.nome));
      processos.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.nome;
        processoSelect.appendChild(opt);
      });
    } catch (err) {
      console.error('Erro ao carregar processos', err);
    }
  })();

  let itensCache = [];
  processoSelect.addEventListener('change', async () => {
    itemInput.value = '';
    itemInput.disabled = true;
    itensList.innerHTML = '';
    itemMsg.textContent = '';
    itensCache = [];
    const etapaId = processoSelect.value;
    if (!etapaId) return;
    try {
      // filtro por processo + produto
      const itens = await window.electronAPI.listarItensProcessoProduto(codigoAtual, etapaId);
      itensCache = itens;
      if (itens.length === 0) {
        itemMsg.textContent = 'Nenhum item disponível para este processo';
        return;
      }
      renderItens(itens);
      itemInput.disabled = false;
    } catch (err) {
      console.error('Erro ao carregar itens', err);
    }
  });

  function renderItens(data) {
    const seen = new Set();
    itensList.innerHTML = '';
    data.forEach(it => {
      if (seen.has(it.id)) return;
      seen.add(it.id);
      const opt = document.createElement('option');
      opt.value = it.nome;
      opt.dataset.id = it.id;
      itensList.appendChild(opt);
    });
  }

  let debounceTimer;
  itemInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const termo = itemInput.value.toLowerCase();
      const filtrados = itensCache.filter(it => it.nome.toLowerCase().includes(termo)); // debounce de busca
      renderItens(filtrados);
    }, 250);
  });

  const form = overlay.querySelector('form');
  if(form){
    form.addEventListener('submit', e => {
      e.preventDefault();
      showToast('Funcionalidade em desenvolvimento', 'info');
    });
  }
})();
