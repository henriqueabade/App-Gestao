/**
 * Modal "Editar Prospecção".
 *
 * Recarrega a ficha completa de GET /api/prospeccoes/:id — a grade traz só o
 * resumo, e editar sobre dado parcial apagaria os campos que a lista não
 * carrega (endereço, anotações, inscrição estadual).
 *
 * Os contatos viram DELTA: novos, atualizados e excluídos vão separados no PUT,
 * e cada um pede a sua permissão no backend.
 */
(async function () {
  const overlay = document.getElementById('editarProspeccaoOverlay');
  if (!overlay) return;

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  if (!window.ProspeccaoForm) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/modals/prospeccao-form-comum.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const form = window.ProspeccaoForm.criar(overlay, { modo: 'editar' });
  const prospeccao = window.prospeccaoEditar;

  const close = () => {
    form.destruir();
    Modal.close('editarProspeccao');
  };

  document.getElementById('voltarEditarProspeccao')?.addEventListener('click', close);
  document.getElementById('cancelarEditarProspeccao')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key !== 'Escape') return;
    if (document.getElementById('contatoProspeccaoOverlay')) return;
    close();
    document.removeEventListener('keydown', esc);
  });

  // Sem devolver `window.prospeccaoEditar`, o modal reabre em branco após uma
  // queda e o botão Salvar não sabe o que gravar.
  window.EstadoTrabalho?.registrarContexto?.('editarProspeccao',
    () => ({ prospeccaoEditar: prospeccao }));

  function preencherResumoLateral(p) {
    const alvo = document.getElementById('prospeccaoResumoLateral');
    if (!alvo || !p) return;
    const linha = (rotulo, valor) =>
      `<div class="flex justify-between gap-2"><span>${rotulo}</span><span class="text-white/80">${valor}</span></div>`;
    const data = iso => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
    alvo.innerHTML = [
      linha('Etapa', p.etapa || '—'),
      linha('Criada em', data(p.criado_em)),
      linha('Atualizada', data(p.atualizado_em)),
      p.criado_por_nome ? linha('Cadastrada por', p.criado_por_nome) : ''
    ].join('');
  }

  // ---------------------------------------------------------------------
  // Carregamento da ficha
  // ---------------------------------------------------------------------
  if (!prospeccao?.id) {
    showToast('Prospecção não encontrada', 'error');
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'editarProspeccao' }));
    return;
  }

  try {
    const resp = await fetchApi(`/api/prospeccoes/${prospeccao.id}`);
    if (!resp.ok) {
      const corpo = await resp.json().catch(() => ({}));
      throw new Error(corpo.error || `Erro ${resp.status}`);
    }
    const dados = await resp.json();
    const p = dados.prospeccao || {};

    const titulo = document.getElementById('prospeccaoTitulo');
    if (titulo) titulo.textContent = `Editar – ${p.nome_fantasia || ''}`;

    form.preencherCampos(p);
    preencherResumoLateral(p);

    // Contatos já existentes entram como 'unchanged': só viram PUT se forem
    // realmente mexidos.
    form.setContatos((dados.contatos || []).map(c => ({ ...c, status: 'unchanged' })));

    await Promise.all([
      form.carregarResponsaveis(p.responsavel_id),
      form.configurarGeografia(p.endereco?.pais, p.endereco?.estado)
    ]);
  } catch (err) {
    console.error('Erro ao carregar prospecção', err);
    showToast(err.message || 'Erro ao carregar prospecção', 'error');
  } finally {
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'editarProspeccao' }));
  }

  // ---------------------------------------------------------------------
  // Preservação do trabalho
  //
  // Além do que o cadastro guarda, aqui é preciso guardar os EXCLUÍDOS: o modal
  // recarrega a lista do banco ao reabrir e, sem isso, os contatos apagados
  // voltariam vivos.
  // ---------------------------------------------------------------------
  window.EstadoTrabalho?.registrarConteudo?.('editarProspeccao', {
    capturar: () => ({
      __contexto: { prospeccaoEditar: prospeccao },
      contatos: form.getContatos(),
      contatosExcluidos: form.getExcluidos(),
      abaAtiva: form.abaAtiva(),
      responsavel: document.getElementById('prosResponsavel')?.value || '',
      pais: document.getElementById('endPais')?.value || '',
      estado: document.getElementById('endEstado')?.value || ''
    }),
    restaurar: async dados => {
      if (!dados) return;

      if (Array.isArray(dados.contatos) && dados.contatos.length) {
        form.setContatos(dados.contatos);
      }
      // Reaplica as exclusões por cima da lista recarregada do banco.
      const excluidos = Array.isArray(dados.contatosExcluidos) ? dados.contatosExcluidos : [];
      if (excluidos.length) {
        form.setExcluidos(excluidos);
        const removidos = new Set(excluidos.map(String));
        form.setContatos(form.getContatos().filter(c => !removidos.has(String(c.id))));
      }

      const repor = window.EstadoTrabalho?.reporSelect;
      if (repor) {
        await repor(document.getElementById('prosResponsavel'), dados.responsavel);
        if (dados.pais) {
          await repor(document.getElementById('endPais'), dados.pais);
          await repor(document.getElementById('endEstado'), dados.estado);
        }
      }

      if (dados.abaAtiva) form.activateTab(document.getElementById(dados.abaAtiva), { setFocus: false });
    }
  });

  // ---------------------------------------------------------------------
  // Salvar
  // ---------------------------------------------------------------------
  const salvar = async () => {
    const dados = form.coletarDados();
    if (!dados) return;

    try {
      const resp = await fetchApi(`/api/prospeccoes/${prospeccao.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
      const corpo = await resp.json().catch(() => ({}));

      if (resp.status === 403) {
        // Acontece quando o payload mexe em contatos e falta a permissão
        // específica — o backend cobra pros.contact.add/edit/remove conforme
        // o que veio no corpo.
        showToast(corpo.error || 'Você não tem permissão para esta alteração', 'error');
        return;
      }
      if (!resp.ok) throw new Error(corpo.error || 'Erro ao salvar prospecção');

      const recarregar = window.ProspeccoesModulo?.carregar;
      if (recarregar) await recarregar(true);
      else window.dispatchEvent(new Event('prospeccaoEditada'));
      showToast('Prospecção atualizada com sucesso!', 'success');
      close();
    } catch (err) {
      console.error('Erro ao salvar prospecção', err);
      showToast(err.message || 'Erro ao salvar prospecção', 'error');
    }
  };

  const botao = document.getElementById('salvarProspeccao');
  if (window.BotaoAcao?.bind) window.BotaoAcao.bind(botao, salvar);
  else botao?.addEventListener('click', salvar);
})();
