import { GoogleGenAI } from "@google/genai";

/**
 * Writing and extraction help for the console, on top of the same Gemini key
 * the moderation check uses.
 *
 * Everything here is a *suggestion*: the endpoint never writes to the
 * database. The UI drops the text into the field the admin is editing and they
 * save it themselves, so a bad generation costs one click, not a record.
 *
 * Model choice: gemini-3.6-flash. It is multimodal (the photo tasks need
 * that), accepts `responseMimeType: application/json` so the structured tasks
 * come back parseable, and is the fast tier on this key. The moderation helper
 * stays on Gemma deliberately — it is tuned and cheap for that one job.
 */
const MODEL = "gemini-3.6-flash";

export function isAiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function client() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured on the server.");
  return new GoogleGenAI({ apiKey: key });
}

/** Models occasionally wrap JSON in prose or a fence despite the mime type. */
function parseJson<T>(raw: string, fallback: T): T {
  let text = (raw ?? "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open !== -1 && close !== -1) text = text.slice(open, close + 1);
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function generate(parts: unknown[], json: boolean, temperature = 0.4): Promise<string> {
  const ai = client();
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: parts as never }],
    config: json
      ? { temperature, responseMimeType: "application/json" }
      : { temperature }
  });
  return res.text ?? "";
}

const PLATFORM = `Shathi Sheba is a Bangladeshi agriculture platform. Its users are smallholder farmers, mostly in rural districts, reading on a phone in Bangla or simple English. Money is Bangladeshi taka (৳). Never invent prices, dates, phone numbers, names or guarantees that were not given to you.`;

/* ---------------------------------------------------------------------------
   1. Draft or rewrite one field
   --------------------------------------------------------------------------- */

export type DraftInput = {
  /** Human label of the field being written, e.g. "Description (Bangla)". */
  label: string;
  /** Resource key, e.g. "sale/listings" — tells the model what it is writing about. */
  resource?: string;
  /** The other values on the form, so the text is about this record. */
  context?: Record<string, unknown>;
  /** Text already in the box: present means "improve this", absent means "write it". */
  existing?: string;
  language?: "en" | "bn";
  /** Optional steer typed by the admin ("mention the vaccination record"). */
  instruction?: string;
  length?: "short" | "medium" | "long";
};

const LENGTH_HINT: Record<string, string> = {
  short: "One line, at most 18 words.",
  medium: "Two or three sentences, at most 55 words.",
  long: "Up to two short paragraphs, at most 130 words."
};

/** Values not worth sending to the model (ids, blobs, empty). */
function usefulContext(context: Record<string, unknown> | undefined) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    if (/password|token|_json$|^id$|_id$/i.test(key)) continue;
    const text = String(value);
    if (!text.trim() || text.length > 400) continue;
    out[key] = text;
  }
  return out;
}

export async function draftField(input: DraftInput): Promise<{ text: string }> {
  const language = input.language ?? "en";
  const context = usefulContext(input.context);
  const prompt = [
    PLATFORM,
    `You are helping a Shathi Sheba staff member fill one field of an admin form.`,
    `Field: ${input.label}`,
    input.resource ? `Record type: ${input.resource}` : "",
    Object.keys(context).length ? `What is already on the form:\n${JSON.stringify(context, null, 1)}` : "",
    input.existing?.trim()
      ? `Improve this text, keeping every fact in it:\n"""${input.existing.trim().slice(0, 1200)}"""`
      : `Write the field from scratch using only the facts above.`,
    input.instruction?.trim() ? `Staff instruction: ${input.instruction.trim().slice(0, 300)}` : "",
    language === "bn"
      ? `Write in natural Bangla (বাংলা). Use everyday words a farmer would use, not formal or literary Bangla.`
      : `Write in plain English at about a class-8 reading level.`,
    LENGTH_HINT[input.length ?? "medium"],
    `Return only the field text. No labels, no quotes, no markdown, no preamble.`
  ]
    .filter(Boolean)
    .join("\n\n");

  const text = (await generate([{ text: prompt }], false)).trim();
  return { text: text.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 1600) };
}

/* ---------------------------------------------------------------------------
   2. Translate a paired field
   --------------------------------------------------------------------------- */

/**
 * Every content table in this schema carries `*_en` and `*_bn`. Filling the
 * second one by hand is the single most repeated job in the console.
 */
export async function translateField(text: string, to: "en" | "bn"): Promise<{ text: string }> {
  const source = (text ?? "").trim();
  if (!source) return { text: "" };
  const prompt = [
    PLATFORM,
    to === "bn"
      ? `Translate the text into natural Bangla for a farmer audience. Keep numbers, ৳ amounts, dates, codes and proper nouns exactly as they are. Do not add anything.`
      : `Translate the text into plain English. Keep numbers, ৳ amounts, dates, codes and proper nouns exactly as they are. Do not add anything.`,
    `Return only the translation.`,
    `TEXT:\n"""${source.slice(0, 2000)}"""`
  ].join("\n\n");
  const out = (await generate([{ text: prompt }], false, 0.1)).trim();
  return { text: out.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 2400) };
}

