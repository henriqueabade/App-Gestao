(async function(){
  const overlay = document.getElementById('detalhesClienteOverlay');
  if(!overlay) return;
  overlay.classList.remove('hidden');
  const close = () => Modal.close('detalhesCliente');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  const voltar = document.getElementById('voltarDetalhesCliente');
  if(voltar) voltar.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});

  const cliente = window.clienteDetalhes;
  if(cliente){
    const titulo = document.getElementById('clienteDetalhesTitulo');
    if(titulo) titulo.textContent = `Detalhes – ${cliente.nome_fantasia || ''}`;
    try {
      const res = await fetch(`http://localhost:3000/api/clientes/${cliente.id}`);
      const data = await res.json();
      if(data && data.cliente){
        preencherDadosEmpresa(data.cliente);
        preencherEnderecos(data.cliente);
        renderContatos(data.contatos || []);
        inicializarToggles(data.cliente);
        const notas = document.getElementById('clienteNotas');
        if(notas) notas.value = data.cliente.anotacoes || '';
      }
      carregarOrdens(cliente.id);
    } catch(err){
      console.error('Erro ao carregar detalhes do cliente', err);
    }
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

  function preencherDadosEmpresa(cli){
    const map = {
      empresaRazaoSocial: 'razao_social',
      empresaNomeFantasia: 'nome_fantasia',
      empresaCnpj: 'cnpj',
      empresaSegmento: 'segmento',
      empresaInscricaoEstadual: 'inscricao_estadual',
      empresaSite: 'site'
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

  function preencherEnderecos(cli){
    const fill = (prefix, data) => {
      if(!data) return;
      for(const key of ['rua','numero','complemento','bairro','cidade','estado','cep']){
        const el = document.getElementById(`${prefix}${key.charAt(0).toUpperCase()+key.slice(1)}`);
        if(el) el.value = data[key] || '';
      }
    };
    fill('reg', cli.endereco_registro);
    fill('cob', cli.endereco_cobranca);
    fill('ent', cli.endereco_entrega);
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
        <td class="w-1/6 py-4 px-4 text-left text-white">${o.numero}</td>
        <td class="w-1/6 py-4 px-4 text-left text-white">${o.tipo}</td>
        <td class="w-1/6 py-4 px-4 text-left text-white">${o.inicio || ''}</td>
        <td class="w-1/6 py-4 px-4 text-left text-white">${o.condicao || ''}</td>
        <td class="w-1/6 py-4 px-4 text-left text-white">${formatCurrency(o.valor)}</td>
        <td class="w-1/6 py-4 px-4 text-left text-white">${o.status || ''}</td>`;
      tbody.appendChild(tr);
    });
  }
})();
