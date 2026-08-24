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

  function pintarConfiguracao(cfg) {
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
      set('origemModelo', p.modelo_do_env
        ? `Definido por ${p.variavelModelo} no .env`
        : `Padrão do aplicativo — defina ${p.variavelModelo} no .env para escolher outro`);

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

    const lim = cfg?.limites || {};
    const set = (id, valor) => {
      const el = document.getElementById(id);
      if (el) el.textContent = valor;
    };
    set('iaLimiteArquivoMb', lim.arquivo_mb ? `${lim.arquivo_mb} MB` : '—');
    set('iaLimiteArquivos', lim.arquivos ? `${lim.arquivos} por vez` : '—');
    set('iaLimiteTimeout', lim.timeout_s ? `${lim.timeout_s}s por chamada` : '—');
    set('iaLimiteTexto', lim.texto_max_chars
      ? `${Math.round(lim.texto_max_chars / 1000)} mil caracteres` : '—');

    const tag = document.getElementById('iaConfigProntoTag');
    if (cfg?.pronto) marcarEstado(tag, 'aviso', 'Chaves preenchidas — teste a conexão');
    else marcarEstado(tag, 'falta', 'Faltam credenciais no .env');
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

    // Sem innerHTML com dado do provedor: id de modelo é texto de fora.
    lista.replaceChildren(...modelos.map(m => {
      const linha = document.createElement('div');
      linha.className = 'ia-lista-modelos__item'
        + (m.id === modeloAtual ? ' ia-lista-modelos__item--atual' : '');

      const id = document.createElement('span');
      id.textContent = m.id;
      linha.appendChild(id);

      const ctx = document.createElement('span');
      ctx.className = 'ia-lista-modelos__ctx';
      ctx.textContent = m.id === modeloAtual
        ? 'em uso'
        : (m.entrada_max ? `${Math.round(m.entrada_max / 1000)}k de contexto` : '');
      linha.appendChild(ctx);

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
        mostrarMensagem(nome, 'aviso', r.aviso);
      } else {
        marcarEstado(campo(nome, 'estado'), 'ok', 'Conectado');
        mostrarMensagem(nome, 'info', null);
      }
      pintarModelos(nome, r.modelos, modeloAtual);
    }

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
