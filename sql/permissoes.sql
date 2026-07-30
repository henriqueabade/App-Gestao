-- =====================================================================
-- ESTRUTURA DE PERMISSÕES — App-Gestao
-- Gerado a partir do modal de permissões (fonte única: backend/permissionsCatalog.js)
--
-- Modelo:
--   modelos_permissoes  ......... perfis de permissão (ex.: "Vendedor", "Admin")
--   usuarios.modelo_permissoes_id  vincula o usuário a um perfil
--   perm_<modulo> ............... 1 linha por perfil, 1 coluna booleana por permissão
--                                 modulo_ativo = módulo visível no menu
--
-- Regra: TRUE = permitido (marcado) | FALSE = negado (desmarcado)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Perfis de permissão
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modelos_permissoes (
  id           SERIAL PRIMARY KEY,
  nome         VARCHAR(120) NOT NULL UNIQUE,
  descricao    TEXT,
  criado_em    TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 2) Vínculo usuário -> perfil
-- ---------------------------------------------------------------------
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS modelo_permissoes_id INTEGER
  REFERENCES modelos_permissoes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_modelo_permissoes
  ON usuarios(modelo_permissoes_id);

-- ---------------------------------------------------------------------
-- 3) Matéria-prima  (perm_mp)  —  18 ações, 5 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_mp (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.search · Buscar/filtrar
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.create · Cadastrar insumo
  acao_totals_view                   BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.totals.view · Ver totais por tipo
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.edit · Editar insumo
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.delete · Excluir insumo
  acao_stock_edit                    BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.stock.edit · Editar quantidade em estoque
  acao_stock_infinite_toggle         BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.stock.infinite_toggle · Alternar estoque infinito
  acao_category_view                 BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.category.view · Selecionar categoria
  acao_category_create               BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.category.create · Cadastrar categoria
  acao_category_delete               BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.category.delete · Excluir categoria
  acao_unit_view                     BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.unit.view · Selecionar unidade
  acao_unit_create                   BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.unit.create · Cadastrar unidade
  acao_unit_delete                   BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.unit.delete · Excluir unidade
  acao_process_view                  BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.process.view · Selecionar processo
  acao_process_create                BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.process.create · Cadastrar processo
  acao_process_delete                BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.process.delete · Excluir processo
  acao_process_order                 BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.process.order · Resolver ordem duplicada

  -- Colunas visíveis
  col_mp_nome                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_mp_estoque_atual               BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade
  col_mp_unidade                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Unidade
  col_mp_custo_medio                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Preço Unitário
  col_mp_campo_descricao             BOOLEAN NOT NULL DEFAULT FALSE  -- Descrição
);

-- ---------------------------------------------------------------------
-- 4) Produtos  (perm_prod)  —  25 ações, 20 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_prod (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.search · Buscar/filtrar
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.create · Cadastrar produto
  acao_stock_view                    BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stock.view · Ver estoque
  acao_details_view                  BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.details.view · Visualizar produto
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.edit · Editar produto
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.delete · Excluir produto
  acao_item_add                      BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.item.add · Adicionar item
  acao_item_edit                     BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.item.edit · Editar item
  acao_item_remove                   BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.item.remove · Remover item
  acao_clear                         BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.clear · Limpar tudo
  acao_percent_edit                  BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.percent.edit · Editar percentagens
  acao_collection_create             BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.collection.create · Cadastrar coleção
  acao_collection_delete             BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.collection.delete · Excluir coleção
  acao_clone                         BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.clone · Clonar produto
  acao_registro_toggle               BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.registro.toggle · Alternar registro
  acao_pdf                           BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.pdf · Gerar PDF
  acao_stage_insert                  BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stage.insert · Registrar processo
  acao_stage_item_add                BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stage.item.add · Inserir item no processo
  acao_stage_item_edit               BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stage.item.edit · Editar item do processo
  acao_stage_item_remove             BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stage.item.remove · Excluir item do processo
  acao_stage_clear                   BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stage.clear · Limpar itens do processo
  acao_stock_input                   BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stock.input · Adicionar ao estoque
  acao_stock_adjust                  BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stock.adjust · Somar ao existente
  acao_stock_lote_delete             BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stock.lote.delete · Excluir lote de estoque

  -- Colunas visíveis
  col_prod_sku                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_prod_nome                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_prod_colecao                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Coleção
  col_prod_preco_base                BOOLEAN NOT NULL DEFAULT FALSE,  -- Preço de Venda
  col_prod_margem                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Margem (%)
  col_prod_estoque                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade
  col_ins_mp                         BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome do item
  col_ins_qtd                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade
  col_ins_unidade                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Unidade
  col_ins_custo_un                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor unitário
  col_ins_custo_total                BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor total
  col_etapa_item                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Item
  col_etapa_qtd                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade
  col_etapa_unidade                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Unidade
  col_etapa_valor_un                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor unitário (R$)
  col_etapa_valor_total              BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor total (R$)
  col_est_processo                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Processo atual
  col_est_ultimo_item                BOOLEAN NOT NULL DEFAULT FALSE,  -- Último item
  col_est_quantidade                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade em estoque
  col_est_alterado_em                BOOLEAN NOT NULL DEFAULT FALSE  -- Última alteração
);

