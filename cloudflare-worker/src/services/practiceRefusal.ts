/** D4704 part 3 (#4704): a domain refusal, translated to HTTP only by the route. */
export class PracticeRefusal extends Error {
  body: Record<string, any>;
  status: 400 | 403 | 404 | 409 | 422;
  constructor(body: Record<string, any>, status: 400 | 403 | 404 | 409 | 422) {
    super(String(body.detail));
    this.body = body;
    this.status = status;
  }
}
export function practiceRefusal(body: Record<string, any>, status: 400 | 403 | 404 | 409 | 422): never {
  throw new PracticeRefusal(body, status);
}
