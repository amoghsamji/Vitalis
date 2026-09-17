import { api } from "./api";

/** Resolves patient ids to display names, falling back to the id itself on error. */
export async function resolvePatientNames(
  patientIds: string[],
  token: string
): Promise<Record<string, string>> {
  const uniqueIds = Array.from(new Set(patientIds));
  const entries = await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const patient = await api.getPatient(id, token);
        return [id, patient.name] as const;
      } catch {
        return [id, id] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}
