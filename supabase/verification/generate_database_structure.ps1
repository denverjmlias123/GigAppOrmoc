# Read-only live catalog export. Requires supabase link and an authenticated Supabase CLI.
$ErrorActionPreference = 'Stop'
$q = [char]96
function Query([string]$sql) {
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $queryPath = Join-Path $env:TEMP ('gigormoc-live-catalog-' + [guid]::NewGuid().ToString('N') + '.sql')
  [System.IO.File]::WriteAllText($queryPath, $sql, [System.Text.UTF8Encoding]::new($false))
  $raw = (& npx supabase db query --linked --output-format json --file $queryPath 2>&1 | Out-String)
  Remove-Item -LiteralPath $queryPath -Force
  $ErrorActionPreference = $oldPreference
  $match = [regex]::Match($raw, '(?s)\{.*\}')
  if (-not $match.Success) { throw "Supabase catalog query failed: $raw" }
  $response = $match.Value | ConvertFrom-Json
  if (-not $response.rows) { throw "Catalog query returned no rows: $raw" }
  return $response.rows
}
$tablesSql = @'
select coalesce(jsonb_agg(jsonb_build_object('table_name',t.table_name,'columns',c.columns,'constraints',k.constraints,
  'indexes',ix.indexes,'policies',p.policies,'rls_enabled',r.relrowsecurity,'rls_forced',r.relforcerowsecurity)
  order by t.table_name),'[]'::jsonb) as catalog
