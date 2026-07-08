import { schema, timestamps } from "@outerjs/server";

export const v1_0_0 = schema("1.0.0")
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    ...timestamps(t),
  }))
  .build();
