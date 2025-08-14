(function(){
  const overlay = document.getElementById('editarInsumoOverlay');
  const close = () => Modal.close('editarInsumo');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharEditarInsumo').addEventListener('click', close);
  document.getElementById('cancelarEditarInsumo').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  const form = document.getElementById('editarInsumoForm');
  const quantidadeInput = form.quantidade;
  const infinitoCheckbox = form.infinito;
  const item = window.materiaSelecionada;
  if(item){
    form.nome.value = item.nome || '';
    quantidadeInput.value = item.quantidade || '';
    form.preco.value = item.preco_unitario || '';
    form.processo.value = item.processo || '';
    infinitoCheckbox.checked = !!item.infinito;
    form.descricao.value = item.descricao || '';
  }

  async function carregarOpcoes(){
    try{
      const categorias = await window.electronAPI.listarCategorias();
      form.categoria.innerHTML = '<option value="">Selecione</option>' + categorias.map(c => `<option value="${c}">${c}</option>`).join('');
      const unidades = await window.electronAPI.listarUnidades();
      form.unidade.innerHTML = '<option value="">Selecione</option>' + unidades.map(u => `<option value="${u}">${u}</option>`).join('');
      if(item){
        form.categoria.value = item.categoria || '';
        form.unidade.value = item.unidade || '';
      }
    }catch(err){
      console.error('Erro ao carregar opções', err);
    }
  }

  const toggleInfinito = () => {
    if (infinitoCheckbox.checked) {
      quantidadeInput.value = '∞';
      quantidadeInput.disabled = true;
    } else {
      quantidadeInput.disabled = false;
      if (!item || !item.quantidade) quantidadeInput.value = '';
    }
  };

  infinitoCheckbox.addEventListener('change', toggleInfinito);
  carregarOpcoes();
  toggleInfinito();

  document.getElementById('abrirExcluirInsumo').addEventListener('click', () => {
    window.materiaExcluir = item;
    Modal.open('modals/materia-prima/excluir.html', '../js/modals/materia-prima-excluir.js', 'excluirInsumo');
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const quantidade = infinitoCheckbox.checked ? null : parseFloat(form.quantidade.value);
    const dados = {
      nome: form.nome.value.trim(),
      categoria: form.categoria.value.trim(),
      quantidade,
      unidade: form.unidade.value.trim(),
      preco_unitario: parseFloat(form.preco.value),
      processo: form.processo.value.trim(),
      infinito: infinitoCheckbox.checked,
      descricao: form.descricao.value.trim()
    };
    if(!dados.nome || !dados.categoria || !dados.unidade || !dados.processo || (!infinitoCheckbox.checked && (isNaN(quantidade) || quantidade < 0)) || isNaN(dados.preco_unitario) || dados.preco_unitario < 0){
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
