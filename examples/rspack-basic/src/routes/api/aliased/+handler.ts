// Exercises export-specifier detection (`export { x as VERB }`): the
// historical regex scan never matched this shape.
function list() {
  return Response.json({ type: "api-aliased", message: "Aliased exports" });
}

function create() {
  return new Response("Aliased POST", { status: 201 });
}

export { list as GET, create as POST };
