(function () {
  /**
   * Clique protegido: trava o segundo clique e mostra o carregando até a ação
   * terminar. Exclusão é irreversível e a resposta pode demorar — sem isso a
   * tela fica muda e convida a clicar de novo.
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

  const close = () => Modal.close('iaExcluir');

  // Sem devolver `window.iaLeituraExcluir`, o modal reabre depois de uma queda
  // e o botão de confirmar não faz nada (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.('iaExcluir',
    () => ({ iaLeituraExcluir: window.iaLeituraExcluir }));

  const leitura = window.iaLeituraExcluir;

  const nomeEl = document.getElementById('iaExcluirNome');
  if (nomeEl) {
    // textContent, não innerHTML: o título é texto livre do usuário.
    nomeEl.textContent = leitura?.titulo || (leitura?.id ? `#${leitura.id}` : 'selecionada');
  }

  if (leitura?.status === 'aplicada') {
    document.getElementById('iaExcluirAvisoAplicada')?.classList.remove('hidden');
  }

  document.getElementById('iaExcluirCancelar')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  aoConfirmar(document.getElementById('iaExcluirConfirmar'), async () => {
    if (!leitura?.id) return;
    try {
      const resp = await fetchApi(`/api/ia/${leitura.id}`, { method: 'DELETE' });
      const dados = await resp.json().catch(() => ({}));

      if (resp.ok) {
        // Tabela primeiro, aviso depois, e tudo sob o carregando do botão. Ao
        // contrário, o usuário lê "excluída com sucesso" com a linha ainda na
        // tela e conclui que não funcionou.
        const recarregar = window.IaModulo?.carregar;
        if (recarregar) await recarregar(true);
        else window.dispatchEvent(new Event('iaLeituraAlterada'));
        showToast('Leitura excluída com sucesso!', 'success');
      } else {
        // O backend recusa leitura já aplicada — a mensagem dele explica.
        showToast(dados.error || 'Erro ao excluir a leitura', 'error');
      }
      close();
    } catch (err) {
      console.error('Erro ao excluir a leitura de IA', err);
      showToast('Erro ao excluir a leitura', 'error');
      close();
    }
  });
})();
