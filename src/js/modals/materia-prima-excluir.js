(function(){
  const overlay = document.getElementById('excluirInsumoOverlay');
  const close = () => Modal.close('excluirInsumo');

  // Sem devolver `window.materiaExcluir`, o modal reabre e o botão de confirmar
  // não faz nada (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.('excluirInsumo',
    () => ({ materiaExcluir: window.materiaExcluir }));

  document.getElementById('cancelarExcluirInsumo').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });
  // Excluir é irreversível: um duplo clique acidental disparava duas exclusões,
  // a segunda falhava e o usuário via um erro depois de a primeira ter dado
  // certo. `BotaoAcao.bind` trava o segundo clique e mostra o carregamento.
  async function confirmar() {
    const item = window.materiaExcluir;
    if(!item) return;
    try{
      await window.electronAPI.excluirMateriaPrima({
        id: item.id,
        __meta: {
          nome: item.nome,
          categoria: item.categoria,
          quantidade: item.quantidade,
          unidade: item.unidade,
          processo: item.processo
        }
      });
      showToast('Insumo excluído com sucesso!', 'success');
      close();
      Modal.close('editarInsumo');
      // Fora do try do salvamento: um erro ao recarregar a grade não pode
      // aparecer como "não foi possível excluir" depois de a exclusão ter dado
      // certo.
      try {
        if (typeof carregarMateriais === 'function') {
          Promise.resolve(carregarMateriais()).catch(e =>
            console.error('Falha ao recarregar a lista de insumos', e));
        }
      } catch (e) {
        console.error('Falha ao recarregar a lista de insumos', e);
      }
    }catch(err){
      console.error(err);
      // "existe em um produto" é a causa mais comum, mas não a única — dizer
      // isso sempre esconde o motivo real quando é outro.
      showToast(
        err?.message || 'Não foi possível excluir. O insumo pode estar em uso em um produto.',
        'error'
      );
    }
  }

  const btnConfirmar = document.getElementById('confirmarExcluirInsumo');
  if (window.BotaoAcao?.bind) {
    window.BotaoAcao.bind(btnConfirmar, confirmar);
  } else {
    btnConfirmar.addEventListener('click', confirmar);
  }
})();
