import { useState } from 'react';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import { useNavigate } from 'react-router-dom';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';

const LAMBDA_FUNCTION_URL = import.meta.env.VITE_LAMBDA_FUNCTION_URL;
const REGION =
  import.meta.env.VITE_USER_POOL_ID?.split('_')[0] || 'eu-central-1';

export default function Protected() {
  const [prompt, setPrompt] = useState('');
  const [useCase, setUseCase] = useState('balanced');
  const [modelUsed, setModelUsed] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setModelUsed('');
    setResponse('');

    try {
      const session = await fetchAuthSession();
      const credentials = session.credentials;

      if (!credentials) {
        throw new Error('Not authenticated');
      }

      const url = new URL(LAMBDA_FUNCTION_URL);
      const body = JSON.stringify({ prompt, use_case: useCase });

      const request = new HttpRequest({
        method: 'POST',
        protocol: url.protocol.slice(0, -1),
        hostname: url.hostname,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          host: url.hostname,
        },
        body,
      });

      const signer = new SignatureV4({
        credentials,
        region: REGION,
        service: 'lambda',
        sha256: Sha256,
      });

      const signedRequest = await signer.sign(request);

      const res = await fetch(LAMBDA_FUNCTION_URL, {
        method: 'POST',
        headers: signedRequest.headers,
        body,
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          if (line === '[DONE]') break;

          const parsed = JSON.parse(line);
          if (parsed.model_used) {
            setModelUsed(parsed.model_used);
          }
          if (parsed.chunk) {
            setResponse((prev) => prev + parsed.chunk);
          }
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='min-h-screen bg-gray-100 p-8'>
      <div className='max-w-2xl mx-auto bg-white rounded-lg shadow-md p-6'>
        <div className='flex justify-between items-center mb-6'>
          <h1 className='text-2xl font-bold'>Model Selection</h1>
          <button
            onClick={handleLogout}
            className='px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700'
          >
            Sign Out
          </button>
        </div>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <div>
            <label className='block text-sm font-medium mb-2'>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className='w-full px-3 py-2 border rounded-md'
              rows={4}
              required
            />
          </div>
          <div>
            <label className='block text-sm font-medium mb-2'>Use Case</label>
            <select
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              className='w-full px-3 py-2 border rounded-md'
            >
              <option value='performance_optimized'>
                Performance Optimized
              </option>
              <option value='accuracy_optimized'>Accuracy Optimized</option>
              <option value='balanced'>Balanced</option>
              <option value='cost_optimized'>Cost Optimized</option>
            </select>
          </div>
          <button
            type='submit'
            disabled={loading}
            className='w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400'
          >
            {loading ? 'Loading...' : 'Submit'}
          </button>
        </form>
        {(modelUsed || response) && (
          <div className='mt-6 p-4 bg-gray-50 rounded-md'>
            {modelUsed && (
              <p className='text-sm font-medium mb-2'>Model: {modelUsed}</p>
            )}
            {response && (
              <p className='text-sm whitespace-pre-wrap'>{response}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
