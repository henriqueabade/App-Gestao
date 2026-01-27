(async function(){
  const overlay = document.getElementById('novoClienteOverlay');
  if(!overlay) return;
  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const close = () => Modal.close('novoCliente');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  document.getElementById('voltarNovoCliente')?.addEventListener('click', close);
  document.getElementById('cancelarNovoCliente')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});

  // signal spinner loaded immediately
  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'novoCliente' }));

  const dialogState = {
    isOpen: false,
    dialogProps: null
  };

  const openStandardDialog = window.openStandardDialog || function openStandardDialog({
    title,
    message,
    variant = 'info',
    confirmText,
    cancelText
  }) {
    return new Promise((resolve) => {
      if (dialogState.isOpen && dialogState.dialogProps?.overlay?.isConnected) {
        dialogState.dialogProps.overlay.remove();
      }

      dialogState.isOpen = true;
      dialogState.dialogProps = null;

      const previousActive = document.activeElement;
      const isConfirm = variant === 'confirm';
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[3000]';

      const heading = title || (isConfirm ? 'Tem certeza?' : 'Atenção');
      const confirmLabel = confirmText || (isConfirm ? 'Confirmar' : 'OK');
      const cancelLabel = cancelText || 'Cancelar';
      const borderClass = isConfirm ? 'border-white/10 ring-white/5' : 'border-yellow-500/20 ring-yellow-500/30';
      const titleClass = isConfirm ? 'text-white' : 'text-yellow-400';

      overlay.innerHTML = `
        <div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl ${borderClass} ring-1 shadow-2xl/40 animate-modalFade" role="dialog" aria-modal="true" tabindex="-1" data-dialog>
          <div class="p-6 text-center">
            <h3 class="text-lg font-semibold mb-4 ${titleClass}">${heading}</h3>
            <p class="text-sm text-gray-300">${message || ''}</p>
            <div class="flex justify-center ${isConfirm ? 'gap-6' : ''} mt-6">
              ${isConfirm ? `<button type="button" class="btn-danger px-6 py-2 rounded-lg text-white font-medium active:scale-95" data-action="cancel">${cancelLabel}</button>` : ''}
              <button type="button" class="${isConfirm ? 'btn-success' : 'btn-warning'} px-6 py-2 rounded-lg text-white font-medium active:scale-95" data-action="confirm">${confirmLabel}</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const dialogEl = overlay.querySelector('[data-dialog]');
      const confirmBtn = overlay.querySelector('[data-action="confirm"]');
      const cancelBtn = overlay.querySelector('[data-action="cancel"]');

      const cleanup = (result) => {
        dialogState.isOpen = false;
        dialogState.dialogProps = null;
        overlay.remove();
        document.removeEventListener('keydown', handleKey);
        if (previousActive && typeof previousActive.focus === 'function') {
          previousActive.focus();
        }
        resolve(result);
      };

      const handleKey = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup(false);
        }
      };

      dialogState.dialogProps = { overlay, dialogEl, confirmBtn, cancelBtn };

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) cleanup(false);
      });

      confirmBtn?.addEventListener('click', () => cleanup(true), { once: true });
      cancelBtn?.addEventListener('click', () => cleanup(false), { once: true });
      document.addEventListener('keydown', handleKey);

      setTimeout(() => {
        const focusTarget = confirmBtn || cancelBtn || dialogEl;
        focusTarget?.focus();
      }, 0);
    });
  };

  window.openStandardDialog = openStandardDialog;

  const cnpjInput = document.getElementById('empresaCnpj');
  if (cnpjInput) {
    cnpjInput.addEventListener('input', () => {
      cnpjInput.value = cnpjInput.value.replace(/\D/g, '').slice(0, 14);
    });
  }
  const ieInput = document.getElementById('empresaInscricaoEstadual');
  if (ieInput) {
    ieInput.addEventListener('input', () => {
      ieInput.value = ieInput.value.replace(/\D/g, '').slice(0, 15);
    });
  }

  const tablist = overlay.querySelector('[role="tablist"]');
  const tabs = Array.from(overlay.querySelectorAll('[role="tab"]'));
  const panels = Array.from(overlay.querySelectorAll('[role="tabpanel"]'));

  function activateTab(targetTab, { setFocus = true } = {}) {
    tabs.forEach(tab => {
      tab.setAttribute('aria-selected', 'false');
      tab.setAttribute('tabindex', '-1');
      tab.classList.remove('tab-active');
      tab.classList.add('text-gray-400', 'border-transparent');
      tab.classList.remove('hover:text-white');
    });
    panels.forEach(panel => panel.classList.add('hidden'));
    targetTab.setAttribute('aria-selected', 'true');
    targetTab.setAttribute('tabindex', '0');
    targetTab.classList.add('tab-active');
    targetTab.classList.remove('text-gray-400', 'border-transparent');
    targetTab.classList.add('hover:text-white');
    const targetPanel = overlay.querySelector('#'+targetTab.getAttribute('aria-controls'));
    if(targetPanel) targetPanel.classList.remove('hidden');
    if(setFocus) targetTab.focus();
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', e => {
      e.preventDefault();
      activateTab(tab);
    });
  });

  if(tablist){
    tablist.addEventListener('keydown', e => {
      const currentIndex = tabs.findIndex(t => t === document.activeElement);
      let targetIndex;
      switch(e.key){
        case 'ArrowRight':
          e.preventDefault();
          targetIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
          activateTab(tabs[targetIndex]);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          targetIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
          activateTab(tabs[targetIndex]);
          break;
        case 'Home':
          e.preventDefault();
          activateTab(tabs[0]);
          break;
        case 'End':
          e.preventDefault();
          activateTab(tabs[tabs.length - 1]);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if(currentIndex >= 0) activateTab(tabs[currentIndex]);
          break;
      }
    });
  }

  activateTab(tabs[0], { setFocus: false });

  function initToggles(){
    const cobToggle = document.getElementById('cobrancaIgual');
    const cobFields = document.getElementById('cobrancaFields');
    if(cobToggle && cobFields){
      const update = () => cobFields.classList.toggle('hidden', cobToggle.checked);
      cobToggle.addEventListener('change', update);
      update();
    }
    const entToggle = document.getElementById('entregaIgual');
    const entFields = document.getElementById('entregaFields');
    if(entToggle && entFields){
      const update = () => entFields.classList.toggle('hidden', entToggle.checked);
      entToggle.addEventListener('change', update);
      update();
    }
  }
  initToggles();

  async function carregarUsuarios(){
    try {
      const res = await fetchApi('/api/usuarios/lista');
      const usuarios = await res.json();
      const sel = document.getElementById('empresaDono');
      if(sel){
        sel.innerHTML = '<option value="">Selecione o dono</option>' +
          usuarios.map(u => `<option value="${u.nome}">${u.nome}</option>`).join('');
      }
    } catch(err){
      console.error('Erro ao carregar usuários', err);
    }
  }
  carregarUsuarios();

  async function ensureGeo(){
    if(window.geoService) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/geo-service.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  await ensureGeo();

  async function setupEndereco(prefix){
    const paisSel = document.getElementById(prefix + 'Pais');
    const estadoSel = document.getElementById(prefix + 'Estado');
    if(!paisSel || !estadoSel) return;
    const countries = await geoService.getCountries();
    paisSel.innerHTML = '<option value="">Selecione</option>' +
      countries.map(c => `<option value="${c.name}" data-code="${c.code}">${c.name}</option>`).join('');
    estadoSel.disabled = true;
    estadoSel.innerHTML = '<option value="">Selecione o país</option>';
    paisSel.addEventListener('change', async () => {
      const code = paisSel.selectedOptions[0]?.dataset.code;
      if(!code){
        estadoSel.disabled = true;
        estadoSel.innerHTML = '<option value="">Selecione o país</option>';
        return;
      }
      const states = await geoService.getStatesByCountry(code);
      estadoSel.disabled = false;
      estadoSel.innerHTML = '<option value="">Selecione</option>' +
        states.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    });
    estadoSel.addEventListener('mousedown', e => {
      if(!paisSel.value){
        e.preventDefault();
        openStandardDialog({ message: 'Por favor, selecione o país primeiro' });
      }
    });
  }
  ['reg','cob','ent'].forEach(setupEndereco);

  // contatos management
  const contatos = [];
  function renderContatos(){
    const tbody = document.getElementById('contatosTabela');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(!contatos.length){
      tbody.innerHTML = '<tr><td colspan="6" class="py-12 text-left text-gray-400">Nenhum contato cadastrado</td></tr>';
      return;
    }
    contatos.forEach((c, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="py-4 px-4 text-white">${c.nome || ''}</td>
        <td class="py-4 px-4 text-white">${c.cargo || ''}</td>
        <td class="py-4 px-4 text-white">${c.email || ''}</td>
        <td class="py-4 px-4 text-white">${c.telefone_celular || ''}</td>
        <td class="py-4 px-4 text-white">${c.telefone_fixo || ''}</td>
        <td class="py-4 px-4 text-left text-white">
          <div class="flex items-center justify-start gap-2">
            <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)"></i>
          </div>
        </td>`;
      tr.querySelector('.fa-trash').addEventListener('click', async () => {
        const confirmar = await openStandardDialog({
          title: 'Excluir contato?',
          message: 'Deseja excluir este contato?',
          variant: 'confirm'
        });
        if (!confirmar) return;
        contatos.splice(idx,1);
        renderContatos();
      });
      tbody.appendChild(tr);
    });
  }
  renderContatos();

  document.getElementById('addContatoBtn')?.addEventListener('click', () => {
    Modal.open('modals/laminacao-clientes/contato.html', '../js/modals/laminacao-clientes/cliente-contato.js', 'novoContatoCliente', true);
  });

  window.addEventListener('clienteContatoAdicionado', e => {
    contatos.push(e.detail);
    renderContatos();
  });

  function coletarDados(){
    const getVal = id => (document.getElementById(id)?.value || '').trim();
    const missing = [];

    const requiredEmpresa = {
      empresaRazaoSocial: 'Razão Social',
      empresaNomeFantasia: 'Nome Fantasia',
      empresaCnpj: 'CNPJ',
      empresaDono: 'Dono',
      empresaStatus: 'Status',
      empresaInscricaoEstadual: 'Inscrição Estadual'
    };
    for(const id in requiredEmpresa){
      if(!getVal(id)) missing.push({tab:'tab-dados-empresa', field:id, name: requiredEmpresa[id]});
    }

    const endereco = prefix => ({
      rua: getVal(prefix+'Rua'),
      numero: getVal(prefix+'Numero'),
      complemento: getVal(prefix+'Complemento'),
      bairro: getVal(prefix+'Bairro'),
      cidade: getVal(prefix+'Cidade'),
      pais: getVal(prefix+'Pais'),
      estado: getVal(prefix+'Estado'),
      cep: getVal(prefix+'Cep')
    });

    const checkEndereco = (prefix, label, useRegIfEqual) => {
      if(useRegIfEqual && document.getElementById(useRegIfEqual)?.checked){
        return endereco('reg');
      }
      const addr = endereco(prefix);
      for(const k in addr){
        if(!addr[k]) missing.push({tab:'tab-enderecos', field: prefix + k.charAt(0).toUpperCase()+k.slice(1), name: label+' '+k});
      }
      return addr;
    };

    const reg = checkEndereco('reg','Registro');
    const cob = checkEndereco('cob','Cobrança','cobrancaIgual');
    const ent = checkEndereco('ent','Entrega','entregaIgual');

    if(!contatos.length) missing.push({tab:'tab-contatos', field:null, name:'Contato'});

    if(missing.length){
      const first = missing[0];
      const tabEl = document.getElementById(first.tab);
      if(tabEl) activateTab(tabEl);
      const el = first.field ? document.getElementById(first.field) : null;
      if(el){
        el.classList.add('border-red-500');
        el.scrollIntoView({behavior:'smooth', block:'center'});
        el.focus();
        setTimeout(()=>el.classList.remove('border-red-500'),2000);
      }
      showToast('Preencha '+ first.name, 'error');
      return null;
    }

    return {
      razao_social: getVal('empresaRazaoSocial'),
      nome_fantasia: getVal('empresaNomeFantasia'),
      cnpj: getVal('empresaCnpj'),
      inscricao_estadual: getVal('empresaInscricaoEstadual'),
      site: getVal('empresaSite') || 'Não Informado',
      status_cliente: getVal('empresaStatus'),
      dono_cliente: getVal('empresaDono'),
      origem_captacao: getVal('empresaOrigemCaptacao'),
      endereco_registro: reg,
      endereco_cobranca: cob,
      endereco_entrega: ent,
      contatos,
      anotacoes: document.getElementById('clienteNotas')?.value || ''
    };
  }

  document.getElementById('registrarCliente')?.addEventListener('click', async () => {
    const dados = coletarDados();
    if(!dados) return;
    try{
      const res = await fetchApi('/api/clientes_laminacao', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(dados)
      });
      if (res.status === 409) {
        showToast('Cliente já registrado', 'error');
        return;
      }
      if(!res.ok) throw new Error('Erro ao registrar');
      showToast('Cliente registrado com sucesso');
      window.dispatchEvent(new Event('clienteAdicionado'));
      close();
    }catch(err){
      console.error('Erro ao registrar cliente', err);
      showToast('Erro ao registrar cliente', 'error');
    }
  });
})();
