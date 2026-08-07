/**
 * Relatório de produção de um pedido.
 *
 * Monta a folha e manda para impressão. Duas regras de papel, que são o motivo
 * de a folha ser gerada aqui e não reaproveitar a tela:
 *
 *  - **Paisagem**, via `@page { size: A4 landscape }`.
 *  - **Um processo por folha, nunca dois na mesma.** Cada processo é um bloco
 *    com `break-after: page`. Se um processo não couber, ele continua na folha
 *    seguinte — o que não pode é o processo B começar no que sobrou da folha do
 *    processo A.
 *
 * Os dados vêm da FOTO congelada na conversão (`pedidos_itens_faltantes`), não
 * de um recálculo: o papel que vai para a produção precisa dizer o que foi
 * decidido quando o pedido nasceu.
 */
(async () => {
  const overlayId = 'relatorioProducao';
  const overlay = document.getElementById('relatorioProducaoOverlay');
  if (!overlay) return;

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const contexto = window.relatorioProducaoContext || {};
  delete window.relatorioProducaoContext;
  const pedidoId = contexto.pedidoId ?? contexto.id ?? window.selectedOrderId;

  const close = () => Modal.close(overlayId);
  document.getElementById('voltarRelatorioProducao')?.addEventListener('click', close);
  document.getElementById('fecharRelatorioProducao')?.addEventListener('click', close);
  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    document.removeEventListener('keydown', aoTeclar);
    close();
  }
  document.addEventListener('keydown', aoTeclar);

  const corpo = document.getElementById('relatorioProducaoCorpo');
  const subtitulo = document.getElementById('relatorioProducaoSubtitulo');
  const btnImprimir = document.getElementById('imprimirRelatorioProducao');

  // Estado da alternância folha <-> peças. Declarado aqui, junto do resto do
  // estado do modal, porque `renderizarVazio` (mais abaixo) também escreve nele.
  let mostrandoPecas = false;
  let htmlDoRelatorio = '';
  let htmlDasPecas = '';

  function escapar(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Até 4 casas, sem zeros à direita — o padrão numérico do app. */
  function formatarQuantidade(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  }

  function formatarData(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
  }

  function linhasDaPeca(peca) {
    return peca.itens.map(item => `
      <tr>
        <td class="rp-item">${escapar(item.insumo_nome)}</td>
        <td class="rp-qtd">${escapar(formatarQuantidade(item.quantidade))}</td>
        <td class="rp-un">${escapar(item.unidade || '')}</td>
      </tr>`).join('');
  }

  function folhaDoProcesso(grupo, pedido) {
    const pecas = grupo.pecas.map(peca => `
      <tr class="rp-faixa-peca"><td colspan="3">${escapar(peca.peca)}</td></tr>
      ${linhasDaPeca(peca)}
    `).join('');

    const linhas = lista => (lista || []).map(t => `
      <tr>
        <td class="rp-item">${escapar(t.insumo_nome)}</td>
        <td class="rp-qtd">${escapar(formatarQuantidade(t.quantidade))}</td>
        <td class="rp-un">${escapar(t.unidade || '')}</td>
      </tr>`).join('');

    const totais = linhas(grupo.totais);
    // Sem faltantes o processo está coberto pelo estoque — dizer isso é melhor
    // que uma tabela vazia, que se lê como "não calculado".
    const faltantes = grupo.faltantes?.length
      ? linhas(grupo.faltantes)
      : '<tr><td colspan="3" class="rp-vazio">Nenhum item em falta: o estoque cobria este processo.</td></tr>';

    return `
      <section class="rp-folha">
        <header class="rp-cabecalho">
          <div>
            <h2>Pedido ${escapar(pedido.numero || pedido.id)}</h2>
            <p>${escapar(contexto.cliente || '')} &middot; emitido em ${escapar(formatarData(pedido.data_emissao))}</p>
          </div>
          <div class="rp-processo-nome">${escapar(grupo.processo)}</div>
        </header>

        <table class="rp-tabela">
          <thead><tr class="rp-faixa-processo"><th colspan="3">Processo ${escapar(grupo.processo)}</th></tr></thead>
          <tbody>${pecas}</tbody>
        </table>

        <table class="rp-tabela rp-tabela-total">
          <thead><tr class="rp-faixa-total"><th colspan="3">Total Processo ${escapar(grupo.processo)}</th></tr></thead>
          <tbody>${totais}</tbody>
        </table>

        <table class="rp-tabela rp-tabela-falta">
          <thead><tr class="rp-faixa-falta"><th colspan="3">Itens Fora do Estoque — Processo ${escapar(grupo.processo)}</th></tr></thead>
          <tbody>${faltantes}</tbody>
        </table>
      </section>`;
  }

  function renderizarVazio(mensagem, icone = 'fa-clipboard-list') {
    // Guardado também em `htmlDoRelatorio` para que voltar da lista de peças
    // reencontre a explicação, e não uma tela em branco.
    htmlDoRelatorio = `
      <div class="py-16 px-6 text-center max-w-2xl mx-auto">
        <i class="fas ${escapar(icone)} text-4xl text-gray-500 mb-4"></i>
        <p class="text-gray-300 font-medium" style="white-space: pre-line">${escapar(mensagem)}</p>
      </div>`;
    corpo.innerHTML = htmlDoRelatorio;
    if (btnImprimir) btnImprimir.disabled = true;
  }

  // ------------------------------------------------------------------
  // Lista de peças
  //
  // Outro recorte do mesmo pedido: a folha de produção é organizada por
  // PROCESSO (o que cada processo consome) e por isso não responde "de onde
  // veio esta peça e quanto falta para ela ficar pronta". Esta tabela responde.
  //
  // Fica no mesmo modal, alternando o miolo, porque é a mesma pergunta vista de
  // outro ângulo — e assim o botão Imprimir serve às duas sem nenhuma regra
  // extra: ele imprime o que estiver na tela.
  // ------------------------------------------------------------------
  const btnPecas = document.getElementById('verPecasRelatorio');
  const btnPecasTexto = document.getElementById('verPecasRelatorioTexto');

  /** As seis colunas da tabela de peças, para as duas versões da composição. */
  function linhasDeComposicao(linhas) {
    return linhas.map(l => {
      // "Faltam 0" numa peça acabada se lê como erro; melhor dizer que está
      // pronta e reservar o número para quem ainda tem rota pela frente.
      const falta = l.itens_faltantes > 0
        ? `${escapar(l.itens_faltantes)} de ${escapar(l.itens_da_rota)}`
        : 'Nenhum — peça pronta';
      // Sem as classes de largura: elas são para a folha de três colunas e aqui
      // são seis — as porcentagens somariam mais de 100% e brigariam.
      return `
        <tr>
          <td>${escapar(l.peca)}</td>
          <td>${escapar(l.origem)}</td>
          <td>${escapar(formatarQuantidade(l.quantidade))}</td>
          <td>${escapar(l.etapa)}</td>
          <td>${escapar(l.item_parada)}</td>
          <td>${escapar(falta)}</td>
        </tr>`;
    }).join('');
  }

  function tabelaDeComposicao(titulo, linhas) {
    return `
        <table class="rp-tabela rp-tabela-larga">
          <thead>
            <tr class="rp-faixa-processo"><th colspan="6">${escapar(titulo)}</th></tr>
            <tr class="rp-faixa-peca">
              <th>Peça</th><th>Origem</th><th>Qtd.</th>
              <th>Etapa</th><th>Parou no item</th><th>Itens para finalizar</th>
            </tr>
          </thead>
          <tbody>${linhasDeComposicao(linhas)}</tbody>
        </table>`;
  }

  /**
   * O que este pedido RECEBEU depois da conversão.
   *
   * Sem esta seção o relatório mostra a composição atual como se fosse a
   * original: uma peça que chegou de um pedido cancelado aparece como escolha
   * da conversão, e o que ela substituiu não aparece em lugar nenhum.
   */
  function tabelaDeAlteracoes(alteracoes) {
    if (!alteracoes.length) return '';
    const corpo = alteracoes.map(a => `
        <tr>
          <td>${escapar(a.peca)}</td>
          <td>${escapar(a.recebida)}</td>
          <td>${escapar(formatarQuantidade(a.quantidade))}</td>
          <td>${escapar(a.substituiu)}${a.liberou_peca ? ' <em>(devolvida ao estoque)</em>' : ''}</td>
          <td>${escapar(a.origem)}</td>
        </tr>`).join('');

    return `
        <table class="rp-tabela rp-tabela-larga">
          <thead>
            <tr class="rp-faixa-processo"><th colspan="5">Alterações posteriores — peças recebidas por realocação</th></tr>
            <tr class="rp-faixa-peca">
              <th>Peça</th><th>Recebida em</th><th>Qtd.</th><th>Substituiu</th><th>Origem</th>
            </tr>
          </thead>
          <tbody>${corpo}</tbody>
        </table>`;
  }

  /** O que foi feito com cada peça quando ESTE pedido foi cancelado. */
  function tabelaDeDestinacoes(destinacoes) {
    if (!destinacoes.length) return '';
    const corpo = destinacoes.map(d => `
        <tr>
          <td>${escapar(d.peca)}</td>
          <td>${escapar(d.rotulo)}</td>
          <td>${escapar(formatarQuantidade(d.quantidade))}</td>
          <td>${escapar(d.estagio_origem)}</td>
          <td>${escapar(d.pedido_destino || '—')}</td>
          <td>${escapar(d.substituiu || '—')}</td>
          <td>${d.falha ? `<strong>${escapar(d.falha)}</strong>` : 'OK'}</td>
        </tr>`).join('');

    return `
        <table class="rp-tabela rp-tabela-larga">
          <thead>
            <tr class="rp-faixa-processo"><th colspan="7">Destinação no cancelamento</th></tr>
            <tr class="rp-faixa-peca">
              <th>Peça</th><th>Destino</th><th>Qtd.</th>
              <th>Estágio de origem</th><th>Pedido de destino</th>
              <th>Substituiu</th><th>Resultado</th>
            </tr>
          </thead>
          <tbody>${corpo}</tbody>
        </table>`;
  }

  function tabelaDePecas(dados) {
    const linhas = Array.isArray(dados?.pecas) ? dados.pecas : [];
    const original = Array.isArray(dados?.selecaoOriginal) ? dados.selecaoOriginal : [];
    const alteracoes = Array.isArray(dados?.alteracoes) ? dados.alteracoes : [];
    const destinacoes = Array.isArray(dados?.destinacoes) ? dados.destinacoes : [];

    if (!linhas.length && !destinacoes.length) {
      return `
        <div class="py-16 px-6 text-center max-w-2xl mx-auto">
          <i class="fas fa-cubes text-4xl text-gray-500 mb-4"></i>
          <p class="text-gray-300 font-medium">Este pedido não tem peças registradas na conversão.</p>
        </div>`;
    }

    // Três recortes, na ordem em que a história aconteceu: o que foi escolhido,
    // o que mudou depois, e como o pedido ficou. Sem alteração, a primeira e a
    // terceira seriam a mesma tabela — então só a atual aparece, com o título
    // de sempre.
    const houveAlteracao = alteracoes.length > 0 && original.length > 0;

    return `
      <section class="rp-folha">
        <header class="rp-cabecalho">
          <div>
            <h2>Pedido ${escapar(dados.pedido?.numero || dados.pedido?.id || '')}</h2>
            <p>${escapar(contexto.cliente || '')} &middot; emitido em ${escapar(formatarData(dados.pedido?.data_emissao))}</p>
          </div>
          <div class="rp-processo-nome">PEÇAS</div>
        </header>

        ${houveAlteracao ? tabelaDeComposicao('Seleção original da conversão', original) : ''}
        ${tabelaDeAlteracoes(alteracoes)}
        ${tabelaDeComposicao(
    houveAlteracao ? 'Composição atual' : 'Peças selecionadas na conversão',
    linhas
  )}
        ${tabelaDeDestinacoes(destinacoes)}
      </section>`;
  }

  async function alternarPecas() {
    if (!corpo) return;

    if (mostrandoPecas) {
      corpo.innerHTML = htmlDoRelatorio;
      mostrandoPecas = false;
      if (btnPecasTexto) btnPecasTexto.textContent = 'Peças';
      if (btnImprimir) btnImprimir.disabled = !htmlDoRelatorio.trim();
      return;
    }

    if (!htmlDasPecas) {
      corpo.innerHTML = '<p class="px-8 py-6 text-gray-300">Carregando as peças...</p>';
      try {
        const resp = await fetchApi(`/api/pedidos/${pedidoId}/pecas-selecionadas`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        htmlDasPecas = tabelaDePecas(await resp.json());
      } catch (err) {
        console.error('Erro ao carregar as peças do pedido', err);
        htmlDasPecas = '';
        corpo.innerHTML = htmlDoRelatorio;
        window.showToast?.('Não foi possível carregar as peças do pedido.', 'error');
        return;
      }
    }

    corpo.innerHTML = htmlDasPecas;
    mostrandoPecas = true;
    if (btnPecasTexto) btnPecasTexto.textContent = 'Relatório';
    if (btnImprimir) btnImprimir.disabled = false;
  }

  if (window.BotaoAcao?.bind) {
    window.BotaoAcao.bind(btnPecas, alternarPecas, { visual: false });
  } else {
    btnPecas?.addEventListener('click', alternarPecas);
  }

  async function carregar() {
    if (!pedidoId) {
      renderizarVazio('Pedido não identificado.');
      return;
    }
    try {
      const resp = await fetchApi(`/api/pedidos/${pedidoId}/relatorio-producao`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const dados = await resp.json();

      if (subtitulo) {
        subtitulo.textContent = `Pedido ${dados.pedido?.numero || pedidoId}`;
      }

      if (!Array.isArray(dados.processos) || !dados.processos.length) {
        // Três motivos diferentes para não haver folha. Dizer qual é evita que
        // o usuário leia ausência de relatório como defeito.
        if (dados.somentePecasProntas) {
          renderizarVazio(
            'Não há relatório de produção para este pedido.\n\n'
            + 'Todas as peças foram atendidas com produtos prontos do estoque — '
            + 'nada precisa ser fabricado e nenhum insumo foi consumido.',
            'fa-box-open'
          );
        } else if (!dados.temItens) {
          renderizarVazio('Este pedido não tem itens.');
        } else {
          renderizarVazio(
            'Este pedido não tem registro de produção.\n\n'
            + 'A foto do que faltava passou a ser gravada na conversão a partir desta versão; '
            + 'pedidos convertidos antes disso não têm esse registro.'
          );
        }
        return;
      }

      htmlDoRelatorio = dados.processos.map(g => folhaDoProcesso(g, dados.pedido || {})).join('');
      corpo.innerHTML = htmlDoRelatorio;
      if (btnImprimir) btnImprimir.disabled = false;
    } catch (err) {
      console.error('Erro ao carregar o relatório de produção', err);
      renderizarVazio('Não foi possível carregar o relatório de produção.');
    }
  }

  // ------------------------------------------------------------------
  // Gerar o PDF
  //
  // A folha é enviada pronta para o processo principal, que a renderiza numa
  // janela oculta e chama `printToPDF` — o mesmo caminho do PDF de pedido, já
  // provado. O CSS vai por link para o arquivo real: duplicar os estilos
  // aqui garantiria que o papel e a tela divergissem com o tempo.
  //
  // Gerar leva alguns segundos. Sem dizer isso na tela, o usuário acha que
  // travou — por isso o botão vira "Gerando PDF..." e o aviso aparece.
  // ------------------------------------------------------------------
  function montarDocumentoParaPdf(pedidoNumero) {
    const cssPedidos = new URL('../css/folha-relatorio.css', document.baseURI).href;
    const cssTailwind = new URL('../styles/tailwind-offline.css', document.baseURI).href;
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Relatório de Produção — ${escapar(pedidoNumero)}</title>
<link rel="stylesheet" href="${cssTailwind}" />
<link rel="stylesheet" href="${cssPedidos}" />
<style>
  /* A janela do PDF não tem o tema do app: fundo branco e as folhas soltas. */
  body { background: #fff; margin: 0; font-family: Arial, Helvetica, sans-serif; }
  .rp-folha { box-shadow: none; border-radius: 0; margin: 0; padding: 0; }
</style>
</head>
<body>${corpo.innerHTML}</body>
</html>`;
  }

  function mostrarProgresso(ligado, texto) {
    if (!btnImprimir) return;
    btnImprimir.innerHTML = ligado
      ? `<i class="fas fa-circle-notch fa-spin"></i> ${escapar(texto || 'Gerando PDF...')}`
      : '<i class="fas fa-print"></i> Imprimir';
    const aviso = document.getElementById('relatorioProducaoAviso');
    if (aviso) {
      aviso.textContent = ligado ? (texto || 'Gerando o PDF do relatório...') : '';
      aviso.classList.toggle('hidden', !ligado);
    }
  }

  async function gerarPdf() {
    if (!corpo?.innerHTML?.trim()) return;

    mostrarProgresso(true, 'Gerando o PDF do relatório...');
    try {
      if (!window.electronAPI?.salvarHtmlComoPdf) {
        throw new Error('Geração de PDF indisponível neste ambiente.');
      }
      const numero = subtitulo?.textContent?.replace(/^Pedido\s*/i, '').trim() || pedidoId;
      // O botão imprime o que está na tela; o nome do arquivo tem de acompanhar,
      // senão a lista de peças sai salva como "relatório de produção".
      const resultado = await window.electronAPI.salvarHtmlComoPdf({
        html: montarDocumentoParaPdf(numero),
        nomeSugerido: mostrandoPecas ? `pecas-${numero}` : `relatorio-producao-${numero}`,
        titulo: mostrandoPecas ? 'Salvar Peças do Pedido em PDF' : 'Salvar Relatório de Produção em PDF'
      });

      if (resultado?.canceled) {
        window.showToast?.('Geração cancelada.', 'info');
      } else if (resultado?.success) {
        window.showToast?.(resultado.message || 'Relatório salvo em PDF.', 'success');
      } else {
        throw new Error(resultado?.message || 'Não foi possível gerar o PDF.');
      }
    } catch (err) {
      console.error('Erro ao gerar o PDF do relatório de produção', err);
      window.showToast?.(err?.message || 'Erro ao gerar o PDF.', 'error');
    } finally {
      mostrarProgresso(false);
    }
  }

  // `BotaoAcao.bind` dá a trava de duplo clique; o texto de progresso é nosso,
  // porque o spinner padrão esconderia o rótulo e não diria o que está havendo.
  if (window.BotaoAcao?.bind) {
    window.BotaoAcao.bind(btnImprimir, gerarPdf, { visual: false });
  } else {
    let gerando = false;
    btnImprimir?.addEventListener('click', async () => {
      if (gerando) return;
      gerando = true;
      try { await gerarPdf(); } finally { gerando = false; }
    });
  }

  await carregar();

  if (typeof Modal?.signalReady === 'function') Modal.signalReady(overlayId);
  window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
})();
