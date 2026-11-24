# App de gestão do MK Studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile web app (PWA) the salon owner uses to track the month's income and spending, the weekly staff payouts, room rents and supply stock. It also adds a payment-method choice to the manicure app.

**Architecture:** A new static PWA in `gestao/` (GitHub Pages) talks via `fetch` POST (JSON as `text/plain`, same as `app/`) to a new Google Apps Script web app in `mk-gestao-app/`. That script reads and writes the existing sheet "Agenda MK Studio". Pure money logic sits in `mk-gestao-app/calculos.gs` and sheet I/O in `mk-gestao-app/Codigo.gs`, and both are tested in Node with `vm` and an in-memory fake of `SpreadsheetApp`. The manicure server (`mk-agenda-app/Codigo.gs`) and app (`app/index.html`) get a `Pagamento` column and three buttons.

**Tech Stack:** Plain HTML/CSS/JS (no build step, no dependencies), Google Apps Script (V8), Node 22 `node:test` for tests only.

**Spec:** `docs/superpowers/specs/2026-11-24-app-gestao-design.md`

## Global Constraints

- All UI text is in Brazilian Portuguese. Money is shown as `R$ 1.234,56`. Months are stored as `AAAA-MM` and dates as `AAAA-MM-DD`. Time zone is `America/Sao_Paulo`.
- Sheet ID is `1YSqEBkoa3ZsngWrP1Lsa-6A0GeeL54-lN84XsEpRY58`. Don't rename or reorder existing columns in Agenda, Bloqueios, Horários, Serviços or Profissionais. New columns are appended only if missing, the way `abaAgenda_()` already does it.
- Commission is `0.5`. The professional gets 50% of the full `Valor`. The card fee comes only out of the salon's share.
- Payment methods are exactly `pix`, `credito`, `debito`, labeled "Pix", "Crédito", "Débito". Fees start at 0 and are always computed live, never stored per appointment.
- A week runs Monday to Sunday. A week's payout counts in the month of its Sunday. Bills and rents count in their reference month. Appointments count by their `Data`.
- Tracking starts at Config `inicio` (a Monday, `AAAA-MM-DD`; default = the Monday of the week the server first runs). Weeks before it are never listed, and months before its month are left out of the history chart.
- The owner's access code lives in a constant `CODIGO_DONO` in `mk-gestao-app/Codigo.gs`, default `'DonoMK'`. Manicure codes never open the management app.
- The visual style copies `app/index.html`'s CSS variables (`--bg #f7f3ee`, `--ink #19130f`, `--cacao #5a4232`, `--ok #2f7a4f`, `--no #a2412f`, fonts Cormorant Garamond + Jost). Buttons are large (≥ 48px tall) and forms open in the bottom-sheet pattern.
- Each PWA has a `DEMO` mode when `API_URL` is not an Apps Script URL, as in `app/index.html`.
- Delete `mk-agenda-app/app/` (unused per the user). Keep `mk-agenda-app/Codigo.gs`.

## Review Focus

1. **Money typed Brazilian-style** ("1.234,50", "80", "80,5", empty). It must parse to 1234.5 / 80 / 80.5 / reject empty. Test: `parseReais` in Task 4.
2. **Old Agenda rows with no `Pagamento` or a non-numeric `Valor`.** Fee is 0 for the first, and the row is skipped for the second. Test: `entradasDoMes` cases in Task 1.
3. **A week spanning two months** (e.g. Mon 2026-11-30 → Sun 2026-12-06). It counts entirely in December. Test in Task 1.
4. **A paid week whose total later changes.** It shows `diferenca` ≠ 0 and must not create a new payout row. Test in Task 1.
5. **A room switched to free mid-history.** Past months that have an Aluguéis row still show it, and future months don't. Test in Task 2.

---

### Task 1: Pure calculations (`calculos.gs`)

