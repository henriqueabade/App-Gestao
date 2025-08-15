(function(){
  const overlay = document.getElementById('ordemDuplicadaOverlay');
  const close = () => Modal.close('ordemDuplicada');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('cancelarOrdem').addEventListener('click', close);

  async function atualizarSelects(nome){
    const processos = await window.electronAPI.listarEtapasProducao();
    processos.sort((a,b) => (a.ordem ?? 0) - (b.ordem ?? 0));
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

  document.getElementById('trocarOrdem').addEventListener('click', async () => {
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
  });

  document.getElementById('ultimaOrdem').addEventListener('click', async () => {
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
  });
})();
