/**
 * "Regra Produção" do cadastro da peça (Novo e Editar produto).
 *
 * Quanto cada processo paga por esta peça: o PADRÃO do processo (Regras do
 * Financeiro) ou um valor PRÓPRIO — R$ por peça ou % do preço cheio da tabela
 * fixa. O que se escolhe fica num rascunho até a peça ser gravada; só então
 * vai para PUT /api/financeiro/regra-producao/:id.
 *
 * Como os dados fiscais, a regra é condição para salvar: todo processo que a
 * peça usa (tem insumo) e que está com o pagamento ligado precisa de valor —
 * o da peça ou o padrão.
 *
 * O Financeiro paga cada processo na proporção dos insumos dele que a peça
 * ainda não tinha (backend/financeiro/producaoUnidades.js); aqui só se
 * define o valor da peça inteira.
 */
(() => {
  if (window.RegraProducaoPeca) return;

  const semAcento = t => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatarMoeda = v => moeda.format(Number(v) || 0);
  const centavos = v => Math.round((Number(v) || 0) * 100) / 100;
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  async function fetchApi(caminho, opcoes) {
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}${caminho}`, {
      ...opcoes,
      headers: { 'Content-Type': 'application/json', ...(opcoes?.headers || {}) }
    });
    let corpo = null;
    try { corpo = await resposta.json(); } catch (_) { corpo = null; }
    if (!resposta.ok) {
      const e = new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
      e.status = resposta.status;
      e.corpo = corpo;
      throw e;
    }
    return corpo;
  }

  /** 'R$ 1.234,56', '1234,56', '10%' ou '12.5' -> número; vazio ou inválido -> null. */
  function lerNumero(texto) {
    const limpo = String(texto ?? '').replace(/R\$|%/g, '').replace(/\s/g, '').trim();
    if (!limpo) return null;
    const normalizado = limpo.includes(',')
      ? limpo.replace(/\./g, '').replace(',', '.')
      : (/^\d{1,3}(\.\d{3})+$/.test(limpo) ? limpo.replace(/\./g, '') : limpo);
    const n = Number(normalizado);
    return Number.isFinite(n) ? n : null;
  }

  const percentualTexto = p => `${String(Math.round(Number(p) * 10000) / 10000).replace('.', ',')}%`;

  function descrever(regra) {
    if (!regra) return 'sem regra';
    if (regra.tipo === 'percentual') return `${percentualTexto(regra.percentual)} da tabela fixa`;
    return `${formatarMoeda(regra.valor)} por peça`;
  }

  /** Quanto a regra paga pela peça inteira (null: sem regra, ou % sem preço). */
  function valorDaPeca(regra, preco) {
    if (!regra) return null;
    if (regra.tipo !== 'percentual') return centavos(regra.valor);
    const p = Number(preco);
    return Number.isFinite(p) && p > 0 ? centavos(p * Number(regra.percentual) / 100) : null;
  }

  /** Os processos da ficha, na ordem em que aparecem: [{ nome, insumos }]. */
  function processosDosItens(itens) {
    const mapa = new Map();
    for (const it of Array.isArray(itens) ? itens : []) {
      if (!it || it.status === 'deleted') continue;
      const nome = String(it.processo ?? '').trim();
      if (!nome) continue;
      const chave = semAcento(nome);
      const atual = mapa.get(chave) || { nome, insumos: 0 };
      atual.insumos += 1;
      mapa.set(chave, atual);
    }
    return [...mapa.values()];
  }

  /** A escolha do rascunho vira regra: { tipo, valor, percentual } ou null (usar o padrão). */
  function regraDaEscolha(escolha) {
    if (!escolha || escolha.modo === 'padrao') return null;
    const n = lerNumero(escolha.valor);
    if (n === null) return null;
    return escolha.modo === 'percentual'
      ? { tipo: 'percentual', valor: null, percentual: n }
      : { tipo: 'valor', valor: centavos(n), percentual: null };
  }

  /** O que há de errado no valor digitado (texto), ou ''. */
  function erroDaEscolha(escolha) {
    if (!escolha || escolha.modo === 'padrao') return '';
    const n = lerNumero(escolha.valor);
    if (escolha.modo === 'percentual') return n === null || n < 0 || n > 100 ? 'o percentual vai de 0 a 100' : '';
    return n === null || n < 0 ? 'informe o valor em reais' : '';
  }

  /**
   * Um controle por modal de peça.
   *   produtoId   a peça gravada (Editar), ou null (Novo)
   *   obterItens  () => os insumos da ficha (com `processo`)
   *   obterPreco  () => o preço da tabela fixa que vai valer (base do %), ou null
   *   aoMudar     () => chamado quando o rascunho ou a leitura mudam
   */
  function criar({ produtoId = null, obterItens = () => [], obterPreco = () => null, aoMudar = () => {} } = {}) {
    let base = null;
    let erro = null;
    let carregando = null;
    let rascunho = new Map();

    async function carregar() {
      if (carregando) return carregando;
      carregando = (async () => {
        try {
          const consulta = produtoId ? `?produto_id=${encodeURIComponent(produtoId)}` : '';
          base = await fetchApi(`/api/financeiro/regra-producao${consulta}`);
          erro = null;
          const inicial = new Map();
          for (const e of base?.etapas || []) {
            const d = e.da_peca;
            if (!d) continue;
            inicial.set(String(e.id), d.tipo === 'percentual'
              ? { modo: 'percentual', valor: String(d.percentual ?? '').replace('.', ',') }
              : { modo: 'valor', valor: formatarMoeda(d.valor) });
          }
          // O que já foi escolhido nesta tela vale mais que o gravado.
          for (const [k, v] of rascunho) inicial.set(k, v);
          rascunho = inicial;
        } catch (e) {
          base = null;
          erro = e;
        } finally {
          carregando = null;
          aoMudar();
        }
      })();
      return carregando;
    }

    const etapaDe = nome => (base?.etapas || []).find(e => semAcento(e.nome) === semAcento(nome)) || null;

    /** Uma linha por processo da ficha, com a regra que vai valer. */
    function linhas() {
      const preco = obterPreco();
      return processosDosItens(obterItens()).map(p => {
        const etapa = etapaDe(p.nome);
        const pagando = etapa ? etapa.producao_ativa !== false : false;
        const escolha = etapa ? (rascunho.get(String(etapa.id)) || { modo: 'padrao', valor: '' }) : { modo: 'padrao', valor: '' };
        const propria = regraDaEscolha(escolha);
        const regra = propria || etapa?.padrao || null;
        const problemaDoValor = erroDaEscolha(escolha);
        let falta = '';
        if (!etapa) falta = 'processo não cadastrado';
        else if (!pagando) falta = '';
        else if (problemaDoValor) falta = problemaDoValor;
        else if (!regra) falta = 'sem regra própria nem de todas as peças';
        return {
          nome: etapa ? etapa.nome : p.nome, insumos: p.insumos, etapa, pagando, escolha,
          origem: propria ? 'peca' : (etapa?.padrao ? 'padrao' : null), regra,
          valor_peca: pagando ? valorDaPeca(regra, preco) : null,
          falta
        };
      });
    }

    function pendencias() {
      if (erro) return [{ nome: 'Regra Produção', falta: erro?.corpo?.sql_pendente ? erro.message : 'não foi possível ler as regras de produção' }];
      if (!base) return [{ nome: 'Regra Produção', falta: 'ainda carregando' }];
      return linhas().filter(l => l.falta);
    }

    /** O texto do (i): o que cada processo vai pagar. */
    function resumo({ codigo = '', nome = '' } = {}) {
      const preco = obterPreco();
      const partes = [];
      const peca = [codigo, nome].filter(Boolean).join(' — ');
      if (peca) partes.push(`Peça: ${peca}`);
      partes.push(preco > 0
        ? `Base do %: ${formatarMoeda(preco)} (tabela fixa)`
        : 'Base do %: a peça ainda não tem preço na tabela fixa');
      partes.push('');
      const lista = linhas();
      if (!lista.length) partes.push('A peça ainda não tem insumos: nenhum processo a pagar.');
      for (const l of lista) {
        const cabeca = `${l.nome} (${plural(l.insumos, 'insumo', 'insumos')})`;
        if (!l.etapa) { partes.push(`${cabeca}: processo não cadastrado nas etapas`); continue; }
        if (!l.pagando) { partes.push(`${cabeca}: pagamento desligado`); continue; }
        if (l.falta) { partes.push(`${cabeca}: FALTA — ${l.falta}`); continue; }
        const origem = l.origem === 'peca' ? 'desta peça' : 'todas as peças';
        const inteira = l.valor_peca === null ? 'sem preço de tabela para calcular' : `${formatarMoeda(l.valor_peca)} por peça inteira`;
        const cada = l.valor_peca !== null && l.insumos > 1 ? `; cada insumo vale ${formatarMoeda(centavos(l.valor_peca / l.insumos))}` : '';
        partes.push(`${cabeca}: ${descrever(l.regra)} (${origem}) → ${inteira}${cada}`);
      }
      partes.push('');
      partes.push('Peça que sai do estoque com parte do processo pronta paga só os insumos que faltavam.');
      return partes.join('\n');
    }

    /**
     * A caixa do (i), organizada: cartões (base do %, processos, total por
     * peça) e uma linha por processo com o valor à direita e a conta embaixo.
     * Vai direto para `DialogPadrao.info({ title, ...caixa() })`.
     */
    function caixa({ codigo = '', nome = '' } = {}) {
      const preco = obterPreco();
      const lista = linhas();
      const comValor = lista.filter(l => l.etapa && l.pagando && !l.falta && l.valor_peca !== null);
      const faltam = lista.filter(l => l.falta).length;
      const total = centavos(comValor.reduce((s, l) => s + l.valor_peca, 0));
      const itens = lista.map(l => {
        const insumos = plural(l.insumos, 'insumo', 'insumos');
        if (!l.etapa) return { rotulo: l.nome, valor: 'Não cadastrado', tom: 'erro', detalhe: `${insumos} · o processo não existe nas etapas de produção` };
        if (!l.pagando) return { rotulo: l.nome, valor: 'Pagamento desligado', detalhe: `${insumos} · este processo não é pago por peça` };
        if (l.falta) return { rotulo: l.nome, valor: 'Falta', tom: 'aviso', detalhe: `${insumos} · ${l.falta}` };
        const origem = l.origem === 'peca' ? 'desta peça' : 'todas as peças';
        const cada = l.valor_peca !== null && l.insumos > 1 ? ` · cada insumo vale ${formatarMoeda(centavos(l.valor_peca / l.insumos))}` : '';
        return {
          rotulo: l.nome,
          valor: l.valor_peca === null ? '—' : formatarMoeda(l.valor_peca),
          tom: l.valor_peca === null ? 'aviso' : undefined,
          detalhe: l.valor_peca === null
            ? `${insumos} · ${descrever(l.regra)} (${origem}) · sem preço de tabela para calcular`
            : `${insumos} · ${descrever(l.regra)} (${origem})${cada}`
        };
      });
      return {
        subtitle: [codigo, nome].filter(Boolean).join(' — ') || undefined,
        tom: faltam ? 'aviso' : 'info',
        icone: 'fa-industry',
        resumo: [
          { rotulo: 'Base do %', valor: preco > 0 ? formatarMoeda(preco) : '—', dica: preco > 0 ? 'preço da tabela fixa' : 'sem preço na tabela fixa' },
          { rotulo: 'Processos', valor: String(lista.length), dica: faltam ? `${plural(faltam, 'falta acertar', 'faltam acertar')}` : 'todos com valor', tom: faltam ? 'aviso' : undefined },
          { rotulo: 'Total por peça', valor: formatarMoeda(total), tom: 'sucesso', dica: 'soma dos processos' }
        ],
        secoes: lista.length
          ? [{ titulo: 'Quanto cada processo paga', icone: 'fa-hammer', itens }]
          : [{ titulo: 'Processos', icone: 'fa-hammer', texto: 'A peça ainda não tem insumos: nenhum processo a pagar.' }],
        nota: 'Peça que sai do estoque com parte do processo pronta paga só os insumos que faltavam.'
      };
    }

    function definirRascunho(novo) {
      rascunho = new Map([...(novo instanceof Map ? novo : new Map(Object.entries(novo || {})))].map(([k, v]) => [String(k), { modo: v.modo, valor: v.valor ?? '' }]));
      aoMudar();
    }

    /** Grava a regra da peça (depois de a peça estar gravada). */
    async function gravar(idDaPeca) {
      if (!idDaPeca) throw new Error('A peça ainda não tem código no banco.');
      const valores = [];
      for (const l of linhas()) {
        if (!l.etapa) continue;
        const escolha = l.escolha || { modo: 'padrao' };
        const n = lerNumero(escolha.valor);
        valores.push(escolha.modo === 'padrao' || n === null
          ? { etapa_id: l.etapa.id, modo: 'padrao' }
          : { etapa_id: l.etapa.id, modo: escolha.modo, valor: String(n) });
      }
      return fetchApi(`/api/financeiro/regra-producao/${encodeURIComponent(idDaPeca)}`, {
        method: 'PUT', body: JSON.stringify({ valores })
      });
    }

    return {
      carregar, linhas, pendencias, resumo, caixa, gravar, definirRascunho,
      rascunho: () => new Map(rascunho),
      base: () => base,
      erro: () => erro,
      preco: () => obterPreco(),
      trocarPeca(id) { produtoId = id; }
    };
  }

  window.RegraProducaoPeca = {
    criar, lerNumero, descrever, valorDaPeca, processosDosItens, regraDaEscolha, erroDaEscolha, formatarMoeda, percentualTexto, semAcento
  };
})();
