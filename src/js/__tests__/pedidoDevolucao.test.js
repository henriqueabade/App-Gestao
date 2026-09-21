/**
 * Devolução de pedido na tela: o modal (src/js/modals/pedido-devolucao.js e
 * src/html/modals/pedidos/devolucao.html), o botão roxo que toma o lugar do
 * "Cancelar" no Visualizar, a etiqueta roxa e a tag "NF dev." na lista, e o
 * "Confirmar reembolso" do Financeiro.
 *
 * As funções puras são recortadas e executadas sem DOM; o resto prende a
 * anatomia do HTML (guardas escritas, botões só com texto, não fecha por fora)
 * e a ligação com o backend (/api/devolucoes, confirmação na caixa da casa,
 * nada de innerHTML nem confirm()).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');
const FONTE = ler('js', 'modals', 'pedido-devolucao.js');
const HTML = ler('html', 'modals', 'pedidos', 'devolucao.html');
const VISUALIZAR = ler('js', 'modals', 'pedido-visualizar.js');
const VIS_HTML = ler('html', 'modals', 'pedidos', 'visualizar.html');
const PEDIDOS = ler('js', 'pedidos.js');
const plano = v => JSON.parse(JSON.stringify(v));
const semEspacoFixo = s => String(s).replace(/\s/g, ' ');

function puras() {
  const inicio = FONTE.indexOf('const ROTULO_DO_MODO');
  const fim = FONTE.indexOf('// ------------------------------------------------- fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  return vm.runInContext(`${FONTE.slice(inicio, fim)}
({ quantidadeValida, escolhasDe, estimativa, etiquetaDoTipo, linhaDaParcela, textoDaConfirmacao, resumoDoResultado, linhaDoHistorico, mensagemDeErro })`, vm.createContext({}));
}

/** Recorta uma função de nível do arquivo (ou de dentro do IIFE) pelo nome e a executa isolada. */
function recortar(fonte, nome, extras = '') {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.ok(inicio !== -1, `sem a função ${nome}`);
  let nivel = 0;
  let i = fonte.indexOf('{', inicio);
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    if (fonte[i] === '}') { nivel -= 1; if (nivel === 0) break; }
  }
  return vm.runInContext(`${extras}\n${fonte.slice(inicio, i + 1)}\n${nome}`, vm.createContext({}));
}

const ITENS = [
  { pedido_item_id: 501, nome: 'Poltrona Asa', quantidade: 4, devolvida: 1, disponivel: 3, valor_unitario: 750 },
  { pedido_item_id: 502, nome: 'Mesa Lateral', quantidade: 1, devolvida: 0, disponivel: 1, valor_unitario: 1000 }
];

test('quantidades: inteiras, nunca acima do que a linha ainda pode devolver; só as linhas com quantidade vão ao backend', () => {
  const f = puras();
  assert.strictEqual(f.quantidadeValida('2', 3), 2);
  assert.strictEqual(f.quantidadeValida('9', 3), 3, 'limita ao disponível');
  assert.strictEqual(f.quantidadeValida('1,9', 3), 1, 'peça não se devolve pela metade');
  assert.strictEqual(f.quantidadeValida('-1', 3), 0);
  assert.strictEqual(f.quantidadeValida('abc', 3), 0);
  assert.strictEqual(f.quantidadeValida('1', 0), 0, 'linha já devolvida por inteiro');
  assert.deepStrictEqual(plano(f.escolhasDe(ITENS, { 501: '2', 502: 0 })), [{ pedido_item_id: 501, quantidade: 2 }]);
  assert.deepStrictEqual(plano(f.escolhasDe(ITENS, {})), []);
});

