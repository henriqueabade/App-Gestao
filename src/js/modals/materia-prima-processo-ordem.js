(function(){
  const overlay = document.getElementById('ordemDuplicadaOverlay');
  const trocarBtn = document.getElementById('trocarOrdem');
  const ultimaBtn = document.getElementById('ultimaOrdem');
  const cancelarBtn = document.getElementById('cancelarOrdem');

  function cleanup(){
    trocarBtn.removeEventListener('click', onTrocar);
    ultimaBtn.removeEventListener('click', onUltima);
    cancelarBtn.removeEventListener('click', close);
    overlay.removeEventListener('click', onOverlay);
  }

  const close = () => {
    cleanup();
    Modal.close('ordemDuplicada');
  };

  function onOverlay(e){ if(e.target === overlay) close(); }
  overlay.addEventListener('click', onOverlay);
  cancelarBtn.addEventListener('click', close);

  async function atualizarSelects(nome){
    const processos = await window.electronAPI.listarEtapasProducao();
    document.querySelectorAll('select#processo').forEach(sel => {
      const options = processos.map(p => {
        const n = p?.nome ?? p;
        return `<option value="${n}">${n}</option>`;
      }).join('');
      sel.innerHTML = '<option value=""></option>' + options;
      if(nome){
        sel.value = nome;
        sel.setAttribute('data-filled', 'true');
      }
    });
  }

  async function onTrocar(){
    const { nome, ordem } = window.novoProcessoDados;
    try {
      await window.electronAPI.adicionarEtapaProducao({ nome, ordem });
      showToast('Processo adicionado com sucesso!', 'success');
      await atualizarSelects(nome);
      Modal.close('novoProcesso');
      close();
    } catch(err){
      console.error(err);
      showToast('Erro ao adicionar processo', 'error');
    }
  }

  async function onUltima(){
    const { nome } = window.novoProcessoDados;
    try {
      await window.electronAPI.adicionarEtapaProducao({ nome });
      showToast('Processo adicionado com sucesso!', 'success');
      await atualizarSelects(nome);
      Modal.close('novoProcesso');
      close();
    } catch(err){
      console.error(err);
      showToast('Erro ao adicionar processo', 'error');
    }
  }

  trocarBtn.addEventListener('click', onTrocar, { once: true });
  ultimaBtn.addEventListener('click', onUltima, { once: true });
})();
