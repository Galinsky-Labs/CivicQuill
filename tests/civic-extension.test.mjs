import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {createIdentityStore,applyIdentityMigrations} from "@distributed-governance/engine/identity";
import {createPlatform,applyExtensionMigrations} from "@distributed-governance/engine/platform";
import {civicExtension} from "../server/civic-extension.mjs";

const origin="https://civic.example";
let db,platform,identity,admin,sponsor,citizen,outsider,tenantId;
const transaction=fn=>db.transaction(async tx=>{await tx.exec("SET LOCAL ROLE dge_identity_runtime");return fn(tx);});
const user=async()=>({...await identity.establishSession({issuer:"https://id.example",subject:randomUUID(),authenticatedAt:Date.now()}),origin});
const call=async(path,{who=null,method="GET",body}={})=>{
  const response=await platform.application(new Request(origin+path,{method,headers:{
    ...(who?{cookie:"__Host-dge_session="+who.sessionToken,origin,"x-dge-csrf":who.csrfToken}:{}),
    ...(body!==undefined?{"content-type":"application/json"}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})}),{peerAddress:"127.0.0.1"});
  const text=await response.text();
  return {status:response.status,body:text?JSON.parse(text):null};
};
before(async()=>{
  db=await PGlite.create();
  await applyIdentityMigrations(fn=>db.transaction(fn));
  await applyExtensionMigrations(fn=>db.transaction(fn),civicExtension);
  identity=createIdentityStore({transaction,origin,sessionKey:randomBytes(32),stateKey:randomBytes(32)});
  platform=createPlatform({identity,transaction,login:{},origin,extensions:[civicExtension]});
  admin=await user();sponsor=await user();citizen=await user();outsider=await user();
  platform.services.isPlatformAdmin=async c=>c.sessionToken===admin.sessionToken;
  ({tenantId}=await identity.createTenant(sponsor));
  const invite=await identity.invite(sponsor,tenantId,citizen.accountId,"participant");
  await identity.acceptInvitation(citizen,tenantId,invite.invitationToken);
});
after(async()=>db?.close());

test("a sponsor drafts a bill from a jurisdiction template; it is published as a labelled community draft",async()=>{
  const res=await call(`/api/workspaces/${tenantId}/civic/bills`,{who:sponsor,method:"POST",body:{
    jurisdictionId:"us-state",title:"Clean Water Act",commandId:randomUUID(),sponsorDisplay:"Rep. Example",
    parts:["shortTitle","findings","definitions","operative","severability","effectiveDate"],
    values:{purpose:"protect drinking water",shortTitle:"Clean Water Act",state:"Ohio",findings:["Lead pipes remain in service."],operative:["Utilities shall replace lead service lines within ten years."]}}});
  assert.equal(res.status,200,JSON.stringify(res.body));
  assert.match(res.body.notice,/not been introduced or filed/);
  const id=res.body.document.id;
  const profile=await call(`/api/public/civic/documents/${id}/profile`);
  assert.equal(profile.body.jurisdiction.id,"us-state");
  const doc=await call(`/api/public/documents/${id}`);
  assert.match(JSON.stringify(doc.body.document.content),/Legislature of the State of Ohio/);
  const denied=await call(`/api/workspaces/${tenantId}/civic/bills`,{who:outsider,method:"POST",body:{jurisdictionId:"us-federal",title:"X",commandId:randomUUID(),values:{purpose:"test"},parts:["operative"]}});
  assert.equal(denied.status,403);
  const unknown=await call(`/api/workspaces/${tenantId}/civic/bills`,{who:sponsor,method:"POST",body:{jurisdictionId:"mars",title:"X",commandId:randomUUID()}});
  assert.equal(unknown.status,400);
});

