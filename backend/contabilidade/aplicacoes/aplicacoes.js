/**
 * Fase C (02/10/2026) — as aplicações do BB (Rende Fácil e CDB DI) pelos PDFs
 * mensais (leitura.js), "100% correto" sem API:
 *
 *   importar ........... lê cada PDF, guarda SÓ OS DADOS (saldos, resumo,
 *                        movimentos, depósitos, conferências, SHA-256) e as
 *                        linhas que o extrato da conta corrente tem de mostrar
 *                        (contabil_aplicacao_lancamentos). O PDF original não
 *                        dá para refazer: fica em contabil_arquivos só até o
 *                        pacote do mês ser salvo (descartarOriginais). Um PDF
 *                        novo do mesmo mês substitui o anterior (e solta o que
 *                        ele tinha ligado no extrato);
 *   conciliarSozinho ... cada linha do extrato com "RENDE FÁCIL" / "CDB" liga ao
 *                        lançamento do PDF do mesmo dia e valor exato (no Rende
 *                        Fácil a soma do dia; no CDB o capital e o rendimento do
 *                        resgate). Liga pela conciliação (critério "aplicacao"):
 *                        o lançamento fica conciliado e desfazer funciona como
 *                        em qualquer outro;
 *   listar ............. por mês: cada aplicação, as conferências, cada
 *                        lançamento esperado com a linha do extrato que o
 *                        cobre, e as linhas do extrato que sobraram;
 *   pendências ......... (pura) PDF que falta, PDF que não fecha, extrato que
 *                        não bate com o PDF — críticas com o mês encerrado.
 *
 * Classificação: as linhas conciliadas caem na conta da aplicação pelas
 * regras da fase B (RENDE FACIL → 00020.001, CDB → 00020.002): o rendimento
 * não vira receita, fica tudo na 00020, como no balancete (dono, 02/10).
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');
const arquivos = require('../arquivos');
const leitura = require('./leitura');

const TABELA = 'contabil_aplicacoes';
const LANCAMENTOS = 'contabil_aplicacao_lancamentos';
const { PRODUTOS } = leitura;
/** A linha do extrato que é de cada aplicação (o texto que o BB põe no lançamento). */
const PADROES = { rende_facil: /RENDE\s*F[AÁ]CIL/i, cdb: /\bCDB\b/i };
const SENTIDOS = { aplicacao: 'Aplicação', resgate: 'Resgate' };
const PARTES = { liquido: 'soma do dia', capital: 'capital', rendimento: 'rendimento líquido' };
const SITUACOES = {
  ok: 'Confere com o extrato', falta_pdf: 'Falta o PDF do mês', nao_confere: 'O PDF não fecha', divergente: 'O extrato não bate com o PDF',
  sem_movimento: 'Sem movimento no mês', a_conferir: 'Extrato incompleto'
};
const MAX_ARQUIVOS = 24;

const cent = v => Math.round(Math.abs(Number(v) || 0) * 100);
const valendo = a => a && !a.substituida_em;
const lerTodas = api => b.lerOpcional(api, TABELA);
const produtoDoMovimento = m => Object.keys(PADROES).find(p => PADROES[p].test(String(m?.descricao || ''))) || null;

/** A linha do banco com os números, as datas e o JSON no formato das contas. Pura. */
function normalizar(a) {
  const num = v => (v === null || v === undefined ? null : c.centavos(v));
  return {
    ...a, id: Number(a.id), competencia: String(a.competencia || '').trim(), periodo_inicio: c.dia(a.periodo_inicio), periodo_fim: c.dia(a.periodo_fim),
    saldo_inicial: num(a.saldo_inicial), saldo_final: num(a.saldo_final), rendimento_mes: num(a.rendimento_mes), ir_mes: num(a.ir_mes), iof_mes: num(a.iof_mes),
    resumo: c.jsonDe(a.resumo, {}) || {}, movimentos: c.jsonDe(a.movimentos, []) || [], depositos: c.jsonDe(a.depositos, []) || [],
    conferencias: c.jsonDe(a.conferencias, []) || [], confere: a.confere === true || a.confere === 'true'
  };
}

