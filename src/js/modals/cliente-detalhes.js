(async function(){
  const overlay = document.getElementById('detalhesClienteOverlay');
  if(!overlay) return;
  const close = () => Modal.close('detalhesCliente');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  const voltar = document.getElementById('voltarDetalhesCliente');
  if(voltar) voltar.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});

  const cliente = window.clienteDetalhes;
  if(!window.geoService){
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/geo-service.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function carregarDonos(){
    try{
      const res = await fetch('http://localhost:3000/api/usuarios/lista');
      const usuarios = await res.json();
      const sel = document.getElementById('empresaDono');
      if(sel){
        sel.innerHTML = '<option value="">Selecione o dono</option>' +
          usuarios.map(u => `<option value="${u.nome}">${u.nome}</option>`).join('');
      }
    }catch(err){
      console.error('Erro ao carregar donos', err);
    }
  }
  if(cliente){
    const titulo = document.getElementById('clienteDetalhesTitulo');
    if(titulo) titulo.textContent = `Detalhes – ${cliente.nome_fantasia || ''}`;
    try {
      const res = await fetch(`http://localhost:3000/api/clientes/${cliente.id}`);
      const data = await res.json();
      if(data && data.cliente){
        await carregarDonos();
        preencherDadosEmpresa(data.cliente);
        await preencherEnderecos(data.cliente);
        renderContatos(data.contatos || []);
        inicializarToggles(data.cliente);
        const notas = document.getElementById('clienteNotas');
        if(notas) notas.value = data.cliente.anotacoes || '';
      }
      await carregarOrdens(cliente.id);
    } catch(err){
      console.error('Erro ao carregar detalhes do cliente', err);
    } finally {
      window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesCliente' }));
    }
  } else {
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesCliente' }));
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

  const warn = e => {
    if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)){
      e.preventDefault();
      e.target.blur();
      showToast('Não é possível editar aqui. Use o botão Editar.', 'error');
    }
  };
  overlay.addEventListener('mousedown', warn, true);
  overlay.addEventListener('focusin', warn);
  overlay.querySelectorAll('input, textarea').forEach(el => el.readOnly = true);
  overlay.querySelectorAll('select').forEach(el => el.disabled = true);
  addCopyButtons();

  const editar = document.getElementById('editarDetalhesCliente');
  if(editar){
    editar.addEventListener('click', () => {
      if(cliente){
        Modal.close('detalhesCliente');
        setTimeout(() => {
          if(window.abrirEditarCliente) window.abrirEditarCliente(cliente);
        }, 0);
      }
    });
  }

  function preencherDadosEmpresa(cli){
    const map = {
      empresaRazaoSocial: 'razao_social',
      empresaNomeFantasia: 'nome_fantasia',
      empresaCnpj: 'cnpj',
      empresaDono: 'dono_cliente',
      empresaInscricaoEstadual: 'inscricao_estadual',
      empresaSite: 'site',
      empresaStatus: 'status_cliente',
      empresaOrigemCaptacao: 'origem_captacao'
    };
    for(const id in map){
      const el = document.getElementById(id);
      if(el) el.value = cli[map[id]] || '';
    }
    const avatar = document.getElementById('empresaAvatar');
    if(avatar){
      const name = cli.nome_fantasia || cli.razao_social || '';
      const initials = name.split(' ').filter(Boolean).map(n=>n[0]).join('').substring(0,2).toUpperCase();
      avatar.textContent = initials;
    }
  }

  async function preencherEnderecos(cli){
    const fill = async (prefix, data) => {
      if(!data) return;
      for(const key of ['rua','numero','complemento','bairro','cidade','cep']){
        const el = document.getElementById(`${prefix}${key.charAt(0).toUpperCase()+key.slice(1)}`);
        if(el) el.value = data[key] || '';
      }
      const paisSel = document.getElementById(prefix + 'Pais');
      const estadoSel = document.getElementById(prefix + 'Estado');
      if(paisSel && estadoSel){
        const countries = await geoService.getCountries();
        paisSel.innerHTML = '<option value="">Selecione</option>' +
          countries.map(c => `<option value="${c.code}">${c.name}</option>`).join('');
        paisSel.value = data.pais || '';
        if(data.pais){
          const states = await geoService.getStatesByCountry(data.pais);
          estadoSel.innerHTML = '<option value="">Selecione</option>' +
            states.map(s => `<option value="${s.code}">${s.name}</option>`).join('');
          estadoSel.value = data.estado || '';
        } else {
          estadoSel.innerHTML = '<option value="">Selecione o país</option>';
        }
      }
    };
    await fill('reg', cli.endereco_registro);
    await fill('cob', cli.endereco_cobranca);
    await fill('ent', cli.endereco_entrega);
  }

  function renderContatos(contatos){
    const tbody = document.getElementById('contatosTabela');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(!contatos.length){
      tbody.innerHTML = '<tr><td colspan="6" class="py-12 text-center text-gray-400">Nenhum contato cadastrado</td></tr>';
      return;
    }
    contatos.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="py-4 px-4 text-white">${c.nome || ''}</td>
        <td class="py-4 px-4 text-white">${c.cargo || ''}</td>
        <td class="py-4 px-4 text-white">${c.email || ''}</td>
        <td class="py-4 px-4 text-white">${c.telefone_celular || ''}</td>
        <td class="py-4 px-4 text-white">${c.telefone_fixo || ''}</td>
        <td class="py-4 px-4 text-center text-white">
          <div class="flex items-center justify-center gap-2">
            <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
            <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)" title="Excluir"></i>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  function inicializarToggles(cli){
    const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    const cobToggle = document.getElementById('cobrancaIgual');
    const cobFields = document.getElementById('cobrancaFields');
    const entToggle = document.getElementById('entregaIgual');
    const entFields = document.getElementById('entregaFields');
    if(cobToggle && cobFields){
      if(same(cli.endereco_cobranca, cli.endereco_registro)) cobToggle.checked = true;
      cobFields.classList.toggle('hidden', cobToggle.checked);
      cobToggle.disabled = true;
    }
    if(entToggle && entFields){
      if(same(cli.endereco_entrega, cli.endereco_registro)) entToggle.checked = true;
      entFields.classList.toggle('hidden', entToggle.checked);
      entToggle.disabled = true;
    }
  }

  function addCopyButtons(){
    const fields = overlay.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea');
    fields.forEach(field => {
      const wrapper = document.createElement('div');
      wrapper.className = 'relative';
      field.parentNode.insertBefore(wrapper, field);
      wrapper.appendChild(field);
      field.classList.add('pr-10');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-white';
      btn.innerHTML = '<i class="fas fa-copy"></i>';
      btn.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        try{
          await navigator.clipboard.writeText(field.value || '');
          showToast('Dado copiado!', 'success');
        }catch{
          showToast('Erro ao copiar', 'error');
        }
      });
      wrapper.appendChild(btn);
    });
  }

  async function carregarOrdens(id){
    try{
      const [pedidosRes, orcamentosRes] = await Promise.all([
        fetch(`http://localhost:3000/api/pedidos?clienteId=${id}`),
        fetch(`http://localhost:3000/api/orcamentos?clienteId=${id}`)
      ]);
      const pedidos = await pedidosRes.json();
      const orcamentos = await orcamentosRes.json();
      const ordens = [
        ...pedidos.map(p => ({
          numero:p.numero,
          tipo:'Pedido',
          inicio:p.data_emissao,
          condicao: p.parcelas > 1 ? `${p.parcelas}x` : 'À vista',
          valor:p.valor_final,
          status:p.situacao
        })),
        ...orcamentos.map(o => ({
          numero:o.numero,
          tipo:'Orçamento',
          inicio:o.data_emissao,
          condicao: o.parcelas > 1 ? `${o.parcelas}x` : 'À vista',
          valor:o.valor_final,
          status:o.situacao
        }))
      ];
      renderOrdens(ordens);
    }catch(err){
      console.error('Erro ao carregar ordens', err);
    }
  }

  function renderOrdens(ordens){
    const tbody = document.getElementById('ordensTabela');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(!ordens.length){
      tbody.innerHTML = '<tr><td colspan="6" class="py-12 text-center text-gray-400">Nenhuma ordem encontrada</td></tr>';
      return;
    }
    const formatCurrency = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
    ordens.forEach(o => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${o.numero}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${o.tipo}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${o.inicio || ''}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${o.condicao || ''}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-right text-white">${formatCurrency(o.valor)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${o.status || ''}</td>`;
      tbody.appendChild(tr);
    });
  }
})();
