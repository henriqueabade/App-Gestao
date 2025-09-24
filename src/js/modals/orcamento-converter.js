(function(){
  const overlayId = 'converterOrcamento';
  const overlay = document.getElementById('converterOrcamentoOverlay');
  if (!overlay) return;
  const close = () => Modal.close(overlayId);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

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

  let replaceModalRefs = null;
  const replaceModalState = {
    searchTerm: '',
    variants: [],
    selections: new Map(),
    initialSelections: null,
    loadingVariants: null,
    variantsLoadedForRowId: null,
    originalPlan: null,
    committedSelections: []
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

  function getTotalCommittedQuantity() {
    const list = ensureCommittedList();
    return list.reduce((acc, entry) => acc + sanitizePositiveInt(entry?.qty), 0);
  }

  function getSelectionQuantity(key) {
    const selections = ensureSelectionMap();
    return sanitizePositiveInt(selections.get(key));
  }

  function getTotalSelectedQuantity() {
    const selections = ensureSelectionMap();
    let total = 0;
    selections.forEach(value => {
      total += sanitizePositiveInt(value);
    });
    return total + getTotalCommittedQuantity();
  }

  function enforceSelectionLimits(requiredQty) {
    const selections = ensureSelectionMap();
    if (!selections.size) return;

    const sanitizedEntries = [];
    selections.forEach((qty, key) => {
      const variant = getVariantByKey(key);
      if (!variant) {
        selections.delete(key);
        return;
      }
      const baseMax = variant.type === 'produce'
        ? requiredQty
        : Math.min(requiredQty, Math.floor(Number(variant.available) || 0));
      const sanitized = Math.min(baseMax, sanitizePositiveInt(qty));
      if (sanitized > 0) {
        sanitizedEntries.push({ key, qty: sanitized });
      } else {
        selections.delete(key);
      }
    });

    const committedTotal = Math.min(requiredQty, getTotalCommittedQuantity());
    if (committedTotal >= requiredQty) {
      selections.clear();
      return;
    }

    selections.clear();
    let runningTotal = committedTotal;
    sanitizedEntries.forEach(entry => {
      if (runningTotal >= requiredQty) return;
      const remaining = Math.max(0, requiredQty - runningTotal);
      const finalQty = Math.min(entry.qty, remaining);
      if (finalQty > 0) {
        selections.set(entry.key, finalQty);
        runningTotal += finalQty;
      }
    });
  }

  function rebalanceSelectionsForVariant(variant, desiredQty, requiredQty) {
    const selections = ensureSelectionMap();
    const targetQty = Math.max(0, Math.floor(Number(desiredQty) || 0));
    if (!(targetQty > 0)) return 0;

    const baseTotal = getTotalSelectedQuantity();
    let finalQty = targetQty;
    let totalAfter = baseTotal + finalQty;
    if (totalAfter > requiredQty) {
      let excess = totalAfter - requiredQty;
      const adjustable = Array.from(selections.entries())
        .map(([key, qty]) => {
          const normalizedQty = sanitizePositiveInt(qty);
          if (!normalizedQty) return null;
          const info = getVariantByKey(key);
          const priority = info?.type === 'produce' ? 0 : 1;
          return {
            key,
            qty: normalizedQty,
            priority,
            order: Number(info?.stage?.order || 0)
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          if (b.order !== a.order) return b.order - a.order;
          return b.qty - a.qty;
        });

      adjustable.forEach(entry => {
        if (excess <= 0) return;
        if (entry.key === variant.key || entry.qty <= 0) return;
        const take = Math.min(excess, entry.qty);
        const remaining = entry.qty - take;
        if (remaining > 0) selections.set(entry.key, remaining);
        else selections.delete(entry.key);
        excess -= take;
      });

      if (excess > 0) {
        finalQty = Math.max(0, finalQty - excess);
      }
    }

    return finalQty;
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
    if (!replaceModalState.selections || !(replaceModalState.selections instanceof Map)) {
      replaceModalState.selections = new Map();
    }
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
    replaceModalState.selections.forEach((qty, key) => {
      const variant = getVariantByKey(key);
      if (!variant) return;
      const sanitized = sanitizePositiveInt(qty);
      if (!sanitized) return;
      const variantMax = variant.type === 'produce'
        ? requiredQty
        : Math.min(requiredQty, Math.floor(Number(variant.available) || 0));
      const clamped = Math.min(variantMax, sanitized);
      if (!clamped) return;
      plan.totalSelected += clamped;
      if (variant.type === 'produce') {
        plan.produceQty += clamped;
      } else {
        plan.stock.push({
          variantKey: key,
          qty: clamped,
          productId: Number(variant.product?.id),
          productName: variant.product?.nome || '',
          productCode: variant.product?.codigo || '',
          processName: variant.stage?.processName || '',
          lastItemName: variant.stage?.lastItemName || '',
          order: Number(variant.stage?.order || 0),
          isCurrentProduct: !!variant.isCurrentProduct,
          committed: false
        });
      }
      plan.selections.push({ key, qty: clamped, committed: false });
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
  document.addEventListener('keydown', function esc(e){
    if (e.key === 'Escape') {
      if (replaceModalRefs && !replaceModalRefs.overlay.classList.contains('hidden')) return;
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


  let listaProdutos = [];
  let rows = Array.isArray(ctx.items) ? ctx.items.map(p => ({ ...p, approved: !!p.approved })) : [];
  const state = {
    allowNegativeStock: false,
    insumosView: { filtroPecaId: null, mostrarSomenteFaltantes: true }
  };
  let currentReplaceIndex = -1;
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

  function renderRows() {
    pecasBody.innerHTML = '';
    rows.forEach((r, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/10';
      tr.dataset.index = String(idx);
      const isAttention = r.a_produzir > 0 && r.status === 'atencao';
      const isApproved = !!r.approved;
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

      const infoSpan = (Array.isArray(r.popover?.variants) && r.popover.variants.length > 0) ? `
        <span class="js-piece-info inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors ml-1" aria-haspopup="dialog" aria-expanded="false" data-variants='${JSON.stringify(r.popover.variants)}' data-page="0">
          <svg class="w-3 h-3 text-gray-300" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0116 0zm-7-4a 1 1 0 11-2 0 1 1 0 012 0zM9 9a 1 1 0 000 2v3a 1 1 0 001 1h1a 1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
        </span>` : '';

      tr.innerHTML = `
        <td class="py-3 px-2 text-white">${r.nome || ''}</td>
        <td class="py-3 px-2 text-center text-white">${r.qtd}</td>
        <td class="py-3 px-2 text-center text-white">${r.em_estoque ?? 0}</td>
        <td class="py-3 px-2 text-center text-white">${r.pronta ?? 0}</td>
        <td class="py-3 px-2 text-center text-white">${r.produzir_total ?? 0}</td>
        <td class="py-3 px-2 text-center text-white">${r.produzir_parcial ?? 0} ${infoSpan}</td>
        <td class="py-3 px-2 text-center">${statusHtml}</td>
        <td class="py-3 px-2 text-center">
          <div class="flex justify-center gap-1">
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
        buildInsumosGrid();
        validate();
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

  function ensureReplaceModal() {
    if (replaceModalRefs) return replaceModalRefs;
    const overlay = document.createElement('div');
    overlay.id = 'converterReplaceModal';
    overlay.className = 'fixed inset-0 z-[12000] flex items-center justify-center px-4 py-6 bg-black/60 hidden';
    overlay.innerHTML = `
      <div data-role="modal" class="w-full max-w-4xl max-h-[90vh] bg-surface/80 backdrop-blur-xl border border-white/20 ring-1 ring-white/10 rounded-2xl shadow-2xl/60 flex flex-col overflow-hidden">
        <header class="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h3 class="text-xl font-bold text-white">Substituir Peça</h3>
            <p data-field="modal-subtitle" class="text-gray-300 text-sm"></p>
          </div>
          <button type="button" data-action="close" class="btn-neutral px-3 py-2 rounded-lg text-white">X</button>
        </header>
        <div class="flex-1 overflow-y-auto modal-scroll">
          <div class="p-6 space-y-6">
            <div class="bg-surface/40 rounded-lg border border-white/10 p-4 space-y-4">
              <div class="space-y-4">
                <h4 class="font-medium text-white">Peça Atual</h4>
                <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                  <div class="flex-1 space-y-3">
                    <div>
                      <p class="text-gray-400 text-xs uppercase tracking-wide mb-1">Nome</p>
                      <p class="text-white font-semibold text-lg leading-tight whitespace-pre-line break-words" data-field="piece-name"></p>
                    </div>
                    <p class="text-sm text-gray-300" data-field="piece-details"></p>
                  </div>
                  <div class="w-full lg:max-w-md space-y-3">
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div>
                        <p class="text-gray-400 text-xs uppercase tracking-wide mb-1">Qtd Orçada</p>
                        <p class="text-white font-semibold" data-field="piece-qty"></p>
                      </div>
                      <div>
                        <p class="text-gray-400 text-xs uppercase tracking-wide mb-1">Total em Estoque</p>
                        <p class="text-white font-semibold" data-field="piece-stock-total"></p>
                      </div>
                      <div>
                        <p class="text-gray-400 text-xs uppercase tracking-wide mb-1">Peças Prontas</p>
                        <p class="text-white font-semibold" data-field="piece-ready"></p>
                      </div>
                      <div>
                        <p class="text-gray-400 text-xs uppercase tracking-wide mb-1">Produzir Parcial</p>
                        <p class="text-white font-semibold" data-field="piece-produce-partial"></p>
                      </div>
                      <div>
                        <p class="text-gray-400 text-xs uppercase tracking-wide mb-1">Produzir Total</p>
                        <p class="text-white font-semibold" data-field="piece-produce-total"></p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="space-y-3">
                <div>
                  <p class="text-gray-300 text-xs uppercase tracking-wide mb-2">TIPOS SELECIONADOS AUTOMATICAMENTE</p>
                  <div data-field="piece-stock-breakdown" class="space-y-3"></div>
                </div>
                <div data-field="piece-selection" class="hidden border border-primary/40 bg-primary/5 rounded-lg p-3 space-y-3"></div>
              </div>
            </div>
            <div class="bg-surface/40 rounded-lg border border-white/10 p-4">
              <h4 class="font-medium text-white mb-3">Buscar alternativa</h4>
              <input type="text" data-role="search" placeholder="Buscar por processo, insumo ou código" class="w-full bg-input border border-inputBorder rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition" />
            </div>
            <div class="bg-surface/40 rounded-lg border border-white/10 p-4">
              <h4 class="font-medium text-white mb-4">Peças disponíveis</h4>
              <div data-role="results" class="space-y-3 max-h-[360px] overflow-y-auto pr-1 modal-scroll"></div>
            </div>
          </div>
        </div>
        <footer class="flex justify-end items-center gap-3 px-6 py-4 border-t border-white/10">
          <button type="button" data-action="close" class="btn-danger px-5 py-2 rounded-lg text-white font-medium">Cancelar</button>
          <button type="button" data-action="commit" class="btn-secondary px-5 py-2 rounded-lg text-white font-medium hidden">Adicionar Tipo</button>
          <button type="button" data-action="confirm" class="btn-primary px-5 py-2 rounded-lg text-white font-medium" disabled>Confirmar Substituição</button>
        </footer>
      </div>`;
    document.body.appendChild(overlay);
    const modal = overlay.querySelector('[data-role="modal"]');
    modal?.setAttribute('tabindex', '-1');
    replaceModalRefs = {
      overlay,
      modal,
      confirmBtn: overlay.querySelector('[data-action="confirm"]'),
      commitBtn: overlay.querySelector('[data-action="commit"]'),
      search: overlay.querySelector('[data-role="search"]'),
      results: overlay.querySelector('[data-role="results"]'),
      stockBreakdown: overlay.querySelector('[data-field="piece-stock-breakdown"]'),
      selectionSummary: overlay.querySelector('[data-field="piece-selection"]')
    };
    overlay.querySelectorAll('[data-action="close"]').forEach(btn => btn.addEventListener('click', closeReplaceModal));
    replaceModalRefs.confirmBtn?.addEventListener('click', handleReplaceModalConfirm);
    replaceModalRefs.commitBtn?.addEventListener('click', handleCommitSelection);
    if (replaceModalRefs.search) {
      replaceModalRefs.search.placeholder = 'Filtrar por processo, insumo ou código';
    }
    replaceModalRefs.search?.addEventListener('input', async e => {
      replaceModalState.searchTerm = e.target.value || '';
      await renderReplaceModalList({ skipReload: true });
    });
    document.addEventListener('keydown', handleReplaceModalKey);
    return replaceModalRefs;
  }

  function setReplaceModalField(field, value) {
    if (!replaceModalRefs) return;
    replaceModalRefs.overlay.querySelectorAll(`[data-field="${field}"]`).forEach(el => {
      el.textContent = value ?? '';
    });
  }

  async function openReplaceModal(index) {
    if (isNaN(index) || index < 0) return;
    const refs = ensureReplaceModal();
    const row = rows[index];
    if (!refs || !row) return;
    currentReplaceIndex = index;

    const prepareModal = async () => {
      await (listaProdutos.length ? Promise.resolve() : carregarProdutos());
      replaceModalState.searchTerm = '';
      replaceModalState.variants = [];
      replaceModalState.selections = new Map();
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

    if (typeof window.withModalLoading === 'function') {
      await window.withModalLoading(1000, prepareModal);
    } else {
      await prepareModal();
    }

    refs.overlay.classList.remove('hidden');
    requestAnimationFrame(() => { refs.modal?.focus(); });
  }

  function closeReplaceModal() {
    if (!replaceModalRefs) return;
    replaceModalRefs.overlay.classList.add('hidden');
    replaceModalState.searchTerm = '';
    replaceModalState.variants = [];
    replaceModalState.selections = new Map();
    replaceModalState.initialSelections = null;
    replaceModalState.loadingVariants = null;
    replaceModalState.variantsLoadedForRowId = null;
    replaceModalState.originalPlan = null;
    clearCommittedSelections();
    if (replaceModalRefs.search) replaceModalRefs.search.value = '';
    currentReplaceIndex = -1;
    updateReplaceModalConfirmButton();
    updateCommitButtonState();
  }

  function handleReplaceModalKey(e) {
    if (e.key === 'Escape' && replaceModalRefs && !replaceModalRefs.overlay.classList.contains('hidden')) {
      closeReplaceModal();
    }
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

  async function applyQuantityChange(variant, desiredQty, options = {}) {
    const row = rows[currentReplaceIndex];
    if (!row) return;
    const requiredQty = Number(row.qtd || row.quantidade || 0) || 0;
    const sanitized = Math.max(0, Math.floor(Number(desiredQty) || 0));
    const selections = ensureSelectionMap();
    const baseMax = variant.type === 'produce'
      ? requiredQty
      : Math.min(requiredQty, Math.floor(Number(variant.available) || 0));
    const targetQty = Math.min(baseMax, sanitized);
    selections.delete(variant.key);
    let finalQty = 0;
    if (targetQty > 0) {
      finalQty = rebalanceSelectionsForVariant(variant, targetQty, requiredQty);
    }
    if (finalQty > 0) selections.set(variant.key, finalQty);
    else selections.delete(variant.key);
    enforceSelectionLimits(requiredQty);
    const focus = options.focus ? { ...options.focus } : null;
    await renderReplaceModalList({ skipReload: true, focus });
  }

  async function applyTotalQuantityChange(variant, desiredTotal, options = {}) {
    const row = rows[currentReplaceIndex];
    if (!row) return;
    const requiredQty = Number(row.qtd || row.quantidade || 0) || 0;
    const sanitizedTotal = Math.max(0, Math.floor(Number(desiredTotal) || 0));
    const baseMax = variant.type === 'produce'
      ? requiredQty
      : Math.min(requiredQty, Math.floor(Number(variant.available) || 0));
    const committedQty = getCommittedQuantity(variant.key);
    const currentQty = getSelectionQuantity(variant.key);
    const totalQty = committedQty + currentQty;
    const totalWithoutVariant = Math.max(0, getTotalSelectedQuantity() - totalQty);
    const maxAllowed = Math.max(0, Math.min(baseMax, requiredQty - totalWithoutVariant));
    const clampedTotal = Math.min(sanitizedTotal, maxAllowed);

    if (clampedTotal < committedQty) {
      setCommittedQuantity(variant.key, clampedTotal);
    }

    const updatedCommitted = getCommittedQuantity(variant.key);
    const desiredCurrent = Math.max(0, clampedTotal - updatedCommitted);
    await applyQuantityChange(variant, desiredCurrent, options);

    if (clampedTotal === 0) {
      setCommittedQuantity(variant.key, 0);
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
      renderSelectionList();
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
      container.innerHTML = '<p class="text-sm text-gray-400">Carregando variações disponíveis...</p>';
      const loadPromise = (async () => {
        let candidates = [];
        if (rowProductCode) {
          candidates = listaProdutos.filter(prod => normalizeCode(prod.codigo) === rowProductCode);
        } else {
          const groupKey = buildGroupKey(row.nome, row.produto_id);
          candidates = listaProdutos.filter(prod => buildGroupKey(prod.nome, prod.id) === groupKey);
        }
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
    const info = document.createElement('div');
    info.className = 'mb-4 text-sm text-gray-300 space-y-1';
    info.innerHTML = `
      <p class="text-gray-200">Quantidade orçada: <span class="text-white font-semibold">${requiredQty.toLocaleString('pt-BR')}</span> un</p>
      <p class="text-xs text-gray-400">Combine diferentes pontos em estoque e produção para suprir a necessidade do orçamento.</p>
      <p class="text-xs ${plan.totalSelected === requiredQty ? 'text-emerald-300' : 'text-amber-300'}">Selecionado: ${plan.totalSelected.toLocaleString('pt-BR')} / ${requiredQty.toLocaleString('pt-BR')} un</p>`;
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

    variantsToRender.forEach(variant => {
      const committedQty = getCommittedQuantity(variant.key);
      const currentQty = getSelectionQuantity(variant.key);
      const totalQty = committedQty + currentQty;
      const totalWithoutVariant = Math.max(0, getTotalSelectedQuantity() - totalQty);
      const baseMax = variant.type === 'produce'
        ? requiredQty
        : Math.min(requiredQty, Math.floor(Number(variant.available) || 0));
      const budgetRemaining = Math.max(0, requiredQty - totalWithoutVariant);
      const effectiveMax = Math.max(0, Math.min(baseMax, budgetRemaining));
      const inputMax = Math.max(totalQty, effectiveMax);
      const card = document.createElement('div');
      card.className = 'w-full bg-surface/40 border border-white/10 rounded-xl px-4 py-4 transition focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/40 mb-3 last:mb-0';
      card.setAttribute('data-variant-key', variant.key);
      if (totalQty > 0) {
        card.classList.add('border-primary', 'ring-1', 'ring-primary/50');
      }

      if (variant.type === 'stock') {
        const process = variant.stage?.processName || 'Processo não informado';
        const lastItem = variant.stage?.lastItemName || 'Sem último insumo';
        const availableTotal = Math.max(0, Math.floor(Number(variant.available || 0)));
        const remainingInVariant = Math.max(0, availableTotal - totalQty);
        const badgeClass = remainingInVariant > 0 ? 'badge-success' : 'badge-danger';
        const badgeLabel = `${remainingInVariant.toLocaleString('pt-BR')} em estoque`;
        card.innerHTML = `
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-white font-semibold">${lastItem}</p>
              <p class="text-xs text-gray-400">${process}</p>
              ${variant.product?.codigo ? `<p class="text-xs text-gray-500 mt-1">Código: ${variant.product.codigo}</p>` : ''}
            </div>
            <span class="${badgeClass} px-2 py-1 rounded text-xs">${badgeLabel}</span>
          </div>
            <div class="mt-3 flex items-center gap-3">
              <span class="text-xs text-gray-400 uppercase tracking-wide">Selecionar</span>
              ${committedQty > 0 ? `<span class="text-[11px] text-emerald-300">Fixado: ${committedQty.toLocaleString('pt-BR')} un</span>` : ''}
              <div class="flex items-center gap-2">
              <button type="button" class="js-qty-btn w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-white text-sm flex items-center justify-center" data-step="-1">-</button>
              <input type="number" inputmode="numeric" min="0" class="w-16 h-8 text-center bg-white/5 border border-white/10 rounded-lg text-white leading-[32px]" data-variant-input="${variant.key}" value="${totalQty}" max="${inputMax}" />
              <button type="button" class="js-qty-btn w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-white text-sm flex items-center justify-center" data-step="1">+</button>
              </div>
            <span class="text-xs text-gray-400 ml-auto whitespace-nowrap">Disp.: ${availableTotal.toLocaleString('pt-BR')} • Orçamento: ${budgetRemaining.toLocaleString('pt-BR')} un</span>
          </div>`;
      } else {
        const remaining = budgetRemaining;
        card.innerHTML = `
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-white font-semibold">Produzir do zero</p>
              <p class="text-xs text-gray-400 mt-1">Defina o total que deverá seguir para produção.</p>
            </div>
            <span class="badge-warning px-2 py-1 rounded text-xs">Restante permitido: ${remaining.toLocaleString('pt-BR')} un</span>
          </div>
          <div class="mt-3 flex items-center gap-3">
            <span class="text-xs text-gray-400 uppercase tracking-wide">Produzir</span>
            ${committedQty > 0 ? `<span class="text-[11px] text-emerald-300">Fixado: ${committedQty.toLocaleString('pt-BR')} un</span>` : ''}
            <div class="flex items-center gap-2">
              <button type="button" class="js-qty-btn w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-white text-sm flex items-center justify-center" data-step="-1">-</button>
              <input type="number" inputmode="numeric" min="0" class="w-20 h-8 text-center bg-white/5 border border-white/10 rounded-lg text-white leading-[32px]" data-variant-input="${variant.key}" value="${totalQty}" max="${inputMax}" />
              <button type="button" class="js-qty-btn w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-white text-sm flex items-center justify-center" data-step="1">+</button>
            </div>
          </div>`;
      }

      const input = card.querySelector(`[data-variant-input="${variant.key}"]`);
      if (input) {
        const handleManualChange = async e => {
          const value = Math.floor(Number(e.target.value) || 0);
          await applyTotalQuantityChange(variant, value, { focus: { key: variant.key } });
        };
        input.addEventListener('input', handleManualChange);
        input.addEventListener('blur', handleManualChange);
      }
      card.querySelectorAll('.js-qty-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.preventDefault();
          e.stopPropagation();
          const step = Number(btn.dataset.step || 0);
          const nextValue = step > 0 ? totalQty + step : 0;
          await applyTotalQuantityChange(variant, nextValue, { focus: { key: variant.key, select: true } });
        });
      });
      container.appendChild(card);
    });

    renderReplaceModalSummary();
    updateReplaceModalConfirmButton();
    updateCommitButtonState();

    if (focus?.key) {
      const targetInput = container.querySelector(`[data-variant-input="${focus.key}"]`);
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
    const requiredQty = Number(row?.qtd || row?.quantidade || 0) || 0;
    const plan = buildSelectionPlan(row);
    const totalSelected = plan.totalSelected;
    const remaining = Math.max(0, requiredQty - totalSelected);
    let label = 'Confirmar Substituição';
    let disabled = true;

    if (requiredQty <= 0) {
      label = 'Quantidade inválida';
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
    const row = rows[currentReplaceIndex];
    if (!row) {
      btn.classList.add('hidden');
      return;
    }
    const requiredQty = Number(row.qtd || row.quantidade || 0) || 0;
    const selections = ensureSelectionMap();
    let currentTotal = 0;
    selections.forEach(qty => { currentTotal += sanitizePositiveInt(qty); });
    const committedTotal = getTotalCommittedQuantity();
    const remaining = Math.max(0, requiredQty - committedTotal);
    const shouldShow = currentTotal > 0 && remaining > 0;
    btn.classList.toggle('hidden', !shouldShow);
    btn.disabled = !shouldShow;
    if (shouldShow) {
      const futureTotal = Math.min(remaining, currentTotal);
      btn.textContent = `Adicionar Tipo (${futureTotal.toLocaleString('pt-BR')} un)`;
      btn.classList.remove('opacity-60', 'cursor-not-allowed');
    } else {
      btn.textContent = 'Adicionar Tipo';
      btn.classList.add('opacity-60', 'cursor-not-allowed');
    }
  }

  function handleCommitSelection() {
    if (currentReplaceIndex < 0) return;
    const row = rows[currentReplaceIndex];
    if (!row) return;
    const requiredQty = Number(row.qtd || row.quantidade || 0) || 0;
    if (!(requiredQty > 0)) return;
    const selections = ensureSelectionMap();
    if (!selections.size) return;

    let committedTotal = getTotalCommittedQuantity();
    let remaining = Math.max(0, requiredQty - committedTotal);
    if (!(remaining > 0)) {
      selections.clear();
      renderReplaceModalList({ skipReload: true });
      return;
    }

    let anyCommitted = false;
    const ordered = Array.from(selections.entries());
    for (const [key, qty] of ordered) {
      const variant = getVariantByKey(key);
      if (!variant) continue;
      const sanitized = sanitizePositiveInt(qty);
      if (!sanitized) continue;
      const baseMax = variant.type === 'produce'
        ? requiredQty
        : Math.min(requiredQty, Math.floor(Number(variant.available) || 0));
      remaining = Math.max(0, requiredQty - getTotalCommittedQuantity());
      if (!(remaining > 0)) break;
      const finalQty = Math.min(baseMax, sanitized, remaining);
      if (!(finalQty > 0)) continue;
      addCommittedQuantity(variant.key, finalQty);
      anyCommitted = true;
    }

    selections.clear();
    enforceSelectionLimits(requiredQty);
    renderReplaceModalList({ skipReload: true });
    if (anyCommitted) {
      renderReplaceModalSummary();
      updateReplaceModalConfirmButton();
    }
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

  // Botões básicos
  function handleCancelConversion() {
    try { closeReplaceModal(); }
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
    try { window.confirmQuoteConversion?.({ deletions, replacements }); close(); }
    catch (err) { console.error(err); showToast('Erro ao confirmar conversão', 'error'); }
  });

  // Cálculo de insumos e status por peça
async function computeInsumosAndRender(){
  try {
    const byId = new Map(listaProdutos.map(p => [String(p.id), p]));

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
      const codigo = prod?.codigo; r.status=''; r.faltantes=[]; r.produzir_total=0; r.produzir_parcial=0; r.popover={variants:[]}; r.pronta=0; r.em_estoque=0; r.a_produzir=0; r.codigo = codigo;
      if (!codigo) continue;

      let detalhes = {};
      try { detalhes = await (window.electronAPI?.listarDetalhesProduto?.({ produtoCodigo: codigo, produtoId: r.produto_id }) ?? {}); }
      catch (e) { console.error('detalhes', e); }
      const rota = Array.isArray(detalhes?.itens) ? detalhes.itens : [];
      const rawLotes = Array.isArray(detalhes?.lotes) ? detalhes.lotes : [];
      const forceAll = !!r.forceProduceAll;
      const lotes = forceAll ? [] : rawLotes;
      r.forceProduceAll = forceAll;

      const orderById = new Map(rota.map(i => [Number(i.insumo_id), Number(i.ordem_insumo||0)]));
      const rotaSorted = rota.slice().sort((a,b)=> Number(a.ordem_insumo||0) - Number(b.ordem_insumo||0));
      const maxOrder = rotaSorted.length ? Math.max(...rotaSorted.map(i=> Number(i.ordem_insumo||0))) : 0;

      let readyQty = 0;
      const partials = [];
      lotes.forEach(l => {
        const qty = Number(l.quantidade||0);
        const lastId = Number(l.ultimo_insumo_id||0);
        const ord = orderById.get(lastId) || 0;
        if (ord >= maxOrder && maxOrder > 0) readyQty += qty;
        else partials.push({ order: ord, qty, lastId, lastName: l.ultimo_item || '', process: l.etapa || '', usedAt: l.data_hora_completa || '' });
      });
      const parcialTotal = partials.reduce((a,b)=> a + b.qty, 0);
      const totalStock = readyQty + parcialTotal;
      r.pronta = readyQty;
      r.em_estoque = totalStock;

      const qtd = Number(r.qtd||0);
      let needed = Math.max(0, qtd - readyQty);
      partials.sort((a,b)=> b.order - a.order);
      const usedPartials = new Map();
      for (const p of partials) {
        if (needed <= 0) break;
        const take = Math.min(p.qty, needed);
        if (take > 0) {
          needed -= take;
          const cur = usedPartials.get(p.order) || { order: p.order, qty: 0, lastName: p.lastName, lastId: p.lastId, process: p.process, usedAt: p.usedAt };
          cur.qty += take;
          usedPartials.set(p.order, cur);
        }
      }
      r.produzir_parcial = Array.from(usedPartials.values()).reduce((a,b)=> a + b.qty, 0);
      r.produzir_total = Math.max(0, qtd - readyQty - r.produzir_parcial);
      r.a_produzir = r.produzir_parcial + r.produzir_total;

      const addFaltantes = (orderMin, units) => {
        if (!units) return;
        rotaSorted.forEach(i => {
          const ord = Number(i.ordem_insumo || 0);
          if (ord > orderMin) {
            const nome = i.nome || '';
            const unidade = i.unidade || '';
            const necessario = Number(i.quantidade || 0) * units;
            const key = `${nome}__${unidade}`;
            const cur =
              r.faltantes.find(x => x.key === key) || {
                key,
                nome,
                un: unidade,
                necessario: 0,
                etapa: i.processo || '',
                ordem: ord
              };
            cur.necessario += necessario;
            if (!r.faltantes.find(x => x.key === key)) r.faltantes.push(cur);
          }
        });
      };
      usedPartials.forEach(v => addFaltantes(v.order, v.qty));
      if (r.produzir_total > 0) addFaltantes(0, r.produzir_total);

      let pieceHasNegative = false;
      for (const f of r.faltantes) {
        const stock = stockByName.get(f.nome) || { quantidade: 0, infinito: false };
        if (!stock.infinito) {
          const saldo = Number(stock.quantidade||0) - Number(f.necessario||0);
          if (saldo < 0) { pieceHasNegative = true; break; }
        }
      }
      r.status = (r.a_produzir > 0 && pieceHasNegative) ? 'atencao' : 'ok';

      r.popover.variants = Array.from(usedPartials.values())
        .sort((a, b) => b.order - a.order)
        .map(v => {
          const pending = rotaSorted
            .filter(i => Number(i.ordem_insumo || 0) > v.order)
            .map(i => ({
              name: i.nome,
              pending: Math.ceil(Number(i.quantidade || 0) * v.qty),
              un: i.unidade
            }));
          const lastItem = rotaSorted.find(i => Number(i.ordem_insumo || 0) === v.order);
          return {
            qty: v.qty,
            lastItem: {
              name: lastItem ? lastItem.nome : 'Nenhum',
              qty: lastItem ? Math.ceil(Number(lastItem.quantidade || 0) * v.qty) : 0,
              time: v.usedAt
            },
            currentProcess: {
              name: v.process || (lastItem ? lastItem.processo : ''),
              since: v.usedAt
            },
            totalItems: rotaSorted.length,
            pending
          };
        });
      r.stockBreakdown = buildStockBreakdownFromDetails(rota, rawLotes);
    }

    lastStockByName = stockByName;
    recomputeStocks();
    buildInsumosGrid(stockByName);
    renderRows();
    validate();
  } catch (err) {
    console.error('Erro ao calcular insumos', err);
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
          <td class="py-3 px-2 text-center text-gray-300">${v.un || stock.unidade || ''}</td>
          <td class="py-3 px-2 text-center">${disponivel === Infinity ? '<span class="badge-success px-2 py-0.5 rounded text-[10px]">infinito</span>' : '<span class="text-white">' + disponivel.toLocaleString('pt-BR') + '</span>'}</td>
          <td class="py-3 px-2 text-center text-white">${Number(v.necessario || 0).toLocaleString('pt-BR')}</td>
          <td class="py-3 px-2 text-center">${negative ? '<span class="status-alert font-medium" title="Saldo previsto negativo">' + saldo.toLocaleString('pt-BR') + '</span>' : (saldo === Infinity ? '<span class="badge-success px-2 py-0.5 rounded text-[10px]">infinito</span>' : '<span class="status-ok font-medium">' + saldo.toLocaleString('pt-BR') + '</span>')}</td>
          <td class="py-3 px-2 text-center text-white">${v.etapa || '-'}</td>
          <td class="py-3 px-2 text-center text-white">${flags.join(' ')}</td>`;
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
          <td class="py-3 px-2 text-center text-gray-300">${v.un || stock.unidade || ''}</td>
          <td class="py-3 px-2 text-center">${disponivel === Infinity ? '<span class="badge-success px-2 py-0.5 rounded text-[10px]">infinito</span>' : '<span class="text-white">' + disponivel.toLocaleString('pt-BR') + '</span>'}</td>
          <td class="py-3 px-2 text-center text-white">${Number(v.necessario || 0).toLocaleString('pt-BR')}</td>
          <td class="py-3 px-2 text-center">${negative ? '<span class="status-alert font-medium" title="Saldo previsto negativo">' + saldo.toLocaleString('pt-BR') + '</span>' : (saldo === Infinity ? '<span class="badge-success px-2 py-0.5 rounded text-[10px]">infinito</span>' : '<span class="status-ok font-medium">' + saldo.toLocaleString('pt-BR') + '</span>')}</td>
          <td class="py-3 px-2 text-center text-white">${v.etapa || '-'}</td>
          <td class="py-3 px-2 text-center text-white">${flags.join(' ')}</td>`;
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
    recomputeStocks(); renderRows(); validate(); await computeInsumosAndRender();
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
  document.getElementById('converterDecisionNote')?.addEventListener('input', () => { computeInsumosAndRender(); });
  onlyMissingToggle?.addEventListener('change', () => {
    state.insumosView.mostrarSomenteFaltantes = !!onlyMissingToggle.checked;
    insumosBody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-gray-300"><i class="fas fa-sync-alt rotating mr-2"></i>Recarregando...</td></tr>';
    setTimeout(() => { computeInsumosAndRender(); }, 1000);
  });
  insumosReloadBtn?.addEventListener('click', () => {
    state.insumosView.filtroPecaId = null;
    if (onlyMissingToggle) { onlyMissingToggle.checked = false; state.insumosView.mostrarSomenteFaltantes = false; }
    if (insumosTituloPeca) insumosTituloPeca.textContent = 'Totais';
    insumosBody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-gray-300"><i class="fas fa-sync-alt rotating mr-2"></i>Recarregando...</td></tr>';
    setTimeout(() => { computeInsumosAndRender(); }, 1000);
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




