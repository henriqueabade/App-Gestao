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
medidas e confere cada módulo já padronizado.
