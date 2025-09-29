(async () => {
  const overlayId = 'substituirPeca';
  const overlay = document.getElementById('substituirPecaOverlay');
  if (!overlay) return;

  let readyMarked = false;
  const markReady = (reveal = true) => {
    if (!overlay || !overlay.classList) {
      if (!readyMarked && typeof Modal?.signalReady === 'function') {
        readyMarked = true;
        Modal.signalReady(overlayId);
      }
      return;
    }

    if (reveal && overlay.classList.contains('hidden')) {
      overlay.classList.remove('hidden');
      overlay.removeAttribute('aria-hidden');
    } else if (!reveal) {
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

  const context = window.substituirPecaContext || {};
  const ctx = context.quote || {};
  const rowIndex = Number.isFinite(Number(context.rowIndex)) ? Number(context.rowIndex) : null;
  const baseRow = context.row ? JSON.parse(JSON.stringify(context.row)) : null;

  if (!baseRow || rowIndex === null) {
    markReady(false);
    window.substituirPecaContext = null;
    Modal.close(overlayId);
    return;
  }

  let replaceModalRefs = {
    overlay,
    modal: overlay.querySelector('[data-role="modal"]'),
    confirmBtn: overlay.querySelector('[data-action="confirm"]'),
    commitBtn: overlay.querySelector('[data-action="commit"]'),
    search: overlay.querySelector('[data-role="search"]'),
    results: overlay.querySelector('[data-role="results"]'),
    stockBreakdown: overlay.querySelector('[data-field="piece-stock-breakdown"]'),
    selectionSummary: overlay.querySelector('[data-field="piece-selection"]'),
    selectionCounter: overlay.querySelector('[data-field="selection-counter"]'),
    selectionRemaining: overlay.querySelector('[data-field="selection-remaining"]')
  };

  const replaceModalState = {
    searchTerm: '',
    variants: [],
    selections: new Map(),
    initialSelections: null,
    loadingVariants: null,
    variantsLoadedForRowId: null,
    originalPlan: null,
    committedSelections: [],
    activeVariantKey: null,
    currentRow: baseRow,
    rowIndex,
    ctx,
    productList: Array.isArray(context.productList) ? context.productList.slice() : [],
    productListLoaded: Array.isArray(context.productList) ? context.productList.length > 0 : false
  };

  const productBreakdownCache = new Map();

  // Fechamento isolado do modal de substituição, sem impactar o modal pai.
  const closeModal = () => {
    document.removeEventListener('keydown', handleKeydown);
    replaceModalRefs?.modal?.removeEventListener('pointerdown', handleReplaceModalPointerDown);
    window.substituirPecaContext = null;
    Modal.close(overlayId);
  };

  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });

  overlay.querySelectorAll('[data-action="close"]').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  const normalizeText = value => {
    if (!value) return '';
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  };

  const buildGroupKey = (name, id) => {
    const normalized = normalizeText(name || '');
    const base = normalized.split('-')[0]?.trim() || '';
    const clean = base.replace(/[^a-z0-9]+/g, ' ').trim();
    if (clean) return clean;
    if (id != null) return `id-${id}`;
    return '';
  };

  const sanitizePositiveInt = value => {
    const num = Math.floor(Number(value) || 0);
    return Number.isFinite(num) && num > 0 ? num : 0;
  };

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

  async function loadProductBreakdown(produto) {
    if (!produto) return [];
    const produtoId = Number(produto.id);
    if (Number.isFinite(produtoId) && productBreakdownCache.has(produtoId)) {
      return productBreakdownCache.get(produtoId);
    }
    try {
      const detalhes = await (window.electronAPI?.listarDetalhesProduto?.({
        produtoCodigo: produto.codigo,
        produtoId: produto.id
      }) ?? {});
      const breakdown = buildStockBreakdownFromDetails(detalhes?.itens, detalhes?.lotes);
      if (Number.isFinite(produtoId)) productBreakdownCache.set(produtoId, breakdown);
      return breakdown;
    } catch (err) {
      console.error('Erro ao carregar pontos de estoque da peça', err);
      if (Number.isFinite(produtoId)) productBreakdownCache.set(produtoId, []);
      return [];
    }
  }

  const ensureSelectionMap = () => {
    if (!replaceModalState.selections || !(replaceModalState.selections instanceof Map)) {
      replaceModalState.selections = new Map();
    }
    return replaceModalState.selections;
  };

  const ensureCommittedList = () => {
    if (!Array.isArray(replaceModalState.committedSelections)) {
      replaceModalState.committedSelections = [];
    }
    return replaceModalState.committedSelections;
  };

  const setActiveVariantKey = key => {
    replaceModalState.activeVariantKey = key || null;
  };

  const getActiveVariantKey = () => replaceModalState.activeVariantKey || null;

  const clearActiveVariantKeyIfMatches = key => {
    if (!key) return;
    if (replaceModalState.activeVariantKey === key) {
      replaceModalState.activeVariantKey = null;
    }
  };

  const hasPendingSelections = () => {
    const selections = ensureSelectionMap();
    for (const qty of selections.values()) {
      if (sanitizePositiveInt(qty) > 0) return true;
    }
    return false;
  };

  const getCommittedQuantity = key => {
    if (!key) return 0;
    const list = ensureCommittedList();
    const entry = list.find(item => item?.key === key);
    return sanitizePositiveInt(entry?.qty);
  };

  const setCommittedQuantity = (key, quantity) => {
    if (!key) return;
    const list = ensureCommittedList();
    const sanitized = sanitizePositiveInt(quantity);
    const index = list.findIndex(item => item?.key === key);
    if (sanitized > 0) {
      if (index >= 0) list[index].qty = sanitized;
      else list.push({ key, qty: sanitized });
    } else if (index >= 0) {
      list.splice(index, 1);
    }
  };

  const addCommittedQuantity = (key, quantity) => {
    if (!key) return;
    const current = getCommittedQuantity(key);
    const total = current + sanitizePositiveInt(quantity);
    setCommittedQuantity(key, total);
  };

  const clearCommittedSelections = () => {
    replaceModalState.committedSelections = [];
  };

  const getVariantByKey = key => replaceModalState.variants.find(v => v.key === key) || null;

  const getRequiredQuantity = row => Number(row?.qtd || row?.quantidade || 0) || 0;

  const getTotalCommittedQuantity = () => {
    const list = ensureCommittedList();
    return list.reduce((acc, item) => acc + sanitizePositiveInt(item?.qty), 0);
  };

  const getGlobalRemainingCapacity = requiredQty => {
    const confirmed = getTotalCommittedQuantity();
    return Math.max(0, requiredQty - confirmed);
  };

  const getVariantStockLimit = (variant, requiredQty) => {
    if (!variant) return 0;
    if (variant.type === 'produce') return requiredQty;
    return Math.max(0, Math.floor(Number(variant.available) || 0));
  };

  const computeVariantMax = (variant, requiredQty) => {
    if (!variant) return 0;
    const confirmedQty = getCommittedQuantity(variant.key);
    const stagingQty = getSelectionQuantity(variant.key);
    const stockLimit = getVariantStockLimit(variant, requiredQty);
    const stockRemaining = Math.max(0, stockLimit - confirmedQty);
    const globalRemaining = getGlobalRemainingCapacity(requiredQty);
    const effectiveGlobal = Math.max(0, globalRemaining + stagingQty);
    return Math.max(0, Math.min(stockRemaining, effectiveGlobal));
  };

  const getSelectionMap = () => ensureSelectionMap();

  const getSelectionQuantity = key => {
    if (!key) return 0;
    const selections = getSelectionMap();
    return sanitizePositiveInt(selections.get(key));
  };

  const setSelectionQuantity = (key, quantity) => {
    if (!key) return;
    const selections = getSelectionMap();
    const sanitized = sanitizePositiveInt(quantity);
    if (sanitized > 0) {
      selections.set(key, sanitized);
      setActiveVariantKey(key);
    } else {
      selections.delete(key);
      clearActiveVariantKeyIfMatches(key);
    }
  };

  const updateStagingQuantityForVariant = (variant, quantity, options = {}) => {
    if (!variant) return;
    const row = replaceModalState.currentRow;
    if (!row) return;
    const requiredQty = getRequiredQuantity(row);
    const max = computeVariantMax(variant, requiredQty);
    const next = Math.min(Math.max(0, sanitizePositiveInt(quantity)), max);
    setSelectionQuantity(variant.key, next);
    if (options?.focus?.key === variant.key) {
      const input = replaceModalRefs?.results?.querySelector(`input[data-variant-key="${variant.key}"]`);
      if (input) {
        requestAnimationFrame(() => {
          input.focus();
          if (options.focus.select) input.select();
        });
      }
    }
    updateCommitButtonState();
  };

  const clearStagingForVariant = key => {
    setSelectionQuantity(key, 0);
    updateCommitButtonState();
  };

  const clearAllStaging = () => {
    const selections = getSelectionMap();
    let changed = false;
    selections.forEach((_, key) => {
      if (getSelectionQuantity(key) > 0) {
        selections.set(key, 0);
        changed = true;
      }
    });
    replaceModalState.selections = new Map();
    replaceModalState.activeVariantKey = null;
    updateCommitButtonState();
    return changed;
  };

  const reduceConfirmedQuantity = (key, amount) => {
    const sanitized = sanitizePositiveInt(amount);
    if (!sanitized) return;
    const current = getCommittedQuantity(key);
    const next = Math.max(0, current - sanitized);
    setCommittedQuantity(key, next);
    updateReplaceModalConfirmButton();
  };

  const confirmStagingForVariant = key => {
    const variant = getVariantByKey(key);
    const row = replaceModalState.currentRow;
    if (!variant || !row) return;
    const requiredQty = getRequiredQuantity(row);
    const stagingQty = getSelectionQuantity(key);
    const max = computeVariantMax(variant, requiredQty);
    if (!stagingQty || stagingQty > max) return;
    addCommittedQuantity(key, stagingQty);
    clearStagingForVariant(key);
    updateReplaceModalConfirmButton();
    renderReplaceModalList({ skipReload: true });
  };

  function buildSelectionPlan(row) {
    const requiredQty = getRequiredQuantity(row);
    const plan = {
      requiredQty,
      totalSelected: 0,
      remaining: requiredQty,
      produceQty: 0,
      stock: [],
      selections: []
    };
    const committedList = ensureCommittedList();
    committedList.forEach(entry => {
      const variant = getVariantByKey(entry.key);
      if (!variant) return;
      const qty = sanitizePositiveInt(entry.qty);
      if (!qty) return;
      const variantMax = variant.type === 'produce'
        ? requiredQty
        : Math.min(requiredQty, Math.floor(Number(variant.available) || 0));
      const clamped = Math.min(variantMax, qty);
      if (!clamped) return;
      plan.totalSelected += clamped;
      if (variant.type === 'produce') {
        plan.produceQty += clamped;
      } else {
        plan.stock.push({
          variantKey: variant.key,
          qty: clamped,
          productId: Number(variant.product?.id),
          productName: variant.product?.nome || '',
          productCode: variant.product?.codigo || '',
          processName: variant.stage?.processName || '',
          lastItemName: variant.stage?.lastItemName || '',
          order: Number(variant.stage?.order || 0),
          isCurrentProduct: !!variant.isCurrentProduct,
          committed: true
        });
      }
      plan.selections.push({ key: variant.key, qty: clamped, committed: true });
    });
    plan.remaining = Math.max(0, requiredQty - plan.totalSelected);
    plan.stock.sort((a, b) => {
      if ((b.order || 0) !== (a.order || 0)) return (b.order || 0) - (a.order || 0);
      if ((b.qty || 0) !== (a.qty || 0)) return (b.qty || 0) - (a.qty || 0);
      return (a.productId || 0) - (b.productId || 0);
    });
    return plan;
  }

  function buildOriginalPlanFromRow(row) {
    const requiredQty = getRequiredQuantity(row);
    const plan = {
      requiredQty,
      totalSelected: 0,
      remaining: requiredQty,
      produceQty: 0,
      stock: []
    };

    const breakdown = Array.isArray(row?.stockBreakdown) ? row.stockBreakdown.slice() : [];
    breakdown.sort((a, b) => (b.order || 0) - (a.order || 0));
    breakdown.forEach(entry => {
      if (plan.totalSelected >= requiredQty) return;
      const available = Math.max(0, Math.floor(Number(entry?.available || 0)));
      if (!available) return;
      const remaining = Math.max(0, requiredQty - plan.totalSelected);
      if (!remaining) return;
      const qty = Math.min(available, remaining);
      plan.stock.push({
        variantKey: `stock-${row?.produto_id}-${entry?.key ?? `${entry?.order || 0}`}`,
        qty,
        productId: Number(row?.produto_id),
        productName: row?.nome || '',
        productCode: row?.codigo || '',
        processName: entry?.processName || '',
        lastItemName: entry?.lastItemName || '',
        order: Number(entry?.order || 0),
        isCurrentProduct: true
      });
      plan.totalSelected += qty;
    });

    const plannedProduction = Math.max(0, Math.floor(Number(row?.produzir_parcial || 0) + Number(row?.produzir_total || 0)));
    if (plannedProduction > 0) {
      const produceQty = Math.min(plannedProduction, Math.max(0, requiredQty - plan.totalSelected));
      if (produceQty > 0) {
        plan.produceQty = produceQty;
        plan.totalSelected += produceQty;
      }
    }

    plan.remaining = Math.max(0, requiredQty - plan.totalSelected);
    return plan;
  }

  function buildVariantSummaryListHTML(items, row, options = {}) {
    if (!Array.isArray(items) || !items.length) return '';
    const renderedItems = [];
    const requiredQty = getRequiredQuantity(row);
    const showCurrentBadge = options?.showCurrentBadge;
    items.forEach(item => {
      const isCurrent = !!item.isCurrentProduct;
      const badge = isCurrent && showCurrentBadge
        ? '<span class="inline-flex items-center gap-1 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-400/40 rounded-full px-2 py-0.5">Peça atual</span>'
        : '';
      renderedItems.push(`
        <li class="flex flex-wrap items-center gap-3 text-xs text-gray-300">
          <div class="flex-1 min-w-[160px]">
            <p class="text-white font-medium">${item.lastItemName || 'Tipo de estoque'}</p>
            <p class="text-[11px] text-gray-400">${item.processName || ''}</p>
          </div>
          <div class="flex items-center gap-2 text-white">
            <span class="badge-neutral px-2 py-0.5 rounded text-[11px]">${item.qty.toLocaleString('pt-BR')} un</span>
            ${badge}
          </div>
        </li>`);
    });
    if (!renderedItems.length) return '';
    const needsScroll = renderedItems.length > 3;
    const listClasses = ['space-y-3'];
    if (needsScroll) {
      listClasses.push('max-h-60', 'overflow-y-auto', 'pr-1', 'modal-scroll');
    }
    return `<ul class="${listClasses.join(' ')}">${renderedItems.join('')}</ul>`;
  }

  function buildProduceSummaryHTML(quantity, label = 'Produzir do zero') {
    const qty = Number(quantity || 0);
    if (!(qty > 0)) return '';
    return `
      <div class="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-white font-semibold">${label}</p>
          <p class="text-xs text-gray-300">Quantidade planejada para produção.</p>
        </div>
        <span class="badge-warning px-2 py-1 rounded text-xs whitespace-nowrap">${qty.toLocaleString('pt-BR')} un</span>
      </div>`;
  }

  // Controle dos contadores exibidos no cabeçalho de seleção.
  function updateSelectionStatusCounter(selected, required, remaining) {
    if (!replaceModalRefs) return;
    if (replaceModalRefs.selectionCounter) {
      replaceModalRefs.selectionCounter.textContent = `Selecionado: ${selected.toLocaleString('pt-BR')} / ${required.toLocaleString('pt-BR')}`;
    }
    if (replaceModalRefs.selectionRemaining) {
      replaceModalRefs.selectionRemaining.textContent = `Restante: ${remaining.toLocaleString('pt-BR')}`;
    }
  }

  function enforceSelectionLimits(requiredQty) {
    const selections = ensureSelectionMap();
    const keys = Array.from(selections.keys());
    keys.forEach(key => {
      const qty = selections.get(key);
      const variant = getVariantByKey(key);
      if (!variant) {
        selections.delete(key);
        return;
      }
      const max = computeVariantMax(variant, requiredQty);
      if (qty > max) selections.set(key, max);
    });
  }

  function handleCommitSelection() {
    const row = replaceModalState.currentRow;
    if (!row) return;
    const selections = ensureSelectionMap();
    const requiredQty = getRequiredQuantity(row);
    const entries = Array.from(selections.entries()).filter(([, qty]) => qty > 0);
    if (!entries.length) return;
    entries.forEach(([key, qty]) => {
      const variant = getVariantByKey(key);
      if (!variant) return;
      const max = computeVariantMax(variant, requiredQty);
      const clamped = Math.min(qty, max);
      if (clamped > 0) addCommittedQuantity(key, clamped);
    });
    replaceModalState.selections = new Map();
    replaceModalState.activeVariantKey = null;
    updateReplaceModalConfirmButton();
    updateCommitButtonState();
    renderReplaceModalList({ skipReload: true });
  }

  // Botão de commit visível apenas quando há seleções pendentes (estado "pendente").
  function updateCommitButtonState() {
    if (!replaceModalRefs || !replaceModalRefs.commitBtn) return;
    const selections = ensureSelectionMap();
    const hasPending = Array.from(selections.values()).some(qty => sanitizePositiveInt(qty) > 0);
    replaceModalRefs.commitBtn.classList.toggle('hidden', !hasPending);
  }

  function setReplaceModalField(field, value) {
    if (!replaceModalRefs) return;
    replaceModalRefs.overlay.querySelectorAll(`[data-field="${field}"]`).forEach(el => {
      el.textContent = value ?? '';
    });
  }

  // Atualização da seção "Peça Atual" e da lista "Seleção atual" conforme o estado.
  function renderReplaceModalSummary() {
    const row = replaceModalState.currentRow;
    if (!row) return;
    const toNumber = value => {
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    };
    const formatNumber = value => toNumber(value).toLocaleString('pt-BR');
    setReplaceModalField('piece-name', row.nome || 'Peça sem nome');
    const qtd = toNumber(row.qtd || row.quantidade || 0);
    setReplaceModalField('piece-qty', `${formatNumber(qtd)} unidades`);
    const estoqueTotal = toNumber(row.em_estoque);
    const prontas = toNumber(row.pronta);
    const produzirParcial = toNumber(row.produzir_parcial);
    const produzirTotal = toNumber(row.produzir_total);
    setReplaceModalField('piece-stock-total', `${formatNumber(estoqueTotal)} un`);
    setReplaceModalField('piece-ready', `${formatNumber(prontas)} un`);
    setReplaceModalField('piece-produce-partial', `${formatNumber(produzirParcial)} un`);
    setReplaceModalField('piece-produce-total', `${formatNumber(produzirTotal)} un`);
    const subtitle = ctx.numero ? `Orçamento ${ctx.numero}` : (ctx.cliente || '');
    setReplaceModalField('modal-subtitle', subtitle);
    const detailsText = `${formatNumber(qtd)} unidade${qtd === 1 ? '' : 's'} necessárias no orçamento.`;
    setReplaceModalField('piece-details', detailsText);

    const breakdownContainer = replaceModalRefs?.stockBreakdown;
    if (breakdownContainer) {
      const originalPlan = replaceModalState.originalPlan;
      const stockList = Array.isArray(originalPlan?.stock) ? originalPlan.stock : [];
      const hasStockSelections = stockList.some(item => Number(item?.qty || 0) > 0);
      const produceQty = Number(originalPlan?.produceQty || 0);
      const requiredQty = Number(originalPlan?.requiredQty || 0);
      const totalSelected = Number(originalPlan?.totalSelected || 0);
      if (hasStockSelections || produceQty > 0) {
        const autoRemainingClass = requiredQty === totalSelected ? 'text-emerald-300' : 'text-amber-300';
        let content = `
          <div class="flex items-center justify-between text-sm text-white font-semibold">
            <span>Seleção automática</span>
            <span>${totalSelected.toLocaleString('pt-BR')} de ${requiredQty.toLocaleString('pt-BR')} un</span>
          </div>`;
        const autoListHtml = buildVariantSummaryListHTML(stockList, row, { showCurrentBadge: true });
        if (autoListHtml) content += autoListHtml;
        const produceHtml = buildProduceSummaryHTML(produceQty);
        if (produceHtml) content += produceHtml;
        const remainingAuto = Math.max(0, requiredQty - totalSelected).toLocaleString('pt-BR');
        content += `
          <p class="text-xs text-gray-300 border-t border-white/10 pt-2 mt-2">Restante planejado: <span class="${autoRemainingClass} font-semibold">${remainingAuto} un</span></p>`;
        breakdownContainer.innerHTML = content;
      } else {
        breakdownContainer.innerHTML = '<p class="text-xs text-gray-500">Nenhuma seleção automática registrada para esta peça.</p>';
      }
    }

    const selectionContainer = replaceModalRefs?.selectionSummary;
    if (selectionContainer) {
      const plan = buildSelectionPlan(row);
      if (plan.totalSelected > 0) {
        selectionContainer.classList.remove('hidden');
        let html = `
          <div class="flex items-center justify-between text-sm text-white font-semibold">
            <span>Seleção atual</span>
            <span>${plan.totalSelected.toLocaleString('pt-BR')} de ${plan.requiredQty.toLocaleString('pt-BR')} un</span>
          </div>`;
        const listHtml = buildVariantSummaryListHTML(plan.stock, row, { showCurrentBadge: true });
        if (listHtml) html += listHtml;
        const produceHtml = buildProduceSummaryHTML(plan.produceQty);
        if (produceHtml) html += produceHtml;
        selectionContainer.innerHTML = html;
      } else {
        selectionContainer.classList.add('hidden');
        selectionContainer.innerHTML = '';
      }
    }
  }

  async function ensureProductList() {
    if (replaceModalState.productListLoaded) return replaceModalState.productList;
    try {
      const produtos = await (window.electronAPI?.listarProdutos?.() ?? []);
      replaceModalState.productList = Array.isArray(produtos) ? produtos : [];
      replaceModalState.productListLoaded = true;
    } catch (err) {
      console.error('Erro ao listar produtos', err);
      replaceModalState.productList = [];
      replaceModalState.productListLoaded = true;
    }
    return replaceModalState.productList;
  }

  // Renderização e ciclo de vida da lista de variantes (idle/pendente/confirmado).
  async function renderReplaceModalList({ skipReload = false, forceReload = false } = {}) {
    const container = replaceModalRefs?.results;
    if (!container) return;
    const row = replaceModalState.currentRow;
    if (!row) return;
    const requiredQty = getRequiredQuantity(row);
    if (!replaceModalState.selections || !(replaceModalState.selections instanceof Map)) {
      replaceModalState.selections = new Map();
    }
    const productList = await ensureProductList();
    const rowProductId = Number(row.produto_id || 0);
    const normalizeCode = code => String(code || '').trim().toUpperCase();
    const rowProductCode = normalizeCode(row.codigo);
    if (!skipReload && (!replaceModalState.variants.length || replaceModalState.variantsLoadedForRowId !== rowProductId || forceReload)) {
      replaceModalState.variants = [];
      const loadPromise = (async () => {
        const candidates = [];
        if (rowProductId) {
          const sameId = productList.find(prod => Number(prod.id) === rowProductId);
          if (sameId) candidates.push(sameId);
        }
        if (rowProductCode) {
          productList.filter(prod => normalizeCode(prod.codigo) === rowProductCode).forEach(prod => {
            if (!candidates.includes(prod)) candidates.push(prod);
          });
        }
        if (row.nome) {
          const groupKey = buildGroupKey(row.nome, row.produto_id);
          productList.filter(prod => buildGroupKey(prod.nome, prod.id) === groupKey).forEach(prod => {
            if (!candidates.includes(prod)) candidates.push(prod);
          });
        }
        if (!candidates.length) {
          candidates.push(...productList);
        }
        const unique = new Map();
        candidates.forEach(prod => unique.set(prod.id, prod));
        const variantList = [];
        for (const prod of unique.values()) {
          const breakdown = await loadProductBreakdown(prod);
          breakdown.forEach(point => {
            variantList.push({
              key: `stock-${prod.id}-${point.key}`,
              type: 'stock',
              product: prod,
              stage: point,
              available: Math.max(0, Number(point.available || 0)),
              isCurrentProduct: Number(prod.id) === Number(row.produto_id)
            });
          });
        }
        const produceVariant = {
          key: 'produce-new',
          type: 'produce',
          available: requiredQty,
          stage: null,
          product: null,
          isCurrentProduct: false
        };
        const dedup = new Map();
        variantList.forEach(v => dedup.set(v.key, v));
        dedup.set(produceVariant.key, produceVariant);
        const sorted = Array.from(dedup.values()).sort((a, b) => {
          if (a.type !== b.type) return a.type === 'stock' ? -1 : 1;
          if (a.type === 'stock' && b.type === 'stock') {
            if (a.isCurrentProduct && !b.isCurrentProduct) return -1;
            if (!a.isCurrentProduct && b.isCurrentProduct) return 1;
            const orderDiff = (b.stage?.order || 0) - (a.stage?.order || 0);
            if (orderDiff !== 0) return orderDiff;
            return (b.available || 0) - (a.available || 0);
          }
          return 0;
        });
        replaceModalState.variants = sorted;
        replaceModalState.variantsLoadedForRowId = rowProductId;
        return sorted;
      })();
      replaceModalState.loadingVariants = loadPromise;
      try {
        await loadPromise;
      } finally {
        replaceModalState.loadingVariants = null;
      }
      if (replaceModalState.initialSelections) {
        const merged = [];
        let runningTotal = 0;
        replaceModalState.initialSelections.forEach(sel => {
          const variant = getVariantByKey(sel.key);
          if (!variant) return;
          const sanitized = sanitizePositiveInt(sel.qty);
          if (!sanitized) return;
          const baseMax = variant.type === 'produce'
            ? requiredQty
            : Math.min(requiredQty, Math.floor(Number(variant.available) || 0));
          const remaining = Math.max(0, requiredQty - runningTotal);
          if (!remaining) return;
          const clamped = Math.min(baseMax, sanitized, remaining);
          if (!clamped) return;
          merged.push({ key: variant.key, qty: clamped });
          runningTotal += clamped;
        });
        const aggregate = new Map();
        merged.forEach(entry => {
          aggregate.set(entry.key, (aggregate.get(entry.key) || 0) + entry.qty);
        });
        replaceModalState.committedSelections = Array.from(aggregate.entries())
          .map(([key, qty]) => ({ key, qty }));
        replaceModalState.selections = new Map();
        replaceModalState.initialSelections = null;
      }
    } else if (replaceModalState.loadingVariants) {
      try { await replaceModalState.loadingVariants; }
      catch (err) { console.error(err); }
    }

    enforceSelectionLimits(requiredQty);

    const searchTerm = normalizeText(replaceModalState.searchTerm || '');
    const variants = replaceModalState.variants.slice();
    const produceVariant = variants.find(v => v.type === 'produce') || null;
    const stockVariants = variants.filter(v => v.type === 'stock');
    const filteredStock = searchTerm
      ? stockVariants.filter(variant => {
          const texts = [
            normalizeText(variant.stage?.processName || ''),
            normalizeText(variant.stage?.lastItemName || ''),
            normalizeText(variant.product?.codigo || ''),
            normalizeText(variant.product?.nome || '')
          ];
          return texts.some(text => text.includes(searchTerm));
        })
      : stockVariants;

    container.innerHTML = '';
    const plan = buildSelectionPlan(row);
    const confirmedTotal = plan.totalSelected;
    const info = document.createElement('div');
    info.className = 'mb-4 text-sm text-gray-300 space-y-1';
    const selectionClass = confirmedTotal === requiredQty ? 'text-emerald-300' : 'text-amber-300';
    info.innerHTML = `
      <p class="text-gray-200">Quantidade orçada: <span class="text-white font-semibold">${requiredQty.toLocaleString('pt-BR')}</span> un</p>
      <p class="text-xs text-gray-400">Use os botões de + e - para preparar a quantidade e confirme cada tipo para somar ao total.</p>
      <p class="text-xs ${selectionClass}">Confirmado: ${confirmedTotal.toLocaleString('pt-BR')} / ${requiredQty.toLocaleString('pt-BR')} un</p>`;
    container.appendChild(info);

    if (!stockVariants.length) {
      const alert = document.createElement('p');
      alert.className = 'text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-4';
      alert.textContent = 'Nenhum ponto de estoque foi encontrado para esta peça. Utilize a produção para atender o orçamento.';
      container.appendChild(alert);
    } else if (!filteredStock.length) {
      const alert = document.createElement('p');
      alert.className = 'text-xs text-gray-400 mb-4';
      alert.textContent = 'Nenhum tipo corresponde aos filtros aplicados.';
      container.appendChild(alert);
    }

    const variantsToRender = [...filteredStock];
    if (produceVariant) variantsToRender.push(produceVariant);

    const committedTotalOverall = getTotalCommittedQuantity();
    const remainingGlobalCapacity = Math.max(0, requiredQty - committedTotalOverall);
    updateSelectionStatusCounter(committedTotalOverall, requiredQty, remainingGlobalCapacity);

    variantsToRender.forEach(variant => {
      const committedQty = getCommittedQuantity(variant.key);
      const stagingQty = getSelectionQuantity(variant.key);
      const variantMax = computeVariantMax(variant, requiredQty);
      const isStaging = stagingQty > 0;
      const card = document.createElement('article');
      card.className = 'w-full bg-surface/40 border border-white/10 rounded-xl px-4 py-4 transition focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/40 mb-3 last:mb-0';
      card.setAttribute('data-variant-key', variant.key);
      const variantLabel = variant.type === 'stock'
        ? (variant.stage?.lastItemName || 'Tipo de estoque')
        : 'Produção';
      if (isStaging) {
        card.classList.add('border-primary', 'ring-2', 'ring-primary/50', 'bg-primary/10');
      } else if (committedQty > 0) {
        card.classList.add('border-primary/40', 'bg-primary/5');
      }

      const confirmedChip = committedQty > 0
        ? `<span class="inline-flex items-center gap-1 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-400/40 rounded-full px-2 py-1" data-role="confirmed-chip">Confirmadas: ${committedQty.toLocaleString('pt-BR')} un</span>`
        : '';
      const stockLimit = getVariantStockLimit(variant, requiredQty);
      const stockAvailable = Math.max(0, stockLimit - committedQty);
      const globalAllowance = Math.max(0, remainingGlobalCapacity + stagingQty);

      let headerHtml = '';
      let limitHint = '';
      if (variant.type === 'stock') {
        const process = variant.stage?.processName || 'Processo não informado';
        const lastItem = variant.stage?.lastItemName || 'Sem último insumo';
        const productCode = variant.product?.codigo ? `<p class="text-xs text-gray-500 mt-1">Código: ${variant.product.codigo}</p>` : '';
        const badgeClass = stockAvailable > 0 ? 'badge-success' : 'badge-danger';
        const badgeLabel = `${stockAvailable.toLocaleString('pt-BR')} un disponíveis`;
        headerHtml = `
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-white font-semibold">${lastItem}</p>
              <p class="text-xs text-gray-400">${process}</p>
              ${productCode}
            </div>
            <div class="flex flex-col items-end gap-2 text-right">
              ${confirmedChip}
              <span class="${badgeClass} px-2 py-1 rounded text-xs">${badgeLabel}</span>
            </div>
          </div>`;
        limitHint = `Estoque: ${stockAvailable.toLocaleString('pt-BR')} • Orçamento: ${globalAllowance.toLocaleString('pt-BR')} un`;
      } else {
        headerHtml = `
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-white font-semibold">Produzir do zero</p>
              <p class="text-xs text-gray-400 mt-1">Defina o total que deverá seguir para produção.</p>
            </div>
            <div class="flex flex-col items-end gap-2 text-right">
              ${confirmedChip}
              <span class="badge-warning px-2 py-1 rounded text-xs">Orçamento: ${globalAllowance.toLocaleString('pt-BR')} un</span>
            </div>
          </div>`;
        limitHint = `Orçamento disponível: ${globalAllowance.toLocaleString('pt-BR')} un`;
      }

      const plusDisabled = variantMax <= 0 || stagingQty >= variantMax;
      const minusDisabled = isStaging ? stagingQty <= 0 : committedQty <= 0;
      const confirmDisabled = !(isStaging && stagingQty > 0 && stagingQty <= variantMax);
      const confirmText = isStaging
        ? `Confirmar ${stagingQty.toLocaleString('pt-BR')} un`
        : 'Confirmar';
      const minusAriaLabel = isStaging
        ? `Remover unidade em edição para ${variantLabel}`
        : `Remover unidade confirmada de ${variantLabel}`;
      const plusAriaLabel = `Adicionar unidade para ${variantLabel}`;

      const confirmAria = isStaging
        ? `Confirmar ${stagingQty.toLocaleString('pt-BR')} unidades em ${variantLabel}`
        : `Confirmar seleção de ${variantLabel}`;

      card.innerHTML = `
        ${headerHtml}
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <button type="button" class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-white text-sm flex items-center justify-center ${minusDisabled ? 'opacity-40 cursor-not-allowed' : ''}" data-role="decrement" ${minusDisabled ? 'disabled' : ''} aria-label="${minusAriaLabel}">-</button>
            <input type="number" inputmode="numeric" min="0" class="w-20 h-8 text-center bg-white/5 border border-white/10 rounded-lg text-white leading-[32px]" data-role="quantity-input" data-variant-key="${variant.key}" value="${stagingQty}" max="${Math.max(stagingQty, variantMax)}" aria-label="Quantidade em edição para ${variantLabel}" />
            <button type="button" class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-white text-sm flex items-center justify-center ${plusDisabled ? 'opacity-40 cursor-not-allowed' : ''}" data-role="increment" ${plusDisabled ? 'disabled' : ''} aria-label="${plusAriaLabel}">+</button>
          </div>
          <button type="button" class="px-3 py-1 rounded-lg text-xs font-medium text-white ${confirmDisabled ? 'btn-primary opacity-60 cursor-not-allowed' : 'btn-primary'}" data-role="confirm" data-variant-key="${variant.key}" ${confirmDisabled ? 'disabled' : ''} aria-label="${confirmAria}">${confirmText}</button>
          <span class="text-xs text-gray-400 ml-auto">${limitHint}</span>
        </div>`;

      const decrementBtn = card.querySelector('[data-role="decrement"]');
      if (decrementBtn) {
        decrementBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const currentStaging = getSelectionQuantity(variant.key);
          if (currentStaging > 0) {
            const next = Math.max(0, currentStaging - 1);
            updateStagingQuantityForVariant(variant, next, { focus: { key: variant.key, select: true } });
          } else {
            reduceConfirmedQuantity(variant.key, 1);
            renderReplaceModalList({ skipReload: true });
          }
        });
      }

      const incrementBtn = card.querySelector('[data-role="increment"]');
      if (incrementBtn) {
        incrementBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const next = getSelectionQuantity(variant.key) + 1;
          updateStagingQuantityForVariant(variant, next, { focus: { key: variant.key, select: true } });
          renderReplaceModalList({ skipReload: true });
        });
      }

      const input = card.querySelector('input[data-role="quantity-input"]');
      if (input) {
        input.addEventListener('focus', () => setActiveVariantKey(variant.key));
        input.addEventListener('blur', () => clearActiveVariantKeyIfMatches(variant.key));
        input.addEventListener('change', e => {
          const value = sanitizePositiveInt(e.target.value);
          updateStagingQuantityForVariant(variant, value, { focus: { key: variant.key } });
          renderReplaceModalList({ skipReload: true });
        });
      }

      const confirmBtn = card.querySelector('[data-role="confirm"]');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          confirmStagingForVariant(variant.key);
        });
      }

      container.appendChild(card);
    });
  }

  function updateReplaceModalConfirmButton() {
    if (!replaceModalRefs || !replaceModalRefs.confirmBtn) return;
    const row = replaceModalState.currentRow;
    if (!row) return;
    const plan = buildSelectionPlan(row);
    const canConfirm = plan.requiredQty > 0 && plan.totalSelected === plan.requiredQty;
    const btn = replaceModalRefs.confirmBtn;
    btn.disabled = !canConfirm;
    btn.classList.toggle('opacity-60', !canConfirm);
    btn.classList.toggle('cursor-not-allowed', !canConfirm);
  }

  const handleReplaceModalPointerDown = e => {
    if (!hasPendingSelections()) return;
    const activeKey = getActiveVariantKey();
    if (!activeKey) return;
    const target = e.target;
    const card = target ? target.closest('[data-variant-key]') : null;
    if (card && card.getAttribute('data-variant-key') === activeKey) return;
    setTimeout(() => {
      if (getSelectionQuantity(activeKey) > 0) {
        clearStagingForVariant(activeKey);
        renderReplaceModalList({ skipReload: true });
      }
    }, 0);
  };

  function handleKeydown(e) {
    if (e.key !== 'Escape') return;
    if (hasPendingSelections()) {
      if (clearAllStaging()) {
        renderReplaceModalList({ skipReload: true });
      }
      return;
    }
    closeModal();
  }

  function handleReplaceModalConfirm() {
    const row = replaceModalState.currentRow;
    if (!row) return;
    const plan = buildSelectionPlan(row);
    if (plan.requiredQty <= 0 || plan.totalSelected !== plan.requiredQty) return;

    const forceProduceAll = plan.produceQty >= plan.requiredQty && plan.stock.length === 0;
    let selectedProduct = null;
    if (plan.stock.length) {
      const primary = plan.stock[0];
      const variant = getVariantByKey(primary.variantKey);
      if (variant?.product) {
        selectedProduct = {
          id: Number(variant.product.id),
          nome: variant.product.nome,
          codigo: variant.product.codigo,
          preco_venda: Number(variant.product.preco_venda || 0)
        };
      }
    }

    // Comunicação entre modais via evento customizado.
    window.dispatchEvent(new CustomEvent('pecas:substituidas', {
      detail: {
        source: 'orcamento-substituir-peca',
        rowIndex: replaceModalState.rowIndex,
        plan,
        selectedProduct,
        forceProduceAll,
        rowId: replaceModalState.currentRow?.produto_id ?? null
      }
    }));

    closeModal();
  }

  replaceModalRefs.confirmBtn?.addEventListener('click', handleReplaceModalConfirm);
  replaceModalRefs.commitBtn?.addEventListener('click', handleCommitSelection);
  replaceModalRefs.modal?.addEventListener('pointerdown', handleReplaceModalPointerDown);
  replaceModalRefs.search?.addEventListener('input', async e => {
    replaceModalState.searchTerm = e.target.value || '';
    await renderReplaceModalList({ skipReload: true });
  });

  document.addEventListener('keydown', handleKeydown);

  // Rotina de abertura: carrega catálogo, estados iniciais e renderiza o modal.
  const prepareModal = async () => {
    await ensureProductList();
    replaceModalState.searchTerm = '';
    replaceModalState.variants = [];
    replaceModalState.selections = new Map();
    replaceModalState.activeVariantKey = null;
    replaceModalState.loadingVariants = null;
    replaceModalState.variantsLoadedForRowId = null;
    replaceModalState.originalPlan = null;
    replaceModalState.initialSelections = Array.isArray(baseRow.replacementPlan?.selections)
      ? baseRow.replacementPlan.selections.map(sel => ({ key: sel.key, qty: sel.qty }))
      : null;
    clearCommittedSelections();
    replaceModalState.originalPlan = buildOriginalPlanFromRow(baseRow);
    renderReplaceModalSummary();
    await renderReplaceModalList({ forceReload: true });
    updateReplaceModalConfirmButton();
    updateCommitButtonState();
  };

  try {
    if (typeof window.withModalLoading === 'function') {
      await window.withModalLoading(1000, prepareModal);
    } else {
      await prepareModal();
    }
  } finally {
    markReady();
    requestAnimationFrame(() => {
      if (replaceModalRefs.search) replaceModalRefs.search.focus();
      else replaceModalRefs.modal?.focus();
    });
  }
})();