/* ---------------------------------------------------------------------------
   3. Read a photo of an animal into form fields
   --------------------------------------------------------------------------- */

export type AnimalRead = {
  species: string;
  breed_guess: string;
  coat_colour: string;
  age_estimate_months: number | null;
  weight_estimate_kg: number | null;
  body_condition_1_5: number | null;
  horn_status: string;
  visible_issues: string[];
  photo_quality: string;
  title_en: string;
  title_bn: string;
  description_en: string;
  description_bn: string;
  confidence: number;
  notes: string;
};

const EMPTY_ANIMAL: AnimalRead = {
  species: "", breed_guess: "", coat_colour: "", age_estimate_months: null,
  weight_estimate_kg: null, body_condition_1_5: null, horn_status: "",
  visible_issues: [], photo_quality: "", title_en: "", title_bn: "",
  description_en: "", description_bn: "", confidence: 0, notes: ""
};

export async function readAnimalPhoto(
  image: { data: string; mimeType: string },
  context?: Record<string, unknown>
): Promise<AnimalRead> {
  const known = usefulContext(context);
  const prompt = [
    PLATFORM,
    `A field officer photographed an animal a farmer wants to list for sale. Read the photo and fill the JSON below.`,
    Object.keys(known).length ? `Already known (trust these over the photo):\n${JSON.stringify(known, null, 1)}` : "",
    `Rules:
- Estimate age and weight only if the animal is clearly visible; otherwise use null. A wrong weight becomes a wrong price.
- body_condition_1_5: 1 very thin, 3 healthy, 5 over-conditioned.
- visible_issues: only what the photo actually shows (lameness, skin condition, wound, dirty coat, eye discharge). Empty array if none.
- photo_quality: "good", "usable" or "poor" — say poor if the animal is cut off, dark, or far away.
- If the photo is not of a farm animal at all, set species "" and explain in notes.
- Titles and descriptions must describe only what you can see plus the known facts. No price, no phone number, no guarantee.
- description_bn / title_bn in natural Bangla; description_en / title_en in plain English.`,
    `Return strict JSON with exactly these keys:
{"species":"cattle|goat|sheep|buffalo|poultry|other|","breed_guess":"","coat_colour":"","age_estimate_months":null,"weight_estimate_kg":null,"body_condition_1_5":null,"horn_status":"","visible_issues":[],"photo_quality":"","title_en":"","title_bn":"","description_en":"","description_bn":"","confidence":0.0,"notes":""}`
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await generate(
    [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }],
    true,
    0.2
  );
  const parsed = parseJson<Partial<AnimalRead>>(raw, {});
  return {
    ...EMPTY_ANIMAL,
    ...parsed,
    visible_issues: Array.isArray(parsed.visible_issues) ? parsed.visible_issues.map(String).slice(0, 6) : [],
    age_estimate_months: numberOrNull(parsed.age_estimate_months),
    weight_estimate_kg: numberOrNull(parsed.weight_estimate_kg),
    body_condition_1_5: numberOrNull(parsed.body_condition_1_5),
    confidence: Number(parsed.confidence ?? 0) || 0
  };
}

/* ---------------------------------------------------------------------------
   4. Read an identity document into form fields
   --------------------------------------------------------------------------- */

export type DocumentRead = {
  doc_kind: string;
  full_name: string;
  nid_number: string;
  date_of_birth: string;
  address: string;
  issue_date: string;
  legible: boolean;
  problems: string[];
  confidence: number;
};

export async function readDocumentPhoto(image: { data: string; mimeType: string }): Promise<DocumentRead> {
  const prompt = [
    `You are reading a photographed Bangladeshi identity or farm document for a KYC reviewer.`,
    `Transcribe only what is printed. Never guess a digit. If a field is unreadable or absent, return "".`,
    `date_of_birth and issue_date as YYYY-MM-DD when a full date is printed, otherwise "".`,
    `problems: list what would make a reviewer reject it — "blurred", "glare", "cropped", "expired", "photo of a screen", "handwritten alteration". Empty array if clean.`,
    `Return strict JSON:
{"doc_kind":"nid_front|nid_back|passport|birth_certificate|trade_licence|land_document|other","full_name":"","nid_number":"","date_of_birth":"","address":"","issue_date":"","legible":true,"problems":[],"confidence":0.0}`
  ].join("\n\n");

  const raw = await generate(
    [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }],
    true,
    0
  );
  const parsed = parseJson<Partial<DocumentRead>>(raw, {});
  return {
    doc_kind: String(parsed.doc_kind ?? "other"),
    full_name: String(parsed.full_name ?? ""),
    nid_number: String(parsed.nid_number ?? "").replace(/[^\d]/g, ""),
    date_of_birth: String(parsed.date_of_birth ?? ""),
    address: String(parsed.address ?? ""),
    issue_date: String(parsed.issue_date ?? ""),
    legible: parsed.legible !== false,
    problems: Array.isArray(parsed.problems) ? parsed.problems.map(String).slice(0, 6) : [],
    confidence: Number(parsed.confidence ?? 0) || 0
  };
}

