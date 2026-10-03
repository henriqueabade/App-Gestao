/**
 * Fase E (02/10/2026) — as pessoas que recebem comissão (CMS), royalty e
 * produção no Financeiro, e a nota (NFS-e) delas. Respostas do dono:
 *
 *   5.1 a  cada NOME que recebe (é só um nome nas regras e nos fechamentos do
 *          Financeiro) fica ligado a um cadastro em Contatos, com o CPF/CNPJ —
 *          é por ele que a nota que chega é reconhecida;
 *   5.2 a  a nota que cobre CMS e Royalty juntos é repartida sozinha quando o
 *          valor bate com o total da pessoa no fechamento; não batendo (ou
 *          batendo com mais de um), vira pendência para você escolher;
 *   5.3 b  a nota documenta a parte da pessoa no fechamento (some o "sem nota",
 *          não cria conta a pagar nem vira conta no extrato) e, se ela ainda
 *          não foi paga, fica "pronta para pagar" e nasce UMA tarefa de pagar
 *          (para quem fechou a competência, no dia marcado); a tarefa conclui
 *          quando o pagamento é confirmado no Financeiro.
 *
 * Uma "parte" é o que a pessoa tem a receber num fechamento: cada linha do
 * resumo congelado das comissões (CMS ou Royalty) ou a produção inteira (paga
 * de uma vez). O que já está documentado e o que já foi pago saem das notas
 * ligadas e dos pagamentos — nada é recalculado.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');

const PESSOAS = 'contabil_pessoas';
const NOTAS = 'contabil_notas_fechamento';
const TIPOS = { comissao: 'Comissões', producao: 'Produção' };
const TIPOS_COMISSAO = { cms: 'CMS', royalty: 'Royalty' };
const CRITERIOS = { automatico: 'reconhecida pelo CPF/CNPJ e pelo valor', escolhido: 'escolhida à mão' };
/** Fechamentos de até 6 meses antes da emissão da nota (a nota vem depois do fechamento). */
const MESES_PARA_TRAS = 6;
const DESENHISTA_DA_PECA = 'desenhista da peca';

const chaveDoNome = n => String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const cent = v => Math.round(Math.abs(Number(v) || 0) * 100);
const docCheio = v => (/^\d{11}$|^\d{14}$/.test(b.digitos(v)) ? b.digitos(v) : null);
const docDoContato = ct => docCheio(ct?.cnpj) || docCheio(ct?.cpf) || null;

/** O rótulo de uma parte: "CMS de setembro/2026 — Marcia" / "Produção de setembro/2026". Pura. */
function rotuloDaParte(p) {
  const oQue = p.tipo === 'comissao' ? (p.tipos_comissao || []).map(t => TIPOS_COMISSAO[t] || t).join(' + ') || TIPOS.comissao : TIPOS.producao;
  return `${oQue} de ${c.rotuloCompetencia(p.competencia)}${p.beneficiario ? ` — ${p.beneficiario}` : ''}`;
}

/**
 * As linhas que cada pessoa tem a receber num fechamento: as do resumo das
 * comissões (por tipo) ou a produção inteira (sem pessoa). Pura.
 */
function linhasDoFechamento(f) {
  if (!f || f.status !== 'fechado') return [];
  const comp = String(f.competencia || '').trim();
  if (f.tipo === 'comissao') {
    return (c.jsonDe(f.por_setor, []) || []).filter(l => l && l.beneficiario && Number(l.valor) > 0).map(l => ({
      fechamento_id: Number(f.id), tipo: 'comissao', competencia: comp, beneficiario: String(l.beneficiario).trim(), chave: chaveDoNome(l.beneficiario),
      tipo_comissao: TIPOS_COMISSAO[l.tipo] ? l.tipo : null, valor: c.centavos(l.valor)
    }));
  }
  if (f.tipo === 'producao' && Number(f.total) > 0) {
    return [{ fechamento_id: Number(f.id), tipo: 'producao', competencia: comp, beneficiario: null, chave: null, tipo_comissao: null, valor: c.centavos(f.total) }];
  }
  return [];
}

