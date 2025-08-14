(function(){
  const overlay = document.getElementById('novoInsumoOverlay');
  const close = () => Modal.close('novoInsumo');
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('fecharNovoInsumo').addEventListener('click', close);
  document.getElementById('cancelarNovoInsumo').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  const form = document.getElementById('novoInsumoForm');
  const quantidadeInput = form.quantidade;
  const infinitoCheckbox = form.infinito;

  async function carregarOpcoes(){
    try{
      const categorias = await window.electronAPI.listarCategorias();
      form.categoria.innerHTML = '<option value="">Selecione</option>' + categorias.map(c => `<option value="${c}">${c}</option>`).join('');
      const unidades = await window.electronAPI.listarUnidades();
      form.unidade.innerHTML = '<option value="">Selecione</option>' + unidades.map(u => `<option value="${u}">${u}</option>`).join('');
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
      quantidadeInput.value = '';
    }
  };

  infinitoCheckbox.addEventListener('change', toggleInfinito);

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
      await window.electronAPI.adicionarMateriaPrima(dados);
      showToast('Insumo criado com sucesso!', 'success');
      close();
      carregarMateriais();
    }catch(err){
      console.error(err);
      showToast('Erro ao criar insumo', 'error');
    }
  });

  carregarOpcoes();
  toggleInfinito();
})();
