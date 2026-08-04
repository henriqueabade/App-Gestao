/**
 * Histórico de estoque de uma peça.
 *
 * O razão guarda tudo em ids — item 215, pedido 64, lote 104, usuário 13 — o
 * que serve à máquina e não a quem precisa entender o que aconteceu. O backend
 * traduz; aqui a tradução vira uma folha que pode ir para o papel.
 *
 * Um resumo em cima (entrou, saiu, saldo) porque é a primeira pergunta de quem
 * abre um extrato, e o detalhe abaixo, do mais recente para o mais antigo.
 */
(async () => {
  const overlayId = 'movimentosProduto';
  const overlay = document.getElementById('movimentosProdutoOverlay');
  if (!overlay) return;

  const produto = window.produtoMovimentos || null;
  delete window.produtoMovimentos;

  const close = () => Modal.close(overlayId);
  document.getElementById('fecharMovimentosProduto')?.addEventListener('click', close);
  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    document.removeEventListener('keydown', aoTeclar);
    close();
  }
  document.addEventListener('keydown', aoTeclar);

  const corpo = document.getElementById('movimentosProdutoCorpo');
  const subtitulo = document.getElementById('movimentosProdutoSubtitulo');
  const btnImprimir = document.getElementById('imprimirMovimentosProduto');

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

  function formatarDataHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  /** O sinal na frente do número: é o que faz um extrato ser legível. */
  function efeitoFormatado(mov) {
    if (mov.efeito === null || mov.efeito === undefined) return '—';
    const sinal = mov.efeito > 0 ? '+' : '−';
    return `${sinal}${formatarQuantidade(Math.abs(mov.efeito))}`;
  }

  function renderizarVazio(mensagem, icone = 'fa-clipboard-list') {
    corpo.innerHTML = `
      <div class="py-16 px-6 text-center max-w-2xl mx-auto">
        <i class="fas ${escapar(icone)} text-4xl text-gray-500 mb-4"></i>
        <p class="text-gray-300 font-medium" style="white-space: pre-line">${escapar(mensagem)}</p>
      </div>`;
    if (btnImprimir) btnImprimir.disabled = true;
  }

  function montarFolha(dados) {
    const movimentos = Array.isArray(dados.movimentos) ? dados.movimentos : [];

    const entrou = movimentos.reduce((acc, m) => acc + (m.efeito > 0 ? m.efeito : 0), 0);
    const saiu = movimentos.reduce((acc, m) => acc + (m.efeito < 0 ? -m.efeito : 0), 0);

    const linhas = movimentos.map(m => `
      <tr>
        <td>${escapar(formatarDataHora(m.data))}</td>
        <td>${escapar(m.descricao)}</td>
        <td>${escapar(efeitoFormatado(m))}</td>
        <td>${escapar(m.origem || '—')}</td>
        <td>${escapar(m.etapa || '—')}</td>
        <td>${escapar(m.parou_no_item || '—')}</td>
        <td>${escapar(m.usuario || '—')}</td>
        <td>${escapar(
          m.saldo_negativo_autorizado
            ? `Saldo negativo autorizado. ${m.observacao || ''}`.trim()
            : (m.observacao || '—')
        )}</td>
      </tr>`).join('');

    const p = dados.produto || {};
    return `
      <section class="rp-folha">
        <header class="rp-cabecalho">
          <div>
            <h2>${escapar(p.nome || 'Peça')}</h2>
            <p>${escapar(p.codigo || '')} &middot; estoque atual: ${escapar(formatarQuantidade(p.quantidade))}</p>
          </div>
          <div class="rp-processo-nome">MOVIMENTAÇÕES</div>
        </header>

        <table class="rp-tabela rp-tabela-total">
          <thead><tr class="rp-faixa-total"><th colspan="3">Resumo</th></tr></thead>
          <tbody>
            <tr><td class="rp-item">Total que entrou</td><td class="rp-qtd">${escapar(formatarQuantidade(entrou))}</td><td class="rp-un">un</td></tr>
            <tr><td class="rp-item">Total que saiu</td><td class="rp-qtd">${escapar(formatarQuantidade(saiu))}</td><td class="rp-un">un</td></tr>
            <tr><td class="rp-item">Movimentos registrados</td><td class="rp-qtd">${escapar(movimentos.length)}</td><td class="rp-un">—</td></tr>
          </tbody>
        </table>

        <table class="rp-tabela rp-tabela-larga">
          <thead>
            <tr class="rp-faixa-processo"><th colspan="8">Histórico</th></tr>
            <tr class="rp-faixa-peca">
              <th>Data</th><th>O que houve</th><th>Efeito</th><th>Origem</th>
              <th>Etapa</th><th>Parou no item</th><th>Quem fez</th><th>Observação</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </section>`;
  }

  async function carregar() {
    if (!produto?.id) {
      renderizarVazio('Peça não identificada.');
      return;
    }
    if (subtitulo) subtitulo.textContent = `${produto.codigo || ''} — ${produto.nome || ''}`.trim();

    try {
      const resposta = await window.electronAPI?.listarMovimentosProduto?.({ produtoId: produto.id });
      if (!resposta || resposta.success === false) {
        throw new Error(resposta?.message || 'Falha ao carregar as movimentações.');
      }

      if (!Array.isArray(resposta.movimentos) || !resposta.movimentos.length) {
        // Ausência de histórico não é defeito: o registro por peça passou a
        // existir a partir desta versão, e peça nova simplesmente não tem nada.
        renderizarVazio(
          'Esta peça ainda não tem movimentações registradas.\n\n'
          + 'O histórico começa a partir da primeira entrada, saída ou uso em pedido.',
          'fa-box-open'
        );
        return;
      }

      corpo.innerHTML = montarFolha(resposta);
      if (btnImprimir) btnImprimir.disabled = false;
    } catch (err) {
      console.error('Erro ao carregar as movimentações da peça', err);
      renderizarVazio('Não foi possível carregar as movimentações desta peça.');
    }
  }

  // Mesmo caminho do relatório de produção: a folha vai pronta para o processo
  // principal, que a renderiza numa janela oculta e chama `printToPDF`. O CSS
  // vem por link do arquivo real — duplicá-lo aqui garantiria divergência.
  function montarDocumentoParaPdf(titulo) {
    const cssPedidos = new URL('../css/folha-relatorio.css', document.baseURI).href;
    const cssTailwind = new URL('../styles/tailwind-offline.css', document.baseURI).href;
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Movimentações — ${escapar(titulo)}</title>
<link rel="stylesheet" href="${cssTailwind}" />
<link rel="stylesheet" href="${cssPedidos}" />
<style>
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
    const aviso = document.getElementById('movimentosProdutoAviso');
    if (aviso) {
      aviso.textContent = ligado ? (texto || 'Gerando o PDF...') : '';
      aviso.classList.toggle('hidden', !ligado);
    }
  }

  async function gerarPdf() {
    if (!corpo?.innerHTML?.trim()) return;
    mostrarProgresso(true, 'Gerando o PDF das movimentações...');
    try {
      if (!window.electronAPI?.salvarHtmlComoPdf) {
        throw new Error('Geração de PDF indisponível neste ambiente.');
      }
      const nome = produto.codigo || produto.id;
      const resultado = await window.electronAPI.salvarHtmlComoPdf({
        html: montarDocumentoParaPdf(nome),
        nomeSugerido: `movimentacoes-${nome}`,
        titulo: 'Salvar Movimentações em PDF'
      });

      if (resultado?.canceled) {
        window.showToast?.('Geração cancelada.', 'info');
      } else if (resultado?.success) {
        window.showToast?.(resultado.message || 'Movimentações salvas em PDF.', 'success');
      } else {
        throw new Error(resultado?.message || 'Não foi possível gerar o PDF.');
      }
    } catch (err) {
      console.error('Erro ao gerar o PDF das movimentações', err);
      window.showToast?.(err?.message || 'Erro ao gerar o PDF.', 'error');
    } finally {
      mostrarProgresso(false);
    }
  }

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

  // O spinner de `openModalWithSpinner` só some quando o modal avisa que
  // terminou, e o aviso é ESTE evento — `Modal.signalReady` dispara outro
  // (`modal-ready`), que serve a outra coisa. Sem ele o modal carregava e a
  // tela ficava girando para sempre.
  //
  // No `finally` de propósito: se a carga falhar, o usuário precisa ver a
  // mensagem de erro dentro do modal, não um spinner eterno.
  try {
    await carregar();
  } finally {
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: overlayId }));
    if (typeof Modal?.signalReady === 'function') Modal.signalReady(overlayId);
  }
})();
