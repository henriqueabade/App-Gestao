;(function(){
  const close = () => Modal.close('excluirColecao');

  document.getElementById('fecharExcluirColecao').addEventListener('click', close);
  document.getElementById('cancelarExcluirColecao').addEventListener('click', close);

  const select = document.getElementById('colecaoExcluir');
  (async () => {
    try {
      const colecoes = await window.electronAPI.listarColecoes();
      select.innerHTML = '<option value=""></option>' + colecoes.map(c => `<option value="${c}">${c}</option>`).join('');
      const setFilled = () => select.setAttribute('data-filled', select.value !== '');
      setFilled();
      select.addEventListener('change', setFilled);
      select.addEventListener('blur', setFilled);
    } catch (e) {
      console.error(e);
    }
  })();

  const confirmTxt = document.getElementById('confirmExcluirColecao');
  let confirm = false;
  document.getElementById('excluirColecao').addEventListener('click', async () => {
    const nome = select.value;
    if (!nome) return;
    if (!confirm) {
      try {
        const dependente = await window.electronAPI.verificarDependenciaColecao(nome);
        if (dependente) {
          confirmTxt.textContent = 'Não é possível excluir esta coleção pois existem itens registrados.';
          confirmTxt.classList.remove('text-red-400');
          confirmTxt.classList.add('text-yellow-400');
          confirmTxt.classList.remove('hidden');
          return;
        }
      } catch (err) {
        console.error(err);
        return;
      }
      confirmTxt.textContent = 'Esta ação é irreversível. Clique em excluir novamente para confirmar.';
      confirmTxt.classList.remove('text-yellow-400');
      confirmTxt.classList.add('text-red-400');
      confirmTxt.classList.remove('hidden');
      confirm = true;
      return;
    }
    try {
      const resultado = await window.electronAPI.removerColecao(nome);
      const nomeRemovido =
        (typeof resultado === 'string' ? resultado : resultado?.nome) || nome;

      window.dispatchEvent(new CustomEvent('colecaoAtualizada', {
        detail: {
          removida: nomeRemovido
        }
      }));

      showToast('Coleção excluída', 'success');
      close();
    } catch (err) {
      if (err.message === 'DEPENDENTE' || err.code === 'DEPENDENTE') {
        Modal.open('modals/materia-prima/dependencia.html', '../js/modals/materia-prima-dependencia.js', 'dependencia', true);
      } else {
        showToast('Erro ao excluir coleção', 'error');
      }
    }
  });
})();
