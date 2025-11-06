# Testes Manuais - Bootstrap de Permissões

## Objetivo
Validar manualmente o comportamento do menu, grid de usuários e botões de ação
com base nas permissões retornadas por `/auth/permissions/bootstrap`.

## Preparação
1. Inicie o backend com respostas distintas para os papéis **Sup Admin** e
   **Operacional**, garantindo que o endpoint envie `menu`, `features` e `columns`
   compatíveis com os cenários abaixo.
2. Limpe o `sessionStorage`/`localStorage` antes de cada cenário ou utilize
   janelas anônimas para evitar cache do bootstrap.
3. Confirme, via DevTools (aba Network), que a requisição para
   `/auth/permissions/bootstrap` retorna `200` na primeira carga e `304` nas
   subsequentes.

## Cenário 1 — Sup Admin
1. Autentique-se com um usuário Sup Admin.
2. Garanta que os itens de menu recebidos contenham o grupo completo do CRM e a
   página **Usuários**.
3. Abra o menu lateral e verifique se:
   - Todos os módulos retornados no bootstrap estão presentes e ordenados.
   - O submenu do CRM pode ser aberto/fechado sem recarregar a página.
4. Acesse **Usuários** e valide se a tabela exibe todas as colunas, inclusive a
   coluna **Ações**, com os botões **Ativar/Desativar**, **Editar** e **Excluir**
   habilitados.
5. Clique no botão de notificação e confirme que as notificações são carregadas
   normalmente (badge visível, botão habilitado).

## Cenário 2 — Operacional
1. Autentique-se com um usuário Operacional.
2. Verifique que o menu lateral exibe apenas os módulos liberados para o papel e
   que itens ausentes no bootstrap não aparecem.
3. Acesse **Usuários** e confirme que:
   - Colunas com `visibility: hidden` ou `can_view: false` estão ocultas tanto no
     cabeçalho quanto nas linhas.
   - A coluna **Ações** apresenta os botões desabilitados ou ocultos conforme o
     retorno de `features/columns`.
4. Abra o botão de notificações e valide que ele permanece desabilitado, sem
   badge, caso o bootstrap não conceda acesso.

## Observações
- Qualquer alteração no endpoint deve ser seguida de um `force refresh` no
  bootstrap (limpar storage ou usar hard reload) para garantir que a resposta
  mais recente seja aplicada.
- Em caso de falha no carregamento do bootstrap, o menu volta ao layout estático
  anterior e o botão de notificações utiliza o fallback por perfil.
