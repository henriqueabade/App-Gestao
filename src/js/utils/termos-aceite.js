/**
 * O aceite dos Termos de Uso e da Política de Privacidade na tela (02/10/2026).
 *
 * Um arquivo só para os dois lugares onde o aceite acontece:
 *   - a tela de login › Cadastrar: `ligarCaixas` põe as duas caixas de aceite
 *     no formulário;
 *   - dentro do programa: `verificarSessao` pergunta ao backend se o Sup Admin
 *     pediu o aceite e, se pediu, abre a caixa que só fecha aceitando ou
 *     recusando (`exigir`).
 *
 * A caixa de aceite NÃO se marca sozinha: clicar nela (ou no nome do
 * documento) abre o documento; só o botão "Li e aceito", que libera depois de
 * rolar até o fim, marca a caixa.
 *
 * O texto vem de src/js/utils/termos-documentos.js (window.TermosDocumentos),
 * carregado antes deste arquivo. O visual está em src/styles/termos-aceite.css
 * (vidro padrão dos modais). Sem Font Awesome nem folha de módulo: a tela de
 * login não tem nenhum dos dois.
 */
(function (global) {
  const Docs = () => global.TermosDocumentos;

  const ARTIGO = { termos_de_uso: 'os', politica_de_privacidade: 'a' };
  const FOLGA_DO_FIM_PX = 12;

  function el(tag, classe, texto) {
    const no = document.createElement(tag);
    if (classe) no.className = classe;
    if (texto !== undefined && texto !== null) no.textContent = String(texto);
    return no;
  }

  function botao(rotulo, variante) {
    const b = el('button', `termos-botao termos-botao--${variante}`, rotulo);
    b.type = 'button';
    // O carregando automático do programa não entra nestes botões: a própria
    // caixa mostra o que está acontecendo.
    b.dataset.semLoading = 'true';
    return b;
  }

  /** Abre um <dialog> na camada do topo; devolve o elemento. */
  function abrirDialogo(classe, rotulo) {
    const dialogo = el('dialog', `termos-dialogo ${classe}`);
    dialogo.setAttribute('aria-label', rotulo);
    document.body.appendChild(dialogo);
    dialogo.showModal();
    return dialogo;
  }

  /** O corpo do documento: seções numeradas, parágrafos e listas. */
  function desenharDocumento(doc) {
    const corpo = el('div', 'termos-doc');
    doc.secoes.forEach((secao, i) => {
      const bloco = el('section', 'termos-doc__secao');
      bloco.appendChild(el('h3', 'termos-doc__titulo', `${i + 1}. ${secao.titulo}`));
      secao.blocos.forEach(item => {
        if (typeof item === 'string') {
          bloco.appendChild(el('p', 'termos-doc__texto', item));
          return;
        }
        const lista = el('ul', 'termos-doc__lista');
        (item.lista || []).forEach(linha => lista.appendChild(el('li', null, linha)));
        bloco.appendChild(lista);
      });
      corpo.appendChild(bloco);
    });
    corpo.appendChild(el('p', 'termos-doc__fim', 'Fim do documento.'));
    return corpo;
  }

  /**
   * Mostra um documento. Resolve `true` quando a pessoa clica em "Li e
   * aceito" (que só libera depois de rolar até o fim) e `false` no Voltar.
   * `somenteLeitura`: só o Fechar, sem aceite.
   */
  function abrirDocumento(chave, { somenteLeitura = false } = {}) {
    const doc = Docs()?.documento(chave);
    if (!doc) return Promise.resolve(false);

    return new Promise(resolve => {
      const dialogo = abrirDialogo('termos-dialogo--documento', doc.titulo);
      const cartao = el('div', 'termos-cartao');

      const topo = el('header', 'termos-topo');
      topo.appendChild(el('h2', 'termos-topo__titulo', doc.titulo));
      topo.appendChild(el('p', 'termos-topo__sub', Docs().linhaDaVersao(doc)));

      const rolagem = el('div', 'termos-rolagem');
      rolagem.tabIndex = 0;
      rolagem.setAttribute('role', 'document');
      rolagem.appendChild(desenharDocumento(doc));

      const rodape = el('footer', 'termos-rodape');
      const dica = el('p', 'termos-rodape__dica');
      const acoes = el('div', 'termos-rodape__acoes');
      const voltar = botao(somenteLeitura ? 'Fechar' : 'Voltar', 'neutro');
      const aceitar = botao('Li e aceito', 'sucesso');
      aceitar.disabled = true;
      acoes.appendChild(voltar);
      if (!somenteLeitura) acoes.appendChild(aceitar);
      rodape.append(dica, acoes);

      cartao.append(topo, rolagem, rodape);
      dialogo.appendChild(cartao);

      let chegouAoFim = false;
      const conferirRolagem = () => {
        if (chegouAoFim) return;
        if (rolagem.scrollTop + rolagem.clientHeight >= rolagem.scrollHeight - FOLGA_DO_FIM_PX) {
          chegouAoFim = true;
          aceitar.disabled = false;
          dica.textContent = somenteLeitura ? '' : 'Documento lido até o fim. Agora você pode aceitar.';
          dica.classList.add('termos-rodape__dica--ok');
        }
      };
      dica.textContent = somenteLeitura ? '' : 'Role o documento até o fim para liberar o aceite.';
      rolagem.addEventListener('scroll', conferirRolagem, { passive: true });
      // Documento que cabe inteiro na tela já está "no fim".
      requestAnimationFrame(conferirRolagem);

      const fechar = resultado => {
        dialogo.close();
        dialogo.remove();
        resolve(resultado);
      };
      voltar.addEventListener('click', () => fechar(false));
      aceitar.addEventListener('click', () => { if (chegouAoFim) fechar(true); });
      // Esc = Voltar (aqui pode: quem não pode fechar é a caixa de `exigir`).
      dialogo.addEventListener('cancel', evento => { evento.preventDefault(); fechar(false); });
      rolagem.focus({ preventScroll: true });
    });
  }

  /**
   * As duas caixas de aceite ("Li e aceito os Termos de Uso" / "… a Política
   * de Privacidade") dentro de `alvo`. Devolve:
   *   completo() — as duas marcadas?
   *   aceitos()  — { termos_de_uso: versão, politica_de_privacidade: versão } ou null
   *   limpar()   — desmarca tudo
   */
  function ligarCaixas(alvo, { aoMudar } = {}) {
    const documentos = Docs();
    const estado = new Map(); // chave -> versão aceita
    const marcas = new Map();
    if (!alvo || !documentos) return { completo: () => false, aceitos: () => null, limpar() {} };

    alvo.classList.add('termos-caixas');
    alvo.replaceChildren();

    const avisar = () => { if (typeof aoMudar === 'function') aoMudar(completo()); };
    const completo = () => documentos.ORDEM.every(chave => estado.has(chave));

    async function abrir(chave) {
      const aceitou = await abrirDocumento(chave);
      if (!aceitou) return;
      estado.set(chave, documentos.documento(chave).versao);
      marcas.get(chave).checked = true;
      avisar();
    }

    documentos.ORDEM.forEach(chave => {
      const doc = documentos.documento(chave);
      const linha = el('div', 'termos-caixa');
      const marca = el('input', 'termos-caixa__marca');
      marca.type = 'checkbox';
      marca.id = `termosAceite_${chave}_${Math.random().toString(36).slice(2, 8)}`;
      marca.setAttribute('aria-label', `Li e aceito ${ARTIGO[chave] || 'o'} ${doc.titulo}`);
      const rotulo = el('span', 'termos-caixa__texto', `Li e aceito ${ARTIGO[chave] || 'o'} `);
      const nome = el('button', 'termos-caixa__nome', doc.titulo);
      nome.type = 'button';
      nome.dataset.semLoading = 'true';
      nome.title = `Abrir ${doc.titulo}`;
      rotulo.appendChild(nome);
      linha.append(marca, rotulo);
      alvo.appendChild(linha);
      marcas.set(chave, marca);

      // Marcar exige ler: o clique abre o documento e quem marca é o "Li e
      // aceito". Desmarcar é livre.
      marca.addEventListener('click', evento => {
        if (estado.has(chave)) {
          estado.delete(chave);
          marca.checked = false;
          avisar();
          return;
        }
        evento.preventDefault();
        abrir(chave);
      });
      nome.addEventListener('click', () => abrir(chave));
    });

    return {
      completo,
      aceitos: () => (completo() ? Object.fromEntries(estado) : null),
      limpar() {
        estado.clear();
        marcas.forEach(marca => { marca.checked = false; });
        avisar();
      }
    };
  }

  // ------------------------------------------------------------------
  // Dentro do programa: a caixa que só fecha aceitando ou recusando.
  // ------------------------------------------------------------------

  async function chamar(caminho, opcoes) {
    const base = (await global.apiConfig?.getApiBaseUrl?.()) || '';
    const resposta = await fetch(`${base}${caminho}`, opcoes);
    let corpo = null;
    try { corpo = await resposta.json(); } catch (_) { corpo = null; }
    return { ok: resposta.ok, status: resposta.status, corpo };
  }

  const enviar = (caminho, corpo) => chamar(caminho, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo || {})
  });

  let caixaAberta = null;

  /**
   * Abre a caixa obrigatória. Não tem X, o Esc não fecha e, se alguém a
   * tirar da tela, ela volta. Resolve quando o aceite foi gravado; na recusa
   * a pessoa é levada para a tela de login (a promessa não resolve).
   */
  function exigir() {
    if (caixaAberta) return caixaAberta;

    caixaAberta = new Promise(resolve => {
      let decidido = false;
      const dialogo = abrirDialogo('termos-dialogo--exigir', 'Termos de Uso e Política de Privacidade');
      const cartao = el('div', 'termos-cartao');

      const topo = el('header', 'termos-topo termos-topo--aviso');
      topo.appendChild(el('h2', 'termos-topo__titulo', 'Termos de Uso e Política de Privacidade'));
      topo.appendChild(el('p', 'termos-topo__sub',
        'O administrador pediu que você leia e aceite os documentos abaixo para continuar usando o programa. '
        + 'Eles explicam as regras de uso, o que o programa registra do seu trabalho, os avisos que ele envia e como os seus dados são tratados.'));
      topo.appendChild(el('p', 'termos-topo__regra',
        'Esta caixa só fecha com a sua resposta: aceitar os dois documentos ou recusar. '
        + 'Se recusar, o seu acesso é desativado e você volta para a tela de entrada.'));

      const corpo = el('div', 'termos-corpo');
      corpo.appendChild(el('p', 'termos-corpo__dica', 'Clique no nome de cada documento, leia até o fim e marque "Li e aceito".'));
      const alvoDasCaixas = el('div');
      corpo.appendChild(alvoDasCaixas);
      const erro = el('p', 'termos-erro');
      erro.setAttribute('role', 'alert');
      erro.hidden = true;
      corpo.appendChild(erro);

      const rodape = el('footer', 'termos-rodape');
      const acoes = el('div', 'termos-rodape__acoes termos-rodape__acoes--separadas');
      const recusar = botao('Recusar', 'perigo');
      const aceitar = botao('Aceitar e continuar', 'sucesso');
      aceitar.disabled = true;
      acoes.append(recusar, aceitar);
      rodape.appendChild(acoes);

      cartao.append(topo, corpo, rodape);
      dialogo.appendChild(cartao);

      const caixas = ligarCaixas(alvoDasCaixas, { aoMudar: ok => { aceitar.disabled = !ok; } });

      const mostrarErro = texto => {
        erro.textContent = texto || '';
        erro.hidden = !texto;
      };
      const ocupar = (ocupado, rotuloDoAceitar) => {
        recusar.disabled = ocupado;
        aceitar.disabled = ocupado || !caixas.completo();
        aceitar.textContent = rotuloDoAceitar || 'Aceitar e continuar';
      };

      // Nada fecha a caixa antes da resposta.
      dialogo.addEventListener('cancel', evento => evento.preventDefault());
      dialogo.addEventListener('close', () => {
        if (!decidido && dialogo.isConnected) dialogo.showModal();
      });
      const vigia = setInterval(() => {
        if (decidido) return;
        if (!dialogo.isConnected) document.body.appendChild(dialogo);
        if (!dialogo.open) dialogo.showModal();
      }, 1000);

      const encerrar = () => {
        decidido = true;
        clearInterval(vigia);
        dialogo.close();
        dialogo.remove();
        caixaAberta = null;
      };

      aceitar.addEventListener('click', async () => {
        const aceitos = caixas.aceitos();
        if (!aceitos) return;
        mostrarErro('');
        ocupar(true, 'Registrando o aceite…');
        try {
          const r = await enviar('/api/usuarios/me/termos/aceitar', { documentos: aceitos });
          if (!r.ok) {
            mostrarErro(r.corpo?.error || 'Não foi possível registrar o aceite agora. Tente de novo.');
            ocupar(false);
            return;
          }
          encerrar();
          global.showToast?.('Aceite registrado. Obrigado!', 'success');
          resolve(true);
        } catch (_) {
          mostrarErro('Sem resposta do programa. Confira a conexão e tente de novo.');
          ocupar(false);
        }
      });

      recusar.addEventListener('click', async () => {
        mostrarErro('');
        const confirmou = await confirmarRecusa();
        if (!confirmou) return;
        ocupar(true);
        recusar.textContent = 'Recusando…';
        try {
          const r = await enviar('/api/usuarios/me/termos/recusar');
          if (!r.ok) {
            mostrarErro(r.corpo?.error || 'Não foi possível registrar a recusa agora. Tente de novo.');
            recusar.textContent = 'Recusar';
            ocupar(false);
            return;
          }
          encerrar();
          await sairPorRecusa();
        } catch (_) {
          mostrarErro('Sem resposta do programa. Confira a conexão e tente de novo.');
          recusar.textContent = 'Recusar';
          ocupar(false);
        }
      });
    });
    return caixaAberta;
  }

  /** "Tem certeza?" antes de recusar: diz o que acontece. */
  function confirmarRecusa() {
    return new Promise(resolve => {
      const dialogo = abrirDialogo('termos-dialogo--confirmar', 'Recusar os termos');
      const cartao = el('div', 'termos-cartao termos-cartao--perigo');
      const topo = el('header', 'termos-topo');
      topo.appendChild(el('h2', 'termos-topo__titulo', 'Recusar os termos?'));
      const corpo = el('div', 'termos-corpo');
      corpo.appendChild(el('p', 'termos-doc__texto', 'Para usar o programa é necessário aceitar os Termos de Uso e a Política de Privacidade. Se você recusar:'));
      const lista = el('ul', 'termos-doc__lista');
      [
        'o seu acesso é desativado agora;',
        'você volta para a tela de entrada e não consegue mais entrar;',
        'a sua conta não é excluída: só o administrador pode reativá-la.'
      ].forEach(linha => lista.appendChild(el('li', null, linha)));
      corpo.appendChild(lista);
      const rodape = el('footer', 'termos-rodape');
      const acoes = el('div', 'termos-rodape__acoes');
      const voltar = botao('Voltar', 'neutro');
      const confirmar = botao('Recusar e sair', 'perigo');
      acoes.append(voltar, confirmar);
      rodape.appendChild(acoes);
      cartao.append(topo, corpo, rodape);
      dialogo.appendChild(cartao);

      const fechar = resultado => {
        dialogo.close();
        dialogo.remove();
        resolve(resultado);
      };
      voltar.addEventListener('click', () => fechar(false));
      confirmar.addEventListener('click', () => fechar(true));
      dialogo.addEventListener('cancel', evento => { evento.preventDefault(); fechar(false); });
      voltar.focus();
    });
  }

  /** Recusou: limpa a sessão guardada e volta para a tela de login, que explica. */
  async function sairPorRecusa() {
    try {
      localStorage.setItem('termosRecusados', '1');
      localStorage.removeItem('user');
      localStorage.removeItem('rememberUser');
      sessionStorage.removeItem('currentUser');
    } catch (_) { /* sem armazenamento: o login só não mostra o aviso */ }
    try { global.stopServerCheck?.(); } catch (_) { /* o monitor pode não existir */ }
    try {
      await global.electronAPI?.openLoginHidden?.();
      await global.electronAPI?.logout?.();
    } catch (err) {
      console.error('[termos] falha ao voltar para a tela de entrada:', err);
    }
  }

  let conferindo = null;

  /**
   * Pergunta ao backend se há aceite pendente e, havendo, abre a caixa e
   * espera a resposta. Devolve true quando a caixa foi mostrada e aceita.
   * Falha de rede não trava o programa: tenta de novo na próxima conferência.
   */
  function verificarSessao() {
    if (caixaAberta) return caixaAberta;
    if (conferindo) return conferindo;
    conferindo = (async () => {
      try {
        const r = await chamar('/api/usuarios/me/termos');
        if (!r.ok || !r.corpo?.pendente) return false;
        return await exigir();
      } catch (err) {
        console.warn('[termos] não foi possível conferir o aceite agora:', err?.message || err);
        return false;
      } finally {
        conferindo = null;
      }
    })();
    return conferindo;
  }

  let vigiando = false;
  const INTERVALO_DA_VIGIA_MS = 60 * 1000;

  /**
   * Com o programa aberto, confere de novo ao voltar para a frente (inclusive
   * vindo do segundo plano) e a cada minuto: o pedido do Sup Admin chega a
   * quem já está com a sessão aberta.
   */
  function vigiarSessao() {
    if (vigiando) return;
    vigiando = true;
    const conferir = () => { if (!document.hidden) verificarSessao(); };
    global.addEventListener('focus', conferir);
    document.addEventListener('visibilitychange', conferir);
    setInterval(conferir, INTERVALO_DA_VIGIA_MS);
  }

  global.TermosAceite = { abrirDocumento, ligarCaixas, exigir, verificarSessao, vigiarSessao };
})(window);
