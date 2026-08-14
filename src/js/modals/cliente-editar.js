(async function(){
  const overlay = document.getElementById('editarClienteOverlay');
  if(!overlay) return;
  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const close = () => Modal.close('editarCliente');
  const voltar = document.getElementById('voltarEditarCliente');
  if(voltar) voltar.addEventListener('click', close);
  document.getElementById('cancelarEditarCliente')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});

  const cliente = window.clienteEditar;
  const preferencias = window.clienteEditarPreferencias || null;
  if (preferencias) {
    delete window.clienteEditarPreferencias;
  }
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

  // Transportadoras: mesma mecânica dos contatos — a tela acumula o que mudou e
  // tudo vai junto no salvamento do cliente.
  let transportadoras = [];
  const transportadorasExcluidas = [];
  if(cliente){
    const titulo = document.getElementById('clienteEditarTitulo');
    if(titulo) titulo.textContent = `Editar – ${cliente.nome_fantasia || ''}`;
    try {
      const res = await fetchApi(`/api/clientes/${cliente.id}`);
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

  function applyPreferencias() {
    if (!preferencias) return;
    const { tabId, abrirNovoContato } = preferencias;
    if (tabId) {
      const targetTab = tabs.find(tab => tab.id === tabId || `#${tab.id}` === tabId);
      if (targetTab) {
        activateTab(targetTab, { setFocus: false });
      }
    }
    if (abrirNovoContato) {
      const abrirContato = () => {
        const btn = document.getElementById('addContatoBtn');
        if (btn) btn.click();
      };
      const esperarOverlay = () => {
        if (!overlay || !overlay.classList.contains('hidden')) {
          setTimeout(abrirContato, 50);
        } else {
          requestAnimationFrame(esperarOverlay);
        }
      };
      esperarOverlay();
    }
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
        const res = await fetchApi('/api/usuarios/lista');
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
    tbody.innerHTML = '<tr><td colspan="6" class="py-12 text-left text-gray-400">Nenhum contato cadastrado</td></tr>';
      return;
    }
    contatos.forEach((c, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-perm-col="col_ctt_nome" class="py-4 px-4 text-white">${c.nome || ''}</td>
        <td data-perm-col="col_ctt_cargo" class="py-4 px-4 text-white">${c.cargo || ''}</td>
        <td data-perm-col="col_ctt_email" class="py-4 px-4 text-white">${c.email || ''}</td>
        <td data-perm-col="col_ctt_tel" class="py-4 px-4 text-white">${c.telefone_celular || ''}</td>
        <td data-perm-col="col_ctt_fixo" class="py-4 px-4 text-white">${c.telefone_fixo || ''}</td>
        <td class="py-4 px-4 text-left text-white">
          <div class="flex items-center justify-start gap-2">
            <i data-perm="cli.contact.edit" class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 edit-contato" style="color: var(--color-primary)" title="Editar"></i>
            <i data-perm="cli.contact.remove" class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white delete-contato" style="color: var(--color-red)" title="Excluir"></i>
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
      <td data-perm-col="col_ctt_nome" class="py-2 px-4">${input(ct.nome)}</td>
      <td data-perm-col="col_ctt_cargo" class="py-2 px-4">${input(ct.cargo)}</td>
      <td data-perm-col="col_ctt_email" class="py-2 px-4">${input(ct.email)}</td>
      <td data-perm-col="col_ctt_tel" class="py-2 px-4">${input(ct.telefone_celular)}</td>
      <td data-perm-col="col_ctt_fixo" class="py-2 px-4">${input(ct.telefone_fixo)}</td>
      <td class="py-2 px-4 text-left">
        <div class="flex items-center justify-start gap-2">
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
    ov.className='app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    ov.style.zIndex = 'var(--z-dialog)';
    ov.innerHTML=`<div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-white">Tem certeza?</h3><p class="text-sm text-gray-300 mb-6">${message}</p><div class="flex justify-center gap-4"><button id="dlgYes" class="btn-success px-4 py-2 rounded-lg text-white font-medium">Sim</button><button id="dlgNo" class="btn-danger px-4 py-2 rounded-lg text-white font-medium">Não</button></div></div></div>`;
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

  // ------------------------------------------------------------------------
  // Transportadoras do cliente
  //
  // São as opções oferecidas no campo Transportadora ao emitir um orçamento
  // para ele. Sem esta tela, a única forma de cadastrar uma era converter uma
  // prospecção — que grava a primeira automaticamente.
  // ------------------------------------------------------------------------
  function escaparHtml(v){
    return String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderTransportadoras(){
    const tbody = document.getElementById('transportadorasTabela');
    if(!tbody) return;
    if(!transportadoras.length){
      tbody.innerHTML = '<tr><td colspan="2" class="py-12 text-left text-gray-400">Nenhuma transportadora cadastrada</td></tr>';
      return;
    }
    tbody.innerHTML = transportadoras.map((t, i) => `
      <tr class="border-b border-white/5">
        <td class="py-4 px-4 text-white">${escaparHtml(t.transportadora)}</td>
        <td class="py-4 px-4">
          <div class="flex items-center gap-2">
            <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10"
               style="color: var(--color-primary)" data-editar-transp="${i}" title="Editar"></i>
            <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10"
               style="color: var(--color-red)" data-remover-transp="${i}" title="Excluir"></i>
          </div>
        </td>
      </tr>`).join('');
  }

  async function carregarTransportadoras(){
    if(!cliente?.id) { renderTransportadoras(); return; }
    try{
      const res = await fetchApi(`/api/transportadoras/${cliente.id}`);
      if(!res.ok) throw new Error(`Erro HTTP ${res.status}`);
      const dados = await res.json();
      transportadoras = (Array.isArray(dados) ? dados : [])
        .map(t => ({ id: t.id, transportadora: t.nome || t.transportadora }));
    }catch(err){
      console.error('Erro ao carregar transportadoras', err);
      transportadoras = [];
    }
    renderTransportadoras();
  }

  document.getElementById('addTransportadoraBtn')?.addEventListener('click', () => {
    delete window.clienteTransportadoraEditar;
    Modal.open('modals/clientes/transportadora.html',
      '../js/modals/cliente-transportadora.js', 'transportadoraCliente', true);
  });

  document.getElementById('transportadorasTabela')?.addEventListener('click', async e => {
    const editar = e.target.closest('[data-editar-transp]');
    if(editar){
      const i = Number(editar.dataset.editarTransp);
      const t = transportadoras[i];
      if(!t) return;
      window.clienteTransportadoraEditar = { ...t, indice: i };
      Modal.open('modals/clientes/transportadora.html',
        '../js/modals/cliente-transportadora.js', 'transportadoraCliente', true);
      return;
    }

    const remover = e.target.closest('[data-remover-transp]');
    if(remover){
      const i = Number(remover.dataset.removerTransp);
      const t = transportadoras[i];
      if(!t) return;
      const ok = await window.DialogPadrao?.confirm({
        title: 'Excluir esta transportadora?',
        message: `"${t.transportadora}" deixa de aparecer nos orçamentos deste cliente. Orçamentos já emitidos guardam o nome e não mudam.`,
        confirmText: 'Excluir'
      });
      if(!ok) return;
      // Só entra na lista de exclusão quem já existe no banco; a que foi
      // digitada e removida na mesma sessão nunca chegou lá.
      if(t.id && t.status !== 'new') transportadorasExcluidas.push(t.id);
      transportadoras.splice(i, 1);
      renderTransportadoras();
    }
  });

  function aoSalvarTransportadora(e){
    const dados = e.detail || {};
    if(dados.indice !== undefined && transportadoras[dados.indice]){
      const atual = transportadoras[dados.indice];
      atual.transportadora = dados.transportadora;
      // Já existia no banco: passa a contar como alteração.
      if(atual.id && atual.status !== 'new') atual.status = 'updated';
    }else{
      transportadoras.push({ transportadora: dados.transportadora, status: 'new' });
    }
    renderTransportadoras();
  }

  window.addEventListener('clienteTransportadoraSalva', aoSalvarTransportadora);
  // Sem soltar, o ouvinte sobrevive ao modal: abrir a ficha de OUTRO cliente
  // deixaria dois escutando, e o antigo repintaria a tabela do novo com a
  // lista do cliente anterior.
  window.addEventListener('modal-ready', function soltar(e){
    if(e.detail !== 'editarCliente') return;
    window.removeEventListener('clienteTransportadoraSalva', aoSalvarTransportadora);
    window.removeEventListener('modal-ready', soltar);
  });

  carregarTransportadoras();

  applyPreferencias();

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
        fetchApi(`/api/pedidos?clienteId=${id}`),
        fetchApi(`/api/orcamentos?clienteId=${id}`)
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
    tbody.innerHTML = '<tr><td colspan="6" class="py-12 text-left text-gray-400">Nenhuma ordem encontrada</td></tr>';
      return;
    }
    const formatCurrency = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
    ordens.forEach(o => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-perm-col="col_ord_numero" class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${o.numero}</td>
        <td data-perm-col="col_ord_tipo" class="px-6 py-4 whitespace-nowrap text-sm text-white">${o.tipo}</td>
        <td data-perm-col="col_ord_inicio" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${o.inicio || ''}</td>
        <td data-perm-col="col_ord_condicao" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${o.condicao || ''}</td>
        <td data-perm-col="col_ord_valor" class="px-6 py-4 whitespace-nowrap text-sm text-left text-white">${formatCurrency(o.valor)}</td>
        <td data-perm-col="col_ord_status" class="px-6 py-4 whitespace-nowrap text-sm text-white">${o.status || ''}</td>`;
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
      contatosExcluidos,
      transportadorasNovas: transportadoras
        .filter(t => t.status === 'new')
        .map(t => ({ transportadora: t.transportadora })),
      transportadorasAtualizadas: transportadoras
        .filter(t => t.status === 'updated')
        .map(t => ({ id: t.id, transportadora: t.transportadora })),
      transportadorasExcluidas
    };
  }

  // O botão de salvar é `btn-success` no rodapé — `footer .btn-primary` não
  // casava com nada, `salvarBtn` ficava null e o handler NUNCA era registrado:
  // salvar o cliente não fazia coisa alguma. Agora ele tem id próprio, e o
  // seletor antigo fica como plano B para não depender só do HTML.
  const salvarBtn = document.getElementById('salvarEditarCliente')
    || overlay.querySelector('footer .btn-success')
    || overlay.querySelector('footer .btn-primary');
  if(salvarBtn && cliente){
    salvarBtn.addEventListener('click', async () => {
      const dados = coletarDados();
      try{
        const res = await fetchApi(`/api/clientes/${cliente.id}`, {
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
  // Preservação do trabalho: `contatos` é estado interno deste modal — os
  // contatos adicionados/editados não são <input> na tela, então só voltam da
  // desconexão se o próprio modal disser como salvá-los e repô-los.
  // ------------------------------------------------------------------
  // Preservação do trabalho (ver docs/restauracao-de-trabalho.md)
  //
  // Este modal só sabe QUEM editar por `window.clienteEditar`, definido pela
  // grade de clientes. Na restauração ninguém passa por lá, então sem o
  // `__contexto` ele reabria em branco — nem o título aparecia.
  //
  // Além dos contatos, é preciso guardar quais foram EXCLUÍDOS: o modal recarrega
  // a lista do banco ao reabrir, e sem isso os contatos que o usuário apagou
  // voltavam vivos. País/Estado e "Dono" seguem o mesmo cuidado do Novo Cliente
  // (selects em cascata e por `fetch`).
  // ------------------------------------------------------------------
  const PREFIXOS_ENDERECO = ['reg', 'cob', 'ent'];

  function lerEnderecoGeo() {
    const saida = {};
    PREFIXOS_ENDERECO.forEach(prefixo => {
      saida[prefixo] = {
        pais: document.getElementById(`${prefixo}Pais`)?.value || '',
        estado: document.getElementById(`${prefixo}Estado`)?.value || ''
      };
    });
    return saida;
  }

  window.EstadoTrabalho?.registrarConteudo?.('editarCliente', {
    capturar: () => ({
      __contexto: { clienteEditar: cliente },
      // `row` é nó do DOM e não pode ir para o JSON
      contatos: contatos.map(({ row, ...dados }) => dados),
      contatosExcluidos: contatosExcluidos.slice(),
      abaAtiva: tabs.find(t => t.getAttribute('aria-selected') === 'true')?.id || null,
      dono: document.getElementById('empresaDono')?.value || '',
      enderecos: lerEnderecoGeo()
    }),
    restaurar: async (dados) => {
      if (!dados) return;

      const guardados = Array.isArray(dados.contatos) ? dados.contatos : [];
      if (guardados.length) {
        contatos = guardados.map(d => ({ ...d }));
        renderContatos();
      }

      // Reaplica as exclusões por cima da lista recarregada do banco.
      const excluidos = Array.isArray(dados.contatosExcluidos) ? dados.contatosExcluidos : [];
      if (excluidos.length) {
        contatosExcluidos.length = 0;
        excluidos.forEach(id => contatosExcluidos.push(id));
        const removidos = new Set(excluidos.map(String));
        contatos = contatos.filter(c => !removidos.has(String(c.id)));
        renderContatos();
      }

      const repor = window.EstadoTrabalho?.reporSelect;
      if (repor) {
        await repor(document.getElementById('empresaDono'), dados.dono);

        // País PRIMEIRO: é o `change` dele que carrega a lista de estados.
        for (const prefixo of PREFIXOS_ENDERECO) {
          const guardado = dados.enderecos?.[prefixo];
          if (!guardado?.pais) continue;
          await repor(document.getElementById(`${prefixo}Pais`), guardado.pais);
          await repor(document.getElementById(`${prefixo}Estado`), guardado.estado);
        }
      }

      if (dados.abaAtiva) {
        const aba = document.getElementById(dados.abaAtiva);
        if (aba) activateTab(aba, { setFocus: false });
      }
    }
  });
})();
