(function(){
  const overlay = document.getElementById('precoInsumoOverlay');
  const close = () => Modal.close('precoInsumo');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('cancelarPrecoInsumo').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  const form = document.getElementById('precoInsumoForm');
  const item = window.materiaSelecionada;
  if(item){
    form.preco.value = item.preco_unitario || '';
  }
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const preco = parseFloat(form.preco.value);
    if(isNaN(preco) || preco < 0){
      showToast('Informe um preço válido.', 'error');
      return;
    }
    try{
      await window.electronAPI.atualizarPreco(item.id, preco);
      showToast('Preço atualizado com sucesso!', 'success');
      close();
      carregarMateriais();
    }catch(err){
      console.error(err);
      showToast('Erro ao atualizar preço', 'error');
    }
  });
})();
