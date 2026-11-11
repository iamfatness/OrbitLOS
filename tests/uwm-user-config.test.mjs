import assert from "node:assert/strict";
import test from "node:test";
import { prepareUwmUserConfig } from "../scripts/prepare-uwm-user-access.mjs";

test("user-access setup rejects environment mismatch and leaves pricing keys out of the installed config",()=>{
  const env={UWM_ENVIRONMENT:"stage",UWM_CLIENT_ID:"fixture-id",UWM_CLIENT_SECRET:"fixture-secret"};
  const brokerage="11499b2a-1e3d-40f7-a752-f9781ec7fc24";
  assert.throws(()=>prepareUwmUserConfig(env,"production",brokerage),/matching/);
  assert.throws(()=>prepareUwmUserConfig({...env,UWM_CLIENT_SECRET:""},"stage",brokerage),/complete/);
  assert.throws(()=>prepareUwmUserConfig(env,"stage","orbit-demo"),/UUID/);
  const first=prepareUwmUserConfig(env,"stage",brokerage), second=prepareUwmUserConfig(env,"stage",brokerage);
  assert.equal(first.UWM_USER_ENVIRONMENT,"stage");
  assert.equal(first.UWM_USER_CLIENT_ID,env.UWM_CLIENT_ID);
  assert.equal(first.UWM_BROKERAGE_ID,brokerage);
  assert.equal("UWM_CLIENT_ID" in first,false);
  assert.equal("UWM_ENVIRONMENT" in first,false);
  assert.match(first.UWM_TOKEN_ENCRYPTION_KEY,/^[a-f0-9]{64}$/);
  assert.notEqual(first.UWM_TOKEN_ENCRYPTION_KEY,second.UWM_TOKEN_ENCRYPTION_KEY);
});
