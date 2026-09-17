# Design system

How the admin console is styled, and where to put a new rule.

## Where the CSS lives

`app/globals.css` is an entry point only — it imports Tailwind's theme and
utility layers and then the handwritten layers in order:

| file | owns |
|---|---|
| `app/styles/tokens.css` | every colour, size, radius, shadow and duration |
| `app/styles/base.css` | document, typography, focus rings, scrollbars |
| `app/styles/shell.css` | nav rail, content column, page header, section tabs, mobile drawer |
| `app/styles/controls.css` | buttons, inputs, `Select`, `MultiSelect`, segmented toggles, chips |
| `app/styles/layout.css` | panels, page grids, metric tiles, cards, record detail |
| `app/styles/table.css` | tables, sorting, filters, pagination, row actions |
| `app/styles/forms.css` | field stack, wizard steps, save bar, sign-in, editors |
| `app/styles/feedback.css` | status pills, badges, notices, banners, drawers |
| `app/styles/modules.css` | screen-specific modules (notifications, broadcasts, partner strip, geography, approvals queue, sale workflow) |
| `app/styles/screens.css` | the loan workspace, loan queue, credit dashboard, collections, lender pipeline and API viewer |

Three components keep their own file next to them, imported from the
component: `components/admin-forms.css`, `components/listing-workflow.css`,
`components/DeleteDialog.css`.

Add a **value** to `tokens.css`. Add a **rule** to the layer that owns that
kind of surface. A rule that only one screen will ever use goes in
`modules.css` (or that screen's own file) — not in the shared layers.

## Tokens, not literals

There is one scale per dimension, and no rule should contain a raw colour, a
one-off radius or an ad-hoc font weight:

- **Colour** — `--brand-50…900`, `--ink-50…900`, `--surface`, `--canvas`,
  `--line`, `--line-strong`, plus four state families:
  `--ok-*`, `--warn-*`, `--bad-*`, `--info-*`, each with `-bg`, `-line`,
  `-fg` and `-solid`. A "pending" is `--warn-*` whether it is a table pill, a
  badge or a banner.
- **Type** — `--fs-2xs … --fs-3xl`; weights are only
  `--fw-regular/medium/semibold/bold`.
- **Space** — `--s1…--s9` on a 4px base.
- **Radius** — `--r-xs/sm/md/lg/xl/pill`.
- **Elevation** — `--e1` (resting card), `--e2` (panel), `--e3` (popover,
  hover lift), `--e4` (modal/drawer).
- **Controls** — every interactive control is `--h-sm` (30px), `--h-md`
  (36px) or `--h-lg` (42px), so a toolbar of mixed controls lines up.
- **Focus** — one treatment: `box-shadow: var(--ring)` on the control, plus
  the global `:focus-visible` outline. Never remove it without replacing it.

The older aliases (`--brand`, `--muted`, `--rose`, `--rose-line`, `--ink`,
`--shadow`) still resolve, so existing markup and inline styles keep working;
they now point at the same scale.

## Tailwind

Tailwind v4 is loaded as **theme + utilities only** — Preflight is
deliberately not imported, because it would reset the headings, lists,
borders and buttons that the layers above define. The brand scale is exposed
through `@theme` in `tokens.css`, so `bg-brand-600`, `text-ink-500` and
`rounded-md` produce the same values as the component classes. Utilities are
for new markup; the component classes still carry the console.

## Reusable building blocks

Prefer these over new markup:

- `.panel` + `.panel-header` — the console's one container.
- `.topbar` / `.eyeline` / `.page-title` / `.subtitle` / `.toolbar` — page header.
- `.grid.metrics` + `.metric` (`.tone-gold|leaf|sky|plum|red`) — KPI tiles.
- `.data-table` inside `.table-wrap`, with `.th-sort`, `.filter-row`,
  `.active-filters` + `.filter-chip`, `.table-footer`, `.row-actions`,
  `.cell-code|money|muted|skeleton`, `.table-empty`.
- `.field` + `.field-label` / `.field-hint` / `.field-error`, laid out by
  `.form-grid` (`.field-wide` to span), with `.sticky-actions` for save.
- `.btn` with `.primary`, `.ghost`, `.subtle`, `.danger`, `.add`, and
  `.sm`/`.small`, `.lg`, `.icon`, `.block`. A bare `.btn` is a valid
  secondary button.
- `.status-pill` (`.green|gold|red|blue|grey|rose`), `.tag`, `.notice`
  (`.is-ok|is-warn|is-error`), `.drawer*`.

## Three traps this codebase has already fallen into

**styled-jsx scopes per component, not per file.** A `<style jsx>` block next
to a page only reaches the elements that page renders; a small helper
component declared in the same file gets a different scope id and none of the
rules. That is why the loan workspace printed "Material fields verified0/0" —
`.meter-head { justify-content: space-between }` never reached the `Meter`
helper. There are now **no `<style jsx>` blocks left in the app**; screen
rules live in `screens.css`. Keep it that way.

**A `.panel` with no header needs `padding`.** The panel is built from parts
that carry their own inset (`.panel-header`, `.table-wrap`, `.table-footer`).
A panel holding plain content gets the inset itself, through the
`:has()` rule in `layout.css`; `.panel.is-padded` forces it. Without this the
heading sits on the top border and the controls touch both edges.

**`1fr` is not `minmax(0, 1fr)`.** An `fr` track's minimum is the *min-content*
of its widest child, so a track holding a text input (intrinsic width ~170px)
refuses to shrink and pushes the row past its container — where
`.panel { overflow: hidden }` silently cuts it off. That is what clipped the
"verified" checkboxes off the loan workspace. Always write
`minmax(0, 1fr)` in a grid that contains controls.

## Conventions

- No hard-coded pixel colours in TSX. If a value has to be computed in JS,
  return a token string (`"var(--bad-fg)"`), as the loan screens do.
- Inline `style` is for genuinely dynamic values only — a meter width, a
  chart series colour. Anything static belongs in a class.
- No `<style jsx>`. Screen-specific rules go in `screens.css` (or
  `modules.css`), where they are global and cannot miss a helper component.
- A control written without a class still gets a sane box: `base.css` styles
  bare `input`/`select`/`textarea` through `:where()`, so its specificity is
  zero and every named control still wins.
- Responsive: the rail collapses into a drawer plus a bottom bar below
  1180px. Test new screens at 414px as well as desktop.
