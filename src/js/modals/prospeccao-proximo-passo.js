/**
 * Definir próximo passo — PUT /api/prospeccoes/:id/proximo-passo.
 *
 * Quando já existe passo em aberto, ele NÃO é simplesmente substituído: vira
 * uma atividade na timeline, e por isso a nota do que aconteceu é obrigatória.
 * Sem isso o combinado anterior desaparecia sem deixar rastro de ter sido
 * feito, adiado ou abandonado.
 */
(async function () {
  const overlay = document.getElementById('proximoPassoProspeccaoOverlay');
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
  const fechar = A.ligarFechamento(overlay, 'proximoPassoProspeccao',
    ['voltarProximoPasso', 'cancelarProximoPasso']);

  const prospeccao = A.alvo();
  if (!prospeccao?.id) {
    showToast('Prospecção não encontrada', 'error');
    fechar();
    return;
  }

  const passoAtual = (prospeccao.proximo_passo || '').trim();
  const temPassoAberto = Boolean(passoAtual);

  if (temPassoAberto) {
    get('passoAnteriorBloco').classList.remove('hidden');
    get('passoAnteriorTexto').textContent = passoAtual;
    if (prospeccao.proximo_passo_data) {
      // Data pura montada campo a campo: `new Date('2026-09-20')` é meia-noite
      // UTC e exibiria o dia anterior no Brasil.
      const [a, m, d] = String(prospeccao.proximo_passo_data).slice(0, 10).split('-').map(Number);
      get('passoAnteriorData').textContent = (a && m && d)
        ? `Agendado para ${new Date(a, m - 1, d).toLocaleDateString('pt-BR')}`
        : '';
    }
  }

  // O campo do novo passo abre VAZIO quando havia um anterior: o antigo vai
  // ser concluído, e repeti-lo induziria a reagendar a mesma coisa sem querer.
  get('proximoPassoTexto').value = temPassoAberto ? '' : passoAtual;
  get('proximoPassoData').value = temPassoAberto
    ? ''
    : (prospeccao.proximo_passo_data ? String(prospeccao.proximo_passo_data).slice(0, 10) : '');

  get('proximoPassoForm')?.addEventListener('submit', e => e.preventDefault());
  setTimeout(() => (temPassoAberto ? get('passoAnteriorNota') : get('proximoPassoTexto'))?.focus(), 60);

  A.aoConfirmar(get('salvarProximoPasso'), async () => {
    const texto = A.texto(get('proximoPassoTexto').value);
    const data = get('proximoPassoData').value || null;
    const nota = A.texto(get('passoAnteriorNota')?.value);

    // Uma data sem o que fazer nela não diz nada a quem for cobrar o retorno.
    if (data && !texto) {
      showToast('Descreva o que precisa ser feito nessa data', 'error');
      get('proximoPassoTexto').focus();
      return;
    }
    if (temPassoAberto && texto && !nota) {
      showToast('Descreva o que aconteceu com o passo anterior', 'error');
      get('passoAnteriorNota').focus();
      return;
    }

    await A.enviar(`/api/prospeccoes/${prospeccao.id}/proximo-passo`, {
      method: 'PUT',
      body: JSON.stringify({
        proximo_passo: texto,
        proximo_passo_data: data,
        nota_passo_anterior: nota
      })
    }, {
      overlayId: 'proximoPassoProspeccao',
      sucesso: texto ? 'Próximo passo definido' : 'Próximo passo encerrado'
    });
  });

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'proximoPassoProspeccao' }));
})();
