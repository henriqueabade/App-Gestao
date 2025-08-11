(function(){
  const overlay = document.getElementById('entradaInsumoOverlay');
  const close = () => Modal.close('entradaInsumo');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('cancelarEntradaInsumo').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  const form = document.getElementById('entradaInsumoForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const quantidade = parseFloat(form.quantidade.value);
    if(isNaN(quantidade) || quantidade <= 0){
      showToast('Informe uma quantidade válida.', 'error');
      return;
    }
    try{
      const item = window.materiaSelecionada;
      await window.electronAPI.registrarEntrada(item.id, quantidade);
      showToast('Entrada registrada com sucesso!', 'success');
      close();
      carregarMateriais();
    }catch(err){
      console.error(err);
      showToast('Erro ao registrar entrada', 'error');
    }
  });
})();
