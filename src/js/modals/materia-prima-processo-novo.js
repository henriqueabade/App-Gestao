(function(){
  const overlay = document.getElementById('novoProcessoOverlay');
  const close = () => Modal.close('novoProcesso');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharNovoProcesso').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});
  const form = document.getElementById('novoProcessoForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const nome = form.nome.value.trim();
    const ordem = parseInt(form.ordem.value, 10);
    if(!nome || isNaN(ordem)) return;
    try{
      const existentes = await window.electronAPI.listarEtapasProducao();
      if(existentes.map(p => (p.nome ?? p).toLowerCase()).includes(nome.toLowerCase())){
        showToast('Processo já cadastrado!', 'warning');
        close();
        return;
      }
      if(existentes.some(p => Number(p.ordem) === ordem)){
        window.novoProcessoDados = { nome, ordem };
        Modal.open('modals/materia-prima/processo-ordem.html', '../js/modals/materia-prima-processo-ordem.js', 'ordemDuplicada', true);
        return;
      }
      await window.electronAPI.adicionarEtapaProducao({ nome, ordem });
      showToast('Processo adicionado com sucesso!', 'success');
      close();
      const processos = await window.electronAPI.listarEtapasProducao();
      processos.sort((a,b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      document.querySelectorAll('select#processo').forEach(sel => {
        const options = processos
          .map(p => {
            const nomeProc = p?.nome ?? p;
            return `<option value="${nomeProc}">${nomeProc}</option>`;
          })
          .join('');
        sel.innerHTML = '<option value=""></option>' + options;
        sel.value = nome;
        sel.setAttribute('data-filled', 'true');
      });
    }catch(err){
      console.error(err);
      showToast('Erro ao adicionar processo', 'error');
    }
  });
})();
