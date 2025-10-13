(async function () {
  const overlay = document.getElementById('editarUsuarioOverlay');
  if (!overlay) return;

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const close = () => {
    document.removeEventListener('keydown', onEscKey);
    Modal.close('editarUsuario');
    delete window.usuarioEditar;
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

  const voltarBtn = document.getElementById('voltarEditarUsuario');
  voltarBtn?.addEventListener('click', close);
  document.getElementById('cancelarEditarUsuario')?.addEventListener('click', close);
  document.addEventListener('keydown', onEscKey);

  const usuarioBase = window.usuarioEditar || null;
  const contexto = window.usuarioEditarContext || {};
  delete window.usuarioEditarContext;

  if (!usuarioBase || !usuarioBase.id) {
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'editarUsuario' }));
    console.error('Contexto de edição inválido.');
    return;
  }

  const podeEditarDados = contexto.podeEditarDados !== false;
  const podeGerenciarPermissoes = contexto.podeGerenciarPermissoes === true;
  const deveMostrarPermissoes = usuarioBase.perfil === 'Sup Admin';

  const tabTemplate = overlay.querySelector('#usuarioPermissoesTabTemplate');
  if (deveMostrarPermissoes && tabTemplate?.content?.firstElementChild) {
    const permissoesTab = tabTemplate.content.firstElementChild.cloneNode(true);
    tabTemplate.replaceWith(permissoesTab);
  } else {
    tabTemplate?.remove();
  }

  const panelTemplate = overlay.querySelector('#usuarioPermissoesPanelTemplate');
  let permissoesPanel = null;
  if (deveMostrarPermissoes && panelTemplate?.content?.firstElementChild) {
    permissoesPanel = panelTemplate.content.firstElementChild.cloneNode(true);
    panelTemplate.replaceWith(permissoesPanel);
  } else {
    panelTemplate?.remove();
  }

  const tabs = Array.from(overlay.querySelectorAll('[role="tab"]'));
  const panels = Array.from(overlay.querySelectorAll('[role="tabpanel"]'));

  function activateTab(targetTab, { setFocus = true } = {}) {
    tabs.forEach((tab) => {
      const isActive = tab === targetTab;
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
      tab.classList.toggle('usuario-modal-tab--active', isActive);
    });

    panels.forEach((panel) => {
      const controls = panel.getAttribute('aria-labelledby');
      const associated = targetTab.id === controls;
      panel.classList.toggle('hidden', !associated);
    });

    if (setFocus) {
      targetTab.focus();
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      activateTab(tab);
    });
  });

  const tablist = overlay.querySelector('.usuario-modal-tablist');
  tablist?.addEventListener('keydown', (event) => {
    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
    if (currentIndex === -1) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = (currentIndex + 1) % tabs.length;
      activateTab(tabs[next]);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
      activateTab(tabs[next]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      activateTab(tabs[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      activateTab(tabs[tabs.length - 1]);
    }
  });

  if (tabs.length > 0) {
    activateTab(tabs[0], { setFocus: false });
  }

  const inputs = {
    nome: document.getElementById('usuarioNome'),
    email: document.getElementById('usuarioEmail'),
    telefone: document.getElementById('usuarioTelefone'),
    perfil: document.getElementById('usuarioPerfil'),
    status: document.getElementById('usuarioStatus'),
    observacoes: document.getElementById('usuarioObservacoes'),
  };

  if (!podeEditarDados) {
    Object.values(inputs).forEach((input) => {
      if (!input) return;
      input.setAttribute('disabled', 'disabled');
      input.classList.add('usuario-campo-readonly');
    });
  }

  const mensagemEl = document.getElementById('usuarioEditarMensagem');

  function exibirMensagem(tipo, texto) {
    if (!mensagemEl) return;
    mensagemEl.textContent = texto;
    mensagemEl.classList.remove('hidden', 'usuario-mensagem-erro', 'usuario-mensagem-sucesso');
    mensagemEl.classList.add(tipo === 'erro' ? 'usuario-mensagem-erro' : 'usuario-mensagem-sucesso');
  }

  function limparMensagem() {
    mensagemEl?.classList.add('hidden');
  }

  const salvarBtn = document.getElementById('salvarEditarUsuario');
  if (!podeEditarDados && !podeGerenciarPermissoes) {
    salvarBtn?.setAttribute('disabled', 'disabled');
  }

  let permissoesState = [];

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

  function normalizarAcoes(acoes) {
    if (!acoes) return [];
    if (Array.isArray(acoes)) {
      return acoes
        .map((acao, index) => {
          if (typeof acao === 'string') {
            const chaveBruta = acao.trim();
            const chave = (chaveBruta || `acao_${index + 1}`)
              .toString()
              .trim()
              .replace(/\s+/g, '_');
            return {
              nome: chave,
              label: formatarTitulo(chave),
              permitido: true,
            };
          }
          if (acao && typeof acao === 'object') {
            const permitido = acao.permitido ?? acao.enabled ?? acao.habilitado ?? acao.valor ?? acao.value ?? false;
            const chaveBase = acao.nome || acao.acao || acao.id || acao.chave || '';
            const fallback = (acao.label || acao.rotulo || `acao_${index + 1}`)
              .toString()
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/gi, '_')
              .replace(/^_+|_+$/g, '');
            const chave = (chaveBase || fallback || `acao_${index + 1}`)
              .toString()
              .trim()
              .replace(/\s+/g, '_');
            return {
              nome: chave,
              label: acao.label || acao.rotulo || formatarTitulo(chave),
              permitido: Boolean(permitido),
            };
          }
          return null;
        })
        .filter(Boolean);
    }
    if (typeof acoes === 'object') {
      return Object.entries(acoes).map(([nome, valor], index) => {
        const permitido = typeof valor === 'object'
          ? valor.permitido ?? valor.enabled ?? valor.habilitado ?? valor.valor ?? valor.value ?? false
          : valor;
        const chave = nome
          .toString()
          .trim()
          .replace(/\s+/g, '_')
          .replace(/^_+|_+$/g, '') || `acao_${Math.max(index + 1, 1)}`;
        const fonteRotulo = typeof valor === 'object' && valor !== null
          ? valor.label || valor.rotulo
          : undefined;
        return {
          nome: chave,
          label: formatarTitulo(fonteRotulo || nome),
          permitido: Boolean(permitido),
        };
      });
    }
    return [];
  }

  function normalizarPermissoes(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw
        .map((item, index) => {
          if (!item) return null;
          const modulo = item.modulo || item.nome || item.id || `Modulo_${index + 1}`;
          const label = item.rotulo || item.label || formatarTitulo(modulo);
          const acoes = normalizarAcoes(item.acoes || item.permissoes || item.actions);
          return { modulo, label, acoes };
        })
        .filter((item) => item && item.acoes.length);
    }
    if (typeof raw === 'object') {
      return Object.entries(raw)
        .map(([modulo, valor]) => {
          const acoes = normalizarAcoes(valor);
          return { modulo, label: formatarTitulo(modulo), acoes };
        })
        .filter((item) => item.acoes.length);
    }
    return [];
  }

  function formatarDataHora(valor) {
    if (!valor) return '';
    const data = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(data.getTime())) return '';
    return data.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function normalizarStatusInterno(valor) {
    if (!valor) return '';
    const normalizado = String(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();

    const mapa = {
      ativo: 'ativo',
      active: 'ativo',
      aguardando: 'aguardando_aprovacao',
      aguardando_aprovacao: 'aguardando_aprovacao',
      inativo: 'aguardando_aprovacao',
      pendente: 'aguardando_aprovacao',
      pending: 'aguardando_aprovacao',
      naoconfirmado: 'nao_confirmado',
      nao_confirmado: 'nao_confirmado',
      nao_confirmada: 'nao_confirmado',
      unconfirmed: 'nao_confirmado',
      aguardando_confirmacao: 'nao_confirmado'
    };

    return mapa[normalizado] || normalizado;
  }

  function derivarStatus(usuario) {
    if (!usuario) return 'Aguardando';

    if (typeof usuario.statusInterno === 'string' && usuario.statusInterno.trim()) {
      const interno = normalizarStatusInterno(usuario.statusInterno);
      if (interno === 'ativo') return 'Ativo';
      if (interno === 'nao_confirmado') return 'Não confirmado';
      if (interno === 'aguardando_aprovacao') return 'Inativo';
    }

    if (typeof usuario.status === 'string' && usuario.status.trim()) {
      const normalizado = normalizarStatusInterno(usuario.status);
      if (normalizado === 'ativo') return 'Ativo';
      if (normalizado === 'nao_confirmado') return 'Não confirmado';
      if (normalizado === 'aguardando_aprovacao') return 'Inativo';
      return formatarTitulo(usuario.status.trim());
    }

    if (typeof usuario.verificado === 'boolean') {
      if (usuario.verificado) return 'Ativo';
      if (usuario.emailConfirmado || usuario.email_confirmado) return 'Inativo';
      return 'Não confirmado';
    }

    return 'Aguardando';
  }

  function atualizarBadge(status) {
    const badge = document.getElementById('usuarioEditarStatusBadge');
    if (!badge) return;
    const mapa = {
      Ativo: 'badge-success',
      Inativo: 'badge-danger',
      'Não confirmado': 'badge-warning',
      Aguardando: 'badge-warning',
    };
    badge.className = `text-xs px-3 py-1 rounded-full uppercase tracking-wide ${mapa[status] || 'badge-primary'}`;
    badge.textContent = status;
    badge.classList.remove('hidden');
  }

  function preencherDadosBasicos(usuario) {
    const titulo = document.getElementById('usuarioEditarTitulo');
    if (titulo) {
      titulo.textContent = usuario.nome ? `Editar – ${usuario.nome}` : 'Editar usuário';
    }

    if (inputs.nome) inputs.nome.value = usuario.nome || '';
    if (inputs.email) inputs.email.value = usuario.email || '';
    if (inputs.telefone) inputs.telefone.value = usuario.telefone || usuario.celular || usuario.fone || '';
    if (inputs.perfil) inputs.perfil.value = usuario.perfil || '';
    if (inputs.status) inputs.status.value = derivarStatus(usuario);
    if (inputs.observacoes) inputs.observacoes.value = usuario.observacoes || usuario.notas || '';

    const avatar = document.getElementById('usuarioAvatar');
    if (avatar) {
      const origem = usuario.nome || usuario.email || '';
      const iniciais = origem
        .split(' ')
        .filter(Boolean)
        .map((parte) => parte[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
      avatar.textContent = iniciais || 'US';
    }

    const ultimaAtividade = usuario.ultima_atividade_em || usuario.ultimaAtividadeEm || usuario.ultimaAtividade;
    const ultimaAtividadeEl = document.getElementById('usuarioUltimaAtividade');
    if (ultimaAtividadeEl) {
      const formatado = formatarDataHora(ultimaAtividade);
      ultimaAtividadeEl.textContent = formatado ? `Última atividade: ${formatado}` : 'Sem registro de atividade';
    }

    const perfilEl = document.getElementById('usuarioPerfilAtual');
    if (perfilEl) {
      perfilEl.textContent = usuario.perfil ? `Perfil atual: ${usuario.perfil}` : 'Perfil não informado';
    }

    atualizarBadge(derivarStatus(usuario));
  }

  function renderPermissoes() {
    if (!permissoesPanel) return;
    const container = permissoesPanel.querySelector('#usuarioPermissoesContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!permissoesState.length) {
      const vazio = document.createElement('p');
      vazio.className = 'usuario-permissoes-empty';
      vazio.textContent = 'Nenhuma permissão configurada para este usuário.';
      container.appendChild(vazio);
      return;
    }

    permissoesState.forEach((modulo, moduloIndex) => {
      const card = document.createElement('article');
      card.className = 'usuario-permissao-card';

      const header = document.createElement('div');
      header.className = 'usuario-permissao-card__header';
      header.innerHTML = `<h4 class="usuario-permissao-card__titulo">${modulo.label}</h4>`;
      card.appendChild(header);

      const acoesWrapper = document.createElement('div');
      acoesWrapper.className = 'usuario-permissao-card__acoes';

      modulo.acoes.forEach((acao, acaoIndex) => {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'usuario-permissao-toggle';
        toggle.dataset.moduloIndex = String(moduloIndex);
        toggle.dataset.acaoIndex = String(acaoIndex);
        toggle.setAttribute('aria-pressed', acao.permitido ? 'true' : 'false');
        if (!podeGerenciarPermissoes) {
          toggle.setAttribute('disabled', 'disabled');
          toggle.classList.add('usuario-permissao-toggle--disabled');
        }
        toggle.innerHTML = `
          <span class="usuario-permissao-toggle__label">${acao.label}</span>
          <span class="usuario-permissao-toggle__pill" aria-hidden="true">
            <span class="usuario-permissao-toggle__knob"></span>
          </span>
        `;
        toggle.classList.toggle('usuario-permissao-toggle--on', acao.permitido);
        toggle.addEventListener('click', () => {
          const pressed = toggle.getAttribute('aria-pressed') === 'true';
          const novo = !pressed;
          toggle.setAttribute('aria-pressed', novo ? 'true' : 'false');
          toggle.classList.toggle('usuario-permissao-toggle--on', novo);
          permissoesState[moduloIndex].acoes[acaoIndex].permitido = novo;
        });
        acoesWrapper.appendChild(toggle);
      });

      card.appendChild(acoesWrapper);
      container.appendChild(card);
    });
  }

  function montarPermissoes(rawPermissoes) {
    permissoesState = normalizarPermissoes(rawPermissoes);
    renderPermissoes();
  }

  function coletarDadosFormulario() {
    return {
      nome: inputs.nome?.value || '',
      email: inputs.email?.value || '',
      telefone: inputs.telefone?.value || '',
      perfil: inputs.perfil?.value || '',
      status: inputs.status?.value || '',
      observacoes: inputs.observacoes?.value || '',
    };
  }

  function coletarPermissoesPayload() {
    return permissoesState.map((modulo) => ({
      modulo: modulo.modulo,
      permissoes: modulo.acoes.reduce((acc, acao) => {
        acc[acao.nome] = acao.permitido;
        return acc;
      }, {}),
    }));
  }

  async function salvarAlteracoes() {
    if (!salvarBtn || salvarBtn.disabled) return;
    limparMensagem();

    try {
      salvarBtn.disabled = true;
      salvarBtn.classList.add('btn-loading');
      const respostas = [];

      if (podeEditarDados) {
        const payloadDados = coletarDadosFormulario();
        const respDados = await fetchApi(`/api/usuarios/${usuarioBase.id}/dados`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadDados),
        });
        if (!respDados.ok) {
          const texto = await respDados.text();
          throw new Error(texto || 'Não foi possível salvar os dados pessoais.');
        }
        respostas.push(await respDados.json());
      }

      if (deveMostrarPermissoes && podeGerenciarPermissoes) {
        const respPerm = await fetchApi(`/api/usuarios/${usuarioBase.id}/permissoes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissoes: coletarPermissoesPayload() }),
        });
        if (!respPerm.ok) {
          const texto = await respPerm.text();
          throw new Error(texto || 'Não foi possível salvar as permissões.');
        }
        respostas.push(await respPerm.json());
      }

      exibirMensagem('sucesso', 'Alterações salvas com sucesso!');
      window.dispatchEvent(new CustomEvent('usuarioAtualizado', { detail: { id: usuarioBase.id, respostas } }));
      setTimeout(close, 300);
    } catch (err) {
      console.error('Erro ao salvar usuário:', err);
      exibirMensagem('erro', err.message || 'Falha ao salvar as alterações.');
    } finally {
      salvarBtn.disabled = false;
      salvarBtn.classList.remove('btn-loading');
    }
  }

  salvarBtn?.addEventListener('click', salvarAlteracoes);

  async function carregarDetalhes() {
    try {
      const resp = await fetchApi(`/api/usuarios/${usuarioBase.id}`);
      if (!resp.ok) {
        const texto = await resp.text();
        throw new Error(texto || 'Não foi possível carregar os dados do usuário.');
      }
      const data = await resp.json();
      const usuario = data.usuario || data;
      preencherDadosBasicos(usuario);
      if (deveMostrarPermissoes && podeGerenciarPermissoes) {
        const permissoes = data.permissoes || usuario.permissoes || usuario['permissões'] || usuario.permissions;
        montarPermissoes(permissoes);
      } else if (deveMostrarPermissoes) {
        const permissoes = data.permissoes || usuario.permissoes || usuario['permissões'] || usuario.permissions;
        permissoesState = normalizarPermissoes(permissoes);
        renderPermissoes();
      }
    } catch (err) {
      console.error('Erro ao carregar usuário:', err);
      exibirMensagem('erro', err.message || 'Falha ao carregar dados do usuário.');
    } finally {
      window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'editarUsuario' }));
    }
  }

  carregarDetalhes();
})();
