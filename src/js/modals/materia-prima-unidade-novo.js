(function(){
  const overlay = document.getElementById('novaUnidadeOverlay');
  const close = () => Modal.close('novaUnidade');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharNovaUnidade').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});
  const form = document.getElementById('novaUnidadeForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const nome = form.nome.value.trim();
    if(!nome) return;
    try{
      const existentes = await window.electronAPI.listarUnidades();
      if(existentes.map(u => u.toLowerCase()).includes(nome.toLowerCase())){
        showToast('Unidade já cadastrada!', 'warning');
        close();
        return;
      }
      await window.electronAPI.adicionarUnidade(nome);
      showToast('Unidade adicionada com sucesso!', 'success');
      close();
      const unidades = await window.electronAPI.listarUnidades();
      document.querySelectorAll('select#unidade').forEach(sel => {
        sel.innerHTML = '<option value=""></option>' + unidades.map(u => `<option value="${u}">${u}</option>`).join('');
        sel.value = nome;
      });
    }catch(err){
      console.error(err);
      showToast('Erro ao adicionar unidade', 'error');
    }
  });
})();
