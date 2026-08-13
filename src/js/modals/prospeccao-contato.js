/**
 * Sub-modal de contato da prospecção.
 *
 * Serve para CRIAR e para EDITAR: quando `window.prospeccaoContatoEditar` está
 * preenchido, o formulário abre com os dados e devolve o mesmo `indice` que
 * recebeu. Assim os modais de nova/editar prospecção não precisam de duas telas
 * quase iguais.
 *
 * Não fala com a API: devolve o contato por evento e quem abriu decide o que
 * fazer. Na criação da prospecção os contatos só existem em memória até o
 * "Registrar"; na edição viram delta (novos/atualizados/excluídos).
 */
(function () {
  const overlay = document.getElementById('contatoProspeccaoOverlay');
  if (!overlay) return;

  const close = () => Modal.close('contatoProspeccao');

  document.getElementById('voltarContatoProspeccao')?.addEventListener('click', close);
  document.getElementById('cancelarContatoProspeccao')?.addEventListener('click', close);

  // O Esc precisa fechar SÓ este sub-modal. Sem o stopPropagation o mesmo
  // pressionar fecharia também a tela de trás, e o cadastro inteiro se perdia.
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });

  const form = document.getElementById('contatoProspeccaoForm');
  const get = id => document.getElementById(id);

  const edicao = window.prospeccaoContatoEditar || null;
  delete window.prospeccaoContatoEditar;

  if (edicao) {
    const titulo = document.getElementById('contatoProspeccaoTitulo');
    if (titulo) titulo.textContent = 'Editar Contato';
    const botao = document.getElementById('salvarContatoProspeccao');
    if (botao) botao.textContent = 'Salvar';

    get('contatoProsNome').value = edicao.nome || '';
    get('contatoProsCargo').value = edicao.cargo || '';
    get('contatoProsEmail').value = edicao.email || '';
    get('contatoProsCelular').value = edicao.telefone_celular || '';
    get('contatoProsFixo').value = edicao.telefone_fixo || '';
    get('contatoProsDecisor').checked = Boolean(edicao.decisor);
    get('contatoProsPrincipal').checked = Boolean(edicao.principal);
    get('contatoProsObservacao').value = edicao.observacao || '';
  }

  setTimeout(() => get('contatoProsNome')?.focus(), 50);

  /**
   * Salvar o contato.
   *
   * Vai por `bindSubmit` (com o `addEventListener` como plano B): o formulário
   * também é enviado com Enter, sem clique nenhum, e dois envios seguidos
   * despachariam `prospeccaoContatoSalvo` duas vezes — o que inclui o mesmo
   * contato duas vezes na lista de quem abriu este modal.
   */
  function salvar(e) {
    e?.preventDefault?.();

    const nome = get('contatoProsNome').value.trim();
    if (!nome) {
      showToast('Informe o nome do contato', 'error');
      get('contatoProsNome').focus();
      return;
    }

    const email = get('contatoProsEmail').value.trim();
    // `type="email"` já barra formato inválido no submit, mas o campo é
    // opcional — a checagem abaixo cobre quem colou algo estranho e voltou.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('E-mail inválido', 'error');
      get('contatoProsEmail').focus();
      return;
    }

    const detalhe = {
      nome,
      cargo: get('contatoProsCargo').value.trim(),
      email,
      telefone_celular: get('contatoProsCelular').value.trim(),
      telefone_fixo: get('contatoProsFixo').value.trim(),
      decisor: get('contatoProsDecisor').checked,
      principal: get('contatoProsPrincipal').checked,
      observacao: get('contatoProsObservacao').value.trim()
    };

    // Devolve a identidade recebida para que quem abriu saiba se é inclusão ou
    // substituição — sem isto, editar criaria uma linha duplicada.
    if (edicao) {
      detalhe.indice = edicao.indice;
      if (edicao.id !== undefined) detalhe.id = edicao.id;
      if (edicao.status !== undefined) detalhe.status = edicao.status;
    }

    window.dispatchEvent(new CustomEvent('prospeccaoContatoSalvo', { detail: detalhe }));
    close();
  }

  if (form) {
    if (window.BotaoAcao?.bindSubmit) window.BotaoAcao.bindSubmit(form, salvar);
    else form.addEventListener('submit', salvar);
  }

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'contatoProspeccao' }));
})();
