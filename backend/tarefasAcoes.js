/**
 * Ações de outros módulos que uma tarefa pode cobrar (pedido do dono em
 * 18/09/2026): "Despachar o pedido #123", "Fechar as comissões de 09/2026",
 * "Converter a prospecção ACME em cliente"…
 *
 * A tarefa guarda `acao_chave` (a ação), `acao_registro` (o pedido, o
 * orçamento, a prospecção, o cliente — ou a competência "2026-09") e
 * `acao_rotulo` (como mostrar o registro). Quando a ação ACONTECE no módulo —
 * por qualquer pessoa —, as tarefas abertas que a cobram concluem sozinhas,
 * com a nota de quem fez e quando (decisão do dono).
 *
 * COMO SE PERCEBE A AÇÃO: cada ação diz a rota do servidor local que a
 * executa (método + caminho + condição no corpo). O `observar` abaixo, montado
 * no server.js antes das rotas, espera a resposta sair com sucesso e só então
 * procura as tarefas. Nenhum controller precisa saber que tarefas existem —
 * ação nova é uma linha aqui.
 *
 * Produtos e Matéria-prima ficam de fora por ora: essas telas gravam direto na
 * API, sem passar pelo servidor local.
 */

const MODULOS = {
  pedidos: { rotulo: 'Pedidos', icone: 'fa-cart-shopping', registro: 'pedido', busca: 'pedido' },
  orcamentos: { rotulo: 'Orçamentos', icone: 'fa-file-invoice-dollar', registro: 'orcamento', busca: 'orcamento' },
  prospeccoes: { rotulo: 'Prospecções', icone: 'fa-user-plus', registro: 'prospeccao', busca: 'prospeccao' },
  clientes: { rotulo: 'Clientes', icone: 'fa-users', registro: 'cliente', busca: 'cliente' },
  financeiro: { rotulo: 'Financeiro', icone: 'fa-hand-holding-dollar', registro: 'competencia', busca: 'mes' }
};

const statusDoPedido = alvo => corpo => String(corpo?.status || '').trim().toLowerCase() === alvo;
const situacaoDoOrcamento = alvo => corpo => String(corpo?.situacao || '').trim() === alvo;
const doCaminho = m => m[1];

/**
 * chave: gravada na tarefa. rotulo: o que a pessoa escolhe. feito: o verbo da
 * nota de conclusão ("despachou o pedido"). rotas: onde a ação acontece —
 * `registro(match, corpo, resposta)` diz de qual registro foi, `quando(corpo)`
 * filtra pelo que foi enviado e `sucesso(resposta)` pelo que voltou.
 */
