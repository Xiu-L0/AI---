import { z } from "zod";

const MIB = 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * MIB;
const MAX_MARKDOWN_BYTES = MIB;
const MAX_LAYOUT_JSON_BYTES = 64 * 1024;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export const OcrMimeTypeSchema = z.enum(["image/jpeg", "image/png"]);

export const OcrBboxSchema = z
  .tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ])
  .refine(([x1, y1, x2, y2]) => x2 >= x1 && y2 >= y1, {
    message: "OCR bbox must be [x1,y1,x2,y2] with x2>=x1 and y2>=y1",
  });

export const OcrRegionLabelSchema = z.enum(["image", "text", "formula", "table"]);

export const OcrRequestSchema = z
  .object({
    bytes: z
      .custom<Uint8Array>((value) => value instanceof Uint8Array, {
        message: "OCR request bytes must be a Uint8Array",
      })
      .refine((value) => value.byteLength >= 1 && value.byteLength <= MAX_IMAGE_BYTES, {
        message: "OCR image must be between 1 byte and 10 MiB",
      }),
    mimeType: OcrMimeTypeSchema,
    requestId: z.string().trim().min(6).max(64),
  })
  .strict();

export const OcrPageSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const OcrRegionSchema = z
  .object({
    page: z.number().int().positive(),
    index: z.number().int().nonnegative(),
    label: OcrRegionLabelSchema,
    bbox: OcrBboxSchema,
    content: z.string().max(MAX_MARKDOWN_BYTES),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const OcrUsageSchema = z
  .object({
    inputTokens: z.number().finite().nullable(),
    outputTokens: z.number().finite().nullable(),
    totalTokens: z.number().finite().nullable(),
  })
  .strict();

export const OcrResultSchema = z
  .object({
    provider: z.literal("zhipu"),
    model: z.literal("glm-ocr"),
    markdown: z
      .string()
      .trim()
      .min(1)
      .refine((value) => utf8ByteLength(value) <= MAX_MARKDOWN_BYTES, {
        message: "OCR markdown exceeds 1 MiB",
      }),
    pages: z.array(OcrPageSchema).min(1).max(100),
    regions: z.array(OcrRegionSchema).max(2_000),
    requestId: z.string().trim().min(6).max(64),
    usage: OcrUsageSchema,
  })
  .strict();

export const GlmOcrLayoutDetailSchema = z
  .object({
    index: z.number().int().nonnegative(),
    label: OcrRegionLabelSchema,
    bbox_2d: OcrBboxSchema,
    content: z.string().max(MAX_MARKDOWN_BYTES).nullable().optional(),
    height: z.number().int().positive().optional(),
    width: z.number().int().positive().optional(),
  })
  .strict();

const GlmOcrUsageSchema = z
  .object({
    prompt_tokens: z.number().finite().optional(),
    completion_tokens: z.number().finite().optional(),
    total_tokens: z.number().int().finite().optional(),
    prompt_tokens_details: z
      .object({
        cached_tokens: z.number().finite().optional(),
      })
      .optional(),
  })
  .passthrough();

export const GlmOcrApiResponseSchema = z
  .object({
    id: z.string().min(1).max(200).optional(),
    created: z.number().finite().optional(),
    model: z.string().min(1).max(100),
    md_results: z.string().max(MAX_MARKDOWN_BYTES),
    layout_details: z.array(z.array(GlmOcrLayoutDetailSchema)).min(1).max(100),
    data_info: z.object({
      num_pages: z.number().int().positive().max(100),
      pages: z.array(OcrPageSchema).max(100).optional(),
    }),
    usage: GlmOcrUsageSchema,
    request_id: z.string().min(1).max(64).optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (utf8ByteLength(JSON.stringify(value.layout_details)) > MAX_LAYOUT_JSON_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["layout_details"],
        message: "layout_details exceeds 64 KiB",
      });
    }
    if (utf8ByteLength(JSON.stringify(value.data_info)) > MAX_LAYOUT_JSON_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["data_info"],
        message: "data_info exceeds 64 KiB",
      });
    }
  });

export type OcrMimeType = z.infer<typeof OcrMimeTypeSchema>;
export type OcrBbox = z.infer<typeof OcrBboxSchema>;
export type OcrRegionLabel = z.infer<typeof OcrRegionLabelSchema>;
export type OcrRequest = z.infer<typeof OcrRequestSchema>;
export type OcrResult = z.infer<typeof OcrResultSchema>;
export type GlmOcrApiResponse = z.infer<typeof GlmOcrApiResponseSchema>;
