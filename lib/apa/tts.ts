import { genai, retrying } from "@/lib/apa/client";
import { pcm16ToWav, sampleRateFrom, speakable } from "@/lib/apa/pure";

/**
 * The answer, read aloud.
 *
 * This is the control a farmer who cannot read uses most, so it is not a
 * convenience feature — for a meaningful share of the user base it is the only
 * way the answer arrives. Everything about it is built for that: it never fails
 * silently, the audio is returned with the answer rather than fetched on tap,
 * and an answer too long to speak returns `null` rather than a truncated one
 * that stops mid-sentence.
 *
 * Gemini returns `audio/l16; rate=24000` — raw little-endian PCM16 with no
 * container. The phone cannot play that, so a 44-byte WAV header is prepended
 * here. Doing it server-side means the app has one fewer thing to get wrong,
 * and the header is the same eleven fields whichever end writes it.
 */

export type Speech = {
  /** base64 WAV, ready for the phone to write to a file and play. */
  audio: string;
  mimeType: "audio/wav";
  sampleRate: number;
  chars: number;
  model: string;
};

export async function speak(input: {
  text: string;
  model: string;
  voice: string;
  maxChars: number;
}): Promise<Speech | null> {
  const text = speakable(input.text);
  if (!text) return null;
  // Past the cap the app shows the text and says so, rather than reading two
  // thirds of an answer and stopping at a comma.
  if (text.length > input.maxChars) return null;

  const res = await retrying(() => genai().models.generateContent({
    model: input.model,
    contents: [{ role: "user", parts: [{ text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } } }
    } as never
  }));

  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const data = part?.inlineData?.data;
  if (!data) return null;

  const sampleRate = sampleRateFrom(part?.inlineData?.mimeType);
  const wav = pcm16ToWav(Buffer.from(data, "base64"), sampleRate);
  return {
    audio: wav.toString("base64"),
    mimeType: "audio/wav",
    sampleRate,
    chars: text.length,
    model: input.model
  };
}

// Re-exported so callers that only need the codec do not reach past this file.
export { pcm16ToWav, speakable } from "@/lib/apa/pure";
