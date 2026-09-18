/**
 * Linha do tempo "de rede social" do histórico de Prospecções, Clientes e
 * Tarefas.
 *
 *   const linha = window.HistoricoSocial.montar(alvo, {
 *     origem: 'prospeccao' | 'cliente' | 'tarefa',
 *     registroId,
 *     descrever: item => ({ etiqueta, tom, acao, titulo, campo, antes, depois, riscado, retrato, nota }),
 *     aoCarregar: dados => {},          // ex.: atualizar o contador da aba
 *     foco: { itemId, comentarioId }    // abrir já no comentário do aviso
 *   });
 *   linha.recarregar(); linha.focar({ itemId, comentarioId }); linha.destruir();
 *
 * AGRUPAMENTO (pedido do dono em 18/09/2026): quem mexe muito numa ficha não
 * pode encher o feed de cartões iguais. No mesmo dia, tudo o que tem a mesma
 * etiqueta (Edição, Campanha, Interação…) vira UM cartão: o mais recente em
 * destaque e uma seta que abre os outros, cada um com o seu horário. Dias
 * seguidos da mesma etiqueta viram cascata: aparece o dia mais recente, e a
 * seta abre os anteriores (cada um com a sua data). Observação nunca agrupa.
 *
 * Os comentários do grupo ficam juntos. Na caixa de comentário, "*" cita um
 * registro do grupo (o comentário vai para ele) e "@" menciona um usuário
 * (que recebe o aviso "mencionou você"). As marcas gravadas no texto são
 * @[Nome](u:id) e *[rótulo](e:id) — o backend entende as mesmas.
 *
 * AO VIVO: com a ficha aberta, a linha do tempo pergunta a cada 10 s se há
 * novidade e redesenha sem perder o que se está escrevendo (nem o cursor).
 *
 * Dados: /api/historico-social (backend/historicoSocialController.js).
 * Visual: src/styles/historico-social.css. Nada de innerHTML: todo texto
 * entra por textContent.
 */
