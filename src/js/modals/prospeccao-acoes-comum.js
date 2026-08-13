/**
 * Base compartilhada pelos modais de AÇÃO da prospecção
 * (mover no funil, interação, nota, campanha, próximo passo, converter).
 *
 * Todos seguem o mesmo roteiro: montar um formulário pequeno, mandar para o
 * backend, avisar quem está na tela e recarregar o que ficou desatualizado.
 * Sem isto, cada um dos seis repetiria o mesmo tratamento de erro e a mesma
 * dança de recarregar grade e detalhe — e um deles acabaria esquecendo.
 *
 * Exposto como `window.ProspeccaoAcoes`.
 */
(function () {
  if (window.ProspeccaoAcoes) return;

  async function fetchApi(caminho, opcoes = {}) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${caminho}`, {
      ...opcoes,
      headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) }
    });
  }

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const texto = v => {
    const s = (v === null || v === undefined) ? '' : String(v).trim();
    return s || null;
  };

  /**
   * Fecha o modal e recarrega o que a ação tornou obsoleto.
   *
   * Grade E detalhe: a ação quase sempre muda os dois (mover no funil altera a
   * etapa na lista e o histórico no detalhe). Recarregar só um deixaria a outra
   * tela mentindo até a próxima navegação.
   */
  async function concluir(overlayId, mensagem) {
    const tarefas = [];
    if (typeof window.recarregarDetalhesProspeccao === 'function') {
      tarefas.push(window.recarregarDetalhesProspeccao());
    }
    // Pelo objeto publicado, nunca pelo nome: menu.js embrulha o script do
    // módulo numa IIFE e `carregarProspeccoes` não existe neste escopo — a
    // grade simplesmente não recarregava depois de uma ação.
    const recarregarGrade = window.ProspeccoesModulo?.carregar;
    if (recarregarGrade) {
      tarefas.push(recarregarGrade(true));
    } else {
      // Rede de proteção: o módulo escuta este evento.
      window.dispatchEvent(new Event('prospeccaoAtualizada'));
    }
    // Recarrega ANTES do aviso: ao contrário, o usuário lê "registrado" com a
    // tela ainda mostrando o estado antigo e conclui que não funcionou.
    await Promise.all(tarefas).catch(err => console.error('[prospeccoes] falha ao recarregar', err));
    if (mensagem) showToast(mensagem, 'success');
    Modal.close(overlayId);
  }

  /**
   * Envia e trata a resposta de forma uniforme. Devolve `true` no sucesso.
   * O `error` do backend é sempre repassado: as mensagens dele explicam o
   * porquê (motivo da perda ausente, contato de outra prospecção, campo fiscal
   * faltando), e trocá-las por um genérico esconderia a única pista útil.
   */
  async function enviar(caminho, opcoes, { overlayId, sucesso, aoFalhar } = {}) {
    try {
      const resp = await fetchApi(caminho, opcoes);
      const corpo = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        if (typeof aoFalhar === 'function' && aoFalhar(resp.status, corpo)) return false;
        showToast(corpo.error || `Erro ${resp.status}`, 'error');
        return false;
      }

      await concluir(overlayId, sucesso);
      return corpo || true;
    } catch (err) {
      console.error('[prospeccoes] falha na ação', err);
      showToast('Falha de comunicação com o servidor', 'error');
      return false;
    }
  }

  /** Fechamento padrão: botões, Esc que não vaza para o modal de trás. */
  function ligarFechamento(overlay, overlayId, ids = []) {
    const fechar = () => Modal.close(overlayId);
    ids.forEach(id => document.getElementById(id)?.addEventListener('click', fechar));
    overlay?.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      // Estes modais abrem POR CIMA do detalhe. Sem parar a propagação, um Esc
      // fecharia os dois e o usuário perderia a tela inteira.
      e.stopPropagation();
      fechar();
    });
    return fechar;
  }

  /** Prende o clique do botão com trava de duplo clique, quando disponível. */
  function aoConfirmar(el, handler) {
    if (!el) return;
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(el, handler);
    else el.addEventListener('click', handler);
  }

  /** A prospecção em foco: o detalhe manda; a grade é o caminho alternativo. */
  function alvo() {
    return window.prospeccaoAcaoAlvo
      || window.prospeccaoDetalhesCarregada
      || window.prospeccaoDetalhes
      || null;
  }

  window.ProspeccaoAcoes = {
    fetchApi, esc, texto, enviar, concluir, ligarFechamento, aoConfirmar, alvo,
    PROBABILIDADE_POR_ETAPA: {
      'Novo': 10, 'Contactado': 25, 'Qualificado': 50,
      'Proposta': 65, 'Negociação': 80, 'Ganho': 100, 'Perdido': 0
    },
    ETAPAS_PADRAO: ['Novo', 'Contactado', 'Qualificado', 'Proposta', 'Negociação', 'Ganho', 'Perdido'],
    TIPOS_INTERACAO: ['Ligação', 'E-mail', 'Reunião', 'WhatsApp', 'Visita', 'Proposta', 'Nota'],
    STATUS_CAMPANHA: ['Planejada', 'Em andamento', 'Concluída', 'Cancelada']
  };
})();
