# Estoque no app das manicures — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Manicures can view and fully manage supply stock (± quantity, add, edit, delete) from their app, in the same `Estoque` sheet tab as the owner's management app.

**Architecture:** New actions in `mk-agenda-app/Codigo.gs` read/write the `Estoque` tab (created with the same header if missing). `app/index.html` gets a header button that switches the main view between the agenda and an Estoque screen.

**Spec (short design, approved in chat 2026-11-24):** manicures get the same stock powers as the owner. A box button sits next to refresh. The screen has a "Comprar" box on top, items with −/+, tap a name to edit/delete, and "+ item" at the end. If the tab is missing, it is created with the header `ID, Item, Unidade, Quantidade, Mínimo`.

## Global Constraints
- Estoque header exactly `['ID', 'Item', 'Unidade', 'Quantidade', 'Mínimo']`, same as `mk-gestao-app/Codigo.gs`.
- Item shape `{id, item, unidade, quantidade, minimo}`. Sort: items at or below the minimum first, then by name (same as gestão).
- Quantity never below 0. An item needs a name.
- Manicure codes (`KatiaMK`, `SueniaMK`) are required, as for every action.

## Review Focus
1. **Estoque tab missing** (owner never opened gestão). It must be created and must not crash. Test in Task 1.
2. **Tab created by gestão with rows already in it.** The new item must append with the same column order. Test in Task 1.
3. **Rapid −/+ taps.** Requests are queued and the final number matches. Browser check in Task 2.

---

### Task 1: Server actions
**Files:** Modify `mk-agenda-app/Codigo.gs`. Test `tests/agenda.test.js`.
**Interfaces — Produces:** `acao: 'estoque'` → `{ok, estoque}`; `'salvarItem' {item}`, `'ajusteEstoque' {id, delta}`, `'apagarItem' {id}` → `{ok, estoque}` or `{ok:false, erro}`.
- [ ] Tests: missing tab → `estoque` returns `[]` and the tab exists with the header. `salvarItem` then `ajusteEstoque −5` on qty 2 → 0 and sorted first. `apagarItem` removes it. An empty name → `ok:false`. With a pre-existing gestão row, the new item is appended and the old one is kept. Run and watch them fail.
- [ ] Implement, run the full suite to green, commit.

### Task 2: Estoque screen in the manicure app
**Files:** Modify `app/index.html` (version 1.2), `app/sw.js` (`mk-agenda-v1.2`).
- [ ] Add the header button `#btnEstoque` (box icon). The view toggles: agenda (`#dias`, `#lista`) or `#estoque` screen with a "← Agenda" back button.
- [ ] Screen and sheets copy the gestão UX (Comprar box, −/+ with a queued optimistic update, edit sheet with Apagar, "+ item"). Demo mode keeps an in-memory list.
- [ ] Browser DEMO check: open, −, +, add, delete, back to agenda, no page errors. Commit, push to `main`.
