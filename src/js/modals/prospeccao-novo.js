/**
 * Modal "Nova Prospecção".
 *
 * O cadastro é pela EMPRESA: os contatos ficam em memória e sobem junto no
 * mesmo POST, que cria a prospecção, os contatos e o primeiro registro do
 * histórico do funil.
 */
(async function () {
  const overlay = document.getElementById('novaProspeccaoOverlay');
  if (!overlay) return;

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  // A lógica de abas, contatos, geografia e etapa/probabilidade é a mesma do
  // modal de edição — mora em prospeccao-form-comum.js.
  if (!window.ProspeccaoForm) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/modals/prospeccao-form-comum.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const form = window.ProspeccaoForm.criar(overlay, { modo: 'novo' });

  const close = () => {
    form.destruir();
    Modal.close('novaProspeccao');
  };

  document.getElementById('voltarNovaProspeccao')?.addEventListener('click', close);
  document.getElementById('cancelarNovaProspeccao')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key !== 'Escape') return;
    // O sub-modal de contato trata o próprio Esc e para a propagação; se ele
    // estiver aberto, este ouvinte não deve fechar a tela de trás.
    if (document.getElementById('contatoProspeccaoOverlay')) return;
    close();
    document.removeEventListener('keydown', esc);
  });

  // Avatar acompanha o nome digitado, como no cadastro de clientes.
  const nomeInput = document.getElementById('prosNomeFantasia');
  const avatar = document.getElementById('prospeccaoAvatar');
  nomeInput?.addEventListener('input', () => {
    if (!avatar) return;
    avatar.textContent = nomeInput.value.split(' ').filter(Boolean)
      .map(n => n[0]).join('').slice(0, 2).toUpperCase();
  });

  const etapaSel = document.getElementById('prosEtapa');
  const probInput = document.getElementById('prosProbabilidade');
  if (etapaSel && probInput && !probInput.value) {
    probInput.value = String(window.ProspeccaoForm.PROBABILIDADE_POR_ETAPA[etapaSel.value] ?? 10);
  }

  await Promise.all([
    form.carregarResponsaveis(),
    form.configurarGeografia()
  ]);

  // ---------------------------------------------------------------------
  // Preservação do trabalho (ver docs/restauracao-de-trabalho.md)
  //
  // A varredura genérica repõe os <input>, mas não alcança: os contatos (array
  // em memória, a tabela é só o desenho dele), a aba aberta, o Responsável
  // (vem por fetch) e País/Estado (selects em cascata, o de estado nasce vazio).
  // ---------------------------------------------------------------------
  window.EstadoTrabalho?.registrarConteudo?.('novaProspeccao', {
    capturar: () => ({
      contatos: form.getContatos(),
      abaAtiva: form.abaAtiva(),
      responsavel: document.getElementById('prosResponsavel')?.value || '',
      etapa: document.getElementById('prosEtapa')?.value || '',
      pais: document.getElementById('endPais')?.value || '',
      estado: document.getElementById('endEstado')?.value || ''
    }),
    restaurar: async dados => {
      if (!dados) return;
      if (Array.isArray(dados.contatos) && dados.contatos.length) form.setContatos(dados.contatos);

      const repor = window.EstadoTrabalho?.reporSelect;
      if (repor) {
        await repor(document.getElementById('prosResponsavel'), dados.responsavel);
        await repor(document.getElementById('prosEtapa'), dados.etapa);
        // País PRIMEIRO: é o `change` dele que carrega a lista de estados.
        if (dados.pais) {
          await repor(document.getElementById('endPais'), dados.pais);
          await repor(document.getElementById('endEstado'), dados.estado);
        }
      }

      // Aba por último: reposicionar antes faria a validação rolar até um campo
      // dentro de painel escondido.
      if (dados.abaAtiva) form.activateTab(document.getElementById(dados.abaAtiva), { setFocus: false });
    }
  });

  // ---------------------------------------------------------------------
  // Registrar
  // ---------------------------------------------------------------------
  const registrar = async () => {
    const dados = form.coletarDados();
    if (!dados) return;

    try {
      const resp = await fetchApi('/api/prospeccoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
      const corpo = await resp.json().catch(() => ({}));

      if (resp.status === 409) {
        // Já existe prospecção ativa para o mesmo CNPJ — o backend confere
        // antes para não devolver o erro cru do índice único do banco.
        form.activateTab(document.getElementById('tab-pros-empresa'));
        document.getElementById('prosCnpj')?.focus();
        showToast(corpo.error || 'Já existe uma prospecção ativa para este CNPJ', 'error');
        return;
      }
      if (!resp.ok) throw new Error(corpo.error || 'Erro ao registrar prospecção');

      // Grade primeiro, aviso depois: ao contrário, o usuário lê "registrada"
      // com a lista ainda sem a linha e acha que não funcionou.
      if (typeof carregarProspeccoes === 'function') {
        await carregarProspeccoes(true);
      } else {
        window.dispatchEvent(new Event('prospeccaoAdicionada'));
      }
      showToast('Prospecção registrada com sucesso!', 'success');
      close();
    } catch (err) {
      console.error('Erro ao registrar prospecção', err);
      showToast(err.message || 'Erro ao registrar prospecção', 'error');
    }
  };

  const botao = document.getElementById('registrarProspeccao');
  if (window.BotaoAcao?.bind) window.BotaoAcao.bind(botao, registrar);
  else botao?.addEventListener('click', registrar);

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'novaProspeccao' }));
})();
