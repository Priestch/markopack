export function GET(context) {
  return Response.json({
    type: "docs-catch-all",
    params: context.params,
    message: "Catch-all dynamic route",
  });
}
