import type { SchemaOptions } from 'mongoose';

/**
 * Shared schema options: emit clean JSON where `_id` is a string and Mongo
 * internals (`__v`) are dropped, so API payloads line up with the shared
 * domain types.
 */
export const baseSchemaOptions: SchemaOptions = {
  versionKey: false,
  toJSON: {
    virtuals: false,
    transform(_doc, ret: Record<string, unknown>) {
      if (ret._id != null) ret._id = String(ret._id);
      return ret;
    },
  },
};
