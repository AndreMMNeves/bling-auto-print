# Sistema de Impressão da Expedição — Design

**Data:** 2026-10-08
**Status:** aguardando revisão
**Substitui:** a extensão Chrome "Onix HOF - Auto Impressão Bling" (deste repositório)

## 1. Objetivo

Quando um vendedor marca um pedido de venda como **Atendido** no Bling, a
expedição recebe automaticamente, sem ninguém clicar em nada, uma **folha de
separação A4** impressa. Essa folha é usada para separar os produtos e fazer o
checkout no Bling (bipagem). Cada pedido é impresso **uma única vez**.
Reimpressões exigem login de supervisor e justificativa. Tudo fica registrado
num relatório.

### Como a expedição trabalha (contexto)

1. Pega a folha impressa do pedido.
2. Bipa cada produto (EAN) e coloca na bandeja.
3. Bipa a bandeja e bipa cada produto de novo (conferência).

A bipagem e a conferência acontecem no **módulo de separação/checkout do
Bling**. Este sistema **não** refaz a conferência, só entrega a folha.

### Por que não continuar com a extensão

A extensão só percebe o "Atendido" quando o clique acontece no mesmo navegador
em que ela está instalada. Os pedidos, porém, são marcados pelos vendedores em
outros computadores. Além disso, ela depende do layout HTML do Bling, guarda
estado só no navegador e imprime pelo diálogo do Chrome.

## 2. Escopo

O sistema completo é dividido em etapas. **Este documento especifica a Etapa 1.**
As etapas 2 a 4 só orientam a estrutura, para que não seja preciso reescrever o
sistema depois.

| Etapa | Conteúdo | Status |
|---|---|---|
| **1** | Filial ES, 1 impressora A4, monitor, folha, banco, reimpressão com login, relatório + Google Sheets | **este spec** |
| 2 | Várias impressoras e regras de roteamento (qual pedido vai para qual impressora) | futuro |
| 3 | Outras filiais (contas Bling SP e PR), cada uma imprimindo no próprio local | futuro |
| 4 | Outros documentos (ex.: etiqueta térmica de volume) | futuro |

**Preparação para o futuro, já na Etapa 1:** `filial`, `impressora` e
`tipo de documento` existem como entidades/configuração desde o início, mesmo
que cada uma tenha um único registro.

**Fora do escopo da Etapa 1:** webhooks do Bling, roteamento entre impressoras,
múltiplas contas Bling, etiquetas térmicas, conferência/bipagem própria e
servidor na nuvem.

## 3. Arquitetura

```
  Bling ES (API v3)                       Google Sheets
       ▲  consulta a cada 30s                  ▲ envia cada impressão
       │                                       │
┌──────┴───────────────────────────────────────┴──────┐
│ SERVIDOR                                            │
│  • Monitor: acha pedidos que viraram Atendido       │
│  • Regras: já impresso? → alerta, senão → fila      │
│  • Gerador de folha (PDF A4 com códigos de barras)  │
│  • Banco de dados (SQLite)                          │
│  • Página web: painel, relatório, reimpressão       │
└──────────────────────────┬──────────────────────────┘
                           │ HTTP: agente busca trabalhos
                  ┌────────┴─────────┐
                  │ AGENTE           │ → impressora A4 (nome no Windows)
                  └──────────────────┘
```

- **Servidor** e **agente** são programas separados. Na Etapa 1 rodam no mesmo
  PC Windows da expedição do ES.
- O agente **busca** trabalhos no servidor (pull), em vez de o servidor
  empurrar para ele. Assim um agente em outra rede ou filial (Etapa 3) só
  precisa conseguir alcançar o servidor.
- O agente se identifica com um token e informa a impressora que atende. O
  servidor só entrega a ele os trabalhos daquela impressora.

### Tecnologia

| Item | Escolha |
|---|---|
| Linguagem | Node.js + TypeScript (servidor, agente e página) |
| Banco | SQLite (um arquivo; backup = copiar o arquivo) |
| PDF | Modelo HTML renderizado em PDF pelo Chromium (headless), A4 |
| Códigos de barras | Gerados como imagem (Code 128) no servidor |
| Impressão | PDF enviado direto à impressora do Windows, sem diálogo |
| Página web | Servida pelo próprio servidor, acessível na rede local |
| Execução | Servidor e agente como serviços do Windows (sobem sozinhos com o PC) |
| Google Sheets | API do Google com conta de serviço |

### Organização do repositório

O sistema novo fica neste mesmo repositório, em `servidor/` e `agente/`. A
extensão atual vai para `legado/extensao/` no momento em que for desligada
(passo 3 da entrada em uso).

## 4. Integração com o Bling

