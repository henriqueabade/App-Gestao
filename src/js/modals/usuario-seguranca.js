/**
 * Segurança da API (09/10/2026) — Usuários, só o Sup Admin.
 *
 * Mostra o modo da permissão por tabela na API (observar: só anota; bloquear:
 * nega) e o registro do que foi negado ou seria negado: quem, que tabela, que
 * operação, de que tela do programa, quantas vezes. Serve para conferir,
 * antes de passar a API para o modo bloquear, que nenhuma tela usa uma
 * tabela que o mapa esqueceu. Dados: GET /api/usuarios/seguranca/registro.
 */
(async () => {
  const overlayId = 'segurancaApi';
  const overlay = document.getElementById('segurancaApiOverlay');
  if (!overlay) return;

  const el = id => document.getElementById(id);
  const criar = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  };

  async function fetchApi(caminho) {
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}${caminho}`);
    const corpo = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      const e = new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
      e.status = resposta.status;
      throw e;
    }
    return corpo;
  }

  const fechar = () => {
    document.removeEventListener('keydown', aoTeclar);
    Modal.close(overlayId);
  };
  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    if (document.querySelector('.app-message-overlay, dialog[data-dialog-padrao][open]')) return;
    fechar();
  }
  document.addEventListener('keydown', aoTeclar);
  el('segurancaApiFechar')?.addEventListener('click', fechar);

  const OPERACOES = { ler: 'Ler', inserir: 'Inserir', alterar: 'Alterar', apagar: 'Apagar' };
  let linhas = [];

  function aviso(texto, tom = 'erro') {
    const a = el('segurancaApiAviso');
    a.textContent = texto || '';
    a.style.color = tom === 'erro' ? 'var(--color-red)' : 'var(--color-green)';
    a.classList.toggle('hidden', !texto);
  }

  function pintarSituacao(situacao) {
    const modo = el('segurancaApiModo');
    modo.replaceChildren();
    const selo = (texto, classe, titulo) => {
      // O selo da tela de Usuários (as cores badge-* são da folha do módulo).
      const s = criar('span', `${classe} px-2 py-1 rounded-full text-xs font-medium`, texto);
      if (titulo) s.title = titulo;
      return s;
    };
    const explica = el('segurancaApiExplica');
    explica.replaceChildren();
    const p = texto => explica.appendChild(criar('p', null, texto));
    if (!situacao || situacao.modo === null) {
      modo.appendChild(selo('Sem a trava', 'badge-danger'));
      p(situacao?.erro || 'A API não respondeu.');
      return;
    }
    if (situacao.modo === 'dev') {
      modo.appendChild(selo('Banco local (DEV)', 'badge-secondary'));
      p('No banco local não há API no meio: a trava vale no programa ligado ao servidor.');
      return;
    }
    if (situacao.modo === 'bloquear') {
      modo.appendChild(selo('Modo bloquear', 'badge-success', 'A API nega o que a permissão da tela não deixa.'));
      p('A API NEGA a quem não tem a permissão da tela. O que aparece abaixo foi negado de verdade: se for de alguém que precisava, confira o perfil dele em Modelos de Permissão.');
    } else {
      modo.appendChild(selo('Modo observar', 'badge-warning', 'A API deixa passar e só anota.'));
      p('A API ainda DEIXA PASSAR tudo nas tabelas comuns e só anota o que negaria ("Seria negado"). Usuários, permissões, perfis e segredos já estão travados.');
      p('Use o programa normalmente por alguns dias. Se aparecer aqui alguém que precisava daquela tela, a permissão do perfil dele está faltando — ou o mapa esqueceu uma tabela (avise o suporte). Com a lista limpa, a API pode passar para o modo bloquear (PERMISSOES_MODO=bloquear no .env da API).');
    }
    if (!situacao.registro) modo.appendChild(selo('Registro desligado', 'badge-danger', 'Falta rodar sql/seguranca_registro_api.sql e reiniciar a API.'));
    if (situacao.jwtProprio === false) modo.appendChild(selo('JWT_SECRET padrão', 'badge-danger', 'A API está usando a chave dos tokens que vem no código: defina JWT_SECRET no .env.'));
    if (!situacao.registro) p('O registro não está gravando: rode sql/seguranca_registro_api.sql no banco e reinicie a API.');
  }

  function visiveis() {
    const decisao = el('segurancaApiDecisao').value;
    const busca = String(el('segurancaApiBusca').value || '').trim().toLowerCase();
    return linhas.filter(l => (!decisao || l.decisao === decisao)
      && (!busca || [l.usuario, l.tabela, l.rota, l.motivo].some(x => String(x || '').toLowerCase().includes(busca))));
  }

  function pintarLinhas() {
    const corpo = el('segurancaApiLinhas');
    corpo.replaceChildren();
    const lista = visiveis();
    el('segurancaApiTotal').textContent = linhas.length
      ? `${lista.length} de ${linhas.length} combinações (usuário, tabela, operação e tela) — repetições somam em "Vezes".`
      : '';
    if (!lista.length) {
      const tr = criar('tr');
      const td = criar('td', 'px-4 py-3 text-gray-400', linhas.length ? 'Nada com esse filtro.' : 'Nada registrado: nenhuma tela pediu o que a permissão não deixa.');
      td.colSpan = 7;
      tr.appendChild(td);
      corpo.appendChild(tr);
      return;
    }
    for (const l of lista) {
      const tr = criar('tr');
      const quando = l.ultimo_em ? new Date(l.ultimo_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
      const decisao = criar('td', 'px-4 py-3');
      const selo = criar('span', `${l.decisao === 'negado' ? 'badge-danger' : 'badge-warning'} px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap`, l.decisao === 'negado' ? 'Negado' : 'Seria negado');
      selo.title = l.motivo || '';
      decisao.appendChild(selo);
      const tela = criar('td', 'px-4 py-3', l.rota || '—');
      tela.title = l.permissoes_rota ? `A tela exigia: ${l.permissoes_rota}` : '';
      tr.append(
        criar('td', 'px-4 py-3 whitespace-nowrap', quando),
        criar('td', 'px-4 py-3', l.usuario),
        criar('td', 'px-4 py-3', l.tabela),
        criar('td', 'px-4 py-3', OPERACOES[l.operacao] || l.operacao),
        decisao,
        tela,
        criar('td', 'px-4 py-3 text-right', String(l.vezes))
      );
      corpo.appendChild(tr);
    }
  }

  async function carregar() {
    aviso('');
    try {
      const dados = await fetchApi('/api/usuarios/seguranca/registro');
      linhas = Array.isArray(dados?.linhas) ? dados.linhas : [];
      pintarSituacao(dados?.situacao);
      if (dados?.situacao?.erro && dados.situacao.modo !== null) aviso(dados.situacao.erro);
    } catch (e) {
      linhas = [];
      pintarSituacao(null);
      aviso(e.status === 403 ? 'Só o Sup Admin vê a segurança da API.' : e.message);
    }
    pintarLinhas();
  }

  el('segurancaApiDecisao').addEventListener('change', pintarLinhas);
  el('segurancaApiBusca').addEventListener('input', pintarLinhas);
  const atualizar = el('segurancaApiAtualizar');
  if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(atualizar, carregar);
  else atualizar.addEventListener('click', carregar);

  try {
    await carregar();
  } finally {
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: overlayId }));
  }
})();
