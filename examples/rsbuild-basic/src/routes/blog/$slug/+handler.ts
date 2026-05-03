export function GET(context) {
  return Response.json({
    type: "blog-post",
    params: context.params,
    message: "Dynamic segment route",
  });
}
