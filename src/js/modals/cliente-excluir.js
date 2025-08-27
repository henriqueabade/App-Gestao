(function(){
  const overlay = document.getElementById('excluirClienteOverlay');
  const close = () => Modal.close('excluirCliente');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  document.getElementById('cancelarExcluirCliente').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  document.getElementById('confirmarExcluirCliente').addEventListener('click', async () => {
    const cliente = window.clienteExcluir;
    if(!cliente) return;
    try{
      const resp = await fetch(`http://localhost:3000/api/clientes/${cliente.id}`, { method: 'DELETE' });
      const data = await resp.json().catch(() => ({}));
      if(resp.ok){
        showToast('Cliente excluído com sucesso!', 'success');
        close();
        carregarClientes(true);
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
