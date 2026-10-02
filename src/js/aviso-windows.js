/**
 * A janela dos avisos no canto da tela (01/10/2026) — ver backend/janelaDeAviso.js.
 *
 * Mostra todos os avisos da fila (os mais novos em cima), cada um com o
 * título, a mensagem e a nota, sem cortar texto. A janela cresce até o limite
 * do backend/janelaDeAviso.js; passou disso, só o meio rola, com a barra do
 * programa, e o topo e o "Abrir o programa" ficam à vista (02/10/2026: antes
 * eram 3 avisos e a janela saía curta, cortando o rodapé).
 *
 * PERSISTENTE (decisão do dono): só o X fecha. Clicar num aviso abre o
 * programa (e, com a sessão aberta, o próprio aviso no sino) e o aviso sai
 * daqui; "Abrir o programa" abre e deixa a lista como está. Sem nenhum aviso,
 * "Tudo visto por aqui" — e a janela continua até o X. O X só fecha: o que
 * não foi aberto continua no sino, não lido.
 * Tudo por textContent (os textos vêm do banco).
 */
(function () {
  const api = window.electronAPI?.avisosWindows;
  // A nota inteira até aqui; o resto se lê no programa (clicar no aviso).
  const MAX_NOTA = 400;
  const ICONE = {
    comentario: 'fa-comment', resposta: 'fa-reply', curtida: 'fa-heart', observacao: 'fa-pen-to-square', mencao: 'fa-at',
    tarefa_lembrete: 'fa-clock', tarefa_atrasada: 'fa-triangle-exclamation', tarefa_atribuida: 'fa-list-check',
    tarefa_alterada: 'fa-calendar-days', tarefa_concluida: 'fa-circle-check', convite_tarefa: 'fa-user-plus',
    convite_respondido: 'fa-user-check', acao_concluida: 'fa-bolt', tarefa_automatica: 'fa-robot',
    responsavel_novo: 'fa-user-tag', responsavel_saiu: 'fa-user-minus', registro_alterado: 'fa-pen',
    registro_excluido: 'fa-trash-can', registro_cancelado: 'fa-ban', item_alterado: 'fa-pen-to-square',
    item_excluido: 'fa-eraser', removido_historico: 'fa-comment-slash', participante_removido: 'fa-user-xmark',
    conta_alterada: 'fa-user-shield', pagamento_feito: 'fa-money-bill-wave',
    cadastro_aguardando: 'fa-user-clock', cadastro_nao_reconhecido: 'fa-user-slash', termos_recusados: 'fa-file-signature'
  };

  const $ = id => document.getElementById(id);
  const criar = (tag, classe, texto) => {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  };
  const cortar = (t, max) => {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
  };

  let avisos = [];

  /** Abre o aviso no programa e já o tira daqui (o main.js tira da lista dele). */
  function abrirAviso(aviso) {
    avisos = avisos.filter(a => a.id !== aviso.id);
    desenhar();
    api?.abrir?.(aviso);
  }

  function linha(aviso) {
    const li = criar('li', `aw-aviso aw-aviso--${aviso.tipo || 'aviso'}`);
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.title = 'Abrir no programa';
    const icone = criar('span', 'aw-aviso__icone');
    const i = criar('i', `fas ${ICONE[aviso.tipo] || 'fa-bell'}`);
    i.setAttribute('aria-hidden', 'true');
    icone.appendChild(i);
    const corpo = criar('div', 'aw-aviso__corpo');
    corpo.appendChild(criar('strong', 'aw-aviso__titulo', aviso.titulo || 'Aviso'));
    if (aviso.mensagem) corpo.appendChild(criar('p', 'aw-aviso__texto', aviso.mensagem));
    const nota = Array.isArray(aviso.notas) ? aviso.notas[0] : null;
    if (nota) corpo.appendChild(criar('p', 'aw-aviso__nota', cortar(nota, MAX_NOTA)));
    li.append(icone, corpo);
    li.addEventListener('click', () => abrirAviso(aviso));
    li.addEventListener('keydown', e => { if (e.key === 'Enter') abrirAviso(aviso); });
    return li;
  }

  /**
   * A altura que o cartão precisa para mostrar tudo sem rolar: o que ele
   * ocupa agora mais o que está escondido na rolagem do meio, e a margem de
   * 1px em cima e embaixo. Vale com a janela curta ou alta.
   */
  function alturaNatural() {
    const cartao = $('avisoWindows').getBoundingClientRect().height;
    const corpo = $('awCorpo');
    const escondido = corpo ? Math.max(0, (Number(corpo.scrollHeight) || 0) - (Number(corpo.clientHeight) || 0)) : 0;
    return Math.ceil(cartao + escondido) + 2;
  }

  let ultimaAltura = 0;
  let desenhou = false;
  /**
   * Diz ao main.js a altura de que precisa (ele limita e põe no canto). Antes
   * de os avisos chegarem não diz nada: é a altura que faz a janela aparecer,
   * e ela apareceria vazia por um instante.
   */
  function ajustar(sempre = false) {
    if (!desenhou) return;
    const altura = alturaNatural();
    if (!sempre && altura === ultimaAltura) return;
    ultimaAltura = altura;
    api?.ajustarAltura?.(altura);
  }

  function desenhar() {
    const total = avisos.length;
    $('awContagem').textContent = total === 0 ? 'Nenhum aviso novo' : total === 1 ? '1 aviso novo' : `${total} avisos novos`;
    $('awLista').replaceChildren(...avisos.map(linha));
    $('awVazio').hidden = total > 0;
    $('awMais').textContent = '';
    desenhou = true;
    // A janela se ajusta ao que tem dentro (o main.js a posiciona no canto).
    requestAnimationFrame(() => ajustar(true));
  }

  // A medida da primeira vez podia sair com a janela ainda escondida (largura
  // e escala da tela provisórias): o texto quebrava em menos linhas e a
  // janela saía curta, cortando o rodapé. Medir de novo sempre que o tamanho
  // do conteúdo ou da janela mudar, e quando as fontes terminarem de chegar.
  if (typeof ResizeObserver === 'function') {
    const vigia = new ResizeObserver(() => ajustar());
    ['awLista', 'awVazio', 'awCorpo'].forEach(id => { if ($(id)) vigia.observe($(id)); });
  }
  window.addEventListener?.('resize', () => ajustar());
  document.fonts?.ready?.then(() => ajustar()).catch(() => {});

  function receber({ avisos: lista = [], som = false, somArquivo = null } = {}) {
    avisos = Array.isArray(lista) ? lista : [];
    desenhar();
    if (som && avisos.length) window.SomAviso?.tocar?.({ arquivo: somArquivo });
  }

  $('awFechar').addEventListener('click', () => api?.dispensar?.());
  $('awAbrir').addEventListener('click', () => api?.abrir?.(null));
  api?.onAvisos?.(receber);
  api?.pronto?.().then(receber).catch(() => {});

  window.__avisoWindows = { receber, linha, abrirAviso, alturaNatural, lista: () => avisos };
})();
