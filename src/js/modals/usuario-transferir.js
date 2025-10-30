(function () {
  const overlayId = 'transferirUsuario';
  const overlay = document.getElementById(`${overlayId}Overlay`);
  if (!overlay) return;

  const context = window.usuarioTransferenciaContext || {};
  delete window.usuarioTransferenciaContext;

  const usuario = context.usuario || {};
  const associacoes = Array.isArray(context.associacoes) ? context.associacoes : [];
  const usuariosDisponiveis = Array.isArray(context.usuariosDisponiveis)
    ? context.usuariosDisponiveis.filter((item) => item && item.id !== undefined && item.id !== null)
    : [];

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const detalhesEl = overlay.querySelector('[data-transferencia-detalhes]');
  const resumoEl = overlay.querySelector('[data-transferencia-resumo]');
  const selectEl = overlay.querySelector('#transferirUsuarioDestino');
  const emailDestinoEl = overlay.querySelector('[data-transferir-usuario-email]');
  const mensagemEl = overlay.querySelector('#transferirUsuarioMensagem');
  const cancelarBtn = overlay.querySelector('[data-action="cancelar"]');
  const confirmarBtn = overlay.querySelector('[data-action="confirmar"]');

  const escapeHtml = (value) =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const close = () => {
    document.removeEventListener('keydown', handleKeydown);
    if (typeof Modal?.close === 'function') {
      Modal.close(overlayId);
    } else {
      overlay.classList.add('hidden');
    }
  };

  const handleKeydown = (event) => {
    if (event.key === 'Escape') {
      close();
    }
  };

  const setMensagem = (texto, tipo) => {
    if (!mensagemEl) return;
    if (!texto) {
      mensagemEl.textContent = '';
      mensagemEl.className = 'hidden text-sm';
      return;
    }

    const baseClasses = 'text-sm px-3 py-2 rounded-lg border';
    if (tipo === 'error') {
      mensagemEl.className = `${baseClasses} border-red-500/40 text-red-300 bg-red-500/10`;
    } else if (tipo === 'success') {
      mensagemEl.className = `${baseClasses} border-green-500/40 text-green-300 bg-green-500/10`;
    } else {
      mensagemEl.className = `${baseClasses} border-blue-500/40 text-blue-300 bg-blue-500/10`;
    }
    mensagemEl.textContent = texto;
  };

  const renderAssociacoes = () => {
    if (!detalhesEl) return;
    if (!associacoes.length) {
      detalhesEl.innerHTML = `
        <strong class="block text-white text-sm">Locais com dados vinculados</strong>
        <p class="text-gray-300 text-sm">Nenhuma associação encontrada para este usuário.</p>
      `;
      return;
    }

    const itens = associacoes.map((assoc) => {
      const label = escapeHtml(assoc?.label || assoc?.table || 'Registros');
      const total = typeof assoc?.total === 'number' ? assoc.total : null;
      const colunas = Array.isArray(assoc?.columns)
        ? assoc.columns
            .filter((col) => col && col.column)
            .map((col) => {
              const tipo = col.type === 'email' ? 'email' : col.type === 'nome' ? 'nome' : '';
              const sufixo = tipo ? ` (${tipo})` : '';
              return `${escapeHtml(col.column)}${sufixo}`;
            })
        : [];
      const detalhes = [];
      if (total !== null) {
        detalhes.push(`${total} registro${total === 1 ? '' : 's'}`);
      }
      if (colunas.length) {
        detalhes.push(`campos: ${colunas.join(', ')}`);
      }
      const descricaoExtra = detalhes.length ? ` — ${escapeHtml(detalhes.join(' • '))}` : '';
      return `<li>${label}${descricaoExtra}</li>`;
    });

    detalhesEl.innerHTML = `
      <strong class="block text-white text-sm">Locais com dados vinculados</strong>
      <ul class="list-disc list-inside space-y-1 text-gray-300 text-sm">
        ${itens.join('')}
      </ul>
    `;
  };

  const renderResumo = () => {
    if (!resumoEl) return;
    const nomeOuEmail = usuario.nome?.trim() || usuario.email?.trim() || 'o usuário selecionado';
    resumoEl.textContent = `Não foi possível concluir a exclusão de ${nomeOuEmail} pois ainda existem dados associados. Selecione abaixo outro usuário para receber esses registros e concluir o processo.`;
  };

  const renderUsuariosDisponiveis = () => {
    if (!selectEl) return;
    if (!usuariosDisponiveis.length) {
      selectEl.innerHTML = '<option value="" disabled selected hidden>Não há usuários disponíveis</option>';
      selectEl.disabled = true;
      confirmarBtn?.setAttribute('disabled', 'true');
      confirmarBtn?.classList.add('opacity-60', 'cursor-not-allowed');
      setMensagem('Não há outros usuários cadastrados para receber os dados.', 'error');
      return;
    }

    const options = usuariosDisponiveis
      .map((user) => {
        const label = user.nome?.trim() || user.email?.trim() || `Usuário ${user.id}`;
        return `<option value="${escapeHtml(String(user.id))}">${escapeHtml(label)}</option>`;
      })
      .join('');

    selectEl.innerHTML = '<option value="" disabled selected hidden>Selecione um usuário</option>' + options;
    selectEl.disabled = false;
    confirmarBtn?.removeAttribute('disabled');
    confirmarBtn?.classList.remove('opacity-60', 'cursor-not-allowed');
  };

  const atualizarEmailDestino = () => {
    if (!emailDestinoEl) return;
    const selecionado = usuariosDisponiveis.find((user) => String(user.id) === selectEl.value);
    if (!selecionado) {
      emailDestinoEl.textContent = '';
      return;
    }
    const email = selecionado.email?.trim();
    emailDestinoEl.textContent = email ? `E-mail do destinatário: ${email}` : 'Usuário selecionado sem e-mail cadastrado.';
  };

  const confirmarTransferencia = async () => {
    if (!selectEl || !confirmarBtn || confirmarBtn.disabled) return;
    if (!selectEl.value) {
      setMensagem('Selecione um usuário para transferir os dados.', 'error');
      selectEl.focus();
      return;
    }

    const destinoId = Number(selectEl.value);
    const destino = usuariosDisponiveis.find((user) => Number(user.id) === destinoId);
    const destinoLabel = destino?.nome?.trim() || destino?.email?.trim() || 'o usuário selecionado';

    let confirmarDialogo = true;
    if (typeof window.usuariosShowConfirmDialog === 'function') {
      confirmarDialogo = await window.usuariosShowConfirmDialog({
        title: 'Confirmar transferência',
        message: `Confirmar a transferência dos dados para ${destinoLabel}?`,
        confirmLabel: 'Sim',
        cancelLabel: 'Não'
      });
    } else {
      confirmarDialogo = window.confirm(`Confirmar a transferência dos dados para ${destinoLabel}?`);
    }

    if (!confirmarDialogo) {
      return;
    }

    confirmarBtn.disabled = true;
    confirmarBtn.classList.add('opacity-60', 'cursor-not-allowed');
    setMensagem('', '');

    try {
      const resp = await fetchApi(`/api/usuarios/${encodeURIComponent(usuario.id)}/transferencia`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinoId })
      });
      const data = await resp.json().catch(() => ({}));

      if (resp.ok) {
        if (typeof window.showToast === 'function') {
          window.showToast(data.message || 'Exclusão e transferência concluídas com sucesso.', 'success');
        }
        close();
        window.dispatchEvent(
          new CustomEvent('usuarioTransferenciaConcluida', {
            detail: { usuarioId: usuario.id, destinoId }
          })
        );
      } else {
        confirmarBtn.disabled = false;
        confirmarBtn.classList.remove('opacity-60', 'cursor-not-allowed');
        setMensagem(data.message || data.error || 'Não foi possível transferir os dados do usuário.', 'error');
      }
    } catch (err) {
      console.error('Erro ao transferir dados do usuário:', err);
      confirmarBtn.disabled = false;
      confirmarBtn.classList.remove('opacity-60', 'cursor-not-allowed');
      setMensagem('Erro ao transferir dados do usuário.', 'error');
    }
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.addEventListener('keydown', handleKeydown);
  cancelarBtn?.addEventListener('click', close);
  confirmarBtn?.addEventListener('click', confirmarTransferencia);
  selectEl?.addEventListener('change', () => {
    setMensagem('', '');
    atualizarEmailDestino();
  });

  renderAssociacoes();
  renderResumo();
  renderUsuariosDisponiveis();
  atualizarEmailDestino();

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: overlayId }));
})();
