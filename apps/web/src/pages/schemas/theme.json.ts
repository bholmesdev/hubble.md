import schema from "@hubble.md/theme/schema.json" with { type: "json" };

export const GET = () => Response.json(schema);
