/**
 * "Item já registrado": o que fazer quando o lote (processo + item) já existe.
 *
 * Três saídas, porque as três são decisões legítimas e diferentes:
 *  - **Somar**      — chegou mais do mesmo; a quantidade acumula.
 *  - **Substituir** — a contagem anterior estava errada; o valor novo manda.
 *  - **Cancelar**   — nada acontece.
 *
 * Antes só existia "Somar" e "Não". Quem só queria corrigir um número tinha de
 * somar e depois editar — e no meio do caminho o estoque ficava errado.
 */
(function(){
  const overlayId = 'somarEstoque';
  const close = () => Modal.close(overlayId);

  // Sem devolver `window.somarEstoqueInfo`, o modal reabre e os botões não
  // fazem nada (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.(overlayId,
    () => ({ somarEstoqueInfo: window.somarEstoqueInfo }));

  const info = window.somarEstoqueInfo;

  const btnSomar = document.getElementById('confirmarSomarEstoque');
  const btnSubstituir = document.getElementById('substituirSomarEstoque');
  const btnCancelar = document.getElementById('cancelarSomarEstoque');
  const resumo = document.getElementById('somarEstoqueResumo');

  function formatar(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  }

  // Dizer os números faz a escolha ser informada em vez de adivinhada.
  if (resumo && info) {
    const atual = Number(info.existing?.quantidade) || 0;
    const novo = Number(info.adicionar) || 0;
    resumo.textContent =
      `Em estoque: ${formatar(atual)} · Informado: ${formatar(novo)} · `
      + `Somando ficaria ${formatar(atual + novo)}.`;
  }

  btnCancelar?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  async function aplicar(modo) {
    if (!info) return;
    const quantidadeAtual = Number(info.existing.quantidade);
    const informada = Number(info.adicionar) || 0;
    const novaQtd = modo === 'substituir' ? informada : (Number(quantidadeAtual) || 0) + informada;
    const diferenca = novaQtd - (Number(quantidadeAtual) || 0);

    // A mesma pergunta da inserção: a diferença de peças saiu de matéria-prima
    // ou não? "Substituir" pode até DIMINUIR o lote — e aí a pergunta se
    // inverte, porque o material volta.
    let ajustarInsumos = false;
    if (diferenca !== 0) {
      const resposta = await window.InsumosDaPeca?.perguntar({
        direcao: diferenca > 0 ? 'saida' : 'entrada',
        unidades: Math.abs(diferenca),
        peca: info.produto?.nome || info.produto?.codigo || '',
        ponto: `${info.etapa || info.existing.etapa || ''} · ${info.itemNome || info.existing.ultimo_item || ''}`
      });
      if (resposta === null || resposta === undefined) return;
      ajustarInsumos = resposta;
    }

    try {
      const resultado = await window.InsumosDaPeca.comCarregamento(
        () => window.electronAPI.atualizarLoteProduto({
          id: info.existing.id,
          quantidade: novaQtd,
          ajustarInsumos,
          __meta: {
            produto: info.produto,
            etapa: info.etapa || info.existing.etapa,
            itemNome: info.itemNome || info.existing.ultimo_item,
            quantidadeAnterior: Number.isNaN(quantidadeAtual) ? undefined : quantidadeAtual,
            quantidadeNova: novaQtd,
            alteracao: Number.isNaN(quantidadeAtual) ? undefined : novaQtd - quantidadeAtual,
            modo,
            ajustarInsumos
          }
        }),
        ajustarInsumos
      );
      const extra = window.InsumosDaPeca?.resumo(resultado, ajustarInsumos) || '';
      showToast(
        `${modo === 'substituir' ? 'Quantidade substituída' : 'Quantidade somada'}.${extra}`,
        'success'
      );
      close();
      // Recarrega os detalhes E a listagem de produtos: a coluna "Quantidade"
      // da grade sai daqui, e sem isso ela ficava mostrando o valor velho.
      info.reload?.();
      window.somarEstoqueInfo = null;
    } catch (err) {
      console.error('Erro ao atualizar lote', err);
      // Falha parcial: o modal FICA ABERTO, com o contexto do que se tentou.
      // Fechar aqui esconderia o que precisa ser conferido à mão.
      if (err?.parcial) info.reload?.();
      showToast(err?.parcial ? err.message : 'Erro ao atualizar lote', 'error');
      throw err;
    }
  }

  // `BotaoAcao.bind` dá a trava de duplo clique: dois cliques aqui somariam a
  // quantidade duas vezes no estoque.
  if (window.BotaoAcao?.bind) {
    window.BotaoAcao.bind(btnSomar, () => aplicar('somar'));
    window.BotaoAcao.bind(btnSubstituir, () => aplicar('substituir'));
  } else {
    let ocupado = false;
    const guardar = (botao, modo) => botao?.addEventListener('click', async () => {
      if (ocupado) return;
      ocupado = true;
      try { await aplicar(modo); } catch (_) { /* já avisado */ } finally { ocupado = false; }
    });
    guardar(btnSomar, 'somar');
    guardar(btnSubstituir, 'substituir');
  }
})();