const normalizarLancamento = l => ({ ...l, id: Number(l.id), aplicacao_id: Number(l.aplicacao_id), data: c.dia(l.data), valor: c.centavos(l.valor) });

/** O que a tela vê de um PDF importado. Pura. */
function aplicacaoPublica(a) {
  return {
    id: a.id, produto: a.produto, produto_rotulo: PRODUTOS[a.produto] || a.produto, competencia: a.competencia, nome_arquivo: a.nome_arquivo || null,
    sha_curto: String(a.sha256 || '').slice(0, 12), agencia: a.agencia || null, conta: a.conta || null, periodo_inicio: a.periodo_inicio, periodo_fim: a.periodo_fim,
    saldo_inicial: a.saldo_inicial, saldo_final: a.saldo_final, rendimento_mes: a.rendimento_mes, ir_mes: a.ir_mes, iof_mes: a.iof_mes,
    resumo: a.resumo, movimentos: a.movimentos, depositos: a.depositos, conferencias: a.conferencias, confere: a.confere,
    original_guardado: Boolean(a.arquivo_id) && !a.original_descartado_em, original_descartado: Boolean(a.original_descartado_em),
    importado_em: b.instanteBR(a.importado_em)
  };
}

// ------------------------------------------------------------------ o mês (puro)

/**
 * Uma aplicação no mês: cada lançamento esperado com a(s) linha(s) do extrato
 * ligada(s), as linhas do extrato da aplicação que sobraram e a situação.
 * `vinculos` = os da conciliação valendo; `movimentos` = os do mês. Pura.
 */
function situacaoDoProduto({ produto, aplicacao = null, lancamentos = [], vinculos = [], movimentos = [], encerrada = false }) {
  const porMov = new Map(c.lista(movimentos).map(m => [String(m.id), m]));
  const ligadosA = new Map();
  for (const v of c.lista(vinculos)) {
    if (!v || v.desfeito_em || !SENTIDOS[v.alvo_tipo]) continue;
    const k = String(v.alvo_id);
    ligadosA.set(k, [...(ligadosA.get(k) || []), v]);
  }
  const linhas = c.lista(lancamentos).map(l => {
    const vs = ligadosA.get(String(l.id)) || [];
    const movs = vs.map(v => porMov.get(String(v.movimento_id))).filter(Boolean);
    return {
      id: l.id, data: l.data, sentido: l.sentido, sentido_rotulo: SENTIDOS[l.sentido], parte: l.parte, parte_rotulo: PARTES[l.parte], valor: l.valor, descricao: l.descricao || null,
      movimentos: movs.map(m => ({ id: Number(m.id), data: c.dia(m.data), valor: c.centavos(m.valor), descricao: m.descricao || null, estado: m.estado_conciliacao || 'pendente' })),
      coberto: movs.length > 0 && cent(movs.reduce((s, m) => s + Math.abs(Number(m.valor) || 0), 0)) === cent(l.valor)
    };
  });
  const usados = new Set(linhas.flatMap(l => l.movimentos.map(m => String(m.id))));
  const sobras = c.lista(movimentos).filter(m => produtoDoMovimento(m) === produto && !usados.has(String(m.id)))
    .map(m => ({ id: Number(m.id), data: c.dia(m.data), valor: c.centavos(m.valor), descricao: m.descricao || null, estado: m.estado_conciliacao || 'pendente' }));
  let situacao = 'ok';
  if (!aplicacao) situacao = sobras.length ? 'falta_pdf' : 'sem_movimento';
  else if (!aplicacao.confere) situacao = 'nao_confere';
  else if (linhas.some(l => !l.coberto) || sobras.length) situacao = encerrada ? 'divergente' : 'a_conferir';
  return { produto, rotulo: PRODUTOS[produto], aplicacao: aplicacao ? aplicacaoPublica(aplicacao) : null, lancamentos: linhas, sobras, situacao, situacao_rotulo: SITUACOES[situacao] };
}

/**
 * As pendências das aplicações do mês (vão na fonte do extrato do painel).
 * Mês encerrado: crítico; no mês em curso, aviso. `dados` = { aplicacoes
 * (valendo, do mês), lancamentos, vinculos, movimentos (do mês) }. Pura.
 */
