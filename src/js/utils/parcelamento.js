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
  /**
   * Em quantas vezes se pode parcelar.
   *
   * O teto é da TELA, não do sistema: o backend grava quantas parcelas vierem,
   * e a soma delas é conferida contra o total do documento — que é a regra que
   * de fato protege o pedido. Aqui é só o que a lista oferece.
   *
   * Um número, e não a lista escrita à mão: a lista de 1 a 5 estava cravada
   * dentro do HTML do seletor, e mudar o teto significava caçá-la no meio de
   * uma string de marcação.
   */
  const MAX_PARCELAS = 10;

  /**
   * PARCELA MÍNIMA (Configuração de cobrança; backend/cobranca/parcelaMinima.js).
   * Nenhuma parcela abaixo dela, a não ser a parcela única ou a 1ª com prazo 0
   * (entrada à vista). Aqui a tela BLOQUEIA: as quantidades que não cabem no
   * total ficam desabilitadas, "Iguais" some quando as partes ficariam abaixo,
   * e "Diferentes" com parcela abaixo trava o registrar. O backend confere de
   * novo. Sem o SQL (ou sem acesso), o mínimo é zero e nada muda.
   */
  let minimoCentavos = 0;
  let leituraDoMinimo = null;
  function carregarMinimo(){
    if(leituraDoMinimo) return leituraDoMinimo;
    leituraDoMinimo = (async () => {
      try{
        const base = await window.apiConfig?.getApiBaseUrl?.();
        if(!base) return 0;
        const resp = await fetch(`${base}/api/cobranca/parcela-minima`);
        if(!resp.ok) return 0;
        const corpo = await resp.json();
        minimoCentavos = Math.round((Number(corpo?.parcela_minima) || 0) * 100);
      }catch(_){
        minimoCentavos = 0;
      }
      return minimoCentavos;
    })();
    return leituraDoMinimo;
  }
  /** Até quantas parcelas o total comporta (iguais: todas no mínimo; diferentes: a 1ª pode ser a entrada). */
  function maximoDeParcelas(total, iguais){
    if(!(minimoCentavos > 0)) return MAX_PARCELAS;
    if(!(total > 0)) return 1;
    const maximo = iguais ? Math.floor(total / minimoCentavos) : Math.floor((total - 1) / minimoCentavos) + 1;
    return Math.max(1, maximo);
  }
  /** A primeira parcela que não cabe, com a frase; ou null. Espelha parcelaMinima.conferir. */
  function conferirMinimo(items){
    const n = items.length;
    if(!(minimoCentavos > 0) || n <= 1) return null;
    for(let i = 0; i < n; i++){
      if(i === 0 && items[0].dueInDays === 0) continue;
      if((items[i].amount || 0) < minimoCentavos){
        const total = items.reduce((a, it) => a + (it.amount || 0), 0);
        return `A ${i + 1}ª parcela (${formatCentsBRL(items[i].amount || 0)}) fica abaixo da parcela mínima de ${formatCentsBRL(minimoCentavos)}.`
          + (i === 0 ? ' Só a primeira com prazo 0 (à vista) pode ser menor.' : '')
          + (total < minimoCentavos ? ' O total fica abaixo do mínimo: use uma parcela só.' : '');
      }
    }
    return null;
  }

  /**
   * Garante que o número exista na lista antes de selecioná-lo.
   *
   * `select.value = 12` num seletor que só vai até 10 não erra: simplesmente
   * não faz nada, e o campo fica em branco. Sem isto, um pedido de 12 parcelas
   * abria o bloco de parcelamento vazio e ninguém sabia por quê.
   */
  function garantirOpcao(select, valor){
    const n = parseInt(valor,10);
    if(!Number.isFinite(n) || n <= 0) return;
    if(Array.from(select.options).some(o=>o.value===String(n))) return;
    const op = document.createElement('option');
    op.value = String(n);
    op.textContent = `${n} (do documento)`;
    select.appendChild(op);
  }

  /**
   * Opções do "Pagamento do pedido" (decisões do dono, 24/09/2026). O
   * orçamento não as passa e continua exatamente como era.
   *   - `permitirDiferenca`: a soma pode sair do total — para mais (Adicional)
   *     ou para menos (Desconto); quem chama pede a justificativa. O resumo diz
   *     qual é a diferença em vez de "Faltante".
   *   - `travas`: por posição (índice da parcela), `{ atual, permitido, texto }`
   *     em centavos — a parcela com boleto, pagamento ou ordem só fica no valor
   *     atual ou vai exatamente para o `permitido`. O valor e o prazo dela ficam
   *     só de leitura, com o aviso e o botão "Usar R$ X"; "Iguais" some (não dá
   *     para repartir o total sem mexer nela) e a quantidade não desce abaixo
   *     dela.
   */
  function travaDe(inst, idx){ return (inst.travas || [])[idx] || null; }
  function minimoDeParcelas(inst){
    const t = inst.travas || [];
    for(let i = t.length - 1; i >= 0; i--) if(t[i]) return i + 1;
    return 0;
  }

  const instances = new Map();
  function init(containerId, opts){
    const container = document.getElementById(containerId);
    const getTotal = opts.getTotal;
    const state = {total:getTotal(), count:null, mode:null, items:[], sum:0, remaining:0, canRegister:false, diferenca:0};
    container.innerHTML = `
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div>
          <label class="ctl-rotulo text-white">Parcelas</label>
          <select id="${containerId}_count" class="ctl-campo input-glass text-white w-full">
            <option value="">Selecione</option>
            ${Array.from({length:MAX_PARCELAS},(_,i)=>i+1).map(n=>`<option value="${n}">${n}</option>`).join('')}
          </select>
        </div>
        <div class="col-span-2">
          <label class="ctl-rotulo text-white">Modo</label>
          <div class="flex items-center gap-6">
            <label class="flex items-center gap-2"><input type="radio" name="${containerId}_mode" value="equal" disabled><span>Iguais</span></label>
            <label class="flex items-center gap-2"><input type="radio" name="${containerId}_mode" value="custom" disabled><span>Diferentes</span></label>
          </div>
        </div>
      </div>
      <div id="${containerId}_rows" class="space-y-2"></div>
      <p id="${containerId}_minimo" class="hidden mt-3 text-xs" role="status"></p>
      <div class="mt-4 text-right">
        <span id="${containerId}_summary" class="badge-danger px-3 py-1 rounded-full text-xs font-medium">Faltante: R$ 0,00</span>
      </div>`;
    const elements = {
      count: container.querySelector(`#${containerId}_count`),
      modeRadios: container.querySelectorAll(`input[name='${containerId}_mode']`),
      rows: container.querySelector(`#${containerId}_rows`),
      summary: container.querySelector(`#${containerId}_summary`),
      minimo: container.querySelector(`#${containerId}_minimo`)
    };
    elements.count.addEventListener('change', ()=>onCountChange(containerId));
    elements.modeRadios.forEach(r=>r.addEventListener('change',()=>onModeChange(containerId)));
    instances.set(containerId,{state,getTotal,elements,permitirDiferenca:Boolean(opts.permitirDiferenca),travas:Array.isArray(opts.travas)?opts.travas:[]});

    if(opts.prefill){
      const pre = opts.prefill;
      if(pre.count){
        // Um documento pode pedir MAIS parcelas do que a lista oferece. O
        // backend aceita — o que ele confere é a soma bater com o total —, e
        // recusar aqui deixaria o bloco vazio sem dizer por quê. A opção
        // entra, marcada como veio do documento.
        garantirOpcao(elements.count, pre.count);
        elements.count.value = pre.count;
        onCountChange(containerId);
      }
      if(pre.mode){
        // Com parcela travada, repartir por igual mexeria nela: fica "Diferentes".
        const inst0=instances.get(containerId);
        const modo = inst0 && minimoDeParcelas(inst0) ? 'custom' : pre.mode;
        Array.from(elements.modeRadios).forEach(r=>{r.disabled=false; if(r.value===modo) r.checked=true;});
        if(inst0) inst0.state.mode=modo;
      }
      if(pre.items){
        const inst=instances.get(containerId); if(inst) inst.state.items = pre.items.map(it=>({amount:it.amount,dueInDays:it.dueInDays}));
        renderRows(containerId);
      }
      recompute(containerId);
    }
    // O mínimo chega depois (uma leitura por tela): aí as opções e a conferência se refazem.
    carregarMinimo().then(() => { if(instances.get(containerId)?.elements === elements) recompute(containerId); });
  }
  function onCountChange(id){
    const inst = instances.get(id); if(!inst) return;
    const n = parseInt(inst.elements.count.value) || null;
    const s = inst.state;
    const minimo = minimoDeParcelas(inst);
    if(minimo){
      // Com parcela travada: a quantidade não desce abaixo dela, e o que já
      // estava nas linhas continua (inclusive a travada).
      if(!n || n < minimo){ inst.elements.count.value = String(s.count || minimo); return; }
      s.count = n; s.mode = 'custom';
      s.items = Array.from({length:n},(_,i)=>s.items[i] ? {...s.items[i]} : {amount:0,dueInDays:null});
      inst.elements.modeRadios.forEach(r=>{r.checked = r.value==='custom'; r.disabled = r.value==='equal';});
      renderRows(id);
      recompute(id);
      return;
    }
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
      const trava = travaDe(inst, idx);
      const soLeitura = s.mode==='equal' || Boolean(trava);
      const row=document.createElement('div');
      row.className='grid grid-cols-3 gap-4';
      row.innerHTML=`
        <div class="relative col-span-2">
          <input type="text" id="${id}_amount_${idx}" class="w-full ctl-campo bg-input border border-inputBorder text-white text-right ${soLeitura?'bg-gray-800/40':''}" ${soLeitura?'readonly':''} value="${formatCentsBRL(it.amount)}">
          <label class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-300 pointer-events-none">Valor</label>
        </div>
        <div class="relative">
          <input type="number" min="0" id="${id}_due_${idx}" class="w-full ctl-campo bg-input border border-inputBorder text-white text-right ${trava?'bg-gray-800/40':''}" ${trava?'readonly':''} value="${it.dueInDays??''}">
          <label class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-300 pointer-events-none">Prazo (dias)</label>
        </div>`;
      rowsDiv.appendChild(row);
      if(trava){
        // O aviso da trava e, se o boleto/pagamento vale outro valor, o botão para usá-lo.
        const aviso=document.createElement('div');
        aviso.className='col-span-3 flex flex-wrap items-center gap-2 text-xs';
        aviso.style.color='var(--color-primary-light)';
        const texto=document.createElement('span');
        texto.textContent=trava.texto||'Parcela travada.';
        aviso.appendChild(texto);
        if(trava.permitido!==null && trava.permitido!==undefined && trava.permitido!==it.amount){
          const usar=document.createElement('button');
          usar.type='button';
          usar.className='btn-neutral ctl-botao ctl-botao--pequeno text-white';
          usar.textContent=`Usar ${formatCentsBRL(trava.permitido)}`;
          usar.addEventListener('click',()=>{ s.items[idx].amount=trava.permitido; renderRows(id); recompute(id); });
          aviso.appendChild(usar);
        }
        row.appendChild(aviso);
      }
      const campoValor=row.querySelector(`#${id}_amount_${idx}`);
      const campoPrazo=row.querySelector(`#${id}_due_${idx}`);
      campoValor.addEventListener('blur',e=>onAmountChange(id,idx,e.target.value));
      campoPrazo.addEventListener('blur',e=>onDueChange(id,idx,e.target.value));

      // O `R$ 0,00` e o formato, nao uma resposta. Sem isto, digitar sem apagar
      // antes produzia `fgdgR$ 0,00` — e apagar tinha de ser feito uma vez por
      // parcela. Ligado DEPOIS do `blur` acima de proposito: aquele ja repoe o
      // formato (`parseCurrencyToCents('')` da zero), entao nao ha o que repor.
      window.CampoZerado?.ligar(campoValor);
      window.CampoZerado?.ligar(campoPrazo);
    });
  }
  function onAmountChange(id,index,raw){
    const inst=instances.get(id); if(!inst) return;
    if(inst.state.mode!=='custom') return;
    if(travaDe(inst, index)) return;
    const cents=parseCurrencyToCents(raw);
    inst.state.items[index].amount=cents;
    const input=inst.elements.rows.querySelector(`#${id}_amount_${index}`);
    if(input) input.value=formatCentsBRL(cents);
    recompute(id);
  }
  function onDueChange(id,index,raw){
    const inst=instances.get(id); if(!inst) return;
    if(travaDe(inst, index)) return;
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
    // Parcela mínima: as quantidades que não cabem ficam desabilitadas; "Iguais" também.
    const maxDiferentes = maximoDeParcelas(s.total, false);
    const maxIguais = maximoDeParcelas(s.total, true);
    Array.from(inst.elements.count.options).forEach(o => {
      const n = parseInt(o.value, 10);
      if(!Number.isFinite(n)) return;
      o.disabled = n > maxDiferentes && String(n) !== inst.elements.count.value;
    });
    Array.from(inst.elements.modeRadios).forEach(r => {
      if(r.value === 'equal') r.disabled = !s.count || (s.count > 1 && s.count > maxIguais) || minimoDeParcelas(inst) > 0;
    });
    s.minimo = minimoCentavos;
    s.motivo = allFilled ? conferirMinimo(s.items) : null;
    if(!s.motivo && s.count > 1 && s.count > maxDiferentes){
      s.motivo = `O total não comporta ${s.count} parcelas de ao menos ${formatCentsBRL(minimoCentavos)} (a parcela mínima): escolha até ${maxDiferentes}.`;
    }
    const aviso = inst.elements.minimo;
    if(aviso){
      const dica = minimoCentavos > 0
        ? `Parcela mínima: ${formatCentsBRL(minimoCentavos)} — só a parcela única ou a 1ª com prazo 0 (à vista) pode ser menor.`
        : '';
      aviso.textContent = s.motivo || dica;
      aviso.classList.toggle('hidden', !(s.motivo || dica));
      aviso.style.color = s.motivo ? 'var(--color-red)' : '';
      aviso.classList.toggle('text-gray-400', !s.motivo);
    }
    // A diferença para o total: + é Adicional, − é Desconto (só com `permitirDiferenca`).
    s.diferenca = -s.remaining;
    s.canRegister=Boolean(allFilled && (s.remaining===0 || inst.permitirDiferenca) && !s.motivo);
    if(s.remaining===0){
      inst.elements.summary.textContent = 'Total ok';
      inst.elements.summary.className = 'badge-success px-3 py-1 rounded-full text-xs font-medium';
    } else if(inst.permitirDiferenca && allFilled){
      inst.elements.summary.textContent = `${s.diferenca>0?'Adicional':'Desconto'}: ${formatCentsBRL(Math.abs(s.diferenca))}`;
      inst.elements.summary.className = 'badge-warning px-3 py-1 rounded-full text-xs font-medium';
    } else {
      inst.elements.summary.textContent = `Faltante: ${formatCentsBRL(s.remaining)}`;
      inst.elements.summary.className = 'badge-danger px-3 py-1 rounded-full text-xs font-medium';
    }
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
  window.Parcelamento={init,updateTotal,getData,MAX_PARCELAS,carregarMinimo,maximoDeParcelas,conferirMinimo,
    definirMinimo(centavos){ minimoCentavos = Math.max(0, Math.round(Number(centavos) || 0)); leituraDoMinimo = Promise.resolve(minimoCentavos); }};
  window.parseCurrencyToCents=parseCurrencyToCents;
  window.formatCentsBRL=formatCentsBRL;
  window.parseIntOnly=parseIntOnly;
})();
