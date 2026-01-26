(function(){
  const overlay = document.getElementById('excluirClienteOverlay');
  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const close = () => Modal.close('excluirCliente');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  document.getElementById('cancelarExcluirCliente').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  document.getElementById('confirmarExcluirCliente').addEventListener('click', async () => {
    const cliente = window.clienteExcluir;
    if(!cliente) return;
    try{
      const resp = await fetchApi(`/api/clientes_laminacao/${cliente.id}`, { method: 'DELETE' });
      const data = await resp.json().catch(() => ({}));
      if(resp.ok){
        showToast('Cliente excluído com sucesso!', 'success');
        close();
        if (typeof carregarClientes === 'function') {
          await carregarClientes(true);
        } else {
          window.dispatchEvent(new Event('clienteExcluido'));
        }
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
