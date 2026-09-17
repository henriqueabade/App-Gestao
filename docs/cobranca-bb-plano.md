# Boletos pela API Cobranças do Banco do Brasil — plano e andamento

Etapa 6 do Financeiro: registrar boletos por parcela do pedido na API do BB
(sandbox primeiro, produção depois), imprimir a ficha de compensação,
receber a baixa em tempo real (webhook) e, a partir do recebimento, fechar a
cadeia *parcela liquidada → recebimento → CMS / Royalty → competência*.

Sem segredos aqui: `client_secret`, senhas e chaves ficam cifrados no banco
(`segredos_app`, chave mestra do `.env`) ou no cofre local de cada máquina.

## Dados confirmados do convênio (16/09/2026)

| Dado | Valor | Origem |
|---|---|---|
| Banco | 001 — Banco do Brasil | — |
| Agência / conta | 1614-4 / 16773-8 | painel "Gerar Boleto" |
| Carteira / variação | 17 / 19 | painel "Gerar Boleto" |
| Modalidade / forma de pagamento | Simples / Único | painel "Gerar Boleto" |
| Convênio de cobrança | 3453481 (7 posições, "Tipo 4") | painel "Gerar Boleto" |
| Nosso número | `000` + convênio + sequencial de 10 dígitos, com DV (ex.: `00034534810000000393-4`) | boleto real |
| Último sequencial usado no banco | **393** (boleto de 15/09/2026) — o app começa em 394 em produção; confirmar se saíram outros depois | boleto real |
| Beneficiário impresso | SANTISSIMO DECOR LTDA, CNPJ 44.039.257/0001-22, RUA RUBI 150 - SAO JOAQUIM, CEP 32113-270, CONTAGEM - MG | boleto real |
| Espécie / aceite | DM / N | boleto real |
| Juros | 9% ao mês, enviados como **valor por dia** = valor bruto × 9% ÷ 30 (R$ 3.327,00 → R$ 9,98/dia), a partir do dia seguinte ao vencimento | dono + boleto real |
| Multa | 2% sobre o valor bruto (sem o desconto, quando há), a partir do dia seguinte | dono + boleto real |
| Protesto | 7 dias após o vencimento | dono + boleto real |
| Pagamento após o vencimento | aceito até 15 dias | dono |
| Pix | habilitado no convênio (QR Code no boleto) | dono + boleto real |
| E-mail ao cliente | **não** enviar; a geração é automática ao emitir a NF-e, com a caixa "Gerar boleto" já marcada (desmarcada, gera-se à mão depois) | dono |
| Desconto por antecipação | nenhum | dono |

Conferência das contas (`backend/cobranca/boletoCalculo.js`) contra o boleto
real: linha digitável `00190.00009 03453.481008 00000.393173 1 16950000332700`,
código de barras `00191169500003327000000003453481000000039317`, fator de
vencimento 1695 para 18/01/2027, juros R$ 9,98/dia.

## A API (o que usamos)

| Recurso | Uso |
|---|---|
| OAuth2 client_credentials (`client_id`/`client_secret` em Basic; escopos `cobrancas.boletos-info` e `cobrancas.boletos-requisicao`); `gw-dev-app-key` em toda chamada | `backend/cobranca/bbCliente.js` — token renovado sozinho, secret nunca sai do backend |
| Testes: **homologação** `oauth.hm.bb.com.br` / `api.hm.bb.com.br/cobrancas/v2` (app key em `gw-dev-app-key`), com a **conta de teste do BB** (convênio 3128557, carteira 17/35, agência 452, conta 123873 — a conta real dá 403); o "sandbox" do portal só serve ao portal. Produção `oauth.bb.com.br` / `api.bb.com.br/cobrancas/v2` (app key em `gw-app-key`) com a conta real. O `.env` pode fixar endereços | ambiente de testes gravado como `sandbox` (nome das colunas), mostrado como "Homologação"; conta de teste em `homologacao_*` (`sql/cobranca_homologacao.sql`) | ambiente por configuração, com trava `BB_AMBIENTE=sandbox` por máquina |
| `POST /boletos` (registro), `GET /boletos/{id}`, `GET /boletos` (situação A/B, exige agência e conta), `PATCH /boletos/{id}`, `POST /boletos/{id}/baixar`, Pix no boleto, `GET /boletos-baixa-operacional`, webhook BAIXA OPERACIONAL | fases B a F |
| `PATCH /boletos/{nosso número}`: leva **todos** os indicadores (`indicadorNovaDataVencimento`, `indicadorIncluirAbatimento`, `indicadorAlterarAbatimento`, `indicadorCobrarMulta`…), um com "S" e os demais "N"; `POST …/baixar` só com `numeroConvenio`; `GET /boletos/{nosso número}?numeroConvenio=` devolve `codigoEstadoTituloCobranca` (1 normal, 2–4/8 cartório, 5/9/13 protestado, 6/10/11/12/16 pago, 7 baixado; 14/15/17/18/19/21/80 transitórios), `dataRecebimentoTitulo`, `valorPagoSacado`, `codigoCanalPagamento` (1º dígito = forma, dois últimos = local; 61 = Pix), `dataMultaTitulo`, `codigoTipoBaixaTitulo` | fase D (`backend/cobranca/boletoOperacoes.js`) |

