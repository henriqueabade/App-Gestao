(function(){
  const overlay = document.getElementById('inserirEstoqueOverlay');
  const fecharBtn = document.getElementById('fecharInserirEstoque');
  const voltarBtn = document.getElementById('voltarInserirEstoque');

  function closeOverlay(){
    Modal.close('inserirEstoque');
    const baseOverlay = document.getElementById('detalhesProdutoOverlay');
    baseOverlay.classList.remove('pointer-events-none', 'blur-sm');
  }

  overlay.addEventListener('click', e => { if(e.target === overlay) closeOverlay(); });
  fecharBtn.addEventListener('click', closeOverlay);
  voltarBtn.addEventListener('click', closeOverlay);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ closeOverlay(); document.removeEventListener('keydown', esc); } });

  const form = overlay.querySelector('form');
  if(form){
    form.addEventListener('submit', e => {
      e.preventDefault();
      showToast('Funcionalidade em desenvolvimento', 'info');
    });
  }
})();
