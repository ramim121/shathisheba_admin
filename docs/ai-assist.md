# AI assistance

Where the console uses the Gemini key, what it is allowed to do, and how to add
a new use.

## What it does

| Task | Where it appears | What it returns |
|---|---|---|
| `draft` | The **AI** chip on any free-text field of a generic form, the listing form and the notice composer | Text for that one field, written from the other values already on the form |
| `translate` | The **Translate** chip on a `*_bn` field whose `*_en` twin has content | The Bangla (or English) of the twin field |
| `animal_photo` | "Add photo" in *Act for a farmer → New sale listing* | Species, breed guess, colour, age and weight estimates, body condition, visible issues, and a draft title and description |
| `document_photo` | Available on the endpoint; not yet wired to a screen | Transcribed NID/document fields, plus what would make a reviewer reject the image |
| `explain` | Available on the endpoint; not yet wired to a screen | A short paragraph on what state a record is in and what to do next |

Everything is a **suggestion**. `POST /api/v1/admin/ai/assist` never writes to
the database: the reply lands in a preview and a human presses "Use this",
which fills the input they were already editing. A bad generation costs one
click.

## Model

`gemini-3.6-flash`, in `lib/ai-assist.ts`. It is multimodal (the photo tasks
need that), it honours `responseMimeType: application/json` so the structured
tasks parse, and it is the fast tier on this key. The community moderation
check in `lib/gemini.ts` deliberately stays on Gemma — it is a different job
with a tuned prompt.

If the key changes, check what it can actually reach before picking a model:

```
GET https://generativelanguage.googleapis.com/v1beta/models?key=...
```

## Rules the server keeps

- **Staff only.** `admin/ai/assist` is in `ADMIN_ONLY`, so an app token cannot
  reach it.
- **No arbitrary fetching.** A photo may be a `data:` URL from the browser, a
  path under `/uploads/` or `/api/files/`, or an absolute URL inside the
  configured media bucket. Anything else is refused, so the endpoint cannot be
  used to make the server fetch a URL of the caller's choosing.
- **6 MB per image.**
- **Failures are 422, not 500.** A quota or model error is the admin's problem
  to read; it is returned as a message next to the field.
- **No invented facts.** Every prompt says so explicitly, and the photo tasks
  return `null` rather than a guess for age and weight — a wrong weight becomes
  a wrong price on a real listing.

## Adding a use

1. Add a task to `AssistRequest` and `runAssist` in `lib/ai-assist.ts`, with a
   prompt that says what may *not* be invented.
2. On the screen, put `<AiAssistLaunch>` on the label row and
   `<AiAssistPanel>` under the control — one component rendering both would put
   the panel inside the `<label>`.
3. Pass a `context()` that reads the form's current values. The suggestion is
   only as good as what it is told about the record.
