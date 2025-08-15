;(function(){
  const close = () => Modal.close('excluirProcesso');

  document.getElementById('fecharExcluirProcesso').addEventListener('click', close);
  document.getElementById('cancelarExcluirProcesso').addEventListener('click', close);

  const select = document.getElementById('processoExcluir');
  (async () => {
    try {
      const processos = await window.electronAPI.listarEtapasProducao();
      processos.sort((a,b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      select.innerHTML = '<option value=""></option>' + processos.map(p => {
        const nome = p?.nome || p;
        return `<option value="${nome}">${nome}</option>`;
      }).join('');
      const setFilled = () => select.setAttribute('data-filled', select.value !== '');
      setFilled();
      select.addEventListener('change', setFilled);
      select.addEventListener('blur', setFilled);
    } catch (e) {
      console.error(e);
    }
  })();

  const confirmTxt = document.getElementById('confirmExcluirProcesso');
  let confirm = false;
  document.getElementById('excluirProcesso').addEventListener('click', async () => {
    const nome = select.value;
    if (!nome) return;
    if (!confirm) {
      try {
        const dependente = await window.electronAPI.verificarDependenciaProcesso(nome);
        if (dependente) {
          confirmTxt.textContent = 'Não é possível excluir este processo pois existem itens registrados.';
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
      await window.electronAPI.removerEtapaProducao(nome);
      const processos = await window.electronAPI.listarEtapasProducao();
      processos.sort((a,b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      document.querySelectorAll('select#processo').forEach(sel => {
        sel.innerHTML = '<option value=""></option>' + processos.map(p => {
          const nome = p?.nome || p;
          return `<option value="${nome}">${nome}</option>`;
        }).join('');
      });
      showToast('Processo excluído', 'success');
      close();
    } catch (err) {
      if (err.message === 'DEPENDENTE' || err.code === 'DEPENDENTE') {
        Modal.open('modals/materia-prima/dependencia.html', '../js/modals/materia-prima-dependencia.js', 'dependencia', true);
      } else {
        showToast('Erro ao excluir processo', 'error');
      }
    }
  });
})();