const ACOES = [
  // ---------------------------------------------------------------- pedidos
  { chave: 'pedido.confirmar', modulo: 'pedidos', permissao: 'ped.status.confirm', rotulo: 'Confirmar o pedido (vai para Produção)', feito: 'confirmou o pedido',
    rotas: [{ metodo: 'PUT', caminho: /^\/api\/pedidos\/(\d+)\/status$/, registro: doCaminho, quando: statusDoPedido('produção') }] },
  { chave: 'pedido.despachar', modulo: 'pedidos', permissao: 'ped.status.ship', rotulo: 'Despachar o pedido (Enviado)', feito: 'despachou o pedido',
    rotas: [{ metodo: 'PUT', caminho: /^\/api\/pedidos\/(\d+)\/status$/, registro: doCaminho, quando: statusDoPedido('enviado') }] },
  { chave: 'pedido.entregar', modulo: 'pedidos', permissao: 'ped.status.deliver', rotulo: 'Dar o pedido como entregue', feito: 'deu o pedido como entregue',
    rotas: [{ metodo: 'PUT', caminho: /^\/api\/pedidos\/(\d+)\/status$/, registro: doCaminho, quando: statusDoPedido('entregue') }] },
  { chave: 'pedido.nfe', modulo: 'pedidos', permissao: 'financeiro.nfe.emit', rotulo: 'Emitir a NF-e do pedido', feito: 'emitiu a NF-e do pedido',
    rotas: [
      { metodo: 'POST', caminho: /^\/api\/fiscal\/pedidos\/(\d+)\/emitir$/, registro: doCaminho, sucesso: r => r?.autorizada === true },
      // A nota que ficou "em processamento" e foi autorizada depois, ao sincronizar.
      { metodo: 'POST', caminho: /^\/api\/fiscal\/notas\/(\d+)\/sincronizar$/, registro: (m, corpo, r) => r?.nota?.pedido_id, sucesso: r => r?.autorizada === true }
    ] },
  { chave: 'pedido.boletos', modulo: 'pedidos', permissao: 'financeiro.boleto.emit', rotulo: 'Gerar os boletos do pedido', feito: 'gerou os boletos do pedido',
    rotas: [{ metodo: 'POST', caminho: /^\/api\/cobranca\/pedidos\/(\d+)\/boletos$/, registro: doCaminho }] },
  { chave: 'pedido.recebimento', modulo: 'pedidos', permissao: 'financeiro.recebimento.registrar', rotulo: 'Registrar um recebimento do pedido', feito: 'registrou um recebimento do pedido',
    rotas: [{ metodo: 'POST', caminho: /^\/api\/cobranca\/recebimentos$/, registro: (m, corpo) => corpo?.pedido_id }] },
  { chave: 'pedido.producao', modulo: 'pedidos', permissao: 'financeiro.producao.registrar', rotulo: 'Registrar a produção do pedido', feito: 'registrou a produção do pedido',
    rotas: [{ metodo: 'POST', caminho: /^\/api\/financeiro\/producao$/, registro: (m, corpo) => corpo?.pedido_id }] },
  { chave: 'pedido.pagamento', modulo: 'pedidos', permissao: 'ped.payment.edit', rotulo: 'Alterar o pagamento do pedido', feito: 'alterou o pagamento do pedido',
    rotas: [{ metodo: 'PUT', caminho: /^\/api\/pedidos\/(\d+)\/pagamento$/, registro: doCaminho }] },
  { chave: 'pedido.datas', modulo: 'pedidos', permissao: 'ped.dates.edit', rotulo: 'Ajustar as datas de embarque e faturamento', feito: 'ajustou as datas do pedido',
    rotas: [{ metodo: 'PUT', caminho: /^\/api\/pedidos\/(\d+)\/datas$/, registro: doCaminho }] },
  { chave: 'pedido.devolucao', modulo: 'pedidos', permissao: 'ped.devolucao', rotulo: 'Registrar a devolução do pedido', feito: 'registrou a devolução do pedido',
    rotas: [{ metodo: 'POST', caminho: /^\/api\/devolucoes\/pedido\/(\d+)$/, registro: doCaminho }] },

  // ---------------------------------------------------------------- orçamentos
  { chave: 'orcamento.enviar', modulo: 'orcamentos', permissao: 'orc.send', rotulo: 'Enviar o orçamento (sair do rascunho)', feito: 'enviou o orçamento',
    rotas: [
      { metodo: 'PUT', caminho: /^\/api\/orcamentos\/(\d+)$/, registro: doCaminho, quando: situacaoDoOrcamento('Pendente') },
      { metodo: 'PATCH', caminho: /^\/api\/orcamentos\/(\d+)\/status$/, registro: doCaminho, quando: situacaoDoOrcamento('Pendente') }
    ] },
  { chave: 'orcamento.converter', modulo: 'orcamentos', permissao: 'orc.convert', rotulo: 'Converter o orçamento em pedido', feito: 'converteu o orçamento em pedido',
    rotas: [
      { metodo: 'PUT', caminho: /^\/api\/orcamentos\/(\d+)$/, registro: doCaminho, quando: situacaoDoOrcamento('Aprovado') },
      { metodo: 'PATCH', caminho: /^\/api\/orcamentos\/(\d+)\/status$/, registro: doCaminho, quando: situacaoDoOrcamento('Aprovado') }
    ] },
  { chave: 'orcamento.rejeitar', modulo: 'orcamentos', permissao: 'orc.status.change', rotulo: 'Dar o retorno: orçamento rejeitado', feito: 'marcou o orçamento como rejeitado',
    rotas: [
      { metodo: 'PUT', caminho: /^\/api\/orcamentos\/(\d+)$/, registro: doCaminho, quando: situacaoDoOrcamento('Rejeitado') },
      { metodo: 'PATCH', caminho: /^\/api\/orcamentos\/(\d+)\/status$/, registro: doCaminho, quando: situacaoDoOrcamento('Rejeitado') }
    ] },

  // ---------------------------------------------------------------- prospecções
  { chave: 'prospeccao.funil', modulo: 'prospeccoes', permissao: 'pros.stage.update', rotulo: 'Mover a prospecção no funil', feito: 'moveu a prospecção no funil',
    rotas: [
      { metodo: 'PATCH', caminho: /^\/api\/prospeccoes\/(\d+)\/etapa$/, registro: doCaminho },
      { metodo: 'POST', caminho: /^\/api\/prospeccoes\/(\d+)\/concluir-passo$/, registro: doCaminho, quando: corpo => Boolean(String(corpo?.etapa || '').trim()) }
    ] },
  { chave: 'prospeccao.converter', modulo: 'prospeccoes', permissao: 'pros.convert', rotulo: 'Converter a prospecção em cliente', feito: 'converteu a prospecção em cliente',
    rotas: [{ metodo: 'POST', caminho: /^\/api\/prospeccoes\/(\d+)\/converter$/, registro: doCaminho }] },
  { chave: 'prospeccao.interacao', modulo: 'prospeccoes', permissao: 'pros.interaction.add', rotulo: 'Registrar uma atividade na prospecção', feito: 'registrou uma atividade na prospecção',
    rotas: [
      { metodo: 'POST', caminho: /^\/api\/prospeccoes\/(\d+)\/interacoes$/, registro: doCaminho },
      { metodo: 'POST', caminho: /^\/api\/prospeccoes\/(\d+)\/concluir-passo$/, registro: doCaminho }
    ] },
  { chave: 'prospeccao.campanha', modulo: 'prospeccoes', permissao: 'pros.campaign.manage', rotulo: 'Registrar uma campanha na prospecção', feito: 'registrou uma campanha na prospecção',
    rotas: [{ metodo: 'POST', caminho: /^\/api\/prospeccoes\/(\d+)\/campanhas$/, registro: doCaminho }] },

  // ---------------------------------------------------------------- clientes
  { chave: 'cliente.atividade', modulo: 'clientes', permissao: 'cli.interaction.add', rotulo: 'Registrar uma atividade no cliente', feito: 'registrou uma atividade no cliente',
    rotas: [{ metodo: 'POST', caminho: /^\/api\/clientes\/(\d+)\/interacoes$/, registro: doCaminho }] },
  { chave: 'cliente.cadastro', modulo: 'clientes', permissao: 'cli.edit', rotulo: 'Atualizar o cadastro do cliente', feito: 'atualizou o cadastro do cliente',
    rotas: [{ metodo: 'PUT', caminho: /^\/api\/clientes\/(\d+)$/, registro: doCaminho }] },

  // ---------------------------------------------------------------- financeiro (a competência)
  { chave: 'financeiro.fechar_comissoes', modulo: 'financeiro', permissao: 'financeiro.competencia.fechar', rotulo: 'Fechar a competência de comissões', feito: 'fechou as comissões da competência',
    rotas: [{ metodo: 'POST', caminho: /^\/api\/financeiro\/fechamentos$/, registro: (m, corpo) => corpo?.competencia, quando: corpo => corpo?.tipo === 'comissao' }] },
  { chave: 'financeiro.fechar_producao', modulo: 'financeiro', permissao: 'financeiro.competencia.fechar', rotulo: 'Fechar a competência de produção', feito: 'fechou a produção da competência',
    rotas: [{ metodo: 'POST', caminho: /^\/api\/financeiro\/fechamentos$/, registro: (m, corpo) => corpo?.competencia, quando: corpo => corpo?.tipo === 'producao' }] },
  { chave: 'financeiro.pagar', modulo: 'financeiro', permissao: 'financeiro.pagamento.confirmar', rotulo: 'Confirmar o pagamento da competência', feito: 'confirmou o pagamento da competência',
    rotas: [{ metodo: 'POST', caminho: /^\/api\/financeiro\/pagamentos$/, registro: (m, corpo) => corpo?.competencia }] }
];

