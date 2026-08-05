/**
 * Modal "Novo usuário" (Gestão de Usuários).
 *
 * Cadastro feito pelo Sup Admin: o usuário já nasce liberado no banco, sem
 * confirmação de e-mail e sem fila de aprovação — quem cadastrou é quem
 * aprovaria depois. Quem aplica isso é POST /api/usuarios, que grava os mesmos
 * campos de liberação usados na aprovação por e-mail.
 */
(async function () {
  const overlay = document.getElementById('novoUsuarioOverlay');
  if (!overlay) return;

  const AVATAR_MAX_BYTES = 1_048_576;               // igual ao limite do backend
  const TIPOS_FOTO = ['image/png', 'image/jpeg'];

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const inputs = {
    nome: document.getElementById('novoUsuarioNome'),
    email: document.getElementById('novoUsuarioEmail'),
    telefone: document.getElementById('novoUsuarioTelefone'),
    perfil: document.getElementById('novoUsuarioPerfil'),
    senha: document.getElementById('novoUsuarioSenha'),
    senhaConfirma: document.getElementById('novoUsuarioSenhaConfirma'),
    observacoes: document.getElementById('novoUsuarioObservacoes')
  };

  const avatarEl = document.getElementById('novoUsuarioAvatar');
  const fotoInput = document.getElementById('novoUsuarioFoto');
  const removerFotoBtn = document.getElementById('novoUsuarioRemoverFoto');
  const mensagemEl = document.getElementById('novoUsuarioMensagem');
  const adicionarBtn = document.getElementById('adicionarNovoUsuario');

  let fotoDataUrl = null;

  // ---------------------------------------------------------------- mensagens
  function exibirMensagem(tipo, texto) {
    if (!mensagemEl) return;
    mensagemEl.textContent = texto;
    mensagemEl.classList.remove('hidden', 'usuario-mensagem-erro', 'usuario-mensagem-sucesso');
    mensagemEl.classList.add(tipo === 'erro' ? 'usuario-mensagem-erro' : 'usuario-mensagem-sucesso');
  }

  function limparMensagem() {
    mensagemEl?.classList.add('hidden');
  }

  // ------------------------------------------------------------------ fechar
  const close = () => {
    document.removeEventListener('keydown', onEscKey);
    Modal.close('novoUsuario');
  };

  function onEscKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  document.getElementById('voltarNovoUsuario')?.addEventListener('click', close);
  document.getElementById('cancelarNovoUsuario')?.addEventListener('click', close);
  document.addEventListener('keydown', onEscKey);

  // ------------------------------------------------------------------- avatar
  function iniciaisDe(nome) {
    const base = String(nome || '').trim();
    if (!base) return 'US';
    return base
      .split(/\s+/)
      .filter(Boolean)
      .map(parte => parte[0])
      .join('')
      .substring(0, 2)
      .toUpperCase() || 'US';
  }

  function pintarAvatar() {
    if (!avatarEl) return;
    avatarEl.innerHTML = '';
    if (fotoDataUrl) {
      avatarEl.classList.add('has-image');
      const img = document.createElement('img');
      img.src = fotoDataUrl;
      img.alt = 'Foto do novo usuário';
      img.className = 'usuario-avatar__image';
      avatarEl.appendChild(img);
      removerFotoBtn?.classList.remove('hidden');
    } else {
      avatarEl.classList.remove('has-image');
      avatarEl.textContent = iniciaisDe(inputs.nome?.value);
      removerFotoBtn?.classList.add('hidden');
    }
  }

  inputs.nome?.addEventListener('input', () => { if (!fotoDataUrl) pintarAvatar(); });

  fotoInput?.addEventListener('change', () => {
    const arquivo = fotoInput.files?.[0];
    if (!arquivo) return;

    if (!TIPOS_FOTO.includes(arquivo.type)) {
      exibirMensagem('erro', 'A foto precisa ser PNG ou JPEG.');
      fotoInput.value = '';
      return;
    }
    if (arquivo.size > AVATAR_MAX_BYTES) {
      exibirMensagem('erro', 'A foto excede o limite de 1 MB.');
      fotoInput.value = '';
      return;
    }

    const leitor = new FileReader();
    leitor.onload = () => {
      fotoDataUrl = String(leitor.result || '') || null;
      limparMensagem();
      pintarAvatar();
    };
    leitor.onerror = () => exibirMensagem('erro', 'Não foi possível ler a imagem escolhida.');
    leitor.readAsDataURL(arquivo);
  });

  removerFotoBtn?.addEventListener('click', () => {
    fotoDataUrl = null;
    if (fotoInput) fotoInput.value = '';
    pintarAvatar();
  });

  // ------------------------------------------------------------------ perfis
  async function popularPerfis() {
    const select = inputs.perfil;
    if (!select) return;
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
    } catch (err) {
      console.error('Não foi possível carregar os perfis:', err);
      exibirMensagem('erro', 'Não foi possível carregar a lista de perfis.');
    }
  }

  // -------------------------------------------------------------- validação
  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function coletar() {
    const opcao = inputs.perfil?.selectedOptions?.[0];
    return {
      nome: inputs.nome?.value.trim() || '',
      email: inputs.email?.value.trim().toLowerCase() || '',
      telefone: inputs.telefone?.value.trim() || '',
      perfil: inputs.perfil?.value || '',
      senha: inputs.senha?.value || '',
      senhaConfirma: inputs.senhaConfirma?.value || '',
      observacoes: inputs.observacoes?.value.trim() || '',
      modeloPermissoesId: opcao?.dataset?.modeloId ? Number(opcao.dataset.modeloId) : null,
      avatar: fotoDataUrl
    };
  }

  function validar(dados) {
    if (dados.nome.length < 3) return 'Informe o nome completo do usuário.';
    if (!RE_EMAIL.test(dados.email)) return 'Informe um e-mail válido.';
    if (!dados.perfil) return 'Selecione o perfil do usuário.';
    if (dados.senha.length < 6) return 'A senha deve ter ao menos 6 caracteres.';
    if (dados.senha !== dados.senhaConfirma) return 'As senhas não conferem.';
    return null;
  }

  // ---------------------------------------------------------------- gravação
  async function enviar(dados) {
    const resp = await fetchApi('/api/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: dados.nome,
        email: dados.email,
        telefone: dados.telefone,
        perfil: dados.perfil,
        senha: dados.senha,
        observacoes: dados.observacoes,
        modeloPermissoesId: dados.modeloPermissoesId,
        avatar: dados.avatar || undefined
      })
    });

    let corpo = null;
    try { corpo = await resp.json(); } catch (_) {}

    if (!resp.ok) {
      throw new Error(corpo?.error || 'Não foi possível cadastrar o usuário.');
    }
    return corpo;
  }

  // Trava do fluxo inteiro (inclui a caixa de diálogo): sem ela um duplo clique
  // abriria duas confirmações e poderia cadastrar o usuário duas vezes.
  let emAndamento = false;

  async function aoClicarAdicionar() {
    if (emAndamento) return;
    limparMensagem();

    const dados = coletar();
    const problema = validar(dados);
    if (problema) {
      exibirMensagem('erro', problema);
      return;
    }

    emAndamento = true;
    try {
      const confirmou = await window.DialogPadrao.confirm({
        title: 'Adicionar usuário',
        message: `Deseja realmente adicionar o usuário ${dados.nome}?`,
        confirmText: 'Sim',
        cancelText: 'Não'
      });

      // "Não" apenas volta para o modal — nada é enviado e nada se perde.
      if (!confirmou) return;

      // O clique que abriu o diálogo deixou o botão marcado como ocupado pela
      // guarda global; soltamos para que `run` possa reassumir e mostrar o
      // carregamento durante a gravação de verdade.
      window.BotaoAcao?.liberar?.(adicionarBtn);

      const executar = async () => {
        const resultado = await enviar(dados);
        exibirMensagem('sucesso', resultado?.message || 'Usuário cadastrado com sucesso!');
        window.dispatchEvent(new CustomEvent('usuarioAtualizado', {
          detail: { criado: true, usuario: resultado?.usuario || null }
        }));
        window.showToast?.(`Usuário ${dados.nome} cadastrado com sucesso.`, 'success');
        setTimeout(close, 400);
      };

      if (typeof window.BotaoAcao?.run === 'function') {
        await window.BotaoAcao.run(adicionarBtn, executar);
      } else {
        await executar();
      }
    } catch (err) {
      console.error('Erro ao cadastrar usuário:', err);
      exibirMensagem('erro', err.message || 'Falha ao cadastrar o usuário.');
    } finally {
      emAndamento = false;
    }
  }

  adicionarBtn?.addEventListener('click', aoClicarAdicionar);

  // ------------------------------------------------------------------ início
  pintarAvatar();
  const carregamentoInicial = popularPerfis();
  try {
    await carregamentoInicial;
  } finally {
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'novoUsuario' }));
  }

  // Preservação do trabalho (ver docs/restauracao-de-trabalho.md).
  // As senhas ficam de fora de propósito: o estado é persistido em disco e
  // credencial não deve sair da memória.
  window.EstadoTrabalho?.registrarConteudo?.('novoUsuario', {
    capturar: () => ({
      campos: {
        nome: inputs.nome?.value || '',
        email: inputs.email?.value || '',
        telefone: inputs.telefone?.value || '',
        observacoes: inputs.observacoes?.value || ''
      },
      perfil: inputs.perfil?.value || ''
    }),
    restaurar: async (dados) => {
      if (!dados) return;
      try { await carregamentoInicial; } catch (_) { /* já tratado */ }

      Object.entries(dados.campos || {}).forEach(([chave, valor]) => {
        const campo = inputs[chave];
        if (!campo || valor === '') return;
        campo.value = valor;
        campo.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await window.EstadoTrabalho?.reporSelect?.(inputs.perfil, dados.perfil);
      pintarAvatar();
    }
  });
})();
