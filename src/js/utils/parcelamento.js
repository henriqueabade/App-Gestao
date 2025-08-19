(function(){
  function parseCurrencyToCents(input){
    if(!input) return 0;
    const normalized = input.toString()
      .replace(/\s/g,'')
      .replace(/[A-Za-z\$]/g,'')
      .replace(/\./g,'')
      .replace(',', '.');
    const value = Number(normalized);
    return isNaN(value)?0:Math.round(value*100);
  }
  function formatCentsBRL(cents){
    return (cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }
  function parseIntOnly(input){
    const digits = (input||'').replace(/[^\d]/g,'');
    return digits?parseInt(digits,10):NaN;
  }
  function splitEqual(total, n){
    const base = Math.floor(total/n);
    const r = total % n;
    return Array.from({length:n},(_,i)=>base+(i<r?1:0));
  }
  const instances = new Map();
  function init(containerId, opts){
    const container = document.getElementById(containerId);
    const getTotal = opts.getTotal;
    const state = {total:getTotal(), count:null, mode:null, items:[], sum:0, remaining:0, canRegister:false};
    container.innerHTML = `
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div>
          <label class="block text-sm font-medium mb-2 text-white">Parcelas</label>
          <select id="${containerId}_count" class="input-glass text-white rounded-md px-4 py-3 w-full">
            <option value="">Selecione</option>
            ${[1,2,3,4,5].map(n=>`<option value="${n}">${n}</option>`).join('')}
          </select>
        </div>
        <div class="col-span-2">
          <label class="block text-sm font-medium mb-2 text-white">Modo</label>
          <div class="flex items-center gap-6">
            <label class="flex items-center gap-2"><input type="radio" name="${containerId}_mode" value="equal" disabled><span>Iguais</span></label>
            <label class="flex items-center gap-2"><input type="radio" name="${containerId}_mode" value="custom" disabled><span>Diferentes</span></label>
          </div>
        </div>
      </div>
      <div id="${containerId}_rows" class="space-y-2"></div>
      <div class="mt-4 text-right">
        <span id="${containerId}_summary" class="badge-warning px-3 py-1 rounded-full text-xs font-medium">Faltante: R$ 0,00</span>
      </div>`;
    const elements = {
      count: container.querySelector(`#${containerId}_count`),
      modeRadios: container.querySelectorAll(`input[name='${containerId}_mode']`),
      rows: container.querySelector(`#${containerId}_rows`),
      summary: container.querySelector(`#${containerId}_summary`)
    };
    elements.count.addEventListener('change', ()=>onCountChange(containerId));
    elements.modeRadios.forEach(r=>r.addEventListener('change',()=>onModeChange(containerId)));
    instances.set(containerId,{state,getTotal,elements});
  }
  function onCountChange(id){
    const inst = instances.get(id); if(!inst) return;
    const n = parseInt(inst.elements.count.value) || null;
    const s = inst.state;
    s.count = n; s.mode = null;
    s.items = n?Array.from({length:n},()=>({amount:0,dueInDays:null})) : [];
    inst.elements.rows.innerHTML='';
    inst.elements.modeRadios.forEach(r=>{r.checked=false; r.disabled=!n;});
    recompute(id);
  }
  function onModeChange(id){
    const inst = instances.get(id); if(!inst) return;
    const s = inst.state;
    const mode = Array.from(inst.elements.modeRadios).find(r=>r.checked)?.value || null;
    s.mode = mode;
    if(mode==='equal' && s.count){
      const parts = splitEqual(s.total, s.count);
      s.items = s.items.map((it,i)=>({amount:parts[i], dueInDays:it.dueInDays}));
    }
    renderRows(id);
    recompute(id);
  }
  function renderRows(id){
    const inst = instances.get(id); if(!inst) return;
    const s = inst.state; const rowsDiv = inst.elements.rows;
    rowsDiv.innerHTML='';
    s.items.forEach((it,idx)=>{
      const row=document.createElement('div');
      row.className='grid grid-cols-3 gap-4';
      row.innerHTML=`
        <div class="relative col-span-2">
          <input type="text" id="${id}_amount_${idx}" class="w-full bg-input border border-inputBorder rounded-lg px-4 py-2 text-white text-right ${s.mode==='equal'?'bg-gray-800/40':''}" ${s.mode==='equal'?'readonly':''} value="${formatCentsBRL(it.amount)}">
          <label class="absolute left-4 top-1/2 -translate-y-1/2 text-base text-gray-300 pointer-events-none">Valor</label>
        </div>
        <div class="relative">
          <input type="number" min="0" id="${id}_due_${idx}" class="w-full bg-input border border-inputBorder rounded-lg px-4 py-2 text-white text-right" value="${it.dueInDays??''}">
          <label class="absolute left-4 top-1/2 -translate-y-1/2 text-base text-gray-300 pointer-events-none">Prazo (dias)</label>
        </div>`;
      rowsDiv.appendChild(row);
      row.querySelector(`#${id}_amount_${idx}`).addEventListener('blur',e=>onAmountChange(id,idx,e.target.value));
      row.querySelector(`#${id}_due_${idx}`).addEventListener('blur',e=>onDueChange(id,idx,e.target.value));
    });
  }
  function onAmountChange(id,index,raw){
    const inst=instances.get(id); if(!inst) return;
    if(inst.state.mode!=='custom') return;
    const cents=parseCurrencyToCents(raw);
    inst.state.items[index].amount=cents;
    const input=inst.elements.rows.querySelector(`#${id}_amount_${index}`);
    if(input) input.value=formatCentsBRL(cents);
    recompute(id);
  }
  function onDueChange(id,index,raw){
    const inst=instances.get(id); if(!inst) return;
    const days=parseIntOnly(raw);
    inst.state.items[index].dueInDays=isNaN(days)?null:days;
    recompute(id);
  }
  function recompute(id){
    const inst=instances.get(id); if(!inst) return;
    const s=inst.state; s.total=inst.getTotal();
    s.sum=s.items.reduce((a,it)=>a+(it.amount||0),0);
    s.remaining=s.total-s.sum;
    const allFilled = s.count && s.items.length===s.count && s.items.every(it=>it.amount>0 && it.dueInDays!==null);
    s.canRegister=Boolean(allFilled && s.remaining===0);
    inst.elements.summary.textContent = s.remaining===0 ? 'Total ok' : `Faltante: ${formatCentsBRL(s.remaining)}`;
    inst.elements.summary.className = s.remaining===0 ? 'badge-success px-3 py-1 rounded-full text-xs font-medium' : 'badge-warning px-3 py-1 rounded-full text-xs font-medium';
  }
  function updateTotal(id,total){
    const inst=instances.get(id); if(!inst) return;
    inst.state.total=total;
    if(inst.state.mode==='equal' && inst.state.count){
      const parts=splitEqual(total,inst.state.count);
      inst.state.items=inst.state.items.map((it,i)=>({amount:parts[i], dueInDays:it.dueInDays}));
      renderRows(id);
    }
    recompute(id);
  }
  function getData(id){
    const inst=instances.get(id); if(!inst) return null;
    return JSON.parse(JSON.stringify(inst.state));
  }
  window.Parcelamento={init,updateTotal,getData};
  window.parseCurrencyToCents=parseCurrencyToCents;
  window.formatCentsBRL=formatCentsBRL;
  window.parseIntOnly=parseIntOnly;
})();