function pendencias({ competencia, dados, encerrada = false }) {
  if (!dados) return [];
  const saida = [];
  const nivel = encerrada ? 'critico' : 'aviso';
  for (const produto of Object.keys(PRODUTOS)) {
    const aplicacao = c.lista(dados.aplicacoes).find(a => a.produto === produto && a.competencia === competencia) || null;
    const lancs = aplicacao ? c.lista(dados.lancamentos).filter(l => String(l.aplicacao_id) === String(aplicacao.id)) : [];
    const s = situacaoDoProduto({ produto, aplicacao, lancamentos: lancs, vinculos: dados.vinculos, movimentos: dados.movimentos, encerrada });
    const filtro = { acao: 'aplicacoes' };
    if (s.situacao === 'falta_pdf') {
      saida.push({
        nivel, chave: `aplicacao_sem_pdf_${produto}`, titulo: `PDF do ${PRODUTOS[produto]} de ${c.rotuloCompetencia(competencia)} não importado`,
        descricao: `${c.plural(s.sobras.length, 'lançamento', 'lançamentos')} da aplicação no extrato · importe o PDF do mês (site do BB › Investimentos) em Aplicações`,
        data: s.sobras[0]?.data || b.ultimoDia(competencia), acao: 'Importar', filtro
      });
    } else if (s.situacao === 'nao_confere') {
      const falhas = aplicacao.conferencias.filter(x => !x.ok);
      saida.push({
        nivel: 'critico', chave: `aplicacao_nao_confere_${produto}`, titulo: `O PDF do ${PRODUTOS[produto]} de ${c.rotuloCompetencia(competencia)} não fecha`,
        descricao: `${falhas.map(x => x.rotulo).join('; ')} · baixe o PDF de novo no site do BB e importe`, data: b.ultimoDia(competencia), acao: 'Ver', filtro
      });
    } else if (s.situacao === 'divergente' || (s.situacao === 'a_conferir' && encerrada)) {
      const faltam = s.lancamentos.filter(l => !l.coberto);
      saida.push({
        nivel, chave: `aplicacao_divergente_${produto}`, titulo: `O extrato do ${PRODUTOS[produto]} não bate com o PDF`,
        descricao: [faltam.length ? `${c.plural(faltam.length, 'lançamento do PDF', 'lançamentos do PDF')} sem a linha do extrato` : null,
          s.sobras.length ? `${c.plural(s.sobras.length, 'linha do extrato', 'linhas do extrato')} sem o PDF` : null].filter(Boolean).join(' · '),
        data: (faltam[0] || s.sobras[0])?.data || b.ultimoDia(competencia), acao: 'Ver', filtro
      });
    }
  }
  return saida;
}

// ------------------------------------------------------------------ leitura

/** Tudo das aplicações de um mês (ou de todos), numa leitura. null = falta o SQL da fase C. */
async function lerDoMes(api, competencia = null) {
  const todas = await lerTodas(api);
  if (todas === null) return null;
  const aplicacoes = todas.filter(Boolean).map(normalizar).filter(valendo).filter(a => !competencia || a.competencia === competencia);
  const ids = new Set(aplicacoes.map(a => String(a.id)));
  const [lancs, vinculos, movimentos] = await Promise.all([
    b.lerOpcional(api, LANCAMENTOS).then(x => x || []),
    b.lerOpcional(api, 'conciliacao_vinculos').then(x => x || []).catch(() => []),
    competencia ? b.lerOpcional(api, 'movimentos_bancarios', { competencia }).then(x => x || []).catch(() => []) : Promise.resolve([])
  ]);
  return {
    aplicacoes, lancamentos: lancs.filter(Boolean).map(normalizarLancamento).filter(l => ids.has(String(l.aplicacao_id))),
    vinculos: vinculos.filter(v => v && !v.desfeito_em && SENTIDOS[v.alvo_tipo]), movimentos
  };
}

