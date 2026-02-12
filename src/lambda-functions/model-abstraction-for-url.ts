import http from 'http';

import { LambdaFunctionURLEvent } from 'aws-lambda';
import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';

interface ModelSelectionStrategyConfig {
  primary_model: string;
  fallback_models: string[];
  use_case_models: Record<string, string>;
}

interface ApiInput {
  prompt: string;
  use_case: string;
}

const {
  APP_CONFIG_APPLICATION_NAME,
  APP_CONFIG_ENVIRONMENT,
  APP_CONFIG_CONFIGURATION,
} = process.env;

const bedrockClient = new BedrockRuntimeClient();

export const handler = awslambda.streamifyResponse(
  async (
    event: LambdaFunctionURLEvent,
    responseStream: awslambda.HttpResponseStream,
  ) => {
    const httpResponseMetadata = {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    };

    responseStream = awslambda.HttpResponseStream.from(
      responseStream,
      httpResponseMetadata,
    );

    try {
      if (
        !APP_CONFIG_APPLICATION_NAME ||
        !APP_CONFIG_CONFIGURATION ||
        !APP_CONFIG_ENVIRONMENT
      ) {
        console.log('Missing critical environment variables');
        throw new Error('Missing configuration');
      }

      const res = await retrieveConfig({
        application: APP_CONFIG_APPLICATION_NAME,
        environment: APP_CONFIG_ENVIRONMENT,
        configuration: APP_CONFIG_CONFIGURATION,
      });
      const configData = await fetchConfig(res);
      const parsedConfigData = JSON.parse(
        configData,
      ) as ModelSelectionStrategyConfig;

      const parsedBody = JSON.parse(event.body || '{}') as ApiInput;

      const prompt = parsedBody.prompt || '';
      const useCase = parsedBody.use_case || 'general';

      const modelId = selectModel(parsedConfigData, useCase);

      responseStream.write(`${JSON.stringify({ model_used: modelId })}\n\n`);

      const command = new InvokeModelWithResponseStreamCommand({
        modelId,
        body: JSON.stringify({
          schemaVersion: 'messages-v1',
          system: [
            {
              text: 'Respond with a max of 3 paragraphs. Remove any additional characters, like * or # from the response. Keep only whitespaces and line breaks.',
            },
          ],
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          inferenceConfig: { maxTokens: 500, temperature: 0.7, topP: 0.9 },
        }),
      });

      const modelResponse = await bedrockClient.send(command);
      if (!modelResponse.body) {
        console.log('No response received from the model.');
        throw new Error('Response body is empty');
      }

      for await (const chunk of modelResponse.body) {
        const chunkData = JSON.parse(
          new TextDecoder().decode(chunk.chunk?.bytes),
        );
        if (chunkData.contentBlockDelta) {
          const text = chunkData.contentBlockDelta.delta.text || '';
          responseStream.write(`${JSON.stringify({ chunk: text })}\n\n`);
        }
      }

      responseStream.write('[DONE]\n\n');
    } catch (error) {
      responseStream.write(`Error: ${JSON.stringify({ error })}`);
    } finally {
      responseStream.end();
    }
  },
);

function selectModel(config: ModelSelectionStrategyConfig, useCase: string) {
  const useCaseModels = config.use_case_models || {};
  return useCaseModels[useCase] || config.primary_model;
}

interface AppConfigProps {
  application: string;
  environment: string;
  configuration: string;
}
function retrieveConfig(
  configProps: AppConfigProps,
): Promise<http.IncomingMessage> {
  const { application, environment, configuration } = configProps;
  return new Promise((resolve) => {
    http.get(
      `http://localhost:2772/applications/${application}/environments/${environment}/configurations/${configuration}`,
      resolve,
    );
  });
}

function fetchConfig(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('error', (err) => reject(err));
    res.on('end', () => resolve(data));
  });
}