-- ---------------------------------------------------------------------
-- 5) Orçamentos  (perm_orc)  —  17 ações, 30 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_orc (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.search · Buscar/filtrar
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.create · Criar orçamento
  acao_view_details                  BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.view.details · Visualizar orçamento
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.edit · Editar orçamento
  acao_convert                       BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.convert · Converter em pedido
  acao_export                        BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.export · Baixar PDF
  acao_item_add                      BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.item.add · Inserir item
  acao_item_edit                     BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.item.edit · Editar item
  acao_item_remove                   BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.item.remove · Remover item
  acao_clear                         BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.clear · Limpar tudo
  acao_send                          BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.send · Salvar e enviar
  acao_status_change                 BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.status.change · Alterar status
  acao_clone                         BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.clone · Clonar orçamento
  acao_convert_decide                BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.convert.decide · Decidir produção das peças
  acao_convert_justify               BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.convert.justify · Justificar saldo negativo
  acao_item_replace                  BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.item.replace · Substituir peça

  -- Colunas visíveis
  col_orc_num                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_orc_cliente                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Cliente
  col_orc_data                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_orc_total                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor Total
  col_orc_cond_pagto                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Condição
  col_orc_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_orc_it_nome                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Item
  col_orc_it_qtd                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Qtd.
  col_orc_it_preco                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Un R$
  col_orc_it_preco_desc              BOOLEAN NOT NULL DEFAULT FALSE,  -- Un c/desconto
  col_orc_it_desc                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Desconto %
  col_orc_it_subtotal                BOOLEAN NOT NULL DEFAULT FALSE,  -- Total R$
  col_conv_peca                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Peça
  col_conv_qtd_orcada                BOOLEAN NOT NULL DEFAULT FALSE,  -- Qtd Orçada
  col_conv_em_estoque                BOOLEAN NOT NULL DEFAULT FALSE,  -- Em Estoque
  col_conv_pronta                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Pronta
  col_conv_produzir_total            BOOLEAN NOT NULL DEFAULT FALSE,  -- Produzir Total
  col_conv_produzir_parcial          BOOLEAN NOT NULL DEFAULT FALSE,  -- Produzir Parcial
  col_conv_status                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_conv_ins_nome                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Insumo
  col_conv_ins_unidade               BOOLEAN NOT NULL DEFAULT FALSE,  -- Unidade
  col_conv_ins_disponivel            BOOLEAN NOT NULL DEFAULT FALSE,  -- Disponível
  col_conv_ins_necessario            BOOLEAN NOT NULL DEFAULT FALSE,  -- Necessário
  col_conv_ins_saldo                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Saldo (prev.)
  col_conv_ins_etapa                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Etapa
  col_conv_ins_flags                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Flags
  col_orc_campo_dono                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Dono
  col_orc_campo_transportadora       BOOLEAN NOT NULL DEFAULT FALSE,  -- Transportadora
  col_orc_campo_pagamento            BOOLEAN NOT NULL DEFAULT FALSE,  -- Forma de pagamento
  col_orc_campo_observacoes          BOOLEAN NOT NULL DEFAULT FALSE  -- Observações
);

