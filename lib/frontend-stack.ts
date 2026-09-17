import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { RemovalPolicy } from "aws-cdk-lib";
import * as path from "path";

/**
 * VITALIS FRONTEND — static Next.js export on S3 + CloudFront.
 *
 * Deliberately not SSR/Amplify Hosting: matches the backend stack's "nothing
 * bills while idle" design — a static export behind CloudFront has no
 * compute cost at rest, same as the pay-per-use Lambda/DynamoDB/API Gateway
 * backend in VitalisStack.
 *
 * Build order matters: `frontend/out` must exist (run `npm run build` inside
 * `frontend/`, with NEXT_PUBLIC_* env vars pointed at the deployed
 * VitalisStack's outputs) before `cdk deploy` runs this stack, since
 * BucketDeployment uploads that directory as a CDK asset.
 */
export class VitalisFrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, "VitalisSiteBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    const distribution = new cloudfront.Distribution(this, "VitalisDistribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // Next static export emits a real 404.html; route API-Gateway-shaped
      // deep links that CloudFront can't find on to it instead of S3's XML error.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: "/404.html" },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: "/404.html" },
      ],
    });

    new s3deploy.BucketDeployment(this, "VitalisSiteDeployment", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "..", "frontend", "out"))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    new cdk.CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
  }
}