test("official verification is reviewed by a platform administrator, never self-approved, and expires with the term",async()=>{
  const request={level:"state",role:"elected-official",jurisdiction:"Ohio",office:"State Representative",district:"District 18",termStart:"2025-01-01",termEnd:"2099-12-31",evidenceUrl:"https://www.legislature.ohio.gov/members",publicBadge:true};
  const filed=await call("/api/civic/officials",{who:citizen,method:"POST",body:request});
  assert.equal(filed.status,200);
  assert.equal((await call("/api/civic/officials",{who:citizen,method:"POST",body:request})).status,409,"one open request at a time");
  assert.equal((await call(`/api/civic/officials/${filed.body.id}/review`,{who:citizen,method:"POST",body:{decision:"approve"}})).status,403);
  assert.equal((await call("/api/civic/review/officials",{who:sponsor})).status,403);
  // A direct SQL attempt to self-approve is refused by row security.
  await assert.rejects(transaction(async tx=>{await tx.query("SELECT set_config('dge.account_id',$1,true)",[citizen.accountId]);
    const r=await tx.query("UPDATE app_civic.official_requests SET status='approved',reviewed_at=now(),reviewed_by=$1 WHERE id=$2 RETURNING id",[citizen.accountId,filed.body.id]);
    if(!r.rows.length)throw Error("row security blocked update");}));
  assert.equal((await call("/api/public/civic/officials")).body.items.length,0);
  const queue=await call("/api/civic/review/officials",{who:admin});
  assert.equal(queue.body.items.length,1);
  const reviewed=await call(`/api/civic/officials/${filed.body.id}/review`,{who:admin,method:"POST",body:{decision:"approve",note:"Matched the legislature's member directory."}});
  assert.equal(reviewed.body.request.status,"approved");
  assert.equal(reviewed.body.grant.unlimited,true);
  assert.equal(reviewed.body.grant.overCapBehaviour,"explicit-paid-offer");
  const badges=(await call("/api/public/civic/officials")).body.items;
  assert.equal(badges.length,1);
  assert.equal(badges[0].office,"State Representative");
  assert.equal(JSON.stringify(badges).includes("legislature.ohio.gov"),false,"verification evidence is never public");
  const bad=await call("/api/civic/officials",{who:outsider,method:"POST",body:{...request,evidenceUrl:"javascript:alert(1)"}});
  assert.equal(bad.status,400);
});

test("trust tiers are issued only by reviewers and analytics name every denominator",async()=>{
  assert.equal((await call("/api/civic/trust",{who:citizen})).body.tier,"account");
  const self=await call("/api/civic/trust-attestations",{who:citizen,method:"POST",body:{accountId:citizen.accountId,tier:"constituent",jurisdiction:"Ohio",method:"self",evidenceDigest:"a".repeat(64),expiresAt:"2099-01-01T00:00:00Z"}});
  assert.equal(self.status,403);
  const issued=await call("/api/civic/trust-attestations",{who:admin,method:"POST",body:{accountId:citizen.accountId,tier:"constituent",jurisdiction:"Ohio",method:"voter-file-match",evidenceDigest:"b".repeat(64),expiresAt:"2099-01-01T00:00:00Z"}});
  assert.equal(issued.status,200);
  assert.equal((await call("/api/civic/trust",{who:citizen})).body.tier,"constituent");
});