/** O pagamento cobre a linha? (sem pessoa e sem tipo, cobre todos — as regras do Financeiro). Pura. */
const cobre = (p, l) => String(p.fechamento_id) === String(l.fechamento_id)
  && (l.tipo === 'producao' || ((!p.tipo_comissao || p.tipo_comissao === l.tipo_comissao) && (!p.beneficiario || chaveDoNome(p.beneficiario) === l.chave)));

/** A linha já tem nota? (as notas ligadas a ela, valendo). Pura. */
const notasDaLinha = (l, links) => c.lista(links).filter(n => n && !n.desfeito_em && String(n.fechamento_id) === String(l.fechamento_id)
  && (l.tipo === 'producao' || (chaveDoNome(n.beneficiario) === l.chave && String(n.tipo_comissao || '') === String(l.tipo_comissao || ''))));

/**
 * As opções para uma nota de quem tem `chaves` (os nomes ligados ao CPF/CNPJ
 * do emitente): cada linha ainda sem nota de cada fechamento recente e, para
 * a pessoa com mais de uma linha no mesmo fechamento, a soma delas (5.2 a);
 * a produção inteira também (paga de uma vez), mas só para quem não recebe
 * comissão (`producao`). `automatico` = a única opção com o valor exato da
 * nota. Pura.
 */
function opcoesDaNota(doc, { chaves = [], fechamentos = [], links = [], valores = null, producao = null } = {}) {
  const emissao = c.dia(doc.data_emissao);
  if (!emissao) return { opcoes: [], automatico: null };
  const mes = emissao.slice(0, 7);
  const desde = c.somarMeses(mes, -MESES_PARA_TRAS);
  const alvo = new Set(valores || [cent(doc.valor_total)]);
  const minhas = new Set(chaves.map(chaveDoNome));
  // Quem recebe comissão não é a produção (a produção é paga de uma vez a quem faz).
  const daProducao = producao ?? !fechamentos.some(f => linhasDoFechamento(f).some(l => l.tipo === 'comissao' && minhas.has(l.chave)));
  const opcoes = [];
  for (const f of fechamentos) {
    const comp = String(f.competencia || '').trim();
    if (comp > mes || comp < desde) continue;
    const livres = linhasDoFechamento(f).filter(l => !notasDaLinha(l, links).length);
    const porPessoa = new Map();
    for (const l of livres.filter(x => x.tipo === 'comissao' && minhas.has(x.chave))) porPessoa.set(l.chave, [...(porPessoa.get(l.chave) || []), l]);
    for (const linhas of porPessoa.values()) {
      const grupos = linhas.length > 1 ? [...linhas.map(l => [l]), linhas] : [linhas];
      for (const g of grupos) {
        const valor = c.centavos(g.reduce((s, l) => s + l.valor, 0));
        opcoes.push({
          chave: `${f.id}|${g[0].chave}|${g.map(l => l.tipo_comissao || '').join('+')}`, fechamento_id: Number(f.id), tipo: 'comissao', competencia: comp,
          beneficiario: g[0].beneficiario, tipos_comissao: g.map(l => l.tipo_comissao).filter(Boolean), linhas: g, valor, pagar_ate: c.dia(f.pagar_ate), exato: alvo.has(cent(valor))
        });
      }
    }
    for (const l of livres.filter(x => x.tipo === 'producao' && daProducao)) {
      opcoes.push({ chave: `${f.id}|producao|`, fechamento_id: Number(f.id), tipo: 'producao', competencia: comp, beneficiario: null, tipos_comissao: [], linhas: [l], valor: l.valor, pagar_ate: c.dia(f.pagar_ate), exato: alvo.has(cent(l.valor)) });
    }
  }
  opcoes.sort((x, y) => Number(y.exato) - Number(x.exato) || y.competencia.localeCompare(x.competencia) || x.chave.localeCompare(y.chave));
  const exatas = opcoes.filter(o => o.exato);
  return { opcoes: opcoes.map(o => ({ ...o, rotulo: rotuloDaParte(o) })), automatico: exatas.length === 1 ? { ...exatas[0], rotulo: rotuloDaParte(exatas[0]) } : null };
}

