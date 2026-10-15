// Exercises a TS-typed export (`export const GET: T = ...`): the historical
// regex required `GET =` immediately after the name and missed the annotation.
// The comment below is a decoy — a regex scan would wrongly register DELETE.
// export function DELETE() {}
export const GET: (request: Request) => Response = (request) =>
  Response.json({
    type: "api-typed",
    url: new URL(request.url).pathname,
  });