test('estimativa e etiqueta: parcial enquanto sobra peça na rua, total quando tudo o que restava volta', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.estimativa(ITENS, { 501: 2 })), { pecas: 2, valor: 1500, tipo: 'parcial' });
  // A poltrona já tinha 1 devolvida: devolver as 3 que restam e a mesa fecha o pedido.
  assert.deepStrictEqual(plano(f.estimativa(ITENS, { 501: 3, 502: 1 })), { pecas: 4, valor: 3250, tipo: 'total' });
  assert.deepStrictEqual(plano(f.estimativa(ITENS, {})), { pecas: 0, valor: 0, tipo: null });
  assert.deepStrictEqual(plano(f.etiquetaDoTipo('total')), ['badge-purple', 'Devolução total']);
  assert.deepStrictEqual(plano(f.etiquetaDoTipo('parcial')), ['badge-purple', 'Devolução parcial']);
  assert.deepStrictEqual(plano(f.etiquetaDoTipo(null)), ['badge-neutral', '—']);
});

test('linha da parcela: diz o que acontece com cada uma (desconto, abatimento, baixa, cancelada, reembolso)', () => {
  const f = puras();
  const abatimento = f.linhaDaParcela({ numero_parcela: 3, data_vencimento: '2026-11-10T00:00:00.000Z', situacao: 'aberta', modo: 'abatimento_boleto', valor_antes: 2000, desconto: 1000, valor_depois: 1000, nosso_numero: '0003128557' });
  assert.deepStrictEqual([abatimento.numero, abatimento.vencimento, abatimento.acao], ['3ª', '10/11/2026', 'Abatimento no boleto (BB)']);
  assert.deepStrictEqual(plano(abatimento.situacao), ['badge-warning', 'Em aberto']);
  assert.strictEqual(semEspacoFixo(abatimento.detalhe), 'o boleto 0003128557 passa a cobrar R$ 1.000,00');
  assert.strictEqual(semEspacoFixo(abatimento.desconto), '− R$ 1.000,00');
  const reembolso = f.linhaDaParcela({ numero_parcela: 1, situacao: 'paga', modo: 'reembolso', valor_antes: 1000, desconto: 500, valor_depois: 500 });
  assert.deepStrictEqual(plano(reembolso.situacao), ['badge-success', 'Paga']);
  assert.strictEqual(reembolso.acao, 'Reembolso ao cliente');
  assert.match(reembolso.detalhe, /pendente no Financeiro/);
  assert.strictEqual(f.linhaDaParcela({ modo: 'valor_parcela', valor_depois: 750 }).acao, 'Desconto na parcela');
  assert.strictEqual(f.linhaDaParcela({ modo: 'baixa_boleto' }).acao, 'Boleto baixado no BB');
  assert.strictEqual(f.linhaDaParcela({ modo: 'cancelada' }).acao, 'Parcela cancelada');
});

