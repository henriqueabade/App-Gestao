// "−" do Desenhado por: exclui um desenhista da lista (prod.designer.delete).
// Recusa se alguma peça usa o nome — a peça precisa trocar de desenhista antes.
;(function(){
  const aoConfirmar = (el, handler) => {
    if (!el) return;
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(el, handler);
    else el.addEventListener('click', handler);
  };

  const close = () => {
    window.removeEventListener('keydown', esc, true);
    Modal.close('excluirDesenhista');
  };
  // Esc fecha só este: na captura, antes do Esc do modal da peça.
  function esc(e){ if(e.key === 'Escape'){ e.stopPropagation(); close(); } }
  window.addEventListener('keydown', esc, true);
  document.getElementById('fecharExcluirDesenhista').addEventListener('click', close);
  document.getElementById('cancelarExcluirDesenhista').addEventListener('click', close);

  const select = document.getElementById('desenhistaExcluir');
  const aviso = document.getElementById('confirmExcluirDesenhista');
  let confirmar = false;

  const mostrar = (texto, cor) => {
    aviso.textContent = texto;
    aviso.classList.remove('hidden', 'text-red-400', 'text-yellow-400');
    aviso.classList.add(cor);
  };
  const marcarPreenchido = () => select.setAttribute('data-filled', String(select.value !== ''));

  (async () => {
    try {
      const lista = await window.Desenhistas.listar();
      const opcoes = [new Option('', '')];
      for (const d of lista) opcoes.push(new Option(d.nome, String(d.id)));
      select.replaceChildren(...opcoes);
      marcarPreenchido();
    } catch (err) {
      console.error(err);
      mostrar(err?.message || 'Não foi possível carregar os desenhistas.', 'text-red-400');
    }
  })();
  select.addEventListener('change', () => {
    marcarPreenchido();
    confirmar = false;
    aviso.classList.add('hidden');
  });
  select.addEventListener('blur', marcarPreenchido);

  aoConfirmar(document.getElementById('excluirDesenhista'), async () => {
    const id = select.value;
    if (!id) return;
    if (!confirmar) {
      mostrar('Esta ação é irreversível. Clique em excluir novamente para confirmar.', 'text-red-400');
      confirmar = true;
      return;
    }
    try {
      const r = await window.Desenhistas.excluir(id);
      window.Desenhistas.avisar({ removido: r?.removido?.nome, desenhistas: r?.desenhistas });
      showToast('Desenhista excluído', 'success');
      close();
    } catch (err) {
      confirmar = false;
      if (err?.corpo?.dependente) {
        mostrar(err.message, 'text-yellow-400');
        return;
      }
      console.error(err);
      mostrar(err?.message || 'Erro ao excluir o desenhista.', 'text-red-400');
    }
  });
})();
