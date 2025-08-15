;(function(){
  const close = () => Modal.close('excluirCategoria');

  document.getElementById('fecharExcluirCategoria').addEventListener('click', close);
  document.getElementById('cancelarExcluirCategoria').addEventListener('click', close);

  const select = document.getElementById('categoriaExcluir');
  (async () => {
    try {
      const categorias = await window.electronAPI.listarCategorias();
      select.innerHTML = '<option value=""></option>' + categorias.map(c => `<option value="${c}">${c}</option>`).join('');
      const setFilled = () => select.setAttribute('data-filled', select.value !== '');
      setFilled();
      select.addEventListener('change', setFilled);
      select.addEventListener('blur', setFilled);
    } catch (e) {
      console.error(e);
    }
  })();

  const confirmTxt = document.getElementById('confirmExcluirCategoria');
  let confirm = false;
  document.getElementById('excluirCategoria').addEventListener('click', async () => {
    const nome = select.value;
    if (!nome) return;
    if (!confirm) {
      confirmTxt.classList.remove('hidden');
      confirm = true;
      return;
    }
    try {
      await window.electronAPI.removerCategoria(nome);
      const categorias = await window.electronAPI.listarCategorias();
      document.querySelectorAll('select#categoria').forEach(sel => {
        sel.innerHTML = '<option value=""></option>' + categorias.map(c => `<option value="${c}">${c}</option>`).join('');
      });
      const filtro = document.getElementById('filtroCategoria');
      if (filtro) {
        const selecionada = filtro.value;
        filtro.innerHTML = '<option value="">Todas</option>' + categorias.map(c => `<option value="${c}">${c}</option>`).join("");
        if (!categorias.includes(selecionada)) filtro.value = '';
        filtro.dispatchEvent(new Event('change'));
      }
      showToast('Categoria excluída', 'success');
      close();
    } catch (err) {
      if (err.message === 'DEPENDENTE' || err.code === 'DEPENDENTE') {
        Modal.open('modals/materia-prima/dependencia.html', '../js/modals/materia-prima-dependencia.js', 'dependencia', true);
      } else {
        showToast('Erro ao excluir categoria', 'error');
      }
    }
  });
})();
