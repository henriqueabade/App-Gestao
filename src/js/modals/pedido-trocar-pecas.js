/**
 * Trocar peças entre pedidos (pedido do dono, 09/10/2026).
 *
 * Três passos na mesma tela: (1) a peça deste pedido e o estado da unidade
 * que sai; (2) entre as peças do mesmo produto de outros pedidos (Aprovados
 * ou em Produção), a unidade que vem no lugar; (3) quantas, o motivo e o
 * resumo do que muda em cada pedido. A troca grava uma linha nova (nunca
 * reescreve nada) — backend/trocasPecas.js.
 */
(async () => {
  const overlayId = 'trocarPecas';
  const overlay = document.getElementById('trocarPecasOverlay');
  if (!overlay) return;

  const contexto = window.trocarPecasContext || {};
  delete window.trocarPecasContext;
  const pedidoId = contexto.pedidoId ?? window.selectedOrderId;

  const el = id => document.getElementById(id);
  const criar = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  };

  async function fetchApi(caminho, opcoes) {
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}${caminho}`, { ...opcoes, headers: { 'Content-Type': 'application/json', ...(opcoes?.headers || {}) } });
    const corpo = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      const e = new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
      e.status = resposta.status;
      e.corpo = corpo;
      throw e;
    }
    return corpo;
  }
  const textoDoErro = (e, semPermissao) => (e?.status === 403 ? semPermissao : (e?.message || 'Não foi possível concluir.'));

  const fechar = () => {
    document.removeEventListener('keydown', aoTeclar);
    Modal.close(overlayId);
  };
  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    // A caixa de confirmação aberta por cima é quem responde ao Esc.
    if (document.querySelector('.app-message-overlay, dialog[data-dialog-padrao][open]')) return;
    fechar();
  }
  document.addEventListener('keydown', aoTeclar);
  el('voltarTrocarPecas')?.addEventListener('click', fechar);
  el('fecharTrocarPecas')?.addEventListener('click', fechar);

  let dados = null;
  const escolha = { item: null, estadoA: null, candidato: null, estadoB: null };

  function avisar(texto) {
    el('trocarPecasAviso').textContent = texto || '';
    el('trocarPecasAviso').classList.toggle('hidden', !texto);
  }

  function mensagem(texto, tom = 'erro') {
    const m = el('trocarPecasMensagem');
    m.textContent = texto || '';
    m.style.color = tom === 'erro' ? 'var(--color-red)' : 'var(--color-green)';
    m.classList.toggle('hidden', !texto);
  }

  /** Um botão de estado ("2 · Pronta"), com o detalhe por processo no balão. */
  function botaoDeEstado(estado, { pressionado = false, desligado = false, titulo = '' } = {}) {
    const b = criar('button', `trocar-pecas__estado${estado.pronta ? ' trocar-pecas__estado--pronta' : ''}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', pressionado ? 'true' : 'false');
    b.disabled = desligado;
    b.title = titulo || estado.detalhe || estado.rotulo;
    b.append(criar('span', 'trocar-pecas__qtd', String(estado.quantidade)), criar('span', null, estado.rotulo));
    return b;
  }

  function nomeDaPeca(item) {
    return [item.codigo, item.nome].filter(Boolean).join(' — ') || `Peça ${item.id}`;
  }

  function pintarItens() {
    const lista = el('trocarPecasItens');
    lista.replaceChildren();
    for (const item of dados.itens) {
      const escolhido = escolha.item?.id === item.id;
      const card = criar('div', `trocar-pecas__peca${escolhido ? ' trocar-pecas__peca--escolhida' : ''}`);
      const nome = criar('div', 'trocar-pecas__nome');
      nome.append(criar('span', 'trocar-pecas__titulo', nomeDaPeca(item)));
      const semTroca = !item.candidatos.length;
      nome.append(criar('span', 'trocar-pecas__sub', semTroca
        ? `${item.quantidade} no pedido · nenhum outro pedido em produção tem esta peça`
        : `${item.quantidade} no pedido · pode trocar com ${item.candidatos.length === 1 ? '1 pedido' : `${item.candidatos.length} pedidos`}`));
      nome.querySelector('.trocar-pecas__titulo').title = nomeDaPeca(item);
      const estados = criar('div', 'trocar-pecas__estados');
      for (const e of item.estados) {
        const b = botaoDeEstado(e, {
          pressionado: escolhido && escolha.estadoA?.chave === e.chave,
          desligado: !dados.pedido.pode_trocar || semTroca
        });
        b.addEventListener('click', () => {
          escolha.item = item;
          escolha.estadoA = e;
          escolha.candidato = null;
          escolha.estadoB = null;
          pintar();
        });
        estados.appendChild(b);
      }
      card.append(nome, estados);
      lista.appendChild(card);
    }
  }

  function pintarCandidatos() {
    const passo2 = el('trocarPecasPasso2');
    passo2.classList.toggle('hidden', !escolha.estadoA);
    if (!escolha.estadoA) return;
    const lista = el('trocarPecasCandidatos');
    lista.replaceChildren();
    const candidatos = escolha.item.candidatos || [];
    el('trocarPecasSemCandidato').classList.toggle('hidden', candidatos.length > 0);
    for (const cand of candidatos) {
      const escolhido = escolha.candidato?.item_id === cand.item_id;
      const card = criar('div', `trocar-pecas__peca${escolhido ? ' trocar-pecas__peca--escolhida' : ''}`);
      const nome = criar('div', 'trocar-pecas__nome');
      nome.append(
        criar('span', 'trocar-pecas__titulo', [cand.numero, cand.cliente].filter(Boolean).join(' · ')),
        criar('span', 'trocar-pecas__sub', `${cand.situacao || ''} · ${cand.quantidade} desta peça no pedido`)
      );
      const estados = criar('div', 'trocar-pecas__estados');
      for (const e of cand.estados) {
        const igual = e.chave === escolha.estadoA.chave;
        const b = botaoDeEstado(e, {
          pressionado: escolhido && escolha.estadoB?.chave === e.chave,
          desligado: igual,
          titulo: igual ? 'Está no mesmo estado da peça que sai: trocar não muda nada.' : ''
        });
        b.addEventListener('click', () => {
          escolha.candidato = cand;
          escolha.estadoB = e;
          pintar();
        });
        estados.appendChild(b);
      }
      card.append(nome, estados);
      lista.appendChild(card);
    }
  }

  /** O que muda em cada pedido, em frases. */
  function pintarResumo() {
    const passo3 = el('trocarPecasPasso3');
    const pronto = Boolean(escolha.estadoA && escolha.estadoB);
    passo3.classList.toggle('hidden', !pronto);
    if (!pronto) return;
    const maximo = Math.min(escolha.estadoA.quantidade, escolha.estadoB.quantidade);
    const campo = el('trocarPecasQuantidade');
    campo.max = String(maximo);
    if (Number(campo.value) > maximo || !(Number(campo.value) >= 1)) campo.value = '1';
    const q = Math.min(maximo, Math.max(1, Math.trunc(Number(campo.value) || 1)));
    const peca = nomeDaPeca(escolha.item);
    const daqui = dados.pedido.numero;
    const dela = escolha.candidato.numero;
    const resumo = el('trocarPecasResumo');
    resumo.replaceChildren();
    resumo.append(criar('strong', null, `${q} × ${peca}`));
    const ul = criar('ul');
    ul.append(
      criar('li', null, `${daqui} entrega a peça "${escolha.estadoA.rotulo}" e recebe a "${escolha.estadoB.rotulo}" do ${dela}.${escolha.estadoB.pronta ? '' : ` ${daqui} passa a dever o que falta nela.`}`),
      criar('li', null, `${dela} recebe a "${escolha.estadoA.rotulo}"${escolha.estadoA.pronta ? ' e não paga a produção dela de novo' : ' e deve só o que falta nela'}.`),
      criar('li', null, 'A matéria-prima não muda: as peças só trocam de pedido. O que já foi registrado de produção continua valendo.')
    );
    resumo.appendChild(ul);
  }

  function pintarHistorico() {
    const corpo = el('trocarPecasHistorico');
    corpo.replaceChildren();
    const linhas = dados.historico || [];
    if (!linhas.length) {
      const tr = criar('tr');
      const td = criar('td', 'px-4 py-3 text-gray-400', 'Nenhuma troca neste pedido ainda.');
      td.colSpan = 6;
      tr.appendChild(td);
      corpo.appendChild(tr);
      return;
    }
    for (const h of linhas) {
      const tr = criar('tr');
      const quando = h.em ? new Date(h.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
      tr.append(
        criar('td', 'px-4 py-3 whitespace-nowrap', quando),
        criar('td', 'px-4 py-3', `${h.quantidade} × ${h.peca}`),
        criar('td', 'px-4 py-3', h.saiu),
        criar('td', 'px-4 py-3', h.entrou),
        criar('td', 'px-4 py-3 whitespace-nowrap', h.outro_pedido),
        criar('td', 'px-4 py-3', h.motivo)
      );
      corpo.appendChild(tr);
    }
  }

  function pintar() {
    pintarItens();
    pintarCandidatos();
    pintarResumo();
  }

  function limparEscolha() {
    escolha.item = null;
    escolha.estadoA = null;
    escolha.candidato = null;
    escolha.estadoB = null;
    el('trocarPecasMotivo').value = '';
    el('trocarPecasQuantidade').value = '1';
    mensagem('');
    pintar();
  }

  async function carregar() {
    el('trocarPecasCarregando').classList.remove('hidden');
    try {
      dados = await fetchApi(`/api/trocas-pecas/pedido/${encodeURIComponent(pedidoId)}`);
    } catch (e) {
      dados = null;
      avisar(textoDoErro(e, 'Você não tem permissão para trocar peças entre pedidos.'));
    }
    el('trocarPecasCarregando').classList.add('hidden');
    if (!dados) return;
    el('trocarPecasSubtitulo').textContent = [dados.pedido.numero, dados.pedido.cliente, dados.pedido.situacao].filter(Boolean).join(' · ');
    if (dados.sql_pendente) avisar('Falta rodar sql/trocas_pecas_e_avulsas.sql no banco e reiniciar a API: a troca ainda não pode ser gravada.');
    else if (!dados.pedido.pode_trocar) avisar(dados.pedido.motivo_bloqueio);
    else avisar('');
    el('trocarPecasConteudo').classList.remove('hidden');
    pintar();
    pintarHistorico();
  }

  async function confirmar() {
    mensagem('');
    if (!escolha.estadoA || !escolha.estadoB) return;
    const motivo = el('trocarPecasMotivo').value.trim();
    const quantidade = Math.trunc(Number(el('trocarPecasQuantidade').value) || 0);
    const maximo = Math.min(escolha.estadoA.quantidade, escolha.estadoB.quantidade);
    if (!(quantidade >= 1 && quantidade <= maximo)) { mensagem(`Escolha de 1 a ${maximo} peça${maximo === 1 ? '' : 's'}.`); return; }
    if (motivo.replace(/[^\p{L}]/gu, '').length < (dados.minimo_motivo || 10)) { mensagem(`Diga o motivo da troca (ao menos ${dados.minimo_motivo || 10} letras).`); return; }
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Trocar as peças?',
      tom: 'pergunta',
      icone: 'fa-exchange-alt',
      message: `${quantidade} × ${nomeDaPeca(escolha.item)}: ${dados.pedido.numero} entrega "${escolha.estadoA.rotulo}" e recebe "${escolha.estadoB.rotulo}" do ${escolha.candidato.numero}.`,
      nota: 'Fica registrado nos dois pedidos e não se desfaz apagando: para voltar atrás, faça outra troca.',
      confirmText: 'Trocar peças'
    }) ?? window.confirm('Trocar as peças?');
    if (!ok) return;
    try {
      const r = await fetchApi('/api/trocas-pecas', {
        method: 'POST',
        body: JSON.stringify({
          item_a: escolha.item.id, chave_a: escolha.estadoA.chave,
          item_b: escolha.candidato.item_id, chave_b: escolha.estadoB.chave,
          quantidade, motivo
        })
      });
      window.showToast?.(`Troca feita: ${r.a.pedido} recebeu "${r.a.entrou}" e o ${r.b.pedido} recebeu "${r.b.entrou}".`, 'success');
      limparEscolha();
      await carregar();
      window.dispatchEvent(new CustomEvent('pedido:pecas-trocadas', { detail: { pedidoId, troca: r.troca } }));
    } catch (e) {
      const texto = textoDoErro(e, 'Você não tem permissão para trocar peças entre pedidos.');
      // O estado mudou enquanto a tela estava aberta: relê e pede a escolha de novo.
      if (e?.status === 409 && !e?.corpo?.sql_pendente) {
        limparEscolha();
        await carregar();
        avisar(texto);
        return;
      }
      mensagem(texto);
    }
  }

  el('trocarPecasQuantidade').addEventListener('input', pintarResumo);
  el('trocarPecasLimpar').addEventListener('click', limparEscolha);
  const botaoConfirmar = el('trocarPecasConfirmar');
  if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botaoConfirmar, confirmar);
  else botaoConfirmar.addEventListener('click', confirmar);

  try {
    await carregar();
  } finally {
    if (typeof Modal?.signalReady === 'function') Modal.signalReady(overlayId);
    window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
  }
})();