async function listar(api, { competencia, hoje }) {
  const comp = c.competenciaValida(competencia) ? String(competencia) : c.competenciaDe(hoje);
  const dados = await lerDoMes(api, comp);
  if (!dados) return { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_C, competencia: comp, rotulo: c.rotuloCompetencia(comp), produtos: [] };
  const encerrada = b.ultimoDia(comp) < c.dia(hoje);
  const produtos = Object.keys(PRODUTOS).map(produto => {
    const aplicacao = dados.aplicacoes.find(a => a.produto === produto) || null;
    return situacaoDoProduto({
      produto, aplicacao, lancamentos: aplicacao ? dados.lancamentos.filter(l => l.aplicacao_id === aplicacao.id) : [], vinculos: dados.vinculos, movimentos: dados.movimentos, encerrada
    });
  });
  return { sql_pendente: false, competencia: comp, rotulo: c.rotuloCompetencia(comp), encerrada, produtos };
}

/** O PDF original (só enquanto está guardado: sai depois do pacote salvo). */
async function pdfOriginal(api, id) {
  const a = ((await b.ler(api, TABELA, { id: Number(id) }))[0]) || null;
  if (!a) throw c.erro('PDF da aplicação não encontrado.', 404);
  if (!a.arquivo_id || a.original_descartado_em) throw c.erro('O original já foi no pacote e saiu do servidor (ficam os dados): importe o PDF de novo para gerar outro pacote.', 409);
  const { arquivo, base64 } = await arquivos.ler(api, a.arquivo_id);
  return { nome: arquivo.nome_arquivo, tipo: 'application/pdf', base64 };
}

// ------------------------------------------------------------------ conciliação

/**
 * Liga as linhas do extrato aos lançamentos dos PDFs (o mesmo dia e o valor
 * exato; no Rende Fácil, a soma de várias linhas do dia também vale). Meses
 * fechados ficam como estão. `{ ligados, meses, falhas }`.
 */
async function conciliarSozinho(api, { competencias = null, usuarioId = null } = {}) {
  const todas = await lerTodas(api);
  if (!todas) return { ligados: 0, meses: [], falhas: [] };
  const conciliacao = require('../conciliacao/conciliacao');
  const lista = todas.filter(Boolean).map(normalizar).filter(valendo).filter(a => !competencias || competencias.includes(a.competencia));
  const saida = { ligados: 0, meses: new Set(), falhas: [] };
  for (const comp of [...new Set(lista.map(a => a.competencia))].sort()) {
    if (((await b.lerOpcional(api, 'competencia_contabil', { competencia: comp })) || [])[0]?.status === 'fechada') continue;
    const dados = await lerDoMes(api, comp);
    const usados = new Set(dados.vinculos.map(v => String(v.movimento_id)));
    const ligadoA = new Set(dados.vinculos.map(v => String(v.alvo_id)));
    for (const a of dados.aplicacoes) {
      const livres = dados.movimentos.filter(m => produtoDoMovimento(m) === a.produto && (m.estado_conciliacao || 'pendente') === 'pendente' && !usados.has(String(m.id)));
      for (const l of dados.lancamentos.filter(x => x.aplicacao_id === a.id && !ligadoA.has(String(x.id)))) {
        const sinal = l.sentido === 'aplicacao' ? -1 : 1;
        const doDia = livres.filter(m => !usados.has(String(m.id)) && c.dia(m.data) === l.data && Math.sign(Number(m.valor)) === sinal);
        const exatos = doDia.filter(m => cent(m.valor) === cent(l.valor));
        // Outro lançamento do PDF no mesmo dia, sentido e valor deixa a escolha ambígua: fica para a mão.
        const gemeos = dados.lancamentos.filter(x => x.aplicacao_id === a.id && x.id !== l.id && x.data === l.data && x.sentido === l.sentido && cent(x.valor) === cent(l.valor));
        let escolhidos = null;
        if (exatos.length === 1 && !gemeos.length) escolhidos = exatos;
        else if (!exatos.length && l.parte === 'liquido' && doDia.length > 1 && cent(doDia.reduce((s, m) => s + Math.abs(Number(m.valor)), 0)) === cent(l.valor)) escolhidos = doDia;
        if (!escolhidos) continue;
        try {
          for (const m of escolhidos) {
            await conciliacao.gravar(api, m, [{ tipo: l.sentido, id: l.id, restante: Math.abs(Number(m.valor)) }], {
              criterio: 'aplicacao', usuarioId,
              detalhe: `${PRODUTOS[a.produto]}: ${SENTIDOS[l.sentido].toLowerCase()} de ${c.impressa(l.data)} (${PARTES[l.parte]}) conferido com o PDF do BB`
            });
            usados.add(String(m.id));
            saida.ligados++;
          }
          ligadoA.add(String(l.id));
          saida.meses.add(comp);
        } catch (e) {
          saida.falhas.push(`${PRODUTOS[a.produto]} ${c.impressa(l.data)}: ${e.message}`);
        }
      }
    }
  }
  if (saida.ligados) {
    await eventos.registrar(api, {
      tipo: 'aplicacao_conciliada', usuarioId, competencia: [...saida.meses][0] || null,
      descricao: `${c.plural(saida.ligados, 'linha do extrato conferida', 'linhas do extrato conferidas')} com os PDFs das aplicações (Rende Fácil, CDB)`,
      dados: { ligados: saida.ligados, meses: [...saida.meses] }
    });
  }
  return { ...saida, meses: [...saida.meses].sort() };
}

