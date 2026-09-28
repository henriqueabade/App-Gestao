/**
 * Modais da Contabilidade — Fechamento do mês (etapa 1).
 *
 * Um script para os três modais do módulo: a anatomia é a mesma — Voltar,
 * Cancelar e Esc fecham; a ação principal fica no rodapé — e o que muda é a
 * leitura e a gravação. Quem abre diz qual é o modal por
 * `window.contabilidadeModalContexto.overlayId` (ver `ctbAbrirModal` em
 * contabilidade.js).
 *
 *   ctbFechar             Fechar competência — relê o checklist e grava (POST /fechar)
 *   ctbReabrir            Reabrir competência — justificativa (POST /reabrir)
 *   ctbIgnorarPendencia   Ignorar pendência — justificativa (POST /pendencias/ignorar)
 *
 * Ao fechar qualquer um deles, a tela relê o painel (ContabilidadeRecarregar).
 */
(() => {
  const NIVEIS = { critico: 'Erro crítico', documental: 'Pendência documental', aviso: 'Aviso' };
  const ESTADOS = { ok: 'Em dia', pendente: 'Pendente', aviso: 'Com avisos', critico: 'Erro crítico', em_curso: 'Mês em curso', indisponivel: 'Ainda não integrado' };
  const SITUACOES = { aberta: 'Aberta', fechada: 'Fechada', reaberta: 'Reaberta' };

  const contexto = window.contabilidadeModalContexto || {};
  const overlayId = contexto.overlayId;
  const overlay = overlayId ? document.getElementById(`${overlayId}Overlay`) : null;
  if (!overlay) return;

  const el = id => overlay.querySelector(`#${id}`);
  let processando = false;

  const fechar = () => {
    // Fechamento em andamento não pode ser cancelado por engano.
    if (processando) return;
    desligar();
    window.Modal?.close(overlayId);
    window.ContabilidadeRecarregar?.();
  };
  const ehOModalDeCima = () => {
    const abertos = [...document.querySelectorAll('[data-ctb-modal]')].filter(o => !o.classList.contains('hidden'));
    return abertos[abertos.length - 1] === overlay;
  };
  const aoEsc = e => {
    if (e.key !== 'Escape' || !ehOModalDeCima()) return;
    e.preventDefault();
    fechar();
  };
  const aoFecharPorFora = e => { if (e?.detail === overlayId) { desligar(); window.ContabilidadeRecarregar?.(); } };
  function desligar() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharPorFora);
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharPorFora);
  overlay.querySelectorAll('[data-ctb-fechar]').forEach(b => b.addEventListener('click', fechar));

  // ------------------------------------------------------------ helpers

  /**
   * Botão que chama `BotaoAcao.run` no próprio clique precisa da marca
   * `data-acao-gerida`: sem ela a rede automática do BotaoAcao o marca como
   * ocupado antes deste handler e o `run` desiste achando que é um segundo clique.
   */
  function acionar(botao, fn) {
    if (!botao) return;
    botao.dataset.acaoGerida = 'true';
    botao.addEventListener('click', () => (window.BotaoAcao?.run ? window.BotaoAcao.run(botao, fn) : fn()));
  }

  async function fetchApi(caminho, opcoes) {
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}${caminho}`, { ...opcoes, headers: { 'Content-Type': 'application/json', ...(opcoes?.headers || {}) } });
    let corpo = null;
    try { corpo = await resposta.json(); } catch (_) { corpo = null; }
    if (!resposta.ok) {
      const e = new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
      e.status = resposta.status;
      e.corpo = corpo;
      throw e;
    }
    return corpo;
  }

  function mostrarMensagem(id, texto, tipo = 'erro') {
    const alvo = el(id);
    if (!alvo) return;
    alvo.textContent = texto || '';
    alvo.style.color = tipo === 'erro' ? 'var(--color-red)' : 'var(--color-primary)';
    alvo.classList.toggle('hidden', !texto);
  }

  function textoDoErro(e, semPermissao) {
    if (e?.status === 403) return semPermissao;
    if (e?.corpo?.sql_pendente) return e.message || 'Falta rodar sql/contabilidade_base.sql no banco e reiniciar a API.';
    if (Array.isArray(e?.corpo?.bloqueios) && e.corpo.bloqueios.length) return `${e.message} ${e.corpo.bloqueios.join(' ')}`;
    return e?.message || 'Erro inesperado.';
  }

  function criar(tag, classe, texto) {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function pintarSituacao(alvo, status) {
    if (!alvo) return;
    const classe = status === 'fechada' ? 'badge-success' : (status === 'reaberta' ? 'badge-danger' : 'badge-warning');
    alvo.className = `${classe} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
    alvo.textContent = SITUACOES[status] || '—';
  }

  /** Linhas rótulo → valor numa <dl class="ctb-dados">. */
  function preencherDados(dl, linhas) {
    if (!dl) return;
    dl.replaceChildren();
    for (const [rotulo, valor] of linhas) {
      const div = criar('div', 'ctb-dados__linha');
      div.append(criar('dt', null, rotulo), criar('dd', null, valor));
      dl.appendChild(div);
    }
  }

  function itemDaLista(texto, icone, cor) {
    const li = criar('li');
    const i = criar('i', `fas ${icone}`);
    i.setAttribute('aria-hidden', 'true');
    if (cor) i.style.color = cor;
    li.append(i, criar('span', null, texto));
    return li;
  }

  const formatarInstante = instante => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(instante || ''));
    if (!m) return '—';
    return m[4] ? `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`;
  };

  function montarCompetencias(campo, selecionada) {
    if (!campo) return;
    const alvo = /^\d{4}-\d{2}$/.test(String(selecionada || '')) ? selecionada : window.Competencia?.atual?.() || '';
    if (window.Competencia) {
      window.Competencia.montar(campo, { valor: alvo });
      return;
    }
    campo.value = alvo;
  }

  // ------------------------------------------------------------ fechar

  function montarFechar() {
    const compSel = el('ctbFecharCompetencia');
    montarCompetencias(compSel, contexto.competencia);
    const confirmarBtn = el('ctbFecharConfirmar');
    let painel = null;
    let leitura = 0;

    function pintar() {
      const p = painel;
      confirmarBtn.classList.toggle('hidden', !p || !p.pode?.fechar);
      pintarSituacao(el('ctbFecharSituacao'), p?.situacao?.status || 'aberta');
      el('ctbFecharInfo').textContent = p ? `${p.rotulo}${p.encerrada ? '' : ' — o mês ainda está em curso'}` : '';
      const linhas = [];
      if (p) {
        for (const f of p.fontes || []) linhas.push([f.titulo, ESTADOS[f.estado] || f.estado]);
        linhas.push(['Erros críticos', String(p.contagem?.critico ?? 0)]);
        linhas.push(['Pendências documentais', String(p.contagem?.documental ?? 0)]);
        linhas.push(['Avisos', String(p.contagem?.aviso ?? 0)]);
        linhas.push(['Ignoradas com justificativa', String(p.contagem?.ignoradas ?? 0)]);
      }
      preencherDados(el('ctbFecharDados'), linhas);

      const bloqueios = p?.bloqueios?.fechar || [];
      el('ctbFecharBloqueios').classList.toggle('hidden', !bloqueios.length);
      el('ctbFecharBloqueiosLista').replaceChildren(...bloqueios.map(t => itemDaLista(t, 'fa-ban')));

      const sobras = (p?.pendencias || []).filter(x => !x.ignorada && x.nivel !== 'critico');
      el('ctbFecharSobras').classList.toggle('hidden', !p || !p.pode?.fechar || !sobras.length);
      el('ctbFecharSobrasLista').replaceChildren(...sobras.map(x => itemDaLista(`${NIVEIS[x.nivel] || x.nivel}: ${x.titulo}`, x.nivel === 'documental' ? 'fa-file-alt' : 'fa-info-circle', x.nivel === 'documental' ? 'var(--color-primary-light)' : 'var(--color-violet)')));
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbFecharMensagem', '');
      el('ctbFecharCarregando').classList.remove('hidden');
      try {
        const r = await fetchApi(`/api/contabilidade/painel?competencia=${encodeURIComponent(compSel.value || '')}`);
        if (minha !== leitura) return;
        painel = r;
        if (r?.sql_pendente) mostrarMensagem('ctbFecharMensagem', 'Falta rodar sql/contabilidade_base.sql no banco e reiniciar a API: o fechamento não será gravado.');
      } catch (e) {
        if (minha !== leitura) return;
        painel = null;
        mostrarMensagem('ctbFecharMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      } finally {
        if (minha === leitura) el('ctbFecharCarregando').classList.add('hidden');
      }
      pintar();
    }

    async function confirmar() {
      if (!painel?.pode?.fechar) return;
      const confirmado = await (window.DialogPadrao?.confirm
        ? window.DialogPadrao.confirm({
          title: 'Fechar a competência?',
          message: `${painel.rotulo}: ${painel.contagem?.documental || 0} pendência(s) documental(is) e ${painel.contagem?.aviso || 0} aviso(s) ficam registrados. Depois só com reabertura justificada.`,
          confirmText: 'Confirmar fechamento'
        })
        : Promise.resolve(window.confirm(`Fechar ${painel.rotulo}?`)));
      if (!confirmado) return;
      processando = true;
      try {
        await fetchApi('/api/contabilidade/fechar', { method: 'POST', body: JSON.stringify({ competencia: compSel.value }) });
        window.showToast?.(`Competência ${painel.rotulo} fechada.`, 'success');
        processando = false;
        fechar();
      } catch (e) {
        mostrarMensagem('ctbFecharMensagem', textoDoErro(e, 'Você não tem permissão para fechar a competência.'));
      } finally {
        processando = false;
      }
    }

    compSel.addEventListener('change', carregar);
    acionar(confirmarBtn, confirmar);
    return carregar();
  }

  // ------------------------------------------------------------ reabrir

  function montarReabrir() {
    const confirmarBtn = el('ctbReabrirConfirmar');
    const campo = el('ctbReabrirJustificativa');
    const competencia = contexto.competencia || '';
    let situacao = null;

    async function carregar() {
      try {
        const r = await fetchApi(`/api/contabilidade/painel?competencia=${encodeURIComponent(competencia)}`);
        situacao = r?.situacao || null;
        el('ctbReabrirRotulo').textContent = r?.rotulo || competencia;
        pintarSituacao(el('ctbReabrirSituacao'), situacao?.status || 'aberta');
        preencherDados(el('ctbReabrirDados'), [
          ['Fechada em', formatarInstante(situacao?.fechada_em)],
          ['Por', situacao?.fechada_por || '—'],
          ['Erros críticos novos desde então', String(situacao?.divergencias ?? 0)]
        ]);
        const podeReabrir = situacao?.status === 'fechada';
        confirmarBtn.classList.toggle('hidden', !podeReabrir);
        if (!podeReabrir) mostrarMensagem('ctbReabrirMensagem', 'Esta competência não está fechada.');
      } catch (e) {
        confirmarBtn.classList.add('hidden');
        mostrarMensagem('ctbReabrirMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    async function confirmar() {
      mostrarMensagem('ctbReabrirMensagem', '');
      const j = String(campo.value || '').trim();
      if (j.length < 10) { mostrarMensagem('ctbReabrirMensagem', 'Escreva a justificativa da reabertura (pelo menos 10 caracteres).'); campo.focus(); return; }
      const confirmado = await (window.DialogPadrao?.confirm
        ? window.DialogPadrao.confirm({ title: 'Reabrir a competência?', message: `${el('ctbReabrirRotulo').textContent} volta a aceitar lançamentos e precisará de um novo fechamento.`, confirmText: 'Reabrir' })
        : Promise.resolve(window.confirm('Reabrir a competência?')));
      if (!confirmado) return;
      processando = true;
      try {
        await fetchApi('/api/contabilidade/reabrir', { method: 'POST', body: JSON.stringify({ competencia, justificativa: j }) });
        window.showToast?.('Competência reaberta.', 'success');
        processando = false;
        fechar();
      } catch (e) {
        mostrarMensagem('ctbReabrirMensagem', textoDoErro(e, 'Você não tem permissão para reabrir a competência.'));
      } finally {
        processando = false;
      }
    }

    acionar(confirmarBtn, confirmar);
    return carregar();
  }

  // ------------------------------------------------------------ ignorar pendência

  function montarIgnorarPendencia() {
    const confirmarBtn = el('ctbIgnorarConfirmar');
    const campo = el('ctbIgnorarJustificativa');
    const p = contexto.pendencia || null;
    const competencia = contexto.competencia || '';

    function pintar() {
      if (!p) {
        confirmarBtn.classList.add('hidden');
        mostrarMensagem('ctbIgnorarMensagem', 'Escolha a pendência na lista da tela.');
        return;
      }
      const situacao = el('ctbIgnorarSituacao');
      situacao.className = `${p.nivel === 'documental' ? 'badge-warning' : 'badge-neutral'} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
      situacao.textContent = NIVEIS[p.nivel] || p.nivel;
      preencherDados(el('ctbIgnorarDados'), [
        ['Pendência', p.titulo || '—'],
        ['Detalhe', p.descricao || '—'],
        ['Severidade', NIVEIS[p.nivel] || p.nivel],
        ['Competência', competencia.split('-').reverse().join('/')]
      ]);
      confirmarBtn.classList.toggle('hidden', !p.ignoravel);
      if (!p.ignoravel) mostrarMensagem('ctbIgnorarMensagem', 'Erro crítico não se ignora: resolva-o no Financeiro.');
    }

    async function confirmar() {
      if (!p?.ignoravel) return;
      mostrarMensagem('ctbIgnorarMensagem', '');
      const j = String(campo.value || '').trim();
      if (j.length < 10) { mostrarMensagem('ctbIgnorarMensagem', 'Escreva a justificativa (pelo menos 10 caracteres).'); campo.focus(); return; }
      processando = true;
      try {
        await fetchApi('/api/contabilidade/pendencias/ignorar', { method: 'POST', body: JSON.stringify({ competencia, chave: p.chave, justificativa: j }) });
        window.showToast?.('Pendência ignorada.', 'success');
        processando = false;
        fechar();
      } catch (e) {
        mostrarMensagem('ctbIgnorarMensagem', textoDoErro(e, 'Você não tem permissão para mexer nas pendências.'));
      } finally {
        processando = false;
      }
    }

    acionar(confirmarBtn, confirmar);
    pintar();
    return Promise.resolve();
  }

  const montadores = {
    ctbFechar: montarFechar,
    ctbReabrir: montarReabrir,
    ctbIgnorarPendencia: montarIgnorarPendencia
  };

  let montagem;
  try {
    montagem = Promise.resolve(montadores[overlayId]?.());
  } catch (erro) {
    montagem = Promise.reject(erro);
  }

  // Revela só depois da PRIMEIRA leitura: até lá fica o spinner da casa
  // (contabilidade.js, ctbSpinnerDoModal).
  const revelar = () => {
    overlay.classList.remove('hidden');
    overlay.removeAttribute('aria-hidden');
    window.Modal?.signalReady?.(overlayId);
  };
  montagem
    .catch(erro => console.error('[contabilidade] falha ao montar o modal', overlayId, erro))
    .finally(() => {
      if (typeof window.ContabilidadeModalPronto === 'function') window.ContabilidadeModalPronto(overlayId, revelar);
      else revelar();
    });
})();
