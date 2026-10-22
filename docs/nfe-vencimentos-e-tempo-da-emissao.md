# NF-e: vencimentos iguais na nota, no boleto e no pedido, e emissão mais rápida

Pedido do dono em 22/10/2026 (caso PED114). Nada aqui muda o banco: sem SQL.

## 1. O defeito das datas

O PED114 fatura "ao embarcar", com previsão de embarque em 05/11 e prazo
28/42/56. Ele saiu em 22/10, antes da previsão. O certo seria 19/11, 03/12 e
17/12, contados do dia do envio.

| Onde | O que saiu | Por quê |
| --- | --- | --- |
| XML da NF-e (o que a SEFAZ autorizou) | 19/11, 03/12, 17/12 — **certo** | a emissão já projetava os vencimentos pelo dia do envio |
| Boletos | 03/12, 17/12, 31/12 | eram gerados **antes** de o pedido virar "Enviado", com os dias da previsão |
| Parcelas do pedido | 03/12, 17/12, 31/12 | o envio refaz os vencimentos, mas a parcela com boleto fica travada na data dela |
| DANFE impresso | 03/12, 17/12, 31/12 | o DANFE copiava as parcelas do pedido, não o XML |

A ordem na tela era: emitir → gerar boletos → marcar como Enviado. O envio
chegava tarde: os boletos já existiam e prendiam as parcelas nos dias velhos.

## 2. O que mudou

- **A emissão grava os vencimentos da nota** (`gravarVencimentosDaNota` em
  `backend/fiscal/emissao.js`). Com a nota autorizada, as parcelas livres
  passam a vencer nos dias que foram no XML, antes de qualquer boleto. Se a
  gravação falhar, a nota continua valendo: vira aviso e a resposta diz
  `vencimentos_conferidos: false`.
- **Na tela, o envio vem antes dos boletos** (`enviarComBoletos` em
  `pedido-emitir-nfe.js`).
  - Com `vencimentos_conferidos`, envio e boletos correm juntos.
  - Sem ele, os boletos só saem depois do envio que deu certo. Isso vale
    também para o "Marcar como enviado" de uma nota autorizada antes.
  - Se o envio falhar, o botão passa a "Marcar como enviado" e os boletos
    esperam essa nova tentativa.
- **O DANFE imprime o vencimento do XML** (`comVencimentosDaNota` em
  `backend/fiscal/parcelasNfe.js`).
  - A parcela em aberto pega a data da duplicata da nota, na ordem.
  - A parcela paga antes da emissão continua **PAGO, sem data** (decisão de
    16/10), e a vencida continua VENCIDO.
  - Se as contas não fecham (por exemplo, uma parcela a mais que as
    duplicatas), fica o que o pedido diz.
  - O XML autorizado não muda; o DANFE agora é sempre o retrato dele.

**Descartado pelo dono (22/10):** trocar o vencimento do boleto para antes da
data definida. Para o fisco, isso não estaria correto. Continua só a
prorrogação (data depois do vencimento atual).

## 3. A demora para gerar a nota

Medido aqui com uma API falsa que responde em 120 ms por ida (o tempo da API
real). Para a SEFAZ e o BB foram usados tempos estimados: 2 s e 1,5 s por
boleto. O roteiro da medição ficou no scratchpad da sessão.

| Etapa | Antes | Depois |
| --- | --- | --- |
| Emitir (com a SEFAZ) | 5,2 s | 5,1 s |
| Boletos (3, com o BB) | 8,8 s | 4,4 s, junto com o envio |
| Envio do pedido | 2,1 s | dentro do tempo dos boletos |
| **Total** | **16,1 s** | **9,5 s** |

**De quem era a demora.** Cerca de 9,6 s eram do sistema, com umas 100 idas
à API uma atrás da outra. O BB respondia três vezes, uma depois da outra. A
SEFAZ é uma ida só.

O que foi feito:

- Os boletos das parcelas vão ao BB ao mesmo tempo. Só a reserva do nosso
  número continua uma por vez, porque o contador é um só. Os números seguem a
  ordem das parcelas.
- O contador do nosso número e o próximo número da NF-e gravam com 1 ida em
  vez de 3: `avancarSequencial` e `avancarNumero`.
- A geração sabe o próximo nosso número. Antes, na API real, a 2ª parcela
  tentava o número da 1ª e só passava depois de o UNIQUE recusar.
- A coluna do desconto do boleto é conferida uma vez por geração, não uma por
  boleto.
- Os itens da nota são gravados 6 por vez, não um a um.
- O envio do pedido corre junto com os boletos (seção 2).

## 4. Testes

- `backend/fiscal/emissao.test.js`: PED114 (nota e pedido com os mesmos
  dias); falha ao gravar vira aviso; emissão sem data de envio.
- `backend/fiscal/danfe.test.js`: o DANFE com a data do XML e com PAGO.
- `backend/cobranca/boletos.test.js`: parcelas juntas no BB, sem tentativa
  recusada pelo UNIQUE e com a configuração lida uma vez.
- `src/js/__tests__/pedidoEmitirNfe.test.js`: o envio antes dos boletos.
