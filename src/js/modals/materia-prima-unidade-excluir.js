;(function(){
  const close = () => Modal.close('excluirUnidade');

  document.getElementById('fecharExcluirUnidade').addEventListener('click', close);
  document.getElementById('cancelarExcluirUnidade').addEventListener('click', close);

  const select = document.getElementById('unidadeExcluir');
  (async () => {
    try {
      const unidades = await window.electronAPI.listarUnidades();
      select.innerHTML = '<option value=""></option>' + unidades.map(u => `<option value="${u}">${u}</option>`).join('');
      const setFilled = () => select.setAttribute('data-filled', select.value !== '');
      setFilled();
      select.addEventListener('change', setFilled);
      select.addEventListener('blur', setFilled);
    } catch (e) {
      console.error(e);
    }
  })();

  const confirmTxt = document.getElementById('confirmExcluirUnidade');
  let confirm = false;
  document.getElementById('excluirUnidade').addEventListener('click', async () => {
    const nome = select.value;
    if (!nome) return;
    if (!confirm) {
      confirmTxt.classList.remove('hidden');
      confirm = true;
      return;
    }
    try {
      await window.electronAPI.removerUnidade(nome);
      const unidades = await window.electronAPI.listarUnidades();
      document.querySelectorAll('select#unidade').forEach(sel => {
        sel.innerHTML = '<option value=""></option>' + unidades.map(u => `<option value="${u}">${u}</option>`).join('');
      });
      showToast('Unidade excluída', 'success');
      close();
    } catch (err) {
      if (err.message === 'DEPENDENTE' || err.code === 'DEPENDENTE') {
        Modal.open('modals/materia-prima/dependencia.html', '../js/modals/materia-prima-dependencia.js', 'dependencia', true);
      } else {
        showToast('Erro ao excluir unidade', 'error');
      }
    }
  });
})();
