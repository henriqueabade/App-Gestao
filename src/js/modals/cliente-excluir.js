(function(){
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

  const overlay = document.getElementById('excluirClienteOverlay');
  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const close = () => Modal.close('excluirCliente');

  // Sem devolver `window.clienteExcluir`, o modal reabre e o botão de confirmar
  // não faz nada (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.('excluirCliente',
    () => ({ clienteExcluir: window.clienteExcluir }));

  document.getElementById('cancelarExcluirCliente').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  aoConfirmar(document.getElementById('confirmarExcluirCliente'), async () => {
    const cliente = window.clienteExcluir;
    if(!cliente) return;
    try{
      const resp = await fetchApi(`/api/clientes/${cliente.id}`, { method: 'DELETE' });
      const data = await resp.json().catch(() => ({}));
      if(resp.ok){
        // Tabela primeiro, aviso depois, e tudo sob o carregando do botão.
        // Ao contrário, o usuário lia "excluído com sucesso" com a linha ainda
        // na tela e concluía que não tinha funcionado.
        if (typeof carregarClientes === 'function') {
          await carregarClientes(true);
        } else {
          window.dispatchEvent(new Event('clienteExcluido'));
        }
        showToast('Cliente excluído com sucesso!', 'success');
        close();
      }else{
        showToast(data.error || 'Erro ao excluir cliente', 'error');
        close();
      }
    }catch(err){
      console.error(err);
      showToast('Erro ao excluir cliente', 'error');
      close();
    }
  });
})();
