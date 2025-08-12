(function(){
  const overlay = document.getElementById('editarProdutoOverlay');
  const close = () => Modal.close('editarProduto');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
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
  const editarRegistroToggle = document.getElementById('editarRegistroToggle');

  const nomeInput = document.getElementById('nomeInput');
  const codigoInput = document.getElementById('codigoInput');
  const ncmInput = document.getElementById('ncmInput');
  const precoVendaEl = document.getElementById('precoVenda');
  const ultimaDataEl = document.getElementById('ultimaModificacaoData');
  const ultimaHoraEl = document.getElementById('ultimaModificacaoHora');

  const totalInsumosEl = document.getElementById('totalInsumos');
  const totalInsumosTituloEl = document.getElementById('totalInsumosTitulo');
  const totalMaoObraEl = document.getElementById('totalMaoObra');
  const subTotalEl = document.getElementById('subTotal');
  const markupValorEl = document.getElementById('markupValor');
  const custoTotalEl = document.getElementById('custoTotal');
  const comissaoValorEl = document.getElementById('comissaoValor');
  const impostoValorEl = document.getElementById('impostoValor');
  const valorVendaEl = document.getElementById('valorVenda');
  let registroOriginal = {};

  // toggle on/off
  function updateRegistroEditState(){
    const editable = editarRegistroToggle.checked;
    [nomeInput, codigoInput, ncmInput].forEach(el => el.disabled = !editable);
    if(!editable){
      nomeInput.value = registroOriginal.nome;
      codigoInput.value = registroOriginal.codigo;
      ncmInput.value = registroOriginal.ncm;
    }
  }
  editarRegistroToggle.addEventListener('change', updateRegistroEditState);
  updateRegistroEditState();

  function parseCurrency(str){
    return parseFloat(str.replace(/[^0-9,-]+/g, '').replace('.', '').replace(',', '.')) || 0;
  }

  // formatação numérica
  function formatCurrency(val){
    const frac = Number.isInteger(val) ? 0 : 2;
    return val.toLocaleString('pt-BR', { style:'currency', currency:'BRL', minimumFractionDigits: frac, maximumFractionDigits: frac });
  }
  function formatNumber(val){
    return Number.isInteger(val) ? String(val) : val.toFixed(2);
  }

  let itens = [];
  const processos = {};
  const totals = {};

  // cálculo dos processos
  function updateProcessTotal(proc){
    const grupo = processos[proc];
    if(!grupo) return;
    let soma = 0;
    grupo.itens.forEach(it => { if(it.status !== 'deleted') soma += it.quantidade * it.preco_unitario; });
    grupo.totalEl.textContent = formatCurrency(soma);
  }

  // cálculo dos totais
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
    totalInsumosTituloEl.textContent = formatCurrency(totalInsumos);
    totalMaoObraEl.textContent = formatCurrency(totalMaoObra);
    subTotalEl.textContent = formatCurrency(subTotal);
    markupValorEl.textContent = formatCurrency(markupVal);
    custoTotalEl.textContent = formatCurrency(custoTotal);
    comissaoValorEl.textContent = formatCurrency(comissaoVal);
    impostoValorEl.textContent = formatCurrency(impostoVal);
    valorVendaEl.textContent = formatCurrency(valorVenda);
    precoVendaEl.textContent = formatCurrency(valorVenda);
  }

  // ações com confirmação
  function renderActionButtons(item){
    const actionCell = item.row.querySelector('.action-cell');
    actionCell.innerHTML = `
      <div class="flex items-center justify-center space-x-2">
        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 edit-item" style="color: var(--color-primary)" title="Editar"></i>
        <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white delete-item" style="color: var(--color-red)" title="Excluir"></i>
      </div>`;
    actionCell.querySelector('.edit-item').addEventListener('click', () => startEdit(item));
    actionCell.querySelector('.delete-item').addEventListener('click', () => startDelete(item));
  }

  function startEdit(item){
    const cell = item.row.querySelector('.quantidade-cell');
    const original = item.quantidade;
    cell.innerHTML = `
      <div class="flex items-center justify-center space-x-1">
        <input type="number" step="0.01" class="w-20 bg-input border border-inputBorder rounded text-white text-sm text-center" value="${item.quantidade}">
        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded text-green-400 confirm-edit"></i>
        <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded text-red-400 cancel-edit"></i>
      </div>`;
    const input = cell.querySelector('input');
    cell.querySelector('.confirm-edit').addEventListener('click', () => {
      item.quantidade = parseFloat(input.value) || 0;
      item.total = item.quantidade * item.preco_unitario;
      cell.innerHTML = `<span class="quantidade-text">${formatNumber(item.quantidade)}</span>`;
      item.totalEl.textContent = formatCurrency(item.total);
      if(item.id) item.status = 'updated';
      renderActionButtons(item);
      updateProcessTotal(item.processo);
      updateTotals();
    });
    cell.querySelector('.cancel-edit').addEventListener('click', () => {
      cell.innerHTML = `<span class="quantidade-text">${formatNumber(original)}</span>`;
      renderActionButtons(item);
    });
  }

  function startDelete(item){
    const actionCell = item.row.querySelector('.action-cell');
    actionCell.innerHTML = `
      <div class="flex items-center justify-center space-x-2">
        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded text-green-400 confirm-del"></i>
        <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded text-red-400 cancel-del"></i>
      </div>`;
    actionCell.querySelector('.confirm-del').addEventListener('click', () => {
      item.status = 'deleted';
      item.row.remove();
      updateProcessTotal(item.processo);
      updateTotals();
    });
    actionCell.querySelector('.cancel-del').addEventListener('click', () => {
      renderActionButtons(item);
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
      header.innerHTML = `<td colspan="4" class="pt-4 pb-2 border-t border-white/10">
        <div class="flex items-center justify-center space-x-2 text-gray-300 font-semibold">
          <span>${proc}</span>
          <span class="process-total text-white font-semibold"></span>
        </div></td>`;
      tableBody.appendChild(header);
      processos[proc] = { itens: arr, totalEl: header.querySelector('.process-total') };

      arr.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-white/5 item-row';
        tr.innerHTML = `
          <td class="py-3 px-2 text-white">${item.nome}</td>
          <td class="py-3 px-2 text-center quantidade-cell"><span class="quantidade-text">${formatNumber(item.quantidade)}</span></td>
          <td class="py-3 px-2 text-right text-white item-total">${formatCurrency(item.preco_unitario * item.quantidade)}</td>
          <td class="py-3 px-2 text-center action-cell"></td>`;
        tableBody.appendChild(tr);
        item.row = tr;
        item.totalEl = tr.querySelector('.item-total');
        renderActionButtons(item);
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
    // cálculo e salvamento
    const produto = {
      pct_fabricacao: parseFloat(fabricacaoInput.value) || 0,
      pct_acabamento: parseFloat(acabamentoInput.value) || 0,
      pct_montagem: parseFloat(montagemInput.value) || 0,
      pct_embalagem: parseFloat(embalagemInput.value) || 0,
      pct_markup: parseFloat(markupInput.value) || 0,
      pct_comissao: parseFloat(commissionInput.value) || 0,
      pct_imposto: parseFloat(taxInput.value) || 0,
      preco_base: totals.totalInsumos || 0,
      preco_venda: totals.valorVenda || 0,
      data: new Date().toISOString()
    };
    if(editarRegistroToggle.checked){
      produto.nome = nomeInput.value;
      produto.codigo = codigoInput.value;
      produto.ncm = ncmInput.value;
    }
    const itensPayload = {
      inseridos: [],
      atualizados: itens.filter(i => i.status === 'updated').map(i => ({ id: i.id, quantidade: i.quantidade })),
      deletados: itens.filter(i => i.status === 'deleted').map(i => ({ id: i.id }))
    };
    try{
      await window.electronAPI.salvarProdutoDetalhado(produtoSelecionado.codigo, produto, itensPayload);
      const now = new Date();
      ultimaDataEl.textContent = now.toLocaleDateString('pt-BR');
      ultimaHoraEl.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      registroOriginal = { nome: nomeInput.value, codigo: codigoInput.value, ncm: ncmInput.value };
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
        const mod = dados.data || dados.ultima_modificacao || dados.updated_at;
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
        registroOriginal = {
          nome: nomeInput.value,
          codigo: codigoInput.value,
          ncm: ncmInput.value
        };
        updateRegistroEditState();
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

