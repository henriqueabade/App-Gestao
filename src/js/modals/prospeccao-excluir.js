(function () {
  /**
   * Clique protegido: trava o segundo clique e mostra o carregando até a ação
   * terminar. Exclusão é irreversível e a resposta pode demorar — sem isso a
   * tela ficava muda e convidava a clicar de novo.
   */
  const aoConfirmar = (el, handler) => {
    if (!el) return;
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(el, handler);
    else el.addEventListener('click', handler);
  };

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const close = () => Modal.close('excluirProspeccao');

  // Sem devolver `window.prospeccaoExcluir`, o modal reabre após uma queda e o
  // botão de confirmar não faz nada (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.('excluirProspeccao',
    () => ({ prospeccaoExcluir: window.prospeccaoExcluir }));

  const prospeccao = window.prospeccaoExcluir;

  const nomeEl = document.getElementById('excluirProspeccaoNome');
  if (nomeEl) {
    // textContent, não innerHTML: o nome da empresa é texto livre do usuário.
    nomeEl.textContent = prospeccao?.nome_fantasia || prospeccao?.razao_social || 'selecionada';
  }

  document.getElementById('cancelarExcluirProspeccao')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  aoConfirmar(document.getElementById('confirmarExcluirProspeccao'), async () => {
    if (!prospeccao?.id) return;
    try {
      const resp = await fetchApi(`/api/prospeccoes/${prospeccao.id}`, { method: 'DELETE' });
      const dados = await resp.json().catch(() => ({}));

      if (resp.ok) {
        // Tabela primeiro, aviso depois, e tudo sob o carregando do botão. Ao
        // contrário, o usuário lia "excluída com sucesso" com a linha ainda na
        // tela e concluía que não tinha funcionado.
        // Pelo objeto publicado: menu.js embrulha o script do módulo numa
        // IIFE e `carregarProspeccoes` não existe neste escopo.
        const recarregar = window.ProspeccoesModulo?.carregar;
        if (recarregar) await recarregar(true);
        else window.dispatchEvent(new Event('prospeccaoExcluida'));
        showToast('Prospecção excluída com sucesso!', 'success');
      } else {
        // O backend recusa quando a prospecção já virou cliente ou tem
        // orçamento vinculado — a mensagem dele explica o porquê.
        showToast(dados.error || 'Erro ao excluir prospecção', 'error');
      }
      close();
    } catch (err) {
      console.error('Erro ao excluir prospecção', err);
      showToast('Erro ao excluir prospecção', 'error');
      close();
    }
  });
})();
