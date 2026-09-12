// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {handleCronTriggerRead,handleCronTriggerWrite} from './cronTrigger';
const env={AMSG_SERVER_TOKEN:'shared',CF_API_TOKEN:'test-only',CF_SCRIPT_NAME:'test-only',CF_ACCOUNT_ID:'test-only'};
const request=()=>new Request('https://example.workers.dev/cron-trigger',{headers:{'X-Client-Token':'shared'}});
afterEach(()=>vi.unstubAllGlobals());
const mock=(result:unknown)=>vi.stubGlobal('fetch',vi.fn(async(input:any)=>String(input).endsWith('/settings')?Response.json({success:true,result:{bindings:[]}}):Response.json({success:true,result})));
it('malformed successful GET is not evidence that cron is paused',async()=>{mock({});expect(await handleCronTriggerRead(env,request())).toMatchObject({supported:false,code:'CF_ERROR'});});
it('malformed successful PUT is not evidence that pause was applied',async()=>{mock({});expect(await handleCronTriggerWrite(env,request(),false)).toMatchObject({ok:false,code:'CF_ERROR'});});
it('opposite successful PUT receipt is not evidence that pause was applied',async()=>{mock({schedules:[{cron:'* * * * *'}]});expect(await handleCronTriggerWrite(env,request(),false)).toMatchObject({ok:false,code:'CF_ERROR'});});
