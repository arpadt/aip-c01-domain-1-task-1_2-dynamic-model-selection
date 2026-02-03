import boto3
import json
import time
import pandas as pd
import numpy as np

# Initialize Bedrock client
bedrock_runtime = boto3.client('bedrock-runtime')

# Models to evaluate
models = [
    'eu.amazon.nova-micro-v1:0',
    'eu.amazon.nova-lite-v1:0',
    'eu.amazon.nova-pro-v1:0',
    'eu.amazon.nova-2-lite-v1:0',
]

# Test cases with ground truth answers
test_cases = [
    {
        "question": "What is a 401(k) retirement plan?",
        "context": "Financial services",
        "ground_truth": "A 401(k) is a tax-advantaged retirement savings plan offered by employers."
    },
    {
        "question": "What is an IRA account?",
        "context": "Financial services",
        "ground_truth": "An IRA (Individual Retirement Account) is a personal retirement savings account that offers tax advantages, allowing individuals to contribute earned income for tax-deferred or tax-free growth depending on the type (Traditional or Roth)."
    },
    {
        "question": "What type of loan is a mortgage?",
        "context": "Financial services",
        "ground_truth": "A mortgage is a loan secured by real estate, typically used to purchase a home, where the property serves as collateral and is repaid over a fixed period with interest."
    },
    {
        "question": "What is a credit score?",
        "context": "Financial services",
        "ground_truth": "A credit score is a three-digit number (usually ranging from 300 to 850) that represents an individual's creditworthiness, calculated from credit history, payment behavior, debt levels, and other factors to help lenders assess risk."
    },
    {
        "question": "What is an APR?",
        "context": "Financial services",
        "ground_truth": "An APR (Annual Percentage Rate) is the yearly cost of borrowing money, expressed as a percentage, that includes interest and certain fees to provide a standardized way to compare loan or credit card costs."
    },
    {
        "question": "What is a Roth IRA?",
        "context": "Financial services",
        "ground_truth": "A Roth IRA is a type of individual retirement account funded with after-tax dollars, offering tax-free qualified withdrawals in retirement and no required minimum distributions during the owner's lifetime."
    },
    {
        "question": "What is compound interest?",
        "context": "Financial services",
        "ground_truth": "Compound interest is the interest earned on both the initial principal and the accumulated interest from previous periods, leading to exponential growth in savings or investments over time."
    },
    {
        "question": "What is diversification in investing?",
        "context": "Financial services",
        "ground_truth": "Diversification is an investment strategy that spreads money across various assets or sectors to reduce risk, as different investments may perform differently under the same market conditions."
    },
    {
        "question": "What is a mutual fund?",
        "context": "Financial services",
        "ground_truth": "A mutual fund is a pooled investment vehicle that collects money from many investors to purchase a diversified portfolio of stocks, bonds, or other securities, managed professionally."
    },
    {
        "question": "How is net worth calculated?",
        "context": "Financial services",
        "ground_truth": "Net worth is the total value of an individual's or household's assets (such as cash, investments, and property) minus all liabilities (such as loans and debts)."
    },
    {
        "question": "What is a certificate of deposit (CD)?",
        "context": "Financial services",
        "ground_truth": "A certificate of deposit (CD) is a time deposit offered by banks and credit unions that pays a fixed interest rate for a specified term, with penalties for early withdrawal."
    },
]

def invoke_model(model_id, prompt, max_tokens=500):
    """Invoke a model with the given prompt and return the response and metrics."""
    start_time = time.time()

    # Prepare request body based on model provider
    if "anthropic" in model_id:
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens,
            "messages": [
                {"role": "user", "content": prompt}
            ]
        })
    elif "amazon" in model_id:
        body = json.dumps({
            'schemaVersion': 'messages-v1',
            'messages': [{
                'role': 'user',
                'content': [{'text': prompt}]
            }],
            'inferenceConfig': {
                'maxTokens': max_tokens,
                'temperature': 0.7,
                'topP': 0.9
            },
        })
    # Add more model providers as needed

    try:
        # Invoke the model
        response = bedrock_runtime.invoke_model(
            modelId=model_id,
            body=body
        )

        # Parse the response
        response_body = json.loads(response['body'].read().decode())

        if "anthropic" in model_id:
            output = response_body['content'][0]['text']
        elif "amazon" in model_id:
            output = response_body['output']['message']['content'][0]['text']

        # Calculate metrics
        latency = time.time() - start_time
        token_count = len(output.split())  # Rough estimate

        return {
            "success": True,
            "output": output,
            "latency": latency,
            "token_count": token_count
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "latency": time.time() - start_time
        }

