/**
 * Registro da devolução de um pedido: o que a tela vê antes (`opcoes`), a
 * simulação (`previa`), a leitura do XML do cliente (`lerXml`), o registro em
 * si (`registrar`) e a nova tentativa do que ficou pendente (`reaplicar`).
 *
 * A ORDEM DO REGISTRO. Não existe transação entre as requisições ao CRUD da
 * API, então vale a política do cancelamento: conferir TUDO antes de
 * escrever (o plano é puro e recusa sem gravar nada), e depois gravar na
 * ordem em que uma falha no meio deixa o estado mais fácil de ler:
 *
 *   1. o cabeçalho (`devolucoes`, status "processando") — a sequência única
 *      por pedido impede dois registros ao mesmo tempo;
 *   2. a nota do cliente (o XML), quando veio;
 *   3. as peças: volta ao estoque, `devolucao_itens` e a quantidade devolvida;
 *   4. o pedido: etiqueta (parcial/total) e valores;
 *   5. as parcelas: valor novo, abatimento ou baixa no BB (`devolucao_parcelas`);
 *   6. o reembolso (pendente) e os ajustes de comissão das parcelas pagas;
 *   7. os históricos, e o cabeçalho vira "concluida" ou "pendencias".
 *
 * O que falhar no meio NÃO desfaz o resto: fica marcado com erro na própria
 * linha, aparece na tela e no Financeiro, e `reaplicar` tenta de novo.
 */
const c = require('./comum');
const calculo = require('./calculo');
const base = require('./base');
const estoque = require('./estoque');
const xmlDevolucao = require('./xmlDevolucao');
const { EVENTO, registrarEventoDoPedido } = require('../estoqueLedger');
const operacoes = require('../cobranca/boletoOperacoes');
const boletos = require('../cobranca/boletos');
const ajustes = require('../financeiro/ajustes');
const auditoria = require('../financeiro/auditoria');
const configuracaoFiscal = require('../fiscal/configuracaoFiscal');
const configuracaoCobranca = require('../cobranca/configuracaoCobranca');
const parcelaMinima = require('../cobranca/parcelaMinima');

/** Depois disto, um cabeçalho "processando" é de um registro que morreu no meio. */
const MINUTOS_EM_ANDAMENTO = 5;
const ROTULO_DO_TIPO = { parcial: 'parcial', total: 'total' };
const ROTULO_DO_MODO = {
  valor_parcela: 'valor da parcela reduzido', abatimento_boleto: 'abatimento no boleto', baixa_boleto: 'boleto baixado',
  cancelada: 'parcela cancelada', reembolso: 'reembolso', reemissao_boleto: 'boleto reemitido com o valor novo'
};

/** A parcela mínima da configuração de cobrança (0 sem o SQL). */
async function minimoDaParcela(api) {
  return parcelaMinima.minimoDe(await configuracaoCobranca.carregar(api).catch(() => null));
}

function validarEntrada(entrada, hoje) {
  const data = String(entrada?.data_devolucao || '').slice(0, 10);
  if (!c.dataValida(data)) throw c.erro('Informe a data da devolução.');
  if (data > hoje) throw c.erro('A data da devolução não pode ser futura.');
  const motivo = c.texto(entrada?.motivo, 200);
  if (motivo.length < 3) throw c.erro('Diga o motivo da devolução.');
  const chave = c.texto(entrada?.chave_idempotencia, 64) || null;
  const xml = typeof entrada?.xml === 'string' && entrada.xml.trim() ? entrada.xml : null;
  return { data, motivo, observacao: c.texto(entrada?.observacao, 500) || null, chave, xml, itens: Array.isArray(entrada?.itens) ? entrada.itens : [] };
}

const resumoDoPedido = (b) => ({
  id: b.pedido.id, numero: b.pedido.numero ?? String(b.pedido.id), situacao: b.pedido.situacao || '',
  cliente: c.nomeDoCliente(b.cliente), devolucao: b.pedido.devolucao || null,
  valor_final: c.centavos(b.pedido.valor_final),
  valor_original: c.centavos(b.pedido.valor_original ?? b.pedido.valor_final),
  valor_devolvido: c.centavos(b.pedido.valor_devolvido)
});

