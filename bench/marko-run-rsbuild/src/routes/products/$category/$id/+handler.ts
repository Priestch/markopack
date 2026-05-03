export function GET(context) {
  return Response.json({
    type: "product",
    params: context.params,
    message: "Nested dynamic segments route",
  });
}
