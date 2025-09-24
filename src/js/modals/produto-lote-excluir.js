(function(){
  const overlay = document.getElementById('excluirLoteOverlay');
  const close = () => Modal.close('excluirLote');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('cancelarExcluirLote').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  document.getElementById('confirmarExcluirLote').addEventListener('click', async () => {
    const item = window.loteExcluir;
    if(!item) return;
    try {
      const payload = {
        id: item.id,
        __meta: {
          produto: item.produto,
          etapa: item.etapa,
          itemNome: item.itemNome,
          quantidade: item.quantidade
        }
      };
      await window.electronAPI.excluirLoteProduto(payload);
      showToast('Lote excluído', 'success');
      close();
      item.reload?.();
      window.loteExcluir = null;
    } catch (err) {
      console.error(err);
      showToast('Erro ao excluir lote', 'error');
    }
  });
})();
