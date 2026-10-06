export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, message: string): HttpError => new HttpError(400, code, message);
export const unauthenticated = (): HttpError => new HttpError(401, 'unauthenticated', 'Sign in with your setup link.');
export const notFound = (message = 'Not found'): HttpError => new HttpError(404, 'not_found', message);
