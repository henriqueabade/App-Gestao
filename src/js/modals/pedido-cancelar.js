(async () => {
  const overlayId = 'cancelarPedido';
  const overlay = document.getElementById('cancelarPedidoOverlay');
  if (!overlay) return;

  const context = window.cancelarPedidoContext;
  if (!context || !context.pedido) {
    Modal.close(overlayId);
    return;
  }

  const pedido = context.pedido;
  const pedidoId = context.id || context.pedidoId || pedido.id;
  const itens = Array.isArray(pedido.itens) ? pedido.itens : [];

  const pendingBanner = document.getElementById('cancelarPedidoPendencias');
  const pendingText = document.getElementById('cancelarPedidoPendenciasTexto');
  const confirmBtn = document.getElementById('cancelarPedidoConfirmar');
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

  const actionState = new Map();
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
    const num = Number(value ?? 0);
    return `${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${num === 1 ? 'unidade' : 'unidades'}`;
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

  const togglePendingBanner = message => {
    if (!pendingBanner || !pendingText) return;
    if (message) {
      pendingBanner.classList.remove('hidden');
      pendingText.textContent = message;
    } else {
      pendingBanner.classList.add('hidden');
      pendingText.textContent = '';
    }
  };

  const updateValidation = () => {
    const total = itemKeys.length;
    const assigned = itemKeys.filter(key => actionState.get(key)?.action).length;
    const pending = total - assigned;
    const reallocatePending = itemKeys.filter(key => {
      const state = actionState.get(key);
      return state?.action === 'reallocate' && !state.orderId;
    }).length;

    let message = '';
    if (!total) {
      message = 'Não há itens para cancelar.';
    } else if (pending > 0) {
      message = `Defina destino para ${pending} ${pending === 1 ? 'item' : 'itens'} antes de confirmar.`;
    } else if (reallocatePending > 0) {
      message = `Selecione o pedido de destino para ${reallocatePending} ${reallocatePending === 1 ? 'item realocado' : 'itens realocados'}.`;
    }

    togglePendingBanner(message);
    if (confirmBtn) confirmBtn.disabled = Boolean(message);
  };

  const rebuildMatches = () => {
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
    });

    aggregatedOrderEntries = Array.from(aggregatedMap.values());
    aggregatedOrderEntries.sort((a, b) => compareOrdersByProductionDate(a.order, b.order));

    itemKeys.forEach(key => {
      const info = itemInfo.get(key);
      if (!info?.reallocateOption) return;
      const hasMatches = itemMatches.has(key);
      info.reallocateOption.disabled = !hasMatches;
      info.reallocateOption.textContent = hasMatches
        ? '🔄 Realocar em outro pedido'
        : '🔄 Realocar indisponível';

      if (!hasMatches && actionState.get(key)?.action === 'reallocate') {
        actionState.delete(key);
        if (info.select) info.select.value = '';
      }
    });
  };

  const renderAvailableOrders = entries => {
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
      `;
      ordersList.appendChild(card);
    });
  };

  const renderDrawerOrdersForItem = key => {
    if (!drawerList || !drawerEmpty) return;
    drawerList.innerHTML = '';
    const matches = key ? itemMatches.get(key) || [] : [];
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
      button.className = 'w-full text-left glass-surface rounded-xl border border-white/10 px-4 py-4 transition hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40 space-y-3';
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
            <span class="inline-flex px-2 py-1 rounded-full border border-primary/40 bg-primary/10 text-[11px] font-semibold text-primary-200">Possui ${formatQuantity(quantity)}</span>
          </div>
        </div>
        <div class="flex justify-end">
          <span class="btn-primary px-3 py-1 rounded text-xs">Selecionar este pedido</span>
        </div>
      `;
      button.addEventListener('click', () => selectReallocationOrder(order.id));
      drawerList.appendChild(button);
    });
  };

  const renderSummary = () => {
    if (!summarySection || !summaryList) return;
    const reallocateItems = itemKeys.filter(key => actionState.get(key)?.action === 'reallocate');
    if (!reallocateItems.length) {
      summarySection.classList.add('hidden');
      summaryList.innerHTML = '';
      return;
    }

    summarySection.classList.remove('hidden');
    summaryList.innerHTML = '';

    reallocateItems.forEach(key => {
      const info = itemInfo.get(key);
      const state = actionState.get(key) || {};
      const matches = itemMatches.get(key) || [];
      const selectedMatch = state.orderId
        ? matches.find(m => String(m.order.id) === String(state.orderId))
        : null;
      const badgeClass = state.orderId ? 'badge-success' : 'badge-warning';
      const badgeText = state.orderId ? formatOrderLabel(state.orderId) : 'Aguardando destino';
      const actionLabel = state.orderId ? 'Alterar destino' : 'Escolher pedido';
      const orderMeta = selectedMatch ? getOrderMeta(selectedMatch.order) : null;
      const quantityLabel = selectedMatch ? formatQuantity(selectedMatch.quantity) : '';

      const wrapper = document.createElement('div');
      wrapper.className = 'flex flex-col gap-3 bg-surface/40 rounded-xl p-4 border border-white/10';

      const header = document.createElement('div');
      header.className = 'flex flex-wrap items-start justify-between gap-3';
      header.innerHTML = `
        <div>
          <p class="text-white text-sm font-medium">${info?.name || 'Item'}</p>
          <p class="text-gray-300 text-xs">${info?.quantityLabel || ''}</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">${badgeText}</span>
          <button data-item="${key}" class="btn-primary px-3 py-2 rounded-lg text-white text-xs">${actionLabel}</button>
        </div>
      `;
      wrapper.appendChild(header);

      if (selectedMatch && orderMeta) {
        const details = document.createElement('div');
        details.className = 'flex flex-wrap items-center gap-2';
        details.innerHTML = `
          <p class="text-xs font-semibold text-red-400">Convertido em ${orderMeta.conversionLabel}</p>
          <span class="inline-flex px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-[11px] font-semibold text-red-300">${orderMeta.daysLabel}</span>
          <span class="inline-flex px-2 py-1 rounded-full border border-primary/40 bg-primary/10 text-[11px] font-semibold text-primary-200">Possui ${quantityLabel}</span>
        `;
        wrapper.appendChild(details);
      }

      const button = header.querySelector('button');
      button?.addEventListener('click', () => openDrawer(key));
      summaryList.appendChild(wrapper);
    });
  };

  const refreshOrdersUI = () => {
    renderAvailableOrders(aggregatedOrderEntries);
    if (currentReallocationKey) {
      renderDrawerOrdersForItem(currentReallocationKey);
    } else if (drawerList) {
      drawerList.innerHTML = '';
    }
    renderSummary();
    updateValidation();
  };

  const openDrawer = key => {
    if (!drawer || !drawerPanel) return;
    currentReallocationKey = key;
    const info = itemInfo.get(key);
    if (drawerItem) drawerItem.textContent = info ? `${info.name} (${info.quantityLabel})` : '';
    renderDrawerOrdersForItem(key);
    drawer.classList.remove('hidden');
    requestAnimationFrame(() => drawerPanel.classList.remove('translate-x-full'));
  };

  const closeDrawer = () => {
    if (!drawer || !drawerPanel) return;
    drawerPanel.classList.add('translate-x-full');
    setTimeout(() => {
      drawer?.classList.add('hidden');
      currentReallocationKey = null;
    }, 300);
  };

  drawerOverlay?.addEventListener('click', closeDrawer);
  document.getElementById('cancelarPedidoDrawerFechar')?.addEventListener('click', closeDrawer);

  const ensureActionEntry = key => {
    if (!actionState.has(key)) {
      actionState.set(key, { action: '', orderId: null });
    }
    return actionState.get(key);
  };

  const handleActionChange = (key, action) => {
    const info = itemInfo.get(key);
    const state = ensureActionEntry(key);
    let finalAction = action;

    if (action === 'reallocate') {
      if (ordersLoading) {
        if (typeof showToast === 'function') {
          showToast('Aguarde o carregamento dos pedidos disponíveis.', 'info');
        } else if (typeof window.alert === 'function') {
          window.alert('Aguarde o carregamento dos pedidos disponíveis.');
        }
        if (info?.select) info.select.value = '';
        finalAction = '';
      } else {
        const matches = itemMatches.get(key) || [];
        if (!matches.length) {
          const message = 'Nenhum pedido em produção possui esta peça disponível para realocação.';
          if (typeof showToast === 'function') {
            showToast(message, 'warning');
          } else if (typeof window.alert === 'function') {
            window.alert(message);
          }
          if (info?.select) info.select.value = '';
          finalAction = '';
        } else if (!state.orderId) {
          openDrawer(key);
        }
      }
    }

    state.action = finalAction;
    if (finalAction !== 'reallocate') {
      state.orderId = null;
      if (drawer && !drawer.classList.contains('hidden') && currentReallocationKey === key) {
        closeDrawer();
      }
    }

    if (!finalAction) {
      actionState.delete(key);
    } else {
      actionState.set(key, state);
    }

    renderSummary();
    updateValidation();
  };

  const selectReallocationOrder = orderId => {
    if (!currentReallocationKey) return;
    const info = itemInfo.get(currentReallocationKey);
    const state = ensureActionEntry(currentReallocationKey);
    state.action = 'reallocate';
    state.orderId = orderId;
    actionState.set(currentReallocationKey, state);
    if (info?.select) info.select.value = 'reallocate';
    closeDrawer();
    renderSummary();
    updateValidation();
  };

  const nameFallback = (item, index) => item.nome || item.descricao || item.produto || `Item ${index + 1}`;
  const origemFallback = item => item.origem || item.origem_item || item.origem_producao || '';
  const statusFallback = item => item.status || item.situacao || '';

  if (statusTag && (context.status || pedido.situacao)) {
    statusTag.textContent = context.status || pedido.situacao;
    statusTag.classList.remove('hidden');
  }

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
      qtyTd.textContent = Number(quantity ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const origemTd = document.createElement('td');
      origemTd.className = 'px-4 py-3 text-center text-sm text-gray-200';
      origemTd.textContent = origem;

      const situacaoTd = document.createElement('td');
      situacaoTd.className = 'px-4 py-3 text-center text-sm text-gray-200';
      situacaoTd.textContent = situacao;

      const actionTd = document.createElement('td');
      actionTd.className = 'px-4 py-3 text-center text-sm';
      const select = document.createElement('select');
      select.className = 'w-full bg-input border border-inputBorder rounded-lg px-3 py-2 text-white text-xs focus:border-primary focus:ring-2 focus:ring-primary/50 transition appearance-none';
      select.innerHTML = `
        <option value="">Selecionar ação...</option>
        <option value="stock">📦 Retornar ao estoque</option>
        <option value="reallocate">🔄 Realocar em outro pedido</option>
        <option value="discard">🗑️ Descartar</option>`;
      select.addEventListener('change', e => handleActionChange(key, e.target.value));
      actionTd.appendChild(select);

      tr.append(nameTd, qtyTd, origemTd, situacaoTd, actionTd);
      itensBody?.appendChild(tr);

      itemKeys.push(key);
      const signature = buildItemSignature(item);
      const reallocateOption = select.querySelector('option[value="reallocate"]');
      itemInfo.set(key, { item, name, quantity, quantityLabel, select, signature, reallocateOption });
    });
  }

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
    const actions = itemKeys.map(key => {
      const info = itemInfo.get(key);
      const state = actionState.get(key) || { action: '', orderId: null };
      return {
        item: info?.item || null,
        action: state.action,
        orderId: state.orderId
      };
    });

    const hasReallocations = actions.some(a => a.action === 'reallocate');
    const hasDiscards = actions.some(a => a.action === 'discard');
    const messageLines = ['Confirmar cancelamento do pedido?'];
    if (hasReallocations) messageLines.push('• Alguns itens serão realocados para outros pedidos.');
    if (hasDiscards) messageLines.push('• Alguns itens serão descartados.');
    if (actions.some(a => a.action === 'stock')) messageLines.push('• Demais itens retornarão ao estoque.');

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
