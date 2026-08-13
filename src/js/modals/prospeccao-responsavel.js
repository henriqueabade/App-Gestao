/**
 * Alterar o responsável — PUT /api/prospeccoes/:id/responsavel.
 *
 * Ação privativa do Sup Admin: o backend cobra `exigirSupAdmin` além da
 * permissão do módulo, e o mesmo vale para o campo dentro do modal de edição.
 *
 * `criado_por` nunca é tocado — quem cadastrou é fato histórico, quem responde
 * hoje é atribuição.
 */
(async function () {
  const overlay = document.getElementById('responsavelProspeccaoOverlay');
  if (!overlay) return;

  if (!window.ProspeccaoAcoes) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/modals/prospeccao-acoes-comum.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const A = window.ProspeccaoAcoes;
  const get = id => document.getElementById(id);
  const fechar = A.ligarFechamento(overlay, 'responsavelProspeccao',
    ['voltarResponsavel', 'cancelarResponsavel']);

  const prospeccao = A.alvo();
  if (!prospeccao?.id) {
    showToast('Prospecção não encontrada', 'error');
    fechar();
    return;
  }

  get('responsavelEmpresa').textContent =
    prospeccao.nome_fantasia || prospeccao.razao_social || '(sem nome)';
  get('responsavelAtual').textContent = prospeccao.responsavel || 'Sem responsável';
  get('responsavelCadastrou').textContent = prospeccao.criado_por_nome || 'Não registrado';

  try {
    const resp = await A.fetchApi('/api/usuarios/lista');
    const usuarios = await resp.json();
    const sel = get('responsavelNovo');
    sel.innerHTML = '<option value="">Sem responsável</option>' +
      (Array.isArray(usuarios) ? usuarios : [])
        .map(u => `<option value="${A.esc(u.id)}">${A.esc(u.nome)}</option>`).join('');
    if (prospeccao.responsavel_id) sel.value = String(prospeccao.responsavel_id);
  } catch (err) {
    console.error('Erro ao carregar usuários', err);
    showToast('Não foi possível carregar a lista de usuários', 'error');
  }

  get('responsavelForm')?.addEventListener('submit', e => e.preventDefault());

  A.aoConfirmar(get('salvarResponsavel'), async () => {
    const escolhido = get('responsavelNovo').value;
    const novo = escolhido ? Number(escolhido) : null;

    if (Number(prospeccao.responsavel_id ?? 0) === Number(novo ?? 0)) {
      showToast('Escolha um responsável diferente do atual', 'info');
      return;
    }

    await A.enviar(`/api/prospeccoes/${prospeccao.id}/responsavel`, {
      method: 'PUT',
      body: JSON.stringify({
        responsavel_id: novo,
        observacao: A.texto(get('responsavelObservacao').value)
      })
    }, {
      overlayId: 'responsavelProspeccao',
      sucesso: 'Responsável alterado',
      aoFalhar: (status, corpo) => {
        if (status === 403) {
          // O backend recusa quem não é Sup Admin; a interface só não deveria
          // ter oferecido o botão.
          showToast(corpo.error || 'Ação restrita ao Sup Admin', 'error');
          return true;
        }
        return false;
      }
    });
  });

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'responsavelProspeccao' }));
})();
