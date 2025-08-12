(function(){
  const overlay = document.getElementById('editarProdutoOverlay');
  const close = () => Modal.close('editarProduto');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharEditarProduto').addEventListener('click', close);
  document.getElementById('voltarEditarProduto').addEventListener('click', close);

  const tableBody = document.querySelector('#itensTabela tbody');
  const fabricacaoInput = document.getElementById('fabricacaoInput');
  const acabamentoInput = document.getElementById('acabamentoInput');
  const montagemInput = document.getElementById('montagemInput');
  const embalagemInput = document.getElementById('embalagemInput');
  const markupInput = document.getElementById('markupInput');
  const commissionInput = document.getElementById('commissionInput');
  const taxInput = document.getElementById('taxInput');
  const etapaSelect = document.getElementById('etapaSelect');

  const nomeInput = document.getElementById('nomeInput');
  const codigoInput = document.getElementById('codigoInput');
  const ncmInput = document.getElementById('ncmInput');
  const precoVendaEl = document.getElementById('precoVenda');
  const ultimaDataEl = document.getElementById('ultimaModificacaoData');
  const ultimaHoraEl = document.getElementById('ultimaModificacaoHora');

  const totalInsumosEl = document.getElementById('totalInsumos');
  const totalMaoObraEl = document.getElementById('totalMaoObra');
  const subTotalEl = document.getElementById('subTotal');
  const markupValorEl = document.getElementById('markupValor');
  const custoTotalEl = document.getElementById('custoTotal');
  const comissaoValorEl = document.getElementById('comissaoValor');
  const impostoValorEl = document.getElementById('impostoValor');
  const valorVendaEl = document.getElementById('valorVenda');

  function parseCurrency(str){
    return parseFloat(str.replace(/[^0-9,-]+/g, '').replace('.', '').replace(',', '.')) || 0;
  }

  function formatCurrency(val){
    return val.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }

  let itens = [];
  const processos = {};
  const totals = {};

  function updateProcessTotal(proc){
    const grupo = processos[proc];
    if(!grupo) return;
    let soma = 0;
    grupo.itens.forEach(it => { if(it.status !== 'deleted') soma += it.quantidade * it.preco_unitario; });
    grupo.totalEl.textContent = formatCurrency(soma);
  }

  function updateTotals(){
    let totalInsumos = 0;
    itens.forEach(it => {
      if(it.status !== 'deleted') totalInsumos += it.quantidade * it.preco_unitario;
    });

    const pctFab = parseFloat(fabricacaoInput.value) || 0;
    const pctAcab = parseFloat(acabamentoInput.value) || 0;
    const pctMont = parseFloat(montagemInput.value) || 0;
    const pctEmb = parseFloat(embalagemInput.value) || 0;
    const pctMarkup = parseFloat(markupInput.value) || 0;
    const pctComissao = parseFloat(commissionInput.value) || 0;
    const pctImposto = parseFloat(taxInput.value) || 0;

    const totalMaoObra = totalInsumos * (pctFab + pctAcab + pctMont + pctEmb) / 100;
    const subTotal = totalInsumos + totalMaoObra;
    const markupVal = totalInsumos * (pctMarkup / 100);
    const custoTotal = subTotal + markupVal;
    const denom = 1 - (pctImposto + pctComissao) / 100;
    const comissaoVal = denom ? (pctComissao / 100) * (custoTotal / denom) : 0;
    const impostoVal = denom ? (pctImposto / 100) * (custoTotal / denom) : 0;
    const valorVenda = custoTotal + comissaoVal + impostoVal;

    totals.totalInsumos = totalInsumos;
    totals.valorVenda = valorVenda;

    totalInsumosEl.textContent = formatCurrency(totalInsumos);
    totalMaoObraEl.textContent = formatCurrency(totalMaoObra);
    subTotalEl.textContent = formatCurrency(subTotal);
    markupValorEl.textContent = formatCurrency(markupVal);
    custoTotalEl.textContent = formatCurrency(custoTotal);
    comissaoValorEl.textContent = formatCurrency(comissaoVal);
    impostoValorEl.textContent = formatCurrency(impostoVal);
    valorVendaEl.textContent = formatCurrency(valorVenda);
    precoVendaEl.textContent = formatCurrency(valorVenda);
  }

  function attachRowEvents(item){
    item.qtyInput.addEventListener('input', () => {
      item.quantidade = parseFloat(item.qtyInput.value) || 0;
      item.total = item.quantidade * item.preco_unitario;
      item.totalEl.textContent = formatCurrency(item.total);
      if(item.id) item.status = 'updated';
      updateProcessTotal(item.processo);
      updateTotals();
    });
    item.row.querySelector('.remove-item').addEventListener('click', () => {
      item.status = 'deleted';
      item.row.remove();
      updateProcessTotal(item.processo);
      updateTotals();
    });
  }

  function renderItens(data){
    tableBody.innerHTML = '';
    itens = data.map(d => ({ ...d, status: 'unchanged' }));
    const grupos = {};

    itens.forEach(it => {
      if(!grupos[it.processo]) grupos[it.processo] = [];
      grupos[it.processo].push(it);
    });

    Object.entries(grupos).forEach(([proc, arr]) => {
      const header = document.createElement('tr');
      header.className = 'process-row';
      header.innerHTML = `<td colspan="2" class="pt-4 pb-2 text-left text-gray-300 font-semibold">${proc}</td>`+
        `<td colspan="2" class="pt-4 pb-2 text-right text-white font-semibold process-total"></td>`;
      tableBody.appendChild(header);
      processos[proc] = { itens: arr, totalEl: header.querySelector('.process-total') };

      arr.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-white/5 item-row';
        tr.innerHTML = `
          <td class="py-3 px-2 text-white">${item.nome}</td>
          <td class="py-3 px-2 text-center"><input type="number" class="item-qty w-20 bg-input border border-inputBorder rounded text-white text-sm text-center" value="${item.quantidade}"></td>
          <td class="py-3 px-2 text-right text-white item-total">${formatCurrency(item.preco_unitario * item.quantidade)}</td>
          <td class="py-3 px-2 text-center"><button class="remove-item icon-only bg-red-600/20 text-red-400 hover:bg-red-600/30">🗑</button></td>`;
        tableBody.appendChild(tr);
        item.row = tr;
        item.qtyInput = tr.querySelector('.item-qty');
        item.totalEl = tr.querySelector('.item-total');
        attachRowEvents(item);
      });

      updateProcessTotal(proc);
    });
    updateTotals();
  }

  [fabricacaoInput, acabamentoInput, montagemInput, embalagemInput, markupInput, commissionInput, taxInput].forEach(inp => {
    inp.addEventListener('input', updateTotals);
  });

  document.getElementById('limparTudo').addEventListener('click', () => {
    itens = [];
    tableBody.innerHTML = '';
    updateTotals();
  });

  document.getElementById('salvarEditarProduto').addEventListener('click', async () => {
    const produto = {
      pct_fabricacao: parseFloat(fabricacaoInput.value) || 0,
      pct_acabamento: parseFloat(acabamentoInput.value) || 0,
      pct_montagem: parseFloat(montagemInput.value) || 0,
      pct_embalagem: parseFloat(embalagemInput.value) || 0,
      pct_markup: parseFloat(markupInput.value) || 0,
      pct_comissao: parseFloat(commissionInput.value) || 0,
      pct_imposto: parseFloat(taxInput.value) || 0,
      preco_base: totals.totalInsumos || 0,
      preco_venda: totals.valorVenda || 0
    };
    const itensPayload = {
      inseridos: [],
      atualizados: itens.filter(i => i.status === 'updated').map(i => ({ id: i.id, quantidade: i.quantidade })),
      deletados: itens.filter(i => i.status === 'deleted').map(i => ({ id: i.id }))
    };
    try{
      await window.electronAPI.salvarProdutoDetalhado(produtoSelecionado.codigo, produto, itensPayload);
      if(typeof carregarProdutos === 'function') await carregarProdutos();
      close();
    }catch(err){
      console.error('Erro ao salvar produto', err);
    }
  });

  const produto = window.produtoSelecionado;
  (async () => {
    try{
      const dados = await window.electronAPI.obterProduto(produto.id);
      if(dados){
        if(dados.nome) nomeInput.value = dados.nome;
        if(dados.codigo) codigoInput.value = dados.codigo;
        if(dados.ncm != null) ncmInput.value = String(dados.ncm);
        if(dados.preco_venda != null) precoVendaEl.textContent = formatCurrency(dados.preco_venda);
        const mod = dados.ultima_modificacao || dados.updated_at;
        if(mod){
          const d = new Date(mod);
          ultimaDataEl.textContent = d.toLocaleDateString('pt-BR');
          ultimaHoraEl.textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }
        if(dados.pct_fabricacao != null) fabricacaoInput.value = dados.pct_fabricacao;
        if(dados.pct_acabamento != null) acabamentoInput.value = dados.pct_acabamento;
        if(dados.pct_montagem != null) montagemInput.value = dados.pct_montagem;
        if(dados.pct_embalagem != null) embalagemInput.value = dados.pct_embalagem;
        if(dados.pct_markup != null) markupInput.value = dados.pct_markup;
        if(dados.pct_comissao != null) commissionInput.value = dados.pct_comissao;
        if(dados.pct_imposto != null) taxInput.value = dados.pct_imposto;
      }
      const etapas = await window.electronAPI.listarEtapasProducao();
      etapaSelect.innerHTML = etapas.map(e => `<option value="${e.id}">${e.nome}</option>`).join('');
      const itens = await window.electronAPI.listarInsumosProduto(produto.codigo);
      renderItens(itens);
      updateTotals();
    } catch(err){
      console.error('Erro ao carregar dados do produto', err);
    }
  })();

})();

