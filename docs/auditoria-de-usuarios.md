# Auditoria por usuário — 15/10/2026

## Ativação

1. Execute `backend/scripts/ddl_usuarios_auditoria.sql` no banco utilizado pela API.
2. Atualize a política de tabelas da API com o arquivo gerado por
   `scripts/mapa-permissoes-api.js` e reinicie a API para reconhecer a tabela.
3. Distribua o programa atualizado.

A migração cria um histórico novo; não reconstrói ações anteriores. O relógio
do banco determina a data de cada evento. Gatilhos impedem editar, excluir ou
truncar o histórico. Falhas de gravação são sinalizadas como auditoria pendente;
uma operação comercial já concluída não é repetida nem desfeita por essa falha.
Não há fila durável de reenvio: registros que falharam exigem investigação.

## Consulta

Em **Usuários → Ações → Auditoria**, o Sup Admin escolhe o período, o módulo,
a ação, a origem e o resultado. O relatório mostra os campos permitidos antes
e depois da operação, o usuário autenticado, horário de São Paulo, referência
do registro e identificador que relaciona o comando aos seus efeitos.

A consulta usa um corte fixo para evitar que novos eventos mudem as páginas
durante a exportação. O PDF inclui todo o período selecionado, até 5.000
registros; acima disso, pede reduzir o intervalo. A consulta também recusa
explicitamente períodos com mais de 50.000 registros. Nenhum desses limites
produz um relatório parcial silenciosamente.

## Autoria e detalhes

- **Manual:** comando associado a um evento real da interface. Os caminhos
  assíncronos instrumentados carregam esse contexto explicitamente.
- **Automático:** efeitos e rotinas separados do comando manual, ligados pelo
  identificador da ação quando disponível.
- **Sistema:** gravação em segundo plano sem autoria de usuário.
- **Não confirmada:** operação identificada sem evidência suficiente de gesto
  manual. O sistema não inventa autoria manual a partir de proximidade de horário.

A captura envolve as chamadas HTTP e IPC e as escritas nas tabelas de negócio
permitidas em `backend/auditoriaUsuarios.js`. Não é gravação de tela, teclado
ou de toda interação visual. Novas tabelas e operações externas que não passam
por essas fronteiras precisam de instrumentação própria. Valores de campos
permitidos são comparados com o registro anterior quando disponível; comandos
e efeitos ficam separados. Conteúdos não permitidos não são copiados.

Somente uma mudança efetiva, manual e bem-sucedida atualiza a última alteração
exibida junto ao usuário. Ela descreve campos alterados e valores antes/depois;
consultas, presença, recálculos e origem não confirmada não a substituem.
As atualizações dessa informação são serializadas por usuário no processo,
impedindo regressão quando operações terminam fora de ordem. O histórico
completo continua disponível no relatório, inclusive falhas de negócio.

Senhas, hashes, tokens, imagens, arquivos e corpos livres não são guardados.
Trocas de senha e foto confirmadas pelo backend geram a identificação da
operação, sem valores protegidos. Quando o estado anterior não pode ser lido,
a auditoria sinaliza a pendência e não afirma uma alteração manual comprovada.

## Termos e atalho

Os documentos passam à versão 1.1, com vigência em 15/10/2026. Aceites anteriores
aparecem como **Desatualizado**, em amarelo. O botão existente continua sendo o
caminho para solicitar o novo aceite; atualizar o programa não envia solicitações
por conta própria.

O processo principal fixa o diretório de dados antes de pedir o bloqueio de
instância única. A segunda execução encerra antes de importar o backend e
solicita que a primeira mostre/restaure a janela. Somente a primeira instância
procura outra porta livre, em ordem crescente, se houver ocupação externa,
incluindo uma colisão entre a sondagem e a abertura do servidor.
