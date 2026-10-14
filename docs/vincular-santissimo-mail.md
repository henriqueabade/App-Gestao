# Vincular ao Santíssimo Mail

Rodada de 14/10/2026. Cada pessoa liga a própria caixa de e-mail do
Santíssimo Mail ao App-Gestão pelo **sino** do topo. Dentro do Mail ela vê
clientes, prospecções, contatos, tarefas, agenda e chat, sempre com o que o
perfil dela já permite aqui.

## Onde fica

- **Sino › rodapé "Gerar código para o Santíssimo Mail"** (em qualquer
  tela): abre a janela. É a frase que o próprio Mail manda escolher no
  sino; se mudar aqui, muda lá também.
- **Aviso de segurança no sino** (`smail_preautorizacao`, origem `smail`,
  escudo): abre a mesma janela. É da categoria "conta": aparece sempre,
  mesmo com as categorias do sino desmarcadas em Configurações ›
  Notificações.

## A janela

### Novo vínculo

1. A pessoa escolhe o que o Mail poderá fazer: **CRM**, **Tarefas**,
   **Calendário**, **Chat** e **Perfil**. Os cinco nascem marcados. Sem
   nenhum marcado, a janela pede para escolher e nada sai do programa.
2. **Gerar código**: a API central devolve 10 letras e números
   (sem 0, 1, I e O), mostrados em dois grupos de 5 para ditar.
3. O código vale **10 minutos e uma vez só**. A contagem corre na tela. No
   último minuto a caixa fica amarela.
4. **Copiar** copia o código sem o espaço do meio.
5. **Gerar outro** faz o anterior deixar de valer. A API invalida os
   pendentes da pessoa.
6. Venceu: o código some da tela e da memória, aparece "O código venceu"
   e a lista de vínculos é recarregada (pode ter sido usado nesse meio-tempo).

### Meus vínculos

Cada caixa vinculada mostra:

- o e-mail;
- a situação: **Ativo**, **Encerrado** ou **Vencido**;
- o que o Mail pode fazer;
- quando foi vinculada, o último uso e até quando vale.

Os ativos vêm primeiro, do mais novo ao mais antigo.

- **Encerrar** (só nos ativos) pede confirmação e corta o acesso na hora.
  Para voltar, gera-se um novo código.
- **Reconhecimento automático**: só aparece se a API mandar o campo
  `reconhecimento_automatico`. Hoje ela ainda não manda. Com `true`, aparece
  "Entra sozinho pelo Mail", e a confirmação de encerrar avisa que isso
  também é desligado. Com `false`, aparece "Só com código". Sem o campo,
  a janela não diz nada.

### Quando dá errado

| Situação | O que a pessoa lê |
| --- | --- |
| Muitos códigos seguidos (429) | "Muitos códigos em pouco tempo. Tente de novo em 7 min." (o tempo vem do `Retry-After`) |
| Integração desligada ou fora do ar (503) | "A integração com o Santíssimo Mail está desligada ou fora do ar no momento." |
| Programa no banco DEV | O mesmo 503, explicando que no DEV não há API central |
| API central sem as rotas (404 sem `nao_encontrado`) | "O servidor ainda não tem a vinculação com o Santíssimo Mail." |
| Sessão vencida (401) | Pede para entrar de novo no programa |
| Perfil sem permissão (403) | Diz que o perfil não pode |
| Vínculo que já não existe (404) | Diz que não existe mais e recarrega a lista |
| Sem rede (502 / falha) | "Sem conexão com o servidor…" |

## Segurança

- O código **só existe na memória da janela**. Não vai para aviso do sino,
  banco, URL, log, `localStorage` nem `sessionStorage`. Fechar, apertar Esc,
  vencer ou gerar outro apagam o código.
- O backend do programa (`backend/smailVinculosController.js`) repassa à API
  central **só três rotas** do próprio usuário:
  - `POST /api/integracoes/smail/v1/vinculos/codigos`
  - `GET /api/integracoes/smail/v1/meus-vinculos`
  - `DELETE /api/integracoes/smail/v1/meus-vinculos/:id`

  O que o Mail usa (troca do código, token, `/me`, CRM…) e a administração
  (`/admin/preautorizacoes`) respondem 404 aqui, sem chegar à API. As
  respostas saem com `Cache-Control: no-store`.
- Escopo desconhecido e id fora do formato são recusados antes de sair do
  programa.
- O token da sessão vai como em todo o resto (cabeçalho `Authorization`).

## Vinculação automática

- A tela já sabe mostrar o reconhecimento automático, mas não depende dele.
- A pré-autorização pelo administrador **não foi feita aqui e fica
  desligada**. O backend nem repassa `/admin/*`. Só entra depois que o
  contrato da API (branch `feature/smail-vinculacao-automatica-20261013`)
  for publicado e homologado com o Mail.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `backend/smailVinculosController.js` | o repasse das três rotas, montado em `server.js` antes do proxy genérico |
| `src/js/utils/smail-vinculo.js` | a janela (`window.SmailVinculo.abrir()`) |
| `src/styles/smail-vinculo.css` | o vidro padrão, o código, os vínculos (antes de `controles.css`) |
| `src/js/notifications.js` | o rodapé do sino, o ícone e a dica do aviso de segurança |
| `src/js/utils/categorias-aviso.js` | origem `smail` → categoria "conta" (sempre aparece) |
| `src/js/aviso-windows.js` | o ícone do aviso no canto da tela |

## Testes

- `backend/smailVinculos.test.js`, contra uma API de mentira em 127.0.0.1:
  - o token vai junto, o código volta sem cache e nunca sai em log;
  - os escopos seguem a ordem do contrato;
  - 429, 503, 204 e 404 passam como vieram;
  - as rotas do serviço e da administração dão 404 sem chegar à API;
  - "sem_rota" e 502.
- `src/js/__tests__/smailVinculo.test.js`:
  - formato do código, contagem do tempo e mensagens de erro;
  - situação e ordem dos vínculos;
  - nada de storage, log ou URL com o código;
  - as ligações no sino e no menu.
- `backend/categoriasDoSino.test.js`: `smail_preautorizacao` → "conta".
