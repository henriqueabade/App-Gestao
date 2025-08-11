(function(){
  const overlay = document.getElementById('excluirInsumoOverlay');
  const close = () => Modal.close('excluirInsumo');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('cancelarExcluirInsumo').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  document.getElementById('confirmarExcluirInsumo').addEventListener('click', async () => {
    const item = window.materiaExcluir;
    if(!item) return;
    try{
      await window.electronAPI.excluirMateriaPrima(item.id);
      showToast('Insumo excluído com sucesso!', 'success');
      close();
      Modal.close('editarInsumo');
      carregarMateriais();
    }catch(err){
      console.error(err);
      showToast('Erro ao excluir insumo', 'error');
    }
  });
})();
