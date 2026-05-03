export function GET() {
  return Response.json({
    type: "api-users",
    users: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Linus" },
    ],
  });
}
