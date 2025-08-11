(function(){
  const overlay = document.getElementById('detalhesProdutoOverlay');
  const close = () => Modal.close('detalhesProduto');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  document.getElementById('fecharDetalhesProduto').addEventListener('click', close);
  const voltar = document.getElementById('voltarDetalhesProduto');
  if (voltar) voltar.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });

  const item = window.produtoDetalhes;
  if(item){
    const titulo = document.getElementById('detalheTitulo');
    if(titulo) titulo.textContent = `DETALHE DE ESTOQUE – ${item.nome || ''}`;
  }
})();
