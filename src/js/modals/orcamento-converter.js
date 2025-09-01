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
  const allowNegativeCheckbox = document.getElementById('allowNegativeStock');
  const onlyMissingToggle = document.getElementById('onlyMissingToggle');

  // Drawer de substituiÃ§Ã£o
  const drawer = document.getElementById('converterReplaceDrawer');
  const replacingName = document.getElementById('converterReplacingName');
  const searchProduto = document.getElementById('converterSearchProduto');
  const replaceList = document.getElementById('converterReplaceList');

  let listaProdutos = [];
  let rows = Array.isArray(ctx.items) ? ctx.items.map(p => ({...p})) : [];
  let etapas = [];
  const state = {
    allowNegativeStock: false,
    pieces: [],
    insumosView: { filtroPecaId: null, mostrarSomenteFaltantes: true }
  };
  let currentReplaceIndex = -1;
  let insumosAggregated = [];

  // SubtÃ­tulo com dados do orÃ§amento
  const headerInfo = [
    ctx.numero ? `#${ctx.numero}` : null,
    ctx.cliente ? ctx.cliente : null,
    ctx.data_emissao ? new Date(ctx.data_emissao).toLocaleDateString('pt-BR') : null
  ].filter(Boolean).join(' â€¢ ');
  if (subtitulo) subtitulo.textContent = headerInfo;

  async function carregarProdutos() {
    try {
      listaProdutos = await (window.electronAPI?.listarProdutos?.() ?? []);
    } catch (err) {
      console.error('Erro ao listar produtos', err);
      listaProdutos = [];
    }
  }

  async function carregarEtapas() {
    try {
      etapas = await (window.electronAPI?.listarEtapasProducao?.() ?? []);
    } catch (err) {
      console.error('Erro ao listar etapas de produÃ§Ã£o', err);
      etapas = [];
    }
  }

  function recomputeStocks() {
    // Aplica estoque disponÃ­vel por produto
    let totalOrc = 0, totalEst = 0, totalProd = 0, validas = 0;
    const mapById = new Map(listaProdutos.map(p => [String(p.id), p]));
    rows.forEach(r => {
      const prod = r.produto_id != null ? mapById.get(String(r.produto_id)) : null;
      const disponivel = Number(prod?.quantidade_total ?? 0);
      r.qtd = Number(r.qtd || r.quantidade || 0);
      r.em_estoque = Math.max(0, Math.min(disponivel, r.qtd));
      r.a_produzir = Math.max(0, r.qtd - r.em_estoque);
      r.error = !r.nome || isNaN(r.qtd) || r.qtd <= 0;
      totalOrc += r.qtd;
      totalEst += r.em_estoque;
      totalProd += r.a_produzir;
      if (!r.error) validas++;
    });
    chipTotal.textContent = `${totalOrc} PeÃ§as OrÃ§adas`;
    chipEstoque.textContent = `${totalEst} Em Estoque`;
    chipProduzir.textContent = `${totalProd} A Produzir`;
    pecasTotal.textContent = `${validas}/${rows.length} peÃ§as`;
  }

  function renderRows() {
    pecasBody.innerHTML = '';
    rows.forEach((r, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/10';
      tr.dataset.index = String(idx);
      const classe = r.classe || '';
      let statusHtml = '<span class="text-green-400">âœ“</span>';
      if (r.status === 'erro') statusHtml = '<span class="text-red-400">âš ï¸</span>';
      else if (r.status === 'atencao') statusHtml = '<span class="text-orange-300">!</span>';
      tr.innerHTML = `
        <td class="py-3 px-2 text-white">${r.nome || ''}</td>
        <td class="py-3 px-2 text-center text-white">${r.qtd}</td>
        <td class="py-3 px-2 text-center text-white">${r.em_estoque ?? 0}</td>
        <td class="py-3 px-2 text-center text-white">${r.a_produzir ?? r.qtd}</td>
        <td class="py-3 px-2 text-center text-white">${classe}</td>
        <td class="py-3 px-2 text-center">${statusHtml}</td>
        <td class="py-3 px-2 text-center">
          <div class="flex justify-center gap-2">
            <button class="btn-ghost px-2 py-1 rounded text-xs" data-action="view-insumos" data-peca-id="${r.produto_id}">Visualizar</button>
            <button class="btn-neutral px-2 py-1 rounded text-xs" data-action="replace">Substituir</button>
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
          const ok = confirm(`Excluir "${toDel?.nome}" do orÃ§amento?`);
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
        buildInsumosGrid();
        validate();
      });
    });
  }

  function validate() {
    const noRows = rows.length === 0;
    const anyError = rows.some(r => r.error);
    const canConfirm = !noRows && !anyError; // Fase 1: decisÃ£o de insumos nÃ£o bloqueia ainda
    btnConfirmar.disabled = !canConfirm;
    btnConfirmar.classList.toggle('opacity-60', !canConfirm);
    btnConfirmar.classList.toggle('cursor-not-allowed', !canConfirm);

    if (noRows) {
      warningText.textContent = 'Nenhuma peÃ§a no orÃ§amento.';
      warning.classList.remove('hidden');
    } else if (anyError) {
      warningText.textContent = 'Existem peÃ§as com dados invÃ¡lidos.';
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }
  }

  function openDrawer() {
    drawer.classList.remove('hidden');
  }
  function closeDrawer() {
    drawer.classList.add('hidden');
    currentReplaceIndex = -1;
    searchProduto.value = '';
  }

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
        r.produto_id = id;
        r.nome = nome;
        r.preco_venda = preco;
        // mantÃ©m quantidade
        recomputeStocks();
        renderRows();
        validate();
        computeInsumosAndRender();
        closeDrawer();
      });
    });
  }

  // Eventos
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
    try {
      window.confirmQuoteConversion?.({ deletions, replacements });
      close();
    } catch (err) {
      console.error(err);
      showToast('Erro ao confirmar conversÃ£o', 'error');
    }
  });

  drawer.addEventListener('click', e => {
    if (e.target?.dataset?.close === 'drawer') closeDrawer();
  });
  overlay.addEventListener('click', e => {
    if (e.target?.dataset?.close === 'drawer') closeDrawer();
  });
  searchProduto.addEventListener('input', renderReplaceList);

  async function computeInsumosAndRender(){
    try {
      const byId = new Map(listaProdutos.map(p => [String(p.id), p]));
      const etapaMap = new Map(etapas.map(e => [String(e.nome), Number(e.ordem)]));
      const lastEtapa = etapas.length ? etapas.reduce((a,b)=> (a.ordem>b.ordem? a : b)).nome : null;

      // Estoque de matéria-prima
      let materias = [];
      try {
        materias = await (window.electronAPI?.listarMateriaPrima?.('') ?? []);
      } catch (err) { console.error('Erro ao listar matéria-prima', err); }
      const stockByName = new Map();
      materias.forEach(m => {
        const key = m.nome || '';
        if (!key) return;
        const cur = stockByName.get(key) || { quantidade: 0, unidade: m.unidade || '', infinito: !!m.infinito };
        cur.quantidade += Number(m.quantidade || 0);
        cur.infinito = cur.infinito || !!m.infinito;
        stockByName.set(key, cur);
      });

      // Calcula classe/status/faltantes por peça
      for (const r of rows) {
        const prod = byId.get(String(r.produto_id));
        const codigo = prod?.codigo;
        r.classe = '';
        r.status = '';
        r.faltantes = [];
        if (!codigo) continue;
        let rota = [];
        try { rota = await (window.electronAPI?.listarInsumosProduto?.(codigo) ?? []); } catch (e) { console.error('rota', e); }
        let detalhes = {};
        try { detalhes = await (window.electronAPI?.listarDetalhesProduto?.({ produtoCodigo: codigo, produtoId: r.produto_id }) ?? {}); } catch (e) { console.error('detalhes', e); }
        const lotes = Array.isArray(detalhes?.lotes) ? detalhes.lotes : [];
        const readyQty = lotes.filter(l => lastEtapa && String(l.etapa) === String(lastEtapa)).reduce((a,b)=> a + Number(b.quantidade||0), 0);
        const semiByStage = new Map();
        lotes.forEach(l => {
          const nomeEtapa = String(l.etapa||'').trim();
          if (!nomeEtapa || nomeEtapa === lastEtapa) return;
          semiByStage.set(nomeEtapa, (semiByStage.get(nomeEtapa)||0) + Number(l.quantidade||0));
        });
        const totalSemi = Array.from(semiByStage.values()).reduce((a,b)=>a+b,0);
        const qtd = Number(r.qtd||0);
        if (readyQty >= qtd) r.classe = 'pronta';
        else if (readyQty + totalSemi >= qtd) r.classe = 'semi';
        else r.classe = 'zero';

        // faltantes
        let needed = Math.max(0, qtd - readyQty);
        const semiStages = Array.from(semiByStage.entries())
          .map(([nome, q]) => ({ nome, q, ordem: etapaMap.get(String(nome)) ?? -1 }))
          .sort((a,b)=> (a.ordem - b.ordem));
        const addFaltantes = (etapaMinOrdem, unidades) => {
          if (!unidades) return;
          rota.forEach(i => {
            const proc = String(i.processo||'');
            const ordemProc = etapaMap.get(proc) ?? 0;
            if (etapaMinOrdem === -Infinity || ordemProc > etapaMinOrdem) {
              const nome = i.nome || '';
              const unidade = i.unidade || '';
              const necessario = Number(i.quantidade||0) * Number(unidades);
              const key = `${nome}__${unidade}__${proc}`;
              const cur = r.faltantes.find(x => x.key === key) || { key, nome, un: unidade, necessario: 0, etapa: proc };
              cur.necessario += necessario;
              if (!r.faltantes.find(x => x.key === key)) r.faltantes.push(cur);
            }
          });
        };
        for (const st of semiStages) {
          if (needed <= 0) break;
          const useUnits = Math.min(st.q, needed);
          addFaltantes(st.ordem ?? 0, useUnits);
          needed -= useUnits;
        }
        if (needed > 0) addFaltantes(-Infinity, needed);

        // status por peça
        let pieceHasNegative = false;
        for (const f of r.faltantes) {
          const stock = stockByName.get(f.nome) || { quantidade: 0, infinito: false };
          if (!stock.infinito) {
            const saldo = Number(stock.quantidade||0) - Number(f.necessario||0);
            if (saldo < 0) { pieceHasNegative = true; break; }
          }
        }
        if (r.classe === 'pronta') r.status = 'ok';
        else if (pieceHasNegative && !state.allowNegativeStock) r.status = 'erro';
        else r.status = 'atencao';
      }

      buildInsumosGrid(stockByName);
      validate();
    } catch (err) {
      console.error('Erro ao calcular insumos', err);
    }
  }

  function buildInsumosGrid(stockByName){
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
      if (!mostrarSomenteFaltantes && v.necessario <= 0) continue;
      const tr = document.createElement('tr');
      if (negative) tr.classList.add('negative-balance');
      tr.classList.add('border-b','border-white/5');
      const flags = [];
      if (stock.infinito) flags.push('<span class="badge badge-neutral" title="Estoque infinito">∞</span>');
      if (negative && !stock.infinito) flags.push('<span class="badge-danger px-2 py-0.5 rounded text-[10px]" title="Saldo previsto negativo">negativo</span>');
      tr.innerHTML = `
        <td class="py-3 px-2 text-white">${v.nome}</td>
        <td class="py-3 px-2 text-center text-gray-300">${v.un || stock.unidade || ''}</td>
        <td class="py-3 px-2 text-center text-white">${disponivel === Infinity ? '8' : disponivel.toLocaleString('pt-BR')}</td>
        <td class="py-3 px-2 text-center text-white">${Number(v.necessario||0).toLocaleString('pt-BR')}</td>
        <td class="py-3 px-2 text-center">${negative ? '<span class="status-alert font-medium" title="Saldo previsto negativo">' + saldo.toLocaleString('pt-BR') + '</span>' : '<span class="status-ok font-medium">' + (saldo === Infinity ? '8' : saldo.toLocaleString('pt-BR')) + '</span>'}</td>
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
  // InicializaÃ§Ã£o
  (async function init(){
    await carregarProdutos();
    await carregarEtapas();
    // Se ctx.items nÃ£o veio, tenta colher da UI
    if (!rows.length) {
      const tbody = document.querySelector('#orcamentoItens tbody');
      rows = Array.from(tbody?.children || []).map(tr => ({
        produto_id: Number(tr.dataset.id),
        nome: tr.children[0]?.textContent?.trim() || '',
        qtd: Number(tr.children[1]?.textContent?.trim() || '0')
      })).filter(x => x.produto_id && x.qtd);
    }
    // Guarda o produto original para detectar substituiÃ§Ãµes
    rows.forEach(r => { r._origId = r.produto_id; });
    recomputeStocks();
    renderRows();
    validate();
    await computeInsumosAndRender();
  })();

  // Revalida ao digitar a nota de decisÃ£o
  document.getElementById('converterDecisionNote')?.addEventListener('input', () => {
    computeInsumosAndRender();
  });
})();