(() => {
  if (window.HistoricoSocial) return;

  const COMENTARIOS_VISIVEIS = 3;
  const MAX_ANEXOS_POR_ENVIO = 5;
  const NIVEL_MAXIMO_DE_RECUO = 4;
  const AO_VIVO_MS = 10000;

  // ------------------------------------------------------------ puras

  /** Comentários planos → árvore (respostas dentro de cada um), na ordem em que chegaram. */
  function montarArvore(comentarios = []) {
    const porId = new Map();
    const raizes = [];
    for (const c of comentarios) porId.set(String(c.id), { ...c, respostas: [] });
    for (const c of porId.values()) {
      const pai = c.resposta_de ? porId.get(String(c.resposta_de)) : null;
      (pai ? pai.respostas : raizes).push(c);
    }
    return raizes;
  }

  /** Quantos comentários há numa árvore (o próprio + todas as respostas). */
  const contarNaArvore = no => 1 + (no.respostas || []).reduce((s, r) => s + contarNaArvore(r), 0);

  const doisDigitos = n => String(n).padStart(2, '0');

  /** O dia de um instante no fuso de quem vê ("2026-09-18"). */
  function diaLocal(valor) {
    const d = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(d.getTime())) return String(valor || '').slice(0, 10);
    return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
  }

  const dataBr = dia => (/^\d{4}-\d{2}-\d{2}$/.test(dia) ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : dia);
  const dataCurta = dia => (/^\d{4}-\d{2}-\d{2}$/.test(dia) ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : dia);

  /** "Hoje · 18/09/2026", "Ontem · 17/09/2026" ou a data. */
  function rotuloDoDia(iso, hoje = diaLocal(new Date())) {
    const dia = diaLocal(iso);
    const ontem = diaLocal(new Date(new Date(`${hoje}T12:00:00`).getTime() - 86400000));
    if (dia === hoje) return `Hoje · ${dataBr(dia)}`;
    if (dia === ontem) return `Ontem · ${dataBr(dia)}`;
    return dataBr(dia);
  }

  function horaDe(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
  }

  const dataHora = iso => `${dataBr(diaLocal(iso))} ${horaDe(iso)}`.trim();

  /**
   * Valor de um "antes → depois" pronto para ler: data crua do banco
   * ("2026-08-14", "2026-08-14T03:00:00.000Z", "2026-08-14T15:54") vira
   * "14/08/2026" ou "14/08/2026 15:54". Meia-noite no fuso de quem vê é data
   * pura (coluna DATE que chegou como ISO). O resto passa como veio.
   */
  function valorLegivel(valor) {
    const s = String(valor ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dataBr(s);
    const semFuso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/.exec(s);
    if (semFuso) return `${dataBr(semFuso[1])} ${semFuso[2]}`;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const hora = horaDe(s);
        return hora === '00:00' ? dataBr(diaLocal(d)) : `${dataBr(diaLocal(d))} ${hora}`;
      }
    }
    return s;
  }

  /** "Curtido por Ana", "Ana e Bruno", "Ana, Bruno e mais 2". */
  function quemCurtiu(nomes = []) {
    const lista = nomes.filter(Boolean);
    if (!lista.length) return '';
    if (lista.length === 1) return `Curtido por ${lista[0]}`;
    if (lista.length === 2) return `Curtido por ${lista[0]} e ${lista[1]}`;
    return `Curtido por ${lista[0]}, ${lista[1]} e mais ${lista.length - 2}`;
  }

  /** Primeira e última inicial ("Ana Maria Souza" → "AS"). */
  const iniciais = nome => String(nome || '?').trim().split(/\s+/).filter(Boolean)
    .map((p, i, todos) => (i === 0 || i === todos.length - 1 ? p[0] : '')).join('').toUpperCase().slice(0, 2) || '?';

  /** 1536 → "1,5 KB". */
  function tamanhoLegivel(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`;
    return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  }

  /** O ícone do Font Awesome pelo tipo do arquivo. */
  function iconeDoArquivo(nome = '', tipo = '') {
    const ext = String(nome).toLowerCase().split('.').pop();
    const t = String(tipo).toLowerCase();
    if (t.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic'].includes(ext)) return 'fa-file-image';
    if (t === 'application/pdf' || ext === 'pdf') return 'fa-file-pdf';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'fa-file-excel';
    if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) return 'fa-file-word';
    if (['zip', 'rar', '7z'].includes(ext)) return 'fa-file-archive';
    if (t.startsWith('video/') || ['mp4', 'mov', 'avi'].includes(ext)) return 'fa-file-video';
    if (t.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'fa-file-audio';
    return 'fa-file';
  }

  /** Arquivos escolhidos → quais passam (até 5, até o limite) e o que dizer dos outros. */
  function conferirArquivos(arquivos = [], limiteBytes = 20 * 1024 * 1024) {
    const aceitos = [];
    const recusados = [];
    for (const a of arquivos) {
      if (aceitos.length >= MAX_ANEXOS_POR_ENVIO) recusados.push(`${a.name}: no máximo ${MAX_ANEXOS_POR_ENVIO} arquivos por vez`);
      else if (!a.size) recusados.push(`${a.name}: arquivo vazio`);
      else if (a.size > limiteBytes) recusados.push(`${a.name}: passa de ${tamanhoLegivel(limiteBytes)}`);
      else aceitos.push(a);
    }
    return { aceitos, recusados };
  }

  // ------------------------------------------------------------ agrupamento (puro)

  /**
   * Itens → dias com grupos, do mais novo para o mais antigo.
   * `etiquetaDe(item)` diz o que agrupa (null = não agrupa, como a observação).
   *
   *  1. No mesmo dia, a mesma etiqueta vira UM grupo, no lugar do mais recente.
   *  2. Cascata: um grupo que vem logo em seguida (no feed) de outro com a mesma
   *     etiqueta, de um dia mais novo, entra nos `anteriores` dele — aparece o
   *     dia mais recente e a seta abre os de antes. Qualquer outro cartão no
   *     meio quebra a cascata: o feed nunca muda de ordem.
   *
   * A chave do grupo é o dia + a etiqueta (não o id do item mais novo): um
   * registro que chega depois muda a cabeça do grupo, mas não fecha a lista
   * aberta nem perde o comentário que alguém estava escrevendo nele.
   */
  function agrupar(itens = [], etiquetaDe = () => null) {
    const ordenados = [...itens].sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em) || Number(b.id) - Number(a.id));
    const dias = [];
    let dia = null;
    for (const item of ordenados) {
      const d = diaLocal(item.criado_em);
      if (!dia || dia.dia !== d) {
        dia = { dia: d, grupos: [], porEtiqueta: new Map() };
        dias.push(dia);
      }
      const etiqueta = etiquetaDe(item) || null;
      if (etiqueta && dia.porEtiqueta.has(etiqueta)) {
        dia.porEtiqueta.get(etiqueta).itens.push(item);
        continue;
      }
      const grupo = { chave: etiqueta ? `g:${d}:${etiqueta}` : `i:${item.id}`, etiqueta, dia: d, itens: [item], anteriores: [] };
      if (etiqueta) dia.porEtiqueta.set(etiqueta, grupo);
      dia.grupos.push(grupo);
    }
    let anterior = null;
    for (const d of dias) {
      d.grupos = d.grupos.filter(g => {
        if (g.etiqueta && anterior && anterior.etiqueta === g.etiqueta && anterior.dia !== g.dia) {
          anterior.anteriores.push(g);
          return false;
        }
        anterior = g;
        return true;
      });
      delete d.porEtiqueta;
    }
    return dias.filter(d => d.grupos.length);
  }

  // ------------------------------------------------------------ menções e citações (puro)

  const MARCAS = /@\[([^\]\n]{1,120})\]\(u:(\d{1,10})\)|\*\[([^\]\n]{1,200})\]\(e:(\d{1,12})\)/g;

  /** Texto do comentário → pedaços: texto, menção (@Nome) e citação (*registro). */
  function pedacosDoTexto(t) {
    const s = String(t ?? '');
    const pedacos = [];
    let ultimo = 0;
    for (const m of s.matchAll(MARCAS)) {
      if (m.index > ultimo) pedacos.push({ tipo: 'texto', texto: s.slice(ultimo, m.index) });
      if (m[1] !== undefined) pedacos.push({ tipo: 'mencao', nome: m[1], id: Number(m[2]) });
      else pedacos.push({ tipo: 'citacao', rotulo: m[3], id: Number(m[4]) });
      ultimo = m.index + m[0].length;
    }
    if (ultimo < s.length) pedacos.push({ tipo: 'texto', texto: s.slice(ultimo) });
    return pedacos;
  }

  /** Só as palavras: "@Ana Souza", "*15:50 Próximo passo". */
  const textoSimples = t => pedacosDoTexto(t).map(p => (p.tipo === 'texto' ? p.texto : p.tipo === 'mencao' ? `@${p.nome}` : `*${p.rotulo}`)).join('');

  /** Os registros citados num texto (na ordem). */
  const citadosNoTexto = t => pedacosDoTexto(t).filter(p => p.tipo === 'citacao').map(p => p.id);

  /**
   * O que a pessoa vê na caixa ("@Ana Souza") → o que se grava
   * ("@[Ana Souza](u:2)"). `refs` são as escolhas feitas na lista de sugestões;
   * o rótulo que ela apagou do texto simplesmente não vira marca.
   */
  function aplicarReferencias(texto, refs = []) {
    let saida = String(texto ?? '');
    const ordenadas = [...refs].sort((a, b) => b.rotulo.length - a.rotulo.length);
    const trocas = [];
    for (const r of ordenadas) {
      const i = saida.indexOf(r.rotulo);
      if (i < 0) continue;
      const chave = ` ${trocas.length} `;
      trocas.push([chave, r.marca]);
      saida = saida.slice(0, i) + chave + saida.slice(i + r.rotulo.length);
    }
    for (const [chave, marca] of trocas) saida = saida.replace(chave, () => marca);
    return saida;
  }

  /** O caminho de volta, para editar: marcas → rótulos + as referências. */
  function paraEdicao(texto) {
    const refs = [];
    const partes = pedacosDoTexto(texto).map(p => {
      if (p.tipo === 'texto') return p.texto;
      const rotulo = p.tipo === 'mencao' ? `@${p.nome}` : `*${p.rotulo}`;
      refs.push({ rotulo, marca: p.tipo === 'mencao' ? `@[${p.nome}](u:${p.id})` : `*[${p.rotulo}](e:${p.id})` });
      return rotulo;
    });
    return { texto: partes.join(''), refs };
  }

  /** O que vem depois do último "@" ou "*" antes do cursor (a busca da sugestão), ou null. */
  function gatilhoNoCursor(texto, cursor) {
    const antes = String(texto ?? '').slice(0, cursor);
    const m = /(^|[\s(])([@*])([^\s@*\n][^@*\n]{0,40})?$/.exec(antes);
    if (!m) return null;
    return { simbolo: m[2], busca: (m[3] || '').trimEnd(), inicio: antes.length - (m[2].length + (m[3] || '').length) };
  }

  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // ------------------------------------------------------------ DOM

  function criar(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = String(texto);
    return el;
  }

  function icone(nome) {
    const i = criar('i', `fas ${nome}`);
    i.setAttribute('aria-hidden', 'true');
    return i;
  }

  /** Coração cheio (curti) ou vazado (ainda não). */
  function iconeCurtida(curti) {
    const i = criar('i', `${curti ? 'fas' : 'far'} fa-heart`);
    i.setAttribute('aria-hidden', 'true');
    return i;
  }

  function botao(classe, conteudo, titulo) {
    const b = criar('button', classe);
    b.type = 'button';
    for (const parte of [].concat(conteudo)) b.append(typeof parte === 'string' ? document.createTextNode(parte) : parte);
    if (titulo) b.title = titulo;
    return b;
  }

  // ------------------------------------------------------------ fotos e pessoas

  let cacheFotos = null;
  let cachePessoas = [];
  let cacheFotosEm = 0;

  /** id → URL da foto (os mesmos campos que o módulo de Usuários usa). Guardado por 5 min. */
  async function carregarFotos(base) {
    if (cacheFotos && Date.now() - cacheFotosEm < 5 * 60 * 1000) return cacheFotos;
    const url = valor => {
      const bruto = String(valor || '').trim();
      if (!bruto) return null;
      if (/^(https?:|data:|blob:|file:)/i.test(bruto)) return bruto;
      return base ? `${base.replace(/\/+$/, '')}${bruto.startsWith('/') ? '' : '/'}${bruto}` : null;
    };
    try {
      const resp = await fetch(`${base}/api/usuarios/lista`);
      const lista = resp.ok ? await resp.json() : [];
      const todos = Array.isArray(lista) ? lista : [];
      cacheFotos = new Map(todos
        .map(u => [String(u.id), url(u.foto_perfil_url || u.foto_perfil || u.fotoPerfil || u.foto_usuario || u.avatar || u.avatar_url || u.avatarUrl)])
        .filter(([, v]) => v));
      // Para o "@": quem tem nome e não está desligado.
      cachePessoas = todos
        .filter(u => u && u.id && String(u.nome || '').trim())
        .filter(u => u.ativo !== false && !/inativ|bloque|desativ|pendente|recusad/i.test(String(u.status || u.situacao || '')))
        .map(u => ({ id: Number(u.id), nome: String(u.nome).trim(), perfil: u.perfil || u.cargo || '' }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      cacheFotosEm = Date.now();
    } catch (_) {
      cacheFotos = cacheFotos || new Map();
    }
    return cacheFotos;
  }

  // ------------------------------------------------------------ montar

  function montar(alvo, opcoes = {}) {
    const { origem, registroId, descrever = () => ({}), aoCarregar = () => {}, colunas = {} } = opcoes;
    // Textos da caixa do topo (a tarefa fala em "comentário ou arquivo", a ficha em "observação").
    const textos = {
      placeholder: 'Escreva uma observação para todos que acompanham esta ficha… (@ menciona alguém · Ctrl+Enter publica)',
      publicar: 'Publicar', publicado: 'Observação publicada.', vazio: 'Nenhum registro no histórico ainda.',
      ...(opcoes.textos || {})
    };
    // Colunas de permissão (data-perm-col) do módulo: quem não pode ver a data,
    // o tipo, o resumo ou quem fez continua sem ver, como na tabela antiga.
    const marcarColuna = (el, chave) => { if (colunas[chave]) el.setAttribute('data-perm-col', colunas[chave]); return el; };
    let dados = null;
    let fotos = new Map();
    let base = '';
    let mostrarExcluidos = false;
    let foco = opcoes.foco || null;
    let assinaturaAtual = '';
    let destruido = false;
    const abertos = new Set();        // grupos com os comentários à mostra
    const expandidos = new Set();     // grupos com TODOS os comentários (sem o "ver mais")
    const listasAbertas = new Set();  // grupos com os outros registros do dia à mostra
    const cascatasAbertas = new Set();// grupos com os dias anteriores à mostra
    let compondo = null;              // { grupo, respostaDe, itemId, nome } — onde está a caixa de comentário
    let editando = null;              // id do comentário em edição
    // Texto, arquivos e referências (@/*) de cada caixa ('obs', 'com:<grupo>',
    // 'resp:<comentário>', 'edit:<comentário>'): curtir outra coisa redesenha a
    // tela — e a atualização ao vivo também —, e o que a pessoa estava
    // escrevendo não pode sumir por isso.
    const rascunhos = new Map();
    const balaoVersoes = criar('div', 'hs-versoes');
    balaoVersoes.setAttribute('role', 'tooltip');
    let gruposNaTela = new Map();     // chave → grupo (do último desenho)

    async function chamar(caminho, { method = 'GET', corpo } = {}) {
      if (!base) base = (await window.apiConfig?.getApiBaseUrl?.()) || '';
      const resp = await fetch(`${base}/api/historico-social/${origem}/${registroId}${caminho}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const e = new Error(json.error || `Erro ${resp.status}`);
        e.status = resp.status;
        e.sql_pendente = Boolean(json.sql_pendente);
        throw e;
      }
      return json;
    }

    const avisar = (texto, tipo = 'error') => window.showToast?.(texto, tipo);

    const descreverItem = item => (item.tipo === 'observacao'
      ? { etiqueta: 'Observação', tom: 'observacao', acao: 'publicou' }
      : (descrever(item) || {}));
    const etiquetaDe = item => (item.tipo === 'observacao' ? null : (descreverItem(item).etiqueta || item.tipo || null));
    /** "Prazo do próximo passo", "Campanha X · Data de envio"… — o nome curto de um registro. */
    const rotuloCurto = item => {
      if (item.tipo === 'observacao') return String(item.observacao || item.valor_novo || 'Observação').slice(0, 60);
      const d = descreverItem(item);
      return [d.titulo, d.campo].filter(Boolean).join(' · ') || d.etiqueta || 'Registro';
    };
    const rotuloDeCitacao = item => `${horaDe(item.criado_em)} ${rotuloCurto(item)}`.slice(0, 120);

    // -------------------------------------------------------- pedaços

    function avatar(usuarioId, nome, { pequeno = false, sistema = false } = {}) {
      const caixa = criar('span', `hs-avatar${pequeno ? ' hs-avatar--p' : ''}${sistema ? ' hs-avatar--sistema' : ''}`);
      if (sistema) {
        caixa.appendChild(icone('fa-gear'));
        caixa.title = 'Sistema';
        return caixa;
      }
      caixa.title = nome || 'Usuário';
      const foto = usuarioId !== null && usuarioId !== undefined ? fotos.get(String(usuarioId)) : null;
      if (foto) {
        const img = document.createElement('img');
        img.src = foto;
        img.alt = nome || '';
        img.loading = 'lazy';
        img.addEventListener('error', () => { img.remove(); caixa.textContent = iniciais(nome); });
        caixa.appendChild(img);
      } else {
        caixa.textContent = iniciais(nome);
        const cor = window.Beneficiarios?.cor?.(nome || '');
        if (cor) caixa.style.background = cor;
      }
      return caixa;
    }

    function linhaDeAnexos(anexos = []) {
      const lista = criar('div', 'hs-anexos');
      for (const a of anexos) {
        const chip = criar('span', 'hs-anexo');
        chip.appendChild(icone(iconeDoArquivo(a.nome, a.tipo)));
        const nome = criar('span', 'hs-anexo__nome', a.nome);
        nome.title = `Abrir ${a.nome}`;
        nome.addEventListener('click', () => baixarAnexo(a, { abrir: true }));
        chip.append(nome, criar('span', 'hs-anexo__tamanho', tamanhoLegivel(a.tamanho)));
        const salvar = botao('hs-anexo__botao', [icone('fa-download')], 'Salvar como…');
        salvar.addEventListener('click', () => baixarAnexo(a, { abrir: false }));
        chip.appendChild(salvar);
        lista.appendChild(chip);
      }
      return lista;
    }

    async function baixarAnexo(anexo, { abrir }) {
      try {
        window.showToast?.(`Baixando ${anexo.nome}…`, 'info');
        const arquivo = await chamar(`/anexos/${anexo.id}`);
        const r = await window.electronAPI?.salvarArquivoBinario?.({ base64: arquivo.base64, nomeSugerido: arquivo.nome, abrir, titulo: 'Salvar anexo' });
        if (r && !r.success && !r.canceled) avisar(r.message || 'Não foi possível abrir o anexo.');
        else if (r?.success && !abrir) avisar('Anexo salvo.', 'success');
      } catch (err) {
        avisar(err.message || 'Não foi possível baixar o anexo.');
      }
    }

    /** Texto de comentário com as menções e citações como etiquetas (sem innerHTML). */
    function textoRico(texto, { aoCitar } = {}) {
      const p = criar('p', 'hs-balao__texto');
      for (const pedaco of pedacosDoTexto(texto)) {
        if (pedaco.tipo === 'texto') p.append(document.createTextNode(pedaco.texto));
        else if (pedaco.tipo === 'mencao') {
          const m = criar('span', 'hs-mencao', `@${pedaco.nome}`);
          m.title = 'Mencionado';
          p.append(m);
        } else {
          const c = botao('hs-citacao', [icone('fa-quote-right'), pedaco.rotulo], 'Ir para o registro citado');
          c.addEventListener('click', () => aoCitar?.(pedaco.id));
          p.append(c);
        }
      }
      return p;
    }

    /**
     * A caixa de escrever (observação, comentário, resposta ou edição).
     * `citaveis()` devolve os registros do grupo que o "*" pode citar.
     */
    function caixaDeTexto({ chave, placeholder, rotulo, textoInicial = '', refsIniciais = [], comAnexo = true, respondendoA = null, citaveis = null, aoEnviar, aoCancelar }) {
      const rascunho = rascunhos.get(chave) || { texto: textoInicial, arquivos: [], refs: [...refsIniciais] };
      rascunhos.set(chave, rascunho);
      const caixa = criar('div', 'hs-compor__campo');
      const campo = criar('textarea', 'hs-texto');
      campo.placeholder = placeholder;
      campo.maxLength = 5000;
      campo.rows = 2;
      campo.value = rascunho.texto;
      campo.dataset.chave = chave;
      campo.addEventListener('input', () => { rascunho.texto = campo.value; atualizarSugestoes(); });
      const escolhidos = rascunho.arquivos;
      const chips = criar('div', 'hs-anexos-escolhidos');
      const seletor = document.createElement('input');
      seletor.type = 'file';
      seletor.multiple = true;
      seletor.hidden = true;

      // ---- sugestões de @ e *
      const sugestoes = criar('div', 'hs-sugestoes');
      sugestoes.setAttribute('role', 'listbox');
      sugestoes.hidden = true;
      let opcoesSug = [];
      let escolhida = 0;
      let gatilho = null;
      const fecharSugestoes = () => { sugestoes.hidden = true; opcoesSug = []; gatilho = null; };
      function atualizarSugestoes() {
        gatilho = gatilhoNoCursor(campo.value, campo.selectionStart);
        if (!gatilho || (gatilho.simbolo === '*' && !citaveis)) { fecharSugestoes(); return; }
        const busca = semAcento(gatilho.busca);
        if (gatilho.simbolo === '@') {
          opcoesSug = cachePessoas
            .filter(p => !busca || semAcento(p.nome).includes(busca))
            .slice(0, 8)
            .map(p => ({ rotulo: `@${p.nome}`, marca: `@[${p.nome}](u:${p.id})`, texto: p.nome, detalhe: p.perfil, usuarioId: p.id }));
        } else {
          opcoesSug = citaveis()
            .filter(it => !busca || semAcento(rotuloDeCitacao(it)).includes(busca))
            .slice(0, 8)
            .map(it => ({ rotulo: `*${rotuloDeCitacao(it)}`, marca: `*[${rotuloDeCitacao(it)}](e:${it.id})`, texto: rotuloCurto(it), detalhe: horaDe(it.criado_em) }));
        }
        if (!opcoesSug.length) { fecharSugestoes(); return; }
        escolhida = Math.min(escolhida, opcoesSug.length - 1);
        pintarSugestoes();
      }
      function pintarSugestoes() {
        sugestoes.replaceChildren(criar('div', 'hs-sugestoes__titulo', gatilho.simbolo === '@' ? 'Mencionar — a pessoa recebe um aviso' : 'Citar um registro deste grupo'));
        opcoesSug.forEach((o, i) => {
          const b = botao(`hs-sugestao${i === escolhida ? ' hs-sugestao--ativa' : ''}`, []);
          b.setAttribute('role', 'option');
          if (o.usuarioId) b.append(avatar(o.usuarioId, o.texto, { pequeno: true }));
          else b.append(criar('span', 'hs-sugestao__hora', o.detalhe));
          b.append(criar('span', 'hs-sugestao__texto', o.texto));
          if (o.usuarioId && o.detalhe) b.append(criar('small', 'hs-sugestao__detalhe', o.detalhe));
          b.addEventListener('mousedown', e => { e.preventDefault(); escolher(i); });
          sugestoes.append(b);
        });
        sugestoes.hidden = false;
      }
      function escolher(i) {
        const o = opcoesSug[i];
        if (!o || !gatilho) return;
        const antes = campo.value.slice(0, gatilho.inicio);
        const depois = campo.value.slice(campo.selectionStart);
        campo.value = `${antes}${o.rotulo} ${depois}`;
        const cursor = (antes + o.rotulo).length + 1;
        campo.setSelectionRange(cursor, cursor);
        rascunho.texto = campo.value;
        if (!rascunho.refs.some(r => r.rotulo === o.rotulo)) rascunho.refs.push({ rotulo: o.rotulo, marca: o.marca });
        fecharSugestoes();
        campo.focus();
      }
      caixa.inserirCitacao = item => {
        const rotuloC = `*${rotuloDeCitacao(item)}`;
        if (!rascunho.refs.some(r => r.rotulo === rotuloC)) rascunho.refs.push({ rotulo: rotuloC, marca: `*[${rotuloDeCitacao(item)}](e:${item.id})` });
        const espaco = campo.value && !/\s$/.test(campo.value) ? ' ' : '';
        campo.value = `${campo.value}${espaco}${rotuloC} `;
        rascunho.texto = campo.value;
        campo.focus();
        campo.setSelectionRange(campo.value.length, campo.value.length);
      };
      campo.addEventListener('click', atualizarSugestoes);
      campo.addEventListener('blur', () => setTimeout(fecharSugestoes, 150));

      const pintarEscolhidos = () => {
        chips.replaceChildren();
        escolhidos.forEach((a, i) => {
          const chip = criar('span', 'hs-anexo');
          chip.append(icone(iconeDoArquivo(a.name, a.type)), criar('span', 'hs-anexo__nome', a.name), criar('span', 'hs-anexo__tamanho', tamanhoLegivel(a.size)));
          const tirar = botao('hs-anexo__botao', [icone('fa-xmark')], 'Tirar este arquivo');
          tirar.addEventListener('click', () => { escolhidos.splice(i, 1); pintarEscolhidos(); });
          chip.appendChild(tirar);
          chips.appendChild(chip);
        });
      };
      pintarEscolhidos();
      seletor.addEventListener('change', () => {
        const { aceitos, recusados } = conferirArquivos([...escolhidos, ...seletor.files], dados?.limite_anexo_bytes);
        escolhidos.splice(0, escolhidos.length, ...aceitos);
        if (recusados.length) avisar(`Arquivo não anexado — ${recusados.join('; ')}`, 'warning');
        seletor.value = '';
        pintarEscolhidos();
      });

      const rodape = criar('div', 'hs-compor__rodape');
      if (respondendoA) {
        const r = criar('span', 'hs-compor__resposta', 'Respondendo a ');
        r.appendChild(criar('strong', '', respondendoA));
        rodape.appendChild(r);
      }
      const botoes = criar('div', 'hs-compor__botoes');
      const inserirGatilho = simbolo => {
        const pos = campo.selectionStart ?? campo.value.length;
        const antes = campo.value.slice(0, pos);
        const espaco = antes && !/\s$/.test(antes) ? ' ' : '';
        campo.value = `${antes}${espaco}${simbolo}${campo.value.slice(pos)}`;
        const cursor = (antes + espaco + simbolo).length;
        campo.focus();
        campo.setSelectionRange(cursor, cursor);
        rascunho.texto = campo.value;
        atualizarSugestoes();
      };
      const mencionar = botao('hs-botao hs-botao--neutro hs-botao--icone', [icone('fa-at')], 'Mencionar alguém (@) — a pessoa recebe um aviso');
      mencionar.addEventListener('click', () => inserirGatilho('@'));
      botoes.appendChild(mencionar);
      if (citaveis && citaveis().length > 1) {
        const citar = botao('hs-botao hs-botao--neutro hs-botao--icone', [icone('fa-quote-right')], 'Citar um registro deste grupo (*)');
        citar.addEventListener('click', () => inserirGatilho('*'));
        botoes.appendChild(citar);
      }
      if (comAnexo) {
        const anexar = botao('hs-botao hs-botao--neutro', [icone('fa-paperclip'), 'Anexar'], `Até ${MAX_ANEXOS_POR_ENVIO} arquivos de até ${tamanhoLegivel(dados?.limite_anexo_bytes || 20971520)}`);
        anexar.addEventListener('click', () => seletor.click());
        botoes.appendChild(anexar);
      }
      if (aoCancelar) {
        const cancelar = botao('hs-botao hs-botao--cancelar', 'Cancelar');
        cancelar.addEventListener('click', () => { rascunhos.delete(chave); aoCancelar(); });
        botoes.appendChild(cancelar);
      }
      const enviar = botao('hs-botao hs-botao--publicar', [icone('fa-paper-plane'), rotulo]);
      enviar.dataset.acaoGerida = 'true';
      const disparar = async () => {
        let texto = aplicarReferencias(campo.value.trim(), rascunho.refs);
        if (!texto && comAnexo && escolhidos.length) texto = escolhidos.length === 1 ? 'Anexou um arquivo' : `Anexou ${escolhidos.length} arquivos`;
        if (!texto) { campo.focus(); return; }
        enviar.disabled = true;
        campo.disabled = true;
        try {
          if (await aoEnviar(texto, escolhidos.slice()) !== false) rascunhos.delete(chave);
        } finally {
          enviar.disabled = false;
          campo.disabled = false;
        }
      };
      enviar.addEventListener('click', disparar);
      campo.addEventListener('keydown', e => {
        if (!sugestoes.hidden && opcoesSug.length) {
          if (e.key === 'ArrowDown') { e.preventDefault(); escolhida = (escolhida + 1) % opcoesSug.length; pintarSugestoes(); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); escolhida = (escolhida - 1 + opcoesSug.length) % opcoesSug.length; pintarSugestoes(); return; }
          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); escolher(escolhida); return; }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharSugestoes(); return; }
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); disparar(); }
        if (e.key === 'Escape' && aoCancelar) { e.preventDefault(); e.stopPropagation(); rascunhos.delete(chave); aoCancelar(); }
      });
      campo.addEventListener('keyup', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) atualizarSugestoes(); });
      botoes.appendChild(enviar);
      rodape.appendChild(botoes);
      const embrulhoCampo = criar('div', 'hs-compor__area');
      embrulhoCampo.append(campo, sugestoes);
      caixa.append(embrulhoCampo, chips, rodape, seletor);
      caixa.focar = () => campo.focus();
      caixa.sugestoesAbertas = () => !sugestoes.hidden;
      return caixa;
    }

    /** Envia os anexos um a um; o que falhar é avisado sem perder o resto. */
    async function enviarAnexos(arquivos, alvoAnexo) {
      const falhas = [];
      for (let i = 0; i < arquivos.length; i++) {
        const a = arquivos[i];
        try {
          if (arquivos.length > 1) window.showToast?.(`Enviando anexo ${i + 1} de ${arquivos.length}…`, 'info');
          const base64 = await new Promise((ok, erro) => {
            const leitor = new FileReader();
            leitor.onload = () => ok(String(leitor.result).split(',')[1] || '');
            leitor.onerror = () => erro(leitor.error);
            leitor.readAsDataURL(a);
          });
          await chamar('/anexos', { method: 'POST', corpo: { ...alvoAnexo, nome: a.name, tipo: a.type, base64 } });
        } catch (err) {
          falhas.push(`${a.name}: ${err.message}`);
        }
      }
      if (falhas.length) avisar(`Anexo não enviado — ${falhas.join('; ')}`);
    }

    /** Leva a tela até um registro (abrindo o grupo, a lista e a cascata onde ele mora). */
    function irParaRegistro(itemId) {
      focar({ itemId });
    }

    // -------------------------------------------------------- comentários

    function desenharComentario(c, grupo, nivel) {
      const bloco = criar('div', 'hs-com');
      bloco.dataset.comentarioId = c.id;
      const linha = criar('div', 'hs-com__linha');
      const balao = criar('div', `hs-balao${c.excluido ? ' hs-balao--removido' : ''}`);
      const topo = criar('div', 'hs-balao__topo');
      topo.appendChild(criar('span', 'hs-nome', c.excluido && !c.texto ? 'Comentário removido' : c.usuario || 'Alguém'));
      const hora = criar('span', 'hs-hora', dataHora(c.criado_em));
      hora.title = new Date(c.criado_em).toLocaleString('pt-BR');
      topo.appendChild(hora);
      // Comentário de um registro que não é o destaque do grupo (e que não o
      // cita no texto): diz sobre qual é.
      const sobre = grupo.itens.length > 1 && String(c.item_id) !== String(grupo.itens[0].id)
        ? grupo.itens.find(it => String(it.id) === String(c.item_id)) : null;
      if (sobre && !citadosNoTexto(c.texto).includes(Number(sobre.id))) {
        const chip = botao('hs-sobre', [icone('fa-reply'), `sobre ${rotuloDeCitacao(sobre)}`], 'Ir para o registro');
        chip.addEventListener('click', () => irParaRegistro(sobre.id));
        topo.appendChild(chip);
      }
      if (c.editado && !c.excluido) {
        const editado = criar('span', 'hs-editado', '(editado)');
        editado.title = `Editado em ${dataHora(c.editado_em)}`;
        if (dados?.eu?.sup_admin && Array.isArray(c.versoes) && c.versoes.length) {
          const info = criar('span', 'hs-info-versoes', 'i');
          info.tabIndex = 0;
          info.setAttribute('aria-label', 'Ver o que estava escrito antes');
          const mostrar = () => {
            balaoVersoes.replaceChildren(criar('h5', '', 'Antes da edição'));
            const ol = criar('ol');
            for (const v of c.versoes) {
              const li = criar('li');
              li.appendChild(criar('span', '', textoSimples(v.texto)));
              li.appendChild(criar('small', '', `até ${dataHora(v.editado_em)}${v.editado_por ? ` · ${v.editado_por}` : ''}`));
              ol.appendChild(li);
            }
            balaoVersoes.appendChild(ol);
            window.Popover?.abrir?.(balaoVersoes, info);
          };
          const esconder = () => window.Popover?.fechar?.(balaoVersoes);
          info.addEventListener('mouseenter', mostrar);
          info.addEventListener('focus', mostrar);
          info.addEventListener('mouseleave', esconder);
          info.addEventListener('blur', esconder);
          editado.appendChild(info);
        }
        topo.appendChild(editado);
      }
      if (c.excluido && dados?.eu?.sup_admin && c.texto) {
        topo.appendChild(criar('span', 'hs-tag hs-tag--perigo', `Removido${c.excluido_por_nome ? ` por ${c.excluido_por_nome}` : ''}`));
      }
      balao.appendChild(topo);

      if (editando === c.id) {
        const inicial = paraEdicao(c.texto || '');
        balao.appendChild(caixaDeTexto({
          chave: `edit:${c.id}`, placeholder: 'Edite o comentário', rotulo: 'Salvar', textoInicial: inicial.texto, refsIniciais: inicial.refs, comAnexo: false,
          citaveis: () => grupo.itens,
          aoCancelar: () => { editando = null; desenhar(); },
          aoEnviar: async texto => {
            try {
              await chamar(`/comentarios/${c.id}`, { method: 'PUT', corpo: { texto } });
              editando = null;
              await recarregar();
              return true;
            } catch (err) { avisar(err.message); return false; }
          }
        }));
      } else if (c.excluido && !c.texto) {
        balao.appendChild(criar('p', 'hs-balao__texto', 'Este comentário foi removido pelo Sup Admin.'));
      } else {
        balao.appendChild(textoRico(c.texto, { aoCitar: irParaRegistro }));
      }
      if (c.anexos?.length) balao.appendChild(linhaDeAnexos(c.anexos));
      linha.append(avatar(c.usuario_id, c.usuario, { pequeno: true }), balao);
      bloco.appendChild(linha);

      if (!c.excluido && editando !== c.id) {
        const acoes = criar('div', 'hs-com__acoes');
        const curtir = botao('hs-acao', [iconeCurtida(c.curti), c.curtidas ? `Curtir · ${c.curtidas}` : 'Curtir']);
        curtir.setAttribute('aria-pressed', String(Boolean(c.curti)));
        curtir.title = quemCurtiu(c.quem_curtiu) || 'Curtir';
        curtir.addEventListener('click', () => alternarCurtida(`/comentarios/${c.id}/curtida`));
        acoes.appendChild(curtir);
        const responder = botao('hs-acao', [icone('fa-reply'), 'Responder']);
        responder.addEventListener('click', () => {
          compondo = { grupo: grupo.chave, respostaDe: c.id, itemId: c.item_id, nome: c.usuario || 'Alguém' };
          abertos.add(grupo.chave);
          desenhar();
        });
        acoes.appendChild(responder);
        if (dados?.eu?.id && String(c.usuario_id) === String(dados.eu.id)) {
          const editar = botao('hs-acao', [icone('fa-pen'), 'Editar']);
          editar.addEventListener('click', () => { editando = c.id; desenhar(); });
          acoes.appendChild(editar);
        }
        if (dados?.eu?.sup_admin) {
          const excluir = botao('hs-acao hs-acao--perigo', [icone('fa-trash'), 'Excluir'], 'Excluir (Sup Admin)');
          excluir.addEventListener('click', () => excluirComentario(c));
          acoes.appendChild(excluir);
        }
        bloco.appendChild(acoes);
      }

      if (compondo && String(compondo.respostaDe) === String(c.id)) {
        const resposta = caixaDeTexto({
          chave: `resp:${c.id}`, placeholder: 'Escreva a resposta… (@ menciona · Ctrl+Enter envia)', rotulo: 'Responder', respondendoA: compondo.nome,
          citaveis: () => grupo.itens,
          aoCancelar: () => { compondo = null; desenhar(); },
          aoEnviar: (texto, arquivos) => comentar(grupo, c.item_id, texto, arquivos, c.id)
        });
        const embrulho = criar('div', 'hs-com__linha');
        embrulho.append(avatar(dados?.eu?.id, dados?.eu?.nome, { pequeno: true }), resposta);
        bloco.appendChild(embrulho);
        requestAnimationFrame(() => resposta.focar());
      }

      if (c.respostas?.length) {
        const respostas = criar('div', `hs-respostas${nivel >= NIVEL_MAXIMO_DE_RECUO ? ' hs-respostas--rasa' : ''}`);
        for (const r of c.respostas) respostas.appendChild(desenharComentario(r, grupo, nivel + 1));
        bloco.appendChild(respostas);
      }
      return bloco;
    }

    const idsDoGrupo = grupo => new Set(grupo.itens.map(it => String(it.id)));

    function desenharComentarios(grupo, caixas) {
      const caixa = criar('div', 'hs-comentarios');
      const ids = idsDoGrupo(grupo);
      const doGrupo = (dados?.comentarios || []).filter(c => ids.has(String(c.item_id)))
        .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em) || Number(a.id) - Number(b.id));
      const arvore = montarArvore(doGrupo);
      const todos = expandidos.has(grupo.chave);
      const visiveis = todos ? arvore : arvore.slice(-COMENTARIOS_VISIVEIS);
      if (!todos && arvore.length > COMENTARIOS_VISIVEIS) {
        const escondidos = arvore.slice(0, arvore.length - COMENTARIOS_VISIVEIS).reduce((s, r) => s + contarNaArvore(r), 0);
        const mais = botao('hs-mais', `Ver mais ${escondidos} comentário${escondidos === 1 ? '' : 's'}`);
        mais.addEventListener('click', () => { expandidos.add(grupo.chave); desenhar(); });
        caixa.appendChild(mais);
      }
      for (const c of visiveis) caixa.appendChild(desenharComentario(c, grupo, 1));
      const cabeca = grupo.itens[0];
      const respondendoAqui = Boolean(compondo?.respostaDe) && compondo.grupo === grupo.chave;
      if (!cabeca.excluido && !respondendoAqui && (compondo?.grupo === grupo.chave || abertos.has(grupo.chave))) {
        const novo = caixaDeTexto({
          chave: `com:${grupo.chave}`,
          placeholder: grupo.itens.length > 1
            ? 'Escreva um comentário… (* cita um registro · @ menciona · Ctrl+Enter envia)'
            : 'Escreva um comentário… (@ menciona alguém · Ctrl+Enter envia)',
          rotulo: 'Comentar',
          citaveis: () => grupo.itens.filter(it => !it.excluido),
          aoEnviar: (texto, arquivos) => {
            // O comentário vai para o registro citado (o primeiro do grupo que
            // aparece no texto); sem citação, para o mais recente.
            const citado = citadosNoTexto(texto).find(id => ids.has(String(id)));
            return comentar(grupo, citado || cabeca.id, texto, arquivos, null);
          }
        });
        caixas.set(grupo.chave, novo);
        const embrulho = criar('div', 'hs-com__linha');
        embrulho.append(avatar(dados?.eu?.id, dados?.eu?.nome, { pequeno: true }), novo);
        caixa.appendChild(embrulho);
        if (compondo?.grupo === grupo.chave && !compondo.respostaDe) requestAnimationFrame(() => novo.focar());
      }
      return caixa;
    }

    // -------------------------------------------------------- evento

    function desenharCorpo(item) {
      const corpo = criar('div', 'hs-corpo');
      if (item.tipo === 'observacao') {
        corpo.appendChild(textoRico(item.observacao || item.valor_novo || '', { aoCitar: irParaRegistro }));
        corpo.lastChild.className = 'hs-texto-livre';
        return corpo;
      }
      const d = descrever(item) || {};
      if (d.titulo) corpo.appendChild(criar('div', 'hs-corpo__titulo', d.titulo));
      if (d.campo) corpo.appendChild(criar('div', 'hs-corpo__campo', d.campo));
      if (d.antes || d.depois) {
        const mud = criar('div', 'hs-mudanca');
        if (d.antes) mud.appendChild(criar('span', 'hs-mudanca__antes', valorLegivel(d.antes)));
        if (d.antes && d.depois && !d.riscado) mud.appendChild(criar('span', 'hs-mudanca__seta', '→'));
        if (d.depois && !d.riscado) mud.appendChild(criar('span', 'hs-mudanca__depois', valorLegivel(d.depois)));
        corpo.appendChild(mud);
      }
      if (Array.isArray(d.retrato) && d.retrato.length) {
        const dl = criar('dl', 'hs-retrato');
        for (const r of d.retrato) {
          const par = criar('div');
          par.append(criar('dt', '', `${r.rotulo}:`), criar('dd', '', r.valor));
          dl.appendChild(par);
        }
        corpo.appendChild(dl);
      }
      if (Array.isArray(d.pendencias) && d.pendencias.length) {
        const ul = criar('ul', 'hs-pendencias');
        for (const p of d.pendencias) ul.appendChild(criar('li', '', p));
        corpo.appendChild(ul);
      }
      if (d.nota) corpo.appendChild(criar('div', 'hs-nota', d.nota));
      return corpo;
    }

    /** Uma linha curta de um registro do grupo: hora, quem (se outra pessoa), o que e antes → depois. */
    function linhaCompacta(item, grupo, caixas) {
      const d = descreverItem(item);
      const li = criar('li', `hs-registro${item.excluido ? ' hs-registro--excluido' : ''}`);
      li.dataset.itemId = item.id;
      li.appendChild(marcarColuna(criar('span', 'hs-registro__hora', horaDe(item.criado_em)), 'data'));
      const cabeca = grupo.itens[0];
      if (String(item.usuario_id) !== String(cabeca.usuario_id)) li.appendChild(marcarColuna(avatar(item.usuario_id, item.usuario, { pequeno: true, sistema: !item.usuario_id }), 'quem'));
      const texto = marcarColuna(criar('span', 'hs-registro__texto'), 'resumo');
      texto.appendChild(criar('strong', '', rotuloCurto(item)));
      if (d.antes || d.depois) {
        texto.appendChild(document.createTextNode(' '));
        if (d.antes) texto.appendChild(criar('span', 'hs-mudanca__antes', valorLegivel(d.antes)));
        if (d.antes && d.depois && !d.riscado) texto.appendChild(criar('span', 'hs-mudanca__seta', '→'));
        if (d.depois && !d.riscado) texto.appendChild(criar('span', 'hs-mudanca__depois', valorLegivel(d.depois)));
      } else if (d.nota) {
        texto.appendChild(criar('span', 'hs-registro__nota', ` — ${d.nota}`));
      }
      texto.title = [rotuloCurto(item), d.antes || d.depois ? `${valorLegivel(d.antes || '—')} → ${valorLegivel(d.depois || '—')}` : '', `${dataHora(item.criado_em)} · ${item.usuario || 'Sistema'}`].filter(Boolean).join('\n');
      li.appendChild(texto);
      const acoes = criar('span', 'hs-registro__acoes');
      const comentarios = (dados?.comentarios || []).filter(c => String(c.item_id) === String(item.id)).length;
      if (comentarios) acoes.appendChild(criar('span', 'hs-registro__conta', `${comentarios} 💬`));
      if (!item.excluido && !dados?.sql_pendente) {
        const citar = botao('hs-registro__botao', [icone('fa-quote-right')], 'Citar este registro num comentário');
        citar.addEventListener('click', () => {
          abertos.add(grupo.chave);
          compondo = { grupo: grupo.chave, respostaDe: null };
          const r = rascunhos.get(`com:${grupo.chave}`) || { texto: '', arquivos: [], refs: [] };
          rascunhos.set(`com:${grupo.chave}`, r);
          desenhar();
          caixasNaTela.get(grupo.chave)?.inserirCitacao(item);
        });
        acoes.appendChild(citar);
      }
      if (dados?.eu?.sup_admin && !item.excluido && !dados?.sql_pendente) {
        const excluir = botao('hs-registro__botao hs-registro__botao--perigo', [icone('fa-trash')], 'Excluir do histórico (Sup Admin)');
        excluir.addEventListener('click', () => excluirEvento(item));
        acoes.appendChild(excluir);
      }
      li.appendChild(acoes);
      return li;
    }

    const faixaDeHoras = itens => {
      const horas = itens.map(it => horaDe(it.criado_em)).filter(Boolean).sort();
      return horas.length > 1 && horas[0] !== horas[horas.length - 1] ? `${horas[0]} – ${horas[horas.length - 1]}` : horas[0] || '';
    };

    /** "Marcia Lamounier" ou "Marcia Lamounier e mais 2". */
    function nomesDoGrupo(grupo) {
      const nomes = [...new Set(grupo.itens.map(it => it.usuario || 'Sistema'))];
      return nomes.length > 1 ? `${nomes[0]} e mais ${nomes.length - 1}` : nomes[0];
    }

    /** Curtida do grupo: soma as dos registros; curtir marca o mais recente, descurtir tira as minhas. */
    function curtidaDoGrupo(grupo) {
      const itens = grupo.itens.filter(it => !it.excluido);
      const quem = [...new Set(itens.flatMap(it => it.quem_curtiu || []))];
      return {
        total: itens.reduce((s, it) => s + (Number(it.curtidas) || 0), 0),
        curti: itens.some(it => it.curti),
        quem,
        alternar: async () => {
          const minhas = itens.filter(it => it.curti);
          try {
            if (minhas.length) for (const it of minhas) await chamar(`/itens/${it.id}/curtida`, { method: 'POST' });
            else await chamar(`/itens/${itens[0].id}/curtida`, { method: 'POST' });
            await recarregar();
          } catch (err) { avisar(err.message); }
        }
      };
    }

    function desenharGrupo(grupo, caixas, { naCascata = false } = {}) {
      const cabeca = grupo.itens[0];
      const outros = grupo.itens.slice(1);
      const observacao = cabeca.tipo === 'observacao';
      const li = criar('li', `hs-item${observacao ? ' hs-item--observacao' : ''}${cabeca.excluido ? ' hs-item--excluido' : ''}${outros.length ? ' hs-item--grupo' : ''}`);
      li.dataset.itemId = cabeca.id;
      li.dataset.grupo = grupo.chave;
      li.appendChild(avatar(cabeca.usuario_id, cabeca.usuario, { sistema: !cabeca.usuario_id }));
      const coluna = criar('div', 'hs-coluna');
      const cartao = criar('div', 'hs-cartao');

      if (naCascata) cartao.appendChild(criar('span', 'hs-cartao__dia', rotuloDoDia(cabeca.criado_em)));
      const topo = criar('div', 'hs-cartao__topo');
      topo.appendChild(marcarColuna(criar('span', 'hs-nome', outros.length ? nomesDoGrupo(grupo) : (cabeca.usuario || 'Sistema')), 'quem'));
      const d = descreverItem(cabeca);
      if (d.etiqueta) topo.appendChild(marcarColuna(criar('span', `hs-tag hs-tag--${d.tom || 'neutro'}`, d.etiqueta), 'tipo'));
      if (d.acao) topo.appendChild(criar('span', 'hs-acao-rotulo', d.acao));
      const hora = marcarColuna(criar('span', 'hs-hora', horaDe(cabeca.criado_em)), 'data');
      hora.title = new Date(cabeca.criado_em).toLocaleString('pt-BR');
      topo.appendChild(hora);
      if (outros.length) topo.appendChild(criar('span', 'hs-conta', `${grupo.itens.length} registros no dia`));
      if (dados?.eu?.sup_admin && !cabeca.excluido && !dados?.sql_pendente) {
        const menu = criar('div', 'hs-cartao__menu');
        const excluir = botao('hs-acao hs-acao--perigo', [icone('fa-trash')], outros.length ? 'Excluir o registro em destaque (Sup Admin)' : 'Excluir do histórico (Sup Admin)');
        excluir.setAttribute('aria-label', 'Excluir do histórico');
        excluir.addEventListener('click', () => excluirEvento(cabeca));
        menu.appendChild(excluir);
        topo.appendChild(menu);
      }
      cartao.appendChild(topo);
      cartao.appendChild(marcarColuna(desenharCorpo(cabeca), 'resumo'));
      if (cabeca.anexos?.length) cartao.appendChild(linhaDeAnexos(cabeca.anexos));

      if (cabeca.excluido) {
        const faixa = criar('div', 'hs-excluido-faixa');
        faixa.append(icone('fa-ban'), criar('span', '', `Excluído${cabeca.excluido_por_nome ? ` por ${cabeca.excluido_por_nome}` : ''} em ${dataHora(cabeca.excluido_em)}${cabeca.motivo_exclusao ? ` — ${cabeca.motivo_exclusao}` : ''}`));
        cartao.appendChild(faixa);
      }

      // os outros registros do mesmo dia, em cascata, cada um com a sua hora
      if (outros.length) {
        const aberta = listasAbertas.has(grupo.chave);
        const alternar = botao(`hs-grupo__alternar${aberta ? ' hs-grupo__alternar--aberto' : ''}`, [icone('fa-chevron-right'),
          `${aberta ? 'Esconder' : 'Ver'} mais ${outros.length} ${outros.length === 1 ? 'registro' : 'registros'} ${diaLocal(cabeca.criado_em) === diaLocal(new Date()) ? 'de hoje' : 'do dia'} (${faixaDeHoras(outros)})`]);
        alternar.setAttribute('aria-expanded', String(aberta));
        alternar.addEventListener('click', () => { if (aberta) listasAbertas.delete(grupo.chave); else listasAbertas.add(grupo.chave); desenhar(); });
        cartao.appendChild(alternar);
        if (aberta) {
          const lista = criar('ol', 'hs-registros');
          for (const it of outros) lista.appendChild(linhaCompacta(it, grupo, caixas));
          cartao.appendChild(lista);
        }
      }

      if (!dados?.sql_pendente) {
        const acoes = criar('div', 'hs-acoes');
        const curtida = curtidaDoGrupo(grupo);
        if (!cabeca.excluido) {
          const curtir = botao('hs-acao', [iconeCurtida(curtida.curti), curtida.total ? `Curtir · ${curtida.total}` : 'Curtir']);
          curtir.setAttribute('aria-pressed', String(Boolean(curtida.curti)));
          curtir.title = quemCurtiu(curtida.quem) || 'Curtir';
          curtir.addEventListener('click', curtida.alternar);
          acoes.appendChild(curtir);
        }
        const totalComentarios = grupo.itens.reduce((s, it) => s + (Number(it.comentarios) || 0), 0);
        const comentarBotao = botao('hs-acao', [icone('fa-comment'), totalComentarios ? `Comentar · ${totalComentarios}` : 'Comentar']);
        comentarBotao.addEventListener('click', () => {
          if (abertos.has(grupo.chave) && !compondo) abertos.delete(grupo.chave);
          else { abertos.add(grupo.chave); compondo = cabeca.excluido ? null : { grupo: grupo.chave, respostaDe: null }; }
          desenhar();
        });
        acoes.appendChild(comentarBotao);
        if (curtida.total) acoes.appendChild(criar('span', 'hs-curtiram', quemCurtiu(curtida.quem)));
        if (grupo.anteriores.length) {
          const aberta = cascatasAbertas.has(grupo.chave);
          const dias = grupo.anteriores.map(g => dataCurta(g.dia)).join(', ');
          const cascata = botao(`hs-cascata__alternar${aberta ? ' hs-cascata__alternar--aberto' : ''}`, [icone('fa-layer-group'),
            `${d.etiqueta || 'Registros'} em ${grupo.anteriores.length} ${grupo.anteriores.length === 1 ? 'dia anterior' : 'dias anteriores'}`, criar('small', '', ` (${dias})`), icone('fa-chevron-down')]);
          cascata.setAttribute('aria-expanded', String(aberta));
          cascata.addEventListener('click', () => { if (aberta) cascatasAbertas.delete(grupo.chave); else cascatasAbertas.add(grupo.chave); desenhar(); });
          acoes.appendChild(cascata);
        }
        cartao.appendChild(acoes);
        if (abertos.has(grupo.chave) || totalComentarios) cartao.appendChild(desenharComentarios(grupo, caixas));
      }
      coluna.appendChild(cartao);

      // dias anteriores da mesma etiqueta, logo abaixo, cada um com a sua data
      if (grupo.anteriores.length && cascatasAbertas.has(grupo.chave)) {
        const ol = criar('ol', 'hs-cascata');
        for (const g of grupo.anteriores) ol.appendChild(desenharGrupo(g, caixas, { naCascata: true }));
        coluna.appendChild(ol);
      }
      li.appendChild(coluna);
      return li;
    }

    // -------------------------------------------------------- ações

    async function comentar(grupo, itemId, texto, arquivos, respostaDe) {
      try {
        const criado = await chamar(`/itens/${itemId}/comentarios`, { method: 'POST', corpo: { texto, resposta_de: respostaDe } });
        rascunhos.delete(respostaDe ? `resp:${respostaDe}` : `com:${grupo.chave}`);
        if (arquivos.length && criado?.id) await enviarAnexos(arquivos, { comentario_id: criado.id });
        compondo = null;
        abertos.add(grupo.chave);
        await recarregar();
        return true;
      } catch (err) {
        avisar(err.message);
        return false;
      }
    }

    async function alternarCurtida(caminho) {
      try {
        await chamar(caminho, { method: 'POST' });
        await recarregar();
      } catch (err) {
        avisar(err.message);
      }
    }

    async function excluirEvento(item) {
      const d = descreverItem(item);
      const ok = await window.DialogPadrao?.confirm?.({
        title: 'Excluir do histórico?', tom: 'erro', icone: 'fa-trash',
        message: `"${d.titulo || d.etiqueta || 'Este evento'}" sai da linha do tempo de todos.`,
        nota: 'A exclusão é por marca: o registro continua guardado, e só o Sup Admin o vê (riscado, com quem excluiu e quando).',
        confirmText: 'Excluir', cancelText: 'Voltar', confirmVariant: 'danger'
      });
      if (!ok) return;
      try {
        await chamar(`/itens/${item.id}/excluir`, { method: 'POST', corpo: {} });
        avisar('Evento excluído do histórico.', 'success');
        await recarregar();
      } catch (err) {
        avisar(err.message);
      }
    }

    async function excluirComentario(c) {
      const ok = await window.DialogPadrao?.confirm?.({
        title: 'Excluir este comentário?', tom: 'erro', icone: 'fa-trash',
        message: 'O comentário vira "removido" para todos; as respostas continuam no lugar.',
        nota: 'O texto continua guardado e o Sup Admin segue vendo.',
        confirmText: 'Excluir', cancelText: 'Voltar', confirmVariant: 'danger'
      });
      if (!ok) return;
      try {
        await chamar(`/comentarios/${c.id}/excluir`, { method: 'POST', corpo: {} });
        await recarregar();
      } catch (err) {
        avisar(err.message);
      }
    }

    // -------------------------------------------------------- desenho

    let caixasNaTela = new Map();     // grupo → caixa de comentário (para "citar" direto da linha)
    let caixaObservacao = null;

    function desenhar() {
      if (destruido) return;
      window.Popover?.fechar?.(balaoVersoes);
      const raiz = criar('div', 'hs');
      const caixas = new Map();
      if (!dados) {
        const carregando = criar('div', 'hs-carregando');
        carregando.append(icone('fa-spinner fa-spin'), criar('span', '', 'Carregando o histórico…'));
        raiz.appendChild(carregando);
        alvo.replaceChildren(raiz);
        return;
      }
      if (dados.sql_pendente) {
        const aviso = criar('div', 'hs-aviso');
        aviso.append(icone('fa-triangle-exclamation'), criar('span', '', 'Curtidas, comentários e observações ainda não estão ativados: rode sql/historico_social.sql no banco e reinicie a API.'));
        raiz.appendChild(aviso);
      } else {
        const compor = criar('div', 'hs-compor');
        caixaObservacao = caixaDeTexto({
          chave: 'obs', placeholder: textos.placeholder, rotulo: textos.publicar,
          aoEnviar: async (texto, arquivos) => {
            try {
              const criado = await chamar('/observacoes', { method: 'POST', corpo: { texto } });
              rascunhos.delete('obs');
              if (arquivos.length && criado?.id) await enviarAnexos(arquivos, { item_id: criado.id });
              await recarregar();
              avisar(textos.publicado, 'success');
              return true;
            } catch (err) { avisar(err.message); return false; }
          }
        });
        compor.append(avatar(dados.eu?.id, dados.eu?.nome), caixaObservacao);
        raiz.appendChild(compor);
      }

      const itens = (dados.itens || []).filter(i => mostrarExcluidos || !i.excluido);
      const dias = agrupar(itens, etiquetaDe);
      gruposNaTela = new Map();
      const registrar = g => { gruposNaTela.set(g.chave, g); g.anteriores.forEach(registrar); };
      dias.forEach(d => d.grupos.forEach(registrar));
      // Aviso do sino apontando para um registro dentro de uma lista ou
      // cascata fechada: abre o caminho antes de desenhar.
      if (foco?.itemId || foco?.comentarioId) abrirCaminho(foco);

      const barra = criar('div', 'hs-barra');
      const cartoes = dias.reduce((s, d) => s + d.grupos.length, 0);
      barra.appendChild(criar('span', 'hs-barra__total', `${itens.length} ${itens.length === 1 ? 'registro' : 'registros'} na linha do tempo${cartoes < itens.length ? ` · agrupados em ${cartoes} ${cartoes === 1 ? 'cartão' : 'cartões'}` : ''}`));
      const aoVivo = criar('span', 'hs-ao-vivo', 'ao vivo');
      aoVivo.title = 'Atualiza sozinho a cada 10 segundos';
      barra.appendChild(aoVivo);
      if (dados.eu?.sup_admin && (dados.itens || []).some(i => i.excluido)) {
        const alternar = criar('label', 'hs-alternar');
        const caixa = document.createElement('input');
        caixa.type = 'checkbox';
        caixa.checked = mostrarExcluidos;
        caixa.addEventListener('change', () => { mostrarExcluidos = caixa.checked; desenhar(); });
        alternar.append(caixa, document.createTextNode('Mostrar excluídos (Sup Admin)'));
        barra.appendChild(alternar);
      }
      raiz.appendChild(barra);

      if (!dias.length) {
        raiz.appendChild(criar('div', 'hs-vazio', textos.vazio));
      } else {
        // Cada dia é uma seção: a data gruda no topo só enquanto o dia dela
        // está na tela — antes todas grudavam juntas, uma por cima da outra.
        const ol = criar('ol', 'hs-linha');
        for (const d of dias) {
          const secao = criar('li', 'hs-dia-bloco');
          secao.appendChild(criar('div', 'hs-dia', rotuloDoDia(`${d.dia}T12:00:00`)));
          const lista = criar('ol', 'hs-dia__lista');
          for (const g of d.grupos) lista.appendChild(desenharGrupo(g, caixas));
          secao.appendChild(lista);
          ol.appendChild(secao);
        }
        raiz.appendChild(ol);
      }
      caixasNaTela = caixas;
      alvo.replaceChildren(raiz);
      window.Permissoes?.aplicarAcoesEColunas?.(alvo);
      if (foco) aplicarFoco();
    }

    /** Redesenha sem tirar o cursor de quem está escrevendo. */
    function desenharPreservando() {
      const ativo = document.activeElement;
      const escrevendo = ativo && alvo.contains(ativo) && ativo.dataset?.chave
        ? { chave: ativo.dataset.chave, inicio: ativo.selectionStart, fim: ativo.selectionEnd, rolagem: ativo.scrollTop } : null;
      desenhar();
      if (!escrevendo) return;
      const campo = alvo.querySelector(`textarea[data-chave="${CSS.escape(escrevendo.chave)}"]`);
      if (!campo) return;
      campo.focus({ preventScroll: true });
      try { campo.setSelectionRange(escrevendo.inicio, escrevendo.fim); } catch (_) { /* campo mudou */ }
      campo.scrollTop = escrevendo.rolagem;
    }

    /** O grupo onde um registro mora (e a cabeça da cascata, se estiver numa). */
    function localDoRegistro(itemId) {
      for (const g of gruposNaTela.values()) {
        if (!g.itens.some(it => String(it.id) === String(itemId))) continue;
        const cascata = [...gruposNaTela.values()].find(h => h.anteriores.includes(g));
        return { grupo: g, cascata };
      }
      return null;
    }

    function aplicarFoco() {
      const { itemId, comentarioId } = foco;
      foco = null;
      const seletor = comentarioId ? `[data-comentario-id="${CSS.escape(String(comentarioId))}"]` : `[data-item-id="${CSS.escape(String(itemId))}"]`;
      const el = alvo.querySelector(seletor);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('hs-destaque');
      setTimeout(() => el.classList.remove('hs-destaque'), 2600);
    }

    const assinatura = d => JSON.stringify([
      (d?.itens || []).map(i => [i.id, i.curtidas, i.comentarios, i.excluido ? 1 : 0]),
      (d?.comentarios || []).map(c => [c.id, c.curtidas, c.editado_em || '', c.excluido ? 1 : 0, (c.anexos || []).length])
    ]);

    async function recarregar({ aoVivo = false } = {}) {
      try {
        if (!base) base = (await window.apiConfig?.getApiBaseUrl?.()) || '';
        const [novos, mapa] = await Promise.all([chamar(''), carregarFotos(base)]);
        const nova = assinatura(novos);
        if (aoVivo && nova === assinaturaAtual) return;
        const itensAntes = new Set((dados?.itens || []).map(i => String(i.id)));
        const comentariosAntes = new Set((dados?.comentarios || []).map(c => String(c.id)));
        const primeiraVez = !dados;
        dados = novos;
        fotos = mapa;
        assinaturaAtual = nova;
        if (aoVivo) desenharPreservando(); else desenhar();
        aoCarregar(dados);
        // O que chegou de outra pessoa pisca de leve, para ser notado.
        if (aoVivo && !primeiraVez) {
          const eu = String(dados.eu?.id ?? '');
          const novidades = [
            ...(dados.itens || []).filter(i => !itensAntes.has(String(i.id)) && String(i.usuario_id) !== eu).map(i => `[data-item-id="${CSS.escape(String(i.id))}"]`),
            ...(dados.comentarios || []).filter(c => !comentariosAntes.has(String(c.id)) && String(c.usuario_id) !== eu).map(c => `[data-comentario-id="${CSS.escape(String(c.id))}"]`)
          ];
          for (const sel of novidades) {
            const el = alvo.querySelector(sel);
            if (!el) continue;
            el.classList.add('hs-novo');
            setTimeout(() => el.classList.remove('hs-novo'), 4000);
          }
        }
      } catch (err) {
        if (aoVivo) return; // sem rede agora: tenta de novo daqui a pouco, sem apagar a tela
        const raiz = criar('div', 'hs');
        raiz.appendChild(criar('div', 'hs-vazio', err.status === 403 ? 'Você não tem permissão para ver este histórico.' : `Não foi possível carregar o histórico: ${err.message}`));
        alvo.replaceChildren(raiz);
      }
    }

    /** Abre o grupo, a lista do dia e a cascata onde o registro mora. */
    function abrirCaminho(alvoFoco) {
      const itemId = alvoFoco.itemId || (dados?.comentarios || []).find(c => String(c.id) === String(alvoFoco.comentarioId))?.item_id;
      const local = itemId ? localDoRegistro(itemId) : null;
      if (!local) return;
      abertos.add(local.grupo.chave);
      if (String(local.grupo.itens[0].id) !== String(itemId)) listasAbertas.add(local.grupo.chave);
      if (local.cascata) cascatasAbertas.add(local.cascata.chave);
      if (alvoFoco.comentarioId) expandidos.add(local.grupo.chave);
    }

    function focar(alvoFoco = {}) {
      foco = alvoFoco;
      if (dados) desenhar();
    }

    // -------------------------------------------------------- ao vivo

    let voltas = 0;
    const vivo = setInterval(() => {
      if (destruido) { clearInterval(vivo); return; }
      // Ficha fechada (o alvo saiu da tela): para de perguntar.
      if (!alvo.isConnected) { if (++voltas > 2) { clearInterval(vivo); destruido = true; } return; }
      voltas = 0;
      // Aba escondida, janela minimizada ou alguém escolhendo uma sugestão: espera.
      if (document.hidden || !alvo.offsetParent || !dados || dados.sql_pendente) return;
      if ([...caixasNaTela.values(), caixaObservacao].some(c => c?.sugestoesAbertas?.())) return;
      if (editando) return;
      recarregar({ aoVivo: true });
    }, AO_VIVO_MS);

    if (foco?.itemId) focar(foco);
    desenhar();
    recarregar();

    return {
      recarregar,
      focar,
      destruir() {
        destruido = true;
        clearInterval(vivo);
        window.Popover?.fechar?.(balaoVersoes);
        balaoVersoes.remove();
        alvo.replaceChildren();
      }
    };
  }

  window.HistoricoSocial = {
    montar, carregarFotos,
    montarArvore, contarNaArvore, diaLocal, rotuloDoDia, horaDe, quemCurtiu, iniciais, tamanhoLegivel, iconeDoArquivo, conferirArquivos,
    valorLegivel, agrupar, pedacosDoTexto, textoSimples, citadosNoTexto, aplicarReferencias, paraEdicao, gatilhoNoCursor
  };
})();
