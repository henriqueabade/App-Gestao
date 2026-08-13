/**
 * Nota da prospecção — cria (POST) ou edita (PUT).
 *
 * O MESMO modal para os dois: quem abre define `window.prospeccaoNotaEditar`
 * quando é edição. Duas telas quase iguais divergiriam na primeira regra que
 * mudasse.
 */
(async function () {
  const overlay = document.getElementById('notaProspeccaoOverlay');
  if (!overlay) return;

  if (!window.ProspeccaoAcoes) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/modals/prospeccao-acoes-comum.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const A = window.ProspeccaoAcoes;
  const get = id => document.getElementById(id);
  const fechar = A.ligarFechamento(overlay, 'notaProspeccao',
    ['voltarNotaProspeccao', 'cancelarNotaProspeccao']);

  const prospeccao = A.alvo();
  if (!prospeccao?.id) {
    showToast('Prospecção não encontrada', 'error');
    fechar();
    return;
  }

  // Consome o sinal na hora: deixá-lo pendurado faria a PRÓXIMA "Nova nota"
  // abrir em modo edição e sobrescrever a nota anterior.
  const edicao = window.prospeccaoNotaEditar || null;
  delete window.prospeccaoNotaEditar;

  if (edicao) {
    get('tituloModalNota').textContent = 'Editar Nota';
    get('notaTitulo').value = edicao.titulo || '';
    get('notaConteudo').value = edicao.conteudo || '';
    // Sem devolver o contexto, uma queda reabriria o modal em modo criação e a
    // edição viraria uma nota nova (ver docs/restauracao-de-trabalho.md).
    window.EstadoTrabalho?.registrarContexto?.('notaProspeccao',
      () => ({ prospeccaoNotaEditar: edicao }));
  }

  get('notaProspeccaoForm')?.addEventListener('submit', e => e.preventDefault());
  setTimeout(() => get('notaConteudo')?.focus(), 60);

  A.aoConfirmar(get('salvarNotaProspeccao'), async () => {
    const conteudo = A.texto(get('notaConteudo').value);
    if (!conteudo) {
      showToast('A nota não pode estar vazia', 'error');
      get('notaConteudo').focus();
      return;
    }

    const corpo = JSON.stringify({ titulo: A.texto(get('notaTitulo').value), conteudo });
    await A.enviar(
      edicao
        ? `/api/prospeccoes/${prospeccao.id}/notas/${edicao.id}`
        : `/api/prospeccoes/${prospeccao.id}/notas`,
      { method: edicao ? 'PUT' : 'POST', body: corpo },
      { overlayId: 'notaProspeccao', sucesso: edicao ? 'Nota atualizada' : 'Nota adicionada' }
    );
  });

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'notaProspeccao' }));
})();
