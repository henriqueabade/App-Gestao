# App-Gestão × Santíssimo Mail: comparação funcional

Rodada de 14/10/2026, pelo lado do App-Gestão.

## Bases da comparação

| Lado | Versão |
| --- | --- |
| App-Gestão | `main` 084335a (v2.9.2) + a vinculação desta rodada, ainda sem commit (`docs/vincular-santissimo-mail.md`) |
| Santíssimo Mail | branch `feature/smail-paridade-appgestao-20261014`, HEAD fbc9030, clonada do GitHub numa pasta à parte (a pasta local do Mail não foi tocada) |
| API central | `origin/main` 8fd0a48 (integração smail) e branch `feature/smail-vinculacao-automatica-20261013` (342361b, não publicada) |

O Mail já tem uma matriz própria, `docs/paridade-app-gestao.md`. Os
inventários dele, em `docs/paridade/`, citam `arquivo:linha` deste mesmo
084335a e não foram refeitos aqui.

Esta comparação faz três coisas:
1. confere cada "depende da API" contra as rotas reais da API;
2. aponta onde o Mail se enganou;
3. diz o que fazer em cada linha.

## Achados que mudam decisões

1. **A vinculação automática não se encaixa entre o Mail e a API.**
   - **O Mail** manda numa chamada só `POST /vinculos/automatico {caixa, identidade}`, com emissor, sujeito e e-mail, e põe `identidade` no `POST /vinculos`.
   - **A API (342361b)** pede duas etapas: primeiro `POST /vinculos/automatico/desafios`, depois `POST /vinculos/automatico {desafio, id_token, caixa}`. No `POST /vinculos`, ela aceita `desafio` e `id_token`.
   - **O que isso quebra:** a API recusa campo que não conhece (`integracoes/smail/rotas/comum.js:111`, 400 "Campo não aceito"). Se o Mail ligar `APP_GESTAO_AUTO_LINK` antes de alinhar, **até a vinculação por código falha**.
   - **O que fazer:** o Mail adota o desafio e o `id_token` da API, que dão uma prova mais forte (assinada e de uso único). Até lá, a flag fica desligada dos dois lados.
2. **O sino existe na API e o Mail não o usa.**
   - `GET /notificacoes` e `POST /notificacoes/lidas` estão em `integracoes/smail/rotas/perfil.js:70-112` (8fd0a48, escopo perfil).
   - O Mail diz que são "só proposta" (item 6 da lista dele).
3. **A API classifica os avisos com uma cópia antiga das categorias.**
   - Ela usa `integracoes/smail/app-gestao/categorias-aviso.js`, que ainda não sabe que `origem: smail` é "conta".
   - No programa já está certo: `backend/notificacoesController.js` usa o arquivo daqui.
   - Pelo Mail, o aviso de segurança sairia como "Vendas e pedidos".
4. **A "Caixa de entrada" das tarefas está confirmada.**
   - É "abertas sem lista" (`rotas/tarefas.js:255`, `t.lista_id IS NULL`), igual ao App-Gestão.
   - O risco que o Mail anotou sobre isso pode sair do documento dele.
5. **Os outros "depende da API" do Mail estão certos.**
   - `GET /tarefas` só aceita `visao`, `lista`, `marcador`, `usuario` e `q`.
   - Não tem visão de canceladas.
   - A etapa da prospecção só aceita `{etapa, motivo_perda}`.
   - O `/me` não traz permissão de exportar.

## Matriz

Siglas da coluna "Contrato necessário":
- **existe**: já está na API 8fd0a48;
- **branch**: está só na 342361b;
- **novo**: falta escrever.

### Vinculação e segurança

| Funcionalidade | App-Gestão atual | Mail desenvolvido | Diferença | Contrato necessário | Ação recomendada |
| --- | --- | --- | --- | --- | --- |
| Gerar o código | Sino › "Gerar código para o Santíssimo Mail". Escolhe os escopos, 10 min, uma vez, copiar, gerar outro (nesta rodada) | Campo do código e passos que mandam ao sino com a mesma frase | Nenhuma (texto alinhado) | existe: `POST /vinculos/codigos` | Homologar junto (ordem abaixo) |
| Ver e encerrar vínculos | "Meus vínculos": caixa, escopos, situação, último uso, Encerrar com confirmação | "Conectado" e desvincular do lado do Mail | Os dois lados encerram | existe: `GET/DELETE /meus-vinculos`, `DELETE /vinculos/:id` | Homologar: encerrar de um lado tira o acesso do outro |
| Reconhecimento automático | Mostra "Entra sozinho" / "Só com código" só se a API mandar o campo | Servidor e tela atrás de `APP_GESTAO_AUTO_LINK=off` | **Contratos diferentes** (achado 1) | branch: desafio + `id_token` | Mail alinha com a 342361b. Ninguém liga a flag antes |
| Pré-autorização pelo Sup Admin | Não feita; o backend nem repassa `/admin/*` | Fora do escopo do Mail | — | branch: `/admin/preautorizacoes` com `SMAIL_AUTO_LINK_ADMIN=on` | Tela só depois do contrato publicado e homologado |
| Aviso de segurança | `smail_preautorizacao` no sino, sempre visível; abre a janela | Não lê o sino | Pelo Mail, sairia como "Vendas" | existe (sino) + cópia das categorias na API | API: copiar o `categorias-aviso.js` daqui |

