(function(){
  // Clique protegido: trava o segundo clique e mostra o carregando até a ação
  // terminar (o mesmo de cliente-excluir.js).
  const aoConfirmar = (el, handler) => {
    if (!el) return;
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(el, handler);
    else el.addEventListener('click', handler);
  };

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const close = () => Modal.close('excluirContato');

  // Sem devolver `window.contatoExcluir`, o modal reabre e o botão de confirmar
  // não faz nada (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.('excluirContato', () => ({ contatoExcluir: window.contatoExcluir }));

  document.getElementById('cancelarExcluirContato').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  aoConfirmar(document.getElementById('confirmarExcluirContato'), async () => {
    const contato = window.contatoExcluir;
    if(!contato) return;
    try{
      const resp = await fetchApi(`/api/contatos/${contato.id}`, { method: 'DELETE' });
      const data = await resp.json().catch(() => ({}));
      if(resp.ok){
        // Tabela primeiro, aviso depois, tudo sob o carregando do botão.
        if (typeof carregarContatos === 'function') await carregarContatos(true);
        else window.dispatchEvent(new Event('contatoExcluido'));
        showToast('Contato excluído com sucesso!', 'success');
        close();
      }else{
        showToast(data.error || 'Erro ao excluir contato', 'error');
        close();
      }
    }catch(err){
      console.error(err);
      showToast('Erro ao excluir contato', 'error');
      close();
    }
  });
})();
