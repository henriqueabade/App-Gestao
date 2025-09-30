(function(){
  const overlayId = 'converterOrcamento';
  const overlay = document.getElementById('converterOrcamentoOverlay');
  if (!overlay) return;
  const close = () => {
    try { cleanupReplaceModalIntegration?.(); }
    catch (err) { console.error(err); }
    Modal.close(overlayId);
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  let readyMarked = false;
  const markReady = (reveal = true) => {
    const deferReveal = !!window.autoOpenQuoteConversion?.deferReveal;
    const shouldReveal = reveal && !deferReveal;
    if (!overlay || !overlay.classList) {
      if (!readyMarked && typeof Modal?.signalReady === 'function') {
        readyMarked = true;
        Modal.signalReady(overlayId);
      }
      return;
    }

    if (shouldReveal) {
      if (overlay.classList.contains('hidden')) {
        overlay.classList.remove('hidden');
      }
      overlay.removeAttribute('aria-hidden');
    } else {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }

    if (!readyMarked) {
      readyMarked = true;
      overlay.dataset.modalReady = 'true';
      overlay.removeAttribute('data-modal-loading');
      if (typeof Modal?.signalReady === 'function') {
        Modal.signalReady(overlayId);
      }
    }
  };

  document.addEventListener('keydown', function esc(e){
    if (e.key === 'Escape') {
      if (isSubstituirPecaOpen()) return;
      close();
      document.removeEventListener('keydown', esc);
    }
  });

  const ctx = window.quoteConversionContext || {};
  const subtitulo = document.getElementById('converterOrcamentoSubtitulo');
  const btnCancelar = document.getElementById('voltarConverterOrcamento');
  const btnConfirmar = document.getElementById('confirmarConverterOrcamento');
  const warning = document.getElementById('converterWarning');
  const warningText = document.getElementById('converterWarningText');

  const pecasBody = document.getElementById('converterPecasBody');
  const insumosBody = document.getElementById('converterInsumosBody');
  const chipTotal = document.getElementById('chipTotalPecas');
  const chipEstoque = document.getElementById('chipEmEstoque');
  const chipProduzir = document.getElementById('chipAProduzir');
  const pecasTotal = document.getElementById('converterPecasTotal');
  const onlyMissingToggle = document.getElementById('onlyMissingToggle');
  const insumosReloadBtn = document.querySelector('button[data-action="insumos-reload"]');
  const insumosTituloPeca = document.getElementById('insumosTituloPeca');

  const TABLE_SPINNER_MIN_DURATION = 1000;
  function showTableLoading(tbody, message = 'Recalculando...') {
    if (!tbody) return () => {};
    const container = tbody.closest('.table-scroll');
    if (!container) return () => {};
    let overlay = container.querySelector('.table-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'table-loading-overlay';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.innerHTML = `
        <div class="table-loading-content">
          <span class="table-loading-spinner" aria-hidden="true"></span>
          <span class="table-loading-text"></span>
        </div>
      `;
      overlay.dataset.loadingCount = '0';
      container.appendChild(overlay);
    }
    const textEl = overlay.querySelector('.table-loading-text');
    if (textEl) textEl.textContent = message;
    const currentCount = Number(overlay.dataset.loadingCount || '0');
    overlay.dataset.loadingCount = String(currentCount + 1);
    overlay.classList.add('visible');
    tbody.setAttribute('aria-busy', 'true');
    const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      const end = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const elapsed = Math.max(0, end - start);
      const delay = Math.max(0, TABLE_SPINNER_MIN_DURATION - elapsed);
      setTimeout(() => {
        const current = Number(overlay.dataset.loadingCount || '0');
        const next = Math.max(0, current - 1);
        overlay.dataset.loadingCount = String(next);
        if (next <= 0) {
          overlay.classList.remove('visible');
          overlay.dataset.loadingCount = '0';
          tbody.removeAttribute('aria-busy');
        }
      }, delay);
    };
  }

  let listaProdutos = [];
  let rows = Array.isArray(ctx.items) ? ctx.items.map(p => ({ ...p, approved: !!p.approved })) : [];
  const state = {
    allowNegativeStock: false,
    insumosView: { filtroPecaId: null, mostrarSomenteFaltantes: true }
  };
  let lastStockByName = new Map();

  // Subtítulo com dados do orçamento
  const headerInfo = [
    ctx.numero ? `#${ctx.numero}` : null,
    ctx.cliente ? ctx.cliente : null,
    ctx.data_emissao ? new Date(ctx.data_emissao).toLocaleDateString('pt-BR') : null
  ].filter(Boolean).join(' • ');
  if (subtitulo) subtitulo.textContent = headerInfo;

  async function carregarProdutos() {
    try { listaProdutos = await (window.electronAPI?.listarProdutos?.() ?? []); }
    catch (err) { console.error('Erro ao listar produtos', err); listaProdutos = []; }
  }

  function buildStockBreakdownFromDetails(itens, lotes) {
    const rota = Array.isArray(itens) ? itens.slice() : [];
    const rotaSorted = rota.slice().sort((a, b) => Number(a.ordem_insumo || 0) - Number(b.ordem_insumo || 0));
    const orderById = new Map();
    rotaSorted.forEach(item => {
      const insumoId = Number(item.insumo_id);
      if (Number.isFinite(insumoId)) {
        orderById.set(insumoId, Number(item.ordem_insumo || 0));
      }
    });
    const maxOrder = rotaSorted.length ? Math.max(...rotaSorted.map(i => Number(i.ordem_insumo || 0))) : 0;
    const lastStep = rotaSorted.find(i => Number(i.ordem_insumo || 0) === maxOrder) || null;
    const breakdownMap = new Map();

    (Array.isArray(lotes) ? lotes : []).forEach(lote => {
      const qty = Number(lote.quantidade || 0);
      if (!(qty > 0)) return;
      const insumoId = Number(lote.ultimo_insumo_id);
      const mappedOrder = orderById.get(insumoId);
      let order = Number.isFinite(mappedOrder) ? Number(mappedOrder) : (maxOrder > 0 ? maxOrder + 1 : 1);
      const processName = lote.etapa || '';
      const lastItemName = lote.ultimo_item || '';
      const key = `${order}::${Number.isFinite(insumoId) ? insumoId : 'final'}::${processName}`;
      const entry = breakdownMap.get(key) || {
        order,
        available: 0,
        lastInsumoId: Number.isFinite(insumoId) ? insumoId : null,
        lastItemName,
        processName,
        isFinal: maxOrder > 0 ? order >= maxOrder : false
      };
      entry.available += qty;
      if (!entry.lastItemName && lastItemName) entry.lastItemName = lastItemName;
      if (!entry.processName && processName) entry.processName = processName;
      if (maxOrder > 0 && order >= maxOrder) entry.isFinal = true;
      breakdownMap.set(key, entry);
    });

    return Array.from(breakdownMap.values())
      .sort((a, b) => {
        if (a.order === b.order) return (b.available || 0) - (a.available || 0);
        return (b.order || 0) - (a.order || 0);
      })
      .map((entry, index) => {
        const fallbackName = entry.isFinal && lastStep ? (lastStep.nome || 'Peça finalizada') : 'Sem último insumo';
        const fallbackProcess = entry.isFinal && lastStep ? (lastStep.processo || 'Finalização') : '';
        return {
          key: `${entry.order}-${entry.lastInsumoId ?? 'final'}-${index}`,
          order: entry.order || 0,
          available: Math.max(0, Number(entry.available || 0)),
          lastItemName: entry.lastItemName || fallbackName,
          processName: entry.processName || fallbackProcess,
          isFinal: !!entry.isFinal
        };
      });
  }

  const substituirPecaOverlayId = 'substituirPeca';
  const substituirPecaEvent = 'pecas:substituidas';

  const clonePlan = plan => {
    if (!plan) return null;
    try { return JSON.parse(JSON.stringify(plan)); }
    catch (err) { console.error('Erro ao clonar plano de substituição', err); return null; }
  };

  const sanitizeQty = value => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0;
  };

  const buildBreakdownFromPlan = stockList => {
    if (!Array.isArray(stockList)) return [];
    return stockList.map((entry, index) => ({
      key: `${entry?.variantKey || entry?.key || index}`,
      order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : 0,
      available: sanitizeQty(entry?.qty),
      lastItemName: entry?.lastItemName || '',
      processName: entry?.processName || '',
      isFinal: !!entry?.isFinal
    }));
  };

  const summarizeBreakdownAvailability = breakdown => {
    const initial = { total: 0, ready: 0 };
    const summary = Array.isArray(breakdown)
      ? breakdown.reduce((acc, entry) => {
        const qty = sanitizeQty(entry?.available);
        if (qty > 0) {
          acc.total += qty;
          if (entry?.isFinal) acc.ready += qty;
        }
        return acc;
      }, initial)
      : initial;
    return {
      total: summary.total,
      ready: summary.ready,
      partial: Math.max(0, summary.total - summary.ready)
    };
  };

  function applyReplacementPlanToRow(row, planOverride = null) {
    if (!row) return;
    const plan = clonePlan(planOverride || row.replacementPlan);
    if (!plan) return;

    const requiredRowQty = sanitizeQty(row.qtd || row.quantidade || 0);
    const planRequiredQty = sanitizeQty(plan.requiredQty);
    const requiredQty = requiredRowQty > 0 ? requiredRowQty : planRequiredQty;

    const normalizedStock = Array.isArray(plan.stock) ? plan.stock.map((entry, index) => ({
      variantKey: entry?.variantKey || entry?.key || `stock-${index}`,
      qty: sanitizeQty(entry?.qty),
      productId: Number.isFinite(Number(entry?.productId)) ? Number(entry.productId) : null,
      productName: entry?.productName || entry?.product_name || '',
      productCode: entry?.productCode || entry?.product_code || '',
      processName: entry?.processName || '',
      lastItemName: entry?.lastItemName || '',
      order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : 0,
      isFinal: !!entry?.isFinal,
      isCurrentProduct: !!entry?.isCurrentProduct
    })) : [];

    const totalStock = normalizedStock.reduce((acc, item) => acc + sanitizeQty(item.qty), 0);
    const readyStock = normalizedStock
      .filter(item => item.isFinal)
      .reduce((acc, item) => acc + sanitizeQty(item.qty), 0);
    const partialStock = Math.max(0, totalStock - readyStock);
    const produceQty = sanitizeQty(plan.produceQty);
    const totalSelected = totalStock + produceQty;
    const remaining = Math.max(0, requiredQty - totalSelected);

    plan.stock = normalizedStock;
    plan.requiredQty = requiredQty;
    plan.totalSelected = totalSelected;
    plan.remaining = remaining;
    plan.produceQty = produceQty;

    if (plan && typeof plan === 'object' && 'selections' in plan) {
      delete plan.selections;
    }

    row.replacementPlan = plan;
    row.stockBreakdown = buildBreakdownFromPlan(normalizedStock);
    row.em_estoque = totalStock;
    row.pronta = readyStock;
    row.produzir_parcial = partialStock;
    row.produzir_total = produceQty + remaining;
    row.a_produzir = row.produzir_parcial + row.produzir_total;
    row.selectedStockSummary = {
      total: totalStock,
      ready: readyStock,
      partial: partialStock
    };
  }

  function isSubstituirPecaOpen() {
    const overlayEl = document.getElementById('substituirPecaOverlay');
    return overlayEl && !overlayEl.classList.contains('hidden');
  }

  async function openReplaceModal(index) {
    if (typeof index !== 'number' || index < 0) return;
    const row = rows[index];
    if (!row) return;
    await (listaProdutos.length ? Promise.resolve() : carregarProdutos());
    window.substituirPecaContext = {
      quote: { numero: ctx.numero, cliente: ctx.cliente },
      rowIndex: index,
      row: JSON.parse(JSON.stringify(row)),
      productList: Array.isArray(listaProdutos) ? listaProdutos.slice() : []
    };
    try {
      await Modal.open('modals/orcamentos/substituir-peca.html', '../js/modals/orcamento-substituir-peca.js', substituirPecaOverlayId, true);
    } catch (err) {
      console.error('Erro ao abrir modal de substituição', err);
    }
  }

  function recomputeStocks() {
    let totalOrc = 0, totalEst = 0, totalProd = 0, validas = 0;
    rows.forEach(r => {
      r.qtd = Number(r.qtd || r.quantidade || 0);
      r.em_estoque = Number(r.em_estoque || 0);
      r.a_produzir = Number(r.a_produzir || 0);
      r.error = !r.nome || isNaN(r.qtd) || r.qtd <= 0;
      totalOrc += r.qtd;
      totalEst += r.em_estoque;
      totalProd += r.a_produzir;
      if (!r.error) validas++;
    });
    chipTotal.textContent = `${totalOrc} Peças Orçadas`;
    chipEstoque.textContent = `${totalEst} Em Estoque`;
    chipProduzir.textContent = `${totalProd} A Produzir`;
    pecasTotal.textContent = `${validas}/${rows.length} peças`;
  }

  // Recebe as escolhas confirmadas pelo modal independente e sincroniza o estado local.
  const handlePiecesReplaced = event => {
    const detail = event?.detail;
    if (!detail || detail.source !== 'orcamento-substituir-peca') return;
    const idx = Number(detail.rowIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= rows.length) return;
    const row = rows[idx];
    if (!row || !detail.plan) return;

    applyReplacementPlanToRow(row, detail.plan);
    row.approved = false;
    row.forceProduceAll = !!detail.forceProduceAll;

    if (Array.isArray(detail.plan?.stock) && detail.plan.stock.length && detail.selectedProduct) {
      const produto = detail.selectedProduct;
      if (row._origId == null) row._origId = row.produto_id;
      row.produto_id = Number(produto.id);
      row.nome = produto.nome;
      row.preco_venda = Number(produto.preco_venda || 0);
      row.codigo = produto.codigo;
    }

    const finalizePiecesLoading = showTableLoading(pecasBody, 'Recalculando peças...');
    const finalizeInsumosLoading = showTableLoading(insumosBody, 'Recalculando insumos...');

    Promise.resolve()
      .then(() => {
        recomputeStocks();
        renderRows();
        validate();
      })
      .then(() => computeInsumosAndRender({ showPiecesSpinner: false, showInsumosSpinner: false }))
      .catch(err => { console.error('Erro ao recalcular dados após substituição', err); })
      .finally(() => {
        finalizePiecesLoading();
        finalizeInsumosLoading();
      });
  };

  window.addEventListener(substituirPecaEvent, handlePiecesReplaced);

  function cleanupReplaceModalIntegration() {
    window.removeEventListener(substituirPecaEvent, handlePiecesReplaced);
    window.substituirPecaContext = null;
    const overlayEl = document.getElementById('substituirPecaOverlay');
    if (overlayEl && !overlayEl.classList.contains('hidden')) {
      try { Modal.close(substituirPecaOverlayId); }
      catch (err) { overlayEl.classList.add('hidden'); overlayEl.setAttribute('aria-hidden', 'true'); }
    }
  }

  function renderRows() {
    pecasBody.innerHTML = '';
    rows.forEach((r, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/10';
      tr.dataset.index = String(idx);
      const isAttention = r.a_produzir > 0 && r.status === 'atencao';
      const isApproved = !!r.approved;
      if (isApproved) tr.classList.add('quote-piece-approved');
      const primaryTextClass = isApproved ? 'text-green-300' : 'text-white';
      const statusIcon = isAttention ? '&#9888;' : '&#10003;';
      const statusTitle = isAttention ? 'Atenção' : 'OK';
      const statusColor = isAttention
        ? (isApproved ? 'text-green-400' : 'text-orange-300')
        : (isApproved ? 'text-green-400' : 'text-blue-400');
      const statusHtml = `<span class="${statusColor}" title="${statusTitle}">${statusIcon}</span>`;
      const actionClass = isApproved ? 'btn-danger' : 'btn-success';
      const actionLabel = isApproved ? 'Desaprovar' : 'Aprovar';

      const viewButtonHtml = `
        <button class="btn-secondary w-8 h-8 flex items-center justify-center rounded text-white focus:outline-none focus:ring-2 focus:ring-white/40"
          data-action="view-insumos" data-peca-id="${r.produto_id}" title="Visualizar" aria-label="Visualizar">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.036 12.322a1.012 1.012 0 010-.644C3.423 7.51 7.36 4.5 12 4.5c4.64 0 8.577 3.01 9.964 7.178.07.207.07.437 0 .644C20.577 16.49 16.64 19.5 12 19.5c-4.64 0-8.577-3.01-9.964-7.178z"></path>
            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
          </svg>
        </button>`;

      const replaceButtonClasses = [
        'btn-warning',
        'w-8',
        'h-8',
        'flex',
        'items-center',
        'justify-center',
        'rounded',
        'text-white',
        'focus:outline-none',
        'focus:ring-2',
        'focus:ring-white/40'
      ];
      if (isApproved) {
        replaceButtonClasses.push('opacity-50', 'cursor-not-allowed');
      }
      const replaceButtonTitle = isApproved
        ? 'Peça aprovada - desaprove antes de substituir'
        : 'Substituir';
      const replaceButtonHtml = `
        <button class="${replaceButtonClasses.join(' ')}"
          data-action="replace" data-approved="${isApproved ? 'true' : 'false'}" title="${replaceButtonTitle}" aria-label="Substituir">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.5 7.5A7.5 7.5 0 0112 4.5a7.5 7.5 0 017.5 7.5"></path>
            <path d="M19.5 12v4.5H15"></path>
            <path d="M19.5 16.5A7.5 7.5 0 0112 19.5a7.5 7.5 0 01-7.5-7.5"></path>
            <path d="M4.5 12V7.5H9"></path>
          </svg>
        </button>`;

      const actionIcon = isApproved
        ? `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6"></path><path d="M6 6l12 12"></path></svg>`
        : `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.75l6 6 9-13.5"></path></svg>`;
      const toggleButtonHtml = `
        <button class="${actionClass} w-8 h-8 flex items-center justify-center rounded ${isApproved ? 'text-white' : 'text-black'} focus:outline-none focus:ring-2 focus:ring-white/40"
          data-action="toggle-approval" title="${actionLabel}" aria-label="${actionLabel}">
          ${actionIcon}
        </button>`;

      const infoIconClass = isApproved ? 'text-green-200' : 'text-gray-300';
      const infoSpan = (Array.isArray(r.popover?.variants) && r.popover.variants.length > 0) ? `
        <span class="js-piece-info inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors ml-1 ${infoIconClass}" aria-haspopup="dialog" aria-expanded="false" data-variants='${JSON.stringify(r.popover.variants)}' data-page="0">
          <svg class="w-3 h-3 ${infoIconClass}" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0116 0zm-7-4a 1 1 0 11-2 0 1 1 0 012 0zM9 9a 1 1 0 000 2v3a 1 1 0 001 1h1a 1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
        </span>` : '';

      tr.innerHTML = `
        <td class="py-3 px-2 ${primaryTextClass}">${r.nome || ''}</td>
        <td class="py-3 px-2 text-left ${primaryTextClass}">${r.qtd}</td>
        <td class="py-3 px-2 text-left ${primaryTextClass}">${r.em_estoque ?? 0}</td>
        <td class="py-3 px-2 text-left ${primaryTextClass}">${r.pronta ?? 0}</td>
        <td class="py-3 px-2 text-left ${primaryTextClass}">${r.produzir_total ?? 0}</td>
        <td class="py-3 px-2 text-left ${primaryTextClass}">${r.produzir_parcial ?? 0} ${infoSpan}</td>
        <td class="py-3 px-2 text-left">${statusHtml}</td>
        <td class="py-3 px-2 text-left">
          <div class="flex justify-start gap-1">
            ${viewButtonHtml}
            ${replaceButtonHtml}
            ${toggleButtonHtml}
          </div>
        </td>`;
      pecasBody.appendChild(tr);
    });

    pecasBody.querySelectorAll('button[data-action="toggle-approval"]').forEach(btn => {
      btn.addEventListener('click', e => {
        const tr = e.currentTarget.closest('tr');
        const index = Number(tr?.dataset.index);
        if (isNaN(index)) return;
        const row = rows[index];
        if (!row) return;
        row.approved = !row.approved;
        renderRows();
        validate();
      });
    });

    pecasBody.querySelectorAll('button[data-action="replace"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const tr = e.currentTarget.closest('tr');
        const index = Number(tr?.dataset.index);
        if (isNaN(index)) return;
        const row = rows[index];
        if (!row) return;
        if (row.approved) {
          showPieceApprovedDialog();
          return;
        }
        await openReplaceModal(index);
      });
    });

    pecasBody.querySelectorAll('button[data-action="view-insumos"]').forEach(btn => {
      btn.addEventListener('click', e => {
        const pid = Number(e.currentTarget.getAttribute('data-peca-id'));
        state.insumosView.filtroPecaId = isNaN(pid) ? null : pid;
        const item = rows.find(r => Number(r.produto_id) === pid);
        if (insumosTituloPeca) insumosTituloPeca.textContent = item?.nome ? item.nome : 'Totais';
        const finalizeInsumosLoading = showTableLoading(insumosBody, 'Filtrando insumos...');
        try {
          buildInsumosGrid();
          validate();
        } finally {
          finalizeInsumosLoading();
        }
      });
    });

    initPiecePopover?.('.js-piece-info');
  }

  function showPieceApprovedDialog() {
    document.getElementById('pieceApprovedDialogOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'pieceApprovedDialogOverlay';
    overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center p-4';
    const baseOverlay = document.getElementById('converterOrcamentoOverlay');
    const computedZ = baseOverlay ? window.getComputedStyle(baseOverlay).zIndex : '';
    const parsedZ = Number(computedZ);
    const fallbackZ = 15000;
    const finalZ = Number.isFinite(parsedZ) ? Math.max(parsedZ + 2, fallbackZ) : fallbackZ;
    overlay.style.zIndex = String(finalZ);
    overlay.innerHTML = `
      <div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-yellow-500/20 ring-1 ring-yellow-500/30 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
          <h3 class="text-lg font-semibold mb-4 text-yellow-400">Peça Aprovada</h3>
          <p class="text-sm text-gray-300 mb-6">Esta peça já foi aprovada. Para substituí-la, é necessário desaprová-la primeiro.</p>
          <div class="flex justify-center">
            <button id="pieceApprovedOk" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Entendi</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const closeDialog = () => { if (overlay.isConnected) overlay.remove(); };
    overlay.querySelector('#pieceApprovedOk')?.addEventListener('click', closeDialog, { once: true });
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(); });
  }

  function validate() {
    const noRows = rows.length === 0;
    const anyError = rows.some(r => r.error);
    const canConfirm = !noRows && !anyError; // Fase 1: decisão de insumos não bloqueia ainda
    btnConfirmar.disabled = !canConfirm;
    btnConfirmar.classList.toggle('opacity-60', !canConfirm);
    btnConfirmar.classList.toggle('cursor-not-allowed', !canConfirm);

    if (noRows) {
      warningText.textContent = 'Nenhuma peça no orçamento.';
      warning.classList.remove('hidden');
    } else if (anyError) {
      warningText.textContent = 'Existem peças com dados inválidos.';
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }
  }


  // Botões básicos
  function handleCancelConversion() {
    try { cleanupReplaceModalIntegration(); }
    catch (err) { console.error(err); }
    window.confirmQuoteConversion = null;
    window.quoteConversionContext = null;
    if (typeof Modal?.closeAll === 'function') Modal.closeAll();
    else close();
  }

  btnCancelar.addEventListener('click', handleCancelConversion);
  btnConfirmar.addEventListener('click', () => {
    const deletions = (ctx.items || [])
      .filter(orig => !rows.find(r => r.produto_id === orig.produto_id))
      .map(orig => orig.produto_id);
    const replacements = [];
    (ctx.items || []).forEach(orig => {
      const now = rows.find(r => (r._origId ?? r.produto_id) === orig.produto_id || r.produto_id === orig.produto_id);
      if (now && now.produto_id !== orig.produto_id) {
        replacements.push({ oldId: orig.produto_id, newId: now.produto_id, newName: now.nome, newPrice: now.preco_venda });
      }
    });
    try {
      cleanupReplaceModalIntegration();
      window.confirmQuoteConversion?.({ deletions, replacements });
      close();
    }
    catch (err) { console.error(err); showToast('Erro ao confirmar conversão', 'error'); }
  });

  // Cálculo de insumos e status por peça
async function computeInsumosAndRender(options = {}) {
  const {
    showPiecesSpinner = true,
    showInsumosSpinner = true,
    message = 'Recalculando insumos...',
    forceRenderPieces = false
  } = options || {};
  const finalizePiecesLoading = showPiecesSpinner ? showTableLoading(pecasBody, 'Recalculando peças...') : () => {};
  const finalizeInsumosLoading = showInsumosSpinner ? showTableLoading(insumosBody, message) : () => {};
  try {
    const byId = new Map(listaProdutos.map(p => [String(p.id), p]));

    const captureRowViewState = row => ({
      nome: row?.nome || '',
      qtd: Number(row?.qtd || row?.quantidade || 0),
      emEstoque: Number(row?.em_estoque || 0),
      pronta: Number(row?.pronta || 0),
      produzirTotal: Number(row?.produzir_total || 0),
      produzirParcial: Number(row?.produzir_parcial || 0),
      status: row?.status || '',
      approved: !!row?.approved,
      popoverKey: JSON.stringify(Array.isArray(row?.popover?.variants) ? row.popover.variants : [])
    });
    const previousViewState = rows.map(captureRowViewState);

    // Estoque de matéria-prima
    let materias = [];
    try { materias = await (window.electronAPI?.listarMateriaPrima?.('') ?? []); }
    catch (err) { console.error('Erro ao listar matéria-prima', err); }
    const stockByName = new Map();
    materias.forEach(m => {
      const key = m.nome || '';
      if (!key) return;
      const cur = stockByName.get(key) || { quantidade: 0, unidade: m.unidade || '', infinito: !!m.infinito };
      cur.quantidade += Number(m.quantidade || 0);
      cur.infinito = cur.infinito || !!m.infinito;
      stockByName.set(key, cur);
    });

    for (const r of rows) {
      const prod = byId.get(String(r.produto_id));
      const codigo = prod?.codigo;
      r.status = '';
      r.faltantes = [];
      r.produzir_total = 0;
      r.produzir_parcial = 0;
      r.popover = { variants: [] };
      r.pronta = 0;
      r.em_estoque = 0;
      r.a_produzir = 0;
      r.codigo = codigo;
      if (!codigo) continue;

      let detalhes = {};
      try { detalhes = await (window.electronAPI?.listarDetalhesProduto?.({ produtoCodigo: codigo, produtoId: r.produto_id }) ?? {}); }
      catch (e) { console.error('detalhes', e); }
      const rota = Array.isArray(detalhes?.itens) ? detalhes.itens : [];
      const rawLotes = Array.isArray(detalhes?.lotes) ? detalhes.lotes : [];
      const forceAll = !!r.forceProduceAll;
      const orderById = new Map(rota.map(i => [Number(i.insumo_id), Number(i.ordem_insumo || 0)]));
      const rotaSorted = rota.slice().sort((a, b) => Number(a.ordem_insumo || 0) - Number(b.ordem_insumo || 0));
      const maxOrder = rotaSorted.length ? Math.max(...rotaSorted.map(i => Number(i.ordem_insumo || 0))) : 0;
      const faltantesMap = new Map();
      const partialRecords = new Map();

      const registerPartial = (orderValue, qtyValue, meta = {}) => {
        const qty = Number(qtyValue);
        if (!(qty > 0)) return;
        const order = Number.isFinite(Number(orderValue)) ? Number(orderValue) : 0;
        const key = order;
        const existing = partialRecords.get(key) || {
          order,
          qty: 0,
          lastName: meta.lastName || '',
          process: meta.process || '',
          usedAt: meta.usedAt || '',
          lastId: Number.isFinite(Number(meta.lastId)) ? Number(meta.lastId) : null
        };
        existing.qty += qty;
        if (!existing.lastName && meta.lastName) existing.lastName = meta.lastName;
        if (!existing.process && meta.process) existing.process = meta.process;
        if (!existing.usedAt && meta.usedAt) existing.usedAt = meta.usedAt;
        if (existing.lastId == null && Number.isFinite(Number(meta.lastId))) existing.lastId = Number(meta.lastId);
        partialRecords.set(key, existing);
      };

      const addFaltantes = (orderMin, units) => {
        const sanitizedUnits = Number(units);
        if (!(sanitizedUnits > 0)) return;
        rotaSorted.forEach(i => {
          const ord = Number(i.ordem_insumo || 0);
          if (ord > orderMin) {
            const nome = i.nome || '';
            if (!nome) return;
            const unidade = i.unidade || '';
            const necessario = Number(i.quantidade || 0) * sanitizedUnits;
            if (!(necessario > 0)) return;
            const key = `${nome}__${unidade}`;
            const existing = faltantesMap.get(key) || {
              key,
              nome,
              un: unidade,
              necessario: 0,
              etapa: i.processo || '',
              ordem: ord
            };
            existing.necessario += necessario;
            if (!existing.etapa && i.processo) existing.etapa = i.processo;
            existing.ordem = Math.max(existing.ordem || 0, ord);
            faltantesMap.set(key, existing);
          }
        });
      };

      let readyQty = 0;
      let partialQtyTotal = 0;
      let produceTotal = 0;
      let usedPlanData = false;

      let availableBreakdown = [];

      if (r.replacementPlan) {
        applyReplacementPlanToRow(r);
        const planData = clonePlan(r.replacementPlan);
        if (planData) {
          const planStock = Array.isArray(planData.stock) ? planData.stock : [];
          planStock.forEach(entry => {
            const qty = Number(entry?.qty || 0);
            if (!(qty > 0)) return;
            const order = Number(entry?.order || 0);
            if (entry?.isFinal) {
              readyQty += qty;
            } else {
              registerPartial(order, qty, {
                lastName: entry?.lastItemName || '',
                process: entry?.processName || '',
                usedAt: entry?.usedAt || '',
                lastId: entry?.lastInsumoId
              });
            }
          });
          partialQtyTotal = Array.from(partialRecords.values()).reduce((acc, item) => acc + Number(item.qty || 0), 0);
          produceTotal = Math.max(0, Number(planData.produceQty || 0) + Number(planData.remaining || 0));
          r.pronta = readyQty;
          r.em_estoque = readyQty + partialQtyTotal;
          r.produzir_parcial = partialQtyTotal;
          r.produzir_total = produceTotal;
          r.a_produzir = r.produzir_parcial + r.produzir_total;
          usedPlanData = true;
        }
      }

      if (!usedPlanData) {
        const lotes = forceAll ? [] : rawLotes;
        const partialCandidates = [];
        lotes.forEach(l => {
          const qty = Number(l.quantidade || 0);
          if (!(qty > 0)) return;
          const lastId = Number(l.ultimo_insumo_id || 0);
          const ord = orderById.get(lastId) || 0;
          if (ord >= maxOrder && maxOrder > 0) readyQty += qty;
          else {
            partialCandidates.push({
              order: ord,
              qty,
              lastId,
              lastName: l.ultimo_item || '',
              process: l.etapa || '',
              usedAt: l.data_hora_completa || ''
            });
          }
        });
        const qtd = Number(r.qtd || 0);
        let needed = Math.max(0, qtd - readyQty);
        partialCandidates.sort((a, b) => b.order - a.order);
        for (const candidate of partialCandidates) {
          if (needed <= 0) break;
          const take = Math.min(candidate.qty, needed);
          if (take > 0) {
            needed -= take;
            registerPartial(candidate.order, take, candidate);
          }
        }
        partialQtyTotal = Array.from(partialRecords.values()).reduce((acc, item) => acc + Number(item.qty || 0), 0);
        produceTotal = Math.max(0, Number(r.qtd || 0) - readyQty - partialQtyTotal);
        r.pronta = readyQty;
        r.em_estoque = readyQty + partialQtyTotal;
        r.produzir_parcial = partialQtyTotal;
        r.produzir_total = produceTotal;
        r.a_produzir = r.produzir_parcial + r.produzir_total;
        availableBreakdown = buildStockBreakdownFromDetails(rota, rawLotes);
        r.stockBreakdown = availableBreakdown;
      }

      if (!Array.isArray(availableBreakdown) || !availableBreakdown.length) {
        availableBreakdown = buildStockBreakdownFromDetails(rota, rawLotes);
      }
      const availability = summarizeBreakdownAvailability(availableBreakdown);
      r.availableStockBreakdown = availableBreakdown;
      r.availableStock = availability;
      r.em_estoque = availability.total;

      partialRecords.forEach(record => addFaltantes(record.order, record.qty));
      if (produceTotal > 0) addFaltantes(Number.NEGATIVE_INFINITY, produceTotal);

      r.faltantes = Array.from(faltantesMap.values());

      let pieceHasNegative = false;
      for (const f of r.faltantes) {
        const stock = stockByName.get(f.nome) || { quantidade: 0, infinito: false };
        if (!stock.infinito) {
          const saldo = Number(stock.quantidade || 0) - Number(f.necessario || 0);
          if (saldo < 0) { pieceHasNegative = true; break; }
        }
      }
      r.status = (r.a_produzir > 0 && pieceHasNegative) ? 'atencao' : 'ok';

      const popoverVariants = Array.from(partialRecords.values())
        .sort((a, b) => b.order - a.order)
        .map(record => {
          const order = Number(record.order || 0);
          const stageItem = rotaSorted.find(i => Number(i.ordem_insumo || 0) === order) || null;
          const pending = rotaSorted
            .filter(i => Number(i.ordem_insumo || 0) > order)
            .map(i => ({
              name: i.nome,
              pending: Number(i.quantidade || 0) * Number(record.qty || 0),
              un: i.unidade
            }));
          return {
            qty: Number(record.qty || 0),
            lastItem: {
              name: stageItem ? stageItem.nome : (record.lastName || 'Nenhum'),
              qty: stageItem ? Number(stageItem.quantidade || 0) * Number(record.qty || 0) : 0,
              time: record.usedAt || ''
            },
            currentProcess: {
              name: record.process || (stageItem ? stageItem.processo : ''),
              since: record.usedAt || ''
            },
            totalItems: rotaSorted.length,
            pending
          };
        });
      r.popover.variants = popoverVariants;

      if (!usedPlanData) {
        r.forceProduceAll = forceAll;
      }
    }

    const nextViewState = rows.map(captureRowViewState);
    let shouldRenderPieces = previousViewState.length !== nextViewState.length;
    if (!shouldRenderPieces) {
      for (let i = 0; i < nextViewState.length; i++) {
        const prev = previousViewState[i] || {};
        const next = nextViewState[i];
        if (
          prev.nome !== next.nome ||
          prev.qtd !== next.qtd ||
          prev.emEstoque !== next.emEstoque ||
          prev.pronta !== next.pronta ||
          prev.produzirTotal !== next.produzirTotal ||
          prev.produzirParcial !== next.produzirParcial ||
          prev.status !== next.status ||
          prev.approved !== next.approved ||
          prev.popoverKey !== next.popoverKey
        ) {
          shouldRenderPieces = true;
          break;
        }
      }
    }

    lastStockByName = stockByName;
    recomputeStocks();
    buildInsumosGrid(stockByName);
    if (shouldRenderPieces || forceRenderPieces) {
      renderRows();
    }
    validate();
  } catch (err) {
    console.error('Erro ao calcular insumos', err);
  } finally {
    finalizeInsumosLoading();
    finalizePiecesLoading();
  }
}


  function buildInsumosGrid(stockByName) {
    stockByName = stockByName && stockByName.size ? stockByName : (lastStockByName || new Map());
    const filtroPecaId = state.insumosView.filtroPecaId;
    const mostrarSomenteFaltantes = state.insumosView.mostrarSomenteFaltantes;
    insumosBody.innerHTML = '';
    const list = [];
    rows.forEach(p => {
      if (filtroPecaId && Number(p.produto_id) !== Number(filtroPecaId)) return;
      (p.faltantes || []).forEach(fi => {
        list.push({
          produto_id: p.produto_id,
          nome: fi.nome,
          un: fi.un,
          etapa: fi.etapa,
          necessario: Number(fi.necessario || 0),
          ordem: fi.ordem || 0
        });
      });
    });

    let anyNegative = false;

    if (filtroPecaId) {
      list.sort((a, b) => a.ordem - b.ordem);
      list.forEach(v => {
        const stock = (stockByName && stockByName.get(v.nome)) || { quantidade: 0, unidade: v.un, infinito: false };
        const disponivel = stock.infinito ? Infinity : Number(stock.quantidade || 0);
        const saldo = disponivel === Infinity ? Infinity : disponivel - Number(v.necessario || 0);
        const negative = saldo !== Infinity && saldo < 0;
        if (negative) anyNegative = true;
        if (mostrarSomenteFaltantes && !negative) return;
        const tr = document.createElement('tr');
        if (negative) tr.classList.add('negative-balance');
        tr.classList.add('border-b', 'border-white/5');
        const flags = [];
        if (saldo === Infinity) {
          flags.push('<span class="badge-success px-2 py-0.5 rounded text-[10px]" title="Estoque infinito">infinito</span>');
        } else if (negative) {
          flags.push('<span class="badge-danger px-2 py-0.5 rounded text-[10px]" title="Saldo previsto negativo">negativo</span>');
        } else {
          flags.push('<span class="badge-info px-2 py-0.5 rounded text-[10px]" title="Saldo previsto correto">correto</span>');
        }
        tr.innerHTML = `
          <td class="py-3 px-2 text-white">${v.nome}</td>
          <td class="py-3 px-2 text-left text-gray-300">${v.un || stock.unidade || ''}</td>
          <td class="py-3 px-2 text-left">${disponivel === Infinity ? '<span class="badge-success px-2 py-0.5 rounded text-[10px]">infinito</span>' : '<span class="text-white">' + disponivel.toLocaleString('pt-BR') + '</span>'}</td>
          <td class="py-3 px-2 text-left text-white">${Number(v.necessario || 0).toLocaleString('pt-BR')}</td>
          <td class="py-3 px-2 text-left">${negative ? '<span class="status-alert font-medium" title="Saldo previsto negativo">' + saldo.toLocaleString('pt-BR') + '</span>' : (saldo === Infinity ? '<span class="badge-success px-2 py-0.5 rounded text-[10px]">infinito</span>' : '<span class="status-ok font-medium">' + saldo.toLocaleString('pt-BR') + '</span>')}</td>
          <td class="py-3 px-2 text-left text-white">${v.etapa || '-'}</td>
          <td class="py-3 px-2 text-left text-white">${flags.join(' ')}</td>`;
        insumosBody.appendChild(tr);
      });
    } else {
      const agg = new Map();
      list.forEach(i => {
        const key = `${i.nome}__${i.un}__${i.etapa}`;
        const cur = agg.get(key) || { nome: i.nome, un: i.un, etapa: i.etapa, necessario: 0 };
        cur.necessario += i.necessario;
        agg.set(key, cur);
      });
      for (const v of Array.from(agg.values()).sort((a, b) => a.nome.localeCompare(b.nome))) {
        const stock = (stockByName && stockByName.get(v.nome)) || { quantidade: 0, unidade: v.un, infinito: false };
        const disponivel = stock.infinito ? Infinity : Number(stock.quantidade || 0);
        const saldo = disponivel === Infinity ? Infinity : disponivel - Number(v.necessario || 0);
        const negative = saldo !== Infinity && saldo < 0;
        if (negative) anyNegative = true;
        if (mostrarSomenteFaltantes && !negative) continue;
        const tr = document.createElement('tr');
        if (negative) tr.classList.add('negative-balance');
        tr.classList.add('border-b', 'border-white/5');
        const flags = [];
        if (saldo === Infinity) {
          flags.push('<span class="badge-success px-2 py-0.5 rounded text-[10px]" title="Estoque infinito">infinito</span>');
        } else if (negative) {
          flags.push('<span class="badge-danger px-2 py-0.5 rounded text-[10px]" title="Saldo previsto negativo">negativo</span>');
        } else {
          flags.push('<span class="badge-info px-2 py-0.5 rounded text-[10px]" title="Saldo previsto correto">correto</span>');
        }
        tr.innerHTML = `
          <td class="py-3 px-2 text-white">${v.nome}</td>
          <td class="py-3 px-2 text-left text-gray-300">${v.un || stock.unidade || ''}</td>
          <td class="py-3 px-2 text-left">${disponivel === Infinity ? '<span class="badge-success px-2 py-0.5 rounded text-[10px]">infinito</span>' : '<span class="text-white">' + disponivel.toLocaleString('pt-BR') + '</span>'}</td>
          <td class="py-3 px-2 text-left text-white">${Number(v.necessario || 0).toLocaleString('pt-BR')}</td>
          <td class="py-3 px-2 text-left">${negative ? '<span class="status-alert font-medium" title="Saldo previsto negativo">' + saldo.toLocaleString('pt-BR') + '</span>' : (saldo === Infinity ? '<span class="badge-success px-2 py-0.5 rounded text-[10px]">infinito</span>' : '<span class="status-ok font-medium">' + saldo.toLocaleString('pt-BR') + '</span>')}</td>
          <td class="py-3 px-2 text-left text-white">${v.etapa || '-'}</td>
          <td class="py-3 px-2 text-left text-white">${flags.join(' ')}</td>`;
        insumosBody.appendChild(tr);
      }
    }

    if (anyNegative && !state.allowNegativeStock) {
      warningText.textContent = 'Há insumos com saldo negativo. Ajuste peças/insumos.';
      warning.classList.remove('hidden');
      btnConfirmar.disabled = true;
      btnConfirmar.classList.add('opacity-60', 'cursor-not-allowed');
    }
  }

  // Init
  const initPromise = (async function init(){
    await carregarProdutos();
    if (!rows.length) {
      const tbody = document.querySelector('#orcamentoItens tbody');
      rows = Array.from(tbody?.children || []).map(tr => ({
        produto_id: Number(tr.dataset.id),
        nome: tr.children[0]?.textContent?.trim() || '',
        qtd: Number(tr.children[1]?.textContent?.trim() || '0'),
        approved: false
      })).filter(x => x.produto_id && x.qtd);
    }
    rows.forEach(r => {
      r._origId = r.produto_id;
      r.approved = !!r.approved;
    });
    if (insumosTituloPeca) insumosTituloPeca.textContent = 'Totais';
    recomputeStocks(); renderRows(); validate(); await computeInsumosAndRender({ message: 'Carregando insumos...' });
  })();

  initPromise
    .then(() => {
      markReady(true);
      window.dispatchEvent(new CustomEvent('orcamentoModalLoaded', { detail: overlayId }));
    })
    .catch(err => {
      console.error('Erro ao preparar conversão de orçamento', err);
      if (typeof showToast === 'function') {
        showToast('Erro ao preparar conversão do orçamento.', 'error');
      }
      markReady(false);
      window.dispatchEvent(new CustomEvent('orcamentoModalLoaded', { detail: overlayId }));
      close();
    });

  // Eventos extra
  document.getElementById('converterDecisionNote')?.addEventListener('input', () => {
    computeInsumosAndRender({ message: 'Atualizando insumos...' });
  });
  function refreshInsumosTable(message = 'Atualizando insumos...') {
    const finalize = showTableLoading(insumosBody, message);
    try {
      buildInsumosGrid();
      validate();
    } finally {
      finalize();
    }
  }
  onlyMissingToggle?.addEventListener('change', () => {
    state.insumosView.mostrarSomenteFaltantes = !!onlyMissingToggle.checked;
    const message = state.insumosView.mostrarSomenteFaltantes ? 'Filtrando insumos faltantes...' : 'Atualizando insumos...';
    refreshInsumosTable(message);
  });
  insumosReloadBtn?.addEventListener('click', () => {
    state.insumosView.filtroPecaId = null;
    if (onlyMissingToggle) { onlyMissingToggle.checked = false; state.insumosView.mostrarSomenteFaltantes = false; }
    if (insumosTituloPeca) insumosTituloPeca.textContent = 'Totais';
    computeInsumosAndRender({ message: 'Recarregando insumos...', showPiecesSpinner: false });
  });

  // Popover de peça (clique)
  function initPiecePopover(selector = '.js-piece-info'){
    createPopoverContainer();
    document.querySelectorAll(selector).forEach(trigger => {
      trigger.addEventListener('click', e => {
        e.preventDefault();
        const t = e.currentTarget;
        if (t.getAttribute('aria-expanded') === 'true') hidePopover();
        else showPopover(t);
      });
      trigger.addEventListener('keydown', e => { if (e.key==='Escape') { hidePopover(); trigger.focus(); } });
    });
    document.addEventListener('click', e => { if (!e.target.closest('.js-piece-info') && !e.target.closest('#piece-popover')) hidePopover(); });
    document.addEventListener('keydown', e => { if (e.key==='Escape') hidePopover(); });
  }

  function createPopoverContainer(){
    if (document.getElementById('piece-popover')) return;
    const p=document.createElement('div');
    p.id='piece-popover';
    p.className='fixed pointer-events-none opacity-0 scale-95 transition-all duration-150 ease-out z-[11000]';
    p.style.zIndex='11000';
    p.setAttribute('role','dialog');
    p.setAttribute('aria-modal','false');
    p.tabIndex=-1;
    document.body.appendChild(p);
  }
  function showPopover(trigger){ const pop=document.getElementById('piece-popover'); hidePopover(); buildPopover(trigger); placePopover(trigger); pop.classList.remove('opacity-0','scale-95','pointer-events-none'); pop.classList.add('opacity-100','scale-100','pointer-events-auto'); trigger.setAttribute('aria-expanded','true'); }
  function hidePopover(){ const pop=document.getElementById('piece-popover'); if(!pop) return; pop.classList.remove('opacity-100','scale-100','pointer-events-auto'); pop.classList.add('opacity-0','scale-95','pointer-events-none'); document.querySelectorAll('.js-piece-info[aria-expanded="true"]').forEach(t=>t.setAttribute('aria-expanded','false')); }
    function buildPopover(trigger){
      const variants=JSON.parse(trigger.dataset.variants||'[]');
      let page=Number(trigger.dataset.page||0);
      if(isNaN(page)||page<0) page=0;
      if(page>=variants.length) page=variants.length-1;
      trigger.dataset.page=String(page);
      const v=variants[page]||{};
      const pop=document.getElementById('piece-popover');
      const nav =
        variants.length > 1
          ? `<div class="absolute top-2 right-3 flex items-center rounded-full overflow-hidden border border-white/20 text-xs shadow">
               <button class="js-pop-prev px-2 py-1 bg-white/5 ${page <= 0 ? 'opacity-30 cursor-default pointer-events-none' : 'hover:bg-white/10'}"><i class='fas fa-chevron-left'></i></button>
               <span class="px-3 py-1 bg-white/10 text-white">${page + 1}/${variants.length}</span>
               <button class="js-pop-next px-2 py-1 bg-white/5 ${page >= variants.length - 1 ? 'opacity-30 cursor-default pointer-events-none' : 'hover:bg-white/10'}"><i class='fas fa-chevron-right'></i></button>
             </div>`
          : '';
      const cardPadding = variants.length > 1 ? 'pt-12 pb-4 px-4' : 'p-4';
      pop.innerHTML = `
        <div class="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl shadow-2xl max-w-sm w-[360px] ${cardPadding} text-neutral-100 relative">
          <div class="popover-arrow absolute w-3 h-3 bg-white/10 border-l border-t border-white/20 rotate-45 -translate-y-1/2"></div>
          ${nav}
          <div class="mb-4">
            <h3 class="text-sm font-semibold text-amber-400 mb-2 flex items-center justify-between"><span class="flex items-center gap-2"><i class='fas fa-box-open'></i>Último insumo</span><span class="text-amber-400 text-xs">Quantidade Usada: ${v.qty||0}</span></h3>
            <div class="flex items-center justify-between text-sm py-1"><span class="text-white font-medium">${v.lastItem?.name||'N/A'}</span><div class="text-right"><div class="text-white">${v.lastItem?.qty||0} un</div>${v.lastItem?.time?`<div class=\"text-xs text-gray-400\">${formatRel(v.lastItem.time)}</div>`:''}</div></div>
          </div>
          <div class="mb-4">
            <h3 class="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2"><i class='fas fa-cogs'></i>Processo atual</h3>
            <div class="flex items-center justify-between text-sm py-1"><span class="text-white font-medium">${v.currentProcess?.name||'N/A'}</span><span class="text-gray-400 text-xs">${v.currentProcess?.since ? `desde ${new Date(v.currentProcess.since).toLocaleDateString('pt-BR')}` : ''}</span></div>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2"><i class='fas fa-exclamation-circle'></i>Pendentes</h3>
            <div class="max-h-48 overflow-auto pr-1 modal-scroll">
              ${v.pending && v.pending.length ? v.pending.map(item => `<div class=\"flex items-center justify-between text-sm py-1.5\"><span class=\"text-gray-300 flex items-center\"><span class=\"text-amber-400 mr-2\">•</span>${item.name}</span><span class=\"text-white\">${item.pending} ${item.un||''}</span></div>`).join('') : '<div class="text-gray-400 text-sm py-2">Nenhum item pendente</div>'}
            </div>
            ${v.pending && v.pending.length ? `<div class=\"mt-3 pt-3 border-t border-white/10\"><span class=\"inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-white text-amber-400\">${v.pending.length}/${v.totalItems} itens pendentes</span></div>` : ''}
          </div>
        </div>`;
      function formatRel(ts){
        const d=new Date(ts); if(isNaN(d)) return '';
        const diff=Date.now()-d.getTime(); const h=Math.floor(diff/3600000);
        if(h<24) return `há ${h}h`; const day=Math.floor(h/24);
        if(day<30) return `há ${day}d`; return d.toLocaleDateString('pt-BR');
      }
      if(variants.length>1){
        pop.querySelector('.js-pop-prev')?.addEventListener('click',e=>{e.stopPropagation();trigger.dataset.page=String(page-1);buildPopover(trigger);});
        pop.querySelector('.js-pop-next')?.addEventListener('click',e=>{e.stopPropagation();trigger.dataset.page=String(page+1);buildPopover(trigger);});
      }
    }
  function placePopover(trigger){ const pop=document.getElementById('piece-popover'); const r=trigger.getBoundingClientRect(); const { width: pw, height: ph } = pop.getBoundingClientRect(); const vw=window.innerWidth, vh=window.innerHeight; let top,left,arrowClass=''; const above=r.top, below=vh-r.bottom, leftSpace=r.left, rightSpace=vw-r.right; if (rightSpace>=pw+20){ top=Math.max(16, Math.min(r.top + (r.height/2) - ph/2, vh-ph-16)); left=r.right+8; arrowClass='left-[-6px] top-1/2 transform -translate-y-1/2 rotate-[135deg]'; } else if (leftSpace>=pw+20){ top=Math.max(16, Math.min(r.top + (r.height/2) - ph/2, vh-ph-16)); left=r.left-pw-8; arrowClass='right-[-6px] top-1/2 transform -translate-y-1/2 rotate-[315deg]'; } else if (below>=ph){ top=r.bottom+8; left=Math.max(16, Math.min(r.left + (r.width/2) - pw/2, vw-pw-16)); arrowClass='top-[-6px] left-1/2 transform -translate-x-1/2 rotate-[225deg]'; } else if (above>=ph){ top=r.top-ph-8; left=Math.max(16, Math.min(r.left + (r.width/2) - pw/2, vw-pw-16)); arrowClass='bottom-[-6px] left-1/2 transform -translate-x-1/2'; } else { top=Math.max(16, (vh-ph)/2); left=Math.max(16, (vw-pw)/2); arrowClass='hidden'; } pop.style.top=`${top}px`; pop.style.left=`${left}px`; const a=pop.querySelector('.popover-arrow'); if(a){ a.className=`popover-arrow absolute w-3 h-3 bg-white/10 border-l border-t border-white/20 ${arrowClass}`; } }
})();




