import assert from 'node:assert/strict';
import test from 'node:test';
import {ALL_WS_IDS,buildCatalog,executeCatalogBlocked,validateCatalog} from './ws-active-catalog.mjs';

test('catalog is exact case-sensitive 23 and contains no executable row',()=>{
  const rows=validateCatalog();
  assert.deepEqual(rows.map((row)=>row.id),ALL_WS_IDS);
  assert.ok(rows.some((row)=>row.id==='0G')&&rows.some((row)=>row.id==='0g'));
  assert.equal(rows.filter((row)=>row.capability_eligibility.startsWith('ELIGIBLE')).length,14);
  assert.equal(rows.filter((row)=>row.execution_status==='EXECUTABLE').length,0);
});

test('13 REAL request contracts are eligible but ownership-blocked',()=>{
  const rows=buildCatalog();
  const eligibleReal=rows.filter((row)=>row.kind==='REAL'&&row.capability_eligibility.startsWith('ELIGIBLE'));
  assert.equal(eligibleReal.length,13);
  assert.ok(eligibleReal.every((row)=>row.execution_status==='BLOCKED_OWNERSHIP_DISCOVERY'));
});

test('remaining ten rows keep exact input, implementation, or condition ownership blockers',()=>{
  const blocked=buildCatalog().filter((row)=>!row.capability_eligibility.startsWith('ELIGIBLE'));
  assert.equal(blocked.length,9);
  assert.equal(buildCatalog().find((row)=>row.id==='ka10171').execution_status,'BLOCKED_IMPLEMENTATION_REVIEW');
  assert.equal(buildCatalog().find((row)=>row.id==='ka10173').execution_status,'BLOCKED_OWNERSHIP_DISCOVERY');
  assert.equal(buildCatalog().find((row)=>row.id==='ka10174').execution_status,'BLOCKED_OWNERSHIP_DISCOVERY');
});

test('execute request is blocked before supplied credential, fetch, or socket can be used',async()=>{
  let fetches=0,sockets=0;
  const result=await executeCatalogBlocked({token:'secret',fetchFn:async()=>{fetches+=1;},streamFactory:async()=>{sockets+=1;},rows:buildCatalog().map((row)=>({...row,execution_status:'EXECUTABLE'}))});
  assert.equal(result.status,'BLOCKED_OWNERSHIP_DISCOVERY');
  assert.equal(result.results.length,23);
  assert.equal(result.network_requests,0);
  assert.equal(fetches,0);assert.equal(sockets,0);
  assert.ok(result.results.every((row)=>row.status!=='EXECUTABLE'));
  assert.doesNotMatch(JSON.stringify(result),/secret/);
});
