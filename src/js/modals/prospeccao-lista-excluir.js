// "−" da Origem / do Tipo da interação: exclui um nome da lista
// (pros.lists.manage). Recusado enquanto alguma prospecção/interação usa o
// nome — o aviso diz quantas. Qual lista vem de window.prospeccaoListaAlvo.
;(function(){
  const alvo = window.prospeccaoListaAlvo || {};
  const aoConfirmar = (el, handler) => {
    if (!el) return;
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(el, handler);
    else el.addEventListener('click', handler);
  };
  const close = () => {
    window.removeEventListener('keydown', esc, true);
    Modal.close('excluirListaProspeccao');
  };
  function esc(e){ if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  window.addEventListener('keydown', esc, true);
  document.getElementById('fecharExcluirLista').addEventListener('click', close);
  document.getElementById('cancelarExcluirLista').addEventListener('click', close);

  document.getElementById('excluirListaTitulo').textContent = `EXCLUIR ${alvo.titulo || ''}`.trim();
  const artigo = alvo.lista === 'origens' ? 'a' : 'o';
  document.getElementById('excluirListaRotulo').textContent = `Qual ${alvo.nome || 'item'} sai da lista`;
  const select = document.getElementById('excluirListaNome');
  const aviso = document.getElementById('excluirListaAviso');
  let confirmar = false;

  const mostrar = (texto, cor) => {
    aviso.textContent = texto;
    aviso.classList.remove('hidden', 'text-red-400', 'text-yellow-400');
    aviso.classList.add(cor);
  };

  (async () => {
    try {
      const itens = (await window.ProspeccaoListas.listar(alvo.lista)).filter(i => i.id !== null && i.id !== undefined);
      const opcoes = [new Option(`Escolha ${artigo} ${alvo.nome || 'item'}`, '')];
      for (const i of itens) opcoes.push(new Option(i.nome, String(i.id)));
      select.replaceChildren(...opcoes);
      if (!itens.length) mostrar('A lista ainda não foi criada no banco: rode o SQL das listas de Prospecções.', 'text-yellow-400');
    } catch (err) {
      console.error(err);
      mostrar(err?.message || 'Não foi possível carregar a lista.', 'text-red-400');
    }
  })();
  select.addEventListener('change', () => {
    confirmar = false;
    aviso.classList.add('hidden');
  });

  aoConfirmar(document.getElementById('confirmarExcluirLista'), async () => {
    const id = select.value;
    if (!id) {
      mostrar(`Escolha ${artigo} ${alvo.nome || 'item'} que sai da lista.`, 'text-red-400');
      return;
    }
    if (!confirmar) {
      mostrar(`${select.selectedOptions[0]?.textContent || ''} sai da lista. Clique em Excluir de novo para confirmar.`, 'text-red-400');
      confirmar = true;
      return;
    }
    try {
      const r = await window.ProspeccaoListas.excluir(alvo.lista, id);
      window.ProspeccaoListas.avisar({ lista: alvo.lista, removido: r?.removido?.nome });
      showToast(`${r?.removido?.nome || 'Item'} excluíd${artigo} da lista`, 'success');
      close();
    } catch (err) {
      confirmar = false;
      if (err?.corpo?.dependente) {
        mostrar(err.message, 'text-yellow-400');
        return;
      }
      console.error(err);
      mostrar(err?.message || 'Erro ao excluir.', 'text-red-400');
    }
  });
})();