### CRM — clientes e contatos

| Funcionalidade | App-Gestão atual | Mail desenvolvido | Diferença | Contrato necessário | Ação recomendada |
| --- | --- | --- | --- | --- | --- |
| Lista de clientes | Status, dono, busca, totais por status, CSV, filtros avançados | CNPJ, status, ordem, totais (somados no Mail, até 2.000) | CSV e filtros avançados só aqui | existe; novo opcional: totais no servidor | Manter. Pedir totais no servidor se ficar lento |
| Ficha do cliente | Dados, 3 endereços, contatos, fiscais, redes, origem, histórico social, pedidos, orçamentos, transportadoras | Resumo, Empresa, endereços de registro e entrega, contatos, atividades | Faltam fiscais, cobrança, redes, origem, histórico | novo: ampliar `GET /clientes/:id`; notas e histórico só de leitura | API: leitura primeiro |
| Cadastro e exclusão de cliente | Completo; excluir com motivo | Rápido, com situação e máscara de CNPJ | Cadastro curto | novo: `clienteEntrada` ampliado | API, depois da leitura. Excluir fica no desktop |
| Contatos (fornecedores) | Tipo com + e −, PF/PJ, IE, IM, site, fixo, status, endereço, redes | Lista, filtro por tipo, ficha, máscara, tipos sugeridos | Faltam status, IE, IM, site, fixo, endereço e a lista de tipos | novo: `contatoEntrada` ampliado, filtro `status`, `GET` dos tipos | API |

### Prospecções e funil

| Funcionalidade | App-Gestão atual | Mail desenvolvido | Diferença | Contrato necessário | Ação recomendada |
| --- | --- | --- | --- | --- | --- |
| Lista, filtros e funil | Etapa, probabilidade, responsável, passo, origens com + e −, filtros por origem, valor, país e estado, funil | Igual, mais o funil calculado no Mail (até 20 chamadas por pedido) | Faltam os filtros por origem, valor e país; a origem não vem | novo: origem no resumo; `GET /prospeccoes/funil` no servidor | API. O funil no servidor tira as 20 chamadas e o risco de limite |
| Mover no funil | Qualquer etapa, com probabilidade e observação; ganho exige Razão Social, Nome Fantasia e CNPJ; perdido exige motivo | Diálogo, motivo, trava do ganho | Não grava probabilidade nem observação | novo: `PATCH /etapa {probabilidade, observacao}` | API |
| Próximo passo e concluir passo | Concluir com nota e passo seguinte | Concluir em 2 chamadas | Falta encerrar sem novo passo; não é atômico | novo: `POST /prospeccoes/:id/concluir-passo` | API |
| Criar, editar, converter, responsável, excluir | Desktop | — | Só no desktop | novo (5 rotas) | Por último. Converter cria cliente: testar no DEV/PG descartável |

### Atividades

| Funcionalidade | App-Gestão atual | Mail desenvolvido | Diferença | Contrato necessário | Ação recomendada |
| --- | --- | --- | --- | --- | --- |
| Registrar interação | Tipo da lista (com + e −), quando, com quem, duração, resumo, detalhe | Tipo (7 fixos), quando, resumo, detalhe | Faltam "com quem", duração e os tipos personalizados | novo: `contato_id`, `duracao_min`, `GET` dos tipos | API |
| Editar e excluir interação | Desktop | — | Só no desktop | novo: `PATCH/DELETE` | API, depois das acima |

### Tarefas

| Funcionalidade | App-Gestão atual | Mail desenvolvido | Diferença | Contrato necessário | Ação recomendada |
| --- | --- | --- | --- | --- | --- |
| Listas inteligentes | Caixa de entrada, Hoje, 7 dias… e Canceladas | Os mesmos nomes; a "caixa" está confirmada (achado 4) | Canceladas | novo: visão `canceladas` | API. O Mail tira o risco da "caixa" |
| Criação rápida, quadro, grupos, ordenação, Meu dia | Tudo, sobre todas as tarefas | Feito; grupos e ordem só na página (50) | A ordem é parcial | novo: `ordem` em `GET /tarefas` | API |
| Bloco "Tarefas" na ficha | Na ficha do cliente e da prospecção | O Mail varre `GET /tarefas` | Custo de chamadas | novo: filtro `vinculo_tipo` + `vinculo_id` | API |
| Listas, marcadores, automáticas, estatísticas | Desktop (automáticas por pessoa) | Lê listas e marcadores (`/tarefas/contexto`) | A gestão é só no desktop | novo (pouco valor no webmail) | Manter no desktop |
| Convites e participação | Aceitar/Recusar no sino e na tarefa | Já havia | — | existe | Nenhuma |

