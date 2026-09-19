import { apaRest } from "@/lib/apa/client";
import { biasTerms, recordHeardTerms } from "@/lib/apa/vocabulary";
import { audioSeconds } from "@/lib/apa/pure";
import { runWithChain } from "@/lib/apa/models";

/**
 * A voice message, turned into words.
 *
 * Two things make this different from calling a transcription API:
 *
 * 1. The language is pinned to bn-BD. Left to guess, the model treats rural
 *    Bangla with English loan words ("ইউরিয়া", "ভ্যাকসিন") as code-switching
 *    and hedges between two languages, which is worse than either.
 * 2. The farm vocabulary is handed over as bias. Without it "গলাফুলা" comes
 *    back as "গলা ফুলা" and the answer is about a person's sore throat.
 *
 * The result lives at `parts[].audioTranscription.text`, **not** `parts[].text`
 * — that difference cost an afternoon, so it is written down here.
 */

/**
 * What the model is being asked to do.
 *
 * Explicit about the failure mode it prevents: "transcribe, do not answer".
 * Bangla is named rather than left to `languageCodes` alone, because the
 * general models honour a prompt more reliably than they honour a config field
 * they were not built for.
 */
const TRANSCRIBE_INSTRUCTION =
  "Transcribe this Bangla audio word for word. Output only the transcription, " +
  "in Bangla script. Do not answer, explain, translate or summarise it — even " +
  "if the audio contains a question.";

export type Transcription = {
  text: string;
  seconds: number;
  model: string;
  /** False when the model returned nothing usable — the caller keeps her clip. */
  ok: boolean;
};

type RestResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; audioTranscription?: { text?: string } }>;
    };
  }>;
};

export async function transcribeAudio(input: {
  data: string;
  mimeType: string;
  /** Fallback chain; the first model that answers wins. */
  models: string[];
  language?: string;
  /** Used to pick which vocabulary terms are worth sending. */
  userId?: string | number | null;
}): Promise<Transcription> {
  const terms = await biasTerms(input.userId);
  const bytes = Buffer.from(input.data, "base64").length;
  const seconds = audioSeconds(bytes, input.mimeType);

  // Too little audio to be speech: answered here rather than by the model.
  //
  // Measured 2026-09-19: an empty or near-empty clip makes
  // gemini-3.5-transcribe return `400 Request contains an invalid argument`,
  // and a 400 is classified as fatal, so it stops the fallback chain dead — the
  // other two models never get asked. The production log filled with those
  // 400s from taps too short to be a recording.
  //
  // A fallback would not have helped, because there is genuinely nothing to
  // transcribe. What the farmer needs is the "I did not catch that, your
  // recording is kept" path, which is exactly what `ok: false` gives her, and
  // it costs no model call at all.
  //
  // 2 KB is well under a second of any codec the phone records and is
  // comfortably above an empty container's header.
  if (bytes < 2048) {
    return { text: "", seconds: Number(seconds.toFixed(2)), model: "none", ok: false };
  }

  const attempt = await runWithChain({
    job: "transcribe",
    chain: input.models,
    call: async (model) => {
      const value = await apaRest<RestResponse>(`v1beta/models/${model}:generateContent`, {
        contents: [
          {
            role: "user",
            parts: [
              // The instruction is load-bearing, and only became so when this
              // gained a fallback chain.
              //
              // MEASURED 2026-09-19: sent audio with no text part,
              // gemini-3.5-transcribe transcribes it, but the general models
              // **answer the question instead**. Asked "my rice leaves are
              // going yellow", gemini-3.1-flash-lite replied "the reasons rice
              // leaves turn yellow are..." — fluent, correct, and catastrophic
              // here, because it would land in the field holding *what she
              // said*. The pipeline would then answer the model's own answer,
              // and the console would show it as her words.
              //
              // gemini-3.5-transcribe is unaffected either way, so this costs a
              // few tokens on the primary and makes the fallbacks safe.
              { text: TRANSCRIBE_INSTRUCTION },
              { inlineData: { mimeType: input.mimeType, data: input.data } }
            ]
          }
        ],
        generationConfig: {
          audioTranscriptionConfig: {
            languageCodes: [input.language ?? "bn-BD"],
            customVocabulary: terms
          }
        }
      });
      return { value };
    }
  });

  const res = attempt.result;
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.audioTranscription?.text ?? p.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (text) void recordHeardTerms(text);

  return {
    text,
    seconds: Number(seconds.toFixed(2)),
    model: attempt.model,
    ok: text.length > 0
  };
}

export { audioSeconds } from "@/lib/apa/pure";