/** Solta o que um PDF substituído tinha ligado no extrato (o lançamento volta a ficar a conciliar). */
async function soltarDoExtrato(api, aplicacaoId, { motivo, usuarioId = null }) {
  const lancs = ((await b.lerOpcional(api, LANCAMENTOS, { aplicacao_id: Number(aplicacaoId) })) || []).map(x => String(x.id));
  if (!lancs.length) return 0;
  const vinculos = ((await b.lerOpcional(api, 'conciliacao_vinculos').catch(() => null)) || []).filter(v => v && !v.desfeito_em && SENTIDOS[v.alvo_tipo] && lancs.includes(String(v.alvo_id)));
  for (const v of vinculos) {
    await b.atualizar(api, 'conciliacao_vinculos', v.id, { desfeito_em: c.agora(), desfeito_por: usuarioId, motivo_desfazer: motivo });
    const outros = ((await b.lerOpcional(api, 'conciliacao_vinculos', { movimento_id: Number(v.movimento_id) })) || []).filter(x => x && !x.desfeito_em && String(x.id) !== String(v.id));
    if (!outros.length) {
      await b.atualizar(api, 'movimentos_bancarios', v.movimento_id, { estado_conciliacao: 'pendente', conciliacao_diferenca: null, conciliacao_observacao: null, conciliado_em: null, conciliado_por: null });
    }
  }
  return vinculos.length;
}

// ------------------------------------------------------------------ importar

/**
 * Importa os PDFs (`arquivos` = [{ nome, base64 }]): os dados de cada um, as
 * linhas que o extrato tem de mostrar e o original guardado até o pacote. O
 * mês fechado recusa. Depois, liga ao extrato sozinho.
 */
