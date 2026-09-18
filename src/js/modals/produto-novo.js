// Modal de novo produto
(function(){
  const overlay = document.getElementById('novoProdutoOverlay');
  let handleColecaoAtualizada = null;
  let handleDesenhistaAtualizado = null;
  const close = () => {
    if (handleColecaoAtualizada) {
      window.removeEventListener('colecaoAtualizada', handleColecaoAtualizada);
    }
    if (handleDesenhistaAtualizado) {
      window.removeEventListener('desenhistaAtualizado', handleDesenhistaAtualizado);
    }
    Modal.close('novoProduto');
  };
  document.getElementById('voltarNovoProduto').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });

  const form = document.getElementById('novoProdutoForm');
  // O botão de Registrar/Salvar mora no RODAPÉ do modal, fora do `<form>`,
  // ligado por `form="..."` — o HTML permite. `querySelector` dos
  // descendentes devolvia null: sem botão, não havia o que desabilitar nem
  // onde mostrar "Salvando...", e o segundo clique parecia legítimo.
  const submitBtn = window.BotaoAcao?.localizarBotaoEnvio?.(form) || null;
  const submitBtnText = submitBtn?.textContent || '';
  let isSubmitting = false;

  // Os dados fiscais (NF-e) moram numa seção retraída: ela abre na setinha e
  // sozinha, ao salvar, se faltar preencher algo lá dentro (o NCM).
  const secaoFiscal = overlay?.querySelector('[data-secao-retratil]') || null;
  window.SecaoRetratil?.ligar(overlay || document);

  function setLoadingState(isLoading) {
    if (!submitBtn) return;
    submitBtn.disabled = isLoading;
    submitBtn.classList.toggle('opacity-60', isLoading);
    submitBtn.classList.toggle('cursor-not-allowed', isLoading);
    submitBtn.textContent = isLoading ? 'Salvando...' : submitBtnText;
  }

  // ------- Campos -------
  const nomeInput       = document.getElementById('nomeInput');
  const codigoInput     = document.getElementById('codigoInput');
  const ncmInput        = document.getElementById('ncmInput');
  const colecaoSelect   = document.getElementById('colecaoSelect');
  // Dados fiscais da peça (NF-e). Vazio = usa o padrão da configuração fiscal.
  const camposFiscais = () => ({
    origem_mercadoria: document.getElementById('origemMercadoriaInput')?.value ?? '0',
    unidade_comercial: (document.getElementById('unidadeComercialInput')?.value || '').trim(),
    cest: (document.getElementById('cestInput')?.value || '').trim(),
    gtin: (document.getElementById('gtinInput')?.value || '').trim(),
    cfop_dentro_uf: (document.getElementById('cfopDentroInput')?.value || '').trim(),
    cfop_fora_uf: (document.getElementById('cfopForaInput')?.value || '').trim(),
    csosn: (document.getElementById('csosnInput')?.value || '').trim()
  });
  const fabricacaoInput = document.getElementById('fabricacaoInput');
  const acabamentoInput = document.getElementById('acabamentoInput');
  const montagemInput   = document.getElementById('montagemInput');
  const embalagemInput  = document.getElementById('embalagemInput');
  const markupInput     = document.getElementById('markupInput');
  const commissionInput = document.getElementById('commissionInput');
  const taxInput        = document.getElementById('taxInput');
  const etapaSelect     = document.getElementById('etapaSelect');
  const comecarBtn      = document.getElementById('comecarNovoProduto');
  const addColecaoBtn   = document.getElementById('addColecaoNovo');
  const delColecaoBtn   = document.getElementById('delColecaoNovo');
  const colecaoLoadingIndicator = document.getElementById('colecaoLoadingIndicatorNovo');
  // Desenhado por (a lista de desenhistas) e a Regra Produção da peça.
  const desenhistaSelect = document.getElementById('desenhistaSelect');
  const addDesenhistaBtn = document.getElementById('addDesenhistaNovo');
  const delDesenhistaBtn = document.getElementById('delDesenhistaNovo');
  const regraBtn        = document.getElementById('regraProducaoNovo');
  const regraInfoBtn    = document.getElementById('regraProducaoInfoNovo');
  const regraStatusEl   = document.getElementById('regraProducaoStatusNovo');
  const regraInfoCaixa  = document.getElementById('regraProducaoInfoCaixaNovo');
  const precoVendaEl    = document.getElementById('precoVenda');
  
  const precoVendaTagEl = document.getElementById('precoVendaTag');
  const totalInsumosEl  = document.getElementById('totalInsumos');
  const totalMaoObraEl  = document.getElementById('totalMaoObra');
  const subTotalEl      = document.getElementById('subTotal');
  const markupValorEl   = document.getElementById('markupValor');
  const custoTotalEl    = document.getElementById('custoTotal');
  const comissaoValorEl = document.getElementById('comissaoValor');
  const impostoValorEl  = document.getElementById('impostoValor');
  const valorVendaEl    = document.getElementById('valorVenda');
  const totalInsumosTituloEl = document.getElementById('totalInsumosTitulo');

  const totals = { totalInsumos: 0, valorVenda: 0 };

  function formatCurrency(val){
    return (val||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }

  function updateTotals(){
    const totalInsumos = totals.totalInsumos; // itens ainda não implementados
    const pctFab  = parseFloat(fabricacaoInput?.value) || 0;
    const pctAcab = parseFloat(acabamentoInput?.value) || 0;
    const pctMont = parseFloat(montagemInput?.value) || 0;
    const pctEmb  = parseFloat(embalagemInput?.value) || 0;
    const pctMarkup  = parseFloat(markupInput?.value) || 0;
    const pctComissao= parseFloat(commissionInput?.value) || 0;
    const pctImposto = parseFloat(taxInput?.value) || 0;

    const totalMaoObra = totalInsumos * (pctFab + pctAcab + pctMont + pctEmb) / 100;
    const subTotal     = totalInsumos + totalMaoObra;
    const markupVal    = totalInsumos * (pctMarkup / 100);
    const custoTotal   = subTotal + markupVal;
    const denom        = 1 - (pctImposto + pctComissao) / 100;
    const comissaoVal  = denom ? (pctComissao / 100) * (custoTotal / denom) : 0;
    const impostoVal   = denom ? (pctImposto  / 100) * (custoTotal / denom) : 0;
    const valorVenda   = custoTotal + comissaoVal + impostoVal;

    totals.valorVenda = valorVenda;

    if(totalInsumosEl) totalInsumosEl.textContent = formatCurrency(totalInsumos);
    if(totalMaoObraEl) totalMaoObraEl.textContent = formatCurrency(totalMaoObra);
    if(subTotalEl)     subTotalEl.textContent     = formatCurrency(subTotal);
    if(markupValorEl)  markupValorEl.textContent  = formatCurrency(markupVal);
    if(custoTotalEl)   custoTotalEl.textContent   = formatCurrency(custoTotal);
    if(comissaoValorEl)comissaoValorEl.textContent= formatCurrency(comissaoVal);
    if(impostoValorEl) impostoValorEl.textContent = formatCurrency(impostoVal);
    if(precoVendaEl)   precoVendaEl.textContent   = formatCurrency(valorVenda);
    if(valorVendaEl)   valorVendaEl.textContent   = formatCurrency(valorVenda);
    if(precoVendaTagEl) precoVendaTagEl.textContent = formatCurrency(valorVenda);
    renderTotalBadges();
  }

  [fabricacaoInput, acabamentoInput, montagemInput, embalagemInput, markupInput, commissionInput, taxInput]
    .filter(Boolean)
    .forEach(inp => inp.addEventListener('input', updateTotals));

  if(etapaSelect){
    window.electronAPI.listarEtapasProducao().then(procs => {
      procs.sort((a,b)=> (a.ordem ?? 0) - (b.ordem ?? 0));
      etapaSelect.innerHTML = procs.map(p => `<option value="${p.id}">${p.nome ?? p}</option>`).join('');
      etapaSelect.selectedIndex = 0;
    }).catch(err => console.error('Erro ao carregar processos', err));
  }

  if(colecaoSelect){
    const normalizarNomeColecao = (valor = '') =>
      String(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();

    let carregamentoColecoesEmAndamento = 0;
    let carregamentoColecoesComAnimacao = 0;

    const aguardar = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

    const atualizarIndicadorColecao = () => {
      if (colecaoLoadingIndicator) {
        colecaoLoadingIndicator.classList.toggle('hidden', carregamentoColecoesComAnimacao === 0);
      }
    };

    const setColecaoLoadingState = (isLoading) => {
      if (!colecaoSelect) return;

      if (isLoading) {
        // salva estado anterior
        colecaoSelect.dataset.preLoadingDisabled = String(colecaoSelect.disabled);

        if (addColecaoBtn)
          addColecaoBtn.dataset.preLoadingDisabled = String(addColecaoBtn.disabled);

        if (delColecaoBtn)
          delColecaoBtn.dataset.preLoadingDisabled = String(delColecaoBtn.disabled);

        // aplica loading
        colecaoSelect.disabled = true;
        [addColecaoBtn, delColecaoBtn].forEach(btn => {
          if (btn) btn.disabled = true;
        });

        return;
      }

      // restaura estado anterior
      const selectWasDisabled =
        colecaoSelect.dataset.preLoadingDisabled === 'true';

      colecaoSelect.disabled = selectWasDisabled;
      delete colecaoSelect.dataset.preLoadingDisabled;

      [addColecaoBtn, delColecaoBtn].forEach(btn => {
        if (!btn) return;

        const wasDisabled =
          btn.dataset.preLoadingDisabled === 'true';

        btn.disabled = wasDisabled;
        delete btn.dataset.preLoadingDisabled;
      });
    };

    async function carregarColecoes({ selecionada, removida, colecoes, forcarAtualizacao = false, preservarSelecao = true, exibirAnimacao = false, atrasoMs = 0 } = {}) {
      if (!colecaoSelect) return;

      const haviaCarregamentoEmAndamento = carregamentoColecoesEmAndamento > 0;
      carregamentoColecoesEmAndamento += 1;
      if (exibirAnimacao) {
        carregamentoColecoesComAnimacao += 1;
        atualizarIndicadorColecao();
      }
      if (!haviaCarregamentoEmAndamento) {
        setColecaoLoadingState(true);
      }

      try {
        if (atrasoMs > 0) {
          await aguardar(atrasoMs);
        }

        const listaColecoes = Array.isArray(colecoes) && !forcarAtualizacao
          ? colecoes
          : await window.electronAPI.listarColecoes();

        const valorAtual = preservarSelecao ? colecaoSelect.value : '';

        colecaoSelect.innerHTML =
          '<option value="">Selecionar Coleção</option>' +
          listaColecoes.map(c => `<option value="${c}">${c}</option>`).join('');

        let valorSelecionado = selecionada ?? valorAtual;

        if (removida && normalizarNomeColecao(valorSelecionado) === normalizarNomeColecao(removida)) {
          valorSelecionado = '';
        }

        const mapa = new Map(
          listaColecoes.map(c => [normalizarNomeColecao(c), c])
        );

        colecaoSelect.value =
          mapa.get(normalizarNomeColecao(valorSelecionado)) || '';

      } catch (err) {
        console.error('Erro ao carregar coleções:', err);
        if (typeof showToast === 'function') {
          showToast('Não foi possível atualizar coleções. Tente novamente.', 'error');
        }
      } finally {
        carregamentoColecoesEmAndamento = Math.max(0, carregamentoColecoesEmAndamento - 1);
        if (exibirAnimacao) {
          carregamentoColecoesComAnimacao = Math.max(0, carregamentoColecoesComAnimacao - 1);
          atualizarIndicadorColecao();
        }

        if (carregamentoColecoesEmAndamento === 0) {
          setColecaoLoadingState(false);
        }
      }
    }

   
    if (colecaoSelect) {
      carregarColecoes();



      handleColecaoAtualizada = (event) => {
        console.log('🔥 EVENTO COLECAO ATUALIZADA DISPAROU');
        const detail = event?.detail || {};

        carregarColecoes({
          ...detail,
          // Sempre força nova leitura no backend para evitar lista desatualizada
          // retornada pela operação de criação/exclusão em cenários assíncronos.
          forcarAtualizacao: true,
          preservarSelecao: false,
          exibirAnimacao: true,
          atrasoMs: 3000
        });
      };

      window.addEventListener('colecaoAtualizada', handleColecaoAtualizada);
    }

    addColecaoBtn?.addEventListener('click', () => {
      if (colecaoSelect) colecaoSelect.value = '';
      Modal.open('modals/produtos/colecao-novo.html', '../js/modals/produto-colecao-novo.js', 'novaColecao', true);
    });
    delColecaoBtn?.addEventListener('click', () => {
      if (colecaoSelect) colecaoSelect.value = '';
      Modal.open('modals/produtos/colecao-excluir.html', '../js/modals/produto-colecao-excluir.js', 'excluirColecao', true);
    });
  }

  /** Carrega um utilitário de src/js/utils uma vez só (o modal também abre fora de Produtos). */
  function carregarUtil(arquivo, global) {
    if (window[global]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `../js/utils/${arquivo}`;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Não foi possível carregar ${arquivo}.`));
      document.head.appendChild(s);
    });
  }

  // ------- Desenhado por -------
  const desenhistaValido = () => (window.Desenhistas?.escolhaValida
    ? window.Desenhistas.escolhaValida(desenhistaSelect)
    : Boolean(desenhistaSelect?.value));

  async function carregarDesenhistas(selecionado) {
    if (!desenhistaSelect) return;
    try {
      await carregarUtil('desenhistas.js', 'Desenhistas');
      const lista = await window.Desenhistas.listar();
      window.Desenhistas.preencher(desenhistaSelect, lista, selecionado ?? desenhistaSelect.value);
    } catch (err) {
      console.error('Erro ao carregar desenhistas:', err);
      if (typeof showToast === 'function') {
        showToast(err?.corpo?.sql_pendente ? err.message : 'Não foi possível carregar os desenhistas.', 'error');
      }
    }
  }

  if (desenhistaSelect) {
    carregarDesenhistas('');
    handleDesenhistaAtualizado = (event) => {
      const detalhe = event?.detail || {};
      let selecionado = detalhe.selecionado ?? desenhistaSelect.value;
      if (detalhe.removido && window.Desenhistas?.chave(selecionado) === window.Desenhistas?.chave(detalhe.removido)) selecionado = '';
      carregarDesenhistas(selecionado);
    };
    window.addEventListener('desenhistaAtualizado', handleDesenhistaAtualizado);
    addDesenhistaBtn?.addEventListener('click', () => {
      Modal.open('modals/produtos/desenhista-novo.html', '../js/modals/produto-desenhista-novo.js', 'novoDesenhista', true);
    });
    delDesenhistaBtn?.addEventListener('click', () => {
      Modal.open('modals/produtos/desenhista-excluir.html', '../js/modals/produto-desenhista-excluir.js', 'excluirDesenhista', true);
    });
  }

  // ------- Regra Produção -------
  // A peça nova nasce na tabela fixa com o preço de venda calculado: é ele a base do %.
  let regra = null;
  const precoDaPeca = () => (totals.valorVenda > 0 ? Math.round(totals.valorVenda * 100) / 100 : null);

  async function prepararRegra() {
    await carregarUtil('produto-regra-producao.js', 'RegraProducaoPeca');
    if (!regra) {
      regra = window.RegraProducaoPeca.criar({
        produtoId: null,
        obterItens: () => itens,
        obterPreco: precoDaPeca,
        aoMudar: pintarRegra
      });
    }
    if (!regra.base()) await regra.carregar();
    return regra;
  }

  function pintarRegra() {
    if (!regra || !regraStatusEl) return;
    const semInsumos = regra.linhas().length === 0;
    const faltam = regra.pendencias();
    regraInfoCaixa?.classList.toggle('hidden', semInsumos || faltam.length > 0);
    if (semInsumos && !regra.erro()) {
      regraStatusEl.classList.add('hidden');
      return;
    }
    regraStatusEl.classList.remove('hidden');
    regraStatusEl.classList.toggle('text-yellow-400', faltam.length > 0);
    regraStatusEl.style.color = faltam.length ? '' : 'var(--color-green)';
    regraStatusEl.textContent = faltam.length
      ? `Regra Produção pendente: ${faltam.map(f => `${f.nome} (${f.falta})`).join('; ')}.`
      : 'Regra Produção completa: confira no (i).';
  }

  /** O que falta preencher antes de abrir a Regra Produção. */
  function faltaParaARegra() {
    const faltam = [];
    if (!nomeInput?.value.trim()) faltam.push('nome');
    if (!codigoInput?.value.trim()) faltam.push('código');
    if (!ncmInput?.value.trim()) faltam.push('NCM');
    if (!colecaoSelect?.value) faltam.push('coleção');
    if (!desenhistaValido()) faltam.push('desenhado por');
    if (!itens.length) faltam.push('os insumos (+ Começar)');
    return faltam;
  }

  regraBtn?.addEventListener('click', async () => {
    const faltam = faltaParaARegra();
    if (faltam.length) {
      if (typeof showToast === 'function') showToast(`Antes da Regra Produção, preencha: ${faltam.join(', ')}.`, 'warning');
      return;
    }
    let controle;
    try {
      controle = await prepararRegra();
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'Não foi possível abrir a Regra Produção.', 'error');
      return;
    }
    if (controle.erro()) {
      showToast(controle.erro().message || 'Não foi possível ler as regras de produção.', 'error');
      return;
    }
    window.regraProducaoContexto = {
      controle,
      peca: { codigo: codigoInput.value.trim(), nome: nomeInput.value.trim() },
      aoFechar: () => {
        overlay.classList.remove('pointer-events-none', 'blur-sm');
        pintarRegra();
      }
    };
    overlay.classList.add('pointer-events-none', 'blur-sm');
    Modal.open('modals/produtos/regra-producao.html', '../js/modals/produto-regra-producao.js', 'regraProducaoPeca', true);
  });

  regraInfoBtn?.addEventListener('click', () => {
    if (!regra) return;
    window.DialogPadrao?.info({
      title: 'Regra Produção',
      ...regra.caixa({ codigo: codigoInput.value.trim(), nome: nomeInput.value.trim() })
    });
  });

  prepararRegra().then(pintarRegra).catch(err => console.error('Erro ao preparar a Regra Produção', err));

  const tableBody = document.querySelector('#itensTabela tbody');
  const ordemContainer = document.getElementById('confirmarOrdemContainer');
  const ordemBtn = document.getElementById('confirmarOrdemBtn');
  let ordemConfirmada = false;
  if (ordemBtn) {
    ordemContainer?.classList.add('hidden');
    ordemBtn.addEventListener('click', () => {
      ordemConfirmada = !ordemConfirmada;
      ordemBtn.classList.toggle('active', ordemConfirmada);
    });
  }
  let itens = [];
  let dragging = null;

  // Quantidades aceitam até 4 casas decimais (ver src/utils/numericInput.js).
  function formatNumber(val){
    if (window.NumericInput) return window.NumericInput.format(val) || '0';
    const n = parseFloat(val) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '');
  }

  function renderActionButtons(item){
    const cell = item.row.querySelector('.action-cell');
      cell.innerHTML = `
        <div class="flex items-center justify-start space-x-2">
          <i class="fas fa-bars w-5 h-5 cursor-move p-1 rounded drag-handle" style="color: var(--color-pen)" title="Reordenar"></i>
          <i data-perm="prod.item.edit" class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 edit-item" style="color: var(--color-primary)" title="Editar"></i>
          <i data-perm="prod.item.remove" class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white delete-item" style="color: var(--color-red)" title="Excluir"></i>
        </div>`;
    cell.querySelector('.edit-item').addEventListener('click', () => startEdit(item));
    cell.querySelector('.delete-item').addEventListener('click', () => startDelete(item));
  }

  function startEdit(item){
    const cell = item.row.querySelector('.quantidade-cell');
    const original = item.quantidade;
    cell.innerHTML = `
      <div class="flex items-center justify-start space-x-1">
        <input type="number" step="0.0001" class="w-20 bg-input border border-inputBorder rounded text-white text-sm text-left" value="${item.quantidade}">
        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded text-green-400 confirm-edit"></i>
        <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded text-red-400 cancel-edit"></i>
      </div>`;
    const input = cell.querySelector('input');
    cell.querySelector('.confirm-edit').addEventListener('click', () => {
      item.quantidade = parseFloat(input.value) || 0;
      renderItens();
    });
    cell.querySelector('.cancel-edit').addEventListener('click', () => {
      item.quantidade = original;
      renderItens();
    });
  }

  function startDelete(item){
    const cell = item.row.querySelector('.action-cell');
    cell.innerHTML = `
      <div class="flex items-center justify-start space-x-2">
        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded text-green-400 confirm-delete"></i>
        <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded text-red-400 cancel-delete"></i>
      </div>`;
    cell.querySelector('.confirm-delete').addEventListener('click', () => {
      itens = itens.filter(i => i !== item);
      renderItens();
    });
    cell.querySelector('.cancel-delete').addEventListener('click', () => {
      renderItens();
    });
  }

  function normalizeOrder(){
    itens.sort((a,b)=> (a.ordem||0) - (b.ordem||0));
    itens.forEach((it,idx)=> it.ordem = idx+1);
  }

  function normalizeItensParaSalvar(){
    const ordenados = itens.slice().sort((a,b)=> (a.ordem||0)-(b.ordem||0));
    const vistos = new Map();
    const normalizados = [];
    let hadDuplicates = false;

    ordenados.forEach((it, idx) => {
      const rawKey = it.insumo_id ?? it.id;
      const key = rawKey != null ? String(rawKey) : `__missing_${idx}`;
      const existente = vistos.get(key);
      if(existente){
        hadDuplicates = true;
        existente.quantidade = (parseFloat(existente.quantidade) || 0) + (parseFloat(it.quantidade) || 0);
        if(!existente.preco_unitario && it.preco_unitario != null){
          existente.preco_unitario = it.preco_unitario;
        }
      }else{
        const clone = { ...it };
        vistos.set(key, clone);
        normalizados.push(clone);
      }
    });

    normalizados.forEach((it, idx) => {
      it.ordem = idx + 1;
    });

    return { itensNormalizados: normalizados, hadDuplicates };
  }

  function renderItens(){
    if(!tableBody) return;
    normalizeOrder();
    tableBody.innerHTML = '';
    const grupos = {};
    itens.forEach(it => {
      const proc = it.processo || '—';
      if(!grupos[proc]) grupos[proc] = [];
      grupos[proc].push(it);
    });
    Object.entries(grupos).forEach(([proc, arr]) => {
      const header = document.createElement('tr');
      header.className = 'process-row';
      header.innerHTML = `<td colspan="6" class="px-6 py-2 bg-gray-50 border-t border-gray-200 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">${proc}</td>`;
      tableBody.appendChild(header);
      arr.sort((a,b)=> (a.ordem||0)-(b.ordem||0));
      arr.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-white/10 item-row';
        tr.dataset.processo = proc;
        tr.setAttribute('draggable','true');
        tr.innerHTML = `
          <td data-perm-col="col_ins_mp" class="py-3 px-2 text-white">${item.nome}</td>
          <td data-perm-col="col_ins_qtd" class="py-3 px-2 text-left quantidade-cell"><span class="quantidade-text">${formatNumber(item.quantidade)}</span></td>
          <td data-perm-col="col_ins_unidade" class="py-3 px-2 text-left">${item.unidade || ''}</td>
          <td data-perm-col="col_ins_custo_un" class="py-3 px-2 text-left text-white">${formatCurrency(item.preco_unitario)}</td>
          <td data-perm-col="col_ins_custo_total" class="py-3 px-2 text-left text-white item-total">${formatCurrency(item.quantidade * item.preco_unitario)}</td>
          <td class="py-3 px-2 text-left action-cell"></td>`;
        tableBody.appendChild(tr);
        item.row = tr;
        item.totalEl = tr.querySelector('.item-total');
        renderActionButtons(item);
      });
    });
    sincronizarOrdemComTabela();
    setupDragAndDrop();
    atualizaTotal();
    pintarRegra();

    // Os campos que nascem em zero — os sete percentuais da ficha e a
    // quantidade de cada insumo — mostram o zero sem exigir que ele seja
    // apagado para escrever. Chamado a cada desenho porque as linhas de insumo
    // são refeitas; ligar duas vezes no mesmo campo é ignorado.
    window.CampoZerado?.ligarTodos(
      document.getElementById('novoProdutoOverlay'), 'input[type="number"]');
  }

  /**
   * Depois de desenhar, `ordem` passa a ser exatamente a posição na tela. A
   * tabela é agrupada por processo, então um insumo acrescentado depois a um
   * processo antigo aparece dentro do grupo dele mas carregava um `ordem` maior
   * que o dos processos seguintes — e era esse número que ia para o banco. É a
   * mesma renumeração que o arrastar-e-soltar já fazia.
   */
  function sincronizarOrdemComTabela(){
    Array.from(tableBody.querySelectorAll('tr.item-row')).forEach((linha, idx) => {
      const item = itens.find(i => i.row === linha);
      if(item) item.ordem = idx + 1;
    });
  }

  function setupDragAndDrop(){
    const rows = tableBody.querySelectorAll('tr.item-row');
    rows.forEach(row => {
      const handle = row.querySelector('.drag-handle');
      handle.addEventListener('mousedown', () => row.setAttribute('data-allow-drag','true'));
      row.addEventListener('dragstart', e => {
        if(row.getAttribute('data-allow-drag') !== 'true'){ e.preventDefault(); return; }
        dragging = itens.find(i => i.row === row);
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        if(!dragging) return;
        const target = row;
        const targetItem = itens.find(i => i.row === target);
        if(targetItem.processo !== dragging.processo) return;
        const rect = target.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height/2;
        if(before) tableBody.insertBefore(dragging.row, target);
        else tableBody.insertBefore(dragging.row, target.nextSibling);
      });
      row.addEventListener('drop', e => e.preventDefault());
      row.addEventListener('dragend', () => {
        row.removeAttribute('data-allow-drag');
        const ordered = Array.from(tableBody.querySelectorAll('tr.item-row'));
        ordered.forEach((r,idx)=>{
          const it = itens.find(i=>i.row===r);
          it.ordem = idx+1;
        });
        dragging = null;
      });
    });
  }

  function atualizaTotal(){
    totals.totalInsumos = itens.reduce((s,it)=> s + (it.quantidade * it.preco_unitario),0);
    updateTotals();
  }

  window.produtoNovoAPI = {
    obterItens: () => itens.slice(),
    somarItem(id, quantidade){
      const it = itens.find(i => String(i.insumo_id ?? i.id) === String(id));
      if(it){
        it.quantidade += quantidade;
        renderItens();
      }
    },
    substituirItem(novo){
      const it = itens.find(i => String(i.insumo_id ?? i.id) === String(novo.id));
      if(it){
        it.quantidade = novo.quantidade;
        it.preco_unitario = novo.preco_unitario;
        it.processo = novo.processo;
        renderItens();
      }
    },
    adicionarProcessoItens(novos){
      // A posição segue a ordem em que o usuário montou a lista no modal do
      // processo. Parte-se da MAIOR ordem existente (e não de `itens.length`),
      // para não colidir caso as ordens não estejam contíguas.
      let proximaOrdem = itens.reduce(
        (maior, it) => Math.max(maior, Number(it.ordem) || 0),
        0
      );
      novos.forEach(n => {
        const exists = itens.some(it => String(it.nome).trim().toLowerCase() === String(n.nome).trim().toLowerCase());
        if(exists){
          if(typeof showToast === 'function') showToast('Item já adicionado', 'error');
        } else {
          proximaOrdem += 1;
          n.ordem = proximaOrdem;
          itens.push(n);
        }
      });
      renderItens();
    }
  };

  function renderTotalBadges(){
    if(!totalInsumosTituloEl) return;
    const processos = {};
    itens.forEach(it => {
      const proc = (it.processo || '').trim();
      if(!proc) return;
      processos[proc] = (processos[proc] || 0) + (it.quantidade * it.preco_unitario);
    });
    const parts = Object.keys(processos).map(p => `<span class="badge-process px-3 py-1 rounded-full text-xs font-medium">${p}: ${formatCurrency(processos[p] || 0)}</span>`);
    parts.push(`<span class="badge-success px-3 py-1 rounded-full text-xs font-medium">Valor Total: ${formatCurrency(totals.totalInsumos || 0)}</span>`);
    totalInsumosTituloEl.innerHTML = parts.join(' ');
  }

  // ------- Ações -------
  if(comecarBtn){
    comecarBtn.addEventListener('click', () => {
      if(etapaSelect){
        const opt = etapaSelect.options[etapaSelect.selectedIndex];
        window.proximaEtapaTitulo = opt ? opt.textContent : '';
      }
      overlay.classList.add('pointer-events-none','blur-sm');
      Modal.open('modals/produtos/proxima-etapa.html', '../js/modals/produto-proxima-etapa-novo.js', 'proximaEtapa', true);
    });
  }
  const limparBtn = document.getElementById('limparNovoProduto');
  if(limparBtn){
    limparBtn.addEventListener('click', () => {
      form.reset();
      itens = [];
      regra?.definirRascunho(new Map());
      renderItens();
      updateTotals();
    });
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (isSubmitting) return;
    if(!ordemConfirmada){
      if(ordemContainer){
        ordemContainer.classList.remove('hidden');
        ordemContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
      if(typeof showToast === 'function') showToast('Confirme a posição produtiva de insumos', 'error');
      return;
    }
    const nome = nomeInput.value.trim();
    const codigo = codigoInput.value.trim();
    const ncm = ncmInput.value.trim().slice(0,8);
    // Falta dado fiscal: abre a seção e mostra onde, em vez de recusar calado.
    if (!ncm && secaoFiscal) {
      window.SecaoRetratil?.abrir(secaoFiscal, { foco: ncmInput });
      window.SecaoRetratil?.avisar(secaoFiscal, 'falta o NCM', true);
      if (typeof showToast === 'function') showToast('Preencha o NCM em "Dados fiscais (NF-e)".', 'error');
      return;
    }
    const desenhadoPor = desenhistaSelect ? desenhistaSelect.value.trim() : '';
    try{
      isSubmitting = true;
      setLoadingState(true);

      // Como os dados fiscais: sem desenhista e sem regra de produção completa, a peça não entra.
      if (!desenhistaValido()) {
        throw new Error('Escolha quem desenhou a peça (Desenhado por).');
      }
      const controleRegra = await prepararRegra();
      const faltamRegra = controleRegra.pendencias();
      if (faltamRegra.length) {
        throw new Error(`Regra Produção pendente: ${faltamRegra.map(f => `${f.nome} (${f.falta})`).join('; ')}. Abra "Regra Produção" antes de registrar.`);
      }

      const produtoCriado = await window.electronAPI.adicionarProduto({
        codigo,
        nome,
        ncm,
        categoria: colecaoSelect.value.trim(),
        desenhado_por: desenhadoPor,
        preco_venda: totals.valorVenda || 0,
        pct_markup: parseFloat(markupInput?.value) || 0,
        status: 'Em linha',
        ...camposFiscais()
      });

      const { itensNormalizados, hadDuplicates } = normalizeItensParaSalvar();
      if(hadDuplicates && typeof showToast === 'function'){
        showToast('Insumos duplicados consolidados automaticamente.', 'info');
      }
      itens = itensNormalizados;

      const itensPayload = itens.map(i => ({
        insumo_id: i.insumo_id ?? i.id,
        quantidade: i.quantidade,
        ordem_insumo: i.ordem
      }));

      const produtoId = produtoCriado?.id;

      await window.electronAPI.salvarProdutoDetalhado(codigo, {
        pct_fabricacao: parseFloat(fabricacaoInput?.value) || 0,
        pct_acabamento: parseFloat(acabamentoInput?.value) || 0,
        pct_montagem:   parseFloat(montagemInput?.value) || 0,
        pct_embalagem:  parseFloat(embalagemInput?.value) || 0,
        pct_markup:     parseFloat(markupInput?.value) || 0,
        pct_comissao:   parseFloat(commissionInput?.value) || 0,
        pct_imposto:    parseFloat(taxInput?.value) || 0,
        preco_base:     totals.totalInsumos || 0,
        preco_venda:    totals.valorVenda || 0,
        // A peça NASCE na tabela fixa.
        //
        // O preço praticado só se move por decisão explícita, e a regra existe
        // para não reprecificar sozinho o que já foi proposto ao cliente. Numa
        // peça que acaba de ser criada não há proposta nenhuma a proteger — e
        // sem linha na tabela fixa ela fica sem preço praticado, o que a torna
        // IMPOSSÍVEL DE VENDER: o orçamento recusa item sem preço.
        //
        // Era um beco sem saída silencioso: cadastrava-se o produto, ele
        // aparecia no catálogo, e só na hora de montar o orçamento se
        // descobria que ele não podia entrar.
        atualizar_tabela_fixa: true,
        nome,
        codigo,
        ncm,
        categoria: colecaoSelect.value.trim(),
        desenhado_por: desenhadoPor,
        status: 'Em linha',
        ...camposFiscais()
      }, { inseridos: itensPayload, atualizados: [], deletados: [] }, produtoId);

      // A regra de produção vai depois da peça: ela precisa do id.
      let avisoRegra = '';
      try {
        const gravada = await controleRegra.gravar(produtoId);
        if (gravada && gravada.completa === false) {
          avisoRegra = `A Regra Produção ficou incompleta (${(gravada.faltam || []).map(x => x.nome).join(', ')}): confira em Editar peça.`;
        }
      } catch (erroRegra) {
        console.error('Erro ao gravar a Regra Produção', erroRegra);
        avisoRegra = `A peça foi criada, mas a Regra Produção não foi gravada (${erroRegra?.message || 'erro'}). Abra a peça em Editar e salve a regra.`;
      }

      if (typeof atualizarProdutoLocal === 'function') {
        atualizarProdutoLocal({
          id: produtoCriado?.id,
          codigo,
          nome,
          ncm,
          categoria: colecaoSelect.value.trim(),
          preco_venda: totals.valorVenda || 0,
          pct_markup: parseFloat(markupInput?.value) || 0,
          status: 'Em linha',
          quantidade_total: produtoCriado?.quantidade_total ?? 0
        }, { mode: 'add' });
      }

      // Avisa quem abriu este formulário que o cadastro entrou. Quem abre
      // daqui (a leitura de IA) não tem como saber sozinho: ela não gravou
      // nada e não fica olhando o banco. Quem não escuta, ignora.
      window.dispatchEvent(new CustomEvent('moduloSalvou', { detail: { overlay: 'novoProduto' } }));
      showToast('Peça criada com sucesso!', 'success');
      if (avisoRegra) showToast(avisoRegra, 'warning');
      close();
      const novoProduto = {
        id: produtoCriado?.id,
        codigo,
        nome
      };
      if (typeof window.recarregarProdutos === 'function') {
        window.recarregarProdutos({ novoProduto, origem: 'create' });
      } else if (typeof carregarProdutos === 'function') {
        carregarProdutos();
      }
    }catch(err){
      console.error('Erro ao criar produto', err);
      if(err?.code === 'CODIGO_EXISTE'){
        showToast('Código já existe', 'error');
      }else if(err?.code === 'NOME_EXISTE'){
        showToast('Nome já existe', 'error');
      }else{
        const msg = err?.message || 'Erro ao criar peça';
        showToast(msg, 'error');
      }
    } finally {
      isSubmitting = false;
      setLoadingState(false);
    }
  });

  // Preservação do trabalho: `itens` é estado interno deste modal — nenhuma
  // varredura de DOM consegue repô-lo depois de uma desconexão. Declaramos
  // explicitamente como salvar e como recompor a lista de insumos/processos.
  window.EstadoTrabalho?.registrarConteudo?.('novoProduto', {
    capturar: () => ({
      // row/totalEl são nós do DOM e não podem ir para o JSON
      itens: itens.map(({ row, totalEl, ...dados }) => dados),
      // Coleção e Etapa são preenchidas por `fetch`: atribuir `value` antes das
      // <option> chegarem não faz nada, então a varredura genérica as perde.
      colecao: colecaoSelect?.value || '',
      desenhista: desenhistaSelect?.value || '',
      regra: regra ? [...regra.rascunho()] : [],
      etapa: etapaSelect?.value || ''
    }),
    restaurar: async (dados) => {
      const guardados = Array.isArray(dados?.itens) ? dados.itens : [];
      if (guardados.length) {
        itens = guardados.map(d => ({ ...d }));
        renderItens();
        updateTotals();
      }

      const repor = window.EstadoTrabalho?.reporSelect;
      if (repor) {
        await Promise.all([
          repor(colecaoSelect, dados?.colecao),
          repor(desenhistaSelect, dados?.desenhista),
          repor(etapaSelect, dados?.etapa)
        ]);
      }
      if (Array.isArray(dados?.regra) && dados.regra.length) {
        prepararRegra()
          .then(controle => controle.definirRascunho(new Map(dados.regra)))
          .catch(err => console.error('Erro ao repor a Regra Produção', err));
      }
    }
  });

  const dataHoraEl = document.getElementById('dataHoraProduto');
  if(dataHoraEl){
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    dataHoraEl.textContent = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  updateTotals();
})();
