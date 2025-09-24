(async () => {
  const overlayId = 'cancelarPedido';
  const overlay = document.getElementById('cancelarPedidoOverlay');
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

  const context = window.cancelarPedidoContext;
  if (!context || !context.pedido) {
    markReady(false);
    Modal.close(overlayId);
    return;
  }

  const pedido = context.pedido;
  const pedidoId = context.id || context.pedidoId || pedido.id;
  const itens = Array.isArray(pedido.itens) ? pedido.itens : [];

  const pendingBanner = document.getElementById('cancelarPedidoPendencias');
  const pendingText = document.getElementById('cancelarPedidoPendenciasTexto');
  const confirmBtn = document.getElementById('cancelarPedidoConfirmar');
  const resetDestinationsBtn = document.getElementById('cancelarPedidoResetDestinos');
  const itensBody = document.getElementById('cancelarPedidoItens');
  const itensEmpty = document.getElementById('cancelarPedidoItensVazio');
  const statusTag = document.getElementById('cancelarPedidoStatus');
  const summarySection = document.getElementById('cancelarPedidoResumoRealocacao');
  const summaryList = document.getElementById('cancelarPedidoListaRealocacao');
  const ordersSection = document.getElementById('cancelarPedidoPedidosDisponiveis');
  const ordersList = document.getElementById('cancelarPedidoPedidosLista');
  const ordersEmpty = document.getElementById('cancelarPedidoPedidosVazio');
  const drawer = document.getElementById('cancelarPedidoDrawer');
  const drawerPanel = document.getElementById('cancelarPedidoDrawerPanel');
  const drawerOverlay = drawer?.querySelector('.cancelar-drawer-overlay');
  const drawerList = document.getElementById('cancelarPedidoDrawerLista');
  const drawerEmpty = document.getElementById('cancelarPedidoDrawerVazio');
  const drawerItem = document.getElementById('cancelarPedidoDrawerItem');

  const destinationState = new Map();
  const itemInfo = new Map();
  const itemKeys = [];
  let currentReallocationKey = null;
  let availableOrders = Array.isArray(context.availableOrders) ? context.availableOrders : null;
  let ordersLoading = false;
  const itemMatches = new Map();
  let aggregatedOrderEntries = [];

  const esc = e => {
    if (e.key !== 'Escape') return;
    if (drawer && !drawer.classList.contains('hidden')) {
      closeDrawer();
    } else {
      close();
    }
  };

  const close = () => {
    document.removeEventListener('keydown', esc);
    window.cancelarPedidoContext = null;
    Modal.close(overlayId);
  };

  const closeButtons = [
    document.getElementById('fecharCancelarPedido'),
    document.getElementById('cancelarPedidoFecharFooter')
  ].filter(Boolean);
  closeButtons.forEach(btn => btn.addEventListener('click', close));

  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', esc);

  const formatDate = value => {
    if (!value) return '';
    if (typeof value === 'string') {
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
      if (value.includes('T')) {
        const [date] = value.split('T');
        if (date && date.includes('-')) {
          const [y, m, d] = date.split('-');
          if (y && m && d) return `${d}/${m}/${y}`;
        }
      }
    }
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleDateString('pt-BR');
  };

  const formatCurrency = value => Number(value ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

  const formatQuantity = value => {
    const num = normalizeQuantity(value);
    return `${num.toLocaleString('pt-BR')} ${num === 1 ? 'unidade' : 'unidades'}`;
  };

  const formatOrderLabel = orderId => {
    if (!availableOrders) return `Pedido ${orderId}`;
    const found = availableOrders.find(o => String(o.id) === String(orderId));
    if (!found) return `Pedido ${orderId}`;
    const numero = found.numero || found.id;
    const cliente = found.cliente || '';
    return [`#${numero}`, cliente].filter(Boolean).join(' • ');
  };

  const removeDiacritics = value => {
    if (typeof value !== 'string') return '';
    return value.normalize ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : value;
  };

  const normalizeText = value => removeDiacritics(String(value ?? '')).trim().toLowerCase();

  const parseDateValue = value => {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'number') {
      const dt = new Date(value);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
        const [d, m, y] = trimmed.split('/');
        const dt = new Date(Number(y), Number(m) - 1, Number(d));
        return Number.isNaN(dt.getTime()) ? null : dt;
      }
      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) {
        const dt = new Date(parsed);
        return Number.isNaN(dt.getTime()) ? null : dt;
      }
    }
    return null;
  };

  const formatDateLabel = date => (date ? date.toLocaleDateString('pt-BR') : '—');

  const calculateDaysDiff = date => {
    if (!date) return null;
    const now = new Date();
    const diff = Math.floor((now - date) / 86400000);
    return diff < 0 ? 0 : diff;
  };

  const isOrderInProduction = order => {
    const status = normalizeText(order?.situacao || order?.status || '');
    return status.includes('producao');
  };

  const getOrderProductionDate = order => parseDateValue(
    order?.data_producao
    || order?.data_inicio_producao
    || order?.data_inicio
    || order?.dataInicioProducao
    || order?.dataAprovacao
    || order?.data_aprovacao
  );

  const buildItemSignature = item => {
    const produtoId = item?.produto_id ?? item?.produtoId ?? item?.id_produto ?? item?.produto ?? item?.produtoId;
    const codigo = item?.codigo ?? item?.codigo_produto ?? item?.produto_codigo ?? item?.sku ?? '';
    const nome = item?.nome ?? item?.descricao ?? item?.produto ?? '';
    return {
      produtoId: produtoId !== undefined && produtoId !== null ? String(produtoId) : '',
      codigo: normalizeText(codigo),
      nome: normalizeText(nome)
    };
  };

  const extractQuantity = item => {
    const candidates = [
      item?.quantidade,
      item?.qtd,
      item?.quantidade_total,
      item?.quantidade_totalizada,
      item?.quantidade_total_produto
    ];
    const value = candidates.find(v => v !== undefined && v !== null);
    const num = Number(value ?? 0);
    return Number.isNaN(num) ? 0 : num;
  };

  const buildOrderItemEntries = itensArray => {
    if (!Array.isArray(itensArray)) return [];
    return itensArray.map(raw => ({
      raw,
      signature: buildItemSignature(raw),
      quantity: extractQuantity(raw)
    }));
  };

  const ensureOrderMetadata = order => {
    if (!order || order.__metaProcessed) return;
    const productionDate = getOrderProductionDate(order);
    const days = calculateDaysDiff(productionDate);
    order.__productionDate = productionDate;
    order.__conversionLabel = formatDateLabel(productionDate);
    order.__daysInProduction = typeof days === 'number' ? days : null;
    order.__daysLabel = typeof days === 'number'
      ? `${days} ${days === 1 ? 'dia' : 'dias'} em produção`
      : 'Dias de produção não informados';
    order.__itemEntries = buildOrderItemEntries(order.itens);
    order.__metaProcessed = true;
  };

  const getOrderMatchQuantity = (order, signature) => {
    if (!order || !signature) return 0;
    const entries = Array.isArray(order.__itemEntries) ? order.__itemEntries : [];
    let total = 0;
    entries.forEach(entry => {
      const matchByProduct = signature.produtoId && entry.signature.produtoId && signature.produtoId === entry.signature.produtoId;
      const matchByCode = signature.codigo && entry.signature.codigo && signature.codigo === entry.signature.codigo;
      const matchByName = signature.nome && entry.signature.nome && signature.nome === entry.signature.nome;
      if (matchByProduct || matchByCode || matchByName) {
        total += Number(entry.quantity || 0);
      }
    });
    return total;
  };

  const compareOrdersByProductionDate = (a, b) => {
    const dateA = a?.__productionDate;
    const dateB = b?.__productionDate;
    if (dateA && dateB) {
      if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
    } else if (dateA) {
      return -1;
    } else if (dateB) {
      return 1;
    }
    const idA = Number(a?.id || 0);
    const idB = Number(b?.id || 0);
    return idA - idB;
  };

  const getOrderMeta = order => ({
    conversionLabel: order?.__conversionLabel || 'Data de conversão indisponível',
    daysLabel: order?.__daysLabel || 'Dias de produção não informados',
    daysValue: typeof order?.__daysInProduction === 'number' ? order.__daysInProduction : null
  });


  function togglePendingBanner(message) {
    if (!pendingBanner || !pendingText) return;
    if (message) {
      pendingBanner.classList.remove('hidden');
      pendingText.textContent = message;
    } else {
      pendingBanner.classList.add('hidden');
      pendingText.textContent = '';
    }
  }

  const toNumber = value => {
    const num = Number(value ?? 0);
    return Number.isFinite(num) ? num : 0;
  };

  const normalizeQuantity = value => {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.trunc(num);
  };

  const formatNumber = value => normalizeQuantity(value).toLocaleString('pt-BR');

  const formatUnitsLabel = value => {
    const amount = normalizeQuantity(value);
    const label = amount === 1 ? 'unidade' : 'unidades';
    return `${formatNumber(amount)} ${label}`;
  };

  function ensureDestinationState(key, totalQuantity = 0) {
    if (!destinationState.has(key)) {
      destinationState.set(key, {
        total: normalizeQuantity(totalQuantity),
        stock: 0,
        discard: 0,
        reallocations: [],
        remaining: normalizeQuantity(totalQuantity)
      });
    }
    const state = destinationState.get(key);
    if (totalQuantity && !state.total) {
      state.total = normalizeQuantity(totalQuantity);
      state.remaining = normalizeQuantity(totalQuantity);
    }
    if (!Array.isArray(state.reallocations)) state.reallocations = [];
    return state;
  }

  function sumReallocations(state) {
    return (state.reallocations || []).reduce(
      (sum, entry) => sum + normalizeQuantity(entry.quantity),
      0
    );
  }

  function recalcRemaining(state) {
    const assigned = normalizeQuantity(state.stock) + normalizeQuantity(state.discard) + sumReallocations(state);
    const remaining = normalizeQuantity(Math.max(0, toNumber(state.total) - assigned));
    state.remaining = remaining;
    return remaining;
  }

  function updateDrawerHeader(key) {
    if (!drawerItem) return;
    const info = itemInfo.get(key);
    const state = destinationState.get(key);
    if (!info || !state) {
      drawerItem.textContent = '';
      return;
    }
    drawerItem.textContent = `${info.name} • Restante: ${formatUnitsLabel(state.remaining)}`;
  }

  function updateAssignmentsUI(key) {
    const info = itemInfo.get(key);
    const state = destinationState.get(key);
    if (!info?.assignmentsContainer || !state) return;

    const container = info.assignmentsContainer;
    container.innerHTML = '';

    const chips = [];
    if (normalizeQuantity(state.stock) > 0) {
      chips.push({
        action: 'stock',
        icon: 'fa-box-open',
        label: 'Retornar ao estoque',
        quantity: state.stock,
        colorClass: 'text-amber-300'
      });
    }
    if (normalizeQuantity(state.discard) > 0) {
      chips.push({
        action: 'discard',
        icon: 'fa-trash',
        label: 'Descartar',
        quantity: state.discard,
        colorClass: 'text-red-400'
      });
    }
    (state.reallocations || [])
      .filter(entry => normalizeQuantity(entry.quantity) > 0)
      .forEach(entry => {
        chips.push({
          action: 'reallocate',
          orderId: entry.orderId,
          icon: 'fa-exchange-alt',
          label: formatOrderLabel(entry.orderId),
          quantity: entry.quantity,
          colorClass: 'text-sky-300'
        });
      });

    if (!chips.length) {
      const placeholder = document.createElement('p');
      placeholder.className = 'text-[11px] text-gray-400 text-center';
      placeholder.textContent = 'Destinação pendente';
      container.appendChild(placeholder);
      return;
    }

    chips.forEach(chip => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'w-full text-left bg-white/5 border border-white/10 px-3 py-2 rounded-lg text-xs text-gray-200 hover:border-primary/40 transition';
      const iconHtml = chip.icon ? `<i class="fas ${chip.icon} text-sm ${chip.colorClass || ''}" aria-hidden="true"></i>` : '';
      button.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-2">
            ${iconHtml}
            <span>${chip.label}</span>
          </span>
          <span class="font-semibold text-white">${formatUnitsLabel(chip.quantity)}</span>
        </div>
      `;
      if (chip.action === 'stock' || chip.action === 'discard') {
        button.title = 'Clique para ajustar a quantidade.';
        button.addEventListener('click', () => handleSimpleAction(key, chip.action));
      } else if (chip.action === 'reallocate' && chip.orderId) {
        button.title = 'Clique para ajustar a realocação.';
        button.addEventListener('click', () => openReallocationQuantity(key, chip.orderId));
      }
      container.appendChild(button);
    });
  }

  function updateItemDestinationsUI(key) {
    const info = itemInfo.get(key);
    if (!info) return;
    const state = ensureDestinationState(key, info.quantity);
    state.reallocations = (state.reallocations || []).filter(entry => normalizeQuantity(entry.quantity) > 0);
    const remaining = recalcRemaining(state);
    if (info.remainingCell) {
      info.remainingCell.textContent = formatNumber(remaining);
      info.remainingCell.className = `px-4 py-3 text-center text-sm font-semibold ${remaining > 0 ? 'text-orange-200' : 'text-emerald-200'}`;
    }
    updateAssignmentsUI(key);
    if (drawer && !drawer.classList.contains('hidden') && currentReallocationKey === key) {
      updateDrawerHeader(key);
      renderDrawerOrdersForItem(key);
    }
  }

  function openQuantityDialog({ title, description, max, initial, confirmLabel = 'Confirmar' }) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4';
      const safeMax = normalizeQuantity(max);
      const initialValue = normalizeQuantity(initial ?? safeMax);
      overlay.innerHTML = `
        <div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade">
          <div class="p-6 space-y-4">
            <div>
              <h3 class="text-lg font-semibold text-white">${title}</h3>
              ${description ? `<p class="text-sm text-gray-300 mt-1">${description}</p>` : ''}
            </div>
            <div class="space-y-2">
              <label class="text-xs uppercase tracking-wide text-gray-400">Quantidade</label>
              <input type="number" step="1" min="0" inputmode="numeric" pattern="\\d*" class="w-full bg-input border border-inputBorder rounded-lg px-3 py-2 text-white" value="${initialValue}" />
              <p class="text-xs text-gray-400">Disponível: ${formatUnitsLabel(safeMax)}.</p>
              <p class="text-xs text-red-400 hidden" data-error></p>
            </div>
            <div class="flex justify-end gap-3 pt-2">
              <button type="button" data-action="cancel" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Cancelar</button>
              <button type="button" data-action="confirm" class="btn-primary px-4 py-2 rounded-lg text-white font-medium">${confirmLabel}</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('input');
      const errorEl = overlay.querySelector('[data-error]');

      const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
      };

      const close = value => {
        cleanup();
        resolve(value);
      };

      const showError = message => {
        if (!errorEl) return;
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
      };

      const clearError = () => errorEl?.classList.add('hidden');

      const confirm = () => {
        clearError();
        const raw = (input?.value || '').trim();
        if (!raw) {
          showError('Informe uma quantidade.');
          return;
        }
        if (!/^\d+$/.test(raw)) {
          showError('Informe um número inteiro.');
          return;
        }
        const value = Number.parseInt(raw, 10);
        if (!Number.isFinite(value) || value < 0) {
          showError('Informe uma quantidade válida.');
          return;
        }
        if (value > safeMax) {
          showError(`Informe um valor menor ou igual a ${formatUnitsLabel(safeMax)}.`);
          return;
        }
        close(value);
      };

      const onKeyDown = e => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter') {
          e.preventDefault();
          confirm();
        }
      };

      overlay.addEventListener('click', e => {
        if (e.target === overlay) close(null);
      });

      overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', () => close(null));
      overlay.querySelector('[data-action="confirm"]')?.addEventListener('click', confirm);
      const sanitizeInput = () => {
        if (!input) return;
        const sanitized = input.value.replace(/[^0-9]/g, '');
        if (sanitized !== input.value) input.value = sanitized;
        clearError();
      };

      input?.addEventListener('keydown', e => {
        if (['e', 'E', ',', '.', '+', '-'].includes(e.key)) {
          e.preventDefault();
        }
      });

      input?.addEventListener('input', sanitizeInput);

      document.addEventListener('keydown', onKeyDown);
      input?.focus();
      input?.select();
    });
  }

  function openConfirmDialog({ title, message, confirmLabel = 'Sim', cancelLabel = 'Não' }) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade">
          <div class="p-6 space-y-6 text-center">
            <div>
              <h3 class="text-lg font-semibold text-white">${title}</h3>
              <p class="text-sm text-gray-300 mt-2">${message}</p>
            </div>
            <div class="flex justify-center gap-4">
              <button type="button" data-action="confirm" class="btn-warning px-5 py-2 rounded-lg text-white font-medium">${confirmLabel}</button>
              <button type="button" data-action="cancel" class="btn-neutral px-5 py-2 rounded-lg text-white font-medium">${cancelLabel}</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
      };

      const close = result => {
        cleanup();
        resolve(result);
      };

      const onKeyDown = e => {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter') {
          e.preventDefault();
          close(true);
        }
      };

      overlay.addEventListener('click', e => {
        if (e.target === overlay) close(false);
      });

      overlay.querySelector('[data-action="confirm"]')?.addEventListener('click', () => close(true));
      overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', () => close(false));
      document.addEventListener('keydown', onKeyDown);
    });
  }

  function resetAllDestinations() {
    destinationState.forEach((state, key) => {
      state.stock = 0;
      state.discard = 0;
      state.reallocations = [];
      state.remaining = normalizeQuantity(state.total);
      updateItemDestinationsUI(key);
    });
    refreshOrdersUI();
  }

  function updateValidation() {
    let pendingUnits = 0;
    let hasAssignments = false;
    destinationState.forEach(state => {
      const assignedStock = normalizeQuantity(state.stock);
      const assignedDiscard = normalizeQuantity(state.discard);
      const assignedReallocate = sumReallocations(state);
      if (assignedStock > 0 || assignedDiscard > 0 || assignedReallocate > 0) {
        hasAssignments = true;
      }
      const remaining = Math.max(0, toNumber(state.total) - (assignedStock + assignedDiscard + assignedReallocate));
      pendingUnits += remaining;
    });
    pendingUnits = normalizeQuantity(pendingUnits);

    let message = '';
    if (!itemKeys.length) {
      message = 'Não há itens para cancelar.';
    } else if (pendingUnits > 0) {
      message = `Defina destino para ${formatUnitsLabel(pendingUnits)} antes de confirmar.`;
    }

    togglePendingBanner(message);
    if (confirmBtn) confirmBtn.disabled = Boolean(message);
    if (resetDestinationsBtn) {
      if (hasAssignments) {
        resetDestinationsBtn.classList.remove('hidden');
      } else {
        resetDestinationsBtn.classList.add('hidden');
      }
    }
  }

  function rebuildMatches() {
    itemMatches.clear();
    const aggregatedMap = new Map();

    itemKeys.forEach(key => {
      const info = itemInfo.get(key);
      if (!info?.signature) return;

      const matches = [];
      (availableOrders || []).forEach(order => {
        const quantity = getOrderMatchQuantity(order, info.signature);
        if (quantity > 0) {
          matches.push({ order, quantity });
          const entry = aggregatedMap.get(order.id) || { order, items: [] };
          entry.items.push({
            key,
            name: info.name,
            quantity,
            quantityLabel: formatQuantity(quantity)
          });
          aggregatedMap.set(order.id, entry);
        }
      });

      if (matches.length) {
        matches.sort((a, b) => compareOrdersByProductionDate(a.order, b.order));
        itemMatches.set(key, matches);
      }

      const reallocateBtn = info?.buttons?.reallocate;
      if (reallocateBtn) {
        const hasMatches = matches.length > 0;
        reallocateBtn.disabled = !hasMatches;
        if (!hasMatches) {
          reallocateBtn.classList.add('opacity-40', 'cursor-not-allowed');
          reallocateBtn.title = 'Nenhum pedido disponível para realocação.';
        } else {
          reallocateBtn.classList.remove('opacity-40', 'cursor-not-allowed');
          reallocateBtn.title = 'Realocar em outro pedido';
        }
      }
    });

    aggregatedOrderEntries = Array.from(aggregatedMap.values());
    aggregatedOrderEntries.sort((a, b) => compareOrdersByProductionDate(a.order, b.order));
  }

  function getAssignedForOrder(orderId) {
    let total = 0;
    destinationState.forEach(state => {
      (state.reallocations || []).forEach(entry => {
        if (String(entry.orderId) === String(orderId)) {
          total += normalizeQuantity(entry.quantity);
        }
      });
    });
    return normalizeQuantity(total);
  }

  function renderAvailableOrders(entries) {
    if (!ordersSection || !ordersList || !ordersEmpty) return;
    const hasEntries = Array.isArray(entries) && entries.length > 0;
    const shouldShowSection = ordersLoading || hasEntries || itemKeys.length > 0;

    if (!shouldShowSection) {
      ordersSection.classList.add('hidden');
      return;
    }

    ordersSection.classList.remove('hidden');
    ordersList.innerHTML = '';

    if (!hasEntries) {
      ordersList.classList.add('hidden');
      ordersEmpty.classList.remove('hidden');
      ordersEmpty.textContent = ordersLoading
        ? 'Carregando pedidos disponíveis...'
        : 'Nenhum pedido compatível encontrado.';
      return;
    }

    ordersEmpty.classList.add('hidden');
    ordersList.classList.remove('hidden');

    entries.forEach(entry => {
      const { order, items } = entry;
      const meta = getOrderMeta(order);
      const badgeClass = isOrderInProduction(order) ? 'badge-warning' : 'badge-neutral';
      const itemsList = (items || []).map(match => `
        <div class="flex items-center justify-between gap-3 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
          <span class="text-xs text-gray-200">${match.name}</span>
          <span class="text-xs font-semibold text-white">${match.quantityLabel}</span>
        </div>
      `).join('');
      const assignedTotal = getAssignedForOrder(order.id);
      const assignedLabel = assignedTotal > 0
        ? `<div class="pt-2 border-t border-white/5 text-xs text-primary-200">Destinado: ${formatUnitsLabel(assignedTotal)}</div>`
        : '';

      const card = document.createElement('div');
      card.className = 'glass-surface rounded-xl border border-white/10 p-4 transition hover:border-primary/40 space-y-3';
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <h4 class="font-medium text-white">#${order.numero || order.id}</h4>
          <span class="${badgeClass} px-2 py-1 rounded-full text-[11px] font-medium">${order.situacao || '—'}</span>
        </div>
        <p class="text-gray-300 text-sm">Cliente: ${order.cliente || '—'}</p>
        <p class="text-gray-300 text-xs">Valor: ${formatCurrency(order.valor_final)}</p>
        <p class="text-xs font-semibold text-red-400">Convertido em ${meta.conversionLabel}</p>
        <span class="inline-flex px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-[11px] font-semibold text-red-300">${meta.daysLabel}</span>
        ${itemsList ? `<div class="space-y-2 pt-2 border-t border-white/5"><p class="text-xs text-gray-300 uppercase tracking-wide">Peças compatíveis</p>${itemsList}</div>` : ''}
        ${assignedLabel}
      `;
      ordersList.appendChild(card);
    });
  }

  function renderDrawerOrdersForItem(key) {
    if (!drawerList || !drawerEmpty) return;
    drawerList.innerHTML = '';
    const matches = key ? itemMatches.get(key) || [] : [];
    const state = destinationState.get(key);
    const hasOrders = matches.length > 0;

    if (!hasOrders) {
      drawerList.classList.add('hidden');
      drawerEmpty.textContent = ordersLoading
        ? 'Carregando pedidos disponíveis...'
        : 'Nenhum pedido disponível para realocação.';
      drawerEmpty.classList.remove('hidden');
      return;
    }

    drawerEmpty.classList.add('hidden');
    drawerList.classList.remove('hidden');

    matches.forEach(({ order, quantity }) => {
      const { conversionLabel, daysLabel } = getOrderMeta(order);
      const badgeClass = isOrderInProduction(order) ? 'badge-warning' : 'badge-success';
      const button = document.createElement('button');
      button.type = 'button';
      const existing = state?.reallocations?.find(entry => String(entry.orderId) === String(order.id));
      const assigned = existing ? normalizeQuantity(existing.quantity) : 0;
      const available = normalizeQuantity((state?.remaining || 0) + assigned);
      button.className = `w-full text-left glass-surface rounded-xl border px-4 py-4 transition hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40 space-y-3 ${assigned > 0 ? 'border-primary/60 bg-primary/10' : 'border-white/10'}`;
      button.innerHTML = `
        <div class="flex items-center justify-between">
          <h4 class="font-medium text-white">#${order.numero || order.id}</h4>
          <span class="${badgeClass} px-2 py-1 rounded-full text-[11px] font-medium">${order.situacao || 'Disponível'}</span>
        </div>
        <div>
          <p class="text-gray-300 text-sm">Cliente: ${order.cliente || '—'}</p>
          <p class="text-gray-300 text-xs">Valor: ${formatCurrency(order.valor_final)}</p>
        </div>
        <div class="space-y-2">
          <p class="text-xs font-semibold text-red-400">Convertido em ${conversionLabel}</p>
          <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-[11px] font-semibold text-red-300">${daysLabel}</span>
            <span class="inline-flex px-2 py-1 rounded-full border border-primary/40 bg-primary/10 text-[11px] font-semibold text-primary-200">Compatível: ${formatQuantity(quantity)}</span>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-gray-300">Disponível para realocar: ${formatUnitsLabel(available)}</span>
          ${assigned > 0 ? `<span class="text-xs text-primary-200 font-semibold">Destino atual: ${formatUnitsLabel(assigned)}</span>` : ''}
        </div>
        <div class="flex justify-end">
          <span class="btn-primary px-3 py-1 rounded text-xs">Selecionar este pedido</span>
        </div>
      `;
      button.addEventListener('click', () => selectReallocationOrder(order.id));
      drawerList.appendChild(button);
    });
  }

  function renderSummary() {
    if (!summarySection || !summaryList) return;
    const reallocationMap = new Map();
    const stockEntries = [];
    const discardEntries = [];

    destinationState.forEach((state, key) => {
      const info = itemInfo.get(key);
      if (!info) return;
      const stockQty = normalizeQuantity(state.stock);
      const discardQty = normalizeQuantity(state.discard);
      if (stockQty > 0) {
        stockEntries.push({ key, name: info.name, quantity: stockQty });
      }
      if (discardQty > 0) {
        discardEntries.push({ key, name: info.name, quantity: discardQty });
      }
      (state.reallocations || []).forEach(entry => {
        const qty = normalizeQuantity(entry.quantity);
        if (qty <= 0) return;
        const bucket = reallocationMap.get(entry.orderId) || { orderId: entry.orderId, total: 0, items: [] };
        bucket.total += qty;
        bucket.items.push({ key, name: info.name, quantity: qty });
        reallocationMap.set(entry.orderId, bucket);
      });
    });

    const hasData = reallocationMap.size || stockEntries.length || discardEntries.length;
    if (!hasData) {
      summarySection.classList.add('hidden');
      summaryList.innerHTML = '';
      return;
    }

    summarySection.classList.remove('hidden');
    summaryList.innerHTML = '';

    if (reallocationMap.size) {
      const heading = document.createElement('p');
      heading.className = 'text-xs uppercase tracking-wide font-semibold text-sky-300';
      heading.textContent = 'Realocações';
      summaryList.appendChild(heading);

      Array.from(reallocationMap.values())
        .sort((a, b) => toNumber(a.orderId) - toNumber(b.orderId))
        .forEach(bucket => {
          const wrapper = document.createElement('div');
          wrapper.className = 'bg-surface/40 rounded-xl border border-white/10 p-4 space-y-3';
          const order = (availableOrders || []).find(o => String(o.id) === String(bucket.orderId));
          const meta = order ? getOrderMeta(order) : null;
          const headerLabel = order ? formatOrderLabel(order.id) : `Pedido ${bucket.orderId}`;
          wrapper.innerHTML = `
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="text-white text-sm font-semibold">${headerLabel}</p>
                ${meta ? `<p class="text-[11px] text-gray-300">Convertido em ${meta.conversionLabel}</p>` : ''}
              </div>
              <span class="badge-info px-3 py-1 rounded-full text-xs font-medium">${formatUnitsLabel(bucket.total)}</span>
            </div>
          `;
          const list = document.createElement('div');
          list.className = 'space-y-2';
          bucket.items.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'w-full flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-left text-xs text-gray-200 hover:border-primary/40 transition';
            btn.innerHTML = `
              <span>${item.name}</span>
              <span class="text-white font-semibold">${formatUnitsLabel(item.quantity)}</span>
            `;
            btn.addEventListener('click', () => openReallocationQuantity(item.key, bucket.orderId));
            list.appendChild(btn);
          });
          wrapper.appendChild(list);
          summaryList.appendChild(wrapper);
        });
    }

    if (stockEntries.length) {
      const heading = document.createElement('p');
      heading.className = 'text-xs uppercase tracking-wide text-emerald-200 font-semibold mt-4';
      heading.textContent = 'Retorno ao estoque';
      summaryList.appendChild(heading);

      const wrapper = document.createElement('div');
      wrapper.className = 'bg-surface/40 rounded-xl border border-white/10 p-4 space-y-2';
      const total = normalizeQuantity(stockEntries.reduce((sum, item) => sum + item.quantity, 0));
      wrapper.innerHTML = `
        <div class="flex items-center justify-between">
          <p class="text-white text-sm font-semibold">Total</p>
          <span class="badge-success px-3 py-1 rounded-full text-xs font-medium">${formatUnitsLabel(total)}</span>
        </div>
      `;
      const list = document.createElement('div');
      list.className = 'space-y-2 pt-2 border-t border-white/5';
      stockEntries.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-left text-xs text-gray-200 hover:border-primary/40 transition';
        btn.innerHTML = `
          <span>${item.name}</span>
          <span class="text-white font-semibold">${formatUnitsLabel(item.quantity)}</span>
        `;
        btn.addEventListener('click', () => handleSimpleAction(item.key, 'stock'));
        list.appendChild(btn);
      });
      wrapper.appendChild(list);
      summaryList.appendChild(wrapper);
    }

    if (discardEntries.length) {
      const heading = document.createElement('p');
      heading.className = 'text-xs uppercase tracking-wide text-red-200 font-semibold mt-4';
      heading.textContent = 'Descartes';
      summaryList.appendChild(heading);

      const wrapper = document.createElement('div');
      wrapper.className = 'bg-surface/40 rounded-xl border border-white/10 p-4 space-y-2';
      const total = normalizeQuantity(discardEntries.reduce((sum, item) => sum + item.quantity, 0));
      wrapper.innerHTML = `
        <div class="flex items-center justify-between">
          <p class="text-white text-sm font-semibold">Total</p>
          <span class="badge-danger px-3 py-1 rounded-full text-xs font-medium">${formatUnitsLabel(total)}</span>
        </div>
      `;
      const list = document.createElement('div');
      list.className = 'space-y-2 pt-2 border-t border-white/5';
      discardEntries.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-left text-xs text-gray-200 hover:border-primary/40 transition';
        btn.innerHTML = `
          <span>${item.name}</span>
          <span class="text-white font-semibold">${formatUnitsLabel(item.quantity)}</span>
        `;
        btn.addEventListener('click', () => handleSimpleAction(item.key, 'discard'));
        list.appendChild(btn);
      });
      wrapper.appendChild(list);
      summaryList.appendChild(wrapper);
    }
  }

  function refreshOrdersUI() {
    renderAvailableOrders(aggregatedOrderEntries);
    if (currentReallocationKey) {
      renderDrawerOrdersForItem(currentReallocationKey);
    } else if (drawerList) {
      drawerList.innerHTML = '';
    }
    renderSummary();
    updateValidation();
  }

  function openDrawer(key) {
    if (!drawer || !drawerPanel) return;
    const state = destinationState.get(key);
    const hasExisting = state?.reallocations?.some(entry => normalizeQuantity(entry.quantity) > 0);
    if (!hasExisting && (!state || normalizeQuantity(state.remaining) <= 0)) {
      if (typeof showToast === 'function') {
        showToast('Não há quantidade disponível para realocar. Ajuste outras destinações primeiro.', 'info');
      } else if (typeof window.alert === 'function') {
        window.alert('Não há quantidade disponível para realocar. Ajuste outras destinações primeiro.');
      }
      return;
    }
    currentReallocationKey = key;
    updateDrawerHeader(key);
    renderDrawerOrdersForItem(key);
    drawer.classList.remove('hidden');
    requestAnimationFrame(() => drawerPanel.classList.remove('translate-x-full'));
  }

  function closeDrawer() {
    if (!drawer || !drawerPanel) return;
    drawerPanel.classList.add('translate-x-full');
    setTimeout(() => {
      drawer?.classList.add('hidden');
      currentReallocationKey = null;
    }, 300);
  }

  drawerOverlay?.addEventListener('click', closeDrawer);
  document.getElementById('cancelarPedidoDrawerFechar')?.addEventListener('click', closeDrawer);

  async function handleSimpleAction(key, action) {
    const info = itemInfo.get(key);
    const state = ensureDestinationState(key, info?.quantity || 0);
    const currentValue = normalizeQuantity(state[action] || 0);
    const max = normalizeQuantity(state.remaining + currentValue);
    if (max <= 0 && currentValue <= 0) {
      const message = 'Todas as unidades deste item já possuem destino definido.';
      if (typeof showToast === 'function') {
        showToast(message, 'info');
      } else if (typeof window.alert === 'function') {
        window.alert(message);
      }
      return;
    }

    const titles = {
      stock: 'Retorno ao estoque',
      discard: 'Descartar item'
    };
    const descriptions = {
      stock: `Informe a quantidade de ${info?.name || 'itens'} que retornará ao estoque.`,
      discard: `Informe a quantidade de ${info?.name || 'itens'} que será descartada.`
    };

    const quantity = await openQuantityDialog({
      title: titles[action] || 'Definir quantidade',
      description: descriptions[action] || '',
      max,
      initial: currentValue,
      confirmLabel: 'Salvar'
    });

    if (quantity === null) return;

    state[action] = normalizeQuantity(quantity);
    updateItemDestinationsUI(key);
    refreshOrdersUI();
  }

  function handleReallocateClick(key) {
    if (ordersLoading) {
      if (typeof showToast === 'function') {
        showToast('Aguarde o carregamento dos pedidos disponíveis.', 'info');
      } else if (typeof window.alert === 'function') {
        window.alert('Aguarde o carregamento dos pedidos disponíveis.');
      }
      return;
    }
    const matches = itemMatches.get(key) || [];
    const state = destinationState.get(key);
    const hasExisting = state?.reallocations?.some(entry => normalizeQuantity(entry.quantity) > 0);
    if (!matches.length && !hasExisting) {
      const message = 'Nenhum pedido em produção possui esta peça disponível para realocação.';
      if (typeof showToast === 'function') {
        showToast(message, 'warning');
      } else if (typeof window.alert === 'function') {
        window.alert(message);
      }
      return;
    }
    openDrawer(key);
  }

  async function openReallocationQuantity(key, orderId) {
    const info = itemInfo.get(key);
    const state = ensureDestinationState(key, info?.quantity || 0);
    const existing = (state.reallocations || []).find(entry => String(entry.orderId) === String(orderId));
    const currentValue = existing ? normalizeQuantity(existing.quantity) : 0;
    const available = normalizeQuantity(state.remaining + currentValue);

    if (available <= 0 && currentValue <= 0) {
      const message = 'Não há quantidade disponível para realocar para este pedido.';
      if (typeof showToast === 'function') {
        showToast(message, 'info');
      } else if (typeof window.alert === 'function') {
        window.alert(message);
      }
      return false;
    }

    const quantity = await openQuantityDialog({
      title: `Realocar para ${formatOrderLabel(orderId)}`,
      description: `Informe a quantidade de ${info?.name || 'itens'} que será realocada para este pedido.`,
      max: available,
      initial: currentValue,
      confirmLabel: 'Salvar realocação'
    });

    if (quantity === null) return false;

    const normalized = normalizeQuantity(quantity);
    if (normalized <= 0) {
      state.reallocations = (state.reallocations || []).filter(entry => String(entry.orderId) !== String(orderId));
    } else if (existing) {
      existing.quantity = normalized;
    } else {
      state.reallocations.push({ orderId, quantity: normalized });
    }
    updateItemDestinationsUI(key);
    refreshOrdersUI();
    return true;
  }

  async function selectReallocationOrder(orderId) {
    if (!currentReallocationKey) return;
    const updated = await openReallocationQuantity(currentReallocationKey, orderId);
    if (updated) closeDrawer();
  }

  const nameFallback = (item, index) => item.nome || item.descricao || item.produto || `Item ${index + 1}`;
  const origemFallback = item => item.origem || item.origem_item || item.origem_producao || '';
  const statusFallback = item => item.status || item.situacao || '';

  if (statusTag && (context.status || pedido.situacao)) {
    statusTag.textContent = context.status || pedido.situacao;
    statusTag.classList.remove('hidden');
  }

  itemKeys.length = 0;
  destinationState.clear();
  if (itensBody) itensBody.innerHTML = '';
  if (!itens.length) {
    itensEmpty?.classList.remove('hidden');
  } else {
    itensEmpty?.classList.add('hidden');
    itens.forEach((item, index) => {
      const key = String(item.id ?? index);
      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/10';
      tr.dataset.key = key;

      const name = nameFallback(item, index);
      const quantity = extractQuantity(item);
      const quantityLabel = formatQuantity(quantity);
      const origem = origemFallback(item) || '—';
      const situacao = statusFallback(item) || '—';

      const nameTd = document.createElement('td');
      nameTd.className = 'px-4 py-3 text-left text-sm text-white';
      nameTd.textContent = name;

      const qtyTd = document.createElement('td');
      qtyTd.className = 'px-4 py-3 text-center text-sm text-white';
      qtyTd.textContent = formatNumber(quantity);

      const remainingTd = document.createElement('td');
      remainingTd.className = 'px-4 py-3 text-center text-sm font-semibold text-orange-200';
      remainingTd.textContent = formatNumber(quantity);

      const origemTd = document.createElement('td');
      origemTd.className = 'px-4 py-3 text-center text-sm text-gray-200';
      origemTd.textContent = origem;

      const situacaoTd = document.createElement('td');
      situacaoTd.className = 'px-4 py-3 text-center text-sm text-gray-200';
      situacaoTd.textContent = situacao;

      const actionTd = document.createElement('td');
      actionTd.className = 'px-4 py-3 text-center text-sm';
      const actionsWrapper = document.createElement('div');
      actionsWrapper.className = 'flex flex-col items-center gap-3';

      const buttonsRow = document.createElement('div');
      buttonsRow.className = 'flex items-center justify-center gap-2';

      const createActionButton = (iconClass, title, onClick, extraClasses = '', iconColorClass = '') => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `w-10 h-10 flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-lg text-white hover:border-primary/40 transition focus:outline-none focus:ring-2 focus:ring-primary/40 ${extraClasses}`;
        btn.title = title;
        btn.innerHTML = `<i class="fas ${iconClass} ${iconColorClass}" aria-hidden="true"></i>`;
        btn.addEventListener('click', onClick);
        return btn;
      };

      const stockBtn = createActionButton('fa-box-open', 'Retornar ao estoque', () => handleSimpleAction(key, 'stock'), '', 'text-emerald-300');
      const reallocateBtn = createActionButton('fa-exchange-alt', 'Realocar em outro pedido', () => handleReallocateClick(key), '', 'text-sky-300');
      const discardBtn = createActionButton('fa-trash', 'Descartar peça', () => handleSimpleAction(key, 'discard'), '', 'text-red-400');

      buttonsRow.append(stockBtn, reallocateBtn, discardBtn);

      const assignmentsContainer = document.createElement('div');
      assignmentsContainer.className = 'w-full flex flex-col items-center gap-2 mt-1';

      actionsWrapper.append(buttonsRow, assignmentsContainer);
      actionTd.appendChild(actionsWrapper);

      tr.append(nameTd, qtyTd, remainingTd, origemTd, situacaoTd, actionTd);
      itensBody?.appendChild(tr);

      itemKeys.push(key);
      const signature = buildItemSignature(item);
      itemInfo.set(key, {
        item,
        name,
        quantity,
        quantityLabel,
        signature,
        remainingCell: remainingTd,
        assignmentsContainer,
        buttons: { stock: stockBtn, reallocate: reallocateBtn, discard: discardBtn }
      });
      ensureDestinationState(key, quantity);
      updateItemDestinationsUI(key);
    });
  }

  resetDestinationsBtn?.addEventListener('click', async () => {
    const confirmed = await openConfirmDialog({
      title: 'Reiniciar destinação',
      message: 'Deseja reiniciar a destinação das peças? As quantidades definidas serão perdidas.',
      confirmLabel: 'Sim, reiniciar',
      cancelLabel: 'Manter'
    });
    if (!confirmed) return;
    resetAllDestinations();
  });

  const ensureAvailableOrdersLoaded = async () => {
    ordersLoading = true;
    renderAvailableOrders(aggregatedOrderEntries);
    if (currentReallocationKey) {
      renderDrawerOrdersForItem(currentReallocationKey);
    }

    try {
      let list = Array.isArray(availableOrders) ? [...availableOrders] : [];
      if (!list.length) {
        try {
          const resp = await fetch('http://localhost:3000/api/pedidos');
          if (resp.ok) {
            list = await resp.json();
          }
        } catch (err) {
          console.error('Erro ao carregar pedidos para realocação', err);
        }
      }

      list = list
        .filter(order => order && String(order.id) !== String(pedidoId))
        .filter(order => (order?.situacao || '') !== 'Cancelado')
        .filter(order => isOrderInProduction(order));

      const prepared = [];

      for (const raw of list) {
        const order = { ...raw };
        if (!Array.isArray(order.itens)) {
          try {
            const resp = await fetch(`http://localhost:3000/api/pedidos/${order.id}`);
            if (resp.ok) {
              const details = await resp.json();
              order.itens = Array.isArray(details.itens) ? details.itens : [];
              if (!order.data_aprovacao && details.data_aprovacao) {
                order.data_aprovacao = details.data_aprovacao;
              }
              if (!order.situacao && details.situacao) {
                order.situacao = details.situacao;
              }
            } else {
              order.itens = [];
            }
          } catch (err) {
            console.error(`Erro ao carregar itens do pedido ${order.id}`, err);
            order.itens = [];
          }
        }

        ensureOrderMetadata(order);
        if (!Array.isArray(order.__itemEntries) || !order.__itemEntries.length) {
          order.__itemEntries = buildOrderItemEntries(order.itens);
        }

        if (Array.isArray(order.__itemEntries) && order.__itemEntries.some(entry => Number(entry.quantity) > 0)) {
          prepared.push(order);
        }
      }

      availableOrders = prepared.sort(compareOrdersByProductionDate);
      rebuildMatches();
    } catch (err) {
      console.error('Erro ao preparar lista de pedidos para realocação', err);
      availableOrders = [];
      rebuildMatches();
    } finally {
      ordersLoading = false;
      refreshOrdersUI();
      markReady(true);
    }
  };

  rebuildMatches();
  refreshOrdersUI();
  await ensureAvailableOrdersLoaded();

  const infoParts = [];
  if (pedido.numero || context.numero) infoParts.push(`#${pedido.numero || context.numero}`);
  if (context.cliente) infoParts.push(context.cliente);
  const emissao = context.dataEmissao || pedido.data_emissao || pedido.dataEmissao;
  if (emissao) infoParts.push(formatDate(emissao));
  document.getElementById('cancelarPedidoInfo').textContent = infoParts.join(' • ');

  const confirm = async () => {
    if (!confirmBtn || confirmBtn.disabled) return;

    const actions = [];
    let totalReallocate = 0;
    let totalStock = 0;
    let totalDiscard = 0;

    destinationState.forEach((state, key) => {
      const info = itemInfo.get(key);
      if (!info) return;
      const base = { item: info.item || null };

      const stockQty = normalizeQuantity(state.stock);
      if (stockQty > 0) {
        actions.push({ ...base, action: 'stock', quantity: stockQty });
        totalStock += stockQty;
      }

      const discardQty = normalizeQuantity(state.discard);
      if (discardQty > 0) {
        actions.push({ ...base, action: 'discard', quantity: discardQty });
        totalDiscard += discardQty;
      }

      (state.reallocations || []).forEach(entry => {
        const qty = normalizeQuantity(entry.quantity);
        if (qty <= 0) return;
        actions.push({ ...base, action: 'reallocate', orderId: entry.orderId, quantity: qty });
        totalReallocate += qty;
      });
    });

    const messageLines = ['Confirmar cancelamento do pedido?'];
    if (totalReallocate > 0) messageLines.push(`• ${formatUnitsLabel(totalReallocate)} serão realocadas para outros pedidos.`);
    if (totalStock > 0) messageLines.push(`• ${formatUnitsLabel(totalStock)} retornarão ao estoque.`);
    if (totalDiscard > 0) messageLines.push(`• ${formatUnitsLabel(totalDiscard)} serão descartadas.`);

    if (!window.confirm(messageLines.join('\n'))) return;

    const originalText = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Cancelando...';

    try {
      const resp = await fetch(`http://localhost:3000/api/pedidos/${pedidoId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Cancelado', acoes: actions })
      });
      if (!resp.ok) throw new Error('Falha ao cancelar pedido');
      if (typeof showToast === 'function') showToast('Pedido cancelado com sucesso.', 'success');
      close();
      if (typeof window.carregarPedidos === 'function') {
        try {
          await window.carregarPedidos();
        } catch (err) {
          console.error('Erro ao recarregar pedidos', err);
        }
      }
    } catch (err) {
      console.error('Erro ao cancelar pedido', err);
      if (typeof showToast === 'function') showToast('Erro ao cancelar pedido.', 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalText;
      return;
    }
  };

  confirmBtn?.addEventListener('click', confirm);
  updateValidation();
})();
