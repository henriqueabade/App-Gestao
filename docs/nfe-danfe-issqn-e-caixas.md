# NF-e: quadro do ISSQN no DANFE e numeração das caixas

Pedidos do dono em 18/09/2026. Nada aqui muda o banco.

## 1. Quadro "Cálculo do ISSQN" no DANFE

O DANFE (`backend/fiscal/danfe.js`) ganhou o quadro do leiaute oficial,
entre "Dados dos produtos / serviços" e "Dados adicionais":

| Campo | De onde vem |
| --- | --- |
| Inscrição municipal | `<emit><IM>` do XML — a inscrição municipal da Configuração fiscal |
| Valor total dos serviços | `<ISSQNtot><vServ>` (0,00 em nota só de produto) |
| Base de cálculo do ISSQN | `<ISSQNtot><vBC>` (0,00 em nota só de produto) |
| Valor do ISSQN | `<ISSQNtot><vISS>` (0,00 em nota só de produto) |

A inscrição municipal só aparece se estiver preenchida na **Configuração
fiscal** (campo "Inscrição municipal") na hora da emissão: o DANFE lê o XML
autorizado, então nota emitida antes de preencher sai com o campo em branco.

## 2. Numeração das caixas: `nota_caixa/total`

Cada caixa (volume) sai numerada na NF-e (`<vol><nVol>`) assim:

```
125_1/3   125_2/3   125_3/3        (nota 125, três caixas)
```

- Uma linha por caixa no modal de emissão (Volumes ≥ 2): cada `<vol>` leva a
  sua numeração.
- Um volume só (ou a quantidade sem o detalhe por caixa): `125_1/1`, ou a
  faixa `125_1/3 a 125_3/3` num `<vol>` que junta as caixas.
- O número da nota sai sem zeros à esquerda.
- No DANFE: o campo "Numeração" mostra a primeira e a última caixa
  (`125_1/3 a 125_3/3`) e a tabela de volumes mostra cada uma.
- No modal Emitir NF-e a coluna "Caixa" mostra `1/3`, `2/3`…; o número da
  nota entra na emissão (ele só existe nessa hora).

Código: `numeracaoDasCaixas` em `backend/fiscal/xmlNfe.js` (pura, testada em
`backend/fiscal/xmlNfe.test.js`); o quadro do ISSQN em
`backend/fiscal/danfe.test.js`.

## Depois de puxar o código

Reiniciar a API (o DANFE e o XML são montados no backend). Para a inscrição
municipal aparecer, preencher o campo na Configuração fiscal.