/* ---------------------------------------------------------------------------
   5. Explain a record in one paragraph
   --------------------------------------------------------------------------- */

/**
 * For the screens where the question is "what is going on with this one" — a
 * stalled loan application, a listing that will not progress. Reads the row
 * and says it in a sentence, with the next action.
 */
export async function explainRecord(
  resource: string,
  row: Record<string, unknown>,
  extra?: Record<string, unknown>
): Promise<{ text: string }> {
  const prompt = [
    PLATFORM,
    `A staff member opened this ${resource} record. In 2-4 sentences, plain English: what state is it in, what is missing or unusual, and what the next action should be. Use only the data given. If something looks contradictory, say so.`,
    `RECORD:\n${JSON.stringify(usefulContext(row), null, 1)}`,
    extra && Object.keys(extra).length ? `RELATED:\n${JSON.stringify(extra, null, 1).slice(0, 2000)}` : "",
    `Return only the paragraph.`
  ]
    .filter(Boolean)
    .join("\n\n");
  const text = (await generate([{ text: prompt }], false, 0.3)).trim();
  return { text: text.slice(0, 900) };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------------------
   Request entry point
   --------------------------------------------------------------------------- */

export type AssistRequest = {
  task: "draft" | "translate" | "animal_photo" | "document_photo" | "explain";
  label?: string;
  resource?: string;
  context?: Record<string, unknown>;
  existing?: string;
  language?: "en" | "bn";
  instruction?: string;
  length?: "short" | "medium" | "long";
  text?: string;
  to?: "en" | "bn";
  /** data: URL or bare base64 from the browser, or a path under /uploads. */
  image?: string;
  row?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** Accepts a data: URL, bare base64, or an /uploads path served by this app. */
export async function resolveImage(image: string): Promise<{ data: string; mimeType: string }> {
  const value = (image ?? "").trim();
  if (!value) throw new Error("An image is required for this task.");

  const dataUrl = value.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (dataUrl) {
    const bytes = Buffer.from(dataUrl[2], "base64");
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("That image is larger than 6 MB.");
    return { data: dataUrl[2], mimeType: dataUrl[1] };
  }

  if (/^https?:\/\//i.test(value) || value.startsWith("/")) {
    // Only this platform's own storage: the model must not become a fetcher
    // for arbitrary URLs a request names. Absolute URLs are allowed when they
    // point at the configured media bucket, which is where /api/upload puts
    // things once S3 is on.
    const bucketBase = (process.env.S3_PUBLIC_URL || (process.env.S3_BUCKET_NAME
      ? `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.S3_BUCKET_REGION || "ap-southeast-1"}.amazonaws.com`
      : "")).replace(/\/$/, "");
    if (/^https?:\/\//i.test(value)) {
      if (!bucketBase || !value.startsWith(bucketBase)) {
        throw new Error("Only images stored by this console can be analysed.");
      }
      const res = await fetch(value);
      if (!res.ok) throw new Error("That image could not be read back from storage.");
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_IMAGE_BYTES) throw new Error("That image is larger than 6 MB.");
      return { data: buffer.toString("base64"), mimeType: res.headers.get("content-type") ?? "image/jpeg" };
    }
    const path = value;
    if (!path.startsWith("/uploads/") && !path.startsWith("/api/files/")) {
      throw new Error("Only images stored by this console can be analysed.");
    }
    const base = process.env.SELF_ORIGIN ?? "http://127.0.0.1:3000";
    const local = await fetch(`${base}${path}`);
    if (!local.ok) throw new Error("That image could not be read back from storage.");
    const bytes = Buffer.from(await local.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("That image is larger than 6 MB.");
    return { data: bytes.toString("base64"), mimeType: local.headers.get("content-type") ?? "image/jpeg" };
  }

  const bytes = Buffer.from(value, "base64");
  if (!bytes.length) throw new Error("That image could not be decoded.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("That image is larger than 6 MB.");
  return { data: value, mimeType: "image/jpeg" };
}

export async function runAssist(request: AssistRequest): Promise<Record<string, unknown>> {
  if (!isAiConfigured()) throw new Error("AI assistance is not configured on this server.");

  switch (request.task) {
    case "draft":
      if (!request.label) throw new Error("A field label is required.");
      return draftField({
        label: request.label,
        resource: request.resource,
        context: request.context,
        existing: request.existing,
        language: request.language,
        instruction: request.instruction,
        length: request.length
      });
    case "translate":
      return translateField(String(request.text ?? ""), request.to === "en" ? "en" : "bn");
    case "animal_photo":
      return readAnimalPhoto(await resolveImage(String(request.image ?? "")), request.context) as unknown as Record<string, unknown>;
    case "document_photo":
      return readDocumentPhoto(await resolveImage(String(request.image ?? ""))) as unknown as Record<string, unknown>;
    case "explain":
      return explainRecord(String(request.resource ?? "record"), request.row ?? {}, request.extra);
    default:
      throw new Error(`Unknown AI task "${String(request.task)}".`);
  }
}
