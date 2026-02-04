import { useState } from 'react';

const API_URL = import.meta.env.VITE_MODEL_SELECTION_API_URL;

function App() {
  const [prompt, setPrompt] = useState('');
  const [useCase, setUseCase] = useState('balanced');
  const [modelUsed, setModelUsed] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setModelUsed('');
    setResponse('');

    try {
      const res = await fetch(`${API_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, use_case: useCase }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          if (line === '[DONE]') {
            break;
          }

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
        <h1 className='text-2xl font-bold mb-6'>Model Selection</h1>
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

export default App;
