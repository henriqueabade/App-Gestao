(function(){
  const overlay = document.getElementById('novoInsumoOverlay');
  const close = () => Modal.close('novoInsumo');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharNovoInsumo').addEventListener('click', close);
  document.getElementById('cancelarNovoInsumo').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  const form = document.getElementById('novoInsumoForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const dados = {
      nome: form.nome.value.trim(),
      categoria: form.categoria.value.trim(),
      quantidade: parseFloat(form.quantidade.value),
      unidade: form.unidade.value.trim(),
      preco_unitario: parseFloat(form.preco.value),
      processo: form.processo.value.trim(),
      infinito: form.infinito.checked,
      descricao: form.descricao.value.trim()
    };
    if(!dados.nome || !dados.categoria || !dados.unidade || !dados.processo || isNaN(dados.quantidade) || dados.quantidade < 0 || isNaN(dados.preco_unitario) || dados.preco_unitario < 0){
      showToast('Verifique os campos obrigatórios.', 'error');
      return;
    }
    try{
      await window.electronAPI.adicionarMateriaPrima(dados);
      showToast('Insumo criado com sucesso!', 'success');
      close();
      carregarMateriais();
    }catch(err){
      console.error(err);
      showToast('Erro ao criar insumo', 'error');
    }
  });
})();