const PORCHAVE = new Map(ACOES.map(a => [a.chave, a]));

/** O registro no formato gravado: id numérico ("123") ou competência ("2026-09"). */
function registroNormalizado(acao, valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const s = String(valor).trim();
  if (MODULOS[acao.modulo].registro === 'competencia') return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null;
  return /^\d{1,12}$/.test(s) && Number(s) > 0 ? String(Number(s)) : null;
}

/**
 * O que foi feito numa requisição que deu certo → [{ chave, registro }]. Pura.
 * `caminho` é o de /api em diante (sem a query).
 */
function acoesDaRequisicao({ metodo, caminho, corpo, resposta }) {
  const achadas = [];
  for (const acao of ACOES) {
    for (const rota of acao.rotas) {
      if (rota.metodo !== String(metodo).toUpperCase()) continue;
      const m = rota.caminho.exec(caminho);
      if (!m) continue;
      if (rota.quando && !rota.quando(corpo || {})) continue;
      if (rota.sucesso && !rota.sucesso(resposta)) continue;
      const registro = registroNormalizado(acao, rota.registro(m, corpo || {}, resposta));
      if (registro && !achadas.some(a => a.chave === acao.chave && a.registro === registro)) achadas.push({ chave: acao.chave, registro });
    }
  }
  return achadas;
}

