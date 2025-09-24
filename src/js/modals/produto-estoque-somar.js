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
      const quantidadeAtual = Number(info.existing.quantidade);
      await window.electronAPI.atualizarLoteProduto({
        id: info.existing.id,
        quantidade: novaQtd,
        __meta: {
          produto: info.produto,
          etapa: info.etapa || info.existing.etapa,
          itemNome: info.itemNome || info.existing.ultimo_item,
          quantidadeAnterior: isNaN(quantidadeAtual) ? undefined : quantidadeAtual,
          quantidadeNova: novaQtd,
          alteracao: isNaN(quantidadeAtual) ? undefined : novaQtd - quantidadeAtual
        }
      });
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
