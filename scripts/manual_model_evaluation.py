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

# Pricing per 1M tokens (input/output) in USD
MODEL_PRICING = {
    'eu.amazon.nova-micro-v1:0': {'input': 0.035, 'output': 0.14},
    'eu.amazon.nova-lite-v1:0': {'input': 0.06, 'output': 0.24},
    'eu.amazon.nova-pro-v1:0': {'input': 0.80, 'output': 3.20},
    'eu.amazon.nova-2-lite-v1:0': {'input': 0.06, 'output': 0.24},
}

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

        output = response_body['output']['message']['content'][0]['text']
        input_tokens = response_body['usage']['inputTokens']
        output_tokens = response_body['usage']['outputTokens']

        # Calculate cost
        pricing = MODEL_PRICING.get(model_id, {'input': 0, 'output': 0})
        cost = (input_tokens / 1_000_000 * pricing['input']) + (output_tokens / 1_000_000 * pricing['output'])

        # Calculate metrics
        latency = time.time() - start_time

        return {
            "success": True,
            "output": output,
            "latency": latency,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost": cost
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
                    "input_tokens": response["input_tokens"],
                    "output_tokens": response["output_tokens"],
                    "cost": response["cost"],
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

    # Calculate global scores for primary/fallback
    model_scores = results_df.groupby("model_id").agg({
        "latency": "mean",
        "similarity_score": "mean",
        "cost": "mean"
    }).reset_index()
    print(model_scores)

    # Normalize latency (lower is better)
    max_latency = model_scores["latency"].max()
    min_latency = model_scores["latency"].min()
    model_scores["latency_score"] = (max_latency - model_scores["latency"]) / (max_latency - min_latency)

    # Normalize similarity (higher is better)
    max_similarity = model_scores["similarity_score"].max()
    min_similarity = model_scores["similarity_score"].min()
    model_scores["similarity_score_normalized"] = (model_scores["similarity_score"] - min_similarity) / (max_similarity - min_similarity)

    # Normalize cost (lower is better)
    max_cost = model_scores["cost"].max()
    min_cost = model_scores["cost"].min()
    model_scores["cost_score"] = (max_cost - model_scores["cost"]) / (max_cost - min_cost)

    # Calculate weighted scores
    model_scores["performance_score"] = 0.8 * model_scores["latency_score"] + 0.2 * model_scores["similarity_score_normalized"]
    model_scores["accuracy_score"] = 0.2 * model_scores["latency_score"] + 0.8 * model_scores["similarity_score_normalized"]
    model_scores["overall_score"] = 0.5 * model_scores["latency_score"] + 0.5 * model_scores["similarity_score_normalized"]
    model_scores["cost_score_weighted"] = 0.7 * model_scores["cost_score"] + 0.3 * model_scores["similarity_score_normalized"]

    model_scores = model_scores.sort_values("overall_score", ascending=False)

    # Get best models for each optimization mode
    best_performance = model_scores.nlargest(1, "performance_score").iloc[0]["model_id"]
    best_accuracy = model_scores.nlargest(1, "accuracy_score").iloc[0]["model_id"]
    best_balanced = model_scores.nlargest(1, "overall_score").iloc[0]["model_id"]
    best_cost = model_scores.nlargest(1, "cost_score_weighted").iloc[0]["model_id"]

    strategy = {
        "primary_model": best_balanced,
        "fallback_models": model_scores.iloc[1:]["model_id"].tolist(),
        "use_case_models": {
            "performance_optimized": best_performance,
            "accuracy_optimized": best_accuracy,
            "balanced": best_balanced,
            "cost_optimized": best_cost
        },
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
