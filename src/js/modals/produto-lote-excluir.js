(function(){
  /**
   * Clique protegido: trava o segundo clique e mostra o carregando até a ação
   * terminar. Exclusão é irreversível e a resposta pode demorar — sem isso a
   * tela ficava muda e convidava a clicar de novo.
   */
  const aoConfirmar = (el, handler) => {
    if (!el) return;
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(el, handler);
    else el.addEventListener('click', handler);
  };

  const overlay = document.getElementById('excluirLoteOverlay');
  const close = () => Modal.close('excluirLote');
  // Sem devolver `window.loteExcluir`, o modal reabre e o botão de confirmar
  // não faz nada (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.('excluirLote',
    () => ({ loteExcluir: window.loteExcluir }));

  document.getElementById('cancelarExcluirLote').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  aoConfirmar(document.getElementById('confirmarExcluirLote'), async () => {
    const item = window.loteExcluir;
    if(!item) return;

    // Excluir o lote apaga peças do estoque. Elas chegaram a existir (e o
    // material foi junto) ou o lançamento estava errado (e o material volta)?
    // A mesma pergunta das outras telas, com as mesmas palavras.
    // Devolver nunca deixa saldo negativo, então aqui a decisão é só o sim/não
    // — `decidir` cuida disso sozinho e o caminho fica igual ao das outras
    // telas.
    const decisao = await window.InsumosDaPeca?.decidir({
      direcao: 'entrada',
      unidades: item.quantidade,
      peca: item.produto?.nome || item.produto?.codigo || '',
      ponto: `${item.etapa || ''} · ${item.itemNome || ''}`
    });
    if (!decisao) return;
    const devolverInsumos = decisao.mexer;

    try {
      const payload = {
        id: item.id,
        devolverInsumos,
        __meta: {
          produto: item.produto,
          etapa: item.etapa,
          itemNome: item.itemNome,
          quantidade: item.quantidade,
          devolverInsumos
        }
      };
      const resultado = await window.InsumosDaPeca.comCarregamento(
        () => window.electronAPI.excluirLoteProduto(payload),
        devolverInsumos
      );
      // Tabela primeiro, aviso depois — ver a nota gêmea em
      // modals/cliente-excluir.js.
      await item.reload?.();
      const extra = window.InsumosDaPeca?.resumo(resultado, devolverInsumos) || '';
      showToast(`Lote excluído.${extra}`, 'success');
      close();
      window.loteExcluir = null;
    } catch (err) {
      console.error(err);
      // Numa falha parcial o lote já foi excluído: a tabela é recarregada para
      // mostrar isso, mas o modal fica aberto com o aviso do que conferir.
      if (err?.parcial) await item.reload?.();
      showToast(err?.parcial ? err.message : 'Erro ao excluir lote', 'error');
    }
  });
})();
