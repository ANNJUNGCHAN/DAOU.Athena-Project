import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketPhase, REPO_ROOT } from './observer.mjs';
import { reconcileWebsocketSources } from './ws-passive.mjs';

export const ALL_WS_IDS = Object.freeze(['00','04','0A','0B','0C','0D','0E','0F','0G','0H','0I','0J','0U','0g','0m','0s','0u','0w','1h','ka10171','ka10172','ka10173','ka10174']);
const STOCK_TYPES = new Set(['0A','0B','0C','0D','0E','0F','0H','0g','0w','1h']);
const ITEMLESS_TYPES = new Set(['00','04','0s']);

export function buildCatalog() {
  return ALL_WS_IDS.map((id) => {
    if (STOCK_TYPES.has(id)) return {id,kind:'REAL',capability_eligibility:'ELIGIBLE_WITH_FRESH_STOCK_IDENTITY',execution_status:'BLOCKED_OWNERSHIP_DISCOVERY',reason:'no_authoritative_collision_free_group_reservation'};
    if (ITEMLESS_TYPES.has(id)) return {id,kind:'REAL',capability_eligibility:'ELIGIBLE_SOURCE_ITEM_CONTRACT',execution_status:'BLOCKED_OWNERSHIP_DISCOVERY',reason:'no_authoritative_collision_free_group_reservation'};
    if (id==='0G') return {id,kind:'REAL',capability_eligibility:'BLOCKED_INPUT',execution_status:'BLOCKED_INPUT',reason:'fresh_etf_code_not_resolved'};
    if (id==='0I') return {id,kind:'REAL',capability_eligibility:'BLOCKED_INPUT',execution_status:'BLOCKED_INPUT',reason:'fresh_international_gold_symbol_not_resolved'};
    if (id==='0J'||id==='0U') return {id,kind:'REAL',capability_eligibility:'BLOCKED_INPUT',execution_status:'BLOCKED_INPUT',reason:'fresh_sector_code_not_resolved'};
    if (id==='0m'||id==='0u') return {id,kind:'REAL',capability_eligibility:'BLOCKED_INPUT',execution_status:'BLOCKED_INPUT',reason:'fresh_nonexpired_elw_code_not_resolved'};
    if (id==='ka10171') return {id,kind:'CONDITION_ONE_SHOT',capability_eligibility:'ELIGIBLE_AFTER_RESPONSE_SHAPE_REVIEW',execution_status:'BLOCKED_IMPLEMENTATION_REVIEW',reason:'condition_list_shape_not_reviewed'};
    if (id==='ka10172') return {id,kind:'CONDITION_ONE_SHOT',capability_eligibility:'BLOCKED_INPUT',execution_status:'BLOCKED_INPUT',reason:'valid_condition_seq_not_resolved'};
    return {id,kind:'CONDITION_LEASE',capability_eligibility:'BLOCKED_OWNERSHIP_DISCOVERY',execution_status:'BLOCKED_OWNERSHIP_DISCOVERY',reason:'condition_seq_lease_has_no_owner_namespace'};
  });
}

function assert(value,message){if(!value)throw new Error(message);}

export function validateCatalog(rows=buildCatalog()) {
  assert(rows.length===23,'catalog must contain 23 rows');
  assert(new Set(rows.map((row)=>row.id)).size===23,'catalog IDs must be unique');
  assert(rows.map((row)=>row.id).join('|')===ALL_WS_IDS.join('|'),'catalog IDs or case changed');
  assert(rows.every((row)=>row.execution_status!=='EXECUTABLE'),'active catalog must fail closed without ownership proof');
  return rows;
}

export async function executeCatalogBlocked(options={}) {
  const rows=validateCatalog();
  return {status:'BLOCKED_OWNERSHIP_DISCOVERY',network_requests:0,registration_requests:0,removal_requests:0,results:rows.map((row)=>({id:row.id,status:row.execution_status,reason:row.reason})),account_alias_persisted:false,token_persisted:false,raw_values_persisted:false};
}

export async function catalogProbe(options={}) {
  const now=options.now instanceof Date?options.now:new Date();
  const catalog=validateCatalog();
  const definitions=options.definitions||JSON.parse(await readFile(path.join(REPO_ROOT,'backend','ref','kiwoom-screen-definitions.json'),'utf8')).definitions;
  const mappings=options.manifestMappings||JSON.parse(await readFile(path.join(REPO_ROOT,'backend','ref','kiwoom-common-screen-manifest.json'),'utf8')).mappings;
  const source=reconcileWebsocketSources(definitions,mappings);
  const execution=options.execute===true?await executeCatalogBlocked(options):null;
  const artifact={schema_version:1,kind:'athena_ws_catalog_probe',observed_at:now.toISOString(),market:marketPhase(now),revision:options.revision||null,mode:options.execute===true?'BLOCKED_EXECUTE':'DRY_RUN',source_count:23,source_exact_set_equal:source.exact_set_equal,catalog,execution,safety:{network_requests:0,orders:false,oauth:false,conditions:false,registrations:false,removals:false,raw_values_persisted:false},verdict:options.execute===true?'BLOCKED_OWNERSHIP_DISCOVERY':'NOT_EXECUTED'};
  const root=path.resolve(options.outputRoot||path.join(REPO_ROOT,'artifacts','market-session-audit','2026-09-07'));
  await mkdir(root,{recursive:true});
  const file=path.join(root,`ws-active-catalog-${now.toISOString().replace(/[-:]/g,'').replace('.','-')}.json`);
  await writeFile(file,JSON.stringify(artifact,null,2)+'\n',{flag:'wx'});
  return {artifact,outputPath:file};
}

const direct=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct){const execute=process.argv.slice(2).includes('--execute');const {artifact,outputPath}=await catalogProbe({execute});console.log(`${outputPath} — mode=${artifact.mode} verdict=${artifact.verdict} network=${artifact.safety.network_requests}`);}
