(function(){
  const overlayId = 'converterOrcamento';
  const overlay = document.getElementById('converterOrcamentoOverlay');
  if(!overlay) return;

  const close = () => Modal.close(overlayId);
  const getEl = id => document.getElementById(id);
  const piecesTbody = getEl('convPiecesBody');
  const insumosTbody = getEl('convInsumosBody');
  const confirmBtn = getEl('convConfirmar');
  const decisionNote = getEl('convDecisionNote');
  const warning = getEl('convWarning');
  const warningText = getEl('convWarningText');
  const resumoTotal = getEl('convResumoTotal');
  const resumoEstoque = getEl('convResumoEstoque');
  const resumoProduzir = getEl('convResumoProduzir');
  const piecesCounter = getEl('convPiecesCounter');
  const headerInfo = getEl('convHeaderInfo');

  let state = {
    quote: { numero: '', cliente: '', data: '' },
    pieces: [],
    insumos: [],
    hasNegativeInsumo: false,
    replacingIndex: -1
  };

  function formatDateISOToBR(d){
    if(!d) return '';
    try { const dt = new Date(d); return dt.toLocaleDateString('pt-BR'); } catch { return String(d); }
  }

  function renderHeader(){
    const q = state.quote || {};
    headerInfo.textContent = [q.numero, q.cliente, q.data && formatDateISOToBR(q.data)].filter(Boolean).join(' • ');
  }

  function renderResumo(){
    const total = state.pieces.reduce((a,p)=>a + (p.qtd||0), 0);
    const emEstoque = state.pieces.reduce((a,p)=>a + (p.estoque||0), 0);
    const aProduzir = state.pieces.reduce((a,p)=>a + (p.produzir||0), 0);
    resumoTotal.textContent = `${total} Peças Orçadas`;
    resumoEstoque.textContent = `${emEstoque} Em Estoque`;
    resumoProduzir.textContent = `${aProduzir} A Produzir`;
    piecesCounter.textContent = `${total}/${total} peças`;
  }

  function trPiece(p, idx){
    const ok = (Number(p.estoque||0) + Number(p.produzir||0)) === Number(p.qtd||0) && Number(p.qtd||0) > 0;
    const statusHtml = ok
      ? '<span class="text-[var(--color-green)]">✓</span>'
      : '<span class="text-[var(--color-red)]" title="Ajuste quantidades">⚠️</span>';
    return `
      <tr class="border-b border-white/10" data-index="${idx}">
        <td class="py-3 px-3 text-white">${p.nome}</td>
        <td class="py-3 px-3 text-center text-white">${p.qtd}</td>
        <td class="py-3 px-3 text-center">
          <input type="number" min="0" class="w-20 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-center focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${p.estoque||0}" data-field="estoque">
        </td>
        <td class="py-3 px-3 text-center">
          <input type="number" min="0" class="w-20 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-center focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${p.produzir||0}" data-field="produzir">
        </td>
        <td class="py-3 px-3 text-center">${statusHtml}</td>
        <td class="py-3 px-3 text-center">
          <div class="flex justify-center gap-2">
            <button class="btn-neutral px-2 py-1 rounded text-xs" data-action="replace">Substituir</button>
            <button class="btn-danger px-2 py-1 rounded text-xs" data-action="delete">Excluir</button>
          </div>
        </td>
      </tr>`;
  }

  function renderPieces(){
    piecesTbody.innerHTML = state.pieces.map(trPiece).join('');
    piecesTbody.querySelectorAll('input[data-field]').forEach(inp => {
      inp.addEventListener('input', () => {
        const tr = inp.closest('tr');
        const idx = Number(tr.dataset.index);
        const field = inp.dataset.field;
        const val = Math.max(0, parseInt(inp.value || '0', 10));
        state.pieces[idx][field] = val;
        // Keep consistency: estoque + produzir cannot exceed qtd
        const sum = (state.pieces[idx].estoque||0) + (state.pieces[idx].produzir||0);
        const qtd = state.pieces[idx].qtd||0;
        if (sum > qtd) {
          // reduce the edited field
          state.pieces[idx][field] = Math.max(0, qtd - (field === 'estoque' ? (state.pieces[idx].produzir||0) : (state.pieces[idx].estoque||0)));
          inp.value = state.pieces[idx][field];
        }
        renderResumo();
        validate();
        // Re-render status cell
        const statusCell = tr.children[4];
        const ok = ((state.pieces[idx].estoque||0) + (state.pieces[idx].produzir||0)) === (state.pieces[idx].qtd||0) && (state.pieces[idx].qtd||0) > 0;
        statusCell.innerHTML = ok ? '<span class="text-[var(--color-green)]">✓</span>' : '<span class="text-[var(--color-red)]">⚠️</span>';
      });
    });
    piecesTbody.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const idx = Number(tr.dataset.index);
        const action = btn.dataset.action;
        if (action === 'delete') {
          showDelete(idx);
        } else if (action === 'replace') {
          openReplace(idx);
        }
      });
    });
  }

  function trInsumo(i){
    const saldo = Number(i.disponivel||0) - Number(i.previsto||0);
    const saldoClass = saldo < 0 ? 'text-[var(--color-red)]' : 'text-[var(--color-green)]';
    const rowClass = saldo < 0 ? 'bg-red-500/10 border-red-500/20' : '';
    return `
      <tr class="border-b border-white/10 ${rowClass}">
        <td class="py-3 px-3 text-white">${i.nome}</td>
        <td class="py-3 px-3 text-center text-gray-300">${i.unidade||''}</td>
        <td class="py-3 px-3 text-center text-white">${i.disponivel||0}</td>
        <td class="py-3 px-3 text-center text-white">${i.previsto||0}</td>
        <td class="py-3 px-3 text-center ${saldoClass}">${saldo}</td>
      </tr>`;
  }

  function renderInsumos(){
    insumosTbody.innerHTML = state.insumos.map(trInsumo).join('');
  }

  function showDelete(idx){
    const piece = state.pieces[idx];
    const ov = document.createElement('div');
    ov.className = 'fixed inset-0 z-[2100] bg-black/50 flex items-center justify-center p-4';
    ov.innerHTML = `
      <div class="glass-surface backdrop-blur-xl rounded-2xl border border-white/10 p-6 max-w-md w-full animate-modalFade">
        <h3 class="text-lg font-semibold text-white mb-4">Confirmar exclusão</h3>
        <p class="text-gray-300 mb-6">Tem certeza que deseja excluir "<span class="text-white font-medium">${piece.nome}</span>" do orçamento?<br><br>
        <span class="text-sm text-gray-400">Quantidade: ${piece.qtd} unidades</span></p>
        <div class="flex justify-end gap-3">
          <button class="btn-neutral px-4 py-2 rounded-lg text-white" data-del="no">Cancelar</button>
          <button class="btn-danger px-4 py-2 rounded-lg text-white" data-del="yes">Excluir</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e)=>{
      if(e.target.dataset.del === 'yes'){
        state.pieces.splice(idx,1);
        renderPieces();
        renderResumo();
        validate();
        ov.remove();
      } else if (e.target.dataset.del === 'no' || e.target === ov){
        ov.remove();
      }
    });
  }

  function openReplace(idx){
    state.replacingIndex = idx;
    getEl('convReplacingName').textContent = state.pieces[idx]?.nome || '';
    const drawer = getEl('convReplaceDrawer');
    drawer.classList.remove('hidden');
    setTimeout(()=> drawer.querySelector('.drawer').classList.add('open'), 10);
    // Populate suggestions (mock)
    const list = getEl('convReplaceList');
    const suggestions = (state.pieces[idx]?.sugestoes || [
      { nome: 'Peça Alternativa A', estoque: 12 },
      { nome: 'Peça Alternativa B', estoque: 3 }
    ]);
    list.innerHTML = suggestions.map(s => `
      <div class="bg-surface/40 rounded-lg p-4 border border-white/10 hover:border-primary/30 transition">
        <div class="flex justify-between items-start mb-2">
          <h4 class="font-medium text-white">${s.nome}</h4>
          <span class="badge-success px-2 py-1 rounded text-xs">${s.estoque} em estoque</span>
        </div>
        <button class="btn-primary px-3 py-1 rounded text-sm" data-select="${s.nome}">Selecionar</button>
      </div>`).join('');
    list.querySelectorAll('button[data-select]').forEach(btn => {
      btn.addEventListener('click', () => {
        const newName = btn.dataset.select;
        if(state.replacingIndex >= 0){
          state.pieces[state.replacingIndex].nome = newName;
          state.replacingIndex = -1;
          closeDrawer();
          renderPieces();
          validate();
        }
      });
    });
  }

  function closeDrawer(){
    const drawer = getEl('convReplaceDrawer');
    drawer.querySelector('.drawer').classList.remove('open');
    setTimeout(()=> drawer.classList.add('hidden'), 250);
  }

  function validate(){
    // All pieces must have estoque+produzir == qtd and at least one piece
    const allOk = state.pieces.length > 0 && state.pieces.every(p => (Number(p.estoque||0)+Number(p.produzir||0)) === Number(p.qtd||0) && Number(p.qtd||0)>0);
    // Negative insumo check
    state.hasNegativeInsumo = state.insumos.some(i => (Number(i.disponivel||0) - Number(i.previsto||0)) < 0);
    const needNote = state.hasNegativeInsumo;
    const noteOk = !needNote || (decisionNote.value || '').trim().length > 0;

    const ok = allOk && noteOk;
    if(!ok){
      warning.classList.remove('hidden');
      if(!allOk){
        warningText.textContent = 'Ajuste as quantidades de todas as peças.';
      } else if (!noteOk){
        warningText.textContent = 'Nota de decisão obrigatória para saldo negativo.';
      }
      confirmBtn.disabled = true;
      confirmBtn.classList.add('opacity-50','cursor-not-allowed');
    } else {
      warning.classList.add('hidden');
      confirmBtn.disabled = false;
      confirmBtn.classList.remove('opacity-50','cursor-not-allowed');
    }
  }

  function init(){
    // Load context from opener
    const ctx = window.conversionContext || {};
    state.quote = ctx.quote || state.quote;
    // pieces: expect array of {nome,qtd,estoque,produzir}
    state.pieces = Array.isArray(ctx.pieces) && ctx.pieces.length ? ctx.pieces.map(p=>({
      nome: p.nome,
      qtd: Number(p.qtd)||0,
      estoque: Number(p.estoque)||0,
      produzir: Number(p.produzir)||Math.max(0,(Number(p.qtd)||0) - (Number(p.estoque)||0))
    })) : [];
    // insumos: simple mock if not provided
    state.insumos = Array.isArray(ctx.insumos) ? ctx.insumos : [
      { nome:'Latão 0,8 mm', unidade:'kg', disponivel: 15, previsto: 12 },
      { nome:'Feltro Base', unidade:'m²', disponivel: 4, previsto: 6 }
    ];

    renderHeader();
    renderPieces();
    renderInsumos();
    renderResumo();
    validate();
  }

  // Events
  getEl('fecharConverterOrcamento').addEventListener('click', ()=>{
    if (window._onCancelConversion) window._onCancelConversion();
    close();
  });
  getEl('convCancelar').addEventListener('click', ()=>{
    if (window._onCancelConversion) window._onCancelConversion();
    close();
  });
  confirmBtn.addEventListener('click', ()=>{
    if (confirmBtn.disabled) return;
    // Optionally attach decision note
    if (typeof window._onConfirmConversion === 'function') {
      window._onConfirmConversion({ decisionNote: decisionNote.value || '', pieces: state.pieces, insumos: state.insumos });
    }
    close();
  });
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) { /* block background close */ } });
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ /* keep open unless user cancels */ }});

  // Drawer closers
  getEl('convCloseDrawer').addEventListener('click', closeDrawer);
  getEl('convReplaceDrawer').addEventListener('click', (e)=>{ if(e.target?.dataset?.closeDrawer !== undefined) closeDrawer(); });
  decisionNote.addEventListener('input', validate);

  // Initialize
  init();
})();

