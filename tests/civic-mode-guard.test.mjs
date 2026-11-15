// LEG-006/007 consumer journey on the pinned engine: a bill under an open
// collaboration vote cannot be frozen into public input (DCE-010 guard); once
// the vote closes and adopts, the sponsor can freeze it and the source is fixed.
import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {createIdentityStore,applyIdentityMigrations} from "@distributed-governance/engine/identity";
import {createPlatform,applyExtensionMigrations} from "@distributed-governance/engine/platform";
import {createLegalDocument} from "@distributed-governance/engine/legal-structure";
import {modeTransition} from "@distributed-governance/engine/policy-lifecycle";
import {civicExtension} from "../server/civic-extension.mjs";

const origin="https://civic.example",HOUR=3600000;
let db,platform,identity,s,sponsor,citizen,tenantId,now;
const transaction=fn=>db.transaction(async tx=>{await tx.exec("SET LOCAL ROLE dge_identity_runtime");return fn(tx);});
const user=async()=>({...await identity.establishSession({issuer:"https://id.example",subject:randomUUID(),authenticatedAt:Date.now()}),origin});
const call=async(path,{who=sponsor,method="GET",body}={})=>{
  const response=await platform.application(new Request(origin+path,{method,headers:{
    cookie:"__Host-dge_session="+who.sessionToken,origin,"x-dge-csrf":who.csrfToken,...(body!==undefined?{"content-type":"application/json"}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})}),{peerAddress:"127.0.0.1"});
  const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null};
};

before(async()=>{
  db=await PGlite.create();
  await applyIdentityMigrations(fn=>db.transaction(fn));
  await applyExtensionMigrations(fn=>db.transaction(fn),civicExtension);
  identity=createIdentityStore({transaction,origin,sessionKey:randomBytes(32),stateKey:randomBytes(32)});
  now=Date.now();
  platform=createPlatform({identity,transaction,login:{},origin,product:"civic",clock:()=>now,enforceEntitlements:false,extensions:[civicExtension]});
  s=platform.services;
  sponsor=await user();citizen=await user();
  ({tenantId}=await identity.createTenant(sponsor));
  const i=await identity.invite(sponsor,tenantId,citizen.accountId,"participant");await identity.acceptInvitation(citizen,tenantId,i.invitationToken);
});
after(async()=>db?.close());

test("a bill cannot switch to public input while its amendment vote is open; afterwards the freeze fixes the adopted text",async()=>{
  const doc=structuredClone(createLegalDocument({id:randomUUID(),tenantId,title:"Clean Water Act"}));
  doc.content[0].inlines=[{kind:"text",text:"The agency shall report annually."}];
  await s.documents.create(sponsor,tenantId,{document:doc,commandId:randomUUID(),disclosure:"publish-all-revisions-v1"});
  const p=await s.proposals.create(citizen,tenantId,doc.id,{baseVersion:1,selection:{blockId:doc.content[0].id,start:24,end:32,quote:"annually"},
    replacement:"quarterly",rationale:"More frequent reporting.",commandId:randomUUID(),disclosure:"publish-proposal-v1"});
  now=Date.now();
  await s.decisions.open(sponsor,tenantId,doc.id,p.proposal.id,{hours:1,commandId:randomUUID()});
  const freeze=version=>call(`/api/workspaces/${tenantId}/documents/${doc.id}/freeze-input`,{method:"POST",body:{commandId:randomUUID(),expectedVersion:version}});
  const blocked=await freeze(1);
  assert.equal(blocked.status,409);assert.equal(blocked.body.error,"VOTE_IN_PROGRESS");
  assert.deepEqual(modeTransition({from:"collaboration",to:"public-input",role:"owner",activeVote:true}),{allowed:false,code:"VOTE_IN_PROGRESS"});
  for(const who of [sponsor,citizen])await s.decisions.cast(who,tenantId,doc.id,p.proposal.id,{choice:"yes",expectedVersion:0,commandId:randomUUID()});
  now+=HOUR+1;
  const {certificate}=await s.decisions.close(sponsor,tenantId,doc.id,p.proposal.id);
  assert.equal(certificate.appliedVersion,2);
  const frozen=await freeze(2);
  assert.equal(frozen.status,200,JSON.stringify(frozen.body));
  assert.equal(frozen.body.document.mode,"public-input");
  assert.match(JSON.stringify(frozen.body.document.content),/report quarterly/);
});

test("public consultation: a published support floor is reported on the advisory result and never adopts",async()=>{
  const doc=structuredClone(createLegalDocument({id:randomUUID(),tenantId,title:"Parks Ordinance"}));
  doc.content[0].inlines=[{kind:"text",text:"Parks close at sunset."}];
  await s.documents.create(sponsor,tenantId,{document:doc,commandId:randomUUID(),disclosure:"publish-all-revisions-v1"});
  await s.documents.freezeForInput(sponsor,tenantId,doc.id,{commandId:randomUUID(),expectedVersion:1});
  const p=await s.proposals.create(citizen,tenantId,doc.id,{baseVersion:2,selection:{blockId:doc.content[0].id,start:15,end:21,quote:"sunset"},
    replacement:"10 p.m.",rationale:"Evening use.",commandId:randomUUID(),disclosure:"publish-proposal-v1"});
  now=Date.now()+1000;
  const opened=await s.decisions.open(sponsor,tenantId,doc.id,p.proposal.id,{hours:1,commandId:randomUUID(),
    policySettings:{supportFloor:{minimumParticipants:"2",supportNumerator:"1",supportDenominator:"2"}}});
  assert.match(opened.rule.supportFloor,/at least 2 participants/);
  for(const who of [sponsor,citizen])await s.decisions.cast(who,tenantId,doc.id,p.proposal.id,{choice:"yes",expectedVersion:0,commandId:randomUUID()});
  now+=HOUR+1;
  const {certificate}=await s.decisions.close(sponsor,tenantId,doc.id,p.proposal.id);
  assert.equal(certificate.outcome.status,"advisory");
  assert.equal(certificate.outcome.supportFloor.status,"support-floor-met");
  assert.equal(certificate.canAdopt,false);
  assert.equal((await s.documents.read(sponsor,tenantId,doc.id)).version,2,"the fixed source never changes");
});
