(function(){
  const overlay = document.getElementById('novaCategoriaOverlay');
  const close = () => Modal.close('novaCategoria');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharNovaCategoria').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});
  const form = document.getElementById('novaCategoriaForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const nome = form.nome.value.trim();
    if(!nome) return;
    try{
      const existentes = await window.electronAPI.listarCategorias();
      if(existentes.map(c => (c.nome_categoria ?? c).toLowerCase()).includes(nome.toLowerCase())){
        showToast('Categoria já cadastrada!', 'warning');
        close();
        return;
      }
      await window.electronAPI.adicionarCategoria(nome);
      showToast('Categoria adicionada com sucesso!', 'success');
      close();
      const categorias = await window.electronAPI.listarCategorias();
      document.querySelectorAll('select#categoria').forEach(sel => {
        sel.innerHTML = '<option value=""></option>' + categorias.map(c => `<option value="${c}">${c}</option>`).join('');
        sel.value = nome;
      });
    }catch(err){
      console.error(err);
      showToast('Erro ao adicionar categoria', 'error');
    }
  });
})();
