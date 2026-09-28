# Contatos = fornecedores, prestadores e parceiros (28/09/2026)

O módulo **CRM › Contatos** deixou de ser a lista de pessoas dos clientes e
passou a ser o **cadastro de terceiros** da empresa — fornecedores,
prestadores de serviço, parceiros, arquitetos, representantes — no mesmo
molde do módulo Clientes (ficha com pessoas de contato, endereço,
atividades e a linha do tempo "de rede social"), **sem** ordens, orçamentos
e transportadoras. É daqui que a Contabilidade vai puxar o fornecedor da
NF-e de entrada e o prestador da NFS-e (etapa 3 do plano).

As pessoas de contato dos clientes (`contatos_cliente`, o "Novo contato" da
ficha do cliente) **não mudaram**.

## Decisões do dono

- Coluna nova **Tipo**, escolhida no cadastro numa caixa de seleção com
  **+** e **−** (o mesmo jeito do "Desenhado por" dos produtos). Tipo em uso
  não se exclui.
- A tabela mostra **Nome (a empresa), Tipo, CNPJ, Celular, Telefone** e as
  ações iguais às de Clientes (detalhes, nova pessoa, editar, excluir).
- Nome é o da empresa; a pessoa jurídica tem CNPJ e a física CPF (um ou outro,
  validado e único).

## Banco — `sql/contatos_fornecedores.sql` (rodar e reiniciar a API)

| Tabela | O que é |
| --- | --- |
| `contato_tipos` | a lista do campo Tipo (nasce com Fornecedor, Prestador de serviço, Parceiro, Arquiteto, Representante, Outro) |
| `contatos` | a empresa/pessoa: nome, razão social, `tipo_id`, PJ/PF, CNPJ/CPF (só dígitos, únicos), inscrições, e-mail, telefones, site, endereço `end_*`, status, anotações, quem criou |
| `contato_pessoas` | as pessoas com quem se fala lá (nome, cargo, e-mail, telefones) |
| `contato_interacoes` | as atividades (ligação, e-mail, reunião…), com a pessoa e a tarefa ligada |
| `contato_historico` | a linha do tempo (as mesmas colunas de `cliente_historico`) |
| `perm_ctt` | as permissões novas (ver abaixo) |

A linha do tempo usa as tabelas sociais que já existem
(`historico_comentarios`, `historico_curtidas`, `historico_anexos`,
`notificacoes`) com `origem = 'contato'`. Se alguma tiver CHECK na coluna
`origem`, inclua `'contato'`.

## Permissões (`ctt.*`, em `perm_ctt`)

`ctt.view`, `ctt.search`, `ctt.create`, `ctt.details.view`, `ctt.edit`,
`ctt.delete`, `ctt.person.add/edit/remove`, `ctt.interaction.add`,
`ctt.type.manage` (o + e o −), `ctt.export.csv`, `ctt.import.csv`,
`ctt.report`, `ctt.email.bulk`; colunas `col_ctt_nome`, `col_ctt_tipo`,
`col_ctt_cnpj`, `col_ctt_tel`, `col_ctt_fixo`. A antiga `col_ctt_cliente`
saiu. Estão no catálogo, no SQL e em `permissoes.html`.

## Backend — `backend/contatosController.js` (`/api/contatos`)

`GET /lista`, `GET|POST /tipos`, `DELETE /tipos/:id` (409 se em uso),
`GET /csv/modelo`, `GET|POST /csv/exportar`, `POST /csv/importar`,
`GET /:id` (ficha: contato, pessoas, tipos), `POST /`, `PUT /:id` (pessoas
novas/alteradas/excluídas vão junto), `DELETE /:id`,
`GET|POST|PUT|DELETE /:id/interacoes`. Sem o SQL, 409 com `sql_pendente`.
A linha do tempo é gravada por `backend/contatoHistorico.js`
(`historicoSocial.js` ganhou a origem `contato`). A planilha (modelo,
exportar, importar) vive em `backend/importacaoCsv.js` (`COLUNAS_CONTATO`).

## Tela

`src/html/contatos.html`, `src/css/contatos.css`, `src/js/contatos.js`
(filtros por nome/razão/CNPJ/cidade/e-mail, tipo e status; totais por tipo;
ações CSV). Modais em `src/html/modals/contatos/` (novo, editar, detalhes,
excluir, pessoa, tipo-novo, tipo-excluir) com os scripts
`src/js/modals/contato-*.js`; a parte comum dos modais (abas, PJ/PF, tipo com
+ e −, endereço com CEP, pessoas, coleta dos dados) está em
`src/js/utils/contato-ficha.js`, e a lista de tipos em
`src/js/utils/contato-tipos.js`. O sino abre a ficha do contato
(`window.ContatosModulo.abrirDetalhes`).

## Testes

`backend/contatoHistorico.test.js`, `backend/contatosController.test.js`,
`src/js/__tests__/contatosModulo.test.js`; `padraoControles.test.js` confere
a tela e os 7 modais.

## Fica em aberto

- Tarefas ainda não se ligam a um contato (não há `tarefas.contato_id`).
- "Relatório" e "E-mail em massa" continuam "em desenvolvimento", como em
  Clientes.
- O ícone "Novo contato" da lista de **Clientes** (pessoa do cliente)
  continua pedindo `ctt.create`.