-- ---------------------------------------------------------------------
-- 6) Pedidos  (perm_ped)  —  10 ações, 22 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_ped (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.search · Buscar/filtrar
  acao_view_details                  BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.view.details · Visualizar pedido
  acao_status_confirm                BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.status.confirm · Confirmar pedido
  acao_status_ship                   BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.status.ship · Despachar pedido
  acao_status_deliver                BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.status.deliver · Dar como entregue
  acao_report                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.report · Ver relatório
  acao_export                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.export · Baixar PDF
  acao_cancel                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.cancel · Cancelar pedido
  acao_stock_restore_on_cancel       BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.stock.restore_on_cancel · Realocar estoque ao cancelar

  -- Colunas visíveis
  col_ped_num                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_ped_cliente                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Cliente
  col_ped_data                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_ped_total                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor Total
  col_ped_condicao                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Condição
  col_ped_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_ped_it_nome                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Item
  col_ped_it_qtd                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Qtd.
  col_ped_it_preco                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Un R$
  col_ped_it_preco_desc              BOOLEAN NOT NULL DEFAULT FALSE,  -- Un c/desconto
  col_ped_it_desc                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Desconto %
  col_ped_it_subtotal                BOOLEAN NOT NULL DEFAULT FALSE,  -- Total R$
  col_canc_item                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Item
  col_canc_qtd                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade
  col_canc_restante                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade Restante
  col_canc_origem                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Origem
  col_canc_situacao                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Situação
  col_canc_destinos                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Destinações
  col_ped_campo_dono                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Dono
  col_ped_campo_transportadora       BOOLEAN NOT NULL DEFAULT FALSE,  -- Transportadora
  col_ped_campo_pagamento            BOOLEAN NOT NULL DEFAULT FALSE,  -- Forma de pagamento
  col_ped_campo_observacoes          BOOLEAN NOT NULL DEFAULT FALSE  -- Observações
);

-- ---------------------------------------------------------------------
-- 7) Clientes  (perm_cli)  —  6 ações, 25 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_cli (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.search · Buscar/filtrar
  acao_details_view                  BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.details.view · Ver detalhes
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.create · Cadastrar cliente
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.edit · Editar cliente
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.delete · Excluir cliente

  -- Colunas visíveis
  col_cli_nome_fantasia              BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome fantasia
  col_cli_razao_social               BOOLEAN NOT NULL DEFAULT FALSE,  -- Razão social
  col_cli_cnpj                       BOOLEAN NOT NULL DEFAULT FALSE,  -- CNPJ
  col_cli_comprador                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Comprador/contato
  col_cli_tel                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Telefone
  col_cli_email                      BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_cli_cidade_uf                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Cidade/UF
  col_cli_transportadora             BOOLEAN NOT NULL DEFAULT FALSE,  -- Transportadora
  col_cli_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_cli_owner                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Dono
  col_end_tipo                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Tipo
  col_end_logradouro                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Logradouro
  col_end_numero                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Nº
  col_end_complemento                BOOLEAN NOT NULL DEFAULT FALSE,  -- Compl.
  col_end_bairro                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Bairro
  col_end_cidade                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Cidade
  col_end_uf                         BOOLEAN NOT NULL DEFAULT FALSE,  -- UF
  col_end_cep                        BOOLEAN NOT NULL DEFAULT FALSE,  -- CEP
  col_ctt_nome                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Contato
  col_ctt_cargo                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Cargo
  col_ctt_tel                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Telefone
  col_ctt_email                      BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_ctt_tags                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Tags
  col_ctt_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_ctt_ult_interacao              BOOLEAN NOT NULL DEFAULT FALSE  -- Últ. interação
);

