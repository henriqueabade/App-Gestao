/**
 * Linha do tempo "de rede social" do histórico de Prospecções e Clientes.
 *
 *   const linha = window.HistoricoSocial.montar(alvo, {
 *     origem: 'prospeccao' | 'cliente',
 *     registroId,
 *     descrever: item => ({ etiqueta, tom, acao, titulo, campo, antes, depois, riscado, retrato, nota }),
 *     aoCarregar: dados => {},          // ex.: atualizar o contador da aba
 *     foco: { itemId, comentarioId }    // abrir já no comentário do aviso
 *   });
 *   linha.recarregar(); linha.focar({ itemId, comentarioId });
 *
 * Cada evento vira um cartão com a foto de quem fez, a etiqueta, o que mudou
 * e, embaixo, Curtir e Comentar. Comentário tem resposta em cadeia, curtida,
 * anexo e edição (pelo autor; o Sup Admin vê no (i) o que era antes). Quem
 * publica uma observação escreve direto na linha do tempo. Só o Sup Admin
 * exclui — e a exclusão é por marca: ele continua vendo, riscado.
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

  // ------------------------------------------------------------ fotos

  let cacheFotos = null;
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
      cacheFotos = new Map((Array.isArray(lista) ? lista : [])
        .map(u => [String(u.id), url(u.foto_perfil_url || u.foto_perfil || u.fotoPerfil || u.foto_usuario || u.avatar || u.avatar_url || u.avatarUrl)])
        .filter(([, v]) => v));
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
      placeholder: 'Escreva uma observação para todos que acompanham esta ficha… (Ctrl+Enter publica)',
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
    const abertos = new Set();        // eventos com os comentários à mostra
    const expandidos = new Set();     // eventos com TODOS os comentários (sem o "ver mais")
    let compondo = null;              // { itemId, respostaDe, nome } — onde está a caixa de comentário
    let editando = null;              // id do comentário em edição
    // Texto e arquivos de cada caixa ('obs', 'com:<evento>', 'resp:<comentário>',
    // 'edit:<comentário>'): curtir outra coisa redesenha a tela, e o que a pessoa
    // estava escrevendo não pode sumir por isso.
    const rascunhos = new Map();
    const balaoVersoes = criar('div', 'hs-versoes');
    balaoVersoes.setAttribute('role', 'tooltip');

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

    /** A caixa de escrever (observação, comentário, resposta ou edição). */
    function caixaDeTexto({ chave, placeholder, rotulo, textoInicial = '', comAnexo = true, respondendoA = null, aoEnviar, aoCancelar }) {
      const rascunho = rascunhos.get(chave) || { texto: textoInicial, arquivos: [] };
      rascunhos.set(chave, rascunho);
      const caixa = criar('div', 'hs-compor__campo');
      const campo = criar('textarea', 'hs-texto');
      campo.placeholder = placeholder;
      campo.maxLength = 5000;
      campo.rows = 2;
      campo.value = rascunho.texto;
      campo.addEventListener('input', () => { rascunho.texto = campo.value; });
      const escolhidos = rascunho.arquivos;
      const chips = criar('div', 'hs-anexos-escolhidos');
      const seletor = document.createElement('input');
      seletor.type = 'file';
      seletor.multiple = true;
      seletor.hidden = true;

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
        let texto = campo.value.trim();
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
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); disparar(); }
        if (e.key === 'Escape' && aoCancelar) { e.preventDefault(); e.stopPropagation(); rascunhos.delete(chave); aoCancelar(); }
      });
      botoes.appendChild(enviar);
      rodape.appendChild(botoes);
      caixa.append(campo, chips, rodape, seletor);
      caixa.focar = () => campo.focus();
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

    // -------------------------------------------------------- comentários

    function desenharComentario(c, item, nivel) {
      const bloco = criar('div', 'hs-com');
      bloco.dataset.comentarioId = c.id;
      const linha = criar('div', 'hs-com__linha');
      const balao = criar('div', `hs-balao${c.excluido ? ' hs-balao--removido' : ''}`);
      const topo = criar('div', 'hs-balao__topo');
      topo.appendChild(criar('span', 'hs-nome', c.excluido && !c.texto ? 'Comentário removido' : c.usuario || 'Alguém'));
      const hora = criar('span', 'hs-hora', dataHora(c.criado_em));
      hora.title = new Date(c.criado_em).toLocaleString('pt-BR');
      topo.appendChild(hora);
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
              li.appendChild(criar('span', '', v.texto));
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
        balao.appendChild(caixaDeTexto({
          chave: `edit:${c.id}`, placeholder: 'Edite o comentário', rotulo: 'Salvar', textoInicial: c.texto || '', comAnexo: false,
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
      } else {
        balao.appendChild(criar('p', 'hs-balao__texto', c.excluido && !c.texto ? 'Este comentário foi removido pelo Sup Admin.' : c.texto));
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
          compondo = { itemId: item.id, respostaDe: c.id, nome: c.usuario || 'Alguém' };
          abertos.add(String(item.id));
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
          chave: `resp:${c.id}`, placeholder: 'Escreva a resposta… (Ctrl+Enter envia)', rotulo: 'Responder', respondendoA: compondo.nome,
          aoCancelar: () => { compondo = null; desenhar(); },
          aoEnviar: (texto, arquivos) => comentar(item, texto, arquivos, c.id)
        });
        const embrulho = criar('div', 'hs-com__linha');
        embrulho.append(avatar(dados?.eu?.id, dados?.eu?.nome, { pequeno: true }), resposta);
        bloco.appendChild(embrulho);
        requestAnimationFrame(() => resposta.focar());
      }

      if (c.respostas?.length) {
        const respostas = criar('div', `hs-respostas${nivel >= NIVEL_MAXIMO_DE_RECUO ? ' hs-respostas--rasa' : ''}`);
        for (const r of c.respostas) respostas.appendChild(desenharComentario(r, item, nivel + 1));
        bloco.appendChild(respostas);
      }
      return bloco;
    }

    function desenharComentarios(item) {
      const caixa = criar('div', 'hs-comentarios');
      const arvore = montarArvore((dados?.comentarios || []).filter(c => String(c.item_id) === String(item.id)));
      const todos = expandidos.has(String(item.id));
      const visiveis = todos ? arvore : arvore.slice(-COMENTARIOS_VISIVEIS);
      if (!todos && arvore.length > COMENTARIOS_VISIVEIS) {
        const escondidos = arvore.slice(0, arvore.length - COMENTARIOS_VISIVEIS).reduce((s, r) => s + contarNaArvore(r), 0);
        const mais = botao('hs-mais', `Ver mais ${escondidos} comentário${escondidos === 1 ? '' : 's'}`);
        mais.addEventListener('click', () => { expandidos.add(String(item.id)); desenhar(); });
        caixa.appendChild(mais);
      }
      for (const c of visiveis) caixa.appendChild(desenharComentario(c, item, 1));
      const respondendoAqui = Boolean(compondo?.respostaDe) && String(compondo.itemId) === String(item.id);
      if (!item.excluido && !respondendoAqui && (compondo?.itemId === item.id || abertos.has(String(item.id)))) {
        const novo = caixaDeTexto({
          chave: `com:${item.id}`, placeholder: 'Escreva um comentário… (Ctrl+Enter envia)', rotulo: 'Comentar',
          aoEnviar: (texto, arquivos) => comentar(item, texto, arquivos, null)
        });
        const embrulho = criar('div', 'hs-com__linha');
        embrulho.append(avatar(dados?.eu?.id, dados?.eu?.nome, { pequeno: true }), novo);
        caixa.appendChild(embrulho);
        if (compondo?.itemId === item.id && !compondo.respostaDe) requestAnimationFrame(() => novo.focar());
      }
      return caixa;
    }

    // -------------------------------------------------------- evento

    function desenharCorpo(item) {
      const corpo = criar('div', 'hs-corpo');
      if (item.tipo === 'observacao') {
        corpo.appendChild(criar('p', 'hs-texto-livre', item.observacao || item.valor_novo || ''));
        return corpo;
      }
      const d = descrever(item) || {};
      if (d.titulo) corpo.appendChild(criar('div', 'hs-corpo__titulo', d.titulo));
      if (d.campo) corpo.appendChild(criar('div', 'hs-corpo__campo', d.campo));
      if (d.antes || d.depois) {
        const mud = criar('div', 'hs-mudanca');
        if (d.antes) mud.appendChild(criar('span', 'hs-mudanca__antes', d.antes));
        if (d.antes && d.depois && !d.riscado) mud.appendChild(criar('span', 'hs-mudanca__seta', '→'));
        if (d.depois && !d.riscado) mud.appendChild(criar('span', 'hs-mudanca__depois', d.depois));
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

    function desenharItem(item) {
      const observacao = item.tipo === 'observacao';
      const li = criar('li', `hs-item${observacao ? ' hs-item--observacao' : ''}${item.excluido ? ' hs-item--excluido' : ''}`);
      li.dataset.itemId = item.id;
      li.appendChild(avatar(item.usuario_id, item.usuario, { sistema: !item.usuario_id }));
      const cartao = criar('div', 'hs-cartao');

      const topo = criar('div', 'hs-cartao__topo');
      topo.appendChild(marcarColuna(criar('span', 'hs-nome', item.usuario || 'Sistema'), 'quem'));
      const d = observacao ? { etiqueta: 'Observação', tom: 'observacao', acao: 'publicou' } : (descrever(item) || {});
      if (d.etiqueta) topo.appendChild(marcarColuna(criar('span', `hs-tag hs-tag--${d.tom || 'neutro'}`, d.etiqueta), 'tipo'));
      if (d.acao) topo.appendChild(criar('span', 'hs-acao-rotulo', d.acao));
      const hora = marcarColuna(criar('span', 'hs-hora', horaDe(item.criado_em)), 'data');
      hora.title = new Date(item.criado_em).toLocaleString('pt-BR');
      topo.appendChild(hora);
      if (dados?.eu?.sup_admin && !item.excluido && !dados?.sql_pendente) {
        const menu = criar('div', 'hs-cartao__menu');
        const excluir = botao('hs-acao hs-acao--perigo', [icone('fa-trash')], 'Excluir do histórico (Sup Admin)');
        excluir.setAttribute('aria-label', 'Excluir do histórico');
        excluir.addEventListener('click', () => excluirEvento(item));
        menu.appendChild(excluir);
        topo.appendChild(menu);
      }
      cartao.appendChild(topo);
      cartao.appendChild(marcarColuna(desenharCorpo(item), 'resumo'));
      if (item.anexos?.length) cartao.appendChild(linhaDeAnexos(item.anexos));

      if (item.excluido) {
        const faixa = criar('div', 'hs-excluido-faixa');
        faixa.append(icone('fa-ban'), criar('span', '', `Excluído${item.excluido_por_nome ? ` por ${item.excluido_por_nome}` : ''} em ${dataHora(item.excluido_em)}${item.motivo_exclusao ? ` — ${item.motivo_exclusao}` : ''}`));
        cartao.appendChild(faixa);
      }

      if (!dados?.sql_pendente) {
        const acoes = criar('div', 'hs-acoes');
        if (!item.excluido) {
          const curtir = botao('hs-acao', [iconeCurtida(item.curti), item.curtidas ? `Curtir · ${item.curtidas}` : 'Curtir']);
          curtir.setAttribute('aria-pressed', String(Boolean(item.curti)));
          curtir.title = quemCurtiu(item.quem_curtiu) || 'Curtir';
          curtir.addEventListener('click', () => alternarCurtida(`/itens/${item.id}/curtida`));
          acoes.appendChild(curtir);
        }
        const comentar = botao('hs-acao', [icone('fa-comment'), item.comentarios ? `Comentar · ${item.comentarios}` : 'Comentar']);
        comentar.addEventListener('click', () => {
          const k = String(item.id);
          if (abertos.has(k) && !compondo) abertos.delete(k);
          else { abertos.add(k); compondo = item.excluido ? null : { itemId: item.id, respostaDe: null }; }
          desenhar();
        });
        acoes.appendChild(comentar);
        if (item.curtidas) acoes.appendChild(criar('span', 'hs-curtiram', quemCurtiu(item.quem_curtiu)));
        cartao.appendChild(acoes);
        if (abertos.has(String(item.id)) || item.comentarios) cartao.appendChild(desenharComentarios(item));
      }
      li.appendChild(cartao);
      return li;
    }

    // -------------------------------------------------------- ações

    async function comentar(item, texto, arquivos, respostaDe) {
      try {
        const criado = await chamar(`/itens/${item.id}/comentarios`, { method: 'POST', corpo: { texto, resposta_de: respostaDe } });
        rascunhos.delete(respostaDe ? `resp:${respostaDe}` : `com:${item.id}`);
        if (arquivos.length && criado?.id) await enviarAnexos(arquivos, { comentario_id: criado.id });
        compondo = null;
        abertos.add(String(item.id));
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
      const d = item.tipo === 'observacao' ? { titulo: 'Observação' } : (descrever(item) || {});
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

    function desenhar() {
      window.Popover?.fechar?.(balaoVersoes);
      const raiz = criar('div', 'hs');
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
        compor.append(avatar(dados.eu?.id, dados.eu?.nome), caixaDeTexto({
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
        }));
        raiz.appendChild(compor);
      }

      const itens = (dados.itens || []).filter(i => mostrarExcluidos || !i.excluido);
      const barra = criar('div', 'hs-barra');
      barra.appendChild(criar('span', 'hs-barra__total', `${itens.length} ${itens.length === 1 ? 'registro' : 'registros'} na linha do tempo`));
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

      if (!itens.length) {
        raiz.appendChild(criar('div', 'hs-vazio', textos.vazio));
      } else {
        const ol = criar('ol', 'hs-linha');
        let diaAtual = null;
        for (const item of itens) {
          const dia = diaLocal(item.criado_em);
          if (dia !== diaAtual) {
            diaAtual = dia;
            ol.appendChild(criar('li', 'hs-dia', rotuloDoDia(item.criado_em)));
          }
          ol.appendChild(desenharItem(item));
        }
        raiz.appendChild(ol);
      }
      alvo.replaceChildren(raiz);
      window.Permissoes?.aplicarAcoesEColunas?.(alvo);
      if (foco) aplicarFoco();
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

    async function recarregar() {
      try {
        if (!base) base = (await window.apiConfig?.getApiBaseUrl?.()) || '';
        const [novos, mapa] = await Promise.all([chamar(''), carregarFotos(base)]);
        dados = novos;
        fotos = mapa;
        desenhar();
        aoCarregar(dados);
      } catch (err) {
        const raiz = criar('div', 'hs');
        raiz.appendChild(criar('div', 'hs-vazio', err.status === 403 ? 'Você não tem permissão para ver este histórico.' : `Não foi possível carregar o histórico: ${err.message}`));
        alvo.replaceChildren(raiz);
      }
    }

    function focar(alvoFoco = {}) {
      foco = alvoFoco;
      if (alvoFoco.itemId) abertos.add(String(alvoFoco.itemId));
      if (alvoFoco.comentarioId && alvoFoco.itemId) expandidos.add(String(alvoFoco.itemId));
      if (dados) desenhar();
    }

    if (foco?.itemId) focar(foco);
    desenhar();
    recarregar();

    return {
      recarregar,
      focar,
      destruir() { window.Popover?.fechar?.(balaoVersoes); balaoVersoes.remove(); alvo.replaceChildren(); }
    };
  }

  window.HistoricoSocial = {
    montar, carregarFotos,
    montarArvore, contarNaArvore, diaLocal, rotuloDoDia, horaDe, quemCurtiu, iniciais, tamanhoLegivel, iconeDoArquivo, conferirArquivos
  };
})();
