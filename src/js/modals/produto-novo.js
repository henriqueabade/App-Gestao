// Modal de novo produto
(function(){
  const overlay = document.getElementById('novoProdutoOverlay');
  const close = () => Modal.close('novoProduto');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  document.getElementById('voltarNovoProduto').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });

  // ------- Campos -------
  const nomeInput       = document.getElementById('nomeInput');
  const codigoInput     = document.getElementById('codigoInput');
  const ncmInput        = document.getElementById('ncmInput');
  const colecaoSelect   = document.getElementById('colecaoSelect');
  const fabricacaoInput = document.getElementById('fabricacaoInput');
  const acabamentoInput = document.getElementById('acabamentoInput');
  const montagemInput   = document.getElementById('montagemInput');
  const embalagemInput  = document.getElementById('embalagemInput');
  const markupInput     = document.getElementById('markupInput');
  const commissionInput = document.getElementById('commissionInput');
  const taxInput        = document.getElementById('taxInput');
  const etapaSelect     = document.getElementById('etapaSelect');
  const comecarBtn      = document.getElementById('comecarNovoProduto');

  const precoVendaEl    = document.getElementById('precoVenda');
  const totalInsumosEl  = document.getElementById('totalInsumos');
  const totalMaoObraEl  = document.getElementById('totalMaoObra');
  const subTotalEl      = document.getElementById('subTotal');
  const markupValorEl   = document.getElementById('markupValor');
  const custoTotalEl    = document.getElementById('custoTotal');
  const comissaoValorEl = document.getElementById('comissaoValor');
  const impostoValorEl  = document.getElementById('impostoValor');
  const valorVendaEl    = document.getElementById('valorVenda');
  const totalInsumosTituloEl = document.getElementById('totalInsumosTitulo');

  const totals = { totalInsumos: 0, valorVenda: 0 };

  function formatCurrency(val){
    return (val||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }

  function updateTotals(){
    const totalInsumos = totals.totalInsumos; // itens ainda não implementados
    const pctFab  = parseFloat(fabricacaoInput?.value) || 0;
    const pctAcab = parseFloat(acabamentoInput?.value) || 0;
    const pctMont = parseFloat(montagemInput?.value) || 0;
    const pctEmb  = parseFloat(embalagemInput?.value) || 0;
    const pctMarkup  = parseFloat(markupInput?.value) || 0;
    const pctComissao= parseFloat(commissionInput?.value) || 0;
    const pctImposto = parseFloat(taxInput?.value) || 0;

    const totalMaoObra = totalInsumos * (pctFab + pctAcab + pctMont + pctEmb) / 100;
    const subTotal     = totalInsumos + totalMaoObra;
    const markupVal    = totalInsumos * (pctMarkup / 100);
    const custoTotal   = subTotal + markupVal;
    const denom        = 1 - (pctImposto + pctComissao) / 100;
    const comissaoVal  = denom ? (pctComissao / 100) * (custoTotal / denom) : 0;
    const impostoVal   = denom ? (pctImposto  / 100) * (custoTotal / denom) : 0;
    const valorVenda   = custoTotal + comissaoVal + impostoVal;

    totals.valorVenda = valorVenda;

    if(totalInsumosEl) totalInsumosEl.textContent = formatCurrency(totalInsumos);
    if(totalMaoObraEl) totalMaoObraEl.textContent = formatCurrency(totalMaoObra);
    if(subTotalEl)     subTotalEl.textContent     = formatCurrency(subTotal);
    if(markupValorEl)  markupValorEl.textContent  = formatCurrency(markupVal);
    if(custoTotalEl)   custoTotalEl.textContent   = formatCurrency(custoTotal);
    if(comissaoValorEl)comissaoValorEl.textContent= formatCurrency(comissaoVal);
    if(impostoValorEl) impostoValorEl.textContent = formatCurrency(impostoVal);
    if(precoVendaEl)   precoVendaEl.textContent   = formatCurrency(valorVenda);
    if(valorVendaEl)   valorVendaEl.textContent   = formatCurrency(valorVenda);
    renderTotalBadges();
  }

  [fabricacaoInput, acabamentoInput, montagemInput, embalagemInput, markupInput, commissionInput, taxInput]
    .filter(Boolean)
    .forEach(inp => inp.addEventListener('input', updateTotals));

  if(etapaSelect){
    window.electronAPI.listarEtapasProducao().then(procs => {
      procs.sort((a,b)=> (a.ordem ?? 0) - (b.ordem ?? 0));
      etapaSelect.innerHTML = procs.map(p => `<option value="${p.id}">${p.nome ?? p}</option>`).join('');
      etapaSelect.selectedIndex = 0;
    }).catch(err => console.error('Erro ao carregar processos', err));
  }

  if(colecaoSelect){
    async function carregarColecoes(){
      try{
        const colecoes = await window.electronAPI.listarColecoes();
        colecaoSelect.innerHTML = '<option value="">Selecionar Coleção</option>' +
          colecoes.map(c => `<option value="${c}">${c}</option>`).join('');
      }catch(err){
        console.error('Erro ao carregar coleções', err);
      }
    }
    carregarColecoes();
    document.getElementById('addColecaoNovo')?.addEventListener('click', () => {
      Modal.open('modals/produtos/colecao-novo.html', '../js/modals/produto-colecao-novo.js', 'novaColecao', true);
    });
    document.getElementById('delColecaoNovo')?.addEventListener('click', () => {
      Modal.open('modals/produtos/colecao-excluir.html', '../js/modals/produto-colecao-excluir.js', 'excluirColecao', true);
    });
  }

  const tableBody = document.querySelector('#itensTabela tbody');
  let itens = [];

  function formatNumber(val){
    const n = parseFloat(val) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  function renderActionButtons(item){
    const cell = item.row.querySelector('.action-cell');
    cell.innerHTML = `
      <div class="flex items-center justify-center space-x-2">
        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 edit-item" style="color: var(--color-primary)" title="Editar"></i>
        <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white delete-item" style="color: var(--color-red)" title="Excluir"></i>
      </div>`;
    cell.querySelector('.edit-item').addEventListener('click', () => startEdit(item));
    cell.querySelector('.delete-item').addEventListener('click', () => startDelete(item));
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
      renderItens();
    });
    cell.querySelector('.cancel-edit').addEventListener('click', () => {
      item.quantidade = original;
      renderItens();
    });
  }

  function startDelete(item){
    const cell = item.row.querySelector('.action-cell');
    cell.innerHTML = `
      <div class="flex items-center justify-center space-x-2">
        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded text-green-400 confirm-delete"></i>
        <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded text-red-400 cancel-delete"></i>
      </div>`;
    cell.querySelector('.confirm-delete').addEventListener('click', () => {
      itens = itens.filter(i => i !== item);
      renderItens();
    });
    cell.querySelector('.cancel-delete').addEventListener('click', () => {
      renderItens();
    });
  }

  function renderItens(){
    if(!tableBody) return;
    tableBody.innerHTML = '';
    const grupos = {};
    itens.forEach(it => {
      const proc = it.processo || '—';
      if(!grupos[proc]) grupos[proc] = [];
      grupos[proc].push(it);
    });
    Object.entries(grupos).forEach(([proc, arr]) => {
      const header = document.createElement('tr');
      header.className = 'process-row';
      header.innerHTML = `<td colspan="6" class="px-6 py-2 bg-gray-50 border-t border-gray-200 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">${proc}</td>`;
      tableBody.appendChild(header);
      arr.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-white/10';
        tr.innerHTML = `
          <td class="py-3 px-2 text-white">${item.nome}</td>
          <td class="py-3 px-2 text-center quantidade-cell"><span class="quantidade-text">${formatNumber(item.quantidade)}</span></td>
          <td class="py-3 px-2 text-center">${item.unidade || ''}</td>
          <td class="py-3 px-2 text-right text-white">${formatCurrency(item.preco_unitario)}</td>
          <td class="py-3 px-2 text-right text-white item-total">${formatCurrency(item.quantidade * item.preco_unitario)}</td>
          <td class="py-3 px-2 text-center action-cell"></td>`;
        tableBody.appendChild(tr);
        item.row = tr;
        item.totalEl = tr.querySelector('.item-total');
        renderActionButtons(item);
      });
    });
    atualizaTotal();
  }

  function atualizaTotal(){
    totals.totalInsumos = itens.reduce((s,it)=> s + (it.quantidade * it.preco_unitario),0);
    updateTotals();
  }

  window.produtoNovoAPI = {
    obterItens: () => itens.slice(),
    somarItem(id, quantidade){
      const it = itens.find(i => String(i.insumo_id ?? i.id) === String(id));
      if(it){
        it.quantidade += quantidade;
        renderItens();
      }
    },
    substituirItem(novo){
      const it = itens.find(i => String(i.insumo_id ?? i.id) === String(novo.id));
      if(it){
        it.quantidade = novo.quantidade;
        it.preco_unitario = novo.preco_unitario;
        it.processo = novo.processo;
        renderItens();
      }
    },
    adicionarProcessoItens(novos){
      novos.forEach(n => {
        const exists = itens.some(it => String(it.nome).trim().toLowerCase() === String(n.nome).trim().toLowerCase());
        if(exists){
          if(typeof showToast === 'function') showToast('Item já adicionado', 'error');
        } else {
          itens.push(n);
        }
      });
      renderItens();
    }
  };

  function renderTotalBadges(){
    if(!totalInsumosTituloEl) return;
    const processos = {};
    itens.forEach(it => {
      const proc = (it.processo || '').trim();
      if(!proc) return;
      processos[proc] = (processos[proc] || 0) + (it.quantidade * it.preco_unitario);
    });
    const parts = Object.keys(processos).map(p => `<span class="badge-process px-3 py-1 rounded-full text-xs font-medium">${p}: ${formatCurrency(processos[p] || 0)}</span>`);
    parts.push(`<span class="badge-success px-3 py-1 rounded-full text-xs font-medium">Valor Total: ${formatCurrency(totals.totalInsumos || 0)}</span>`);
    totalInsumosTituloEl.innerHTML = parts.join(' ');
  }

  // ------- Ações -------
  if(comecarBtn){
    comecarBtn.addEventListener('click', () => {
      if(etapaSelect){
        const opt = etapaSelect.options[etapaSelect.selectedIndex];
        window.proximaEtapaTitulo = opt ? opt.textContent : '';
      }
      overlay.classList.add('pointer-events-none','blur-sm');
      Modal.open('modals/produtos/proxima-etapa.html', '../js/modals/produto-proxima-etapa-novo.js', 'proximaEtapa', true);
    });
  }
  const limparBtn = document.getElementById('limparNovoProduto');
  if(limparBtn){
    limparBtn.addEventListener('click', () => {
      overlay.querySelectorAll('input').forEach(i => { if(i.type==='number') i.value='0'; else i.value=''; });
      overlay.querySelectorAll('select').forEach(s => s.selectedIndex = 0);
      updateTotals();
    });
  }

  const registrarBtn = document.getElementById('registrarNovoProduto');
  if(registrarBtn){
    registrarBtn.addEventListener('click', async () => {
      const campos = [
        { el: nomeInput, nome: 'Nome' },
        { el: codigoInput, nome: 'Código' },
        { el: ncmInput, nome: 'NCM' },
        { el: colecaoSelect, nome: 'Coleção' },
        { el: fabricacaoInput, nome: 'Marcenaria' },
        { el: acabamentoInput, nome: 'Acabamento' },
        { el: montagemInput, nome: 'Montagem' },
        { el: embalagemInput, nome: 'Embalagem' },
        { el: markupInput, nome: 'Markup' },
        { el: commissionInput, nome: 'Comissão' },
        { el: taxInput, nome: 'Imposto' }
      ];
      for(const campo of campos){
        if(campo.el && String(campo.el.value).trim() === ''){
          showToast(`${campo.nome} é obrigatório`, 'error');
          campo.el.focus();
          return;
        }
      }
      const nome = nomeInput.value.trim();
      const codigo = codigoInput.value.trim();
      const ncm = ncmInput.value.trim().slice(0,8);
      try{
        const existentes = await window.electronAPI.listarProdutos();
        if(existentes.some(p => p.codigo === codigo)){
          showToast('Código já existe', 'error');
          return;
        }
        if(existentes.some(p => p.nome === nome)){
          showToast('Nome já existe', 'error');
          return;
        }

        await window.electronAPI.adicionarProduto({
          codigo,
          nome,
          categoria: colecaoSelect.value.trim(),
          preco_venda: totals.valorVenda || 0,
          pct_markup: parseFloat(markupInput?.value) || 0,
          status: 'Em linha'
        });

        const itensPayload = itens.map(i => ({
          insumo_id: i.insumo_id ?? i.id,
          quantidade: i.quantidade
        }));

        await window.electronAPI.salvarProdutoDetalhado(codigo, {
          pct_fabricacao: parseFloat(fabricacaoInput?.value) || 0,
          pct_acabamento: parseFloat(acabamentoInput?.value) || 0,
          pct_montagem:   parseFloat(montagemInput?.value) || 0,
          pct_embalagem:  parseFloat(embalagemInput?.value) || 0,
          pct_markup:     parseFloat(markupInput?.value) || 0,
          pct_comissao:   parseFloat(commissionInput?.value) || 0,
          pct_imposto:    parseFloat(taxInput?.value) || 0,
          preco_base:     totals.totalInsumos || 0,
          preco_venda:    totals.valorVenda || 0,
          nome,
          codigo,
          ncm,
          categoria: colecaoSelect.value.trim(),
          status: 'Em linha'
        }, { inseridos: itensPayload, atualizados: [], deletados: [] });

        showToast('Peça criada com sucesso!', 'success');
        close();
        if(typeof carregarProdutos === 'function') await carregarProdutos();
      }catch(err){
        console.error('Erro ao criar produto', err);
        if(err?.code === 'CODIGO_EXISTE'){
          showToast('Código já existe', 'error');
        }else if(err?.code === 'NOME_EXISTE'){
          showToast('Nome já existe', 'error');
        }else{
          const msg = err?.message || 'Erro ao criar peça';
          showToast(msg, 'error');
        }
      }
    });
  }

  const dataHoraEl = document.getElementById('dataHoraProduto');
  if(dataHoraEl){
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    dataHoraEl.textContent = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  updateTotals();
})();
