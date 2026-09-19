export type Role = "doctor" | "patient";

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  languages: string[];
  consultationTypes: ("video" | "chat")[];
  bio: string;
  availabilityStatus: "available_now" | "unavailable";
  averageRating: number | null;
  updatedAt?: string;
}

export interface Slot {
  id: string;
  doctorId: string;
  startTime: string;
  endTime: string;
  consultationType: string;
  status: "open" | "held" | "booked";
}

export interface Patient {
  id: string;
  name: string;
  dob: string;
  insurance: string | null;
  mrn: string | null;
  riskLevel: string;
  phone: string;
  email: string;
  updatedAt?: string;
  consentTimestamp?: string | null;
  consentVersion?: string | null;
  followUpCallsEnabled?: boolean;
}

export interface PrescriptionMedicationItem {
  name: string;
  dosage: string;
  frequency: string;
  duration?: string;
  instructions?: string;
}

export interface Prescription {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  type: "pdf" | "digital";
  // "pdf" fields
  key?: string;
  uploadedAt?: string;
  followUpSummary?: string | null;
  // "digital" fields
  diagnosis?: string | null;
  notes?: string | null;
  medications?: PrescriptionMedicationItem[];
  issuedAt?: string;
}

export interface TranslatedPrescription {
  targetLanguage: string;
  diagnosis?: string | null;
  notes?: string | null;
  followUpSummary?: string | null;
  medications?: PrescriptionMedicationItem[] | null;
}

export interface Condition {
  id: string;
  icd10Code: string;
  description: string;
  hccCategory: string | null;
  rafScore: number | null;
  diagnosedAt: string;
}

export interface Medication {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  prescriber: string;
  status: string;
}

export interface Appointment {
  id: string;
  doctorId: string;
  patientId: string;
  startTime: string;
  consultationType: string;
  status: "pending" | "confirmed" | "rejected" | "cancelled" | "completed" | string;
  createdAt: string;
}

// Only these two trigger types are actually emitted anywhere in the backend today
// (lambda/pdf-intake and lambda/appointments) — the workflow engine's doc comment
// mentions more, but nothing else fires them yet.
export type TriggerType = "lab_result_received" | "appointment_booked";

export type ConditionCheck = "value_greater_than" | "patient_age_gt" | "always_true";

// send_sms is the only action lambda/workflow-engine/index.ts actually performs;
// the rest are logged-only stubs (see executeAction's switch).
export type ActionType =
  | "send_sms"
  | "call_patient"
  | "schedule_appointment"
  | "create_lab_order"
  | "create_referral"
  | "update_patient_record"
  | "assign_staff";

export type OutputType = "log_completion" | "generate_transcript" | "create_report" | "send_summary_to_doctor";

interface WorkflowNodeBase {
  id: string;
  // Canvas position — not read by the backend engine at all (it only walks
  // next/onTrue/onFalse), but round-tripped through the graph JSON so the builder
  // doesn't lose layout between saves.
  position: { x: number; y: number };
}

export interface WorkflowConditionNode extends WorkflowNodeBase {
  kind: "condition";
  check: ConditionCheck;
  params: Record<string, string | number>;
  onTrue: string | null;
  onFalse: string | null;
}

export interface WorkflowActionNode extends WorkflowNodeBase {
  kind: "action";
  action: ActionType;
  params: Record<string, string | number>;
  next: string | null;
}

export interface WorkflowOutputNode extends WorkflowNodeBase {
  kind: "output";
  output: OutputType;
  params: Record<string, string | number>;
  next: string | null;
}

export type WorkflowNode = WorkflowConditionNode | WorkflowActionNode | WorkflowOutputNode;

export interface WorkflowGraph {
  startNodeId: string | null;
  nodes: WorkflowNode[];
}

export interface Workflow {
  id: string;
  doctorId: string;
  name: string;
  triggerType: TriggerType;
  enabled: boolean;
  graph: WorkflowGraph;
  createdAt?: string;
  updatedAt?: string;
}

// Mirrors lambda/_shared/callAudit.ts's CallEventName + FOLLOWUP_CALL# item shape.
// Backend actually sets "ended" (not "completed") on real completion — both
// are kept here since "completed" was the original documented vocabulary.
export type FollowUpCallStatus =
  | "requested"
  | "initiated"
  | "in_progress"
  | "completed"
  | "ended"
  | "failed"
  | "opted_out";

export type CallProvider = "connect" | "chime" | "twilio";

export interface FollowUpCall {
  id: string;
  appointmentId: string;
  doctorId?: string;
  patientId?: string;
  status: FollowUpCallStatus | string;
  provider?: CallProvider | string;
  outcome?: string | null;
  appointmentBooked?: boolean;
  bookedAppointmentId?: string | null;
  duration?: number;
  answeredAt?: string;
  endedAt?: string;
  createdAt: string;
}

export interface FollowUpCallEvent {
  followUpCallId: string;
  event: string;
  detail: Record<string, unknown>;
  timestamp: string;
}

export interface DoctorNotification {
  id: string;
  type: "persistent_symptoms" | "follow_up_requested" | "emergency_symptoms" | "patient_unreachable" | string;
  doctorId: string;
  appointmentId: string;
  patientId: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  eventDetail: Record<string, unknown>;
  auditLog: Array<{ nodeId: string; kind: string; outcome: string; timestamp: string }>;
  completedAt: string;
}
