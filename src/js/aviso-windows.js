/**
 * A janela dos avisos no canto da tela (01/10/2026) — ver backend/janelaDeAviso.js.
 *
 * Mostra até 3 avisos (os mais novos em cima), cada um com o título, a
 * mensagem e o começo da nota; "e mais N no sino" quando há mais.
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
  const MAX_VISIVEIS = 3;
  const ICONE = {
    comentario: 'fa-comment', resposta: 'fa-reply', curtida: 'fa-heart', observacao: 'fa-pen-to-square', mencao: 'fa-at',
    tarefa_lembrete: 'fa-clock', tarefa_atrasada: 'fa-triangle-exclamation', tarefa_atribuida: 'fa-list-check',
    tarefa_alterada: 'fa-calendar-days', tarefa_concluida: 'fa-circle-check', convite_tarefa: 'fa-user-plus',
    convite_respondido: 'fa-user-check', acao_concluida: 'fa-bolt', tarefa_automatica: 'fa-robot',
    responsavel_novo: 'fa-user-tag', responsavel_saiu: 'fa-user-minus', registro_alterado: 'fa-pen',
    registro_excluido: 'fa-trash-can', registro_cancelado: 'fa-ban', item_alterado: 'fa-pen-to-square',
    item_excluido: 'fa-eraser', removido_historico: 'fa-comment-slash', participante_removido: 'fa-user-xmark',
    conta_alterada: 'fa-user-shield'
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
    if (nota) corpo.appendChild(criar('p', 'aw-aviso__nota', cortar(nota, 180)));
    li.append(icone, corpo);
    li.addEventListener('click', () => abrirAviso(aviso));
    li.addEventListener('keydown', e => { if (e.key === 'Enter') abrirAviso(aviso); });
    return li;
  }

  function desenhar() {
    const total = avisos.length;
    $('awContagem').textContent = total === 0 ? 'Nenhum aviso novo' : total === 1 ? '1 aviso novo' : `${total} avisos novos`;
    $('awLista').replaceChildren(...avisos.slice(0, MAX_VISIVEIS).map(linha));
    $('awVazio').hidden = total > 0;
    const resto = total - MAX_VISIVEIS;
    $('awMais').textContent = resto > 0 ? `e mais ${resto} no sino` : '';
    // A janela se ajusta ao que tem dentro (o main.js a posiciona no canto).
    requestAnimationFrame(() => api?.ajustarAltura?.(Math.ceil($('avisoWindows').getBoundingClientRect().height) + 2));
  }

  function receber({ avisos: lista = [], som = false, somArquivo = null } = {}) {
    avisos = Array.isArray(lista) ? lista : [];
    desenhar();
    if (som && avisos.length) window.SomAviso?.tocar?.({ arquivo: somArquivo });
  }

  $('awFechar').addEventListener('click', () => api?.dispensar?.());
  $('awAbrir').addEventListener('click', () => api?.abrir?.(null));
  api?.onAvisos?.(receber);
  api?.pronto?.().then(receber).catch(() => {});

  window.__avisoWindows = { receber, linha, abrirAviso, lista: () => avisos };
})();
