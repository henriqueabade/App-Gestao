/**
 * Vincular ao Santíssimo Mail (14/10/2026) — a janela aberta pelo rodapé do
 * sino (centro de notificações). O usuário logado:
 *
 *   - gera o código de vinculação (10 caracteres, vale 10 minutos, uma vez),
 *     escolhendo o que o Mail pode fazer (escopos);
 *   - copia o código e vê o tempo correr; vencido, gera outro (só clicando);
 *   - vê os vínculos que já tem: a caixa, os escopos, as datas, a situação e,
 *     quando a API informar, se a caixa entra sozinha (reconhecimento
 *     automático);
 *   - encerra um vínculo, com confirmação.
 *
 * O CÓDIGO fica só no painel aberto, na memória: não vai para o sino, para o
 * banco, para a URL nem para log, e some ao fechar a janela, sair da tela ou ao vencer. Quem decide
 * tudo é a API central (contrato em Santissimo-db-API/docs/integracao-smail.md
 * §2), pelo programa: backend/smailVinculosController.js.
 *
 * As partes puras ficam em window.SmailVinculo (testes:
 * src/js/__tests__/smailVinculo.test.js). Regras: docs/vincular-santissimo-mail.md.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.SmailVinculo) return;

  // ================================================================ puras

  const ESCOPOS = [
    { valor: 'crm', rotulo: 'CRM', dica: 'Clientes, prospecções e contatos' },
    { valor: 'tarefas', rotulo: 'Tarefas', dica: 'Ver, criar e concluir tarefas' },
    { valor: 'calendario', rotulo: 'Calendário', dica: 'A agenda e os compromissos' },
    { valor: 'chat', rotulo: 'Chat', dica: 'As conversas do chat interno' },
    { valor: 'perfil', rotulo: 'Perfil', dica: 'Seu nome e o que seu perfil permite' }
  ];
  const ROTULO_DO_ESCOPO = Object.fromEntries(ESCOPOS.map(e => [e.valor, e.rotulo]));
  const PREFIXO = '/api/integracoes/smail/v1';

  const pad = n => String(n).padStart(2, '0');

  function escapar(texto) {
    return String(texto ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** O código para ler e ditar: "ABCDE FGHJK" (copiar leva sem o espaço). */
  function formatarCodigo(codigo) {
    const c = String(codigo || '').replace(/\s+/g, '').toUpperCase();
    return c.length > 5 ? `${c.slice(0, 5)} ${c.slice(5)}` : c;
  }

  /** Quanto falta para o código vencer: { segundos, texto "9:42", vencido, fracao (1 → 0) }. */
  function tempoRestante(expiraEm, agora = new Date(), totalSegundos = 600) {
    const fim = new Date(expiraEm || '').getTime();
    if (Number.isNaN(fim)) return { segundos: 0, texto: '0:00', vencido: true, fracao: 0 };
    const segundos = Math.max(0, Math.ceil((fim - agora.getTime()) / 1000));
    return {
      segundos,
      texto: `${Math.floor(segundos / 60)}:${pad(segundos % 60)}`,
      vencido: segundos <= 0,
      fracao: Math.max(0, Math.min(1, segundos / (Number(totalSegundos) || 600)))
    };
  }

  /** "2 min", "1 h e 5 min" — a espera do limite (Retry-After, em segundos). */
  function formatarEspera(segundos) {
    const s = Math.max(1, Math.ceil(Number(segundos) || 0));
    if (s < 60) return `${s} s`;
    const min = Math.ceil(s / 60);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const resto = min % 60;
    return resto ? `${h} h e ${resto} min` : `${h} h`;
  }

  /** A frase para a pessoa a partir do erro da integração ({error, message}). */
  function mensagemDoErro(status, dados = {}, retryAfter = null) {
    const codigo = dados && typeof dados === 'object' ? dados.error : null;
    if (!status) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    if (codigo === 'limite' || status === 429) {
      return `Muitos códigos em pouco tempo. Tente de novo ${retryAfter ? `em ${formatarEspera(retryAfter)}` : 'daqui a alguns minutos'}.`;
    }
    if (codigo === 'sem_rota') return 'O servidor ainda não tem a vinculação com o Santíssimo Mail.';
    if (codigo === 'indisponivel' || status === 503 || status === 502) {
      return dados?.message && codigo === 'indisponivel' && /DEV/.test(dados.message)
        ? dados.message
        : 'A integração com o Santíssimo Mail está desligada ou fora do ar no momento.';
    }
    if (codigo === 'nao_autenticado' || status === 401) return 'Sua sessão expirou. Entre de novo no programa.';
    if (codigo === 'sem_permissao' || status === 403) return 'Seu perfil não pode fazer isso.';
    if (codigo === 'nao_encontrado' || status === 404) return 'Este vínculo não existe mais (talvez já tenha sido encerrado).';
    if (codigo === 'invalido' || status === 400) return dados?.message || 'Dados inválidos.';
    return dados?.message || 'Não foi possível agora. Tente de novo.';
  }

  const dataCurta = valor => {
    const d = new Date(valor || '');
    return Number.isNaN(d.getTime()) ? '' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  /** "hoje às 14:30", "ontem às 09:10", "12/10/2026" — o último uso. */
  function quandoFoi(valor, agora = new Date()) {
    const d = new Date(valor || '');
    if (Number.isNaN(d.getTime())) return '';
    const dia = x => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    const ontem = new Date(agora);
    ontem.setDate(ontem.getDate() - 1);
    const hora = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (dia(d) === dia(agora)) return `hoje às ${hora}`;
    if (dia(d) === dia(ontem)) return `ontem às ${hora}`;
    return dataCurta(d);
  }

  /**
   * A situação do vínculo para a lista: ativo, encerrado (revogado) ou
   * vencido (passou da validade). A API já diz "revogado" para os dois.
   */
  function situacaoDoVinculo(item, agora = new Date()) {
    const vence = new Date(item?.expiraEm || '').getTime();
    if (item?.revogadoEm) return { valor: 'encerrado', rotulo: 'Encerrado' };
    if (!Number.isNaN(vence) && vence <= agora.getTime()) return { valor: 'vencido', rotulo: 'Vencido' };
    if (item?.status === 'ativo') return { valor: 'ativo', rotulo: 'Ativo' };
    return { valor: 'encerrado', rotulo: 'Encerrado' };
  }

  /**
   * O reconhecimento automático da caixa (vinculação sem código): true /
   * false quando a API informa (`reconhecimento_automatico`, só com a função
   * ligada lá), null quando não informa — aí a tela não diz nada.
   */
  function reconhecimentoAutomatico(item) {
    const v = item?.reconhecimento_automatico ?? item?.reconhecimentoAutomatico;
    return typeof v === 'boolean' ? v : null;
  }

  /** Ativos primeiro; dentro, o mais novo primeiro. */
  function ordenarVinculos(itens, agora = new Date()) {
    return [...(itens || [])].sort((a, b) =>
      (situacaoDoVinculo(a, agora).valor === 'ativo' ? 0 : 1) - (situacaoDoVinculo(b, agora).valor === 'ativo' ? 0 : 1) ||
      new Date(b?.criadoEm || 0).getTime() - new Date(a?.criadoEm || 0).getTime());
  }

  const Puro = {
    ESCOPOS, PREFIXO, escapar, formatarCodigo, tempoRestante, formatarEspera, mensagemDoErro,
    dataCurta, quandoFoi, situacaoDoVinculo, reconhecimentoAutomatico, ordenarVinculos
  };

  if (typeof document === 'undefined') {
    window.SmailVinculo = Puro;
    return;
  }

  // Modal e card usam o mesmo componente, com código e timers por superfície.
  const paineis = new Set();
  const paineisEmbutidos = new WeakMap();
  let dialogo = null;
  let painelDoDialogo = null;
  let observador = null;
  let geracaoEmCurso = false;
  let versaoVinculos = 0;

  function criarPainel(raiz, { aoFechar } = {}) {
    // ================================================================ estado

    const estado = {
      // O código vive só aqui e na superfície montada, até fechar ou sair.
      codigo: null,
      expiraEm: null,
      validade: 600,
      escoposDoCodigo: [],
      escolhidos: new Set(ESCOPOS.map(e => e.valor)),
      gerando: false,
      erroDoCodigo: null,
      vinculos: [],
      carregando: false,
      erroDosVinculos: null,
      encerrando: null,
      copiado: false
    };
    let dialogo = raiz;
    let temporizadorCopiado = null;
    let relogio = null;

    const $ = seletor => dialogo?.querySelector(seletor) || null;
    const toast = (texto, tipo = 'error') => {
      if (typeof window.showToast === 'function') window.showToast(texto, tipo);
    };

    async function chamar(caminho, { method = 'GET', body, auditoria } = {}) {
      const aud = auditoria || window.AuditoriaAcao?.vincular();
      let base = null;
      try {
        base = await window.apiConfig?.getApiBaseUrl?.();
      } catch (_) {
        base = null;
      }
      if (!base) return { ok: false, status: 0, dados: null, espera: null };
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      let resposta;
      try {
        resposta = await (aud?.fetch || fetch)(new URL(`${PREFIXO}${caminho}`, base).toString(), {
          method, headers, credentials: 'include', cache: 'no-store',
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
      } catch (_) {
        return { ok: false, status: 0, dados: null, espera: null };
      }
      let dados = null;
      if (resposta.status !== 204) {
        try { dados = await resposta.json(); } catch (_) { dados = null; }
      }
      return { ok: resposta.ok, status: resposta.status, dados, espera: Number(resposta.headers.get('retry-after')) || null };
    }

    // ================================================================ código

    async function gerarCodigo() {
      if (estado.gerando || geracaoEmCurso) return;
      if (!estado.escolhidos.size) {
        estado.erroDoCodigo = 'Escolha ao menos uma coisa que o Mail pode fazer.';
        return pintarCodigo();
      }
      estado.gerando = true;
      geracaoEmCurso = true;
      estado.erroDoCodigo = null;
      pintarCodigo();
      const escopos = ESCOPOS.map(e => e.valor).filter(v => estado.escolhidos.has(v));
      const r = await chamar('/vinculos/codigos', { method: 'POST', body: { escopos } });
      estado.gerando = false;
      geracaoEmCurso = false;
      if (r.ok && r.dados?.codigo) {
        // Mesmo fechando durante o POST, o código anterior deixa de valer na API.
        paineis.forEach(painel => { if (painel !== controle) painel.invalidarCodigo(); });
      }
      if (!dialogo) return; // fechou enquanto gerava: a resposta é descartada
      if (r.ok && r.dados?.codigo) {
        estado.codigo = String(r.dados.codigo);
        estado.expiraEm = r.dados.expira_em;
        estado.validade = Number(r.dados.validade_segundos) || 600;
        estado.escoposDoCodigo = Array.isArray(r.dados.escopos) ? r.dados.escopos : escopos;
        estado.copiado = false;
        ligarRelogio();
      } else {
        esquecerCodigo();
        estado.erroDoCodigo = mensagemDoErro(r.status, r.dados, r.espera);
      }
      pintarCodigo();
    }

    /** Tira o código da memória e da tela (venceu, fechou, gerou outro). */
    function esquecerCodigo() {
      estado.codigo = null;
      estado.expiraEm = null;
      estado.escoposDoCodigo = [];
      estado.copiado = false;
      desligarRelogio();
    }

    function ligarRelogio() {
      desligarRelogio();
      relogio = setInterval(() => {
        const t = tempoRestante(estado.expiraEm, new Date(), estado.validade);
        if (t.vencido) {
          esquecerCodigo();
          estado.erroDoCodigo = null;
          pintarCodigo({ venceu: true });
          // Venceu: o vínculo pode ter sido feito com ele no meio-tempo.
          carregarVinculos();
          return;
        }
        const texto = $('[data-sv="tempo"]');
        if (texto) texto.textContent = t.texto;
        const barra = $('[data-sv="barra"]');
        if (barra) barra.style.width = `${Math.round(t.fracao * 100)}%`;
        const caixa = $('[data-sv="codigo-caixa"]');
        if (caixa) caixa.classList.toggle('sv-codigo--acabando', t.segundos <= 60);
      }, 1000);
    }

    function desligarRelogio() {
      if (relogio) clearInterval(relogio);
      relogio = null;
    }

    async function copiarCodigo() {
      if (!estado.codigo) return;
      const codigo = estado.codigo;
      let copiou = false;
      try {
        await navigator.clipboard.writeText(codigo);
        copiou = true;
      } catch (_) {
        if (!dialogo || estado.codigo !== codigo) return;
        // Sem a área de transferência do navegador: o jeito antigo.
        const campo = document.createElement('textarea');
        campo.value = codigo;
        campo.setAttribute('readonly', '');
        campo.style.position = 'fixed';
        campo.style.opacity = '0';
        dialogo.appendChild(campo);
        campo.select();
        try { copiou = document.execCommand('copy'); } catch (__) { copiou = false; }
        campo.remove();
      }
      if (!dialogo || estado.codigo !== codigo) return;
      if (!copiou) return toast('Não foi possível copiar. Selecione o código e copie com Ctrl+C.');
      estado.copiado = true;
      const botao = $('[data-sv-acao="copiar"]');
      if (botao) botao.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> Copiado';
      clearTimeout(temporizadorCopiado);
      temporizadorCopiado = setTimeout(() => {
        estado.copiado = false;
        const b = $('[data-sv-acao="copiar"]');
        if (b) b.innerHTML = '<i class="fas fa-copy" aria-hidden="true"></i> Copiar';
      }, 2000);
    }

    // ================================================================ vínculos

    async function carregarVinculos() {
      estado.carregando = true;
      estado.erroDosVinculos = null;
      pintarVinculos();
      const versao = ++versaoVinculos;
      const r = await chamar('/meus-vinculos');
      estado.carregando = false;
      if (versao !== versaoVinculos) return;
      if (r.ok) {
        const itens = Array.isArray(r.dados?.itens) ? r.dados.itens : [];
        paineis.forEach(painel => painel.receberVinculos(itens));
      }
      else {
        const mensagem = mensagemDoErro(r.status, r.dados, r.espera);
        paineis.forEach(painel => painel.receberErroVinculos(mensagem));
      }
      pintarVinculos();
    }

    async function encerrarVinculo(id) {
      const item = estado.vinculos.find(v => String(v.id) === String(id));
      if (!item || estado.encerrando) return;
      const auditoria = window.AuditoriaAcao?.vincular();
      const automatico = reconhecimentoAutomatico(item) === true;
      const ok = await window.DialogPadrao?.confirm?.({
        title: 'Encerrar o vínculo com o Santíssimo Mail',
        tom: 'erro',
        icone: 'fa-unlink',
        resumo: [{ rotulo: 'Caixa', valor: item.caixa || '—' }],
        message: `A caixa deixa de acessar o App-Gestão pelo Santíssimo Mail na hora.${automatico ? ' O reconhecimento automático dela também é desligado.' : ''}`,
        nota: 'Para voltar, gere um novo código aqui e digite no Santíssimo Mail.',
        confirmText: 'Encerrar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger'
      });
      if (!ok || !dialogo) return;
      estado.encerrando = String(id);
      ++versaoVinculos; // respostas iniciadas antes da revogação ficam obsoletas
      pintarVinculos();
      const r = await chamar(`/meus-vinculos/${encodeURIComponent(id)}`, { method: 'DELETE', auditoria });
      if (!dialogo) {
        // A API pode concluir depois de fechar a janela. O card acompanha.
        await paineis.values().next().value?.atualizar();
        return;
      }
      estado.encerrando = null;
      if (r.ok || r.status === 204) toast('Vínculo encerrado.', 'success');
      else toast(mensagemDoErro(r.status, r.dados, r.espera));
      await carregarVinculos();
    }

    // ================================================================ pintar

    function htmlDoCodigo({ venceu = false } = {}) {
      if (estado.codigo) {
        const t = tempoRestante(estado.expiraEm, new Date(), estado.validade);
        const escopos = estado.escoposDoCodigo.map(e => `<span class="sv-chip">${escapar(ROTULO_DO_ESCOPO[e] || e)}</span>`).join('');
        return `
          <div class="sv-codigo${t.segundos <= 60 ? ' sv-codigo--acabando' : ''}" data-sv="codigo-caixa">
            <span class="ctl-rotulo">Digite este código no Santíssimo Mail</span>
            <output class="sv-codigo-texto" data-sv="codigo" aria-label="Código de vinculação">${escapar(formatarCodigo(estado.codigo))}</output>
            <div class="sv-tempo">
              <span><i class="fas fa-hourglass-half" aria-hidden="true"></i> Vale por mais <strong data-sv="tempo">${t.texto}</strong> e só uma vez</span>
              <span class="sv-barra"><i data-sv="barra" style="width:${Math.round(t.fracao * 100)}%"></i></span>
            </div>
            <div class="sv-chips" aria-label="O que o Mail poderá fazer">${escopos}</div>
            <div class="sv-acoes">
              <button type="button" class="ctl-botao btn-secondary" data-sv-acao="copiar"><i class="fas fa-copy" aria-hidden="true"></i> Copiar</button>
              <button type="button" class="ctl-botao btn-neutral" data-sv-acao="gerar"><i class="fas fa-redo" aria-hidden="true"></i> Gerar outro</button>
            </div>
            <p class="sv-apoio">Gerar outro faz este deixar de valer.</p>
          </div>`;
      }
      const caixas = ESCOPOS.map(e => `
        <label class="sv-escopo">
          <input type="checkbox" data-sv-escopo="${e.valor}"${estado.escolhidos.has(e.valor) ? ' checked' : ''}>
          <span><strong>${e.rotulo}</strong><small>${escapar(e.dica)}</small></span>
        </label>`).join('');
      return `
        ${venceu ? '<div class="sv-aviso sv-aviso--atencao"><i class="fas fa-clock" aria-hidden="true"></i> O código venceu. Gere outro quando for digitar no Mail.</div>' : ''}
        <p class="sv-apoio">Escolha o que o Santíssimo Mail poderá fazer com a sua conta. Ele só faz o que o seu perfil já permite aqui.</p>
        <div class="sv-escopos">${caixas}</div>
        ${estado.erroDoCodigo ? `<div class="sv-aviso sv-aviso--erro" role="alert"><i class="fas fa-exclamation-circle" aria-hidden="true"></i> ${escapar(estado.erroDoCodigo)}</div>` : ''}
        <div class="sv-acoes">
          <button type="button" class="ctl-botao btn-primary" data-sv-acao="gerar"${estado.gerando ? ' disabled' : ''}>
            ${estado.gerando ? '<span class="sv-spinner"></span> Gerando…' : `<i class="fas fa-key" aria-hidden="true"></i> ${venceu ? 'Gerar novo código' : 'Gerar código'}`}
          </button>
        </div>`;
    }

    function pintarCodigo(opcoes) {
      const area = $('[data-sv="area-codigo"]');
      if (area) area.innerHTML = htmlDoCodigo(opcoes);
    }

    function htmlDoVinculo(item) {
      const agora = new Date();
      const s = situacaoDoVinculo(item, agora);
      const auto = reconhecimentoAutomatico(item);
      const escopos = (item.escopos || []).map(e => `<span class="sv-chip">${escapar(ROTULO_DO_ESCOPO[e] || e)}</span>`).join('');
      const datas = [
        item.criadoEm ? `Vinculado em ${escapar(dataCurta(item.criadoEm))}` : '',
        item.ultimoUsoEm ? `último uso ${escapar(quandoFoi(item.ultimoUsoEm, agora))}` : 'ainda não usado',
        s.valor === 'ativo' && item.expiraEm ? `vale até ${escapar(dataCurta(item.expiraEm))}` : '',
        item.revogadoEm ? `encerrado em ${escapar(dataCurta(item.revogadoEm))}` : ''
      ].filter(Boolean).join(' · ');
      const reconhecimento = auto === true
        ? '<span class="sv-chip sv-chip--auto" title="O Mail reconhece esta caixa sozinho, sem pedir código"><i class="fas fa-bolt" aria-hidden="true"></i> Entra sozinho pelo Mail</span>'
        : auto === false ? '<span class="sv-chip sv-chip--neutro" title="Para entrar de novo, o Mail pede um código">Só com código</span>' : '';
      const encerrando = estado.encerrando === String(item.id);
      return `
        <li class="sv-vinculo sv-vinculo--${s.valor}">
          <span class="sv-vinculo-icone"><i class="fas fa-envelope" aria-hidden="true"></i></span>
          <div class="sv-vinculo-textos">
            <div class="sv-vinculo-linha">
              <strong title="${escapar(item.caixa || '')}">${escapar(item.caixa || 'Caixa não informada')}</strong>
              <span class="sv-situacao sv-situacao--${s.valor}">${s.rotulo}</span>
            </div>
            <div class="sv-chips">${escopos}${reconhecimento}</div>
            <small>${datas}</small>
          </div>
          ${s.valor === 'ativo' ? `<button type="button" class="ctl-botao ctl-botao--pequeno btn-danger" data-sv-acao="encerrar" data-id="${escapar(item.id)}"${encerrando ? ' disabled' : ''}>${encerrando ? '<span class="sv-spinner"></span>' : '<i class="fas fa-unlink" aria-hidden="true"></i>'} Encerrar</button>` : ''}
        </li>`;
    }

    function pintarVinculos() {
      const area = $('[data-sv="area-vinculos"]');
      if (!area) return;
      if (estado.carregando && !estado.vinculos.length) {
        area.innerHTML = '<p class="sv-apoio"><span class="sv-spinner"></span> Carregando seus vínculos…</p>';
        return;
      }
      if (estado.erroDosVinculos) {
        area.innerHTML = `<div class="sv-aviso sv-aviso--erro" role="alert"><i class="fas fa-exclamation-circle" aria-hidden="true"></i> ${escapar(estado.erroDosVinculos)}</div>`;
        return;
      }
      const lista = ordenarVinculos(estado.vinculos);
      if (!lista.length) {
        area.innerHTML = '<p class="sv-apoio">Nenhuma caixa vinculada ainda. Gere um código acima e digite no Santíssimo Mail.</p>';
        return;
      }
      const ativos = lista.filter(v => situacaoDoVinculo(v).valor === 'ativo').length;
      area.innerHTML = `
        <p class="sv-apoio">${ativos ? `${ativos} ${ativos > 1 ? 'caixas vinculadas' : 'caixa vinculada'} agora.` : 'Nenhum vínculo ativo agora.'}</p>
        <ul class="sv-vinculos">${lista.map(htmlDoVinculo).join('')}</ul>`;
    }


    function aoClicar(e) {
      const alvo = e.target.closest('[data-sv-acao]');
      if (!alvo || !dialogo?.contains(alvo)) return;
      const acao = alvo.dataset.svAcao;
      if (acao === 'fechar') return aoFechar?.();
      if (acao === 'gerar') {
        if (geracaoEmCurso) return;
        esquecerCodigo();
        return gerarCodigo();
      }
      if (acao === 'copiar') return copiarCodigo();
      if (acao === 'atualizar') return carregarVinculos();
      if (acao === 'encerrar') return encerrarVinculo(alvo.dataset.id);
      return undefined;
    }

    function aoAlterar(e) {
      const valor = e.target?.dataset?.svEscopo;
      if (!valor) return;
      if (e.target.checked) estado.escolhidos.add(valor);
      else estado.escolhidos.delete(valor);
      if (estado.erroDoCodigo && estado.escolhidos.size) {
        estado.erroDoCodigo = null;
        pintarCodigo();
      }
    }

    /** Desmontar a janela ou sair de Configurações apaga o código e os timers. */
    function fechar() {
      esquecerCodigo();
      clearTimeout(temporizadorCopiado);
      estado.erroDoCodigo = null;
      estado.vinculos = [];
      estado.encerrando = null;
      if (!dialogo) return;
      dialogo.querySelector('[data-sv="codigo"]')?.replaceChildren();
      dialogo.removeEventListener('click', aoClicar);
      dialogo.removeEventListener('change', aoAlterar);
      paineis.delete(controle);
      paineisEmbutidos.delete(raiz);
      dialogo = null;
      if (!paineis.size) {
        observador?.disconnect();
        observador = null;
      }
    }

    const controle = {
      raiz,
      destruir: fechar,
      atualizar: carregarVinculos,
      invalidarCodigo() {
        if (!estado.codigo) return;
        esquecerCodigo();
        estado.erroDoCodigo = null;
        pintarCodigo();
      },
      receberVinculos(itens) {
        estado.vinculos = itens;
        estado.carregando = false;
        estado.erroDosVinculos = null;
        pintarVinculos();
      },
      receberErroVinculos(mensagem) {
        estado.carregando = false;
        estado.erroDosVinculos = mensagem;
        pintarVinculos();
      },
      estadoSeguro: () => ({ ...estado, codigo: estado.codigo ? '(na tela)' : null })
    };
    dialogo.addEventListener('click', aoClicar);
    dialogo.addEventListener('change', aoAlterar);
    paineis.add(controle);
    observarDesmontagem();
    pintarCodigo();
    pintarVinculos();
    controle.pronto = carregarVinculos();
    return controle;
  }

  /** Uma única estrutura para Configurações e para a janela do sino. */
  function htmlDoConteudo() {
    return `
      <div class="sv-corpo">
        <section class="sv-secao">
          <h3 class="ctl-secao">Novo vínculo</h3>
          <div data-sv="area-codigo"></div>
        </section>
        <section class="sv-secao">
          <div class="sv-secao-topo">
            <h3 class="ctl-secao">Meus vínculos</h3>
            <button type="button" class="sv-link" data-sv-acao="atualizar"><i class="fas fa-sync-alt" aria-hidden="true"></i> Atualizar</button>
          </div>
          <div data-sv="area-vinculos" aria-live="polite"></div>
        </section>
        <p class="sv-seguranca"><i class="fas fa-shield-alt" aria-hidden="true"></i> O Santíssimo Mail nunca recebe a sua senha do App-Gestão. O código vale 10 minutos, uma vez só, e não fica guardado.</p>
      </div>`;
  }

  function observarDesmontagem() {
    if (observador || typeof MutationObserver !== 'function') return;
    observador = new MutationObserver(() => {
      paineis.forEach(painel => {
        if (!painel.raiz.isConnected) painel.destruir();
      });
    });
    observador.observe(document.body, { childList: true, subtree: true });
  }

  /** Embute as mesmas funções no card, sem abrir uma janela. */
  function montarEm(elemento) {
    if (!elemento) return null;
    const anterior = paineisEmbutidos.get(elemento);
    if (anterior) return anterior;
    elemento.classList.add('sv-painel');
    elemento.innerHTML = htmlDoConteudo();
    const painel = criarPainel(elemento);
    paineisEmbutidos.set(elemento, painel);
    return painel;
  }

  /** Abre a janela (o rodapé do sino, o aviso de segurança do sino). */
  function abrir() {
    if (dialogo) {
      dialogo.focus?.();
      return;
    }
    dialogo = document.createElement('dialog');
    dialogo.className = 'sv-dialogo ctl-padrao';
    dialogo.setAttribute('data-smail-vinculo', '');
    dialogo.setAttribute('aria-labelledby', 'svTitulo');
    dialogo.innerHTML = `
      <div class="sv-cartao sv-painel">
        <header class="sv-topo">
          <span class="sv-topo-icone"><i class="fas fa-envelope-open-text" aria-hidden="true"></i></span>
          <div>
            <h2 id="svTitulo" class="ctl-modal-titulo">Santíssimo Mail</h2>
            <p class="sv-apoio">Ligue a sua caixa de e-mail ao App-Gestão: clientes, tarefas, agenda e chat dentro do Mail.</p>
          </div>
        </header>
        ${htmlDoConteudo()}
        <footer class="sv-rodape">
          <button type="button" class="ctl-botao btn-danger" data-sv-acao="fechar">Fechar</button>
        </footer>
      </div>`;
    dialogo.addEventListener('cancel', e => {
      e.preventDefault();
      fechar();
    });
    document.body.appendChild(dialogo);
    painelDoDialogo = criarPainel(dialogo, { aoFechar: fechar });
    if (typeof dialogo.showModal === 'function') dialogo.showModal();
    else dialogo.setAttribute('open', '');
  }

  /** Fecha e esquece o código da janela (o card mantém seu próprio estado). */
  function fechar() {
    painelDoDialogo?.destruir();
    painelDoDialogo = null;
    if (!dialogo) return;
    const d = dialogo;
    dialogo = null;
    try { d.close(); } catch (_) { /* já fechado */ }
    d.remove();
  }

  window.addEventListener('pagehide', () => {
    fechar();
    paineis.forEach(painel => painel.destruir());
  });

  window.SmailVinculo = {
    ...Puro,
    abrir,
    fechar,
    montarEm,
    estaAberta: () => Boolean(dialogo),
    /** Para conferência (testes da tela). Sem o código. */
    get _estado() { return painelDoDialogo?.estadoSeguro() || null; }
  };
})();
