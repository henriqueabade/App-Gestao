(function(){
  const overlay = document.getElementById('inserirEstoqueOverlay');
  const voltarBtn = document.getElementById('voltarInserirEstoque');

  function closeOverlay(){
    Modal.close('inserirEstoque');
    // Optional: na restauração este modal pode voltar sem o "Detalhes do
    // Produto" por baixo, e o acesso direto estourava ao fechar.
    document.getElementById('detalhesProdutoOverlay')
      ?.classList.remove('pointer-events-none', 'blur-sm');
  }

  voltarBtn.addEventListener('click', closeOverlay);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ closeOverlay(); document.removeEventListener('keydown', esc); } });

  const processoSelect = document.getElementById('processoSelect');
  const itemInput = document.getElementById('itemInput');
  const itemOptions = document.getElementById('itemOptions');
  const itemMensagem = document.getElementById('itemMensagem');
  // Por id, e não por `input[type=number]`: o `NumericInput` converte o campo
  // para `type="text"` assim que a página carrega, e o seletor antigo devolvia
  // `null` — o `Number(null.value)` estourava dentro do submit e o botão
  // "Registrar" não fazia absolutamente nada, sem erro visível.
  const quantidadeInput = document.getElementById('quantidadeEstoqueInput')
    || overlay.querySelector('[name="quantidade"]');
  const produto = window.produtoDetalhes;

  // ------------------------------------------------------------------
  // Preservação do trabalho (ver docs/restauracao-de-trabalho.md)
  //
  // Este modal abre POR CIMA do "Detalhes do Produto" e usa o mesmo global —
  // na restauração a pilha inteira é reaberta, então o contexto precisa voltar
  // aqui também. Além disso o Processo é preenchido por `fetch` e o Item só é
  // liberado depois que um processo é escolhido: os dois se perdiam.
  // ------------------------------------------------------------------
  window.EstadoTrabalho?.registrarConteudo?.('inserirEstoque', {
    capturar: () => ({
      __contexto: { produtoDetalhes: window.produtoDetalhes },
      processo: processoSelect?.value || '',
      item: itemInput?.value || ''
    }),
    restaurar: async (dados) => {
      if (!dados) return;
      const repor = window.EstadoTrabalho?.reporSelect;
      if (repor) await repor(processoSelect, dados.processo);
      // O campo de item só é habilitado depois do processo, por isso vem depois.
      if (itemInput && dados.item) {
        itemInput.value = dados.item;
        itemInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });

  const produtoId = produto?.id || null;
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

  async function carregarItens(termo=''){
  itemInput.disabled = true;
  itemMensagem.textContent = '';
  itemOptions.innerHTML = '';

  const etapa =  processoSelect.value;
  const codigo = window.produtoDetalhes?.codigo;

  if(!etapa || (!codigo && !produtoId)){
    itemInput.disabled = true;
    return;
  }

  try {
    const itens = await window.electronAPI.listarItensProcessoProduto(
      codigo,
      { id: processoSelecionadoId, nome: processoSelect.value },
      termo,
      produtoId
    );

    if(itens.length){
      itemOptions.innerHTML = itens.map(i =>
        `<option value="${i.nome}" data-id="${i.id}"></option>`
      ).join('');
    } else {
      itemMensagem.textContent = 'Nenhum item disponível para este processo';
    }
  } catch (err) {
    console.error('Erro ao listar itens', err);
  }

  itemInput.disabled = false;
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

  /** Limpa o formulário e atualiza a grade de produtos e os detalhes. */
  /**
   * Devolve uma promessa: quem chama espera as duas tabelas terminarem antes de
   * tirar o carregamento da tela. Sem isso o véu caía com os dados antigos
   * ainda no fundo, e a atualização acontecia à vista do usuário.
   */
  async function limparERecarregar(){
    processoSelect.value = '';
    itemInput.value = '';
    itemOptions.innerHTML = '';
    itemInput.disabled = true;
    if(quantidadeInput) quantidadeInput.value = '';
    await Promise.all([
      window.reloadDetalhesProduto?.(),
      // Pelo `window`, explicitamente: a coluna "Quantidade" da grade de
      // Produtos sai daqui e ficava com o valor velho depois de registrar.
      window.carregarProdutos?.()
    ]);
  }

  if(form){
    const registrar = async () => {
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
          reload: limparERecarregar
        };
        Modal.open('modals/produtos/estoque-somar.html', '../js/modals/produto-estoque-somar.js', 'somarEstoque', true);
        return;
      }
      // A peça só entra no estoque depois de alguém dizer se ela foi produzida
      // agora. Sem essa resposta o estoque de peças subia e o de matéria-prima
      // ficava parado — o sistema passava a acreditar em material que já tinha
      // virado peça.
      const decisao = await window.InsumosDaPeca?.decidir({
        direcao: 'saida',
        unidades: quantidade,
        peca: produto.nome || produto.codigo || '',
        ponto: `${etapaNome} · ${itemNome}`,
        // Consultado só se a resposta for "sim": é o que diz quais insumos
        // ficariam negativos, para pedir aprovação antes de gravar.
        previsao: () => window.electronAPI.previsaoInsumosPeca({
          produtoId: produto.id,
          ultimoInsumoId: itemId,
          unidades: quantidade,
          direcao: 'saida'
        })
      });
      if (!decisao) return;
      const abaterInsumos = decisao.mexer;

      try{
        // O véu fica de pé até a peça, os insumos e as duas auditorias
        // terminarem. Só depois disso a tela volta a aceitar clique.
        const resultado = await window.InsumosDaPeca.comCarregamento(
          async () => {
            const r = await window.electronAPI.inserirLoteProduto({
              produtoId: produto.id,
              etapa,
              ultimoInsumoId: itemId,
              quantidade,
              abaterInsumos,
              justificativaNegativo: decisao.justificativa,
              __meta: {
                produto: {
                  id: produto.id,
                  nome: produto.nome,
                  codigo: produto.codigo
                },
                etapa: etapaNome,
                etapaId: processoSelecionadoId || null,
                itemNome,
                quantidade,
                abaterInsumos
              }
            });
            // Ainda sob o véu: quando ele cair, a tela de trás já mostra a peça
            // nova. Recarregar depois deixa um instante com o dado velho.
            await limparERecarregar();
            return r;
          },
          abaterInsumos
        );
        const extra = window.InsumosDaPeca?.resumo(resultado, abaterInsumos) || '';
        showToast(`Produto inserido.${extra}`, 'success');
      }catch(err){
        console.error(err);
        // Falha parcial mantém o formulário como está: o usuário precisa do
        // contexto para entender o que conferir. A grade é recarregada porque a
        // peça pode ter entrado — mostrar o valor velho seria outra mentira.
        if (err?.parcial) window.reloadDetalhesProduto?.();
        showToast(err?.parcial ? err.message : 'Erro ao inserir produto', 'error');
      }
    };

    // `bindSubmit` cobre o clique E o Enter, e mantém o botão travado até a
    // gravação terminar: dois envios aqui criariam dois lotes do mesmo item.
    if (window.BotaoAcao?.bindSubmit) {
      window.BotaoAcao.bindSubmit(form, registrar);
    } else {
      let ocupado = false;
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (ocupado) return;
        ocupado = true;
        try { await registrar(); } finally { ocupado = false; }
      });
    }
  }
})();
