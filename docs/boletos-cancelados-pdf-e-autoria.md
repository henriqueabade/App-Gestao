# Boletos: PDF do importado, boleto novo depois do cancelado e autoria

Pedido do dono em 06/10/2026, com os prints do PED107 (PDF sem dados) e do
PED115 (três boletos "baixado (cancelado)" sem como gerar outros).

## 1. PDF sem pagador, número do documento e instruções (só em produção)

**Causa.** Os boletos de produção do PED107 (e do PED104) foram emitidos no
Gerenciador Financeiro do BB e **importados** para o programa
(`cobranca/importacao.js`). A lista do BB não traz pagador, "seu número" nem
as regras de juros/multa, então o boleto importado ficava com `pagador`,
`numero_documento`, `instrucoes` e `pix_emv` vazios — e o PDF saía com esses
campos em branco. No banco DEV os boletos eram gerados pelo próprio programa,
que grava tudo no registro; por isso lá funcionava.

**Como ficou.**

- A consulta ao BB (`boletoOperacoes.sincronizar`) lê também o cadastro do
  boleto no detalhe (`lerCadastroDoBB`: pagador, seu número, emissão, juros,
  multa, protesto, prazo) e completa **só o que está vazio** — o que o
  programa gravou no registro continua valendo (`camposDoCadastro`).
- Antes de gerar o PDF (um boleto ou "Boletos (PDF)" do pedido), o boleto a
  pagar a quem falta algo é consultado no BB **uma vez**
  (`completarParaDocumento`): o detalhe completa o cadastro e
  `GET /boletos/{id}/pix` traz o QR Code, quando o boleto tem Pix. Fica a marca
  `completado_para_pdf` no histórico do boleto para não repetir.
- O que o BB não der, o PDF tira do pedido (`complementoDoDocumento`): o
  pagador do cliente do pedido, o número do documento como o programa gera
  ("PED107P1") e as instruções pelas regras do boleto ou da configuração.
- Boleto sem nada de juros gravado passa a usar os juros da configuração
  (antes saía sem a linha de juros); o "sem juros" do BB grava 0.

Os nomes dos campos do detalhe do BB são os da API Cobranças v2 (cada um
procurado em mais de uma chave). **Não foi possível conferir contra uma
resposta real de produção** daqui: se o BB devolver outro nome, o PDF continua
saindo com os dados do pedido.

## 2. Boleto novo depois do cancelado, com a data e o valor que quiser

**Como era.** A baixa "Cancelado" ocupava a parcela para sempre
(`MOTIVOS_QUE_ENCERRAM`): o botão "Gerar boletos" sumia e não havia como
cobrar de novo. Só a "Reemissão" deixava gerar outro, e só com outra data.

**Como ficou.**

- O boleto **cancelado deixa a parcela livre**. O "Gerar boletos" volta a
  aparecer no Visualizar; a linha mostra "boleto cancelado: marque para gerar
  um novo — com a data e o valor que quiser". A quitação por fora continua
  ocupando a parcela (ela está paga).
- A geração **automática** (ao emitir a NF-e) não refaz o que foi cancelado:
  quem cancelou decide quando cobrar de novo.
- No "Gerar boletos", cada parcela marcada tem **vencimento** (a partir de
  hoje) e **valor** editáveis. O boleto novo sai com eles e a **parcela passa a
  ter os dele** (sobrescreve) — só depois que o BB registra; se o BB recusar, a
  parcela não muda.
- Se a soma das parcelas sair do total do pedido, a **justificativa** (ao
  menos 10 letras) é obrigatória, como no "Pagamento do pedido": o total do
  pedido passa a ser a soma, a diferença aparece como **Adicional** ou
  **Desconto** nos itens, e o histórico do ajuste guarda quem, quando, de
  quanto para quanto e por quê. Mudar só datas ou redistribuir mantendo o
  total não pede justificativa. A NF-e já emitida não muda (a tela avisa).
- O boleto novo fica **ligado ao cancelado** (`substitui_boleto_id`) e o
  histórico dele diz: "No lugar do boleto … (cancelado) · parcela 1:
  vencimento … → … · valor … → … · justificativa: …".
- O desconto até o vencimento (pedido com desconto) acompanha o valor novo.

Onde: `cobranca/boletos.js` (`canceladoNaParcela`, `conferirAjustes`,
`gravarTotalDoPedido`, `registrar` com `ajustes`/`justificativa`),
`cobrancaController.js` (`POST /pedidos/:id/boletos`), modal
`gerar-boletos.html` + `pedido-gerar-boletos.js` (`planoDaTela`).

## 3. Quem emitiu, quem registrou o pagamento, se foi automático

Ao passar o mouse na etiqueta do boleto (coluna BOLETO do Visualizar pedido e
no "Gerar boletos"/"Boletos do pedido"), o balão mostra
(`boletos.auditoriaDaParcela`):

- **Emitido no programa por** Fulano em dd/mm/aaaa hh:mm — ou **Importado do
  Banco do Brasil por** Fulano (emitido no BB em …);
- **No lugar do boleto** … (cobrança cancelada), quando substitui outro;
- **Baixado** (motivo) **por** Fulano em …, com a observação;
- **Pago no Banco do Brasil** (data · valor · canal) — **baixa AUTOMÁTICA**
  pelo aviso do banco ou pela conciliação, ou **conferido na consulta ao BB
  feita por** Fulano;
- **Quitado por fora** / **Pagamento registrado à mão** por Fulano em ….

O histórico de cada boleto (botão "Detalhes") passou a dizer **por quem** em
cada linha, ou "automático" no que veio do banco.

## Testes

`backend/cobranca/boletosNovosEAuditoria.test.js` (12): cadastro do BB, o que
a consulta completa, Pix, a consulta única antes do PDF, o PDF do importado,
cancelado livre, conferência de data/valor/justificativa, boletos novos com
parcela e total atualizados, BB que recusa, geração automática, auditoria.
Conferência visual no Electron com API falsa: o "Gerar boletos" do PED115 e o
PDF de um importado do PED107.
