import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../_shared/ddb";

const cognito = new CognitoIdentityProviderClient({});

const ROLE_TO_GROUP: Record<string, string> = {
  doctor: "Doctors",
  patient: "Patients",
};

/**
 * Cognito Post-Confirmation trigger. Self-signup doesn't put a user in the
 * Doctors/Patients group on its own — this reads the `custom:role` attribute
 * the user picked at signup and adds them to the matching group, so the
 * `cognito:groups` checks already used in lambda/patients/index.ts (and any
 * future doctor-only routes) work for self-signed-up users too.
 *
 * It also auto-creates a minimal doctor PROFILE item. Without this, a doctor
 * who signs up and adds availability slots but never visits their own Profile
 * page and clicks Save has no PROFILE item at all — GET /doctors (the public
 * directory) only lists doctors with one, so they'd be invisible to patients
 * with no indication why. This just means "the doctor shows up"; they can
 * still fill in specialty/bio/etc. later via the normal profile edit flow.
 */
export const handler = async (event: any) => {
  const attrs = event.request?.userAttributes ?? {};
  // Google Hosted UI users do not submit our custom role attribute; treat them
  // as patients so their first sign-in has the same usable permissions as a
  // self-registered patient.
  const role = attrs["custom:role"] || "patient";
  const groupName = role && ROLE_TO_GROUP[role];

  if (groupName) {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        GroupName: groupName,
      })
    );
  }

  if (role === "doctor") {
    const name = [attrs.given_name, attrs.family_name].filter(Boolean).join(" ") || attrs.email || "New doctor";
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `DOCTOR#${attrs.sub}`,
          SK: "PROFILE",
          id: attrs.sub,
          name,
          specialty: "",
          languages: [],
          consultationTypes: [],
          bio: "",
          availabilityStatus: "unavailable",
          averageRating: null,
          updatedAt: new Date().toISOString(),
        },
        // Never overwrite a profile the doctor already saved themselves —
        // this trigger only fires once at confirmation, but guard anyway
        // since re-running it (e.g. a retried invocation) shouldn't clobber
        // real data with blanks.
        ConditionExpression: "attribute_not_exists(PK)",
      })
    ).catch(() => {
      // ConditionalCheckFailedException just means a profile already exists —
      // fine, nothing to do.
    });
  }

  return event;
};
