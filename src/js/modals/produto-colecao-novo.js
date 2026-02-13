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
      const normalizarNomeColecao = (valor = '') =>
        String(valor)
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLowerCase();

      const existentes = await window.electronAPI.listarColecoes();
      const existentesNormalizadas = new Set(existentes.map(normalizarNomeColecao));
      if(existentesNormalizadas.has(normalizarNomeColecao(nome))){
        showToast('Coleção já cadastrada!', 'warning');
        close();
        return;
      }
      const resultado = await window.electronAPI.adicionarColecao(nome);
      const nomeSelecionado =
        (typeof resultado === 'string' ? resultado : resultado?.nome) || nome;

      showToast('Coleção adicionada com sucesso!', 'success');
      close();

      // Atualiza imediatamente o select do modal pai
      window.dispatchEvent(new CustomEvent('colecaoAtualizada', {
        detail: {
          selecionada: nomeSelecionado
        }
      }));

    }catch(err){
      console.error(err);
      showToast('Erro ao adicionar coleção', 'error');
    }
  });
})();
