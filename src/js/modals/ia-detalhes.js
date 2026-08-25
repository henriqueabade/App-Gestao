(function () {
  const OVERLAY = 'iaDetalhes';

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  /**
   * Fecha o modal, levando junto o popover.
   *
   * O popover foi movido para o `<body>` para escapar do `backdrop-filter`, e
   * por isso não sai com o modal: sem esta limpeza ele fica órfão na página e
   * o id duplicado quebra a próxima abertura.
   */
  const close = () => {
    window.Popover?.descartar(document.getElementById('iaDetLinhaPopover'));
    Modal.close(OVERLAY);
  };
  const revelar = () =>
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: OVERLAY }));

  const get = id => document.getElementById(id);

  // Sem devolver a leitura selecionada, o modal reabre depois de uma queda sem
  // saber o que carregar (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.(OVERLAY,
    () => ({ iaLeituraSelecionada: window.iaLeituraSelecionada }));

  const resumo = window.iaLeituraSelecionada;

  /** Última leitura carregada. É a fonte para redesenhar sem ir ao servidor. */
  let leitura = null;

  /**
   * Quais sub-listas estão abertas, por `${itemId}:${chave}`.
   *
   * Fica FORA do desenho de propósito: a grade é redesenhada inteira a cada
   * mudança de ação, e sem guardar isto a lista de contatos que o revisor
   * acabou de abrir se fecharia sozinha no meio da conferência.
   */
  const listasAbertas = new Set();

  const ROTULO_STATUS = {
    pendente: 'Pendente', aplicado: 'Aplicado', erro: 'Erro', ignorado: 'Descartado'
  };
  const COR_STATUS = {
    aplicado: 'var(--color-green)',
    erro: 'var(--color-red)',
    ignorado: 'rgba(255,255,255,0.45)',
    pendente: 'var(--color-primary-light)'
  };

  function formatarDataHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function formatarTamanho(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  const ICONE_ORIGEM = { planilha: 'fa-file-excel', pdf: 'fa-file-pdf', imagem: 'fa-file-image' };

  const podeEditar = () => leitura?.status === 'revisao' || leitura?.status === 'rascunho';

  // ---------------------------------------------------------------------------
  // Abas
  // ---------------------------------------------------------------------------

  function trocarAba(nome) {
    document.querySelectorAll('[data-aba-ia]').forEach(botao => {
      const ativa = botao.dataset.abaIa === nome;
      botao.setAttribute('aria-selected', String(ativa));
      // Sem classe de "aba ativa" no build offline do Tailwind, a distinção
      // vem do próprio botão: a ativa fica com a cor primária.
      botao.classList.toggle('btn-primary', ativa);
      botao.classList.toggle('btn-neutral', !ativa);
    });
    document.querySelectorAll('[data-painel-ia]').forEach(painel => {
      painel.classList.toggle('hidden', painel.dataset.painelIa !== nome);
    });
  }

  document.querySelectorAll('[data-aba-ia]').forEach(botao => {
    botao.addEventListener('click', () => trocarAba(botao.dataset.abaIa));
  });

  // ---------------------------------------------------------------------------
  // Cabeçalho e rodapé
  // ---------------------------------------------------------------------------

  function pintarCabecalho(d) {
    const titulo = get('iaDetTitulo');
    if (titulo) titulo.textContent = d.titulo || `Leitura #${d.id}`;

    const set = (id, valor) => { const el = get(id); if (el) el.textContent = valor; };
    set('iaDetDestino', d.destino_rotulo || d.destino || '—');
    set('iaDetData', formatarDataHora(d.criado_em));
    set('iaDetUsuario', d.usuario_nome || 'sem responsável');

    const status = get('iaDetStatus');
    if (status) {
      status.className = `badge-ia badge-ia--${d.status} flex-shrink-0`;
      status.textContent = d.status_rotulo || d.status || '—';
    }

    const erro = get('iaDetErro');
    if (erro) {
      erro.classList.toggle('hidden', !d.erro);
      erro.textContent = d.erro || '';
      // "3 linhas descartadas" é aviso, não falha: pintar de vermelho faria a
      // leitura boa parecer quebrada.
      erro.style.color = d.status === 'erro' ? 'var(--color-red)' : 'var(--color-primary-light)';
    }
  }

  /** Mostra só o botão que faz sentido para a situação atual da leitura. */
  function pintarRodape() {
    const extrair = get('iaDetExtrair');
    const aplicar = get('iaDetAplicar');
    const gravarTodos = get('iaDetGravarTodos');
    const descartar = get('iaDetDescartar');
    const aviso = get('iaDetRodapeAviso');
    if (!leitura) return;

    const temTexto = (leitura.arquivos || []).some(a => a.texto_tamanho > 0);
    const mostrarExtrair = leitura.pode_estruturar && temTexto
      && (leitura.status === 'rascunho' || leitura.status === 'revisao' || leitura.status === 'erro');
    const emRevisao = leitura.status === 'revisao' && leitura.pode_aplicar_destino;
    const pendentes = itensPendentes().length;
    const temFormulario = Boolean(MODULOS_DE_DESTINO[leitura.destino]);

    extrair?.classList.toggle('hidden', !mostrarExtrair);
    aplicar?.classList.toggle('hidden', !(emRevisao && pendentes > 0 && temFormulario));

    // Gravar tudo de uma vez só aparece quando abrir um formulário por linha
    // seria inviável. Com uma linha só, o caminho normal já dá conta e um
    // segundo botão ao lado dele seria só um jeito de errar.
    gravarTodos?.classList.toggle('hidden', !(emRevisao && pendentes > 1));

    // Descartar só existe quando há o que descartar: um botão permanentemente
    // sem efeito ensina o usuário a ignorar aquele canto da tela.
    const marcados = selecionados.size;
    descartar?.classList.toggle('hidden', !(emRevisao && marcados > 0));
    if (descartar && marcados > 0) {
      descartar.textContent = '';
      const icone = document.createElement('i');
      icone.className = 'fas fa-ban mr-2';
      descartar.append(icone,
        document.createTextNode(`Descartar ${marcados} selecionada${marcados > 1 ? 's' : ''}`));
    }

    if (aplicar && emRevisao && pendentes > 0 && temFormulario) {
      const rotulo = MODULOS_DE_DESTINO[leitura.destino].rotulo;
      aplicar.innerHTML = '<i class="fas fa-up-right-from-square mr-2"></i>'
        + (pendentes > 1 ? `Abrir a 1ª de ${pendentes} em ${rotulo}` : `Abrir em ${rotulo}`);
      aplicar.title = `Abre ${rotulo} com os dados preenchidos. Nada é gravado aqui: quem salva é você.`;
    }

    // O `title` e o `disabled` de "Gravar todos" pertencem a
    // `pintarResumoRevisao`, que é quem sabe se há campo obrigatório vazio.
    // Escrever aqui também apagaria aquele aviso, que é o mais importante dos
    // dois — e apagaria de forma intermitente, conforme a ordem em que as duas
    // funções acabassem de rodar.

    // Extrair de novo REFAZ a lista. Dizer isso antes do clique evita a
    // surpresa de perder correções já feitas à mão.
    if (extrair && mostrarExtrair) {
      const refazendo = leitura.status === 'revisao';
      extrair.innerHTML = refazendo
        ? '<i class="fas fa-rotate-right mr-2"></i>Extrair de novo'
        : '<i class="fas fa-table-list mr-2"></i>Extrair os dados';
      extrair.title = refazendo
        ? 'Refaz a lista a partir do mesmo texto — as correções feitas à mão nos itens pendentes serão perdidas'
        : 'Lê o texto guardado e monta a lista de itens';
    }

    if (!aviso) return;
    if (leitura.status === 'rascunho') {
      aviso.textContent = 'O texto já está guardado: extrair não precisa dos arquivos de novo.';
    } else if (leitura.status === 'revisao' && !leitura.pode_aplicar_destino) {
      aviso.textContent = 'Este destino ainda não sabe gravar — chega numa próxima etapa.';
    } else if (leitura.status === 'aplicada') {
      aviso.textContent = 'Leitura aplicada. Os registros criados por ela estão no módulo de destino.';
    } else {
      aviso.textContent = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Grade de revisão
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // O que é COLUNA e o que é DETALHE
  //
  // A grade responde "esta linha está certa?" de relance. Para isso serve o
  // punhado de campos que identificam a linha e mostram o que ela vale. Os
  // outros — forma de pagamento, observações, transportadora, validade — são
  // conferidos uma vez, olhando para aquela linha; ocupando coluna, espremiam
  // todas as outras a ponto de nenhuma poder ser lida.
  //
  // Quem decide é o esquema, com `naGrade: false`. O campo continua extraído,
  // continua editável e continua indo para o formulário: muda só onde aparece.
  // ---------------------------------------------------------------------------

  /**
   * Largura das colunas da sub-lista, por chave.
   *
   * Quantidade e unidade são curtas por natureza; o processo tem nome de
   * etapa. Deixá-las crescerem à vontade espremia o NOME DO INSUMO, que é a
   * única coluna que precisa ser lida inteira para se conferir a ficha contra
   * o papel — e era justamente ela que aparecia cortada.
   */
  /** Caixa e acento não distinguem opção na hora de casar o que foi digitado. */
  const normalizarOpcao = v => String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  const LARGURA_SUBCAMPO = {
    quantidade: 'ia-sub-qtde',
    unidade: 'ia-sub-unidade',
    processo: 'ia-sub-processo'
  };

  const camposDaGrade = campos => campos.filter(c => c.naGrade !== false);

  /**
   * Colunas CALCULADAS, que não vêm do esquema porque não vêm do documento.
   *
   * O valor total do pedido é a soma dos itens que a leitura montou — não o
   * total escrito no PDF. São coisas diferentes de propósito: o que interessa
   * é quanto o orçamento vai valer quando for criado, e é justamente a
   * diferença entre os dois números que revela um item que ficou de fora.
   *
   * Não é editável porque não é um dado, é uma conta: quem muda o total é
   * quem muda os itens, na sub-lista logo abaixo.
   */
  const CALCULADAS = {
    orcamentos: {
      rotulo: 'Valor total',
      largura: 'media',
      calcular: item => (Array.isArray(item.dados?.itens) ? item.dados.itens : [])
        .reduce((soma, i) => soma + (Number(i?.quantidade) || 0) * (Number(i?.valor_unitario) || 0), 0)
    }
  };

  const formatarDinheiro = valor =>
    (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const camposDoDetalhe = campos => campos.filter(c => c.naGrade === false);

  /** Linhas marcadas na grade, por id de item. */
  const selecionados = new Set();

  function pintarCabecalhoDaGrade(campos) {
    const linha = get('iaDetItensCabecalho');
    if (!linha) return;

    const th = (conteudo, classe) => {
      const el = document.createElement('th');
      if (classe) el.className = classe;
      if (typeof conteudo === 'string') el.textContent = conteudo;
      else el.appendChild(conteudo);
      return el;
    };

    // Marcar todos de uma vez: numa leitura de 18 clientes, descartar os que
    // não servem um a um é o tipo de trabalho que a leitura existe para evitar.
    const todos = document.createElement('input');
    todos.type = 'checkbox';
    todos.className = 'ia-selecao';
    todos.title = 'Marcar todas as linhas';
    todos.checked = selecionaveis().length > 0
      && selecionaveis().every(i => selecionados.has(i.id));
    todos.addEventListener('change', () => {
      selecionados.clear();
      if (todos.checked) for (const i of selecionaveis()) selecionados.add(i.id);
      desenharItens();
    });

    const calculada = CALCULADAS[leitura?.destino];

    linha.replaceChildren(
      th(todos, 'ia-col-selecao'),
      ...camposDaGrade(campos).map(c => th(c.rotulo, `ia-col-${c.largura || 'media'}`)),
      ...(calculada ? [th(calculada.rotulo, `ia-col-${calculada.largura}`)] : []),
      th('Situação', 'ia-col-pequena')
    );
  }

  /**
   * Itens que ainda podem ser marcados.
   *
   * Fora o que já virou cadastro (não volta atrás) e o que foi descartado (já
   * não vai a lugar nenhum). "Marcar todas" que pegasse os dois faria a
   * contagem do rodapé mentir.
   */
  const selecionaveis = () => (leitura?.itens || [])
    .filter(i => i.status !== 'aplicado' && i.acao !== 'ignorar' && i.status !== 'ignorado');

  /**
   * O (i) da linha: os campos que não viraram coluna, editáveis ali mesmo.
   *
   * Editáveis é o ponto. Se fosse só leitura, o revisor que visse a forma de
   * pagamento errada teria de abrir o formulário, corrigir lá, e repetir isso
   * para cada linha — e a correção não voltaria para a leitura, então extrair
   * de novo a perderia.
   */
  function abrirDetalheDaLinha(icone, item, campos, editavel) {
    const popover = get('iaDetLinhaPopover');
    if (!popover) return;

    popover.replaceChildren();

    const titulo = document.createElement('p');
    titulo.className = 'text-xs uppercase tracking-wide text-white/50 mb-3';
    titulo.textContent = 'Dados que não cabem na tabela';
    popover.appendChild(titulo);

    for (const campo of campos) {
      const linha = document.createElement('div');
      linha.className = 'ia-detalhe-linha';

      const rotulo = document.createElement('span');
      rotulo.className = 'ia-detalhe-rotulo';
      rotulo.textContent = campo.rotulo;
      linha.appendChild(rotulo);
      linha.appendChild(criarCampo(item, campo, editavel));

      popover.appendChild(linha);
    }

    // O modal tem `backdrop-blur`, que cria um bloco de contenção e faz
    // `position: fixed` deixar de ser relativo à janela. `Popover.abrir` tira
    // o elemento de lá e trata as bordas da tela — ver src/js/utils/popover.js.
    window.Popover?.abrir(popover, icone);
  }

  const fecharDetalheDaLinha = () => window.Popover?.fechar(get('iaDetLinhaPopover'));

  function desenharItens() {
    const corpo = get('iaDetItensCorpo');
    const vazio = get('iaDetItensVazio');
    const tabela = get('iaDetItensTabela');
    const itens = leitura?.itens || [];
    const campos = leitura?.campos || [];

    const contador = document.querySelector('[data-contador-ia="itens"]');
    if (contador) contador.textContent = itens.length ? `(${itens.length})` : '';

    if (!corpo) return;
    vazio?.classList.toggle('hidden', itens.length > 0);
    tabela?.classList.toggle('hidden', itens.length === 0);

    // Mensagem do estado vazio muda com a situação: "nada foi extraído" e
    // "ainda não extraí" mandam o usuário para lugares diferentes.
    if (vazio) {
      const texto = vazio.querySelector('p');
      if (texto) {
        texto.textContent = leitura?.status === 'rascunho'
          ? 'O texto já foi lido. Clique em "Extrair os dados" para montar a lista.'
          : 'Nenhum item foi extraído desta leitura.';
      }
    }

    pintarResumoRevisao();
    if (!itens.length) { corpo.replaceChildren(); return; }

    pintarCabecalhoDaGrade(campos);

    const naGrade = camposDaGrade(campos);
    const noDetalhe = camposDoDetalhe(campos);
    const colunas = naGrade.length + 2 + (CALCULADAS[leitura.destino] ? 1 : 0);
    const editavel = podeEditar();
    const linhas = [];

    for (const item of itens) {
      const tr = document.createElement('tr');
      tr.className = 'ia-linha-item'
        + (item.acao === 'ignorar' || item.status === 'ignorado' ? ' ia-linha-item--ignorada' : '')
        + (item.status === 'erro' ? ' ia-linha-item--erro' : '')
        + (item.status === 'aplicado' ? ' ia-linha-item--aplicada' : '')
        + (selecionados.has(item.id) ? ' ia-linha-item--marcada' : '');

      // Item já gravado não volta a ser editável: mexer nele daria a impressão
      // de corrigir um estoque que já entrou.
      const editavelAqui = editavel && item.status !== 'aplicado';

      // Coluna de seleção, no lugar do antigo número da linha. O número não
      // dizia nada que a ordem da tabela já não dissesse, e ocupava a largura
      // de que a primeira coluna de verdade precisava.
      // Linha descartada não pode ser marcada.
      //
      // Marcada, ela contaria no "Descartar N selecionadas" e no "Abrir a 1ª
      // de N" — os dois passariam a mentir sobre quantas linhas ainda vão a
      // algum lugar. E descartar o que já está descartado não faz nada, o que
      // ensina que o botão às vezes não funciona.
      const descartada = item.acao === 'ignorar' || item.status === 'ignorado';
      if (descartada) selecionados.delete(item.id);

      const tdSelecao = document.createElement('td');
      tdSelecao.className = 'ia-col-selecao';
      if (item.status !== 'aplicado' && !descartada) {
        const marca = document.createElement('input');
        marca.type = 'checkbox';
        marca.className = 'ia-selecao';
        marca.checked = selecionados.has(item.id);
        marca.dataset.selecionar = String(item.id);
        marca.addEventListener('change', () => {
          if (marca.checked) selecionados.add(item.id);
          else selecionados.delete(item.id);
          tr.classList.toggle('ia-linha-item--marcada', marca.checked);
          pintarRodape();
        });
        tdSelecao.appendChild(marca);
      }
      tr.appendChild(tdSelecao);

      naGrade.forEach((campo, indice) => {
        const td = document.createElement('td');
        if (item.dados_corrompidos) {
          td.className = 'text-sm';
          td.style.color = 'var(--color-red)';
          td.textContent = indice === 0 ? 'Conteúdo ilegível' : '';
          tr.appendChild(td);
          return;
        }

        // O (i) mora na primeira coluna, junto do que identifica a linha —
        // é onde o olho já está quando decide olhar os detalhes.
        if (indice === 0 && noDetalhe.length) {
          const caixa = document.createElement('div');
          caixa.className = 'ia-celula-com-info';

          const info = document.createElement('i');
          info.className = 'info-icon ia-info-item';
          info.dataset.detalhe = String(item.id);
          info.title = `${noDetalhe.length} campo(s) que não cabem na tabela`;
          // Um caminho só para os dois gestos: passar o mouse e clicar abrem
          // o mesmo popover, com as mesmas permissões. Dois handlers com a
          // mesma chamada escrita duas vezes é como um deles fica para trás
          // numa mudança futura.
          const abrir = () => abrirDetalheDaLinha(info, item, noDetalhe, editavelAqui);
          info.addEventListener('mouseenter', abrir);
          info.addEventListener('click', e => { e.stopPropagation(); abrir(); });

          caixa.append(info, campo.tipo === 'lista'
            ? criarCelulaDeLista(item, campo, editavelAqui)
            : criarCampo(item, campo, editavelAqui));
          td.appendChild(caixa);
          tr.appendChild(td);
          return;
        }

        td.appendChild(campo.tipo === 'lista'
          ? criarCelulaDeLista(item, campo, editavelAqui)
          : criarCampo(item, campo, editavelAqui));
        tr.appendChild(td);
      });

      const calculada = CALCULADAS[leitura.destino];
      if (calculada) {
        const td = document.createElement('td');
        td.className = 'text-sm text-white ia-valor-total';
        td.textContent = formatarDinheiro(calculada.calcular(item));
        td.title = 'Soma dos itens desta linha. Muda quando você corrige um item.';
        tr.appendChild(td);
      }

      const tdStatus = document.createElement('td');
      tdStatus.className = 'text-sm';
      tdStatus.style.color = COR_STATUS[item.status] || 'rgba(255,255,255,0.7)';
      tdStatus.textContent = ROTULO_STATUS[item.status] || item.status || '—';
      tr.appendChild(tdStatus);

      linhas.push(tr);

      for (const campo of naGrade) {
        if (campo.tipo !== 'lista') continue;
        if (!listasAbertas.has(`${item.id}:${campo.chave}`)) continue;
        linhas.push(criarSubTabela(item, campo, colunas, editavelAqui));
      }

      const nota = criarNota(item, colunas);
      if (nota) linhas.push(nota);
    }

    corpo.replaceChildren(...linhas);
    pintarSugestoes();
    pintarRodape();
  }

  /** Grava uma correção do revisor e devolve o item como ficou. */
  async function salvarItem(itemId, payload) {
    const resp = await fetchApi(`/api/ia/${leitura.id}/itens/${itemId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);
    return dados;
  }

  /** Sincroniza o item na lista em memória, para redesenhar sem ir ao servidor. */
  function atualizarEmMemoria(salvo) {
    const alvo = (leitura.itens || []).find(i => i.id === salvo.id);
    if (!alvo) return;
    Object.assign(alvo, salvo);
  }

  function criarCampo(item, campo, editavel) {
    const valor = item.dados?.[campo.chave];
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ia-campo';
    // `value` e não innerHTML/textContent: o valor veio de um documento
    // externo e passou por um modelo de linguagem.
    input.value = valor === null || valor === undefined ? '' : String(valor);
    input.dataset.chave = campo.chave;
    input.title = campo.rotulo;

    if (!editavel) {
      input.readOnly = true;
      return input;
    }

    const faltando = campo.obrigatorio && !String(input.value).trim();
    if (faltando) input.classList.add('ia-campo--faltando');

    // `change` e não `input`: salvar a cada tecla renderia uma requisição por
    // caractere digitado.
    input.addEventListener('change', async () => {
      const anterior = valor === null || valor === undefined ? '' : String(valor);
      if (input.value === anterior) return;
      try {
        const salvo = await salvarItem(item.id, { dados: { [campo.chave]: input.value } });
        atualizarEmMemoria(salvo);
        input.classList.remove('ia-campo--faltando');
        input.classList.add('ia-campo--salvo');
        setTimeout(() => input.classList.remove('ia-campo--salvo'), 900);
        // Redesenha só o resumo: refazer a grade inteira roubaria o foco de
        // quem está percorrendo as células com Tab.
        pintarResumoRevisao();
      } catch (err) {
        showToast(err.message || 'Não foi possível salvar a correção', 'error');
        input.value = anterior;
      }
    });

    return input;
  }

  /** "Ana Paula · Compras", para caber numa célula. */
  function resumirSubItem(sub, subcampos) {
    const partes = subcampos
      .map(sc => sub?.[sc.chave])
      .filter(v => v !== null && v !== undefined && String(v).trim());
    return partes.slice(0, 2).join(' · ') || '(em branco)';
  }

  /** Grava a lista inteira do campo: o backend valida entrada por entrada. */
  async function salvarLista(item, campo, lista) {
    const salvo = await salvarItem(item.id, { dados: { [campo.chave]: lista } });
    atualizarEmMemoria(salvo);
    desenharItens();
  }

  /**
   * Célula de um campo `lista`: quantos são, e um botão que abre a sub-tabela.
   *
   * Mostrar os contatos abertos em todas as linhas encheria a tela — vinte
   * empresas com três contatos cada viram oitenta linhas. Fechado por padrão,
   * o revisor abre o que quer conferir.
   */
  function criarCelulaDeLista(item, campo, editavel) {
    const caixa = document.createElement('div');
    caixa.className = 'ia-lista-resumo';

    const lista = Array.isArray(item.dados?.[campo.chave]) ? item.dados[campo.chave] : [];
    const chaveAberta = `${item.id}:${campo.chave}`;

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'ia-lista-abrir';
    const seta = listasAbertas.has(chaveAberta) ? 'fa-chevron-down' : 'fa-chevron-right';
    botao.innerHTML = `<i class="fas ${seta}"></i>`;
    const rotulo = document.createElement('span');
    rotulo.textContent = lista.length
      ? `${lista.length} ${campo.rotulo.toLowerCase()}`
      : `sem ${campo.rotulo.toLowerCase()}`;
    botao.appendChild(rotulo);
    botao.title = lista.length
      ? lista.map(sub => resumirSubItem(sub, campo.subcampos || [])).join(' | ')
      : `Nenhum ${campo.rotulo.toLowerCase()} lido para esta linha`;

    botao.addEventListener('click', () => {
      if (listasAbertas.has(chaveAberta)) listasAbertas.delete(chaveAberta);
      else listasAbertas.add(chaveAberta);
      desenharItens();
    });
    caixa.appendChild(botao);

    // Sem botão de acrescentar aqui, de propósito.
    //
    // Uma linha em branco na sub-lista não tem o que a torna útil: o campo de
    // busca contra o catálogo, a validação, o preço que vem do cadastro. Tudo
    // isso existe do outro lado, no formulário do módulo, e é lá que
    // acrescentar um item faz sentido. Aqui só se confere e se corrige o que a
    // leitura trouxe.
    return caixa;
  }

  /**
   * Sub-tabela de um campo `lista`, na linha logo abaixo do item.
   *
   * As colunas saem de `subcampos`, pelo mesmo caminho que desenha as de cima:
   * um destino novo com sub-lista funciona sem tocar aqui.
   */
  function criarSubTabela(item, campo, colunas, editavel) {
    const lista = Array.isArray(item.dados?.[campo.chave]) ? item.dados[campo.chave] : [];
    const subcampos = campo.subcampos || [];

    const tr = document.createElement('tr');
    tr.className = 'ia-sublinha';
    const td = document.createElement('td');
    td.colSpan = colunas;

    if (!lista.length) {
      td.className = 'ia-sublista-vazia';
      td.textContent = `Nenhum ${campo.rotulo.toLowerCase()} nesta linha.`;
      tr.appendChild(td);
      return tr;
    }

    const tabela = document.createElement('table');
    tabela.className = 'ia-sublista';

    const cabecalho = document.createElement('tr');
    for (const sc of subcampos) {
      const th = document.createElement('th');
      th.textContent = sc.rotulo;
      // Largura por chave: quantidade e unidade são curtas por natureza, e o
      // processo tem nome de etapa. Deixá-las crescerem à vontade espremia o
      // NOME DO INSUMO, que é a única coluna que precisa ser lida inteira para
      // se conferir a ficha contra o papel.
      if (LARGURA_SUBCAMPO[sc.chave]) th.className = LARGURA_SUBCAMPO[sc.chave];
      cabecalho.appendChild(th);
    }
    if (editavel) cabecalho.appendChild(document.createElement('th'));
    tabela.appendChild(cabecalho);

    lista.forEach((sub, indice) => {
      const linha = document.createElement('tr');

      // Insumo que não existe no estoque NÃO vai para o formulário. Descobrir
      // isso depois de salvar é descobrir tarde demais, então a linha inteira
      // fica vermelha aqui, onde ainda dá para cadastrar o que falta.
      if (sub && sub._casamento === null && String(sub.nome || '').trim()) {
        linha.className = 'ia-sublinha-item--sem-cadastro';
      }

      const travados = restritos();

      for (const sc of subcampos) {
        const celula = document.createElement('td');
        if (LARGURA_SUBCAMPO[sc.chave]) celula.className = LARGURA_SUBCAMPO[sc.chave];
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ia-campo';

        // A chave da sub-lista é prefixada pelo campo que a contém: as opções
        // de "nome" dentro de `insumos` não são as mesmas de um "nome" de
        // outro destino.
        const chaveCompleta = `${campo.chave}.${sc.chave}`;
        input.dataset.chave = chaveCompleta;

        // O que a tabela MOSTRA é o nome do cadastro quando ele existe: é ele
        // que vai para a receita, e é ele que precisa ser conferido. O nome
        // que o documento escreveu fica no (i), que é onde se procura a
        // origem de uma dúvida.
        const doCadastro = sc.chave === 'nome' && sub?._cadastro ? sub._cadastro : null;
        const valor = doCadastro ?? sub?.[sc.chave];
        input.value = valor === null || valor === undefined ? '' : String(valor);
        input.title = sc.rotulo;

        const opcoes = leitura?.sugestoes?.[chaveCompleta];
        const restrito = travados.has(chaveCompleta) && Array.isArray(opcoes) && opcoes.length;

        if (!editavel) input.readOnly = true;
        else {
          if (sc.obrigatorio && !String(input.value).trim()) input.classList.add('ia-campo--faltando');
          input.addEventListener('change', async () => {
            // Campo restrito só grava o que existe na tabela. Digitar é para
            // PROCURAR: um valor livre aqui não cria unidade nem etapa nenhuma
            // — cria um texto que o formulário do outro lado ignora calado.
            if (restrito && input.value.trim()) {
              const achado = opcoes.find(o => normalizarOpcao(o) === normalizarOpcao(input.value));
              if (!achado) {
                showToast(`"${input.value}" não está cadastrado em ${sc.rotulo}`, 'error');
                input.value = valor === null || valor === undefined ? '' : String(valor);
                return;
              }
              input.value = achado;
            }

            const copia = lista.map((x, i) => (i === indice
              ? { ...x, [sc.chave]: input.value, ...(sc.chave === 'nome' ? { _cadastro: null } : {}) }
              : x));
            try { await salvarLista(item, campo, copia); }
            catch (err) {
              showToast(err.message || 'Não foi possível salvar', 'error');
              input.value = valor === null || valor === undefined ? '' : String(valor);
            }
          });
        }
        // O (i) do nome, só quando o casamento foi por SEMELHANÇA.
        //
        // A tela mostra o nome LIDO, porque é ele que se confere contra o
        // papel. Mas o que vai para a receita é o nome do CADASTRO, e quando
        // os dois diferem quem revisa precisa poder ver para onde o insumo
        // foi. Casamento exato não ganha (i): não há nada a revelar, e um
        // ícone em toda linha viraria ruído que ninguém mais olha.
        if (sc.chave === 'nome' && sub && sub._casamento === 'semelhante' && sub._cadastro) {
          const caixa = document.createElement('div');
          caixa.className = 'ia-celula-com-info';
          const info = document.createElement('i');
          info.className = 'info-icon ia-info-insumo';
          // A tabela mostra o do cadastro; o (i) diz de onde ele veio. É esta
          // a direção útil: o que vai para a receita fica à vista, e a origem
          // — que só interessa quando algo parece errado — fica a um gesto.
          info.title = `O documento escreveu "${sub.nome}"`;
          caixa.append(info, input);
          celula.appendChild(caixa);
          linha.appendChild(celula);
          continue;
        }

        celula.appendChild(input);
        linha.appendChild(celula);
      }

      if (editavel) {
        const celula = document.createElement('td');
        const remover = document.createElement('button');
        remover.type = 'button';
        remover.className = 'ia-arquivo__remover';
        remover.title = 'Remover';
        remover.innerHTML = '<i class="fas fa-xmark"></i>';
        remover.addEventListener('click', async () => {
          try { await salvarLista(item, campo, lista.filter((_, i) => i !== indice)); }
          catch (err) { showToast(err.message || 'Não foi possível remover', 'error'); }
        });
        celula.appendChild(remover);
        linha.appendChild(celula);
      }

      tabela.appendChild(linha);
    });

    td.appendChild(tabela);
    tr.appendChild(td);
    return tr;
  }

  // ---------------------------------------------------------------------------
  // A coluna "O que fazer" foi embora
  //
  // Ela tinha um seletor de ação (cadastrar / atualizar / descartar) e, abaixo,
  // um campo para apontar o registro existente. Duas decisões por linha, numa
  // coluna que competia por largura com os dados que se estava conferindo.
  //
  // Nada disso se perdeu, mudou de lugar para onde já era mais natural:
  //
  //   descartar ..... marcar as linhas e usar "Descartar selecionados" no
  //                   rodapé — o mesmo gesto serve para uma linha ou dezoito;
  //   apontar ....... o botão "É o mesmo" na ressalva, que já existia e é onde
  //                   a dúvida aparece;
  //   cadastrar ..... virou o padrão, porque abrir o formulário do módulo com
  //                   os dados preenchidos É cadastrar, e quem confirma é quem
  //                   salva do outro lado.
  // ---------------------------------------------------------------------------

  /**
   * Aponta o item para um registro que já existe.
   *
   * É a saída do caso em que a reconciliação avisou "parecido com X" mas não
   * decidiu sozinha: com um clique o revisor confirma que é o mesmo, e o item
   * deixa de cadastrar um quase-duplicado.
   */
  async function apontarPara(item, alvoId, tabela) {
    try {
      // A tabela vai junto: no orçamento o alvo pode ser cliente OU
      // prospecção, e o id sozinho é ambíguo — apontar para a errada criaria o
      // orçamento na série errada, preso a outra empresa.
      const salvo = await salvarItem(item.id, {
        alvo_id: alvoId,
        acao: 'atualizar',
        ...(tabela ? { alvo_tabela: tabela } : {})
      });
      atualizarEmMemoria(salvo);
      desenharItens();
      showToast('Item apontado para o registro existente', 'success');
    } catch (err) {
      showToast(err.message || 'Não foi possível apontar o item', 'error');
    }
  }

  function criarNota(item, colunas) {
    if (!item.mensagem) return null;

    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colunas;
    td.className = 'ia-nota-item'
      + (item.status === 'erro' ? ' ia-nota-item--erro'
        : item.status === 'aplicado' ? ' ia-nota-item--ok'
          : ' ia-nota-item--alerta');
    td.textContent = item.mensagem;

    // A ressalva "Parecido com X (#7)" carrega o id do candidato. Oferecer o
    // atalho aqui é o que transforma um aviso em ação — sem ele, o revisor
    // teria de achar o insumo por conta própria.
    const sugestao = /\(#(\d+)\)/.exec(item.mensagem);
    if (sugestao && podeEditar() && item.status !== 'aplicado') {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.textContent = 'É o mesmo';
      botao.title = 'Aponta este item para o registro existente e muda a ação para dar entrada';
      botao.addEventListener('click', () => apontarPara(item, Number(sugestao[1])));
      td.appendChild(botao);
    }

    tr.appendChild(td);
    return tr;
  }

  /** Datalists de categoria/unidade, para o revisor encaixar no que já existe. */
  /** Chaves cujas opções são TABELA: aceita digitar para procurar, não para criar. */
  const restritos = () => new Set(leitura?.sugestoes?.__restritos || []);

  function pintarSugestoes() {
    const sugestoes = leitura?.sugestoes || {};
    for (const [chave, valores] of Object.entries(sugestoes)) {
      if (chave === '__restritos') continue;
      if (!Array.isArray(valores) || !valores.length) continue;
      const id = `iaDetSugestao-${chave}`;
      let lista = document.getElementById(id);
      if (!lista) {
        lista = document.createElement('datalist');
        lista.id = id;
        get('iaDetItensTabela')?.appendChild(lista);
      }
      lista.replaceChildren(...valores.map(v => {
        const o = document.createElement('option');
        o.value = v;
        return o;
      }));
      document.querySelectorAll(`.ia-campo[data-chave="${chave}"]`)
        .forEach(el => el.setAttribute('list', id));
    }
  }

  /**
   * O que vai acontecer ao aplicar, contado antes do clique.
   *
   * Sem isto, o revisor só descobre que 12 itens iam cadastrar em vez de dar
   * entrada depois que o estoque já ganhou 12 insumos novos.
   */
  function pintarResumoRevisao() {
    const caixa = get('iaDetResumoRevisao');
    if (!caixa) return;

    const itens = leitura?.itens || [];
    if (!itens.length || leitura.status !== 'revisao') {
      caixa.classList.add('hidden');
      return;
    }

    const conta = f => itens.filter(f).length;
    const pendentes = itens.filter(i => i.status !== 'aplicado');
    const criar = pendentes.filter(i => i.acao === 'criar').length;
    const atualizar = pendentes.filter(i => i.acao === 'atualizar').length;
    const ignorar = pendentes.filter(i => i.acao === 'ignorar').length;
    const jaAplicados = conta(i => i.status === 'aplicado');

    const campos = leitura.campos || [];
    const obrigatorios = campos.filter(c => c.obrigatorio);

    /**
     * Vazio depende do tipo. Para uma LISTA, vazio é não ter entrada nenhuma —
     * e `String([])` sendo `''` só acerta isso por coincidência: `String([{}])`
     * vira "[object Object]", que passa mesmo com a entrada em branco.
     */
    const emBranco = (campo, valor) => {
      if (campo.tipo === 'lista') return !Array.isArray(valor) || valor.length === 0;
      return valor === null || valor === undefined || String(valor).trim() === '';
    };

    const incompletos = pendentes.filter(i =>
      i.acao !== 'ignorar'
      && obrigatorios.some(c => emBranco(c, i.dados?.[c.chave]))).length;

    caixa.classList.remove('hidden');
    caixa.replaceChildren();

    const pedaco = (texto, valor, cor) => {
      const span = document.createElement('span');
      const forte = document.createElement('strong');
      forte.textContent = String(valor);
      if (cor) forte.style.color = cor;
      span.append(forte, document.createTextNode(` ${texto}`));
      return span;
    };
    const separador = () => {
      const s = document.createElement('span');
      s.className = 'ia-resumo-revisao__separador';
      s.textContent = '•';
      return s;
    };

    const partes = [];
    if (criar) partes.push(pedaco('a cadastrar', criar));
    if (atualizar) partes.push(pedaco('a dar entrada', atualizar));
    if (ignorar) partes.push(pedaco('descartados', ignorar, 'rgba(255,255,255,0.45)'));
    if (jaAplicados) partes.push(pedaco('já aplicados', jaAplicados, 'var(--color-green)'));
    if (incompletos) partes.push(pedaco('sem campo obrigatório', incompletos, 'var(--color-red)'));
    if (!partes.length) partes.push(pedaco('itens', pendentes.length));

    for (const [i, p] of partes.entries()) {
      if (i) caixa.appendChild(separador());
      caixa.appendChild(p);
    }

    // Item incompleto falha na hora de gravar. Avisar aqui é o que evita
    // aplicar, ver o erro e ter de voltar.
    // A trava vale para quem GRAVA. Abrir o formulário com um obrigatório
    // vazio não só é inofensivo como é o caminho certo: é lá que o campo vai
    // ser preenchido, com a validação do próprio módulo cobrando.
    const gravarTodos = get('iaDetGravarTodos');
    if (gravarTodos) {
      gravarTodos.disabled = incompletos > 0 || (criar + atualizar) === 0;
      gravarTodos.title = incompletos
        ? 'Preencha os campos obrigatórios em vermelho antes de gravar'
        : (criar + atualizar) === 0
          ? 'Não há item para gravar — todos estão descartados ou já aplicados'
          : 'Grava todas as linhas direto, sem passar pelo formulário';
    }
  }

  // ---------------------------------------------------------------------------
  // Arquivos
  // ---------------------------------------------------------------------------

  /** O texto que a IA leu de um arquivo. Um caminho só para os dois usos. */
  async function buscarTextoLido(extracaoId, arquivoId) {
    const resp = await fetchApi(`/api/ia/${extracaoId}/arquivos/${arquivoId}/texto`);
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);
    return dados;
  }

  /**
   * Abre (ou fecha) o painel de um arquivo.
   *
   * ---------------------------------------------------------------------------
   * DOIS TEXTOS, LADO A LADO
   *
   * À esquerda, o que a leitura transcreveu — inteiro, só de leitura, porque é
   * ele a resposta para "de onde veio este dado".
   *
   * À direita, o RECORTE: o que a pessoa quer que vá para a extração. Um
   * documento traz cabeçalho, rodapé, termos de garantia e colunas que não
   * interessam ao destino escolhido, e tudo isso custa contexto e dá ao modelo
   * em que se distrair. Quem sabe o que interessa é quem está olhando.
   *
   * Vazio à direita quer dizer "use tudo" — que é o comportamento de sempre.
   */
  async function alternarTexto(botao, extracaoId, arquivoId, alvo) {
    if (!alvo.classList.contains('hidden')) {
      alvo.classList.add('hidden');
      botao.textContent = 'Ver o que foi lido';
      return;
    }

    if (!alvo.dataset.carregado) {
      botao.disabled = true;
      botao.textContent = 'Carregando…';
      try {
        const dados = await buscarTextoLido(extracaoId, arquivoId);
        montarPaineisDeTexto(alvo, extracaoId, arquivoId, dados);
        alvo.dataset.carregado = '1';
      } catch (err) {
        console.error('Falha ao ler o texto extraído', err);
        showToast(err.message || 'Não foi possível carregar o texto', 'error');
        botao.disabled = false;
        botao.textContent = 'Ver o que foi lido';
        return;
      }
      botao.disabled = false;
    }

    alvo.classList.remove('hidden');
    botao.textContent = 'Ocultar';
  }

  /** Os dois painéis: a transcrição e o recorte. */
  function montarPaineisDeTexto(alvo, extracaoId, arquivoId, dados) {
    alvo.replaceChildren();

    const grade = document.createElement('div');
    grade.className = 'ia-texto-grade';

    // --- O que foi lido -----------------------------------------------------
    const ladoLido = document.createElement('div');
    ladoLido.className = 'ia-texto-lado';

    const tituloLido = document.createElement('p');
    tituloLido.className = 'ia-texto-titulo';
    tituloLido.textContent = `O que foi lido  ·  ${(dados.texto || '').length.toLocaleString('pt-BR')} caracteres`;
    ladoLido.appendChild(tituloLido);

    const lido = document.createElement('pre');
    lido.className = 'ia-texto-corpo modal-scroll';
    lido.textContent = dados.texto || '(nada foi extraído deste arquivo)';
    ladoLido.appendChild(lido);

    // --- O que vai para a IA ------------------------------------------------
    const ladoEnvio = document.createElement('div');
    ladoEnvio.className = 'ia-texto-lado';

    const tituloEnvio = document.createElement('p');
    tituloEnvio.className = 'ia-texto-titulo';
    ladoEnvio.appendChild(tituloEnvio);

    const recorte = document.createElement('textarea');
    recorte.className = 'ia-texto-corpo ia-texto-recorte modal-scroll';
    recorte.value = dados.texto_ajustado || '';
    recorte.placeholder = 'Cole aqui só o trecho que a IA deve processar.\n\n'
      + 'Vazio = manda o texto inteiro, como sempre foi.';
    ladoEnvio.appendChild(recorte);

    const atualizarTitulo = () => {
      const n = recorte.value.trim().length;
      tituloEnvio.textContent = n
        ? `O que vai para a IA  ·  ${n.toLocaleString('pt-BR')} caracteres`
        : 'O que vai para a IA  ·  vazio: manda o texto inteiro';
      tituloEnvio.classList.toggle('ia-texto-titulo--ativo', n > 0);
    };
    atualizarTitulo();
    recorte.addEventListener('input', atualizarTitulo);

    const acoes = document.createElement('div');
    acoes.className = 'ia-texto-acoes';

    const copiarTudo = document.createElement('button');
    copiarTudo.type = 'button';
    copiarTudo.className = 'ia-btn-transparente rounded-lg px-3 py-1.5 text-xs';
    copiarTudo.textContent = 'Copiar tudo para cá';
    copiarTudo.title = 'Traz o texto inteiro para recortar aqui';
    copiarTudo.addEventListener('click', () => {
      recorte.value = dados.texto || '';
      atualizarTitulo();
    });

    const salvar = document.createElement('button');
    salvar.type = 'button';
    salvar.className = 'btn-primary text-white rounded-lg px-3 py-1.5 text-xs font-medium';
    salvar.textContent = 'Salvar recorte';
    const gravarRecorte = async () => {
      try {
        const resp = await fetchApi(`/api/ia/${extracaoId}/arquivos/${arquivoId}/texto`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ texto_ajustado: recorte.value })
        });
        const salvo = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(salvo.error || `Erro ${resp.status}`);

        dados.texto_ajustado = salvo.texto_ajustado || '';
        recorte.value = dados.texto_ajustado;
        atualizarTitulo();
        showToast(salvo.ajustado_tamanho
          ? 'Recorte salvo — a próxima extração usa só ele'
          : 'Recorte apagado — a próxima extração usa o texto inteiro', 'success');
      } catch (err) {
        console.error('Falha ao salvar o recorte', err);
        showToast(err.message || 'Não foi possível salvar o recorte', 'error');
      }
    };

    // Gravar sai para o servidor: dois cliques rápidos mandariam o mesmo
    // recorte duas vezes e o segundo poderia chegar antes do primeiro.
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(salvar, gravarRecorte);
    else salvar.addEventListener('click', gravarRecorte);
    acoes.append(copiarTudo, salvar);
    ladoEnvio.appendChild(acoes);

    grade.append(ladoLido, ladoEnvio);
    alvo.appendChild(grade);
  }

  /**
   * Copia para a área de transferência o texto lido de um arquivo.
   *
   * Busca no servidor em vez de ler o que está na tela: o painel só existe
   * depois de "Ver o que foi lido", e copiar não deveria exigir abrir antes.
   */
  async function copiarTextoDoArquivo(botao, extracaoId, arquivoId) {
    try {
      const dados = await buscarTextoLido(extracaoId, arquivoId);

      const texto = dados.texto || '';
      if (!texto) { showToast('Este arquivo não tem texto lido', 'info'); return; }

      await navigator.clipboard.writeText(texto);
      // A confirmação vai no próprio botão, e não só num toast: é ali que o
      // olho está no momento do clique.
      botao.classList.add('ia-btn-copiar--feito');
      setTimeout(() => botao.classList.remove('ia-btn-copiar--feito'), 1200);
      showToast(`${texto.length.toLocaleString('pt-BR')} caracteres copiados`, 'success');
    } catch (err) {
      console.error('Falha ao copiar o texto lido', err);
      showToast(err?.message || 'Não foi possível copiar', 'error');
    }
  }

  function pintarArquivos(extracaoId, arquivos) {
    const lista = get('iaDetArquivosLista');
    const vazio = get('iaDetArquivosVazio');
    const contador = document.querySelector('[data-contador-ia="arquivos"]');
    if (contador) contador.textContent = arquivos.length ? `(${arquivos.length})` : '';

    if (!lista) return;
    vazio?.classList.toggle('hidden', arquivos.length > 0);
    if (!arquivos.length) { lista.replaceChildren(); return; }

    lista.replaceChildren(...arquivos.map(a => {
      const card = document.createElement('div');
      card.className = 'ia-provedor';

      const topo = document.createElement('div');
      topo.className = 'flex items-center justify-between gap-4';

      const esquerda = document.createElement('div');
      esquerda.className = 'flex items-center gap-3 min-w-0';

      const icone = document.createElement('i');
      icone.className = `fas ${ICONE_ORIGEM[a.origem] || 'fa-file'} text-[var(--color-primary)]`;
      esquerda.appendChild(icone);

      const nome = document.createElement('div');
      nome.className = 'min-w-0';
      const linha1 = document.createElement('p');
      linha1.className = 'text-sm text-white truncate';
      // O nome do arquivo vem de fora do sistema: textContent, sempre.
      linha1.textContent = a.nome_arquivo;
      const linha2 = document.createElement('p');
      linha2.className = 'text-xs text-white/45';
      linha2.textContent = [
        formatarTamanho(a.tamanho_bytes),
        a.paginas ? `${a.paginas} página${a.paginas > 1 ? 's' : ''}` : null,
        a.texto_tamanho ? `${a.texto_tamanho.toLocaleString('pt-BR')} caracteres lidos` : 'nada foi lido'
      ].filter(Boolean).join('  ·  ');
      nome.append(linha1, linha2);
      esquerda.appendChild(nome);
      topo.appendChild(esquerda);

      const acoes = document.createElement('div');
      acoes.className = 'flex items-center gap-2 flex-shrink-0';

      // Copiar o texto lido.
      //
      // É o que permite conferir a transcrição contra o documento fora daqui —
      // colar num editor, procurar um número, comparar lado a lado. Sem isto,
      // a única forma de tirar o texto da tela é selecionar com o mouse dentro
      // de uma caixa que rola, o que na prática ninguém consegue fazer inteiro.
      const copiar = document.createElement('button');
      copiar.type = 'button';
      copiar.className = 'ia-btn-copiar';
      copiar.dataset.copiar = String(a.id);
      copiar.title = 'Copiar o texto lido deste arquivo';
      copiar.innerHTML = '<i class="fas fa-copy"></i>';
      copiar.disabled = !a.texto_tamanho;
      copiar.addEventListener('click', () => copiarTextoDoArquivo(copiar, extracaoId, a.id));
      acoes.appendChild(copiar);

      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'btn-neutral text-white rounded-lg px-3 py-1.5 text-xs font-medium flex-shrink-0';
      botao.textContent = 'Ver o que foi lido';
      acoes.appendChild(botao);

      topo.appendChild(acoes);
      card.appendChild(topo);

      if (a.erro) {
        const erro = document.createElement('p');
        erro.className = 'text-xs mt-2';
        erro.style.color = 'var(--color-red)';
        erro.textContent = a.erro;
        card.appendChild(erro);
      }

      // O painel dos dois textos. A altura sai do CSS e acompanha o modal:
      // 220px fixos deixavam metade da caixa vazia num modal que agora ocupa
      // 90% da tela, e obrigavam a rolar um texto que teria cabido inteiro.
      const texto = document.createElement('div');
      texto.className = 'hidden mt-3 ia-arquivo-paineis';
      card.appendChild(texto);

      botao.addEventListener('click', () => alternarTexto(botao, extracaoId, a.id, texto));
      if (!a.texto_tamanho) botao.disabled = true;

      return card;
    }));
  }

  // ---------------------------------------------------------------------------
  // Abrir o módulo de destino, já preenchido
  //
  // É o que a leitura FAZ. Ela não grava: prepara o formulário que a pessoa já
  // conhece — com a validação, os selects e as travas do próprio módulo — e
  // devolve o controle. Quem confere e salva é o usuário.
  //
  // O preenchimento tem duas metades, e a divisão não é arbitrária:
  //
  //   CAMPOS SIMPLES   caixas de texto, por id. Este mapa é a única coisa aqui
  //                    que depende do HTML dos outros módulos, e existe um
  //                    teste que confere cada id contra o arquivo de cada modal.
  //
  //   CONTEÚDO         tudo o que NÃO é caixa de texto: a lista de contatos, a
  //                    tabela de insumos por processo, os itens do orçamento, e
  //                    os selects que só têm opções depois de um `fetch`.
  //
  // A segunda metade é a que estava faltando, e era ela que fazia o formulário
  // abrir pela metade. Ela não é preenchida daqui: cada modal já declara, para
  // a restauração de trabalho, COMO repor o próprio conteúdo — e declarou bem,
  // porque teve de acertar as ordens difíceis (o cliente antes do contato, o
  // país antes do estado, os itens antes do total). `EstadoTrabalho.preencher`
  // reaproveita exatamente esse contrato. Escrever um segundo mecanismo aqui
  // significaria redescobrir cada uma dessas ordens, e descobrir errado em
  // silêncio.
  //
  // As IDENTIDADES (insumo_id, produto_id, o cliente) vêm resolvidas do
  // backend, por `GET /api/ia/:id/itens/:itemId/preenchimento`. Resolver isso
  // aqui exigiria baixar a matéria-prima e o catálogo inteiros e repetir, em
  // JavaScript de tela, a normalização de nome que o backend já faz e testa.
  // ---------------------------------------------------------------------------

  const MODULOS_DE_DESTINO = {
    materia_prima: {
      rotulo: 'Novo Insumo',
      html: 'modals/materia-prima/novo.html',
      script: '../js/modals/materia-prima-novo.js',
      overlay: 'novoInsumo',
      css: 'materia-prima',
      campos: {
        nome: 'nome',
        quantidade: 'quantidade',
        preco_unitario: 'preco',
        descricao: 'descricao'
      }
    },
    clientes: {
      rotulo: 'Novo Cliente',
      html: 'modals/clientes/novo.html',
      script: '../js/modals/cliente-novo.js',
      overlay: 'novoCliente',
      css: 'clientes',
      campos: {
        nome_fantasia: 'empresaNomeFantasia',
        razao_social: 'empresaRazaoSocial',
        cnpj: 'empresaCnpj',
        inscricao_estadual: 'empresaInscricaoEstadual',
        site: 'empresaSite',
        end_logradouro: 'regRua',
        end_numero: 'regNumero',
        end_complemento: 'regComplemento',
        end_bairro: 'regBairro',
        end_cidade: 'regCidade',
        end_cep: 'regCep'
      }
    },
    prospeccoes: {
      rotulo: 'Nova Prospecção',
      html: 'modals/prospeccoes/novo.html',
      script: '../js/modals/prospeccao-novo.js',
      overlay: 'novaProspeccao',
      css: 'prospeccoes',
      campos: {
        nome_fantasia: 'prosNomeFantasia',
        razao_social: 'prosRazaoSocial',
        segmento: 'prosSegmento',
        cnpj: 'prosCnpj',
        inscricao_estadual: 'prosInscricaoEstadual',
        site: 'prosSite',
        end_logradouro: 'endRua',
        end_numero: 'endNumero',
        end_complemento: 'endComplemento',
        end_bairro: 'endBairro',
        end_cidade: 'endCidade',
        end_cep: 'endCep'
      }
    },
    produto_insumos: {
      rotulo: 'Novo Produto',
      html: 'modals/produtos/novo.html',
      script: '../js/modals/produto-novo.js',
      overlay: 'novoProduto',
      css: 'produtos',
      campos: {
        nome: 'nomeInput',
        codigo: 'codigoInput'
      }
    },
    orcamentos: {
      rotulo: 'Novo Orçamento',
      html: 'modals/orcamentos/novo.html',
      script: '../js/modals/orcamento-novo.js',
      overlay: 'novoOrcamento',
      css: 'orcamentos',
      campos: {
        validade: 'novoValidade',
        observacoes: 'novoObservacoes'
      }
    }
  };

  /**
   * O valor de "Brasil" no <select> de país, lido das opções que ele tem.
   *
   * A lista de países vem de um serviço de geografia internacional, e o rótulo
   * pode ser "Brasil" ou "Brazil" conforme o idioma que ele devolver. Escrever
   * um dos dois aqui funcionaria até o dia em que não funcionasse — calado,
   * porque select que recebe valor inexistente não reclama, só fica vazio.
   */
  function valorDoBrasil(idSelect) {
    const select = document.getElementById(idSelect);
    const achado = Array.from(select?.options || [])
      .find(o => /^bra[sz]il$/i.test(String(o.value).trim()));
    return achado ? achado.value : '';
  }

  /**
   * O conteúdo dinâmico, na forma que o `capturar` de cada modal produz.
   *
   * É um acoplamento real com cada módulo, e é o mesmo que a restauração de
   * trabalho já tem: são as duas pontas do contrato que aquele modal declarou.
   */
  const CONTEUDO_DO_DESTINO = {
    // Categoria, unidade e processo são selects montados por requisição — o
    // `restaurar` do módulo sabe esperar as opções chegarem.
    materia_prima: carga => ({
      categoria: carga.campos.categoria || '',
      unidade: carga.campos.unidade || '',
      processo: ''
    }),

    clientes: carga => ({
      contatos: carga.contatos || [],
      // O estado só carrega depois do país, e as opções dele são nomes por
      // extenso — "Rio Grande do Sul", não "RS". O backend manda os dois.
      enderecos: {
        reg: {
          pais: carga.campos.end_estado_nome ? valorDoBrasil('regPais') : '',
          estado: carga.campos.end_estado_nome || ''
        },
        cob: { pais: '', estado: '' },
        ent: { pais: '', estado: '' }
      }
    }),

    prospeccoes: carga => ({
      contatos: carga.contatos || [],
      pais: carga.campos.end_estado_nome ? valorDoBrasil('endPais') : '',
      estado: carga.campos.end_estado_nome || ''
    }),

    // A tabela de insumos do produto agrupa por processo e ordena pela posição.
    // O backend já mandou os dois resolvidos, junto com o id e o preço.
    produto_insumos: carga => ({ itens: (carga.insumos || []).map(i => ({ ...i })) }),

    orcamentos: carga => {
      const pagamento = carga.pagamento || {};
      return {
        // A tabela do orçamento guarda os valores como texto simples, e é
        // assim que ela é relida para recalcular o total: número com ponto
        // decimal, sem símbolo de moeda.
        itens: (carga.itens || []).map(i => ({
          id: String(i.produto_id),
          nome: i.nome,
          qtd: String(i.quantidade),
          valor: String(i.valor_unitario),
          valorDesc: String(i.valor_unitario),
          desc: '0'
        })),

        // O cliente é o PRIMEIRO select a ser reposto: é o `change` dele que
        // carrega as listas de contato e de transportadora. Os outros dois só
        // existem depois disso, e o `restaurar` do módulo já sabe dessa ordem.
        selects: {
          novoCliente: carga.alvo ? String(carga.alvo.id) : '',
          novoContato: carga.contato ? String(carga.contato.id) : '',
          novoTransportadora: carga.transportadora ? String(carga.transportadora.id) : '',
          novoFormaPagamento: pagamento.forma || ''
        },

        // Condição de pagamento: é ela que decide se o formulário mostra o
        // campo de prazo ou o bloco de parcelamento.
        condicao: pagamento.condicao || '',
        condicaoDefinida: Boolean(pagamento.condicao),
        prazoVista: pagamento.prazo_vista || '',
        parcelamento: pagamento.parcelas || null
      };
    }
  };

  /**
   * Garante que o CSS do módulo de destino esteja na página.
   *
   * O programa carrega UMA folha de módulo por vez (`#page-style`), trocada a
   * cada navegação. Abrir o formulário de Produtos com o módulo de IA ativo
   * traz o HTML e o JavaScript dele, mas não o `produtos.css` — e o que se vê
   * é o formulário certo com metade do estilo: botões quadrados onde deviam
   * ser redondos, espaçamentos de outro lugar.
   *
   * A folha entra com um id próprio e FICA: recarregá-la a cada abertura
   * piscaria a tela, e ela não conflita com a do módulo ativo (cada módulo
   * escopa o que é seu).
   */
  function garantirEstiloDoModulo(config) {
    const pagina = config.css;
    if (!pagina) return;

    const id = `ia-estilo-${pagina}`;
    if (document.getElementById(id)) return;

    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `../css/${pagina}.css`;
    document.head.appendChild(link);
  }

  /**
   * O véu com a logo, enquanto o formulário é montado e preenchido.
   *
   * Abrir o formulário de destino não é instantâneo: busca a carga no
   * servidor, carrega HTML e script do outro módulo, espera os selects
   * assíncronos e só então preenche. Sem o véu, o que se vê nesse intervalo é
   * um formulário vazio que vai ganhando valores sozinho, campo a campo — que
   * parece defeito, não carregamento.
   */
  function abrirVeu() {
    const veu = document.createElement('div');
    veu.id = 'iaAbrindoModulo';
    veu.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    veu.style.zIndex = 'var(--z-dialog)';
    veu.innerHTML = '<div class="app-loading-indicator app-loading-indicator--compact" aria-hidden="true">'
      + '<span class="module-loading-orbit"></span>'
      + '<span class="module-loading-core"><img src="../assets/Logo.ico" alt=""></span></div>';
    document.body.appendChild(veu);
    return veu;
  }

  /**
   * Abre o modal por cima e espera ele terminar de montar.
   *
   * O overlay NÃO é revelado aqui: quem revela é `abrirNoModulo`, depois de
   * preencher. Revelar antes mostraria o formulário em branco enchendo-se
   * sozinho.
   */
  function abrirPorCima(config) {
    garantirEstiloDoModulo(config);
    const pronto = new Promise(resolve => {
      function aoAbrir(e) {
        if (e.detail !== config.overlay) return;
        window.removeEventListener('modalSpinnerLoaded', aoAbrir);
        resolve();
      }
      window.addEventListener('modalSpinnerLoaded', aoAbrir);
      // Nem todo modal anuncia; depois de um tempo, segue assim mesmo.
      setTimeout(() => { window.removeEventListener('modalSpinnerLoaded', aoAbrir); resolve(); }, 2500);
    });

    // O modal de destino abre POR CIMA do de IA: fechar o de baixo perderia a
    // revisão, e quem salva do outro lado quer voltar para ela.
    Modal.open(config.html, config.script, config.overlay, true);
    return pronto;
  }

  /** Quantos itens o preenchimento levou para o formulário. */
  function contarConteudo(destino, conteudo) {
    if (destino === 'clientes' || destino === 'prospeccoes') {
      return { quantos: (conteudo.contatos || []).length, oQue: 'contato(s)' };
    }
    if (destino === 'produto_insumos') {
      return { quantos: (conteudo.itens || []).length, oQue: 'insumo(s)' };
    }
    if (destino === 'orcamentos') {
      return { quantos: (conteudo.itens || []).length, oQue: 'item(ns)' };
    }
    return { quantos: 0, oQue: '' };
  }

  async function abrirNoModulo(item) {
    const config = MODULOS_DE_DESTINO[leitura?.destino];
    if (!config) {
      showToast('Este destino ainda não abre o módulo preenchido', 'info');
      return;
    }

    const veu = abrirVeu();
    let carga;
    try {
      const resp = await fetchApi(`/api/ia/${leitura.id}/itens/${item.id}/preenchimento`);
      carga = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(carga.error || `Erro ${resp.status}`);
    } catch (err) {
      veu.remove();
      showToast(err?.message || 'Não foi possível preparar o formulário', 'error');
      return;
    }

    await abrirPorCima(config);

    // Os campos simples, por id. `EstadoTrabalho` aplica o valor E avisa a tela
    // pelos dois eventos — sem isso o formulário fica com o valor à mostra e o
    // estado interno vazio.
    const campos = [];
    for (const [chave, id] of Object.entries(config.campos)) {
      const valor = carga.campos[chave];
      if (valor === null || valor === undefined || valor === '') continue;
      campos.push({ chave: `#${id}`, valor: String(valor) });
    }

    const conteudo = (CONTEUDO_DO_DESTINO[leitura.destino] || (() => null))(carga);

    let resultado = { campos: 0, conteudo: false };
    try {
      resultado = await window.EstadoTrabalho.preencher(config.overlay, { campos, conteudo });
    } catch (err) {
      console.error('Falha ao preencher o formulário', err);
    } finally {
      // Só agora o formulário aparece: cheio, de uma vez. E o véu sai no
      // `finally` para que uma falha no preenchimento não deixe a tela
      // bloqueada por um véu que ninguém consegue tirar.
      document.getElementById(`${config.overlay}Overlay`)?.classList.remove('hidden');
      veu.remove();
    }

    const { quantos, oQue } = contarConteudo(leitura.destino, conteudo || {});
    const partes = [`${resultado.campos} campo(s) preenchido(s)`];
    if (quantos) partes.push(`${quantos} ${oQue}`);
    if (!resultado.campos && !quantos) {
      showToast('Nada do que foi lido coube neste formulário', 'info');
      return;
    }

    // O que o backend não conseguiu casar aparece AGORA, antes de a pessoa
    // salvar. Depois vira material errado numa receita, ou item faltando num
    // preço que já foi para o cliente.
    if (carga.avisos?.length) partes.push(carga.avisos.join(' · '));
    showToast(`${partes.join(' · ')} — confira e salve`, carga.avisos?.length ? 'info' : 'success');
  }

  // ---------------------------------------------------------------------------
  // Extrair e aplicar
  // ---------------------------------------------------------------------------

  async function carregar() {
    const resp = await fetchApi(`/api/ia/${resumo.id}`);
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);
    leitura = dados;
    pintarCabecalho({ ...resumo, ...dados });
    pintarRodape();
    desenharItens();
    pintarArquivos(dados.id, Array.isArray(dados.arquivos) ? dados.arquivos : []);
  }

  async function extrair() {
    // Refazer descarta as correções manuais dos itens pendentes. Perguntar
    // antes é mais barato do que refazer o trabalho de revisão.
    if (leitura?.status === 'revisao' && window.DialogPadrao?.confirm) {
      const seguir = await window.DialogPadrao.confirm({
        title: 'Extrair de novo',
        message: 'A lista atual será refeita a partir do mesmo texto. '
          + 'As correções feitas à mão nos itens ainda não aplicados serão perdidas.',
        confirmText: 'Extrair de novo',
        cancelText: 'Voltar'
      });
      if (!seguir) return;
    }

    try {
      const resp = await fetchApi(`/api/ia/${leitura.id}/estruturar`, { method: 'POST' });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);

      await carregar();
      trocarAba('itens');
      window.IaModulo?.carregar?.(true);

      if (dados.status === 'erro') showToast('A IA não encontrou itens neste documento', 'error');
      else if (dados.avisos?.length) showToast(`${dados.itens_qtd} itens extraídos — há ressalvas`, 'info');
      else showToast(`${dados.itens_qtd} itens extraídos`, 'success');
    } catch (err) {
      console.error('Falha ao extrair os dados', err);
      showToast(err.message || 'Não foi possível extrair os dados', 'error');
      await carregar().catch(() => {});
    }
  }

  /** Linhas que ainda não viraram cadastro e não foram descartadas. */
  const itensPendentes = () => (leitura?.itens || [])
    .filter(i => i.status !== 'aplicado' && i.acao !== 'ignorar');

  /**
   * O caminho normal: abre o formulário do módulo com a primeira linha
   * pendente. Nada é gravado daqui.
   *
   * Com várias linhas, abre uma de cada vez. Abrir dez formulários de uma vez
   * não é uma tela, é uma pilha — e o modal de IA continua embaixo, então
   * voltar para a próxima é um clique.
   */
  async function abrirPrimeiroPendente() {
    const pendentes = itensPendentes();
    if (!pendentes.length) {
      showToast('Nenhuma linha pendente nesta leitura', 'info');
      return;
    }
    // A seleção manda quando existe: numa leitura de dezoito linhas, "a
    // primeira pendente" quase nunca é a que se quer abrir agora. Sem seleção,
    // segue a ordem da tabela.
    const escolhida = pendentes.find(i => selecionados.has(i.id)) || pendentes[0];
    await abrirNoModulo(escolhida);
  }

  /**
   * Descarta as linhas marcadas.
   *
   * Descartar não apaga: o item continua na leitura, com a procedência
   * intacta, e some do que vai virar cadastro. Apagar de verdade jogaria fora
   * a resposta para "de onde veio este dado" — que é metade do motivo de a
   * leitura existir.
   */
  async function descartarSelecionados() {
    const alvos = itensPendentes().filter(i => selecionados.has(i.id));
    if (!alvos.length) { showToast('Nenhuma linha marcada', 'info'); return; }

    if (window.DialogPadrao?.confirm) {
      const seguir = await window.DialogPadrao.confirm({
        title: 'Descartar linhas',
        message: `${alvos.length} linha(s) deixam de ser cadastradas. `
          + 'Elas continuam na leitura, para você poder conferir de onde vieram.',
        confirmText: 'Descartar',
        cancelText: 'Voltar'
      });
      if (!seguir) return;
    }

    const falhas = [];
    for (const item of alvos) {
      try {
        atualizarEmMemoria(await salvarItem(item.id, { acao: 'ignorar' }));
        selecionados.delete(item.id);
      } catch (err) {
        falhas.push(err?.message || `linha ${item.linha}`);
      }
    }

    desenharItens();
    if (falhas.length) showToast(`${falhas.length} linha(s) não puderam ser descartadas`, 'error');
    else showToast(`${alvos.length} linha(s) descartada(s)`, 'success');
  }

  async function gravarTodos() {
    const pendentes = itensPendentes().length;

    // Sem o componente carregado, cai no confirm do navegador em vez de
    // seguir direto: gravar em estoque sem confirmação nenhuma é pior do que
    // uma caixa feia.
    if (!window.DialogPadrao?.confirm) {
      if (typeof confirm === 'function'
        && !confirm(`${pendentes} item(ns) vão ser gravados em ${leitura.destino_rotulo}. Continuar?`)) return;
    }
    if (window.DialogPadrao?.confirm) {
      const seguir = await window.DialogPadrao.confirm({
        title: 'Aplicar a leitura',
        message: `${pendentes} item(ns) vão ser gravados em ${leitura.destino_rotulo}. `
          + 'Isso mexe no estoque de verdade e não é desfeito automaticamente.',
        confirmText: 'Aplicar',
        cancelText: 'Revisar mais'
      });
      if (!seguir) return;
    }

    try {
      const resp = await fetchApi(`/api/ia/${leitura.id}/aplicar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destino: leitura.destino })
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);

      await carregar();
      window.IaModulo?.carregar?.(true);

      if (dados.com_erro) {
        showToast(`${dados.aplicados} gravados, ${dados.com_erro} com erro — veja as linhas em vermelho`, 'error');
      } else {
        showToast(`${dados.aplicados} item(ns) gravados em ${leitura.destino_rotulo}`, 'success');
      }
    } catch (err) {
      console.error('Falha ao aplicar a leitura', err);
      showToast(err.message || 'Não foi possível aplicar', 'error');
      await carregar().catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Início
  // ---------------------------------------------------------------------------

  get('iaDetFechar')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  // Extrair consome crédito e gravar mexe em estoque: os dois passam pela
  // trava de duplo clique, que segura o botão até a ação terminar. Abrir o
  // formulário entra na mesma trava para não empilhar dois modais iguais.
  for (const [id, acao] of [
    ['iaDetExtrair', extrair],
    ['iaDetAplicar', abrirPrimeiroPendente],
    ['iaDetGravarTodos', gravarTodos],
    ['iaDetDescartar', descartarSelecionados]
  ]) {
    const botao = get(id);
    if (!botao) continue;
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(botao, acao);
    else botao.addEventListener('click', acao);
  }

  // Pinta o que já se sabe pela grade, para o modal nunca aparecer em branco
  // caso a requisição demore.
  if (resumo) pintarCabecalho(resumo);

  (async () => {
    if (!resumo?.id) {
      showToast('Leitura não encontrada', 'error');
      revelar();
      return;
    }
    try {
      await carregar();
      trocarAba('itens');
    } catch (err) {
      console.error('Falha ao abrir a leitura de IA', err);
      showToast(err.message || 'Não foi possível abrir a leitura', 'error');
    } finally {
      // Sempre revela: um erro aqui não pode deixar o spinner girando para
      // sempre com a tela em branco por trás.
      revelar();
    }
  })();
})();
