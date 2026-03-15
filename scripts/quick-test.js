#!/usr/bin/env node
const BASE = 'http://localhost:20128';

async function testModel(model, stream = false) {
  const t = Date.now();
  try {
    const r = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model,
        messages: [{role: 'user', content: 'Say hello'}],
        max_tokens: 15,
        stream
      })
    });
    
    if (stream) {
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let content = '';
      let modelUsed = '';
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            content += parsed.choices?.[0]?.delta?.content || '';
            if (!modelUsed && parsed.model) modelUsed = parsed.model;
          } catch {}
        }
      }
      const ms = Date.now() - t;
      console.log('OK', model, '->', modelUsed, '"' + content.slice(0,30) + '"', ms+'ms');
    } else {
      const d = await r.json();
      const ms = Date.now() - t;
      if (d.error) {
        console.log('FAIL', model, d.error.message.slice(0,60), ms+'ms');
      } else {
        console.log('OK', model, '->', d.model, '"' + d.choices?.[0]?.message?.content?.slice(0,30) + '"', ms+'ms');
      }
    }
  } catch(e) {
    console.log('ERR', model, e.message.slice(0,50));
  }
}

(async () => {
  console.log('Testing combos (non-streaming)...\n');
  await testModel('opus');
  await testModel('sonnet');
  await testModel('fast');
  await testModel('build');
  await testModel('reason');
  
  console.log('\nTesting providers...\n');
  await testModel('groq/llama-3.3-70b-versatile');
  await testModel('openrouter/deepseek/deepseek-r1');
  await testModel('kiro/claude-sonnet-4.5');
  await testModel('iflow/qwen-coder-plus');
  await testModel('claude/claude-sonnet-4-6');
  await testModel('gemini-cli/gemini-2.5-pro');
  
  console.log('\nDone!');
})();
