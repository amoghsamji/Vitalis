import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GeminiIntent } from "./script";

/**
 * The entire "AI conversation provider" swap point for the Twilio call
 * script — replacing Gemini later means writing one new module with these
 * same two function signatures. Deliberately two plain functions rather than
 * a class/interface hierarchy: every other Lambda in this codebase is
 * function-based, and a provider abstraction with a single implementation
 * would be speculative structure with nothing to justify it yet.
 *
 * Gemini NEVER touches the database or decides bookings directly — both
 * functions return a narrow, validated shape that lambda/twilio-voice/index.ts
 * treats as untrusted input: classifyConditionResponse's `intent` is checked
 * against the allow-list below (anything else collapses to "UNKNOWN"), and
 * resolveSlotChoice's `selectedIndex` is only ever used to index into the
 * real slot array already fetched from lambda/get-next-slots — Gemini can't
 * invent a slot id.
 */

const ALLOWED_INTENTS: GeminiIntent[] = [
  "FINE",
  "IMPROVING",
  "PERSISTING",
  "WORSENING",
  "REQUEST_APPOINTMENT",
  "DECLINE_APPOINTMENT",
  "CANNOT_TALK_NOW",
  "UNKNOWN",
];

const SYSTEM_PROMPT = `You are an automated healthcare follow-up assistant calling on behalf of a patient's doctor.

You must clearly behave as an automated assistant, never claim to be the doctor, and NEVER diagnose, prescribe medication, change medication dosage, or give medical treatment recommendations.

Your only job on this turn is to classify what the patient just said into exactly one of these intents:
- FINE: patient says they are okay / fine / recovered
- IMPROVING: patient says they are feeling better but not fully recovered
- PERSISTING: patient says the problem is still there / not better
- WORSENING: patient says it's getting worse
- REQUEST_APPOINTMENT: patient explicitly agrees to schedule/book a follow-up appointment
- DECLINE_APPOINTMENT: patient explicitly declines to schedule/book a follow-up appointment
- CANNOT_TALK_NOW: patient says they can't talk right now / wrong time
- UNKNOWN: anything unclear, off-topic, silence, or that doesn't fit the above

Respond with ONLY a JSON object: {"intent": "<one of the above>", "confidence": <0 to 1>, "response": "<a short, warm, one-sentence acknowledgement of what they said, no medical advice>"}`;

let client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
  return client;
}

function getModel() {
  return getClient().getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: "application/json" },
  });
}

export interface ConditionClassification {
  intent: GeminiIntent;
  confidence: number;
  response: string;
}

export async function classifyConditionResponse(
  patientTranscript: string,
  doctorName: string
): Promise<ConditionClassification> {
  try {
    const result = await getModel().generateContent(
      `The patient was asked how they're feeling since seeing Dr. ${doctorName}. They said: "${patientTranscript}"`
    );
    const parsed = safeParseJson(result.response.text());

    const intent = ALLOWED_INTENTS.includes(parsed?.intent) ? (parsed.intent as GeminiIntent) : "UNKNOWN";
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0;
    const response = typeof parsed?.response === "string" ? parsed.response : "";

    return { intent, confidence, response };
  } catch (err) {
    // Never let an API-key/quota/network failure on the AI layer crash the
    // call outright — degrade to the same "didn't understand" path a low-
    // confidence classification would take (script.ts's repeat/give-up flow).
    console.error("classifyConditionResponse failed", err);
    return { intent: "UNKNOWN", confidence: 0, response: "" };
  }
}

export interface SlotChoiceResolution {
  selectedIndex: number;
  confidence: number;
}

export async function resolveSlotChoice(
  patientTranscript: string,
  offeredSlots: { startTime: string }[]
): Promise<SlotChoiceResolution> {
  try {
    const optionsList = offeredSlots
      .map((s, i) => `${i}: ${new Date(s.startTime).toLocaleString()}`)
      .join("\n");

    const model = getClient().getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction:
        "You match a patient's spoken response to one option in a numbered list of appointment times. " +
        'Respond with ONLY JSON: {"selectedIndex": <the matching option\'s number, or -1 if none clearly match>, "confidence": <0 to 1>}. ' +
        "Never invent an index that isn't in the list.",
      generationConfig: { responseMimeType: "application/json" },
    });

    const result = await model.generateContent(
      `Options:\n${optionsList}\n\nPatient said: "${patientTranscript}"`
    );
    const parsed = safeParseJson(result.response.text());

    const rawIndex = typeof parsed?.selectedIndex === "number" ? parsed.selectedIndex : -1;
    const selectedIndex = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < offeredSlots.length ? rawIndex : -1;
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0;

    return { selectedIndex, confidence };
  } catch (err) {
    console.error("resolveSlotChoice failed", err);
    return { selectedIndex: -1, confidence: 0 };
  }
}

function safeParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
