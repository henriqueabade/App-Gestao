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

  document.getElementById('addCategoriaEditar').addEventListener('click', () => {
    Modal.open('modals/materia-prima/categoria-novo.html', '../js/modals/materia-prima-categoria-novo.js', 'novaCategoria', true);
  });
  document.getElementById('delCategoriaEditar').addEventListener('click', () => {
    Modal.open('modals/materia-prima/categoria-excluir.html', '../js/modals/materia-prima-categoria-excluir.js', 'excluirCategoria', true);
  });
  document.getElementById('addUnidadeEditar').addEventListener('click', () => {
    Modal.open('modals/materia-prima/unidade-novo.html', '../js/modals/materia-prima-unidade-novo.js', 'novaUnidade', true);
  });
  document.getElementById('delUnidadeEditar').addEventListener('click', () => {
    Modal.open('modals/materia-prima/unidade-excluir.html', '../js/modals/materia-prima-unidade-excluir.js', 'excluirUnidade', true);
  });
  document.getElementById('addProcessoEditar').addEventListener('click', () => {
    Modal.open('modals/materia-prima/processo-novo.html', '../js/modals/materia-prima-processo-novo.js', 'novoProcesso', true);
  });
  document.getElementById('delProcessoEditar').addEventListener('click', () => {
    Modal.open('modals/materia-prima/processo-excluir.html', '../js/modals/materia-prima-processo-excluir.js', 'excluirProcesso', true);
  });
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
      form.categoria.innerHTML = '<option value=""></option>' +
        categorias.map(c => {
          const nome = c?.nome_categoria ?? c;
          return `<option value="${nome}">${nome}</option>`;
        }).join('');
      const unidades = await window.electronAPI.listarUnidades();
      form.unidade.innerHTML = '<option value=""></option>' +
        unidades.map(u => {
          const tipo = u?.tipo ?? u;
          return `<option value="${tipo}">${tipo}</option>`;
        }).join('');
      const processos = await window.electronAPI.listarEtapasProducao();
      processos.sort((a,b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      form.processo.innerHTML = '<option value=""></option>' +
        processos.map(p => {
          const nome = p?.nome ?? p;
          return `<option value="${nome}">${nome}</option>`;
        }).join('');
      if(item){
        form.categoria.value = item.categoria || '';
        form.unidade.value = item.unidade || '';
        form.processo.value = item.processo || '';
      }
      ['categoria','unidade','processo'].forEach(id=>{
        const el=form[id];
        if(el) el.setAttribute('data-filled', el.value !== '');
      });
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
  carregarOpcoes().finally(() => {
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'editarInsumo' }));
  });
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
