# Contabilidade / Fechamento contábil — diagnóstico e plano

Data: 25/09/2026. **Nada foi implementado**: este documento é só o
levantamento do que o App-Gestão já tem, o que falta e a proposta de
arquitetura e de etapas para o módulo novo, que entra no menu **abaixo do
Financeiro**. Tudo aqui cita arquivo, função, tabela, coluna e rota do sistema
real; o que não foi possível confirmar está marcado como **a confirmar**.

---

## 0. O relatório que a contabilidade recebe hoje

Os dois arquivos de exemplo (`SPHP_Relatório_MovCaixa.pdf` e `.xls`) são o
**"Extrato de Conta"** de um sistema chamado *Finance* (assinatura
"artdeco16"), da conta **"Caixa SP Holding"**, período 01/08 a 31/08/2026,
ordenado por data. O `.xls` é o mesmo relatório em Excel (arquivo binário
antigo; sem biblioteca para abri-lo aqui, assumo as mesmas colunas — **a
confirmar**).

Colunas: **Data · Número · Descrição · Débito · Crédito · Saldo · C. Custo ·
Tipo · Observação · Venc.**, com **Total do dia** e **Total do período**.

O que o relatório mostra, na prática, é um **livro-caixa com contrapartida**:
cada movimento sai em **duas linhas** —

| Linha | Exemplo do PDF |
| --- | --- |
| lado do banco | `[BB SP Holding]  531,00  Pagto Via Internet Bank BB  05/08/2026` |
| lado da classificação | `Serviços de Terceiros  -531,00  Patrimonium Contabilidade e Cons. Emp.` |

