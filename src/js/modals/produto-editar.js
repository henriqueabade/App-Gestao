(function(){
  const overlay = document.getElementById('editarProdutoOverlay');
  const close = () => Modal.close('editarProduto');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharEditarProduto').addEventListener('click', close);
  document.getElementById('cancelarEditarProduto').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  const form = document.getElementById('editarProdutoForm');
  const item = window.produtoSelecionado;
  if(item){
    form.codigo.value = item.codigo || '';
    form.nome.value = item.nome || '';
    form.categoria.value = item.categoria || '';
    form.preco.value = item.preco_venda || '';
    form.markup.value = item.pct_markup || '';
    form.status.value = item.status || '';
  }
  form.codigo.focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if(!item) return;
    const dados = {
      codigo: form.codigo.value.trim(),
      nome: form.nome.value.trim(),
      categoria: form.categoria.value.trim(),
      preco_venda: parseFloat(form.preco.value),
      pct_markup: form.markup.value ? parseFloat(form.markup.value) : null,
      status: form.status.value.trim()
    };
    if(!dados.codigo || !dados.nome || isNaN(dados.preco_venda)){
      showToast('Preencha os campos obrigatórios.', 'error');
      return;
    }
    try{
      await window.electronAPI.atualizarProduto(item.id, dados);
      showToast('Produto atualizado com sucesso!', 'success');
      close();
      carregarProdutos();
    }catch(err){
      console.error(err);
      showToast('Erro ao atualizar produto', 'error');
    }
  });
})();
