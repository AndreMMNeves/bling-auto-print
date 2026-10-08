# Ônix HOF — Sistema de Impressão da Expedição

Quando um vendedor marca um pedido de venda como **Atendido** no Bling, a
expedição recebe automaticamente uma **folha de separação A4** impressa, usada
para separar os produtos e fazer o checkout (bipagem) no Bling. Cada pedido é
impresso **uma única vez**; reimpressões exigem login de supervisor e
justificativa. Tudo fica num relatório (página web + Excel + Google Sheets).

Especificação completa: [`docs/superpowers/specs/2026-10-08-sistema-impressao-expedicao-design.md`](docs/superpowers/specs/2026-10-08-sistema-impressao-expedicao-design.md)

## Como funciona

- **Servidor** (`servidor/`): consulta o Bling a cada 30 s, decide o que imprimir,
  gera o PDF da folha, guarda o histórico (SQLite em `dados/`) e serve a página web.
- **Agente** (`agente/`): fica no PC ao lado da impressora, busca os trabalhos no
  servidor e imprime direto, sem janela. No modo `pasta`, só salva os PDFs (teste).

## Requisitos

- Windows, **Node.js 24+** e **Google Chrome**.
- Impressora A4 instalada no Windows **para todos os usuários** (o serviço roda
  como Sistema Local).

## Instalação

1. Copie esta pasta para o PC da expedição e rode `npm ci`.
2. Copie `servidor/config.exemplo.json` para `servidor/config.json` e preencha:
   `segredoSessao` (texto aleatório longo), `bling.clientId`/`clientSecret`
   (veja abaixo), o token e o **nome exato** da impressora em `agentes`.
3. Copie `agente/config.exemplo.json` para `agente/config.json` com o **mesmo token**.
   Use `"modo": "pasta"` no período de teste e `"imprimir"` quando for valer.
4. Crie o primeiro supervisor:
   `npm run criar-usuario -- --nome "Seu Nome" --email voce@onixhof.com --senha "minimo8" --papel supervisor`
5. Num terminal **Executar como administrador**: `node scripts/servicos.ts instalar`.
6. Abra `http://localhost:3010`, entre como supervisor → **Configuração → Conectar ao Bling**.

Para testar sem instalar serviço: `npm run servidor` e `npm run agente` em dois terminais.

## Criar o aplicativo no Bling

1. No Bling (usuário administrador): **Central de Extensões → Área do Integrador → Criar aplicativo**.
2. Link de redirecionamento: `http://localhost:3010/bling/callback`.
3. Escopos (leitura): **Pedidos de Venda**, **Produtos**, **Vendedores**, **Situações**.
4. Copie Client ID e Client Secret para `servidor/config.json`.

Para conferir os dados reais antes de ligar: `npm run explorar-bling -- servidor/config.json`
(salva respostas em `dados/exploracao/` e gera uma página de códigos de barras para
testar no checkout do Bling).

## Google Sheets (opcional)

1. No Google Cloud: crie um projeto, ative a **Google Sheets API** e crie uma **conta de serviço**.
2. Baixe a chave JSON para `dados/google.json`.
3. Compartilhe a planilha com o e-mail da conta de serviço (Editor).
4. No config: `"google": { "arquivoCredenciais": "dados/google.json", "planilhaId": "<id da URL>", "aba": "Impressões" }`.
5. Reinicie o serviço do servidor.

## Uso diário

- **Painel**: status do Bling, do agente e da impressora; impressos hoje; alertas.
- **Alertas**: pedido que voltou para Atendido, pedido cancelado após impresso,
  falha de impressão, retomada após o PC ficar desligado, Bling desconectado.
- **Reimpressão** (só supervisor): Pedidos → abrir o pedido → escolher o motivo.
  Sai como "2ª via" com motivo, nome e horário no rodapé.
- **Imprimir pendentes** (supervisor): no painel, quando a impressora volta.
- **Relatório**: filtros por data, vendedor, pedido e "só reimpressões"; botão
  **Exportar para Excel**.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Sem conexão com o Bling" | Verifique a internet. Se aparecer alerta "Bling desconectado", Configuração → Reconectar ao Bling. |
| "Agente sem resposta" | Verifique se o PC da expedição está ligado e o serviço "Onix Expedicao - Agente" rodando. |
| "Impressão(ões) com erro" | Arrume a impressora (papel, ligada) e clique em **Imprimir pendentes**. |
| Logs | Pasta `daemon` criada pelo node-windows ao lado de cada script (`servidor/src/daemon`, `agente/src/daemon`). |

## Desenvolvimento

`npm test` (testes) e `npm run typecheck`. O código TypeScript roda direto no Node 24, sem build.

## Extensão antiga

A extensão Chrome que imprimia ao clicar em "Atendido" foi substituída por este
sistema. O código dela fica em `legado/extensao/` depois da ativação.
