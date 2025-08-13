(function(){
  const overlay = document.getElementById('somarEstoqueOverlay');
  const close = () => Modal.close('somarEstoque');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  document.getElementById('cancelarSomarEstoque').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  document.getElementById('confirmarSomarEstoque').addEventListener('click', async () => {
    const info = window.somarEstoqueInfo;
    if(!info) return;
    try {
      const novaQtd = Number(info.existing.quantidade) + Number(info.adicionar);
      await window.electronAPI.atualizarLoteProduto({ id: info.existing.id, quantidade: novaQtd });
      showToast('Produto registrado', 'success');
      close();
      info.reload?.();
      window.somarEstoqueInfo = null;
    } catch(err){
      console.error(err);
      showToast('Erro ao atualizar lote', 'error');
    }
  });
})();