const parcelaParaTela = p => ({
  numero: p.numero, vencimento: p.vencimento, estado: p.estado, valor: p.valor, saldo: p.saldo,
  pago: p.pago, reembolsado: p.reembolsado, boleto: p.boleto
});

/** Tudo de uma devolução já gravada, para a tela. */
async function detalhe(api, devolucaoId) {
  const id = Number(devolucaoId);
  const devolucao = (await c.ler(api, 'devolucoes', { id }))[0];
  if (!devolucao) throw c.erro('Devolução não encontrada.', 404);
  const [itens, parcelas, reembolsos, notas] = await Promise.all([
    c.ler(api, 'devolucao_itens', { devolucao_id: id }),
    c.ler(api, 'devolucao_parcelas', { devolucao_id: id }),
    c.ler(api, 'reembolsos', { devolucao_id: id }),
    devolucao.nota_devolucao_id ? c.ler(api, 'notas_devolucao', { id: devolucao.nota_devolucao_id }) : Promise.resolve([])
  ]);
  const nota = notas[0] ? (({ xml, itens: _itens, ...resto }) => resto)(notas[0]) : null;
  return {
    devolucao: { ...devolucao, data_devolucao: c.dia(devolucao.data_devolucao), avisos: c.jsonDe(devolucao.avisos, []) },
    itens: itens.sort((a, b) => Number(a.id) - Number(b.id)),
    parcelas: parcelas.sort((a, b) => Number(a.numero_parcela) - Number(b.numero_parcela))
      .map(p => ({ ...p, data_vencimento: c.dia(p.data_vencimento), rotulo: ROTULO_DO_MODO[p.modo] || p.modo })),
    reembolso: reembolsos[0] || null,
    nota,
    pendencias: itens.filter(i => i.status === 'erro').length + parcelas.filter(p => p.status === 'erro').length
  };
}

/** O que a tela da devolução mostra ao abrir. */
async function opcoes({ api, pedidoId, hoje }) {
  const b = await base.lerPedido(api, pedidoId, hoje);
  return {
    pedido: resumoDoPedido(b),
    bloqueio: base.bloqueioDaDevolucao(b.pedido, b.notaViva),
    nota: b.notaViva,
    itens: b.pecas,
    parcelas: b.parcelas.map(parcelaParaTela),
    devolucoes: b.devolucoes.map(d => ({
      id: d.id, sequencia: d.sequencia, tipo: d.tipo, data_devolucao: c.dia(d.data_devolucao), valor: c.centavos(d.valor),
      valor_reembolso: c.centavos(d.valor_reembolso), status: d.status, motivo: d.motivo
    })),
    hoje
  };
}

async function previa({ api, pedidoId, entrada, hoje }) {
  const b = await base.lerPedido(api, pedidoId, hoje);
  const bloqueio = base.bloqueioDaDevolucao(b.pedido, b.notaViva);
  if (bloqueio) throw c.erro(bloqueio, 409);
  return calculo.planejar({ pedido: b.pedido, itens: b.itens, escolhas: entrada?.itens, parcelas: b.parcelas, minimo: await minimoDaParcela(api) });
}

async function documentoDaEmpresa(api) {
  const cfg = await configuracaoFiscal.carregar(api).catch(() => null);
  return cfg?.cnpj || null;
}

/** Lê o XML do cliente e sugere as quantidades. Não grava nada. */
async function lerXml({ api, pedidoId, xml, hoje }) {
  const b = await base.lerPedido(api, pedidoId, hoje);
  const nota = xmlDevolucao.lerNota(xml);
  const conferencia = xmlDevolucao.conferirNota(nota, {
    chaveDaNotaDoPedido: b.notaViva?.chave_acesso || null,
    documentoDaEmpresa: await documentoDaEmpresa(api),
    documentoDoCliente: b.cliente?.cnpj || b.cliente?.cpf || null
  });
  const jaLancada = (await c.ler(api, 'notas_devolucao', { chave_acesso: nota.chave_acesso }))[0];
  if (jaLancada) conferencia.bloqueios.push(`Esta nota já foi lançada numa devolução${Number(jaLancada.pedido_id) === Number(b.pedido.id) ? ' deste pedido' : ' de outro pedido'}.`);
  const casamento = xmlDevolucao.casarItens(nota.itens, b.pecas);
  return {
    nota: xmlDevolucao.resumoDaNota(nota),
    bloqueios: conferencia.bloqueios,
    avisos: [...conferencia.avisos, ...casamento.avisos],
    escolhas: casamento.escolhas, casados: casamento.casados, nao_reconhecidos: casamento.nao_reconhecidos
  };
}

