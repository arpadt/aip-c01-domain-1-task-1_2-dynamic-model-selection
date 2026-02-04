#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { DynamicModelSelectionStack } from '../lib/dynamic-model-selection-stack';

const app = new cdk.App();
new DynamicModelSelectionStack(app, 'DynamicModelSelectionStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
