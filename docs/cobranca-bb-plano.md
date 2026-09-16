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

Armadilhas já mapeadas: o sandbox não liquida boleto; a API não devolve PDF
(a ficha é nossa, como o DANFE); o nosso número não pode colidir com os já
emitidos no convênio; datas `dd.mm.aaaa`; listagens paginadas.

## Banco (um SQL por fase)

- **Fase A** — `sql/cobranca_base.sql`: `configuracao_cobranca` (id = 1) com
  conta/convênio, ambiente, beneficiário impresso, `client_id`/`app_key` por
  ambiente, próximo sequencial por ambiente, padrões do boleto.
- Fase B — `boletos`, `boletos_eventos`, permissões `financeiro.boleto.*`,
  `pedido_parcelas` + situação/boleto atual.
- Fase E — `recebimentos`; Fase G — `competencias`, `ajustes_financeiros`, `comissoes`.

## Fases

| Fase | Entrega | Situação |
|---|---|---|
| **A** Acesso e configuração | SQL base; modal "Configuração de cobrança" (⚙ ao lado da fiscal); credenciais com secret no banco/cofre; **Testar conexão**; cliente do BB; contas do boleto conferidas com o real | **entregue em 16/09/2026** (aguardando o app no Portal Developers para o teste real) |
| **B** Registrar boletos por parcela (sandbox) | `sql/cobranca_boletos.sql` (`boletos`, `boletos_eventos`, permissões `financeiro.boleto.*`); `bbBoleto.js` (payload conferido com o boleto real), `boletos.js` (reserva do nosso número pelo UNIQUE + retry, registro, erro reaproveitável), rotas `GET/POST /api/cobranca/pedidos/:id/boletos`, `GET /api/cobranca/boletos`; caixa **"Gerar boleto das parcelas"** no modal da NF-e (marcada por padrão, gera após a autorização); coluna BOLETO nas parcelas, tag "Boletos n/n" e botão **"Gerar boletos"** no Visualizar pedido (modal próprio); **receptor do webhook** BAIXA OPERACIONAL na API pública (`Santissimo-db-API/webhooks/bbBaixaOperacional.js`, `POST /webhooks/bb/baixa-operacional/<token>`, grava a fila `boletos_eventos`) | **entregue em 16/09/2026** (aguardando credenciais sandbox para o registro real) |
| C Boleto em PDF | ficha de compensação igual à do BB (ITF-25, QR Pix, instruções), "Baixar boleto" por parcela/todos — sem e-mail ao cliente | próxima |
| D Alterações e baixa | prorrogar, abatimento, baixar (quitado por fora / cancelado / reemissão), sincronizar | — |
| E Recebimentos e conciliação | consumir a fila do webhook + consulta: parcela liquidada → recebimento → competência → CMS/Royalty; Financeiro real | — |
| F Webhook (conclusão) | cadastro da URL no portal, teste com "Testar webhook", polling como rede de segurança | receptor já no ar (fase B) |
| G Financeiro completo | ajustes, fechamento de competência, comissões, produção, relatórios reais | — |
| H Homologação e produção | credenciais reais, primeiro boleto de valor baixo, monitoramento | — |

## O que falta do dono

1. Criar a conta/aplicação no Portal Developers BB, habilitar "API de
   Cobrança [V2]" e pegar as credenciais de **sandbox** (client ID, client
   secret, app key). O secret entra só pela tela de configuração.
2. Confirmar o último nosso número usado no convênio depois do 393.
3. Webhook: decidido — roda na própria API (Santissimo-db-API). Falta gerar o
   `BB_WEBHOOK_TOKEN` no `.env` da API, reiniciar e cadastrar a URL
   `https://<host da API>/webhooks/bb/baixa-operacional/<token>` no Portal
   Developers (evento BAIXA OPERACIONAL).
4. Regras reais de CMS e Royalty e da competência (Fase E).