test("public input: sponsor responses, consultation series and the disposition report never change the source",async()=>{
  const created=await call(`/api/workspaces/${tenantId}/civic/bills`,{who:sponsor,method:"POST",body:{jurisdictionId:"us-local",title:"Bike Lane Ordinance",commandId:randomUUID(),parts:["operative"],values:{purpose:"add protected bike lanes",body:"City Council",locality:"Columbus",operative:["The city shall build protected bike lanes on High Street."]}}});
  const id=created.body.document.id;
  assert.equal((await call(`/api/workspaces/${tenantId}/civic/consultations`,{who:sponsor,method:"POST",body:{documentId:id}})).status,409,"a consultation needs a frozen public-input source");
  const frozen=await platform.services.documents.freezeForInput(sponsor,tenantId,id,{commandId:randomUUID(),expectedVersion:1});
  const series=await call(`/api/workspaces/${tenantId}/civic/consultations`,{who:sponsor,method:"POST",body:{documentId:id,summaryOfChanges:"Initial consultation."}});
  assert.equal(series.body.sequence,1);
  const source=frozen.document.content.find(n=>n.kind==="section").children[0];
  const proposal=await platform.services.proposals.create(citizen,tenantId,id,{baseVersion:frozen.version,
    selection:{blockId:source.id,start:source.inlines[0].text.indexOf("High Street"),end:source.inlines[0].text.indexOf("High Street")+11,quote:"High Street"},replacement:"High Street and Main Street",rationale:"Main Street has more crashes.",commandId:randomUUID(),disclosure:"publish-proposal-v1"});
  const pid=proposal.proposal.id;
  assert.equal((await call(`/api/workspaces/${tenantId}/civic/documents/${id}/proposals/${pid}/responses`,{who:citizen,method:"POST",body:{kind:"declined",explanation:"No."}})).status,403);
  assert.equal((await call(`/api/workspaces/${tenantId}/civic/documents/${id}/proposals/${pid}/responses`,{who:sponsor,method:"POST",body:{kind:"noted",explanation:"Reviewing crash data."}})).body.version,1);
  const second=await call(`/api/workspaces/${tenantId}/civic/documents/${id}/proposals/${pid}/responses`,{who:sponsor,method:"POST",body:{kind:"incorporated",explanation:"Added to the revised consultation edition."}});
  assert.equal(second.body.version,2);
  const report=(await call(`/api/public/civic/documents/${id}/disposition`)).body;
  assert.equal(report.totals.proposals,1);
  assert.equal(report.totals.incorporated,1);
  assert.equal(report.rows[0].response.kind,"incorporated");
  assert.equal(report.sourceVersion,frozen.version);
  assert.equal(report.consultation.sequence,1);
  const after=await call(`/api/public/documents/${id}`);
  assert.equal(after.body.digest,frozen.digest,"responses never edit the source edition");
  const analytics=(await call(`/api/public/civic/documents/${id}/analytics`)).body;
  assert.equal(analytics.proposals,1);
  assert.equal(analytics.verificationCoverage.verified,1);
  assert.equal(analytics.verificationCoverage.denominator,"distinct contributing accounts");
  const handoff=await call(`/api/workspaces/${tenantId}/civic/documents/${id}/handoff`,{who:sponsor});
  assert.equal(handoff.status,200);
  assert.match(handoff.body.statement,/do not introduce, pass or enact/);
  assert.match(handoff.body.packageSha256,/^[a-f0-9]{64}$/);
  assert.equal((await call(`/api/workspaces/${tenantId}/civic/documents/${id}/handoff`,{who:outsider})).status,403);
});

test("research evidence discloses affiliation and stays attached to the document",async()=>{
  const group=await call(`/api/workspaces/${tenantId}/civic/research-groups`,{who:citizen,method:"POST",body:{kind:"class",name:"PUBPOL 520",institution:"Example University",affiliationDisclosure:"Graduate public policy seminar."}});
  assert.equal(group.status,200);
  const docs=await platform.services.documents.list(sponsor,tenantId);
  const documentId=docs.items[0].id;
  const evidence=await call(`/api/workspaces/${tenantId}/civic/research-groups/${group.body.id}/evidence`,{who:citizen,method:"POST",body:{documentId,kind:"study",title:"Lead service line replacement outcomes",url:"https://example.org/study",summary:"Replacement reduced blood lead levels.",authors:"A. Researcher"}});
  assert.equal(evidence.status,200,JSON.stringify(evidence.body));
  const listed=(await call(`/api/public/civic/documents/${documentId}/evidence`)).body;
  assert.equal(listed.items[0].group.affiliationDisclosure,"Graduate public policy seminar.");
  assert.match(listed.notice,/never changes vote weight/);
  assert.equal((await call(`/api/workspaces/${tenantId}/civic/research-groups/${group.body.id}/evidence`,{who:citizen,method:"POST",body:{kind:"study",title:"x",url:"http://insecure.example",summary:"x"}})).status,400);
});