/** Quanto de cada pagamento de fechamento as notas ligadas documentam (para o "sem NFS-e" do painel). Pura. */
function coberturaDosPagamentos({ links = [], pagamentos = [] }) {
  const saida = new Map();
  const vivos = c.lista(links).filter(n => n && !n.desfeito_em);
  for (const p of pagamentos) {
    const doc = vivos.filter(n => cobre(p, { fechamento_id: n.fechamento_id, tipo: n.tipo, tipo_comissao: n.tipo_comissao || null, chave: chaveDoNome(n.beneficiario) }));
    if (doc.length) saida.set(String(p.id), c.centavos(doc.reduce((s, n) => s + Number(n.valor || 0), 0)));
  }
  return saida;
}

/** Os documentos ligados a um fechamento (pagos pelo Financeiro: sem conta a pagar, sem obrigação no extrato). Pura. */
const documentosNoFechamento = links => new Set(c.lista(links).filter(n => n && !n.desfeito_em).map(n => String(n.documento_id)));

/**
 * As pendências do mês (fonte dos fechamentos), avisos:
 *   - quem recebe nos fechamentos do mês sem o CPF/CNPJ (sem o contato);
 *   - a nota de quem recebe que não achou a parte dela (para escolher).
 * Pura.
 */
function pendencias({ competencia, dados }) {
  if (!dados) return [];
  const saida = [];
  const filtro = { acao: 'pessoas' };
  const doMes = dados.fechamentos.filter(f => f.status === 'fechado' && String(f.competencia || '').trim() === competencia && f.tipo === 'comissao');
  const nomes = new Map();
  for (const f of doMes) for (const l of linhasDoFechamento(f)) if (!nomes.has(l.chave)) nomes.set(l.chave, l.beneficiario);
  const semCadastro = [...nomes.entries()].filter(([k]) => !docDoContato(dados.contatoDaChave.get(k))).map(([, n]) => n);
  if (semCadastro.length) {
    saida.push({
      nivel: 'aviso', chave: 'pessoas_sem_cadastro', titulo: `${c.plural(semCadastro.length, 'pessoa que recebe', 'pessoas que recebem')} sem o CPF/CNPJ`,
      descricao: `${semCadastro.slice(0, 4).join(', ')}${semCadastro.length > 4 ? '…' : ''} · ligue cada nome ao cadastro em Contatos: é por ele que a nota da pessoa é reconhecida`,
      data: b.ultimoDia(competencia), acao: 'Ligar', filtro
    });
  }
  for (const d of dados.notasParaConferir.filter(x => String(c.dia(x.data_emissao) || '').slice(0, 7) === competencia)) {
    saida.push({
      nivel: 'aviso', chave: `nota_pessoa_conferir_${d.id}`, titulo: `A nota de ${d.pessoa} (${c.reais(d.valor_total)}) não achou a parte dela no fechamento`,
      descricao: d.opcoes ? `${c.plural(d.opcoes, 'parte possível', 'partes possíveis')}: escolha qual a nota documenta` : 'Nenhuma parte em aberto com este valor: confira o valor da nota ou o fechamento',
      data: c.dia(d.data_emissao), acao: 'Escolher', filtro
    });
  }
  return saida;
}

// ------------------------------------------------------------------ leitura

const lerSePuder = (api, tabela, query) => b.lerOpcional(api, tabela, query).then(x => x || []).catch(() => []);

/** Os nomes que recebem no Financeiro (de onde vêm). */
async function nomesDoFinanceiro(api, fechamentos) {
  const [regras, clientes, produtos, colaboradores] = await Promise.all([
    lerSePuder(api, 'comissao_regras'),
    api.get('/api/clientes', { query: { select: 'id,dono_cliente' } }).then(c.lista).catch(() => []),
    api.get('/api/produtos', { query: { select: 'id,desenhado_por' } }).then(c.lista).catch(() => []),
    lerSePuder(api, 'producao_colaboradores')
  ]);
  const nomes = new Map();
  const somar = (nome, fonte) => {
    const n = String(nome ?? '').trim();
    const k = chaveDoNome(n);
    if (!k || k === DESENHISTA_DA_PECA) return;
    const atual = nomes.get(k) || { nome: n, fontes: new Set() };
    atual.fontes.add(fonte);
    nomes.set(k, atual);
  };
  for (const f of fechamentos) for (const l of linhasDoFechamento(f)) if (l.beneficiario) somar(l.beneficiario, TIPOS_COMISSAO[l.tipo_comissao] || 'Comissões');
  for (const r of regras.filter(x => x && x.beneficiario)) somar(r.beneficiario, TIPOS_COMISSAO[r.tipo] || 'Comissões');
  for (const x of clientes) if (x?.dono_cliente) somar(x.dono_cliente, 'CMS');
  for (const p of produtos) if (p?.desenhado_por) somar(p.desenhado_por, 'Royalty');
  for (const x of colaboradores.filter(y => y && y.nome && !(y.ativo === false || y.ativo === 'false'))) somar(x.nome, 'Produção');
  return nomes;
}

