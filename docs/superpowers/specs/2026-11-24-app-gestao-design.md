# App de gestão do MK Studio — design

Data: 2026-11-24

## Para que serve

O dono do MK Studio (pai do usuário) quer gerir o dinheiro e o material do salão sozinho, pelo celular, sem depender de agenda de papel. Ele mesmo lança os valores todo mês. Por isso o app precisa ser simples, com botões grandes e o mínimo de digitação. Tudo o que der para calcular a partir da agenda é calculado automaticamente.

## O que já existe (e não pode quebrar)

- **Site** (GitHub Pages, `guilhermejaroque/mk-studio/index.html`): agendamento online, lê e grava na planilha "Agenda MK Studio" (ID `1YSqEBkoa3ZsngWrP1Lsa-6A0GeeL54-lN84XsEpRY58`) por um App da Web do Apps Script próprio.
- **App das manicures** (`app/` e `mk-agenda-app/`): PWA com login por código (`KatiaMK`, `SueniaMK`). Tem servidor próprio no Apps Script (`mk-agenda-app/Codigo.gs`), ligado à mesma planilha. Ao marcar um atendimento como "feito", grava `Execução = feito` e `Valor` (valor cheio) na aba **Agenda**. A comissão é de 50% e a semana vai de segunda a domingo.
- Abas atuais da planilha: Agenda, Bloqueios, Horários, Serviços, Profissionais.

## Objetivos

1. **Resumo do mês** (tela inicial): quanto entrou (atendimentos + aluguéis), quanto saiu (contas + material + profissionais), quanto sobrou, mais a comparação com os meses anteriores.
2. **Contas a pagar**: contas fixas cadastradas uma vez (luz, água, aluguel, internet…). A cada mês o app mostra a lista; ele digita o valor e marca "pago". Também dá para lançar gastos avulsos com categoria (inclusive "Material"). Cada conta tem seu histórico mês a mês.
3. **Entradas dos atendimentos**: automáticas. Toda linha da Agenda com `Execução = feito` entra pelo `Valor`, na data do atendimento. O app mostra o bruto, a taxa por forma de pagamento e o líquido para o salão.
4. **Pagamento das profissionais**: acerto **semanal** (segunda a domingo). A profissional recebe **50% do valor cheio** de cada atendimento feito. A taxa da maquininha **não** é descontada dela. Para cada semana e cada profissional, o app mostra o total e um botão "marcar como pago", com histórico.
5. **Aluguel das salas**: duas salas, R$ 300/mês cada, com chave "ocupada/livre". Só as salas ocupadas aparecem no mês, com o botão "recebido". Hoje uma sala está ocupada. Mudar a chave afeta só os meses seguintes, e o histórico fica guardado. Não há aviso de atraso.
6. **Estoque de material de uso** (o salão não vende produtos): itens com quantidade atual e mínimo, botões +/–, e uma lista "comprar" no topo com os itens no mínimo ou abaixo. O estoque não guarda valores: o dinheiro da compra é lançado como gasto avulso "Material".
7. **Forma de pagamento**: no app das manicures, ao marcar "feito", aparecem três botões: **Pix, Crédito, Débito**. A forma escolhida é gravada numa coluna nova, `Pagamento`, da Agenda.
8. **Taxas** por forma de pagamento, configuráveis pelo dono. Começam em **0%** (o usuário vai pesquisar e passar os valores depois). A taxa sai só da parte do salão: salão líquido = valor − 50% − taxa% × valor. As taxas valem retroativamente (são sempre calculadas na hora, nunca gravadas por atendimento).

## Fora do escopo

- Venda de produtos, aviso de aluguel atrasado, nota fiscal, integração bancária ou com a maquininha.
- Comissão diferente por profissional ou serviço (hoje é 50% para as duas manicures). Fica como uma constante única, fácil de virar configuração depois.
- Mudar o site de agendamento.

## O que não pode acontecer

- Quebrar ou deixar mais lento o app das manicures ou o site.
- As profissionais conseguirem ver a parte financeira.
- Valores divergirem da planilha: a planilha é a fonte da verdade, e o usuário precisa conseguir conferir e corrigir tudo por lá.

## Abordagens consideradas

- **A) PWA nova + servidor Apps Script próprio, mesma planilha (escolhida).** Segue o padrão do app das manicures (que já tem servidor separado do site), é gratuita, e isola falhas.
- B) Mesmo servidor das manicures com "código de dono": uma implantação só, mas toda mudança na gestão arrisca o app usado diariamente.
- C) Editar a planilha direto pelo celular: nada a programar, mas difícil de usar para quem vai lançar tudo sozinho. Descartada.

## Como fica

