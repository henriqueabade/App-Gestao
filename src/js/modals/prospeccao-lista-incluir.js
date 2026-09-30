// "+" da Origem / do Tipo da interação: inclui um nome na lista
// (pros.lists.manage). Qual lista vem de window.prospeccaoListaAlvo, posto por
// utils/prospeccao-listas.js — o mesmo desenho do "+" do Tipo de Contatos.
;(function(){
  const alvo = window.prospeccaoListaAlvo || {};
  const close = () => {
    window.removeEventListener('keydown', esc, true);
    Modal.close('incluirListaProspeccao');
  };
  // Esc fecha só este: na captura, antes do Esc do modal de trás.
  function esc(e){ if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  document.getElementById('fecharIncluirLista').addEventListener('click', close);
  window.addEventListener('keydown', esc, true);

  document.getElementById('incluirListaTitulo').textContent = `INSERIR ${alvo.titulo || ''}`.trim();
  document.getElementById('incluirListaRotulo').textContent = `Nome d${alvo.lista === 'origens' ? 'a' : 'o'} ${alvo.nome || 'item'}`;
  document.getElementById('incluirListaExemplo').textContent = alvo.exemplo || '';
  const form = document.getElementById('incluirListaForm');
  form.nome.maxLength = alvo.lista === 'tipos-interacao' ? 40 : 60;
  const mensagem = document.getElementById('incluirListaMensagem');
  const botao = window.BotaoAcao?.localizarBotaoEnvio?.(form) || null;
  let enviando = false;
  setTimeout(() => form.nome.focus(), 60);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (enviando) return;
    const nome = form.nome.value.replace(/\s+/g, ' ').trim();
    mensagem.classList.add('hidden');
    if (nome.length < 2) {
      mensagem.textContent = 'Informe o nome.';
      mensagem.classList.remove('hidden');
      return;
    }
    if (!window.ProspeccaoListas || !alvo.lista) {
      showToast('Lista indisponível. Reabra o cadastro.', 'error');
      return;
    }
    enviando = true;
    if (botao) botao.disabled = true;
    try {
      const r = await window.ProspeccaoListas.incluir(alvo.lista, nome);
      showToast(`${r?.item?.nome || nome} incluíd${alvo.lista === 'origens' ? 'a' : 'o'} na lista!`, 'success');
      window.ProspeccaoListas.avisar({ lista: alvo.lista, selecionado: r?.item?.nome || nome });
      close();
    } catch (err) {
      if (err?.status === 409 && err?.corpo?.item) {
        showToast(`${err.corpo.item.nome} já está na lista.`, 'warning');
        window.ProspeccaoListas.avisar({ lista: alvo.lista, selecionado: err.corpo.item.nome });
        close();
        return;
      }
      console.error(err);
      mensagem.textContent = err?.message || 'Erro ao incluir.';
      mensagem.classList.remove('hidden');
    } finally {
      enviando = false;
      if (botao) botao.disabled = false;
    }
  });
})();
