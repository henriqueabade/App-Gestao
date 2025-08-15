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

  document.getElementById('addCategoriaNovo').addEventListener('click', () => {
    Modal.open('modals/materia-prima/categoria-novo.html', '../js/modals/materia-prima-categoria-novo.js', 'novaCategoria', true);
  });
  document.getElementById('addUnidadeNovo').addEventListener('click', () => {
    Modal.open('modals/materia-prima/unidade-novo.html', '../js/modals/materia-prima-unidade-novo.js', 'novaUnidade', true);
  });
  document.getElementById('addProcessoNovo').addEventListener('click', () => {
    Modal.open('modals/materia-prima/processo-novo.html', '../js/modals/materia-prima-processo-novo.js', 'novoProcesso', true);
  });

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
      ['categoria','unidade','processo'].forEach(id=>{
        const el=form[id];
        if(!el) return;
        const sync = () => el.setAttribute('data-filled', el.value !== '');
        sync();
        el.addEventListener('change', sync);
        el.addEventListener('blur', sync);
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