/** Tudo numa leitura (null sem o SQL da fase E). */
async function lerTudo(api) {
  const pessoas = await b.lerOpcional(api, PESSOAS);
  if (pessoas === null) return null;
  const [links, fechamentos, pagamentos, documentos, titulos] = await Promise.all([
    lerSePuder(api, NOTAS), lerSePuder(api, 'financeiro_fechamentos'), lerSePuder(api, 'financeiro_pagamentos'),
    lerSePuder(api, 'documentos_recebidos'), lerSePuder(api, 'titulos_pagar')
  ]);
  const idsContatos = [...new Set(pessoas.filter(p => p && p.contato_id).map(p => String(p.contato_id)))];
  const contatos = new Map((await Promise.all(idsContatos.map(id => api.get(`/api/contatos/${id}`).catch(() => null)))).filter(x => x && !x.error && x.id !== undefined).map(x => [String(x.id), x]));
  const contatoDaChave = new Map(pessoas.filter(Boolean).map(p => [p.nome_chave || chaveDoNome(p.nome), p.contato_id ? contatos.get(String(p.contato_id)) || null : null]));
  // CPF/CNPJ → os nomes ligados a ele.
  const nomesDoDocumento = new Map();
  for (const p of pessoas.filter(Boolean)) {
    const doc = docDoContato(contatos.get(String(p.contato_id)));
    if (doc) nomesDoDocumento.set(doc, [...(nomesDoDocumento.get(doc) || []), p.nome]);
  }
  const fechados = fechamentos.filter(f => f && f.status === 'fechado');
  const vivos = links.filter(n => n && !n.desfeito_em);
  const comConta = new Set(titulos.filter(t => t && t.status !== 'cancelado' && t.documento_recebido_id !== null && t.documento_recebido_id !== undefined).map(t => String(t.documento_recebido_id)));
  const ligados = documentosNoFechamento(vivos);
  // As notas de quem recebe que ainda não acharam a parte (sem ligação, sem pagamento ligado, sem conta, "sem pagamento" não).
  const notasParaConferir = [];
  for (const d of documentos.filter(x => x && !x.excluido_em && ['nfse', 'outro'].includes(String(x.tipo)))) {
    const quem = nomesDoDocumento.get(b.digitos(d.emitente_documento));
    if (!quem || ligados.has(String(d.id)) || d.financeiro_pagamento_id || comConta.has(String(d.id)) || d.sem_pagamento === true || d.sem_pagamento === 'true') continue;
    const r = opcoesDaNota(d, { chaves: quem, fechamentos: fechados, links: vivos });
    notasParaConferir.push({ ...d, pessoa: quem[0], opcoes: r.opcoes.length, automatico: Boolean(r.automatico) });
  }
  return { pessoas: pessoas.filter(Boolean), contatos, contatoDaChave, nomesDoDocumento, links: vivos, todosLinks: links, fechamentos: fechados, pagamentos: pagamentos.filter(Boolean), documentos, notasParaConferir };
}

// ------------------------------------------------------------------ gravação

const semSql = () => c.erro(b.SQL_FALTANDO_FASE_E, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_E });

