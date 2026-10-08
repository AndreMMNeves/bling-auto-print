# Verificação com o Bling real

## 2026-10-08 — Bling SP (somente leitura)

Aplicativo criado no Bling SP com os escopos Pedidos de Venda e Produtos (sem Situações e sem Vendedores).

| Item | Resultado |
|---|---|
| OAuth (autorizar, trocar código, guardar tokens) | Funcionou |
| Situação **Atendido** | id **9** (confirmado em pedido real) |
| Situação **Cancelado** | id **12** (filtro `idsSituacoes[]=12` devolve pedidos cancelados) |
| Filtro `dataAlteracaoInicial/Final` | **Funciona**: janela em 2030 → 0 pedidos; últimos 10 min → 33 |
| Filtro `idsSituacoes[]` (usado na primeira ativação) | **Funciona** |
| Campos do pedido (cliente, documento, etiqueta, transporte, itens, SKU) | Batem com o mapeamento de `cliente.ts` |
| EAN (`gtin` em `/produtos/{id}`) | Funciona |
| Nome do vendedor (`/vendedores/{id}` → `contato.nome`) | Funciona mesmo sem o escopo Vendedores |
| `/situacoes/modulos` | 403 (falta o escopo Situações) — não é usado pelo sistema |
| Folha gerada com pedido real (nº 297040) | Correta, 1 página |

### Pontos em aberto

1. **Situações personalizadas no SP.** Em 2 dias houve 2.423 pedidos alterados, mas só 5 em Atendido (9).
   A maioria está em situações personalizadas (ex.: 457715 → 1.241 pedidos; 390226, 390233, 24...).
   Precisa confirmar com o usuário **em qual situação os vendedores colocam o pedido** quando ele deve ser impresso.
2. **Código de barras no checkout:** falta bipar `dados/exploracao/codigos-de-barras.html` na tela de checkout do Bling.
3. **Volume:** ~33 alterações a cada 10 min no SP; a consulta a cada 30 s com margem de 5 min fica em 1 página. A
   ferramenta de exploração (janela de 2 dias) levou alguns minutos por dividir a janela — esperado.