// ------------------------------------------------------------ as parcelas

/** O que a linha manda fazer na parcela (e no BB). Lança o erro: quem chama marca a linha. */
async function aplicarNaParcela({ api, linha, parcelasCruas, listaDeBoletos, contextoBB, usuarioId, hoje, rotulo, sincronizarAntes = false }) {
  const crua = parcelasCruas.find(p => Number(p.id) === Number(linha.parcela_id)) || parcelasCruas.find(p => Number(p.numero_parcela) === Number(linha.numero_parcela)) || null;
  const zerar = async () => {
    if (!crua) return;
    await api.put(`/api/pedido_parcelas/${crua.id}`, { valor: 0, valor_original: crua.valor_original ?? crua.valor });
  };

  if (linha.modo === 'reembolso') return [];
  if (linha.modo === 'valor_parcela') {
    if (!crua) throw c.erro('a parcela não existe mais no pedido', 409);
    await api.put(`/api/pedido_parcelas/${crua.id}`, { valor: c.centavos(linha.valor_depois), valor_original: crua.valor_original ?? crua.valor });
    return [];
  }
  if (linha.modo === 'cancelada') {
    await zerar();
    return [];
  }

  // Daqui para baixo é BB: abatimento, baixa ou reemissão do boleto que vale.
  let boleto = listaDeBoletos.find(bl => Number(bl.id) === Number(linha.boleto_id)) || await boletos.ler(api, linha.boleto_id);
  if (typeof contextoBB !== 'function') throw c.erro('a cobrança do BB não está disponível nesta máquina', 409);
  const ctx = await contextoBB(api, boleto, { usuarioId, hoje });
  const avisos = [];
  if (sincronizarAntes) {
    // Nova tentativa: o que vale é o que o BB diz agora (a anterior pode ter passado lá e falhado aqui).
    boleto = await operacoes.sincronizar({ api, ...ctx, boleto, hoje, usuarioId }).then(r => r.boleto).catch(() => boleto);
  }
  const aPagar = boletos.STATUS_A_PAGAR.has(String(boleto.status));

  if (linha.modo === 'reemissao_boleto') {
    // A parcela cresceu (junção pela parcela mínima): valor novo na parcela, e
    // o boleto — que o BB não deixa aumentar — é baixado e reemitido na mesma data.
    if (!crua) throw c.erro('a parcela não existe mais no pedido', 409);
    await api.put(`/api/pedido_parcelas/${crua.id}`, { valor: c.centavos(linha.valor_depois), valor_original: crua.valor_original ?? crua.valor });
    const vencimentoAtual = c.dia(boleto.data_vencimento) || c.dia(linha.data_vencimento) || hoje;
    const vencimento = vencimentoAtual < hoje ? hoje : vencimentoAtual;
    const avisosR = vencimento !== vencimentoAtual ? [`Parcela ${linha.numero_parcela}: o boleto já estava vencido; o novo vence hoje (${c.impressa(hoje)}).`] : [];
    const conferirNovo = r => {
      const falhas = (r?.resultados || []).filter(x => !x.ok);
      if (r?.erro || falhas.length) throw c.erro(`o boleto antigo foi baixado, mas o novo não saiu: ${r?.erro || falhas.map(x => x.erro).join(' | ')}`, 409);
    };
    if (aPagar) {
      const r = await operacoes.baixar({
        api, ...ctx, boleto, hoje, usuarioId, registrarNovo: ctx.registrarNovo,
        entrada: { motivo: 'reemissao', novo_vencimento: vencimento, observacao: rotulo }
      });
      conferirNovo(r.reemissao);
      return [...avisosR, ...(r.avisos || []).filter(a => !/boleto novo não saiu/.test(a))];
    }
    // Tentativa anterior baixou o antigo e o novo não saiu: registra só o novo.
    const dados = await boletos.lerPedidoCobranca(api, crua.pedido_id);
    const vivo = boletos.boletoDaParcela(dados.boletos, crua);
    if (vivo && boletos.STATUS_A_PAGAR.has(String(vivo.status)) && Number(vivo.id) !== Number(boleto.id)) return avisosR;
    if (typeof ctx.registrarNovo !== 'function') throw c.erro('não foi possível registrar o boleto novo nesta máquina', 409);
    conferirNovo(await ctx.registrarNovo({ vencimento, substitui: boleto }));
    return avisosR;
  }

  if (linha.modo === 'baixa_boleto') {
    if (aPagar) {
      const r = await operacoes.baixar({ api, ...ctx, boleto, hoje, usuarioId, entrada: { motivo: 'cancelado', observacao: rotulo } });
      avisos.push(...(r.avisos || []));
    } else if (boleto.status === 'pago') {
      throw c.erro('o boleto foi pago depois do registro: trate como parcela paga (reembolso à mão)', 409);
    }
    await zerar();
    return avisos;
  }

  // abatimento_boleto: o boleto passa a cobrar `valor_depois`.
  if (!aPagar) throw c.erro(`o boleto está "${boleto.status}": não aceita abatimento`, 409);
  const alvo = c.centavos(Number(boleto.valor) - Number(linha.valor_depois));
  if (c.centavos(boleto.valor_abatimento || 0) >= alvo) return avisos; // já está lá
  const r = await operacoes.concederAbatimento({ api, ...ctx, boleto, valor: alvo, hoje, usuarioId });
  avisos.push(...(r.avisos || []));
  return avisos;
}

