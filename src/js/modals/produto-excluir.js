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

  const overlay = document.getElementById('excluirProdutoOverlay');
  const close = () => Modal.close('excluirProduto');
  function showErrorDialog(message){
    window.DialogPadrao?.info({ title: 'Não foi possível concluir', tom: 'aviso', icone: 'fa-box-archive', message });
  }
  // Sem devolver `window.produtoExcluir`, o modal reabre e o botão de confirmar
  // não faz nada (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.('excluirProduto',
    () => ({ produtoExcluir: window.produtoExcluir }));

  document.getElementById('cancelarExcluirProduto').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  aoConfirmar(document.getElementById('confirmarExcluirProduto'), async () => {
    const confirmButton = document.getElementById('confirmarExcluirProduto');
    const item = window.produtoExcluir;
    if(!item) return;
    if (confirmButton.disabled) return;
    const originalText = confirmButton.textContent;
    confirmButton.disabled = true;
    confirmButton.textContent = 'Excluindo...';
    try{
      await window.electronAPI.excluirProduto({
        id: item.id,
        __meta: {
          nome: item.nome,
          codigo: item.codigo,
          categoria: item.categoria,
          preco_venda: item.preco_venda,
          status: item.status
        }
      });
      // Tabela primeiro, aviso depois — ver a nota gêmea em
      // modals/cliente-excluir.js.
      try{
        if (typeof carregarProdutos === 'function') {
          await carregarProdutos();
        }
      }catch(err){
        showErrorDialog(err.message || 'Erro ao atualizar a lista de produtos');
      }
      showToast('Produto excluído com sucesso!', 'success');
      close();
    }catch(err){
      confirmButton.disabled = false;
      confirmButton.textContent = originalText;
      showErrorDialog(err.message || 'Erro ao excluir produto');
    }
  });
})();
