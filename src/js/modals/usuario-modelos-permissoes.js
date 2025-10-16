(async function () {
  const overlay = document.getElementById('modelosPermissoesOverlay');
  if (!overlay) return;

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'modelosPermissoes' }));

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const context = window.usuarioModelosPermissoesContext || {};
  delete window.usuarioModelosPermissoesContext;

  const close = () => {
    document.removeEventListener('keydown', onEscKey);
    Modal.close('modelosPermissoes');
  };

  function onEscKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  document.addEventListener('keydown', onEscKey);
  document.getElementById('voltarModelosPermissoes')?.addEventListener('click', close);
  document.getElementById('cancelarModeloPermissao')?.addEventListener('click', close);

  const elementos = {
    select: overlay.querySelector('#modeloPermissaoSelect'),
    nomeInput: overlay.querySelector('#modeloPermissaoNomeInput'),
    selectorWrapper: overlay.querySelector('#modeloPermissaoSelectorWrapper'),
    busca: overlay.querySelector('#modeloPermissaoBusca'),
    container: overlay.querySelector('#modeloPermissoesContainer'),
    empty: overlay.querySelector('#modeloPermissoesEmpty'),
    mensagem: overlay.querySelector('#modeloPermissoesMensagem'),
    statusBadge: overlay.querySelector('#modeloPermissoesStatusBadge'),
    subtitulo: overlay.querySelector('#modeloPermissoesSubtitulo'),
    toolbarHint: overlay.querySelector('.modelo-permissoes-toolbar__hint'),
    carregarBtn: overlay.querySelector('#carregarModeloPermissao'),
    novoBtn: overlay.querySelector('#novoModeloPermissao'),
    salvarBtn: overlay.querySelector('#salvarModeloPermissao'),
    excluirBtn: overlay.querySelector('#excluirModeloPermissao'),
  };

  const templates = {
    modulo: overlay.querySelector('#modeloPermissoesModuloTemplate'),
    acao: overlay.querySelector('#modeloPermissoesAcaoTemplate'),
  };

  const state = {
    modelos: [],
    estruturaBase: Array.isArray(context.estrutura) ? context.estrutura : [],
    permissoes: [],
    modeloAtual: null,
    modoNovo: false,
    carregando: false,
    ultimoModeloSelecionado: null,
  };

  function formatarTitulo(valor) {
    if (!valor) return '';
    return valor
      .toString()
      .replace(/[_-]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
      .join(' ');
  }

  function normalizarChave(valor, fallback) {
    if (!valor && fallback) {
      valor = fallback;
    }
    if (!valor) return '';
    return valor
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();
  }

  function normalizarCampo(campo, indice) {
    const chave = normalizarChave(campo?.nome || campo?.chave || campo?.id, `campo_${indice + 1}`);
    return {
      chave,
      titulo: campo?.label || campo?.titulo || formatarTitulo(campo?.nome || campo?.chave || campo?.id || chave),
      descricao: campo?.descricao || campo?.description || '',
      permitido: campo?.permitido ?? campo?.enabled ?? campo?.habilitado ?? campo?.valor ?? campo?.value ?? false,
    };
  }

  function normalizarModulo(modulo, indice) {
    const chave = normalizarChave(modulo?.modulo || modulo?.chave || modulo?.nome || modulo?.id, `modulo_${indice + 1}`);
    const titulo = modulo?.titulo || modulo?.label || modulo?.nome || formatarTitulo(chave);
    const descricao = modulo?.descricao || modulo?.description || '';
    const camposOrigem = Array.isArray(modulo?.campos)
      ? modulo.campos
      : Array.isArray(modulo?.acoes)
      ? modulo.acoes
      : Array.isArray(modulo?.permissoes)
      ? modulo.permissoes
      : [];
    const campos = camposOrigem.map((campo, idx) => normalizarCampo(campo, idx));
    return { chave, titulo, descricao, campos };
  }

  function clonarEstrutura(estrutura) {
    return estrutura.map((modulo) => ({
      ...modulo,
      campos: modulo.campos.map((campo) => ({ ...campo })),
    }));
  }

  function normalizarModelo(modelo, indice) {
    const permissoesOrigem = Array.isArray(modelo?.permissoes) ? modelo.permissoes : [];
    return {
      id: modelo?.id ?? modelo?.uuid ?? modelo?.codigo ?? modelo?.slug ?? `modelo_${indice + 1}`,
      nome: modelo?.nome || modelo?.titulo || modelo?.label || `Modelo ${indice + 1}`,
      descricao: modelo?.descricao || modelo?.detalhes || '',
      permissoes: permissoesOrigem.map((modulo, idx) => normalizarModulo(modulo, idx)),
    };
  }

  function extrairEstruturaBase(modelos) {
    const mapa = new Map();
    modelos.forEach((modelo) => {
      modelo.permissoes.forEach((modulo) => {
        if (!mapa.has(modulo.chave)) {
          mapa.set(modulo.chave, {
            chave: modulo.chave,
            titulo: modulo.titulo,
            descricao: modulo.descricao,
            campos: modulo.campos.map((campo) => ({
              ...campo,
              permitido: false,
            })),
          });
        } else {
          const existente = mapa.get(modulo.chave);
          modulo.campos.forEach((campo) => {
            if (!existente.campos.some((c) => c.chave === campo.chave)) {
              existente.campos.push({ ...campo, permitido: false });
            }
          });
        }
      });
    });
    return Array.from(mapa.values());
  }

  function aplicarModeloNaEstruturaBase(permissoes) {
    const base = clonarEstrutura(state.estruturaBase.length ? state.estruturaBase : permissoes);
    const mapaModulos = new Map(permissoes.map((modulo) => [modulo.chave, modulo]));
    base.forEach((modulo) => {
      const selecionado = mapaModulos.get(modulo.chave);
      if (!selecionado) return;
      const mapaCampos = new Map(selecionado.campos.map((campo) => [campo.chave, campo]));
      modulo.campos.forEach((campo) => {
        if (mapaCampos.has(campo.chave)) {
          campo.permitido = Boolean(mapaCampos.get(campo.chave)?.permitido);
        }
      });
    });

    permissoes.forEach((modulo) => {
      if (!base.some((item) => item.chave === modulo.chave)) {
        base.push({
          chave: modulo.chave,
          titulo: modulo.titulo,
          descricao: modulo.descricao,
          campos: modulo.campos.map((campo) => ({ ...campo })),
        });
      }
    });

    return base;
  }

  function criarEstadoAPartirDaEstrutura() {
    if (!state.estruturaBase.length) return [];
    return clonarEstrutura(state.estruturaBase);
  }

  function limparMensagem() {
    if (!elementos.mensagem) return;
    elementos.mensagem.textContent = '';
    elementos.mensagem.classList.add('hidden');
    elementos.mensagem.classList.remove('modelo-permissoes-mensagem--erro', 'modelo-permissoes-mensagem--sucesso');
  }

  function exibirMensagem(tipo, texto) {
    if (!elementos.mensagem) return;
    elementos.mensagem.textContent = texto;
    elementos.mensagem.classList.remove('hidden', 'modelo-permissoes-mensagem--erro', 'modelo-permissoes-mensagem--sucesso');
    elementos.mensagem.classList.add(tipo === 'erro' ? 'modelo-permissoes-mensagem--erro' : 'modelo-permissoes-mensagem--sucesso');
  }

  function definirLoading(botao, carregando) {
    if (!botao) return;
    botao.disabled = carregando;
    botao.classList.toggle('btn-loading', carregando);
  }

  function atualizarBadge() {
    if (!elementos.statusBadge) return;
    elementos.statusBadge.classList.remove('modelo-permissoes-status--novo', 'modelo-permissoes-status--editando');
    if (state.modoNovo) {
      elementos.statusBadge.textContent = 'Novo Modelo';
      elementos.statusBadge.classList.remove('hidden');
      elementos.statusBadge.classList.add('modelo-permissoes-status--novo');
    } else if (state.modeloAtual) {
      elementos.statusBadge.textContent = 'Editando';
      elementos.statusBadge.classList.remove('hidden');
      elementos.statusBadge.classList.add('modelo-permissoes-status--editando');
    } else {
      elementos.statusBadge.textContent = '';
      elementos.statusBadge.classList.add('hidden');
    }
  }

  function atualizarBotaoNovo() {
    if (!elementos.novoBtn) return;
    elementos.novoBtn.textContent = state.modoNovo ? 'Cancelar novo' : 'Novo modelo';
  }

  function alternarModoNovo(ativo) {
    state.modoNovo = ativo;
    if (state.modoNovo) {
      if (state.modeloAtual?.id) {
        state.ultimoModeloSelecionado = state.modeloAtual.id;
      }
      elementos.select?.classList.add('hidden');
      elementos.nomeInput?.classList.remove('hidden');
      elementos.nomeInput.value = '';
      elementos.excluirBtn?.classList.add('hidden');
      if (elementos.select) {
        elementos.select.value = '';
      }
      state.modeloAtual = null;
      state.permissoes = criarEstadoAPartirDaEstrutura();
      renderPermissoes();
    } else {
      elementos.select?.classList.remove('hidden');
      elementos.nomeInput?.classList.add('hidden');
      elementos.nomeInput.value = '';
      elementos.excluirBtn?.classList.toggle('hidden', !state.modeloAtual);
      if (state.modeloAtual) {
        state.permissoes = aplicarModeloNaEstruturaBase(state.modeloAtual.permissoes);
      } else {
        state.permissoes = [];
      }
      renderPermissoes();
    }
    atualizarBadge();
    atualizarBotaoNovo();
    limparMensagem();
  }

  function atualizarResumoModulo(moduloEl, moduloState) {
    if (!moduloEl) return;
    const contadorEl = moduloEl.querySelector('.modelo-permissoes-modulo__contador');
    if (!contadorEl) return;
    const total = moduloState.campos.length;
    const ativos = moduloState.campos.filter((campo) => campo.permitido).length;
    contadorEl.textContent = `${ativos}/${total} ativas`;
  }

  function renderPermissoes() {
    if (!elementos.container) return;
    elementos.container.innerHTML = '';
    if (!Array.isArray(state.permissoes) || state.permissoes.length === 0) {
      elementos.container.classList.add('hidden');
      elementos.empty?.classList.remove('hidden');
      return;
    }

    elementos.container.classList.remove('hidden');
    elementos.empty?.classList.add('hidden');

    state.permissoes.forEach((modulo, moduloIndex) => {
      if (!templates.modulo?.content?.firstElementChild) return;
      const moduloEl = templates.modulo.content.firstElementChild.cloneNode(true);
      moduloEl.dataset.modulo = modulo.chave;
      moduloEl.querySelector('.modelo-permissoes-modulo__titulo').textContent = modulo.titulo;
      const descricaoEl = moduloEl.querySelector('.modelo-permissoes-modulo__descricao');
      if (modulo.descricao) {
        descricaoEl.textContent = modulo.descricao;
        descricaoEl.classList.remove('hidden');
      } else {
        descricaoEl.textContent = '';
        descricaoEl.classList.add('hidden');
      }

      const lista = moduloEl.querySelector('.modelo-permissoes-lista');
      lista.innerHTML = '';
      modulo.campos.forEach((campo, campoIndex) => {
        if (!templates.acao?.content?.firstElementChild) return;
        const campoEl = templates.acao.content.firstElementChild.cloneNode(true);
        campoEl.dataset.campo = campo.chave;
        campoEl.dataset.moduloIndex = String(moduloIndex);
        campoEl.dataset.campoIndex = String(campoIndex);
        const checkbox = campoEl.querySelector('.modelo-permissoes-acao__checkbox');
        checkbox.checked = Boolean(campo.permitido);
        checkbox.dataset.moduloIndex = String(moduloIndex);
        checkbox.dataset.campoIndex = String(campoIndex);
        campoEl.querySelector('.modelo-permissoes-acao__titulo').textContent = campo.titulo;
        const descricaoCampoEl = campoEl.querySelector('.modelo-permissoes-acao__descricao');
        if (campo.descricao) {
          descricaoCampoEl.textContent = campo.descricao;
          descricaoCampoEl.classList.remove('hidden');
        } else {
          descricaoCampoEl.textContent = '';
          descricaoCampoEl.classList.add('hidden');
        }
        lista.appendChild(campoEl);
      });

      const toggleTodos = moduloEl.querySelector('.modelo-permissoes-toggle-todos');
      toggleTodos.dataset.moduloIndex = String(moduloIndex);
      toggleTodos.addEventListener('click', () => {
        const moduloState = state.permissoes[moduloIndex];
        if (!moduloState) return;
        const deveAtivarTodos = moduloState.campos.some((campo) => !campo.permitido);
        moduloState.campos.forEach((campo) => {
          campo.permitido = deveAtivarTodos;
        });
        renderPermissoes();
      });

      atualizarResumoModulo(moduloEl, modulo);
      elementos.container.appendChild(moduloEl);
    });

    aplicarFiltroBusca();
  }

  function aplicarFiltroBusca() {
    if (!elementos.busca) return;
    const termo = elementos.busca.value?.trim().toLowerCase() || '';
    if (!termo) {
      elementos.container?.querySelectorAll('.modelo-permissoes-modulo').forEach((moduloEl) => {
        moduloEl.classList.remove('hidden');
      });
      return;
    }

    elementos.container?.querySelectorAll('.modelo-permissoes-modulo').forEach((moduloEl) => {
      const titulo = moduloEl.querySelector('.modelo-permissoes-modulo__titulo')?.textContent?.toLowerCase() || '';
      const descricao = moduloEl.querySelector('.modelo-permissoes-modulo__descricao')?.textContent?.toLowerCase() || '';
      const camposTexto = Array.from(moduloEl.querySelectorAll('.modelo-permissoes-acao__titulo, .modelo-permissoes-acao__descricao'))
        .map((el) => el.textContent?.toLowerCase() || '')
        .join(' ');
      const deveMostrar = [titulo, descricao, camposTexto].some((texto) => texto.includes(termo));
      moduloEl.classList.toggle('hidden', !deveMostrar);
    });
  }

  elementos.busca?.addEventListener('input', aplicarFiltroBusca);

  overlay.addEventListener('change', (event) => {
    const target = event.target;
    if (!target?.classList?.contains('modelo-permissoes-acao__checkbox')) return;
    const moduloIndex = Number(target.dataset.moduloIndex);
    const campoIndex = Number(target.dataset.campoIndex);
    if (!Number.isFinite(moduloIndex) || !Number.isFinite(campoIndex)) return;
    const modulo = state.permissoes[moduloIndex];
    if (!modulo) return;
    const campo = modulo.campos[campoIndex];
    if (!campo) return;
    campo.permitido = target.checked;
    const moduloEl = elementos.container?.querySelector(`.modelo-permissoes-modulo[data-modulo="${modulo.chave}"]`);
    atualizarResumoModulo(moduloEl, modulo);
  });

  function renderListaModelos() {
    if (!elementos.select) return;
    const valorAtual = elementos.select.value;
    elementos.select.innerHTML = '<option value="">Selecione um modelo</option>';
    state.modelos.forEach((modelo) => {
      const option = document.createElement('option');
      option.value = String(modelo.id);
      option.textContent = modelo.nome;
      if (valorAtual && String(modelo.id) === valorAtual) {
        option.selected = true;
      }
      elementos.select.appendChild(option);
    });
  }

  async function carregarEstruturaBaseSeNecessario() {
    if (state.estruturaBase.length) {
      state.estruturaBase = clonarEstrutura(state.estruturaBase.map((modulo, idx) => normalizarModulo(modulo, idx)));
      return;
    }
    try {
      const resp = await fetchApi('/api/usuarios/permissoes/estrutura');
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) {
          state.estruturaBase = data.map((modulo, idx) => {
            const normalizado = normalizarModulo(modulo, idx);
            normalizado.campos.forEach((campo) => {
              campo.permitido = false;
            });
            return normalizado;
          });
          return;
        }
        if (Array.isArray(data?.estrutura)) {
          state.estruturaBase = data.estrutura.map((modulo, idx) => {
            const normalizado = normalizarModulo(modulo, idx);
            normalizado.campos.forEach((campo) => {
              campo.permitido = false;
            });
            return normalizado;
          });
          return;
        }
      }
    } catch (err) {
      console.warn('Não foi possível carregar a estrutura base de permissões', err);
    }
  }

  async function carregarModelosDisponiveis() {
    state.carregando = true;
    definirLoading(elementos.carregarBtn, true);
    try {
      const resp = await fetchApi('/api/usuarios/modelos-permissoes');
      if (!resp.ok) {
        throw new Error('Não foi possível carregar os modelos de permissão.');
      }
      const data = await resp.json();
      const lista = Array.isArray(data?.modelos) ? data.modelos : Array.isArray(data) ? data : [];
      state.modelos = lista.map((modelo, idx) => normalizarModelo(modelo, idx));

      if (!state.estruturaBase.length) {
        const baseRemota = Array.isArray(data?.estrutura) ? data.estrutura : [];
        if (baseRemota.length) {
          state.estruturaBase = baseRemota.map((modulo, idx) => {
            const normalizado = normalizarModulo(modulo, idx);
            normalizado.campos.forEach((campo) => {
              campo.permitido = false;
            });
            return normalizado;
          });
        }
      }

      if (!state.estruturaBase.length) {
        state.estruturaBase = extrairEstruturaBase(state.modelos);
      }

      if (!state.estruturaBase.length) {
        await carregarEstruturaBaseSeNecessario();
      }

      renderListaModelos();

      if (!state.modelos.length) {
        alternarModoNovo(true);
      } else {
        alternarModoNovo(false);
      }
    } catch (err) {
      console.error(err);
      exibirMensagem('erro', err.message || 'Erro ao carregar modelos de permissão.');
    } finally {
      state.carregando = false;
      definirLoading(elementos.carregarBtn, false);
    }
  }

  function selecionarModeloPorId(id) {
    const modelo = state.modelos.find((item) => String(item.id) === String(id));
    if (!modelo) {
      exibirMensagem('erro', 'Modelo não encontrado.');
      return;
    }
    state.modeloAtual = modelo;
    state.ultimoModeloSelecionado = modelo.id;
    state.permissoes = aplicarModeloNaEstruturaBase(modelo.permissoes);
    alternarModoNovo(false);
    elementos.excluirBtn?.classList.remove('hidden');
    atualizarBadge();
    renderPermissoes();
    limparMensagem();
  }

  elementos.carregarBtn?.addEventListener('click', () => {
    if (!elementos.select?.value) {
      exibirMensagem('erro', 'Selecione um modelo para carregar.');
      return;
    }
    selecionarModeloPorId(elementos.select.value);
  });

  elementos.select?.addEventListener('change', () => {
    limparMensagem();
    if (!elementos.select.value) {
      state.modeloAtual = null;
      state.permissoes = [];
      renderPermissoes();
      elementos.excluirBtn?.classList.add('hidden');
      atualizarBadge();
      return;
    }
    selecionarModeloPorId(elementos.select.value);
  });

  elementos.novoBtn?.addEventListener('click', async () => {
    if (!state.modoNovo) {
      if (!state.estruturaBase.length) {
        await carregarEstruturaBaseSeNecessario();
      }
      alternarModoNovo(true);
    } else {
      alternarModoNovo(false);
      if (state.ultimoModeloSelecionado) {
        elementos.select.value = String(state.ultimoModeloSelecionado);
        selecionarModeloPorId(state.ultimoModeloSelecionado);
      }
    }
  });

  async function salvarModelo() {
    limparMensagem();
    if (!Array.isArray(state.permissoes) || !state.permissoes.length) {
      exibirMensagem('erro', 'Nenhuma permissão disponível para salvar.');
      return;
    }

    const payload = {
      nome: '',
      permissoes: state.permissoes.map((modulo) => ({
        modulo: modulo.chave,
        titulo: modulo.titulo,
        descricao: modulo.descricao,
        campos: modulo.campos.map((campo) => ({
          nome: campo.chave,
          titulo: campo.titulo,
          descricao: campo.descricao,
          permitido: Boolean(campo.permitido),
        })),
      })),
    };

    let metodo = 'PUT';
    let url = `/api/usuarios/modelos-permissoes/${encodeURIComponent(state.modeloAtual?.id)}`;

    if (state.modoNovo || !state.modeloAtual) {
      const nome = elementos.nomeInput?.value?.trim();
      if (!nome) {
        exibirMensagem('erro', 'Informe um nome para o novo modelo.');
        elementos.nomeInput?.focus();
        return;
      }
      const nomeExiste = state.modelos.some((modelo) => modelo.nome.toLowerCase() === nome.toLowerCase());
      if (nomeExiste) {
        exibirMensagem('erro', 'Já existe um modelo com este nome. Escolha outro.');
        elementos.nomeInput?.focus();
        return;
      }
      payload.nome = nome;
      metodo = 'POST';
      url = '/api/usuarios/modelos-permissoes';
    } else {
      payload.nome = state.modeloAtual?.nome || '';
    }

    definirLoading(elementos.salvarBtn, true);
    try {
      const resp = await fetchApi(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const texto = await resp.text();
        throw new Error(texto || 'Falha ao salvar o modelo de permissões.');
      }
      const salvo = await resp.json();
      const normalizado = normalizarModelo(salvo, state.modelos.length);
      if (metodo === 'POST') {
        state.modelos.push(normalizado);
        state.modeloAtual = normalizado;
        state.modoNovo = false;
      } else {
        const idx = state.modelos.findIndex((modelo) => String(modelo.id) === String(normalizado.id));
        if (idx !== -1) {
          state.modelos[idx] = normalizado;
        }
        state.modeloAtual = normalizado;
      }
      renderListaModelos();
      if (state.modeloAtual) {
        elementos.select.value = String(state.modeloAtual.id);
        state.permissoes = aplicarModeloNaEstruturaBase(state.modeloAtual.permissoes);
        renderPermissoes();
      }
      alternarModoNovo(false);
      exibirMensagem('sucesso', 'Modelo salvo com sucesso.');
      window.dispatchEvent(new CustomEvent('usuariosModeloPermissaoAtualizado', {
        detail: { refresh: true, modeloId: state.modeloAtual?.id },
      }));
      setTimeout(() => close(), 600);
    } catch (err) {
      console.error(err);
      exibirMensagem('erro', err.message || 'Não foi possível salvar o modelo.');
    } finally {
      definirLoading(elementos.salvarBtn, false);
    }
  }

  async function excluirModelo() {
    if (!state.modeloAtual) return;
    const confirmou = window.confirm('Deseja realmente excluir este modelo? Esta ação não pode ser desfeita.');
    if (!confirmou) return;

    definirLoading(elementos.excluirBtn, true);
    try {
      const resp = await fetchApi(`/api/usuarios/modelos-permissoes/${encodeURIComponent(state.modeloAtual.id)}`, {
        method: 'DELETE',
      });
      if (!resp.ok) {
        const texto = await resp.text();
        throw new Error(texto || 'Não foi possível excluir o modelo.');
      }
      state.modelos = state.modelos.filter((modelo) => String(modelo.id) !== String(state.modeloAtual?.id));
      renderListaModelos();
      state.modeloAtual = null;
      state.permissoes = [];
      elementos.select.value = '';
      renderPermissoes();
      alternarModoNovo(true);
      exibirMensagem('sucesso', 'Modelo excluído com sucesso.');
      window.dispatchEvent(new CustomEvent('usuariosModeloPermissaoAtualizado', {
        detail: { refresh: true, modeloId: null },
      }));
      setTimeout(() => close(), 500);
    } catch (err) {
      console.error(err);
      exibirMensagem('erro', err.message || 'Não foi possível excluir o modelo.');
    } finally {
      definirLoading(elementos.excluirBtn, false);
    }
  }

  elementos.salvarBtn?.addEventListener('click', salvarModelo);
  elementos.excluirBtn?.addEventListener('click', excluirModelo);

  await carregarEstruturaBaseSeNecessario();
  await carregarModelosDisponiveis();
})();
