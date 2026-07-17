import { persist, store } from "@ilha/store";
import { extractFormData, validateWithSchema } from "@ilha/store/form";
import slugify from "@sindresorhus/slugify";
import { z } from "zod";

const InstanceSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    url: z.url(),
  })
  .transform((data) => ({
    ...data,
    id: data.id ?? slugify(data.name),
  }));

const StoreSchema = z.object({
  instances: z.array(InstanceSchema).default([]),
});

export const appStore = store(StoreSchema)
  .action("addInstance", (event: SubmitEvent, { get }) => {
    const formData = extractFormData(event.target as HTMLFormElement);
    const result = validateWithSchema(InstanceSchema, formData);
    if (result.ok) {
      const instances = get().instances;
      return { instances: [...instances, result.data] };
    }
    return {};
  })
  .build();

persist(appStore, "appStore");

export function getInstanceById(instanceId: string) {
  return appStore.getState().instances.find((instance) => instance.id === instanceId);
}
