export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const notFound = (entity: string) => new ApiError(404, 'NOT_FOUND', `${entity} not found`);
export const invalid = (message: string) => new ApiError(422, 'INVALID_OPERATION', message);
