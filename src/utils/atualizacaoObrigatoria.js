/**
 * Caixa de atualização obrigatória.
 *
 * Regra: se a versão instalada estiver ABAIXO da versão disponível — qualquer
 * diferença, já que 0.0.1 é o menor passo possível — o usuário entra normalmente,
 * mas não consegue usar o app até atualizar.
 *
 * Por que `<dialog>` + `showModal()` e não um `<div>` com z-index: só a *top
 * layer* do navegador garante "acima de tudo", e ela também deixa o resto do
 * documento INERTE — ninguém clica em nada por trás, nem por atalho de teclado.
 * É o mesmo mecanismo do `DialogPadrao` e do `dialogTopLayer`.
 *
 * O que a torna impossível de fechar:
 *  - não existe botão de fechar, cancelar ou voltar;
 *  - o evento `cancel` (Esc) é cancelado;
 *  - clicar no fundo não fecha (`showModal` já não fecha por backdrop);
 *  - se alguém chamar `close()` de fora, ela se reabre sozinha.
 * A única saída é o botão Atualizar concluir — e aí o app reinicia.
 *
 * O botão usa `BotaoAcao.bind`, então herda a trava de duplo clique e o visual
 * de carregando do resto do app. Quem executa a atualização é o `aoAtualizar`
 * recebido de fora: aqui não há regra de negócio nenhuma, o fluxo que baixa e
 * instala continua sendo o do `AppUpdates`.
 */
