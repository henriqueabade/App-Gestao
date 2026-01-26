(async function () {
  const overlayId = 'novoServico';
  const overlay = document.getElementById('novoServicoOverlay');
  if (!overlay) return;

  const close = () => {
    if (typeof Modal?.close === 'function') {
      Modal.close(overlayId);
    } else {
      overlay.classList.add('hidden');
    }
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.getElementById('voltarNovoServico')?.addEventListener('click', close);
  document.getElementById('cancelarNovoServico')?.addEventListener('click', close);

  const handleEsc = (event) => {
    if (event.key === 'Escape') {
      close();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: overlayId }));

  const tablist = overlay.querySelector('[role="tablist"]');
  const tabs = Array.from(overlay.querySelectorAll('[role="tab"]'));
  const panels = Array.from(overlay.querySelectorAll('[role="tabpanel"]'));

  function activateTab(targetTab, { setFocus = true } = {}) {
    tabs.forEach((tab) => {
      tab.setAttribute('aria-selected', 'false');
      tab.setAttribute('tabindex', '-1');
      tab.classList.remove('tab-active');
      tab.classList.add('text-gray-400', 'border-transparent');
      tab.classList.remove('hover:text-white');
    });
    panels.forEach((panel) => panel.classList.add('hidden'));

    targetTab.setAttribute('aria-selected', 'true');
    targetTab.setAttribute('tabindex', '0');
    targetTab.classList.add('tab-active');
    targetTab.classList.remove('text-gray-400', 'border-transparent');
    targetTab.classList.add('hover:text-white');
    const targetPanel = overlay.querySelector(`#${targetTab.getAttribute('aria-controls')}`);
    if (targetPanel) targetPanel.classList.remove('hidden');
    if (setFocus) targetTab.focus();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      activateTab(tab);
    });
  });

  if (tablist) {
    tablist.addEventListener('keydown', (event) => {
      const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
      let targetIndex;
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          targetIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
          activateTab(tabs[targetIndex]);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          targetIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
          activateTab(tabs[targetIndex]);
          break;
        case 'Home':
          event.preventDefault();
          activateTab(tabs[0]);
          break;
        case 'End':
          event.preventDefault();
          activateTab(tabs[tabs.length - 1]);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          if (currentIndex >= 0) activateTab(tabs[currentIndex]);
          break;
      }
    });
  }

  activateTab(tabs[0], { setFocus: false });

  function obterUsuarioSalvo() {
    try {
      const sessionStore = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
      const localStore = typeof localStorage !== 'undefined' ? localStorage : null;
      const stored = sessionStore?.getItem('currentUser') || localStore?.getItem('user');
      return stored ? JSON.parse(stored) : null;
    } catch (err) {
      console.error('Erro ao recuperar usuário logado', err);
      return null;
    }
  }

  function obterToken() {
    const usuario = obterUsuarioSalvo();
    return (
      usuario?.token ||
      usuario?.jwt ||
      usuario?.accessToken ||
      usuario?.access_token ||
      null
    );
  }

  async function fetchApi(path, options = {}) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    const headers = new Headers(options?.headers || {});
    const token = obterToken();
    if (token && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${token}`);
    }
    return fetch(`${baseUrl}${path}`, { ...options, headers });
  }

  function exigirToken() {
    const token = obterToken();
    if (!token) {
      alert('Não foi possível identificar o token do usuário. Faça login novamente.');
      throw new Error('Token ausente');
    }
    return token;
  }

  function prepararNumero(valor) {
    if (valor === null || valor === undefined) return null;
    const limpo = String(valor).trim();
    if (!limpo) return null;
    const normalizado = limpo.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalizado);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function restringirLetras(input) {
    if (!input) return;
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^A-Za-zÀ-ÿ\s]/g, '');
    });
  }

  function restringirNumeros(input) {
    if (!input) return;
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^0-9,.-]/g, '');
    });
  }

  const clienteSelect = document.getElementById('servicoCliente');
  const ambienteInput = document.getElementById('servicoAmbiente');
  const nomeInput = document.getElementById('servicoNome');
  const segueVeioInput = document.getElementById('servicoSegueVeio');
  const larguraInput = document.getElementById('servicoLargura');
  const quantidadeInput = document.getElementById('servicoQuantidade');
  const tipoInput = document.getElementById('servicoTipo');
  const laminaInput = document.getElementById('servicoLamina');
  const donoLaminaInput = document.getElementById('servicoDonoLamina');
  const mdfInput = document.getElementById('servicoMdf');
  const donoMdfInput = document.getElementById('servicoDonoMdf');
  const novoDesenhoBtn = document.getElementById('novoDesenhoBtn');
  const codigoPecaAtual = document.getElementById('codigoPecaAtual');
  const pecasTabela = document.getElementById('pecasTabela');

  const amarradoLaminaInput = document.getElementById('amarradoLamina');
  const amarradoComprimentoInput = document.getElementById('amarradoComprimento');
  const amarradoLarguraPrincipalInput = document.getElementById('amarradoLarguraPrincipal');
  const amarradoLarguraMenorInput = document.getElementById('amarradoLarguraMenor');
  const amarradoLarguraMediaInput = document.getElementById('amarradoLarguraMedia');
  const amarradoAlturaMediaInput = document.getElementById('amarradoAlturaMedia');
  const amarradoLarguraMaiorInput = document.getElementById('amarradoLarguraMaior');
  const amarradoQuantidadeInput = document.getElementById('amarradoQuantidade');
  const amarradoTipoInput = document.getElementById('amarradoTipo');
  const amarradoSequenciaInput = document.getElementById('amarradoSequencia');
  const amarradoAdicionarBtn = document.getElementById('amarradoAdicionarBtn');
  const amarradoTabela = document.getElementById('amarradoTabela');
  const amarradoModoEdicao = document.getElementById('amarradoModoEdicao');

  restringirLetras(ambienteInput);
  restringirLetras(laminaInput);
  restringirNumeros(segueVeioInput);
  restringirNumeros(larguraInput);
  restringirNumeros(quantidadeInput);

  restringirLetras(amarradoLaminaInput);
  restringirLetras(amarradoTipoInput);
  restringirNumeros(amarradoComprimentoInput);
  restringirNumeros(amarradoLarguraPrincipalInput);
  restringirNumeros(amarradoLarguraMenorInput);
  restringirNumeros(amarradoLarguraMediaInput);
  restringirNumeros(amarradoAlturaMediaInput);
  restringirNumeros(amarradoLarguraMaiorInput);
  restringirNumeros(amarradoQuantidadeInput);
  restringirNumeros(amarradoSequenciaInput);

  function atualizarBloqueioMdf() {
    if (!tipoInput || !mdfInput || !donoMdfInput) return;
    const tipo = tipoInput.value;
    const bloqueado = tipo === 'contraplacado';
    mdfInput.disabled = bloqueado;
    donoMdfInput.disabled = bloqueado;
    if (bloqueado) {
      mdfInput.value = '';
      donoMdfInput.value = '';
    }
  }

  tipoInput?.addEventListener('change', atualizarBloqueioMdf);
  atualizarBloqueioMdf();

  async function carregarClientes() {
    if (!clienteSelect) return;
    try {
      exigirToken();
      let resp = await fetchApi('/api/clientes_laminacao/lista');
      if (!resp.ok) {
        resp = await fetchApi('/api/clientes_laminacao');
      }
      const clientes = await resp.json();
      const lista = Array.isArray(clientes) ? clientes : [];
      clienteSelect.innerHTML = '<option value="">Selecione o cliente</option>' +
        lista.map((cliente) => {
          const nome = cliente?.nome_fantasia || cliente?.razao_social || cliente?.nome || '';
          const valor = cliente?.id ?? nome;
          return `<option value="${valor}">${nome}</option>`;
        }).join('');
    } catch (err) {
      console.error('Erro ao carregar clientes', err);
    }
  }

  carregarClientes();

  const pecas = [];
  let pecaEmEdicao = null;

  function gerarCodigoPeca(ambiente, indiceAtual = null) {
    const inicial = (ambiente || '').trim().charAt(0).toUpperCase();
    if (!inicial) return '';
    const total = pecas.filter((peca, index) => {
      if (indiceAtual !== null && index === indiceAtual) return false;
      return (peca.codigo || '').startsWith(inicial);
    }).length;
    return `${inicial}${total + 1}`;
  }

  function obterCodigoPecaAtual(ambiente) {
    const ambienteLimpo = (ambiente || '').trim();
    if (!ambienteLimpo) return '';
    if (pecaEmEdicao !== null) {
      const pecaAtual = pecas[pecaEmEdicao];
      const ambienteOriginal = (pecaAtual?.ambiente || '').trim().toLowerCase();
      const ambienteInformado = ambienteLimpo.toLowerCase();
      const codigoOriginal = pecaAtual?.codigo || '';
      if (codigoOriginal && ambienteOriginal && ambienteOriginal === ambienteInformado) {
        return codigoOriginal;
      }
    }
    return gerarCodigoPeca(ambienteLimpo, pecaEmEdicao);
  }

  function atualizarCodigoPecaAtual() {
    if (!codigoPecaAtual) return;
    const codigo = obterCodigoPecaAtual(ambienteInput?.value);
    codigoPecaAtual.textContent = `Código: ${codigo || '-'}`;
  }

  function limparFormularioPeca() {
    if (ambienteInput) ambienteInput.value = '';
    if (nomeInput) nomeInput.value = '';
    if (segueVeioInput) segueVeioInput.value = '';
    if (larguraInput) larguraInput.value = '';
    if (quantidadeInput) quantidadeInput.value = '';
    if (tipoInput) tipoInput.value = '';
    if (laminaInput) laminaInput.value = '';
    if (donoLaminaInput) donoLaminaInput.value = '';
    if (mdfInput) mdfInput.value = '';
    if (donoMdfInput) donoMdfInput.value = '';
    atualizarBloqueioMdf();
    pecaEmEdicao = null;
    if (novoDesenhoBtn) novoDesenhoBtn.textContent = '+ Desenho';
    atualizarCodigoPecaAtual();
  }

  function validarLetras(valor, campo) {
    if (!valor) return `${campo} é obrigatório.`;
    if (!/^[A-Za-zÀ-ÿ\s]+$/.test(valor)) {
      return `${campo} deve conter apenas letras.`;
    }
    return null;
  }

  function validarNumero(valor, campo) {
    const numero = prepararNumero(valor);
    if (numero === null) return `${campo} é obrigatório e deve ser numérico.`;
    return null;
  }

  function validarSelecao(valor, campo) {
    if (!valor) return `${campo} é obrigatório.`;
    return null;
  }

  function obterDadosPeca() {
    const ambiente = ambienteInput?.value.trim() || '';
    const nome = nomeInput?.value.trim() || '';
    const segueVeio = segueVeioInput?.value.trim() || '';
    const largura = larguraInput?.value.trim() || '';
    const quantidade = quantidadeInput?.value.trim() || '';
    const tipo = tipoInput?.value.trim() || '';
    const lamina = laminaInput?.value.trim() || '';
    const donoLamina = donoLaminaInput?.value.trim() || '';
    const mdf = mdfInput?.value.trim() || '';
    const donoMdf = donoMdfInput?.value.trim() || '';

    let erro = validarLetras(ambiente, 'Ambiente');
    if (erro) return { erro };
    erro = validarSelecao(nome, 'Nome da peça');
    if (erro) return { erro };
    erro = validarNumero(segueVeio, 'Segue veio');
    if (erro) return { erro };
    erro = validarNumero(largura, 'Largura');
    if (erro) return { erro };
    erro = validarNumero(quantidade, 'Quantidade');
    if (erro) return { erro };
    erro = validarSelecao(tipo, 'Tipo');
    if (erro) return { erro };
    erro = validarLetras(lamina, 'Lâmina');
    if (erro) return { erro };
    erro = validarSelecao(donoLamina, 'Dono da lâmina');
    if (erro) return { erro };

    const tipoNormalizado = tipo.toLowerCase();
    const bloquearMdf = tipoNormalizado === 'contraplacado';
    if (!bloquearMdf) {
      erro = validarSelecao(mdf, 'MDF');
      if (erro) return { erro };
      erro = validarSelecao(donoMdf, 'Dono do MDF');
      if (erro) return { erro };
    }

    return {
      ambiente,
      nome,
      segue_veio: prepararNumero(segueVeio),
      largura: prepararNumero(largura),
      quantidade: prepararNumero(quantidade),
      tipo,
      lamina,
      dono_lamina: donoLamina,
      mdf: bloquearMdf ? null : mdf,
      dono_mdf: bloquearMdf ? null : donoMdf
    };
  }

  function renderPecas() {
    if (!pecasTabela) return;
    pecasTabela.innerHTML = '';
    if (!pecas.length) {
      pecasTabela.innerHTML = '<tr><td colspan="10" class="py-12 text-left text-gray-400">Nenhuma peça cadastrada</td></tr>';
      return;
    }
    pecas.forEach((peca, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="py-4 px-4 text-white">${peca.codigo || ''}</td>
        <td class="py-4 px-4 text-white">${peca.ambiente || ''}</td>
        <td class="py-4 px-4 text-white">${peca.nome || ''}</td>
        <td class="py-4 px-4 text-white">${peca.segue_veio ?? ''}</td>
        <td class="py-4 px-4 text-white">${peca.largura ?? ''}</td>
        <td class="py-4 px-4 text-white">${peca.quantidade ?? ''}</td>
        <td class="py-4 px-4 text-white">${peca.tipo || ''}</td>
        <td class="py-4 px-4 text-white">${peca.lamina || ''}</td>
        <td class="py-4 px-4 text-white">${peca.mdf || ''}</td>
        <td class="py-4 px-4 text-left text-white">
          <div class="flex items-center justify-start gap-2">
            <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
            <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-red)" title="Excluir"></i>
          </div>
        </td>
      `;
      const editBtn = tr.querySelector('.fa-edit');
      const deleteBtn = tr.querySelector('.fa-trash');
      editBtn?.addEventListener('click', () => {
        pecaEmEdicao = index;
        if (ambienteInput) ambienteInput.value = peca.ambiente || '';
        if (nomeInput) nomeInput.value = peca.nome || '';
        if (segueVeioInput) segueVeioInput.value = peca.segue_veio || '';
        if (larguraInput) larguraInput.value = peca.largura ?? '';
        if (quantidadeInput) quantidadeInput.value = peca.quantidade ?? '';
        if (tipoInput) tipoInput.value = peca.tipo || '';
        if (laminaInput) laminaInput.value = peca.lamina || '';
        if (donoLaminaInput) donoLaminaInput.value = peca.dono_lamina || '';
        if (mdfInput) mdfInput.value = peca.mdf || '';
        if (donoMdfInput) donoMdfInput.value = peca.dono_mdf || '';
        atualizarBloqueioMdf();
        if (novoDesenhoBtn) novoDesenhoBtn.textContent = 'Atualizar Peça';
        atualizarCodigoPecaAtual();
      });
      deleteBtn?.addEventListener('click', () => {
        pecas.splice(index, 1);
        renderPecas();
        limparFormularioPeca();
      });
      pecasTabela.appendChild(tr);
    });
  }

  novoDesenhoBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    const dados = obterDadosPeca();
    if (dados.erro) {
      alert(dados.erro);
      return;
    }
    const codigo = obterCodigoPecaAtual(dados.ambiente);
    const registro = { ...dados, codigo };
    if (pecaEmEdicao !== null) {
      pecas[pecaEmEdicao] = registro;
    } else {
      pecas.push(registro);
    }
    renderPecas();
    limparFormularioPeca();
  });

  ambienteInput?.addEventListener('input', atualizarCodigoPecaAtual);
  atualizarCodigoPecaAtual();

  const amarrados = [];
  let amarradoEmEdicao = null;

  function limparFormularioAmarrado() {
    if (amarradoLaminaInput) amarradoLaminaInput.value = '';
    if (amarradoComprimentoInput) amarradoComprimentoInput.value = '';
    if (amarradoLarguraPrincipalInput) amarradoLarguraPrincipalInput.value = '';
    if (amarradoLarguraMenorInput) amarradoLarguraMenorInput.value = '';
    if (amarradoLarguraMediaInput) amarradoLarguraMediaInput.value = '';
    if (amarradoAlturaMediaInput) amarradoAlturaMediaInput.value = '';
    if (amarradoLarguraMaiorInput) amarradoLarguraMaiorInput.value = '';
    if (amarradoQuantidadeInput) amarradoQuantidadeInput.value = '';
    if (amarradoTipoInput) amarradoTipoInput.value = '';
    if (amarradoSequenciaInput) amarradoSequenciaInput.value = '';
    amarradoEmEdicao = null;
    if (amarradoAdicionarBtn) amarradoAdicionarBtn.textContent = 'Adicionar Amarrado';
    amarradoModoEdicao?.classList.add('hidden');
  }

  function obterDadosAmarrado() {
    const lamina = amarradoLaminaInput?.value.trim() || '';
    const comprimento = amarradoComprimentoInput?.value.trim() || '';
    const larguraPrincipal = amarradoLarguraPrincipalInput?.value.trim() || '';
    const larguraMenor = amarradoLarguraMenorInput?.value.trim() || '';
    const larguraMedia = amarradoLarguraMediaInput?.value.trim() || '';
    const alturaMedia = amarradoAlturaMediaInput?.value.trim() || '';
    const larguraMaior = amarradoLarguraMaiorInput?.value.trim() || '';
    const quantidade = amarradoQuantidadeInput?.value.trim() || '';
    const tipo = amarradoTipoInput?.value.trim() || '';
    const sequencia = amarradoSequenciaInput?.value.trim() || '';

    let erro = validarLetras(lamina, 'Lâmina');
    if (erro) return { erro };
    erro = validarNumero(comprimento, 'Comprimento');
    if (erro) return { erro };
    erro = validarNumero(larguraPrincipal, 'Largura principal');
    if (erro) return { erro };
    erro = validarNumero(larguraMenor, 'Largura menor');
    if (erro) return { erro };
    erro = validarNumero(larguraMedia, 'Largura média');
    if (erro) return { erro };
    erro = validarNumero(alturaMedia, 'Altura média');
    if (erro) return { erro };
    erro = validarNumero(larguraMaior, 'Largura maior');
    if (erro) return { erro };
    erro = validarNumero(quantidade, 'Quantidade');
    if (erro) return { erro };
    erro = validarLetras(tipo, 'Tipo');
    if (erro) return { erro };
    erro = validarNumero(sequencia, 'Sequência');
    if (erro) return { erro };

    return {
      lamina,
      comprimento: prepararNumero(comprimento),
      largura_principal: prepararNumero(larguraPrincipal),
      largura_menor: prepararNumero(larguraMenor),
      largura_media: prepararNumero(larguraMedia),
      altura_media: prepararNumero(alturaMedia),
      largura_maior: prepararNumero(larguraMaior),
      quantidade: prepararNumero(quantidade),
      tipo,
      sequencia: prepararNumero(sequencia)
    };
  }

  function renderAmarrados() {
    if (!amarradoTabela) return;
    amarradoTabela.innerHTML = '';
    if (!amarrados.length) {
      amarradoTabela.innerHTML = '<tr><td colspan="11" class="py-12 text-left text-gray-400">Nenhum amarrado cadastrado</td></tr>';
      return;
    }
    amarrados.forEach((amarrado, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="py-4 px-4 text-white">${amarrado.lamina || ''}</td>
        <td class="py-4 px-4 text-white">${amarrado.comprimento ?? ''}</td>
        <td class="py-4 px-4 text-white">${amarrado.largura_principal ?? ''}</td>
        <td class="py-4 px-4 text-white">${amarrado.largura_menor ?? ''}</td>
        <td class="py-4 px-4 text-white">${amarrado.largura_media ?? ''}</td>
        <td class="py-4 px-4 text-white">${amarrado.altura_media ?? ''}</td>
        <td class="py-4 px-4 text-white">${amarrado.largura_maior ?? ''}</td>
        <td class="py-4 px-4 text-white">${amarrado.quantidade ?? ''}</td>
        <td class="py-4 px-4 text-white">${amarrado.tipo || ''}</td>
        <td class="py-4 px-4 text-white">${amarrado.sequencia ?? ''}</td>
        <td class="py-4 px-4 text-left text-white">
          <div class="flex items-center justify-start gap-2">
            <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
            <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-red)" title="Excluir"></i>
          </div>
        </td>
      `;
      const editBtn = tr.querySelector('.fa-edit');
      const deleteBtn = tr.querySelector('.fa-trash');
      editBtn?.addEventListener('click', () => {
        amarradoEmEdicao = index;
        if (amarradoLaminaInput) amarradoLaminaInput.value = amarrado.lamina || '';
        if (amarradoComprimentoInput) amarradoComprimentoInput.value = amarrado.comprimento ?? '';
        if (amarradoLarguraPrincipalInput) amarradoLarguraPrincipalInput.value = amarrado.largura_principal ?? '';
        if (amarradoLarguraMenorInput) amarradoLarguraMenorInput.value = amarrado.largura_menor ?? '';
        if (amarradoLarguraMediaInput) amarradoLarguraMediaInput.value = amarrado.largura_media ?? '';
        if (amarradoAlturaMediaInput) amarradoAlturaMediaInput.value = amarrado.altura_media ?? '';
        if (amarradoLarguraMaiorInput) amarradoLarguraMaiorInput.value = amarrado.largura_maior ?? '';
        if (amarradoQuantidadeInput) amarradoQuantidadeInput.value = amarrado.quantidade ?? '';
        if (amarradoTipoInput) amarradoTipoInput.value = amarrado.tipo || '';
        if (amarradoSequenciaInput) amarradoSequenciaInput.value = amarrado.sequencia ?? '';
        if (amarradoAdicionarBtn) amarradoAdicionarBtn.textContent = 'Atualizar Amarrado';
        amarradoModoEdicao?.classList.remove('hidden');
      });
      deleteBtn?.addEventListener('click', () => {
        amarrados.splice(index, 1);
        renderAmarrados();
        limparFormularioAmarrado();
      });
      amarradoTabela.appendChild(tr);
    });
  }

  amarradoAdicionarBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    const dados = obterDadosAmarrado();
    if (dados.erro) {
      alert(dados.erro);
      return;
    }
    const chave = `${dados.tipo.toLowerCase()}-${dados.sequencia}`;
    const duplicado = amarrados.some((item, index) => {
      if (amarradoEmEdicao !== null && index === amarradoEmEdicao) return false;
      return `${item.tipo.toLowerCase()}-${item.sequencia}` === chave;
    });
    if (duplicado) {
      alert('Já existe um amarrado com o mesmo tipo e sequência.');
      return;
    }
    if (amarradoEmEdicao !== null) {
      amarrados[amarradoEmEdicao] = dados;
    } else {
      amarrados.push(dados);
    }
    renderAmarrados();
    limparFormularioAmarrado();
  });

  async function atualizarPedidoLaminacao(missingKey) {
    const pedidoId =
      overlay.dataset.pedidoId ||
      window.pedidoLaminacaoId ||
      window.pedidoLaminacao?.id ||
      window.servicoLaminacao?.pedido_id ||
      window.servicoLaminacao?.id ||
      null;
    if (!pedidoId) {
      console.warn('ID do pedido de laminação não encontrado para atualização.');
      return;
    }
    const payload = { [missingKey]: missingKey === 'pecas' ? 'peças' : 'amarrado' };
    const resp = await fetchApi(`/api/pedido_laminacao/${pedidoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const mensagem = await resp.text();
      throw new Error(mensagem || 'Erro ao atualizar pedido de laminação');
    }
  }

  async function salvarDados() {
    const cliente = clienteSelect?.value || '';
    if (!cliente) {
      alert('Selecione um cliente antes de salvar.');
      return;
    }

    if (!pecas.length && !amarrados.length) {
      alert('É necessário cadastrar peças ou amarrados antes de salvar.');
      return;
    }

    if (!pecas.length || !amarrados.length) {
      const faltante = !pecas.length ? 'peças' : 'amarrados';
      const confirmar = window.confirm(`A aba de ${faltante} está vazia. Deseja continuar mesmo assim?`);
      if (!confirmar) return;
      try {
        await atualizarPedidoLaminacao(!pecas.length ? 'pecas' : 'amarrado');
      } catch (err) {
        console.error(err);
        alert('Não foi possível atualizar o pedido de laminação.');
        return;
      }
    }

    exigirToken();
    const salvarBtn = document.getElementById('salvarNovoServico');
    if (salvarBtn) salvarBtn.disabled = true;

    try {
      const requisicoes = [];
      if (pecas.length) {
        pecas.forEach((peca) => {
          const payload = {
            ambiente: peca.ambiente,
            nome: peca.nome,
            segue_veio: peca.segue_veio,
            largura: peca.largura,
            quantidade: peca.quantidade,
            tipo: peca.tipo,
            lamina: peca.lamina,
            dono_lamina: peca.dono_lamina,
            mdf: peca.mdf,
            dono_mdf: peca.dono_mdf
          };
          requisicoes.push(
            fetchApi('/api/pecas_laminacao', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
          );
        });
      }
      if (amarrados.length) {
        amarrados.forEach((amarrado) => {
          const payload = {
            lamina: amarrado.lamina,
            comprimento: amarrado.comprimento,
            largura_principal: amarrado.largura_principal,
            largura_menor: amarrado.largura_menor,
            largura_media: amarrado.largura_media,
            altura_media: amarrado.altura_media,
            largura_maior: amarrado.largura_maior,
            quantidade: amarrado.quantidade,
            tipo: amarrado.tipo,
            sequencia: amarrado.sequencia
          };
          requisicoes.push(
            fetchApi('/api/amarrados_laminacao', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
          );
        });
      }
      const respostas = await Promise.all(requisicoes);
      const falha = respostas.find((resp) => !resp.ok);
      if (falha) {
        const mensagem = await falha.text();
        throw new Error(mensagem || 'Erro ao salvar dados');
      }

      window.dispatchEvent(new CustomEvent('servicoLaminacaoAtualizado'));
      close();
    } catch (err) {
      console.error(err);
      alert('Não foi possível salvar o serviço. Verifique os dados e tente novamente.');
    } finally {
      if (salvarBtn) salvarBtn.disabled = false;
    }
  }

  document.getElementById('salvarNovoServico')?.addEventListener('click', (event) => {
    event.preventDefault();
    salvarDados();
  });
})();
