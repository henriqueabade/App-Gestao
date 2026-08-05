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

  // Mesmos limites de Configurações — é o mesmo endpoint do servidor.
  const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
  const TIPOS_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

  // Guardamos o ARQUIVO, não uma dataURL: a imagem sobe em multipart para o
  // servidor depois que o usuário é criado, igual a Configurações.
  let fotoArquivo = null;
  let fotoPreviewUrl = null;

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
    descartarPreview();          // objectURL não some sozinho
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

  function descartarPreview() {
    if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
    fotoPreviewUrl = null;
  }

  function pintarAvatar() {
    if (!avatarEl) return;
    avatarEl.innerHTML = '';
    if (fotoPreviewUrl) {
      avatarEl.classList.add('has-image');
      const img = document.createElement('img');
      img.src = fotoPreviewUrl;
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

  inputs.nome?.addEventListener('input', () => { if (!fotoPreviewUrl) pintarAvatar(); });

  fotoInput?.addEventListener('change', () => {
    const arquivo = fotoInput.files?.[0];
    if (!arquivo) return;

    if (!TIPOS_FOTO.has(String(arquivo.type || '').toLowerCase())) {
      exibirMensagem('erro', 'Escolha uma imagem JPG, PNG ou WebP.');
      fotoInput.value = '';
      return;
    }
    if (arquivo.size > AVATAR_MAX_BYTES) {
      exibirMensagem('erro', 'A imagem deve ter no máximo 5 MB.');
      fotoInput.value = '';
      return;
    }

    // Pré-visualização por objectURL, como em Configurações: nada de converter
    // para dataURL — o que sobe é o arquivo.
    descartarPreview();
    fotoArquivo = arquivo;
    fotoPreviewUrl = URL.createObjectURL(arquivo);
    limparMensagem();
    pintarAvatar();
  });

  removerFotoBtn?.addEventListener('click', () => {
    fotoArquivo = null;
    descartarPreview();
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
      modeloPermissoesId: opcao?.dataset?.modeloId ? Number(opcao.dataset.modeloId) : null
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
        modeloPermissoesId: dados.modeloPermissoesId
      })
    });

    let corpo = null;
    try { corpo = await resp.json(); } catch (_) {}

    if (!resp.ok) {
      throw new Error(corpo?.error || 'Não foi possível cadastrar o usuário.');
    }
    return corpo;
  }

  /**
   * Sobe a foto pelo MESMO caminho de Configurações: multipart para o
   * servidor, que é quem grava a imagem. A única diferença é o alvo — o
   * usuário recém-criado, e não o dono da sessão.
   */
  async function enviarFoto(usuarioId) {
    if (!fotoArquivo || !usuarioId) return;
    if (typeof window.electronAPI?.enviarImagemUsuario !== 'function') {
      throw new Error('Recurso de imagem de perfil indisponível.');
    }
    return window.electronAPI.enviarImagemUsuario({
      usuarioId,
      name: fotoArquivo.name,
      type: fotoArquivo.type,
      bytes: new Uint8Array(await fotoArquivo.arrayBuffer())
    });
  }

  // Trava do fluxo inteiro (inclui a caixa de diálogo): sem ela um duplo clique
  // abriria duas confirmações e poderia cadastrar o usuário duas vezes.
  let emAndamento = false;

  /** Trava o botão e deixa isso VISÍVEL enquanto a ação não termina. */
  function travarBotao(travado) {
    if (!adicionarBtn) return;
    adicionarBtn.disabled = travado;
    adicionarBtn.classList.toggle('btn-loading', travado);
    adicionarBtn.setAttribute('aria-busy', travado ? 'true' : 'false');
  }

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
    travarBotao(true);            // já trava na abertura do diálogo
    try {
      const confirmou = await window.DialogPadrao.confirm({
        title: 'Adicionar usuário',
        message: `Deseja realmente adicionar o usuário ${dados.nome}?`,
        confirmText: 'Sim',
        cancelText: 'Não'
      });

      // "Não" apenas volta para o modal — nada é enviado e nada se perde.
      if (!confirmou) return;

      const executar = async () => {
        const resultado = await enviar(dados);

        // A foto é uma segunda etapa. Se ela falhar, o cadastro NÃO é desfeito
        // — o usuário já existe e já consegue entrar; avisamos o que faltou e
        // demoramos mais para fechar, para dar tempo de ler.
        let aviso = null;
        let usuarioComFoto = resultado?.usuario || null;
        const idCriado = resultado?.id ?? resultado?.usuario?.id ?? null;
        if (fotoArquivo) {
          try {
            const fotoResultado = await enviarFoto(idCriado);
            if (fotoResultado && typeof fotoResultado === 'object') {
              usuarioComFoto = { ...(usuarioComFoto || {}), ...fotoResultado, id: idCriado };
            }
          } catch (fotoErr) {
            console.error('Usuário criado, mas a foto não subiu:', fotoErr);
            aviso = `Usuário cadastrado, mas a foto não subiu (${fotoErr?.message || 'falha no envio'}). `
                  + 'Edite o usuário para tentar de novo.';
          }
        }

        if (aviso) {
          exibirMensagem('erro', aviso);
          window.showToast?.(aviso, 'warning');
        } else {
          exibirMensagem('sucesso', resultado?.message || 'Usuário cadastrado com sucesso!');
          window.showToast?.(`Usuário ${dados.nome} cadastrado com sucesso.`, 'success');
        }

        window.dispatchEvent(new CustomEvent('usuarioAtualizado', {
          detail: { criado: true, usuario: usuarioComFoto }
        }));
        setTimeout(close, aviso ? 2800 : 400);
      };

      // Véu de carregamento padrão do app (a logo em órbita), o mesmo dos
      // módulos e da abertura de modais. Fica na tela até a resposta chegar —
      // `BotaoAcao.run` não servia aqui: ele só marca o botão e o indicador
      // pode nem aparecer quando a resposta é rápida.
      if (typeof window.BotaoAcao?.comCarregamento === 'function') {
        await window.BotaoAcao.comCarregamento(executar, 'Cadastrando usuário...');
      } else {
        await executar();
      }
    } catch (err) {
      console.error('Erro ao cadastrar usuário:', err);
      exibirMensagem('erro', err.message || 'Falha ao cadastrar o usuário.');
    } finally {
      emAndamento = false;
      travarBotao(false);
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
