import * as fs from 'fs';
import * as path from 'path';

import * as cdk from 'aws-cdk-lib/core';
import * as appconfig from 'aws-cdk-lib/aws-appconfig';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
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

    const modelAbstractionFn = new lambdaNodejs.NodejsFunction(
      this,
      'ModelAbstractionFunction',
      {
        entry: './src/lambda-functions/model_abstraction.ts',
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_24_X,
        timeout: cdk.Duration.minutes(2),
        logRetention: logs.RetentionDays.FIVE_DAYS,
        memorySize: 256,
        layers: [
          lambda.LayerVersion.fromLayerVersionArn(
            this,
            'AppConfigLayer',
            // modify the URL to match your region
            'arn:aws:lambda:eu-central-1:066940009817:layer:AWS-AppConfig-Extension:261',
          ),
        ],
        environment: {
          NODE_OPTIONS: '--enable-source-maps',
          APP_CONFIG_APPLICATION_NAME: appConfigApplication.name,
          APP_CONFIG_ENVIRONMENT: appConfigEnvironment.name,
          APP_CONFIG_CONFIGURATION: configProfile.name,
        },
        bundling: {
          target: 'es2020',
          logLevel: lambdaNodejs.LogLevel.INFO,
          minify: true,
          sourceMap: true,
        },
      },
    );

    modelAbstractionFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'appconfig:GetLatestConfiguration',
          'appconfig:StartConfigurationSession',
        ],
        resources: [
          `arn:aws:appconfig:${region}:${account}:application/${appConfigApplication.attrApplicationId}/environment/${appConfigEnvironment.attrEnvironmentId}/configuration/${configProfile.attrConfigurationProfileId}`,
        ],
      }),
    );

    modelAbstractionFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModelWithResponseStream'],
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
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      restApiName: 'AIAssistantAPI',
      deployOptions: {
        stageName: 'prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
        statusCode: 200,
      },
    });

    const generateResource = api.root.addResource('generate');
    generateResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(modelAbstractionFn, {
        proxy: true,
        responseTransferMode: apigateway.ResponseTransferMode.STREAM,
        timeout: cdk.Duration.minutes(2),
      }),
      {
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          },
        ],
      },
    );
  }
}
