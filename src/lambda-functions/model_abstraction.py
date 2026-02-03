import boto3
import json

def lambda_handler(event, context):
    # Get AppConfig configuration
    appconfig_client = boto3.client('appconfig')
    config_response = appconfig_client.get_configuration(
        Application='AIAssistantApp',
        Environment='Production',
        Configuration='ModelSelectionStrategy',
        ClientId='AIAssistantLambda'
    )

    # Parse configuration
    config = json.loads(config_response['Content'].read().decode('utf-8'))

    # Extract request details
    body = json.loads(event.get('body', '{}'))
    prompt = body.get('prompt', '')
    use_case = body.get('use_case', 'general')

    # Select model based on use case and configuration
    model_id = select_model(config, use_case)

    # Invoke selected model
    response = invoke_model(model_id, prompt)

    return {
        'statusCode': 200,
        'body': json.dumps({
            'model_used': model_id,
            'response': response
        })
    }

def select_model(config, use_case):
    """Select appropriate model based on configuration and use case."""
    # Check if there's a use case specific model
    use_case_models = config.get('use_case_models', {})
    if use_case in use_case_models:
        return use_case_models[use_case]

    # Default to primary model
    return config.get('primary_model')

def invoke_model(model_id, prompt):
    """Invoke the selected model with error handling."""
    bedrock_runtime = boto3.client('bedrock-runtime')

    try:
        # Prepare request body based on model provider
        body = json.dumps({
            'schemaVersion': 'messages-v1',
            'messages': [{
                'role': 'user',
                'content': [{'text': prompt}],
            }],
            'inferenceConfig': {
                "maxTokens": 500,
                "temperature": 0.7,
                "topP": 0.9
            }
        })
        # Add more model providers as needed

        # Invoke the model
        response = bedrock_runtime.invoke_model(
            modelId=model_id,
            body=body
        )

        # Parse the response
        response_body = json.loads(response['body'].read().decode())

        return response_body['output']['message']['content'][0]['text']

    except Exception as e:
        print(f"Error invoking model {model_id}: {str(e)}")
        # Return error message or try fallback model
        return f"Error generating response: {str(e)}"
