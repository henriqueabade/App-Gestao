(function(){
  const overlay = document.getElementById('novoInsumoOverlay');
  const close = () => Modal.close('novoInsumo');
  document.getElementById('fecharNovoInsumo').addEventListener('click', close);
  document.getElementById('cancelarNovoInsumo').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  const form = document.getElementById('novoInsumoForm');

  document.getElementById('addCategoriaNovo').addEventListener('click', () => {
    Modal.open('modals/materia-prima/categoria-novo.html', '../js/modals/materia-prima-categoria-novo.js', 'novaCategoria', true);
  });
  document.getElementById('delCategoriaNovo').addEventListener('click', () => {
    Modal.open('modals/materia-prima/categoria-excluir.html', '../js/modals/materia-prima-categoria-excluir.js', 'excluirCategoria', true);
  });
  document.getElementById('addUnidadeNovo').addEventListener('click', () => {
    Modal.open('modals/materia-prima/unidade-novo.html', '../js/modals/materia-prima-unidade-novo.js', 'novaUnidade', true);
  });
  document.getElementById('delUnidadeNovo').addEventListener('click', () => {
    Modal.open('modals/materia-prima/unidade-excluir.html', '../js/modals/materia-prima-unidade-excluir.js', 'excluirUnidade', true);
  });
  document.getElementById('addProcessoNovo').addEventListener('click', () => {
    Modal.open('modals/materia-prima/processo-novo.html', '../js/modals/materia-prima-processo-novo.js', 'novoProcesso', true);
  });
  document.getElementById('delProcessoNovo').addEventListener('click', () => {
    Modal.open('modals/materia-prima/processo-excluir.html', '../js/modals/materia-prima-processo-excluir.js', 'excluirProcesso', true);
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

  // ------------------------------------------------------------------
  // Preservação do trabalho (ver docs/restauracao-de-trabalho.md)
  //
  // Nome, quantidade, preço e descrição voltam pela varredura genérica. O que
  // ela NÃO alcança são Categoria, Unidade e Processo: os três são preenchidos
  // por `fetch` em `carregarOpcoes()`, e atribuir `value` antes das <option>
  // chegarem não faz nada — o navegador descarta em silêncio.
  // ------------------------------------------------------------------
  window.EstadoTrabalho?.registrarConteudo?.('novoInsumo', {
    capturar: () => ({
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

  // `BotaoAcao.bindSubmit` e não `addEventListener('submit')`: ele trava o
  // reenvio (clique repetido E Enter) e deixa o botão carregando até a promessa
  // terminar. Sem isso o salvamento acontecia em silêncio — o insumo entrava no
  // banco e a tela não dava sinal nenhum de que algo estava em curso.
  async function salvar() {
    const quantidade = parseFloat(form.quantidade.value);
    const dados = {
      nome: form.nome.value.trim(),
      categoria: form.categoria.value.trim(),
      quantidade,
      unidade: form.unidade.value.trim(),
      preco_unitario: parseFloat(form.preco.value),
      processo: form.processo.value.trim(),
      infinito: false,
      descricao: form.descricao.value.trim()
    };
    if(!dados.nome || !dados.categoria || !dados.unidade || !dados.processo || isNaN(quantidade) || quantidade < 0 || isNaN(dados.preco_unitario) || dados.preco_unitario < 0){
      showToast('Verifique os campos obrigatórios.', 'error');
      return;
    }
    try{
      await window.electronAPI.adicionarMateriaPrima(dados);
      showToast('Insumo registrado com sucesso!', 'success');
      close();
      // A grade do módulo tem de refletir o que acabou de entrar. Sem `await`
      // aqui o modal fechava antes de a lista recarregar e o insumo novo só
      // aparecia depois de trocar de tela.
      if (typeof carregarMateriais === 'function') await carregarMateriais();
    }catch(err){
      console.error(err);
      if (err.message === 'DUPLICADO' || err.code === 'DUPLICADO') {
        Modal.open('modals/materia-prima/duplicado.html', '../js/modals/materia-prima-duplicado.js', 'duplicado', true);
      } else {
        // A mensagem antiga afirmava "insumo já existe" para QUALQUER falha —
        // inclusive queda de rede —, mandando o usuário procurar um duplicado
        // que não existe. O duplicado tem caminho próprio, logo acima.
        showToast(err?.message || 'Não foi possível registrar o insumo.', 'error');
      }
    }
  }

  if (window.BotaoAcao?.bindSubmit) {
    window.BotaoAcao.bindSubmit(form, salvar);
  } else {
    form.addEventListener('submit', e => { e.preventDefault(); salvar(); });
  }

  carregarOpcoes();
})();
