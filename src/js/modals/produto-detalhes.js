(function(){
  const overlay = document.getElementById('detalhesProdutoOverlay');
  const close = () => Modal.close('detalhesProduto');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  document.getElementById('fecharDetalhesProduto').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  (async () => {
    const item = window.produtoDetalhes;
    if(!item) return;
    try{
      const dados = await window.electronAPI.obterProduto(item.id);
      const info = { ...item, ...dados };
      document.getElementById('detCodigo').textContent = info.codigo || '';
      document.getElementById('detNome').textContent = info.nome || '';
      document.getElementById('detCategoria').textContent = info.categoria || '';
      document.getElementById('detPreco').textContent = info.preco_venda != null ? `R$ ${Number(info.preco_venda).toFixed(2).replace('.', ',')}` : '';
      document.getElementById('detMarkup').textContent = info.pct_markup != null ? `${Number(info.pct_markup).toFixed(1)}%` : '';
      document.getElementById('detStatus').textContent = info.status || '';
      document.getElementById('detQuantidade').textContent = info.quantidade_total ?? 0;
    }catch(err){
      console.error(err);
      showToast('Erro ao carregar detalhes', 'error');
    }
  })();
})();