As **descrições do lado do banco** são os tipos de movimento do extrato
("Pagto Via Internet Bank BB", "PIX Recebido", "PIX Enviado", "Transferência
Cta [caixa] Déb C/C"). Os **Tipos** são a categoria: "Serviços de Terceiros",
"Aporte de Capital", "Aquisição de Bens", "Impostos e Taxas". A
**Observação** carrega o que hoje se digita à mão: fornecedor, contrato,
"Parc 50/65", placa do veículo. **C. Custo** existe na coluna, mas está vazio
no exemplo. **Venc.** é o vencimento do título.

Duas conclusões para o desenho do módulo:

1. o dado mínimo que a contabilidade precisa já é **movimento bancário +
   classificação + contrapartida + observação + vencimento**: é exatamente o
   que o motor de conciliação e a classificação vão produzir;
2. o formato "duas linhas por movimento" é uma **partida dobrada simplificada**
   (conta banco × conta de resultado/patrimônio). Se o modelo guardar
   `movimento → classificação` desde o começo, o plano de contas completo do
   futuro (seção 26 do pedido) é uma evolução, não uma reescrita.

**Atenção:** o exemplo é da conta da **SP Holding**, não da Santíssimo Decor.
Se o módulo vai fechar mais de uma empresa (CNPJ), isso muda o modelo (ver
pergunta P1).

---

## A. O que já existe, item a item

Legenda: **existe** · **parcial** · **não existe**. "Rota" = rota do backend
do app (`backend/*Controller.js`); "tabela" = tabela do Postgres lida pela
API genérica (`Santissimo-db-API/server.js`, `GET/POST/PUT/DELETE
/api/:table`, que só conhece as tabelas carregadas na partida — tabela nova
exige reiniciar a API).

### A.1 Competência mensal e fechamento (seções 3, 4, 25) — **parcial**

| O que | Onde |
| --- | --- |
| Seletor de competência (mês/ano/lupa) usado no módulo e nos modais | `src/js/utils/competencia.js`; no Financeiro `#finCompetenciaMes`, `#finCompetenciaAno`, `#finCompetenciaIr` (`src/html/financeiro.html`, `src/js/financeiro.js`) |
| Fechamento de **comissões** e de **produção** por competência, "tudo ou nada", em ordem, congelando os valores | `backend/financeiro/fechamentos.js` (`previa`, `fechar`, `pagar`, `listar`); tabelas `financeiro_fechamentos` (UNIQUE tipo + competência; status `fechando` → `fechado`), `financeiro_fechamento_itens`, `financeiro_pagamentos` (fechamento_id, tipo, competencia, valor, data_pagamento, forma, beneficiario, tipo_comissao); rotas `GET /api/financeiro/fechamentos/previa`, `GET/POST /api/financeiro/fechamentos`, `POST /api/financeiro/pagamentos` |
| O que muda depois de fechado vira **ajuste na competência seguinte**, nunca reescreve | `backend/financeiro/comissoes.js` (`apurar`), `backend/financeiro/ajustes.js`; `recebimentos.editar` recusa mudar de mês com a comissão fechada |
| Competência **financeira** do recebimento = mês do dia em que o cliente pagou | coluna `recebimentos.competencia` (`backend/cobranca/recebimentos.js`, `competenciaDe`) |
| Corte "controlar a partir de" | `configuracao_cobranca.recebimentos_desde` |
| Calendário: dia útil, feriados nacionais calculados e os cadastrados | `backend/financeiro/calendario.js`; tabela `financeiro_feriados` |

**Não existe:** um fechamento **da empresa** (extrato, NF de entrada,
pagamentos, aplicações) por competência; os estados *em conferência*,
*pronto*, *reaberto*; bloqueio de alteração com justificativa depois de
fechado (hoje só o fechamento de comissões/produção tem esse efeito, por
ajuste).

**Datas que o sistema já guarda (para separar competência fiscal de
financeira):**

| Entidade | Colunas |
| --- | --- |
| `pedidos` | `data_emissao` (timestamp), `data_aprovacao`, `embarcar_previsao`, `embarcar_real` (DATE), `data_entrega`, `data_cancelamento`, `inicio_faturamento`, `faturamento_regra` |
| `pedido_parcelas` | `numero_parcela`, `valor`, `data_vencimento` |
| `notas_fiscais` (saída) | `data_emissao`, `data_autorizacao`, `status_fiscal` |
| `notas_fiscais_externas` | `data_emissao`, `mes_emissao` |
| `boletos` | `data_emissao`, `data_vencimento`, `vencimento_original`, `desconto_ate`, `data_pagamento`, `data_baixa` |
| `recebimentos` | `data_recebimento`, `data_credito`, `competencia` |
| `financeiro_pagamentos`, `reembolsos` | `data_pagamento` |

Ou seja: para o que **entra** (vendas), as datas fiscal (emissão da NF),
de vencimento e de pagamento **já existem separadas**. Para o que **sai**
(compras), não existe nada — ver A.7.

### A.2 NF-e de saída (seção 6) — **existe**

| O que | Onde |
| --- | --- |
| Emissão na SEFAZ-MG (SOAP 4.00, certificado A1, assinatura) | `backend/fiscal/emissao.js`, `sefazCliente.js`, `assinatura.js`, `xmlNfe.js`, `certificado.js` |
| Tabelas | `notas_fiscais` (pedido_id, ambiente, serie, numero, chave_acesso, status_fiscal, natureza_operacao, data_emissao, data_autorizacao, valor_produtos, valor_desconto, valor_frete, valor_total, destinatario JSON, protocolo, recibo, **xml_envio, xml_autorizado, xml_cancelamento**), `notas_fiscais_itens` (cfop, ncm, cest, csosn, valores), `notas_fiscais_eventos`, `notas_fiscais_inutilizacoes` |
| DANFE, cartas de correção, cancelamento, inutilização, e-mail (DANFE + XML) | `fiscal/danfe.js`, `eventos.js`, `email.js`; rotas `/api/fiscal/notas/:id/{danfe,xml,cancelar,carta-correcao,email,sincronizar}` |
| NF-e **emitida fora** e informada (chave ou XML), com XML guardado e CC-e | `fiscal/externas.js`; tabelas `notas_fiscais_externas` (chave_acesso, serie, numero, data_emissao, mes_emissao, valor_total, emitente_*, destinatario_documento, protocolo, xml, ativo…), `notas_fiscais_externas_eventos`; rotas `/api/fiscal/pedidos/:id/nfe-externa*`, `GET /api/fiscal/notas-externas` |
| Painel fiscal da competência (aguardando NF-e, notas do mês, pendências) | `fiscal/painel.js`; `GET /api/fiscal/painel` |
| Vínculo pedido → NF → parcela → boleto → recebimento | `notas_fiscais.pedido_id`, `boletos.nota_fiscal_id`, `boletos.parcela_id`, `recebimentos.boleto_id`, `recebimentos.nota_fiscal_id`, `recebimentos.evento_id` |

O módulo novo **consome** isto; nada a duplicar.

### A.3 NF-e de entrada (seção 5) — **não existe** (peças reaproveitáveis)

| O que já serve | Onde |
| --- | --- |
| Leitor de XML de NF-e (chave, emitente, destinatário, itens com NCM/CFOP, vNF, nProt, notas referenciadas) | `backend/devolucoes/xmlDevolucao.js` (`lerNota`, `conferirNota`) |
| Leitura da chave de acesso (UF, mês, CNPJ do emitente, modelo, série, número) | `backend/fiscal/externas.js` (`lerChave`) |
| Uma NF **recebida** já guardada: a nota de devolução emitida pelo cliente contra a empresa | tabela `notas_devolucao` (chave_acesso, serie, numero, data_emissao, finalidade, emitente_*, destinatario_documento, chave_referenciada, protocolo, valor_produtos, valor_total, itens JSON, **xml**) — `backend/devolucoes/registro.js` |
| Certificado, TLS e assinatura para falar com a SEFAZ | `fiscal/certificado.js`, `segredoLocal.js`, `segredoBanco.js`, `sefazCliente.js` (`transporteHttps`) |

**Não existe:** o serviço **NFeDistribuicaoDFe** (Ambiente Nacional). O
`sefazCliente.js` só conhece `NFeStatusServico4`, `NFeAutorizacao4`,
`NFeRetAutorizacao4`, `NFeConsultaProtocolo4`, `NFeRecepcaoEvento4` e
`NFeInutilizacao4`, e só os endereços de **MG** (`URLS.MG`). A distribuição
usa outro host (o do Ambiente Nacional), resposta com documentos
**compactados** (`docZip`, gzip em base64) e a **manifestação do
destinatário** (evento 210200/210210/210220/210240) — esta última é o que
libera o XML completo das notas emitidas contra a empresa. Tudo isso é novo.

### A.4 NFS-e tomadas (seção 7) — **não existe**

Nada no código fala com o Sistema Nacional NFS-e / ADN nem com portais
municipais. O emitente é de Contagem/MG (`configuracao_fiscal.municipio`,
`codigo_municipio`, `inscricao_municipal` existem em
`backend/fiscal/configuracaoFiscal.js`) — se o município do prestador não
está no ambiente nacional, a nota só entra à mão. Ver I.

### A.5 CFOP e classificação (seção 8) — **parcial, só na saída**

| O que | Onde |
| --- | --- |
| CFOP de **saída** por peça e padrão | `produtos.cfop_dentro_uf/cfop_fora_uf`, `configuracao_fiscal.cfop_dentro_uf/cfop_fora_uf`, gravado em `notas_fiscais_itens.cfop` |
| Regras **em tabela, editadas no módulo** (o padrão a seguir) | `backend/financeiro/regras.js`: `comissao_regras` (nível pedido > cliente > todos), `producao_valores`, `etapas_producao`, `financeiro_configuracao` |
| "Categoria" | tabela `categoria` é de **matéria-prima/produtos** (`backend/iaController.js`, `materiaPrima.js`) — não é categoria financeira |

**Não existe:** categoria financeira, plano de contas, centro de custo, regra
de CFOP de entrada, exceções por fornecedor/produto.

### A.6 Banco do Brasil (seções 9, 15) — **existe para cobrança; não existe para extrato/pagamentos/aplicações**

| O que | Onde |
| --- | --- |
| Cliente OAuth2 client_credentials, token renovado sozinho, `gw-dev-app-key`/`gw-app-key`, homologação × produção, `fetch` injetável | `backend/cobranca/bbCliente.js` (escopos `cobrancas.boletos-info`, `cobrancas.boletos-requisicao`) |
| Configuração (uma linha, id 1): conta, convênio, ambiente, `client_id`/`app_key` por ambiente, sequencial, padrões do boleto, conta de teste, conciliação automática | tabela `configuracao_cobranca` (`backend/cobranca/configuracaoCobranca.js`); rotas `GET/PUT /api/cobranca/configuracao`, `POST/DELETE /api/cobranca/credenciais`, `POST /api/cobranca/testar` |
| `client_secret` cifrado no banco (chave mestra) ou no cofre local | `segredos_app` via `fiscal/segredoBanco.js` + `chaveMestra.js` (AES-256-GCM, `SEGREDOS_CHAVE_MESTRA` no `.env`); `fiscal/segredoLocal.js` (DPAPI do Electron); `cobrancaController.fonteDoSecret` |
| API Cobranças v2: registrar, consultar, alterar (PATCH), baixar, listar por faixa, importar boletos antigos | `bbBoleto.js`, `boletos.js`, `boletoOperacoes.js`, `importacao.js`; rotas `/api/cobranca/boletos*`, `/api/cobranca/importacao/*` |
| **Webhook** BAIXA OPERACIONAL: receptor na API pública, grava a fila e responde 200 | `Santissimo-db-API/webhooks/bbBaixaOperacional.js`, `POST /webhooks/bb/baixa-operacional/<token>` (`BB_WEBHOOK_TOKEN` no `.env` da API); fila = `boletos_eventos` (origem `webhook`, `processado_em`, hash sha256 do corpo como chave idempotente) |
| Conciliação dos **nossos boletos** (fila + consulta + acerto), automática por faixa de horário com trava entre máquinas | `conciliacao.js`, `agendaConciliacao.js`, `execucoes.js` (`cobranca_execucoes`), `webhookEstado.js`; `POST /api/cobranca/conciliar`, `GET /api/cobranca/webhook/estado` |

A separação pedida na seção 15 **já é respeitada**: o webhook de cobrança só
mexe em `boletos`/`recebimentos`; nada dele serve a pagamento de fornecedor.

**Não existe:** extrato de conta (nenhum "extrato" no código além das
movimentações de estoque), OFX, comprovantes, pagamentos, investimentos. No
Portal Developers do BB existem produtos separados para isso (extratos,
pagamentos, investimentos/aplicações), com **contratação, escopo OAuth e
credenciais próprios** — **a confirmar** no portal quais a empresa tem ou
pode contratar. O `bbCliente.js` é reaproveitável (a URL da API e os escopos
são parâmetros), mas cada produto precisa do seu par de endereços.

### A.7 Contas a pagar e fornecedores (seção 13) — **não existe**

Não há cadastro de fornecedor, compra, título a pagar nem despesa. A palavra
"fornecedor" aparece só no módulo IA (`backend/iaEsquemas.js`, lista de compra
de insumos) e como rótulo em `src/js/relatorios.js`.

O que existe de **dinheiro que sai**, e que o módulo deve consumir, não
recriar:

| O quê | Onde | Observação |
| --- | --- | --- |
| Pagamento de comissões e de produção por competência fechada | `financeiro_pagamentos` (`fechamentos.pagar`, `POST /api/financeiro/pagamentos`) | um pagamento por fechamento/beneficiário; `data_pagamento`, `forma` |
| Reembolso de devolução | `reembolsos` (devolucao_id, pedido_id, cliente_id, valor, status `pendente`/pago, data_pagamento, forma) — `backend/devolucoes/reembolsos.js`, `POST /api/devolucoes/reembolsos/:id/confirmar` | nasce pendente na devolução |
| Compra de insumo | `materia_prima.preco_unitario`/`data_preco` e os movimentos (`entrada_manual`, `entrada_pedido`, `ajuste_preco` em `backend/materiaPrima.js`; `estoque_movimentos` em `estoqueLedger.js`) | **sem fornecedor, sem NF, sem valor pago**: é estoque, não financeiro |
| Leitura de listas de compra por IA | `iaLeitura.js`, `iaEstruturacao.js`, `iaReconciliacao.js` | cadastra/atualiza insumos; o arquivo **não fica guardado** (só o texto extraído em `ia_extracao_arquivos`) |

### A.8 Contas a receber (seção 14) — **existe**

`pedido_parcelas` → `boletos` (BB) / `boletos_externos` (de fora) /
`ordens_pagamento` (Pix, cartão para uma data) → `recebimentos` (uma parcela,
um recebimento confirmado; origem `boleto`, `quitado_por_fora`, `manual`;
`valor_parcela`, `valor_abatimento`, `valor_recebido`, `valor_encargos`,
`competencia`, `status`, `chave_idempotencia`). Estado de cada parcela em
`backend/cobranca/contasReceber.js` (`parcelasDosPedidos`: recebida /
cancelada / a_receber, atraso pelo dia útil em `vencimento.js`,
`a_receber_hoje` com encargos). Rotas `GET /api/cobranca/recebimentos/painel`,
`GET /api/cobranca/recebimentos?visao=`, `POST /api/cobranca/recebimentos`,
`GET /api/cobranca/pedidos/:id/pagamentos`. Reutilizar integralmente.

### A.9 Extrato, OFX, comprovantes, aplicações (seções 10, 11, 16) — **não existe**

Nada de extrato, OFX, comprovante ou aplicação. Onde o sistema guarda
**arquivos** hoje (para reaproveitar o padrão):

| Onde | Como | Limite |
| --- | --- | --- |
| XMLs de NF-e | colunas texto (`notas_fiscais.xml_*`, `notas_fiscais_externas.xml`, `notas_devolucao.xml`) | corpo da API 1 MB (`express.json({ limit: "1mb" })` na DB API); o backend do app aceita 3 MB (30 MB só em `/api/historico-social/` e CSV) |
| Anexos do histórico social | `historico_anexos` (nome, mime, tamanho, partes) + `historico_anexo_partes` (base64 de até **512 KB** cada) — `backend/historicoSocial.js` (`salvarAnexo`, `lerAnexo`) | qualquer tamanho, em partes |
| Foto de perfil | multer + `sharp` na DB API (`/api/perfil/imagem`, pasta `imagens/perfis`) | só imagem |
| Arquivos da IA | não guardados (só o texto) | — |

Não há **hash** de arquivo em lugar nenhum (só o sha256 do corpo do webhook e
o do token do dashboard). Não há distinção "documento oficial × gerado pelo
app" — hoje o app gera DANFE, boleto e relatórios (impressos pelo Electron) e
os identifica pela marca de homologação, não por metadado.

### A.10 Pagamentos consolidados (seção 12) — **não existe**

As relações existentes são 1:1 (`recebimentos` ↔ parcela) ou 1:N fixas
(`financeiro_pagamentos` por beneficiário). Não há nada que ligue um lançamento
bancário a várias liquidações.

### A.11 Motor de conciliação (seção 17) — **parcial**

| O que | Onde | Nível de confiança |
| --- | --- | --- |
| Aviso do BB ↔ boleto pelo nosso número + convênio; pagamento em dobro vira **alerta**; nosso número de fora é **ignorado** | `backend/cobranca/conciliacao.js` (`boletoDoAviso`, `confirmarPagamento`, `cancelarPagamento`) | chave exata → automático |
| Boleto importado ↔ parcela por valor e proximidade de vencimento | `importacao.js` (`sugerirParcela`, `distanciaEmDias`) | **sugestão**, o usuário confirma |
| Itens da NF do cliente ↔ peças do pedido | `devolucoes/xmlDevolucao.js` (`casarItens`) | único candidato → automático; senão pergunta |
| Filosofia "a decisão é sugestão, não sentença" | `backend/iaReconciliacao.js` | cadastrar/atualizar/ignorar com motivo |

Não há motor genérico **movimento bancário ↔ documento/parcela/título**, nem
os estados *auto-conciliado / sugestão / pendente / ignorado justificadamente*.

### A.12 Pendências (seção 19) — **parcial**

Já existem quatro fontes de pendência, cada uma com a sua forma:

- cobrança: `contasReceber.resumir().pendencias` (`em_atraso`, `conciliar`,
  `alertas`, `boletos_erro`, `recebimentos_sql`), com `nivel`, `chave`,
  `titulo`, `descricao`, `acao`, `destino`;
- fiscal: `fiscal/painel.pendenciasFiscais`;
- financeiro: pendências do painel (`backend/financeiro/painel.js`: regras
  vazias, competência a fechar, pagamento a confirmar, peça sem valor);
- prontidão da NF-e: `fiscal/prontidao.avaliar` → lista com **origem**
  (emitente, certificado, cliente, peça, pedido), `chave`, `mensagem` e
  `automatico: true` para o que a emissão resolve sozinha.

Esse último formato (origem + chave + mensagem + bloqueia/automático) é o
modelo certo para a central de pendências. Para avisar pessoas existem as
**tarefas automáticas** (`backend/tarefasAutomaticas.js`,
`tarefasServico.criarTarefaAutomatica`, com regra ↔ permissão e desligamento
por pessoa) e o **sino** (`notificacoes`).

### A.13 Dossiê (seção 20) — **parcial**

Já existem visões agregadas: `backend/financeiro/detalhes.js` (linha do tempo
da parcela e do pedido: NF, boleto, recebimento, ajustes, comissão), rotas
`GET /api/financeiro/parcelas/:pedidoId/:numero`, `GET
/api/financeiro/pedidos/:id`, `GET /api/cobranca/boletos/:id/historico`, `GET
/api/fiscal/notas/:id`. O dossiê pode ser uma **visão**, sem tabela.

### A.14 Relatórios e pacote (seções 21, 22, 23) — **parcial**

- Relatórios do Financeiro por chave, em tela, **PDF** (o Electron imprime o
  HTML — `src/js/utils/acoes-csv.js`, `nfe-documentos.js`,
  `boleto-documentos.js`) e **CSV**: `backend/financeiro/relatorios.js`, `GET
  /api/financeiro/relatorios/:chave`, modal `relatorios.html`.
- `exceljs` está nas dependências (`package.json`) — planilha `.xlsx` é
  possível. **Não há** biblioteca de ZIP nem de OFX.
- E-mail com anexos existe (`fiscal/email.js`: SMTP da configuração fiscal,
  senha no cofre/`segredos_app`; `POST /api/fiscal/notas/:id/email`). O app
  tem ainda um segundo SMTP no `.env` (`src/email/transporter.js`,
  `SMTP_*`) para a redefinição de senha.

### A.15 Auditoria (seção 24) — **parcial e espalhada**

| Trilha | Tabela | Quem grava |
| --- | --- | --- |
| Financeiro (ajuste, produção, fechamento, pagamento, regra, devolução, reembolso) | `financeiro_eventos` (tipo, descricao, pedido_id, numero_parcela, referencia_id, valor, dados JSON, usuario_id) | `backend/financeiro/auditoria.js` (`registrar`, `recentes`) |
| Boletos (reserva, registro, prorrogação, abatimento, baixa, consulta, webhook) | `boletos_eventos` | `cobranca/boletos.js`, `boletoOperacoes.js` |
| NF-e (criada, enviada, autorizada, rejeitada, cancelada, CC-e) | `notas_fiscais_eventos`, `notas_fiscais_externas_eventos` | `fiscal/emissao.js`, `eventos.js`, `externas.js` |
| Pedido (conversão, abatimento, cancelamento, edição — inclui a correção das datas do envio) | `pedido_historico_eventos` | `estoqueLedger.registrarEventoDoPedido` |
| Execuções da conciliação | `cobranca_execucoes` | `cobranca/execucoes.js` |
| Ajuste de valor do pedido (quem, quando, de/para, motivo) | `pedidos.ajuste_historico` (JSON) | `pedidoParcelas.historicoComMais` |
| Histórico social (comentários com versões, exclusão por marca) | `*_historico`, `historico_comentario_versoes` | `historicoSocial.js` |
| "Última alteração" do usuário (módulo + frase) | `usuarios` | `main.js` (`API_MODULE_TITLES`), `backend/userActivity.js` |

**Não existe:** um registro genérico "campo X mudou de A para B" por
registro; "dado original × dado alterado" para dados importados; hash de
documento.

### A.16 Segurança (seção 28) — **existe**

Segredos nunca chegam ao renderer: `sanitizarSaida.js` tira senha/token de
qualquer resposta; `certificado.resumo()` devolve só titular/validade;
`segredoBanco` + `chaveMestra` (banco, cifrado) e `segredoLocal` (DPAPI) para
certificado, senha do SMTP e `client_secret`; `privateFileGuard.js` bloqueia
`file:` fora do app. Padrão a repetir para qualquer credencial nova (extrato,
NFS-e).

### A.17 Onde um módulo novo entra

- `src/html/menu.html`: item `.sidebar-item[data-page]` (o Financeiro está na
  linha do `fa-hand-holding-usd`; o novo entra logo abaixo);
- `src/js/menu.js`: `MODULE_LABELS`; `loadPage` carrega
  `html/<page>.html`, `css/<page>.css`, `js/<page>.js`;
- `src/js/permissoes.js` esconde a barra lateral sem a permissão do módulo;
- `backend/permissionsCatalog.js`: bloco do módulo (`code`, `label`, `page`,
  `table: perm_<modulo>`, `actions` com `column`) + `src/html/modals/usuarios/permissoes.html` + SQL da tabela `perm_*` — três lugares (é a regra da casa);
- backend: um `contabilidadeController.js` montado em `server.js`
  (`app.use('/api/contabilidade', …)`), com `exigirPermissao`.

---

## B. O que reutilizar (onde evitamos duplicar)

| Necessidade | Reutilizar | Não criar |
| --- | --- | --- |
| Clientes, pedidos, parcelas, NF-e de saída, boletos, recebimentos, ordens | tudo de A.2 e A.8, lido pelas rotas/módulos existentes | segunda estrutura de parcela, de recebimento ou de nota |
| Pagamentos de comissão/produção e reembolsos | `financeiro_pagamentos`, `reembolsos` | outro "contas a pagar" para isso: o módulo só **concilia** esses pagamentos com o banco |
| Competência, calendário, dia útil | `competencia.js`, `financeiro/calendario.js`, `financeiro_feriados` | outro calendário |
| Cliente BB, credenciais, segredos | `bbCliente.criar` (com URL/escopos do produto novo), `configuracaoCobranca` (credenciais), `segredoBanco`/`segredoLocal` | outra integração OAuth |
| Webhook de cobrança e conciliação de boletos | `conciliacao.js` continua dono dos boletos | motor paralelo para boletos |
| Leitura de XML de NF-e, chave de acesso, certificado | `xmlDevolucao.lerNota`, `externas.lerChave`, `certificado.js` | outro parser |
| Regras em tabela editadas na tela | padrão de `financeiro/regras.js` | CFOP no JavaScript |
| Pendências com origem/chave/automático | formato de `prontidao.avaliar` e `contasReceber.resumir` | — |
| Avisos | tarefas automáticas + sino | outro sistema de aviso |
| Trilha de auditoria | `financeiro/auditoria.js` como modelo (ou uma `contabil_eventos` no mesmo formato) | — |
| Arquivos grandes | padrão de partes de 512 KB de `historicoSocial.js` | armazenamento novo fora do banco (por ora) |
| Relatórios PDF/CSV, `exceljs` | `financeiro/relatorios.js`, `acoes-csv.js` | — |
| E-mail | `fiscal/email.js` (SMTP da configuração fiscal) | outro SMTP |

Duas decisões de **não** estender:

- **`notas_fiscais` não vira tabela de NF de entrada.** Ela é a numeração da
  própria empresa (UNIQUE ambiente/série/número, `chave_idempotencia`,
  ciclo `rascunho → enviando → autorizada/rejeitada → cancelada`, reserva de
  número). Uma nota recebida não tem nada disso. Melhor uma tabela própria de
  documentos fiscais **recebidos**, com o mesmo formato de colunas de
  `notas_fiscais_externas` (que já é "nota que não emitimos aqui").
- **`clientes` não vira cadastro de fornecedor.** Um cadastro de terceiros
  chaveado por CNPJ/CPF, criado sozinho a partir do emitente da NF-e, é mais
  simples e não polui a lista de clientes.

---

## C. Gaps (o que realmente falta)

1. Fechamento **contábil** da empresa por competência, com estados e
   reabertura.
2. **Fornecedores** (terceiros) e **títulos a pagar** com parcelas.
3. **NF-e de entrada**: tabela, leitura por XML/chave à mão e, depois,
   busca automática (DistribuicaoDFe + manifestação).
4. **NFS-e tomadas**: tabela, entrada à mão e busca no ambiente nacional.
5. **Contas financeiras** (conta corrente, caixa, aplicação) e **movimento
   bancário** (extrato) — por OFX e/ou API.
6. **Motor de conciliação** movimento ↔ liquidação(ões), com composição 1:N e
   N:1, estados e justificativa.
7. **Classificação**: plano de contas (simples no início), centros de custo,
   regras (CFOP, fornecedor, descrição bancária, natureza), exceções e
   aprendizado a partir das resoluções manuais.
8. **Aplicações**: aplicação, resgate, rendimento, IR/IOF, transferência
   interna — nunca como receita/despesa operacional.
9. **Documentos/evidências**: arquivo genérico (XML, PDF, OFX, comprovante)
   com hash, origem (oficial × interno) e vínculos.
10. **Pendências** unificadas (bloqueiam ou avisam) + "ignorado com
    justificativa".
11. **Dossiê** (visão) e **relatório mensal** novo, **pacote** (ZIP) e
    **envio**.
12. Auditoria contábil (o que foi capturado, alterado, reclassificado,
    reaberto).

---

## D. Modelo conceitual (sem SQL)

Princípio: **documento + evento financeiro + conciliação + classificação +
competência + evidência + auditoria**. Cada coisa numa entidade; o relatório
é uma leitura.

```
competencia_contabil ───────┐ (o mês; estados; totais; pacote)
                            │
documento fiscal            │   título (o que se deve / o que nos devem)
 ├ NF-e de saída  (existe)  │    ├ pedido_parcelas       (existe)
 ├ NF-e de entrada (novo) ──┼──► ├ titulo_pagar + parcelas (novo: NF entrada, NFS-e,
 ├ NFS-e tomada    (novo) ──┘    │   imposto, consórcio, aporte, sem documento…)
 └ NF de devolução (existe)      └ reembolsos, financeiro_pagamentos (existem)
                                             │
                    liquidação (o dinheiro entrou/saiu)
                     ├ recebimentos            (existe)
                     ├ pagamento de título     (novo)
                     ├ financeiro_pagamentos   (existe)
                     └ reembolsos pagos        (existe)
                                             │
movimento_bancario (extrato) ◄── conciliacao_vinculo ──┘   1 movimento : N liquidações
   │  (conta_financeira, data, valor, descrição,             N movimentos : 1 liquidação
   │   identificadores oficiais, origem, hash)               (parcial, consolidado)
   ├ classificacao (conta do plano, centro de custo, regra que decidiu, quem, quando)
   └ evidencias (documento_arquivo: XML/PDF/OFX/comprovante, sha256, oficial×interno)
```

Entidades **novas** (nomes provisórios):

| Entidade | O que guarda | Observações |
| --- | --- | --- |
| `competencia_contabil` | competência `AAAA-MM`, status (`aberta`, `em_conferencia`, `com_pendencias`, `pronta`, `fechada`, `reaberta`), contagens, quem fechou/reabriu, justificativa, pacote gerado/enviado | uma por mês (por empresa, se houver mais de uma — P1) |
| `terceiro` (fornecedor/prestador) | CNPJ/CPF, razão social, nome, cidade/UF, IE/IM, e-mail, tipo (fornecedor, prestador, banco, governo, sócio…), padrão de classificação | criado sozinho a partir da NF/NFS-e; conferido com `clientes.cnpj` para o cliente que também é fornecedor (só aviso) |
| `documento_fiscal_recebido` (+ itens, + eventos) | tipo (`nfe`, `nfse`, `cte`…), chave, número/série, emitente (→ terceiro), data de emissão (**competência fiscal**), valores, impostos, CFOP/NCM por item, situação SEFAZ/manifestação, protocolo, origem (`distribuicao`, `xml`, `chave`, `manual`, `adn`), NSU | o XML vai para `documento_arquivo`; o NF de devolução do cliente continua em `notas_devolucao`, só é listado junto |
| `titulo_pagar` (+ parcelas) | terceiro, documento (opcional), descrição, valor, natureza, classificação padrão, parcelas com vencimento, boleto (linha digitável) e situação | o "contas a pagar"; uma NF-e de entrada gera um título com as duplicatas do XML (`cobr/dup`) |
| `liquidacao` de título | parcela do título, data, valor pago, encargos, forma, comprovante | o par de `recebimentos` para o lado que sai; as outras liquidações que já existem não se movem |
| `conta_financeira` | banco/caixa/aplicação, agência, conta, moeda, saldo inicial e data, produto de aplicação, ativa | a conta do convênio de cobrança (`configuracao_cobranca`) vira a primeira |
| `extrato_importacao` | conta, período, origem (`ofx`, `api`, `manual`), arquivo, quantas linhas, quem/quando | lote de captura; o OFX/PDF original vira evidência |
| `movimento_bancario` | conta, data, valor (sinal), tipo do banco, descrição, documento, identificadores oficiais (EndToEndId, nosso número, número do documento, autenticação — só se o banco der), saldo após, `hash` idempotente (conta + data + valor + identificadores), estado da conciliação (`auto`, `sugerido`, `pendente`, `conciliado`, `ignorado`), estado da classificação | **o dado nunca é editado**: correção vira novo registro/vínculo |
| `conciliacao_vinculo` | movimento ↔ (tipo da liquidação, id, valor da parte), confiança, critério que casou, quem confirmou, quando, justificativa de ignorar | composição 1:N e N:1; soma das partes confere com o movimento |
| `plano_contas` | código, nome, tipo (receita, despesa, custo, ativo, passivo, patrimônio, **transferência interna**), pai, ativa | começa com o que o relatório de hoje usa ("Serviços de Terceiros", "Aquisição de Bens", "Impostos e Taxas", "Aporte de Capital"…) |
| `centro_custo` | código, nome, ativo | opcional |
| `regra_classificacao` | condição (CFOP, terceiro, descrição bancária contém, natureza, faixa de valor, tipo de movimento), resultado (conta, centro de custo, tratamento: despesa/custo/estoque/imobilizado/transferência), prioridade, ativa, origem (`manual`, `aprendida`), quem/quando | a "tabela de regras de CFOP" da seção 8, generalizada; a mais específica vence |
| `classificacao` (do movimento/documento) | alvo (movimento ou documento ou título), conta, centro de custo, regra aplicada (ou manual), quem, quando, anterior | reclassificar grava outra linha |
| `documento_arquivo` (+ partes) | nome, mime, tamanho, sha256, origem (`oficial`: SEFAZ/BB/OFX/portal; `interno`: gerado pelo app), quem/quando; vínculos polimórficos (movimento, documento fiscal, liquidação, competência) | partes de 512 KB como `historico_anexo_partes` |
| `pendencia_resolucao` | pendência (chave calculada), decisão (`ignorada`, `resolvida`), justificativa, quem/quando | as pendências em si são **calculadas** (como a prontidão); só a decisão humana é gravada |
| `contabil_eventos` | igual a `financeiro_eventos` (tipo, descrição, referência, dados antes/depois, usuário) | ou reaproveitar `financeiro_eventos` com tipos novos — decidir na etapa 1 |

O que **muda** no que existe (extensão, não duplicação): `recebimentos`,
`financeiro_pagamentos` e `reembolsos` **não ganham colunas** — o vínculo com
o banco fica em `conciliacao_vinculo`. `configuracao_cobranca` continua a
dona das credenciais de cobrança; credenciais de outros produtos BB entram no
mesmo padrão (id + app key na configuração, secret em `segredos_app`).

---

## E. Fluxos principais

- **NF-e de entrada (à mão):** XML ou chave → `xmlDevolucao.lerNota`/`lerChave`
  → terceiro (cria se não existe) → documento fiscal recebido + itens →
  título a pagar com as duplicatas (`cobr/dup` do XML; sem elas, uma parcela
  no vencimento informado) → classificação por regra (CFOP + terceiro) ou
  pendência "NF sem regra" → XML vira evidência oficial. Competência fiscal =
  mês de emissão.
- **NF-e de entrada (automática):** job por NSU no DistribuicaoDFe → resumo
  (`resNFe`) vira documento "a manifestar" → manifestação (ciência/confirmação)
  → XML completo (`procNFe`) → mesmo caminho acima. Nota desconhecida
  (emitida contra nós por engano) → manifestar "desconhecimento" à mão.
- **NF-e de saída:** nada muda; o fechamento lista `notas_fiscais` da
  competência de emissão com XML/DANFE, pedido, parcelas e recebimentos.
- **NFS-e tomada:** ADN (quando disponível) → documento fiscal recebido
  (tipo `nfse`, valores de ISS) → título a pagar; município fora → pendência
  "NFS-e não localizada" com entrada à mão (PDF + dados).
- **Conta a pagar sem documento** (imposto, consórcio, aporte, tarifa): título
  criado à mão ou por regra recorrente; classificação direta.
- **Pagamento de título:** liquidação (data, valor, forma) → aguarda o
  movimento bancário → conciliação. Comprovante: arquivo anexado (até o BB
  confirmar o oficial).
- **Recebimento:** já existe (boleto/webhook, quitado por fora, manual) → o
  movimento bancário do crédito casa com o `recebimento` (nosso número no
  descritivo do crédito, valor, data).
- **Boleto emitido:** já existe; no fechamento entra como evidência do
  recebimento (PDF interno) e o crédito do banco como oficial.
- **Pix/transferência:** movimento bancário com EndToEndId → casa com
  liquidação de título (sai) ou recebimento (entra) por valor/data/CNPJ.
- **Extrato:** importação OFX (hoje) ou API (depois) → movimentos com hash
  idempotente → motor de conciliação roda → pendências.
- **Pagamento consolidado:** um débito de R$ 10.000 → o motor procura
  combinação de liquidações do dia com soma exata (2.000 + 3.000 + 5.000) →
  sugestão; o usuário confirma → três vínculos com valor da parte; o pacote
  mostra "composição".
- **Aplicação/resgate/rendimento:** movimento entre `conta_financeira`
  corrente e `conta_financeira` de aplicação, classificado como
  **transferência interna** (não é receita/despesa); rendimento, IR e IOF são
  movimentos próprios com conta do plano de resultado financeiro.
- **Conciliação:** ver K (motor).
- **Fechamento:** pendências zeradas (as bloqueantes) → status `pronta` →
  fechar (congela contagens e totais, registra evento) → alterações depois
  exigem reabertura com justificativa ou entram como ajuste na seguinte.
- **Envio à contabilidade:** pacote (ZIP) → download ou e-mail (SMTP fiscal)
  → evento com quem/quando/para quem/hash do pacote.

---

## F. Áreas do módulo (telas)

| Área | Responsabilidade |
| --- | --- |
| **Fechamento do mês** (tela principal) | seletor de competência; checklist por fonte (extrato, NF-e entrada/saída, NFS-e, pagamentos, recebimentos, aplicações, conciliação, classificação) com OK/pendente; contagem de pendências; ações Sincronizar, Conciliar, Fechar, Reabrir, Gerar pacote, Enviar |
| **Pendências** | lista única, filtrável por tipo e fonte, com a ação que resolve cada uma (abre o modal certo) e "ignorar com justificativa" |
| **Movimentações (extrato)** | movimentos por conta e período, estado da conciliação e da classificação; importar OFX; conciliar/desfazer; classificar; compor |
| **Documentos fiscais** | entradas, saídas, NFS-e; manifestação; XML/DANFE; vínculo com títulos e pedidos |
| **Contas a pagar** | terceiros, títulos e parcelas; registrar pagamento; comprovante |
| **Classificação e regras** | plano de contas, centros de custo, regras (CFOP, fornecedor, descrição), teste de regra, regras aprendidas para aprovar |
| **Contas financeiras e aplicações** | contas, saldos, aplicações, transferências internas |
| **Dossiê** | por documento/título/movimento: tudo vinculado + auditoria |
| **Relatórios** | relatório mensal (tela, PDF, XLSX), conciliação bancária, pendências |
| **Configurações** | credenciais de extrato/NFS-e (secret no cofre), competência inicial, o que bloqueia o fechamento, destinatário da contabilidade |

O Dashboard (`backend/dashboardFinanceiro.js`) pode ganhar um cartão
"Fechamento do mês: X% concluído" depois.

---

## G. Ações e o que acontece no backend

| Ação | Backend |
| --- | --- |
| Sincronizar banco | job de extrato: OFX enviado ou API (quando houver); insere movimentos novos pelo hash; registra `extrato_importacao`; guarda o arquivo original como evidência; dispara conciliação |
| Sincronizar documentos fiscais | DistribuicaoDFe por NSU (certificado, AN); ADN NFS-e; cria documentos recebidos e títulos; guarda XML |
| Manifestar | evento de manifestação no AN; atualiza situação; libera o XML completo |
| Conciliar automaticamente / Reprocessar | motor sobre os movimentos não conciliados; grava vínculos `auto` só com confiança total; sugestões ficam `sugerido` |
| Confirmar / rejeitar sugestão; compor | grava `conciliacao_vinculo` (N partes), confere a soma, evento de auditoria |
| Classificar / criar regra | grava `classificacao`; opcionalmente cria `regra_classificacao` (origem `aprendida`) a partir da resolução, pendente de aprovação |
| Resolver pendência / ignorar | `pendencia_resolucao` com justificativa; recalcula |
| Fechar competência | recalcula pendências; recusa se houver bloqueante; congela totais; status `fechada`; evento |
| Reabrir | exige permissão própria e justificativa; status `reaberta`; tudo o que mudar depois fica marcado |
| Gerar relatório | monta a partir dos movimentos classificados (não de planilha): PDF (Electron) e XLSX (`exceljs`) |
| Gerar pacote | monta a árvore de arquivos a partir das evidências (originais) + relatórios (internos); ZIP; hash do pacote; evento |
| Enviar à contabilidade | e-mail pelo SMTP fiscal com o pacote (ou link, quando existir armazenamento); evento com destinatário e hash |

---

## H. O que é automático e o que é humano

**Automático (com rastro):** captura de extrato e de documentos; criação de
terceiro a partir da NF; título a pagar a partir das duplicatas do XML;
conciliação por chave exata (nosso número, EndToEndId, número do documento,
valor + data + CNPJ únicos); classificação por regra existente; cálculo das
pendências; totais do fechamento.

**Sugestão (o usuário confirma):** conciliação por valor/data sem
identificador; composição de consolidado; regra aprendida; classificação
sem regra quando há candidata por semelhança de descrição.

**Só humano:** ignorar pendência; reclassificar; reabrir competência; enviar;
manifestar desconhecimento; NFS-e de município fora do nacional; comprovante
anexado à mão.

---

## I. Pendências externas

1. **BB — comprovantes oficiais** de pagamentos feitos fora do app: sem
   confirmação do banco. Até lá, comprovante = arquivo anexado pelo usuário,
   marcado como fornecido, nunca "autenticação SISBB" gerada aqui.
2. **BB — extrato pela API**: qual produto/escopo a empresa tem (Extratos),
   se devolve PDF (assumo que **não**; OFX/PDF continuam vindo do Gerenciador
   Financeiro), e quais identificadores vêm em cada lançamento.
3. **BB — aplicações/investimentos** pela API: idem.
4. **SEFAZ — NFeDistribuicaoDFe**: exige o certificado da empresa e o CNPJ
   como interessado; limites de consultas por hora (o AN bloqueia consumo
   indevido, "cStat 656"); o `sefazCliente.js` precisa de endereços do
   Ambiente Nacional e de descompactar o `docZip` — **a confirmar** na etapa.
5. **NFS-e nacional / ADN**: se Contagem e os municípios dos prestadores
   estão aderidos; como a empresa acessa hoje o portal (certificado? login?).
6. **Contabilidade**: formato preferido do pacote, plano de contas/categorias
   que ela usa, se aceita e-mail com ZIP ou prefere outro canal.
7. **Mais de uma empresa** (SP Holding × Santíssimo Decor) — decisão do dono.

---

## J. Banco (conceitual)

- **Reaproveitar sem mexer:** `pedidos`, `pedido_parcelas`, `clientes`,
  `notas_fiscais*`, `notas_fiscais_externas*`, `notas_devolucao`, `boletos*`,
  `ordens_pagamento`, `recebimentos`, `financeiro_fechamentos*`,
  `financeiro_pagamentos`, `reembolsos`, `financeiro_feriados`,
  `financeiro_configuracao`, `configuracao_cobranca`, `configuracao_fiscal`,
  `segredos_app`, `tarefa_automacoes`, `notificacoes`.
- **Estender (poucas colunas, opcionais):** `configuracao_cobranca` ou uma
  configuração própria do módulo para as credenciais dos produtos BB novos;
  `financeiro_eventos` só se a decisão for reaproveitá-la para a trilha
  contábil.
- **Criar:** as entidades de D (`competencia_contabil`, `terceiro`,
  `documento_fiscal_recebido` + itens + eventos, `titulo_pagar` + parcelas,
  `liquidacao`, `conta_financeira`, `extrato_importacao`,
  `movimento_bancario`, `conciliacao_vinculo`, `plano_contas`, `centro_custo`,
  `regra_classificacao`, `classificacao`, `documento_arquivo` + partes,
  `pendencia_resolucao`, `contabil_eventos`), mais `perm_contabilidade`.
  Cada etapa com o seu SQL (`sql/contabilidade_<etapa>.sql`), idempotente,
  como os das outras fases; tabela nova = reiniciar a API.

---

## K. Backend (proposta)

- `backend/contabilidadeController.js` → `/api/contabilidade/*`, permissões
  `contabilidade.*` (ver, conciliar, classificar, regras, fechar, reabrir,
  pacote, enviar, configurar).
- `backend/contabilidade/` (o mesmo desenho do Financeiro: funções **puras**
  testáveis + `carregar` que fala com a API):
  - `competencias.js` — estados, checklist, fechar/reabrir;
  - `pendencias.js` — cálculo (formato da prontidão) + resoluções;
  - `terceiros.js`, `titulos.js`, `liquidacoes.js` — contas a pagar;
  - `documentosRecebidos.js` — NF-e/NFS-e recebidas (reusa `xmlDevolucao.lerNota`);
  - `extrato/ofx.js` (parser puro), `extrato/importacao.js`, `extrato/bbExtrato.js` (cliente com `bbCliente.criar` apontando para o produto de extratos);
  - `conciliacao/motor.js` — puro: candidatos, critérios, pontuação, composição (soma de subconjuntos limitada ao dia/à faixa), decisão `auto`/`sugerido`/`pendente`; `conciliacao/aplicar.js` — grava vínculos e eventos;
  - `classificacao/regras.js` (avaliação pura, mais específica vence), `classificacao/aplicar.js`, `classificacao/aprendizado.js`;
  - `documentos.js` — arquivo genérico com hash e partes (padrão do histórico social), origem oficial/interno;
  - `relatorios.js`, `pacote.js` (ZIP — biblioteca a escolher, ex.: `archiver` ou `jszip`), `envio.js` (reusa `fiscal/email.js`);
  - `auditoria.js` (ou `financeiro/auditoria.js` com tipos novos);
  - `sefaz/distribuicao.js` e `sefaz/manifestacao.js` dentro de `backend/fiscal/` (é SEFAZ; reusa certificado/transporte);
  - `nfse/adn.js` em `backend/fiscal/`.
- **Jobs:** uma agenda no molde de `agendaConciliacao.js` (roda no processo
  principal, trava por faixa em `cobranca_execucoes` ou tabela própria) para
  extrato, distribuição DF-e e conciliação.
- **Webhooks:** nenhum novo agora. O de cobrança continua onde está.

---

## L. Frontend (fluxo funcional, sem visual)

`src/html/contabilidade.html` + `src/js/contabilidade.js` +
`src/css/contabilidade.css`, modais em `src/html/modals/contabilidade/`,
seguindo `docs/padroes-de-interface.md` e `docs/padrao-visual-controles.md`
(botões `ctl-botao`, vidro dos modais, seletor de competência de
`competencia.js`, `Modal.openWithSpinner`, `DialogPadrao`, `BotaoAcao`).
Fluxo: entra na competência → vê o checklist e as pendências → cada pendência
abre o modal que a resolve (Movimentações, Documentos, Contas a pagar,
Classificar) → volta com o checklist recalculado → Fechar → Gerar pacote →
Enviar.

---

## M. Auditoria e segurança

- Toda gravação do módulo passa por `contabil_eventos` (quem, quando, o quê,
  antes/depois, regra aplicada) — o mesmo hábito de `financeiro/auditoria.js`.
- Dados capturados (movimento, documento) **não são editados**: correção é
  novo vínculo/classificação, com a anterior preservada.
- Arquivos originais com `sha256`, origem `oficial`/`interno`, nunca
  substituídos por gerados; PDF do app leva rodapé "documento interno gerado
  pelo App-Gestão".
- Credenciais novas (extrato, NFS-e): id/app key na configuração, secret em
  `segredos_app` (chave mestra) ou cofre local; nunca ao renderer
  (`sanitizarSaida`), nunca em log.
- Competência fechada: escrita recusada pela rota (não só pela tela), salvo
  reabertura com justificativa.

---

## N. Plano de implementação (etapas pequenas, na ordem que o sistema real permite)

| Etapa | Entrega | Depende de |
| --- | --- | --- |
| **0. Decisões** | respostas de P; escolha da empresa/contas; plano de contas inicial (as categorias do relatório atual); o que bloqueia o fechamento | dono + contabilidade |
| **1. Base do módulo** | menu, permissões, `competencia_contabil`, checklist calculado **só com o que já existe** (NF-e de saída, recebimentos, comissões/produção fechadas, reembolsos, pendências de cobrança e fiscais), central de pendências, auditoria | — |
| **2. Documentos e evidências** | `documento_arquivo` com hash/partes/origem e vínculos; os XMLs e PDFs existentes passam a aparecer como evidência; anexar comprovante à mão | 1 |
| **3. Fornecedores e contas a pagar** | terceiros, títulos e parcelas, pagamento à mão, NF-e de entrada por **XML/chave à mão** (sem SEFAZ ainda), NFS-e à mão | 1, 2 |
| **4. Extrato por OFX** | contas financeiras, importação OFX (parser próprio), movimentos com hash, tela de Movimentações | 1, 2 |
| **5. Motor de conciliação** | critérios, confiança, composição 1:N/N:1, sugestões, ignorar com justificativa; conciliar recebimentos, pagamentos de comissão, reembolsos e liquidações de títulos | 3, 4 |
| **6. Classificação** | plano de contas, centros de custo, regras (CFOP/terceiro/descrição), reclassificação, regras aprendidas com aprovação | 3, 4 |
| **7. Fechamento e reabertura** | estados, bloqueios, totais congelados, reabertura com justificativa | 1, 5, 6 |
| **8. Relatório mensal e dossiê** | relatório novo (tela/PDF/XLSX), conciliação bancária, dossiê | 5, 6 |
| **9. Pacote e envio** | ZIP com originais + internos, e-mail à contabilidade, registro | 8 |
| **10. NF-e de entrada automática** | DistribuicaoDFe + manifestação (job) | 3 + confirmação SEFAZ |
| **11. Extrato pela API do BB** | cliente do produto de extratos; OFX continua como alternativa | 4 + contratação BB |
| **12. Aplicações** | contas de aplicação, transferências internas, rendimentos/IR/IOF (API ou OFX) | 4, 6 (+ BB) |
| **13. NFS-e automática** | ADN | 3 + confirmação municípios |
| **14. Comprovantes oficiais** | quando o BB confirmar | 5 + BB |

O OFX vem antes da API porque não depende de contratação nenhuma e já
destrava conciliação e classificação; a busca automática de NF-e vem depois
da entrada à mão pelo mesmo motivo.

---

## O. Riscos

- **Volume e limite da API genérica**: corpo de 1 MB por requisição e sem
  transação; arquivos em partes e "tudo ou nada" por passos, como o
  fechamento faz hoje. Um extrato com milhares de linhas são milhares de
  POSTs — pensar em lote na DB API (rota própria) se doer.
- **Conciliação errada e silenciosa**: mitigada por "automático só com chave
  exata"; tudo o mais é sugestão.
- **Consolidado**: soma de subconjuntos explode combinatoriamente; limitar à
  mesma data/faixa e a poucos itens; senão pede composição à mão.
- **Datas**: manter a regra da casa (texto `AAAA-MM-DD`, sem `new Date` em
  DATE; competência fiscal ≠ financeira).
- **NF-e de entrada fora do nacional / NFS-e municipal**: pendência, nunca
  bloqueio do mês inteiro.
- **Duas empresas** num só banco: se for o caso, tudo precisa de `empresa_id`
  desde a etapa 1.
- **Regras "aprendidas"** classificando errado em série: entram desligadas,
  com aprovação.
- **Fechado × ajuste**: a mesma disciplina do Financeiro (não reescrever;
  ajuste na seguinte) evita divergência com o que a contabilidade já recebeu.

---

## P. Perguntas (só o que depende de você ou da contabilidade)

1. **Empresas:** o exemplo é da conta "Caixa SP Holding". O módulo fecha só a
   Santíssimo Decor, ou também a holding (e outras)? Isso decide se existe
   `empresa` no modelo desde o início.
2. **Contas financeiras:** quais contas bancárias/caixa/aplicações entram no
   fechamento (banco, agência, conta, tipo)? Há caixa físico?
3. **Categorias:** o plano de contas inicial pode ser a lista de "Tipos" que a
   contabilidade já usa no relatório atual? Pode mandar a lista completa (e
   se usam centro de custo)?
4. **O que bloqueia o fechamento:** movimento sem conciliação bloqueia? NF sem
   classificação bloqueia? Ou só avisam e o mês fecha "com ressalvas"?
5. **BB:** quais produtos da API a empresa tem contratados hoje além de
   Cobranças (extratos, pagamentos, investimentos)? Há resposta do banco sobre
   comprovantes?
6. **Extrato hoje:** o OFX e o PDF vêm do Gerenciador Financeiro? Com que
   frequência (diário, mensal)?
7. **NFS-e:** como o financeiro consulta hoje (portal nacional com
   certificado? portal de Contagem/BH?). Os prestadores costumam ser de quais
   municípios?
8. **Contabilidade:** aceita pacote ZIP por e-mail? Precisa do XLSX no formato
   de hoje (as mesmas colunas) ou só dos dados?
9. **Pagamento de fornecedor:** pretendem pagar pelo app no futuro (API de
   pagamentos do BB) ou só registrar o que foi pago fora?
10. **Aplicações:** que produtos (CDB, fundo, poupança)? O extrato da
    aplicação vem separado do da conta corrente?
11. **Início:** a partir de que competência o módulo passa a valer (a
    primeira a fechar)?
12. **Permissões:** quem fecha, quem reabre, quem envia — pode ser o mesmo
    grupo do "Fechar competência" do Financeiro?

---

## Q. Respostas do dono (28/09/2026)

| # | Resposta |
| --- | --- |
| 1 | Só a **Santíssimo Decor** (o exemplo era só um modelo). Sem `empresa` no modelo por enquanto. |
| 2 | A **mesma conta do BB** dos boletos. |
| 3 | A lista de categorias vem quando for necessária (pedir na etapa 6). **Não usam centro de custo.** |
| 4 | Três severidades: **erro crítico** bloqueia o fechamento; **pendência documental** bloqueia o pacote/envio; **aviso** não bloqueia. |
| 5 | Só Cobranças ativa no BB; pode ativar todas. Resposta do BB sobre a API de Extratos: campos `numeroDocumento`, `textoIdentificadorUnicoTransacao`, `numeroCpfCnpjContrapartida` / `indicadorTipoPessoaContrapartida`, `dataLancamento` / `dataMovimento` / `valorLancamento`, `indicadorTipoLancamento` / `codigoHistorico` / `codigoSubHistorico` / `textoDescricaoHistorico`, `codigoIdentificadorSistemaPagamento`; **não** traz SISBB, EndToEndId nem dados do boleto; **não há API de comprovantes**; outras APIs: Pix (recebimento), Pagamentos em lote / PagBB (pagamentos). |
| 6 | Extrato mensal, agora pela API (etapa 11; o OFX da etapa 4 continua como alternativa). |
| 7 | NFS-e pelo site oficial; só **Contagem e Belo Horizonte**. |
| 8 | A contabilidade aceita ZIP por e-mail e XLSX, mas a ideia é **zipar tudo e o usuário salvar e enviar** ele mesmo. |
| 9 | Pagar fornecedor e pagar os **fechamentos de comissão e produção** (são as notas de serviço). |
| 10 | Tem **CDB**, separado, com API do BB para consulta. |
| 11 | **Em aberto** — "a partir de qual competência o módulo passa a valer" não ficou claro para o dono; reformular. |
| 12 | Permissões novas, **módulo novo** (feito na etapa 1). |

Decisão derivada (a confirmar): **pendência documental e aviso podem ser
ignorados com justificativa; erro crítico nunca.** E o mês só fecha depois
do último dia dele.

---

## R. Etapa 1 entregue (28/09/2026) — base do módulo

- **Menu:** "Contabilidade" logo abaixo do Financeiro (`data-page="contabilidade"`).
- **Permissões:** módulo `contabilidade` (`perm_contabilidade`) com
  `contabilidade.view`, `.fechar`, `.reabrir`, `.pendencia.resolver`,
  `.pacote.gerar`, `.config.view` — catálogo, `permissoes.html` e SQL.
- **SQL:** `sql/contabilidade_base.sql` (perm_contabilidade,
  `competencia_contabil`, `contabil_pendencias_resolucoes`, `contabil_eventos`).
  Rodar e reiniciar a API.
- **Backend:** `backend/contabilidadeController.js` (`/api/contabilidade`):
  `GET /painel`, `GET /atividade`, `GET /competencias`, `POST /fechar`,
  `POST /reabrir`, `POST /pendencias/ignorar`, `POST /pendencias/restaurar`.
  `backend/contabilidade/checklist.js` (puro + `carregar`),
  `fechamento.js`, `base.js`.
- **Checklist (só com o que já existe):** NF-e de saída (parada e recusada
  sem nova emissão = crítico; pedido enviado no mês sem nota = documental),
  recebimentos e cobrança (SQL pendente e aviso do BB = crítico; a conciliar
  = documental; atraso e boleto recusado = aviso), comissões e produção
  (mês terminado sem fechamento = documental; fechado sem pagar = aviso até
  o prazo, documental depois), devoluções (reembolso a pagar = documental;
  devolução que não terminou = crítico). Extrato, documentos recebidos,
  contas a pagar e conciliação aparecem como "ainda não integrado".
- **Tela:** `src/html/contabilidade.html` + `css` + `js`: seletor de
  competência (abre no mês passado), situação com barra de progresso, três
  cartões por severidade (clique filtra), checklist por fonte (clique
  filtra), pendências com chips e "Ignorar"/"Restaurar"/"Financeiro",
  ações (Fechar, Reabrir reais; o resto "em implementação"), atividade e
  "Próximas etapas". Modais `modals/contabilidade/{fechar,reabrir,ignorar-pendencia}.html`
  + `js/modals/contabilidade-modais.js`.
- **Testes:** `backend/contabilidade/checklist.test.js`,
  `backend/contabilidadeController.test.js`,
  `src/js/__tests__/contabilidadeModulo.test.js`; entrada em
  `padraoControles.test.js`.
- **Próxima:** etapa 2 (documentos e evidências) ou 3 (fornecedores e
  contas a pagar — os Contatos já estão prontos), a escolher pelo dono.
