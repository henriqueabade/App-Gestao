// "+" do Tipo: inclui um tipo de contato na lista (ctt.type.manage) — o mesmo
// desenho do "+" dos desenhistas da peça (produto-desenhista-novo.js).
;(function(){
  const close = () => {
    window.removeEventListener('keydown', esc, true);
    Modal.close('novoTipoContato');
  };
  // Esc fecha só este: na captura, antes do Esc do modal do contato.
  function esc(e){ if(e.key === 'Escape'){ e.stopPropagation(); close(); } }
  document.getElementById('fecharNovoTipoContato').addEventListener('click', close);
  window.addEventListener('keydown', esc, true);

  const form = document.getElementById('novoTipoContatoForm');
  const mensagem = document.getElementById('novoTipoContatoMensagem');
  const botao = window.BotaoAcao?.localizarBotaoEnvio?.(form) || null;
  let enviando = false;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (enviando) return;
    const nome = form.nome.value.replace(/\s+/g, ' ').trim();
    mensagem.classList.add('hidden');
    if (nome.length < 2) {
      mensagem.textContent = 'Informe o nome do tipo.';
      mensagem.classList.remove('hidden');
      return;
    }
    if (!window.ContatoTipos) {
      showToast('Lista de tipos indisponível. Reabra o cadastro do contato.', 'error');
      return;
    }
    enviando = true;
    if (botao) botao.disabled = true;
    try {
      const r = await window.ContatoTipos.incluir(nome);
      showToast('Tipo incluído!', 'success');
      window.ContatoTipos.avisar({ selecionado: r?.tipo?.id, tipos: r?.tipos });
      close();
    } catch (err) {
      if (err?.status === 409 && err?.corpo?.tipo) {
        showToast(`${err.corpo.tipo.nome} já está na lista.`, 'warning');
        window.ContatoTipos.avisar({ selecionado: err.corpo.tipo.id });
        close();
        return;
      }
      console.error(err);
      mensagem.textContent = err?.message || 'Erro ao incluir o tipo.';
      mensagem.classList.remove('hidden');
    } finally {
      enviando = false;
      if (botao) botao.disabled = false;
    }
  });
})();
