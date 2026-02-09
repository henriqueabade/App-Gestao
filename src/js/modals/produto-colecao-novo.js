(function(){
  const overlay = document.getElementById('novaColecaoOverlay');
  const close = () => Modal.close('novaColecao');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharNovaColecao').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});
  const form = document.getElementById('novaColecaoForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const nome = form.nome.value.trim();
    if(!nome) return;
    try{
      const existentes = await window.electronAPI.listarColecoes();
      if(existentes.map(c => c.toLowerCase()).includes(nome.toLowerCase())){
        showToast('Coleção já cadastrada!', 'warning');
        close();
        return;
      }
      await window.electronAPI.adicionarColecao(nome);
      showToast('Coleção adicionada com sucesso!', 'success');
      close();
      const colecoes = await window.electronAPI.listarColecoes();
      document.querySelectorAll('select#colecaoSelect').forEach(sel => {
        sel.innerHTML = '<option value="">Selecionar Coleção</option>' + colecoes.map(c => `<option value="${c}">${c}</option>`).join('');
        sel.value = nome;
      });
      window.dispatchEvent(new CustomEvent('colecaoAtualizada', { detail: { selecionada: nome } }));
    }catch(err){
      console.error(err);
      showToast('Erro ao adicionar coleção', 'error');
    }
  });
})();
