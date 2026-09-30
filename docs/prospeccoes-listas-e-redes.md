# Prospecções — origens e tipos com + e −, redes sociais e interação na planilha

Data: 30/09/2026. Pedido do dono, com as respostas dele:
- redes sociais, uma por linha (a rede, o endereço e o + no fim da linha, que abre outra igual);
- planilha com uma interação por linha: a empresa que se repete recebe só a interação;
- excluir origem ou tipo que alguém usa é recusado;
- permissão nova para o + e o −;
- tipos de interação só em Prospecções (Contatos continua com a lista fixa).

## O que mudou na tela

- **Empresa › Redes sociais** (logo abaixo do Site), em Nova e Editar prospecção. Cada linha tem:
  - a caixa da rede: Instagram, Facebook, LinkedIn, TikTok, YouTube, X (Twitter), Pinterest, WhatsApp ou Outra;
  - o perfil ou endereço;
  - o **−**, que tira a linha e aparece quando há mais de uma;
  - o **+**, que abre outra linha igual.

  Linha com endereço e sem rede não deixa salvar. Linha vazia é ignorada.
- **Oportunidade › Origem**: deixou de ser texto com sugestões. Agora é a caixa padrão do app com **−** e **+** dentro dela, iguais ao Tipo de Contatos.
- **Registrar interação › Tipo**: a mesma caixa com **−** e **+**. O campo Duração aparece em todos os tipos, menos E-mail, WhatsApp, Proposta, Nota e Atividade realizada.
- **O (i) da lista** ganhou o bloco "Site e redes sociais", que só aparece quando há algo preenchido. O Site e os endereços viram link e abrem no navegador do sistema. Todos os itens têm o botão de copiar.
- **O detalhe da prospecção** (aba Empresa) mostra as redes.
- **O histórico** registra a troca das redes, com o antes e o depois.

### O + e o −

- **Permissão:** "Gerenciar origens e tipos de interação" (`pros.lists.manage`). O Sup Admin tem tudo; o modelo Administrador ganha a permissão pelo SQL.
- **O +** recusa nome repetido (não diferencia maiúsculas e acentos). "Atividade realizada" é do sistema e não entra na lista.
- **O −** recusa enquanto alguma prospecção usa a origem, ou alguma interação usa o tipo. A mensagem diz quantas: "Ligação está em 12 interações: troque antes de excluir."
- **Nome fora da lista:** o que já estava gravado com um nome que não está na lista aparece como "(fora da lista)" e não se perde ao salvar.
- **Validação no servidor:** o backend confere a origem nova e o tipo contra a lista. A origem que a ficha já tinha continua valendo.

## A planilha (Ações Rápidas)

Colunas novas no modelo e na exportação:

- **Redes sociais (Rede: endereço | Rede: endereço)**
  - Exemplo: `Instagram: @loja | LinkedIn: linkedin.com/company/loja`.
  - O endereço sozinho tem a rede descoberta pelo domínio (instagram.com vira Instagram).
  - Rede fora da lista entra como "Outra", com pendência.
- **Interação - Tipo · Quando aconteceu (dd/mm/aaaa hh:mm) · Com quem (nome do contato) · Duração (min) · Resumo · Detalhes**

Regras da importação:

1. **Uma interação por linha.** Para lançar mais de uma, repita a empresa numa linha nova só com as colunas da interação:
   - pelo mesmo CNPJ;
   - ou, se a linha não tiver CNPJ, pelo mesmo nome.

   A empresa pode já estar cadastrada ou estar numa linha anterior do arquivo. A linha repetida **acrescenta a interação**, e também o próximo passo, se vier. Sem interação, a repetida continua recusada, como antes.
2. **A linha inteira é recusada** quando a interação:
   - tem **data futura**;
   - tem **tipo fora da lista**;
   - não tem tipo, resumo ou data.
3. **Com quem:** é casado com os contatos da empresa, incluindo o contato principal da própria linha. Se não achar, a interação entra sem contato, com pendência.
4. **Origem fora da lista:** entra como veio, com a pendência de incluí-la pelo +.
5. **Tarefa do próximo passo:** a empresa criada pela planilha com próximo passo ganha a tarefa espelhada, como no formulário. Antes, a importação não criava essa tarefa.

## SQL — `sql/prospeccoes_listas_redes.sql` (rodar uma vez; pode repetir)

1. Cria `prospeccao_origens` com as 6 de sempre, mais as origens que as prospecções já usam.
2. Cria `prospeccao_tipos_interacao` com os 7 de sempre, mais os tipos já usados (tirando "Atividade realizada").
3. Tira a trava fixa (CHECK) dos tipos em `prospeccao_interacoes` e aumenta o campo de 20 para 60 letras.
4. Cria `prospeccoes.redes_sociais` (jsonb).
5. Cria a coluna `perm_pros.acao_lists_manage`, já marcada no modelo Administrador.

Depois de rodar: no DEV, feche e abra o app; em produção, reinicie a API do banco.

Sem o SQL:
- as listas mostram os valores de sempre;
- o + e o − avisam qual SQL rodar;
- salvar redes sociais no banco DEV dá erro de campo.

**No DEV, rode antes de salvar modelos de permissão**: a coluna nova precisa existir.

## Conferido

- **Testes:**
  - backend: planilha 19 (6 novos), prospecções 93, contatos, tarefas, social e permissões;
  - tela: 1242 de 1243 (a falha é a antiga do logout), com a bateria nova `prospeccoesListasRedes.test.js`.
- **Postgres descartável**, com o esquema de Prospecções tirado dos SQLs antigos do git:
  - o SQL rodou duas vezes;
  - a origem legada "Instagram" entrou na lista, e "feira" não duplicou "Feira";
  - a trava fixa saiu e o campo foi para 60 letras;
  - o jsonb das redes foi gravado e lido de volta;
  - o histórico das redes registrou o antes e o depois;
  - o tipo "Mensagem no Instagram (DM)", com 26 letras, foi aceito;
  - a importação completa funcionou.
- **Electron:** Nova prospecção (redes e origem), Registrar interação, os modais do + e do −, e o (i) com o site e as redes.
