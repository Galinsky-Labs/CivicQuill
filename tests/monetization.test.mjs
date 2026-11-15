// LEG-010 consumer tests: CivicQuill's defaults and catalog applied to the
// engine's shared settings/entitlements, with a Stripe test-mode sandbox
// (in-memory API double) through the real civic platform routes.
import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,randomBytes,createHmac} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {createIdentityStore,applyIdentityMigrations} from "@distributed-governance/engine/identity";
import {createPlatform,applyExtensionMigrations} from "@distributed-governance/engine/platform";
import {createStripeProvider} from "@distributed-governance/engine/server/payment-providers/stripe.mjs";
import {normalizeSettingValue} from "@distributed-governance/engine/src/settings-registry.mjs";
import {createLegalDocument} from "@distributed-governance/engine/legal-structure";
import {changePlatformAdmin} from "@distributed-governance/engine/scripts/grant-platform-admin.mjs";
import {civicExtension} from "../server/civic-extension.mjs";
import {CIVIC_ENGINE_SETTINGS,civicBillingCatalog,civicProductSettings} from "../src/catalog.mjs";

const origin="https://civic.example",SECRET="whsec_civicSandboxSecret1234567890";
const PRICES={"civic-creator-monthly":{currency:"USD",amountMinor:1500},"civic-single-document":{currency:"USD",amountMinor:900},"civic-credits-10":{currency:"USD",amountMinor:5000}};
let db,platform,identity,admin,creator,reader,tenantId,now,sessions,eventCounter=0;
const transaction=fn=>db.transaction(async tx=>{await tx.exec("SET LOCAL ROLE dge_identity_runtime");return fn(tx);});
const user=async(subject=randomUUID())=>({...await identity.establishSession({issuer:"https://id.example",subject,authenticatedAt:now}),origin,subject});
/** Signs the same account in again after the test clock moves past session expiry. */
const relogin=async()=>{creator=await user(creator.subject);reader=await user(reader.subject);};
const call=async(path,{who=null,method="GET",body,headers={},raw}={})=>{
  const response=await platform.application(new Request(origin+path,{method,headers:{
    ...(who?{cookie:"__Host-dge_session="+who.sessionToken,origin,"x-dge-csrf":who.csrfToken}:{}),
    ...(body!==undefined||raw!==undefined?{"content-type":"application/json"}:{}),...headers},
    ...(raw!==undefined?{body:raw}:body!==undefined?{body:JSON.stringify(body)}:{})}),{peerAddress:"127.0.0.1"});
  const text=await response.text();
  return {status:response.status,body:text?JSON.parse(text):null};
};
const stripeFetch=async(url,init)=>{
  const {pathname}=new URL(url);
  assert.match(init.headers.authorization,/^Bearer sk_test_/);
  if(init.method==="POST"&&pathname==="/v1/checkout/sessions"){
    const form=new URLSearchParams(init.body),id="cs_test_"+(sessions.size+1);
    sessions.set(id,{id,url:"https://checkout.stripe.com/c/pay/"+id,livemode:false,payment_status:"unpaid",amount_total:Number(form.get("line_items[0][price_data][unit_amount]")),
      currency:form.get("line_items[0][price_data][currency]"),client_reference_id:form.get("client_reference_id"),mode:form.get("mode"),payment_intent:null,subscription:null});
    return Response.json(sessions.get(id));
  }
  const s=pathname.match(/^\/v1\/checkout\/sessions\/(\w+)$/);
  if(s&&sessions.has(s[1]))return Response.json(sessions.get(s[1]));
  return new Response("{}",{status:404});
};
const deliver=evt=>{const raw=JSON.stringify(evt),t=Math.floor(now/1000);
  return call("/api/billing/webhooks/stripe",{method:"POST",raw,headers:{"stripe-signature":"t="+t+",v1="+createHmac("sha256",SECRET).update(t+"."+raw).digest("hex")}});};
const event=(type,object)=>({id:"evt_civic_"+(++eventCounter),object:"event",type,created:Math.floor(now/1000),livemode:false,data:{object}});
const create=who=>{const document=structuredClone(createLegalDocument({id:randomUUID(),tenantId,title:"Civic draft"}));
  return platform.services.documents.create(who,tenantId,{document,commandId:randomUUID(),disclosure:"publish-all-revisions-v1"});};

