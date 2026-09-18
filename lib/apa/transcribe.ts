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
  const seconds = audioSeconds(Buffer.from(input.data, "base64").length, input.mimeType);

  const attempt = await runWithChain({
    job: "transcribe",
    chain: input.models,
    call: async (model) => {
      const value = await apaRest<RestResponse>(`v1beta/models/${model}:generateContent`, {
        contents: [
          {
            role: "user",
            parts: [{ inlineData: { mimeType: input.mimeType, data: input.data } }]
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
