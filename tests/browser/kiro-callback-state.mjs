import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const result = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Modal from './src/shared/components/KiroSocialOAuthModal.js'; window.successes=0; const root=createRoot(document.getElementById('root')); window.render=(isOpen=true,provider='google')=>root.render(<Modal isOpen={isOpen} provider={provider} onSuccess={()=>window.successes++} onClose={()=>window.render(false)}/>); window.render();`, resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.js': 'jsx' }, jsx: 'automatic',
  plugins: [{name:'ui-fixtures',setup(b) {
    b.onResolve({filter:/^@\/shared\/components$/},()=>({path:'ui',namespace:'fixture'}));
    b.onResolve({filter:/^@\/shared\/hooks\/useCopyToClipboard$/},()=>({path:'hook',namespace:'fixture'}));
    b.onResolve({filter:/^@\//},args=>({path:process.cwd()+'/src/'+args.path.slice(2)+'.js'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'jsx',contents:args.path==='ui' ? `import React from 'react'; export const Modal=({isOpen,children})=>isOpen?<section>{children}</section>:null; export const Button=({children,fullWidth,variant,...props})=><button {...props}>{children}</button>; export const Input=({label,...props})=><input aria-label={label} {...props}/>;` : `export const useCopyToClipboard=()=>({copied:false,copy:()=>{}});`,resolveDir:process.cwd()}));
  }}],
});
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
const page=await browser.newPage();
await page.setContent('<div id="root"></div>');
await page.evaluate(()=>{
  window.open=()=>null; window.calls=[]; window.attempts=0; window.mode='ok';
  window.fetch=async(url,options)=>{
    if(url.includes('social-authorize')) { window.attempts++;return {ok:true,json:async()=>({state:'state'+window.attempts,codeVerifier:'verifier',authUrl:'https://example.com'})}; }
    window.calls.push(JSON.parse(options.body));
    if(window.mode==='hold') return new Promise(resolve=>window.release=()=>resolve({ok:true,json:async()=>({success:true})}));
    if(window.mode==='fail') throw new Error('network failed');
    return {ok:true,json:async()=>({success:true})};
  };
});
await page.addScriptTag({content:result.outputFiles[0].text});
const input=page.locator('input:not([readonly])');
await input.waitFor();
const submit=page.getByRole('button',{name:'Connect',exact:true});
await input.fill('kiro://callback?code=code&state=wrong'); await submit.click();
await page.getByRole('button',{name:'Try Again'}).click();
assert.equal(await page.evaluate(()=>window.calls.length),0);
assert.equal(await page.evaluate(()=>window.attempts),1);
await page.evaluate(()=>window.mode='fail');
await input.fill('kiro://callback?code=code&state=state1');await submit.click();
await page.getByRole('button',{name:'Try Again'}).click(); await input.waitFor();
assert.equal(await page.evaluate(()=>window.attempts),2);
await page.evaluate(()=>window.mode='hold');
await input.fill('http://localhost:20128/callback?code=code&state=state2');await submit.click();
assert.equal(await submit.isDisabled(),true);
await page.evaluate(()=>window.render(false));await page.locator('section').waitFor({state:'detached'});
await page.evaluate(()=>window.release());
await page.evaluate(()=>window.render(true,'github'));await input.waitFor();
assert.equal(await page.evaluate(()=>window.successes),0);
await page.evaluate(()=>window.mode='ok');
await input.fill('kiro://callback?code=code&state=state3');await submit.click();
await page.getByText('Connected Successfully!').waitFor();
assert.equal(await page.evaluate(()=>window.successes),1);
assert.equal(await page.evaluate(()=>window.calls.length),3);
console.log('PASS: mismatch correction, fresh retry after failure, pending disable, stale completion, valid reconnect');
} finally { await browser.close(); }