/** O catálogo como a tela precisa (sem as rotas), marcando o que a pessoa pode. */
function catalogo(pode = () => true) {
  return {
    modulos: Object.entries(MODULOS).map(([chave, m]) => ({ chave, ...m })),
    acoes: ACOES.map(a => ({ chave: a.chave, modulo: a.modulo, rotulo: a.rotulo, permissao: a.permissao, pode: Boolean(pode(a.permissao)) }))
  };
}

/** "Despachar o pedido (Enviado)" + "PED-311 — Móveis Serra" → a frase da tarefa. */
function descreverAcao(chave, rotuloRegistro) {
  const acao = PORCHAVE.get(chave);
  if (!acao) return null;
  const modulo = MODULOS[acao.modulo];
  return {
    chave, modulo: acao.modulo, moduloRotulo: modulo.rotulo, icone: modulo.icone, registroTipo: modulo.registro,
    rotulo: acao.rotulo, feito: acao.feito, registroRotulo: rotuloRegistro || null
  };
}

/**
 * Confere o que veio da tela: ação que existe, registro no formato certo.
 * Devolve { acao_chave, acao_registro, acao_rotulo } (tudo null = sem ação)
 * ou lança o erro com status 400.
 */
function normalizarAcao(corpo = {}) {
  const erro = mensagem => Object.assign(new Error(mensagem), { status: 400 });
  const chave = String(corpo.acao_chave ?? '').trim();
  if (!chave) return { acao_chave: null, acao_registro: null, acao_rotulo: null };
  const acao = PORCHAVE.get(chave);
  if (!acao) throw erro('Ação do sistema desconhecida.');
  const registro = registroNormalizado(acao, corpo.acao_registro);
  if (!registro) {
    throw erro(MODULOS[acao.modulo].registro === 'competencia'
      ? 'Escolha a competência (mês e ano) da ação.'
      : `Escolha ${{ pedido: 'o pedido', orcamento: 'o orçamento', prospeccao: 'a prospecção', cliente: 'o cliente' }[MODULOS[acao.modulo].registro]} da ação.`);
  }
  const rotulo = String(corpo.acao_rotulo ?? '').trim().slice(0, 200) || null;
  return { acao_chave: chave, acao_registro: registro, acao_rotulo: rotulo };
}

// ------------------------------------------------------------ o vigia

/**
 * Middleware (server.js, antes das rotas): em toda escrita que termina bem,
 * vê se alguma ação do catálogo aconteceu e conclui as tarefas que a cobram.
 * Não atrasa a resposta — roda depois de ela sair — e falha só vai para o log.
 */
function observar(req, res, next) {
  const metodo = String(req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(metodo)) return next();
  const caminho = String(req.originalUrl || req.url || '').split('?')[0];
  if (!ACOES.some(a => a.rotas.some(r => r.metodo === metodo && r.caminho.test(caminho)))) return next();
  let resposta;
  const json = res.json.bind(res);
  res.json = corpo => { resposta = corpo; return json(corpo); };
  res.on('finish', () => {
    if (res.statusCode >= 300) return;
    let achadas;
    try {
      achadas = acoesDaRequisicao({ metodo, caminho, corpo: req.body, resposta });
    } catch (err) {
      console.warn('[tarefas] ação do módulo não conferida:', err?.message || err);
      return;
    }
    if (!achadas.length) return;
    // Preguiçoso: o controller de tarefas depende do resto do sistema.
    const { concluirPelaAcao } = require('./tarefasController');
    for (const achada of achadas) {
      concluirPelaAcao(req, achada).catch(err => console.warn('[tarefas] não concluiu pela ação', achada.chave, err?.message || err));
    }
  });
  return next();
}

module.exports = { MODULOS, ACOES, acoesDaRequisicao, catalogo, descreverAcao, normalizarAcao, registroNormalizado, observar };