-- ---------------------------------------------------------------------
-- 8) Prospecções  (perm_pros)  —  8 ações, 14 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_pros (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.search · Buscar/filtrar
  acao_details_view                  BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.details.view · Ver detalhes
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.create · Cadastrar prospecção
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.edit · Editar prospecção
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.delete · Excluir prospecção
  acao_stage_update                  BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.stage.update · Atualizar etapa
  acao_next_step                     BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.next.step · Definir próximo passo

  -- Colunas visíveis
  col_pros_id                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ID
  col_pros_entidade                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Entidade
  col_pros_origem                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Origem
  col_pros_etapa                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Etapa
  col_pros_valor                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor
  col_pros_prob                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Prob. (%)
  col_pros_owner                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Dono
  col_pros_proximo_passo             BOOLEAN NOT NULL DEFAULT FALSE,  -- Próx. passo
  col_pros_proximo_passo_data        BOOLEAN NOT NULL DEFAULT FALSE,  -- Para quando
  col_pros_atualizado_em             BOOLEAN NOT NULL DEFAULT FALSE,  -- Atualizado em
  col_hist_data                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_hist_tipo                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Tipo
  col_hist_resumo                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Resumo
  col_hist_resp                      BOOLEAN NOT NULL DEFAULT FALSE  -- Responsável
);

-- ---------------------------------------------------------------------
-- 9) Contatos  (perm_ctt)  —  12 ações, 15 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_ctt (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.search · Buscar/filtrar
  acao_details_view                  BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.details.view · Ver detalhes
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.create · Cadastrar contato
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.edit · Editar contato
  acao_link_client                   BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.link.client · Vincular a cliente
  acao_unlink_client                 BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.unlink.client · Desvincular de cliente
  acao_log_add                       BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.log.add · Registrar interação
  acao_log_view                      BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.log.view · Ver interações
  acao_status_update                 BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.status.update · Atualizar status
  acao_tag_manage                    BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.tag.manage · Gerenciar tags
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.delete · Excluir contato

  -- Colunas visíveis
  col_ctt_nome                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Contato
  col_ctt_cliente                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Cliente
  col_ctt_cargo                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Cargo
  col_ctt_tel                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Telefone
  col_ctt_email                      BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_ctt_origem                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Origem
  col_ctt_tags                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Tags
  col_ctt_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_ctt_ult_interacao              BOOLEAN NOT NULL DEFAULT FALSE,  -- Últ. interação
  col_ctt_owner                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Dono
  col_log_data                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_log_canal                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Canal
  col_log_assunto                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Assunto
  col_log_detalhes                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Detalhes
  col_log_resp                       BOOLEAN NOT NULL DEFAULT FALSE  -- Responsável
);

