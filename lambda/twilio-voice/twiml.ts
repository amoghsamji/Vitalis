import twilio from "twilio";

const { VoiceResponse } = twilio.twiml;

/** Mirrors jsonResponse in _shared/ddb.ts, but for the XML Twilio expects. */
export function xmlResponse(twiml: string) {
  // TEMPORARY debug log while diagnosing a live "invalid url" spoken error —
  // remove once resolved.
  console.log("TwiML response:", twiml);
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/xml" },
    body: twiml,
  };
}

/**
 * `<Gather input="speech">` prompting `message`, with a graceful fallback
 * (repeat once, then hang up) if Twilio never gets a SpeechResult at all —
 * distinct from the app's own "didn't understand the words" repeat/give-up
 * path in script.ts, which only runs once speech WAS captured.
 */
export function gatherSpeech(message: string, actionUrl: string): string {
  const response = new VoiceResponse();
  const gather = response.gather({ input: ["speech"], action: actionUrl, method: "POST", speechTimeout: "auto" });
  gather.say(message);
  response.say("We didn't catch a response. Goodbye.");
  response.hangup();
  return response.toString();
}

/** `<Say>` then hang up — used for every terminal turn (script.ts endCall: true). */
export function sayAndHangup(message: string): string {
  const response = new VoiceResponse();
  response.say(message);
  response.hangup();
  return response.toString();
}
