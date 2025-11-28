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
  const produto = window.produtoDetalhes;
  const lotes = Array.isArray(produto?.lotes) ? produto.lotes : [];
  const ultimoLote = lotes.length ? lotes[0] : null;
  const processoPadrao = ultimoLote?.processo || ultimoLote?.etapa || '';
  let processoPadraoId = processoPadrao && Number.isFinite(Number(processoPadrao)) ? String(processoPadrao) : '';
  let processoPadraoNome = processoPadraoId ? '' : processoPadrao;
  let processoSelecionadoId = '';
  const ultimoInsumoId = ultimoLote?.ultimo_insumo_id ? String(ultimoLote.ultimo_insumo_id) : '';
  const ultimoItemNome = ultimoLote?.ultimo_item || '';
  let preenchidoPadrao = false;
  let debounce;

  function atualizarProcessoSelecionadoId(){
    processoSelecionadoId = processoSelect.selectedOptions[0]?.dataset.id || '';
    processoSelect.dataset.selectedId = processoSelecionadoId;
  }

  function processoSelecionadoEhPadrao(){
    const selecionadoId = processoSelect.selectedOptions[0]?.dataset.id || '';
    const selecionadoNome = processoSelect.value;
    const idBate = processoPadraoId && selecionadoId === processoPadraoId;
    const nomeBate = processoPadraoNome && selecionadoNome === processoPadraoNome;
    return Boolean(idBate || nomeBate);
  }

  async function carregarProcessos(){ // carga de processos
    try{
      const processos = await window.electronAPI.listarEtapasProducao();
      processos.sort((a,b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      processoSelect.innerHTML = '<option value="">Selecione um processo…</option>' +
        processos.map(p => `<option value="${p.nome}" data-id="${p.id}">${p.nome}</option>`).join('');

      if(processoPadrao){
        const opcaoPadrao = Array.from(processoSelect.options).find(opt => {
          const opcaoId = opt.dataset.id || '';
          return opt.value === processoPadrao || opt.textContent === processoPadrao || opcaoId === String(processoPadrao);
        });
        if(opcaoPadrao){
          processoSelect.value = opcaoPadrao.value;
          processoPadraoId = opcaoPadrao.dataset.id || processoPadraoId;
          processoPadraoNome = opcaoPadrao.value || processoPadraoNome;
          atualizarProcessoSelecionadoId();
          preenchidoPadrao = false;
          carregarItens();
        }else{
          processoPadraoId = processoPadraoId || '';
          processoPadraoNome = processoPadraoNome || '';
        }
      }
    }catch(err){
      console.error('Erro ao listar processos', err);
    }
  }

  function preencherItemPadrao(){
    if(preenchidoPadrao) return;
    if(processoPadrao && !processoSelecionadoEhPadrao()) return;
    if(!ultimoInsumoId) return;
    const opcaoItem = Array.from(itemOptions.querySelectorAll('option')).find(o => String(o.dataset.id) === String(ultimoInsumoId));
    if(opcaoItem){
      itemInput.value = opcaoItem.value || ultimoItemNome || '';
      preenchidoPadrao = true;
    }
  }

  async function carregarItens(termo=''){ // filtro por processo + produto
    itemInput.disabled = true;
    itemMensagem.textContent = '';
    itemOptions.innerHTML = '';
    const etapa = processoSelecionadoId || processoSelect.value;
    const codigo = window.produtoDetalhes?.codigo;
    if(!etapa || !codigo){ itemInput.disabled = true; return; }
    try{
      const itens = await window.electronAPI.listarItensProcessoProduto(codigo, { id: processoSelecionadoId, nome: processoSelect.value }, termo);
      if(itens.length){
        itemOptions.innerHTML = itens.map(i => `<option value="${i.nome}" data-id="${i.id}"></option>`).join('');
      }else{
        itemMensagem.textContent = 'Nenhum item disponível para este processo';
      }
    }catch(err){
      console.error('Erro ao listar itens', err);
    }
    itemInput.disabled = false;
    preencherItemPadrao();
  }

  processoSelect.addEventListener('change', () => {
    itemInput.value = '';
    atualizarProcessoSelecionadoId();
    preenchidoPadrao = !processoSelecionadoEhPadrao();
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
      const etapa = processoSelecionadoId || processoSelect.value;
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
      const etapaNome = processoSelect.options[processoSelect.selectedIndex]?.textContent || etapa;
      const existente = produto.lotes?.find(l => {
        const etapaLote = String(l.etapa ?? l.processo ?? '');
        return (String(etapaLote) === String(etapa) || String(etapaLote) === String(processoSelect.value))
          && String(l.ultimo_insumo_id) === String(itemId);
      });
      if(existente){
        window.somarEstoqueInfo = {
          existing: existente,
          adicionar: quantidade,
          produto: {
            id: produto.id,
            nome: produto.nome,
            codigo: produto.codigo
          },
          etapa: etapaNome,
          itemNome: itemNome,
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
          quantidade,
          __meta: {
            produto: {
              id: produto.id,
              nome: produto.nome,
              codigo: produto.codigo
            },
            etapa: etapaNome,
            etapaId: processoSelecionadoId || null,
            itemNome,
            quantidade
          }
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