(() => {
  const ID_ESTILOS = 'atualizacaoObrigatoriaEstilos';
  const ATRIBUTO = 'data-atualizacao-obrigatoria';

  let atual = null; // { dialog, botao, rotulo, etapa, erro, permitirFechar }

  function escapar(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function injetarEstilos() {
    if (document.getElementById(ID_ESTILOS)) return;
    const style = document.createElement('style');
    style.id = ID_ESTILOS;
    style.textContent = `
      dialog[${ATRIBUTO}] {
        padding: 0;
        border: none;
        background: transparent;
        max-width: none;
        color: #fff;
      }
      dialog[${ATRIBUTO}]::backdrop {
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(4px);
      }
      .atualizacao-obrigatoria-caixa {
        width: min(440px, calc(100vw - 32px));
        background: rgba(20, 20, 20, 0.94);
        backdrop-filter: blur(18px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 18px;
        box-shadow: 0 30px 90px rgba(0, 0, 0, 0.8);
        padding: 28px 26px 24px;
        text-align: center;
      }
      .atualizacao-obrigatoria-icone {
        width: 56px;
        height: 56px;
        margin: 0 auto 16px;
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(200, 178, 74, 0.14);
        color: #c8b24a;
        font-size: 24px;
      }
      .atualizacao-obrigatoria-titulo {
        font-size: 19px;
        font-weight: 600;
        margin-bottom: 10px;
      }
      .atualizacao-obrigatoria-texto {
        font-size: 14px;
        line-height: 1.5;
        opacity: 0.85;
        margin-bottom: 18px;
      }
      .atualizacao-obrigatoria-versoes {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        font-size: 13px;
        margin-bottom: 22px;
      }
      .atualizacao-obrigatoria-versao {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 8px 14px;
        min-width: 96px;
      }
      .atualizacao-obrigatoria-versao span {
        display: block;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        opacity: 0.55;
        margin-bottom: 2px;
      }
      .atualizacao-obrigatoria-versao strong { font-size: 15px; font-weight: 600; }
      .atualizacao-obrigatoria-versao--nova strong { color: #c8b24a; }
      .atualizacao-obrigatoria-seta { opacity: 0.4; }
      .atualizacao-obrigatoria-botao {
        width: 100%;
        padding: 12px 18px;
        border: none;
        border-radius: 10px;
        background: #c8b24a;
        color: #000;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: filter 150ms ease;
      }
      .atualizacao-obrigatoria-botao:hover { filter: brightness(1.08); }
      .atualizacao-obrigatoria-etapa {
        font-size: 13px;
        opacity: 0.7;
        margin-top: 14px;
        min-height: 18px;
      }
      .atualizacao-obrigatoria-erro {
        font-size: 13px;
        color: #ff8a80;
        margin-top: 12px;
        display: none;
      }
      .atualizacao-obrigatoria-erro.visivel { display: block; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function montar({ versaoLocal, versaoDisponivel }) {
    injetarEstilos();

    const dialog = document.createElement('dialog');
    dialog.setAttribute(ATRIBUTO, 'true');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-labelledby', 'atualizacaoObrigatoriaTitulo');
    dialog.innerHTML = `
      <div class="atualizacao-obrigatoria-caixa">
        <div class="atualizacao-obrigatoria-icone" aria-hidden="true">
          <i class="fas fa-cloud-download-alt"></i>
        </div>
        <h2 class="atualizacao-obrigatoria-titulo" id="atualizacaoObrigatoriaTitulo">
          Atualização necessária
        </h2>
        <p class="atualizacao-obrigatoria-texto">
          Há uma versão mais nova do sistema. Para continuar usando o aplicativo,
          aplique a atualização agora.
        </p>
        <div class="atualizacao-obrigatoria-versoes">
          <div class="atualizacao-obrigatoria-versao">
            <span>Sua versão</span>
            <strong data-versao-local>${escapar(versaoLocal || '—')}</strong>
          </div>
          <i class="fas fa-arrow-right atualizacao-obrigatoria-seta" aria-hidden="true"></i>
          <div class="atualizacao-obrigatoria-versao atualizacao-obrigatoria-versao--nova">
            <span>Disponível</span>
            <strong data-versao-disponivel>${escapar(versaoDisponivel || '—')}</strong>
          </div>
        </div>
        <button type="button" class="atualizacao-obrigatoria-botao" data-atualizar>Atualizar</button>
        <p class="atualizacao-obrigatoria-etapa" data-etapa role="status" aria-live="polite"></p>
        <p class="atualizacao-obrigatoria-erro" data-erro role="alert"></p>
      </div>
    `;

    document.body.appendChild(dialog);

    // Esc não fecha.
    dialog.addEventListener('cancel', evento => evento.preventDefault());

    // `close()` chamado de fora não fecha: reabrimos no mesmo instante.
    dialog.addEventListener('close', () => {
      if (!atual || atual.dialog !== dialog || atual.permitirFechar) return;
      if (dialog.isConnected) {
        try { dialog.showModal(); } catch (_) { /* já aberta */ }
      }
    });

    return dialog;
  }

  /**
   * Abre (ou atualiza, se já estiver aberta) a caixa obrigatória.
   *
   * @param {object} opcoes
   * @param {string} opcoes.versaoLocal      versão instalada
   * @param {string} opcoes.versaoDisponivel versão para a qual atualizar
   * @param {Function} opcoes.aoAtualizar    executa a atualização; deve rejeitar em caso de falha
   */
  function exigir({ versaoLocal, versaoDisponivel, aoAtualizar } = {}) {
    if (typeof aoAtualizar !== 'function') return null;

    if (atual?.dialog?.isConnected) {
      // Já está na tela: só mantém os números em dia.
      const local = atual.dialog.querySelector('[data-versao-local]');
      const nova = atual.dialog.querySelector('[data-versao-disponivel]');
      if (local && versaoLocal) local.textContent = versaoLocal;
      if (nova && versaoDisponivel) nova.textContent = versaoDisponivel;
      atual.aoAtualizar = aoAtualizar;
      return atual.dialog;
    }

    const dialog = montar({ versaoLocal, versaoDisponivel });
    const botao = dialog.querySelector('[data-atualizar]');
    const etapa = dialog.querySelector('[data-etapa]');
    const erro = dialog.querySelector('[data-erro]');

    atual = { dialog, botao, etapa, erro, aoAtualizar, permitirFechar: false };

    const executar = async () => {
      erro.textContent = '';
      erro.classList.remove('visivel');
      definirEtapa('Baixando atualização...');
      try {
        await atual.aoAtualizar();
        // Em caso de sucesso o app reinicia; a caixa fica como está até lá.
        definirEtapa('Aplicando atualização...');
      } catch (err) {
        definirEtapa('');
        relatarErro(err?.message || 'Não foi possível aplicar a atualização.');
      }
    };

    // `BotaoAcao.bind` dá a trava de duplo clique e o visual de carregando; sem
    // ele (ambiente sem o utilitário) ao menos o clique repetido é ignorado.
    if (window.BotaoAcao?.bind) {
      window.BotaoAcao.bind(botao, executar);
    } else {
      let ocupado = false;
      botao.addEventListener('click', async () => {
        if (ocupado) return;
        ocupado = true;
        try { await executar(); } finally { ocupado = false; }
      });
    }

    dialog.showModal();
    botao.focus();
    return dialog;
  }

  /** Texto de andamento abaixo do botão ("Baixando...", "Aplicando..."). */
  function definirEtapa(texto) {
    if (!atual?.etapa) return;
    atual.etapa.textContent = texto || '';
  }

  /** Mostra a falha e devolve o botão ao usuário para tentar de novo. */
  function relatarErro(mensagem) {
    if (!atual?.erro) return;
    atual.erro.textContent = mensagem || 'Não foi possível aplicar a atualização.';
    atual.erro.classList.add('visivel');
    if (atual.botao) atual.botao.textContent = 'Tentar novamente';
  }

  function estaAberta() {
    return Boolean(atual?.dialog?.isConnected && atual.dialog.open);
  }

  window.AtualizacaoObrigatoria = { exigir, definirEtapa, relatarErro, estaAberta };
})();