/** Liga um nome ao contato (que precisa ter o CPF/CNPJ inteiro). Sem contato = desliga. */
async function ligarContato(api, { nome, contatoId = null, usuarioId = null }) {
  if ((await b.lerOpcional(api, PESSOAS)) === null) throw semSql();
  const n = c.texto(nome, 120);
  const k = chaveDoNome(n);
  if (!k) throw c.erro('Diga o nome (como está no Financeiro).');
  let contato = null;
  if (contatoId !== null && contatoId !== undefined && contatoId !== '') {
    contato = await api.get(`/api/contatos/${Number(contatoId)}`).catch(() => null);
    if (!contato || contato.error || contato.id === undefined) throw c.erro('Contato não encontrado.', 404);
    if (!docDoContato(contato)) throw c.erro(`${contato.nome || 'O contato'} não tem o CPF/CNPJ completo no cadastro: complete em Contatos antes de ligar.`, 422);
  }
  const atual = ((await b.lerOpcional(api, PESSOAS, { nome_chave: k })) || [])[0] || null;
  if (atual) await b.atualizar(api, PESSOAS, atual.id, { contato_id: contato ? Number(contato.id) : null, nome: n, atualizado_em: c.agora(), atualizado_por: usuarioId });
  else await b.inserir(api, PESSOAS, { nome: n, nome_chave: k, contato_id: contato ? Number(contato.id) : null, criado_em: c.agora(), criado_por: usuarioId, atualizado_em: c.agora(), atualizado_por: usuarioId });
  await eventos.registrar(api, {
    tipo: 'pessoa_ligada', usuarioId,
    descricao: contato ? `${n} (quem recebe no Financeiro) ligado a ${contato.nome} (${b.documentoFormatado(docDoContato(contato))}) em Contatos` : `${n} (quem recebe no Financeiro) desligado do cadastro em Contatos`,
    dados: { nome: n, contato_id: contato?.id ?? null }
  });
  return { nome: n, contato_id: contato ? Number(contato.id) : null };
}

/** Grava a ligação da nota com a opção: as linhas, o pagamento (se já houve) ou a tarefa de pagar. */
async function gravarLigacao(api, doc, opcao, { criterio, usuarioId = null, dados }) {
  const f = dados.fechamentos.find(x => String(x.id) === String(opcao.fechamento_id));
  const nome = opcao.beneficiario || dados.nomesDoDocumento.get(b.digitos(doc.emitente_documento))?.[0] || doc.emitente_nome || 'quem recebe';
  const linhas = [];
  for (const l of opcao.linhas) {
    linhas.push(await b.inserir(api, NOTAS, {
      documento_id: Number(doc.id), fechamento_id: Number(opcao.fechamento_id), tipo: opcao.tipo, competencia: opcao.competencia,
      beneficiario: String(l.beneficiario || nome).slice(0, 120), tipo_comissao: l.tipo_comissao, valor: l.valor, criterio, criado_em: c.agora(), criado_por: usuarioId
    }));
  }
  // Já pago: a nota documenta o pagamento (um só pagamento cobrindo tudo → o vínculo antigo também, para as telas de antes).
  const cobrem = dados.pagamentos.filter(p => opcao.linhas.every(l => cobre(p, l)));
  const pagos = opcao.linhas.every(l => dados.pagamentos.some(p => cobre(p, l)));
  if (cobrem.length === 1 && !doc.financeiro_pagamento_id) await b.atualizar(api, 'documentos_recebidos', doc.id, { financeiro_pagamento_id: Number(cobrem[0].id) }).catch(() => null);
  let tarefa = null;
  if (!pagos && f) {
    // 5.3 b: pronta para pagar — UMA tarefa de pagar (para quem fechou), no dia marcado.
    tarefa = await require('../../tarefasServico').criarTarefaAutomatica(api, 'nota_de_fechamento', {
      refId: `${f.id}-${chaveDoNome(nome).replace(/[^a-z0-9]+/g, '-')}`.slice(0, 80), responsavelId: f.fechado_por || usuarioId, usuarioId,
      valores: { beneficiario: nome, fechamento: rotuloDaParte({ ...opcao, beneficiario: null }), valor: c.reais(opcao.valor) }, base: c.dia(f.pagar_ate),
      descricao: `A nota de ${nome} (${c.reais(doc.valor_total)}) chegou e documenta ${rotuloDaParte(opcao)} (${c.reais(opcao.valor)}): pode pagar. `
        + 'Confirme em Financeiro › Próximo pagamento (por beneficiário); a tarefa conclui sozinha quando o pagamento for confirmado.',
      acao: { acao_chave: f.tipo === 'comissao' ? 'financeiro.pagar_comissoes' : 'financeiro.pagar_producao', acao_registro: String(f.competencia).trim(), acao_rotulo: `${TIPOS[f.tipo]} de ${c.rotuloCompetencia(String(f.competencia).trim())}` }
    }).catch(() => null);
    if (tarefa?.id) for (const l of linhas) await b.atualizar(api, NOTAS, l.id, { tarefa_id: Number(tarefa.id) }).catch(() => null);
  }
  await eventos.registrar(api, {
    tipo: 'nota_fechamento_ligada', usuarioId, competencia: opcao.competencia,
    descricao: `Nota ${doc.numero ? `nº ${doc.numero} ` : ''}de ${nome} (${c.reais(doc.valor_total)}) ligada a ${rotuloDaParte(opcao)} (${c.reais(opcao.valor)}) — ${CRITERIOS[criterio]}`
      + `${pagos ? ' · documenta o pagamento já feito' : ' · pronta para pagar'}${tarefa?.id ? ' · tarefa de pagar criada' : ''}`,
    dados: { documento_id: doc.id, fechamento_id: opcao.fechamento_id, linhas: linhas.map(l => l.id) }
  });
  return { rotulo: rotuloDaParte(opcao), valor: opcao.valor, pago: pagos, pronto_para_pagar: !pagos, tarefa_id: tarefa?.id ?? null };
}

