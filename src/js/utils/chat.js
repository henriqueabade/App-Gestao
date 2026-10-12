/**
 * Chat interno (12/10/2026) — o botão redondo no canto inferior direito e o
 * painel de conversas, no molde do chat do ClickUp, com a cara da Santíssimo.
 *
 *   - conversas diretas, grupos e canais, ao vivo (Server-Sent Events em
 *     /api/chat/eventos; caiu a conexão, pergunta de 20 em 20 s até voltar);
 *   - a presença de cada pessoa — Online, Ausente, Ocupado, Offline (com
 *     "visto há…") — e o status que cada um escolhe (Disponível, Ocupado,
 *     Ausente, Invisível), com recado;
 *   - @ menciona quem está na conversa (aviso no sino, mesmo silenciada);
 *   - # cita tarefa, cliente, prospecção, contato, pedido, orçamento ou
 *     produto — só o que o PERFIL de quem escreve vê; quem lê vê o nome só se
 *     o perfil dele deixar (backend/chatReferencias.js). Clicar abre a ficha;
 *   - responder, reagir, editar (fica "editada") e apagar a própria
 *     mensagem; "Visto" na conversa direta; "digitando…".
 *
 * O texto vai para o servidor com marcas: [[@5]] (menção) e [[#cliente:12]]
 * (citação). Na caixa de escrever aparecem "@Ana Lima" e "#Loja X"; a troca
 * acontece ao enviar (paraMarcas) e ao editar (deMarcas).
 *
 * As partes puras ficam em window.ChatInterno (testes em
 * src/js/__tests__/chatInterno.test.js). Regras: docs/chat-interno.md.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.ChatInterno) return;

  // ================================================================ puras

  const TIPOS_REF = ['tarefa', 'cliente', 'prospeccao', 'contato', 'pedido', 'orcamento', 'produto'];
  const ROTULO_REF = { tarefa: 'Tarefa', cliente: 'Cliente', prospeccao: 'Prospecção', contato: 'Contato', pedido: 'Pedido', orcamento: 'Orçamento', produto: 'Produto' };
  const ICONE_REF = { tarefa: 'fa-tasks', cliente: 'fa-user-friends', prospeccao: 'fa-user-plus', contato: 'fa-address-book', pedido: 'fa-shopping-cart', orcamento: 'fa-file-invoice-dollar', produto: 'fa-cube' };
  const FEMININOS = new Set(['tarefa', 'prospeccao']);
  const PAGINA_REF = { cliente: 'clientes', prospeccao: 'prospeccoes', contato: 'contatos', pedido: 'pedidos', orcamento: 'orcamentos', produto: 'produtos', tarefa: 'tarefas' };
  const RE_MENCAO = /\[\[@(\d{1,9})\]\]/g;
  const RE_REF = new RegExp(`\\[\\[#(${TIPOS_REF.join('|')}):(\\d{1,12})\\]\\]`, 'g');
  // Sem colchetes no link: senão "http://x.com[[@5]]" engoliria a menção.
  const RE_LINK = /\bhttps?:\/\/[^\s<>"'[\]]+/gi;

  /** Os quatro estados que os outros veem (chat/presenca.js na API). */
  const PRESENCA = {
    online: { rotulo: 'Online' },
    ausente: { rotulo: 'Ausente' },
    ocupado: { rotulo: 'Ocupado' },
    offline: { rotulo: 'Offline' }
  };
  const ORDEM_PRESENCA = { online: 0, ocupado: 1, ausente: 2, offline: 3 };
  /** O que cada um escolhe para si (chat_status). */
  const MEU_STATUS = [
    { valor: 'automatico', rotulo: 'Disponível', estado: 'online', dica: 'Online enquanto você usa o programa; Ausente depois de 5 minutos parado.' },
    { valor: 'ocupado', rotulo: 'Ocupado', estado: 'ocupado', dica: 'Não perturbe: as mensagens chegam sem som e sem aviso. Menções continuam no sino.' },
    { valor: 'ausente', rotulo: 'Ausente', estado: 'ausente', dica: 'Aparece como ausente mesmo usando o programa.' },
    { valor: 'invisivel', rotulo: 'Invisível', estado: 'offline', dica: 'Aparece como offline para todos; você continua lendo e conversando.' }
  ];
  const EMOJIS = ['😀', '😂', '😊', '😍', '😉', '🤔', '😅', '😢', '😮', '😡', '👍', '👎', '👏', '🙏', '💪', '👀', '✅', '❌', '⚠️', '🔥', '🎉', '❤️', '💯', '🚀'];
  const CORES_AVATAR = ['#6a152c', '#7f6a27', '#1e3a8a', '#065f46', '#7c2d12', '#581c87', '#0f766e', '#9f1239'];
  const CINCO_MIN = 5 * 60 * 1000;

  const pad = n => String(n).padStart(2, '0');

  function escapar(texto) {
    return String(texto ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Sem acento e em minúsculas, para buscar. */
  const comparavel = texto => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const chaveRef = (tipo, id) => `${tipo}:${id}`;

  function iniciais(nome) {
    const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    const primeira = partes[0][0];
    const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
    return (primeira + ultima).toUpperCase();
  }

  /** Cada pessoa com a sua cor (o avatar sem foto). */
  const corDoAvatar = id => CORES_AVATAR[Math.abs(Number(id) || 0) % CORES_AVATAR.length];

  /**
   * Como uma citação aparece para quem lê: o nome (com a permissão de quem
   * lê), "sem acesso", "não encontrado" ou carregando.
   */
  function rotuloDaRef(tipo, item) {
    const nomeTipo = ROTULO_REF[tipo] || tipo;
    if (!item) return { estado: 'carregando', texto: nomeTipo, titulo: `${nomeTipo} — carregando…` };
    if (item.sem_acesso) return { estado: 'sem-acesso', texto: `${nomeTipo} (sem acesso)`, titulo: 'Seu perfil não dá acesso a este registro.' };
    if (item.nao_encontrado) return { estado: 'sumiu', texto: `${nomeTipo} não ${FEMININOS.has(tipo) ? 'encontrada' : 'encontrado'}`, titulo: 'Este registro não existe mais.' };
    const titulo = [`${nomeTipo}: ${item.rotulo}`, item.detalhe].filter(Boolean).join(' · ');
    return { estado: 'ok', texto: item.rotulo, titulo: `${titulo} — clique para abrir` };
  }

  /**
   * O texto da mensagem em HTML: escapado, com links, menções e citações.
   * `nomes`: Map id → nome; `refs`: Map 'tipo:id' → item resolvido.
   */
  function textoParaHtml(texto, { nomes = new Map(), euId = null, refs = new Map() } = {}) {
    let html = escapar(texto);
    html = html.replace(RE_LINK, bruto => {
      const [, link, sobra] = bruto.match(/^(.*?)([.,;:!?)]*)$/);
      const real = link.replace(/&amp;/g, '&');
      return `<a href="#" class="chat-link" data-acao="link" data-url="${escapar(real)}" title="Abrir no navegador">${link}</a>${sobra}`;
    });
    html = html.replace(RE_MENCAO, (_, id) => {
      const eu = euId != null && String(id) === String(euId);
      return `<span class="chat-mencao${eu ? ' chat-mencao--eu' : ''}" data-usuario="${id}">@${escapar(nomes.get(String(id)) || 'alguém')}</span>`;
    });
    html = html.replace(RE_REF, (_, tipo, id) => {
      const r = rotuloDaRef(tipo, refs.get(chaveRef(tipo, id)));
      const icone = r.estado === 'sem-acesso' ? 'fa-lock' : ICONE_REF[tipo];
      return `<button type="button" class="chat-ref chat-ref--${r.estado}" data-acao="ref" data-ref-tipo="${tipo}" data-ref-id="${id}" title="${escapar(r.titulo)}"><i class="fas ${icone}" aria-hidden="true"></i><span>${escapar(r.texto)}</span></button>`;
    });
    return html.replace(/\n/g, '<br>');
  }

  /** O texto numa linha só (prévia da lista, aviso): "@Ana", "#Loja X". */
  function textoCurto(texto, { nomes = new Map(), refs = new Map() } = {}) {
    return String(texto || '')
      .replace(RE_MENCAO, (_, id) => `@${nomes.get(String(id)) || 'alguém'}`)
      .replace(RE_REF, (_, tipo, id) => {
        const r = rotuloDaRef(tipo, refs.get(chaveRef(tipo, id)));
        return `#${r.estado === 'ok' ? r.texto : ROTULO_REF[tipo]}`;
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Da caixa de escrever para o servidor: "@Ana Lima" → [[@5]]. */
  function paraMarcas(texto, tokens = []) {
    let saida = String(texto || '');
    const ordem = tokens.filter(t => t && t.texto && t.marca).sort((a, b) => b.texto.length - a.texto.length);
    for (const t of ordem) saida = saida.split(t.texto).join(t.marca);
    return saida;
  }

  /** Do servidor para a caixa de escrever (editar): [[@5]] → "@Ana Lima". */
  function deMarcas(texto, { nomes = new Map(), refs = new Map() } = {}) {
    const tokens = [];
    const vistas = new Set();
    const guardar = (visivel, marca) => {
      if (vistas.has(marca)) return;
      vistas.add(marca);
      tokens.push({ texto: visivel, marca });
    };
    const saida = String(texto || '')
      .replace(RE_MENCAO, (marca, id) => {
        const visivel = `@${nomes.get(String(id)) || `usuário ${id}`}`;
        guardar(visivel, marca);
        return visivel;
      })
      .replace(RE_REF, (marca, tipo, id) => {
        const r = rotuloDaRef(tipo, refs.get(chaveRef(tipo, id)));
        const visivel = `#${r.estado === 'ok' ? r.texto : `${ROTULO_REF[tipo]} ${id}`}`;
        guardar(visivel, marca);
        return visivel;
      });
    return { texto: saida, tokens };
  }

  /**
   * O "@" ou "#" sendo digitado antes do cursor (no começo ou depois de um
   * espaço; até um espaço no meio, para "Ana Li"). null quando não há.
   */
  function gatilho(texto, cursor) {
    const antes = String(texto || '').slice(0, cursor);
    const m = antes.match(/(^|[\s(])([@#])([^\s@#]{0,40}(?: [^\s@#]{0,40})?)$/);
    if (!m) return null;
    return { simbolo: m[2], inicio: antes.length - m[3].length - 1, consulta: m[3] };
  }

  const diaLocal = data => `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`;

  /** "Hoje", "Ontem" ou "Sexta-feira, 10 de outubro" (com o ano, se outro). */
  function rotuloDoDia(valor, agora = new Date()) {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '';
    const ontem = new Date(agora);
    ontem.setDate(ontem.getDate() - 1);
    if (diaLocal(d) === diaLocal(agora)) return 'Hoje';
    if (diaLocal(d) === diaLocal(ontem)) return 'Ontem';
    const opcoes = { weekday: 'long', day: 'numeric', month: 'long' };
    if (d.getFullYear() !== agora.getFullYear()) opcoes.year = 'numeric';
    const texto = d.toLocaleDateString('pt-BR', opcoes);
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  function horaDe(valor) {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function dataCompleta(valor) {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${horaDe(d)}`;
  }

  /** A hora na lista de conversas: hoje "14:30", ontem "Ontem", depois "10/10". */
  function quandoCurto(valor, agora = new Date()) {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '';
    const ontem = new Date(agora);
    ontem.setDate(ontem.getDate() - 1);
    if (diaLocal(d) === diaLocal(agora)) return horaDe(d);
    if (diaLocal(d) === diaLocal(ontem)) return 'Ontem';
    if (d.getFullYear() === agora.getFullYear()) return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
  }

  /** "Visto agora", "Visto há 5 min", "Visto há 2 h", "Visto ontem às 14:30"… */
  function vistoHa(valor, agora = new Date()) {
    if (!valor) return '';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '';
    const minutos = Math.floor((agora.getTime() - d.getTime()) / 60000);
    if (minutos < 1) return 'Visto agora';
    if (minutos < 60) return `Visto há ${minutos} min`;
    if (minutos < 12 * 60) return `Visto há ${Math.floor(minutos / 60)} h`;
    const ontem = new Date(agora);
    ontem.setDate(ontem.getDate() - 1);
    if (diaLocal(d) === diaLocal(agora)) return `Visto hoje às ${horaDe(d)}`;
    if (diaLocal(d) === diaLocal(ontem)) return `Visto ontem às ${horaDe(d)}`;
    return `Visto em ${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${horaDe(d)}`;
  }

  /**
   * As mensagens em blocos para desenhar: o separador de cada dia e cada
   * mensagem dizendo se "continua" a anterior (mesma pessoa, menos de 5 min,
   * sem ser resposta) — aí não repete o nome nem a foto.
   */
  function agrupar(mensagens, agora = new Date()) {
    const saida = [];
    let diaAnterior = null;
    let anterior = null;
    for (const m of mensagens || []) {
      const d = new Date(m.criado_em);
      const dia = Number.isNaN(d.getTime()) ? '' : diaLocal(d);
      if (dia !== diaAnterior) {
        saida.push({ tipo: 'dia', rotulo: rotuloDoDia(m.criado_em, agora), dia });
        diaAnterior = dia;
        anterior = null;
      }
      const continua = Boolean(
        anterior && m.tipo === 'texto' && anterior.tipo === 'texto' && !m.resposta &&
        String(anterior.autor_id) === String(m.autor_id) &&
        d.getTime() - new Date(anterior.criado_em).getTime() < CINCO_MIN
      );
      saida.push({ tipo: 'mensagem', mensagem: m, continua });
      anterior = m;
    }
    return saida;
  }

  /** Online primeiro, depois Ocupado, Ausente e Offline; dentro, por nome. */
  function ordenarPessoas(lista) {
    return [...(lista || [])].sort((a, b) =>
      (ORDEM_PRESENCA[a.estado] ?? 4) - (ORDEM_PRESENCA[b.estado] ?? 4) ||
      String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  }

  /** Fixadas primeiro; depois a da mensagem mais nova. */
  function ordenarConversas(lista) {
    return [...(lista || [])].sort((a, b) =>
      (b.fixada ? 1 : 0) - (a.fixada ? 1 : 0) ||
      new Date(b.atualizada_em || 0).getTime() - new Date(a.atualizada_em || 0).getTime());
  }

  /** O número do botão: as não lidas; das silenciadas, só as menções. */
  function contarNaoLidas(conversas) {
    return (conversas || []).reduce((soma, c) => soma + (c.silenciada ? Number(c.mencoes) || 0 : Number(c.nao_lidas) || 0), 0);
  }

  function nomeDaConversa(c, nomes = new Map()) {
    if (!c) return '';
    if (c.tipo === 'direta') return nomes.get(String(c.outro_id)) || 'Conversa';
    if (c.tipo === 'canal') return c.nome || 'canal';
    return c.nome || 'Grupo';
  }

  /** "Ana está digitando…", "Ana e Bruno estão digitando…". */
  function quemDigita(nomes) {
    const lista = (nomes || []).filter(Boolean);
    if (!lista.length) return '';
    if (lista.length === 1) return `${lista[0]} está digitando…`;
    if (lista.length === 2) return `${lista[0]} e ${lista[1]} estão digitando…`;
    return 'Várias pessoas estão digitando…';
  }

  /** O balão da reação: "Ana, Bruno e mais 2". */
  function quemReagiu(nomes) {
    const lista = (nomes || []).filter(Boolean);
    if (lista.length <= 1) return lista.join('');
    if (lista.length <= 3) return `${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}`;
    return `${lista.slice(0, 2).join(', ')} e mais ${lista.length - 2}`;
  }

  const Puro = {
    TIPOS_REF, ROTULO_REF, PRESENCA, MEU_STATUS, EMOJIS,
    escapar, comparavel, iniciais, corDoAvatar, rotuloDaRef, textoParaHtml, textoCurto,
    paraMarcas, deMarcas, gatilho, rotuloDoDia, horaDe, dataCompleta, quandoCurto, vistoHa,
    agrupar, ordenarPessoas, ordenarConversas, contarNaoLidas, nomeDaConversa, quemDigita, quemReagiu
  };

  // Nos testes (sem document) só as partes puras.
  if (typeof document === 'undefined') {
    window.ChatInterno = Puro;
    return;
  }

  // ================================================================ estado

  const estado = {
    base: null,
    disponivel: false,
    falha: null,              // por que o chat não abriu (só o Sup Admin vê)
    eu: { id: null, status: 'automatico', mensagem: null },
    pessoas: new Map(),       // id → { id, nome, perfil, foto_perfil, estado, recado, visto_em }
    conversas: [],
    canais: [],
    reacoes: ['👍', '❤️', '😂', '😮', '😢', '🙏', '✅', '👀', '🎉', '🔥', '👏', '💯'],
    mensagens: new Map(),     // conversaId → { lista, maisAntigas, carregando, carregada }
    membros: new Map(),       // conversaId → [{ usuario_id, papel, lida_ate_id }]
    refs: new Map(),          // 'tipo:id' → item resolvido
    refsPedidas: new Set(),
    digitando: new Map(),     // conversaId → Map(usuarioId → relógio)
    rascunhos: new Map(),     // conversaId → { texto, tokens, resposta }
    painelAberto: false,
    expandido: false,
    visao: 'vazio',           // vazio | conversa | novo | canais | detalhes
    aberta: null,             // id da conversa aberta
    marcoNaoLida: null,       // até onde estava lido ao abrir (o "Novas mensagens")
    busca: '',
    secoesFechadas: new Set(),
    tokens: [],
    resposta: null,           // a mensagem sendo respondida
    editando: null,           // a mensagem sendo editada
    escolha: null,            // a lista do @ ou do #
    flutuante: null,          // { modo: 'status' | 'reagir' | 'inserir', mensagemId }
    novo: { tipo: 'direta', escolhidos: new Set(), busca: '', nome: '', descricao: '' },
    detalhes: { escolhidos: new Set(), busca: '' },
    canaisBusca: '',
    destaque: null,
    fonte: null,
    conectado: false,
    jaConectou: false,
    tentativas: 0,
    ativo: true,
    ultimaAtividade: Date.now(),
    som: { ligado: true, arquivo: null },
    ultimoSom: 0,
    ultimoDigitando: 0
  };

  let raiz = null;
  const $ = seletor => raiz?.querySelector(seletor) || null;
  const parte = nome => $(`[data-chat="${nome}"]`);

  const ehEu = id => id != null && String(id) === String(estado.eu.id);
  const pessoa = id => estado.pessoas.get(String(id)) || null;
  const nomeDe = id => pessoa(id)?.nome || 'Alguém';
  const conversa = id => estado.conversas.find(c => String(c.id) === String(id)) || null;
  const nomes = () => new Map([...estado.pessoas.values()].map(p => [String(p.id), p.nome]));
  const contexto = () => ({ nomes: nomes(), euId: estado.eu.id, refs: estado.refs });
  const supAdmin = () => Boolean(window.Permissoes?.supAdmin);
  const toast = (texto, tipo = 'error') => {
    if (typeof window.showToast === 'function') window.showToast(texto, tipo);
  };

  // ================================================================ servidor

  async function baseDaApi() {
    if (estado.base) return estado.base;
    try {
      estado.base = await window.apiConfig?.getApiBaseUrl?.();
    } catch (_) {
      estado.base = null;
    }
    return estado.base;
  }

  async function api(caminho, { method = 'GET', body } = {}) {
    const base = await baseDaApi();
    if (!base) throw Object.assign(new Error('Sem o endereço do servidor.'), { status: 0 });
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const resposta = await fetch(new URL(`/api/chat${caminho}`, base).toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include'
    });
    let dados = null;
    try {
      dados = await resposta.json();
    } catch (_) {
      dados = null;
    }
    if (!resposta.ok) {
      const erro = new Error(dados?.error || `Falha (${resposta.status})`);
      erro.status = resposta.status;
      erro.code = dados?.code || null;
      throw erro;
    }
    return dados || {};
  }

  /** Foto de perfil: o caminho relativo vem da API (/imagens/perfis/...). */
  function urlDaFoto(valor) {
    const bruto = String(valor || '').trim();
    if (!bruto) return null;
    if (/^(https?:|data:|blob:|file:)/i.test(bruto)) return bruto;
    if (!estado.base) return null;
    return `${estado.base.replace(/\/+$/, '')}${bruto.startsWith('/') ? '' : '/'}${bruto}`;
  }

  function explicarFalha(err) {
    if (err?.code === 'CHAT_SQL' || err?.status === 503) return err.message || 'O chat ainda não está no banco: rode sql/chat_interno.sql e reinicie a API.';
    if (err?.status === 404) return 'O servidor ainda não tem o chat: publique a API nova e reinicie.';
    if (err?.status === 401) return 'Sessão expirada. Entre novamente.';
    return err?.message || 'Sem conexão com o servidor do chat.';
  }

  // ================================================================ montar

  function montar() {
    if (document.getElementById('chatInterno')) return;
    raiz = document.createElement('div');
    raiz.id = 'chatInterno';
    raiz.className = 'chat-raiz ctl-padrao';
    raiz.innerHTML = `
      <div class="chat-avisos" data-chat="avisos" aria-live="polite"></div>
      <section class="chat-painel hidden" data-chat="painel" role="dialog" aria-label="Chat interno">
        <header class="chat-topo">
          <div class="chat-topo-titulo">
            <i class="fas fa-comments" aria-hidden="true"></i>
            <span>Chat</span>
            <span class="chat-conexao hidden" data-chat="conexao" title="As mensagens continuam chegando, só que de 20 em 20 segundos.">Reconectando…</span>
          </div>
          <div class="chat-topo-acoes">
            <button type="button" class="chat-icone" data-acao="expandir" data-chat="expandir" title="Aumentar o painel"><i class="fas fa-expand" aria-hidden="true"></i></button>
            <button type="button" class="chat-icone" data-acao="fechar" title="Fechar (Esc)"><i class="fas fa-times" aria-hidden="true"></i></button>
          </div>
        </header>
        <div class="chat-corpo">
          <aside class="chat-lateral">
            <div class="chat-eu" data-chat="eu"></div>
            <div class="chat-busca">
              <i class="fas fa-search" aria-hidden="true"></i>
              <input type="search" class="ctl-campo chat-campo" data-chat="busca" placeholder="Buscar pessoas e conversas" autocomplete="off">
            </div>
            <div class="chat-listas" data-chat="listas"></div>
          </aside>
          <div class="chat-principal" data-chat="principal"></div>
        </div>
        <div class="chat-flutuante hidden" data-chat="flutuante"></div>
      </section>
      <button type="button" class="chat-botao hidden" data-chat="botao" data-acao="alternar" data-sem-loading="true" aria-label="Abrir o chat" title="Chat">
        <i class="fas fa-comments" aria-hidden="true"></i>
        <span class="chat-botao-contador hidden" data-chat="contador"></span>
        <span class="chat-presenca chat-botao-presenca chat-presenca--offline" data-chat="minha-presenca"></span>
      </button>`;
    document.body.appendChild(raiz);

    raiz.addEventListener('click', aoClicar);
    raiz.addEventListener('input', aoDigitarEmCampo);
    raiz.addEventListener('keydown', aoTeclar);
    raiz.addEventListener('mousedown', aoApertar);
    // Foto que não carrega: fica a inicial (o erro de <img> não borbulha).
    raiz.addEventListener('error', e => {
      if (e.target?.classList?.contains('chat-foto')) e.target.remove();
    }, true);
  }

  function mostrarBotao() {
    const botao = parte('botao');
    if (!botao) return;
    const mostrar = estado.disponivel || (estado.falha && supAdmin());
    botao.classList.toggle('hidden', !mostrar);
  }

  // ================================================================ pintar

  function avatarHtml(p, { tamanho = 32, presenca = true } = {}) {
    const nome = p?.nome || '?';
    const foto = urlDaFoto(p?.foto_perfil);
    const ponto = presenca ? `<span class="chat-presenca chat-presenca--${p?.estado || 'offline'}" title="${PRESENCA[p?.estado || 'offline']?.rotulo || ''}"></span>` : '';
    return `<span class="chat-avatar" style="--chat-avatar:${tamanho}px;background:${corDoAvatar(p?.id)}" aria-hidden="true">`
      + `<span class="chat-avatar-iniciais">${escapar(iniciais(nome))}</span>`
      + (foto ? `<img class="chat-foto" src="${escapar(foto)}" alt="">` : '')
      + `${ponto}</span>`;
  }

  function iconeDaConversa(c, tamanho = 32) {
    if (c.tipo === 'direta') return avatarHtml(pessoa(c.outro_id) || { id: c.outro_id, nome: '?' }, { tamanho });
    const icone = c.tipo === 'canal' ? 'fa-hashtag' : 'fa-users';
    return `<span class="chat-avatar chat-avatar--${c.tipo}" style="--chat-avatar:${tamanho}px" aria-hidden="true"><i class="fas ${icone}"></i></span>`;
  }

  /** Repinta o que mudou, uma vez por quadro. */
  const pendente = { lateral: false, cabecalho: false, mensagens: false, principal: false };
  let quadro = null;
  function pintar(partes) {
    Object.assign(pendente, partes);
    if (quadro) return;
    quadro = (window.requestAnimationFrame || (fn => setTimeout(fn, 16)))(() => {
      quadro = null;
      const p = { ...pendente };
      Object.keys(pendente).forEach(k => { pendente[k] = false; });
      try {
        if (p.principal) pintarPrincipal();
        else {
          if (p.cabecalho) pintarCabecalho();
          if (p.mensagens) pintarMensagens();
        }
        if (p.lateral) pintarLateral();
      } catch (err) {
        console.error('[chat] falha ao desenhar:', err);
      }
    });
  }

  function pintarTudo() {
    pintarEu();
    pintarLateral();
    pintarPrincipal();
    atualizarContador();
  }

  function pintarEu() {
    const caixa = parte('eu');
    if (!caixa) return;
    const eu = pessoa(estado.eu.id) || { id: estado.eu.id, nome: 'Você', estado: 'offline' };
    const status = MEU_STATUS.find(s => s.valor === estado.eu.status) || MEU_STATUS[0];
    const mostrado = { ...eu, estado: estadoMostradoDeMim() };
    caixa.innerHTML = `
      <button type="button" class="chat-eu-botao" data-acao="status" title="Mudar o seu status">
        ${avatarHtml(mostrado, { tamanho: 36 })}
        <span class="chat-eu-textos">
          <strong>${escapar(eu.nome)}</strong>
          <small>${escapar(status.rotulo)}${estado.eu.mensagem ? ` · ${escapar(estado.eu.mensagem)}` : ''}</small>
        </span>
        <i class="fas fa-chevron-down" aria-hidden="true"></i>
      </button>`;
    const ponto = parte('minha-presenca');
    if (ponto) ponto.className = `chat-presenca chat-botao-presenca chat-presenca--${mostrado.estado}`;
  }

  /** O meu ponto: o que eu escolhi (invisível aparece como offline para mim também, como no ClickUp). */
  function estadoMostradoDeMim() {
    const status = estado.eu.status;
    if (status === 'invisivel') return 'offline';
    if (status === 'ocupado') return 'ocupado';
    if (status === 'ausente') return 'ausente';
    return pessoa(estado.eu.id)?.estado === 'ausente' ? 'ausente' : (estado.conectado ? 'online' : 'offline');
  }

  function previaDaConversa(c) {
    const digitando = nomesDigitando(c.id);
    if (digitando.length) return `<em class="chat-digitando-previa">${escapar(quemDigita(digitando))}</em>`;
    const u = c.ultima;
    if (!u) return c.tipo === 'canal' && c.descricao ? escapar(c.descricao) : '<em>Sem mensagens</em>';
    if (u.apagada) return '<em>Mensagem apagada</em>';
    const texto = textoCurto(u.texto, contexto());
    if (u.tipo === 'sistema') return `<em>${escapar(texto)}</em>`;
    const quem = ehEu(u.autor_id) ? 'Você' : c.tipo === 'direta' ? '' : nomeDe(u.autor_id).split(' ')[0];
    return `${quem ? `<span class="chat-previa-autor">${escapar(quem)}:</span> ` : ''}${escapar(texto)}`;
  }

  function itemDeConversa(c) {
    const ativa = estado.visao !== 'vazio' && String(estado.aberta) === String(c.id);
    const nao = c.silenciada ? Number(c.mencoes) || 0 : Number(c.nao_lidas) || 0;
    const numero = nao > 99 ? '99+' : String(nao);
    const marca = c.mencoes > 0
      ? `<span class="chat-contador chat-contador--mencao" title="Mencionaram você${c.mencoes > 1 ? ` ${c.mencoes} vezes` : ''}">@ ${numero}</span>`
      : nao ? `<span class="chat-contador">${numero}</span>` : '';
    const nome = nomeDaConversa(c, nomes());
    const p = c.tipo === 'direta' ? pessoa(c.outro_id) : null;
    return `
      <button type="button" class="chat-item${ativa ? ' chat-item--ativo' : ''}${nao ? ' chat-item--nao-lida' : ''}" data-acao="abrir-conversa" data-id="${c.id}" title="${escapar(c.tipo === 'canal' ? `#${nome}` : nome)}">
        ${iconeDaConversa(c, 30)}
        <span class="chat-item-textos">
          <span class="chat-item-linha">
            <span class="chat-item-nome">${c.tipo === 'canal' ? '<span class="chat-hash">#</span>' : ''}${escapar(nome)}</span>
            ${c.fixada ? '<i class="fas fa-thumbtack chat-item-sinal" title="Fixada"></i>' : ''}
            ${c.silenciada ? '<i class="fas fa-bell-slash chat-item-sinal" title="Silenciada"></i>' : ''}
            <span class="chat-item-hora">${c.ultima ? escapar(quandoCurto(c.ultima.em)) : ''}</span>
          </span>
          <span class="chat-item-linha">
            <span class="chat-item-previa">${p?.recado && !c.ultima ? `<em>${escapar(p.recado)}</em>` : previaDaConversa(c)}</span>
            ${marca}
          </span>
        </span>
      </button>`;
  }

  function itemDePessoa(p) {
    const rotulo = PRESENCA[p.estado]?.rotulo || 'Offline';
    const sub = p.recado ? escapar(p.recado) : p.estado === 'offline' && p.visto_em ? escapar(vistoHa(p.visto_em)) : escapar(rotulo);
    return `
      <button type="button" class="chat-item chat-item--pessoa" data-acao="abrir-pessoa" data-id="${p.id}" title="Conversar com ${escapar(p.nome)} (${rotulo})">
        ${avatarHtml(p, { tamanho: 30 })}
        <span class="chat-item-textos">
          <span class="chat-item-linha"><span class="chat-item-nome">${escapar(p.nome)}</span></span>
          <span class="chat-item-linha"><span class="chat-item-previa">${sub}</span></span>
        </span>
      </button>`;
  }

  function secao(id, titulo, conteudo, { acoes = '', vazio = '' } = {}) {
    const fechada = estado.secoesFechadas.has(id) && !estado.busca;
    return `
      <section class="chat-secao${fechada ? ' chat-secao--fechada' : ''}">
        <div class="chat-secao-cab">
          <button type="button" class="chat-secao-titulo" data-acao="secao" data-secao="${id}">
            <i class="fas fa-chevron-down" aria-hidden="true"></i><span>${titulo}</span>
          </button>
          <span class="chat-secao-acoes">${acoes}</span>
        </div>
        <div class="chat-secao-corpo">${conteudo || (vazio ? `<p class="chat-vazio-linha">${vazio}</p>` : '')}</div>
      </section>`;
  }

  function pintarLateral() {
    const listas = parte('listas');
    if (!listas) return;
    if (!estado.disponivel) {
      listas.innerHTML = '';
      return;
    }
    const termo = comparavel(estado.busca);
    const bate = texto => !termo || comparavel(texto).includes(termo);
    const mapa = nomes();
    const canais = estado.conversas.filter(c => c.tipo === 'canal' && bate(c.nome));
    const diretas = estado.conversas.filter(c => c.tipo !== 'canal' && bate(nomeDaConversa(c, mapa)));
    const pessoas = ordenarPessoas([...estado.pessoas.values()].filter(p => !ehEu(p.id) && bate(p.nome)));
    const online = pessoas.filter(p => p.estado !== 'offline').length;
    const scroll = listas.scrollTop;
    listas.innerHTML = [
      secao('canais', 'Canais', canais.map(itemDeConversa).join(''), {
        acoes: `<button type="button" class="chat-icone chat-icone--pequeno" data-acao="explorar-canais" title="Explorar canais"><i class="fas fa-compass"></i></button>
                <button type="button" class="chat-icone chat-icone--pequeno" data-acao="nova" data-tipo="canal" title="Criar canal"><i class="fas fa-plus"></i></button>`,
        vazio: termo ? 'Nenhum canal com esse nome.' : '<button type="button" class="chat-link-botao" data-acao="explorar-canais">Explorar canais</button>'
      }),
      secao('diretas', 'Mensagens diretas', diretas.map(itemDeConversa).join(''), {
        acoes: '<button type="button" class="chat-icone chat-icone--pequeno" data-acao="nova" data-tipo="direta" title="Nova mensagem"><i class="fas fa-pen-to-square"></i></button>',
        vazio: termo ? 'Nenhuma conversa com esse nome.' : 'Clique numa pessoa abaixo para conversar.'
      }),
      secao('pessoas', `Pessoas <span class="chat-secao-numero">${online} de ${pessoas.length} no programa</span>`, pessoas.map(itemDePessoa).join(''), {
        vazio: termo ? 'Ninguém com esse nome.' : 'Ninguém mais por aqui ainda.'
      })
    ].join('');
    listas.scrollTop = scroll;
  }

  function pintarPrincipal() {
    const principal = parte('principal');
    if (!principal) return;
    fecharFlutuante();
    if (!estado.disponivel) {
      principal.innerHTML = htmlIndisponivel();
      return;
    }
    if (estado.visao === 'conversa' && conversa(estado.aberta)) {
      principal.innerHTML = htmlConversa();
      pintarCabecalho();
      pintarMensagens({ paraOFim: true });
      pintarContexto();
      restaurarRascunho();
      return;
    }
    if (estado.visao === 'novo') principal.innerHTML = htmlNovo();
    else if (estado.visao === 'canais') principal.innerHTML = htmlCanais();
    else if (estado.visao === 'detalhes' && conversa(estado.aberta)) principal.innerHTML = htmlDetalhes();
    else {
      estado.visao = 'vazio';
      principal.innerHTML = htmlVazio();
    }
  }

  function htmlIndisponivel() {
    return `
      <div class="chat-boas-vindas">
        <span class="chat-boas-vindas-icone"><i class="fas fa-plug"></i></span>
        <h3>O chat ainda não está disponível</h3>
        <p>${escapar(estado.falha || 'Sem conexão com o servidor do chat.')}</p>
        <button type="button" class="ctl-botao btn-secondary" data-acao="tentar-de-novo"><i class="fas fa-rotate-right"></i> Tentar de novo</button>
      </div>`;
  }

  function htmlVazio() {
    const eu = pessoa(estado.eu.id);
    return `
      <div class="chat-boas-vindas">
        <span class="chat-boas-vindas-icone"><i class="fas fa-comments"></i></span>
        <h3>Olá${eu?.nome ? `, ${escapar(eu.nome.split(' ')[0])}` : ''}!</h3>
        <p>Converse com a equipe em tempo real. Use <strong>@</strong> para chamar alguém e <strong>#</strong> para citar uma tarefa, cliente, prospecção, contato, pedido, orçamento ou produto.</p>
        <div class="chat-boas-vindas-acoes">
          <button type="button" class="ctl-botao btn-primary" data-acao="nova" data-tipo="direta"><i class="fas fa-pen-to-square"></i> Nova mensagem</button>
          <button type="button" class="ctl-botao btn-secondary" data-acao="explorar-canais"><i class="fas fa-compass"></i> Explorar canais</button>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------ conversa

  function htmlConversa() {
    return `
      <div class="chat-conversa">
        <header class="chat-cab" data-chat="cab"></header>
        <div class="chat-mensagens-moldura">
          <div class="chat-mensagens" data-chat="mensagens"></div>
          <button type="button" class="chat-ir-fim hidden" data-chat="ir-fim" data-acao="ir-fim"><i class="fas fa-arrow-down"></i> Novas mensagens</button>
        </div>
        <div class="chat-digitando" data-chat="digitando"></div>
        <footer class="chat-compositor">
          <div class="chat-contexto hidden" data-chat="contexto"></div>
          <div class="chat-escolha hidden" data-chat="escolha"></div>
          <div class="chat-caixa">
            <textarea class="chat-texto" data-chat="texto" rows="1" maxlength="4000" placeholder="${escapar(textoDoPlaceholder())}"></textarea>
            <div class="chat-ferramentas">
              <button type="button" class="chat-icone chat-icone--pequeno" data-acao="inserir-mencao" title="Mencionar alguém (@)"><i class="fas fa-at"></i></button>
              <button type="button" class="chat-icone chat-icone--pequeno" data-acao="inserir-referencia" title="Citar tarefa, cliente, prospecção, contato, pedido, orçamento ou produto (#)"><i class="fas fa-hashtag"></i></button>
              <button type="button" class="chat-icone chat-icone--pequeno" data-acao="emojis" title="Emoji"><i class="far fa-smile"></i></button>
              <button type="button" class="chat-enviar" data-acao="enviar" data-sem-loading="true" title="Enviar (Enter)"><i class="fas fa-paper-plane"></i></button>
            </div>
          </div>
          <div class="chat-dica">Enter envia · Shift+Enter quebra a linha · ↑ edita a sua última</div>
        </footer>
      </div>`;
  }

  function textoDoPlaceholder() {
    const c = conversa(estado.aberta);
    if (!c) return 'Escreva uma mensagem';
    const nome = nomeDaConversa(c, nomes());
    if (c.tipo === 'canal') return `Escreva em #${nome}`;
    if (c.tipo === 'grupo') return `Escreva para ${nome}`;
    return `Escreva para ${nome.split(' ')[0]}`;
  }

  function pintarCabecalho() {
    const cab = parte('cab');
    const c = conversa(estado.aberta);
    if (!cab || !c) return;
    const mapa = nomes();
    const nome = nomeDaConversa(c, mapa);
    let sub;
    if (c.tipo === 'direta') {
      const p = pessoa(c.outro_id) || { estado: 'offline' };
      const rotulo = PRESENCA[p.estado]?.rotulo || 'Offline';
      const quando = p.estado === 'offline' && p.visto_em ? ` · ${vistoHa(p.visto_em)}` : '';
      sub = `<span class="chat-presenca-texto chat-presenca-texto--${p.estado}">${rotulo}</span>${escapar(quando)}${p.recado ? ` · <em>${escapar(p.recado)}</em>` : ''}`;
    } else {
      const ids = (estado.membros.get(c.id) || []).map(m => m.usuario_id);
      const lista = ids.length ? ids.slice(0, 4).map(id => (ehEu(id) ? 'você' : mapa.get(String(id))?.split(' ')[0])).filter(Boolean).join(', ') + (ids.length > 4 ? '…' : '') : '';
      sub = `${c.membros} ${c.membros === 1 ? 'membro' : 'membros'}${lista ? ` · ${escapar(lista)}` : ''}${c.tipo === 'canal' && c.descricao ? ` · ${escapar(c.descricao)}` : ''}`;
    }
    cab.innerHTML = `
      <div class="chat-cab-quem">
        ${iconeDaConversa(c, 36)}
        <div class="chat-cab-textos">
          <h3>${c.tipo === 'canal' ? '<span class="chat-hash">#</span>' : ''}${escapar(nome)}</h3>
          <p>${sub}</p>
        </div>
      </div>
      <div class="chat-cab-acoes">
        <button type="button" class="chat-icone${c.fixada ? ' chat-icone--ligado' : ''}" data-acao="fixar" title="${c.fixada ? 'Desafixar' : 'Fixar no topo da lista'}"><i class="fas fa-thumbtack"></i></button>
        <button type="button" class="chat-icone${c.silenciada ? ' chat-icone--ligado' : ''}" data-acao="silenciar" title="${c.silenciada ? 'Voltar a avisar' : 'Silenciar (sem som nem aviso; menções continuam no sino)'}"><i class="fas ${c.silenciada ? 'fa-bell-slash' : 'fa-bell'}"></i></button>
        <button type="button" class="chat-icone" data-acao="detalhes" title="${c.tipo === 'direta' ? 'Sobre a pessoa' : 'Membros e configurações'}"><i class="fas ${c.tipo === 'direta' ? 'fa-info-circle' : 'fa-users-cog'}"></i></button>
      </div>`;
  }

  function htmlInicio(c) {
    const nome = nomeDaConversa(c, nomes());
    let texto;
    if (c.tipo === 'direta') texto = `Este é o começo da sua conversa com <strong>${escapar(nome)}</strong>. Só vocês dois veem estas mensagens.`;
    else if (c.tipo === 'canal') texto = `Este é o começo do canal <strong>#${escapar(nome)}</strong>.${c.descricao ? ` ${escapar(c.descricao)}` : ''} Qualquer pessoa da empresa pode entrar.`;
    else texto = `Este é o começo do grupo <strong>${escapar(nome)}</strong>. Só quem participa vê estas mensagens.`;
    return `<div class="chat-inicio">${iconeDaConversa(c, 48)}<p>${texto}</p></div>`;
  }

  function htmlDaMensagem(m, continua, c, ctx) {
    if (m.tipo === 'sistema') {
      return `<div class="chat-sistema" data-msg="${m.id}"><span>${textoParaHtml(m.texto, ctx)} · ${horaDe(m.criado_em)}</span></div>`;
    }
    const minha = ehEu(m.autor_id);
    const autor = pessoa(m.autor_id) || { id: m.autor_id, nome: 'Alguém' };
    const mencionado = !m.apagada && (m.mencoes || []).map(String).includes(String(estado.eu.id));
    const classes = ['chat-msg', continua && 'chat-msg--continua', minha && 'chat-msg--minha', mencionado && 'chat-msg--mencionado', m.apagada && 'chat-msg--apagada', String(estado.destaque) === String(m.id) && 'chat-msg--destaque'].filter(Boolean).join(' ');
    const lado = continua
      ? `<span class="chat-msg-hora-lado" title="${escapar(dataCompleta(m.criado_em))}">${horaDe(m.criado_em)}</span>`
      : avatarHtml(autor, { tamanho: 36, presenca: false });
    const topo = continua ? '' : `
      <div class="chat-msg-topo">
        <span class="chat-msg-autor">${escapar(autor.nome)}</span>
        <span class="chat-msg-hora" title="${escapar(dataCompleta(m.criado_em))}">${horaDe(m.criado_em)}</span>
      </div>`;
    const citacao = m.resposta ? `
      <button type="button" class="chat-citacao" data-acao="ir-para" data-id="${m.resposta.id}" title="Ir para a mensagem respondida">
        <i class="fas fa-reply" aria-hidden="true"></i>
        <strong>${escapar(nomeDe(m.resposta.autor_id))}</strong>
        <span>${m.resposta.apagada ? '<em>Mensagem apagada</em>' : escapar(textoCurto(m.resposta.texto, ctx).slice(0, 140))}</span>
      </button>` : '';
    const texto = m.apagada
      ? '<div class="chat-msg-texto chat-msg-texto--apagada"><i class="fas fa-ban" aria-hidden="true"></i> Mensagem apagada</div>'
      : `<div class="chat-msg-texto">${textoParaHtml(m.texto, ctx)}${m.editada_em ? ` <span class="chat-editada" title="Editada em ${escapar(dataCompleta(m.editada_em))}">(editada)</span>` : ''}</div>`;
    const reacoes = !m.apagada && m.reacoes?.length ? `
      <div class="chat-reacoes">
        ${m.reacoes.map(r => {
          const minhaReacao = (r.usuarios || []).some(ehEu);
          const quem = quemReagiu((r.usuarios || []).map(id => (ehEu(id) ? 'Você' : nomeDe(id))));
          return `<button type="button" class="chat-reacao${minhaReacao ? ' chat-reacao--minha' : ''}" data-acao="reacao" data-id="${m.id}" data-emoji="${escapar(r.emoji)}" title="${escapar(quem)}">${escapar(r.emoji)}<span>${r.usuarios.length}</span></button>`;
        }).join('')}
        <button type="button" class="chat-reacao chat-reacao--mais" data-acao="reagir" data-id="${m.id}" title="Reagir"><i class="far fa-smile"></i><i class="fas fa-plus"></i></button>
      </div>` : '';
    const acoes = m.apagada ? '' : `
      <div class="chat-msg-acoes">
        <button type="button" data-acao="reagir" data-id="${m.id}" title="Reagir"><i class="far fa-smile"></i></button>
        <button type="button" data-acao="responder" data-id="${m.id}" title="Responder"><i class="fas fa-reply"></i></button>
        ${minha ? `<button type="button" data-acao="editar" data-id="${m.id}" title="Editar"><i class="fas fa-pen"></i></button>` : ''}
        ${minha || supAdmin() ? `<button type="button" class="chat-perigo" data-acao="apagar" data-id="${m.id}" title="Apagar"><i class="fas fa-trash"></i></button>` : ''}
      </div>`;
    return `
      <div class="${classes}" data-msg="${m.id}">
        <div class="chat-msg-lado">${lado}</div>
        <div class="chat-msg-corpo">${topo}${citacao}${texto}${reacoes}</div>
        ${acoes}
      </div>`;
  }

  function pertoDoFim(el = parte('mensagens')) {
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  /**
   * Desenha as mensagens da conversa aberta. Fica onde estava, a não ser
   * que já estivesse no fim (ou `paraOFim`); ao carregar as anteriores,
   * segura o ponto de leitura (`manterDoFim`).
   */
  function pintarMensagens({ paraOFim = false, manterDoFim = null } = {}) {
    const el = parte('mensagens');
    const c = conversa(estado.aberta);
    if (!el || !c) return;
    const cache = estado.mensagens.get(c.id) || { lista: [], carregando: true };
    const estavaNoFim = pertoDoFim(el);
    const topoAntes = el.scrollTop;
    const ctx = contexto();
    const partes = [];
    if (cache.maisAntigas) {
      partes.push(`<div class="chat-mais-antigas">${cache.carregandoAntigas ? '<span class="chat-spinner"></span>' : '<button type="button" class="chat-link-botao" data-acao="mais-antigas">Carregar mensagens anteriores</button>'}</div>`);
    } else if (cache.carregada) {
      partes.push(htmlInicio(c));
    }
    if (cache.carregando && !cache.lista.length) partes.push('<div class="chat-carregando"><span class="chat-spinner"></span> Carregando mensagens…</div>');
    // "Visto" na direta: debaixo da minha última mensagem.
    let minhaUltima = null;
    if (c.tipo === 'direta') {
      for (let i = cache.lista.length - 1; i >= 0; i -= 1) {
        const m = cache.lista[i];
        if (m.tipo === 'texto' && !ehEu(m.autor_id)) break;
        if (m.tipo === 'texto' && !m.apagada) { minhaUltima = m; break; }
      }
    }
    let marcouNovas = false;
    for (const bloco of agrupar(cache.lista)) {
      if (bloco.tipo === 'dia') {
        partes.push(`<div class="chat-dia"><span>${escapar(bloco.rotulo)}</span></div>`);
        continue;
      }
      const m = bloco.mensagem;
      let continua = bloco.continua;
      if (!marcouNovas && estado.marcoNaoLida != null && m.id > estado.marcoNaoLida && !ehEu(m.autor_id)) {
        partes.push('<div class="chat-novas"><span>Novas mensagens</span></div>');
        marcouNovas = true;
        continua = false;
      }
      partes.push(htmlDaMensagem(m, continua, c, ctx));
      if (minhaUltima && m.id === minhaUltima.id) {
        const visto = Number(c.outro_lida_ate_id) >= Number(m.id);
        partes.push(`<div class="chat-visto${visto ? ' chat-visto--sim' : ''}"><i class="fas ${visto ? 'fa-check-double' : 'fa-check'}"></i> ${visto ? 'Visto' : 'Enviada'}</div>`);
      }
    }
    el.innerHTML = partes.join('');
    if (manterDoFim != null) el.scrollTop = el.scrollHeight - manterDoFim;
    else if (paraOFim || estavaNoFim) el.scrollTop = el.scrollHeight;
    else el.scrollTop = topoAntes;
    if (pertoDoFim(el)) parte('ir-fim')?.classList.add('hidden');
    pintarDigitando();
  }

  function nomesDigitando(conversaId) {
    const mapa = estado.digitando.get(Number(conversaId));
    if (!mapa) return [];
    return [...mapa.keys()].map(id => nomeDe(id).split(' ')[0]);
  }

  function pintarDigitando() {
    const el = parte('digitando');
    if (!el) return;
    const texto = quemDigita(nomesDigitando(estado.aberta));
    el.innerHTML = texto ? `<span class="chat-pontinhos"><i></i><i></i><i></i></span> ${escapar(texto)}` : '';
  }

  function pintarContexto() {
    const el = parte('contexto');
    if (!el) return;
    if (estado.editando) {
      el.innerHTML = `<i class="fas fa-pen"></i><span>Editando a mensagem · Esc cancela</span><button type="button" class="chat-icone chat-icone--pequeno" data-acao="cancelar-contexto" title="Cancelar"><i class="fas fa-times"></i></button>`;
      el.classList.remove('hidden');
    } else if (estado.resposta) {
      const m = estado.resposta;
      el.innerHTML = `<i class="fas fa-reply"></i><span>Respondendo a <strong>${escapar(nomeDe(m.autor_id))}</strong>: ${escapar(textoCurto(m.texto, contexto()).slice(0, 90))}</span><button type="button" class="chat-icone chat-icone--pequeno" data-acao="cancelar-contexto" title="Cancelar"><i class="fas fa-times"></i></button>`;
      el.classList.remove('hidden');
    } else {
      el.innerHTML = '';
      el.classList.add('hidden');
    }
  }

  // ------------------------------------------------------------ nova conversa

  function htmlEscolherPessoas(lista, escolhidos, { umSo = false } = {}) {
    if (!lista.length) return '<p class="chat-vazio-linha">Ninguém encontrado.</p>';
    return lista.map(p => {
      const marcado = escolhidos.has(String(p.id));
      return `
        <button type="button" class="chat-pessoa-opcao${marcado ? ' chat-pessoa-opcao--marcada' : ''}" data-acao="${umSo ? 'abrir-pessoa' : 'marcar-pessoa'}" data-id="${p.id}">
          ${umSo ? '' : `<span class="chat-caixinha">${marcado ? '<i class="fas fa-check"></i>' : ''}</span>`}
          ${avatarHtml(p, { tamanho: 30 })}
          <span class="chat-item-textos">
            <span class="chat-item-nome">${escapar(p.nome)}</span>
            <span class="chat-item-previa">${escapar(p.recado || PRESENCA[p.estado]?.rotulo || '')}${p.perfil ? ` · ${escapar(p.perfil)}` : ''}</span>
          </span>
        </button>`;
    }).join('');
  }

  function pessoasDoNovo() {
    const termo = comparavel(estado.novo.busca);
    return ordenarPessoas([...estado.pessoas.values()].filter(p => !ehEu(p.id) && (!termo || comparavel(p.nome).includes(termo))));
  }

  function htmlNovo() {
    const n = estado.novo;
    const tipos = [['direta', 'Conversa', 'fa-user'], ['grupo', 'Grupo', 'fa-users'], ['canal', 'Canal', 'fa-hashtag']];
    const explicacao = {
      direta: 'Uma conversa só entre você e a pessoa. Escolha com quem:',
      grupo: 'Uma conversa fechada: só quem está no grupo vê as mensagens. Quem está nele pode chamar mais gente.',
      canal: 'Aberto a toda a empresa: qualquer um acha em "Explorar canais" e entra. Bom para um assunto (#produção, #vendas).'
    }[n.tipo];
    const nomeCampo = n.tipo === 'direta' ? '' : `
      <div class="chat-campo-bloco">
        <label class="ctl-rotulo" for="chatNovoNome">${n.tipo === 'canal' ? 'Nome do canal' : 'Nome do grupo'}</label>
        <input id="chatNovoNome" class="ctl-campo chat-campo" data-chat="novo-nome" maxlength="60" value="${escapar(n.nome)}" placeholder="${n.tipo === 'canal' ? 'Ex.: produção' : 'Ex.: Entrega da Loja X'}" autocomplete="off">
      </div>
      ${n.tipo === 'canal' ? `
      <div class="chat-campo-bloco">
        <label class="ctl-rotulo" for="chatNovoDescricao">Sobre o que é (opcional)</label>
        <input id="chatNovoDescricao" class="ctl-campo chat-campo" data-chat="novo-descricao" maxlength="200" value="${escapar(n.descricao)}" placeholder="Ex.: Avisos e dúvidas da produção" autocomplete="off">
      </div>` : ''}`;
    return `
      <div class="chat-visao">
        <header class="chat-visao-cab">
          <button type="button" class="chat-icone" data-acao="voltar" title="Voltar"><i class="fas fa-arrow-left"></i></button>
          <h3>Nova conversa</h3>
        </header>
        <div class="chat-visao-corpo">
          <div class="chat-pilulas">
            ${tipos.map(([valor, rotulo, icone]) => `<button type="button" class="chat-pilula${n.tipo === valor ? ' chat-pilula--ativa' : ''}" data-acao="novo-tipo" data-tipo="${valor}"><i class="fas ${icone}"></i> ${rotulo}</button>`).join('')}
          </div>
          <p class="chat-apoio">${escapar(explicacao)}</p>
          ${nomeCampo}
          <div class="chat-campo-bloco">
            ${n.tipo === 'direta' ? '' : `<span class="ctl-rotulo">${n.tipo === 'canal' ? 'Chamar já (opcional)' : 'Quem participa'}${n.escolhidos.size ? ` · ${n.escolhidos.size} escolhido${n.escolhidos.size > 1 ? 's' : ''}` : ''}</span>`}
            <div class="chat-busca chat-busca--dentro">
              <i class="fas fa-search" aria-hidden="true"></i>
              <input type="search" class="ctl-campo chat-campo" data-chat="novo-busca" value="${escapar(n.busca)}" placeholder="Buscar pessoa" autocomplete="off">
            </div>
            <div class="chat-escolher-pessoas" data-chat="novo-pessoas">${htmlEscolherPessoas(pessoasDoNovo(), n.escolhidos, { umSo: n.tipo === 'direta' })}</div>
          </div>
        </div>
        <footer class="chat-visao-rodape">
          <button type="button" class="ctl-botao btn-danger" data-acao="voltar">Cancelar</button>
          ${n.tipo === 'direta' ? '' : `<button type="button" class="ctl-botao btn-primary" data-acao="criar"><i class="fas fa-check"></i> ${n.tipo === 'canal' ? 'Criar canal' : 'Criar grupo'}</button>`}
        </footer>
      </div>`;
  }

  // ------------------------------------------------------------ explorar canais

  function htmlCanais() {
    const termo = comparavel(estado.canaisBusca);
    const lista = estado.canais.filter(c => !termo || comparavel(`${c.nome} ${c.descricao || ''}`).includes(termo));
    const linhas = lista.length ? lista.map(c => `
      <div class="chat-canal-linha">
        <span class="chat-avatar chat-avatar--canal" style="--chat-avatar:36px" aria-hidden="true"><i class="fas fa-hashtag"></i></span>
        <div class="chat-canal-textos">
          <strong>#${escapar(c.nome)}</strong>
          <span>${c.descricao ? `${escapar(c.descricao)} · ` : ''}${c.membros} ${c.membros === 1 ? 'membro' : 'membros'}</span>
        </div>
        ${c.dentro
          ? `<button type="button" class="ctl-botao ctl-botao--pequeno btn-secondary" data-acao="abrir-conversa" data-id="${c.id}">Abrir</button>`
          : `<button type="button" class="ctl-botao ctl-botao--pequeno btn-primary" data-acao="entrar-canal" data-id="${c.id}"><i class="fas fa-right-to-bracket"></i> Entrar</button>`}
      </div>`).join('') : `<p class="chat-vazio-linha">${termo ? 'Nenhum canal com esse nome.' : 'Ainda não há canais. Crie o primeiro!'}</p>`;
    return `
      <div class="chat-visao">
        <header class="chat-visao-cab">
          <button type="button" class="chat-icone" data-acao="voltar" title="Voltar"><i class="fas fa-arrow-left"></i></button>
          <h3>Explorar canais</h3>
          <button type="button" class="ctl-botao ctl-botao--pequeno btn-primary chat-visao-cab-direita" data-acao="nova" data-tipo="canal"><i class="fas fa-plus"></i> Criar canal</button>
        </header>
        <div class="chat-visao-corpo">
          <div class="chat-busca chat-busca--dentro">
            <i class="fas fa-search" aria-hidden="true"></i>
            <input type="search" class="ctl-campo chat-campo" data-chat="canais-busca" value="${escapar(estado.canaisBusca)}" placeholder="Buscar canal" autocomplete="off">
          </div>
          <div class="chat-canais-lista" data-chat="canais-lista">${linhas}</div>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------ detalhes

  function htmlDetalhes() {
    const c = conversa(estado.aberta);
    const mapa = nomes();
    if (c.tipo === 'direta') {
      const p = pessoa(c.outro_id) || { id: c.outro_id, nome: mapa.get(String(c.outro_id)) || 'Pessoa', estado: 'offline' };
      return `
        <div class="chat-visao">
          <header class="chat-visao-cab">
            <button type="button" class="chat-icone" data-acao="voltar-conversa" title="Voltar à conversa"><i class="fas fa-arrow-left"></i></button>
            <h3>Sobre ${escapar(p.nome.split(' ')[0])}</h3>
          </header>
          <div class="chat-visao-corpo chat-perfil">
            ${avatarHtml(p, { tamanho: 88 })}
            <h3>${escapar(p.nome)}</h3>
            ${p.perfil ? `<p class="chat-apoio">${escapar(p.perfil)}</p>` : ''}
            <p><span class="chat-presenca-texto chat-presenca-texto--${p.estado}">${PRESENCA[p.estado]?.rotulo || 'Offline'}</span>${p.estado === 'offline' && p.visto_em ? ` · ${escapar(vistoHa(p.visto_em))}` : ''}</p>
            ${p.recado ? `<p class="chat-recado"><i class="fas fa-quote-left"></i> ${escapar(p.recado)}</p>` : ''}
          </div>
          <footer class="chat-visao-rodape">
            <button type="button" class="ctl-botao btn-secondary" data-acao="voltar-conversa">Voltar à conversa</button>
          </footer>
        </div>`;
    }
    const admin = c.papel === 'admin' || supAdmin();
    const membros = estado.membros.get(c.id) || [];
    const dentro = new Set(membros.map(m => String(m.usuario_id)));
    const termo = comparavel(estado.detalhes.busca);
    const fora = ordenarPessoas([...estado.pessoas.values()].filter(p => !dentro.has(String(p.id)) && (!termo || comparavel(p.nome).includes(termo))));
    const listaMembros = membros.length ? ordenarPessoas(membros.map(m => ({ ...(pessoa(m.usuario_id) || { id: m.usuario_id, nome: 'Pessoa', estado: 'offline' }), papel: m.papel }))).map(p => `
      <div class="chat-membro">
        ${avatarHtml(p, { tamanho: 30 })}
        <span class="chat-item-textos">
          <span class="chat-item-nome">${escapar(p.nome)}${ehEu(p.id) ? ' <small>(você)</small>' : ''}</span>
          <span class="chat-item-previa">${escapar(p.recado || PRESENCA[p.estado]?.rotulo || '')}</span>
        </span>
        ${p.papel === 'admin' ? '<span class="chat-etiqueta">administra</span>' : ''}
      </div>`).join('') : '<div class="chat-carregando"><span class="chat-spinner"></span></div>';
    return `
      <div class="chat-visao">
        <header class="chat-visao-cab">
          <button type="button" class="chat-icone" data-acao="voltar-conversa" title="Voltar à conversa"><i class="fas fa-arrow-left"></i></button>
          <h3>${c.tipo === 'canal' ? `#${escapar(c.nome)}` : escapar(c.nome || 'Grupo')}</h3>
        </header>
        <div class="chat-visao-corpo">
          ${admin ? `
          <div class="chat-campo-bloco">
            <label class="ctl-rotulo" for="chatDetNome">Nome</label>
            <input id="chatDetNome" class="ctl-campo chat-campo" data-chat="det-nome" maxlength="60" value="${escapar(c.nome || '')}" autocomplete="off">
          </div>
          ${c.tipo === 'canal' ? `
          <div class="chat-campo-bloco">
            <label class="ctl-rotulo" for="chatDetDescricao">Sobre o que é</label>
            <input id="chatDetDescricao" class="ctl-campo chat-campo" data-chat="det-descricao" maxlength="200" value="${escapar(c.descricao || '')}" autocomplete="off">
          </div>` : ''}
          <div class="chat-linha-direita"><button type="button" class="ctl-botao ctl-botao--pequeno btn-primary" data-acao="salvar-nome"><i class="fas fa-floppy-disk"></i> Salvar</button></div>` : (c.descricao ? `<p class="chat-apoio">${escapar(c.descricao)}</p>` : '')}
          <h4 class="ctl-secao chat-subtitulo">Membros (${membros.length || c.membros})</h4>
          <div class="chat-membros">${listaMembros}</div>
          <h4 class="ctl-secao chat-subtitulo">Chamar mais gente</h4>
          <div class="chat-busca chat-busca--dentro">
            <i class="fas fa-search" aria-hidden="true"></i>
            <input type="search" class="ctl-campo chat-campo" data-chat="det-busca" value="${escapar(estado.detalhes.busca)}" placeholder="Buscar pessoa" autocomplete="off">
          </div>
          <div class="chat-escolher-pessoas chat-escolher-pessoas--curta" data-chat="det-pessoas">${htmlEscolherPessoas(fora, estado.detalhes.escolhidos)}</div>
          <div class="chat-linha-direita"><button type="button" class="ctl-botao ctl-botao--pequeno btn-primary" data-acao="adicionar-membros"><i class="fas fa-user-plus"></i> Adicionar${estado.detalhes.escolhidos.size ? ` (${estado.detalhes.escolhidos.size})` : ''}</button></div>
        </div>
        <footer class="chat-visao-rodape">
          ${admin ? '<button type="button" class="ctl-botao btn-warning" data-acao="arquivar"><i class="fas fa-box-archive"></i> Arquivar</button>' : ''}
          <button type="button" class="ctl-botao btn-danger" data-acao="sair"><i class="fas fa-right-from-bracket"></i> Sair ${c.tipo === 'canal' ? 'do canal' : 'do grupo'}</button>
        </footer>
      </div>`;
  }

  // ------------------------------------------------------------ contador

  function atualizarContador() {
    const total = contarNaoLidas(estado.conversas);
    const contador = parte('contador');
    if (contador) {
      contador.textContent = total > 99 ? '99+' : String(total);
      contador.classList.toggle('hidden', !total);
    }
    const botao = parte('botao');
    if (botao) {
      botao.setAttribute('aria-label', total ? `Abrir o chat — ${total} não lida${total > 1 ? 's' : ''}` : 'Abrir o chat');
      botao.title = total ? `Chat — ${total} mensage${total > 1 ? 'ns' : 'm'} não lida${total > 1 ? 's' : ''}` : 'Chat';
    }
  }

  // ================================================================ dados

  function aplicarResumo(r) {
    estado.eu = { id: r.eu?.id ?? null, status: r.eu?.status || 'automatico', mensagem: r.eu?.mensagem || null };
    estado.pessoas = new Map((r.usuarios || []).map(u => [String(u.id), { ...u }]));
    estado.conversas = ordenarConversas(r.conversas || []);
    estado.canais = r.canais || [];
    if (Array.isArray(r.reacoes) && r.reacoes.length) estado.reacoes = r.reacoes;
    resolverRefsDasPrevias();
  }

  async function carregarResumo() {
    try {
      const r = await api('/resumo');
      estado.disponivel = true;
      estado.falha = null;
      aplicarResumo(r);
    } catch (err) {
      estado.disponivel = false;
      estado.falha = explicarFalha(err);
      if (err?.status !== 401) console.warn('[chat] indisponível:', estado.falha);
    }
    mostrarBotao();
    if (raiz) {
      pintarEu();
      pintarLateral();
      if (estado.painelAberto && (!estado.disponivel || estado.visao === 'vazio')) pintarPrincipal();
      atualizarContador();
    }
    return estado.disponivel;
  }

  async function recarregarConversas() {
    try {
      const r = await api('/conversas');
      const antes = new Map(estado.conversas.map(c => [String(c.id), c]));
      estado.conversas = ordenarConversas(r.conversas || []);
      // A conversa aberta saiu (arquivaram, saí em outro lugar): fecha.
      if (estado.aberta && !conversa(estado.aberta) && antes.has(String(estado.aberta)) && ['conversa', 'detalhes'].includes(estado.visao)) {
        toast('Esta conversa não está mais disponível para você.', 'info');
        estado.aberta = null;
        estado.visao = 'vazio';
        pintar({ principal: true });
      } else if (estado.visao === 'conversa') {
        pintar({ cabecalho: true });
      } else if (estado.visao === 'detalhes') {
        pintar({ principal: true });
      }
      resolverRefsDasPrevias();
      pintar({ lateral: true });
      atualizarContador();
    } catch (err) {
      if (err?.status === 503 || err?.status === 404) {
        estado.disponivel = false;
        estado.falha = explicarFalha(err);
        mostrarBotao();
      }
    }
  }

  async function recarregarCanais() {
    try {
      const r = await api('/canais');
      estado.canais = r.canais || [];
      if (estado.visao === 'canais') {
        const lista = parte('canais-lista');
        if (lista) pintarListaDeCanais();
      }
    } catch (_) { /* fica a lista que havia */ }
  }

  function pintarListaDeCanais() {
    const principal = parte('principal');
    if (!principal || estado.visao !== 'canais') return;
    const busca = parte('canais-busca');
    const foco = document.activeElement === busca;
    const pos = busca?.selectionStart;
    principal.innerHTML = htmlCanais();
    if (foco) {
      const nova = parte('canais-busca');
      nova?.focus();
      if (pos != null) nova?.setSelectionRange(pos, pos);
    }
  }

  async function recarregarPessoas() {
    try {
      const r = await api('/usuarios');
      const antigas = estado.pessoas;
      estado.pessoas = new Map((r.usuarios || []).map(u => [String(u.id), { ...antigas.get(String(u.id)), ...u }]));
      pintarEu();
      pintar({ lateral: true, cabecalho: estado.visao === 'conversa' });
    } catch (_) { /* segue com o que tinha */ }
  }

  async function carregarMembros(conversaId) {
    try {
      const r = await api(`/conversas/${conversaId}/membros`);
      estado.membros.set(Number(conversaId), r.membros || []);
      if (String(estado.aberta) === String(conversaId)) {
        if (estado.visao === 'detalhes') pintar({ principal: true });
        else pintar({ cabecalho: true });
      }
    } catch (_) { /* sem a lista, o @ oferece só quem já escreveu */ }
  }

  async function carregarMensagens(conversaId) {
    const id = Number(conversaId);
    const cache = estado.mensagens.get(id) || { lista: [], maisAntigas: false, carregando: false, carregada: false };
    estado.mensagens.set(id, cache);
    if (cache.carregada && cache.lista.length) {
      // Já tinha: pede só o que chegou depois (caso o ao vivo tenha caído).
      await buscarNovas(id);
      if (String(estado.aberta) === String(id) && estado.visao === 'conversa') marcarComoLida();
      return;
    }
    cache.carregando = true;
    if (String(estado.aberta) === String(id)) pintar({ mensagens: true });
    try {
      const r = await api(`/conversas/${id}/mensagens?limite=50`);
      const vistas = new Set(cache.lista.map(m => m.id));
      cache.lista = [...(r.mensagens || []).filter(m => !vistas.has(m.id)), ...cache.lista].sort((a, b) => a.id - b.id);
      cache.maisAntigas = Boolean(r.mais_antigas);
      cache.carregada = true;
      resolverRefsDe(cache.lista);
    } catch (err) {
      toast(err.message || 'Não foi possível carregar as mensagens.');
    } finally {
      cache.carregando = false;
    }
    if (String(estado.aberta) === String(id) && estado.visao === 'conversa') {
      pintarMensagens({ paraOFim: true });
      marcarComoLida();
    }
  }

  async function buscarNovas(conversaId) {
    const id = Number(conversaId);
    const cache = estado.mensagens.get(id);
    if (!cache?.carregada) return;
    const ultimo = cache.lista.length ? cache.lista[cache.lista.length - 1].id : 0;
    try {
      const r = await api(`/conversas/${id}/mensagens?depois=${ultimo}&limite=200`);
      const novas = (r.mensagens || []).filter(m => !cache.lista.some(x => x.id === m.id));
      if (!novas.length) return;
      cache.lista = [...cache.lista, ...novas].sort((a, b) => a.id - b.id);
      resolverRefsDe(novas);
      if (String(estado.aberta) === String(id) && estado.visao === 'conversa') {
        pintarMensagens();
        marcarComoLida();
      }
    } catch (_) { /* tenta de novo na próxima volta */ }
  }

  async function carregarAnteriores() {
    const c = conversa(estado.aberta);
    const cache = c && estado.mensagens.get(c.id);
    if (!cache || !cache.maisAntigas || cache.carregandoAntigas || !cache.lista.length) return;
    const el = parte('mensagens');
    cache.carregandoAntigas = true;
    pintarMensagens({ manterDoFim: el ? el.scrollHeight - el.scrollTop : null });
    try {
      const r = await api(`/conversas/${c.id}/mensagens?antes=${cache.lista[0].id}&limite=50`);
      const vistas = new Set(cache.lista.map(m => m.id));
      cache.lista = [...(r.mensagens || []).filter(m => !vistas.has(m.id)), ...cache.lista].sort((a, b) => a.id - b.id);
      cache.maisAntigas = Boolean(r.mais_antigas);
      resolverRefsDe(r.mensagens || []);
    } catch (err) {
      toast(err.message || 'Não foi possível carregar as mensagens anteriores.');
    } finally {
      cache.carregandoAntigas = false;
    }
    if (String(estado.aberta) === String(c.id)) {
      const atual = parte('mensagens');
      pintarMensagens({ manterDoFim: atual ? atual.scrollHeight - atual.scrollTop : null });
    }
  }

  // ------------------------------------------------------------ citações

  let relogioRefs = null;
  function pedirRefs(lista) {
    let nova = false;
    for (const r of lista) {
      const chave = chaveRef(r.tipo, r.id);
      if (estado.refs.has(chave) || estado.refsPedidas.has(chave)) continue;
      estado.refsPedidas.add(chave);
      nova = true;
    }
    if (!nova || relogioRefs) return;
    relogioRefs = setTimeout(resolverPendentes, 60);
  }

  async function resolverPendentes() {
    relogioRefs = null;
    const pedidas = [...estado.refsPedidas].filter(k => !estado.refs.has(k));
    estado.refsPedidas.clear();
    if (!pedidas.length) return;
    const itens = pedidas.map(k => {
      const [tipo, id] = k.split(':');
      return { tipo, id: Number(id) };
    });
    try {
      const r = await api('/referencias/resolver', { method: 'POST', body: { itens } });
      for (const item of r.itens || []) estado.refs.set(chaveRef(item.tipo, item.id), item);
    } catch (_) {
      // Sem resposta: vira "sem acesso" para não ficar girando para sempre.
      for (const i of itens) if (!estado.refs.has(chaveRef(i.tipo, i.id))) estado.refs.set(chaveRef(i.tipo, i.id), { ...i, sem_acesso: true });
    }
    pintar({ lateral: true, mensagens: estado.visao === 'conversa' });
  }

  function resolverRefsDe(mensagens) {
    const lista = [];
    for (const m of mensagens || []) {
      for (const r of m.referencias || []) lista.push(r);
      if (m.resposta?.texto) for (const x of m.resposta.texto.matchAll(RE_REF)) lista.push({ tipo: x[1], id: Number(x[2]) });
    }
    if (lista.length) pedirRefs(lista);
  }

  function resolverRefsDasPrevias() {
    const lista = [];
    for (const c of estado.conversas) {
      if (c.ultima?.texto) for (const x of c.ultima.texto.matchAll(RE_REF)) lista.push({ tipo: x[1], id: Number(x[2]) });
    }
    if (lista.length) pedirRefs(lista);
  }

  // ================================================================ painel

  async function abrirPainel() {
    const painel = parte('painel');
    if (!painel) return;
    estado.painelAberto = true;
    painel.classList.remove('hidden');
    parte('botao')?.classList.add('chat-botao--aberto');
    parte('botao')?.setAttribute('aria-expanded', 'true');
    limparAvisos();
    // Chegou mensagem com o painel fechado: a linha "Novas mensagens" volta a marcar onde parou.
    const aberta = estado.visao === 'conversa' ? conversa(estado.aberta) : null;
    if (aberta && Number(aberta.nao_lidas) > 0) estado.marcoNaoLida = Number(aberta.lida_ate_id) || 0;
    pintarTudo();
    if (!estado.disponivel) {
      await carregarResumo();
      if (estado.disponivel) {
        conectar();
        pintarTudo();
      }
      return;
    }
    if (estado.visao === 'conversa' && estado.aberta) {
      await carregarMensagens(estado.aberta);
      setTimeout(() => parte('texto')?.focus(), 30);
    } else {
      setTimeout(() => parte('busca')?.focus(), 30);
    }
  }

  function fecharPainel() {
    salvarRascunho();
    estado.painelAberto = false;
    fecharFlutuante();
    fecharEscolha();
    parte('painel')?.classList.add('hidden');
    parte('botao')?.classList.remove('chat-botao--aberto');
    parte('botao')?.setAttribute('aria-expanded', 'false');
  }

  function alternarPainel() {
    if (estado.painelAberto) fecharPainel();
    else abrirPainel();
  }

  function alternarTamanho() {
    estado.expandido = !estado.expandido;
    parte('painel')?.classList.toggle('chat-painel--grande', estado.expandido);
    const botao = parte('expandir');
    if (botao) {
      botao.title = estado.expandido ? 'Diminuir o painel' : 'Aumentar o painel';
      botao.innerHTML = `<i class="fas ${estado.expandido ? 'fa-compress' : 'fa-expand'}" aria-hidden="true"></i>`;
    }
    const el = parte('mensagens');
    if (el && pertoDoFim(el)) setTimeout(() => { el.scrollTop = el.scrollHeight; }, 0);
  }

  async function abrirConversa(id) {
    const c = conversa(id);
    if (!c) return;
    salvarRascunho();
    estado.aberta = Number(c.id);
    estado.visao = 'conversa';
    estado.resposta = null;
    estado.editando = null;
    estado.tokens = [];
    estado.destaque = null;
    estado.marcoNaoLida = Number(c.nao_lidas) > 0 ? Number(c.lida_ate_id) || 0 : null;
    fecharEscolha();
    pintarPrincipal();
    pintarLateral();
    if (c.tipo !== 'direta' && !estado.membros.has(c.id)) carregarMembros(c.id);
    setTimeout(() => parte('texto')?.focus(), 30);
    await carregarMensagens(c.id);
  }

  async function abrirComPessoa(usuarioId) {
    const existente = estado.conversas.find(c => c.tipo === 'direta' && String(c.outro_id) === String(usuarioId));
    if (existente) return abrirConversa(existente.id);
    try {
      const r = await api('/conversas/direta', { method: 'POST', body: { usuario_id: Number(usuarioId) } });
      await recarregarConversas();
      await abrirConversa(r.id);
    } catch (err) {
      toast(err.message || 'Não foi possível abrir a conversa.');
    }
  }

  function voltar() {
    if (estado.aberta && conversa(estado.aberta)) estado.visao = 'conversa';
    else estado.visao = 'vazio';
    pintarPrincipal();
    pintarLateral();
  }

  // ------------------------------------------------------------ rascunhos

  function salvarRascunho() {
    const ta = parte('texto');
    if (!ta || !estado.aberta || estado.editando) return;
    if (ta.value.trim() || estado.resposta) estado.rascunhos.set(estado.aberta, { texto: ta.value, tokens: [...estado.tokens], resposta: estado.resposta });
    else estado.rascunhos.delete(estado.aberta);
  }

  function restaurarRascunho() {
    const ta = parte('texto');
    if (!ta) return;
    const r = estado.rascunhos.get(estado.aberta);
    if (r && !estado.editando) {
      ta.value = r.texto;
      estado.tokens = [...r.tokens];
      estado.resposta = r.resposta || null;
      pintarContexto();
    }
    ajustarAltura();
  }

  function ajustarAltura() {
    const ta = parte('texto');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 168)}px`;
  }

  // ================================================================ escrever

  async function enviar() {
    const ta = parte('texto');
    const c = conversa(estado.aberta);
    if (!ta || !c) return;
    if (estado.escolha?.itens?.length) return;
    const texto = paraMarcas(ta.value, estado.tokens).trim();
    if (!texto) return;
    if (texto.length > 4000) {
      toast('A mensagem passa de 4.000 letras. Divida em duas.');
      return;
    }
    const editando = estado.editando;
    const resposta = estado.resposta;
    const tokens = estado.tokens;
    const original = ta.value;
    ta.value = '';
    estado.tokens = [];
    estado.resposta = null;
    estado.editando = null;
    estado.rascunhos.delete(c.id);
    pintarContexto();
    ajustarAltura();
    try {
      if (editando) {
        const r = await api(`/mensagens/${editando.id}`, { method: 'PUT', body: { texto } });
        trocarMensagem(r.mensagem);
      } else {
        const r = await api(`/conversas/${c.id}/mensagens`, { method: 'POST', body: { texto, resposta_de: resposta?.id ?? null } });
        receberMinha(c, r.mensagem);
      }
    } catch (err) {
      // Devolve o texto para a caixa: nada se perde.
      if (!parte('texto')?.value) {
        ta.value = original;
        estado.tokens = tokens;
        estado.resposta = resposta;
        estado.editando = editando;
        pintarContexto();
        ajustarAltura();
      }
      toast(err.message || 'A mensagem não foi enviada. Tente de novo.');
    }
  }

  function receberMinha(c, m) {
    if (!m) return;
    const cache = estado.mensagens.get(c.id);
    if (cache && !cache.lista.some(x => x.id === m.id)) cache.lista.push(m);
    c.ultima = { id: m.id, autor_id: m.autor_id, tipo: m.tipo, em: m.criado_em, texto: m.texto, apagada: false };
    c.atualizada_em = m.criado_em;
    c.lida_ate_id = Math.max(Number(c.lida_ate_id) || 0, m.id);
    estado.marcoNaoLida = null;
    estado.conversas = ordenarConversas(estado.conversas);
    resolverRefsDe([m]);
    if (String(estado.aberta) === String(c.id)) pintarMensagens({ paraOFim: true });
    pintar({ lateral: true });
  }

  function trocarMensagem(m) {
    if (!m) return;
    const cache = estado.mensagens.get(Number(m.conversa_id));
    if (cache) {
      const i = cache.lista.findIndex(x => x.id === m.id);
      if (i >= 0) cache.lista[i] = m;
    }
    const c = conversa(m.conversa_id);
    if (c?.ultima && c.ultima.id === m.id) {
      c.ultima = { ...c.ultima, texto: m.texto, apagada: Boolean(m.apagada) };
      pintar({ lateral: true });
    }
    resolverRefsDe([m]);
    if (String(estado.aberta) === String(m.conversa_id)) pintar({ mensagens: true });
  }

  function comecarResposta(id) {
    const m = mensagemDaAberta(id);
    if (!m) return;
    estado.editando = null;
    estado.resposta = m;
    pintarContexto();
    parte('texto')?.focus();
  }

  function comecarEdicao(id) {
    const m = mensagemDaAberta(id);
    const ta = parte('texto');
    if (!m || !ta || !ehEu(m.autor_id) || m.apagada) return;
    salvarRascunho();
    const { texto, tokens } = deMarcas(m.texto, { nomes: nomes(), refs: estado.refs });
    estado.editando = m;
    estado.resposta = null;
    estado.tokens = tokens;
    ta.value = texto;
    pintarContexto();
    ajustarAltura();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function cancelarContexto() {
    const ta = parte('texto');
    if (estado.editando && ta) {
      ta.value = '';
      estado.tokens = [];
      estado.editando = null;
      restaurarRascunho();
    }
    estado.resposta = null;
    estado.editando = null;
    pintarContexto();
    ajustarAltura();
  }

  function mensagemDaAberta(id) {
    return estado.mensagens.get(Number(estado.aberta))?.lista.find(m => String(m.id) === String(id)) || null;
  }

  async function apagar(id) {
    const m = mensagemDaAberta(id);
    if (!m) return;
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Apagar mensagem',
      tom: 'erro',
      icone: 'fa-trash',
      message: ehEu(m.autor_id)
        ? 'A mensagem some da conversa para todos; no lugar dela fica "Mensagem apagada".'
        : `A mensagem de ${nomeDe(m.autor_id)} some da conversa para todos; no lugar dela fica "Mensagem apagada".`,
      confirmText: 'Apagar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger'
    });
    if (!ok) return;
    try {
      const r = await api(`/mensagens/${m.id}`, { method: 'DELETE' });
      trocarMensagem(r.mensagem);
    } catch (err) {
      toast(err.message || 'Não foi possível apagar.');
    }
  }

  async function reagir(id, emoji) {
    try {
      const r = await api(`/mensagens/${id}/reacoes`, { method: 'POST', body: { emoji } });
      trocarMensagem(r.mensagem);
    } catch (err) {
      toast(err.message || 'Não foi possível reagir.');
    }
  }

  function irPara(id) {
    const el = $(`[data-msg="${id}"]`);
    if (!el) {
      toast('A mensagem respondida é mais antiga: carregue as anteriores para vê-la.', 'info');
      return;
    }
    estado.destaque = Number(id);
    el.classList.add('chat-msg--destaque');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => {
      estado.destaque = null;
      $(`[data-msg="${id}"]`)?.classList.remove('chat-msg--destaque');
    }, 1800);
  }

  // ------------------------------------------------------------ @ e #

  function candidatosDaMencao(consulta) {
    const c = conversa(estado.aberta);
    if (!c) return [];
    let ids;
    if (c.tipo === 'direta') ids = [c.outro_id];
    else {
      ids = (estado.membros.get(c.id) || []).map(m => m.usuario_id);
      if (!ids.length) ids = [...new Set((estado.mensagens.get(c.id)?.lista || []).map(m => m.autor_id).filter(Boolean))];
    }
    const termo = comparavel(consulta);
    return ordenarPessoas(ids.filter(id => !ehEu(id)).map(pessoa).filter(Boolean))
      .filter(p => !termo || comparavel(p.nome).split(/\s+/).some(parteDoNome => parteDoNome.startsWith(termo)) || comparavel(p.nome).includes(termo))
      .slice(0, 8);
  }

  let relogioBusca = null;
  let buscaAtual = 0;
  function buscarReferencias() {
    clearTimeout(relogioBusca);
    relogioBusca = setTimeout(async () => {
      const e = estado.escolha;
      if (!e || e.simbolo !== '#') return;
      const minha = ++buscaAtual;
      const params = new URLSearchParams({ q: e.consulta || '' });
      if (e.tipo) params.set('tipo', e.tipo);
      try {
        const r = await api(`/referencias/buscar?${params.toString()}`);
        if (minha !== buscaAtual || !estado.escolha || estado.escolha.simbolo !== '#') return;
        estado.escolha.itens = r.itens || [];
        estado.escolha.tipos = r.tipos || [];
        estado.escolha.carregando = false;
        estado.escolha.indice = 0;
        for (const item of estado.escolha.itens) estado.refs.set(chaveRef(item.tipo, item.id), item);
      } catch (_) {
        if (minha !== buscaAtual || !estado.escolha) return;
        estado.escolha.itens = [];
        estado.escolha.carregando = false;
        estado.escolha.falhou = true;
      }
      pintarEscolha();
    }, 220);
  }

  function aoMudarTexto() {
    ajustarAltura();
    avisarQueDigito();
    const ta = parte('texto');
    if (!ta) return;
    const g = gatilho(ta.value, ta.selectionStart);
    if (!g) return fecharEscolha();
    if (g.simbolo === '@') {
      estado.escolha = { ...g, itens: candidatosDaMencao(g.consulta), indice: 0 };
      pintarEscolha();
      return;
    }
    const anterior = estado.escolha?.simbolo === '#' ? estado.escolha : null;
    if (anterior && anterior.inicio === g.inicio && anterior.consulta === g.consulta) return;
    estado.escolha = { ...g, itens: anterior?.itens || [], tipos: anterior?.tipos || [], tipo: anterior?.tipo || '', indice: 0, carregando: true };
    pintarEscolha();
    buscarReferencias();
  }

  function pintarEscolha() {
    const el = parte('escolha');
    const e = estado.escolha;
    if (!el) return;
    if (!e) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    let corpo;
    if (e.simbolo === '@') {
      corpo = e.itens.length ? e.itens.map((p, i) => `
        <button type="button" class="chat-escolha-item${i === e.indice ? ' chat-escolha-item--ativo' : ''}" data-acao="escolher" data-indice="${i}">
          ${avatarHtml(p, { tamanho: 24 })}<span class="chat-escolha-nome">${escapar(p.nome)}</span><span class="chat-escolha-detalhe">${escapar(PRESENCA[p.estado]?.rotulo || '')}</span>
        </button>`).join('') : '<p class="chat-vazio-linha">Ninguém desta conversa com esse nome.</p>';
    } else {
      const abas = (e.tipos || []).length > 1 ? `
        <div class="chat-escolha-abas">
          <button type="button" class="chat-pilula chat-pilula--mini${!e.tipo ? ' chat-pilula--ativa' : ''}" data-acao="escolha-tipo" data-tipo="">Tudo</button>
          ${e.tipos.map(t => `<button type="button" class="chat-pilula chat-pilula--mini${e.tipo === t.tipo ? ' chat-pilula--ativa' : ''}" data-acao="escolha-tipo" data-tipo="${t.tipo}"><i class="fas ${ICONE_REF[t.tipo]}"></i> ${escapar(t.rotulo)}</button>`).join('')}
        </div>` : '';
      let lista;
      if (e.carregando && !e.itens.length) lista = '<div class="chat-carregando"><span class="chat-spinner"></span> Buscando…</div>';
      else if (!e.itens.length) lista = `<p class="chat-vazio-linha">${e.falhou ? 'Não foi possível buscar agora.' : (e.tipos || []).length ? 'Nada encontrado com esse nome.' : 'Seu perfil não tem o que citar.'}</p>`;
      else lista = e.itens.map((item, i) => `
        <button type="button" class="chat-escolha-item${i === e.indice ? ' chat-escolha-item--ativo' : ''}" data-acao="escolher" data-indice="${i}">
          <span class="chat-escolha-icone"><i class="fas ${ICONE_REF[item.tipo]}"></i></span>
          <span class="chat-escolha-nome">${escapar(item.rotulo)}</span>
          <span class="chat-escolha-detalhe">${escapar([item.tipo_rotulo || ROTULO_REF[item.tipo], item.detalhe].filter(Boolean).join(' · '))}</span>
        </button>`).join('');
      corpo = abas + `<div class="chat-escolha-lista">${lista}</div>`;
    }
    el.innerHTML = `<div class="chat-escolha-titulo">${e.simbolo === '@' ? 'Mencionar alguém da conversa' : 'Citar (só o que o seu perfil vê)'}<span>↑↓ escolhe · Enter confirma · Esc fecha</span></div>${corpo}`;
    el.classList.remove('hidden');
    el.querySelector('.chat-escolha-item--ativo')?.scrollIntoView({ block: 'nearest' });
  }

  function fecharEscolha() {
    if (!estado.escolha) return;
    estado.escolha = null;
    pintarEscolha();
  }

  function escolher(indice) {
    const e = estado.escolha;
    const ta = parte('texto');
    const item = e?.itens?.[indice];
    if (!e || !ta || !item) return;
    let visivel;
    let marca;
    if (e.simbolo === '@') {
      visivel = `@${item.nome}`;
      marca = `[[@${item.id}]]`;
    } else {
      visivel = `#${item.rotulo}`;
      marca = `[[#${item.tipo}:${item.id}]]`;
      estado.refs.set(chaveRef(item.tipo, item.id), item);
    }
    const fim = ta.selectionStart;
    ta.value = `${ta.value.slice(0, e.inicio)}${visivel} ${ta.value.slice(fim)}`;
    const pos = e.inicio + visivel.length + 1;
    estado.tokens.push({ texto: visivel, marca });
    estado.escolha = null;
    pintarEscolha();
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ajustarAltura();
  }

  function inserirNoCursor(texto, { comEspaco = true } = {}) {
    const ta = parte('texto');
    if (!ta) return;
    const ini = ta.selectionStart ?? ta.value.length;
    const fim = ta.selectionEnd ?? ini;
    const antes = ta.value.slice(0, ini);
    const precisa = comEspaco && antes && !/\s$/.test(antes) ? ' ' : '';
    ta.value = `${antes}${precisa}${texto}${ta.value.slice(fim)}`;
    const pos = ini + precisa.length + texto.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    aoMudarTexto();
  }

  let ultimoAvisoDigitando = 0;
  function avisarQueDigito() {
    const c = conversa(estado.aberta);
    if (!c || estado.editando || !parte('texto')?.value.trim()) return;
    const agora = Date.now();
    if (agora - ultimoAvisoDigitando < 3000) return;
    ultimoAvisoDigitando = agora;
    api(`/conversas/${c.id}/digitando`, { method: 'POST', body: {} }).catch(() => {});
  }

  // ------------------------------------------------------------ flutuante

  function abrirFlutuante(modo, ancora, extra = {}) {
    const el = parte('flutuante');
    const painel = parte('painel');
    if (!el || !painel || !ancora) return;
    if (estado.flutuante && estado.flutuante.modo === modo && estado.flutuante.mensagemId === extra.mensagemId) {
      fecharFlutuante();
      return;
    }
    estado.flutuante = { modo, ...extra };
    if (modo === 'status') el.innerHTML = htmlMenuStatus();
    else {
      const lista = modo === 'reagir' ? estado.reacoes : EMOJIS;
      el.innerHTML = `<div class="chat-emojis${modo === 'inserir' ? ' chat-emojis--largo' : ''}">${lista.map(e => `<button type="button" data-acao="emoji" data-emoji="${escapar(e)}">${escapar(e)}</button>`).join('')}</div>`;
    }
    el.classList.remove('hidden');
    const caixa = painel.getBoundingClientRect();
    let alvo = ancora.getBoundingClientRect();
    // A barra de ações da mensagem só aparece com o mouse em cima: escondida, mede zero.
    if (!alvo.width && !alvo.height) alvo = (ancora.closest('.chat-msg') || ancora).getBoundingClientRect();
    const largura = el.offsetWidth;
    const altura = el.offsetHeight;
    let esquerda = alvo.left - caixa.left;
    if (modo !== 'status') esquerda = alvo.right - caixa.left - largura;
    esquerda = Math.max(8, Math.min(esquerda, caixa.width - largura - 8));
    let topo = modo === 'status' ? alvo.bottom - caixa.top + 6 : alvo.top - caixa.top - altura - 6;
    if (topo < 8) topo = alvo.bottom - caixa.top + 6;
    if (topo + altura > caixa.height - 8) topo = Math.max(8, caixa.height - altura - 8);
    el.style.left = `${esquerda}px`;
    el.style.top = `${topo}px`;
    if (modo === 'status') setTimeout(() => parte('recado')?.focus(), 30);
  }

  function fecharFlutuante() {
    const el = parte('flutuante');
    estado.flutuante = null;
    if (el) {
      el.classList.add('hidden');
      el.innerHTML = '';
    }
  }

  function htmlMenuStatus() {
    return `
      <div class="chat-menu-status">
        <div class="chat-menu-titulo">Seu status</div>
        ${MEU_STATUS.map(s => `
          <button type="button" class="chat-menu-item${estado.eu.status === s.valor ? ' chat-menu-item--ativo' : ''}" data-acao="definir-status" data-status="${s.valor}">
            <span class="chat-presenca chat-presenca--${s.estado} chat-presenca--solta"></span>
            <span class="chat-menu-textos"><strong>${s.rotulo}</strong><small>${escapar(s.dica)}</small></span>
            ${estado.eu.status === s.valor ? '<i class="fas fa-check"></i>' : ''}
          </button>`).join('')}
        <div class="chat-menu-recado">
          <label class="ctl-rotulo" for="chatRecado">Recado (aparece para todos)</label>
          <input id="chatRecado" class="ctl-campo chat-campo" data-chat="recado" maxlength="120" value="${escapar(estado.eu.mensagem || '')}" placeholder="Ex.: Em reunião até as 15h" autocomplete="off">
          <div class="chat-linha-direita">
            ${estado.eu.mensagem ? '<button type="button" class="ctl-botao ctl-botao--pequeno btn-neutral" data-acao="limpar-recado">Limpar</button>' : ''}
            <button type="button" class="ctl-botao ctl-botao--pequeno btn-primary" data-acao="salvar-recado">Salvar recado</button>
          </div>
        </div>
      </div>`;
  }

  async function gravarStatus({ status = estado.eu.status, mensagem = estado.eu.mensagem } = {}) {
    try {
      const r = await api('/status', { method: 'PUT', body: { status, mensagem } });
      estado.eu.status = r.status;
      estado.eu.mensagem = r.mensagem;
      fecharFlutuante();
      pintarEu();
    } catch (err) {
      toast(err.message || 'Não foi possível mudar o status.');
    }
  }

  // ================================================================ ações

  async function criarConversa() {
    const n = estado.novo;
    const membros = [...n.escolhidos].map(Number);
    if (n.tipo === 'grupo' && !membros.length) return toast('Escolha quem participa do grupo.');
    if (n.tipo === 'canal' && n.nome.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return toast('Dê um nome ao canal.');
    try {
      const r = await api('/conversas', { method: 'POST', body: { tipo: n.tipo, nome: n.nome, descricao: n.descricao, membros } });
      estado.novo = { tipo: 'direta', escolhidos: new Set(), busca: '', nome: '', descricao: '' };
      await recarregarConversas();
      if (n.tipo === 'canal') recarregarCanais();
      await abrirConversa(r.id);
    } catch (err) {
      toast(err.message || 'Não foi possível criar.');
    }
  }

  async function entrarNoCanal(id) {
    try {
      await api(`/conversas/${id}/entrar`, { method: 'POST', body: {} });
      await recarregarConversas();
      recarregarCanais();
      await abrirConversa(id);
    } catch (err) {
      toast(err.message || 'Não foi possível entrar no canal.');
    }
  }

  async function mudarPreferencia(campo) {
    const c = conversa(estado.aberta);
    if (!c) return;
    const valor = !c[campo];
    c[campo] = valor;
    estado.conversas = ordenarConversas(estado.conversas);
    pintar({ cabecalho: true, lateral: true });
    atualizarContador();
    try {
      await api(`/conversas/${c.id}/preferencias`, { method: 'PUT', body: { [campo]: valor } });
    } catch (err) {
      c[campo] = !valor;
      estado.conversas = ordenarConversas(estado.conversas);
      pintar({ cabecalho: true, lateral: true });
      atualizarContador();
      toast(err.message || 'Não foi possível salvar.');
    }
  }

  async function salvarNome() {
    const c = conversa(estado.aberta);
    if (!c) return;
    const nome = parte('det-nome')?.value || '';
    const descricao = parte('det-descricao')?.value ?? c.descricao;
    try {
      await api(`/conversas/${c.id}`, { method: 'PUT', body: { nome, descricao } });
      await recarregarConversas();
      toast('Salvo.', 'success');
    } catch (err) {
      toast(err.message || 'Não foi possível salvar.');
    }
  }

  async function adicionarMembros() {
    const c = conversa(estado.aberta);
    const membros = [...estado.detalhes.escolhidos].map(Number);
    if (!c) return;
    if (!membros.length) return toast('Escolha quem entra.');
    try {
      await api(`/conversas/${c.id}/membros`, { method: 'POST', body: { membros } });
      estado.detalhes = { escolhidos: new Set(), busca: '' };
      await carregarMembros(c.id);
      await recarregarConversas();
    } catch (err) {
      toast(err.message || 'Não foi possível adicionar.');
    }
  }

  async function sairDaConversa() {
    const c = conversa(estado.aberta);
    if (!c) return;
    const onde = c.tipo === 'canal' ? `do canal #${c.nome}` : `do grupo ${c.nome || ''}`.trim();
    const ok = await window.DialogPadrao?.confirm?.({
      title: `Sair ${onde}`,
      tom: 'aviso',
      icone: 'fa-right-from-bracket',
      message: c.tipo === 'canal'
        ? 'Você para de receber as mensagens. Dá para voltar quando quiser, em "Explorar canais".'
        : 'Você para de receber as mensagens. Para voltar, alguém do grupo precisa chamar você de novo.',
      confirmText: 'Sair',
      cancelText: 'Cancelar',
      confirmVariant: 'danger'
    });
    if (!ok) return;
    try {
      await api(`/conversas/${c.id}/sair`, { method: 'POST', body: {} });
      estado.aberta = null;
      estado.visao = 'vazio';
      await recarregarConversas();
      recarregarCanais();
      pintarPrincipal();
    } catch (err) {
      toast(err.message || 'Não foi possível sair.');
    }
  }

  async function arquivar() {
    const c = conversa(estado.aberta);
    if (!c) return;
    const ok = await window.DialogPadrao?.confirm?.({
      title: c.tipo === 'canal' ? `Arquivar o canal #${c.nome}` : `Arquivar o grupo ${c.nome || ''}`.trim(),
      tom: 'erro',
      icone: 'fa-box-archive',
      message: 'A conversa some da lista de todos os participantes e ninguém mais escreve nela. As mensagens continuam guardadas.',
      confirmText: 'Arquivar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger'
    });
    if (!ok) return;
    try {
      await api(`/conversas/${c.id}/arquivar`, { method: 'POST', body: {} });
      estado.aberta = null;
      estado.visao = 'vazio';
      await recarregarConversas();
      recarregarCanais();
      pintarPrincipal();
    } catch (err) {
      toast(err.message || 'Não foi possível arquivar.');
    }
  }

  /** Abre a ficha citada — o mesmo caminho dos avisos do sino. */
  async function abrirReferencia(tipo, id) {
    const item = estado.refs.get(chaveRef(tipo, id));
    if (item?.sem_acesso) return toast('Seu perfil não dá acesso a este registro.');
    if (item?.nao_encontrado) return toast('Este registro não existe mais.');
    const numero = Number(id);
    fecharPainel();
    try {
      if (tipo === 'tarefa') {
        if (window.TarefasUI?.abrirEditor) window.TarefasUI.abrirEditor({ id: numero, aba: 'detalhes' });
        else await window.loadPage?.('tarefas');
        return;
      }
      const pagina = PAGINA_REF[tipo];
      await window.loadPage?.(pagina);
      if (document.getElementById('content')?.dataset.activePage !== pagina) return toast('Você não tem acesso a este módulo.');
      if (tipo === 'pedido') window.PedidosModulo?.abrirVisualizar?.(numero);
      else if (tipo === 'orcamento') window.OrcamentosModulo?.abrirVisualizar?.(numero);
      else if (tipo === 'produto') window.ProdutosModulo?.abrirVisualizar?.(numero);
      else if (tipo === 'cliente') window.ClientesModulo?.abrirDetalhes?.({ id: numero });
      else if (tipo === 'contato') window.ContatosModulo?.abrirDetalhes?.({ id: numero });
      else if (tipo === 'prospeccao') window.ProspeccoesModulo?.abrirDetalhes?.({ id: numero });
    } catch (err) {
      console.error('[chat] não foi possível abrir a citação:', err);
      toast('Não foi possível abrir este registro.');
    }
  }

  function abrirLink(url) {
    if (!/^https?:\/\//i.test(url)) return;
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  }

  // ================================================================ eventos da tela

  function aoClicar(e) {
    const alvo = e.target.closest('[data-acao]');
    if (!alvo || !raiz.contains(alvo)) return;
    const acao = alvo.dataset.acao;
    const id = alvo.dataset.id;
    if (acao === 'link') e.preventDefault();
    switch (acao) {
      case 'alternar': return alternarPainel();
      case 'fechar': return fecharPainel();
      case 'expandir': return alternarTamanho();
      case 'tentar-de-novo':
        return carregarResumo().then(ok => {
          if (ok) {
            conectar();
            pintarTudo();
          } else pintarPrincipal();
        });
      case 'status': return abrirFlutuante('status', alvo);
      case 'definir-status': return gravarStatus({ status: alvo.dataset.status });
      case 'salvar-recado': return gravarStatus({ mensagem: parte('recado')?.value || '' });
      case 'limpar-recado': return gravarStatus({ mensagem: '' });
      case 'secao': {
        const s = alvo.dataset.secao;
        if (estado.secoesFechadas.has(s)) estado.secoesFechadas.delete(s);
        else estado.secoesFechadas.add(s);
        guardarSecoes();
        return pintarLateral();
      }
      case 'abrir-conversa': return abrirConversa(id);
      case 'abrir-pessoa': return abrirComPessoa(id);
      case 'nova':
        estado.novo = { tipo: alvo.dataset.tipo || 'direta', escolhidos: new Set(), busca: '', nome: '', descricao: '' };
        estado.visao = 'novo';
        pintarPrincipal();
        pintarLateral();
        return setTimeout(() => (parte('novo-nome') || parte('novo-busca'))?.focus(), 30);
      case 'novo-tipo':
        estado.novo.tipo = alvo.dataset.tipo;
        return pintarPrincipal();
      case 'marcar-pessoa': return marcarPessoa(id);
      case 'criar': return criarConversa();
      case 'explorar-canais':
        estado.visao = 'canais';
        estado.canaisBusca = '';
        pintarPrincipal();
        pintarLateral();
        recarregarCanais();
        return setTimeout(() => parte('canais-busca')?.focus(), 30);
      case 'entrar-canal': return entrarNoCanal(id);
      case 'voltar': return voltar();
      case 'voltar-conversa':
        estado.visao = 'conversa';
        return pintarPrincipal();
      case 'detalhes': {
        const c = conversa(estado.aberta);
        salvarRascunho();
        estado.visao = 'detalhes';
        estado.detalhes = { escolhidos: new Set(), busca: '' };
        pintarPrincipal();
        if (c && c.tipo !== 'direta') carregarMembros(c.id);
        return undefined;
      }
      case 'fixar': return mudarPreferencia('fixada');
      case 'silenciar': return mudarPreferencia('silenciada');
      case 'salvar-nome': return salvarNome();
      case 'adicionar-membros': return adicionarMembros();
      case 'sair': return sairDaConversa();
      case 'arquivar': return arquivar();
      case 'mais-antigas': return carregarAnteriores();
      case 'ir-fim': {
        const el = parte('mensagens');
        if (el) el.scrollTop = el.scrollHeight;
        alvo.classList.add('hidden');
        return marcarComoLida();
      }
      case 'ir-para': return irPara(id);
      case 'responder': return comecarResposta(id);
      case 'editar': return comecarEdicao(id);
      case 'apagar': return apagar(id);
      case 'reagir': return abrirFlutuante('reagir', alvo, { mensagemId: Number(id) });
      case 'reacao': return reagir(id, alvo.dataset.emoji);
      case 'emojis': return abrirFlutuante('inserir', alvo);
      case 'emoji': {
        const f = estado.flutuante;
        fecharFlutuante();
        if (f?.modo === 'reagir') return reagir(f.mensagemId, alvo.dataset.emoji);
        return inserirNoCursor(alvo.dataset.emoji, { comEspaco: false });
      }
      case 'enviar': return enviar();
      case 'inserir-mencao': return inserirNoCursor('@');
      case 'inserir-referencia': return inserirNoCursor('#');
      case 'cancelar-contexto': return cancelarContexto();
      case 'escolher': return escolher(Number(alvo.dataset.indice));
      case 'escolha-tipo':
        if (!estado.escolha) return undefined;
        estado.escolha.tipo = alvo.dataset.tipo || '';
        estado.escolha.carregando = true;
        estado.escolha.itens = [];
        pintarEscolha();
        parte('texto')?.focus();
        return buscarReferencias();
      case 'ref': return abrirReferencia(alvo.dataset.refTipo, alvo.dataset.refId);
      case 'link': return abrirLink(alvo.dataset.url);
      case 'aviso': {
        const conversaId = alvo.dataset.conversa;
        alvo.closest('.chat-aviso')?.remove();
        return abrir({ conversaId });
      }
      case 'fechar-aviso':
        e.stopPropagation();
        return alvo.closest('.chat-aviso')?.remove();
      default:
        return undefined;
    }
  }

  function marcarPessoa(id) {
    const conjunto = estado.visao === 'detalhes' ? estado.detalhes.escolhidos : estado.novo.escolhidos;
    const chave = String(id);
    if (conjunto.has(chave)) conjunto.delete(chave);
    else conjunto.add(chave);
    if (estado.visao === 'detalhes') {
      const lista = parte('det-pessoas');
      const topo = lista?.scrollTop || 0;
      pintarPrincipal();
      const nova = parte('det-pessoas');
      if (nova) nova.scrollTop = topo;
    } else {
      const lista = parte('novo-pessoas');
      const topo = lista?.scrollTop || 0;
      pintarPrincipal();
      const nova = parte('novo-pessoas');
      if (nova) nova.scrollTop = topo;
    }
  }

  function aoDigitarEmCampo(e) {
    const nome = e.target?.dataset?.chat;
    if (!nome) return;
    if (nome === 'busca') {
      estado.busca = e.target.value;
      pintarLateral();
    } else if (nome === 'texto') {
      aoMudarTexto();
    } else if (nome === 'novo-busca') {
      estado.novo.busca = e.target.value;
      const lista = parte('novo-pessoas');
      if (lista) lista.innerHTML = htmlEscolherPessoas(pessoasDoNovo(), estado.novo.escolhidos, { umSo: estado.novo.tipo === 'direta' });
    } else if (nome === 'novo-nome') {
      estado.novo.nome = e.target.value;
    } else if (nome === 'novo-descricao') {
      estado.novo.descricao = e.target.value;
    } else if (nome === 'canais-busca') {
      estado.canaisBusca = e.target.value;
      pintarListaDeCanais();
    } else if (nome === 'det-busca') {
      estado.detalhes.busca = e.target.value;
      const c = conversa(estado.aberta);
      const dentro = new Set((estado.membros.get(c?.id) || []).map(m => String(m.usuario_id)));
      const termo = comparavel(e.target.value);
      const fora = ordenarPessoas([...estado.pessoas.values()].filter(p => !dentro.has(String(p.id)) && (!termo || comparavel(p.nome).includes(termo))));
      const lista = parte('det-pessoas');
      if (lista) lista.innerHTML = htmlEscolherPessoas(fora, estado.detalhes.escolhidos);
    }
  }

  function aoTeclar(e) {
    const ta = parte('texto');
    if (e.target === ta) {
      const lista = estado.escolha?.itens || [];
      if (estado.escolha && lista.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const passo = e.key === 'ArrowDown' ? 1 : -1;
          estado.escolha.indice = (estado.escolha.indice + passo + lista.length) % lista.length;
          pintarEscolha();
          return;
        }
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
          e.preventDefault();
          escolher(estado.escolha.indice);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (estado.escolha) return fecharEscolha();
        if (estado.flutuante) return fecharFlutuante();
        if (estado.editando || estado.resposta) return cancelarContexto();
        return fecharPainel();
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        enviar();
        return;
      }
      if (e.key === 'ArrowUp' && !ta.value && !estado.editando) {
        const minhas = (estado.mensagens.get(Number(estado.aberta))?.lista || []).filter(m => ehEu(m.autor_id) && m.tipo === 'texto' && !m.apagada);
        if (minhas.length) {
          e.preventDefault();
          comecarEdicao(minhas[minhas.length - 1].id);
        }
      }
      return;
    }
    if (e.key === 'Enter' && e.target?.dataset?.chat === 'recado') {
      e.preventDefault();
      gravarStatus({ mensagem: e.target.value });
      return;
    }
    if (e.key === 'Enter' && ['novo-nome', 'novo-descricao'].includes(e.target?.dataset?.chat)) {
      e.preventDefault();
      criarConversa();
      return;
    }
    if (e.key === 'Escape' && estado.painelAberto) {
      e.preventDefault();
      e.stopPropagation();
      if (estado.flutuante) return fecharFlutuante();
      if (['novo', 'canais'].includes(estado.visao)) return voltar();
      if (estado.visao === 'detalhes') {
        estado.visao = 'conversa';
        return pintarPrincipal();
      }
      fecharPainel();
    }
  }

  function aoApertar(e) {
    // A lista do @/# não pode tirar o foco da caixa de escrever.
    if (e.target.closest?.('[data-chat="escolha"]')) e.preventDefault();
    if (estado.flutuante && !e.target.closest?.('[data-chat="flutuante"]') && !e.target.closest?.('[data-acao="status"],[data-acao="reagir"],[data-acao="emojis"]')) {
      fecharFlutuante();
    }
  }

  function aoRolarMensagens(e) {
    const el = e.target;
    if (!el?.matches?.('[data-chat="mensagens"]')) return;
    if (el.scrollTop < 60) carregarAnteriores();
    if (pertoDoFim(el)) {
      parte('ir-fim')?.classList.add('hidden');
      marcarComoLida();
    }
  }

  // ================================================================ lido

  let ultimaLidaEnviada = 0;
  function marcarComoLida() {
    const c = conversa(estado.aberta);
    if (!c || !estado.painelAberto || estado.visao !== 'conversa') return;
    if (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus())) return;
    if (!pertoDoFim()) return;
    const lista = estado.mensagens.get(c.id)?.lista || [];
    const ultimo = lista.length ? lista[lista.length - 1].id : 0;
    const mudouContagem = Number(c.nao_lidas) || Number(c.mencoes);
    c.nao_lidas = 0;
    c.mencoes = 0;
    if (mudouContagem) {
      atualizarContador();
      pintar({ lateral: true });
    }
    if (!ultimo || ultimo <= (Number(c.lida_ate_id) || 0) || ultimo === ultimaLidaEnviada) return;
    c.lida_ate_id = ultimo;
    ultimaLidaEnviada = ultimo;
    api(`/conversas/${c.id}/lida`, { method: 'POST', body: { ate: ultimo } }).catch(() => { ultimaLidaEnviada = 0; });
  }

  function estouVendo(conversaId) {
    return estado.painelAberto && estado.visao === 'conversa' && String(estado.aberta) === String(conversaId) &&
      !document.hidden && (typeof document.hasFocus !== 'function' || document.hasFocus());
  }

  // ================================================================ avisos

  function lerPreferenciasDeSom() {
    const avisosWindows = window.electronAPI?.avisosWindows;
    if (!avisosWindows) return;
    Promise.resolve(avisosWindows.lerPreferencias?.())
      .then(p => {
        estado.som.ligado = p?.som !== false;
        estado.som.arquivo = p?.somArquivo || null;
      })
      .catch(() => {});
    avisosWindows.onPreferencias?.(p => { estado.som.ligado = p?.som !== false; });
  }

  function tocarSom() {
    if (!estado.som.ligado) return;
    const agora = Date.now();
    if (agora - estado.ultimoSom < 2000) return;
    estado.ultimoSom = agora;
    window.SomAviso?.tocar?.({ arquivo: estado.som.arquivo });
  }

  function tituloDoAviso(c, m) {
    const autor = nomeDe(m.autor_id);
    if (c.tipo === 'canal') return `${autor} em #${c.nome}`;
    if (c.tipo === 'grupo') return `${autor} em ${c.nome || 'grupo'}`;
    return autor;
  }

  /** Mensagem nova de outra pessoa: aviso no canto (programa na frente) ou do Windows. */
  function avisar(c, m) {
    const mencionou = (m.mencoes || []).map(String).includes(String(estado.eu.id));
    if (estado.eu.status === 'ocupado') return;
    if (c.silenciada && !mencionou) return;
    const texto = textoCurto(m.texto, contexto()).slice(0, 180);
    const naFrente = !document.hidden && (typeof document.hasFocus !== 'function' || document.hasFocus());
    if (naFrente) {
      if (!(estado.painelAberto && String(estado.aberta) === String(c.id) && estado.visao === 'conversa')) mostrarAviso(c, m, texto, mencionou);
      tocarSom();
      return;
    }
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return;
    try {
      const n = new Notification(tituloDoAviso(c, m), { body: (mencionou ? 'Mencionou você: ' : '') + texto, tag: `sd-chat-${c.id}` });
      n.onclick = () => {
        try { window.focus(); } catch (_) { /* segue */ }
        abrir({ conversaId: c.id });
        n.close();
      };
    } catch (err) {
      console.warn('[chat] notificação do Windows indisponível.', err);
    }
  }

  function mostrarAviso(c, m, texto, mencionou) {
    const pilha = parte('avisos');
    if (!pilha) return;
    pilha.querySelector(`[data-conversa="${c.id}"]`)?.closest('.chat-aviso')?.remove();
    const autor = pessoa(m.autor_id) || { id: m.autor_id, nome: 'Alguém' };
    const aviso = document.createElement('div');
    aviso.className = `chat-aviso${mencionou ? ' chat-aviso--mencao' : ''}`;
    aviso.innerHTML = `
      <button type="button" class="chat-aviso-corpo" data-acao="aviso" data-conversa="${c.id}">
        ${avatarHtml(autor, { tamanho: 36 })}
        <span class="chat-aviso-textos">
          <strong>${escapar(tituloDoAviso(c, m))}</strong>
          <span>${mencionou ? '<em>mencionou você:</em> ' : ''}${escapar(texto)}</span>
        </span>
      </button>
      <button type="button" class="chat-icone chat-icone--pequeno chat-aviso-fechar" data-acao="fechar-aviso" title="Dispensar"><i class="fas fa-times"></i></button>`;
    pilha.prepend(aviso);
    while (pilha.children.length > 3) pilha.lastElementChild.remove();
    setTimeout(() => aviso.remove(), 7000);
  }

  function limparAvisos() {
    const pilha = parte('avisos');
    if (pilha) pilha.innerHTML = '';
  }

  // ================================================================ ao vivo

  const relogiosDigitando = new Map();

  function aoChegarMensagem({ conversa_id: conversaId, mensagem: m }) {
    if (!m) return;
    const id = Number(conversaId);
    const minha = ehEu(m.autor_id);
    const cache = estado.mensagens.get(id);
    if (cache?.carregada && !cache.lista.some(x => x.id === m.id)) {
      cache.lista.push(m);
      cache.lista.sort((a, b) => a.id - b.id);
    }
    pararDigitando(id, m.autor_id);
    resolverRefsDe([m]);
    const c = conversa(id);
    if (!c) {
      // Conversa nova (alguém me chamou): relê a lista e avisa.
      recarregarConversas().then(() => {
        const nova = conversa(id);
        if (nova && !minha) {
          nova.nao_lidas = Math.max(1, Number(nova.nao_lidas) || 0);
          atualizarContador();
          avisar(nova, m);
        }
      });
      return;
    }
    c.ultima = { id: m.id, autor_id: m.autor_id, tipo: m.tipo, em: m.criado_em, texto: m.texto, apagada: false };
    c.atualizada_em = m.criado_em;
    estado.conversas = ordenarConversas(estado.conversas);
    if (minha) {
      c.lida_ate_id = Math.max(Number(c.lida_ate_id) || 0, m.id);
    } else if (estouVendo(id) && pertoDoFim()) {
      // Na tela: lido na hora.
    } else {
      c.nao_lidas = (Number(c.nao_lidas) || 0) + 1;
      if ((m.mencoes || []).map(String).includes(String(estado.eu.id))) c.mencoes = (Number(c.mencoes) || 0) + 1;
      if (estouVendo(id)) parte('ir-fim')?.classList.remove('hidden');
    }
    if (String(estado.aberta) === String(id) && estado.visao === 'conversa') {
      pintarMensagens();
      marcarComoLida();
    }
    if (!minha && m.tipo === 'texto') avisar(c, m);
    pintar({ lateral: true });
    atualizarContador();
  }

  function aoAtualizarMensagem({ mensagem: m }) {
    trocarMensagem(m);
  }

  function aoLer({ conversa_id: conversaId, usuario_id: usuarioId, ate }) {
    const c = conversa(conversaId);
    if (!c) return;
    if (ehEu(usuarioId)) {
      // Li em outro computador.
      c.lida_ate_id = Math.max(Number(c.lida_ate_id) || 0, Number(ate) || 0);
      if (c.ultima && Number(ate) >= c.ultima.id) {
        c.nao_lidas = 0;
        c.mencoes = 0;
      }
      atualizarContador();
      pintar({ lateral: true });
      return;
    }
    if (c.tipo === 'direta') {
      c.outro_lida_ate_id = Math.max(Number(c.outro_lida_ate_id) || 0, Number(ate) || 0);
      if (String(estado.aberta) === String(c.id)) pintar({ mensagens: true });
    }
    const membros = estado.membros.get(c.id);
    const m = membros?.find(x => String(x.usuario_id) === String(usuarioId));
    if (m) m.lida_ate_id = Math.max(Number(m.lida_ate_id) || 0, Number(ate) || 0);
  }

  function aoDigitarAlguem({ conversa_id: conversaId, usuario_id: usuarioId }) {
    if (ehEu(usuarioId)) return;
    const id = Number(conversaId);
    if (!estado.digitando.has(id)) estado.digitando.set(id, new Map());
    const chave = `${id}:${usuarioId}`;
    clearTimeout(relogiosDigitando.get(chave));
    estado.digitando.get(id).set(String(usuarioId), true);
    relogiosDigitando.set(chave, setTimeout(() => pararDigitando(id, usuarioId), 5000));
    if (String(estado.aberta) === String(id)) pintarDigitando();
    pintar({ lateral: true });
  }

  function pararDigitando(conversaId, usuarioId) {
    const id = Number(conversaId);
    const mapa = estado.digitando.get(id);
    if (!mapa || !mapa.has(String(usuarioId))) return;
    mapa.delete(String(usuarioId));
    clearTimeout(relogiosDigitando.get(`${id}:${usuarioId}`));
    relogiosDigitando.delete(`${id}:${usuarioId}`);
    if (!mapa.size) estado.digitando.delete(id);
    if (String(estado.aberta) === String(id)) pintarDigitando();
    pintar({ lateral: true });
  }

  function aoMudarPresenca(p) {
    const atual = pessoa(p.usuario_id);
    if (!atual) {
      recarregarPessoas();
      return;
    }
    atual.estado = p.estado;
    atual.recado = p.recado;
    atual.visto_em = p.visto_em;
    if (ehEu(p.usuario_id)) pintarEu();
    pintar({ lateral: true, cabecalho: estado.visao === 'conversa' });
  }

  function aoMudarConversa({ conversa_id: conversaId }) {
    if (conversaId && estado.membros.has(Number(conversaId))) carregarMembros(conversaId);
    recarregarConversas();
  }

  function mostrarConexao() {
    const el = parte('conexao');
    if (!el) return;
    el.classList.toggle('hidden', estado.conectado || !estado.disponivel || !estado.jaConectou);
    pintarEu();
  }

  let relogioReconexao = null;
  function conectar() {
    if (estado.fonte || !estado.base || !estado.disponivel || typeof EventSource === 'undefined') return;
    clearTimeout(relogioReconexao);
    let fonte;
    try {
      fonte = new EventSource(new URL('/api/chat/eventos', estado.base).toString());
    } catch (err) {
      console.warn('[chat] ao vivo indisponível:', err);
      return;
    }
    estado.fonte = fonte;
    const ouvir = (nome, fn) => fonte.addEventListener(nome, e => {
      try {
        fn(JSON.parse(e.data || '{}'));
      } catch (err) {
        console.error(`[chat] evento ${nome}:`, err);
      }
    });
    ouvir('pronto', () => {
      const reconectou = estado.jaConectou;
      estado.conectado = true;
      estado.jaConectou = true;
      estado.tentativas = 0;
      mostrarConexao();
      // Parado há mais de 5 min quando a conexão voltou: continua Ausente.
      if (!estado.ativo) avisarAtividade(false);
      if (reconectou) {
        recarregarConversas();
        recarregarPessoas();
        if (estado.aberta) buscarNovas(estado.aberta);
      }
    });
    ouvir('mensagem', aoChegarMensagem);
    ouvir('mensagem_atualizada', aoAtualizarMensagem);
    ouvir('lida', aoLer);
    ouvir('digitando', aoDigitarAlguem);
    ouvir('conversa', aoMudarConversa);
    ouvir('canais', () => recarregarCanais());
    ouvir('presenca', aoMudarPresenca);
    fonte.onerror = () => {
      estado.conectado = false;
      mostrarConexao();
      // Fechou de vez (resposta de erro, não uma queda): tenta de novo mais tarde.
      if (fonte.readyState === 2) {
        fonte.close();
        if (estado.fonte === fonte) estado.fonte = null;
        estado.tentativas += 1;
        const espera = Math.min(60000, 5000 * estado.tentativas);
        relogioReconexao = setTimeout(conectar, espera);
      }
    };
  }

  function desconectar() {
    clearTimeout(relogioReconexao);
    if (estado.fonte) estado.fonte.close();
    estado.fonte = null;
    estado.conectado = false;
  }

  /** De 20 em 20 s: sem o ao vivo, pergunta; com ele, só confere o "visto há" e a sessão. */
  let voltas = 0;
  async function rotina() {
    voltas += 1;
    if (!estado.disponivel) {
      // A cada 2 minutos tenta de novo (o SQL ou a API nova podem ter chegado).
      if (voltas % 6 === 0) {
        const ok = await carregarResumo();
        if (ok) conectar();
      }
      return;
    }
    if (!estado.conectado) {
      await recarregarConversas();
      if (estado.aberta && estado.visao === 'conversa') await buscarNovas(estado.aberta);
      if (voltas % 3 === 0) recarregarPessoas();
      if (!estado.fonte) conectar();
    } else if (voltas % 6 === 0) {
      // Conferência de 2 em 2 minutos: corrige qualquer evento perdido.
      recarregarConversas();
    }
    if (estado.painelAberto && estado.visao === 'conversa') pintar({ cabecalho: true });
    if (estado.painelAberto && voltas % 3 === 0) pintar({ lateral: true });
  }

  // ================================================================ presença

  function avisarAtividade(ativo) {
    if (!estado.disponivel) return;
    api('/presenca', { method: 'POST', body: { ativo } }).catch(() => {});
  }

  function aoMexer() {
    estado.ultimaAtividade = Date.now();
    if (!estado.ativo) {
      estado.ativo = true;
      avisarAtividade(true);
    }
  }

  function ligarAtividade() {
    let ultimoMovimento = 0;
    const leve = () => {
      const agora = Date.now();
      if (agora - ultimoMovimento < 5000) return;
      ultimoMovimento = agora;
      aoMexer();
    };
    ['keydown', 'mousedown', 'wheel', 'touchstart'].forEach(ev => window.addEventListener(ev, aoMexer, { passive: true, capture: true }));
    window.addEventListener('mousemove', leve, { passive: true });
    window.addEventListener('focus', () => {
      aoMexer();
      if (estado.painelAberto) marcarComoLida();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && estado.painelAberto) marcarComoLida();
    });
    setInterval(() => {
      if (estado.ativo && Date.now() - estado.ultimaAtividade > CINCO_MIN) {
        estado.ativo = false;
        avisarAtividade(false);
      }
    }, 30000);
  }

  // ================================================================ seções

  const CHAVE_SECOES = 'chat.secoesFechadas';
  function lerSecoes() {
    try {
      const lista = JSON.parse(window.localStorage?.getItem(CHAVE_SECOES) || '[]');
      if (Array.isArray(lista)) estado.secoesFechadas = new Set(lista.map(String));
    } catch (_) { /* sem preferência guardada */ }
  }
  function guardarSecoes() {
    try {
      window.localStorage?.setItem(CHAVE_SECOES, JSON.stringify([...estado.secoesFechadas]));
    } catch (_) { /* segue sem guardar */ }
  }

  // ================================================================ público

  /** Abre o painel (e a conversa, se vier) — usado pelo sino e pelos avisos. */
  async function abrir({ conversaId } = {}) {
    if (!estado.painelAberto) await abrirPainel();
    if (!conversaId) return;
    if (!conversa(conversaId)) await recarregarConversas();
    if (conversa(conversaId)) await abrirConversa(conversaId);
    else toast('Esta conversa não está mais disponível para você.', 'info');
  }

  async function iniciar() {
    if (raiz) return;
    montar();
    lerSecoes();
    ligarAtividade();
    lerPreferenciasDeSom();
    raiz.addEventListener('scroll', aoRolarMensagens, true);
    window.addEventListener('permissoes:carregadas', mostrarBotao);
    window.addEventListener('beforeunload', desconectar);
    await baseDaApi();
    const ok = await carregarResumo();
    if (ok) conectar();
    setInterval(rotina, 20000);
  }

  window.ChatInterno = {
    ...Puro,
    abrir,
    fechar: fecharPainel,
    iniciar,
    /** Para conferência (testes da tela). */
    get _estado() { return estado; }
  };

  // Depois do Dashboard (o chat não disputa a primeira carga).
  const comecar = () => setTimeout(() => { iniciar().catch(err => console.error('[chat] não iniciou:', err)); }, 1200);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', comecar);
  else comecar();
})();