### Arquivos (repositório `mk-studio`)
- `mk-gestao-app/Codigo.gs`: servidor da gestão (projeto novo no Apps Script, "Executar como: Eu", "Qualquer pessoa").
- `gestao/index.html`, `sw.js`, `manifest.webmanifest`, ícones: PWA servida em `…/mk-studio/gestao/`, com o mesmo visual do app das manicures (mesmas cores e variáveis CSS, cartões arredondados, folha inferior para formulários).
- Mudança em `mk-agenda-app/Codigo.gs` + `app/index.html`: botões de pagamento e gravação da coluna `Pagamento`. A pasta antiga `mk-agenda-app/app/` é removida.

### Acesso
Login por código, como nas manicures, mas com um código de dono definido no `Codigo.gs` da gestão (o usuário escolhe; a sugestão é algo como `DonoMK`). O código fica salvo no aparelho depois do primeiro login.

### Abas novas na planilha (criadas pelo servidor se faltarem)
- **Contas**: ID, Nome, Categoria, Fixa (sim/não), Ativa (sim/não).
- **Lançamentos**: ID, Mês (AAAA-MM), Data, ContaID (vazio = avulso), Descrição, Categoria, Valor, Pago (sim/não).
- **Salas**: ID, Nome, Valor mensal, Ocupada (sim/não), Desde (AAAA-MM).
- **Aluguéis**: Mês, SalaID, Valor, Recebido (sim/não), Data.
- **Pagamentos**: Semana (data da segunda-feira), Profissional, Valor, Pago em.
- **Estoque**: ID, Item, Unidade, Quantidade, Mínimo.
- **Config**: Chave, Valor (taxa_pix, taxa_credito, taxa_debito, comissao=0.5).

### Telas (barra de abas embaixo)
1. **Resumo**: seletor de mês; cartões Entrou / Saiu / Sobrou; detalhe por origem; mini gráfico de barras dos últimos 6 meses.
2. **Contas**: lista do mês com as fixas (valor + "pago") e os avulsos; botão "+ gasto"; tocar numa conta abre o histórico dela.
3. **Entradas**: atendimentos do mês por dia/profissional, com bruto, taxa e líquido, além dos aluguéis das salas ocupadas com o botão "recebido".
4. **Equipe**: semanas (a atual primeiro), total por profissional, "marcar como pago" e o histórico.
5. **Estoque**: lista "comprar" no topo, itens com +/–, botão "+ item".
6. **Ajustes** (ícone no topo): taxas, salas (ocupada/livre, valor) e cadastro de contas fixas.

### Regras de cálculo
- Entrada de atendimento: linhas da Agenda com `Execução = feito` e `Valor` numérico, agrupadas pela `Data`. Linhas canceladas ou não feitas ficam de fora.
- Parte da profissional = arred(Valor × comissão). Taxa = arred(Valor × taxa da forma). Atendimento sem `Pagamento` (os antigos) = taxa 0.
- Saídas do mês = Lançamentos do mês de referência + parte das profissionais nas semanas cujo domingo cai no mês + taxas da maquininha dos atendimentos do mês (ver Decisões 1 e 2).
- Aluguel entra no mês de referência quando marcado como recebido.

## Decisões (aprovadas pelo usuário em 2026-11-24)
1. **Taxa no resumo**: "Entrou" mostra o valor **bruto**. A taxa da maquininha aparece como uma linha própria em "Saiu" ("Taxas da maquininha"). Assim, "Sobrou" já é o lucro real.
2. **Mês de cada valor**: contas e aluguéis contam no **mês de referência** (a conta de luz de novembro conta em novembro, mesmo se for paga em 5/12). Atendimentos contam pela data do atendimento. O pagamento das profissionais conta no mês do **domingo** que fecha a semana. Assim o mês fica "fechado" e não muda conforme a data em que se pagou.
3. **Início**: chave `inicio` na Config, com a semana em que o app entrar no ar. Semanas e meses anteriores não aparecem como "a pagar" e ficam fora do gráfico.
4. **Semana já paga que muda depois** (manicure desfaz "feito" ou o valor muda): o app guarda o valor pago. Se o total recalculado for diferente, ele mostra "diferença de R$ X" naquela semana, para o dono acertar na próxima. O app das manicures não fica bloqueado.
5. **Qual cópia do app das manicures está no ar**: `app/` (servida em `/mk-studio/app/`). A mudança dos botões é feita só em `app/`. O usuário confirmou que `mk-agenda-app/app/` não é mais usada, então ela é **removida** do repositório (o `mk-agenda-app/Codigo.gs` fica).
6. **Equipe**: aparecem as profissionais com código no app das manicures (hoje Katia e Suênia). Quem aluga as salas não entra em Equipe: entra só como "Sala ocupada" no aluguel.

## Calls deixados para quem construir
- Detalhes visuais finos, textos dos botões e ícones.
- Desempenho: ler a aba Agenda inteira em cada chamada é aceitável no volume atual. Usar cache se ficar lento.
- Modo de demonstração (como `DEMO` no app das manicures) para testar sem servidor.
