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
  const fabricacaoInput = document.getElementById('fabricacaoInput');
  const acabamentoInput = document.getElementById('acabamentoInput');
  const montagemInput   = document.getElementById('montagemInput');
  const embalagemInput  = document.getElementById('embalagemInput');
  const markupInput     = document.getElementById('markupInput');
  const commissionInput = document.getElementById('commissionInput');
  const taxInput        = document.getElementById('taxInput');

  const precoVendaEl    = document.getElementById('precoVenda');
  const totalInsumosEl  = document.getElementById('totalInsumos');
  const totalMaoObraEl  = document.getElementById('totalMaoObra');
  const subTotalEl      = document.getElementById('subTotal');
  const markupValorEl   = document.getElementById('markupValor');
  const custoTotalEl    = document.getElementById('custoTotal');
  const comissaoValorEl = document.getElementById('comissaoValor');
  const impostoValorEl  = document.getElementById('impostoValor');

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
  }

  [fabricacaoInput, acabamentoInput, montagemInput, embalagemInput, markupInput, commissionInput, taxInput]
    .filter(Boolean)
    .forEach(inp => inp.addEventListener('input', updateTotals));

  // ------- Ações -------
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
      const nome = nomeInput?.value.trim();
      const codigo = codigoInput?.value.trim();
      const ncm = ncmInput?.value.trim().slice(0,8);
      if(!nome || !codigo){
        showToast('Nome e código são obrigatórios', 'error');
        return;
      }
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
          preco_venda: totals.valorVenda || 0,
          pct_markup: parseFloat(markupInput?.value) || 0,
          status: 'ativo'
        });

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
          categoria: nome.split(' ')[0] || '',
          status: 'ativo'
        }, { inseridos: [], atualizados: [], deletados: [] });

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
