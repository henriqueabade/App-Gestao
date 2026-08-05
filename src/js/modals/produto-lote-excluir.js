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
    try {
      const payload = {
        id: item.id,
        __meta: {
          produto: item.produto,
          etapa: item.etapa,
          itemNome: item.itemNome,
          quantidade: item.quantidade
        }
      };
      await window.electronAPI.excluirLoteProduto(payload);
      // Tabela primeiro, aviso depois — ver a nota gêmea em
      // modals/cliente-excluir.js.
      await item.reload?.();
      showToast('Lote excluído', 'success');
      close();
      window.loteExcluir = null;
    } catch (err) {
      console.error(err);
      showToast('Erro ao excluir lote', 'error');
    }
  });
})();
