import { apaRest } from "@/lib/apa/client";
import { apaPrompt } from "@/lib/apa/config";
import { TOOL_DECLARATIONS } from "@/lib/apa/tools";
import { biasTerms } from "@/lib/apa/vocabulary";
import { assertConstrained } from "@/lib/apa/pure";

/**
 * The ephemeral token a phone uses to open a live conversation.
 *
 * This is the one piece of the rebuild where the security property is not
 * obvious and had to be proved rather than assumed, so the findings are written
 * here next to the code that depends on them:
 *
 *   - The token is minted at `v1alpha/auth_tokens` and the setup field is
 *     `bidi_generate_content_setup` (camelCase is accepted too). A token minted
 *     *without* it is an unrestricted key with a short life — which is the
 *     thing this whole exercise exists to avoid — so `assertConstrained()`
 *     below refuses to send such a request at all.
 *   - The phone must connect to the **`BidiGenerateContentConstrained`**
 *     method, not `BidiGenerateContent`. The plain method rejects an ephemeral
 *     token with close code 1008, "unregistered callers".
 *   - The constraint genuinely binds: a client that sends its own
 *     `system_instruction` and asks to enable code execution is ignored, and an
 *     off-topic question still comes back refused. Tested against the live API,
 *     not inferred (AC-APA-11, AC-APA-12).
 *   - `gemini-3.8-live` is audio-out only. Asking for a TEXT modality closes
 *     the socket, so the transcript strip on screen comes from
 *     `outputAudioTranscription`, never from text parts.
 */

const WS_BASE = "wss://generativelanguage.googleapis.com/ws";
const WS_METHOD = "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export type LiveToken = {
  /** `auth_tokens/…` — the value the phone passes as `access_token`. */
  name: string;
  /** Full socket URL, assembled here so the app cannot assemble it wrongly. */
  url: string;
  model: string;
  expires_at: string;
  session_expires_at: string;
};

type MintResponse = { name?: string; expireTime?: string; newSessionExpireTime?: string };

export async function mintLiveToken(input: {
  model: string;
  voice: string;
  /** Minutes the session may run, used to size the token's life. */
  sessionMinutes: number;
  districtName?: string | null;
  upazilaName?: string | null;
}): Promise<{ token: LiveToken; setupEcho: Record<string, unknown> }> {
  const [persona, scope, live, terms] = await Promise.all([
    apaPrompt("persona"),
    apaPrompt("scope"),
    apaPrompt("live"),
    biasTerms()
  ]);

  const systemText = [
    persona,
    "",
    scope,
    "",
    live,
    "",
    `WHERE THIS FARMER IS: District ${input.districtName ?? "unknown"}, Upazila ${input.upazilaName ?? "unknown"}.`
  ].join("\n");

  // Two minutes of headroom past the session cap: a token that expires while
  // she is mid-sentence is indistinguishable, from her side, from the app
  // breaking.
  const expire = new Date(Date.now() + (input.sessionMinutes + 2) * 60_000);
  // The window in which the socket may be *opened*, deliberately short — the
  // phone mints and connects immediately.
  const sessionExpire = new Date(Date.now() + 2 * 60_000);

  const setup: Record<string, unknown> = {
    model: `models/${input.model}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } } }
    },
    systemInstruction: { parts: [{ text: systemText }] },
    // The live model gets the same read-only tool list as the ask path, minus
    // navigate_to — there is no screen to tap while she is talking.
    tools: [
      {
        functionDeclarations: TOOL_DECLARATIONS.filter((t) => t.name !== "navigate_to")
      }
    ],
    inputAudioTranscription: {
      languageCodes: ["bn-BD"],
      customVocabulary: terms.slice(0, 200)
    },
    outputAudioTranscription: {}
  };

  const body: Record<string, unknown> = {
    uses: 1,
    expireTime: expire.toISOString(),
    newSessionExpireTime: sessionExpire.toISOString(),
    bidiGenerateContentSetup: setup
  };

  assertConstrained(body);

  const res = await apaRest<MintResponse>("v1alpha/auth_tokens", body, { timeoutMs: 15_000 });
  if (!res.name) throw new Error("Gemini returned no token name.");

  return {
    token: {
      name: res.name,
      url: `${WS_BASE}/${WS_METHOD}?access_token=${encodeURIComponent(res.name)}`,
      model: input.model,
      expires_at: res.expireTime ?? expire.toISOString(),
      session_expires_at: res.newSessionExpireTime ?? sessionExpire.toISOString()
    },
    setupEcho: setup
  };
}

// Re-exported because the release check imports it from here.
export { assertConstrained } from "@/lib/apa/pure";
