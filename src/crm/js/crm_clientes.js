// crm_clientes_combined.js

function initClientes() {
  // --- 1) Estados e Cache ---
  const stateNames = {
    AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas',
    BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
    GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
    MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
    PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
    RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
    SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins'
  };
  let clientesCache = [];

  // --- 2) Renderização da Tabela ---
  function renderClientes(lista) {
    const tbody = document.getElementById('clientes-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    lista.forEach((c, idx) => {
      const statusColors = {
        'Ativo': 'bg-[var(--color-positive)] text-black',
        'Inativo': 'bg-[var(--color-negative)] text-white',
        'Prospect': 'bg-[var(--color-blue)] text-black'
      };
      const badgeClass = statusColors[c.status_cliente] || 'bg-[var(--color-gray-100)] text-[var(--color-gray-800)]';
      const tr = document.createElement('tr');
      tr.classList.add('hover:bg-gray-50');
      tr.dataset.index = idx;
      tr.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="flex items-center">
            <div class="text-sm font-medium text-gray-900">
              ${c.nome_fantasia}
              <span class="ml-1 text-gray-400 cursor-help" title="Clique para mais informações">ℹ️</span>
            </div>
          </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap"><div class="text-sm text-gray-500">${c.cnpj||''}</div></td>
        <td class="px-6 py-4 whitespace-nowrap"><div class="text-sm text-gray-500">${stateNames[c.estado]||c.estado||''}</div></td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${badgeClass}">
            ${c.status_cliente||''}
          </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${c.dono_cliente||''}</td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <button class="btn-detail action-icon mr-3" title="Detalhes">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd" />
            </svg>
          </button>
          <button class="btn-delete action-icon" title="Excluir">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path d="M9 3v1H4v2h1v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm8 3v14H7V6h10zM9 8h2v10H9V8zm4 0h2v10h-2V8z"/>
            </svg>
          </button>
        </td>`;
      tbody.appendChild(tr);
    });
    if (window.feather) feather.replace();
  }

  // --- 3) Carregar do Back-end ou Fallback ---
  async function carregarClientes() {
    try {
      const resp = await fetch('http://localhost:3000/api/clientes/lista');
      clientesCache = await resp.json();
    } catch (err) {
      console.error('Erro ao carregar clientes:', err);
      clientesCache = [{
        nome_fantasia: 'Cliente Exemplo',
        cnpj: '00.000.000/0000-00',
        estado: 'SP',
        status_cliente: 'Ativo',
        dono_cliente: 'Usuário'
      }];
    }
    renderClientes(clientesCache);
  }

  // --- 4) Filtrar por Estado ---
  function aplicarFiltroEstado() {
    const sel = document.getElementById('filter-state');
    if (!sel) return;
    const uf = sel.value;
    const filtrados = uf ? clientesCache.filter(c => c.estado === uf) : clientesCache;
    renderClientes(filtrados);
  }

  // --- 5) Inicialização na Página ---
  const clientesTable = document.getElementById('tabelaClientes');
  if (clientesTable) {
    carregarClientes();
    const sel = document.getElementById('filter-state');
    if (sel) sel.addEventListener('change', aplicarFiltroEstado);

    clientesTable.addEventListener('click', e => {
      const detailBtn = e.target.closest('.btn-detail');
      if (detailBtn) {
        const tr = detailBtn.closest('tr');
        const idx = tr ? parseInt(tr.dataset.index, 10) : NaN;
        openClientDetail(idx);
      } else if (e.target.closest('.btn-delete')) {
        alert('Delete Client');
      }
    });
  }

  // expor API externamente, se necessário
  window.crmClientes = { carregarClientes, aplicarFiltroEstado };

  // --- 6) Modal de Detalhes (fetch + init) ---
  async function openClientDetail(index) {
    const overlay = document.getElementById('clientModalOverlay');
    if (!overlay) {
      console.error('clientModalOverlay not found');
      return;
    }
    overlay.classList.add('active');
    const modal = overlay.querySelector('.client-modal');
    if (modal) modal.classList.add('show');
    overlay.style.display = 'flex';
    document.body.classList.add('overflow-hidden');
    if (!overlay.dataset.initialized) {
      initClientDetailModal();
      overlay.dataset.initialized = 'true';
    }
    // always start with the first tab active when opening
    if (typeof overlay.setActiveTab === 'function') {
      overlay.setActiveTab('company');
    }
    const id = clientesCache[index]?.id;
    if (id) {
      await fetchClientDetail(id);
    } else {
      populateClientDetail(clientesCache[index] || {});
    }
  }

  function initClientDetailModal() {
    const overlay = document.getElementById('clientModalOverlay');
    const backBtn  = overlay.querySelector('#backBtn');
    const closeBtn = overlay.querySelector('#closeBtn');
    const saveBtn  = overlay.querySelector('#saveBtn');
    const saveSpinner = overlay.querySelector('#saveSpinner');
    const saveToast   = overlay.querySelector('#saveToast');
    const tabItems    = overlay.querySelectorAll('.tab-item');
    const tabContents = overlay.querySelectorAll('.tab-content');
    const mobileTabSelect = overlay.querySelector('#mobileTabSelect');
    const requiredInputs  = overlay.querySelectorAll('input[required], select[required]');

    function closeModal() {
      overlay.classList.remove('active');
      const modal = overlay.querySelector('.client-modal');
      if (modal) modal.classList.remove('show');
      overlay.style.display = 'none';
      document.body.classList.remove('overflow-hidden');
    }
    backBtn.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);

    function setActiveTab(tabId) {
      tabItems.forEach(i => i.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      overlay.querySelector(`.tab-item[data-tab="${tabId}"]`).classList.add('active');
      overlay.querySelector(`#${tabId}`).classList.add('active');
      mobileTabSelect.value = tabId;
    }
    tabItems.forEach(item => item.addEventListener('click', () => setActiveTab(item.dataset.tab)));
    mobileTabSelect.addEventListener('change', () => setActiveTab(mobileTabSelect.value));

    // expose setter so other functions can reset the modal when opened
    overlay.setActiveTab = setActiveTab;

    function validateInput(input) {
      const ec = 'error', emc = 'form-error';
      const msg = 'Este campo é obrigatório';
      input.parentNode.querySelector(`.${emc}`)?.remove();
      if (!input.value.trim()) {
        input.classList.add(ec);
        const div = document.createElement('div');
        div.className = emc;
        div.textContent = msg;
        input.parentNode.appendChild(div);
        return false;
      }
      input.classList.remove(ec);
      return true;
    }
    requiredInputs.forEach(i => i.addEventListener('blur', () => validateInput(i)));

    saveBtn.addEventListener('click', () => {
      let valid = true;
      requiredInputs.forEach(i => { if (!validateInput(i)) valid = false; });
      if (!valid) return;
      saveSpinner.style.display = 'block';
      saveBtn.disabled = true;
      setTimeout(() => {
        saveSpinner.style.display = 'none';
        saveBtn.disabled = false;
        saveToast.classList.add('show');
        setTimeout(() => saveToast.classList.remove('show'), 5000);
        overlay.classList.remove('active');
        overlay.style.display = 'none';
        document.body.classList.remove('overflow-hidden');
      }, 1000);
    });

    overlay.querySelectorAll('.attachment-remove').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.attachment').remove());
    });
  }

  function getVal(v) {
    return v && String(v).trim() ? v : 'Criar no banco de dados';
  }

  async function fetchClientDetail(id) {
    try {
      const resp = await fetch(`http://localhost:3000/api/clientes/${id}`);
      const data = await resp.json();
      populateClientDetail(data.cliente || {}, data.contatos || [], data.contratos || [], data.notas || []);
    } catch (err) {
      console.error('Erro ao obter detalhes do cliente:', err);
      populateClientDetail({}, [], [], []);
    }
  }

  function populateClientDetail(cliente, contatos = [], contratos = [], notas = []) {
    const nomeFantasiaInput = document.getElementById('inputNomeFantasia');
    const razaoInput = document.getElementById('inputRazaoSocial');
    const cnpjInput = document.getElementById('inputCnpj');
    const segmentoInput = document.getElementById('inputSegmento');
    const ieInput = document.getElementById('inputInscricao');
    const siteInput = document.getElementById('inputSite');

    const regRuaInput = document.getElementById('registroRua');
    const regNumeroInput = document.getElementById('registroNumero');
    const regComplInput = document.getElementById('registroComplemento');
    const regBairroInput = document.getElementById('registroBairro');
    const regCidadeInput = document.getElementById('registroCidade');
    const regEstadoInput = document.getElementById('registroEstado');
    const regCepInput = document.getElementById('registroCep');

    const cobRuaInput = document.getElementById('cobrancaRua');
    const cobNumeroInput = document.getElementById('cobrancaNumero');
    const cobComplInput = document.getElementById('cobrancaComplemento');
    const cobBairroInput = document.getElementById('cobrancaBairro');
    const cobCidadeInput = document.getElementById('cobrancaCidade');
    const cobEstadoInput = document.getElementById('cobrancaEstado');
    const cobCepInput = document.getElementById('cobrancaCep');

    const entRuaInput = document.getElementById('entregaRua');
    const entNumeroInput = document.getElementById('entregaNumero');
    const entComplInput = document.getElementById('entregaComplemento');
    const entBairroInput = document.getElementById('entregaBairro');
    const entCidadeInput = document.getElementById('entregaCidade');
    const entEstadoInput = document.getElementById('entregaEstado');
    const entCepInput = document.getElementById('entregaCep');

    const tagCobIgual = document.getElementById('tagCobrancaIgual');
    const tagEntIgual = document.getElementById('tagEntregaIgual');

    const cobGrid = document.querySelector('#cobrancaSection .grid');
    const entGrid = document.querySelector('#entregaSection .grid');

    const title = document.getElementById('taskTitle');

    if (nomeFantasiaInput) nomeFantasiaInput.value = getVal(cliente.nome_fantasia);
    if (razaoInput) razaoInput.value = getVal(cliente.razao_social);
    if (cnpjInput) cnpjInput.value = getVal(cliente.cnpj);
    if (segmentoInput) segmentoInput.value = getVal(cliente.segmento);
    if (ieInput) ieInput.value = getVal(cliente.inscricao_estadual);
    if (siteInput) siteInput.value = getVal(cliente.site);

    const regAddr = cliente.endereco_registro || {};
    const cobAddr = cliente.endereco_cobranca || {};
    const entAddr = cliente.endereco_entrega || {};

    if (regRuaInput) regRuaInput.value = getVal(regAddr.rua);
    if (regNumeroInput) regNumeroInput.value = getVal(regAddr.numero);
    if (regComplInput) regComplInput.value = getVal(regAddr.complemento);
    if (regBairroInput) regBairroInput.value = getVal(regAddr.bairro);
    if (regCidadeInput) regCidadeInput.value = getVal(regAddr.cidade);
    if (regEstadoInput) regEstadoInput.value = getVal(regAddr.estado);
    if (regCepInput) regCepInput.value = getVal(regAddr.cep);

    if (cobRuaInput) cobRuaInput.value = getVal(cobAddr.rua);
    if (cobNumeroInput) cobNumeroInput.value = getVal(cobAddr.numero);
    if (cobComplInput) cobComplInput.value = getVal(cobAddr.complemento);
    if (cobBairroInput) cobBairroInput.value = getVal(cobAddr.bairro);
    if (cobCidadeInput) cobCidadeInput.value = getVal(cobAddr.cidade);
    if (cobEstadoInput) cobEstadoInput.value = getVal(cobAddr.estado);
    if (cobCepInput) cobCepInput.value = getVal(cobAddr.cep);

    if (entRuaInput) entRuaInput.value = getVal(entAddr.rua);
    if (entNumeroInput) entNumeroInput.value = getVal(entAddr.numero);
    if (entComplInput) entComplInput.value = getVal(entAddr.complemento);
    if (entBairroInput) entBairroInput.value = getVal(entAddr.bairro);
    if (entCidadeInput) entCidadeInput.value = getVal(entAddr.cidade);
    if (entEstadoInput) entEstadoInput.value = getVal(entAddr.estado);
    if (entCepInput) entCepInput.value = getVal(entAddr.cep);

    if (tagCobIgual) tagCobIgual.classList.add('hidden');
    if (tagEntIgual) tagEntIgual.classList.add('hidden');

    const sameBilling = JSON.stringify(cobAddr) === JSON.stringify(regAddr);
    const sameDelivery = JSON.stringify(entAddr) === JSON.stringify(regAddr);
    if (sameBilling) {
      if (tagCobIgual) tagCobIgual.classList.remove('hidden');
      cobGrid?.classList.add('hidden');
    } else {
      cobGrid?.classList.remove('hidden');
    }
    if (sameDelivery) {
      if (tagEntIgual) tagEntIgual.classList.remove('hidden');
      entGrid?.classList.add('hidden');
    } else {
      entGrid?.classList.remove('hidden');
    }

    if (title) title.textContent = `Detalhes – ${getVal(cliente.nome_fantasia)}`;

    const contactsBody = document.getElementById('contactsBody');
    if (contactsBody) {
      contactsBody.innerHTML = '';
      if (contatos.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="6">Criar no banco de dados</td>`;
        contactsBody.appendChild(tr);
      } else {
        contatos.forEach(ct => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${getVal(ct.nome)}</td>
            <td>${getVal(ct.cargo)}</td>
            <td>${getVal(ct.email)}</td>
            <td>${getVal(ct.telefone_celular)}</td>
            <td>${getVal(ct.telefone_fixo)}</td>
            <td class="text-right">
              <button class="btn-edit action-icon mr-3" title="Editar">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
              <button class="btn-delete action-icon" title="Excluir">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
              </button>
            </td>`;
          contactsBody.appendChild(tr);
        });
      }
    }

    const contractsBody = document.getElementById('contractsBody');
    if (contractsBody) {
      contractsBody.innerHTML = '';
      if (contratos.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="6">Criar no banco de dados</td>`;
        contractsBody.appendChild(tr);
      } else {
        contratos.forEach(ct => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${getVal(ct.numero)}</td>
            <td>${getVal(ct.tipo)}</td>
            <td>${getVal(ct.inicio)}</td>
            <td>${getVal(ct.fim)}</td>
            <td>${getVal(ct.valor)}</td>
            <td>${getVal(ct.status)}</td>`;
          contractsBody.appendChild(tr);
        });
      }
    }

    const notesText = document.getElementById('notesText');
    if (notesText) notesText.value = getVal(cliente.observacoes);
  }

  if (window.feather) feather.replace();
}

window.initClientes = initClientes;
