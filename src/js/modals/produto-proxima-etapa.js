(function(){
  const overlay = document.getElementById('proximaEtapaOverlay');
  const fecharBtn = document.getElementById('fecharProximaEtapa');
  const voltarBtn = document.getElementById('voltarProximaEtapa');

  // Helper function to close this overlay and restore the underlying modal
  function closeOverlay(){
    Modal.close('proximaEtapa');
    // Reativa o modal principal removendo efeitos de bloqueio
    const baseOverlay = document.getElementById('editarProdutoOverlay');
    baseOverlay.classList.remove('pointer-events-none', 'blur-sm');
  }

  // Fecha ao clicar fora do conteúdo
  overlay.addEventListener('click', (e) => { if(e.target === overlay) closeOverlay(); });
  fecharBtn.addEventListener('click', closeOverlay);
  voltarBtn.addEventListener('click', closeOverlay);
})();
