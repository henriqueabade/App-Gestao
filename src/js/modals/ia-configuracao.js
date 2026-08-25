(function () {
  const OVERLAY = 'iaConfiguracao';

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const close = () => Modal.close(OVERLAY);

  /** Libera o spinner e revela o modal. Chamado uma vez, dê certo ou errado. */
  const revelar = () =>
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: OVERLAY }));

  const cartao = nome => document.querySelector(`[data-provedor="${nome}"]`);
  const campo = (nome, chave) => cartao(nome)?.querySelector(`[data-campo="${chave}"]`) || null;

  function marcarEstado(el, tipo, texto) {
    if (!el) return;
    el.className = `ia-provedor__estado ia-provedor__estado--${tipo}`;
    el.textContent = texto;
  }

  /**
   * Mensagem do provedor. `textContent`, nunca innerHTML: o texto vem da
   * resposta de um serviço externo, e é ele quem menos merece confiança para
   * entrar no DOM como marcação.
   */
  function mostrarMensagem(nome, tipo, texto) {
    const el = campo(nome, 'mensagem');
    if (!el) return;
    if (!texto) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.classList.remove('hidden');
    el.textContent = texto;
    el.style.color = tipo === 'erro' ? 'var(--color-red)'
      : tipo === 'aviso' ? 'var(--color-primary-light)'
        : 'rgba(255,255,255,0.55)';
  }

  // -------------------------------------------------------------------------
  // Estado do .env (não sai para a internet)
  // -------------------------------------------------------------------------

  /** Só o Sup Admin muda; todo mundo com `ia.config` vê. */
  let podeEditar = false;

  /** Modelos que o teste de conexão trouxe, por provedor. */
  const modelosPorProvedor = {};

  /** O modelo escolhido em cada provedor, antes de salvar. */
  const escolhido = {};

  /** Quanto a última leitura gastou. Guardado para repintar com a lista. */
  let ultimoUso = null;

  function pintarConfiguracao(cfg) {
    podeEditar = Boolean(cfg?.pode_editar);

    // O botão de salvar não é escondido por `data-perm` porque a restrição não
    // é uma permissão que se possa conceder: é Sup Admin ou não é.
    document.getElementById('iaConfigSalvar')?.classList.toggle('hidden', !podeEditar);
    const aviso = document.getElementById('iaConfigRodapeAviso');
    if (aviso && !podeEditar) {
      aviso.textContent = 'Só o Sup Admin altera a configuração. Você vê o que está valendo.';
    }

    for (const nome of ['gemini', 'groq']) {
      const p = cfg?.[nome];
      if (!p) continue;

      const set = (chave, valor) => {
        const el = campo(nome, chave);
        if (el) el.textContent = valor;
      };

      set('papel', p.papel || '');
      set('variavelChave', p.variavelChave || '');
      set('chave', p.chave_mascarada || 'não preenchida');
      set('modelo', p.modelo || '—');

      // Diz de onde veio o modelo. Sem isso o usuário não distingue "eu
      // escolhi este" de "é o padrão porque não pus nada no .env" — e é
      // justamente o padrão que pode estar desatualizado.
      // De onde veio o valor que está valendo. É a primeira pergunta de quem
      // abre a tela e vê um modelo diferente do que esperava.
      const ORIGEM = {
        tela: 'Escolhido aqui na configuração',
        env: `Definido por ${p.variavelModelo} no .env`,
        padrao: 'Padrão do aplicativo — teste a conexão e escolha um da lista'
      };
      set('origemModelo', ORIGEM[p.modelo_origem] || ORIGEM.padrao);

      marcarEstado(
        campo(nome, 'estado'),
        p.configurado ? 'aviso' : 'falta',
        p.configurado ? 'Chave preenchida' : 'Chave faltando'
      );

      if (!p.configurado) {
        mostrarMensagem(nome, 'erro',
          `Preencha ${p.variavelChave} no arquivo .env e reinicie o aplicativo.`);
      }
    }

    pintarLimites(cfg);
    pintarConsumo(cfg);

    const tag = document.getElementById('iaConfigProntoTag');
    if (cfg?.pronto) marcarEstado(tag, 'aviso', 'Chaves preenchidas — teste a conexão');
    else marcarEstado(tag, 'falta', 'Faltam credenciais no .env');
  }

  /**
   * Os limites, como campos.
   *
   * Quem não pode editar vê os mesmos valores, em campos travados: esconder a
   * configuração de quem opera transforma "por que só entraram 10 arquivos?"
   * numa pergunta que só o administrador consegue responder.
   */
  function pintarLimites(cfg) {
    const lim = cfg?.limites || {};
    const regras = cfg?.campos || {};

    for (const campoEl of document.querySelectorAll('[data-config]')) {
      const chave = campoEl.getAttribute('data-config');
      const valor = lim[chave];
      campoEl.value = valor === null || valor === undefined ? '' : String(valor);
      campoEl.readOnly = !podeEditar;
      campoEl.disabled = !podeEditar;

      const regra = regras[chave];
      if (regra && regra.tipo === 'inteiro') {
        campoEl.min = regra.min;
        campoEl.max = regra.max;
        // O motivo do teto no `title`: um número sem explicação vira um número
        // que alguém muda sem saber o que está arriscando.
        campoEl.title = `Entre ${regra.min} e ${regra.max}. ${regra.porque || ''}`.trim();
      }

      // De onde vem o valor que está na caixa.
      const origem = (cfg?.origens || {})[chave];
      const rotulo = campoEl.parentElement?.querySelector('span');
      if (rotulo && origem === 'env') rotulo.dataset.origem = 'env';
      else if (rotulo) delete rotulo.dataset.origem;
    }
  }

  /**
   * Quanto de contexto a última leitura gastou.
   *
   * Contra o tamanho de contexto que a tela mostra ao lado de cada modelo,
   * este número responde "cabe neste modelo?" — que é a pergunta que decide
   * trocar de modelo ou dividir o documento.
   */
  function pintarConsumo(cfg) {
    const caixa = document.getElementById('iaConfigConsumo');
    if (!caixa) return;

    ultimoUso = cfg?.ultimo_uso || null;
    if (!ultimoUso) {
      caixa.textContent = 'Nenhuma leitura registrou consumo ainda. '
        + 'Depois da próxima, aparece aqui quanto ela gastou do contexto do modelo.';
      return;
    }

    const teto = tetoDoModelo(ultimoUso.modelo);
    const partes = [`Última leitura ("${ultimoUso.titulo}")`];

    // Usado E total, lado a lado. Só o total não responde nada: a pergunta é
    // "cabe?", e para respondê-la é preciso ver os dois números juntos.
    partes.push(teto
      ? `${milhares(ultimoUso.entrada)} de ${milhares(teto)} tokens de contexto `
        + `(${Math.round((ultimoUso.entrada / teto) * 100)}%)`
      : `${ultimoUso.entrada.toLocaleString('pt-BR')} tokens de entrada`);

    partes.push(`${ultimoUso.saida.toLocaleString('pt-BR')} de saída`);

    if (!teto) {
      // Sem a lista de modelos não há contra o que comparar, e dizer isso é
      // melhor do que mostrar um número solto que parece completo.
      partes.push('teste a conexão para ver quanto isso é do total do modelo');
    }

    caixa.textContent = partes.join('  ·  ');
  }

  /** "40.120" vira "40k"; abaixo de mil, o número inteiro. */
  const milhares = n => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

  /** Contexto do modelo, tirado da lista que o teste de conexão trouxe. */
  function tetoDoModelo(id) {
    for (const lista of Object.values(modelosPorProvedor)) {
      const achado = (lista || []).find(m => m.id === id);
      if (achado?.entrada_max) return Number(achado.entrada_max);
    }
    return 0;
  }

  // -------------------------------------------------------------------------
  // Teste de conexão (sai para a internet e consome cota)
  // -------------------------------------------------------------------------

  function pintarModelos(nome, modelos, modeloAtual) {
    const bloco = campo(nome, 'blocoModelos');
    const lista = campo(nome, 'modelos');
    const contagem = campo(nome, 'contagemModelos');
    if (!bloco || !lista) return;

    if (!modelos?.length) { bloco.classList.add('hidden'); return; }

    bloco.classList.remove('hidden');
    if (contagem) contagem.textContent = `(${modelos.length})`;

    modelosPorProvedor[nome] = modelos;

    // Sem innerHTML com dado do provedor: id de modelo é texto de fora.
    lista.replaceChildren(...modelos.map(m => {
      const atual = m.id === (escolhido[nome] || modeloAtual);
      const linha = document.createElement(podeEditar ? 'button' : 'div');
      if (podeEditar) linha.type = 'button';
      linha.className = 'ia-lista-modelos__item'
        + (atual ? ' ia-lista-modelos__item--atual' : '')
        + (podeEditar ? ' ia-lista-modelos__item--escolhivel' : '');

      const id = document.createElement('span');
      id.textContent = m.id;
      linha.appendChild(id);

      const ctx = document.createElement('span');
      ctx.className = 'ia-lista-modelos__ctx';
      // O contexto aparece SEMPRE, inclusive no que está em uso: é contra ele
      // que se compara o consumo da última leitura para decidir se o
      // documento cabe.
      // No modelo EM USO, o contexto aparece como usado/total: é ali que a
      // pergunta "cabe neste modelo?" se responde de relance. Nos outros, só o
      // total, porque não houve leitura com eles para comparar.
      const gastou = atual && ultimoUso && ultimoUso.modelo === m.id
        ? ultimoUso.entrada : null;

      ctx.textContent = [
        atual ? 'em uso' : null,
        m.entrada_max
          ? (gastou
            ? `${milhares(gastou)} / ${milhares(m.entrada_max)} de contexto`
            : `${milhares(m.entrada_max)} de contexto`)
          : null
      ].filter(Boolean).join('  ·  ');
      linha.appendChild(ctx);

      // Escolher pela lista, e não digitando: o nome de um modelo é uma
      // sequência que ninguém decora, e errar uma letra dá um 404 do provedor
      // na próxima leitura, não aqui.
      if (podeEditar) {
        linha.addEventListener('click', () => {
          escolhido[nome] = m.id;
          const campoModelo = campo(nome, 'modelo');
          if (campoModelo) campoModelo.textContent = m.id;
          const origem = campo(nome, 'origemModelo');
          if (origem) origem.textContent = 'Escolhido agora — clique em Salvar para valer';
          pintarModelos(nome, modelos, m.id);
        });
      }

      return linha;
    }));
  }

  async function testarConexao() {
    const tag = document.getElementById('iaConfigProntoTag');
    marcarEstado(tag, 'aviso', 'Testando…');

    let dados;
    try {
      const resp = await fetchApi('/api/ia/config/testar', { method: 'POST' });
      dados = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);
    } catch (err) {
      console.error('Falha ao testar os provedores de IA', err);
      marcarEstado(tag, 'falta', 'Falha no teste');
      showToast(err.message || 'Não foi possível testar a conexão', 'error');
      return;
    }

    for (const nome of ['gemini', 'groq']) {
      const r = dados?.[nome];
      if (!r) continue;
      const modeloAtual = campo(nome, 'modelo')?.textContent || '';

      if (!r.ok) {
        marcarEstado(campo(nome, 'estado'), 'falta', 'Não conectou');
        mostrarMensagem(nome, 'erro', r.motivo || 'Falha na conexão');
        pintarModelos(nome, [], modeloAtual);
        continue;
      }

      // Conectou, mas o modelo do .env pode não existir na conta. Isso é aviso,
      // não sucesso: sem o alerta, o erro só apareceria na primeira leitura de
      // verdade, depois de o usuário já ter enviado os arquivos.
      if (r.aviso) {
        marcarEstado(campo(nome, 'estado'), 'aviso', 'Modelo inválido');
        // Com a configuração no programa, o ajuste é aqui e não no .env.
        mostrarMensagem(nome, 'aviso',
          podeEditar ? `${r.aviso} Escolha um da lista abaixo e salve.` : r.aviso);
      } else {
        marcarEstado(campo(nome, 'estado'), 'ok', 'Conectado');
        mostrarMensagem(nome, 'info', null);
      }
      pintarModelos(nome, r.modelos, modeloAtual);
    }

    // Só agora existe o tamanho de contexto de cada modelo: até o teste de
    // conexão, o consumo da última leitura era um número sem denominador.
    pintarConsumo({ ultimo_uso: ultimoUso });

    const semAviso = dados?.gemini?.ok && dados?.groq?.ok
      && !dados.gemini.aviso && !dados.groq.aviso;
    if (semAviso) {
      marcarEstado(tag, 'ok', 'Tudo pronto');
      showToast('IA conectada nos dois provedores', 'success');
    } else if (dados?.pronto) {
      marcarEstado(tag, 'aviso', 'Conectado, com ressalvas');
      showToast('Conectou, mas há modelo a ajustar no .env', 'info');
    } else {
      marcarEstado(tag, 'falta', 'Não está pronto');
      showToast('Um dos provedores não respondeu — veja os detalhes', 'error');
    }
  }

  // -------------------------------------------------------------------------
  // Início
  // -------------------------------------------------------------------------

  document.getElementById('iaConfigFechar')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  /**
   * Grava o que foi mudado na tela.
   *
   * Manda TUDO, inclusive o que não mudou: o backend compara com o que está no
   * banco e só escreve o que for diferente, e mandar só o alterado exigiria a
   * tela guardar um "antes" que sairia de sincronia na primeira recarga.
   *
   * Campo em branco vira `null`, que é o sinal de apagar a linha e voltar ao
   * padrão — é a única forma de desfazer uma escolha sem adivinhar qual era o
   * valor anterior.
   */
  async function salvar() {
    const corpo = {};
    for (const campoEl of document.querySelectorAll('[data-config]')) {
      corpo[campoEl.getAttribute('data-config')] = campoEl.value.trim();
    }
    if (escolhido.gemini) corpo.gemini_modelo = escolhido.gemini;
    if (escolhido.groq) corpo.groq_modelo = escolhido.groq;

    try {
      const resp = await fetchApi('/api/ia/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo)
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);

      // Repinta com o que o servidor confirmou, e não com o que a tela mandou:
      // um valor recusado ou ajustado tem de aparecer como ficou.
      pintarConfiguracao(dados);
      for (const nome of ['gemini', 'groq']) {
        if (modelosPorProvedor[nome]) pintarModelos(nome, modelosPorProvedor[nome], dados[nome]?.modelo);
      }
      showToast('Configuração salva — vale a partir da próxima leitura', 'success');
    } catch (err) {
      console.error('Falha ao salvar a configuração da IA', err);
      showToast(err.message || 'Não foi possível salvar', 'error');
    }
  }

  const botaoSalvar = document.getElementById('iaConfigSalvar');
  if (botaoSalvar) {
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(botaoSalvar, salvar);
    else botaoSalvar.addEventListener('click', salvar);
  }

  // O teste sai para a internet e consome cota: trava o segundo clique e mostra
  // o carregando até terminar.
  const botaoTestar = document.getElementById('iaConfigTestar');
  if (botaoTestar) {
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(botaoTestar, testarConexao);
    else botaoTestar.addEventListener('click', testarConexao);
  }

  (async () => {
    try {
      const resp = await fetchApi('/api/ia/config/estado');
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);
      pintarConfiguracao(dados);
    } catch (err) {
      console.error('Falha ao ler a configuração da IA', err);
      marcarEstado(document.getElementById('iaConfigProntoTag'), 'falta', 'Não foi possível ler');
      showToast(err.message || 'Não foi possível ler a configuração da IA', 'error');
    } finally {
      // Sempre revela: um erro aqui não pode deixar o spinner girando para
      // sempre com a tela em branco por trás.
      revelar();
    }
  })();
})();
