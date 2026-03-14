#!/usr/bin/env node
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbnYiOiJwcm9kdWN0aW9uIiwia2lsb1VzZXJJZCI6ImI5MjBjNzM4LTE5ZjQtNGU2Yi1iOWFlLWY1MzYzN2I3MWY0NyIsImFwaVRva2VuUGVwcGVyIjpudWxsLCJ2ZXJzaW9uIjozLCJkZXZpY2VBdXRoUmVxdWVzdENvZGUiOiI5TDg2LVhNTjgiLCJpYXQiOjE3NzMyMzg1ODMsImV4cCI6MTkzMDkxODU4M30.MMQjvdVf35WLbwggPXrgL5V_W3YnDdovcMYV9yPoqqs';
const baseUrl = 'https://api.kilo.ai/api/openrouter/chat/completions';

async function testModel(model) {
  const t = Date.now();
  try {
    const r = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [{role: 'user', content: 'Hi'}],
        max_tokens: 10
      })
    });
    const d = await r.json();
    const ms = Date.now() - t;
    if (d.error) {
      console.log('FAIL', model, '-', d.error.message?.slice(0,50) || d.error.code, '('+ms+'ms)');
    } else {
      const content = d.choices?.[0]?.message?.content?.slice(0,25) || '';
      console.log('OK', model, '->', d.model, '"' + content + '"', '('+ms+'ms)');
    }
  } catch(e) {
    console.log('ERR', model, e.message?.slice(0,40));
  }
}

(async () => {
  console.log('Testing KiloCode models...\n');
  await testModel('openrouter/auto');
  await testModel('anthropic/claude-sonnet-4');
  await testModel('anthropic/claude-3.5-sonnet');
  await testModel('openai/gpt-4o');
  await testModel('google/gemini-2.0-flash-001');
  await testModel('deepseek/deepseek-chat');
  await testModel('meta-llama/llama-3.3-70b-instruct');
  await testModel('qwen/qwen-2.5-72b-instruct');
})();
