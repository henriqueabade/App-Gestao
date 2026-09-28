// "−" do Tipo: exclui um tipo da lista (ctt.type.manage). Recusa se algum
// contato usa o tipo — troque o tipo deles antes.
;(function(){
  const aoConfirmar = (el, handler) => {
    if (!el) return;
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(el, handler);
    else el.addEventListener('click', handler);
  };

  const close = () => {
    window.removeEventListener('keydown', esc, true);
    Modal.close('excluirTipoContato');
  };
  function esc(e){ if(e.key === 'Escape'){ e.stopPropagation(); close(); } }
  window.addEventListener('keydown', esc, true);
  document.getElementById('fecharExcluirTipoContato').addEventListener('click', close);
  document.getElementById('cancelarExcluirTipoContato').addEventListener('click', close);

  const select = document.getElementById('tipoContatoExcluir');
  const aviso = document.getElementById('confirmExcluirTipoContato');
  let confirmar = false;

  const mostrar = (texto, cor) => {
    aviso.textContent = texto;
    aviso.classList.remove('hidden', 'text-red-400', 'text-yellow-400');
    aviso.classList.add(cor);
  };
  const marcarPreenchido = () => select.setAttribute('data-filled', String(select.value !== ''));

  (async () => {
    try {
      const lista = await window.ContatoTipos.listar();
      const opcoes = [new Option('', '')];
      for (const t of lista) opcoes.push(new Option(t.nome, String(t.id)));
      select.replaceChildren(...opcoes);
      marcarPreenchido();
    } catch (err) {
      console.error(err);
      mostrar(err?.message || 'Não foi possível carregar os tipos.', 'text-red-400');
    }
  })();
  select.addEventListener('change', () => {
    marcarPreenchido();
    confirmar = false;
    aviso.classList.add('hidden');
  });
  select.addEventListener('blur', marcarPreenchido);

  aoConfirmar(document.getElementById('excluirTipoContato'), async () => {
    const id = select.value;
    if (!id) return;
    if (!confirmar) {
      mostrar('Esta ação é irreversível. Clique em excluir novamente para confirmar.', 'text-red-400');
      confirmar = true;
      return;
    }
    try {
      const r = await window.ContatoTipos.excluir(id);
      window.ContatoTipos.avisar({ removido: r?.removido?.id, tipos: r?.tipos });
      showToast('Tipo excluído', 'success');
      close();
    } catch (err) {
      confirmar = false;
      if (err?.corpo?.dependente) {
        mostrar(err.message, 'text-yellow-400');
        return;
      }
      console.error(err);
      mostrar(err?.message || 'Erro ao excluir o tipo.', 'text-red-400');
    }
  });
})();