**Files:**
- Create: `mk-gestao-app/calculos.gs`
- Create: `tests/carregar.js` (loads .gs files into a `vm` context and returns named functions)
- Test: `tests/calculos.test.js`

**Interfaces:**
- Produces (all pure, no Apps Script APIs):
  - `arred(n: number) -> number` (2 decimals)
  - `taxaDe(valor: number, pagamento: ''|'pix'|'credito'|'debito', taxas: {pix,credito,debito}) -> number`. Each `taxas.x` is a percent (e.g. 3.5), so the result is `arred(valor*taxas[x]/100)`, and 0 for an unknown or empty method.
  - `segundaDe(iso) -> iso`, `domingoDe(segundaISO) -> iso`, `mesDe(iso) -> 'AAAA-MM'`, `mesDaSemana(segundaISO) -> 'AAAA-MM'` (month of the Sunday)
  - `entradasDoMes(mes, agenda: [{data, profissional, servico, cliente, valor, execucao, status, pagamento}], comissao, taxas) -> [{data, profissional, servico, cliente, valor, pagamento, taxa, parteProf, liquido}]`. It keeps only `execucao==='feito'`, numeric `valor` and `mesDe(data)===mes`, sorted by data. `liquido = valor - parteProf - taxa`.
  - `semanasEquipe(agenda, pagamentos: [{semana, profissional, valor, pagoEm}], profissionais: [string], comissao, inicio, hoje) -> [{semana, domingo, mes, profissionais: [{nome, devido, pago: bool, valorPago, pagoEm, diferenca}]}]`. It returns weeks from `inicio` up to the week of `hoje`, newest first. `devido` is the sum of `parteProf` over `feito` rows of that professional in Mon..Sun. `diferenca = pago ? arred(devido - valorPago) : 0`.
  - `resumoMes(mes, {entradas, alugueis: [{mes, valor, recebido}], lancamentos: [{mes, categoria, valor, pago}], semanas}) -> {entrou:{atendimentos, alugueis, total}, saiu:{contas, material, profissionais, taxas, total}, sobrou}`. Here `contas` = paid lançamentos of the month with categoria ≠ 'Material', `material` = paid 'Material', `profissionais` = sum of `devido` of weeks whose `mes === mes`, and `taxas` = sum of entradas' `taxa`. `atendimentos` is gross.

- [ ] **Step 1: Write `tests/carregar.js`.** Export `carregar(arquivos: string[], globais = {}) -> object`. It reads the files, concatenates them, and runs them in `vm.createContext({console, ...globais})`. It appends `;({${names}})` where `names` are all `function` declarations found by `/^function (\w+)/gm`, and returns that object.
- [ ] **Step 2: Write failing tests `tests/calculos.test.js`** (`node:test` + `assert/strict`):
  - `taxaDe(100,'credito',{pix:0,credito:4,debito:2})===4`; `taxaDe(100,'',…)===0`; `taxaDe(100,'dinheiro',…)===0`
  - `mesDaSemana('2026-11-30')==='2026-12'`; `segundaDe('2026-11-29')==='2026-11-23'` (Sunday → previous Monday)
  - `entradasDoMes('2026-11', rows, 0.5, {pix:0,credito:4,debito:0})` where rows are: a feito 100 credito (2026-11-10), a feito 80 with no pagamento, a feito with `valor:''`, a `não feito` 50, and a feito 70 dated 2026-12-01. Expect 2 entries, the first `{taxa:4, parteProf:50, liquido:46}` and the second `{taxa:0, parteProf:40, liquido:40}`.
  - `semanasEquipe` with Katia feito 100 on 2026-11-24 and a pagamento `{semana:'2026-11-23', profissional:'Katia', valor:40}`. Katia's week 2026-11-23 has `devido:50, pago:true, diferenca:10`. Suênia shows `devido:0, pago:false`. A week before `inicio` is absent.
  - A week Mon 2026-11-30 with feito 100 on 2026-12-02 has `mes:'2026-12'`.
  - `resumoMes` with entradas [100 credito taxa 4], alugueis [{mes:'2026-11', valor:300, recebido:true}, {…recebido:false}], lancamentos [Luz 200 pago, Material 60 pago, Água 90 não pago] and semanas with devido 50 in 2026-11. Expect `entrou.total 400`, `saiu {contas:200, material:60, profissionais:50, taxas:4, total:314}`, `sobrou 86`.
