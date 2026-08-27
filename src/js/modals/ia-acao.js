/**
 * "O que fazer com esta linha" — a saída de uma linha que não pode seguir.
 *
 * Quem abre é `ia-detalhes.js`, e a conversa entre os dois passa por
 * `window.iaAcaoPedido`: o item, a lista do que existe no sistema, e a função
 * que recebe a decisão. É o mesmo caminho de `window.iaLeituraExcluir` — o
 * `menu.js` embrulha cada script numa IIFE, então não há como um modal chamar
 * o outro direto.
 *
 * A decisão volta como `{ tipo: 'descartar' }` ou
 * `{ tipo: 'apontar', alvo: { id, nome, tabela } }`. Gravar é com quem pediu:
 * este modal não conhece rota nenhuma, e por isso não tem como gravar meio
 * caminho e deixar a grade dizendo outra coisa.
 */
(function () {
  const OVERLAY = 'iaAcao';

  const get = id => document.getElementById(id);
  const close = () => Modal.close(OVERLAY);

  // Sem devolver o pedido, o modal reabre depois de uma queda sem saber sobre
  // qual linha estava decidindo (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.(OVERLAY,
    () => ({ iaAcaoPedido: window.iaAcaoPedido }));

  const pedido = window.iaAcaoPedido || {};
  const alvos = Array.isArray(pedido.alvos) ? pedido.alvos : [];

  const normalizar = v => String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase();

  // ---------------------------------------------------------------------------
  // O que a linha diz
  // ---------------------------------------------------------------------------

  // textContent e não innerHTML: veio de um documento externo, lido por um
  // modelo de linguagem.
  const lido = get('iaAcaoLido');
  if (lido) lido.textContent = pedido.lido ? `"${pedido.lido}"` : '(sem nome)';

  const motivo = get('iaAcaoMotivo');
  if (motivo) {
    motivo.textContent = pedido.motivo
      || 'Esta linha não tem para onde ir com os dados que o documento trouxe.';
  }

  const rotulo = get('iaAcaoRotuloAlvo');
  if (rotulo && pedido.rotuloAlvo) rotulo.textContent = pedido.rotuloAlvo;

  const campo = get('iaAcaoEmpresa');
  const listaEmpresas = get('iaAcaoEmpresas');
  if (listaEmpresas) {
    listaEmpresas.replaceChildren(...alvos.map(a => {
      const o = document.createElement('option');
      o.value = a.nome;
      return o;
    }));
  }

  // ---------------------------------------------------------------------------
  // A escolha
  // ---------------------------------------------------------------------------

  const confirmar = get('iaAcaoConfirmar');
  const busca = get('iaAcaoBuscaEmpresa');

  const escolhida = () =>
    document.querySelector('input[name="iaAcaoEscolha"]:checked')?.value || null;

  /** O registro que o texto digitado aponta, ou null. */
  const empresaEscolhida = () =>
    alvos.find(a => normalizar(a.nome) === normalizar(campo?.value)) || null;

  /**
   * O botão só liga quando a decisão está inteira.
   *
   * "Apontar" com o campo vazio não é uma decisão — é uma intenção. Deixar o
   * botão aceso ali só adianta o erro para depois do clique.
   */
  function reavaliar() {
    const opcao = escolhida();
    busca?.classList.toggle('hidden', opcao !== 'apontar');

    if (!confirmar) return;
    confirmar.disabled = opcao === 'apontar'
      ? !empresaEscolhida()
      : opcao !== 'descartar';
  }

  for (const radio of document.querySelectorAll('input[name="iaAcaoEscolha"]')) {
    radio.addEventListener('change', () => {
      reavaliar();
      // Marcar "escolher" e ter de clicar no campo é um passo a mais em cima de
      // uma tela que já existe para desatolar alguém.
      if (escolhida() === 'apontar') campo?.focus?.();
    });
  }

  campo?.addEventListener('input', reavaliar);

  // Clicar no cartão inteiro marca a opção — o alvo de 12px do radio é pequeno
  // demais para a única decisão que esta tela pede.
  for (const cartao of document.querySelectorAll('.ia-acao__opcao')) {
    cartao.addEventListener('click', e => {
      if (e.target instanceof HTMLInputElement) return;
      const radio = cartao.querySelector('input[type="radio"]');
      if (!radio || radio.checked) return;
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  reavaliar();

  // ---------------------------------------------------------------------------
  // Sair
  // ---------------------------------------------------------------------------

  get('iaAcaoCancelar')?.addEventListener('click', close);

  document.addEventListener('keydown', function esc(e) {
    if (e.key !== 'Escape') return;
    close();
    document.removeEventListener('keydown', esc);
  });

  const decidir = async () => {
    const opcao = escolhida();
    if (opcao === 'descartar') {
      await pedido.aoDecidir?.({ tipo: 'descartar' });
      close();
      return;
    }

    const empresa = empresaEscolhida();
    if (!empresa) {
      window.showToast?.('Escolha um nome da lista — o sistema precisa do registro', 'error');
      return;
    }
    await pedido.aoDecidir?.({ tipo: 'apontar', alvo: empresa });
    close();
  };

  // Gravar pode demorar, e o segundo clique gravaria duas vezes.
  if (window.BotaoAcao?.bind) window.BotaoAcao.bind(confirmar, decidir);
  else confirmar?.addEventListener('click', decidir);
})();
