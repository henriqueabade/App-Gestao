# App-Gestão (Santíssimo Decor) — instruções do projeto

Aplicativo Electron (tela em `src/`, API local em `backend/`). Textos,
comentários e documentação em português.

## Telas: leia antes de mexer

- `docs/padroes-de-interface.md` — seção 5: o que vale em todo lugar
  (Tailwind pré-compilado, cores dos botões, vidro dos modais, rolagem,
  tabelas dos modais, caixas de diálogo).
- `docs/padrao-visual-controles.md` — **tamanho dos botões principais, dos
  campos e das letras** (decisão do dono, 21/09/2026).

## Padrão de botões, campos e letras

- Medidas em `src/styles/controles.css`: botão principal de 40 px, letra de
  14 px, peso 600; campo de 40 px com letra de 14 px; rótulo de 13 px;
  tabela com linhas de 14 px e cabeçalho de 12 px.
- Tela nova ou mexida: botão principal = `ctl-botao` + a cor (`btn-*`);
  campo = `ctl-campo`; rótulo = `ctl-rotulo`; `ctl-padrao` na raiz da tela
  ou do modal. Nada de `text-base`/`text-lg`/`py-3`/`px-6` em botão ou campo.
- **Não mudar** etiquetas e botões em forma de etiqueta (status, DANFE,
  "Hoje / Amanhã", períodos, marcadores) nem os ícones de ação das linhas.
- A passagem dos módulos antigos é **um módulo por vez**, com todos os
  modais dele (e os modais abertos de dentro deles), na ordem do menu, e só
  depois do "ok" do dono no anterior. A fila está no documento.

## Testes

`node --test src/js/__tests__/` (tela). `padraoControles.test.js` trava as
medidas e confere cada módulo já padronizado. No Node 24 a pasta não é
aceita: use `node --test "src/js/__tests__/*.test.js"`. Na VPS, rode sem rede,
com `--test-force-exit --test-timeout=60000` (sem isso o backend trava em
`clientesResumo.test.js`): comando na seção 8 do documento abaixo.

## Ambientes e banco de dados — REGRA DEFINITIVA (21/10/2026)

Leia `docs/ambientes-dev-e-migracoes.md` antes de mexer em banco, `.env`,
integração ou SQL.

| Ambiente | Quem executa SQL | O que o Claude faz |
| --- | --- | --- |
| **DEV VPS** (`Santissimo_Decor_App_Gestao_Dev_VPS`, 127.0.0.1:5432, `app_gestao_dev`) | **o Claude, sozinho, sem esperar OK** | desenvolve, executa, testa, corrige, valida e registra |
| **DEV Windows** (banco local do dono) | **o dono** | entrega o SQL no Git e diz qual aplicar; **nunca acessa esse banco** |
| **Produção** | **ninguém** sem autorização específica e expressa | entrega o SQL no Git; executa só com ordem expressa para aquele SQL |

- **Antes de alterar o DEV VPS:** confirmar a identidade do banco (nome, marca
  `app-gestao:dev-vps`, usuário DEV, conexão local), ter backup e garantir que
  nada atinge a produção ou o Windows. Com risco de atingir outro ambiente,
  bloquear a operação até eliminar o risco.
- A homologação no Windows é responsabilidade do dono e **não** é condição para o
  Claude seguir trabalhando na VPS.
- A homologação aprovada **não** autoriza a produção.
- O projeto passa pelo Syncthing (sem `.git`, `node_modules` e `.env`): cada
  máquina tem o seu git e o seu `.env`. O Claude não commita (deixa na árvore e
  sugere a mensagem) e não faz pull, push, checkout, reset ou restore sem o dono
  pedir.

### Onde vai cada SQL

- **SQL do aplicativo** (vai ao Windows e, por decisão do dono, à produção):
  - arquivo novo em `migracoes/AAAAMMDD_HHMM_descricao.sql`, com cabeçalho
    (`migracao`, `descricao`, `requer`, `escopo: app`, `transacao`,
    `destrutiva`) e pré-condições;
  - registrado em `migracoes/manifesto.json`, que congela o SHA-256;
  - conferido com `node scripts/migracoes/cli.js verificar`;
  - aplicado na VPS com `cli.js aplicar <id> --ambiente dev-vps ...`, que confere
    banco, marca, ordem, dependências e backup, e roda em transação com trava;
  - testado; depois, avisar o dono qual id aplicar no Windows.
  - Arquivo aplicado ou registrado não muda: correção é migração nova.
- **SQL exclusivo da VPS** (sanitização, credenciais, marca, sequências, controle
  interno, dados fictícios):
  - em `scripts/dev-vps/*.sql`, executado direto por
    `node scripts/dev-vps/operacao-vps.js <script>`, que faz backup verificado e
    registra em `controle.operacoes_dev_vps` e em `~/app-gestao-dev-vps/registros/`;
  - nunca vai ao Windows nem à produção.
- A pasta `sql/` é a antiga (fora do Git): não usar para SQL novo.
- O registro do que foi aplicado onde fica na seção 7 do documento. Mantenha-o
  atualizado.

### Isolamento da VPS (não desligar)

- `/etc/app-gestao/ambiente-isolado` liga a trava do `.env`
  (`backend/ambienteIsolado.js`): o app não inicia sem o `.env` DEV seguro.
- Liga também a barreira de rede (`backend/barreiraDeRede.js` + Chromium em
  `main.js`): nada sai do computador. Liberar um host em `DEV_REDE_PERMITIDA`
  só com autorização do dono, e nunca um de produção.
- `backend/localDatabase.js` exige a marca do banco.
- O `.env` DEV vem de `scripts/dev-vps/gerar-env-dev-vps.js`. A conta do dono
  no DEV é `dono@exemplo.invalid`, com a senha DEV em
  `~/app-gestao-dev-vps/senha-usuarios-dev.txt`.
- Um dump com dados reais (numa re-clonagem do Windows) fica em `~/dumps-dev/`.
  Ele nunca entra no repositório, e o conteúdo não se abre. Depois de conferir o
  banco sanitizado, apaga-se com o OK do dono. Hoje a VPS só tem o backup de
  referência sanitizado, `…-banco-sanitizado-verificado/` (seção 3.7 do documento).

### Regras que não se quebram

- Nunca reutilizar segredo de produção nem a `SEGREDOS_CHAVE_MESTRA` de
  produção no DEV.
- Nunca versionar `.env`, token, certificado ou senha.
- Nunca conectar ao PostgreSQL ou à API de produção (nem por túnel/ngrok).
- Nunca SMTP real, notificação a contato real, credencial bancária real,
  emissão fiscal de produção.
- Nunca expor segredo ou dado pessoal em log, relatório ou Git: mostrar só
  nomes de chave, contagens e formas mascaradas. Nunca agrupar, ordenar ou
  exibir coluna de texto livre de dados reais.
- Em falha: parar, preservar estado, backups e registros, mostrar o erro, não
  improvisar correção destrutiva e pedir orientação se houver risco de perda
  de dados ou de atingir outro ambiente.
