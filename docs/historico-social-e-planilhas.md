# Histórico "de rede social", sino de avisos e planilhas CSV

Etapa 2, pedida pelo dono em 18/09/2026, para **Prospecções** e **Clientes**.
O banco muda: rodar `sql/historico_social.sql` e reiniciar a API (ver o fim).

## 1. Linha do tempo (aba Histórico)

A aba **Histórico** da ficha de prospecção virou uma linha do tempo, e a
ficha do cliente ganhou a mesma aba (o cliente não tinha histórico nenhum).
Componente: `src/js/utils/historico-social.js` + `src/styles/historico-social.css`.
Rotas: `backend/historicoSocialController.js` (`/api/historico-social/:origem/:id`),
regras em `backend/historicoSocial.js`.

| O quê | Regra |
| --- | --- |
| Quem aparece | Nome e foto (a do cadastro de usuários; sem foto, as iniciais) de quem fez cada coisa |
| Curtir | Em qualquer evento ou comentário; clicar de novo desfaz. "Curtido por Ana, Bruno e mais 2" |
| Comentar | Em qualquer evento. Mostra os 3 últimos e "Ver mais" |
| Responder | Sem limite de níveis (o recuo para de crescer no 4º, para não esmagar o texto) |
| Observação | Caixa no topo: publica um evento "Observação" escrito à mão, que também recebe curtida, comentário e anexo |
| Anexo | Qualquer tipo de arquivo, até **20 MB** cada e 5 por envio, só no próprio comentário ou na própria observação. Abrir (programa padrão do Windows) ou salvar |
| Editar | Só o autor, no próprio comentário. Fica "(editado)"; o **Sup Admin** vê o texto anterior no (i) |
| Excluir | Só o **Sup Admin** (conferido também no servidor). É por marca: nada sai do banco. Quem não é Sup Admin deixa de ver; o Sup Admin vê riscado, com quem excluiu, e pode ligar "Mostrar excluídos" |
| Rascunho | O que se está escrevendo (e os arquivos escolhidos) não some quando outra coisa redesenha a tela |

O que o cliente passa a registrar sozinho (`backend/clienteHistorico.js`):
cadastro (com o retrato dos dados), cada campo alterado (antes → depois),
contatos criados/alterados/excluídos, transportadoras, conversão de
prospecção e importação por planilha (com o que ficou faltando).

**Anexos no banco.** Não há servidor de arquivos: o arquivo vai em base64 em
partes de 512 KB (`historico_anexo_partes`), cada uma abaixo do limite de
1 MB do corpo da API. Só aparece depois que todas as partes gravaram
(`completo`); se falhar no meio, é apagado. O servidor local aceita até 30 MB
de corpo só nessas rotas (e nas de planilha); o resto continua em 3 MB.

## 2. Sino de avisos

O sino do topo (`src/js/notifications.js`) agora é de **todos os perfis** e
mostra os avisos de cada um (`/api/notificacoes`, `backend/notificacoesController.js`):

- quem recebe: **quem criou a prospecção/o cliente** e **quem fez a ação**
  comentada ou curtida — "os dois" — e, numa resposta, o autor do comentário
  respondido. Quem agiu nunca recebe o próprio aviso, e ninguém recebe dois
  avisos do mesmo fato;
- cliente antigo sem `criado_por`: vale quem registrou o cadastro no
  histórico ou, sem isso, o dono do cliente (se for usuário do sistema);
- o número no sino é o total de não lidos; clicar num aviso marca como lido
  e abre o módulo, a ficha e a aba Histórico já no comentário (destacado);
- "Marcar todas como lidas"; busca ao abrir o app, a cada minuto e quando a
  janela volta ao foco;
- Configurações → Notificações: desligado, o sino fica quieto; a categoria
  **Vendas e pedidos** desligada silencia estes avisos.

A antiga `/api/notifications` (só Admin, uma vez por dia) nunca teve tabela
na API; o sino deixou de usá-la.

## 3. Ações Rápidas: planilha CSV

Prospecções ganhou o botão **Ações Rápidas** de Clientes, com as mesmas
funções. Funcionando nos dois módulos: **Exportar CSV**, **Importar CSV** e
**Salvar modelo CSV** (novo). "Gerar Relatório" e "Enviar E-mail em Massa"
continuam "em desenvolvimento". Código: `src/js/utils/acoes-csv.js`,
`src/styles/acoes-csv.css`, `backend/importacaoCsv.js` (colunas, leitura,
conferência) e as rotas `/csv/modelo`, `/csv/exportar`, `/csv/importar` em
`clientesController.js` e `prospeccoesController.js`.

**Formato.** Ponto e vírgula, UTF-8 com BOM (o Excel em português abre
direto), datas dd/mm/aaaa, valores 1.234,56, Sim/Não. Na leitura aceita
também vírgula como separador, o CSV do Excel em Windows-1252, datas
aaaa-mm-dd e números com ponto. Colunas com `*` são obrigatórias. O
cabeçalho é reconhecido sem acento, sem `*` e fora de ordem; colunas que não
são do modelo são ignoradas (e o relatório diz quais).

- **Exportar**: leva o que está na tabela (com o filtro aplicado), na ordem da tela.
- **Modelo**: cabeçalho + uma linha de exemplo marcada "EXEMPLO (apague esta
  linha)" — se ficar, a importação ignora.
- **Importar**: confere e grava **linha a linha; uma linha com problema não
  interrompe as outras**. No fim abre o relatório "Resultado da importação":

| Situação | Quando | O que acontece |
| --- | --- | --- |
| Registrado | Tudo certo | Gravado |
| Registrado com dados faltantes | Faltou/estava errado algo que não identifica o registro (dono, status, endereço, contato, e-mail, etapa, data...) | Gravado assim; o relatório e o histórico do registro dizem o que completar |
| Pendente de registro | Faltou o que identifica: Clientes — nome fantasia, razão social, CNPJ/CPF (ou inválido, já cadastrado, repetido no arquivo); Prospecções — nome da empresa, CNPJ já numa prospecção ativa ou repetido | **Não** gravado; o relatório diz por quê |
| Ignorada | Linha de exemplo do modelo | Nada |

Os cartões do relatório filtram a lista; "Salvar relatório" gera um CSV com
linha, identificação, situação e motivos, para corrigir a planilha e importar
de novo **só** as linhas pendentes.

Permissões: Clientes usa as que já existiam (`cli.export.csv`,
`cli.import.csv` + `cli.create`); Prospecções ganhou `pros.export.csv`,
`pros.import.csv` (vale também para o modelo; importar pede junto
`pros.create`), `pros.report` e `pros.email.bulk`.

## 4. Banco — `sql/historico_social.sql`

1. `prospeccao_historico`: `excluido_em`, `excluido_por`, `motivo_exclusao`;
   a ação `publicou` entra na lista permitida.
2. `clientes.criado_por`.
3. Tabelas novas: `cliente_historico`, `historico_comentarios`,
   `historico_comentario_versoes`, `historico_curtidas`, `historico_anexos`,
   `historico_anexo_partes`, `notificacoes`.
4. `perm_pros`: `acao_export_csv`, `acao_import_csv`, `acao_report`,
   `acao_email_bulk` (desligadas; o Sup Admin liga no modal de permissões).

Depois de rodar, **reiniciar a API** (ela lê o esquema das tabelas ao subir).
Antes do SQL o app não quebra: a linha do tempo aparece só para leitura, com
um aviso, escrever responde pedindo o SQL, e o sino fica vazio.
