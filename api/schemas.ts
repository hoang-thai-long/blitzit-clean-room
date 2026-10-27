export const workspaceId = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' } as const;
export const entityId = { type: 'string', minLength: 1, maxLength: 128 } as const;
export const title = { type: 'string', maxLength: 300 } as const;
export const notes = { type: 'string', maxLength: 100_000 } as const;
export const due = { type: 'string', maxLength: 16 } as const;
export const stage = { type: 'string', enum: ['Backlog', 'This Week', 'Today', 'Done'] } as const;
export const estimate = { anyOf: [{ type: 'null' }, { type: 'number', exclusiveMinimum: 0, maximum: 100_000 }] } as const;
export const timestamp = { type: 'integer', minimum: 0, maximum: 8640000000000000 } as const;
export const bool = { type: 'boolean' } as const;
export const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required });
export const params = (entity?: 'listId' | 'taskId' | 'sessionId', subtask = false) => object({ workspace: workspaceId, ...(entity ? { [entity]: entityId } : {}), ...(subtask ? { subtaskId: entityId } : {}) }, ['workspace', ...(entity ? [entity] : []), ...(subtask ? ['subtaskId'] : [])]);
export const paging = { limit: { type: 'string', pattern: '^([1-9]|[1-9][0-9]|100)$', default: '50' }, offset: { type: 'string', pattern: '^(0|[1-9][0-9]{0,6})$', default: '0' } };
export const dateQuery = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
export const sessionFilters = { start: dateQuery, end: dateQuery, listId: entityId, kind: { type: 'string', enum: ['work', 'break'] } };
export const mutationHeaders = object({ 'if-match': { type: 'string', pattern: '^"[0-9]+"$' } });
// HTTP headers have standard fields not exhaustively listed here.
export const headers = { ...mutationHeaders, additionalProperties: true };
