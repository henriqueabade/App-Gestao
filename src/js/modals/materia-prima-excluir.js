(function(){
  const overlay = document.getElementById('excluirInsumoOverlay');
  const close = () => Modal.close('excluirInsumo');

  // Sem devolver `window.materiaExcluir`, o modal reabre e o botão de confirmar
  // não faz nada (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.('excluirInsumo',
    () => ({ materiaExcluir: window.materiaExcluir }));

  document.getElementById('cancelarExcluirInsumo').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  document.getElementById('confirmarExcluirInsumo').addEventListener('click', async () => {
    const item = window.materiaExcluir;
    if(!item) return;
    try{
      await window.electronAPI.excluirMateriaPrima({
        id: item.id,
        __meta: {
          nome: item.nome,
          categoria: item.categoria,
          quantidade: item.quantidade,
          unidade: item.unidade,
          processo: item.processo
        }
      });
      showToast('Insumo excluído com sucesso!', 'success');
      close();
      Modal.close('editarInsumo');
      carregarMateriais();
    }catch(err){
      console.error(err);
      showToast('Erro ao excluir, insumo existe em um produto', 'error');
    }
  });
})();
