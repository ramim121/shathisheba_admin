import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { genai } from "@/lib/apa/client";
import { pcm16ToWav, sampleRateFrom, speakable } from "@/lib/apa/pure";
import { runWithChain, usageOf } from "@/lib/apa/models";
import { readSpeechCache, speechKey, writeSpeechCache } from "@/lib/apa/cache";
import { s3Enabled, uploadToS3 } from "@/lib/s3";

/**
 * The answer, read aloud — by the server, when the phone cannot do it itself.
 *
 * This used to be the default path and it was the single largest cost in the
 * system. Measured: **$0.0220** to speak a 400-character answer against
 * **$0.0016** to generate it — fourteen times the cost of the intelligence,
 * and 32.1 billed tokens for every second of audio.
 *
 * So read-aloud moved to the phone. Android's own text-to-speech engine does it
 * for nothing, offline, instantly, and without sending 300 KB of WAV down a 2G
 * connection. The voice is more mechanical than Gemini's; for a farmer who
 * cannot read, having the answer spoken at all is the feature, and having it
 * spoken for free is what lets her ask a hundred questions instead of five.
 *
 * What remains here is the fallback for a handset with no Bangla voice
 * installed — which will be the oldest phones, so it is cached by content and
 * served as a URL rather than inlined as base64.
 */

export type Speech = {
  /** Where the phone fetches the audio. Never base64 in the answer any more. */
  url: string;
  mimeType: string;
  sampleRate: number;
  bytes: number;
  seconds: number | null;
  chars: number;
  model: string;
  fromCache: boolean;
};

export async function speak(input: {
  text: string;
  models: string[];
  voice: string;
  rate: string;
  maxChars: number;
  origin: string;
  cacheEnabled: boolean;
}): Promise<Speech | null> {
  const text = speakable(input.text);
  if (!text) return null;
  // Past the cap the app shows the text and says so, rather than reading two
  // thirds of an answer and stopping at a comma.
  if (text.length > input.maxChars) return null;

  const primary = input.models[0] ?? "gemini-2.5-flash-preview-tts";
  const key = speechKey({ text, voice: input.voice, rate: input.rate, model: primary });

  if (input.cacheEnabled) {
    const hit = await readSpeechCache(key);
    if (hit) {
      return {
        url: hit.audio_url,
        mimeType: hit.mime_type,
        sampleRate: hit.sample_rate,
        bytes: hit.bytes,
        seconds: hit.seconds,
        chars: text.length,
        model: primary,
        fromCache: true
      };
    }
  }

  const attempt = await runWithChain({
    job: "tts",
    chain: input.models,
    call: async (model) => {
      const res = await genai().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } } }
        } as never
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part?.inlineData?.data) throw new Error("no audio returned");
      return { value: part.inlineData, usage: usageOf(res) };
    }
  });

  const sampleRate = sampleRateFrom(attempt.result.mimeType ?? undefined);
  const wav = pcm16ToWav(Buffer.from(attempt.result.data ?? "", "base64"), sampleRate);
  const seconds = Number(((wav.length - 44) / (sampleRate * 2)).toFixed(2));

  const url = await store(wav, key, input.origin);

  if (input.cacheEnabled) {
    await writeSpeechCache({
      key,
      textLen: text.length,
      voice: input.voice,
      rate: input.rate,
      model: attempt.model,
      audioUrl: url,
      mimeType: "audio/wav",
      sampleRate,
      bytes: wav.length,
      seconds
    });
  }

  return {
    url,
    mimeType: "audio/wav",
    sampleRate,
    bytes: wav.length,
    seconds,
    chars: text.length,
    model: attempt.model,
    fromCache: false
  };
}

/**
 * Put the audio where the phone can fetch it: the media bucket when S3 is
 * configured, otherwise public/uploads, which is what /api/upload already does.
 */
async function store(wav: Buffer, key: string, origin: string): Promise<string> {
  const name = `${key.slice(0, 32)}.wav`;
  if (s3Enabled()) {
    const result = await uploadToS3({
      buffer: wav,
      folder: "apa-speech",
      name,
      contentType: "audio/wav",
      origin
    });
    return result.url;
  }
  const dir = path.join(process.cwd(), "public", "uploads", "apa-speech");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), wav);
  return `${origin.replace(/\/$/, "")}/uploads/apa-speech/${name}`;
}

// Re-exported so callers that only need the codec do not reach past this file.
export { pcm16ToWav, speakable } from "@/lib/apa/pure";
