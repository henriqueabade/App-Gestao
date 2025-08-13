// === DEBUG GLOBAL: captura erros do renderer e util pra inspecionar DOM ===
(function attachGlobalDebug() {
  if (window.__DEBUG_EDITAR_PROD__) return; // evita duplicar
  window.__DEBUG_EDITAR_PROD__ = true;

  window.addEventListener('error', (e) => {
    console.error('[editar-produto][onerror]', e.message, {
      filename: e.filename, lineno: e.lineno, colno: e.colno, error: e.error
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('[editar-produto][unhandledrejection]', e.reason);
  });

  window.__domPath = function(el){
    if (!el) return '<null>';
    const path = [];
    while (el && el.nodeType === 1) {
      let s = el.nodeName.toLowerCase();
      if (el.id) s += '#' + el.id;
      if (el.className) s += '.' + String(el.className).trim().replace(/\s+/g,'.');
      path.unshift(s);
      el = el.parentElement;
    }
    return path.join(' > ');
  };
})();

(function(){
  function init(){
    const log = (...a) => console.debug('[editar-produto]', ...a);

    // Resolve o tbody da tabela de itens com fallback em cascata
    function resolveItensTbody() {
      return (
        document.querySelector('#itensTabela tbody') ||
        document.querySelector('[data-role="itens-tbody"]') ||
        document.querySelector('table[data-block="itens"] tbody') ||
        null
      );
    }

    // ------- Overlay / Botões básicos -------
    const overlay = document.getElementById('editarProdutoOverlay');
    if(!overlay) {
      console.error('[editar-produto] overlay #editarProdutoOverlay não encontrado');
      return;
    }
    const close = () => Modal.close('editarProduto');
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    const voltarBtn = document.getElementById('voltarEditarProduto');
    if (voltarBtn) voltarBtn.addEventListener('click', close);

    // ------- Campos e referências -------
    let tableBody = resolveItensTbody();
    log('tbody encontrado?', !!tableBody, tableBody ? window.__domPath(tableBody) : '—');

    const fabricacaoInput = document.getElementById('fabricacaoInput');
    const acabamentoInput = document.getElementById('acabamentoInput');
    const montagemInput = document.getElementById('montagemInput');
    const embalagemInput = document.getElementById('embalagemInput');
    const markupInput = document.getElementById('markupInput');
    const commissionInput = document.getElementById('commissionInput');
    const taxInput = document.getElementById('taxInput');
    const etapaSelect = document.getElementById('etapaSelect');
    const editarRegistroToggle = document.getElementById('editarRegistroToggle');
    const comecarBtn = document.getElementById('comecarEditarProduto');

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

    // ------- Helpers -------
    function showError(msg){
      // tenta resolver de novo (caso HTML tenha sido injetado depois)
      if (!tableBody) tableBody = resolveItensTbody();
      if (!tableBody) {
        // fallback para mostrar mensagem no corpo do modal
        const host = document.getElementById('editarProdutoBody') || overlay;
        const holder = document.createElement('div');
        holder.className = 'py-4 text-center text-red-400';
        holder.textContent = msg;
        host.appendChild(holder);
        console.error('[editar-produto] Sem tbody para renderizar erro:', msg);
        return;
      }
      tableBody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-red-400">${msg}</td></tr>`;
    }

    const produtoSelecionado = window.produtoSelecionado;
    if(!produtoSelecionado || !produtoSelecionado.codigo){
      showError('Produto não selecionado');
      return;
    }

    // Abre etapa seguinte sobrepondo o modal atual
    if (comecarBtn) {
      comecarBtn.addEventListener('click', () => {
        overlay.classList.add('pointer-events-none', 'blur-sm');
        Modal.open('modals/produtos/proxima-etapa.html', '../js/modals/produto-proxima-etapa.js', 'proximaEtapa', true);
      });
    }

    let registroOriginal = {};

    function updateRegistroEditState(){
      const editable = editarRegistroToggle && editarRegistroToggle.checked;
      [nomeInput, codigoInput, ncmInput].forEach(el => { if (el) el.disabled = !editable; });
      if(!editable){
        if (nomeInput)   nomeInput.value   = registroOriginal.nome;
        if (codigoInput) codigoInput.value = registroOriginal.codigo;
        if (ncmInput)    ncmInput.value    = registroOriginal.ncm;
      }
    }
    if (editarRegistroToggle) {
      editarRegistroToggle.addEventListener('change', updateRegistroEditState);
    }

    function formatCurrency(val){
      const frac = Number.isInteger(val) ? 0 : 2;
      return (val || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL', minimumFractionDigits: frac, maximumFractionDigits: frac });
    }
    function formatNumber(val){
      const num = parseFloat(val) || 0;
      if (Number.isInteger(num)) return String(num);
      return (Math.ceil(num * 100) / 100).toFixed(2);
    }

    let itens = [];
    const processos = {};
    const totals = {};
    const processOrder = [];

    // cálculo por processo
    function updateProcessTotal(proc){
      const grupo = processos[proc];
      if(!grupo) return;
      let soma = 0;
      grupo.itens.forEach(it => { if(it.status !== 'deleted') soma += (it.quantidade || 0) * (it.preco_unitario || 0); });
      grupo.total = soma;
    }

    // totais gerais
    function updateTotals(){
      let totalInsumos = 0;
      itens.forEach(it => {
        if(it.status !== 'deleted') totalInsumos += (it.quantidade || 0) * (it.preco_unitario || 0);
      });

      const pctFab     = parseFloat(fabricacaoInput && fabricacaoInput.value) || 0;
      const pctAcab    = parseFloat(acabamentoInput && acabamentoInput.value) || 0;
      const pctMont    = parseFloat(montagemInput && montagemInput.value) || 0;
      const pctEmb     = parseFloat(embalagemInput && embalagemInput.value) || 0;
      const pctMarkup  = parseFloat(markupInput && markupInput.value) || 0;
      const pctComissao= parseFloat(commissionInput && commissionInput.value) || 0;
      const pctImposto = parseFloat(taxInput && taxInput.value) || 0;

      const totalMaoObra = totalInsumos * (pctFab + pctAcab + pctMont + pctEmb) / 100;
      const subTotal     = totalInsumos + totalMaoObra;
      const markupVal    = totalInsumos * (pctMarkup / 100);
      const custoTotal   = subTotal + markupVal;
      const denom        = 1 - (pctImposto + pctComissao) / 100;
      const comissaoVal  = denom ? (pctComissao / 100) * (custoTotal / denom) : 0;
      const impostoVal   = denom ? (pctImposto  / 100) * (custoTotal / denom) : 0;
      const valorVenda   = custoTotal + comissaoVal + impostoVal;

      totals.totalInsumos = totalInsumos;
      totals.valorVenda   = valorVenda;

      if (totalInsumosEl)        totalInsumosEl.textContent       = formatCurrency(totalInsumos);
      if (totalMaoObraEl)        totalMaoObraEl.textContent       = formatCurrency(totalMaoObra);
      if (subTotalEl)            subTotalEl.textContent           = formatCurrency(subTotal);
      if (markupValorEl)         markupValorEl.textContent        = formatCurrency(markupVal);
      if (custoTotalEl)          custoTotalEl.textContent         = formatCurrency(custoTotal);
      if (comissaoValorEl)       comissaoValorEl.textContent      = formatCurrency(comissaoVal);
      if (impostoValorEl)        impostoValorEl.textContent       = formatCurrency(impostoVal);
      if (valorVendaEl)          valorVendaEl.textContent         = formatCurrency(valorVenda);
      if (precoVendaEl)          precoVendaEl.textContent         = formatCurrency(valorVenda);
      renderTotalBadges();
    }

    function renderTotalBadges(){
      if (!totalInsumosTituloEl) return;
      const parts = [];
      processOrder.forEach(proc => {
        const g = processos[proc];
        if (!g) return;
        parts.push(`<span class="badge-process px-3 py-1 rounded-full text-xs font-medium">${proc}: ${formatCurrency(g.total || 0)}</span>`);
      });
      parts.push(`<span class="badge-success px-3 py-1 rounded-full text-xs font-medium">Valor Total: ${formatCurrency(totals.totalInsumos || 0)}</span>`);
      totalInsumosTituloEl.innerHTML = parts.join(' ');
    }

    // ações
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
        item.total = item.quantidade * (item.preco_unitario || 0);
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
      // garante tbody
      if (!tableBody) tableBody = resolveItensTbody();
      if (!tableBody) {
        showError('Estrutura da tabela não encontrada (itens)');
        return;
      }

      tableBody.innerHTML = '';
      Object.keys(processos).forEach(k => delete processos[k]);
      processOrder.length = 0;
      itens = (data || []).map(d => ({ ...d, status: 'unchanged' }));

      if(itens.length === 0){
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="4" class="py-4 text-center text-gray-400">Nenhum item encontrado</td>';
        tableBody.appendChild(tr);
        updateTotals();
        return;
      }

      const grupos = {};
      itens.forEach(it => {
        const procKey = it.processo || '—';
        if(!grupos[procKey]) grupos[procKey] = [];
        grupos[procKey].push(it);
      });

      Object.entries(grupos).forEach(([proc, arr]) => {
        const header = document.createElement('tr');
        header.className = 'process-row';
        header.innerHTML = `<td colspan="4" class="px-6 py-2 bg-gray-50 border-t border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">${proc}</td>`;
        tableBody.appendChild(header);
        processOrder.push(proc);
        processos[proc] = { itens: arr, total: 0 };

        arr.forEach(item => {
          const tr = document.createElement('tr');
          tr.className = 'border-b border-white/5 item-row';
          tr.innerHTML = `
            <td class="py-3 px-2 text-sm text-white">${item.nome ?? '—'}</td>
            <td class="py-3 px-2 text-sm text-center quantidade-cell"><span class="quantidade-text">${formatNumber(item.quantidade)}</span></td>
            <td class="py-3 px-2 text-sm text-right text-white item-total">${formatCurrency((item.preco_unitario || 0) * (item.quantidade || 0))}</td>
            <td class="py-3 px-2 text-sm text-center action-cell"></td>`;
          tableBody.appendChild(tr);
          item.row = tr;
          item.totalEl = tr.querySelector('.item-total');
          renderActionButtons(item);
        });

        updateProcessTotal(proc);
      });
      updateTotals();
      console.debug('[editar-produto] renderItens ok:', { grupos: Object.keys(grupos).length, total: itens.length });
    }

    // inputs que recalculam totais
    [fabricacaoInput, acabamentoInput, montagemInput, embalagemInput, markupInput, commissionInput, taxInput]
      .filter(Boolean)
      .forEach(inp => inp.addEventListener('input', updateTotals));

    const limparTudoBtn = document.getElementById('limparTudo');
    if (limparTudoBtn) {
      limparTudoBtn.addEventListener('click', () => {
        itens = [];
        if (tableBody) tableBody.innerHTML = '';
        updateTotals();
      });
    }

    const salvarBtn = document.getElementById('salvarEditarProduto');
    if (salvarBtn) {
      salvarBtn.addEventListener('click', async () => {
        const produto = {
          pct_fabricacao: parseFloat(fabricacaoInput && fabricacaoInput.value) || 0,
          pct_acabamento: parseFloat(acabamentoInput && acabamentoInput.value) || 0,
          pct_montagem:   parseFloat(montagemInput && montagemInput.value) || 0,
          pct_embalagem:  parseFloat(embalagemInput && embalagemInput.value) || 0,
          pct_markup:     parseFloat(markupInput && markupInput.value) || 0,
          pct_comissao:   parseFloat(commissionInput && commissionInput.value) || 0,
          pct_imposto:    parseFloat(taxInput && taxInput.value) || 0,
          preco_base:     totals.totalInsumos || 0,
          preco_venda:    totals.valorVenda   || 0,
          data: new Date().toISOString()
        };
        if(editarRegistroToggle && editarRegistroToggle.checked){
          if (nomeInput)   produto.nome   = nomeInput.value;
          if (codigoInput) produto.codigo = codigoInput.value;
          if (ncmInput)    produto.ncm    = ncmInput.value;
        }
        const itensPayload = {
          inseridos: [],
          atualizados: itens.filter(i => i.status === 'updated').map(i => ({ id: i.id, quantidade: i.quantidade })),
          deletados: itens.filter(i => i.status === 'deleted').map(i => ({ id: i.id }))
        };
        try{
          await window.electronAPI.salvarProdutoDetalhado(produtoSelecionado.codigo, produto, itensPayload);
          const now = new Date();
          if (ultimaDataEl) ultimaDataEl.textContent = now.toLocaleDateString('pt-BR');
          if (ultimaHoraEl) ultimaHoraEl.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          registroOriginal = {
            nome:   nomeInput ? nomeInput.value   : '',
            codigo: codigoInput ? codigoInput.value : '',
            ncm:    ncmInput ? ncmInput.value    : ''
          };
          if(typeof carregarProdutos === 'function') await carregarProdutos();
          close();
        }catch(err){
          console.error('Erro ao salvar produto', err);
        }
      });
    }

    // ------- Carga inicial com logs de diagnóstico -------
    (async () => {
      const l = (...a) => console.debug('[editar-produto][load]', ...a);

      try{
        l('produtoSelecionado', produtoSelecionado);

        l('>> listarDetalhesProduto: start');
        const payload = { produtoCodigo: produtoSelecionado.codigo, produtoId: produtoSelecionado.id };
        l('payload', payload);
        const { produto: dados, itens: itensData, lotes } = await window.electronAPI.listarDetalhesProduto(payload);
        l('<< listarDetalhesProduto: ok', {
          produtoOk: !!dados,
          itensCount: Array.isArray(itensData) ? itensData.length : 'N/A',
          lotesCount: Array.isArray(lotes) ? lotes.length : 'N/A'
        });

        // Preenche cabeçalho/percentuais
        if(dados){
          if(dados.nome && nomeInput) nomeInput.value = dados.nome;
          if(dados.codigo && codigoInput) codigoInput.value = dados.codigo;
          if(dados.ncm != null && ncmInput) ncmInput.value = String(dados.ncm);
          if(dados.preco_venda != null && precoVendaEl){
            const pv = dados.preco_venda;
            const frac = Number.isInteger(pv) ? 0 : 2;
            precoVendaEl.textContent = pv.toLocaleString('pt-BR', { style:'currency', currency:'BRL', minimumFractionDigits: frac, maximumFractionDigits: frac });
          }
          const mod = dados.data || dados.ultima_modificacao || dados.updated_at;
          if(mod){
            const d = new Date(mod);
            if (ultimaDataEl) ultimaDataEl.textContent = d.toLocaleDateString('pt-BR');
            if (ultimaHoraEl) ultimaHoraEl.textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          }
          if(fabricacaoInput && dados.pct_fabricacao != null) fabricacaoInput.value = dados.pct_fabricacao;
          if(acabamentoInput && dados.pct_acabamento != null) acabamentoInput.value = dados.pct_acabamento;
          if(montagemInput && dados.pct_montagem != null) montagemInput.value = dados.pct_montagem;
          if(embalagemInput && dados.pct_embalagem != null) embalagemInput.value = dados.pct_embalagem;
          if(markupInput && dados.pct_markup != null) markupInput.value = dados.pct_markup;
          if(commissionInput && dados.pct_comissao != null) commissionInput.value = dados.pct_comissao;
          if(taxInput && dados.pct_imposto != null) taxInput.value = dados.pct_imposto;

          registroOriginal = {
            nome:   nomeInput ? nomeInput.value   : '',
            codigo: codigoInput ? codigoInput.value : '',
            ncm:    ncmInput ? ncmInput.value    : ''
          };
          updateRegistroEditState();
        }

        // Etapas
        l('>> listarEtapasProducao: start');
        const etapas = await window.electronAPI.listarEtapasProducao();
        l('<< listarEtapasProducao: ok', { etapasCount: Array.isArray(etapas) ? etapas.length : 'N/A' });
        if (etapaSelect) {
          etapaSelect.innerHTML = (etapas || []).map(e => `<option value="${e.id}">${e.nome}</option>`).join('');
        }

        // Render itens
        l('>> renderItens: start');
        if (!Array.isArray(itensData)) {
          console.error('[editar-produto] itensData não é array:', itensData);
          showError('Erro ao carregar itens (formato inválido)');
        } else {
          // amostra para depuração
          if (itensData[0]) {
            const sample = (({ id, nome, processo, quantidade, preco_unitario }) => ({ id, nome, processo, quantidade, preco_unitario }))(itensData[0]);
            l('amostra itens[0]', sample);
          }
          if (typeof renderItens === 'function') {
            renderItens(itensData);
          } else {
            // render mínimo caso função não exista
            if (!tableBody) tableBody = resolveItensTbody();
            if (!tableBody) {
              showError('Estrutura da tabela não encontrada (itens)');
            } else if (itensData.length === 0) {
              tableBody.innerHTML = '<tr><td colspan="4" class="py-4 text-center text-gray-400">Nenhum item encontrado</td></tr>';
            } else {
              tableBody.innerHTML = itensData.map(it => `
                <tr class="border-b border-white/5">
                  <td class="py-3 px-2 text-white">${it.nome ?? '—'}</td>
                  <td class="py-3 px-2 text-center">${(Number.isInteger(it.quantidade)? it.quantidade : (parseFloat(it.quantidade)||0).toFixed(2))}</td>
                  <td class="py-3 px-2 text-right text-white">
                    ${(((it.preco_unitario||0)*(it.quantidade||0))).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
                  </td>
                  <td class="py-3 px-2 text-center">—</td>
                </tr>
              `).join('');
            }
          }
        }
        l('<< renderItens: ok');

        // recalcula totais após primeira renderização
        updateTotals();

      } catch(err){
        console.error('[editar-produto][catch load]', err);
        const msg = err && err.message ? err.message : 'Erro ao carregar dados';
        if (!tableBody) tableBody = resolveItensTbody();
        if (tableBody) {
          tableBody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-red-400">${msg}</td></tr>`;
        }
      }
    })();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();
