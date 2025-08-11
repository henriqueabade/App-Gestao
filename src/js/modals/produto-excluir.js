(function(){
  const overlay = document.getElementById('excluirProdutoOverlay');
  const close = () => Modal.close('excluirProduto');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('cancelarExcluirProduto').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  document.getElementById('confirmarExcluirProduto').addEventListener('click', async () => {
    const item = window.produtoExcluir;
    if(!item) return;
    try{
      await window.electronAPI.excluirProduto(item.id);
      showToast('Produto excluído com sucesso!', 'success');
      close();
      carregarProdutos();
    }catch(err){
      console.error(err);
      showToast('Erro ao excluir produto', 'error');
    }
  });
})();