/**
 * A nota que acabou de ser registrada (ou a que já estava): é de alguém que
 * recebe? Liga sozinha à única parte de mesmo valor. Devolve
 * `{ ligado, duvida }` (null = não é de quem recebe ou falta o SQL).
 */
async function ligarNotaSozinha(api, doc, { usuarioId = null, dados = null } = {}) {
  const d = dados || await lerTudo(api).catch(() => null);
  if (!d) return null;
  const quem = d.nomesDoDocumento.get(b.digitos(doc.emitente_documento));
  if (!quem) return null;
  if (d.links.some(n => String(n.documento_id) === String(doc.id))) return null;
  const valores = [cent(doc.valor_total), cent(Number(doc.valor_total) - Number(doc.valor_retencoes || 0) - (doc.iss_retido === true || doc.iss_retido === 'true' ? Number(doc.valor_iss || 0) : 0))];
  const r = opcoesDaNota(doc, { chaves: quem, fechamentos: d.fechamentos, links: d.links, valores });
  if (!r.automatico) return { ligado: null, duvida: true, pessoa: quem[0], opcoes: r.opcoes.length };
  const ligado = await gravarLigacao(api, doc, r.automatico, { criterio: 'automatico', usuarioId, dados: d });
  return { ligado, duvida: false, pessoa: quem[0] };
}

/** As opções de uma nota para escolher à mão (as partes em aberto da pessoa — ou de todos, sem o CPF/CNPJ ligado). */
async function opcoes(api, documentoId) {
  const dados = await lerTudo(api);
  if (!dados) throw semSql();
  const doc = dados.documentos.find(x => String(x.id) === String(documentoId) && !x.excluido_em);
  if (!doc) throw c.erro('Nota não encontrada.', 404);
  const quem = dados.nomesDoDocumento.get(b.digitos(doc.emitente_documento)) || null;
  const chaves = quem || [...new Set(dados.fechamentos.flatMap(linhasDoFechamento).map(l => l.beneficiario).filter(Boolean))];
  const r = opcoesDaNota(doc, { chaves, fechamentos: dados.fechamentos, links: dados.links, producao: quem ? null : true });
  return {
    documento: { id: Number(doc.id), numero: doc.numero || null, emitente: doc.emitente_nome || null, valor_total: c.centavos(doc.valor_total), data_emissao: c.dia(doc.data_emissao) },
    pessoa: quem?.[0] || null, opcoes: r.opcoes.map(o => ({ chave: o.chave, rotulo: o.rotulo, valor: o.valor, exato: o.exato, competencia: o.competencia, beneficiario: o.beneficiario }))
  };
}