def evaluate_models():
    """Evaluate all models on all test cases and return results."""
    results = []

    for test_case in test_cases:
        prompt = f"Question: {test_case['question']}\nContext: {test_case['context']}"

        for model_id in models:
            print(f"Evaluating {model_id} on: {test_case['question']}")
            response = invoke_model(model_id, prompt)

            if response["success"]:
                similarity = calculate_similarity(response["output"], test_case["ground_truth"])

                results.append({
                    "model_id": model_id,
                    "context": test_case["context"],
                    "question": test_case["question"],
                    "output": response["output"],
                    "latency": response["latency"],
                    "token_count": response["token_count"],
                    "similarity_score": similarity
                })
            else:
                results.append({
                    "model_id": model_id,
                    "context": test_case["context"],
                    "question": test_case["question"],
                    "error": response["error"],
                    "latency": response["latency"]
                })

    return pd.DataFrame(results)

def calculate_similarity(output, ground_truth):
    output_embedding = get_titan_embedding(output)
    ground_truth_embedding = get_titan_embedding(ground_truth)

    cosine_similarity = np.dot(output_embedding, ground_truth_embedding) / (np.linalg.norm(output_embedding) * np.linalg.norm(ground_truth_embedding))
    return cosine_similarity

def get_titan_embedding(text: str, dimensions: int = 1024, normalize: bool = True) -> np.ndarray:
    body = json.dumps({
        "inputText": text,
        "dimensions": dimensions,
        "normalize": normalize
    })
    response = bedrock_runtime.invoke_model(
        modelId="amazon.titan-embed-text-v2:0",
        body=body,
        accept="application/json",
        contentType="application/json"
    )
    embedding = json.loads(response["body"].read())["embedding"]
    return np.array(embedding)

def create_model_selection_strategy(results_df):
    """Create a model selection strategy based on evaluation results."""
    print("\nEvaluation Summary:")

    # Calculate overall scores per domain (context)
    use_case_models = {}

    for context in results_df["context"].unique():
        context_df = results_df[results_df["context"] == context]

        model_scores = context_df.groupby("model_id").agg({
            "latency": "mean",
            "similarity_score": "mean"
        }).reset_index()

        # Normalize scores
        max_latency = model_scores["latency"].max()
        model_scores["latency_score"] = 1 - (model_scores["latency"] / max_latency)

        # Calculate weighted score
        model_scores["overall_score"] = (
            0.7 * model_scores["similarity_score"] +
            0.3 * model_scores["latency_score"]
        )

        # Get best model for this use case
        best_model = model_scores.nlargest(1, "overall_score").iloc[0]["model_id"]
        use_case_models[context.lower().replace(" ", "_")] = best_model

    # Calculate global scores for primary/fallback
    model_scores = results_df.groupby("model_id").agg({
        "latency": "mean",
        "similarity_score": "mean"
    }).reset_index()
    print(model_scores)

    max_latency = model_scores["latency"].max()
    model_scores["latency_score"] = 1 - (model_scores["latency"] / max_latency)
    model_scores["overall_score"] = (
        0.7 * model_scores["similarity_score"] +
        0.3 * model_scores["latency_score"]
    )
    model_scores = model_scores.sort_values("overall_score", ascending=False)

    strategy = {
        "primary_model": model_scores.iloc[0]["model_id"],
        "fallback_models": model_scores.iloc[1:]["model_id"].tolist(),
        "use_case_models": use_case_models,
        "model_scores": model_scores.to_dict(orient="records")
    }

    return strategy

# Run evaluation
if __name__ == "__main__":
    results_df = evaluate_models()

    # Save results to CSV
    results_df.to_csv("model_evaluation_results.csv", index=False)

    strategy = create_model_selection_strategy(results_df)
    print(json.dumps(strategy, indent=2))

    # Save strategy to file for AppConfig
    with open("model_selection_strategy.json", "w") as f:
        json.dump(strategy, f, indent=2)
