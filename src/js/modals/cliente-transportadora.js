/**
 * Transportadora do cliente — cadastra ou edita.
 *
 * Mesmo desenho do sub-modal de contato: não grava nada sozinho. Devolve o que
 * foi digitado pelo evento `clienteTransportadoraSalva`, e quem abriu acumula a
 * mudança para gravar no salvamento do cliente.
 */
(function () {
  const overlay = document.getElementById('transportadoraClienteOverlay');
  if (!overlay) return;

  const get = id => document.getElementById(id);
  const fechar = () => Modal.close('transportadoraCliente');

  get('voltarTransportadoraCliente')?.addEventListener('click', fechar);
  get('cancelarTransportadoraCliente')?.addEventListener('click', fechar);

  // Este modal abre POR CIMA do de edição do cliente. Sem parar a propagação,
  // um Esc fecharia os dois e o cadastro inteiro se perderia.
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    fechar();
  });

  // Consome o sinal na hora: pendurado, faria a PRÓXIMA "Nova transportadora"
  // abrir em modo edição e sobrescrever a anterior.
  const edicao = window.clienteTransportadoraEditar || null;
  delete window.clienteTransportadoraEditar;

  if (edicao) {
    get('tituloTransportadoraCliente').textContent = 'Editar Transportadora';
    get('transportadoraNome').value = edicao.transportadora || edicao.nome || '';
    // Sem devolver o contexto, uma queda reabriria em modo criação e a edição
    // viraria uma transportadora nova (ver docs/restauracao-de-trabalho.md).
    window.EstadoTrabalho?.registrarContexto?.('transportadoraCliente',
      () => ({ clienteTransportadoraEditar: edicao }));
  }

  setTimeout(() => get('transportadoraNome')?.focus(), 60);

  function salvar(evento) {
    evento?.preventDefault?.();

    const nome = get('transportadoraNome').value.trim();
    if (!nome) {
      showToast('Informe o nome da transportadora', 'error');
      get('transportadoraNome').focus();
      return;
    }

    const detalhe = { transportadora: nome };
    // Devolve a identidade recebida para que quem abriu saiba se é inclusão ou
    // substituição — sem isto, editar criaria uma linha duplicada.
    if (edicao) {
      detalhe.indice = edicao.indice;
      if (edicao.id !== undefined) detalhe.id = edicao.id;
      if (edicao.status !== undefined) detalhe.status = edicao.status;
    }

    window.dispatchEvent(new CustomEvent('clienteTransportadoraSalva', { detail: detalhe }));
    fechar();
  }

  const form = get('transportadoraClienteForm');
  if (form) {
    // `bindSubmit` cobre também o envio por Enter, que não passa por clique
    // nenhum — dois envios seguidos incluiriam a mesma transportadora duas vezes.
    if (window.BotaoAcao?.bindSubmit) window.BotaoAcao.bindSubmit(form, salvar);
    else form.addEventListener('submit', salvar);
  }

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'transportadoraCliente' }));
})();