### Agenda

| Funcionalidade | App-Gestão atual | Mail desenvolvido | Diferença | Contrato necessário | Ação recomendada |
| --- | --- | --- | --- | --- | --- |
| Mês, semana, dia, grade, Equipe, arrastar, feriados | Desktop | Feito (grade, Equipe com `verOutros`, arrastar) | Nenhuma relevante | existe: `GET /agenda`, `PATCH /tarefas/:id` | Homologar o arrastar com uma tarefa de teste |
| Exportar .ics | Desktop | — | Só no desktop | novo: `tarefas.export` no `/me` + rota .ics | Baixa prioridade |

### Chat e notificações

| Funcionalidade | App-Gestão atual | Mail desenvolvido | Diferença | Contrato necessário | Ação recomendada |
| --- | --- | --- | --- | --- | --- |
| Chat interno | Conversas, canais, presença, menções, citações, anexos de 1 ano, diretas vazias fora da lista | Igual, em abas; 1 ano e 410; as diretas vazias já vêm filtradas da API (`chat/chat.js`) | Só o desenho (abas × lateral) | existe | Nenhuma |
| Sino | Categorias, dispensar, convite com botões, avisos no canto do Windows | **Não tem** (achado 2) | O Mail não tem sino | existe: `GET /notificacoes`, `POST /notificacoes/lidas` | Mail: consumir. API: dispensar, se quiserem igual |
| Avisos no Windows, bandeja, som | Desktop | — | Só no desktop | — | Fora (não se aplica ao webmail) |

### Permissões

| Funcionalidade | App-Gestão atual | Mail desenvolvido | Diferença | Contrato necessário | Ação recomendada |
| --- | --- | --- | --- | --- | --- |
| Permissões efetivas | Modelos por módulo; a API em "observar" por tabela (2.8.0) | `/me.pode`, calculado pela API (`efetivas.js`) dentro dos escopos do vínculo | Faltam exportar, criar prospecção e excluir (as rotas também não existem) | novo: cada ação nova em `ACOES`, junto da rota | API, rota a rota |
| Escopos do vínculo | A pessoa escolhe os 5 ao gerar o código | Respeita os escopos | — | existe | Homologar: código só com CRM → o Mail não mostra tarefas |
| Passar de "observar" a "bloquear" na API | Pendente do OK do dono | Usa só a integração smail, que tem trava própria | — | — | Não depende do Mail |

### Só no desktop (o Mail não tem e não precisa ter agora)

- Pedidos e orçamentos
- Produção
- Financeiro: boletos e cobrança BB
- NF-e e DANFE
- Contabilidade
- Relatórios
- Produtos e matéria-prima
- Expedição e etiquetas
- Devoluções e trocas
- Dashboard
- Usuários, Termos de Uso e modelos de permissões

No chat do Mail, as citações `#pedido` e `#orcamento` já aparecem pelo
`/referencias/resolver`, com o que a pessoa pode ver.

## Contratos adicionais (para a sessão da API central)

Em ordem de prioridade. Nada disto foi feito na API.

**P0 — antes de ligar qualquer flag automática**
1. Alinhar a vinculação automática entre o Mail e a branch 342361b (achado 1). Testar junto num ambiente que não seja produção.

**P1 — pequenos**
2. Copiar `src/js/utils/categorias-aviso.js` daqui para `integracoes/smail/app-gestao/` (origem `smail` → "conta").
3. Publicar `reconhecimento_automatico` em `GET /meus-vinculos`. Já está na branch; a tela daqui já sabe mostrar.

**P2 — leitura do CRM**
4. Ficha do cliente ampliada: fiscais, cobrança, redes, origem.
5. Origem no resumo da prospecção.
6. Em `GET /tarefas`: filtro por vínculo, `ordem` e a visão `canceladas`.
7. `GET` dos tipos de atividade e de contato.

**P3 — escrita do CRM**
8. Atividade com `contato_id` e `duracao_min`, mais editar e excluir.
9. `PATCH /etapa` com `probabilidade` e `observacao`.
10. `POST /concluir-passo`.
11. `clienteEntrada` e `contatoEntrada` ampliados.

**P4**
12. Criar, converter e excluir prospecção.
13. Funil e totais calculados no servidor.
14. Exportar .ics.
15. Dispensar aviso no sino.
16. Cada ação nova também entra em `efetivas.js`.
