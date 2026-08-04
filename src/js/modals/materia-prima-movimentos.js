/**
 * Auditoria de um insumo: tudo que entrou, saiu e por quê.
 *
 * Gêmeo do relatório de movimentações de uma peça (produto-movimentos.js) e usa
 * a mesma folha (`.rp-*`), para que os dois se leiam igual no papel.
 *
 * A diferença está nos dados: aqui três tabelas falam sobre o mesmo insumo, e
 * duas delas registram o MESMO evento (a conversão de um pedido grava no
 * histórico da matéria-prima e no razão de estoque). O backend já junta as duas
 * numa linha só — ver `listarMovimentosInsumo` —, então esta tela só apresenta.
 * As faltas ficam numa seção à parte porque NÃO são movimento: nada saiu do
 * estoque por causa delas.
 */
(async () => {
  const overlayId = 'movimentosInsumo';
  const overlay = document.getElementById('movimentosInsumoOverlay');
  if (!overlay) return;

  const insumo = window.insumoMovimentos || null;
  delete window.insumoMovimentos;

  const close = () => Modal.close(overlayId);
  document.getElementById('fecharMovimentosInsumo')?.addEventListener('click', close);
  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    document.removeEventListener('keydown', aoTeclar);
    close();
  }
  document.addEventListener('keydown', aoTeclar);

  const corpo = document.getElementById('movimentosInsumoCorpo');
  const subtitulo = document.getElementById('movimentosInsumoSubtitulo');
  const btnImprimir = document.getElementById('imprimirMovimentosInsumo');

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

  function formatarPreco(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return '—';
    return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
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
    return `${mov.efeito > 0 ? '+' : '−'}${formatarQuantidade(Math.abs(mov.efeito))}`;
  }

  /** Movimento de preço não mexe no saldo; mostrar "de → para" em dinheiro. */
  function saldoOuPreco(mov) {
    if (mov.preco_anterior !== null && mov.preco_anterior !== undefined) {
      return `${formatarPreco(mov.preco_anterior)} → ${formatarPreco(mov.preco_atual)}`;
    }
    if (mov.saldo_anterior === null || mov.saldo_anterior === undefined) return '—';
    return `${formatarQuantidade(mov.saldo_anterior)} → ${formatarQuantidade(mov.saldo_atual)}`;
  }

  function renderizarVazio(mensagem, icone = 'fa-clipboard-list') {
    corpo.innerHTML = `
      <div class="py-16 px-6 text-center max-w-2xl mx-auto">
        <i class="fas ${escapar(icone)} text-4xl text-gray-500 mb-4"></i>
        <p class="text-gray-300 font-medium" style="white-space: pre-line">${escapar(mensagem)}</p>
      </div>`;
    if (btnImprimir) btnImprimir.disabled = true;
  }

  function tabelaDeFaltas(faltas) {
    if (!faltas.length) return '';
    const linhas = faltas.map(f => `
      <tr>
        <td>${escapar(formatarDataHora(f.data))}</td>
        <td>${escapar(f.pedido)}</td>
        <td>${escapar(f.processo)}</td>
        <td>${escapar(formatarQuantidade(f.quantidade))}</td>
      </tr>`).join('');

    return `
      <table class="rp-tabela rp-tabela-larga rp-tabela-falta">
        <thead>
          <tr class="rp-faixa-falta"><th colspan="4">Faltas registradas em conversões</th></tr>
          <tr class="rp-faixa-peca">
            <th>Data</th><th>Pedido</th><th>Processo</th><th>Quantidade que faltou</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>`;
  }

  function montarFolha(dados) {
    const movimentos = Array.isArray(dados.movimentos) ? dados.movimentos : [];
    const faltas = Array.isArray(dados.faltas) ? dados.faltas : [];

    const entrou = movimentos.reduce((acc, m) => acc + (m.efeito > 0 ? m.efeito : 0), 0);
    const saiu = movimentos.reduce((acc, m) => acc + (m.efeito < 0 ? -m.efeito : 0), 0);
    const emPedidos = movimentos.filter(m => m.pedido_numero).length;

    const linhas = movimentos.map(m => `
      <tr>
        <td>${escapar(formatarDataHora(m.data))}</td>
        <td>${escapar(m.descricao)}</td>
        <td>${escapar(efeitoFormatado(m))}</td>
        <td>${escapar(saldoOuPreco(m))}</td>
        <td>${escapar(m.origem || '—')}</td>
        <!-- Só o código: o nome da peça é longo demais para caber na folha. -->
        <td>${escapar(m.peca_codigo || '—')}</td>
        <td>${escapar(m.usuario || '—')}</td>
        <td>${escapar(
          m.saldo_negativo_autorizado
            ? `Saldo negativo autorizado. ${m.observacao || ''}`.trim()
            : (m.observacao || '—')
        )}</td>
      </tr>`).join('');

    const i = dados.insumo || {};
    return `
      <section class="rp-folha">
        <header class="rp-cabecalho">
          <div>
            <h2>${escapar(i.nome || 'Insumo')}</h2>
            <p>
              ${escapar(i.categoria || '—')} &middot; ${escapar(i.processo || '—')} &middot;
              saldo atual: ${escapar(formatarQuantidade(i.quantidade))} ${escapar(i.unidade || '')}
              &middot; ${escapar(formatarPreco(i.preco_unitario))}
            </p>
          </div>
          <div class="rp-processo-nome">AUDITORIA</div>
        </header>

        <table class="rp-tabela rp-tabela-total">
          <thead><tr class="rp-faixa-total"><th colspan="3">Resumo</th></tr></thead>
          <tbody>
            <tr><td class="rp-item">Total que entrou</td><td class="rp-qtd">${escapar(formatarQuantidade(entrou))}</td><td class="rp-un">${escapar(i.unidade || '')}</td></tr>
            <tr><td class="rp-item">Total que saiu</td><td class="rp-qtd">${escapar(formatarQuantidade(saiu))}</td><td class="rp-un">${escapar(i.unidade || '')}</td></tr>
            <tr><td class="rp-item">Movimentos registrados</td><td class="rp-qtd">${escapar(movimentos.length)}</td><td class="rp-un">—</td></tr>
            <tr><td class="rp-item">Movimentos vindos de pedidos</td><td class="rp-qtd">${escapar(emPedidos)}</td><td class="rp-un">—</td></tr>
          </tbody>
        </table>

        <table class="rp-tabela rp-tabela-larga">
          <thead>
            <tr class="rp-faixa-processo"><th colspan="8">Histórico</th></tr>
            <tr class="rp-faixa-peca">
              <th>Data</th><th>O que houve</th><th>Efeito</th><th>Saldo / Preço</th>
              <th>Origem</th><th>Peça</th><th>Quem fez</th><th>Observação</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>

        ${tabelaDeFaltas(faltas)}
      </section>`;
  }

  async function carregar() {
    if (!insumo?.id) {
      renderizarVazio('Insumo não identificado.');
      return;
    }
    if (subtitulo) subtitulo.textContent = insumo.nome || '';

    try {
      const resposta = await window.electronAPI?.listarMovimentosInsumo?.({ insumoId: insumo.id });
      if (!resposta || resposta.success === false) {
        throw new Error(resposta?.message || 'Falha ao carregar as movimentações.');
      }

      const temMovimento = Array.isArray(resposta.movimentos) && resposta.movimentos.length;
      const temFalta = Array.isArray(resposta.faltas) && resposta.faltas.length;
      if (!temMovimento && !temFalta) {
        // Ausência de histórico não é defeito: insumo recém-cadastrado ou que
        // nunca foi usado simplesmente não tem nada a mostrar.
        renderizarVazio(
          'Este insumo ainda não tem movimentações registradas.\n\n'
          + 'O histórico começa na primeira entrada, saída, ajuste ou uso em pedido.',
          'fa-box-open'
        );
        return;
      }

      corpo.innerHTML = montarFolha(resposta);
      if (btnImprimir) btnImprimir.disabled = false;
    } catch (err) {
      console.error('Erro ao carregar a auditoria do insumo', err);
      renderizarVazio('Não foi possível carregar as movimentações deste insumo.');
    }
  }

  // Mesmo caminho dos outros relatórios: a folha vai pronta para o processo
  // principal, que a renderiza numa janela oculta e chama `printToPDF`.
  function montarDocumentoParaPdf(titulo) {
    const cssFolha = new URL('../css/folha-relatorio.css', document.baseURI).href;
    const cssTailwind = new URL('../styles/tailwind-offline.css', document.baseURI).href;
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Auditoria — ${escapar(titulo)}</title>
<link rel="stylesheet" href="${cssTailwind}" />
<link rel="stylesheet" href="${cssFolha}" />
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
    const aviso = document.getElementById('movimentosInsumoAviso');
    if (aviso) {
      aviso.textContent = ligado ? (texto || 'Gerando o PDF...') : '';
      aviso.classList.toggle('hidden', !ligado);
    }
  }

  async function gerarPdf() {
    if (!corpo?.innerHTML?.trim()) return;
    mostrarProgresso(true, 'Gerando o PDF da auditoria...');
    try {
      if (!window.electronAPI?.salvarHtmlComoPdf) {
        throw new Error('Geração de PDF indisponível neste ambiente.');
      }
      const nome = (insumo.nome || insumo.id).toString().replace(/[\\/:*?"<>|]/g, '-');
      const resultado = await window.electronAPI.salvarHtmlComoPdf({
        html: montarDocumentoParaPdf(nome),
        nomeSugerido: `auditoria-${nome}`,
        titulo: 'Salvar Auditoria do Insumo em PDF'
      });

      if (resultado?.canceled) {
        window.showToast?.('Geração cancelada.', 'info');
      } else if (resultado?.success) {
        window.showToast?.(resultado.message || 'Auditoria salva em PDF.', 'success');
      } else {
        throw new Error(resultado?.message || 'Não foi possível gerar o PDF.');
      }
    } catch (err) {
      console.error('Erro ao gerar o PDF da auditoria', err);
      window.showToast?.(err?.message || 'Erro ao gerar o PDF.', 'error');
    } finally {
      mostrarProgresso(false);
    }
  }

  if (window.BotaoAcao?.bind) {
    window.BotaoAcao.bind(btnImprimir, gerarPdf, { visual: false });
  } else {
    btnImprimir?.addEventListener('click', gerarPdf);
  }

  // O spinner de `openModalWithSpinner` só some com ESTE evento — `signalReady`
  // dispara outro. No `finally` para que uma falha mostre o erro, não um
  // carregamento eterno.
  try {
    await carregar();
  } finally {
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: overlayId }));
    if (typeof Modal?.signalReady === 'function') Modal.signalReady(overlayId);
  }
})();
