(function(){
  const overlayId = 'converterReplaceModal';
  const overlay = document.getElementById('converterReplaceModalOverlay');
  if (!overlay) return;

  const context = window.OrcamentoReplaceModalContext || {};
  delete window.OrcamentoReplaceModalContext;

  const rows = Array.isArray(context.rows) ? context.rows : [];
  let listaProdutos = Array.isArray(context.getListaProdutos?.())
    ? context.getListaProdutos()
    : (Array.isArray(context.listaProdutos) ? context.listaProdutos : []);

  const syncListaProdutos = value => {
    listaProdutos = Array.isArray(value) ? value : [];
    if (typeof context.setListaProdutos === 'function') {
      context.setListaProdutos(listaProdutos);
    }
  };

  const getListaProdutos = () => {
    if (typeof context.getListaProdutos === 'function') {
      const latest = context.getListaProdutos();
      if (Array.isArray(latest)) listaProdutos = latest;
    }
    return listaProdutos;
  };

  const carregarProdutos = typeof context.carregarProdutos === 'function'
    ? async () => {
        const result = await context.carregarProdutos();
        if (Array.isArray(result)) syncListaProdutos(result);
        else syncListaProdutos(getListaProdutos());
        return getListaProdutos();
      }
    : async () => getListaProdutos();

  const ctx = context.ctx || {};
  const recomputeStocks = typeof context.recomputeStocks === 'function' ? context.recomputeStocks : () => {};
  const renderRows = typeof context.renderRows === 'function' ? context.renderRows : () => {};
  const validate = typeof context.validate === 'function' ? context.validate : () => {};
  const computeInsumosAndRender = typeof context.computeInsumosAndRender === 'function'
    ? context.computeInsumosAndRender
    : () => {};
  let currentReplaceIndex = Number.isFinite(context.index) ? Number(context.index) : -1;
  const onClose = typeof context.onClose === 'function' ? context.onClose : () => {};

  let readySignaled = false;
  const markReady = (reveal = true) => {
    if (!overlay || !overlay.classList) {
      if (!readySignaled && typeof Modal?.signalReady === 'function') {
        readySignaled = true;
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

    if (!readySignaled) {
      readySignaled = true;
      overlay.dataset.modalReady = 'true';
      overlay.removeAttribute('data-modal-loading');
      if (typeof Modal?.signalReady === 'function') {
        Modal.signalReady(overlayId);
      }
    }
  };

  let replaceModalRefs = null;
  let closeNotified = false;
  const replaceModalState = {
    searchTerm: '',
    variants: [],
    selections: new Map(),
    initialSelections: null,
    loadingVariants: null,
    variantsLoadedForRowId: null,
    originalPlan: null,
    committedSelections: [],
    activeVariantKey: null
  };
  const productBreakdownCache = new Map();

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

  const getVariantByKey = key => replaceModalState.variants.find(v => v.key === key) || null;

  function ensureSelectionMap() {
    if (!replaceModalState.selections || !(replaceModalState.selections instanceof Map)) {
      replaceModalState.selections = new Map();
    }
    return replaceModalState.selections;
  }

  function ensureCommittedList() {
    if (!Array.isArray(replaceModalState.committedSelections)) {
      replaceModalState.committedSelections = [];
    }
    return replaceModalState.committedSelections;
  }

  function setActiveVariantKey(key) {
    replaceModalState.activeVariantKey = key || null;
  }

  function getActiveVariantKey() {
    return replaceModalState.activeVariantKey || null;
  }

  function clearActiveVariantKeyIfMatches(key) {
    if (!key) return;
    if (replaceModalState.activeVariantKey === key) {
      replaceModalState.activeVariantKey = null;
    }
  }

  function hasPendingSelections() {
    const selections = ensureSelectionMap();
    for (const qty of selections.values()) {
      if (sanitizePositiveInt(qty) > 0) return true;
    }
    return false;
  }

  function clearPendingSelections() {
    return clearAllStaging();
  }

  function getCommittedQuantity(key) {
    if (!key) return 0;
    const list = ensureCommittedList();
    const entry = list.find(item => item?.key === key);
    return sanitizePositiveInt(entry?.qty);
  }

  function setCommittedQuantity(key, quantity) {
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
  }

  function addCommittedQuantity(key, quantity) {
    if (!key) return;
    const current = getCommittedQuantity(key);
    const total = current + sanitizePositiveInt(quantity);
    setCommittedQuantity(key, total);
  }

  function clearCommittedSelections() {
    replaceModalState.committedSelections = [];
  }

  function getRequiredQuantity(row) {
    return Number(row?.qtd || row?.quantidade || 0) || 0;
  }

  function getTotalConfirmedQuantity() {
    return getTotalCommittedQuantity();
  }

  function getGlobalRemainingCapacity(requiredQty) {
    const confirmed = getTotalConfirmedQuantity();
    return Math.max(0, requiredQty - confirmed);
  }

  function getVariantStockLimit(variant, requiredQty) {
    if (!variant) return 0;
    if (variant.type === 'produce') return requiredQty;
    return Math.max(0, Math.floor(Number(variant.available) || 0));
  }

  function computeVariantMax(variant, requiredQty) {
    if (!variant) return 0;
    const confirmedQty = getCommittedQuantity(variant.key);
    const stagingQty = getSelectionQuantity(variant.key);
    const stockLimit = getVariantStockLimit(variant, requiredQty);
    const stockRemaining = Math.max(0, stockLimit - confirmedQty);
    const globalRemaining = getGlobalRemainingCapacity(requiredQty);
    const effectiveGlobal = Math.max(0, globalRemaining + stagingQty);
    return Math.max(0, Math.min(stockRemaining, effectiveGlobal));
  }

  function setStagingQuantity(key, quantity) {
    const selections = ensureSelectionMap();
    const sanitized = sanitizePositiveInt(quantity);
    if (sanitized > 0) {
      selections.set(key, sanitized);
      setActiveVariantKey(key);
    } else {
      selections.delete(key);
      clearActiveVariantKeyIfMatches(key);
    }
  }

  function clearOtherStaging(currentKey) {
    const selections = ensureSelectionMap();
    let changed = false;
    selections.forEach((qty, key) => {
      if (key !== currentKey) {
        selections.delete(key);
        changed = true;
      }
    });
    if (changed && currentKey) setActiveVariantKey(currentKey);
    return changed;
  }

  function clearStagingForVariant(key) {
    const selections = ensureSelectionMap();
    if (selections.has(key)) {
      selections.delete(key);
      clearActiveVariantKeyIfMatches(key);
      return true;
    }
    clearActiveVariantKeyIfMatches(key);
    return false;
  }

  function clearAllStaging() {
    const selections = ensureSelectionMap();
    if (!selections.size) {
      clearActiveVariantKeyIfMatches(getActiveVariantKey());
      return false;
    }
    const hadPositive = Array.from(selections.values())
      .some(value => sanitizePositiveInt(value) > 0);
    selections.clear();
    clearActiveVariantKeyIfMatches(getActiveVariantKey());
    return hadPositive;
  }

  // Atualiza a quantidade em edição para o tipo informado e garante foco no campo apropriado.
  function updateStagingQuantityForVariant(variant, desiredQty, options = {}) {
    if (!variant) return;
    const row = rows[currentReplaceIndex];
    if (!row) return;
    const requiredQty = getRequiredQuantity(row);
    const sanitized = Math.max(0, Math.floor(Number(desiredQty) || 0));
    clearOtherStaging(variant.key);
    const maxAllowed = computeVariantMax(variant, requiredQty);
    const clamped = Math.min(maxAllowed, sanitized);
    if (clamped > 0) setStagingQuantity(variant.key, clamped);
    else clearStagingForVariant(variant.key);
    enforceSelectionLimits(requiredQty);
    const focus = options.focus ? { ...options.focus } : null;
    renderReplaceModalList({ skipReload: true, focus });
  }

  // Incrementa a quantidade em edição utilizando o botão de + e mantém o input selecionado.
  function incrementStagingQuantity(variant, step = 1) {
    if (!variant) return;
    const row = rows[currentReplaceIndex];
    if (!row) return;
    const requiredQty = getRequiredQuantity(row);
    const current = getSelectionQuantity(variant.key);
    const target = current + Math.max(1, step);
    const maxAllowed = computeVariantMax(variant, requiredQty);
    if (maxAllowed <= 0) return;
    clearOtherStaging(variant.key);
    const clamped = Math.min(maxAllowed, target);
    if (clamped > 0) setStagingQuantity(variant.key, clamped);
    enforceSelectionLimits(requiredQty);
    renderReplaceModalList({ skipReload: true, focus: { key: variant.key, select: true } });
  }

  // Move a quantidade em edição para o estado confirmado respeitando orçamento e estoque.
  function confirmStagingForVariant(variantKey) {
    if (!variantKey) return false;
    const variant = getVariantByKey(variantKey);
    if (!variant) return false;
    const row = rows[currentReplaceIndex];
    if (!row) return false;
    const requiredQty = getRequiredQuantity(row);
    if (!(requiredQty > 0)) return false;
    const stagingQty = getSelectionQuantity(variantKey);
    if (!(stagingQty > 0)) return false;
    const maxAllowed = computeVariantMax(variant, requiredQty);
    const finalQty = Math.min(stagingQty, maxAllowed);
    if (!(finalQty > 0)) return false;
    addCommittedQuantity(variantKey, finalQty);
    clearStagingForVariant(variantKey);
    enforceSelectionLimits(requiredQty);
    renderReplaceModalSummary();
    updateReplaceModalConfirmButton();
    renderReplaceModalList({ skipReload: true, focus: { key: variantKey } });
    return true;
  }

  // Diminui unidades já confirmadas quando o usuário pressiona o botão - fora do modo de edição.
  function reduceConfirmedQuantity(variantKey, amount = 1) {
    if (!variantKey) return false;
    const current = getCommittedQuantity(variantKey);
    if (!(current > 0)) return false;
    const next = Math.max(0, current - Math.max(1, amount));
    setCommittedQuantity(variantKey, next);
    renderReplaceModalSummary();
    updateReplaceModalConfirmButton();
    renderReplaceModalList({ skipReload: true, focus: { key: variantKey } });
    return true;
  }

  // Atualiza os contadores "Selecionado" e "Restante" exibidos acima da lista.
  function updateSelectionStatusCounter(selected, required, remaining) {
    if (!replaceModalRefs) return;
    if (replaceModalRefs.selectionCounter) {
      replaceModalRefs.selectionCounter.textContent = `Selecionado: ${selected.toLocaleString('pt-BR')} / ${required.toLocaleString('pt-BR')}`;
    }
    if (replaceModalRefs.selectionRemaining) {
      replaceModalRefs.selectionRemaining.textContent = `Restante: ${remaining.toLocaleString('pt-BR')}`;
    }
  }

  function getTotalCommittedQuantity() {
    const list = ensureCommittedList();
    return list.reduce((acc, entry) => acc + sanitizePositiveInt(entry?.qty), 0);
  }

  function getSelectionQuantity(key) {
    const selections = ensureSelectionMap();
    return sanitizePositiveInt(selections.get(key));
  }

  function enforceSelectionLimits(requiredQty) {
    const selections = ensureSelectionMap();
    if (!selections.size) return;

    const activeKey = getActiveVariantKey();
    let detectedActive = false;

    selections.forEach((qty, key) => {
      const variant = getVariantByKey(key);
      if (!variant) {
        selections.delete(key);
        return;
      }
      if (activeKey && key !== activeKey) {
        selections.delete(key);
        return;
      }
      const clamped = Math.min(computeVariantMax(variant, requiredQty), sanitizePositiveInt(qty));
      if (clamped > 0) {
        selections.set(key, clamped);
        setActiveVariantKey(key);
        detectedActive = true;
      } else {
        selections.delete(key);
      }
    });

    if (!detectedActive) {
      clearActiveVariantKeyIfMatches(activeKey);
    }
  }

  function buildSelectionPlan(row) {
    const requiredQty = Number(row?.qtd || row?.quantidade || 0) || 0;
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
    const requiredQty = Number(row?.qtd || row?.quantidade || 0) || 0;
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
    const { showCurrentBadge = false } = options;
    const renderedItems = [];
    items.forEach(item => {
      const qty = Number(item?.qty || 0);
      if (!(qty > 0)) return;
      const productName = item?.productName || row?.nome || 'Peça do orçamento';
      const productCode = item?.productCode ? String(item.productCode) : '';
      const processName = item?.processName || 'Processo não informado';
      const lastItem = item?.lastItemName || 'Sem último insumo';
      const isCurrent = !!(showCurrentBadge && item?.isCurrentProduct);
      const committedTag = item?.committed
        ? '<p class="text-[11px] text-emerald-300 uppercase tracking-wide">Seleção concluída</p>'
        : '';
      renderedItems.push(`
        <li class="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="space-y-1">
              <p class="text-xs text-gray-400 uppercase tracking-wide">Peça</p>
              <p class="text-white font-semibold leading-tight whitespace-pre-line break-words">${productName}</p>
              ${productCode ? `<p class="text-[11px] text-gray-500">Cód: ${productCode}</p>` : ''}
              ${isCurrent ? '<p class="text-[11px] text-gray-400 uppercase tracking-wide">Peça do orçamento</p>' : ''}
              ${committedTag}
            </div>
            <span class="badge-info px-2 py-1 rounded text-xs whitespace-nowrap">${qty.toLocaleString('pt-BR')} un</span>
          </div>
          <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-300">
            <p><span class="text-gray-400">Etapa:</span> ${processName}</p>
            <p><span class="text-gray-400">Último insumo:</span> ${lastItem}</p>
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

  const notifyClose = () => {
    if (closeNotified) return;
    closeNotified = true;
    try { onClose(); }
    catch (err) { console.error('Erro ao notificar fechamento do modal de substituição', err); }
  };

  function handleOverlayClick(event) {
    if (event.target !== overlay) return;
    if (hasPendingSelections()) {
      if (clearAllStaging()) {
        renderReplaceModalList({ skipReload: true });
      }
      return;
    }
    closeReplaceModal();
  }

  async function handleSearchInput(e) {
    replaceModalState.searchTerm = e.target.value || '';
    await renderReplaceModalList({ skipReload: true });
  }

  function ensureReplaceModal() {
    if (replaceModalRefs) return replaceModalRefs;
    if (!overlay) return null;
    const modal = overlay.querySelector('[data-role="modal"]');
    if (!modal) return null;

    replaceModalRefs = {
      overlay,
      modal,
      confirmBtn: overlay.querySelector('[data-action="confirm"]'),
      commitBtn: overlay.querySelector('[data-action="commit"]'),
      search: overlay.querySelector('[data-role="search"]'),
      results: overlay.querySelector('[data-role="results"]'),
      stockBreakdown: overlay.querySelector('[data-field="piece-stock-breakdown"]'),
      selectionSummary: overlay.querySelector('[data-field="piece-selection"]'),
      selectionCounter: overlay.querySelector('[data-field="selection-counter"]'),
      selectionRemaining: overlay.querySelector('[data-field="selection-remaining"]')
    };

    overlay.querySelectorAll('[data-action="close"]').forEach(btn => btn.addEventListener('click', closeReplaceModal));
    overlay.addEventListener('click', handleOverlayClick);
    replaceModalRefs.confirmBtn?.addEventListener('click', handleReplaceModalConfirm);
    replaceModalRefs.commitBtn?.addEventListener('click', handleCommitSelection);
    replaceModalRefs.modal?.addEventListener('pointerdown', handleReplaceModalPointerDown);
    if (replaceModalRefs.search) {
      replaceModalRefs.search.placeholder = 'Filtrar por processo, insumo ou código';
      replaceModalRefs.search.value = '';
    }
    replaceModalRefs.search?.addEventListener('input', handleSearchInput);
    document.addEventListener('keydown', handleReplaceModalKey);
    return replaceModalRefs;
  }

  function setReplaceModalField(field, value) {
    if (!replaceModalRefs) return;
    replaceModalRefs.overlay.querySelectorAll(`[data-field="${field}"]`).forEach(el => {
      el.textContent = value ?? '';
    });
  }

  async function openReplaceModal() {
    closeNotified = false;
    const refs = ensureReplaceModal();
    const index = currentReplaceIndex;
    if (!refs || index < 0) {
      markReady(false);
      notifyClose();
      Modal.close(overlayId);
      return;
    }
    const row = rows[index];
    if (!row) {
      markReady(false);
      notifyClose();
      Modal.close(overlayId);
      return;
    }

    const prepareModal = async () => {
      await (listaProdutos.length ? Promise.resolve() : carregarProdutos());
      replaceModalState.searchTerm = '';
      replaceModalState.variants = [];
      replaceModalState.selections = new Map();
      replaceModalState.activeVariantKey = null;
      replaceModalState.loadingVariants = null;
      replaceModalState.variantsLoadedForRowId = null;
      clearCommittedSelections();
      replaceModalState.initialSelections = Array.isArray(row.replacementPlan?.selections)
        ? row.replacementPlan.selections.map(sel => ({ key: sel.key, qty: sel.qty }))
        : null;
      const manualPlan = row.replacementPlan
        ? JSON.parse(JSON.stringify(row.replacementPlan))
        : null;
      const hasManualSelection = manualPlan
        && ((Array.isArray(manualPlan.stock) && manualPlan.stock.some(item => Number(item?.qty || 0) > 0))
          || Number(manualPlan.produceQty || 0) > 0
          || Number(manualPlan.totalSelected || 0) > 0);
      const autoPlan = buildOriginalPlanFromRow(row);
      const hasAutoSelection = autoPlan
        && ((Array.isArray(autoPlan.stock) && autoPlan.stock.some(item => Number(item?.qty || 0) > 0))
          || Number(autoPlan.produceQty || 0) > 0
          || Number(autoPlan.totalSelected || 0) > 0);
      replaceModalState.originalPlan = hasAutoSelection ? autoPlan : (hasManualSelection ? manualPlan : autoPlan);
      if (refs.search) refs.search.value = '';
      renderReplaceModalSummary();
      await renderReplaceModalList({ forceReload: true });
      updateReplaceModalConfirmButton();
    };

    try {
      if (typeof window.withModalLoading === 'function') {
        await window.withModalLoading(1000, prepareModal);
      } else {
        await prepareModal();
      }
      markReady();
      requestAnimationFrame(() => { refs.modal?.focus(); });
    } catch (err) {
      console.error('Erro ao preparar modal de substituição', err);
      markReady(false);
      closeReplaceModal();
    }
  }

  function closeReplaceModal(options = {}) {
    const { skipModalClose = false } = options || {};
    if (!overlay) {
      notifyClose();
      return;
    }

    if (replaceModalRefs) {
      overlay.querySelectorAll('[data-action="close"]').forEach(btn => btn.removeEventListener('click', closeReplaceModal));
      overlay.removeEventListener('click', handleOverlayClick);
      replaceModalRefs.confirmBtn?.removeEventListener('click', handleReplaceModalConfirm);
      replaceModalRefs.commitBtn?.removeEventListener('click', handleCommitSelection);
      replaceModalRefs.modal?.removeEventListener('pointerdown', handleReplaceModalPointerDown);
      replaceModalRefs.search?.removeEventListener('input', handleSearchInput);
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      if (replaceModalRefs.search) replaceModalRefs.search.value = '';
    }

    replaceModalState.searchTerm = '';
    replaceModalState.variants = [];
    replaceModalState.selections = new Map();
    replaceModalState.initialSelections = null;
    replaceModalState.loadingVariants = null;
    replaceModalState.variantsLoadedForRowId = null;
    replaceModalState.originalPlan = null;
    replaceModalState.activeVariantKey = null;
    clearCommittedSelections();
    updateSelectionStatusCounter(0, 0, 0);
    updateReplaceModalConfirmButton();
    updateCommitButtonState();
    document.removeEventListener('keydown', handleReplaceModalKey);
    replaceModalRefs = null;
    currentReplaceIndex = -1;
    notifyClose();

    if (!skipModalClose) {
      try { Modal.close(overlayId); }
      catch (err) { console.error('Erro ao fechar modal de substituição', err); }
    }
  }

  function handleReplaceModalKey(e) {
    if (e.key !== 'Escape') return;
    if (!replaceModalRefs || replaceModalRefs.overlay.classList.contains('hidden')) return;
    if (hasPendingSelections()) {
      if (clearAllStaging()) {
        renderReplaceModalList({ skipReload: true });
      }
      return;
    }
    closeReplaceModal();
  }

  function renderReplaceModalSummary() {
    if (!replaceModalRefs) return;
    const row = rows[currentReplaceIndex];
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

    const breakdownContainer = replaceModalRefs.stockBreakdown;
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

    const selectionContainer = replaceModalRefs.selectionSummary;
    if (selectionContainer) {
      const plan = buildSelectionPlan(row);
      if (plan.totalSelected > 0) {
        selectionContainer.classList.remove('hidden');
        const totalLabel = `${plan.totalSelected.toLocaleString('pt-BR')} de ${plan.requiredQty.toLocaleString('pt-BR')} un`;
        const remaining = Math.max(0, plan.remaining).toLocaleString('pt-BR');
        const remainingClass = plan.remaining === 0 ? 'text-emerald-300' : 'text-amber-300';
        let inner = `
          <div class="flex items-center justify-between text-sm text-white font-semibold">
            <span>Seleção atual</span>
            <span>${totalLabel}</span>
          </div>`;
        const selectionListHtml = buildVariantSummaryListHTML(plan.stock, row, { showCurrentBadge: true });
        if (selectionListHtml) inner += selectionListHtml;
        const produceHtml = buildProduceSummaryHTML(plan.produceQty);
        if (produceHtml) inner += produceHtml;
        inner += `
          <p class="text-xs text-gray-300 border-t border-white/10 pt-2 mt-2">Restante para atingir o orçado: <span class="${remainingClass} font-semibold">${remaining} un</span></p>`;
        selectionContainer.innerHTML = inner;
      } else {
        selectionContainer.classList.add('hidden');
        selectionContainer.innerHTML = '';
      }
    }
  }

  async function renderReplaceModalList(options = {}) {
    if (!replaceModalRefs) return;
    const { forceReload = false, skipReload = false, focus = null } = options;
    const container = replaceModalRefs.results;
    if (!container) return;
    const row = rows[currentReplaceIndex];
    if (!row) {
      container.innerHTML = '<p class="text-sm text-gray-400">Nenhuma peça selecionada.</p>';
      replaceModalState.variants = [];
      updateReplaceModalConfirmButton();
      updateCommitButtonState();
      updateSelectionStatusCounter(0, 0, 0);
      renderReplaceModalSummary();
      return;
    }

    const requiredQty = Number(row.qtd || row.quantidade || 0) || 0;
    if (!replaceModalState.selections || !(replaceModalState.selections instanceof Map)) {
      replaceModalState.selections = new Map();
    }

    const rowProductId = Number(row.produto_id || 0);
    const normalizeCode = code => String(code || '').trim().toUpperCase();
    const rowProductCode = normalizeCode(row.codigo);
    const needsReload = forceReload
      || (!skipReload && (!replaceModalState.variants.length || replaceModalState.variantsLoadedForRowId !== rowProductId));

    if (needsReload) {
      const loadPromise = (async () => {
        const products = getListaProdutos();
        const candidates = [];
        const groups = new Map();
        products.forEach(prod => {
          if (!prod) return;
          const code = normalizeCode(prod.codigo);
          if (code === rowProductCode) return;
          const key = buildGroupKey(prod.nome, prod.id);
          if (!key) return;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(prod);
        });
        const sortedGroups = Array.from(groups.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([, list]) => list);
        sortedGroups.forEach(group => {
          group.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
          candidates.push(...group);
        });

        const variantList = [];
        for (const prod of candidates) {
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
          }
        });
      }

      const incrementBtn = card.querySelector('[data-role="increment"]');
      if (incrementBtn) {
        incrementBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          incrementStagingQuantity(variant, 1);
        });
      }

      const input = card.querySelector('[data-role="quantity-input"]');
      if (input) {
        input.addEventListener('focus', () => {
          clearOtherStaging(variant.key);
          setActiveVariantKey(variant.key);
        });
        input.addEventListener('input', e => {
          const value = Math.max(0, Math.floor(Number(e.target.value) || 0));
          updateStagingQuantityForVariant(variant, value, { focus: { key: variant.key } });
        });
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmStagingForVariant(variant.key);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            if (clearStagingForVariant(variant.key)) {
              renderReplaceModalList({ skipReload: true });
            }
          }
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

      card.addEventListener('focusin', () => {
        setActiveVariantKey(variant.key);
      });
      card.addEventListener('focusout', e => {
        const related = e.relatedTarget;
        if (related && card.contains(related)) return;
        if (getSelectionQuantity(variant.key) > 0) {
          clearStagingForVariant(variant.key);
          renderReplaceModalList({ skipReload: true });
        }
      });

      container.appendChild(card);
    });

    renderReplaceModalSummary();
    updateReplaceModalConfirmButton();
    updateCommitButtonState();

    if (focus?.key) {
      const targetInput = container.querySelector(`[data-role="quantity-input"][data-variant-key="${focus.key}"]`);
      if (targetInput) {
        targetInput.focus();
        if (focus.select) targetInput.select();
        else targetInput.setSelectionRange(targetInput.value.length, targetInput.value.length);
      }
    }
  }

  function updateReplaceModalConfirmButton() {
    if (!replaceModalRefs || !replaceModalRefs.confirmBtn) return;
    const btn = replaceModalRefs.confirmBtn;
    const row = rows[currentReplaceIndex];
    if (!row) {
      btn.disabled = true;
      btn.textContent = 'Confirmar Substituição';
      btn.className = 'btn-primary px-5 py-2 rounded-lg text-white font-medium transition opacity-60 cursor-not-allowed';
      return;
    }
    const requiredQty = Number(row?.qtd || row?.quantidade || 0) || 0;
    const plan = buildSelectionPlan(row);
    const totalSelected = plan.totalSelected;
    const remaining = Math.max(0, requiredQty - totalSelected);
    let label = 'Confirmar Substituição';
    let disabled = true;

    if (requiredQty <= 0) {
      label = 'Quantidade inválida';
    } else if (hasPendingSelections()) {
      label = 'Conclua as edições pendentes';
    } else if (totalSelected === requiredQty) {
      disabled = false;
      label = 'Confirmar Substituição';
    } else if (totalSelected > requiredQty) {
      label = 'Quantidade excedida';
    } else {
      label = `Selecione mais ${remaining.toLocaleString('pt-BR')} un`;
    }

    btn.disabled = disabled;
    btn.className = disabled
      ? 'btn-primary px-5 py-2 rounded-lg text-white font-medium transition opacity-60 cursor-not-allowed'
      : 'btn-primary px-5 py-2 rounded-lg text-white font-medium transition';
    btn.textContent = label;
  }

  function updateCommitButtonState() {
    if (!replaceModalRefs || !replaceModalRefs.commitBtn) return;
    const btn = replaceModalRefs.commitBtn;
    btn.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Adicionar Tipo';
    btn.classList.add('opacity-60', 'cursor-not-allowed');
  }

  function handleCommitSelection() {
    const activeKey = getActiveVariantKey();
    if (!activeKey) return;
    if (getSelectionQuantity(activeKey) > 0) {
      confirmStagingForVariant(activeKey);
    }
  }

  function commitVariantSelection(variantKey) {
    if (!variantKey) return;
    confirmStagingForVariant(variantKey);
  }

  function handleReplaceModalPointerDown(e) {
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
  }

  function handleReplaceModalConfirm() {
    if (currentReplaceIndex < 0) return;
    const row = rows[currentReplaceIndex];
    if (!row) return;
    const plan = buildSelectionPlan(row);
    if (plan.requiredQty <= 0 || plan.totalSelected !== plan.requiredQty) return;

    row.replacementPlan = plan;
    row.approved = false;
    row.forceProduceAll = plan.produceQty >= plan.requiredQty && plan.stock.length === 0;

    if (plan.stock.length) {
      const primary = plan.stock[0];
      const variant = getVariantByKey(primary.variantKey);
      if (variant?.product) {
        const produto = variant.product;
        if (row._origId == null) row._origId = row.produto_id;
        row.produto_id = Number(produto.id);
        row.nome = produto.nome;
        row.preco_venda = Number(produto.preco_venda || 0);
        row.codigo = produto.codigo;
      }
    }

    closeReplaceModal();
    recomputeStocks();
    renderRows();
    validate();
    computeInsumosAndRender();
  }

  openReplaceModal().catch(err => {
    console.error('Erro ao abrir modal de substituição', err);
    try { closeReplaceModal(); }
    catch (closeErr) { console.error(closeErr); }
  });
})();
