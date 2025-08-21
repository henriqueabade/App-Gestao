(function(){
  const overlay = document.getElementById('excluirProdutoOverlay');
  const close = () => Modal.close('excluirProduto');
  function showErrorDialog(message){
    const ov=document.createElement('div');
    ov.className='fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4';
    ov.innerHTML=`<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-yellow-500/20 ring-1 ring-yellow-500/30 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-yellow-400">Atenção</h3><p class="text-sm text-gray-300 mb-6">${message}</p><div class="flex justify-center"><button id="errOk" class="btn-warning px-6 py-2 rounded-lg text-white font-medium active:scale-95">OK</button></div></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#errOk').addEventListener('click',()=>ov.remove());
  }
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('cancelarExcluirProduto').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  document.getElementById('confirmarExcluirProduto').addEventListener('click', async () => {
    const item = window.produtoExcluir;
    if(!item) return;
    try{
      await window.electronAPI.excluirProduto(item.id);
      showToast('Produto excluído com sucesso!', 'success');
      close();
      carregarProdutos();
    }catch(err){
      close();
      showErrorDialog(err.message || 'Erro ao excluir produto');
    }
  });
})();
