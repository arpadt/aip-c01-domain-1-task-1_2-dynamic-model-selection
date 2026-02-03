import * as fs from 'fs';
import * as path from 'path';

import * as cdk from 'aws-cdk-lib/core';
import * as appconfig from 'aws-cdk-lib/aws-appconfig';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class DynamicModelSelectionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const { account, region } = props?.env ?? {};

    if (!account && !region) {
      throw new Error('Basic stack configurations missing');
    }

    const appConfigApplication = new appconfig.CfnApplication(
      this,
      'AIAssistantApp',
      {
        name: 'AIAssistantApp',
      },
    );
    const appConfigEnvironment = new appconfig.CfnEnvironment(
      this,
      'ProductionEnv',
      {
        applicationId: appConfigApplication.ref,
        name: 'Production',
      },
    );
    const configProfile = new appconfig.CfnConfigurationProfile(
      this,
      'ModelSelectionProfile',
      {
        applicationId: appConfigApplication.ref,
        name: 'ModelSelectionStrategy',
        locationUri: 'hosted',
      },
    );
    const configContent = fs.readFileSync(
      path.join(__dirname, '../config/model_selection_strategy.json'),
      'utf-8',
    );
    const hostedConfigVersion = new appconfig.CfnHostedConfigurationVersion(
      this,
      'ModelSelectionConfig',
      {
        applicationId: appConfigApplication.ref,
        configurationProfileId: configProfile.ref,
        content: configContent,
        contentType: 'application/json',
      },
    );
    const deploymentStrategy = new appconfig.CfnDeploymentStrategy(
      this,
      'ImmediateDeployment',
      {
        name: 'ImmediateDeployment',
        deploymentDurationInMinutes: 0,
        growthFactor: 100,
        replicateTo: 'NONE',
      },
    );

    new appconfig.CfnDeployment(this, 'ModelSelectionDeployment', {
      applicationId: appConfigApplication.ref,
      environmentId: appConfigEnvironment.ref,
      configurationProfileId: configProfile.ref,
      configurationVersion: hostedConfigVersion.ref,
      deploymentStrategyId: deploymentStrategy.ref,
    });

    const modelAbstractionFn = new lambda.Function(
      this,
      'ModelAbstractionFunction',
      {
        runtime: lambda.Runtime.PYTHON_3_14,
        handler: 'model_abstraction.lambda_handler',
        code: lambda.Code.fromAsset(
          path.join(__dirname, '../src/lambda-functions'),
        ),
        timeout: cdk.Duration.seconds(30),
        logRetention: logs.RetentionDays.FIVE_DAYS,
      },
    );

    modelAbstractionFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['appconfig:GetConfiguration'],
        resources: [
          `arn:aws:appconfig:${region}:${account}:application/${appConfigApplication.attrApplicationId}`,
          `arn:aws:appconfig:${region}:${account}:application/${appConfigApplication.attrApplicationId}/environment/${appConfigEnvironment.attrEnvironmentId}`,
          `arn:aws:appconfig:${region}:${account}:application/${appConfigApplication.attrApplicationId}/configurationprofile/${configProfile.attrConfigurationProfileId}`,
        ],
      }),
    );

    modelAbstractionFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:*:${account}:inference-profile/*`,
        ],
      }),
    );
    modelAbstractionFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:GetInferenceProfile'],
        resources: [`arn:aws:bedrock:*:${account}:inference-profile/*`],
      }),
    );

    const api = new apigateway.RestApi(this, 'AIAssistantAPI', {
      restApiName: 'AIAssistantAPI',
      deployOptions: {
        stageName: 'prod',
      },
    });

    const generateResource = api.root.addResource('generate');
    generateResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(modelAbstractionFn),
    );
  }
}