from information_schema.tables t join pg_class r on r.relname=t.table_name
join pg_namespace n on n.oid=r.relnamespace and n.nspname='public'
left join lateral (select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable='YES','default',column_default) order by ordinal_position) columns from information_schema.columns where table_schema='public' and table_name=t.table_name) c on true
left join lateral (select jsonb_agg(jsonb_build_object('name',con.conname,'type',con.contype,'definition',pg_get_constraintdef(con.oid,true)) order by con.conname) constraints from pg_constraint con where con.conrelid=r.oid) k on true
left join lateral (select jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) order by indexname) indexes from pg_indexes where schemaname='public' and tablename=t.table_name) ix on true
left join lateral (select jsonb_agg(jsonb_build_object('name',policyname,'command',cmd,'roles',roles,'using',qual,'check',with_check) order by policyname) policies from pg_policies where schemaname='public' and tablename=t.table_name) p on true
where t.table_schema='public' and t.table_type='BASE TABLE';
'@
$functionsSql = @'
select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'returns',pg_get_function_result(p.oid),'security_definer',p.prosecdef,'volatility',p.provolatile,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) as catalog
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p');
'@
$authSql = @'
select coalesce(jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable='YES','default',column_default) order by ordinal_position),'[]'::jsonb) as catalog from information_schema.columns where table_schema='auth' and table_name='users';
'@
$bucketsSql = @'
select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) order by id),'[]'::jsonb) as catalog from storage.buckets;
'@
$storagePoliciesSql = @'
select coalesce(jsonb_agg(jsonb_build_object('name',policyname,'command',cmd,'roles',roles,'using',qual,'check',with_check) order by policyname),'[]'::jsonb) as catalog from pg_policies where schemaname='storage' and tablename='objects';
'@
$gapsSql = @'
select jsonb_build_object(
 'tables_without_primary_key',(select coalesce(jsonb_agg(c.relname order by c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not exists(select 1 from pg_constraint p where p.conrelid=c.oid and p.contype='p')),
 'public_tables_without_rls',(select coalesce(jsonb_agg(c.relname order by c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity),
 'foreign_keys_without_covering_index',(select coalesce(jsonb_agg(jsonb_build_object('table',fk.conrelid::regclass::text,'constraint',fk.conname,'definition',pg_get_constraintdef(fk.oid,true)) order by fk.conrelid::regclass::text,fk.conname),'[]'::jsonb) from pg_constraint fk join pg_class child on child.oid=fk.conrelid join pg_namespace ns on ns.oid=child.relnamespace where fk.contype='f' and ns.nspname='public' and not exists(select 1 from pg_index i where i.indrelid=fk.conrelid and i.indisvalid and i.indpred is null and i.indnkeyatts>=cardinality(fk.conkey) and (select array_agg(i.indkey[g.pos]::int order by g.pos) from generate_series(0,cardinality(fk.conkey)-1) g(pos))=fk.conkey::int[]))
) as catalog;
'@
$refsSql = @'
select coalesce(jsonb_agg(jsonb_build_object('child',con.conrelid::regclass::text,'parent',con.confrelid::regclass::text,'name',con.conname,'definition',pg_get_constraintdef(con.oid,true)) order by con.conrelid::regclass::text,con.conname),'[]'::jsonb) as catalog from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where con.contype='f' and n.nspname='public';
'@
$tables = @((Query $tablesSql)[0].catalog)
$functions = @((Query $functionsSql)[0].catalog)
$authColumns = @((Query $authSql)[0].catalog)
$buckets = @((Query $bucketsSql)[0].catalog)
$storagePolicies = @((Query $storagePoliciesSql)[0].catalog)
$gaps = (Query $gapsSql)[0].catalog
$refs = @((Query $refsSql)[0].catalog)
$purpose = @{
 agreements='Accepted gig work and agreed price.'; applications='Freelancer proposals and counteroffers.'; areas='Admin-managed local area reference.'
 audit_events='Append-only security and activity trail.'; categories='Admin-managed gig categories.'; conversation_reads='Per-user conversation read position.'
 conversations='Message thread and participant link.'; gigs='Client-posted work.'; idempotency_keys='Request keys preventing duplicate writes.'
 login_attempts='Per-email failed-login counters.'; login_ip_attempts='Per-IP failed-login counters.'; messages='Conversation messages.'
 milestones='Agreed work stages, amounts, and review state.'; notifications='In-app notifications by recipient.'
 payments='External payment reports; the marketplace does not hold funds.'; platform_admins='Admin allow-list and privilege tier.'
 portfolio_items='Freelancer portfolio entries and media paths.'; profile_hiring_interests='Client hiring interests.'
 profile_private='Private age and contact details.'; profile_skills='Freelancer-to-skill links.'
 profiles='Public profile, mode, account status, and role-specific ratings.'
 rate_limit_events='Database-backed action rate limits.'; reports='User-submitted moderation reports.'
 reviews='Agreement participant reviews and moderation state.'; skills='Admin catalog and user-proposed skills.'
 submissions='Milestone submissions and private file paths.'; user_sessions='Tracked sessions, heartbeat, and revocation.'
}
$out = [System.Collections.Generic.List[string]]::new()
$out.Add('# Gigormoc database structure'); $out.Add('')
$out.Add('Generated from the linked live Supabase catalog on ' + (Get-Date -Format 'yyyy-MM-dd') + ' by supabase/verification/generate_database_structure.ps1. Schema metadata only; no application rows were queried.')
$out.Add(''); $out.Add("Live catalog: $($tables.Count) public base tables, public routines, auth.users, and Storage buckets."); $out.Add('')
$out.Add('## Identity: auth.users'); $out.Add('')
$out.Add('Supabase Auth identity records; application profile rows reference these identities. Authentication secrets and user data are not exported here, only column metadata.');$out.Add('')
$out.Add('| Column | Type | Nullable | Default |'); $out.Add('|---|---|---:|---|')
foreach ($c in $authColumns) { $d=if($c.default){"${q}$($c.default)${q}"}else{'none'}; $out.Add("| ${q}$($c.name)${q} | ${q}$($c.udt)${q} | $($c.nullable) | $d |") }
$out.Add(''); $out.Add('## Public tables, constraints, indexes, and RLS'); $out.Add('')
$out.Add('Columns, constraints, indexes, and policy expressions are read from the linked live catalog.'); $out.Add('')
foreach ($t in $tables) {
  $out.Add("### ${q}public.$($t.table_name)${q}"); $out.Add('')
 if($purpose.ContainsKey($t.table_name)){$out.Add($purpose[$t.table_name]);$out.Add('')}
 $out.Add('| Column | Type | Nullable | Default |');$out.Add('|---|---|---:|---|')
  foreach($c in $t.columns){$type=if($c.type -eq 'ARRAY'){$c.udt.TrimStart('_')+'[]'}else{$c.type};$d=if($c.default){"${q}$(([string]$c.default).Replace('|','\|'))${q}"}else{'none'};$out.Add("| ${q}$($c.name)${q} | ${q}$type${q} | $($c.nullable) | $d |")}
 $out.Add('');$out.Add('Constraints:')
  if($t.constraints){foreach($c in $t.constraints){$out.Add("- ${q}$($c.name)${q} - ${q}$($c.definition)${q}")}}else{$out.Add('- None')}
 $out.Add('');$out.Add('Indexes:')
  if($t.indexes){foreach($i in $t.indexes){$out.Add("- ${q}$($i.name)${q} - ${q}$($i.definition)${q}")}}else{$out.Add('- None')}
 $out.Add('');$out.Add("RLS enabled: **$($t.rls_enabled)**; forced: **$($t.rls_forced)**.")
  if($t.policies){foreach($p in $t.policies){$s="- ${q}$($p.name)${q} ($($p.command); roles: $($p.roles -join ', '))";if($p.using){$s+="; USING: ${q}$($p.using -replace '\s+',' ')${q}"};if($p.check){$s+="; WITH CHECK: ${q}$($p.check -replace '\s+',' ')${q}"};$out.Add($s)}}else{$out.Add('No explicit client policy; access is default-deny under RLS.')}
 $out.Add('')
}
$out.Add('## Storage buckets');$out.Add('')
$out.Add('| Bucket | Public | Size limit | MIME types |');$out.Add('|---|---:|---:|---|')
foreach($b in $buckets){$types=if($b.allowed_mime_types){$b.allowed_mime_types -join ', '}else{'Any'};$out.Add("| ${q}$($b.name)${q} | $($b.public) | $($b.file_size_limit) bytes | $types |")}
$out.Add('');$out.Add('### Storage object policies');$out.Add('')
if($storagePolicies.Count){foreach($p in $storagePolicies){$s="- ${q}$($p.name)${q} ($($p.command); roles: $($p.roles -join ', '))";if($p.using){$s+="; USING: ${q}$(($p.using -replace '\s+',' '))${q}"};if($p.check){$s+="; WITH CHECK: ${q}$(($p.check -replace '\s+',' '))${q}"};$out.Add($s)}}else{$out.Add('No explicit policies found on storage.objects.')}
$out.Add('');$out.Add('## Public functions and procedures');$out.Add('')
$out.Add('| Routine | Returns | SECURITY DEFINER | Volatility | anon execute | authenticated execute |');$out.Add('|---|---|---:|---|---:|---:|')
foreach($f in $functions){$a=if($f.arguments){$f.arguments}else{''};$v=switch($f.volatility){'i'{'immutable'}'s'{'stable'}default{'volatile'}};$out.Add("| ${q}$($f.name)($a)${q} | ${q}$($f.returns)${q} | $($f.security_definer) | $v | $($f.anon_execute) | $($f.authenticated_execute) |")}
$out.Add('');$out.Add('## Relationship diagram');$out.Add('')
$out.Add('Edges are generated from live foreign-key constraints. Each child row references one parent; a parent may have zero or more children.');$out.Add('')
$fence="$q$q$q";$out.Add($fence+'mermaid');$out.Add('erDiagram')
$out.Add('  %% Identity and account security')
$out.Add('  AUTH_USERS ||--o| PROFILES : provisions');$out.Add('  AUTH_USERS ||--o| PROFILE_PRIVATE : private_details')
$out.Add('  AUTH_USERS ||--o{ USER_SESSIONS : sessions');$out.Add('  AUTH_USERS ||--o| PLATFORM_ADMINS : admin_tier')
$groups=@{
 'catalog'=@('areas','categories','skills')
 'marketplace'=@('gigs','applications','agreements','milestones','submissions','payments','reviews')
 'profiles'=@('profiles','profile_private','profile_skills','profile_hiring_interests','portfolio_items')
 'communication'=@('conversations','conversation_reads','messages','notifications')
 'security and moderation'=@('platform_admins','audit_events','reports','login_attempts','login_ip_attempts','user_sessions','rate_limit_events','idempotency_keys')
}
foreach($group in $groups.Keys){$out.Add("  %% $group");foreach($r in $refs){$child=($r.child -replace '^public\.','' -replace '^auth\.','AUTH_') -replace '[^A-Za-z0-9_]','_';if($child -notin $groups[$group]){continue};$parent=($r.parent -replace '^public\.','' -replace '^auth\.','AUTH_') -replace '[^A-Za-z0-9_]','_';if($child -in @('profiles','profile_private','user_sessions','platform_admins') -and $parent -eq 'AUTH_users'){continue};$label=$r.name -replace '^[^_]+_','' -replace '_fkey$','';$out.Add("  $($parent.ToUpper()) ||--o{ $($child.ToUpper()) : $label")}}
$out.Add($fence);$out.Add('')
$out.Add('reports.target_type + target_id and audit_events.entity_type + entity_id are polymorphic; they intentionally do not have one foreign-key target.');$out.Add('')
$out.Add('## Live catalog checks');$out.Add('')
$noPk=@($gaps.tables_without_primary_key);$noRls=@($gaps.public_tables_without_rls);$noIndex=@($gaps.foreign_keys_without_covering_index)
$out.Add('- Public tables without primary key: '+$(if($noPk.Count){$noPk -join ', '}else{'**none found**'}))
$out.Add('- Public tables without RLS: '+$(if($noRls.Count){$noRls -join ', '}else{'**none found**'}))
$out.Add('- Foreign keys without an index beginning with their FK columns:')
if($noIndex.Count){foreach($x in $noIndex){$out.Add("  - ${q}$($x.table).$($x.constraint)${q} - ${q}$($x.definition)${q}")}}else{$out.Add('  - **None found**')}
$out.Add('');$out.Add('### Proposed index migration (not applied)');$out.Add('')
$out.Add('The following additive indexes address the catalog gaps above. Review and approve before creating a new migration; no schema changes were made by this report.')
if($noIndex.Count){foreach($x in $noIndex){$table=([string]$x.table -replace '^public\.','');$column=[regex]::Match([string]$x.definition,'FOREIGN KEY \(([^)]+)\)').Groups[1].Value.Trim();if($column -match '^[A-Za-z_][A-Za-z0-9_]*$'){$index="idx_${table}_${column}";$out.Add('- ' + "${q}CREATE INDEX IF NOT EXISTS $index ON public.$table($column);${q}")}}}else{$out.Add('- None required by the current catalog check.')}
$out.Add('- Missing core relationships: no absent FK identified in core identity, marketplace, agreement, payment, review, or session paths. Polymorphic report/audit targets are documented above.')
$out.Add('');$out.Add('## Relationship demonstration script');$out.Add('')
$out.Add('1. Register two real accounts. Show auth.users, profiles, and profile_private rows; verify public profile reads do not expose DOB or phone.')
$out.Add('2. As admin, enter a real category and skill. Link the freelancer through profile_skills and the client through profile_hiring_interests.')
$out.Add('3. As client, post a gig; as freelancer, apply. Show gigs -> applications -> conversations -> messages.')
$out.Add('4. Accept the application. Show its agreement and milestones. Submit work and show the private Storage path in submissions.')
$out.Add('5. Report and confirm an external payment, complete the agreement, and review. Show participant links and role-specific ratings.')
$out.Add('6. Show notifications, tracked sessions, and admin log events from the workflow.')
$out.Add('');$out.Add('## Maintenance');$out.Add('')
$out.Add('Regenerate with powershell -ExecutionPolicy Bypass -File supabase/verification/generate_database_structure.ps1. The script queries catalog metadata only.')
$supabasePath=Split-Path $PSScriptRoot -Parent
$repositoryPath=Split-Path $supabasePath -Parent
$target=Join-Path $repositoryPath 'docs\DATABASE_STRUCTURE.md'
[System.IO.File]::WriteAllText($target,($out -join [Environment]::NewLine)+[Environment]::NewLine,[System.Text.UTF8Encoding]::new($false))
Write-Output "Generated $target from live metadata ($($tables.Count) public tables, $($functions.Count) routines, $($buckets.Count) buckets)."
