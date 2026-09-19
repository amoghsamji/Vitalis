#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { VitalisStack } from "../lib/vitalis-stack";
import { VitalisFrontendStack } from "../lib/frontend-stack";

const app = new cdk.App();

// Region is pinned to the project, not to whoever's shell is running the
// deploy: the CDK CLI always sets CDK_DEFAULT_REGION from the caller's AWS
// CLI default, so reading it here silently sends the stacks to whatever
// region that happens to be. Override deliberately with CDK_DEPLOY_REGION.
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEPLOY_REGION || "us-east-1",
};

new VitalisStack(app, "VitalisStack", {
  env,
  description: "Vitalis - AWS-native healthcare workflow automation platform",
});

// Deploy after building frontend/ with NEXT_PUBLIC_* env vars pointed at
// VitalisStack's outputs (ApiUrl, UserPoolId, UserPoolClientId) — see
// frontend/README.md.
new VitalisFrontendStack(app, "VitalisFrontendStack", {
  env,
  description: "Vitalis - static Next.js frontend on S3 + CloudFront",
});
