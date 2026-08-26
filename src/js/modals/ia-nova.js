(function () {
  const OVERLAY = 'iaNova';

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const close = () => Modal.close(OVERLAY);
  const revelar = () =>
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: OVERLAY }));

  const get = id => document.getElementById(id);

  // -------------------------------------------------------------------------
  // Estado
  // -------------------------------------------------------------------------

  let opcoes = null;
  let destinoEscolhido = null;
  /** `{ file, motivo }` — motivo preenchido quando o front já recusou. */
  let escolhidos = [];
  let enviando = false;

  const ICONE_POR_EXTENSAO = {
    '.xlsx': 'fa-file-excel', '.xlsm': 'fa-file-excel', '.csv': 'fa-file-csv',
    '.tsv': 'fa-file-csv', '.txt': 'fa-file-lines', '.pdf': 'fa-file-pdf',
    '.jpg': 'fa-file-image', '.jpeg': 'fa-file-image', '.png': 'fa-file-image',
    '.webp': 'fa-file-image', '.heic': 'fa-file-image', '.heif': 'fa-file-image'
  };

  const extensaoDe = nome => {
    const ponto = String(nome || '').lastIndexOf('.');
    return ponto === -1 ? '' : String(nome).slice(ponto).toLowerCase();
  };

  function formatarTamanho(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  // -------------------------------------------------------------------------
  // Destinos
  // -------------------------------------------------------------------------

  function pintarDestinos() {
    const caixa = get('iaNovaDestinos');
    if (!caixa) return;

    // createElement + textContent: rótulo e descrição vêm do backend, mas o
    // hábito de montar HTML por concatenação é o que deixa a brecha aberta
    // quando amanhã esse texto passar a ser configurável.
    caixa.replaceChildren(...(opcoes?.destinos || []).map(d => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'ia-destino-cartao';
      botao.dataset.destino = d.id;
      botao.setAttribute('aria-pressed', 'false');

      if (!d.pode_aplicar) {
        botao.disabled = true;
        botao.title = 'Você não tem permissão para gravar neste módulo — a leitura ficaria sem uso';
      }

      const icone = document.createElement('i');
      icone.className = `fas ${d.icone || 'fa-wand-magic-sparkles'}`;
      botao.appendChild(icone);

      const texto = document.createElement('div');
      const titulo = document.createElement('p');
      titulo.className = 'text-sm font-medium text-white';
      titulo.textContent = d.rotulo;
      const descricao = document.createElement('p');
      descricao.className = 'text-xs text-white/50 mt-0.5';
      descricao.textContent = d.pode_aplicar
        ? d.descricao
        : 'Sem permissão para gravar neste módulo';
      texto.append(titulo, descricao);
      botao.appendChild(texto);

      botao.addEventListener('click', () => escolherDestino(d.id));
      return botao;
    }));
  }

  function escolherDestino(id) {
    destinoEscolhido = id;
    document.querySelectorAll('[data-destino]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.destino === id));
    });
    atualizarBotao();
  }

  // -------------------------------------------------------------------------
  // Arquivos
  // -------------------------------------------------------------------------

  /**
   * Confere tipo e tamanho ANTES de enviar.
   *
   * O backend confere de novo — esta checagem não é a barreira, é a cortesia:
   * sem ela, o usuário sobe 40 MB por uma rede lenta para receber "tipo não
   * aceito" no fim.
   */
  function conferir(file) {
    const ext = extensaoDe(file.name);
    const aceitas = opcoes?.extensoes || [];

    if (ext === '.xls') return 'formato antigo — salve como .xlsx';
    if (aceitas.length && !aceitas.includes(ext)) return 'tipo não aceito';

    const limiteMb = opcoes?.limites?.arquivo_mb;
    if (limiteMb && file.size > limiteMb * 1024 * 1024) return `acima de ${limiteMb} MB`;
    if (!file.size) return 'arquivo vazio';
    return null;
  }

  function adicionar(lista) {
    const maximo = opcoes?.limites?.arquivos || 10;
    const erro = get('iaNovaErroArquivos');
    let sobrou = false;

    for (const file of lista) {
      if (escolhidos.length >= maximo) { sobrou = true; continue; }
      // Mesmo nome e mesmo tamanho: escolher a mesma pasta duas vezes é fácil,
      // e mandar o arquivo em dobro custa crédito em dobro.
      const repetido = escolhidos.some(e => e.file.name === file.name && e.file.size === file.size);
      if (repetido) continue;
      escolhidos.push({ file, motivo: conferir(file) });
    }

    if (erro) {
      erro.classList.toggle('hidden', !sobrou);
      if (sobrou) erro.textContent = `O limite é ${maximo} arquivos por leitura — os demais foram ignorados.`;
    }

    pintarArquivos();
    atualizarBotao();
  }

  function pintarArquivos() {
    const lista = get('iaNovaLista');
    if (!lista) return;

    lista.replaceChildren(...escolhidos.map((item, indice) => {
      const linha = document.createElement('div');
      linha.className = 'ia-arquivo' + (item.motivo ? ' ia-arquivo--recusado' : '');

      const icone = document.createElement('i');
      icone.className = `fas ${ICONE_POR_EXTENSAO[extensaoDe(item.file.name)] || 'fa-file'} ia-arquivo__icone`;
      linha.appendChild(icone);

      const nome = document.createElement('span');
      nome.className = 'ia-arquivo__nome';
      // O nome vem de FORA do sistema — é o pior candidato a innerHTML.
      nome.textContent = item.file.name;
      nome.title = item.file.name;
      linha.appendChild(nome);

      if (item.motivo) {
        const motivo = document.createElement('span');
        motivo.className = 'ia-arquivo__motivo';
        motivo.textContent = item.motivo;
        linha.appendChild(motivo);
      }

      const tamanho = document.createElement('span');
      tamanho.className = 'ia-arquivo__tamanho';
      tamanho.textContent = formatarTamanho(item.file.size);
      linha.appendChild(tamanho);

      const remover = document.createElement('button');
      remover.type = 'button';
      remover.className = 'ia-arquivo__remover';
      remover.title = 'Remover';
      remover.innerHTML = '<i class="fas fa-xmark"></i>';
      remover.addEventListener('click', () => {
        escolhidos.splice(indice, 1);
        pintarArquivos();
        atualizarBotao();
      });
      linha.appendChild(remover);

      return linha;
    }));
  }

  /** Os arquivos que de fato vão subir: os recusados ficam de fora. */
  const validos = () => escolhidos.filter(e => !e.motivo);

  function atualizarBotao() {
    const botao = get('iaNovaEnviar');
    if (!botao) return;
    const pronto = Boolean(destinoEscolhido) && validos().length > 0 && !enviando;
    botao.disabled = !pronto;
    botao.title = pronto ? ''
      : !destinoEscolhido ? 'Escolha para onde os dados vão'
        : 'Adicione pelo menos um arquivo válido';
  }

  // -------------------------------------------------------------------------
  // Envio
  // -------------------------------------------------------------------------

  function mostrarProgresso(ligado) {
    get('iaNovaProgresso')?.classList.toggle('hidden', !ligado);
    get('iaNovaAcoes')?.classList.toggle('hidden', ligado);
  }

  function definirProgresso(pct, texto) {
    const barra = get('iaNovaBarra');
    const caixa = barra?.parentElement;
    const rotulo = get('iaNovaProgressoTexto');
    const numero = get('iaNovaProgressoPct');

    if (rotulo && texto) rotulo.textContent = texto;

    if (pct === null) {
      // Fase de leitura: a IA responde de uma vez, não há progresso real.
      // Fingir uma porcentagem que anda sozinha seria mentir para o usuário.
      //
      // A largura INLINE precisa sair, e é aqui que estava o defeito: estilo
      // inline vence classe, então o `width` deixado pela fase de envio
      // continuava valendo. Com um arquivo pequeno o envio termina antes do
      // primeiro evento de progresso, o inline fica em `0%`, e a barra da
      // fase de leitura nascia com largura zero — invisível e parada, que é
      // exatamente a tela travada que se via.
      if (barra) barra.style.width = '';
      caixa?.classList.add('ia-barra--indefinida');
      if (numero) numero.textContent = '';
      // O ponto que gira ao lado do texto não depende de animação de CSS de
      // largura nenhuma: é a garantia de que SEMPRE há algo se mexendo
      // enquanto a IA não responde.
      get('iaNovaGirando')?.classList.remove('hidden');
      return;
    }
    get('iaNovaGirando')?.classList.add('hidden');
    caixa?.classList.remove('ia-barra--indefinida');
    if (barra) barra.style.width = `${pct}%`;
    if (numero) numero.textContent = `${pct}%`;
  }

  /**
   * Envio por XHR e não por fetch.
   *
   * `fetch` não reporta progresso de UPLOAD. Com dez arquivos de vários MB numa
   * rede de escritório, a tela ficaria parada em "Enviando…" por minutos, sem
   * ninguém saber se travou.
   */
  function enviarComProgresso(url, formData) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);

      xhr.upload.addEventListener('progress', e => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        // Aos 100% o upload acabou, mas a leitura começa agora — e ela é a
        // parte demorada. Trocar o texto aqui evita a barra cheia parada.
        if (pct >= 100) definirProgresso(null, 'Lendo os arquivos…');
        else definirProgresso(pct, 'Enviando os arquivos…');
      });

      xhr.addEventListener('load', () => {
        let corpo = {};
        try { corpo = JSON.parse(xhr.responseText || '{}'); } catch (_) { /* resposta não-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(corpo);
        else reject(new Error(corpo.error || `Erro ${xhr.status}`));
      });
      xhr.addEventListener('error', () => reject(new Error('Falha de rede ao enviar os arquivos.')));
      xhr.addEventListener('abort', () => reject(new Error('Envio cancelado.')));

      xhr.send(formData);
    });
  }

  async function enviar() {
    if (enviando) return;
    const arquivos = validos();
    if (!destinoEscolhido || !arquivos.length) return;

    enviando = true;
    atualizarBotao();
    mostrarProgresso(true);
    definirProgresso(0, 'Enviando os arquivos…');

    try {
      const base = await window.apiConfig.getApiBaseUrl();
      const form = new FormData();
      form.append('destino', destinoEscolhido);
      const titulo = get('iaNovaTitulo')?.value?.trim();
      if (titulo) form.append('titulo', titulo);
      for (const item of arquivos) form.append('arquivos', item.file, item.file.name);

      const resposta = await enviarComProgresso(`${base}/api/ia`, form);

      // Grade primeiro, aviso depois: ler "leitura concluída" com a lista
      // ainda sem a linha nova faz o usuário achar que não funcionou.
      const recarregar = window.IaModulo?.carregar;
      if (recarregar) await recarregar(true);
      else window.dispatchEvent(new Event('iaLeituraAlterada'));

      close();

      if (resposta.status === 'erro') {
        showToast(resposta.erro || 'Nenhum arquivo pôde ser lido', 'error');
      } else if (resposta.arquivos_com_falha) {
        showToast(
          `${resposta.arquivos_lidos} de ${resposta.arquivos_lidos + resposta.arquivos_com_falha} arquivos lidos — veja o detalhe`,
          'info');
      } else {
        showToast('Arquivos lidos com sucesso!', 'success');
      }

      // Abre o resultado: é o que a pessoa quer ver em seguida, e é onde os
      // avisos por arquivo aparecem.
      const abrir = window.IaModulo?.abrirDetalhes;
      if (abrir && resposta.id) abrir({ id: resposta.id, titulo: resposta.titulo, status: resposta.status });
    } catch (err) {
      console.error('Falha ao ler os arquivos', err);
      showToast(err.message || 'Não foi possível ler os arquivos', 'error');
      enviando = false;
      mostrarProgresso(false);
      atualizarBotao();
      // A grade pode ter ganhado uma leitura marcada como erro — o backend
      // registra a falha em vez de sumir com ela.
      window.IaModulo?.carregar?.(true);
    }
  }

  // -------------------------------------------------------------------------
  // Ligações
  // -------------------------------------------------------------------------

  const solta = get('iaNovaSolta');
  const input = get('iaNovaInput');

  solta?.addEventListener('click', () => input?.click());
  solta?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input?.click(); }
  });

  ['dragenter', 'dragover'].forEach(evento => {
    solta?.addEventListener(evento, e => {
      e.preventDefault();
      solta.classList.add('ia-solta--ativa');
    });
  });
  ['dragleave', 'drop'].forEach(evento => {
    solta?.addEventListener(evento, e => {
      e.preventDefault();
      solta.classList.remove('ia-solta--ativa');
    });
  });
  solta?.addEventListener('drop', e => {
    adicionar([...(e.dataTransfer?.files || [])]);
  });

  input?.addEventListener('change', () => {
    adicionar([...(input.files || [])]);
    // Zera o input: sem isto, escolher o MESMO arquivo depois de removê-lo da
    // lista não dispara `change` e parece que o clique não funcionou.
    input.value = '';
  });

  get('iaNovaCancelar')?.addEventListener('click', () => { if (!enviando) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key !== 'Escape') return;
    // Fechar no meio do envio não cancelaria a leitura no servidor — ela
    // seguiria, e o usuário ficaria sem saber o que aconteceu.
    if (enviando) return;
    close();
    document.removeEventListener('keydown', esc);
  });

  const botaoEnviar = get('iaNovaEnviar');
  if (botaoEnviar) {
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(botaoEnviar, enviar);
    else botaoEnviar.addEventListener('click', enviar);
  }

  // -------------------------------------------------------------------------
  // Início
  // -------------------------------------------------------------------------

  (async () => {
    try {
      const resp = await fetchApi('/api/ia/opcoes');
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);
      opcoes = dados;

      pintarDestinos();

      const lim = opcoes.limites || {};
      const limites = get('iaNovaLimites');
      if (limites) {
        limites.textContent =
          `Até ${lim.arquivos} arquivos, ${lim.arquivo_mb} MB cada.`;
      }
      const exts = get('iaNovaExtensoes');
      if (exts) exts.textContent = (opcoes.extensoes || []).join('  ');
      if (input) input.accept = (opcoes.extensoes || []).join(',');

      // Sem a chave do Gemini, planilha ainda funciona — PDF e foto não. Dizer
      // isso agora poupa o usuário de montar o lote para falhar no fim.
      const aviso = get('iaNovaAvisoProvedor');
      if (aviso && !opcoes.provedores?.gemini) {
        aviso.classList.remove('hidden');
        aviso.textContent =
          'GEMINI_API_KEY não está no .env: só planilhas serão lidas. PDF e foto vão falhar.';
      }

      // Um destino só disponível já vem escolhido — não há decisão a tomar.
      const liberados = (opcoes.destinos || []).filter(d => d.pode_aplicar);
      if (liberados.length === 1) escolherDestino(liberados[0].id);
    } catch (err) {
      console.error('Falha ao abrir a nova leitura', err);
      showToast(err.message || 'Não foi possível abrir a nova leitura', 'error');
    } finally {
      atualizarBotao();
      // Sempre revela: um erro aqui não pode deixar o spinner girando para
      // sempre com a tela em branco por trás.
      revelar();
    }
  })();
})();
