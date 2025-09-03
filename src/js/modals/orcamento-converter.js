(function(){
  const overlayId = 'converterOrcamento';
  const overlay = document.getElementById('converterOrcamentoOverlay');
  if (!overlay) return;
  const close = () => Modal.close(overlayId);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e){ if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', esc); } });

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
  const allowNegativeToggle = document.getElementById('allowNegativeToggle');
  const onlyMissingToggle = document.getElementById('onlyMissingToggle');
  const insumosReloadBtn = document.querySelector('button[data-action="insumos-reload"]');
  const insumosTituloPeca = document.getElementById('insumosTituloPeca');

  const drawer = document.getElementById('converterReplaceDrawer');
  const replacingName = document.getElementById('converterReplacingName');
  const searchProduto = document.getElementById('converterSearchProduto');
  const replaceList = document.getElementById('converterReplaceList');

  let listaProdutos = [];
  let rows = Array.isArray(ctx.items) ? ctx.items.map(p => ({...p})) : [];
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
      let statusHtml = '<span class="text-green-400" title="OK">&#10003;</span>';
      if (r.a_produzir > 0 && r.status === 'atencao') statusHtml = '<span class="text-orange-300" title="Atenção">&#9888;</span>';

      const infoSpan = (Array.isArray(r.popover?.variants) && r.popover.variants.length > 0) ? `
        <span class="js-piece-info inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors ml-1" aria-haspopup="dialog" aria-expanded="false" data-variants='${JSON.stringify(r.popover.variants)}' data-page="0">
          <svg class="w-3 h-3 text-gray-300" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0116 0zm-7-4a 1 1 0 11-2 0 1 1 0 012 0zM9 9a 1 1 0 000 2v3a 1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
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
            <button class="btn-danger px-2 py-1 rounded text-xs" data-action="delete">Excluir</button>
          </div>
        </td>`;
      pecasBody.appendChild(tr);
    });

    pecasBody.querySelectorAll('button[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', e => {
        const tr = e.currentTarget.closest('tr');
        const i = Number(tr?.dataset.index);
        if (!isNaN(i)) {
          const toDel = rows[i];
          const ok = confirm(`Excluir "${toDel?.nome}" do orçamento?`);
          if (ok) {
            rows.splice(i, 1);
            recomputeStocks();
            renderRows();
            validate();
            computeInsumosAndRender();
          }
        }
      });
    });

    pecasBody.querySelectorAll('button[data-action="replace"]').forEach(btn => {
      btn.addEventListener('click', e => {
        const tr = e.currentTarget.closest('tr');
        currentReplaceIndex = Number(tr?.dataset.index);
        if (isNaN(currentReplaceIndex)) return;
        replacingName.textContent = rows[currentReplaceIndex]?.nome || '';
        openDrawer();
        renderReplaceList();
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

    // Inicializa popovers após render
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

  function openDrawer() { drawer.classList.remove('hidden'); }
  function closeDrawer() { drawer.classList.add('hidden'); currentReplaceIndex = -1; searchProduto.value = ''; }

  function renderReplaceList() {
    const term = (searchProduto.value || '').toLowerCase();
    const filtered = listaProdutos.filter(p => !term || (String(p.codigo||'').toLowerCase().includes(term) || String(p.nome||'').toLowerCase().includes(term)));
    replaceList.innerHTML = '';
    filtered.slice(0, 50).forEach(p => {
      const card = document.createElement('div');
      card.className = 'bg-surface/40 rounded-lg p-4 border border-white/10 hover:border-primary/30 transition';
      const estoque = Number(p.quantidade_total || 0);
      card.innerHTML = `
        <div class="flex justify-between items-start mb-1">
          <h4 class="font-medium text-white">${p.nome}</h4>
          <span class="${estoque > 0 ? 'badge-success' : 'badge-warning'} px-2 py-1 rounded text-xs">${estoque} em estoque</span>
        </div>
        <p class="text-gray-400 text-xs mb-3">${p.codigo || ''}</p>
        <button class="btn-primary px-3 py-1 rounded text-sm" data-id="${p.id}" data-nome="${p.nome}" data-preco="${Number(p.preco_venda||0)}">Selecionar</button>`;
      replaceList.appendChild(card);
    });
    replaceList.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        const id = Number(e.currentTarget.getAttribute('data-id'));
        const nome = e.currentTarget.getAttribute('data-nome') || '';
        const preco = Number(e.currentTarget.getAttribute('data-preco') || '0');
        if (isNaN(currentReplaceIndex) || currentReplaceIndex < 0) return;
        const r = rows[currentReplaceIndex];
        r.produto_id = id; r.nome = nome; r.preco_venda = preco;
        recomputeStocks(); renderRows(); validate(); computeInsumosAndRender(); closeDrawer();
      });
    });
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
      const lotes = Array.isArray(detalhes?.lotes) ? detalhes.lotes : [];

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
        else partials.push({ order: ord, qty, lastId, lastName: l.ultimo_item || '' });
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
          const cur = usedPartials.get(p.order) || { order: p.order, qty: 0, lastName: p.lastName, lastId: p.lastId };
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
          const ord = Number(i.ordem_insumo||0);
          if (ord > orderMin) {
            const nome = i.nome || '';
            const unidade = i.unidade || '';
            const necessario = Number(i.quantidade||0) * units;
              const key = `${nome}__${unidade}`;
              const cur = r.faltantes.find(x => x.key === key) || { key, nome, un: unidade, necessario: 0, etapa: '' };
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
        .sort((a,b)=> b.order - a.order)
        .map(v => {
          const pending = rotaSorted.filter(i => Number(i.ordem_insumo||0) > v.order)
            .map(i => ({ name: i.nome, pending: Math.ceil(Number(i.quantidade||0) * v.qty), total: Math.ceil(Number(i.quantidade||0) * v.qty), un: i.unidade }));
          const lastItem = rotaSorted.find(i => Number(i.ordem_insumo||0) === v.order);
          return {
            lastItem: { name: lastItem ? lastItem.nome : 'Nenhum', qty: lastItem ? Math.ceil(Number(lastItem.quantidade||0) * v.qty) : 0 },
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


  function buildInsumosGrid(stockByName){
    stockByName = stockByName && stockByName.size ? stockByName : (lastStockByName || new Map());
    const filtroPecaId = state.insumosView.filtroPecaId;
    const mostrarSomenteFaltantes = state.insumosView.mostrarSomenteFaltantes;
    insumosBody.innerHTML = '';
    const list = [];
    rows.forEach(p => {
      if (filtroPecaId && Number(p.produto_id) !== Number(filtroPecaId)) return;
      (p.faltantes || []).forEach(fi => {
        list.push({ produto_id: p.produto_id, nome: fi.nome, un: fi.un, etapa: fi.etapa, necessario: Number(fi.necessario||0) });
      });
    });
    const agg = new Map();
    list.forEach(i => {
      const key = `${i.nome}__${i.un}__${i.etapa}`;
      const cur = agg.get(key) || { nome: i.nome, un: i.un, etapa: i.etapa, necessario: 0 };
      cur.necessario += i.necessario;
      agg.set(key, cur);
    });
    let anyNegative = false;
    for (const v of Array.from(agg.values()).sort((a,b)=> a.nome.localeCompare(b.nome))) {
      const stock = (stockByName && stockByName.get(v.nome)) || { quantidade: 0, unidade: v.un, infinito: false };
      const disponivel = stock.infinito ? Infinity : Number(stock.quantidade||0);
      const saldo = disponivel === Infinity ? Infinity : (disponivel - Number(v.necessario||0));
      const negative = saldo !== Infinity && saldo < 0;
      if (negative) anyNegative = true;
      if (mostrarSomenteFaltantes && !negative) continue;
      const tr = document.createElement('tr');
      if (negative) tr.classList.add('negative-balance');
      tr.classList.add('border-b','border-white/5');
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
        <td class="py-3 px-2 text-center text-white">${Number(v.necessario||0).toLocaleString('pt-BR')}</td>
        <td class="py-3 px-2 text-center">${negative ? '<span class="status-alert font-medium" title="Saldo previsto negativo">' + saldo.toLocaleString('pt-BR') + '</span>' : (saldo === Infinity ? '<span class="badge-success px-2 py-0.5 rounded text-[10px]">infinito</span>' : '<span class="status-ok font-medium">' + saldo.toLocaleString('pt-BR') + '</span>')}</td>
        <td class="py-3 px-2 text-center text-white">${v.etapa || '-'}</td>
        <td class="py-3 px-2 text-center text-white">${flags.join(' ')}</td>`;
      insumosBody.appendChild(tr);
    }
    if (anyNegative && !state.allowNegativeStock) {
      warningText.textContent = 'Há insumos com saldo negativo. Permita negativo ou ajuste peças/insumos.';
      warning.classList.remove('hidden');
      btnConfirmar.disabled = true;
      btnConfirmar.classList.add('opacity-60','cursor-not-allowed');
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
        qtd: Number(tr.children[1]?.textContent?.trim() || '0')
      })).filter(x => x.produto_id && x.qtd);
    }
    rows.forEach(r => { r._origId = r.produto_id; });
    state.allowNegativeStock = !!allowNegativeToggle?.checked;
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
  allowNegativeToggle?.addEventListener('change', () => {
    state.allowNegativeStock = !!allowNegativeToggle.checked;
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
      const nav=variants.length>1?`<div class="flex items-center justify-between text-xs mb-2"><button class="js-pop-prev ${page<=0?'invisible':''}">&lt;</button><span>${page+1}/${variants.length}</span><button class="js-pop-next ${page>=variants.length-1?'invisible':''}">&gt;</button></div>`:'';
      pop.innerHTML=`
        <div class="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl shadow-2xl max-w-sm w-[360px] p-4 text-neutral-100">
          <div class="popover-arrow absolute w-3 h-3 bg-white/10 border-l border-t border-white/20 rotate-45 -translate-y-1/2"></div>
          ${nav}
          <div class="mb-4">
            <h3 class="text-sm font-semibold text-primary mb-2 flex items-center gap-2">Último insumo</h3>
            <div class="flex items-center justify-between text-sm py-1"><span class="text-white font-medium">${v.lastItem?.name||'N/A'}</span><div class="text-right"><div class="text-white">${v.lastItem?.qty||0} un</div></div></div>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-primary mb-2 flex items-center gap-2">Pendentes</h3>
            <div class="max-h-36 overflow-auto pr-1 modal-scroll">
              ${v.pending&&v.pending.length? v.pending.slice(0,6).map(item=>`<div class=\"flex items-center justify-between text-sm py-1.5\"><span class=\"text-gray-300 flex items-center\"><span class=\"text-primary mr-2\">•</span>${item.name}</span><span class=\"text-white\">${item.pending}/${item.total} ${item.un||''}</span></div>`).join('') : '<div class="text-gray-400 text-sm py-2">Nenhum item pendente</div>'}
            </div>
            ${v.pending&&v.pending.length? `<div class=\"mt-3 pt-3 border-t border-white/10\"><span class=\"inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/20 text-primary border border-primary/30\">${v.pending.length} ${v.pending.length===1?'item pendente':'itens pendentes'}</span></div>`:''}
          </div>
        </div>`;
      if(variants.length>1){
        pop.querySelector('.js-pop-prev')?.addEventListener('click',e=>{e.stopPropagation();trigger.dataset.page=String(page-1);buildPopover(trigger);});
        pop.querySelector('.js-pop-next')?.addEventListener('click',e=>{e.stopPropagation();trigger.dataset.page=String(page+1);buildPopover(trigger);});
      }
    }
  function placePopover(trigger){ const pop=document.getElementById('piece-popover'); const r=trigger.getBoundingClientRect(); const { width: pw, height: ph } = pop.getBoundingClientRect(); const vw=window.innerWidth, vh=window.innerHeight; let top,left,arrowClass=''; const above=r.top, below=vh-r.bottom, leftSpace=r.left, rightSpace=vw-r.right; if (rightSpace>=pw+20){ top=Math.max(16, Math.min(r.top + (r.height/2) - ph/2, vh-ph-16)); left=r.right+8; arrowClass='left-[-6px] top-1/2 transform -translate-y-1/2 rotate-[135deg]'; } else if (leftSpace>=pw+20){ top=Math.max(16, Math.min(r.top + (r.height/2) - ph/2, vh-ph-16)); left=r.left-pw-8; arrowClass='right-[-6px] top-1/2 transform -translate-y-1/2 rotate-[315deg]'; } else if (below>=ph){ top=r.bottom+8; left=Math.max(16, Math.min(r.left + (r.width/2) - pw/2, vw-pw-16)); arrowClass='top-[-6px] left-1/2 transform -translate-x-1/2 rotate-[225deg]'; } else if (above>=ph){ top=r.top-ph-8; left=Math.max(16, Math.min(r.left + (r.width/2) - pw/2, vw-pw-16)); arrowClass='bottom-[-6px] left-1/2 transform -translate-x-1/2'; } else { top=Math.max(16, (vh-ph)/2); left=Math.max(16, (vw-pw)/2); arrowClass='hidden'; } pop.style.top=`${top}px`; pop.style.left=`${left}px`; const a=pop.querySelector('.popover-arrow'); if(a){ a.className=`popover-arrow absolute w-3 h-3 bg-white/10 border-l border-t border-white/20 ${arrowClass}`; } }
})();

