// "+" do Desenhado por: inclui um desenhista na lista (prod.designer.create).
(function(){
  const close = () => {
    window.removeEventListener('keydown', esc, true);
    Modal.close('novoDesenhista');
  };
  // Esc fecha só este: na captura, antes do Esc do modal da peça.
  function esc(e){ if(e.key === 'Escape'){ e.stopPropagation(); close(); } }
  document.getElementById('fecharNovoDesenhista').addEventListener('click', close);
  window.addEventListener('keydown', esc, true);

  const form = document.getElementById('novoDesenhistaForm');
  const mensagem = document.getElementById('novoDesenhistaMensagem');
  const botao = window.BotaoAcao?.localizarBotaoEnvio?.(form) || null;
  let enviando = false;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (enviando) return;
    const nome = form.nome.value.replace(/\s+/g, ' ').trim();
    mensagem.classList.add('hidden');
    if (nome.length < 2) {
      mensagem.textContent = 'Informe o nome do desenhista.';
      mensagem.classList.remove('hidden');
      return;
    }
    if (!window.Desenhistas) {
      showToast('Lista de desenhistas indisponível. Reabra o cadastro da peça.', 'error');
      return;
    }
    enviando = true;
    if (botao) botao.disabled = true;
    try {
      const r = await window.Desenhistas.incluir(nome);
      showToast('Desenhista incluído!', 'success');
      window.Desenhistas.avisar({ selecionado: r?.desenhista?.nome || nome, desenhistas: r?.desenhistas });
      close();
    } catch (err) {
      if (err?.status === 409 && err?.corpo?.desenhista) {
        // Já existe (mesmo nome, com ou sem acento): fica selecionado o que já está na lista.
        showToast(`${err.corpo.desenhista.nome} já está na lista.`, 'warning');
        window.Desenhistas.avisar({ selecionado: err.corpo.desenhista.nome });
        close();
        return;
      }
      console.error(err);
      mensagem.textContent = err?.message || 'Erro ao incluir o desenhista.';
      mensagem.classList.remove('hidden');
    } finally {
      enviando = false;
      if (botao) botao.disabled = false;
    }
  });
})();
