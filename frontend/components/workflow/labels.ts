import type { ActionType, ConditionCheck, OutputType, TriggerType } from "@/lib/types";

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  lab_result_received: "Lab result received",
  appointment_booked: "Appointment booked",
};

export const CONDITION_LABELS: Record<ConditionCheck, string> = {
  value_greater_than: "Field value >",
  patient_age_gt: "Patient age >",
  always_true: "Always",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  send_sms: "Send SMS",
  call_patient: "Call patient",
  schedule_appointment: "Schedule appointment",
  create_lab_order: "Create lab order",
  create_referral: "Create referral",
  update_patient_record: "Update patient record",
  assign_staff: "Assign staff",
};

// Only send_sms is actually implemented — lambda/workflow-engine/index.ts's
// executeAction logs everything else. Keep the UI honest about that.
export const FUNCTIONAL_ACTIONS: ActionType[] = ["send_sms"];

export const OUTPUT_LABELS: Record<OutputType, string> = {
  log_completion: "Log completion",
  generate_transcript: "Generate transcript",
  create_report: "Create report",
  send_summary_to_doctor: "Send summary to doctor",
};