/** Escolher à mão a parte que a nota documenta. */
async function escolher(api, documentoId, { opcao: chave, usuarioId = null }) {
  const dados = await lerTudo(api);
  if (!dados) throw semSql();
  const doc = dados.documentos.find(x => String(x.id) === String(documentoId) && !x.excluido_em);
  if (!doc) throw c.erro('Nota não encontrada.', 404);
  if (dados.links.some(n => String(n.documento_id) === String(doc.id))) throw c.erro('Esta nota já está ligada a um fechamento: desfaça antes.', 409);
  const quem = dados.nomesDoDocumento.get(b.digitos(doc.emitente_documento)) || null;
  const chaves = quem || [...new Set(dados.fechamentos.flatMap(linhasDoFechamento).map(l => l.beneficiario).filter(Boolean))];
  const opcao = opcoesDaNota(doc, { chaves, fechamentos: dados.fechamentos, links: dados.links, producao: quem ? null : true }).opcoes.find(o => o.chave === String(chave || ''));
  if (!opcao) throw c.erro('Escolha uma das partes em aberto.', 422);
  await b.garantirAberta(api, String(c.dia(doc.data_emissao) || '').slice(0, 7), 'ligar a nota ao fechamento');
  return gravarLigacao(api, doc, opcao, { criterio: 'escolhido', usuarioId, dados });
}

/** Desfaz a ligação da nota (todas as linhas dela). */
async function desfazer(api, documentoId, { motivo, usuarioId = null }) {
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro('Diga por que a nota sai do fechamento (ao menos 5 letras).');
  const dados = await lerTudo(api);
  if (!dados) throw semSql();
  const minhas = dados.links.filter(n => String(n.documento_id) === String(documentoId));
  if (!minhas.length) throw c.erro('Esta nota não está ligada a um fechamento.', 409);
  for (const n of minhas) await b.atualizar(api, NOTAS, n.id, { desfeito_em: c.agora(), desfeito_por: usuarioId, motivo_desfazer: texto });
  await eventos.registrar(api, {
    tipo: 'nota_fechamento_desfeita', usuarioId, competencia: minhas[0].competencia,
    descricao: `A nota (documento ${documentoId}) saiu de ${c.plural(minhas.length, 'parte', 'partes')} do fechamento de ${c.rotuloCompetencia(minhas[0].competencia)}: ${texto}`, dados: { documento_id: Number(documentoId) }
  });
  return { documento_id: Number(documentoId), desfeitas: minhas.length };
}

/** As notas de quem recebe registradas antes (ou antes do CPF/CNPJ ligado): liga as que têm uma parte só. */
async function conferir(api, { usuarioId = null } = {}) {
  const dados = await lerTudo(api);
  if (!dados) throw semSql();
  const saida = { ligadas: 0, duvidas: 0, falhas: [] };
  for (const d of dados.notasParaConferir) {
    try {
      const r = await ligarNotaSozinha(api, d, { usuarioId, dados });
      if (r?.ligado) {
        saida.ligadas++;
        Object.assign(dados, await lerTudo(api));
      } else if (r?.duvida) saida.duvidas++;
    } catch (e) {
      saida.falhas.push(`${d.pessoa}: ${e.message}`);
    }
  }
  return saida;
}

/**
 * Depois de um pagamento confirmado no Financeiro: as notas que agora
 * documentam um pagamento ganham o vínculo antigo e a tarefa de pagar
 * conclui. Nunca atrasa nem desfaz o pagamento (engole o próprio erro).
 */
async function aposPagamento(api, { fechamentoId, usuarioId = null }) {
  try {
    const dados = await lerTudo(api);
    if (!dados) return { concluidas: 0 };
    const minhas = dados.links.filter(n => String(n.fechamento_id) === String(fechamentoId));
    const porDoc = new Map();
    for (const n of minhas) porDoc.set(String(n.documento_id), [...(porDoc.get(String(n.documento_id)) || []), n]);
    let concluidas = 0;
    const tarefasServico = require('../../tarefasServico');
    for (const [docId, linhas] of porDoc) {
      const comoLinha = n => ({ fechamento_id: n.fechamento_id, tipo: n.tipo, tipo_comissao: n.tipo_comissao || null, chave: chaveDoNome(n.beneficiario) });
      const pagos = linhas.every(n => dados.pagamentos.some(p => cobre(p, comoLinha(n))));
      if (!pagos) continue;
      const doc = dados.documentos.find(x => String(x.id) === docId);
      const cobrem = dados.pagamentos.filter(p => linhas.every(n => cobre(p, comoLinha(n))));
      if (doc && !doc.financeiro_pagamento_id && cobrem.length === 1) await b.atualizar(api, 'documentos_recebidos', doc.id, { financeiro_pagamento_id: Number(cobrem[0].id) }).catch(() => null);
      for (const tarefaId of [...new Set(linhas.map(n => n.tarefa_id).filter(Boolean))]) {
        const t = await api.get(`/api/tarefas/${Number(tarefaId)}`).catch(() => null);
        if (!t || t.error || ['concluida', 'cancelada'].includes(t.status)) continue;
        await tarefasServico.concluirTarefa(api, t, { usuarioId, nota: 'Pagamento confirmado no Financeiro' });
        concluidas++;
      }
    }
    return { concluidas };
  } catch (e) {
    console.warn('[contabilidade] depois do pagamento, as notas de quem recebe não foram conferidas:', e?.message || e);
    return { concluidas: 0 };
  }
}

