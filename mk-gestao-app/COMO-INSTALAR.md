# Como colocar o app de gestão no ar

São três partes: o servidor da gestão (novo), a atualização do servidor das manicures e o app no celular do seu pai.

## 1. Servidor da gestão (novo projeto no Apps Script)

1. Entre em https://script.google.com com a mesma conta Google dona da planilha "Agenda MK Studio".
2. Clique em **Novo projeto** e dê o nome **MK Gestão**.
3. Apague o conteúdo do arquivo `Código.gs` que já vem aberto. Cole o conteúdo de `mk-gestao-app/Codigo.gs`.
4. Clique no **+** ao lado de "Arquivos", escolha **Script** e dê o nome `calculos`. Cole nele o conteúdo de `mk-gestao-app/calculos.gs`.
5. Salve (ícone de disquete).
6. No menu de funções do topo, escolha `doGet` e clique em **Executar**. O Google vai pedir autorização: clique em **Revisar permissões**, escolha a sua conta, depois **Avançado → Acessar MK Gestão (não seguro)** e **Permitir**. Esse aviso aparece porque o script é seu e não foi publicado na loja do Google.
7. Clique em **Implantar → Nova implantação**.
   - Engrenagem → **App da Web**.
   - Executar como: **Eu**.
   - Quem pode acessar: **Qualquer pessoa**.
   - Clique em **Implantar** e copie o **URL do app da Web** (termina em `/exec`).
8. **Mande esse URL para o Claude.** Ele coloca o endereço no app e publica.

Na primeira vez que o app abrir, as abas novas (Contas, Lançamentos, Salas, Aluguéis, Pagamentos, Estoque, Config) aparecem sozinhas na planilha. A Sala 1 já vem como ocupada e a Sala 2 como livre.

## 2. Atualizar o servidor das manicures (botões Pix / Crédito / Débito)

1. Abra o projeto do Apps Script do **app das manicures**, o mesmo que você já usa.
2. Substitua todo o conteúdo de `Código.gs` pelo de `mk-agenda-app/Codigo.gs` e salve.
3. Clique em **Implantar → Gerenciar implantações**. Clique no lápis da implantação ativa, em **Versão** escolha **Nova versão** e clique em **Implantar**.
   Assim o endereço continua o mesmo e o app das manicures não precisa mudar.

Enquanto este passo não for feito, o app das manicures mostra os botões, mas o servidor antigo não grava a forma de pagamento. Nesse período os atendimentos entram sem taxa.

## 3. No celular do seu pai

1. Abra **https://guilhermejaroque.github.io/mk-studio/gestao/** no navegador do celular (Safari no iPhone, Chrome no Android).
2. Toque em **Compartilhar → Adicionar à Tela de Início** (iPhone) ou **⋮ → Adicionar à tela inicial** (Android).
3. Abra pelo ícone **MK Gestão** e digite o código **DonoMK**.

Para trocar o código, mude a linha `const CODIGO_DONO = 'DonoMK';` no `Codigo.gs` da gestão e faça uma **Nova versão** da implantação, como no passo 2.3.

## Quando tiver as taxas da maquininha

No app, toque na engrenagem (⚙︎) → **Taxas da maquininha**, digite as porcentagens e toque em **Salvar taxas**. As contas de todos os meses se ajustam sozinhas.
