(function(){
  const overlay = document.getElementById('detalhesProdutoOverlay');
  const close = () => Modal.close('detalhesProduto');
  const voltar = document.getElementById('voltarDetalhesProduto');
  if (voltar) voltar.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });

  const inserirBtn = document.getElementById('abrirInserirEstoque');
  if (inserirBtn) inserirBtn.addEventListener('click', () => {
    overlay.classList.add('pointer-events-none', 'blur-sm');
    Modal.open('modals/produtos/estoque-inserir.html', '../js/modals/produto-estoque-inserir.js', 'inserirEstoque', true);
  });

  const item = window.produtoDetalhes;

  // Sem devolver `window.produtoDetalhes`, o modal reabre sem título, sem
  // código e sem lotes (ver docs/restauracao-de-trabalho.md). O conteúdo em si
  // vem do banco a cada abertura, então não há mais nada a repor.
  window.EstadoTrabalho?.registrarContexto?.('detalhesProduto',
    () => ({ produtoDetalhes: item }));

  /**
   * O modal só aparece com os lotes JÁ na tela.
   *
   * Antes o aviso de "carregado" era disparado assim que o título ficava
   * pronto, e a busca dos lotes seguia depois: o modal abria vazio e as linhas
   * pipocavam alguns segundos mais tarde — o que se lê como tela quebrada, não
   * como carregamento.
   *
   * Dispara uma vez só, e SEMPRE: se a consulta falhar ou demorar, é melhor
   * abrir com a tabela vazia (e o erro no console) do que ficar girando para
   * sempre.
   */
  let prontoAvisado = false;
  let redeDeSeguranca = null;
  const avisarPronto = () => {
    if (prontoAvisado) return;
    prontoAvisado = true;
    if (redeDeSeguranca) clearTimeout(redeDeSeguranca);
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesProduto' }));
  };

  // Se a consulta travar, o modal abre assim mesmo. Trocar um modal vazio por
  // um spinner eterno seria piorar: aqui o pior caso volta a ser o de antes —
  // a tabela chega depois —, e só quando algo realmente deu errado.
  const ESPERA_MAXIMA_MS = 15000;

  if(item){
    const titulo = document.getElementById('detalheTitulo');
    if(titulo) titulo.textContent = `DETALHE DE ESTOQUE – ${item.nome || ''}`;
    const codigoEl = document.getElementById('codigoPeca');
    if(codigoEl) codigoEl.textContent = `Código da Peça: ${item.codigo || ''}`; // subtítulo mostra código da peça
    window.reloadDetalhesProduto = () => carregarDetalhes(item.id);
    if (isProdutoIdValido(item.id)) {
      redeDeSeguranca = setTimeout(avisarPronto, ESPERA_MAXIMA_MS);
      carregarDetalhes(item.id).finally(avisarPronto);
    } else {
      avisarPronto();
    }
  } else {
    avisarPronto();
  }

  async function carregarDetalhes(id){
    try {
      const produtoIdNum = Number(id);
      if (!isProdutoIdValido(produtoIdNum)) {
        console.error('Produto ID inválido para carregar detalhes', { produtoId: id });
        return;
      }
      const { lotes = [] } = await window.electronAPI.listarDetalhesProduto({
        produtoId: produtoIdNum
      });

      const dados = Array.isArray(lotes) ? lotes : [];

      item.lotes = dados;
      const tbody = document.getElementById('detalhesTableBody');
      if(!tbody) return;
      tbody.innerHTML = '';

      if (dados.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" class="py-12 text-center text-gray-400">
              <div class="flex flex-col items-center justify-center gap-3">
                <i class="fas fa-box-open text-5xl text-[var(--color-primary)]"></i>
                <p class="text-sm">Não há produtos em estoque.</p>
              </div>
            </td>
          </tr>
        `;
      }

      let total = 0;
      dados.forEach(d => {
        total += Number(d.quantidade || 0);
        const tr = document.createElement('tr');
        tr.className = 'border-b border-white/5 hover:bg-white/5 transition';
        const origemInsumo = d._origem === 'insumo';
        tr.innerHTML = `
          <td data-perm-col="col_est_processo" class="py-4 px-4 text-gray-300">${d.etapa || ''}</td>
          <td data-perm-col="col_est_ultimo_item" class="py-4 px-4 text-white font-medium">${d.ultimo_item || ''}</td>
          <td data-perm-col="col_est_quantidade" class="py-4 px-4 text-left text-white font-medium">${d.quantidade ?? ''}</td>
          <td data-perm-col="col_est_alterado_em" class="py-4 px-4 text-gray-300">${origemInsumo ? '—' : formatDateTime(d.data_hora_completa)}</td>
          <td class="py-4 px-4 text-left">
            <div class="flex items-center justify-start space-x-2">
              ${origemInsumo
                ? '<span class="text-xs text-gray-400">Somente visualização</span>'
                : '<i data-perm="prod.stock.adjust" class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i><i data-perm="prod.stock.lote.delete" class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)" title="Excluir"></i>'
              }
            </div>
          </td>
        `;
        const editBtn = tr.querySelector('.fa-edit');
        const delBtn = tr.querySelector('.fa-trash');
        if (editBtn && !origemInsumo) editBtn.addEventListener('click', () => editarLinha(tr, d));
        if (delBtn && !origemInsumo) delBtn.addEventListener('click', () => excluirLote(d));
        tbody.appendChild(tr);
      });
      const totalEl = document.getElementById('totalEstoque');
      if (totalEl) totalEl.textContent = total;
      const lotesEl = document.getElementById('lotesAtivos');
      if (lotesEl) lotesEl.textContent = dados.length;
      const valorEl = document.getElementById('valorEstimado');
      const preco = Number(item?.preco_venda || 0);
      if (valorEl) valorEl.textContent = (total * preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } catch(err) {
      console.error('Erro ao carregar detalhes do produto', err);
    }
  }

  function editarLinha(tr, dados) {
    const qtdCell = tr.children[2];
    const actionsCell = tr.children[4];
    const original = dados.quantidade;
    qtdCell.innerHTML = `<input type="number" class="w-20 bg-transparent border-b border-white/20 text-left text-white focus:outline-none" value="${original}">`;
    actionsCell.innerHTML = `
      <div class="flex items-center justify-center space-x-2">
        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-green)" title="Confirmar"></i>
        <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)" title="Cancelar"></i>
      </div>`;
    const input = qtdCell.querySelector('input');
    const [confirmBtn, cancelBtn] = actionsCell.querySelectorAll('i');
    confirmBtn.addEventListener('click', async () => {
      const novaQtd = Number(input.value);
      const quantidadeAtual = Number(original);
      const diferenca = novaQtd - (isNaN(quantidadeAtual) ? 0 : quantidadeAtual);

      // Mexer no número de peças à mão é afirmar que peças passaram a existir
      // (ou deixaram de existir). O material que corresponde a elas tem de
      // acompanhar — ou não, se for correção de inventário. Quem registra
      // decide, aqui, antes de gravar.
      let ajustarInsumos = false;
      let justificativaNegativo = null;
      if (diferenca !== 0) {
        const direcao = diferenca > 0 ? 'saida' : 'entrada';
        const decisao = await window.InsumosDaPeca?.decidir({
          direcao,
          unidades: Math.abs(diferenca),
          peca: item?.nome || item?.codigo || '',
          ponto: `${dados.etapa || ''} · ${dados.ultimo_item || ''}`,
          previsao: () => window.electronAPI.previsaoInsumosPeca({
            produtoId: item?.id,
            ultimoInsumoId: dados.ultimo_insumo_id,
            unidades: Math.abs(diferenca),
            direcao
          })
        });
        if (!decisao) {
          carregarDetalhes(item.id);
          return;
        }
        ajustarInsumos = decisao.mexer;
        justificativaNegativo = decisao.justificativa;
      }

      // A linha inteira sai do ar enquanto grava: sem isso, um segundo clique
      // no visto dispararia a operação de novo, com peça e insumo em dobro.
      confirmBtn.style.pointerEvents = 'none';
      confirmBtn.style.opacity = '0.5';
      cancelBtn.style.pointerEvents = 'none';
      input.disabled = true;

      try {
        const resultado = await window.InsumosDaPeca.comCarregamento(
          () => window.electronAPI.atualizarLoteProduto({
            id: dados.id,
            quantidade: novaQtd,
            ajustarInsumos,
            justificativaNegativo,
            __meta: {
              produto: {
                id: item.id,
                nome: item.nome,
                codigo: item.codigo
              },
              etapa: dados.etapa,
              itemNome: dados.ultimo_item,
              quantidadeAnterior: isNaN(quantidadeAtual) ? undefined : quantidadeAtual,
              quantidadeNova: novaQtd,
              alteracao: isNaN(quantidadeAtual) ? undefined : novaQtd - quantidadeAtual,
              ajustarInsumos
            }
          }),
          ajustarInsumos
        );
        const extra = window.InsumosDaPeca?.resumo(resultado, ajustarInsumos) || '';
        showToast(`Quantidade atualizada.${extra}`, 'success');
        carregarDetalhes(item.id);
        if (typeof carregarProdutos === 'function') carregarProdutos();
      } catch (err) {
        console.error(err);
        showToast(err?.parcial ? err.message : 'Erro ao atualizar quantidade', 'error');
        // A tabela volta a mostrar o que o banco tem — inclusive numa falha
        // parcial, em que a peça mudou e o insumo não.
        carregarDetalhes(item.id);
      }
    });
    cancelBtn.addEventListener('click', () => carregarDetalhes(item.id));
  }

  function excluirLote(dados) {
    if(!dados) return;
    window.loteExcluir = {
      id: dados.id,
      quantidade: dados?.quantidade,
      produto: {
        id: item?.id,
        nome: item?.nome,
        codigo: item?.codigo
      },
      etapa: dados?.etapa,
      itemNome: dados?.ultimo_item,
      reload: () => {
        carregarDetalhes(item.id);
        if (typeof carregarProdutos === 'function') carregarProdutos();
      }
    };
    Modal.open('modals/produtos/excluir-lote.html', '../js/modals/produto-lote-excluir.js', 'excluirLote', true);
  }

  function formatDateTime(value){
    if(!value) return '';
    return new Date(value).toLocaleString('pt-BR');
  }

  function isProdutoIdValido(id) {
    const produtoIdNum = Number(id);
    return Number.isFinite(produtoIdNum) && produtoIdNum > 0;
  }
})();
