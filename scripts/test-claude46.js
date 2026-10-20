#!/usr/bin/env node
const token = process.env.KILO_API_TOKEN?.trim();
if (!token) {
  console.error('KILO_API_TOKEN is required; load it from your secret manager.');
  process.exit(1);
}
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
  console.log('Testing Claude 4.6 models on KiloCode...\n');

  // Test various Claude 4.6 naming conventions
  await testModel('anthropic/claude-opus-4-6');
  await testModel('anthropic/claude-sonnet-4-6');
  await testModel('anthropic/claude-4-opus');
  await testModel('anthropic/claude-4-sonnet');
  await testModel('anthropic/claude-4.6-opus');
  await testModel('anthropic/claude-4.6-sonnet');

  // Also test the working ones we comparison
  console.log('\nReference (working models):');
  await testModel('anthropic/claude-sonnet-4');
  await testModel('anthropic/claude-3.5-sonnet');
})();
