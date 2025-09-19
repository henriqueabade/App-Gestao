(function(){
  const overlayId = 'converterOrcamento';
  const overlay = document.getElementById('converterOrcamentoOverlay');
  if (!overlay) return;
  const close = () => Modal.close(overlayId);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  let replaceModalRefs = null;
  const replaceModalState = {
    selectedProductId: null,
    selectedVariantKey: null,
    searchTerm: '',
    variants: []
  };

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
          <div class="flex justify-center gap-2">
            <button class="btn-secondary px-2 py-1 rounded text-xs" data-action="view-insumos" data-peca-id="${r.produto_id}">Visualizar</button>
            <button class="btn-warning px-2 py-1 rounded text-xs" data-action="replace">Substituir</button>
            <button class="${actionClass} px-2 py-1 rounded text-xs" data-action="toggle-approval">${actionLabel}</button>
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
            <div class="bg-surface/40 rounded-lg border border-white/10 p-4">
              <h4 class="font-medium text-white mb-3">Peça Atual</h4>
              <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <p class="text-gray-400 text-xs mb-1">Nome</p>
                  <p class="text-white font-medium" data-field="piece-name"></p>
                </div>
                <div>
                  <p class="text-gray-400 text-xs mb-1">Qtd Orçada</p>
                  <p class="text-white font-medium" data-field="piece-qty"></p>
                </div>
                <div>
                  <p class="text-gray-400 text-xs mb-1">Status</p>
                  <span class="badge-warning px-2 py-1 rounded text-xs" data-field="piece-status"></span>
                </div>
                <div>
                  <p class="text-gray-400 text-xs mb-1">Etapa</p>
                  <span class="badge-info px-2 py-1 rounded text-xs" data-field="piece-stage"></span>
                </div>
              </div>
              <p class="text-gray-400 text-sm mt-4" data-field="piece-details"></p>
            </div>
            <div class="bg-surface/40 rounded-lg border border-white/10 p-4">
              <h4 class="font-medium text-white mb-3">Buscar alternativa</h4>
              <input type="text" data-role="search" placeholder="Buscar por nome ou código" class="w-full bg-input border border-inputBorder rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition" />
            </div>
            <div class="bg-surface/40 rounded-lg border border-white/10 p-4">
              <h4 class="font-medium text-white mb-4">Peças compatíveis</h4>
              <div data-role="results" class="space-y-3 max-h-[320px] overflow-y-auto pr-1 modal-scroll"></div>
            </div>
          </div>
        </div>
        <footer class="flex justify-end items-center gap-3 px-6 py-4 border-t border-white/10">
          <button type="button" data-action="close" class="btn-neutral px-5 py-2 rounded-lg text-white font-medium">Cancelar</button>
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
      search: overlay.querySelector('[data-role="search"]'),
      results: overlay.querySelector('[data-role="results"]')
    };
    overlay.querySelectorAll('[data-action="close"]').forEach(btn => btn.addEventListener('click', closeReplaceModal));
    replaceModalRefs.confirmBtn?.addEventListener('click', handleReplaceModalConfirm);
    if (replaceModalRefs.search) {
      replaceModalRefs.search.placeholder = 'Filtrar variações por nome ou código';
    }
    replaceModalRefs.search?.addEventListener('input', e => {
      replaceModalState.searchTerm = e.target.value || '';
      renderReplaceModalList();
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
    await (listaProdutos.length ? Promise.resolve() : carregarProdutos());
    currentReplaceIndex = index;
    const refs = ensureReplaceModal();
    const row = rows[index];
    if (!row) return;
    replaceModalState.selectedProductId = row.forceProduceAll ? null : Number(row.produto_id || 0);
    replaceModalState.selectedVariantKey = row.forceProduceAll
      ? 'produce-new'
      : (row.produto_id != null ? `stock-${row.produto_id}` : null);
    replaceModalState.searchTerm = '';
    replaceModalState.variants = [];
    if (refs.search) refs.search.value = '';
    renderReplaceModalSummary();
    renderReplaceModalList();
    updateReplaceModalConfirmButton();
    refs.overlay.classList.remove('hidden');
    requestAnimationFrame(() => { refs.modal?.focus(); });
  }

  function closeReplaceModal() {
    if (!replaceModalRefs) return;
    replaceModalRefs.overlay.classList.add('hidden');
    replaceModalState.selectedProductId = null;
    replaceModalState.selectedVariantKey = null;
    replaceModalState.searchTerm = '';
    replaceModalState.variants = [];
    if (replaceModalRefs.search) replaceModalRefs.search.value = '';
    currentReplaceIndex = -1;
    updateReplaceModalConfirmButton();
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
    const estoque = toNumber(row.em_estoque);
    const produzir = toNumber(row.a_produzir);
    if (row.forceProduceAll) {
      setReplaceModalField('piece-status', `Produção integral planejada (${formatNumber(qtd)} un)`);
    } else {
      setReplaceModalField('piece-status', `Estoque: ${formatNumber(estoque)} | Produzir: ${formatNumber(produzir)}`);
    }
    const etapa = row.faltantes?.[0]?.etapa || row.popover?.variants?.[0]?.currentProcess?.name || '-';
    setReplaceModalField('piece-stage', etapa || '-');
    setReplaceModalField('piece-details', `${formatNumber(qtd)} unidades - Etapa: ${etapa || '-'}`);
    const subtitle = ctx.numero ? `Orçamento ${ctx.numero}` : (ctx.cliente || '');
    setReplaceModalField('modal-subtitle', subtitle);
  }

  function renderReplaceModalList() {
    if (!replaceModalRefs) return;
    const container = replaceModalRefs.results;
    if (!container) return;
    const row = rows[currentReplaceIndex];
    if (!row) {
      container.innerHTML = '<p class="text-sm text-gray-400">Nenhuma peça selecionada.</p>';
      replaceModalState.variants = [];
      updateReplaceModalConfirmButton();
      return;
    }

    const requiredQty = Number(row.qtd || row.quantidade || 0) || 0;
    const rowGroupKey = buildGroupKey(row.nome, row.produto_id);

    const productVariantsMap = new Map();
    listaProdutos.forEach(prod => {
      if (buildGroupKey(prod.nome, prod.id) !== rowGroupKey) return;
      const available = Number(prod.quantidade_total || prod.estoque || 0) || 0;
      productVariantsMap.set(Number(prod.id), {
        key: `stock-${prod.id}`,
        type: 'stock',
        product: prod,
        available,
        description: prod.descricao || '',
        price: Number(prod.preco_venda || 0) || 0,
        isCurrent: Number(prod.id) === Number(row.produto_id)
      });
    });

    const productVariants = Array.from(productVariantsMap.values())
      .filter(variant => variant.available > 0 || variant.isCurrent)
      .sort((a, b) => {
        if (a.isCurrent && !b.isCurrent) return -1;
        if (!a.isCurrent && b.isCurrent) return 1;
        return (b.available - a.available) || 0;
      });

    const produceVariant = {
      key: 'produce-new',
      type: 'produce',
      name: 'Produzir do zero',
      description: 'Nenhuma peça será retirada do estoque. Toda a quantidade será enviada para produção.',
      available: requiredQty,
      product: null
    };

    replaceModalState.variants = [...productVariants, produceVariant];

    const variantKeys = new Set(replaceModalState.variants.map(v => v.key));
    if (!variantKeys.has(replaceModalState.selectedVariantKey)) {
      if (row.forceProduceAll) {
        replaceModalState.selectedVariantKey = 'produce-new';
        replaceModalState.selectedProductId = null;
      } else {
        const preferred = productVariants.find(v => v.isCurrent && v.available > 0)
          || productVariants.find(v => v.isCurrent)
          || productVariants[0]
          || null;
        if (preferred) {
          replaceModalState.selectedVariantKey = preferred.key;
          replaceModalState.selectedProductId = Number(preferred.product.id);
        } else {
          replaceModalState.selectedVariantKey = 'produce-new';
          replaceModalState.selectedProductId = null;
        }
      }
    }

    const searchTerm = normalizeText(replaceModalState.searchTerm || '');
    const filteredProducts = searchTerm
      ? productVariants.filter(variant => {
          const name = normalizeText(variant.product?.nome || '');
          const code = normalizeText(variant.product?.codigo || '');
          const desc = normalizeText(variant.description || '');
          return name.includes(searchTerm) || code.includes(searchTerm) || desc.includes(searchTerm);
        })
      : productVariants;

    container.innerHTML = '';

    const info = document.createElement('div');
    info.className = 'mb-4 text-sm text-gray-300 space-y-1';
    const plural = requiredQty === 1 ? '' : 's';
    info.innerHTML = `
      <p class="text-gray-200">Quantidade orçada: <span class="text-white font-semibold">${requiredQty.toLocaleString('pt-BR')}</span> unidade${plural}</p>
      <p class="text-xs text-gray-400">Escolha uma variação disponível em estoque ou opte por produzir do zero para manter a quantidade planejada.</p>`;
    container.appendChild(info);

    if (!productVariants.length) {
      const alert = document.createElement('p');
      alert.className = 'text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-4';
      alert.textContent = 'Nenhuma variação com estoque disponível foi encontrada. Utilize a opção de produção para cumprir o orçamento.';
      container.appendChild(alert);
    } else if (!filteredProducts.length) {
      const alert = document.createElement('p');
      alert.className = 'text-xs text-gray-400 mb-4';
      alert.textContent = 'Nenhuma variação corresponde aos filtros aplicados.';
      container.appendChild(alert);
    }

    const variantsToRender = [...filteredProducts, produceVariant];

    variantsToRender.forEach(variant => {
      const isSelected = replaceModalState.selectedVariantKey === variant.key;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.variantKey = variant.key;
      button.className = 'w-full text-left bg-surface/40 border border-white/10 rounded-xl px-4 py-4 transition hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40 mb-3 last:mb-0';
      if (isSelected) {
        button.classList.add('border-primary', 'ring-1', 'ring-primary/50');
      }

      if (variant.type === 'stock') {
        const insufficient = variant.available < requiredQty && requiredQty > 0;
        const badgeClass = insufficient ? 'badge-warning' : 'badge-success';
        const badgeText = insufficient
          ? `${variant.available.toLocaleString('pt-BR')} em estoque (insuficiente)`
          : `${variant.available.toLocaleString('pt-BR')} em estoque`;
        const priceInfo = variant.price
          ? `<span class="px-2 py-1 rounded-full bg-white/5 border border-white/10">R$ ${variant.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`
          : '';
        const categoriaInfo = variant.product?.categoria
          ? `<span class="px-2 py-1 rounded-full bg-white/5 border border-white/10">${variant.product.categoria}</span>`
          : '';
        const descriptionHtml = variant.description
          ? `<p class="text-gray-400 text-xs mt-2">${variant.description}</p>`
          : '';
        const insuffInfo = insufficient
          ? `<p class="text-xs text-amber-300 mt-2">Estoque menor que o necessário para ${requiredQty.toLocaleString('pt-BR')} unidade${plural}. Selecione outra variação ou produza do zero.</p>`
          : '';
        button.innerHTML = `
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-white font-medium">${variant.product?.nome || 'Peça sem nome'}</p>
              <p class="text-gray-400 text-xs">${variant.product?.codigo || ''}</p>
              ${descriptionHtml}
              ${insuffInfo}
            </div>
            <span class="${badgeClass} px-2 py-1 rounded text-xs">${badgeText}</span>
          </div>
          <div class="mt-3 flex flex-wrap gap-2 text-xs text-gray-300">
            <span class="px-2 py-1 rounded-full bg-white/5 border border-white/10">ID ${variant.product?.id}</span>
            ${categoriaInfo}
            ${priceInfo}
          </div>`;
      } else {
        button.innerHTML = `
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-white font-medium">Produzir do zero</p>
              <p class="text-gray-400 text-xs mt-2">${requiredQty > 0
                ? `Produzir ${requiredQty.toLocaleString('pt-BR')} unidade${plural} a partir da matéria-prima, sem utilizar estoque.`
                : 'Enviar a peça diretamente para produção, sem utilizar estoque.'}</p>
            </div>
            <span class="badge-info px-2 py-1 rounded text-xs">${requiredQty.toLocaleString('pt-BR')} para produzir</span>
          </div>`;
      }

      button.addEventListener('click', () => {
        replaceModalState.selectedVariantKey = variant.key;
        if (variant.type === 'stock') {
          replaceModalState.selectedProductId = Number(variant.product?.id || 0) || null;
        } else {
          replaceModalState.selectedProductId = null;
        }
        updateReplaceModalConfirmButton();
        renderReplaceModalList();
      });

      container.appendChild(button);
    });

    updateReplaceModalConfirmButton();
  }

  function findSelectedVariant() {
    return replaceModalState.variants.find(v => v.key === replaceModalState.selectedVariantKey) || null;
  }

  function updateReplaceModalConfirmButton() {
    if (!replaceModalRefs || !replaceModalRefs.confirmBtn) return;
    const btn = replaceModalRefs.confirmBtn;
    const row = rows[currentReplaceIndex];
    const requiredQty = Number(row?.qtd || row?.quantidade || 0) || 0;
    const selected = findSelectedVariant();
    let disabled = !selected;
    let label = 'Confirmar Substituição';

    if (selected) {
      if (selected.type === 'produce') {
        label = requiredQty > 0
          ? `Produzir ${requiredQty.toLocaleString('pt-BR')} un`
          : 'Produzir do zero';
      } else {
        if (selected.available < requiredQty && requiredQty > 0) {
          disabled = true;
          label = 'Estoque insuficiente';
        } else {
          label = 'Confirmar Substituição';
        }
      }
    }

    btn.disabled = disabled;
    btn.className = disabled
      ? 'btn-primary px-5 py-2 rounded-lg text-white font-medium transition opacity-60 cursor-not-allowed'
      : 'btn-primary px-5 py-2 rounded-lg text-white font-medium transition';
    btn.textContent = label;
  }

  function handleReplaceModalConfirm() {
    if (currentReplaceIndex < 0) return;
    const row = rows[currentReplaceIndex];
    if (!row) return;
    const selected = findSelectedVariant();
    if (!selected) return;

    if (selected.type === 'produce') {
      row.forceProduceAll = true;
      row.approved = false;
      closeReplaceModal();
      recomputeStocks();
      renderRows();
      validate();
      computeInsumosAndRender();
      return;
    }

    const produto = selected.product;
    if (!produto) return;
    if (row._origId == null) row._origId = row.produto_id;
    row.produto_id = Number(produto.id);
    row.nome = produto.nome;
    row.preco_venda = Number(produto.preco_venda || 0);
    row.codigo = produto.codigo;
    row.forceProduceAll = false;
    row.approved = false;
    closeReplaceModal();
    recomputeStocks();
    renderRows();
    validate();
    computeInsumosAndRender();
  }

  // Botões básicos
  btnCancelar.addEventListener('click', close);
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
      const codigo = prod?.codigo; r.status=''; r.faltantes=[]; r.produzir_total=0; r.produzir_parcial=0; r.popover={variants:[]}; r.pronta=0; r.em_estoque=0; r.a_produzir=0;
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
  (async function init(){
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