Armadilhas já mapeadas: o sandbox não liquida boleto; a API não devolve PDF
(a ficha é nossa, como o DANFE); o nosso número não pode colidir com os já
emitidos no convênio; datas `dd.mm.aaaa`; listagens paginadas.

## Banco (um SQL por fase)

- **Fase A** — `sql/cobranca_base.sql`: `configuracao_cobranca` (id = 1) com
  conta/convênio, ambiente, beneficiário impresso, `client_id`/`app_key` por
  ambiente, próximo sequencial por ambiente, padrões do boleto.
- Fase B — `sql/cobranca_boletos.sql`: `boletos`, `boletos_eventos`,
  permissões `financeiro.boleto.*`; `sql/cobranca_homologacao.sql`: conta de
  teste do BB.
- **Fase D** — `sql/cobranca_alteracoes.sql`: em `boletos`,
  `valor_abatimento`, `vencimento_original`, `motivo_baixa`,
  `observacao_baixa`, `data_baixa`, `baixado_por`, `substitui_boleto_id`,
  `sincronizado_em`. Sem essas colunas as ações da fase respondem 409.
- **Fase F** — `sql/cobranca_webhook.sql` (rodar depois dos da D e da E):
  colunas da conciliação automática e a tabela `cobranca_execucoes`.
- **Fase E** — `sql/cobranca_recebimentos.sql`: `recebimentos`,
  `configuracao_cobranca.recebimentos_desde` (nasce com a data em que o SQL
  roda) e as colunas `acao_recebimento_*` de `perm_financeiro`.
- **Fase G** — `sql/financeiro_comissoes_producao.sql` (rodar depois dos da
  D, E e F): regras editáveis (`comissao_regras`, `producao_setores` com
  Marcenaria e Pintura, `producao_valores`, `financeiro_feriados`,
  `financeiro_configuracao`), movimento (`ajustes_financeiros`,
  `producao_eventos`), fechamentos (`financeiro_fechamentos` com UNIQUE
  tipo+competência, `financeiro_fechamento_itens` com índices únicos por
  evento e por recebimento), `financeiro_pagamentos`, `financeiro_eventos` e
  as colunas `acao_comissao_view`, `acao_regras_editar`,
  `acao_ajuste_registrar`, `acao_producao_registrar`,
  `acao_competencia_fechar`, `acao_pagamento_confirmar` de `perm_financeiro`.
  Sem FK para pedidos/clientes/produtos (nada trava a exclusão de pedido).

## Fases

