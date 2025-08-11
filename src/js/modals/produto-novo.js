(function(){
  const overlay = document.getElementById('novoProdutoOverlay');
  const close = () => Modal.close('novoProduto');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  document.getElementById('voltarNovoProduto').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });

  const limparBtn = document.getElementById('limparNovoProduto');
  if(limparBtn){
    limparBtn.addEventListener('click', () => {
      overlay.querySelectorAll('input').forEach(i => i.value = '');
      overlay.querySelectorAll('select').forEach(s => s.selectedIndex = 0);
    });
  }

  const registrarBtn = document.getElementById('registrarNovoProduto');
  if(registrarBtn){
    registrarBtn.addEventListener('click', () => {
      showToast('Funcionalidade em desenvolvimento', 'info');
    });
  }

  const dataHoraEl = document.getElementById('dataHoraProduto');
  if(dataHoraEl){
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    dataHoraEl.textContent = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
})();