async function importar(api, { arquivos: entradas = [], usuarioId = null, hoje }) {
  if (!Array.isArray(entradas) || !entradas.length) throw c.erro('Escolha o PDF do BB Rende Fácil e/ou o do CDB DI.');
  if ((await lerTodas(api)) === null) throw c.erro(b.SQL_FALTANDO_FASE_C, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_C });
  if (entradas.length > MAX_ARQUIVOS) throw c.erro(`Escolha no máximo ${MAX_ARQUIVOS} PDFs por vez.`, 413);
  const saida = { lidos: 0, novos: 0, repetidos: 0, substituidos: 0, nao_conferem: 0, falhas: [], importados: [] };
  for (const e of entradas) {
    const nome = arquivos.nomeDeArquivo(e?.nome || 'aplicacao.pdf');
    const dados = Buffer.from(String(e?.base64 || ''), 'base64');
    if (!dados.length) continue;
    saida.lidos++;
    const sha = arquivos.sha256(dados);
    const existentes = ((await lerTodas(api)) || []).filter(Boolean);
    if (existentes.some(x => x.sha256 === sha)) { saida.repetidos++; continue; }
    let lido;
    try {
      lido = leitura.analisar(dados);
    } catch (err) {
      saida.falhas.push(`${nome}: ${err.message}`);
      continue;
    }
    try {
      await b.garantirAberta(api, lido.competencia, 'importar o PDF da aplicação');
    } catch (err) {
      saida.falhas.push(`${nome}: ${err.message}`);
      continue;
    }
    // O PDF mais novo do mesmo mês entra no lugar do anterior (solta o que o anterior ligou no extrato).
    const anterior = existentes.map(normalizar).find(x => valendo(x) && x.produto === lido.produto && x.competencia === lido.competencia) || null;
    if (anterior) {
      await soltarDoExtrato(api, anterior.id, { motivo: `PDF do ${PRODUTOS[lido.produto]} substituído por um mais novo`, usuarioId });
      await b.atualizar(api, TABELA, anterior.id, { substituida_em: c.agora(), substituida_por: usuarioId });
      saida.substituidos++;
    }
    // O original não dá para refazer: fica guardado só até o pacote do mês ser salvo.
    const guardado = await arquivos.salvar(api, {
      nome, tipo: 'application/pdf', base64: dados.toString('base64'), categoria: 'extrato', origem: 'oficial', competencia: null,
      descricao: `PDF do ${PRODUTOS[lido.produto]} de ${c.rotuloCompetencia(lido.competencia)} (fica até o pacote)`, usuarioId, registrarEvento: false
    });
    const linha = await b.inserir(api, TABELA, {
      produto: lido.produto, competencia: lido.competencia, sha256: sha, nome_arquivo: nome, tamanho_bytes: dados.length,
      agencia: lido.agencia ? String(lido.agencia).slice(0, 10) : null, conta: lido.conta ? String(lido.conta).slice(0, 20) : null,
      periodo_inicio: lido.periodo_inicio, periodo_fim: lido.periodo_fim, saldo_inicial: lido.saldo_inicial, saldo_final: lido.saldo_final,
      rendimento_mes: lido.rendimento_mes, ir_mes: lido.ir_mes, iof_mes: lido.iof_mes,
      resumo: JSON.stringify(lido.resumo || {}), movimentos: JSON.stringify(lido.movimentos || []), conferencias: JSON.stringify(lido.conferencias || []),
      depositos: JSON.stringify({ depositos: lido.depositos || [], saldos_meses: lido.saldos_meses || [], rendimento_por_deposito: lido.rendimento_por_deposito || [] }),
      confere: lido.confere, arquivo_id: guardado.arquivo.id, importado_em: c.agora(), importado_por: usuarioId
    });
    for (const l of lido.lancamentos) {
      await b.inserir(api, LANCAMENTOS, { aplicacao_id: Number(linha.id), data: l.data, sentido: l.sentido, parte: l.parte, valor: l.valor, descricao: String(l.descricao || '').slice(0, 160) });
    }
    saida.novos++;
    if (!lido.confere) saida.nao_conferem++;
    saida.importados.push({ id: linha.id, produto: lido.produto, competencia: lido.competencia, confere: lido.confere, lancamentos: lido.lancamentos.length });
    await eventos.registrar(api, {
      tipo: 'aplicacao_importada', usuarioId, competencia: lido.competencia,
      descricao: `PDF do ${PRODUTOS[lido.produto]} de ${c.rotuloCompetencia(lido.competencia)} importado: saldo final ${c.reais(lido.saldo_final)}, ${c.plural(lido.lancamentos.length, 'lançamento esperado', 'lançamentos esperados')} no extrato`
        + `${lido.confere ? ' · todas as conferências ok' : ` · NÃO FECHA: ${lido.conferencias.filter(x => !x.ok).map(x => x.rotulo).join('; ')}`}${anterior ? ' · substituiu o PDF anterior' : ''}`,
      dados: { aplicacao_id: linha.id, produto: lido.produto, confere: lido.confere }
    });
  }
  const meses = [...new Set(saida.importados.map(x => x.competencia))];
  const ligados = meses.length ? await conciliarSozinho(api, { competencias: meses, usuarioId }) : { ligados: 0, falhas: [] };
  const partes = [c.plural(saida.lidos, 'PDF lido', 'PDFs lidos')];
  if (saida.novos) partes.push(c.plural(saida.novos, 'importado', 'importados'));
  if (saida.repetidos) partes.push(`${c.plural(saida.repetidos, 'já estava', 'já estavam')} no app`);
  if (saida.substituidos) partes.push(`${c.plural(saida.substituidos, 'substituiu o do mesmo mês', 'substituíram os do mesmo mês')}`);
  if (saida.nao_conferem) partes.push(`${c.plural(saida.nao_conferem, 'não fecha', 'não fecham')} (veja as conferências)`);
  if (ligados.ligados) partes.push(`${c.plural(ligados.ligados, 'linha do extrato conferida', 'linhas do extrato conferidas')} com o PDF`);
  return { ...saida, ligados: ligados.ligados, falhas: [...saida.falhas, ...ligados.falhas], resumo: partes.join(' · ') };
}

