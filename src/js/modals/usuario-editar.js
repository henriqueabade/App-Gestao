(async function () {
  const overlay = document.getElementById('editarUsuarioOverlay');
  if (!overlay) return;

  const normalizarValorVersao = valor => {
    if (valor === null || valor === undefined) return null;
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
      return String(valor.getTime());
    }
    if (typeof valor === 'number' && Number.isFinite(valor)) {
      return String(Math.trunc(valor));
    }
    if (typeof valor === 'string') {
      const trimmed = valor.trim();
      if (!trimmed) return null;
      if (/^\d+$/.test(trimmed)) {
        return trimmed;
      }
      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) {
        return String(parsed);
      }
    }
    return null;
  };

  const extrairAvatarVersao = usuario => {
    if (!usuario || typeof usuario !== 'object') return null;
    const candidatos = [
      usuario.avatar_version,
      usuario.avatarVersion,
      usuario.avatar_updated_at,
      usuario.avatarUpdatedAt,
      usuario.atualizadoEm,
      usuario.atualizado_em,
      usuario.updatedAt,
      usuario.updated_at,
      usuario.ultimaAlteracaoEm,
      usuario.ultima_alteracao_em,
      usuario.ultimaAlteracao,
      usuario.ultima_alteracao
    ];
    for (const candidato of candidatos) {
      const normalizado = normalizarValorVersao(candidato);
      if (normalizado) {
        return normalizado;
      }
    }
    return null;
  };

  const aplicarCacheBuster = (url, versao) => {
    if (!url || !versao) return url;
    if (typeof url !== 'string') return url;
    if (/^data:/i.test(url)) return url;

    const [base, fragmento] = url.split('#', 2);
    const encoded = encodeURIComponent(versao);
    let atualizado = base;

    if (/(?:^|[?&])t=/.test(base)) {
      atualizado = base.replace(/([?&])t=[^&]*/, `$1t=${encoded}`);
    } else {
      const separador = base.includes('?') ? '&' : '?';
      atualizado = `${base}${separador}t=${encoded}`;
    }

    return fragmento !== undefined ? `${atualizado}#${fragmento}` : atualizado;
  };

  const obterAvatarUrl = usuario => {
    if (!usuario || typeof usuario !== 'object') return null;
    const candidatos = [
      usuario.avatar_url,
      usuario.avatarUrl,
      usuario.fotoUrl,
      usuario.foto,
      usuario.fotoUsuario,
      usuario.foto_usuario,
      usuario.avatar
    ];

    const isUrlPermitida = valor => /^(?:https?|blob|file):/i.test(valor) || valor.startsWith('/');
    const versao = extrairAvatarVersao(usuario);

    for (const candidato of candidatos) {
      if (!candidato || typeof candidato !== 'string') continue;
      const trimmed = candidato.trim();
      if (!trimmed) continue;
      if (/^data:image\//i.test(trimmed) || isUrlPermitida(trimmed)) {
        return aplicarCacheBuster(trimmed, versao);
      }
      const base64Regex = /^[A-Za-z0-9+/=\s]+$/;
      if (base64Regex.test(trimmed)) {
        const sanitized = trimmed.replace(/\s+/g, '');
        if (sanitized) {
          return `data:image/png;base64,${sanitized}`;
        }
      }
    }

    return null;
  };

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
  if (!podeEditarDados) {
    salvarBtn?.setAttribute('disabled', 'disabled');
  }

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

    const confirmacaoOrigem = Object.prototype.hasOwnProperty.call(usuario, 'confirmacao')
      ? usuario.confirmacao
      : Object.prototype.hasOwnProperty.call(usuario, 'emailConfirmado')
        ? usuario.emailConfirmado
        : usuario.email_confirmado;
    const confirmacao = (() => {
      if (typeof confirmacaoOrigem === 'boolean') return confirmacaoOrigem;
      if (typeof confirmacaoOrigem === 'number') {
        return Number.isFinite(confirmacaoOrigem) && confirmacaoOrigem !== 0;
      }
      if (typeof confirmacaoOrigem === 'string') {
        const normalizado = confirmacaoOrigem.trim().toLowerCase();
        if (!normalizado) return false;
        return ['true', 't', '1', 'sim', 'yes', 'y', 'aguardando_aprovacao', 'confirmado'].includes(normalizado);
      }
      return false;
    })();

    if (typeof usuario.verificado === 'boolean') {
      if (usuario.verificado) return 'Ativo';
      if (confirmacao) return 'Inativo';
      return 'Não confirmado';
    }

    if (typeof usuario.confirmacao === 'boolean' || confirmacaoOrigem !== undefined) {
      return confirmacao ? 'Inativo' : 'Não confirmado';
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
    if (inputs.perfil) {
      inputs.perfil.value = usuario.perfil || '';
      popularPerfis(usuario.perfil || '');
    }
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
      const fallbackInitials = iniciais || 'US';
      const avatarUrl = obterAvatarUrl(usuario);
      avatar.classList.toggle('has-image', Boolean(avatarUrl));
      avatar.innerHTML = '';
      if (avatarUrl) {
        const img = document.createElement('img');
        img.src = avatarUrl;
        img.loading = 'lazy';
        img.alt = origem ? `Avatar de ${origem}` : 'Avatar do usuário';
        img.className = 'usuario-avatar__image';
        img.addEventListener(
          'error',
          () => {
            avatar.classList.remove('has-image');
            avatar.textContent = fallbackInitials;
          },
          { once: true }
        );
        avatar.appendChild(img);
      } else {
        avatar.textContent = fallbackInitials;
      }
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

  /**
   * Preenche o combo "Perfil" com os perfis reais (modelos de permissão +
   * perfis já usados por usuários). Mantém o valor atual do usuário mesmo que
   * ele ainda não exista como modelo, para não apagá-lo ao salvar.
   */
  async function popularPerfis(valorAtual) {
    const select = inputs.perfil;
    if (!select) return;
    const atual = String(valorAtual || '').trim();
    try {
      const resp = await fetchApi('/api/usuarios/perfis');
      if (!resp.ok) throw new Error(await resp.text());
      const dados = await resp.json();
      const perfis = Array.isArray(dados?.perfis) ? dados.perfis : [];

      select.innerHTML = '<option value="">Selecione</option>';
      const vistos = new Set();
      perfis.forEach(p => {
        const nome = String(p?.nome || '').trim();
        if (!nome || vistos.has(nome.toLowerCase())) return;
        vistos.add(nome.toLowerCase());
        const opt = document.createElement('option');
        opt.value = nome;
        opt.textContent = nome;
        if (p?.id != null) opt.dataset.modeloId = String(p.id);
        select.appendChild(opt);
      });

      // garante que o perfil atual do usuário apareça na lista
      if (atual && !vistos.has(atual.toLowerCase())) {
        const opt = document.createElement('option');
        opt.value = atual;
        opt.textContent = atual;
        select.appendChild(opt);
      }
    } catch (err) {
      console.error('Não foi possível carregar os perfis:', err);
      // mantém as opções que já estiverem no HTML como fallback
      if (atual && !Array.from(select.options).some(o => o.value === atual)) {
        const opt = document.createElement('option');
        opt.value = atual;
        opt.textContent = atual;
        select.appendChild(opt);
      }
    }
    select.value = atual;
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
    } catch (err) {
      console.error('Erro ao carregar usuário:', err);
      exibirMensagem('erro', err.message || 'Falha ao carregar dados do usuário.');
    } finally {
      window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'editarUsuario' }));
    }
  }

  // Guardamos a promessa: a restauração precisa esperar por ela, porque
  // `preencherDadosBasicos` sobrescreve todos os campos com o que veio do banco.
  const carregamentoInicial = carregarDetalhes();

  // ------------------------------------------------------------------
  // Preservação do trabalho (ver docs/restauracao-de-trabalho.md)
  //
  // Duas coisas não voltam sozinhas:
  //  1. QUAL usuário está sendo editado — `window.usuarioEditar` e
  //     `window.usuarioEditarContext` são lidos e APAGADOS na abertura.
  //  2. Os campos de texto: a varredura genérica até os captura, mas
  //     `carregarDetalhes()` chega depois e sobrescreve com o valor do banco.
  //     Por isso repomos aqui, DEPOIS da carga.
  // ------------------------------------------------------------------
  window.EstadoTrabalho?.registrarConteudo?.('editarUsuario', {
    capturar: () => ({
      __contexto: {
        usuarioEditar: usuarioBase,
        usuarioEditarContext: contexto
      },
      campos: {
        nome: inputs.nome?.value || '',
        email: inputs.email?.value || '',
        telefone: inputs.telefone?.value || '',
        status: inputs.status?.value || '',
        observacoes: inputs.observacoes?.value || ''
      },
      perfil: inputs.perfil?.value || '',
      aba: tabs.find(t => t.getAttribute('aria-selected') === 'true')?.id || null
    }),
    restaurar: async (dados) => {
      if (!dados) return;

      try {
        await carregamentoInicial;
      } catch (_) { /* já tratado em carregarDetalhes */ }

      Object.entries(dados.campos || {}).forEach(([chave, valor]) => {
        const campo = inputs[chave];
        if (!campo || valor === '') return;
        campo.value = valor;
        campo.dispatchEvent(new Event('input', { bubbles: true }));
      });

      // O combo de perfil é preenchido por `fetch`; espera as opções chegarem.
      await window.EstadoTrabalho?.reporSelect?.(inputs.perfil, dados.perfil);

      if (dados.aba) {
        const aba = document.getElementById(dados.aba);
        if (aba) aba.click();
      }
    }
  });
})();
