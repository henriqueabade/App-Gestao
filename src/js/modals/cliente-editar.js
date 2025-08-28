(async function(){
  const overlay = document.getElementById('editarClienteOverlay');
  if(!overlay) return;
  const close = () => Modal.close('editarCliente');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  const voltar = document.getElementById('voltarEditarCliente');
  if(voltar) voltar.addEventListener('click', close);
  document.getElementById('cancelarEditarCliente')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});

  const cliente = window.clienteEditar;
  if(!window.geoService){
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/geo-service.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  let contatos = [];
  const contatosExcluidos = [];
  if(cliente){
    const titulo = document.getElementById('clienteEditarTitulo');
    if(titulo) titulo.textContent = `Editar – ${cliente.nome_fantasia || ''}`;
    try {
      const res = await fetch(`http://localhost:3000/api/clientes/${cliente.id}`);
      const data = await res.json();
      if(data && data.cliente){
        await preencherDadosEmpresa(data.cliente);
        await preencherEnderecos(data.cliente);
        contatos = (data.contatos || []).map(c => ({ ...c, status: 'unchanged' }));
        renderContatos();
        inicializarToggles(data.cliente);
        const notas = document.getElementById('clienteNotas');
        if(notas) notas.value = data.cliente.anotacoes || '';
      }
      await carregarOrdens(cliente.id);
    } catch(err){
      console.error('Erro ao carregar detalhes do cliente', err);
    } finally {
      window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'editarCliente' }));
    }
  } else {
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'editarCliente' }));
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

  async function preencherDadosEmpresa(cli){
    const map = {
      empresaRazaoSocial: 'razao_social',
      empresaNomeFantasia: 'nome_fantasia',
      empresaCnpj: 'cnpj',
      empresaInscricaoEstadual: 'inscricao_estadual',
      empresaSite: 'site'
    };
    for(const id in map){
      const el = document.getElementById(id);
      if(el) el.value = cli[map[id]] || '';
    }
    const donoSel = document.getElementById('empresaDono');
    if(donoSel){
      try{
        const res = await fetch('http://localhost:3000/api/usuarios/lista');
        const usuarios = await res.json();
        donoSel.innerHTML = '<option value="">Selecione o dono</option>' +
          usuarios.map(u => `<option value="${u.nome}">${u.nome}</option>`).join('');
        donoSel.value = cli.dono_cliente || '';
      }catch(err){
        console.error('Erro ao carregar usuários', err);
      }
    }
    const statusSel = document.getElementById('empresaStatus');
    if(statusSel) statusSel.value = cli.status_cliente || '';
    const origemInput = document.getElementById('empresaOrigemCaptacao');
    if(origemInput) origemInput.value = cli.origem_captacao || '';
    const avatar = document.getElementById('empresaAvatar');
    if(avatar){
      const name = cli.nome_fantasia || cli.razao_social || '';
      const initials = name.split(' ').filter(Boolean).map(n=>n[0]).join('').substring(0,2).toUpperCase();
      avatar.textContent = initials;
    }
  }
  async function setupEndereco(prefix, data){
    const paisSel = document.getElementById(prefix + 'Pais');
    const estadoSel = document.getElementById(prefix + 'Estado');
    if(paisSel && estadoSel){
      const countries = await geoService.getCountries();
      paisSel.innerHTML = '<option value="">Selecione</option>' +
        countries.map(c => `<option value="${c.name}" data-code="${c.code}">${c.name}</option>`).join('');
      if(data?.pais){
        paisSel.value = data.pais;
        const code = countries.find(c => c.name === data.pais)?.code;
        if(code){
          const states = await geoService.getStatesByCountry(code);
          estadoSel.innerHTML = '<option value="">Selecione</option>' +
            states.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
          estadoSel.disabled = false;
          estadoSel.value = data.estado || '';
        } else {
          estadoSel.disabled = true;
          estadoSel.innerHTML = '<option value="">Selecione o país</option>';
        }
      } else {
        estadoSel.disabled = true;
        estadoSel.innerHTML = '<option value="">Selecione o país</option>';
      }
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
          alert('Por favor, selecione o país primeiro');
        }
      });
    }
    if(data){
      for(const key of ['rua','numero','complemento','bairro','cidade','cep']){
        const el = document.getElementById(`${prefix}${key.charAt(0).toUpperCase()+key.slice(1)}`);
        if(el) el.value = data[key] || '';
      }
    }
  }

  async function preencherEnderecos(cli){
    await setupEndereco('reg', cli.endereco_registro);
    await setupEndereco('cob', cli.endereco_cobranca);
    await setupEndereco('ent', cli.endereco_entrega);
  }

  function renderContatos(){
    const tbody = document.getElementById('contatosTabela');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(!contatos.length){
      tbody.innerHTML = '<tr><td colspan="6" class="py-12 text-center text-gray-400">Nenhum contato cadastrado</td></tr>';
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
        <td class="py-4 px-4 text-center text-white">
          <div class="flex items-center justify-center gap-2">
            <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 edit-contato" style="color: var(--color-primary)" title="Editar"></i>
            <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white delete-contato" style="color: var(--color-red)" title="Excluir"></i>
          </div>
        </td>`;
      tr.querySelector('.edit-contato').addEventListener('click', () => startEditContato(idx));
      tr.querySelector('.delete-contato').addEventListener('click', () => confirmDeleteContato(idx));
      tbody.appendChild(tr);
    });
  }

  function startEditContato(idx){
    const ct = contatos[idx];
    const tbody = document.getElementById('contatosTabela');
    const tr = tbody?.children[idx];
    if(!tr) return;
    const input = val => `<input type="text" class="w-full bg-input border border-inputBorder rounded-lg px-2 py-1 text-white text-sm" value="${val || ''}">`;
    tr.innerHTML = `
      <td class="py-2 px-4">${input(ct.nome)}</td>
      <td class="py-2 px-4">${input(ct.cargo)}</td>
      <td class="py-2 px-4">${input(ct.email)}</td>
      <td class="py-2 px-4">${input(ct.telefone_celular)}</td>
      <td class="py-2 px-4">${input(ct.telefone_fixo)}</td>
      <td class="py-2 px-4 text-center">
        <div class="flex items-center justify-center gap-2">
          <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded text-green-400 confirm-edit"></i>
          <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded text-red-400 cancel-edit"></i>
        </div>
      </td>`;
    const inputs = tr.querySelectorAll('input');
    tr.querySelector('.confirm-edit').addEventListener('click', () => {
      ct.nome = inputs[0].value.trim();
      ct.cargo = inputs[1].value.trim();
      ct.email = inputs[2].value.trim();
      ct.telefone_celular = inputs[3].value.trim();
      ct.telefone_fixo = inputs[4].value.trim();
      if(ct.status !== 'new') ct.status = 'updated';
      renderContatos();
    });
    tr.querySelector('.cancel-edit').addEventListener('click', () => {
      renderContatos();
    });
  }

  function showConfirmDialog(message, cb){
    const ov=document.createElement('div');
    ov.className='fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4';
    ov.innerHTML=`<div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-white">Tem certeza?</h3><p class="text-sm text-gray-300 mb-6">${message}</p><div class="flex justify-center gap-4"><button id="dlgYes" class="btn-warning px-4 py-2 rounded-lg text-white font-medium">Sim</button><button id="dlgNo" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Não</button></div></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#dlgYes').addEventListener('click',()=>{ov.remove();cb(true);});
    ov.querySelector('#dlgNo').addEventListener('click',()=>{ov.remove();cb(false);});
  }

  function confirmDeleteContato(idx){
    const ct = contatos[idx];
    showConfirmDialog('Deseja excluir este contato?', yes => {
      if(!yes) return;
      if(ct.status === 'new'){
        contatos.splice(idx,1);
      }else{
        contatosExcluidos.push(ct.id);
        contatos.splice(idx,1);
      }
      renderContatos();
    });
  }

  document.getElementById('addContatoBtn')?.addEventListener('click', () => {
    Modal.open('modals/clientes/contato.html', '../js/modals/cliente-contato.js', 'novoContatoCliente', true);
  });

  window.addEventListener('clienteContatoAdicionado', e => {
    const ct = { ...e.detail, status: 'new' };
    contatos.push(ct);
    renderContatos();
  });

  function inicializarToggles(cli){
    const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    const cobToggle = document.getElementById('cobrancaIgual');
    const cobFields = document.getElementById('cobrancaFields');
    const entToggle = document.getElementById('entregaIgual');
    const entFields = document.getElementById('entregaFields');
    if(cobToggle && cobFields){
      const update = () => cobFields.classList.toggle('hidden', cobToggle.checked);
      cobToggle.addEventListener('change', update);
      if(same(cli.endereco_cobranca, cli.endereco_registro)){ cobToggle.checked = true; update(); }
    }
    if(entToggle && entFields){
      const update = () => entFields.classList.toggle('hidden', entToggle.checked);
      entToggle.addEventListener('change', update);
      if(same(cli.endereco_entrega, cli.endereco_registro)){ entToggle.checked = true; update(); }
    }
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

  function coletarDados(){
    const getVal = id => document.getElementById(id)?.value?.trim() || '';
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
    const reg = endereco('reg');
    const cob = document.getElementById('cobrancaIgual')?.checked ? reg : endereco('cob');
    const ent = document.getElementById('entregaIgual')?.checked ? reg : endereco('ent');
    const contatosNovos = contatos.filter(c => c.status === 'new').map(({status, id, ...rest}) => rest);
    const contatosAtualizados = contatos.filter(c => c.status === 'updated').map(({status, ...rest}) => rest);
    return {
      razao_social: getVal('empresaRazaoSocial'),
      nome_fantasia: getVal('empresaNomeFantasia'),
      cnpj: getVal('empresaCnpj'),
      inscricao_estadual: getVal('empresaInscricaoEstadual'),
      site: getVal('empresaSite'),
      status_cliente: getVal('empresaStatus'),
      dono_cliente: getVal('empresaDono'),
      origem_captacao: getVal('empresaOrigemCaptacao'),
      endereco_registro: reg,
      endereco_cobranca: cob,
      endereco_entrega: ent,
      anotacoes: document.getElementById('clienteNotas')?.value || '',
      contatosNovos,
      contatosAtualizados,
      contatosExcluidos
    };
  }

  const salvarBtn = overlay.querySelector('footer .btn-primary');
  if(salvarBtn && cliente){
    salvarBtn.addEventListener('click', async () => {
      const dados = coletarDados();
      try{
        const res = await fetch(`http://localhost:3000/api/clientes/${cliente.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dados)
        });
        if(!res.ok) throw new Error('Erro ao salvar');
        showToast('Cliente atualizado com sucesso');
        window.dispatchEvent(new Event('clienteEditado'));
        close();
      }catch(err){
        console.error('Erro ao atualizar cliente', err);
        showToast('Erro ao salvar cliente', 'error');
      }
    });
  }
})();