// ------------------------------------------------------------------ pacote

/** Depois do pacote salvo: o PDF original das aplicações do mês sai do servidor (ficam os dados e o SHA-256). */
async function descartarOriginais(api, { competencia, usuarioId = null, pacoteId = null }) {
  const todas = await lerTodas(api);
  if (!todas || !c.competenciaValida(competencia)) return { descartados: 0 };
  let descartados = 0;
  for (const a of todas.filter(x => x && x.competencia === competencia && x.arquivo_id && !x.original_descartado_em)) {
    try {
      for (const p of await b.ler(api, 'contabil_arquivo_partes', { arquivo_id: Number(a.arquivo_id) })) await b.excluir(api, 'contabil_arquivo_partes', p.id);
      await b.atualizar(api, 'contabil_arquivos', a.arquivo_id, {
        excluido_em: c.agora(), excluido_por: usuarioId, motivo_exclusao: `Original descartado depois do pacote${pacoteId ? ` ${pacoteId}` : ''} (ficam os dados e o SHA-256)`
      });
      await b.atualizar(api, TABELA, a.id, { original_descartado_em: c.agora() });
      descartados++;
    } catch (e) {
      console.warn('[contabilidade/aplicacoes] original não descartado:', e?.message || e);
    }
  }
  if (descartados) {
    await eventos.registrar(api, {
      tipo: 'aplicacoes_descartadas', usuarioId, competencia,
      descricao: `${c.plural(descartados, 'PDF de aplicação saiu', 'PDFs de aplicação saíram')} do servidor depois do pacote de ${c.rotuloCompetencia(competencia)} (ficam os dados e o SHA-256)`,
      dados: { pacote_id: pacoteId, descartados }
    });
  }
  return { descartados };
}

/**
 * Os itens dos Documentos da competência (o pacote usa a mesma lista): o PDF
 * de cada aplicação do mês, enquanto guardado; depois do pacote, a falta. Pura.
 */
function itensDeEvidencia(aplicacoes, competencia) {
  return c.lista(aplicacoes).filter(a => a && valendo(a) && a.competencia === competencia).map(a => {
    const base = {
      chave: `aplicacao:${a.id}`, grupo: 'outros', data: a.periodo_fim || b.ultimoDia(competencia), titulo: `PDF do ${PRODUTOS[a.produto]} — ${c.rotuloCompetencia(competencia)}`,
      detalhe: [`saldo final ${c.reais(a.saldo_final)}`, a.confere ? 'confere ao centavo' : 'NÃO FECHA', a.nome_arquivo].filter(Boolean).join(' · '),
      valor: a.saldo_final, categoria: arquivos.CATEGORIAS.extrato
    };
    if (a.arquivo_id && !a.original_descartado_em) return { ...base, origem: 'oficial', baixar: { tipo: 'arquivo', id: a.arquivo_id }, falta: false };
    return { ...base, origem: null, baixar: null, falta: true, falta_rotulo: 'O original já saiu no pacote: importe de novo' };
  });
}

module.exports = {
  TABELA, LANCAMENTOS, PRODUTOS, PADROES, SENTIDOS, PARTES, SITUACOES,
  normalizar, normalizarLancamento, aplicacaoPublica, produtoDoMovimento, situacaoDoProduto, pendencias, itensDeEvidencia,
  lerTodas, lerDoMes, listar, pdfOriginal, conciliarSozinho, soltarDoExtrato, importar, descartarOriginais
};