| Fase | Entrega | Situação |
|---|---|---|
| **A** Acesso e configuração | SQL base; modal "Configuração de cobrança" (⚙ ao lado da fiscal); credenciais com secret no banco/cofre; **Testar conexão**; cliente do BB; contas do boleto conferidas com o real | **entregue em 16/09/2026** (aguardando o app no Portal Developers para o teste real) |
| **B** Registrar boletos por parcela (sandbox) | `sql/cobranca_boletos.sql` (`boletos`, `boletos_eventos`, permissões `financeiro.boleto.*`); `bbBoleto.js` (payload conferido com o boleto real), `boletos.js` (reserva do nosso número pelo UNIQUE + retry, registro, erro reaproveitável), rotas `GET/POST /api/cobranca/pedidos/:id/boletos`, `GET /api/cobranca/boletos`; caixa **"Gerar boleto das parcelas"** no modal da NF-e (marcada por padrão, gera após a autorização); coluna BOLETO nas parcelas, tag "Boletos n/n" e botão **"Gerar boletos"** no Visualizar pedido (modal próprio); **receptor do webhook** BAIXA OPERACIONAL na API pública (`Santissimo-db-API/webhooks/bbBaixaOperacional.js`, `POST /webhooks/bb/baixa-operacional/<token>`, grava a fila `boletos_eventos`) | **entregue em 16/09/2026** (aguardando credenciais sandbox para o registro real) |
| **C** Boleto em PDF | `backend/cobranca/boletoDocumento.js` (recibo do pagador + ficha de compensação no leiaute do BB, ITF-25 em SVG — decodificado de volta no teste —, QR do Pix pela biblioteca `qrcode`, marca "HOMOLOGAÇÃO — SEM VALOR"/"PAGO"/"BAIXADO"); rotas `GET /api/cobranca/boletos/:id/documento` e `GET /api/cobranca/pedidos/:id/boletos/documento`; `src/js/utils/boleto-documentos.js` (PDF em retrato pelo Electron); "PDF" por parcela e "Boletos (PDF)" no modal Gerar boletos (o "Gerar boletos" some quando está tudo gerado); tag da coluna BOLETO clicável e "Boletos (PDF)" no Visualizar pedido — sem e-mail ao cliente | **entregue em 16/09/2026** |
| **D** Alterações e baixa | `backend/cobranca/boletoOperacoes.js`: **consultar no BB** (estado, pagamento, canal, vencimento e abatimento que valem lá; pago é final; transitório não mexe), **prorrogar** (PATCH da data; se a multa do BB ficou antes do novo vencimento, um 2º PATCH a leva; instruções refeitas; vencimento original guardado), **abatimento** (inclui/altera), **baixar** por motivo — *quitado por fora* (data, valor e forma do recebimento; a parcela fica resolvida), *cancelado* (observação obrigatória; parcela resolvida), *reemissão* (baixa e registra outro boleto para a parcela com vencimento novo, ligado por `substitui_boleto_id`; se o novo falhar, a baixa fica e tentar de novo pelo pedido usa a mesma data); baixa feita pelo próprio banco libera a parcela. Rotas `GET /boletos/:id/historico`, `POST /boletos/:id/{sincronizar,prorrogar,abatimento,baixar}`, `POST /pedidos/:id/boletos/sincronizar`; boleto de produção só é mexido com a produção valendo. Tela: modal **"Boleto"** (`boleto-detalhe.html`) aberto por "Detalhes" na lista do pedido, com situação, histórico (inclui o webhook), ações conforme `financeiro.boleto.baixa` (reemissão pede também `.emit`) e confirmação na caixa da casa; "Consultar no BB" na lista; botão "Boletos" no Visualizar quando está tudo gerado. Instruções passam a ir como texto JSON (a API remota recusava array em JSONB) | **entregue em 16/09/2026** |
| **E** Recebimentos e conciliação | `sql/cobranca_recebimentos.sql` (tabela `recebimentos` — uma parcela, um recebimento confirmado, pelo índice único parcial; `configuracao_cobranca.recebimentos_desde`; permissões `financeiro.recebimento.view/registrar/estornar`). `backend/cobranca/recebimentos.js` (do boleto, idempotente e completando a data de crédito; à mão, recusando parcela com boleto em aberto; estorno — o que veio do banco não se estorna à mão; estornar quitação por fora libera a parcela: boleto fica "quitação estornada"), `conciliacao.js` (fila do webhook casada pelo nosso número + convênio: pagamento → boleto pago + recebimento; código ≥ 10 → cancelamento, estorna e volta a cobrar; boleto já baixado aqui → alerta de pagamento em dobro; nosso número de fora → ignorado; erro fica na fila; consulta dos boletos a pagar, os nunca consultados primeiro, até 40; acerto dos pagos/quitados sem recebimento), `contasReceber.js` (parcela de pedido faturado: recebida, cancelada, a receber, em atraso pelo vencimento do boleto que vale; corte "controlar a partir de"; pendências: atraso — crítico acima de 15 dias —, a conciliar, alertas dos últimos 30 dias, boleto recusado, SQL pendente). Rotas `GET /api/cobranca/recebimentos/painel`, `GET /api/cobranca/recebimentos?visao=recebidos|a_receber|em_atraso|abertas`, `POST /api/cobranca/recebimentos` (com `baixar_boleto` baixa o boleto em aberto como quitado por fora; pede também `financeiro.boleto.baixa`), `POST /recebimentos/:id/estornar`, `POST /api/cobranca/conciliar` (`so_fila`). A consulta que acha boleto pago e a baixa "quitado por fora" lançam o recebimento. Financeiro: faixa **Contas a receber** (recebido, a receber, em atraso, boletos em aberto) e pendências de cobrança junto das fiscais; a fila do webhook é processada sozinha uma vez por visita; **Conciliar com o BB**; modal **Recebimentos** (quatro visões, estorno com motivo, boleto por cima, registrar por cima) e **Registrar recebimento** real (sem CMS/Royalty e sem comprovante, que ainda não existem). Competência = mês do dia em que o cliente pagou. Corrigido: botões montados na hora que chamam `BotaoAcao.run` precisam de `data-acao-gerida` (Notas fiscais, Sem NF-e, Atualizar lista, "em implementação" e o PDF por parcela não faziam nada) | **entregue em 16/09/2026** — CMS/Royalty aguardam as regras do dono |
| **F** Webhook (conclusão) e conciliação automática | `sql/cobranca_webhook.sql` (`configuracao_cobranca.conciliacao_automatica` / `conciliacao_intervalo_min`, tabela `cobranca_execucoes` com `chave` UNIQUE — a trava entre máquinas —, índice em `boletos_eventos.origem`). `backend/cobranca/agendaConciliacao.js`: roda no processo principal do app (ligada pelo `server.js` só no Electron); verifica a cada ~5 min e concilia uma vez por faixa de horário (padrão 60 min) — a primeira máquina que grava `auto:<intervalo>:<faixa>` roda, as outras desistem; sem sessão, sem o SQL ou desligada, não faz nada; o timer não segura o app. `execucoes.js` (registro de cada conciliação, automática ou pelo botão; limpa as de mais de 30 dias), `webhookEstado.js` + `GET /api/cobranca/webhook/estado` (URL a cadastrar **sem o token**, avisos recebidos e sua situação — na fila, conciliado, ignorado, alerta —, agenda e execuções). Configuração de cobrança: seção "Avisos de pagamento e conciliação automática" (liga/desliga, intervalo, Processar avisos agora, Conciliar agora). Financeiro: a faixa diz a última conciliação. API (Santissimo-db-API): corpo vazio responde 200 (teste do portal) e corpo em `text/*` é lido como JSON | **entregue em 16/09/2026** — falta o token no `.env` da API e o cadastro da URL no portal |
| **G** Financeiro completo | `backend/financeiro/*` + `backend/financeiroController.js` (`/api/financeiro/*`, permissões separadas: ver, editar regras, registrar ajuste, registrar produção, fechar competência, confirmar pagamento). **Regras editáveis no módulo** (modal "Regras de comissão e produção"): CMS (arquiteto) e Royalty por beneficiário e % sobre o valor líquido da parcela, para todos / um cliente / um pedido (a mais específica vale; o mesmo nível soma; 0% no pedido tira a comissão dele); setores e valor por peça (da peça ou padrão do setor); feriados da empresa (os nacionais, com a Sexta-feira Santa, o app calcula); prazos (comissão até o dia 15, produção até o 5º dia útil, sábado opcional). **Motor** (`comissoes.js`): base = parcela − abatimento do boleto − ajustes; competência = mês em que o cliente pagou; previstas, atrasadas (aging 1–15/16–30/31–60/61–90/+90), apuradas; depois do fechamento nada é reescrito — ajuste, estorno de recebimento ou pedido cancelado viram item de ajuste (devido hoje − fechado, por beneficiário, com os percentuais do fechamento) na próxima competência; saldo negativo de um beneficiário/setor passa para o mês seguinte. **Ajustes** (devolução, desconto, abatimento — no boleto em aberto vai pelo boleto —, cancelamento parcial, outros; cancelar só antes de fechar). **Produção** por item/setor/data com saldo, estorno (fechado vira evento negativo com o valor do fechamento). **Fechamento** em ordem, "tudo ou nada" (cabeçalho `fechando` → itens → `fechado`; sobra antiga é limpa), bloqueia com boleto pago não lançado ou peça sem valor; **pagamento** separado, um por fechamento. Painel real (cartões, resumos, pendências de regras/fechar/pagar/sem valor, atividade junto da fiscal), Registrar ajuste/produção, Fechar competência, Confirmar pagamento, Comissões atrasadas, Produção da competência, Detalhes da parcela e do pedido, Relatórios (visualizar, PDF e planilha CSV), prévia de CMS/Royalty no Registrar recebimento | **entregue em 16/09/2026** — regras começam vazias (comissão zero até o dono cadastrar) |
| **Devolução de pedidos** (antes da H) | Pedido enviado, entregue ou com NF-e autorizada não se cancela: devolve-se (botão roxo no Visualizar). Peças ao estoque, desconto proporcional nas parcelas em aberto (abatimento/baixa do boleto no BB), reembolso pendente no Financeiro, XML da nota do cliente guardado, ajustes de comissão da fase G, etiquetas Parcial/Devolvido e barras de cancelado/devolvido no Dashboard. Tudo em `docs/devolucao-de-pedidos.md`; SQL `sql/devolucoes.sql` | **entregue em 17/09/2026** — NF-e de entrada própria (cliente que não emite nota) fica para depois |
| **Desenhistas, produção por processo e parcela mínima** (antes da H) | "Desenhado por" obrigatório na peça (lista com + e −); Royalty repartido entre os desenhistas das peças do pedido; CMS só para o dono do cliente; os setores viraram os processos (`etapas_producao`: incluir, renomear em cascata, desligar o pagamento), valor em R$ ou % da tabela fixa, pago na proporção dos insumos que faltavam (a peça do estoque paga só o resto); botão "Regra Produção" + (i) no cadastro da peça, condição para salvar; parcela mínima na Configuração de cobrança (orçamento e pedido bloqueiam, a devolução junta as parcelas nas primeiras, abatimento abaixo do mínimo é recusado). Tudo em `docs/desenhistas-producao-parcela.md`; SQL `sql/desenhistas_producao_parcela.sql` | **entregue em 17/09/2026** |
| H Homologação e produção | credenciais reais, primeiro boleto de valor baixo, monitoramento | — |