const textoDoErro = e => c.texto(e?.message || String(e), 400);

// -------------------------------------------------------------- registrar

function descricaoDoEvento({ plano, sequencia, entrada, falhas }) {
  const pecas = plano.itens.map(i => `${i.quantidade}× ${i.nome}`).join(', ');
  const parcelas = plano.parcelas.map(p => `parcela ${p.numero_parcela}: ${ROTULO_DO_MODO[p.modo]} de ${c.reais(p.desconto)}`).join('; ');
  return `Devolução ${ROTULO_DO_TIPO[plano.tipo]} nº ${sequencia} em ${c.impressa(entrada.data)} (${c.reais(plano.valor)}): ${entrada.motivo}.`
    + `\nPeças que voltaram ao estoque: ${pecas}.`
    + (parcelas ? `\nFinanceiro: ${parcelas}.` : '')
    + (plano.valor_reembolso > 0 ? `\nReembolso ao cliente: ${c.reais(plano.valor_reembolso)} (pendente).` : '')
    + (falhas ? `\nFicaram ${falhas} pendência(s) para tentar de novo.` : '');
}

async function registrar({ api, pedidoId, entrada, usuarioId = null, hoje, desde = null, contextoBB = null }) {
  const v = validarEntrada(entrada, hoje);
  const b = await base.lerPedido(api, pedidoId, hoje);

  if (v.chave) {
    const repetida = b.devolucoes.find(d => d.chave_idempotencia === v.chave);
    if (repetida) return { ...(await detalhe(api, repetida.id)), repetida: true };
  }
  const bloqueio = base.bloqueioDaDevolucao(b.pedido, b.notaViva);
  if (bloqueio) throw c.erro(bloqueio, 409);

  const limite = Date.now() - MINUTOS_EM_ANDAMENTO * 60000;
  const emAndamento = b.devolucoes.filter(d => d.status === 'processando');
  if (emAndamento.some(d => new Date(d.criado_em).getTime() > limite)) {
    throw c.erro('Outra devolução deste pedido está sendo registrada agora. Aguarde e reabra a tela.', 409);
  }

  let nota = null;
  if (v.xml) {
    nota = xmlDevolucao.lerNota(v.xml);
    const conferencia = xmlDevolucao.conferirNota(nota, {
      chaveDaNotaDoPedido: b.notaViva?.chave_acesso || null,
      documentoDaEmpresa: await documentoDaEmpresa(api),
      documentoDoCliente: b.cliente?.cnpj || b.cliente?.cpf || null
    });
    if (conferencia.bloqueios.length) throw c.erro(conferencia.bloqueios.join(' '), 422);
    if ((await c.ler(api, 'notas_devolucao', { chave_acesso: nota.chave_acesso })).length) throw c.erro('Esta nota de devolução já foi lançada.', 409);
  }

  // Nada foi gravado até aqui: o plano recusa o que não fecha com o pedido.
  const plano = calculo.planejar({ pedido: b.pedido, itens: b.itens, escolhas: v.itens, parcelas: b.parcelas, minimo: await minimoDaParcela(api) });
  const avisos = [...plano.avisos];

  // 1. cabeçalho
  for (const velha of emAndamento) {
    await c.atualizar(api, 'devolucoes', velha.id, { status: 'pendencias', avisos: JSON.stringify(['O registro foi interrompido no meio: confira o estoque e as parcelas.']) }).catch(() => {});
  }
  const sequencia = b.devolucoes.reduce((m, d) => Math.max(m, Number(d.sequencia) || 0), 0) + 1;
  let cabecalho;
  try {
    cabecalho = await c.inserir(api, 'devolucoes', {
      pedido_id: Number(b.pedido.id), sequencia, tipo: plano.tipo, data_devolucao: v.data, valor: plano.valor,
      valor_parcelas: plano.valor_parcelas, valor_reembolso: plano.valor_reembolso, motivo: v.motivo, observacao: v.observacao,
      nota_devolucao_id: null, status: 'processando', avisos: null, chave_idempotencia: v.chave, criado_por: usuarioId, criado_em: c.agora()
    });
  } catch (e) {
    if (e?.extra?.sql_pendente) throw e;
    if (c.ehDuplicado(e)) throw c.erro('Outra devolução deste pedido acabou de ser registrada. Reabra a tela para ver o que mudou.', 409);
    throw e;
  }
  const devolucaoId = cabecalho.id;
  const rotulo = `Devolução ${ROTULO_DO_TIPO[plano.tipo]} nº ${sequencia} do pedido ${b.pedido.numero ?? b.pedido.id}`;

  // 2. a nota do cliente
  if (nota) {
    try {
      const gravada = await c.inserir(api, 'notas_devolucao', {
        pedido_id: Number(b.pedido.id), devolucao_id: devolucaoId, chave_acesso: nota.chave_acesso, modelo: nota.modelo || null,
        serie: nota.serie, numero: nota.numero, data_emissao: nota.data_emissao, finalidade: nota.finalidade,
        natureza_operacao: c.texto(nota.natureza_operacao, 120) || null, emitente_documento: nota.emitente_documento || null,
        emitente_nome: c.texto(nota.emitente_nome, 120) || null, destinatario_documento: nota.destinatario_documento || null,
        chave_referenciada: nota.chaves_referenciadas[0] || null, protocolo: nota.protocolo, valor_produtos: nota.valor_produtos,
        valor_total: nota.valor_total, itens: JSON.stringify(nota.itens), xml: v.xml, criado_por: usuarioId, criado_em: c.agora()
      });
      await c.atualizar(api, 'devolucoes', devolucaoId, { nota_devolucao_id: gravada.id });
    } catch (e) {
      avisos.push(`A nota do cliente não foi guardada: ${textoDoErro(e)}`);
    }
  }

  // 3. as peças
  const ctxEstoque = estoque.criarContexto();
  let falhas = 0;
  for (const item of plano.itens) {
    const avisosDoEstoque = [];
    const volta = await estoque.devolverAoEstoque(api, { pedido: b.pedido, item, quantidade: item.quantidade, usuarioId }, ctxEstoque, avisosDoEstoque)
      .catch(e => ({ lote_id: null, movimento_id: null, erro: textoDoErro(e) }));
    avisos.push(...avisosDoEstoque);
    if (volta.erro) { falhas += 1; avisos.push(`"${item.nome}" não voltou ao estoque: ${volta.erro}`); }
    await c.inserir(api, 'devolucao_itens', {
      devolucao_id: devolucaoId, pedido_id: Number(b.pedido.id), pedido_item_id: item.pedido_item_id, produto_id: item.produto_id,
      codigo: c.texto(item.codigo, 60) || null, nome: c.texto(item.nome, 255), quantidade: item.quantidade, valor_unitario: item.valor_unitario,
      valor_total: item.valor_total, lote_id: volta.lote_id, movimento_id: volta.movimento_id, status: volta.erro ? 'erro' : 'ok', erro: volta.erro || null, criado_em: c.agora()
    }).catch(e => avisos.push(`A peça "${item.nome}" não ficou registrada na devolução: ${textoDoErro(e)}`));
    const peca = b.pecas.find(p => Number(p.pedido_item_id) === Number(item.pedido_item_id));
    await api.put(`/api/pedidos_itens/${item.pedido_item_id}`, { quantidade_devolvida: (peca?.devolvida || 0) + item.quantidade })
      .catch(e => { falhas += 1; avisos.push(`A quantidade devolvida de "${item.nome}" não foi gravada: ${textoDoErro(e)}`); });
  }

  // 4. o pedido
  await api.put(`/api/pedidos/${b.pedido.id}`, {
    devolucao: plano.tipo, valor_devolvido: plano.pedido.valor_devolvido, valor_original: plano.pedido.valor_original,
    valor_final: plano.pedido.valor_final, data_devolucao: v.data
  }).catch(e => { falhas += 1; avisos.push(`O pedido não foi marcado como devolvido: ${textoDoErro(e)}`); });

  // 5. as parcelas
  const gravadas = [];
  for (const linha of plano.parcelas) {
    let status = 'ok';
    let erroDaLinha = null;
    try {
      avisos.push(...await aplicarNaParcela({ api, linha, parcelasCruas: b.parcelasCruas, listaDeBoletos: b.boletos, contextoBB, usuarioId, hoje, rotulo }));
    } catch (e) {
      status = 'erro';
      erroDaLinha = textoDoErro(e);
      falhas += 1;
      avisos.push(`Parcela ${linha.numero_parcela} (${ROTULO_DO_MODO[linha.modo]}): ${erroDaLinha}`);
    }
    const gravada = await c.inserir(api, 'devolucao_parcelas', {
      devolucao_id: devolucaoId, pedido_id: Number(b.pedido.id), parcela_id: linha.parcela_id, numero_parcela: linha.numero_parcela,
      data_vencimento: linha.data_vencimento, situacao: linha.situacao, modo: linha.modo, valor_antes: linha.valor_antes, desconto: linha.desconto,
      valor_depois: linha.valor_depois, boleto_id: linha.boleto_id, recebimento_id: linha.recebimento_id, ajuste_id: null,
      status, erro: erroDaLinha, criado_em: c.agora()
    }).catch(e => { avisos.push(`A parcela ${linha.numero_parcela} não ficou registrada na devolução: ${textoDoErro(e)}`); return null; });
    if (gravada) gravadas.push(gravada);
  }

  // 6. reembolso e comissões
  let reembolso = null;
  if (plano.valor_reembolso > 0) {
    reembolso = await c.inserir(api, 'reembolsos', {
      devolucao_id: devolucaoId, pedido_id: Number(b.pedido.id), cliente_id: b.pedido.cliente_id ?? null, valor: plano.valor_reembolso,
      status: 'pendente', criado_por: usuarioId, criado_em: c.agora()
    }).catch(e => { falhas += 1; avisos.push(`O reembolso de ${c.reais(plano.valor_reembolso)} não foi lançado: ${textoDoErro(e)}`); return null; });
  }
  const partes = plano.parcelas.filter(p => p.modo === 'reembolso').map(p => ({ numero: p.numero_parcela, valor: p.desconto }));
  if (partes.length) {
    try {
      const lancados = await ajustes.registrarDaDevolucao({ api, pedidoId: b.pedido.id, partes, data: v.data, motivo: `${rotulo}: ${v.motivo}`, usuarioId, hoje, desde });
      for (const l of lancados.filter(x => x.ajuste?.id)) {
        const linha = gravadas.find(g => g.modo === 'reembolso' && Number(g.numero_parcela) === Number(l.numero));
        if (linha) await c.atualizar(api, 'devolucao_parcelas', linha.id, { ajuste_id: l.ajuste.id }).catch(() => {});
      }
      if (lancados.some(l => l.gera_estorno)) avisos.push('A comissão dessas parcelas já estava fechada: o estorno entra na próxima competência.');
    } catch (e) {
      avisos.push(e?.extra?.sql_pendente
        ? 'As comissões (fase G) ainda não estão ativadas no banco: nenhum ajuste de comissão foi lançado.'
        : `O ajuste de comissão não foi lançado: ${textoDoErro(e)}. Registre à mão em Financeiro → Registrar ajuste.`);
    }
  }

  // 7. históricos e fecho
  await registrarEventoDoPedido(api, {
    pedidoId: b.pedido.id, tipoEvento: EVENTO.DEVOLUCAO, tipoAlternativo: EVENTO.EDICAO, usuarioId,
    descricao: descricaoDoEvento({ plano, sequencia, entrada: v, falhas })
  }, avisos);
  await auditoria.registrar(api, {
    tipo: 'devolucao_registrada', pedidoId: Number(b.pedido.id), referenciaId: devolucaoId, valor: -plano.valor, usuarioId,
    descricao: `${rotulo} (${c.reais(plano.valor)}): ${v.motivo}${plano.valor_reembolso > 0 ? ` · reembolso de ${c.reais(plano.valor_reembolso)}` : ''}`,
    dados: { tipo: plano.tipo, parcelas: plano.parcelas.map(p => ({ numero: p.numero_parcela, modo: p.modo, desconto: p.desconto })) }
  });
  await c.atualizar(api, 'devolucoes', devolucaoId, { status: falhas ? 'pendencias' : 'concluida', avisos: avisos.length ? JSON.stringify(avisos) : null, concluida_em: c.agora() })
    .catch(e => avisos.push(`O fecho da devolução não foi gravado: ${textoDoErro(e)}`));

  return { ...(await detalhe(api, devolucaoId)), avisos, reembolso: reembolso || null };
}