- [ ] **Step 3: Run** `node --test tests/` and expect FAIL (functions not defined).
- [ ] **Step 4: Implement `mk-gestao-app/calculos.gs`** with the signatures above. Use date math on `new Date(iso+'T12:00:00Z')` with UTC getters, like `somaDias_` in `mk-agenda-app/Codigo.gs`. Name matching for professionals uses accent-free lowercase comparison (`norm`, also defined here).
- [ ] **Step 5: Run** `node --test tests/` and expect PASS.
- [ ] **Step 6: Commit** `feat(gestao): cálculos de entradas, equipe e resumo do mês`

### Task 2: Management server (`Codigo.gs`)

**Files:**
- Create: `mk-gestao-app/Codigo.gs`
- Create: `tests/fake-planilha.js` (in-memory `SpreadsheetApp`, `LockService`, `ContentService`, `Utilities.formatDate` for `yyyy-MM-dd`/`HH:mm`)
- Test: `tests/servidor.test.js`

**Interfaces:**
- Consumes: everything from Task 1 (loaded together: `carregar(['mk-gestao-app/calculos.gs','mk-gestao-app/Codigo.gs'], fake)`).
- Produces: `doPost(e)` taking `{codigo, acao, mes?, ...}` and returning JSON. Every successful action returns `dados_(mes)` for the request's `mes` (default the current month):
  ```
  { ok, hoje, mes, config:{taxas:{pix,credito,debito}, comissao, inicio},
    resumo, historico:[{mes, entrou, saiu, sobrou}]   // up to 6 months ending at mes, none before inicio
    contas:[{id, nome, categoria, fixa, ativa, lanc:{id, valor, pago}|null}],   // active fixed + any with a lanc this month
    avulsos:[{id, data, descricao, categoria, valor, pago}],                   // lançamentos of mes with empty ContaID
    entradas:[…from entradasDoMes], 
    alugueis:[{salaId, nome, valor, recebido}],  // salas with an Aluguéis row for mes, plus (mes >= current month) occupied salas without one, valor = sala's
    salas:[{id, nome, valor, ocupada}],
    semanas:[…from semanasEquipe, limited to 8 newest],
    estoque:[{id, item, unidade, quantidade, minimo}] }   // sorted: quantidade<=minimo first, then by item
  ```
  Actions: `login` → `{ok, nome:'Dono'}`; `dados`; `salvarConta {conta:{id?, nome, categoria, fixa, ativa}}`; `lancar {lancamento:{id?, contaId?, descricao, categoria, valor, pago, data?}}` (upsert on id; for a fixed bill, upsert on `contaId+mes`); `apagarLancamento {id}`; `historicoConta {id}` → `{ok, historico:[{mes, valor, pago}]}` newest first; `aluguel {salaId, recebido:bool}` (upserts Aluguéis row for `mes` with the sala's valor; Data = today when recebido); `salvarSala {sala:{id, nome, valor, ocupada}}`; `pagarSemana {semana, profissional, valor, pago:bool}` (pago true appends or updates a row with `Pago em` = today; false deletes it); `salvarItem {item:{id?, item, unidade, quantidade, minimo}}`; `ajusteEstoque {id, delta}` (never below 0); `apagarItem {id}`; `config {taxas:{pix,credito,debito}}`.
- Sheet tabs are created with headers if missing: Contas, Lançamentos, Salas, Aluguéis, Pagamentos, Estoque, Config (headers exactly as in the spec). Seed only on creation: Salas `S1 'Sala 1' 300 ocupada=sim`, `S2 'Sala 2' 300 ocupada=não`; Config `taxa_pix 0`, `taxa_credito 0`, `taxa_debito 0`, `comissao 0.5`, `inicio <Monday of today>`. IDs are `Utilities.getUuid()` (fake returns incrementing ids).
- Agenda is read read-only, by header name: `Data, Profissional, Serviço, Cliente, Status, Execução, Valor, Pagamento` (missing `Pagamento` → ''). Professionals list = Profissionais sheet rows whose `ID` is in `IDS_EQUIPE = ['katia','suenia']`.

- [ ] **Step 1: Write `tests/fake-planilha.js`.** Export `fake(abas: {[nome]: any[][]}) -> globais`. Sheets support `getSheetByName, insertSheet, getDataRange().getValues(), getRange(r,c[,nr,nc]).getValues()/setValue()/setValues(), appendRow, deleteRow, getLastRow, getLastColumn`. `ContentService.createTextOutput(s).setMimeType()` returns `{conteudo:s}`. Also export `post(g, corpo) -> objeto` (calls `g.doPost({postData:{contents:JSON.stringify(corpo)}})` and parses).
- [ ] **Step 2: Write failing tests `tests/servidor.test.js`:**
  - wrong code `KatiaMK` → `{ok:false}`; `DonoMK` login ok
  - first `dados` creates all 7 tabs and seeds two salas (only S1 occupied) and the fees at 0
  - `lancar` a fixed bill twice for the same month → one Lançamentos row with the last valor; `historicoConta` lists it
  - `aluguel {salaId:'S1', recebido:true}` in 2026-11 → resumo.entrou.alugueis 300. Then `salvarSala S1 ocupada:false` → `dados` for 2026-11 still shows S1 (row exists), while `dados` for 2026-12 shows no salas (Review Focus 5)
  - `pagarSemana` true then `dados` → that week's professional `pago:true`. Then change Agenda Valor → `diferenca` ≠ 0 and Pagamentos still has 1 row (Review Focus 4)
  - `ajusteEstoque` delta −5 on quantidade 2 → 0; an item at its minimum sorts first
  - Agenda without a `Pagamento` header → entradas still computed with taxa 0
- [ ] **Step 3: Run** `node --test tests/` and expect the new tests to FAIL.
- [ ] **Step 4: Implement `mk-gestao-app/Codigo.gs`.** Use the same helper style as `mk-agenda-app/Codigo.gs` (`json_`, `comTrava_` around every write, `normData_`, `numero_`, `norm_`). Header comment gives deploy steps: new Apps Script project, add files `Codigo.gs` + `calculos.gs`, Deploy → Web app, Execute as Me, Anyone.
- [ ] **Step 5: Run** `node --test tests/` and expect all PASS.
- [ ] **Step 6: Commit** `feat(gestao): servidor Apps Script da gestão`

### Task 3: Payment method in the manicure app

**Files:**
- Modify: `mk-agenda-app/Codigo.gs` (`abaAgenda_` column list, `marcar_`, `dados_`)
- Modify: `app/index.html` (`abrirFeito`, demo handlers), `app/sw.js` (`CACHE = 'mk-agenda-v1.1'`), version comment → `<!-- versão 1.1 -->`
- Delete: `mk-agenda-app/app/`
- Test: `tests/agenda.test.js`

**Interfaces:**
- Produces: Agenda column `Pagamento` with values `pix|credito|debito|''`. Request `marcar` accepts `pagamento`. `dados_` atendimentos include `pagamento`.

- [ ] **Step 1: Write failing test** `tests/agenda.test.js`: load `mk-agenda-app/Codigo.gs` with the fake (sheets Agenda/Profissionais/Serviços/Bloqueios/Horários minimal). `marcar {codigo:'KatiaMK', execucao:'feito', valorCheio:100, pagamento:'credito'}` on today's row → Agenda gets a `Pagamento` header and `credito`. `pagamento:'dinheiro'` → `{ok:false, erro:'Escolha Pix, Crédito ou Débito.'}`. `nao_feito` and `desfazer` clear `Pagamento`.
- [ ] **Step 2: Run** `node --test tests/agenda.test.js` and expect FAIL.
- [ ] **Step 3: Implement.** Add `'Pagamento'` to the auto-created columns. In `marcar_`, `feito` requires `req.pagamento ∈ {pix,credito,debito}` and writes it, while the other branches write `''`. `dados_` returns `pagamento`.
- [ ] **Step 4: Implement the UI in `abrirFeito`.** Above Confirmar, add a row of three equal buttons labeled exactly "Pix", "Crédito", "Débito" (class `pay`, selected state uses `--cacao` background). Pre-select `a.pagamento` if set. Confirmar stays disabled until one is chosen. Send `pagamento` in `enviar('marcar', …)`. Demo mode stores it.
- [ ] **Step 5: Run** `node --test tests/` (all PASS), then open `app/index.html` in the browser (DEMO), mark one as feito with Crédito, and confirm the button state.
- [ ] **Step 6: Commit** `feat(agenda): forma de pagamento ao marcar feito; remove cópia antiga do app`

### Task 4: Management PWA shell, login, Resumo and Ajustes

**Files:**
- Create: `gestao/index.html`, `gestao/sw.js` (copy of `app/sw.js` with `CACHE='mk-gestao-v1.0'`), `gestao/manifest.webmanifest` (name "MK Studio · Gestão", short_name "MK Gestão"), icons copied from `app/`
- Test: `tests/gestao-util.test.js`

**Interfaces:**
- Consumes: the Task 2 `dados_` shape and actions.
- Produces (inside `gestao/index.html`, in a `<script id="util">` block that the test extracts by id): `parseReais(s) -> number|null`, `reais(n) -> '1.234,56'`, `nomeMes('2026-11') -> 'novembro de 2026'`, `somaMes('2026-11', ±1) -> 'AAAA-MM'`. The app state is `estado = {mes, dados}`, and `api(acao, extra)` always sends `mes: estado.mes`.
- Bottom tab bar order and labels: **Resumo · Contas · Entradas · Equipe · Estoque**, plus a gear button in the header for **Ajustes**. Header shows ‹ month › arrows.

- [ ] **Step 1: Write failing test** for `parseReais`: `'1.234,50'→1234.5`, `'80'→80`, `'80,5'→80.5`, `''→null`, `'abc'→null`. Also `reais(1234.5)==='1.234,50'` and `somaMes('2026-12',1)==='2027-01'`.
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement the util block + shell.** This covers login with the localStorage key `mk-gestao-codigo`, the month switcher and tab switching, and the DEMO dataset (one month with 2 bills, 1 Material, 4 appointments, 1 paid room, 2 weeks, 4 stock items, one at its minimum).
- [ ] **Step 4: Implement Resumo.** Three cards: **Entrou** (green), **Saiu** (red), **Sobrou** (dark, negative in red), each tappable to expand detail lines (Atendimentos, Aluguéis / Contas, Material, Profissionais, Taxas da maquininha). Below them, a bar chart of `historico` (pairs of entrou/saiu bars, inline SVG, labels = 3-letter month).
- [ ] **Step 5: Implement Ajustes sheet.** It has fee inputs (%) for Pix/Crédito/Débito → `config`; salas list with a toggle Ocupada/Livre and valor → `salvarSala`; and a "Contas fixas" list with add/edit (nome, categoria from `['Fixas','Material','Manutenção','Outros']`, ativa toggle) → `salvarConta`.
- [ ] **Step 6: Run tests** (PASS), then open `gestao/index.html` in the browser in DEMO mode at a 390×844 viewport. Check that login, month switch, Resumo totals (match the DEMO numbers computed by hand) and Ajustes all work.
- [ ] **Step 7: Commit** `feat(gestao): app — login, resumo e ajustes`

### Task 5: Contas and Entradas tabs

**Files:**
- Modify: `gestao/index.html`

**Interfaces:**
- Consumes: `contas`, `avulsos`, `entradas`, `alugueis` from `dados`; actions `lancar`, `apagarLancamento`, `historicoConta`, `aluguel`.

- [ ] **Step 1: Contas tab.** Show the month total paid / to pay at the top. Each fixed bill is a card: name, valor (or "— lançar valor"), pill **Pago**/**A pagar**. Tapping opens a sheet with a valor field (`parseReais`, required), a Pago toggle, Salvar, and a "Ver histórico" link (list of month → valor, pago). Below that is "Outros gastos" (avulsos) with **+ gasto** (descrição, categoria incl. Material, valor, pago) and delete in its sheet.
- [ ] **Step 2: Entradas tab.** At the top, show "Salas" with each `alugueis` item: name, R$ 300, and a big **Recebido** toggle → `aluguel`. Next, show the appointments total (bruto, taxas, parte das profissionais, líquido). Then list appointments grouped by day (date heading), each line: cliente · serviço · profissional, valor, small badge Pix/Crédito/Débito/"—".
- [ ] **Step 3: Verify in the browser (DEMO).** Launch a bill → Resumo updates. An invalid valor shows an inline error and does not submit. Toggling a room changes Entrou.
- [ ] **Step 4: Commit** `feat(gestao): abas Contas e Entradas`

### Task 6: Equipe and Estoque tabs

**Files:**
- Modify: `gestao/index.html`

**Interfaces:**
- Consumes: `semanas`, `estoque`; actions `pagarSemana`, `salvarItem`, `ajusteEstoque`, `apagarItem`.

- [ ] **Step 1: Equipe tab.** One card per week (heading "23 a 29 de nov", current week labeled "esta semana"). Each card has a row per professional: name, devido, and a button **Marcar como pago** (confirm sheet showing the value) or the pill "Pago em 24/11" with "desfazer". If `diferenca ≠ 0`, show a warning line "Diferença de R$ X desde o pagamento" (positive = owes more, negative = paid more).
- [ ] **Step 2: Estoque tab.** At the top, a box **Comprar** listing items with `quantidade <= minimo` (or "Nada para comprar"). Then all items: name, "3 frascos", big **–** / **+** buttons (each → `ajusteEstoque` ±1, optimistic update), and tapping the name opens the edit sheet (item, unidade, quantidade, mínimo, apagar). Add **+ item** at the end.
- [ ] **Step 3: Verify in the browser (DEMO).** Pay a week → pill appears. Press – until the minimum → the item moves into Comprar.
- [ ] **Step 4: Commit** `feat(gestao): abas Equipe e Estoque`

### Task 7: Deployment guide and end-to-end check

**Files:**
- Create: `mk-gestao-app/COMO-INSTALAR.md` (Portuguese, numbered steps for the user)

- [ ] **Step 1: Write the guide.**
  - (a) New Apps Script project "MK Gestão": paste `Codigo.gs` and `calculos.gs`, run `doGet` once to authorize, deploy as Web app (Me / Anyone), copy the `/exec` URL and send it to Claude.
  - (b) In the existing manicure Apps Script project, replace `Codigo.gs` and use Deploy → Manage deployments → edit → New version, so the URL stays the same.
  - (c) Open `https://guilhermejaroque.github.io/mk-studio/gestao/` on the father's phone and choose "Add to Home Screen". The code is `DonoMK`.
- [ ] **Step 2: Run** `node --test tests/` and expect all PASS.
- [ ] **Step 3: Open both apps in DEMO in the browser** and run through the Review Focus list by hand.
- [ ] **Step 4: Commit** `docs(gestao): guia de instalação`. Push to `main` (GitHub Pages serves from it). After the user sends the URL, set `API_URL` in `gestao/index.html` and push again.
