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
    if(!nome) return;
    try{
      const existentes = await window.electronAPI.listarEtapasProducao();
      if(existentes.map(p => (p.nome ?? p).toLowerCase()).includes(nome.toLowerCase())){
        showToast('Processo já cadastrado!', 'warning');
        close();
        return;
      }
      await window.electronAPI.adicionarEtapaProducao(nome);
      showToast('Processo adicionado com sucesso!', 'success');
      close();
      const processos = await window.electronAPI.listarEtapasProducao();
      document.querySelectorAll('select#processo').forEach(sel => {
        sel.innerHTML = '<option value=""></option>' + processos.map(p => `<option value="${p.nome}">${p.nome}</option>`).join('');
        sel.value = nome;
        sel.setAttribute('data-filled', 'true');
      });
    }catch(err){
      console.error(err);
      showToast('Erro ao adicionar processo', 'error');
    }
  });
})();