/** Tenta de novo o que ficou com erro (estoque e parcelas) numa devolução já registrada. */
async function reaplicar({ api, devolucaoId, usuarioId = null, hoje, contextoBB = null }) {
  const atual = await detalhe(api, devolucaoId);
  const pendentesItens = atual.itens.filter(i => i.status === 'erro');
  const pendentesParcelas = atual.parcelas.filter(p => p.status === 'erro');
  if (!pendentesItens.length && !pendentesParcelas.length) return { ...atual, avisos: ['Não há pendência nesta devolução.'] };

  const pedido = await api.get(`/api/pedidos/${atual.devolucao.pedido_id}`).catch(() => null);
  const [parcelasCruas, listaDeBoletos] = await Promise.all([
    api.get('/api/pedido_parcelas', { query: { pedido_id: atual.devolucao.pedido_id } }).then(c.lista).catch(() => []),
    api.get('/api/boletos', { query: { pedido_id: atual.devolucao.pedido_id } }).then(c.lista).catch(() => [])
  ]);
  const rotulo = `Devolução ${ROTULO_DO_TIPO[atual.devolucao.tipo]} nº ${atual.devolucao.sequencia} do pedido ${pedido?.numero ?? atual.devolucao.pedido_id}`;
  const avisos = [];
  let falhas = 0;

  const ctxEstoque = estoque.criarContexto();
  for (const item of pendentesItens) {
    const volta = await estoque.devolverAoEstoque(api, { pedido, item, quantidade: item.quantidade, usuarioId }, ctxEstoque, avisos)
      .catch(e => ({ lote_id: null, movimento_id: null, erro: textoDoErro(e) }));
    if (volta.erro) { falhas += 1; avisos.push(`"${item.nome}" não voltou ao estoque: ${volta.erro}`); }
    await c.atualizar(api, 'devolucao_itens', item.id, { status: volta.erro ? 'erro' : 'ok', erro: volta.erro || null, lote_id: volta.lote_id, movimento_id: volta.movimento_id }).catch(() => {});
  }
  for (const linha of pendentesParcelas) {
    try {
      avisos.push(...await aplicarNaParcela({ api, linha, parcelasCruas, listaDeBoletos, contextoBB, usuarioId, hoje, rotulo, sincronizarAntes: true }));
      await c.atualizar(api, 'devolucao_parcelas', linha.id, { status: 'ok', erro: null, atualizado_em: c.agora() });
    } catch (e) {
      falhas += 1;
      const texto = textoDoErro(e);
      avisos.push(`Parcela ${linha.numero_parcela} (${ROTULO_DO_MODO[linha.modo]}): ${texto}`);
      await c.atualizar(api, 'devolucao_parcelas', linha.id, { erro: texto, atualizado_em: c.agora() }).catch(() => {});
    }
  }
  if (!falhas) await c.atualizar(api, 'devolucoes', atual.devolucao.id, { status: 'concluida', concluida_em: c.agora() }).catch(() => {});
  return { ...(await detalhe(api, devolucaoId)), avisos };
}

module.exports = { MINUTOS_EM_ANDAMENTO, ROTULO_DO_MODO, validarEntrada, opcoes, previa, lerXml, registrar, reaplicar, detalhe };
