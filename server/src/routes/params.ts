import { z } from "zod";

/** `/:id` route params; every id in the API is a UUID. */
export const idParams = z.object({ id: z.uuid() });
