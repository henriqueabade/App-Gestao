# Santissimo Decor Dashboard

Este projeto é um aplicativo desktop baseado em Electron para gerenciar o fluxo de trabalho interno da **Santíssimo Decor**. Ele incorpora uma API Express e se conecta a um banco PostgreSQL para lidar com autenticação de usuários, informações de clientes e estoque de matéria‑prima.

## Requisitos

- **Node.js** (testado na versão 18+)
- **npm**
- Servidor **PostgreSQL**

## Configuração

1. Instale o Node.js e o PostgreSQL em sua máquina.
2. Clone este repositório e instale as dependências:
   ```bash
   npm install
   ```
3. Crie um banco PostgreSQL chamado `Santissimo_Decor_App_Gestao` (ou defina a variável `DB_NAME` com outro nome). Configure também as variáveis de ambiente de conexão:
   - `DB_USER`
   - `DB_PASSWORD`
   - `DB_HOST` (opcional, padrão `localhost`)
   - `DB_PORT` (opcional, padrão `5432`) – valor inicial da porta, sobrescrito pelo **PIN** informado na tela de login
   - `DB_NAME` (opcional, padrão `Santissimo_Decor_App_Gestao`)
   - `API_PORT` (opcional, padrão `3000`)
   Essas variáveis podem ser colocadas em um arquivo `.env` ou exportadas no ambiente antes de iniciar o app. Um exemplo de
   configuração pode ser encontrado em [`.env.example`](./.env.example). Se o banco de dados estiver em outra máquina, defina
   `DB_HOST` com o endereço desse servidor. Por exemplo:

  ```bash
  DB_HOST=192.168.21.157
  ```
  O número informado no campo **PIN** da tela de login ou cadastro define a
  porta utilizada para conectar ao banco de dados. Uma vez autenticado com um
  PIN válido, ele é lembrado nas próximas sessões, sendo substituído caso outro
  código seja utilizado.
4. Crie manualmente as tabelas esperadas pelo aplicativo (`usuarios`, `clientes`, `materia_prima`, etc.), pois não há scripts de migração.

## Execução em desenvolvimento

Inicie o aplicativo Electron com:
```bash
npm start
```
Esse comando inicia o app desktop e também a API Express na porta `3000` por padrão.

Se desejar rodar apenas a API utilize:
```bash
node backend/server.js
```
A aplicação Electron se comunica com essa API durante o desenvolvimento.

## Geração de instalador

Para criar um instalador execute:
```bash
npm run dist
```
O instalador será colocado na pasta `Instalador` da sua área de trabalho, conforme configurado em `electron-builder.config.js`. O script do instalador fica em `build/installer.nsh`.
Ao rodar o instalador, ele verifica se o aplicativo já está presente no sistema.
Se a versão instalada for igual ou mais recente, a instalação é cancelada e
é exibida uma notificação. Se a versão nova for superior, o instalador
continua e realiza a atualização automaticamente.
