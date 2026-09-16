/**
 * Modal "Emitir NF-e e enviar" (src/js/modals/pedido-emitir-nfe.js e
 * src/html/modals/pedidos/emitir-nfe.html) — etapa 4 da NF-e.
 *
 * O ✓ de um pedido em produção passa a abrir este modal em vez da pergunta
 * "alterar para Enviado?": a nota é emitida e SÓ então a situação muda. As
 * funções puras (qual nota conta, o corpo do POST, as validações dos campos,
 * a ação principal e as mensagens) são recortadas e executadas sem DOM; o
 * resto prende a anatomia do HTML e a ligação em pedidos.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'pedido-emitir-nfe.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'pedidos', 'emitir-nfe.html'), 'utf8');
const PEDIDOS = fs.readFileSync(path.join(RAIZ, 'js', 'pedidos.js'), 'utf8');

function puras() {
  const inicio = FONTE.indexOf('const STATUS_VIVOS');
  const fim = FONTE.indexOf('// fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  const trecho = FONTE.slice(inicio, fim);
  const contexto = vm.createContext({});
  return vm.runInContext(`${trecho}\n({ notaQueVale, ultimaNota, diaDoTexto, textoDaNota, lerNumero, linhasDeVolumes, corpoDaEmissao, validarCampos, classificarPendencias, rotuloAmbiente, acaoPrincipal, mensagemDeErro, pedidoJaEnviado, textoDoBoleto, resumoDosBoletos })`, contexto);
}

test('mais de um volume: uma linha por volume, guardando o que já foi digitado; o corpo e a validação levam as linhas', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.linhasDeVolumes('1', { especie: 'Caixa' })), [], 'um volume só fica nos campos gerais');
  assert.deepStrictEqual(plano(f.linhasDeVolumes('x', {})), []);
  const tres = plano(f.linhasDeVolumes('3', { especie: 'Caixa', peso_bruto: '10', peso_liquido: '9' }));
  assert.deepStrictEqual(tres, [
    { numero: 1, especie: 'Caixa', peso_bruto: '10', peso_liquido: '9' },
    { numero: 2, especie: 'Caixa', peso_bruto: '10', peso_liquido: '9' },
    { numero: 3, especie: 'Caixa', peso_bruto: '10', peso_liquido: '9' }
  ]);
  const editadas = plano(f.linhasDeVolumes('2', { especie: 'Caixa' }, [{ numero: 1, especie: 'Engradado', peso_bruto: '20', peso_liquido: '18' }]));
  assert.strictEqual(editadas[0].especie, 'Engradado', 'a linha editada sobrevive à mudança da quantidade');
  assert.strictEqual(editadas[1].especie, 'Caixa');

  const corpo = plano(f.corpoDaEmissao({ modalidade_frete: '1', volumes_quantidade: '2', volumes_especie: 'Caixa', volumes: [
    { numero: 1, especie: 'Caixa', peso_bruto: '10,5', peso_liquido: '9' }, { numero: 2, especie: ' Engradado ', peso_bruto: '', peso_liquido: '18' }
  ] }));
  assert.deepStrictEqual(corpo.transporte.volumes, [
    { numeracao: '1', especie: 'Caixa', peso_bruto: 10.5, peso_liquido: 9 }, { numeracao: '2', especie: 'Engradado', peso_bruto: null, peso_liquido: 18 }
  ]);
  assert.strictEqual(corpo.transporte.volumes_quantidade, 2);
  assert.strictEqual(f.corpoDaEmissao({ volumes: [{ especie: 'Caixa' }] }).transporte.volumes, undefined, 'uma linha só não é detalhe');

  assert.deepStrictEqual(plano(f.validarCampos({ modalidade_frete: '1', volumes_quantidade: '2', volumes: [{ especie: 'Caixa', peso_bruto: '1' }, { especie: 'Caixa' }] })), []);
  const erros = f.validarCampos({ modalidade_frete: '1', volumes_quantidade: '2', volumes: [{ especie: '', peso_bruto: 'x' }, { especie: 'Caixa', peso_liquido: '-1' }] });
  assert.match(erros.join(' '), /Volume 1: informe a espécie/);
  assert.match(erros.join(' '), /Volume 1: peso bruto inválido/);
  assert.match(erros.join(' '), /Volume 2: peso líquido inválido/);
  assert.ok(!erros.join(' ').includes('Informe a espécie dos volumes'), 'com as linhas, a espécie geral não é exigida');
  assert.ok(HTML.includes('id="emitirNfeVolumesDetalhe"') && HTML.includes('id="emitirNfeVolumesLinhas"'), 'bloco das linhas no HTML');
  assert.ok(FONTE.includes("campos.volumes_quantidade.addEventListener('input', renderizarVolumes)"), 'a quantidade redesenha as linhas');
  assert.ok(FONTE.includes('input.dataset.volume = chave;'), 'linhas montadas por createElement');
  assert.ok(FONTE.includes('campo.disabled = detalhado;'), 'com a tabela aberta, espécie e pesos gerais ficam travados; com um volume só, liberados');
});

test('lista de pedidos: DANFE verde (clicável), X/NF vermelha (cancelada) e S/NF roxa; a nota que conta por pedido', () => {
  const contexto = vm.createContext({});
  vm.runInContext([recortarFuncao(PEDIDOS, 'formatarDiaDate'), recortarFuncao(PEDIDOS, 'tagSemNota'), recortarFuncao(PEDIDOS, 'indexarNotas'), recortarFuncao(PEDIDOS, 'tagCartaCorrecao'), recortarFuncao(PEDIDOS, 'tagNota')].join('\n'), contexto);
  const { indexarNotas, tagNota, tagCartaCorrecao } = contexto;
  const idx = plano(indexarNotas([
    { id: 1, pedido_id: 55, status_fiscal: 'rejeitada' }, { id: 2, pedido_id: 55, status_fiscal: 'autorizada', numero: 2 },
    { id: 3, pedido_id: 56, status_fiscal: 'cancelada', numero: 3 }, { id: 4, pedido_id: 56, status_fiscal: 'rejeitada' },
    { id: 5, pedido_id: 57, status_fiscal: 'autorizada', numero: 5 }, { id: 6, pedido_id: 57, status_fiscal: 'autorizada', numero: 6 }
  ]));
  assert.strictEqual(idx['55'].id, 2, 'autorizada vence rejeitada');
  assert.strictEqual(idx['56'].id, 3, 'cancelada vence rejeitada');
  assert.strictEqual(idx['57'].id, 6, 'entre autorizadas, a mais nova');
  assert.deepStrictEqual(plano(indexarNotas(null)), {});

  const danfe = tagNota({ numero: 'PED1' }, { id: 2, serie: 1, numero: 2, status_fiscal: 'autorizada', ambiente: 'homologacao' });
  assert.match(danfe, /badge-success tag-danfe/);
  assert.match(danfe, /data-nota-id="2"/);
  assert.match(danfe, /title="NF-e série 1 nº 2 autorizada \(homologação\) — clique para gerar o DANFE"/);
  assert.match(danfe, />DANFE<\/span>/);
  const cancelada = tagNota({ numero: 'PED1', nfe_dispensada: true }, { id: 3, serie: 1, numero: 3, status_fiscal: 'cancelada', cancelada_em: '2026-09-15T16:00:00-03:00' });
  assert.match(cancelada, /badge-danger/);
  assert.match(cancelada, />X\/NF<\/span>/);
  assert.match(cancelada, /title="NF-e série 1 nº 3 cancelada em 15\/09\/2026"/);
  assert.match(tagNota({ nfe_dispensada: true }, null), />S\/NF<\/span>/);
  assert.match(tagNota({ nfe_dispensada: true }, { status_fiscal: 'rejeitada' }), />S\/NF<\/span>/, 'rejeitada não é nota: vale a marca do pedido');
  assert.strictEqual(tagNota({}, null), '');
  assert.ok(PEDIDOS.includes('${p.numero}${tagNota(p, notasPorPedido[String(p.id)])}</td>'));
  assert.ok(PEDIDOS.includes("fetchApi('/api/fiscal/notas').catch(() => null)"), 'as notas entram junto com os pedidos');
  assert.ok(PEDIDOS.includes("tr.querySelector('.tag-danfe')?.addEventListener('click'") && PEDIDOS.includes('window.NfeDocumentos?.gerarDanfe(Number(e.currentTarget.dataset.notaId))'));

  // Carta de correção: tag amarela "CC-e" NA FRENTE da DANFE; o clique gera o PDF da última carta.
  const comCarta = tagNota({}, { id: 2, serie: 1, numero: 2, status_fiscal: 'autorizada', ambiente: 'producao', cartas_correcao: 2, ultima_carta_seq: 2 });
  assert.ok(comCarta.indexOf('tag-cce') < comCarta.indexOf('tag-danfe'), 'CC-e antes da DANFE');
  assert.match(comCarta, /badge-warning tag-cce[^>]*data-nota-id="2" data-carta-seq="2"/);
  assert.match(comCarta, /title="2 cartas de correção registradas na NF-e série 1 nº 2 — clique para gerar o PDF da última \(nº 2\)"/);
  assert.match(comCarta, />CC-e<\/span>/);
  assert.match(tagCartaCorrecao({ id: 3, serie: 1, numero: 3, cartas_correcao: 1, ultima_carta_seq: 1 }), /title="1 carta de correção registrada na NF-e série 1 nº 3 — clique para gerar o PDF da última \(nº 1\)"/);
  assert.strictEqual(tagCartaCorrecao({ id: 3, cartas_correcao: 0 }), '');
  assert.strictEqual(tagCartaCorrecao(null), '');
  assert.doesNotMatch(danfe, /tag-cce/, 'sem carta, sem tag');
  assert.match(tagNota({}, { id: 4, serie: 1, numero: 4, status_fiscal: 'cancelada', cartas_correcao: 1, ultima_carta_seq: 1 }), /tag-cce[\s\S]*X\/NF/, 'a nota cancelada mantém a carta que teve');
  assert.ok(PEDIDOS.includes("tr.querySelector('.tag-cce')?.addEventListener('click'") && PEDIDOS.includes('window.NfeDocumentos?.gerarCartaCorrecaoPdf(Number(e.currentTarget.dataset.notaId), Number(e.currentTarget.dataset.cartaSeq))'));
});
const plano = v => JSON.parse(JSON.stringify(v));

test('notaQueVale: a mais nova entre autorizada/processando/enviando; rejeitada não conta, mas é a "última"', () => {
  const f = puras();
  const notas = [
    { id: 1, status_fiscal: 'rejeitada' }, { id: 3, status_fiscal: 'autorizada' }, { id: 2, status_fiscal: 'processando' }
  ];
  assert.strictEqual(f.notaQueVale(notas).id, 3);
  assert.strictEqual(f.notaQueVale([{ id: 1, status_fiscal: 'rejeitada' }, { id: 2, status_fiscal: 'erro_tecnico' }]), null);
  assert.strictEqual(f.notaQueVale(null), null);
  assert.strictEqual(f.ultimaNota([{ id: 1, status_fiscal: 'rejeitada' }, { id: 5, status_fiscal: 'cancelada' }]).id, 5);
});

test('textoDaNota: número, situação, data, protocolo, chave e o motivo de uma rejeição', () => {
  const f = puras();
  assert.strictEqual(f.textoDaNota({ serie: 1, numero: 2, status_fiscal: 'autorizada', data_autorizacao: '2026-09-15T15:10:01-03:00', protocolo: '131', chave_acesso: '3126', ambiente: 'homologacao' }),
    'NF-e série 1 nº 2 — autorizada em 15/09/2026 (homologação, sem valor fiscal) · protocolo 131 · chave 3126');
  assert.strictEqual(f.textoDaNota({ serie: 1, numero: 3, status_fiscal: 'rejeitada', codigo_status_sefaz: '778', motivo_sefaz: 'NCM inexistente', ambiente: 'producao' }),
    'NF-e série 1 nº 3 — rejeitada · motivo: 778 — NCM inexistente');
  assert.strictEqual(f.textoDaNota({ serie: 1, numero: 4, status_fiscal: 'processando', ambiente: 'producao', chave_acesso: 'X' }), 'NF-e série 1 nº 4 — em processamento na SEFAZ · chave X');
  assert.strictEqual(f.textoDaNota(null), '');
  assert.strictEqual(f.diaDoTexto('2026-09-15'), '15/09/2026');
  assert.strictEqual(f.diaDoTexto(''), '');
});

test('lerNumero e corpoDaEmissao: pt-BR ou ponto, vazio é null, lixo é NaN; o corpo tem transporte, pagamento e informações', () => {
  const f = puras();
  assert.strictEqual(f.lerNumero('1.234,5'), 1234.5);
  assert.strictEqual(f.lerNumero('12.5'), 12.5);
  assert.strictEqual(f.lerNumero(' 3 '), 3);
  assert.strictEqual(f.lerNumero(''), null);
  assert.ok(Number.isNaN(f.lerNumero('abc')));
  assert.deepStrictEqual(plano(f.corpoDaEmissao({
    modalidade_frete: '1', transportadora: ' Transp XYZ ', volumes_quantidade: '2', volumes_especie: 'Caixa', peso_bruto: '12,5', peso_liquido: '', tPag: '17', informacoes_complementares: ' Obra 12 '
  })), {
    transporte: { modalidade_frete: 1, transportadora_nome: 'Transp XYZ', volumes_quantidade: 2, volumes_especie: 'Caixa', peso_bruto: 12.5, peso_liquido: null },
    pagamento: { tPag: '17' },
    informacoes_complementares: 'Obra 12'
  });
  assert.strictEqual(f.corpoDaEmissao({ tPag: '1' }).pagamento.tPag, '01');
  assert.strictEqual(f.corpoDaEmissao({}).transporte.modalidade_frete, 9);
});

test('validarCampos: números inválidos, volumes sem espécie, volumes quebrados e "sem frete" com volumes', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.validarCampos({ modalidade_frete: '4', volumes_quantidade: '2', volumes_especie: 'Caixa', peso_bruto: '10', peso_liquido: '9,5' })), []);
  assert.deepStrictEqual(plano(f.validarCampos({ modalidade_frete: '4' })), [], 'tudo vazio é válido');
  assert.match(f.validarCampos({ modalidade_frete: '4', volumes_quantidade: 'x' }).join(' '), /Volumes: informe um número válido/);
  assert.match(f.validarCampos({ modalidade_frete: '4', volumes_quantidade: '2' }).join(' '), /espécie dos volumes/);
  assert.match(f.validarCampos({ modalidade_frete: '4', volumes_quantidade: '1,5', volumes_especie: 'Caixa' }).join(' '), /número inteiro/);
  assert.match(f.validarCampos({ modalidade_frete: '9', volumes_quantidade: '2', volumes_especie: 'Caixa' }).join(' '), /Sem frete \(9\) não leva volumes/);
  assert.match(f.validarCampos({ modalidade_frete: '4', peso_bruto: '-1' }).join(' '), /Peso bruto/);
});

test('acaoPrincipal, classificarPendencias, rotuloAmbiente e mensagemDeErro', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.acaoPrincipal({ pronto: true, notaViva: null })), { acao: 'emitir', rotulo: 'Emitir NF-e e enviar', consultar: false, bloqueada: false });
  assert.strictEqual(f.acaoPrincipal({ pronto: false, notaViva: null }).bloqueada, true);
  assert.deepStrictEqual(plano(f.acaoPrincipal({ pronto: true, notaViva: { status_fiscal: 'autorizada' } })), { acao: 'marcar', rotulo: 'Marcar como Enviado', consultar: false });
  assert.deepStrictEqual(plano(f.acaoPrincipal({ pronto: true, notaViva: { status_fiscal: 'processando' } })), { acao: 'aguardar', rotulo: 'Aguardando a SEFAZ', consultar: true });
  // Pedido que já saiu (aberto pelo Financeiro): emite sem mudar a situação; autorizada encerra.
  assert.deepStrictEqual(plano(f.acaoPrincipal({ pronto: true, notaViva: null, jaEnviado: true })), { acao: 'emitir', rotulo: 'Emitir NF-e', consultar: false, bloqueada: false });
  assert.deepStrictEqual(plano(f.acaoPrincipal({ pronto: true, notaViva: { status_fiscal: 'autorizada' }, jaEnviado: true })), { acao: 'concluido', rotulo: 'NF-e autorizada', consultar: false });
  assert.strictEqual(f.acaoPrincipal({ pronto: true, notaViva: { status_fiscal: 'processando' }, jaEnviado: true }).acao, 'aguardar');
  assert.strictEqual(f.pedidoJaEnviado('Enviado'), true);
  assert.strictEqual(f.pedidoJaEnviado('entregue'), true);
  assert.strictEqual(f.pedidoJaEnviado('Produção'), false);
  assert.strictEqual(f.pedidoJaEnviado(null), false);

  // A caixa "Gerar boleto": o que ela diz e o aviso depois de gerar.
  const tresSem = { ambiente: 'sandbox', pendencias: [], parcelas: [{ tem_boleto_vivo: false }, { tem_boleto_vivo: false }, { tem_boleto_vivo: true }] };
  assert.strictEqual(f.textoDoBoleto(tresSem), '2 parcelas sem boleto · ambiente homologação (teste, sem valor). Nada é enviado ao cliente.');
  assert.strictEqual(f.textoDoBoleto({ ambiente: 'producao', pendencias: [], parcelas: [{ tem_boleto_vivo: false }] }), '1 parcela sem boleto · ambiente produção. Nada é enviado ao cliente.');
  assert.strictEqual(f.textoDoBoleto({ parcelas: [{ tem_boleto_vivo: true }, { tem_boleto_vivo: true }] }), 'As 2 parcelas já têm boleto registrado.');
  assert.strictEqual(f.textoDoBoleto({ pendencias: ['Sem client_secret de homologação guardado (banco ou este computador)'], parcelas: [{ tem_boleto_vivo: false }] }), 'Não dá para gerar agora: Sem client_secret de homologação guardado (banco ou este computador)');
  assert.strictEqual(f.textoDoBoleto({ parcelas: [] }), 'O pedido não tem parcelas cadastradas.');
  assert.deepStrictEqual(plano(f.resumoDosBoletos({ registrados: 3, erros: 0, resultados: [] })), { texto: '3 boletos registrados no BB.', tipo: 'success' });
  assert.deepStrictEqual(plano(f.resumoDosBoletos({ registrados: 1, erros: 1, resultados: [{ ok: true }, { ok: false, numero_parcela: 2, erro: 'Valor inválido' }, { ok: true, ja_existia: true }] })),
    { texto: '1 boleto registrado no BB · 1 já existia · 1 com erro (parcela 2: Valor inválido).', tipo: 'error' });
  assert.deepStrictEqual(plano(f.resumoDosBoletos({ registrados: 0, erros: 0, resultados: [] })), { texto: 'Nenhum boleto para gerar.', tipo: 'info' });

  const c = f.classificarPendencias([{ chave: 'a' }, { chave: 'b', automatico: true }]);
  assert.deepStrictEqual(plano(c.bloqueiam), [{ chave: 'a' }]);
  assert.deepStrictEqual(plano(c.automaticas), [{ chave: 'b', automatico: true }]);
  assert.deepStrictEqual(plano(f.classificarPendencias(undefined)), { bloqueiam: [], automaticas: [] });

  assert.deepStrictEqual(plano(f.rotuloAmbiente('producao')), { texto: 'Produção', classe: 'badge-success' });
  assert.strictEqual(f.rotuloAmbiente('homologacao').classe, 'badge-warning');

  assert.match(f.mensagemDeErro(403, null), /permissão para emitir/);
  assert.match(f.mensagemDeErro(403, null, 'enviar'), /permissão para marcar/);
  assert.match(f.mensagemDeErro(409, { code: 'JA_ENVIADO' }, 'enviar'), /já estava enviado/);
  assert.strictEqual(f.mensagemDeErro(422, { error: 'SEFAZ 778: x', sefaz: { cStat: '778', xMotivo: 'NCM inexistente' } }),
    'A SEFAZ rejeitou a nota (778): NCM inexistente. Corrija e emita de novo — o número será reaproveitado.');
  assert.strictEqual(f.mensagemDeErro(422, { error: 'O pedido ainda não pode ser faturado.' }), 'O pedido ainda não pode ser faturado.');
  assert.match(f.mensagemDeErro(504, null), /Consultar na SEFAZ/);
  assert.strictEqual(f.mensagemDeErro(500, null), 'Não foi possível emitir a NF-e.');
});

test('HTML: conferência, campos do embarque, pendências, botões com as guardas escritas e sem fechar clicando fora', () => {
  for (const id of ['emitirNfePedidoOverlay', 'emitirNfeAmbiente', 'emitirNfeSubtitulo', 'emitirNfeCliente', 'emitirNfeValor', 'emitirNfeParcelas', 'emitirNfeItens',
    'emitirNfePendencias', 'emitirNfePendenciasLista', 'emitirNfeNotaExistente', 'emitirNfeConsultar', 'emitirNfeFrete', 'emitirNfeTransportadora', 'emitirNfeVolumes',
    'emitirNfeEspecie', 'emitirNfePesoBruto', 'emitirNfePesoLiquido', 'emitirNfePagamento', 'emitirNfeInformacoes', 'emitirNfeMensagem',
    'voltarEmitirNfe', 'cancelarEmitirNfe', 'enviarSemNfe', 'emitirNfeConfirmar']) {
    assert.ok(HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="emitirNfeConfirmar"[^>]*data-perm="financeiro\.nfe\.emit"/.test(HTML), 'emitir pede financeiro.nfe.emit');
  assert.ok(/id="enviarSemNfe"[^>]*data-perm="ped\.status\.ship"/.test(HTML), 'enviar sem nota pede ped.status.ship');
  assert.strictEqual((HTML.match(/data-emitir-nfe-campos/g) || []).length, 2, 'transporte e pagamento somem quando já há nota');
  for (const v of ['"0"', '"1"', '"2"', '"3"', '"4"', '"9"']) assert.ok(HTML.includes(`<option value=${v}>`), `modalidade ${v}`);
  for (const v of ['"15"', '"17"', '"01"', '"03"', '"99"']) assert.ok(HTML.includes(`<option value=${v}>`), `tPag ${v}`);
  assert.ok(HTML.includes('z-[1200]'), 'mesmo plano dos outros modais de pedido');
  assert.ok(!HTML.includes('onclick'), 'sem handler inline');
});

test('script: carrega a prontidão, emite antes de mudar a situação, solta os ouvintes e não usa innerHTML', () => {
  assert.ok(FONTE.includes('/api/fiscal/pedidos/${encodeURIComponent(pedidoId)}/prontidao'));
  assert.ok(FONTE.includes('/api/fiscal/pedidos/${encodeURIComponent(pedidoId)}/emitir'));
  assert.ok(FONTE.includes("body: JSON.stringify({ status: 'Enviado' })"));
  // Linha a linha (o arquivo pode ter CRLF): emitir → autorizada → boletos (se marcado) → situação.
  const emitirEm = FONTE.indexOf('async function emitir()');
  const boletosEm = FONTE.indexOf('await gerarBoletosSeMarcado(corpo.nota);', emitirEm);
  const situacaoEm = FONTE.indexOf('return estado.jaEnviado ? concluirEmissao(corpo.nota) : marcarEnviado(corpo.nota);', boletosEm);
  assert.ok(emitirEm > 0 && boletosEm > emitirEm && situacaoEm > boletosEm, 'só marca enviado com a nota autorizada; antes, os boletos se a caixa estiver marcada; pedido que já saiu só conclui');
  const marcarEm = FONTE.indexOf("if (acao === 'marcar') {");
  assert.ok(marcarEm > 0 && FONTE.indexOf('await gerarBoletosSeMarcado(notaQueVale(estado.notas));', marcarEm) > marcarEm
    && FONTE.indexOf('await marcarEnviado(notaQueVale(estado.notas));', marcarEm) > FONTE.indexOf('await gerarBoletosSeMarcado(notaQueVale(estado.notas));', marcarEm), 'marcar como enviado também gera os boletos que faltam, antes de mudar a situação');
  assert.ok(FONTE.includes('/api/cobranca/pedidos/${encodeURIComponent(pedidoId)}/boletos') && FONTE.includes("body: JSON.stringify({ parcelas: [], nota_fiscal_id: nota?.id ?? null })"), 'gera pelo POST da cobrança, ligando a NF-e');
  assert.ok(FONTE.includes('if (!caixa || caixa.disabled || !caixa.checked) return null;'), 'caixa desmarcada = nada é gerado');
  assert.ok(FONTE.includes('caixa.checked = Boolean(boletoEstado.gerar_ao_emitir_nfe) && Boolean(boletoEstado.pode_gerar);'), 'a caixa nasce marcada pela configuração, só quando dá para gerar');
  assert.ok(FONTE.includes('await carregarBoleto();'), 'o estado da cobrança é lido antes de pintar');
  assert.ok(HTML.includes('id="emitirNfeGerarBoleto" type="checkbox"') && HTML.includes('id="emitirNfeBoletoBloco" class="hidden'), 'a caixa existe e começa escondida');
  assert.ok(FONTE.includes('jaEnviado: pedidoJaEnviado(corpo.resumo?.situacao)'), 'a situação vem da prontidão');
  assert.ok(FONTE.includes('semNfeBtn.classList.toggle(\'hidden\', Boolean(viva) || estado.jaEnviado)'), 'pedido que já saiu não tem "enviar sem NF-e"');
  assert.ok(FONTE.includes("window.dispatchEvent(new CustomEvent('nfe:emitida'"), 'quem abriu (Financeiro) fica sabendo');
  assert.ok(FONTE.includes('/api/fiscal/notas/${encodeURIComponent(viva.id)}/sincronizar'));
  assert.ok(FONTE.includes("window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }))"));
  assert.ok(FONTE.includes("document.removeEventListener('keydown', aoEsc)") && FONTE.includes("window.removeEventListener('modalFechado', aoFecharModal)"));
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(FONTE), 'linhas e listas montadas por createElement/textContent');
  assert.ok(FONTE.includes('window.BotaoAcao.bind(confirmarBtn, principal)'), 'trava de clique duplo');
  assert.ok(FONTE.includes('window.DialogPadrao?.confirm?.({') && FONTE.includes("confirmText: 'Enviar sem NF-e'"), 'enviar sem nota confirma na caixa da casa');
  assert.ok(!/window\.confirm\(|showStatusConfirmDialog/.test(FONTE), 'nunca o confirm() do navegador');
  assert.ok(FONTE.includes('/api/fiscal/pedidos/${encodeURIComponent(pedidoId)}/dispensar-nfe') && FONTE.includes('if (!nota) await dispensarNfe();'), 'enviado sem nota fica sinalizado');
  assert.ok(FONTE.includes('window.carregarPedidos?.()'), 'a lista é relida depois do envio');
  assert.ok(!FONTE.includes("overlay.addEventListener('click'"), 'não fecha clicando fora');
});

function recortarFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada`);
  let i = fonte.indexOf('{', inicio);
  let nivel = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}') { nivel -= 1; if (nivel === 0) break; }
  }
  return fonte.slice(inicio, i + 1);
}

test('lista de pedidos: tag roxa "S/NF" ao lado do número quando o pedido foi enviado sem nota', () => {
  const contexto = vm.createContext({});
  vm.runInContext([recortarFuncao(PEDIDOS, 'formatarDiaDate'), recortarFuncao(PEDIDOS, 'tagSemNota')].join('\n'), contexto);
  const { tagSemNota } = contexto;
  assert.strictEqual(tagSemNota({ numero: 'PED1' }), '');
  assert.strictEqual(tagSemNota({ nfe_dispensada: false }), '');
  assert.strictEqual(tagSemNota(null), '');
  const tag = tagSemNota({ nfe_dispensada: true, nfe_dispensada_em: '2026-09-15T18:00:00.000Z' });
  assert.match(tag, /badge-neutral/, 'a cor roxa da casa (violet)');
  assert.match(tag, />S\/NF<\/span>/);
  assert.match(tag, /title="Sem nota fiscal — enviado sem NF-e em 15\/09\/2026"/);
  assert.match(tagSemNota({ nfe_dispensada: 'true' }), /title="Sem nota fiscal — enviado sem NF-e"/);
  assert.ok(PEDIDOS.includes('${p.numero}${tagNota(p, notasPorPedido[String(p.id)])}</td>'), 'a tag fica na célula do número');
});

test('visualizar pedido: tags centralizadas no rodapé com NF-e (ou sem nota), frete, volumes e pesos', () => {
  const VISUALIZAR = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'pedido-visualizar.js'), 'utf8');
  const HTML_VIS = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'pedidos', 'visualizar.html'), 'utf8');
  const total = HTML_VIS.indexOf('id="totalPedidoFooter"');
  const tags = HTML_VIS.indexOf('id="visualizarPedidoTags"');
  const botoes = HTML_VIS.indexOf('id="cancelarVisualizarPedido"');
  assert.ok(total < tags && tags < botoes, 'entre o total e os botões, sem mexer no que já existia');
  assert.match(HTML_VIS, /id="visualizarPedidoTags" class="flex flex-wrap items-center justify-center gap-2 flex-1/);

  const contexto = vm.createContext({});
  vm.runInContext(recortarFuncao(VISUALIZAR, 'tagsDoEmbarque'), contexto);
  const f = contexto.tagsDoEmbarque;
  assert.deepStrictEqual(plano(f({}, [])), []);
  const pedido = { modalidade_frete: 4, volumes_quantidade: 2, volumes_especie: 'Caixa', peso_bruto: 10, peso_liquido: '9.5', transportadora: 'X' };
  const notas = [{ id: 1, serie: 1, numero: 3, status_fiscal: 'rejeitada' }, { id: 2, serie: 1, numero: 3, status_fiscal: 'autorizada', valor_total: 4335.56, ambiente: 'homologacao' }];
  const r = plano(f(pedido, notas));
  assert.deepStrictEqual(r.map(t => t.classe), ['badge-success', 'badge-neutral', 'badge-info', 'badge-neutral']);
  assert.strictEqual(r[0].texto.replace(/ /g, ' '), 'NF-e 1/3 · autorizada · R$ 4.335,56 · homologação');
  assert.strictEqual(r[1].texto, 'Frete: próprio (destinatário)');
  assert.strictEqual(r[2].texto, 'Volumes: 2 Caixa');
  assert.strictEqual(r[3].texto, 'Peso: 10 kg bruto · 9,5 kg líq.');
  assert.deepStrictEqual(plano(f({ nfe_dispensada: true }, [])), [{ classe: 'badge-neutral', texto: 'Sem nota fiscal' }]);
  assert.strictEqual(plano(f({ nfe_dispensada: true }, [{ id: 9, serie: 1, numero: 1, status_fiscal: 'autorizada' }]))[0].texto, 'NF-e 1/1 · autorizada', 'com nota autorizada a marca "sem nota" não aparece');
  assert.strictEqual(plano(f({}, [{ id: 1, serie: 1, numero: 2, status_fiscal: 'processando' }]))[0].classe, 'badge-warning');
  assert.ok(VISUALIZAR.includes('/api/fiscal/notas?pedido_id=${encodeURIComponent(id)}') && VISUALIZAR.includes('pintarTags(tagsDoEmbarque(data, notas, cartas.length, resumoDeBoletos(boletosEstado)))'));
  assert.deepStrictEqual(plano(f({}, [{ id: 9, serie: 1, numero: 1, status_fiscal: 'autorizada' }], 2)).map(t => t.texto), ['NF-e 1/1 · autorizada', 'CC-e ×2'], 'as cartas de correção viram tag');
  assert.strictEqual(plano(f({}, [{ id: 9, serie: 1, numero: 1, status_fiscal: 'autorizada' }], 1)).at(-1).texto, 'CC-e 1');
  assert.strictEqual(plano(f({}, [], 3)).length, 0, 'sem nota, sem tag de carta');
  // Boletos das parcelas: quantas têm boleto vivo, e os pagos; sem nenhum registrado, sem tag.
  assert.deepStrictEqual(plano(f({}, [], 0, { parcelas: 3, registrados: 2, pagos: 0 })), [{ classe: 'badge-warning', texto: 'Boletos 2/3' }]);
  assert.deepStrictEqual(plano(f({}, [], 0, { parcelas: 3, registrados: 3, pagos: 1 })), [{ classe: 'badge-success', texto: 'Boletos 3/3 · 1 pago' }]);
  assert.deepStrictEqual(plano(f({}, [], 0, { parcelas: 3, registrados: 0 })), []);
  assert.deepStrictEqual(plano(f({}, [], 0, null)), []);
  assert.ok(VISUALIZAR.includes('/api/cobranca/pedidos/${encodeURIComponent(id)}/boletos') && VISUALIZAR.includes('pintarTags(tagsDoEmbarque(data, notas, cartas.length, resumoDeBoletos(boletosEstado)))'));
  assert.ok(VISUALIZAR.includes('pintarColunaDeBoletos(pagamentoBox, detalhes, boletosEstado);') && VISUALIZAR.includes("th.textContent = 'BOLETO';"), 'a coluna BOLETO entra na tabela de parcelas, por createElement');
  assert.ok(VISUALIZAR.includes("Modal.open('modals/pedidos/gerar-boletos.html', '../js/modals/pedido-gerar-boletos.js', 'gerarBoletos')"));
  assert.ok(/id="visualizarPedidoGerarBoletos"[^>]*data-perm="financeiro\.boleto\.emit"[^>]*class="hidden/.test(HTML_VIS), 'o botão "Gerar boletos" nasce escondido, com a guarda escrita');
  const contexto2 = vm.createContext({});
  vm.runInContext([recortarFuncao(VISUALIZAR, 'resumoDeBoletos'), recortarFuncao(VISUALIZAR, 'rotuloDoBoleto')].join('\n'), contexto2);
  assert.deepStrictEqual(plano(contexto2.resumoDeBoletos({ parcelas: [{ tem_boleto_vivo: true, boleto: { status: 'pago' } }, { tem_boleto_vivo: false, boleto: { status: 'erro' } }, { tem_boleto_vivo: false, boleto: null }] })), { parcelas: 3, registrados: 1, pagos: 1, com_erro: 1 });
  assert.deepStrictEqual(plano(contexto2.resumoDeBoletos(null)), { parcelas: 0, registrados: 0, pagos: 0, com_erro: 0 });
  assert.deepStrictEqual(plano(contexto2.rotuloDoBoleto({ status: 'registrado', nosso_numero: '00034534810000000393', nosso_numero_dv: '4', ambiente: 'sandbox', linha_digitavel: '001…' })),
    { classe: 'badge-success', texto: 'registrado · 00034534810000000393-4 · homologação', detalhe: '001…' });
  assert.deepStrictEqual(plano(contexto2.rotuloDoBoleto({ status: 'erro', erro: 'Valor inválido' })), { classe: 'badge-danger', texto: 'erro', detalhe: 'Valor inválido' });
  assert.deepStrictEqual(plano(contexto2.rotuloDoBoleto(null)), { classe: 'badge-neutral', texto: 'sem boleto' });
});

test('pedidos.js: o ✓ de Produção → Enviado abre o modal da NF-e; Enviado → Entregue continua na pergunta', () => {
  assert.ok(PEDIDOS.includes("if (nextStatus === 'Enviado') {") && PEDIDOS.includes('abrirEmitirNfePedido(p);'));
  assert.ok(PEDIDOS.indexOf("if (nextStatus === 'Enviado') {") < PEDIDOS.indexOf('showStatusConfirmDialog(`Deseja alterar o status para "${nextStatus}"?`'), 'a NF-e vem antes da pergunta genérica');
  assert.ok(PEDIDOS.includes("openPedidoModal('modals/pedidos/emitir-nfe.html', '../js/modals/pedido-emitir-nfe.js', 'emitirNfePedido')"));
  assert.ok(PEDIDOS.includes('window.emitirNfeContext = { pedidoId: p.id, numero: p.numero, cliente: obterNomeCliente(p.cliente_id) }'));
});
