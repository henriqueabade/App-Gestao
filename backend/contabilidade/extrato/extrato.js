/**
 * Extrato bancário (etapa 4): contas financeiras, importação do OFX e os
 * movimentos.
 *
 * - O OFX original fica guardado como arquivo OFICIAL da competência (é a
 *   evidência que vai no pacote) e cada lançamento vira um movimento com a
 *   identidade (hash) da conta + data + valor + FITID: importar o mesmo mês de
 *   novo só acrescenta o que faltava.
 * - Movimento é o dado do banco: não se edita. Importação errada se desfaz
 *   (com motivo) enquanto nenhum movimento dela estiver conciliado (etapa 5),
 *   da mais nova para a mais antiga quando os períodos se cruzam; o OFX dela
 *   sai das evidências.
 * - Competência fechada recusa importação e desfazer que mexam nela.
 * - A cobertura diz de que dia a que dia o mês já tem extrato: o checklist
 *   cobra o mês inteiro das contas correntes ativas.
 *
 * A API de Extratos do BB (etapa 11, integracoes/bbExtrato.js) grava nas
 * mesmas tabelas pelo mesmo caminho (`analisar` + `gravar`), com
 * `origem = 'api'` e os campos que só ela traz (contrapartida, histórico,
 * sistema de pagamento); a resposta da API fica como evidência.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');
const arquivos = require('../arquivos');
const ofx = require('./ofx');

const TIPOS_CONTA = { corrente: 'Conta corrente', aplicacao: 'Aplicação', caixa: 'Caixa' };
const ORIGENS = { ofx: 'OFX', api: 'API do BB', manual: 'Digitado' };
const BANCOS = { '001': 'Banco do Brasil', '104': 'Caixa', '237': 'Bradesco', '341': 'Itaú', '033': 'Santander', '756': 'Sicoob', '748': 'Sicredi', '077': 'Inter', '260': 'Nubank' };

const viva = i => i && i.status !== 'desfeita';

// ------------------------------------------------------------------ contas

function rotuloDaConta(conta) {
  if (!conta) return '—';
  const banco = BANCOS[conta.banco_codigo] || (conta.banco_codigo ? `Banco ${conta.banco_codigo}` : null);
  const ag = conta.agencia ? `ag. ${conta.agencia}${conta.agencia_dv ? `-${conta.agencia_dv}` : ''}` : null;
  const cc = conta.conta ? `c/c ${conta.conta}` : null;
  return [banco, ag, cc].filter(Boolean).join(' · ') || conta.nome;
}

function contaPublica(conta) {
  return {
    id: conta.id, nome: conta.nome, tipo: conta.tipo, tipo_rotulo: TIPOS_CONTA[conta.tipo] || conta.tipo,
    banco_codigo: conta.banco_codigo || null, banco: BANCOS[conta.banco_codigo] || null,
    agencia: conta.agencia || null, agencia_dv: conta.agencia_dv || null, conta: conta.conta || null,
    saldo_inicial: conta.saldo_inicial === null || conta.saldo_inicial === undefined ? null : c.centavos(conta.saldo_inicial),
    saldo_inicial_data: c.dia(conta.saldo_inicial_data), ativa: conta.ativa !== false && conta.ativa !== 'false',
    observacao: conta.observacao || null, rotulo: rotuloDaConta(conta),
    // Fase B: a conta do plano da AEA (BB conta corrente = 00008).
    plano_conta_id: conta.plano_conta_id ?? null
  };
}

/** A conta conferida (nome, tipo, banco de 3 dígitos, agência e conta só dígitos). Pura. */
function validarConta(entrada = {}) {
  const nome = c.texto(entrada.nome, 80);
  if (nome.length < 2) throw c.erro('Dê um nome à conta (ex.: BB — conta corrente).');
  const tipo = TIPOS_CONTA[entrada.tipo] ? entrada.tipo : 'corrente';
  const banco = b.digitos(entrada.banco_codigo).slice(0, 3);
  const agencia = b.digitos(entrada.agencia).slice(0, 6);
  const conta = b.digitos(entrada.conta).slice(0, 15);
  if (tipo !== 'caixa' && (!banco || !agencia || !conta)) throw c.erro('Informe banco, agência e conta (só números; o dígito da conta vai junto, no fim).');
  const saldo = entrada.saldo_inicial === null || entrada.saldo_inicial === undefined || entrada.saldo_inicial === '' ? null : b.valorDe(entrada.saldo_inicial);
  const dataSaldo = String(entrada.saldo_inicial_data || '').slice(0, 10);
  if (saldo !== null && !c.dataValida(dataSaldo)) throw c.erro('Informe o dia do saldo de abertura (o saldo no fim dele).');
  if (dataSaldo && !c.dataValida(dataSaldo)) throw c.erro('Dia do saldo de abertura inválido.');
  // Fase B: a conta do plano só vai quando a tela manda (sem o SQL da fase B a coluna não existe).
  const planoConta = entrada.plano_conta_id === undefined ? undefined
    : (entrada.plano_conta_id === null || entrada.plano_conta_id === '' ? null : String(entrada.plano_conta_id));
  if (planoConta && !/^\d+$/.test(planoConta)) throw c.erro('Conta do plano inválida.');
  return {
    nome, tipo, banco_codigo: banco ? banco.padStart(3, '0') : null, agencia: agencia || null,
    agencia_dv: String(entrada.agencia_dv || '').replace(/[^0-9xX]/g, '').slice(0, 1).toUpperCase() || null, conta: conta || null,
    saldo_inicial: saldo, saldo_inicial_data: dataSaldo || null,
    ativa: !(entrada.ativa === false || entrada.ativa === 'false'), observacao: String(entrada.observacao ?? '').trim().slice(0, 500) || null,
    ...(planoConta === undefined ? {} : { plano_conta_id: planoConta === null ? null : Number(planoConta) })
  };
}