before(async()=>{
  db=await PGlite.create();
  await applyIdentityMigrations(fn=>db.transaction(fn));
  await applyExtensionMigrations(fn=>db.transaction(fn),civicExtension);
  // Tuesday 2026-11-17 12:00 New York.
  now=Date.UTC(2026,10,17,17,0);
  identity=createIdentityStore({transaction,origin,clock:()=>now,sessionKey:randomBytes(32),stateKey:randomBytes(32)});
  sessions=new Map();
  platform=createPlatform({identity,transaction,login:{},origin,product:"civic",clock:()=>now,extensions:[civicExtension],
    paymentProviders:[createStripeProvider({secretKey:"sk_test_civicSandbox",webhookSecret:SECRET,fetch:stripeFetch,clock:()=>now})]});
  admin=await user();creator=await user();reader=await user();
  await changePlatformAdmin(fn=>db.transaction(fn),{action:"grant",accountId:admin.accountId,reason:"Civic billing test"});
  ({tenantId}=await identity.createTenant(creator));
  const invite=await identity.invite(creator,tenantId,reader.accountId,"participant");
  await identity.acceptInvitation(reader,tenantId,invite.invitationToken);
});
after(async()=>db?.close());

test("civic defaults and catalog are valid engine settings; prices are never defaulted",()=>{
  for(const [key,value] of Object.entries(CIVIC_ENGINE_SETTINGS))assert.doesNotThrow(()=>normalizeSettingValue(key,value),key);
  assert.deepEqual(civicBillingCatalog({}),[],"no price, no purchasable plan");
  const catalog=civicBillingCatalog(PRICES);
  assert.doesNotThrow(()=>normalizeSettingValue("billing.catalog",catalog));
  assert.deepEqual(catalog.map(i=>i.kind),["subscription","single-document","credit-pack"]);
  assert.throws(()=>civicBillingCatalog({"civic-single-document":{currency:"USD",amountMinor:0}}),/Invalid price/);
  assert.throws(()=>civicBillingCatalog({"civic-single-document":{currency:"usd",amountMinor:100}}),/Invalid price/);
});

test("without a catalog purchases are off; the administrator applies civic settings without a deployment",async()=>{
  const off=await call("/api/billing/checkout",{who:creator});
  assert.equal(off.status,200);assert.equal(off.body.purchasesEnabled,false);
  await platform.services.settings.change(admin,{scope:"product",product:"civic"},{changes:civicProductSettings(PRICES),expectedVersion:0,reason:"Civic launch catalog"});
  const on=await call("/api/billing/checkout",{who:creator});
  assert.equal(on.body.purchasesEnabled,true);assert.deepEqual(on.body.catalog.map(i=>i.id),Object.keys(PRICES));
});

test("free weekly allowance follows New York weeks; then creation fails closed until a sandbox purchase lands",async()=>{
  await create(creator);
  await assert.rejects(create(creator),e=>/ENTITLEMENT|QUOTA|PAYMENT|CREDIT/.test(e.code??e.message));
  // Sunday 23:59 New York is still the same week.
  now=Date.UTC(2026,10,23,4,59);await relogin();
  await assert.rejects(create(creator));
  // Monday 00:01 New York starts a new free week.
  now=Date.UTC(2026,10,23,5,1);await relogin();
  await create(creator);
  const checkout=await call("/api/billing/checkout",{who:creator,method:"POST",body:{provider:"stripe",itemId:"civic-credits-10",subject:"account",idempotencyKey:"civic-"+randomUUID()}});
  assert.equal(checkout.status,200,JSON.stringify(checkout.body));
  const session=[...sessions.values()].find(s=>s.client_reference_id===checkout.body.checkoutId);
  assert.equal(session.amount_total,5000);
  Object.assign(session,{payment_status:"paid",payment_intent:"pi_civic_pack"});
  assert.equal((await deliver(event("checkout.session.completed",{...session,object:"checkout.session"}))).status,200);
  for(let i=0;i<3;i++)await create(creator);
  const status=await call("/api/entitlements",{who:creator});
  assert.equal(status.status,200);
  // Partial refund revokes only unused purchased credits.
  const refund=await deliver(event("charge.refunded",{id:"ch_civic",object:"charge",payment_intent:"pi_civic_pack",amount:5000,amount_refunded:2500,currency:"usd"}));
  assert.equal(refund.body.outcome,"processed");
  assert.equal((await platform.services.documents.list(reader,tenantId)).items.length,5,"refunds never remove documents");
});

test("readers, discussants and voters never need a creator subscription",async()=>{
  const listed=await platform.services.documents.list(reader,tenantId);
  assert.ok(listed.items.length>0);
  const read=await platform.services.documents.read(reader,tenantId,listed.items[0].id);
  assert.equal(read.document.tenantId,tenantId);
  assert.equal((await call("/api/public/civic/catalog")).body.defaults["participation.requiresSubscription"],false);
});
