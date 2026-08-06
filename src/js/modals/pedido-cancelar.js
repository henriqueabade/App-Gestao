(async () => {
  const overlayId = 'cancelarPedido';
  const overlay = document.getElementById('cancelarPedidoOverlay');
  if (!overlay) return;

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

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

  // ------------------------------------------------------------------
  // Opções de estorno: em QUE PONTO DA ROTA cada peça pode voltar.
  //
  // Uma peça não volta só "para o estoque": ela volta num estágio. Devolver uma
  // peça parada no insumo 12 de 15 significa que ela entra no estoque naquele
  // ponto e que os 3 passos restantes, que esta conversão já pagou, voltam para
  // a matéria-prima. Sem essa escolha, o estorno só sabia devolver tudo ou nada.
  //
  // O backend manda, por peça: a rota inteira (o TETO) e de onde cada unidade
  // veio (o PISO — ninguém desmonta uma peça para devolvê-la mais atrás).
  // ------------------------------------------------------------------
  const estornoPorItem = new Map();

  async function carregarOpcoesDeEstorno() {
    if (!pedidoId) return;
    try {
      const resp = await fetchApi(`/api/pedidos/${pedidoId}/estorno-opcoes`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const dados = await resp.json();
      (dados?.itens || []).forEach(item => {
        estornoPorItem.set(String(item.pedido_item_id), item);
      });
    } catch (err) {
      // Sem as opções a tela continua funcionando: o estorno volta a ser
      // "como estava", que é o comportamento seguro.
      console.error('Não foi possível carregar as opções de estorno', err);
    }
  }

  /**
   * Confirmação no padrão do app, no lugar de `window.confirm`.
   *
   * Mesma moldura dos outros diálogos (vidro, borda vermelha para ação
   * destrutiva) e o mesmo comportamento: Esc e clique fora cancelam. Devolve
   * uma promessa para o chamador poder `await`.
   */
  function confirmarNoPadrao(linhas = []) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
      overlay.style.zIndex = 'var(--z-dialog)';
      overlay.innerHTML = `
        <div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-red-500/20 ring-1 ring-red-500/30 shadow-2xl/40 animate-modalFade">
          <div class="p-6 space-y-4">
            <div class="text-center">
              <h3 class="text-lg font-semibold text-red-400">Confirmar cancelamento</h3>
              <p class="text-sm text-gray-300 mt-1">Esta ação reverte peças e insumos e não pode ser desfeita.</p>
            </div>
            ${linhas.length ? `
              <ul class="space-y-1 text-sm text-gray-200 bg-white/5 border border-white/10 rounded-lg p-3">
                ${linhas.map(l => `<li>• ${l}</li>`).join('')}
              </ul>` : ''}
            <div class="flex justify-center gap-3 pt-1">
              <button type="button" data-acao="nao" class="btn-neutral px-5 py-2 rounded-lg text-white font-medium">Voltar</button>
              <button type="button" data-acao="sim" class="btn-danger px-5 py-2 rounded-lg text-white font-medium">Confirmar cancelamento</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const encerrar = valor => {
        document.removeEventListener('keydown', aoTeclar);
        overlay.remove();
        resolve(valor);
      };
      function aoTeclar(e) { if (e.key === 'Escape') encerrar(false); }

      overlay.querySelector('[data-acao="sim"]')?.addEventListener('click', () => encerrar(true));
      overlay.querySelector('[data-acao="nao"]')?.addEventListener('click', () => encerrar(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) encerrar(false); });
      document.addEventListener('keydown', aoTeclar);
    });
  }

  /**
   * O ponto de ORIGEM da linha, por extenso.
   *
   * Realocação e descarte não escolhem estágio — a peça vai (ou volta) como
   * está. Sem este rótulo, o resumo mostrava quatro linhas idênticas com o nome
   * do produto e nada que as distinguisse.
   */
  function rotuloDaOrigem(key) {
    const info = itemInfo.get(String(key));
    const dados = estornoPorItem.get(String(info?.item?.id ?? key));
    if (!dados?.rota?.length || !info?.grupo) return '';
    return rotuloDoPonto(dados, Number(info.grupo.ordem_origem));
  }

  /** "9/15 — Tag de Papel" para um ponto da rota. */
  function rotuloDoPonto(dados, ordem) {
    const total = dados.rota.length;
    if (!(ordem > 0)) return 'Produzir do zero';
    const passo = dados.rota.find(p => Number(p.ordem) === Number(ordem));
    return `${ordem}/${total} — ${passo?.insumo_nome || '—'}`;
  }

  /**
   * A decisão inteira numa linha: DE ONDE a peça veio e PARA ONDE vai.
   *
   * Só o destino não basta. Devolver em 12/15 significa uma coisa se a peça
   * entrou pronta e outra bem diferente se ela entrou em 3/15 — no segundo caso
   * ela avançou nove passos, e é o trecho restante que volta para a
   * matéria-prima. Sem a origem ao lado, o usuário não tem como conferir a conta.
   */
  function rotuloDoCaminho(key, indice = 0) {
    const info = itemInfo.get(String(key));
    const dados = estornoPorItem.get(String(info?.item?.id ?? key));
    if (!dados?.rota?.length) return '';

    const total = dados.rota.length;
    const state = destinationState.get(String(key));
    const escolhida = (state?.stockPorEtapa || [])[indice];

    const origem = Number(info?.grupo?.ordem_origem ?? total);
    const destino = escolhida && escolhida.ordem !== null && escolhida.ordem !== undefined
      ? Number(escolhida.ordem)
      : origem;

    if (!(destino > 0)) {
      return `${rotuloDoPonto(dados, origem)} → não volta ao estoque · ${total} item(ns) para a matéria-prima`;
    }

    const faltam = total - destino;
    const caminho = destino === origem
      ? `${rotuloDoPonto(dados, origem)} (volta como estava)`
      : `${rotuloDoPonto(dados, origem)} → ${rotuloDoPonto(dados, destino)}`;

    return caminho + (faltam > 0
      ? ` · ${faltam} item(ns) voltam para a matéria-prima`
      : ' · peça pronta');
  }

  // ------------------------------------------------------------------
  // Composição dos pedidos de DESTINO
  //
  // Realocar é SUBSTITUIR: a peça que sai daqui ocupa o lugar de uma peça de
  // lá. Sem saber quais peças o destino tem — e em que ponto da rota cada uma
  // está —, a tela só sabia dizer "7 unidades compatíveis", repetido em linhas
  // idênticas, sem identificar nada e sem descontar o que já foi substituído.
  // ------------------------------------------------------------------
  const composicaoDestino = new Map();

  async function carregarComposicaoDestino(pedidoId) {
    const chave = String(pedidoId);
    if (composicaoDestino.has(chave)) return composicaoDestino.get(chave);
    try {
      const resp = await fetchApi(`/api/pedidos/${pedidoId}/estorno-opcoes`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const dados = await resp.json();
      composicaoDestino.set(chave, dados?.itens || []);
    } catch (err) {
      console.error(`Não foi possível ler a composição do pedido ${pedidoId}`, err);
      composicaoDestino.set(chave, []);
    }
    return composicaoDestino.get(chave);
  }

  /**
   * Grupos do pedido de destino que podem ser substituídos, já descontando o
   * que foi atribuído nesta tela.
   */
  function gruposDoDestino(pedidoId, produtoId) {
    const itens = composicaoDestino.get(String(pedidoId)) || [];
    const doProduto = itens.filter(i => String(i.produto_id) === String(produtoId));
    const total = doProduto[0]?.rota?.length || 0;

    const grupos = [];
    doProduto.forEach(item => {
      (item.grupos || []).forEach(grupo => {
        const chaveGrupo = `${pedidoId}::${item.pedido_item_id}::${grupo.origem}::${grupo.ordem_origem}`;
        grupos.push({
          chave: chaveGrupo,
          pedidoItemId: item.pedido_item_id,
          origem: grupo.origem,
          ordemOrigem: Number(grupo.ordem_origem) || 0,
          quantidade: normalizeQuantity(grupo.quantidade),
          jaSubstituido: substituicoesPorGrupo(chaveGrupo),
          rotulo: grupo.origem === 'producao'
            ? 'Produzir do zero'
            : `${grupo.ordem_origem}/${total} — ${
              (item.rota || []).find(p => Number(p.ordem) === Number(grupo.ordem_origem))?.insumo_nome || '—'
            }`
        });
      });
    });
    return grupos;
  }

  /** Quantas unidades já foram atribuídas a este grupo do destino. */
  function substituicoesPorGrupo(chaveGrupo) {
    let total = 0;
    destinationState.forEach(state => {
      (state.reallocations || []).forEach(entry => {
        if (String(entry.grupoDestino) === String(chaveGrupo)) {
          total += normalizeQuantity(entry.quantity);
        }
      });
    });
    return total;
  }

  /** Menor ponto em que ALGUMA unidade desta peça pode voltar. */
  function pisoDoItem(key) {
    const dados = estornoPorItem.get(String(key));
    if (!dados?.grupos?.length) return null;
    return Math.min(...dados.grupos.map(g => Number(g.ordem_origem) || 0));
  }
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
      info.remainingCell.className = `px-4 py-3 text-left text-sm font-semibold ${remaining > 0 ? 'text-orange-200' : 'text-emerald-200'}`;
    }
    updateAssignmentsUI(key);
    if (drawer && !drawer.classList.contains('hidden') && currentReallocationKey === key) {
      updateDrawerHeader(key);
      renderDrawerOrdersForItem(key);
    }
  }

  /**
   * @param {Array} etapas  quando informado, o diálogo também pergunta em que
   *   ponto da rota a peça volta: `{ ordem, rotulo, selecionada }`. Sem isso o
   *   retorno é só a quantidade, como era antes.
   * @returns {Promise<number|{quantidade:number, ordem:number|null}|null>}
   */
  function openQuantityDialog({ title, description, max, initial, confirmLabel = 'Confirmar', etapas = [] }) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
      overlay.style.zIndex = 'var(--z-dialog)';
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
            ${etapas.length ? `
            <div class="space-y-2">
              <label class="text-xs uppercase tracking-wide text-gray-400">Volta em qual ponto da produção?</label>
              <select data-etapa class="w-full bg-input border border-inputBorder rounded-lg px-3 py-2 text-white">
                ${etapas.map(e => `<option value="${e.ordem}"${e.selecionada ? ' selected' : ''}>${e.rotulo}</option>`).join('')}
              </select>
              <p class="text-xs text-gray-400">
                A peça entra no estoque nesse ponto, e o que faltava para terminá-la volta para a matéria-prima.
              </p>
            </div>` : ''}
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
        // Com escolha de etapa o retorno vira objeto; sem ela continua sendo o
        // número, para não mexer em quem já chamava este diálogo.
        if (etapas.length) {
          const select = overlay.querySelector('[data-etapa]');
          const bruto = select ? select.value : null;
          // O valor é numérico quando são pontos da rota e texto quando são
          // grupos do pedido de destino. Forçar `Number` transformava a chave
          // do grupo em NaN e a escolha se perdia.
          const numero = Number(bruto);
          close({
            quantidade: value,
            ordem: bruto !== null && bruto !== '' && Number.isFinite(numero) ? numero : bruto
          });
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
      overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
      overlay.style.zIndex = 'var(--z-dialog)';
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
      // As peças do DESTINO, agrupadas por ponto da rota — não uma linha por
      // peça deste pedido repetindo o mesmo total. Cada linha diz o estágio, o
      // quanto existe lá e o quanto já foi substituído nesta tela.
      const produtoId = (items || [])[0]
        ? itemInfo.get((items || [])[0].key)?.item?.produto_id
        : null;
      const grupos = produtoId ? gruposDoDestino(order.id, produtoId) : [];

      const itemsList = grupos.length
        ? grupos.map(grupo => {
          const livre = normalizeQuantity(grupo.quantidade - grupo.jaSubstituido);
          const usado = grupo.jaSubstituido > 0
            ? `<span class="text-[11px] text-primary-200">${formatUnitsLabel(grupo.jaSubstituido)} já substituída(s)</span>`
            : '';
          return `
            <div class="flex items-center justify-between gap-3 bg-white/5 rounded-lg px-3 py-2 border ${livre > 0 ? 'border-white/10' : 'border-white/5 opacity-50'}">
              <span class="flex flex-col">
                <span class="text-xs text-gray-200">${grupo.rotulo}</span>
                ${usado}
              </span>
              <span class="text-xs font-semibold ${livre > 0 ? 'text-white' : 'text-gray-500'}">
                ${formatUnitsLabel(livre)} de ${formatUnitsLabel(grupo.quantidade)}
              </span>
            </div>`;
        }).join('')
        : (items || []).map(match => `
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
      const discardQty = normalizeQuantity(state.discard);

      // Uma linha por DESTINO, não por grupo: o mesmo lote pode ser devolvido
      // em pontos diferentes (2 acabadas e 2 paradas no meio), e somar as
      // quatro numa linha só esconderia exatamente a informação que faz o
      // usuário conferir se distribuiu certo.
      (state.stockPorEtapa || []).forEach((entrada, indice) => {
        const qty = normalizeQuantity(entrada.quantidade);
        if (qty <= 0) return;
        stockEntries.push({ key, indice, name: info.name, quantity: qty });
      });
      if (discardQty > 0) {
        // O descarte devolve a peça ao ponto de ORIGEM — é esse o rótulo que
        // distingue as linhas quando o mesmo produto veio de vários lotes.
        discardEntries.push({
          key, name: info.name, quantity: discardQty, rotulo: rotuloDaOrigem(key)
        });
      }
      (state.reallocations || []).forEach(entry => {
        const qty = normalizeQuantity(entry.quantity);
        if (qty <= 0) return;
        const bucket = reallocationMap.get(entry.orderId) || { orderId: entry.orderId, total: 0, items: [] };
        bucket.total += qty;
        // Na realocação a peça vai como está: o rótulo é o ponto de origem.
        bucket.items.push({
          key, name: info.name, quantity: qty, rotulo: rotuloDaOrigem(key)
        });
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
            // Nome + PONTO da rota: sem o ponto, quatro linhas iguais.
            btn.innerHTML = `
              <span class="flex flex-col">
                <span>${item.name}</span>
                ${item.rotulo ? `<span class="text-[11px] text-gray-400">${item.rotulo}</span>` : ''}
              </span>
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
        // O nome do produto se repete em todas as linhas quando o item veio de
        // pontos diferentes da rota. O que as distingue é DE ONDE a peça veio e
        // PARA ONDE ela vai — a decisão inteira numa linha.
        const caminho = rotuloDoCaminho(item.key, item.indice);
        btn.innerHTML = `
          <span class="flex flex-col">
            <span>${item.name}</span>
            ${caminho ? `<span class="text-[11px] text-emerald-200/80">${caminho}</span>` : ''}
          </span>
          <span class="text-white font-semibold">${formatUnitsLabel(item.quantity)}</span>
        `;
        // Clicar edita ESTA entrada, não o grupo inteiro.
        btn.addEventListener('click', () => handleSimpleAction(item.key, 'stock', item.indice));
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
        // Descarte devolve ao lote de ORIGEM: é o ponto dela que identifica a
        // linha, não o nome do produto repetido.
        btn.innerHTML = `
          <span class="flex flex-col">
            <span>${item.name}</span>
            ${item.rotulo ? `<span class="text-[11px] text-red-200/70">${item.rotulo} · volta ao lote de origem</span>` : ''}
          </span>
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

  document.getElementById('cancelarPedidoDrawerFechar')?.addEventListener('click', closeDrawer);

  /**
   * @param {number} indiceEdicao  qual destino está sendo editado. -1 (padrão)
   *   cria um novo, limitado ao que AINDA não tem destino.
   */
  async function handleSimpleAction(key, action, indiceEdicao = -1) {
    const info = itemInfo.get(key);
    const state = ensureDestinationState(key, info?.quantity || 0);

    // O teto de um NOVO destino é o saldo ainda livre do grupo, não o total.
    // Antes o teto era "restante + tudo o que já foi para o estoque", e com
    // isso a segunda escolha podia repetir unidades já destinadas: um grupo de
    // 4 aceitava 4 num ponto e mais 4 em outro, devolvendo 8 peças que não
    // existiam. Editando uma entrada, o teto inclui a quantidade dela.
    const entradas = action === 'stock' ? (state.stockPorEtapa || []) : [];
    const emEdicao = indiceEdicao >= 0 ? entradas[indiceEdicao] : null;
    const currentValue = action === 'stock'
      ? normalizeQuantity(emEdicao?.quantidade || 0)
      : normalizeQuantity(state[action] || 0);
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

    // Só o retorno ao estoque pergunta o ponto da rota. Descarte é sempre
    // "voltar como estava": a peça não avança, ela some do pedido.
    const etapas = action === 'stock' ? etapasDisponiveis(key, indiceEdicao) : [];

    const resposta = await openQuantityDialog({
      title: titles[action] || 'Definir quantidade',
      description: descriptions[action] || '',
      max,
      initial: currentValue,
      confirmLabel: 'Salvar',
      etapas
    });

    if (resposta === null) return;

    const quantidade = typeof resposta === 'object' ? resposta.quantidade : resposta;
    const ordem = typeof resposta === 'object' ? resposta.ordem : null;

    if (action === 'stock') {
      // Uma entrada POR PONTO da rota: o mesmo grupo pode voltar em pedaços —
      // duas acabadas, duas paradas no meio — até cobrir a quantidade dele.
      const lista = state.stockPorEtapa || [];

      if (emEdicao) {
        if (quantidade > 0) {
          emEdicao.quantidade = normalizeQuantity(quantidade);
          emEdicao.ordem = ordem;
        } else {
          lista.splice(indiceEdicao, 1);
        }
      } else if (quantidade > 0) {
        // Escolher o mesmo ponto duas vezes SOMA, em vez de criar uma linha
        // repetida no resumo.
        const mesmoPonto = lista.find(e => e.ordem === ordem);
        if (mesmoPonto) mesmoPonto.quantidade = normalizeQuantity(mesmoPonto.quantidade + quantidade);
        else lista.push({ ordem, quantidade: normalizeQuantity(quantidade) });
      }

      state.stockPorEtapa = lista.filter(e => normalizeQuantity(e.quantidade) > 0);
      state.stock = state.stockPorEtapa.reduce((s, e) => s + normalizeQuantity(e.quantidade), 0);
    } else {
      state[action] = normalizeQuantity(quantidade);
    }

    updateItemDestinationsUI(key);
    refreshOrdersUI();
  }

  /**
   * Pontos em que esta peça pode voltar: do PISO (de onde ela veio) até o fim
   * da rota. Abaixo do piso não se oferece — ninguém desmonta uma peça.
   *
   * O ponto 0 ("não devolver a peça") só aparece quando há unidades que seriam
   * produzidas do zero: elas nunca existiram, então podem simplesmente não
   * voltar, devolvendo só o material.
   */
  function etapasDisponiveis(key, indiceEdicao = -1) {
    const info = itemInfo.get(String(key));
    const dados = estornoPorItem.get(String(info?.item?.id ?? key));
    if (!dados?.rota?.length) return [];

    // O piso é o do GRUPO desta linha, não o do item: as peças paradas na
    // Montagem não podem voltar antes dali, mesmo que outras do mesmo item
    // tenham vindo do zero.
    const piso = info?.grupo ? (Number(info.grupo.ordem_origem) || 0) : (pisoDoItem(info?.item?.id) ?? 0);
    const total = dados.rota.length;
    const state = destinationState.get(String(key));
    // Editando um destino, o ponto dele vem marcado. Criando um novo, nada
    // vem marcado e o padrão é o fim da rota.
    const jaEscolhido = indiceEdicao >= 0
      ? (state?.stockPorEtapa || [])[indiceEdicao]?.ordem
      : undefined;

    const opcoes = [];
    if (piso === 0) {
      opcoes.push({
        ordem: 0,
        rotulo: 'Não devolver a peça — estornar todo o material',
        selecionada: jaEscolhido === 0
      });
    }
    for (const passo of dados.rota) {
      if (passo.ordem < piso) continue;
      opcoes.push({
        ordem: passo.ordem,
        rotulo: `${passo.ordem}/${total} — ${passo.insumo_nome}${passo.processo ? ` (${passo.processo})` : ''}`,
        // O fim da rota é o padrão: peça acabada é o caso mais comum.
        selecionada: jaEscolhido === undefined ? passo.ordem === total : jaEscolhido === passo.ordem
      });
    }
    return opcoes;
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

    // QUAL peça do destino esta vai substituir.
    //
    // Realocar é substituir: sem dizer o lugar que a peça ocupa, o destino não
    // sabe o que deixou de precisar produzir, e o mesmo grupo poderia receber
    // mais peças do que tem lugar.
    await carregarComposicaoDestino(orderId);
    const grupos = gruposDoDestino(orderId, info?.item?.produto_id)
      .filter(g => normalizeQuantity(g.quantidade - g.jaSubstituido) > 0
        || String(g.chave) === String(existing?.grupoDestino));

    if (!grupos.length) {
      const message = `Todas as peças do ${formatOrderLabel(orderId)} já foram substituídas.`;
      if (typeof showToast === 'function') showToast(message, 'info');
      return false;
    }

    const resposta = await openQuantityDialog({
      title: `Realocar para ${formatOrderLabel(orderId)}`,
      description: `Informe a quantidade de ${info?.name || 'itens'} e qual peça do pedido de destino ela substitui.`,
      max: available,
      initial: currentValue,
      confirmLabel: 'Salvar realocação',
      // Reaproveita o seletor do diálogo: aqui ele lista os GRUPOS do destino.
      etapas: grupos.map(g => ({
        ordem: g.chave,
        rotulo: `${g.rotulo} — ${formatUnitsLabel(normalizeQuantity(g.quantidade - g.jaSubstituido))} disponível(is)`,
        selecionada: String(g.chave) === String(existing?.grupoDestino)
      }))
    });

    if (resposta === null) return false;

    const quantity = typeof resposta === 'object' ? resposta.quantidade : resposta;
    const grupoDestino = typeof resposta === 'object' ? resposta.ordem : null;
    const grupoEscolhido = grupos.find(g => String(g.chave) === String(grupoDestino)) || grupos[0];

    const livreNoGrupo = normalizeQuantity(
      grupoEscolhido.quantidade - grupoEscolhido.jaSubstituido
      + (String(grupoEscolhido.chave) === String(existing?.grupoDestino) ? currentValue : 0)
    );
    if (normalizeQuantity(quantity) > livreNoGrupo) {
      const message = `O grupo escolhido do ${formatOrderLabel(orderId)} tem apenas `
        + `${formatUnitsLabel(livreNoGrupo)} para substituir.`;
      if (typeof showToast === 'function') showToast(message, 'warning');
      return false;
    }

    const normalized = normalizeQuantity(quantity);
    if (normalized <= 0) {
      state.reallocations = (state.reallocations || []).filter(entry => String(entry.orderId) !== String(orderId));
    } else if (existing) {
      existing.quantity = normalized;
      existing.grupoDestino = grupoEscolhido.chave;
      existing.pedidoItemDestino = grupoEscolhido.pedidoItemId;
      existing.grupoDestinoInfo = {
        origem: grupoEscolhido.origem,
        ordem_origem: grupoEscolhido.ordemOrigem
      };
    } else {
      state.reallocations.push({
        orderId,
        quantity: normalized,
        // Guarda QUAL peça do destino esta substitui: é o que desconta o saldo
        // daquele grupo e o que o backend usa para saber o que liberar lá.
        grupoDestino: grupoEscolhido.chave,
        pedidoItemDestino: grupoEscolhido.pedidoItemId,
        grupoDestinoInfo: {
          origem: grupoEscolhido.origem,
          ordem_origem: grupoEscolhido.ordemOrigem
        }
      });
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

  /**
   * Uma linha POR GRUPO, não por item do pedido.
   *
   * Sete unidades da mesma peça podem ter vindo de três lugares — uma pronta,
   * quatro paradas na Montagem, duas no Acabamento. A tabela mostrava as sete
   * numa linha só, como se estivessem todas no mesmo ponto, e obrigava a
   * escolher UM destino para o conjunto. Só que o estorno depende do ponto de
   * cada grupo: as quatro da Montagem devolvem 8 passos de material, as duas do
   * Acabamento devolvem 3, e a pronta não devolve nada. Um destino só para as
   * sete daria uma conta errada em pelo menos dois dos três grupos.
   */
  function expandirPorGrupo(lista) {
    const linhas = [];
    lista.forEach((item, index) => {
      const dados = estornoPorItem.get(String(item.id));
      const grupos = dados?.grupos || [];

      // Sem as opções (pedido antigo, ou a consulta falhou), a linha continua
      // sendo a do item inteiro — o comportamento de antes.
      if (!grupos.length) {
        linhas.push({ item, index, grupo: null, key: String(item.id ?? index) });
        return;
      }

      const total = dados.rota.length;
      grupos.forEach((grupo, posicao) => {
        const passo = dados.rota.find(p => Number(p.ordem) === Number(grupo.ordem_origem)) || null;
        const pronta = grupo.origem !== 'producao' && Number(grupo.ordem_origem) >= total;
        linhas.push({
          item,
          index,
          key: `${item.id}::${posicao}`,
          grupo: {
            ...grupo,
            itemId: item.id,
            rotuloOrigem: grupo.origem === 'producao'
              ? 'Produzir do zero'
              : (pronta ? 'Pronta do estoque' : 'Parcial do estoque'),
            rotuloEtapa: grupo.origem === 'producao'
              ? 'Não iniciada'
              : `${grupo.ordem_origem}/${total} — ${passo?.insumo_nome || '—'}`
          }
        });
      });
    });
    return linhas;
  }

  // ANTES de montar a tabela: é a resposta desta consulta que diz quantas
  // linhas cada item tem. Buscá-la depois deixaria a tela mostrando o formato
  // antigo por um instante e obrigaria a redesenhar tudo.
  await carregarOpcoesDeEstorno();

  itemKeys.length = 0;
  destinationState.clear();
  if (itensBody) itensBody.innerHTML = '';
  if (!itens.length) {
    itensEmpty?.classList.remove('hidden');
  } else {
    itensEmpty?.classList.add('hidden');
    expandirPorGrupo(itens).forEach(({ item, index, grupo, key }) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/10';
      tr.dataset.key = key;

      const name = nameFallback(item, index);
      // A quantidade da LINHA é a do grupo — não a do item inteiro. Era daí que
      // vinham as "7 unidades" repetidas em cada linha.
      const quantity = grupo ? normalizeQuantity(grupo.quantidade) : extractQuantity(item);
      const quantityLabel = formatQuantity(quantity);
      const origem = grupo ? grupo.rotuloOrigem : (origemFallback(item) || '—');
      const situacao = grupo ? grupo.rotuloEtapa : (statusFallback(item) || '—');

      const nameTd = document.createElement('td');
      nameTd.setAttribute('data-perm-col', 'col_canc_item');
      nameTd.className = 'px-4 py-3 text-left text-sm text-white';
      nameTd.textContent = name;

      const qtyTd = document.createElement('td');
      qtyTd.setAttribute('data-perm-col', 'col_canc_qtd');
      qtyTd.className = 'px-4 py-3 text-left text-sm text-white';
      qtyTd.textContent = formatNumber(quantity);

      const remainingTd = document.createElement('td');
      remainingTd.setAttribute('data-perm-col', 'col_canc_restante');
      remainingTd.className = 'px-4 py-3 text-left text-sm font-semibold text-orange-200';
      remainingTd.textContent = formatNumber(quantity);

      const origemTd = document.createElement('td');
      origemTd.setAttribute('data-perm-col', 'col_canc_origem');
      origemTd.className = 'px-4 py-3 text-left text-sm text-gray-200';
      origemTd.textContent = origem;

      const situacaoTd = document.createElement('td');
      situacaoTd.setAttribute('data-perm-col', 'col_canc_situacao');
      situacaoTd.className = 'px-4 py-3 text-left text-sm text-gray-200';
      situacaoTd.textContent = situacao;

      const actionTd = document.createElement('td');
      actionTd.setAttribute('data-perm-col', 'col_canc_destinos');
      actionTd.className = 'px-4 py-3 text-left text-sm';
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
        grupo,
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
          const resp = await fetchApi('/api/pedidos');
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
            const resp = await fetchApi(`/api/pedidos/${order.id}`);
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

  // ------------------------------------------------------------------
  // Preservação do trabalho (ver docs/restauracao-de-trabalho.md)
  //
  // O que o usuário monta aqui é o DESTINO de cada item do pedido cancelado —
  // quanto volta ao estoque, quanto é descartado e quanto vai para outros
  // pedidos. Isso vive em `destinationState`, um Map interno: nenhuma varredura
  // de DOM consegue repor. E o modal só existe se `window.cancelarPedidoContext`
  // estiver definido (quem define é o modal de visualizar), por isso o pedido
  // inteiro vai no `__contexto`.
  //
  // Registrado ANTES do `await` de carregar os pedidos disponíveis: é o que
  // garante que a restauração encontre o modal já registrado.
  // ------------------------------------------------------------------
  window.EstadoTrabalho?.registrarConteudo?.(overlayId, {
    capturar: () => ({
      __contexto: { cancelarPedidoContext: context },
      destinos: Array.from(destinationState.entries()).map(([key, state]) => ({
        key,
        stock: normalizeQuantity(state.stock),
        discard: normalizeQuantity(state.discard),
        reallocations: (state.reallocations || []).map(entry => ({
          orderId: entry.orderId,
          quantity: normalizeQuantity(entry.quantity)
        }))
      }))
    }),
    restaurar: async (dados) => {
      const destinos = Array.isArray(dados?.destinos) ? dados.destinos : [];
      if (!destinos.length) return;

      // Neste ponto a lista de pedidos disponíveis já terminou de carregar (o
      // script faz o `await` antes de a restauração ser chamada), então dá para
      // conferir se os pedidos das realocações ainda existem.
      const pedidosValidos = new Set(
        (Array.isArray(availableOrders) ? availableOrders : [])
          .map(o => String(o.id ?? o.orderId ?? ''))
          .filter(Boolean)
      );
      let realocacoesDescartadas = 0;

      destinos.forEach(destino => {
        // O item pode ter sumido do pedido enquanto o usuário esteve fora.
        if (!destinationState.has(destino.key)) return;
        const state = destinationState.get(destino.key);

        state.stock = normalizeQuantity(destino.stock);
        state.discard = normalizeQuantity(destino.discard);
        state.reallocations = (destino.reallocations || []).filter(entry => {
          const existe = !pedidosValidos.size || pedidosValidos.has(String(entry.orderId));
          if (!existe) realocacoesDescartadas += 1;
          return existe;
        }).map(entry => ({ orderId: entry.orderId, quantity: normalizeQuantity(entry.quantity) }));

        recalcRemaining(state);
        updateItemDestinationsUI(destino.key);
      });

      refreshOrdersUI();

      if (realocacoesDescartadas && typeof showToast === 'function') {
        showToast(
          `${realocacoesDescartadas} realocação(ões) não voltaram: o pedido de destino não está mais disponível.`,
          'info'
        );
      }
    }
  });

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
      // `grupo` diz a QUAL conjunto de unidades esta decisão pertence. Sem ele
      // o backend teria de adivinhar, e adivinharia errado sempre que o mesmo
      // item viesse de pontos diferentes da rota.
      const base = {
        item: info.item || null,
        grupo: info.grupo
          ? {
            origem: info.grupo.origem,
            ordem_origem: info.grupo.ordem_origem,
            lote_id: info.grupo.lote_id ?? null
          }
          : null
      };

      // Uma ação por PONTO da rota: é o que permite devolver duas acabadas e
      // três paradas no meio no mesmo item. Sem escolha de ponto (opções não
      // carregaram), vai uma ação só, sem `ordem` — e o backend devolve tudo
      // como estava, que é o comportamento seguro.
      const porEtapa = Array.isArray(state.stockPorEtapa) && state.stockPorEtapa.length
        ? state.stockPorEtapa
        : (normalizeQuantity(state.stock) > 0 ? [{ ordem: null, quantidade: state.stock }] : []);

      porEtapa.forEach(entrada => {
        const qty = normalizeQuantity(entrada.quantidade);
        if (qty <= 0) return;
        actions.push({ ...base, action: 'stock', quantity: qty, ordem: entrada.ordem });
        totalStock += qty;
      });

      const discardQty = normalizeQuantity(state.discard);
      if (discardQty > 0) {
        actions.push({ ...base, action: 'discard', quantity: discardQty });
        totalDiscard += discardQty;
      }

      (state.reallocations || []).forEach(entry => {
        const qty = normalizeQuantity(entry.quantity);
        if (qty <= 0) return;
        actions.push({
          ...base,
          action: 'reallocate',
          orderId: entry.orderId,
          quantity: qty,
          // Qual peça do destino esta substitui — sem isso o backend teria de
          // adivinhar o lugar que ela ocupa lá.
          pedidoItemDestino: entry.pedidoItemDestino ?? null,
          grupoDestino: entry.grupoDestinoInfo ?? null
        });
        totalReallocate += qty;
      });
    });

    const linhas = [];
    if (totalReallocate > 0) linhas.push(`${formatUnitsLabel(totalReallocate)} serão realocadas para outros pedidos.`);
    if (totalStock > 0) linhas.push(`${formatUnitsLabel(totalStock)} retornarão ao estoque.`);
    if (totalDiscard > 0) linhas.push(`${formatUnitsLabel(totalDiscard)} serão descartadas.`);

    // `window.confirm` é a caixa do sistema operacional: fundo branco, botões
    // em inglês, nada a ver com o resto do app — e num Electron ela ainda
    // congela a janela inteira enquanto está aberta.
    if (!(await confirmarNoPadrao(linhas))) return;

    const originalText = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Cancelando...';

    // O véu padrão do app, com a logo: o estorno percorre lotes e insumos um a
    // um e leva segundos. Sem ele a tela fica muda e convida a clicar de novo.
    const comVeu = window.BotaoAcao?.comCarregamento
      ? (fn) => window.BotaoAcao.comCarregamento(fn, `Cancelando o pedido ${pedido.numero || ''}...`.trim())
      : (fn) => fn();

    try {
      await comVeu(async () => {
      const resp = await fetchApi(`/api/pedidos/${pedidoId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Cancelado', acoes: actions })
      });
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(corpo?.detalhe || corpo?.error || 'Falha ao cancelar pedido');

      // A tabela é atualizada ANTES do aviso: ler "cancelado" com o pedido
      // ainda em Produção faz o usuário concluir que não funcionou.
      if (typeof window.carregarPedidos === 'function') {
        try {
          await window.carregarPedidos();
        } catch (err) {
          console.error('Erro ao recarregar pedidos', err);
        }
      }

      // O que voltou ao estoque é o que interessa saber depois de cancelar —
      // "cancelado com sucesso" sozinho não diz se o estorno aconteceu.
      const e = corpo?.estorno;
      const resumo = e
        ? `Pedido cancelado. ${(e.pecasAoEstoque ?? 0) + (e.pecasRestauradasNoLote ?? 0)} peça(s) ao estoque, `
          + `${e.pecasRealocadas ?? 0} realocada(s), `
          + `${e.pecasNaoDevolvidas ?? 0} não retornaram, `
          + `${e.tiposDeInsumo ?? 0} tipo(s) de insumo devolvido(s).`
        : 'Pedido cancelado com sucesso.';

      // COM FALHAS NÃO É SUCESSO.
      //
      // O cancelamento em si não tem volta — o pedido já está marcado —, mas
      // dizer "concluído" em verde quando parte do estorno falhou é pior que
      // não dizer nada: o usuário fecha a tela achando que o estoque está
      // certo, e o erro só aparece no inventário.
      const falhas = Array.isArray(corpo?.avisos) ? corpo.avisos : [];
      if (falhas.length) {
        console.warn('Cancelamento com falhas no estorno:', falhas);
        if (typeof showToast === 'function') {
          showToast(
            `Pedido cancelado, mas ${falhas.length} etapa(s) do estorno FALHARAM. `
            + 'Confira o estoque antes de seguir — detalhes no console.',
            'error'
          );
        }
        // O modal fica aberto: há o que conferir antes de sair.
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText;
        return;
      }

      if (typeof showToast === 'function') showToast(resumo, 'success');
      close();
      });
    } catch (err) {
      console.error('Erro ao cancelar pedido', err);
      // A causa real vem do backend (qual chave, ou o que falhou no estorno).
      if (typeof showToast === 'function') {
        showToast(err?.message || 'Erro ao cancelar pedido.', 'error');
      }
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalText;
      return;
    }
  };

  confirmBtn?.addEventListener('click', confirm);
  updateValidation();

  // Em segundo plano: a tela abre e funciona sem isso, e as opções de ponto da
  // rota aparecem assim que chegam. Bloquear a abertura por causa delas seria
  // pagar uma ida à rede antes de o usuário sequer decidir cancelar.
  carregarOpcoesDeEstorno();
})();
