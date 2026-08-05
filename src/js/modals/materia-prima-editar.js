(function(){
  const overlay = document.getElementById('editarInsumoOverlay');
  const close = () => Modal.close('editarInsumo');
  document.getElementById('fecharEditarInsumo').addEventListener('click', close);
  document.getElementById('cancelarEditarInsumo').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  const form = document.getElementById('editarInsumoForm');
  const quantidadeInput = form.quantidade;
  const infinitoCheckbox = form.infinito;
  const item = window.materiaSelecionada;

  // ------------------------------------------------------------------
  // Preservação do trabalho (ver docs/restauracao-de-trabalho.md)
  //
  // Duas coisas se perdiam aqui:
  //  1. QUAL insumo está sendo editado — o script lê `window.materiaSelecionada`,
  //     definido pela grade. Sem isso o modal reabria em branco e salvaria por
  //     cima de um insumo indefinido. Vai no `__contexto`.
  //  2. Categoria, Unidade e Processo, preenchidos por `fetch`: atribuir `value`
  //     antes das <option> chegarem não faz nada.
  // O restante dos campos volta pela varredura genérica.
  // ------------------------------------------------------------------
  window.EstadoTrabalho?.registrarConteudo?.('editarInsumo', {
    capturar: () => ({
      __contexto: { materiaSelecionada: item },
      categoria: form.categoria?.value || '',
      unidade: form.unidade?.value || '',
      processo: form.processo?.value || ''
    }),
    restaurar: async (dados) => {
      const repor = window.EstadoTrabalho?.reporSelect;
      if (!repor || !dados) return;
      await Promise.all([
        repor(form.categoria, dados.categoria),
        repor(form.unidade, dados.unidade),
        repor(form.processo, dados.processo)
      ]);
    }
  });

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
  /** Ver a nota gêmea em materia-prima-novo.js. */
  async function recarregarGrade() {
    try {
      if (typeof carregarMateriais === 'function') await carregarMateriais();
    } catch (err) {
      console.error('Falha ao recarregar a lista de insumos', err);
    }
  }

  // Ver a nota em materia-prima-novo.js: `bindSubmit` trava o reenvio e mostra
  // o carregamento, que é o que faltava para o usuário saber que salvou.
  async function salvar() {
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
      const metaAntes = item ? {
        nome: item.nome,
        categoria: item.categoria,
        quantidade: item.infinito ? null : Number(item.quantidade),
        unidade: item.unidade,
        preco_unitario: item.preco_unitario,
        processo: item.processo,
        infinito: !!item.infinito,
        descricao: item.descricao
      } : null;
      const payload = metaAntes ? { ...dados, __meta: { antes: metaAntes } } : dados;
      await window.electronAPI.atualizarMateriaPrima(item.id, payload);
      await recarregarGrade();
      showToast('Insumo atualizado com sucesso!', 'success');
      close();
    }catch(err){
      console.error(err);
      if (err.message === 'DUPLICADO' || err.code === 'DUPLICADO') {
        Modal.open('modals/materia-prima/duplicado.html', '../js/modals/materia-prima-duplicado.js', 'duplicado', true);
      } else {
        // Antes qualquer erro virava "insumo já existe", o que mandava procurar
        // um duplicado inexistente quando o problema era outro.
        showToast(err?.message || 'Não foi possível atualizar o insumo.', 'error');
      }
    }
  }

  if (window.BotaoAcao?.bindSubmit) {
    window.BotaoAcao.bindSubmit(form, salvar);
  } else {
    form.addEventListener('submit', e => { e.preventDefault(); salvar(); });
  }
})();