test('confirmação, resultado, histórico e erros: o texto diz o que será (e o que foi) feito', () => {
  const f = puras();
  const planoTotal = {
    tipo: 'total', valor: 3000, valor_parcelas: 2000, valor_reembolso: 1000,
    itens: [{ quantidade: 2, nome: 'Poltrona Asa' }, { quantidade: 1, nome: 'Mesa Lateral' }],
    parcelas: [{ situacao: 'aberta', modo: 'baixa_boleto' }, { situacao: 'aberta', modo: 'cancelada' }, { situacao: 'paga', modo: 'reembolso' }]
  };
  const texto = semEspacoFixo(f.textoDaConfirmacao(planoTotal, 'PED55'));
  assert.match(texto, /Devolução TOTAL do pedido PED55: R\$ 3\.000,00\./);
  assert.match(texto, /Voltam ao estoque: 2× Poltrona Asa, 1× Mesa Lateral\./);
  assert.match(texto, /R\$ 2\.000,00 de desconto em 2 parcelas \(os prazos não mudam\)/);
  assert.match(texto, /alterados no Banco do Brasil agora/);
  assert.match(texto, /Reembolso ao cliente: R\$ 1\.000,00/);
  assert.match(texto, /não pode ser desfeita/);
  const semBB = f.textoDaConfirmacao({ tipo: 'parcial', valor: 500, valor_parcelas: 500, valor_reembolso: 0, itens: [{ quantidade: 1, nome: 'X' }], parcelas: [{ situacao: 'aberta', modo: 'valor_parcela' }] }, 'P1');
  assert.ok(!/Banco do Brasil/.test(semBB) && !/Reembolso/.test(semBB), 'sem boleto e sem reembolso, não promete nenhum dos dois');

  const ok = f.resumoDoResultado({ devolucao: { tipo: 'parcial', sequencia: 1, valor: 1500 }, pendencias: 0, itens: [{ quantidade: 2 }], parcelas: [{ numero_parcela: 2, modo: 'valor_parcela', desconto: 500, status: 'ok' }], reembolso: null, nota: { numero: 456 } });
  assert.deepStrictEqual([ok.titulo, ok.tipo], ['Devolução parcial nº 1 registrada', 'success']);
  assert.ok(ok.linhas.some(l => /Nota de devolução nº 456 guardada/.test(l)));
  const pendente = f.resumoDoResultado({ devolucao: { tipo: 'total', sequencia: 2, valor: 10 }, pendencias: 1, itens: [], parcelas: [{ numero_parcela: 3, modo: 'abatimento_boleto', desconto: 5, status: 'erro', erro: 'BB fora do ar' }], reembolso: { valor: 100 } });
  assert.deepStrictEqual([pendente.titulo, pendente.tipo], ['Devolução total nº 2 registrada — 1 pendência', 'error']);
  assert.ok(pendente.linhas.some(l => /NÃO FEITO: BB fora do ar/.test(l)));
  assert.ok(pendente.linhas.some(l => /Reembolso de R\$\s100,00 lançado como pendente/.test(l)));

  const linha = f.linhaDoHistorico({ sequencia: 1, tipo: 'parcial', data_devolucao: '2026-09-17', valor: 1500, valor_reembolso: 0, motivo: 'Avaria', status: 'pendencias' });
  assert.strictEqual(semEspacoFixo(linha.texto), 'nº 1 · parcial · 17/09/2026 · R$ 1.500,00 · Avaria');
  assert.deepStrictEqual([linha.classe, linha.rotulo, linha.podeTentarDeNovo], ['badge-danger', 'Com pendência', true]);
  assert.strictEqual(f.linhaDoHistorico({ status: 'concluida' }).podeTentarDeNovo, false);

  assert.match(f.mensagemDeErro(409, { sql_pendente: true }), /sql\/devolucoes\.sql/);
  assert.match(f.mensagemDeErro(403, null), /não tem permissão/);
  assert.strictEqual(f.mensagemDeErro(422, { error: 'só 1 peça pode' }), 'só 1 peça pode');
});

