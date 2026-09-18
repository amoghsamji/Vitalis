import type {
  Appointment,
  Condition,
  Doctor,
  DoctorNotification,
  FollowUpCall,
  FollowUpCallEvent,
  Medication,
  Patient,
  Prescription,
  Slot,
  Workflow,
  WorkflowRun,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL as string;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return {} as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { message?: string }).message || res.statusText);
  }
  return data as T;
}

export const api = {
  // Doctors
  listDoctors: (params?: { specialty?: string; language?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ doctors: Doctor[] }>(`/doctors${qs ? `?${qs}` : ""}`);
  },
  getDoctor: (id: string) => request<Doctor>(`/doctors/${id}`),
  updateDoctor: (id: string, body: Partial<Doctor>, token: string) =>
    request<Doctor>(`/doctors/${id}`, { method: "PUT", body, token }),

  // Availability
  listAvailability: (doctorId: string) => request<{ slots: Slot[] }>(`/doctors/${doctorId}/availability`),
  addAvailability: (
    doctorId: string,
    body: { startTime: string; endTime: string; consultationType?: string },
    token: string
  ) => request<Slot>(`/doctors/${doctorId}/availability`, { method: "POST", body, token }),
  // NOTE: the backend keys slots by startTime, not the generated slot `id` —
  // pass the slot's startTime here, not slot.id.
  removeAvailability: (doctorId: string, startTime: string, token: string) =>
    request<void>(`/doctors/${doctorId}/availability/${encodeURIComponent(startTime)}`, {
      method: "DELETE",
      token,
    }),

  // Patients
  getPatient: (id: string, token: string) => request<Patient>(`/patients/${id}`, { token }),
  updatePatient: (id: string, body: Partial<Patient>, token: string) =>
    request<Patient>(`/patients/${id}`, { method: "PUT", body, token }),
  listConditions: (id: string, token: string) =>
    request<{ conditions: Condition[] }>(`/patients/${id}/conditions`, { token }),
  addCondition: (id: string, body: Partial<Condition>, token: string) =>
    request<Condition>(`/patients/${id}/conditions`, { method: "POST", body, token }),
  listMedications: (id: string, token: string) =>
    request<{ medications: Medication[] }>(`/patients/${id}/medications`, { token }),
  addMedication: (id: string, body: Partial<Medication>, token: string) =>
    request<Medication>(`/patients/${id}/medications`, { method: "POST", body, token }),

  // Appointments
  bookAppointment: (
    body: { doctorId: string; patientId: string; slotStartTime: string; consultationType?: string },
    token: string
  ) => request<Appointment>(`/appointments`, { method: "POST", body, token }),
  cancelAppointment: (id: string, token: string) =>
    request<void>(`/appointments/${id}`, { method: "DELETE", token }),
  listPatientAppointments: (patientId: string, token: string) =>
    request<{ appointments: Appointment[] }>(`/patients/${patientId}/appointments`, { token }),
  listDoctorAppointments: (doctorId: string, token: string) =>
    request<{ appointments: Appointment[] }>(`/doctors/${doctorId}/appointments`, { token }),
  markAppointmentCompleted: (id: string, token: string) =>
    request<Appointment>(`/appointments/${id}`, { method: "PUT", body: { status: "completed" }, token }),

  // Prescriptions
  presignPrescription: (appointmentId: string, token: string) =>
    request<{ uploadUrl: string; key: string }>(`/prescriptions/presign`, {
      method: "POST",
      body: { appointmentId },
      token,
    }),
  confirmPrescription: (
    body: { appointmentId: string; key: string; followUpSummary?: string },
    token: string
  ) => request<Prescription>(`/prescriptions/confirm`, { method: "POST", body, token }),
  listPrescriptions: (params: { appointmentId: string }, token: string) =>
    request<{ prescriptions: Prescription[] }>(`/prescriptions?appointmentId=${encodeURIComponent(params.appointmentId)}`, {
      token,
    }),

  // Uploads
  getUploadUrl: (fileName: string, contentType: string, token: string) =>
    request<{ uploadUrl: string; key: string }>(`/uploads/lab-pdf`, {
      method: "POST",
      body: { fileName, contentType },
      token,
    }),
  uploadFile: async (uploadUrl: string, file: File) => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/pdf" },
      body: file,
    });
    if (!res.ok) throw new ApiError(res.status, "Upload failed");
  },

  // Automated follow-up calls (Amazon Connect + Lex V2 — see lib/vitalis-stack.ts
  // "AUTOMATED FOLLOW-UP CALLS" section and README.md).
  startFollowUpCall: (appointmentId: string, token: string) =>
    request<{ followUpCallId?: string; message?: string; alreadyRequested?: boolean }>(
      `/appointments/${appointmentId}/follow-up-call`,
      { method: "POST", token }
    ),
  getFollowUpCall: (appointmentId: string, token: string) =>
    request<{ call: FollowUpCall | null; events: FollowUpCallEvent[] }>(
      `/follow-up-calls?appointmentId=${encodeURIComponent(appointmentId)}`,
      { token }
    ),
  listDoctorNotifications: (doctorId: string, token: string) =>
    request<{ notifications: DoctorNotification[] }>(`/doctors/${doctorId}/notifications`, { token }),

  // Workflows
  listWorkflows: (token: string) => request<{ workflows: Workflow[] }>(`/workflows`, { token }),
  createWorkflow: (body: Partial<Workflow>, token: string) =>
    request<Workflow>(`/workflows`, { method: "POST", body, token }),
  getWorkflow: (id: string, token: string) => request<Workflow>(`/workflows/${id}`, { token }),
  updateWorkflow: (id: string, body: Partial<Workflow>, token: string) =>
    request<Workflow>(`/workflows/${id}`, { method: "PUT", body, token }),
  deleteWorkflow: (id: string, token: string) => request<void>(`/workflows/${id}`, { method: "DELETE", token }),
  listWorkflowRuns: (id: string, token: string) =>
    request<{ runs: WorkflowRun[] }>(`/workflows/${id}/runs`, { token }),
};