-- ---------------------------------------------------------------------
-- 10) Relatórios  (perm_rel)  —  11 ações, 48 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_rel (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.view · Ver módulo
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.search · Buscar/filtrar
  acao_run                           BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.run · Rodar relatório
  acao_export_csv                    BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.export.csv · Exportar CSV
  acao_export_xlsx                   BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.export.xlsx · Exportar XLSX
  acao_export_pdf                    BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.export.pdf · Exportar PDF
  acao_preset_save                   BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.preset.save · Salvar preset
  acao_preset_load                   BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.preset.load · Carregar preset
  acao_preset_manage                 BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.preset.manage · Gerenciar presets
  acao_share_link                    BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.share.link · Gerar link compartilhável
  acao_share_send                    BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.share.send · Enviar relatório

  -- Colunas visíveis
  col_rel_estq_nome                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_rel_estq_categoria             BOOLEAN NOT NULL DEFAULT FALSE,  -- Categoria
  col_rel_estq_unidade               BOOLEAN NOT NULL DEFAULT FALSE,  -- Unidade
  col_rel_estq_qtd                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade
  col_rel_estq_preco                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Preço
  col_rel_estq_processo              BOOLEAN NOT NULL DEFAULT FALSE,  -- Processo
  col_rel_estq_status                BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_prod_codigo                BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_rel_prod_nome                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_rel_prod_colecao               BOOLEAN NOT NULL DEFAULT FALSE,  -- Coleção
  col_rel_prod_preco_venda           BOOLEAN NOT NULL DEFAULT FALSE,  -- Preço de Venda
  col_rel_prod_margem                BOOLEAN NOT NULL DEFAULT FALSE,  -- Margem (%)
  col_rel_prod_qtd                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade
  col_rel_prod_status                BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_cli_nome                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_rel_cli_cnpj                   BOOLEAN NOT NULL DEFAULT FALSE,  -- CNPJ
  col_rel_cli_pais                   BOOLEAN NOT NULL DEFAULT FALSE,  -- País
  col_rel_cli_estado                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Estado
  col_rel_cli_status                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_cli_dono                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Dono
  col_rel_ctt_contato                BOOLEAN NOT NULL DEFAULT FALSE,  -- Contato
  col_rel_ctt_tipo                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Tipo
  col_rel_ctt_empresa                BOOLEAN NOT NULL DEFAULT FALSE,  -- Empresa
  col_rel_ctt_celular                BOOLEAN NOT NULL DEFAULT FALSE,  -- Celular
  col_rel_ctt_telefone               BOOLEAN NOT NULL DEFAULT FALSE,  -- Telefone
  col_rel_ctt_email                  BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_rel_pros_nome                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome do Lead
  col_rel_pros_email                 BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_rel_pros_status                BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_pros_responsavel           BOOLEAN NOT NULL DEFAULT FALSE,  -- Responsável
  col_rel_orc_codigo                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_rel_orc_cliente                BOOLEAN NOT NULL DEFAULT FALSE,  -- Cliente
  col_rel_orc_data                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_rel_orc_valor                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor Total
  col_rel_orc_condicao               BOOLEAN NOT NULL DEFAULT FALSE,  -- Condição
  col_rel_orc_status                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_ped_codigo                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_rel_ped_cliente                BOOLEAN NOT NULL DEFAULT FALSE,  -- Cliente
  col_rel_ped_data                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_rel_ped_valor                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor Total
  col_rel_ped_condicao               BOOLEAN NOT NULL DEFAULT FALSE,  -- Condição
  col_rel_ped_status                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_usr_avatar                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Avatar
  col_rel_usr_nome                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_rel_usr_email                  BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_rel_usr_perfil                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Perfil
  col_rel_usr_situacao               BOOLEAN NOT NULL DEFAULT FALSE,  -- Situação
  col_rel_usr_status                 BOOLEAN NOT NULL DEFAULT FALSE  -- Status
);

-- ---------------------------------------------------------------------
-- 11) Tarefas  (perm_tarefas)  —  6 ações, 11 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_tarefas (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.view · Ver tarefas/agenda
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.create · Criar tarefa
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.edit · Editar tarefa
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.delete · Excluir tarefa
  acao_assign                        BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.assign · Atribuir tarefa
  acao_calendar_view                 BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.calendar.view · Ver calendário

  -- Colunas visíveis
  col_tsk_titulo                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Título
  col_tsk_resp                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Responsável
  col_tsk_prazo                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Prazo
  col_tsk_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_tsk_prioridade                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Prioridade
  col_evt_titulo                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Evento
  col_evt_inicio                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Início
  col_evt_fim                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Fim
  col_evt_local                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Local
  col_evt_participantes              BOOLEAN NOT NULL DEFAULT FALSE,  -- Participantes
  col_evt_status                     BOOLEAN NOT NULL DEFAULT FALSE  -- Status
);

-- ---------------------------------------------------------------------
-- 12) Configurações  (perm_cfg)  —  6 ações, 8 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_cfg (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.view · Ver configurações
  acao_theme_edit                    BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.theme.edit · Editar tema
  acao_integrations_edit             BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.integrations.edit · Editar integrações
  acao_prefs_edit                    BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.prefs.edit · Editar preferências gerais
  acao_roles_view                    BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.roles.view · Ver papéis/perfis
  acao_roles_edit                    BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.roles.edit · Editar papéis/perfis

  -- Colunas visíveis
  col_role_code                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_role_name                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_role_desc                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Descrição
  col_role_modulos                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Módulos
  col_role_features                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Ações
  col_int_nome                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Integração
  col_int_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_int_ult_sync                   BOOLEAN NOT NULL DEFAULT FALSE  -- Últ. sync
);

