(function(){
  const overlay = document.getElementById('editarInsumoOverlay');
  const close = () => Modal.close('editarInsumo');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharEditarInsumo').addEventListener('click', close);
  document.getElementById('cancelarEditarInsumo').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  const form = document.getElementById('editarInsumoForm');
  const item = window.materiaSelecionada;
  if(item){
    form.nome.value = item.nome || '';
    form.categoria.value = item.categoria || '';
    form.quantidade.value = item.quantidade || '';
    form.unidade.value = item.unidade || '';
    form.preco.value = item.preco_unitario || '';
    form.processo.value = item.processo || '';
    form.infinito.checked = !!item.infinito;
    form.descricao.value = item.descricao || '';
  }
  document.getElementById('abrirExcluirInsumo').addEventListener('click', () => {
    window.materiaExcluir = item;
    Modal.open('modals/materia-prima/excluir.html', '../js/modals/materia-prima-excluir.js', 'excluirInsumo');
  });
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
      await window.electronAPI.atualizarMateriaPrima(item.id, dados);
      showToast('Insumo atualizado com sucesso!', 'success');
      close();
      carregarMateriais();
    }catch(err){
      console.error(err);
      showToast('Erro ao atualizar insumo', 'error');
    }
  });
})();