// ------------------------------------------------------------------ tela

async function listar(api) {
  const dados = await lerTudo(api);
  if (!dados) return { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_E, pessoas: [], notas_para_conferir: [] };
  const nomes = await nomesDoFinanceiro(api, dados.fechamentos);
  for (const p of dados.pessoas) if (!nomes.has(p.nome_chave)) nomes.set(p.nome_chave, { nome: p.nome, fontes: new Set() });
  const docs = new Map(dados.documentos.map(d => [String(d.id), d]));
  const pessoas = [...nomes.entries()].map(([k, x]) => {
    const ct = dados.contatoDaChave.get(k) || null;
    const minhas = dados.fechamentos.flatMap(linhasDoFechamento).filter(l => l.chave === k);
    const abertas = minhas.filter(l => !dados.pagamentos.some(p => cobre(p, l)) || !notasDaLinha(l, dados.links).length).map(l => {
      const notas = notasDaLinha(l, dados.links);
      const pago = dados.pagamentos.some(p => cobre(p, l));
      return {
        fechamento_id: l.fechamento_id, competencia: l.competencia, tipo_comissao: l.tipo_comissao, rotulo: rotuloDaParte({ ...l, tipos_comissao: [l.tipo_comissao] }), valor: l.valor, pago,
        nota: notas.length ? (() => { const d = docs.get(String(notas[0].documento_id)); return d ? { id: Number(d.id), numero: d.numero || null, valor_total: c.centavos(d.valor_total) } : null; })() : null,
        situacao: notas.length ? (pago ? 'documentado' : 'pronto_para_pagar') : (pago ? 'pago_sem_nota' : 'aguardando_nota')
      };
    });
    return {
      nome: x.nome, chave: k, fontes: [...x.fontes].sort(), contato: ct ? { id: Number(ct.id), nome: ct.nome || null, documento: b.documentoFormatado(docDoContato(ct)) || null, completo: Boolean(docDoContato(ct)) } : null,
      partes: abertas.sort((p, q) => q.competencia.localeCompare(p.competencia)).slice(0, 12)
    };
  }).sort((x, y) => Number(Boolean(x.contato?.completo)) - Number(Boolean(y.contato?.completo)) || x.nome.localeCompare(y.nome, 'pt-BR'));
  return {
    sql_pendente: false, pessoas,
    notas_para_conferir: dados.notasParaConferir.map(d => ({
      id: Number(d.id), numero: d.numero || null, pessoa: d.pessoa, emitente: d.emitente_nome || null, valor_total: c.centavos(d.valor_total), data_emissao: c.dia(d.data_emissao), opcoes: d.opcoes, automatico: d.automatico
    })),
    totais: { pessoas: pessoas.length, sem_cadastro: pessoas.filter(p => !p.contato?.completo).length, notas_para_conferir: dados.notasParaConferir.length }
  };
}

module.exports = {
  PESSOAS, NOTAS, TIPOS, TIPOS_COMISSAO, CRITERIOS, chaveDoNome, rotuloDaParte, linhasDoFechamento, cobre, notasDaLinha, opcoesDaNota, coberturaDosPagamentos,
  documentosNoFechamento, pendencias, nomesDoFinanceiro, lerTudo, ligarContato, ligarNotaSozinha, opcoes, escolher, desfazer, conferir, aposPagamento, listar
};
