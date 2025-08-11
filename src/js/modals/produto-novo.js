(function(){
  const overlay = document.getElementById('novoProdutoOverlay');
  const close = () => Modal.close('novoProduto');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharNovoProduto').addEventListener('click', close);
  document.getElementById('cancelarNovoProduto').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  const form = document.getElementById('novoProdutoForm');
  document.getElementById('codigo').focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
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
      await window.electronAPI.adicionarProduto(dados);
      showToast('Produto criado com sucesso!', 'success');
      close();
      carregarProdutos();
    }catch(err){
      console.error(err);
      showToast('Erro ao criar produto', 'error');
    }
  });
})();
