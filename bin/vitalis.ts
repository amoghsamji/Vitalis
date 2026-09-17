#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { VitalisStack } from "../lib/vitalis-stack";
import { VitalisFrontendStack } from "../lib/frontend-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || "us-east-1",
};

new VitalisStack(app, "VitalisStack", {
  // Fill in your account/region, or rely on the AWS_PROFILE / AWS_REGION env vars.
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