async function listarContas(api) {
  const [contas, cfg] = await Promise.all([
    b.ler(api, 'contas_financeiras'),
    api.get('/api/configuracao_cobranca', { query: { id: 1 } }).then(c.lista).then(l => l.find(x => Number(x?.id) === 1) || null).catch(() => null)
  ]);
  const sugestao = cfg?.agencia && cfg?.conta ? {
    nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: b.digitos(cfg.agencia), agencia_dv: cfg.agencia_dv || null, conta: b.digitos(cfg.conta)
  } : null;
  const jaTem = sugestao && contas.some(x => x.banco_codigo === '001' && x.conta === sugestao.conta);
  return {
    contas: contas.map(contaPublica).sort((x, y) => Number(y.ativa) - Number(x.ativa) || x.nome.localeCompare(y.nome, 'pt-BR')),
    sugestao_cobranca: jaTem ? null : sugestao,
    tipos: TIPOS_CONTA
  };
}

async function salvarConta(api, { id = null, entrada = {}, usuarioId = null }) {
  const dados = validarConta(entrada);
  try {
    if (id) {
      const atual = (await b.ler(api, 'contas_financeiras', { id: Number(id) }))[0];
      if (!atual) throw c.erro('Conta não encontrada.', 404);
      await b.atualizar(api, 'contas_financeiras', atual.id, { ...dados, atualizado_em: c.agora() });
      return { id: atual.id };
    }
    const criada = await b.inserir(api, 'contas_financeiras', { ...dados, criado_por: usuarioId, criado_em: c.agora() });
    await eventos.registrar(api, { tipo: 'conta_financeira_criada', usuarioId, descricao: `Conta ${dados.nome} (${rotuloDaConta(dados)}) cadastrada` });
    return { id: criada.id };
  } catch (e) {
    if (c.ehDuplicado(e) && !e.extra?.sql_pendente) throw c.erro('Já existe uma conta com este banco, agência e conta.', 409);
    throw e;
  }
}

async function lerConta(api, id) {
  const conta = (await b.ler(api, 'contas_financeiras', { id: Number(id) }))[0] || null;
  if (!conta) throw c.erro('Escolha a conta do extrato.', 404);
  return conta;
}

// ------------------------------------------------------------------ cobertura