-- ---------------------------------------------------------------------
-- 13) Dashboard  (perm_dashboard)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_dashboard (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 14) Calendário  (perm_calendario)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_calendario (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 15) Laminação · Clientes  (perm_lam_clientes)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_lam_clientes (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 16) Laminação · Serviços  (perm_lam_servicos)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_lam_servicos (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 17) Laminação · Precificação  (perm_lam_precificacao)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_lam_precificacao (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 18) Laminação · Relatórios  (perm_lam_relatorios)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_lam_relatorios (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 19) IA  (perm_ia)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_ia (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 20) Usuários  (perm_usuarios)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_usuarios (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 21) Financeiro  (perm_financeiro)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_financeiro (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 22) Perfil padrão "Administrador" com tudo liberado
-- ---------------------------------------------------------------------
INSERT INTO modelos_permissoes (nome, descricao)
VALUES ('Administrador', 'Acesso total a todos os módulos')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO perm_mp (modelo_id, modulo_ativo, acao_view, acao_search, acao_create, acao_totals_view, acao_edit, acao_delete, acao_stock_edit, acao_stock_infinite_toggle, acao_category_view, acao_category_create, acao_category_delete, acao_unit_view, acao_unit_create, acao_unit_delete, acao_process_view, acao_process_create, acao_process_delete, acao_process_order, col_mp_nome, col_mp_estoque_atual, col_mp_unidade, col_mp_custo_medio, col_mp_campo_descricao)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_prod (modelo_id, modulo_ativo, acao_view, acao_search, acao_create, acao_stock_view, acao_details_view, acao_edit, acao_delete, acao_item_add, acao_item_edit, acao_item_remove, acao_clear, acao_percent_edit, acao_collection_create, acao_collection_delete, acao_clone, acao_registro_toggle, acao_pdf, acao_stage_insert, acao_stage_item_add, acao_stage_item_edit, acao_stage_item_remove, acao_stage_clear, acao_stock_input, acao_stock_adjust, acao_stock_lote_delete, col_prod_sku, col_prod_nome, col_prod_colecao, col_prod_preco_base, col_prod_margem, col_prod_estoque, col_ins_mp, col_ins_qtd, col_ins_unidade, col_ins_custo_un, col_ins_custo_total, col_etapa_item, col_etapa_qtd, col_etapa_unidade, col_etapa_valor_un, col_etapa_valor_total, col_est_processo, col_est_ultimo_item, col_est_quantidade, col_est_alterado_em)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_orc (modelo_id, modulo_ativo, acao_view, acao_search, acao_create, acao_view_details, acao_edit, acao_convert, acao_export, acao_item_add, acao_item_edit, acao_item_remove, acao_clear, acao_send, acao_status_change, acao_clone, acao_convert_decide, acao_convert_justify, acao_item_replace, col_orc_num, col_orc_cliente, col_orc_data, col_orc_total, col_orc_cond_pagto, col_orc_status, col_orc_it_nome, col_orc_it_qtd, col_orc_it_preco, col_orc_it_preco_desc, col_orc_it_desc, col_orc_it_subtotal, col_conv_peca, col_conv_qtd_orcada, col_conv_em_estoque, col_conv_pronta, col_conv_produzir_total, col_conv_produzir_parcial, col_conv_status, col_conv_ins_nome, col_conv_ins_unidade, col_conv_ins_disponivel, col_conv_ins_necessario, col_conv_ins_saldo, col_conv_ins_etapa, col_conv_ins_flags, col_orc_campo_dono, col_orc_campo_transportadora, col_orc_campo_pagamento, col_orc_campo_observacoes)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_ped (modelo_id, modulo_ativo, acao_view, acao_search, acao_view_details, acao_status_confirm, acao_status_ship, acao_status_deliver, acao_report, acao_export, acao_cancel, acao_stock_restore_on_cancel, col_ped_num, col_ped_cliente, col_ped_data, col_ped_total, col_ped_condicao, col_ped_status, col_ped_it_nome, col_ped_it_qtd, col_ped_it_preco, col_ped_it_preco_desc, col_ped_it_desc, col_ped_it_subtotal, col_canc_item, col_canc_qtd, col_canc_restante, col_canc_origem, col_canc_situacao, col_canc_destinos, col_ped_campo_dono, col_ped_campo_transportadora, col_ped_campo_pagamento, col_ped_campo_observacoes)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_cli (modelo_id, modulo_ativo, acao_view, acao_search, acao_details_view, acao_create, acao_edit, acao_delete, col_cli_nome_fantasia, col_cli_razao_social, col_cli_cnpj, col_cli_comprador, col_cli_tel, col_cli_email, col_cli_cidade_uf, col_cli_transportadora, col_cli_status, col_cli_owner, col_end_tipo, col_end_logradouro, col_end_numero, col_end_complemento, col_end_bairro, col_end_cidade, col_end_uf, col_end_cep, col_ctt_nome, col_ctt_cargo, col_ctt_tel, col_ctt_email, col_ctt_tags, col_ctt_status, col_ctt_ult_interacao)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_pros (modelo_id, modulo_ativo, acao_view, acao_search, acao_details_view, acao_create, acao_edit, acao_delete, acao_stage_update, acao_next_step, col_pros_id, col_pros_entidade, col_pros_origem, col_pros_etapa, col_pros_valor, col_pros_prob, col_pros_owner, col_pros_proximo_passo, col_pros_proximo_passo_data, col_pros_atualizado_em, col_hist_data, col_hist_tipo, col_hist_resumo, col_hist_resp)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_ctt (modelo_id, modulo_ativo, acao_view, acao_search, acao_details_view, acao_create, acao_edit, acao_link_client, acao_unlink_client, acao_log_add, acao_log_view, acao_status_update, acao_tag_manage, acao_delete, col_ctt_nome, col_ctt_cliente, col_ctt_cargo, col_ctt_tel, col_ctt_email, col_ctt_origem, col_ctt_tags, col_ctt_status, col_ctt_ult_interacao, col_ctt_owner, col_log_data, col_log_canal, col_log_assunto, col_log_detalhes, col_log_resp)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_rel (modelo_id, modulo_ativo, acao_view, acao_search, acao_run, acao_export_csv, acao_export_xlsx, acao_export_pdf, acao_preset_save, acao_preset_load, acao_preset_manage, acao_share_link, acao_share_send, col_rel_estq_nome, col_rel_estq_categoria, col_rel_estq_unidade, col_rel_estq_qtd, col_rel_estq_preco, col_rel_estq_processo, col_rel_estq_status, col_rel_prod_codigo, col_rel_prod_nome, col_rel_prod_colecao, col_rel_prod_preco_venda, col_rel_prod_margem, col_rel_prod_qtd, col_rel_prod_status, col_rel_cli_nome, col_rel_cli_cnpj, col_rel_cli_pais, col_rel_cli_estado, col_rel_cli_status, col_rel_cli_dono, col_rel_ctt_contato, col_rel_ctt_tipo, col_rel_ctt_empresa, col_rel_ctt_celular, col_rel_ctt_telefone, col_rel_ctt_email, col_rel_pros_nome, col_rel_pros_email, col_rel_pros_status, col_rel_pros_responsavel, col_rel_orc_codigo, col_rel_orc_cliente, col_rel_orc_data, col_rel_orc_valor, col_rel_orc_condicao, col_rel_orc_status, col_rel_ped_codigo, col_rel_ped_cliente, col_rel_ped_data, col_rel_ped_valor, col_rel_ped_condicao, col_rel_ped_status, col_rel_usr_avatar, col_rel_usr_nome, col_rel_usr_email, col_rel_usr_perfil, col_rel_usr_situacao, col_rel_usr_status)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_tarefas (modelo_id, modulo_ativo, acao_view, acao_create, acao_edit, acao_delete, acao_assign, acao_calendar_view, col_tsk_titulo, col_tsk_resp, col_tsk_prazo, col_tsk_status, col_tsk_prioridade, col_evt_titulo, col_evt_inicio, col_evt_fim, col_evt_local, col_evt_participantes, col_evt_status)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_cfg (modelo_id, modulo_ativo, acao_view, acao_theme_edit, acao_integrations_edit, acao_prefs_edit, acao_roles_view, acao_roles_edit, col_role_code, col_role_name, col_role_desc, col_role_modulos, col_role_features, col_int_nome, col_int_status, col_int_ult_sync)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_dashboard (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_calendario (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_lam_clientes (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_lam_servicos (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_lam_precificacao (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_lam_relatorios (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_ia (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_usuarios (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_financeiro (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

COMMIT;
