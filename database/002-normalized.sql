-- Applied in one transaction by migrateSchema(). The original snapshot table is
-- retained as an immutable migration backup; normal writes never update it.
DO $$ DECLARE w record; BEGIN
  FOR w IN SELECT id FROM daylight_workspaces LOOP
    IF NOT pg_try_advisory_xact_lock(hashtext('daylight:' || w.id)) THEN
      RAISE EXCEPTION 'Close desktop writers before schema migration' USING ERRCODE='55P03';
    END IF;
  END LOOP;
END $$;
LOCK TABLE daylight_workspaces IN ACCESS EXCLUSIVE MODE;
ALTER TABLE daylight_workspaces RENAME TO daylight_workspaces_v1_backup;

CREATE TABLE daylight_workspace_meta (
  id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX daylight_workspace_meta_updated_idx ON daylight_workspace_meta(updated_at DESC, id);
CREATE TABLE daylight_lists (
  workspace_id text NOT NULL REFERENCES daylight_workspace_meta(id) ON DELETE CASCADE,
  id text NOT NULL, position bigint NOT NULL, name text NOT NULL, color text NOT NULL,
  archived boolean NOT NULL DEFAULT false, deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY(workspace_id,id)
);
CREATE INDEX daylight_lists_order_idx ON daylight_lists(workspace_id,position,id);
CREATE TABLE daylight_tasks (
  workspace_id text NOT NULL REFERENCES daylight_workspace_meta(id) ON DELETE CASCADE,
  id text NOT NULL, list_id text NOT NULL, position bigint NOT NULL,
  title text NOT NULL, stage text NOT NULL CHECK(stage IN ('Backlog','This Week','Today','Done')),
  notes text NOT NULL DEFAULT '', estimate double precision CHECK(estimate > 0), due text NOT NULL DEFAULT '',
  completed_at_ms bigint, archived boolean NOT NULL DEFAULT false, deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY(workspace_id,id),
  FOREIGN KEY(workspace_id,list_id) REFERENCES daylight_lists(workspace_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX daylight_tasks_order_idx ON daylight_tasks(workspace_id,position,id);
CREATE INDEX daylight_tasks_board_idx ON daylight_tasks(workspace_id,stage,position,id) WHERE NOT deleted AND NOT archived;
CREATE INDEX daylight_tasks_list_idx ON daylight_tasks(workspace_id,list_id,position,id);
CREATE INDEX daylight_tasks_completed_idx ON daylight_tasks(workspace_id,completed_at_ms) WHERE completed_at_ms IS NOT NULL;
CREATE INDEX daylight_tasks_list_completed_idx ON daylight_tasks(workspace_id,list_id,completed_at_ms) WHERE completed_at_ms IS NOT NULL;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX daylight_tasks_search_idx ON daylight_tasks USING gin(lower(title || ' ' || notes) gin_trgm_ops) WHERE NOT deleted;
CREATE TABLE daylight_subtasks (
  workspace_id text NOT NULL, task_id text NOT NULL, id text NOT NULL,
  position bigint NOT NULL, title text NOT NULL, done boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '', due text NOT NULL DEFAULT '',
  PRIMARY KEY(workspace_id,task_id,id),
  FOREIGN KEY(workspace_id,task_id) REFERENCES daylight_tasks(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX daylight_subtasks_order_idx ON daylight_subtasks(workspace_id,task_id,position,id);
CREATE TABLE daylight_sessions (
  workspace_id text NOT NULL REFERENCES daylight_workspace_meta(id) ON DELETE CASCADE,
  id text NOT NULL, position bigint NOT NULL,
  task_id text NOT NULL, list_id text NOT NULL, title text NOT NULL,
  start_ms bigint NOT NULL CHECK(start_ms >= 0), end_ms bigint NOT NULL,
  kind text NOT NULL CHECK(kind IN ('work','break')),
  PRIMARY KEY(workspace_id,id), CHECK(end_ms > start_ms)
  -- Historical task/list IDs deliberately survive entity deletion/imports.
);
CREATE INDEX daylight_sessions_order_idx ON daylight_sessions(workspace_id,position,id);
CREATE INDEX daylight_sessions_page_idx ON daylight_sessions(workspace_id,start_ms DESC,id DESC) INCLUDE(end_ms,kind,list_id);
CREATE INDEX daylight_sessions_list_page_idx ON daylight_sessions(workspace_id,list_id,start_ms DESC,id DESC) INCLUDE(end_ms,kind);
CREATE INDEX daylight_sessions_task_idx ON daylight_sessions(workspace_id,task_id,start_ms DESC);
CREATE TABLE daylight_preferences (
  workspace_id text PRIMARY KEY REFERENCES daylight_workspace_meta(id) ON DELETE CASCADE,
  mode text NOT NULL, brand text NOT NULL, pomodoro boolean NOT NULL,
  work integer NOT NULL CHECK(work BETWEEN 1 AND 120), short integer NOT NULL CHECK(short BETWEEN 1 AND 60),
  long integer NOT NULL CHECK(long BETWEEN 1 AND 60), cycle integer NOT NULL CHECK(cycle BETWEEN 1 AND 12),
  sound boolean NOT NULL, show_time boolean NOT NULL, full_title boolean NOT NULL
);
CREATE TABLE daylight_timers (
  workspace_id text PRIMARY KEY REFERENCES daylight_workspace_meta(id) ON DELETE CASCADE,
  task_id text, status text NOT NULL CHECK(status IN ('idle','running','paused')),
  phase text NOT NULL CHECK(phase IN ('work','short','long')),
  elapsed bigint NOT NULL, sprint bigint NOT NULL, rounds integer NOT NULL,
  last_at bigint NOT NULL, segment_start bigint NOT NULL, segment_ms bigint NOT NULL,
  preview jsonb,
  FOREIGN KEY(workspace_id,task_id) REFERENCES daylight_tasks(workspace_id,id) DEFERRABLE INITIALLY DEFERRED
);

INSERT INTO daylight_workspace_meta SELECT id,revision,updated_at FROM daylight_workspaces_v1_backup;
INSERT INTO daylight_lists
SELECT w.id,x->>'id',n-1,x->>'name',x->>'color',(x->>'archived')::boolean,(x->>'deleted')::boolean
FROM daylight_workspaces_v1_backup w, jsonb_array_elements(state->'lists') WITH ORDINALITY a(x,n);
INSERT INTO daylight_tasks
SELECT w.id,x->>'id',x->>'listId',n-1,x->>'title',x->>'stage',x->>'notes',(x->>'estimate')::double precision,x->>'due',
(x->>'completedAt')::bigint,(x->>'archived')::boolean,(x->>'deleted')::boolean
FROM daylight_workspaces_v1_backup w, jsonb_array_elements(state->'tasks') WITH ORDINALITY a(x,n);
INSERT INTO daylight_subtasks
SELECT w.id,t->>'id',x->>'id',n-1,x->>'title',(x->>'done')::boolean,x->>'notes',x->>'due'
FROM daylight_workspaces_v1_backup w, jsonb_array_elements(state->'tasks') t,
jsonb_array_elements(t->'subtasks') WITH ORDINALITY a(x,n);
INSERT INTO daylight_sessions
SELECT w.id,x->>'id',n-1,x->>'taskId',x->>'listId',x->>'title',(x->>'start')::bigint,(x->>'end')::bigint,x->>'kind'
FROM daylight_workspaces_v1_backup w, jsonb_array_elements(state->'sessions') WITH ORDINALITY a(x,n);
INSERT INTO daylight_preferences
SELECT id,p->>'mode',p->>'brand',(p->>'pomodoro')::boolean,(p->>'work')::integer,(p->>'short')::integer,
(p->>'long')::integer,(p->>'cycle')::integer,(p->>'sound')::boolean,(p->>'showTime')::boolean,(p->>'fullTitle')::boolean
FROM daylight_workspaces_v1_backup, LATERAL (SELECT state->'prefs' AS p) a;
INSERT INTO daylight_timers
SELECT id,t->>'taskId',t->>'status',t->>'phase',(t->>'elapsed')::bigint,(t->>'sprint')::bigint,(t->>'rounds')::integer,
(t->>'lastAt')::bigint,(t->>'segmentStart')::bigint,(t->>'segmentMs')::bigint,t->'preview'
FROM daylight_workspaces_v1_backup, LATERAL (SELECT state->'timer' AS t) a;

CREATE FUNCTION daylight_export_state(w text) RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT jsonb_build_object('version',1,
 'lists',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'color',color,'archived',archived,'deleted',deleted) ORDER BY position,id) FROM daylight_lists WHERE workspace_id=w),'[]'::jsonb),
 'tasks',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'listId',list_id,'title',title,'stage',stage,'notes',notes,'estimate',estimate,'due',due,'completedAt',completed_at_ms,'archived',archived,'deleted',deleted,
   'subtasks',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'done',s.done,'notes',s.notes,'due',s.due) ORDER BY s.position,s.id) FROM daylight_subtasks s WHERE s.workspace_id=w AND s.task_id=t.id),'[]'::jsonb)) ORDER BY position,id) FROM daylight_tasks t WHERE workspace_id=w),'[]'::jsonb),
 'sessions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'taskId',task_id,'listId',list_id,'title',title,'start',start_ms,'end',end_ms,'kind',kind) ORDER BY position,id) FROM daylight_sessions WHERE workspace_id=w),'[]'::jsonb),
 'prefs',(SELECT jsonb_build_object('mode',mode,'brand',brand,'pomodoro',pomodoro,'work',work,'short',short,'long',long,'cycle',cycle,'sound',sound,'showTime',show_time,'fullTitle',full_title) FROM daylight_preferences WHERE workspace_id=w),
 'timer',(SELECT jsonb_build_object('taskId',task_id,'status',status,'phase',phase,'elapsed',elapsed,'sprint',sprint,'rounds',rounds,'lastAt',last_at,'segmentStart',segment_start,'segmentMs',segment_ms,'preview',preview) FROM daylight_timers WHERE workspace_id=w));
$$;
-- Compatibility for explicit snapshot reads/exports, not the hot data path.
-- Metadata columns remain automatically updatable; old UPDATE state fails closed.
CREATE VIEW daylight_workspaces AS SELECT id,revision,updated_at,daylight_export_state(id) AS state FROM daylight_workspace_meta;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM daylight_workspaces_v1_backup b WHERE daylight_export_state(b.id) IS DISTINCT FROM b.state) THEN
   RAISE EXCEPTION 'Migration round-trip mismatch; entire migration rolled back';
 END IF;
END $$;