test('HTML do modal: overlay escondido, XML, peças, prévia, histórico, botões só com texto e a guarda escrita; não fecha clicando fora', () => {
  for (const id of ['devolucaoPedidoOverlay', 'devolucaoTitulo', 'devolucaoSubtitulo', 'devolucaoTipo', 'devolucaoCarregando', 'devolucaoBloqueio', 'devolucaoFormulario',
    'devolucaoXmlArquivo', 'devolucaoXmlEscolher', 'devolucaoXmlRemover', 'devolucaoXmlAvisos', 'devolucaoXmlNaoReconhecidos', 'devolucaoItens', 'devolucaoTudo', 'devolucaoLimpar',
    'devolucaoData', 'devolucaoMotivo', 'devolucaoObservacao', 'devolucaoPrevia', 'devolucaoValor', 'devolucaoValorParcelas', 'devolucaoValorReembolso', 'devolucaoValorPedido',
    'devolucaoParcelas', 'devolucaoPreviaAvisos', 'devolucaoResultado', 'devolucaoHistorico', 'devolucaoHistoricoLinhas', 'devolucaoMensagem', 'voltarDevolucao', 'desistirDevolucao', 'confirmarDevolucao']) {
    assert.ok(HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="devolucaoPedidoOverlay" class="hidden /.test(HTML), 'nasce escondido');
  assert.ok(/id="confirmarDevolucao"[^>]*data-perm="ped\.devolucao"[^>]*class="hidden btn-devolucao/.test(HTML), 'confirmar pede ped.devolucao, nasce escondido e é roxo');
  assert.ok(/id="devolucaoXmlArquivo" type="file" accept="\.xml/.test(HTML), 'o XML entra por um campo de arquivo');
  assert.ok(!/<button[^>]*>\s*<i class="fas/.test(HTML), 'botões só com texto');
  assert.ok(HTML.includes('z-[1200]') && !HTML.includes('onclick'));
  assert.ok(HTML.includes('Nada é enviado ao cliente'));
  assert.ok(HTML.includes('os prazos não mudam'), 'a tela diz que os prazos das parcelas ficam');
});

test('script do modal: prévia e registro em /api/devolucoes, XML junto, confirmação na caixa da casa, idempotência, sem innerHTML nem confirm()', () => {
  assert.ok(FONTE.includes('const caminhoDoPedido = () => `/api/devolucoes/pedido/${encodeURIComponent(ctx.pedidoId)}`;'));
  assert.ok(FONTE.includes('fetchApi(`${caminhoDoPedido()}/previa`, comoJson({ itens: escolhasDe(estado?.itens, quantidades) }))'), 'a conta do dinheiro é do backend');
  assert.ok(FONTE.includes('if (pedido !== pedidoDePrevia || fechado) return;'), 'só a última prévia vale');
  assert.ok(FONTE.includes('fetchApi(`${caminhoDoPedido()}/xml`, comoJson({ xml: texto }))'));
  assert.ok(FONTE.includes("observacao: el('devolucaoObservacao').value.trim(), xml, chave_idempotencia: chave"), 'o XML e a chave vão no registro');
  assert.ok(FONTE.includes('chave = novaChave();'), 'depois de registrar, chave nova');
  assert.ok(FONTE.includes('/api/devolucoes/${encodeURIComponent(devolucaoId)}/reaplicar'));
  assert.ok(FONTE.includes('window.DialogPadrao?.confirm?.({') && FONTE.includes("confirmText: 'Confirmar devolução'"));
  assert.ok(!/window\.confirm\(|showStatusConfirmDialog|innerHTML|insertAdjacentHTML/.test(FONTE));
  assert.ok(FONTE.includes('window.BotaoAcao.bind(confirmarBtn, confirmar)'), 'trava de clique duplo');
  assert.ok(FONTE.includes("botao.dataset.acaoGerida = 'true';") && FONTE.includes("botao.dataset.perm = 'ped.devolucao';"), 'o "Tentar de novo" é gerido e pede a permissão');
  assert.ok(FONTE.includes("document.removeEventListener('keydown', aoEsc)") && FONTE.includes("window.removeEventListener('modalFechado', aoFecharModal)"));
  assert.ok(!FONTE.includes("overlay.addEventListener('click'"), 'não fecha clicando fora');
  assert.ok(FONTE.includes("window.dispatchEvent(new CustomEvent('pedido:devolvido'") && FONTE.includes('window.carregarPedidos?.()'));
  assert.ok(FONTE.includes('window.Modal?.signalReady?.(overlayId)'));
  assert.ok(FONTE.includes('if (arquivo.size > TAMANHO_MAXIMO_DO_XML)'));
});

test('Visualizar pedido: Cancelar, Enviar e Devolução conforme a situação (regra do dono, 21/09/2026)', () => {
  // Os três nascem escondidos (hidden na frente): o script mostra os que valem.
  assert.ok(/id="cancelarVisualizarPedido"[^>]*data-perm="ped\.cancel"[^>]*class="hidden btn-danger[^"]*"/.test(VIS_HTML));
  assert.ok(/id="enviarVisualizarPedido"[^>]*data-perm="ped\.status\.ship"[^>]*class="hidden btn-success[^"]*"[^>]*>Enviar<\/button>/.test(VIS_HTML), 'Enviar: verde, pede a mesma permissão do "Concluir" da tabela');
  assert.ok(/id="devolucaoVisualizarPedido"[^>]*data-perm="ped\.devolucao"[^>]*class="hidden btn-devolucao[^"]*"[^>]*>Devolução<\/button>/.test(VIS_HTML), 'nasce escondido, roxo, com a guarda própria e só com texto');
  const ordem = ['cancelarVisualizarPedido', 'enviarVisualizarPedido', 'devolucaoVisualizarPedido', 'voltarVisualizarPedidoFooter'].map(i => VIS_HTML.indexOf(`id="${i}"`));
  assert.ok(ordem.every((p, i) => p > 0 && (i === 0 || p > ordem[i - 1])), 'Enviar no lugar da Devolução, antes do Voltar');
  assert.ok(/id="devolvidoPedidoChip" class="hidden badge-purple/.test(VIS_HTML));

  const botoes = recortar(VISUALIZAR, 'botoesDoPedido');
  const quais = p => Object.entries(plano(botoes(p))).filter(([, v]) => v).map(([k]) => k).join(',');
  assert.strictEqual(quais({ situacao: 'Produção' }), 'cancelar,enviar', 'em produção: Cancelar e Enviar, nada de devolução');
  assert.strictEqual(quais({ situacao: 'Enviado' }), 'devolucao', 'enviado: só Devolução, sem Cancelar');
  assert.strictEqual(quais({ situacao: 'Entregue' }), 'devolucao', 'entregue: só Devolução');
  assert.strictEqual(quais({ situacao: 'Entregue', devolucao: 'parcial' }), 'devolucao', 'parcial: só Devolução (das peças que faltam)');
  assert.strictEqual(quais({ situacao: 'Enviado', devolucao: 'total' }), '', 'devolvido por inteiro: nem Cancelar nem Devolução');
  assert.strictEqual(quais({ situacao: 'Cancelado' }), '');
  assert.strictEqual(quais({ situacao: 'Pendente' }), 'cancelar');
  assert.strictEqual(quais({ situacao: 'Em Produção' }), 'cancelar,enviar', 'grafias antigas da produção');
  const quaisComNotas = (p, notas) => Object.entries(plano(botoes(p, notas))).filter(([, v]) => v).map(([k]) => k).join(',');
  assert.strictEqual(quaisComNotas({ situacao: 'Produção' }, [{ status_fiscal: 'autorizada' }]), 'enviar', 'em produção com NF-e viva: o backend não cancela (409); só Enviar');
  assert.strictEqual(quaisComNotas({ situacao: 'Produção' }, [{ status_fiscal: 'cancelada' }]), 'cancelar,enviar', 'nota cancelada na SEFAZ: o Cancelar volta');
  assert.strictEqual(quaisComNotas({ situacao: 'Enviado' }, [{ status_fiscal: 'autorizada' }]), 'devolucao');

  // Enviar = o "Concluir" da tabela em produção: a conferência da NF-e, por cima do Visualizar.
  assert.ok(VISUALIZAR.includes("abrirPorCima('modals/pedidos/emitir-nfe.html', '../js/modals/pedido-emitir-nfe.js', 'emitirNfePedido');"));
  assert.ok(VISUALIZAR.includes("'emitirNfePedido'") && VISUALIZAR.includes("'pedido:enviado'") && VISUALIZAR.includes("'nfe:emitida'"), 'ao enviar, o Visualizar volta atualizado');

  // Gerar boletos só depois que o pedido saiu.
  const saiu = recortar(VISUALIZAR, 'pedidoJaSaiu');
  assert.strictEqual(saiu({ situacao: 'Produção' }), false);
  assert.strictEqual(saiu({ situacao: 'Enviado' }), true);
  assert.strictEqual(saiu({ situacao: 'Entregue', devolucao: 'parcial' }), true);
  assert.strictEqual(saiu({ situacao: 'Entregue', devolucao: 'total' }), false);
  assert.strictEqual(saiu({ situacao: 'Cancelado' }), false);
  const deBoleto = recortar(VISUALIZAR, 'pagaComBoleto');
  assert.strictEqual(deBoleto({ forma_pagamento: 'boleto' }), true);
  assert.strictEqual(deBoleto({ forma_pagamento: 'Boleto' }), true);
  assert.strictEqual(deBoleto({ forma_pagamento: 'pix' }), false, 'pedido em Pix: sem "Gerar boletos"');
  assert.strictEqual(deBoleto({}), false);

  const etiqueta = recortar(VISUALIZAR, 'etiquetaDaDevolucao');
  assert.deepStrictEqual(plano(etiqueta({ devolucao: 'total' })), { rotulo: 'Devolvido', badge: 'badge-purple', dateKey: 'data_devolucao' });
  assert.deepStrictEqual(plano(etiqueta({ devolucao: 'parcial' })), { rotulo: 'Parcial', badge: 'badge-purple', dateKey: 'data_devolucao' });
  assert.strictEqual(etiqueta({ devolucao: null }), null);

  assert.ok(VISUALIZAR.includes("overlay.querySelector('#cancelarVisualizarPedido')?.classList.toggle('hidden', !quais.cancelar);") && VISUALIZAR.includes("devolver.classList.remove('hidden');"));

  // Itens: sem a coluna de ações, e o "N dev." na frente do nome.
  assert.ok(!/<th[^>]*>AÇ\.<\/th>/.test(VIS_HTML), 'a coluna de ações saiu');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'pedidos.css'), 'utf8');
  assert.match(css, /#pedidoItens th:first-child,\s*#pedidoItens td:first-child\s*\{\s*width:\s*46%;/, 'o nome fica com o espaço da coluna que saiu');
  assert.doesNotMatch(css, /#pedidoItens th:last-child/, 'a última coluna agora é o TOT R$: nada de centralizar');
  assert.ok(!VISUALIZAR.includes('actions-cell'), 'as linhas também não têm mais a célula de ações');
  const tag = recortar(VISUALIZAR, 'tagDeDevolucaoDoItem');
  assert.strictEqual(tag({ quantidade: 2, quantidade_devolvida: 0 }), '');
  assert.match(tag({ quantidade: 2, quantidade_devolvida: 1 }), /badge-purple[^>]*>1 dev\.<\/span>$/);
  assert.ok(VISUALIZAR.includes('${tagDeDevolucaoDoItem(item)}${item.nome || \'\'}</td>'), 'a etiqueta vem antes do nome');
  assert.ok(!/fmtNumber\(qtd\)\}\$\{Number\(item\.quantidade_devolvida\)/.test(VISUALIZAR), 'e não mais na quantidade');
  // Por cima do Visualizar, que não fecha (o voltar da devolução cai de novo nele).
  assert.ok(VISUALIZAR.includes("abrirPorCima('modals/pedidos/devolucao.html', '../js/modals/pedido-devolucao.js', 'devolucaoPedido');"));
  assert.ok(VISUALIZAR.includes("'data_devolucao'"), 'a data da devolução é DATE: cortada como texto');
  assert.ok(VISUALIZAR.includes("const totalAtual = data.devolucao === 'parcial' ? Math.max(0, total - devolvido) : total;"), 'parcial: o Total mostra o que restou');

  const tags = recortar(VISUALIZAR, 'tagsDoEmbarque');
  const comDevolucao = plano(tags({ devolucao: 'parcial', valor_devolvido: 1500 }, [], 0, null, [{ serie: 1, numero: 456 }]));
  assert.deepStrictEqual(comDevolucao.map(t => [t.classe, semEspacoFixo(t.texto)]), [['badge-purple', 'Devolução parcial · R$ 1.500,00'], ['badge-purple', 'NF dev. 1/456']]);
  assert.deepStrictEqual(plano(tags({}, [], 0, null)), [], 'sem devolução, nenhuma tag roxa');
});

test('lista de Pedidos: etiqueta roxa Parcial/Devolvido (é o texto que o filtro lê), tag "NF dev." e filtro com as duas opções', () => {
  const naLista = recortar(PEDIDOS, 'situacaoNaLista');
  assert.deepStrictEqual(plano(naLista({ situacao: 'Entregue', devolucao: 'total' })), { rotulo: 'Devolvido', classe: 'badge-purple' });
  assert.deepStrictEqual(plano(naLista({ situacao: 'Enviado', devolucao: 'parcial' })), { rotulo: 'Parcial', classe: 'badge-purple' });
  assert.deepStrictEqual(plano(naLista({ situacao: 'Enviado' })), { rotulo: 'Enviado', classe: null });

  const tag = recortar(PEDIDOS, 'tagNotaDevolucao');
  assert.strictEqual(tag([]), '');
  assert.strictEqual(tag(null), '');
  const html = tag([{ serie: 1, numero: 456 }]);
  assert.ok(html.includes('badge-purple') && html.includes('>NF dev.<') && html.includes('NF-e de devolução do cliente: 1/456'));
  assert.ok(!/[<>]/.test(tag([{ serie: '<b>', numero: '"x' }]).replace(/<span[^>]*>|<\/span>/g, '')), 'série e número entram como número, nunca como texto cru');

  const indexar = recortar(PEDIDOS, 'indexarNotasDevolucao');
  assert.deepStrictEqual(plano(indexar([{ pedido_id: 5, numero: 1 }, { pedido_id: 5, numero: 2 }, { pedido_id: null }])), { 5: [{ pedido_id: 5, numero: 1 }, { pedido_id: 5, numero: 2 }] });

  assert.ok(PEDIDOS.includes("fetchApi('/api/devolucoes/notas').catch(() => null)"), 'sem a tabela ou sem permissão, a lista sai sem a tag');
  assert.ok(PEDIDOS.includes("const nextStatus = p.devolucao === 'total' ? null : nextStatusMap[p.situacao];"), 'devolvido por inteiro não avança de status');
  assert.ok(PEDIDOS.includes("{ label: 'Data da Devolução', value: badge.dataset.devolucao }"));
  const LISTA_HTML = ler('html', 'pedidos.html');
  assert.ok(LISTA_HTML.includes('<option value="Parcial">') && LISTA_HTML.includes('<option value="Devolvido">Devolvido</option>'));
  const CSS = ler('css', 'pedidos.css');
  assert.match(CSS, /\.badge-purple\s*\{[^}]*var\(--color-purple/);
  assert.match(CSS, /\.btn-devolucao\s*\{[^}]*background:\s*#7c3aed/);
});

test('Financeiro: a pendência "Reembolso a pagar" abre o Confirmar reembolso; a devolução pendente tenta de novo dali mesmo', () => {
  const FIN = ler('js', 'financeiro.js');
  const MODAIS = ler('js', 'modals', 'financeiro-modais.js');
  const REEMBOLSO = ler('html', 'modals', 'financeiro', 'confirmar-reembolso.html');
  assert.ok(FIN.includes("'confirmar-reembolso': { rotulo: 'Confirmar reembolso', abrir: (m, extra) => finAbrirModal('confirmar-reembolso', m, { reembolso_id: extra?.filtro?.reembolso_id ?? null }) }"));
  assert.ok(FIN.includes("'confirmar-reembolso': { html: 'modals/financeiro/confirmar-reembolso.html', overlay: 'finConfirmarReembolso' }"));
  assert.ok(FIN.includes("'reaplicar-devolucao': { rotulo: 'Tentar de novo', abrir: (m, extra) => finReaplicarDevolucao(m, extra?.filtro?.devolucao_id) }"));
  assert.ok(FIN.includes('/api/devolucoes/${encodeURIComponent(devolucaoId)}/reaplicar'));
  assert.ok(MODAIS.includes('finConfirmarReembolso: montarConfirmarReembolso,') && MODAIS.includes("'finConfirmarReembolso'"), 'montador registrado e o painel recarrega ao fechar');
  assert.ok(MODAIS.includes("fetchApi('/api/devolucoes/reembolsos?status=pendente')") && MODAIS.includes('/api/devolucoes/reembolsos/${encodeURIComponent(r.id)}/confirmar'));
  assert.ok(MODAIS.includes("confirmText: 'Confirmar reembolso'"));
  for (const id of ['finConfirmarReembolsoOverlay', 'finReembolsoQual', 'finReembolsoValor', 'finReembolsoData', 'finReembolsoForma', 'finReembolsoObservacoes', 'finReembolsoMensagem', 'finReembolsoConfirmar']) {
    assert.ok(REEMBOLSO.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="finReembolsoConfirmar"[^>]*data-perm="financeiro\.reembolso\.confirmar"/.test(REEMBOLSO));
  const rodape = REEMBOLSO.slice(REEMBOLSO.indexOf('<footer'));
  assert.ok(!/<i class="fas/.test(rodape), 'botões do rodapé só com texto');
});