## O que falta do dono

1. ~~Credenciais de homologação~~ (feito: conexão e registro testados em
   16/09/2026). Produção: credenciais reais na fase H.
2. Confirmar o último nosso número usado no convênio depois do 393.
3. Webhook: roda na própria API (Santissimo-db-API). Falta gerar o
   `BB_WEBHOOK_TOKEN` no `.env` da API, reiniciar e cadastrar a URL
   `https://api.santissimodecor.com.br/webhooks/bb/baixa-operacional/<token>`
   no Portal Developers (evento BAIXA OPERACIONAL), para homologação e depois
   para produção.
4. Cadastrar em "Regras de comissão e produção" quem recebe CMS e Royalty e
   os percentuais (a tabela nasce vazia), os valores por peça de cada setor e
   os feriados da empresa. Confirmar o que o app assume: base = valor da
   parcela sem juros/multa, menos abatimento e ajustes; competência = mês do
   dia em que o cliente pagou; comissão paga até o dia 15 e produção até o 5º
   dia útil do mês seguinte (sábado não conta); limite de produção = a
   quantidade do pedido (inclui as peças que saem do estoque).
5. Conferir, no primeiro aviso real do webhook, o código de cancelamento da
   baixa operacional (o app trata ≥ 10 como cancelamento).