const somarDia = (iso, n) => {
  const [a, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

/**
 * De que dia a que dia a competência já tem extrato nesta conta (as
 * importações vivas) e os buracos. `ate` é o último dia exigido: o fim do mês
 * ou, no mês em curso, ontem. Pura.
 */
function cobertura(importacoes, competencia, { hoje } = {}) {
  const inicioMes = `${competencia}-01`;
  const fimMes = b.ultimoDia(competencia);
  const ontem = hoje ? somarDia(c.dia(hoje), -1) : fimMes;
  const ate = ontem < fimMes ? ontem : fimMes;
  const faixas = c.lista(importacoes).filter(viva)
    .map(i => ({ de: c.dia(i.periodo_inicio), ate: c.dia(i.periodo_fim) }))
    .filter(f => f.de && f.ate && f.de <= fimMes && f.ate >= inicioMes)
    .map(f => ({ de: f.de < inicioMes ? inicioMes : f.de, ate: f.ate > fimMes ? fimMes : f.ate }))
    .sort((x, y) => x.de.localeCompare(y.de));
  const faltas = [];
  let cursor = inicioMes;
  for (const f of faixas) {
    if (f.de > cursor && cursor <= ate) faltas.push({ de: cursor, ate: somarDia(f.de, -1) < ate ? somarDia(f.de, -1) : ate });
    if (somarDia(f.ate, 1) > cursor) cursor = somarDia(f.ate, 1);
  }
  if (cursor <= ate) faltas.push({ de: cursor, ate });
  return {
    de: faixas.length ? faixas[0].de : null,
    ate: faixas.length ? faixas.reduce((m, f) => (f.ate > m ? f.ate : m), faixas[0].ate) : null,
    exigido_ate: ate,
    faltas: ate < inicioMes ? [] : faltas,
    completa: ate < inicioMes || !faltas.length
  };
}

const faixaImpressa = f => (f.de === f.ate ? c.impressa(f.de) : `${c.impressa(f.de)} a ${c.impressa(f.ate)}`);

// ------------------------------------------------------------------ importação

/** O extrato do arquivo que é da conta escolhida (ou o primeiro, com aviso). */
function extratoDaConta(lido, conta) {
  const iguais = lido.extratos.filter(e => ofx.mesmaConta(e, conta) === true);
  return { extrato: iguais[0] || lido.extratos[0], confere: iguais.length > 0 ? true : (ofx.mesmaConta(lido.extratos[0], conta) === null ? null : false) };
}

/** Lê o arquivo, separa os novos dos já importados e diz o que bloqueia/avisa (nada é gravado). */
async function preparar(api, { contaId, base64 }) {
  const conta = await lerConta(api, contaId);
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) throw c.erro('Escolha o arquivo OFX do extrato.');
  const lido = ofx.lerOfx(buffer);
  const { extrato, confere } = extratoDaConta(lido, conta);
  const p = await analisar(api, { conta, extrato, confere, origem: 'ofx', versao: lido.versao });
  if (lido.extratos.length > 1) {
    const aviso = `O arquivo tem ${lido.extratos.length} extratos; entra só o da conta escolhida.`;
    p.avisos.push(aviso);
  }
  return { ...p, lido };
}

/**
 * O extrato já lido (do OFX ou da API do BB) contra o que a conta tem:
 * novos × já importados, meses fechados, conta desativada, outra origem no
 * mesmo período. Nada é gravado. `extrato` tem o formato do leitor do OFX.
 */
async function analisar(api, { conta, extrato, confere = null, origem = 'ofx', versao = null }) {
  const [existentes, importacoes, competencias] = await Promise.all([
    b.ler(api, 'movimentos_bancarios', { conta_id: Number(conta.id) }),
    b.ler(api, 'extrato_importacoes', { conta_id: Number(conta.id) }),
    b.lerOpcional(api, 'competencia_contabil')
  ]);
  const porHash = new Map(existentes.map(m => [String(m.hash).trim(), m]));
  // Já veio por outra origem (a API do BB, digitado)? Mesmo dia, valor e documento.
  const parecidoDe = (data, valor, documento) => `${data}|${c.centavos(valor).toFixed(2)}|${documento}`;
  const parecidos = new Map(existentes.filter(m => m.documento).map(m => [parecidoDe(c.dia(m.data), m.valor, m.documento), m]));
  const linhas = ofx.comHash(conta.id, extrato.lancamentos).map(l => {
    const repetido = porHash.has(l.hash) || (l.documento && parecidos.has(parecidoDe(l.data, l.valor, l.documento)));
    return { ...l, competencia: l.data.slice(0, 7), novo: !repetido };
  });
  const novos = linhas.filter(l => l.novo);
  const fechadas = new Set((competencias || []).filter(x => x.status === 'fechada').map(x => x.competencia));
  // Fase A: a linha que já veio (do OFX) ganha o que só a API traz — o CPF/CNPJ da
  // contrapartida e os códigos —, sem mudar o resto. Mês fechado fica como está.
  const enriquecer = linhas.filter(l => !l.novo && !fechadas.has(l.competencia)).map(l => {
    const m = porHash.get(l.hash) || (l.documento ? parecidos.get(parecidoDe(l.data, l.valor, l.documento)) : null);
    if (!m) return null;
    const campos = {};
    for (const [campo, tamanho] of CAMPOS_SO_DA_API) if (l[campo] && !m[campo]) campos[campo] = String(l[campo]).slice(0, tamanho);
    return Object.keys(campos).length ? { id: m.id, campos, competencia: l.competencia } : null;
  }).filter(Boolean);
  const bloqueios = [];
  const avisos = [];
  if (conta.ativa === false || conta.ativa === 'false') bloqueios.push('Esta conta está desativada.');
  const mesesNovos = [...new Set(novos.map(l => l.competencia))].sort();
  const mesesFechados = mesesNovos.filter(m => fechadas.has(m));
  if (mesesFechados.length) bloqueios.push(`O extrato traz lançamentos novos em ${mesesFechados.map(c.rotuloCompetencia).join(', ')}, que está fechada na Contabilidade: reabra para importar.`);
  if (!linhas.length && !extrato.saldo) bloqueios.push('O arquivo não tem lançamentos nem saldo.');
  if (confere === false) avisos.push(`A conta do arquivo (${[extrato.agencia && `ag. ${extrato.agencia}`, extrato.conta && `c/c ${extrato.conta}`].filter(Boolean).join(' ')}) não parece ser ${conta.nome}. Confira antes de importar.`);
  if (extrato.banco && conta.banco_codigo && Number(extrato.banco) !== Number(conta.banco_codigo)) avisos.push(`O arquivo é do banco ${extrato.banco} e a conta, do ${conta.banco_codigo}.`);
  if (extrato.moeda && extrato.moeda !== 'BRL') avisos.push(`A moeda do extrato é ${extrato.moeda}.`);
  if (extrato.zerados) avisos.push(`${c.plural(extrato.zerados, 'linha de valor zero (saldo) foi ignorada', 'linhas de valor zero (saldo) foram ignoradas')}.`);
  if (extrato.invalidos) avisos.push(`${c.plural(extrato.invalidos, 'lançamento sem data ou valor foi ignorado', 'lançamentos sem data ou valor foram ignorados')}.`);
  const inicio = extrato.inicio || linhas.map(l => l.data).sort()[0] || null;
  const fim = extrato.fim || linhas.map(l => l.data).sort().at(-1) || null;
  const outraOrigem = importacoes.filter(viva).filter(i => i.origem !== origem && c.dia(i.periodo_inicio) <= fim && c.dia(i.periodo_fim) >= inicio);
  if (outraOrigem.length) avisos.push(`Já há extrato de outra origem (${ORIGENS[outraOrigem[0].origem] || outraOrigem[0].origem}) neste período: o que tiver o mesmo documento, dia e valor fica de fora.`);
  return {
    conta, extrato, linhas, novos, enriquecer, bloqueios, avisos, inicio, fim, meses: [...new Set(linhas.map(l => l.competencia))].sort(),
    resumo: {
      conta: contaPublica(conta), versao, origem, confere,
      arquivo: { banco: extrato.banco, agencia: extrato.agencia, conta: extrato.conta, moeda: extrato.moeda },
      periodo: { inicio, fim }, saldo: extrato.saldo,
      lidos: linhas.length, novos: novos.length, repetidos: linhas.length - novos.length, completados: enriquecer.length,
      creditos: c.centavos(novos.filter(l => l.valor > 0).reduce((s, l) => s + l.valor, 0)),
      debitos: c.centavos(novos.filter(l => l.valor < 0).reduce((s, l) => s + l.valor, 0)),
      linhas: linhas.slice(0, 300).map(l => ({ data: l.data, valor: l.valor, tipo: l.tipo, descricao: l.descricao, documento: l.documento, novo: l.novo })),
      bloqueios, avisos
    }
  };
}

async function previa(api, { contaId, base64 }) {
  return (await preparar(api, { contaId, base64 })).resumo;
}

async function importar(api, { contaId, nome, base64, usuarioId = null }) {
  const p = await preparar(api, { contaId, base64 });
  return gravar(api, p, {
    origem: 'ofx', usuarioId, nomeImportacao: nome || 'extrato.ofx',
    evidencia: { nome: nome || `extrato-${p.inicio || 'sem-data'}-${p.fim || ''}.ofx`, tipo: 'application/x-ofx', base64, rotulo: 'O arquivo OFX' }
  });
}

/** Corta o texto (ou null) no tamanho da coluna. */
const corte = (v, n) => (v === null || v === undefined || v === '' ? undefined : String(v).slice(0, n));

/** As colunas que só a API do BB preenche (o OFX não traz), com o tamanho de cada uma. */
const CAMPOS_SO_DA_API = [
  ['contrapartida_documento', 14], ['contrapartida_tipo', 2], ['codigo_historico', 10], ['codigo_sub_historico', 10], ['sistema_pagamento', 20], ['tipo_banco', 20]
];

/**
 * Grava o que `analisar` separou: a evidência (o OFX ou a resposta da API),
 * a importação e os lançamentos novos. Bloqueio para aqui. `origem` 'ofx' |
 * 'api'.
 */
async function gravar(api, p, { origem = 'ofx', usuarioId = null, nomeImportacao = null, evidencia = null }) {
  if (p.bloqueios.length) throw c.erro(p.bloqueios[0], 422, { bloqueios: p.bloqueios });
  // O original (OFX ou o JSON da API), como evidência oficial dos meses que ele cobre.
  let arquivoId = null;
  if (evidencia?.base64) {
    try {
      const r = await arquivos.salvar(api, {
        nome: evidencia.nome, tipo: evidencia.tipo, base64: evidencia.base64, categoria: 'extrato', origem: 'oficial',
        competencia: (p.fim || p.inicio || '').slice(0, 7) || null, descricao: `Extrato ${p.conta.nome}${origem === 'api' ? ' (API do BB)' : ''}`,
        vinculos: p.meses.map(m => ({ alvo_tipo: 'competencia', alvo_id: m })), usuarioId, registrarEvento: false
      });
      arquivoId = r.arquivo?.id ?? null;
    } catch (e) {
      if (e?.extra?.sql_pendente) throw e;
      // O arquivo não é o essencial: sem ele, a importação segue (e avisa).
      p.avisos.push(`${evidencia.rotulo || 'O arquivo'} não foi guardado como evidência: ${e.message}`);
    }
  }
  const importacao = await b.inserir(api, 'extrato_importacoes', {
    conta_id: Number(p.conta.id), origem, status: 'importando', periodo_inicio: p.inicio, periodo_fim: p.fim,
    saldo_final: p.extrato.saldo?.valor ?? null, saldo_final_data: p.extrato.saldo?.data ?? null, arquivo_id: arquivoId,
    nome_arquivo: arquivos.nomeDeArquivo(nomeImportacao || (origem === 'api' ? 'API de Extratos do BB' : 'extrato.ofx')), linhas_lidas: p.linhas.length, criado_por: usuarioId, criado_em: c.agora()
  });
  let novos = 0;
  let repetidos = p.linhas.length - p.novos.length;
  for (const l of p.novos) {
    try {
      // Os campos só da API vão quando vieram (o `undefined` fica de fora do INSERT).
      await b.inserir(api, 'movimentos_bancarios', {
        conta_id: Number(p.conta.id), importacao_id: Number(importacao.id), data: l.data, competencia: l.competencia, valor: l.valor, tipo: l.tipo,
        descricao: l.descricao ? l.descricao.slice(0, 2000) : null, documento: l.documento ? l.documento.slice(0, 60) : null,
        identificador: l.identificador ? l.identificador.slice(0, 120) : null, tipo_banco: l.tipo_banco ? l.tipo_banco.slice(0, 20) : null,
        contrapartida_documento: corte(l.contrapartida_documento, 14), contrapartida_tipo: corte(l.contrapartida_tipo, 2),
        codigo_historico: corte(l.codigo_historico, 10), codigo_sub_historico: corte(l.codigo_sub_historico, 10), sistema_pagamento: corte(l.sistema_pagamento, 20),
        hash: l.hash, estado_conciliacao: 'pendente', criado_em: c.agora()
      });
      novos++;
    } catch (e) {
      // Outra máquina importou a mesma linha no meio do caminho (UNIQUE conta + hash).
      if (c.ehDuplicado(e) && !e.extra?.sql_pendente) repetidos++;
      else throw e;
    }
  }
  // A linha que já estava (do OFX) ganha o CPF/CNPJ da contrapartida que a API trouxe (a conciliação usa).
  let completados = 0;
  for (const e of p.enriquecer || []) {
    try {
      await b.atualizar(api, 'movimentos_bancarios', e.id, e.campos);
      completados++;
    } catch (_) { /* completar é ajuda: a importação segue */ }
  }
  await b.atualizar(api, 'extrato_importacoes', importacao.id, { status: 'completa', novos, repetidos });
  await eventos.registrar(api, {
    tipo: 'extrato_importado', competencia: (p.fim || p.inicio || '').slice(0, 7) || null, usuarioId,
    descricao: `Extrato ${p.conta.nome}${origem === 'api' ? ' (API do BB)' : ''} de ${c.impressa(p.inicio)} a ${c.impressa(p.fim)}: ${c.plural(novos, 'lançamento novo', 'lançamentos novos')}${repetidos ? `, ${c.plural(repetidos, 'já importado', 'já importados')}` : ''}`
      + `${completados ? ` (${c.plural(completados, 'completado', 'completados')} com o CPF/CNPJ da API)` : ''}`,
    dados: { importacao_id: importacao.id, conta_id: p.conta.id, novos, repetidos, completados, origem }
  });
  // Os meses com lançamento novo: a conciliação automática roda neles (fase A).
  const meses = [...new Set(p.novos.map(l => l.competencia))].sort();
  // Linha completada também é chance de conciliar (o CPF/CNPJ é chave do automático).
  const comCompletadas = [...new Set([...meses, ...(p.enriquecer || []).map(e => e.competencia)])].sort();
  return { importacao_id: importacao.id, novos, repetidos, completados, periodo: { inicio: p.inicio, fim: p.fim }, meses: comCompletadas, avisos: p.avisos };
}

async function desfazer(api, importacaoId, { motivo, usuarioId = null }) {
  const m = c.texto(motivo, 500);
  if (m.length < 5) throw c.erro('Diga por que a importação é desfeita (ao menos 5 letras).');
  const imp = (await b.ler(api, 'extrato_importacoes', { id: Number(importacaoId) }))[0] || null;
  if (!imp) throw c.erro('Importação não encontrada.', 404);
  if (imp.status === 'desfeita') throw c.erro('Esta importação já foi desfeita.', 409);
  // Uma importação posterior que cobre o mesmo período contou como "já
  // importadas" as linhas desta: desfazer esta primeiro deixaria o período
  // coberto sem os lançamentos. Então sai primeiro a mais nova.
  const daConta = await b.ler(api, 'extrato_importacoes', { conta_id: Number(imp.conta_id) });
  const posterior = daConta.filter(viva)
    .filter(i => Number(i.id) > Number(imp.id) && c.dia(i.periodo_inicio) <= c.dia(imp.periodo_fim) && c.dia(i.periodo_fim) >= c.dia(imp.periodo_inicio))
    .sort((x, y) => Number(y.id) - Number(x.id))[0];
  if (posterior) {
    throw c.erro(`Há uma importação mais nova no mesmo período (${c.impressa(posterior.periodo_inicio)} a ${c.impressa(posterior.periodo_fim)}): desfaça aquela antes.`, 409);
  }
  const movimentos = await b.ler(api, 'movimentos_bancarios', { importacao_id: Number(imp.id) });
  const conciliados = movimentos.filter(x => x.estado_conciliacao && x.estado_conciliacao !== 'pendente');
  if (conciliados.length) throw c.erro(`${c.plural(conciliados.length, 'lançamento desta importação já está conciliado ou ignorado', 'lançamentos desta importação já estão conciliados ou ignorados')}: desfaça isso na Conciliação antes.`, 409);
  for (const comp of [...new Set(movimentos.map(x => x.competencia))]) await b.garantirAberta(api, comp, 'desfazer a importação do extrato');
  for (const x of movimentos) await b.excluir(api, 'movimentos_bancarios', x.id);
  await b.atualizar(api, 'extrato_importacoes', imp.id, { status: 'desfeita', desfeita_em: c.agora(), desfeita_por: usuarioId, motivo_desfazer: m });
  // O OFX desfeito deixa de ser evidência (a não ser que outra importação viva use o mesmo arquivo).
  let arquivoRetirado = false;
  if (imp.arquivo_id && !daConta.some(i => viva(i) && Number(i.id) !== Number(imp.id) && String(i.arquivo_id) === String(imp.arquivo_id))) {
    const arquivo = (await b.ler(api, 'contabil_arquivos', { id: Number(imp.arquivo_id) }))[0] || null;
    if (arquivo && !arquivo.excluido_em) {
      await b.atualizar(api, 'contabil_arquivos', arquivo.id, { excluido_em: c.agora(), excluido_por: usuarioId, motivo_exclusao: `Importação do extrato desfeita: ${m}`.slice(0, 500) });
      arquivoRetirado = true;
    }
  }
  await eventos.registrar(api, {
    tipo: 'extrato_desfeito', competencia: String(c.dia(imp.periodo_fim) || '').slice(0, 7) || null, usuarioId,
    descricao: `Importação do extrato de ${c.impressa(imp.periodo_inicio)} a ${c.impressa(imp.periodo_fim)} desfeita (${c.plural(movimentos.length, 'lançamento retirado', 'lançamentos retirados')}${arquivoRetirado ? '; o OFX saiu das evidências' : ''}): ${m}`,
    dados: { importacao_id: imp.id }
  });
  return { id: imp.id, desfeita: true, retirados: movimentos.length, arquivo_retirado: arquivoRetirado };
}

// ------------------------------------------------------------------ movimentos

function movimentoPublico(x) {
  return {
    id: x.id, data: c.dia(x.data), valor: c.centavos(x.valor), tipo: x.tipo, descricao: x.descricao || null, documento: x.documento || null,
    identificador: x.identificador || null, tipo_banco: x.tipo_banco || null, contrapartida_documento: b.documentoFormatado(x.contrapartida_documento),
    estado_conciliacao: x.estado_conciliacao || 'pendente', importacao_id: x.importacao_id ?? null
  };
}

function importacaoPublica(i, nomes = new Map()) {
  return {
    id: i.id, origem: i.origem, origem_rotulo: ORIGENS[i.origem] || i.origem, status: i.status,
    periodo_inicio: c.dia(i.periodo_inicio), periodo_fim: c.dia(i.periodo_fim),
    saldo_final: i.saldo_final === null || i.saldo_final === undefined ? null : c.centavos(i.saldo_final), saldo_final_data: c.dia(i.saldo_final_data),
    arquivo_id: i.arquivo_id ?? null, nome_arquivo: i.nome_arquivo || null, linhas_lidas: Number(i.linhas_lidas) || 0,
    novos: Number(i.novos) || 0, repetidos: Number(i.repetidos) || 0, criado_em: b.instanteBR(i.criado_em), criado_por: nomes.get(String(i.criado_por)) || null,
    desfeita_em: b.instanteBR(i.desfeita_em), motivo_desfazer: i.motivo_desfazer || null
  };
}

/** O saldo que o banco informou mais perto do fim do mês (dentro dele). Pura. */
function saldoDoBanco(importacoes, competencia) {
  const fim = b.ultimoDia(competencia);
  const candidatos = c.lista(importacoes).filter(viva)
    .filter(i => i.saldo_final !== null && i.saldo_final !== undefined && c.dia(i.saldo_final_data) && c.dia(i.saldo_final_data) >= `${competencia}-01` && c.dia(i.saldo_final_data) <= fim)
    .sort((x, y) => String(c.dia(y.saldo_final_data)).localeCompare(String(c.dia(x.saldo_final_data))) || Number(y.id) - Number(x.id));
  return candidatos[0] ? { valor: c.centavos(candidatos[0].saldo_final), data: c.dia(candidatos[0].saldo_final_data) } : null;
}

/**
 * O saldo no FIM de um dia, partindo de um saldo conhecido no fim de outro
 * (o digitado na conta — 19b do dono — ou o que o banco informou): soma o
 * que entrou e saiu entre os dois dias. `movimentos` = os da conta. Pura.
 */
function saldoNoFimDoDia(conhecido, movimentos, dia) {
  if (!conhecido?.data || !Number.isFinite(Number(conhecido.valor)) || !dia) return null;
  const base = c.dia(conhecido.data);
  const entre = (de, ate) => c.lista(movimentos).filter(m => m && c.dia(m.data) > de && c.dia(m.data) <= ate).reduce((s, m) => s + Number(m.valor || 0), 0);
  return c.centavos(dia >= base ? Number(conhecido.valor) + entre(base, dia) : Number(conhecido.valor) - entre(dia, base));
}

/** O saldo de abertura digitado na conta (19b: no fim do dia da data), ou null. Pura. */
function saldoDigitado(conta) {
  if (!conta || conta.saldo_inicial === null || conta.saldo_inicial === undefined || conta.saldo_inicial === '' || !c.dia(conta.saldo_inicial_data)) return null;
  return { valor: c.centavos(conta.saldo_inicial), data: c.dia(conta.saldo_inicial_data) };
}

/**
 * O saldo do livro (a partir do digitado) × o que o banco informou no mesmo
 * dia: { data, banco, livro, diferenca }, ou null sem um dos dois. Pura.
 */
function conferirSaldo(conta, movimentos, saldoBanco) {
  const digitado = saldoDigitado(conta);
  if (!digitado || !saldoBanco?.data || !Number.isFinite(Number(saldoBanco.valor))) return null;
  const livro = saldoNoFimDoDia(digitado, movimentos, saldoBanco.data);
  return { data: saldoBanco.data, banco: c.centavos(saldoBanco.valor), livro, diferenca: c.centavos(livro - Number(saldoBanco.valor)) };
}

function totaisDe(movimentos) {
  const entradas = movimentos.filter(x => Number(x.valor) > 0);
  const saidas = movimentos.filter(x => Number(x.valor) < 0);
  const soma = l => c.centavos(l.reduce((s, x) => s + Number(x.valor), 0));
  return {
    quantidade: movimentos.length,
    entradas: { quantidade: entradas.length, total: soma(entradas) },
    saidas: { quantidade: saidas.length, total: soma(saidas) },
    resultado: soma(movimentos)
  };
}

async function movimentos(api, { contaId = null, competencia, hoje }) {
  const comp = c.competenciaValida(competencia) ? String(competencia) : c.competenciaDe(hoje);
  const { contas } = await listarContas(api);
  const conta = contas.find(x => String(x.id) === String(contaId)) || contas.find(x => x.ativa && x.tipo === 'corrente') || contas[0] || null;
  if (!conta) return { competencia: comp, conta: null, contas, linhas: [], totais: totaisDe([]), saldo_banco: null, importacoes: [], cobertura: null };
  const [lista, importacoes] = await Promise.all([
    b.ler(api, 'movimentos_bancarios', { conta_id: Number(conta.id), competencia: comp }),
    b.ler(api, 'extrato_importacoes', { conta_id: Number(conta.id) })
  ]);
  const nomes = await b.nomesDeUsuarios(api, importacoes.map(i => i.criado_por));
  const doMes = importacoes.filter(i => c.dia(i.periodo_inicio) <= b.ultimoDia(comp) && c.dia(i.periodo_fim) >= `${comp}-01`);
  const ordenadas = lista.sort((x, y) => String(c.dia(x.data)).localeCompare(String(c.dia(y.data))) || Number(x.id) - Number(y.id));
  return {
    competencia: comp, rotulo: c.rotuloCompetencia(comp), conta, contas,
    linhas: ordenadas.map(movimentoPublico),
    totais: totaisDe(ordenadas),
    saldo_banco: saldoDoBanco(importacoes, comp),
    cobertura: cobertura(importacoes, comp, { hoje }),
    importacoes: doMes.sort((x, y) => Number(y.id) - Number(x.id)).map(i => importacaoPublica(i, nomes))
  };
}

module.exports = {
  TIPOS_CONTA, ORIGENS, BANCOS, rotuloDaConta, contaPublica, validarConta, listarContas, salvarConta,
  cobertura, faixaImpressa, extratoDaConta, preparar, analisar, gravar, lerConta, previa, importar, desfazer, movimentoPublico, importacaoPublica, saldoDoBanco,
  saldoNoFimDoDia, saldoDigitado, conferirSaldo, totaisDe, movimentos
};
