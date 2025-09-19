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

  const renderSummary = () => {
    if (!summarySection || !summaryList) return;
    const reallocateItems = itemKeys.filter(key => actionState.get(key)?.action === 'reallocate');
    if (!reallocateItems.length) {
      summarySection.classList.add('hidden');
      summaryList.innerHTML = '';
      ordersSection?.classList.add('hidden');
      return;
    }

    summarySection.classList.remove('hidden');
    ordersSection?.classList.remove('hidden');
    summaryList.innerHTML = '';

    reallocateItems.forEach(key => {
      const info = itemInfo.get(key);
      const state = actionState.get(key) || {};
      const badgeClass = state.orderId ? 'badge-success' : 'badge-warning';
      const badgeText = state.orderId ? formatOrderLabel(state.orderId) : 'Aguardando destino';
      const actionLabel = state.orderId ? 'Alterar destino' : 'Escolher pedido';

      const wrapper = document.createElement('div');
      wrapper.className = 'flex flex-wrap items-center justify-between gap-3 bg-surface/40 rounded-xl p-4 border border-white/10';
      wrapper.innerHTML = `
        <div>
          <p class="text-white text-sm font-medium">${info?.name || 'Item'}</p>
          <p class="text-gray-300 text-xs">${info?.quantityLabel || ''}</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">${badgeText}</span>
          <button data-item="${key}" class="btn-primary px-3 py-2 rounded-lg text-white text-xs">${actionLabel}</button>
        </div>`;
      const button = wrapper.querySelector('button');
      button?.addEventListener('click', () => openDrawer(key));
      summaryList.appendChild(wrapper);
    });
  };

  const renderAvailableOrders = orders => {
    if (!ordersSection || !ordersList || !ordersEmpty) return;
    ordersList.innerHTML = '';
    const hasOrders = Array.isArray(orders) && orders.length > 0;
    ordersList.classList.toggle('hidden', !hasOrders);
    if (!hasOrders) {
      ordersEmpty.classList.remove('hidden');
      return;
    }

    ordersEmpty.classList.add('hidden');

    orders.forEach(order => {
      const card = document.createElement('div');
      card.className = 'glass-surface rounded-xl border border-white/10 p-4 transition hover:border-primary/40';
      card.innerHTML = `
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-medium text-white">#${order.numero || order.id}</h4>
          <span class="badge-neutral px-2 py-1 rounded-full text-[11px] font-medium">${order.situacao || '—'}</span>
        </div>
        <p class="text-gray-300 text-sm mb-1">Cliente: ${order.cliente || '—'}</p>
        <p class="text-gray-300 text-xs">Valor: ${formatCurrency(order.valor_final)}</p>`;
      ordersList.appendChild(card);
    });
  };

  const renderDrawerOrders = orders => {
    if (!drawerList || !drawerEmpty) return;
    drawerList.innerHTML = '';
    const hasOrders = Array.isArray(orders) && orders.length > 0;
    drawerList.classList.toggle('hidden', !hasOrders);
    if (!hasOrders) {
      drawerEmpty.classList.remove('hidden');
      return;
    }
    drawerEmpty.classList.add('hidden');

    orders.forEach(order => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'w-full text-left glass-surface rounded-xl border border-white/10 px-4 py-4 transition hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40';
      const badgeClass = order.situacao === 'Produção' || order.situacao === 'Em Produção' ? 'badge-warning' : 'badge-success';
      button.innerHTML = `
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-medium text-white">#${order.numero || order.id}</h4>
          <span class="${badgeClass} px-2 py-1 rounded-full text-[11px] font-medium">${order.situacao || 'Disponível'}</span>
        </div>
        <p class="text-gray-300 text-sm mb-1">Cliente: ${order.cliente || '—'}</p>
        <p class="text-gray-300 text-xs">Valor: ${formatCurrency(order.valor_final)}</p>
        <div class="mt-3 flex justify-end">
          <span class="btn-primary px-3 py-1 rounded text-xs">Selecionar este pedido</span>
        </div>`;
      button.addEventListener('click', () => selectReallocationOrder(order.id));
      drawerList.appendChild(button);
    });
  };

  const openDrawer = key => {
    if (!drawer || !drawerPanel) return;
    currentReallocationKey = key;
    const info = itemInfo.get(key);
    if (drawerItem) drawerItem.textContent = info ? `${info.name} (${info.quantityLabel})` : '';
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
    const state = ensureActionEntry(key);
    state.action = action;
    if (action !== 'reallocate') {
      state.orderId = null;
      if (drawer && !drawer.classList.contains('hidden') && currentReallocationKey === key) {
        closeDrawer();
      }
    } else if (!state.orderId) {
      openDrawer(key);
    }
    if (!action) {
      actionState.delete(key);
    } else {
      actionState.set(key, state);
    }
    updateValidation();
    renderSummary();
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
      const quantity = item.quantidade ?? item.qtd ?? item.quantidade_total ?? 0;
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
      itemInfo.set(key, { item, name, quantity, quantityLabel, select });
    });
  }

  if (!availableOrders) {
    try {
      const resp = await fetch('http://localhost:3000/api/pedidos');
      if (resp.ok) {
        const data = await resp.json();
        availableOrders = data.filter(order => String(order.id) !== String(pedidoId) && order.situacao !== 'Cancelado');
      }
    } catch (err) {
      console.error('Erro ao carregar pedidos para realocação', err);
    }
  }

  renderAvailableOrders(availableOrders || []);
  renderDrawerOrders(availableOrders || []);
  renderSummary();

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
