/**
 * Modal "Importar boletos do BB".
 *
 * Boleto emitido antes do app (pelo Gerenciador Financeiro) não existe na
 * tabela `boletos`: não tem PDF, não sincroniza e o aviso de pagamento do
 * banco é descartado. Aqui eles são buscados no BB por faixa de vencimento e
 * trazidos para dentro — com a parcela sugerida pelo app, com outra escolhida
 * à mão, ou sem parcela nenhuma (relacionável depois nesta mesma tela).
 *
 * Abre de dois lugares, com o mesmo arquivo:
 *   - Financeiro › Configuração de cobrança (sem pedido: a conta inteira);
 *   - Pedidos › Visualizar › "Importar do BB" (os do pedido vêm primeiro).
 *
 * Contexto: window.importarBoletosContext = { pedidoId?, numero?, cliente? }.
 * Backend: /api/cobranca/importacao/* (backend/cobranca/importacao.js).
 */
(async () => {
  const overlayId = 'importarBoletos';
  const overlay = document.getElementById('importarBoletosOverlay');
  if (!overlay) return;

  // ==================================================================
  // Funções puras: sem DOM, sem rede. O teste
  // (src/js/__tests__/importarBoletos.test.js) recorta o trecho até o
  // marcador "fim das funções puras" e o executa isolado.
  // ==================================================================

  /** '2026-10-15' → '15/10/2026' (corte do texto: sem fuso no caminho). */
  function diaCurto(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  function moeda(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
  }

  /** "00034534810000000393" → "000.3453481.0000000393" (como o BB imprime). */
  function nossoNumeroLegivel(nn) {
    const n = String(nn ?? '').replace(/\D/g, '');
    return n.length === 20 ? `${n.slice(0, 3)}.${n.slice(3, 10)}.${n.slice(10)}` : (n || '—');
  }

  function documentoLegivel(doc) {
    const d = String(doc ?? '').replace(/\D/g, '');
    if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return d;
  }

  /**
   * O que a coluna "Parcela" mostra em cada linha: o que já está no app, a
   * sugestão do casamento, a escolha do usuário ou nada. Pura.
   */
  function textoDaParcela(linha, escolha) {
    if (linha?.ja_importado) return { texto: `já importado${linha.boleto_status ? ` (${linha.boleto_status})` : ''}`, classe: 'badge-neutral' };
    if (escolha?.sem_parcela) return { texto: 'sem relacionar', classe: 'badge-warning' };
    const alvo = escolha?.parcela_id ? escolha : linha?.sugestao;
    if (!alvo?.parcela_id) return { texto: 'escolher', classe: 'badge-warning' };
    const rotulo = `${alvo.pedido_numero || `pedido ${alvo.pedido_id}`} · parcela ${alvo.numero_parcela}`;
    return {
      texto: escolha?.parcela_id ? rotulo : `${rotulo} (sugerida)`,
      classe: escolha?.parcela_id ? 'badge-success' : 'badge-info',
      titulo: escolha?.parcela_id ? '' : (linha?.sugestao?.motivo || '')
    };
  }

  /** O que sai para o backend a partir do que está marcado na tela. Pura. */
  function escolhidosParaEnviar(linhas, marcados, escolhas) {
    return (linhas || [])
      .filter(l => !l.ja_importado && marcados.has(l.nosso_numero))
      .map(l => {
        const escolha = escolhas.get(l.nosso_numero);
        const alvo = escolha?.sem_parcela ? null : (escolha?.parcela_id ? escolha : l.sugestao);
        return {
          nosso_numero: l.nosso_numero,
          pedido_id: alvo?.pedido_id ?? null,
          parcela_id: alvo?.parcela_id ?? null,
          numero_parcela: alvo?.numero_parcela ?? null,
          pedido_numero: alvo?.pedido_numero ?? null
        };
      });
  }

  /** O resumo do que a importação fez. Pura. */
  function resumoDaImportacao(corpo) {
    const importados = Number(corpo?.importados) || 0;
    const jaExistiam = Number(corpo?.ja_existiam) || 0;
    const erros = Number(corpo?.erros) || 0;
    const partes = [];
    if (importados) partes.push(importados === 1 ? '1 boleto importado' : `${importados} boletos importados`);
    if (jaExistiam) partes.push(jaExistiam === 1 ? '1 já estava no app' : `${jaExistiam} já estavam no app`);
    if (erros) partes.push(erros === 1 ? '1 com erro' : `${erros} com erro`);
    if (!partes.length) partes.push('Nenhum boleto importado');
    const fim = corpo?.proximo_sequencial ? ` O próximo boleto gerado aqui sai no ${corpo.proximo_sequencial}.` : '';
    return { texto: `${partes.join(' · ')}.${fim}`, tipo: erros ? 'erro' : (importados ? 'ok' : 'info') };
  }

  function mensagemDeErro(status, corpo) {
    if (corpo?.sql_pendente || corpo?.extra?.sql_pendente) return `Falta rodar ${corpo?.arquivo || corpo?.extra?.arquivo || 'sql/boletos_importados.sql'} no banco e reiniciar a API.`;
    if (status === 403) return 'Você não tem permissão para isso.';
    if (status === 409) return corpo?.error || 'A cobrança não está pronta para importar.';
    return corpo?.error || 'Não foi possível falar com o Banco do Brasil.';
  }
  // ==================================================================
  // fim das funções puras
  // ==================================================================

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const bruto = window.importarBoletosContext || {};
  const ctx = {
    pedidoId: bruto.pedidoId ?? null,
    numero: bruto.numero ? String(bruto.numero) : '',
    cliente: bruto.cliente ? String(bruto.cliente) : ''
  };
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ importarBoletosContext: ctx }));

  const el = id => overlay.querySelector(`#${id}`);
  const linhasEl = el('importarBoletosLinhas');
  const tabelaEl = el('importarBoletosTabela');
  const vazioEl = el('importarBoletosVazio');
  const carregandoEl = el('importarBoletosCarregando');
  const mensagemEl = el('importarBoletosMensagem');
  const resultadoEl = el('importarBoletosResultado');
  const resumoEl = el('importarBoletosResumo');
  const confirmarBtn = el('confirmarImportarBoletos');
  const todosEl = el('importarBoletosTodos');
  const escolhaEl = el('importarBoletosEscolha');
  const buscaEl = el('importarBoletosBusca');
  const resultadoBuscaEl = el('importarBoletosResultadoBusca');

  let estado = { boletos: [], ambiente: null, conta: null };
  const marcados = new Set();
  const escolhas = new Map();
  let escolhendo = null;
  let emAndamento = false;
  let fechado = false;

  // ------------------------------------------------------------ fechar
  function desligarOuvintes() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
  }
  function fechar() {
    if (fechado) return;
    fechado = true;
    desligarOuvintes();
    if (window.importarBoletosContext === bruto) window.importarBoletosContext = null;
    window.Modal.close(overlayId);
  }
  function aoEsc(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (!emAndamento) fechar();
  }
  function aoFecharModal(evento) {
    if (evento?.detail === overlayId) desligarOuvintes();
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharModal);
  el('voltarImportarBoletos')?.addEventListener('click', () => { if (!emAndamento) fechar(); });
  el('fecharImportarBoletos')?.addEventListener('click', () => { if (!emAndamento) fechar(); });

  // --------------------------------------------------------- mensagens
  function exibirMensagem(tipo, texto) {
    mensagemEl.textContent = texto;
    mensagemEl.style.color = tipo === 'erro' ? 'var(--color-red)' : (tipo === 'ok' ? 'var(--color-green)' : 'var(--color-primary-light)');
    mensagemEl.classList.toggle('hidden', !texto);
  }
  function limparMensagem() { exibirMensagem('info', ''); }

  function pintarResultados(resultados) {
    resultadoEl.replaceChildren();
    const linhas = Array.isArray(resultados) ? resultados : [];
    for (const r of linhas) {
      const li = document.createElement('li');
      li.style.color = r.ok ? 'var(--color-green)' : 'var(--color-red)';
      const partes = [`${nossoNumeroLegivel(r.nosso_numero)}: `];
      partes.push(r.ok ? (r.ja_existia ? 'já estava no app' : 'importado') : (r.erro || 'não entrou'));
      li.textContent = partes.join('');
      resultadoEl.appendChild(li);
      for (const aviso of r.avisos || []) {
        const item = document.createElement('li');
        item.className = 'text-xs';
        item.style.color = 'var(--color-primary-light)';
        item.textContent = `— ${aviso}`;
        resultadoEl.appendChild(item);
      }
    }
    resultadoEl.classList.toggle('hidden', !linhas.length);
  }

  // ------------------------------------------------------------ pintar
  function atualizarBotao() {
    const quantos = escolhidosParaEnviar(estado.boletos, marcados, escolhas).length;
    confirmarBtn.classList.toggle('hidden', !estado.boletos.some(l => !l.ja_importado));
    confirmarBtn.disabled = quantos === 0;
    confirmarBtn.style.opacity = confirmarBtn.disabled ? '0.5' : '';
    confirmarBtn.textContent = quantos ? `Importar ${quantos === 1 ? '1 boleto' : `${quantos} boletos`}` : 'Importar boletos';
  }

  function celula(conteudo, classe = 'px-4 py-3 text-left text-white') {
    const td = document.createElement('td');
    td.className = classe;
    if (conteudo instanceof Node) td.appendChild(conteudo);
    else td.textContent = conteudo ?? '';
    return td;
  }

  function pintarLinhas() {
    linhasEl.replaceChildren();
    for (const linha of estado.boletos) {
      const tr = document.createElement('tr');

      const caixa = document.createElement('input');
      caixa.type = 'checkbox';
      caixa.className = 'w-4 h-4 rounded border-inputBorder bg-input';
      caixa.style.accentColor = 'var(--color-primary)';
      caixa.checked = marcados.has(linha.nosso_numero);
      caixa.disabled = linha.ja_importado;
      caixa.setAttribute('aria-label', `Importar o boleto ${linha.nosso_numero}`);
      caixa.addEventListener('change', () => {
        if (caixa.checked) marcados.add(linha.nosso_numero);
        else marcados.delete(linha.nosso_numero);
        atualizarBotao();
      });
      tr.appendChild(celula(caixa, 'px-4 py-3'));

      const numero = document.createElement('span');
      numero.className = 'whitespace-nowrap';
      numero.textContent = nossoNumeroLegivel(linha.nosso_numero);
      tr.appendChild(celula(numero));
      tr.appendChild(celula(linha.seu_numero || '—'));
      tr.appendChild(celula(diaCurto(linha.vencimento) || '—'));
      tr.appendChild(celula(moeda(linha.valor), 'px-4 py-3 text-right text-white'));
      tr.appendChild(celula(linha.situacao_texto || '—'));

      const pagador = document.createElement('div');
      const nome = document.createElement('p');
      nome.className = 'text-white';
      nome.textContent = linha.pagador_nome || '—';
      pagador.appendChild(nome);
      if (linha.pagador_documento) {
        const doc = document.createElement('p');
        doc.className = 'text-xs text-gray-400';
        doc.textContent = documentoLegivel(linha.pagador_documento);
        pagador.appendChild(doc);
      }
      tr.appendChild(celula(pagador));

      const alvo = textoDaParcela(linha, escolhas.get(linha.nosso_numero));
      const caixaParcela = document.createElement('div');
      caixaParcela.className = 'flex items-center gap-2';
      const tag = document.createElement('span');
      tag.className = `${alvo.classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
      tag.textContent = alvo.texto;
      if (alvo.titulo) tag.title = alvo.titulo;
      caixaParcela.appendChild(tag);
      if (!linha.ja_importado) {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'btn-neutral ctl-botao ctl-botao--icone text-white';
        botao.title = 'Escolher a parcela deste boleto';
        botao.setAttribute('aria-label', 'Escolher a parcela deste boleto');
        const icone = document.createElement('i');
        icone.className = 'fas fa-link';
        icone.setAttribute('aria-hidden', 'true');
        botao.appendChild(icone);
        botao.addEventListener('click', () => abrirEscolha(linha));
        caixaParcela.appendChild(botao);
      }
      tr.appendChild(celula(caixaParcela));

      linhasEl.appendChild(tr);
    }
    tabelaEl.classList.toggle('hidden', !estado.boletos.length);
    // Lista vazia diz POR QUE está vazia: a faixa e a situação são o que o
    // usuário mexe, e sem isso a tela parece quebrada.
    const situacao = el('importarBoletosSituacao').value === 'B' ? 'pagos e baixados' : 'em aberto';
    const de = diaCurto(el('importarBoletosDe').value);
    const ate = diaCurto(el('importarBoletosAte').value);
    vazioEl.textContent = de && ate
      ? `Nenhum boleto ${situacao} no Banco do Brasil com vencimento entre ${de} e ${ate}. Mude a faixa ou a situação e busque de novo.`
      : `Nenhum boleto ${situacao} no Banco do Brasil nessa faixa de vencimento.`;
    vazioEl.classList.toggle('hidden', Boolean(estado.boletos.length));
    atualizarBotao();
  }

  function pintarCabecalho() {
    const tag = el('importarBoletosAmbiente');
    tag.className = `${estado.ambiente === 'producao' ? 'badge-success' : 'badge-warning'} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
    tag.textContent = estado.ambiente === 'producao' ? 'Produção' : 'Homologação';
    const conta = estado.conta;
    el('importarBoletosSubtitulo').textContent = [
      ctx.numero ? `Pedido ${ctx.numero}` : '',
      conta ? `Agência ${conta.agencia} · conta ${conta.conta} · convênio ${conta.convenio}` : ''
    ].filter(Boolean).join(' · ');
  }

  // ------------------------------------------------------- escolher parcela
  function abrirEscolha(linha) {
    escolhendo = linha;
    el('importarBoletosEscolhaTitulo').textContent = `Parcela do boleto ${nossoNumeroLegivel(linha.nosso_numero)} (${moeda(linha.valor)}, vence ${diaCurto(linha.vencimento) || '—'})`;
    escolhaEl.classList.remove('hidden');
    buscaEl.value = linha.seu_numero && /^[A-Za-z]+\d+/.test(linha.seu_numero) ? String(linha.seu_numero).replace(/P\d+$/i, '') : '';
    resultadoBuscaEl.replaceChildren();
    buscaEl.focus();
    procurarParcelas();
  }

  function fecharEscolha() {
    escolhendo = null;
    escolhaEl.classList.add('hidden');
  }

  async function procurarParcelas() {
    if (!escolhendo) return;
    resultadoBuscaEl.replaceChildren();
    const aviso = document.createElement('li');
    aviso.className = 'text-xs text-gray-400';
    aviso.textContent = 'Procurando…';
    resultadoBuscaEl.appendChild(aviso);
    let corpo = null;
    try {
      const busca = encodeURIComponent(buscaEl.value.trim());
      const resp = await fetchApi(`/api/cobranca/importacao/parcelas?busca=${busca}`);
      corpo = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(mensagemDeErro(resp.status, corpo));
    } catch (e) {
      aviso.textContent = e.message || 'Não foi possível procurar os pedidos.';
      aviso.style.color = 'var(--color-red)';
      return;
    }
    resultadoBuscaEl.replaceChildren();
    const pedidos = corpo?.pedidos || [];
    if (!pedidos.length) {
      const nada = document.createElement('li');
      nada.className = 'text-xs text-gray-400';
      nada.textContent = 'Nenhum pedido encontrado.';
      resultadoBuscaEl.appendChild(nada);
      return;
    }
    for (const pedido of pedidos) {
      const li = document.createElement('li');
      li.className = 'glass-surface rounded-lg border border-white/10 p-3';
      const titulo = document.createElement('p');
      titulo.className = 'text-sm text-white';
      titulo.textContent = `${pedido.numero || `Pedido ${pedido.id}`}${pedido.cliente ? ` · ${pedido.cliente}` : ''}`;
      li.appendChild(titulo);
      const caixa = document.createElement('div');
      caixa.className = 'flex flex-wrap gap-2 mt-2';
      for (const parcela of pedido.parcelas || []) {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = `${parcela.ocupada ? 'btn-neutral' : 'btn-secondary'} ctl-botao ctl-botao--pequeno text-white`;
        botao.textContent = `${parcela.numero_parcela}ª · ${moeda(parcela.valor)} · ${diaCurto(parcela.data_vencimento) || '—'}${parcela.ocupada ? ' (com boleto)' : ''}`;
        botao.disabled = parcela.ocupada;
        botao.addEventListener('click', () => {
          escolhas.set(escolhendo.nosso_numero, {
            pedido_id: pedido.id, pedido_numero: pedido.numero,
            parcela_id: parcela.id, numero_parcela: parcela.numero_parcela
          });
          marcados.add(escolhendo.nosso_numero);
          fecharEscolha();
          pintarLinhas();
        });
        caixa.appendChild(botao);
      }
      li.appendChild(caixa);
      resultadoBuscaEl.appendChild(li);
    }
  }

  el('importarBoletosEscolhaFechar')?.addEventListener('click', fecharEscolha);
  el('importarBoletosBuscarParcela')?.addEventListener('click', procurarParcelas);
  buscaEl?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); procurarParcelas(); } });
  el('importarBoletosSemParcela')?.addEventListener('click', () => {
    if (!escolhendo) return;
    escolhas.set(escolhendo.nosso_numero, { sem_parcela: true });
    marcados.add(escolhendo.nosso_numero);
    fecharEscolha();
    pintarLinhas();
  });

  todosEl?.addEventListener('change', () => {
    for (const linha of estado.boletos) {
      if (linha.ja_importado) continue;
      if (todosEl.checked) marcados.add(linha.nosso_numero);
      else marcados.delete(linha.nosso_numero);
    }
    pintarLinhas();
  });

  // ------------------------------------------------------------ buscar
  async function buscar() {
    if (emAndamento) return;
    emAndamento = true;
    limparMensagem();
    pintarResultados([]);
    carregandoEl.classList.remove('hidden');
    try {
      const parametros = new URLSearchParams({
        situacao: el('importarBoletosSituacao').value || 'A',
        de: el('importarBoletosDe').value || '',
        ate: el('importarBoletosAte').value || ''
      });
      if (ctx.pedidoId) parametros.set('pedido_id', String(ctx.pedidoId));
      const resp = await fetchApi(`/api/cobranca/importacao/boletos?${parametros.toString()}`);
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(mensagemDeErro(resp.status, corpo));
      estado = corpo || { boletos: [] };
      marcados.clear();
      escolhas.clear();
      if (todosEl) todosEl.checked = false;
      el('importarBoletosDe').value = corpo?.de || el('importarBoletosDe').value;
      el('importarBoletosAte').value = corpo?.ate || el('importarBoletosAte').value;
      resumoEl.textContent = [
        `${corpo?.resumo?.total || 0} boleto(s) no BB`,
        corpo?.resumo?.ja_importados ? `${corpo.resumo.ja_importados} já no app` : '',
        corpo?.resumo?.com_sugestao ? `${corpo.resumo.com_sugestao} com parcela sugerida` : '',
        corpo?.aviso || ''
      ].filter(Boolean).join(' · ');
      pintarCabecalho();
      pintarLinhas();
      // Sem o SQL da fase, a tela mostra o que há no BB mas não deixa importar.
      if (corpo?.sql_pendente) {
        exibirMensagem('erro', `Falta rodar ${corpo.sql_arquivo || 'sql/boletos_importados.sql'} no banco e reiniciar a API: dá para ver a lista, mas não para importar.`);
        confirmarBtn.classList.add('hidden');
      }
    } catch (e) {
      exibirMensagem('erro', e.message || 'Não foi possível buscar os boletos.');
      estado = { boletos: [] };
      pintarLinhas();
    } finally {
      carregandoEl.classList.add('hidden');
      emAndamento = false;
    }
  }

  // ---------------------------------------------------------- importar
  async function importar() {
    if (emAndamento) return;
    const escolhidos = escolhidosParaEnviar(estado.boletos, marcados, escolhas);
    if (!escolhidos.length) return;
    const semParcela = escolhidos.filter(e => !e.parcela_id).length;
    if (semParcela) {
      const ok = await window.DialogPadrao?.confirm?.({
        title: 'Importar sem parcela?',
        message: `${semParcela === 1 ? '1 boleto vai entrar' : `${semParcela} boletos vão entrar`} sem parcela vinculada. Eles aparecem no app com PDF e consulta ao BB, mas o pagamento não vira recebimento até você relacioná-los a uma parcela nesta mesma tela.`,
        confirmText: 'Importar assim'
      });
      if (!ok) return;
    }
    emAndamento = true;
    limparMensagem();
    try {
      const resp = await fetchApi('/api/cobranca/importacao/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escolhidos,
          situacao: el('importarBoletosSituacao').value || 'A',
          de: el('importarBoletosDe').value || null,
          ate: el('importarBoletosAte').value || null
        })
      });
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(mensagemDeErro(resp.status, corpo));
      const r = resumoDaImportacao(corpo);
      exibirMensagem(r.tipo, r.texto);
      pintarResultados(corpo?.resultados);
      window.showToast?.(r.texto, r.tipo === 'erro' ? 'error' : 'success');
      window.dispatchEvent(new CustomEvent('boletos:alterados', { detail: { pedidoId: ctx.pedidoId } }));
      await buscar();
    } catch (e) {
      exibirMensagem('erro', e.message || 'Não foi possível importar.');
    } finally {
      emAndamento = false;
    }
  }

  if (typeof window.BotaoAcao?.bind === 'function') {
    window.BotaoAcao.bind(el('importarBoletosBuscar'), buscar);
    window.BotaoAcao.bind(confirmarBtn, importar);
  } else {
    el('importarBoletosBuscar')?.addEventListener('click', buscar);
    confirmarBtn?.addEventListener('click', importar);
  }

  // ------------------------------------------------------------ carga
  try {
    await buscar();
  } finally {
    // Revela por si e avisa das duas formas: quem abriu com spinner some com
    // ele aqui, e quem abriu sem spinner não fica com a tela escondida.
    overlay.classList.remove('hidden');
    overlay.removeAttribute('aria-hidden');
    window.Modal?.signalReady?.(overlayId);
    window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
  }
})();
