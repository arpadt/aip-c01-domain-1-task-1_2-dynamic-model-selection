import * as fs from 'fs';
import * as path from 'path';

import * as cdk from 'aws-cdk-lib/core';
import * as appconfig from 'aws-cdk-lib/aws-appconfig';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cognitoIdentity from 'aws-cdk-lib/aws-cognito-identitypool';
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

    /**
     * FUNCTION URL ENDPOINT VERSION - ADDITIONAL RESOURCES
     */

    const modelAbstractionFnForUrl = new lambdaNodejs.NodejsFunction(
      this,
      'ModelAbstractionFunctionForUrl',
      {
        entry: './src/lambda-functions/model-abstraction-for-url.ts',
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_24_X,
        timeout: cdk.Duration.minutes(2),
        logRetention: logs.RetentionDays.FIVE_DAYS,
        memorySize: 256,
        layers: [
          lambda.LayerVersion.fromLayerVersionArn(
            this,
            'AppConfigLayerFnUrl',
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

    modelAbstractionFnForUrl.addToRolePolicy(
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
    modelAbstractionFnForUrl.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModelWithResponseStream'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:*:${account}:inference-profile/*`,
        ],
      }),
    );
    modelAbstractionFnForUrl.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:GetInferenceProfile'],
        resources: [`arn:aws:bedrock:*:${account}:inference-profile/*`],
      }),
    );

    const userPool = new cognito.UserPool(this, 'ModelSelectionUserPool', {
      userPoolName: 'model-selection-user-pool',
      accountRecovery: cognito.AccountRecovery.NONE,
    });

    const fnUrlRole = new iam.Role(this, 'ModelAbstractionFnUrlRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {},
        'sts:AssumeRoleWithWebIdentity',
      ),
    });

    const fnUrlIdentityPool = new cognitoIdentity.IdentityPool(
      this,
      'FnUrlIdentityPool',
      {
        identityPoolName: 'FnUrlIdentityPool',
        authenticationProviders: {
          userPools: [
            new cognitoIdentity.UserPoolAuthenticationProvider({
              userPool,
            }),
          ],
        },
        authenticatedRole: fnUrlRole,
      },
    );

    // Update the role's trust policy with the identity pool ID conditions
    const cfnRole = fnUrlRole.node.defaultChild as iam.CfnRole;
    cfnRole.assumeRolePolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Federated: 'cognito-identity.amazonaws.com',
          },
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              'cognito-identity.amazonaws.com:aud':
                fnUrlIdentityPool.identityPoolId,
            },
            'ForAnyValue:StringLike': {
              'cognito-identity.amazonaws.com:amr': 'authenticated',
            },
          },
        },
      ],
    };

    new cognito.CfnUserPoolGroup(this, 'FnUrlGroup', {
      userPoolId: userPool.userPoolId,
      description: 'Access to function URL',
      groupName: 'fn-url-access',
      roleArn: fnUrlRole.roleArn,
    });

    const modelAbstractionFnUrl = modelAbstractionFnForUrl.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
        maxAge: cdk.Duration.seconds(300),
      },
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    modelAbstractionFnUrl.grantInvokeUrl(fnUrlRole);

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: fnUrlIdentityPool.identityPoolId,
    });
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
    });
    new cdk.CfnOutput(this, 'LambdaFunctionUrl', {
      value: modelAbstractionFnUrl.url,
    });
  }
}