- API v3 do Bling com OAuth 2.0. Um aplicativo é cadastrado na conta Bling ES
  (pelo usuário). O servidor guarda o access token e o refresh token e renova o
  acesso sozinho.
- **Detecção:** a cada 30s, o servidor consulta os pedidos de venda na situação
  **Atendido**, com alteração desde a última consulta bem-sucedida, guardada no
  banco, com uma margem de segurança de alguns minutos. Duplicidade nunca é
  problema, porque o número do pedido é chave única (seção 6).
- **Detalhes do pedido:** para cada pedido novo, o servidor busca itens, EAN,
  SKU, cliente, endereço, transporte, vendedor e observações.
- Respeitar o limite de requisições da API do Bling. 30s de intervalo com uma
  consulta de lista é muito abaixo do limite. Os detalhes são buscados um pedido
  por vez.

### Verificações obrigatórias antes de construir o resto

1. **Situação "Atendido" na API:** confirmar com pedidos reais do ES o
   identificador da situação e quais filtros de data a listagem aceita.
2. **Código de barras do checkout:** descobrir qual valor a tela de
   separação/checkout do Bling aceita para localizar o pedido (número do pedido,
   número na loja ou outro), imprimindo uma folha de teste e bipando na tela.

Se uma delas não funcionar como o esperado, a construção para e a decisão volta
para o usuário.

## 5. Folha de separação

A4, retrato. O conteúdo foi aprovado pelo usuário sem campos adicionais.

```
┌──────────────────────────────────────────────────────────┐
│ ÔNIX HOF — ES        FOLHA DE SEPARAÇÃO      1ª via      │
│ Pedido nº 12345            ║║│║║│║║║│║║ (código pedido)  │
│ Data: 08/10/2026  Atendido: 14:32   Vendedor: Fulano     │
├──────────────────────────────────────────────────────────┤
│ CLIENTE: Nome — CPF/CNPJ                                 │
│ Endereço de entrega / Cidade-UF / CEP                    │
│ Transporte: forma de envio                               │
├──────────────────────────────────────────────────────────┤
│ ☐ │ QTD │ SKU    │ PRODUTO                │ EAN          │
│ ...                                                      │
├──────────────────────────────────────────────────────────┤
│ Total de itens: N   Volumes: ___                         │
│ OBSERVAÇÕES DO PEDIDO: ...                               │
│ Separado por: ________   Conferido por: ________         │
└──────────────────────────────────────────────────────────┘
```

Regras:
- **Uma página por padrão.** O PDF é gerado com tamanho A4 fixo e margens
  controladas, e nunca sai página extra vazia. O problema de hoje, em que a
  impressão do Bling sai com 2 páginas, deixa de existir.
- **Pedido que não cabe** (aprox. 25 a 30 itens): quebra em quantas páginas
  forem necessárias, com "Página X/Y" e o código de barras do pedido em todas.
- Itens ordenados por SKU.
- Produto sem EAN: imprime o código de barras gerado a partir do SKU.
- Campo vazio aparece como "—". Dado faltando nunca impede a impressão.
- **Via:** "1ª via" na impressão automática. Reimpressão sai como "Nª via", com
  motivo, nome do supervisor e horário no rodapé.

## 6. Regras de negócio

1. **1ª via única:** o número do pedido é chave única na tabela de pedidos. A 1ª
   via é criada uma única vez por pedido, para sempre.
