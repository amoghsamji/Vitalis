import {
  ChimeSDKVoiceClient,
  CreateSipMediaApplicationCommand,
  UpdateSipMediaApplicationCommand,
  DeleteSipMediaApplicationCommand,
} from "@aws-sdk/client-chime-sdk-voice";

const chimeVoice = new ChimeSDKVoiceClient({});

/**
 * CloudFormation custom-resource handler (behind a custom_resources.Provider
 * in lib/vitalis-stack.ts) that manages one Chime SDK Voice SIP media
 * application. Needed because, unlike Connect, Chime SDK Voice PSTN Audio
 * has no native CloudFormation resource type in this aws-cdk-lib version —
 * confirmed against the installed package (no AWS::ChimeSDKVoice::* type
 * exists anywhere in it). AwsCustomResource's generic "call any SDK action
 * by name" mechanism could reach the same API, but trusting its parameter
 * resolution for a newer service sight-unseen risks a broken deploy that's
 * hard to debug from the CloudFormation event log alone — a small
 * purpose-built, type-checked handler is more predictable here.
 */
export const handler = async (event: any) => {
  const props = event.ResourceProperties ?? {};

  if (event.RequestType === "Create") {
    const result = await chimeVoice.send(
      new CreateSipMediaApplicationCommand({
        AwsRegion: props.Region,
        Name: props.Name,
        Endpoints: [{ LambdaArn: props.LambdaArn }],
      })
    );
    const app = result.SipMediaApplication;
    return {
      PhysicalResourceId: app?.SipMediaApplicationId,
      Data: {
        SipMediaApplicationId: app?.SipMediaApplicationId,
        SipMediaApplicationArn: app?.SipMediaApplicationArn,
      },
    };
  }

  if (event.RequestType === "Update") {
    const id = event.PhysicalResourceId;
    const result = await chimeVoice.send(
      new UpdateSipMediaApplicationCommand({
        SipMediaApplicationId: id,
        Name: props.Name,
        Endpoints: [{ LambdaArn: props.LambdaArn }],
      })
    );
    const app = result.SipMediaApplication;
    return {
      PhysicalResourceId: id,
      Data: {
        SipMediaApplicationId: id,
        SipMediaApplicationArn: app?.SipMediaApplicationArn,
      },
    };
  }

  if (event.RequestType === "Delete") {
    try {
      await chimeVoice.send(
        new DeleteSipMediaApplicationCommand({ SipMediaApplicationId: event.PhysicalResourceId })
      );
    } catch (err) {
      // Deletes must be idempotent (a retried rollback, or a resource that
      // never fully finished creating) or the stack gets stuck DELETE_FAILED.
      if ((err as any)?.name !== "NotFoundException") throw err;
    }
    return { PhysicalResourceId: event.PhysicalResourceId };
  }

  throw new Error(`Unsupported RequestType: ${event.RequestType}`);
};
