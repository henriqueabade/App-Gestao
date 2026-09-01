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

  /** A composição deste destino já chegou e tem conteúdo? */
  function temComposicao(pedidoId) {
    const dados = composicaoDestino.get(String(pedidoId));
    return Array.isArray(dados) && dados.length > 0;
  }

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
          // O nome da peça do destino: um pedido com dois produtos mostraria
          // dois "15/15 — Etiqueta do Produto" sem nada que os separasse.
          produtoNome: item.nome || item.codigo || '',
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

  /**
   * Quanto ainda cabe neste grupo do destino.
   *
   * `entradaEmEdicao` é a atribuição que está sendo alterada agora: a
   * quantidade dela já está descontada em `jaSubstituido`, e sem devolvê-la
   * aqui editar "3" para "3" seria recusado por falta de espaço.
   */
  function livreNoGrupo(grupo, entradaEmEdicao = null) {
    if (!grupo) return 0;
    const devolvido = entradaEmEdicao && String(entradaEmEdicao.grupoDestino) === String(grupo.chave)
      ? normalizeQuantity(entradaEmEdicao.quantity)
      : 0;
    return normalizeQuantity(grupo.quantidade - grupo.jaSubstituido + devolvido);
  }

  /**
   * Aplica ao conjunto de substituições a decisão que veio do diálogo.
   *
   * Uma peça cancelada pode substituir VÁRIAS peças do mesmo pedido de destino
   * — 3 unidades no lugar de uma parada em 9/15 e 2 no lugar de uma pronta. A
   * identidade de cada substituição é o par (pedido, peça do destino); guardar
   * uma por pedido fazia a segunda escolha apagar a primeira.
   *
   * `anterior` é a substituição que está sendo editada: ela sai e volta com o
   * valor novo, e é isso que faz trocar a peça de destino MOVER a substituição
   * em vez de deixar as duas.
   */
  function aplicarSubstituicao(lista, { orderId, quantidade, grupo, anterior = null }) {
    const restantes = (lista || []).filter(entry => entry !== anterior);
    const quantidadeFinal = normalizeQuantity(quantidade);
    if (quantidadeFinal <= 0 || !grupo) return restantes;

    const alvo = restantes.find(entry => String(entry.orderId) === String(orderId)
      && String(entry.grupoDestino) === String(grupo.chave));

    // Mesma peça de destino escolhida de novo: SOMA, em vez de repetir a linha.
    if (alvo) {
      alvo.quantity = normalizeQuantity(alvo.quantity + quantidadeFinal);
      return restantes;
    }

    restantes.push({
      orderId,
      quantity: quantidadeFinal,
      // Guarda QUAL peça do destino esta substitui: é o que desconta o saldo
      // daquele grupo e o que o backend usa para saber o que liberar lá.
      grupoDestino: grupo.chave,
      pedidoItemDestino: grupo.pedidoItemId,
      grupoDestinoRotulo: grupo.rotulo,
      grupoDestinoInfo: { origem: grupo.origem, ordem_origem: grupo.ordemOrigem }
    });
    return restantes;
  }

  /** Os produtos que este pedido cancelado tem em comum com o de destino. */
  function produtosCompativeis(items = []) {
    const ids = [];
    (items || []).forEach(match => {
      const produtoId = itemInfo.get(String(match.key))?.item?.produto_id;
      if (produtoId === undefined || produtoId === null) return;
      if (!ids.some(id => String(id) === String(produtoId))) ids.push(produtoId);
    });
    return ids;
  }

  /** Todos os grupos do destino compatíveis com as peças deste pedido. */
  function gruposCompativeis(orderId, items = []) {
    const grupos = [];
    produtosCompativeis(items).forEach(produtoId => {
      grupos.push(...gruposDoDestino(orderId, produtoId));
    });
    return grupos;
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

  // ------------------------------------------------------------------
  // Nome do cliente
  //
  // A lista de pedidos vem com `cliente_id`, não com o nome — quem traduz o id
  // na tabela é um cache do módulo de Pedidos que este modal não enxerga. Sem
  // isto todo card de destino mostrava "Cliente: —", inclusive no resumo.
  // ------------------------------------------------------------------
  const nomesClientes = new Map();

  async function carregarNomesClientes() {
    try {
      const resp = await fetchApi('/api/clientes/lista');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const lista = await resp.json();
      (Array.isArray(lista) ? lista : []).forEach(cliente => {
        nomesClientes.set(
          String(cliente.id),
          cliente.nome_fantasia || cliente.razao_social || cliente.nome || ''
        );
      });
    } catch (err) {
      console.error('Não foi possível carregar os nomes dos clientes', err);
    }
  }

  function nomeDoCliente(order) {
    if (!order) return '';
    const direto = order.cliente || order.cliente_nome || order.nome_cliente || '';
    if (direto) return direto;
    const id = order.cliente_id ?? order.clienteId ?? null;
    if (id === null || id === undefined || id === '') return '';
    const doCache = nomesClientes.get(String(id));
    if (doCache) return doCache;
    // Se o módulo de Pedidos estiver carregado, o cache dele serve.
    if (typeof window.obterNomeCliente === 'function') {
      const nome = window.obterNomeCliente(id);
      if (nome && nome !== '—') return nome;
    }
    return '';
  }

  const formatOrderLabel = orderId => {
    if (!availableOrders) return `Pedido ${orderId}`;
    const found = availableOrders.find(o => String(o.id) === String(orderId));
    if (!found) return `Pedido ${orderId}`;
    const numero = found.numero || found.id;
    return [`#${numero}`, nomeDoCliente(found)].filter(Boolean).join(' • ');
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
          grupoDestino: entry.grupoDestino ?? null,
          icon: 'fa-exchange-alt',
          label: formatOrderLabel(entry.orderId),
          // QUAL peça de lá esta substitui: são várias substituições possíveis
          // no mesmo pedido, e sem isso os chips ficam idênticos.
          sublabel: entry.grupoDestinoRotulo || '',
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
            <span class="flex flex-col text-left">
              <span>${chip.label}</span>
              ${chip.sublabel ? `<span class="text-[10px] text-gray-400">substitui ${chip.sublabel}</span>` : ''}
            </span>
          </span>
          <span class="font-semibold text-white">${formatUnitsLabel(chip.quantity)}</span>
        </div>
      `;
      if (chip.action === 'stock' || chip.action === 'discard') {
        button.title = 'Clique para ajustar a quantidade.';
        button.addEventListener('click', () => handleSimpleAction(key, chip.action));
      } else if (chip.action === 'reallocate' && chip.orderId) {
        button.title = 'Clique para ajustar esta substituição.';
        button.addEventListener('click', () => openReallocationQuantity(key, chip.orderId, chip.grupoDestino));
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
   * @param {Function} [limitePara]  teto da opção selecionada. O teto do campo
   *   deixa de ser fixo: cada peça do destino tem o seu, e é ele que vale.
   * @param {Function} [ajudaPara]  texto de apoio da opção selecionada.
   * @returns {Promise<number|{quantidade:number, ordem:number|null}|null>}
   */
  function openQuantityDialog({
    title,
    description,
    max,
    initial,
    confirmLabel = 'Confirmar',
    etapas = [],
    etapaLabel = 'Volta em qual ponto da produção?',
    etapaAjuda = 'A peça entra no estoque nesse ponto, e o que faltava para terminá-la volta para a matéria-prima.',
    limitePara = null,
    ajudaPara = null
  }) {
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
              <p class="text-xs text-gray-400" data-disponivel>Disponível: ${formatUnitsLabel(safeMax)}.</p>
              <p class="text-xs text-red-400 hidden" data-error></p>
            </div>
            ${etapas.length ? `
            <div class="space-y-2">
              <label class="text-xs uppercase tracking-wide text-gray-400">${etapaLabel}</label>
              <select data-etapa class="w-full bg-input border border-inputBorder rounded-lg px-3 py-2 text-white">
                ${etapas.map(e => `<option value="${e.ordem}"${e.selecionada ? ' selected' : ''}>${e.rotulo}</option>`).join('')}
              </select>
              <p class="text-xs text-gray-400" data-etapa-ajuda>${etapaAjuda}</p>
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
      // Escolher o destino de uma peca abre este dialogo com a quantidade ja
      // preenchida. Quando ela e zero, e formato e nao resposta: a pessoa
      // precisava apagar o `0` antes de digitar, uma vez por peca.
      window.CampoZerado?.ligar(input);
      const errorEl = overlay.querySelector('[data-error]');
      const select = overlay.querySelector('[data-etapa]');
      const disponivelEl = overlay.querySelector('[data-disponivel]');
      const ajudaEl = overlay.querySelector('[data-etapa-ajuda]');
      const confirmBtnEl = overlay.querySelector('[data-action="confirm"]');

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

      /** O valor bruto do seletor: número para pontos da rota, texto para grupos. */
      const escolhaAtual = () => {
        if (!etapas.length) return null;
        const bruto = select ? select.value : null;
        const numero = Number(bruto);
        return bruto !== null && bruto !== '' && Number.isFinite(numero) ? numero : bruto;
      };

      /**
       * O teto que vale AGORA.
       *
       * Cada peça do destino tem o seu: escolher outra muda o limite, e sem
       * isso o campo aceitava o total e só reclamava depois de fechar.
       */
      const tetoAtual = () => {
        if (typeof limitePara !== 'function') return safeMax;
        const especifico = limitePara(escolhaAtual());
        if (especifico === null || especifico === undefined) return safeMax;
        return Math.min(safeMax, normalizeQuantity(especifico));
      };

      /** A mensagem de erro do estado atual, ou '' quando dá para salvar. */
      const problemaAtual = () => {
        const raw = (input?.value || '').trim();
        if (!raw) return 'Informe uma quantidade.';
        if (!/^\d+$/.test(raw)) return 'Informe um número inteiro.';
        const value = Number.parseInt(raw, 10);
        if (!Number.isFinite(value) || value < 0) return 'Informe uma quantidade válida.';
        const teto = tetoAtual();
        if (value > teto) {
          return teto > 0
            ? `Informe um valor menor ou igual a ${formatUnitsLabel(teto)}.`
            : 'Esta opção não tem mais unidades disponíveis.';
        }
        return '';
      };

      /**
       * Validação a cada digitada e a cada troca de peça.
       *
       * O erro tem de aparecer ANTES de confirmar — e o botão fica desabilitado
       * enquanto o valor não serve, para não existir "salvar" que não salva.
       */
      const revalidar = () => {
        const teto = tetoAtual();
        if (disponivelEl) disponivelEl.textContent = `Disponível: ${formatUnitsLabel(teto)}.`;
        if (ajudaEl && typeof ajudaPara === 'function') {
          ajudaEl.textContent = ajudaPara(escolhaAtual()) || etapaAjuda;
        }
        const problema = problemaAtual();
        if (problema) showError(problema);
        else clearError();
        if (confirmBtnEl) {
          confirmBtnEl.disabled = Boolean(problema);
          confirmBtnEl.classList.toggle('opacity-50', Boolean(problema));
          confirmBtnEl.classList.toggle('cursor-not-allowed', Boolean(problema));
        }
        return !problema;
      };

      const confirm = () => {
        if (!revalidar()) return;
        const value = Number.parseInt((input?.value || '').trim(), 10);
        // Com escolha de etapa o retorno vira objeto; sem ela continua sendo o
        // número, para não mexer em quem já chamava este diálogo.
        if (etapas.length) {
          close({ quantidade: value, ordem: escolhaAtual() });
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
      confirmBtnEl?.addEventListener('click', confirm);
      const sanitizeInput = () => {
        if (!input) return;
        const sanitized = input.value.replace(/[^0-9]/g, '');
        if (sanitized !== input.value) input.value = sanitized;
        revalidar();
      };

      input?.addEventListener('keydown', e => {
        if (['e', 'E', ',', '.', '+', '-'].includes(e.key)) {
          e.preventDefault();
        }
      });

      input?.addEventListener('input', sanitizeInput);
      // Trocar a peça de destino troca o teto: o campo tem de ser conferido de
      // novo na hora, não só quando o usuário tentar salvar.
      select?.addEventListener('change', revalidar);

      document.addEventListener('keydown', onKeyDown);
      revalidar();
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

    let cardsRenderizados = 0;

    entries.forEach(entry => {
      const { order, items } = entry;
      const meta = getOrderMeta(order);
      const badgeClass = isOrderInProduction(order) ? 'badge-warning' : 'badge-neutral';
      // As peças do DESTINO, agrupadas por ponto da rota — não uma linha por
      // peça deste pedido repetindo o mesmo total. Cada linha diz o estágio, o
      // quanto ainda existe lá e o quanto já foi substituído nesta tela.
      const grupos = temComposicao(order.id) ? gruposCompativeis(order.id, items) : [];
      const assignedTotal = getAssignedForOrder(order.id);
      const livreTotal = grupos.reduce((soma, grupo) => soma + livreNoGrupo(grupo), 0);

      // Sem espaço, o pedido não está "disponível para realocação": ele sai da
      // lista. O que foi atribuído a ele continua visível no resumo.
      if (grupos.length && livreTotal <= 0) return;

      // Com mais de um produto em comum, o ponto da rota sozinho não separa as
      // linhas: dois produtos têm "15/15" cada um.
      const varios = produtosCompativeis(items).length > 1;

      const itemsList = grupos.length
        ? grupos
          .filter(grupo => livreNoGrupo(grupo) > 0)
          .map(grupo => {
            const livre = livreNoGrupo(grupo);
            const usado = grupo.jaSubstituido > 0
              ? `<span class="text-[11px] text-primary-200">${formatUnitsLabel(grupo.jaSubstituido)} já substituída(s)</span>`
              : '';
            return `
            <div class="flex items-center justify-between gap-3 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
              <span class="flex flex-col">
                ${varios && grupo.produtoNome
    ? `<span class="text-xs text-white">${grupo.produtoNome}</span>`
    : ''}
                <span class="text-xs text-gray-200">${grupo.rotulo}</span>
                ${usado}
              </span>
              <span class="text-xs font-semibold text-white">
                ${formatUnitsLabel(livre)} de ${formatUnitsLabel(grupo.quantidade)}
              </span>
            </div>`;
          }).join('')
        // Sem a composição do destino (consulta falhou), resta o nome da peça —
        // uma linha por produto, não uma por grupo deste pedido, senão a mesma
        // peça aparece repetida quatro vezes com o mesmo total.
        : Array.from(
          new Map((items || []).map(match => [match.name, match])).values()
        ).map(match => `
        <div class="flex items-center justify-between gap-3 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
          <span class="text-xs text-gray-200">${match.name}</span>
          <span class="text-xs font-semibold text-white">${match.quantityLabel}</span>
        </div>
      `).join('');
      const assignedLabel = assignedTotal > 0
        ? `<div class="pt-2 border-t border-white/5 text-xs text-primary-200">Destinado: ${formatUnitsLabel(assignedTotal)}</div>`
        : '';

      const cliente = nomeDoCliente(order);
      const card = document.createElement('div');
      card.className = 'glass-surface rounded-xl border border-white/10 p-4 transition hover:border-primary/40 space-y-3';
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <h4 class="font-medium text-white">#${order.numero || order.id}</h4>
          <span class="${badgeClass} px-2 py-1 rounded-full text-[11px] font-medium">${order.situacao || '—'}</span>
        </div>
        <p class="text-gray-300 text-sm">Cliente: ${cliente || '—'}</p>
        <p class="text-gray-300 text-xs">Valor: ${formatCurrency(order.valor_final)}</p>
        <p class="text-xs font-semibold text-red-400">Convertido em ${meta.conversionLabel}</p>
        <span class="inline-flex px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-[11px] font-semibold text-red-300">${meta.daysLabel}</span>
        ${itemsList ? `<div class="space-y-2 pt-2 border-t border-white/5"><p class="text-xs text-gray-300 uppercase tracking-wide">Peças disponíveis para substituição</p>${itemsList}</div>` : ''}
        ${assignedLabel}
      `;
      ordersList.appendChild(card);
      cardsRenderizados += 1;
    });

    // Todos os destinos ficaram sem espaço: a seção precisa dizer isso, senão
    // sobra uma lista vazia sem explicação.
    if (!cardsRenderizados) {
      ordersList.classList.add('hidden');
      ordersEmpty.classList.remove('hidden');
      ordersEmpty.textContent = 'Todas as peças dos pedidos compatíveis já foram substituídas.';
    }
  }

  function renderDrawerOrdersForItem(key) {
    if (!drawerList || !drawerEmpty) return;
    drawerList.innerHTML = '';
    const matches = key ? itemMatches.get(key) || [] : [];
    const state = destinationState.get(key);
    const info = itemInfo.get(String(key));
    const hasOrders = matches.length > 0;

    if (!hasOrders) {
      drawerList.classList.add('hidden');
      drawerEmpty.textContent = ordersLoading
        ? 'Carregando pedidos disponíveis...'
        : 'Nenhum pedido disponível para realocação.';
      drawerEmpty.classList.remove('hidden');
      return;
    }

    let cardsRenderizados = 0;

    matches.forEach(({ order, quantity }) => {
      const { conversionLabel, daysLabel } = getOrderMeta(order);
      const badgeClass = isOrderInProduction(order) ? 'badge-warning' : 'badge-success';
      const button = document.createElement('button');
      button.type = 'button';

      // O que ESTA peça já mandou para este pedido — podendo ser mais de uma
      // substituição, em grupos diferentes do destino.
      const entradas = (state?.reallocations || [])
        .filter(entry => String(entry.orderId) === String(order.id));
      const assigned = entradas.reduce((soma, entry) => soma + normalizeQuantity(entry.quantity), 0);

      // "Compatível" é o que AINDA cabe lá, não o total de peças do destino:
      // depois de substituir 2 das 7, restam 5.
      const grupos = temComposicao(order.id)
        ? gruposDoDestino(order.id, info?.item?.produto_id)
        : [];
      const livre = grupos.length
        ? grupos.reduce((soma, grupo) => soma + livreNoGrupo(grupo), 0)
        : normalizeQuantity(quantity);

      // Sem lugar livre não há o que escolher: o pedido sai da lista.
      if (grupos.length && livre <= 0) return;

      const available = grupos.length
        ? Math.min(normalizeQuantity(state?.remaining || 0), livre)
        : normalizeQuantity(state?.remaining || 0);

      const detalhe = entradas.length
        ? entradas.map(entry => `
          <span class="text-[11px] text-primary-200">
            ${entry.grupoDestinoRotulo || 'peça do destino'}: ${formatUnitsLabel(entry.quantity)}
          </span>`).join('')
        : '';

      button.className = `w-full text-left glass-surface rounded-xl border px-4 py-4 transition hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40 space-y-3 ${assigned > 0 ? 'border-primary/60 bg-primary/10' : 'border-white/10'}`;
      button.innerHTML = `
        <div class="flex items-center justify-between">
          <h4 class="font-medium text-white">#${order.numero || order.id}</h4>
          <span class="${badgeClass} px-2 py-1 rounded-full text-[11px] font-medium">${order.situacao || 'Disponível'}</span>
        </div>
        <div>
          <p class="text-gray-300 text-sm">Cliente: ${nomeDoCliente(order) || '—'}</p>
          <p class="text-gray-300 text-xs">Valor: ${formatCurrency(order.valor_final)}</p>
        </div>
        <div class="space-y-2">
          <p class="text-xs font-semibold text-red-400">Convertido em ${conversionLabel}</p>
          <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-[11px] font-semibold text-red-300">${daysLabel}</span>
            <span class="inline-flex px-2 py-1 rounded-full border border-primary/40 bg-primary/10 text-[11px] font-semibold text-primary-200">Ainda pode substituir: ${formatUnitsLabel(livre)}</span>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-gray-300">Desta peça você pode enviar: ${formatUnitsLabel(available)}</span>
          ${assigned > 0 ? `<span class="text-xs text-primary-200 font-semibold">Já enviadas: ${formatUnitsLabel(assigned)}</span>` : ''}
          ${detalhe}
        </div>
        <div class="flex justify-end">
          <span class="btn-primary px-3 py-1 rounded text-xs">Selecionar este pedido</span>
        </div>
      `;
      button.addEventListener('click', () => selectReallocationOrder(order.id));
      drawerList.appendChild(button);
      cardsRenderizados += 1;
    });

    if (!cardsRenderizados) {
      drawerList.classList.add('hidden');
      drawerEmpty.textContent = 'Nenhum pedido com peça disponível para substituir.';
      drawerEmpty.classList.remove('hidden');
      return;
    }

    drawerEmpty.classList.add('hidden');
    drawerList.classList.remove('hidden');
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
        // Na realocação a peça vai como está: o rótulo é o ponto de origem. E
        // ao lado, QUAL peça do destino ela substitui — sem isso o resumo diz
        // de onde a peça saiu e nada sobre o lugar que ela vai ocupar.
        bucket.items.push({
          key,
          name: info.name,
          quantity: qty,
          rotulo: rotuloDaOrigem(key),
          grupoDestino: entry.grupoDestino ?? null,
          rotuloDestino: entry.grupoDestinoRotulo || ''
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
          bucket.items.sort((a, b) => a.name.localeCompare(b.name)
            || String(a.rotuloDestino).localeCompare(String(b.rotuloDestino))).forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'w-full flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-left text-xs text-gray-200 hover:border-primary/40 transition';
            // Nome + PONTO da rota + a peça de destino substituída: sem os dois
            // rótulos o resumo mostra linhas iguais e não diz o que a peça foi
            // ocupar do outro lado.
            btn.innerHTML = `
              <span class="flex flex-col">
                <span>${item.name}</span>
                ${item.rotulo ? `<span class="text-[11px] text-gray-400">${item.rotulo}</span>` : ''}
                ${item.rotuloDestino
    ? `<span class="text-[11px] text-sky-300/90">substitui: ${item.rotuloDestino}</span>`
    : ''}
              </span>
              <span class="text-white font-semibold">${formatUnitsLabel(item.quantity)}</span>
            `;
            btn.addEventListener('click', () => openReallocationQuantity(item.key, bucket.orderId, item.grupoDestino));
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
    // O drawer cria uma substituição NOVA, então precisa de saldo livre. Com
    // tudo já destinado, o caminho é clicar na substituição existente.
    if (!state || normalizeQuantity(state.remaining) <= 0) {
      const message = hasExisting
        ? 'Todas as unidades já têm destino. Clique na realocação existente para ajustá-la.'
        : 'Não há quantidade disponível para realocar. Ajuste outras destinações primeiro.';
      if (typeof showToast === 'function') {
        showToast(message, 'info');
      } else if (typeof window.alert === 'function') {
        window.alert(message);
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

  /**
   * @param {string|null} [chaveGrupoEdicao]  qual substituição está sendo
   *   ALTERADA. Omitir cria uma nova: a mesma peça pode substituir peças
   *   diferentes do mesmo pedido de destino — 3 unidades no lugar de uma peça
   *   parada em 9/15 e 2 no lugar de outra pronta —, e cada uma é uma linha
   *   própria. Guardar uma realocação por pedido fazia a segunda escolha
   *   apagar a primeira. `null` é um valor legítimo aqui: é a chave das
   *   realocações restauradas de antes desta escolha existir.
   */
  async function openReallocationQuantity(key, orderId, chaveGrupoEdicao) {
    const info = itemInfo.get(key);
    const state = ensureDestinationState(key, info?.quantity || 0);
    const editando = chaveGrupoEdicao !== undefined;
    const existing = editando
      ? (state.reallocations || []).find(entry => String(entry.orderId) === String(orderId)
        && String(entry.grupoDestino ?? '') === String(chaveGrupoEdicao ?? ''))
      : null;
    const currentValue = existing ? normalizeQuantity(existing.quantity) : 0;
    const available = normalizeQuantity(state.remaining + currentValue);

    if (available <= 0) {
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
    // Peça sem lugar livre não entra na lista: oferecer "0 disponível(is)" é
    // oferecer uma escolha que não pode ser salva.
    const grupos = gruposDoDestino(orderId, info?.item?.produto_id)
      .filter(grupo => livreNoGrupo(grupo, existing) > 0);

    if (!grupos.length) {
      const message = `Todas as peças do ${formatOrderLabel(orderId)} já foram substituídas.`;
      if (typeof showToast === 'function') showToast(message, 'info');
      return false;
    }

    const porChave = new Map(grupos.map(grupo => [String(grupo.chave), grupo]));
    const resposta = await openQuantityDialog({
      title: `Realocar para ${formatOrderLabel(orderId)}`,
      description: `Escolha qual peça do ${formatOrderLabel(orderId)} será substituída por `
        + `${info?.name || 'esta peça'} e quantas unidades.`,
      max: available,
      initial: currentValue,
      confirmLabel: 'Salvar realocação',
      // Reaproveita o seletor do diálogo: aqui ele lista os GRUPOS do destino.
      etapas: grupos.map(grupo => ({
        ordem: grupo.chave,
        rotulo: `${grupo.rotulo} — ${formatUnitsLabel(livreNoGrupo(grupo, existing))} disponível(is)`,
        selecionada: String(grupo.chave) === String(existing?.grupoDestino)
      })),
      etapaLabel: 'Qual peça do pedido de destino será substituída?',
      etapaAjuda: '',
      // O teto é o da PEÇA escolhida, conferido a cada digitada.
      limitePara: chave => livreNoGrupo(porChave.get(String(chave)), existing),
      ajudaPara: chave => {
        const grupo = porChave.get(String(chave));
        if (!grupo) return '';
        return grupo.origem === 'producao'
          ? 'Esta peça ocupa o lugar de uma unidade que o pedido de destino ia produzir do zero: '
            + 'a matéria-prima reservada para fazê-la é estornada ao estoque de matéria-prima.'
          : `A peça ${grupo.rotulo} do pedido de destino é substituída: ela volta ao estoque de `
            + 'produtos e a matéria-prima que ainda seria usada para terminá-la é estornada ao '
            + 'estoque de matéria-prima.';
      }
    });

    if (resposta === null) return false;

    const quantity = normalizeQuantity(typeof resposta === 'object' ? resposta.quantidade : resposta);
    const chaveEscolhida = typeof resposta === 'object' ? resposta.ordem : null;
    const grupoEscolhido = porChave.get(String(chaveEscolhida)) || grupos[0];

    state.reallocations = aplicarSubstituicao(state.reallocations, {
      orderId,
      quantidade: quantity,
      grupo: grupoEscolhido,
      anterior: existing
    });

    updateItemDestinationsUI(key);
    refreshOrdersUI();
    return true;
  }

  async function selectReallocationOrder(orderId) {
    if (!currentReallocationKey) return;
    // Pelo drawer sempre se cria uma substituição NOVA — editar uma existente é
    // clicar nela, na coluna de destinações ou no resumo.
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
      // Em paralelo com os pedidos: o card do destino mostra o NOME do cliente,
      // e a lista de pedidos só traz o id dele.
      const nomesCarregando = carregarNomesClientes();
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

      /** Um pedido candidato: busca os itens dele, se ainda não vieram. */
      const prepararPedido = async raw => {
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

        // Sem peça nenhuma não há o que realocar: o pedido fica de fora.
        const temPeca = Array.isArray(order.__itemEntries)
          && order.__itemEntries.some(entry => Number(entry.quantity) > 0);
        return temPeca ? order : null;
      };

      // EM BLOCOS, não um pedido de cada vez.
      //
      // Cada candidato custa uma ida à API. Em fila indiana, dez pedidos em
      // produção eram dez esperas somadas antes de o modal aparecer — e o resto
      // do app ficava atrás delas. Quatro por vez é rápido sem inundar a API.
      const POR_VEZ = 4;
      const prepared = [];
      for (let i = 0; i < list.length; i += POR_VEZ) {
        const bloco = await Promise.all(list.slice(i, i + POR_VEZ).map(prepararPedido));
        prepared.push(...bloco.filter(Boolean));
      }

      await nomesCarregando;
      availableOrders = prepared.sort(compareOrdersByProductionDate);
      rebuildMatches();

      // A COMPOSIÇÃO dos destinos vem ANTES da primeira renderização.
      //
      // Sem ela a lista caía no formato antigo — uma linha por peça deste
      // pedido, todas com o mesmo total — e só se arrumava quando o usuário
      // marcava alguma substituição. A tela tem de abrir já certa.
      await Promise.all(
        aggregatedOrderEntries.map(entry => carregarComposicaoDestino(entry.order.id))
      );
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
        // Os pontos da rota escolhidos: sem eles, restaurar devolveria tudo no
        // fim da rota e a conta do material sairia errada.
        stockPorEtapa: (state.stockPorEtapa || []).map(entrada => ({
          ordem: entrada.ordem ?? null,
          quantidade: normalizeQuantity(entrada.quantidade)
        })),
        discard: normalizeQuantity(state.discard),
        reallocations: (state.reallocations || []).map(entry => ({
          orderId: entry.orderId,
          quantity: normalizeQuantity(entry.quantity),
          // QUAL peça do destino cada substituição ocupa. Sem isso a
          // restauração devolvia a quantidade e perdia o lugar dela.
          grupoDestino: entry.grupoDestino ?? null,
          pedidoItemDestino: entry.pedidoItemDestino ?? null,
          grupoDestinoRotulo: entry.grupoDestinoRotulo || '',
          grupoDestinoInfo: entry.grupoDestinoInfo || null
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

        state.stockPorEtapa = (destino.stockPorEtapa || [])
          .map(entrada => ({
            ordem: entrada.ordem ?? null,
            quantidade: normalizeQuantity(entrada.quantidade)
          }))
          .filter(entrada => entrada.quantidade > 0);
        state.stock = state.stockPorEtapa.length
          ? state.stockPorEtapa.reduce((soma, entrada) => soma + entrada.quantidade, 0)
          : normalizeQuantity(destino.stock);
        state.discard = normalizeQuantity(destino.discard);
        state.reallocations = (destino.reallocations || []).filter(entry => {
          const existe = !pedidosValidos.size || pedidosValidos.has(String(entry.orderId));
          if (!existe) realocacoesDescartadas += 1;
          return existe;
        }).map(entry => ({
          orderId: entry.orderId,
          quantity: normalizeQuantity(entry.quantity),
          grupoDestino: entry.grupoDestino ?? null,
          pedidoItemDestino: entry.pedidoItemDestino ?? null,
          grupoDestinoRotulo: entry.grupoDestinoRotulo || '',
          grupoDestinoInfo: entry.grupoDestinoInfo || null
        }));

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
      if (!resp.ok) {
        // Decisão que não fecha com o pedido: NADA foi gravado e o pedido
        // continua ativo. A lista de problemas diz o que refazer — mais útil
        // que "erro ao cancelar".
        if (corpo?.code === 'DECISOES_INVALIDAS' && Array.isArray(corpo.problemas) && corpo.problemas.length) {
          throw new Error(`${corpo.problemas.join(' ')} Nada foi alterado.`);
        }
        // Estorno interrompido no meio: o pedido continua ativo, mas parte do
        // trabalho pode ter sido gravada. O usuário precisa saber as duas
        // coisas — e o console guarda o detalhe do que já foi.
        if (corpo?.code === 'ESTORNO_INCONSISTENTE') {
          console.error('Estorno interrompido:', corpo.detalhe, corpo.avisos);
          throw new Error(corpo.detalhe || corpo.error);
        }
        throw new Error(corpo?.detalhe || corpo?.error || 'Falha ao cancelar pedido');
      }

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
          + `${e.tiposDeInsumo ?? 0} tipo(s) de insumo movimentado(s)`
          + ((e.insumosConsumidos ?? 0) > 0
            ? ` (${e.insumosConsumidos} consumo(s) no pedido de destino).`
            : '.')
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