2. **Pedido que volta para Atendido** depois de já ter sido impresso **não**
   imprime sozinho. Gera um **alerta** no painel ("voltou para Atendido, já
   impresso às HH:MM") e o supervisor decide se reimprime.
3. **Pedido cancelado após impresso:** gera um alerta no painel ("CANCELADO,
   mas já impresso: retire da separação"). Para isso o monitor também consulta
   cancelamentos de pedidos que já estão no banco.
4. **Ordem de impressão:** a ordem em que os pedidos foram atendidos.
5. **Dados da folha:** a 1ª via usa os dados de quando o pedido virou Atendido.
   Uma reimpressão busca os dados atuais no Bling.
6. **Primeiro dia:** só pedidos atendidos a partir da primeira ativação do
   sistema. Pedidos antigos nunca são impressos.
7. **Retomada após PC desligado:** o sistema busca tudo o que virou Atendido
   desde a última consulta bem-sucedida, imprime tudo automaticamente na ordem
   de atendimento e mostra um aviso no painel ("PC desligado de X a Y, N pedidos
   impressos na retomada").

## 7. Usuários e permissões

Login por e-mail e senha. A senha é guardada com hash.

| Papel | Pode |
|---|---|
| **Operador** | Ver painel, fila, alertas e relatório |
| **Supervisor** | Tudo do operador + reimprimir (com motivo), resolver alertas, "imprimir pendentes", cadastrar usuários, reconectar ao Bling |

**Reimpressão:** o supervisor busca o pedido, clica em Reimprimir e escolhe um
motivo da lista ("Folha perdida", "Folha danificada", "Pedido alterado", "Erro
na impressora") ou "Outro" com texto livre obrigatório. Tudo fica registrado.

## 8. Página web

- **Painel:** impressos hoje, na fila, alertas pendentes. Indicadores de
  status: Bling (conexão OK / desde quando caiu), agente (última comunicação) e
  impressora (último erro).
- **Alertas:** pedido repetido, pedido cancelado após impresso, falha de
  impressão, retomada, Bling desconectado. Cada um pode ser resolvido pelo
  supervisor, e fica registrado quem resolveu.
- **Relatório:** horário, pedido, cliente, vendedor, quantidade de itens, via,
  impressora, e, em reimpressões, quem e por quê. Filtros por data, vendedor,
  pedido e "só reimpressões". Exportar para Excel.
- **Usuários** (supervisor) e **Configuração** (supervisor): intervalo de
  consulta, impressora, conexão com o Bling e planilha.

## 9. Google Sheets

Cada impressão concluída, inclusive as reimpressões, vira uma linha numa
planilha do Google Drive, com as mesmas colunas do relatório. O envio é
assíncrono, por uma fila própria no banco: se o Google estiver fora do ar, as
linhas ficam pendentes e são reenviadas depois. A planilha nunca bloqueia nem
atrasa uma impressão. A planilha é compartilhada com o e-mail de uma conta de
serviço do Google.

## 10. Erros e recuperação

| Problema | Comportamento |
|---|---|
| Bling fora do ar / lento | Tenta a cada 30s e mostra no painel "sem conexão desde HH:MM". Ao voltar, busca tudo o que perdeu (regra 7). |
| Token do Bling expirado | Renova automaticamente. Se falhar, alerta "Reconectar ao Bling" com botão para o supervisor. |
| Impressora com problema | Status "erro" e 3 novas tentativas. Depois, alerta vermelho. O supervisor usa "Imprimir pendentes", que **não** conta como reimpressão. |
| Agente parado | O servidor detecta a falta de comunicação e mostra alerta. Os trabalhos ficam na fila. |
| Dado faltando no pedido | Imprime mesmo assim ("—" e código do SKU). |
| Google Sheets fora do ar | Fila de envio com reenvio. A impressão segue normal. |

**Limitação conhecida:** "impresso ✔" significa que o Windows aceitou o
trabalho de impressão. Um atolamento de papel durante a impressão pode não ser
detectado, e nesse caso a solução é a reimpressão com o motivo "Erro na
impressora".

## 11. Modelo de dados (resumo)

- `filiais` (id, nome, credenciais Bling, última consulta bem-sucedida)
- `impressoras` (id, filial, nome no Windows, agente)
- `agentes` (id, token, última comunicação)
- `pedidos` (número **único**, filial, id Bling, situação atual, atendido em,
  dados da 1ª via em JSON)
- `impressoes` (id, pedido, via Nº, tipo de documento, impressora, status
  [fila/imprimindo/impresso/erro], tentativas, motivo, usuário, criado em,
  impresso em)
- `alertas` (id, tipo, pedido, mensagem, criado em, resolvido por, resolvido em)
- `usuarios` (id, nome, e-mail, hash da senha, papel)
- `fila_planilha` (id, impressão, enviado em, tentativas)

## 12. Testes

- **Automáticos**, sem Bling e sem impressora reais:
  - Bling simulado: pedido virando Atendido, pedido repetido, cancelamento,
    Bling fora do ar, token expirado, retomada após intervalo.
  - Geração de folha com 1, 25 e 60 itens: confere o número de páginas e
    "Página X/Y".
  - Impressora simulada que falha: 3 tentativas e depois alerta.
  - Permissões: operador não consegue reimprimir.
  - Fila da planilha: reenvio depois de uma falha.
- **Manuais**, no ambiente real (seção 13).

## 13. Entrada em uso

1. **Verificação:** as duas verificações da seção 4.
2. **Paralelo (1 a 2 dias):** o sistema roda no Bling real, mas o agente salva
   os PDFs numa pasta em vez de imprimir. Comparar: todos os pedidos foram
   pegos? A folha está boa? O checkout do Bling lê o código?
3. **Ativação:** liga a impressão real e **desliga a extensão antiga no mesmo
   momento**, para evitar impressão dupla.

## 14. O que o usuário precisa providenciar

- Criar o aplicativo na conta Bling ES (com passo a passo fornecido).
- Criar a planilha no Google Drive e compartilhar com a conta de serviço (com
  passo a passo fornecido).
- Acesso ao PC Windows da expedição, com a impressora A4 instalada.
- Lista de supervisores e operadores (nome e e-mail).
